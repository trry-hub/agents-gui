# SDD ledger — plan: /Users/t/6bt/myproject/agents-gui/.worktrees/native-cli-passthrough/docs/superpowers/plans/2026-07-30-native-cli-passthrough.md

## Baseline

- Branch: `codex/native-cli-passthrough`
- Base commit: `f36b10d0508f87c371511486ef4595018863d70a`
- `npm ci`: passed
- `npm test`: 366 tests, 364 passed, 2 skipped, 0 failed

## Task status

- Task 1: completed
  - Commits: `31a3ee0 feat: add legacy OpenCode cleanup migration`, `e806750 fix: remove unused OpenCode cleanup import`
  - Verification: focused cleanup tests 4/4; full suite 368 passed, 2 skipped, 0 failed; lint has no ESLint findings
  - Review: initial functional approval with one lint-warning finding; fix round 1 approved
- Task 2: completed
  - Commits: `df20fb9 refactor: remove CLI provider injection surface`, `900cf22 fix: remove residual provider settings markup`, `bbdb2d8 fix: remove dead settings body styles`
  - Verification: full suite 361 passed, 2 skipped, 0 failed; focused provider-removal, activation, cleanup, thread-adapter, JS syntax, build, and diff checks passed
  - Review: initial P1 residual-ID/CSS finding; fix round 1 found one remaining dead selector; fix round 2 passed
- Task 3: completed
  - Commits: `c79fec1 refactor: launch local CLIs without overrides`, `0f977db test: cover native CLI transport boundaries`, `b75cd25 test: harden native CLI transport coverage`, `5a95eb1 fix: bound CLI version probe parsing`
  - Verification: full suite 350 passed, 2 pre-existing Windows platform skips, 0 failed; focused transport/discovery suite 198 passed, 2 skipped; lint/typecheck/diff checks passed
  - Review: three fix rounds resolved blanket skips, PATH/env purity, probe degradation, slash routing, unsupported session capability, version/capture bounds, Windows env-key semantics, and manager cleanup coverage
- Task 4: completed
  - Commits: `8128c43 refactor: make agent requests native one-shot runs`, `9972e47 fix: preserve native prompt mode semantics`
  - Verification: full suite 346 passed, 2 platform skips, 0 failed; lint/typecheck/format/build/smoke/diff checks passed
  - Review: fix round 1 preserved selected agent-mode prompt semantics and removed the remaining model-variant host protocol/state writer
- Task 5: completed
  - Commits: `4dc2994 refactor: remove composer execution overrides`, `0d12060 fix: route native slash commands through CLI`, `4bf1455 fix: remove managed OpenCode session state`, `4417c98 fix: parse OpenCode debug config structurally`
  - Verification: full suite 334 passed, 2 platform skips, 0 failed; lint/typecheck/format/build/preview/diff checks passed
  - Review: three fix rounds removed residual request/custom-model/recent/variant/session state, made retained slash commands one-shot, enforced observational configured-model purity, and made debug JSON parsing whitespace/order independent
- Task 6: completed
  - Commits: `551e536 fix: generate SCM messages with selected CLI only`, `be689b9 fix: harden SCM diagnostic boundary`, `6c6ed79 fix: buffer SCM output until line-safe`
  - Verification: full suite 340 passed, 2 platform skips, 0 failed; focused SCM 31/31; architecture 2/2; lint/typecheck/format/build/diff checks passed
  - Review: two fix rounds established precise line-start diagnostic classification and complete-line observer buffering without valid-subject false positives
- Task 7: completed
  - Commits: `d3c73a1 chore: release native CLI passthrough 0.0.20`, `dc42ba1 docs: clarify native CLI release contract`
  - Verification: focused release 20/20; full suite 341 passed, 2 platform skips, 0 failed; lint/typecheck/format/build/verify:release passed
  - Review: fix round 1 added fresh-process/history contract, exact marker-scoped backup semantics, and meaningful cross-document release assertions
- Task 8: completed
  - Scope: unified final-review fix wave, including the final interactive controller and legacy webview boundary checks
  - Verification: focused red/green tests; full suite 382 passed, 2 Windows-only platform skips, 0 failed; lint/typecheck/format/build/Extension Host smoke/preview/dependency audit/package/diff checks passed
  - Artifact: `agents-gui-0.0.20.vsix`, 522325 bytes, 44 entries, SHA-256 `a268c7ad2546dcabfa2009b536b9675845d42ab851de7d147c235a9020c818c1`
  - Review: all 14 final findings resolved; final controller output-limit gap, active activity-field bounds, and primitive-message persistence bypass closed

## Final-review observations

- `npm run lint` emits a pre-existing Node `MODULE_TYPELESS_PACKAGE_JSON` runtime notice because `eslint.config.js` is ESM while the package has no `type`; no ESLint warning/error remains from Task 1.
- Full `npm audit` reports 9 high findings in the development tool graph; `npm audit --omit=dev` reports 0, and packaged contents exclude `node_modules`.
- Two Windows-only process-shim tests remain skipped on Darwin; cross-platform simulation coverage passes.

## Final review fix wave

- Status: completed
- Fix policy: one unified fix wave, followed by exactly one scoped re-review.
- Important findings to resolve:
  - Preserve the selected OpenCode agent mode in freeform prompt semantics without adding CLI arguments.
  - Make `/mcps` use the real host/native-config MCP operation and reconcile state; do not persist a UI-only toggle.
  - Remove non-Conventional-Commit exceptions such as `Merge` and `Initial Commit`.
  - Eliminate child-process launch races so pre-spawn errors cannot be missed by interactive or SCM callers.
  - Bound generated output, incomplete JSON lines, replay buffers, persisted conversation data, and stopped-session bookkeeping by bytes/counts.
  - Preserve the caller's original `PATH` string exactly while only prepending the resolved CLI directory through the canonical PATH key.
  - Make legacy OpenCode cleanup atomic, collision-safe, mode-preserving, concurrency-aware, and disable OpenCode for the activation if cleanup fails.
  - Attribute every serialized interactive request failure to its originating CLI/thread without poisoning the next request.
  - Protect concurrent SCM input edits with compare-and-swap ownership during streamed generation and restoration.
  - Treat an explicitly configured unknown CLI id as invalid instead of silently falling back to OpenCode.
- Minor findings to resolve in the same wave:
  - Preserve a valid supplied `cwd` verbatim rather than trimming it.
  - Resolve the discovered CLI profile when refreshing context summaries.
  - Align the README tokenizer/input-mode table with `CLI_PROFILES`.
  - Pin `@vscode/vsce` and package with the locked local binary.
- Completion evidence:
  - All important and minor findings above are resolved.
  - The final interactive controller path enforces cumulative stdout/stderr limits and contains parser overflow through correlated stop/cleanup/error handling.
  - Legacy active activity fields are bounded and primitive/array messages are filtered from every legacy persistence path.
  - `npm run verify:release` passed with 384 tests total, 382 passed, 2 Windows-only skips, and 0 failed; Extension Host smoke exited 0.
  - The audited 44-entry VSIX and exact verification record are documented in `final-fix-wave-report.md`.
