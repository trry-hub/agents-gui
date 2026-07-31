import * as fs from 'fs';
import * as path from 'path';
import { acquireOpenCodeCleanupLock, type OpenCodeCleanupLockOptions } from './openCodeCleanupLock';
import { resolveOpenCodePaths, type OpenCodePathOptions } from './openCodePaths';

const SYNC_MARKER = '__agents_gui_synced';
const LOCK_SUFFIX = '.agents-gui-native-cli.lock';
const TEMP_MARKER = '.agents-gui-native-cli-tmp-';
const DEFAULT_LOCK_RETRY_ATTEMPTS = 80;
const DEFAULT_LOCK_RETRY_DELAY_MS = 25;
const MAX_BACKUP_COLLISION_ATTEMPTS = 1_000;
const MAX_TEMP_COLLISION_ATTEMPTS = 100;
export const OPENCODE_NATIVE_PASSTHROUGH_CLEANUP_KEY =
  'agents-gui.migration.openCodeNativePassthroughCleanup.v1';

export interface OpenCodeConfigCleanupOptions extends OpenCodePathOptions {
  configPath?: string;
  now?: () => Date;
  /** A commit barrier used by deterministic migration tests. */
  beforeCommit?: () => void | Promise<void>;
  lockRetryAttempts?: number;
  lockRetryDelayMs?: number;
  lockOptions?: OpenCodeCleanupLockOptions;
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
  private readonly beforeCommit?: () => void | Promise<void>;
  private readonly lockRetryAttempts: number;
  private readonly lockRetryDelayMs: number;
  private readonly lockOptions?: OpenCodeCleanupLockOptions;

  constructor(options: OpenCodeConfigCleanupOptions = {}) {
    this.configPath = options.configPath ?? resolveOpenCodePaths(options).configPath;
    this.now = options.now ?? (() => new Date());
    this.beforeCommit = options.beforeCommit;
    this.lockRetryAttempts = positiveInteger(
      options.lockRetryAttempts,
      DEFAULT_LOCK_RETRY_ATTEMPTS
    );
    this.lockRetryDelayMs = nonNegativeInteger(
      options.lockRetryDelayMs,
      DEFAULT_LOCK_RETRY_DELAY_MS
    );
    this.lockOptions = options.lockOptions;
  }

  async cleanup(): Promise<OpenCodeCleanupResult> {
    const initial = await this.readConfigSnapshot();
    if (!initial || !this.planCleanup(initial.bytes)) {
      return unchangedCleanupResult();
    }

    const lockPath = `${this.configPath}${LOCK_SUFFIX}`;
    const lock = await acquireOpenCodeCleanupLock(lockPath, {
      retryAttempts: this.lockRetryAttempts,
      retryDelayMs: this.lockRetryDelayMs,
      ...this.lockOptions,
    });
    let tempPath: string | undefined;
    try {
      const original = await this.readConfigSnapshot();
      if (!original) {
        throw this.concurrentModificationError('was removed while cleanup waited for its lock');
      }

      const plan = this.planCleanup(original.bytes);
      if (!plan) {
        return unchangedCleanupResult();
      }

      const backupPath = await this.writeExclusiveBackup(original);
      await this.syncParentDirectory();
      tempPath = await this.writeExclusiveTemp(plan.nextBytes, original.stat.mode);
      await this.beforeCommit?.();
      await this.assertConfigUnchanged(original);
      await fs.promises.rename(tempPath, this.configPath);
      tempPath = undefined;
      await this.syncParentDirectory();

      return {
        changed: true,
        removedProviderKeys: plan.removedProviderKeys,
        removedTopLevelModel: plan.removedTopLevelModel,
        backupPath,
      };
    } finally {
      try {
        if (tempPath) {
          await unlinkIfPresent(tempPath);
        }
      } finally {
        await lock.release();
      }
    }
  }

  private async readConfigSnapshot(): Promise<ConfigSnapshot | undefined> {
    let handle;
    try {
      handle = await fs.promises.open(this.configPath, 'r');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }

    try {
      const statBefore = await handle.stat();
      const bytes = await handle.readFile();
      const statAfter = await handle.stat();
      if (!sameConfigStat(statBefore, statAfter)) {
        throw this.concurrentModificationError('changed while it was being read');
      }
      return { bytes, stat: statAfter };
    } finally {
      await handle.close();
    }
  }

  private parseConfig(bytes: Buffer): Record<string, unknown> {
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (!isRecord(parsed)) {
      throw new Error(`OpenCode config is not an object: ${this.configPath}`);
    }
    return parsed;
  }

  private planCleanup(bytes: Buffer): CleanupPlan | undefined {
    const existing = this.parseConfig(bytes);
    const providers = isRecord(existing.provider) ? { ...existing.provider } : {};
    const removedProviderKeys = Object.entries(providers)
      .filter(([, entry]) => isRecord(entry) && entry[SYNC_MARKER] === true)
      .map(([key]) => key)
      .sort();
    if (removedProviderKeys.length === 0) {
      return undefined;
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
    return {
      nextBytes: Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8'),
      removedProviderKeys,
      removedTopLevelModel,
    };
  }

  private async writeExclusiveBackup(original: ConfigSnapshot): Promise<string> {
    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    const basePath = `${this.configPath}.agents-gui-native-cli-bak-${stamp}`;
    for (let attempt = 0; attempt < MAX_BACKUP_COLLISION_ATTEMPTS; attempt += 1) {
      const backupPath = attempt === 0 ? basePath : `${basePath}-${attempt}`;
      const handle = await openExclusiveOrUndefined(backupPath, original.stat.mode);
      if (!handle) {
        continue;
      }
      try {
        await handle.writeFile(original.bytes);
        await handle.chmod(original.stat.mode & 0o7777);
        await handle.sync();
        return backupPath;
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlinkIfPresent(backupPath);
        throw error;
      } finally {
        await handle.close().catch(() => undefined);
      }
    }

    throw new Error(`Unable to create a collision-free OpenCode config backup: ${basePath}`);
  }

  private async writeExclusiveTemp(bytes: Buffer, mode: number): Promise<string> {
    const directory = path.dirname(this.configPath);
    const basename = path.basename(this.configPath);
    const nonce = `${process.pid}-${Date.now().toString(36)}`;
    for (let attempt = 0; attempt < MAX_TEMP_COLLISION_ATTEMPTS; attempt += 1) {
      const tempPath = path.join(directory, `${basename}${TEMP_MARKER}${nonce}-${attempt}`);
      const handle = await openExclusiveOrUndefined(tempPath, mode);
      if (!handle) {
        continue;
      }
      try {
        await handle.writeFile(bytes);
        await handle.chmod(mode & 0o7777);
        await handle.sync();
        await handle.close();
        return tempPath;
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlinkIfPresent(tempPath);
        throw error;
      }
    }

    throw new Error(`Unable to create an OpenCode config migration temp file: ${directory}`);
  }

  private async assertConfigUnchanged(original: ConfigSnapshot): Promise<void> {
    let current: ConfigSnapshot | undefined;
    try {
      current = await this.readConfigSnapshot();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw this.concurrentModificationError('was removed before replacement');
      }
      throw error;
    }
    if (
      !current ||
      !current.bytes.equals(original.bytes) ||
      !sameConfigStat(current.stat, original.stat)
    ) {
      throw this.concurrentModificationError('changed while cleanup was preparing a replacement');
    }
  }

  private concurrentModificationError(detail: string): Error {
    return new Error(
      `Concurrent OpenCode config modification detected: ${this.configPath} ${detail}. ` +
        'No cleanup replacement was written; review the file and reload the window.'
    );
  }

  private async syncParentDirectory(): Promise<void> {
    await syncOpenCodeConfigDirectory(path.dirname(this.configPath));
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

export async function runOpenCodeCleanupActivationGate(
  state: LocalMigrationState,
  migration: Pick<OpenCodeConfigCleanupMigration, 'cleanup'>,
  onFailure: (error: unknown) => void | Promise<void>
): Promise<ReadonlySet<string>> {
  try {
    await runOpenCodeCleanupOnce(state, migration);
    return new Set<string>();
  } catch (error) {
    try {
      await onFailure(error);
    } catch {
      // Reporting failure must not re-enable an unsafe OpenCode launch.
    }
    return new Set<string>(['opencode']);
  }
}

interface DirectorySyncHandle {
  sync(): Promise<void>;
  close(): Promise<void>;
}

type OpenDirectoryForSync = (directory: string) => Promise<DirectorySyncHandle>;

export async function syncOpenCodeConfigDirectory(
  directory: string,
  platform: NodeJS.Platform = process.platform,
  openDirectory: OpenDirectoryForSync = (target) => fs.promises.open(target, 'r')
): Promise<void> {
  let handle: DirectorySyncHandle;
  try {
    handle = await openDirectory(directory);
  } catch (error) {
    if (isUnsupportedWindowsDirectorySyncError(platform, error)) {
      return;
    }
    throw error;
  }

  try {
    await handle.sync();
  } catch (error) {
    if (!isUnsupportedWindowsDirectorySyncError(platform, error)) {
      throw error;
    }
  } finally {
    await handle.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isUnsupportedWindowsDirectorySyncError(
  platform: NodeJS.Platform,
  error: unknown
): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return (
    platform === 'win32' &&
    (code === 'EACCES' ||
      code === 'EBADF' ||
      code === 'EISDIR' ||
      code === 'EINVAL' ||
      code === 'EPERM')
  );
}

interface ConfigSnapshot {
  bytes: Buffer;
  stat: fs.Stats;
}

interface CleanupPlan {
  nextBytes: Buffer;
  removedProviderKeys: string[];
  removedTopLevelModel: boolean;
}

function unchangedCleanupResult(): OpenCodeCleanupResult {
  return { changed: false, removedProviderKeys: [], removedTopLevelModel: false };
}

function sameConfigStat(left: fs.Stats, right: fs.Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

async function openExclusiveOrUndefined(filePath: string, mode: number) {
  try {
    return await fs.promises.open(filePath, 'wx', mode & 0o7777);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return undefined;
    }
    throw error;
  }
}

async function unlinkIfPresent(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}
