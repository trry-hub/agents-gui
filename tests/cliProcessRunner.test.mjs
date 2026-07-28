import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

function waitForProcess(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function waitForFirstJsonLine(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    const onError = (error) => finish(reject, error);
    const onClose = (code) =>
      finish(reject, new Error(`process closed before emitting JSON (exit code ${code})`));
    const onData = (chunk) => {
      stdout += chunk.toString();
      const newline = stdout.indexOf('\n');
      if (newline >= 0) {
        try {
          finish(resolve, JSON.parse(stdout.slice(0, newline)));
        } catch (error) {
          finish(reject, error);
        }
      }
    };
    const timer = setTimeout(
      () => finish(reject, new Error(`timed out waiting ${timeoutMs}ms for fixture JSON`)),
      timeoutMs
    );
    const finish = (settle, value) => {
      clearTimeout(timer);
      child.off('error', onError);
      child.off('close', onClose);
      child.stdout?.off('data', onData);
      settle(value);
    };

    child.once('error', onError);
    child.once('close', onClose);
    child.stdout?.on('data', onData);
  });
}

function jsonChild() {
  const child = fakeChild();
  child.stdout = new EventEmitter();
  return child;
}

async function settlementWithin(promise, timeoutMs) {
  return Promise.race([
    promise.then(
      () => 'resolved',
      () => 'rejected'
    ),
    new Promise((resolve) => setTimeout(resolve, timeoutMs, 'timed out')),
  ]);
}

test('waitForFirstJsonLine rejects when the process closes before emitting JSON', async () => {
  const child = jsonChild();
  const waiting = waitForFirstJsonLine(child);
  child.emit('close', 1);

  assert.equal(await settlementWithin(waiting, 25), 'rejected');
});

test('waitForFirstJsonLine rejects when JSON is not emitted before its timeout', async () => {
  const child = jsonChild();
  const waiting = waitForFirstJsonLine(child, 25);

  assert.equal(await settlementWithin(waiting, 50), 'rejected');
});

async function waitForWindowsPidToExit(pid, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    let output = '';
    try {
      output = execFileSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
      });
    } catch {
      return;
    }
    if (!new RegExp(`"${pid}"(?:,|$)`).test(output)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`child PID ${pid} survived CliProcessRunner.terminate()`);
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

test(
  'CliProcessRunner executes npm-style Windows shims without interpreting arguments',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'agents gui 中文 '));
    const fixturePath = join(root, 'fixture.mjs');
    const shimPath = join(root, 'opencode.cmd');
    writeFileSync(
      fixturePath,
      [
        "import { spawn } from 'node:child_process';",
        'const args = process.argv.slice(2);',
        "if (args[0] === 'spawn-child') {",
        "  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {",
        "    stdio: 'ignore',",
        '    windowsHide: true,',
        '  });',
        '  process.stdout.write(`${JSON.stringify({ args, childPid: child.pid })}\\n`);',
        '  setInterval(() => {}, 1000);',
        '} else {',
        '  process.stdout.write(`${JSON.stringify(args)}\\n`);',
        "  process.stderr.write('fixture-stderr\\n');",
        '}',
      ].join('\n'),
      'utf8'
    );
    writeFileSync(
      shimPath,
      [
        '@ECHO off',
        'SETLOCAL',
        'SET "_prog=%~dp0node.exe"',
        'IF NOT EXIST "%_prog%" SET "_prog=node"',
        '"%_prog%" "%~dp0fixture.mjs" %*',
      ].join('\r\n'),
      'utf8'
    );

    const runner = new CliProcessRunner();
    const env = { ...process.env, Path: process.env.Path || process.env.PATH };
    const run = async (args) => {
      const child = runner.spawnPromptProcess(shimPath, args, root, env, 'ignore');
      const result = await waitForProcess(child);
      assert.equal(result.code, 0);
      assert.equal(result.stderr.trim(), 'fixture-stderr');
      assert.deepEqual(JSON.parse(result.stdout.trim()), args);
    };

    let longLivedChild;
    try {
      await run([
        'run',
        '--attach',
        'http://127.0.0.1:4096',
        '中文 multiline\nsecond line "quoted" & | ^ % !',
      ]);
      await run(['serve', '--hostname', '127.0.0.1', '--port', '4096']);

      longLivedChild = runner.spawnPromptProcess(shimPath, ['spawn-child'], root, env, 'ignore');
      const firstLine = await waitForFirstJsonLine(longLivedChild);
      assert.ok(Number.isInteger(firstLine.childPid));
      runner.terminate(longLivedChild);
      await waitForWindowsPidToExit(firstLine.childPid);
    } finally {
      if (longLivedChild && longLivedChild.exitCode === null) {
        runner.terminate(longLivedChild);
      }
      rmSync(root, { recursive: true, force: true });
    }
  }
);
