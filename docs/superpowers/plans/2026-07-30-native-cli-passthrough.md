# Native CLI Passthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agents GUI invoke exactly one locally installed CLI with that CLI's own configuration, without extension-generated provider, model, permission, runtime, MCP, plugin, proxy, profile-environment, background-server, or fallback overrides.

**Architecture:** Reduce the execution layer to a one-shot process transport: resolve a system executable, inherit the extension-host environment, set the requested working directory, append only the CLI's prompt-transport arguments, and stream the child process. Remove the legacy API Provider and execution-option surfaces, migrate only tagged OpenCode configuration written by old releases, and make SCM generation a single-provider use case with diagnostic-output rejection.

**Tech Stack:** TypeScript, VS Code Extension API, Node.js 18+, `cross-spawn`, browser JavaScript/CSS/HTML webview, Node's built-in test runner, esbuild, VSCE.

## Global Constraints

- Release version is exactly `0.0.20`; never reuse `0.0.19`.
- Preserve the user's existing `.neuralmemory/surface.nm` worktree change and do not stage it.
- Use test-driven development: each production change follows a focused failing test with the expected failure observed.
- Local CLI transport arguments are exactly:
  - Claude Code: `-p --output-format stream-json --verbose --include-partial-messages`
  - Gemini CLI: `--output-format text -p`
  - Codex CLI: `exec --color never`
  - OpenCode: `run --format json`
  - Goose: `run --quiet --output-format text --text`
  - Aider: `--message`
- Preserve command discovery, command-directory `PATH`, repository `cwd`, stdout/stderr streaming, cancellation, process-tree termination, and Windows `.exe`/`.cmd`/`.bat` support.
- Do not synthesize API, model, proxy, telemetry, database, permission, runtime, MCP, plugin, session, or fallback behavior.
- Existing API Provider settings in VS Code become inert unknown keys; never rewrite the user's VS Code settings to remove them.
- OpenCode cleanup removes only entries whose `__agents_gui_synced` value is exactly `true`.
- OpenCode cleanup completion state is machine-local `globalState` and must not be added to `SYNCED_GLOBAL_STATE_KEYS`.

---

## File Structure and Ownership

- `src/openCodeConfigCleanup.ts`: one-time, marker-scoped cleanup of legacy OpenCode configuration plus the local migration runner.
- `src/cliProfiles.ts`: static CLI identity, observation metadata, and the six allowed prompt-transport argv lists; no execution overrides.
- `src/cliManager.ts`: one-shot local process transport.
- `src/cliProcessRunner.ts`: cross-platform spawn and process-tree termination only.
- `src/agentRuntime.ts`: narrow adapter over `CliManager.startPrompt`.
- `src/sidebarProvider.ts`: build prompts, collect context, start one local process, and present output; no execution configuration.
- `src/textGeneration.ts`: single-selected-CLI commit-message use case.
- `src/cliTextGenerationAdapter.ts`: time-bounded one-shot CLI adapter.
- `src/commitMessage.ts`: commit-message validation and diagnostic rejection.
- `media/main.html`, `media/main.js`, `media/main.css`, `media/i18n.js`: webview without API Provider, model, runtime, permission, model-variant, or managed-session controls.
- `src/webviewProtocol.ts`, `src/assistantTypes.ts`, `src/promptBuilder.ts`: protocol and prompt types without execution selections.
- `package.json`, `package-lock.json`, `package.nls.json`, `package.nls.zh-cn.json`, `README.md`, `CHANGELOG.md`, and architecture docs: native-passthrough contract and `0.0.20` release metadata.

---

### Task 1: Build the Marker-Scoped OpenCode Cleanup Migration

**Files:**
- Create: `src/openCodeConfigCleanup.ts`
- Create: `tests/openCodeConfigCleanup.test.mjs`
- Reference: `src/openCodePaths.ts`

**Interfaces:**
- Consumes: `resolveOpenCodePaths(options): OpenCodePaths`.
- Produces:
  - `OPENCODE_NATIVE_PASSTHROUGH_CLEANUP_KEY`
  - `OpenCodeConfigCleanupMigration.cleanup(): Promise<OpenCodeCleanupResult>`
  - `runOpenCodeCleanupOnce(state, migration): Promise<OpenCodeCleanupResult | undefined>`

- [ ] **Step 1: Write the failing migration tests**

Create `tests/openCodeConfigCleanup.test.mjs` with these concrete cases:

```js
import assert from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  OpenCodeConfigCleanupMigration,
  OPENCODE_NATIVE_PASSTHROUGH_CLEANUP_KEY,
  runOpenCodeCleanupOnce,
} from '../.test-dist/openCodeConfigCleanup.js';

function fixture(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-gui-native-cleanup-'));
  const configPath = path.join(dir, 'opencode.json');
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return { dir, configPath };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('cleanup removes only exactly tagged providers and their selected model', async () => {
  const { dir, configPath } = fixture({
    $schema: 'https://opencode.ai/config.json',
    model: 'agents_gui_mimo/mimo-v2.5-pro',
    provider: {
      agents_gui_mimo: { __agents_gui_synced: true, options: { apiKey: 'legacy' } },
      marker_string: { __agents_gui_synced: 'true' },
      marker_false: { __agents_gui_synced: false },
      user_provider: { name: 'User provider' },
    },
    mcp: { local: { type: 'local', command: ['example'] } },
  });

  const result = await new OpenCodeConfigCleanupMigration({ configPath }).cleanup();
  const config = readJson(configPath);

  assert.equal(result.changed, true);
  assert.deepEqual(result.removedProviderKeys, ['agents_gui_mimo']);
  assert.equal(result.removedTopLevelModel, true);
  assert.ok(result.backupPath);
  assert.equal(config.model, undefined);
  assert.equal(config.provider.agents_gui_mimo, undefined);
  assert.equal(config.provider.marker_string.__agents_gui_synced, 'true');
  assert.equal(config.provider.marker_false.__agents_gui_synced, false);
  assert.equal(config.provider.user_provider.name, 'User provider');
  assert.equal(config.mcp.local.type, 'local');
  assert.deepEqual(readJson(result.backupPath), {
    $schema: 'https://opencode.ai/config.json',
    model: 'agents_gui_mimo/mimo-v2.5-pro',
    provider: {
      agents_gui_mimo: { __agents_gui_synced: true, options: { apiKey: 'legacy' } },
      marker_string: { __agents_gui_synced: 'true' },
      marker_false: { __agents_gui_synced: false },
      user_provider: { name: 'User provider' },
    },
    mcp: { local: { type: 'local', command: ['example'] } },
  });
  assert.equal(fs.readdirSync(dir).filter((name) => name.includes('native-cli-bak')).length, 1);
});

test('cleanup preserves a nonmatching model and does not confuse provider prefixes', async () => {
  const { configPath } = fixture({
    model: 'agents_gui_mimo_extra/model',
    provider: {
      agents_gui_mimo: { __agents_gui_synced: true },
      agents_gui_mimo_extra: { name: 'User provider' },
    },
  });

  const result = await new OpenCodeConfigCleanupMigration({ configPath }).cleanup();
  assert.equal(result.removedTopLevelModel, false);
  assert.equal(readJson(configPath).model, 'agents_gui_mimo_extra/model');
});

test('cleanup is byte-stable and creates no backup when no tagged entry exists', async () => {
  const { dir, configPath } = fixture({
    model: 'user/model',
    provider: { user: { name: 'User provider' } },
  });
  const before = fs.readFileSync(configPath);

  const result = await new OpenCodeConfigCleanupMigration({ configPath }).cleanup();

  assert.deepEqual(result, {
    changed: false,
    removedProviderKeys: [],
    removedTopLevelModel: false,
  });
  assert.deepEqual(fs.readFileSync(configPath), before);
  assert.equal(fs.readdirSync(dir).filter((name) => name.includes('native-cli-bak')).length, 0);
});

test('runOpenCodeCleanupOnce records success locally and retries failures', async () => {
  const values = new Map();
  const state = {
    get: (key) => values.get(key),
    update: async (key, value) => values.set(key, value),
  };
  let calls = 0;
  const migration = {
    cleanup: async () => {
      calls += 1;
      return { changed: false, removedProviderKeys: [], removedTopLevelModel: false };
    },
  };

  await runOpenCodeCleanupOnce(state, migration);
  await runOpenCodeCleanupOnce(state, migration);

  assert.equal(calls, 1);
  assert.equal(values.get(OPENCODE_NATIVE_PASSTHROUGH_CLEANUP_KEY), true);

  const failingValues = new Map();
  const failingState = {
    get: (key) => failingValues.get(key),
    update: async (key, value) => failingValues.set(key, value),
  };
  await assert.rejects(
    runOpenCodeCleanupOnce(failingState, { cleanup: async () => { throw new Error('backup failed'); } }),
    /backup failed/
  );
  assert.equal(failingValues.has(OPENCODE_NATIVE_PASSTHROUGH_CLEANUP_KEY), false);
});
```

- [ ] **Step 2: Run the tests and observe the expected red state**

Run:

```bash
npm run build:test
node --test tests/openCodeConfigCleanup.test.mjs
```

Expected: `build:test` fails because `src/openCodeConfigCleanup.ts` does not exist, or the focused test fails with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the cleanup and local runner**

Create `src/openCodeConfigCleanup.ts` around this exact public contract:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { resolveOpenCodePaths, type OpenCodePathOptions } from './openCodePaths';

const SYNC_MARKER = '__agents_gui_synced';
export const OPENCODE_NATIVE_PASSTHROUGH_CLEANUP_KEY =
  'agents-gui.migration.openCodeNativePassthroughCleanup.v1';

export interface OpenCodeConfigCleanupOptions extends OpenCodePathOptions {
  configPath?: string;
  now?: () => Date;
}

export type OpenCodeCleanupResult = {
  changed: boolean;
  removedProviderKeys: string[];
  removedTopLevelModel: boolean;
  backupPath?: string;
};

export interface LocalMigrationState {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export class OpenCodeConfigCleanupMigration {
  private readonly configPath: string;
  private readonly now: () => Date;

  constructor(options: OpenCodeConfigCleanupOptions = {}) {
    this.configPath = options.configPath ?? resolveOpenCodePaths(options).configPath;
    this.now = options.now ?? (() => new Date());
  }

  async cleanup(): Promise<OpenCodeCleanupResult> {
    const existing = await this.readConfig();
    if (!existing) {
      return { changed: false, removedProviderKeys: [], removedTopLevelModel: false };
    }

    const providers = isRecord(existing.provider) ? { ...existing.provider } : {};
    const removedProviderKeys = Object.entries(providers)
      .filter(([, entry]) => isRecord(entry) && entry[SYNC_MARKER] === true)
      .map(([key]) => key)
      .sort();
    if (removedProviderKeys.length === 0) {
      return { changed: false, removedProviderKeys: [], removedTopLevelModel: false };
    }

    for (const key of removedProviderKeys) {
      delete providers[key];
    }
    const model = typeof existing.model === 'string' ? existing.model : undefined;
    const removedTopLevelModel = Boolean(
      model && removedProviderKeys.some((key) => model === key || model.startsWith(`${key}/`))
    );
    const next: Record<string, unknown> = { ...existing, provider: providers };
    if (removedTopLevelModel) {
      delete next.model;
    }

    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.configPath}.agents-gui-native-cli-bak-${stamp}`;
    await fs.promises.copyFile(this.configPath, backupPath);
    await fs.promises.writeFile(this.configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return { changed: true, removedProviderKeys, removedTopLevelModel, backupPath };
  }

  private async readConfig(): Promise<Record<string, unknown> | undefined> {
    try {
      const parsed: unknown = JSON.parse(await fs.promises.readFile(this.configPath, 'utf8'));
      if (!isRecord(parsed)) {
        throw new Error(`OpenCode config is not an object: ${this.configPath}`);
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }
}

export async function runOpenCodeCleanupOnce(
  state: LocalMigrationState,
  migration: Pick<OpenCodeConfigCleanupMigration, 'cleanup'>
): Promise<OpenCodeCleanupResult | undefined> {
  if (state.get<boolean>(OPENCODE_NATIVE_PASSTHROUGH_CLEANUP_KEY)) {
    return undefined;
  }
  const result = await migration.cleanup();
  await state.update(OPENCODE_NATIVE_PASSTHROUGH_CLEANUP_KEY, true);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
```

Do not wire the migration into activation yet; the legacy synchronizer still runs until Task 2.

- [ ] **Step 4: Run the focused migration tests**

Run:

```bash
npm run build:test
node --test tests/openCodeConfigCleanup.test.mjs
```

Expected: 4 tests pass, 0 fail.

- [ ] **Step 5: Commit the independently tested migration**

```bash
git add src/openCodeConfigCleanup.ts tests/openCodeConfigCleanup.test.mjs
git commit -m "feat: add legacy OpenCode cleanup migration"
```

---

### Task 2: Remove the Legacy API Provider Surface and Wire Cleanup

**Files:**
- Delete: `src/apiProviderClient.ts`
- Delete: `src/apiProviders.ts`
- Delete: `src/openCodeConfigSync.ts`
- Delete: `tests/openCodeConfigSync.test.mjs`
- Modify: `src/extension.ts`
- Modify: `src/settingsManager.ts`
- Modify: `src/sidebarProvider.ts`
- Modify: `src/webviewProtocol.ts`
- Modify: `src/threadEventAdapter.ts`
- Modify: `src/localization.ts`
- Modify: `media/main.html`
- Modify: `media/main.js`
- Modify: `media/main.css`
- Modify: `media/i18n.js`
- Modify: `package.json`
- Modify: `package.nls.json`
- Modify: `package.nls.zh-cn.json`
- Modify: `README.md`
- Modify: `tests/promptBuilder.test.mjs`
- Modify: `tests/extensionActivation.test.mjs`
- Modify: `tests/threadEventAdapter.test.mjs`

**Interfaces:**
- Consumes: `runOpenCodeCleanupOnce(context.globalState, migration)` from Task 1.
- Produces: an activation and settings surface with no API Provider execution or UI contract.

- [ ] **Step 1: Reverse the provider-surface tests to express removal**

Replace the provider-positive assertions in `tests/promptBuilder.test.mjs` with:

```js
test('native passthrough removes the custom API provider surface', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const sidebar = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const protocol = readFileSync(new URL('../src/webviewProtocol.ts', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/settingsManager.ts', import.meta.url), 'utf8');
  const properties = manifest.contributes.configuration.properties;

  assert.equal(properties['agents-gui.apiProviders.customProviders'], undefined);
  assert.equal(properties['agents-gui.apiProviders.defaultProviderId'], undefined);
  assert.equal(properties['agents-gui.apiProviders.agentProviderByCliId'], undefined);
  assert.doesNotMatch(html, /settingsNavApiProviders|settingsSectionApiProviders|apiProviderForm/);
  assert.doesNotMatch(script, /apiProviderSettings|fetchApiProviderModels|saveApiProviderSettings/);
  assert.doesNotMatch(sidebar, /ApiProvider|apiProvider|OpenCodeConfigSync|\.sync\(/);
  assert.doesNotMatch(protocol, /apiProvider|ApiProvider/);
  assert.doesNotMatch(settings, /apiProvider|ApiProvider/);
});
```

Add to `tests/extensionActivation.test.mjs`:

```js
test('activation runs local OpenCode cleanup without API runtime injection', () => {
  assert.match(extensionSource, /await runOpenCodeCleanupOnce\(context\.globalState, openCodeCleanup\)/);
  assert.doesNotMatch(extensionSource, /resolveApiProviderRuntime|readApiProviderSettings|readOpenCodeConfig/);
  assert.doesNotMatch(sidebarSource, /OpenCodeConfigSync|sendApiProviderSettings|saveApiProviderSettings/);
  assert.doesNotMatch(syncedStateSource, /openCodeNativePassthroughCleanup/);
});
```

Delete provider-warning expectations from `tests/threadEventAdapter.test.mjs` and assert:

```js
assert.doesNotMatch(
  readFileSync(new URL('../src/threadEventAdapter.ts', import.meta.url), 'utf8'),
  /apiProviderWarning/
);
```

- [ ] **Step 2: Run the provider-removal tests and observe the expected failures**

Run:

```bash
npm run build:test
node --test --test-name-pattern="native passthrough removes|activation runs local OpenCode cleanup" tests/promptBuilder.test.mjs tests/extensionActivation.test.mjs
node --test tests/threadEventAdapter.test.mjs
```

Expected: assertions fail because manifest keys, webview controls, runtime imports, warnings, and synchronizer calls still exist.

- [ ] **Step 3: Wire cleanup before any CLI command can run**

Change `activate` in `src/extension.ts` to `async` and run the local migration before constructing `CliManager`:

```ts
import {
  OpenCodeConfigCleanupMigration,
  runOpenCodeCleanupOnce,
} from './openCodeConfigCleanup';

export async function activate(context: vscode.ExtensionContext) {
  const locale = resolveRuntimeLocale(vscode.env.language);
  context.globalState.setKeysForSync(SYNCED_GLOBAL_STATE_KEYS);
  const openCodeCleanup = new OpenCodeConfigCleanupMigration();
  try {
    await runOpenCodeCleanupOnce(context.globalState, openCodeCleanup);
  } catch (error) {
    console.warn('[Agents GUI] Failed to clean legacy OpenCode provider configuration.', error);
  }

  const cliManager = new CliManager();
  const textGenerationAdapter = new CliTextGenerationAdapter(cliManager);
  // Existing command and sidebar registration follows.
}
```

The cleanup key stays out of `src/syncedState.ts`.

- [ ] **Step 4: Remove provider code and host protocol**

Delete `src/apiProviderClient.ts`, `src/apiProviders.ts`, and `src/openCodeConfigSync.ts`.

In `src/settingsManager.ts`, delete `getApiProviderSettings()` and `filterApiProviderSettingsForInstalledAgents()`.

In `src/sidebarProvider.ts`, delete:

- `ApiProviderClient`, provider runtime, and `OpenCodeConfigSync` imports;
- constructor options and fields for those adapters;
- initial, refresh, and save calls to `sendApiProviderSettings()`;
- message cases `saveApiProviderSettings`, `refreshApiProviderSettings`, and `fetchApiProviderModels`;
- `openCodeConfigSyncPromise`, `sendApiProviderSettings`, `saveApiProviderSettings`,
  `fetchApiProviderModels`, and `formatApiProviderWarning`;
- `apiProviderRuntime`, its selection key, its environment argument, and its warning field from request execution.

The settings refresh body becomes:

```ts
async refreshProviders(): Promise<void> {
  await this.postToWebview({ command: 'refreshStarted' });
  await this.sendProfiles({ force: true });
  await this.sendHomeAgentSettings();
  await this.sendCommitMessageSettings();
}
```

In `src/webviewProtocol.ts`, use:

```ts
export type SettingsSection = 'agents' | 'commitMessage' | 'mcp' | string;
```

Remove every `saveApiProviderSettings`, `refreshApiProviderSettings`,
`fetchApiProviderModels`, `apiProviderSettings`, and
`apiProviderModelsResult` union member.

Remove `apiProviderWarning` from `src/threadEventAdapter.ts` and from every host
event created in `src/sidebarProvider.ts`.

- [ ] **Step 5: Remove provider settings from manifest, localization, docs, and webview**

Delete the three `agents-gui.apiProviders.*` properties from `package.json` and
their four NLS descriptions from both `package.nls.json` files.

Delete from `media/main.html`:

- `#settingsNavApiProviders`;
- `#settingsSectionApiProviders` and its entire form.

Delete from `media/main.js`:

- all DOM bindings whose variable name begins with `apiProvider`;
- `apiProviderSettings`, `editingApiProviderId`, and provider environment status;
- normalizers, renderers, save/fetch/delete handlers, model result handling;
- the `apiProviders` settings-section switch branch;
- outgoing provider messages and incoming provider cases.

Constrain section normalization to:

```js
activeSettingsSection = ['agents', 'commitMessage', 'mcp'].includes(section)
  ? section
  : 'agents';
```

Delete provider-form-only selectors from `media/main.css`, while preserving
shared `.api-settings-page`, `.api-settings-panel`, navigation, and
`.settings-save-status` styles used by Agent and commit settings.

Delete `settings.apiProviders`, every `apiSettings.*`, and provider-warning
translations from `media/i18n.js`. Remove the three provider rows from
`README.md`. Preserve historical entries in `CHANGELOG.md`; add the removal to
the new release in Task 7 rather than rewriting history.

- [ ] **Step 6: Run focused tests and compile**

Run:

```bash
npm run build:test
node --test --test-name-pattern="native passthrough removes|activation runs local OpenCode cleanup" tests/promptBuilder.test.mjs tests/extensionActivation.test.mjs
node --test tests/openCodeConfigCleanup.test.mjs tests/threadEventAdapter.test.mjs
```

Expected: all selected tests pass and TypeScript compilation reports no deleted-module imports.

- [ ] **Step 7: Commit provider-surface removal**

```bash
git add package.json package.nls.json package.nls.zh-cn.json README.md media src tests
git commit -m "refactor: remove CLI provider injection surface"
```

---

### Task 3: Reduce CLI Profiles and Process Launch to Native One-Shot Transport

**Files:**
- Modify: `src/cliProfiles.ts`
- Modify: `src/cliDiscovery.ts`
- Modify: `src/cliManager.ts`
- Modify: `src/cliProcessRunner.ts`
- Modify: `src/agentRuntime.ts`
- Modify: `src/cliTextGenerationAdapter.ts`
- Modify: `src/sidebarProvider.ts`
- Delete: `src/systemProxyEnv.ts`
- Delete: `tests/systemProxyEnv.test.mjs`
- Create: `tests/cliManager.test.mjs`
- Modify: `tests/promptBuilder.test.mjs`
- Modify: `tests/cliProcessRunner.test.mjs`
- Modify: `tests/extensionActivation.test.mjs`

**Interfaces:**
- Produces:

```ts
export interface StartPromptOptions {
  cwd?: string;
}

startPrompt(
  cliId: string,
  initialInput?: string,
  options?: StartPromptOptions
): Promise<Session | null>;
```

- [ ] **Step 1: Add the table-driven profile contract test**

In `tests/promptBuilder.test.mjs`, replace model/runtime/permission argv tests
with:

```js
test('all CLI profiles expose only native prompt transport arguments', () => {
  const expected = {
    claude: ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'],
    gemini: ['--output-format', 'text', '-p'],
    codex: ['exec', '--color', 'never'],
    opencode: ['run', '--format', 'json'],
    goose: ['run', '--quiet', '--output-format', 'text', '--text'],
    aider: ['--message'],
  };
  const forbidden = new Set([
    '--model', '--permission-mode', '--sandbox', '--full-auto', '--ephemeral',
    '--no-session', '--session', '--attach', '--thinking', '--approval-mode',
    '--skip-trust',
  ]);

  for (const [id, args] of Object.entries(expected)) {
    const profile = getCliProfile(id);
    assert.deepEqual(profile.promptArgs, args);
    assert.equal(profile.env, undefined);
    assert.equal(profile.backgroundServer, undefined);
    assert.equal(profile.runtimeModes, undefined);
    assert.equal(profile.permissionModes, undefined);
    assert.equal(profile.customModelArgPrefix, undefined);
    assert.equal(args.some((arg) => forbidden.has(arg)), false, id);
  }
});
```

- [ ] **Step 2: Add a real manager-boundary test**

Create `tests/cliManager.test.mjs` using a fake process runner that records
`spawnPromptProcess(command, args, options)`:

```js
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { CliManager } from '../.test-dist/cliManager.js';

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
```

Add this production constructor seam, used by both production defaults and the
test above:

```ts
export interface CliManagerDiscovery {
  checkInstalled(profile: CliProfile | undefined): Promise<boolean>;
  resolveCommandPath(command: string): Promise<string | undefined>;
  evictCommandPath(command: string): void;
  getProfilesWithStatus(
    profiles: CliProfile[],
    options?: AgentProfileStatusOptions
  ): Promise<CliProfile[]>;
}

export interface CliManagerOptions {
  processRunner?: CliProcessRunner;
  cliDiscovery?: CliManagerDiscovery;
  workspaceRoot?: () => string;
}

constructor(private readonly options: CliManagerOptions = {}) {
  this.processRunner = options.processRunner ?? new CliProcessRunner();
  this.cliDiscovery =
    options.cliDiscovery ??
    new CliDiscovery({
      workspaceRoot: () => this.getWorkspaceRoot(),
      processRunner: this.processRunner,
    });
}

getWorkspaceRoot(): string {
  return (
    this.options.workspaceRoot?.() ??
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
    process.env.HOME ??
    '/'
  );
}
```

- [ ] **Step 3: Run red tests**

Run:

```bash
npm run build:test
node --test --test-name-pattern="native prompt transport arguments" tests/promptBuilder.test.mjs
node --test tests/cliManager.test.mjs
```

Expected: profile test reports old behavioral args and the manager test reports
the old start signature/environment merge.

- [ ] **Step 4: Strip profile execution overrides**

In `src/cliProfiles.ts`:

- set the six `promptArgs` to the exact Global Constraints values;
- remove Gemini `env`;
- remove OpenCode `env` and `backgroundServer`;
- remove model preset args and custom model arg prefixes;
- remove runtime modes and permission modes;
- remove `CliAgentMode.args`, `CliOptionSelection`, `buildCliOptionArgs`,
  `getCliRuntimeMode`, and `getCliPermissionMode`.

Replace selectable model options with one observational field:

```ts
export interface CliConfiguredModel {
  id: string;
  label: string;
  variant?: string;
  contextWindowTokens?: number;
}

export interface CliProfile {
  // Existing identity, install, prompt, tokenizer, capability, and UI fields.
  configuredModel?: CliConfiguredModel;
}
```

`CliProfile` no longer exposes `modelOptions`, `defaultModel`,
`customModelArgPrefix`, `runtimeModes`, or `permissionModes`. OpenCode
discovery may populate only `configuredModel`; it must never attach argv.

In `src/cliDiscovery.ts`:

- delete `expandProfileEnv()` and `stableHash()`;
- stop cloning removed fields;
- remove `openCodeClient` from `CliDiscoveryOptions`, its constructor
  dependency, and its server metadata calls;
- run installation, version, OpenCode agent, and observational model probes with
  `withCliLookupPath(process.env, [commandDir])`;
- remove every `OPENCODE_DB`, `OMO_*`, and server-client model-metadata path.

- [ ] **Step 5: Narrow manager and runtime interfaces**

Implement:

```ts
export interface StartPromptOptions {
  cwd?: string;
}

async startPrompt(
  cliId: string,
  initialInput?: string,
  options: StartPromptOptions = {}
): Promise<Session | null> {
  const profile = getCliProfile(cliId);
  if (!profile) return null;
  const cwd = options.cwd?.trim() || this.getWorkspaceRoot();
  const command = (await this.resolveCommandPath(profile.command)) ?? profile.command;
  const commandDir = path.isAbsolute(command) ? path.dirname(command) : undefined;
  const env = withCliLookupPath(process.env, [commandDir]);
  const args =
    profile.inputMode === 'argument' && initialInput
      ? [...profile.promptArgs, initialInput]
      : [...profile.promptArgs];
  // Existing process creation, event normalization, cancellation, and cleanup
  // continue using command, args, cwd, and env.
}
```

Remove `agentArgs`, `agentModeId`, `optionKey`, `envOverrides`,
`attachBackgroundServer`, `promptArgs`, and `continueSessionId` from the
signature and types.

Make `AgentRuntime.startPrompt()` and `CliAgentRuntime.startPrompt()` forward
only `(cliId, initialInput, options)`.

Delete the `getSystemProxyEnv` import and `src/systemProxyEnv.ts`. Remove
`spawnBackgroundProcess()` from `src/cliProcessRunner.ts`, while keeping prompt
and probe spawn plus Windows/POSIX tree termination.

Temporarily update both call sites so the project compiles:

```ts
await this.agentRuntime.startPrompt(
  cliId,
  profile.inputMode === 'argument' ? prompt : undefined
);
```

```ts
await this.cliManager.startPrompt(profile.id, request.prompt, { cwd: request.cwd });
```

- [ ] **Step 6: Remove managed background-server and SSE ownership**

From `src/cliManager.ts`, remove:

- background server state, port resolution, TCP waiting, start/stop, attach args;
- OpenCode `--attach`, `--dir`, and `--session`;
- event-stream creation and SSE/process output deduplication;
- OpenCode server prompt/status/model/native-command/session wrappers.

Remove `eventStream`, `openCodeSessionId`, `agentModeId`, and `optionKey` from
`Session`. Keep `AgentRunEvent` process output/end/error events.

Update or remove old server-positive assertions in
`tests/promptBuilder.test.mjs`, `tests/cliProcessRunner.test.mjs`, and
`tests/extensionActivation.test.mjs`; retain assertions for `cross-spawn`,
`spawnPromptProcess`, `spawnProbeProcess`, `taskkill /T`, POSIX negative PID,
and `cwd`.

- [ ] **Step 7: Run transport and platform tests**

Run:

```bash
npm run build:test
node --test tests/cliManager.test.mjs tests/cliProcessRunner.test.mjs tests/cliPathResolver.test.mjs
node --test --test-name-pattern="native prompt transport arguments|one-shot" tests/promptBuilder.test.mjs tests/extensionActivation.test.mjs
```

Expected: selected tests pass; no test refers to proxy synthesis, profile env,
background processes, attach args, or session reuse.

- [ ] **Step 8: Commit the native transport**

```bash
git add src tests
git commit -m "refactor: launch local CLIs without overrides"
```

---

### Task 4: Simplify Interactive Agent Orchestration

**Files:**
- Modify: `src/sidebarProvider.ts`
- Modify: `src/agentSessionController.ts`
- Modify: `src/assistantTypes.ts`
- Modify: `src/promptBuilder.ts`
- Modify: `src/webviewProtocol.ts`
- Modify: `src/extension.ts`
- Modify: `src/extensionSmokeHarness.ts`
- Delete: `src/openCodeAgentCapability.ts`
- Delete: `src/openCodeServerClient.ts`
- Modify: `tests/promptBuilder.test.mjs`
- Modify: `tests/agentCapabilities.test.mjs`
- Modify: `tests/extensionActivation.test.mjs`
- Modify: `tests/extension-smoke/run.mjs`

**Interfaces:**
- Consumes: native `AgentRuntime.startPrompt(cliId, prompt, options?)`.
- Produces: one process per completed user request, with follow-up history carried in the next prompt.

- [ ] **Step 1: Write failing source and smoke assertions**

Add:

```js
test('interactive requests carry task text but no execution selections', () => {
  const sidebar = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const promptBuilder = readFileSync(new URL('../src/promptBuilder.ts', import.meta.url), 'utf8');
  const assistantTypes = readFileSync(new URL('../src/assistantTypes.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(sidebar, /buildCliOptionArgs|getCliRuntimeMode|getCliPermissionMode/);
  assert.doesNotMatch(sidebar, /continueSessionId|optionKey|apiProviderWarning/);
  assert.doesNotMatch(promptBuilder, /Runtime selection from Agents GUI|renderRuntimeSelection/);
  assert.doesNotMatch(
    assistantTypes,
    /modelVariant|customModel|permissionMode|AssistantRuntimeSelection/
  );
  assert.match(sidebar, /agentRuntime\.startPrompt\(\s*cliId,\s*profile\.inputMode === 'argument' \? prompt : undefined\s*\)/s);
});
```

Extend the smoke harness test to send a completed first request and a follow-up,
then assert two separate `startPrompt` calls and that the second prompt contains
the previous user/assistant conversation text.

- [ ] **Step 2: Run focused red tests**

Run:

```bash
npm run build:test
node --test --test-name-pattern="interactive requests carry" tests/promptBuilder.test.mjs
npm run smoke:extension
```

Expected: source assertions fail on option/session/runtime code; smoke reports
the old session-reuse path.

- [ ] **Step 3: Remove execution selection from types and prompts**

In `src/assistantTypes.ts`:

- delete `AssistantRuntimeSelection`;
- delete `runtime` from `AssistantPromptRequest`;
- delete `model`, `modelVariant`, `customModel`, `runtime`, and
  `permissionMode` from `AssistantWebviewRequest`.

Keep `action`, attachments, conversation history, and context.

In `src/promptBuilder.ts`, delete `renderRuntimeSelection()` and stop appending
it. Task intent continues through the existing `ACTION_INSTRUCTIONS`.

In `src/webviewProtocol.ts`, remove model/runtime/permission fields from
`requestStarted` and profile-state fields that represented execution choices.
Keep observational context-budget fields in `AssistantContextSummary`.

- [ ] **Step 4: Make sidebar requests one-shot**

In `executeAssistantRequest()`:

- resolve only `cliId`, profile, action, user text, context, attachments, and
  prompt;
- use a neutral internal capability posture only for transport availability:

```ts
const capabilityPolicy = resolveAgentCapabilityPolicy({
  intent: resolveAgentTaskIntent(action),
  permissionPosture: 'workspace-write',
});
```

- do not translate the policy into CLI args or environment;
- replace an active process instead of reusing its option/session identity;
- start with:

```ts
const newSession = await this.agentRuntime.startPrompt(
  cliId,
  profile.inputMode === 'argument' ? prompt : undefined
);
```

- send `requestStarted` without model/runtime/permission/provider-warning data.

Delete read-only permission helper methods from editor actions. Editor actions
send only their `action` and prompt/context data.

In `src/agentSessionController.ts`, remove continuation and reuse maps/methods
plus OpenCode event-stream/session-ID access. Keep output buffering, error/end
forwarding, replacement, stop, and stop-all.

- [ ] **Step 5: Remove managed OpenCode server capability**

Delete `src/openCodeAgentCapability.ts` and `src/openCodeServerClient.ts`.
Remove construction/injection from `src/extension.ts`. Remove Sidebar host
messages and handlers that require the managed server:

- `openCodeNativeCommand`;
- `deleteOpenCodeSession`;
- server status lookups;
- session continuation/delete result messages.

Remove corresponding union members from `src/webviewProtocol.ts`. Preserve
direct local CLI discovery and user-triggered CLI authentication.

- [ ] **Step 6: Update smoke harness and focused tests**

Update `SmokeAgentRuntime.startedPrompts` to record:

```ts
Array<{ cliId: string; initialInput?: string; options?: { cwd?: string } }>
```

The second follow-up creates a second process and includes conversation history
in the prompt. Remove smoke expectations for session stdin reuse and OpenCode
server commands.

Run:

```bash
npm run build:test
node --test tests/agentCapabilities.test.mjs tests/extensionActivation.test.mjs
node --test --test-name-pattern="interactive requests carry" tests/promptBuilder.test.mjs
npm run smoke:extension
```

Expected: all selected checks pass.

- [ ] **Step 7: Commit one-shot interaction**

```bash
git add src tests
git commit -m "refactor: make agent requests native one-shot runs"
```

---

### Task 5: Remove Composer Model, Runtime, Permission, Variant, and Managed-Session Controls

**Files:**
- Modify: `media/main.html`
- Modify: `media/main.js`
- Modify: `media/main.css`
- Modify: `media/i18n.js`
- Modify: `media/providerCapabilities.js`
- Modify: `media/providerOptions.js`
- Modify: `media/openCodeDialogState.js`
- Modify: `media/webview-assets.json`
- Modify: `src/cliProfiles.ts`
- Modify: `src/cliDiscovery.ts`
- Modify: `tests/promptBuilder.test.mjs`

**Interfaces:**
- Produces outgoing send requests containing CLI identity, prompt/task/context, attachments, and conversation history only.
- Keeps Agent/CLI selection and task intent; removes execution configuration.

- [ ] **Step 1: Write failing DOM and request-shape assertions**

Add to `tests/promptBuilder.test.mjs`:

```js
test('composer exposes no CLI execution override controls', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const protocol = readFileSync(new URL('../src/webviewProtocol.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /modelSelect|modelOptionList|runtimeSelect|runtimeOptionList/);
  assert.doesNotMatch(html, /permissionSelect|permissionOptionList/);
  assert.doesNotMatch(script, /activeModel|customModel|modelVariant|activeRuntime|activePermission/);
  assert.doesNotMatch(script, /setOpenCodeModelVariant|OPENCODE_OPTION_DIALOG_KINDS/);
  assert.doesNotMatch(protocol, /setOpenCodeModelVariant|modelVariant|customModel/);
  assert.match(
    script,
    /command:\s*'send'[\s\S]*cliId:[\s\S]*text:[\s\S]*action:[\s\S]*conversationHistory:/
  );
});
```

- [ ] **Step 2: Run the focused red test**

Run:

```bash
npm run build:test
node --test --test-name-pattern="composer exposes no CLI execution override controls" tests/promptBuilder.test.mjs
```

Expected: assertions fail on existing model/runtime/permission DOM and JS state.

- [ ] **Step 3: Remove controls and state**

Delete the model, runtime, and permission control groups from
`media/main.html`.

In `media/main.js`, remove:

- model/custom-model/recent/favorite/variant state and persistence;
- runtime and permission state and persistence;
- renderers and menu handlers for those controls;
- `/models`, `/variants`, and managed `/sessions` dialog behavior;
- `setOpenCodeModelVariant`;
- execution fields from send/quick-action payloads;
- request-started rendering that treats those values as selected execution
  state.

Retain Agent/CLI selection, task intent, context refresh, attachments, prompt
text, history, stop, retry, and authentication.

Reduce `media/providerCapabilities.js` and `media/providerOptions.js` to
Agent-mode/task helpers that are still used. Keep
`media/openCodeDialogState.js`, but reduce it to the Agent-dialog command
aliases, query normalization, keyboard navigation, and active-option helpers.
Delete all model, variant, provider grouping, favorite/recent, and managed
session exports. Keep its existing asset-manifest entry because the Agent
dialog still imports it.

Delete orphaned model/runtime/permission CSS and translations.

Remove model-variant/config-changing slash commands from `src/cliProfiles.ts`.
Observational configured-model discovery may remain solely for context budget;
it must expose no argv and no selection action.

- [ ] **Step 4: Run webview-focused tests and preview**

Run:

```bash
npm run build:test
node --test --test-name-pattern="composer exposes no CLI execution override controls|webview asset" tests/promptBuilder.test.mjs tests/extensionActivation.test.mjs
npm run preview:webview
```

Expected: tests pass; preview exits successfully with no missing URI
placeholder or missing DOM binding.

- [ ] **Step 5: Commit Composer cleanup**

```bash
git add media src/cliProfiles.ts src/cliDiscovery.ts tests/promptBuilder.test.mjs
git commit -m "refactor: remove CLI override controls"
```

---

### Task 6: Make SCM Generation Single-CLI and Reject Diagnostic Output

**Files:**
- Modify: `src/textGeneration.ts`
- Modify: `src/cliTextGenerationAdapter.ts`
- Modify: `src/commitMessageCommand.ts`
- Modify: `src/commitMessage.ts`
- Modify: `src/localization.ts`
- Delete: `src/openCodeTaskPolicy.ts`
- Modify: `tests/textGeneration.test.mjs`
- Modify: `tests/commitMessage.test.mjs`
- Modify: `tests/extensionActivation.test.mjs`

**Interfaces:**
- Produces:

```ts
export interface GenerateCommitMessageRequest {
  providerId: string;
  prompt: string;
  repositoryRoot: string;
  language: CommitMessageLanguage;
  diff: string;
  inputMessage: string;
  signal: TextGenerationCancellationSignal;
  onPartial?: (message: string, providerId: string) => void;
}

export interface GenerateCommitMessageResult {
  message: string;
  providerId: string;
}
```

- [ ] **Step 1: Replace fallback tests with single-call tests**

In `tests/textGeneration.test.mjs`:

```js
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
      signal: createSignal(),
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
      signal: createSignal(),
      onPartial: (message) => partials.push(message),
    }),
    (error) => error.code === 'invalid-output'
  );
  assert.deepEqual(partials, []);
});
```

Use the test file's existing cancellation-signal helper name if it differs from
`createSignal`.

In `tests/commitMessage.test.mjs` add:

```js
test('commit cleaner rejects provider and HTTP diagnostics', () => {
  for (const text of [
    'error: missing credentials',
    'Error: request failed',
    'error: Request failed: Bad request (400): Unsupported model MiMo-V2.5-Pro.',
    'api error: 401 unauthorized',
  ]) {
    assert.equal(cleanGeneratedCommitMessage(text), '');
  }
});
```

Reverse source assertions so neither command nor use case contains
`resolveFallbackProviderIds`, `resolveFallbackGenerationProfiles`,
`fallbackFrom`, or fallback-success copy.

- [ ] **Step 2: Run SCM tests and observe red failures**

Run:

```bash
npm run build:test
node --test tests/textGeneration.test.mjs tests/commitMessage.test.mjs
```

Expected: use-case request shape/fallback assertions and lowercase diagnostic
cleaning fail.

- [ ] **Step 3: Simplify the text-generation use case**

Remove `TextGenerationCapabilityPolicy`, `COMMIT_MESSAGE_CAPABILITY_POLICY`,
`capabilities`, fallback resolver, provider loop, and `fallbackFrom`.

Implement one call:

```ts
async execute(request: GenerateCommitMessageRequest): Promise<GenerateCommitMessageResult> {
  this.throwIfCancelled(request.signal, request.providerId);
  const output = await this.generator.generate(
    {
      task: 'commit-message',
      providerId: request.providerId,
      prompt: request.prompt,
      cwd: request.repositoryRoot,
      budgets: COMMIT_MESSAGE_TIME_BUDGETS,
    },
    request.signal,
    (event) => {
      if (event.type !== 'output') return;
      const partial = cleanGeneratedCommitMessage(event.text, {
        language: request.language,
        diff: request.diff,
        inputMessage: request.inputMessage,
      });
      if (partial) request.onPartial?.(partial, request.providerId);
    }
  );
  const message = cleanGeneratedCommitMessage(output, {
    language: request.language,
    diff: request.diff,
    inputMessage: request.inputMessage,
  });
  if (!message) {
    throw new TextGenerationError(
      'invalid-output',
      'The selected CLI did not return a valid commit message.',
      request.providerId
    );
  }
  return { message, providerId: request.providerId };
}
```

- [ ] **Step 4: Remove adapter task-policy injection**

Delete `src/openCodeTaskPolicy.ts`. In `src/cliTextGenerationAdapter.ts`:

- delete provider-runtime, OpenCode-config, permission/runtime/agent-mode
  imports and options;
- options retain only `now?: () => number`;
- launch with:

```ts
const session = await this.cliManager.startPrompt(profile.id, request.prompt, {
  cwd: request.cwd,
});
```

- make provider error recognition case-insensitive:

```ts
function isProviderErrorOutput(text: string): boolean {
  return /^(?:error|api error):\s+\S/i.test(text.trim());
}
```

Do not notify the output observer when the accumulated text is recognized as a
provider diagnostic. Throw `TextGenerationError('provider-error', ...)`.

- [ ] **Step 5: Harden commit cleaning**

At the start of `cleanGeneratedCommitMessage()` reject diagnostics:

```ts
const diagnostic =
  /^(?:error|api error):\s|\b(?:request failed|bad request \(\d{3}\)|unsupported model|available models for this provider)\b/i;
if (diagnostic.test(raw.trim())) {
  return '';
}
```

Restrict Conventional Commit subject types:

```ts
const conventional =
  /\b(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([^)]+\))?!?:\s+\S/;
```

- [ ] **Step 6: Remove command fallback**

In `src/commitMessageCommand.ts`:

- delete `resolveFallbackGenerationProfiles()`;
- pass `providerId: primaryProfile.id`;
- delete fallback result handling and fallback-success messages;
- keep explicit `ask` provider selection before generation;
- report the selected CLI's error directly.

Remove obsolete fallback localization entries.

- [ ] **Step 7: Run SCM and architecture tests**

Run:

```bash
npm run build:test
node --test tests/textGeneration.test.mjs tests/commitMessage.test.mjs
node --test --test-name-pattern="text-generation|commit generation" tests/extensionActivation.test.mjs tests/promptBuilder.test.mjs
```

Expected: selected tests pass; screenshot-equivalent error text never becomes a
partial or final commit message.

- [ ] **Step 8: Commit SCM cleanup**

```bash
git add src tests
git commit -m "fix: keep commit generation on the selected CLI"
```

---

### Task 7: Update Native-Passthrough Documentation and Release 0.0.20

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/architecture/agent-runtime.md`
- Modify: `docs/architecture/task-runtime-control-plane.md`
- Modify: `tests/branding.test.mjs`
- Modify: `tests/extensionActivation.test.mjs`

**Interfaces:**
- Produces: a uniquely versioned package whose documentation matches execution.

- [ ] **Step 1: Add failing release-contract assertions**

Add:

```js
test('release metadata declares native CLI passthrough version 0.0.20', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

  assert.equal(manifest.version, '0.0.20');
  assert.equal(lock.version, '0.0.20');
  assert.equal(lock.packages[''].version, '0.0.20');
  assert.match(readme, /本机 CLI.*自身.*认证.*模型/s);
  assert.match(changelog, /## \[0\.0\.20\]/);
  assert.match(changelog, /原样调用本机 CLI/);
});
```

- [ ] **Step 2: Run the release-contract test and observe red**

Run:

```bash
npm run build:test
node --test --test-name-pattern="native CLI passthrough version" tests/branding.test.mjs tests/extensionActivation.test.mjs
```

Expected: version remains `0.0.19` and documentation copy is absent.

- [ ] **Step 3: Bump version and document behavior**

Set `version` to `0.0.20` in `package.json`, top-level `package-lock.json`, and
`package-lock.json.packages[""]`.

Add `CHANGELOG.md` entry:

```md
## [0.0.20] - 2026-07-30

### Changed

- 原样调用本机安装的 CLI，认证、API、Provider、模型、权限、运行模式、
  MCP、插件和会话策略均由 CLI 自身配置决定。
- 删除 Agents GUI 的自定义 API Provider、模型、运行模式和权限覆盖入口。
- SCM 提交信息只调用所选 CLI，不再自动切换到其他 CLI。
- 首次升级会备份 OpenCode 配置，并仅清理旧版本写入且带标记的 Provider。

### Fixed

- 阻止小写 `error:`、HTTP 错误和模型错误进入 Git 提交信息输入框。
```

Update README and both architecture docs so they explicitly say:

- executable comes from system installation;
- only prompt transport argv and inherited environment are used;
- no automatic fallback;
- no managed OpenCode server or task-policy overlay;
- context/model display is observational only.

Delete statements that promise provider injection, fast-lane configuration
overlays, or background-server attachment.

- [ ] **Step 4: Run documentation and version tests**

Run:

```bash
npm run build:test
node --test tests/branding.test.mjs tests/extensionActivation.test.mjs
```

Expected: selected tests pass.

- [ ] **Step 5: Commit release metadata**

```bash
git add package.json package-lock.json README.md CHANGELOG.md docs/architecture tests
git commit -m "chore: release native CLI passthrough 0.0.20"
```

---

### Task 8: Full Verification, VSIX Audit, and Review

**Files:**
- Verify: all changed files
- Produce: `agents-gui-0.0.20.vsix`

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces: evidence for correctness and package integrity.

- [ ] **Step 1: Check scope before verification**

Run:

```bash
git status --short
git diff --check b7e1a64..HEAD
git diff --stat b7e1a64..HEAD
rg -n "resolveApiProviderRuntime|AGENTS_HUB_API_|OPENAI_MODEL|ANTHROPIC_MODEL|GOOSE_MODEL|AIDER_MODEL|OPENCODE_CONFIG_CONTENT|buildOpenCodeFastGenerationEnv|resolveFallbackProviderIds|resolveFallbackGenerationProfiles" src media
```

Expected:

- only the pre-existing `.neuralmemory/surface.nm` is uncommitted;
- whitespace check exits 0;
- forbidden injection/fallback search returns no matches.

- [ ] **Step 2: Run formatting, lint, type checking, and build**

Run:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run build
```

Expected: every command exits 0.

- [ ] **Step 3: Run the complete test suite**

Run:

```bash
npm test -- --test-concurrency=1
```

Expected: all tests pass, 0 fail, 0 cancelled.

- [ ] **Step 4: Run extension and preview smoke tests**

Run:

```bash
npm run smoke:extension
npm run preview:webview
```

Expected: both commands exit 0 and no missing webview asset/DOM binding is reported.

- [ ] **Step 5: Run release verification and package**

Run:

```bash
npm run verify:release
```

Expected: `Release verification passed.` and
`agents-gui-0.0.20.vsix` exists.

- [ ] **Step 6: Audit VSIX contents**

Run:

```bash
unzip -l agents-gui-0.0.20.vsix
unzip -p agents-gui-0.0.20.vsix extension/package.json | node -e "
let data='';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  const manifest = JSON.parse(data);
  if (manifest.version !== '0.0.20') process.exit(1);
  const properties = manifest.contributes.configuration.properties;
  if (Object.keys(properties).some(key => key.startsWith('agents-gui.apiProviders.'))) process.exit(2);
});
"
unzip -p agents-gui-0.0.20.vsix extension/dist/extension.js | rg "AGENTS_HUB_API_|OPENAI_MODEL|ANTHROPIC_MODEL|GOOSE_MODEL|AIDER_MODEL|OPENCODE_CONFIG_CONTENT"
```

Expected:

- manifest check exits 0;
- final forbidden-string search returns no matches;
- package contains no bundled Node executable, `node_modules`, worktrees,
  Neural Memory data, plans, specs, tests, or credentials.

- [ ] **Step 7: Request two-stage code review**

Dispatch one review for spec compliance and one review for code quality. Both
reviews must inspect the actual diff and test evidence. Resolve every Critical
or Important finding with a new failing regression test, implementation,
focused verification, and commit.

- [ ] **Step 8: Re-run final verification after review fixes**

Run again:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test -- --test-concurrency=1
npm run verify:release
git status --short
```

Expected: all commands exit 0; only the preserved
`.neuralmemory/surface.nm` change remains uncommitted.
