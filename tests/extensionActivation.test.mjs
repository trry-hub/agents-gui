import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const extensionSource = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
const cliSource = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');
const cliDiscoverySource = readFileSync(new URL('../src/cliDiscovery.ts', import.meta.url), 'utf8');
const cliProcessRunnerSource = readFileSync(new URL('../src/cliProcessRunner.ts', import.meta.url), 'utf8');
const apiProviderClientSource = readFileSync(new URL('../src/apiProviderClient.ts', import.meta.url), 'utf8');
const agentRuntimeSource = readFileSync(new URL('../src/agentRuntime.ts', import.meta.url), 'utf8');
const openCodeAgentCapabilitySource = readFileSync(new URL('../src/openCodeAgentCapability.ts', import.meta.url), 'utf8');
const openCodeServerClientSource = readFileSync(new URL('../src/openCodeServerClient.ts', import.meta.url), 'utf8');
const extensionSmokeHarnessSource = readFileSync(new URL('../src/extensionSmokeHarness.ts', import.meta.url), 'utf8');
const webviewProtocolSource = readFileSync(new URL('../src/webviewProtocol.ts', import.meta.url), 'utf8');
const architectureDoc = readFileSync(new URL('../docs/architecture/agent-runtime.md', import.meta.url), 'utf8');
const extensionSmokeRunnerSource = readFileSync(new URL('../tests/extension-smoke/run.mjs', import.meta.url), 'utf8');
const extensionSmokeSuiteSource = readFileSync(new URL('../tests/extension-smoke/suite/index.js', import.meta.url), 'utf8');
const releaseVerifySource = readFileSync(new URL('../scripts/verify-release.mjs', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const esbuildScript = readFileSync(new URL('../esbuild.mjs', import.meta.url), 'utf8');
const vscodeIgnore = readFileSync(new URL('../.vscodeignore', import.meta.url), 'utf8');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('all contributed commands are registered by the extension host entrypoint', () => {
  for (const command of manifest.contributes.commands.map((entry) => entry.command)) {
    assert.match(
      extensionSource,
      new RegExp(`registerCommand\\('${escapeRegExp(command)}'`),
      `${command} must be registered in src/extension.ts`
    );
  }
});

test('view title commands are registered before the sidebar provider is constructed', () => {
  const providerIndex = extensionSource.indexOf('new SidebarProvider');
  assert.notEqual(providerIndex, -1, 'expected SidebarProvider construction in src/extension.ts');

  for (const command of ['agents-gui.refreshProviders', 'agents-gui.openProviderSettings']) {
    const commandIndex = extensionSource.indexOf(`registerCommand('${command}'`);
    assert.notEqual(commandIndex, -1, `expected ${command} registration in src/extension.ts`);
    assert.ok(
      commandIndex < providerIndex,
      `${command} must be registered before SidebarProvider construction`
    );
  }
});

test('refresh providers title action reloads the full sidebar state', () => {
  assert.match(
    extensionSource,
    /registerCommand\('agents-gui\.refreshProviders', async \(\) => \{[\s\S]*vscode\.window\.withProgress[\s\S]*notification\.refreshingProviders[\s\S]*provider\.refreshProviders\(\)[\s\S]*\}\)/
  );
  assert.match(
    sidebarSource,
    /async refreshProviders\(\): Promise<void> \{\s*await this\.postToWebview\(\{ command: 'refreshStarted' \}\);\s*await this\.sendProfiles\(\);\s*await this\.sendContextSummary\(\);\s*await this\.sendHomeAgentSettings\(\);\s*await this\.sendApiProviderSettings\(\);\s*await this\.sendCommitMessageSettings\(\);\s*\}/s
  );
});

test('extension host depends on agent runtime and typed webview protocol ports', () => {
  assert.match(extensionSource, /import \{ CliAgentRuntime \} from '\.\/agentRuntime';/);
  assert.match(extensionSource, /import \{ CliOpenCodeAgentCapability \} from '\.\/openCodeAgentCapability';/);
  assert.match(extensionSource, /const agentRuntime = new CliAgentRuntime\(cliManager\);/);
  assert.match(extensionSource, /const openCodeCapability = new CliOpenCodeAgentCapability\(cliManager\);/);
  assert.match(extensionSource, /new SidebarProvider\(context\.extensionUri, agentRuntime, \{/);
  assert.match(sidebarSource, /import type \{ AgentRuntime, AgentSession \} from '\.\/agentRuntime';/);
  assert.match(sidebarSource, /import type \{ OpenCodeAgentCapability \} from '\.\/openCodeAgentCapability';/);
  assert.doesNotMatch(sidebarSource, /import \{ CliManager, Session \} from '\.\/cliManager';/);
  assert.match(sidebarSource, /private readonly agentRuntime: AgentRuntime/);
  assert.match(sidebarSource, /private readonly openCodeCapability\?: OpenCodeAgentCapability/);
  assert.match(sidebarSource, /openCodeCapability\?: OpenCodeAgentCapability/);
  assert.match(extensionSource, /openCodeCapability,/);
  assert.match(sidebarSource, /onDidReceiveMessage\(async \(message: WebviewToHostMessage\) =>/);
  assert.match(sidebarSource, /private postToWebview\(message: HostToWebviewMessage\)/);
  assert.match(sidebarSource, /this\.postToWebview\(\{/);
  assert.doesNotMatch(sidebarSource, /this\.view\?\.webview\.postMessage\(\{/);
  assert.match(agentRuntimeSource, /export interface AgentRuntime/);
  assert.match(agentRuntimeSource, /export class CliAgentRuntime implements AgentRuntime/);
  assert.doesNotMatch(agentRuntimeSource, /OpenCodeAgentCapability/);
  assert.match(openCodeAgentCapabilitySource, /export interface OpenCodeAgentCapability/);
  assert.match(openCodeAgentCapabilitySource, /export class CliOpenCodeAgentCapability implements OpenCodeAgentCapability/);
  const runtimeInterface = agentRuntimeSource.match(/export interface AgentRuntime \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(runtimeInterface, 'expected AgentRuntime interface source');
  assert.doesNotMatch(runtimeInterface, /OpenCode/);
  assert.doesNotMatch(runtimeInterface, /runPrompt/);
  assert.match(webviewProtocolSource, /export type WebviewToHostMessage/);
  assert.match(webviewProtocolSource, /export type HostToWebviewMessage/);
  assert.match(architectureDoc, /ports-and-adapters architecture/);
  assert.match(architectureDoc, /AgentRuntime port/);
  assert.match(architectureDoc, /OpenCodeAgentCapability/);
});

test('extension smoke script covers command entrypoints and harnessed runtime flows', () => {
  assert.equal(manifest.scripts['smoke:extension'], 'npm run build && node tests/extension-smoke/run.mjs');
  assert.equal(manifest.scripts['verify:release'], 'node scripts/verify-release.mjs');
  assert.match(JSON.stringify(manifest.devDependencies), /@vscode\/test-electron/);
  assert.match(extensionSource, /context\.extensionMode !== vscode\.ExtensionMode\.Production/);
  assert.match(extensionSource, /registerCommand\('agents-gui\.internal\.runSmoke'/);
  assert.match(extensionSource, /runExtensionSmokeProbe\(context\.extensionUri/);
  assert.match(extensionSmokeRunnerSource, /runTests/);
  assert.match(extensionSmokeRunnerSource, /downloadAndUnzipVSCode/);
  assert.match(extensionSmokeRunnerSource, /resolveCliPathFromVSCodeExecutablePath/);
  assert.match(extensionSmokeRunnerSource, /VSCODE_TEST_EXECUTABLE/);
  assert.match(extensionSmokeRunnerSource, /extensionDevelopmentPath/);
  assert.doesNotMatch(extensionSmokeRunnerSource, /launchArgs/);
  assert.match(extensionSmokeSuiteSource, /executeCommand\('agents-gui\.openPanel'\)/);
  assert.match(extensionSmokeSuiteSource, /executeCommand\('agents-gui\.refreshProviders'\)/);
  assert.match(extensionSmokeSuiteSource, /executeCommand\('agents-gui\.stopAll'\)/);
  assert.match(extensionSmokeSuiteSource, /executeCommand\('agents-gui\.internal\.runSmoke'\)/);
  assert.match(extensionSmokeHarnessSource, /new SidebarProvider\(extensionUri, runtime/);
  assert.match(extensionSmokeHarnessSource, /command: 'send'/);
  assert.match(extensionSmokeHarnessSource, /command: 'sendSessionInput'/);
  assert.match(extensionSmokeHarnessSource, /command: 'openCodeNativeCommand'/);
  assert.match(extensionSmokeHarnessSource, /command: 'stop'/);
  assert.match(extensionSmokeHarnessSource, /openCodeTextDelta\('smoke reply'\)/);
  assert.match(extensionSmokeHarnessSource, /requiredCommands(?:: string\[\])? = \[/);
  assert.match(releaseVerifySource, /npmCommand/);
  assert.match(releaseVerifySource, /'run', 'test', '--', '--runInBand'/);
  assert.match(releaseVerifySource, /'run', 'smoke:extension'/);
  assert.match(releaseVerifySource, /'audit', '--omit=optional'/);
  assert.match(releaseVerifySource, /'run', 'package'/);
  assert.match(releaseVerifySource, /'diff', '--cached', '--check'/);
});

test('opencode server IO stays behind the server client adapter', () => {
  assert.match(cliSource, /new OpenCodeServerClient/);
  assert.match(cliSource, /this\.openCodeClient\.runPrompt\(prompt, token, directory, modelId, onPartial\)/);
  assert.match(cliSource, /this\.openCodeClient\.getStatus\(\)/);
  assert.match(cliSource, /this\.openCodeClient\.executeNativeCommand\(command, sessionId\)/);
  assert.match(cliSource, /this\.openCodeClient\.deleteSession\(sessionId\)/);
  assert.doesNotMatch(cliSource, /import \* as http from 'http';/);
  assert.doesNotMatch(cliSource, /import \* as https from 'https';/);
  assert.match(openCodeServerClientSource, /import \* as http from 'http';/);
  assert.match(openCodeServerClientSource, /import \* as https from 'https';/);
  assert.match(openCodeServerClientSource, /export class OpenCodeServerClient/);
  assert.match(openCodeServerClientSource, /openEventStream/);
  assert.match(architectureDoc, /OpenCode HTTP, SSE, status, model discovery/);
});

test('CLI discovery stays behind a dedicated provider discovery adapter', () => {
  assert.match(cliSource, /import \{ CliDiscovery, stableHash \} from '\.\/cliDiscovery';/);
  assert.match(cliSource, /private readonly cliDiscovery = new CliDiscovery/);
  assert.match(cliSource, /this\.cliDiscovery\.getProfilesWithStatus\(CLI_PROFILES\)/);
  assert.match(cliSource, /this\.cliDiscovery\.expandProfileEnv/);
  assert.doesNotMatch(cliSource, /import \* as fs from 'fs';/);
  assert.doesNotMatch(cliSource, /import \* as os from 'os';/);
  assert.match(cliDiscoverySource, /export class CliDiscovery/);
  assert.match(cliDiscoverySource, /async resolveCommandPath\(command: string\)/);
  assert.match(cliDiscoverySource, /async getProfilesWithStatus\(baseProfiles: CliProfile\[\]\)/);
  assert.match(cliDiscoverySource, /expandProfileEnv/);
  assert.match(cliDiscoverySource, /import \* as fs from 'fs';/);
  assert.match(cliDiscoverySource, /import \* as os from 'os';/);
  assert.match(architectureDoc, /CLI command resolution, installed\/version status/);
});

test('CLI process lifecycle stays behind a dedicated process runner', () => {
  assert.match(cliSource, /import \{ CliProcessRunner \} from '\.\/cliProcessRunner';/);
  assert.match(cliSource, /private readonly processRunner = new CliProcessRunner/);
  assert.match(cliSource, /this\.processRunner\.spawnPromptProcess/);
  assert.match(cliSource, /this\.processRunner\.spawnBackgroundProcess/);
  assert.doesNotMatch(cliSource, /spawn\('taskkill'/);
  assert.doesNotMatch(cliSource, /process\.kill\(-proc\.pid/);
  assert.match(cliProcessRunnerSource, /export class CliProcessRunner/);
  assert.match(cliProcessRunnerSource, /spawnPromptProcess/);
  assert.match(cliProcessRunnerSource, /spawnBackgroundProcess/);
  assert.match(cliProcessRunnerSource, /terminate\(proc: ChildProcess\)/);
  assert.match(cliProcessRunnerSource, /killTree\(proc: ChildProcess, signal: NodeJS\.Signals\)/);
  assert.match(architectureDoc, /CLI process spawning/);
});

test('custom API provider model fetching stays behind a provider client adapter', () => {
  assert.match(sidebarSource, /import \{ ApiProviderClient \} from '\.\/apiProviderClient';/);
  assert.match(sidebarSource, /private readonly apiProviderClient: ApiProviderClient/);
  assert.match(sidebarSource, /this\.apiProviderClient\.listModels\(\{ protocol, baseUrl, apiKey \}\)/);
  assert.doesNotMatch(sidebarSource, /import \* as http from 'http';/);
  assert.doesNotMatch(sidebarSource, /import \* as https from 'https';/);
  assert.doesNotMatch(sidebarSource, /function requestJson/);
  assert.match(apiProviderClientSource, /export class ApiProviderClient/);
  assert.match(apiProviderClientSource, /import \* as http from 'http';/);
  assert.match(apiProviderClientSource, /import \* as https from 'https';/);
  assert.match(apiProviderClientSource, /headers\['anthropic-version'\] = '2023-06-01'/);
  assert.match(architectureDoc, /custom API provider model-list HTTP calls/);
});

test('packaged build avoids tokenizer wasm runtime assets', () => {
  assert.doesNotMatch(esbuildScript, /tiktoken/);
  assert.doesNotMatch(esbuildScript, /dist\/tiktoken_bg\.wasm/);
  assert.doesNotMatch(esbuildScript, /copy-runtime-assets/);
  assert.doesNotMatch(vscodeIgnore, /^\s*!\s*dist\/tiktoken_bg\.wasm\s*$/m);
});
