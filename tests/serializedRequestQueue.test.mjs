import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { SerializedRequestQueue } = require('../.test-dist/serializedRequestQueue.js');

test('a lone rejected request is handled without an unhandled rejection', async () => {
  const queue = new SerializedRequestQueue();
  const handled = [];
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    await queue.enqueue(
      'opencode',
      async () => {
        throw new Error('first failed');
      },
      (error) => handled.push(error.message)
    );
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }

  assert.deepEqual(handled, ['first failed']);
  assert.deepEqual(unhandled, []);
});

test('same-provider failures stay correlated and do not block later requests', async () => {
  const queue = new SerializedRequestQueue();
  const events = [];
  let rejectFirst;
  const firstGate = new Promise((_resolve, reject) => {
    rejectFirst = reject;
  });

  const first = queue.enqueue(
    'opencode',
    async () => {
      events.push('run:thread-a');
      await firstGate;
    },
    (error) => events.push(`error:thread-a:${error.message}`)
  );
  const second = queue.enqueue(
    'opencode',
    async () => {
      events.push('run:thread-b');
      throw new Error('second failed');
    },
    (error) => events.push(`error:thread-b:${error.message}`)
  );
  await Promise.resolve();
  assert.deepEqual(events, ['run:thread-a']);
  rejectFirst(new Error('first failed'));
  await Promise.all([first, second]);

  assert.deepEqual(events, [
    'run:thread-a',
    'error:thread-a:first failed',
    'run:thread-b',
    'error:thread-b:second failed',
  ]);
});
