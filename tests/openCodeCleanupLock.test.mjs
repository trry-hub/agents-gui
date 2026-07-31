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

const cleanupLockSource = fs.readFileSync(
  new URL('../src/openCodeCleanupLock.ts', import.meta.url),
  'utf8'
);

function lockFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-gui-cleanup-lock-'));
  const lockPath = path.join(directory, 'opencode.json.agents-gui-native-cli.lock');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, lockPath, sidecarPath: `${lockPath}.v2` };
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

function structuredFileOwner({
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

function directoryOwnerNames(lockPath) {
  return fs.readdirSync(lockPath);
}

function statIdentity(target) {
  const stat = fs.lstatSync(target, { bigint: true });
  return { dev: stat.dev, ino: stat.ino };
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

test('acquisition publishes one bounded path-safe owner directory and blocks legacy wx', async (t) => {
  const { lockPath } = lockFixture(t);
  const lock = await acquireOpenCodeCleanupLock(lockPath, {
    pid: 4321,
    hostname: 'host/with/separators',
    tokenFactory: () => '../owner/token',
    now: () => 123_456,
    retryAttempts: 1,
    retryDelayMs: 0,
  });

  try {
    assert.equal(fs.lstatSync(lockPath).isDirectory(), true);
    const names = directoryOwnerNames(lockPath);
    assert.equal(names.length, 1);
    assert.match(
      names[0],
      /^owner-v1-[1-9]\d*-(?:0|[1-9]\d*)-[A-Za-z0-9_-]{43}-[A-Za-z0-9_-]{43}$/
    );
    assert.equal(Buffer.byteLength(names[0]) < 255, true);
    assert.equal(names[0].includes('host/with/separators'), false);
    assert.equal(names[0].includes('../owner/token'), false);
    assert.equal(fs.lstatSync(path.join(lockPath, names[0])).isDirectory(), true);
    assert.equal(lock.path, lockPath);
    assert.equal(lock.token, '../owner/token');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(lockPath).mode & 0o777, 0o700);
    }
    await assert.rejects(fs.promises.open(lockPath, 'wx', 0o600), /EEXIST/);
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

test('a live directory owner stays identity-stable while a contender exhausts retries', async (t) => {
  const { lockPath } = lockFixture(t);
  const owner = await acquireOpenCodeCleanupLock(lockPath, {
    ...acquisitionOptions(),
    pid: 1001,
    tokenFactory: () => 'first-owner',
  });
  const beforeIdentity = statIdentity(lockPath);
  const beforeNames = directoryOwnerNames(lockPath);
  const observedPids = [];

  try {
    await assert.rejects(
      acquireOpenCodeCleanupLock(lockPath, {
        ...acquisitionOptions(),
        pid: 1002,
        tokenFactory: () => 'second-owner',
        processLiveness(pid) {
          observedPids.push(pid);
          return 'alive';
        },
        retryAttempts: 2,
      }),
      /OpenCode config cleanup lock.*busy.*2 attempts/i
    );
    assert.deepEqual(observedPids, [1001, 1001]);
    assert.deepEqual(statIdentity(lockPath), beforeIdentity);
    assert.deepEqual(directoryOwnerNames(lockPath), beforeNames);
  } finally {
    await owner.release();
  }
});

test('different-host and unknown directory owners are never recovered', async (t) => {
  const { directory } = lockFixture(t);
  const cases = [
    [
      'different-host',
      'remote-host',
      () => {
        throw new Error('must not probe');
      },
    ],
    ['unknown', 'test-host', () => 'unknown'],
  ];

  for (const [name, hostname, processLiveness] of cases) {
    const lockPath = path.join(directory, `${name}.lock`);
    const owner = await acquireOpenCodeCleanupLock(lockPath, {
      ...acquisitionOptions(),
      pid: 4321,
      hostname,
      tokenFactory: () => `${name}-owner`,
      retryAttempts: 1,
    });
    const before = statIdentity(lockPath);
    try {
      await assert.rejects(
        acquireOpenCodeCleanupLock(lockPath, {
          ...acquisitionOptions(),
          tokenFactory: () => `${name}-contender`,
          processLiveness,
          retryAttempts: 2,
        }),
        /busy/i
      );
      assert.deepEqual(statIdentity(lockPath), before);
    } finally {
      await owner.release();
    }
  }
});

test('a same-host dead directory owner is recovered without rename or unlink', async (t) => {
  const { lockPath } = lockFixture(t);
  const abandoned = await acquireOpenCodeCleanupLock(lockPath, {
    ...acquisitionOptions(),
    pid: 4321,
    tokenFactory: () => 'abandoned-owner',
    retryAttempts: 1,
  });
  const oldIdentity = statIdentity(lockPath);
  const observedPids = [];

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
    assert.notDeepEqual(statIdentity(lockPath), oldIdentity);
    assert.equal(directoryOwnerNames(lockPath).length, 1);
  } finally {
    await lock.release();
    await abandoned.release();
  }
});

test('fresh empty directory locks remain protected before the exact grace boundary', async (t) => {
  const { lockPath } = lockFixture(t);
  fs.mkdirSync(lockPath, { mode: 0o700 });
  const oldMtime = 1_000;
  fs.utimesSync(lockPath, oldMtime / 1_000, oldMtime / 1_000);
  const before = statIdentity(lockPath);

  await assert.rejects(
    acquireOpenCodeCleanupLock(
      lockPath,
      acquisitionOptions({
        now: () => oldMtime + OPEN_CODE_CLEANUP_MALFORMED_GRACE_MS - 1,
        retryAttempts: 2,
      })
    ),
    /busy/i
  );
  assert.deepEqual(statIdentity(lockPath), before);
  assert.deepEqual(directoryOwnerNames(lockPath), []);
});

test('an unchanged empty directory is recoverable at the exact grace boundary after two snapshots', async (t) => {
  const { lockPath } = lockFixture(t);
  fs.mkdirSync(lockPath, { mode: 0o700 });
  const oldMtime = 1_000;
  fs.utimesSync(lockPath, oldMtime / 1_000, oldMtime / 1_000);
  let reads = 0;
  const originalLstat = fs.promises.lstat.bind(fs.promises);
  t.mock.method(fs.promises, 'lstat', async (target, ...rest) => {
    if (target === lockPath) {
      reads += 1;
    }
    return originalLstat(target, ...rest);
  });

  const lock = await acquireOpenCodeCleanupLock(
    lockPath,
    acquisitionOptions({
      now: () => oldMtime + OPEN_CODE_CLEANUP_MALFORMED_GRACE_MS,
      retryDelayMs: 1,
    })
  );
  try {
    assert.equal(reads >= 4, true);
    assert.equal(directoryOwnerNames(lockPath).length, 1);
  } finally {
    await lock.release();
  }
});

test('aged invalid or non-empty malformed directory locks fail closed', async (t) => {
  const { lockPath } = lockFixture(t);
  fs.mkdirSync(lockPath, { mode: 0o700 });
  fs.mkdirSync(path.join(lockPath, 'not-a-canonical-owner'), { mode: 0o700 });
  const oldMtime = 1_000;
  fs.utimesSync(lockPath, oldMtime / 1_000, oldMtime / 1_000);

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
  assert.deepEqual(directoryOwnerNames(lockPath), ['not-a-canonical-owner']);
});

test('a non-empty canonical owner marker is never removed during dead-owner recovery', async (t) => {
  const { lockPath } = lockFixture(t);
  const abandoned = await acquireOpenCodeCleanupLock(lockPath, {
    ...acquisitionOptions(),
    pid: 4321,
    tokenFactory: () => 'abandoned-owner',
    retryAttempts: 1,
  });
  const ownerName = directoryOwnerNames(lockPath)[0];
  const evidencePath = path.join(lockPath, ownerName, 'evidence');
  fs.writeFileSync(evidencePath, 'preserve');

  await assert.rejects(
    acquireOpenCodeCleanupLock(
      lockPath,
      acquisitionOptions({ processLiveness: () => 'dead', retryAttempts: 1 })
    ),
    /ENOTEMPTY|not empty|busy/i
  );
  assert.equal(fs.readFileSync(evidencePath, 'utf8'), 'preserve');

  fs.rmSync(evidencePath);
  await abandoned.release();
});

test('release preserves a replacement directory installed before release', async (t) => {
  const { directory, lockPath } = lockFixture(t);
  const displacedPath = path.join(directory, 'displaced-owner.lock');
  const owner = await acquireOpenCodeCleanupLock(lockPath, acquisitionOptions());
  fs.renameSync(lockPath, displacedPath);
  const replacement = await acquireOpenCodeCleanupLock(lockPath, {
    ...acquisitionOptions(),
    pid: 9002,
    tokenFactory: () => 'replacement-owner',
  });
  const replacementIdentity = statIdentity(lockPath);

  await owner.release();
  assert.deepEqual(statIdentity(lockPath), replacementIdentity);
  await replacement.release();
  assert.equal(fs.existsSync(displacedPath), true);
});

test('release remains retryable after transient owner-directory removal failure', async (t) => {
  const { lockPath } = lockFixture(t);
  const lock = await acquireOpenCodeCleanupLock(lockPath, acquisitionOptions());
  const ownerName = directoryOwnerNames(lockPath)[0];
  const ownerPath = path.join(lockPath, ownerName);
  const originalRmdir = fs.promises.rmdir.bind(fs.promises);
  let calls = 0;
  t.mock.method(fs.promises, 'rmdir', async (target, ...rest) => {
    if (target === ownerPath) {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error('transient antivirus lock'), { code: 'EACCES' });
      }
    }
    return originalRmdir(target, ...rest);
  });

  await assert.rejects(lock.release(), /antivirus|EACCES/i);
  assert.equal(fs.existsSync(ownerPath), true);
  await lock.release();
  assert.equal(calls, 2);
  assert.equal(fs.existsSync(lockPath), false);
});

test('release restores its owner marker when root removal fails and remains retryable', async (t) => {
  const { lockPath } = lockFixture(t);
  const lock = await acquireOpenCodeCleanupLock(lockPath, acquisitionOptions());
  const ownerName = directoryOwnerNames(lockPath)[0];
  const originalRmdir = fs.promises.rmdir.bind(fs.promises);
  let rootCalls = 0;
  t.mock.method(fs.promises, 'rmdir', async (target, ...rest) => {
    if (target === lockPath) {
      rootCalls += 1;
      if (rootCalls === 1) {
        throw Object.assign(new Error('transient root handle'), { code: 'EACCES' });
      }
    }
    return originalRmdir(target, ...rest);
  });

  await assert.rejects(lock.release(), /root handle|EACCES/i);
  assert.deepEqual(directoryOwnerNames(lockPath), [ownerName]);
  await lock.release();
  assert.equal(rootCalls, 2);
  assert.equal(fs.existsSync(lockPath), false);
});

test('non-recursive root removal cannot delete a replacement winner with evidence', async (t) => {
  const { directory, lockPath } = lockFixture(t);
  const displacedPath = path.join(directory, 'displaced-empty-root');
  const lock = await acquireOpenCodeCleanupLock(lockPath, acquisitionOptions());
  const winnerMarker = 'winner-evidence';
  const originalRmdir = fs.promises.rmdir.bind(fs.promises);
  let injected = false;
  t.mock.method(fs.promises, 'rmdir', async (target, ...rest) => {
    if (!injected && target === lockPath) {
      injected = true;
      fs.renameSync(lockPath, displacedPath);
      fs.mkdirSync(lockPath, { mode: 0o700 });
      fs.mkdirSync(path.join(lockPath, winnerMarker), { mode: 0o700 });
    }
    return originalRmdir(target, ...rest);
  });

  await assert.rejects(lock.release(), /ENOTEMPTY|not empty|ownership|identity/i);
  assert.equal(injected, true);
  assert.deepEqual(directoryOwnerNames(lockPath), [winnerMarker]);
  assert.equal(fs.existsSync(displacedPath), true);
});

test('directory lock source uses only atomic mkdir and non-recursive rmdir mutations', () => {
  assert.match(cleanupLockSource, /fs\.promises\.mkdir\(/);
  assert.match(cleanupLockSource, /fs\.promises\.rmdir\(/);
  assert.doesNotMatch(cleanupLockSource, /fs\.promises\.(?:rename|unlink|rm)\(/);
  assert.doesNotMatch(cleanupLockSource, /quarantine/i);
  assert.match(cleanupLockSource, /\.lstat\([^,\n]+,\s*\{\s*bigint:\s*true\s*\}\)/);
  assert.match(cleanupLockSource, /\bfs\.BigIntStats\b/);
});

test('dead structured and PID-only legacy files remain poison pills while a v2 sidecar owns cleanup', async (t) => {
  const { directory } = lockFixture(t);
  const cases = [
    ['structured', structuredFileOwner()],
    ['pid-only', Buffer.from('4321\n')],
  ];

  for (const [name, bytes] of cases) {
    const lockPath = path.join(directory, `${name}.lock`);
    const sidecarPath = `${lockPath}.v2`;
    fs.writeFileSync(lockPath, bytes, { mode: 0o600 });
    const before = statIdentity(lockPath);

    const lock = await acquireOpenCodeCleanupLock(
      lockPath,
      acquisitionOptions({
        tokenFactory: () => `${name}-successor`,
        processLiveness(pid) {
          assert.equal(pid, 4321);
          return 'dead';
        },
      })
    );
    try {
      assert.equal(lock.path, lockPath);
      assert.deepEqual(fs.readFileSync(lockPath), bytes);
      assert.deepEqual(statIdentity(lockPath), before);
      assert.equal(fs.lstatSync(sidecarPath).isDirectory(), true);
      assert.equal(directoryOwnerNames(sidecarPath).length, 1);
    } finally {
      await lock.release();
    }
    assert.deepEqual(fs.readFileSync(lockPath), bytes);
    assert.deepEqual(statIdentity(lockPath), before);
    assert.equal(fs.existsSync(sidecarPath), false);
  }
});

test('live, unknown, and different-host legacy file owners fail closed without a sidecar', async (t) => {
  const { directory } = lockFixture(t);
  const cases = [
    ['live', structuredFileOwner(), () => 'alive'],
    ['unknown', structuredFileOwner(), () => 'unknown'],
    [
      'different-host',
      structuredFileOwner({ hostname: 'remote-host' }),
      () => {
        throw new Error('remote owner must not be probed');
      },
    ],
  ];

  for (const [name, bytes, processLiveness] of cases) {
    const lockPath = path.join(directory, `${name}.lock`);
    fs.writeFileSync(lockPath, bytes, { mode: 0o600 });
    const before = statIdentity(lockPath);
    await assert.rejects(
      acquireOpenCodeCleanupLock(
        lockPath,
        acquisitionOptions({ processLiveness, retryAttempts: 2 })
      ),
      /busy/i
    );
    assert.deepEqual(fs.readFileSync(lockPath), bytes);
    assert.deepEqual(statIdentity(lockPath), before);
    assert.equal(fs.existsSync(`${lockPath}.v2`), false);
  }
});

test('fresh malformed legacy files remain protected before the exact grace boundary', async (t) => {
  const { lockPath, sidecarPath } = lockFixture(t);
  const bytes = Buffer.from('{not-json}\n');
  fs.writeFileSync(lockPath, bytes, { mode: 0o600 });
  const oldMtime = 1_000;
  fs.utimesSync(lockPath, oldMtime / 1_000, oldMtime / 1_000);

  await assert.rejects(
    acquireOpenCodeCleanupLock(
      lockPath,
      acquisitionOptions({
        now: () => oldMtime + OPEN_CODE_CLEANUP_MALFORMED_GRACE_MS - 1,
        retryAttempts: 2,
      })
    ),
    /busy/i
  );
  assert.deepEqual(fs.readFileSync(lockPath), bytes);
  assert.equal(fs.existsSync(sidecarPath), false);
});

test('an unchanged malformed legacy file is fenced by a sidecar at the exact grace boundary', async (t) => {
  const { lockPath, sidecarPath } = lockFixture(t);
  const bytes = Buffer.from('{not-json}\n');
  fs.writeFileSync(lockPath, bytes, { mode: 0o600 });
  const oldMtime = 1_000;
  fs.utimesSync(lockPath, oldMtime / 1_000, oldMtime / 1_000);
  const before = statIdentity(lockPath);

  const lock = await acquireOpenCodeCleanupLock(
    lockPath,
    acquisitionOptions({
      now: () => oldMtime + OPEN_CODE_CLEANUP_MALFORMED_GRACE_MS,
      retryDelayMs: 1,
    })
  );
  try {
    assert.deepEqual(fs.readFileSync(lockPath), bytes);
    assert.deepEqual(statIdentity(lockPath), before);
    assert.equal(fs.lstatSync(sidecarPath).isDirectory(), true);
  } finally {
    await lock.release();
  }
  assert.equal(fs.existsSync(sidecarPath), false);
});

test('oversized legacy files fail closed and never create a sidecar', async (t) => {
  const { lockPath, sidecarPath } = lockFixture(t);
  const bytes = Buffer.alloc(4_097, 0x61);
  fs.writeFileSync(lockPath, bytes, { mode: 0o600 });
  const oldMtime = 1_000;
  fs.utimesSync(lockPath, oldMtime / 1_000, oldMtime / 1_000);

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
  assert.equal(fs.existsSync(sidecarPath), false);
});

test('a legacy poison pill changing after sidecar acquisition never returns ownership', async (t) => {
  const { lockPath, sidecarPath } = lockFixture(t);
  const originalBytes = structuredFileOwner();
  const replacementBytes = structuredFileOwner({
    hostname: 'remote-host',
    token: 'replacement-owner',
  });
  fs.writeFileSync(lockPath, originalBytes, { mode: 0o600 });
  const displacedPath = `${lockPath}.displaced`;
  const originalMkdir = fs.promises.mkdir.bind(fs.promises);
  let injected = false;
  t.mock.method(fs.promises, 'mkdir', async (target, ...rest) => {
    const result = await originalMkdir(target, ...rest);
    if (!injected && target === sidecarPath) {
      injected = true;
      fs.renameSync(lockPath, displacedPath);
      fs.writeFileSync(lockPath, replacementBytes, { mode: 0o600 });
    }
    return result;
  });

  await assert.rejects(
    acquireOpenCodeCleanupLock(
      lockPath,
      acquisitionOptions({ processLiveness: () => 'dead', retryAttempts: 1 })
    ),
    /busy|ownership|changed/i
  );
  assert.equal(injected, true);
  assert.deepEqual(fs.readFileSync(lockPath), replacementBytes);
  assert.deepEqual(fs.readFileSync(displacedPath), originalBytes);
  assert.equal(fs.existsSync(sidecarPath), false);
});

test('two contenders recovering one dead directory owner produce exactly one acquired owner', async (t) => {
  const { lockPath } = lockFixture(t);
  const abandoned = await acquireOpenCodeCleanupLock(lockPath, {
    ...acquisitionOptions(),
    pid: 4321,
    tokenFactory: () => 'abandoned-owner',
    retryAttempts: 1,
  });
  const liveness = (pid) => (pid === 4321 ? 'dead' : 'alive');

  const results = await Promise.allSettled([
    acquireOpenCodeCleanupLock(lockPath, {
      ...acquisitionOptions(),
      pid: 9101,
      tokenFactory: () => 'contender-one',
      processLiveness: liveness,
      retryAttempts: 20,
      retryDelayMs: 1,
    }),
    acquireOpenCodeCleanupLock(lockPath, {
      ...acquisitionOptions(),
      pid: 9102,
      tokenFactory: () => 'contender-two',
      processLiveness: liveness,
      retryAttempts: 20,
      retryDelayMs: 1,
    }),
  ]);

  const acquired = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  assert.equal(acquired.length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  await acquired[0].release();
  await abandoned.release();
});

test('two contenders recovering one dead legacy file produce exactly one sidecar owner', async (t) => {
  const { lockPath, sidecarPath } = lockFixture(t);
  const poisonBytes = structuredFileOwner();
  fs.writeFileSync(lockPath, poisonBytes, { mode: 0o600 });
  const liveness = (pid) => (pid === 4321 ? 'dead' : 'alive');

  const results = await Promise.allSettled([
    acquireOpenCodeCleanupLock(lockPath, {
      ...acquisitionOptions(),
      pid: 9101,
      tokenFactory: () => 'contender-one',
      processLiveness: liveness,
      retryAttempts: 20,
      retryDelayMs: 1,
    }),
    acquireOpenCodeCleanupLock(lockPath, {
      ...acquisitionOptions(),
      pid: 9102,
      tokenFactory: () => 'contender-two',
      processLiveness: liveness,
      retryAttempts: 20,
      retryDelayMs: 1,
    }),
  ]);

  const acquired = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  assert.equal(acquired.length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.deepEqual(fs.readFileSync(lockPath), poisonBytes);
  assert.equal(fs.lstatSync(sidecarPath).isDirectory(), true);
  await acquired[0].release();
  assert.equal(fs.existsSync(sidecarPath), false);
  assert.deepEqual(fs.readFileSync(lockPath), poisonBytes);
});
