import { spawn, type ChildProcess, type StdioOptions } from 'child_process';

export type CliProcessStdin = 'ignore' | 'pipe';

const PROCESS_TERMINATE_GRACE_MS = 1500;

export class CliProcessRunner {
  private forceKillTimers = new WeakMap<ChildProcess, NodeJS.Timeout>();

  spawnPromptProcess(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    stdin: CliProcessStdin
  ): ChildProcess {
    return this.spawnProcess(command, args, cwd, env, [stdin, 'pipe', 'pipe']);
  }

  spawnBackgroundProcess(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv
  ): ChildProcess {
    return this.spawnProcess(command, args, cwd, env, ['ignore', 'ignore', 'ignore']);
  }

  terminate(proc: ChildProcess): void {
    if (!this.isRunning(proc)) {
      return;
    }

    this.killTree(proc, 'SIGTERM');
    if (this.forceKillTimers.has(proc)) {
      return;
    }

    const timer = setTimeout(() => {
      this.forceKillTimers.delete(proc);
      this.killTree(proc, 'SIGKILL');
    }, PROCESS_TERMINATE_GRACE_MS);
    this.forceKillTimers.set(proc, timer);
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
    cwd: string,
    env: NodeJS.ProcessEnv,
    stdio: StdioOptions
  ): ChildProcess {
    return spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== 'win32',
      stdio,
    });
  }
}
