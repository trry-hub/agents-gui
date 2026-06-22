import * as path from 'path';
import * as vscode from 'vscode';
import { ApiProviderClient } from './apiProviderClient';
import {
  ApiProviderSettings,
  sanitizeApiProviderSettings,
  resolveApiProviderRuntime,
  type ApiProviderProtocol,
  type CustomApiProviderConfig,
  type ApiProviderRuntimeConfig,
} from './apiProviders';
import {
  AssistantActionId,
  AssistantContextOptions,
  AssistantContextSummary,
  AssistantMode,
  AssistantOpenCodeNativeCommand,
  AssistantOpenCodeNativeCommandResult,
  AssistantOpenCodeStatus,
  AssistantWebviewRequest,
} from './assistantTypes';
import { ImageAttachmentStore } from './attachmentStore';
import { actionRequiresActiveFile, actionRequiresSelection } from './actionGuards';
import type { AgentProfileStatusOptions, AgentRuntime } from './agentRuntime';
import {
  buildCliOptionArgs,
  CLI_PROFILES,
  getCliAgentMode,
  getCliModelOption,
  getCliPermissionMode,
  getCliProfile,
  getCliRuntimeMode,
  inferContextWindowTokens,
  type CliModelOption,
  type CliProfile,
} from './cliProfiles';
import { CliSetupController, toCliSetupProfile } from './cliSetup';
import { AssistantContextCollector } from './contextCollector';
import { McpManager } from './mcpManager';
import { buildAssistantPrompt } from './promptBuilder';
import { countContextTokens } from './tokenCounter';
import { AgentSessionController } from './agentSessionController';
import {
  resolveRuntimeLocale,
  runtimeActionLabel,
  runtimeDefaultActionText,
  runtimeT,
} from './localization';
import type { OpenCodeAgentCapability } from './openCodeAgentCapability';
import { OpenCodeLocalState } from './openCodeLocalState';
import { getProviderExtensionBridge } from './providerExtensions';
import type { HostToWebviewMessage, SetupCliProfile, WebviewToHostMessage } from './webviewProtocol';
import { renderWebviewHtml } from './webviewHtmlRenderer';
import {
  AGENT_MODE_STATE_KEY,
  CLAUDE_TERMINAL_BANNER_STATE_KEY,
  CONTEXT_OPTIONS_STATE_KEY,
  CUSTOM_MODEL_STATE_KEY,
  DISABLED_MCP_STATE_KEY,
  FAVORITE_MODEL_STATE_KEY,
  LAST_PROVIDER_STATE_KEY,
  PERMISSION_STATE_KEY,
  RECENT_MODEL_STATE_KEY,
  RUNTIME_STATE_KEY,
  TASK_BOARD_DISMISSED_STATE_KEY,
} from './syncedState';

const PROVIDER_ICON_PATHS = {
  claude: { light: 'media/provider-icons/claude.svg', dark: 'media/provider-icons/claude.svg' },
  gemini: { light: 'media/provider-icons/gemini.png', dark: 'media/provider-icons/gemini.png' },
  codex: { light: 'media/provider-icons/codex.png', dark: 'media/provider-icons/codex.png' },
  opencode: { light: 'media/provider-icons/opencode.png', dark: 'media/provider-icons/opencode.png' },
  goose: { light: 'media/provider-icons/goose-light.png', dark: 'media/provider-icons/goose-dark.png' },
  aider: { light: 'media/provider-icons/aider.png', dark: 'media/provider-icons/aider.png' },
} as const;

interface SidebarProviderOptions {
  apiProviderClient?: ApiProviderClient;
  attachmentStore?: ImageAttachmentStore;
  contextCollector?: AssistantContextCollector;
  extensionMode?: vscode.ExtensionMode;
  openCodeLocalState?: OpenCodeLocalState;
  openCodeCapability?: OpenCodeAgentCapability;
  state?: vscode.Memento;
  storageUri?: vscode.Uri;
}

interface HomeAgentSettings {
  visibleAgentIds: string[];
  agentOrder: string[];
}

interface CommitMessageSettings {
  provider: string;
  language: 'auto' | 'en' | 'zh-CN';
  maxDiffChars: number;
}

interface ProviderClientTerminalState {
  terminal: vscode.Terminal;
  started: boolean;
}

const DEFAULT_CLI_ID = 'opencode';
const DEFAULT_COMMIT_MESSAGE_PROVIDER = 'default';
const ASK_COMMIT_MESSAGE_PROVIDER = 'ask';
const DEFAULT_COMMIT_MESSAGE_LANGUAGE: CommitMessageSettings['language'] = 'auto';
const DEFAULT_COMMIT_MESSAGE_MAX_DIFF_CHARS = 60_000;
const OPENCODE_STATUS_REFRESH_DELAYS_MS = [1_500, 3_000, 6_000, 10_000, 15_000];
export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'agents-gui.sidebar';

  private view?: vscode.WebviewView;
  private pendingRequests: AssistantWebviewRequest[] = [];
  private disposables: vscode.Disposable[] = [];
  private providerClientTerminals = new Map<string, ProviderClientTerminalState>();
  private openCodeStatusRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private openCodeStatusRefreshAttempts = new Map<string, number>();
  private profilesById = new Map<string, CliProfile>();
  private webviewAssetVersion = Date.now();
  private webviewReloadTimer?: ReturnType<typeof setTimeout>;
  private readonly locale = resolveRuntimeLocale(vscode.env.language);
  private readonly contextCollector: AssistantContextCollector;
  private readonly extensionMode: vscode.ExtensionMode;
  private readonly openCodeCapability?: OpenCodeAgentCapability;
  private readonly openCodeLocalState: OpenCodeLocalState;
  private readonly attachmentStore: ImageAttachmentStore;
  private readonly apiProviderClient: ApiProviderClient;
  private readonly cliSetup: CliSetupController;
  private readonly mcpManager: McpManager;
  private readonly sessionController: AgentSessionController;
  private readonly state?: vscode.Memento;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly agentRuntime: AgentRuntime,
    options: SidebarProviderOptions = {}
  ) {
    this.apiProviderClient = options.apiProviderClient ?? new ApiProviderClient();
    this.cliSetup = new CliSetupController(this.locale, (cliId) => (
      this.profilesById.get(cliId) ?? getCliProfile(cliId)
    ));
    this.mcpManager = new McpManager({
      openCodeStatusProvider: async () => this.openCodeCapability?.getStatus(),
    });
    this.contextCollector = options.contextCollector ?? new AssistantContextCollector();
    this.extensionMode = options.extensionMode ?? vscode.ExtensionMode.Production;
    this.openCodeCapability = options.openCodeCapability;
    this.openCodeLocalState = options.openCodeLocalState ?? new OpenCodeLocalState();
    this.state = options.state;
    this.attachmentStore = options.attachmentStore ?? new ImageAttachmentStore({
      storageUri: options.storageUri ?? vscode.Uri.joinPath(this.extensionUri, '.agents-gui'),
    });
    this.sessionController = new AgentSessionController({
      agentRuntime: this.agentRuntime,
      locale: this.locale,
      postToWebview: (message) => {
        void this.postToWebview(message);
      },
    });
    this.disposables.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        for (const [providerId, entry] of this.providerClientTerminals) {
          if (entry.terminal === terminal) {
            this.providerClientTerminals.delete(providerId);
          }
        }
      })
    );
    this.registerDevelopmentWebviewWatcher();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);
    void this.sendHomeAgentSettings();
    void this.sendApiProviderSettings();
    void this.sendCommitMessageSettings();
    void this.flushPendingRequests();

    webviewView.webview.onDidReceiveMessage(async (message: WebviewToHostMessage) => {
      switch (message.command) {
        case 'send':
        case 'quickAction':
          await this.handleAssistantRequest(message);
          break;
        case 'openSettings':
          await this.openProviderSettings(message.section);
          break;
        case 'saveHomeAgentSettings':
          await this.saveSettingsWithResult('agents', () => this.saveHomeAgentSettings(message.settings));
          break;
        case 'saveApiProviderSettings':
          await this.saveSettingsWithResult('apiProviders', () => this.saveApiProviderSettings(message.settings));
          break;
        case 'saveCommitMessageSettings':
          await this.saveSettingsWithResult('commitMessage', () => this.saveCommitMessageSettings(message.settings));
          break;
        case 'loadMcpServers':
          await this.handleLoadMcpServers(message);
          break;
        case 'saveMcpServer':
          await this.handleSaveMcpServer(message);
          break;
        case 'deleteMcpServer':
          await this.handleDeleteMcpServer(message);
          break;
        case 'toggleMcpServer':
          await this.handleToggleMcpServer(message);
          break;
        case 'refreshApiProviderSettings':
          await this.sendApiProviderSettings();
          break;
        case 'fetchApiProviderModels':
          await this.fetchApiProviderModels(message);
          break;
        case 'stop':
          this.handleStop(this.resolveCliId(message));
          break;
        case 'sendSessionInput':
          await this.handleSessionInput(message);
          break;
        case 'checkProfiles':
          await this.sendProfiles({ force: Boolean(message.force) });
          break;
        case 'refreshContext':
          await this.sendContextSummary(message.contextOptions, this.resolveCliId(message), message.modelId);
          break;
        case 'openCodeNativeCommand':
          await this.handleOpenCodeNativeCommand(message);
          break;
        case 'deleteOpenCodeSession':
          await this.handleDeleteOpenCodeSession(message);
          break;
        case 'openFilePalette':
          await vscode.commands.executeCommand('workbench.action.quickOpen');
          break;
        case 'openProviderExtension':
          await this.openProviderExtension(this.resolveCliId(message));
          break;
        case 'runCliAuthAction':
          await this.cliSetup.runCliAuthAction(this.resolveCliId(message), message.action);
          break;
        case 'copyInstallCommand':
          await this.cliSetup.copyInstallCommand(message.installCommand);
          break;
        case 'installCli':
          await this.cliSetup.installCli(message.cliId);
          break;
        case 'setOpenCodeModelVariant':
          await this.setOpenCodeModelVariant(message.modelId, message.variant);
          break;
        case 'copyMessageText':
          await this.copyMessageText(message.text);
          break;
        case 'saveSelectionState':
          await this.saveSelectionState(message);
          break;
        case 'reloadWindow':
          await vscode.commands.executeCommand('agents-gui.reloadWindow');
          break;
      }
    });

    webviewView.onDidDispose(() => {
      this.dispose();
    });
  }

  async runEditorAction(action: AssistantActionId): Promise<void> {
    const cliId = this.getDefaultCliId();
    const profile = getCliProfile(cliId);
    const request: AssistantWebviewRequest = {
      cliId,
      action,
      mode: 'agent',
      agentMode: action === 'explainSelection' ? preferredReadOnlyMode(profile) : undefined,
      permissionMode: action === 'explainSelection' ? preferredReadOnlyPermission(profile) : undefined,
      text: runtimeDefaultActionText(this.locale, action),
      contextOptions: {
        includeWorkspace: true,
        includeCurrentFile: true,
        includeSelection: true,
        includeDiagnostics: true,
      },
    };

    this.pendingRequests.push(request);
    await vscode.commands.executeCommand('agents-gui.sidebar.focus');

    if (this.view) {
      await this.flushPendingRequests();
    }
  }

  private async handleOpenCodeNativeCommand(message: {
    nativeCommand?: AssistantOpenCodeNativeCommand;
    openCodeSessionId?: string;
  }): Promise<void> {
    const nativeCommand = message.nativeCommand;
    if (!nativeCommand) {
      return;
    }

    const result: AssistantOpenCodeNativeCommandResult = this.openCodeCapability
      ? await this.openCodeCapability.executeNativeCommand(
        nativeCommand,
        message.openCodeSessionId
      ).catch((error) => ({
        command: nativeCommand,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      }))
      : {
        command: nativeCommand,
        ok: false,
        message: 'OpenCode capability is not available.',
      };
    await this.postToWebview({
      command: 'openCodeNativeCommandResult',
      nativeCommand: result.command,
      ok: result.ok,
      message: result.message,
      url: result.url,
      newOpenCodeSessionId: result.newOpenCodeSessionId,
      title: result.title,
    });
    await this.sendContextSummary(undefined, 'opencode');
  }

  private async handleDeleteOpenCodeSession(message: {
    openCodeSessionId?: string;
  }): Promise<void> {
    const ok = this.openCodeCapability
      ? await this.openCodeCapability.deleteSession(message.openCodeSessionId).catch(() => false)
      : false;
    if (ok) {
      await this.sendContextSummary(undefined, 'opencode');
    }
  }

  async switchProvider(providerId: string): Promise<void> {
    const profile = getCliProfile(providerId);
    if (!profile) {
      return;
    }

    if (!this.profilesById.has(providerId)) {
      await this.sendProfiles();
    }

    const knownProfile = this.profilesById.get(providerId);
    if (knownProfile && !knownProfile.installed) {
      vscode.window.showWarningMessage(`${knownProfile.name} is not installed.`);
      return;
    }

    await this.state?.update(LAST_PROVIDER_STATE_KEY, providerId);
    await vscode.commands.executeCommand('setContext', 'agents-gui.activeProvider', providerId);

    if (this.view) {
      this.view.show(true);
      await this.postSwitchProviderMessage(providerId);
      return;
    }

    await vscode.commands.executeCommand('agents-gui.sidebar.focus');
    await this.postSwitchProviderMessage(providerId);
  }

  async refreshProviders(): Promise<void> {
    await this.postToWebview({ command: 'refreshStarted' });
    await this.sendProfiles({ force: true });
    await this.sendContextSummary();
    await this.sendHomeAgentSettings();
    await this.sendApiProviderSettings();
    await this.sendCommitMessageSettings();
  }

  async openProviderSettings(section = 'agents'): Promise<void> {
    await vscode.commands.executeCommand('agents-gui.sidebar.focus');
    this.view?.show(true);
    await this.sendHomeAgentSettings();
    await this.sendApiProviderSettings();
    await this.sendCommitMessageSettings();
    await this.handleLoadMcpServers({ cliId: this.getDefaultCliId() });
    await this.postToWebview({ command: 'openProviderSettings', section });
  }

  private async postSwitchProviderMessage(providerId: string): Promise<void> {
    await this.postToWebview({ command: 'switchProvider', providerId });
  }

  private postToWebview(message: HostToWebviewMessage): Thenable<boolean> | undefined {
    return this.view?.webview.postMessage(message);
  }

  stopAll(): void {
    this.sessionController.stopAll();
  }

  private async flushPendingRequests(): Promise<void> {
    while (this.view && this.pendingRequests.length > 0) {
      const request = this.pendingRequests.shift();
      if (request) {
        await this.handleAssistantRequest(request);
      }
    }
  }

  private async sendProfiles(options: AgentProfileStatusOptions = {}): Promise<void> {
    const profiles = await this.agentRuntime.getProfilesWithStatus(options);
    const installedProfiles = profiles.filter((profile) => profile.installed);
    this.profilesById.clear();
    installedProfiles.forEach((profile) => {
      this.profilesById.set(profile.id, profile);
    });
    const configuredDefaultProviderId = this.getDefaultCliId();
    const defaultProviderId = installedProfiles.some((profile) => profile.id === configuredDefaultProviderId)
      ? configuredDefaultProviderId
      : installedProfiles[0]?.id || '';
    const storedProviderId = this.getStoredProviderId(installedProfiles);
    await this.updateProviderTitleContexts(profiles, storedProviderId ?? defaultProviderId);
    this.postToWebview({
      command: 'profiles',
      profiles: installedProfiles.map((profile) => ({
        ...profile,
        vscodeExtension: this.getProviderExtensionStatus(profile.id),
        webviewIcon: this.getProviderIconUris(profile.id),
      })),
      setupProfiles: profiles.map((profile) => this.toSetupProfile(profile)),
      defaultProviderId,
      activeProviderId: storedProviderId,
      activeAgentModeByProvider: this.getStoredAgentModeState(),
      recentModelByProvider: this.getStoredStringRecord(RECENT_MODEL_STATE_KEY),
      favoriteModelByProvider: this.getStoredStringRecord(FAVORITE_MODEL_STATE_KEY),
      disabledMcpByProvider: this.getStoredStringArrayRecord(DISABLED_MCP_STATE_KEY),
      customModelByProvider: this.getStoredStringRecord(CUSTOM_MODEL_STATE_KEY),
      activeRuntimeByProvider: this.getStoredStringRecord(RUNTIME_STATE_KEY),
      activePermissionByProvider: this.getStoredStringRecord(PERMISSION_STATE_KEY),
      contextOptions: this.getStoredContextOptions(),
      claudeTerminalBannerDismissed: this.state?.get<boolean>(CLAUDE_TERMINAL_BANNER_STATE_KEY, false),
      taskBoardDismissed: this.state?.get<boolean>(TASK_BOARD_DISMISSED_STATE_KEY, false),
    });
  }

  private toSetupProfile(profile: CliProfile): SetupCliProfile {
    return {
      ...toCliSetupProfile(profile),
      webviewIcon: this.getProviderIconUris(profile.id),
    };
  }

  private async sendApiProviderSettings(): Promise<void> {
    const settings = this.getApiProviderSettings();
    const envStatusByProviderId = Object.fromEntries(
      settings.customProviders.map((provider) => [
        provider.id,
        {
          apiKeyEnv: provider.apiKeyEnv,
          apiKeyEnvAvailable: !provider.apiKeyEnv || Boolean(process.env[provider.apiKeyEnv]),
        },
      ])
    );

    this.postToWebview({
      command: 'apiProviderSettings',
      settings,
      envStatusByProviderId,
    });
  }

  private async sendHomeAgentSettings(): Promise<void> {
    this.postToWebview({
      command: 'homeAgentSettings',
      settings: this.getHomeAgentSettings(),
    });
  }

  private async sendCommitMessageSettings(): Promise<void> {
    this.postToWebview({
      command: 'commitMessageSettings',
      settings: this.getCommitMessageSettings(),
    });
  }

  private async saveSettingsWithResult(
    section: 'agents' | 'apiProviders' | 'commitMessage',
    save: () => Promise<void>
  ): Promise<void> {
    try {
      await save();
      this.postToWebview({
        command: 'settingsSaveResult',
        section,
        ok: true,
      });
    } catch (error) {
      this.postToWebview({
        command: 'settingsSaveResult',
        section,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async saveHomeAgentSettings(rawSettings: unknown): Promise<void> {
    const settings = this.normalizeHomeAgentSettings(rawSettings);
    const config = vscode.workspace.getConfiguration('agents-gui.home');
    await config.update('visibleAgentIds', settings.visibleAgentIds, vscode.ConfigurationTarget.Global);
    await config.update('agentOrder', settings.agentOrder, vscode.ConfigurationTarget.Global);
    await this.sendHomeAgentSettings();
    await this.sendProfiles();
  }

  private async saveApiProviderSettings(rawSettings: unknown): Promise<void> {
    const settings = this.filterApiProviderSettingsForInstalledAgents(
      sanitizeApiProviderSettings(rawSettings)
    );
    const config = vscode.workspace.getConfiguration('agents-gui.apiProviders');

    await Promise.all([
      config.update('customProviders', settings.customProviders, vscode.ConfigurationTarget.Global),
      config.update('defaultProviderId', settings.defaultProviderId, vscode.ConfigurationTarget.Global),
      config.update(
        'agentProviderByCliId',
        settings.agentProviderByCliId,
        vscode.ConfigurationTarget.Global
      ),
    ]);

    await this.sendApiProviderSettings();
  }

  private async fetchApiProviderModels(message: {
    requestId?: unknown;
    provider?: {
      protocol?: unknown;
      baseUrl?: unknown;
      apiKey?: unknown;
      apiKeyEnv?: unknown;
    };
  }): Promise<void> {
    const requestId = typeof message.requestId === 'number' ? message.requestId : 0;
    try {
      const provider = message.provider && typeof message.provider === 'object'
        ? message.provider
        : {};
      const protocol: ApiProviderProtocol = provider.protocol === 'anthropic' ? 'anthropic' : 'openai';
      const baseUrl = typeof provider.baseUrl === 'string' ? provider.baseUrl.trim() : '';
      const explicitApiKey = typeof provider.apiKey === 'string' ? provider.apiKey.trim() : '';
      const apiKeyEnv = typeof provider.apiKeyEnv === 'string'
        ? provider.apiKeyEnv.trim().replace(/[^A-Za-z0-9_]/g, '')
        : '';
      const apiKey = explicitApiKey || (apiKeyEnv ? process.env[apiKeyEnv] || '' : '');
      if (!baseUrl) {
        throw new Error('Base URL is required');
      }

      const models = await this.apiProviderClient.listModels({ protocol, baseUrl, apiKey });
      this.postToWebview({
        command: 'apiProviderModelsResult',
        requestId,
        ok: true,
        models,
      });
    } catch (error) {
      this.postToWebview({
        command: 'apiProviderModelsResult',
        requestId,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async saveCommitMessageSettings(rawSettings: unknown): Promise<void> {
    const settings = this.normalizeCommitMessageSettings(rawSettings);
    const config = vscode.workspace.getConfiguration('agents-gui.commitMessage');

    await Promise.all([
      config.update('provider', settings.provider, vscode.ConfigurationTarget.Global),
      config.update('language', settings.language, vscode.ConfigurationTarget.Global),
      config.update('maxDiffChars', settings.maxDiffChars, vscode.ConfigurationTarget.Global),
    ]);

    await this.sendCommitMessageSettings();
  }

  private async handleLoadMcpServers(message: { cliId?: string }): Promise<void> {
    const cliId = message.cliId || this.getDefaultCliId();
    try {
      const snapshot = await this.mcpManager.snapshot(cliId);
      this.postToWebview({
        command: 'mcpServers',
        cliId,
        supported: snapshot.supported,
        configPath: snapshot.configPath,
        reason: snapshot.reason,
        servers: snapshot.servers,
      });
    } catch (error) {
      this.postToWebview({
        command: 'mcpServers',
        cliId,
        supported: false,
        reason: error instanceof Error ? error.message : String(error),
        servers: [],
      });
    }
  }

  private async handleSaveMcpServer(message: { cliId?: string; server?: unknown }): Promise<void> {
    const cliId = message.cliId || this.getDefaultCliId();
    const result = await this.mcpManager.upsert(cliId, (message.server ?? {}) as Record<string, unknown>);
    await this.postToWebview({
      command: 'mcpServerSaved',
      cliId,
      ok: result.ok,
      message: result.message,
      code: result.code,
    });
    if (result.ok) {
      await this.handleLoadMcpServers({ cliId });
      await this.sendContextSummary(undefined, cliId);
    }
  }

  private async handleDeleteMcpServer(message: { cliId?: string; name?: string }): Promise<void> {
    const cliId = message.cliId || this.getDefaultCliId();
    const name = String(message.name || '').trim();
    if (!name) {
      return;
    }
    const confirmText = runtimeT(this.locale, 'mcpSettings.confirmDelete', { name });
    const choice = await vscode.window.showWarningMessage(
      confirmText,
      { modal: true },
      runtimeT(this.locale, 'mcpSettings.delete')
    );
    if (choice !== runtimeT(this.locale, 'mcpSettings.delete')) {
      return;
    }
    const result = await this.mcpManager.remove(cliId, name);
    await this.postToWebview({
      command: 'mcpServerSaved',
      cliId,
      ok: result.ok,
      message: result.message,
      code: result.code,
    });
    if (result.ok) {
      await this.handleLoadMcpServers({ cliId });
      await this.sendContextSummary(undefined, cliId);
    }
  }

  private async handleToggleMcpServer(message: { cliId?: string; name?: string; enabled?: boolean }): Promise<void> {
    const cliId = message.cliId || this.getDefaultCliId();
    const result = await this.mcpManager.setEnabled(cliId, String(message.name || ''), message.enabled !== false);
    await this.postToWebview({
      command: 'mcpServerSaved',
      cliId,
      ok: result.ok,
      message: result.message,
      code: result.code,
    });
    if (result.ok) {
      await this.handleLoadMcpServers({ cliId });
      await this.sendContextSummary(undefined, cliId);
    }
  }

  private getApiProviderSettings(): ApiProviderSettings {
    const config = vscode.workspace.getConfiguration('agents-gui.apiProviders');
    return this.filterApiProviderSettingsForInstalledAgents(
      sanitizeApiProviderSettings({
        customProviders: config.get<CustomApiProviderConfig[]>('customProviders', []),
        defaultProviderId: config.get<string>('defaultProviderId', ''),
        agentProviderByCliId: config.get<Record<string, string>>('agentProviderByCliId', {}),
      })
    );
  }

  private filterApiProviderSettingsForInstalledAgents(
    settings: ApiProviderSettings
  ): ApiProviderSettings {
    if (this.profilesById.size === 0) {
      return settings;
    }

    return {
      ...settings,
      agentProviderByCliId: Object.fromEntries(
        Object.entries(settings.agentProviderByCliId).filter(([cliId]) => (
          this.profilesById.has(cliId)
        ))
      ),
    };
  }

  private getHomeAgentSettings(): HomeAgentSettings {
    const config = vscode.workspace.getConfiguration('agents-gui.home');
    return this.normalizeHomeAgentSettings({
      visibleAgentIds: config.get<string[]>('visibleAgentIds', []),
      agentOrder: config.get<string[]>('agentOrder', []),
    });
  }

  private getCommitMessageSettings(): CommitMessageSettings {
    const config = vscode.workspace.getConfiguration('agents-gui.commitMessage');
    return this.normalizeCommitMessageSettings({
      provider: config.get<string>('provider', DEFAULT_COMMIT_MESSAGE_PROVIDER),
      language: config.get<string>('language', DEFAULT_COMMIT_MESSAGE_LANGUAGE),
      maxDiffChars: config.get<number>('maxDiffChars', DEFAULT_COMMIT_MESSAGE_MAX_DIFF_CHARS),
    });
  }

  private normalizeCommitMessageSettings(rawSettings: unknown): CommitMessageSettings {
    const record = rawSettings && typeof rawSettings === 'object'
      ? rawSettings as { provider?: unknown; language?: unknown; maxDiffChars?: unknown }
      : {};
    const knownProviderIds = new Set([
      DEFAULT_COMMIT_MESSAGE_PROVIDER,
      ASK_COMMIT_MESSAGE_PROVIDER,
      ...CLI_PROFILES.map((profile) => profile.id),
    ]);
    const provider = typeof record.provider === 'string' && knownProviderIds.has(record.provider)
      ? record.provider
      : DEFAULT_COMMIT_MESSAGE_PROVIDER;
    const language = record.language === 'en' || record.language === 'zh-CN'
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

  private normalizeHomeAgentSettings(rawSettings: unknown): HomeAgentSettings {
    const knownIds = new Set(CLI_PROFILES.map((profile) => profile.id));
    const record = rawSettings && typeof rawSettings === 'object'
      ? rawSettings as { visibleAgentIds?: unknown; agentOrder?: unknown }
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

  private async updateProviderTitleContexts(
    profiles: CliProfile[],
    activeProviderId: string
  ): Promise<void> {
    const installedProviderIds = new Set(
      profiles.filter((profile) => profile.installed).map((profile) => profile.id)
    );

    await Promise.all([
      vscode.commands.executeCommand('setContext', 'agents-gui.activeProvider', activeProviderId),
      ...CLI_PROFILES.map((profile) => (
        vscode.commands.executeCommand(
          'setContext',
          `agents-gui.provider.${profile.id}.installed`,
          installedProviderIds.has(profile.id)
        )
      )),
    ]);
  }

  private getStoredProviderId(profiles: CliProfile[]): string | undefined {
    const providerId = this.state?.get<string>(LAST_PROVIDER_STATE_KEY);
    if (providerId && profiles.some((profile) => profile.id === providerId && profile.installed)) {
      return providerId;
    }
    return undefined;
  }

  private getStoredAgentModeState(): Record<string, string> {
    return this.normalizeAgentModeState(this.state?.get(AGENT_MODE_STATE_KEY));
  }

  private getProviderExtensionStatus(providerId: string) {
    const bridge = getProviderExtensionBridge(providerId);
    if (!bridge) {
      return undefined;
    }

    return {
      extensionId: bridge.extensionId,
      displayName: bridge.displayName,
      installed: Boolean(vscode.extensions.getExtension(bridge.extensionId)),
    };
  }

  private async sendContextSummary(
    contextOptions: Partial<AssistantContextOptions> = {},
    cliId = this.getDefaultCliId(),
    modelId?: string
  ): Promise<void> {
    const options = this.resolveContextOptions(contextOptions);
    const snapshot = await this.contextCollector.collect(options, this.getContextLimits());
    const profile = getCliProfile(cliId) ?? getCliProfile(this.getDefaultCliId());
    const baseSummary = this.contextCollector.summarize(snapshot);
    const openCodeStatus = profile?.id === 'opencode'
      ? await this.openCodeCapability?.getStatus()
      : undefined;
    const mcpStatusPending = this.shouldRetryOpenCodeStatus(profile?.id, openCodeStatus);
    const workspaceBranch = await this.getWorkspaceBranch(
      openCodeStatus?.project?.worktree ?? baseSummary.workspacePath
    );
    const summary = profile
      ? {
          ...baseSummary,
          workspaceBranch,
          openCodeProject: openCodeStatus?.project,
          mcpServers: openCodeStatus?.mcpServers,
          mcpStatusPending,
          lspServers: openCodeStatus?.lspServers,
          tokenUsage: countContextTokens(snapshot, profile, modelId),
          contextWindowTokens: profile.contextWindowTokens ?? inferContextWindowTokens(modelId),
        }
      : {
          ...baseSummary,
          workspaceBranch,
        };
    this.postToWebview({
      command: 'contextSummary',
      summary,
    });
    this.scheduleOpenCodeStatusRefresh(profile?.id, openCodeStatus, contextOptions, modelId);
  }

  private shouldRetryOpenCodeStatus(
    profileId: string | undefined,
    status: AssistantOpenCodeStatus | undefined
  ): boolean {
    if (profileId !== 'opencode') {
      return false;
    }
    if (Array.isArray(status?.mcpServers) && status.mcpServers.length > 0) {
      return false;
    }
    return (this.openCodeStatusRefreshAttempts.get('opencode') ?? 0) < OPENCODE_STATUS_REFRESH_DELAYS_MS.length;
  }

  private scheduleOpenCodeStatusRefresh(
    profileId: string | undefined,
    status: AssistantOpenCodeStatus | undefined,
    contextOptions: Partial<AssistantContextOptions>,
    modelId?: string
  ): void {
    if (profileId !== 'opencode') {
      return;
    }

    const key = 'opencode';
    if (Array.isArray(status?.mcpServers) && status.mcpServers.length > 0) {
      this.clearOpenCodeStatusRefreshTimers();
      this.openCodeStatusRefreshAttempts.delete(key);
      return;
    }

    const attempts = this.openCodeStatusRefreshAttempts.get(key) ?? 0;
    if (attempts >= OPENCODE_STATUS_REFRESH_DELAYS_MS.length || this.openCodeStatusRefreshTimers.has(key)) {
      return;
    }

    const delay = OPENCODE_STATUS_REFRESH_DELAYS_MS[attempts];
    this.openCodeStatusRefreshAttempts.set(key, attempts + 1);
    const timer = setTimeout(() => {
      this.openCodeStatusRefreshTimers.delete(key);
      void this.sendContextSummary(contextOptions, 'opencode', modelId);
    }, delay);
    this.openCodeStatusRefreshTimers.set(key, timer);
  }

  private async getWorkspaceBranch(workspacePath?: string): Promise<string | undefined> {
    if (!workspacePath) {
      return undefined;
    }

    try {
      const gitExtension = vscode.extensions.getExtension('vscode.git');
      if (!gitExtension) {
        return undefined;
      }

      const gitExports = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
      const gitApi = gitExports?.getAPI?.(1);
      const repositories = Array.isArray(gitApi?.repositories)
        ? gitApi.repositories as Array<{
            rootUri?: vscode.Uri;
            state?: { HEAD?: { name?: string } };
          }>
        : [];
      const repository = repositories.find((item) => item.rootUri?.fsPath === workspacePath) ??
        repositories.find((item) => {
          const rootPath = item.rootUri?.fsPath;
          return Boolean(rootPath && workspacePath.startsWith(`${rootPath}${path.sep}`));
        }) ??
        repositories[0];
      const branch = String(repository?.state?.HEAD?.name || '').trim();
      return branch || undefined;
    } catch {
      return undefined;
    }
  }

  private async handleAssistantRequest(message: AssistantWebviewRequest): Promise<void> {
    const cliId = this.resolveCliId(message);
    const profile = this.profilesById.get(cliId) ?? getCliProfile(cliId);
    if (!profile) {
      this.postError(cliId, runtimeT(this.locale, 'error.unknownProvider', { provider: cliId }));
      return;
    }

    const mode = normalizeMode(message.mode);
    const action = normalizeAction(message.action);
    const agentMode = getCliAgentMode(profile, message.agentMode ?? message.workflowMode);
    const modelOption = getCliModelOption(profile, message.model);
    const runtimeMode = getCliRuntimeMode(profile, message.runtime);
    const permissionMode = getCliPermissionMode(profile, message.permissionMode);
    const effectiveModel = effectiveCliModelSelection(modelOption, message.customModel, message.modelVariant);
    const apiProviderRuntime = resolveApiProviderRuntime(
      this.getApiProviderSettings(),
      cliId,
      process.env
    );
    const optionArgs = buildCliOptionArgs(profile, {
      model: modelOption.id,
      customModel: message.customModel,
      runtime: runtimeMode.id,
      permissionMode: permissionMode.id,
    });
    const optionKey = [
      agentMode.id,
      modelOption.id,
      modelOption.custom ? (message.customModel ?? '').trim() : '',
      runtimeMode.id,
      permissionMode.id,
      apiProviderRuntime.selectionKey,
    ].join('|');
    const userText =
      (message.text ?? '').trim() || runtimeDefaultActionText(this.locale, action);
    const contextOptions = this.resolveContextOptionsForAction(action, message.contextOptions);

    const snapshot = await this.contextCollector.collect(contextOptions, this.getContextLimits());
    const baseContextSummary: AssistantContextSummary = this.contextCollector.summarize(snapshot);
    const contextSummary = {
      ...baseContextSummary,
      tokenUsage: countContextTokens(snapshot, profile, effectiveModel.id),
    };
    if (actionRequiresActiveFile(action) && !snapshot.activeFile) {
      this.postError(cliId, runtimeT(this.locale, 'error.missingActiveFile'));
      return;
    }
    if (actionRequiresSelection(action) && !snapshot.selection) {
      this.postError(cliId, runtimeT(this.locale, 'error.missingSelection'));
      return;
    }

    const attachments = await this.attachmentStore.materialize(message.attachments);

    const prompt = buildAssistantPrompt({
      provider: { id: profile.id, name: profile.name },
      mode,
      agentMode: {
        id: agentMode.id,
        label: agentMode.label,
        instruction: agentMode.instruction,
      },
      runtime: {
        modelId: effectiveModel.id,
        modelLabel: effectiveModel.label,
        modelVariant: effectiveModel.variant,
        runtimeId: runtimeMode.id,
        runtimeLabel: runtimeMode.summaryLabel || runtimeMode.label,
        permissionModeId: permissionMode.id,
        permissionModeLabel: permissionMode.summaryLabel || permissionMode.label,
      },
      action,
      message: userText,
      attachments,
      conversationHistory: message.conversationHistory,
      context: snapshot,
      locale: this.locale,
    });

    let session = this.sessionController.active(cliId);
    const canReuseSession = this.sessionController.canReuse(session, agentMode.id, optionKey);

    if (!canReuseSession) {
      if (session) {
        this.sessionController.replace(cliId);
      }

      const agentArgs = [
        ...(agentMode.args ?? []),
        ...optionArgs,
      ];
      const newSession = await this.agentRuntime.startPrompt(
        cliId,
        profile.inputMode === 'argument' ? prompt : undefined,
        agentArgs,
        agentMode.id,
        optionKey,
        apiProviderRuntime.env
      );

      if (!newSession) {
        this.postError(
          cliId,
          runtimeT(this.locale, 'error.startFailed', { provider: profile.name })
        );
        return;
      }

      session = newSession;
      this.sessionController.register(session);
    }

    if (!session) {
      this.postError(cliId, runtimeT(this.locale, 'error.startFailed', { provider: profile.name }));
      return;
    }

    this.postToWebview({
      command: 'requestStarted',
      cliId,
      sessionId: session.id,
      text: userText,
      mode,
      agentMode: agentMode.id,
      agentModeLabel: agentMode.label,
      modelId: effectiveModel.id,
      modelLabel: effectiveModel.label,
      modelVariant: effectiveModel.variant,
      runtimeId: runtimeMode.id,
      runtimeLabel: runtimeMode.summaryLabel || runtimeMode.label,
      permissionModeId: permissionMode.id,
      permissionModeLabel: permissionMode.summaryLabel || permissionMode.label,
      action,
      actionLabel: runtimeActionLabel(this.locale, action),
      attachments,
      contextSummary,
      apiProviderWarning: this.formatApiProviderWarning(apiProviderRuntime),
    });
    this.sessionController.armNoOutputNotice(session);

    if (profile.inputMode === 'stdin') {
      const sent = this.agentRuntime.sendInput(session.id, prompt, !profile.keepStdinOpen);
      if (!sent) {
        this.postError(cliId, runtimeT(this.locale, 'error.sendFailed'));
      }
    }
  }

  private handleStop(cliId: string): void {
    this.sessionController.stop(cliId);
  }

  private async handleSessionInput(message: {
    cliId?: string;
    text?: string;
  }): Promise<void> {
    const cliId = this.resolveCliId(message);
    const text = String(message.text || '').trim();
    const result = this.sessionController.sendInput(cliId, text);

    await this.postToWebview({
      command: 'sessionInputResult',
      cliId,
      sessionId: result.session?.id,
      ok: result.ok,
    });
  }

  private formatApiProviderWarning(runtime: ApiProviderRuntimeConfig): string | undefined {
    const warning = runtime.warnings[0];
    if (!warning) {
      return undefined;
    }

    return runtimeT(this.locale, 'warning.apiProviderMissingKey', {
      provider: warning.providerName,
      envName: warning.envName,
    });
  }

  private clearOpenCodeStatusRefreshTimers(): void {
    for (const timer of this.openCodeStatusRefreshTimers.values()) {
      clearTimeout(timer);
    }
    this.openCodeStatusRefreshTimers.clear();
  }

  private async openProviderExtension(cliId: string): Promise<void> {
    const bridge = getProviderExtensionBridge(cliId);
    const profile = this.profilesById.get(cliId) ?? getCliProfile(cliId);
    if (!bridge) {
      if (profile) {
        await this.openProviderCliTerminal(profile);
        return;
      }
      vscode.window.showInformationMessage(runtimeT(this.locale, 'providerExtension.notConfigured', { provider: cliId }));
      return;
    }

    const extension = vscode.extensions.getExtension(bridge.extensionId);
    if (extension) {
      await extension.activate();
      for (const command of bridge.openCommands) {
        try {
          await vscode.commands.executeCommand(command);
          return;
        } catch {
          // Try the next public command exposed by the provider extension.
        }
      }
    }

    if (profile && this.profilesById.has(profile.id)) {
      await this.openProviderCliTerminal(profile);
      return;
    }

    vscode.window.showWarningMessage(
      runtimeT(this.locale, extension ? 'providerExtension.openFailed' : 'providerExtension.notInstalled', {
        extension: bridge.displayName,
      })
    );
    await vscode.commands.executeCommand('workbench.extensions.search', `@id:${bridge.extensionId}`);
  }

  private async openProviderCliTerminal(profile: CliProfile): Promise<void> {
    let entry = this.providerClientTerminals.get(profile.id);
    if (!entry) {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      const terminal = vscode.window.createTerminal({
        name: `Agents GUI Client: ${profile.name}`,
        cwd: workspaceFolder?.uri.fsPath,
      });
      entry = { terminal, started: false };
      this.providerClientTerminals.set(profile.id, entry);
    }

    entry.terminal.show();
    if (!entry.started) {
      entry.terminal.sendText(profile.command, true);
      entry.started = true;
    }
  }

  private async setOpenCodeModelVariant(modelId: unknown, variant: unknown): Promise<void> {
    const cleanModelId = typeof modelId === 'string' ? modelId.trim() : '';
    const cleanVariant = typeof variant === 'string' ? variant.trim() : '';
    if (
      !cleanModelId
      || !cleanModelId.includes('/')
      || /[\r\n]/.test(cleanModelId)
      || !cleanVariant
      || !/^[A-Za-z0-9_.-]+$/.test(cleanVariant)
    ) {
      return;
    }

    await this.openCodeLocalState.updateModelVariant(cleanModelId, cleanVariant);
  }

  private async copyMessageText(messageText: unknown): Promise<void> {
    const text = typeof messageText === 'string' ? messageText.trim() : '';
    if (!text) {
      return;
    }
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage(runtimeT(this.locale, 'notification.messageCopied'));
  }

  private async saveSelectionState(message: unknown): Promise<void> {
    if (!this.state || !message || typeof message !== 'object') {
      return;
    }

    const payload = message as {
      activeProviderId?: unknown;
      activeAgentModeByProvider?: unknown;
      recentModelByProvider?: unknown;
      favoriteModelByProvider?: unknown;
      disabledMcpByProvider?: unknown;
      customModelByProvider?: unknown;
      activeRuntimeByProvider?: unknown;
      activePermissionByProvider?: unknown;
      contextOptions?: unknown;
      claudeTerminalBannerDismissed?: unknown;
      taskBoardDismissed?: unknown;
    };
    const providerId = typeof payload.activeProviderId === 'string' ? payload.activeProviderId : '';
    if (providerId && getCliProfile(providerId)) {
      await this.state.update(LAST_PROVIDER_STATE_KEY, providerId);
      await vscode.commands.executeCommand('setContext', 'agents-gui.activeProvider', providerId);
    }

    await this.state.update(
      AGENT_MODE_STATE_KEY,
      this.normalizeAgentModeState(payload.activeAgentModeByProvider)
    );
    await this.state.update(RECENT_MODEL_STATE_KEY, normalizeStringRecord(payload.recentModelByProvider));
    await this.state.update(FAVORITE_MODEL_STATE_KEY, normalizeStringRecord(payload.favoriteModelByProvider));
    await this.state.update(DISABLED_MCP_STATE_KEY, normalizeStringArrayRecord(payload.disabledMcpByProvider));
    await this.state.update(CUSTOM_MODEL_STATE_KEY, normalizeStringRecord(payload.customModelByProvider));
    await this.state.update(RUNTIME_STATE_KEY, normalizeStringRecord(payload.activeRuntimeByProvider));
    await this.state.update(PERMISSION_STATE_KEY, normalizeStringRecord(payload.activePermissionByProvider));
    await this.state.update(CONTEXT_OPTIONS_STATE_KEY, normalizeContextOptions(payload.contextOptions));
    await this.state.update(CLAUDE_TERMINAL_BANNER_STATE_KEY, payload.claudeTerminalBannerDismissed === true);
    await this.state.update(TASK_BOARD_DISMISSED_STATE_KEY, payload.taskBoardDismissed === true);
  }

  private normalizeAgentModeState(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const result: Record<string, string> = {};
    for (const [providerId, modeId] of Object.entries(value)) {
      if (typeof providerId !== 'string' || typeof modeId !== 'string') {
        continue;
      }
      if (usesProviderNativeAgentConfig(providerId)) {
        continue;
      }
      const profile = this.profilesById.get(providerId) ?? getCliProfile(providerId);
      const mode = profile?.agentModes.find((item) => item.id === modeId && !item.disabled);
      if (mode) {
        result[providerId] = modeId;
      }
    }
    return result;
  }

  private getStoredStringRecord(key: string): Record<string, string> {
    return normalizeStringRecord(this.state?.get<Record<string, string>>(key, {}));
  }

  private getStoredStringArrayRecord(key: string): Record<string, string[]> {
    return normalizeStringArrayRecord(this.state?.get<Record<string, string[]>>(key, {}));
  }

  private getStoredContextOptions(): Partial<AssistantContextOptions> {
    return normalizeContextOptions(this.state?.get<Partial<AssistantContextOptions>>(CONTEXT_OPTIONS_STATE_KEY, {}));
  }

  private resolveCliId(message: { cliId?: string; providerId?: string }): string {
    return message.cliId ?? message.providerId ?? this.getDefaultCliId();
  }

  private getDefaultCliId(): string {
    const configured = vscode.workspace
      .getConfiguration('agents-gui')
      .get<string>('defaultProvider', DEFAULT_CLI_ID);

    if (configured && getCliProfile(configured)) {
      return configured;
    }

    return getCliProfile(DEFAULT_CLI_ID)?.id ?? CLI_PROFILES[0]?.id ?? DEFAULT_CLI_ID;
  }

  private resolveContextOptions(
    overrides: Partial<AssistantContextOptions> = {}
  ): AssistantContextOptions {
    const config = vscode.workspace.getConfiguration('agents-gui.context');
    return {
      includeWorkspace: config.get<boolean>('includeWorkspace', true),
      includeCurrentFile: config.get<boolean>('includeCurrentFile', true),
      includeSelection: config.get<boolean>('includeSelection', true),
      includeDiagnostics: config.get<boolean>('includeDiagnostics', true),
      ...overrides,
    };
  }

  private resolveContextOptionsForAction(
    action: AssistantActionId,
    overrides: Partial<AssistantContextOptions> = {}
  ): AssistantContextOptions {
    const options = this.resolveContextOptions(overrides);
    if (actionRequiresActiveFile(action)) {
      options.includeCurrentFile = true;
    }

    return options;
  }

  private getContextLimits() {
    const config = vscode.workspace.getConfiguration('agents-gui.context');
    return {
      maxFileChars: config.get<number>('maxFileChars', 12000),
      maxSelectionChars: config.get<number>('maxSelectionChars', 8000),
      maxDiagnostics: config.get<number>('maxDiagnostics', 12),
    };
  }

  private postError(cliId: string, text: string): void {
    this.postToWebview({
      command: 'error',
      cliId,
      text,
    });
  }

  private registerDevelopmentWebviewWatcher(): void {
    if (this.extensionMode !== vscode.ExtensionMode.Development) {
      return;
    }

    const pattern = new vscode.RelativePattern(
      this.extensionUri,
      'media/{main.html,main.css,main.js,i18n.js,messageText.js,messageChoices.js,providerRunState.js,providerCapabilities.js,conversationStore.js,sessionHistory.js,slashCommands.js,openCodeDialogState.js,claudeActions.js,inlineMarkdown.js,workbenchLayout.js,taskBoardState.js,composerState.js,providerOptions.js}'
    );
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const scheduleReload = () => this.scheduleWebviewReloadForDevelopment();

    this.disposables.push(
      watcher,
      watcher.onDidChange(scheduleReload),
      watcher.onDidCreate(scheduleReload),
      watcher.onDidDelete(scheduleReload)
    );
  }

  private scheduleWebviewReloadForDevelopment(): void {
    if (this.webviewReloadTimer) {
      clearTimeout(this.webviewReloadTimer);
    }

    this.webviewReloadTimer = setTimeout(() => {
      this.webviewReloadTimer = undefined;
      this.reloadWebviewForDevelopment();
    }, 120);
  }

  private reloadWebviewForDevelopment(): void {
    if (!this.view) {
      return;
    }

    this.webviewAssetVersion = Date.now();
    this.view.webview.html = this.getHtml(this.view.webview);
    void this.sendProfiles();
    void this.sendContextSummary();
  }

  private getWebviewUri(webview: vscode.Webview, ...paths: string[]): string {
    const uri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...paths)).toString();
    const separator = uri.includes('?') ? '&' : '?';
    return `${uri}${separator}v=${this.webviewAssetVersion}`;
  }

  private getProviderIconUris(providerId: string) {
    const iconPaths = PROVIDER_ICON_PATHS[providerId as keyof typeof PROVIDER_ICON_PATHS];
    if (!iconPaths || !this.view) {
      return undefined;
    }

    return {
      light: this.getWebviewUri(this.view.webview, ...iconPaths.light.split('/')),
      dark: this.getWebviewUri(this.view.webview, ...iconPaths.dark.split('/')),
    };
  }

  private getHtml(webview: vscode.Webview): string {
    return renderWebviewHtml({ extensionUri: this.extensionUri, webview, locale: this.locale });
  }

  dispose(options: { disposeContextCollector?: boolean } = {}): void {
    if (this.webviewReloadTimer) {
      clearTimeout(this.webviewReloadTimer);
      this.webviewReloadTimer = undefined;
    }
    this.sessionController.dispose();
    this.clearOpenCodeStatusRefreshTimers();
    this.openCodeStatusRefreshAttempts.clear();
    this.providerClientTerminals.clear();
    if (options.disposeContextCollector) {
      this.contextCollector.dispose();
    }
    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables = [];
    this.view = undefined;
  }
}

function normalizeMode(mode?: AssistantMode): AssistantMode {
  return 'agent';
}

function normalizeAction(action?: AssistantActionId): AssistantActionId {
  switch (action) {
    case 'explainSelection':
    case 'reviewFile':
    case 'generateTests':
    case 'refactorSelection':
    case 'freeform':
      return action;
    default:
      return 'freeform';
  }
}

function preferredReadOnlyMode(profile?: CliProfile): string | undefined {
  if (!profile) {
    return undefined;
  }

  const mode = profile.agentModes.find((item) => item.id === 'plan')
    ?? profile.agentModes.find((item) => item.id === 'suggest');
  return mode?.id;
}

function preferredReadOnlyPermission(profile?: CliProfile): string | undefined {
  if (!profile) {
    return undefined;
  }

  const mode = profile.permissionModes?.find((item) => item.id === 'readOnly')
    ?? profile.permissionModes?.find((item) => item.id === 'plan');
  return mode?.id;
}

function effectiveCliModelSelection(
  model: CliModelOption,
  customModel: string | undefined,
  modelVariant?: string
): { id: string; label: string; variant?: string } {
  const customId = model.custom ? String(customModel || '').trim() : '';
  const id = customId || model.configuredModelId || model.id;
  const variant = sanitizeModelVariant(modelVariant) ?? sanitizeModelVariant(model.variant);
  const baseLabel = model.custom && customId
    ? customId
    : model.summaryLabel || model.label || id;
  const label = variant && !baseLabel.includes(`· ${variant}`)
    ? `${baseLabel} · ${variant}`
    : baseLabel;
  return { id, label, ...(variant ? { variant } : {}) };
}

function sanitizeModelVariant(value: string | undefined): string | undefined {
  const variant = String(value || '').trim();
  return /^[A-Za-z0-9_.-]+$/.test(variant) ? variant : undefined;
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof key === 'string' && typeof rawValue === 'string') {
      result[key] = rawValue;
    }
  }
  return result;
}

function normalizeStringArrayRecord(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string[]> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof key === 'string' && Array.isArray(rawValue)) {
      result[key] = rawValue.filter((item): item is string => typeof item === 'string');
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
  for (const key of ['includeWorkspace', 'includeCurrentFile', 'includeSelection', 'includeDiagnostics'] as const) {
    if (typeof record[key] === 'boolean') {
      result[key] = record[key];
    }
  }
  return result;
}

function usesProviderNativeAgentConfig(providerId: string): boolean {
  return providerId === 'opencode';
}
