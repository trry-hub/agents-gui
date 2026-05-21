import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const { buildAssistantPrompt } = require('../.test-dist/promptBuilder.js');
const {
  resolveRuntimeLocale,
  runtimeDefaultActionText,
} = require('../.test-dist/localization.js');
const {
  buildCliOptionArgs,
  getCliProfile,
  getCliModelOption,
  getCliPermissionMode,
  getCliRuntimeMode,
} = require('../.test-dist/cliProfiles.js');
const {
  flushCliOutputBuffer,
  normalizeCliOutput,
  normalizeCliOutputChunk,
} = require('../.test-dist/outputFormatter.js');
const {
  actionRequiresActiveFile,
  actionRequiresSelection,
} = require('../.test-dist/actionGuards.js');
const {
  getLoginShellLookupArgs,
  normalizeCommandPathOutput,
  shellQuote,
} = require('../.test-dist/cliPathResolver.js');
const { getProviderExtensionBridge } = require('../.test-dist/providerExtensions.js');
const {
  parseOpenCodeDebugConfigOutput,
  parseOpenCodeConfigAgents,
  parseOpenCodeAgentListOutput,
  parseOpenCodeModelsOutput,
  parseOpenCodeModelId,
  parseOpenCodeProviderModels,
} = require('../.test-dist/opencodeAgents.js');
const {
  sanitizeApiProviderSettings,
  resolveApiProviderRuntime,
  API_PROVIDER_INHERIT,
} = require('../.test-dist/apiProviders.js');

test('buildAssistantPrompt includes provider agent mode, action, user request, and selected code context', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'codex', name: 'Codex CLI' },
    mode: 'agent',
    agentMode: {
      id: 'plan',
      label: 'Plan',
      instruction: 'Plan without editing files.',
    },
    action: 'explainSelection',
    message: 'What does this do?',
    context: {
      workspace: {
        name: 'agents-gui',
        rootPath: '/repo/agents-gui',
      },
      activeFile: {
        relativePath: 'src/example.ts',
        languageId: 'typescript',
        lineCount: 12,
        text: 'export function add(a: number, b: number) { return a + b; }',
        truncated: false,
      },
      selection: {
        text: 'return a + b;',
        startLine: 1,
        endLine: 1,
        truncated: false,
      },
      diagnostics: [],
    },
  });

  assert.match(prompt, /Mode: Agent/);
  assert.match(prompt, /Provider agent\/mode: Plan \(plan\)/);
  assert.match(prompt, /Plan without editing files/);
  assert.match(prompt, /Action: Explain selected code/);
  assert.match(prompt, /What does this do\?/);
  assert.match(prompt, /src\/example\.ts/);
  assert.match(prompt, /return a \+ b;/);
  assert.match(prompt, /If the request involves code changes, include a compact delivery checklist:/);
  assert.match(prompt, /Files changed: list each file path and the exact change/);
});

test('buildAssistantPrompt requires delivery checklist for OpenCode freeform prompts', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'opencode', name: 'OpenCode' },
    mode: 'agent',
    agentMode: {
      id: 'sisyphus',
      label: 'Sisyphus - Ultraworker',
      instruction: 'Use provider-native behavior.',
    },
    action: 'freeform',
    message: '我想重构这个登录流程。',
    context: {
      workspace: {
        name: 'agents-gui',
        rootPath: '/repo/agents-gui',
      },
      diagnostics: [],
    },
  });

  assert.match(prompt, /Verification: commands or checks that confirm the change is correct/);
  assert.match(prompt, /Risks and caveats: call out assumptions, follow-up work, and edge cases/);
});

test('buildAssistantPrompt tells OpenCode about every folder in a multi-root workspace', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'opencode', name: 'OpenCode' },
    mode: 'agent',
    agentMode: {
      id: 'sisyphus',
      label: 'Sisyphus',
      instruction: 'Use provider-native behavior.',
    },
    action: 'freeform',
    message: '我当前工作区有几个项目？',
    context: {
      workspace: {
        name: 'qxs-factory_vue3 (工作区)',
        rootPath: '/Users/t/6bt/demand/daily-work',
        activeFolderName: 'daily-work',
        activeFolderRootPath: '/Users/t/6bt/demand/daily-work',
        folders: [
          { name: 'qxs-finance-review', rootPath: '/Users/t/6bt/日常优化/qxs-finance-review' },
          { name: 'daily-work', rootPath: '/Users/t/6bt/demand/daily-work', active: true },
          { name: 'ksh-mr', rootPath: '/Users/t/6bt/project/ksh-mr' },
          { name: 'ksh-mr_vue3', rootPath: '/Users/t/6bt/project/ksh-mr_vue3' },
        ],
      },
      activeFile: {
        relativePath: '第四期prd.md',
        languageId: 'markdown',
        lineCount: 24,
        truncated: false,
      },
      diagnostics: [],
    },
  });

  assert.match(prompt, /VS Code multi-root workspace folders:/);
  assert.match(prompt, /qxs-finance-review: \/Users\/t\/6bt\/日常优化\/qxs-finance-review/);
  assert.match(prompt, /daily-work \(active file folder\): \/Users\/t\/6bt\/demand\/daily-work/);
  assert.match(prompt, /ksh-mr_vue3: \/Users\/t\/6bt\/project\/ksh-mr_vue3/);
  assert.match(prompt, /Do not treat the active file folder as the whole VS Code workspace/);
});

test('buildAssistantPrompt gives provider agent mode stronger implementation instructions', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'claude', name: 'Claude Code' },
    mode: 'agent',
    agentMode: {
      id: 'acceptEdits',
      label: 'Accept Edits',
      instruction: 'Allow file edits while surfacing important risks.',
    },
    action: 'reviewFile',
    message: 'Find risky issues.',
    context: {
      workspace: {
        name: 'agents-gui',
        rootPath: '/repo/agents-gui',
      },
      diagnostics: [
        {
          severity: 'Error',
          message: 'Cannot find name Session',
          relativePath: 'src/sidebarProvider.ts',
          line: 20,
        },
      ],
    },
  });

  assert.match(prompt, /Mode: Agent/);
  assert.match(prompt, /Provider agent\/mode: Accept Edits \(acceptEdits\)/);
  assert.match(prompt, /Allow file edits/);
  assert.match(prompt, /Cannot find name Session/);
  assert.match(prompt, /src\/sidebarProvider\.ts:20/);
});

test('review prompt tells the agent not to replace missing file context with a workspace scan', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'codex', name: 'Codex CLI' },
    mode: 'agent',
    agentMode: {
      id: 'review',
      label: 'Review',
      instruction: 'Review only.',
    },
    action: 'reviewFile',
    message: 'Review the current file.',
    context: {
      workspace: {
        name: 'agents-gui',
        rootPath: '/repo/agents-gui',
      },
      diagnostics: [],
    },
  });

  assert.match(prompt, /Do not review the whole workspace when current file context is unavailable/);
});

test('buildAssistantPrompt includes pasted image attachment file paths', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'codex', name: 'Codex CLI' },
    mode: 'agent',
    agentMode: {
      id: 'build',
      label: 'Build',
      instruction: 'Implement changes.',
    },
    action: 'freeform',
    message: 'What is wrong in this screenshot?',
    attachments: [
      {
        kind: 'image',
        name: 'error-screen.png',
        mimeType: 'image/png',
        size: 2048,
        path: '/tmp/agents-gui/error-screen.png',
      },
    ],
    context: {
      diagnostics: [],
    },
  });

  assert.match(prompt, /Attached images:/);
  assert.match(prompt, /error-screen\.png \(image\/png, 2 KB\): \/tmp\/agents-gui\/error-screen\.png/);
  assert.match(prompt, /Use these local image paths when the selected provider can inspect image files/);
});

test('buildAssistantPrompt keeps OpenCode freeform chat raw when no IDE context is attached', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'opencode', name: 'OpenCode' },
    mode: 'agent',
    agentMode: {
      id: 'sisyphus',
      label: 'Sisyphus - Ultraworker',
      instruction: 'Use provider-native behavior.',
    },
    action: 'freeform',
    message: '你能干什么',
    context: {
      diagnostics: [],
    },
  });

  assert.equal(prompt, '你能干什么');
  assert.doesNotMatch(prompt, /You are an AI coding assistant embedded in VS Code/);
  assert.doesNotMatch(prompt, /No IDE context was attached/);
});

test('buildAssistantPrompt gives OpenCode workspace context even without an active editor', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'opencode', name: 'OpenCode' },
    mode: 'agent',
    agentMode: {
      id: 'Sisyphus - Ultraworker',
      label: 'Sisyphus - Ultraworker',
      instruction: 'Use the configured primary agent.',
    },
    action: 'freeform',
    message: '这个项目是什么',
    context: {
      workspace: {
        name: 'agents-gui',
        rootPath: '/Users/t/6bt/myproject/agents-gui',
      },
      diagnostics: [],
    },
  });

  assert.match(prompt, /^这个项目是什么/);
  assert.match(prompt, /IDE context, use only if relevant:/);
  assert.match(prompt, /Workspace: agents-gui/);
  assert.match(prompt, /Workspace root: \/Users\/t\/6bt\/myproject\/agents-gui/);
  assert.doesNotMatch(prompt, /Provider agent\/mode/);
  assert.doesNotMatch(prompt, /No IDE context was attached/);
});

test('buildAssistantPrompt gives OpenCode recent conversation for follow-up questions', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'opencode', name: 'OpenCode' },
    mode: 'agent',
    agentMode: {
      id: 'Sisyphus - Ultraworker',
      label: 'Sisyphus - Ultraworker',
      instruction: 'Use the configured primary agent.',
    },
    action: 'freeform',
    message: '我说的是已经聊过的内容',
    conversationHistory: [
      { role: 'user', text: '我本地装了几个 cli 呢' },
      { role: 'assistant', text: '你本地目前装了 3 个本插件支持的 CLI：gemini、codex、opencode。' },
    ],
    context: {
      diagnostics: [],
    },
  });

  assert.match(prompt, /^我说的是已经聊过的内容/);
  assert.match(prompt, /Recent conversation in this thread:/);
  assert.match(prompt, /User: 我本地装了几个 cli 呢/);
  assert.match(prompt, /Assistant: 你本地目前装了 3 个本插件支持的 CLI/);
  assert.doesNotMatch(prompt, /IDE context, use only if relevant:/);
});

test('buildAssistantPrompt gives OpenCode freeform only compact context when context exists', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'opencode', name: 'OpenCode' },
    mode: 'agent',
    agentMode: {
      id: 'sisyphus',
      label: 'Sisyphus - Ultraworker',
      instruction: 'Use provider-native behavior.',
    },
    action: 'freeform',
    message: '解释一下这里',
    context: {
      workspace: {
        name: 'agents-gui',
        rootPath: '/repo/agents-gui',
      },
      activeFile: {
        relativePath: 'src/example.ts',
        languageId: 'typescript',
        lineCount: 1,
        text: 'export const ok = true;',
        truncated: false,
      },
      diagnostics: [],
    },
  });

  assert.match(prompt, /^解释一下这里/);
  assert.match(prompt, /IDE context, use only if relevant:/);
  assert.match(prompt, /src\/example\.ts/);
  assert.match(prompt, /Do not inspect the project unless the request needs it/);
  assert.doesNotMatch(prompt, /Provider agent\/mode/);
});

test('runtime localization resolves Simplified Chinese editor action text', () => {
  const locale = resolveRuntimeLocale('zh-cn');

  assert.equal(locale, 'zh-CN');
  assert.equal(runtimeDefaultActionText(locale, 'explainSelection'), '解释选中的代码。');
});

test('opencode profile uses run command with prompt as argument', () => {
  const profile = getCliProfile('opencode');

  assert.equal(profile.command, 'opencode');
  assert.deepEqual(profile.promptArgs, ['run', '--format', 'json', '--thinking']);
  assert.deepEqual(profile.backgroundServer?.args, [
    'serve',
    '--hostname',
    '127.0.0.1',
    '--port',
    '{port}',
  ]);
  assert.deepEqual(profile.backgroundServer?.attachArgs, [
    '--attach',
    'http://127.0.0.1:{port}',
  ]);
  assert.equal(profile.backgroundServer?.url, 'http://127.0.0.1:{port}');
  assert.deepEqual(profile.backgroundServer?.portRange, { start: 46100, size: 200 });
  assert.equal(profile.env?.OPENCODE_DB, '{tmp}/agents-gui-opencode-{cwdHash}.db');
  assert.equal(profile.env?.OMO_DISABLE_POSTHOG, '1');
  assert.equal(profile.env?.OMO_SEND_ANONYMOUS_TELEMETRY, '0');
  assert.equal(profile.inputMode, 'argument');
  assert.equal(profile.defaultModel, 'configured');
  assert.equal(profile.defaultAgentMode, 'configured');
  assert.equal(profile.modelOptions.find((option) => option.id === 'default'), undefined);
  assert.equal(profile.agentModes.find((mode) => mode.id === 'default'), undefined);
  assert.equal(profile.agentModes.find((mode) => mode.id === 'configured').args, undefined);
  assert.equal(profile.agentModes.find((mode) => mode.id === 'plan'), undefined);
});

test('opencode agent list output is parsed into provider-native agent modes', () => {
  const modes = parseOpenCodeAgentListOutput(
    [
      'build (subagent)',
      '  [',
      '    {"permission":"*","action":"allow"}',
      '  ]',
      'plan (subagent)',
      '\u200bSisyphus - Ultraworker (primary)',
      'summary (primary)',
      'title (primary)',
      'compaction (primary)',
    ].join('\n')
  );

  assert.deepEqual(
    modes.map((mode) => [mode.id, mode.label, mode.args, mode.disabled]),
    [
      ['\u200bSisyphus - Ultraworker', 'Sisyphus - Ultraworker', ['--agent', '\u200bSisyphus - Ultraworker'], undefined],
    ]
  );
});

test('opencode models output is parsed into provider-native model options', () => {
  const options = parseOpenCodeModelsOutput(
    [
      'opencode/big-pickle',
      'mimo/mimo-v2.5-pro',
      'mimo/mimo-v2.5-pro',
      'not a model line',
    ].join('\n')
  );

  assert.deepEqual(
    options.map((option) => [option.id, option.label, option.summaryLabel, option.args]),
    [
      ['opencode/big-pickle', 'opencode/big-pickle', 'big-pickle', ['--model', 'opencode/big-pickle']],
      ['mimo/mimo-v2.5-pro', 'mimo/mimo-v2.5-pro', 'mimo-v2.5-pro', ['--model', 'mimo/mimo-v2.5-pro']],
    ]
  );
});

test('opencode model ids split into provider and model for server prompts', () => {
  assert.deepEqual(parseOpenCodeModelId('opencode/big-pickle'), {
    providerID: 'opencode',
    modelID: 'big-pickle',
  });
  assert.deepEqual(parseOpenCodeModelId('mimo/mimo-v2.5-pro'), {
    providerID: 'mimo',
    modelID: 'mimo-v2.5-pro',
  });
  assert.equal(parseOpenCodeModelId('default'), undefined);
  assert.equal(parseOpenCodeModelId('custom'), undefined);
});

test('opencode provider payload is parsed into official model options', () => {
  const options = parseOpenCodeProviderModels({
    default: {
      opencode: 'big-pickle',
      mimo: 'mimo-v2.5-pro',
    },
    providers: [
      {
        id: 'opencode',
        name: 'OpenCode Zen',
        models: {
          'big-pickle': { id: 'big-pickle', name: 'Big Pickle' },
          'qwen3.6-plus-free': { id: 'qwen3.6-plus-free', name: 'Qwen3.6 Plus Free' },
        },
      },
      {
        id: 'mimo',
        name: 'Xiaomi MiMo',
        models: {
          'mimo-v2.5-pro': { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro' },
        },
      },
    ],
  });

  assert.deepEqual(
    options.map((option) => [option.id, option.label, option.summaryLabel, option.args]),
    [
      ['opencode/big-pickle', 'Big Pickle', 'big-pickle', ['--model', 'opencode/big-pickle']],
      ['opencode/qwen3.6-plus-free', 'Qwen3.6 Plus Free', 'qwen3.6-plus-free', ['--model', 'opencode/qwen3.6-plus-free']],
      ['mimo/mimo-v2.5-pro', 'MiMo V2.5 Pro', 'mimo-v2.5-pro', ['--model', 'mimo/mimo-v2.5-pro']],
    ]
  );
});

test('opencode server config exposes current primary and custom agents', () => {
  const discovery = parseOpenCodeConfigAgents({
    model: 'opencode/big-pickle',
    default_agent: '\u200bSisyphus - Ultraworker',
    agent: {
      build: { mode: 'subagent', description: 'Implementation helper' },
      plan: { mode: 'subagent' },
      '\u200bSisyphus - Ultraworker': {
        mode: 'primary',
        description: 'Powerful AI orchestrator with a very long description that should be truncated before it reaches the UI title and makes the composer awkward to inspect.',
      },
    },
  });

  assert.equal(discovery.defaultAgentId, '\u200bSisyphus - Ultraworker');
  assert.equal(discovery.defaultModelId, 'opencode/big-pickle');
  assert.deepEqual(
    discovery.modes.map((mode) => [mode.id, mode.label, mode.disabled, mode.args]),
    [
      [
        '\u200bSisyphus - Ultraworker',
        'Sisyphus - Ultraworker',
        undefined,
        ['--agent', '\u200bSisyphus - Ultraworker'],
      ],
    ]
  );
});

test('opencode debug config text exposes default agent without parsing full prompts', () => {
  const discovery = parseOpenCodeDebugConfigOutput(
    [
      '{',
      '  "default_agent": "\\u200bSisyphus - Ultraworker",',
      '  "agent": {',
      '    "build": {',
      '      "description": "Implementation helper",',
      '      "mode": "subagent",',
      '      "prompt": "very long text with { braces }"',
      '    },',
      '    "\\u200bSisyphus - Ultraworker": {',
      '      "description": "Powerful AI orchestrator",',
      '      "mode": "primary",',
      '      "model": "mimo/mimo-v2.5-pro",',
      '      "prompt": "unfinished long prompt',
      '    }',
      '  }',
      '}',
    ].join('\n')
  );

  assert.equal(discovery.defaultAgentId, '\u200bSisyphus - Ultraworker');
  assert.equal(discovery.defaultModelId, 'mimo/mimo-v2.5-pro');
  assert.deepEqual(
    discovery.modes.map((mode) => [mode.id, mode.disabled, mode.args]),
    [
      ['\u200bSisyphus - Ultraworker', undefined, ['--agent', '\u200bSisyphus - Ultraworker']],
    ]
  );
});

test('cli manager warms and attaches background CLI servers when available', () => {
  const source = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(source, /getOpenCodeAgentModes/);
  assert.match(source, /\['debug', 'config'\]/);
  assert.match(source, /opencode-agent-list/);
  assert.match(source, /getOpenCodeModelOptions/);
  assert.match(source, /getOpenCodeModelOptionsFromServer/);
  assert.match(source, /openCodeApiUrl\(serverUrl, '\/config\/providers', cwd\)/);
  assert.match(source, /parseOpenCodeProviderModels\(payload\)/);
  assert.match(source, /\['models'\]/);
  assert.match(source, /opencode-models/);
  assert.match(source, /preferredOpenCodeDefaultModel/);
  assert.match(source, /option\.id !== 'default' && option\.id !== 'configured'/);
  assert.match(source, /private backgroundServers = new Map/);
  assert.match(source, /attachBackgroundServer\?: boolean/);
  assert.match(
    source,
    /const backgroundAttachArgs = options\.attachBackgroundServer === false\s*\?\s*\[\]\s*:\s*await this\.getBackgroundAttachArgs/s
  );
  assert.match(
    source,
    /const eventStreamUrl = options\.attachBackgroundServer === false\s*\?\s*undefined\s*:\s*this\.getOpenCodeEventStreamUrl/s
  );
  assert.match(
    source,
    /\[\.\.\.profile\.promptArgs,\s*\.\.\.backgroundAttachArgs,\s*\.\.\.agentArgs,\s*initialInput\]/s
  );
  assert.match(source, /resolveBackgroundServerCandidates/);
  assert.match(source, /expandBackgroundServerArg/);
  assert.match(source, /expandProfileEnv/);
  assert.match(source, /os\.tmpdir\(\)/);
  assert.match(source, /getOpenCodeEventStreamUrl/);
  assert.match(source, /openOpenCodeEventStream/);
  assert.match(source, /new URL\('\/event', serverUrl\)/);
  assert.match(source, /new URL\('\/mcp', serverUrl\)/);
  assert.match(source, /normalizeOpenCodeMcpStatus/);
  assert.match(source, /const renderStateBySession = new Map/);
  assert.match(source, /const pendingBySession = new Map<string, string\[\]>\(\)/);
  assert.match(source, /renderStateForSession\(blockSessionId\)/);
  assert.match(source, /eventStream\?\.setSessionId\(detectedOpenCodeSessionId\)/);
  assert.match(source, /message\.part\.updated/);
  assert.match(source, /message\.part\.delta/);
  assert.match(source, /line\.startsWith\('event:'\)/);
  assert.match(source, /partTypes\.set\(partId, partType\)/);
  assert.match(source, /renderOpenCodeUpdatedTextDelta/);
  assert.match(source, /firstObject\(properties\.part,\s*event\.part\)/);
  assert.match(source, /pickString\(properties\.partID,\s*event\.partID/);
  assert.match(source, /pickString\(properties\.delta,\s*event\.delta/);
  assert.match(source, /partType === 'tool'/);
  assert.match(source, /field !== 'text'/);
  assert.match(source, /eventStream\?\.hasOutput\(\)/);
  assert.match(source, /type === 'error'/);
  assert.match(source, /sessionId\(\): string \| undefined/);
  assert.match(source, /extractOpenCodeSessionIdFromSseBlock/);
  assert.match(source, /extractOpenCodeSessionIdFromJsonText/);
  assert.match(source, /const detectedOpenCodeSessionId = this\.extractOpenCodeSessionIdFromJsonText/);
  assert.match(source, /session\.openCodeSessionId = detectedOpenCodeSessionId/);
  assert.match(source, /executeOpenCodeNativeCommand/);
  assert.match(source, /openCodeSessionUrl\(serverUrl,\s*sessionId,\s*'\/share'\)/);
  assert.match(source, /method: 'DELETE'/);
  assert.match(source, /openCodeSessionUrl\(serverUrl,\s*sessionId,\s*'\/summarize'\)/);
  assert.match(source, /openCodeSessionUrl\(serverUrl,\s*sessionId,\s*'\/revert'\)/);
  assert.match(source, /openCodeSessionUrl\(serverUrl,\s*sessionId,\s*'\/unrevert'\)/);
  assert.match(source, /backgroundServerPorts/);
  assert.match(source, /ownedProcess && await this\.waitForTcp/);
  assert.match(source, /!ownedProcess && await this\.waitForTcp/);
  assert.match(source, /continue;/);
  assert.match(source, /stableHash\(`\$\{profileId\}:\$\{cwd\}`\)/);
  assert.match(source, /private async waitForTcp/);
  assert.match(source, /private stopBackgroundServers/);
  assert.match(sidebarSource, /const newSession = await this\.cliManager\.startPrompt/);
  assert.match(sidebarSource, /openCodeSessionId: session\.openCodeSessionId \?\? session\.eventStream\?\.sessionId\(\)/);
  assert.match(sidebarSource, /case 'openCodeNativeCommand':/);
  assert.match(sidebarSource, /this\.cliManager\.executeOpenCodeNativeCommand/);
  assert.match(sidebarSource, /command: 'openCodeNativeCommandResult'/);
  assert.match(sidebarSource, /this\.cliManager\.stopAll\(\);/);
});

test('headless stdin prompts close stdin unless a profile opts into a persistent session', () => {
  const managerSource = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(
    managerSource,
    /sendInput\(sessionId:\s*string,\s*text:\s*string,\s*closeAfterWrite = false\)/
  );
  assert.match(managerSource, /session\.process\.stdin\.end\(\);/);
  assert.match(sidebarSource, /session\.profile\.keepStdinOpen === true/);
  assert.match(sidebarSource, /sendInput\(session\.id,\s*prompt,\s*!profile\.keepStdinOpen\)/);
});

test('codex profile passes prompt as argument and disables color output', () => {
  const profile = getCliProfile('codex');

  assert.equal(profile.command, 'codex');
  assert.deepEqual(profile.promptArgs, ['-a', 'never', 'exec', '--color', 'never', '--ephemeral']);
  assert.equal(profile.inputMode, 'argument');
  assert.equal(profile.defaultAgentMode, 'build');
  assert.equal(profile.agentModes.find((mode) => mode.id === 'build').args, undefined);
  assert.equal(profile.agentModes.find((mode) => mode.id === 'plan').args, undefined);
  assert.deepEqual(profile.modelOptions.find((mode) => mode.id === 'gpt-5.5').args, ['--model', 'gpt-5.5']);
  assert.equal(profile.defaultPermissionMode, 'workspaceWrite');
  assert.deepEqual(profile.permissionModes.find((mode) => mode.id === 'readOnly').args, [
    '--sandbox',
    'read-only',
  ]);
  assert.deepEqual(profile.permissionModes.find((mode) => mode.id === 'workspaceWrite').args, [
    '--sandbox',
    'workspace-write',
  ]);
  assert.deepEqual(profile.permissionModes.find((mode) => mode.id === 'fullAuto').args, ['--full-auto']);
  assert.equal(profile.permissionModes.find((mode) => mode.id === 'danger').dangerous, true);
});

test('claude profile exposes native permission modes', () => {
  const profile = getCliProfile('claude');

  assert.equal(profile.inputMode, 'argument');
  assert.deepEqual(profile.promptArgs, [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
  ]);
  assert.deepEqual(profile.permissionModes.find((mode) => mode.id === 'plan').args, [
    '--permission-mode',
    'plan',
  ]);
  assert.ok(profile.permissionModes.some((mode) => mode.id === 'acceptEdits'));
  assert.equal(profile.agentModes.find((mode) => mode.id === 'plan').args, undefined);
});

test('gemini profile passes prompt as the -p argument for headless mode', () => {
  const profile = getCliProfile('gemini');

  assert.equal(profile.command, 'gemini');
  assert.deepEqual(profile.promptArgs, ['-p']);
  assert.equal(profile.inputMode, 'argument');
});

test('CLI profiles expose provider model, runtime, and permission option args', () => {
  const codex = getCliProfile('codex');

  assert.equal(codex.defaultModel, 'gpt-5.4');
  assert.equal(codex.modelOptions.find((option) => option.id === 'default'), undefined);
  assert.equal(codex.customModelArgPrefix.join(' '), '--model');
  assert.deepEqual(getCliModelOption(codex, 'gpt-5.4').args, ['--model', 'gpt-5.4']);
  assert.deepEqual(getCliModelOption(codex, 'custom').args, undefined);
  assert.equal(codex.defaultRuntime, 'localProcessing');
  assert.equal(getCliRuntimeMode(codex, 'localProcessing').summaryLabel, 'Local mode');
  assert.equal(getCliRuntimeMode(codex, 'sendCloud').id, 'localProcessing');
  assert.equal(codex.runtimeModes.find((mode) => mode.id === 'codexWeb').external, true);
  assert.equal(codex.runtimeModes.find((mode) => mode.id === 'sendCloud').disabled, true);
  assert.equal(codex.runtimeModes.find((mode) => mode.id === 'quota').actionOnly, true);
  assert.deepEqual(getCliPermissionMode(codex, 'readOnly').args, ['--sandbox', 'read-only']);
  assert.deepEqual(
    buildCliOptionArgs(codex, {
      model: 'gpt-5.4',
      runtime: 'localProcessing',
      permissionMode: 'workspaceWrite',
    }),
    ['--model', 'gpt-5.4', '--sandbox', 'workspace-write']
  );
  assert.deepEqual(
    buildCliOptionArgs(codex, {
      model: 'custom',
      customModel: 'qwen2.5-coder:14b',
      runtime: 'sendCloud',
      permissionMode: 'readOnly',
    }),
    ['--model', 'qwen2.5-coder:14b', '--sandbox', 'read-only']
  );
});

test('CLI profiles expose task routing scores for agent recommendations', () => {
  assert.ok(getCliProfile('codex').taskRouting.implementation >= 6);
  assert.ok(getCliProfile('codex').taskRouting.review >= 6);
  assert.ok(getCliProfile('claude').taskRouting.planning >= 6);
  assert.ok(getCliProfile('claude').taskRouting.refactor >= 6);
  assert.ok(getCliProfile('aider').taskRouting.tests >= 5);
  assert.equal(getCliProfile('gemini').taskRouting.explain, 5);
});

test('CLI lookup can use interactive login zsh so nvm-installed tools are visible', () => {
  assert.deepEqual(getLoginShellLookupArgs('codex', '/bin/zsh'), [
    '-lic',
    "command -v 'codex'",
  ]);
});

test('CLI path resolver keeps the first absolute command path from shell output', () => {
  assert.equal(
    normalizeCommandPathOutput('nvm startup noise\n/Users/t/.nvm/versions/node/v24.15.0/bin/codex\n'),
    '/Users/t/.nvm/versions/node/v24.15.0/bin/codex'
  );
  assert.equal(shellQuote("bad'name"), "'bad'\\''name'");
});

test('CLI manager revalidates cached command paths before spawning', () => {
  const source = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');

  assert.match(source, /const command = await this\.resolveCommandPath\(profile\.command\) \?\? profile\.command/);
  assert.doesNotMatch(source, /this\.commandPathCache\.get\(profile\.command\) \?\? profile\.command/);
});

test('CLI manager evicts stale command path cache entries', () => {
  const source = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');

  assert.match(source, /private async isUsableCommandPath/);
  assert.match(source, /fs\.promises\.access\(commandPath, fs\.constants\.X_OK\)/);
  assert.match(source, /this\.commandPathCache\.delete\(command\)/);
  assert.match(source, /err\.code === 'ENOENT'/);
  assert.match(source, /this\.commandPathCache\.delete\(profile\.command\)/);
});

test('CLI profiles include detected agent version status', () => {
  const profilesSource = readFileSync(new URL('../src/cliProfiles.ts', import.meta.url), 'utf8');
  const managerSource = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');

  assert.match(profilesSource, /versionArgs\?: string\[\]/);
  assert.match(profilesSource, /version\?: string/);
  assert.match(profilesSource, /contextWindowTokens\?: number/);
  assert.match(profilesSource, /autoCompactsContext\?: boolean/);
  assert.match(profilesSource, /tokenizer\?: CliTokenizerConfig/);
  assert.match(profilesSource, /modelOptions\?: CliModelOption\[\]/);
  assert.match(profilesSource, /runtimeModes\?: CliRuntimeMode\[\]/);
  assert.match(profilesSource, /permissionModes\?: CliPermissionMode\[\]/);
  assert.match(profilesSource, /provider: 'openai'/);
  assert.match(profilesSource, /provider: 'anthropic'/);
  assert.match(managerSource, /version: installed \? await this\.getCommandVersion\(p\) : undefined/);
  assert.match(managerSource, /private getCommandVersion\(profile: CliProfile\)/);
  assert.match(managerSource, /profile\.versionArgs \?\? \['--version'\]/);
  assert.match(managerSource, /normalizeCommandVersionOutput/);
});

test('context summary carries provider-specific token usage without fallback estimates', () => {
  const typesSource = readFileSync(new URL('../src/assistantTypes.ts', import.meta.url), 'utf8');
  const collectorSource = readFileSync(new URL('../src/contextCollector.ts', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const counterSource = readFileSync(new URL('../src/tokenCounter.ts', import.meta.url), 'utf8');

  assert.match(typesSource, /tokenUsage\?: AssistantTokenUsage/);
  assert.doesNotMatch(collectorSource, /estimateContextTokens/);
  assert.match(sidebarSource, /tokenUsage: countContextTokens\(snapshot, profile, modelId\)/);
  assert.match(counterSource, /encodingForModel|getEncoding/);
  assert.match(counterSource, /countAnthropicTokens/);
  assert.match(counterSource, /precision: 'exact'/);
  assert.match(counterSource, /precision: 'unavailable'/);
  assert.doesNotMatch(counterSource, /Math\.ceil\(characters \/ 4\)/);
});

test('extension contributes reload window command for debugging', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const commands = manifest.contributes.commands.map((command) => command.command);

  assert.ok(manifest.activationEvents.includes('onCommand:agents-gui.reloadWindow'));
  assert.ok(commands.includes('agents-gui.reloadWindow'));
});

test('extension defaults to OpenCode as the active provider', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const extensionSource = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const syncedStateSource = readFileSync(new URL('../src/syncedState.ts', import.meta.url), 'utf8');
  const previewSource = readFileSync(new URL('../scripts/preview-webview.mjs', import.meta.url), 'utf8');
  const defaultProvider = manifest.contributes.configuration.properties['agents-gui.defaultProvider'];

  assert.equal(defaultProvider.default, 'opencode');
  assert.ok(defaultProvider.enum.includes('opencode'));
  assert.match(sidebarSource, /const DEFAULT_CLI_ID = 'opencode';/);
  assert.match(sidebarSource, /get<string>\('defaultProvider', DEFAULT_CLI_ID\)/);
  assert.match(sidebarSource, /getCliProfile\(DEFAULT_CLI_ID\)\?\.id/);
  assert.match(previewSource, /defaultProviderId: 'opencode'/);
  assert.match(extensionSource, /state:\s*context\.globalState/);
  assert.match(syncedStateSource, /LAST_PROVIDER_STATE_KEY = 'agents-gui\.lastProviderId'/);
  assert.match(syncedStateSource, /AGENT_MODE_STATE_KEY = 'agents-gui\.agentModeByProvider'/);
  assert.match(sidebarSource, /LAST_PROVIDER_STATE_KEY,\n/);
  assert.match(sidebarSource, /AGENT_MODE_STATE_KEY,\n/);
  assert.match(sidebarSource, /const storedProviderId = this\.getStoredProviderId\(profiles\)/);
  assert.match(sidebarSource, /activeProviderId: storedProviderId/);
  assert.match(sidebarSource, /activeAgentModeByProvider: this\.getStoredAgentModeState\(\)/);
});

test('workspace debug config starts the extension host with the watch task', () => {
  const launch = JSON.parse(readFileSync(new URL('../.vscode/launch.json', import.meta.url), 'utf8'));
  const tasks = JSON.parse(readFileSync(new URL('../.vscode/tasks.json', import.meta.url), 'utf8'));
  const configuration = launch.configurations.find(
    (item) => item.type === 'extensionHost' && item.request === 'launch'
  );
  const watchTask = tasks.tasks.find((item) => item.label === 'npm: watch');

  assert.ok(configuration);
  assert.equal(configuration.preLaunchTask, 'npm: watch');
  assert.deepEqual(configuration.args, [
    '--extensionDevelopmentPath=${workspaceFolder}',
  ]);
  assert.ok(watchTask);
  assert.equal(watchTask.script, 'watch');
  assert.equal(watchTask.isBackground, true);
  assert.equal(watchTask.problemMatcher.background.endsPattern, 'Watching for changes...');
});

test('product document positions Agents GUI beyond a provider launcher', () => {
  const doc = readFileSync(new URL('../docs/product/agents-workbench.md', import.meta.url), 'utf8');

  assert.match(doc, /multi-agent workbench/i);
  assert.match(doc, /multi-task/i);
  assert.match(doc, /visual task/i);
  assert.match(doc, /not compete with Copilot on inline completion/i);
  assert.match(doc, /Task-aware routing/);
  assert.match(doc, /Immediate Development Priorities/);
});

test('development mode watches webview assets for live reload', () => {
  const extensionSource = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(extensionSource, /extensionMode:\s*context\.extensionMode/);
  assert.match(sidebarSource, /vscode\.ExtensionMode\.Development/);
  assert.match(sidebarSource, /createFileSystemWatcher/);
  assert.match(sidebarSource, /media\/\{main\.html,main\.css,main\.js,i18n\.js\}/);
  assert.match(sidebarSource, /webviewAssetVersion/);
  assert.match(sidebarSource, /reloadWebviewForDevelopment/);
});

test('webview CSP is strict enough for VS Code webview diagnostics', () => {
  const source = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(source, /default-src 'none'/);
  assert.match(source, /style-src \$\{webview\.cspSource\};/);
  assert.match(source, /script-src \$\{webview\.cspSource\} 'nonce-\$\{nonce\}'/);
  assert.doesNotMatch(source, /'unsafe-inline'/);
});

test('webview avoids a duplicate internal title and uses icon-only action buttons', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /data-i18n="app\.title"/);
  assert.match(html, /<link rel="icon" href="data:,"/);
  assert.match(html, /data-i18n-aria="toolbar\.actions"/);
  assert.match(html, /<svg viewBox="0 0 16 16"/);
});

test('webview uses provider-native mode control and keeps task routing internal', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');

  assert.match(html, /id="modelSelect"/);
  assert.match(html, /id="runtimeSelect"/);
  assert.match(html, /id="permissionSelect"/);
  assert.match(html, /id="customModelInput"/);
  assert.match(html, /class="mode-menu"/);
  assert.match(html, /class="mode-popover option-popover-single"/);
  assert.match(html, /id="agentModeSummaryLabel"/);
  assert.match(html, /class="select-field agent-select native-option-field"/);
  assert.match(html, /id="agentModeSelect"/);
  assert.match(html, /id="agentModeOptionList"/);
  assert.match(html, /id="actionSelect"[^>]*hidden/);
  assert.doesNotMatch(html, /class="advanced-menu"/);
  assert.doesNotMatch(html, /data-i18n="advanced\.short"/);
});

test('webview keeps local remote runtime outside the prompt input shell', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const promptShellStart = html.indexOf('<div class="prompt-shell">');
  const composerRuntimeStart = html.indexOf('<div class="composer-runtime"');

  assert.ok(promptShellStart >= 0);
  assert.ok(composerRuntimeStart > promptShellStart);
  assert.doesNotMatch(html.slice(promptShellStart, composerRuntimeStart), /runtimeSelect|runtime-menu/);
  assert.match(html.slice(composerRuntimeStart), /class="option-menu runtime-menu"/);
  assert.match(css, /\.composer-runtime\s*\{\s*[^}]*display:\s*flex;/s);
  assert.match(css, /\.composer-runtime \.runtime-menu\.is-visible\s*\{\s*[^}]*display:\s*block;/s);
});

test('webview omits the composer advanced toggle but keeps provider setup actions', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');
  const extensionSource = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /id="composerAdvancedToggle"/);
  assert.doesNotMatch(html, /class="advanced-toggle"/);
  assert.doesNotMatch(script, /composerAdvancedVisible|composerAdvancedToggle|setComposerAdvancedVisible|applyComposerAdvancedState|composerShell\.dataset\.advanced/);
  assert.doesNotMatch(css, /\.advanced-toggle|data-advanced/);
  assert.doesNotMatch(i18nScript, /composer\.advanced|advancedHide/);
  assert.match(css, /\.suggestion-button--primary\s*\{/s);

  assert.match(script, /appendEmptyState\(titleText, subtitleText, showSetupAction = false,\s*installHint\)/);
  assert.match(script, /function providerUnavailableMessage\(profile\)/);
  assert.match(script, /const firstInstallHintProfile = profiles\.find\(\(profile\) => profile\?\.installHint && !profile\.installed\);/);
  assert.match(script, /const suggestionActions = showSetupAction\s*\?\s*\[\['openSettings', 'empty\.configureProviders'\]\]\s*:/);
  assert.match(script, /if \(showSetupAction && installHint\) \{\s*suggestionActions\.push\(\['copyInstall', 'empty\.copyInstall'\]\);\s*\}/);
  assert.match(script, /'openSettings'/);
  assert.match(script, /'copyInstall'/);
  assert.match(script, /button\.classList\.add\('suggestion-button--primary'\)/);
  assert.match(sidebarSource, /case 'openSettings':/);
  assert.match(sidebarSource, /case 'copyInstallCommand':/);
  assert.match(extensionSource, /agents-gui\.openSettings/);
  assert.match(i18nScript, /'empty\.configureProviders': 'Open provider settings'/);
  assert.match(i18nScript, /'empty\.configureProviders': '前往设置配置提供方'/);
  assert.match(i18nScript, /'empty\.copyInstall': 'Copy install command'/);
  assert.match(i18nScript, /'empty\.copyInstall': '复制安装命令'/);
  assert.match(i18nScript, /'provider\.unavailableWithHint': 'Provider is not installed\. Install one first \(for example: \{hint\}\), then refresh\.'/);
  assert.match(i18nScript, /'provider\.unavailableWithHint': '该提供方尚未安装。请先安装一个提供方（例如：\{hint\}），然后刷新。'/);
  assert.match(script, /providerUnavailableMessage\(profile\)/);
  assert.match(script, /providerUnavailableMessage\(profile \|\| providerId\)/);
});

test('webview renders the Codex local mode menu like Code X', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(html, /id="runtimeOptionList"[^>]*role="menu"/);
  assert.match(script, /const runtimeOptionList = document\.getElementById\('runtimeOptionList'\);/);
  assert.match(script, /function renderRuntimeOptionList\(options, selectedId\)/);
  assert.match(script, /runtimeMenu\?\.classList\.toggle\('is-danger', Boolean\(runtime\?\.dangerous\)\);/);
  assert.match(script, /i18n\.t\('runtime\.continue'\)/);
  assert.match(script, /displayRuntime\.summaryLabel \|\| displayRuntime\.label/);
  assert.match(script, /function selectableOption\(option\)/);
  assert.match(script, /return !option\?\.disabled && !option\?\.actionOnly;/);
  assert.match(css, /\.runtime-option-list\s*\{/);
  assert.match(css, /\.runtime-option-list \.option-list-item\s*\{/);
  assert.match(css, /\.option-list-item-trailing\s*\{/);
  assert.match(css, /\.runtime-menu\.is-danger \.option-summary/);
  assert.match(css, /body\[data-provider="codex"\] \.runtime-menu\.is-danger \.option-summary/);
  assert.match(i18nScript, /'runtime\.continue': '继续使用'/);
  assert.match(i18nScript, /'option\.runtime\.localProcessing': '在本地处理'/);
  assert.match(i18nScript, /'option\.runtime\.localProcessing\.summary': '本地模式'/);
  assert.match(i18nScript, /'option\.runtime\.codexWeb': '关联 Codex web'/);
  assert.match(i18nScript, /'option\.runtime\.sendCloud': '发送至云端'/);
  assert.match(i18nScript, /'option\.runtime\.quota': '剩余额度'/);
  assert.doesNotMatch(i18nScript, /localOllama|localLmStudio/);
});

test('webview renders model selection as a single-layer menu', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(html, /class="select-field agent-select native-option-field"[\s\S]*id="modelSelect"/);
  assert.match(html, /id="modelOptionList"[^>]*role="menu"/);
  assert.match(script, /const modelOptionList = document\.getElementById\('modelOptionList'\);/);
  assert.match(script, /function renderModelOptionList\(options, selectedId\)/);
  assert.match(script, /function renderAgentModeOptionList\(modes, selectedId\)/);
  assert.match(script, /'model-option-item'/);
  assert.match(script, /'mode-option-item'/);
  assert.match(script, /check\.className = 'model-option-check';/);
  assert.match(script, /renderModelOptionList\(options, model\.id\);/);
  assert.match(script, /renderAgentModeOptionList\(modes, agentModeSelect\.value\);/);
  assert.match(script, /modelOptionList\?\.addEventListener\('click'/);
  assert.match(script, /agentModeOptionList\?\.addEventListener\('click'/);
  assert.match(script, /activeModelByProvider\[activeId\] = button\.dataset\.value;/);
  assert.match(script, /activeAgentModeByProvider\[activeId\] = button\.dataset\.value;/);
  assert.match(script, /modelMenu\.open = false;/);
  assert.match(script, /modeMenu\.open = false;/);
  assert.match(script, /if \(option\?\.custom\) \{/);
  assert.match(css, /\.model-option-list\s*\{/);
  assert.match(html, /id="agentModeOptionList"[^>]*role="menu"/);
  assert.match(css, /\.mode-option-list\s*\{/);
  assert.match(css, /\.model-option-list \.option-list-item\s*\{/);
  assert.match(css, /\.mode-option-list \.option-list-item\s*\{/);
  assert.match(css, /\.model-option-list \.option-list-item::before\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /\.mode-option-list \.option-list-item::before\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /\.model-option-list \.option-list-item:hover,\s*\.model-option-list \.option-list-item:focus-visible\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--assistant-hover\) 72%, transparent\);/s);
  assert.match(css, /\.mode-option-list \.option-list-item:hover,\s*\.mode-option-list \.option-list-item:focus-visible\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--assistant-hover\) 72%, transparent\);/s);
  assert.match(css, /\.model-option-item\.is-selected \.model-option-check\s*\{/);
  assert.match(css, /\.mode-option-item\.is-selected \.mode-option-marker\s*\{/);
  assert.match(css, /\.model-menu \.custom-model-field\s*\{/);
});

test('webview composer follows the selected provider identity', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(script, /document\.body\.dataset\.provider = activeId \|\| 'none';/);
  assert.match(script, /const sidebar = document\.getElementById\('sidebar'\);/);
  assert.match(script, /function renderOpenCodeSidebar\(\)/);
  assert.match(script, /sidebar\.hidden = profile\?\.id !== 'opencode';/);
  assert.match(script, /appendOpenCodeBlock\(shell, 'Context', openCodeContextMetrics\(profile\), \{ key: 'context' \}\)/);
  assert.match(script, /appendOpenCodeBlock\(shell, 'MCP', openCodeMcpLines\(\), \{/);
  assert.match(script, /action: \(\) => showOpenCodeStatusDialog\('mcp'\)/);
  assert.match(script, /appendOpenCodeBlock\(shell, 'LSP', openCodeLspLines\(\), \{/);
  assert.match(script, /LSPs auto-detected from file types/);
  assert.match(script, /openCodeWorkspaceFooter\(\)/);
  assert.match(script, /function openCodeMcpLines\(\)/);
  assert.match(script, /function openCodeLspLines\(\)/);
  assert.match(script, /function renderOpenCodeStatusDialog\(\)/);
  assert.match(script, /function splitAgentModeLabel\(/);
  assert.match(script, /profile\?\.id === 'opencode'\s*\?\s*splitAgentModeLabel\(displayMode\?\.label \|\| i18n\.t\('agentMode\.short'\)\)\.title/s);
  assert.match(script, /meta\.textContent = profile\?\.id === 'opencode'/);
  assert.match(script, /displayModel\.summaryLabel \|\| displayModel\.label \|\| i18n\.t\('model\.short'\)/);
  assert.match(script, /selectedAction === 'freeform' \? 'input\.placeholderProvider' : 'input\.placeholderAction'/);
  assert.match(i18nScript, /'input\.placeholderProvider': 'Ask \{provider\}…'/);
  assert.match(i18nScript, /'input\.placeholderProvider': '向 \{provider\} 发送任务\.\.\.'/);
  assert.match(css, /\.main-content\s*\{\s*[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
  assert.match(css, /\.sidebar\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.main-content\s*\{\s*[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) 340px;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.sidebar\s*\{\s*[^}]*display:\s*flex;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.opencode-sidebar-session-title\s*\{/);
  assert.match(css, /body\[data-provider="opencode"\] \.opencode-sidebar-heading\.is-toggle\s*\{/);
  assert.match(css, /body\[data-provider="opencode"\] \.opencode-sidebar-footer\s*\{/);
  assert.match(css, /body\[data-provider="codex"\] \.mode-summary/);
  assert.match(css, /body\[data-provider="opencode"\] \.prompt-shell/);
  assert.match(css, /body\[data-provider="opencode"\] \.composer\s*\{\s*[^}]*padding:\s*5px 8px;/s);
  assert.match(css, /body\[data-provider="opencode"\] textarea\s*\{\s*[^}]*min-height:\s*38px;/s);
  assert.match(css, /body\[data-provider="opencode"\] textarea\s*\{\s*[^}]*padding:\s*6px 8px 2px;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.model-menu\.is-visible,\s*body\[data-provider="opencode"\] \.mode-menu\.is-visible/s);
  assert.match(css, /body\[data-provider="opencode"\] \.model-menu \.option-summary::before\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(html, /class="context-row"[\s\S]*class="context-menu"/);
  assert.match(html, /<aside class="sidebar" id="sidebar"/);
  assert.match(i18nScript, /'sidebar\.mcp': 'MCP'/);
  assert.match(i18nScript, /'sidebar\.lsp': 'LSP'/);
  assert.match(html, /id="composerSettingsBtn"/);
  assert.match(script, /const composerSettingsBtn = document\.getElementById\('composerSettingsBtn'\)/);
  assert.match(script, /composerSettingsBtn\?\.addEventListener\('click'/);
  assert.match(script, /profile\?\.id === 'opencode' \|\| modes\.length > 1/);
  assert.match(css, /body\[data-provider="opencode"\] \.context-row\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.context-row\s*\{\s*[^}]*padding:\s*0;/s);
  assert.match(css, /body\[data-provider="opencode"\] #contextSummaryLabel\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.mode-menu\.is-visible\s*\{\s*[^}]*order:\s*2;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.model-menu\.is-visible\s*\{\s*[^}]*order:\s*3;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.composer-settings-button\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.composer-meta\s*\{\s*[^}]*order:\s*4;/s);
  assert.match(css, /body\[data-provider="opencode"\] #contextBudgetLabel\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.model-menu\.is-visible\s*\{\s*[^}]*flex:\s*0 1 auto;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.mode-menu\.is-visible\s*\{\s*[^}]*max-width:\s*104px;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.mode-summary,\s*body\[data-provider="opencode"\] \.option-summary,\s*body\[data-provider="opencode"\] \.context-summary\s*\{[^}]*border:\s*1px solid transparent;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.mode-summary,\s*body\[data-provider="opencode"\] \.option-summary,\s*body\[data-provider="opencode"\] \.context-summary\s*\{[^}]*background:\s*transparent;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.context-summary \.chip-prefix\s*\{\s*[^}]*width:\s*14px;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.context-summary \.chip-prefix\s*\{\s*[^}]*border:\s*2\.25px solid color-mix\(in srgb, var\(--assistant-muted\) 54%, transparent\);/s);
  assert.doesNotMatch(css, /body\[data-provider="opencode"\] \.prompt-actions\s*\{[^}]*border-top:/s);
  assert.match(css, /body\[data-provider="opencode"\] \.prompt-actions\s*\{\s*[^}]*min-height:\s*28px;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.prompt-actions\s*\{\s*[^}]*padding:\s*1px 6px 5px;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.attach-button::after\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.option-summary::after,\s*body\[data-provider="opencode"\] \.mode-summary::after\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.mode-option-list \.option-list-item\s*\{\s*[^}]*grid-template-columns:\s*10px minmax\(0,\s*1fr\);/s);
  assert.match(css, /body\[data-provider="opencode"\] \.mode-option-meta\s*\{\s*[^}]*color:\s*var\(--assistant-muted\);/s);
  assert.match(css, /body\[data-provider="opencode"\] \.send-button\s*\{[^}]*var\(--assistant-accent, #a855f7\)/s);
  assert.match(css, /body\[data-provider="opencode"\] \.send-button:disabled\s*\{[^}]*opacity:\s*1;/s);
  assert.match(css, /body\[data-provider="opencode"\] \.send-button:disabled svg\s*\{[^}]*stroke-width:\s*2;/s);
});

test('opencode sidebar collapses by default at compact widths', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /@media \(max-width:\s*900px\)\s*\{[\s\S]*?body\[data-provider="opencode"\] \.main-content\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);[\s\S]*?border-right:\s*0;/s);
  assert.match(css, /@media \(max-width:\s*900px\)\s*\{[\s\S]*?body\[data-provider="opencode"\] \.sidebar\s*\{[\s\S]*?display:\s*none;/s);
});

test('opencode MCP sidebar retries while server status is warming up', () => {
  const typesSource = readFileSync(new URL('../src/assistantTypes.ts', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(typesSource, /mcpStatusPending\?: boolean;/);
  assert.match(sidebarSource, /OPENCODE_STATUS_REFRESH_DELAYS_MS/);
  assert.match(sidebarSource, /openCodeStatusRefreshTimers = new Map/);
  assert.match(sidebarSource, /openCodeStatusRefreshAttempts = new Map/);
  assert.match(sidebarSource, /const mcpStatusPending = this\.shouldRetryOpenCodeStatus\(profile\?\.id, openCodeStatus\)/);
  assert.match(sidebarSource, /mcpStatusPending,/);
  assert.match(sidebarSource, /this\.scheduleOpenCodeStatusRefresh\(profile\?\.id, openCodeStatus, contextOptions, modelId\)/);
  assert.match(sidebarSource, /private scheduleOpenCodeStatusRefresh/);
  assert.match(sidebarSource, /this\.sendContextSummary\(contextOptions, 'opencode', modelId\)/);
  assert.match(sidebarSource, /private clearOpenCodeStatusRefreshTimers/);
  assert.match(script, /contextSummary\?\.mcpStatusPending/);
  assert.match(script, /i18n\.t\('opencode\.dialog\.mcp\.loading'\)/);
  assert.match(script, /i18n\.t\('opencode\.dialog\.mcp\.unavailable'\)/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.loading': 'Loading MCPs\.\.\.'/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.unavailable': 'MCP status unavailable'/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.loading': '正在加载 MCP\.\.\.'/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.unavailable': 'MCP 状态不可用'/);
});

test('webview renders OpenCode thinking as a separate assistant detail block', () => {
  const formatterSource = readFileSync(new URL('../src/outputFormatter.ts', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(formatterSource, /thinking\?: string;/);
  assert.match(sidebarSource, /thinking: normalized\.thinking/);
  assert.match(sidebarSource, /status: normalized\.status/);
  assert.match(sidebarSource, /activities: normalized\.activities/);
  assert.match(script, /function mergeStreamText\(current, chunk\)/);
  assert.match(script, /incoming\.startsWith\(existing\)/);
  assert.match(script, /existing\.endsWith\(incoming\) && incoming\.length > 32/);
  assert.match(script, /function updateStreamThinking\(message\)/);
  assert.match(script, /function updateStreamActivity\(message\)/);
  assert.match(script, /function sanitizeThinkingText\(text\)/);
  assert.match(script, /target\.thinkingBuffer = mergeStreamText\(existingThinking, message\.thinking\);/);
  assert.match(script, /item\.thinking = filtered\.pending \? '' : sanitizeThinkingText\(filtered\.text\);/);
  assert.match(script, /const hasAssistantActivity = hasOpenCodeActivity\(item\.activity\);/);
  assert.match(script, /const hasInlineAssistantActivity = hasOpenCodeActivityTimeline\(item\.activityTimeline\);/);
  assert.match(script, /appendMessageThinking\(bubble, item\.thinking, \{\s*activity: item\.activity,\s*suppressActivityDetails: hasInlineAssistantActivity,\s*running: itemRunning,\s*startedAt: item\.startedAt,\s*durationMs: item\.durationMs,\s*detailKey: messageDetailKey\(activeId, activeThread\?\.id, index, 'thinking'\),\s*\}\)/s);
  assert.match(script, /renderMarkdownWithActivity\(\s*body,\s*normalizeMessageText\(item\.text\),\s*item\.activity,\s*item\.activityTimeline,\s*itemRunning,\s*baseDetailKey\s*\)/s);
  assert.doesNotMatch(script, /renderMarkdownLite\(body, normalizeMessageText\(item\.text\)\);/);
  assert.match(script, /if \(itemRunning\) \{\s*appendMessageRunningStatus\(bubble, item\);\s*\} else if \(shouldShowAssistantCopyButton\(conversation, index, activeConversationRunning\)\) \{/s);
  assert.match(script, /function appendMessageThinking\(bubble, text, options = \{\}\)/);
  assert.match(script, /function renderMarkdownWithActivity\(container, text, activity, activityTimeline, running, baseDetailKey = ''\)/);
  assert.match(script, /function mergeOpenCodeActivityTimeline\(existing, activities, offset\)/);
  assert.match(script, /item\.activityTimeline = mergeOpenCodeActivityTimeline\(\s*item\.activityTimeline,\s*message\.activities,\s*normalizeMessageText\(item\.text\)\.length\s*\)/s);
  assert.match(script, /appendInlineActivityGroup\(\s*container,\s*group\.entries,\s*running && group\.latest,\s*baseDetailKey \? `\$\{baseDetailKey\}:activity:\$\{group\.offset\}` : ''\s*\);/s);
  assert.match(script, /const openMessageDetailKeys = new Set\(\);/);
  assert.match(script, /function messageDetailKey\(cliId, threadId, index, kind, localKey = ''\)/);
  assert.match(script, /function renderActiveStreamMessage\(target\)/);
  assert.match(script, /if \(target\.cliId === activeId && target\.threadId === activeThreadId\(activeId\)\) \{\s*if \(!renderActiveStreamMessage\(target\)\) \{\s*renderMessages\(\);\s*\}\s*\}/s);
  assert.match(script, /const THINKING_ICON_SVG = '<svg /);
  assert.match(script, /const thinking = document\.createElement\('details'\);/);
  assert.match(script, /const thinking = document\.createElement\('details'\);\s*thinking\.className = 'message-thinking';\s*syncMessageThinkingElement\(thinking, normalized, options\);/s);
  assert.doesNotMatch(script, /const thinking = document\.createElement\('details'\);\s*syncMessageThinkingElement\(thinking, normalized, options\);/s);
  assert.match(script, /applyMessageDetailOpenState\(thinking, options\.detailKey\);/);
  assert.match(script, /summary\.className = 'message-thinking-summary';/);
  assert.match(script, /summary\.innerHTML = THINKING_ICON_SVG/);
  assert.match(script, /label\.textContent = openCodeThinkingSummaryText\(activity, options\.running, options\.startedAt, options\.durationMs\);/);
  assert.match(script, /chevron\.className = 'message-thinking-chevron';/);
  assert.match(script, /chevron\.innerHTML = THINKING_CHEVRON_SVG;/);
  assert.match(script, /item\.durationMs = Math\.max\(0, Date\.now\(\) - Number\(item\.startedAt \|\| Date\.now\(\)\)\);/);
  assert.match(script, /item\.thinking = sanitizeThinkingText\(target\.thinkingBuffer \?\? item\.thinking\);/);
  assert.match(script, /const thinkingText = sanitizeThinkingText\(normalized\);/);
  assert.match(script, /appendOpenCodeActivityDetails\(body, activity\.entries, detailKey \? `\$\{detailKey\}:activity` : ''\);/);
  assert.match(script, /thinkingTextBlock\.className = 'message-thinking-detail-text';/);
  assert.doesNotMatch(script, /thinking\.open = true/);
  assert.doesNotMatch(script, /body\.textContent = openCodeActivityBodyText/);
  assert.match(css, /\.message-thinking\s*\{/);
  assert.match(css, /\.message-thinking\s*\{\s*[^}]*color:\s*color-mix\(in srgb, var\(--assistant-muted\) 72%, transparent\);/s);
  assert.match(css, /\.message-thinking-summary\s*\{/);
  assert.match(css, /\.message-thinking-summary::-webkit-details-marker\s*\{/);
  assert.doesNotMatch(css, /\.message-thinking-summary::before/);
  assert.match(css, /\.message-thinking-summary:hover \.message-thinking-label,\s*\.message-thinking\[open\] \.message-thinking-label\s*\{/);
  assert.match(css, /\.message-thinking-icon\s*\{/);
  assert.match(css, /\.message-thinking-icon\s*\{\s*[^}]*color:\s*color-mix\(in srgb, var\(--assistant-muted\) 62%, transparent\);/s);
  assert.match(css, /\.message-thinking-chevron\s*\{/);
  assert.match(css, /\.message-thinking-chevron\s*\{\s*[^}]*opacity:\s*0;/s);
  assert.match(css, /\.message-thinking-summary:hover \.message-thinking-chevron,\s*\.message-thinking\[open\] \.message-thinking-chevron\s*\{/);
  assert.match(css, /\.message-thinking-body\s*\{/);
  assert.match(css, /\.message-activity-inline\s*\{/);
  assert.match(script, /const row = document\.createElement\('details'\);/);
  assert.match(script, /row\.dataset\.messageDetailKey = detailKey;/);
  assert.match(script, /summary\.className = 'message-activity-summary';/);
  assert.match(script, /body\.className = 'message-activity-body';/);
  assert.match(script, /appendActivityDetailRows\(body, normalizedEntries\);/);
  assert.match(script, /function appendActivityDetailRows\(body, entries\)/);
  assert.match(script, /detail: normalizeMessageText\(activity\.detail\)\.trim\(\)/);
  assert.match(script, /detailRow\.className = 'message-activity-detail-row';/);
  assert.match(script, /log\.className = 'message-activity-log';/);
  assert.match(script, /applyMessageDetailOpenState\(row, detailKey\);/);
  assert.match(css, /\.message-activity-summary::-webkit-details-marker\s*\{/);
  assert.match(css, /\.message-activity-body\s*\{/);
  assert.match(css, /\.message-activity-detail-row\s*\{/);
  assert.match(css, /\.message-activity-log\s*\{/);
  assert.match(css, /\.message-thinking-detail-text\s*\{/);
  assert.match(css, /\.message-activity-inline\.is-running \.message-activity-text\s*\{/);
  assert.match(css, /@keyframes activityTextShimmer/);
  assert.doesNotMatch(css, /\.message-thinking-body\s*\{[^}]*border-left:/);
  assert.match(i18nScript, /'message\.activity\.thinkingDone': 'Thought'/);
  assert.match(i18nScript, /'message\.activity\.thinkingDone': '已思考'/);
  assert.match(i18nScript, /'message\.activity\.processed': 'Processed'/);
  assert.match(i18nScript, /'message\.activity\.processed': '已处理'/);
  assert.match(i18nScript, /'message\.activity\.files': 'Explored \{count\} \{fileLabel\}'/);
  assert.match(i18nScript, /'message\.activity\.files': '已探索 \{count\} 个文件'/);
});

test('webview composer uses compact Code X style controls', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /\.prompt-shell\s*\{\s*[^}]*padding:\s*12px;/s);
  assert.match(css, /\.prompt-shell\s*\{\s*[^}]*border-radius:\s*18px;/s);
  assert.match(css, /\.option-summary,\s*\.mode-summary,\s*\.context-summary\s*\{\s*[^}]*border:\s*1px solid transparent;/s);
  assert.match(css, /\.option-summary,\s*\.mode-summary,\s*\.context-summary\s*\{\s*[^}]*background:\s*transparent;/s);
  assert.match(css, /\.permission-menu \.option-summary::before\s*\{/);
  assert.match(css, /\.model-menu \.option-summary::before\s*\{/);
  assert.match(css, /\.send-button,\s*\.stop-button\s*\{\s*[^}]*border-radius:\s*999px;/s);
  assert.match(css, /\.send-button\s*\{\s*[^}]*background:\s*color-mix\(in srgb, var\(--vscode-foreground, #1f1f1f\) 92%, transparent\);/s);
  assert.match(css, /\.stop-button\s*\{\s*[^}]*color:\s*var\(--vscode-errorForeground, #c00\);/s);
  assert.match(css, /\.stop-button\s*\{\s*[^}]*background:\s*color-mix\(in srgb, var\(--assistant-panel\) 64%, transparent\);/s);
  assert.match(css, /\.composer-runtime \.option-summary\s*\{\s*[^}]*border-color:\s*transparent;/s);
  assert.match(css, /\.composer-runtime \.option-summary::before\s*\{\s*[^}]*border:\s*1px solid currentColor;/s);
});

test('webview renders a Codex style composer when Codex is selected', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(html, /class="codex-terminal-banner"/);
  assert.match(html, /id="codexTerminalStop"/);
  assert.match(html, /id="codexTerminalOpen"/);
  assert.match(script, /const codexTerminalBanner = document\.getElementById\('codexTerminalBanner'\);/);
  assert.match(script, /const codexTerminalOpen = document\.getElementById\('codexTerminalOpen'\);/);
  assert.match(script, /function renderCodexTerminalBanner\(\)/);
  assert.match(script, /const codexRunning = Boolean\(runningByProvider\.codex\);/);
  assert.match(script, /const taskBoardVisible = visibleTasksForBoard\(\)\.length > 0;/);
  assert.match(script, /codexTerminalBanner\.hidden = activeId !== 'codex' \|\| !codexRunning \|\| taskBoardVisible;/);
  assert.match(script, /codexTerminalStop\.addEventListener\('click'/);
  assert.match(script, /codexTerminalOpen\.addEventListener\('click'/);
  assert.match(script, /command: 'openProviderExtension', cliId: activeId/);
  assert.match(i18nScript, /'codex\.terminalRunning': 'Running 1 terminal'/);
  assert.match(i18nScript, /'codex\.terminalRunning': '正在运行 1 个终端'/);
  assert.match(css, /body\[data-provider="codex"\] \.codex-terminal-banner\s*\{\s*[^}]*display:\s*flex;/s);
  assert.match(css, /body\[data-provider="codex"\] \.prompt-shell\s*\{\s*[^}]*padding:\s*0;/s);
  assert.match(css, /body\[data-provider="codex"\] \.prompt-shell\s*\{\s*[^}]*border-radius:\s*18px;/s);
  assert.match(css, /body\[data-provider="codex"\] \.prompt-actions\s*\{\s*[^}]*border-top:\s*0;/s);
  assert.match(css, /body\[data-provider="codex"\] \.permission-menu\.is-visible\s*\{\s*[^}]*order:\s*2;/s);
  assert.match(css, /body\[data-provider="codex"\] \.permission-menu \.option-summary\s*\{\s*[^}]*color:\s*var\(--vscode-foreground\);/s);
  assert.match(css, /body\[data-provider="codex"\] \.permission-menu\.is-danger \.option-summary\s*\{\s*[^}]*color:\s*var\(--vscode-inputValidation-warningForeground, #b87500\);/s);
  assert.match(css, /body\[data-provider="codex"\] \.composer-meta\s*\{\s*[^}]*margin-left:\s*auto;/s);
  assert.match(css, /body\[data-provider="codex"\] \.model-menu\.is-visible\s*\{\s*[^}]*order:\s*7;/s);
  assert.match(css, /body\[data-provider="codex"\] \.send-button\s*\{\s*[^}]*background:\s*#8f8f8f;/s);
});

test('provider extension bridges use the corresponding VS Code extension commands', () => {
  assert.deepEqual(getProviderExtensionBridge('codex'), {
    providerId: 'codex',
    extensionId: 'openai.chatgpt',
    displayName: 'Codex',
    openCommands: ['chatgpt.newCodexPanel', 'chatgpt.openSidebar'],
  });
  assert.deepEqual(getProviderExtensionBridge('claude'), {
    providerId: 'claude',
    extensionId: 'anthropic.claude-code',
    displayName: 'Claude Code',
    openCommands: ['claude-vscode.sidebar.open', 'claude-vscode.editor.openLast'],
  });
  assert.deepEqual(getProviderExtensionBridge('opencode'), {
    providerId: 'opencode',
    extensionId: 'sst-dev.opencode',
    displayName: 'OpenCode',
    openCommands: ['opencode.openTerminal'],
  });
  assert.deepEqual(getProviderExtensionBridge('gemini'), {
    providerId: 'gemini',
    extensionId: 'google.gemini-cli-vscode-ide-companion',
    displayName: 'Gemini CLI',
    openCommands: ['gemini-cli.runGeminiCLI'],
  });
  assert.equal(getProviderExtensionBridge('aider'), undefined);
});

test('sidebar opens provider VS Code extensions through a whitelisted bridge', () => {
  const source = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(source, /case 'openProviderExtension':/);
  assert.match(source, /await this\.openProviderExtension\(this\.resolveCliId\(message\)\);/);
  assert.match(source, /vscodeExtension: this\.getProviderExtensionStatus\(profile\.id\)/);
  assert.match(source, /const bridge = getProviderExtensionBridge\(cliId\);/);
  assert.match(source, /for \(const command of bridge\.openCommands\)/);
  assert.match(source, /await vscode\.commands\.executeCommand\(command\);/);
});

test('webview renders a Claude Code style composer when Claude is selected', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(html, /class="claude-terminal-banner"/);
  assert.match(html, /id="claudeTerminalDismiss"/);
  assert.match(html, /id="claudeContextBtn"/);
  assert.match(html, /class="claude-permission-icon"/);
  assert.match(script, /let claudeTerminalBannerDismissed = Boolean\(saved\.claudeTerminalBannerDismissed\);/);
  assert.match(script, /i18n\.t\('claude\.placeholder'\)/);
  assert.match(script, /i18n\.t\('claude\.permission\.askBeforeEdits'\)/);
  assert.match(script, /claudeContextBtn\.addEventListener\('click'/);
  assert.match(i18nScript, /'claude\.terminalPreference': 'Prefer the Terminal experience\? Switch back in Settings\.'/);
  assert.match(i18nScript, /'claude\.placeholder': '⌘ Esc to focus or unfocus Claude'/);
  assert.match(i18nScript, /'claude\.permission\.askBeforeEdits': 'Ask before edits'/);
  assert.match(css, /body\[data-provider="claude"\] \.claude-terminal-banner\s*\{\s*[^}]*display:\s*flex;/s);
  assert.match(css, /body\[data-provider="claude"\] \.prompt-shell\s*\{\s*[^}]*border-color:\s*#d97757;/s);
  assert.match(css, /body\[data-provider="claude"\] \.prompt-shell\s*\{\s*[^}]*border-radius:\s*8px;/s);
  assert.match(css, /body\[data-provider="claude"\] \.composer-meta,\s*body\[data-provider="claude"\] \.model-menu,\s*body\[data-provider="claude"\] \.mode-menu,\s*body\[data-provider="claude"\] \.context-menu\s*\{\s*[^}]*display:\s*none;/s);
  assert.doesNotMatch(css, /body\[data-provider="claude"\] \.composer-footer\s*\{\s*[^}]*display:\s*none;/s);
  assert.doesNotMatch(css, /body\[data-provider="claude"\] \.compact-select,\s*body\[data-provider="claude"\] \.composer-meta/s);
  assert.match(css, /body\[data-provider="claude"\] \.permission-menu\.is-visible\s*\{\s*[^}]*display:\s*block;/s);
  assert.match(css, /body\[data-provider="claude"\] \.claude-permission-icon\s*\{\s*[^}]*display:\s*block;/s);
  assert.match(css, /body\[data-provider="claude"\] \.send-button\s*\{\s*[^}]*border-radius:\s*6px;/s);
});

test('webview supports pasted image attachments in the composer', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(html, /id="attachmentStrip"/);
  assert.match(html, /id="attachImageBtn"/);
  assert.match(html, /id="imageFileInput"[^>]*accept="image\/\*"/);
  assert.match(script, /let promptAttachments = \[\];/);
  assert.match(script, /input\.addEventListener\('paste'/);
  assert.match(script, /event\.clipboardData\?\.items/);
  assert.match(script, /function addImageFiles/);
  assert.match(script, /new FileReader\(\)/);
  assert.match(script, /const finalAttachments = promptAttachments\.map\(attachmentPayload\);/);
  assert.match(script, /const hasAttachments = promptAttachments\.length > 0;/);
  assert.match(script, /promptAttachments = \[\];/);
  assert.match(css, /\.attachment-strip\s*\{/);
  assert.match(css, /\.attachment-chip img\s*\{/);
  assert.match(css, /\.attach-button\s*\{/);
  assert.match(i18nScript, /'attachment\.add': 'Attach image'/);
  assert.match(i18nScript, /'attachment\.add': '添加图片'/);
});

test('webview renders permissions as a Code X style option menu', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(html, /id="permissionOptionList"[^>]*role="menu"/);
  assert.match(script, /const permissionOptionList = document\.getElementById\('permissionOptionList'\);/);
  assert.match(script, /function renderPermissionOptionList\(options, selectedId\)/);
  assert.match(script, /const visibleOptions = options\.filter\(\(option\) => \(/);
  assert.match(script, /profile\?\.id !== 'codex' \|\| option\.id !== 'readOnly' \|\| option\.id === selectedId/);
  assert.match(script, /'permission-option-item'/);
  assert.match(script, /icon\.className = 'permission-option-icon';/);
  assert.match(script, /check\.className = 'permission-option-check';/);
  assert.match(script, /function appendDangerBadge\(button, option\)/);
  assert.match(script, /warning\.className = 'option-list-item-warning';/);
  assert.match(script, /permissionOptionList\.addEventListener\('click'/);
  assert.match(script, /activePermissionByProvider\[activeId\] = button\.dataset\.value;/);
  assert.match(script, /permissionMenu\.open = false;/);
  assert.match(css, /\.permission-option-list\s*\{/);
  assert.match(css, /\.permission-option-list \.option-list-item\s*\{\s*[^}]*grid-template-columns:\s*14px minmax\(0,\s*1fr\) 12px auto;/s);
  assert.match(css, /\.permission-option-list \.option-list-item::before\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /\.permission-option-item\.is-selected \.permission-option-check\s*\{/);
  assert.match(css, /\.option-list-item-warning/);
  assert.match(css, /body\[data-provider="codex"\] \.permission-menu \.option-summary/);
});

test('webview renders installed provider logo tabs in the header', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const providers = ['claude', 'gemini', 'codex', 'opencode', 'goose', 'aider'];
  const providerIcons = {
    claude: { light: 'media/provider-icons/claude.svg', dark: 'media/provider-icons/claude.svg' },
    gemini: { light: 'media/provider-icons/gemini.png', dark: 'media/provider-icons/gemini.png' },
    codex: { light: 'media/provider-icons/codex.png', dark: 'media/provider-icons/codex.png' },
    opencode: { light: 'media/provider-icons/opencode.png', dark: 'media/provider-icons/opencode.png' },
    goose: { light: 'media/provider-icons/goose-light.png', dark: 'media/provider-icons/goose-dark.png' },
    aider: { light: 'media/provider-icons/aider.png', dark: 'media/provider-icons/aider.png' },
  };
  const commands = manifest.contributes.commands;
  const titleActions = manifest.contributes.menus['view/title'] || [];

  assert.match(html, /<div class="toolbar-session">[\s\S]*<div class="provider-tabs" id="providerTabs" role="tablist" aria-label="Provider tabs"/);
  assert.match(html, /<div class="provider-tabs" id="providerTabs"[\s\S]*<\/div>\s*<label class="thread-select">/);
  assert.doesNotMatch(html, /<div class="toolbar-session">\s*<div class="brand-mark"/);
  assert.doesNotMatch(html, /<div class="toolbar-actions"[\s\S]*id="newChatBtn"[\s\S]*id="deleteThreadBtn"[\s\S]*<\/div>\s*<div class="provider-tabs" id="providerTabs"/);
  assert.doesNotMatch(html, /id="refreshBtn"/);
  assert.doesNotMatch(JSON.stringify(commands), /activeProviderIndicator|switchProvider/);
  assert.doesNotMatch(JSON.stringify(titleActions), /activeProviderIndicator|switchProvider/);
  assert.match(JSON.stringify(titleActions), /agents-gui\.refreshProviders/);
  assert.match(JSON.stringify(titleActions), /agents-gui\.openProviderSettings/);
  assert.match(css, /\.provider-tabs\s*\{/);
  assert.match(css, /\.provider-tabs\s*\{\s*[^}]*height:\s*24px;/s);
  assert.match(css, /\.provider-tabs\s*\{\s*[^}]*--provider-tabs-collapsed-width:\s*28px;/s);
  assert.match(css, /\.provider-tabs\s*\{\s*[^}]*width:\s*var\(--provider-tabs-collapsed-width\);/s);
  assert.match(css, /\.provider-tabs\s*\{\s*[^}]*border:\s*1px solid color-mix\(in srgb,\s*var\(--assistant-border\) 88%,\s*transparent\);/s);
  assert.match(css, /\.provider-tabs:hover,\s*\.provider-tabs:focus-within\s*\{/);
  assert.match(css, /\.provider-tabs:hover,\s*\.provider-tabs:focus-within\s*\{\s*[^}]*width:\s*min\(42vw,\s*var\(--provider-tabs-expanded-width\)\);/s);
  assert.match(css, /\.provider-tab-button\s*\{/);
  assert.match(css, /\.provider-tab-button\s*\{\s*[^}]*--provider-tab-collapsed-width:\s*24px;/s);
  assert.match(css, /\.provider-tab-button\s*\{\s*[^}]*height:\s*20px;/s);
  assert.match(css, /\.provider-tab-button\.is-active\s*\{/);
  assert.match(css, /\.provider-tab-button\.is-active\s*\{\s*[^}]*width:\s*var\(--provider-tab-collapsed-width\);/s);
  assert.match(css, /\.provider-tabs:not\(:hover\):not\(:focus-within\) \.provider-tab-button:not\(\.is-active\)\s*\{/);
  assert.match(css, /\.provider-tabs:not\(:hover\):not\(:focus-within\) \.provider-tab-button\.is-active\s*\{\s*[^}]*background:\s*transparent;/s);
  assert.match(css, /\.provider-tabs:hover \.provider-tab-button,\s*\.provider-tabs:focus-within \.provider-tab-button\s*\{/);
  assert.match(css, /\.provider-tab-logo\s*\{/);
  assert.match(css, /\.provider-tab-logo\s*\{\s*[^}]*width:\s*15px;/s);
  assert.match(css, /\.provider-tab-logo\s*\{\s*[^}]*filter:\s*grayscale\(1\) saturate\(0\.12\);/s);
  assert.match(css, /\.provider-tab-button\.is-active \.provider-tab-logo\s*\{\s*[^}]*filter:\s*none;/s);
  assert.match(css, /\.provider-tab-version\s*\{/);
  assert.match(css, /\.provider-tab-version\s*\{\s*[^}]*display:\s*none;/s);
  assert.doesNotMatch(css, /\.provider-tab-version\s*\{[^}]*text-overflow:\s*ellipsis;/s);
  assert.match(script, /const providerTabs = document\.getElementById\('providerTabs'\)/);
  assert.match(script, /return value\.replace\(\s*\/\^v\/i,\s*''\s*\);/);
  assert.match(script, /function renderProviderTabs\(\)/);
  assert.match(script, /const availableProfiles = visibleInstalledProfiles\(\)/);
  assert.doesNotMatch(script, /const activeProfile = availableProfiles\.find/);
  assert.match(script, /for \(const profile of availableProfiles\)/);
  assert.match(script, /providerTabs\.style\.setProperty\('--provider-tabs-expanded-width'/);
  assert.match(script, /button\.className = 'provider-tab-button'/);
  assert.match(script, /logo\.className = 'provider-tab-logo'/);
  assert.doesNotMatch(script, /version\.className = 'provider-tab-version'/);
  assert.doesNotMatch(css, /\.provider-tabs:not\(:hover\):not\(:focus-within\) \.provider-tab-button:not\(\.is-active\)\s*\{[^}]*scale\(/s);
  assert.match(script, /providerTabs\.addEventListener\('click'/);
  assert.match(script, /switchActiveProvider\(button\.dataset\.providerId\)/);
  assert.match(sidebarSource, /webviewIcon: this\.getProviderIconUris\(profile\.id\)/);

  for (const provider of providers) {
    for (const iconPath of new Set(Object.values(providerIcons[provider]))) {
      const icon = readFileSync(new URL(`../${iconPath}`, import.meta.url));
      assert.ok(icon.length > 0, `missing provider icon asset for ${provider}`);
      if (iconPath.endsWith('.svg')) {
        assert.match(icon.toString('utf8'), /<svg/);
      } else {
        assert.equal(icon.subarray(1, 4).toString('ascii'), 'PNG');
      }
    }
    assert.match(sidebarSource, new RegExp(`${provider}: \\{ light: '${providerIcons[provider].light}'`));
  }

  assert.match(sidebarSource, /private getProviderIconUris\(providerId: string\)/);
});

test('webview keeps provider switching in the header and out of the conversation toolbar', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(html, /<label class="provider-native-select" hidden>[\s\S]*id="providerSelect"/);
  assert.match(html, /id="providerTabs"/);
  assert.doesNotMatch(html, /composer-provider-dock/);
  assert.doesNotMatch(html, /<div class="prompt-selectors">[\s\S]*id="providerSelect"[\s\S]*<\/div>\s*<div class="prompt-tools"/);
  assert.match(css, /\.composer-footer\s*\{\s*[^}]*display:\s*flex;/s);
  assert.match(css, /\.composer-footer\s*\{\s*[^}]*justify-content:\s*space-between;/s);
  assert.match(css, /\.toolbar-main[\s\S]*\.provider-tabs/s);
  assert.match(css, /\.provider-tab-button/);
  assert.doesNotMatch(css, /\.composer-provider-dock/);
  assert.match(script, /renderProviderTabs/);
  assert.doesNotMatch(css, /\.composer-provider-dock/);
  assert.match(css, /\.context-budget\s*\{\s*[^}]*height:\s*22px;/s);
  assert.match(css, /\.context-budget\s*\{\s*[^}]*max-width:\s*48px;/s);
});

test('manifest exposes title actions and custom API provider settings', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const commands = JSON.stringify(manifest.contributes.commands);
  const titleActions = JSON.stringify(manifest.contributes.menus['view/title']);
  const properties = manifest.contributes.configuration.properties;

  assert.match(commands, /agents-gui\.refreshProviders/);
  assert.match(commands, /agents-gui\.openProviderSettings/);
  assert.match(titleActions, /view == agents-gui\.sidebar/);
  assert.match(titleActions, /agents-gui\.refreshProviders/);
  assert.match(titleActions, /agents-gui\.openProviderSettings/);
  assert.ok(properties['agents-gui.apiProviders.customProviders']);
  assert.ok(properties['agents-gui.apiProviders.defaultProviderId']);
  assert.ok(properties['agents-gui.apiProviders.agentProviderByCliId']);
  assert.equal(
    properties['agents-gui.apiProviders.customProviders'].items.properties.apiKey.type,
    'string'
  );
  assert.ok(properties['agents-gui.home.visibleAgentIds']);
  assert.ok(properties['agents-gui.home.agentOrder']);
  assert.ok(properties['agents-gui.commitMessage.provider']);
  assert.match(html, /id="settingsNavAgents"/);
  assert.match(html, /id="settingsNavApiProviders"/);
  assert.match(html, /id="settingsNavCommitMessage"/);
  assert.match(html, /class="settings-nav-icon"/);
  assert.match(html, /class="settings-nav-label"[^>]*data-i18n="settings\.agents"/);
  assert.match(html, /class="settings-nav-label"[^>]*data-i18n="settings\.apiProviders"/);
  assert.match(html, /class="settings-nav-label"[^>]*data-i18n="settings\.commitMessage"/);
  assert.match(html, /id="homeAgentList"/);
  assert.match(html, /id="commitMessageProviderSelect"/);
  assert.match(html, /id="commitMessageLanguageSelect"/);
  assert.match(html, /id="commitMessageMaxDiffChars"/);
  assert.match(html, /id="apiProviderSettingsPage"/);
  assert.doesNotMatch(html, /aria-modal="true"/);
  assert.match(html, /id="homeAgentsSaveStatus"[^>]*aria-live="polite"/);
  assert.match(html, /id="apiProviderSaveStatus"[^>]*aria-live="polite"/);
  assert.match(html, /id="commitMessageSaveStatus"[^>]*aria-live="polite"/);
  assert.match(html, /id="apiProviderApiKey"[^>]*type="password"/);
  assert.match(html, /id="apiProviderApiKeyEnv"/);
  assert.match(script, /const apiProviderApiKey = document\.getElementById\('apiProviderApiKey'\)/);
  assert.match(script, /apiKey: String\(provider\.apiKey \|\| ''\)/);
  assert.match(script, /apiKey: apiProviderApiKey\?\.value\.trim\(\) \|\| ''/);
  assert.match(script, /function visibleInstalledProfiles\(\)/);
  assert.match(script, /function orderedInstalledProfiles\(\)/);
  assert.match(script, /function renderHomeAgentSettings\(\)/);
  assert.match(script, /function renderCommitMessageSettings\(\)/);
  assert.match(script, /function saveCommitMessageSettings\(\)/);
  assert.match(script, /function setSettingsSaveStatus\(section,\s*state,\s*message\)/);
  assert.match(script, /const SETTINGS_SAVE_STATUS_TIMEOUT_MS = 5000;/);
  assert.match(script, /case 'settingsSaveResult':/);
  assert.match(script, /setSettingsSaveStatus\('agents',\s*'saving'\)/);
  assert.match(script, /setSettingsSaveStatus\('apiProviders',\s*'saving'\)/);
  assert.match(script, /setSettingsSaveStatus\('commitMessage',\s*'saving'\)/);
  assert.match(script, /function moveHomeAgent\(/);
  assert.match(script, /data-home-agent-move/);
  assert.match(script, /agentOrder/);
  assert.match(sidebarSource, /config\.get<string\[]>\('agentOrder', \[]\)/);
  assert.match(sidebarSource, /config\.update\('agentOrder', settings\.agentOrder/);
  assert.match(sidebarSource, /saveCommitMessageSettings/);
  assert.match(sidebarSource, /command:\s*'settingsSaveResult'/);
  assert.match(sidebarSource, /section,\s*ok:\s*true/);
  assert.match(sidebarSource, /section,\s*ok:\s*false/);
  assert.match(css, /body\.is-api-settings-open \.toolbar,\s*body\.is-api-settings-open \.main-content,\s*body\.is-api-settings-open \.composer\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /\.settings-save-status\s*\{/);
  assert.match(css, /\.settings-save-status\.is-success\s*\{[^}]*font-weight:\s*600;/s);
  assert.match(css, /\.settings-save-status\.is-info\s*\{/);
  assert.match(css, /\.settings-save-status\.is-error\s*\{/);
  assert.match(i18nScript, /'settings\.saveStatus\.saved': 'Settings saved'/);
  assert.match(i18nScript, /'settings\.saveStatus\.saved': '设置已保存'/);
  assert.match(i18nScript, /'homeAgents\.showAllStatus': 'All installed agents are visible\. Save to keep this layout\.'/);
  assert.match(i18nScript, /'homeAgents\.showAllStatus': '已显示全部 Agent，点击保存后生效。'/);
  assert.match(i18nScript, /'homeAgents\.orderChangedStatus': 'Order changed\. Save to keep this layout\.'/);
  assert.match(i18nScript, /'homeAgents\.orderChangedStatus': '已调整排序，点击保存后生效。'/);
  assert.match(script, /switch \(activeSettingsSection\)/);
  assert.match(css, /\.api-settings-panel\s*\{\s*[^}]*container-type:\s*inline-size;/s);
  assert.match(css, /\.settings-nav-item\s*\{\s*[^}]*grid-template-columns:\s*18px minmax\(0,\s*1fr\);/s);
  assert.match(css, /\.settings-nav-icon svg\s*\{\s*[^}]*width:\s*15px;/s);
  assert.match(css, /@container \(max-width:\s*700px\)\s*\{[\s\S]*?\.settings-layout\s*\{[\s\S]*?grid-template-columns:\s*44px minmax\(0,\s*1fr\);/s);
  assert.match(css, /@container \(max-width:\s*700px\)\s*\{[\s\S]*?\.settings-nav-label\s*\{[\s\S]*?display:\s*none;/s);
  assert.match(css, /@container \(max-width:\s*700px\)\s*\{[\s\S]*?\.api-settings-body\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
  assert.match(css, /\.home-agent-sort\s*\{/);
  assert.match(script, /saveApiProviderSettings/);
  assert.match(script, /saveHomeAgentSettings/);
  assert.match(script, /saveCommitMessageSettings/);
  assert.match(script, /commitMessageSettings/);
  assert.match(script, /refreshApiProviderSettings/);
  assert.match(script, /openProviderSettings/);
});

test('webview settings reset and reorder controls have durable local feedback', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /function moveHomeAgent\(agentId, direction\)/);
  assert.match(script, /\[order\[fromIndex\], order\[toIndex\]\] = \[order\[toIndex\], order\[fromIndex\]\];/);
  assert.match(script, /homeAgentSettings = normalizeHomeAgentSettings\(\{ \.\.\.settings, agentOrder: order \}\);/);
  assert.match(script, /setSettingsSaveStatus\('agents', 'info', i18n\.t\('homeAgents\.orderChangedStatus'\)\);/);
  assert.match(script, /button\.disabled = disabled;/);
  assert.match(script, /homeAgentList\s*\?\.querySelector\(`button\[data-home-agent-id="\$\{agentId\}"\]\[data-home-agent-move="\$\{direction\}"\]`\)\s*\?\.focus\(\);/s);
  assert.match(script, /function showAllHomeAgentsForUi\(\)/);
  assert.match(script, /homeAgentSettings = normalizeHomeAgentSettings\(\{ visibleAgentIds: \[\], agentOrder: \[\] \}\);/);
  assert.match(script, /setSettingsSaveStatus\('agents', 'info', i18n\.t\('homeAgents\.showAllStatus'\)\);/);
  assert.match(script, /homeAgentsReset\?\.addEventListener\('click', showAllHomeAgentsForUi\);/);
});

test('webview commit-message settings reset persists the exact defaults', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /function resetCommitMessageSettings\(\)/);
  assert.match(script, /commitMessageSettings = \{ provider: 'default', language: 'auto', maxDiffChars: 60000 \};/);
  assert.match(script, /renderCommitMessageSettings\(\);\s*setSettingsSaveStatus\('commitMessage', 'saving'\);/s);
  assert.match(script, /vscode\.postMessage\(\{ command: 'saveCommitMessageSettings', settings: commitMessageSettings \}\);/);
  assert.match(script, /commitMessageReset\?\.addEventListener\('click', resetCommitMessageSettings\);/);
});

test('custom API provider settings can sync explicit keys without leaking them', () => {
  const settings = sanitizeApiProviderSettings({
    customProviders: [
      {
        id: 'Open Router',
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-should-sync',
        apiKeyEnv: 'OPENROUTER_API_KEY',
        model: 'anthropic/claude-sonnet',
        extraEnv: {
          OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
          'bad-name': 'ignored',
        },
        enabled: true,
      },
      {
        id: 'disabled',
        name: 'Disabled',
        apiKeyEnv: 'DISABLED_KEY',
        enabled: false,
      },
    ],
    defaultProviderId: 'open-router',
    agentProviderByCliId: {
      opencode: 'open-router',
      claude: API_PROVIDER_INHERIT,
      codex: 'disabled',
    },
  });

  assert.equal(settings.customProviders[0].id, 'open-router');
  assert.equal(settings.customProviders[0].apiKey, 'sk-should-sync');
  assert.equal(settings.customProviders[0].apiKeyEnv, 'OPENROUTER_API_KEY');
  assert.equal(settings.customProviders[0].extraEnv.OPENAI_BASE_URL, 'https://openrouter.ai/api/v1');
  assert.equal(settings.customProviders[0].extraEnv.badname, 'ignored');
  assert.equal(settings.defaultProviderId, 'open-router');
  assert.equal(settings.agentProviderByCliId.opencode, 'open-router');
  assert.equal(settings.agentProviderByCliId.claude, API_PROVIDER_INHERIT);
  assert.equal(settings.agentProviderByCliId.codex, undefined);

  const runtime = resolveApiProviderRuntime(settings, 'opencode', {
    OPENROUTER_API_KEY: 'actual-secret',
  });
  assert.equal(runtime.env.AGENTS_HUB_API_BASE_URL, 'https://openrouter.ai/api/v1');
  assert.equal(runtime.env.AGENTS_HUB_API_MODEL, 'anthropic/claude-sonnet');
  assert.equal(runtime.env.AGENTS_HUB_API_KEY, 'sk-should-sync');
  assert.equal(runtime.env.OPENAI_BASE_URL, 'https://openrouter.ai/api/v1');
  assert.equal(runtime.selectionKey.includes('sk-should-sync'), false);
  assert.equal(runtime.selectionKey.includes('actual-secret'), false);
  assert.equal(runtime.warnings.length, 0);

  const fallback = sanitizeApiProviderSettings({
    customProviders: [{
      id: 'fallback',
      name: 'Fallback',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      enabled: true,
    }],
    defaultProviderId: 'fallback',
  });
  assert.equal(
    resolveApiProviderRuntime(fallback, 'opencode', { OPENROUTER_API_KEY: 'actual-secret' }).env.AGENTS_HUB_API_KEY,
    'actual-secret'
  );

  const missing = resolveApiProviderRuntime(fallback, 'opencode', {});
  assert.equal(missing.provider.name, 'Fallback');
  assert.equal(missing.env.AGENTS_HUB_API_KEY, undefined);
  assert.equal(missing.warnings[0].code, 'missingApiKeyEnv');
});

test('webview toolbar icons and composer controls stay visually centered', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /\.tool-button,\s*\.quick-button,\s*\.attach-button,\s*\.send-button,\s*\.stop-button\s*\{[^}]*padding:\s*0;/s);
  assert.match(css, /\.tool-button,\s*\.quick-button,\s*\.attach-button,\s*\.send-button,\s*\.stop-button\s*\{[^}]*place-items:\s*center;/s);
  assert.match(css, /\.prompt-actions\s*\{\s*[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) 30px;/s);
  assert.match(css, /\.prompt-selectors\s*\{\s*[^}]*flex-wrap:\s*nowrap;/s);
  assert.match(css, /\.prompt-selectors\s*\{\s*[^}]*overflow:\s*visible;/s);
});

test('webview composer popovers avoid viewport clipping', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /\.composer\s*\{\s*[^}]*overflow:\s*visible;/s);
  assert.match(css, /\.composer\s*\{\s*[^}]*align-content:\s*start;/s);
  assert.match(css, /\.composer\s*\{\s*[^}]*align-items:\s*start;/s);
  assert.match(css, /\.composer\s*\{\s*[^}]*grid-auto-rows:\s*max-content;/s);
  assert.match(css, /\.prompt-shell\s*\{\s*[^}]*overflow:\s*visible;/s);
  assert.match(css, /\.prompt-shell\s*\{\s*[^}]*align-self:\s*start;/s);
  assert.match(script, /function positionContextBudgetPopover\(\)/);
  assert.match(script, /const rightOverflow = triggerRect\.left \+ left \+ popoverWidth - \(window\.innerWidth - viewportPadding\);/);
  assert.match(script, /contextBudget\.style\.setProperty\('--context-budget-popover-left'/);
  assert.match(script, /contextBudget\?\.addEventListener\('pointerenter', positionContextBudgetPopover\);/);
  assert.match(script, /function composerPopoverFor\(menu\)/);
  assert.match(script, /function positionComposerPopover\(menu\)/);
  assert.match(script, /popover\.style\.setProperty\('--composer-popover-left'/);
  assert.match(script, /popover\.style\.setProperty\('--composer-popover-top'/);
  assert.match(script, /popover\.style\.setProperty\('--composer-popover-max-height'/);
  assert.match(script, /menu\.addEventListener\('toggle'/);
  assert.match(script, /closeComposerMenus\(menu\);/);
  assert.match(script, /window\.addEventListener\('resize', \(\) => \{[\s\S]*positionOpenComposerPopovers\(\);[\s\S]*\}\);/);
  assert.match(css, /\.context-budget-popover\s*\{\s*[^}]*left:\s*var\(--context-budget-popover-left, 0px\);/s);
  assert.match(css, /\.context-budget-popover\s*\{\s*[^}]*right:\s*auto;/s);
  assert.doesNotMatch(css, /\.context-budget-popover\s*\{[^}]*translateX\(-50%\)/s);
  assert.match(css, /\.option-popover,\s*\.mode-popover,\s*\.context-popover\s*\{\s*[^}]*position:\s*fixed;/s);
  assert.match(css, /\.option-popover,\s*\.mode-popover,\s*\.context-popover\s*\{\s*[^}]*left:\s*var\(--composer-popover-left, 8px\);/s);
  assert.match(css, /\.option-popover,\s*\.mode-popover,\s*\.context-popover\s*\{\s*[^}]*top:\s*var\(--composer-popover-top, 8px\);/s);
  assert.match(css, /\.option-popover,\s*\.mode-popover,\s*\.context-popover\s*\{\s*[^}]*max-height:\s*var\(--composer-popover-max-height/s);
  assert.doesNotMatch(css, /\.model-menu \.option-popover,\s*\.permission-menu \.option-popover\s*\{\s*[^}]*right:\s*0;/s);
  assert.match(css, /\.context-budget:hover \.context-budget-popover,\s*\.context-budget:focus \.context-budget-popover,\s*\.context-budget:focus-within \.context-budget-popover\s*\{[^}]*transform:\s*translateY\(0\);/s);
});

test('webview pins composer to the bottom when task board is hidden', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /\.app-shell\s*\{\s*[^}]*grid-template-areas:\s*"toolbar"\s*"main-content"\s*"composer";/s);
  assert.match(css, /\.app-shell\s*\{\s*[^}]*grid-template-rows:\s*max-content minmax\(0,\s*1fr\) max-content;/s);
  assert.match(css, /\.toolbar\s*\{\s*[^}]*grid-area:\s*toolbar;/s);
  assert.doesNotMatch(css, /\.task-board\s*\{\s*[^}]*grid-area:/s);
  assert.match(css, /\.main-content\s*\{\s*[^}]*grid-area:\s*main-content;/s);
  assert.match(css, /\.messages\s*\{\s*[^}]*grid-area:\s*auto;/s);
  assert.match(css, /\.composer\s*\{\s*[^}]*grid-area:\s*composer;/s);
});

test('webview composer controls wrap before narrow sidebars clip the send button', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /@media \(max-width:\s*460px\)\s*\{[\s\S]*?\.prompt-selectors\s*\{[\s\S]*?flex-wrap:\s*wrap;/s);
  assert.match(css, /@media \(max-width:\s*460px\)\s*\{[\s\S]*?\.provider-tabs\s*\{[\s\S]*?max-width:\s*min\(58vw,\s*var\(--provider-tabs-expanded-width\)\);/s);
  assert.match(css, /@media \(max-width:\s*460px\)\s*\{[\s\S]*?\.provider-tabs:hover,\s*\.provider-tabs:focus-within\s*\{[\s\S]*?width:\s*min\(58vw,\s*var\(--provider-tabs-expanded-width\)\);/s);
  assert.match(css, /\.composer\s*\{\s*[^}]*min-width:\s*0;/s);
  assert.match(css, /\.composer\s*\{\s*[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
  assert.match(css, /\.prompt-shell\s*\{\s*[^}]*min-width:\s*0;/s);
});

test('webview keeps very long prompts inside the composer instead of covering controls', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(script, /const PROMPT_INPUT_MAX_HEIGHT_FALLBACK = 104;/);
  assert.match(script, /function promptInputMaxHeight\(\)/);
  assert.match(script, /Number\.parseFloat\(window\.getComputedStyle\(input\)\.maxHeight\)/);
  assert.match(script, /return Number\.isFinite\(parsedMaxHeight\) && parsedMaxHeight > 0\s*\?\s*parsedMaxHeight\s*:\s*PROMPT_INPUT_MAX_HEIGHT_FALLBACK;/s);
  assert.match(script, /function resizePromptInput\(\)/);
  assert.match(script, /input\.style\.height = 'auto';\s*const maxHeight = promptInputMaxHeight\(\);/s);
  assert.match(script, /input\.style\.overflowY = input\.scrollHeight > maxHeight \? 'auto' : 'hidden';/);
  assert.match(script, /input\.addEventListener\('input', \(\) => \{\s*resizePromptInput\(\);/s);
  assert.match(script, /input\.value = '';\s*resizePromptInput\(\);\s*hideSlashPalette\(\);/s);
  assert.match(css, /textarea\s*\{\s*[^}]*max-height:\s*104px;/s);
  assert.match(css, /textarea\s*\{\s*[^}]*overflow-y:\s*hidden;/s);
  assert.match(css, /textarea\s*\{\s*[^}]*overscroll-behavior:\s*contain;/s);
  assert.match(css, /body\[data-provider="opencode"\] textarea\s*\{[^}]*max-height:\s*96px;/s);
});

test('webview uses one primary composer action slot for send and stop', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(script, /const running = Boolean\(runningByProvider\[activeId\]\);/);
  assert.match(script, /stopBtn\.hidden = !running;/);
  assert.match(script, /sendBtn\.hidden = running;/);
  assert.match(script, /stopBtn\.classList\.toggle\('is-visible', running\);/);
  assert.match(script, /sendBtn\.classList\.toggle\('is-hidden', running\);/);
  assert.match(script, /function requestStopActiveProvider\(\) \{/);
  assert.match(script, /if \(!runningByProvider\[activeId\]\) \{/);
  assert.match(script, /vscode\.postMessage\(\{ command: 'stop', cliId: activeId \}\);/);
  assert.match(css, /\.prompt-tools\s*\{\s*[^}]*flex:\s*0 0 28px;/s);
  assert.match(css, /\.prompt-tools\s*\{\s*[^}]*width:\s*30px;/s);
  assert.match(css, /\.prompt-tools\s*\{\s*[^}]*display:\s*grid;/s);
  assert.match(css, /\.send-button\.is-hidden\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /\.stop-button svg\s*\{\s*[^}]*fill:\s*currentColor;/s);
  assert.match(css, /\.stop-button svg\s*\{\s*[^}]*stroke:\s*none;/s);
});

test('webview refreshes context after a concrete provider is active', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /function refreshActiveContext\(\) \{\s*if \(!activeId\) \{\s*return;\s*\}\s*vscode\.postMessage\(\{ command: 'refreshContext', cliId: activeId, contextOptions, modelId: activeModelId\(\) \}\);\s*\}/);
  assert.match(script, /providerSelect\.addEventListener\('change', \(\) => \{[\s\S]*renderAll\(\);\s*refreshActiveContext\(\);[\s\S]*\}\);/);
  assert.match(script, /case 'profiles':[\s\S]*renderAll\(\);\s*refreshActiveContext\(\);[\s\S]*break;/);
  assert.match(script, /case 'switchProvider':\s*switchActiveProvider\(message\.providerId\);\s*break;/);
  assert.match(script, /vscode\.postMessage\(\{ command: 'checkProfiles' \}\);\s*vscode\.postMessage\(\{ command: 'refreshApiProviderSettings' \}\);\s*refreshActiveContext\(\);\s*renderAll\(\);/);
});

test('webview empty state is visible in large blank panels', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /\.empty-state\s*\{\s*[^}]*margin:\s*min\(18vh,\s*96px\) auto auto;/s);
  assert.match(css, /\.empty-state\s*\{\s*[^}]*width:\s*min\(100%,\s*360px\);/s);
  assert.match(css, /\.empty-title\s*\{\s*[^}]*text-wrap:\s*balance;/s);
});

test('webview shows provider detection as a loading state before empty provider state', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(script, /let profilesLoading = true;/);
  assert.match(script, /if \(profilesLoading\) \{[\s\S]*option\.textContent = i18n\.t\('provider\.loading'\)/);
  assert.match(script, /providerHint\.classList\.add\('is-loading'\)/);
  assert.match(script, /appendProviderLoadingState\(\)/);
  assert.match(script, /profilesLoading = false;\s*profiles = message\.profiles \|\| \[\];/);
  assert.match(script, /input\.placeholder = profilesLoading\s*\?\s*i18n\.t\('input\.placeholderLoading'\)/);
  assert.match(css, /\.empty-state\.is-loading/);
  assert.match(css, /\.loading-spinner/);
  assert.match(i18nScript, /'provider\.loading': 'Detecting providers'/);
  assert.match(i18nScript, /'provider\.loading': '正在检测提供方'/);
});

test('webview shows the selected provider without a generic picker prefix', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /data-i18n="provider\.short"/);
  assert.match(html, /id="providerSelect"[^>]*name="assistantProvider"/);
});

test('webview sends to only the active provider at send time', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /id="agentRail"/);
  assert.doesNotMatch(script, /renderAgentRail/);
  assert.doesNotMatch(script, /agentRail\?\.addEventListener/);
  assert.doesNotMatch(html, /id="agentPicker"/);
  assert.doesNotMatch(script, /selectedAgentIds/);
  assert.doesNotMatch(script, /normalizeSavedAgentIds/);
  assert.doesNotMatch(script, /selectedProviderIdsForSend/);
  assert.doesNotMatch(script, /function renderAgentPicker/);
  assert.doesNotMatch(script, /TASK_ROUTING_RULES/);
  assert.doesNotMatch(script, /recommendedProviderIds/);
  assert.doesNotMatch(css, /\.agent-picker/);
  assert.doesNotMatch(css, /\.agent-choice/);
  assert.doesNotMatch(i18nScript, /agentPicker\./);
  assert.match(script, /const profile = activeProfile\(\);\s*if \(!profile\?\.installed\) \{/);
  assert.match(script, /sendToProvider\(\s*activeId,\s*action,\s*finalText,/s);
  assert.doesNotMatch(script, /providerIds\.forEach/);
});

test('webview sends recent thread conversation as provider context', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const providerSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const typesSource = readFileSync(new URL('../src/assistantTypes.ts', import.meta.url), 'utf8');

  assert.match(typesSource, /interface AssistantConversationHistoryMessage/);
  assert.match(typesSource, /conversationHistory\?: AssistantConversationHistoryMessage\[\]/);
  assert.match(script, /function conversationHistoryForSend\(cliId\)/);
  assert.match(script, /ensureConversation\(cliId, activeThreadId\(cliId\)\)/);
  assert.match(script, /\.slice\(-8\)/);
  assert.match(script, /conversationHistory: conversationHistoryForSend\(providerId\)/);
  assert.match(providerSource, /conversationHistory: message\.conversationHistory/);
});

test('webview closes composer menus when clicking outside or pressing escape', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /function composerMenus\(\)/);
  assert.match(script, /\[modelMenu, runtimeMenu, permissionMenu, modeMenu, contextMenu\]\.filter\(Boolean\)/);
  assert.match(script, /function closeComposerMenus\(exceptMenu\)/);
  assert.match(script, /menu\.open = false;/);
  assert.match(script, /document\.addEventListener\('click', \(event\) => \{/);
  assert.match(script, /const currentMenu = target\?\.closest\('details'\);/);
  assert.match(script, /slashPaletteVisible\(\)\s*&& target\s*&& !slashPalette\.contains\(target\)\s*&& target !== input/s);
  assert.match(script, /hideSlashPalette\(\);/);
  assert.match(script, /closeComposerMenus\(menus\.includes\(currentMenu\) \? currentMenu : undefined\);/);
  assert.match(script, /window\.addEventListener\('keydown', \(event\) => \{/);
  assert.match(script, /event\.key === 'Escape'/);
  assert.match(script, /if \(slashPaletteVisible\(\)\) \{\s*event\.preventDefault\(\);\s*hideSlashPalette\(\);\s*return;\s*\}/s);
  assert.match(script, /if \(requestStopActiveProvider\(\)\) \{\s*event\.preventDefault\(\);\s*return;\s*\}/s);
});

test('webview removes multi-agent compare planning', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.doesNotMatch(script, /name: 'compare'/);
  assert.doesNotMatch(script, /sendComparePlan/);
  assert.doesNotMatch(script, /selectedProfilesForComparison/);
  assert.doesNotMatch(script, /recommendedProfilesForIntent/);
  assert.doesNotMatch(i18nScript, /slash\.compare/);
});

test('webview keeps the visual task board disabled while single-agent flows stabilize', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(html, /id="taskBoard"[^>]*class="task-board"/);
  assert.match(html, /id="taskBoard"[^>]*hidden/);
  assert.match(script, /const VISUAL_TASK_BOARD_ENABLED = false;/);
  assert.match(script, /let tasks = normalizeSavedTasks\(saved\.tasks\);/);
  assert.match(script, /let taskBoardDismissed = Boolean\(saved\.taskBoardDismissed\);/);
  assert.match(script, /taskBoardDismissed,/);
  assert.match(script, /let taskBySessionId = \{\};/);
  assert.match(script, /function createRunTask/);
  assert.doesNotMatch(script, /taskBoardDismissed = false;/);
  assert.doesNotMatch(script, /makeTaskGroupId/);
  assert.doesNotMatch(script, /groupId/);
  assert.match(script, /function updateTaskStatus/);
  assert.match(script, /function visibleTasksForBoard\(\)/);
  assert.match(script, /if \(!VISUAL_TASK_BOARD_ENABLED \|\| taskBoardDismissed\) \{\s*return \[\];\s*\}/);
  assert.match(script, /const activeTasks = tasks\.filter\(isActiveTask\);/);
  assert.match(script, /function renderTaskBoard\(\)/);
  assert.match(script, /const visibleTasks = visibleTasksForBoard\(\);/);
  assert.match(script, /taskBySessionId\[message\.sessionId\]/);
  assert.match(script, /renderTaskBoard\(\);\s*renderThreadSelect\(\);/);
  assert.match(script, /status: 'preparing'/);
  assert.match(script, /status: wasStopped \? 'stopped' : \(Number\(message\.exitCode\) === 0 \? 'completed' : 'failed'\)/);
});

test('webview provider status keeps transient running text out of the composer', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(script, /pendingByProvider\[profile\.id\]/);
  assert.match(script, /runningByProvider\[profile\.id\]/);
  assert.match(script, /provider\.preparing/);
  assert.match(script, /provider\.running/);
  assert.match(script, /providerHint\.textContent = '';/);
  assert.match(script, /renderProviderTabs\(\);/);
  assert.doesNotMatch(script, /version\.textContent = formatProviderVersion\(profile\.version\)/);
  assert.doesNotMatch(script, /providerHint\.classList\.add\('is-busy'\)/);
  assert.doesNotMatch(script, /prompt-shell'\)\?\.classList\.toggle\('is-busy'/);
  assert.match(css, /\.provider-hint\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /\.provider-hint\.is-warning\s*\{\s*[^}]*display:\s*inline-flex;/s);
  assert.doesNotMatch(css, /\.provider-hint\.has-version\s*\{/);
  assert.doesNotMatch(css, /\.provider-hint\.is-busy\s*\{/);
  assert.doesNotMatch(css, /\.prompt-shell\.is-busy\s*\{/);
});

test('webview displays attached context window usage details', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(html, /id="contextBudget"/);
  assert.match(html, /id="contextBudgetLabel"/);
  assert.match(html, /id="contextBudgetTokenizer"/);
  assert.match(script, /const contextBudgetPopover = contextBudget\?\.querySelector\('\.context-budget-popover'\);/);
  assert.match(script, /function renderContextBudget/);
  assert.match(script, /positionContextBudgetPopover\(\);/);
  assert.match(script, /profile\.contextWindowTokens/);
  assert.match(script, /contextSummary\?\.tokenUsage/);
  assert.match(script, /case 'contextSummary':[\s\S]*renderContextBudget\(\);[\s\S]*break;/);
  assert.match(script, /contextWindow\.usedPercent/);
  assert.match(script, /contextWindow\.usedTokens/);
  assert.match(script, /contextWindow\.totalTokens/);
  assert.match(script, /contextWindow\.remaining/);
  assert.match(script, /contextWindow\.autoCompact/);
  assert.match(script, /tokenUsage\.precision === 'exact'/);
  assert.match(script, /contextWindow\.exactUnavailable/);
  assert.match(script, /contextBudgetTokens\.textContent = i18n\.t\('contextWindow\.providerManaged'/);
  assert.match(css, /\.context-budget\s*\{/);
  assert.match(css, /\.context-budget-ring\s*\{\s*[^}]*width:\s*14px;/s);
  assert.match(css, /\.context-budget-popover\s*\{/);
  assert.match(css, /\.context-budget-popover\s*\{\s*[^}]*width:\s*min\(220px,\s*calc\(100vw - 20px\)\);/s);
  assert.match(css, /\.context-budget:hover \.context-budget-popover/);
  assert.match(i18nScript, /'contextWindow\.title'/);
  assert.match(i18nScript, /'contextWindow\.totalTokens'/);
  assert.match(i18nScript, /'contextWindow\.remaining'/);
});

test('webview hides low-value default composer chips', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(script, /modeMenu\?\.classList\.toggle\('is-visible', Boolean\(profile && \(profile\?\.id === 'opencode' \|\| modes\.length > 1\)\)\);/);
  assert.match(script, /forceContextMenuVisible/);
  assert.match(script, /contextSummary\.workspace/);
  assert.match(css, /\.mode-menu,\s*\.context-menu\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /\.mode-menu\.is-visible,\s*\.context-menu\.is-visible\s*\{\s*[^}]*display:\s*block;/s);
});

test('webview conversation transcript surfaces compact metadata and readable code output', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const localizationSource = readFileSync(new URL('../src/localization.ts', import.meta.url), 'utf8');

  assert.match(css, /html\s*\{\s*[^}]*padding:\s*0;/s);
  assert.match(css, /body\s*\{\s*[^}]*padding:\s*0;/s);
  assert.match(css, /\.app-shell\s*\{\s*[^}]*width:\s*100%;/s);
  assert.match(css, /\.composer\s*\{\s*[^}]*padding:\s*8px clamp\(14px,\s*2\.4vw,\s*18px\) 7px;/s);
  assert.ok(script.indexOf('const ORPHAN_ANSI_PATTERN') < script.indexOf('normalizeSavedThreads'));
  assert.match(script, /if \(item\.meta && item\.role !== 'user'\)/);
  assert.doesNotMatch(script, /parts\.push\(summary\.workspace\)/);
  assert.match(script, /const itemRunning = Boolean\(item\.running && runningByProvider\[activeId\]\);/);
  assert.match(script, /const meta = document\.createElement\('div'\);/);
  assert.match(script, /meta\.className = 'message-meta';/);
  assert.match(script, /bubble\.appendChild\(meta\);/);
  assert.match(script, /const activeConversationRunning = Boolean\(runningByProvider\[activeId\] \|\| pendingByProvider\[activeId\]\);/);
  assert.match(script, /if \(itemRunning\) \{\s*appendMessageRunningStatus\(bubble, item\);\s*\} else if \(shouldShowAssistantCopyButton\(conversation, index, activeConversationRunning\)\) \{/s);
  assert.match(script, /function shouldShowAssistantCopyButton\(conversation, index, activeConversationRunning\)/);
  assert.match(script, /if \(activeConversationRunning \|\| item\?\.role !== 'assistant' \|\| !normalizeMessageText\(item\.text\)\.trim\(\)\) \{/);
  assert.match(script, /function appendMessageRunningStatus\(container, item\)/);
  assert.match(script, /function syncMessageRunningStatusElement\(container, item, itemRunning\)/);
  assert.match(script, /syncMessageRunningStatusElement\(bubble, item, itemRunning\);/);
  assert.match(script, /if \(itemRunning \|\| Boolean\(runningByProvider\[activeId\] \|\| pendingByProvider\[activeId\]\)\) \{\s*bubble\.querySelector\(':scope > \.message-actions'\)\?\.remove\(\);\s*\}/s);
  assert.match(script, /function assistantCopyGroupPlainText\(conversation, start, end\)/);
  assert.match(script, /const copyActions = document\.createElement\('div'\);/);
  assert.match(script, /copyActions\.className = 'message-actions';/);
  assert.match(script, /const copyButton = createMessageCopyButton\(\);/);
  assert.match(script, /copyButton\.dataset\.messageCopyStart = String\(copyGroupStart\);/);
  assert.match(script, /copyButton\.dataset\.messageCopyEnd = String\(index\);/);
  assert.match(script, /copyActions\.appendChild\(copyButton\);/);
  assert.match(script, /bubble\.appendChild\(copyActions\);/);
  assert.match(script, /function createMessageCopyButton\(\)/);
  assert.match(script, /copyButton\.dataset\.messageCopy = 'true';/);
  assert.match(script, /function markdownToCopyPlainText\(text\)/);
  assert.match(script, /const lines = preprocessAssistantMessageLines\(String\(text \|\| ''\)\.split\('\\n'\)\);/);
  assert.match(script, /function renderedMessagePlainText\(container\)/);
  assert.match(script, /vscode\.postMessage\(\{ command: 'copyMessageText', text: markdownToCopyPlainText\(latest\) \}\);/);
  assert.match(script, /const copyButton = event\.target\.closest\('\[data-message-copy\]'\);/);
  assert.match(script, /const groupText = Number\.isInteger\(start\) && Number\.isInteger\(end\) && end >= start/);
  assert.match(script, /const body = copyButton\.closest\('\.message-bubble'\)\?\.querySelector\('\.message-content'\);/);
  assert.match(script, /const text = groupText \|\| renderedMessagePlainText\(body\);/);
  assert.match(script, /vscode\.postMessage\(\{ command: 'copyMessageText', text \}\);/);
  assert.doesNotMatch(script, /copyButton\.dataset\.messageCopyIndex/);
  assert.doesNotMatch(script, /const item = ensureConversation\(activeId\)\[index\];/);
  assert.match(sidebarSource, /case 'copyMessageText':/);
  assert.match(sidebarSource, /private async copyMessageText\(messageText: unknown\)/);
  assert.match(sidebarSource, /vscode\.env\.clipboard\.writeText\(text\)/);
  assert.match(localizationSource, /'notification\.messageCopied'/);
  assert.match(i18nScript, /'message\.copy': 'Copy'/);
  assert.match(i18nScript, /'message\.copy': '复制'/);
  assert.match(css, /\.messages\s*\{\s*[^}]*padding:\s*10px clamp\(14px,\s*2\.4vw,\s*18px\) 18px;/s);
  assert.match(css, /\.message-actions\s*\{\s*[^}]*display:\s*flex;/s);
  assert.match(css, /\.message-copy-button\s*\{/);
  assert.doesNotMatch(css, /\.message-copy-button\s*\{[^}]*position:\s*absolute/s);
  assert.match(css, /\.message-meta\s*\{\s*[^}]*display:\s*flex;/s);
  assert.match(css, /\.message\.assistant \.message-bubble\s*\{\s*[^}]*width:\s*min\(100%,\s*720px\);/s);
  assert.match(css, /\.message\.assistant \.message-bubble\s*\{\s*[^}]*padding:\s*0;/s);
  assert.match(css, /\.message\.assistant \.message-bubble\s*\{\s*[^}]*background:\s*transparent;/s);
  assert.match(css, /\.message\.assistant \.message-bubble\s*\{\s*[^}]*border:\s*0;/s);
  assert.doesNotMatch(css, /\.message\.assistant \.message-bubble\s*\{[^}]*border-left-width/s);
  assert.match(css, /\.message\.error \.message-bubble\s*\{\s*[^}]*width:\s*min\(100%,\s*720px\);/s);
  assert.match(css, /\.message\.error \.message-bubble\s*\{\s*[^}]*padding:\s*8px 10px 8px 32px;/s);
  assert.match(css, /\.message-status\s*\{\s*[^}]*background:\s*transparent;/s);
  assert.match(css, /\.message-status\s*\{\s*[^}]*border:\s*0;/s);
  assert.match(css, /\.message-status\.is-running\s*\{/);
  assert.match(css, /\.message-status\.is-running \.message-status-label\s*\{/);
  assert.match(script, /function syncMessageStatusTimer\(shouldRun\)/);
  assert.match(script, /function syncVisibleRunningMessageStatuses\(\)/);
  assert.match(script, /messageStatusTimer = setInterval\(\(\) => \{\s*if \(!syncVisibleRunningMessageStatuses\(\)\) \{\s*syncMessageStatusTimer\(false\);/);
  assert.doesNotMatch(script, /messageStatusTimer = setInterval\(\(\) => \{\s*renderMessages\(\);[\s\S]*?\}, 1000\);/);
  assert.match(script, /const MESSAGE_BOTTOM_STICKY_THRESHOLD = 48;/);
  assert.match(script, /function shouldAutoScrollMessages\(threadKey\)/);
  assert.match(script, /function restoreMessageScroll\(shouldStickToBottom, previousScrollTop, threadKey\)/);
  assert.match(script, /const shouldStickToBottom = shouldAutoScrollMessages\(messageThreadKey\);/);
  assert.match(script, /const previousScrollTop = messages\.scrollTop;/);
  assert.match(script, /restoreMessageScroll\(shouldStickToBottom, previousScrollTop, messageThreadKey\);/);
  assert.doesNotMatch(script, /syncMessageStatusTimer\(hasVisibleRunningMessage\);\s*messages\.scrollTop = messages\.scrollHeight;/);
  assert.match(script, /function runningMessageStatusText\(stage, startedAt\)/);
  assert.match(script, /i18n\.t\('message\.statusElapsed', \{ status: stage, elapsed \}\)/);
  assert.match(script, /return item\.runningNotice \|\|[\s\S]*item\.text \? i18n\.t\('message\.generating'\) : i18n\.t\('message\.thinking'\),\s*item\.startedAt/s);
  assert.doesNotMatch(script, /typing-dots/);
  assert.match(css, /\.message\.user \.message-bubble\s*\{\s*[^}]*max-width:\s*min\(72%,\s*520px\);/s);
  assert.match(css, /\.message\.user \.message-bubble\s*\{\s*[^}]*padding:\s*7px 11px;/s);
  assert.match(css, /\.message\.user \.message-bubble\s*\{\s*[^}]*border:\s*1px solid var\(--assistant-border\);/s);
  assert.match(script, /const structuralTag = parseAssistantMarkupTag\(trimmed\);/);
  assert.match(script, /appendAssistantSectionLabel\(container, structuralTag\.name\);/);
  assert.match(script, /const lineParts = splitAssistantMarkupTags\(line\);/);
  assert.match(script, /appendAssistantMarkupParts\(container, lineParts\);/);
  assert.match(script, /const sectionHeading = parseAssistantSectionHeading\(trimmed\);/);
  assert.match(script, /appendAssistantSectionLabel\(container, sectionHeading\);/);
  assert.match(script, /const tabbedTable = readTabbedTable\(lines, index\);/);
  assert.match(script, /appendTable\(container, tabbedTable\.lines, tabbedTable\.kind\);/);
  assert.match(script, /function parseAssistantMarkupTag\(line\)/);
  assert.match(script, /function splitAssistantMarkupTags\(line\)/);
  assert.match(script, /function appendAssistantMarkupParts\(container, parts\)/);
  assert.match(script, /function parseAssistantSectionHeading\(line\)/);
  assert.match(script, /function shouldShowAssistantSectionLabel\(lines, index, name\)/);
  assert.match(script, /function preprocessAssistantMessageLines\(lines\)/);
  assert.match(script, /function isInternalAnalysisHeading\(line, lines, index\)/);
  assert.match(script, /function isInternalAnalysisField\(line\)/);
  assert.match(script, /function isAssistantToolNoiseLine\(line\)/);
  assert.match(script, /function shouldHideAssistantSection\(name\)/);
  assert.match(script, /function normalizeAssistantDisplayLine\(line\)/);
  assert.match(script, /function appendAssistantSectionLabel\(container, name\)/);
  assert.match(script, /function assistantSectionLabel\(name\)/);
  assert.match(script, /'zh-CN': \{/);
  assert.match(script, /analysis: '分析'/);
  assert.match(script, /results: '结果'/);
  assert.match(script, /files: '文件'/);
  assert.match(script, /root_cause: 'Root cause'/);
  assert.match(script, /check_results: 'Check results'/);
  assert.match(script, /summary: 'Summary'/);
  assert.match(script, /function readTabbedTable\(lines, startIndex\)/);
  assert.match(script, /function isTabbedTableRow\(line\)/);
  assert.match(script, /const fileResultBlock = readFileResultBlock\(lines, index\);/);
  assert.match(script, /appendFileResultList\(container, fileResultBlock\.items\);/);
  assert.match(script, /function readFileResultBlock\(lines, startIndex\)/);
  assert.match(script, /const fileResult = parseFileResultLine\(bullet\[1\]\);/);
  assert.match(script, /appendFileResultList\(container, \[fileResult\]\);/);
  assert.match(script, /function parseFileResultLine\(text\)/);
  assert.match(script, /function appendFileResultList\(container, fileResults\)/);
  assert.match(script, /function createFileResultRow\(fileResult\)/);
  assert.match(script, /document\.createElement\(hasDetail \? 'details' : 'div'\)/);
  assert.match(script, /summary\.className = 'md-file-row-summary';/);
  assert.match(script, /\^\[-\*•\]\\s\+\(\.\+\)\$/);
  assert.match(css, /\.message-content\s*\{\s*[^}]*gap:\s*4px;/s);
  assert.match(css, /\.message-content\s*\{\s*[^}]*line-height:\s*1\.46;/s);
  assert.match(css, /\.md-section-label\s*\{/);
  assert.match(css, /\.md-file-list\s*\{/);
  assert.match(css, /\.md-file-summary\s*\{/);
  assert.match(css, /\.md-file-row-summary\s*\{/);
  assert.match(css, /\.md-file-row\[data-collapsible\] \.md-file-row-summary\s*\{/);
  assert.match(css, /\.md-file-path\s*\{/);
  assert.match(css, /\.md-file-detail\s*\{/);
  assert.match(css, /\.md-spacer\s*\{\s*[^}]*height:\s*2px;/s);
  assert.match(css, /\.md-heading\s*\{\s*[^}]*margin:\s*7px 0 2px;/s);
  assert.match(css, /\.md-paragraph,\s*\.md-list-item,\s*\.md-numbered-item\s*\{\s*[^}]*line-height:\s*1\.46;/s);
  assert.match(css, /\.md-list-item,\s*\.md-numbered-item\s*\{\s*[^}]*gap:\s*7px;/s);
  assert.match(css, /\.md-code-block\s*\{\s*[^}]*line-height:\s*1\.52;/s);
  assert.match(script, /pre\.classList\.add\(`language-\$\{normalizedLanguage\}`\);/);
  assert.match(script, /appendHighlightedCode\(pre, code, normalizedLanguage\);/);
  assert.match(script, /function normalizeCodeLanguage\(language\)/);
  assert.match(script, /function appendHighlightedCode\(container, code, language\)/);
  assert.match(script, /function appendCodeToken\(container, className, text\)/);
  assert.match(script, /function codeHighlightPatterns\(language\)/);
  assert.match(script, /function appendDiffHighlightedCode\(container, code\)/);
  assert.doesNotMatch(script, /pre\.textContent = code;/);
  assert.match(css, /\.md-token\.keyword\s*\{/);
  assert.match(css, /\.md-token\.string\s*\{/);
  assert.match(css, /\.md-token\.comment\s*\{/);
  assert.match(css, /\.md-token\.number\s*\{/);
  assert.match(css, /\.md-token\.property\s*\{/);
  assert.match(css, /\.md-token\.diff-add\s*\{/);
  assert.match(css, /\.md-token\.diff-remove\s*\{/);
  assert.match(css, /\.md-table-wrap\s*\{\s*[^}]*scrollbar-width:\s*thin;/s);
  assert.match(i18nScript, /'message\.statusElapsed': '\{status\} · \{elapsed\}'/);
});

test('webview renders edited files as an OpenCode-style change card', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(script, /const FILE_CARD_COLLAPSE_LIMIT = 3;/);
  assert.match(script, /summaryTitle\.textContent = i18n\.t\('fileCard\.edited'/);
  assert.match(script, /summaryMeta\.className = 'md-file-summary-meta';/);
  assert.match(script, /actions\.className = 'md-file-actions';/);
  assert.match(script, /button\.dataset\.fileCardAction = action;/);
  assert.match(script, /showMore\.dataset\.fileCardShowMore = 'true';/);
  assert.match(script, /fileResults\.slice\(0, FILE_CARD_COLLAPSE_LIMIT\)/);
  assert.match(script, /messages\.addEventListener\('click'[\s\S]*data-file-card-action/s);
  assert.match(script, /executeOpenCodeNativeSlashCommand\(\{ name: 'undo' \}\);/);
  assert.match(script, /send\('freeform', fileCardReviewPrompt\(\)\);/);
  assert.match(script, /function fileCardReviewPrompt\(\)/);
  assert.match(css, /\.md-file-summary\s*\{\s*[^}]*grid-template-columns:\s*28px minmax\(0, 1fr\) auto;/s);
  assert.match(css, /\.md-file-header-icon\s*\{/);
  assert.match(css, /\.md-file-actions\s*\{/);
  assert.match(css, /\.md-file-show-more\s*\{/);
  assert.match(css, /\.md-file-row.is-hidden\s*\{/);
  assert.match(i18nScript, /'fileCard\.edited': 'Edited \{count\} \{fileLabel\}'/);
  assert.match(i18nScript, /'fileCard\.edited': '已编辑 \{count\} 个文件'/);
  assert.match(i18nScript, /'fileCard\.showMore': 'Show \{count\} more \{fileLabel\}'/);
  assert.match(i18nScript, /'fileCard\.showMore': '再显示 \{count\} 个文件'/);
});

test('webview does not persist transient running message state', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const providerSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(providerSource, /private profilesById = new Map<string, CliProfile>/);
  assert.match(providerSource, /this\.profilesById\.set\(profile\.id, profile\)/);
  assert.match(providerSource, /this\.profilesById\.get\(cliId\) \?\? getCliProfile\(cliId\)/);
  assert.match(providerSource, /const NO_OUTPUT_NOTICE_MS = 45_000;/);
  assert.match(providerSource, /private noOutputNoticeTimers = new Map/);
  assert.match(providerSource, /command:\s*'sessionNotice'/);
  assert.match(providerSource, /runtimeT\(this\.locale,\s*'warning\.noOutput'/);
  assert.match(script, /threadsByProvider: serializeThreadsForState\(threadsByProvider\)/);
  assert.match(script, /const \{ startedAt, \.\.\.rest \} = message;/);
  assert.match(script, /return \{ \.\.\.rest, running: false \};/);
  assert.match(script, /running: false,\s*text: filterInternalPromptEcho\(message\.text\)\.text/s);
  assert.match(script, /case 'sessionNotice':\s*updateSessionNotice\(message\);/);
  assert.match(script, /item\.runningNotice = normalizeMessageText\(message\.text\);/);
  assert.match(script, /delete item\.runningNotice;/);
  assert.match(providerSource, /normalized\.status !== 'thinking'/);
  assert.match(script, /persist\(\);\s*renderAll\(\);/);
});

test('webview does not revive stopped assistant placeholders when a later request starts', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /const stoppedSessionIds = new Set\(\);/);
  assert.match(script, /function finishStreamTarget\(message, \{ removeEmpty = true \} = \{\}\)/);
  assert.match(script, /item\.running = false;/);
  assert.match(script, /stoppedSessionIds\.add\(message\.sessionId\);/);
  assert.match(script, /const wasStopped = stoppedSessionIds\.delete\(message\.sessionId\);/);
  assert.match(script, /Number\(message\.exitCode\) !== 0 && !wasStopped/);
});

test('webview form controls opt out of browser autocomplete noise', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');

  assert.match(html, /id="promptInput"[^>]*name="assistantPrompt"[^>]*autocomplete="off"/);
  assert.match(html, /id="providerSelect"[^>]*name="assistantProvider"/);
  assert.match(html, /id="modelSelect"[^>]*name="assistantModel"/);
  assert.match(html, /id="customModelInput"[^>]*name="assistantCustomModel"[^>]*autocomplete="off"/);
  assert.match(html, /id="runtimeSelect"[^>]*name="assistantRuntime"/);
  assert.match(html, /id="permissionSelect"[^>]*name="assistantPermission"/);
  assert.match(html, /id="agentModeSelect"[^>]*name="assistantAgentMode"/);
  assert.match(html, /id="actionSelect"[^>]*name="assistantAction"/);
});

test('webview exposes a provider-aware slash command palette', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(html, /id="slashPalette"[^>]*role="listbox"/);
  assert.match(script, /const SLASH_COMMANDS = \[/);
  assert.match(script, /providers:\s*\['claude'\]/);
  assert.match(script, /providers:\s*\['codex'\]/);
  assert.match(script, /providers:\s*\['opencode'\]/);
  assert.match(script, /providers:\s*\['gemini'\]/);
  assert.match(script, /providers:\s*\['goose'\]/);
  assert.match(script, /providers:\s*\['aider'\]/);
  assert.match(script, /function slashCommandMatchesProvider/);
  assert.match(script, /name:\s*'new',\s*aliases:\s*\['clear'\]/);
  assert.match(script, /name:\s*'sessions',\s*aliases:\s*\['session',\s*'resume',\s*'continue'\],\s*kind:\s*'local',\s*local:\s*'sessions',\s*providers:\s*\['opencode'\]/);
  assert.match(script, /name:\s*'models',\s*aliases:\s*\['model'\],\s*kind:\s*'local',\s*local:\s*'models',\s*providers:\s*\['opencode'\]/);
  assert.match(script, /name:\s*'agents',\s*aliases:\s*\['agent'\],\s*kind:\s*'local',\s*local:\s*'agents',\s*providers:\s*\['opencode'\]/);
  assert.match(script, /name:\s*'mcps',\s*aliases:\s*\['mcp'\],\s*kind:\s*'local',\s*local:\s*'mcp',\s*providers:\s*\['opencode'\]/);
  assert.match(script, /name:\s*'variants',\s*kind:\s*'local',\s*local:\s*'variants',\s*providers:\s*\['opencode'\]/);
  assert.match(script, /name:\s*'connect',\s*kind:\s*'local',\s*local:\s*'connect',\s*providers:\s*\['opencode'\]/);
  assert.match(script, /name:\s*'org',\s*aliases:\s*\['orgs',\s*'switch-org'\],\s*kind:\s*'local',\s*local:\s*'org',\s*providers:\s*\['opencode'\]/);
  assert.match(script, /name:\s*'status',\s*kind:\s*'local',\s*local:\s*'status',\s*providers:\s*\['opencode'\]/);
  assert.match(script, /name:\s*'themes',\s*aliases:\s*\['theme'\],\s*kind:\s*'local',\s*local:\s*'themes',\s*providers:\s*\['opencode'\]/);
  assert.match(script, /name:\s*'exit',\s*aliases:\s*\['quit',\s*'q'\],\s*kind:\s*'local',\s*local:\s*'exit',\s*providers:\s*\['opencode'\]/);
  assert.match(script, /const OPENCODE_SLASH_COMMAND_NAMES = new Set/);
  assert.match(script, /seen\.has\(command\.name\)/);
  assert.match(script, /case 'sessions':/);
  assert.match(script, /case 'sessions':\s*closeComposerMenus\(\);\s*showOpenCodeStatusDialog\('sessions'\);\s*return;/s);
  assert.match(script, /case 'models':/);
  assert.match(script, /case 'models':\s*closeComposerMenus\(\);\s*showOpenCodeStatusDialog\('models'\);\s*return;/s);
  assert.match(script, /case 'agents':/);
  assert.match(script, /case 'agents':\s*closeComposerMenus\(\);\s*showOpenCodeStatusDialog\('agents'\);\s*return;/s);
  assert.match(script, /case 'variants':/);
  assert.match(script, /showOpenCodeStatusDialog\('variants'\)/);
  assert.match(script, /case 'status':/);
  assert.match(script, /showOpenCodeStatusDialog\('status'\)/);
  assert.match(script, /case 'themes':/);
  assert.match(script, /showOpenCodeStatusDialog\('themes'\)/);
  assert.match(script, /case 'connect':/);
  assert.match(script, /openSettingsPage\('apiProviders'\)/);
  assert.match(script, /function renderOpenCodeOptionDialogBody\(body, kind\)/);
  assert.match(script, /function renderOpenCodeGroupedOptionDialogBody\(body, kind\)/);
  assert.match(script, /const OPENCODE_OPTION_DIALOG_KINDS = new Set\(\['sessions', 'models', 'agents'\]\);/);
  assert.match(script, /dialog\.setAttribute\('aria-labelledby', title\.id\);/);
  assert.match(script, /dialog\.setAttribute\('aria-describedby', description\.id\);/);
  assert.match(script, /if \(openCodeDialogKind\) \{\s*event\.preventDefault\(\);\s*closeOpenCodeStatusDialog\(\);/s);
  assert.match(script, /function handleOpenCodeOptionDialogKeydown\(event\)/);
  assert.match(script, /dialog\.addEventListener\('keydown', handleOpenCodeOptionDialogKeydown\);/);
  assert.match(script, /event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'/);
  assert.match(script, /selectOpenCodeDialogOption\(openCodeDialogKind, option\.id\)/);
  assert.match(script, /openCodeDialogActiveIndex = initialOpenCodeDialogActiveIndex\(kind\);/);
  assert.match(script, /option\.id === openCodeDialogActiveOptionId\(kind\) \? 'is-active' : ''/);
  assert.match(script, /openCodeDialogQuery = filter\.value;\s*openCodeDialogActiveIndex = 0;\s*renderOpenCodeModelGroups\(list\);/);
  assert.match(script, /function renderOpenCodeMcpDialogBody\(body\)/);
  assert.match(script, /function openCodeMcpDialogOptions\(\)/);
  assert.match(script, /function toggleOpenCodeMcp\(cliId, name\)/);
  assert.match(script, /function openCodeModelOptionGroups\(\)/);
  assert.match(script, /function openCodeDialogOptions\(kind\)/);
  assert.match(script, /function selectOpenCodeDialogOption\(kind, value\)/);
  assert.match(script, /disabledMcpByProvider/);
  assert.match(script, /openCodeDialogActiveIndex/);
  assert.match(script, /className = 'opencode-dialog-filter'/);
  assert.match(script, /className = 'opencode-dialog-group-heading'/);
  assert.match(script, /className = 'opencode-dialog-option-footer'/);
  assert.match(script, /className = `opencode-dialog-option-footer is-\$\{option\.enabled \? 'enabled' : 'disabled'\}`/);
  assert.match(script, /className = 'opencode-dialog-footer-actions'/);
  assert.match(script, /i18n\.t\('opencode\.dialog\.mcp\.title'\)/);
  assert.match(script, /i18n\.t\('opencode\.dialog\.mcp\.search'\)/);
  assert.match(script, /i18n\.t\('opencode\.dialog\.mcp\.searchAria'\)/);
  assert.match(script, /i18n\.t\('opencode\.dialog\.mcp\.enabled'\)/);
  assert.match(script, /i18n\.t\('opencode\.dialog\.mcp\.disabled'\)/);
  assert.match(script, /i18n\.t\('opencode\.dialog\.mcp\.empty'\)/);
  assert.match(script, /i18n\.t\('opencode\.dialog\.mcp\.status\.connected'\)/);
  assert.match(script, /i18n\.t\('opencode\.dialog\.mcp\.status\.needsAuth'\)/);
  assert.match(script, /i18n\.t\('opencode\.dialog\.mcp\.status\.failed'\)/);
  assert.match(script, /i18n\.t\('opencode\.dialog\.mcp\.toggle'\)/);
  assert.match(script, /i18n\.t\('opencode\.dialog\.mcp\.space'\)/);
  assert.match(script, /button\.dataset\.opencodeDialogValue = option\.id;/);
  assert.match(script, /if \(openCodeDialogKind === 'mcp'\)/);
  assert.match(script, /event\.key === ' '/);
  assert.match(script, /activeModelByProvider\[activeId\] = value;/);
  assert.match(script, /activeAgentModeByProvider\[activeId\] = value;/);
  assert.match(script, /setActiveThread\('opencode', thread\)/);
  assert.match(script, /function executeOpenCodeNativeSlashCommand/);
  assert.match(script, /command: 'openCodeNativeCommand'/);
  assert.match(script, /openCodeSessionId: activeOpenCodeSessionId\(\)/);
  assert.match(script, /const OPENCODE_NATIVE_API_COMMAND_NAMES = new Set\(\[[\s\S]*'fork'/);
  assert.match(script, /function handleOpenCodeForkResult/);
  assert.match(script, /message\.newOpenCodeSessionId/);
  assert.match(script, /case 'openCodeNativeCommandResult':/);
  assert.match(script, /function renderSlashPalette/);
  assert.match(script, /function executeSlashCommand/);
  assert.match(script, /function slashInputLooksLikeCommand\(query\)/);
  assert.match(script, /if \(slash && slashMatches\.length > 0\) \{/);
  assert.match(script, /query\.includes\('\/'\)/);
  assert.match(script, /footer\.className = 'slash-footer';/);
  assert.match(script, /i18n\.t\('slash\.footer\.accept', \{ command: slashMatches\[slashActiveIndex\]\.name \}\)/);
  assert.match(script, /event\.key === 'ArrowDown'/);
  assert.match(script, /event\.key === 'Tab'/);
  assert.match(script, /slashMatches\.length > 0 && \(event\.key === 'Tab' \|\| \(event\.key === 'Enter' && !event\.shiftKey\)\)/);
  assert.match(script, /sendBtn\.addEventListener\('click', \(event\) => \{\s*event\.stopPropagation\(\);/s);
  assert.match(script, /parseSlashInput\(input\.value\)/);
  assert.match(script, /send\(command\.action,\s*command\.prompt/);
  assert.match(script, /setActiveThread/);
  assert.match(css, /\.slash-palette\s*\{/);
  assert.match(css, /\.slash-command\.is-active\s*\{/);
  assert.match(script, /title\.className = 'slash-command-label';/);
  assert.match(css, /\.slash-palette\s*\{[^}]*font-family:\s*var\(--vscode-editor-font-family/);
  assert.match(css, /\.slash-palette\s*\{[^}]*position:\s*static;/);
  assert.match(css, /\.slash-palette\s*\{[^}]*width:\s*100%;/);
  assert.match(css, /\.slash-palette\s*\{[^}]*border-bottom:\s*1px solid var\(--assistant-border\);/);
  assert.doesNotMatch(css, /\.slash-palette\s*\{[^}]*\n\s*bottom:/);
  assert.match(css, /\.slash-command\s*\{[^}]*grid-template-columns:\s*minmax\(160px,\s*240px\) minmax\(0,\s*1fr\);/);
  assert.match(css, /body\[data-provider="opencode"\] \.slash-palette\s*\{[^}]*width:\s*100%;/);
  assert.match(css, /body\[data-provider="opencode"\] \.slash-palette\s*\{[^}]*box-shadow:\s*none;/);
  assert.match(css, /body\[data-provider="opencode"\] \.slash-command\s*\{[^}]*grid-template-columns:\s*minmax\(238px,\s*260px\) minmax\(0,\s*1fr\);/);
  assert.match(css, /\.slash-command\.is-active\s*\{[^}]*background:\s*var\(--vscode-list-activeSelectionBackground/);
  assert.match(css, /\.slash-footer\s*\{/);
  assert.doesNotMatch(css, /\.slash-palette\s*\{[^}]*border-radius:\s*7px;/);
  assert.match(css, /\.opencode-dialog-option\s*\{/);
  assert.match(css, /\.opencode-dialog-option\.is-selected\s*\{/);
  assert.match(css, /\.opencode-dialog-option\.is-active\s*\{/);
  assert.match(css, /\.opencode-dialog-filter\s*\{/);
  assert.match(css, /\.opencode-dialog-group-heading\s*\{/);
  assert.match(css, /\.opencode-dialog-option-footer\s*\{/);
  assert.match(css, /\.opencode-dialog-option-footer\.is-enabled\s*\{/);
  assert.match(css, /\.opencode-dialog-option-footer\.is-disabled\s*\{/);
  assert.match(css, /\.opencode-dialog-footer-actions\s*\{/);
  assert.match(i18nScript, /'slash\.empty'/);
  assert.match(i18nScript, /'slash\.unsupported'/);
  assert.match(i18nScript, /'slash\.sessions\.desc'/);
  assert.match(i18nScript, /'slash\.models\.desc'/);
  assert.match(i18nScript, /'slash\.agents\.desc'/);
  assert.match(i18nScript, /'slash\.mcps\.desc'/);
  assert.match(i18nScript, /'slash\.variants\.desc'/);
  assert.match(i18nScript, /'slash\.footer\.accept'/);
  assert.match(i18nScript, /'slash\.footer\.commands'/);
  assert.match(i18nScript, /'slash\.connect\.desc'/);
  assert.match(i18nScript, /'slash\.status\.desc'/);
  assert.match(i18nScript, /'slash\.themes\.desc'/);
  assert.match(i18nScript, /'slash\.exit\.desc'/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.title': 'MCPs'/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.search': 'Search'/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.enabled': 'Enabled'/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.disabled': 'Disabled'/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.status\.connected': 'Connected'/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.status\.needsAuth': 'Needs auth'/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.status\.failed': 'Failed'/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.toggle': 'toggle'/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.space': 'space'/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.title': 'MCPs'/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.search': '搜索'/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.enabled': '已启用'/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.disabled': '已禁用'/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.status\.connected': '已连接'/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.status\.needsAuth': '需要认证'/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.status\.failed': '失败'/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.toggle': '切换'/);
  assert.match(i18nScript, /'opencode\.dialog\.mcp\.space': '空格'/);
});

test('opencode fork native command creates and switches to the forked session', () => {
  const typesSource = readFileSync(new URL('../src/assistantTypes.ts', import.meta.url), 'utf8');
  const cliSource = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(typesSource, /\| 'fork'/);
  assert.match(typesSource, /newOpenCodeSessionId\?: string;/);
  assert.match(cliSource, /if \(command === 'fork'\)/);
  assert.match(cliSource, /this\.openCodeSessionUrl\(serverUrl, sessionId, '\/fork'\)/);
  assert.match(cliSource, /newOpenCodeSessionId: forkedSessionId/);
  assert.match(sidebarSource, /newOpenCodeSessionId: result\.newOpenCodeSessionId/);
  assert.match(script, /function handleOpenCodeForkResult\(message\)/);
  assert.match(script, /forkedThread\.openCodeSessionId = message\.newOpenCodeSessionId;/);
  assert.match(script, /setActiveThread\('opencode', forkedThread\);/);
  assert.match(i18nScript, /'slash\.opencode\.forked'/);
});

test('webview slash command palette shows each command label once', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.doesNotMatch(script, /slash-command-name/);
  assert.doesNotMatch(css, /\.slash-command-name\s*\{/);
  assert.doesNotMatch(css, /grid-template-columns:\s*minmax\(58px,/);
});

test('webview reduces decorative motion when requested', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.message-spinner,\s*\.cursor,\s*\.message-activity-inline\.is-running \.message-activity-text,\s*\.message-status\.is-running \.message-status-label,\s*\.message-status\.is-running \.message-spinner\s*\{[^}]*animation:\s*none;/s);
});

test('webview uses a ring spinner for running message status', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const runningSpinnerRule = css.match(/\.message-status\.is-running \.message-spinner\s*\{(?<body>[^}]+)\}/s)?.groups?.body ?? '';
  const spinnerRule = css.match(/\.message-spinner\s*\{(?<body>[^}]+)\}/s)?.groups?.body ?? '';

  assert.match(spinnerRule, /conic-gradient/);
  assert.match(spinnerRule, /will-change:\s*transform/);
  assert.match(spinnerRule, /contain:\s*paint/);
  assert.match(spinnerRule, /animation:\s*message-spin 1s linear infinite/);
  assert.doesNotMatch(spinnerRule, /border-top-color:/);
  assert.doesNotMatch(runningSpinnerRule, /border-top-color:/);
  assert.doesNotMatch(runningSpinnerRule, /dot-pulse/);
});

test('preview webview streams markdown with real line breaks', () => {
  const script = readFileSync(new URL('../scripts/preview-webview.mjs', import.meta.url), 'utf8');

  assert.match(script, /\.join\('\\\\n'\)/);
  assert.doesNotMatch(script, /\.join\('\\\\\\\\n'\)/);
  assert.match(script, /'\\\\u001b\[0m'/);
  assert.doesNotMatch(script, /'\\\\\\\\u001b\[0m'/);
});

test('webview disables freeform send until the prompt has text', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /const hasPrompt = input\.value\.trim\(\)\.length > 0;/);
  assert.match(script, /const hasAttachments = promptAttachments\.length > 0;/);
  assert.match(script, /const missingCustomModel = activeModel\(\)\?\.custom && !activeCustomModel\(activeId\);/);
  assert.match(script, /const canRunAction = hasPrompt \|\| hasAttachments \|\| selectedAction !== 'freeform';/);
  assert.match(script, /sendBtn\.disabled = !canSend \|\| busy \|\| !canRunAction \|\| missingSelection \|\| missingCustomModel;/);
});

test('agent mode select is persisted per provider', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const extensionSource = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
  const syncedStateSource = readFileSync(new URL('../src/syncedState.ts', import.meta.url), 'utf8');

  assert.match(script, /activeAgentModeByProvider/);
  assert.match(script, /activeModelByProvider/);
  assert.match(script, /recentModelByProvider/);
  assert.match(script, /favoriteModelByProvider/);
  assert.match(script, /disabledMcpByProvider/);
  assert.match(script, /customModelByProvider/);
  assert.match(script, /activeRuntimeByProvider/);
  assert.match(script, /activePermissionByProvider/);
  assert.match(script, /contextOptions/);
  assert.match(script, /let hasAppliedPersistentSelection = false;/);
  assert.match(script, /function persistUserSelection\(\)/);
  assert.match(script, /function schedulePersistUserSelection\(\)/);
  assert.match(script, /command: 'saveSelectionState'/);
  assert.match(script, /activeProviderId: activeId/);
  assert.match(script, /recentModelByProvider,/);
  assert.match(script, /favoriteModelByProvider,/);
  assert.match(script, /disabledMcpByProvider,/);
  assert.match(script, /customModelByProvider,/);
  assert.match(script, /activeRuntimeByProvider,/);
  assert.match(script, /activePermissionByProvider,/);
  assert.match(script, /contextOptions,/);
  assert.match(script, /persistedSelectionMap\(message\.activeAgentModeByProvider\)/);
  assert.match(script, /persistedSelectionMap\(message\.activeRuntimeByProvider\)/);
  assert.match(script, /message\.activeProviderId/);
  assert.match(sidebarSource, /case 'saveSelectionState':/);
  assert.match(sidebarSource, /private async saveSelectionState\(message: unknown\)/);
  assert.match(sidebarSource, /this\.state\.update\(LAST_PROVIDER_STATE_KEY, providerId\)/);
  assert.match(sidebarSource, /this\.state\.update\(\s*AGENT_MODE_STATE_KEY,/s);
  assert.match(sidebarSource, /this\.state\.update\(RUNTIME_STATE_KEY,/);
  assert.match(sidebarSource, /this\.state\.update\(PERMISSION_STATE_KEY,/);
  assert.match(sidebarSource, /this\.state\.update\(CONTEXT_OPTIONS_STATE_KEY,/);
  assert.match(extensionSource, /context\.globalState\.setKeysForSync\(SYNCED_GLOBAL_STATE_KEYS\)/);
  assert.match(syncedStateSource, /LAST_PROVIDER_STATE_KEY = 'agents-gui\.lastProviderId'/);
  assert.match(syncedStateSource, /DISABLED_MCP_STATE_KEY = 'agents-gui\.disabledMcpByProvider'/);
  assert.match(syncedStateSource, /CONTEXT_OPTIONS_STATE_KEY = 'agents-gui\.contextOptions'/);
  assert.match(syncedStateSource, /SYNCED_GLOBAL_STATE_KEYS = \[/);
  assert.match(script, /agentModeSelect\.addEventListener\('change'/);
  assert.match(script, /modelSelect\.addEventListener\('change'/);
  assert.match(script, /modelOptionList\?\.addEventListener\('click'/);
  assert.match(script, /runtimeSelect\.addEventListener\('change'/);
  assert.match(script, /permissionSelect\.addEventListener\('change'/);
  assert.match(script, /customModelInput\.addEventListener\('input'/);
  assert.match(script, /agentMode: preferredWorkflowMode \|\| activeAgentModeId\(providerId\)/);
  assert.match(script, /model: activeModelId\(providerId\)/);
  assert.match(script, /customModel: activeCustomModel\(providerId\)/);
  assert.match(script, /runtime: activeRuntimeId\(providerId\)/);
  assert.match(script, /permissionMode: activePermissionId\(providerId\)/);
  assert.doesNotMatch(script, /opencode'\s*\?\s*'build'/);
});

test('webview localizes provider option labels in composer controls', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(script, /function localizedCliOption\(option, group\)/);
  assert.match(script, /renderOptionSelect\(modelSelect, options, model\.id, 'model'\)/);
  assert.match(script, /renderOptionSelect\(runtimeSelect, options, runtime\.id, 'runtime'\)/);
  assert.match(script, /renderOptionSelect\(permissionSelect, options, permission\.id, 'permission'\)/);
  assert.match(script, /localizedCliOption\(mode, 'agentMode'\)/);
  assert.match(i18nScript, /'option\.model\.default': '默认'/);
  assert.match(i18nScript, /'option\.model\.configured': '当前配置'/);
  assert.match(i18nScript, /'option\.model\.custom': '自定义'/);
  assert.match(i18nScript, /'option\.runtime\.localProcessing': '在本地处理'/);
  assert.match(i18nScript, /'option\.runtime\.localProcessing\.summary': '本地模式'/);
  assert.match(i18nScript, /'option\.permission\.readOnly': '只读'/);
  assert.match(i18nScript, /'option\.permission\.workspaceWrite': '默认权限'/);
  assert.match(i18nScript, /'option\.permission\.fullAuto': '自动审查'/);
  assert.match(i18nScript, /'option\.permission\.danger': '完全访问权限'/);
  assert.match(i18nScript, /'option\.agentMode\.configured': '当前配置'/);
  assert.match(i18nScript, /'option\.agentMode\.build': '执行'/);
  assert.match(i18nScript, /'option\.agentMode\.plan': '规划'/);
  assert.match(i18nScript, /'agentMode\.subagent': '子代理'/);
});

test('webview front-end explains and blocks selection-only actions without selection', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /function actionRequiresSelection\(action\)/);
  assert.match(script, /function hasSelectionContext\(\)/);
  assert.match(script, /actionRequiresSelection\(selectedAction\) && !hasSelectionContext\(\)/);
  assert.match(script, /quick\.missingSelection/);
  assert.match(
    script,
    /if \(action === 'openSettings'\) \{\s*button\.disabled = false;\s*button\.title = '';\s*return;/
  );
});

test('webview confirms deleting conversation history inside the webview', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(script, /function showDeleteThreadDialog\(cliId = activeId\)/);
  assert.match(script, /function closeDeleteThreadDialog\(\)/);
  assert.match(script, /backdrop\.className = 'session-delete-backdrop';/);
  assert.match(script, /if \(event\.target === backdrop\) \{\s*closeDeleteThreadDialog\(\);/s);
  assert.match(script, /dialog\.className = 'session-delete-dialog';/);
  assert.match(script, /if \(event\.key === 'Escape'\) \{\s*event\.preventDefault\(\);\s*closeDeleteThreadDialog\(\);/s);
  assert.match(script, /cancel\.addEventListener\('click', closeDeleteThreadDialog\);/);
  assert.match(script, /deleteActiveThread\(cliId\);/);
  assert.match(script, /requestAnimationFrame\(\(\) => cancel\.focus\(\)\);/);
  assert.doesNotMatch(script, /window\.confirm/);
  assert.match(css, /\.session-delete-backdrop\s*\{/);
  assert.match(css, /\.session-delete-dialog\s*\{/);
  assert.match(i18nScript, /'history\.deleteConfirmTitle': 'Delete session\?'/);
  assert.match(i18nScript, /'history\.deleteConfirmTitle': '删除当前会话？'/);
});

test('webview deletes the active conversation through a single session cleanup path', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /function deleteActiveThread\(cliId = activeId\)/);
  assert.match(script, /const deletedOpenCodeSessionId = cliId === 'opencode' \? thread\.openCodeSessionId : '';/);
  assert.match(script, /command: 'deleteOpenCodeSession'/);
  assert.match(script, /delete activeThreadByProvider\[cliId\];/);
  assert.match(script, /deleteThreadBtn\.disabled = !canDeleteActiveThread\(activeId\);/);
  assert.doesNotMatch(script, /const next = threads\.sort\(\(a, b\) => b\.updatedAt - a\.updatedAt\)\[0\] \|\| createThread\(activeId\);/);
});

test('extension deletes the backing OpenCode session when local history is removed', () => {
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const cliSource = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');

  assert.match(sidebarSource, /case 'deleteOpenCodeSession':/);
  assert.match(sidebarSource, /this\.cliManager\.deleteOpenCodeSession\(message\.openCodeSessionId\)/);
  assert.match(cliSource, /async deleteOpenCodeSession\(sessionId: string \| undefined\): Promise<boolean>/);
  assert.match(
    cliSource,
    /await this\.requestJson\(this\.openCodeSessionUrl\(serverUrl, sessionId\), \{\s*method: 'DELETE',\s*timeoutMs: OPEN_CODE_REQUEST_TIMEOUT_MS,\s*\}\);/s
  );
});

test('webview does not add noisy success system message after every run', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /Number\(message\.exitCode\) !== 0/);
  assert.doesNotMatch(script, /const text = Number\(message\.exitCode\) === 0/);
});

test('webview context chip renders a live context summary', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /function renderContextChipText\(\)/);
  assert.match(script, /contextSummaryLabel\.textContent = renderContextChipText\(\);/);
});

test('webview visually distinguishes disabled suggested actions', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /\.suggestion-button:disabled/);
  assert.match(css, /cursor: not-allowed/);
});

test('normalizeCliOutput strips ANSI terminal control codes', () => {
  assert.equal(normalizeCliOutput('\u001b[0m> Sisyphus\u001b[0m\r\n'), '> Sisyphus\n');
});

test('normalizeCliOutput strips orphan ANSI fragments left by chunk splits', () => {
  assert.equal(normalizeCliOutput('[0m\n> Sisyphus - Ultraworker\n[0m'), '\n> Sisyphus - Ultraworker\n');
});

test('normalizeCliOutput hides OpenCode run banners before response text', () => {
  assert.equal(
    normalizeCliOutput('\u001b[0m\n> \u200bSisyphus - Ultraworker · mimo-v2.5-pro\n\u001b[0m', 'opencode'),
    ''
  );
  assert.equal(
    normalizeCliOutput(
      '\u001b[0m\n> \u200bSisyphus - Ultraworker · mimo-v2.5-pro\n\u001b[0m我是Sisyphus。\n',
      'opencode'
    ),
    '我是Sisyphus。\n'
  );
});

test('normalizeCliOutput condenses OpenCode model errors into a readable message', () => {
  assert.equal(
    normalizeCliOutput(
      [
        'ProviderModelNotFoundError: ProviderModelNotFoundError',
        ' data: {',
        '  providerID: "mimo",',
        '  modelID: "mimo-v2-pro",',
        '  suggestions: [ "mimo-v2.5-pro" ],',
        '},',
        '',
        '      at <anonymous> (/$bunfs/root/chunk-erdf7dmy.js:553:62143)',
        '',
        '\u001b[91m\u001b[1mError: \u001b[0mModel not found: mimo/mimo-v2-pro. Did you mean: mimo-v2.5-pro?',
        '',
      ].join('\n'),
      'opencode'
    ),
    'Error: Model not found: mimo/mimo-v2-pro. Did you mean: mimo-v2.5-pro?\n'
  );
});

test('normalizeCliOutput condenses OpenCode format errors without leaking prompt context', () => {
  assert.equal(
    normalizeCliOutput(
      [
        '你是谁',
        '',
        'Recent conversation in this thread:',
        'Use this to answer follow-up questions and avoid asking the user to repeat prior details.',
        '- User: 你是谁',
        '- Assistant: 我是 Sisyphus。',
        '',
        'IDE context, use only if relevant:',
        'IDE context:',
        'Workspace: pc',
        'Workspace root: /Users/t/6bt/project/xiaoyaojing-platform/web/pc',
        '',
        'Reply in Chinese (简体中文). Do not mix languages.',
        '',
        'Keep the answer concise. Do not inspect the project unless the request needs it.',
        '',
        'If the request involves code changes, include a compact delivery checklist:',
        '- Files changed: list each file path and the exact change.',
        '- Verification: commands or checks that confirm the change is correct (or explain why verification is not possible).',
        '- Risks and caveats: call out assumptions, follow-up work, and edge cases.',
        'Error: Model big-pickle not supported for format anthropic',
      ].join('\n'),
      'opencode'
    ),
    'Error: Model big-pickle is not supported for format anthropic. Switch to another OpenCode model/provider and retry.\n'
  );
});

test('normalizeCliOutput hides OpenCode terminal tool traces', () => {
  assert.equal(
    normalizeCliOutput(
      [
        '⚙ neural-memory_nmem_context',
        '{"limit":5,"fresh_only":true}',
        '⚙ session_read',
        '{"limit":10,"session_id":"ses_123"}',
        '⚙ neural-memory_nmem_recall {"query":"慢 slow performance speed"}',
        '',
        '我很好，随时准备干活！',
      ].join('\n'),
      'opencode'
    ),
    '我很好，随时准备干活！'
  );
});

test('normalizeCliOutputChunk streams OpenCode JSON event deltas', () => {
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"message.part.delta","properties":{"part":{"type":"text"},"delta":"你"}}\n',
      'opencode'
    ),
    { text: '你', buffer: '' }
  );

  const partial = normalizeCliOutputChunk(
    '{"type":"message.part.delta","properties":{"part":{"type":"text"},"delta":"好',
    'opencode'
  );
  assert.deepEqual(partial, {
    text: '',
    buffer: '{"type":"message.part.delta","properties":{"part":{"type":"text"},"delta":"好',
  });
  assert.deepEqual(normalizeCliOutputChunk('。"}}\n', 'opencode', partial.buffer), {
    text: '好。',
    buffer: '',
  });
});

test('normalizeCliOutputChunk streams Claude Code partial text deltas', () => {
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"你"}}}\n',
      'claude'
    ),
    { text: '你', buffer: '' }
  );

  const partial = normalizeCliOutputChunk(
    '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"好',
    'claude'
  );
  assert.deepEqual(partial, {
    text: '',
    buffer:
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"好',
  });
  assert.deepEqual(normalizeCliOutputChunk('。"}}}\n', 'claude', partial.buffer), {
    text: '好。',
    buffer: '',
  });
});

test('normalizeCliOutputChunk hides Claude Code final JSON messages after partial streaming', () => {
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"完整内容"}]}}\n',
      'claude'
    ),
    { text: '', buffer: '' }
  );
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"先思考"}}}\n',
      'claude'
    ),
    { text: '', buffer: '', status: 'thinking' }
  );
});

test('normalizeCliOutputChunk streams OpenCode thinking details separately from answer text', () => {
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"message.part.delta","properties":{"part":{"type":"reasoning"},"delta":"先分析\\n再回答"}}\n',
      'opencode'
    ),
    { text: '', buffer: '', status: 'thinking', thinking: '先分析\n再回答' }
  );
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"message.part.delta","properties":{"part":{"type":"reasoning"},"delta":"The user is asking"}}\n',
      'opencode'
    ),
    { text: '', buffer: '', status: 'thinking', thinking: 'The user is asking' }
  );
});

test('normalizeCliOutputChunk maps OpenCode tool parts into activity updates', () => {
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"message.part.updated","properties":{"part":{"id":"prt_read","type":"tool","tool":"read","input":{"filePath":"src/sidebarProvider.ts"}}}}\n',
      'opencode'
    ),
    {
      text: '',
      buffer: '',
      status: 'thinking',
      activities: [
        {
          id: 'prt_read',
          kind: 'file',
          name: 'read',
          target: 'src/sidebarProvider.ts',
        },
      ],
    }
  );

  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"message.part.updated","properties":{"part":{"id":"prt_bash","type":"tool","tool":"bash","input":{"command":"rg thinking media/main.js"}}}}\n',
      'opencode'
    ),
    {
      text: '',
      buffer: '',
      status: 'thinking',
      activities: [
        {
          id: 'prt_bash',
          kind: 'command',
          name: 'bash',
          target: 'rg thinking media/main.js',
        },
      ],
    }
  );

  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"message.part.updated","properties":{"part":{"id":"prt_bash_json","type":"tool","tool":"bash","input":"{\\"command\\":\\"node --test tests/promptBuilder.test.mjs\\"}"}}}\n',
      'opencode'
    ),
    {
      text: '',
      buffer: '',
      status: 'thinking',
      activities: [
        {
          id: 'prt_bash_json',
          kind: 'command',
          name: 'bash',
          target: 'node --test tests/promptBuilder.test.mjs',
        },
      ],
    }
  );
});

test('OpenCode event stream keeps command details and logs from tool parts', () => {
  const { CliManager } = loadCliManagerWithVscode();
  const manager = new CliManager();
  const block = [
    'event: message.part.updated',
    `data: ${JSON.stringify({
      properties: {
        part: {
          id: 'prt_bash_sse',
          type: 'tool',
          tool: 'bash',
          input: '{"command":"npm run build"}',
          state: {
            output: 'Build complete.',
          },
        },
      },
    })}`,
  ].join('\n');

  assert.deepEqual(
    normalizeCliOutputChunk(
      manager.renderOpenCodeSseBlock(block, new Map(), new Map()),
      'opencode'
    ),
    {
      text: '',
      buffer: '',
      status: 'thinking',
      activities: [
        {
          id: 'prt_bash_sse',
          kind: 'command',
          name: 'bash',
          target: 'npm run build',
          detail: 'Build complete.',
        },
      ],
    }
  );
});

test('OpenCode event stream only emits output for the owned session', async () => {
  const { CliManager } = loadCliManagerWithVscode();
  const manager = new CliManager();
  const outputs = [];
  const originalGet = http.get;
  const response = new EventEmitter();
  response.setEncoding = () => {};
  const request = new EventEmitter();
  request.destroy = () => {};
  http.get = (_url, _options, callback) => {
    callback(response);
    queueMicrotask(() => {
      response.emit('data', openCodeSse('message.part.delta', {
        type: 'message.part.delta',
        sessionID: 'ses_other',
        partID: 'prt_other',
        field: 'text',
        delta: 'You are generating a Git commit message.',
      }));
      response.emit('data', openCodeSse('message.part.delta', {
        type: 'message.part.delta',
        sessionID: 'ses_target',
        partID: 'prt_target',
        field: 'text',
        delta: 'visible reply',
      }));
    });
    return request;
  };

  const stream = manager.openOpenCodeEventStream('http://127.0.0.1:17017', {
    fire(value) {
      outputs.push(value);
    },
  });

  try {
    await sleep(20);
    assert.deepEqual(outputs, []);

    stream.setSessionId('ses_target');
    await sleep(20);

    assert.equal(stream.hasOutput(), true);
    assert.deepEqual(outputs, [
      '{"type":"message.part.delta","sessionID":"ses_target","partID":"prt_target","field":"text","delta":"visible reply","properties":{"delta":"visible reply"}}\n',
    ]);
  } finally {
    stream.close();
    http.get = originalGet;
  }
});

test('normalizeCliOutputChunk handles OpenCode run JSON text events', () => {
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"text","timestamp":1,"sessionID":"ses_1","part":{"type":"text","text":"OK"}}\n',
      'opencode'
    ),
    { text: 'OK', buffer: '' }
  );
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"reasoning","timestamp":1,"sessionID":"ses_1","part":{"type":"reasoning","text":"先想一下"}}\n',
      'opencode'
    ),
    { text: '', buffer: '', status: 'thinking', thinking: '先想一下' }
  );
});

test('normalizeCliOutputChunk handles OpenCode updated text and message errors', () => {
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"type":"text","text":"fix(env): 添加空行"}}}\n',
      'opencode'
    ),
    { text: 'fix(env): 添加空行', buffer: '' }
  );
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"type":"reasoning","text":"先想一下"}}}\n',
      'opencode'
    ),
    { text: '', buffer: '', status: 'thinking', thinking: '先想一下' }
  );
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"message.updated","properties":{"sessionID":"ses_1","info":{"role":"assistant","error":{"name":"APIError","data":{"message":"Model quota exhausted","isRetryable":false}}}}}\n',
      'opencode'
    ),
    { text: 'Error: Model quota exhausted\n', buffer: '' }
  );
});

test('normalizeCliOutputChunk handles OpenCode top-level event fields from SSE', () => {
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"message.part.delta","partID":"prt_1","field":"text","delta":"chore(env): "}\n',
      'opencode'
    ),
    { text: 'chore(env): ', buffer: '' }
  );
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"message.part.updated","part":{"id":"prt_1","type":"text","text":"chore(env): 添加空行"}}\n',
      'opencode'
    ),
    { text: 'chore(env): 添加空行', buffer: '' }
  );
});

test('flushCliOutputBuffer emits a complete buffered OpenCode JSON event', () => {
  assert.equal(
    flushCliOutputBuffer(
      '{"type":"message.part.delta","properties":{"part":{"type":"text"},"delta":"OK"}}',
      'opencode'
    ),
    'OK'
  );
});

test('normalizeCliOutput explains OpenCode database lock errors', () => {
  assert.equal(
    normalizeCliOutput(
      "Error: Unexpected error\n\nFailed to run the query 'PRAGMA wal_checkpoint(PASSIVE)'",
      'opencode'
    ),
    'Error: OpenCode local database is locked by another running OpenCode server. Close that server or run this workspace from the same OpenCode server, then retry.\n'
  );
});

test('normalizeCliOutput surfaces OpenCode top-level provider errors', () => {
  const errorLine = '{"type":"error","timestamp":1778855556690,"sessionID":"ses_1","error":{"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details."}}}\n';

  assert.deepEqual(
    normalizeCliOutputChunk(errorLine, 'opencode'),
    {
      text: 'Error: Unexpected server error. Check server logs for details.\n',
      buffer: '',
    }
  );
  assert.equal(
    normalizeCliOutput(errorLine, 'opencode'),
    'Error: Unexpected server error. Check server logs for details.\n'
  );
});

test('cli manager can run OpenCode prompts through the server API and detect retry status', () => {
  const source = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');

  assert.match(source, /runOpenCodePromptViaServer/);
  assert.match(source, /modelId\?: string/);
  assert.match(source, /parseOpenCodeModelId\(modelId\)/);
  assert.match(source, /OPEN_CODE_SERVER_READY_TIMEOUT_MS/);
  assert.match(source, /waitForOpenCodeServerReady\(serverUrl, directory\)/);
  assert.match(source, /openCodeApiUrl\(serverUrl, '\/session', directory\)/);
  assert.match(source, /timeoutMs: OPEN_CODE_REQUEST_TIMEOUT_MS/);
  assert.match(source, /\/prompt_async`/);
  assert.match(source, /\.\.\.\(model \? \{ model \} : \{\}\)/);
  assert.match(source, /openCodeApiUrl\(serverUrl, '\/session\/status', directory\)/);
  assert.match(source, /url\.searchParams\.set\('directory', directory\)/);
  assert.match(source, /OpenCode request to \$\{url\.pathname\} timed out/);
  assert.match(source, /quota exhausted/i);
  assert.match(source, /abortOpenCodeServerSession/);
  assert.match(source, /extractOpenCodeAssistantText/);
});

test('OpenCode server commit generation listens for current-session provider errors', () => {
  const source = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');

  assert.match(source, /interface OpenCodeErrorStream/);
  assert.match(source, /openOpenCodeSessionErrorStream\(serverUrl, sessionId\)/);
  assert.match(source, /await errorStream\?\.ready/);
  assert.match(source, /errorStream\?\.error\(\)/);
  assert.match(source, /FreeUsageLimitError/);
  assert.match(source, /rate limit exceeded/i);
});

test('normalizeCliOutput condenses Codex JSON errors into a readable message', () => {
  assert.equal(
    normalizeCliOutput(
      'ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"Upgrade Codex first."}}\n',
      'codex'
    ),
    'Error: Upgrade Codex first.\n'
  );
});

test('normalizeCliOutput hides Codex internal telemetry and challenge noise', () => {
  assert.equal(
    normalizeCliOutput('2026-04-29T10:23:36.865183Z  WARN codex_analytics::client: events failed\n', 'codex'),
    ''
  );
  assert.equal(
    normalizeCliOutput('<html><script>window._cf_chl_opt = {}</script></html>', 'codex'),
    ''
  );
});

test('normalizeCliOutput removes an echoed internal assistant prompt before display', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'codex', name: 'Codex CLI' },
    mode: 'agent',
    agentMode: {
      id: 'exec',
      label: 'Exec',
      instruction: 'Implement scoped changes.',
    },
    action: 'explainSelection',
    message: '解释选中的代码。',
    context: {
      workspace: {
        name: 'agents-gui',
        rootPath: '/repo/agents-gui',
      },
      diagnostics: [],
    },
  });

  assert.equal(normalizeCliOutput(prompt), '');
  assert.equal(normalizeCliOutput(`${prompt}\n\n## 结果\n真实回答`), '## 结果\n真实回答');
});

test('normalizeCliOutput removes echoed OpenCode prompt wrappers before display', () => {
  const leakedPrompt = [
    '[analyze-mode]',
    'ANALYSIS MODE. Gather context before diving deep:',
    'CONTEXT GATHERING (parallel):',
    '',
    '"你是谁',
    '',
    'Recent conversation in this thread:',
    'Use this to answer follow-up questions and avoid asking the user to repeat prior details.',
    '- User: 你是谁',
    '- Assistant: 我是 Sisyphus',
    '',
    'IDE context, use only if relevant:',
    'IDE context:',
    'Workspace: pc',
    'Workspace root: /Users/t/6bt/project/xiaoyaojing-platform/web/pc',
    '',
    'Reply in Chinese (简体中文). Do not mix languages.',
    '',
    'Keep the answer concise. Do not inspect the project unless the request needs it.',
    '',
    'If the request involves code changes, include a compact delivery checklist:',
    '- Files changed: list each file path and the exact change.',
    '- Verification: commands or checks that confirm the change is correct (or explain why verification is not possible).',
    '- Risks and caveats: call out assumptions, follow-up work, and edge cases."我是 Sisyphus，来自 OhMyOpenCode 的 AI 代理。',
  ].join('\n');

  assert.equal(
    normalizeCliOutput(leakedPrompt, 'opencode'),
    '我是 Sisyphus，来自 OhMyOpenCode 的 AI 代理。'
  );
  assert.equal(
    normalizeCliOutput('[search-mode] should stay when it is plain response text', 'opencode'),
    '[search-mode] should stay when it is plain response text'
  );
});

test('normalizeCliOutputChunk removes echoed OpenCode prompt wrappers from thinking details', () => {
  const leakedPrompt = [
    '[search-mode]',
    'MAXIMIZE SEARCH EFFORT. Launch multiple background agents IN PARALLEL:',
    '',
    '[analyze-mode]',
    'ANALYSIS MODE. Gather context before diving deep:',
    '',
    '"你是谁哦',
    '',
    'Recent conversation in this thread:',
    'Use this to answer follow-up questions and avoid asking the user to repeat prior details.',
    '',
    'IDE context, use only if relevant:',
    'IDE context:',
    'Workspace: pc',
    'Workspace root: /Users/t/6bt/project/xiaoyaojing-platform/web/pc',
    '',
    'Reply in Chinese (简体中文). Do not mix languages.',
    '',
    'Keep the answer concise. Do not inspect the project unless the request needs it.',
    '',
    'If the request involves code changes, include a compact delivery checklist:',
    '- Files changed: list each file path and the exact change.',
    '- Verification: commands or checks that confirm the change is correct (or explain why verification is not possible).',
    '- Risks and caveats: call out assumptions, follow-up work, and edge cases.',
  ].join('\n');

  assert.deepEqual(
    normalizeCliOutputChunk(
      JSON.stringify({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'reasoning',
            text: leakedPrompt,
          },
        },
      }) + '\n',
      'opencode'
    ),
    {
      text: '',
      buffer: '',
      status: 'thinking',
    }
  );
});

test('normalizeCliOutputChunk keeps OpenCode prompt-analysis thinking for collapsed display', () => {
  assert.deepEqual(
    normalizeCliOutputChunk(
      JSON.stringify({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'reasoning',
            text: 'The user is asking “你是谁” and the message starts with `[analyze-mode]`. Reply in Chinese (简体中文).',
          },
        },
      }) + '\n',
      'opencode'
    ),
    {
      text: '',
      buffer: '',
      status: 'thinking',
      thinking: 'The user is asking “你是谁” and the message starts with `[analyze-mode]`. Reply in Chinese (简体中文).',
    }
  );
});

test('normalizeCliOutput preserves incomplete prompt chunks for the webview stream buffer', () => {
  assert.equal(
    normalizeCliOutput('You are an AI coding assistant embedded in VS Code.\nProvider: Codex CLI'),
    'You are an AI coding assistant embedded in VS Code.\nProvider: Codex CLI'
  );
});

test('selection-only actions are known before starting a CLI process', () => {
  assert.equal(actionRequiresSelection('explainSelection'), true);
  assert.equal(actionRequiresSelection('refactorSelection'), true);
  assert.equal(actionRequiresSelection('reviewFile'), false);
  assert.equal(actionRequiresSelection('generateTests'), false);
  assert.equal(actionRequiresSelection('freeform'), false);
});

test('current-file actions are known before starting a CLI process', () => {
  assert.equal(actionRequiresActiveFile('reviewFile'), true);
  assert.equal(actionRequiresActiveFile('explainSelection'), false);
  assert.equal(actionRequiresActiveFile('generateTests'), false);
  assert.equal(actionRequiresActiveFile('freeform'), false);
});

test('sidebar blocks selection-only actions before building a CLI prompt', () => {
  const source = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(source, /actionRequiresSelection\(action\) && !snapshot\.selection/);
  assert.match(source, /error\.missingSelection/);
});

test('sidebar blocks current-file actions before building a CLI prompt', () => {
  const source = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(source, /actionRequiresActiveFile\(action\) && !snapshot\.activeFile/);
  assert.match(source, /error\.missingActiveFile/);
});

test('editor explain action prefers provider read-only mode', () => {
  const source = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(source, /agentMode: action === 'explainSelection' \? preferredReadOnlyMode\(profile\) : undefined/);
  assert.match(source, /permissionMode: action === 'explainSelection' \? preferredReadOnlyPermission\(profile\) : undefined/);
  assert.match(source, /item\.id === 'plan'/);
  assert.match(source, /item\.id === 'suggest'/);
  assert.match(source, /item\.id === 'readOnly'/);
});

test('context collector keeps the last active editor when the sidebar has focus', async () => {
  const workspaceFolder = {
    name: 'agents-gui',
    uri: { fsPath: '/repo/agents-gui' },
  };
  const editor = {
    document: {
      uri: { fsPath: '/repo/agents-gui/src/current.ts' },
      languageId: 'typescript',
      lineCount: 1,
      getText: () => 'export const current = true;',
    },
    selection: {
      isEmpty: true,
    },
  };
  const fakeVscode = createFakeVscode(workspaceFolder, editor);
  const { AssistantContextCollector } = loadContextCollectorWithVscode(fakeVscode);
  const collector = new AssistantContextCollector();

  fakeVscode.window.activeTextEditor = undefined;
  fakeVscode.emitActiveTextEditor(undefined);

  const snapshot = await collector.collect({
    includeWorkspace: true,
    includeCurrentFile: true,
    includeSelection: true,
    includeDiagnostics: true,
  });

  assert.equal(snapshot.workspace?.name, 'agents-gui');
  assert.equal(snapshot.activeFile?.relativePath, 'src/current.ts');
  assert.equal(snapshot.activeFile?.text, 'export const current = true;');
});

test('context collector preserves multi-root workspace folders instead of only active file root', async () => {
  const workspaceFolders = [
    { name: 'qxs-finance-review', uri: { fsPath: '/Users/t/6bt/日常优化/qxs-finance-review' } },
    { name: 'daily-work', uri: { fsPath: '/Users/t/6bt/demand/daily-work' } },
    { name: 'ksh-mr', uri: { fsPath: '/Users/t/6bt/project/ksh-mr' } },
    { name: 'ksh-mr_vue3', uri: { fsPath: '/Users/t/6bt/project/ksh-mr_vue3' } },
  ];
  const editor = {
    document: {
      uri: { fsPath: '/Users/t/6bt/demand/daily-work/第四期prd.md' },
      languageId: 'markdown',
      lineCount: 24,
      getText: () => '# 第四期',
    },
    selection: {
      isEmpty: true,
    },
  };
  const fakeVscode = createFakeVscode(workspaceFolders[0], editor, {
    workspaceFolders,
    workspaceName: 'qxs-factory_vue3 (工作区)',
  });
  const { AssistantContextCollector } = loadContextCollectorWithVscode(fakeVscode);
  const collector = new AssistantContextCollector();

  const snapshot = await collector.collect({
    includeWorkspace: true,
    includeCurrentFile: true,
    includeSelection: true,
    includeDiagnostics: true,
  });

  assert.equal(snapshot.workspace?.name, 'qxs-factory_vue3 (工作区)');
  assert.equal(snapshot.workspace?.rootPath, '/Users/t/6bt/demand/daily-work');
  assert.equal(snapshot.workspace?.activeFolderName, 'daily-work');
  assert.equal(snapshot.workspace?.folders?.length, 4);
  assert.deepEqual(
    snapshot.workspace?.folders?.map((folder) => [folder.name, folder.active]),
    [
      ['qxs-finance-review', false],
      ['daily-work', true],
      ['ksh-mr', false],
      ['ksh-mr_vue3', false],
    ]
  );
  assert.equal(snapshot.activeFile?.relativePath, '第四期prd.md');
});

function createFakeVscode(workspaceFolder, activeTextEditor, options = {}) {
  let activeTextEditorListener = () => {};
  const workspaceFolders = options.workspaceFolders ?? [workspaceFolder];

  return {
    DiagnosticSeverity: {
      Error: 0,
      Warning: 1,
      Information: 2,
      Hint: 3,
    },
    window: {
      activeTextEditor,
      onDidChangeActiveTextEditor(listener) {
        activeTextEditorListener = listener;
        return { dispose() {} };
      },
    },
    workspace: {
      name: options.workspaceName,
      workspaceFolders,
      getWorkspaceFolder(uri) {
        return workspaceFolders.find((folder) => uri.fsPath.startsWith(folder.uri.fsPath));
      },
    },
    languages: {
      getDiagnostics: () => [],
    },
    emitActiveTextEditor(editor) {
      activeTextEditorListener(editor);
    },
  };
}

function loadContextCollectorWithVscode(fakeVscode) {
  const previousLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'vscode') {
      return fakeVscode;
    }
    return previousLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[require.resolve('../.test-dist/contextCollector.js')];
    return require('../.test-dist/contextCollector.js');
  } finally {
    Module._load = previousLoad;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openCodeSse(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function loadCliManagerWithVscode() {
  const previousLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'vscode') {
      return {
        workspace: {
          workspaceFolders: [],
        },
        EventEmitter: class {
          event() {
            return { dispose() {} };
          }
          fire() {}
          dispose() {}
        },
      };
    }
    return previousLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[require.resolve('../.test-dist/cliManager.js')];
    return require('../.test-dist/cliManager.js');
  } finally {
    Module._load = previousLoad;
  }
}
