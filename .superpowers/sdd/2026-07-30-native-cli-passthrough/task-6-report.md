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

## Concerns

None for task scope. The pre-existing lint module-type warning remains outside this change.
