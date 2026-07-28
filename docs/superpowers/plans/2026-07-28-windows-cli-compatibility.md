# Windows CLI Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every supported system-installed Agent CLI installable, discoverable, launchable, inspectable, and stoppable on Windows 10/11 without exposing prompt text to shell interpolation.

**Architecture:** Keep `CliManager` and `CliDiscovery` as the orchestration layers, but route every child process through one injectable `CliProcessRunner` backed by `cross-spawn`. Add pure platform-aware helpers for CLI lookup, OpenCode filesystem paths, and Windows proxy parsing so Windows behavior can be tested on every host, then prove `.cmd` execution and process-tree shutdown on a real Windows CI runner.

**Tech Stack:** TypeScript 5, Node.js 18/20 `child_process` contracts, `cross-spawn` 7.0.6, `@types/cross-spawn` 6.0.6, Node's built-in test runner, esbuild, GitHub Actions.

## Global Constraints

- Support Windows 10 and Windows 11 in VS Code Desktop.
- Support Windows PowerShell 5, PowerShell 7, and Command Prompt.
- Support x64 and ARM64; WSL and Windows Server remain out of scope.
- Preserve support for Claude Code, Gemini CLI, Codex CLI, OpenCode, Goose, and Aider.
- Never concatenate a prompt, model, workspace path, or user argument into a shell command string.
- Do not enable global `shell: true` in extension runtime code.
- Preserve the existing macOS/Linux XDG, login-shell discovery, detached-process, and signal behavior.
- Preserve Windows `taskkill /PID <pid> /T` and forced `/F` process-tree shutdown.
- Keep proxy/config discovery non-fatal and do not log prompts, API keys, proxy credentials, or provider secrets.
- Keep the VSIX Universal and platform-unrestricted.

---

### Task 1: Platform-aware CLI lookup paths and `where` result selection

**Files:**
- Create: `tests/cliPathResolver.test.mjs`
- Modify: `src/cliPathResolver.ts`
- Modify: `src/cliDiscovery.ts`
- Modify: `src/cliManager.ts`
- Modify: `tests/promptBuilder.test.mjs`

**Interfaces:**
- Produces: `CliLookupPathOptions { env?: NodeJS.ProcessEnv; homeDir?: string; platform?: NodeJS.Platform }`
- Produces: `buildCliLookupPath(options?: CliLookupPathOptions): string`
- Produces: `mergePathEntries(entries: Array<string | undefined>, platform?: NodeJS.Platform): string`
- Produces: `normalizeCommandPathOutput(output: string, platform?: NodeJS.Platform): string | undefined`
- Produces: `withCliLookupPath(env, extraEntries?, platform?): NodeJS.ProcessEnv`
- Consumes later: `CliDiscovery` and `CliManager` use these helpers without reading only `process.env.PATH`/`HOME`.

- [ ] **Step 1: Write failing pure tests for Windows PATH construction**

Create `tests/cliPathResolver.test.mjs` with:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildCliLookupPath,
  mergePathEntries,
  normalizeCommandPathOutput,
  withCliLookupPath,
} = require('../.test-dist/cliPathResolver.js');

test('buildCliLookupPath adds and deduplicates Windows user CLI locations', () => {
  const result = buildCliLookupPath({
    platform: 'win32',
    homeDir: 'C:\\Users\\Agent',
    env: {
      Path: 'C:\\Existing;C:\\USERS\\AGENT\\AppData\\Roaming\\npm',
      APPDATA: 'C:\\Users\\Agent\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\Agent\\AppData\\Local',
      ProgramData: 'C:\\ProgramData',
      USERPROFILE: 'C:\\Users\\Agent',
    },
  }).split(';');

  assert.equal(result[0], 'C:\\Existing');
  assert.equal(
    result.filter((entry) => entry.toLowerCase().endsWith('\\appdata\\roaming\\npm')).length,
    1
  );
  assert.ok(result.includes('C:\\Users\\Agent\\AppData\\Local\\Microsoft\\WindowsApps'));
  assert.ok(result.includes('C:\\Users\\Agent\\scoop\\shims'));
  assert.ok(result.includes('C:\\ProgramData\\chocolatey\\bin'));
  assert.ok(result.includes('C:\\Users\\Agent\\.local\\bin'));
  assert.ok(result.includes('C:\\Users\\Agent\\AppData\\Roaming\\Python\\Scripts'));
  assert.ok(result.includes('C:\\Users\\Agent\\AppData\\Local\\Programs\\Python\\Scripts'));
});

test('mergePathEntries uses Windows delimiter and case-insensitive first-match precedence', () => {
  assert.equal(
    mergePathEntries(['C:\\One;C:\\Two', 'c:\\one', 'C:\\Three'], 'win32'),
    'C:\\One;C:\\Two;C:\\Three'
  );
});

test('withCliLookupPath emits one canonical PATH key on Windows', () => {
  const env = withCliLookupPath(
    { Path: 'C:\\Existing', FOO: 'bar' },
    ['C:\\Resolved Command'],
    'win32'
  );
  assert.equal(env.PATH, 'C:\\Resolved Command;C:\\Existing');
  assert.equal(env.Path, undefined);
  assert.equal(env.FOO, 'bar');
});
```

- [ ] **Step 2: Run the new tests and verify the current positional API fails**

Run:

```bash
npm run build:test
node --test tests/cliPathResolver.test.mjs
```

Expected: FAIL because `buildCliLookupPath()` does not accept an options object and Windows candidates are absent.

- [ ] **Step 3: Add failing tests for Windows drive, UNC, and extension preference**

Append:

```js
test('normalizeCommandPathOutput prefers native Windows executables over shims', () => {
  const output = [
    'C:\\Users\\Agent\\AppData\\Roaming\\npm\\codex.cmd',
    'C:\\Tools\\codex.exe',
    '\\\\server\\share\\codex.bat',
  ].join('\r\n');
  assert.equal(normalizeCommandPathOutput(output, 'win32'), 'C:\\Tools\\codex.exe');
});

test('normalizeCommandPathOutput accepts UNC Windows command paths', () => {
  assert.equal(
    normalizeCommandPathOutput('noise\r\n\\\\server\\share\\opencode.cmd\r\n', 'win32'),
    '\\\\server\\share\\opencode.cmd'
  );
});

test('normalizeCommandPathOutput preserves first-match behavior on POSIX', () => {
  assert.equal(
    normalizeCommandPathOutput('noise\n/usr/local/bin/codex\n/usr/bin/codex\n', 'linux'),
    '/usr/local/bin/codex'
  );
});
```

- [ ] **Step 4: Implement the platform-aware resolver**

Replace the lookup-path implementation in `src/cliPathResolver.ts` with the following public shape and helpers while retaining `shellQuote()` and `getLoginShellLookupArgs()` unchanged:

```ts
export interface CliLookupPathOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
}

export function buildCliLookupPath(options: CliLookupPathOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const homeDir =
    options.homeDir || readEnvValue(env, 'USERPROFILE') || readEnvValue(env, 'HOME') || '';
  const envPath = readEnvValue(env, 'PATH') || '';

  if (platform === 'win32') {
    const appData = readEnvValue(env, 'APPDATA');
    const localAppData = readEnvValue(env, 'LOCALAPPDATA');
    const programData = readEnvValue(env, 'ProgramData');
    return mergePathEntries(
      [
        envPath,
        appData && pathApi.join(appData, 'npm'),
        localAppData && pathApi.join(localAppData, 'Programs'),
        localAppData && pathApi.join(localAppData, 'Microsoft', 'WindowsApps'),
        homeDir && pathApi.join(homeDir, 'scoop', 'shims'),
        programData && pathApi.join(programData, 'chocolatey', 'bin'),
        homeDir && pathApi.join(homeDir, '.local', 'bin'),
        appData && pathApi.join(appData, 'Python', 'Scripts'),
        localAppData && pathApi.join(localAppData, 'Programs', 'Python', 'Scripts'),
      ],
      platform
    );
  }

  return mergePathEntries(
    [
      envPath,
      homeDir && pathApi.join(homeDir, '.local', 'bin'),
      homeDir && pathApi.join(homeDir, '.npm-global', 'bin'),
      homeDir && pathApi.join(homeDir, '.yarn', 'bin'),
      homeDir && pathApi.join(homeDir, '.bun', 'bin'),
      homeDir && pathApi.join(homeDir, '.cargo', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ],
    platform
  );
}

export function mergePathEntries(
  entries: Array<string | undefined>,
  platform: NodeJS.Platform = process.platform
): string {
  const delimiter = platform === 'win32' ? ';' : path.delimiter;
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const rawEntry of entries) {
    for (const rawPart of String(rawEntry || '').split(delimiter)) {
      const value = rawPart.trim();
      const key = platform === 'win32' ? value.toLowerCase() : value;
      if (!value || seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(value);
    }
  }

  return merged.join(delimiter);
}

export function withCliLookupPath(
  sourceEnv: NodeJS.ProcessEnv = process.env,
  extraEntries: Array<string | undefined> = [],
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (key.toLowerCase() !== 'path') {
      env[key] = value;
    }
  }
  env.PATH = mergePathEntries(
    [
      ...extraEntries,
      buildCliLookupPath({
        env: sourceEnv,
        platform,
      }),
    ],
    platform
  );
  return env;
}

function readEnvValue(env: NodeJS.ProcessEnv, name: string): string {
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? String(env[key] || '').trim() : '';
}
```

Implement `normalizeCommandPathOutput()` with stable extension ranking:

```ts
export function normalizeCommandPathOutput(
  output: string,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  const candidates = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => isCommandPath(line, platform));

  if (platform !== 'win32') {
    return candidates[0];
  }

  return candidates
    .map((value, index) => ({ value, index, rank: windowsExtensionRank(value) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)[0]?.value;
}

function isCommandPath(value: string, platform: NodeJS.Platform): boolean {
  if (platform === 'win32') {
    return path.win32.isAbsolute(value) || /^\\\\[^\\]+\\[^\\]+/.test(value);
  }
  return path.posix.isAbsolute(value);
}

function windowsExtensionRank(value: string): number {
  switch (path.win32.extname(value).toLowerCase()) {
    case '.exe':
    case '.com':
      return 0;
    case '.cmd':
      return 1;
    case '.bat':
      return 2;
    default:
      return 3;
  }
}
```

- [ ] **Step 5: Update every lookup-PATH caller**

Import `withCliLookupPath` in `src/cliDiscovery.ts` and `src/cliManager.ts`. Replace environment blocks of the form:

```ts
{
  ...process.env,
  PATH: mergePathEntries([commandDir, buildCliLookupPath(process.env.PATH, process.env.HOME)]),
  ...overrides,
}
```

with:

```ts
withCliLookupPath(
  {
    ...process.env,
    ...overrides,
  },
  [commandDir]
)
```

Use the same helper without `commandDir` for `where`/`which` and login-shell probes. Pass `process.platform` to `normalizeCommandPathOutput()` inside discovery. This prevents both `Path` and `PATH` from being forwarded to Windows child processes.

- [ ] **Step 6: Expand installation-hint assertions for all npm providers**

In `tests/promptBuilder.test.mjs`, extend the existing Windows installation test with:

```js
const gemini = getCliProfile('gemini');
const codex = getCliProfile('codex');
assert.equal(resolveCliInstallHint(gemini, 'win32'), 'npm install -g @google/gemini-cli');
assert.equal(resolveCliInstallHint(codex, 'win32'), 'npm install -g @openai/codex');
```

- [ ] **Step 7: Run focused and regression tests**

Run:

```bash
npm run build:test
node --test tests/cliPathResolver.test.mjs tests/promptBuilder.test.mjs
```

Expected: PASS with zero failures.

- [ ] **Step 8: Commit the lookup-path increment**

```bash
git add src/cliPathResolver.ts src/cliDiscovery.ts src/cliManager.ts tests/cliPathResolver.test.mjs tests/promptBuilder.test.mjs
git commit -m "fix: resolve Windows CLI lookup paths"
```

---

### Task 2: Centralize CLI spawning through `cross-spawn`

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/cliProcessRunner.ts`
- Modify: `src/cliDiscovery.ts`
- Modify: `src/cliManager.ts`
- Create: `tests/cliProcessRunner.test.mjs`
- Modify: `tests/extensionActivation.test.mjs`
- Modify: `tests/promptBuilder.test.mjs`

**Interfaces:**
- Produces: `CliSpawn(command, args, options): ChildProcess`
- Produces: `CliProcessRunnerOptions { spawn?: CliSpawn; platform?: NodeJS.Platform }`
- Produces: `CliProbeProcessOptions { cwd?: string; env: NodeJS.ProcessEnv; stderr?: 'ignore' | 'pipe' }`
- Produces: `CliProcessRunner.spawnProbeProcess(command, args, options): ChildProcess`
- Consumes: `CliManager` injects one runner into `CliDiscovery`.

- [ ] **Step 1: Add a failing runner contract test**

Create `tests/cliProcessRunner.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the runner test and verify constructor/probe failures**

Run:

```bash
npm run build:test
node --test tests/cliProcessRunner.test.mjs
```

Expected: FAIL because the runner does not accept injected options and has no `spawnProbeProcess()`.

- [ ] **Step 3: Declare direct runtime and type dependencies**

Run:

```bash
npm install --save-exact cross-spawn@7.0.6
npm install --save-dev --save-exact @types/cross-spawn@6.0.6
```

Confirm `package.json` contains `cross-spawn` under `dependencies`, `@types/cross-spawn` under `devDependencies`, and `package-lock.json` marks the root dependency entries.

- [ ] **Step 4: Implement the injectable centralized runner**

Refactor `src/cliProcessRunner.ts` to use this shape:

```ts
import crossSpawn from 'cross-spawn';
import type { ChildProcess, SpawnOptions, StdioOptions } from 'child_process';

export type CliProcessStdin = 'ignore' | 'pipe';
export type CliSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

export interface CliProcessRunnerOptions {
  spawn?: CliSpawn;
  platform?: NodeJS.Platform;
}

export interface CliProbeProcessOptions {
  cwd?: string;
  env: NodeJS.ProcessEnv;
  stderr?: 'ignore' | 'pipe';
}

export class CliProcessRunner {
  private forceKillTimers = new WeakMap<ChildProcess, NodeJS.Timeout>();
  private readonly spawnImpl: CliSpawn;
  private readonly platform: NodeJS.Platform;

  constructor(options: CliProcessRunnerOptions = {}) {
    this.spawnImpl = options.spawn ?? crossSpawn;
    this.platform = options.platform ?? process.platform;
  }

  spawnPromptProcess(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    stdin: CliProcessStdin
  ): ChildProcess {
    return this.spawnProcess(command, args, cwd, env, [stdin, 'pipe', 'pipe'], true);
  }

  spawnBackgroundProcess(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv
  ): ChildProcess {
    return this.spawnProcess(command, args, cwd, env, ['ignore', 'ignore', 'ignore'], true);
  }

  spawnProbeProcess(
    command: string,
    args: string[],
    options: CliProbeProcessOptions
  ): ChildProcess {
    return this.spawnProcess(
      command,
      args,
      options.cwd,
      options.env,
      ['ignore', 'pipe', options.stderr ?? 'ignore'],
      false
    );
  }

  private spawnProcess(
    command: string,
    args: string[],
    cwd: string | undefined,
    env: NodeJS.ProcessEnv,
    stdio: StdioOptions,
    detachProcessGroup: boolean
  ): ChildProcess {
    return this.spawnImpl(command, args, {
      cwd,
      env,
      detached: detachProcessGroup && this.platform !== 'win32',
      stdio,
      windowsHide: true,
    });
  }
}
```

Keep the existing `terminate()`, grace timer, and `isRunning()`. Replace `killTree()` with:

```ts
killTree(proc: ChildProcess, signal: NodeJS.Signals): void {
  if (!proc.pid) {
    try {
      proc.kill(signal);
    } catch {
      // Process may already be dead.
    }
    return;
  }

  if (this.platform === 'win32') {
    const args = ['/pid', String(proc.pid), '/T'];
    if (signal === 'SIGKILL') {
      args.push('/F');
    }
    try {
      this.spawnImpl('taskkill', args, {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      try {
        proc.kill(signal);
      } catch {
        // Process may already be dead.
      }
    }
    return;
  }

  try {
    process.kill(-proc.pid, signal);
  } catch {
    try {
      proc.kill(signal);
    } catch {
      // Process may already be dead.
    }
  }
}
```

Do not add a shell option.

- [ ] **Step 5: Route discovery probes through the shared runner**

Extend `CliDiscoveryOptions`:

```ts
interface CliDiscoveryOptions {
  workspaceRoot(): string;
  openCodeClient: OpenCodeServerClient;
  openCodeLocalState?: OpenCodeLocalState;
  processRunner?: CliProcessRunner;
}
```

Add:

```ts
private readonly processRunner: CliProcessRunner;

constructor(private readonly options: CliDiscoveryOptions) {
  this.openCodeLocalState = options.openCodeLocalState ?? new OpenCodeLocalState();
  this.processRunner = options.processRunner ?? new CliProcessRunner();
}
```

Replace all five `spawn()` calls in `src/cliDiscovery.ts` with `spawnProbeProcess()`:

```ts
const proc = this.processRunner.spawnProbeProcess(command, args, {
  cwd,
  env,
  stderr: captureStderr ? 'pipe' : 'ignore',
});
```

Use the probe API for `where`/`which`, login-shell lookup, OpenCode `debug config`, OpenCode `models`, and provider version queries. On an `ENOENT` probe error for an already cached provider command, call `evictCommandPath(profile.command)` before resolving the probe's normal fallback value.

In `src/cliManager.ts`, inject the existing runner:

```ts
private readonly cliDiscovery = new CliDiscovery({
  workspaceRoot: () => this.getWorkspaceRoot(),
  openCodeClient: this.openCodeClient,
  processRunner: this.processRunner,
});
```

- [ ] **Step 6: Update architecture assertions**

In `tests/extensionActivation.test.mjs` and `tests/promptBuilder.test.mjs`, assert:

```js
assert.match(cliProcessRunnerSource, /from 'cross-spawn'/);
assert.match(cliProcessRunnerSource, /spawnProbeProcess/);
assert.match(cliDiscoverySource, /this\.processRunner\.spawnProbeProcess/);
assert.doesNotMatch(cliDiscoverySource, /from 'child_process'/);
assert.doesNotMatch(cliProcessRunnerSource, /shell:\s*true/);
```

Replace the old hard-coded taskkill assertion with:

```js
assert.match(cliProcessRunnerSource, /this\.spawnImpl\('taskkill', args/);
```

- [ ] **Step 7: Run runner and architecture tests**

Run:

```bash
npm run build:test
node --test tests/cliProcessRunner.test.mjs tests/extensionActivation.test.mjs tests/promptBuilder.test.mjs
```

Expected: PASS with zero failures.

- [ ] **Step 8: Commit the process-launch increment**

```bash
git add package.json package-lock.json src/cliProcessRunner.ts src/cliDiscovery.ts src/cliManager.ts tests/cliProcessRunner.test.mjs tests/extensionActivation.test.mjs tests/promptBuilder.test.mjs
git commit -m "fix: launch Windows CLI shims safely"
```

---

### Task 3: Share OpenCode config, state, and cache path resolution

**Files:**
- Create: `src/openCodePaths.ts`
- Create: `tests/openCodePaths.test.mjs`
- Modify: `src/openCodeConfigSync.ts`
- Modify: `src/openCodeLocalState.ts`
- Modify: `src/mcpConfig.ts`
- Modify: `tests/openCodeConfigSync.test.mjs`
- Modify: `tests/openCodeLocalState.test.mjs`
- Modify: `tests/mcpConfig.test.mjs`

**Interfaces:**
- Produces: `OpenCodePathOptions { env?, homeDir?, platform?, exists? }`
- Produces: `OpenCodePaths { configPath, stateHome, cacheHome, modelStatePath, modelMetadataPath }`
- Produces: `resolveOpenCodePaths(options?: OpenCodePathOptions): OpenCodePaths`
- Consumes: `OpenCodeConfigSync`, `OpenCodeLocalState`, and MCP config synchronization.

- [ ] **Step 1: Write failing platform-path tests**

Create `tests/openCodePaths.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveOpenCodePaths } = require('../.test-dist/openCodePaths.js');

test('Windows OpenCode paths prefer existing APPDATA config and LOCALAPPDATA state', () => {
  const existing = new Set(['C:\\Users\\Agent\\AppData\\Roaming\\opencode\\opencode.json']);
  const paths = resolveOpenCodePaths({
    platform: 'win32',
    homeDir: 'C:\\Users\\Agent',
    env: {
      APPDATA: 'C:\\Users\\Agent\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\Agent\\AppData\\Local',
      USERPROFILE: 'C:\\Users\\Agent',
    },
    exists: (candidate) => existing.has(candidate),
  });
  assert.equal(
    paths.configPath,
    'C:\\Users\\Agent\\AppData\\Roaming\\opencode\\opencode.json'
  );
  assert.equal(
    paths.modelStatePath,
    'C:\\Users\\Agent\\AppData\\Local\\opencode\\model.json'
  );
  assert.equal(
    paths.modelMetadataPath,
    'C:\\Users\\Agent\\AppData\\Local\\opencode\\models.json'
  );
});

test('Windows OpenCode paths read an existing legacy config before creating APPDATA config', () => {
  const legacy = 'C:\\Users\\Agent\\.config\\opencode\\opencode.json';
  const paths = resolveOpenCodePaths({
    platform: 'win32',
    homeDir: 'C:\\Users\\Agent',
    env: {
      APPDATA: 'C:\\Users\\Agent\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\Agent\\AppData\\Local',
    },
    exists: (candidate) => candidate === legacy,
  });
  assert.equal(paths.configPath, legacy);
});

test('Windows OpenCode paths create new config under APPDATA when neither file exists', () => {
  const paths = resolveOpenCodePaths({
    platform: 'win32',
    homeDir: 'C:\\Users\\Agent',
    env: {
      APPDATA: 'C:\\Users\\Agent\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\Agent\\AppData\\Local',
    },
    exists: () => false,
  });
  assert.equal(
    paths.configPath,
    'C:\\Users\\Agent\\AppData\\Roaming\\opencode\\opencode.json'
  );
});

test('Linux OpenCode paths preserve XDG config, state, and cache', () => {
  const paths = resolveOpenCodePaths({
    platform: 'linux',
    homeDir: '/home/agent',
    env: {
      XDG_CONFIG_HOME: '/xdg/config',
      XDG_STATE_HOME: '/xdg/state',
      XDG_CACHE_HOME: '/xdg/cache',
    },
    exists: () => false,
  });
  assert.equal(paths.configPath, '/xdg/config/opencode/opencode.json');
  assert.equal(paths.modelStatePath, '/xdg/state/opencode/model.json');
  assert.equal(paths.modelMetadataPath, '/xdg/cache/opencode/models.json');
});
```

- [ ] **Step 2: Run the tests and verify the shared module is missing**

Run:

```bash
npm run build:test
node --test tests/openCodePaths.test.mjs
```

Expected: FAIL because `.test-dist/openCodePaths.js` does not exist.

- [ ] **Step 3: Implement the pure shared resolver**

Create `src/openCodePaths.ts` with:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface OpenCodePathOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
  exists?: (candidate: string) => boolean;
}

export interface OpenCodePaths {
  configPath: string;
  stateHome: string;
  cacheHome: string;
  modelStatePath: string;
  modelMetadataPath: string;
}

export function resolveOpenCodePaths(options: OpenCodePathOptions = {}): OpenCodePaths {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const exists = options.exists ?? fs.existsSync;
  const homeDir = resolveHomeDir(options, env, platform, pathApi);
  const legacyConfigPath = pathApi.join(homeDir, '.config', 'opencode', 'opencode.json');

  const configCandidates =
    platform === 'win32'
      ? [
          joinAbsolute(pathApi, env.APPDATA, 'opencode', 'opencode.json'),
          legacyConfigPath,
        ]
      : [
          joinAbsolute(pathApi, env.XDG_CONFIG_HOME, 'opencode', 'opencode.json'),
          legacyConfigPath,
          platform === 'darwin'
            ? pathApi.join(
                homeDir,
                'Library',
                'Application Support',
                'opencode',
                'opencode.json'
              )
            : undefined,
        ];
  const validConfigCandidates = configCandidates.filter(
    (candidate): candidate is string => Boolean(candidate)
  );
  const configPath =
    validConfigCandidates.find((candidate) => safeExists(exists, candidate)) ??
    validConfigCandidates[0] ??
    legacyConfigPath;

  const localAppData =
    platform === 'win32' ? usableAbsolutePath(env.LOCALAPPDATA, pathApi) : undefined;
  const stateHome =
    platform === 'win32'
      ? localAppData ?? pathApi.join(homeDir, '.local', 'state')
      : usableAbsolutePath(env.XDG_STATE_HOME, pathApi) ??
        pathApi.join(homeDir, '.local', 'state');
  const cacheHome =
    platform === 'win32'
      ? localAppData ?? pathApi.join(homeDir, '.cache')
      : usableAbsolutePath(env.XDG_CACHE_HOME, pathApi) ?? pathApi.join(homeDir, '.cache');

  return {
    configPath,
    stateHome,
    cacheHome,
    modelStatePath: pathApi.join(stateHome, 'opencode', 'model.json'),
    modelMetadataPath: pathApi.join(cacheHome, 'opencode', 'models.json'),
  };
}

function resolveHomeDir(
  options: OpenCodePathOptions,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  pathApi: typeof path.posix | typeof path.win32
): string {
  const candidates =
    platform === 'win32'
      ? [options.homeDir, env.USERPROFILE, env.HOME, os.homedir()]
      : [options.homeDir, env.HOME, os.homedir(), env.USERPROFILE];
  return (
    candidates
      .map((candidate) => usableAbsolutePath(candidate, pathApi))
      .find((candidate): candidate is string => Boolean(candidate)) ??
    pathApi.resolve(os.tmpdir())
  );
}

function joinAbsolute(
  pathApi: typeof path.posix | typeof path.win32,
  base: string | undefined,
  ...parts: string[]
): string | undefined {
  const usableBase = usableAbsolutePath(base, pathApi);
  return usableBase ? pathApi.join(usableBase, ...parts) : undefined;
}

function usableAbsolutePath(
  value: string | undefined,
  pathApi: typeof path.posix | typeof path.win32
): string | undefined {
  const trimmed = String(value || '').trim();
  return trimmed && trimmed !== 'undefined' && trimmed !== 'null' && pathApi.isAbsolute(trimmed)
    ? trimmed
    : undefined;
}

function safeExists(exists: (candidate: string) => boolean, candidate: string): boolean {
  try {
    return exists(candidate);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Migrate OpenCode config sync without breaking explicit test paths**

Extend `OpenCodeConfigSyncOptions`:

```ts
export interface OpenCodeConfigSyncOptions extends OpenCodePathOptions {
  configPath?: string;
}
```

Resolve the constructor path with:

```ts
this.configPath = options.configPath ?? resolveOpenCodePaths(options).configPath;
```

Remove module-load-time `OPENCODE_CONFIG_DIR_CANDIDATES` and the private resolver from `src/openCodeConfigSync.ts`.

- [ ] **Step 5: Migrate local state and MCP config**

In `OpenCodeLocalState.paths()`, return the state fields from:

```ts
return resolveOpenCodePaths(this.options);
```

Delete the duplicated `stateHome()`, `cacheHome()`, `homeDir()`, and `usableAbsolutePath()` methods.

In `src/mcpConfig.ts`, replace the duplicated Windows config-home helpers with:

```ts
function openCodeConfigPath(): string {
  return resolveOpenCodePaths().configPath;
}
```

Keep the existing exported `openCodeConfigPath` symbol used by tests.

- [ ] **Step 6: Add integration assertions for all three consumers**

Update:

- `tests/openCodeConfigSync.test.mjs` to instantiate with `{ platform: 'win32', env, homeDir, exists }` and assert `getConfigPath()` follows the APPDATA/legacy rule.
- `tests/openCodeLocalState.test.mjs` to use `resolveOpenCodePaths()` for pure Windows paths and retain one host-native temp-directory write/read test.
- `tests/mcpConfig.test.mjs` to assert the exported path matches the shared resolver when environment variables change.

The Windows config-sync assertion is:

```js
const sync = new OpenCodeConfigSync({
  platform: 'win32',
  homeDir: 'C:\\Users\\Agent',
  env: {
    APPDATA: 'C:\\Users\\Agent\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\Agent\\AppData\\Local',
  },
  exists: () => false,
});
assert.equal(
  sync.getConfigPath(),
  'C:\\Users\\Agent\\AppData\\Roaming\\opencode\\opencode.json'
);
```

- [ ] **Step 7: Run path and OpenCode regressions**

Run:

```bash
npm run build:test
node --test tests/openCodePaths.test.mjs tests/openCodeConfigSync.test.mjs tests/openCodeLocalState.test.mjs tests/mcpConfig.test.mjs
```

Expected: PASS with zero failures.

- [ ] **Step 8: Commit the shared-path increment**

```bash
git add src/openCodePaths.ts src/openCodeConfigSync.ts src/openCodeLocalState.ts src/mcpConfig.ts tests/openCodePaths.test.mjs tests/openCodeConfigSync.test.mjs tests/openCodeLocalState.test.mjs tests/mcpConfig.test.mjs
git commit -m "fix: unify OpenCode paths on Windows"
```

---

### Task 4: Read Windows system proxy settings conservatively

**Files:**
- Modify: `src/systemProxyEnv.ts`
- Create: `tests/systemProxyEnv.test.mjs`
- Modify: `tests/promptBuilder.test.mjs`

**Interfaces:**
- Produces: `SystemProxyOptions { platform?, readMacProxy?, readWindowsInternetSettings? }`
- Produces: `parseWindowsInternetSettings(output: string): Record<string, string>`
- Preserves: `parseMacSystemProxyEnv(output: string): Record<string, string>`
- Consumes: existing `CliManager` call to `getSystemProxyEnv(process.env)`.

- [ ] **Step 1: Write failing Windows registry parser tests**

Create `tests/systemProxyEnv.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  getSystemProxyEnv,
  parseWindowsInternetSettings,
} = require('../.test-dist/systemProxyEnv.js');

test('Windows single proxy populates HTTP and HTTPS variables', () => {
  const env = parseWindowsInternetSettings(`
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ       proxy.example.com:8080
    ProxyOverride  REG_SZ       <local>;*.corp.example.com
  `);
  assert.equal(env.HTTP_PROXY, 'http://proxy.example.com:8080');
  assert.equal(env.HTTPS_PROXY, 'http://proxy.example.com:8080');
  assert.equal(env.http_proxy, env.HTTP_PROXY);
  assert.equal(env.https_proxy, env.HTTPS_PROXY);
  assert.equal(env.NO_PROXY, 'localhost,127.0.0.1,.local,.corp.example.com');
  assert.equal(env.no_proxy, env.NO_PROXY);
});

test('Windows protocol-specific proxy maps http https and socks independently', () => {
  const env = parseWindowsInternetSettings(`
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ       http=proxy:80;https=secure-proxy:443;socks=socks-proxy:1080
    ProxyOverride  REG_SZ       localhost;10.*
  `);
  assert.equal(env.HTTP_PROXY, 'http://proxy:80');
  assert.equal(env.HTTPS_PROXY, 'http://secure-proxy:443');
  assert.equal(env.ALL_PROXY, 'socks5://socks-proxy:1080');
  assert.match(env.NO_PROXY, /10\.\*/);
});

test('disabled or malformed Windows proxy settings are non-fatal', () => {
  assert.deepEqual(
    parseWindowsInternetSettings('ProxyEnable REG_DWORD 0x0\nProxyServer REG_SZ proxy:80'),
    {}
  );
  assert.deepEqual(parseWindowsInternetSettings('not registry output'), {});
});

test('explicit proxy environment prevents Windows registry lookup', () => {
  let reads = 0;
  const env = getSystemProxyEnv(
    { HTTPS_PROXY: 'http://explicit:8443' },
    {
      platform: 'win32',
      readWindowsInternetSettings() {
        reads += 1;
        return '';
      },
    }
  );
  assert.deepEqual(env, {});
  assert.equal(reads, 0);
});
```

- [ ] **Step 2: Run the tests and verify Windows exports are missing**

Run:

```bash
npm run build:test
node --test tests/systemProxyEnv.test.mjs
```

Expected: FAIL because the Windows parser and injectable options do not exist.

- [ ] **Step 3: Implement the parser and non-fatal registry reader**

Add to `src/systemProxyEnv.ts`:

```ts
export interface SystemProxyOptions {
  platform?: NodeJS.Platform;
  readMacProxy?: () => string;
  readWindowsInternetSettings?: () => string;
}

export function getSystemProxyEnv(
  sourceEnv: NodeJS.ProcessEnv = process.env,
  options: SystemProxyOptions = {}
): Record<string, string> {
  if (hasProxyEnv(sourceEnv)) {
    return {};
  }

  const platform = options.platform ?? process.platform;
  if (platform === 'darwin') {
    const output = (options.readMacProxy ?? readScutilProxy)();
    return output ? parseMacSystemProxyEnv(output) : {};
  }
  if (platform === 'win32') {
    const output = (options.readWindowsInternetSettings ?? readWindowsInternetSettings)();
    return output ? parseWindowsInternetSettings(output) : {};
  }
  return {};
}

export function parseWindowsInternetSettings(output: string): Record<string, string> {
  const values = readWindowsRegistryValues(output);
  if (values.ProxyEnable !== '0x1' && values.ProxyEnable !== '1') {
    return {};
  }

  const proxyServer = values.ProxyServer?.trim();
  if (!proxyServer) {
    return {};
  }

  const env: Record<string, string> = {};
  const protocolEntries = Object.fromEntries(
    proxyServer
      .split(';')
      .map((entry) => entry.trim())
      .filter((entry) => entry.includes('='))
      .map((entry) => {
        const separator = entry.indexOf('=');
        return [entry.slice(0, separator).toLowerCase(), entry.slice(separator + 1).trim()];
      })
  );

  if (Object.keys(protocolEntries).length === 0) {
    assignProxy(env, 'HTTP_PROXY', withScheme(proxyServer, 'http'));
    assignProxy(env, 'HTTPS_PROXY', withScheme(proxyServer, 'http'));
  } else {
    assignProxy(env, 'HTTP_PROXY', withScheme(protocolEntries.http, 'http'));
    assignProxy(env, 'HTTPS_PROXY', withScheme(protocolEntries.https, 'http'));
    assignProxy(env, 'ALL_PROXY', withScheme(protocolEntries.socks, 'socks5'));
  }

  const noProxy = normalizeWindowsProxyOverride(values.ProxyOverride || '');
  env.NO_PROXY = noProxy;
  env.no_proxy = noProxy;
  return env;
}
```

Add the concrete helpers:

```ts
function readWindowsInternetSettings(): string {
  try {
    return execFileSync(
      'reg.exe',
      [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      ],
      {
        encoding: 'utf8',
        timeout: 1000,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      }
    );
  } catch {
    return '';
  }
}

function readWindowsRegistryValues(output: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const match of output.matchAll(
    /^\s*(ProxyEnable|ProxyServer|ProxyOverride)\s+REG_[A-Z_]+\s+(.+?)\s*$/gim
  )) {
    values[match[1]] = match[2].trim();
  }
  return values;
}

function assignProxy(
  env: Record<string, string>,
  upperName: 'HTTP_PROXY' | 'HTTPS_PROXY' | 'ALL_PROXY',
  value: string
): void {
  if (!value) {
    return;
  }
  env[upperName] = value;
  env[upperName.toLowerCase()] = value;
}

function withScheme(value: string | undefined, scheme: 'http' | 'socks5'): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `${scheme}://${trimmed}`;
}

function normalizeWindowsProxyOverride(value: string): string {
  const defaults = ['localhost', '127.0.0.1', '.local'];
  const entries = value
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry.toLowerCase() !== '<local>')
    .map((entry) => (entry.startsWith('*.') ? entry.slice(1) : entry));
  return [...new Set([...defaults, ...entries])].join(',');
}
```

Import `execFileSync` from `child_process`. These helpers never evaluate `AutoConfigURL`, PAC, or WPAD data and never emit registry contents to logs.

- [ ] **Step 4: Move the macOS parser assertion to the focused test file**

Move the existing macOS `scutil` parser assertions from `tests/promptBuilder.test.mjs` to `tests/systemProxyEnv.test.mjs`, leaving one architecture assertion in `promptBuilder.test.mjs` that `CliManager` still calls `getSystemProxyEnv(process.env)`.

- [ ] **Step 5: Run proxy and manager regressions**

Run:

```bash
npm run build:test
node --test tests/systemProxyEnv.test.mjs tests/promptBuilder.test.mjs
```

Expected: PASS with zero failures.

- [ ] **Step 6: Commit the proxy increment**

```bash
git add src/systemProxyEnv.ts tests/systemProxyEnv.test.mjs tests/promptBuilder.test.mjs
git commit -m "fix: inherit Windows system proxy settings"
```

---

### Task 5: Prove `.cmd` behavior and run the full suite on Windows

**Files:**
- Modify: `tests/cliProcessRunner.test.mjs`
- Modify: `tests/mcpConfig.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `CliProcessRunner` public prompt/background/terminate APIs.
- Produces: real Windows evidence for npm-style `.cmd` execution, argument preservation, and process-tree shutdown.
- Produces: CI matrix entries `ubuntu-18`, `ubuntu-20`, and `windows-20`.

- [ ] **Step 1: Add a Windows-only npm-shim integration test**

Extend the imports in `tests/cliProcessRunner.test.mjs`:

```js
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
```

Add these helpers and the concrete Windows test:

```js
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

function waitForFirstJsonLine(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    child.once('error', reject);
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
      const newline = stdout.indexOf('\n');
      if (newline >= 0) {
        resolve(JSON.parse(stdout.slice(0, newline)));
      }
    });
  });
}

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
        "const args = process.argv.slice(2);",
        "if (args[0] === 'spawn-child') {",
        "  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {",
        "    stdio: 'ignore',",
        "    windowsHide: true,",
        "  });",
        "  process.stdout.write(`${JSON.stringify({ args, childPid: child.pid })}\\n`);",
        "  setInterval(() => {}, 1000);",
        "} else {",
        "  process.stdout.write(`${JSON.stringify(args)}\\n`);",
        "  process.stderr.write('fixture-stderr\\n');",
        "}",
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

    try {
      await run([
        'run',
        '--attach',
        'http://127.0.0.1:4096',
        '中文 multiline\nsecond line "quoted" & | ^ % !',
      ]);
      await run(['serve', '--hostname', '127.0.0.1', '--port', '4096']);

      const child = runner.spawnPromptProcess(
        shimPath,
        ['spawn-child'],
        root,
        env,
        'ignore'
      );
      const firstLine = await waitForFirstJsonLine(child);
      assert.ok(Number.isInteger(firstLine.childPid));
      runner.terminate(child);
      await waitForWindowsPidToExit(firstLine.childPid);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);
```

Expected behavior on the old native `spawn()` implementation: `.cmd` launch emits `EINVAL`/`ENOENT` or loses special arguments. Expected behavior after Task 2: PASS.

- [ ] **Step 2: Make MCP tests shell-independent**

In `tests/mcpConfig.test.mjs`, replace shell strings and `cat` with argument-array APIs:

```js
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';

function runSqlite(sql, args = []) {
  return execFileSync('sqlite3', [...args, dbPath, sql], { encoding: 'utf8' });
}

function initTestDb() {
  rmSync(dbPath, { force: true });
  runSqlite(
    "CREATE TABLE mcp_servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, server_config TEXT NOT NULL, description TEXT, homepage TEXT, docs TEXT, tags TEXT NOT NULL DEFAULT '[]', enabled_claude BOOLEAN NOT NULL DEFAULT 0, enabled_codex BOOLEAN NOT NULL DEFAULT 0, enabled_gemini BOOLEAN NOT NULL DEFAULT 0, enabled_opencode BOOLEAN NOT NULL DEFAULT 0)"
  );
}

function dumpRows() {
  return runSqlite(
    'SELECT id, name, server_config, description, homepage, enabled_claude, enabled_codex, enabled_gemini, enabled_opencode FROM mcp_servers ORDER BY id',
    ['-json']
  );
}

function readOpencodeConfig() {
  return existsSync(opencodeConfigPath)
    ? JSON.parse(readFileSync(opencodeConfigPath, 'utf8'))
    : null;
}
```

Replace the seven existing `execSync` insert calls at the current test lines 97-98, 148, 170-171, and 189-190 with `runSqlite()` calls whose single argument is the same complete SQL statement already present at that location. Remove the `execSync` import after the final call is migrated; preserve every SQL value and assertion unchanged.

- [ ] **Step 3: Expand the GitHub Actions matrix**

Replace the current single-OS matrix in `.github/workflows/ci.yml` with:

```yaml
jobs:
  build:
    name: ${{ matrix.name }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - name: ubuntu-node-18
            os: ubuntu-latest
            node-version: 18.x
          - name: ubuntu-node-20
            os: ubuntu-latest
            node-version: 20.x
          - name: windows-node-20
            os: windows-latest
            node-version: 20.x
    runs-on: ${{ matrix.os }}
```

Keep checkout, setup-node, `npm ci`, lint, typecheck, format check, build, and complete tests for every matrix entry. Add before tests:

```yaml
      - name: Ensure SQLite CLI is available on Windows
        if: runner.os == 'Windows'
        shell: pwsh
        run: |
          if (-not (Get-Command sqlite3 -ErrorAction SilentlyContinue)) {
            choco install sqlite --no-progress -y
          }
          sqlite3 --version
```

- [ ] **Step 4: Run every portable test locally**

Run:

```bash
npm run lint
npm run typecheck
npm run format:check
npm test
```

Expected on macOS/Linux: PASS; the one real `.cmd` block is reported as skipped and all pure Windows tests pass.

- [ ] **Step 5: Commit Windows integration coverage**

```bash
git add tests/cliProcessRunner.test.mjs tests/mcpConfig.test.mjs .github/workflows/ci.yml
git commit -m "test: verify Windows CLI runtime"
```

---

### Task 6: Release documentation, full verification, and review

**Files:**
- Modify: `CHANGELOG.md`
- Verify: `agents-gui-0.0.18.vsix`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a Universal VSIX containing the Windows-compatible runtime.

- [ ] **Step 1: Document the Windows compatibility changes**

Add under `v0.0.18`:

```markdown
### Windows 兼容性

- 修复 npm 安装的 OpenCode、Codex、Claude Code 与 Gemini `.cmd` shim 可发现但无法启动的问题，同时保持参数数组隔离，避免用户输入被解释为 shell 语法。
- 补全 Windows 用户级 CLI 搜索路径、OpenCode APPDATA/LOCALAPPDATA 路径、系统代理读取与进程树终止验证。
- 新增 Windows Node 20 CI，与 Ubuntu Node 18/20 一起执行完整质量检查。
```

- [ ] **Step 2: Run the fresh completion gate**

Run:

```bash
npm run lint
npm run typecheck
npm run format:check
npm run verify:release
git diff --check
```

Expected:

- lint exits 0;
- typecheck exits 0;
- Prettier reports all matched files formatted;
- every Node test passes with zero failures;
- Extension Development Host smoke passes;
- standalone webview preview passes;
- dependency audit reports zero vulnerabilities;
- `agents-gui-0.0.18.vsix` is rebuilt successfully;
- both Git whitespace checks exit 0.

- [ ] **Step 3: Inspect the packaged VSIX**

Run:

```bash
unzip -l agents-gui-0.0.18.vsix
shasum -a 256 agents-gui-0.0.18.vsix
```

Confirm the archive contains `extension/dist/extension.js`, remains platform-unrestricted, and does not package prompt logs, temporary databases, test fixtures, `.worktrees`, or credentials.

- [ ] **Step 4: Request and address code review**

Review the diff against every acceptance criterion in `docs/superpowers/specs/2026-07-28-windows-cli-compatibility-design.md`. Resolve all correctness, security, Windows quoting, lifecycle, and test-portability findings, then rerun Step 2 after the final change.

- [ ] **Step 5: Commit the release-ready result**

```bash
git add CHANGELOG.md
git commit -m "docs: note Windows CLI compatibility"
```

Do not push or publish without a separate user instruction. Report the local branch, commits, VSIX path, checksum, local verification counts, and that the real Windows job will run when the branch is pushed.
