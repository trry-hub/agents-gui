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
import { acquireOpenCodeCleanupLock } from '../.test-dist/openCodeCleanupLock.js';

function fixture(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-gui-native-cleanup-'));
  const configPath = path.join(dir, 'opencode.json');
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return { dir, configPath };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function createFileSymlink(t, targetPath, linkPath, { absolute = false } = {}) {
  try {
    fs.symlinkSync(
      absolute ? targetPath : path.relative(path.dirname(linkPath), targetPath),
      linkPath,
      process.platform === 'win32' ? 'file' : undefined
    );
    return true;
  } catch (error) {
    if (
      process.platform === 'win32' &&
      (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'UNKNOWN')
    ) {
      t.skip(`Windows runner cannot create file symlinks: ${error.code}`);
      return false;
    }
    throw error;
  }
}

function createDirectoryLink(t, targetPath, linkPath) {
  try {
    fs.symlinkSync(
      process.platform === 'win32' ? targetPath : path.relative(path.dirname(linkPath), targetPath),
      linkPath,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    return true;
  } catch (error) {
    if (
      process.platform === 'win32' &&
      (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'UNKNOWN')
    ) {
      t.skip(`Windows runner cannot create directory junctions: ${error.code}`);
      return false;
    }
    throw error;
  }
}

function migrationArtifacts(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.includes('native-cli-tmp') || name.includes('native-cli.lock'));
}

function cleanupLockOptions(processLiveness, overrides = {}) {
  return {
    pid: 9001,
    hostname: 'cleanup-test-host',
    tokenFactory: () => 'recovered-cleanup-owner',
    now: () => 1_000_000,
    processLiveness,
    retryAttempts: 1,
    retryDelayMs: 0,
    ...overrides,
  };
}

function structuredLockOwner({
  pid = 4321,
  hostname = 'cleanup-test-host',
  token = 'abandoned-owner',
  createdAt = 1_000,
} = {}) {
  return `${JSON.stringify({ version: 1, pid, hostname, token, createdAt })}\n`;
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
    runOpenCodeCleanupOnce(failingState, {
      cleanup: async () => {
        throw new Error('backup failed');
      },
    }),
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
  const collidingBackup = `${configPath}.agents-gui-native-cli-bak-2026-07-30T00-00-00-000Z`;
  fs.writeFileSync(collidingBackup, 'do not overwrite this backup');
  let inspectedBeforeCommit = false;

  const result = await new OpenCodeConfigCleanupMigration({
    configPath,
    now,
    beforeCommit: async () => {
      inspectedBeforeCommit = true;
      assert.deepEqual(fs.readFileSync(configPath), original);
      assert.equal(fs.readdirSync(dir).filter((name) => name.includes('native-cli-tmp')).length, 1);
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

test('cleanup preserves a config symlink and migrates its canonical target', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-gui-native-cleanup-symlink-'));
  const configDirectory = path.join(root, 'config');
  const targetDirectory = path.join(root, 'dotfiles');
  fs.mkdirSync(configDirectory);
  fs.mkdirSync(targetDirectory);
  const configPath = path.join(configDirectory, 'opencode.json');
  const targetPath = path.join(targetDirectory, 'opencode.json');
  const original = Buffer.from(
    `${JSON.stringify(
      {
        model: 'agents_gui_mimo/model',
        provider: {
          agents_gui_mimo: { __agents_gui_synced: true },
          user_provider: { name: 'User provider' },
        },
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(targetPath, original);
  fs.chmodSync(targetPath, 0o640);
  if (!createFileSymlink(t, targetPath, configPath)) {
    return;
  }
  const canonicalTargetPath = fs.realpathSync(targetPath);
  const originalLinkTarget = fs.readlinkSync(configPath);
  const originalLinkStat = fs.lstatSync(configPath, { bigint: true });

  const result = await new OpenCodeConfigCleanupMigration({ configPath }).cleanup();

  const finalLinkStat = fs.lstatSync(configPath, { bigint: true });
  assert.equal(finalLinkStat.isSymbolicLink(), true);
  assert.equal(finalLinkStat.dev, originalLinkStat.dev);
  assert.equal(finalLinkStat.ino, originalLinkStat.ino);
  assert.equal(fs.readlinkSync(configPath), originalLinkTarget);
  assert.equal(readJson(targetPath).model, undefined);
  assert.equal(readJson(targetPath).provider.agents_gui_mimo, undefined);
  assert.equal(readJson(targetPath).provider.user_provider.name, 'User provider');
  assert.ok(result.backupPath?.startsWith(`${canonicalTargetPath}.agents-gui-native-cli-bak-`));
  assert.deepEqual(fs.readFileSync(result.backupPath), original);
  assert.equal(fs.statSync(targetPath).mode & 0o777, 0o640);
  assert.equal(fs.statSync(result.backupPath).mode & 0o777, 0o640);
  assert.deepEqual(migrationArtifacts(configDirectory), []);
  assert.deepEqual(migrationArtifacts(targetDirectory), []);
});

test('cleanup preserves a parent directory symlink or junction and migrates its canonical target', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-gui-native-cleanup-parent-link-'));
  const targetDirectory = path.join(root, 'real-config');
  const linkedDirectory = path.join(root, 'linked-config');
  fs.mkdirSync(targetDirectory);
  const targetPath = path.join(targetDirectory, 'opencode.json');
  const configPath = path.join(linkedDirectory, 'opencode.json');
  const original = Buffer.from(
    `${JSON.stringify(
      {
        model: 'agents_gui_mimo/model',
        provider: {
          agents_gui_mimo: { __agents_gui_synced: true },
        },
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(targetPath, original);
  if (!createDirectoryLink(t, targetDirectory, linkedDirectory)) {
    return;
  }
  const canonicalTargetPath = fs.realpathSync(configPath);
  const originalDirectoryLink = fs.readlinkSync(linkedDirectory);

  const result = await new OpenCodeConfigCleanupMigration({ configPath }).cleanup();

  assert.equal(fs.lstatSync(linkedDirectory).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(linkedDirectory), originalDirectoryLink);
  assert.equal(readJson(targetPath).model, undefined);
  assert.equal(readJson(targetPath).provider.agents_gui_mimo, undefined);
  assert.ok(result.backupPath?.startsWith(`${canonicalTargetPath}.agents-gui-native-cli-bak-`));
  assert.deepEqual(fs.readFileSync(result.backupPath), original);
  assert.deepEqual(migrationArtifacts(targetDirectory), []);
});

test('cleanup fails closed if a config symlink is retargeted to the same inode before commit', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-gui-native-cleanup-retarget-'));
  const configDirectory = path.join(root, 'config');
  const firstTargetDirectory = path.join(root, 'dotfiles-a');
  const secondTargetDirectory = path.join(root, 'dotfiles-b');
  fs.mkdirSync(configDirectory);
  fs.mkdirSync(firstTargetDirectory);
  fs.mkdirSync(secondTargetDirectory);
  const configPath = path.join(configDirectory, 'opencode.json');
  const firstTargetPath = path.join(firstTargetDirectory, 'opencode.json');
  const secondTargetPath = path.join(secondTargetDirectory, 'opencode.json');
  const original = Buffer.from(
    `${JSON.stringify(
      {
        provider: {
          agents_gui_mimo: { __agents_gui_synced: true },
        },
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(firstTargetPath, original);
  fs.linkSync(firstTargetPath, secondTargetPath);
  if (!createFileSymlink(t, firstTargetPath, configPath)) {
    return;
  }

  await assert.rejects(
    new OpenCodeConfigCleanupMigration({
      configPath,
      beforeCommit: async () => {
        fs.unlinkSync(configPath);
        if (!createFileSymlink(t, secondTargetPath, configPath)) {
          throw new Error('Unable to retarget test symlink');
        }
      },
    }).cleanup(),
    /Concurrent OpenCode config modification.*(?:link|target|path)/i
  );

  assert.equal(fs.lstatSync(configPath).isSymbolicLink(), true);
  assert.equal(fs.realpathSync(configPath), fs.realpathSync(secondTargetPath));
  assert.deepEqual(fs.readFileSync(firstTargetPath), original);
  assert.deepEqual(fs.readFileSync(secondTargetPath), original);
  assert.deepEqual(migrationArtifacts(configDirectory), []);
  assert.deepEqual(migrationArtifacts(firstTargetDirectory), []);
  assert.deepEqual(migrationArtifacts(secondTargetDirectory), []);
});

test('cleanup detects a same-target config symlink replacement before commit', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-gui-native-cleanup-link-aba-'));
  const configDirectory = path.join(root, 'config');
  const targetDirectory = path.join(root, 'dotfiles');
  fs.mkdirSync(configDirectory);
  fs.mkdirSync(targetDirectory);
  const configPath = path.join(configDirectory, 'opencode.json');
  const replacementLinkPath = path.join(configDirectory, 'replacement-link');
  const targetPath = path.join(targetDirectory, 'opencode.json');
  const original = Buffer.from(
    `${JSON.stringify(
      {
        provider: {
          agents_gui_mimo: { __agents_gui_synced: true },
        },
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(targetPath, original);
  if (!createFileSymlink(t, targetPath, configPath)) {
    return;
  }
  if (!createFileSymlink(t, targetPath, replacementLinkPath)) {
    return;
  }
  const originalLinkStat = fs.lstatSync(configPath, { bigint: true });
  const replacementLinkStat = fs.lstatSync(replacementLinkPath, { bigint: true });
  assert.equal(fs.readlinkSync(replacementLinkPath), fs.readlinkSync(configPath));
  assert.notEqual(replacementLinkStat.ino, originalLinkStat.ino);

  await assert.rejects(
    new OpenCodeConfigCleanupMigration({
      configPath,
      beforeCommit: async () => {
        try {
          fs.renameSync(replacementLinkPath, configPath);
        } catch (error) {
          if (
            process.platform !== 'win32' ||
            (error.code !== 'EEXIST' && error.code !== 'EPERM' && error.code !== 'EACCES')
          ) {
            throw error;
          }
          fs.unlinkSync(configPath);
          fs.renameSync(replacementLinkPath, configPath);
        }
      },
    }).cleanup(),
    /Concurrent OpenCode config modification.*(?:link|target|path)/i
  );

  const finalLinkStat = fs.lstatSync(configPath, { bigint: true });
  assert.equal(finalLinkStat.isSymbolicLink(), true);
  assert.equal(finalLinkStat.ino, replacementLinkStat.ino);
  assert.deepEqual(fs.readFileSync(targetPath), original);
  assert.deepEqual(migrationArtifacts(configDirectory), []);
  assert.deepEqual(migrationArtifacts(targetDirectory), []);
});

test('dangling config symlinks fail closed and do not record migration success', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-gui-native-cleanup-dangling-'));
  const configPath = path.join(root, 'opencode.json');
  const missingTargetPath = path.join(root, 'missing-opencode.json');
  if (!createFileSymlink(t, missingTargetPath, configPath)) {
    return;
  }
  const values = new Map();

  await assert.rejects(
    runOpenCodeCleanupOnce(
      {
        get: (key) => values.get(key),
        update: async (key, value) => values.set(key, value),
      },
      new OpenCodeConfigCleanupMigration({ configPath })
    ),
    /dangling|symbolic link.*target.*missing/i
  );

  assert.equal(values.has(OPENCODE_NATIVE_PASSTHROUGH_CLEANUP_KEY), false);
  assert.equal(fs.lstatSync(configPath).isSymbolicLink(), true);
  assert.deepEqual(migrationArtifacts(root), []);
});

test('dangling parent directory symlinks or junctions fail closed', async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'agents-gui-native-cleanup-dangling-parent-')
  );
  const missingDirectory = path.join(root, 'missing-config');
  const linkedDirectory = path.join(root, 'linked-config');
  fs.mkdirSync(missingDirectory);
  if (!createDirectoryLink(t, missingDirectory, linkedDirectory)) {
    return;
  }
  fs.rmdirSync(missingDirectory);
  const configPath = path.join(linkedDirectory, 'opencode.json');
  const values = new Map();

  await assert.rejects(
    runOpenCodeCleanupOnce(
      {
        get: (key) => values.get(key),
        update: async (key, value) => values.set(key, value),
      },
      new OpenCodeConfigCleanupMigration({ configPath })
    ),
    /dangling|symbolic link|junction/i
  );

  assert.equal(values.has(OPENCODE_NATIVE_PASSTHROUGH_CLEANUP_KEY), false);
  assert.equal(fs.lstatSync(linkedDirectory).isSymbolicLink(), true);
  assert.deepEqual(migrationArtifacts(root), []);
});

test('cleanup rejects a config symlink changed during canonical target resolution', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-gui-native-cleanup-resolve-'));
  const configPath = path.join(root, 'opencode.json');
  const firstTargetPath = path.join(root, 'first.json');
  const secondTargetPath = path.join(root, 'second.json');
  const original = Buffer.from(
    `${JSON.stringify(
      {
        provider: {
          agents_gui_mimo: { __agents_gui_synced: true },
        },
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(firstTargetPath, original);
  fs.writeFileSync(secondTargetPath, original);
  if (!createFileSymlink(t, firstTargetPath, configPath)) {
    return;
  }
  const originalRealpath = fs.promises.realpath.bind(fs.promises);
  let requestedPathResolutions = 0;
  t.mock.method(fs.promises, 'realpath', async (target, ...rest) => {
    const resolved = await originalRealpath(target, ...rest);
    if (target === configPath) {
      requestedPathResolutions += 1;
      if (requestedPathResolutions === 1) {
        fs.unlinkSync(configPath);
        if (!createFileSymlink(t, secondTargetPath, configPath)) {
          throw new Error('Unable to retarget test symlink');
        }
      }
    }
    return resolved;
  });

  await assert.rejects(
    new OpenCodeConfigCleanupMigration({ configPath }).cleanup(),
    /Concurrent OpenCode config modification.*(?:link|target|path)/i
  );

  assert.equal(requestedPathResolutions, 2);
  assert.equal(fs.realpathSync(configPath), fs.realpathSync(secondTargetPath));
  assert.deepEqual(fs.readFileSync(firstTargetPath), original);
  assert.deepEqual(fs.readFileSync(secondTargetPath), original);
  assert.deepEqual(migrationArtifacts(root), []);
});

test('a no-plan precheck fails closed if the config link changes after resolution', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-gui-native-cleanup-no-plan-'));
  const configPath = path.join(root, 'opencode.json');
  const cleanTargetPath = path.join(root, 'clean.json');
  const taggedTargetPath = path.join(root, 'tagged.json');
  const cleanBytes = Buffer.from(
    `${JSON.stringify({ provider: { user_provider: { name: 'User provider' } } }, null, 2)}\n`
  );
  const taggedBytes = Buffer.from(
    `${JSON.stringify(
      {
        provider: {
          agents_gui_mimo: { __agents_gui_synced: true },
        },
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(cleanTargetPath, cleanBytes);
  fs.writeFileSync(taggedTargetPath, taggedBytes);
  if (!createFileSymlink(t, cleanTargetPath, configPath)) {
    return;
  }
  const originalRealpath = fs.promises.realpath.bind(fs.promises);
  let requestedPathResolutions = 0;
  t.mock.method(fs.promises, 'realpath', async (target, ...rest) => {
    const resolved = await originalRealpath(target, ...rest);
    if (target === configPath) {
      requestedPathResolutions += 1;
      if (requestedPathResolutions === 2) {
        fs.unlinkSync(configPath);
        if (!createFileSymlink(t, taggedTargetPath, configPath)) {
          throw new Error('Unable to retarget test symlink');
        }
      }
    }
    return resolved;
  });
  const values = new Map();

  await assert.rejects(
    runOpenCodeCleanupOnce(
      {
        get: (key) => values.get(key),
        update: async (key, value) => values.set(key, value),
      },
      new OpenCodeConfigCleanupMigration({ configPath })
    ),
    /Concurrent OpenCode config modification.*(?:link|target|path)/i
  );

  assert.equal(values.has(OPENCODE_NATIVE_PASSTHROUGH_CLEANUP_KEY), false);
  assert.equal(fs.realpathSync(configPath), fs.realpathSync(taggedTargetPath));
  assert.deepEqual(fs.readFileSync(cleanTargetPath), cleanBytes);
  assert.deepEqual(fs.readFileSync(taggedTargetPath), taggedBytes);
  assert.deepEqual(migrationArtifacts(root), []);
});

test('a target disappearing after resolution fails closed instead of recording success', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-gui-native-cleanup-vanished-'));
  const configPath = path.join(root, 'opencode.json');
  const targetPath = path.join(root, 'target.json');
  fs.writeFileSync(
    targetPath,
    `${JSON.stringify(
      {
        provider: {
          agents_gui_mimo: { __agents_gui_synced: true },
        },
      },
      null,
      2
    )}\n`
  );
  if (!createFileSymlink(t, targetPath, configPath)) {
    return;
  }
  const originalRealpath = fs.promises.realpath.bind(fs.promises);
  let requestedPathResolutions = 0;
  t.mock.method(fs.promises, 'realpath', async (target, ...rest) => {
    const resolved = await originalRealpath(target, ...rest);
    if (target === configPath) {
      requestedPathResolutions += 1;
      if (requestedPathResolutions === 2) {
        fs.unlinkSync(targetPath);
      }
    }
    return resolved;
  });
  const values = new Map();

  await assert.rejects(
    runOpenCodeCleanupOnce(
      {
        get: (key) => values.get(key),
        update: async (key, value) => values.set(key, value),
      },
      new OpenCodeConfigCleanupMigration({ configPath })
    ),
    /Concurrent OpenCode config modification.*(?:removed|target|path)/i
  );

  assert.equal(values.has(OPENCODE_NATIVE_PASSTHROUGH_CLEANUP_KEY), false);
  assert.equal(fs.lstatSync(configPath).isSymbolicLink(), true);
  assert.equal(fs.existsSync(targetPath), false);
  assert.deepEqual(migrationArtifacts(root), []);
});

test('a no-plan result after locking is revalidated before recording success', async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'agents-gui-native-cleanup-locked-no-plan-')
  );
  const configPath = path.join(root, 'opencode.json');
  const targetPath = path.join(root, 'target.json');
  const taggedBytes = Buffer.from(
    `${JSON.stringify(
      {
        provider: {
          agents_gui_mimo: { __agents_gui_synced: true },
        },
      },
      null,
      2
    )}\n`
  );
  const cleanBytes = Buffer.from(
    `${JSON.stringify({ provider: { user_provider: { name: 'User provider' } } }, null, 2)}\n`
  );
  fs.writeFileSync(targetPath, taggedBytes);
  if (!createFileSymlink(t, targetPath, configPath)) {
    return;
  }
  const canonicalTargetPath = fs.realpathSync(targetPath);
  const originalLstat = fs.promises.lstat.bind(fs.promises);
  let targetPathStats = 0;
  t.mock.method(fs.promises, 'lstat', async (target, ...rest) => {
    const stat = await originalLstat(target, ...rest);
    if (target === canonicalTargetPath) {
      targetPathStats += 1;
      if (targetPathStats === 2) {
        fs.writeFileSync(targetPath, taggedBytes);
      }
    }
    return stat;
  });
  const values = new Map();

  await assert.rejects(
    runOpenCodeCleanupOnce(
      {
        get: (key) => values.get(key),
        update: async (key, value) => values.set(key, value),
      },
      new OpenCodeConfigCleanupMigration({
        configPath,
        lockOptions: cleanupLockOptions(() => 'dead', {
          tokenFactory: () => {
            fs.writeFileSync(targetPath, cleanBytes);
            return 'locked-no-plan-owner';
          },
        }),
      })
    ),
    /Concurrent OpenCode config modification.*changed/i
  );

  assert.equal(values.has(OPENCODE_NATIVE_PASSTHROUGH_CLEANUP_KEY), false);
  assert.deepEqual(fs.readFileSync(targetPath), taggedBytes);
  assert.deepEqual(migrationArtifacts(root), []);
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

test('post-commit link races report that the canonical replacement was already written', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-gui-native-cleanup-post-commit-'));
  const configPath = path.join(root, 'opencode.json');
  const firstTargetPath = path.join(root, 'first.json');
  const secondTargetPath = path.join(root, 'second.json');
  const taggedBytes = Buffer.from(
    `${JSON.stringify(
      {
        provider: {
          agents_gui_mimo: { __agents_gui_synced: true },
        },
      },
      null,
      2
    )}\n`
  );
  const secondBytes = Buffer.from(
    `${JSON.stringify({ provider: { user_provider: { name: 'User provider' } } }, null, 2)}\n`
  );
  fs.writeFileSync(firstTargetPath, taggedBytes);
  fs.writeFileSync(secondTargetPath, secondBytes);
  if (!createFileSymlink(t, firstTargetPath, configPath)) {
    return;
  }
  const canonicalFirstTargetPath = fs.realpathSync(firstTargetPath);
  const originalRename = fs.promises.rename.bind(fs.promises);
  t.mock.method(fs.promises, 'rename', async (source, destination, ...rest) => {
    await originalRename(source, destination, ...rest);
    if (destination === canonicalFirstTargetPath) {
      fs.unlinkSync(configPath);
      if (!createFileSymlink(t, secondTargetPath, configPath)) {
        throw new Error('Unable to retarget test symlink');
      }
    }
  });

  await assert.rejects(
    new OpenCodeConfigCleanupMigration({ configPath }).cleanup(),
    /replacement was written.*final.*(?:link|target|path).*failed/i
  );

  assert.equal(fs.realpathSync(configPath), fs.realpathSync(secondTargetPath));
  assert.equal(readJson(firstTargetPath).provider.agents_gui_mimo, undefined);
  assert.deepEqual(fs.readFileSync(secondTargetPath), secondBytes);
  assert.equal(fs.readdirSync(root).filter((name) => name.includes('native-cli-bak')).length, 1);
  assert.deepEqual(migrationArtifacts(root), []);
});

test('cleanup releases its directory lock when Windows blocks temporary-file removal', async (t) => {
  const { dir, configPath } = fixture({
    provider: {
      agents_gui_mimo: { __agents_gui_synced: true },
    },
  });
  const lockPath = `${configPath}.agents-gui-native-cli.lock`;
  const originalUnlink = fs.promises.unlink.bind(fs.promises);
  let tempCleanupAttempts = 0;
  t.mock.method(fs.promises, 'unlink', async (target, ...rest) => {
    if (String(target).includes('.agents-gui-native-cli-tmp-')) {
      tempCleanupAttempts += 1;
      throw Object.assign(new Error('temporary cleanup blocked by antivirus'), {
        code: 'EACCES',
      });
    }
    return originalUnlink(target, ...rest);
  });

  await assert.rejects(
    new OpenCodeConfigCleanupMigration({
      configPath,
      beforeCommit: async () => {
        throw new Error('stop before replacement');
      },
    }).cleanup(),
    (error) => {
      assert.equal(error.code, 'EACCES');
      return true;
    }
  );

  assert.equal(tempCleanupAttempts, 1);
  assert.equal(fs.existsSync(lockPath), false);
  assert.equal(fs.existsSync(`${lockPath}.v2`), false);
  assert.equal(
    migrationArtifacts(dir).filter((entry) => entry.includes('native-cli.lock')).length,
    0
  );
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

test('config aliases share one canonical cleanup lock and create one backup', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-gui-native-cleanup-aliases-'));
  const firstConfigDirectory = path.join(root, 'config-a');
  const secondConfigDirectory = path.join(root, 'config-b');
  const targetDirectory = path.join(root, 'dotfiles');
  fs.mkdirSync(firstConfigDirectory);
  fs.mkdirSync(secondConfigDirectory);
  fs.mkdirSync(targetDirectory);
  const firstConfigPath = path.join(firstConfigDirectory, 'opencode.json');
  const secondConfigPath = path.join(secondConfigDirectory, 'opencode.json');
  const targetPath = path.join(targetDirectory, 'opencode.json');
  fs.writeFileSync(
    targetPath,
    `${JSON.stringify(
      {
        model: 'agents_gui_mimo/model',
        provider: {
          agents_gui_mimo: { __agents_gui_synced: true },
        },
      },
      null,
      2
    )}\n`
  );
  if (!createFileSymlink(t, targetPath, firstConfigPath)) {
    return;
  }
  if (!createFileSymlink(t, targetPath, secondConfigPath)) {
    return;
  }
  const now = () => new Date('2026-07-30T00:00:00.000Z');

  const results = await Promise.all(
    [firstConfigPath, secondConfigPath].map((configPath) =>
      new OpenCodeConfigCleanupMigration({
        configPath,
        now,
        lockRetryDelayMs: 1,
        lockRetryAttempts: 2_000,
      }).cleanup()
    )
  );

  assert.equal(results.filter((result) => result.changed).length, 1);
  assert.equal(fs.lstatSync(firstConfigPath).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(secondConfigPath).isSymbolicLink(), true);
  assert.equal(readJson(targetPath).model, undefined);
  assert.equal(readJson(targetPath).provider.agents_gui_mimo, undefined);
  assert.equal(
    fs.readdirSync(targetDirectory).filter((name) => name.includes('native-cli-bak')).length,
    1
  );
  assert.deepEqual(migrationArtifacts(firstConfigDirectory), []);
  assert.deepEqual(migrationArtifacts(secondConfigDirectory), []);
  assert.deepEqual(migrationArtifacts(targetDirectory), []);
});

test('cleanup recovers a dead directory owner and leaves no lock artifacts', async () => {
  const { dir, configPath } = fixture({
    model: 'agents_gui_mimo/model',
    provider: {
      agents_gui_mimo: { __agents_gui_synced: true },
      marker_string: { __agents_gui_synced: 'true' },
      user_provider: { name: 'User provider' },
    },
  });
  fs.chmodSync(configPath, 0o640);
  const lockPath = `${configPath}.agents-gui-native-cli.lock`;
  const abandoned = await acquireOpenCodeCleanupLock(lockPath, {
    ...cleanupLockOptions(() => 'alive'),
    pid: 4321,
    tokenFactory: () => 'abandoned-directory-owner',
  });

  try {
    const result = await new OpenCodeConfigCleanupMigration({
      configPath,
      lockOptions: cleanupLockOptions((pid) => {
        assert.equal(pid, 4321);
        return 'dead';
      }),
    }).cleanup();
    const config = readJson(configPath);

    assert.equal(result.changed, true);
    assert.deepEqual(result.removedProviderKeys, ['agents_gui_mimo']);
    assert.equal(result.removedTopLevelModel, true);
    assert.ok(result.backupPath);
    assert.equal(config.model, undefined);
    assert.equal(config.provider.agents_gui_mimo, undefined);
    assert.equal(config.provider.marker_string.__agents_gui_synced, 'true');
    assert.equal(config.provider.user_provider.name, 'User provider');
    assert.equal(fs.readdirSync(dir).filter((entry) => entry.includes('native-cli-bak')).length, 1);
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o640);
    assert.equal(fs.statSync(result.backupPath).mode & 0o777, 0o640);
    assert.deepEqual(migrationArtifacts(dir), []);
  } finally {
    await abandoned.release();
  }
});

test('cleanup fences dead legacy files as immutable poison pills and removes their v2 sidecars', async () => {
  for (const [name, owner] of [
    ['pid-only', '4321\n'],
    ['structured', structuredLockOwner()],
  ]) {
    const { dir, configPath } = fixture({
      model: 'agents_gui_mimo/model',
      provider: {
        agents_gui_mimo: { __agents_gui_synced: true },
        marker_string: { __agents_gui_synced: 'true' },
        user_provider: { name: 'User provider' },
      },
    });
    fs.chmodSync(configPath, 0o640);
    const lockPath = `${configPath}.agents-gui-native-cli.lock`;
    fs.writeFileSync(lockPath, owner, { mode: 0o600 });
    const poisonBytes = fs.readFileSync(lockPath);
    const poisonStat = fs.lstatSync(lockPath, { bigint: true });

    const result = await new OpenCodeConfigCleanupMigration({
      configPath,
      lockOptions: cleanupLockOptions((pid) => {
        assert.equal(pid, 4321);
        return 'dead';
      }),
    }).cleanup();
    const config = readJson(configPath);
    const poisonAfter = fs.lstatSync(lockPath, { bigint: true });

    assert.equal(result.changed, true, `${name} poison should be fenced`);
    assert.deepEqual(result.removedProviderKeys, ['agents_gui_mimo']);
    assert.equal(result.removedTopLevelModel, true);
    assert.ok(result.backupPath);
    assert.equal(config.model, undefined);
    assert.equal(config.provider.agents_gui_mimo, undefined);
    assert.equal(config.provider.marker_string.__agents_gui_synced, 'true');
    assert.equal(config.provider.user_provider.name, 'User provider');
    assert.equal(fs.readdirSync(dir).filter((entry) => entry.includes('native-cli-bak')).length, 1);
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o640);
    assert.equal(fs.statSync(result.backupPath).mode & 0o777, 0o640);
    assert.deepEqual(fs.readFileSync(lockPath), poisonBytes);
    assert.equal(poisonAfter.dev, poisonStat.dev);
    assert.equal(poisonAfter.ino, poisonStat.ino);
    assert.deepEqual(migrationArtifacts(dir), [path.basename(lockPath)]);
    assert.equal(fs.existsSync(`${lockPath}.v2`), false);
  }
});

test('cleanup fails with an actionable error when its same-directory lock stays busy', async () => {
  for (const [name, processLiveness] of [
    ['live', () => 'alive'],
    ['unknown', () => 'unknown'],
  ]) {
    const { dir, configPath } = fixture({
      provider: {
        agents_gui_mimo: { __agents_gui_synced: true },
      },
    });
    const lockPath = `${configPath}.agents-gui-native-cli.lock`;
    fs.writeFileSync(lockPath, structuredLockOwner(), { mode: 0o600 });

    await assert.rejects(
      new OpenCodeConfigCleanupMigration({
        configPath,
        lockOptions: cleanupLockOptions(processLiveness),
      }).cleanup(),
      /OpenCode config cleanup lock.*busy|timed out.*OpenCode config/i,
      `${name} owners must fail closed`
    );

    assert.equal(readJson(configPath).provider.agents_gui_mimo.__agents_gui_synced, true);
    assert.equal(fs.readdirSync(dir).filter((entry) => entry.includes('native-cli-bak')).length, 0);
    assert.deepEqual(migrationArtifacts(dir), [path.basename(lockPath)]);
  }
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

test('activation keeps OpenCode enabled after dead-lock recovery and isolates live or unknown owners', async () => {
  {
    const { configPath } = fixture({
      provider: { agents_gui_mimo: { __agents_gui_synced: true } },
    });
    const lockPath = `${configPath}.agents-gui-native-cli.lock`;
    const abandoned = await acquireOpenCodeCleanupLock(lockPath, {
      ...cleanupLockOptions(() => 'alive'),
      pid: 4321,
      tokenFactory: () => 'abandoned-activation-owner',
    });
    const values = new Map();
    try {
      const disabled = await runOpenCodeCleanupActivationGate(
        {
          get: (key) => values.get(key),
          update: async (key, value) => values.set(key, value),
        },
        new OpenCodeConfigCleanupMigration({
          configPath,
          lockOptions: cleanupLockOptions(() => 'dead'),
        }),
        async () => {
          throw new Error('dead-lock recovery must not report an activation failure');
        }
      );

      assert.deepEqual([...disabled], []);
      assert.equal(values.get(OPENCODE_NATIVE_PASSTHROUGH_CLEANUP_KEY), true);
      assert.equal(readJson(configPath).provider.agents_gui_mimo, undefined);
    } finally {
      await abandoned.release();
    }
  }

  for (const [name, processLiveness] of [
    ['live', () => 'alive'],
    ['unknown', () => 'unknown'],
  ]) {
    const { configPath } = fixture({
      provider: { agents_gui_mimo: { __agents_gui_synced: true } },
    });
    const lockPath = `${configPath}.agents-gui-native-cli.lock`;
    fs.writeFileSync(lockPath, structuredLockOwner(), { mode: 0o600 });
    const reported = [];
    const disabled = await runOpenCodeCleanupActivationGate(
      {
        get() {
          return undefined;
        },
        async update() {
          throw new Error('failed cleanup must not be recorded');
        },
      },
      new OpenCodeConfigCleanupMigration({
        configPath,
        lockOptions: cleanupLockOptions(processLiveness),
      }),
      async (error) => reported.push(error)
    );

    assert.deepEqual([...disabled], ['opencode'], `${name} owner disables only OpenCode`);
    assert.equal(disabled.has('codex'), false);
    assert.equal(disabled.has('claude'), false);
    assert.equal(reported.length, 1);
    assert.match(reported[0].message, /lock.*busy/i);
    assert.equal(readJson(configPath).provider.agents_gui_mimo.__agents_gui_synced, true);
  }
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
