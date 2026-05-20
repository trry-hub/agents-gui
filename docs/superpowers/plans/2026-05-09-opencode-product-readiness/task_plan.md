# Task Plan: OpenCode Parity And Product Readiness

## Goal
Make the Agents GUI OpenCode experience feel close to the official OpenCode/Copilot-style workflow, prioritizing stable single-agent flows before reintroducing multi-agent comparison or parallel work.

## Current Phase
Phase 7

## Phases

### Phase 1: Requirements, Baseline, And Recovery
- [x] Capture the user goal and quality bar.
- [x] Inspect current repo state without reverting existing changes.
- [x] Record initial errors and constraints.
- [x] Identify the current debug/test route for real OpenCode usage.
- **Status:** complete

### Phase 2: Real Debug Use And Gap Capture
- [ ] Launch or attach to the extension debug environment.
- [x] Run several OpenCode flows: simple chat, context-aware prompt, model switch, agent switch, menu dismissal, streaming baseline.
- [x] Compare against official-style expectations from OpenCode/Copilot-like UX.
- [x] Record visual, interaction, streaming, and capability gaps in findings.md.
- **Status:** complete

### Phase 3: Product Decisions And Design Cleanup
- [x] Decide which gaps are must-fix before "上线" quality.
- [x] Simplify or redesign awkward controls.
- [x] Tighten transcript density, thinking display, and composer behavior.
- [x] Preserve official OpenCode semantics for agents/models wherever possible.
- **Status:** complete

### Phase 4: Implementation
- [x] Implement high-confidence fixes in scoped files.
- [x] Add or update regression tests for behavior and visual contracts.
- [x] Avoid reverting staged/user changes unrelated to this pass.
- **Status:** complete

### Phase 5: Verification
- [x] Run automated tests and build.
- [x] Use preview/debug environment after implementation.
- [x] Record remaining risks and any non-blocking follow-ups.
- **Status:** complete

### Phase 6: Delivery
- [x] Summarize what was fixed, what was verified, and what remains.
- [x] Leave planning files current for future recovery.
- **Status:** complete

### Phase 7: Full Product Acceptance Sweep
- [x] Build a feature matrix from manifest, webview controls, provider profiles, and editor commands.
- [x] Detect locally installed CLI providers and their versions.
- [x] Exercise the webview from top to bottom in preview: thread controls, provider switch, model switch, agent switch, permissions/runtime, context, slash commands, attachments, send, stop, and transcript rendering.
- [x] Exercise each installed provider with direct minimal CLI smoke tests, and verify multi-turn history handoff for each installed provider in the webview flow.
- [x] Fix every reproducible defect found during the sweep before moving on.
- [x] Re-run automated tests, build, whitespace checks, and targeted preview checks after fixes.
- **Status:** complete

## Key Questions
1. Is OpenCode slow because of our adapter, the selected custom agent, the model/provider, or UI buffering?
2. Which official OpenCode interactions are missing: agent visibility, model switching, streaming, tools, permissions, session reuse, stop/cancel, or transcript rendering?
3. Which UI elements still feel non-native or visually noisy in a VS Code sidebar?
4. Can a first-time user understand and control "which agent(s) will work" at send time without tab-like provider switching?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Use file-based planning for this pass | The task spans debug use, product assessment, UI/code changes, and verification. |
| Do not revert existing staged changes | Current worktree contains many prior product changes; this pass should build on them safely. |
| Treat OpenCode freeform without IDE context as raw prompt | Previous investigation showed wrapper prompts caused unnecessary project inspection and slow first response. |
| Use both Extension Host and preview evidence | Extension Host proves real VS Code integration; preview gives faster repeatable visual checks. |
| Filter OpenCode internal primary agents from user selection | `summary`, `title`, and `compaction` are maintenance agents and should not be presented as main chat modes. |
| Treat OpenCode `/models` and `/agents` as local UI commands | In a sidebar non-interactive run flow, opening the local menu is more useful than showing unsupported native-command errors. |
| Pause multi-agent fan-out and compare plans | The current priority is making each provider work reliably as a single active agent; multi-agent comparison needs a dedicated design before returning. |
| Full acceptance uses installed providers only for real network/model calls | The extension can list uninstalled providers, but "correct multi-turn" can only be verified on CLIs present and authenticated on this machine. |
| Make Codex model selection concrete by default | Real smoke showed Codex's abstract default path can stall on plugin/model refresh; `GPT-5.4` is explicit, present in the UI, and passed as `--model gpt-5.4`. |
| Disable OpenCode oh-my-openagent telemetry inside extension-managed processes | Real smoke showed PostHog flush can block in restricted networks; extension-run OpenCode should not pay that latency tax. |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `/Users/t/.agents/skills/planning-with-files/scripts/session-catchup.py` missing | 1 | Skill install has no scripts directory here; inspected templates directly and created project-root planning files manually. |
| OpenCode send button became transparent on preview theme | 1 | Added fallback theme variables to the OpenCode send-button background/disabled styles. |
| `/models` opened then immediately closed | 1 | Stopped send-button click propagation so the global outside-click closer does not close menus opened by slash commands. |
| OpenCode smoke was delayed by `oh-my-openagent` PostHog flush | 1 | Set `OMO_DISABLE_POSTHOG=1` and `OMO_SEND_ANONYMOUS_TELEMETRY=0` for OpenCode profile, discovery, and QA smoke. |
| Codex default model path stalled on plugin/model refresh | 1 | Changed Codex default model to `gpt-5.4`, removed the visible `Default` model option, and made Codex runs ephemeral. |
| Preview did not cover Claude/Gemini provider UI | 1 | Added Claude and Gemini fixtures to the preview so provider switching and multi-turn payloads cover all installed providers. |

## Notes
- Update findings.md after every two visual/browser/debug inspections.
- Prefer real usage evidence over speculative UI critique.
- Quality bar: mature enough that the OpenCode flow can be used daily from the sidebar without obvious rough edges.
- Residual risk: Computer Use could not control VS Code because macOS returned Apple event error `-1743`; debug verification used preview plus direct OpenCode CLI evidence instead.
- Current scope: one send action starts one active provider run; multi-provider fan-out and `/compare` are intentionally removed for now.
