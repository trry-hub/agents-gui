import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildOpenCodeFastGenerationEnv } = require('../.test-dist/openCodeTaskPolicy.js');
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
    capabilities: {
      tools: 'disabled',
      mcp: 'disabled',
      projectConfig: 'disabled',
      plugins: 'disabled',
      persistence: 'ephemeral',
    },
    budgets: {
      launchMs: 100,
      firstOutputMs: 100,
      idleMs: 100,
      totalMs: 500,
    },
    ...overrides,
  };
}

test('OpenCode fast generation disables global and inline MCP configuration', () => {
  const baseEnv = {
    EXISTING_VALUE: 'keep-me',
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      provider: { custom: { npm: '@ai-sdk/openai-compatible' } },
      mcp: {
        inline: { type: 'remote', url: 'https://example.com/mcp' },
      },
    }),
  };
  const globalConfig = {
    plugin: ['external-plugin'],
    mcp: {
      global: { type: 'local', command: ['node', 'server.js'] },
      inline: { type: 'remote', url: 'https://global.example.com/mcp' },
    },
  };

  const result = buildOpenCodeFastGenerationEnv(baseEnv, globalConfig);
  const inlineConfig = JSON.parse(result.OPENCODE_CONFIG_CONTENT);

  assert.equal(result.EXISTING_VALUE, 'keep-me');
  assert.equal(inlineConfig.mcp.global.enabled, false);
  assert.equal(inlineConfig.mcp.inline.enabled, false);
  assert.equal(inlineConfig.mcp.inline.url, 'https://example.com/mcp');
  assert.deepEqual(inlineConfig.permission, { '*': 'deny' });
  assert.deepEqual(inlineConfig.plugin, []);
  assert.ok(inlineConfig.provider.custom);
  assert.equal(result.OPENCODE_DISABLE_PROJECT_CONFIG, '1');
  assert.equal(result.OPENCODE_PURE, '1');
  assert.equal(result.OPENCODE_DISABLE_AUTOUPDATE, '1');
  assert.equal(result.OPENCODE_DISABLE_AUTOCOMPACT, '1');
  assert.equal(result.OPENCODE_DISABLE_MODELS_FETCH, '1');
});

test('OpenCode fast generation tolerates invalid pre-existing inline config', () => {
  const result = buildOpenCodeFastGenerationEnv(
    { OPENCODE_CONFIG_CONTENT: '{not-json' },
    { mcp: { memory: { enabled: true } } }
  );
  const inlineConfig = JSON.parse(result.OPENCODE_CONFIG_CONTENT);

  assert.deepEqual(inlineConfig.mcp.memory, { enabled: false });
  assert.deepEqual(inlineConfig.permission, { '*': 'deny' });
});

test('commit generation use case applies the fast-lane policy and exact repository root', async () => {
  const requests = [];
  const generator = {
    async generate(request) {
      requests.push(request);
      return 'feat(runtime): isolate commit generation';
    },
  };
  const useCase = new GenerateCommitMessageUseCase(generator);

  const result = await useCase.execute({
    primaryProviderId: 'opencode',
    resolveFallbackProviderIds: async () => ['codex'],
    prompt: 'Generate a commit message',
    repositoryRoot: '/workspace/repository-b',
    language: 'en',
    diff: 'diff --git a/a.ts b/a.ts\n+export const value = 1;',
    inputMessage: '',
    signal: activeSignal,
  });

  assert.equal(result.message, 'feat(runtime): isolate commit generation');
  assert.equal(result.providerId, 'opencode');
  assert.equal(result.fallbackFrom, undefined);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].task, 'commit-message');
  assert.equal(requests[0].cwd, '/workspace/repository-b');
  assert.deepEqual(requests[0].capabilities, {
    tools: 'disabled',
    mcp: 'disabled',
    projectConfig: 'disabled',
    plugins: 'disabled',
    persistence: 'ephemeral',
  });
  assert.equal(requests[0].budgets.firstOutputMs, 45_000);
  assert.equal(requests[0].budgets.totalMs, 90_000);
});

test('commit generation use case falls back after invalid provider output', async () => {
  const requests = [];
  const attempts = [];
  const generator = {
    async generate(request) {
      requests.push(request);
      return request.providerId === 'opencode'
        ? 'I inspected the diff and will now generate a message.'
        : 'fix(commit): bypass agent tool startup';
    },
  };
  const useCase = new GenerateCommitMessageUseCase(generator);

  const result = await useCase.execute({
    primaryProviderId: 'opencode',
    resolveFallbackProviderIds: async () => ['opencode', 'codex'],
    prompt: 'Generate a commit message',
    repositoryRoot: '/workspace/repository-b',
    language: 'en',
    diff: 'diff --git a/a.ts b/a.ts\n+export const value = 1;',
    inputMessage: '',
    signal: activeSignal,
    onAttemptStart: (providerId) => attempts.push(providerId),
  });

  assert.deepEqual(
    requests.map((request) => request.providerId),
    ['opencode', 'codex']
  );
  assert.deepEqual(attempts, ['opencode', 'codex']);
  assert.equal(result.message, 'fix(commit): bypass agent tool startup');
  assert.equal(result.providerId, 'codex');
  assert.equal(result.fallbackFrom, 'opencode');
});

test('commit generation cancellation never attempts a fallback provider', async () => {
  const requests = [];
  let fallbackResolved = false;
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
        primaryProviderId: 'opencode',
        resolveFallbackProviderIds: async () => {
          fallbackResolved = true;
          return ['codex'];
        },
        prompt: 'Generate a commit message',
        repositoryRoot: '/workspace/repository-b',
        language: 'en',
        diff: 'diff --git a/a.ts b/a.ts\n+export const value = 1;',
        inputMessage: '',
        signal: activeSignal,
      }),
    (error) => error instanceof TextGenerationError && error.code === 'cancelled'
  );

  assert.equal(fallbackResolved, false);
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

test('CLI text generation adapter stops a session on first-output timeout', async () => {
  const manager = createFakeCliManager();
  const adapter = new CliTextGenerationAdapter(manager, {
    resolveProviderRuntime: () => ({ env: {}, selectionKey: 'api-provider:none' }),
    readOpenCodeConfig: () => ({}),
  });

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
  const adapter = new CliTextGenerationAdapter(manager, {
    resolveProviderRuntime: () => ({ env: {}, selectionKey: 'api-provider:none' }),
    readOpenCodeConfig: () => ({}),
  });

  const generation = adapter.generate(fastGenerationRequest(), cancellation.signal);
  await new Promise((resolve) => setImmediate(resolve));
  cancellation.cancel();

  await assert.rejects(
    () => generation,
    (error) => error instanceof TextGenerationError && error.code === 'cancelled'
  );
  assert.deepEqual(manager.stopped, ['opencode-1']);
});
