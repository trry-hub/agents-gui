import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import adapterModule from '../.test-dist/threadEventAdapter.js';

const { ThreadEventAdapter } = adapterModule;

function eventsOfType(envelopes, type) {
  return envelopes.filter((envelope) => envelope.event.type === type);
}

test('request start creates a unique turn for each request even when the runtime session is reused', () => {
  const adapter = new ThreadEventAdapter({ now: () => 1_700_000_000_000 });

  const first = adapter.accept({
    command: 'requestStarted',
    cliId: 'codex',
    threadId: 'thread-1',
    sessionId: 'runtime-1',
    text: 'first',
  });
  adapter.accept({
    command: 'sessionEnd',
    cliId: 'codex',
    sessionId: 'runtime-1',
    exitCode: 0,
  });
  const second = adapter.accept({
    command: 'requestStarted',
    cliId: 'codex',
    threadId: 'thread-1',
    sessionId: 'runtime-1',
    text: 'second',
  });

  const firstTurn = eventsOfType(first, 'turn/started')[0].event.turn;
  const secondTurn = eventsOfType(second, 'turn/started')[0].event.turn;
  const firstUser = eventsOfType(first, 'item/started').find(
    ({ event }) => event.item.type === 'user-message'
  ).event.item;

  assert.notEqual(firstTurn.id, secondTurn.id);
  assert.equal(firstUser.id, `${firstTurn.id}:user`);
  assert.equal(firstUser.content, 'first');
});

test('a reused runtime session completes the previous turn before starting the next request', () => {
  const adapter = new ThreadEventAdapter({
    now: () => 1_700_000_000_000,
    streamId: 'host-a',
  });
  const first = adapter.accept({
    command: 'requestStarted',
    cliId: 'codex',
    threadId: 'thread-1',
    sessionId: 'runtime-1',
    text: 'first',
  });
  const firstTurnId = eventsOfType(first, 'turn/started')[0].event.turn.id;

  const second = adapter.accept({
    command: 'requestStarted',
    cliId: 'codex',
    threadId: 'thread-1',
    sessionId: 'runtime-1',
    text: 'second',
  });

  assert.deepEqual(
    second.slice(0, 2).map(({ event }) => event.type),
    ['turn/completed', 'thread/status/changed']
  );
  assert.equal(second[0].event.turnId, firstTurnId);
  assert.equal(second[0].event.status, 'completed');
  assert.equal(eventsOfType(second, 'turn/started').length, 1);
  assert.ok(second.every((envelope) => envelope.streamId === 'host-a'));
});

test('stream output targets deterministic assistant and reasoning items', () => {
  const adapter = new ThreadEventAdapter({ now: () => 42 });
  const started = adapter.accept({
    command: 'requestStarted',
    cliId: 'opencode',
    threadId: 'thread-1',
    sessionId: 'runtime-1',
    text: 'inspect',
  });
  const turnId = eventsOfType(started, 'turn/started')[0].event.turn.id;

  const output = adapter.accept({
    command: 'output',
    cliId: 'opencode',
    sessionId: 'runtime-1',
    text: 'answer',
    thinking: 'reason',
  });

  assert.deepEqual(
    output.map(({ event }) => [event.type, event.itemId, event.delta]),
    [
      ['item/assistantMessage/delta', `${turnId}:assistant`, 'answer'],
      ['item/reasoning/delta', `${turnId}:reasoning`, 'reason'],
    ]
  );
});

test('provider activities become stable typed thread items', () => {
  const adapter = new ThreadEventAdapter({ now: () => 42 });
  const started = adapter.accept({
    command: 'requestStarted',
    cliId: 'opencode',
    threadId: 'thread-1',
    sessionId: 'runtime-1',
    text: 'inspect',
  });
  const turnId = eventsOfType(started, 'turn/started')[0].event.turn.id;

  const first = adapter.accept({
    command: 'output',
    cliId: 'opencode',
    sessionId: 'runtime-1',
    text: '',
    activities: [{ id: 'tool-7', kind: 'command', name: 'npm test', detail: 'running' }],
  });
  const second = adapter.accept({
    command: 'output',
    cliId: 'opencode',
    sessionId: 'runtime-1',
    text: '',
    activities: [{ id: 'tool-7', kind: 'command', name: 'npm test', detail: 'passed' }],
  });

  const firstEvent = eventsOfType(first, 'item/activity/updated')[0].event;
  const secondEvent = eventsOfType(second, 'item/activity/updated')[0].event;
  assert.equal(firstEvent.itemId, `${turnId}:activity:tool-7`);
  assert.equal(firstEvent.item.type, 'command-execution');
  assert.equal(secondEvent.itemId, firstEvent.itemId);
  assert.equal(secondEvent.activity.detail, 'passed');
});

test('request warnings and bound session feedback become typed system items', () => {
  const adapter = new ThreadEventAdapter({ now: () => 42, streamId: 'host-a' });
  const started = adapter.accept({
    command: 'requestStarted',
    cliId: 'codex',
    threadId: 'thread-1',
    sessionId: 'runtime-1',
    text: 'inspect',
    apiProviderWarning: 'Missing optional API key',
  });
  const notice = adapter.accept({
    command: 'sessionNotice',
    cliId: 'codex',
    sessionId: 'runtime-1',
    text: 'No output yet',
  });
  const inputFailure = adapter.accept({
    command: 'sessionInputResult',
    cliId: 'codex',
    sessionId: 'runtime-1',
    ok: false,
    text: 'Cannot send input',
  });

  assert.equal(
    eventsOfType(started, 'item/started').at(-1).event.item.type,
    'system-message'
  );
  assert.equal(notice[0].event.item.type, 'system-message');
  assert.equal(inputFailure[0].event.item.type, 'system-error');
});

test('sequences increase per thread and completion clears the runtime binding', () => {
  const adapter = new ThreadEventAdapter({ now: () => 42 });
  const started = adapter.accept({
    command: 'requestStarted',
    cliId: 'codex',
    threadId: 'thread-1',
    sessionId: 'runtime-1',
    text: 'build',
  });
  const ended = adapter.accept({
    command: 'sessionEnd',
    cliId: 'codex',
    sessionId: 'runtime-1',
    exitCode: 0,
  });
  const lateOutput = adapter.accept({
    command: 'output',
    cliId: 'codex',
    sessionId: 'runtime-1',
    text: 'late',
  });

  const sequences = [...started, ...ended].map((envelope) => envelope.sequence);
  assert.deepEqual(
    sequences,
    Array.from({ length: sequences.length }, (_, index) => index + 1)
  );
  assert.equal(eventsOfType(ended, 'turn/completed')[0].event.status, 'completed');
  assert.deepEqual(lateOutput, []);
});

test('pre-start errors become a failed standalone turn when a thread is known', () => {
  const adapter = new ThreadEventAdapter({ now: () => 42 });
  const envelopes = adapter.accept({
    command: 'error',
    cliId: 'codex',
    threadId: 'thread-1',
    text: 'An active file is required',
  });

  assert.deepEqual(
    envelopes.map(({ event }) => event.type),
    ['turn/started', 'item/started', 'turn/completed', 'thread/status/changed']
  );
  const error = eventsOfType(envelopes, 'item/started')[0].event.item;
  assert.equal(error.type, 'system-error');
  assert.equal(error.content, 'An active file is required');
  assert.equal(eventsOfType(envelopes, 'turn/completed')[0].event.status, 'failed');
});

test('adapter instances give restarted host streams distinct event identities', () => {
  const first = new ThreadEventAdapter({ now: () => 42, streamId: 'host-a' });
  const restarted = new ThreadEventAdapter({ now: () => 42, streamId: 'host-b' });
  const message = {
    command: 'requestStarted',
    cliId: 'codex',
    threadId: 'thread-1',
    sessionId: 'runtime-1',
    text: 'build',
  };

  assert.ok(first.accept(message).every(({ streamId }) => streamId === 'host-a'));
  assert.ok(restarted.accept(message).every(({ streamId }) => streamId === 'host-b'));
});

test('adapter buffers canonical lifecycle events for webview reload replay', () => {
  const adapter = new ThreadEventAdapter({ now: () => 42, streamId: 'host-a' });
  adapter.accept({
    command: 'requestStarted',
    cliId: 'codex',
    threadId: 'thread-1',
    sessionId: 'runtime-1',
    text: 'build',
  });
  adapter.accept({
    command: 'output',
    cliId: 'codex',
    sessionId: 'runtime-1',
    text: 'answer',
  });
  adapter.accept({
    command: 'sessionEnd',
    cliId: 'codex',
    sessionId: 'runtime-1',
    exitCode: 0,
  });

  const replay = adapter.replayBuffered();
  assert.deepEqual(
    replay.map(({ event }) => event.type),
    [
      'thread/started',
      'turn/started',
      'item/started',
      'item/started',
      'item/assistantMessage/delta',
      'turn/completed',
      'thread/status/changed',
    ]
  );
  assert.ok(replay.every(({ streamId }) => streamId === 'host-a'));
});

test('sidebar dual-delivers canonical envelopes and preserves the legacy lifecycle message', () => {
  const assistantTypes = readFileSync(
    new URL('../src/assistantTypes.ts', import.meta.url),
    'utf8'
  );
  const protocol = readFileSync(
    new URL('../src/webviewProtocol.ts', import.meta.url),
    'utf8'
  );
  const sidebar = readFileSync(
    new URL('../src/sidebarProvider.ts', import.meta.url),
    'utf8'
  );

  assert.match(assistantTypes, /threadId\?: string;/);
  assert.match(protocol, /ThreadEventEnvelope/);
  assert.match(protocol, /command: 'requestStarted';[\s\S]*threadId: string;/);
  assert.match(protocol, /command: 'error';[\s\S]*threadId\?: string/);
  assert.match(protocol, /command: 'codexRendererReady'/);
  assert.match(sidebar, /private readonly threadEventAdapter = new ThreadEventAdapter\(\);/);
  assert.match(sidebar, /threadId: message\.threadId/);
  assert.match(sidebar, /private postError\([\s\S]*threadId\?: string/);
  assert.match(
    sidebar,
    /case 'codexRendererReady':\s*await this\.replayBufferedThreadEvents\(\);/
  );
  assert.match(
    sidebar,
    /const envelopes = this\.threadEventAdapter\.accept\(message\);[\s\S]*webview\.postMessage\(envelope\)[\s\S]*webview\.postMessage\(message\)/
  );
});
