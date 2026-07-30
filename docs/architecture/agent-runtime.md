# Agents GUI runtime architecture

Agents GUI uses a ports-and-adapters architecture as a thin native-CLI
passthrough. The extension presents a common VS Code UI, but every request runs
through the user’s system-installed selected CLI. Each CLI remains the authority
for authentication, API and Provider selection, model, permissions, runtime
mode, MCP, plugins, and session policy.

## Dependency direction

```text
VS Code command / Webview
  -> SidebarProvider / AgentRuntime
    -> CLI discovery resolves system executable
      -> CLI process runner
        -> selected local CLI one-shot prompt transport
```

The extension resolves the executable, adds only the resolved command directory
to the inherited `PATH` for launch, sets the request `cwd`, passes the CLI’s
native one-shot prompt transport arguments, and streams, parses, or stops the
process. It does not select a different executable after launch failure.

## Runtime boundary

- `src/cliDiscovery.ts` owns CLI command resolution, installed/version status,
  and observational probes for the user’s system installation.
- `src/cliProcessRunner.ts` owns CLI process spawning and stopping without a
  shell; the inherited environment is preserved apart from the resolved command
  directory added to `PATH`.
- `src/agentRuntime.ts`, `src/agentSessionController.ts`, and
  `src/sidebarProvider.ts` coordinate request lifecycle and normalized UI
  events; they do not provide an alternate Provider or execution policy.
- `src/attachmentStore.ts` and `src/webviewHtmlRenderer.ts` keep attachment
  persistence and Webview rendering outside the native CLI launch boundary.
- Native prompt arguments carry the one-shot prompt transport. Displayed model
  and context metadata is observational and never changes executable selection,
  environment, or CLI configuration. When IDE context is included, it is prompt
  content carried through the same native one-shot argument, not a model,
  Provider, runtime, or permission override.

## Non-goals and guardrails

- No custom API Provider injection or GUI-side model, runtime, or permission
  override is applied.
- No automatic SCM or task fallback exists: the selected CLI is the only CLI
  called for that request.
- No managed OpenCode server is started, attached, or reused, and no task-policy
  or fast-lane configuration overlay is injected.
- The extension does not disable or replace CLI-owned MCP, plugins, project
  configuration, authentication, or session behavior.
- A one-time OpenCode migration backs up the configuration before changing it
  and deletes only legacy Provider entries whose exact
  `__agents_gui_synced === true` marker is present. It never broadly deletes
  user configuration.

## Verification guardrails

- Process and parser tests cover resolved command launching, native one-shot
  transport, streamed output, and cancellation.
- Architecture tests assert the absence of managed OpenCode server, custom
  Provider injection, task overlays, and automatic fallback paths.
- `npm run verify:release` remains the release gate for tests, smoke coverage,
  audit, packaging, and whitespace checks.
