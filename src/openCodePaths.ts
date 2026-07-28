import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface OpenCodePathOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
  exists?: (candidate: string) => boolean;
}

export interface OpenCodePaths {
  configPath: string;
  stateHome: string;
  cacheHome: string;
  modelStatePath: string;
  modelMetadataPath: string;
}

export function resolveOpenCodePaths(options: OpenCodePathOptions = {}): OpenCodePaths {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const exists = options.exists ?? fs.existsSync;
  const homeDir = resolveHomeDir(options, env, platform, pathApi);
  const legacyConfigPath = pathApi.join(homeDir, '.config', 'opencode', 'opencode.json');

  const configCandidates =
    platform === 'win32'
      ? [
          joinAbsolute(pathApi, env.APPDATA, 'opencode', 'opencode.json'),
          legacyConfigPath,
        ]
      : [
          joinAbsolute(pathApi, env.XDG_CONFIG_HOME, 'opencode', 'opencode.json'),
          legacyConfigPath,
          platform === 'darwin'
            ? pathApi.join(
                homeDir,
                'Library',
                'Application Support',
                'opencode',
                'opencode.json'
              )
            : undefined,
        ];
  const validConfigCandidates = configCandidates.filter(
    (candidate): candidate is string => Boolean(candidate)
  );
  const configPath =
    validConfigCandidates.find((candidate) => safeExists(exists, candidate)) ??
    validConfigCandidates[0] ??
    legacyConfigPath;

  const localAppData =
    platform === 'win32' ? usableAbsolutePath(env.LOCALAPPDATA, pathApi) : undefined;
  const stateHome =
    platform === 'win32'
      ? localAppData ?? pathApi.join(homeDir, '.local', 'state')
      : usableAbsolutePath(env.XDG_STATE_HOME, pathApi) ??
        pathApi.join(homeDir, '.local', 'state');
  const cacheHome =
    platform === 'win32'
      ? localAppData ?? pathApi.join(homeDir, '.cache')
      : usableAbsolutePath(env.XDG_CACHE_HOME, pathApi) ?? pathApi.join(homeDir, '.cache');

  return {
    configPath,
    stateHome,
    cacheHome,
    modelStatePath: pathApi.join(stateHome, 'opencode', 'model.json'),
    modelMetadataPath: pathApi.join(cacheHome, 'opencode', 'models.json'),
  };
}

function resolveHomeDir(
  options: OpenCodePathOptions,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  pathApi: typeof path.posix | typeof path.win32
): string {
  const candidates =
    platform === 'win32'
      ? [options.homeDir, env.USERPROFILE, env.HOME, os.homedir()]
      : [options.homeDir, env.HOME, os.homedir(), env.USERPROFILE];
  return (
    candidates
      .map((candidate) => usableAbsolutePath(candidate, pathApi))
      .find((candidate): candidate is string => Boolean(candidate)) ??
    pathApi.resolve(os.tmpdir())
  );
}

function joinAbsolute(
  pathApi: typeof path.posix | typeof path.win32,
  base: string | undefined,
  ...parts: string[]
): string | undefined {
  const usableBase = usableAbsolutePath(base, pathApi);
  return usableBase ? pathApi.join(usableBase, ...parts) : undefined;
}

function usableAbsolutePath(
  value: string | undefined,
  pathApi: typeof path.posix | typeof path.win32
): string | undefined {
  const trimmed = String(value || '').trim();
  return trimmed && trimmed !== 'undefined' && trimmed !== 'null' && pathApi.isAbsolute(trimmed)
    ? trimmed
    : undefined;
}

function safeExists(exists: (candidate: string) => boolean, candidate: string): boolean {
  try {
    return exists(candidate);
  } catch {
    return false;
  }
}
