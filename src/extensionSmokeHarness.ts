import * as vscode from 'vscode';
import type { AgentRuntime, AgentSession } from './agentRuntime';
import type {
  AssistantContextOptions,
  AssistantContextSnapshot,
  AssistantContextSummary,
} from './assistantTypes';
import type { AgentRunEvent } from './cliManager';
import { getCliProfile, type CliProfile } from './cliProfiles';
import { SidebarProvider } from './sidebarProvider';
import type { HostToWebviewMessage, WebviewToHostMessage } from './webviewProtocol';

export interface ExtensionSmokeProbeResult {
  ok: boolean;
  postedCommands: string[];
  startedPrompts: number;
  sentInputs: number;
  stoppedSessions: string[];
  stopAllCount: number;
  outputTexts: string[];
  missing: string[];
}

export async function runExtensionSmokeProbe(
  extensionUri: vscode.Uri,
  options: { storageUri?: vscode.Uri } = {}
): Promise<ExtensionSmokeProbeResult> {
  const runtime = new SmokeAgentRuntime();
  const contextCollector = new SmokeContextCollector();
  const postedMessages: HostToWebviewMessage[] = [];
  const webview = createSmokeWebview(postedMessages);
  const provider = new SidebarProvider(extensionUri, runtime, {
    contextCollector: contextCollector as never,
    extensionMode: vscode.ExtensionMode.Test,
    state: new SmokeMemento() as never,
    storageUri: options.storageUri,
  });

  try {
    provider.resolveWebviewView(
      webview.view as never,
      {} as vscode.WebviewViewResolveContext,
      new vscode.CancellationTokenSource().token
    );
    await webview.receive({ command: 'checkProfiles' });
    await waitFor(
      () => postedMessages.some((message) => message.command === 'profiles'),
      'profiles'
    );

    await webview.receive({ command: 'checkProfiles' });
    await webview.receive({
      command: 'refreshContext',
      requestId: 'smoke-context-1',
      cliId: 'opencode',
      modelId: 'mimo/mimo-v2.5-pro',
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
      () =>
        postedMessages.some(
          (message) => message.command === 'output' && message.text.includes('smoke reply')
        ),
      'streamed output'
    );

    await webview.receive({
      command: 'send',
      cliId: 'opencode',
      mode: 'agent',
      action: 'freeform',
      text: 'smoke follow-up',
      conversationHistory: [
        { role: 'user', text: 'smoke send' },
        { role: 'assistant', text: 'smoke reply' },
      ],
      contextOptions: defaultContextOptions(),
    });
    await webview.receive({ command: 'stop', cliId: 'opencode' });
    provider.stopAll();
  } finally {
    provider.dispose({ disposeContextCollector: true });
  }

  const postedCommands: string[] = postedMessages.map((message) => message.command);
  const outputTexts = postedMessages
    .filter(
      (message): message is Extract<HostToWebviewMessage, { command: 'output' }> =>
        message.command === 'output'
    )
    .map((message) => message.text);
  const requiredCommands: string[] = [
    'profiles',
    'contextSummary',
    'requestStarted',
    'output',
    'stopped',
  ];
  const missing = requiredCommands.filter((command) => !postedCommands.includes(command));
  const correlatedContextSummary = postedMessages.some(
    (message) =>
      message.command === 'contextSummary' &&
      message.requestId === 'smoke-context-1' &&
      message.cliId === 'opencode' &&
      message.modelId === 'mimo/mimo-v2.5-pro'
  );
  if (!correlatedContextSummary) {
    missing.push('correlated context summary');
  }
  if (runtime.startedPrompts.length !== 2) {
    missing.push('two startPrompt calls');
  }
  if (!runtime.stoppedSessions.some((sessionId) => sessionId.startsWith('smoke-opencode-'))) {
    missing.push('stop call');
  }
  const followUpPrompt = runtime.startedPrompts[1]?.initialInput ?? '';
  if (
    !followUpPrompt.includes('User: smoke send') ||
    !followUpPrompt.includes('Assistant: smoke reply')
  ) {
    missing.push('follow-up prompt history');
  }

  return {
    ok: missing.length === 0,
    postedCommands,
    startedPrompts: runtime.startedPrompts.length,
    sentInputs: runtime.sentInputs.length,
    stoppedSessions: runtime.stoppedSessions,
    stopAllCount: runtime.stopAllCount,
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
    options?: { cwd?: string };
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
    options?: { cwd?: string }
  ): Promise<AgentSession | null> {
    if (cliId !== this.profile.id) {
      return null;
    }

    const id = `smoke-opencode-${++this.nextSession}`;
    const onEvent = new vscode.EventEmitter<AgentRunEvent>();
    const session: AgentSession = {
      id,
      cliId,
      profile: this.profile,
      process: { exitCode: null, killed: false } as never,
      onOutput: new vscode.EventEmitter<string>(),
      onStderr: new vscode.EventEmitter<string>(),
      onError: new vscode.EventEmitter<string>(),
      onEnd: new vscode.EventEmitter<number>(),
      onEvent,
    };

    this.startedPrompts.push({ cliId, initialInput, options });
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
      transport: 'process',
    });
  }

  lastSessionId(): string | undefined {
    return Array.from(this.sessions.keys()).at(-1);
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
    return this.values.has(key) ? (this.values.get(key) as T) : defaultValue;
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
