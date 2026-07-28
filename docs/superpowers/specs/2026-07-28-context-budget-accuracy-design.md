# Context Budget Accuracy Design

## Status

Approved on 2026-07-28 when the user asked to execute the diagnosed fix.

## Goal

Make the composer token popover describe only data Agents GUI actually knows. An estimate
of attached IDE context must not be presented as total provider-session context usage.

## Current Problem

The host estimates tokens from `renderAssistantContext(snapshot)`, which contains only
workspace, current-file, selection, and diagnostic context. The webview labels that number
as complete context-window usage, forces every non-zero ratio to at least `1%`, subtracts it
from a static Provider window, and rounds both total and remaining values to whole
thousands.

For the reported case, `23 / 128000` is `0.01797%`, but the UI displays `1%` and rounds
`127977` remaining tokens back to `128k`. The numerator also excludes the user prompt,
conversation history, system/provider instructions, tool results, and resumed session
state.

## Selected Design

Token usage carries an explicit scope:

- `attached-context`: an estimate of IDE context Agents GUI is about to attach;
- `session-context`: complete Provider-session usage, only when the Provider supplies or
  Agents GUI can accurately derive it.

The current lightweight counter always emits `attached-context`.

The webview uses a pure presentation helper:

- attached-context estimates show `Attached context`, the estimated token count, a
  reference-window ratio such as `<0.1%`, and `Excludes conversation history`;
- they never show remaining tokens or auto-compaction;
- session-context usage may show used percentage, total, remaining, and auto-compaction;
- percentages are never clamped to a false minimum;
- abbreviated non-integral token counts retain enough precision to distinguish `128k`
  from `127.98k`.

The selected model's known context-window size takes precedence over a profile fallback.
Unknown model families may continue to use the profile fallback, but the attached-context
UI labels it as a reference window rather than a measured limit.

## Alternatives Rejected

1. Only remove the minimum `1%` clamp. This leaves the larger numerator and denominator
   mismatch unchanged.
2. Estimate the entire conversation locally. Provider system prompts, tool state, cache
   accounting, and resumed sessions remain unavailable, so the result would still
   masquerade as authoritative.
3. Add Provider-specific usage extraction in this patch. No existing runtime contract
   exposes a complete cross-provider usage value, so this would broaden the release fix
   and produce inconsistent behavior.

## Data Flow

```text
ContextCollector snapshot
  -> countContextTokens(scope: attached-context)
  -> SidebarProvider contextSummary
  -> deriveContextBudgetPresentation()
  -> localized, scope-accurate popover
```

Future Provider adapters can emit `session-context` without changing the webview contract.

## Error Handling

Missing or invalid token values retain the existing Provider-managed fallback. A missing
window total still shows the attached-context estimate without a percentage. Unknown
scopes fail closed to attached-context for estimated values and session-context for exact
values.

## Testing

- A regression test proves `23 / 128000` renders as `<0.1%`, not `1%`.
- Attached-context tests prove remaining and auto-compact fields are suppressed.
- Session-context tests prove exact remaining values keep useful precision.
- Host tests prove the lightweight counter declares attached-context scope.
- Model-window tests prove a known selected model overrides the profile fallback.
- The full release verifier must pass before rebuilding the VSIX.
