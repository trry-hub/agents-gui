# Agents Workbench Product Document

## Positioning

Agents GUI is a multi-agent workbench for VS Code, with a multi-task control surface. In the current product cut, "multi-agent" means users can switch between several official or CLI-backed single agents reliably. Parallel comparison and multi-agent fan-out are intentionally paused until the single-agent flows are mature.

The product should not compete with Copilot on inline completion. Copilot owns the "AI autocomplete and single assistant" lane. Agents GUI should own the "agent control plane" lane: many tasks, many capable agents, one visual task surface for context, execution, review, and verification.

## Product Thesis

Developers will use more than one coding agent. Each agent has different strengths, models, permissions, runtimes, and failure modes. The first winning workflow is not parallel fan-out; it is a clean control surface where the user picks one agent, sees exactly what will run, and gets a reliable result. Hand-offs and comparisons should return only after that base is solid.

## Target Users

- Engineers who already use two or more coding agents.
- Teams evaluating agent quality across providers.
- Power users who want official agent experiences without losing unified task history.
- Developers who need stronger supervision than a single autonomous assistant provides.

## Competitive Edge

Agents GUI should differentiate from Copilot through orchestration, not replacement.

- **Agent choice without lock-in:** Support official and CLI-backed agents in one interface.
- **Provider choice without clutter:** Let the user switch between several single agents without extra participant controls.
- **Single-task clarity:** One send action starts one provider run, with clear model, mode, context, and status.
- **Visual task control:** Show every run as a task card with status, agent, mode, context, and outcome.
- **Multi-agent workflows:** Let one agent plan, another implement, and another review.
- **Shared context contract:** Attach workspace, file, selection, diagnostics, and images consistently across agents.
- **Execution visibility:** Show who is running, what mode is active, what context is attached, and how the run ended.
- **Verification loop:** Turn tests, build output, diagnostics, and errors into follow-up tasks.
- **Self-check and self-repair:** Treat every run as incomplete until the agent checks its own output, verifies the result, repairs common failures, and reports remaining risk.

## Core Workflows

### 1. Ask One Agent Clearly

The user selects a provider, selects that provider's model and agent mode, then sends one task. The UI should make it obvious which single agent will run before the task starts.

### 2. Keep Future Comparison Explicitly Out Of MVP

Plan comparison is a later workflow. It should not appear as a hidden slash command, participant picker, or automatic fan-out until there is a proper comparison view and result-selection flow.

### 3. Run A Visual Task Board

Every agent run becomes a visible task card. The board shows preparing, running, completed, failed, and stopped states so the user can supervise multiple tasks at once without losing the active conversation.

### 4. Delegate, Review, Verify

The user assigns implementation to one agent. When it finishes, Agents GUI can route the diff to another agent for review, then run configured verification commands. Failures become structured follow-up tasks.

### 5. Self-Check And Repair

After an agent run, Agents GUI checks whether the result is empty, failed, noisy, unverified, or risky. If the task changed files, the workbench inspects the diff and runs configured build, test, or lint commands. When a check fails, it can create a repair task with the error log, changed files, and original request attached.

The loop must have boundaries. Agents GUI should stop after a configured number of repair attempts, explain what remains broken, and ask the user to take over when permissions, missing context, or repeated failures make automatic repair unsafe.

### 6. Keep Official Paths Available

When a provider has an official VS Code extension or panel, Agents GUI can open that official experience. The unified workbench remains the control plane and history layer.

## MVP Scope

The MVP should prove that Agents GUI is more than a launcher.

- Single active-provider send flow.
- Visual task board for the current provider run.
- Provider-specific model, runtime, and permission controls.
- Unified local task history per provider.
- Context summary and token/window visibility.
- Readable output normalization for noisy CLIs.
- Official extension bridge where public commands exist.
- Minimal self-check before completion: exit status, empty output, normalized error, and whether verification was run.

## Roadmap

### Phase 1: Workbench Foundation

- Single active-provider composer with provider-native mode and model controls.
- Visual task board with clear state for the current run.
- OpenCode output cleanup and model error handling.
- Codex official panel bridge.
- Agent recommendation marker.

### Phase 2: Task-aware routing and Capability Matrix

- Add structured provider capability metadata.
- Rank agents by task intent, context availability, and install status.
- Explain recommendations in tooltips and logs.
- Let slash commands set routing intent.

### Phase 3: Multi-Agent Comparison

- Run a planning prompt across selected agents.
- Display plan outputs in one task view.
- Let the user promote one output into execution.

### Phase 4: Review And Verification Loop

- Detect changed files after a run.
- Route diffs to a review agent.
- Run configured build/test commands.
- Convert failures into follow-up prompts.
- Add a bounded repair loop: one failed check, one repair attempt, one re-check, then report remaining risk.

### Phase 5: Self-Healing Workflows

- Add reusable workflows such as "implement, test, repair once, review".
- Track whether each task ended as verified, unverified, failed, or needing human intervention.
- Learn which providers repair build, type, lint, and test failures most reliably.

### Phase 6: Extensibility

- Let users define custom agents.
- Support internal provider adapters.
- Save reusable workflows such as "plan with Claude, implement with Codex, review with OpenCode".

## Product Principles

- Prefer official provider capabilities when public APIs exist.
- Do not hide agent differences. Surface modes, permissions, model, and runtime.
- Keep manual override easy. Recommendations should guide, not trap.
- Treat every agent run as a task with state, context, output, and verification.
- Require self-check before declaring a task complete.
- Keep self-repair bounded by retry limits, permissions, and clear handoff rules.
- Add orchestration only when it improves developer control.

## Success Metrics

- Time from task idea to first useful agent output.
- Percentage of tasks using recommended agents.
- Number of tasks completed with more than one agent.
- Number of concurrent visual tasks supervised without switching tools.
- Reduction in repeated manual setup across providers.
- Build/test pass rate after agent-generated changes.
- Percentage of tasks ending in a verified state.
- Self-repair success rate and average repair attempts per task.
- Number of tasks requiring human intervention after failed repair.

## Immediate Development Priorities

1. Stabilize single-agent send for OpenCode, Codex, and Claude Code.
2. Move capability metadata into profile definitions.
3. Keep "compare plans" and participant selection out of the MVP until a proper comparison view exists.
4. Add visual task board state for the current run.
5. Add a post-run review handoff.
6. Add verification command capture and rerun prompts.
7. Add a first self-check checklist for empty output, non-zero exits, unsupported models, and missing context.
8. Add a bounded self-repair loop for one verification failure.
