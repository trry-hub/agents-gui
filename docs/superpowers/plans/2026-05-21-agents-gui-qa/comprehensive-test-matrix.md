# Agents GUI Comprehensive QA Matrix - 2026-05-21

This matrix expands the initial smoke QA into release-style coverage. Status values:

- Manual pass: verified in the live VS Code Extension Development Host with Computer Use.
- Automated pass: covered by the current Node test suite.
- Static pass: verified by manifest/source/package inspection or build output.
- Fixed: issue was found and fixed during this QA pass.
- Needs review: observed risk or UX ambiguity, not fixed in this pass.
- Not run: planned coverage that still needs live execution, usually because it starts provider work, mutates state, or needs a clean install profile.

## Install, Activation, And Packaging

| ID | Area | Case | Expected | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| AGUI-001 | Install | Install current VSIX into a clean VS Code profile | Extension installs without missing asset/runtime errors | Clean profile install | Not run |
| AGUI-002 | Activation | Open VS Code after install | Agents GUI view contribution activates without command errors | Extension host entrypoint tests | Automated pass |
| AGUI-003 | Activation | Execute every contributed command id | Each manifest command has a registered handler | `extensionActivation.test.mjs` | Automated pass |
| AGUI-004 | Activation | View title commands register before sidebar provider construction | Title buttons work immediately after activation | Source-order regression test | Automated pass |
| AGUI-005 | Package | Package VSIX | VSIX contains `dist/extension.js`, `media/*`, and `tiktoken_bg.wasm` | `npm run package` | Static pass |
| AGUI-006 | Package | Check package version | VSIX and manifest use the intended `0.0.2` version | `package.json`, package output | Static pass |
| AGUI-007 | Package | Verify webview CSP | Webview keeps a strict CSP and loads local assets | Webview CSP test | Automated pass |
| AGUI-008 | Branding | Marketplace/sidebar logo | Logo has no unwanted white background and uses toolbar-sized assets | Branding tests plus prior visual check | Automated pass |
| AGUI-009 | Naming | Command/config ids vs user-facing name | Runtime identifiers stay stable while UI copy is readable | Manifest/source review | Static pass |
| AGUI-010 | Generated artifacts | Build output does not include accidental local files | VSIX file list contains expected 26 files | Package output review | Static pass |

## First Launch And Provider Detection

| ID | Area | Case | Expected | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| AGUI-011 | First launch | Open Agents GUI side bar | Provider tabs, history, empty state, and composer render without overlap | Computer Use | Manual pass |
| AGUI-012 | Loading | Provider scan in progress | Shows detecting/loading state, not an empty-provider error | Existing provider loading tests | Automated pass |
| AGUI-013 | Empty providers | No supported provider installed | Shows provider setup message and disables send | Simulated state test/source review | Automated pass |
| AGUI-014 | Provider tabs | Installed providers only | Hidden/unavailable providers do not appear as broken choices | Header/provider tests | Automated pass |
| AGUI-015 | Provider default | Fresh state | OpenCode is the default active provider | Extension default test | Automated pass |
| AGUI-016 | Provider switching | Click another provider tab | Composer identity, placeholder, and controls update to that provider | Provider identity tests | Automated pass |
| AGUI-017 | Provider refresh | Click refresh providers | Provider/context reloads without losing the sidebar | `extensionActivation.test.mjs` | Automated pass |
| AGUI-018 | Missing provider | Select unavailable provider path | Input is disabled and install/configure guidance is visible | Source/UI test coverage | Automated pass |
| AGUI-019 | Provider persistence | Reload webview after selecting provider | Last provider is restored | Persistent selection tests | Automated pass |
| AGUI-020 | Provider status | Provider running/preparing/completed status | Status text is displayed in transcript/status areas, not inside composer controls | Provider status tests | Automated pass |

## Composer, Controls, And Input

| ID | Area | Case | Expected | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| AGUI-021 | Composer | Empty input | Send button is disabled | Computer Use | Manual pass |
| AGUI-022 | Composer | Type normal text | Send button becomes enabled | Computer Use | Manual pass |
| AGUI-023 | Composer | Press Enter with text | Sends prompt once to active provider | Live provider run | Not run |
| AGUI-024 | Composer | Press Shift+Enter | Inserts newline and does not send | Source-level key handling | Static pass |
| AGUI-025 | Composer | Very long prompt | Textarea grows up to max height without covering controls | Long-prompt composer regression test | Automated pass |
| AGUI-026 | Composer | Provider-specific placeholder | Placeholder includes selected provider name | i18n/source tests | Automated pass |
| AGUI-027 | Composer | Browser autocomplete noise | Text inputs opt out of autocomplete artifacts | Regression test | Automated pass |
| AGUI-028 | Composer | Attach image button | Opens file picker or attachment flow without layout jump | Live UI with confirmation | Not run |
| AGUI-029 | Composer | Paste image | Image becomes an attachment and can be sent with prompt | Paste attachment tests | Automated pass |
| AGUI-030 | Composer | Attached context chip | Shows workspace/file/selection/problem summary and token details | Context chip tests | Automated pass |
| AGUI-031 | Composer | Context budget hover/focus | Popover positions inside viewport | Popover positioning tests | Automated pass |
| AGUI-032 | Composer | Model menu | Opens as a single-layer menu and avoids viewport clipping | Computer Use | Manual pass |
| AGUI-033 | Composer | Agent/mode menu | Shows provider-native mode options and persists selection | Computer Use | Manual pass |
| AGUI-034 | Composer | Permission menu | Localized permission labels render correctly | Localization tests | Automated pass |
| AGUI-035 | Composer | Runtime menu | Local/remote runtime control stays outside prompt shell | Runtime layout tests | Automated pass |
| AGUI-036 | Composer | Custom model missing value | Send stays disabled until custom model is provided | Source/UI guard tests | Automated pass |
| AGUI-037 | Composer | Click outside open composer menus | Menus close cleanly | Regression tests | Automated pass |
| AGUI-038 | Composer | Escape with open composer menu | Open menu closes instead of sending/stopping | Regression tests | Automated pass |

## Slash Command Palette

| ID | Area | Case | Expected | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| AGUI-039 | Slash | Type `/` | Palette appears inside composer, above textarea, without floating gap | Computer Use + CSS tests | Manual pass |
| AGUI-040 | Slash | Palette layout | Palette uses in-flow layout, not absolute overlay | CSS regression test | Automated pass |
| AGUI-041 | Slash | Command list content | Shows provider-aware commands with one label each | Regression tests | Automated pass |
| AGUI-042 | Slash | OpenCode commands | OpenCode-specific commands appear only for OpenCode | Provider command tests | Automated pass |
| AGUI-043 | Slash | Non-OpenCode provider commands | Native commands follow active provider | Provider matching tests | Automated pass |
| AGUI-044 | Slash | Query filtering, e.g. `/mo` | List filters to matching commands | Computer Use | Manual pass |
| AGUI-045 | Slash | No matches | Shows localized empty state | i18n/source tests | Automated pass |
| AGUI-046 | Slash | ArrowDown/ArrowUp | Active command moves and wraps | Source-level key handling | Static pass |
| AGUI-047 | Slash | Tab accept | Runs selected command and clears/updates input as intended | Source-level key handling | Static pass |
| AGUI-048 | Slash | Enter accept | Runs selected command without sending raw `/command` | Source-level key handling | Static pass |
| AGUI-049 | Slash | Escape close | Closes slash palette first, before stop-run behavior | Found and fixed | Fixed |
| AGUI-050 | Slash | Outside click close | Clicking outside composer closes slash palette | Found and fixed | Fixed |
| AGUI-051 | Slash | `/help` local command | Adds readable help output without provider call | Computer Use | Manual pass |
| AGUI-052 | Slash | `/stop` without active run | Shows `No active run to stop` instead of failing | Source/i18n review | Static pass |
| AGUI-053 | Slash | `/sessions`, `/models`, `/agents` | Opens provider-native OpenCode dialog without invoking native provider runs | Slash dialog regression test | Automated pass |
| AGUI-054 | Slash | `/mcps` | Opens MCP list with search and enabled/disabled states | Source/i18n tests | Automated pass |
| AGUI-055 | Slash | Unsupported provider command | Shows localized unsupported message | Source/i18n tests | Automated pass |

## Run Lifecycle, Streaming, And Stop

| ID | Area | Case | Expected | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| AGUI-056 | Run | Send prompt to active provider | Creates one user message and one running assistant item | Live provider run | Not run |
| AGUI-057 | Run | Preparing context | Shows preparing state without blocking unrelated UI | Prompt/context tests | Automated pass |
| AGUI-058 | Run | Stream text chunks | Displays streaming text with line breaks preserved | Preview/formatter tests | Automated pass |
| AGUI-059 | Run | Stream thinking details | OpenCode thinking appears in separate collapsed/detail block | Formatter/UI tests | Automated pass |
| AGUI-060 | Run | Tool activity updates | Tool parts become compact activity rows with command/log details | Formatter tests | Automated pass |
| AGUI-061 | Run | Stop running task from composer | Send button swaps to one stop button, not two controls | UI regression tests | Automated pass |
| AGUI-062 | Run | Stop all command | Stops all tracked CLI sessions and shows localized message | Source/localization review | Static pass |
| AGUI-063 | Run | Stopped request then new request | Old stopped placeholder does not revive as loading | Regression tests | Automated pass |
| AGUI-064 | Run | Successful completion | Does not add noisy success system message after every run | Regression test | Automated pass |
| AGUI-065 | Run | Provider error | Error is shown in readable form, not raw JSON/event noise | Formatter tests | Automated pass |
| AGUI-066 | Run | OpenCode DB lock error | Shows database-lock explanation | Formatter tests | Automated pass |
| AGUI-067 | Run | Model not found/unsupported format | Shows concise model/provider guidance | Formatter tests | Automated pass |
| AGUI-068 | Run | ANSI/terminal traces | ANSI fragments and tool trace noise are stripped | Formatter tests | Automated pass |
| AGUI-069 | Run | Owned-session filtering | Event stream ignores output from unrelated OpenCode session | Formatter tests | Automated pass |

## Conversation History And Sessions

| ID | Area | Case | Expected | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| AGUI-070 | History | New session button | Creates a clean local thread and clears active transcript | Live UI | Not run |
| AGUI-071 | History | History selector | Existing sessions can be selected without losing active provider | Live UI | Not run |
| AGUI-072 | History | Delete button disabled | Delete is disabled when there is no deletable active session | Computer Use | Manual pass |
| AGUI-073 | History | Delete current session | Shows in-webview confirmation dialog | Dialog tests | Automated pass |
| AGUI-074 | History | Cancel deletion | Dialog closes and session remains | Dialog cancel/Escape/backdrop regression test | Automated pass |
| AGUI-075 | History | Confirm deletion | Removes UI thread and backing OpenCode session when present | Cleanup tests | Automated pass |
| AGUI-076 | History | OpenCode fork command | Creates and switches to forked session | OpenCode command test | Automated pass |
| AGUI-077 | History | Reload webview | Non-transient history remains, transient running state does not | Persistence tests | Automated pass |

## Settings

| ID | Area | Case | Expected | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| AGUI-078 | Settings | Open settings from title button | Settings replaces main/composer cleanly | Computer Use | Manual pass |
| AGUI-079 | Settings | Back from settings | Returns to normal Agents GUI without stale page state | Computer Use | Manual pass |
| AGUI-080 | Settings | Agent section layout | Provider rows, checkboxes, order buttons, and footer do not overlap | Computer Use | Manual pass |
| AGUI-081 | Settings | Agent reorder | Up/down changes order and preserves disabled edge buttons | Settings reorder regression test | Automated pass |
| AGUI-082 | Settings | Show all | Reveals hidden providers or no-ops cleanly when all visible | Settings show-all regression test | Automated pass |
| AGUI-083 | Settings | Save success | Shows `正在保存...` then `设置已保存` | Computer Use | Manual pass |
| AGUI-084 | Settings | Save failure | Shows localized failure with message | Source/i18n coverage | Static pass |
| AGUI-085 | Settings | API provider settings | Add/edit/delete custom providers without leaking secrets | Source/tests | Automated pass |
| AGUI-086 | Settings | API key handling | Explicit keys sync without leaking raw values in UI state | API provider tests | Automated pass |
| AGUI-087 | Settings | Commit provider setting | Choose provider for SCM commit messages | Manifest/settings tests | Automated pass |
| AGUI-088 | Settings | Commit language setting | Auto/ZH/EN language option persists | Commit tests | Automated pass |
| AGUI-089 | Settings | Max diff chars | Numeric value controls staged diff truncation budget | Commit tests | Automated pass |
| AGUI-090 | Settings | Reset commit settings | Restores provider/language/maxDiff defaults | Commit settings reset regression test | Automated pass |
| AGUI-091 | Settings | Settings Sync | Syncable non-secret state uses `globalState.setKeysForSync` | Source tests | Automated pass |
| AGUI-092 | Settings | Secrets | API keys/tokens remain out of Settings Sync/plain global state | Source review | Static pass |

## Source Control Commit Message Workflow

| ID | Area | Case | Expected | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| AGUI-093 | SCM | Source Control action visible | Agents GUI generate commit action appears in Changes toolbar | Computer Use | Manual pass |
| AGUI-094 | SCM | Inline SCM generate button no staged diff | Disabled when no commit input action can run | Computer Use | Manual pass |
| AGUI-095 | SCM | Toolbar action no staged diff | Should not overpromise when staged diff is empty | Source/manifest tests | Fixed |
| AGUI-096 | SCM | Staged-only prompt | Prompt uses staged diff only, not unstaged/untracked files | Commit tests | Automated pass |
| AGUI-097 | SCM | Existing input draft | Existing Source Control input is treated as draft intent | Commit tests | Automated pass |
| AGUI-098 | SCM | Chinese locale | Conventional type stays English; summary/body are Simplified Chinese | Commit tests | Automated pass |
| AGUI-099 | SCM | English locale | Generates English message when configured | Commit tests | Automated pass |
| AGUI-100 | SCM | Binary diff | Handles binary staged diff without inventing details | Existing prompt behavior/source | Static pass |
| AGUI-101 | SCM | Diff truncation | Prompt clearly says staged diff was truncated | Commit tests | Automated pass |
| AGUI-102 | SCM | Markdown fence cleanup | Strips fenced/explanatory provider output | Commit tests | Automated pass |
| AGUI-103 | SCM | Reasoning prose cleanup | Rejects/extracts conventional subject from provider reasoning | Commit tests | Automated pass |
| AGUI-104 | SCM | Emoji style | Existing input can request emoji style | Commit tests | Automated pass |
| AGUI-105 | SCM | Concurrent generation | Shows already-generating message and avoids duplicate runs | Source behavior | Static pass |
| AGUI-106 | SCM | Cancel generation | Stop icon cancels current commit generation | Commit command tests/source | Automated pass |
| AGUI-107 | SCM | Provider timeout | Timeout surfaces as readable failure, not endless loading | Prior bug path + source tests | Automated pass |
| AGUI-108 | SCM | Provider selected from settings | SCM generation reuses selected provider/model where supported | Commit tests | Automated pass |
| AGUI-109 | SCM | Write result | Cleaned commit message is written to repository input box | Commit tests | Automated pass |

## Editor Context And Suggested Actions

| ID | Area | Case | Expected | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| AGUI-110 | Context | No selection | Selection-only actions are disabled with helpful title | Computer Use + tests | Manual pass |
| AGUI-111 | Context | Explain selection | Enabled only with selection; uses read-only permission preference | Action guard tests | Automated pass |
| AGUI-112 | Context | Refactor selection | Enabled only with selection and blocks before spawning CLI otherwise | Guard tests | Automated pass |
| AGUI-113 | Context | Review current file | Requires active file context, not random workspace scan | Prompt/action tests | Automated pass |
| AGUI-114 | Context | Generate tests | Builds focused prompt from current file/context | Prompt tests | Automated pass |
| AGUI-115 | Context | Sidebar has focus | Last active editor is retained for context collection | Context collector tests | Automated pass |
| AGUI-116 | Context | Diagnostics included | Problem count respects configured max diagnostics | Context collector/config tests | Automated pass |
| AGUI-117 | Context | Selection/file truncation | Large selection/file is truncated within configured budget | Prompt/context tests | Automated pass |

## Layout, Theme, And Responsiveness

| ID | Area | Case | Expected | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| AGUI-118 | Layout | Sidebar normal width | Empty state and composer fit with no horizontal overflow | Computer Use | Manual pass |
| AGUI-119 | Layout | Narrow sidebar | Composer controls wrap before clipping send button | CSS tests | Automated pass |
| AGUI-120 | Layout | Wide editor + side bar | Sidebar content remains anchored, not stretched awkwardly | Live UI | Manual pass |
| AGUI-121 | Layout | Settings page | Normal toolbar/main/composer hidden while settings is open | CSS tests | Automated pass |
| AGUI-122 | Layout | Popover near viewport edge | Model/mode/context popovers stay inside viewport | Positioning tests | Automated pass |
| AGUI-123 | Layout | OpenCode compact widths | OpenCode side UI collapses by default at compact widths | CSS tests | Automated pass |
| AGUI-124 | Layout | Long model/provider names | Text truncates instead of pushing controls out | Existing long description test | Automated pass |
| AGUI-125 | Layout | Running spinner | Spinner is centered and does not resize rows | Spinner tests | Automated pass |
| AGUI-126 | Theme | Light theme | Text/buttons have sufficient contrast in current light theme | Computer Use visual review | Manual pass |
| AGUI-127 | Theme | Dark theme | Controls, icons, and provider assets remain readable | Manual theme switch | Not run |
| AGUI-128 | Motion | Reduced motion | Decorative motion is reduced when requested | CSS test | Automated pass |
| AGUI-129 | Accessibility | Keyboard focus | Focus order reaches provider tabs, settings, composer, menus | Manual keyboard pass | Not run |
| AGUI-130 | Accessibility | Screen reader names | Buttons/menus expose meaningful labels | Accessibility tree review | Manual pass |

## Internationalization And Copy

| ID | Area | Case | Expected | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| AGUI-131 | i18n | Simplified Chinese UI | Main labels, settings, slash commands, commit settings are localized | Computer Use + i18n tests | Manual pass |
| AGUI-132 | i18n | English UI | English strings are present and not missing keys | i18n source tests | Automated pass |
| AGUI-133 | i18n | Provider option labels | Model/runtime/permission/agent labels localize per locale | i18n tests | Automated pass |
| AGUI-134 | i18n | Error messages | Provider/commit/selection errors use readable localized copy | Formatter/i18n tests | Automated pass |
| AGUI-135 | Copy | Settings save success | Success text says `设置已保存`, not vague `已保存` | Computer Use | Manual pass |
| AGUI-136 | Copy | Commit prompt format | Prompt requires Conventional Commit and Chinese body format | Commit tests | Automated pass |

## Performance And Stability

| ID | Area | Case | Expected | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| AGUI-137 | Performance | Webview idle | Empty state does not spin or poll visibly forever | Computer Use | Manual pass |
| AGUI-138 | Performance | Provider detection retry | OpenCode MCP sidebar retries only while warming up | Tests | Automated pass |
| AGUI-139 | Performance | Long transcript | Transcript remains readable and scrollable with code blocks | UI tests/source | Automated pass |
| AGUI-140 | Stability | Reload window | Reload command exists for debugging and webview recovers | Computer Use | Manual pass |
| AGUI-141 | Stability | Provider output chunk splits | Incomplete JSON/ANSI chunks do not corrupt transcript | Formatter tests | Automated pass |
| AGUI-142 | Stability | CLI path stale cache | Stale command path is evicted and revalidated | CLI tests | Automated pass |
| AGUI-143 | Stability | Background server cleanup | Extension stops CLI/background processes on deactivate | Source tests | Automated pass |
| AGUI-144 | Stability | Dirty git worktree | Commit generator uses staged diff only and ignores unrelated local changes | Commit tests | Automated pass |

## Publish Readiness

| ID | Area | Case | Expected | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| AGUI-145 | Publish | `npm run build` | Builds extension bundle successfully | Command run | Static pass |
| AGUI-146 | Publish | `npm run build:test` | TypeScript emits test dist successfully | Command run | Static pass |
| AGUI-147 | Publish | `npm test` | Full regression suite passes | Command run | Static pass |
| AGUI-148 | Publish | `git diff --check` | No whitespace errors | Command run | Static pass |
| AGUI-149 | Publish | Repackage VSIX after fixes | Current artifact includes latest `media/main.js` | `npm run package` output | Static pass |
| AGUI-150 | Publish | Marketplace upload | Upload current VSIX with valid publisher/PAT | Requires Marketplace credentials | Not run |
