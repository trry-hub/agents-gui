# Agents GUI target architecture

Agents GUI should use a ports-and-adapters architecture so the UI only speaks one
agent protocol while each local CLI keeps its provider-specific behavior at the
edge.

## Dependency direction

```text
VS Code commands
  -> SidebarProvider
    -> AgentRuntime port + provider capabilities
      -> provider adapters / CliAgentRuntime / OpenCodeAgentCapability
        -> CLI process, OpenCode server, SSE, native provider APIs

Webview UI
  -> WebviewProtocol messages
    -> SidebarProvider use cases
      -> AgentRuntime port
```

Inner layers must not know about Webview DOM, VS Code commands, shell details,
OpenCode endpoints, or provider-specific stream formats.

## Bounded contexts

- Extension shell: activation, commands, status bar, lifecycle.
- Agent runtime: provider discovery, session lifecycle, streaming, stop/input,
  native commands.
- Context assembly: workspace/current file/selection/diagnostics and token
  estimates.
- Prompt building: provider/action instructions and conversation context.
- Webview protocol: typed message contract between browser code and extension
  host.
- Webview presentation: rendering, local state, composer interactions, settings
  pages.

## Migration rule

New provider features should enter through `AgentRuntime` first. The Webview
should consume normalized events and status objects instead of calling
provider-specific code paths directly. Existing OpenCode/Claude/Codex behavior
can migrate incrementally behind this port without a full rewrite.

## Current implementation step

- `src/agentRuntime.ts` introduces the runtime port and a `CliAgentRuntime`
  adapter around the existing `CliManager`.
- `src/openCodeAgentCapability.ts` keeps OpenCode-specific server status,
  native commands, and session cleanup behind `OpenCodeAgentCapability` so the
  generic `AgentRuntime` module is not shaped by one provider's API.
- `src/webviewProtocol.ts` introduces the typed host/webview message contract.
- `src/sidebarProvider.ts` now depends on `AgentRuntime`, not directly on
  `CliManager`.
- `src/openCodeServerClient.ts` owns OpenCode HTTP, SSE, status, model discovery,
  and native session commands. `CliOpenCodeAgentCapability` exposes those
  provider-specific features to host use cases without adding OpenCode methods
  to the generic runtime port.
- `src/cliDiscovery.ts` owns CLI command resolution, installed/version status,
  and provider-native OpenCode agent/model discovery.
- `src/cliProcessRunner.ts` owns CLI process spawning, platform-specific process
  tree termination, and background process shutdown.
- `src/apiProviderClient.ts` owns custom API provider model-list HTTP calls,
  including OpenAI-compatible and Anthropic-compatible headers.
- `src/sidebarProvider.ts` sends host-to-Webview events through `postToWebview`,
  which accepts the typed `HostToWebviewMessage` protocol.
- `media/messageText.js` owns shared message text normalization and inline
  Markdown stripping for browser modules.
- `media/messageChoices.js` owns assistant choice parsing independently from DOM
  rendering so interactive reply affordances can be tested with concrete
  input/output cases.
- `media/providerRunState.js` owns provider pending/running state transitions
  for send/start/stop/end/error paths so these run lifecycle changes are tested
  outside DOM rendering.
- `media/conversationStore.js` owns conversation-thread restore, creation,
  activation, lookup, and persistence serialization so saved Webview state can
  be tested without DOM rendering.
- `media/slashCommands.js` owns slash command definitions, parsing, provider
  filtering, native command discovery, and prompt composition independently
  from palette rendering.
- `media/openCodeDialogState.js` owns OpenCode dialog command aliases, command
  echo cleanup decisions, keyboard option filtering, and active-index movement
  plus model title/grouping rules independently from dialog DOM rendering.
- `media/claudeActions.js` owns Claude action drawer definitions, label
  derivation, trailing metadata, active toggle state, and query matching
  independently from drawer DOM rendering.
- `media/inlineMarkdown.js` owns lightweight inline Markdown rendering and link
  scheme allowlisting so transcript links cannot bypass the Webview boundary.

## Architecture guardrails

- `media/main.js` coordinates DOM rendering, user events, and host messages. New
  pure state transitions, command parsing, provider option grouping, and text
  normalization should live in focused `media/*.js` modules with plain unit
  tests.
- Browser modules must be loaded before `media/main.js` in `media/main.html` and
  included in the development file watcher in `src/sidebarProvider.ts`.
- Provider-specific behavior belongs behind capability adapters such as
  `OpenCodeAgentCapability`; adding one provider's special operation to the
  generic `AgentRuntime` port should be treated as an architecture regression.
- `npm run smoke:extension` launches a real VS Code Extension Development Host
  and then uses a deterministic in-memory runtime to exercise the command
  entrypoints plus send, session input, stop, OpenCode native command, and
  normalized OpenCode output paths without calling a real model.
- `npm run verify:release` is the release gate. It runs unit and architecture
  tests, Extension Host smoke, dependency audit, VSIX packaging, and whitespace
  checks in one command.
- `npm run preview:webview` is only a fast layout preview. It must load every
  browser module that `media/main.html` loads, but it is not a substitute for the
  Extension Host smoke.

## Next cuts

1. Extract only cohesive DOM-heavy surfaces from `media/main.js` when they need
   independent tests or reuse. Avoid splitting rendering code just to create more
   files.
2. Add visual Webview smoke coverage for rendered composer and transcript states
   in the Extension Development Host when a stable screenshot runner is added.
