# Agent Capability Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a provider-independent capability policy and transport
registry for interactive agent requests, then use it as a compatibility gate in
the existing CLI execution path.

**Architecture:** Keep Agents GUI as a modular monolith. Put task intent,
permission posture, capability policy, and transport selection in a pure domain
module. Keep CLI profile declarations and registry construction in an adapter
module. The existing `AgentRuntime` remains the execution compatibility port
until ACP and provider-native execution adapters are introduced in a later
slice.

**Tech Stack:** TypeScript, Node test runner, VS Code extension host, existing
CLI profiles and runtime.

## Global Constraints

- Work directly in the current dirty `main` worktree as approved by the user.
- Preserve existing staged and unstaged user changes.
- Do not create a commit or push.
- Do not add an ACP dependency in this slice.
- Domain policy modules must not import `vscode`, `child_process`, or
  `CliManager`.
- Existing provider behavior and session lifecycle must remain unchanged.

---

### Task 1: Pure agent capability policy

**Files:**
- Create: `src/agentCapabilities.ts`
- Create: `tests/agentCapabilities.test.mjs`

**Interfaces:**
- Produces:
  - `AgentTaskIntent`
  - `AgentPermissionPosture`
  - `AgentCapability`
  - `AgentCapabilityPolicy`
  - `resolveAgentTaskIntent(action, agentModeId)`
  - `resolveAgentCapabilityPolicy(options)`

- [x] **Step 1: Write failing policy tests**

Add Node tests that import the compiled module and assert:

```js
assert.equal(resolveAgentTaskIntent('freeform', 'plan'), 'planning');
assert.equal(resolveAgentTaskIntent('reviewFile', 'build'), 'review');

assert.deepEqual(
  resolveAgentCapabilityPolicy({
    intent: 'planning',
    permissionPosture: 'unrestricted',
  }),
  {
    required: ['workspace.read'],
    allowed: ['workspace.read'],
    denied: ['workspace.write', 'terminal.execute', 'sandbox.bypass'],
  }
);

assert.deepEqual(
  resolveAgentCapabilityPolicy({
    intent: 'implementation',
    permissionPosture: 'workspace-write',
  }),
  {
    required: ['workspace.read', 'workspace.write'],
    allowed: ['workspace.read', 'workspace.write', 'terminal.execute'],
    denied: ['sandbox.bypass'],
  }
);
```

Also cover read-only implementation, review, freeform, and resumed sessions.

- [x] **Step 2: Run the tests and verify RED**

Run:

```bash
npm run build:test
node --test tests/agentCapabilities.test.mjs
```

Expected: failure because `.test-dist/agentCapabilities.js` does not exist.

- [x] **Step 3: Implement the pure resolver**

Create a framework-free module with these exact capability values:

```ts
export type AgentCapability =
  | 'workspace.read'
  | 'workspace.write'
  | 'terminal.execute'
  | 'sandbox.bypass'
  | 'session.resume';

export type AgentPermissionPosture =
  | 'read-only'
  | 'workspace-write'
  | 'unrestricted';

export interface AgentCapabilityPolicy {
  required: AgentCapability[];
  allowed: AgentCapability[];
  denied: AgentCapability[];
}
```

Map explicit editor actions before agent-mode fallbacks. Planning and explanation
must remain read-only even when the selected permission posture is broader.
Implementation, tests, and refactor require workspace writes unless the selected
posture is read-only. A requested continuation adds `session.resume` to both
`required` and `allowed`.

- [x] **Step 4: Run the tests and verify GREEN**

Expected: every policy test passes.

---

### Task 2: Capability-aware transport registry

**Files:**
- Modify: `src/agentCapabilities.ts`
- Modify: `tests/agentCapabilities.test.mjs`

**Interfaces:**
- Produces:
  - `AgentTransportKind`
  - `AgentTransportDescriptor`
  - `AgentProviderCapabilityDescriptor`
  - `AgentCapabilityResolution`
  - `AgentCapabilityResolutionError`
  - `AgentCapabilityRegistry`

- [x] **Step 1: Write failing registry tests**

Add tests for these behaviors:

```js
const registry = new AgentCapabilityRegistry([
  {
    providerId: 'demo',
    transports: [
      { kind: 'cli', capabilities: ['workspace.read'] },
      {
        kind: 'acp',
        capabilities: ['workspace.read', 'workspace.write'],
      },
    ],
  },
]);

assert.equal(
  registry.resolve('demo', {
    required: ['workspace.read', 'workspace.write'],
    allowed: ['workspace.read', 'workspace.write'],
    denied: [],
  }).transport,
  'acp'
);
```

Also assert that ACP wins over native and CLI when all satisfy the policy, that a
capability-rich native adapter wins when ACP cannot satisfy the policy, and that
an unknown or incompatible provider throws `AgentCapabilityResolutionError`
with a stable code and missing-capability list.

- [x] **Step 2: Run the tests and verify RED**

Expected: failure because the registry types and class are not exported.

- [x] **Step 3: Implement minimal registry behavior**

Use the preference order:

```ts
const TRANSPORT_PREFERENCE: AgentTransportKind[] = ['acp', 'native', 'cli'];
```

Filter out candidates that do not contain every required capability, select the
first compatible transport by preference, and calculate granted capabilities as
the intersection of policy `allowed` and transport capabilities. Do not inspect
CLI arguments or provider-specific configuration.

- [x] **Step 4: Run the tests and verify GREEN**

Expected: all policy and registry tests pass.

---

### Task 3: Explicit CLI capability declarations

**Files:**
- Create: `src/cliAgentCapabilities.ts`
- Modify: `src/cliProfiles.ts`
- Modify: `tests/agentCapabilities.test.mjs`

**Interfaces:**
- Consumes: `AgentCapabilityRegistry`, `AgentCapability`,
  `AgentPermissionPosture`.
- Produces:
  - `CliProfile.executionCapabilities`
  - `CliPermissionMode.posture`
  - `createCliAgentCapabilityRegistry(profiles)`

- [x] **Step 1: Write failing declaration tests**

Assert every `CLI_PROFILES` entry has an explicit execution capability list and
every declared permission mode has a posture. Assert OpenCode includes
`session.resume`, Claude and Codex dangerous modes include
`sandbox.bypass`, and the factory resolves every provider through its CLI
transport.

- [x] **Step 2: Run the tests and verify RED**

Expected: failure because CLI profiles do not yet expose typed execution
capabilities or permission posture.

- [x] **Step 3: Add explicit adapter metadata**

Add:

```ts
executionCapabilities: AgentCapability[];
```

to `CliProfile`, and:

```ts
posture: AgentPermissionPosture;
```

to `CliPermissionMode`.

Declare `workspace.read`, `workspace.write`, and `terminal.execute` for each
current CLI provider. Add `session.resume` only where current execution supports
continuation. Add `sandbox.bypass` only for providers with an explicit dangerous
permission mode.

The factory must register one `cli` transport per profile and must not mutate
the profile arrays.

- [x] **Step 4: Run the tests and verify GREEN**

Expected: all capability tests pass.

---

### Task 4: Gate interactive requests through the registry

**Files:**
- Modify: `src/sidebarProvider.ts`
- Modify: `src/extension.ts`
- Modify: `tests/extensionActivation.test.mjs`
- Modify: `docs/architecture/task-runtime-control-plane.md`

**Interfaces:**
- Consumes: task-intent resolver, policy resolver, capability registry.
- Produces: capability compatibility validation before starting a new CLI
  session.

- [x] **Step 1: Write failing architecture assertions**

Assert that:

```js
assert.match(extensionSource, /createCliAgentCapabilityRegistry/);
assert.match(sidebarSource, /resolveAgentCapabilityPolicy/);
assert.match(sidebarSource, /agentCapabilityRegistry\.resolve/);
assert.match(architectureDoc, /capability registry/i);
assert.match(architectureDoc, /ACP.*native.*CLI/i);
```

Also assert that `src/agentCapabilities.ts` does not import VS Code,
`CliManager`, or child processes.

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm run build:test
node --test tests/agentCapabilities.test.mjs tests/extensionActivation.test.mjs
```

Expected: architecture assertions fail because the registry is not wired.

- [x] **Step 3: Wire the compatibility gate**

Construct the registry once in `extension.ts` and pass it through
`SidebarProviderOptions`. Before a new agent request starts, resolve:

```ts
const intent = resolveAgentTaskIntent(action, agentMode.id);
const capabilityPolicy = resolveAgentCapabilityPolicy({
  intent,
  permissionPosture: permissionMode.posture,
  resumeSession: Boolean(continueSessionId),
});
const capabilityResolution = this.agentCapabilityRegistry.resolve(
  cliId,
  capabilityPolicy
);
```

Require the selected transport to be `cli` in this compatibility slice. Report a
typed resolution error through the existing error channel. Do not change prompt
text, CLI arguments, or session reuse behavior.

- [x] **Step 4: Document the boundary**

Extend the approved architecture document with:

- policy inputs and capability vocabulary;
- required/allowed/denied semantics;
- transport selection order;
- current CLI-only registry state;
- the next step: structured `AgentExecutionPort` requests and ACP/native
  adapters.

- [x] **Step 5: Run focused tests and verify GREEN**

Expected: capability and activation tests pass.

---

### Task 5: Verification and handoff

**Files:**
- No production files unless verification exposes a defect.

**Interfaces:**
- Consumes: all completed tasks.
- Produces: fresh verification evidence.

- [x] **Step 1: Run static verification**

```bash
npm run typecheck
npm run lint
npx prettier --check src/agentCapabilities.ts src/cliAgentCapabilities.ts src/cliProfiles.ts src/sidebarProvider.ts src/extension.ts tests/agentCapabilities.test.mjs tests/extensionActivation.test.mjs docs/architecture/task-runtime-control-plane.md
git diff --check
```

- [x] **Step 2: Run focused tests**

```bash
npm run build:test
node --test tests/agentCapabilities.test.mjs tests/extensionActivation.test.mjs tests/textGeneration.test.mjs
```

Expected: all focused tests pass.

Actual: 36 focused tests passed.

- [x] **Step 3: Run the full suite**

Run: `npm test`

Expected: all new tests pass. Record the pre-existing WebView authoritative-model
assertion separately if it remains the only failure.

Actual: 255 tests ran, 254 passed, and the pre-existing WebView
authoritative-model assertion remained the only failure.

- [x] **Step 4: Build the extension**

Run: `npm run build`

Expected: `Build complete.`

Actual: the production build and Extension Host smoke test both exited 0.

- [x] **Step 5: Hand off without committing**

Report the new boundary, verification evidence, known baseline failure, and next
migration slice. Preserve the current working tree and index.
