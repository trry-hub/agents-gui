# Codex-Aligned Conversation Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace whole-transcript Vanilla DOM updates with a Codex-aligned React transcript driven by canonical thread/turn/item events while retaining a production-safe legacy fallback.

**Architecture:** The extension host translates existing lifecycle messages into a shared typed event protocol. A framework-free immutable reducer and external store own conversation state; a React island subscribes at thread/turn/item granularity, coalesces streaming deltas per animation frame, virtualizes long threads by turn, and exposes read-only projections to the legacy shell.

**Tech Stack:** TypeScript 5.3, React 19.2.8, React DOM 19.2.8, `useSyncExternalStore`, esbuild, VS Code Webview API, Node test runner.

## Global Constraints

- React exclusively owns `#messages` only when `agents-gui.experimental.codexRenderer` is enabled.
- Production defaults the feature flag to disabled; Extension Development Host and standalone preview enable it.
- Runtime `sessionId` is only an output-correlation key; every request receives a unique `turnId`.
- A raw provider chunk may not trigger Webview-state serialization more than once every `500ms`.
- Streaming changes only the addressed item and flushes before item or turn completion.
- Virtualization begins above `30` turns, estimates `280px` per unmeasured turn, and overscans `6` turns in both directions.
- A distance from bottom of `0–24px` is considered pinned.
- Existing toolbar, composer, provider controls, settings, prompts, permissions, and provider execution behavior remain unchanged.
- Private Codex application code and CSS are neither copied nor imported.

---

### Task 1: Canonical thread protocol and host adapter

**Files:**
- Create: `src/threadProtocol.ts`
- Create: `src/threadEventAdapter.ts`
- Modify: `src/assistantTypes.ts`
- Modify: `src/webviewProtocol.ts`
- Modify: `src/sidebarProvider.ts`
- Test: `tests/threadEventAdapter.test.mjs`

**Interfaces:**
- Consumes: existing `requestStarted`, `output`, `sessionEnd`, `stopped`, and `error` host messages.
- Produces: `ThreadEventEnvelope`, `ThreadEvent`, `ThreadItem`, and `ThreadEventAdapter.accept(message): ThreadEventEnvelope[]`.

- [ ] **Step 1: Write failing host-adapter tests**

Cover:

```js
const first = adapter.accept({
  command: 'requestStarted',
  cliId: 'codex',
  threadId: 'thread-1',
  sessionId: 'runtime-1',
  text: 'first',
});
const second = adapter.accept({
  command: 'requestStarted',
  cliId: 'codex',
  threadId: 'thread-1',
  sessionId: 'runtime-1',
  text: 'second',
});
assert.notEqual(first[1].event.turn.id, second[1].event.turn.id);
assert.equal(first[2].event.item.id, `${first[1].event.turn.id}:user`);
```

Also assert text and reasoning deltas target deterministic item IDs, activities become typed items, sequences increase per thread, and completion clears the runtime-session binding.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
npm run build:test && node --test tests/threadEventAdapter.test.mjs
```

Expected: FAIL because `.test-dist/threadEventAdapter.js` does not exist.

- [ ] **Step 3: Implement protocol types and the minimal adapter**

Define the discriminated unions in `src/threadProtocol.ts`, including:

```ts
export type ThreadItemType =
  | 'user-message'
  | 'assistant-message'
  | 'reasoning'
  | 'command-execution'
  | 'file-change'
  | 'turn-diff'
  | 'proposed-plan'
  | 'todo-list'
  | 'mcp-tool-call'
  | 'approval-request'
  | 'system-error';

export interface ThreadEventEnvelope {
  command: 'threadEvent';
  providerId: string;
  threadId: string;
  sequence: number;
  event: ThreadEvent;
}
```

`ThreadEventAdapter` keeps a monotonically increasing turn counter, a per-thread sequence map, and an active runtime-session binding. `requestStarted` creates `<sessionId>:<counter>` as the turn ID; provider activity IDs are used when available and otherwise derive from the turn ID plus normalized activity identity.

- [ ] **Step 4: Wire dual delivery through `SidebarProvider`**

Add `threadId?: string` to `AssistantWebviewRequest`, send it from the composer, echo it on `requestStarted`, and change `postToWebview` to post adapter-produced `threadEvent` envelopes before the legacy lifecycle message.

- [ ] **Step 5: Run focused and protocol tests**

Run:

```bash
npm run build:test && node --test tests/threadEventAdapter.test.mjs tests/extensionActivation.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/threadProtocol.ts src/threadEventAdapter.ts src/assistantTypes.ts src/webviewProtocol.ts src/sidebarProvider.ts tests/threadEventAdapter.test.mjs
git commit -m "feat: add canonical thread event protocol"
```

### Task 2: Immutable conversation reducer and external store

**Files:**
- Create: `src/webview/conversationReducer.ts`
- Create: `src/webview/conversationStore.ts`
- Test: `tests/conversationReducer.test.mjs`

**Interfaces:**
- Consumes: `ThreadEventEnvelope` from `src/threadProtocol.ts`.
- Produces: `createConversationStore(initial?)`, `reduceConversation(snapshot, envelope)`, `migrateLegacyConversations(...)`, `projectConversationHistory(...)`, and `projectThreadSummaries(...)`.

- [ ] **Step 1: Write failing reducer tests**

The tests must demonstrate:

```js
const completedBefore = store.getSnapshot().threadsById['thread-1'].turnsById['turn-1'];
store.dispatch(assistantDeltaForTurn2);
const completedAfter = store.getSnapshot().threadsById['thread-1'].turnsById['turn-1'];
assert.equal(completedAfter, completedBefore);
```

Also cover delta-before-start recovery, duplicate sequence suppression without rejecting a distinct late completion, authoritative item completion, stopped/failed finalization, unknown-event tolerance, and migration from `threadsByProvider`.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
npm run build:test && node --test tests/conversationReducer.test.mjs
```

Expected: FAIL because the reducer module is missing.

- [ ] **Step 3: Implement immutable normalized state**

Use:

```ts
export interface ConversationSnapshot {
  version: 2;
  threadsById: Record<string, ThreadState>;
  threadOrderByProvider: Record<string, string[]>;
  activeThreadByProvider: Record<string, string>;
}
```

Clone only the addressed thread, turn, and item. Keep completed siblings referentially stable. Store duplicate keys as `providerId:threadId:sequence` in a bounded in-memory set rather than using a high-water mark, so a distinct late envelope remains acceptable.

- [ ] **Step 4: Add legacy migration and read-only projections**

Pair each legacy user message with following assistant/system messages as one turn, assign stable migration IDs from provider/thread/message positions, mark legacy running placeholders stopped, and project only completed user/assistant items into the last-eight-message composer history.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm run build:test && node --test tests/conversationReducer.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/webview/conversationReducer.ts src/webview/conversationStore.ts tests/conversationReducer.test.mjs
git commit -m "feat: add normalized conversation store"
```

### Task 3: Frame scheduler and persistence coordinator

**Files:**
- Create: `src/webview/deltaScheduler.ts`
- Create: `src/webview/persistenceCoordinator.ts`
- Test: `tests/deltaScheduler.test.mjs`

**Interfaces:**
- Consumes: `dispatch(envelope)`, browser frame callbacks, visibility state, and `persist(snapshot)`.
- Produces: `createDeltaScheduler(options)` and `createPersistenceCoordinator(options)`.

- [ ] **Step 1: Write failing scheduler tests**

Use injected fake `requestFrame`, `cancelFrame`, and clock functions. Assert that three text deltas for the same item become one envelope, different items stay separate, completion flushes pending text first, hidden documents dispatch immediately, dispose flushes, and running checkpoints serialize at most once in `500ms`.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
npm run build:test && node --test tests/deltaScheduler.test.mjs
```

Expected: FAIL because the scheduler modules are missing.

- [ ] **Step 3: Implement keyed delta coalescing**

Key pending deltas by:

```ts
`${providerId}:${threadId}:${turnId}:${itemId}:${event.type}`
```

Concatenate `delta` values in arrival order, schedule one animation frame, and flush all matching item deltas synchronously before completion.

- [ ] **Step 4: Implement persistence triggers**

Persist immediately on turn completion, thread switch, hidden document, and dispose; use a trailing `500ms` checkpoint while turns are running. Persist `version`, normalized threads, thread order, and active-thread maps only.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm run build:test && node --test tests/deltaScheduler.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/webview/deltaScheduler.ts src/webview/persistenceCoordinator.ts tests/deltaScheduler.test.mjs
git commit -m "feat: coalesce streamed conversation updates"
```

### Task 4: React transcript and typed item rendering

**Files:**
- Create: `src/webview/codexRenderer.tsx`
- Create: `src/webview/threadItems.tsx`
- Create: `src/webview/global.d.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Modify: `esbuild.mjs`
- Test: `tests/codexRenderer.test.mjs`

**Interfaces:**
- Consumes: the conversation store, delta scheduler, persistence coordinator, legacy markdown callback, translation callback, and action callback.
- Produces: `window.AgentsGuiCodexRenderer` with `mount`, `dispatch`, `setActiveContext`, `ensureThread`, `deleteThread`, `getConversationHistory`, `getThreadSummaries`, `serialize`, and `dispose`.

- [ ] **Step 1: Install React and write failing renderer tests**

Run:

```bash
npm install react@19.2.8 react-dom@19.2.8
npm install --save-dev @types/react@19.2.17 @types/react-dom@19.2.3
```

Then assert server-rendered semantic markup for user, assistant, reasoning, command, file, tool, approval, and error items. Assert each turn and item exposes stable `data-turn-id` and `data-item-id`.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
npm run build:test && node --test tests/codexRenderer.test.mjs
```

Expected: FAIL because the React components are missing.

- [ ] **Step 3: Implement typed item components**

`ThreadItemRenderer` must use an exhaustive switch. User and assistant items reuse `.message`, `.message-bubble`, and `.message-content`; reasoning uses a `<details>` element; activity items use semantic status rows; approvals expose the existing `data-claude-approval-prompt`; errors use `role="alert"`.

- [ ] **Step 4: Implement external-store subscriptions**

Use `useSyncExternalStore` at active-thread, turn, and item levels. Memoize `Turn` and item components so a delta preserves completed sibling props and component identity.

- [ ] **Step 5: Bundle the Webview entry**

Add a browser/IIFE esbuild target from `src/webview/codexRenderer.tsx` to `media/codex-renderer.js`, with React bundled and production minification matching the extension bundle.

- [ ] **Step 6: Run focused tests and build**

Run:

```bash
npm run build:test && node --test tests/codexRenderer.test.mjs && npm run build
```

Expected: PASS and `media/codex-renderer.js` exists.

- [ ] **Step 7: Commit**

```bash
git add src/webview package.json package-lock.json tsconfig.json esbuild.mjs tests/codexRenderer.test.mjs
git commit -m "feat: render conversation items with React"
```

### Task 5: Turn virtualization and anchored scrolling

**Files:**
- Create: `src/webview/turnVirtualizer.ts`
- Modify: `src/webview/codexRenderer.tsx`
- Test: `tests/turnVirtualizer.test.mjs`

**Interfaces:**
- Consumes: ordered turn IDs, measured heights, viewport height, scroll offset, and distance from bottom.
- Produces: `computeVirtualRange`, `updateMeasuredHeight`, and viewport anchor compensation.

- [ ] **Step 1: Write failing layout tests**

Assert no virtualization at 30 turns, virtual range plus six-turn overscan at 31 turns, `280px` estimates, binary-search range selection, measured-height replacement, 24px bottom pinning, and offset compensation when a turn above the viewport grows.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
npm run build:test && node --test tests/turnVirtualizer.test.mjs
```

Expected: FAIL because the virtualizer module is missing.

- [ ] **Step 3: Implement pure virtual layout functions**

Return:

```ts
interface VirtualRange {
  start: number;
  end: number;
  before: number;
  after: number;
}
```

Use prefix offsets and binary search. Keep height entries keyed by `turnId`.

- [ ] **Step 4: Integrate observers and bottom-distance state**

Use `ResizeObserver` for the viewport and rendered turns. Follow streamed content only while pinned, restore per-thread bottom distance on thread switch, compensate height changes above the current anchor, and provide an accessible scroll-to-bottom button while unpinned.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm run build:test && node --test tests/turnVirtualizer.test.mjs tests/codexRenderer.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/webview/turnVirtualizer.ts src/webview/codexRenderer.tsx tests/turnVirtualizer.test.mjs
git commit -m "feat: virtualize conversation turns"
```

### Task 6: Feature-flagged legacy-shell integration

**Files:**
- Modify: `package.json`
- Modify: `media/main.html`
- Modify: `media/main.js`
- Modify: `media/main.css`
- Modify: `src/sidebarProvider.ts`
- Modify: `src/webviewHtmlRenderer.ts`
- Test: `tests/promptBuilder.test.mjs`
- Test: `tests/extensionActivation.test.mjs`

**Interfaces:**
- Consumes: `window.AgentsGuiCodexRenderer` and existing legacy shell functions.
- Produces: flag-on React ownership and flag-off unchanged legacy rendering.

- [ ] **Step 1: Write failing integration-contract tests**

Assert the manifest contains `agents-gui.experimental.codexRenderer` with default `false`; development mode passes `true`; the React bundle loads before `main.js`; `renderAll` never calls legacy `renderMessages` when enabled; lifecycle cases do not mutate legacy message arrays when enabled; composer history calls the renderer bridge; and flag-off retains the existing paths.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
npm run build:test && node --test tests/promptBuilder.test.mjs tests/extensionActivation.test.mjs
```

Expected: FAIL on the new renderer integration assertions.

- [ ] **Step 3: Inject and resolve the feature flag**

Add `data-codex-renderer="__CODEX_RENDERER_ENABLED__"` to `<body>`. Resolve the value from VS Code configuration in production and force it on in `ExtensionMode.Development`.

- [ ] **Step 4: Mount the React island from the legacy coordinator**

Pass saved legacy threads for one-time migration, the existing Markdown renderer callback, translations, VS Code state persistence, and action callbacks. Route `threadEvent` messages to the scheduler. Make provider/thread changes call `setActiveContext`.

- [ ] **Step 5: Convert legacy consumers to read-only projections**

When enabled, composer history and session summaries read the bridge; new/delete thread actions call bridge methods; lifecycle cases update run/task state but skip legacy transcript mutation; `persist()` serializes `conversationSnapshot` instead of per-chunk legacy arrays.

- [ ] **Step 6: Add fallback and styling**

Wrap the transcript in a React error boundary. Its fallback explains the renderer failure and offers a reload with `agents-gui.experimental.codexRenderer` disabled. Reuse current message classes and add only virtual-spacer, turn, reasoning/activity, and scroll-to-bottom rules.

- [ ] **Step 7: Run integration tests**

Run:

```bash
npm run build:test && node --test tests/promptBuilder.test.mjs tests/extensionActivation.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json media/main.html media/main.js media/main.css src/sidebarProvider.ts src/webviewHtmlRenderer.ts tests/promptBuilder.test.mjs tests/extensionActivation.test.mjs
git commit -m "feat: integrate Codex-aligned transcript renderer"
```

### Task 7: One asset manifest, preview replay, reload recovery, and release verification

**Files:**
- Create: `media/webview-assets.json`
- Modify: `src/webviewHtmlRenderer.ts`
- Modify: `src/sidebarProvider.ts`
- Modify: `scripts/preview-webview.mjs`
- Modify: `scripts/verify-release.mjs`
- Modify: `media/main.js`
- Test: `tests/threadRendererIntegration.test.mjs`
- Test: `tests/promptBuilder.test.mjs`

**Interfaces:**
- Consumes: all Webview asset paths and a recorded lifecycle sequence.
- Produces: a single asset source of truth, executable preview, reload hydration, and end-to-end event replay assertions.

- [ ] **Step 1: Write failing manifest and replay tests**

Assert every placeholder in `main.html` exists in `media/webview-assets.json`, every listed file exists after build, preview replaces all placeholders, and replaying request → interleaved deltas → completion yields one user item, one assistant item, one reasoning item, typed activities, and no duplicate after hydrate/replay.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
npm run build && npm run build:test && node --test tests/threadRendererIntegration.test.mjs tests/promptBuilder.test.mjs
```

Expected: FAIL because the shared manifest and replay fixture do not exist.

- [ ] **Step 3: Centralize asset metadata**

Store placeholder/path entries in `media/webview-assets.json`. Make HTML rendering, the development watcher, preview copying, and release verification consume it. Include `main.html`, `main.css`, legacy browser modules, `codex-renderer.js`, and provider icons where appropriate.

- [ ] **Step 4: Repair and enrich standalone preview**

Build before preview, enable the renderer flag, replace every URI and boolean placeholder, and replay canonical events alongside legacy events. Fail with a nonzero exit code if any `__[A-Z0-9_]+__` placeholder remains.

- [ ] **Step 5: Hydrate and reconcile active turns**

Persist `conversationSnapshot` version 2. On mount hydrate it once. Replay active host events through duplicate suppression; the existing running assistant item must be resumed rather than recreated.

- [ ] **Step 6: Run full verification**

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run preview:webview
npm run verify:release
```

Expected: every command exits `0`. If the full test runner cannot bind localhost inside the sandbox, rerun that exact command with approved escalation and report both results.

- [ ] **Step 7: Inspect the final diff and requirements**

Run:

```bash
git diff --check
git status --short
git diff --stat 31de21f
```

Confirm all ten success criteria from the approved design are represented by code or tests and that generated/transient files are not accidentally staged.

- [ ] **Step 8: Commit**

```bash
git add media/webview-assets.json src/webviewHtmlRenderer.ts src/sidebarProvider.ts scripts/preview-webview.mjs scripts/verify-release.mjs media/main.js tests/threadRendererIntegration.test.mjs tests/promptBuilder.test.mjs
git commit -m "test: verify Codex-aligned renderer lifecycle"
```
