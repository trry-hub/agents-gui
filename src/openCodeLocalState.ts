import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseOpenCodeModelMetadata,
  parseOpenCodeModelState,
  type OpenCodeModelMetadataMap,
  type OpenCodeModelState,
} from './opencodeAgents';

export interface OpenCodeLocalStatePaths {
  stateHome: string;
  cacheHome: string;
  modelStatePath: string;
  modelMetadataPath: string;
}

export interface OpenCodeLocalStateOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
}

export class OpenCodeLocalState {
  constructor(private readonly options: OpenCodeLocalStateOptions = {}) {}

  paths(): OpenCodeLocalStatePaths {
    const stateHome = this.stateHome();
    const cacheHome = this.cacheHome();
    return {
      stateHome,
      cacheHome,
      modelStatePath: path.join(stateHome, 'opencode', 'model.json'),
      modelMetadataPath: path.join(cacheHome, 'opencode', 'models.json'),
    };
  }

  readModelState(): OpenCodeModelState {
    try {
      return parseOpenCodeModelState(
        JSON.parse(fs.readFileSync(this.paths().modelStatePath, 'utf8'))
      );
    } catch {
      return { recentModelIds: [], variants: {} };
    }
  }

  readModelMetadata(): OpenCodeModelMetadataMap {
    try {
      return parseOpenCodeModelMetadata(
        JSON.parse(fs.readFileSync(this.paths().modelMetadataPath, 'utf8'))
      );
    } catch {
      return {};
    }
  }

  async updateModelVariant(modelId: string, variant: string): Promise<void> {
    const modelStatePath = this.paths().modelStatePath;
    const state = await this.readModelStateRecord(modelStatePath);
    const existingVariants =
      state.variant && typeof state.variant === 'object' && !Array.isArray(state.variant)
        ? (state.variant as Record<string, unknown>)
        : {};
    state.variant = {
      ...existingVariants,
      [modelId]: variant,
    };

    await fs.promises.mkdir(path.dirname(modelStatePath), { recursive: true });
    await fs.promises.writeFile(modelStatePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }

  private async readModelStateRecord(modelStatePath: string): Promise<Record<string, unknown>> {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(modelStatePath, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private stateHome(): string {
    const env = this.options.env ?? process.env;
    const platform = this.options.platform ?? process.platform;
    const localAppData = platform === 'win32' ? usableAbsolutePath(env.LOCALAPPDATA) : undefined;
    return (
      usableAbsolutePath(env.XDG_STATE_HOME) ??
      localAppData ??
      path.join(this.homeDir(), '.local', 'state')
    );
  }

  private cacheHome(): string {
    const env = this.options.env ?? process.env;
    const platform = this.options.platform ?? process.platform;
    const localAppData = platform === 'win32' ? usableAbsolutePath(env.LOCALAPPDATA) : undefined;
    return (
      usableAbsolutePath(env.XDG_CACHE_HOME) ?? localAppData ?? path.join(this.homeDir(), '.cache')
    );
  }

  private homeDir(): string {
    return (
      usableAbsolutePath(this.options.homeDir) ??
      usableAbsolutePath(os.homedir()) ??
      usableAbsolutePath(this.options.env?.HOME) ??
      usableAbsolutePath(this.options.env?.USERPROFILE) ??
      os.tmpdir()
    );
  }
}

function usableAbsolutePath(value: string | undefined): string | undefined {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null' || !path.isAbsolute(trimmed)) {
    return undefined;
  }
  return trimmed;
}
