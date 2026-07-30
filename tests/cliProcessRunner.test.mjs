import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  CliDiscovery,
  normalizeCommandVersionOutput,
} = require('../.test-dist/cliDiscovery.js');
const { CliProcessRunner } = require('../.test-dist/cliProcessRunner.js');
const { getCliProfile } = require('../.test-dist/cliProfiles.js');

function fakeChild() {
  const child = new EventEmitter();
  child.pid = 41;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => true;
  return child;
}

function waitForProcess(child, runner, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const onStdout = (chunk) => {
      stdout += chunk.toString();
    };
    const onStderr = (chunk) => {
      stderr += chunk.toString();
    };
    const onError = (error) => finish(reject, error);
    const onClose = (code) => finish(resolve, { code, stdout, stderr });
    const timer = setTimeout(() => {
      runner.terminate(child);
      finish(reject, new Error(`timed out waiting ${timeoutMs}ms for fixture process`));
    }, timeoutMs);
    const finish = (settle, value) => {
      clearTimeout(timer);
      child.stdout?.off('data', onStdout);
      child.stderr?.off('data', onStderr);
      child.off('error', onError);
      child.off('close', onClose);
      settle(value);
    };

    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.once('error', onError);
    child.once('close', onClose);
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

function probeChild(pid = 41) {
  const child = jsonChild();
  child.pid = pid;
  child.stderr = new EventEmitter();
  return child;
}

function closeFakeChild(child) {
  child.exitCode = 0;
  child.emit('close', 0);
}

function createWindowsProbeHarness() {
  const probes = [];
  const taskkillArgs = [];
  const runner = new CliProcessRunner({
    platform: 'win32',
    spawn(command, args) {
      if (command === 'taskkill') {
        taskkillArgs.push([...args]);
        const taskkill = fakeChild();
        taskkill.exitCode = 0;
        return taskkill;
      }

      const child = probeChild(100 + probes.length);
      probes.push({ command, args: [...args], child });
      return child;
    },
  });
  return { probes, runner, taskkillArgs };
}

function createDiscovery(processRunner, openCodeClient = { fetchModelOptions: async () => [] }) {
  return new CliDiscovery({
    workspaceRoot: () => process.cwd(),
    openCodeClient,
    processRunner,
  });
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

function completedProbeRunner(responses) {
  return {
    spawnProbeProcess(_command, args) {
      const child = probeChild();
      queueMicrotask(() => {
        const response = responses[args.join(' ')] ?? {};
        if (response.error) child.emit('error', response.error);
        else {
          if (response.stdout) child.stdout.emit('data', Buffer.from(response.stdout));
          if (response.stderr) child.stderr.emit('data', Buffer.from(response.stderr));
          child.emit('close', response.code ?? 0);
        }
      });
      return child;
    },
    terminate() {},
  };
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

test('waitForProcess rejects and terminates the process tree after a bounded timeout', async () => {
  const child = probeChild();
  let terminated;
  const waiting = waitForProcess(
    child,
    {
      terminate(proc) {
        terminated = proc;
      },
    },
    25
  );

  assert.equal(await settlementWithin(waiting, 50), 'rejected');
  assert.equal(terminated, child);
});

test('CliDiscovery revalidates an unusable cached command and evicts explicit cache entries', async () => {
  const discovery = createDiscovery(completedProbeRunner({}));
  const usable = new Set(['/bin/first', '/bin/second']);
  const lookups = [];
  discovery.isUsableCommandPath = async (candidate) => usable.has(candidate);
  discovery.lookupCommandInPath = async () => {
    lookups.push('path');
    return lookups.length === 1 ? '/bin/first' : '/bin/second';
  };
  discovery.lookupCommandInLoginShell = async () => undefined;

  assert.equal(await discovery.resolveCommandPath('opencode'), '/bin/first');
  usable.delete('/bin/first');
  assert.equal(await discovery.resolveCommandPath('opencode'), '/bin/second');
  discovery.evictCommandPath('opencode');
  assert.equal(await discovery.resolveCommandPath('opencode'), '/bin/second');
  assert.equal(lookups.length, 3);
});

test('CliDiscovery keeps OpenCode discovery observational when agent and model probes fail', async () => {
  const discovery = createDiscovery(
    completedProbeRunner({
      '--version': { stdout: 'OpenCode v1.2.3\n' },
      'debug config': { error: new Error('debug config unavailable') },
      models: { error: new Error('models unavailable') },
    })
  );
  discovery.resolveCommandPath = async () => '/bin/opencode';

  const profiles = await discovery.getProfilesWithStatus([getCliProfile('opencode')], { force: true });

  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].installed, true);
  assert.equal(profiles[0].version, '1.2.3');
  assert.equal(profiles[0].configuredModel, undefined);
  assert.deepEqual(profiles[0].promptArgs, ['run', '--format', 'json']);
});

test('CliDiscovery exposes the configured OpenCode model as observation without launch overrides', async () => {
  const discovery = createDiscovery(
    completedProbeRunner({
      '--version': { stdout: 'OpenCode 1.2.3\n' },
      'debug config': {
        stdout: JSON.stringify({ default_model: 'acme/fast', default_agent: 'build', agent: {} }),
      },
      models: { stdout: 'acme/fast\nacme/accurate\n' },
    })
  );
  discovery.resolveCommandPath = async () => '/bin/opencode';

  const [profile] = await discovery.getProfilesWithStatus([getCliProfile('opencode')], {
    force: true,
  });

  assert.deepEqual(profile.configuredModel, { id: 'acme/fast', label: 'acme/fast' });
  assert.deepEqual(profile.promptArgs, ['run', '--format', 'json']);
  assert.equal(profile.env, undefined);
});

test('version normalization strips ANSI, requires a dotted version, and bounds prerelease text', () => {
  assert.equal(normalizeCommandVersionOutput('\u001b[32mOpenCode v1.2.3-beta.1\u001b[0m'), '1.2.3-beta.1');
  assert.equal(normalizeCommandVersionOutput('release 42'), undefined);
  assert.equal(normalizeCommandVersionOutput(`v1.2.3-${'a'.repeat(65)}`), '1.2.3');
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

async function waitForFile(filePath, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(filePath)) {
      return readFileSync(filePath, 'utf8');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`fixture did not create ${filePath} within ${timeoutMs}ms`);
}

function forceKillWindowsPid(pid) {
  try {
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch {
    // Process may already be dead.
  }
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

test('CliProcessRunner cancels forced tree termination after the process closes', async () => {
  const taskkillArgs = [];
  const runner = new CliProcessRunner({
    platform: 'win32',
    spawn(command, args) {
      assert.equal(command, 'taskkill');
      taskkillArgs.push([...args]);
      const taskkill = fakeChild();
      taskkill.exitCode = 0;
      return taskkill;
    },
  });
  const child = fakeChild();

  runner.terminate(child);
  closeFakeChild(child);
  await new Promise((resolve) => setTimeout(resolve, 1600));

  assert.deepEqual(taskkillArgs, [['/pid', '41', '/T']]);
});

test('CliDiscovery tree-terminates a debug-config probe that exceeds its output limit', async () => {
  const harness = createWindowsProbeHarness();
  const discovery = createDiscovery(harness.runner);
  const result = discovery.getOpenCodeAgentModesFromDebugConfig('opencode', process.cwd());
  const probe = harness.probes[0].child;

  try {
    probe.stdout.emit('data', Buffer.alloc(2_000_001));
    await result;
    assert.deepEqual(harness.taskkillArgs, [['/pid', '100', '/T']]);
  } finally {
    closeFakeChild(probe);
  }
});

test('CliDiscovery tree-terminates a model probe that exceeds its output limit', async () => {
  const harness = createWindowsProbeHarness();
  const discovery = createDiscovery(harness.runner);
  const result = discovery.getOpenCodeModelOptions('opencode');
  const probe = harness.probes[0].child;

  try {
    probe.stdout.emit('data', Buffer.alloc(1_000_001));
    await result;
    assert.deepEqual(harness.taskkillArgs, [['/pid', '100', '/T']]);
  } finally {
    closeFakeChild(probe);
  }
});

test('CliDiscovery tree-terminates a version probe after its timeout', async () => {
  const harness = createWindowsProbeHarness();
  const discovery = createDiscovery(harness.runner);
  discovery.resolveCommandPath = async () => 'codex';
  const result = discovery.getCommandVersion({ command: 'codex' });

  await Promise.resolve();
  const probe = harness.probes[0].child;
  try {
    assert.equal(await result, undefined);
    assert.deepEqual(harness.taskkillArgs, [['/pid', '100', '/T']]);
  } finally {
    closeFakeChild(probe);
  }
});

test('CliDiscovery bounds version probe output and tree-terminates the oversized process', async () => {
  const harness = createWindowsProbeHarness();
  const discovery = createDiscovery(harness.runner);
  discovery.resolveCommandPath = async () => 'codex';
  const result = discovery.getCommandVersion({ command: 'codex' });

  await Promise.resolve();
  const probe = harness.probes[0].child;
  try {
    probe.stdout.emit('data', Buffer.alloc(32_769, 'x'));
    assert.equal(await result, undefined);
    assert.deepEqual(harness.taskkillArgs, [['/pid', '100', '/T']]);
  } finally {
    closeFakeChild(probe);
  }
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
      const result = await waitForProcess(child, runner);
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

test(
  'CliDiscovery timeout terminates descendants of an npm-style Windows probe shim',
  { skip: process.platform !== 'win32', timeout: 15_000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'agents gui probe 中文 '));
    const fixturePath = join(root, 'fixture.mjs');
    const shimPath = join(root, 'opencode.cmd');
    const descendantPidPath = join(root, 'probe-child.pid');
    writeFileSync(
      fixturePath,
      [
        "import { spawn } from 'node:child_process';",
        "import { writeFileSync } from 'node:fs';",
        "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {",
        "  stdio: 'ignore',",
        '  windowsHide: true,',
        '});',
        "writeFileSync(new URL('probe-child.pid', import.meta.url), String(child.pid));",
        "child.once('exit', () => process.exit(0));",
        'setInterval(() => {}, 1000);',
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
    const discovery = new CliDiscovery({
      workspaceRoot: () => root,
      openCodeClient: { fetchModelOptions: async () => [] },
      processRunner: runner,
    });
    let descendantPid;
    try {
      const probe = discovery.getOpenCodeAgentModesFromDebugConfig(shimPath, root);
      descendantPid = Number((await waitForFile(descendantPidPath)).trim());
      assert.ok(Number.isInteger(descendantPid));
      await probe;
      await waitForWindowsPidToExit(descendantPid);
    } finally {
      if (Number.isInteger(descendantPid)) {
        forceKillWindowsPid(descendantPid);
      }
      rmSync(root, { recursive: true, force: true });
    }
  }
);
