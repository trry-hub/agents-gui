import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ThreadEventAdapter } from '../.test-dist/threadEventAdapter.js';
import { createConversationStore } from '../.test-dist/webview/conversationStore.js';
import { createDeltaScheduler } from '../.test-dist/webview/deltaScheduler.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('one manifest covers every webview placeholder and packaged asset', () => {
  const manifestPath = path.join(root, 'media', 'webview-assets.json');
  assert.equal(existsSync(manifestPath), true);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const html = readFileSync(path.join(root, 'media', manifest.html), 'utf8');
  const placeholders = new Set(html.match(/__[A-Z0-9_]+_URI__/g) ?? []);
  const listedPlaceholders = new Set(
    manifest.assets.map((asset) => asset.placeholder)
  );

  assert.deepEqual(listedPlaceholders, placeholders);
  for (const file of [
    manifest.html,
    ...manifest.assets.map((asset) => asset.path),
    ...Object.values(manifest.providerIcons).flatMap((icon) => [
      icon.light,
      icon.dark,
    ]),
    ...manifest.static,
  ]) {
    assert.equal(existsSync(path.join(root, 'media', file)), true, file);
  }
});

test('standalone preview consumes the manifest and resolves every placeholder', () => {
  const result = spawnSync(process.execPath, ['scripts/preview-webview.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const outputPath = result.stdout.trim().split(/\r?\n/).at(-1);
  const html = readFileSync(outputPath, 'utf8');

  assert.doesNotMatch(html, /__[A-Z0-9_]+__/);
  assert.match(html, /data-codex-renderer="true"/);
  assert.match(html, /\.\/codex-renderer\.js/);
  assert.match(html, /command:\s*'threadEvent'/);
});

test('hydrate and replay suppress duplicate canonical lifecycle envelopes', () => {
  let now = 1_000;
  const adapter = new ThreadEventAdapter({ now: () => ++now });
  const lifecycle = [
    {
      command: 'requestStarted',
      cliId: 'codex',
      threadId: 'thread-1',
      sessionId: 'runtime-1',
      text: 'Implement the renderer',
    },
    {
      command: 'output',
      cliId: 'codex',
      sessionId: 'runtime-1',
      text: 'First ',
      thinking: 'Inspect ',
      activities: [
        {
          id: 'command-1',
          kind: 'command',
          name: 'npm test',
          detail: 'Running focused tests',
        },
      ],
    },
    {
      command: 'output',
      cliId: 'codex',
      sessionId: 'runtime-1',
      text: 'answer',
      thinking: 'then implement',
    },
    {
      command: 'output',
      cliId: 'codex',
      sessionId: 'runtime-1',
      text: ' done',
      thinking: ' verify',
    },
    {
      command: 'sessionEnd',
      cliId: 'codex',
      sessionId: 'runtime-1',
      exitCode: 0,
    },
  ];
  const envelopes = lifecycle.flatMap((message) => adapter.accept(message));
  const initial = createConversationStore();
  const scheduler = createDeltaScheduler({
    dispatch: initial.dispatch,
    requestFrame: () => 1,
    cancelFrame: () => {},
    isHidden: () => false,
  });
  envelopes.forEach((envelope) => scheduler.schedule(envelope));
  scheduler.flush();

  const snapshot = structuredClone(initial.getSnapshot());
  const restored = createConversationStore();
  restored.hydrate(snapshot);
  envelopes.forEach((envelope) => restored.dispatch(envelope));

  const thread = restored.getSnapshot().threadsById['thread-1'];
  const turn = thread.turnsById[thread.turnOrder[0]];
  const items = turn.itemOrder.map((itemId) => turn.itemsById[itemId]);
  assert.deepEqual(
    items.map((item) => item.type),
    ['user-message', 'assistant-message', 'reasoning', 'command-execution']
  );
  assert.equal(items.filter((item) => item.type === 'user-message').length, 1);
  assert.equal(items.filter((item) => item.type === 'assistant-message').length, 1);
  assert.equal(items.filter((item) => item.type === 'reasoning').length, 1);
  assert.equal(
    items.find((item) => item.type === 'assistant-message').content,
    'First answer done'
  );
  assert.equal(
    items.find((item) => item.type === 'reasoning').content,
    'Inspect then implement verify'
  );
  assert.equal(turn.status, 'completed');
  assert.equal(thread.status, 'completed');
});
