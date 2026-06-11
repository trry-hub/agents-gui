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
  OpenCodeModelMetadataMap,
  OpenCodeModelState,
  parseOpenCodeDebugConfigOutput,
  parseOpenCodeAgentListLine,
  parseOpenCodeModelMetadata,
  parseOpenCodeModelState,
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
          let modelState: OpenCodeModelState = { recentModelIds: [], variants: {} };
          let modelMetadata: OpenCodeModelMetadataMap = {};
          let discoveredModels: CliModelOption[] = [];
          if (command) {
            modelState = this.getOpenCodeModelState();
            modelMetadata = this.getOpenCodeModelMetadata();
            [discovery, discoveredModels] = await Promise.all([
              this.getOpenCodeAgentModes(command),
              this.getOpenCodeModelOptions(command),
            ]);
          }
          const agentModes = discovery.modes;
          if (agentModes.length > 0) {
            const mergedAgentModes = mergeOpenCodeAgentModes(
              profile.agentModes,
              agentModes,
              discovery.defaultAgentId,
              { includeBaseWhenDiscovered: true }
            );
            profile = {
              ...profile,
              agentModes: mergedAgentModes,
              defaultAgentMode: pickOpenCodeDefaultAgentMode(mergedAgentModes, discovery.defaultAgentId),
            };
          }
          if (discoveredModels.length > 0) {
            const modelOptions = mergeOpenCodeModelOptions(
              profile.modelOptions ?? [],
              discoveredModels,
              discovery.defaultModelId ?? modelState.currentModelId,
              modelState.variants,
              modelMetadata
            );
            profile = {
              ...profile,
              modelOptions,
              defaultModel: 'configured',
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
    const listModes = filterOpenCodeVisibleAgentModes(
      await this.getOpenCodeAgentModesFromCliList(command, cwd),
      discovery.modelBoundAgentIds
    );
    if (listModes.length > 0) {
      return {
        ...discovery,
        modes: mergeOpenCodeAgentModes(
          discovery.modes,
          listModes,
          discovery.defaultAgentId,
          { includeBaseWhenDiscovered: true }
        ),
      };
    }

    return {
      ...discovery,
      modes: filterOpenCodeVisibleAgentModes(discovery.modes, discovery.modelBoundAgentIds),
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

  private getOpenCodeModelState(): OpenCodeModelState {
    const statePath = path.join(os.homedir(), '.local', 'state', 'opencode', 'model.json');
    try {
      return parseOpenCodeModelState(JSON.parse(fs.readFileSync(statePath, 'utf8')));
    } catch {
      return { recentModelIds: [], variants: {} };
    }
  }

  private getOpenCodeModelMetadata(): OpenCodeModelMetadataMap {
    const statePath = path.join(os.homedir(), '.cache', 'opencode', 'models.json');
    try {
      return parseOpenCodeModelMetadata(JSON.parse(fs.readFileSync(statePath, 'utf8')));
    } catch {
      return {};
    }
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

function mergeOpenCodeAgentModes(
  baseModes: CliAgentMode[],
  discoveredModes: CliAgentMode[],
  configuredAgentId?: string,
  options: { includeBaseWhenDiscovered?: boolean } = {}
): CliAgentMode[] {
  const baseVisibleModes = discoveredModes.length > 0 && !options.includeBaseWhenDiscovered
    ? []
    : baseModes;
  const seen = new Set<string>();
  const merged: CliAgentMode[] = [];
  for (const group of [baseVisibleModes, discoveredModes]) {
    for (const mode of group) {
      if (seen.has(mode.id)) {
        continue;
      }

      seen.add(mode.id);
      merged.push(decorateOpenCodeConfiguredAgentMode(mode, configuredAgentId));
    }
  }
  return merged;
}

function filterOpenCodeVisibleAgentModes(
  modes: CliAgentMode[],
  modelBoundAgentIds: string[] | undefined
): CliAgentMode[] {
  const hidden = new Set(modelBoundAgentIds ?? []);
  return orderOpenCodeAgentModes(modes.filter((mode) => !hidden.has(mode.id)));
}

function orderOpenCodeAgentModes(modes: CliAgentMode[]): CliAgentMode[] {
  const priority = new Map<string, number>([
    ['build', 0],
    ['plan', 1],
  ]);
  return modes
    .map((mode, index) => ({ mode, index }))
    .sort((left, right) => {
      const leftPriority = priority.get(left.mode.id) ?? 100;
      const rightPriority = priority.get(right.mode.id) ?? 100;
      return leftPriority - rightPriority || left.index - right.index;
    })
    .map((item) => item.mode);
}

function pickOpenCodeDefaultAgentMode(
  modes: CliAgentMode[],
  configuredAgentId: string | undefined
): string {
  const selectableModes = modes.filter((mode) => !mode.disabled);
  return selectableModes.find((mode) => mode.id === configuredAgentId)?.id
    ?? selectableModes.find((mode) => mode.id === 'build')?.id
    ?? selectableModes[0]?.id
    ?? 'configured';
}

function decorateOpenCodeConfiguredAgentMode(
  mode: CliAgentMode,
  configuredAgentId: string | undefined
): CliAgentMode {
  if (mode.id !== 'configured' || !configuredAgentId) {
    return mode;
  }

  return {
    ...mode,
    description: `${mode.description} Current OpenCode configured agent: ${configuredAgentId}.`,
  };
}

function mergeOpenCodeModelOptions(
  baseOptions: CliModelOption[],
  discoveredOptions: CliModelOption[],
  configuredModelId?: string,
  variants: Record<string, string> = {},
  modelMetadata: OpenCodeModelMetadataMap = {}
): CliModelOption[] {
  const baseVisibleOptions = discoveredOptions.length > 0
    ? baseOptions.filter((option) => option.id !== 'default')
    : baseOptions;
  const defaultOptions = baseVisibleOptions.filter((option) => !option.custom);
  const customOptions = baseVisibleOptions.filter((option) => option.custom);
  const seen = new Set<string>();
  const merged: CliModelOption[] = [];
  const variantOptionsByModel = new Map<string, string[]>();
  for (const option of [...baseOptions, ...discoveredOptions]) {
    const variantOptions = normalizeOpenCodeVariantOptions(option.variantOptions);
    if (variantOptions.length > 0) {
      variantOptionsByModel.set(option.id, variantOptions);
    }
  }

  for (const option of [...defaultOptions, ...discoveredOptions, ...customOptions]) {
    if (seen.has(option.id)) {
      continue;
    }

    seen.add(option.id);
    merged.push(decorateOpenCodeModelOption(
      option,
      configuredModelId,
      variants,
      modelMetadata,
      variantOptionsByModel
    ));
  }

  return merged;
}

function decorateOpenCodeModelOption(
  option: CliModelOption,
  configuredModelId: string | undefined,
  variants: Record<string, string>,
  modelMetadata: OpenCodeModelMetadataMap,
  variantOptionsByModel: Map<string, string[]>
): CliModelOption {
  const variant = variants[option.id];
  const variantOptions = variantOptionsByModel.get(option.id)
    ?? normalizeOpenCodeVariantOptions(modelMetadata[option.id]?.variantOptions);
  if (option.id !== 'configured') {
    return {
      ...option,
      ...(variant ? { variant } : {}),
      ...(variantOptions.length > 0 ? { variantOptions } : {}),
      description: variant
        ? `${option.description} Current OpenCode variant: ${variant}.`
        : option.description,
    };
  }

  if (!configuredModelId) {
    return option;
  }

  const configuredVariantOptions = variantOptionsByModel.get(configuredModelId)
    ?? normalizeOpenCodeVariantOptions(modelMetadata[configuredModelId]?.variantOptions);
  const [, ...modelParts] = configuredModelId.split('/');
  const summaryLabel = formatConfiguredOpenCodeModelSummary(
    modelParts.join('/') || configuredModelId,
    variants[configuredModelId]
  );
  const variantText = variants[configuredModelId]
    ? ` Current OpenCode variant: ${variants[configuredModelId]}.`
    : '';
  return {
    ...option,
    configuredModelId,
    summaryLabel,
    variant: variants[configuredModelId],
    ...(configuredVariantOptions.length > 0 ? { variantOptions: configuredVariantOptions } : {}),
    description: `${option.description} Current OpenCode configured model: ${configuredModelId}.${variantText}`,
  };
}

function formatConfiguredOpenCodeModelSummary(modelLabel: string, variant: string | undefined): string {
  return variant ? `${modelLabel} · ${variant}` : modelLabel;
}

function normalizeOpenCodeVariantOptions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }

    const cleanItem = item.trim();
    if (!cleanItem || seen.has(cleanItem)) {
      continue;
    }

    seen.add(cleanItem);
    result.push(cleanItem);
  }
  return result;
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
