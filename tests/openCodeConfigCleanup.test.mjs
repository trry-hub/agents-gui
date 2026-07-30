import assert from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  OpenCodeConfigCleanupMigration,
  OPENCODE_NATIVE_PASSTHROUGH_CLEANUP_KEY,
  runOpenCodeCleanupActivationGate,
  runOpenCodeCleanupOnce,
  syncOpenCodeConfigDirectory,
} from '../.test-dist/openCodeConfigCleanup.js';

function fixture(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-gui-native-cleanup-'));
  const configPath = path.join(dir, 'opencode.json');
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return { dir, configPath };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function migrationArtifacts(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.includes('native-cli-tmp') || name.endsWith('native-cli.lock'));
}

test('cleanup removes only exactly tagged providers and their selected model', async () => {
  const { dir, configPath } = fixture({
    $schema: 'https://opencode.ai/config.json',
    model: 'agents_gui_mimo/mimo-v2.5-pro',
    provider: {
      agents_gui_mimo: { __agents_gui_synced: true, options: { apiKey: 'legacy' } },
      marker_string: { __agents_gui_synced: 'true' },
      marker_false: { __agents_gui_synced: false },
      user_provider: { name: 'User provider' },
    },
    mcp: { local: { type: 'local', command: ['example'] } },
  });

  const result = await new OpenCodeConfigCleanupMigration({ configPath }).cleanup();
  const config = readJson(configPath);

  assert.equal(result.changed, true);
  assert.deepEqual(result.removedProviderKeys, ['agents_gui_mimo']);
  assert.equal(result.removedTopLevelModel, true);
  assert.ok(result.backupPath);
  assert.equal(config.model, undefined);
  assert.equal(config.provider.agents_gui_mimo, undefined);
  assert.equal(config.provider.marker_string.__agents_gui_synced, 'true');
  assert.equal(config.provider.marker_false.__agents_gui_synced, false);
  assert.equal(config.provider.user_provider.name, 'User provider');
  assert.equal(config.mcp.local.type, 'local');
  assert.deepEqual(readJson(result.backupPath), {
    $schema: 'https://opencode.ai/config.json',
    model: 'agents_gui_mimo/mimo-v2.5-pro',
    provider: {
      agents_gui_mimo: { __agents_gui_synced: true, options: { apiKey: 'legacy' } },
      marker_string: { __agents_gui_synced: 'true' },
      marker_false: { __agents_gui_synced: false },
      user_provider: { name: 'User provider' },
    },
    mcp: { local: { type: 'local', command: ['example'] } },
  });
  assert.equal(fs.readdirSync(dir).filter((name) => name.includes('native-cli-bak')).length, 1);
});

test('cleanup preserves a nonmatching model and does not confuse provider prefixes', async () => {
  const { configPath } = fixture({
    model: 'agents_gui_mimo_extra/model',
    provider: {
      agents_gui_mimo: { __agents_gui_synced: true },
      agents_gui_mimo_extra: { name: 'User provider' },
    },
  });

  const result = await new OpenCodeConfigCleanupMigration({ configPath }).cleanup();
  assert.equal(result.removedTopLevelModel, false);
  assert.equal(readJson(configPath).model, 'agents_gui_mimo_extra/model');
});

test('cleanup is byte-stable and creates no backup when no tagged entry exists', async () => {
  const { dir, configPath } = fixture({
    model: 'user/model',
    provider: { user: { name: 'User provider' } },
  });
  const before = fs.readFileSync(configPath);

  const result = await new OpenCodeConfigCleanupMigration({ configPath }).cleanup();

  assert.deepEqual(result, {
    changed: false,
    removedProviderKeys: [],
    removedTopLevelModel: false,
  });
  assert.deepEqual(fs.readFileSync(configPath), before);
  assert.equal(fs.readdirSync(dir).filter((name) => name.includes('native-cli-bak')).length, 0);
});

test('cleanup does not acquire a busy write lock when no tagged entry needs mutation', async () => {
  const { dir, configPath } = fixture({
    model: 'user/model',
    provider: { user: { name: 'User provider' } },
  });
  const before = fs.readFileSync(configPath);
  const lockPath = `${configPath}.agents-gui-native-cli.lock`;
  fs.writeFileSync(lockPath, 'another process owns the write lock');

  const result = await new OpenCodeConfigCleanupMigration({
    configPath,
    lockRetryAttempts: 1,
  }).cleanup();

  assert.deepEqual(result, {
    changed: false,
    removedProviderKeys: [],
    removedTopLevelModel: false,
  });
  assert.deepEqual(fs.readFileSync(configPath), before);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), 'another process owns the write lock');
  assert.equal(fs.readdirSync(dir).filter((name) => name.includes('native-cli-bak')).length, 0);
});

test('cleanup is unchanged when the config parent directory does not exist', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-gui-native-cleanup-missing-'));
  const missingParent = path.join(root, 'not-created');
  const configPath = path.join(missingParent, 'opencode.json');

  const result = await new OpenCodeConfigCleanupMigration({ configPath }).cleanup();

  assert.deepEqual(result, {
    changed: false,
    removedProviderKeys: [],
    removedTopLevelModel: false,
  });
  assert.equal(fs.existsSync(missingParent), false);
});

test('runOpenCodeCleanupOnce records success locally and retries failures', async () => {
  const values = new Map();
  const state = {
    get: (key) => values.get(key),
    update: async (key, value) => values.set(key, value),
  };
  let calls = 0;
  const migration = {
    cleanup: async () => {
      calls += 1;
      return { changed: false, removedProviderKeys: [], removedTopLevelModel: false };
    },
  };

  await runOpenCodeCleanupOnce(state, migration);
  await runOpenCodeCleanupOnce(state, migration);

  assert.equal(calls, 1);
  assert.equal(values.get(OPENCODE_NATIVE_PASSTHROUGH_CLEANUP_KEY), true);

  const failingValues = new Map();
  const failingState = {
    get: (key) => failingValues.get(key),
    update: async (key, value) => failingValues.set(key, value),
  };
  await assert.rejects(
    runOpenCodeCleanupOnce(failingState, { cleanup: async () => { throw new Error('backup failed'); } }),
    /backup failed/
  );
  assert.equal(failingValues.has(OPENCODE_NATIVE_PASSTHROUGH_CLEANUP_KEY), false);
});

test('cleanup commits through a same-directory temp while preserving bytes, mode, and backup collisions', async () => {
  const { dir, configPath } = fixture({
    model: 'agents_gui_mimo/model',
    provider: {
      agents_gui_mimo: { __agents_gui_synced: true },
      user: { name: 'User provider' },
    },
  });
  fs.chmodSync(configPath, 0o640);
  const original = fs.readFileSync(configPath);
  const now = () => new Date('2026-07-30T00:00:00.000Z');
  const collidingBackup =
    `${configPath}.agents-gui-native-cli-bak-2026-07-30T00-00-00-000Z`;
  fs.writeFileSync(collidingBackup, 'do not overwrite this backup');
  let inspectedBeforeCommit = false;

  const result = await new OpenCodeConfigCleanupMigration({
    configPath,
    now,
    beforeCommit: async () => {
      inspectedBeforeCommit = true;
      assert.deepEqual(fs.readFileSync(configPath), original);
      assert.equal(
        fs.readdirSync(dir).filter((name) => name.includes('native-cli-tmp')).length,
        1
      );
    },
  }).cleanup();

  assert.equal(inspectedBeforeCommit, true);
  assert.notEqual(result.backupPath, collidingBackup);
  assert.equal(fs.readFileSync(collidingBackup, 'utf8'), 'do not overwrite this backup');
  assert.deepEqual(fs.readFileSync(result.backupPath), original);
  assert.equal(fs.statSync(result.backupPath).mode & 0o777, 0o640);
  assert.equal(fs.statSync(configPath).mode & 0o777, 0o640);
  assert.deepEqual(migrationArtifacts(dir), []);
});

test('cleanup detects an external edit before atomic replacement and never overwrites it', async () => {
  const { dir, configPath } = fixture({
    provider: {
      agents_gui_mimo: { __agents_gui_synced: true },
    },
  });
  const externalBytes = Buffer.from(
    `${JSON.stringify({ provider: { external: { name: 'concurrent edit' } } }, null, 2)}\n`
  );

  await assert.rejects(
    new OpenCodeConfigCleanupMigration({
      configPath,
      beforeCommit: async () => {
        fs.writeFileSync(configPath, externalBytes);
      },
    }).cleanup(),
    /changed while.*cleanup|concurrent.*OpenCode config/i
  );

  assert.deepEqual(fs.readFileSync(configPath), externalBytes);
  assert.deepEqual(migrationArtifacts(dir), []);
});

test('concurrent cleanup calls serialize and create exactly one backup', async () => {
  const { dir, configPath } = fixture({
    model: 'agents_gui_mimo/model',
    provider: {
      agents_gui_mimo: { __agents_gui_synced: true },
    },
  });
  const now = () => new Date('2026-07-30T00:00:00.000Z');

  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      new OpenCodeConfigCleanupMigration({
        configPath,
        now,
        lockRetryDelayMs: 1,
        lockRetryAttempts: 2_000,
      }).cleanup()
    )
  );

  assert.equal(results.filter((result) => result.changed).length, 1);
  assert.equal(fs.readdirSync(dir).filter((name) => name.includes('native-cli-bak')).length, 1);
  assert.deepEqual(migrationArtifacts(dir), []);
});

test('cleanup fails with an actionable error when its same-directory lock stays busy', async () => {
  const { dir, configPath } = fixture({
    provider: {
      agents_gui_mimo: { __agents_gui_synced: true },
    },
  });
  const lockPath = `${configPath}.agents-gui-native-cli.lock`;
  fs.writeFileSync(lockPath, 'another migration owns this lock');

  await assert.rejects(
    new OpenCodeConfigCleanupMigration({
      configPath,
      lockRetryDelayMs: 1,
      lockRetryAttempts: 2,
    }).cleanup(),
    /OpenCode config cleanup lock.*busy|timed out.*OpenCode config/i
  );

  assert.equal(readJson(configPath).provider.agents_gui_mimo.__agents_gui_synced, true);
  assert.deepEqual(migrationArtifacts(dir), [path.basename(lockPath)]);
});

test('activation gate disables only OpenCode for the window when cleanup fails', async () => {
  const reported = [];
  const state = {
    get() {
      return undefined;
    },
    async update() {
      throw new Error('migration success must not be recorded');
    },
  };
  const disabled = await runOpenCodeCleanupActivationGate(
    state,
    {
      async cleanup() {
        throw new Error('config directory is read-only');
      },
    },
    async (error) => reported.push(error)
  );

  assert.deepEqual([...disabled], ['opencode']);
  assert.equal(reported.length, 1);
  assert.match(reported[0].message, /read-only/);

  const successful = await runOpenCodeCleanupActivationGate(
    {
      get() {
        return true;
      },
      async update() {},
    },
    {
      async cleanup() {
        throw new Error('already-completed cleanup must not run');
      },
    },
    async () => {
      throw new Error('success must not report an activation failure');
    }
  );
  assert.deepEqual([...successful], []);
});

test('directory fsync tolerates only unsupported Windows directory-handle errors', async () => {
  for (const code of ['EACCES', 'EBADF', 'EISDIR', 'EINVAL', 'EPERM']) {
    await assert.doesNotReject(
      syncOpenCodeConfigDirectory('/config', 'win32', async () => {
        throw Object.assign(new Error(code), { code });
      })
    );
  }

  await assert.rejects(
    syncOpenCodeConfigDirectory('/config', 'linux', async () => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    }),
    /EPERM/
  );

  let closed = false;
  await assert.doesNotReject(
    syncOpenCodeConfigDirectory('/config', 'win32', async () => ({
      async sync() {
        throw Object.assign(new Error('EINVAL'), { code: 'EINVAL' });
      },
      async close() {
        closed = true;
      },
    }))
  );
  assert.equal(closed, true);

  await assert.rejects(
    syncOpenCodeConfigDirectory('/config', 'win32', async () => ({
      async sync() {
        throw Object.assign(new Error('disk failure'), { code: 'EIO' });
      },
      async close() {},
    })),
    /disk failure/
  );
});
