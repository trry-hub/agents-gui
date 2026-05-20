import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const home = os.homedir();
const augmentedPath = [
  path.join(home, '.local', 'bin'),
  path.join(home, '.nvm', 'versions', 'node', 'v24.15.0', 'bin'),
  process.env.PATH || '',
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
].join(path.delimiter);

const env = {
  ...process.env,
  PATH: augmentedPath,
};

const tmpRoot = os.tmpdir();

const providers = [
  {
    id: 'claude',
    command: 'claude',
    versionArgs: ['--version'],
    smokeArgs: [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode',
      'plan',
      '只回答：OK',
    ],
    timeoutMs: 45_000,
    expected: /OK|text_delta|stream_event/,
  },
  {
    id: 'gemini',
    command: 'gemini',
    versionArgs: ['--version'],
    smokeArgs: ['-p', '只回答：OK', '--skip-trust', '--output-format', 'stream-json'],
    timeoutMs: 45_000,
    expected: /OK|content|text|response/,
    cancelOnAuthPrompt: true,
  },
  {
    id: 'codex',
    command: 'codex',
    versionArgs: ['--version'],
    smokeArgs: [
      '-a',
      'never',
      'exec',
      '--color',
      'never',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--model',
      'gpt-5.4',
      '只回答：OK',
    ],
    timeoutMs: 90_000,
    expected: /\bOK\b/,
  },
  {
    id: 'opencode',
    command: 'opencode',
    versionArgs: ['--version'],
    smokeArgs: ['run', '--format', 'json', '--thinking', '--model', 'opencode/minimax-m2.5-free', '只回答：OK'],
    timeoutMs: 45_000,
    expected: /OK|message\.part|text|reasoning/,
    env: {
      OPENCODE_DB: path.join(tmpRoot, `agents-gui-qa-opencode-${process.pid}.db`),
      OMO_DISABLE_POSTHOG: '1',
      OMO_SEND_ANONYMOUS_TELEMETRY: '0',
    },
  },
  {
    id: 'goose',
    command: 'goose',
    versionArgs: ['--version'],
    smokeArgs: ['--version'],
    timeoutMs: 8_000,
    expected: /./,
    optional: true,
  },
  {
    id: 'aider',
    command: 'aider',
    versionArgs: ['--version'],
    smokeArgs: ['--version'],
    timeoutMs: 8_000,
    expected: /./,
    optional: true,
  },
];

async function main() {
  const results = [];
  for (const provider of providers) {
    const version = await run(provider.command, provider.versionArgs, 8_000);
    const installed = version.code === 0;
    const result = {
      id: provider.id,
      installed,
      version: summarize(version),
      smoke: null,
    };

    if (installed) {
      const smoke = await run(provider.command, provider.smokeArgs, {
        timeoutMs: provider.timeoutMs,
        env: provider.env,
        cancelOnAuthPrompt: provider.cancelOnAuthPrompt,
      });
      result.smoke = {
        ...summarize(smoke),
        firstOutputMs: smoke.firstOutputMs,
        outcome: classifySmokeOutcome(smoke),
        matchedExpected: provider.expected.test(`${smoke.stdout}\n${smoke.stderr}`),
      };
    }

    results.push(result);
  }

  console.log(JSON.stringify({ cwd: root, results }, null, 2));
  const failed = results.filter((item) => {
    if (!item.installed) {
      return !providers.find((provider) => provider.id === item.id)?.optional;
    }
    if (!item.smoke) {
      return true;
    }
    return item.smoke.outcome !== 'ok' || !item.smoke.matchedExpected;
  });
  process.exitCode = failed.length ? 1 : 0;
}

function run(command, args, optionsOrTimeout) {
  const options = typeof optionsOrTimeout === 'number'
    ? { timeoutMs: optionsOrTimeout }
    : optionsOrTimeout;
  const timeoutMs = options.timeoutMs;

  return new Promise((resolve) => {
    const startedAt = Date.now();
    let firstOutputMs;
    const child = spawn(command, args, {
      cwd: root,
      env: {
        ...env,
        ...(options.env || {}),
      },
      stdio: [options.cancelOnAuthPrompt ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let authPrompted = false;
    let forceKillTimer;
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateChild(child);
    }, timeoutMs);

    const onOutput = (text) => {
      firstOutputMs ??= Date.now() - startedAt;
      if (
        options.cancelOnAuthPrompt &&
        !authPrompted &&
        /Opening authentication page|Do you want to continue\?/i.test(text)
      ) {
        authPrompted = true;
        child.stdin?.write('n\n');
        child.stdin?.end();
        terminateChild(child);
      }
    };

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      onOutput(text);
      stdout += text;
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      onOutput(text);
      stderr += text;
    });
    child.on('error', (error) => {
      stderr += error.message;
      finish('error', -1);
    });
    child.on('close', (code) => {
      const status = timedOut ? 'timeout' : authPrompted ? 'auth-prompt' : 'close';
      finish(status, code ?? -1);
    });

    function finish(status, code = child.exitCode) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceKillTimer);
      resolve({
        status,
        code,
        stdout,
        stderr,
        firstOutputMs,
        durationMs: Date.now() - startedAt,
      });
    }

    function terminateChild(proc) {
      if (!proc.pid) {
        return;
      }
      try {
        if (process.platform !== 'win32') {
          process.kill(-proc.pid, 'SIGTERM');
        } else {
          proc.kill('SIGTERM');
        }
      } catch {
        try {
          proc.kill('SIGTERM');
        } catch {
          // ignore
        }
      }
      forceKillTimer = setTimeout(() => {
        try {
          if (process.platform !== 'win32') {
            process.kill(-proc.pid, 'SIGKILL');
          } else {
            proc.kill('SIGKILL');
          }
        } catch {
          // ignore
        }
        if (timedOut) {
          finish('timeout', proc.exitCode ?? -1);
        }
      }, 3_000);
    }
  });
}

function summarize(result) {
  return {
    status: result.status,
    code: result.code,
    durationMs: result.durationMs,
    stdout: compact(result.stdout),
    stderr: compact(result.stderr),
  };
}

function classifySmokeOutcome(result) {
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status === 'auth-prompt' || /Opening authentication page|Do you want to continue\?/i.test(output)) {
    return 'auth-required';
  }
  if (result.status === 'timeout') {
    return 'timeout';
  }
  if (/PRAGMA wal_checkpoint|database is locked/i.test(output)) {
    return 'opencode-db-lock';
  }
  if (/ProviderModelNotFoundError|Model not found/i.test(output)) {
    return 'cli-error';
  }
  if (result.code === 0 && /\bOK\b|text_delta|message\.part|content_block_delta|"delta"\s*:\s*true/i.test(output)) {
    return 'ok';
  }
  if (
    /Operation not permitted|Network error|ENOTFOUND|ECONNREFUSED|Failed to connect|remote plugin sync request.*failed/i.test(output)
  ) {
    return 'environment-or-network';
  }
  if (result.code === 0) {
    return 'ok';
  }
  return 'cli-error';
}

function compact(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 600);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
