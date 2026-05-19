# Agents Hub

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-blue)](https://marketplace.visualstudio.com/items?itemName=agents-hub.agents-hub)
[![CI](https://github.com/trry-hub/agents-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/trry-hub/agents-hub/actions/workflows/ci.yml)

**Agents Hub** is a VS Code extension that turns your editor into a multi-agent workbench. It brings together multiple AI coding assistants — Claude Code, Codex CLI, Gemini CLI, OpenCode, Goose, and Aider — under a single sidebar interface with context-aware prompts, CLI profile management, and API provider bridging.

> ⚠️ **Early Release (v0.1.0).** The core extension logic and webview UI are complete. Expect rapid iteration as we validate the workbench model.

---

## Features

- **Multi-Agent Sidebar** — Switch between installed CLI agents without leaving your editor. Each agent gets its own composer with provider-native controls (model, mode, runtime, permissions).
- **Context-Aware Prompts** — Automatically attach workspace metadata, active file contents, editor selection, and diagnostics. Fine-tune how much context is included per request.
- **CLI Profile System** — Pre-configured profiles for Claude Code, Codex CLI, Gemini CLI, OpenCode, Goose, and Aider. Each profile handles command resolution, argument building, input modes, and background server lifecycle.
- **Background Server Support** — Agents that support persistent sessions (e.g. OpenCode) can keep a background server running for low-latency follow-up prompts.
- **Action Commands** — Right-click in the editor to explain selection, review the current file, generate tests, or refactor code — all routed through your active provider.
- **Custom API Providers** — Define your own API endpoints and map them to CLI agents. API keys are referenced via environment variables, never stored in settings.
- **Localization** — Built-in English and Simplified Chinese localizations for both the extension UI and the webview.
- **Provider Extension Bridges** — Open companion VS Code extensions (OpenCode, Codex, Claude Code, Gemini CLI) directly from the sidebar.
- **Token Counting** — Exact token counting for Anthropic models and tiktoken-based counting for OpenAI models, with per-provider fallback.

---

## Requirements

- **VS Code** 1.85+
- **Node.js** 18+ (for CLI agents)
- At least one supported CLI agent installed:
  - [OpenCode](https://github.com/sst/opencode)
  - [Codex CLI](https://github.com/openai/codex)
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli)
  - [Goose](https://github.com/block/goose)
  - [Aider](https://github.com/paul-gauthier/aider)

---

## Getting Started

1. **Install the extension** from the VS Code Marketplace.
2. **Install at least one CLI agent** (see Requirements above).
3. **Open the Agents Hub sidebar** — click the AI icon in the activity bar, or run `Agents Hub: Open Panel`.
4. **Select a provider** from the dropdown in the sidebar header, then start typing your request.

> The extension defaults to **OpenCode** if no provider is selected. You can change this in `agentsHub.defaultProvider`.

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `agentsHub.defaultProvider` | `"opencode"` | Default AI provider for editor commands |
| `agentsHub.context.includeWorkspace` | `true` | Attach workspace metadata |
| `agentsHub.context.includeCurrentFile` | `true` | Attach the active editor file |
| `agentsHub.context.includeSelection` | `true` | Attach the current editor selection |
| `agentsHub.context.includeDiagnostics` | `true` | Attach diagnostics for the active file |
| `agentsHub.context.maxFileChars` | `12000` | Max characters for file context |
| `agentsHub.context.maxSelectionChars` | `8000` | Max characters for selection context |
| `agentsHub.context.maxDiagnostics` | `12` | Max diagnostics to include |
| `agentsHub.apiProviders.customProviders` | `[]` | Custom API provider definitions |
| `agentsHub.apiProviders.defaultProviderId` | `""` | Global default custom API provider |
| `agentsHub.apiProviders.agentProviderByCliId` | `{}` | Per-agent custom API provider overrides |
| `agentsHub.home.visibleAgentIds` | `[]` | Visible agents on the home header |
| `agentsHub.home.agentOrder` | `[]` | Display order of agents in the header |

---

## Development

```bash
# Install dependencies
npm install

# Build the extension
npm run build

# Watch mode
npm run watch

# Run tests
npm test

# Package for VS Code Marketplace
npm run package
```

### Project Structure

```
src/
├── extension.ts          # Extension activation & command registration
├── sidebarProvider.ts    # Webview provider & message handling
├── cliManager.ts         # CLI process lifecycle management
├── cliProfiles.ts        # Pre-configured agent profiles
├── cliPathResolver.ts    # CLI binary discovery & shell integration
├── apiProviders.ts       # Custom API provider runtime
├── contextCollector.ts   # IDE context gathering
├── promptBuilder.ts      # Context-aware prompt construction
├── outputFormatter.ts    # CLI output normalization
├── tokenCounter.ts       # Token counting (Anthropic + OpenAI)
├── localization.ts       # Runtime locale resolution
├── opencodeAgents.ts     # OpenCode agent discovery
├── actionGuards.ts       # Action preconditions
├── providerExtensions.ts # VS Code extension bridges
└── assistantTypes.ts     # Shared type definitions
media/
├── main.html             # Webview layout
├── main.js               # Webview logic
├── main.css              # Webview styles
├── i18n.js               # Webview localization
└── icon.svg              # Extension icon
```

---

## Supported CLI Agents Overview

| Agent | Profile ID | Input Mode | Background Server | Token Counter |
|-------|-----------|------------|-------------------|---------------|
| OpenCode | `opencode` | argument | ✅ (port range 46100+) | Anthropic tokens |
| Codex CLI | `codex` | argument | ❌ | tiktoken (cl100k) |
| Claude Code | `claude` | argument | ❌ | Anthropic tokens |
| Gemini CLI | `gemini` | argument | ❌ | — |
| Goose | `goose` | stdin | ❌ | — |
| Aider | `aider` | argument | ❌ | tiktoken (cl100k) |

---

## License

MIT
