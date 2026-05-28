import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type {
  AssistantLspServerStatus,
  AssistantMcpServerStatus,
  AssistantOpenCodeNativeCommand,
  AssistantOpenCodeNativeCommandResult,
  AssistantOpenCodeProject,
  AssistantOpenCodeStatus,
} from './assistantTypes';
import { CliAgentMode, CliModelOption, CliProfile, getCliProfile } from './cliProfiles';
import {
  buildCliLookupPath,
  getLoginShellLookupArgs,
  mergePathEntries,
  normalizeCommandPathOutput,
} from './cliPathResolver';
import {
  OpenCodeAgentDiscovery,
  parseOpenCodeDebugConfigOutput,
  parseOpenCodeAgentListLine,
  parseOpenCodeModelId,
  parseOpenCodeModelsOutput,
  parseOpenCodeProviderModels,
} from './opencodeAgents';
import { normalizeCliOutput } from './outputFormatter';

export type AgentRunTransport = 'process' | 'sse';
export type AgentRunOutputStream = 'stdout' | 'stderr';

export type AgentRunEvent =
  | {
      type: 'output';
      text: string;
      stream: AgentRunOutputStream;
      transport: AgentRunTransport;
      openCodeSessionId?: string;
    }
  | {
      type: 'error';
      message: string;
    }
  | {
      type: 'end';
      exitCode: number;
      openCodeSessionId?: string;
    };

export interface Session {
  id: string;
  cliId: string;
  agentModeId?: string;
  optionKey?: string;
  profile: CliProfile;
  process: ChildProcess;
  openCodeSessionId?: string;
  onOutput: vscode.EventEmitter<string>;
  onStderr: vscode.EventEmitter<string>;
  onError: vscode.EventEmitter<string>;
  onEnd: vscode.EventEmitter<number>;
  onEvent: vscode.EventEmitter<AgentRunEvent>;
  eventStream?: OpenCodeEventStream;
}

interface BackgroundServerState {
  process?: ChildProcess;
  starting?: Promise<boolean>;
}

interface ResolvedBackgroundServer {
  key: string;
  url: string;
  args: string[];
  attachArgs: string[];
  host: string;
  port: number;
}

interface StartPromptOptions {
  attachBackgroundServer?: boolean;
}

const OPEN_CODE_PROMPT_FALLBACK_POLL_INTERVAL_MS = 1000;
const OPEN_CODE_PROMPT_TIMEOUT_MS = 90_000;
const OPEN_CODE_REQUEST_TIMEOUT_MS = 30_000;
const OPEN_CODE_SERVER_READY_TIMEOUT_MS = 20_000;
const PROCESS_TERMINATE_GRACE_MS = 1500;

interface OpenCodeEventStream {
  close(): void;
  failed(): boolean;
  hasOutput(): boolean;
  setSessionId(sessionId: string): void;
  sessionId(): string | undefined;
}

interface OpenCodeSseConnection {
  close(): void;
  failed(): boolean;
  ready: Promise<boolean>;
  onEvent(handler: (event: Record<string, unknown>, block: string) => void): vscode.Disposable;
}

interface OpenCodePromptEventStream {
  close(): void;
  error(): string | undefined;
  failed(): boolean;
  ready: Promise<boolean>;
  completed: Promise<void>;
  outputText(): string;
}

export class CliManager {
  private sessions = new Map<string, Session>();
  private counters = new Map<string, number>();
  private commandPathCache = new Map<string, string>();
  private backgroundServers = new Map<string, BackgroundServerState>();
  private forceKillTimers = new WeakMap<ChildProcess, NodeJS.Timeout>();

  getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.[0]?.uri.fsPath ?? process.env.HOME ?? '/';
  }

  async checkInstalled(profileId: string): Promise<boolean> {
    const profile = getCliProfile(profileId);
    if (!profile) { return false; }

    return Boolean(await this.resolveCommandPath(profile.command));
  }

  private async resolveCommandPath(command: string): Promise<string | undefined> {
    const cached = this.commandPathCache.get(command);
    if (cached) {
      if (await this.isUsableCommandPath(cached)) {
        return cached;
      }
      this.commandPathCache.delete(command);
    }

    const directPath = await this.lookupCommandInPath(command);
    const usableDirectPath = await this.cacheUsableCommandPath(command, directPath);
    if (usableDirectPath) {
      return usableDirectPath;
    }

    if (process.platform === 'win32') {
      return undefined;
    }

    const shellPath = process.env.SHELL || '/bin/zsh';
    const shellPathResult = await this.lookupCommandInLoginShell(command, shellPath);
    const usableShellPath = await this.cacheUsableCommandPath(command, shellPathResult);
    if (usableShellPath) {
      return usableShellPath;
    }

    return undefined;
  }

  private async cacheUsableCommandPath(
    command: string,
    commandPath: string | undefined
  ): Promise<string | undefined> {
    if (!commandPath || !(await this.isUsableCommandPath(commandPath))) {
      return undefined;
    }

    this.commandPathCache.set(command, commandPath);
    return commandPath;
  }

  private async isUsableCommandPath(commandPath: string): Promise<boolean> {
    try {
      await fs.promises.access(commandPath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  private lookupCommandInPath(command: string): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
      const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
      const proc = spawn(lookupCommand, [command], {
        env: {
          ...process.env,
          PATH: buildCliLookupPath(process.env.PATH, process.env.HOME),
        },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let output = '';
      proc.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });
      proc.on('close', (code) => {
        resolve(code === 0 ? normalizeCommandPathOutput(output) : undefined);
      });
      proc.on('error', () => {
        resolve(undefined);
      });
    });
  }

  private lookupCommandInLoginShell(
    command: string,
    shellPath: string
  ): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
      const proc = spawn(shellPath, getLoginShellLookupArgs(command, shellPath), {
        env: process.env,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let output = '';
      proc.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });
      proc.on('close', (code) => {
        resolve(code === 0 ? normalizeCommandPathOutput(output) : undefined);
      });
      proc.on('error', () => {
        resolve(undefined);
      });
    });
  }

  async getProfilesWithStatus(): Promise<CliProfile[]> {
    const { CLI_PROFILES } = await import('./cliProfiles');
    const results = await Promise.all(
      CLI_PROFILES.map(async (p) => {
        const installed = await this.checkInstalled(p.id);
        let profile: CliProfile = {
          ...p,
          installed,
          version: installed ? await this.getCommandVersion(p) : undefined,
        };

        if (installed && p.id === 'opencode') {
          const command = await this.resolveCommandPath(p.command);
          let discovery: OpenCodeAgentDiscovery = { modes: [] };
          let discoveredModels: CliModelOption[] = [];
          if (command) {
            [discovery, discoveredModels] = await Promise.all([
              this.getOpenCodeAgentModes(command),
              this.getOpenCodeModelOptions(command),
            ]);
          }
          const agentModes = discovery.modes;
          if (agentModes.length > 0) {
            profile = {
              ...profile,
              agentModes,
              defaultAgentMode: preferredOpenCodeDefaultAgent(
                agentModes,
                discovery.defaultAgentId ?? profile.defaultAgentMode
              ),
            };
          }
          if (discoveredModels.length > 0) {
            const modelOptions = mergeOpenCodeModelOptions(profile.modelOptions ?? [], discoveredModels);
            profile = {
              ...profile,
              modelOptions,
              defaultModel: preferredOpenCodeDefaultModel(
                modelOptions,
                discovery.defaultModelId ?? profile.defaultModel
              ),
            };
          }
        }

        return profile;
      })
    );
    return results;
  }

  private async getOpenCodeAgentModes(command: string): Promise<OpenCodeAgentDiscovery> {
    const cwd = this.getWorkspaceRoot();
    const discovery = await this.getOpenCodeAgentModesFromDebugConfig(command, cwd);
    if (discovery.modes.length > 0) {
      return {
        ...discovery,
        modes: mergeOpenCodeAgentModes(
          discovery.modes,
          await this.getOpenCodeAgentModesFromCliList(command, cwd)
        ),
      };
    }

    return {
      modes: await this.getOpenCodeAgentModesFromCliList(command, cwd),
    };
  }

  private getOpenCodeAgentModesFromDebugConfig(
    command: string,
    cwd: string
  ): Promise<OpenCodeAgentDiscovery> {
    return new Promise<OpenCodeAgentDiscovery>((resolve) => {
      const commandDir = path.isAbsolute(command) ? path.dirname(command) : undefined;
      const env = {
        ...process.env,
        PATH: mergePathEntries([
          commandDir,
          buildCliLookupPath(process.env.PATH, process.env.HOME),
        ]),
        OPENCODE_DB: path.join(
          os.tmpdir(),
          `agents-gui-opencode-debug-config-${stableHash(cwd).toString(16)}-${process.pid}.db`
        ),
        OMO_DISABLE_POSTHOG: '1',
        OMO_SEND_ANONYMOUS_TELEMETRY: '0',
      };
      const proc = spawn(command, ['debug', 'config'], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let output = '';
      let settled = false;
      const finish = (discovery: OpenCodeAgentDiscovery = { modes: [] }) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        resolve(discovery);
      };

      const timeout = setTimeout(() => {
        try {
          proc.kill('SIGTERM');
        } catch {
          // Process may already be gone.
        }
        finish();
      }, 5000);

      proc.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
        if (output.length > 2_000_000) {
          try {
            proc.kill('SIGTERM');
          } catch {
            // Process may already be gone.
          }
          finish();
        }
      });
      proc.on('close', () => {
        finish(parseOpenCodeDebugConfigOutput(output));
      });
      proc.on('error', () => finish());
    });
  }

  private getOpenCodeAgentModesFromCliList(command: string, cwd: string): Promise<CliAgentMode[]> {
    return new Promise<CliAgentMode[]>((resolve) => {
      const commandDir = path.isAbsolute(command) ? path.dirname(command) : undefined;
      const env = {
        ...process.env,
        PATH: mergePathEntries([
          commandDir,
          buildCliLookupPath(process.env.PATH, process.env.HOME),
        ]),
        OPENCODE_DB: path.join(
          os.tmpdir(),
          `agents-gui-opencode-agent-list-${stableHash(cwd).toString(16)}-${process.pid}.db`
        ),
        OMO_DISABLE_POSTHOG: '1',
        OMO_SEND_ANONYMOUS_TELEMETRY: '0',
      };
      const proc = spawn(command, ['agent', 'list'], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const seen = new Set<string>();
      const modes: CliAgentMode[] = [];
      let buffer = '';
      let settled = false;

      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        parseLines(buffer);
        resolve(modes);
      };

      const parseLines = (text: string) => {
        for (const line of text.split(/\r?\n/)) {
          const mode = parseOpenCodeAgentListLine(line);
          if (!mode || seen.has(mode.id)) {
            continue;
          }

          seen.add(mode.id);
          modes.push(mode);
        }
      };

      const timeout = setTimeout(() => {
        try {
          proc.kill('SIGTERM');
        } catch {
          // Process may already be gone.
        }
        finish();
      }, 5000);

      proc.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        parseLines(lines.join('\n'));
      });
      proc.on('close', finish);
      proc.on('error', finish);
    });
  }

  private getOpenCodeModelOptions(command: string): Promise<CliModelOption[]> {
    const cwd = this.getWorkspaceRoot();
    return new Promise<CliModelOption[]>((resolve) => {
      const runCliFallback = () => {
        const commandDir = path.isAbsolute(command) ? path.dirname(command) : undefined;
        const env = {
          ...process.env,
          PATH: mergePathEntries([
            commandDir,
            buildCliLookupPath(process.env.PATH, process.env.HOME),
          ]),
          OPENCODE_DB: path.join(
            os.tmpdir(),
            `agents-gui-opencode-models-${stableHash(cwd).toString(16)}-${process.pid}.db`
          ),
          OMO_DISABLE_POSTHOG: '1',
          OMO_SEND_ANONYMOUS_TELEMETRY: '0',
        };
        const proc = spawn(command, ['models'], {
          cwd,
          env,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        let output = '';
        let settled = false;

        const finish = () => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timeout);
          resolve(parseOpenCodeModelsOutput(output));
        };

        const timeout = setTimeout(() => {
          try {
            proc.kill('SIGTERM');
          } catch {
            // Process may already be gone.
          }
          finish();
        }, 5000);

        proc.stdout?.on('data', (data: Buffer) => {
          output += data.toString();
          if (output.length > 1_000_000) {
            try {
              proc.kill('SIGTERM');
            } catch {
              // Process may already be gone.
            }
            finish();
          }
        });
        proc.on('close', finish);
        proc.on('error', () => finish());
      };

      void this.getOpenCodeModelOptionsFromServer(cwd)
        .then((serverOptions) => {
          if (serverOptions.length > 0) {
            resolve(serverOptions);
            return;
          }

          runCliFallback();
        })
        .catch(() => runCliFallback());
    });
  }

  private async getOpenCodeModelOptionsFromServer(cwd: string): Promise<CliModelOption[]> {
    const serverUrl = await this.getOpenCodeServerUrl();
    if (!serverUrl) {
      return [];
    }

    const payload = await this.fetchJson(
      this.openCodeApiUrl(serverUrl, '/config/providers', cwd),
      2400
    );
    return parseOpenCodeProviderModels(payload);
  }

  private getCommandVersion(profile: CliProfile): Promise<string | undefined> {
    return this.resolveCommandPath(profile.command).then((command) => {
      if (!command) {
        return undefined;
      }

      return new Promise<string | undefined>((resolve) => {
        const commandDir = path.isAbsolute(command) ? path.dirname(command) : undefined;
        const proc = spawn(command, profile.versionArgs ?? ['--version'], {
          env: {
            ...process.env,
            PATH: mergePathEntries([
              commandDir,
              buildCliLookupPath(process.env.PATH, process.env.HOME),
            ]),
            ...this.expandProfileEnv(profile.env, this.getWorkspaceRoot()),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        let settled = false;
        const finish = (version: string | undefined) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timeout);
          resolve(version);
        };
        const timeout = setTimeout(() => {
          proc.kill('SIGTERM');
          finish(undefined);
        }, 1800);

        proc.stdout?.on('data', (data: Buffer) => {
          output += data.toString();
        });
        proc.stderr?.on('data', (data: Buffer) => {
          output += data.toString();
        });
        proc.on('close', () => finish(normalizeCommandVersionOutput(output)));
        proc.on('error', () => finish(undefined));
      });
    });
  }

  /** Start a CLI in prompt (non-interactive) mode. */
  async startPrompt(
    cliId: string,
    initialInput?: string,
    agentArgs: string[] = [],
    agentModeId?: string,
    optionKey?: string,
    envOverrides: Record<string, string> = {},
    options: StartPromptOptions = {}
  ): Promise<Session | null> {
    const profile = getCliProfile(cliId);
    if (!profile) { return null; }

    const cwd = this.getWorkspaceRoot();
    const n = (this.counters.get(cliId) ?? 0) + 1;
    this.counters.set(cliId, n);
    const sessionId = `${cliId}-${n}`;
    const command = await this.resolveCommandPath(profile.command) ?? profile.command;
    const commandDir = path.isAbsolute(command) ? path.dirname(command) : undefined;
    const env = {
      ...process.env,
      PATH: mergePathEntries([
        commandDir,
        buildCliLookupPath(process.env.PATH, process.env.HOME),
      ]),
      ...this.expandProfileEnv(profile.env, cwd),
      ...envOverrides,
    };
    const backgroundAttachArgs = options.attachBackgroundServer === false
      ? []
      : await this.getBackgroundAttachArgs(profile, command, cwd, env);
    const args =
      profile.inputMode === 'argument' && initialInput
        ? [...profile.promptArgs, ...backgroundAttachArgs, ...agentArgs, initialInput]
        : [...profile.promptArgs, ...backgroundAttachArgs, ...agentArgs];
    const onOutput = new vscode.EventEmitter<string>();
    const onStderr = new vscode.EventEmitter<string>();
    const onError = new vscode.EventEmitter<string>();
    const onEnd = new vscode.EventEmitter<number>();
    const onEvent = new vscode.EventEmitter<AgentRunEvent>();
    const emitOutput = (
      text: string,
      stream: AgentRunOutputStream,
      transport: AgentRunTransport,
      openCodeSessionId?: string
    ) => {
      if (stream === 'stderr') {
        onStderr.fire(text);
      } else {
        onOutput.fire(text);
      }
      onEvent.fire({ type: 'output', text, stream, transport, openCodeSessionId });
    };
    const emitError = (message: string) => {
      onError.fire(message);
      onEvent.fire({ type: 'error', message });
    };
    const emitEnd = (exitCode: number, openCodeSessionId?: string) => {
      onEnd.fire(exitCode);
      onEvent.fire({ type: 'end', exitCode, openCodeSessionId });
    };
    const eventStreamUrl = options.attachBackgroundServer === false
      ? undefined
      : this.getOpenCodeEventStreamUrl(profile, backgroundAttachArgs);
    const eventStream = eventStreamUrl
      ? this.openOpenCodeEventStream(eventStreamUrl, (text, openCodeSessionId) => {
        emitOutput(text, 'stdout', 'sse', openCodeSessionId);
      })
      : undefined;

    const proc = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== 'win32',
      stdio: [profile.inputMode === 'stdin' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });

    const session: Session = {
      id: sessionId,
      cliId,
      agentModeId,
      optionKey,
      profile,
      process: proc,
      onOutput,
      onStderr,
      onError,
      onEnd,
      onEvent,
      eventStream,
    };

    proc.stdout?.on('data', (data: Buffer) => {
      const detectedOpenCodeSessionId = this.extractOpenCodeSessionIdFromJsonText(data.toString());
      if (detectedOpenCodeSessionId) {
        session.openCodeSessionId = detectedOpenCodeSessionId;
        eventStream?.setSessionId(detectedOpenCodeSessionId);
      }
      if (eventStream?.hasOutput() && !eventStream.failed()) {
        return;
      }
      emitOutput(
        data.toString(),
        'stdout',
        'process',
        session.openCodeSessionId ?? eventStream?.sessionId()
      );
    });

    proc.stderr?.on('data', (data: Buffer) => {
      emitOutput(data.toString(), 'stderr', 'process', session.openCodeSessionId ?? eventStream?.sessionId());
    });

    proc.on('close', (code) => {
      session.eventStream?.close();
      this.killChildProcessTree(proc, 'SIGTERM');
      emitEnd(code ?? -1, session.openCodeSessionId ?? eventStream?.sessionId());
      this.sessions.delete(sessionId);
    });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        this.commandPathCache.delete(profile.command);
      }
      session.eventStream?.close();
      emitError(`Failed to start ${profile.name}: ${err.message}`);
      emitEnd(-1, session.openCodeSessionId ?? eventStream?.sessionId());
      this.sessions.delete(sessionId);
    });

    this.sessions.set(sessionId, session);

    if (profile.inputMode === 'stdin' && initialInput) {
      this.sendInput(sessionId, initialInput, !profile.keepStdinOpen);
    }

    return session;
  }

  sendInput(sessionId: string, text: string, closeAfterWrite = false): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.process.stdin || session.process.stdin.destroyed) { return false; }
    session.process.stdin.write(text + '\n');
    if (closeAfterWrite) {
      session.process.stdin.end();
    }
    return true;
  }

  /** Get the active session for a specific CLI tool (latest one) */
  getSessionForCli(cliId: string): Session | undefined {
    let latest: Session | undefined;
    for (const session of this.sessions.values()) {
      if (session.cliId === cliId) {
        latest = session;
      }
    }
    return latest;
  }

  stop(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) { return; }
    try {
      session.eventStream?.close();
      this.terminateChildProcess(session.process);
    } catch {
      // process may already be dead
    }
    this.sessions.delete(sessionId);
  }

  stopAll(): void {
    for (const [id] of this.sessions) {
      this.stop(id);
    }
    this.stopBackgroundServers();
  }

  getActiveSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  async runOpenCodePromptViaServer(
    prompt: string,
    token: vscode.CancellationToken,
    directory = this.getWorkspaceRoot(),
    modelId?: string,
    onPartial?: (text: string) => void
  ): Promise<string> {
    const serverUrl = await this.getOpenCodeServerUrl();
    if (!serverUrl) {
      throw new Error('OpenCode server is not available.');
    }
    await this.waitForOpenCodeServerReady(serverUrl, directory);

    const session = this.objectRecord(
      await this.requestJson(
        this.openCodeApiUrl(serverUrl, '/session', directory),
        {
          method: 'POST',
          timeoutMs: OPEN_CODE_REQUEST_TIMEOUT_MS,
          body: { title: 'Generate commit message' },
        }
      )
    );
    const sessionId = this.pickString(session.id);
    if (!sessionId?.startsWith('ses')) {
      throw new Error('OpenCode did not return a session.');
    }

    const eventStream = this.openOpenCodePromptEventStream(serverUrl, sessionId, onPartial);

    try {
      const model = parseOpenCodeModelId(modelId);
      await this.requestJson(
        this.openCodeApiUrl(serverUrl, `/session/${encodeURIComponent(sessionId)}/prompt_async`, directory),
        {
          method: 'POST',
          timeoutMs: OPEN_CODE_REQUEST_TIMEOUT_MS,
          body: {
            parts: [{ type: 'text', text: prompt }],
            tools: { '*': false },
            ...(model ? { model } : {}),
          },
        }
      );

      return await this.waitForOpenCodeServerText(
        serverUrl,
        sessionId,
        directory,
        token,
        onPartial,
        eventStream
      );
    } catch (error) {
      await this.abortOpenCodeServerSession(serverUrl, sessionId, directory);
      throw error;
    } finally {
      eventStream?.close();
    }
  }

  async getOpenCodeStatus(): Promise<AssistantOpenCodeStatus | undefined> {
    const serverUrl = await this.getOpenCodeServerUrl();
    if (!serverUrl) {
      return undefined;
    }

    const [mcpPayload, lspPayload, projectPayload] = await Promise.all([
      this.fetchJson(new URL('/mcp', serverUrl)),
      this.fetchJson(new URL('/lsp', serverUrl)),
      this.fetchJson(new URL('/project/current', serverUrl)),
    ]);

    return {
      mcpServers: this.normalizeOpenCodeMcpStatus(mcpPayload),
      lspServers: this.normalizeOpenCodeLspStatus(lspPayload),
      project: this.normalizeOpenCodeProject(projectPayload),
    };
  }

  async getOpenCodeMcpStatus(): Promise<AssistantMcpServerStatus[] | undefined> {
    return (await this.getOpenCodeStatus())?.mcpServers;
  }

  async executeOpenCodeNativeCommand(
    command: AssistantOpenCodeNativeCommand,
    sessionId: string | undefined
  ): Promise<AssistantOpenCodeNativeCommandResult> {
    if (!sessionId || !sessionId.startsWith('ses')) {
      return {
        command,
        ok: false,
        message: 'No active OpenCode session is available yet.',
      };
    }

    const serverUrl = await this.getOpenCodeServerUrl();
    if (!serverUrl) {
      return {
        command,
        ok: false,
        message: 'OpenCode server is not available.',
      };
    }

    if (command === 'share') {
      const payload = await this.requestJson(
        this.openCodeSessionUrl(serverUrl, sessionId, '/share'),
        { method: 'POST' }
      );
      const payloadRecord = this.objectRecord(payload);
      const dataRecord = this.objectRecord(payloadRecord.data);
      const shareRecord = this.objectRecord(payloadRecord.share);
      const dataShareRecord = this.objectRecord(dataRecord.share);
      const url = this.pickString(
        shareRecord.url,
        dataShareRecord.url
      );
      return {
        command,
        ok: true,
        ...(url ? { url, message: `OpenCode session shared: ${url}` } : { message: 'OpenCode session shared.' }),
      };
    }

    if (command === 'unshare') {
      await this.requestJson(this.openCodeSessionUrl(serverUrl, sessionId, '/share'), {
        method: 'DELETE',
      });
      return { command, ok: true, message: 'OpenCode session unpublished.' };
    }

    if (command === 'compact') {
      const session = this.objectRecord(
        await this.requestJson(this.openCodeSessionUrl(serverUrl, sessionId), { method: 'GET' })
      );
      const model = this.objectRecord(session.model);
      const providerID = this.pickString(model.providerID);
      const modelID = this.pickString(model.id, model.modelID);
      if (!providerID || !modelID) {
        return {
          command,
          ok: false,
          message: 'OpenCode did not expose a model for this session.',
        };
      }

      await this.requestJson(this.openCodeSessionUrl(serverUrl, sessionId, '/summarize'), {
        method: 'POST',
        body: { providerID, modelID },
      });
      return { command, ok: true, message: 'OpenCode session compacted.' };
    }

    if (command === 'fork') {
      const payload = this.objectRecord(
        await this.requestJson(this.openCodeSessionUrl(serverUrl, sessionId, '/fork'), {
          method: 'POST',
          body: {},
        })
      );
      const forkedSessionId = this.pickString(payload.id);
      if (!forkedSessionId?.startsWith('ses')) {
        return {
          command,
          ok: false,
          message: 'OpenCode did not return a forked session.',
        };
      }

      return {
        command,
        ok: true,
        message: 'OpenCode session forked.',
        newOpenCodeSessionId: forkedSessionId,
        title: this.pickString(payload.title),
      };
    }

    if (command === 'undo' || command === 'redo') {
      return await this.executeOpenCodeRevertCommand(serverUrl, command, sessionId);
    }

    return {
      command,
      ok: false,
      message: `Unsupported OpenCode command: ${command}`,
    };
  }

  async deleteOpenCodeSession(sessionId: string | undefined): Promise<boolean> {
    if (!sessionId?.startsWith('ses')) {
      return false;
    }

    const serverUrl = await this.getOpenCodeServerUrl();
    if (!serverUrl) {
      return false;
    }

    await this.requestJson(this.openCodeSessionUrl(serverUrl, sessionId), {
      method: 'DELETE',
      timeoutMs: OPEN_CODE_REQUEST_TIMEOUT_MS,
    });
    return true;
  }

  private async getOpenCodeServerUrl(): Promise<string | undefined> {
    const profile = getCliProfile('opencode');
    if (!profile?.backgroundServer) {
      return undefined;
    }

    const cwd = this.getWorkspaceRoot();
    const command = await this.resolveCommandPath(profile.command);
    if (!command) {
      return undefined;
    }

    const commandDir = path.isAbsolute(command) ? path.dirname(command) : undefined;
    const env = {
      ...process.env,
      PATH: mergePathEntries([
        commandDir,
        buildCliLookupPath(process.env.PATH, process.env.HOME),
      ]),
      ...this.expandProfileEnv(profile.env, cwd),
    };
    const attachArgs = await this.getBackgroundAttachArgs(profile, command, cwd, env);
    const serverUrl = this.getOpenCodeEventStreamUrl(profile, attachArgs);
    if (!serverUrl) {
      return undefined;
    }

    return serverUrl;
  }

  private async getBackgroundAttachArgs(
    profile: CliProfile,
    command: string,
    cwd: string,
    env: NodeJS.ProcessEnv
  ): Promise<string[]> {
    if (!profile.backgroundServer) {
      return [];
    }

    for (const server of this.resolveBackgroundServerCandidates(profile, cwd)) {
      const state = this.backgroundServers.get(server.key);
      const ownedProcess =
        state?.process && this.isChildProcessRunning(state.process);

      if (ownedProcess && await this.isBackgroundServerAvailable(profile, server, cwd, 120)) {
        return server.attachArgs;
      }

      if (!ownedProcess && await this.waitForTcp(server.host, server.port, 120)) {
        if (await this.isBackgroundServerAvailable(profile, server, cwd, 900)) {
          return server.attachArgs;
        }
        continue;
      }

      const nextState = state ?? {};
      this.backgroundServers.set(server.key, nextState);

      if (!nextState.starting) {
        nextState.starting = this.startBackgroundServer(
          server.key,
          command,
          server.args,
          cwd,
          env,
          server.host,
          server.port
        );
      }

      const ready = await nextState.starting;
      if (ready && await this.isBackgroundServerAvailable(profile, server, cwd, 1800)) {
        return server.attachArgs;
      }
    }

    return [];
  }

  private resolveBackgroundServerCandidates(
    profile: CliProfile,
    cwd: string
  ): ResolvedBackgroundServer[] {
    const server = profile.backgroundServer;
    if (!server) {
      return [];
    }

    const ports = this.backgroundServerPorts(profile.id, cwd);
    return ports
      .map((port) => {
        const url = this.expandBackgroundServerArg(server.url, cwd, port);
        const target = this.getTcpTarget(url);
        if (!target) {
          return undefined;
        }

        return {
          key: `${profile.id}:${url}`,
          url,
          args: server.args.map((arg) => this.expandBackgroundServerArg(arg, cwd, port)),
          attachArgs: server.attachArgs.map((arg) => this.expandBackgroundServerArg(arg, cwd, port)),
          host: target.host,
          port: target.port,
        };
      })
      .filter((candidate): candidate is ResolvedBackgroundServer => Boolean(candidate));
  }

  private async isBackgroundServerAvailable(
    profile: CliProfile,
    server: ResolvedBackgroundServer,
    cwd: string,
    timeoutMs: number
  ): Promise<boolean> {
    if (!(await this.waitForTcp(server.host, server.port, timeoutMs))) {
      return false;
    }

    if (profile.id !== 'opencode') {
      return true;
    }

    const status = await this.fetchJson(
      this.openCodeApiUrl(server.url, '/session/status', cwd),
      Math.max(600, timeoutMs)
    );
    return Boolean(status && typeof status === 'object' && !Array.isArray(status));
  }

  private backgroundServerPorts(profileId: string, cwd: string): number[] {
    const profile = getCliProfile(profileId);
    const range = profile?.backgroundServer?.portRange;
    if (!range) {
      const target = profile?.backgroundServer && this.getTcpTarget(profile.backgroundServer.url);
      return target ? [target.port] : [];
    }

    const size = Math.max(1, range.size);
    const offset = stableHash(`${profileId}:${cwd}`) % size;
    return Array.from({ length: size }, (_, index) => range.start + ((offset + index) % size));
  }

  private expandBackgroundServerArg(value: string, cwd: string, port: number): string {
    return value
      .replace(/\{cwd\}/g, cwd)
      .replace(/\{port\}/g, String(port));
  }

  private expandProfileEnv(
    env: Record<string, string> | undefined,
    cwd: string
  ): Record<string, string> {
    if (!env) {
      return {};
    }

    const cwdHash = stableHash(cwd).toString(16);
    const replacements: Record<string, string> = {
      cwd,
      cwdHash,
      tmp: os.tmpdir(),
    };

    return Object.fromEntries(
      Object.entries(env).map(([key, value]) => [
        key,
        value.replace(/\{(cwd|cwdHash|tmp)\}/g, (_match, token: string) => replacements[token] ?? ''),
      ])
    );
  }

  private getOpenCodeEventStreamUrl(
    profile: CliProfile,
    attachArgs: string[]
  ): string | undefined {
    if (profile.id !== 'opencode') {
      return undefined;
    }

    const attachIndex = attachArgs.indexOf('--attach');
    return attachIndex >= 0 ? attachArgs[attachIndex + 1] : undefined;
  }

  private openCodeSessionUrl(serverUrl: string | URL, sessionId: string, suffix = ''): URL {
    const encodedSessionId = encodeURIComponent(sessionId);
    return new URL(`/session/${encodedSessionId}${suffix}`, serverUrl);
  }

  private openCodeApiUrl(
    serverUrl: string | URL,
    pathname: string,
    directory?: string
  ): URL {
    const url = new URL(pathname, serverUrl);
    if (directory) {
      url.searchParams.set('directory', directory);
    }
    return url;
  }

  private async waitForOpenCodeServerText(
    serverUrl: string,
    sessionId: string,
    directory: string,
    token: vscode.CancellationToken,
    onPartial?: (text: string) => void,
    eventStream?: OpenCodePromptEventStream
  ): Promise<string> {
    const startedAt = Date.now();
    let eventStreamReady = await (eventStream?.ready ?? Promise.resolve(false));
    if (eventStream && !eventStreamReady) {
      eventStream.close();
    }

    while (Date.now() - startedAt < OPEN_CODE_PROMPT_TIMEOUT_MS) {
      if (token.isCancellationRequested) {
        throw new Error('cancelled');
      }

      const streamedError = eventStreamReady ? eventStream?.error() : undefined;
      if (streamedError) {
        throw new Error(streamedError);
      }

      if (eventStreamReady && eventStream) {
        if (eventStream.failed()) {
          eventStream.close();
          eventStreamReady = false;
        } else {
          const completed = await this.waitForOpenCodeEventCompletion(eventStream, token);
          if (completed) {
            const finalText = await this.fetchOpenCodeSessionText(serverUrl, sessionId, directory);
            return finalText ?? eventStream.outputText();
          }
          continue;
        }
      }

      const [statusPayload, messages] = await Promise.all([
        this.fetchJson(this.openCodeApiUrl(serverUrl, '/session/status', directory)),
        this.fetchJson(
          this.openCodeApiUrl(serverUrl, `/session/${encodeURIComponent(sessionId)}/message`, directory)
        ),
      ]);
      const status = this.objectRecord(
        this.objectRecord(statusPayload)[sessionId]
      );
      const statusError = this.openCodeStatusError(status);
      if (statusError) {
        throw new Error(statusError);
      }

      const textState = this.extractOpenCodeAssistantTextState(messages);
      if (textState) {
        if (textState.text.trim()) {
          onPartial?.(textState.text);
        }
        if (textState.completed) {
          return textState.text;
        }
      }

      await this.sleep(OPEN_CODE_PROMPT_FALLBACK_POLL_INTERVAL_MS);
    }

    const streamedError = eventStreamReady ? eventStream?.error() : undefined;
    if (streamedError) {
      throw new Error(streamedError);
    }

    throw new Error('OpenCode server timed out while generating a commit message.');
  }

  private async waitForOpenCodeEventCompletion(
    eventStream: OpenCodePromptEventStream,
    token: vscode.CancellationToken
  ): Promise<boolean> {
    if (token.isCancellationRequested) {
      throw new Error('cancelled');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => resolve(false), OPEN_CODE_PROMPT_FALLBACK_POLL_INTERVAL_MS);
      const disposable = token.onCancellationRequested(() => {
        clearTimeout(timeout);
        reject(new Error('cancelled'));
      });
      eventStream.completed.then(
        () => {
          clearTimeout(timeout);
          disposable.dispose();
          resolve(true);
        },
        (error) => {
          clearTimeout(timeout);
          disposable.dispose();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });
  }

  private async fetchOpenCodeSessionText(
    serverUrl: string,
    sessionId: string,
    directory: string
  ): Promise<string | undefined> {
    const messages = await this.fetchJson(
      this.openCodeApiUrl(serverUrl, `/session/${encodeURIComponent(sessionId)}/message`, directory)
    );
    const textState = this.extractOpenCodeAssistantTextState(messages);
    return textState?.completed ? textState.text : undefined;
  }

  private openCodeStatusError(status: Record<string, unknown>): string | undefined {
    const statusMessage = this.pickString(status.message);
    if (statusMessage) {
      const normalized = this.normalizeOpenCodeProviderError(statusMessage);
      if (normalized !== statusMessage) {
        return normalized;
      }
      if (this.pickString(status.type) === 'error') {
        return statusMessage;
      }
    }

    const errorMessage = this.openCodeErrorMessage(status);
    return errorMessage ? this.normalizeOpenCodeProviderError(errorMessage) : undefined;
  }

  private async waitForOpenCodeServerReady(
    serverUrl: string,
    directory: string
  ): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < OPEN_CODE_SERVER_READY_TIMEOUT_MS) {
      const status = await this.fetchJson(
        this.openCodeApiUrl(serverUrl, '/session/status', directory),
        1800
      );
      if (status && typeof status === 'object') {
        return;
      }

      await this.sleep(OPEN_CODE_PROMPT_FALLBACK_POLL_INTERVAL_MS);
    }

    throw new Error('OpenCode server is still starting. Retry once it is ready.');
  }

  private async abortOpenCodeServerSession(
    serverUrl: string,
    sessionId: string,
    directory: string
  ): Promise<void> {
    try {
      await this.requestJson(
        this.openCodeApiUrl(serverUrl, `/session/${encodeURIComponent(sessionId)}/abort`, directory),
        { method: 'POST', timeoutMs: 2000 }
      );
    } catch {
      // Best-effort cleanup only.
    }
  }

  private extractOpenCodeAssistantText(payload: unknown): string | undefined {
    const state = this.extractOpenCodeAssistantTextState(payload);
    return state?.completed ? state.text : undefined;
  }

  private extractOpenCodeAssistantTextState(
    payload: unknown
  ): { text: string; completed: boolean } | undefined {
    if (!Array.isArray(payload)) {
      return undefined;
    }

    for (const item of payload.slice().reverse()) {
      const record = this.objectRecord(item);
      const info = this.objectRecord(record.info);
      if (this.pickString(info.role) !== 'assistant') {
        continue;
      }

      const error = this.openCodeMessageError(info);
      if (error) {
        throw new Error(error);
      }

      const completed = this.isOpenCodeAssistantMessageCompleted(info);
      const parts = Array.isArray(record.parts) ? record.parts : [];
      const text = parts
        .map((part) => {
          const partRecord = this.objectRecord(part);
          return this.pickString(partRecord.type) === 'text'
            ? this.pickString(partRecord.text) ?? ''
            : '';
        })
        .join('');
      if (text.trim() && completed) {
        return { text, completed };
      }

      if (completed) {
        return { text: '', completed };
      }

      return { text, completed };
    }

    return undefined;
  }

  private isOpenCodeAssistantMessageCompleted(info: Record<string, unknown>): boolean {
    const time = this.objectRecord(info.time);
    const status = this.pickString(info.status, info.state, info.phase);
    return (
      typeof time.completed === 'number' ||
      status === 'completed' ||
      status === 'done' ||
      status === 'idle'
    );
  }

  private openCodeMessageError(info: Record<string, unknown>): string | undefined {
    return this.openCodeErrorMessage(info);
  }

  private async executeOpenCodeRevertCommand(
    serverUrl: string | URL,
    command: 'undo' | 'redo',
    sessionId: string
  ): Promise<AssistantOpenCodeNativeCommandResult> {
    const session = this.objectRecord(
      await this.requestJson(this.openCodeSessionUrl(serverUrl, sessionId), { method: 'GET' })
    );
    const messagesPayload = await this.requestJson(
      this.openCodeSessionUrl(serverUrl, sessionId, '/message'),
      { method: 'GET' }
    );
    const messages = Array.isArray(messagesPayload)
      ? messagesPayload
        .map((entry) => this.objectRecord(this.objectRecord(entry).info))
        .filter((entry) => this.pickString(entry.id))
      : [];
    const revert = this.objectRecord(session.revert);
    const revertMessageId = this.pickString(revert.messageID);

    if (command === 'undo') {
      const target = messages
        .slice()
        .reverse()
        .find((message) => {
          const id = this.pickString(message.id);
          return id && (!revertMessageId || id < revertMessageId);
        });
      const messageID = this.pickString(target?.id);
      if (!messageID) {
        return { command, ok: false, message: 'No OpenCode message is available to undo.' };
      }

      await this.requestJson(this.openCodeSessionUrl(serverUrl, sessionId, '/revert'), {
        method: 'POST',
        body: { messageID },
      });
      return { command, ok: true, message: 'OpenCode session moved back one message.' };
    }

    if (!revertMessageId) {
      return { command, ok: false, message: 'No OpenCode undo point is available to redo.' };
    }

    const target = messages.find((message) => {
      const id = this.pickString(message.id);
      return id && id > revertMessageId;
    });
    const messageID = this.pickString(target?.id);
    if (messageID) {
      await this.requestJson(this.openCodeSessionUrl(serverUrl, sessionId, '/revert'), {
        method: 'POST',
        body: { messageID },
      });
      return { command, ok: true, message: 'OpenCode session moved forward one message.' };
    }

    await this.requestJson(this.openCodeSessionUrl(serverUrl, sessionId, '/unrevert'), {
      method: 'POST',
    });
    return { command, ok: true, message: 'OpenCode session restored to the latest message.' };
  }

  private openOpenCodeEventStream(
    serverUrl: string,
    output: vscode.EventEmitter<string> | ((text: string, sessionId?: string) => void)
  ): OpenCodeEventStream | undefined {
    let closed = false;
    let outputSeen = false;
    let targetSessionId: string | undefined;
    const connection = this.openOpenCodeSseConnection(serverUrl);
    if (!connection) {
      return undefined;
    }
    const renderStateBySession = new Map<string, {
      partTypes: Map<string, string>;
      partTexts: Map<string, string>;
    }>();
    const pendingBySession = new Map<string, string[]>();
    const renderStateForSession = (sessionId: string) => {
      let state = renderStateBySession.get(sessionId);
      if (!state) {
        state = {
          partTypes: new Map<string, string>(),
          partTexts: new Map<string, string>(),
        };
        renderStateBySession.set(sessionId, state);
      }

      return state;
    };
    const emitOutput = (text: string, sessionId?: string) => {
      if (typeof output === 'function') {
        output(text, sessionId);
      } else {
        output.fire(text);
      }
    };
    const emitRendered = (rendered: string, sessionId: string) => {
      outputSeen = outputSeen || this.isRenderedOpenCodeTextOutput(rendered);
      emitOutput(rendered, sessionId);
    };
    const flushPending = (sessionId: string) => {
      const pending = pendingBySession.get(sessionId) ?? [];
      pendingBySession.clear();
      for (const rendered of pending) {
        emitRendered(rendered, sessionId);
      }
    };

    const subscription = connection.onEvent((event, block) => {
      const blockSessionId = this.openCodeEventSessionId(event);
      if (!blockSessionId || (targetSessionId && blockSessionId !== targetSessionId)) {
        return;
      }

      const state = renderStateForSession(blockSessionId);
      const rendered = this.renderOpenCodeSseBlock(block, state.partTypes, state.partTexts);
      if (!rendered) {
        return;
      }

      if (targetSessionId) {
        emitRendered(rendered, blockSessionId);
        return;
      }

      const pending = pendingBySession.get(blockSessionId) ?? [];
      pending.push(rendered);
      pendingBySession.set(blockSessionId, pending);
    });

    return {
      close: () => {
        if (closed) {
          return;
        }

        closed = true;
        subscription.dispose();
        connection.close();
      },
      failed: () => connection.failed(),
      hasOutput: () => outputSeen,
      setSessionId: (sessionId: string) => {
        if (!sessionId.startsWith('ses')) {
          return;
        }

        if (targetSessionId && targetSessionId !== sessionId) {
          return;
        }

        targetSessionId = sessionId;
        flushPending(sessionId);
      },
      sessionId: () => targetSessionId,
    };
  }

  private openOpenCodeSseConnection(serverUrl: string): OpenCodeSseConnection | undefined {
    let closed = false;
    let streamFailed = false;
    let request: http.ClientRequest | undefined;
    let readyTimer: NodeJS.Timeout | undefined;
    let resolveReady: (ready: boolean) => void = () => {};
    let readySettled = false;
    const handlers = new Set<(event: Record<string, unknown>, block: string) => void>();
    const ready = new Promise<boolean>((resolve) => {
      resolveReady = resolve;
    });
    const markReady = (value: boolean) => {
      if (readySettled) {
        return;
      }

      readySettled = true;
      if (readyTimer) {
        clearTimeout(readyTimer);
      }
      resolveReady(value);
    };
    const markFailed = () => {
      streamFailed = true;
      markReady(false);
    };
    const emitBlock = (block: string) => {
      const event = this.parseOpenCodeSseBlock(block);
      if (!event) {
        return;
      }

      for (const handler of handlers) {
        handler(event, block);
      }
    };

    readyTimer = setTimeout(() => markReady(false), 1000);

    try {
      const eventUrl = new URL('/event', serverUrl);
      const client = eventUrl.protocol === 'https:' ? https : http;
      request = client.get(
        eventUrl,
        { headers: { Accept: 'text/event-stream' } },
        (response) => {
          if ((response.statusCode ?? 200) >= 400) {
            markFailed();
            response.resume();
            return;
          }

          markReady(true);
          response.setEncoding('utf8');
          let buffer = '';

          response.on('data', (chunk: string) => {
            buffer += chunk.replace(/\r\n/g, '\n');
            let boundary = buffer.indexOf('\n\n');
            while (boundary >= 0) {
              const block = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              emitBlock(block);
              boundary = buffer.indexOf('\n\n');
            }
          });
          response.on('end', () => {
            if (!closed) {
              streamFailed = true;
            }
          });
        }
      );

      request.on('error', markFailed);
    } catch {
      if (readyTimer) {
        clearTimeout(readyTimer);
      }
      return undefined;
    }

    return {
      close: () => {
        if (closed) {
          return;
        }

        closed = true;
        if (readyTimer) {
          clearTimeout(readyTimer);
        }
        handlers.clear();
        request?.destroy();
      },
      failed: () => streamFailed,
      ready,
      onEvent: (handler) => {
        handlers.add(handler);
        return {
          dispose: () => {
            handlers.delete(handler);
          },
        };
      },
    };
  }

  private openOpenCodePromptEventStream(
    serverUrl: string,
    sessionId: string,
    onPartial?: (text: string) => void
  ): OpenCodePromptEventStream | undefined {
    let closed = false;
    let lastError: string | undefined;
    let renderedOutput = '';
    let resolveCompleted: () => void = () => {};
    let completedSettled = false;
    const connection = this.openOpenCodeSseConnection(serverUrl);
    if (!connection) {
      return undefined;
    }
    const partTypes = new Map<string, string>();
    const partTexts = new Map<string, string>();
    const completed = new Promise<void>((resolve) => {
      resolveCompleted = resolve;
    });
    const markCompleted = () => {
      if (completedSettled) {
        return;
      }

      completedSettled = true;
      resolveCompleted();
    };
    const emitRendered = (rendered: string) => {
      if (!rendered) {
        return;
      }

      renderedOutput += rendered;
      const normalized = normalizeCliOutput(renderedOutput, 'opencode');
      if (normalized.trim()) {
        onPartial?.(normalized);
      }
    };
    const subscription = connection.onEvent((event, block) => {
      if (!this.openCodeEventBelongsToSession(event, sessionId)) {
        return;
      }

      const eventError = this.openCodeEventErrorMessage(event);
      if (eventError) {
        lastError = this.normalizeOpenCodeProviderError(eventError);
      }

      emitRendered(this.renderOpenCodeSseBlock(block, partTypes, partTexts));
      if (this.openCodeEventIsAssistantCompleted(event)) {
        markCompleted();
      }
    });

    return {
      close: () => {
        if (closed) {
          return;
        }

        closed = true;
        subscription.dispose();
        connection.close();
      },
      error: () => lastError,
      failed: () => connection.failed(),
      ready: connection.ready,
      completed,
      outputText: () => normalizeCliOutput(renderedOutput, 'opencode'),
    };
  }

  private requestJson(
    url: URL,
    options: { method?: 'GET' | 'POST' | 'DELETE' | 'PATCH'; body?: unknown; timeoutMs?: number } = {}
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const client = url.protocol === 'https:' ? https : http;
      const body = options.body === undefined ? undefined : JSON.stringify(options.body);
      let settled = false;
      const finish = (error: Error | undefined, value?: unknown) => {
        if (settled) {
          return;
        }

        settled = true;
        error ? reject(error) : resolve(value);
      };

      const request = client.request(
        url,
        {
          method: options.method ?? 'GET',
          headers: {
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
          },
        },
        (response) => {
          response.setEncoding('utf8');
          let responseBody = '';
          response.on('data', (chunk: string) => {
            responseBody += chunk;
            if (responseBody.length > 1024 * 1024) {
              request.destroy();
              finish(new Error('OpenCode response was too large.'));
            }
          });
          response.on('end', () => {
            if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
              finish(new Error(this.openCodeHttpErrorMessage(response.statusCode, responseBody)));
              return;
            }

            if (!responseBody.trim()) {
              finish(undefined, undefined);
              return;
            }

            try {
              finish(undefined, JSON.parse(responseBody));
            } catch {
              finish(undefined, responseBody);
            }
          });
        }
      );
      request.setTimeout(options.timeoutMs ?? 6000, () => {
        request.destroy();
        finish(new Error(`OpenCode request to ${url.pathname} timed out.`));
      });
      request.on('error', (error) => finish(error instanceof Error ? error : new Error(String(error))));
      if (body) {
        request.write(body);
      }
      request.end();
    });
  }

  private async fetchJson(url: URL, timeoutMs = 1600): Promise<unknown> {
    return new Promise((resolve) => {
      const client = url.protocol === 'https:' ? https : http;
      let settled = false;
      const finish = (value: unknown) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(value);
      };

      const request = client.get(
        url,
        { headers: { Accept: 'application/json' } },
        (response) => {
          response.setEncoding('utf8');
          let body = '';
          response.on('data', (chunk: string) => {
            body += chunk;
            if (body.length > 1024 * 1024) {
              request.destroy();
              finish(undefined);
            }
          });
          response.on('end', () => {
            if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
              finish(undefined);
              return;
            }

            try {
              finish(JSON.parse(body));
            } catch {
              finish(undefined);
            }
          });
        }
      );
      request.setTimeout(timeoutMs, () => {
        request.destroy();
        finish(undefined);
      });
      request.on('error', () => finish(undefined));
    });
  }

  private openCodeHttpErrorMessage(statusCode: number | undefined, responseBody: string): string {
    const fallback = `OpenCode request failed with HTTP ${statusCode ?? 'unknown'}.`;
    const rawMessage = this.openCodeHttpErrorBodyMessage(responseBody);
    if (!rawMessage) {
      return fallback;
    }

    const normalized = this.normalizeOpenCodeProviderError(rawMessage);
    if (normalized !== rawMessage) {
      return normalized;
    }

    return rawMessage.length > 240
      ? `${rawMessage.slice(0, 240).trim()}...`
      : rawMessage;
  }

  private openCodeHttpErrorBodyMessage(responseBody: string): string | undefined {
    const trimmed = responseBody.trim();
    if (!trimmed) {
      return undefined;
    }

    const parsed = this.parseOpenCodeHttpErrorObject(trimmed);
    if (parsed) {
      const message = this.openCodeHttpErrorObjectMessage(parsed);
      if (message) {
        return message;
      }
    }

    const jsonStart = trimmed.indexOf('{');
    if (jsonStart > 0) {
      const embedded = this.parseOpenCodeHttpErrorObject(trimmed.slice(jsonStart));
      if (embedded) {
        const message = this.openCodeHttpErrorObjectMessage(embedded);
        if (message) {
          return `${trimmed.slice(0, jsonStart).replace(/:\s*$/, '')}: ${message}`;
        }
      }
    }

    return trimmed;
  }

  private openCodeHttpErrorObjectMessage(record: Record<string, unknown>): string | undefined {
    const error = this.objectRecord(record.error);
    const data = this.objectRecord(error.data);
    return this.openCodeErrorMessage(record) ?? this.pickString(
      data.message,
      data.code,
      error.message,
      error.code,
      record.message,
      record.code
    );
  }

  private parseOpenCodeHttpErrorObject(text: string): Record<string, unknown> | undefined {
    try {
      const parsed = JSON.parse(text);
      const record = this.objectRecord(parsed);
      return Object.keys(record).length > 0 ? record : undefined;
    } catch {
      return undefined;
    }
  }

  private normalizeOpenCodeMcpStatus(payload: unknown): AssistantMcpServerStatus[] | undefined {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return undefined;
    }

    return Object.entries(payload as Record<string, unknown>)
      .map(([name, value]) => {
        const record = value && typeof value === 'object' && !Array.isArray(value)
          ? value as Record<string, unknown>
          : {};
        const status = typeof record.status === 'string' ? record.status : 'unknown';
        const error = typeof record.error === 'string'
          ? record.error
          : (typeof record.message === 'string' ? record.message : undefined);

        return {
          name,
          status,
          ...(error ? { error } : {}),
        };
      })
      .filter((item) => item.name.trim().length > 0);
  }

  private normalizeOpenCodeLspStatus(payload: unknown): AssistantLspServerStatus[] | undefined {
    if (!payload) {
      return undefined;
    }

    if (Array.isArray(payload)) {
      return payload
        .map((value, index) => this.normalizeOpenCodeLspEntry(String(index + 1), value))
        .filter((item): item is AssistantLspServerStatus => Boolean(item));
    }

    if (typeof payload !== 'object') {
      return undefined;
    }

    return Object.entries(payload as Record<string, unknown>)
      .map(([name, value]) => this.normalizeOpenCodeLspEntry(name, value))
      .filter((item): item is AssistantLspServerStatus => Boolean(item));
  }

  private normalizeOpenCodeLspEntry(
    fallbackName: string,
    value: unknown
  ): AssistantLspServerStatus | undefined {
    if (typeof value === 'string') {
      const name = value.trim();
      return name ? { name } : undefined;
    }

    const record = this.objectRecord(value);
    const name = this.pickString(
      record.name,
      record.id,
      record.language,
      record.server,
      record.extension
    ) ?? fallbackName;
    const status = this.pickString(record.status, record.state);
    const error = this.pickString(record.error, record.message);

    if (!name.trim()) {
      return undefined;
    }

    return {
      name,
      ...(status ? { status } : {}),
      ...(error ? { error } : {}),
    };
  }

  private normalizeOpenCodeProject(payload: unknown): AssistantOpenCodeProject | undefined {
    const record = this.objectRecord(payload);
    const id = this.pickString(record.id);
    const worktree = this.pickString(record.worktree, record.path, record.root);
    const vcs = this.pickString(record.vcs);

    if (!id && !worktree && !vcs) {
      return undefined;
    }

    return {
      ...(id ? { id } : {}),
      ...(worktree ? { worktree } : {}),
      ...(vcs ? { vcs } : {}),
    };
  }

  private renderOpenCodeSseBlock(
    block: string,
    partTypes: Map<string, string>,
    partTexts: Map<string, string>
  ): string {
    const event = this.parseOpenCodeSseBlock(block);
    if (!event) {
      return '';
    }

    const type = typeof event.type === 'string' ? event.type : '';
    const properties = this.objectRecord(event.properties);

    if (type === 'message.updated') {
      const info = this.firstObject(properties.info, event.info, event);
      if (info.error) {
        return `${JSON.stringify(event)}\n`;
      }

      return '';
    }

    if (type === 'error') {
      return `${JSON.stringify(event)}\n`;
    }

    if (type === 'session.error') {
      return `${JSON.stringify(event)}\n`;
    }

    if (type.includes('message.part.updated')) {
      const part = this.firstObject(properties.part, event.part);
      const partId = this.pickString(part.id, properties.partID, event.partID);
      const partType = this.pickString(part.type, properties.partType, event.partType);
      if (partId && partType) {
        partTypes.set(partId, partType);
      }

      if (partType === 'tool') {
        return `${JSON.stringify({
          type: 'message.part.updated',
          properties: {
            part: this.compactOpenCodeToolPart(part, properties, event),
          },
        })}\n`;
      }

      if (partType === 'reasoning') {
        return this.renderOpenCodeUpdatedTextDelta(part, partTexts, 'reasoning');
      }

      if (partType === 'text') {
        return this.renderOpenCodeUpdatedTextDelta(part, partTexts, 'text');
      }

      return '';
    }

    if (!type.includes('message.part.delta')) {
      return '';
    }

    const part = this.firstObject(properties.part, event.part);
    const partId = this.pickString(properties.partID, event.partID, part.id);
    const field = this.pickString(properties.field, event.field) ?? 'text';
    if (field !== 'text') {
      return '';
    }

    const partType = (partId ? partTypes.get(partId) : undefined) ??
      this.pickString(part.type, properties.partType, event.partType);
    if (partType === 'tool') {
      return `${JSON.stringify({
        type: 'message.part.delta',
        properties: {
          part: this.compactOpenCodeToolPart(part, properties, event),
        },
      })}\n`;
    }

    const delta = this.pickString(properties.delta, event.delta, properties.text, event.text);
    if (!delta) {
      return '';
    }

    const eventWithPart = {
      ...event,
      properties: {
        ...properties,
        delta,
        ...(partType ? { part: { ...part, type: partType } } : {}),
      },
    };

    return `${JSON.stringify(eventWithPart)}\n`;
  }

  private isRenderedOpenCodeTextOutput(rendered: string): boolean {
    for (const line of rendered.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      let event: unknown;
      try {
        event = JSON.parse(trimmed);
      } catch {
        return true;
      }

      const object = this.objectRecord(event);
      const type = typeof object.type === 'string' ? object.type : '';
      if (type === 'message.updated' || type === 'session.error' || type === 'error') {
        return true;
      }

      const properties = this.objectRecord(object.properties);
      const part = this.firstObject(properties.part, object.part);
      const partType = this.pickString(part.type, properties.partType, object.partType);
      if (partType === 'reasoning') {
        return true;
      }
      if (partType === 'tool') {
        continue;
      }

      const delta = this.pickString(properties.delta, object.delta);
      if (delta && delta.length > 0) {
        return true;
      }
      const text = this.pickString(part.text, properties.text, object.text);
      if (text && text.length > 0) {
        return true;
      }
    }

    return false;
  }

  private compactOpenCodeToolPart(
    part: Record<string, unknown>,
    properties: Record<string, unknown>,
    event: Record<string, unknown>
  ): Record<string, unknown> {
    const state = this.firstObject(part.state, properties.state, event.state);
    const input = this.firstObject(
      part.input,
      part.args,
      part.params,
      state.input,
      state.args,
      state.params,
      properties.input,
      properties.args,
      properties.params,
      event.input,
      event.args,
      event.params
    );
    const compact: Record<string, unknown> = { type: 'tool' };
    const id = this.pickString(part.id, properties.partID, event.partID, event.id);
    const name = this.pickString(
      part.tool,
      part.name,
      part.title,
      properties.tool,
      properties.name,
      event.tool,
      event.name
    );
    const status = this.pickString(state.status, state.state, part.status, properties.status, event.status);
    const output = this.compactOpenCodeToolText(
      this.pickString(
        input.output,
        input.stdout,
        input.stderr,
        input.result,
        input.error,
        input.message,
        state.output,
        state.stdout,
        state.stderr,
        state.result,
        state.error,
        state.message,
        part.output,
        part.stdout,
        part.stderr,
        part.result,
        part.error,
        part.message,
        properties.output,
        properties.stdout,
        properties.stderr,
        properties.result,
        properties.error,
        properties.message,
        event.output,
        event.stdout,
        event.stderr,
        event.result,
        event.error,
        event.message
      )
    );

    if (id) {
      compact.id = id;
    }
    if (name) {
      compact.tool = name;
      compact.name = name;
    }
    if (status) {
      compact.status = status;
    }
    if (Object.keys(input).length > 0) {
      compact.input = input;
    }
    if (output) {
      compact.output = output;
    }

    return compact;
  }

  private compactOpenCodeToolText(value: string | undefined): string | undefined {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return undefined;
    }

    return normalized.length > 6000
      ? `${normalized.slice(0, 6000)}\n...`
      : normalized;
  }

  private renderOpenCodeUpdatedTextDelta(
    part: Record<string, unknown>,
    partTexts: Map<string, string>,
    partType: 'text' | 'reasoning'
  ): string {
    const text = typeof part.text === 'string' ? part.text : '';
    if (!text) {
      return '';
    }

    const partId = typeof part.id === 'string' ? part.id : `last-${partType}`;
    const previousText = partTexts.get(partId) ?? '';
    partTexts.set(partId, text);

    const delta = text.startsWith(previousText) ? text.slice(previousText.length) : text;
    if (!delta) {
      return '';
    }

    return `${JSON.stringify({
      type: 'message.part.delta',
      properties: {
        part: { type: partType },
        delta,
      },
    })}\n`;
  }

  private parseOpenCodeSseBlock(block: string): Record<string, unknown> | undefined {
    const trimmed = block.trim();
    if (!trimmed) {
      return undefined;
    }

    const lines = trimmed.split('\n');
    const eventName = lines
      .find((line) => line.startsWith('event:'))
      ?.slice(6)
      .trim();
    const dataLines = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    const data = dataLines.length > 0 ? dataLines.join('\n') : trimmed;

    try {
      const parsed = JSON.parse(data);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return undefined;
      }

      const event = parsed as Record<string, unknown>;
      return typeof event.type === 'string' || !eventName
        ? event
        : { ...event, type: eventName };
    } catch {
      return undefined;
    }
  }

  private extractOpenCodeSessionIdFromSseBlock(block: string): string | undefined {
    const event = this.parseOpenCodeSseBlock(block);
    if (!event) {
      return undefined;
    }

    return this.openCodeEventSessionId(event);
  }

  private openCodeEventSessionId(event: Record<string, unknown>): string | undefined {
    const properties = this.objectRecord(event.properties);
    const data = this.objectRecord(event.data);
    const info = this.objectRecord(properties.info || data.info || event.info);
    const sessionId = this.pickString(
      properties.sessionID,
      data.sessionID,
      info.sessionID,
      event.sessionID
    );
    return sessionId?.startsWith('ses') ? sessionId : undefined;
  }

  private openCodeEventBelongsToSession(
    event: Record<string, unknown>,
    sessionId: string
  ): boolean {
    return this.openCodeEventSessionId(event) === sessionId;
  }

  private openCodeEventErrorMessage(event: Record<string, unknown>): string | undefined {
    const type = this.pickString(event.type);
    const properties = this.objectRecord(event.properties);
    const data = this.objectRecord(event.data);

    if (type === 'message.updated') {
      return this.openCodeErrorMessage(this.firstObject(properties.info, data.info, event.info));
    }

    if (type === 'error' || type === 'session.error') {
      return this.openCodeErrorMessage(this.firstObject(properties.error, data.error, event.error, event));
    }

    return undefined;
  }

  private openCodeEventIsAssistantCompleted(event: Record<string, unknown>): boolean {
    if (this.pickString(event.type) !== 'message.updated') {
      return false;
    }

    const properties = this.objectRecord(event.properties);
    const data = this.objectRecord(event.data);
    const info = this.firstObject(properties.info, data.info, event.info);
    const role = this.pickString(info.role);
    return (!role || role === 'assistant') && this.isOpenCodeAssistantMessageCompleted(info);
  }

  private openCodeErrorMessage(errorOwner: Record<string, unknown>): string | undefined {
    const error = this.firstObject(errorOwner.error, errorOwner);
    const data = this.firstObject(error.data);
    return this.pickString(data.message, error.message);
  }

  private normalizeOpenCodeProviderError(message: string): string {
    if (/FreeUsageLimitError|rate limit exceeded|quota exhausted/i.test(message)) {
      return 'OpenCode provider rate limit exceeded. Switch model/provider or wait before retrying.';
    }

    if (/model[_ -]?not[_ -]?found|model_not_found|unsupported model|unknown model/i.test(message)) {
      return 'OpenCode model is not available in the current provider. Choose Configured or another listed OpenCode model, then retry.';
    }

    if (/No context found for instance/i.test(message)) {
      return 'OpenCode did not receive the workspace directory for this attached session. Reload the window or retry after Agents GUI reconnects to OpenCode.';
    }

    if (/unhashable type: 'dict'|tool schema|tools schema/i.test(message)) {
      return 'OpenCode provider rejected the tool schema. Use a no-tool OpenCode agent or switch to a provider with tool-calling support.';
    }

    return message;
  }

  private extractOpenCodeSessionIdFromJsonText(text: string): string | undefined {
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) {
        continue;
      }

      try {
        const event = this.objectRecord(JSON.parse(trimmed));
        const properties = this.objectRecord(event.properties);
        const data = this.objectRecord(event.data);
        const info = this.objectRecord(properties.info || data.info || event.info);
        const sessionId = this.pickString(
          properties.sessionID,
          data.sessionID,
          info.sessionID,
          event.sessionID
        );
        if (sessionId?.startsWith('ses')) {
          return sessionId;
        }
      } catch {
        // Ignore partial JSON chunks. The next stdout chunk may complete the event.
      }
    }

    return undefined;
  }

  private objectRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private firstObject(...values: unknown[]): Record<string, unknown> {
    for (const value of values) {
      const object = this.objectRecord(value);
      if (Object.keys(object).length > 0) {
        return object;
      }

      const parsed = this.parseObjectString(value);
      if (parsed) {
        return parsed;
      }
    }

    return {};
  }

  private parseObjectString(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(trimmed);
      const object = this.objectRecord(parsed);
      return Object.keys(object).length > 0 ? object : undefined;
    } catch {
      return undefined;
    }
  }

  private pickString(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === 'string') {
        return value;
      }
    }

    return undefined;
  }

  private async startBackgroundServer(
    key: string,
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    host: string,
    port: number
  ): Promise<boolean> {
    const current = this.backgroundServers.get(key);
    if (current?.process && this.isChildProcessRunning(current.process)) {
      const ready = await this.waitForTcp(host, port, 1800);
      if (ready) {
        return true;
      }
      this.terminateChildProcess(current.process);
      this.backgroundServers.delete(key);
    }

    let proc: ChildProcess | undefined;
    try {
      proc = spawn(command, args, {
        cwd,
        env,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      const backgroundProc = proc;

      const state = this.backgroundServers.get(key) ?? {};
      state.process = backgroundProc;
      this.backgroundServers.set(key, state);

      const clearState = () => {
        this.killChildProcessTree(backgroundProc, 'SIGTERM');
        const latest = this.backgroundServers.get(key);
        if (latest?.process === backgroundProc) {
          this.backgroundServers.delete(key);
        }
      };

      proc.on('exit', clearState);
      proc.on('error', clearState);
    } catch {
      this.backgroundServers.delete(key);
      return false;
    }

    const ready = await this.waitForTcp(host, port, 2200);
    if (!ready) {
      const state = this.backgroundServers.get(key);
      if (state) {
        state.starting = undefined;
      }
      if (proc) {
        this.terminateChildProcess(proc);
      }
    }

    return ready;
  }

  private stopBackgroundServers(): void {
    for (const [, state] of this.backgroundServers) {
      if (!state.process || !this.isChildProcessRunning(state.process)) {
        continue;
      }

      try {
        this.terminateChildProcess(state.process);
      } catch {
        // background process may already be dead
      }
    }
    this.backgroundServers.clear();
  }

  private terminateChildProcess(proc: ChildProcess): void {
    if (!this.isChildProcessRunning(proc)) {
      return;
    }

    this.killChildProcessTree(proc, 'SIGTERM');
    if (this.forceKillTimers.has(proc)) {
      return;
    }

    const timer = setTimeout(() => {
      this.forceKillTimers.delete(proc);
      this.killChildProcessTree(proc, 'SIGKILL');
    }, PROCESS_TERMINATE_GRACE_MS);
    this.forceKillTimers.set(proc, timer);
  }

  private killChildProcessTree(proc: ChildProcess, signal: NodeJS.Signals): void {
    if (!proc.pid) {
      try {
        proc.kill(signal);
      } catch {
        // process may already be dead
      }
      return;
    }

    if (process.platform === 'win32') {
      const args = ['/pid', String(proc.pid), '/T'];
      if (signal === 'SIGKILL') {
        args.push('/F');
      }
      try {
        spawn('taskkill', args, { stdio: 'ignore', windowsHide: true });
      } catch {
        try {
          proc.kill(signal);
        } catch {
          // process may already be dead
        }
      }
      return;
    }

    try {
      process.kill(-proc.pid, signal);
    } catch {
      try {
        proc.kill(signal);
      } catch {
        // process may already be dead
      }
    }
  }

  private isChildProcessRunning(proc: ChildProcess): boolean {
    return proc.exitCode === null && proc.signalCode === null;
  }

  private getTcpTarget(urlText: string): { host: string; port: number } | undefined {
    try {
      const url = new URL(urlText);
      const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
      if (!url.hostname || !Number.isFinite(port)) {
        return undefined;
      }

      return { host: url.hostname, port };
    } catch {
      return undefined;
    }
  }

  private async waitForTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (await this.canConnectTcp(host, port, 180)) {
        return true;
      }
      await this.sleep(80);
    }

    return false;
  }

  private canConnectTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });
      let settled = false;

      const finish = (result: boolean) => {
        if (settled) {
          return;
        }

        settled = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function preferredOpenCodeDefaultAgent(modes: CliAgentMode[], fallback: string): string {
  const runnableModes = modes.filter((mode) => !mode.disabled);
  return (
    runnableModes.find((mode) => mode.id === fallback)?.id ??
    runnableModes[0]?.id ??
    fallback
  );
}

function mergeOpenCodeAgentModes(...groups: CliAgentMode[][]): CliAgentMode[] {
  const seen = new Set<string>();
  const merged: CliAgentMode[] = [];
  for (const group of groups) {
    for (const mode of group) {
      if (seen.has(mode.id)) {
        continue;
      }

      seen.add(mode.id);
      merged.push(mode);
    }
  }
  return merged;
}

function preferredOpenCodeDefaultModel(options: CliModelOption[], fallback: string | undefined): string {
  const selectableOptions = options.filter((option) => !option.disabled && !option.actionOnly);
  return (
    selectableOptions.find((option) => option.id === fallback)?.id ??
    selectableOptions[0]?.id ??
    fallback ??
    'configured'
  );
}

function mergeOpenCodeModelOptions(
  baseOptions: CliModelOption[],
  discoveredOptions: CliModelOption[]
): CliModelOption[] {
  const baseVisibleOptions = discoveredOptions.length > 0
    ? baseOptions.filter((option) => option.id !== 'default' && option.id !== 'configured')
    : baseOptions;
  const defaultOptions = baseVisibleOptions.filter((option) => !option.custom);
  const customOptions = baseVisibleOptions.filter((option) => option.custom);
  const seen = new Set<string>();
  const merged: CliModelOption[] = [];

  for (const option of [...defaultOptions, ...discoveredOptions, ...customOptions]) {
    if (seen.has(option.id)) {
      continue;
    }

    seen.add(option.id);
    merged.push(option);
  }

  return merged;
}

function normalizeCommandVersionOutput(output: string): string | undefined {
  const firstLine = output
    .replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return undefined;
  }

  const version = firstLine.match(/\bv?\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?\b/);
  return (version?.[0] ?? firstLine.slice(0, 40)).replace(/^v(?=\d)/, '');
}
