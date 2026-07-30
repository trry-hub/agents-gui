import * as path from 'path';

export interface CliLookupPathOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function getLoginShellLookupArgs(command: string, shellPath: string): string[] {
  const lookup = `command -v ${shellQuote(command)}`;
  const shellName = path.basename(shellPath);
  return shellName.includes('zsh') ? ['-lic', lookup] : ['-lc', lookup];
}

export function buildCliLookupPath(options: CliLookupPathOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const homeDir =
    options.homeDir ||
    readEnvValue(env, 'USERPROFILE', platform) ||
    readEnvValue(env, 'HOME', platform) ||
    '';
  const envPath = readEnvValue(env, 'PATH', platform) || '';

  if (platform === 'win32') {
    const appData = readEnvValue(env, 'APPDATA', platform);
    const localAppData = readEnvValue(env, 'LOCALAPPDATA', platform);
    const programData = readEnvValue(env, 'ProgramData', platform);
    return mergePathEntries(
      [
        envPath,
        appData && pathApi.join(appData, 'npm'),
        localAppData && pathApi.join(localAppData, 'Programs'),
        localAppData && pathApi.join(localAppData, 'Microsoft', 'WindowsApps'),
        homeDir && pathApi.join(homeDir, 'scoop', 'shims'),
        programData && pathApi.join(programData, 'chocolatey', 'bin'),
        homeDir && pathApi.join(homeDir, '.local', 'bin'),
        appData && pathApi.join(appData, 'Python', 'Scripts'),
        localAppData && pathApi.join(localAppData, 'Programs', 'Python', 'Scripts'),
      ],
      platform
    );
  }

  return mergePathEntries(
    [
      envPath,
      homeDir && pathApi.join(homeDir, '.local', 'bin'),
      homeDir && pathApi.join(homeDir, '.npm-global', 'bin'),
      homeDir && pathApi.join(homeDir, '.yarn', 'bin'),
      homeDir && pathApi.join(homeDir, '.bun', 'bin'),
      homeDir && pathApi.join(homeDir, '.cargo', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ],
    platform
  );
}

export function mergePathEntries(
  entries: Array<string | undefined>,
  platform: NodeJS.Platform = process.platform
): string {
  const delimiter = platform === 'win32' ? path.win32.delimiter : path.posix.delimiter;
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const rawEntry of entries) {
    for (const rawPart of String(rawEntry || '').split(delimiter)) {
      const value = rawPart.trim();
      const key = platform === 'win32' ? value.toLowerCase() : value;
      if (!value || seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(value);
    }
  }

  return merged.join(delimiter);
}

export function withCliLookupPath(
  sourceEnv: NodeJS.ProcessEnv = process.env,
  extraEntries: Array<string | undefined> = [],
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    const isPathKey = platform === 'win32' ? key.toLowerCase() === 'path' : key === 'PATH';
    if (!isPathKey) {
      env[key] = value;
    }
  }
  env.PATH = mergePathEntries(
    [
      ...extraEntries,
      buildCliLookupPath({
        env: sourceEnv,
        platform,
      }),
    ],
    platform
  );
  return env;
}

/** Preserve the inherited environment while making one resolved CLI executable discoverable. */
export function withCommandDirectoryPath(
  sourceEnv: NodeJS.ProcessEnv = process.env,
  commandDir: string | undefined,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const delimiter = platform === 'win32' ? path.win32.delimiter : path.posix.delimiter;
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    const isPathKey = platform === 'win32' ? key.toLowerCase() === 'path' : key === 'PATH';
    if (!isPathKey) env[key] = value;
  }
  const inheritedPath = readRawEnvValue(sourceEnv, 'PATH', platform);
  if (commandDir !== undefined && inheritedPath !== undefined) {
    env.PATH = `${commandDir}${delimiter}${inheritedPath}`;
  } else if (commandDir !== undefined) {
    env.PATH = commandDir;
  } else if (inheritedPath !== undefined) {
    env.PATH = inheritedPath;
  }
  return env;
}

export function normalizeCommandPathOutput(
  output: string,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  const candidates = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => isCommandPath(line, platform));

  if (platform !== 'win32') {
    return candidates[0];
  }

  return candidates
    .map((value, index) => ({ value, index, rank: windowsExtensionRank(value) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)[0]?.value;
}

function readEnvValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string {
  return readRawEnvValue(env, name, platform)?.trim() ?? '';
}

function readRawEnvValue(
  env: NodeJS.ProcessEnv,
  name: string,
  platform: NodeJS.Platform
): string | undefined {
  const key =
    platform === 'win32'
      ? Object.keys(env)
          .reverse()
          .find((candidate) => candidate.toLowerCase() === name.toLowerCase())
      : Object.hasOwn(env, name)
        ? name
        : undefined;
  return key !== undefined && typeof env[key] === 'string' ? env[key] : undefined;
}

function isCommandPath(value: string, platform: NodeJS.Platform): boolean {
  if (platform === 'win32') {
    return path.win32.isAbsolute(value) || /^\\\\[^\\]+\\[^\\]+/.test(value);
  }
  return path.posix.isAbsolute(value);
}

function windowsExtensionRank(value: string): number {
  switch (path.win32.extname(value).toLowerCase()) {
    case '.exe':
    case '.com':
      return 0;
    case '.cmd':
      return 1;
    case '.bat':
      return 2;
    default:
      return 3;
  }
}
