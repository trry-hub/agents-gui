import type {
  AssistantContextOptions,
  AssistantContextSummary,
  AssistantOpenCodeNativeCommand,
  AssistantOpenCodeNativeCommandResult,
  AssistantWebviewRequest,
} from './assistantTypes';
import type { ApiProviderSettings } from './apiProviders';
import type { CliProfile } from './cliProfiles';

export type SettingsSection = 'agents' | 'apiProviders' | 'commitMessage' | string;

export type WebviewToHostMessage =
  | ({ command: 'send' | 'quickAction' } & AssistantWebviewRequest)
  | { command: 'openSettings'; section?: SettingsSection }
  | { command: 'saveHomeAgentSettings'; settings?: unknown }
  | { command: 'saveApiProviderSettings'; settings?: unknown }
  | { command: 'saveCommitMessageSettings'; settings?: unknown }
  | { command: 'refreshApiProviderSettings' }
  | {
      command: 'fetchApiProviderModels';
      requestId?: unknown;
      provider?: {
        protocol?: unknown;
        baseUrl?: unknown;
        apiKey?: unknown;
        apiKeyEnv?: unknown;
      };
    }
  | { command: 'stop'; cliId?: string; providerId?: string }
  | { command: 'sendSessionInput'; cliId?: string; providerId?: string; text?: string }
  | { command: 'checkProfiles' }
  | {
      command: 'refreshContext';
      cliId?: string;
      providerId?: string;
      contextOptions?: Partial<AssistantContextOptions>;
      modelId?: string;
    }
  | {
      command: 'openCodeNativeCommand';
      nativeCommand?: AssistantOpenCodeNativeCommand;
      openCodeSessionId?: string;
    }
  | { command: 'deleteOpenCodeSession'; openCodeSessionId?: string }
  | { command: 'openFilePalette' }
  | { command: 'openProviderExtension'; cliId?: string; providerId?: string }
  | { command: 'copyInstallCommand'; installCommand?: string }
  | { command: 'copyMessageText'; text?: string }
  | { command: 'saveSelectionState'; state?: unknown }
  | { command: 'reloadWindow' };

export type HostToWebviewMessage =
  | ({
      command: 'profiles';
      profiles: CliProfile[];
      defaultProviderId?: string;
      activeProviderId?: string;
      activeAgentModeByProvider?: Record<string, string>;
      recentModelByProvider?: Record<string, string>;
      favoriteModelByProvider?: Record<string, string>;
      disabledMcpByProvider?: Record<string, string[]>;
      customModelByProvider?: Record<string, string>;
      activeRuntimeByProvider?: Record<string, string>;
      activePermissionByProvider?: Record<string, string>;
      contextOptions?: Partial<AssistantContextOptions>;
      claudeTerminalBannerDismissed?: boolean;
      taskBoardDismissed?: boolean;
    } & Record<string, unknown>)
  | ({
      command: 'apiProviderSettings';
      settings: ApiProviderSettings;
      envStatusByProviderId?: Record<string, { apiKeyEnv: string; apiKeyEnvAvailable: boolean }>;
    } & Record<string, unknown>)
  | { command: 'apiProviderModelsResult'; requestId?: unknown; ok: boolean; models?: string[]; message?: string }
  | { command: 'settingsSaveResult'; section: SettingsSection; ok: boolean; message?: string }
  | { command: 'homeAgentSettings'; settings: unknown }
  | { command: 'commitMessageSettings'; settings: unknown }
  | { command: 'openProviderSettings'; section?: SettingsSection }
  | { command: 'switchProvider'; providerId: string }
  | ({
      command: 'requestStarted';
      cliId: string;
      sessionId: string;
      text: string;
      contextSummary: AssistantContextSummary;
      modelId?: string;
      modelLabel?: string;
      runtimeId?: string;
      runtimeLabel?: string;
      permissionModeId?: string;
      permissionModeLabel?: string;
    } & Record<string, unknown>)
  | ({
      command: 'output';
      cliId: string;
      text: string;
      sessionId?: string;
    } & Record<string, unknown>)
  | {
      command: 'openCodeNativeCommandResult';
      nativeCommand: AssistantOpenCodeNativeCommandResult['command'];
      ok: boolean;
      message?: string;
      url?: string;
      newOpenCodeSessionId?: string;
      title?: string;
    }
  | { command: 'sessionNotice'; cliId: string; sessionId?: string; text: string }
  | { command: 'sessionInputResult'; cliId: string; sessionId?: string; ok: boolean }
  | { command: 'sessionEnd'; cliId: string; exitCode: number; sessionId?: string; openCodeSessionId?: string }
  | { command: 'stopped'; cliId: string; sessionId?: string }
  | { command: 'error'; cliId: string; text: string; sessionId?: string }
  | { command: 'contextSummary'; cliId?: string; summary: AssistantContextSummary };
