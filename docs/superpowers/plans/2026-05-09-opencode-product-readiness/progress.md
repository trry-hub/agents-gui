# Progress Log

## Session: 2026-05-09

### Phase 7: Full Product Acceptance Sweep
- **Status:** complete
- Actions taken:
  - Accepted the user request to test every plugin function from top to bottom and fix issues without stopping at analysis.
  - Re-read `planning-with-files` and `systematic-debugging` workflows.
  - Re-read `task_plan.md`, `package.json`, `scripts/preview-webview.mjs`, and extension activation code.
  - Added Phase 7 to `task_plan.md` for full acceptance.
  - Detected local providers: Claude Code exists at `/Users/t/.local/bin/claude` but is not on the raw shell PATH; Gemini, Codex, and OpenCode are on PATH; Goose and Aider are not installed.
  - Tried Computer Use against Visual Studio Code again; macOS still returned Apple event error `-1743`.
- Files created/modified:
  - `task_plan.md`
  - `progress.md`

### Phase 1: Requirements, Baseline, And Recovery
- **Status:** complete
- **Started:** 2026-05-09 Asia/Shanghai
- Actions taken:
  - Invoked the requested `planning-with-files` workflow.
  - Tried the documented session catchup script and found this installation does not include `scripts/session-catchup.py`.
  - Inspected the skill templates and current git status.
  - Confirmed the worktree already contains many staged product changes; this pass must not revert them.
  - Created project-root planning files.
  - Inspected `.vscode/launch.json`, `.vscode/tasks.json`, `package.json`, and `scripts/preview-webview.mjs`.
  - Confirmed the official debug route is Extension Host + `npm: watch`, with a preview route for visual iteration.
- Files created/modified:
  - `task_plan.md` (created)
  - `findings.md` (created)
  - `progress.md` (created)

### Phase 2: Real Debug Use And Gap Capture
- **Status:** complete
- Actions taken:
  - Starting debug/preview usage.
  - Built the extension successfully with `npm run build`.
  - Generated `/tmp/agents-gui-preview/agents-gui-preview.html`.
  - Computer Use could not access VS Code because macOS returned Apple event error `-1743`.
  - Started a local preview server on port 51437 after sandbox denied binding without escalation.
  - Opened the preview in Playwright at 430x860 and captured initial screenshot/snapshot.
  - Switched preview to OpenCode and inspected model, agent, context, and multi-agent picker popovers.
  - Found OpenCode send button was transparent on white background.
  - Ran official OpenCode CLI discovery and a minimal real `run --format json --thinking` prompt.
- Files created/modified:
  - `agents-gui-preview-initial.png` (preview artifact)
  - `agents-gui-preview-initial.yml` (preview artifact)
  - `findings.md` (updated)
  - `progress.md` (updated)

### Phase 3: Product Decisions And Design Cleanup
- **Status:** complete
- Actions taken:
  - Decided to filter internal OpenCode primary agents from main agent selection.
  - Decided to treat OpenCode `/models` and `/agents` as local UI commands.
  - Decided send button visibility is a release-blocking usability issue.
- Files created/modified:
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

### Phase 4: Implementation
- **Status:** complete
- Actions taken:
  - Filtered OpenCode `summary`, `title`, and `compaction` primary agents in parser paths.
  - Added fallback CSS vars for the OpenCode send button.
  - Added OpenCode `/models` and `/agents` local slash commands.
  - Prevented send-button click propagation from closing menus opened by slash commands.
  - Removed OpenCode's abstract `Default` model option when concrete discovered models are available.
  - Renamed OpenCode fallback model and agent mode from `Default` to `Configured/当前配置`.
  - Ensured discovered OpenCode model lists remove both legacy `default` and fallback `configured` entries.
  - Changed composer popovers from static absolute alignment to viewport-aware fixed positioning.
  - Expanded the preview OpenCode Agent list to include long custom agents and disabled subagents for clipping regression checks.
  - Removed the multi-agent participant picker, `/compare` slash command, recommendation fan-out, and task grouping.
  - Changed send behavior so each send targets only the currently active provider and its selected agent mode.
  - Changed the extension default provider to OpenCode across manifest config, sidebar fallback logic, and preview fixtures.
  - Disabled the visible task-board strip while single-agent flows are being stabilized, keeping task state internal only.
  - Changed OpenCode agent discovery and preview fixtures so the Agent menu only shows switchable primary agents, matching the official OpenCode mental model.
  - Fixed OpenCode freeform context injection so workspace-only context is still sent instead of falling back to a raw prompt.
  - Made the context chip visible for workspace-only context so users can see when `@工作区` is attached.
  - Added recent thread conversation history to provider requests so follow-up questions can reference prior chat content.
  - Polished the OpenCode layout: softened the default composer border, made the accent border appear only on focus, reduced disabled send-button weight, quieted compact model/agent/context controls, tightened transcript spacing, and added bottom breathing room.
  - Fixed Claude and Gemini headless invocation so prompts are passed as CLI arguments instead of writing to a persistent stdin session.
  - Added one-shot stdin EOF handling for headless stdin providers and restricted stdin session reuse to profiles that explicitly opt into `keepStdinOpen`.
  - Added a 45-second no-output notice for provider processes that are still running but have produced no stdout/stderr, so the sidebar does not silently sit on Thinking forever.
  - Switched Claude Code to `--output-format stream-json --verbose --include-partial-messages` and added `text_delta` parsing so Claude output can render incrementally instead of arriving as one completed block.
  - Suppressed Claude Code final assistant/result JSON messages in the formatter to prevent duplicate rendering after partial streaming.
  - Updated tests for parser, CSS, and slash command behavior.
- Files created/modified:
  - `src/opencodeAgents.ts`
  - `media/main.css`
  - `media/main.js`
  - `media/i18n.js`
  - `scripts/preview-webview.mjs`
  - `src/cliManager.ts`
  - `tests/promptBuilder.test.mjs`

### Phase 5: Verification
- **Status:** complete
- Actions taken:
  - Ran `npm test` after parser/CSS fix: 93 passing.
  - Ran `npm test` after slash command fix: 93 passing.
  - Ran `npm run build` after fixes: build complete.
  - Regenerated preview and verified OpenCode send button styles by computed style and screenshot.
  - Verified `/models` opens the model menu without system error.
  - Verified 320px OpenCode preview has no horizontal overflow.
  - Ran `git diff --check`: no whitespace errors.
  - Removed generated preview screenshot/snapshot artifacts and stopped the temporary preview server.
  - Ran `npm test` after removing OpenCode `Default` model from discovered model lists: 93 passing.
  - Ran `npm run build` after the model menu change: build complete.
  - Ran `git diff --check` after the model menu change: no whitespace errors.
  - Ran `npm test` after removing OpenCode fallback `Default` labels: 93 passing.
  - Ran `npm run build` after fallback-label cleanup: build complete.
  - Ran `git diff --check` after fallback-label cleanup: no whitespace errors.
  - Regenerated preview and verified OpenCode provider/menu text contains no `Default` or `默认`.
  - Ran `npm test` after viewport-aware popover positioning: 93 passing.
  - Ran `npm run build` after popover positioning: build complete.
  - Ran `git diff --check` after popover positioning: no whitespace errors.
  - Verified long OpenCode Agent popover at 430x860 and 320x900; measured bounding boxes stayed inside viewport.
  - Ran `npm test` after removing multi-agent compare/fan-out: 93 passing.
  - Ran `npm run build` after removing multi-agent compare/fan-out: build complete.
  - Ran `git diff --check` after removing multi-agent compare/fan-out: no whitespace errors.
  - Verified preview send emits one `send` message for the active OpenCode provider and no participant picker or compare entry is rendered.
  - Ran `npm test` after changing the default provider to OpenCode: 94 passing.
  - Ran `npm run build` after changing the default provider: build complete.
  - Ran `git diff --check` after changing the default provider: no whitespace errors.
  - Verified preview opens with `providerValue=opencode`, OpenCode placeholder, `mimo-v2.5-pro`, and `Sisyphus - Ultraworker`.
  - Ran `npm test` after disabling the visible task-board strip: 94 passing.
  - Ran `npm run build` after disabling the visible task-board strip: build complete.
  - Ran `git diff --check` after disabling the visible task-board strip: no whitespace errors.
  - Verified preview send keeps `taskBoardHidden=true`, `display=none`, and sends only one OpenCode message while the stop button remains available.
  - Ran `npm test` after hiding OpenCode subagents from the Agent switcher: 94 passing.
  - Ran `npm run build` after hiding OpenCode subagents from the Agent switcher: build complete.
  - Ran `git diff --check` after hiding OpenCode subagents from the Agent switcher: no whitespace errors.
  - Verified preview Agent menu contains only switchable OpenCode primary agents and no disabled subagent rows.
  - Ran `npm test` after fixing OpenCode workspace-only context: 95 passing.
  - Ran `npm run build` after fixing OpenCode workspace-only context: build complete.
  - Ran `git diff --check` after fixing OpenCode workspace-only context: no whitespace errors.
  - Verified preview workspace-only context shows `工作区` with title `上下文: agents-gui`.
  - Ran `npm test` after adding conversation-history context: 97 passing.
  - Ran `npm run build` after adding conversation-history context: build complete.
  - Ran `git diff --check` after adding conversation-history context: no whitespace errors.
  - Verified preview second send includes prior user and assistant messages in `conversationHistory`.
  - Ran `npm test` after OpenCode visual polish: 97 passing.
  - Ran `npm run build` after OpenCode visual polish: build complete.
  - Ran `git diff --check` after OpenCode visual polish: no whitespace errors.
  - Verified preview computed styles after visual polish: soft default composer border, accent focus border, disabled send opacity `0.44`, `9px` message gap, `24px` message bottom padding, compact `22px` controls, and hidden task board.
  - Inspected real stuck processes and found Claude was running as `/Users/t/.local/bin/claude -p --permission-mode default`, proving the prompt was not passed to `-p`.
  - Checked local Claude Code `2.1.118` and Gemini CLI `0.40.0` help output to confirm their headless prompt contracts.
  - Ran `npm test` after fixing headless CLI invocation and no-output notices: 99 passing.
  - Ran `npm run build` after fixing headless CLI invocation and no-output notices: build complete.
  - Ran `git diff --check` after fixing headless CLI invocation and no-output notices: no whitespace errors.
  - Checked Claude Code CLI help and official docs for stream-json partial output requirements.
  - Ran `npm test` after enabling Claude Code partial stream parsing: 101 passing.
  - Ran `npm run build` after enabling Claude Code partial stream parsing: build complete.
  - Ran `git diff --check` after enabling Claude Code partial stream parsing: no whitespace errors.
  - Ran full installed-provider detection: Claude Code `2.1.118`, Gemini CLI `0.40.0`, Codex CLI `0.128.0`, OpenCode `1.14.39`; Goose and Aider are not installed.
  - Added `scripts/qa-cli-smoke.mjs` and used it with escalation to verify real CLI smoke behavior for Claude, Gemini, Codex, and OpenCode.
  - Found OpenCode `oh-my-openagent` telemetry could delay/timeout runs in restricted networks; disabled PostHog telemetry in OpenCode profile/discovery/QA environments.
  - Found Codex's abstract default model path could stall on model/plugin refresh; changed Codex to default to explicit `gpt-5.4`, removed the visible `Default` model option, and made Codex prompt runs ephemeral.
  - Expanded webview preview fixtures to include Claude and Gemini so provider UI coverage matches installed CLIs.
  - Verified preview top-to-bottom with Playwright: provider switch, Codex model menu, permission menu, OpenCode agent menu, context menu, slash palette, two-turn history, image attachment, stop button, new/delete thread, transcript rendering, and popover clipping.
  - Verified each installed provider in preview supports two-turn request history handoff: Claude, Gemini, Codex, and OpenCode second sends each carried two prior messages.
  - Ran `npm test` after the Phase 7 fixes: 101 passing.
  - Ran `npm run build` after the Phase 7 fixes: build complete.
  - Ran `git diff --check` after the Phase 7 fixes: no whitespace errors.
- Files created/modified:
  - Preview artifacts generated for inspection.

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| Planning catchup | `python3 /Users/t/.agents/skills/planning-with-files/scripts/session-catchup.py ...` | Previous-session report or no-op | Script file missing | Logged |
| Extension build | `npm run build` | Build completes | Build complete | ✓ |
| Preview generation | `node scripts/preview-webview.mjs` | HTML written | `/tmp/agents-gui-preview/agents-gui-preview.html` | ✓ |
| Preview load | Playwright navigate to local preview | Sidebar renders | Initial sidebar rendered | ✓ |
| OpenCode CLI baseline | `opencode run --format json --thinking --model opencode/minimax-m2.5-free '只回答：OK'` | Fast JSON text response | Returned reasoning + `OK` | ✓ |
| OpenCode send contrast | Preview OpenCode with prompt | Visible enabled send button | Purple background, white arrow | ✓ |
| OpenCode `/models` | Type `/models`, send | Opens model menu, no error | Model menu open, no system messages | ✓ |
| OpenCode 320px layout | 320x900 preview | No horizontal overflow, send visible | `overflowX=false`, send visible | ✓ |
| OpenCode concrete models | Discovered model list present | No abstract `Default` option | `mergeOpenCodeModelOptions` drops `default`; preview OpenCode models start at `mimo-v2.5-pro` | ✓ |
| OpenCode fallback labels | OpenCode selected in preview | No `Default/默认` text in model menu or footer | Menu shows `mimo/mimo-v2.5-pro`, `opencode/big-pickle`, `自定义`; `hasDefaultText=false` | ✓ |
| OpenCode long Agent popover | 430x860 and 320x900 preview | Popover does not clip left/right/top/bottom | 430: `8,483,368,757`; 320: `8,525,312,799`; all overflow flags false | ✓ |
| Single active provider send | OpenCode selected with prompt | Exactly one send message, active provider only | `sendCount=1`, `cliId=opencode`, no `agentPicker` element | ✓ |
| Default provider | Fresh preview load | OpenCode selected by default | `providerValue=opencode`, model `mimo-v2.5-pro`, agent `Sisyphus - Ultraworker` | ✓ |
| Visible task strip | OpenCode send in preview | No `Running 1` task strip | `taskBoardHidden=true`, `display=none`, stop button visible | ✓ |
| OpenCode Agent menu | Open Agent switcher in preview | Only primary agents are shown | Sisyphus, Atlas, Hephaestus, Prometheus; `disabledCount=0`; no subagent labels | ✓ |
| OpenCode workspace context | Workspace-only context summary | Context is visible and sent | Prompt builder includes `Workspace root`; preview chip shows `工作区` | ✓ |
| Conversation history context | Send a follow-up after one completed reply | Second send includes prior thread messages | `conversationHistory` contains previous user and assistant messages | ✓ |
| OpenCode visual polish | 430x860 preview | Softer composer and denser transcript | Default/focus border verified, disabled send opacity `0.44`, message gap `9px`, task board hidden | ✓ |
| Claude stuck process inspection | `ps aux` while Claude Code was stuck | Prompt should be passed to headless CLI | Actual command was `/Users/t/.local/bin/claude -p --permission-mode default`, missing prompt argument | Root cause |
| Headless CLI invocation | `npm test` | Claude/Gemini use prompt args; stdin closes unless explicitly persistent | 99 passing | ✓ |
| Claude partial streaming | Synthetic Claude Code `stream_event` JSON lines | `text_delta` renders incrementally; final assistant JSON is ignored | `normalizeCliOutputChunk` streams deltas and hides final duplicate JSON; 101 passing | ✓ |
| Installed CLI detection | Local PATH + augmented PATH | Installed providers and versions are known | Claude `2.1.118`, Gemini `0.40.0`, Codex `0.128.0`, OpenCode `1.14.39`; Goose/Aider absent | ✓ |
| Real CLI smoke | `node scripts/qa-cli-smoke.mjs` with real user environment | Installed CLIs answer `OK` or stream equivalent | Claude, Gemini, Codex, OpenCode matched; script exit code 0 | ✓ |
| OpenCode telemetry latency | Real OpenCode smoke in restricted network | Extension-managed process should not block on PostHog | `OMO_DISABLE_POSTHOG=1`, `OMO_SEND_ANONYMOUS_TELEMETRY=0`; OpenCode smoke completed in ~9s | ✓ |
| Codex concrete default | Codex model menu and real smoke | No abstract `Default`; prompt uses a working concrete model | UI shows `GPT-5.4`, `GPT-5.5` etc.; Codex smoke returned `OK` | ✓ |
| Webview top-to-bottom controls | Playwright preview at 812x1400 | No clipped popovers; controls work | Model/agent/context popovers all inside viewport; outside click/Escape close menus | ✓ |
| Attachments | Preview file input with PNG | Attachment chip appears, send includes image payload, strip clears after send | `attachmentCount=1`, mime `image/png`, strip hidden after send | ✓ |
| Stop | Preview run then stop | Stop button appears and posts stop command | `newStopCount=1`, `cliId=opencode` | ✓ |
| Threads | New/delete thread controls | New thread empties view; delete returns to prior thread | New active label `新会话`, delete restored previous `线程测试` thread | ✓ |
| Multi-turn per provider | Claude/Gemini/Codex/OpenCode preview | Second send includes previous turn history | All four second sends had `conversationHistory.length=2` | ✓ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-05-09 | Missing `session-catchup.py` under `/Users/t/.agents/skills/planning-with-files/scripts/` | 1 | Inspected available templates and initialized planning files manually. |
| 2026-05-09 | Computer Use `list_apps`/`get_app_state` returned Apple event error `-1743` | 1 | Fell back to Playwright preview and shell-driven Extension Host inspection. |
| 2026-05-09 | Sandbox denied `python3 -m http.server 51437` with `PermissionError: [Errno 1] Operation not permitted` | 1 | Re-ran with approved escalation for the temporary local preview server. |
| 2026-05-09 | Direct `opencode agent list/models` hit `PRAGMA wal_checkpoint(PASSIVE)` DB lock | 1 | Retried with isolated `OPENCODE_DB` and escalation for SQLite/WAL access. |
| 2026-05-09 | OpenCode send button had transparent background in preview | 1 | Added fallback theme variables in provider-specific CSS. |
| 2026-05-09 | `/models` opened then immediately closed | 1 | Stopped send-button click propagation so document outside-click handler does not close the newly opened menu. |
| 2026-05-09 | OpenCode model menu showed confusing `Default` option despite concrete models | 1 | Drop `default` from OpenCode model options when discovery returns real models. |
| 2026-05-09 | OpenCode fallback model/agent labels still used confusing `Default` semantics | 1 | Changed OpenCode fallback to `Configured/当前配置` and added regression assertions. |
| 2026-05-09 | Long OpenCode Agent popover was clipped or pressed against the sidebar edge | 1 | Switched composer popovers to fixed viewport-aware positioning and clamped their bounding box to the webview viewport. |
| 2026-05-09 | Multi-agent compare/fan-out made the product harder to stabilize | 1 | Removed participant selection and compare planning so each provider can be validated as a normal single agent first. |
| 2026-05-09 | OpenCode felt like it had no context when no editor was active | 1 | Root cause was OpenCode freeform only injecting context for file/selection/diagnostics; fixed workspace-only context injection and chip visibility. |
| 2026-05-09 | Follow-up questions felt like they had no memory of prior chat | 1 | Root cause was webview not sending stored thread messages to the provider request; added bounded recent conversation history to prompts. |
| 2026-05-09 | Claude and similar CLIs could stay on Thinking for minutes | 1 | Root cause was treating headless prompt modes as persistent stdin sessions; Claude/Gemini now receive prompt arguments, one-shot stdin closes with EOF, and silent providers show a no-output notice. |
| 2026-05-09 | Claude Code waited then rendered the whole answer at once | 1 | Root cause was using default text output; Claude now runs with `stream-json`, `--verbose`, and `--include-partial-messages`, and the formatter streams `text_delta` chunks. |
| 2026-05-09 | OpenCode smoke delayed or timed out during PostHog flush | 1 | Disabled `oh-my-openagent` PostHog telemetry for extension-managed OpenCode processes and QA smoke. |
| 2026-05-09 | Codex smoke stalled through the default model path | 1 | Switched Codex default model to explicit `gpt-5.4`, removed the visible model `Default`, and made prompt runs ephemeral. |

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | Phase 7 complete |
| Where am I going? | Awaiting user confirmation on delivery or next scope |
| What's the goal? | Make the OpenCode integration feel mature, official-like, and shippable while prioritizing stable single-agent provider flows. |
| What have I learned? | See findings.md |
| What have I done? | Implemented and verified OpenCode-first acceptance fixes across adapter, webview, and CLI smoke coverage. |
