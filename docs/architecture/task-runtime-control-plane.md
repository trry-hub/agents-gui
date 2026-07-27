# Task Runtime Control Plane

## Status

Approved for incremental implementation on 2026-07-27.

This document defines the long-term runtime boundary for Agents GUI. The first
implementation slice covers Git commit-message generation. Existing interactive
agent sessions continue to use `AgentRuntime` while the new boundary is adopted
incrementally.

## Problem

Agents GUI currently routes both lightweight text generation and stateful coding
work through provider CLI sessions. A commit-message request therefore inherits
global MCP startup, plugins, project agents, tool permissions, session state, and
the first VS Code workspace folder.

That coupling causes several failure modes:

- unrelated MCP startup can consume most of a task's timeout;
- task-specific repository roots are lost in multi-root workspaces;
- commands depend on `CliManager` and provider argument details;
- a single timeout hides whether launch, first output, streaming, or cleanup is
  slow;
- provider fallback is based on installation order rather than an explicit task
  policy.

## Architecture Decision

Agents GUI remains a modular monolith in the VS Code extension host. The runtime
is divided into a control plane and protocol adapters, with two execution lanes:

```text
VS Code commands and webviews
             |
       application use cases
             |
   task policy + run supervision
             |
      +------+----------------+
      |                       |
fast text generation      agent execution
      |                       |
generation adapters      ACP/native/CLI adapters
```

The internal boundary is task intent plus capability policy. It is not a CLI
command line.

### Fast text-generation lane

Use for commit messages, titles, summaries, and explanations that only return
text.

- ephemeral execution;
- exact repository working directory;
- tools, MCP servers, project configuration, and external plugins disabled by
  default;
- structured task request and output contract;
- separate launch, first-output, idle, and total time budgets;
- no background server attachment or session reuse.

### Agent-execution lane

Use for coding, editing, review, verification, and multi-turn work.

- tools and permissions are explicit capabilities;
- sessions can be resumed and cancelled;
- ACP is the preferred common transport when it preserves required features;
- provider-native protocols remain available for richer capabilities;
- stdout-parsed CLI execution is a compatibility adapter.

ACP is an external protocol, not the internal domain model. The internal event
model must remain a superset so provider-specific approval, usage, reasoning,
and diff events are not discarded.

### Capability registry

Interactive requests are described by task intent and permission posture before
the runtime chooses a provider transport. The policy resolver produces three
sets:

- `required`: every capability the selected transport must implement;
- `allowed`: the maximum capability budget for this request;
- `denied`: capabilities the task or permission posture explicitly forbids.

The initial vocabulary is `workspace.read`, `workspace.write`,
`terminal.execute`, `sandbox.bypass`, and `session.resume`. Planning and
explanation remain read-only even under broader provider permissions. Explicit
read-only modes constrain every task, while dangerous modes require a provider
that declares sandbox bypass support.

The capability registry evaluates transport descriptors rather than CLI
arguments. Its preference order is ACP, then provider-native, then CLI, but a
transport is eligible only when it implements every required capability. This
lets a richer native adapter win when ACP would discard a required feature.

The current production registry declares only the existing CLI compatibility
adapters. It therefore changes no provider process or session behavior yet. The
next slice will replace raw `AgentRuntime.startPrompt` arguments with a
structured `AgentExecutionPort` request, then register ACP and provider-native
adapters as they reach feature parity.

## Core Contracts

`TextGenerationRequest` carries:

- task kind;
- provider identity;
- exact `cwd`;
- prompt;
- capability policy;
- phase time budgets;
- non-secret selection metadata.

`TextGenerationPort` owns provider execution and emits normalized lifecycle
events. It does not expose CLI arguments to commands or use cases.

`GenerateCommitMessageUseCase` owns:

- the fixed commit-message capability policy;
- fallback attempts;
- partial and final Conventional Commit validation;
- provider-independent cancellation behavior.

Provider adapters own:

- command and transport selection;
- provider runtime arguments and environment;
- task-policy translation;
- CLI output normalization;
- process cleanup.

## Commit-Message Policy

Every commit-message run must:

- use the selected Git repository's root as `cwd`;
- receive staged diff text as prompt data;
- deny all tools and MCP servers;
- ignore project OpenCode configuration and external plugins;
- avoid background server attachment and session reuse;
- expose launch, first-output, streaming, cleanup, and failure phases;
- retain the existing total timeout while enforcing a shorter first-output
  budget;
- fall back only after a typed attempt failure, never after cancellation.

For OpenCode, the adapter creates an in-memory `OPENCODE_CONFIG_CONTENT` overlay
that disables every MCP entry found in the effective global and existing inline
configuration. It also sets `permission: { "*": "deny" }`, clears plugins, and
disables project configuration discovery. User configuration files are never
modified.

## Dependency Rules

- application use cases must not import `vscode`, `child_process`, or concrete
  provider clients;
- commands may import VS Code presentation APIs and application use cases, but
  not `CliManager`;
- provider adapters may depend on `CliManager`, CLI profiles, and output
  normalization;
- `CliManager` must accept an explicit task `cwd`; it may use the first workspace
  folder only as a backward-compatible default;
- pure policy modules must be runnable in Node unit tests without VS Code.

## Observability

Generation adapters emit phase events with elapsed milliseconds:

- `launch`;
- `wait-first-output`;
- `stream`;
- `cleanup`;
- `completed`;
- `failed`.

The first slice exposes these events through the port. Persisted telemetry and UI
diagnostics can be added later without changing use cases.

## Migration

1. Introduce the text-generation contracts and commit use case.
2. Add a CLI text-generation adapter and OpenCode task isolation policy.
3. Route the commit command through the new port and exact repository `cwd`.
4. Move other lightweight generation tasks onto the same lane.
5. Introduce a capability registry and policy resolver for interactive agents.
6. Add ACP and provider-native adapters behind `AgentExecutionPort`.
7. Consider a separate local gateway only when multi-IDE, remote, or durable
   background execution becomes a product requirement.

## Verification

- pure policy and use-case unit tests with in-memory adapters;
- adapter contract tests with fake sessions and event sources;
- existing commit-message behavior tests;
- TypeScript type checking, linting, formatting, and full regression tests;
- manual timing probe against the installed OpenCode CLI after automated tests.
