import crossSpawn from 'cross-spawn';
import type { ChildProcess, SpawnOptions, StdioOptions } from 'child_process';

export type CliProcessStdin = 'ignore' | 'pipe';
export type CliSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

export interface CliProcessRunnerOptions {
  spawn?: CliSpawn;
  platform?: NodeJS.Platform;
}

export interface CliProbeProcessOptions {
  cwd?: string;
  env: NodeJS.ProcessEnv;
  stderr?: 'ignore' | 'pipe';
}

const PROCESS_TERMINATE_GRACE_MS = 1500;

export class CliProcessRunner {
  private forceKillTimers = new WeakMap<ChildProcess, NodeJS.Timeout>();
  private readonly spawnImpl: CliSpawn;
  private readonly platform: NodeJS.Platform;

  constructor(options: CliProcessRunnerOptions = {}) {
    this.spawnImpl = options.spawn ?? crossSpawn;
    this.platform = options.platform ?? process.platform;
  }

  spawnPromptProcess(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    stdin: CliProcessStdin
  ): ChildProcess {
    return this.spawnProcess(command, args, cwd, env, [stdin, 'pipe', 'pipe'], true);
  }

  spawnBackgroundProcess(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv
  ): ChildProcess {
    return this.spawnProcess(command, args, cwd, env, ['ignore', 'ignore', 'ignore'], true);
  }

  spawnProbeProcess(
    command: string,
    args: string[],
    options: CliProbeProcessOptions
  ): ChildProcess {
    return this.spawnProcess(
      command,
      args,
      options.cwd,
      options.env,
      ['ignore', 'pipe', options.stderr ?? 'ignore'],
      false
    );
  }

  terminate(proc: ChildProcess): void {
    if (!this.isRunning(proc)) {
      return;
    }

    this.killTree(proc, 'SIGTERM');
    if (this.forceKillTimers.has(proc)) {
      return;
    }

    const clearForceKillTimer = () => {
      const timer = this.forceKillTimers.get(proc);
      if (timer) {
        clearTimeout(timer);
        this.forceKillTimers.delete(proc);
      }
    };
    const timer = setTimeout(() => {
      proc.off('close', clearForceKillTimer);
      this.forceKillTimers.delete(proc);
      if (this.isRunning(proc)) {
        this.killTree(proc, 'SIGKILL');
      }
    }, PROCESS_TERMINATE_GRACE_MS);
    timer.unref();
    this.forceKillTimers.set(proc, timer);
    proc.once('close', clearForceKillTimer);
    if (!this.isRunning(proc)) {
      clearForceKillTimer();
    }
  }

  killTree(proc: ChildProcess, signal: NodeJS.Signals): void {
    if (!proc.pid) {
      try {
        proc.kill(signal);
      } catch {
        // Process may already be dead.
      }
      return;
    }

    if (this.platform === 'win32') {
      const args = ['/pid', String(proc.pid), '/T'];
      if (signal === 'SIGKILL') {
        args.push('/F');
      }
      try {
        this.spawnImpl('taskkill', args, { stdio: 'ignore', windowsHide: true });
      } catch {
        try {
          proc.kill(signal);
        } catch {
          // Process may already be dead.
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
        // Process may already be dead.
      }
    }
  }

  isRunning(proc: ChildProcess): boolean {
    return proc.exitCode === null && proc.signalCode === null;
  }

  private spawnProcess(
    command: string,
    args: string[],
    cwd: string | undefined,
    env: NodeJS.ProcessEnv,
    stdio: StdioOptions,
    detachProcessGroup: boolean
  ): ChildProcess {
    return this.spawnImpl(command, args, {
      cwd,
      env,
      detached: detachProcessGroup && this.platform !== 'win32',
      stdio,
      windowsHide: true,
    });
  }
}
