# Commit Generation Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route Git commit-message generation through an isolated, task-scoped
text-generation lane instead of the general interactive Agent CLI path.

**Architecture:** Add framework-free generation ports and a commit use case, then
implement them with a CLI adapter. OpenCode receives an in-memory policy overlay
that disables MCP, tools, project configuration, and plugins for this task.

**Tech Stack:** TypeScript, VS Code extension APIs, Node test runner, OpenCode CLI

## Global Constraints

- Preserve every pre-existing staged and unstaged user change.
- Work directly on the current `main` branch as explicitly authorized.
- Do not create a Git commit because target files already contain user changes.
- Write a failing test before each production behavior.
- Commands and use cases must not depend on concrete CLI process details.
- Existing interactive agent behavior must remain unchanged.
- Commit generation must use the selected repository root, not the first workspace.

---

### Task 1: Task-scoped OpenCode policy

**Files:**
- Create: `src/openCodeTaskPolicy.ts`
- Create: `tests/textGeneration.test.mjs`

**Interfaces:**
- Produces: `buildOpenCodeFastGenerationEnv(baseEnv, globalConfig)`
- Produces: `OpenCodeTaskEnvironment`

- [x] **Step 1: Write the failing policy tests**

Add tests proving that the generated environment:

```js
const result = buildOpenCodeFastGenerationEnv(
  { OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: { inline: { type: 'remote' } } }) },
  { mcp: { global: { type: 'local' } }, plugin: ['external-plugin'] }
);

assert.equal(JSON.parse(result.OPENCODE_CONFIG_CONTENT).mcp.global.enabled, false);
assert.equal(JSON.parse(result.OPENCODE_CONFIG_CONTENT).mcp.inline.enabled, false);
assert.deepEqual(JSON.parse(result.OPENCODE_CONFIG_CONTENT).permission, { '*': 'deny' });
assert.deepEqual(JSON.parse(result.OPENCODE_CONFIG_CONTENT).plugin, []);
assert.equal(result.OPENCODE_DISABLE_PROJECT_CONFIG, '1');
assert.equal(result.OPENCODE_PURE, '1');
```

- [x] **Step 2: Run the test and verify RED**

Run: `npm run build:test && node --test tests/textGeneration.test.mjs`

Expected: FAIL because `.test-dist/openCodeTaskPolicy.js` does not exist.

- [x] **Step 3: Implement the pure policy builder**

Parse existing inline content safely, collect MCP names from inline and global
configuration, overlay `{ enabled: false }`, deny all permissions, clear plugins,
and return OpenCode's project/plugin/background-work isolation variables.

- [x] **Step 4: Run the test and verify GREEN**

Run: `npm run build:test && node --test tests/textGeneration.test.mjs`

Expected: all policy tests pass.

### Task 2: Generation contracts and commit use case

**Files:**
- Create: `src/textGeneration.ts`
- Modify: `tests/textGeneration.test.mjs`

**Interfaces:**
- Produces: `TextGenerationPort.generate(request, signal, observer)`
- Produces: `TextGenerationProviderRegistry.isAvailable(providerId)`
- Produces: `GenerateCommitMessageUseCase.execute(request)`
- Consumes: `cleanGeneratedCommitMessage`

- [x] **Step 1: Write failing use-case tests**

Use an in-memory generator to prove:

```js
const useCase = new GenerateCommitMessageUseCase(fakeGenerator);
const result = await useCase.execute({
  primaryProviderId: 'opencode',
  resolveFallbackProviderIds: async () => ['codex'],
  prompt: 'prompt',
  repositoryRoot: '/repo-b',
  language: 'en',
  diff: 'diff --git ...',
  inputMessage: '',
  signal,
});

assert.equal(fakeGenerator.requests[0].cwd, '/repo-b');
assert.equal(fakeGenerator.requests[0].capabilities.mcp, 'disabled');
assert.equal(result.providerId, 'codex');
assert.equal(result.fallbackFrom, 'opencode');
```

Also prove cancellation never triggers fallback and invalid output does trigger
fallback.

- [x] **Step 2: Run the test and verify RED**

Run: `npm run build:test && node --test tests/textGeneration.test.mjs`

Expected: FAIL because the generation contracts and use case do not exist.

- [x] **Step 3: Implement the minimal contracts and use case**

Define immutable request, policy, budget, cancellation, result, and event types.
Implement fallback around the port and validate partial/final messages with the
existing pure commit-message cleaner.

- [x] **Step 4: Run the test and verify GREEN**

Run: `npm run build:test && node --test tests/textGeneration.test.mjs`

Expected: all policy and use-case tests pass.

### Task 3: CLI generation adapter and phase supervisor

**Files:**
- Create: `src/cliTextGenerationAdapter.ts`
- Modify: `src/cliManager.ts`
- Modify: `tests/textGeneration.test.mjs`

**Interfaces:**
- Consumes: `TextGenerationPort`, `TextGenerationProviderRegistry`
- Consumes: `CliManager.startPrompt(..., { cwd })`
- Produces: `CliTextGenerationAdapter`

- [x] **Step 1: Write failing adapter tests**

Create a fake CLI manager and fake session event source. Prove:

- the request `cwd` is passed to `startPrompt`;
- OpenCode receives the isolated task environment;
- background-server attachment is disabled;
- first-output timeout stops the spawned session;
- output events are normalized and returned;
- cancellation stops the session.

- [x] **Step 2: Run the test and verify RED**

Run: `npm run build:test && node --test tests/textGeneration.test.mjs`

Expected: FAIL because `CliTextGenerationAdapter` does not exist and
`StartPromptOptions` has no explicit `cwd`.

- [x] **Step 3: Add explicit `cwd` to `CliManager`**

Export `StartPromptOptions`, add `cwd?: string`, and resolve it with:

```ts
const cwd = options.cwd?.trim() || this.getWorkspaceRoot();
```

Keep the old fallback for interactive calls.

- [x] **Step 4: Implement the adapter**

Move commit-only profile argument resolution, output buffering, cancellation,
and timeout supervision into the adapter. Emit phase events and use the OpenCode
policy only when the task disables MCP/tools/project config/plugins.

- [x] **Step 5: Run the test and verify GREEN**

Run: `npm run build:test && node --test tests/textGeneration.test.mjs`

Expected: all adapter contract tests pass.

### Task 4: Route the VS Code commit command through the new lane

**Files:**
- Modify: `src/commitMessageCommand.ts`
- Modify: `src/extension.ts`
- Modify: `tests/commitMessage.test.mjs`
- Modify: `tests/extensionActivation.test.mjs`
- Modify: `docs/architecture/agent-runtime.md`

**Interfaces:**
- Consumes: `GenerateCommitMessageUseCase`
- Consumes: `TextGenerationProviderRegistry`
- Produces: existing `agents-gui.generateCommitMessage` command behavior

- [x] **Step 1: Update architecture assertions and watch them fail**

Assert that the commit command imports the generation use case and does not
import `CliManager`, `Session`, provider API runtime, or CLI output normalizers.
Assert that `extension.ts` wires `CliTextGenerationAdapter`.

Run:
`npm run build:test && node --test tests/commitMessage.test.mjs tests/extensionActivation.test.mjs`

Expected: FAIL against the old direct `CliManager` dependency.

- [x] **Step 2: Rewire the command**

Inject the provider registry and commit use case, preserve repository selection,
progress UI, localized messages, streaming input updates, cancellation, and
fallback notifications.

- [x] **Step 3: Wire the adapter in `extension.ts`**

Instantiate the CLI adapter with:

- `CliManager`;
- a VS Code configuration reader for API provider settings;
- `OpenCodeConfigSync.readConfig`.

Pass the adapter and use case into `CommitMessageCommand`.

- [x] **Step 4: Update the architecture document**

Link `docs/architecture/task-runtime-control-plane.md` and describe the
generation-lane dependency rule.

- [x] **Step 5: Run focused tests**

Run:
`npm run build:test && node --test tests/textGeneration.test.mjs tests/commitMessage.test.mjs tests/extensionActivation.test.mjs`

Expected: all focused tests pass.

### Task 5: Verification and manual latency probe

**Files:**
- No production files unless verification exposes a defect.

**Interfaces:**
- Consumes: all completed tasks.
- Produces: fresh verification evidence.

- [x] **Step 1: Run static verification**

Run:

```bash
npm run typecheck
npm run lint
npm run format:check
```

Expected: exit code 0 for every command.

Actual: typecheck and lint exit 0; all task-scoped files pass Prettier. The
repository-wide format check still reports the pre-existing unrelated
`src/openCodeConfigSync.ts` worktree change.

- [x] **Step 2: Run the full automated suite**

Run: `npm test`

Expected: all task-related tests pass. Record the pre-existing WebView
authoritative-model assertion separately if it remains the only failure.

Actual: all task-related tests pass; the pre-existing WebView
authoritative-model assertion remains the only full-suite failure (241 tests,
240 passed, 1 failed).

- [x] **Step 3: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
git diff -- src/openCodeTaskPolicy.ts src/textGeneration.ts src/cliTextGenerationAdapter.ts src/cliManager.ts src/commitMessageCommand.ts src/extension.ts tests/textGeneration.test.mjs tests/commitMessage.test.mjs tests/extensionActivation.test.mjs docs/architecture
```

Expected: no whitespace errors and no unrelated files changed by this work.

- [x] **Step 4: Run a safe OpenCode timing probe**

Run one non-mutating text-only OpenCode request through the same isolation
environment and record total duration. Do not expose configuration contents or
credentials in output.

Actual: OpenCode 1.18.4 completed with all 22 configured MCP servers disabled.
First output arrived in 2.67 seconds and the request completed in 6.75 seconds,
compared with the approximately 68-second unisolated baseline.

- [x] **Step 5: Hand off without committing**

Report changed boundaries, focused/full verification evidence, the baseline
failure if still present, and the next migration slice. Leave all changes in the
working tree for the user to review.
