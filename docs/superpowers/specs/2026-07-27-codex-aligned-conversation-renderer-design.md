# Codex-Aligned Conversation Renderer Design

**Date:** 2026-07-27  
**Status:** Approved direction, awaiting written-spec review  
**Scope:** Conversation rendering and its state lifecycle inside the VS Code Webview

## Objective

Replace the current mutable-array and direct-DOM conversation renderer with a
Codex-aligned rendering kernel:

```text
provider output
  -> canonical thread event
  -> thread/turn/item reducer
  -> external store selectors
  -> React item components
  -> turn virtualization and anchored scrolling
```

Alignment means matching Codex's observable rendering semantics and locally
verifiable architecture:

- conversations are threads;
- each user request is a turn;
- responses, reasoning, commands, patches, plans, tool calls, approvals, and
  errors are typed items;
- streaming changes the affected item instead of rebuilding the transcript;
- lifecycle events have stable identifiers and explicit started/completed
  states;
- long transcripts render by turn with measured heights and overscan;
- scroll position is tracked as distance from the bottom and survives layout
  changes.

The project must not copy or import private Codex application bundles. The
locally installed application is evidence for behavior and architecture, not a
runtime dependency or source dependency.

## Scope Boundary

This is the first independently shippable subproject of the larger React
Webview migration.

Included:

- canonical thread event protocol;
- thread, turn, and item domain types;
- the single conversation store;
- persisted-state migration for conversations;
- React ownership of the conversation transcript;
- streamed assistant text and reasoning;
- command, activity, patch, diff, plan, tool, approval, and error item
  rendering;
- turn-level virtualization;
- bottom-anchored scrolling;
- a feature flag and legacy renderer fallback;
- executable preview and renderer contract tests.

Not included:

- visual redesign of the toolbar, composer, settings pages, or provider tabs;
- replacement of `SidebarProvider`, `AgentSessionController`, CLI adapters, or
  provider discovery;
- migration of settings state into React;
- copying Codex CSS or private application code;
- changing provider prompts, permissions, or execution behavior.

The existing shell, composer, provider controls, and settings pages remain
Vanilla DOM in this slice. React exclusively owns the transcript subtree.

## Considered Approaches

### A. Rewrite the entire Webview in React at once

This would produce the cleanest final architecture but couples transcript
rendering to settings, MCP forms, provider menus, attachment handling, and
other unrelated behavior in the 10,000-line legacy script. The cutover would
be difficult to review and would lack a safe rollback boundary.

### B. Introduce a React transcript island backed by one canonical store

This is the selected approach. React owns `#messages` while the existing shell
continues to own surrounding controls. The canonical store is the only source
of conversation truth. Legacy code obtains conversation history and thread
summaries through a read-only bridge instead of maintaining a second message
array.

This delivers the Codex rendering model without forcing unrelated UI
migration. Later slices can move the composer and thread list onto the same
store.

### C. Keep Vanilla DOM and improve `StateManager`

This has the smallest dependency change, but it preserves manual DOM ownership,
whole-transcript reconstruction, array-index addressing, and ad-hoc scroll
restoration. It would improve the existing renderer without achieving the
stated Codex-alignment goal.

## Architecture

### Extension host

The extension host remains provider-independent:

```text
SidebarProvider
  -> AgentSessionController
    -> AgentRuntime
      -> provider adapters
```

It emits canonical `threadEvent` messages in addition to legacy lifecycle
messages while the fallback exists. Canonical messages use this envelope:

```ts
interface ThreadEventEnvelope {
  command: 'threadEvent';
  providerId: string;
  threadId: string;
  streamId: string;
  sequence: number;
  event: ThreadEvent;
}
```

`streamId` identifies one Extension Host generation and `sequence` is
monotonically increasing per thread within that generation. The Webview uses
the pair to ignore duplicate delivery while still accepting late completion
events and sequence restarts after a host reload.

### Conversation domain

The browser domain model is framework-free:

```ts
interface ThreadState {
  id: string;
  providerId: string;
  title: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped';
  turnOrder: string[];
  turnsById: Record<string, TurnState>;
  updatedAt: number;
}

interface TurnState {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  itemOrder: string[];
  itemsById: Record<string, ThreadItem>;
  startedAt: number;
  completedAt?: number;
}
```

`ThreadItem` is a discriminated union with these initial variants:

- `user-message`
- `assistant-message`
- `reasoning`
- `command-execution`
- `file-change`
- `turn-diff`
- `proposed-plan`
- `todo-list`
- `mcp-tool-call`
- `approval-request`
- `system-message`
- `system-error`

Every item has a stable `id`, `turnId`, and `status`. Rendering never uses an
array index as identity.

### Canonical event union

The initial event union contains:

```ts
type ThreadEvent =
  | { type: 'thread/started'; thread: ThreadDescriptor }
  | { type: 'turn/started'; turn: TurnDescriptor }
  | { type: 'item/started'; item: ThreadItem }
  | {
      type: 'item/assistantMessage/delta';
      itemId: string;
      delta: string;
    }
  | {
      type: 'item/reasoning/delta';
      itemId: string;
      delta: string;
    }
  | {
      type: 'item/activity/updated';
      itemId: string;
      activity: AgentActivity;
    }
  | { type: 'item/completed'; item: ThreadItem }
  | {
      type: 'turn/completed';
      turnId: string;
      status: 'completed' | 'failed' | 'stopped';
      completedAt: number;
    }
  | {
      type: 'thread/status/changed';
      status: ThreadState['status'];
    };
```

The reducer is tolerant of provider timing differences:

- a delta for an unknown assistant item creates a running placeholder;
- `item/completed` replaces the accumulated item with the authoritative final
  item;
- repeated sequence numbers are ignored;
- `turn/completed` finalizes any still-running items;
- an unknown event type is logged and ignored without breaking rendering.

### Existing-to-canonical mapping

| Existing host message | Canonical events |
| --- | --- |
| `requestStarted` | `thread/started`, `turn/started`, completed user item, started assistant item |
| stdout `output.text` | `item/assistantMessage/delta` |
| `output.thinking` | `item/reasoning/delta` |
| `output.activities` | typed `item/started`, `item/activity/updated`, or `item/completed` |
| `sessionEnd` | authoritative `item/completed`, then `turn/completed` |
| `stopped` | `turn/completed` with `stopped` |
| `error` | `system-error` item followed by failed `turn/completed` |

The host runtime session ID remains the correlation key for provider output.
It is not the turn ID because stdin-based providers may reuse one runtime
session across multiple user requests. Each `requestStarted` creates a unique
turn ID and binds the runtime session's subsequent output to that active turn.
Initial user, assistant, and reasoning IDs are derived deterministically:

```text
<turnId>:user
<turnId>:assistant
<turnId>:reasoning
```

Provider activity IDs are used when present. Otherwise the adapter derives an
ID from the turn ID, activity kind, and provider activity key.

## State Ownership

`ConversationStore` is the only mutable owner of conversation state. It
exposes:

```ts
interface ConversationStore {
  getSnapshot(): ConversationSnapshot;
  subscribe(listener: () => void): () => void;
  dispatch(envelope: ThreadEventEnvelope): void;
  hydrate(snapshot: PersistedConversationSnapshot): void;
  getConversationHistory(providerId: string, threadId: string): HistoryEntry[];
  getThreadSummaries(): ThreadSummary[];
}
```

React subscribes using `useSyncExternalStore`. Legacy composer and history code
can only call the read methods through `window.AgentsGuiConversationBridge`.
They cannot mutate thread objects directly.

The existing `AgentsGuiStateManager` is not extended. It is removed after the
React transcript flag becomes the default and no remaining caller depends on
its render callback.

## Rendering

React mounts into the existing transcript element. The component hierarchy is:

```text
ConversationRoot
  ThreadViewport
    VirtualTurnList
      Turn
        ThreadItemRenderer
          UserMessageItem
          AssistantMessageItem
          ReasoningItem
          CommandExecutionItem
          FileChangeItem
          DiffItem
          PlanItem
          ToolCallItem
          ApprovalRequestItem
          ErrorItem
```

Existing CSS classes and design tokens are reused so this migration does not
alter the visual language.

Selectors subscribe at thread, turn, or item granularity. A text delta changes
only the affected assistant item snapshot. Completed historical turns retain
referential identity and do not rerender.

Markdown is rendered at item level. Running assistant content may be reparsed
for the affected item, but completed turns and sibling items are untouched.
Unsafe link protocols remain blocked by the existing link policy.

## Stream Scheduling

Lifecycle events dispatch synchronously. High-frequency text and reasoning
deltas pass through a browser scheduler:

- deltas are grouped by `threadId + turnId + itemId`;
- each item receives at most one reducer dispatch per animation frame;
- pending deltas flush before `item/completed` or `turn/completed`;
- hidden documents flush immediately instead of waiting for animation frames;
- disposing the renderer cancels the frame and flushes the final accumulated
  text.

The scheduler controls state-update frequency. It does not add a second
display buffer, so persisted and visible text cannot diverge.

## Virtualization and Scrolling

Virtualization operates at turn level because a turn is the stable unit users
navigate and review.

- default estimated turn height: `280px`;
- virtualization starts when a thread contains more than `30` turns;
- overscan: `6` turns above and below the visible range;
- measured heights are stored by `turnId`;
- resize observation updates the virtual layout;
- range changes preserve the visible anchor turn.

Scroll state uses distance from the bottom:

- `0–24px` means pinned to the bottom;
- new streamed content follows the bottom only while pinned;
- when the user scrolls away, streaming does not pull them back;
- height changes above the viewport compensate the scroll offset;
- switching threads restores the last distance-from-bottom snapshot for that
  thread;
- an explicit “scroll to bottom” action uses the existing UI affordance or an
  accessible fallback button.

## Persistence and Reload

Conversation persistence uses a versioned payload:

```ts
interface PersistedConversationSnapshot {
  version: 2;
  threadsById: Record<string, PersistedThread>;
  threadOrderByProvider: Record<string, string[]>;
  activeThreadByProvider: Record<string, string>;
}
```

Transient fields such as subscriptions, animation-frame handles, measured
heights, and runtime item timers are not persisted.

Persistence occurs:

- after a turn completes, fails, or stops;
- when the active thread changes;
- when the document becomes hidden;
- during Webview disposal;
- at a throttled checkpoint no more than once every `500ms` while a turn is
  running.

The current `threadsByProvider` payload is migrated once during hydration.
Running legacy assistant placeholders become stopped items. A Webview reload
also announces renderer readiness and requests the host's bounded canonical
replay buffer. Already persisted event identities are ignored; events emitted
during the reload gap reconcile the active turn without creating a duplicate
assistant item. The same handshake restores active provider, runtime session,
and task bindings so composer controls remain locked to the running process.

## Feature Flag and Rollback

The new renderer is guarded by:

```text
agents-gui.experimental.codexRenderer
```

Development builds default it to enabled. Production initially defaults it to
disabled until parity tests and manual VS Code Extension Host verification
pass. The release that promotes it to the production default retains the
legacy renderer for one release as rollback protection.

When the flag is enabled:

- legacy code must not mutate the transcript DOM;
- legacy lifecycle handlers must not maintain a second conversation array;
- the composer reads history from the conversation bridge;
- the session-history UI reads summaries from the same bridge.

Before the flag-off shell renders or persists, it projects any version-2
conversation snapshot into the legacy thread/message shape. This makes the
error-boundary recovery path lossless for React-only turns. If the renderer
bundle is unavailable and projection cannot run, the original canonical
snapshot is retained verbatim instead of being cleared.

## Build and Asset Delivery

The React transcript is written in TypeScript/TSX and bundled by the existing
esbuild dependency. The extension host bundle and Webview bundle have separate
entry points.

All Webview assets are declared in one manifest consumed by:

- `renderWebviewHtml`;
- the development file watcher;
- the standalone preview script;
- asset-existence and unresolved-placeholder tests.

The generated React bundle is loaded before the legacy coordinator script so
the bridge is available during initialization. Production CSP continues to
allow only extension-owned scripts.

## Error Handling

- Reducer validation failures are reported to the Webview console with event
  type, thread ID, and turn ID, excluding prompt and model output text.
- A malformed item becomes a typed `system-error` item only when it belongs to
  the active turn; unrelated malformed notifications are ignored.
- A React error boundary replaces the transcript subtree with a recoverable
  error panel and offers a legacy-renderer reload.
- One item renderer failure must not remove the composer, settings, or provider
  controls.
- Duplicate and out-of-order events must not duplicate user or assistant
  messages.

## Testing

### Pure domain tests

- every canonical event transition;
- duplicate sequence suppression;
- delta-before-start recovery;
- completion replacing accumulated content;
- stop/error finalization;
- migration from the existing persisted conversation shape;
- history and thread-summary projections.

### Scheduler tests

- multiple deltas for one item coalesce into one frame;
- separate items remain separate;
- completion flushes pending deltas first;
- hidden-document and dispose behavior.

### Rendering tests

- every item variant produces stable semantic markup;
- streaming changes only the addressed item selector;
- unsafe links are rejected;
- reasoning and tool details retain their open state;
- error boundary fallback works.

### Integration tests

- replay a recorded `requestStarted -> output -> sessionEnd` event sequence;
- replay interleaved events from two providers;
- reload during a running turn without duplicating the assistant item;
- legacy and React projections produce the same user/assistant transcript;
- standalone preview resolves every asset placeholder;
- Extension Host smoke covers flag-on and flag-off initialization.

## Success Criteria

The slice is complete when:

1. React exclusively owns the transcript DOM when the feature flag is enabled.
2. Conversation state has one mutable owner.
3. Host output is represented as typed thread events with stable IDs.
4. Streaming dispatches at most once per item per animation frame.
5. Completed sibling turns do not rerender during a text delta.
6. Long conversations virtualize by turn and preserve scroll position.
7. Running sessions survive Webview reload without duplicated messages.
8. Conversation persistence is not serialized once per raw provider chunk.
9. Preview, typecheck, lint, unit tests, and Extension Host smoke pass.
10. Flag-off behavior remains compatible with the current release.

## Follow-On Slices

After this design ships, later specifications may migrate:

1. session history and provider tabs to React;
2. composer and provider option controls;
3. settings and MCP forms;
4. removal of the legacy coordinator and legacy renderer;
5. route-level loading and full Webview React ownership.

Those slices are intentionally outside this implementation to keep the first
cutover reviewable and reversible.
