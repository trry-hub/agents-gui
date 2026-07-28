import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { CliProcessRunner } = require('../.test-dist/cliProcessRunner.js');

function fakeChild() {
  const child = new EventEmitter();
  child.pid = 41;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => true;
  return child;
}

test('CliProcessRunner preserves argument arrays and disables shell execution', () => {
  const calls = [];
  const runner = new CliProcessRunner({
    platform: 'win32',
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return fakeChild();
    },
  });
  const args = ['run', '--attach', 'http://127.0.0.1:4096', 'a&b | c^d %PATH% !x!'];
  runner.spawnPromptProcess(
    'C:\\Users\\Agent User\\AppData\\Roaming\\npm\\opencode.cmd',
    args,
    'C:\\工作区\\demo',
    { Path: 'C:\\Tools' },
    'ignore'
  );

  assert.deepEqual(calls[0].args, args);
  assert.equal(calls[0].options.shell, undefined);
  assert.equal(calls[0].options.detached, false);
  assert.deepEqual(calls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
});

test('CliProcessRunner exposes a non-detached probe process', () => {
  const calls = [];
  const runner = new CliProcessRunner({
    platform: 'linux',
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return fakeChild();
    },
  });
  runner.spawnProbeProcess('codex', ['--version'], {
    cwd: '/repo',
    env: { PATH: '/usr/bin' },
    stderr: 'pipe',
  });
  assert.equal(calls[0].options.detached, false);
  assert.deepEqual(calls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
});
