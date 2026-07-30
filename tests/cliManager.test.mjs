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
const { CliManager } = require('../.test-dist/cliManager.js');
Module._load = originalLoad;

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
  const seen = new Set();
  return [commandDir, ...String(inheritedPath || '').split(delimiter)]
    .map((entry) => entry.trim())
    .filter((entry) => {
      const key = platform === 'win32' ? entry.toLowerCase() : entry;
      if (!entry || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(delimiter);
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
      queueMicrotask(() => child.emit('close', 0));
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

test('CliManager forwards process streams and cleans up on normal close', async () => {
  const child = fakeChild();
  child.exitCode = null;
  child.signalCode = null;
  const treeTerminations = [];
  const runner = {
    spawnPromptProcess() {
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
  assert.deepEqual(events, [
    { type: 'output', text: 'out', stream: 'stdout', transport: 'process' },
    { type: 'output', text: 'err', stream: 'stderr', transport: 'process' },
    { type: 'end', exitCode: 0 },
  ]);
  assert.deepEqual(treeTerminations, [{ proc: child, signal: 'SIGTERM' }]);
  assert.deepEqual(manager.getActiveSessionIds(), []);
});

test('CliManager reports child launch errors, evicts the resolved command, and cleans up', async () => {
  const child = fakeChild();
  const evictions = [];
  const manager = new CliManager({
    processRunner: {
      spawnPromptProcess: () => child,
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
  const session = await manager.startPrompt('opencode', 'hello');
  const events = [];
  session.onEvent.event((event) => events.push(event));

  const error = Object.assign(new Error('not found'), { code: 'ENOENT' });
  child.emit('error', error);

  assert.deepEqual(evictions, ['opencode']);
  assert.deepEqual(events, [
    { type: 'error', message: 'Failed to start OpenCode: not found' },
    { type: 'end', exitCode: -1 },
  ]);
  assert.deepEqual(manager.getActiveSessionIds(), []);
});

test('CliManager stop cancels through the runner and removes the active session', async () => {
  const child = fakeChild();
  const terminated = [];
  const manager = new CliManager({
    processRunner: {
      spawnPromptProcess: () => child,
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
