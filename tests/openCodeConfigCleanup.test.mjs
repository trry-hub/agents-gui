import assert from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  OpenCodeConfigCleanupMigration,
  OPENCODE_NATIVE_PASSTHROUGH_CLEANUP_KEY,
  runOpenCodeCleanupOnce,
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
