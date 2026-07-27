import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import itemModule from '../.test-dist/webview/threadItems.js';
import rendererModule from '../.test-dist/webview/codexRenderer.js';

const { ThreadItemRenderer, TurnView } = itemModule;
const { ConversationRoot, createCodexRendererController } = rendererModule;

function item(type, overrides = {}) {
  return {
    id: `${type}-1`,
    turnId: 'turn-1',
    type,
    status: 'completed',
    content: `${type} content`,
    label: `${type} label`,
    startedAt: 10,
    completedAt: 20,
    ...overrides,
  };
}

function renderItem(type, overrides) {
  return renderToStaticMarkup(
    React.createElement(ThreadItemRenderer, {
      item: item(type, overrides),
      renderMarkdown: false,
    })
  );
}

test('message items preserve the existing semantic message classes and stable ids', () => {
  const user = renderItem('user-message');
  const assistant = renderItem('assistant-message');

  assert.match(user, /class="message user"/);
  assert.match(user, /data-item-id="user-message-1"/);
  assert.match(user, /class="message-bubble"/);
  assert.match(assistant, /class="message assistant"/);
  assert.match(assistant, /class="message-content"/);
});

test('reasoning and activity item variants produce typed semantic markup', () => {
  const reasoning = renderItem('reasoning');
  const command = renderItem('command-execution');
  const file = renderItem('file-change');
  const tool = renderItem('mcp-tool-call');

  assert.match(reasoning, /<details[^>]*class="message-thinking"/);
  assert.match(reasoning, /<summary/);
  assert.match(command, /data-item-type="command-execution"/);
  assert.match(command, /class="thread-activity thread-activity-command"/);
  assert.match(file, /class="thread-activity thread-activity-file"/);
  assert.match(tool, /class="thread-activity thread-activity-tool"/);
});

test('approval and error items preserve actionable and accessible contracts', () => {
  const approval = renderItem('approval-request', {
    content: 'Allow edit?',
    choices: [{ label: 'Allow', prompt: 'yes' }],
  });
  const error = renderItem('system-error', { content: 'failed' });

  assert.match(approval, /data-claude-approval-prompt="yes"/);
  assert.match(approval, /class="claude-approval-panel"/);
  assert.match(error, /role="alert"/);
  assert.match(error, /class="message error"/);
});

test('turn markup exposes stable turn identity and ordered item identity', () => {
  const turn = {
    id: 'turn-1',
    status: 'completed',
    itemOrder: ['user', 'assistant'],
    itemsById: {
      user: item('user-message', { id: 'user' }),
      assistant: item('assistant-message', { id: 'assistant' }),
    },
    startedAt: 10,
    completedAt: 20,
  };
  const markup = renderToStaticMarkup(
    React.createElement(TurnView, {
      turn,
      renderMarkdown: false,
    })
  );

  assert.match(markup, /data-turn-id="turn-1"/);
  assert.ok(markup.indexOf('data-item-id="user"') < markup.indexOf('data-item-id="assistant"'));
});

test('conversation root reads normalized state through the external store', () => {
  const controller = createCodexRendererController({
    requestFrame: () => 1,
    cancelFrame: () => {},
    isHidden: () => true,
    persist: () => {},
  });
  controller.hydrateLegacy(
    {
      codex: [
        {
          id: 'thread-1',
          title: 'Thread',
          messages: [
            { role: 'user', text: 'question' },
            { role: 'assistant', text: 'answer' },
          ],
        },
      ],
    },
    { codex: 'thread-1' }
  );

  const markup = renderToStaticMarkup(
    React.createElement(ConversationRoot, {
      store: controller.store,
      providerId: 'codex',
      threadId: 'thread-1',
      renderMarkdown: false,
    })
  );

  assert.match(markup, /class="conversation-thread"/);
  assert.match(markup, /data-thread-id="thread-1"/);
  assert.match(markup, /data-turn-id="legacy:thread-1:turn:0"/);
});

test('renderer controller schedules canonical events and exposes read-only projections', () => {
  const persisted = [];
  const controller = createCodexRendererController({
    requestFrame: () => 1,
    cancelFrame: () => {},
    isHidden: () => true,
    persist: (snapshot) => persisted.push(snapshot),
  });
  controller.dispatch({
    command: 'threadEvent',
    providerId: 'codex',
    threadId: 'thread-1',
    sequence: 1,
    event: {
      type: 'thread/started',
      thread: {
        id: 'thread-1',
        providerId: 'codex',
        title: 'Thread',
        status: 'running',
        updatedAt: 10,
      },
    },
  });
  controller.dispatch({
    command: 'threadEvent',
    providerId: 'codex',
    threadId: 'thread-1',
    sequence: 2,
    event: {
      type: 'turn/started',
      turn: { id: 'turn-1', status: 'running', startedAt: 10 },
    },
  });
  controller.dispatch({
    command: 'threadEvent',
    providerId: 'codex',
    threadId: 'thread-1',
    sequence: 3,
    event: {
      type: 'item/started',
      item: {
        id: 'turn-1:user',
        turnId: 'turn-1',
        type: 'user-message',
        status: 'completed',
        content: 'question',
        startedAt: 10,
        completedAt: 10,
      },
    },
  });

  assert.deepEqual(controller.getConversationHistory('codex', 'thread-1'), [
    { role: 'user', text: 'question' },
  ]);
  assert.equal(controller.getThreadSummaries()[0].turnCount, 1);
  controller.dispose();
  assert.equal(persisted.at(-1).version, 2);
});

test('build config emits the browser renderer bundle with locked React dependencies', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  );
  const buildSource = readFileSync(new URL('../esbuild.mjs', import.meta.url), 'utf8');

  assert.equal(manifest.dependencies.react, '19.2.8');
  assert.equal(manifest.dependencies['react-dom'], '19.2.8');
  assert.equal(manifest.devDependencies['@types/react'], '19.2.17');
  assert.equal(manifest.devDependencies['@types/react-dom'], '19.2.3');
  assert.match(manifest.scripts['build:test'], /node esbuild\.mjs/);
  assert.match(buildSource, /entryPoints: \['src\/webview\/codexRenderer\.tsx'\]/);
  assert.match(buildSource, /outfile: 'media\/codex-renderer\.js'/);
  assert.match(buildSource, /platform: 'browser'/);
  assert.equal(existsSync(new URL('../media/codex-renderer.js', import.meta.url)), true);
});

test('conversation root virtualizes long threads by turn with spacer geometry', () => {
  const controller = createCodexRendererController({
    requestFrame: () => 1,
    cancelFrame: () => {},
    isHidden: () => true,
    persist: () => {},
  });
  let sequence = 1;
  controller.dispatch({
    command: 'threadEvent',
    providerId: 'codex',
    threadId: 'thread-long',
    sequence: sequence++,
    event: {
      type: 'thread/started',
      thread: {
        id: 'thread-long',
        providerId: 'codex',
        title: 'Long',
        status: 'running',
        updatedAt: 10,
      },
    },
  });
  for (let index = 0; index < 40; index += 1) {
    const turnId = `turn-${index}`;
    controller.dispatch({
      command: 'threadEvent',
      providerId: 'codex',
      threadId: 'thread-long',
      sequence: sequence++,
      event: {
        type: 'turn/started',
        turn: { id: turnId, status: 'running', startedAt: index },
      },
    });
    controller.dispatch({
      command: 'threadEvent',
      providerId: 'codex',
      threadId: 'thread-long',
      sequence: sequence++,
      event: {
        type: 'item/started',
        item: {
          id: `${turnId}:user`,
          turnId,
          type: 'user-message',
          status: 'completed',
          content: `${index}`,
          startedAt: index,
          completedAt: index,
        },
      },
    });
    controller.dispatch({
      command: 'threadEvent',
      providerId: 'codex',
      threadId: 'thread-long',
      sequence: sequence++,
      event: {
        type: 'turn/completed',
        turnId,
        status: 'completed',
        completedAt: index,
      },
    });
  }

  const scrollRoot = {
    clientHeight: 560,
    scrollTop: 2800,
    scrollHeight: 11200,
  };
  const markup = renderToStaticMarkup(
    React.createElement(ConversationRoot, {
      store: controller.store,
      providerId: 'codex',
      threadId: 'thread-long',
      renderMarkdown: false,
      scrollRoot,
    })
  );

  assert.match(markup, /class="conversation-virtual-spacer is-before"/);
  assert.match(markup, /height:1120px/);
  assert.doesNotMatch(markup, /data-turn-id="turn-0"/);
  assert.match(markup, /data-turn-id="turn-4"/);
  assert.match(markup, /data-turn-id="turn-17"/);
  assert.doesNotMatch(markup, /data-turn-id="turn-18"/);
});
