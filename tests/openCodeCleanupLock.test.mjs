import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import {
  OPEN_CODE_CLEANUP_LOCK_RECORD_VERSION,
  OPEN_CODE_CLEANUP_MALFORMED_GRACE_MS,
  acquireOpenCodeCleanupLock,
  probeProcessLiveness,
} from '../.test-dist/openCodeCleanupLock.js';

function lockFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-gui-cleanup-lock-'));
  const lockPath = path.join(directory, 'opencode.json.agents-gui-native-cli.lock');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, lockPath };
}

function withProcessKill(replacement, callback) {
  const original = process.kill;
  process.kill = replacement;
  try {
    return callback();
  } finally {
    process.kill = original;
  }
}

function structuredOwnerBytes({
  pid = 4321,
  hostname = 'test-host',
  token = 'existing-owner',
  createdAt = 1_000,
} = {}) {
  return Buffer.from(
    `${JSON.stringify({
      version: OPEN_CODE_CLEANUP_LOCK_RECORD_VERSION,
      pid,
      hostname,
      token,
      createdAt,
    })}\n`
  );
}

function acquisitionOptions(overrides = {}) {
  return {
    pid: 9001,
    hostname: 'test-host',
    tokenFactory: () => 'new-owner',
    now: () => 500_000,
    retryAttempts: 4,
    retryDelayMs: 0,
    ...overrides,
  };
}

function quarantineArtifacts(directory) {
  return fs.readdirSync(directory).filter((name) => name.includes('quarantine'));
}

test('process liveness maps success, EPERM, ESRCH, and unknown failures safely', () => {
  assert.equal(probeProcessLiveness(process.pid), 'alive');
  assert.equal(
    withProcessKill(
      () => {
        throw Object.assign(new Error('permission denied'), { code: 'EPERM' });
      },
      () => probeProcessLiveness(4321)
    ),
    'alive'
  );
  assert.equal(
    withProcessKill(
      () => {
        throw Object.assign(new Error('missing process'), { code: 'ESRCH' });
      },
      () => probeProcessLiveness(4321)
    ),
    'dead'
  );
  assert.equal(
    withProcessKill(
      () => {
        throw Object.assign(new Error('unexpected failure'), { code: 'EIO' });
      },
      () => probeProcessLiveness(4321)
    ),
    'unknown'
  );
});

test('acquisition writes and verifies a bounded owner record with private permissions', async (t) => {
  const { lockPath } = lockFixture(t);
  const lock = await acquireOpenCodeCleanupLock(lockPath, {
    pid: 4321,
    hostname: 'test-host',
    tokenFactory: () => 'owner-token',
    now: () => 123_456,
    retryAttempts: 1,
    retryDelayMs: 0,
  });

  try {
    const bytes = fs.readFileSync(lockPath);
    assert.equal(bytes.length <= 4_096, true);
    assert.equal(bytes.at(-1), 0x0a);
    assert.deepEqual(JSON.parse(bytes.toString('utf8')), {
      version: OPEN_CODE_CLEANUP_LOCK_RECORD_VERSION,
      pid: 4321,
      hostname: 'test-host',
      token: 'owner-token',
      createdAt: 123_456,
    });
    assert.equal(lock.path, lockPath);
    assert.equal(lock.token, 'owner-token');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(lockPath).mode & 0o777, 0o600);
    }
    assert.equal(OPEN_CODE_CLEANUP_MALFORMED_GRACE_MS, 300_000);
  } finally {
    await lock.release();
  }

  assert.equal(fs.existsSync(lockPath), false);
});

test('acquisition rejects invalid bounded owner fields without creating a lock', async (t) => {
  const { lockPath } = lockFixture(t);
  const base = {
    hostname: 'test-host',
    tokenFactory: () => 'owner-token',
    now: () => 123_456,
    retryAttempts: 1,
    retryDelayMs: 0,
  };

  await assert.rejects(acquireOpenCodeCleanupLock(lockPath, { ...base, pid: 0 }), /PID/i);
  await assert.rejects(
    acquireOpenCodeCleanupLock(lockPath, { ...base, pid: 1, hostname: 'h'.repeat(256) }),
    /hostname/i
  );
  await assert.rejects(
    acquireOpenCodeCleanupLock(lockPath, {
      ...base,
      pid: 1,
      tokenFactory: () => 't'.repeat(257),
    }),
    /token/i
  );
  assert.equal(fs.existsSync(lockPath), false);
});

test('a live owner stays byte- and identity-stable while a contender exhausts retries', async (t) => {
  const { lockPath } = lockFixture(t);
  const owner = await acquireOpenCodeCleanupLock(lockPath, {
    pid: 1001,
    hostname: 'same-host',
    tokenFactory: () => 'first-owner',
    now: () => 1_000,
    retryAttempts: 1,
    retryDelayMs: 0,
  });
  const beforeBytes = fs.readFileSync(lockPath);
  const beforeStat = fs.statSync(lockPath);
  const observedPids = [];

  try {
    await assert.rejects(
      acquireOpenCodeCleanupLock(lockPath, {
        pid: 1002,
        hostname: 'same-host',
        tokenFactory: () => 'second-owner',
        now: () => 2_000,
        processLiveness(pid) {
          observedPids.push(pid);
          return 'alive';
        },
        retryAttempts: 2,
        retryDelayMs: 0,
      }),
      /OpenCode config cleanup lock.*busy.*2 attempts/i
    );

    assert.deepEqual(observedPids, [1001, 1001]);
    assert.deepEqual(fs.readFileSync(lockPath), beforeBytes);
    const afterStat = fs.statSync(lockPath);
    assert.equal(afterStat.dev, beforeStat.dev);
    assert.equal(afterStat.ino, beforeStat.ino);
  } finally {
    await owner.release();
  }
});

test('a different-host owner is unknown and is never probed or changed', async (t) => {
  const { lockPath } = lockFixture(t);
  const bytes = Buffer.from(
    `${JSON.stringify({
      version: OPEN_CODE_CLEANUP_LOCK_RECORD_VERSION,
      pid: 4321,
      hostname: 'remote-host',
      token: 'remote-owner',
      createdAt: 1_000,
    })}\n`
  );
  fs.writeFileSync(lockPath, bytes, { mode: 0o600 });
  const beforeStat = fs.statSync(lockPath);

  await assert.rejects(
    acquireOpenCodeCleanupLock(lockPath, {
      pid: 1002,
      hostname: 'local-host',
      tokenFactory: () => 'local-owner',
      now: () => 2_000,
      processLiveness() {
        throw new Error('different-host owners must not be probed');
      },
      retryAttempts: 1,
      retryDelayMs: 0,
    }),
    /OpenCode config cleanup lock.*busy.*1 attempt/i
  );

  assert.deepEqual(fs.readFileSync(lockPath), bytes);
  const afterStat = fs.statSync(lockPath);
  assert.equal(afterStat.dev, beforeStat.dev);
  assert.equal(afterStat.ino, beforeStat.ino);
});

test('a same-host structured dead owner is quarantined and replaced', async (t) => {
  const { directory, lockPath } = lockFixture(t);
  fs.writeFileSync(
    lockPath,
    structuredOwnerBytes({ token: '../existing-owner', hostname: 'test-host' }),
    { mode: 0o600 }
  );
  const observedPids = [];
  const originalRename = fs.promises.rename.bind(fs.promises);
  let quarantinePath;
  t.mock.method(fs.promises, 'rename', async (source, destination) => {
    if (source === lockPath) {
      quarantinePath = String(destination);
    }
    return originalRename(source, destination);
  });

  const lock = await acquireOpenCodeCleanupLock(
    lockPath,
    acquisitionOptions({
      processLiveness(pid) {
        observedPids.push(pid);
        return 'dead';
      },
    })
  );

  try {
    assert.deepEqual(observedPids, [4321]);
    assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).token, 'new-owner');
    assert.equal(path.dirname(quarantinePath), directory);
    assert.equal(path.basename(quarantinePath).includes('existing-owner'), false);
    assert.equal(path.basename(quarantinePath).includes('test-host'), false);
    assert.deepEqual(quarantineArtifacts(directory), []);
  } finally {
    await lock.release();
  }
});

test('same-host unknown structured and legacy owners are never removed', async (t) => {
  const { directory } = lockFixture(t);
  const cases = [
    ['structured-unknown', structuredOwnerBytes(), () => 'unknown'],
    [
      'legacy-probe-error',
      Buffer.from('4321\n'),
      () => {
        throw new Error('probe failed');
      },
    ],
  ];

  for (const [name, bytes, processLiveness] of cases) {
    const lockPath = path.join(directory, `${name}.lock`);
    fs.writeFileSync(lockPath, bytes, { mode: 0o600 });
    const beforeStat = fs.statSync(lockPath);

    await assert.rejects(
      acquireOpenCodeCleanupLock(
        lockPath,
        acquisitionOptions({
          tokenFactory: () => `${name}-contender`,
          processLiveness,
          retryAttempts: 2,
        })
      ),
      /busy/i
    );

    assert.deepEqual(fs.readFileSync(lockPath), bytes);
    const afterStat = fs.statSync(lockPath);
    assert.equal(afterStat.dev, beforeStat.dev);
    assert.equal(afterStat.ino, beforeStat.ino);
  }
});

test('a legacy dead PID lock is recovered without leaving quarantine artifacts', async (t) => {
  const { directory, lockPath } = lockFixture(t);
  fs.writeFileSync(lockPath, '4321\n', { mode: 0o600 });

  const lock = await acquireOpenCodeCleanupLock(
    lockPath,
    acquisitionOptions({
      processLiveness(pid) {
        assert.equal(pid, 4321);
        return 'dead';
      },
    })
  );

  try {
    assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).token, 'new-owner');
    assert.deepEqual(quarantineArtifacts(directory), []);
  } finally {
    await lock.release();
  }
});

test('fresh empty and malformed locks remain protected before the exact grace boundary', async (t) => {
  const { directory } = lockFixture(t);

  for (const [name, bytes] of [
    ['empty', Buffer.alloc(0)],
    ['malformed', Buffer.from('{not-json}\n')],
  ]) {
    const lockPath = path.join(directory, `${name}.lock`);
    fs.writeFileSync(lockPath, bytes, { mode: 0o600 });
    const beforeStat = fs.statSync(lockPath);

    await assert.rejects(
      acquireOpenCodeCleanupLock(
        lockPath,
        acquisitionOptions({
          tokenFactory: () => `${name}-contender`,
          now: () =>
            Math.floor(beforeStat.mtimeMs) + OPEN_CODE_CLEANUP_MALFORMED_GRACE_MS - 1,
          retryAttempts: 2,
        })
      ),
      /busy/i
    );

    assert.deepEqual(fs.readFileSync(lockPath), bytes);
    const afterStat = fs.statSync(lockPath);
    assert.equal(afterStat.dev, beforeStat.dev);
    assert.equal(afterStat.ino, beforeStat.ino);
  }
});

test('an unchanged malformed lock is recoverable at the exact grace boundary after two snapshots', async (t) => {
  const { directory, lockPath } = lockFixture(t);
  fs.writeFileSync(lockPath, '{not-json}\n', { mode: 0o600 });
  const oldMtime = 1_000;
  fs.utimesSync(lockPath, oldMtime / 1_000, oldMtime / 1_000);
  let lockReads = 0;
  const originalOpen = fs.promises.open.bind(fs.promises);
  t.mock.method(fs.promises, 'open', async (target, flags, ...rest) => {
    if (target === lockPath && flags === 'r') {
      lockReads += 1;
    }
    return originalOpen(target, flags, ...rest);
  });

  const lock = await acquireOpenCodeCleanupLock(
    lockPath,
    acquisitionOptions({
      now: () => oldMtime + OPEN_CODE_CLEANUP_MALFORMED_GRACE_MS,
      retryDelayMs: 1,
    })
  );

  try {
    assert.equal(lockReads >= 3, true);
    assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).token, 'new-owner');
    assert.deepEqual(quarantineArtifacts(directory), []);
  } finally {
    await lock.release();
  }
});

test('an oversized old lock fails closed and is never recovered from a bounded prefix', async (t) => {
  const { lockPath } = lockFixture(t);
  const bytes = Buffer.alloc(4_097, 0x61);
  fs.writeFileSync(lockPath, bytes, { mode: 0o600 });
  const oldMtime = 1_000;
  fs.utimesSync(lockPath, oldMtime / 1_000, oldMtime / 1_000);
  const beforeStat = fs.statSync(lockPath);

  await assert.rejects(
    acquireOpenCodeCleanupLock(
      lockPath,
      acquisitionOptions({
        now: () => oldMtime + OPEN_CODE_CLEANUP_MALFORMED_GRACE_MS,
        retryAttempts: 2,
      })
    ),
    /busy/i
  );

  assert.deepEqual(fs.readFileSync(lockPath), bytes);
  const afterStat = fs.statSync(lockPath);
  assert.equal(afterStat.dev, beforeStat.dev);
  assert.equal(afterStat.ino, beforeStat.ino);
});

test('a malformed candidate changing between observations leaves its replacement untouched', async (t) => {
  const { directory, lockPath } = lockFixture(t);
  const originalBytes = Buffer.from('{old-malformed}\n');
  const replacementBytes = structuredOwnerBytes({
    hostname: 'remote-host',
    token: 'remote-replacement',
  });
  fs.writeFileSync(lockPath, originalBytes, { mode: 0o600 });
  const oldMtime = 1_000;
  fs.utimesSync(lockPath, oldMtime / 1_000, oldMtime / 1_000);
  const displacedPath = path.join(directory, 'displaced-malformed.lock');
  let reads = 0;
  const originalOpen = fs.promises.open.bind(fs.promises);
  t.mock.method(fs.promises, 'open', async (target, flags, ...rest) => {
    if (target === lockPath && flags === 'r') {
      reads += 1;
      if (reads === 2) {
        fs.renameSync(lockPath, displacedPath);
        fs.writeFileSync(lockPath, replacementBytes, { mode: 0o600 });
      }
    }
    return originalOpen(target, flags, ...rest);
  });

  await assert.rejects(
    acquireOpenCodeCleanupLock(
      lockPath,
      acquisitionOptions({
        now: () => oldMtime + OPEN_CODE_CLEANUP_MALFORMED_GRACE_MS,
        retryAttempts: 3,
      })
    ),
    /busy/i
  );

  assert.deepEqual(fs.readFileSync(lockPath), replacementBytes);
  assert.deepEqual(fs.readFileSync(displacedPath), originalBytes);
  assert.deepEqual(quarantineArtifacts(directory), []);
});

test('an acquirer whose provisional file is displaced never returns ownership', async (t) => {
  const { directory, lockPath } = lockFixture(t);
  const displacedPath = path.join(directory, 'displaced-provisional.lock');
  const replacementBytes = structuredOwnerBytes({
    hostname: 'remote-host',
    token: 'replacement-owner',
  });
  const originalOpen = fs.promises.open.bind(fs.promises);
  let displaced = false;
  t.mock.method(fs.promises, 'open', async (target, flags, ...rest) => {
    if (!displaced && target === lockPath && flags === 'r') {
      displaced = true;
      fs.renameSync(lockPath, displacedPath);
      fs.writeFileSync(lockPath, replacementBytes, { mode: 0o600 });
    }
    return originalOpen(target, flags, ...rest);
  });

  await assert.rejects(
    acquireOpenCodeCleanupLock(lockPath, acquisitionOptions({ retryAttempts: 1 })),
    /ownership changed/i
  );

  assert.deepEqual(fs.readFileSync(lockPath), replacementBytes);
  assert.equal(fs.existsSync(displacedPath), true);
});

test('release preserves a replacement installed before release', async (t) => {
  const { directory, lockPath } = lockFixture(t);
  const displacedPath = path.join(directory, 'released-owner.lock');
  const replacementBytes = structuredOwnerBytes({
    hostname: 'replacement-host',
    token: 'replacement-owner',
  });
  const lock = await acquireOpenCodeCleanupLock(lockPath, acquisitionOptions());

  fs.renameSync(lockPath, displacedPath);
  fs.writeFileSync(lockPath, replacementBytes, { mode: 0o600 });
  await lock.release();

  assert.deepEqual(fs.readFileSync(lockPath), replacementBytes);
  assert.equal(fs.existsSync(displacedPath), true);
});

test('release preserves identical owner bytes when the file identity was replaced', async (t) => {
  const { directory, lockPath } = lockFixture(t);
  const displacedPath = path.join(directory, 'same-bytes-old-owner.lock');
  const lock = await acquireOpenCodeCleanupLock(lockPath, acquisitionOptions());
  const ownerBytes = fs.readFileSync(lockPath);

  fs.renameSync(lockPath, displacedPath);
  fs.writeFileSync(lockPath, ownerBytes, { mode: 0o600 });
  const replacementStat = fs.statSync(lockPath);
  await lock.release();

  assert.deepEqual(fs.readFileSync(lockPath), ownerBytes);
  const afterStat = fs.statSync(lockPath);
  assert.equal(afterStat.dev, replacementStat.dev);
  assert.equal(afterStat.ino, replacementStat.ino);
});

test('release cannot unlink a replacement introduced after its final path check', async (t) => {
  const { directory, lockPath } = lockFixture(t);
  const displacedPath = path.join(directory, 'release-race-owner.lock');
  const replacementBytes = structuredOwnerBytes({
    hostname: 'replacement-host',
    token: 'release-race-replacement',
  });
  const lock = await acquireOpenCodeCleanupLock(lockPath, acquisitionOptions());
  const originalUnlink = fs.promises.unlink.bind(fs.promises);
  let injected = false;
  t.mock.method(fs.promises, 'unlink', async (target) => {
    if (!injected && target === lockPath) {
      injected = true;
      fs.renameSync(lockPath, displacedPath);
      fs.writeFileSync(lockPath, replacementBytes, { mode: 0o600 });
    }
    return originalUnlink(target);
  });

  await lock.release();

  assert.equal(injected, false, 'release must unlink only a verified quarantine path');
  assert.equal(fs.existsSync(lockPath), false);
  assert.equal(fs.existsSync(displacedPath), false);
});

test('a quarantine mismatch restores a moved replacement without overwriting', async (t) => {
  const { directory, lockPath } = lockFixture(t);
  const deadBytes = structuredOwnerBytes();
  const displacedPath = path.join(directory, 'displaced-dead-owner.lock');
  const replacementBytes = structuredOwnerBytes({
    hostname: 'remote-host',
    token: 'moved-replacement',
  });
  fs.writeFileSync(lockPath, deadBytes, { mode: 0o600 });
  const originalRename = fs.promises.rename.bind(fs.promises);
  let injected = false;
  t.mock.method(fs.promises, 'rename', async (source, destination) => {
    if (!injected && source === lockPath && String(destination).includes('quarantine')) {
      injected = true;
      fs.renameSync(lockPath, displacedPath);
      fs.writeFileSync(lockPath, replacementBytes, { mode: 0o600 });
    }
    return originalRename(source, destination);
  });

  await assert.rejects(
    acquireOpenCodeCleanupLock(
      lockPath,
      acquisitionOptions({
        processLiveness: () => 'dead',
        retryAttempts: 3,
      })
    ),
    /busy|ownership|changed/i
  );

  assert.equal(injected, true);
  assert.deepEqual(fs.readFileSync(lockPath), replacementBytes);
  assert.deepEqual(fs.readFileSync(displacedPath), deadBytes);
  assert.deepEqual(quarantineArtifacts(directory), []);
});

test('failed non-overwriting restoration preserves the winner and quarantine evidence', async (t) => {
  const { directory, lockPath } = lockFixture(t);
  const deadBytes = structuredOwnerBytes();
  const displacedPath = path.join(directory, 'displaced-dead-evidence.lock');
  const movedReplacement = structuredOwnerBytes({
    hostname: 'moved-host',
    token: 'moved-replacement',
  });
  const winnerBytes = structuredOwnerBytes({
    hostname: 'winner-host',
    token: 'winner-owner',
  });
  fs.writeFileSync(lockPath, deadBytes, { mode: 0o600 });
  const originalRename = fs.promises.rename.bind(fs.promises);
  let quarantinePath;
  t.mock.method(fs.promises, 'rename', async (source, destination) => {
    if (!quarantinePath && source === lockPath && String(destination).includes('quarantine')) {
      fs.renameSync(lockPath, displacedPath);
      fs.writeFileSync(lockPath, movedReplacement, { mode: 0o600 });
      await originalRename(source, destination);
      quarantinePath = String(destination);
      fs.writeFileSync(lockPath, winnerBytes, { mode: 0o600 });
      return;
    }
    return originalRename(source, destination);
  });

  await assert.rejects(
    acquireOpenCodeCleanupLock(
      lockPath,
      acquisitionOptions({
        processLiveness: () => 'dead',
      })
    ),
    /restore|quarantine|ownership|changed/i
  );

  assert.deepEqual(fs.readFileSync(lockPath), winnerBytes);
  assert.equal(typeof quarantinePath, 'string');
  assert.deepEqual(fs.readFileSync(quarantinePath), movedReplacement);
  assert.deepEqual(fs.readFileSync(displacedPath), deadBytes);
});

test('two contenders recovering one dead owner produce exactly one acquired owner', async (t) => {
  const { directory, lockPath } = lockFixture(t);
  fs.writeFileSync(lockPath, structuredOwnerBytes(), { mode: 0o600 });
  const liveness = (pid) => (pid === 4321 ? 'dead' : 'alive');

  const results = await Promise.allSettled([
    acquireOpenCodeCleanupLock(
      lockPath,
      acquisitionOptions({
        pid: 9101,
        tokenFactory: () => 'contender-one',
        processLiveness: liveness,
        retryAttempts: 20,
        retryDelayMs: 1,
      })
    ),
    acquireOpenCodeCleanupLock(
      lockPath,
      acquisitionOptions({
        pid: 9102,
        tokenFactory: () => 'contender-two',
        processLiveness: liveness,
        retryAttempts: 20,
        retryDelayMs: 1,
      })
    ),
  ]);

  const acquired = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  assert.equal(acquired.length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.deepEqual(quarantineArtifacts(directory), []);
  await acquired[0].release();
});
