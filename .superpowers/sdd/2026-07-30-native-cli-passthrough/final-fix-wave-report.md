# Native CLI passthrough — final fix wave report

Date: 2026-07-30
Branch: `codex/native-cli-passthrough`
Fix-wave base: `dc42ba1e88816e9d94f918cda2c595f4c3738927`

## Outcome

All 14 final-review findings and the last reviewer boundary checks are resolved. The
authoritative release gate passes, the Extension Development Host smoke suite passes,
and a fresh `agents-gui-0.0.20.vsix` has been built and audited.

No plan or specification document was edited in this wave.

## Finding closure

| Finding | Resolution and evidence |
| --- | --- |
| Preserve selected OpenCode task intent without execution injection | Freeform prompts preserve user text and selected mode intent; OpenCode transport remains exactly `run --format json`. Focused prompt/profile tests cover build and plan modes. |
| Reconcile `/mcps` with the real host configuration | The webview reads host MCP snapshots, sends host save/delete/toggle operations, correlates operation results, reloads after every operation, and invalidates only on success. UI-only disabled-provider persistence was removed. |
| Enforce the commit-message whitelist | Generic `Merge` and `Initial Commit` subjects are rejected; accepted output must have a valid Conventional Commit subject. |
| Eliminate launch races | `CliManager.startPrompt` resolves only after `spawn`, converts pre-spawn error/close into `CLI_LAUNCH_FAILED`, replays same-tick terminal events after listeners attach, and bounds the launch handoff queue. Real `ENOENT` and SCM propagation tests pass. |
| Bound output, replay, and persistence | Added incomplete-JSON, generated stdout/stderr, launch handoff, thread replay, legacy/canonical conversation, attachment, streamed item, and session-bookkeeping bounds. The interactive `AgentSessionController` now has explicit 4 MiB stdout and 512 KiB stderr cumulative budgets; stdout, stderr, and parser overflow all stop and clean the exact session and post a correlated error without throwing from the event listener. |
| Preserve inherited `PATH` bytes | Only the resolved command directory is prepended. Empty entries, duplicates, whitespace, and the inherited value are preserved; Windows emits one canonical PATH key. |
| Make OpenCode cleanup atomic and fail closed | Cleanup uses a same-directory exclusive lock, collision-safe backup, exclusive temp, mode preservation, fsync, pre-rename compare, atomic rename, directory fsync, and cleanup of temporary artifacts. No-op/missing-parent paths avoid the lock. Activation disables only OpenCode for the window when cleanup fails. |
| Contain serialized request rejection | The queue handles every rejection, remains usable after failure, and preserves the originating CLI/thread correlation. |
| Protect SCM input ownership | Streaming generation updates only while it owns the exact last generated draft. Any user edit permanently revokes ownership; failure restores the original only while ownership remains. |
| Reject invalid configured provider IDs | Unknown explicit or default provider IDs produce an actionable localized error before registry lookup or generation. |
| Preserve valid request `cwd` | A non-empty supplied working directory is passed byte-for-byte rather than trimmed. |
| Resolve context against discovered profiles | Context summaries prefer the discovered profile and its observed context window; smoke coverage uses a unique discovered OpenCode window. |
| Align README runtime claims | The input-mode/tokenizer table matches `CLI_PROFILES` and does not claim unimplemented tokenizers. |
| Lock the packaging toolchain | `@vscode/vsce` is pinned exactly to `2.32.0`; scripts invoke the local `vsce` binary and do not use `npx` for packaging. |

Two final low-cost boundary checks were also closed:

- OpenCode activity entries retained by the active legacy webview are capped at 256
  characters for `id`, 512 for `name`, 2,048 for `target`, and 4,096 for `detail`.
- Primitive and array messages are dropped by legacy append, normalize, create, and
  serialize paths instead of bypassing the message field whitelist.

## TDD evidence

The final controller gap was reproduced before implementation:

```text
npm run build:test && node --test tests/agentSessionController.test.mjs
tests 4; pass 0; fail 4
```

After implementation:

```text
npm run build:test && node --test tests/agentSessionController.test.mjs
tests 4; pass 4; fail 0
```

The two final webview bounds were likewise red before implementation and green after:

```text
node --test --test-name-pattern='conversation store drops primitive|legacy OpenCode activity normalization caps' tests/promptBuilder.test.mjs
before: tests 2; pass 0; fail 2
after:  tests 2; pass 2; fail 0
```

The broader fix wave is covered by focused tests in:

- `tests/cliManager.test.mjs`
- `tests/cliPathResolver.test.mjs`
- `tests/commitMessage.test.mjs`
- `tests/commitMessageCommand.test.mjs`
- `tests/conversationReducer.test.mjs`
- `tests/deltaScheduler.test.mjs`
- `tests/extensionActivation.test.mjs`
- `tests/mcpConfig.test.mjs`
- `tests/openCodeConfigCleanup.test.mjs`
- `tests/promptBuilder.test.mjs`
- `tests/serializedRequestQueue.test.mjs`
- `tests/textGeneration.test.mjs`
- `tests/threadEventAdapter.test.mjs`
- `tests/attachmentStore.test.mjs`
- `tests/agentSessionController.test.mjs`
- `tests/extension-smoke/suite/index.js`

The main agent independently rebuilt and ran the controller, CLI manager, prompt
builder, and text-generation focused regressions: 196/196 passed with no failures.

## Final verification

| Command | Result |
| --- | --- |
| `npm run format:check` | Passed; all matched TypeScript files use Prettier style. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed with no ESLint findings. |
| `git diff --check` | Passed. |
| `npm test` | 384 total; 382 passed; 2 Windows-only skips; 0 failed. |
| `npm run verify:release` | Passed end to end. It rebuilt, ran the 384 tests serially, ran Extension Host smoke, generated the preview, audited dependencies, packaged the VSIX, and passed working/staged/committed whitespace checks. |
| `npm audit --omit=dev` | 0 vulnerabilities. |
| `unzip -t agents-gui-0.0.20.vsix` | No compressed-data errors. |

The Extension Development Host smoke suite used VS Code `1.131.0` and exited 0.
The generated standalone preview is
`/tmp/agents-gui-preview/agents-gui-preview.html`.

## VSIX audit

Artifact:
`/Users/t/6bt/myproject/agents-gui/.worktrees/native-cli-passthrough/agents-gui-0.0.20.vsix`

- Size: `522325` bytes
- SHA-256:
  `a268c7ad2546dcabfa2009b536b9675845d42ab851de7d147c235a9020c818c1`
- Entries: 44
- Manifest: `agents-gui` `0.0.20`, publisher `agents-gui`,
  `main: ./dist/extension.js`, VS Code engine `^1.85.0`
- Duplicate ZIP paths: none
- Absolute, traversal, or backslash ZIP paths: none
- Missing or empty required runtime files: none
- Forbidden packaged content (`node_modules`, `src`, tests, worktrees, SDD data,
  `.test-dist`, coverage, lockfile, source maps, TypeScript sources, env files): none
- Retired API-provider identifiers, generated execution override flags, and provider
  model/base URL/API-key environment overrides in packaged JS/JSON: none

The packaged localized MCP form still contains a user-facing `npx` command example;
it is not a packaging invocation. Release scripts use the locked local `vsce` binary.

## Residual concerns

- Full `npm audit` reports 9 high findings in the development dependency graph.
  `npm audit --omit=dev` is clean, no `node_modules` are included in the VSIX, and the
  required Node-18-compatible packaging tool is pinned to `@vscode/vsce@2.32.0`
  (`engines.node >= 16`). This remains a development-tool supply-chain item to revisit
  when the project can move its packaging runtime to a newer Node contract.
- Two Windows-only process-shim tests are skipped on this Darwin host. All
  cross-platform simulation tests pass; the platform-specific cases still require a
  Windows CI run for execution coverage.
- `npm run lint` emits Node's `MODULE_TYPELESS_PACKAGE_JSON` performance notice for
  the ESM ESLint configuration. It is not an ESLint warning or error.
