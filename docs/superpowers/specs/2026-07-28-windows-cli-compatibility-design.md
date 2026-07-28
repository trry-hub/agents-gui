# Windows CLI Compatibility Design

## Status

Approved on 2026-07-28.

## Goal

Make Agents GUI reliably install, discover, launch, stop, and configure its supported
agent CLIs on Windows 10 and Windows 11 in VS Code Desktop. The supported shells are
Windows PowerShell 5, PowerShell 7, and Command Prompt. Supported CPU architectures are
x64 and ARM64. WSL and Windows Server are outside this scope.

## Current Problem

Agents GUI already exposes platform-specific installation commands, uses `where` for
Windows discovery, uses `taskkill` for process-tree termination, and reads selected
Windows application-data directories. The runtime still launches every resolved command
with Node's built-in `spawn()` and `shell: false`.

Most npm-installed CLIs are exposed on Windows as `.cmd` shims. Node does not execute
`.cmd` or `.bat` files directly without a shell, so OpenCode, Codex, Claude Code, and
Gemini can be detected as installed but fail when an agent request starts. Enabling a
shell globally is not acceptable because user prompts are passed as arguments and must
not be concatenated into an executable command string.

Windows support is also incomplete in the CLI search path, OpenCode configuration
directory selection, system-proxy handling, and CI coverage.

## Supported Providers

The design applies to every current CLI profile:

- Claude Code
- Gemini CLI
- Codex CLI
- OpenCode
- Goose
- Aider

Native `.exe` providers and npm/Python shims must use the same public runtime interface.

## Considered Approaches

### 1. Use `cross-spawn`

Use `cross-spawn` as the single process-launch implementation. It handles Windows
PATHEXT lookup, npm `.cmd` shims, shebangs, and paths containing spaces while retaining
the existing argument-array API.

This is the selected approach because it minimizes custom quoting logic and keeps user
prompts out of shell command strings.

### 2. Invoke `cmd.exe` Directly

Detect `.cmd` and `.bat` files and run them through `ComSpec /d /s /c`. This avoids a
dependency but requires complete escaping for quotes, percent expansion, delayed
expansion, carets, pipes, and command separators. It creates unnecessary command
injection risk and is rejected.

### 3. Parse Package-Manager Shims

Parse npm, pnpm, bun, Python, and other shims to find their underlying JavaScript or
native executable. This could avoid a command shell but depends on several unstable shim
formats and is rejected as too fragile.

## Architecture

The external request path remains unchanged:

```text
SidebarProvider
  -> CliAgentRuntime
  -> CliManager
  -> CliProcessRunner
  -> cross-spawn
  -> native executable or Windows shim
```

No agent protocol, renderer, provider-selection, model-selection, or OpenCode service
contract changes are required.

### Process Execution

`CliProcessRunner` becomes the only module that imports and invokes `cross-spawn`.
Callers continue to provide:

- an executable path or logical command;
- an array of arguments;
- a working directory;
- an environment record;
- the required stdio mode.

The runner must not turn the command and arguments into a single string. It must preserve
the existing Windows process-tree behavior:

- Windows children are not detached;
- graceful termination uses `taskkill /PID <pid> /T`;
- forced termination adds `/F` after the existing grace period;
- Unix process groups retain their existing signal behavior.

Both prompt processes and background services use the same launcher, so the change also
covers `opencode serve` and `opencode run --attach`.

### CLI Discovery

Windows continues to use `where`. The lookup PATH is extended with existing entries plus
available Windows user-level locations:

- `%APPDATA%\npm`
- `%LOCALAPPDATA%\Programs`
- `%LOCALAPPDATA%\Microsoft\WindowsApps`
- `%USERPROFILE%\scoop\shims`
- `%ProgramData%\chocolatey\bin`
- `%USERPROFILE%\.local\bin`
- common Python `Scripts` directories derived from `%APPDATA%` and `%LOCALAPPDATA%`

Missing environment variables contribute no path entries. Entries are normalized and
deduplicated without changing their first-match precedence.

Discovery output accepts absolute drive-letter and UNC paths. When `where` returns
multiple candidates for one command, Windows executable entries are preferred in this
order:

1. `.exe` and `.com`
2. `.cmd`
3. `.bat`
4. extensionless absolute paths

Cached paths are revalidated before use. An `ENOENT` or equivalent launch failure evicts
the cache so the next request performs discovery again.

### Platform Paths

A shared path resolver owns Windows OpenCode paths. It accepts explicit environment,
platform, and home-directory inputs so it can be tested without mutating the host.

For Windows:

- configuration defaults to `%APPDATA%\opencode\opencode.json`;
- state and cache default to `%LOCALAPPDATA%\opencode`;
- `USERPROFILE` is the home fallback.

For macOS and Linux, the current XDG and home-directory behavior remains unchanged.

Configuration migration is read-compatible:

1. use an existing `%APPDATA%` configuration;
2. otherwise use an existing legacy `~/.config/opencode/opencode.json`;
3. otherwise create the Windows-standard `%APPDATA%` location.

Existing files are never moved or deleted automatically. Provider synchronization keeps
its existing best-effort backup before a write.

### Windows Proxy Environment

Explicit `HTTP_PROXY`, `HTTPS_PROXY`, or `ALL_PROXY` environment variables remain
authoritative.

When none are present on Windows, Agents GUI reads the current user's Internet Settings
from the Windows registry using `reg.exe`. It supports:

- a single `host:port` proxy;
- protocol-specific `http=...;https=...;socks=...` values;
- the user proxy bypass list.

The parser produces standard upper- and lower-case proxy variables. It never evaluates
PAC scripts and never downloads WPAD configuration. Registry lookup or parsing failure
returns an empty override and does not block CLI startup.

Loopback defaults (`127.0.0.1`, `localhost`, `.local`) remain in `NO_PROXY` so OpenCode
attachment traffic cannot be routed through an external proxy.

## Installation and Authentication

`resolveCliInstallHint()` remains the source of platform-specific install commands:

- OpenCode uses npm on Windows;
- Goose uses its PowerShell installer;
- Aider uses PowerShell and Python;
- Claude Code, Gemini, and Codex use their npm installers.

The setup controller continues to send the selected command to the user's current VS
Code terminal. This design does not install prerequisites, elevate privileges, or change
the user's terminal profile.

Authentication commands continue to run in the integrated terminal. Their command and
arguments are fixed by registered CLI profiles; user prompts are never involved.

## Error Handling

- A missing CLI remains unavailable in setup UI and is never replaced by another
  provider.
- A launch failure reports the selected provider name and original process error.
- Failed Windows shim launches evict the resolved-path cache.
- Proxy and legacy-config discovery failures are non-fatal.
- OpenCode server startup failure falls back to the existing non-attached process path
  where supported and surfaces a normal provider error otherwise.
- Stopping a session closes its output stream and SSE connection before terminating the
  process tree.

No new logs may contain prompt text, API keys, proxy credentials, or provider secrets.

## Test Strategy

### Cross-Platform Unit Tests

Pure tests cover:

- platform-specific installation hints;
- Windows PATH construction and deduplication;
- `where` output normalization and extension preference;
- Windows OpenCode configuration, state, cache, and legacy-path selection;
- Windows proxy formats and bypass lists;
- unchanged macOS and Linux path behavior.

Every production behavior change follows red-green-refactor: its test must fail against
the previous implementation before the minimal production change is added.

### Windows Process Integration Tests

On a real `windows-latest` runner, tests create a `.cmd` fixture in a directory whose
name contains spaces and launch it through `CliProcessRunner`. The fixture forwards its
arguments to a Node script that emits structured JSON.

Assertions cover:

- `.cmd` execution succeeds;
- Unicode and multiline arguments are preserved;
- quotes and `& | ^ % !` remain argument data rather than shell syntax;
- stdout and stderr are captured;
- the process can be stopped without leaving its child alive;
- OpenCode-style `serve`, `run`, and `--attach` arguments are preserved.

Non-Windows runners skip only the Windows fixture execution; pure path and proxy tests
run everywhere.

### CI Matrix

CI retains Ubuntu Node 18 and Node 20 jobs and adds Windows Node 20. Every matrix entry
runs:

- dependency installation;
- lint;
- typecheck;
- format check;
- build;
- complete tests.

The release workflow remains on Ubuntu and continues to produce a Universal VSIX.
`verify:release` must remain executable on Windows using `npm.cmd` and the existing
platform-aware shell option.

## Acceptance Criteria

- npm-installed OpenCode, Codex, Claude Code, and Gemini shims launch on Windows 10/11.
- Native Goose and Aider executables continue to launch.
- User prompt arguments cannot be interpreted as shell syntax.
- OpenCode configuration uses the Windows-standard directory without losing legacy
  configuration.
- Windows proxy parsing is non-fatal and keeps loopback traffic local.
- Windows process-tree termination leaves no test child process behind.
- Ubuntu Node 18/20 and Windows Node 20 CI jobs pass.
- Existing macOS tests, Extension Development Host smoke, dependency audit, and VSIX
  packaging pass.
- The VSIX remains platform-unrestricted and Universal.

## Out of Scope

- WSL execution or path translation
- Windows Server certification
- Remote SSH, Dev Containers, and Codespaces host-selection changes
- automatic installation of Node, npm, Python, PowerShell, Scoop, or Chocolatey
- PAC or WPAD execution
- changing Agent, renderer, Provider, or model-selection behavior
