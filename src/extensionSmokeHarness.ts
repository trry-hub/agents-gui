import * as vscode from 'vscode';
import type { AgentRuntime, AgentSession } from './agentRuntime';
import type {
  AssistantContextOptions,
  AssistantContextSnapshot,
  AssistantContextSummary,
  AssistantOpenCodeNativeCommand,
  AssistantOpenCodeNativeCommandResult,
  AssistantOpenCodeStatus,
} from './assistantTypes';
import type { AgentRunEvent } from './cliManager';
import { getCliProfile, type CliProfile } from './cliProfiles';
import type { OpenCodeAgentCapability } from './openCodeAgentCapability';
import { SidebarProvider } from './sidebarProvider';
import type { HostToWebviewMessage, WebviewToHostMessage } from './webviewProtocol';

export interface ExtensionSmokeProbeResult {
  ok: boolean;
  postedCommands: string[];
  startedPrompts: number;
  sentInputs: number;
  stoppedSessions: string[];
  stopAllCount: number;
  nativeCommands: AssistantOpenCodeNativeCommand[];
  outputTexts: string[];
  missing: string[];
}

export async function runExtensionSmokeProbe(
  extensionUri: vscode.Uri,
  options: { storageUri?: vscode.Uri } = {}
): Promise<ExtensionSmokeProbeResult> {
  const runtime = new SmokeAgentRuntime();
  const openCodeCapability = new SmokeOpenCodeCapability();
  const contextCollector = new SmokeContextCollector();
  const postedMessages: HostToWebviewMessage[] = [];
  const webview = createSmokeWebview(postedMessages);
  const provider = new SidebarProvider(extensionUri, runtime, {
    contextCollector: contextCollector as never,
    extensionMode: vscode.ExtensionMode.Test,
    openCodeCapability,
    state: new SmokeMemento() as never,
    storageUri: options.storageUri,
  });

  try {
    provider.resolveWebviewView(
      webview.view as never,
      {} as vscode.WebviewViewResolveContext,
      new vscode.CancellationTokenSource().token
    );
    await waitFor(() => postedMessages.some((message) => message.command === 'profiles'), 'profiles');

    await webview.receive({ command: 'checkProfiles' });
    await webview.receive({
      command: 'refreshContext',
      cliId: 'opencode',
      contextOptions: defaultContextOptions(),
    });
    await webview.receive({
      command: 'send',
      cliId: 'opencode',
      mode: 'agent',
      action: 'freeform',
      text: 'smoke send',
      contextOptions: defaultContextOptions(),
    });

    const sessionId = runtime.lastSessionId();
    if (!sessionId) {
      throw new Error('Smoke runtime did not create a session.');
    }

    runtime.emitOutput(sessionId, openCodeTextDelta('smoke reply'));
    await waitFor(
      () => postedMessages.some((message) => message.command === 'output' && message.text.includes('smoke reply')),
      'streamed output'
    );

    await webview.receive({ command: 'sendSessionInput', cliId: 'opencode', text: 'smoke follow-up' });
    await webview.receive({ command: 'openCodeNativeCommand', nativeCommand: 'compact', openCodeSessionId: 'ses_smoke' });
    await webview.receive({ command: 'stop', cliId: 'opencode' });
    provider.stopAll();
  } finally {
    provider.dispose({ disposeContextCollector: true });
  }

  const postedCommands: string[] = postedMessages.map((message) => message.command);
  const outputTexts = postedMessages
    .filter((message): message is Extract<HostToWebviewMessage, { command: 'output' }> => message.command === 'output')
    .map((message) => message.text);
  const requiredCommands: string[] = [
    'profiles',
    'contextSummary',
    'requestStarted',
    'output',
    'sessionInputResult',
    'openCodeNativeCommandResult',
    'stopped',
  ];
  const missing = requiredCommands.filter((command) => !postedCommands.includes(command));
  if (runtime.startedPrompts.length !== 1) {
    missing.push('single startPrompt call');
  }
  if (runtime.sentInputs.length !== 1) {
    missing.push('sendSessionInput call');
  }
  if (!runtime.stoppedSessions.some((sessionId) => sessionId.startsWith('smoke-opencode-'))) {
    missing.push('stop call');
  }
  if (!openCodeCapability.nativeCommands.includes('compact')) {
    missing.push('OpenCode native command');
  }

  return {
    ok: missing.length === 0,
    postedCommands,
    startedPrompts: runtime.startedPrompts.length,
    sentInputs: runtime.sentInputs.length,
    stoppedSessions: runtime.stoppedSessions,
    stopAllCount: runtime.stopAllCount,
    nativeCommands: openCodeCapability.nativeCommands,
    outputTexts,
    missing,
  };
}

function defaultContextOptions(): AssistantContextOptions {
  return {
    includeWorkspace: true,
    includeCurrentFile: true,
    includeSelection: false,
    includeDiagnostics: true,
  };
}

function openCodeTextDelta(text: string): string {
  return `${JSON.stringify({
    type: 'message.part.delta',
    properties: {
      part: { id: 'prt_smoke', type: 'text' },
      delta: text,
    },
  })}\n`;
}

class SmokeAgentRuntime implements AgentRuntime {
  readonly startedPrompts: Array<{
    cliId: string;
    initialInput?: string;
    agentArgs: string[];
    agentModeId?: string;
    optionKey?: string;
  }> = [];
  readonly sentInputs: Array<{ sessionId: string; text: string; closeAfterWrite?: boolean }> = [];
  readonly stoppedSessions: string[] = [];
  stopAllCount = 0;

  private readonly profile: CliProfile;
  private readonly sessions = new Map<string, AgentSession>();
  private readonly eventEmitters = new Map<string, vscode.EventEmitter<AgentRunEvent>>();
  private nextSession = 0;

  constructor() {
    const profile = getCliProfile('opencode');
    if (!profile) {
      throw new Error('OpenCode profile is required for extension smoke tests.');
    }
    this.profile = {
      ...profile,
      installed: true,
      version: 'smoke',
    };
  }

  async checkInstalled(profileId: string): Promise<boolean> {
    return profileId === this.profile.id;
  }

  async getProfilesWithStatus(): Promise<CliProfile[]> {
    return [this.profile];
  }

  async startPrompt(
    cliId: string,
    initialInput?: string,
    agentArgs: string[] = [],
    agentModeId?: string,
    optionKey?: string
  ): Promise<AgentSession | null> {
    if (cliId !== this.profile.id) {
      return null;
    }

    const id = `smoke-opencode-${++this.nextSession}`;
    const onEvent = new vscode.EventEmitter<AgentRunEvent>();
    const session: AgentSession = {
      id,
      cliId,
      agentModeId,
      optionKey,
      profile: this.profile,
      process: { exitCode: null, killed: false } as never,
      onOutput: new vscode.EventEmitter<string>(),
      onStderr: new vscode.EventEmitter<string>(),
      onError: new vscode.EventEmitter<string>(),
      onEnd: new vscode.EventEmitter<number>(),
      onEvent,
      openCodeSessionId: 'ses_smoke',
    };

    this.startedPrompts.push({ cliId, initialInput, agentArgs, agentModeId, optionKey });
    this.sessions.set(id, session);
    this.eventEmitters.set(id, onEvent);
    return session;
  }

  sendInput(sessionId: string, text: string, closeAfterWrite?: boolean): boolean {
    if (!this.sessions.has(sessionId)) {
      return false;
    }
    this.sentInputs.push({ sessionId, text, closeAfterWrite });
    return true;
  }

  stop(sessionId: string): void {
    this.stoppedSessions.push(sessionId);
    const session = this.sessions.get(sessionId);
    if (session) {
      (session.process as { exitCode: number | null; killed: boolean }).exitCode = -1;
      (session.process as { exitCode: number | null; killed: boolean }).killed = true;
    }
    this.sessions.delete(sessionId);
  }

  stopAll(): void {
    this.stopAllCount += 1;
    for (const sessionId of this.sessions.keys()) {
      this.stop(sessionId);
    }
  }

  emitOutput(sessionId: string, text: string): void {
    this.eventEmitters.get(sessionId)?.fire({
      type: 'output',
      text,
      stream: 'stdout',
      transport: 'sse',
      openCodeSessionId: 'ses_smoke',
    });
  }

  lastSessionId(): string | undefined {
    return Array.from(this.sessions.keys()).at(-1);
  }
}

class SmokeOpenCodeCapability implements OpenCodeAgentCapability {
  readonly nativeCommands: AssistantOpenCodeNativeCommand[] = [];

  async runPrompt(): Promise<string> {
    return 'smoke reply';
  }

  async getStatus(): Promise<AssistantOpenCodeStatus> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    return {
      project: { id: 'smoke-project', worktree: workspaceRoot, vcs: 'git' },
      mcpServers: [{ name: 'smoke', status: 'connected' }],
      lspServers: [{ name: 'typescript', status: 'running' }],
    };
  }

  async executeNativeCommand(
    command: AssistantOpenCodeNativeCommand,
    sessionId: string | undefined
  ): Promise<AssistantOpenCodeNativeCommandResult> {
    this.nativeCommands.push(command);
    return {
      command,
      ok: true,
      message: sessionId ? `smoke ${command} ok` : `smoke ${command} ok without session`,
    };
  }

  async deleteSession(): Promise<boolean> {
    return true;
  }
}

class SmokeContextCollector {
  async collect(options: AssistantContextOptions): Promise<AssistantContextSnapshot> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const rootPath = workspaceFolder?.uri.fsPath ?? process.cwd();
    const snapshot: AssistantContextSnapshot = { diagnostics: [] };

    if (options.includeWorkspace) {
      snapshot.workspace = {
        name: workspaceFolder?.name ?? 'agents-gui-smoke',
        rootPath,
        activeFolderName: workspaceFolder?.name,
        activeFolderRootPath: rootPath,
        folders: [{ name: workspaceFolder?.name ?? 'agents-gui-smoke', rootPath, active: true }],
      };
    }

    if (options.includeCurrentFile) {
      snapshot.activeFile = {
        relativePath: 'README.md',
        languageId: 'markdown',
        lineCount: 1,
        text: '# Agents GUI smoke fixture\n',
        truncated: false,
      };
    }

    return snapshot;
  }

  summarize(snapshot: AssistantContextSnapshot): AssistantContextSummary {
    return {
      workspace: snapshot.workspace?.name,
      workspacePath: snapshot.workspace?.rootPath,
      workspaceFolders: snapshot.workspace?.folders,
      activeFile: snapshot.activeFile?.relativePath,
      diagnostics: snapshot.diagnostics.length,
    };
  }

  dispose(): void {}
}

class SmokeMemento {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.values.has(key) ? this.values.get(key) as T : defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.values.delete(key);
      return;
    }
    this.values.set(key, value);
  }
}

function createSmokeWebview(postedMessages: HostToWebviewMessage[]) {
  let messageHandler: ((message: WebviewToHostMessage) => Promise<void>) | undefined;

  return {
    view: {
      webview: {
        options: {},
        html: '',
        cspSource: 'vscode-resource:',
        asWebviewUri: (uri: vscode.Uri) => uri,
        postMessage: (message: HostToWebviewMessage) => {
          postedMessages.push(message);
          return Promise.resolve(true);
        },
        onDidReceiveMessage: (handler: (message: WebviewToHostMessage) => Promise<void>) => {
          messageHandler = handler;
          return new vscode.Disposable(() => {
            messageHandler = undefined;
          });
        },
      },
      show: () => {},
      onDidDispose: () => new vscode.Disposable(() => {}),
    },
    receive: async (message: WebviewToHostMessage) => {
      if (!messageHandler) {
        throw new Error('Smoke webview did not register a message handler.');
      }
      await messageHandler(message);
      await settle();
    },
  };
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await settle();
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
