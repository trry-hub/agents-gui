# Native CLI Passthrough Design

**Date:** 2026-07-30

## Goal

Agents GUI must invoke the user's locally installed CLI with that CLI's own
authentication, provider, model, permissions, runtime, MCP, plugin, telemetry,
and session configuration.

The extension remains responsible only for:

- locating the installed executable;
- selecting the requested CLI;
- setting the repository working directory;
- passing the generated prompt through the CLI's non-interactive transport;
- parsing and streaming output;
- stopping processes;
- preserving cross-platform executable launch behavior.

## Non-Goals

- Direct API text generation from Agents GUI.
- API provider or model overrides.
- Permission, reasoning-effort, runtime, MCP, plugin, or session-policy
  overrides.
- Automatic fallback to a different CLI after a generation failure.
- Retaining the legacy custom API provider compatibility surface.

## Invocation Boundary

Each CLI profile may retain only arguments required to submit a prompt and
obtain parseable output. Examples include `exec`, `run`, `-p`, `--message`,
structured output formatting, and disabling terminal color when required by
the parser.

The allowed profile arguments are:

- Claude Code: `-p --output-format stream-json --verbose
  --include-partial-messages`;
- Gemini CLI: `--output-format text -p`;
- Codex CLI: `exec --color never`;
- OpenCode: `run --format json`;
- Goose: `run --quiet --output-format text --text`;
- Aider: `--message`.

Profiles must not add arguments that change the CLI's configured behavior,
including:

- model selection;
- approval or permission mode;
- reasoning effort or runtime mode;
- tool or MCP access;
- plugin loading;
- project configuration discovery;
- session persistence or ephemeral behavior;
- agent-specific behavioral modes.

The child process inherits the extension host's environment. Agents GUI may
adjust `PATH` only as required to make the already-resolved executable and its
runtime dependencies reachable. It must not synthesize proxy variables or add
profile-specific environment variables.

## Interactive Agent Flow

The composer continues to support:

- selecting a locally installed CLI;
- attaching workspace context;
- selecting the user-facing task intent;
- sending prompts and follow-up input;
- viewing streaming output;
- stopping a running process.

The composer no longer exposes model, runtime, or permission controls because
those settings belong to the CLI. Task intent may influence the text of the
prompt, but it must not add CLI behavior arguments.

Agents GUI must not start or attach a managed background server. Each completed
one-shot request is followed by a new local CLI process; follow-up context is
carried in the next prompt rather than by changing or taking ownership of the
CLI's session configuration.

## Commit Message Flow

Commit-message generation invokes only the selected local CLI. It uses the
repository root as the working directory and passes the staged diff in the
prompt.

The extension must not:

- inject provider environment variables;
- add model, permission, tool, MCP, plugin, or session-policy overrides;
- silently fall back to a different installed CLI.

If the selected CLI fails or returns invalid output, the command reports that
failure. Provider and transport errors are never streamed into the SCM input
box or accepted as Conventional Commit messages.

## Removed Provider Surface

The legacy API Provider feature exists only to override local CLI processes and
therefore conflicts with native passthrough. Remove:

- custom API provider settings and manifest keys;
- default provider and per-CLI provider bindings;
- provider runtime resolution and environment generation;
- provider model-list requests used by that settings surface;
- provider warnings and selection keys;
- the API Providers settings page and related localization;
- documentation and tests that promise provider injection.

Existing VS Code settings may remain in the user's settings file as inert
unknown keys. The extension must not read or act on them.

## OpenCode Cleanup Migration

Previous releases persisted provider data into `opencode.json`. Merely stopping
future synchronization would leave the local CLI modified.

On the first activation of the native-passthrough release:

1. Read the OpenCode config without changing unrelated fields.
2. Detect only provider entries carrying the `__agents_gui_synced` marker.
3. If no marked entries exist, do nothing.
4. Write a timestamped backup before mutation.
5. Remove only marked provider entries.
6. Remove the top-level `model` only when it points to one of the removed
   provider keys.
7. Preserve every unmarked provider, model, and unrelated configuration field.
8. Record migration completion in VS Code extension global state so routine
   activations do not rewrite the file.

The normal OpenCode synchronization path is then removed.

## Process Environment

Allowed inherited or transport behavior:

- `process.env` from the extension host;
- command-path discovery and command-directory `PATH` support;
- working directory selection;
- Windows `.exe`, `.cmd`, and `.bat` launching through the shared process
  runner;
- output-format arguments required by the parser;
- stdout/stderr capture, cancellation, and process-tree termination.

Disallowed extension-generated behavior:

- API keys, endpoints, providers, and models;
- system-proxy discovery that was not already present in `process.env`;
- CLI profile environment defaults;
- OpenCode database or telemetry overrides;
- Gemini relaunch overrides;
- task-specific inline configuration overlays;
- behavioral option arguments selected by Agents GUI.

## User Interface

Remove controls whose values can no longer affect execution:

- API Providers settings navigation and form;
- per-Agent provider binding;
- model selection and custom model entry;
- runtime/reasoning selection;
- permission selection.

Retain Agent selection, task intent, context controls, attachments, prompt
input, transcript rendering, progress, stop, retry, and CLI authentication
commands.

Any remaining model or context-window display must be observational and derived
from CLI discovery. It must never become an execution override.

## Error Handling

- CLI launch failures identify the selected CLI and remain visible as errors.
- Lowercase and uppercase provider-error prefixes are rejected.
- HTTP/provider diagnostic text cannot satisfy commit-message validation.
- Partial output is written to SCM only after it is known to be a plausible
  commit message.
- Cancellation never triggers fallback.
- No failure triggers fallback to another CLI.

## Testing

Implementation follows test-driven development.

Regression coverage must prove:

1. Interactive launches receive no provider or profile environment overrides.
2. Commit-message launches receive no provider environment or task-policy
   overlay.
3. All six CLI profiles omit model, permission, runtime, session-policy, MCP,
   and plugin overrides while retaining required prompt transport arguments.
4. A failed selected CLI does not invoke another CLI.
5. Provider error output, including lowercase `error:`, never reaches SCM.
6. OpenCode cleanup removes only marked entries, conditionally removes the
   matching top-level model, creates a backup, and preserves unrelated config.
7. Provider settings and ineffective composer controls are absent.
8. Windows command resolution and process-tree termination remain covered.

Verification includes focused regression tests, the complete test suite,
formatting, linting, type checking, production build, release verification,
and VSIX content audit.

## Release

Ship the behavior as `0.0.20`. Reusing `0.0.19` is forbidden because two
different builds with that version already exist locally and VS Code cannot
reliably distinguish them.
