# Task Runtime Control Plane

## Status

Native CLI passthrough is the production execution boundary as of 2026-07-30.
The control plane coordinates VS Code requests; it does not define a separate
provider runtime, task-policy lane, or background execution service.

## Execution contract

For an interactive request or SCM commit-message request, Agents GUI:

1. uses the user-selected CLI only;
2. resolves that CLI from the system installation;
3. sets the request working directory and adds only the resolved command
   directory to the inherited `PATH`;
4. passes the prompt via that CLI’s native one-shot prompt transport arguments;
5. streams and parses output, and can stop the process.

Every user request and follow-up starts a fresh local CLI process; there is no
process or session reuse. The previous conversation is rendered as text in the
next prompt, together with editor actions, IDE context, and attachments. These
are prompt contents, not CLI configuration or execution overrides.

The selected CLI is the sole authority for authentication, API/Provider,
model, permissions, runtime mode, MCP, plugins, project configuration, and
session policy. The extension does not inject a custom API Provider or override
any of those settings. Configured model and context displays in the UI are
observational metadata only; they never change CLI configuration. IDE context
that is included in a request remains prompt content sent through the native
one-shot transport, not an execution override.

## Request routing

```text
VS Code command or Webview
            |
            v
selected local CLI -> native one-shot prompt -> streamed output / stop
```

There is no automatic provider fallback. SCM generation calls the selected CLI
and reports its result or failure; it never tries another installed CLI.

There is no managed OpenCode server, server attachment, session reuse, or
task-policy/fast-lane configuration overlay. In particular, the control plane
does not disable CLI-owned MCP or plugins, impose permission policies, or
replace project configuration with an in-memory OpenCode configuration.

## OpenCode migration boundary

The OpenCode migration changes configuration only when it finds a legacy
Provider marked with the exact boolean `__agents_gui_synced === true`. It backs
up the configuration before changing it, removes only those tagged Providers
and a matching top-level model, and preserves all user-defined or unmarked
configuration. With no tagged Provider, there is no write and no backup. The
migration is not a general configuration cleanup and does not alter the CLI’s
ongoing authentication, Provider, model, MCP, plugin, or session policy.

## Dependency rules

- Commands and Webview code request work through the runtime boundary rather
  than spawning arbitrary shell commands.
- CLI discovery and the process runner own executable resolution, `PATH`,
  `cwd`, native prompt arguments, streaming, parsing, and stopping.
- UI metadata is read-only with respect to the launched process.
- Tests must preserve the selected-CLI-only rule and reject configuration
  injection, managed-server attachment, and fallback behavior.

## Verification

- Node architecture tests cover the selected executable and one-shot transport
  contract.
- Full release verification runs unit tests, extension smoke coverage, audit,
  packaging, and whitespace checks.
