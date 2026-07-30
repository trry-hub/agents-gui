# Node 22 Release and Stale-Lock Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the two remaining release blockers by adopting a Node 22 engineering toolchain with one locked local VSCE and by making the OpenCode cleanup lock recover safely after a crashed owner.

**Architecture:** Keep extension runtime compatibility and native CLI passthrough untouched. Isolate engineering-toolchain policy in testable scripts, isolate lock ownership/recovery in a dedicated OpenCode cleanup-lock module, integrate it through the existing migration, then rebuild and publish only the audited VSIX.

**Tech Stack:** TypeScript 5, Node.js 22.22.1+, Node core `fs`/`crypto`/`os`/`process` APIs, VS Code Extension API `^1.85.0`, `@vscode/vsce` `3.9.2`, GitHub Actions, Node's built-in test runner, esbuild.

## Global Constraints

- Node `22.22.1` is the minimum development, test, packaging, and publishing runtime.
- Keep extension installation compatibility at `engines.vscode: ^1.85.0`; do not add a system-Node requirement for extension users.
- Pin `@vscode/vsce` exactly to `3.9.2`; every packaging and publishing path must resolve the repository-local binary.
- CI consists of Ubuntu latest on Node 22 and Windows latest on Node 22; the Ubuntu job must package the VSIX.
- The release workflow must not invoke VSCE through `npx`, install fallback, or a global binary.
- Do not change CLI discovery, executable choice, arguments, environment, working directory, prompt semantics, provider/model selection, or session behavior.
- Do not bundle Node.js, npm, VSCE, `node_modules`, source, tests, worktrees, credentials, or SDD artifacts in the VSIX.
- New behavioral code follows red-green-refactor: every production behavior must first be demonstrated by a correctly failing focused test.
- OpenCode cleanup remains marker-scoped, backup-first, mode-preserving, source-checked, atomic, and disabled only for OpenCode when a real cleanup failure occurs.
- A lock attributable to a live or unknown owner must never be removed.
- Structured same-host and legacy PID-only dead locks are recoverable; fresh malformed locks are protected for exactly `300_000` milliseconds.
- The current Marketplace release is uploaded through the logged-in browser, not through a CLI.

---

## File responsibility map

- `scripts/node-version-policy.mjs`: pure Node-version parsing and support decision.
- `scripts/assert-node-version.mjs`: command-line guard around the pure policy.
- `tests/toolchainPolicy.test.mjs`: behavioral and repository-contract tests for Node, CI, VSCE, and release entry points.
- `.nvmrc`: selects the current Node 22 line for contributors.
- `package.json` / `package-lock.json`: exact VSCE dependency and local npm-script entry points.
- `.github/workflows/ci.yml`: Ubuntu/Windows Node 22 quality matrix and Ubuntu packaging gate.
- `.github/workflows/release.yml`: Node 22 package/publish flow using only the local VSCE.
- `README.md`: separates extension-user requirements from engineering-toolchain requirements.
- `src/openCodeCleanupLock.ts`: bounded owner record, liveness probe, exclusive acquisition, abandoned-owner recovery, and ownership-safe release.
- `src/openCodeConfigCleanup.ts`: delegates locking to `openCodeCleanupLock` while preserving migration behavior.
- `tests/openCodeCleanupLock.test.mjs`: focused lock ownership, recovery, race, and release tests.
- `tests/openCodeConfigCleanup.test.mjs`: migration-level integration and activation-gating regressions.
- `tests/branding.test.mjs`: packaged/release metadata and local-VSCE assertions that already belong to release branding coverage.

---

### Task 1: Enforce the Node 22 local release toolchain

**Files:**
- Create: `.nvmrc`
- Create: `scripts/node-version-policy.mjs`
- Create: `scripts/assert-node-version.mjs`
- Create: `tests/toolchainPolicy.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `README.md`
- Modify: `tests/branding.test.mjs`

**Interfaces:**
- Produces:
  - `MINIMUM_NODE_VERSION` equal to the frozen tuple `{ major: 22, minor: 22, patch: 1 }`
  - `parseNodeVersion(value: string): { major: number; minor: number; patch: number } | undefined`
  - `isSupportedNodeVersion(value: string): boolean`
  - `assertSupportedNodeVersion(value?: string): void`
  - npm script `check:node`
  - npm script `publish:vsix`
- Consumes: existing `package.json` scripts, release verifier, CI workflows, and `agents-gui-0.0.20.vsix` naming contract.

- [ ] **Step 1: Write the failing pure policy tests**

Create `tests/toolchainPolicy.test.mjs` with tests that import the wished-for API and assert:

```js
assert.equal(isSupportedNodeVersion('18.20.8'), false);
assert.equal(isSupportedNodeVersion('20.19.5'), false);
assert.equal(isSupportedNodeVersion('22.22.0'), false);
assert.equal(isSupportedNodeVersion('22.22.1'), true);
assert.equal(isSupportedNodeVersion('22.30.0'), true);
assert.equal(isSupportedNodeVersion('24.0.0'), true);
assert.equal(isSupportedNodeVersion('v22.22.1'), true);
assert.equal(isSupportedNodeVersion('not-a-version'), false);
assert.throws(
  () => assertSupportedNodeVersion('20.19.5'),
  /Node\\.js 22\\.22\\.1 or newer is required/
);
```

Also assert `MINIMUM_NODE_VERSION` exactly equals `{ major: 22, minor: 22, patch: 1 }`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/toolchainPolicy.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/node-version-policy.mjs`.

- [ ] **Step 3: Implement the minimal pure policy and CLI guard**

Create `scripts/node-version-policy.mjs` with no dependencies and this public shape:

```js
export const MINIMUM_NODE_VERSION = Object.freeze({
  major: 22,
  minor: 22,
  patch: 1,
});

export function parseNodeVersion(value) {
  const match = /^v?(\\d+)\\.(\\d+)\\.(\\d+)(?:[-+].*)?$/.exec(String(value || '').trim());
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function isSupportedNodeVersion(value) {
  const parsed = parseNodeVersion(value);
  if (!parsed) return false;
  if (parsed.major !== MINIMUM_NODE_VERSION.major) {
    return parsed.major > MINIMUM_NODE_VERSION.major;
  }
  if (parsed.minor !== MINIMUM_NODE_VERSION.minor) {
    return parsed.minor > MINIMUM_NODE_VERSION.minor;
  }
  return parsed.patch >= MINIMUM_NODE_VERSION.patch;
}

export function assertSupportedNodeVersion(value = process.versions.node) {
  if (!isSupportedNodeVersion(value)) {
    throw new Error(
      `Node.js 22.22.1 or newer is required for Agents GUI engineering tasks; current ${value}.`
    );
  }
}
```

Create `scripts/assert-node-version.mjs`:

```js
#!/usr/bin/env node
import { assertSupportedNodeVersion } from './node-version-policy.mjs';

try {
  assertSupportedNodeVersion();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
```

- [ ] **Step 4: Run the policy tests and verify GREEN**

Run:

```bash
node --test tests/toolchainPolicy.test.mjs
```

Expected: all policy tests PASS.

- [ ] **Step 5: Add failing repository-contract tests**

Extend `tests/toolchainPolicy.test.mjs` and update the existing release assertion in `tests/branding.test.mjs` to require:

```js
assert.equal(readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim(), '22');
assert.equal(manifest.devDependencies['@vscode/vsce'], '3.9.2');
assert.equal(lock.packages['node_modules/@vscode/vsce'].version, '3.9.2');
assert.equal(manifest.scripts['check:node'], 'node scripts/assert-node-version.mjs');
assert.equal(manifest.scripts['publish:vsix'], 'npm run check:node && vsce publish');
assert.doesNotMatch(releaseWorkflow, /npx[^\\n]*@vscode\\/vsce|npm exec[^\\n]*vsce/i);
assert.match(releaseWorkflow, /npm run publish:vsix -- --packagePath/);
assert.deepEqual(
  [...ciWorkflow.matchAll(/node-version:\\s*(?:\"|')?([^\\s\"']+)/g)].map((match) => match[1]),
  ['22.x', '22.x']
);
assert.match(ciWorkflow, /windows-node-22/);
assert.match(ciWorkflow, /ubuntu-node-22/);
assert.match(ciWorkflow, /npm run package/);
assert.equal(manifest.engines.vscode, '^1.85.0');
assert.equal(Object.hasOwn(manifest.engines, 'node'), false);
```

The workflow parser may normalize YAML text with regular expressions, but assertions must verify behaviorally meaningful exact values and prohibit every VSCE network-install path.

- [ ] **Step 6: Run the repository-contract tests and verify RED**

Run:

```bash
node --test tests/toolchainPolicy.test.mjs tests/branding.test.mjs
```

Expected failures:

- `.nvmrc` missing;
- VSCE is `2.32.0`;
- CI still contains Node 18/20;
- release workflow still contains `npx --yes @vscode/vsce publish`;
- Node guard and `publish:vsix` scripts are missing.

- [ ] **Step 7: Implement the Node 22 repository contract**

Make these exact changes:

1. `.nvmrc` contains:

   ```text
   22
   ```

2. Add `check:node`; run it explicitly in install, build, build-test, test,
   verify-release, package, and publish entry points so those commands cannot run
   under an older Node:

   ```json
   {
     "check:node": "node scripts/assert-node-version.mjs",
     "preinstall": "node scripts/assert-node-version.mjs",
     "build": "npm run check:node && node esbuild.mjs",
     "build:test": "npm run check:node && node esbuild.mjs && tsc -p tsconfig.json --outDir .test-dist --rootDir src --module commonjs",
     "test": "npm run check:node && npm run build:test && node scripts/run-tests.mjs",
     "verify:release": "npm run check:node && node scripts/verify-release.mjs",
     "package": "npm run check:node && npm run build && vsce package",
     "publish:vsix": "npm run check:node && vsce publish"
   }
   ```

3. Change `publish:manual` to:

   ```text
   npm run package && npm run publish:vsix -- --packagePath agents-gui-${npm_package_version}.vsix
   ```

4. Upgrade the lockfile using:

   ```bash
   npm install --save-dev --save-exact @vscode/vsce@3.9.2
   ```

5. Replace the CI matrix with exactly:

   ```yaml
   include:
     - name: ubuntu-node-22
       os: ubuntu-latest
       node-version: 22.x
     - name: windows-node-22
       os: windows-latest
       node-version: 22.x
   ```

6. Add `npm run package` after tests only when
   `matrix.name == 'ubuntu-node-22'`.

7. Keep release workflow setup on Node `22.x`. Replace the publish command with:

   ```yaml
   npm run publish:vsix -- \
     --packagePath "agents-gui-${VERSION}.vsix"
   ```

   Keep `VSCE_PAT` in the environment and remove the CLI `--pat` argument.

8. In README, remove Node from end-user requirements. Add a separate contributor
   requirement stating `Node.js 22.22.1+` and `npm ci` for development,
   testing, packaging, and publishing.

- [ ] **Step 8: Run focused tests and local tool probes**

Run:

```bash
node --test tests/toolchainPolicy.test.mjs tests/branding.test.mjs
npm run check:node
./node_modules/.bin/vsce --version
npm audit --omit=dev
npm audit
```

Expected:

- focused tests PASS;
- Node guard exits 0 on the current Node 22+ runtime;
- VSCE prints exactly `3.9.2`;
- production audit reports 0 vulnerabilities;
- record the full development audit result rather than suppressing it.

- [ ] **Step 9: Commit Task 1**

```bash
git add .nvmrc scripts/node-version-policy.mjs scripts/assert-node-version.mjs \
  tests/toolchainPolicy.test.mjs tests/branding.test.mjs package.json package-lock.json \
  .github/workflows/ci.yml .github/workflows/release.yml README.md
git commit -m "build: require Node 22 release toolchain"
```

---

### Task 2: Add an owner-aware recoverable OpenCode cleanup lock

**Files:**
- Create: `src/openCodeCleanupLock.ts`
- Create: `tests/openCodeCleanupLock.test.mjs`

**Interfaces:**
- Produces:

```ts
export type ProcessLiveness = 'alive' | 'dead' | 'unknown';

export interface OpenCodeCleanupLockOptions {
  pid?: number;
  hostname?: string;
  tokenFactory?: () => string;
  now?: () => number;
  processLiveness?: (pid: number) => ProcessLiveness;
  retryAttempts?: number;
  retryDelayMs?: number;
  malformedGraceMs?: number;
}

export interface OpenCodeCleanupLock {
  readonly path: string;
  readonly token: string;
  release(): Promise<void>;
}

export const OPEN_CODE_CLEANUP_LOCK_RECORD_VERSION = 1;
export const OPEN_CODE_CLEANUP_MALFORMED_GRACE_MS = 300_000;

export function probeProcessLiveness(pid: number): ProcessLiveness;
export async function acquireOpenCodeCleanupLock(
  lockPath: string,
  options?: OpenCodeCleanupLockOptions
): Promise<OpenCodeCleanupLock>;
```

- Consumes: Node core `fs`, `crypto.randomUUID`, `os.hostname`, and `process.kill`.
- Does not know about OpenCode config parsing, backups, activation, or VS Code state.

- [ ] **Step 1: Write failing liveness and owner-record tests**

Create `tests/openCodeCleanupLock.test.mjs` with deterministic temp directories and
injected dependencies. Cover:

- `probeProcessLiveness` returns `alive` on success;
- `EPERM` returns `alive`;
- `ESRCH` returns `dead`;
- every other error returns `unknown`;
- acquired file is mode `0600`, valid bounded JSON plus newline, and contains exact
  version/PID/hostname/token/creation time;
- a second contender sees the first injected PID as live and exhausts bounded
  retries without deleting or changing the lock.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build:test
node --test tests/openCodeCleanupLock.test.mjs
```

Expected: FAIL because `.test-dist/openCodeCleanupLock.js` does not exist.

- [ ] **Step 3: Implement the minimal owner record and live-owner behavior**

Implement:

- maximum lock record size `4_096` bytes;
- maximum hostname length `255`;
- maximum token length `256`;
- positive safe-integer PID validation;
- `wx` creation with mode `0o600`;
- write, chmod, and file fsync before returning an owner;
- owner record token/path/file-identity verification before returning;
- bounded retry loop using existing defaults of 80 attempts and 25 milliseconds;
- `probeProcessLiveness` mapping exactly as the interface describes.

Treat structured records from a different hostname as `unknown`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npm run build:test
node --test tests/openCodeCleanupLock.test.mjs
```

Expected: the owner-record and live-owner cases PASS.

- [ ] **Step 5: Write failing abandoned-owner and race tests**

Add tests for:

1. same-host structured dead PID is quarantined and replaced;
2. legacy content `"4321\n"` with dead PID is recovered;
3. fresh empty and malformed files are preserved;
4. empty and malformed files older than `300_000` ms require two unchanged
   snapshots separated by at least one retry delay before recovery;
5. changing bytes or file identity during recovery causes a retry and leaves the
   replacement untouched;
6. an acquirer whose provisional file was displaced fails ownership verification
   and never returns an acquired lock;
7. `release()` deletes the path only while bytes, token, and file identity still
   identify that owner;
8. replacing the path before `release()` preserves the replacement;
9. two contenders recovering one dead owner yield exactly one acquired owner and
   never delete the winner;
10. quarantine artifacts are removed after successful recovery and retained only
    when non-destructive restoration cannot be guaranteed.

- [ ] **Step 6: Run the new cases and verify RED**

Run:

```bash
npm run build:test
node --test tests/openCodeCleanupLock.test.mjs
```

Expected: the new recovery and replacement-ownership assertions FAIL while the
earlier owner-record tests remain green.

- [ ] **Step 7: Implement abandoned-owner recovery**

Implement bounded snapshot types:

```ts
interface LockSnapshot {
  readonly bytes: Buffer;
  readonly stat: fs.Stats;
  readonly owner:
    | { kind: 'structured'; pid: number; hostname: string; token: string; createdAt: number }
    | { kind: 'legacy'; pid: number }
    | { kind: 'malformed' };
}
```

Recovery rules:

- only same-host `dead` structured owners and `dead` legacy owners recover
  immediately;
- live/unknown/different-host owners retry and are never moved;
- malformed candidates recover only after age `>= 300_000` ms and two identical
  byte/stat snapshots;
- reread expected bytes and file identity immediately before quarantine;
- quarantine name is same-directory, collision-safe, and includes PID, timestamp,
  and random token without user-controlled path separators;
- after rename, verify the quarantine snapshot still equals the inspected
  candidate;
- on mismatch, perform only a non-overwriting restoration; if that cannot be
  guaranteed, preserve evidence and throw instead of touching a newer lock path;
- successful recovery unlinks only the verified quarantine entry and retries
  normal `wx` acquisition;
- acquisition verifies token and file identity after fsync;
- release verifies owner bytes/token/file identity immediately before unlink.

Do not add timers or background heartbeats.

- [ ] **Step 8: Run lock tests and static checks**

Run:

```bash
npm run build:test
node --test tests/openCodeCleanupLock.test.mjs
npm run typecheck
npm run lint
npm run format:check
git diff --check
```

Expected: all focused tests and checks PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add src/openCodeCleanupLock.ts tests/openCodeCleanupLock.test.mjs
git commit -m "fix: recover abandoned OpenCode cleanup locks"
```

---

### Task 3: Integrate the recoverable lock into the OpenCode migration

**Files:**
- Modify: `src/openCodeConfigCleanup.ts`
- Modify: `tests/openCodeConfigCleanup.test.mjs`
- Modify: `tests/extensionActivation.test.mjs`

**Interfaces:**
- Consumes: `acquireOpenCodeCleanupLock()` and `OpenCodeCleanupLockOptions` from Task 2.
- Preserves: `OpenCodeConfigCleanupMigration.cleanup()`, `runOpenCodeCleanupOnce()`, and `runOpenCodeCleanupActivationGate()` public behavior.
- Produces: `OpenCodeConfigCleanupOptions.lockOptions?: OpenCodeCleanupLockOptions`.

- [ ] **Step 1: Write failing migration-level stale-lock tests**

Extend `tests/openCodeConfigCleanup.test.mjs` with:

- a legacy dead-PID lock left beside a tagged config is recovered and cleanup
  succeeds;
- a structured dead-owner lock is recovered and cleanup succeeds;
- a live-owner lock still raises the existing actionable busy-lock failure;
- cleanup after recovery creates exactly one backup, removes only tagged providers,
  preserves mode, and leaves no lock/quarantine/temp artifact;
- activation after a dead-lock recovery keeps OpenCode enabled;
- activation with a live/unknown lock disables only OpenCode and keeps other CLI
  profiles available.

Update the architecture assertion in `tests/extensionActivation.test.mjs` to require
`openCodeConfigCleanup.ts` to import the dedicated lock module and prohibit the old
private `acquireLock` implementation.

- [ ] **Step 2: Run focused integration tests and verify RED**

Run:

```bash
npm run build:test
node --test tests/openCodeConfigCleanup.test.mjs tests/extensionActivation.test.mjs
```

Expected: stale-lock success assertions FAIL and the architecture assertion finds
the old private lock implementation.

- [ ] **Step 3: Replace the private lock implementation**

In `src/openCodeConfigCleanup.ts`:

1. import `acquireOpenCodeCleanupLock` and `OpenCodeCleanupLockOptions`;
2. add `lockOptions?: OpenCodeCleanupLockOptions` to
   `OpenCodeConfigCleanupOptions`;
3. preserve the initial no-file/no-tag precheck before any lock acquisition;
4. acquire with:

   ```ts
   const lock = await acquireOpenCodeCleanupLock(lockPath, {
     retryAttempts: this.lockRetryAttempts,
     retryDelayMs: this.lockRetryDelayMs,
     ...this.lockOptions,
   });
   ```

5. call `await lock.release()` in the existing `finally`;
6. remove the private `acquireLock`, old PID-only writer, `releaseLock`, and any
   helpers now owned by the dedicated module;
7. do not alter backup, temp, fsync, source-unchanged, atomic rename, marker
   filtering, migration-state, or activation-gate logic.

- [ ] **Step 4: Run focused integration and lock suites**

Run:

```bash
npm run build:test
node --test tests/openCodeCleanupLock.test.mjs \
  tests/openCodeConfigCleanup.test.mjs \
  tests/extensionActivation.test.mjs
```

Expected: all focused tests PASS with no platform skips added.

- [ ] **Step 5: Run the complete local quality gate**

Run:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test -- --test-concurrency=1
git diff --check
```

Expected: 0 failures; only the already-declared real-Windows platform skips may
remain on Darwin.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/openCodeConfigCleanup.ts tests/openCodeConfigCleanup.test.mjs \
  tests/extensionActivation.test.mjs
git commit -m "refactor: use recoverable OpenCode cleanup lock"
```

---

### Task 4: Review, rebuild, audit, and publish the exact VSIX

**Files:**
- Generate: `agents-gui-0.0.20.vsix`

**Interfaces:**
- Consumes: committed Tasks 1–3.
- Produces: one reviewed commit range, one audited VSIX path, byte size, SHA-256,
  package manifest facts, and browser-side Marketplace publication result.

- [ ] **Step 1: Run a scoped code review over Tasks 1–3**

Create a review package from the pre-Task-1 commit through current `HEAD`. The
reviewer must verdict:

- Node 22 is engineering-only and VS Code remains `^1.85.0`;
- all CI/package/publish paths use Node 22 and local VSCE `3.9.2`;
- no VSCE `npx` or install-fallback path remains;
- live/unknown locks are preserved;
- dead structured and legacy locks recover;
- malformed-lock grace and ownership replacement races fail closed;
- cleanup and activation semantics remain marker-scoped and selected-CLI safe;
- native CLI argv/env/cwd/provider/model/session behavior is unchanged.

Any Critical or Important finding enters one bounded fix/re-review loop before
release.

- [ ] **Step 2: Run the authoritative Node 22 release verifier**

Run under a Node version satisfying `22.22.1+`:

```bash
node --version
npm run check:node
npm ci
npm run verify:release
```

Read the complete output. Require:

- format, lint, typecheck, build, and serial tests exit 0;
- Extension Host smoke exits 0;
- preview generation exits 0;
- production audit reports 0 vulnerabilities;
- package command uses local VSCE `3.9.2`;
- working, staged, and committed whitespace checks pass.

- [ ] **Step 3: Audit the freshly generated VSIX**

Run:

```bash
unzip -t agents-gui-0.0.20.vsix
shasum -a 256 agents-gui-0.0.20.vsix
unzip -l agents-gui-0.0.20.vsix
npm audit --omit=dev
npm audit
```

Inspect ZIP entries programmatically and require:

- no duplicate, absolute, traversal, or backslash paths;
- required `extension/dist/extension.js`, manifest, README, icon, and media files
  exist and are non-empty;
- no `node`, `npm`, `npx` executable, `node_modules`, `src`, tests, worktrees,
  `.superpowers`, `.test-dist`, coverage, lockfile, source map, TypeScript, `.env`,
  credential, or temporary entry;
- package manifest is `agents-gui` `0.0.20`, main `./dist/extension.js`, and
  `engines.vscode` `^1.85.0`;
- packaged JS/JSON contains no retired provider injection, generated model/base
  URL/API-key environment override, managed OpenCode session, or execution-policy
  residue;
- record exact entry count, byte size, and SHA-256;
- report full-audit development findings separately from production audit.

- [ ] **Step 4: Verify artifact identity before browser upload**

Immediately before upload, recompute SHA-256 and require it to equal the audited
hash. If it differs, stop and repeat Step 3 on the new bytes.

- [ ] **Step 5: Upload through the logged-in browser**

Use the Chrome/browser-control skill and the user's existing authenticated
Marketplace tab/session. Navigate to the extension publisher page, select the
exact absolute path:

```text
/Users/t/6bt/myproject/agents-gui/.worktrees/native-cli-passthrough/agents-gui-0.0.20.vsix
```

Upload the package, review Marketplace validation messages, and submit only if
the displayed extension ID and version are `agents-gui` and `0.0.20`. Do not use
VSCE CLI publication for this current release.

- [ ] **Step 6: Confirm publication**

Record the Marketplace confirmation/status and public management URL. If
processing is asynchronous, monitor the same browser page until success or a
concrete validation failure appears. Do not claim publication from the upload
click alone.

- [ ] **Step 7: Final repository state**

Require:

```bash
git status --short
git log --oneline -6
```

Expected: implementation branch clean except for the intentionally generated
VSIX if ignored; no uncommitted source/config/test changes. Do not push or merge
without separate authorization.
