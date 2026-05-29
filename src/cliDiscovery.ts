import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CliAgentMode, CliModelOption, CliProfile } from './cliProfiles';
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
  parseOpenCodeModelsOutput,
} from './opencodeAgents';
import type { OpenCodeServerClient } from './openCodeServerClient';

interface CliDiscoveryOptions {
  workspaceRoot(): string;
  openCodeClient: OpenCodeServerClient;
}

export class CliDiscovery {
  private commandPathCache = new Map<string, string>();

  constructor(private readonly options: CliDiscoveryOptions) {}

  async checkInstalled(profile: CliProfile | undefined): Promise<boolean> {
    if (!profile) {
      return false;
    }

    return Boolean(await this.resolveCommandPath(profile.command));
  }

  async getProfilesWithStatus(baseProfiles: CliProfile[]): Promise<CliProfile[]> {
    const results = await Promise.all(
      baseProfiles.map(async (p) => {
        const installed = await this.checkInstalled(p);
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

  async resolveCommandPath(command: string): Promise<string | undefined> {
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

  evictCommandPath(command: string): void {
    this.commandPathCache.delete(command);
  }

  expandProfileEnv(
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

  private async getOpenCodeAgentModes(command: string): Promise<OpenCodeAgentDiscovery> {
    const cwd = this.options.workspaceRoot();
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
    const cwd = this.options.workspaceRoot();
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

      void this.options.openCodeClient.fetchModelOptions(cwd)
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
            ...this.expandProfileEnv(profile.env, this.options.workspaceRoot()),
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
}

export function stableHash(value: string): number {
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
