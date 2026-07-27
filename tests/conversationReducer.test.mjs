import assert from 'node:assert/strict';
import test from 'node:test';

import reducerModule from '../.test-dist/webview/conversationReducer.js';
import storeModule from '../.test-dist/webview/conversationStore.js';

const {
  createEmptyConversationSnapshot,
  migrateLegacyConversations,
  projectConversationHistory,
  projectThreadSummaries,
} = reducerModule;
const { createConversationStore } = storeModule;

function envelope(sequence, event, overrides = {}) {
  return {
    command: 'threadEvent',
    providerId: 'codex',
    threadId: 'thread-1',
    sequence,
    event,
    ...overrides,
  };
}

function startThreadAndTurn(store, turnId, sequenceStart = 1) {
  store.dispatch(
    envelope(sequenceStart, {
      type: 'thread/started',
      thread: {
        id: 'thread-1',
        providerId: 'codex',
        title: 'Build',
        status: 'running',
        updatedAt: 10,
      },
    })
  );
  store.dispatch(
    envelope(sequenceStart + 1, {
      type: 'turn/started',
      turn: { id: turnId, status: 'running', startedAt: 10 },
    })
  );
}

test('assistant delta clones only the addressed thread, turn, and item', () => {
  const store = createConversationStore();
  startThreadAndTurn(store, 'turn-1');
  store.dispatch(
    envelope(3, {
      type: 'item/started',
      item: {
        id: 'turn-1:assistant',
        turnId: 'turn-1',
        type: 'assistant-message',
        status: 'completed',
        content: 'done',
        startedAt: 10,
        completedAt: 11,
      },
    })
  );
  store.dispatch(
    envelope(4, {
      type: 'turn/completed',
      turnId: 'turn-1',
      status: 'completed',
      completedAt: 11,
    })
  );
  store.dispatch(
    envelope(5, {
      type: 'turn/started',
      turn: { id: 'turn-2', status: 'running', startedAt: 12 },
    })
  );
  store.dispatch(
    envelope(6, {
      type: 'item/started',
      item: {
        id: 'turn-2:assistant',
        turnId: 'turn-2',
        type: 'assistant-message',
        status: 'running',
        content: '',
        startedAt: 12,
      },
    })
  );

  const before = store.getSnapshot();
  const completedTurnBefore = before.threadsById['thread-1'].turnsById['turn-1'];
  const runningTurnBefore = before.threadsById['thread-1'].turnsById['turn-2'];
  store.dispatch(
    envelope(7, {
      type: 'item/assistantMessage/delta',
      turnId: 'turn-2',
      itemId: 'turn-2:assistant',
      delta: 'hello',
    })
  );
  const after = store.getSnapshot();

  assert.equal(after.threadsById['thread-1'].turnsById['turn-1'], completedTurnBefore);
  assert.notEqual(after.threadsById['thread-1'].turnsById['turn-2'], runningTurnBefore);
  assert.equal(
    after.threadsById['thread-1'].turnsById['turn-2'].itemsById['turn-2:assistant'].content,
    'hello'
  );
});

test('delta before item start creates a running placeholder', () => {
  const store = createConversationStore();
  startThreadAndTurn(store, 'turn-1');
  store.dispatch(
    envelope(3, {
      type: 'item/reasoning/delta',
      turnId: 'turn-1',
      itemId: 'turn-1:reasoning',
      delta: 'inspect',
    })
  );

  const item =
    store.getSnapshot().threadsById['thread-1'].turnsById['turn-1'].itemsById[
      'turn-1:reasoning'
    ];
  assert.equal(item.type, 'reasoning');
  assert.equal(item.status, 'running');
  assert.equal(item.content, 'inspect');
});

test('store ignores exact duplicate sequences but accepts a distinct late envelope', () => {
  const store = createConversationStore();
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });
  startThreadAndTurn(store, 'turn-1', 10);

  const delta = envelope(20, {
    type: 'item/assistantMessage/delta',
    turnId: 'turn-1',
    itemId: 'turn-1:assistant',
    delta: 'A',
  });
  store.dispatch(delta);
  store.dispatch(delta);
  store.dispatch(
    envelope(15, {
      type: 'turn/completed',
      turnId: 'turn-1',
      status: 'completed',
      completedAt: 30,
    })
  );

  const turn = store.getSnapshot().threadsById['thread-1'].turnsById['turn-1'];
  assert.equal(turn.itemsById['turn-1:assistant'].content, 'A');
  assert.equal(turn.status, 'completed');
  assert.equal(notifications, 4);
});

test('item completion is authoritative and turn completion finalizes running siblings', () => {
  const store = createConversationStore();
  startThreadAndTurn(store, 'turn-1');
  store.dispatch(
    envelope(3, {
      type: 'item/assistantMessage/delta',
      turnId: 'turn-1',
      itemId: 'turn-1:assistant',
      delta: 'partial',
    })
  );
  store.dispatch(
    envelope(4, {
      type: 'item/completed',
      item: {
        id: 'turn-1:assistant',
        turnId: 'turn-1',
        type: 'assistant-message',
        status: 'completed',
        content: 'final',
        startedAt: 10,
        completedAt: 20,
      },
    })
  );
  store.dispatch(
    envelope(5, {
      type: 'item/reasoning/delta',
      turnId: 'turn-1',
      itemId: 'turn-1:reasoning',
      delta: 'thinking',
    })
  );
  store.dispatch(
    envelope(6, {
      type: 'turn/completed',
      turnId: 'turn-1',
      status: 'stopped',
      completedAt: 30,
    })
  );

  const turn = store.getSnapshot().threadsById['thread-1'].turnsById['turn-1'];
  assert.equal(turn.itemsById['turn-1:assistant'].content, 'final');
  assert.equal(turn.itemsById['turn-1:assistant'].status, 'completed');
  assert.equal(turn.itemsById['turn-1:reasoning'].status, 'stopped');
});

test('legacy migration groups messages into turns and stops running placeholders', () => {
  const snapshot = migrateLegacyConversations(
    {
      codex: [
        {
          id: 'thread-1',
          title: 'Legacy',
          createdAt: 10,
          updatedAt: 20,
          messages: [
            { role: 'user', text: 'question' },
            { role: 'assistant', text: 'answer', thinking: 'reason' },
            { role: 'assistant', text: '', running: true },
          ],
        },
      ],
    },
    { codex: 'thread-1' }
  );

  const thread = snapshot.threadsById['thread-1'];
  assert.equal(snapshot.version, 2);
  assert.equal(thread.turnOrder.length, 1);
  const turn = thread.turnsById[thread.turnOrder[0]];
  assert.deepEqual(
    turn.itemOrder.map((id) => turn.itemsById[id].type),
    ['user-message', 'assistant-message', 'reasoning', 'assistant-message']
  );
  assert.equal(turn.itemsById[turn.itemOrder.at(-1)].status, 'stopped');
  assert.deepEqual(projectConversationHistory(snapshot, 'codex', 'thread-1'), [
    { role: 'user', text: 'question' },
    { role: 'assistant', text: 'answer' },
  ]);
  assert.deepEqual(projectThreadSummaries(snapshot), [
    {
      id: 'thread-1',
      providerId: 'codex',
      title: 'Legacy',
      status: 'stopped',
      updatedAt: 20,
      turnCount: 1,
    },
  ]);
});

test('empty snapshots have stable versioned shape', () => {
  assert.deepEqual(createEmptyConversationSnapshot(), {
    version: 2,
    threadsById: {},
    threadOrderByProvider: {},
    activeThreadByProvider: {},
  });
});

