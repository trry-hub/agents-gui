import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  GenerateCommitMessageUseCase,
  TextGenerationError,
} = require('../.test-dist/textGeneration.js');
const { CliTextGenerationAdapter } = require('../.test-dist/cliTextGenerationAdapter.js');

const activeSignal = {
  isCancellationRequested: false,
  onCancellationRequested() {
    return { dispose() {} };
  },
};

function createEventChannel() {
  const listeners = new Set();
  return {
    event: {
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

function createCancellationSignal() {
  const listeners = new Set();
  return {
    signal: {
      isCancellationRequested: false,
      onCancellationRequested(listener) {
        listeners.add(listener);
        return {
          dispose() {
            listeners.delete(listener);
          },
        };
      },
    },
    cancel() {
      this.signal.isCancellationRequested = true;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

function createFakeCliManager() {
  const channel = createEventChannel();
  const calls = [];
  const stopped = [];
  const session = {
    id: 'opencode-1',
    cliId: 'opencode',
    onEvent: channel.event,
  };
  return {
    calls,
    stopped,
    session,
    events: channel,
    async checkInstalled() {
      return true;
    },
    async startPrompt(...args) {
      calls.push(args);
      return session;
    },
    stop(sessionId) {
      stopped.push(sessionId);
    },
  };
}

function fastGenerationRequest(overrides = {}) {
  return {
    task: 'commit-message',
    providerId: 'opencode',
    prompt: 'Generate a commit message',
    cwd: '/workspace/repository-b',
    budgets: {
      launchMs: 100,
      firstOutputMs: 100,
      idleMs: 100,
      totalMs: 500,
    },
    ...overrides,
  };
}

test('commit generation uses the selected local CLI and exact repository root', async () => {
  const requests = [];
  const generator = {
    async generate(request) {
      requests.push(request);
      return 'feat(runtime): isolate commit generation';
    },
  };
  const useCase = new GenerateCommitMessageUseCase(generator);

  const result = await useCase.execute({
    providerId: 'opencode',
    prompt: 'Generate a commit message',
    repositoryRoot: '/workspace/repository-b',
    language: 'en',
    diff: 'diff --git a/a.ts b/a.ts\n+export const value = 1;',
    inputMessage: '',
    signal: activeSignal,
  });

  assert.equal(result.message, 'feat(runtime): isolate commit generation');
  assert.equal(result.providerId, 'opencode');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].task, 'commit-message');
  assert.equal(requests[0].cwd, '/workspace/repository-b');
  assert.equal('capabilities' in requests[0], false);
  assert.equal(requests[0].budgets.firstOutputMs, 45_000);
  assert.equal(requests[0].budgets.totalMs, 90_000);
});

test('commit generation invokes only the selected local CLI when it fails', async () => {
  const calls = [];
  const useCase = new GenerateCommitMessageUseCase({
    async generate(request) {
      calls.push(request.providerId);
      throw new TextGenerationError('provider-error', 'selected CLI failed', request.providerId);
    },
  });

  await assert.rejects(
    useCase.execute({
      providerId: 'claude',
      prompt: 'prompt',
      repositoryRoot: '/repo',
      language: 'en',
      diff: 'diff',
      inputMessage: '',
      signal: activeSignal,
    }),
    /selected CLI failed/
  );
  assert.deepEqual(calls, ['claude']);
});

test('commit generation never streams diagnostic output into SCM', async () => {
  const partials = [];
  const useCase = new GenerateCommitMessageUseCase({
    async generate(_request, _signal, observer) {
      observer?.({
        type: 'output',
        text: 'error: Request failed: Bad request (400): Unsupported model MiMo-V2.5-Pro.',
      });
      return 'error: Request failed: Bad request (400): Unsupported model MiMo-V2.5-Pro.';
    },
  });

  await assert.rejects(
    useCase.execute({
      providerId: 'goose',
      prompt: 'prompt',
      repositoryRoot: '/repo',
      language: 'en',
      diff: 'diff',
      inputMessage: '',
      signal: activeSignal,
      onPartial: (message) => partials.push(message),
    }),
    (error) => error.code === 'invalid-output'
  );
  assert.deepEqual(partials, []);
});

test('commit generation cancellation never starts another CLI', async () => {
  const requests = [];
  const generator = {
    async generate(request) {
      requests.push(request);
      throw new TextGenerationError('cancelled', 'cancelled', request.providerId);
    },
  };
  const useCase = new GenerateCommitMessageUseCase(generator);

  await assert.rejects(
    () =>
      useCase.execute({
        providerId: 'opencode',
        prompt: 'Generate a commit message',
        repositoryRoot: '/workspace/repository-b',
        language: 'en',
        diff: 'diff --git a/a.ts b/a.ts\n+export const value = 1;',
        inputMessage: '',
        signal: activeSignal,
      }),
    (error) => error instanceof TextGenerationError && error.code === 'cancelled'
  );

  assert.equal(requests.length, 1);
});

test('CLI text generation adapter passes exact cwd without generated policy or env overrides', async () => {
  const manager = createFakeCliManager();
  const adapter = new CliTextGenerationAdapter(manager);
  const phases = [];

  const generation = adapter.generate(fastGenerationRequest(), activeSignal, (event) => {
    if (event.type === 'phase') {
      phases.push(event.phase);
    }
  });
  await new Promise((resolve) => setImmediate(resolve));
  manager.events.fire({
    type: 'output',
    stream: 'stdout',
    transport: 'process',
    text: [
      JSON.stringify({
        type: 'message.part.delta',
        properties: { part: { type: 'text' }, delta: 'fix(commit): isolate runtime' },
      }),
      '',
    ].join('\n'),
  });
  manager.events.fire({ type: 'end', exitCode: 0 });

  assert.equal(await generation, 'fix(commit): isolate runtime');
  assert.equal(manager.calls.length, 1);
  const [, prompt, options] = manager.calls[0];
  assert.equal(prompt, 'Generate a commit message');
  assert.equal(options.cwd, '/workspace/repository-b');
  assert.deepEqual(phases, ['launch', 'wait-first-output', 'stream', 'cleanup', 'completed']);
});

test('CLI text generation adapter stops on a chunked diagnostic line without streaming it', async () => {
  const manager = createFakeCliManager();
  const adapter = new CliTextGenerationAdapter(manager);
  const partials = [];
  const generation = adapter.generate(fastGenerationRequest(), activeSignal, (event) => {
    if (event.type === 'output') {
      partials.push(event.text);
    }
  });
  await new Promise((resolve) => setImmediate(resolve));

  const delta = (text) =>
    JSON.stringify({
      type: 'message.part.delta',
      properties: { part: { type: 'text' }, delta: text },
    });
  manager.events.fire({
    type: 'output',
    stream: 'stdout',
    transport: 'process',
    text: `${delta('fix(adapter): preserve native CLI output')}\n`,
  });
  manager.events.fire({
    type: 'output',
    stream: 'stdout',
    transport: 'process',
    text: `${delta('\n-api er')}\n`,
  });
  manager.events.fire({
    type: 'output',
    stream: 'stdout',
    transport: 'process',
    text: `${delta('ror: Request failed: Bad request (400): Unsupported model MiMo-V2.5-Pro.')}\n`,
  });

  await assert.rejects(
    () => generation,
    (error) =>
      error instanceof TextGenerationError &&
      error.code === 'provider-error' &&
      error.message === 'api error: Request failed: Bad request (400): Unsupported model MiMo-V2.5-Pro.'
  );
  assert.deepEqual(manager.stopped, ['opencode-1']);
  assert.equal(manager.calls.length, 1);
  assert.ok(partials.every((partial) => !/api error|request failed|unsupported model/i.test(partial)));
});

test('CLI text generation adapter stops before a nonzero exit can expose a buffered diagnostic', async () => {
  const manager = createFakeCliManager();
  const adapter = new CliTextGenerationAdapter(manager);
  const generation = adapter.generate(fastGenerationRequest(), activeSignal);
  await new Promise((resolve) => setImmediate(resolve));

  manager.events.fire({
    type: 'output',
    stream: 'stdout',
    transport: 'process',
    text: JSON.stringify({
      type: 'message.part.delta',
      properties: {
        part: { type: 'text' },
        delta: 'fix(adapter): preserve native CLI output\nerror: Request failed: Bad request (400)',
      },
    }),
  });
  manager.events.fire({ type: 'end', exitCode: 1 });

  await assert.rejects(
    () => generation,
    (error) =>
      error instanceof TextGenerationError &&
      error.code === 'provider-error' &&
      error.message === 'error: Request failed: Bad request (400)'
  );
  assert.deepEqual(manager.stopped, ['opencode-1']);
  assert.equal(manager.calls.length, 1);
});

test('CLI text generation adapter stops a session on first-output timeout', async () => {
  const manager = createFakeCliManager();
  const adapter = new CliTextGenerationAdapter(manager);

  await assert.rejects(
    () =>
      adapter.generate(
        fastGenerationRequest({
          budgets: {
            launchMs: 100,
            firstOutputMs: 10,
            idleMs: 100,
            totalMs: 200,
          },
        }),
        activeSignal
      ),
    (error) =>
      error instanceof TextGenerationError &&
      error.code === 'first-output-timeout' &&
      error.phase === 'wait-first-output'
  );

  assert.deepEqual(manager.stopped, ['opencode-1']);
});

test('CLI text generation adapter stops a session when cancelled', async () => {
  const manager = createFakeCliManager();
  const cancellation = createCancellationSignal();
  const adapter = new CliTextGenerationAdapter(manager);

  const generation = adapter.generate(fastGenerationRequest(), cancellation.signal);
  await new Promise((resolve) => setImmediate(resolve));
  cancellation.cancel();

  await assert.rejects(
    () => generation,
    (error) => error instanceof TextGenerationError && error.code === 'cancelled'
  );
  assert.deepEqual(manager.stopped, ['opencode-1']);
});
