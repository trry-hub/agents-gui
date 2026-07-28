import * as fs from 'fs';
import * as path from 'path';
import type { ApiProviderSettings, CustomApiProviderConfig } from './apiProviders';
import { resolveOpenCodePaths, type OpenCodePathOptions } from './openCodePaths';

/**
 * Sync VS Code API Provider settings into OpenCode's local config file
 * (~/.config/opencode/opencode.json on macOS/Linux).
 *
 * Like cc-switch, this writes the provider config directly into the CLI's own
 * config so the CLI reads the right provider/model without relying on
 * environment variables or --model overrides.
 *
 * What gets synced:
 * - provider.<id>: apiKey, baseURL, models, npm package
 * - model: the active provider's model (so OpenCode's model picker shows it)
 *
 * A backup of the original opencode.json is written before each mutation.
 */

const SYNC_MARKER = '__agents_gui_synced';
const SYNC_TAG = 'agents-gui';

export interface OpenCodeConfigSyncOptions extends OpenCodePathOptions {
  configPath?: string;
}

export class OpenCodeConfigSync {
  private readonly configPath: string;

  constructor(options: OpenCodeConfigSyncOptions = {}) {
    this.configPath = options.configPath ?? resolveOpenCodePaths(options).configPath;
  }

  /**
   * Resolve which API provider is active for opencode, then write it into
   * opencode.json so OpenCode picks it up natively.
   *
   * Skips the write when the config already matches to avoid unnecessary file
   * I/O and OpenCode server reloads on every startup.
   */
  async sync(settings: ApiProviderSettings): Promise<void> {
    const provider = resolveActiveProviderForOpenCode(settings);
    if (!provider) {
      return;
    }

    // Skip if the config already has the right provider/model — avoids
    // rewriting opencode.json (and triggering server reloads) on every startup.
    const providerKey = `agents_gui_${sanitizeKey(provider.id || provider.name || 'custom')}`;
    const canonicalModelId = resolveCanonicalModelId(
      provider,
      buildOpenCodeProviderEntry(provider)
    );
    const expectedModel = `${providerKey}/${canonicalModelId || provider.model}`;
    if (this.readCurrentModel() === expectedModel && this.hasSyncedProvider(providerKey)) {
      return;
    }

    await this.writeProviderConfig(provider);
  }

  /**
   * Check whether a synced provider entry already exists in opencode.json.
   */
  private hasSyncedProvider(providerKey: string): boolean {
    const config = this.readConfig();
    const providers = config?.provider;
    if (!providers || typeof providers !== 'object') {
      return false;
    }
    return Boolean((providers as Record<string, unknown>)[providerKey]);
  }

  /**
   * Read the current opencode.json as a parsed object.
   * Returns undefined if the file is missing or invalid.
   */
  readConfig(): Record<string, unknown> | undefined {
    try {
      const raw = fs.readFileSync(this.configPath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Get the model id currently set in opencode.json (top-level "model" field).
   */
  readCurrentModel(): string | undefined {
    const config = this.readConfig();
    const model = config?.model;
    return typeof model === 'string' && model.trim() ? model.trim() : undefined;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  private async writeProviderConfig(provider: CustomApiProviderConfig): Promise<void> {
    const configDir = path.dirname(this.configPath);
    await fs.promises.mkdir(configDir, { recursive: true });

    const existing = this.readConfig() ?? {};
    const providers = isRecord(existing.provider) ? { ...existing.provider } : {};

    // Use a stable, namespaced provider id so we never clobber a user-defined
    // provider with the same name. The id is also used in the "model" field as
    // "<id>/<modelId>".
    const providerKey = `agents_gui_${sanitizeKey(provider.id || provider.name || 'custom')}`;

    const entry = buildOpenCodeProviderEntry(provider);
    providers[providerKey] = entry;

    // Remove any previously-synced provider entries that are no longer active,
    // so switching providers does not leave stale entries behind.
    for (const key of Object.keys(providers)) {
      if (key === providerKey) {
        continue;
      }
      if (isAgentsGuiSyncedEntry(providers[key])) {
        delete providers[key];
      }
    }

    // Use the exact model id casing from the provider's model list when
    // possible. OpenCode model ids are case-sensitive: if the user entered
    // "MiMo-V2.5-Pro" but the provider lists "mimo-v2.5-pro", the mismatch
    // causes "unsupported model" errors. Match case-insensitively and prefer
    // the canonical id from the models list.
    const canonicalModelId = resolveCanonicalModelId(provider, entry);
    const modelId = canonicalModelId || provider.model;

    const next: Record<string, unknown> = {
      ...existing,
      provider: providers,
      model: `${providerKey}/${modelId}`,
    };

    await this.backupConfig(existing);
    await fs.promises.writeFile(this.configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  }

  private async backupConfig(currentConfig: Record<string, unknown>): Promise<void> {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${this.configPath}.${SYNC_TAG}-bak-${stamp}`;
      await fs.promises.writeFile(
        backupPath,
        `${JSON.stringify(currentConfig, null, 2)}\n`,
        'utf8'
      );
    } catch {
      // Backup is best-effort; don't fail the sync over it.
    }
  }
}

/**
 * Pick the API provider that should be used for the opencode CLI based on
 * agentProviderByCliId / defaultProviderId resolution.
 */
function resolveActiveProviderForOpenCode(
  settings: ApiProviderSettings
): CustomApiProviderConfig | undefined {
  const enabled = settings.customProviders.filter((provider) => provider.enabled);
  if (enabled.length === 0) {
    return undefined;
  }

  const configured = settings.agentProviderByCliId?.opencode;
  if (configured && configured !== 'inherit') {
    const match = enabled.find((provider) => provider.id === configured);
    if (match) {
      return match;
    }
  }

  if (settings.defaultProviderId) {
    const match = enabled.find((provider) => provider.id === settings.defaultProviderId);
    if (match) {
      return match;
    }
  }

  return undefined;
}

/**
 * Build an opencode.json provider entry from our API provider config.
 *
 * Maps our protocol field to the right npm package:
 * - openai protocol → @ai-sdk/openai-compatible
 * - anthropic protocol → @ai-sdk/anthropic
 */
function buildOpenCodeProviderEntry(provider: CustomApiProviderConfig): Record<string, unknown> {
  const npm = provider.protocol === 'anthropic' ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible';

  const options: Record<string, unknown> = {};
  if (provider.apiKey) {
    options.apiKey = provider.apiKey;
  } else if (provider.apiKeyEnv) {
    options.apiKey = `{env:${provider.apiKeyEnv}}`;
  }
  if (provider.baseUrl) {
    options.baseURL = provider.baseUrl;
  }
  // @ai-sdk/openai-compatible benefits from cache key routing for some providers.
  if (provider.protocol !== 'anthropic') {
    options.setCacheKey = true;
  }

  const models: Record<string, { name: string }> = {};
  const modelIds = provider.models.length > 0 ? provider.models : [provider.model].filter(Boolean);
  for (const modelId of modelIds) {
    if (modelId) {
      models[modelId] = { name: modelId };
    }
  }

  // Note: extraEnv is for environment variables passed to CLI processes, NOT
  // for provider options. Do not write extraEnv into the provider options —
  // it pollutes the OpenCode provider config with invalid keys.

  return {
    name: provider.name,
    npm,
    options,
    models,
    [SYNC_MARKER]: true,
    [`${SYNC_MARKER}_tag`]: SYNC_TAG,
  };
}

/**
 * Resolve the canonical (correct-case) model id from the provider's model
 * list. OpenCode model ids are case-sensitive: if the user entered
 * "MiMo-V2.5-Pro" but the provider lists "mimo-v2.5-pro", we must use the
 * canonical id to avoid "unsupported model" errors.
 */
function resolveCanonicalModelId(
  provider: CustomApiProviderConfig,
  entry: Record<string, unknown>
): string | undefined {
  const target = provider.model.trim().toLowerCase();
  if (!target) {
    return undefined;
  }

  const models = isRecord(entry.models) ? Object.keys(entry.models) : [];
  const match = models.find((id) => id.toLowerCase() === target);
  return match;
}

function isAgentsGuiSyncedEntry(value: unknown): boolean {
  return isRecord(value) && Boolean(value[SYNC_MARKER]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeKey(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'custom'
  );
}
