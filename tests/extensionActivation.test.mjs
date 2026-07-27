import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const extensionSource = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
const cliSource = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');
const cliDiscoverySource = readFileSync(new URL('../src/cliDiscovery.ts', import.meta.url), 'utf8');
const cliProcessRunnerSource = readFileSync(
  new URL('../src/cliProcessRunner.ts', import.meta.url),
  'utf8'
);
const apiProviderClientSource = readFileSync(
  new URL('../src/apiProviderClient.ts', import.meta.url),
  'utf8'
);
const agentRuntimeSource = readFileSync(new URL('../src/agentRuntime.ts', import.meta.url), 'utf8');
const agentSessionControllerSource = readFileSync(
  new URL('../src/agentSessionController.ts', import.meta.url),
  'utf8'
);
const attachmentStoreSource = readFileSync(
  new URL('../src/attachmentStore.ts', import.meta.url),
  'utf8'
);
const openCodeAgentCapabilitySource = readFileSync(
  new URL('../src/openCodeAgentCapability.ts', import.meta.url),
  'utf8'
);
const openCodeLocalStateSource = readFileSync(
  new URL('../src/openCodeLocalState.ts', import.meta.url),
  'utf8'
);
const openCodeServerClientSource = readFileSync(
  new URL('../src/openCodeServerClient.ts', import.meta.url),
  'utf8'
);
const extensionSmokeHarnessSource = readFileSync(
  new URL('../src/extensionSmokeHarness.ts', import.meta.url),
  'utf8'
);
const webviewProtocolSource = readFileSync(
  new URL('../src/webviewProtocol.ts', import.meta.url),
  'utf8'
);
const webviewHtmlRendererSource = readFileSync(
  new URL('../src/webviewHtmlRenderer.ts', import.meta.url),
  'utf8'
);
const architectureDoc = readFileSync(
  new URL('../docs/architecture/agent-runtime.md', import.meta.url),
  'utf8'
);
const taskRuntimeArchitectureDoc = readFileSync(
  new URL('../docs/architecture/task-runtime-control-plane.md', import.meta.url),
  'utf8'
);
const textGenerationSource = readFileSync(
  new URL('../src/textGeneration.ts', import.meta.url),
  'utf8'
);
const cliTextGenerationAdapterSource = readFileSync(
  new URL('../src/cliTextGenerationAdapter.ts', import.meta.url),
  'utf8'
);
const agentCapabilitiesSource = readFileSync(
  new URL('../src/agentCapabilities.ts', import.meta.url),
  'utf8'
);
const cliAgentCapabilitiesSource = readFileSync(
  new URL('../src/cliAgentCapabilities.ts', import.meta.url),
  'utf8'
);
const extensionSmokeRunnerSource = readFileSync(
  new URL('../tests/extension-smoke/run.mjs', import.meta.url),
  'utf8'
);
const extensionSmokeSuiteSource = readFileSync(
  new URL('../tests/extension-smoke/suite/index.js', import.meta.url),
  'utf8'
);
const releaseVerifySource = readFileSync(
  new URL('../scripts/verify-release.mjs', import.meta.url),
  'utf8'
);
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const esbuildScript = readFileSync(new URL('../esbuild.mjs', import.meta.url), 'utf8');
const vscodeIgnore = readFileSync(new URL('../.vscodeignore', import.meta.url), 'utf8');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('all contributed commands are registered by the extension host entrypoint', () => {
  for (const command of manifest.contributes.commands.map((entry) => entry.command)) {
    const escaped = escapeRegExp(command);
    assert.match(
      extensionSource,
      new RegExp(`registerCommand\\(\\s*'${escaped}'`),
      `${command} must be registered in src/extension.ts`
    );
  }
});

test('view title commands are registered before the sidebar provider is constructed', () => {
  const providerIndex = extensionSource.indexOf('new SidebarProvider');
  assert.notEqual(providerIndex, -1, 'expected SidebarProvider construction in src/extension.ts');

  for (const command of ['agents-gui.refreshProviders', 'agents-gui.openProviderSettings']) {
    const commandIndex = extensionSource.indexOf(`registerCommand(\n      '${command}'`);
    if (commandIndex === -1) {
      const commandIndex2 = extensionSource.indexOf(`registerCommand('${command}'`);
      assert.notEqual(commandIndex2, -1, `expected ${command} registration in src/extension.ts`);
      assert.ok(
        commandIndex2 < providerIndex,
        `${command} must be registered before SidebarProvider construction`
      );
    } else {
      assert.ok(
        commandIndex < providerIndex,
        `${command} must be registered before SidebarProvider construction`
      );
    }
  }
});

test('refresh providers title action reloads the full sidebar state', () => {
  assert.match(
    extensionSource,
    /registerCommand\('agents-gui\.refreshProviders', async \(\) => \{[\s\S]*vscode\.window\.withProgress[\s\S]*notification\.refreshingProviders[\s\S]*provider\.refreshProviders\(\)[\s\S]*\}\)/
  );
  assert.match(
    sidebarSource,
    /async refreshProviders\(\): Promise<void> \{[\s\S]*await this\.postToWebview\(\{ command: 'refreshStarted' \}\);[\s\S]*await this\.sendProfiles\(\{ force: true \}\);[\s\S]*await this\.sendContextSummary\(\);[\s\S]*await this\.sendHomeAgentSettings\(\);[\s\S]*await this\.sendApiProviderSettings\(\);[\s\S]*await this\.sendCommitMessageSettings\(\);[\s\S]*\}/
  );
});

test('extension host depends on agent runtime and typed webview protocol ports', () => {
  assert.match(extensionSource, /import \{ CliAgentRuntime \} from '\.\/agentRuntime';/);
  assert.match(
    extensionSource,
    /import \{ CliOpenCodeAgentCapability \} from '\.\/openCodeAgentCapability';/
  );
  assert.match(extensionSource, /const agentRuntime = new CliAgentRuntime\(cliManager\);/);
  assert.match(
    extensionSource,
    /const openCodeCapability = new CliOpenCodeAgentCapability\(cliManager\);/
  );
  assert.match(extensionSource, /new SidebarProvider\(context\.extensionUri, agentRuntime, \{/);
  assert.match(
    sidebarSource,
    /import type \{ AgentProfileStatusOptions, AgentRuntime \} from '\.\/agentRuntime';/
  );
  assert.match(
    sidebarSource,
    /import \{ AgentSessionController \} from '\.\/agentSessionController';/
  );
  assert.match(sidebarSource, /import \{ ImageAttachmentStore \} from '\.\/attachmentStore';/);
  assert.match(sidebarSource, /import \{ OpenCodeLocalState \} from '\.\/openCodeLocalState';/);
  assert.match(
    sidebarSource,
    /import type \{ OpenCodeAgentCapability \} from '\.\/openCodeAgentCapability';/
  );
  assert.doesNotMatch(sidebarSource, /import \{ CliManager, Session \} from '\.\/cliManager';/);
  assert.match(sidebarSource, /private readonly agentRuntime: AgentRuntime/);
  assert.match(sidebarSource, /private readonly sessionController: AgentSessionController/);
  assert.match(sidebarSource, /private readonly attachmentStore: ImageAttachmentStore/);
  assert.match(sidebarSource, /private readonly openCodeLocalState: OpenCodeLocalState/);
  assert.match(sidebarSource, /private readonly openCodeCapability\?: OpenCodeAgentCapability/);
  assert.match(sidebarSource, /openCodeCapability\?: OpenCodeAgentCapability/);
  assert.match(extensionSource, /openCodeCapability,/);
  assert.match(sidebarSource, /onDidReceiveMessage\(async \(message: WebviewToHostMessage\) =>/);
  assert.match(sidebarSource, /private postToWebview\(message: HostToWebviewMessage\)/);
  assert.match(sidebarSource, /this\.postToWebview\(\{/);
  assert.doesNotMatch(sidebarSource, /this\.view\?\.webview\.postMessage\(\{/);
  assert.match(sidebarSource, /import \{ renderWebviewHtml \} from '\.\/webviewHtmlRenderer';/);
  assert.match(
    sidebarSource,
    /return renderWebviewHtml\(\{[\s\S]*extensionUri: this\.extensionUri,[\s\S]*webview,[\s\S]*locale: this\.locale,[\s\S]*codexRendererEnabled: this\.isCodexRendererEnabled\(\),[\s\S]*\}\)/
  );
  assert.doesNotMatch(sidebarSource, /fs\.readFileSync\(htmlPath/);
  assert.match(webviewHtmlRendererSource, /export function renderWebviewHtml/);
  assert.match(webviewHtmlRendererSource, /const WEBVIEW_ASSETS = \[/);
  assert.match(webviewHtmlRendererSource, /'__WORKBENCH_LAYOUT_JS_URI__'/);
  assert.match(webviewHtmlRendererSource, /'__TASK_BOARD_STATE_JS_URI__'/);
  assert.match(webviewHtmlRendererSource, /'__COMPOSER_STATE_JS_URI__'/);
  assert.match(webviewHtmlRendererSource, /'__PROVIDER_OPTIONS_JS_URI__'/);
  assert.match(webviewHtmlRendererSource, /getWebviewUri\(options\.extensionUri, options\.webview/);
  assert.match(agentRuntimeSource, /export interface AgentRuntime/);
  assert.match(agentRuntimeSource, /export class CliAgentRuntime implements AgentRuntime/);
  assert.doesNotMatch(agentRuntimeSource, /OpenCodeAgentCapability/);
  assert.match(agentSessionControllerSource, /export class AgentSessionController/);
  assert.match(attachmentStoreSource, /export class ImageAttachmentStore/);
  assert.match(openCodeLocalStateSource, /export class OpenCodeLocalState/);
  assert.match(openCodeAgentCapabilitySource, /export interface OpenCodeAgentCapability/);
  assert.match(
    openCodeAgentCapabilitySource,
    /export class CliOpenCodeAgentCapability implements OpenCodeAgentCapability/
  );
  const runtimeInterface =
    agentRuntimeSource.match(/export interface AgentRuntime \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(runtimeInterface, 'expected AgentRuntime interface source');
  assert.doesNotMatch(runtimeInterface, /OpenCode/);
  assert.doesNotMatch(runtimeInterface, /runPrompt/);
  assert.match(webviewProtocolSource, /export type WebviewToHostMessage/);
  assert.match(webviewProtocolSource, /export type HostToWebviewMessage/);
  assert.match(architectureDoc, /ports-and-adapters architecture/);
  assert.match(architectureDoc, /AgentRuntime port/);
  assert.match(architectureDoc, /OpenCodeAgentCapability/);
  assert.match(architectureDoc, /src\/agentSessionController\.ts/);
  assert.match(architectureDoc, /src\/attachmentStore\.ts/);
  assert.match(architectureDoc, /src\/openCodeLocalState\.ts/);
  assert.match(architectureDoc, /src\/webviewHtmlRenderer\.ts/);
});

test('commit generation is wired as a task-scoped application use case', () => {
  assert.match(
    extensionSource,
    /import \{ CliTextGenerationAdapter \} from '\.\/cliTextGenerationAdapter';/
  );
  assert.match(
    extensionSource,
    /import \{ GenerateCommitMessageUseCase \} from '\.\/textGeneration';/
  );
  assert.match(
    extensionSource,
    /const textGenerationAdapter = new CliTextGenerationAdapter\(cliManager,/
  );
  assert.match(
    extensionSource,
    /const generateCommitMessage = new GenerateCommitMessageUseCase\(textGenerationAdapter\);/
  );
  assert.match(
    extensionSource,
    /new CommitMessageCommand\(\s*textGenerationAdapter,\s*generateCommitMessage\s*\)/
  );
  assert.match(textGenerationSource, /export interface TextGenerationPort/);
  assert.match(textGenerationSource, /export class GenerateCommitMessageUseCase/);
  assert.match(
    cliTextGenerationAdapterSource,
    /implements TextGenerationPort, TextGenerationProviderRegistry/
  );
  assert.match(cliTextGenerationAdapterSource, /buildOpenCodeFastGenerationEnv/);
  assert.match(cliSource, /const cwd = options\.cwd\?\.trim\(\) \|\| this\.getWorkspaceRoot\(\)/);
  assert.match(architectureDoc, /task-runtime-control-plane\.md/);
  assert.match(taskRuntimeArchitectureDoc, /fast text generation/);
});

test('interactive agent requests pass through the capability control plane', () => {
  assert.match(
    extensionSource,
    /import \{ createCliAgentCapabilityRegistry \} from '\.\/cliAgentCapabilities';/
  );
  assert.match(
    extensionSource,
    /const agentCapabilityRegistry = createCliAgentCapabilityRegistry\(CLI_PROFILES\);/
  );
  assert.match(extensionSource, /agentCapabilityRegistry,/);
  assert.match(sidebarSource, /resolveAgentTaskIntent/);
  assert.match(sidebarSource, /resolveAgentCapabilityPolicy/);
  assert.match(sidebarSource, /this\.agentCapabilityRegistry\.resolve\(/);
  assert.match(sidebarSource, /capabilityResolution\.transport !== 'cli'/);
  assert.match(cliAgentCapabilitiesSource, /export function createCliAgentCapabilityRegistry/);
  assert.doesNotMatch(agentCapabilitiesSource, /from ['"]vscode['"]/);
  assert.doesNotMatch(agentCapabilitiesSource, /CliManager/);
  assert.doesNotMatch(agentCapabilitiesSource, /child_process/);
  assert.match(taskRuntimeArchitectureDoc, /capability registry/i);
  assert.match(taskRuntimeArchitectureDoc, /ACP[\s\S]*native[\s\S]*CLI/i);
});

test('session lifecycle stays behind a dedicated controller', () => {
  assert.match(agentSessionControllerSource, /export class AgentSessionController/);
  assert.match(agentSessionControllerSource, /private readonly activeSessions = new Map/);
  assert.match(agentSessionControllerSource, /private readonly eventDisposables = new Map/);
  assert.match(agentSessionControllerSource, /replace\(cliId: string\): void/);
  assert.match(agentSessionControllerSource, /normalizeCliOutputChunk/);
  assert.match(agentSessionControllerSource, /filterPromptEchoChunk/);
  assert.match(agentSessionControllerSource, /command: 'sessionEnd'/);
  assert.match(sidebarSource, /this\.sessionController\.register\(session\)/);
  assert.match(sidebarSource, /this\.sessionController\.replace\(cliId\)/);
  assert.match(sidebarSource, /this\.sessionController\.stopAll\(\)/);
  assert.doesNotMatch(sidebarSource, /private activeSessions = new Map/);
  assert.doesNotMatch(sidebarSource, /private outputBuffers = new Map/);
  assert.doesNotMatch(sidebarSource, /this\.activeSessions\.delete\(cliId\)/);
  assert.doesNotMatch(sidebarSource, /filterPromptEchoChunk/);
});

test('attachment persistence stays behind a dedicated store', () => {
  assert.match(attachmentStoreSource, /export class ImageAttachmentStore/);
  assert.match(attachmentStoreSource, /decodeImageDataUrl/);
  assert.match(attachmentStoreSource, /safeAttachmentName/);
  assert.match(attachmentStoreSource, /pasted-images/);
  assert.match(sidebarSource, /this\.attachmentStore\.materialize\(message\.attachments\)/);
  assert.doesNotMatch(sidebarSource, /decodeImageDataUrl/);
  assert.doesNotMatch(sidebarSource, /safeAttachmentName/);
  assert.doesNotMatch(sidebarSource, /MAX_IMAGE_ATTACHMENT_BYTES/);
});

test('OpenCode local state paths stay behind a dedicated adapter', () => {
  assert.match(openCodeLocalStateSource, /export class OpenCodeLocalState/);
  assert.match(openCodeLocalStateSource, /XDG_STATE_HOME/);
  assert.match(openCodeLocalStateSource, /XDG_CACHE_HOME/);
  assert.match(openCodeLocalStateSource, /LOCALAPPDATA/);
  assert.match(cliDiscoverySource, /private readonly openCodeLocalState: OpenCodeLocalState/);
  assert.match(sidebarSource, /this\.openCodeLocalState\.updateModelVariant/);
  assert.doesNotMatch(cliDiscoverySource, /\.local', 'state', 'opencode'/);
  assert.doesNotMatch(sidebarSource, /\.local', 'state', 'opencode'/);
});

test('extension smoke script covers command entrypoints and harnessed runtime flows', () => {
  assert.equal(
    manifest.scripts['smoke:extension'],
    'npm run build && node tests/extension-smoke/run.mjs'
  );
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
  assert.match(
    cliSource,
    /this\.openCodeClient\.runPrompt\(prompt, token, directory, modelId, onPartial\)/
  );
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
  assert.match(cliSource, /this\.cliDiscovery\.getProfilesWithStatus\(CLI_PROFILES, options\)/);
  assert.match(cliSource, /this\.cliDiscovery\.expandProfileEnv/);
  assert.doesNotMatch(cliSource, /import \* as fs from 'fs';/);
  assert.doesNotMatch(cliSource, /import \* as os from 'os';/);
  assert.match(cliDiscoverySource, /export class CliDiscovery/);
  assert.match(cliDiscoverySource, /async resolveCommandPath\(command: string\)/);
  assert.match(cliDiscoverySource, /PROFILE_STATUS_CACHE_MS = 300_000/);
  assert.match(cliDiscoverySource, /private profileStatusInflight\?/);
  assert.match(
    cliDiscoverySource,
    /async getProfilesWithStatus\(\s*baseProfiles: CliProfile\[\],\s*options: CliProfileStatusOptions = \{\}/s
  );
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
  assert.match(
    sidebarSource,
    /this\.apiProviderClient\.listModels\(\{ protocol, baseUrl, apiKey \}\)/
  );
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
