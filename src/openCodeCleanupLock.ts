import { randomUUID } from 'crypto';
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
const MAX_QUARANTINE_COLLISION_ATTEMPTS = 100;

interface StructuredLockOwner {
  readonly kind: 'structured';
  readonly pid: number;
  readonly hostname: string;
  readonly token: string;
  readonly createdAt: number;
}

interface LegacyLockOwner {
  readonly kind: 'legacy';
  readonly pid: number;
}

interface MalformedLockOwner {
  readonly kind: 'malformed';
}

type LockOwner = StructuredLockOwner | LegacyLockOwner | MalformedLockOwner;

interface LockSnapshot {
  readonly bytes: Buffer;
  readonly stat: fs.Stats;
  readonly owner: LockOwner;
  readonly oversized: boolean;
}

interface NormalizedLockOptions {
  readonly pid: number;
  readonly hostname: string;
  readonly token: string;
  readonly createdAt: number;
  readonly now: () => number;
  readonly processLiveness: (pid: number) => ProcessLiveness;
  readonly retryAttempts: number;
  readonly retryDelayMs: number;
  readonly malformedGraceMs: number;
}

type RetireResult = 'retired' | 'changed';

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

export async function acquireOpenCodeCleanupLock(
  lockPath: string,
  options: OpenCodeCleanupLockOptions = {}
): Promise<OpenCodeCleanupLock> {
  const normalized = normalizeOptions(options);
  const ownerBytes = serializeOwner(normalized);

  for (let attempt = 1; attempt <= normalized.retryAttempts; attempt += 1) {
    try {
      const verified = await tryCreateOwner(lockPath, normalized.token, ownerBytes);
      return createOwnedLock(lockPath, normalized.token, verified, normalized.now);
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) {
        throw error;
      }
    }

    const retired = await recoverExistingOwner(lockPath, normalized);
    if (retired) {
      try {
        const verified = await tryCreateOwner(lockPath, normalized.token, ownerBytes);
        return createOwnedLock(lockPath, normalized.token, verified, normalized.now);
      } catch (error) {
        if (!hasErrorCode(error, 'EEXIST')) {
          throw error;
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
    token,
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

function readSafeTime(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('OpenCode cleanup lock creation time must be a non-negative safe integer.');
  }
  return value;
}

function serializeOwner(options: NormalizedLockOptions): Buffer {
  const bytes = Buffer.from(
    `${JSON.stringify({
      version: OPEN_CODE_CLEANUP_LOCK_RECORD_VERSION,
      pid: options.pid,
      hostname: options.hostname,
      token: options.token,
      createdAt: options.createdAt,
    })}\n`,
    'utf8'
  );
  if (bytes.length > MAX_LOCK_RECORD_BYTES) {
    throw new Error(`OpenCode cleanup lock owner record exceeds ${MAX_LOCK_RECORD_BYTES} bytes.`);
  }
  return bytes;
}

async function tryCreateOwner(
  lockPath: string,
  token: string,
  ownerBytes: Buffer
): Promise<LockSnapshot> {
  const handle = await fs.promises.open(lockPath, 'wx', 0o600);
  let provisionalStat: fs.Stats;
  try {
    provisionalStat = await handle.stat();
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
  try {
    await handle.writeFile(ownerBytes);
    await handle.chmod(0o600);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await discardProvisionalOwner(lockPath, provisionalStat);
    throw error;
  }
  await handle.close();

  const verified = await readLockSnapshot(lockPath);
  if (
    !verified ||
    verified.oversized ||
    verified.owner.kind !== 'structured' ||
    verified.owner.token !== token ||
    !verified.bytes.equals(ownerBytes) ||
    !sameFileIdentity(verified.stat, provisionalStat)
  ) {
    throw new Error(
      `OpenCode config cleanup lock ownership changed before verification: ${lockPath}`
    );
  }
  return verified;
}

async function discardProvisionalOwner(lockPath: string, provisionalStat: fs.Stats): Promise<void> {
  const snapshot = await readLockSnapshot(lockPath).catch(() => undefined);
  if (!snapshot || !sameFileIdentity(snapshot.stat, provisionalStat)) {
    return;
  }
  await retireExpectedPath(lockPath, snapshot, Date.now).catch(() => undefined);
}

async function recoverExistingOwner(
  lockPath: string,
  options: NormalizedLockOptions
): Promise<boolean> {
  const first = await readLockSnapshot(lockPath);
  if (!first || first.oversized) {
    return false;
  }

  if (first.owner.kind === 'structured') {
    if (first.owner.hostname !== options.hostname) {
      return false;
    }
    if (safeProbe(options.processLiveness, first.owner.pid) !== 'dead') {
      return false;
    }
    return (await retireExpectedPath(lockPath, first, options.now)) === 'retired';
  }

  if (first.owner.kind === 'legacy') {
    if (safeProbe(options.processLiveness, first.owner.pid) !== 'dead') {
      return false;
    }
    return (await retireExpectedPath(lockPath, first, options.now)) === 'retired';
  }

  const currentTime = readSafeTime(options.now);
  if (currentTime - first.stat.mtimeMs < options.malformedGraceMs) {
    return false;
  }

  await delay(options.retryDelayMs);
  const second = await readLockSnapshot(lockPath);
  if (!second || second.oversized || !sameStrictSnapshot(first, second)) {
    return false;
  }
  return (await retireExpectedPath(lockPath, second, options.now)) === 'retired';
}

function parseOwner(bytes: Buffer, oversized: boolean): LockOwner {
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

async function readLockSnapshot(lockPath: string): Promise<LockSnapshot | undefined> {
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(lockPath, 'r');
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }

  let snapshot: LockSnapshot | undefined;
  try {
    const statBefore = await handle.stat();
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

    const statAfter = await handle.stat();
    if (!sameSnapshotStat(statBefore, statAfter)) {
      return undefined;
    }
    const bytes = buffer.subarray(0, bytesRead);
    const oversized = statAfter.size > MAX_LOCK_RECORD_BYTES || bytesRead > MAX_LOCK_RECORD_BYTES;
    snapshot = {
      bytes,
      stat: statAfter,
      owner: parseOwner(bytes, oversized),
      oversized,
    };
  } finally {
    await handle.close();
  }

  if (!snapshot) {
    return undefined;
  }
  let pathStat: fs.Stats;
  try {
    pathStat = await fs.promises.lstat(lockPath);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }
  if (!pathStat.isFile() || !sameFileIdentity(pathStat, snapshot.stat)) {
    return undefined;
  }
  return snapshot;
}

async function retireExpectedPath(
  lockPath: string,
  expected: LockSnapshot,
  now: () => number
): Promise<RetireResult> {
  const preflight = await readLockSnapshot(lockPath);
  if (!preflight || !sameStrictSnapshot(preflight, expected)) {
    return 'changed';
  }

  const quarantinePath = await nextQuarantinePath(lockPath, now);
  try {
    await fs.promises.rename(lockPath, quarantinePath);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return 'changed';
    }
    throw error;
  }

  const moved = await readLockSnapshot(quarantinePath);
  if (moved && sameMovedSnapshot(moved, expected)) {
    await unlinkIfPresent(quarantinePath);
    return 'retired';
  }

  await restoreQuarantineWithoutOverwrite(quarantinePath, lockPath, moved);
  return 'changed';
}

async function nextQuarantinePath(lockPath: string, now: () => number): Promise<string> {
  const directory = path.dirname(lockPath);
  const basename = path.basename(lockPath);
  const timestamp = readSafeTime(now);

  for (let attempt = 0; attempt < MAX_QUARANTINE_COLLISION_ATTEMPTS; attempt += 1) {
    const nonce = randomUUID().replace(/[^a-zA-Z0-9-]/g, '');
    const candidate = path.join(
      directory,
      `${basename}.quarantine-${process.pid}-${timestamp}-${nonce}-${attempt}`
    );
    try {
      await fs.promises.lstat(candidate);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        return candidate;
      }
      throw error;
    }
  }

  throw new Error(`Unable to allocate an OpenCode cleanup lock quarantine path: ${lockPath}`);
}

async function restoreQuarantineWithoutOverwrite(
  quarantinePath: string,
  lockPath: string,
  moved: LockSnapshot | undefined
): Promise<void> {
  if (!moved || moved.oversized) {
    throw retainedEvidenceError(lockPath, quarantinePath);
  }

  try {
    await fs.promises.link(quarantinePath, lockPath);
  } catch (error) {
    throw retainedEvidenceError(lockPath, quarantinePath, error);
  }

  const [quarantineNow, restoredNow] = await Promise.all([
    readLockSnapshot(quarantinePath),
    readLockSnapshot(lockPath),
  ]);
  if (
    !quarantineNow ||
    !restoredNow ||
    !sameMovedSnapshot(quarantineNow, moved) ||
    !sameMovedSnapshot(restoredNow, moved) ||
    !sameFileIdentity(quarantineNow.stat, restoredNow.stat)
  ) {
    throw retainedEvidenceError(lockPath, quarantinePath);
  }

  try {
    await fs.promises.unlink(quarantinePath);
  } catch (error) {
    throw retainedEvidenceError(lockPath, quarantinePath, error);
  }
}

function retainedEvidenceError(lockPath: string, quarantinePath: string, cause?: unknown): Error {
  const detail = cause instanceof Error ? ` ${cause.message}` : '';
  return new Error(
    `Unable to restore quarantined OpenCode cleanup lock without overwriting ${lockPath}. ` +
      `Evidence retained at ${quarantinePath}.${detail}`
  );
}

function createOwnedLock(
  lockPath: string,
  token: string,
  verified: LockSnapshot,
  now: () => number
): OpenCodeCleanupLock {
  let released = false;
  return {
    path: lockPath,
    token,
    async release() {
      if (released) {
        return;
      }
      released = true;

      const current = await readLockSnapshot(lockPath);
      if (
        !current ||
        current.oversized ||
        current.owner.kind !== 'structured' ||
        current.owner.token !== token ||
        !sameStrictSnapshot(current, verified)
      ) {
        return;
      }
      await retireExpectedPath(lockPath, current, now);
    },
  };
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

function sameStrictSnapshot(left: LockSnapshot, right: LockSnapshot): boolean {
  return (
    left.bytes.equals(right.bytes) &&
    sameSnapshotStat(left.stat, right.stat) &&
    left.oversized === right.oversized
  );
}

function sameMovedSnapshot(left: LockSnapshot, right: LockSnapshot): boolean {
  return (
    left.bytes.equals(right.bytes) &&
    sameFileIdentity(left.stat, right.stat) &&
    left.stat.size === right.stat.size &&
    left.stat.mode === right.stat.mode &&
    left.stat.mtimeMs === right.stat.mtimeMs &&
    left.oversized === right.oversized
  );
}

function sameFileIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameSnapshotStat(left: fs.Stats, right: fs.Stats): boolean {
  return (
    sameFileIdentity(left, right) &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.nlink === right.nlink
  );
}

function busyLockError(lockPath: string, attempts: number): Error {
  return new Error(
    `OpenCode config cleanup lock is still busy after ${attempts} attempts: ${lockPath}`
  );
}

async function unlinkIfPresent(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) {
      throw error;
    }
  }
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
