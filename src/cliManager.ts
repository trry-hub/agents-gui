import type { ChildProcess } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';
import type {
  AssistantMcpServerStatus,
  AssistantOpenCodeNativeCommand,
  AssistantOpenCodeNativeCommandResult,
  AssistantOpenCodeStatus,
} from './assistantTypes';
import type { CliModelOption, CliProfile } from './cliProfiles';
import { getCliProfile } from './cliProfiles';
import {
  buildCliLookupPath,
  mergePathEntries,
} from './cliPathResolver';
import { CliDiscovery, stableHash } from './cliDiscovery';
import { CliProcessRunner } from './cliProcessRunner';
import { OpenCodeServerClient, type OpenCodeEventStream } from './openCodeServerClient';
import { getSystemProxyEnv } from './systemProxyEnv';

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
  promptArgs?: string[];
}

export class CliManager {
  private sessions = new Map<string, Session>();
  private counters = new Map<string, number>();
  private backgroundServers = new Map<string, BackgroundServerState>();
  private readonly processRunner = new CliProcessRunner();
  private readonly openCodeClient = new OpenCodeServerClient({
    resolveServerUrl: () => this.getOpenCodeServerUrl(),
    workspaceRoot: () => this.getWorkspaceRoot(),
  });
  private readonly cliDiscovery = new CliDiscovery({
    workspaceRoot: () => this.getWorkspaceRoot(),
    openCodeClient: this.openCodeClient,
  });

  getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.[0]?.uri.fsPath ?? process.env.HOME ?? '/';
  }

  async checkInstalled(profileId: string): Promise<boolean> {
    const profile = getCliProfile(profileId);
    return this.cliDiscovery.checkInstalled(profile);
  }

  private async resolveCommandPath(command: string): Promise<string | undefined> {
    return this.cliDiscovery.resolveCommandPath(command);
  }

  async getProfilesWithStatus(): Promise<CliProfile[]> {
    const { CLI_PROFILES } = await import('./cliProfiles');
    return this.cliDiscovery.getProfilesWithStatus(CLI_PROFILES);
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
      ...getSystemProxyEnv(process.env),
      PATH: mergePathEntries([
        commandDir,
        buildCliLookupPath(process.env.PATH, process.env.HOME),
      ]),
      ...this.cliDiscovery.expandProfileEnv(profile.env, cwd),
      ...envOverrides,
    };
    const backgroundAttachArgs = options.attachBackgroundServer === false
      ? []
      : await this.getBackgroundAttachArgs(profile, command, cwd, env);
    const promptArgs = options.promptArgs ?? profile.promptArgs;
    const args =
      profile.inputMode === 'argument' && initialInput
        ? [...promptArgs, ...backgroundAttachArgs, ...agentArgs, initialInput]
        : [...promptArgs, ...backgroundAttachArgs, ...agentArgs];
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
      ? this.openCodeClient.openEventStream(eventStreamUrl, (text, openCodeSessionId) => {
        emitOutput(text, 'stdout', 'sse', openCodeSessionId);
      })
      : undefined;

    const proc = this.processRunner.spawnPromptProcess(
      command,
      args,
      cwd,
      env,
      profile.inputMode === 'stdin' ? 'pipe' : 'ignore'
    );

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
      const detectedOpenCodeSessionId = this.openCodeClient.extractSessionIdFromJsonText(data.toString());
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
      this.processRunner.killTree(proc, 'SIGTERM');
      emitEnd(code ?? -1, session.openCodeSessionId ?? eventStream?.sessionId());
      this.sessions.delete(sessionId);
    });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        this.cliDiscovery.evictCommandPath(profile.command);
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
      this.processRunner.terminate(session.process);
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
    return this.openCodeClient.runPrompt(prompt, token, directory, modelId, onPartial);
  }

  async getOpenCodeStatus(): Promise<AssistantOpenCodeStatus | undefined> {
    return this.openCodeClient.getStatus();
  }

  async getOpenCodeModelOptions(cwd = this.getWorkspaceRoot()): Promise<CliModelOption[]> {
    return this.openCodeClient.fetchModelOptions(cwd);
  }

  async getOpenCodeMcpStatus(): Promise<AssistantMcpServerStatus[] | undefined> {
    return (await this.getOpenCodeStatus())?.mcpServers;
  }

  async executeOpenCodeNativeCommand(
    command: AssistantOpenCodeNativeCommand,
    sessionId: string | undefined
  ): Promise<AssistantOpenCodeNativeCommandResult> {
    return this.openCodeClient.executeNativeCommand(command, sessionId);
  }

  async deleteOpenCodeSession(sessionId: string | undefined): Promise<boolean> {
    return this.openCodeClient.deleteSession(sessionId);
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
      ...getSystemProxyEnv(process.env),
      PATH: mergePathEntries([
        commandDir,
        buildCliLookupPath(process.env.PATH, process.env.HOME),
      ]),
      ...this.cliDiscovery.expandProfileEnv(profile.env, cwd),
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
        state?.process && this.processRunner.isRunning(state.process);

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

    return this.openCodeClient.isServerAvailable(server.url, cwd, timeoutMs);
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
    if (current?.process && this.processRunner.isRunning(current.process)) {
      const ready = await this.waitForTcp(host, port, 1800);
      if (ready) {
        return true;
      }
      this.processRunner.terminate(current.process);
      this.backgroundServers.delete(key);
    }

    let proc: ChildProcess | undefined;
    try {
      proc = this.processRunner.spawnBackgroundProcess(command, args, cwd, env);
      const backgroundProc = proc;

      const state = this.backgroundServers.get(key) ?? {};
      state.process = backgroundProc;
      this.backgroundServers.set(key, state);

      const clearState = () => {
        this.processRunner.killTree(backgroundProc, 'SIGTERM');
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
        this.processRunner.terminate(proc);
      }
    }

    return ready;
  }

  private stopBackgroundServers(): void {
    for (const [, state] of this.backgroundServers) {
      if (!state.process || !this.processRunner.isRunning(state.process)) {
        continue;
      }

      try {
        this.processRunner.terminate(state.process);
      } catch {
        // background process may already be dead
      }
    }
    this.backgroundServers.clear();
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
