import * as fs from 'fs';
import * as path from 'path';
import { CliProcessRunner } from './cliProcessRunner';
import type { CliAgentMode, CliConfiguredModel, CliProfile } from './cliProfiles';
import {
  getLoginShellLookupArgs,
  normalizeCommandPathOutput,
  withCliLookupPath,
} from './cliPathResolver';
import {
  type OpenCodeAgentDiscovery,
  parseOpenCodeDebugConfigOutput,
  parseOpenCodeModelsOutput,
} from './opencodeAgents';

export interface CliDiscoveryOptions {
  workspaceRoot(): string;
  processRunner?: CliProcessRunner;
}

export interface CliProfileStatusOptions {
  force?: boolean;
}
const PROFILE_STATUS_CACHE_MS = 300_000;
const COMMAND_VERSION_OUTPUT_LIMIT = 32_768;
const MAX_COMMAND_VERSION_TOKEN_LENGTH = 128;
const MAX_COMMAND_VERSION_COMPONENT_DIGITS = 16;
const MAX_COMMAND_VERSION_SUFFIX_LENGTH = 64;

export class CliDiscovery {
  private commandPathCache = new Map<string, string>();
  private profileStatusCache?: { key: string; createdAt: number; profiles: CliProfile[] };
  private profileStatusInflight?: { key: string; promise: Promise<CliProfile[]> };
  private readonly processRunner: CliProcessRunner;

  constructor(private readonly options: CliDiscoveryOptions) {
    this.processRunner = options.processRunner ?? new CliProcessRunner();
  }

  async checkInstalled(profile: CliProfile | undefined): Promise<boolean> {
    return Boolean(profile && (await this.resolveCommandPath(profile.command)));
  }

  async getProfilesWithStatus(
    baseProfiles: CliProfile[],
    options: CliProfileStatusOptions = {}
  ): Promise<CliProfile[]> {
    const key = this.profileStatusCacheKey(baseProfiles);
    const now = Date.now();
    if (
      !options.force &&
      this.profileStatusCache?.key === key &&
      now - this.profileStatusCache.createdAt < PROFILE_STATUS_CACHE_MS
    )
      return cloneCliProfiles(this.profileStatusCache.profiles);
    if (!options.force && this.profileStatusInflight?.key === key)
      return cloneCliProfiles(await this.profileStatusInflight.promise);
    const promise = this.loadProfilesWithStatus(baseProfiles);
    this.profileStatusInflight = { key, promise };
    try {
      const profiles = await promise;
      this.profileStatusCache = {
        key,
        createdAt: Date.now(),
        profiles: cloneCliProfiles(profiles),
      };
      return cloneCliProfiles(profiles);
    } finally {
      if (this.profileStatusInflight?.promise === promise) this.profileStatusInflight = undefined;
    }
  }

  private async loadProfilesWithStatus(baseProfiles: CliProfile[]): Promise<CliProfile[]> {
    return Promise.all(
      baseProfiles.map(async (base) => {
        const installed = await this.checkInstalled(base);
        let profile: CliProfile = {
          ...base,
          installed,
          version: installed ? await this.getCommandVersion(base) : undefined,
        };
        if (installed && base.id === 'opencode')
          profile = await this.discoverOpenCodeProfile(profile);
        return profile;
      })
    );
  }

  private async discoverOpenCodeProfile(profile: CliProfile): Promise<CliProfile> {
    const command = await this.resolveCommandPath(profile.command);
    if (!command) return profile;
    const [agentDiscovery, models] = await Promise.all([
      this.getOpenCodeAgentModes(command).catch((): OpenCodeAgentDiscovery => ({ modes: [] })),
      this.getOpenCodeModelOptions(command).catch(() => []),
    ]);
    const agentModes =
      agentDiscovery.modes.length > 0
        ? mergeOpenCodeAgentModes(profile.agentModes, agentDiscovery.modes)
        : profile.agentModes;
    const configuredModel = selectConfiguredModel(models, agentDiscovery.defaultModelId);
    return {
      ...profile,
      agentModes,
      defaultAgentMode:
        agentModes.find((mode) => mode.id === agentDiscovery.defaultAgentId)?.id ??
        profile.defaultAgentMode,
      ...(configuredModel ? { configuredModel } : {}),
    };
  }

  private profileStatusCacheKey(baseProfiles: CliProfile[]): string {
    return [
      this.options.workspaceRoot(),
      ...baseProfiles.map((profile) =>
        [profile.id, profile.command, (profile.versionArgs ?? ['--version']).join(' ')].join(':')
      ),
    ].join('|');
  }

  async resolveCommandPath(command: string): Promise<string | undefined> {
    const cached = this.commandPathCache.get(command);
    if (cached) {
      if (await this.isUsableCommandPath(cached)) return cached;
      this.commandPathCache.delete(command);
    }
    const direct = await this.cacheUsableCommandPath(
      command,
      await this.lookupCommandInPath(command)
    );
    if (direct) return direct;
    if (process.platform === 'win32') return undefined;
    return this.cacheUsableCommandPath(
      command,
      await this.lookupCommandInLoginShell(command, process.env.SHELL || '/bin/zsh')
    );
  }

  evictCommandPath(command: string): void {
    this.commandPathCache.delete(command);
  }

  private async cacheUsableCommandPath(
    command: string,
    commandPath: string | undefined
  ): Promise<string | undefined> {
    if (!commandPath || !(await this.isUsableCommandPath(commandPath))) return undefined;
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
    return this.collectProbe(process.platform === 'win32' ? 'where' : 'which', [command], {
      env: withCliLookupPath(process.env),
      stderr: 'ignore',
    })
      .then(({ code, output }) =>
        code === 0 ? normalizeCommandPathOutput(output, process.platform) : undefined
      )
      .catch(() => undefined);
  }

  private lookupCommandInLoginShell(
    command: string,
    shellPath: string
  ): Promise<string | undefined> {
    return this.collectProbe(shellPath, getLoginShellLookupArgs(command, shellPath), {
      env: withCliLookupPath(process.env),
      stderr: 'ignore',
    })
      .then(({ code, output }) =>
        code === 0 ? normalizeCommandPathOutput(output, process.platform) : undefined
      )
      .catch(() => undefined);
  }

  private async getOpenCodeAgentModes(command: string) {
    const cwd = this.options.workspaceRoot();
    return this.getOpenCodeAgentModesFromDebugConfig(command, cwd);
  }

  private async getOpenCodeAgentModesFromDebugConfig(command: string, cwd: string) {
    const commandDir = path.isAbsolute(command) ? path.dirname(command) : undefined;
    const result = await this.collectProbe(
      command,
      ['debug', 'config'],
      { cwd, env: withCliLookupPath(process.env, [commandDir]), stderr: 'ignore' },
      5000,
      2_000_000
    );
    return parseOpenCodeDebugConfigOutput(result.output);
  }

  private async getOpenCodeModelOptions(command: string): Promise<CliConfiguredModel[]> {
    const cwd = this.options.workspaceRoot();
    const commandDir = path.isAbsolute(command) ? path.dirname(command) : undefined;
    const result = await this.collectProbe(
      command,
      ['models'],
      { cwd, env: withCliLookupPath(process.env, [commandDir]), stderr: 'ignore' },
      5000,
      1_000_000
    );
    return parseOpenCodeModelsOutput(result.output);
  }

  private getCommandVersion(profile: CliProfile): Promise<string | undefined> {
    return this.resolveCommandPath(profile.command).then(async (command) => {
      if (!command) return undefined;
      const commandDir = path.isAbsolute(command) ? path.dirname(command) : undefined;
      try {
        const result = await this.collectProbe(
          command,
          profile.versionArgs ?? ['--version'],
          { env: withCliLookupPath(process.env, [commandDir]), stderr: 'pipe' },
          1800,
          COMMAND_VERSION_OUTPUT_LIMIT
        );
        return normalizeCommandVersionOutput(result.output);
      } catch {
        return undefined;
      }
    });
  }

  private collectProbe(
    command: string,
    args: string[],
    options: { cwd?: string; env: NodeJS.ProcessEnv; stderr?: 'ignore' | 'pipe' },
    timeoutMs = 0,
    outputLimit = Number.POSITIVE_INFINITY
  ): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve, reject) => {
      const proc = this.processRunner.spawnProbeProcess(command, args, options);
      let output = '';
      let outputBytes = 0;
      let settled = false;
      const finish = (value: { code: number | null; output: string }, error?: Error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (error) {
          reject(error);
        } else {
          resolve(value);
        }
      };
      const timer = timeoutMs
        ? setTimeout(() => {
            this.processRunner.terminate(proc);
            finish({ code: null, output });
          }, timeoutMs)
        : undefined;
      const append = (data: Buffer) => {
        if (data.byteLength > outputLimit - outputBytes) {
          this.processRunner.terminate(proc);
          finish({ code: null, output });
          return;
        }
        output += data.toString();
        outputBytes += data.byteLength;
      };
      proc.stdout?.on('data', append);
      proc.stderr?.on('data', append);
      proc.on('close', (code) => finish({ code, output }));
      proc.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') this.evictCommandPath(command);
        finish({ code: null, output }, error);
      });
    });
  }
}

function cloneCliProfiles(profiles: CliProfile[]): CliProfile[] {
  return profiles.map((profile) => ({
    ...profile,
    configuredModel: profile.configuredModel ? { ...profile.configuredModel } : undefined,
    agentModes: profile.agentModes.map((mode) => ({ ...mode })),
    slashCommands: profile.slashCommands?.map((command) => ({
      ...command,
      aliases: command.aliases ? [...command.aliases] : undefined,
    })),
    capabilities: [...profile.capabilities],
    promptArgs: [...profile.promptArgs],
  }));
}

function mergeOpenCodeAgentModes(
  baseModes: CliAgentMode[],
  discoveredModes: CliAgentMode[]
): CliAgentMode[] {
  const merged = [...baseModes];
  for (const mode of discoveredModes) {
    const index = merged.findIndex((item) => item.id === mode.id);
    if (index >= 0) merged[index] = mode;
    else merged.push(mode);
  }
  return merged;
}

function selectConfiguredModel(
  models: CliConfiguredModel[],
  configuredId?: string
): CliConfiguredModel | undefined {
  return (
    models.find((model) => model.id === configuredId) ??
    (configuredId ? { id: configuredId, label: configuredId } : undefined)
  );
}

export function normalizeCommandVersionOutput(output: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  const ansiPattern = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;
  const clean = output.replace(ansiPattern, '');
  const candidates = clean.matchAll(/\b(?:v\d|\d)[0-9A-Za-z.+-]*\b/g);
  for (const candidate of candidates) {
    const token = candidate[0].replace(/^v/i, '');
    if (token.length > MAX_COMMAND_VERSION_TOKEN_LENGTH) continue;
    const component = `\\d{1,${MAX_COMMAND_VERSION_COMPONENT_DIGITS}}`;
    const suffix = `[0-9A-Za-z.-]{1,${MAX_COMMAND_VERSION_SUFFIX_LENGTH}}`;
    if (new RegExp(`^${component}(?:\\.${component}){1,3}(?:[-+]${suffix})?$`).test(token))
      return token;
  }
  return undefined;
}
