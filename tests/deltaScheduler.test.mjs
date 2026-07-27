import assert from 'node:assert/strict';
import test from 'node:test';

import schedulerModule from '../.test-dist/webview/deltaScheduler.js';
import persistenceModule from '../.test-dist/webview/persistenceCoordinator.js';

const { createDeltaScheduler } = schedulerModule;
const { createPersistenceCoordinator } = persistenceModule;

function delta(sequence, itemId, text, type = 'item/assistantMessage/delta') {
  return {
    command: 'threadEvent',
    providerId: 'codex',
    threadId: 'thread-1',
    sequence,
    event: {
      type,
      turnId: 'turn-1',
      itemId,
      delta: text,
    },
  };
}

function completion(sequence) {
  return {
    command: 'threadEvent',
    providerId: 'codex',
    threadId: 'thread-1',
    sequence,
    event: {
      type: 'turn/completed',
      turnId: 'turn-1',
      status: 'completed',
      completedAt: 20,
    },
  };
}

function fakeFrames() {
  let callback;
  let cancelled;
  return {
    requestFrame(next) {
      callback = next;
      return 7;
    },
    cancelFrame(handle) {
      cancelled = handle;
    },
    flush() {
      const next = callback;
      callback = undefined;
      next?.(16);
    },
    get cancelled() {
      return cancelled;
    },
  };
}

test('same-item deltas coalesce once per frame while separate items stay separate', () => {
  const frames = fakeFrames();
  const dispatched = [];
  const scheduler = createDeltaScheduler({
    dispatch: (event) => dispatched.push(event),
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
    isHidden: () => false,
  });

  scheduler.schedule(delta(1, 'assistant', 'A'));
  scheduler.schedule(delta(2, 'assistant', 'B'));
  scheduler.schedule(delta(3, 'reasoning', 'R', 'item/reasoning/delta'));
  scheduler.schedule(delta(4, 'assistant', 'C'));
  assert.equal(dispatched.length, 0);

  frames.flush();
  assert.deepEqual(
    dispatched.map(({ sequence, event }) => [sequence, event.itemId, event.delta]),
    [
      [4, 'assistant', 'ABC'],
      [3, 'reasoning', 'R'],
    ]
  );
});

test('completion flushes pending item deltas before the completion event', () => {
  const frames = fakeFrames();
  const dispatched = [];
  const scheduler = createDeltaScheduler({
    dispatch: (event) => dispatched.push(event),
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
    isHidden: () => false,
  });

  scheduler.schedule(delta(1, 'assistant', 'A'));
  scheduler.schedule(completion(2));

  assert.deepEqual(
    dispatched.map(({ event }) => event.type),
    ['item/assistantMessage/delta', 'turn/completed']
  );
  assert.equal(frames.cancelled, 7);
});

test('hidden documents dispatch immediately and dispose flushes visible pending deltas', () => {
  const frames = fakeFrames();
  const dispatched = [];
  let hidden = true;
  const scheduler = createDeltaScheduler({
    dispatch: (event) => dispatched.push(event),
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
    isHidden: () => hidden,
  });

  scheduler.schedule(delta(1, 'assistant', 'hidden'));
  assert.equal(dispatched[0].event.delta, 'hidden');

  hidden = false;
  scheduler.schedule(delta(2, 'assistant', 'visible'));
  scheduler.dispose();
  assert.equal(dispatched[1].event.delta, 'visible');
  assert.equal(frames.cancelled, 7);
});

test('persistence checkpoints running turns at most once per 500ms and flushes lifecycle triggers', () => {
  let now = 0;
  let timerCallback;
  let timerDelay;
  const persisted = [];
  const snapshots = [{ version: 2, marker: 1 }, { version: 2, marker: 2 }];
  let snapshotIndex = 0;
  const coordinator = createPersistenceCoordinator({
    getSnapshot: () => snapshots[snapshotIndex],
    persist: (snapshot) => persisted.push(snapshot),
    now: () => now,
    setTimer(callback, delay) {
      timerCallback = callback;
      timerDelay = delay;
      return 9;
    },
    clearTimer() {
      timerCallback = undefined;
    },
    checkpointMs: 500,
  });

  coordinator.onEvent(delta(1, 'assistant', 'A'));
  coordinator.onEvent(delta(2, 'assistant', 'B'));
  assert.equal(timerDelay, 500);
  assert.equal(persisted.length, 0);

  now = 500;
  timerCallback();
  assert.equal(persisted.length, 1);

  snapshotIndex = 1;
  coordinator.onEvent(delta(3, 'assistant', 'C'));
  coordinator.onThreadSwitch();
  coordinator.onHidden();
  coordinator.onEvent(completion(4));
  assert.deepEqual(persisted, [snapshots[0], snapshots[1], snapshots[1], snapshots[1]]);

  coordinator.onEvent(delta(5, 'assistant', 'D'));
  coordinator.dispose();
  assert.equal(persisted.at(-1), snapshots[1]);
});

