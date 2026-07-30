import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const Module = require('node:module');
class VscodeEventEmitter extends EventEmitter {
  fire(value) { this.emit('event', value); }
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

test('CliManager launches OpenCode with only inherited env, cwd, transport argv, and prompt', async () => {
  const launches = [];
  const child = fakeChild();
  const processRunner = {
    spawnPromptProcess(command, args, cwd, env, stdin) {
      launches.push({ command, args, cwd, env, stdin });
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
    spawnProbeProcess() { throw new Error('unexpected probe'); },
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
  for (const name of [
    'AGENTS_HUB_API_MODEL', 'OPENAI_MODEL', 'ANTHROPIC_MODEL', 'GOOSE_MODEL',
    'AIDER_MODEL', 'OPENCODE_DB', 'OMO_DISABLE_POSTHOG',
    'OMO_SEND_ANONYMOUS_TELEMETRY', 'GEMINI_CLI_NO_RELAUNCH',
    'OPENCODE_CONFIG_CONTENT',
  ]) {
    assert.equal(launches[0].env[name], process.env[name]);
  }
});
