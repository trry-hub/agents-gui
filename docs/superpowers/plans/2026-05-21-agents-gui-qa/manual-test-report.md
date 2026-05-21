# Agents GUI Manual QA Report - 2026-05-21

## Scope

Runtime surface: existing VS Code Extension Development Host window, `[扩展开发宿主] 欢迎 — pc`.

Primary method: Computer Use against the real VS Code UI, plus focused source-level and Node test verification for cases that are hard to exercise safely without starting long provider tasks.

Expanded matrix: `comprehensive-test-matrix.md`.

## Expanded Coverage Summary

The broader release-style matrix now contains 150 cases:

- 95 automated pass
- 19 static pass
- 24 manual pass
- 3 fixed during this QA pass
- 0 needs review
- 9 not run

The not-run cases are intentionally called out instead of being marked as passed because they require a clean VS Code install profile, live provider execution, theme switching, file picker interaction, or Marketplace credentials. Seven previously unexecuted low-risk cases were moved into automated/static coverage after the optimization pass.

## Test Matrix

| ID | Area | User scenario | Expected result | Verification | Result |
| --- | --- | --- | --- | --- | --- |
| QA-01 | Empty state | Open Agents GUI in the side bar | Provider tabs, history selector, starter actions, and composer are readable without visual overlap | Computer Use state and screenshot review | Pass |
| QA-02 | Composer baseline | Composer has no input | Send button is disabled and provider/model/context controls remain visible | Computer Use accessibility tree | Pass |
| QA-03 | Slash palette layout | Type `/` in the composer | Command list belongs to the composer, not a detached overlay; input remains visible | Computer Use state and screenshot review | Pass after latest CSS change |
| QA-04 | Slash palette content | Open slash command list for OpenCode | Commands show one label each, descriptions are readable, footer hints are present | Computer Use state and automated assertions | Pass |
| QA-05 | Slash palette Escape | Press `Esc` while slash commands are visible | Slash palette closes first; running tasks are not stopped by accident | Manual test exposed unstable behavior; fixed with global Escape handler | Fixed |
| QA-06 | Slash palette outside click | Click outside the composer while slash commands are visible | Slash palette closes | Source-level gap found; fixed with global click handler | Fixed |
| QA-07 | Settings entry | Open Agents GUI settings from the title action | Settings page replaces normal main/composer content cleanly | Computer Use state and screenshot review | Pass |
| QA-08 | Settings save feedback | Click Save in settings | Shows `正在保存...`, then `设置已保存` long enough to notice | Computer Use state before/after save | Pass |
| QA-09 | Settings layout | Agent settings with installed providers | Provider rows, move buttons, checkboxes, and footer actions do not overlap | Computer Use screenshot review | Pass |
| QA-10 | SCM entry visibility | Open VS Code Source Control | Agents GUI commit-message action is visible in the Changes toolbar | Computer Use state | Pass |
| QA-11 | SCM disabled affordance | No staged change in current host | Inline SCM generate button is disabled | Computer Use state | Pass |
| QA-12 | SCM top action affordance | No staged change in current host | Toolbar action should not look like it will generate when no staged diff exists | Computer Use observation plus source/manifest fix | Fixed |
| QA-13 | Stop/send slot | Composer uses one primary send/stop slot | Stop does not create a second competing action button | Automated UI assertion | Pass |
| QA-14 | Stopped request state | Stop one request and start another | Stopped assistant placeholder is not revived as loading later | Automated regression assertion | Pass |
| QA-15 | Provider status text | Running/thinking status | Transient running text stays out of the composer controls | Automated regression assertion | Pass |
| QA-16 | Packaging readiness | Package current extension | VSIX contains updated webview assets and build output | `npm run package` | Pass |
| QA-17 | Reload recovery | Reload the existing Extension Development Host window | Webview returns from provider detection to normal composer state | Computer Use | Pass |
| QA-18 | Composer typing | Type normal prompt text | Send button becomes enabled without moving composer controls | Computer Use | Pass |
| QA-19 | Slash filtering | Type `/mo` | Palette narrows to the matching `/models` command | Computer Use | Pass |
| QA-20 | Slash Escape recheck | Press `Esc` after filtering slash commands | Palette closes while preserving the typed input | Computer Use | Pass |
| QA-21 | Slash outside-click recheck | Click the empty-state area while slash commands are visible | Palette closes and composer remains stable | Computer Use | Pass |
| QA-22 | Model menu | Open the OpenCode model selector | Native menu lists the selected model plus alternate/custom choices | Computer Use | Pass |
| QA-23 | Agent menu | Open the OpenCode agent selector | Menu shows the current configured agent without duplicate loading states | Computer Use | Pass |
| QA-24 | Settings back navigation | Open settings, then click back | Returns to normal Agents GUI without stale settings state | Computer Use | Pass |
| QA-25 | Local slash help | Run `/help` | Opens readable local help dialog and does not call provider | Computer Use | Pass |
| QA-26 | Long prompt guard | Enter a very long prompt | Textarea uses the configured CSS max height and scrolls internally instead of covering controls | Automated regression | Pass |
| QA-27 | Settings show all | Click Show all in Agent settings | Hidden agents are revealed, ordering resets locally, and the user sees a save-required note | Automated regression | Pass |
| QA-28 | Commit settings reset | Click reset in commit settings | Provider/language/maxDiff return to `default`/`auto`/`60000` and save is requested | Automated regression | Pass |
| QA-29 | Local OpenCode option menus | Run `/sessions`, `/models`, `/agents` | Opens modal option dialogs with keyboard/ARIA guards and does not start a provider run | Automated regression | Pass |

## Findings

### AGQA-01 - Slash menu Escape handling was too narrow

Severity: P1

The slash palette was only closed by the input element's `keydown` handler. In the real Extension Development Host, focus can drift around the webview and Computer Use reproduced that `Esc` did not reliably close the visible slash palette. This matched the user-reported behavior.

Fix: `window` Escape handling now closes the slash palette before trying to stop an active provider run.

Files:

- `media/main.js`
- `tests/promptBuilder.test.mjs`

### AGQA-02 - Slash menu outside-click cleanup was missing

Severity: P2

Clicking outside the composer should dismiss the slash command list just like model/runtime menus. The existing global click handler only closed `details`-based composer menus.

Fix: the document click handler now hides the slash palette when the target is outside both the palette and composer input.

Files:

- `media/main.js`
- `tests/promptBuilder.test.mjs`

### AGQA-03 - SCM toolbar action overpromised when no staged diff existed

Severity: P3

In Source Control with no staged changes, the inline commit input generate button is disabled, but the Changes toolbar action still appears active. It may be acceptable if it opens a clear warning, but the affordance is less clear than the inline disabled state.

Fix: the extension now keeps an `agents-gui.hasStagedChanges` context in sync with Git `indexChanges`, and the SCM title action is hidden unless staged changes exist. The command still keeps its no-staged fallback message for direct command-palette invocation.

### Optimization follow-up - Manual-only candidates converted to regressions

Severity: Quality hardening

The report had several `Not run` items that did not actually need a live provider or destructive state mutation. This pass moved provider refresh, long prompt layout, local OpenCode option dialogs, cancel deletion, Agent reorder/show-all, and commit settings reset into automated/static checks.

Fix: added focused source/CSS tests and small UI guards for long prompt scroll behavior, settings feedback, and OpenCode dialog accessibility.

## Limitations

After opening native VS Code popup menus, Computer Use occasionally returned an empty accessibility tree until the window was refocused. I did not mark provider send, file picker, clean install, dark theme, full keyboard巡航, or Marketplace upload as passed; they remain listed as not run in the expanded matrix.

## Verification Commands

```bash
node --check media/main.js
node --test --test-name-pattern "long prompts|settings reset|commit-message settings reset|provider-aware slash|deleting conversation|refresh providers" tests/promptBuilder.test.mjs tests/extensionActivation.test.mjs
npm run build
npm run build:test
npm test
npm run package
git diff --check
```
