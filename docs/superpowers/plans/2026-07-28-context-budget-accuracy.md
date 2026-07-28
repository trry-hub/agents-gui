# Context Budget Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace misleading full-window token statistics with scope-accurate attached-context estimates while preserving a future path for exact Provider session usage.

**Architecture:** Add an explicit usage scope to the host contract and resolve model window sizes with model-first precedence. Move webview display calculations into a CommonJS/browser-compatible pure helper so percentage, precision, and field visibility are covered by behavior tests.

**Tech Stack:** TypeScript 5, browser JavaScript, Node.js built-in test runner, existing webview asset manifest, existing i18n runtime.

## Global Constraints

- Do not bundle a tokenizer, Node.js, npm, or `node_modules`.
- Do not call an estimate complete session usage.
- Do not display remaining tokens or auto-compaction for attached-context estimates.
- Render `23 / 128000` as `<0.1%`, never `1%`.
- Prefer a known selected-model window over a profile fallback.
- Preserve exact-session behavior for future Provider-reported usage.

---

### Task 1: Make token semantics explicit

**Files:**
- Modify: `tests/promptBuilder.test.mjs`
- Modify: `src/assistantTypes.ts`
- Modify: `src/tokenCounter.ts`
- Modify: `src/cliProfiles.ts`
- Modify: `src/sidebarProvider.ts`

**Interfaces:**
- Produces: `AssistantTokenScope = 'attached-context' | 'session-context'`
- Produces: optional `AssistantTokenUsage.scope`
- Produces: `resolveContextWindowTokens(profile, modelId)`
- Consumes: the webview presentation helper in Task 2 reads `scope`

- [ ] **Step 1: Write failing tests**

Add behavior assertions that `countContextTokens()` returns
`scope: 'attached-context'` and that:

```js
resolveContextWindowTokens({ contextWindowTokens: 128000 }, 'openai/gpt-4.1')
```

returns `1048576`, while an unknown Provider model falls back to `128000`.

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
npm run build:test
node --test tests/promptBuilder.test.mjs
```

Expected: FAIL because `scope` and `resolveContextWindowTokens()` do not exist.

- [ ] **Step 3: Implement the minimum host changes**

Add the scope type/property, return `attached-context` from `countContextTokens()`, export
`resolveContextWindowTokens(profile, modelId)`, and use it in `sendContextSummary()`.

- [ ] **Step 4: Verify Task 1**

Run the same commands and expect zero failures.

### Task 2: Derive an honest webview presentation

**Files:**
- Create: `media/contextBudget.js`
- Modify: `media/webview-assets.json`
- Modify: `media/main.html`
- Modify: `media/main.js`
- Modify: `media/i18n.js`
- Modify: `tests/promptBuilder.test.mjs`

**Interfaces:**
- Produces: `window.AgentsGuiContextBudget`
- Produces: `deriveContextBudgetPresentation(options)`
- Produces: `formatTokenCount(tokens)` and `formatPercentage(percent)`

- [ ] **Step 1: Write failing pure behavior tests**

Safely load the not-yet-created helper and assert:

```js
deriveContextBudgetPresentation({
  tokenUsage: { precision: 'estimated', scope: 'attached-context', tokens: 23 },
  totalTokens: 128000,
  autoCompact: true,
})
```

returns attached mode, `percentageLabel: '<0.1'`, and no remaining/auto-compact fields.
Also assert exact session usage keeps precise remaining output.

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
node --test tests/promptBuilder.test.mjs
```

Expected: FAIL because `AgentsGuiContextBudget` has not been implemented.

- [ ] **Step 3: Implement the pure helper and wire it into the webview**

Use the existing UMD helper pattern, add it to the asset manifest before `main.js`, replace
inline percentage/remaining calculations with the helper, and add localized attached
context/reference-window/excluded-history strings.

- [ ] **Step 4: Verify Task 2**

Run:

```bash
npm run build:test
node --test tests/promptBuilder.test.mjs
npm run lint
npm run typecheck
npm run format:check
```

Expected: all commands exit zero.

### Task 3: Release verification and replacement package

**Files:**
- Generated: `agents-gui-0.0.19.vsix`

- [ ] **Step 1: Run the complete release gate**

Run:

```bash
npm run verify:release
```

Expected: build, full tests, Extension Host smoke, preview, runtime dependency audit,
packaging, and whitespace checks all pass.

- [ ] **Step 2: Audit the VSIX**

Confirm the archive has no `node`, `npm`, `node_modules`, `.worktrees`, `.superpowers`, or
`.neuralmemory` paths and record its SHA-256.

- [ ] **Step 3: Commit the implementation**

Stage only the files in Tasks 1 and 2 plus this design/plan, preserving unrelated user
changes, then commit with:

```bash
git commit -m "fix: report context usage honestly"
```
