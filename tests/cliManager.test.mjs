import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const Module = require('node:module');
class VscodeEventEmitter extends EventEmitter {
  fire(value) {
    this.emit('event', value);
  }
  event(listener) {
    this.on('event', listener);
    return { dispose: () => this.off('event', listener) };
  }
}
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  return request === 'vscode'
    ? { EventEmitter: VscodeEventEmitter, workspace: {} }
    : originalLoad.call(this, request, parent, isMain);
};
const {
  CliManager,
  MAX_PENDING_LAUNCH_DELIVERY_BYTES,
} = require('../.test-dist/cliManager.js');
Module._load = originalLoad;
const { CliTextGenerationAdapter } = require('../.test-dist/cliTextGenerationAdapter.js');
const { TextGenerationError } = require('../.test-dist/textGeneration.js');

function fakeChild() {
  const child = new EventEmitter();
  child.pid = 4321;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {} };
  return child;
}

function expectedLaunchPath(commandDir, inheritedPath, platform = process.platform) {
  const delimiter = platform === 'win32' ? path.win32.delimiter : path.posix.delimiter;
  return inheritedPath === undefined ? commandDir : `${commandDir}${delimiter}${inheritedPath}`;
}

function isPathEnvironmentKey(name, platform = process.platform) {
  return platform === 'win32' ? name.toLowerCase() === 'path' : name === 'PATH';
}

test('CliManager launches OpenCode with only inherited env, cwd, transport argv, and prompt', async () => {
  const launches = [];
  const child = fakeChild();
  const processRunner = {
    spawnPromptProcess(command, args, cwd, env, stdin) {
      launches.push({ command, args, cwd, env, stdin });
      queueMicrotask(() => {
        child.emit('spawn');
        child.emit('close', 0);
      });
      return child;
    },
    spawnProbeProcess() {
      throw new Error('unexpected probe');
    },
    terminate() {},
    killTree() {},
  };
  const discovery = {
    resolveCommandPath: async () => '/usr/local/bin/opencode',
    getProfilesWithStatus: async () => [],
    evictCommandPath() {},
  };
  const manager = new CliManager({
    processRunner,
    cliDiscovery: discovery,
    workspaceRoot: () => '/workspace/default',
  });

  await manager.startPrompt('opencode', 'hello', { cwd: '/workspace/repo' });

  assert.equal(launches.length, 1);
  assert.equal(launches[0].command, '/usr/local/bin/opencode');
  assert.deepEqual(launches[0].args, ['run', '--format', 'json', 'hello']);
  assert.equal(launches[0].cwd, '/workspace/repo');
  const expectedPath = expectedLaunchPath('/usr/local/bin', process.env.PATH);
  assert.equal(launches[0].env.PATH, expectedPath);
  for (const [name, value] of Object.entries(process.env)) {
    if (!isPathEnvironmentKey(name)) assert.equal(launches[0].env[name], value, name);
  }
  for (const name of [
    'AGENTS_HUB_API_MODEL',
    'OPENAI_MODEL',
    'ANTHROPIC_MODEL',
    'GOOSE_MODEL',
    'AIDER_MODEL',
    'OPENCODE_DB',
    'OMO_DISABLE_POSTHOG',
    'OMO_SEND_ANONYMOUS_TELEMETRY',
    'GEMINI_CLI_NO_RELAUNCH',
    'OPENCODE_CONFIG_CONTENT',
  ]) {
    assert.equal(launches[0].env[name], process.env[name]);
  }
  assert.equal(isPathEnvironmentKey('Path', 'win32'), true);
  assert.equal(isPathEnvironmentKey('PATH', 'win32'), true);
  assert.equal(isPathEnvironmentKey('Path', 'linux'), false);
});

test('CliManager preserves a non-empty request cwd byte-for-byte', async () => {
  const launches = [];
  const child = fakeChild();
  const manager = new CliManager({
    processRunner: {
      spawnPromptProcess(command, args, cwd) {
        launches.push({ command, args, cwd });
        queueMicrotask(() => child.emit('spawn'));
        return child;
      },
      spawnProbeProcess() {
        throw new Error('unexpected probe');
      },
      terminate() {},
      killTree() {},
    },
    cliDiscovery: {
      resolveCommandPath: async () => '/bin/opencode',
      getProfilesWithStatus: async () => [],
      evictCommandPath() {},
    },
    workspaceRoot: () => '/workspace/default',
  });

  await manager.startPrompt('opencode', 'hello', { cwd: '/workspace/repo ' });

  assert.equal(launches[0].cwd, '/workspace/repo ');
});

test('CliManager disables gated CLIs before discovery or launch while other CLIs continue', async () => {
  const discoveryCalls = [];
  const launches = [];
  const child = fakeChild();
  const manager = new CliManager({
    disabledCliIds: new Set(['opencode']),
    processRunner: {
      spawnPromptProcess(command) {
        launches.push(command);
        queueMicrotask(() => child.emit('spawn'));
        return child;
      },
      spawnProbeProcess() {
        throw new Error('unexpected probe');
      },
      terminate() {},
      killTree() {},
    },
    cliDiscovery: {
      async checkInstalled(profile) {
        discoveryCalls.push(['installed', profile.id]);
        return true;
      },
      async resolveCommandPath(command) {
        discoveryCalls.push(['resolve', command]);
        return `/bin/${command}`;
      },
      async getProfilesWithStatus(profiles) {
        discoveryCalls.push(['profiles', profiles.map((profile) => profile.id)]);
        return profiles.map((profile) => ({ ...profile, installed: true }));
      },
      evictCommandPath() {},
    },
    workspaceRoot: () => '/workspace',
  });

  assert.equal(await manager.checkInstalled('opencode'), false);
  assert.equal(await manager.startPrompt('opencode', 'must not launch'), null);
  const profiles = await manager.getProfilesWithStatus();
  assert.equal(profiles.some((profile) => profile.id === 'opencode'), false);
  assert.equal(discoveryCalls.some((call) => call.includes('opencode')), false);

  assert.equal(await manager.checkInstalled('codex'), true);
  const session = await manager.startPrompt('codex', 'continue normally');
  assert.equal(session.cliId, 'codex');
  assert.deepEqual(launches, ['/bin/codex']);
});

test('CliManager resolves only after spawn and replays an immediate close to the caller', async () => {
  const child = fakeChild();
  let runnerStarted;
  const runnerStartedPromise = new Promise((resolve) => {
    runnerStarted = resolve;
  });
  const manager = new CliManager({
    processRunner: {
      spawnPromptProcess() {
        runnerStarted();
        return child;
      },
      spawnProbeProcess() {
        throw new Error('unexpected probe');
      },
      terminate() {},
      killTree() {},
    },
    cliDiscovery: {
      resolveCommandPath: async () => '/bin/opencode',
      getProfilesWithStatus: async () => [],
      evictCommandPath() {},
    },
    workspaceRoot: () => '/workspace',
  });

  let settled = false;
  const start = manager.startPrompt('opencode', 'hello').then((session) => {
    settled = true;
    return session;
  });
  await runnerStartedPromise;
  await Promise.resolve();
  assert.equal(settled, false);

  child.emit('spawn');
  child.emit('close', 0);
  const session = await start;
  const events = [];
  session.onEvent.event((event) => events.push(event));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(events, [{ type: 'end', exitCode: 0 }]);
  assert.deepEqual(manager.getActiveSessionIds(), []);
});

test('CliManager bounds output retained during the post-spawn listener handoff', async () => {
  assert.equal(MAX_PENDING_LAUNCH_DELIVERY_BYTES, 1024 * 1024);
  const child = fakeChild();
  let runnerStarted;
  const runnerStartedPromise = new Promise((resolve) => {
    runnerStarted = resolve;
  });
  const terminated = [];
  const manager = new CliManager({
    processRunner: {
      spawnPromptProcess() {
        runnerStarted();
        return child;
      },
      spawnProbeProcess() {
        throw new Error('unexpected probe');
      },
      terminate(proc) {
        terminated.push(proc);
      },
      killTree() {},
    },
    cliDiscovery: {
      resolveCommandPath: async () => '/bin/opencode',
      getProfilesWithStatus: async () => [],
      evictCommandPath() {},
    },
    workspaceRoot: () => '/workspace',
  });

  const start = manager.startPrompt('opencode', 'hello');
  await runnerStartedPromise;
  child.emit('spawn');
  child.stdout.emit('data', Buffer.alloc(MAX_PENDING_LAUNCH_DELIVERY_BYTES + 1, 97));
  const session = await start;
  const events = [];
  session.onEvent.event((event) => events.push(event));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(events.some((event) => event.type === 'output'), false);
  assert.match(events.find((event) => event.type === 'error')?.message ?? '', /buffer.*exceeded/i);
  assert.deepEqual(events.at(-1), { type: 'end', exitCode: -1 });
  assert.deepEqual(terminated, [child]);
  assert.deepEqual(manager.getActiveSessionIds(), []);
});

test('CliManager rejects a real pre-spawn command failure with a launch error', async () => {
  const manager = new CliManager({
    cliDiscovery: {
      resolveCommandPath: async () => '/definitely/missing/agents-gui-opencode',
      getProfilesWithStatus: async () => [],
      evictCommandPath() {},
    },
    workspaceRoot: () => '/tmp',
  });

  await assert.rejects(
    () => manager.startPrompt('opencode', 'hello'),
    (error) =>
      error?.code === 'CLI_LAUNCH_FAILED' &&
      /Failed to start OpenCode/.test(error.message) &&
      /ENOENT|no such file/i.test(error.message)
  );
  assert.deepEqual(manager.getActiveSessionIds(), []);
});

test('SCM generation receives a launch provider error instead of first-output timeout', async () => {
  const manager = new CliManager({
    cliDiscovery: {
      resolveCommandPath: async () => '/definitely/missing/agents-gui-opencode',
      getProfilesWithStatus: async () => [],
      evictCommandPath() {},
    },
    workspaceRoot: () => '/tmp',
  });
  const adapter = new CliTextGenerationAdapter(manager);
  const signal = {
    isCancellationRequested: false,
    onCancellationRequested() {
      return { dispose() {} };
    },
  };

  await assert.rejects(
    () =>
      adapter.generate(
        {
          task: 'commit-message',
          providerId: 'opencode',
          prompt: 'generate a commit message',
          cwd: '/tmp',
          budgets: {
            launchMs: 100,
            firstOutputMs: 20,
            idleMs: 20,
            totalMs: 200,
          },
        },
        signal
      ),
    (error) =>
      error instanceof TextGenerationError &&
      error.code === 'provider-error' &&
      /Failed to start OpenCode/.test(error.message)
  );
});

test('CliManager forwards process streams and cleans up on normal close', async () => {
  const child = fakeChild();
  child.exitCode = null;
  child.signalCode = null;
  const treeTerminations = [];
  const runner = {
    spawnPromptProcess() {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    spawnProbeProcess() {
      throw new Error('unexpected probe');
    },
    terminate() {},
    killTree: (proc, signal) => treeTerminations.push({ proc, signal }),
  };
  const manager = new CliManager({
    processRunner: runner,
    cliDiscovery: {
      resolveCommandPath: async () => '/bin/opencode',
      getProfilesWithStatus: async () => [],
      evictCommandPath() {},
    },
    workspaceRoot: () => '/workspace',
  });
  const session = await manager.startPrompt('opencode', 'hello');
  const events = [];
  session.onEvent.event((event) => events.push(event));
  child.stdout.emit('data', Buffer.from('out'));
  child.stderr.emit('data', Buffer.from('err'));
  child.emit('close', 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [
    { type: 'output', text: 'out', stream: 'stdout', transport: 'process' },
    { type: 'output', text: 'err', stream: 'stderr', transport: 'process' },
    { type: 'end', exitCode: 0 },
  ]);
  assert.deepEqual(treeTerminations, [{ proc: child, signal: 'SIGTERM' }]);
  assert.deepEqual(manager.getActiveSessionIds(), []);
});

test('CliManager rejects child launch errors, evicts the resolved command, and cleans up', async () => {
  const child = fakeChild();
  const evictions = [];
  const error = Object.assign(new Error('not found'), { code: 'ENOENT' });
  const manager = new CliManager({
    processRunner: {
      spawnPromptProcess: () => {
        queueMicrotask(() => child.emit('error', error));
        return child;
      },
      spawnProbeProcess() {
        throw new Error('unexpected probe');
      },
      terminate() {},
      killTree() {},
    },
    cliDiscovery: {
      resolveCommandPath: async () => '/bin/opencode',
      getProfilesWithStatus: async () => [],
      evictCommandPath: (command) => evictions.push(command),
    },
    workspaceRoot: () => '/workspace',
  });
  await assert.rejects(
    () => manager.startPrompt('opencode', 'hello'),
    (launchError) =>
      launchError?.code === 'CLI_LAUNCH_FAILED' &&
      launchError.message === 'Failed to start OpenCode: not found'
  );

  assert.deepEqual(evictions, ['opencode']);
  assert.deepEqual(manager.getActiveSessionIds(), []);
});

test('CliManager stop cancels through the runner and removes the active session', async () => {
  const child = fakeChild();
  const terminated = [];
  const manager = new CliManager({
    processRunner: {
      spawnPromptProcess: () => {
        queueMicrotask(() => child.emit('spawn'));
        return child;
      },
      spawnProbeProcess() {
        throw new Error('unexpected probe');
      },
      terminate: (proc) => terminated.push(proc),
      killTree() {},
    },
    cliDiscovery: {
      resolveCommandPath: async () => '/bin/opencode',
      getProfilesWithStatus: async () => [],
      evictCommandPath() {},
    },
    workspaceRoot: () => '/workspace',
  });
  const session = await manager.startPrompt('opencode', 'hello');

  manager.stop(session.id);

  assert.deepEqual(terminated, [child]);
  assert.deepEqual(manager.getActiveSessionIds(), []);
});
