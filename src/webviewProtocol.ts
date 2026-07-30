import type {
  AssistantContextOptions,
  AssistantContextSummary,
  AssistantWebviewRequest,
} from './assistantTypes';
import type { CliAuthAction, CliProfile } from './cliProfiles';
import type { ThreadEventEnvelope } from './threadProtocol';
import type { ActiveRendererRun } from './threadEventAdapter';

export type SettingsSection = 'agents' | 'commitMessage' | 'mcp' | string;

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
  | { command: 'saveCommitMessageSettings'; settings?: unknown }
  | { command: 'loadMcpServers'; cliId?: string }
  | { command: 'saveMcpServer'; cliId?: string; server?: unknown }
  | { command: 'deleteMcpServer'; cliId?: string; name?: string }
  | { command: 'toggleMcpServer'; cliId?: string; name?: string; enabled?: boolean }
  | { command: 'stop'; cliId?: string; providerId?: string }
  | { command: 'checkProfiles'; force?: boolean }
  | {
      command: 'refreshContext';
      requestId: string;
      cliId: string;
      contextOptions?: Partial<AssistantContextOptions>;
    }
  | { command: 'openFilePalette' }
  | { command: 'openProviderExtension'; cliId?: string; providerId?: string }
  | { command: 'runCliAuthAction'; cliId?: string; action?: CliAuthAction }
  | { command: 'copyInstallCommand'; installCommand?: string }
  | { command: 'installCli'; cliId?: string }
  | { command: 'copyMessageText'; text?: string }
  | { command: 'saveSelectionState'; state?: unknown }
  | { command: 'codexRendererReady' }
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
      disabledMcpByProvider?: Record<string, string[]>;
      contextOptions?: Partial<AssistantContextOptions>;
      claudeTerminalBannerDismissed?: boolean;
      taskBoardDismissed?: boolean;
    } & Record<string, unknown>)
  | { command: 'refreshStarted' }
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
  | { command: 'contextInvalidated'; cliId?: string }
  | { command: 'rendererRuntimeSnapshot'; runs: ActiveRendererRun[] }
  | ({
      command: 'requestStarted';
      cliId: string;
      threadId: string;
      sessionId: string;
      text: string;
      contextSummary: AssistantContextSummary;
    } & Record<string, unknown>)
  | ({
      command: 'output';
      cliId: string;
      text: string;
      sessionId?: string;
    } & Record<string, unknown>)
  | { command: 'sessionNotice'; cliId: string; sessionId?: string; text: string }
  | {
      command: 'sessionEnd';
      cliId: string;
      exitCode: number;
      sessionId?: string;
    }
  | { command: 'stopped'; cliId: string; sessionId?: string }
  | {
      command: 'error';
      cliId: string;
      text: string;
      threadId?: string;
      sessionId?: string;
    }
  | {
      command: 'contextSummary';
      requestId: string;
      cliId: string;
      summary: AssistantContextSummary;
    };
