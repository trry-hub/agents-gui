import assert from 'node:assert/strict';
import test from 'node:test';

import virtualizerModule from '../.test-dist/webview/turnVirtualizer.js';

const {
  compensateScrollOffset,
  computeVirtualRange,
  distanceFromBottom,
  isBottomPinned,
  updateMeasuredHeight,
} = virtualizerModule;

function turnIds(count) {
  return Array.from({ length: count }, (_, index) => `turn-${index}`);
}

test('virtualization stays disabled through 30 turns', () => {
  assert.deepEqual(
    computeVirtualRange({
      turnIds: turnIds(30),
      measuredHeights: {},
      viewportHeight: 560,
      scrollOffset: 2800,
    }),
    { start: 0, end: 29, firstVisible: 0, before: 0, after: 0, total: 8400 }
  );
});

test('virtualized ranges use 280px estimates and six-turn overscan', () => {
  const result = computeVirtualRange({
    turnIds: turnIds(40),
    measuredHeights: {},
    viewportHeight: 560,
    scrollOffset: 2800,
  });

  assert.deepEqual(result, {
    start: 4,
    end: 17,
    firstVisible: 10,
    before: 1120,
    after: 6160,
    total: 11200,
  });
});

test('measured heights replace estimates and preserve immutable maps', () => {
  const original = { 'turn-0': 320 };
  const next = updateMeasuredHeight(original, 'turn-1', 500);
  const unchanged = updateMeasuredHeight(next, 'turn-1', 500.2);
  const result = computeVirtualRange({
    turnIds: turnIds(31),
    measuredHeights: next,
    viewportHeight: 560,
    scrollOffset: 820,
  });

  assert.notEqual(next, original);
  assert.equal(next['turn-0'], 320);
  assert.equal(next['turn-1'], 500);
  assert.equal(unchanged, next);
  assert.equal(result.total, 31 * 280 - 280 - 280 + 320 + 500);
});

test('virtual range exposes the viewport anchor independently from overscan', () => {
  const range = computeVirtualRange({
    turnIds: turnIds(40),
    measuredHeights: {},
    viewportHeight: 560,
    scrollOffset: 2800,
  });

  assert.equal(range.start, 4);
  assert.equal(range.firstVisible, 10);
  assert.equal(
    compensateScrollOffset({
      scrollTop: 2800,
      anchorIndex: range.firstVisible,
      changedIndex: 7,
      previousHeight: 280,
      nextHeight: 420,
    }),
    2940
  );
});

test('bottom distance uses a 24px pin threshold', () => {
  assert.equal(
    distanceFromBottom({ scrollHeight: 1000, scrollTop: 476, clientHeight: 500 }),
    24
  );
  assert.equal(isBottomPinned(24), true);
  assert.equal(isBottomPinned(24.01), false);
  assert.equal(
    distanceFromBottom({ scrollHeight: 300, scrollTop: 0, clientHeight: 500 }),
    0
  );
});

test('height changes above the visible anchor compensate scroll offset', () => {
  assert.equal(
    compensateScrollOffset({
      scrollTop: 1000,
      anchorIndex: 10,
      changedIndex: 3,
      previousHeight: 280,
      nextHeight: 420,
    }),
    1140
  );
  assert.equal(
    compensateScrollOffset({
      scrollTop: 1000,
      anchorIndex: 10,
      changedIndex: 12,
      previousHeight: 280,
      nextHeight: 420,
    }),
    1000
  );
});
