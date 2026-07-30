import * as fs from 'fs';
import { resolveOpenCodePaths, type OpenCodePathOptions } from './openCodePaths';

const SYNC_MARKER = '__agents_gui_synced';
export const OPENCODE_NATIVE_PASSTHROUGH_CLEANUP_KEY =
  'agents-gui.migration.openCodeNativePassthroughCleanup.v1';

export interface OpenCodeConfigCleanupOptions extends OpenCodePathOptions {
  configPath?: string;
  now?: () => Date;
}

export type OpenCodeCleanupResult = {
  changed: boolean;
  removedProviderKeys: string[];
  removedTopLevelModel: boolean;
  backupPath?: string;
};

export interface LocalMigrationState {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export class OpenCodeConfigCleanupMigration {
  private readonly configPath: string;
  private readonly now: () => Date;

  constructor(options: OpenCodeConfigCleanupOptions = {}) {
    this.configPath = options.configPath ?? resolveOpenCodePaths(options).configPath;
    this.now = options.now ?? (() => new Date());
  }

  async cleanup(): Promise<OpenCodeCleanupResult> {
    const existing = await this.readConfig();
    if (!existing) {
      return { changed: false, removedProviderKeys: [], removedTopLevelModel: false };
    }

    const providers = isRecord(existing.provider) ? { ...existing.provider } : {};
    const removedProviderKeys = Object.entries(providers)
      .filter(([, entry]) => isRecord(entry) && entry[SYNC_MARKER] === true)
      .map(([key]) => key)
      .sort();
    if (removedProviderKeys.length === 0) {
      return { changed: false, removedProviderKeys: [], removedTopLevelModel: false };
    }

    for (const key of removedProviderKeys) {
      delete providers[key];
    }
    const model = typeof existing.model === 'string' ? existing.model : undefined;
    const removedTopLevelModel = Boolean(
      model && removedProviderKeys.some((key) => model === key || model.startsWith(`${key}/`))
    );
    const next: Record<string, unknown> = { ...existing, provider: providers };
    if (removedTopLevelModel) {
      delete next.model;
    }

    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.configPath}.agents-gui-native-cli-bak-${stamp}`;
    await fs.promises.copyFile(this.configPath, backupPath);
    await fs.promises.writeFile(this.configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return { changed: true, removedProviderKeys, removedTopLevelModel, backupPath };
  }

  private async readConfig(): Promise<Record<string, unknown> | undefined> {
    try {
      const parsed: unknown = JSON.parse(await fs.promises.readFile(this.configPath, 'utf8'));
      if (!isRecord(parsed)) {
        throw new Error(`OpenCode config is not an object: ${this.configPath}`);
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }
}

export async function runOpenCodeCleanupOnce(
  state: LocalMigrationState,
  migration: Pick<OpenCodeConfigCleanupMigration, 'cleanup'>
): Promise<OpenCodeCleanupResult | undefined> {
  if (state.get<boolean>(OPENCODE_NATIVE_PASSTHROUGH_CLEANUP_KEY)) {
    return undefined;
  }
  const result = await migration.cleanup();
  await state.update(OPENCODE_NATIVE_PASSTHROUGH_CLEANUP_KEY, true);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
