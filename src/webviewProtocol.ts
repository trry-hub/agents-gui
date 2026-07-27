import type {
  AssistantContextOptions,
  AssistantContextSummary,
  AssistantOpenCodeNativeCommand,
  AssistantOpenCodeNativeCommandResult,
  AssistantWebviewRequest,
} from './assistantTypes';
import type { ApiProviderSettings } from './apiProviders';
import type { CliAuthAction, CliProfile } from './cliProfiles';
import type { ThreadEventEnvelope } from './threadProtocol';

export type SettingsSection = 'agents' | 'apiProviders' | 'commitMessage' | 'mcp' | string;

export interface SetupCliProfile {
  id: string;
  name: string;
  description: string;
  installHint: string;
  installed: boolean;
  version?: string;
  icon?: string;
  webviewIcon?: {
    light: string;
    dark: string;
  };
}

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
  | { command: 'loadMcpServers'; cliId?: string }
  | { command: 'saveMcpServer'; cliId?: string; server?: unknown }
  | { command: 'deleteMcpServer'; cliId?: string; name?: string }
  | { command: 'toggleMcpServer'; cliId?: string; name?: string; enabled?: boolean }
  | { command: 'stop'; cliId?: string; providerId?: string }
  | { command: 'sendSessionInput'; cliId?: string; providerId?: string; text?: string }
  | { command: 'checkProfiles'; force?: boolean }
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
  | { command: 'runCliAuthAction'; cliId?: string; action?: CliAuthAction }
  | { command: 'copyInstallCommand'; installCommand?: string }
  | { command: 'installCli'; cliId?: string }
  | { command: 'setOpenCodeModelVariant'; modelId?: string; variant?: string }
  | { command: 'copyMessageText'; text?: string }
  | { command: 'saveSelectionState'; state?: unknown }
  | { command: 'disableCodexRenderer' }
  | { command: 'reloadWindow' };

export type HostToWebviewMessage =
  | ThreadEventEnvelope
  | ({
      command: 'profiles';
      profiles: CliProfile[];
      setupProfiles?: SetupCliProfile[];
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
  | { command: 'refreshStarted' }
  | ({
      command: 'apiProviderSettings';
      settings: ApiProviderSettings;
      envStatusByProviderId?: Record<string, { apiKeyEnv: string; apiKeyEnvAvailable: boolean }>;
    } & Record<string, unknown>)
  | {
      command: 'apiProviderModelsResult';
      requestId?: unknown;
      ok: boolean;
      models?: string[];
      message?: string;
    }
  | { command: 'settingsSaveResult'; section: SettingsSection; ok: boolean; message?: string }
  | { command: 'homeAgentSettings'; settings: unknown }
  | { command: 'commitMessageSettings'; settings: unknown }
  | {
      command: 'mcpServers';
      cliId: string;
      supported: boolean;
      configPath?: string;
      reason?: string;
      servers?: unknown[];
    }
  | { command: 'mcpServerSaved'; cliId: string; ok: boolean; message?: string; code?: string }
  | { command: 'openProviderSettings'; section?: SettingsSection }
  | { command: 'switchProvider'; providerId: string }
  | ({
      command: 'requestStarted';
      cliId: string;
      threadId: string;
      sessionId: string;
      text: string;
      contextSummary: AssistantContextSummary;
      modelId?: string;
      modelLabel?: string;
      modelVariant?: string;
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
  | {
      command: 'sessionEnd';
      cliId: string;
      exitCode: number;
      sessionId?: string;
      openCodeSessionId?: string;
    }
  | { command: 'stopped'; cliId: string; sessionId?: string }
  | { command: 'error'; cliId: string; text: string; sessionId?: string }
  | { command: 'contextSummary'; cliId?: string; summary: AssistantContextSummary };
