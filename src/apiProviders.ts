export type ApiProviderProtocol = 'openai' | 'anthropic';

export interface CustomApiProviderConfig {
  id: string;
  name: string;
  protocol: ApiProviderProtocol;
  baseUrl: string;
  apiKey: string;
  apiKeyEnv: string;
  model: string;
  models: string[];
  extraEnv: Record<string, string>;
  enabled: boolean;
}

export interface ApiProviderSelectionConfig {
  defaultProviderId: string;
  agentProviderByCliId: Record<string, string>;
}

export interface ApiProviderSettings extends ApiProviderSelectionConfig {
  customProviders: CustomApiProviderConfig[];
}

export interface ApiProviderRuntimeWarning {
  code: 'missingApiKeyEnv';
  providerName: string;
  envName: string;
}

export interface ApiProviderRuntimeConfig {
  provider?: CustomApiProviderConfig;
  env: Record<string, string>;
  warnings: ApiProviderRuntimeWarning[];
  selectionKey: string;
}

export const API_PROVIDER_INHERIT = 'inherit';

export const EMPTY_API_PROVIDER_SETTINGS: ApiProviderSettings = {
  customProviders: [],
  defaultProviderId: '',
  agentProviderByCliId: {},
};

export function sanitizeApiProviderSettings(value: unknown): ApiProviderSettings {
  const record = isRecord(value) ? value : {};
  const providers = normalizeProviders(record.customProviders);
  const enabledIds = new Set(
    providers.filter((provider) => provider.enabled).map((provider) => provider.id)
  );
  const defaultProviderId = enabledIds.has(stringValue(record.defaultProviderId))
    ? stringValue(record.defaultProviderId)
    : '';
  const agentProviderByCliId = normalizeAgentProviderMap(
    record.agentProviderByCliId,
    enabledIds
  );

  return {
    customProviders: providers,
    defaultProviderId,
    agentProviderByCliId,
  };
}

export function resolveApiProviderRuntime(
  settings: ApiProviderSettings,
  cliId: string,
  sourceEnv: NodeJS.ProcessEnv = process.env
): ApiProviderRuntimeConfig {
  const provider = resolveApiProviderForAgent(settings, cliId);
  if (!provider) {
    return { env: {}, warnings: [], selectionKey: 'api-provider:none' };
  }

  const env: Record<string, string> = {
    AGENTS_HUB_API_PROVIDER: provider.name,
    AGENTS_HUB_API_PROVIDER_ID: provider.id,
    AGENTS_HUB_API_PROTOCOL: provider.protocol,
  };
  Object.assign(env, provider.extraEnv);

  if (provider.baseUrl) {
    env.AGENTS_HUB_API_BASE_URL = provider.baseUrl;
    if (provider.protocol === 'anthropic') {
      env.ANTHROPIC_BASE_URL = provider.baseUrl;
    } else {
      env.OPENAI_BASE_URL = provider.baseUrl;
    }
  }
  if (provider.model) {
    env.AGENTS_HUB_API_MODEL = provider.model;
    if (provider.protocol === 'anthropic') {
      env.ANTHROPIC_MODEL = provider.model;
    } else {
      env.OPENAI_MODEL = provider.model;
    }
  }

  const warnings: ApiProviderRuntimeWarning[] = [];
  if (provider.apiKey) {
    env.AGENTS_HUB_API_KEY = provider.apiKey;
    if (provider.protocol === 'anthropic') {
      env.ANTHROPIC_API_KEY = provider.apiKey;
    } else {
      env.OPENAI_API_KEY = provider.apiKey;
    }
  } else if (provider.apiKeyEnv) {
    const apiKey = sourceEnv[provider.apiKeyEnv];
    if (apiKey) {
      env.AGENTS_HUB_API_KEY = apiKey;
      if (provider.protocol === 'anthropic') {
        env.ANTHROPIC_API_KEY = apiKey;
      } else {
        env.OPENAI_API_KEY = apiKey;
      }
    } else {
      warnings.push({
        code: 'missingApiKeyEnv',
        providerName: provider.name,
        envName: provider.apiKeyEnv,
      });
    }
  }

  return {
    provider,
    env,
    warnings,
    selectionKey: [
      'api-provider',
      provider.id,
      provider.protocol,
      provider.baseUrl,
      provider.model,
      stableListKey(provider.models),
      provider.apiKey ? 'configured-key' : '',
      provider.apiKeyEnv,
      stableRecordKey(provider.extraEnv),
      provider.apiKey
        ? 'true'
        : provider.apiKeyEnv
          ? String(Boolean(sourceEnv[provider.apiKeyEnv]))
          : '',
    ].join('|'),
  };
}

export function resolveApiProviderForAgent(
  settings: ApiProviderSettings,
  cliId: string
): CustomApiProviderConfig | undefined {
  const configured = settings.agentProviderByCliId[cliId];
  const providerId =
    configured && configured !== API_PROVIDER_INHERIT
      ? configured
      : settings.defaultProviderId;

  return settings.customProviders.find(
    (provider) => provider.enabled && provider.id === providerId
  );
}

function normalizeProviders(value: unknown): CustomApiProviderConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const providers: CustomApiProviderConfig[] = [];
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      return;
    }

    const name = stringValue(item.name) || `Custom Provider ${index + 1}`;
    const baseId = sanitizeId(stringValue(item.id)) || sanitizeId(name) || `provider-${index + 1}`;
    const id = uniqueId(baseId, seen);
    providers.push({
      id,
      name,
      protocol: protocolValue(item.protocol),
      baseUrl: stringValue(item.baseUrl),
      apiKey: stringValue(item.apiKey),
      apiKeyEnv: envNameValue(item.apiKeyEnv),
      model: stringValue(item.model),
      models: stringArrayValue(item.models),
      extraEnv: normalizeExtraEnv(item.extraEnv),
      enabled: item.enabled !== false,
    });
  });
  return providers;
}

function normalizeAgentProviderMap(
  value: unknown,
  enabledIds: Set<string>
): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [cliId, providerId] of Object.entries(value)) {
    const key = stringValue(cliId);
    const next = stringValue(providerId);
    if (!key) {
      continue;
    }
    if (next === API_PROVIDER_INHERIT) {
      result[key] = API_PROVIDER_INHERIT;
      continue;
    }
    if (enabledIds.has(next)) {
      result[key] = next;
    }
  }
  return result;
}

function normalizeExtraEnv(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const envName = envNameValue(key);
    if (!envName || typeof rawValue !== 'string') {
      continue;
    }
    result[envName] = rawValue;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function envNameValue(value: unknown): string {
  return stringValue(value).replace(/[^A-Za-z0-9_]/g, '');
}

function protocolValue(value: unknown): ApiProviderProtocol {
  return value === 'anthropic' ? 'anthropic' : 'openai';
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  value.forEach((item) => {
    const text = stringValue(item);
    if (!text || seen.has(text)) {
      return;
    }
    seen.add(text);
    result.push(text);
  });
  return result;
}

function sanitizeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueId(baseId: string, seen: Set<string>): string {
  let id = baseId;
  let suffix = 2;
  while (seen.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  seen.add(id);
  return id;
}

function stableRecordKey(value: Record<string, string>): string {
  return Object.keys(value)
    .sort()
    .map((key) => `${key}=${value[key]}`)
    .join('&');
}

function stableListKey(values: string[]): string {
  return values.join(',');
}
