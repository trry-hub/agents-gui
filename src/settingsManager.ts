import * as vscode from 'vscode';
import type { AssistantContextOptions } from './assistantTypes';
import { CLI_PROFILES, getCliProfile, type CliProfile } from './cliProfiles';
import {
  AGENT_MODE_STATE_KEY,
  CONTEXT_OPTIONS_STATE_KEY,
  LAST_PROVIDER_STATE_KEY,
} from './syncedState';

const DEFAULT_CLI_ID = 'opencode';
const DEFAULT_COMMIT_MESSAGE_PROVIDER = 'default';
const ASK_COMMIT_MESSAGE_PROVIDER = 'ask';
const DEFAULT_COMMIT_MESSAGE_LANGUAGE = 'auto' as const;
const DEFAULT_COMMIT_MESSAGE_MAX_DIFF_CHARS = 60_000;

export interface HomeAgentSettings {
  visibleAgentIds: string[];
  agentOrder: string[];
}

export interface CommitMessageSettings {
  provider: string;
  language: 'auto' | 'en' | 'zh-CN';
  maxDiffChars: number;
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(([key, val]) => typeof key === 'string' && typeof val === 'string')
  );
}

function normalizeStringArrayRecord(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof key === 'string' && Array.isArray(val)) {
      result[key] = val.filter((item): item is string => typeof item === 'string');
    }
  }
  return result;
}

function normalizeContextOptions(value: unknown): Partial<AssistantContextOptions> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const result: Partial<AssistantContextOptions> = {};
  if (typeof record.includeWorkspace === 'boolean') {
    result.includeWorkspace = record.includeWorkspace;
  }
  if (typeof record.includeCurrentFile === 'boolean') {
    result.includeCurrentFile = record.includeCurrentFile;
  }
  if (typeof record.includeSelection === 'boolean') {
    result.includeSelection = record.includeSelection;
  }
  if (typeof record.includeDiagnostics === 'boolean') {
    result.includeDiagnostics = record.includeDiagnostics;
  }
  return result;
}

export class SettingsManager {
  constructor(private readonly state?: vscode.Memento) {}

  getHomeAgentSettings(): HomeAgentSettings {
    const config = vscode.workspace.getConfiguration('agents-gui.home');
    return this.normalizeHomeAgentSettings({
      visibleAgentIds: config.get<string[]>('visibleAgentIds', []),
      agentOrder: config.get<string[]>('agentOrder', []),
    });
  }

  getCommitMessageSettings(): CommitMessageSettings {
    const config = vscode.workspace.getConfiguration('agents-gui.commitMessage');
    return this.normalizeCommitMessageSettings({
      provider: config.get<string>('provider', DEFAULT_COMMIT_MESSAGE_PROVIDER),
      language: config.get<string>('language', DEFAULT_COMMIT_MESSAGE_LANGUAGE),
      maxDiffChars: config.get<number>('maxDiffChars', DEFAULT_COMMIT_MESSAGE_MAX_DIFF_CHARS),
    });
  }

  normalizeCommitMessageSettings(rawSettings: unknown): CommitMessageSettings {
    const record =
      rawSettings && typeof rawSettings === 'object'
        ? (rawSettings as { provider?: unknown; language?: unknown; maxDiffChars?: unknown })
        : {};
    const knownProviderIds = new Set([
      DEFAULT_COMMIT_MESSAGE_PROVIDER,
      ASK_COMMIT_MESSAGE_PROVIDER,
      ...CLI_PROFILES.map((profile) => profile.id),
    ]);
    const provider =
      typeof record.provider === 'string' && knownProviderIds.has(record.provider)
        ? record.provider
        : DEFAULT_COMMIT_MESSAGE_PROVIDER;
    const language =
      record.language === 'en' || record.language === 'zh-CN'
        ? record.language
        : DEFAULT_COMMIT_MESSAGE_LANGUAGE;
    const maxDiffChars = Number(record.maxDiffChars);

    return {
      provider,
      language,
      maxDiffChars: Number.isFinite(maxDiffChars)
        ? Math.max(1000, Math.round(maxDiffChars))
        : DEFAULT_COMMIT_MESSAGE_MAX_DIFF_CHARS,
    };
  }

  normalizeHomeAgentSettings(rawSettings: unknown): HomeAgentSettings {
    const knownIds = new Set(CLI_PROFILES.map((profile) => profile.id));
    const record =
      rawSettings && typeof rawSettings === 'object'
        ? (rawSettings as { visibleAgentIds?: unknown; agentOrder?: unknown })
        : {};
    const visibleAgentIds = this.normalizeHomeAgentIds(record.visibleAgentIds, knownIds);
    const agentOrder = this.normalizeHomeAgentIds(record.agentOrder, knownIds);
    return { visibleAgentIds, agentOrder };
  }

  private normalizeHomeAgentIds(value: unknown, knownIds: Set<string>): string[] {
    const seen = new Set<string>();
    return Array.isArray(value)
      ? value
          .map((id) => String(id || '').trim())
          .filter((id) => {
            if (!knownIds.has(id) || seen.has(id)) {
              return false;
            }
            seen.add(id);
            return true;
          })
      : [];
  }

  getStoredProviderId(profiles: CliProfile[]): string | undefined {
    const providerId = this.state?.get<string>(LAST_PROVIDER_STATE_KEY);
    if (providerId && profiles.some((profile) => profile.id === providerId && profile.installed)) {
      return providerId;
    }
    return undefined;
  }

  getStoredAgentModeState(profilesById: Map<string, CliProfile>): Record<string, string> {
    return this.normalizeAgentModeState(this.state?.get(AGENT_MODE_STATE_KEY), profilesById);
  }

  normalizeAgentModeState(
    value: unknown,
    profilesById: Map<string, CliProfile>
  ): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const result: Record<string, string> = {};
    for (const [providerId, modeId] of Object.entries(value)) {
      if (typeof providerId !== 'string' || typeof modeId !== 'string') {
        continue;
      }
      const profile = profilesById.get(providerId) ?? getCliProfile(providerId);
      const mode = profile?.agentModes.find((item) => item.id === modeId && !item.disabled);
      if (mode) {
        result[providerId] = modeId;
      }
    }
    return result;
  }

  getStoredStringRecord(key: string): Record<string, string> {
    return normalizeStringRecord(this.state?.get<Record<string, string>>(key, {}));
  }

  getStoredStringArrayRecord(key: string): Record<string, string[]> {
    return normalizeStringArrayRecord(this.state?.get<Record<string, string[]>>(key, {}));
  }

  getStoredContextOptions(): Partial<AssistantContextOptions> {
    return normalizeContextOptions(
      this.state?.get<Partial<AssistantContextOptions>>(CONTEXT_OPTIONS_STATE_KEY, {})
    );
  }

  getDefaultCliId(): string {
    const configured = vscode.workspace
      .getConfiguration('agents-gui')
      .get<string>('defaultProvider', DEFAULT_CLI_ID);

    if (configured && getCliProfile(configured)) {
      return configured;
    }

    return getCliProfile(DEFAULT_CLI_ID)?.id ?? CLI_PROFILES[0]?.id ?? DEFAULT_CLI_ID;
  }

  resolveCliId(message: { cliId?: string; providerId?: string }): string {
    return message.cliId ?? message.providerId ?? this.getDefaultCliId();
  }

  resolveContextOptions(overrides: Partial<AssistantContextOptions> = {}): AssistantContextOptions {
    const config = vscode.workspace.getConfiguration('agents-gui.context');
    return {
      includeWorkspace: config.get<boolean>('includeWorkspace', true),
      includeCurrentFile: config.get<boolean>('includeCurrentFile', true),
      includeSelection: config.get<boolean>('includeSelection', true),
      includeDiagnostics: config.get<boolean>('includeDiagnostics', true),
      ...overrides,
    };
  }

  getContextLimits() {
    const config = vscode.workspace.getConfiguration('agents-gui.context');
    return {
      maxFileChars: config.get<number>('maxFileChars', 12000),
      maxSelectionChars: config.get<number>('maxSelectionChars', 8000),
      maxDiagnostics: config.get<number>('maxDiagnostics', 12),
    };
  }
}
