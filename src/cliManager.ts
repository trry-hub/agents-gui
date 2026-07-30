import type { ChildProcess } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import type { CliProfile } from './cliProfiles';
import { getCliProfile } from './cliProfiles';
import { withCommandDirectoryPath } from './cliPathResolver';
import { CliDiscovery } from './cliDiscovery';
import { CliProcessRunner } from './cliProcessRunner';
import type { AgentProfileStatusOptions } from './agentRuntime';

export const MAX_PENDING_LAUNCH_DELIVERY_BYTES = 1024 * 1024;
const MAX_PENDING_LAUNCH_DELIVERIES = 1024;

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
  disabledCliIds?: ReadonlySet<string>;
}

export class CliLaunchError extends Error {
  readonly code = 'CLI_LAUNCH_FAILED';

  constructor(
    message: string,
    public readonly cliId: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'CliLaunchError';
  }
}

export class CliManager {
  private sessions = new Map<string, Session>();
  private counters = new Map<string, number>();
  private readonly processRunner: CliProcessRunner;
  private readonly cliDiscovery: CliManagerDiscovery;
  private readonly disabledCliIds: ReadonlySet<string>;

  constructor(private readonly options: CliManagerOptions = {}) {
    this.disabledCliIds = new Set(options.disabledCliIds ?? []);
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
    if (this.disabledCliIds.has(profileId)) return false;
    return this.cliDiscovery.checkInstalled(getCliProfile(profileId));
  }

  async getProfilesWithStatus(options: AgentProfileStatusOptions = {}): Promise<CliProfile[]> {
    const { CLI_PROFILES } = await import('./cliProfiles');
    return this.cliDiscovery.getProfilesWithStatus(
      CLI_PROFILES.filter((profile) => !this.disabledCliIds.has(profile.id)),
      options
    );
  }

  async startPrompt(
    cliId: string,
    initialInput?: string,
    options: StartPromptOptions = {}
  ): Promise<Session | null> {
    if (this.disabledCliIds.has(cliId)) return null;
    const profile = getCliProfile(cliId);
    if (!profile) return null;

    const requestedCwd = options.cwd;
    const cwd =
      typeof requestedCwd === 'string' && requestedCwd.trim().length > 0
        ? requestedCwd
        : this.getWorkspaceRoot();
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
    let deliveryReady = false;
    let pendingDeliveryBytes = 0;
    let pendingDeliveryOverflowed = false;
    const pendingDeliveries: Array<{
      callback: () => void;
      bytes: number;
      kind: 'output' | 'control';
    }> = [];
    const discardPendingOutput = () => {
      for (let index = pendingDeliveries.length - 1; index >= 0; index -= 1) {
        if (pendingDeliveries[index].kind === 'output') {
          pendingDeliveries.splice(index, 1);
        }
      }
      pendingDeliveryBytes = 0;
    };
    const deliver = (callback: () => void, bytes = 0, kind: 'output' | 'control' = 'control') => {
      if (kind === 'output' && pendingDeliveryOverflowed) {
        return;
      }
      if (deliveryReady) {
        callback();
        return;
      }
      if (
        kind === 'output' &&
        (pendingDeliveryBytes + bytes > MAX_PENDING_LAUNCH_DELIVERY_BYTES ||
          pendingDeliveries.length >= MAX_PENDING_LAUNCH_DELIVERIES)
      ) {
        pendingDeliveryOverflowed = true;
        discardPendingOutput();
        return;
      }
      pendingDeliveries.push({ callback, bytes, kind });
      if (kind === 'output') {
        pendingDeliveryBytes += bytes;
      }
    };
    const emitOutput = (data: Buffer | string, stream: AgentRunOutputStream) => {
      const bytes = typeof data === 'string' ? Buffer.byteLength(data, 'utf8') : data.byteLength;
      deliver(
        () => {
          const text = data.toString();
          (stream === 'stdout' ? onOutput : onStderr).fire(text);
          onEvent.fire({ type: 'output', text, stream, transport: 'process' });
        },
        bytes,
        'output'
      );
    };
    const emitEnd = (exitCode: number) => {
      deliver(() => {
        onEnd.fire(exitCode);
        onEvent.fire({ type: 'end', exitCode });
      });
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
    proc.stdout?.on('data', (data: Buffer) => emitOutput(data, 'stdout'));
    proc.stderr?.on('data', (data: Buffer) => emitOutput(data, 'stderr'));
    let ended = false;
    let spawned = false;
    const safeEmitEnd = (code: number) => {
      if (ended) return;
      ended = true;
      emitEnd(code);
    };
    return new Promise<Session>((resolve, reject) => {
      let launchSettled = false;
      const rejectLaunch = (error: CliLaunchError) => {
        if (launchSettled) return;
        launchSettled = true;
        pendingDeliveries.length = 0;
        pendingDeliveryBytes = 0;
        this.sessions.delete(sessionId);
        reject(error);
      };

      proc.once('spawn', () => {
        if (launchSettled) return;
        spawned = true;
        launchSettled = true;
        this.sessions.set(sessionId, session);
        if (profile.inputMode === 'stdin' && initialInput) {
          this.sendInput(sessionId, initialInput, !profile.keepStdinOpen);
        }
        resolve(session);
        setImmediate(() => {
          deliveryReady = true;
          const deliveries = pendingDeliveries.splice(0);
          pendingDeliveryBytes = 0;
          if (pendingDeliveryOverflowed) {
            const message =
              `Buffered CLI output exceeded ${MAX_PENDING_LAUNCH_DELIVERY_BYTES} bytes ` +
              'before launch listeners were ready.';
            onError.fire(message);
            onEvent.fire({ type: 'error', message });
            if (!ended) {
              try {
                this.processRunner.terminate(proc);
              } catch {
                // The process may already have exited while the handoff was pending.
              }
              this.sessions.delete(sessionId);
              safeEmitEnd(-1);
            }
          }
          deliveries.forEach((delivery) => delivery.callback());
        });
      });
      proc.on('close', (code) => {
        if (!spawned) {
          rejectLaunch(
            new CliLaunchError(
              `Failed to start ${profile.name}: process exited before launch completed.`,
              cliId
            )
          );
          return;
        }
        this.processRunner.killTree(proc, 'SIGTERM');
        safeEmitEnd(code ?? -1);
        this.sessions.delete(sessionId);
      });
      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') this.cliDiscovery.evictCommandPath(profile.command);
        const message = `Failed to start ${profile.name}: ${err.message}`;
        if (!spawned) {
          rejectLaunch(new CliLaunchError(message, cliId, err));
          return;
        }
        deliver(() => {
          onError.fire(message);
          onEvent.fire({ type: 'error', message });
        });
        safeEmitEnd(-1);
        this.sessions.delete(sessionId);
      });
    });
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
