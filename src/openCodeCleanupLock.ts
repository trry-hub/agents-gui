import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import { hostname as systemHostname } from 'os';
import * as path from 'path';

export type ProcessLiveness = 'alive' | 'dead' | 'unknown';

export interface OpenCodeCleanupLockOptions {
  pid?: number;
  hostname?: string;
  tokenFactory?: () => string;
  now?: () => number;
  processLiveness?: (pid: number) => ProcessLiveness;
  retryAttempts?: number;
  retryDelayMs?: number;
  malformedGraceMs?: number;
}

export interface OpenCodeCleanupLock {
  readonly path: string;
  readonly token: string;
  release(): Promise<void>;
}

export const OPEN_CODE_CLEANUP_LOCK_RECORD_VERSION = 1;
export const OPEN_CODE_CLEANUP_MALFORMED_GRACE_MS = 300_000;

const MAX_LOCK_RECORD_BYTES = 4_096;
const MAX_HOSTNAME_LENGTH = 255;
const MAX_TOKEN_LENGTH = 256;
const DEFAULT_RETRY_ATTEMPTS = 80;
const DEFAULT_RETRY_DELAY_MS = 25;
const LEGACY_SIDECAR_SUFFIX = '.v2';
const DIGEST_PATTERN = '[A-Za-z0-9_-]{43}';
const DIRECTORY_OWNER_PATTERN = new RegExp(
  `^owner-v${OPEN_CODE_CLEANUP_LOCK_RECORD_VERSION}-([1-9]\\d*)-(0|[1-9]\\d*)-(${DIGEST_PATTERN})-(${DIGEST_PATTERN})$`
);

interface StructuredFileOwner {
  readonly kind: 'structured';
  readonly pid: number;
  readonly hostname: string;
  readonly token: string;
  readonly createdAt: number;
}

interface LegacyFileOwner {
  readonly kind: 'legacy';
  readonly pid: number;
}

interface MalformedOwner {
  readonly kind: 'malformed';
}

type FileOwner = StructuredFileOwner | LegacyFileOwner | MalformedOwner;

interface FileLockSnapshot {
  readonly bytes: Buffer;
  readonly stat: fs.BigIntStats;
  readonly owner: FileOwner;
  readonly oversized: boolean;
}

interface StructuredDirectoryOwner {
  readonly kind: 'structured';
  readonly markerName: string;
  readonly pid: number;
  readonly createdAt: number;
  readonly hostnameDigest: string;
  readonly tokenDigest: string;
}

type DirectoryOwner = StructuredDirectoryOwner | MalformedOwner;

interface DirectoryLockSnapshot {
  readonly rootStat: fs.BigIntStats;
  readonly entries: readonly string[];
  readonly markerStat?: fs.BigIntStats;
  readonly markerEntries?: readonly string[];
  readonly owner: DirectoryOwner;
}

interface NormalizedLockOptions {
  readonly pid: number;
  readonly hostname: string;
  readonly hostnameDigest: string;
  readonly token: string;
  readonly tokenDigest: string;
  readonly createdAt: number;
  readonly now: () => number;
  readonly processLiveness: (pid: number) => ProcessLiveness;
  readonly retryAttempts: number;
  readonly retryDelayMs: number;
  readonly malformedGraceMs: number;
}

type DirectoryRemovalResult = 'removed' | 'changed';

/**
 * This lock is designed for cooperative Agents GUI processes. The canonical
 * path is a directory, and every shared-state mutation uses mkdir or
 * non-recursive rmdir. An arbitrary same-user process can edit the protected
 * config itself and is outside this protocol's threat model.
 */
export async function acquireOpenCodeCleanupLock(
  lockPath: string,
  options: OpenCodeCleanupLockOptions = {}
): Promise<OpenCodeCleanupLock> {
  const normalized = normalizeOptions(options);

  for (let attempt = 1; attempt <= normalized.retryAttempts; attempt += 1) {
    const directoryLock = await tryAcquireDirectoryLock(lockPath, lockPath, normalized);
    if (directoryLock) {
      return directoryLock;
    }

    const pathStat = await lstatOrUndefined(lockPath);
    if (!pathStat) {
      if (attempt < normalized.retryAttempts) {
        await delay(normalized.retryDelayMs);
        continue;
      }
      throw busyLockError(lockPath, normalized.retryAttempts);
    }

    if (pathStat.isFile()) {
      const legacySnapshot = await readRecoverableLegacySnapshot(lockPath, normalized);
      if (legacySnapshot) {
        const sidecarLock = await tryAcquireDirectoryLock(
          `${lockPath}${LEGACY_SIDECAR_SUFFIX}`,
          lockPath,
          normalized
        );
        if (sidecarLock) {
          const current = await readFileLockSnapshot(lockPath);
          if (
            current &&
            sameStrictFileSnapshot(current, legacySnapshot) &&
            isImmediatelyRecoverableFileOwner(current, normalized)
          ) {
            return sidecarLock;
          }
          await sidecarLock.release();
        }
      }
    }

    if (attempt === normalized.retryAttempts) {
      throw busyLockError(lockPath, normalized.retryAttempts);
    }
    await delay(normalized.retryDelayMs);
  }

  throw busyLockError(lockPath, normalized.retryAttempts);
}

export function probeProcessLiveness(pid: number): ProcessLiveness {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM') {
      return 'alive';
    }
    if (code === 'ESRCH') {
      return 'dead';
    }
    return 'unknown';
  }
}

function normalizeOptions(options: OpenCodeCleanupLockOptions): NormalizedLockOptions {
  const pid = options.pid ?? process.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error('OpenCode cleanup lock PID must be a positive safe integer.');
  }

  const hostname = options.hostname ?? systemHostname();
  if (
    typeof hostname !== 'string' ||
    hostname.length === 0 ||
    hostname.length > MAX_HOSTNAME_LENGTH
  ) {
    throw new Error(
      `OpenCode cleanup lock hostname must contain 1-${MAX_HOSTNAME_LENGTH} characters.`
    );
  }

  const token = (options.tokenFactory ?? randomUUID)();
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw new Error(`OpenCode cleanup lock token must contain 1-${MAX_TOKEN_LENGTH} characters.`);
  }

  const now = options.now ?? Date.now;
  const createdAt = readSafeTime(now);
  return {
    pid,
    hostname,
    hostnameDigest: digestOwnerField(hostname),
    token,
    tokenDigest: digestOwnerField(token),
    createdAt,
    now,
    processLiveness: options.processLiveness ?? probeProcessLiveness,
    retryAttempts: positiveInteger(options.retryAttempts, DEFAULT_RETRY_ATTEMPTS),
    retryDelayMs: nonNegativeInteger(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS),
    malformedGraceMs: nonNegativeInteger(
      options.malformedGraceMs,
      OPEN_CODE_CLEANUP_MALFORMED_GRACE_MS
    ),
  };
}

function directoryOwnerName(options: NormalizedLockOptions): string {
  return [
    `owner-v${OPEN_CODE_CLEANUP_LOCK_RECORD_VERSION}`,
    options.pid,
    options.createdAt,
    options.hostnameDigest,
    options.tokenDigest,
  ].join('-');
}

function parseDirectoryOwner(markerName: string): DirectoryOwner {
  const match = DIRECTORY_OWNER_PATTERN.exec(markerName);
  if (!match) {
    return { kind: 'malformed' };
  }
  const pid = Number(match[1]);
  const createdAt = Number(match[2]);
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(createdAt) || createdAt < 0) {
    return { kind: 'malformed' };
  }
  return {
    kind: 'structured',
    markerName,
    pid,
    createdAt,
    hostnameDigest: match[3],
    tokenDigest: match[4],
  };
}

async function tryAcquireDirectoryLock(
  rootPath: string,
  logicalPath: string,
  options: NormalizedLockOptions
): Promise<OpenCodeCleanupLock | undefined> {
  const created = await tryCreateDirectoryOwner(rootPath, logicalPath, options);
  if (created) {
    return created;
  }

  const existing = await readDirectoryLockSnapshot(rootPath);
  if (!existing) {
    return undefined;
  }
  if (!(await recoverDirectoryOwner(rootPath, existing, options))) {
    return undefined;
  }
  return tryCreateDirectoryOwner(rootPath, logicalPath, options);
}

async function tryCreateDirectoryOwner(
  rootPath: string,
  logicalPath: string,
  options: NormalizedLockOptions
): Promise<OpenCodeCleanupLock | undefined> {
  try {
    await fs.promises.mkdir(rootPath, { mode: 0o700 });
  } catch (error) {
    if (hasErrorCode(error, 'EEXIST')) {
      return undefined;
    }
    throw error;
  }

  const markerName = directoryOwnerName(options);
  const markerPath = path.join(rootPath, markerName);
  let markerCreated = false;
  let rootIdentity: fs.BigIntStats | undefined;
  try {
    await chmodPrivateDirectory(rootPath);
    rootIdentity = await fs.promises.lstat(rootPath, { bigint: true });
    if (!rootIdentity.isDirectory()) {
      throw ownershipChangedError(logicalPath);
    }

    await fs.promises.mkdir(markerPath, { mode: 0o700 });
    markerCreated = true;
    await chmodPrivateDirectory(markerPath);

    const verified = await readDirectoryLockSnapshot(rootPath);
    if (
      !verified ||
      !sameFileIdentity(verified.rootStat, rootIdentity) ||
      verified.entries.length !== 1 ||
      verified.entries[0] !== markerName ||
      !verified.markerStat ||
      verified.owner.kind !== 'structured' ||
      verified.owner.markerName !== markerName ||
      verified.owner.pid !== options.pid ||
      verified.owner.createdAt !== options.createdAt ||
      verified.owner.hostnameDigest !== options.hostnameDigest ||
      verified.owner.tokenDigest !== options.tokenDigest
    ) {
      throw ownershipChangedError(logicalPath);
    }
    return createOwnedDirectoryLock(
      logicalPath,
      options.token,
      rootPath,
      verified.rootStat,
      markerName
    );
  } catch (error) {
    await rollbackProvisionalDirectory(rootPath, markerName, rootIdentity, markerCreated);
    throw error;
  }
}

async function rollbackProvisionalDirectory(
  rootPath: string,
  markerName: string,
  rootIdentity: fs.BigIntStats | undefined,
  markerCreated: boolean
): Promise<void> {
  if (!rootIdentity) {
    await fs.promises.rmdir(rootPath).catch(() => undefined);
    return;
  }
  const current = await readDirectoryLockSnapshot(rootPath).catch(() => undefined);
  if (!current || !sameFileIdentity(current.rootStat, rootIdentity)) {
    return;
  }
  if (markerCreated && current.entries.length === 1 && current.entries[0] === markerName) {
    await removeExpectedDirectory(rootPath, current).catch(() => undefined);
    return;
  }
  if (!markerCreated && current.entries.length === 0) {
    await fs.promises.rmdir(rootPath).catch(() => undefined);
  }
}

async function recoverDirectoryOwner(
  rootPath: string,
  first: DirectoryLockSnapshot,
  options: NormalizedLockOptions
): Promise<boolean> {
  if (first.owner.kind === 'structured') {
    if (first.owner.hostnameDigest !== options.hostnameDigest) {
      return false;
    }
    if (safeProbe(options.processLiveness, first.owner.pid) !== 'dead') {
      return false;
    }
    return (await removeExpectedDirectory(rootPath, first)) === 'removed';
  }

  if (first.entries.length !== 0) {
    return false;
  }
  const currentTime = readSafeTime(options.now);
  if (BigInt(currentTime) - first.rootStat.mtimeMs < BigInt(options.malformedGraceMs)) {
    return false;
  }

  await delay(options.retryDelayMs);
  const second = await readDirectoryLockSnapshot(rootPath);
  if (!second || !sameDirectorySnapshot(first, second)) {
    return false;
  }
  return (await removeExpectedDirectory(rootPath, second)) === 'removed';
}

async function removeExpectedDirectory(
  rootPath: string,
  expected: DirectoryLockSnapshot
): Promise<DirectoryRemovalResult> {
  const preflight = await readDirectoryLockSnapshot(rootPath);
  if (!preflight || !sameDirectorySnapshot(preflight, expected)) {
    return 'changed';
  }

  if (preflight.entries.length === 0) {
    try {
      await fs.promises.rmdir(rootPath);
      return 'removed';
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        return 'changed';
      }
      throw error;
    }
  }

  if (
    preflight.owner.kind !== 'structured' ||
    preflight.entries.length !== 1 ||
    preflight.entries[0] !== preflight.owner.markerName
  ) {
    return 'changed';
  }

  const markerName = preflight.owner.markerName;
  try {
    await fs.promises.rmdir(path.join(rootPath, markerName));
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return 'changed';
    }
    throw error;
  }

  try {
    await fs.promises.rmdir(rootPath);
    return 'removed';
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return 'removed';
    }
    await restoreRemovedMarker(rootPath, preflight.rootStat, markerName);
    throw error;
  }
}

async function restoreRemovedMarker(
  rootPath: string,
  expectedRoot: fs.BigIntStats,
  markerName: string
): Promise<void> {
  const current = await readDirectoryLockSnapshot(rootPath).catch(() => undefined);
  if (
    !current ||
    !sameFileIdentity(current.rootStat, expectedRoot) ||
    current.entries.length !== 0
  ) {
    return;
  }
  const markerPath = path.join(rootPath, markerName);
  try {
    await fs.promises.mkdir(markerPath, { mode: 0o700 });
    await chmodPrivateDirectory(markerPath);
  } catch {
    // The original removal error remains actionable; never overwrite a new entry.
  }
}

async function readDirectoryLockSnapshot(
  rootPath: string
): Promise<DirectoryLockSnapshot | undefined> {
  const rootBefore = await lstatOrUndefined(rootPath);
  if (!rootBefore || !rootBefore.isDirectory()) {
    return undefined;
  }

  let entries: string[];
  try {
    entries = (await fs.promises.readdir(rootPath)).sort();
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR')) {
      return undefined;
    }
    throw error;
  }

  const rootAfterEntries = await lstatOrUndefined(rootPath);
  if (!rootAfterEntries || !sameSnapshotStat(rootBefore, rootAfterEntries)) {
    return undefined;
  }

  if (entries.length !== 1) {
    return {
      rootStat: rootAfterEntries,
      entries,
      owner: { kind: 'malformed' },
    };
  }

  const markerName = entries[0];
  const markerPath = path.join(rootPath, markerName);
  const markerBefore = await lstatOrUndefined(markerPath);
  if (!markerBefore || !markerBefore.isDirectory()) {
    return undefined;
  }
  let markerEntries: string[];
  try {
    markerEntries = (await fs.promises.readdir(markerPath)).sort();
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR')) {
      return undefined;
    }
    throw error;
  }
  const markerStat = await lstatOrUndefined(markerPath);
  const rootAfterMarker = await lstatOrUndefined(rootPath);
  if (
    !markerStat ||
    !markerStat.isDirectory() ||
    !sameSnapshotStat(markerBefore, markerStat) ||
    !rootAfterMarker ||
    !sameSnapshotStat(rootAfterEntries, rootAfterMarker)
  ) {
    return undefined;
  }

  return {
    rootStat: rootAfterMarker,
    entries,
    markerStat,
    markerEntries,
    owner: markerEntries.length === 0 ? parseDirectoryOwner(markerName) : { kind: 'malformed' },
  };
}

function createOwnedDirectoryLock(
  logicalPath: string,
  token: string,
  rootPath: string,
  verifiedRoot: fs.BigIntStats,
  markerName: string
): OpenCodeCleanupLock {
  let released = false;
  return {
    path: logicalPath,
    token,
    async release() {
      if (released) {
        return;
      }
      const current = await readDirectoryLockSnapshot(rootPath);
      if (!current) {
        released = true;
        return;
      }
      if (
        !sameFileIdentity(current.rootStat, verifiedRoot) ||
        current.entries.length !== 1 ||
        current.entries[0] !== markerName ||
        current.owner.kind !== 'structured' ||
        current.owner.markerName !== markerName
      ) {
        released = true;
        return;
      }
      const result = await removeExpectedDirectory(rootPath, current);
      released = result === 'removed' || result === 'changed';
    },
  };
}

async function readRecoverableLegacySnapshot(
  lockPath: string,
  options: NormalizedLockOptions
): Promise<FileLockSnapshot | undefined> {
  const first = await readFileLockSnapshot(lockPath);
  if (!first || first.oversized) {
    return undefined;
  }
  if (isImmediatelyRecoverableFileOwner(first, options)) {
    return first;
  }
  if (first.owner.kind !== 'malformed') {
    return undefined;
  }

  const currentTime = readSafeTime(options.now);
  if (BigInt(currentTime) - first.stat.mtimeMs < BigInt(options.malformedGraceMs)) {
    return undefined;
  }
  await delay(options.retryDelayMs);
  const second = await readFileLockSnapshot(lockPath);
  if (!second || second.oversized || !sameStrictFileSnapshot(first, second)) {
    return undefined;
  }
  return second;
}

function isImmediatelyRecoverableFileOwner(
  snapshot: FileLockSnapshot,
  options: NormalizedLockOptions
): boolean {
  if (snapshot.oversized) {
    return false;
  }
  if (snapshot.owner.kind === 'structured') {
    return (
      snapshot.owner.hostname === options.hostname &&
      safeProbe(options.processLiveness, snapshot.owner.pid) === 'dead'
    );
  }
  if (snapshot.owner.kind === 'legacy') {
    return safeProbe(options.processLiveness, snapshot.owner.pid) === 'dead';
  }
  return (
    BigInt(readSafeTime(options.now)) - snapshot.stat.mtimeMs >= BigInt(options.malformedGraceMs)
  );
}

async function readFileLockSnapshot(lockPath: string): Promise<FileLockSnapshot | undefined> {
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(lockPath, 'r');
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'EISDIR')) {
      return undefined;
    }
    throw error;
  }

  let snapshot: FileLockSnapshot | undefined;
  try {
    const statBefore = await handle.stat({ bigint: true });
    if (!statBefore.isFile()) {
      return undefined;
    }

    const buffer = Buffer.alloc(MAX_LOCK_RECORD_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (result.bytesRead === 0) {
        break;
      }
      bytesRead += result.bytesRead;
    }

    const statAfter = await handle.stat({ bigint: true });
    if (!sameSnapshotStat(statBefore, statAfter)) {
      return undefined;
    }
    const bytes = buffer.subarray(0, bytesRead);
    const oversized =
      statAfter.size > BigInt(MAX_LOCK_RECORD_BYTES) || bytesRead > MAX_LOCK_RECORD_BYTES;
    snapshot = {
      bytes,
      stat: statAfter,
      owner: parseFileOwner(bytes, oversized),
      oversized,
    };
  } finally {
    await handle.close();
  }

  if (!snapshot) {
    return undefined;
  }
  const pathStat = await lstatOrUndefined(lockPath);
  if (!pathStat || !pathStat.isFile() || !sameFileIdentity(pathStat, snapshot.stat)) {
    return undefined;
  }
  return snapshot;
}

function parseFileOwner(bytes: Buffer, oversized: boolean): FileOwner {
  if (oversized || bytes.length === 0) {
    return { kind: 'malformed' };
  }

  const text = bytes.toString('utf8');
  if (/^[1-9]\d*\n$/.test(text)) {
    const pid = Number(text.slice(0, -1));
    if (Number.isSafeInteger(pid)) {
      return { kind: 'legacy', pid };
    }
  }
  if (bytes.at(-1) !== 0x0a) {
    return { kind: 'malformed' };
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (
      !isRecord(parsed) ||
      parsed.version !== OPEN_CODE_CLEANUP_LOCK_RECORD_VERSION ||
      !Number.isSafeInteger(parsed.pid) ||
      (parsed.pid as number) <= 0 ||
      typeof parsed.hostname !== 'string' ||
      parsed.hostname.length === 0 ||
      parsed.hostname.length > MAX_HOSTNAME_LENGTH ||
      typeof parsed.token !== 'string' ||
      parsed.token.length === 0 ||
      parsed.token.length > MAX_TOKEN_LENGTH ||
      !Number.isSafeInteger(parsed.createdAt) ||
      (parsed.createdAt as number) < 0
    ) {
      return { kind: 'malformed' };
    }
    return {
      kind: 'structured',
      pid: parsed.pid as number,
      hostname: parsed.hostname,
      token: parsed.token,
      createdAt: parsed.createdAt as number,
    };
  } catch {
    return { kind: 'malformed' };
  }
}

function sameDirectorySnapshot(left: DirectoryLockSnapshot, right: DirectoryLockSnapshot): boolean {
  return (
    sameSnapshotStat(left.rootStat, right.rootStat) &&
    left.entries.length === right.entries.length &&
    left.entries.every((entry, index) => entry === right.entries[index]) &&
    ((!left.markerEntries && !right.markerEntries) ||
      Boolean(
        left.markerEntries &&
        right.markerEntries &&
        left.markerEntries.length === right.markerEntries.length &&
        left.markerEntries.every((entry, index) => entry === right.markerEntries?.[index])
      )) &&
    ((!left.markerStat && !right.markerStat) ||
      Boolean(
        left.markerStat && right.markerStat && sameSnapshotStat(left.markerStat, right.markerStat)
      ))
  );
}

function sameStrictFileSnapshot(left: FileLockSnapshot, right: FileLockSnapshot): boolean {
  return (
    left.bytes.equals(right.bytes) &&
    sameSnapshotStat(left.stat, right.stat) &&
    left.oversized === right.oversized
  );
}

function sameFileIdentity(left: fs.BigIntStats, right: fs.BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameSnapshotStat(left: fs.BigIntStats, right: fs.BigIntStats): boolean {
  return (
    sameFileIdentity(left, right) &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.nlink === right.nlink
  );
}

async function lstatOrUndefined(target: string): Promise<fs.BigIntStats | undefined> {
  try {
    return await fs.promises.lstat(target, { bigint: true });
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR')) {
      return undefined;
    }
    throw error;
  }
}

async function chmodPrivateDirectory(target: string): Promise<void> {
  try {
    await fs.promises.chmod(target, 0o700);
  } catch (error) {
    if (
      process.platform === 'win32' &&
      (hasErrorCode(error, 'EINVAL') ||
        hasErrorCode(error, 'ENOSYS') ||
        hasErrorCode(error, 'EPERM'))
    ) {
      return;
    }
    throw error;
  }
}

function digestOwnerField(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

function readSafeTime(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('OpenCode cleanup lock creation time must be a non-negative safe integer.');
  }
  return value;
}

function safeProbe(
  processLiveness: (pid: number) => ProcessLiveness,
  pid: number
): ProcessLiveness {
  try {
    const result = processLiveness(pid);
    return result === 'alive' || result === 'dead' || result === 'unknown' ? result : 'unknown';
  } catch {
    return 'unknown';
  }
}

function busyLockError(lockPath: string, attempts: number): Error {
  return new Error(
    `OpenCode config cleanup lock is still busy after ${attempts} attempts: ${lockPath}`
  );
}

function ownershipChangedError(lockPath: string): Error {
  return new Error(
    `OpenCode config cleanup lock ownership changed before verification: ${lockPath}`
  );
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
