import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const { buildAssistantPrompt } = require('../.test-dist/promptBuilder.js');
const { resolveRuntimeLocale, runtimeDefaultActionText } = require('../.test-dist/localization.js');
const {
  buildCliOptionArgs,
  getCliProfile,
  getCliModelOption,
  getCliPermissionMode,
  getCliRuntimeMode,
  resolveContextWindowTokens,
  resolveCliInstallHint,
} = require('../.test-dist/cliProfiles.js');
const { countContextTokens } = require('../.test-dist/tokenCounter.js');
const {
  filterPromptEchoChunk,
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
  parseOpenCodeModelsOutput,
} = require('../.test-dist/opencodeAgents.js');
const { normalizeMessageText, stripInlineMarkdown } = require('../media/messageText.js');
const inlineMarkdown = require('../media/inlineMarkdown.js');
const {
  extractMessageChoiceLineKeys,
  extractMessageChoices,
} = require('../media/messageChoices.js');
const providerRunState = require('../media/providerRunState.js');
const providerCapabilities = require('../media/providerCapabilities.js');
const conversationStore = require('../media/conversationStore.js');
const sessionHistory = require('../media/sessionHistory.js');
const slashCommands = require('../media/slashCommands.js');
const openCodeDialogState = require('../media/openCodeDialogState.js');
const claudeActions = require('../media/claudeActions.js');
const workbenchLayout = require('../media/workbenchLayout.js');
const taskBoardState = require('../media/taskBoardState.js');
const composerState = require('../media/composerState.js');
const providerOptions = require('../media/providerOptions.js');
const {
  deriveContextBudgetPresentation,
  formatPercentage,
  formatTokenCount,
} = require('../media/contextBudget.js');

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
  assert.match(
    prompt,
    /If the request involves code changes, include a compact delivery checklist:/
  );
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

  assert.match(
    prompt,
    /Do not review the whole workspace when current file context is unavailable/
  );
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
  assert.match(
    prompt,
    /error-screen\.png \(image\/png, 2 KB\): \/tmp\/agents-gui\/error-screen\.png/
  );
  assert.match(
    prompt,
    /Use these local image paths when the selected provider can inspect image files/
  );
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

test('buildAssistantPrompt does not inject runtime selections into OpenCode prompts', () => {
  const prompt = buildAssistantPrompt({
    provider: { id: 'opencode', name: 'OpenCode' },
    mode: 'agent',
    agentMode: {
      id: 'atlas',
      label: 'Atlas',
      instruction: 'Use provider-native behavior.',
    },
    action: 'freeform',
    message: '你用的什么模型呢',
    context: {
      diagnostics: [],
    },
  });

  assert.match(prompt, /^你用的什么模型呢/);
  assert.doesNotMatch(prompt, /Runtime selection from Agents GUI:/);
  assert.doesNotMatch(prompt, /Selected model:/);
  assert.doesNotMatch(prompt, /Reasoning depth:/);
  assert.doesNotMatch(prompt, /No IDE context was attached/);
});

test('interactive requests carry task text but no execution selections', () => {
  const sidebar = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const promptBuilder = readFileSync(new URL('../src/promptBuilder.ts', import.meta.url), 'utf8');
  const assistantTypes = readFileSync(new URL('../src/assistantTypes.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(sidebar, /buildCliOptionArgs|getCliRuntimeMode|getCliPermissionMode/);
  assert.doesNotMatch(sidebar, /continueSessionId|optionKey|apiProviderWarning/);
  assert.doesNotMatch(promptBuilder, /Runtime selection from Agents GUI|renderRuntimeSelection/);
  assert.doesNotMatch(
    assistantTypes,
    /modelVariant|customModel|permissionMode|AssistantRuntimeSelection/
  );
  assert.match(sidebar, /agentRuntime\.startPrompt\(\s*cliId,\s*profile\.inputMode === 'argument' \? prompt : undefined\s*\)/s);
});

test('selected agent modes affect only prompt and task-intent semantics', () => {
  const sidebar = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(sidebar, /const agentMode = getCliAgentMode\(profile, message\.agentMode\);/);
  assert.match(sidebar, /intent: resolveAgentTaskIntent\(action, agentMode\.id\),/);
  assert.match(sidebar, /agentMode: \{\s*id: agentMode\.id,\s*label: agentMode\.label,/s);
  assert.match(sidebar, /agentRuntime\.startPrompt\(\s*cliId,\s*profile\.inputMode === 'argument' \? prompt : undefined\s*\)/s);
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

test('all CLI profiles expose only native prompt transport arguments', () => {
  const expected = {
    claude: ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'],
    gemini: ['--output-format', 'text', '-p'],
    codex: ['exec', '--color', 'never'],
    opencode: ['run', '--format', 'json'],
    goose: ['run', '--quiet', '--output-format', 'text', '--text'],
    aider: ['--message'],
  };
  const forbidden = new Set([
    '--model',
    '--permission-mode',
    '--sandbox',
    '--full-auto',
    '--ephemeral',
    '--no-session',
    '--session',
    '--attach',
    '--thinking',
    '--approval-mode',
    '--skip-trust',
  ]);

  for (const [id, args] of Object.entries(expected)) {
    const profile = getCliProfile(id);
    assert.deepEqual(profile.promptArgs, args);
    assert.equal(profile.env, undefined);
    assert.equal(profile.backgroundServer, undefined);
    assert.equal(profile.runtimeModes, undefined);
    assert.equal(profile.permissionModes, undefined);
    assert.equal(profile.customModelArgPrefix, undefined);
    assert.equal(
      args.some((arg) => forbidden.has(arg)),
      false,
      id
    );
  }
});


test('opencode models output is parsed into observational configured models', () => {
  const options = parseOpenCodeModelsOutput(
    ['opencode/big-pickle', 'mimo/mimo-v2.5-pro', 'mimo/mimo-v2.5-pro', 'not a model line'].join(
      '\n'
    )
  );

  assert.deepEqual(
    options.map((option) => [option.id, option.label]),
    [
      ['opencode/big-pickle', 'opencode/big-pickle'],
      ['mimo/mimo-v2.5-pro', 'mimo/mimo-v2.5-pro'],
    ]
  );
});

test('opencode config agents remain observational and do not synthesize argv', () => {
  const discovery = parseOpenCodeConfigAgents({
    model: 'opencode/big-pickle',
    default_agent: '\u200bSisyphus - Ultraworker',
    agent: {
      build: { mode: 'subagent', description: 'Implementation helper' },
      plan: { mode: 'subagent' },
      'nvidia-chat': {
        mode: 'primary',
        model: 'nvidia/moonshotai/kimi-k2.6',
        description: 'NVIDIA proxy chat without OpenCode tool schemas.',
      },
      '\u200bSisyphus - Ultraworker': {
        mode: 'primary',
        description:
          'Powerful AI orchestrator with a very long description that should be truncated before it reaches the UI title and makes the composer awkward to inspect.',
      },
    },
  });

  assert.equal(discovery.defaultAgentId, '\u200bSisyphus - Ultraworker');
  assert.equal(discovery.defaultModelId, 'opencode/big-pickle');
  assert.deepEqual(
    discovery.modes.map((mode) => [mode.id, mode.label, mode.disabled]),
    [
      ['nvidia-chat', 'nvidia-chat', undefined],
      ['\u200bSisyphus - Ultraworker', 'Sisyphus - Ultraworker', undefined],
    ]
  );
});

test('opencode object config uses the top-level model over its default-agent model', () => {
  const discovery = parseOpenCodeConfigAgents({
    model: 'top-level/model',
    default_agent: 'build',
    agent: {
      build: { model: 'default-agent/model' },
    },
  });

  assert.equal(discovery.defaultModelId, 'top-level/model');
});

test('opencode object config falls back to the selected default-agent model only', () => {
  const discovery = parseOpenCodeConfigAgents({
    default_agent: 'build',
    agent: {
      build: { model: 'default-agent/model' },
      unrelated: { model: 'unrelated/model' },
    },
  });

  assert.equal(discovery.defaultModelId, 'default-agent/model');
});

test('opencode object config ignores non-default agent models', () => {
  const discovery = parseOpenCodeConfigAgents({
    default_agent: 'build',
    agent: {
      build: {},
      unrelated: { model: 'unrelated/model' },
    },
  });

  assert.equal(discovery.defaultModelId, undefined);
});

test('opencode object config has no effective model when neither source supplies one', () => {
  const discovery = parseOpenCodeConfigAgents({
    default_agent: 'build',
    agent: { build: {} },
  });

  assert.equal(discovery.defaultModelId, undefined);
});

test('opencode plugin agents remain observational and do not synthesize argv', () => {
  const discovery = parseOpenCodeConfigAgents({
    default_agent: 'build',
    agent: {
      build: {
        mode: 'primary',
        description: 'Build workflow provided by an OpenCode plugin.',
      },
      plan: {
        mode: 'primary',
        description: 'Plan workflow provided by an OpenCode plugin.',
      },
      helper: {
        mode: 'subagent',
        description: 'Not selectable from Agents GUI.',
      },
    },
  });

  assert.deepEqual(
    discovery.modes.map((mode) => [mode.id, mode.label]),
    [
      ['build', 'build'],
      ['plan', 'plan'],
    ]
  );
});

test('opencode debug config text exposes default agent without parsing full prompts', () => {
  const discovery = parseOpenCodeDebugConfigOutput(
    [
      '{',
      '  "default_agent": "\\u200bSisyphus - Ultraworker",',
      '  "model": "mimo/mimo-v2.5-pro",',
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
    [['\u200bSisyphus - Ultraworker', undefined, undefined]]
  );
});

test('opencode JSON debug config uses a later top-level model over its default-agent model', () => {
  const json = JSON.stringify(
    {
      default_agent: 'build',
      agent: {
        build: { model: 'default-agent/model' },
      },
      model: 'top-level/model',
    },
    null,
    2
  );
  const ansiWrapped = json
    .split('\n')
    .map((line) => `\u001b[36m${line}\u001b[0m`)
    .join('\n');

  assert.equal(parseOpenCodeDebugConfigOutput(ansiWrapped).defaultModelId, 'top-level/model');
});

test('opencode JSON debug config uses the selected default-agent model with four-space indentation', () => {
  const output = JSON.stringify(
    {
      default_agent: 'build',
      agent: {
        build: { model: 'default-agent/model' },
        unrelated: { model: 'unrelated/model' },
      },
    },
    null,
    4
  );

  assert.equal(parseOpenCodeDebugConfigOutput(output).defaultModelId, 'default-agent/model');
});

test('opencode JSON debug config ignores non-default models with tab indentation', () => {
  const output = JSON.stringify(
    {
      default_agent: 'build',
      agent: {
        build: {},
        unrelated: { model: 'unrelated/model' },
      },
    },
    null,
    '\t'
  );

  assert.equal(parseOpenCodeDebugConfigOutput(output).defaultModelId, undefined);
});

test('opencode JSON debug config has no effective model when all sources are absent', () => {
  const output = JSON.stringify(
    {
      agent: { build: {} },
      default_agent: 'build',
    },
    null,
    2
  );

  assert.equal(parseOpenCodeDebugConfigOutput(output).defaultModelId, undefined);
});

test('opencode debug config uses a top-level model over its default-agent model', () => {
  const discovery = parseOpenCodeDebugConfigOutput(
    [
      '{',
      '  "default_agent": "build",',
      '  "model": "top-level/model",',
      '  "agent": {',
      '    "build": {',
      '      "model": "default-agent/model"',
      '    }',
      '  }',
      '}',
    ].join('\n')
  );

  assert.equal(discovery.defaultModelId, 'top-level/model');
});

test('opencode debug config falls back to the selected default-agent model only', () => {
  const discovery = parseOpenCodeDebugConfigOutput(
    [
      '{',
      '  "default_agent": "build",',
      '  "agent": {',
      '    "build": {',
      '      "model": "default-agent/model"',
      '    },',
      '    "unrelated": {',
      '      "model": "unrelated/model"',
      '    }',
      '  }',
      '}',
    ].join('\n')
  );

  assert.equal(discovery.defaultModelId, 'default-agent/model');
});

test('opencode debug config ignores non-default agent models', () => {
  const discovery = parseOpenCodeDebugConfigOutput(
    [
      '{',
      '  "default_agent": "build",',
      '  "agent": {',
      '    "build": {},',
      '    "unrelated": {',
      '      "model": "unrelated/model"',
      '    }',
      '  }',
      '}',
    ].join('\n')
  );

  assert.equal(discovery.defaultModelId, undefined);
});

test('opencode debug config has no effective model when neither source supplies one', () => {
  const discovery = parseOpenCodeDebugConfigOutput(
    [
      '{',
      '  "default_agent": "build",',
      '  "agent": {',
      '    "build": {}',
      '  }',
      '}',
    ].join('\n')
  );

  assert.equal(discovery.defaultModelId, undefined);
});


test('headless stdin prompts close stdin for one-shot requests', () => {
  const managerSource = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const sessionControllerSource = readFileSync(
    new URL('../src/agentSessionController.ts', import.meta.url),
    'utf8'
  );

  assert.match(
    managerSource,
    /sendInput\(sessionId:\s*string,\s*text:\s*string,\s*closeAfterWrite = false\)/
  );
  assert.match(managerSource, /session\.process\.stdin\.end\(\);/);
  assert.match(sidebarSource, /this\.agentRuntime\.startPrompt\([\s\S]*profile\.inputMode === 'argument' \? prompt : undefined/);
  assert.doesNotMatch(sessionControllerSource, /canReuse|sendInput\(cliId/);
});


test('CLI profiles expose task routing scores for agent recommendations', () => {
  assert.ok(getCliProfile('codex').taskRouting.implementation >= 6);
  assert.ok(getCliProfile('codex').taskRouting.review >= 6);
  assert.ok(getCliProfile('claude').taskRouting.planning >= 6);
  assert.ok(getCliProfile('claude').taskRouting.refactor >= 6);
  assert.ok(getCliProfile('aider').taskRouting.tests >= 5);
  assert.equal(getCliProfile('gemini').taskRouting.explain, 5);
});

test('CLI install hints resolve platform-specific setup commands', () => {
  const openCode = getCliProfile('opencode');
  const goose = getCliProfile('goose');
  const claude = getCliProfile('claude');
  const aider = getCliProfile('aider');
  const gemini = getCliProfile('gemini');
  const codex = getCliProfile('codex');

  assert.equal(resolveCliInstallHint(openCode, 'darwin'), 'brew install opencode-ai/tap/opencode');
  assert.equal(
    resolveCliInstallHint(openCode, 'linux'),
    'curl -fsSL https://opencode.ai/install | bash'
  );
  assert.equal(resolveCliInstallHint(openCode, 'win32'), 'npm install -g opencode-ai');
  assert.match(resolveCliInstallHint(goose, 'darwin'), /github\.com\/block\/goose/);
  assert.match(resolveCliInstallHint(goose, 'win32'), /github\.com\/block\/goose/);
  assert.match(
    resolveCliInstallHint(aider, 'win32'),
    /^powershell -NoProfile -ExecutionPolicy Bypass -Command/
  );
  assert.doesNotMatch(resolveCliInstallHint(aider, 'win32'), /&&/);
  assert.equal(resolveCliInstallHint(claude, 'win32'), 'npm install -g @anthropic-ai/claude-code');
  assert.equal(resolveCliInstallHint(gemini, 'win32'), 'npm install -g @google/gemini-cli');
  assert.equal(resolveCliInstallHint(codex, 'win32'), 'npm install -g @openai/codex');
});

test('CLI lookup can use interactive login zsh so nvm-installed tools are visible', () => {
  assert.deepEqual(getLoginShellLookupArgs('codex', '/bin/zsh'), ['-lic', "command -v 'codex'"]);
});

test('CLI path resolver keeps the first absolute command path from shell output', () => {
  assert.equal(
    normalizeCommandPathOutput(
      'nvm startup noise\n/Users/t/.nvm/versions/node/v24.15.0/bin/codex\n'
    ),
    '/Users/t/.nvm/versions/node/v24.15.0/bin/codex'
  );
  assert.equal(shellQuote("bad'name"), "'bad'\\''name'");
});


test('CLI manager delegates command revalidation to discovery before spawning', () => {
  const source = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');
  const discoverySource = readFileSync(new URL('../src/cliDiscovery.ts', import.meta.url), 'utf8');

  assert.match(
    source,
    /const command =\s*\(await this\.cliDiscovery\.resolveCommandPath\(profile\.command\)\) \?\? profile\.command/
  );
  assert.match(discoverySource, /private commandPathCache = new Map/);
  assert.doesNotMatch(
    source,
    /this\.commandPathCache\.get\(profile\.command\) \?\? profile\.command/
  );
});

test('CLI manager evicts stale command path cache entries', () => {
  const source = readFileSync(new URL('../src/cliManager.ts', import.meta.url), 'utf8');
  const discoverySource = readFileSync(new URL('../src/cliDiscovery.ts', import.meta.url), 'utf8');

  assert.match(discoverySource, /private async isUsableCommandPath/);
  assert.match(discoverySource, /fs\.promises\.access\(commandPath, fs\.constants\.X_OK\)/);
  assert.match(discoverySource, /this\.commandPathCache\.delete\(command\)/);
  assert.match(source, /err\.code === 'ENOENT'/);
  assert.match(source, /this\.cliDiscovery\.evictCommandPath\(profile\.command\)/);
});

test('CLI profiles retain normalized detected version status', () => {
  const profilesSource = readFileSync(new URL('../src/cliProfiles.ts', import.meta.url), 'utf8');
  const discoverySource = readFileSync(new URL('../src/cliDiscovery.ts', import.meta.url), 'utf8');

  assert.match(profilesSource, /versionArgs\?: string\[\]/);
  assert.match(profilesSource, /version\?: string/);
  assert.match(profilesSource, /contextWindowTokens\?: number/);
  assert.match(profilesSource, /autoCompactsContext\?: boolean/);
  assert.match(profilesSource, /tokenizer\?: CliTokenizerConfig/);
  assert.match(profilesSource, /configuredModel\?: CliConfiguredModel/);
  assert.match(profilesSource, /slashCommands\?: CliSlashCommand\[\]/);
  assert.match(profilesSource, /authCommands\?: CliAuthCommands/);
  assert.match(
    profilesSource,
    /authCommands:\s*\{\s*login:\s*\['auth', 'login'\],\s*logout:\s*\['auth', 'logout'\],\s*status:\s*\['auth', 'status'\]/
  );
  assert.match(
    profilesSource,
    /authCommands:\s*\{\s*login:\s*\['login'\],\s*logout:\s*\['logout'\],\s*status:\s*\['login', 'status'\]/
  );
  assert.match(
    profilesSource,
    /authCommands:\s*\{\s*login:\s*\['auth', 'login'\],\s*logout:\s*\['auth', 'logout'\],\s*status:\s*\['auth', 'list'\]/
  );
  assert.match(profilesSource, /provider: 'openai'/);
  assert.match(profilesSource, /provider: 'anthropic'/);
  assert.match(
    discoverySource,
    /version: installed \? await this\.getCommandVersion\(base\) : undefined/
  );
  assert.match(discoverySource, /private getCommandVersion\(profile: CliProfile\)/);
  assert.match(discoverySource, /profile\.versionArgs \?\? \['--version'\]/);
  assert.match(discoverySource, /MAX_COMMAND_VERSION_TOKEN_LENGTH/);
  assert.match(discoverySource, /const candidates = clean\.matchAll/);
});


test('context token usage identifies attached context explicitly', () => {
  const usage = countContextTokens(
    {
      activeFile: {
        relativePath: 'src/example.ts',
        languageId: 'typescript',
        lineCount: 1,
        text: 'export const answer = 42;',
        truncated: false,
      },
      diagnostics: [],
    },
    {}
  );

  assert.equal(usage.scope, 'attached-context');
});

test('context token usage ignores the empty IDE context wrapper', () => {
  const usage = countContextTokens({ diagnostics: [] }, {});

  assert.equal(usage.tokens, 0);
});

test('attached context estimate uses a truthful reference-window presentation', () => {
  const presentation = deriveContextBudgetPresentation({
    tokenUsage: { precision: 'estimated', scope: 'attached-context', tokens: 23 },
    totalTokens: 128000,
    autoCompact: true,
  });

  assert.equal(presentation.mode, 'attached');
  assert.equal(presentation.tokenLabel, '~23');
  assert.equal(presentation.percentageLabel, '<0.1');
  assert.equal(presentation.showRemaining, false);
  assert.equal(presentation.showAutoCompact, false);
  assert.equal(presentation.ring, 'neutral');
});

test('exact session context preserves precise remaining capacity and auto-compact metadata', () => {
  const presentation = deriveContextBudgetPresentation({
    tokenUsage: { precision: 'exact', scope: 'session-context', tokens: 23 },
    totalTokens: 128000,
    autoCompact: true,
  });

  assert.equal(presentation.mode, 'session');
  assert.equal(presentation.tokenLabel, '23');
  assert.equal(presentation.percentageLabel, '<0.1');
  assert.equal(presentation.totalLabel, '128k');
  assert.equal(presentation.remainingLabel, '127.98k');
  assert.equal(presentation.showRemaining, true);
  assert.equal(presentation.showAutoCompact, true);
});

test('context budget formatting keeps small percentages and useful token precision', () => {
  assert.equal(formatPercentage(0), '0');
  assert.equal(formatPercentage(0.01796875), '<0.1');
  assert.equal(formatPercentage(0.1), '0.1');
  assert.equal(formatPercentage(1), '1');
  assert.equal(formatTokenCount(128000), '128k');
  assert.equal(formatTokenCount(127977), '127.98k');
  assert.equal(formatTokenCount(999), '999');
});

test('context budget formatting does not round ratios across their truth boundaries', () => {
  assert.equal(formatPercentage(0.95), '<1');
  assert.equal(formatPercentage(0.99), '<1');
  assert.equal(formatPercentage(99.49), '99');
  assert.equal(formatPercentage(99.5), '<100');
  assert.equal(formatPercentage(99.99), '<100');
  assert.equal(formatPercentage(100), '100');
});

test('context budget formatting promotes rounded token unit rollovers', () => {
  assert.equal(formatTokenCount(999), '999');
  assert.equal(formatTokenCount(1000), '1k');
  assert.equal(formatTokenCount(999999), '1m');
  assert.equal(formatTokenCount(1000000), '1m');
  assert.equal(formatTokenCount(127977), '127.98k');
});

test('context budget fails closed for unknown scope and hides an empty attached snapshot', () => {
  assert.equal(
    deriveContextBudgetPresentation({
      tokenUsage: { precision: 'estimated', tokens: 23 },
      totalTokens: 128000,
    }).mode,
    'attached'
  );
  assert.equal(
    deriveContextBudgetPresentation({
      tokenUsage: { precision: 'exact', tokens: 23 },
      totalTokens: 128000,
    }).mode,
    'session'
  );
  assert.equal(
    deriveContextBudgetPresentation({
      tokenUsage: { precision: 'estimated', scope: 'attached-context', tokens: 0 },
      totalTokens: 128000,
    }).visible,
    false
  );
});

test('context budget keeps unsupported precision unavailable even when it has a numeric token field', () => {
  const presentation = deriveContextBudgetPresentation({
    tokenUsage: { precision: 'unavailable', scope: 'attached-context', tokens: 23 },
    totalTokens: 128000,
  });

  assert.equal(presentation.mode, 'unavailable');
  assert.equal(presentation.visible, true);
  assert.equal(presentation.tokenLabel, undefined);
});

test('context budget rejects invalid raw token fields for recognized precision', () => {
  for (const [precision, tokens] of [
    ['exact', null],
    ['estimated', null],
    ['exact', ''],
    ['estimated', '   '],
    ['exact', '23'],
    ['estimated', -1],
    ['exact', Number.NaN],
    ['estimated', Infinity],
  ]) {
    const presentation = deriveContextBudgetPresentation({
      tokenUsage: { precision, scope: 'session-context', tokens },
      totalTokens: 128000,
    });

    assert.equal(presentation.mode, 'unavailable', `${precision} ${String(tokens)}`);
    assert.equal(presentation.visible, true, `${precision} ${String(tokens)}`);
  }
});

test('context budget keeps precision independent from explicit and fallback scope', () => {
  const cases = [
    ['exact', 'attached-context', 'attached', 'exact'],
    ['exact', 'session-context', 'session', 'exact'],
    ['exact', undefined, 'session', 'exact'],
    ['exact', 'future-scope', 'session', 'exact'],
    ['estimated', 'attached-context', 'attached', 'estimated'],
    ['estimated', 'session-context', 'unavailable', undefined],
    ['estimated', undefined, 'attached', 'estimated'],
    ['estimated', 'future-scope', 'attached', 'estimated'],
    ['unavailable', 'attached-context', 'unavailable', undefined],
    ['unavailable', 'session-context', 'unavailable', undefined],
    ['unavailable', undefined, 'unavailable', undefined],
    ['unavailable', 'future-scope', 'unavailable', undefined],
  ];

  for (const [precision, scope, expectedMode, expectedPrecision] of cases) {
    const presentation = deriveContextBudgetPresentation({
      tokenUsage: { precision, scope, tokens: 23 },
      totalTokens: 128000,
      autoCompact: true,
    });

    assert.equal(presentation.mode, expectedMode, `${precision} ${String(scope)}`);
    assert.equal(presentation.precision, expectedPrecision, `${precision} ${String(scope)}`);
  }
});

test('exact attached context stays attached without estimate or session-only affordances', () => {
  const presentation = deriveContextBudgetPresentation({
    tokenUsage: { precision: 'exact', scope: 'attached-context', tokens: 23 },
    totalTokens: 128000,
    autoCompact: true,
  });

  assert.equal(presentation.mode, 'attached');
  assert.equal(presentation.precision, 'exact');
  assert.equal(presentation.tokenLabel, '23');
  assert.equal(presentation.showRemaining, false);
  assert.equal(presentation.showAutoCompact, false);
  assert.equal(presentation.ring, 'neutral');
});

test('invalid raw totals suppress ratios and remaining capacity', () => {
  for (const totalTokens of [Infinity, Number.NaN, -1, 0, '', '128000']) {
    const presentation = deriveContextBudgetPresentation({
      tokenUsage: { precision: 'exact', scope: 'session-context', tokens: 23 },
      totalTokens,
      autoCompact: true,
    });

    assert.equal(presentation.hasTotal, false, String(totalTokens));
    assert.equal(presentation.percentageLabel, undefined, String(totalTokens));
    assert.equal(presentation.remainingLabel, undefined, String(totalTokens));
    assert.equal(presentation.showRemaining, false, String(totalTokens));
    assert.equal(presentation.showAutoCompact, false, String(totalTokens));
  }
  assert.equal(formatTokenCount(Infinity), '0');
});

test('context window resolution prefers a known model before the profile fallback', () => {
  const profile = { contextWindowTokens: 258000 };

  assert.equal(resolveContextWindowTokens(profile, 'openai/gpt-4.1'), 1048576);
  assert.equal(resolveContextWindowTokens(profile, 'provider/unknown-model'), 258000);
  assert.equal(resolveContextWindowTokens(profile, 'gpt-5.5'), 128000);
  assert.equal(resolveContextWindowTokens(profile, 'unknown-model'), 258000);
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
  const settingsManagerSource = readFileSync(
    new URL('../src/settingsManager.ts', import.meta.url),
    'utf8'
  );
  const syncedStateSource = readFileSync(new URL('../src/syncedState.ts', import.meta.url), 'utf8');
  const previewSource = readFileSync(
    new URL('../scripts/preview-webview.mjs', import.meta.url),
    'utf8'
  );
  const defaultProvider =
    manifest.contributes.configuration.properties['agents-gui.defaultProvider'];

  assert.equal(defaultProvider.default, 'opencode');
  assert.equal(defaultProvider.enum, undefined);
  assert.match(settingsManagerSource, /const DEFAULT_CLI_ID = 'opencode';/);
  assert.match(settingsManagerSource, /get<string>\('defaultProvider', DEFAULT_CLI_ID\)/);
  assert.match(settingsManagerSource, /getCliProfile\(DEFAULT_CLI_ID\)\?\.id/);
  assert.match(previewSource, /defaultProviderId: 'opencode'/);
  assert.match(extensionSource, /state:\s*context\.globalState/);
  assert.match(syncedStateSource, /LAST_PROVIDER_STATE_KEY = 'agents-gui\.lastProviderId'/);
  assert.match(syncedStateSource, /AGENT_MODE_STATE_KEY = 'agents-gui\.agentModeByProvider'/);
  assert.match(sidebarSource, /LAST_PROVIDER_STATE_KEY,\n/);
  assert.match(sidebarSource, /AGENT_MODE_STATE_KEY,\n/);
  assert.match(
    sidebarSource,
    /const installedProfiles = profiles\.filter\(\(profile\) => profile\.installed\)/
  );
  assert.match(sidebarSource, /this\.profilesById\.set\(profile\.id, profile\)/);
  assert.match(
    sidebarSource,
    /const storedProviderId = this\.settingsManager\.getStoredProviderId\(installedProfiles\)/
  );
  assert.match(sidebarSource, /profiles: installedProfiles\.map\(\(profile\) => \(\{/);
  assert.match(
    sidebarSource,
    /setupProfiles: profiles\.map\(\(profile\) => this\.toSetupProfile\(profile\)\)/
  );
  assert.match(sidebarSource, /private toSetupProfile\(profile: CliProfile\): SetupCliProfile/);
  assert.match(sidebarSource, /\.\.\.toCliSetupProfile\(profile\)/);
  assert.match(sidebarSource, /activeProviderId: storedProviderId/);
  assert.match(
    sidebarSource,
    /activeAgentModeByProvider: this\.settingsManager\.getStoredAgentModeState\(this\.profilesById\)/
  );
});

test('workspace debug config starts the extension host with the watch task', () => {
  const launch = JSON.parse(
    readFileSync(new URL('../.vscode/launch.json', import.meta.url), 'utf8')
  );
  const tasks = JSON.parse(readFileSync(new URL('../.vscode/tasks.json', import.meta.url), 'utf8'));
  const configuration = launch.configurations.find(
    (item) => item.type === 'extensionHost' && item.request === 'launch'
  );
  const watchTask = tasks.tasks.find((item) => item.label === 'npm: watch');

  assert.ok(configuration);
  assert.equal(configuration.preLaunchTask, 'npm: watch');
  assert.deepEqual(configuration.args, ['--extensionDevelopmentPath=${workspaceFolder}']);
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
  assert.match(sidebarSource, /const assets = webviewAssetPaths\(this\.extensionUri\);/);
  assert.match(sidebarSource, /`media\/\{\$\{assets\.join\(','\)\}\}`/);
  assert.match(sidebarSource, /webviewAssetVersion/);
  assert.match(sidebarSource, /reloadWebviewForDevelopment/);
});

test('webview CSP is strict enough for VS Code webview diagnostics', () => {
  const source = readFileSync(new URL('../src/webviewHtmlRenderer.ts', import.meta.url), 'utf8');

  assert.match(source, /default-src 'none'/);
  assert.match(source, /style-src \$\{options\.webview\.cspSource\};/);
  assert.match(source, /script-src \$\{options\.webview\.cspSource\} 'nonce-\$\{nonce\}'/);
  assert.doesNotMatch(source, /'unsafe-inline'/);
});

test('webview avoids a duplicate internal title and uses icon-only action buttons', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /data-i18n="app\.title"/);
  assert.match(html, /<link rel="icon" href="data:,"/);
  assert.match(html, /data-i18n-aria="toolbar\.actions"/);
  assert.match(html, /<svg viewBox="0 0 16 16"/);
});


test('webview allocates the OpenCode history column at medium widths only when history is visible', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(
    css,
    /@media \(max-width: 1100px\)\s*\{[\s\S]*body\[data-provider="opencode"\] \.app-shell\s*\{\s*grid-template-areas:\s*"toolbar"\s*"main-content"\s*"composer";\s*grid-template-columns:\s*minmax\(0, 1fr\);/s
  );
  assert.match(
    css,
    /@media \(max-width: 1100px\)\s*\{[\s\S]*body\[data-provider="opencode"\]\.is-session-history-visible \.app-shell\s*\{\s*grid-template-areas:\s*"session-history session-history-resizer toolbar"\s*"session-history session-history-resizer main-content"\s*"session-history session-history-resizer composer";\s*grid-template-columns:\s*var\(--session-history-width[^)]*\)\s*6px\s*minmax\(0, 1fr\);/s
  );
  assert.match(
    css,
    /@media \(max-width: 1100px\)\s*\{[\s\S]*body\[data-provider="opencode"\]\.is-session-history-hidden \.app-shell\s*\{\s*grid-template-areas:\s*"toolbar"\s*"main-content"\s*"composer";\s*grid-template-columns:\s*minmax\(0, 1fr\);/s
  );
  assert.match(
    css,
    /@media \(max-width: 1100px\)\s*\{[\s\S]*body\[data-provider="opencode"\] \.app-shell:has\(> \.session-history\[hidden\]\)\s*\{\s*grid-template-areas:\s*"toolbar"\s*"main-content"\s*"composer";\s*grid-template-columns:\s*minmax\(0, 1fr\);/s
  );
  assert.match(css, /\.session-history:empty\s*\{\s*display:\s*none;/s);
  assert.match(
    css,
    /@media \(max-width: 1100px\)\s*\{[\s\S]*body\[data-provider="opencode"\] \.app-shell:has\(> \.session-history:empty\)\s*\{\s*grid-template-areas:\s*"toolbar"\s*"main-content"\s*"composer";\s*grid-template-columns:\s*minmax\(0, 1fr\);/s
  );
  assert.match(
    css,
    /@media \(max-width: 760px\)\s*\{[\s\S]*body\.is-session-history-visible \.app-shell,\s*body\[data-provider="opencode"\]\.is-session-history-visible \.app-shell\s*\{\s*grid-template-areas:\s*"toolbar"\s*"main-content"\s*"composer";\s*grid-template-columns:\s*minmax\(0, 1fr\);/s
  );
  assert.match(
    css,
    /@media \(max-width: 760px\)\s*\{[\s\S]*body\.is-session-history-visible \.session-history:not\(\[hidden\]\):not\(:empty\)\s*\{\s*display:\s*none;/s
  );
  assert.match(
    css,
    /@media \(max-width: 760px\)\s*\{[\s\S]*body\.is-session-history-visible \.toolbar,\s*body\.is-session-history-visible \.main-content,\s*body\.is-session-history-visible \.composer,\s*body\[data-provider="opencode"\]\.is-session-history-visible \.toolbar,\s*body\[data-provider="opencode"\]\.is-session-history-visible \.main-content,\s*body\[data-provider="opencode"\]\.is-session-history-visible \.composer\s*\{\s*grid-column:\s*1;/s
  );
});



test('opencode sidebar collapses by default at compact widths', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(
    css,
    /@media \(max-width:\s*1100px\)\s*\{[\s\S]*?body\[data-provider="opencode"\] \.app-shell\s*\{[\s\S]*?grid-template-areas:\s*"toolbar"\s*"main-content"\s*"composer";[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*1100px\)\s*\{[\s\S]*?body\[data-provider="opencode"\]\.is-session-history-visible \.app-shell\s*\{[\s\S]*?grid-template-areas:\s*"session-history session-history-resizer toolbar"\s*"session-history session-history-resizer main-content"\s*"session-history session-history-resizer composer";[\s\S]*?grid-template-columns:\s*var\(--session-history-width[^)]*\)\s*6px\s*minmax\(0,\s*1fr\);/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*1100px\)\s*\{[\s\S]*?body\[data-provider="opencode"\]\.is-session-history-hidden \.app-shell\s*\{[\s\S]*?grid-template-areas:\s*"toolbar"\s*"main-content"\s*"composer";[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*1100px\)\s*\{[\s\S]*?body\[data-provider="opencode"\] \.main-content\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);[\s\S]*?border-right:\s*0;/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*1100px\)\s*\{[\s\S]*?body\[data-provider="opencode"\] \.sidebar\s*\{[\s\S]*?display:\s*none;/s
  );
});


test('webview renders OpenCode thinking as a separate assistant detail block', () => {
  const formatterSource = readFileSync(
    new URL('../src/outputFormatter.ts', import.meta.url),
    'utf8'
  );
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const sessionControllerSource = readFileSync(
    new URL('../src/agentSessionController.ts', import.meta.url),
    'utf8'
  );
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(formatterSource, /thinking\?: string;/);
  assert.match(sidebarSource, /this\.sessionController\.register\(session\)/);
  assert.match(sessionControllerSource, /thinking: normalized\.thinking/);
  assert.match(sessionControllerSource, /status: normalized\.status/);
  assert.match(sessionControllerSource, /activities: normalized\.activities/);
  assert.match(script, /function mergeStreamText\(current, chunk\)/);
  assert.match(script, /incoming\.startsWith\(existing\)/);
  assert.match(script, /existing\.endsWith\(incoming\) && incoming\.length > 32/);
  assert.match(script, /function updateStreamThinking\(message\)/);
  assert.match(script, /function updateStreamActivity\(message\)/);
  assert.match(script, /function sanitizeThinkingText\(text\)/);
  assert.match(
    script,
    /target\.thinkingBuffer = mergeStreamText\(existingThinking, message\.thinking\);/
  );
  assert.match(
    script,
    /const fullThinking = filtered\.pending \? '' : sanitizeThinkingText\(filtered\.text\);/
  );
  assert.match(script, /const hasAssistantActivity = hasOpenCodeActivity\(item\.activity\);/);
  assert.match(
    script,
    /const hasInlineAssistantActivity = hasOpenCodeActivityTimeline\(item\.activityTimeline\);/
  );
  assert.match(
    script,
    /const showAssistantThinkingDetails = shouldShowAssistantThinkingDetails\(\s*hasAssistantThinking,\s*hasAssistantActivity,\s*hasInlineAssistantActivity\s*\);/
  );
  assert.match(
    script,
    /appendMessageThinking\(bubble, item\.thinking, \{\s*activity: item\.activity,\s*suppressActivityDetails: hasInlineAssistantActivity,\s*running: shouldShowThinkingRunningTimer\(itemRunning, item\),\s*startedAt: item\.startedAt,\s*durationMs: item\.durationMs,\s*detailKey: messageDetailKey\(activeId, activeThread\?\.id, index, 'thinking'\),\s*\}\)/s
  );
  assert.match(
    script,
    /renderMarkdownWithActivity\(\s*body,\s*normalizeMessageText\(item\.text\),\s*item\.activity,\s*item\.activityTimeline,\s*itemRunning,\s*baseDetailKey\s*\)/s
  );
  assert.doesNotMatch(script, /renderMarkdownLite\(body, normalizeMessageText\(item\.text\)\);/);
  assert.match(
    script,
    /if \(itemRunning\) \{\s*appendMessageRunningStatus\(bubble, item\);\s*\} else \{\s*if \(item\.role === 'assistant'\) \{\s*appendMessageChoiceActions\(bubble, item\.text\);\s*\}\s*if \(shouldShowAssistantCopyButton\(conversation, index, activeConversationRunning\)\) \{/s
  );
  assert.match(script, /function appendMessageThinking\(bubble, text, options = \{\}\)/);
  assert.match(
    script,
    /function renderMarkdownWithActivity\(container, text, activity, activityTimeline, running, baseDetailKey = ''\)/
  );
  assert.match(script, /function mergeOpenCodeActivityTimeline\(existing, activities, offset\)/);
  assert.match(
    script,
    /item\.activityTimeline = mergeOpenCodeActivityTimeline\(\s*item\.activityTimeline,\s*message\.activities,\s*normalizeMessageText\(item\.text\)\.length\s*\)/s
  );
  assert.match(
    script,
    /const activityEntries = timeline\.length > 0 \? timeline : fallbackEntries;/
  );
  assert.match(
    script,
    /const choiceLineKeys = !running && messageChoices\?\.extractMessageChoiceLineKeys/
  );
  assert.match(
    script,
    /renderMarkdownLite\(container, normalized, \{\s*hiddenChoiceLineKeys: choiceLineKeys,\s*hideProgressNoise: activityEntries\.length > 0,\s*\}\);/s
  );
  assert.match(
    script,
    /appendOpenCodeActivityTrail\(\s*container,\s*activityEntries,\s*running,\s*baseDetailKey \? `\$\{baseDetailKey\}:activity` : ''\s*\);/s
  );
  assert.doesNotMatch(script, /groupOpenCodeActivityTimeline/);
  assert.doesNotMatch(script, /activityInsertionOffset/);
  assert.match(script, /const openMessageDetailKeys = new Set\(\);/);
  assert.match(script, /function messageDetailKey\(cliId, threadId, index, kind, localKey = ''\)/);
  assert.match(script, /function renderActiveStreamMessage\(target\)/);
  assert.match(
    script,
    /if \(target\.cliId === activeId && target\.threadId === activeThreadId\(activeId\)\) \{\s*if \(!renderActiveStreamMessage\(target\)\) \{\s*renderMessages\(\);\s*\}\s*\}/s
  );
  assert.match(script, /const THINKING_ICON_SVG = '<svg /);
  assert.match(script, /const thinking = document\.createElement\('details'\);/);
  assert.match(
    script,
    /const thinking = document\.createElement\('details'\);\s*thinking\.className = 'message-thinking';\s*syncMessageThinkingElement\(thinking, normalized, options\);/s
  );
  assert.doesNotMatch(
    script,
    /const thinking = document\.createElement\('details'\);\s*syncMessageThinkingElement\(thinking, normalized, options\);/s
  );
  assert.match(
    script,
    /function shouldShowAssistantThinkingDetails\(hasThinking, hasActivity, hasInlineActivity\) \{\s*return Boolean\(hasThinking \|\| \(hasActivity && !hasInlineActivity\)\);\s*\}/s
  );
  assert.match(
    script,
    /function shouldShowThinkingRunningTimer\(itemRunning, item\) \{\s*return Boolean\(itemRunning && !normalizeMessageText\(item\?\.text\)\.trim\(\)\);\s*\}/s
  );
  assert.match(
    script,
    /function syncMessageThinkingSummaryLabel[\s\S]*openCodeThinkingSummaryText\([\s\S]*shouldShowThinkingRunningTimer\(itemRunning, item\)/
  );
  assert.match(script, /applyMessageDetailOpenState\(thinking, options\.detailKey\);/);
  assert.match(script, /summary\.className = 'message-thinking-summary';/);
  assert.match(script, /summary\.innerHTML = THINKING_ICON_SVG/);
  assert.match(
    script,
    /label\.textContent = openCodeThinkingSummaryText\(activity, options\.running, options\.startedAt, options\.durationMs\);/
  );
  assert.match(script, /chevron\.className = 'message-thinking-chevron';/);
  assert.match(script, /chevron\.innerHTML = THINKING_CHEVRON_SVG;/);
  assert.match(script, /const durationMs = completedMessageDurationMs\(item\.startedAt\);/);
  assert.match(script, /delete item\.durationMs;/);
  assert.match(script, /item\.durationMs = durationMs;/);
  assert.match(script, /const finalText = finalStreamTargetText\(target, item\);/);
  assert.match(script, /if \(finalText\) \{\s*item\.text = finalText;\s*\}/s);
  assert.match(
    script,
    /item\.thinking = sanitizeThinkingText\(target\.thinkingBuffer \?\? item\.thinking\);/
  );
  assert.match(script, /function finalStreamTargetText\(target, item\)/);
  assert.match(script, /function isEmptyAssistantStreamMessage\(item\)/);
  assert.match(script, /if \(removeEmpty && isEmptyAssistantStreamMessage\(item\)\) \{/);
  assert.match(script, /const thinkingText = sanitizeThinkingText\(normalized\);/);
  assert.match(
    script,
    /appendOpenCodeActivityDetails\(body, activity\.entries, detailKey \? `\$\{detailKey\}:activity` : ''\);/
  );
  assert.match(script, /thinkingTextBlock\.className = 'message-thinking-detail-text';/);
  assert.match(
    script,
    /function appendOpenCodeActivityTrail\(container, entries, running, detailKey = ''\)/
  );
  assert.match(script, /stack\.className = 'message-activity-stack';/);
  assert.doesNotMatch(script, /thinking\.open = true/);
  assert.doesNotMatch(script, /body\.textContent = openCodeActivityBodyText/);
  assert.match(css, /\.message-thinking\s*\{/);
  assert.match(
    css,
    /\.message-thinking\s*\{\s*[^}]*color:\s*color-mix\(in srgb, var\(--assistant-muted\) 72%, transparent\);/s
  );
  assert.match(css, /\.message-thinking-summary\s*\{/);
  assert.match(css, /\.message-thinking-summary::-webkit-details-marker\s*\{/);
  assert.doesNotMatch(css, /\.message-thinking-summary::before/);
  assert.match(
    css,
    /\.message-thinking-summary:hover \.message-thinking-label,\s*\.message-thinking\[open\] \.message-thinking-label\s*\{/
  );
  assert.match(css, /\.message-thinking-icon\s*\{/);
  assert.match(
    css,
    /\.message-thinking-icon\s*\{\s*[^}]*color:\s*color-mix\(in srgb, var\(--assistant-muted\) 62%, transparent\);/s
  );
  assert.match(css, /\.message-thinking-chevron\s*\{/);
  assert.match(css, /\.message-thinking-chevron\s*\{\s*[^}]*opacity:\s*0;/s);
  assert.match(
    css,
    /\.message-thinking-summary:hover \.message-thinking-chevron,\s*\.message-thinking\[open\] \.message-thinking-chevron\s*\{/
  );
  assert.match(css, /\.message-thinking-body\s*\{/);
  assert.match(css, /\.message-activity-stack\s*\{/);
  assert.match(css, /\.message-activity-stack \.message-activity-inline\s*\{/);
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


test('provider extension bridges use the corresponding VS Code extension commands', () => {
  assert.deepEqual(getProviderExtensionBridge('codex'), {
    providerId: 'codex',
    extensionId: 'openai.chatgpt',
    displayName: 'Codex',
    openCommands: ['chatgpt.openSidebar', 'chatgpt.newCodexPanel'],
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
  assert.match(
    source,
    /await this\.openProviderExtension\(this\.settingsManager\.resolveCliId\(message\)\);/
  );
  assert.match(source, /vscodeExtension: this\.getProviderExtensionStatus\(profile\.id\)/);
  assert.match(source, /const bridge = getProviderExtensionBridge\(cliId\);/);
  assert.match(source, /for \(const command of bridge\.openCommands\)/);
  assert.match(source, /await vscode\.commands\.executeCommand\(command\);/);
  assert.match(
    source,
    /interface ProviderClientTerminalState\s*\{\s*terminal: vscode\.Terminal;\s*started: boolean;\s*\}/s
  );
  assert.match(
    source,
    /private providerClientTerminals = new Map<string, ProviderClientTerminalState>\(\);/
  );
  assert.match(
    source,
    /private async openProviderCliTerminal\(profile: CliProfile\): Promise<void>/
  );
  assert.match(
    source,
    /vscode\.window\.createTerminal\(\{\s*name: `Agents GUI Client: \$\{profile\.name\}`,\s*cwd: workspaceFolder\?\.uri\.fsPath,/s
  );
  assert.match(source, /vscode\.window\.onDidCloseTerminal\(\(terminal\) => \{/);
  assert.match(
    source,
    /if \(!entry\.started\) \{\s*entry\.terminal\.sendText\(profile\.command, true\);\s*entry\.started = true;/s
  );
});



test('webview supports pasted image attachments in the composer', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const attachmentStoreSource = readFileSync(
    new URL('../src/attachmentStore.ts', import.meta.url),
    'utf8'
  );

  assert.match(html, /id="attachmentStrip"/);
  assert.match(html, /id="attachImageBtn"/);
  assert.match(html, /id="imageFileInput"[^>]*accept="image\/\*"/);
  assert.match(script, /let promptAttachments = \[\];/);
  assert.match(script, /attachImageBtn\.disabled = state\.attachmentDisabled;/);
  assert.match(script, /imageFileInput\.disabled = state\.attachmentDisabled;/);
  assert.match(script, /if \(attachImageBtn\.disabled \|\| imageFileInput\?\.disabled\) \{/);
  assert.match(script, /input\.addEventListener\('paste'/);
  assert.match(script, /event\.clipboardData\?\.items/);
  assert.match(script, /function addImageFiles/);
  assert.match(script, /new FileReader\(\)/);
  assert.match(script, /const finalAttachments = promptAttachments\.map\(attachmentPayload\);/);
  assert.match(script, /attachmentCount: promptAttachments\.length,/);
  assert.match(script, /promptAttachments = \[\];/);
  assert.match(sidebarSource, /this\.attachmentStore\.materialize\(message\.attachments\)/);
  assert.match(
    attachmentStoreSource,
    /DEFAULT_IMAGE_ATTACHMENT_RETENTION_MS = 7 \* 24 \* 60 \* 60 \* 1000/
  );
  assert.match(attachmentStoreSource, /DEFAULT_MAX_STORED_IMAGE_ATTACHMENTS = 128/);
  assert.match(attachmentStoreSource, /await this\.prune\(attachmentDir\)/);
  assert.match(
    attachmentStoreSource,
    /vscode\.workspace\.fs\.delete\(uri, \{ useTrash: false \}\)/
  );
  assert.match(attachmentStoreSource, /files\.slice\(this\.maxStoredAttachments\)/);
  assert.doesNotMatch(sidebarSource, /pruneImageAttachmentStorage/);
  assert.match(css, /\.attachment-strip\s*\{/);
  assert.match(css, /\.attachment-chip img\s*\{/);
  assert.match(css, /\.attach-button\s*\{/);
  assert.match(i18nScript, /'attachment\.add': 'Attach image'/);
  assert.match(i18nScript, /'attachment\.add': '添加图片'/);
});


test('webview renders installed provider logo tabs in the header', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const webviewAssets = JSON.parse(
    readFileSync(new URL('../media/webview-assets.json', import.meta.url), 'utf8')
  );
  const providers = ['claude', 'gemini', 'codex', 'opencode', 'goose', 'aider'];
  const providerIcons = webviewAssets.providerIcons;
  const commands = manifest.contributes.commands;
  const titleActions = manifest.contributes.menus['view/title'] || [];

  assert.match(
    html,
    /<div class="toolbar-session">[\s\S]*<div class="provider-tabs" id="providerTabs" role="tablist" aria-label="Provider tabs"/
  );
  assert.match(
    html,
    /<div class="provider-tabs" id="providerTabs"[\s\S]*<\/div>\s*<div class="provider-hint" id="providerHint" aria-live="polite"><\/div>\s*<label class="thread-select">/
  );
  assert.doesNotMatch(html, /<div class="toolbar-session">\s*<div class="brand-mark"/);
  assert.doesNotMatch(
    html,
    /<div class="toolbar-actions"[\s\S]*id="newChatBtn"[\s\S]*id="deleteThreadBtn"[\s\S]*<\/div>\s*<div class="provider-tabs" id="providerTabs"/
  );
  assert.doesNotMatch(html, /id="refreshBtn"/);
  assert.doesNotMatch(JSON.stringify(commands), /activeProviderIndicator|switchProvider/);
  assert.doesNotMatch(JSON.stringify(titleActions), /activeProviderIndicator|switchProvider/);
  assert.match(JSON.stringify(titleActions), /agents-gui\.refreshProviders/);
  assert.match(JSON.stringify(titleActions), /agents-gui\.openProviderSettings/);
  assert.match(css, /\.provider-tabs\s*\{/);
  assert.match(css, /\.provider-tabs\s*\{\s*[^}]*height:\s*24px;/s);
  assert.match(css, /\.provider-tabs\s*\{\s*[^}]*--provider-tabs-collapsed-width:\s*28px;/s);
  assert.match(
    css,
    /\.provider-tabs\s*\{\s*[^}]*width:\s*var\(--provider-tabs-collapsed-width\);/s
  );
  assert.match(
    css,
    /\.provider-tabs\s*\{\s*[^}]*border:\s*1px solid color-mix\(in srgb,\s*var\(--assistant-border\) 88%,\s*transparent\);/s
  );
  assert.match(css, /\.provider-tabs:hover,\s*\.provider-tabs:focus-within\s*\{/);
  assert.match(
    css,
    /\.provider-tabs:hover,\s*\.provider-tabs:focus-within\s*\{\s*[^}]*width:\s*min\(42vw,\s*var\(--provider-tabs-expanded-width\)\);/s
  );
  assert.match(css, /\.provider-tab-button\s*\{/);
  assert.match(css, /\.provider-tab-button\s*\{\s*[^}]*--provider-tab-collapsed-width:\s*24px;/s);
  assert.match(css, /\.provider-tab-button\s*\{\s*[^}]*height:\s*20px;/s);
  assert.match(css, /\.provider-tab-button\.is-active\s*\{/);
  assert.match(
    css,
    /\.provider-tab-button\.is-active\s*\{\s*[^}]*width:\s*var\(--provider-tab-collapsed-width\);/s
  );
  assert.match(
    css,
    /\.provider-tabs:not\(:hover\):not\(:focus-within\) \.provider-tab-button:not\(\.is-active\)\s*\{/
  );
  assert.match(
    css,
    /\.provider-tabs:not\(:hover\):not\(:focus-within\) \.provider-tab-button\.is-active\s*\{\s*[^}]*background:\s*transparent;/s
  );
  assert.match(
    css,
    /\.provider-tabs:hover \.provider-tab-button,\s*\.provider-tabs:focus-within \.provider-tab-button\s*\{/
  );
  assert.match(css, /\.provider-tab-logo\s*\{/);
  assert.match(css, /\.provider-tab-logo\s*\{\s*[^}]*width:\s*15px;/s);
  assert.match(css, /\.provider-tab-logo\s*\{\s*[^}]*filter:\s*grayscale\(1\) saturate\(0\.12\);/s);
  assert.match(
    css,
    /\.provider-tab-button\.is-active \.provider-tab-logo\s*\{\s*[^}]*filter:\s*none;/s
  );
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
  assert.match(script, /const providerIsBusy = providerIsRunning \|\| providerIsPending;/);
  assert.match(script, /button\.setAttribute\('aria-busy', String\(providerIsBusy\)\)/);
  assert.match(script, /button\.disabled = false;/);
  assert.match(script, /button\.classList\.add\('is-busy'\)/);
  assert.doesNotMatch(script, /activeIsBusy/);
  assert.doesNotMatch(script, /button\.disabled = activeIsBusy && !isActive/);
  assert.match(
    script,
    /providerTabs\.addEventListener\('click', \(event\) => \{\s*const button = event\.target\.closest\('\.provider-tab-button'\);\s*if \(!button\) \{\s*return;\s*\}\s*switchActiveProvider\(button\.dataset\.providerId\);/s
  );
  assert.match(css, /\.provider-tab-button\.is-busy::after\s*\{/);
  assert.match(script, /logo\.className = 'provider-tab-logo'/);
  assert.doesNotMatch(script, /version\.className = 'provider-tab-version'/);
  assert.doesNotMatch(
    css,
    /\.provider-tabs:not\(:hover\):not\(:focus-within\) \.provider-tab-button:not\(\.is-active\)\s*\{[^}]*scale\(/s
  );
  assert.match(script, /providerTabs\.addEventListener\('click'/);
  assert.match(script, /switchActiveProvider\(button\.dataset\.providerId\)/);
  assert.match(sidebarSource, /webviewIcon: this\.getProviderIconUris\(profile\.id\)/);

  for (const provider of providers) {
    for (const iconPath of new Set(Object.values(providerIcons[provider]))) {
      const icon = readFileSync(new URL(`../media/${iconPath}`, import.meta.url));
      assert.ok(icon.length > 0, `missing provider icon asset for ${provider}`);
      if (iconPath.endsWith('.svg')) {
        assert.match(icon.toString('utf8'), /<svg/);
      } else {
        assert.equal(icon.subarray(1, 4).toString('ascii'), 'PNG');
      }
    }
  }

  assert.match(sidebarSource, /private getProviderIconUris\(providerId: string\)/);
  assert.match(sidebarSource, /providerIconPaths\(this\.extensionUri, providerId\)/);
});

test('webview keeps provider switching in the header and out of the conversation toolbar', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(html, /<label class="provider-native-select" hidden>[\s\S]*id="providerSelect"/);
  assert.match(html, /id="providerTabs"/);
  assert.doesNotMatch(html, /composer-provider-dock/);
  assert.doesNotMatch(
    html,
    /<div class="prompt-selectors">[\s\S]*id="providerSelect"[\s\S]*<\/div>\s*<div class="prompt-tools"/
  );
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


test('manifest exposes title actions and general settings', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const settingsManagerSource = readFileSync(
    new URL('../src/settingsManager.ts', import.meta.url),
    'utf8'
  );
  const commands = JSON.stringify(manifest.contributes.commands);
  const titleActions = JSON.stringify(manifest.contributes.menus['view/title']);
  const properties = manifest.contributes.configuration.properties;

  assert.match(commands, /agents-gui\.refreshProviders/);
  assert.match(commands, /agents-gui\.openProviderSettings/);
  assert.match(titleActions, /view == agents-gui\.sidebar/);
  assert.match(titleActions, /agents-gui\.refreshProviders/);
  assert.match(titleActions, /agents-gui\.openProviderSettings/);
  assert.ok(properties['agents-gui.home.visibleAgentIds']);
  assert.ok(properties['agents-gui.home.agentOrder']);
  assert.equal(manifest.scripts['package:vsix'], 'npm run package');
  assert.equal(manifest.scripts['package:manual'], 'npm run package');
  assert.equal(manifest.scripts['preview:webview'], 'node scripts/preview-webview.mjs');
  assert.equal(manifest.scripts['verify:release'], 'node scripts/verify-release.mjs');
  assert.match(
    manifest.scripts['publish:manual'],
    /vsce publish --packagePath agents-gui-\$\{npm_package_version\}\.vsix/
  );
  assert.ok(properties['agents-gui.commitMessage.provider']);
  assert.match(html, /id="settingsNavAgents"/);
  assert.match(html, /id="settingsNavCommitMessage"/);
  assert.match(html, /class="settings-nav-icon"/);
  assert.match(html, /class="settings-nav-label"[^>]*data-i18n="settings\.agents"/);
  assert.match(html, /class="settings-nav-label"[^>]*data-i18n="settings\.commitMessage"/);
  assert.match(html, /id="homeAgentList"/);
  assert.match(html, /id="commitMessageProviderSelect"/);
  assert.match(html, /id="commitMessageLanguageSelect"/);
  assert.match(html, /id="commitMessageMaxDiffChars"/);
  assert.doesNotMatch(html, /aria-modal="true"/);
  assert.match(html, /id="homeAgentsSaveStatus"[^>]*aria-live="polite"/);
  assert.match(html, /id="commitMessageSaveStatus"[^>]*aria-live="polite"/);
  assert.match(script, /function visibleInstalledProfiles\(\)/);
  assert.match(script, /function configurableAgentProfiles\(\)/);
  assert.match(script, /function orderedInstalledProfiles\(\)/);
  assert.match(script, /function renderHomeAgentSettings\(\)/);
  assert.match(script, /function renderCommitMessageSettings\(\)/);
  assert.match(
    script,
    /const knownProviderIds = new Set\(\[\s*'default',\s*'ask',\s*\.\.\.installedProfiles\(\)\.map\(\(profile\) => profile\.id\),\s*\]\);/s
  );
  assert.match(script, /function saveCommitMessageSettings\(\)/);
  assert.match(script, /function setSettingsSaveStatus\(section,\s*state,\s*message\)/);
  assert.match(script, /const SETTINGS_SAVE_STATUS_TIMEOUT_MS = 5000;/);
  assert.match(script, /case 'settingsSaveResult':/);
  assert.match(script, /setSettingsSaveStatus\('agents',\s*'saving'\)/);
  assert.match(script, /setSettingsSaveStatus\('commitMessage',\s*'saving'\)/);
  assert.match(script, /function moveHomeAgent\(/);
  assert.match(script, /data-home-agent-move/);
  assert.match(script, /agentOrder/);
  assert.match(settingsManagerSource, /config\.get<string\[]>\('agentOrder', \[]\)/);
  assert.match(sidebarSource, /config\.update\('agentOrder', settings\.agentOrder/);
  assert.match(sidebarSource, /saveCommitMessageSettings/);
  assert.match(sidebarSource, /command:\s*'settingsSaveResult'/);
  assert.match(sidebarSource, /section,\s*ok:\s*true/);
  assert.match(sidebarSource, /section,\s*ok:\s*false/);
  assert.match(css, /\.api-settings-page\s*\{\s*[^}]*grid-area:\s*1 \/ 1 \/ -1 \/ -1;/s);
  assert.match(
    css,
    /body\.is-api-settings-open \.toolbar,\s*body\.is-api-settings-open \.main-content,\s*body\.is-api-settings-open \.session-history,\s*body\.is-api-settings-open \.sidebar,\s*body\.is-api-settings-open \.composer\s*\{\s*[^}]*display:\s*none\s*!important;/s
  );
  assert.match(css, /\.settings-save-status\s*\{/);
  assert.match(css, /\.settings-save-status\.is-success\s*\{[^}]*font-weight:\s*600;/s);
  assert.match(css, /\.settings-save-status\.is-info\s*\{/);
  assert.match(css, /\.settings-save-status\.is-error\s*\{/);
  assert.match(i18nScript, /'settings\.saveStatus\.saved': 'Settings saved'/);
  assert.match(i18nScript, /'settings\.saveStatus\.saved': '设置已保存'/);
  assert.match(i18nScript, /'commitSettings\.provider': 'CLI'/);
  assert.match(i18nScript, /'commitSettings\.providerAsk': 'Ask every time'/);
  assert.match(i18nScript, /'commitSettings\.providerAsk': '每次询问'/);
  assert.match(
    i18nScript,
    /'homeAgents\.showAllStatus': 'All installed agents are visible\. Save to keep this layout\.'/
  );
  assert.match(i18nScript, /'homeAgents\.showAllStatus': '已显示全部 Agent，点击保存后生效。'/);
  assert.match(
    i18nScript,
    /'homeAgents\.orderChangedStatus': 'Order changed\. Save to keep this layout\.'/
  );
  assert.match(i18nScript, /'homeAgents\.orderChangedStatus': '已调整排序，点击保存后生效。'/);
  assert.match(script, /switch \(activeSettingsSection\)/);
  assert.match(css, /\.api-settings-panel\s*\{\s*[^}]*container-type:\s*inline-size;/s);
  assert.match(
    css,
    /\.settings-nav-item\s*\{\s*[^}]*grid-template-columns:\s*18px minmax\(0,\s*1fr\);/s
  );
  assert.match(css, /\.settings-nav-icon svg\s*\{\s*[^}]*width:\s*15px;/s);
  assert.match(
    css,
    /@container \(max-width:\s*700px\)\s*\{[\s\S]*?\.settings-layout\s*\{[\s\S]*?grid-template-columns:\s*44px minmax\(0,\s*1fr\);/s
  );
  assert.match(
    css,
    /@container \(max-width:\s*700px\)\s*\{[\s\S]*?\.settings-nav-label\s*\{[\s\S]*?display:\s*none;/s
  );
  assert.match(css, /\.home-agent-sort\s*\{/);
  assert.match(script, /saveHomeAgentSettings/);
  assert.match(script, /saveCommitMessageSettings/);
  assert.match(script, /commitMessageSettings/);
  assert.match(script, /openProviderSettings/);
});

test('native passthrough removes the custom API provider surface', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const sidebar = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const protocol = readFileSync(new URL('../src/webviewProtocol.ts', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/settingsManager.ts', import.meta.url), 'utf8');
  const properties = manifest.contributes.configuration.properties;

  assert.equal(properties['agents-gui.apiProviders.customProviders'], undefined);
  assert.equal(properties['agents-gui.apiProviders.defaultProviderId'], undefined);
  assert.equal(properties['agents-gui.apiProviders.agentProviderByCliId'], undefined);
  assert.doesNotMatch(
    html,
    /settingsNavApiProviders|settingsSectionApiProviders|apiProviderForm|apiProviderSettingsPage|apiProviderSettingsClose/
  );
  assert.doesNotMatch(script, /apiProviderSettings|fetchApiProviderModels|saveApiProviderSettings/);
  assert.doesNotMatch(sidebar, /ApiProvider|apiProvider|OpenCodeConfigSync|\.sync\(/);
  assert.doesNotMatch(protocol, /apiProvider|ApiProvider/);
  assert.doesNotMatch(settings, /apiProvider|ApiProvider/);
  assert.doesNotMatch(
    css,
    /\.api-settings-body|\.api-model-row|\.api-model-status|\.api-agent-binding/
  );
});

test('webview settings reset and reorder controls have durable local feedback', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /function moveHomeAgent\(agentId, direction\)/);
  assert.match(
    script,
    /\[order\[fromIndex\], order\[toIndex\]\] = \[order\[toIndex\], order\[fromIndex\]\];/
  );
  assert.match(
    script,
    /homeAgentSettings = normalizeHomeAgentSettings\(\{ \.\.\.settings, agentOrder: order \}\);/
  );
  assert.match(
    script,
    /setSettingsSaveStatus\('agents', 'info', i18n\.t\('homeAgents\.orderChangedStatus'\)\);/
  );
  assert.match(script, /button\.disabled = disabled;/);
  assert.match(
    script,
    /homeAgentList\s*\?\.querySelector\(`button\[data-home-agent-id="\$\{agentId\}"\]\[data-home-agent-move="\$\{direction\}"\]`\)\s*\?\.focus\(\);/s
  );
  assert.match(script, /function showAllHomeAgentsForUi\(\)/);
  assert.match(
    script,
    /homeAgentSettings = normalizeHomeAgentSettings\(\{ visibleAgentIds: \[\], agentOrder: \[\] \}\);/
  );
  assert.match(
    script,
    /setSettingsSaveStatus\('agents', 'info', i18n\.t\('homeAgents\.showAllStatus'\)\);/
  );
  assert.match(script, /homeAgentsReset\?\.addEventListener\('click', showAllHomeAgentsForUi\);/);
});

test('webview commit-message settings reset persists the exact defaults', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /function resetCommitMessageSettings\(\)/);
  assert.match(
    script,
    /commitMessageSettings = \{ provider: 'default', language: 'auto', maxDiffChars: 60000 \};/
  );
  assert.match(
    script,
    /renderCommitMessageSettings\(\);\s*setSettingsSaveStatus\('commitMessage', 'saving'\);/s
  );
  assert.match(
    script,
    /vscode\.postMessage\(\{ command: 'saveCommitMessageSettings', settings: commitMessageSettings \}\);/
  );
  assert.match(
    script,
    /commitMessageReset\?\.addEventListener\('click', resetCommitMessageSettings\);/
  );
});

test('webview toolbar icons and composer controls stay visually centered', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(
    css,
    /\.tool-button,\s*\.quick-button,\s*\.attach-button,\s*\.send-button,\s*\.stop-button\s*\{[^}]*padding:\s*0;/s
  );
  assert.match(
    css,
    /\.tool-button,\s*\.quick-button,\s*\.attach-button,\s*\.send-button,\s*\.stop-button\s*\{[^}]*place-items:\s*center;/s
  );
  assert.match(
    css,
    /\.prompt-actions\s*\{\s*[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) 30px;/s
  );
  assert.match(css, /\.prompt-selectors\s*\{\s*[^}]*flex-wrap:\s*nowrap;/s);
  assert.match(css, /\.prompt-selectors\s*\{\s*[^}]*overflow:\s*visible;/s);
});

test('webview composer popovers avoid viewport clipping', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(css, /\.composer\s*\{\s*[^}]*overflow:\s*visible;/s);
  assert.match(css, /\.composer\s*\{\s*[^}]*position:\s*relative;/s);
  assert.match(css, /\.composer\s*\{\s*[^}]*align-content:\s*start;/s);
  assert.match(css, /\.composer\s*\{\s*[^}]*align-items:\s*start;/s);
  assert.match(css, /\.composer\s*\{\s*[^}]*grid-auto-rows:\s*max-content;/s);
  assert.match(css, /\.prompt-shell\s*\{\s*[^}]*z-index:\s*3;/s);
  assert.match(css, /\.prompt-shell\s*\{\s*[^}]*overflow:\s*visible;/s);
  assert.match(css, /\.prompt-shell\s*\{\s*[^}]*align-self:\s*start;/s);
  assert.match(script, /function positionContextBudgetPopover\(\)/);
  assert.match(
    script,
    /const rightOverflow = triggerRect\.left \+ left \+ popoverWidth - \(window\.innerWidth - viewportPadding\);/
  );
  assert.match(script, /contextBudget\.style\.setProperty\('--context-budget-popover-left'/);
  assert.match(
    script,
    /contextBudget\?\.addEventListener\('pointerenter', positionContextBudgetPopover\);/
  );
  assert.match(script, /function composerPopoverFor\(menu\)/);
  assert.match(script, /function positionComposerPopover\(menu\)/);
  assert.match(script, /popover\.style\.setProperty\('--composer-popover-left'/);
  assert.match(script, /popover\.style\.setProperty\('--composer-popover-top'/);
  assert.match(script, /popover\.style\.setProperty\('--composer-popover-max-height'/);
  assert.match(script, /menu\.addEventListener\('toggle'/);
  assert.match(script, /closeComposerMenus\(menu\);/);
  assert.match(
    script,
    /window\.addEventListener\('resize', \(\) => \{[\s\S]*positionOpenComposerPopovers\(\);[\s\S]*\}\);/
  );
  assert.match(
    css,
    /\.context-budget-popover\s*\{\s*[^}]*left:\s*var\(--context-budget-popover-left, 0px\);/s
  );
  assert.match(css, /\.context-budget-popover\s*\{\s*[^}]*right:\s*auto;/s);
  assert.doesNotMatch(css, /\.context-budget-popover\s*\{[^}]*translateX\(-50%\)/s);
  assert.match(
    css,
    /\.option-popover,\s*\.mode-popover,\s*\.context-popover\s*\{\s*[^}]*position:\s*fixed;/s
  );
  assert.match(
    css,
    /\.option-popover,\s*\.mode-popover,\s*\.context-popover\s*\{\s*[^}]*left:\s*var\(--composer-popover-left, 8px\);/s
  );
  assert.match(
    css,
    /\.option-popover,\s*\.mode-popover,\s*\.context-popover\s*\{\s*[^}]*top:\s*var\(--composer-popover-top, 8px\);/s
  );
  assert.match(
    css,
    /\.option-popover,\s*\.mode-popover,\s*\.context-popover\s*\{\s*[^}]*max-height:\s*var\(--composer-popover-max-height/s
  );
  assert.doesNotMatch(
    css,
    /\.model-menu \.option-popover,\s*\.permission-menu \.option-popover\s*\{\s*[^}]*right:\s*0;/s
  );
  assert.match(
    css,
    /\.context-budget:hover \.context-budget-popover,\s*\.context-budget:focus \.context-budget-popover,\s*\.context-budget:focus-within \.context-budget-popover\s*\{[^}]*transform:\s*translateY\(0\);/s
  );
});

test('webview pins composer to the bottom when task board is hidden', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(
    css,
    /\.app-shell\s*\{\s*[^}]*grid-template-areas:\s*"toolbar"\s*"main-content"\s*"composer";/s
  );
  assert.match(css, /\.app-shell\s*\{\s*[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
  assert.match(
    css,
    /\.app-shell\s*\{\s*[^}]*grid-template-rows:\s*max-content minmax\(0,\s*1fr\) max-content;/s
  );
  assert.match(css, /\.toolbar\s*\{\s*[^}]*grid-area:\s*toolbar;/s);
  assert.match(css, /\.session-history\s*\{\s*[^}]*grid-area:\s*session-history;/s);
  assert.match(css, /\.sidebar\s*\{\s*[^}]*grid-area:\s*sidebar;/s);
  assert.match(
    css,
    /body\.is-session-history-visible \.app-shell\s*\{\s*[^}]*grid-template-areas:\s*"session-history session-history-resizer toolbar"\s*"session-history session-history-resizer main-content"\s*"session-history session-history-resizer composer";/s
  );
  assert.match(
    css,
    /body\[data-provider="opencode"\] \.app-shell\s*\{\s*[^}]*grid-template-areas:\s*"toolbar sidebar"\s*"main-content sidebar"\s*"composer sidebar";/s
  );
  assert.match(
    css,
    /body\[data-provider="opencode"\]\.is-session-history-visible \.app-shell\s*\{\s*[^}]*grid-template-areas:\s*"session-history session-history-resizer toolbar sidebar"\s*"session-history session-history-resizer main-content sidebar"\s*"session-history session-history-resizer composer sidebar";/s
  );
  assert.doesNotMatch(css, /\.task-board\s*\{\s*[^}]*grid-area:/s);
  assert.match(css, /\.main-content\s*\{\s*[^}]*grid-area:\s*main-content;/s);
  assert.match(css, /\.messages\s*\{\s*[^}]*grid-area:\s*auto;/s);
  assert.match(css, /\.composer\s*\{\s*[^}]*grid-area:\s*composer;/s);
});

test('webview composer controls wrap before narrow sidebars clip the send button', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(
    css,
    /@media \(max-width:\s*620px\)\s*\{[\s\S]*?\.prompt-selectors\s*\{[\s\S]*?flex-wrap:\s*wrap;/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*620px\)\s*\{[\s\S]*?\.provider-tabs\s*\{[\s\S]*?max-width:\s*min\(58vw,\s*var\(--provider-tabs-expanded-width\)\);/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*620px\)\s*\{[\s\S]*?\.provider-tabs:hover,\s*\.provider-tabs:focus-within\s*\{[\s\S]*?width:\s*min\(58vw,\s*var\(--provider-tabs-expanded-width\)\);/s
  );
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
  assert.match(
    script,
    /return Number\.isFinite\(parsedMaxHeight\) && parsedMaxHeight > 0\s*\?\s*parsedMaxHeight\s*:\s*PROMPT_INPUT_MAX_HEIGHT_FALLBACK;/s
  );
  assert.match(script, /function resizePromptInput\(\)/);
  assert.match(
    script,
    /input\.style\.height = 'auto';\s*const maxHeight = promptInputMaxHeight\(\);/s
  );
  assert.match(
    script,
    /input\.style\.overflowY = input\.scrollHeight > maxHeight \? 'auto' : 'hidden';/
  );
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

  assert.match(script, /running: runningByProvider\[activeId\],/);
  assert.match(script, /stopBtn\.hidden = !state\.running;/);
  assert.match(script, /sendBtn\.hidden = state\.running;/);
  assert.match(script, /stopBtn\.classList\.toggle\('is-visible', state\.running\);/);
  assert.match(script, /sendBtn\.classList\.toggle\('is-hidden', state\.running\);/);
  assert.match(script, /function requestStopActiveProvider\(\) \{/);
  assert.match(script, /if \(!runningByProvider\[activeId\]\) \{/);
  assert.match(script, /vscode\.postMessage\(\{ command: 'stop', cliId: activeId \}\);/);
  assert.match(css, /\.prompt-tools\s*\{\s*[^}]*flex:\s*0 0 28px;/s);
  assert.match(css, /\.prompt-tools\s*\{\s*[^}]*width:\s*30px;/s);
  assert.match(css, /\.prompt-tools\s*\{\s*[^}]*display:\s*grid;/s);
  assert.match(css, /\.send-button\.is-hidden\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(css, /\.stop-button svg\s*\{\s*[^}]*fill:\s*none;/s);
  assert.match(css, /\.stop-button svg\s*\{\s*[^}]*stroke:\s*currentColor;/s);
  assert.match(css, /\.stop-button svg \.stop-icon-square\s*\{\s*[^}]*fill:\s*currentColor;/s);
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
  assert.match(
    script,
    /if \(profilesLoading\) \{[\s\S]*option\.textContent = i18n\.t\('provider\.loading'\)/
  );
  assert.match(script, /providerHint\.classList\.add\('is-loading'\)/);
  assert.match(script, /appendProviderLoadingState\(\)/);
  assert.match(
    script,
    /profilesLoading = false;\s*profiles = message\.profiles \|\| \[\];\s*setupProfiles = normalizeSetupProfiles\(message\.setupProfiles\);/
  );
  assert.match(
    script,
    /case 'refreshStarted':\s*profilesLoading = true;\s*renderAll\(\);\s*break;/
  );
  assert.match(script, /profilesLoading,/);
  assert.match(script, /input\.placeholder = state\.placeholder;/);
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


test('webview sends recent thread conversation as provider context', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const providerSource = readFileSync(
    new URL('../src/sidebarProvider.ts', import.meta.url),
    'utf8'
  );
  const typesSource = readFileSync(new URL('../src/assistantTypes.ts', import.meta.url), 'utf8');

  assert.match(typesSource, /interface AssistantConversationHistoryMessage/);
  assert.match(typesSource, /conversationHistory\?: AssistantConversationHistoryMessage\[\]/);
  assert.match(script, /function conversationHistoryForSend\(cliId\)/);
  assert.match(script, /ensureConversation\(cliId, activeThreadId\(cliId\)\)/);
  assert.match(script, /\.slice\(-8\)/);
  assert.match(script, /conversationHistory: conversationHistoryForSend\(providerId\)/);
  assert.match(providerSource, /conversationHistory: message\.conversationHistory/);
});

test('webview renders a provider-wide session history list with derived states', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');

  assert.match(
    html,
    /<aside class="session-history" id="sessionHistory"[^>]*hidden[^>]*data-i18n-aria="history\.label"/
  );
  assert.match(
    html,
    /<\/section>\s*<aside class="session-history" id="sessionHistory"[\s\S]*?<div class="main-content">/
  );
  assert.match(
    html,
    /__CONVERSATION_STORE_JS_URI__[\s\S]*__SESSION_HISTORY_JS_URI__[\s\S]*__SLASH_COMMANDS_JS_URI__/
  );
  assert.match(
    html,
    /__WORKBENCH_LAYOUT_JS_URI__[\s\S]*__COMPOSER_STATE_JS_URI__[\s\S]*__PROVIDER_OPTIONS_JS_URI__[\s\S]*__MAIN_JS_URI__/
  );
  assert.match(script, /const sessionHistoryState = window\.AgentsGuiSessionHistory/);
  assert.match(script, /const workbenchLayout = window\.AgentsGuiWorkbenchLayout/);
  assert.match(script, /const composerState = window\.AgentsGuiComposerState/);
  assert.match(script, /const providerOptions = window\.AgentsGuiProviderOptions/);
  assert.match(script, /const sessionHistory = document\.getElementById\('sessionHistory'\);/);
  assert.match(script, /function setSessionHistoryHidden\(hidden\)/);
  assert.match(
    script,
    /workbenchLayout\.setSessionHistoryHidden\(document\.body, sessionHistory, hidden\)/
  );
  assert.match(
    script,
    /document\.body\.classList\.toggle\('is-session-history-visible', !Boolean\(hidden\)\);/
  );
  assert.match(script, /function renderSessionHistory\(\)/);
  assert.match(script, /sessionHistory\.innerHTML = '';\s*setSessionHistoryHidden\(true\);/);
  assert.match(
    script,
    /if \(rendered === 0 && !profilesLoading\) \{\s*setSessionHistoryHidden\(true\);\s*return;\s*\}/s
  );
  assert.match(
    script,
    /sessionHistory\.appendChild\(header\);\s*sessionHistory\.appendChild\(body\);\s*setSessionHistoryHidden\(false\);/s
  );
  assert.match(script, /function historyStatusForThread\(providerId, thread\)/);
  assert.match(script, /sessionHistoryState\.threadStatus\(thread, \{/);
  assert.match(script, /pendingByProvider,\s*runningByProvider,\s*pendingThreadByProvider,/);
  assert.match(script, /function activateHistoryThread\(providerId, threadId\)/);
  assert.match(script, /activeThreadByProvider\[providerId\] = thread\.id;/);
  assert.match(script, /sessionHistory\?\.addEventListener\('click'/);
  assert.match(script, /activateHistoryThread\(row\.dataset\.providerId, row\.dataset\.threadId\)/);
  assert.match(script, /renderSessionHistory\(\);/);
  assert.match(script, /setSessionHistoryHidden\(true\)/);
  assert.match(
    css,
    /\.session-history\s*\{\s*[^}]*border-right:\s*1px solid var\(--assistant-border\);/s
  );
  assert.match(css, /\.session-history\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(
    css,
    /body\.is-session-history-visible \.session-history:not\(\[hidden\]\):not\(:empty\)\s*\{\s*[^}]*display:\s*flex;/s
  );
  assert.match(
    css,
    /body\.is-session-history-visible \.app-shell\s*\{\s*[^}]*grid-template-areas:\s*"session-history session-history-resizer toolbar"\s*"session-history session-history-resizer main-content"\s*"session-history session-history-resizer composer";/s
  );
  assert.match(css, /\.session-history-row\s*\{/);
  assert.match(css, /\.session-history-row\.is-running \.session-history-status-dot\s*\{/);
  assert.match(css, /\.session-history-row\.is-answered \.session-history-status-dot\s*\{/);
  assert.match(css, /\.session-history-row\.is-completed \.session-history-status-dot\s*\{/);
  assert.match(
    css,
    /@media \(max-width:\s*620px\)\s*\{[\s\S]*?\.session-history\s*\{[\s\S]*?display:\s*none;/s
  );
  assert.match(i18nScript, /'history\.status\.running': '会话中'/);
  assert.match(i18nScript, /'history\.status\.answered': '有问答'/);
  assert.match(i18nScript, /'history\.status\.completed': '已完成'/);
});

test('workbench layout toggles hidden session history and shell class together', () => {
  const classes = new Set();
  const body = {
    classList: {
      toggle(name, enabled) {
        if (enabled) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
      },
    },
  };
  const sessionHistoryNode = { hidden: false };

  workbenchLayout.setSessionHistoryHidden(body, sessionHistoryNode, true);
  assert.equal(sessionHistoryNode.hidden, true);
  assert.equal(classes.has('is-session-history-hidden'), true);
  assert.equal(classes.has('is-session-history-visible'), false);

  workbenchLayout.setSessionHistoryHidden(body, sessionHistoryNode, false);
  assert.equal(sessionHistoryNode.hidden, false);
  assert.equal(classes.has('is-session-history-hidden'), false);
  assert.equal(classes.has('is-session-history-visible'), true);
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
  assert.match(script, /const taskBoardState = window\.AgentsGuiTaskBoardState;/);
  assert.match(script, /let tasks = normalizeSavedTasks\(saved\.tasks\);/);
  assert.match(script, /let taskBoardDismissed = Boolean\(saved\.taskBoardDismissed\);/);
  assert.match(script, /taskBoardDismissed,/);
  assert.match(script, /let taskBySessionId = \{\};/);
  assert.match(script, /function createRunTask/);
  assert.doesNotMatch(script, /taskBoardDismissed = false;/);
  assert.doesNotMatch(script, /makeTaskGroupId/);
  assert.doesNotMatch(script, /groupId/);
  assert.match(script, /taskBoardState\.normalizeSavedTasks\(savedTasks, \{/);
  assert.match(script, /taskBoardState\.createTask\(\{/);
  assert.match(script, /taskBoardState\.upsertRecentTask\(tasks, task, \{ limit: 20 \}\)/);
  assert.match(
    script,
    /function makeTaskId\(providerId\) \{\s*return taskBoardState\.makeTaskId\(providerId\);\s*\}/
  );
  assert.match(script, /function updateTaskStatus/);
  assert.match(script, /function visibleTasksForBoard\(\)/);
  assert.match(script, /taskBoardState\.visibleTasks\(tasks, \{/);
  assert.match(script, /enabled: VISUAL_TASK_BOARD_ENABLED,/);
  assert.match(script, /dismissed: taskBoardDismissed,/);
  assert.match(script, /function renderTaskBoard\(\)/);
  assert.match(script, /const visibleTasks = visibleTasksForBoard\(\);/);
  assert.match(script, /taskBySessionId\[message\.sessionId\]/);
  assert.match(script, /renderTaskBoard\(\);\s*renderThreadSelect\(\);/);
  assert.match(script, /status: 'preparing'/);
  assert.match(
    script,
    /status: wasStopped \? 'stopped' : \(Number\(message\.exitCode\) === 0 \? 'completed' : 'failed'\)/
  );
});

test('task board state keeps multi-task visibility rules outside DOM rendering', () => {
  const tasks = [
    { id: 'a', status: 'running' },
    { id: 'b', status: 'preparing' },
    { id: 'c', status: 'completed' },
    { id: 'd', status: 'unknown' },
  ];

  assert.deepEqual(taskBoardState.TASK_STATUSES, [
    'preparing',
    'running',
    'completed',
    'failed',
    'stopped',
  ]);
  assert.equal(taskBoardState.isActiveTask(tasks[0]), true);
  assert.equal(taskBoardState.isActiveTask(tasks[2]), false);
  assert.deepEqual(taskBoardState.statusCounts(tasks), {
    preparing: 1,
    running: 1,
    completed: 2,
    failed: 0,
    stopped: 0,
  });
  assert.deepEqual(taskBoardState.visibleTasks(tasks, { enabled: false }), []);
  assert.deepEqual(taskBoardState.visibleTasks(tasks, { enabled: true, dismissed: true }), []);
  assert.deepEqual(
    taskBoardState
      .visibleTasks(tasks, { enabled: true, dismissed: false, limit: 1 })
      .map((task) => task.id),
    ['a']
  );
  assert.equal(
    taskBoardState.makeTaskId('codex', { now: () => 123, random: () => 0.456789 }),
    'codex-123-gfzy42'
  );
  assert.deepEqual(
    taskBoardState.normalizeSavedTasks(
      [
        { providerId: 'opencode', status: 'running' },
        { providerId: 'codex', status: 'preparing', title: 'Build' },
        { providerId: 'claude', status: 'failed', createdAt: 1, updatedAt: 2 },
        { providerId: '', status: 'running' },
      ],
      {
        fallbackTitle: 'Untitled',
        makeTaskId: (providerId) => `${providerId}-id`,
        now: () => 99,
      }
    ),
    [
      {
        id: 'opencode-id',
        providerId: 'opencode',
        providerName: 'opencode',
        title: 'Untitled',
        action: 'freeform',
        agentMode: '',
        status: 'stopped',
        threadId: '',
        createdAt: 99,
        updatedAt: 99,
      },
      {
        id: 'codex-id',
        providerId: 'codex',
        providerName: 'codex',
        title: 'Build',
        action: 'freeform',
        agentMode: '',
        status: 'stopped',
        threadId: '',
        createdAt: 99,
        updatedAt: 99,
      },
      {
        id: 'claude-id',
        providerId: 'claude',
        providerName: 'claude',
        title: 'Untitled',
        action: 'freeform',
        agentMode: '',
        status: 'failed',
        threadId: '',
        createdAt: 1,
        updatedAt: 2,
      },
    ]
  );
  assert.deepEqual(
    taskBoardState.upsertRecentTask([{ id: 'old' }, { id: 'same' }], { id: 'same' }, { limit: 2 }),
    [{ id: 'same' }, { id: 'old' }]
  );
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

test('webview displays scope-accurate context budget details', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');
  const assets = JSON.parse(
    readFileSync(new URL('../media/webview-assets.json', import.meta.url), 'utf8')
  );
  const openCodeMetricsSource = script.slice(
    script.indexOf('function openCodeContextMetrics(profile)'),
    script.indexOf('function openCodeMcpStatusLabel(entry)')
  );

  assert.match(html, /id="contextBudget"/);
  assert.match(html, /id="contextBudgetLabel"/);
  assert.match(html, /id="contextBudgetTokenizer"/);
  assert.match(html, /__CONTEXT_BUDGET_JS_URI__[\s\S]*__MAIN_JS_URI__/);
  assert.ok(assets.assets.some((asset) => asset.path === 'contextBudget.js'));
  assert.match(
    script,
    /const contextBudgetPopover = contextBudget\?\.querySelector\('\.context-budget-popover'\);/
  );
  assert.match(script, /const contextBudgetPresentation = window\.AgentsGuiContextBudget;/);
  assert.match(script, /deriveContextBudgetPresentation\(/);
  assert.match(script, /function contextWindowTotal\(summary, profile\)/);
  assert.doesNotMatch(
    script,
    /contextSummary\?*\.contextWindowTokens \|\| profile\?*\.contextWindowTokens/
  );
  assert.match(script, /function renderContextBudget/);
  assert.match(script, /positionContextBudgetPopover\(\);/);
  assert.match(script, /contextWindow\.attachedTitle/);
  assert.match(
    script,
    /\? 'contextWindow\.attachedTokens'\s*: 'contextWindow\.attachedExactTokens'/s
  );
  assert.match(script, /contextWindow\.attachedReference/);
  assert.match(script, /contextWindow\.attachedExcludes/);
  assert.match(script, /contextBudget\.setAttribute\('aria-label', contextBudget\.title\);/);
  assert.match(script, /case 'contextSummary':[\s\S]*renderContextBudget\(\);[\s\S]*break;/);
  assert.match(script, /contextBudget\.classList\.toggle\('is-attached'/);
  assert.match(script, /openCodeContextMetrics\(profile\)/);
  assert.doesNotMatch(script, /\$0\.00 spent/);
  assert.match(openCodeMetricsSource, /i18n\.t\('contextWindow\.attachedTitle'/);
  assert.match(openCodeMetricsSource, /i18n\.t\('contextWindow\.attachedReference'/);
  assert.match(openCodeMetricsSource, /i18n\.t\('contextWindow\.attachedExcludes'/);
  assert.match(script, /contextWindow\.exactUnavailable/);
  assert.match(
    script,
    /contextBudgetTokens\.textContent = i18n\.t\('contextWindow\.providerManaged'/
  );
  assert.match(css, /\.context-budget\s*\{/);
  assert.match(css, /\.context-budget-ring\s*\{\s*[^}]*width:\s*14px;/s);
  assert.match(css, /\.context-budget\.is-attached \.context-budget-ring/);
  assert.match(css, /\.context-budget-popover\s*\{/);
  assert.match(
    css,
    /\.context-budget-popover\s*\{\s*[^}]*width:\s*min\(220px,\s*calc\(100vw - 20px\)\);/s
  );
  assert.match(css, /\.context-budget:hover \.context-budget-popover/);
  assert.match(i18nScript, /'contextWindow\.attachedTitle': 'Attached IDE context'/);
  assert.match(i18nScript, /'contextWindow\.attachedTokens': '~\{tokens\} tokens'/);
  assert.match(i18nScript, /'contextWindow\.attachedExactTokens': '\{tokens\} tokens'/);
  assert.match(i18nScript, /'contextWindow\.attachedTitle': '附加的 IDE 上下文'/);
  assert.match(i18nScript, /'contextWindow\.attachedExactTokens': '\{tokens\} token'/);
  assert.match(
    i18nScript,
    /'contextWindow\.attachedExcludes': 'Excludes chat history and provider context'/
  );
  assert.match(i18nScript, /'contextWindow\.attachedExcludes': '不含对话历史和模型侧上下文'/);
  assert.match(script, /presentation\.precision === 'estimated'/);
  assert.match(openCodeMetricsSource, /presentation\.precision === 'estimated'/);
});

test('webview clears all context-budget state when its presentation is hidden', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const clearSource = script.slice(
    script.indexOf('function clearContextBudget()'),
    script.indexOf('function renderContextBudget()')
  );
  const renderSource = script.slice(
    script.indexOf('function renderContextBudget()'),
    script.indexOf('function positionContextBudgetPopover()')
  );

  assert.match(clearSource, /contextBudget\.hidden = true;/);
  assert.match(clearSource, /contextBudgetLabel\.textContent = '';/);
  assert.match(clearSource, /contextBudgetTitle\.textContent = '';/);
  assert.match(clearSource, /contextBudgetPercent\.textContent = '';/);
  assert.match(clearSource, /contextBudgetTokens\.textContent = '';/);
  assert.match(clearSource, /contextBudgetTokenizer\.textContent = '';/);
  assert.match(clearSource, /contextBudgetPolicy\.textContent = '';/);
  assert.match(clearSource, /contextBudget\.title = '';/);
  assert.match(
    clearSource,
    /contextBudget\.setAttribute\('aria-label', i18n\.t\('contextWindow\.label'\)\);/
  );
  for (const className of ['has-total', 'is-unavailable', 'is-estimated', 'is-attached']) {
    assert.match(
      clearSource,
      new RegExp(`contextBudget\\.classList\\.toggle\\('${className}', false\\);`)
    );
  }
  assert.match(
    renderSource,
    /if \(!profile \|\| !contextSummary \|\| !tokenUsage\) \{\s*clearContextBudget\(\);\s*return;/s
  );
  assert.match(
    renderSource,
    /if \(contextBudget\.hidden\) \{\s*clearContextBudget\(\);\s*return;/s
  );
});

test('webview hides low-value default composer chips', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.match(
    script,
    /modeMenu\?\.classList\.toggle\(\s*'is-visible',\s*providerCapabilities\.controlVisibility\(profile, 'agentMode'/s
  );
  assert.match(script, /forceContextMenuVisible/);
  assert.match(script, /contextSummary\.workspace/);
  assert.match(css, /\.mode-menu,\s*\.context-menu\s*\{\s*[^}]*display:\s*none;/s);
  assert.match(
    css,
    /\.mode-menu\.is-visible,\s*\.context-menu\.is-visible\s*\{\s*[^}]*display:\s*block;/s
  );
});

test('webview conversation transcript surfaces compact metadata and readable code output', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const localizationSource = readFileSync(
    new URL('../src/localization.ts', import.meta.url),
    'utf8'
  );

  assert.match(css, /html\s*\{\s*[^}]*padding:\s*0;/s);
  assert.match(css, /body\s*\{\s*[^}]*padding:\s*0;/s);
  assert.match(css, /\.app-shell\s*\{\s*[^}]*width:\s*100%;/s);
  assert.match(css, /\.composer\s*\{\s*[^}]*padding:\s*8px clamp\(14px,\s*2\.4vw,\s*18px\) 7px;/s);
  assert.ok(
    script.indexOf('const normalizeMessageText = messageText.normalizeMessageText') <
      script.indexOf('normalizeSavedThreads')
  );
  assert.match(script, /if \(item\.meta && item\.role !== 'user'\)/);
  assert.doesNotMatch(script, /parts\.push\(summary\.workspace\)/);
  assert.match(
    script,
    /const itemRunning = Boolean\(item\.running && runningByProvider\[activeId\]\);/
  );
  assert.match(script, /const meta = document\.createElement\('div'\);/);
  assert.match(script, /meta\.className = 'message-meta';/);
  assert.match(script, /bubble\.appendChild\(meta\);/);
  assert.match(
    script,
    /const activeConversationRunning = Boolean\(runningByProvider\[activeId\] \|\| pendingByProvider\[activeId\]\);/
  );
  assert.match(
    script,
    /if \(itemRunning\) \{\s*appendMessageRunningStatus\(bubble, item\);\s*\} else \{\s*if \(item\.role === 'assistant'\) \{\s*appendMessageChoiceActions\(bubble, item\.text\);\s*\}\s*if \(shouldShowAssistantCopyButton\(conversation, index, activeConversationRunning\)\) \{/s
  );
  assert.match(
    script,
    /function shouldShowAssistantCopyButton\(conversation, index, activeConversationRunning\)/
  );
  assert.match(
    script,
    /if \(activeConversationRunning \|\| item\?\.role !== 'assistant' \|\| !normalizeMessageText\(item\.text\)\.trim\(\)\) \{/
  );
  assert.match(script, /function appendMessageRunningStatus\(container, item\)/);
  assert.match(script, /function syncMessageRunningStatusElement\(container, item, itemRunning\)/);
  assert.match(script, /syncMessageRunningStatusElement\(bubble, item, itemRunning\);/);
  assert.match(
    script,
    /if \(itemRunning \|\| Boolean\(runningByProvider\[activeId\] \|\| pendingByProvider\[activeId\]\)\) \{\s*bubble\.querySelector\(':scope > \.message-actions'\)\?\.remove\(\);\s*bubble\.querySelector\(':scope > \.message-choice-actions'\)\?\.remove\(\);\s*\}/s
  );
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
  assert.match(
    script,
    /const lines = preprocessAssistantMessageLines\(String\(text \|\| ''\)\.split\('\\n'\), options\);/
  );
  assert.match(script, /function renderedMessagePlainText\(container\)/);
  assert.match(
    script,
    /vscode\.postMessage\(\{ command: 'copyMessageText', text: markdownToCopyPlainText\(latest\) \}\);/
  );
  assert.match(script, /const copyButton = event\.target\.closest\('\[data-message-copy\]'\);/);
  assert.match(
    script,
    /const groupText = Number\.isInteger\(start\) && Number\.isInteger\(end\) && end >= start/
  );
  assert.match(
    script,
    /const body = copyButton\.closest\('\.message-bubble'\)\?\.querySelector\('\.message-content'\);/
  );
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
  assert.match(
    css,
    /\.messages\s*\{\s*[^}]*padding:\s*10px clamp\(14px,\s*2\.4vw,\s*18px\) 18px;/s
  );
  assert.match(css, /\.message-actions\s*\{\s*[^}]*display:\s*flex;/s);
  assert.match(css, /\.message-copy-button\s*\{/);
  assert.doesNotMatch(css, /\.message-copy-button\s*\{[^}]*position:\s*absolute/s);
  assert.match(css, /\.message-meta\s*\{\s*[^}]*display:\s*flex;/s);
  assert.match(
    css,
    /\.message\.assistant \.message-bubble\s*\{\s*[^}]*width:\s*min\(100%,\s*720px\);/s
  );
  assert.match(css, /\.message\.assistant \.message-bubble\s*\{\s*[^}]*padding:\s*0;/s);
  assert.match(
    css,
    /\.message\.assistant \.message-bubble\s*\{\s*[^}]*background:\s*transparent;/s
  );
  assert.match(css, /\.message\.assistant \.message-bubble\s*\{\s*[^}]*border:\s*0;/s);
  assert.doesNotMatch(css, /\.message\.assistant \.message-bubble\s*\{[^}]*border-left-width/s);
  assert.match(
    css,
    /\.message\.error \.message-bubble\s*\{\s*[^}]*width:\s*min\(100%,\s*720px\);/s
  );
  assert.match(css, /\.message\.error \.message-bubble\s*\{\s*[^}]*padding:\s*8px 10px 8px 32px;/s);
  assert.match(css, /\.message-status\s*\{\s*[^}]*background:\s*transparent;/s);
  assert.match(css, /\.message-status\s*\{\s*[^}]*border:\s*0;/s);
  assert.match(css, /\.message-status\.is-running\s*\{/);
  assert.match(css, /\.message-status\.is-running \.message-status-label\s*\{/);
  assert.match(script, /function syncMessageStatusTimer\(shouldRun\)/);
  assert.match(script, /function syncVisibleRunningMessageStatuses\(\)/);
  assert.match(
    script,
    /messageStatusTimer = setInterval\(\(\) => \{\s*if \(!syncVisibleRunningMessageStatuses\(\)\) \{\s*syncMessageStatusTimer\(false\);/
  );
  assert.doesNotMatch(
    script,
    /messageStatusTimer = setInterval\(\(\) => \{\s*renderMessages\(\);[\s\S]*?\}, 1000\);/
  );
  assert.match(script, /const MESSAGE_BOTTOM_STICKY_THRESHOLD = 48;/);
  assert.match(script, /function shouldAutoScrollMessages\(threadKey\)/);
  assert.match(
    script,
    /function restoreMessageScroll\(shouldStickToBottom, previousScrollTop, threadKey\)/
  );
  assert.match(script, /const shouldStickToBottom = shouldAutoScrollMessages\(messageThreadKey\);/);
  assert.match(script, /const previousScrollTop = messages\.scrollTop;/);
  assert.match(
    script,
    /restoreMessageScroll\(shouldStickToBottom, previousScrollTop, messageThreadKey\);/
  );
  assert.doesNotMatch(
    script,
    /syncMessageStatusTimer\(hasVisibleRunningMessage\);\s*messages\.scrollTop = messages\.scrollHeight;/
  );
  assert.match(script, /function runningMessageStatusText\(stage, startedAt\)/);
  assert.match(script, /i18n\.t\('message\.statusElapsed', \{ status: stage, elapsed \}\)/);
  assert.match(
    script,
    /return item\.runningNotice \|\|[\s\S]*item\.text \? i18n\.t\('message\.generating'\) : i18n\.t\('message\.thinking'\),\s*item\.startedAt/s
  );
  assert.doesNotMatch(script, /typing-dots/);
  assert.match(
    css,
    /\.message\.user \.message-bubble\s*\{\s*[^}]*max-width:\s*min\(72%,\s*520px\);/s
  );
  assert.match(css, /\.message\.user \.message-bubble\s*\{\s*[^}]*padding:\s*7px 11px;/s);
  assert.match(
    css,
    /\.message\.user \.message-bubble\s*\{\s*[^}]*border:\s*1px solid var\(--assistant-border\);/s
  );
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
  assert.match(script, /function preprocessAssistantMessageLines\(lines, options = \{\}\)/);
  assert.match(script, /const hideProgressNoise = Boolean\(options\.hideProgressNoise\);/);
  assert.match(script, /function isInternalAnalysisHeading\(line, lines, index\)/);
  assert.match(script, /function isInternalAnalysisField\(line\)/);
  assert.match(script, /function isAssistantIntentDiagnosticLine\(line\)/);
  assert.match(script, /\^I detect \[\\w -\]\+ intent\\b/);
  assert.match(script, /function isAssistantToolNoiseLine\(line\)/);
  assert.match(
    script,
    /\|\| \(\(hasInternalSignals \|\| hideProgressNoise\) && isAssistantProgressNoiseLine\(source\)\)/
  );
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
  assert.match(
    css,
    /\.md-paragraph,\s*\.md-list-item,\s*\.md-numbered-item\s*\{\s*[^}]*line-height:\s*1\.46;/s
  );
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
  assert.match(script, /send\('freeform', '\/undo'\);/);
  assert.match(script, /send\('freeform', fileCardReviewPrompt\(\)\);/);
  assert.match(script, /function fileCardReviewPrompt\(\)/);
  assert.match(
    css,
    /\.md-file-summary\s*\{\s*[^}]*grid-template-columns:\s*28px minmax\(0, 1fr\) auto;/s
  );
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
  const conversationSource = readFileSync(
    new URL('../media/conversationStore.js', import.meta.url),
    'utf8'
  );
  const providerSource = readFileSync(
    new URL('../src/sidebarProvider.ts', import.meta.url),
    'utf8'
  );
  const sessionControllerSource = readFileSync(
    new URL('../src/agentSessionController.ts', import.meta.url),
    'utf8'
  );

  assert.match(providerSource, /private profilesById = new Map<string, CliProfile>/);
  assert.match(providerSource, /this\.profilesById\.set\(profile\.id, profile\)/);
  assert.match(providerSource, /this\.profilesById\.get\(cliId\) \?\? getCliProfile\(cliId\)/);
  assert.doesNotMatch(providerSource, /NO_OUTPUT_NOTICE_MS/);
  assert.doesNotMatch(providerSource, /private noOutputNoticeTimers = new Map/);
  assert.match(providerSource, /this\.sessionController\.armNoOutputNotice\(session\)/);
  assert.match(sessionControllerSource, /const DEFAULT_NO_OUTPUT_NOTICE_MS = 45_000;/);
  assert.match(sessionControllerSource, /private readonly noOutputNoticeTimers = new Map/);
  assert.match(sessionControllerSource, /command:\s*'sessionNotice'/);
  assert.doesNotMatch(providerSource, /sendSessionInput|handleSessionInput|sessionInputResult/);
  assert.doesNotMatch(sessionControllerSource, /sendInput\(cliId, text\)/);
  assert.match(sessionControllerSource, /runtimeT\(this\.options\.locale,\s*'warning\.noOutput'/);
  assert.match(
    script,
    /threadsByProvider: conversationStore\.serializeThreadsForState\(threadsByProvider\)/
  );
  assert.match(conversationSource, /const \{ startedAt, durationMs, \.\.\.rest \} = message;/);
  assert.match(conversationSource, /const serializedMessage = \{ \.\.\.rest, running: false \};/);
  assert.match(conversationSource, /const safeDurationMs = normalizeDurationMs\(durationMs\);/);
  assert.match(
    script,
    /normalizeAssistantText: \(text\) => filterInternalPromptEcho\(text\)\.text/
  );
  assert.match(
    conversationSource,
    /running: false,\s*text: normalizeAssistantText\(message\.text\)/s
  );
  assert.match(
    script,
    /case 'sessionNotice':\s*if \(!codexRendererEnabled\) \{\s*updateSessionNotice\(message\);\s*\}/
  );
  assert.match(script, /i18n\.t\('claude\.approval\.unavailable'\)/);
  assert.match(script, /item\.runningNotice = normalizeMessageText\(message\.text\);/);
  assert.match(script, /delete item\.runningNotice;/);
  assert.match(sessionControllerSource, /normalized\.status !== 'thinking'/);
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



test('webview slash command palette shows each command label once', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');

  assert.doesNotMatch(script, /slash-command-name/);
  assert.doesNotMatch(css, /\.slash-command-name\s*\{/);
  assert.doesNotMatch(css, /grid-template-columns:\s*minmax\(58px,/);
});

test('webview reduces decorative motion when requested', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const reducedMotionBlocks = Array.from(
    css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{(?<body>[\s\S]*?)\n\}/g),
    (match) => match.groups?.body ?? ''
  );
  const statusMotionBlock =
    reducedMotionBlocks.find((block) => block.includes('.message-status.is-running')) || '';

  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(
    statusMotionBlock,
    /\.message-activity-inline\.is-running \.message-activity-text,\s*\.message-status\.is-running \.message-status-label\s*\{[^}]*animation:\s*none;/s
  );
  assert.doesNotMatch(css, /\.cursor\s*\{/);
  assert.doesNotMatch(css, /@keyframes cursor-blink/);
  assert.doesNotMatch(statusMotionBlock, /\.message-spinner/);
  assert.doesNotMatch(statusMotionBlock, /\.loading-spinner/);
});

test('webview keeps running status singular and supports quick choices', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const textScript = readFileSync(new URL('../media/messageText.js', import.meta.url), 'utf8');
  const choiceScript = readFileSync(new URL('../media/messageChoices.js', import.meta.url), 'utf8');
  const conversationScript = readFileSync(
    new URL('../media/conversationStore.js', import.meta.url),
    'utf8'
  );
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');
  const promptSource = readFileSync(new URL('../src/promptBuilder.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(script, /appendStreamingCursor/);
  assert.doesNotMatch(script, /message-streaming-cursor/);
  assert.doesNotMatch(script, /className = 'cursor/);
  assert.match(
    html,
    /__MESSAGE_TEXT_JS_URI__[\s\S]*__MESSAGE_CHOICES_JS_URI__[\s\S]*__PROVIDER_RUN_STATE_JS_URI__[\s\S]*__PROVIDER_CAPABILITIES_JS_URI__[\s\S]*__CONVERSATION_STORE_JS_URI__[\s\S]*__SESSION_HISTORY_JS_URI__[\s\S]*__SLASH_COMMANDS_JS_URI__[\s\S]*__OPEN_CODE_DIALOG_STATE_JS_URI__[\s\S]*__CLAUDE_ACTIONS_JS_URI__[\s\S]*__INLINE_MARKDOWN_JS_URI__[\s\S]*__MAIN_JS_URI__/
  );
  assert.match(html, /__MESSAGE_CHOICES_JS_URI__/);
  assert.match(script, /const messageText = window\.AgentsGuiMessageText/);
  assert.match(script, /const inlineMarkdown = window\.AgentsGuiInlineMarkdown/);
  assert.match(script, /const normalizeMessageText = messageText\.normalizeMessageText/);
  assert.match(script, /const stripInlineMarkdown = messageText\.stripInlineMarkdown/);
  assert.match(script, /const appendInlineMarkdown = inlineMarkdown\.appendInlineMarkdown/);
  assert.doesNotMatch(script, /function normalizeMessageText\(text\)/);
  assert.doesNotMatch(script, /function stripInlineMarkdown\(text\)/);
  assert.doesNotMatch(script, /function appendInlineMarkdown\(container, text\)/);
  assert.match(textScript, /function normalizeMessageText\(text\)/);
  assert.match(textScript, /function stripInlineMarkdown\(text\)/);
  assert.match(script, /const messageChoices = window\.AgentsGuiMessageChoices/);
  assert.match(script, /const providerCapabilities = window\.AgentsGuiProviderCapabilities/);
  assert.match(script, /messageChoices\.extractMessageChoices\(text/);
  assert.doesNotMatch(script, /function extractMessageChoices\(text/);
  assert.match(choiceScript, /require\('\.\/messageText\.js'\)/);
  assert.match(choiceScript, /root\.AgentsGuiMessageText/);
  assert.match(choiceScript, /function extractMessageChoices\(text/);
  assert.match(choiceScript, /function extractMessageChoiceLineKeys\(text\)/);
  assert.match(choiceScript, /function collectMessageChoiceCandidates\(text\)/);
  assert.match(choiceScript, /function hasMessageChoiceIntent\(text\)/);
  assert.match(choiceScript, /function parseMessageChoiceLine\(line\)/);
  assert.match(choiceScript, /function normalizeChoiceLabel\(value\)/);
  assert.match(choiceScript, /function normalizeMessageChoiceLine\(line\)/);
  assert.match(choiceScript, /if \(explicitCandidates\.length >= 2\) \{/);
  assert.match(choiceScript, /(?:→\|=>\|->)/);
  assert.match(choiceScript, /\(\?:选项\|方案\|Option\)/);
  assert.match(choiceScript, /[①②③④⑤⑥⑦⑧⑨⑩]/);
  assert.match(conversationScript, /function normalizeThreadMessages\(threadMessages/);
  assert.match(conversationScript, /function serializeThreadsForState\(source\)/);
  assert.match(conversationScript, /function createThread\(cliId, messages/);
  assert.match(conversationScript, /function ensureActiveThread\(source, activeThreadByProvider/);
  assert.match(script, /const conversationStore = window\.AgentsGuiConversationStore/);
  assert.match(script, /const claudeActions = window\.AgentsGuiClaudeActions/);
  assert.match(script, /conversationStore\.normalizeThreadMessages\(threadMessages/);
  assert.match(script, /conversationStore\.serializeThreadsForState\(threadsByProvider\)/);
  assert.match(script, /conversationStore\.createThread\(cliId, messages/);
  assert.match(
    script,
    /conversationStore\.ensureActiveThread\(\s*threadsByProvider,\s*activeThreadByProvider/s
  );
  assert.match(script, /dataset\.messageChoicePrompt = choice\.prompt/);
  assert.match(script, /event\.target\.closest\('\[data-message-choice-prompt\]'\)/);
  assert.match(script, /send\('freeform', prompt\)/);
  assert.match(script, /function extractClaudeApprovalRequest\(text\)/);
  assert.match(script, /className = 'claude-approval-panel'/);
  assert.match(script, /dataset\.claudeApprovalPrompt = choice\.prompt/);
  assert.match(script, /event\.target\.closest\('\[data-claude-approval-prompt\]'\)/);
  assert.doesNotMatch(script, /command:\s*'sendSessionInput'/);
  assert.match(css, /\.message-choice-actions\s*\{/);
  assert.match(css, /\.message-choice-button\s*\{/);
  assert.match(css, /\.message\.assistant:has\(\.claude-approval-panel\)\s*\{/);
  assert.match(css, /\.claude-approval-panel\s*\{/);
  assert.match(css, /\.claude-approval-choice\.is-selected\s*\{/);
  assert.doesNotMatch(css, /\.message-streaming-cursor\s*\{/);
  assert.match(i18nScript, /'message\.choice\.label'/);
  assert.match(i18nScript, /'message\.choice\.prompt'/);
  assert.match(i18nScript, /'claude\.approval\.placeholder': 'Tell Claude what to do instead'/);
  assert.match(promptSource, /Only when progress is blocked until the user chooses/);
  assert.match(promptSource, /Do not use that format for optional follow-up suggestions/);
  assert.match(promptSource, /Option N — label/);
  assert.match(promptSource, /选项 N — 标签/);
});


test('message choice parser extracts actionable choices from assistant text', () => {
  const choices = extractMessageChoices(
    [
      '提几个选项：',
      '- 选项 1 — 成功了的话 -> 告诉我就行',
      '- 选项 2 — 失败切换代理再试一次',
      '- 选项 3 — 换个思路。',
    ].join('\n'),
    { promptForChoice: (index, label) => `我选择选项 ${index}：${label}` }
  );

  assert.deepEqual(choices, [
    {
      index: '1',
      label: '成功了的话',
      prompt: '我选择选项 1：成功了的话',
    },
    {
      index: '2',
      label: '失败切换代理再试一次',
      prompt: '我选择选项 2：失败切换代理再试一次',
    },
    {
      index: '3',
      label: '换个思路',
      prompt: '我选择选项 3：换个思路',
    },
  ]);
});

test('message text utilities normalize terminal noise and inline markdown', () => {
  assert.equal(
    normalizeMessageText('hello\r\n\u001B[31mred\u001B[0m\n\n\n\nworld\u0007'),
    'hello\nred\n\n\nworld'
  );
  assert.equal(
    stripInlineMarkdown('**OpenCode** [`session`](https://example.com) uses `model`'),
    'OpenCode session uses model'
  );
});

test('inline markdown helper blocks unsafe link protocols', () => {
  assert.equal(
    inlineMarkdown.safeMarkdownHref('https://example.com/path?q=1'),
    'https://example.com/path?q=1'
  );
  assert.equal(inlineMarkdown.safeMarkdownHref('http://example.com'), 'http://example.com');
  assert.equal(
    inlineMarkdown.safeMarkdownHref('mailto:hello@example.com'),
    'mailto:hello@example.com'
  );
  assert.equal(inlineMarkdown.safeMarkdownHref('javascript:alert(1)'), '');
  assert.equal(inlineMarkdown.safeMarkdownHref('data:text/html;base64,PHNjcmlwdA=='), '');
  assert.equal(inlineMarkdown.safeMarkdownHref('https://example.com/\nnext'), '');
  assert.equal(inlineMarkdown.safeMarkdownHref('/relative/path'), '');
});

test('conversation store normalizes restored messages and serializes safe state', () => {
  const normalizedMessages = conversationStore.normalizeThreadMessages(
    [
      { role: 'user', text: 'hello', running: true },
      {
        role: 'assistant',
        text: 'raw assistant',
        running: true,
        startedAt: 123,
        durationMs: 2000,
        thinking: 'raw thinking',
      },
      {
        role: 'error',
        text: 'raw error',
        running: true,
        startedAt: 456,
        durationMs: 31 * 60 * 1000,
      },
    ],
    {
      normalizeAssistantText: (text) => `clean:${text}`,
      sanitizeThinkingText: (text) => `thinking:${text || ''}`,
    }
  );

  assert.deepEqual(normalizedMessages, [
    { role: 'user', text: 'hello', running: true },
    {
      role: 'assistant',
      text: 'clean:raw assistant',
      running: false,
      thinking: 'thinking:raw thinking',
      durationMs: 2000,
    },
    { role: 'error', text: 'clean:raw error', running: false, thinking: 'thinking:' },
  ]);

  assert.equal(conversationStore.normalizeDurationMs(30 * 60 * 1000), 30 * 60 * 1000);
  assert.equal(conversationStore.normalizeDurationMs(30 * 60 * 1000 + 1), undefined);
  assert.equal(conversationStore.normalizeDurationMs(-1), undefined);

  assert.deepEqual(
    conversationStore.serializeThreadsForState({
      codex: [
        {
          id: 'thread-1',
          messages: [
            { role: 'assistant', text: 'answer', running: true, startedAt: 123, durationMs: 3000 },
            {
              role: 'assistant',
              text: 'stale answer',
              running: false,
              startedAt: 456,
              durationMs: 31 * 60 * 1000,
            },
            { role: 'user', text: 'prompt', running: false },
          ],
        },
      ],
      claude: null,
    }),
    {
      codex: [
        {
          id: 'thread-1',
          messages: [
            { role: 'assistant', text: 'answer', running: false, durationMs: 3000 },
            { role: 'assistant', text: 'stale answer', running: false },
            { role: 'user', text: 'prompt', running: false },
          ],
        },
      ],
      claude: [],
    }
  );

  const created = conversationStore.createThread('codex', [{ role: 'user', text: 'hello' }], {
    now: () => 123,
    random: () => 'abc123',
    deriveThreadTitle: () => 'Derived title',
    newThreadTitle: 'New session',
  });
  assert.deepEqual(created, {
    id: 'codex-123-abc123',
    title: 'Derived title',
    createdAt: 123,
    updatedAt: 123,
    messages: [{ role: 'user', text: 'hello' }],
  });

  const threadsByProvider = {};
  const activeThreadByProvider = {};
  const ensured = conversationStore.ensureActiveThread(
    threadsByProvider,
    activeThreadByProvider,
    'codex',
    () => created
  );
  assert.equal(ensured, created);
  assert.equal(activeThreadByProvider.codex, 'codex-123-abc123');
  assert.equal(conversationStore.findThread(threadsByProvider, 'codex', created.id), created);
  const older = { ...created, id: 'older', updatedAt: 1 };
  conversationStore.setActiveThread(threadsByProvider, activeThreadByProvider, 'codex', older);
  assert.equal(activeThreadByProvider.codex, 'older');
  assert.equal(conversationStore.latestThread(threadsByProvider.codex), created);
});

test('session history derives thread states for multi-task groundwork', () => {
  const emptyThread = { id: 'thread-empty', messages: [], updatedAt: 10 };
  const answeredThread = {
    id: 'thread-answered',
    messages: [
      { role: 'user', text: '帮我分析' },
      { role: 'assistant', text: '可以' },
    ],
    updatedAt: 30,
  };
  const completedThread = {
    id: 'thread-completed',
    messages: [{ role: 'user', text: '跑测试' }],
    updatedAt: 20,
  };
  const tasks = [
    { providerId: 'opencode', threadId: 'thread-completed', status: 'completed', updatedAt: 100 },
    { providerId: 'opencode', threadId: 'thread-running', status: 'running', updatedAt: 120 },
  ];

  assert.equal(
    sessionHistory.threadStatus(emptyThread, { providerId: 'opencode', tasks }),
    'empty'
  );
  assert.equal(
    sessionHistory.threadStatus(answeredThread, { providerId: 'opencode', tasks }),
    'answered'
  );
  assert.equal(
    sessionHistory.threadStatus(completedThread, { providerId: 'opencode', tasks }),
    'completed'
  );
  assert.equal(
    sessionHistory.threadStatus(
      { id: 'thread-running', messages: [], updatedAt: 40 },
      { providerId: 'opencode', tasks }
    ),
    'running'
  );
  assert.equal(
    sessionHistory.threadStatus(
      { id: 'thread-pending', messages: [], updatedAt: 50 },
      {
        providerId: 'codex',
        pendingByProvider: { codex: true },
        pendingThreadByProvider: { codex: 'thread-pending' },
      }
    ),
    'preparing'
  );
  assert.deepEqual(
    sessionHistory
      .sortedThreads([emptyThread, answeredThread, completedThread])
      .map((thread) => thread.id),
    ['thread-answered', 'thread-completed', 'thread-empty']
  );
});

test('message choice parser ignores incidental numbered lists without choice intent', () => {
  assert.deepEqual(
    extractMessageChoices(
      ['分析完成。', '1. 第一处问题在渲染层。', '2. 第二处问题在状态层。'].join('\n')
    ),
    []
  );

  assert.deepEqual(
    extractMessageChoices(
      [
        '请选择下一步：',
        '```',
        '1. code fence item',
        '2. another code fence item',
        '```',
        '① 继续验证',
        '② 停止',
      ].join('\n')
    ).map(({ index, label }) => ({ index, label })),
    [
      { index: '1', label: '继续验证' },
      { index: '2', label: '停止' },
    ]
  );
});

test('message choice parser prefers explicit options over nearby procedural steps', () => {
  const text = [
    '需要你的操作',
    '1. 解锁你的 iPhone 7（输入锁屏密码）',
    '2. 解锁后我才能挂载开发者磁盘镜像，进入微信的 App 沙箱',
    '',
    '不过在此之前，请问你具体想找什么？',
    '- 选项 1 — 找微信好友列表/微信号（通讯录数据，存在微信的 SQLite 数据库里）',
    '- 选项 2 — 找微信聊天记录/图片/文件（存在 Documents 目录下）',
    '- 选项 3 — 找手机里的照片/视频（这个现在就可以通过 /DCIM/ 访问）',
  ].join('\n');

  assert.deepEqual(
    extractMessageChoices(text).map(({ index, label }) => ({ index, label })),
    [
      { index: '1', label: '找微信好友列表/微信号（通讯录数据，存在微信的 SQLite 数据库里）' },
      { index: '2', label: '找微信聊天记录/图片/文件（存在 Documents 目录下）' },
      { index: '3', label: '找手机里的照片/视频（这个现在就可以通过 /DCIM/ 访问）' },
    ]
  );
  assert.deepEqual(extractMessageChoiceLineKeys(text), [
    '选项 1 — 找微信好友列表/微信号（通讯录数据，存在微信的 SQLite 数据库里）',
    '选项 2 — 找微信聊天记录/图片/文件（存在 Documents 目录下）',
    '选项 3 — 找手机里的照片/视频（这个现在就可以通过 /DCIM/ 访问）',
  ]);
});

test('slash command helper parses, filters, dedupes, and composes commands', () => {
  const baseCommands = slashCommands.createBaseSlashCommands((key) => `t:${key}`);
  const provider = {
    id: 'opencode',
    slashCommands: [
      { name: 'fork', kind: 'native' },
      { name: 'bad' },
      null,
    ],
  };

  assert.deepEqual(slashCommands.parseSlashInput('/fork branch-name'), {
    query: 'fork',
    args: 'branch-name',
  });
  assert.equal(slashCommands.parseSlashInput('/mo/dels'), null);
  assert.equal(slashCommands.slashInputLooksLikeCommand('mo/dels'), false);
  assert.equal(
    slashCommands.slashCommandMatchesQuery({ name: 'fork' }, 'for'),
    true
  );
  assert.equal(
    slashCommands.slashCommandMatchesProvider(
      { name: 'codexOnly', providers: ['codex'] },
      provider
    ),
    false
  );

  const commands = slashCommands.commandsForProvider(baseCommands, provider);
  assert.equal(commands.filter((command) => command.name === 'new').length, 1);
  assert.ok(commands.some((command) => command.name === 'fork'));
  assert.equal(typeof slashCommands.nativeApiCommandNames, 'undefined');
  assert.equal(
    slashCommands.buildSlashCommandPrompt({ prompt: 'review this' }, 'extra'),
    'review this\n\nextra'
  );
  assert.equal(
    baseCommands.find((command) => command.name === 'review')?.prompt,
    't:quick.review.text'
  );
});


test('Claude action helper exposes context, account, and settings actions only', () => {
  const sections = claudeActions.actionSections({
    translate: (key) => key,
  });
  const flatActions = sections.flatMap((section) => section.actions);

  assert.equal(sections[0].title, 'claude.actions.context');
  assert.ok(flatActions.some((action) => action.id === 'accountUsage'));
  assert.ok(flatActions.some((action) => action.id === 'settings'));
  assert.equal(flatActions.some((action) => /switchModel|effort|thinking|permissions/.test(action.id)), false);
  assert.equal(claudeActions.actionMatchesQuery(flatActions[0], 'attach'), true);
  assert.equal(claudeActions.actionMatchesQuery(flatActions[0], 'missing'), false);
});

test('provider run state helper owns pending and running transitions', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const runStateScript = readFileSync(
    new URL('../media/providerRunState.js', import.meta.url),
    'utf8'
  );
  const state = providerRunState.createProviderRunState();

  assert.match(script, /const providerRunState = window\.AgentsGuiProviderRunState/);
  assert.match(script, /const providerRunStore = providerRunState\.createProviderRunState\(\)/);
  assert.match(
    script,
    /providerRunState\.setProviderPending\(providerRunStore, providerId, activeThreadId\(providerId\), task\.id\)/
  );
  assert.match(script, /providerRunState\.markProviderRunning\(providerRunStore, message\.cliId\)/);
  assert.match(script, /providerRunState\.clearProviderRunState\(providerRunStore, message\.cliId/);
  assert.match(script, /providerRunState\.pendingThreadId\(providerRunStore, message\.cliId\)/);
  assert.match(script, /providerRunState\.takePendingTaskId\(providerRunStore, message\.cliId\)/);
  assert.match(runStateScript, /function createProviderRunState\(\)/);
  assert.match(runStateScript, /function isProviderBusy\(state, providerId\)/);

  assert.equal(providerRunState.isProviderBusy(state, 'codex'), false);
  providerRunState.setProviderPending(state, 'codex', 'thread-1', 'task-1');
  assert.equal(providerRunState.isProviderBusy(state, 'codex'), true);
  assert.equal(state.pendingByProvider.codex, true);
  assert.equal(state.runningByProvider.codex, false);
  assert.equal(providerRunState.pendingThreadId(state, 'codex'), 'thread-1');
  providerRunState.markProviderRunning(state, 'codex');
  assert.equal(state.pendingByProvider.codex, false);
  assert.equal(state.runningByProvider.codex, true);
  assert.equal(providerRunState.takePendingTaskId(state, 'codex'), 'task-1');
  assert.equal(providerRunState.takePendingTaskId(state, 'codex'), '');
  providerRunState.clearProviderRunState(state, 'codex');
  assert.equal(providerRunState.isProviderBusy(state, 'codex'), false);
  assert.equal(state.pendingThreadByProvider.codex, undefined);
});


test('composer state helper owns send readiness and placeholders', () => {
  const translate = (key, values = {}) => {
    if (key === 'input.placeholderProvider') {
      return `ask ${values.provider}`;
    }
    if (key === 'input.placeholderAction') {
      return `${values.action} with ${values.provider}`;
    }
    return key;
  };
  const profile = { id: 'opencode', name: 'OpenCode', installed: true };

  const ready = composerState.deriveComposerState({
    profile,
    activeId: 'opencode',
    promptText: 'hello',
    attachmentCount: 0,
    selectedAction: 'freeform',
    installedProviderCount: 1,
    translate,
    actionLabel: (action) => `label:${action}`,
  });
  assert.equal(ready.canSend, true);
  assert.equal(ready.sendDisabled, false);
  assert.equal(ready.placeholder, 'ask OpenCode');
  assert.equal(ready.providerSelectDisabled, false);

  const missingSelection = composerState.deriveComposerState({
    profile,
    activeId: 'opencode',
    promptText: '',
    selectedAction: 'reviewFile',
    requiresSelection: true,
    hasSelection: false,
    installedProviderCount: 1,
    translate,
  });
  assert.equal(missingSelection.sendDisabled, true);
  assert.equal(missingSelection.missingSelection, true);
  assert.equal(missingSelection.placeholder, 'quick.missingSelection');

  const running = composerState.deriveComposerState({
    profile,
    activeId: 'opencode',
    running: true,
    promptText: 'hello',
    installedProviderCount: 1,
    translate,
  });
  assert.equal(running.running, true);
  assert.equal(running.busy, true);
  assert.equal(running.sendDisabled, true);
  assert.equal(running.optionSelectDisabled, true);

  const actionState = composerState.actionButtonState('reviewFile', ready, true, false);
  assert.equal(actionState.disabled, true);
  assert.equal(actionState.missingSelection, true);
  assert.deepEqual(composerState.actionButtonState('openSettings', ready, true, false), {
    disabled: false,
    missingSelection: false,
  });
});



test('context summary matching accepts same-request retries but rejects superseded retries', () => {
  const latestRequest = {
    requestId: 'page-3',
    cliId: 'opencode',
    modelId: 'openai/gpt-5.5',
  };
  const matches = (response) =>
    providerOptions.contextSummaryMatches({
      expectedRequest: latestRequest,
      response,
      activeCliId: 'opencode',
      activeModelId: 'openai/gpt-5.5',
    });

  assert.equal(matches({ ...latestRequest, summary: { mcpStatusPending: true } }), true);
  assert.equal(matches({ ...latestRequest, summary: { mcpStatusPending: false } }), true);
  assert.equal(
    matches({
      ...latestRequest,
      requestId: 'page-2',
      summary: { mcpStatusPending: false },
    }),
    false
  );
});

test('webview uses a ring spinner for running message status', () => {
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const runningSpinnerRule =
    css.match(/\.message-status\.is-running \.message-spinner\s*\{(?<body>[^}]+)\}/s)?.groups
      ?.body ?? '';
  const spinnerRule = css.match(/\.message-spinner\s*\{(?<body>[^}]+)\}/s)?.groups?.body ?? '';

  assert.match(spinnerRule, /display:\s*inline-block/);
  assert.match(spinnerRule, /conic-gradient/);
  assert.match(spinnerRule, /will-change:\s*transform/);
  assert.match(spinnerRule, /contain:\s*paint/);
  assert.match(spinnerRule, /animation:\s*message-spin 1s linear infinite/);
  assert.match(
    css,
    /@keyframes message-spin \{\s*from \{\s*transform:\s*translateZ\(0\) rotate\(0turn\);\s*\}\s*to \{\s*transform:\s*translateZ\(0\) rotate\(1turn\);/s
  );
  assert.doesNotMatch(spinnerRule, /border-top-color:/);
  assert.doesNotMatch(runningSpinnerRule, /border-top-color:/);
  assert.doesNotMatch(runningSpinnerRule, /dot-pulse/);
});

test('preview webview streams markdown with real line breaks', () => {
  const script = readFileSync(new URL('../scripts/preview-webview.mjs', import.meta.url), 'utf8');

  assert.match(script, /media', 'webview-assets\.json'/);
  assert.match(script, /manifest\.assets\.map\(\(asset\) => asset\.path\)/);
  assert.match(script, /assetUriByPlaceholder/);
  assert.match(
    script,
    /for \(const \[placeholder, uri\] of Object\.entries\(assetUriByPlaceholder\)\)/
  );
  assert.match(script, /unresolved VS Code placeholders/);
  assert.match(script, /\.join\('\\\\n'\)/);
  assert.doesNotMatch(script, /\.join\('\\\\\\\\n'\)/);
  assert.match(script, /'\\\\u001b\[0m'/);
  assert.doesNotMatch(script, /'\\\\\\\\u001b\[0m'/);
});




test('webview front-end explains and blocks selection-only actions without selection', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const composerSource = readFileSync(
    new URL('../media/composerState.js', import.meta.url),
    'utf8'
  );

  assert.match(script, /function actionRequiresSelection\(action\)/);
  assert.match(script, /function hasSelectionContext\(\)/);
  assert.match(script, /requiresSelection: actionRequiresSelection\(selectedAction\),/);
  assert.match(script, /hasSelection: hasSelectionContext\(\),/);
  assert.match(script, /quick\.missingSelection/);
  assert.match(script, /composerState\.actionButtonState\(/);
  assert.match(composerSource, /if \(action === 'openSettings'\) \{/);
  assert.match(
    composerSource,
    /const missingSelection = Boolean\(requiresSelection && !hasSelection\);/
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
  assert.match(
    script,
    /if \(event\.key === 'Escape'\) \{\s*event\.preventDefault\(\);\s*closeDeleteThreadDialog\(\);/s
  );
  assert.match(script, /cancel\.addEventListener\('click', closeDeleteThreadDialog\);/);
  assert.match(script, /deleteActiveThread\(cliId\);/);
  assert.match(script, /requestAnimationFrame\(\(\) => cancel\.focus\(\)\);/);
  assert.doesNotMatch(script, /window\.confirm/);
  assert.match(css, /\.session-delete-backdrop\s*\{/);
  assert.match(css, /\.session-delete-dialog\s*\{/);
  assert.match(i18nScript, /'history\.deleteConfirmTitle': 'Delete session\?'/);
  assert.match(i18nScript, /'history\.deleteConfirmTitle': '删除当前会话？'/);
});

test('webview thread deletion remains local and has no managed OpenCode session protocol', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const conversationStoreSource = readFileSync(
    new URL('../media/conversationStore.js', import.meta.url),
    'utf8'
  );
  const protocolSource = readFileSync(new URL('../src/webviewProtocol.ts', import.meta.url), 'utf8');

  assert.match(script, /function deleteActiveThread\(cliId = activeId\)/);
  assert.match(script, /delete activeThreadByProvider\[cliId\];/);
  assert.match(script, /deleteThreadBtn\.disabled = !canDeleteActiveThread\(activeId\);/);
  assert.doesNotMatch(conversationStoreSource, /openCodeSessionId/);
  assert.doesNotMatch(script, /openCodeSessionId|deleteOpenCodeSession|noteOpenCodeSessionId/);
  assert.doesNotMatch(protocolSource, /openCodeSessionId|deleteOpenCodeSession/);
  assert.doesNotMatch(
    script,
    /const next = threads\.sort\(\(a, b\) => b\.updatedAt - a\.updatedAt\)\[0\] \|\| createThread\(activeId\);/
  );
});

test('webview has no orphaned message metadata merger', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.doesNotMatch(script, /function mergeMessageMeta\(/);
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
  assert.equal(
    normalizeCliOutput('[0m\n> Sisyphus - Ultraworker\n[0m'),
    '\n> Sisyphus - Ultraworker\n'
  );
});

test('normalizeCliOutput hides OpenCode run banners before response text', () => {
  assert.equal(
    normalizeCliOutput(
      '\u001b[0m\n> \u200bSisyphus - Ultraworker · mimo-v2.5-pro\n\u001b[0m',
      'opencode'
    ),
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

test('normalizeCliOutputChunk surfaces Claude Code stream errors', () => {
  assert.deepEqual(
    normalizeCliOutputChunk(
      '{"type":"result","subtype":"error_max_turns","is_error":true,"result":"Maximum turns reached"}\n',
      'claude'
    ),
    { text: 'Error: Maximum turns reached\n', buffer: '' }
  );

  assert.deepEqual(
    normalizeCliOutputChunk('{"type":"error","message":"Authentication required"}\n', 'claude'),
    { text: 'Error: Authentication required\n', buffer: '' }
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

test('normalizeCliOutput explains OpenCode attach and provider setup errors', () => {
  assert.equal(
    normalizeCliOutput('No context found for instance\n', 'opencode'),
    'Error: OpenCode did not receive the workspace directory for this attached session. Reload the window or retry after Agents GUI reconnects to OpenCode.\n'
  );
  assert.equal(
    normalizeCliOutput(
      'Service Unavailable: {"error":{"code":"model_not_found","message":"model_not_found"}}',
      'opencode'
    ),
    'Error: OpenCode model is not available in the current provider. Choose Configured or another listed OpenCode model, then retry.\n'
  );
});

test('normalizeCliOutput surfaces OpenCode top-level provider errors', () => {
  const errorLine =
    '{"type":"error","timestamp":1778855556690,"sessionID":"ses_1","error":{"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details."}}}\n';
  const authErrorLine =
    '{"type":"error","timestamp":1781145835992,"sessionID":"ses_1","error":{"name":"APIError","data":{"message":"Your authentication token has been invalidated. Please try signing in again.","statusCode":401,"isRetryable":false}}}\n';
  const genericAuthErrorLine = `${JSON.stringify({
    type: 'error',
    timestamp: 1781145835992,
    sessionID: 'ses_1',
    error: {
      name: 'APIError',
      data: {
        message: 'Unexpected server error. Check server logs for details.',
        statusCode: 401,
        responseBody: JSON.stringify(
          {
            error: {
              message:
                'Your authentication token has been invalidated. Please try signing in again.',
              code: 'token_invalidated',
            },
          },
          null,
          2
        ),
      },
    },
  })}\n`;

  assert.deepEqual(normalizeCliOutputChunk(errorLine, 'opencode'), {
    text: 'Error: Unexpected server error. Check server logs for details.\n',
    buffer: '',
  });
  assert.equal(
    normalizeCliOutput(errorLine, 'opencode'),
    'Error: Unexpected server error. Check server logs for details.\n'
  );
  assert.equal(
    normalizeCliOutput(authErrorLine, 'opencode'),
    'Error: Your authentication token has been invalidated. Please try signing in again.\n'
  );
  assert.equal(
    normalizeCliOutput(genericAuthErrorLine, 'opencode'),
    'Error: Your authentication token has been invalidated. Please try signing in again.\n'
  );
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
    normalizeCliOutput(
      '2026-04-29T10:23:36.865183Z  WARN codex_analytics::client: events failed\n',
      'codex'
    ),
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
      thinking:
        'The user is asking “你是谁” and the message starts with `[analyze-mode]`. Reply in Chinese (简体中文).',
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

test('editor actions carry only action and prompt context', () => {
  const source = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  const editorAction = source.slice(
    source.indexOf('async runEditorAction'),
    source.indexOf('private async handleLoadMcpServers')
  );
  assert.doesNotMatch(editorAction, /agentMode|permissionMode|preferredReadOnlyMode/);
  assert.match(editorAction, /action,/);
  assert.match(editorAction, /contextOptions:/);
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

test('compactHistoryText does not produce lone surrogates when truncating emoji text', () => {
  const { buildAssistantPrompt } = require('../.test-dist/promptBuilder.js');

  const emoji = '🎯';
  const prefix = 'a'.repeat(1196);
  const longText = prefix + emoji + 'b'.repeat(200);
  const history = [{ role: 'user', text: longText }];

  const prompt = buildAssistantPrompt({
    provider: { id: 'claude', name: 'Claude' },
    mode: 'agent',
    agentMode: { id: 'build', label: 'build', instruction: '' },
    runtime: {
      modelId: 'm',
      modelLabel: 'M',
      modelVariant: '',
      runtimeId: 'r',
      runtimeLabel: 'R',
      permissionModeId: 'p',
      permissionModeLabel: 'P',
    },
    action: 'freeform',
    message: 'test',
    attachments: [],
    conversationHistory: history,
    context: { diagnostics: [] },
    locale: 'en',
  });

  const historyLine = prompt.split('\n').find((l) => l.includes('User: a'));
  assert.ok(historyLine, 'history line should exist');
  assert.ok(!historyLine.endsWith('\uD83C'), 'should not end with a lone high surrogate');
  assert.ok(historyLine.endsWith('...'), 'should end with truncation marker');
});

test('fencedBlock preserves inner triple backticks without lossy escaping', () => {
  const { buildAssistantPrompt } = require('../.test-dist/promptBuilder.js');

  const codeWithFence = 'outer\n```\ninner code\n```\nrest';
  const prompt = buildAssistantPrompt({
    provider: { id: 'claude', name: 'Claude' },
    mode: 'agent',
    agentMode: { id: 'build', label: 'build', instruction: '' },
    runtime: {
      modelId: 'm',
      modelLabel: 'M',
      modelVariant: '',
      runtimeId: 'r',
      runtimeLabel: 'R',
      permissionModeId: 'p',
      permissionModeLabel: 'P',
    },
    action: 'freeform',
    message: 'test',
    attachments: [],
    conversationHistory: [],
    context: {
      diagnostics: [],
      activeFile: {
        relativePath: 'test.ts',
        languageId: 'typescript',
        lineCount: 5,
        text: codeWithFence,
        truncated: false,
      },
    },
    locale: 'en',
  });

  assert.ok(prompt.includes('inner code'), 'inner code content must be preserved');
  assert.ok(prompt.includes('```'), 'original triple backticks must be intact');
  assert.ok(!prompt.includes('``\\`'), 'lossy escape artifact must not appear');
  assert.ok(/~{3,}typescript/.test(prompt), 'should use tilde fence for outer block');
});

test('composer exposes no CLI execution override controls', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const protocol = readFileSync(new URL('../src/webviewProtocol.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /modelSelect|modelOptionList|runtimeSelect|runtimeOptionList/);
  assert.doesNotMatch(html, /permissionSelect|permissionOptionList/);
  assert.doesNotMatch(script, /activeModel|customModel|modelVariant|activeRuntime|activePermission/);
  assert.doesNotMatch(script, /setOpenCodeModelVariant|OPENCODE_OPTION_DIALOG_KINDS/);
  assert.doesNotMatch(protocol, /setOpenCodeModelVariant|modelVariant|customModel/);
  assert.match(
    script,
    /command:\s*'send'[\s\S]*cliId:[\s\S]*text:[\s\S]*action:[\s\S]*conversationHistory:/
  );
});

test('context capacity uses the configured model only in the host observation path', () => {
  const typesSource = readFileSync(new URL('../src/assistantTypes.ts', import.meta.url), 'utf8');
  const collectorSource = readFileSync(
    new URL('../src/contextCollector.ts', import.meta.url),
    'utf8'
  );
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const counterSource = readFileSync(new URL('../src/tokenCounter.ts', import.meta.url), 'utf8');

  assert.match(typesSource, /tokenUsage\?: AssistantTokenUsage/);
  assert.doesNotMatch(collectorSource, /estimateContextTokens/);
  assert.match(sidebarSource, /configuredModelId = profile\?\.configuredModel\?\.id/);
  assert.match(sidebarSource, /countContextTokens\(snapshot, profile, configuredModelId\)/);
  assert.match(sidebarSource, /resolveContextWindowTokens\(profile, configuredModelId\)/);
  assert.doesNotMatch(sidebarSource, /scheduleOpenCodeStatusRefresh/);
  assert.match(counterSource, /precision: 'estimated'/);
});

test('composer retains setup, authentication, and provider-scoped agent controls', () => {
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');
  const cliSetupSource = readFileSync(new URL('../src/cliSetup.ts', import.meta.url), 'utf8');
  const profilesSource = readFileSync(new URL('../src/cliProfiles.ts', import.meta.url), 'utf8');

  assert.match(html, /id="agentModeSelect"[^>]*name="assistantAgentMode"/);
  assert.match(html, /id="promptInput"[^>]*name="assistantPrompt"[^>]*autocomplete="off"/);
  assert.match(script, /function createCliSetupCard\(profile, recommended\)/);
  assert.match(script, /function createHomeAgentAuthActions\(profile\)/);
  assert.match(script, /command: 'runCliAuthAction'/);
  assert.match(script, /vscode\.postMessage\(\{ command: 'checkProfiles', force: true \}\)/);
  assert.match(sidebarSource, /case 'runCliAuthAction':/);
  assert.match(sidebarSource, /case 'installCli':/);
  assert.match(cliSetupSource, /export class CliSetupController/);
  assert.match(cliSetupSource, /profile\?\.authCommands\?\.\[authAction\]/);
  assert.match(profilesSource, /name: 'terminal',[\s\S]*local: 'terminal'/);
  assert.match(profilesSource, /name: 'agents',[\s\S]*local: 'agents'/);
  assert.doesNotMatch(profilesSource, /name: 'models'|name: 'variants'|name: 'sessions'/);
});

test('composer correlates context by request and CLI identity and sends the active provider only', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');

  assert.match(script, /function refreshActiveContext\(\)/);
  assert.match(script, /const request = \{\s*requestId: nextContextRequestId\(\),\s*cliId: activeId,\s*\};/);
  assert.match(script, /command: 'refreshContext',[\s\S]*\.\.\.request,[\s\S]*contextOptions:/);
  assert.match(script, /case 'contextSummary':[\s\S]*providerOptions\.contextSummaryMatches/);
  assert.doesNotMatch(script, /activeModelId|activeModelId:/);
  assert.match(script, /const profile = activeProfile\(\);\s*if \(!profile\?\.installed\) \{/);
  assert.match(script, /command: 'send',[\s\S]*cliId: providerId,[\s\S]*agentMode:[\s\S]*conversationHistory:/);
  assert.doesNotMatch(script, /selectedProviderIdsForSend|renderAgentRail|agentPicker/);
});

test('agent-only browser helpers normalize modes and preserve strict context correlation', () => {
  const profile = {
    id: 'opencode',
    defaultAgentMode: 'plan',
    agentModes: [{ id: 'build' }, { id: 'plan' }, { id: 'disabled', disabled: true }],
  };

  assert.equal(providerCapabilities.usesNativeAgentConfig(profile), true);
  assert.equal(providerCapabilities.usesNativeAgentConfig('codex'), false);
  assert.equal(providerCapabilities.controlVisibility(profile), true);
  assert.equal(providerOptions.normalizeAgentModeId(profile, 'missing'), 'plan');
  assert.equal(providerOptions.mapLegacyWorkflowMode(profile, 'execute'), 'plan');
  assert.deepEqual(providerOptions.splitAgentModeLabel('Build - Primary'), {
    title: 'Build',
    detail: 'Primary',
  });
  assert.equal(
    providerOptions.contextSummaryMatches({
      expectedRequest: { requestId: 'request-2', cliId: 'opencode' },
      response: { requestId: 'request-2', cliId: 'opencode', summary: {} },
      activeCliId: 'opencode',
    }),
    true
  );
  assert.equal(
    providerOptions.contextSummaryMatches({
      expectedRequest: { requestId: 'request-2', cliId: 'opencode' },
      response: { requestId: 'request-1', cliId: 'opencode', summary: {} },
      activeCliId: 'opencode',
    }),
    false
  );
});

test('OpenCode dialog state supports agent commands without model or session controls', () => {
  const options = [{ id: 'a' }, { id: 'b', selected: true }, { id: 'c' }];

  assert.equal(openCodeDialogState.normalizeCommandQuery('///Agents '), 'agents');
  assert.deepEqual(openCodeDialogState.commandAliases('agents'), ['agent', 'agents']);
  assert.equal(openCodeDialogState.isCommandEcho('agents', '/agent', 'agents'), true);
  assert.equal(openCodeDialogState.isCommandEcho('agents', '/models', 'agents'), false);
  assert.equal(openCodeDialogState.initialActiveIndex(options), 1);
  assert.equal(openCodeDialogState.moveActiveIndex(0, options, -1), 2);
  assert.equal(openCodeDialogState.activeOptionId(options, 99), 'c');
  assert.equal(typeof openCodeDialogState.groupModelOptions, 'undefined');
});

test('agent mode persistence and send readiness are independent of execution overrides', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const composerSource = readFileSync(new URL('../media/composerState.js', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.match(script, /activeAgentModeByProvider: persistableAgentModeMap\(activeAgentModeByProvider\)/);
  assert.match(script, /agentModeSelect\.addEventListener\('change'/);
  assert.match(script, /agentMode: preferredWorkflowMode \|\| activeAgentModeId\(providerId\)/);
  assert.doesNotMatch(script, /activeRuntimeByProvider|activePermissionByProvider|customModelByProvider/);
  assert.match(sidebarSource, /this\.state\.update\(\s*AGENT_MODE_STATE_KEY,/s);
  assert.doesNotMatch(sidebarSource, /RUNTIME_STATE_KEY|PERMISSION_STATE_KEY/);
  assert.match(composerSource, /const hasPrompt = String\(options\.promptText \|\| ''\)\.trim\(\)\.length > 0;/);
  assert.match(composerSource, /sendDisabled: !canSend \|\| busy \|\| !canRunAction \|\| missingSelection,/);
  assert.doesNotMatch(composerSource, /missingCustomModel/);
});

test('native OpenCode slash commands use the ordinary fresh-request send path', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const protocol = readFileSync(new URL('../src/webviewProtocol.ts', import.meta.url), 'utf8');

  assert.match(
    script,
    /if \(command\.kind === 'native'\) \{[\s\S]*send\('freeform', `\/\$\{command\.name\}\$\{args \? ` \$\{args\}` : ''\}`\);/
  );
  assert.doesNotMatch(script, /openCodeNativeCommand|activeOpenCodeSessionId|nativeApiCommandNames/);
  assert.doesNotMatch(protocol, /openCodeNativeCommand|openCodeNativeCommandResult/);
});

test('request-start metadata contains context but no execution model selection', () => {
  const script = readFileSync(new URL('../media/main.js', import.meta.url), 'utf8');
  const i18nScript = readFileSync(new URL('../media/i18n.js', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/sidebarProvider.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(script, /summarizeRuntimeSelection|modelLabel \|\| message\?\.modelId/);
  assert.doesNotMatch(i18nScript, /message\.modelMeta/);
  assert.doesNotMatch(sidebarSource, /modelId:|modelLabel:/);
});

test('retired OpenCode model-state infrastructure is absent from runtime code', () => {
  const agentsSource = readFileSync(new URL('../src/opencodeAgents.ts', import.meta.url), 'utf8');
  const profilesSource = readFileSync(new URL('../src/cliProfiles.ts', import.meta.url), 'utf8');
  const localStatePath = new URL('../src/openCodeLocalState.ts', import.meta.url);

  assert.doesNotMatch(agentsSource, /OpenCodeModelState|recentModelIds|currentVariant|variantOptions|parseOpenCodeModelId/);
  assert.doesNotMatch(profilesSource, /variant\?: string/);
  assert.equal(require('node:fs').existsSync(localStatePath), false);
});

test('filterPromptEchoChunk buffer accommodates prompts larger than 16K', () => {
  const { filterPromptEchoChunk } = require('../.test-dist/outputFormatter.js');

  const promptStart = 'You are an AI coding assistant embedded in VS Code.';
  const midMarker = 'Response requirements:';
  const promptEnd = '- Risks and caveats: call out assumptions, follow-up work, and edge cases.';
  const fullPromptEcho =
    promptStart + '\n' + midMarker + '\n' + 'x'.repeat(30000) + '\n' + promptEnd;

  const chunk1 = fullPromptEcho.slice(0, 20000);
  const chunk2 = fullPromptEcho.slice(20000) + '\nAI reply here';

  const first = filterPromptEchoChunk(chunk1, 'opencode', '');
  assert.equal(first.text, '', 'should buffer while end marker has not arrived');
  assert.ok(first.buffer.length > 16000, 'buffer should retain more than 16K of partial echo');

  const second = filterPromptEchoChunk(chunk2, 'opencode', first.buffer);
  assert.ok(
    second.text.includes('AI reply here'),
    'should emit real output once end marker arrives'
  );
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
