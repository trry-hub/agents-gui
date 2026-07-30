# Task 6 — SCM Generation Single-CLI and Diagnostic Rejection

## Outcome

SCM commit-message generation now calls the explicitly selected installed local CLI exactly once. There is no provider fallback, no capability/task policy, and no adapter runtime, environment, permission, MCP, plugin, or OpenCode fast-lane injection. Provider diagnostics are rejected before they can become SCM partial or final input.

## RED

1. Replaced the fallback/policy tests with selected-provider and diagnostic-output tests.
2. `npm run build:test && node --test tests/textGeneration.test.mjs tests/commitMessage.test.mjs` initially built and produced six expected failures: the cleaner accepted diagnostics, the use case retained fallback request shape/behavior, and the command retained fallback paths.
3. Added an HTTP diagnostic case. The focused cleaner test then failed as expected because `HTTP 503 upstream failure: fix(api): retry the request` was incorrectly reduced to a commit message.

## GREEN

Implemented the minimal changes:

- `GenerateCommitMessageUseCase` accepts `providerId`, makes one generator call, and returns only `message` plus `providerId`.
- `cleanGeneratedCommitMessage` rejects provider, request, HTTP, unsupported-model, and available-model diagnostics and accepts only whitelisted Conventional Commit types (with optional scope and breaking marker).
- `CliTextGenerationAdapter` detects `error:` and `api error:` case-insensitively before notifying the output observer, while retaining launch/output timeouts and cancellation/stop behavior.
- `CommitMessageCommand` passes the selected profile directly and reports that CLI's result/error without fallback copy or selection.
- Deleted `src/openCodeTaskPolicy.ts` and its obsolete tests.

Focused green verification:

```text
npm run build:test
node --test tests/textGeneration.test.mjs tests/commitMessage.test.mjs
26 passed, 0 failed

node --test --test-name-pattern="text-generation|commit generation|SCM text generation" tests/extensionActivation.test.mjs tests/promptBuilder.test.mjs
2 passed, 0 failed
```

## Files changed

- Modified: `src/textGeneration.ts`
- Modified: `src/cliTextGenerationAdapter.ts`
- Modified: `src/commitMessage.ts`
- Modified: `src/commitMessageCommand.ts`
- Deleted: `src/openCodeTaskPolicy.ts`
- Modified: `tests/textGeneration.test.mjs`
- Modified: `tests/commitMessage.test.mjs`
- Modified: `tests/extensionActivation.test.mjs`
- Added: this report

## Full and static verification

```text
npm test
335 passed, 0 failed, 2 skipped

npm run lint
exit 0

npm run typecheck
exit 0

npm run format:check
exit 0

npm run build
exit 0
```

The two skips are the pre-existing Windows npm-shim platform tests. Lint emits the repository's existing Node `MODULE_TYPELESS_PACKAGE_JSON` warning but exits successfully.

## Self-review

- The use case has one `generator.generate` call and no provider loop/fallback resolver.
- Cancellation is checked before the single call; no alternative CLI can start after cancellation.
- Streamed diagnostic chunks are filtered both by adapter provider-error recognition and commit-message cleaning before the SCM callback.
- Final diagnostic output is rejected as `invalid-output` rather than written to SCM.
- Static residue search found no fallback/policy identifiers in `src`; the adapter has one native `startPrompt(profile.id, request.prompt, { cwd: request.cwd })` launch.
- Valid multiline commit cleanup and staged diff/prompt flow remain covered by existing focused tests.

## Commit

`fix: generate SCM messages with selected CLI only`

Follow-up: `fix: harden SCM diagnostic boundary`

## Concerns

None for task scope. The pre-existing lint module-type warning remains outside this change.

## Review follow-up: line-oriented diagnostic boundary

### Root cause and RED

The initial diagnostic checks diverged: the cleaner searched the whole output for keyword matches, while the adapter only recognized `error:` at the beginning of the complete accumulated display string. That missed a diagnostic after a valid subject and could instead let OpenCode display normalization replace the actual error line with a generic message.

Added adversarial tests first. The RED run showed the shared classifier was absent and that a chunked later `api error:` line reached the adapter's display-normalization path instead of being reported verbatim.

### Implementation and GREEN

- Added exported pure `findProviderDiagnosticLine()` in `src/commitMessage.ts`.
- It scans logical lines only, accepts indentation and bullet/hyphen variants, and classifies case-insensitive `error:`, `api error:`, request-failed, bad-request `(400)`, HTTP 4xx/5xx, unsupported-model, and available-models prefixes.
- The cleaner rejects any classified line but preserves valid conventional subjects that mention HTTP 503, unsupported models, or available models in their summary.
- The adapter uses that helper before display normalization, after normalization as a safeguard, and during end handling. It stops the existing selected session and reports the extracted diagnostic line.
- Tests cover a valid subject followed by a diagnostic split across multiple OpenCode delta events, no diagnostic partial, session stop, one CLI launch, and buffered/nonzero-exit ordering.

### Verification

```text
Focused SCM tests: 30 passed, 0 failed
Focused architecture tests: 2 passed, 0 failed
npm test: 339 passed, 0 failed, 2 pre-existing platform skips
npm run lint: exit 0
npm run typecheck: exit 0
npm run format:check: exit 0
npm run build: exit 0
git diff --check: clean
```
