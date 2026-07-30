import type { ChildProcess } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import type { CliProfile } from './cliProfiles';
import { getCliProfile } from './cliProfiles';
import { withCommandDirectoryPath } from './cliPathResolver';
import { CliDiscovery } from './cliDiscovery';
import { CliProcessRunner } from './cliProcessRunner';
import type { AgentProfileStatusOptions } from './agentRuntime';

export type AgentRunOutputStream = 'stdout' | 'stderr';
export type AgentRunEvent =
  | { type: 'output'; text: string; stream: AgentRunOutputStream; transport: 'process' }
  | { type: 'error'; message: string }
  | { type: 'end'; exitCode: number };

export interface Session {
  id: string;
  cliId: string;
  profile: CliProfile;
  process: ChildProcess;
  onOutput: vscode.EventEmitter<string>;
  onStderr: vscode.EventEmitter<string>;
  onError: vscode.EventEmitter<string>;
  onEnd: vscode.EventEmitter<number>;
  onEvent: vscode.EventEmitter<AgentRunEvent>;
}

export interface StartPromptOptions {
  cwd?: string;
}

export interface CliManagerDiscovery {
  checkInstalled(profile: CliProfile | undefined): Promise<boolean>;
  resolveCommandPath(command: string): Promise<string | undefined>;
  evictCommandPath(command: string): void;
  getProfilesWithStatus(
    profiles: CliProfile[],
    options?: AgentProfileStatusOptions
  ): Promise<CliProfile[]>;
}

export interface CliManagerOptions {
  processRunner?: CliProcessRunner;
  cliDiscovery?: CliManagerDiscovery;
  workspaceRoot?: () => string;
}

export class CliManager {
  private sessions = new Map<string, Session>();
  private counters = new Map<string, number>();
  private readonly processRunner: CliProcessRunner;
  private readonly cliDiscovery: CliManagerDiscovery;

  constructor(private readonly options: CliManagerOptions = {}) {
    this.processRunner = options.processRunner ?? new CliProcessRunner();
    this.cliDiscovery =
      options.cliDiscovery ??
      new CliDiscovery({
        workspaceRoot: () => this.getWorkspaceRoot(),
        processRunner: this.processRunner,
      });
  }

  getWorkspaceRoot(): string {
    return (
      this.options.workspaceRoot?.() ??
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
      process.env.HOME ??
      '/'
    );
  }

  async checkInstalled(profileId: string): Promise<boolean> {
    return this.cliDiscovery.checkInstalled(getCliProfile(profileId));
  }

  async getProfilesWithStatus(options: AgentProfileStatusOptions = {}): Promise<CliProfile[]> {
    const { CLI_PROFILES } = await import('./cliProfiles');
    return this.cliDiscovery.getProfilesWithStatus(CLI_PROFILES, options);
  }

  async startPrompt(
    cliId: string,
    initialInput?: string,
    options: StartPromptOptions = {}
  ): Promise<Session | null> {
    const profile = getCliProfile(cliId);
    if (!profile) return null;

    const cwd = options.cwd?.trim() || this.getWorkspaceRoot();
    const command =
      (await this.cliDiscovery.resolveCommandPath(profile.command)) ?? profile.command;
    const commandDir = path.isAbsolute(command) ? path.dirname(command) : undefined;
    const env = withCommandDirectoryPath(process.env, commandDir);
    const args =
      profile.inputMode === 'argument' && initialInput
        ? [...profile.promptArgs, initialInput]
        : [...profile.promptArgs];
    const n = (this.counters.get(cliId) ?? 0) + 1;
    this.counters.set(cliId, n);
    const sessionId = `${cliId}-${n}`;
    const onOutput = new vscode.EventEmitter<string>();
    const onStderr = new vscode.EventEmitter<string>();
    const onError = new vscode.EventEmitter<string>();
    const onEnd = new vscode.EventEmitter<number>();
    const onEvent = new vscode.EventEmitter<AgentRunEvent>();
    const emitOutput = (text: string, stream: AgentRunOutputStream) => {
      (stream === 'stdout' ? onOutput : onStderr).fire(text);
      onEvent.fire({ type: 'output', text, stream, transport: 'process' });
    };
    const emitEnd = (exitCode: number) => {
      onEnd.fire(exitCode);
      onEvent.fire({ type: 'end', exitCode });
    };

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
      profile,
      process: proc,
      onOutput,
      onStderr,
      onError,
      onEnd,
      onEvent,
    };
    proc.stdout?.on('data', (data: Buffer) => emitOutput(data.toString(), 'stdout'));
    proc.stderr?.on('data', (data: Buffer) => emitOutput(data.toString(), 'stderr'));
    let ended = false;
    const safeEmitEnd = (code: number) => {
      if (ended) return;
      ended = true;
      emitEnd(code);
    };
    proc.on('close', (code) => {
      this.processRunner.killTree(proc, 'SIGTERM');
      safeEmitEnd(code ?? -1);
      this.sessions.delete(sessionId);
    });
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') this.cliDiscovery.evictCommandPath(profile.command);
      const message = `Failed to start ${profile.name}: ${err.message}`;
      onError.fire(message);
      onEvent.fire({ type: 'error', message });
      safeEmitEnd(-1);
      this.sessions.delete(sessionId);
    });
    this.sessions.set(sessionId, session);
    if (profile.inputMode === 'stdin' && initialInput)
      this.sendInput(sessionId, initialInput, !profile.keepStdinOpen);
    return session;
  }

  sendInput(sessionId: string, text: string, closeAfterWrite = false): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.process.stdin || session.process.stdin.destroyed) return false;
    session.process.stdin.write(`${String(text || '').replace(/\n+$/, '')}\n`);
    if (closeAfterWrite) session.process.stdin.end();
    return true;
  }

  getSessionForCli(cliId: string): Session | undefined {
    let latest: Session | undefined;
    for (const session of this.sessions.values()) if (session.cliId === cliId) latest = session;
    return latest;
  }

  stop(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      this.processRunner.terminate(session.process);
    } catch {
      /* process may already be dead */
    }
    this.sessions.delete(sessionId);
  }

  stopAll(): void {
    for (const [id] of this.sessions) this.stop(id);
  }
  getActiveSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }
}
