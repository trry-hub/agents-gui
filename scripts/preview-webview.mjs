import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const previewRoot = '/tmp/agents-gui-preview';
const outputPath = path.join(previewRoot, 'agents-gui-preview.html');
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'media', 'webview-assets.json'), 'utf8')
);

let html = fs.readFileSync(path.join(root, 'media', manifest.html), 'utf8');

fs.mkdirSync(previewRoot, { recursive: true });
const webviewAssets = [
  manifest.html,
  ...manifest.assets.map((asset) => asset.path),
  ...Object.values(manifest.providerIcons).flatMap((icon) => [
    icon.light,
    icon.dark,
  ]),
  ...manifest.static,
];
for (const file of webviewAssets) {
  fs.mkdirSync(path.dirname(path.join(previewRoot, file)), { recursive: true });
  fs.copyFileSync(path.join(root, 'media', file), path.join(previewRoot, file));
}
const assetUriByPlaceholder = Object.fromEntries(
  manifest.assets.map((asset) => [asset.placeholder, `./${asset.path}`])
);
const i18nUri = assetUriByPlaceholder.__I18N_JS_URI__;

const codexModes = [
  { id: 'build', label: 'Build', description: 'Codex implementation workflow', instruction: 'Implement scoped changes.' },
  { id: 'plan', label: 'Plan', description: 'Codex planning workflow', instruction: 'Plan before editing.' },
  { id: 'review', label: 'Review', description: 'Codex review mode', instruction: 'Lead with findings.' },
];
const codexModels = [
  { id: 'gpt-5.5', label: 'GPT-5.5', description: 'Frontier model for complex work', args: ['--model', 'gpt-5.5'] },
  { id: 'gpt-5.4', label: 'GPT-5.4', description: 'Strong model for everyday coding', args: ['--model', 'gpt-5.4'] },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', description: 'Fast model for lighter tasks', args: ['--model', 'gpt-5.4-mini'] },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', description: 'Coding-optimized model', args: ['--model', 'gpt-5.3-codex'] },
  { id: 'gpt-5.3-codex-spark', label: 'Codex Spark', description: 'Ultra-fast coding model', args: ['--model', 'gpt-5.3-codex-spark'] },
  { id: 'custom', label: 'Custom', description: 'Enter a custom model id', custom: true },
];
const codexRuntimes = [
  { id: 'localProcessing', label: 'Process locally', summaryLabel: 'Local mode', description: 'Keep Codex work on this machine.' },
  { id: 'codexWeb', label: 'Connect Codex web', description: 'Open Codex web connection settings.', actionOnly: true, external: true },
  { id: 'sendCloud', label: 'Send to cloud', description: 'Cloud handoff is not available in this extension yet.', disabled: true },
  { id: 'quota', label: 'Remaining quota', description: 'View remaining Codex web quota.', actionOnly: true, dividerBefore: true },
];
const codexPermissions = [
  { id: 'readOnly', label: 'Read Only', description: 'Inspect without edits', args: ['--sandbox', 'read-only'] },
  { id: 'workspaceWrite', label: 'Workspace', description: 'Edit workspace files', args: ['--sandbox', 'workspace-write'] },
  { id: 'fullAuto', label: 'Full Auto', description: 'Low-friction sandboxed automation', args: ['--full-auto'] },
  { id: 'danger', label: 'Danger', description: 'Bypass approvals and sandbox', args: ['--dangerously-bypass-approvals-and-sandbox'], dangerous: true },
];
const claudeModes = [
  { id: 'build', label: 'Build', description: 'Claude Code implementation workflow', instruction: 'Implement scoped changes.' },
  { id: 'plan', label: 'Plan', description: 'Claude Code planning workflow', instruction: 'Plan before editing.' },
  { id: 'review', label: 'Review', description: 'Claude Code review mode', instruction: 'Lead with findings.' },
];
const claudePermissions = [
  { id: 'default', label: 'Ask before edits', description: 'Claude Code default permission mode.', args: ['--permission-mode', 'default'] },
  { id: 'acceptEdits', label: 'Accept edits', description: 'Claude can edit without asking each time.', args: ['--permission-mode', 'acceptEdits'] },
  { id: 'plan', label: 'Plan', description: 'Planning before changes.', args: ['--permission-mode', 'plan'] },
  { id: 'bypassPermissions', label: 'Bypass', description: 'Bypass permissions in isolated environments only.', args: ['--permission-mode', 'bypassPermissions'], dangerous: true },
];
const geminiModes = [
  { id: 'assist', label: 'Assist', description: 'General Gemini CLI coding assistant', instruction: 'Answer directly with project context.' },
  { id: 'plan', label: 'Plan', description: 'Planning and analysis without changes', instruction: 'Analyze before changes.' },
  { id: 'build', label: 'Build', description: 'Implementation-focused Gemini workflow', instruction: 'Implement requested changes.' },
];
const opencodeModes = [
  { id: 'Sisyphus - Ultraworker', label: 'Sisyphus - Ultraworker', description: 'OpenCode configured primary agent', instruction: 'Use the configured primary agent.' },
  { id: 'Atlas - Plan Executor', label: 'Atlas - Plan Executor', description: 'OpenCode custom primary agent', instruction: 'Use the plan executor agent.' },
  { id: 'Hephaestus - Deep Agent', label: 'Hephaestus - Deep Agent', description: 'OpenCode custom primary agent', instruction: 'Use the deep agent.' },
  { id: 'Prometheus - Plan Builder', label: 'Prometheus - Plan Builder', description: 'OpenCode custom primary agent', instruction: 'Use the plan builder agent.' },
];
const opencodeModels = [
  { id: 'mimo/mimo-v2.5-pro', label: 'mimo/mimo-v2.5-pro', summaryLabel: 'mimo-v2.5-pro', description: 'OpenCode model from configured providers.', args: ['--model', 'mimo/mimo-v2.5-pro'] },
  { id: 'opencode/big-pickle', label: 'opencode/big-pickle', summaryLabel: 'big-pickle', description: 'OpenCode hosted model.', args: ['--model', 'opencode/big-pickle'] },
  { id: 'custom', label: 'Custom', description: 'Enter a provider/model string accepted by OpenCode.', custom: true },
];
const providerIcons = Object.fromEntries(
  Object.entries(manifest.providerIcons).map(([providerId, icon]) => [
    providerId,
    { light: `./${icon.light}`, dark: `./${icon.dark}` },
  ])
);

const vscodeStub = `
<script>
const codexModes = ${JSON.stringify(codexModes)};
const codexModels = ${JSON.stringify(codexModels)};
const codexRuntimes = ${JSON.stringify(codexRuntimes)};
const codexPermissions = ${JSON.stringify(codexPermissions)};
const claudeModes = ${JSON.stringify(claudeModes)};
const claudePermissions = ${JSON.stringify(claudePermissions)};
const geminiModes = ${JSON.stringify(geminiModes)};
const opencodeModes = ${JSON.stringify(opencodeModes)};
const opencodeModels = ${JSON.stringify(opencodeModels)};
window.__messages = [];
const previewStateKey = 'agents-gui-preview-state-v2';
let previewThreadSequence = 0;
function emitPreviewMessage(data, delay) {
  setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data })), delay);
}
function emitThreadEvent(providerId, threadId, event, delay) {
  previewThreadSequence += 1;
  emitPreviewMessage({
    command: 'threadEvent',
    providerId,
    threadId,
    sequence: previewThreadSequence,
    event,
  }, delay);
}
window.acquireVsCodeApi = () => ({
  getState() {
    try {
      return JSON.parse(localStorage.getItem(previewStateKey) || '{}');
    } catch {
      return {};
    }
  },
  setState(state) {
    window.__state = state;
    localStorage.setItem(previewStateKey, JSON.stringify(state));
  },
  postMessage(message) {
    window.__messages.push(message);
    if (message.command === 'checkProfiles') {
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: {
        command: 'profiles',
        defaultProviderId: 'opencode',
        profiles: [
          { id: 'claude', name: 'Claude Code', accent: '#d97757', installed: true, version: '2.1.118', webviewIcon: ${JSON.stringify(providerIcons.claude)}, installHint: 'curl -fsSL https://claude.ai/install.sh | bash', defaultAgentMode: 'build', agentModes: claudeModes, defaultPermissionMode: 'default', permissionModes: claudePermissions },
          { id: 'gemini', name: 'Gemini CLI', accent: '#4285f4', installed: true, version: '0.40.0', webviewIcon: ${JSON.stringify(providerIcons.gemini)}, installHint: 'npm install -g @google/gemini-cli', defaultAgentMode: 'assist', agentModes: geminiModes },
          { id: 'codex', name: 'Codex CLI', accent: '#10a37f', installed: true, version: '0.128.0', webviewIcon: ${JSON.stringify(providerIcons.codex)}, installHint: 'npm install -g @openai/codex', defaultAgentMode: 'build', agentModes: codexModes, defaultModel: 'gpt-5.4', modelOptions: codexModels, defaultRuntime: 'localProcessing', runtimeModes: codexRuntimes, defaultPermissionMode: 'workspaceWrite', permissionModes: codexPermissions },
          { id: 'opencode', name: 'OpenCode', accent: '#a855f7', installed: true, version: '1.14.49', webviewIcon: ${JSON.stringify(providerIcons.opencode)}, installHint: 'brew install opencode-ai/tap/opencode', defaultAgentMode: 'Sisyphus - Ultraworker', agentModes: opencodeModes, defaultModel: 'mimo/mimo-v2.5-pro', modelOptions: opencodeModels },
          { id: 'missing', name: 'Missing CLI', accent: '#d97757', installed: false, installHint: 'install missing-cli' }
        ],
      }})), 20);
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
        data: { command: 'contextInvalidated' },
      })), 21);
    }
    if (message.command === 'refreshContext') {
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: {
        command: 'contextSummary',
        requestId: message.requestId,
        cliId: message.cliId,
        modelId: message.modelId,
        summary: {
          workspace: 'agents-gui',
          workspacePath: '/Users/t/6bt/myproject/agents-gui',
          workspaceBranch: 'main',
          openCodeProject: { id: 'preview-project', worktree: '/Users/t/6bt/project/xiaoyaojing-platform', vcs: 'git' },
          activeFile: 'src/extension.ts',
          selection: 'lines 1-8',
          diagnostics: 2,
          tokenUsage: { precision: 'exact', tokens: 73224, tokenizer: 'preview' },
          contextWindowTokens: 128000,
          mcpServers: [
            { name: 'context7', status: 'connected' },
            { name: 'supercharged-figma', status: 'needs_auth' },
            { name: 'figma', status: 'failed', error: 'MCP error -32000: Connection closed' },
          ],
          lspServers: [],
        },
      }})), 20);
    }
    if (message.command === 'send' || message.command === 'quickAction') {
      const sessionId = 'preview-' + Date.now();
      const threadId = message.threadId || message.cliId + '-preview-thread';
      const startedAt = Date.now();
      const turnId = sessionId + ':turn:1';
      const assistantItemId = turnId + ':assistant';
      const reasoningItemId = turnId + ':reasoning';
      emitThreadEvent(message.cliId, threadId, {
        type: 'thread/started',
        thread: {
          id: threadId,
          providerId: message.cliId,
          title: message.text || 'Preview session',
          status: 'running',
          updatedAt: startedAt,
        },
      }, 10);
      emitThreadEvent(message.cliId, threadId, {
        type: 'turn/started',
        turn: { id: turnId, status: 'running', startedAt },
      }, 10);
      emitThreadEvent(message.cliId, threadId, {
        type: 'item/started',
        item: {
          id: turnId + ':user',
          turnId,
          type: 'user-message',
          status: 'completed',
          content: message.text,
          startedAt,
          completedAt: startedAt,
        },
      }, 10);
      emitThreadEvent(message.cliId, threadId, {
        type: 'item/started',
        item: {
          id: assistantItemId,
          turnId,
          type: 'assistant-message',
          status: 'running',
          content: '',
          startedAt,
        },
      }, 10);
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: {
        command: 'requestStarted',
        cliId: message.cliId,
        threadId,
        sessionId,
        text: message.text,
        mode: message.mode,
        agentMode: message.agentMode,
        action: message.action,
        actionLabel: message.action === 'freeform' ? '自由提问' : message.action,
        contextSummary: { workspace: 'agents-gui', activeFile: 'src/extension.ts', diagnostics: 2 },
      }})), 10);
      emitThreadEvent(message.cliId, threadId, {
        type: 'item/reasoning/delta',
        turnId,
        itemId: reasoningItemId,
        delta: 'Inspecting the active thread and renderer state.',
      }, 30);
      emitThreadEvent(message.cliId, threadId, {
        type: 'item/assistantMessage/delta',
        turnId,
        itemId: assistantItemId,
        delta: '## 能力\\n- **代码修改**：支持 \`TypeScript\`。\\n',
      }, 36);
      emitThreadEvent(message.cliId, threadId, {
        type: 'item/activity/updated',
        turnId,
        itemId: turnId + ':activity:preview-command',
        item: {
          id: turnId + ':activity:preview-command',
          turnId,
          type: 'command-execution',
          status: 'completed',
          label: 'npm test',
          content: 'Focused renderer replay',
          activity: {
            id: 'preview-command',
            kind: 'command',
            name: 'npm test',
            detail: 'Focused renderer replay',
          },
          startedAt: startedAt + 1,
          completedAt: startedAt + 2,
        },
        activity: {
          id: 'preview-command',
          kind: 'command',
          name: 'npm test',
          detail: 'Focused renderer replay',
        },
      }, 42);
      emitThreadEvent(message.cliId, threadId, {
        type: 'item/assistantMessage/delta',
        turnId,
        itemId: assistantItemId,
        delta: '- **项目理解**：读取当前上下文。\\n\\n完成。',
      }, 58);
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: {
        command: 'output',
        cliId: message.cliId,
        sessionId,
        stream: 'stdout',
        text: [
          '## 能力',
          '- **代码修改**：支持 \`TypeScript\`。',
          '- **项目理解**：读取当前上下文。',
          '1. 分析结构',
          '2. 生成补丁',
          '',
          '| 项目 | 状态 |',
          '| --- | --- |',
          '| Markdown | 已渲染 |',
          '> 流式输出会显示加载状态。',
          '\\u001b[0m',
          '\`\`\`ts',
          'const ok = true;',
          '\`\`\`',
        ].join('\\n'),
      }})), 40);
      emitThreadEvent(message.cliId, threadId, {
        type: 'turn/completed',
        turnId,
        status: 'completed',
        completedAt: startedAt + 120,
      }, 120);
      emitThreadEvent(message.cliId, threadId, {
        type: 'thread/status/changed',
        status: 'completed',
      }, 120);
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: {
        command: 'sessionEnd',
        cliId: message.cliId,
        sessionId,
        exitCode: 0,
      }})), 120);
    }
  },
});
</script>`;

html = html
  .replace('<meta http-equiv="Content-Security-Policy" content="__CSP__">', '')
  .replace(/__NONCE__/g, 'preview')
  .replace(/__LOCALE__/g, 'zh-CN')
  .replace(/__CODEX_RENDERER_ENABLED__/g, 'true');

for (const [placeholder, uri] of Object.entries(assetUriByPlaceholder)) {
  html = html.replace(new RegExp(placeholder, 'g'), uri);
}
html = html.replace(
  `<script nonce="preview" src="${i18nUri}"></script>`,
  `${vscodeStub}\n  <script nonce="preview" src="${i18nUri}"></script>`
);

if (/__[A-Z0-9_]+__/.test(html)) {
  throw new Error('Preview webview still contains unresolved VS Code placeholders.');
}

fs.writeFileSync(outputPath, html);
console.log(outputPath);
