import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  return request === 'vscode' ? {} : originalLoad.call(this, request, parent, isMain);
};
const {
  AgentSessionController,
  DEFAULT_MAX_SESSION_STDERR_BYTES,
  DEFAULT_MAX_SESSION_STDOUT_BYTES,
} = require('../.test-dist/agentSessionController.js');
Module._load = originalLoad;
const { MAX_CLI_JSON_BUFFER_BYTES } = require('../.test-dist/outputFormatter.js');

function createEventChannel() {
  const listeners = new Set();
  return {
    emitter: {
      event(listener) {
        listeners.add(listener);
        return {
          dispose() {
            listeners.delete(listener);
          },
        };
      },
    },
    fire(value) {
      for (const listener of listeners) {
        listener(value);
      }
    },
  };
}

function createHarness(options = {}) {
  const events = createEventChannel();
  const stopped = [];
  const posted = [];
  const agentRuntime = {
    stop(sessionId) {
      stopped.push(sessionId);
    },
  };
  const session = {
    id: 'opencode-7',
    cliId: 'opencode',
    profile: { name: 'OpenCode' },
    process: { exitCode: null, killed: false },
    onEvent: events.emitter,
  };
  const controller = new AgentSessionController({
    agentRuntime,
    locale: 'en',
    postToWebview(message) {
      posted.push(message);
    },
    ...options,
  });
  controller.register(session);
  return { controller, events, posted, session, stopped };
}

function assertCorrelatedLimitFailure(harness, streamPattern) {
  assert.deepEqual(harness.stopped, [harness.session.id]);
  assert.equal(harness.controller.active(harness.session.cliId), undefined);
  const errors = harness.posted.filter((message) => message.command === 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].cliId, harness.session.cliId);
  assert.equal(errors[0].sessionId, harness.session.id);
  assert.match(errors[0].text, streamPattern);
}

test('interactive controller has explicit stdout and stderr session budget defaults', () => {
  assert.equal(DEFAULT_MAX_SESSION_STDOUT_BYTES, 4 * 1024 * 1024);
  assert.equal(DEFAULT_MAX_SESSION_STDERR_BYTES, 512 * 1024);
});

test('interactive controller stops and cleans up a session on cumulative stdout overflow', () => {
  const harness = createHarness({ maxStdoutBytes: 8 });

  assert.doesNotThrow(() => {
    harness.events.fire({
      type: 'output',
      stream: 'stdout',
      transport: 'process',
      text: '1234',
    });
    harness.events.fire({
      type: 'output',
      stream: 'stdout',
      transport: 'process',
      text: '56789',
    });
  });

  assertCorrelatedLimitFailure(harness, /stdout exceeded the 8-byte output limit/i);
});

test('interactive controller stops and cleans up a session on cumulative stderr overflow', () => {
  const harness = createHarness({ maxStderrBytes: 6 });

  assert.doesNotThrow(() => {
    harness.events.fire({
      type: 'output',
      stream: 'stderr',
      transport: 'process',
      text: 'abc',
    });
    harness.events.fire({
      type: 'output',
      stream: 'stderr',
      transport: 'process',
      text: 'defg',
    });
  });

  assertCorrelatedLimitFailure(harness, /stderr exceeded the 6-byte output limit/i);
});

test('interactive controller contains parser overflow and terminates the originating session', () => {
  const harness = createHarness({
    maxStdoutBytes: MAX_CLI_JSON_BUFFER_BYTES + 256,
  });
  const incompleteJson = `{"type":"message.part.delta","payload":"${'x'.repeat(
    MAX_CLI_JSON_BUFFER_BYTES
  )}`;

  assert.doesNotThrow(() => {
    harness.events.fire({
      type: 'output',
      stream: 'stdout',
      transport: 'process',
      text: incompleteJson,
    });
  });

  assertCorrelatedLimitFailure(harness, /incomplete OpenCode JSON record exceeded/i);
});
