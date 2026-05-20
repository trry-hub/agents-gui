# Findings & Decisions

## Requirements
- Use the `planning-with-files` workflow for persistent planning.
- In the VS Code debug environment, truly use the plugin's OpenCode integration.
- Compare against official OpenCode/Copilot-style expectations and fill functional gaps.
- Adjust style, design, visuals, and interactions until the product feels mature enough to ship.
- Keep checking, recording, fixing, and verifying rather than stopping at analysis.

## Research Findings
- Current worktree already contains extensive staged changes for OpenCode agent/model discovery, composer UI, transcript rendering, prompt simplification, and product docs.
- Previous real OpenCode log investigation showed a simple prompt was slow because it was sent to `Sisyphus - Ultraworker` with a project-context wrapper; OpenCode then read project files before answering.
- The OpenCode freeform prompt path was already changed to send raw text when no substantial IDE context is attached.
- Debug route exists: `.vscode/launch.json` has `Run Agents GUI Extension`, which launches an Extension Host with `--extensionDevelopmentPath=${workspaceFolder}` and `preLaunchTask: npm: watch`.
- Watch task exists: `.vscode/tasks.json` runs `npm run watch`, uses an esbuild background problem matcher, and ends when "Watching for changes..." appears.
- Preview route exists: `scripts/preview-webview.mjs` writes `/tmp/agents-gui-preview/agents-gui-preview.html` and stubs profiles/context/send messages for UI checks.
- Official OpenCode CLI version is `1.14.39`.
- Official `opencode models` with isolated DB returned `opencode/big-pickle`, `opencode/minimax-m2.5-free`, `opencode/nemotron-3-super-free`, and `mimo/mimo-v2.5-pro`.
- Official `opencode agent list` returns user-facing agents mixed with internals/subagents. Extracted names included `build (subagent)`, `explore (subagent)`, `general (subagent)`, `plan (subagent)`, `summary/title/compaction (primary)`, `Atlas - Plan Executor (primary)`, `Hephaestus - Deep Agent (primary)`, `librarian (subagent)`, and `Metis - Plan Consultant (subagent)`.
- A minimal real OpenCode run using `opencode run --format json --thinking --model opencode/minimax-m2.5-free '只回答：OK'` returned JSON reasoning and text `OK` in a few seconds, so the raw CLI streaming path is healthy.
- Real process inspection found the stuck Claude run was `/Users/t/.local/bin/claude -p --permission-mode default`, with no prompt argument after `-p`; this explains the sidebar staying on Thinking.
- Claude Code `2.1.118` help says `-p/--print` is non-interactive and the prompt is the positional argument. Gemini CLI `0.40.0` help says `-p/--prompt` runs headless mode with the given prompt string.
- Claude Code text output is message-level, so it can wait for the full answer before stdout updates. Official docs say token streaming requires `--output-format stream-json --verbose --include-partial-messages` and reading `stream_event.event.delta.text`.
- Phase 7 environment sweep: Gemini `0.40.0`, Codex `0.128.0`, and OpenCode `1.14.39` are on PATH; Claude Code `2.1.118` is installed at `/Users/t/.local/bin/claude` and is discoverable when the extension's augmented PATH includes `~/.local/bin`; Goose and Aider are not installed.
- Computer Use still cannot inspect VS Code because macOS returns Apple event error `-1743`, so automated UI acceptance must use generated webview preview plus direct CLI/process checks.
- Real full-provider smoke with `scripts/qa-cli-smoke.mjs` succeeded for the installed providers after fixes: Claude, Gemini, Codex, and OpenCode all matched the expected `OK` response or streaming event path; Goose and Aider remain uninstalled.
- OpenCode latency was partly environment-induced: `oh-my-openagent` PostHog flush can block or timeout when network is restricted. Setting `OMO_DISABLE_POSTHOG=1` and `OMO_SEND_ANONYMOUS_TELEMETRY=0` removes that extension-managed latency source.
- Codex's abstract default model path can stall while refreshing models/plugins. Using explicit `gpt-5.4` as the default avoids the confusing `Default` UI and produced a successful real smoke response on Codex `0.128.0`.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Start by measuring current behavior in debug/preview before more UI changes | Prevents polishing the wrong layer and gives evidence for product gaps. |
| Compare against "official behavior" by semantics, not exact pixel copying | We want native OpenCode concepts and VS Code polish without recreating another extension's private UI wholesale. |
| Use Extension Host for actual OpenCode flows and preview for fast UI iteration | The extension host catches VS Code integration issues; preview is deterministic and safer for repeated layout checks. |
| Hide OpenCode `summary`, `title`, and `compaction` from main agent selection | These are internal maintenance agents; showing them as main modes creates accidental misrouting. |
| Make `/models` and `/agents` local OpenCode menu commands | In the extension sidebar, opening the menu is the expected UI equivalent; unsupported-command toasts feel broken. |
| Hide OpenCode `Default` model when concrete models are discovered | Once `opencode models` succeeds, the abstract default choice is redundant and makes users unsure which model will run. |
| Remove OpenCode `Default` fallback labels from model and agent controls | OpenCode users should see a concrete discovered model/agent whenever possible; if discovery is unavailable, "当前配置/Configured" is clearer than a fake default. |
| Treat Claude and Gemini as prompt-argument CLIs, not persistent stdin sessions | Their current CLI contracts expect a prompt argument for headless mode; sending stdin without EOF leaves processes hanging. |
| Close stdin for headless stdin providers unless a profile explicitly opts into persistent stdin | One-shot CLI commands need EOF to start/finish reliably; persistent stdin should be an explicit capability, not the default. |
| Use Claude Code partial stream-json for sidebar rendering | Default `text` output only gives completed messages; partial stream events give incremental deltas and avoid the "wait, then full dump" feel. |
| Use explicit Codex `GPT-5.4` instead of a visible `Default` model | Real smoke showed the default path is slower and less predictable; explicit model selection is clearer and aligns with the user's objection to default chips. |
| Disable OpenCode plugin telemetry in extension-owned runs | Provider telemetry should not make the sidebar feel hung; disabling it does not remove model/agent functionality. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Planning skill references a recovery script absent from this installation | Created planning files from templates and logged the error in task_plan.md/progress.md. |
| OpenCode send button was transparent in preview | Added fallback CSS vars so the button remains visible even when VS Code theme variables are absent in preview/webview. |
| Slash `/models` menu closed immediately | Send button click bubbled to the document-level outside-click closer; stopped propagation for send clicks. |
| OpenCode model menu showed `Default` alongside concrete models | Removed abstract `Default` from merged OpenCode model options whenever discovered models are available; fallback now says `Configured/当前配置` instead. |
| OpenCode fallback still showed `Default` when discovery was unavailable | Renamed OpenCode fallback model and agent mode to `Configured/当前配置` and ensured discovered models drop both legacy `default` and fallback `configured` choices. |
| Long OpenCode Agent popover could be clipped at the sidebar edge | Root cause was absolute positioning inside the composer with static left/right alignment; composer popovers now use fixed viewport-aware positioning and clamp left/top/max-height to the visible webview. |
| Multi-agent fan-out and compare plans created product noise before single-agent flows were stable | Removed the participant picker, `/compare`, recommendation fan-out, task groups, and related state so each send starts exactly one active provider run. |
| Claude/Gemini-style providers could stay in Thinking indefinitely | Fixed Claude and Gemini to pass prompts as arguments, close stdin after one-shot stdin sends, prevent non-persistent stdin session reuse, and show a 45s no-output notice when a provider process is still running but silent. |
| Claude Code returned the full answer at once after a delay | Root cause was the profile still using Claude Code's default `text` output. Switched Claude to `stream-json` with partial messages and added formatter parsing for `text_delta` events while ignoring final duplicate assistant/result JSON. |
| OpenCode could spend noticeable time flushing PostHog telemetry | Disabled `oh-my-openagent` PostHog telemetry in OpenCode profile/discovery environments and QA smoke. |
| Codex default model selection was both visually confusing and operationally brittle | Removed the visible `Default` model option, defaulted to `GPT-5.4`, and added `--ephemeral` to Codex prompt runs. |
| Preview coverage missed installed non-OpenCode providers | Added Claude and Gemini preview fixtures and verified two-turn history handoff for Claude, Gemini, Codex, and OpenCode. |

## Resources
- Project root: `/Users/t/6bt/myproject/agents-gui`
- Planning skill: `/Users/t/.agents/skills/planning-with-files/SKILL.md`
- OpenCode adapter files: `src/cliProfiles.ts`, `src/cliManager.ts`, `src/opencodeAgents.ts`, `src/outputFormatter.ts`, `src/promptBuilder.ts`, `src/sidebarProvider.ts`
- Webview files: `media/main.html`, `media/main.js`, `media/main.css`, `media/i18n.js`
- Preview script: `scripts/preview-webview.mjs`

## Visual/Browser Findings
- Preview initial state at 430x860 shows a clean but sparse sidebar: empty-state content is centered, composer is pinned to bottom, but controls wrap into two rows and feel less mature than official agent composers.
- Preview default provider is Codex, so OpenCode-specific readiness still needs explicit provider switching in preview/debug.
- Composer issue: lower control row has uneven rhythm; the agent selector, context chip, plus button, permission/model controls, and send button do not form one coherent command bar at narrow width.
- OpenCode 430px preview after fixes: send button is visible purple with white arrow; model, agent, context, and agent-picker popovers open upward without clipping.
- OpenCode `/models` now opens the local model menu and produces no unsupported-command system message.
- OpenCode 320px preview after fixes: no horizontal overflow; composer wraps context to a second row while keeping send button visible and reachable.
- OpenCode 430px preview after removing fallback defaults: active provider is OpenCode, model summary is `mimo-v2.5-pro`, model menu items are `mimo/mimo-v2.5-pro`, `opencode/big-pickle`, and `自定义`; page text contains no `Default` or `默认`.
- OpenCode long Agent menu after viewport-aware positioning: at 430x860 the popover rect is `left=8, right=368, top=483, bottom=757`; at 320x900 it is `left=8, right=312, top=525, bottom=799`; all overflow checks are false.
- After removing multi-agent compare features, preview sends post only one `send` message for the active OpenCode provider and the composer no longer renders the participant picker.
- Phase 7 preview sweep at 812x1400: provider switch, model menu, permission menu, OpenCode agent menu, context menu, and slash palette all stayed inside the viewport and closed on outside click or Escape.
- Attachment preview with a PNG showed the attachment chip, enabled send, posted one `image/png` attachment, and cleared the strip after send.
- Stop control preview showed the stop button during a running request and posted `{ command: "stop", cliId: "opencode" }`.
- Thread controls preview: new chat created an empty `新会话`, and delete restored the prior conversation.
- Multi-turn preview: Claude, Gemini, Codex, and OpenCode each posted the second send with two prior conversation messages in `conversationHistory`.
