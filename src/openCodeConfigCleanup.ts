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
    const target = await this.resolveConfigTarget();
    if (!target) {
      return unchangedCleanupResult();
    }

    const initial = await this.readConfigSnapshot(target.resolvedPath);
    if (!initial || !this.planCleanup(initial.bytes)) {
      return unchangedCleanupResult();
    }

    const lockPath = `${target.resolvedPath}${LOCK_SUFFIX}`;
    const lock = await acquireOpenCodeCleanupLock(lockPath, {
      retryAttempts: this.lockRetryAttempts,
      retryDelayMs: this.lockRetryDelayMs,
      ...this.lockOptions,
    });
    let tempPath: string | undefined;
    try {
      await this.assertConfigTargetUnchanged(target);
      const original = await this.readConfigSnapshot(target.resolvedPath);
      if (!original) {
        throw this.concurrentModificationError('was removed while cleanup waited for its lock');
      }

      const plan = this.planCleanup(original.bytes);
      if (!plan) {
        return unchangedCleanupResult();
      }

      const backupPath = await this.writeExclusiveBackup(target.resolvedPath, original);
      await this.syncParentDirectory(target.resolvedPath);
      tempPath = await this.writeExclusiveTemp(
        target.resolvedPath,
        plan.nextBytes,
        original.stat.mode
      );
      await this.beforeCommit?.();
      await this.assertConfigTargetUnchanged(target);
      await this.assertConfigUnchanged(target.resolvedPath, original);
      await fs.promises.rename(tempPath, target.resolvedPath);
      tempPath = undefined;
      await this.syncParentDirectory(target.resolvedPath);
      await this.assertConfigTargetUnchanged(target);

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

  private async resolveConfigTarget(): Promise<ResolvedConfigTarget | undefined> {
    const before = await readConfigPathEntry(this.configPath);
    if (!before) {
      const danglingAncestor = await findDanglingLinkAncestor(this.configPath);
      if (danglingAncestor) {
        throw this.danglingConfigLinkError(danglingAncestor);
      }
      return undefined;
    }

    let resolvedBefore: string;
    try {
      resolvedBefore = await fs.promises.realpath(this.configPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw this.danglingConfigLinkError(this.configPath);
      }
      throw error;
    }

    const after = await readConfigPathEntry(this.configPath);
    if (!after) {
      throw this.concurrentModificationError('path changed while its target was being resolved');
    }

    let resolvedAfter: string;
    try {
      resolvedAfter = await fs.promises.realpath(this.configPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw this.concurrentModificationError(
          'link target disappeared while it was being resolved'
        );
      }
      throw error;
    }

    if (!sameConfigPathEntry(before, after) || resolvedBefore !== resolvedAfter) {
      throw this.concurrentModificationError('link or target path changed while it was resolved');
    }

    return {
      resolvedPath: resolvedAfter,
      requestedEntry: after,
    };
  }

  private async assertConfigTargetUnchanged(target: ResolvedConfigTarget): Promise<void> {
    const current = await this.resolveConfigTarget();
    if (!current) {
      throw this.concurrentModificationError('path was removed before replacement');
    }
    const linkKindChanged =
      current.requestedEntry.stat.isSymbolicLink() !== target.requestedEntry.stat.isSymbolicLink();
    const linkIdentityChanged =
      target.requestedEntry.stat.isSymbolicLink() &&
      !sameConfigPathEntry(current.requestedEntry, target.requestedEntry);
    if (current.resolvedPath !== target.resolvedPath || linkKindChanged || linkIdentityChanged) {
      throw this.concurrentModificationError('link or target path changed before replacement');
    }
  }

  private async readConfigSnapshot(configPath: string): Promise<ConfigSnapshot | undefined> {
    let handle;
    try {
      handle = await fs.promises.open(configPath, 'r');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }

    try {
      const statBefore = await handle.stat({ bigint: true });
      const bytes = await handle.readFile();
      const statAfter = await handle.stat({ bigint: true });
      if (!sameConfigStat(statBefore, statAfter)) {
        throw this.concurrentModificationError('changed while it was being read');
      }
      let pathStat: fs.BigIntStats;
      try {
        pathStat = await fs.promises.lstat(configPath, { bigint: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw this.concurrentModificationError('target path changed while it was being read');
        }
        throw error;
      }
      if (!sameConfigStat(statAfter, pathStat)) {
        throw this.concurrentModificationError('target path changed while it was being read');
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

  private async writeExclusiveBackup(
    configPath: string,
    original: ConfigSnapshot
  ): Promise<string> {
    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    const basePath = `${configPath}.agents-gui-native-cli-bak-${stamp}`;
    for (let attempt = 0; attempt < MAX_BACKUP_COLLISION_ATTEMPTS; attempt += 1) {
      const backupPath = attempt === 0 ? basePath : `${basePath}-${attempt}`;
      const handle = await openExclusiveOrUndefined(backupPath, original.stat.mode);
      if (!handle) {
        continue;
      }
      try {
        await handle.writeFile(original.bytes);
        await handle.chmod(Number(original.stat.mode & 0o7777n));
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

  private async writeExclusiveTemp(
    configPath: string,
    bytes: Buffer,
    mode: bigint
  ): Promise<string> {
    const directory = path.dirname(configPath);
    const basename = path.basename(configPath);
    const nonce = `${process.pid}-${Date.now().toString(36)}`;
    for (let attempt = 0; attempt < MAX_TEMP_COLLISION_ATTEMPTS; attempt += 1) {
      const tempPath = path.join(directory, `${basename}${TEMP_MARKER}${nonce}-${attempt}`);
      const handle = await openExclusiveOrUndefined(tempPath, mode);
      if (!handle) {
        continue;
      }
      try {
        await handle.writeFile(bytes);
        await handle.chmod(Number(mode & 0o7777n));
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

  private async assertConfigUnchanged(configPath: string, original: ConfigSnapshot): Promise<void> {
    let current: ConfigSnapshot | undefined;
    try {
      current = await this.readConfigSnapshot(configPath);
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

  private danglingConfigLinkError(linkPath: string): Error {
    return new Error(
      `OpenCode config path contains a dangling symbolic link or junction: ${linkPath}. ` +
        'Restore or remove the broken link before reloading Agents GUI.'
    );
  }

  private async syncParentDirectory(configPath: string): Promise<void> {
    await syncOpenCodeConfigDirectory(path.dirname(configPath));
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
  stat: fs.BigIntStats;
}

interface ConfigPathEntry {
  stat: fs.BigIntStats;
  linkTarget?: string;
}

interface ResolvedConfigTarget {
  resolvedPath: string;
  requestedEntry: ConfigPathEntry;
}

interface CleanupPlan {
  nextBytes: Buffer;
  removedProviderKeys: string[];
  removedTopLevelModel: boolean;
}

function unchangedCleanupResult(): OpenCodeCleanupResult {
  return { changed: false, removedProviderKeys: [], removedTopLevelModel: false };
}

async function readConfigPathEntry(filePath: string): Promise<ConfigPathEntry | undefined> {
  let stat: fs.BigIntStats;
  try {
    stat = await fs.promises.lstat(filePath, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }

  let linkTarget: string | undefined;
  if (stat.isSymbolicLink()) {
    try {
      linkTarget = await fs.promises.readlink(filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EINVAL') {
        throw new Error(
          `OpenCode config path changed while symbolic link metadata was being read: ${filePath}`
        );
      }
      throw error;
    }
  }
  return { stat, linkTarget };
}

async function findDanglingLinkAncestor(filePath: string): Promise<string | undefined> {
  let candidate = path.resolve(filePath);
  while (true) {
    const entry = await readConfigPathEntry(candidate);
    if (entry) {
      if (!entry.stat.isSymbolicLink()) {
        return undefined;
      }
      try {
        await fs.promises.realpath(candidate);
        return undefined;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return candidate;
        }
        throw error;
      }
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      return undefined;
    }
    candidate = parent;
  }
}

function sameConfigPathEntry(left: ConfigPathEntry, right: ConfigPathEntry): boolean {
  return left.linkTarget === right.linkTarget && sameConfigStat(left.stat, right.stat);
}

function sameConfigStat(left: fs.BigIntStats, right: fs.BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

async function openExclusiveOrUndefined(filePath: string, mode: bigint) {
  try {
    return await fs.promises.open(filePath, 'wx', Number(mode & 0o7777n));
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
