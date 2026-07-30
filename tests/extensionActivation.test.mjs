import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const extensionSource = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
const syncedStateSource = readFileSync(new URL('../src/syncedState.ts', import.meta.url), 'utf8');
const cliSource = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');
const cliDiscoverySource = readFileSync(new URL('../src/cliDiscovery.ts', import.meta.url), 'utf8');
const cliProcessRunnerSource = readFileSync(
  new URL('../src/cliProcessRunner.ts', import.meta.url),
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
const openCodePathsSource = readFileSync(
  new URL('../src/openCodePaths.ts', import.meta.url),
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

test('test script uses cross-platform Node test discovery', () => {
  assert.equal(manifest.scripts.test, 'npm run build:test && node scripts/run-tests.mjs');
});

test('release verification uses the serial Node test runner option', () => {
  assert.match(releaseVerifySource, /args: \['run', 'test', '--', '--test-concurrency=1'\]/);
  assert.doesNotMatch(releaseVerifySource, /--runInBand/);
});

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
    /async refreshProviders\(\): Promise<void> \{[\s\S]*await this\.postToWebview\(\{ command: 'refreshStarted' \}\);[\s\S]*await this\.sendProfiles\(\{ force: true \}\);[\s\S]*await this\.sendHomeAgentSettings\(\);[\s\S]*await this\.sendCommitMessageSettings\(\);[\s\S]*\}/
  );
  assert.doesNotMatch(
    sidebarSource.slice(
      sidebarSource.indexOf('async refreshProviders()'),
      sidebarSource.indexOf('async openProviderSettings(')
    ),
    /sendContextSummary\(/
  );
});

test('context summary protocol is correlated and host invalidations replace unsolicited summaries', () => {
  const sendSummaryCalls = sidebarSource.match(/sendContextSummary\(/g) || [];
  const previewSource = readFileSync(
    new URL('../scripts/preview-webview.mjs', import.meta.url),
    'utf8'
  );

  assert.match(
    webviewProtocolSource,
    /command: 'refreshContext';[\s\S]*requestId: string;[\s\S]*cliId: string;[\s\S]*contextOptions\?:/
  );
  assert.match(
    webviewProtocolSource,
    /command: 'contextSummary';\s*requestId: string;\s*cliId: string;\s*summary: AssistantContextSummary/
  );
  assert.match(webviewProtocolSource, /command: 'contextInvalidated'; cliId\?: string/);
  assert.equal(
    sendSummaryCalls.length,
    2,
    'sendContextSummary should only be declared and serve refreshContext'
  );
  assert.match(
    sidebarSource,
    /command: 'contextSummary',\s*requestId,\s*cliId,\s*summary,/
  );
  assert.match(sidebarSource, /configuredModelId = profile\?\.configuredModel\?\.id/);
  assert.doesNotMatch(sidebarSource, /scheduleOpenCodeStatusRefresh/);
  assert.match(sidebarSource, /command: 'contextInvalidated'/);
  assert.match(previewSource, /requestId:\s*message\.requestId/);
  assert.match(previewSource, /cliId:\s*message\.cliId/);
  assert.doesNotMatch(previewSource, /modelId:\s*message\.modelId/);
  assert.match(
    extensionSmokeHarnessSource,
    /command: 'refreshContext',[\s\S]*requestId: 'smoke-context-1',[\s\S]*cliId: 'opencode'/
  );
  assert.match(
    extensionSmokeHarnessSource,
    /message\.command === 'contextSummary'[\s\S]*message\.requestId === 'smoke-context-1'[\s\S]*message\.cliId === 'opencode'/
  );
});

test('extension host depends on agent runtime and typed webview protocol ports', () => {
  assert.match(extensionSource, /import \{ CliAgentRuntime \} from '\.\/agentRuntime';/);
  assert.match(extensionSource, /const agentRuntime = new CliAgentRuntime\(cliManager\);/);
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
  assert.doesNotMatch(sidebarSource, /import \{ CliManager, Session \} from '\.\/cliManager';/);
  assert.match(sidebarSource, /private readonly agentRuntime: AgentRuntime/);
  assert.match(sidebarSource, /private readonly sessionController: AgentSessionController/);
  assert.match(sidebarSource, /private readonly attachmentStore: ImageAttachmentStore/);
  assert.doesNotMatch(sidebarSource, /OpenCodeLocalState|setOpenCodeModelVariant/);
  assert.doesNotMatch(sidebarSource, /OpenCodeAgentCapability|openCodeCapability/);
  assert.doesNotMatch(extensionSource, /OpenCodeAgentCapability|openCodeCapability/);
  assert.match(sidebarSource, /onDidReceiveMessage\(async \(message: WebviewToHostMessage\) =>/);
  assert.match(sidebarSource, /private postToWebview\(message: HostToWebviewMessage\)/);
  assert.match(sidebarSource, /this\.postToWebview\(\{/);
  assert.doesNotMatch(sidebarSource, /this\.view\?\.webview\.postMessage\(\{/);
  assert.match(
    sidebarSource,
    /import \{\s*providerIconPaths,\s*renderWebviewHtml,\s*webviewAssetPaths,?\s*\} from '\.\/webviewHtmlRenderer';/
  );
  assert.match(
    sidebarSource,
    /return renderWebviewHtml\(\{[\s\S]*extensionUri: this\.extensionUri,[\s\S]*webview,[\s\S]*locale: this\.locale,[\s\S]*codexRendererEnabled: this\.isCodexRendererEnabled\(\),[\s\S]*\}\)/
  );
  assert.doesNotMatch(sidebarSource, /fs\.readFileSync\(htmlPath/);
  assert.match(webviewHtmlRendererSource, /export function renderWebviewHtml/);
  assert.match(webviewHtmlRendererSource, /export function readWebviewAssetManifest/);
  assert.match(webviewHtmlRendererSource, /'webview-assets\.json'/);
  assert.match(sidebarSource, /webviewAssetPaths\(this\.extensionUri\)/);
  assert.match(
    webviewHtmlRendererSource,
    /getWebviewUri\([\s\S]*options\.extensionUri,[\s\S]*options\.webview/
  );
  assert.match(agentRuntimeSource, /export interface AgentRuntime/);
  assert.match(agentRuntimeSource, /export class CliAgentRuntime implements AgentRuntime/);
  assert.doesNotMatch(agentRuntimeSource, /OpenCodeAgentCapability/);
  assert.match(agentSessionControllerSource, /export class AgentSessionController/);
  assert.match(attachmentStoreSource, /export class ImageAttachmentStore/);
  assert.equal(existsSync(new URL('../src/openCodeLocalState.ts', import.meta.url)), false);
  assert.equal(existsSync(new URL('../src/openCodeAgentCapability.ts', import.meta.url)), false);
  assert.equal(existsSync(new URL('../src/openCodeServerClient.ts', import.meta.url)), false);
  const runtimeInterface =
    agentRuntimeSource.match(/export interface AgentRuntime \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(runtimeInterface, 'expected AgentRuntime interface source');
  assert.doesNotMatch(runtimeInterface, /OpenCode/);
  assert.doesNotMatch(runtimeInterface, /runPrompt/);
  assert.match(webviewProtocolSource, /export type WebviewToHostMessage/);
  assert.match(webviewProtocolSource, /export type HostToWebviewMessage/);
  assert.match(architectureDoc, /ports-and-adapters architecture/);
  assert.match(architectureDoc, /AgentRuntime/);
  assert.match(architectureDoc, /src\/agentSessionController\.ts/);
  assert.match(architectureDoc, /src\/attachmentStore\.ts/);
  assert.match(architectureDoc, /src\/webviewHtmlRenderer\.ts/);
});


test('architecture documents native CLI passthrough instead of a policy overlay', () => {
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
  assert.match(taskRuntimeArchitectureDoc, /selected CLI only/i);
  assert.match(taskRuntimeArchitectureDoc, /native one-shot prompt transport/i);
  assert.match(taskRuntimeArchitectureDoc, /no automatic provider fallback/i);
  assert.match(taskRuntimeArchitectureDoc, /no managed OpenCode server/i);
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
  assert.doesNotMatch(extensionSmokeHarnessSource, /sendSessionInput|openCodeNativeCommand/);
  assert.match(extensionSmokeHarnessSource, /command: 'stop'/);
  assert.match(extensionSmokeHarnessSource, /openCodeTextDelta\('smoke reply'\)/);
  assert.match(extensionSmokeHarnessSource, /requiredCommands(?:: string\[\])? = \[/);
  assert.match(releaseVerifySource, /npmCommand/);
  assert.match(releaseVerifySource, /'run', 'smoke:extension'/);
  assert.match(releaseVerifySource, /'audit', '--omit=dev', '--omit=optional'/);
  assert.match(releaseVerifySource, /'run', 'package'/);
  assert.match(releaseVerifySource, /'diff', '--cached', '--check'/);
});


test('CLI discovery keeps command resolution and observational probes behind its adapter', () => {
  assert.match(cliSource, /import \{ CliDiscovery \} from '\.\/cliDiscovery';/);
  assert.match(cliSource, /private readonly cliDiscovery: CliManagerDiscovery/);
  assert.match(cliSource, /this\.cliDiscovery\.getProfilesWithStatus\(CLI_PROFILES, options\)/);
  assert.doesNotMatch(cliSource, /expandProfileEnv/);
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
  assert.doesNotMatch(cliDiscoverySource, /expandProfileEnv/);
  assert.match(cliDiscoverySource, /import \* as fs from 'fs';/);
  assert.doesNotMatch(cliDiscoverySource, /import \* as os from 'os';/);
  assert.match(architectureDoc, /CLI command resolution, installed\/version status/);
});

test('CLI process lifecycle keeps prompt/probe and tree termination behind a dedicated runner', () => {
  assert.match(cliSource, /import \{ CliProcessRunner \} from '\.\/cliProcessRunner';/);
  assert.match(cliSource, /private readonly processRunner: CliProcessRunner/);
  assert.match(cliSource, /this\.processRunner\.spawnPromptProcess/);
  assert.doesNotMatch(cliSource, /spawnBackgroundProcess/);
  assert.doesNotMatch(cliSource, /spawn\('taskkill'/);
  assert.doesNotMatch(cliSource, /process\.kill\(-proc\.pid/);
  assert.match(cliProcessRunnerSource, /export class CliProcessRunner/);
  assert.match(cliProcessRunnerSource, /spawnPromptProcess/);
  assert.doesNotMatch(cliProcessRunnerSource, /spawnBackgroundProcess/);
  assert.match(cliProcessRunnerSource, /from 'cross-spawn'/);
  assert.match(cliProcessRunnerSource, /spawnProbeProcess/);
  assert.match(cliDiscoverySource, /this\.processRunner\.spawnProbeProcess/);
  assert.doesNotMatch(cliDiscoverySource, /from 'child_process'/);
  assert.doesNotMatch(cliProcessRunnerSource, /shell:\s*true/);
  assert.match(cliProcessRunnerSource, /terminate\(proc: ChildProcess\)/);
  assert.match(cliProcessRunnerSource, /killTree\(proc: ChildProcess, signal: NodeJS\.Signals\)/);
  assert.match(cliProcessRunnerSource, /this\.spawnImpl\('taskkill', args/);
  assert.doesNotMatch(cliDiscoverySource, /\bproc\.kill\(/);
  assert.match(architectureDoc, /CLI process spawning/);
});

test('activation runs local OpenCode cleanup without API runtime injection', () => {
  assert.match(
    extensionSource,
    /await runOpenCodeCleanupOnce\(context\.globalState, openCodeCleanup\)/
  );
  assert.doesNotMatch(
    extensionSource,
    /resolveApiProviderRuntime|readApiProviderSettings|readOpenCodeConfig/
  );
  assert.doesNotMatch(
    sidebarSource,
    /OpenCodeConfigSync|sendApiProviderSettings|saveApiProviderSettings/
  );
  assert.doesNotMatch(syncedStateSource, /openCodeNativePassthroughCleanup/);
});

test('SCM text generation launches only the selected native CLI without policy injection', () => {
  assert.equal(existsSync(new URL('../src/openCodeTaskPolicy.ts', import.meta.url)), false);
  assert.match(
    cliTextGenerationAdapterSource,
    /startPrompt\(profile\.id, request\.prompt, \{\s*cwd: request\.cwd,?\s*\}\)/s
  );
  assert.doesNotMatch(
    cliTextGenerationAdapterSource,
    /resolveApiProviderRuntime|readOpenCodeConfig|OPENCODE_|capabilities|permission|agentMode|plugin/
  );
  assert.doesNotMatch(
    textGenerationSource,
    /resolveFallbackProviderIds|fallbackFrom|COMMIT_MESSAGE_CAPABILITY_POLICY|capabilities/
  );
});

test('packaged build avoids tokenizer wasm runtime assets', () => {
  assert.doesNotMatch(esbuildScript, /tiktoken/);
  assert.doesNotMatch(esbuildScript, /dist\/tiktoken_bg\.wasm/);
  assert.doesNotMatch(esbuildScript, /copy-runtime-assets/);
  assert.doesNotMatch(vscodeIgnore, /^\s*!\s*dist\/tiktoken_bg\.wasm\s*$/m);
});

test('packaged build excludes internal Git worktrees', () => {
  assert.match(vscodeIgnore, /^\.worktrees\/\*\*\s*$/m);
});
