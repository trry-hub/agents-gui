# Node 22 release toolchain and stale-lock recovery design

Date: 2026-07-30

## Context

The native CLI passthrough branch is functionally complete, but its final scoped
re-review identified two release blockers:

1. the OpenCode cleanup lock can survive an extension-host crash and disable
   OpenCode on every later activation; and
2. the pinned VSCE dependency graph does not start on Node 18, while the release
   workflow still publishes through an unpinned network-installed VSCE.

The user chose to raise only the development, test, packaging, and publishing
toolchain to Node 22. Extension installation compatibility remains
`engines.vscode: ^1.85.0`; end users do not need a separately installed Node.js
runtime for Agents GUI. Native CLI invocation remains unchanged and no Node.js
runtime is bundled in the VSIX.

## Goals

- Recover an abandoned OpenCode cleanup lock after an extension-host crash.
- Never remove a lock that can still be attributed to a live owner.
- Keep cleanup atomic, marker-scoped, backup-first, mode-preserving, and
  concurrency-aware.
- Make Node `22.22.1` the minimum supported engineering-toolchain version.
- Run Linux CI, Windows CI, packaging, and release publishing on Node 22.
- Use one exact, repository-installed VSCE version for every package and publish
  path.
- Rebuild and audit a VSIX that contains no Node.js, npm, `node_modules`, source,
  tests, worktrees, or credentials.
- Upload the verified package through the user's logged-in browser session, not
  through a CLI, for the current Marketplace release.

## Non-goals

- Do not raise the minimum VS Code version.
- Do not add a system-Node requirement for extension users.
- Do not change native CLI discovery, arguments, environment, working directory,
  prompting, model selection, provider selection, or session semantics.
- Do not bundle Node.js, npm, VSCE, or `node_modules` into the extension.
- Do not redesign the general migration framework.

## Considered lock approaches

### 1. Owner-aware lock recovery — selected

Store a versioned owner record containing PID, hostname, random token, and
creation time. A contender probes the recorded process before deciding whether
the lock is abandoned. Recovery uses a uniquely named quarantine path and
revalidates the same record immediately before acting. The acquiring and
releasing process verifies its token and file identity so it cannot enter the
critical section with a displaced lock or delete a replacement lock.

This is the smallest change that addresses the observed crash-liveness defect
while retaining the current exclusive-file architecture.

### 2. TTL lease with heartbeat — rejected

A heartbeat makes cross-process abandonment observable without a PID probe, but
it adds timers and can misclassify a live owner during a long event-loop pause or
filesystem stall.

### 3. Remove the lock and rely on snapshot comparison — rejected

The cleanup is idempotent, but snapshot comparison plus atomic rename does not
fully serialize two extension hosts. This weakens the concurrency guarantee that
the cleanup was introduced to provide.

## OpenCode lock protocol

### Owner record

New lock files contain one bounded JSON record followed by a newline:

```json
{
  "version": 1,
  "pid": 12345,
  "hostname": "workstation",
  "token": "unguessable-owner-token",
  "createdAt": 1785427200000
}
```

Requirements:

- the file is created with exclusive `wx` semantics and mode `0600`;
- the record is written and fsynced before the owner enters the cleanup critical
  section;
- PID must be a positive safe integer;
- hostname, token, and the complete record are bounded before parsing or use;
- legacy PID-only lock files remain readable so a lock left by the current
  implementation can be recovered.

### Owner liveness

For a same-host structured record or a legacy PID-only record:

- `process.kill(pid, 0)` success means live;
- `EPERM` means live but not signalable;
- `ESRCH` means dead;
- any other result is treated as unknown/live and is not removed.

A live or unknown owner follows the existing bounded retry path. A dead owner is
eligible for recovery.

A structured record from a different hostname is unknown/live and is not
automatically removed. The local OpenCode config is not assumed to provide a
distributed cross-host lock service.

Fresh empty, partial, or malformed locks are treated as live because another
process may be between exclusive creation and fsync. Such a lock becomes
recoverable only after a five-minute grace period and two unchanged snapshots
separated by at least one configured retry delay.
The acquiring process must verify the owner token and file identity after its
write, so a process resumed after its provisional file was quarantined cannot
enter the critical section.

### Recovery and ownership checks

Recovery must:

1. reread the lock immediately before recovery and require the expected bytes
   and file identity;
2. move the candidate to a unique same-directory quarantine name;
3. verify the quarantined record is the candidate that was inspected;
4. delete only that quarantine entry; and
5. retry normal exclusive acquisition.

If any identity check loses a race, recovery stops acting on that candidate and
retries. It must not delete or overwrite the new `lockPath` entry. If recovery
discovers after quarantine that the moved entry was not the inspected candidate,
it must preserve or restore that entry without overwriting a newer owner and fail
closed if a non-destructive restoration is unavailable.

The acquired lock object carries its token and file identity. Before entering the
critical section, the path must still name that owner. Release removes the path
only if the token and identity still match; otherwise it closes its handle and
leaves the replacement untouched.

Test-only dependency injection may provide PID, hostname, token generation,
clock, process-liveness probing, and retry timing. Production defaults use Node
core APIs.

## Node 22 engineering-toolchain contract

### Compatibility boundary

The Marketplace extension manifest continues to express only the existing
`engines.vscode: ^1.85.0` installation boundary. Node 22 is an engineering
toolchain requirement, not an extension-host or end-user system dependency.

The repository records Node 22 through:

- `.nvmrc` selecting the Node 22 line;
- a small testable policy module with minimum version `22.22.1`;
- a command-line guard invoked by root `preinstall` and before the build,
  build-test, test, release-verification, package, and publish entry points; and
- README development and packaging instructions.

The guard accepts Node 22.22.1 and newer major versions, and rejects older
versions with an actionable message. It must not run when a user installs the
already-built VSIX.

### CI

The existing matrix becomes:

- Ubuntu latest with Node 22; and
- Windows latest with Node 22.

Both continue to run install, lint, typecheck, formatting, build, and the complete
test suite. The Ubuntu job additionally runs the locked local VSIX packaging
command so dependency drift or VSCE startup failures are caught before release.

The release workflow remains on Node 22 and uses `npm ci`.

### VSCE

- Upgrade `@vscode/vsce` from `2.32.0` to exact version `3.9.2`.
- Commit the resulting lockfile.
- All package and publish scripts resolve `vsce` from
  `node_modules/.bin` through npm scripts.
- The release workflow must not use `npx`, `npm exec` with install fallback, a
  global VSCE, or an unversioned package reference.
- Marketplace credentials stay in `VSCE_PAT`; the workflow does not place the
  token in a generated file.

The current release requested by the user is still uploaded through the browser.
The repaired workflow is retained for future automated releases and must obey the
same locked-tool rule.

## Documentation

README requirements are split into:

- extension usage: VS Code 1.85+ and at least one supported system CLI; and
- development/testing/packaging: Node 22.22.1+ and `npm ci`.

Historical plans remain historical. This document supersedes their Node 18
toolchain assumptions for future work on this branch.

## Test strategy

All behavioral production changes follow red-green-refactor.

### Lock tests

- dead structured owner is recovered;
- dead legacy PID-only owner is recovered;
- live owner and `EPERM` owner are never removed;
- unknown probe results are never removed;
- fresh empty/malformed lock is not removed;
- expired unchanged empty/malformed lock is recovered;
- changed candidate loses recovery without touching its replacement;
- a resumed displaced acquirer does not enter the critical section;
- release does not delete a replacement lock;
- concurrent recovery leaves exactly one owner;
- Windows-compatible process-probe outcomes are covered without platform skips;
- existing atomic migration, backup, mode, absent-parent, no-marker, and
  activation-gating tests remain green.

### Toolchain and workflow tests

- version policy rejects Node 18 and Node 20;
- version policy accepts 22.22.1, later Node 22, and later major versions;
- README, `.nvmrc`, CI, and release workflow agree on Node 22;
- both CI matrix entries use Node 22;
- package and publish entry points use the exact local VSCE;
- no workflow contains a VSCE `npx` or global-install path;
- locked `vsce --version` reports `3.9.2`;
- Node 22 can start VSCE and build the package;
- VSIX manifest keeps `engines.vscode: ^1.85.0`;
- package audit confirms Node/npm/VSCE/`node_modules` are absent.

## Release gate

Before Marketplace upload:

1. run formatting, lint, typecheck, build, and the complete serialized test suite;
2. run the authoritative release verifier under Node 22;
3. run production and full dependency audits, reporting any remaining
   development-only findings;
4. generate a fresh `agents-gui-0.0.20.vsix`;
5. verify ZIP integrity, required runtime files, forbidden paths, duplicate paths,
   manifest version/main/VS Code engine, and strict native-passthrough residue
   scans;
6. record byte size and SHA-256;
7. perform one scoped code review of this supplemental fix; and
8. upload the exact audited artifact through the logged-in browser session.

Any Critical or Important review finding, failing command, mismatched artifact
hash, or browser-side Marketplace validation error stops publication.
