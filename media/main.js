(function () {
  const vscode = acquireVsCodeApi();
  const i18n = window.AssistantI18n;
  i18n.apply();

  // Inject critical styles via JS to bypass webview CSS caching
  (function injectCriticalStyles() {
    const style = document.createElement('style');
    style.textContent = [
      '.message-copy-button { background: var(--assistant-panel) !important; opacity: 1 !important; }',
      '.message-copy-button:hover, .message-copy-button:focus-visible { background: var(--assistant-hover) !important; }',
      '.message-copy-button.is-copied { color: var(--vscode-testing-iconPassed, #4ec9b0) !important; }',
      '.message.user .message-bubble { border: 1px solid var(--assistant-border) !important; background: var(--assistant-panel) !important; }',
    ].join('\n');
    document.head.appendChild(style);
  })();

  const ORPHAN_ANSI_PATTERN = /(?:^|(?<=\s))\[(?:\??25[hl]|[0-9;]*[ABCDEFGJKSTfimnsu]|[0-9;]*[hl])/g;
  const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
  const INTERNAL_PROMPT_START = 'You are an AI coding assistant embedded in VS Code.';
  const INTERNAL_PROMPT_END_MARKER = '- Risks and caveats: call out assumptions, follow-up work, and edge cases.';
  const MAX_IMAGE_ATTACHMENTS = 8;
  const MAX_IMAGE_ATTACHMENT_BYTES = 12 * 1024 * 1024;
  const TASK_STATUSES = ['preparing', 'running', 'completed', 'failed', 'stopped'];
  const TASK_ACTIVE_STATUSES = ['preparing', 'running'];
  const VISUAL_TASK_BOARD_ENABLED = false;
  const MESSAGE_BOTTOM_STICKY_THRESHOLD = 48;
  const FILE_CARD_COLLAPSE_LIMIT = 3;
  const FILE_CARD_ICON_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 2.8h5.2l2 2v8.4H3.6V2.8h1.6z"/><path d="M10.4 2.8v2h2M8 6.2v4.2M5.9 8.3h4.2"/></svg>';

  const saved = vscode.getState() || {};
  let profiles = [];
  let profilesLoading = true;
  let activeId = saved.activeId || '';
  let activeAgentModeByProvider = saved.activeAgentModeByProvider || {};
  let activeModelByProvider = saved.activeModelByProvider || {};
  let recentModelByProvider = saved.recentModelByProvider || {};
  let favoriteModelByProvider = saved.favoriteModelByProvider || {};
  let disabledMcpByProvider = saved.disabledMcpByProvider || {};
  let customModelByProvider = saved.customModelByProvider || {};
  let activeRuntimeByProvider = saved.activeRuntimeByProvider || {};
  let activePermissionByProvider = saved.activePermissionByProvider || {};
  let apiProviderSettings = { customProviders: [], defaultProviderId: '', agentProviderByCliId: {} };
  let homeAgentSettings = { visibleAgentIds: [], agentOrder: [] };
  let commitMessageSettings = { provider: 'default', language: 'auto', maxDiffChars: 60000 };
  let apiProviderEnvStatusById = {};
  let editingApiProviderId = '';
  let activeSettingsSection = 'agents';
  let claudeTerminalBannerDismissed = Boolean(saved.claudeTerminalBannerDismissed);
  let taskBoardDismissed = Boolean(saved.taskBoardDismissed);
  let legacyWorkflowMode = saved.workflowMode || (saved.mode === 'agent' ? 'execute' : undefined);
  let hasAppliedPersistentSelection = false;
  let threadsByProvider = normalizeSavedThreads(saved.threadsByProvider, saved.conversations);
  let tasks = normalizeSavedTasks(saved.tasks);
  let activeThreadByProvider = saved.activeThreadByProvider || {};
  let contextOptions = saved.contextOptions || {
    includeWorkspace: true,
    includeCurrentFile: true,
    includeSelection: true,
    includeDiagnostics: true,
  };
  let contextSummary = null;
  let streamTargets = {};
  let taskBySessionId = {};
  let pendingTaskByProvider = {};
  let runningByProvider = {};
  let pendingByProvider = {};
  let pendingThreadByProvider = {};
  let messageStatusTimer = undefined;
  let renderedMessageThreadKey = '';
  let promptAttachments = [];
  let openCodeDialogKind = '';
  let openCodeDialogQuery = '';
  let openCodeDialogActiveIndex = 0;

  const taskBoard = document.getElementById('taskBoard');
  const sidebar = document.getElementById('sidebar');
  const providerSelect = document.getElementById('providerSelect');
  const providerTabs = document.getElementById('providerTabs');
  const providerHint = document.getElementById('providerHint');
  const modelSelect = document.getElementById('modelSelect');
  const modelSummaryLabel = document.getElementById('modelSummaryLabel');
  const modelOptionList = document.getElementById('modelOptionList');
  const customModelField = document.getElementById('customModelField');
  const customModelInput = document.getElementById('customModelInput');
  const runtimeSelect = document.getElementById('runtimeSelect');
  const runtimeSummaryLabel = document.getElementById('runtimeSummaryLabel');
  const runtimeOptionList = document.getElementById('runtimeOptionList');
  const permissionSelect = document.getElementById('permissionSelect');
  const permissionSummaryLabel = document.getElementById('permissionSummaryLabel');
  const permissionOptionList = document.getElementById('permissionOptionList');
  const agentModeSelect = document.getElementById('agentModeSelect');
  const agentModeSummaryLabel = document.getElementById('agentModeSummaryLabel');
  const agentModeOptionList = document.getElementById('agentModeOptionList');
  const actionSelect = document.getElementById('actionSelect');
  const threadSelect = document.getElementById('threadSelect');
  const deleteThreadBtn = document.getElementById('deleteThreadBtn');
  const contextSummaryLabel = document.getElementById('contextSummaryLabel');
  const contextBudget = document.getElementById('contextBudget');
  const contextBudgetPopover = contextBudget?.querySelector('.context-budget-popover');
  const contextBudgetLabel = document.getElementById('contextBudgetLabel');
  const contextBudgetPercent = document.getElementById('contextBudgetPercent');
  const contextBudgetTokens = document.getElementById('contextBudgetTokens');
  const contextBudgetTokenizer = document.getElementById('contextBudgetTokenizer');
  const contextBudgetPolicy = document.getElementById('contextBudgetPolicy');
  const slashPalette = document.getElementById('slashPalette');
  const claudeTerminalBanner = document.getElementById('claudeTerminalBanner');
  const claudeTerminalDismiss = document.getElementById('claudeTerminalDismiss');
  const claudeContextBtn = document.getElementById('claudeContextBtn');
  const codexTerminalBanner = document.getElementById('codexTerminalBanner');
  const codexTerminalStop = document.getElementById('codexTerminalStop');
  const codexTerminalOpen = document.getElementById('codexTerminalOpen');
  const modelMenu = document.querySelector('.model-menu');
  const runtimeMenu = document.querySelector('.runtime-menu');
  const permissionMenu = document.querySelector('.permission-menu');
  const modeMenu = document.querySelector('.mode-menu');
  const contextMenu = document.querySelector('.context-menu');
  const messages = document.getElementById('messages');
  const input = document.getElementById('promptInput');
  const attachmentStrip = document.getElementById('attachmentStrip');
  const attachImageBtn = document.getElementById('attachImageBtn');
  const imageFileInput = document.getElementById('imageFileInput');
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');
  const composerSettingsBtn = document.getElementById('composerSettingsBtn');
  const newChatBtn = document.getElementById('newChatBtn');
  const reloadBtn = document.getElementById('reloadBtn');
  const apiSettingsPage = document.getElementById('apiProviderSettingsPage');
  const apiSettingsBack = document.getElementById('apiProviderSettingsClose');
  const settingsNav = document.getElementById('settingsNav');
  const settingsNavAgents = document.getElementById('settingsNavAgents');
  const settingsNavApiProviders = document.getElementById('settingsNavApiProviders');
  const settingsNavCommitMessage = document.getElementById('settingsNavCommitMessage');
  const settingsSectionAgents = document.getElementById('settingsSectionAgents');
  const settingsSectionApiProviders = document.getElementById('settingsSectionApiProviders');
  const settingsSectionCommitMessage = document.getElementById('settingsSectionCommitMessage');
  const homeAgentList = document.getElementById('homeAgentList');
  const homeAgentsReset = document.getElementById('homeAgentsReset');
  const homeAgentsSave = document.getElementById('homeAgentsSave');
  const commitMessageProviderSelect = document.getElementById('commitMessageProviderSelect');
  const commitMessageLanguageSelect = document.getElementById('commitMessageLanguageSelect');
  const commitMessageMaxDiffChars = document.getElementById('commitMessageMaxDiffChars');
  const commitMessageReset = document.getElementById('commitMessageReset');
  const commitMessageSave = document.getElementById('commitMessageSave');
  const apiProviderList = document.getElementById('apiProviderList');
  const apiProviderAdd = document.getElementById('apiProviderAdd');
  const apiProviderForm = document.getElementById('apiProviderForm');
  const apiProviderName = document.getElementById('apiProviderName');
  const apiProviderBaseUrl = document.getElementById('apiProviderBaseUrl');
  const apiProviderApiKeyEnv = document.getElementById('apiProviderApiKeyEnv');
  const apiProviderModel = document.getElementById('apiProviderModel');
  const apiProviderEnabled = document.getElementById('apiProviderEnabled');
  const apiProviderExtraEnv = document.getElementById('apiProviderExtraEnv');
  const apiProviderAddEnv = document.getElementById('apiProviderAddEnv');
  const apiProviderDefaultSelect = document.getElementById('apiProviderDefaultSelect');
  const apiProviderAgentBindings = document.getElementById('apiProviderAgentBindings');
  const apiProviderSettingsError = document.getElementById('apiProviderSettingsError');
  const apiProviderDelete = document.getElementById('apiProviderDelete');
  const apiProviderCancel = document.getElementById('apiProviderCancel');
  const SLASH_COMMANDS = [
    { name: 'new', aliases: ['clear'], kind: 'local', local: 'new', descriptionKey: 'slash.new.desc' },
    { name: 'clear', kind: 'local', local: 'new', descriptionKey: 'slash.clear.desc' },
    { name: 'help', kind: 'local', local: 'help', descriptionKey: 'slash.help.desc' },
    { name: 'context', kind: 'local', local: 'context', descriptionKey: 'slash.context.desc' },
    { name: 'refresh', kind: 'local', local: 'refresh', descriptionKey: 'slash.refresh.desc' },
    { name: 'stop', kind: 'local', local: 'stop', descriptionKey: 'slash.stop.desc' },
    { name: 'copy', kind: 'local', local: 'copy', descriptionKey: 'slash.copy.desc' },
    { name: 'sessions', aliases: ['session', 'resume', 'continue'], kind: 'local', local: 'sessions', providers: ['opencode'], descriptionKey: 'slash.sessions.desc' },
    { name: 'models', aliases: ['model'], kind: 'local', local: 'models', providers: ['opencode'], descriptionKey: 'slash.models.desc' },
    { name: 'agents', aliases: ['agent'], kind: 'local', local: 'agents', providers: ['opencode'], descriptionKey: 'slash.agents.desc' },
    { name: 'mcps', aliases: ['mcp'], kind: 'local', local: 'mcp', providers: ['opencode'], descriptionKey: 'slash.mcps.desc' },
    { name: 'variants', kind: 'local', local: 'variants', providers: ['opencode'], descriptionKey: 'slash.variants.desc' },
    { name: 'connect', kind: 'local', local: 'connect', providers: ['opencode'], descriptionKey: 'slash.connect.desc' },
    { name: 'org', aliases: ['orgs', 'switch-org'], kind: 'local', local: 'org', providers: ['opencode'], descriptionKey: 'slash.org.desc' },
    { name: 'status', kind: 'local', local: 'status', providers: ['opencode'], descriptionKey: 'slash.status.desc' },
    { name: 'themes', aliases: ['theme'], kind: 'local', local: 'themes', providers: ['opencode'], descriptionKey: 'slash.themes.desc' },
    { name: 'exit', aliases: ['quit', 'q'], kind: 'local', local: 'exit', providers: ['opencode'], descriptionKey: 'slash.exit.desc' },
    {
      name: 'review',
      action: 'reviewFile',
      prompt: i18n.t('quick.review.text'),
      descriptionKey: 'slash.review.desc',
    },
    {
      name: 'explain',
      action: 'explainSelection',
      prompt: i18n.t('quick.explain.text'),
      descriptionKey: 'slash.explain.desc',
    },
    {
      name: 'tests',
      aliases: ['test'],
      action: 'generateTests',
      prompt: i18n.t('quick.tests.text'),
      descriptionKey: 'slash.tests.desc',
    },
    {
      name: 'refactor',
      action: 'refactorSelection',
      prompt: i18n.t('quick.refactor.text'),
      descriptionKey: 'slash.refactor.desc',
    },
    {
      name: 'plan',
      action: 'freeform',
      prompt: i18n.t('slash.plan.prompt'),
      modeByProvider: { claude: 'plan', codex: 'plan', opencode: 'plan', gemini: 'plan', goose: 'plan' },
      descriptionKey: 'slash.plan.desc',
    },
    {
      name: 'init',
      action: 'freeform',
      prompt: i18n.t('slash.init.prompt'),
      descriptionKey: 'slash.init.desc',
    },
    ...[
      'add-dir',
      'agents',
      'bug',
      'compact',
      'config',
      'cost',
      'doctor',
      'login',
      'logout',
      'mcp',
      'memory',
      'model',
      'permissions',
      'pr_comments',
      'sandbox',
      'status',
      'terminal-setup',
      'usage',
      'vim',
    ].map((name) => ({ name, kind: 'native', providers: ['claude'], descriptionKey: 'slash.native.desc' })),
    ...[
      'permissions',
      'sandbox-add-read-dir',
      'agent',
      'apps',
      'plugins',
      'compact',
      'diff',
      'exit',
      'feedback',
      'logout',
      'mcp',
      'mention',
      'model',
      'fast',
      'personality',
      'ps',
      'fork',
      'side',
      'resume',
      'quit',
      'status',
      'debug-config',
      'statusline',
      'title',
      'keymap',
    ].map((name) => ({ name, kind: 'native', providers: ['codex'], descriptionKey: 'slash.native.desc' })),
    ...[
      'undo',
      'redo',
      'compact',
      'fork',
      'share',
      'unshare',
    ].map((name) => ({ name, kind: 'native', providers: ['opencode'], descriptionKey: 'slash.native.desc' })),
    ...[
      'about',
      'agents',
      'auth',
      'bug',
      'chat',
      'commands',
      'compress',
      'directory',
      'dir',
      'docs',
      'editor',
      'extensions',
      'hooks',
      'ide',
      'mcp',
      'memory',
      'model',
      'permissions',
      'policies',
      'privacy',
      'quit',
      'exit',
      'restore',
      'rewind',
      'resume',
      'settings',
      'shells',
      'bashes',
      'setup-github',
      'skills',
      'stats',
      'terminal-setup',
      'theme',
      'tools',
      'upgrade',
      'vim',
    ].map((name) => ({ name, kind: 'native', providers: ['gemini'], descriptionKey: 'slash.native.desc' })),
    ...[
      '?',
      'builtin',
      'endplan',
      'exit',
      'quit',
      'extension',
      'mode',
      'prompt',
      'prompts',
      'recipe',
      'compact',
      'r',
      't',
    ].map((name) => ({ name, kind: 'native', providers: ['goose'], descriptionKey: 'slash.native.desc' })),
    ...[
      'add',
      'architect',
      'ask',
      'chat-mode',
      'code',
      'commit',
      'copy-context',
      'diff',
      'drop',
      'edit',
      'editor',
      'editor-model',
      'exit',
      'git',
      'lint',
      'load',
      'ls',
      'map',
      'map-refresh',
      'model',
      'models',
      'multiline-mode',
      'ok',
      'paste',
      'quit',
      'read-only',
      'reasoning-effort',
      'report',
      'reset',
      'run',
      'save',
      'settings',
      'test',
      'think-tokens',
      'tokens',
      'undo',
      'voice',
      'weak-model',
      'web',
    ].map((name) => ({ name, kind: 'native', providers: ['aider'], descriptionKey: 'slash.native.desc' })),
  ];
  const OPENCODE_SLASH_COMMAND_NAMES = new Set([
    'new',
    'help',
    'sessions',
    'models',
    'agents',
    'mcps',
    'variants',
    'connect',
    'org',
    'status',
    'themes',
    'exit',
    'undo',
    'redo',
    'compact',
    'fork',
    'share',
    'unshare',
  ]);
  const OPENCODE_NATIVE_API_COMMAND_NAMES = new Set([
    'share',
    'unshare',
    'compact',
    'fork',
    'undo',
    'redo',
  ]);
  let slashMatches = [];
  let slashActiveIndex = 0;
  let forceContextMenuVisible = false;

  function normalizeMessageText(text) {
    return String(text || '')
      .replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g, '')
      .replace(ORPHAN_ANSI_PATTERN, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(CONTROL_PATTERN, '')
      .replace(/\n{4,}/g, '\n\n\n');
  }

  function filterInternalPromptEcho(text) {
    const normalized = normalizeMessageText(text);
    const firstContentIndex = normalized.search(/\S/);
    if (firstContentIndex === -1) {
      return { text: normalized, pending: false };
    }

    if (!normalized.slice(firstContentIndex).startsWith(INTERNAL_PROMPT_START)) {
      return { text: normalized, pending: false };
    }

    const promptEndIndex = normalized.indexOf(INTERNAL_PROMPT_END_MARKER, firstContentIndex);
    if (promptEndIndex === -1) {
      return { text: '', pending: true };
    }

    return {
      text: normalized.slice(promptEndIndex + INTERNAL_PROMPT_END_MARKER.length).replace(/^\s+/, ''),
      pending: false,
    };
  }

  function persist() {
    vscode.setState({
      activeId,
      activeAgentModeByProvider,
      activeModelByProvider,
      recentModelByProvider,
      favoriteModelByProvider,
      disabledMcpByProvider,
      customModelByProvider,
      activeRuntimeByProvider,
      activePermissionByProvider,
      claudeTerminalBannerDismissed,
      taskBoardDismissed,
      threadsByProvider: serializeThreadsForState(threadsByProvider),
      tasks: serializeTasksForState(tasks),
      activeThreadByProvider,
      contextOptions,
    });
  }

  function persistedSelectionMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(value).filter(([providerId, modeId]) => (
        typeof providerId === 'string' && typeof modeId === 'string'
      ))
    );
  }

  function persistUserSelection() {
    if (!activeId) {
      return;
    }

    vscode.postMessage({
      command: 'saveSelectionState',
      activeProviderId: activeId,
      activeAgentModeByProvider,
      activeModelByProvider,
    });
  }

  function serializeThreadsForState(source) {
    const serialized = {};
    Object.entries(source || {}).forEach(([cliId, threads]) => {
      serialized[cliId] = (threads || []).map((thread) => ({
        ...thread,
        messages: (thread.messages || []).map((message) => {
          if (!message || typeof message !== 'object') {
            return message;
          }
          const { startedAt, ...rest } = message;
          return { ...rest, running: false };
        }),
      }));
    });
    return serialized;
  }

  function serializeTasksForState(source) {
    return (source || []).slice(0, 20).map((task) => ({
      ...task,
      status: task.status === 'running' || task.status === 'preparing' ? 'stopped' : task.status,
      sessionId: undefined,
    }));
  }

  function activeProfile() {
    return profiles.find((profile) => profile.id === activeId);
  }

  function installedProfiles() {
    return profiles.filter((profile) => profile.installed);
  }

  function orderedInstalledProfiles() {
    const installed = installedProfiles();
    const orderIds = normalizeHomeAgentSettings(homeAgentSettings).agentOrder;
    if (orderIds.length === 0) {
      return installed;
    }

    const byId = new Map(installed.map((profile) => [profile.id, profile]));
    const ordered = orderIds
      .map((id) => byId.get(id))
      .filter(Boolean);
    const orderedIds = new Set(ordered.map((profile) => profile.id));
    return ordered.concat(installed.filter((profile) => !orderedIds.has(profile.id)));
  }

  function visibleInstalledProfiles() {
    const installed = orderedInstalledProfiles();
    const visibleIds = normalizeHomeAgentSettings(homeAgentSettings).visibleAgentIds;
    if (visibleIds.length === 0) {
      return installed;
    }

    const visibleSet = new Set(visibleIds);
    const visible = installed.filter((profile) => visibleSet.has(profile.id));
    return visible.length > 0 ? visible : installed;
  }

  function formatProviderVersion(version) {
    const value = String(version || '').trim();
    if (!value) {
      return '';
    }

    return value.replace(/^v/i, '');
  }

  function providerIconUri(profile) {
    const icon = profile?.webviewIcon;
    if (!icon) {
      return '';
    }

    const prefersDarkIcon =
      document.body.classList.contains('vscode-dark') ||
      document.body.classList.contains('vscode-high-contrast');
    return prefersDarkIcon ? icon.dark || icon.light || '' : icon.light || icon.dark || '';
  }

  function formatTokenCount(tokens) {
    const value = Math.max(0, Math.round(Number(tokens) || 0));
    if (value >= 1000000) {
      return `${Math.round(value / 100000) / 10}m`;
    }
    if (value >= 1000) {
      return `${Math.round(value / 1000)}k`;
    }

    return String(value);
  }

  function formatBytes(bytes) {
    const value = Math.max(0, Math.round(Number(bytes) || 0));
    if (value >= 1024 * 1024) {
      const mb = value / (1024 * 1024);
      return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
    }
    if (value >= 1024) {
      return `${Math.round(value / 1024)} KB`;
    }
    return `${value} B`;
  }

  function attachmentPayload(attachment) {
    return {
      kind: 'image',
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      dataUrl: attachment.dataUrl,
    };
  }

  function clipboardImageFiles(dataTransfer) {
    const files = [];
    Array.from(dataTransfer?.items || []).forEach((item) => {
      if (item.kind !== 'file' || !item.type?.startsWith('image/')) {
        return;
      }
      const file = item.getAsFile();
      if (file) {
        files.push(file);
      }
    });

    if (files.length === 0) {
      Array.from(dataTransfer?.files || []).forEach((file) => {
        if (file?.type?.startsWith('image/')) {
          files.push(file);
        }
      });
    }

    return files;
  }

  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Failed to read image'));
      reader.readAsDataURL(file);
    });
  }

  async function addImageFiles(files) {
    const imageFiles = Array.from(files || []).filter((file) => file?.type?.startsWith('image/'));
    for (const file of imageFiles) {
      if (promptAttachments.length >= MAX_IMAGE_ATTACHMENTS) {
        addMessage(activeId, 'error', i18n.t('attachment.tooMany', { count: String(MAX_IMAGE_ATTACHMENTS) }));
        break;
      }
      if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
        addMessage(
          activeId,
          'error',
          i18n.t('attachment.tooLarge', {
            name: file.name || i18n.t('attachment.imageLabel'),
            size: formatBytes(MAX_IMAGE_ATTACHMENT_BYTES),
          })
        );
        continue;
      }

      try {
        const dataUrl = await readImageFile(file);
        promptAttachments.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: 'image',
          name: file.name || i18n.t('attachment.imageLabel'),
          mimeType: file.type || 'image/png',
          size: file.size,
          dataUrl,
        });
      } catch {
        addMessage(activeId, 'error', i18n.t('attachment.readFailed'));
      }
    }

    renderAttachmentStrip();
    renderComposer();
  }

  function renderAttachmentStrip() {
    if (!attachmentStrip) {
      return;
    }

    attachmentStrip.innerHTML = '';
    attachmentStrip.hidden = promptAttachments.length === 0;
    promptAttachments.forEach((attachment) => {
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';

      const preview = document.createElement('img');
      preview.src = attachment.dataUrl;
      preview.alt = '';
      chip.appendChild(preview);

      const label = document.createElement('span');
      label.textContent = attachment.name;
      label.title = `${attachment.name} · ${formatBytes(attachment.size)}`;
      chip.appendChild(label);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.attachmentId = attachment.id;
      remove.setAttribute('aria-label', i18n.t('attachment.remove'));
      remove.title = i18n.t('attachment.remove');
      remove.textContent = 'x';
      chip.appendChild(remove);

      attachmentStrip.appendChild(chip);
    });
  }

  function normalizeMessageAttachments(attachments) {
    return (Array.isArray(attachments) ? attachments : [])
      .filter((attachment) => attachment?.kind === 'image')
      .map((attachment) => ({
        kind: 'image',
        name: attachment.name || i18n.t('attachment.imageLabel'),
        mimeType: attachment.mimeType || 'image/png',
        size: Number(attachment.size) || 0,
        path: attachment.path || '',
      }));
  }

  function normalizeSavedThreads(savedThreads, legacyConversations) {
    const normalized = {};

    Object.entries(savedThreads || {}).forEach(([cliId, threads]) => {
      if (!Array.isArray(threads)) {
        return;
      }

      normalized[cliId] = threads
        .filter((thread) => thread && Array.isArray(thread.messages))
        .map((thread) => ({
          id: thread.id || makeThreadId(cliId),
          title: thread.title || deriveThreadTitle(thread.messages) || i18n.t('history.untitled'),
          createdAt: Number(thread.createdAt) || Date.now(),
          updatedAt: Number(thread.updatedAt) || Date.now(),
          openCodeSessionId: typeof thread.openCodeSessionId === 'string' ? thread.openCodeSessionId : undefined,
          messages: normalizeThreadMessages(thread.messages),
        }));
    });

    Object.entries(legacyConversations || {}).forEach(([cliId, messages]) => {
      if (!Array.isArray(messages) || normalized[cliId]?.length) {
        return;
      }

      normalized[cliId] = [createThread(cliId, normalizeThreadMessages(messages))];
    });

    return normalized;
  }

  function normalizeSavedTasks(savedTasks) {
    return (Array.isArray(savedTasks) ? savedTasks : [])
      .filter((task) => task && typeof task === 'object' && task.providerId)
      .slice(0, 20)
      .map((task) => ({
        id: task.id || makeTaskId(task.providerId),
        providerId: task.providerId,
        providerName: task.providerName || task.providerId,
        title: task.title || i18n.t('task.untitled'),
        action: task.action || 'freeform',
        agentMode: task.agentMode || '',
        status: task.status === 'running' || task.status === 'preparing' ? 'stopped' : (task.status || 'completed'),
        threadId: task.threadId || '',
        createdAt: Number(task.createdAt) || Date.now(),
        updatedAt: Number(task.updatedAt) || Date.now(),
      }));
  }

  function makeThreadId(cliId) {
    return `${cliId || 'thread'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function makeTaskId(providerId) {
    return `${providerId || 'task'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function createThread(cliId, messages) {
    const now = Date.now();
    const initialMessages = Array.isArray(messages) ? messages : [];
    return {
      id: makeThreadId(cliId),
      title: deriveThreadTitle(initialMessages) || i18n.t('history.newThread'),
      createdAt: now,
      updatedAt: now,
      openCodeSessionId: undefined,
      messages: initialMessages,
    };
  }

  function normalizeThreadMessages(threadMessages) {
    return (threadMessages || []).map((message) => {
      if (!message || typeof message !== 'object') {
        return message;
      }

      if (message.role !== 'assistant' && message.role !== 'error') {
        return message;
      }

      return {
        ...message,
        running: false,
        text: filterInternalPromptEcho(message.text).text,
        thinking: normalizeMessageText(message.thinking),
      };
    });
  }

  function deriveThreadTitle(messagesOrText) {
    const source = Array.isArray(messagesOrText)
      ? messagesOrText.find((message) => message.role === 'user')?.text
      : messagesOrText;
    const title = normalizeMessageText(source || '')
      .split('\n')
      .find((line) => line.trim()) || '';

    return title.trim().replace(/\s+/g, ' ').slice(0, 42);
  }

  function ensureThreadList(cliId) {
    if (!cliId) {
      return [];
    }
    if (!threadsByProvider[cliId]) {
      threadsByProvider[cliId] = [];
    }
    return threadsByProvider[cliId];
  }

  function findThread(cliId, threadId) {
    return ensureThreadList(cliId).find((thread) => thread.id === threadId);
  }

  function ensureActiveThread(cliId) {
    if (!cliId) {
      return null;
    }

    const threads = ensureThreadList(cliId);
    let thread = findThread(cliId, activeThreadByProvider[cliId]);

    if (!thread) {
      thread = threads[0];
    }

    if (!thread) {
      thread = createThread(cliId);
      threads.unshift(thread);
    }

    activeThreadByProvider[cliId] = thread.id;
    return thread;
  }

  function setActiveThread(cliId, thread) {
    if (!cliId || !thread) {
      return null;
    }

    const threads = ensureThreadList(cliId);
    if (!threads.includes(thread)) {
      threads.unshift(thread);
    }
    activeThreadByProvider[cliId] = thread.id;
    return thread;
  }

  function startNewThread(cliId = activeId) {
    const current = ensureActiveThread(cliId);
    if (!current || current.messages.length > 0) {
      setActiveThread(cliId, createThread(cliId));
    } else {
      setActiveThread(cliId, current);
    }
    persist();
    renderAll();
  }

  function ensureThread(cliId, threadId) {
    if (!cliId) {
      return null;
    }

    if (threadId) {
      const thread = findThread(cliId, threadId);
      if (thread) {
        return thread;
      }
    }

    return ensureActiveThread(cliId);
  }

  function activeThreadId(cliId = activeId) {
    return ensureActiveThread(cliId)?.id || '';
  }

  function activeOpenCodeSessionId() {
    return ensureActiveThread('opencode')?.openCodeSessionId || '';
  }

  function noteOpenCodeSessionId(cliId, threadId, openCodeSessionId) {
    if (cliId !== 'opencode' || !openCodeSessionId || !String(openCodeSessionId).startsWith('ses')) {
      return;
    }

    const thread = ensureThread(cliId, threadId);
    if (!thread || thread.openCodeSessionId === openCodeSessionId) {
      return;
    }

    thread.openCodeSessionId = openCodeSessionId;
    persist();
    renderOpenCodeSidebar();
  }

  function ensureConversation(cliId, threadId) {
    const thread = ensureThread(cliId, threadId);
    return thread?.messages || [];
  }

  function conversationHistoryForSend(cliId) {
    return ensureConversation(cliId, activeThreadId(cliId))
      .filter((message) => (
        message &&
        !message.running &&
        (message.role === 'user' || message.role === 'assistant') &&
        normalizeMessageText(message.text).trim()
      ))
      .slice(-8)
      .map((message) => ({
        role: message.role,
        text: normalizeMessageText(message.text).replace(/\s+/g, ' ').trim().slice(0, 1200),
      }));
  }

  function touchThread(thread, titleText) {
    if (!thread) {
      return;
    }

    thread.updatedAt = Date.now();
    const title = deriveThreadTitle(titleText);
    if (title && (!thread.title || thread.title === i18n.t('history.newThread'))) {
      thread.title = title;
    }
  }

  function createRunTask(providerId, action, text, agentMode) {
    const profile = profiles.find((item) => item.id === providerId);
    const now = Date.now();
    const task = {
      id: makeTaskId(providerId),
      providerId,
      providerName: profile?.name || providerId,
      title: deriveThreadTitle(text) || i18n.t('task.untitled'),
      action: action || 'freeform',
      agentMode: agentMode || '',
      status: 'preparing',
      threadId: activeThreadId(providerId),
      createdAt: now,
      updatedAt: now,
    };

    tasks = [task, ...tasks.filter((item) => item.id !== task.id)].slice(0, 20);
    persist();
    renderTaskBoard();
    return task;
  }

  function updateTaskStatus(taskId, updates = {}) {
    if (!taskId) {
      return undefined;
    }

    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      return undefined;
    }

    Object.assign(task, updates, { updatedAt: Date.now() });
    persist();
    renderTaskBoard();
    return task;
  }

  function setAccent(profile) {
    document.documentElement.style.setProperty(
      '--assistant-accent',
      profile?.accent || 'var(--vscode-focusBorder)'
    );
  }

  function agentModesFor(profile) {
    const modes = Array.isArray(profile?.agentModes) && profile.agentModes.length > 0
      ? profile.agentModes
      : [
          {
            id: 'agent',
            label: 'Agent',
            description: '',
            instruction: 'Use this provider as a coding agent.',
          },
        ];
    const selectableModes = modes.filter((mode) => !mode.disabled);
    return selectableModes.length > 0 ? selectableModes : modes;
  }

  function normalizeAgentModeId(profile, value) {
    const modes = agentModesFor(profile);
    const selectableModes = modes.filter((item) => !item.disabled);
    const mode = selectableModes.find((item) => item.id === value)
      || selectableModes.find((item) => item.id === profile?.defaultAgentMode)
      || selectableModes[0]
      || modes[0];

    return mode.id;
  }

  function activeAgentModeId(cliId = activeId) {
    const profile = profiles.find((item) => item.id === cliId);
    const legacy = legacyWorkflowMode ? mapLegacyWorkflowMode(profile, legacyWorkflowMode) : undefined;
    const value = activeAgentModeByProvider[cliId] || legacy;
    const normalized = normalizeAgentModeId(profile, value);
    activeAgentModeByProvider[cliId] = normalized;
    return normalized;
  }

  function activeAgentMode(profile = activeProfile()) {
    const modes = agentModesFor(profile);
    if (!profile) {
      return modes[0];
    }

    return modes.find((mode) => mode.id === activeAgentModeId(profile.id)) || modes[0];
  }

  function optionListFor(profile, key, fallbackLabelKey) {
    const options = Array.isArray(profile?.[key]) ? profile[key] : [];
    return options.length > 0
      ? options
      : [{ id: 'default', label: i18n.t(fallbackLabelKey), description: '' }];
  }

  function selectableOption(option) {
    return !option?.disabled && !option?.actionOnly;
  }

  function normalizeOptionId(profile, value, key, defaultKey, fallbackLabelKey) {
    const options = optionListFor(profile, key, fallbackLabelKey);
    const selectableOptions = options.filter(selectableOption);
    const pool = selectableOptions.length > 0 ? selectableOptions : options;
    const option = pool.find((item) => item.id === value)
      || pool.find((item) => item.id === profile?.[defaultKey])
      || pool[0];

    return option.id;
  }

  function modelOptionsFor(profile) {
    return optionListFor(profile, 'modelOptions', 'model.short');
  }

  function runtimeModesFor(profile) {
    return optionListFor(profile, 'runtimeModes', 'runtime.short');
  }

  function permissionModesFor(profile) {
    return optionListFor(profile, 'permissionModes', 'permission.short');
  }

  function localizedCliOption(option, group) {
    if (!option) {
      return option;
    }

    const labelKey = `option.${group}.${option.id}`;
    const descriptionKey = `${labelKey}.description`;
    const translatedLabel = i18n.t(labelKey);
    const translatedDescription = i18n.t(descriptionKey);

    return {
      ...option,
      label: translatedLabel === labelKey ? option.label : translatedLabel,
      summaryLabel: i18n.t(`${labelKey}.summary`) === `${labelKey}.summary`
        ? option.summaryLabel
        : i18n.t(`${labelKey}.summary`),
      description: translatedDescription === descriptionKey ? option.description : translatedDescription,
    };
  }

  function splitAgentModeLabel(label) {
    const value = String(label || '').replace(/\u200b/g, '').trim();
    const parts = value.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
    if (parts.length <= 1) {
      return { title: value, detail: '' };
    }

    return { title: parts[0], detail: parts.slice(1).join(' - ') };
  }

  function localizedPermissionOption(option) {
    const displayOption = localizedCliOption(option, 'permission');
    if (activeProfile()?.id === 'claude' && option?.id === 'default') {
      return {
        ...displayOption,
        label: i18n.t('claude.permission.askBeforeEdits'),
        summaryLabel: i18n.t('claude.permission.askBeforeEdits'),
      };
    }

    return displayOption;
  }

  function activeModelId(cliId = activeId) {
    const profile = profiles.find((item) => item.id === cliId);
    const normalized = normalizeOptionId(
      profile,
      activeModelByProvider[cliId],
      'modelOptions',
      'defaultModel',
      'model.short'
    );
    activeModelByProvider[cliId] = normalized;
    return normalized;
  }

  function activeCustomModel(cliId = activeId) {
    return String(customModelByProvider[cliId] || '').trim();
  }

  function activeRuntimeId(cliId = activeId) {
    const profile = profiles.find((item) => item.id === cliId);
    const normalized = normalizeOptionId(
      profile,
      activeRuntimeByProvider[cliId],
      'runtimeModes',
      'defaultRuntime',
      'runtime.short'
    );
    activeRuntimeByProvider[cliId] = normalized;
    return normalized;
  }

  function activePermissionId(cliId = activeId) {
    const profile = profiles.find((item) => item.id === cliId);
    const normalized = normalizeOptionId(
      profile,
      activePermissionByProvider[cliId],
      'permissionModes',
      'defaultPermissionMode',
      'permission.short'
    );
    activePermissionByProvider[cliId] = normalized;
    return normalized;
  }

  function activeModel(profile = activeProfile()) {
    const options = modelOptionsFor(profile);
    if (!profile) {
      return options[0];
    }
    return options.find((option) => option.id === activeModelId(profile?.id)) || options[0];
  }

  function activeRuntime(profile = activeProfile()) {
    const options = runtimeModesFor(profile);
    if (!profile) {
      return options[0];
    }
    return options.find((option) => option.id === activeRuntimeId(profile?.id)) || options[0];
  }

  function activePermission(profile = activeProfile()) {
    const options = permissionModesFor(profile);
    if (!profile) {
      return options[0];
    }
    return options.find((option) => option.id === activePermissionId(profile?.id)) || options[0];
  }

  function mapLegacyWorkflowMode(profile, value) {
    const modes = agentModesFor(profile);
    const desired = {
      auto: profile?.defaultAgentMode,
      plan: 'plan',
      execute: profile?.defaultAgentMode,
    }[value];

    return modes.some((mode) => mode.id === desired) ? desired : undefined;
  }

  function renderProviderSelect() {
    providerSelect.innerHTML = '';

    if (profilesLoading) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = i18n.t('provider.loading');
      providerSelect.appendChild(option);
      providerSelect.value = '';
      providerSelect.disabled = true;
      return;
    }

    const availableProfiles = visibleInstalledProfiles();

    if (availableProfiles.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = i18n.t('provider.noInstalled');
      providerSelect.appendChild(option);
      activeId = '';
      providerSelect.value = '';
      providerSelect.disabled = true;
      return;
    }

    if (!availableProfiles.some((profile) => profile.id === activeId)) {
      activeId = availableProfiles[0].id;
    }

    ensureActiveThread(activeId);
    activeAgentModeId(activeId);
    activeModelId(activeId);
    activeRuntimeId(activeId);
    activePermissionId(activeId);

    for (const profile of availableProfiles) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name;
      providerSelect.appendChild(option);
    }

    providerSelect.value = activeId;
    providerSelect.disabled = Boolean(runningByProvider[activeId] || pendingByProvider[activeId]);
  }

  function renderProviderTabs() {
    if (!providerTabs) {
      return;
    }

    const availableProfiles = visibleInstalledProfiles();
    providerTabs.hidden = profilesLoading || availableProfiles.length === 0;

    if (profilesLoading || availableProfiles.length === 0) {
      providerTabs.innerHTML = '';
      return;
    }

    const existingButtons = new Map();
    for (const child of Array.from(providerTabs.children)) {
      if (child instanceof HTMLButtonElement && child.dataset.providerId) {
        existingButtons.set(child.dataset.providerId, child);
      }
    }

    const activeIsBusy = Boolean(runningByProvider[activeId] || pendingByProvider[activeId]);

    for (const profile of availableProfiles) {
      const isActive = profile.id === activeId;
      const button = existingButtons.get(profile.id) || document.createElement('button');

      button.type = 'button';
      button.dataset.providerId = profile.id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(isActive));
      button.title = profile.name || '';
      button.disabled = activeIsBusy && !isActive;
      button.className = 'provider-tab-button';
      if (isActive) {
        button.classList.add('is-active');
      }

      const iconUri = providerIconUri(profile);
      button.replaceChildren();
      if (iconUri) {
        const logo = document.createElement('img');
        logo.className = 'provider-tab-logo';
        logo.src = iconUri;
        logo.alt = '';
        logo.draggable = false;
        button.appendChild(logo);
      } else {
        const fallback = document.createElement('span');
        fallback.className = 'provider-tab-logo';
        fallback.textContent = profile.icon || profile.name.slice(0, 1);
        button.appendChild(fallback);
      }


      providerTabs.appendChild(button);
      existingButtons.delete(profile.id);
    }

    existingButtons.forEach((button) => button.remove());
  }

  function normalizeHomeAgentSettings(value) {
    const record = value && typeof value === 'object' ? value : {};
    const visibleAgentIds = normalizeHomeAgentIds(record.visibleAgentIds);
    const agentOrder = normalizeHomeAgentIds(record.agentOrder);
    return { visibleAgentIds, agentOrder };
  }

  function normalizeHomeAgentIds(value) {
    const rawIds = Array.isArray(value) ? value : [];
    const seen = new Set();
    return rawIds
      .map((id) => String(id || '').trim())
      .filter((id) => {
        if (!id || seen.has(id)) {
          return false;
        }
        seen.add(id);
        return true;
      });
  }

  function normalizeCommitMessageSettings(value) {
    const record = value && typeof value === 'object' ? value : {};
    const knownProviderIds = new Set([
      'default',
      'claude',
      'gemini',
      'codex',
      'opencode',
      'goose',
      'aider',
      ...profiles.map((profile) => profile.id),
    ]);
    const provider = knownProviderIds.has(record.provider) ? record.provider : 'default';
    const language = ['auto', 'zh-CN', 'en'].includes(record.language) ? record.language : 'auto';
    const maxDiffChars = Number(record.maxDiffChars);
    return {
      provider,
      language,
      maxDiffChars: Number.isFinite(maxDiffChars) ? Math.max(1000, Math.round(maxDiffChars)) : 60000,
    };
  }

  function openSettingsPage(section = 'agents') {
    if (!apiSettingsPage) {
      return;
    }
    activeSettingsSection = ['agents', 'apiProviders', 'commitMessage'].includes(section) ? section : 'agents';
    if (!editingApiProviderId) {
      editingApiProviderId = apiProviderSettings.customProviders[0]?.id || '';
    }
    renderSettingsPage();
    apiSettingsPage.hidden = false;
    document.body.classList.add('is-api-settings-open');
    const focusTarget = activeSettingsSection === 'apiProviders'
      ? apiProviderName
      : activeSettingsSection === 'commitMessage'
        ? commitMessageProviderSelect
        : homeAgentList?.querySelector('input');
    focusTarget?.focus();
  }

  function renderSettingsPage() {
    renderSettingsSection();
    switch (activeSettingsSection) {
      case 'apiProviders':
        renderApiProviderSettings();
        break;
      case 'commitMessage':
        renderCommitMessageSettings();
        break;
      default:
        renderHomeAgentSettings();
        break;
    }
  }

  function renderSettingsSection() {
    const isAgents = activeSettingsSection === 'agents';
    const isApiProviders = activeSettingsSection === 'apiProviders';
    const isCommitMessage = activeSettingsSection === 'commitMessage';
    settingsNavAgents?.classList.toggle('is-active', isAgents);
    settingsNavApiProviders?.classList.toggle('is-active', isApiProviders);
    settingsNavCommitMessage?.classList.toggle('is-active', isCommitMessage);
    settingsNavAgents?.setAttribute('aria-current', isAgents ? 'page' : 'false');
    settingsNavApiProviders?.setAttribute('aria-current', isApiProviders ? 'page' : 'false');
    settingsNavCommitMessage?.setAttribute('aria-current', isCommitMessage ? 'page' : 'false');
    if (settingsSectionAgents) {
      settingsSectionAgents.hidden = !isAgents;
    }
    if (settingsSectionApiProviders) {
      settingsSectionApiProviders.hidden = !isApiProviders;
    }
    if (settingsSectionCommitMessage) {
      settingsSectionCommitMessage.hidden = !isCommitMessage;
    }
  }

  function renderHomeAgentSettings() {
    if (!homeAgentList) {
      return;
    }
    homeAgentList.innerHTML = '';
    const availableProfiles = installedProfiles();
    if (availableProfiles.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'api-provider-status';
      empty.textContent = i18n.t('provider.noInstalled');
      homeAgentList.appendChild(empty);
      return;
    }

    const selectedIds = homeAgentSelectionForUi();
    const orderedProfiles = orderedInstalledProfiles();
    orderedProfiles.forEach((profile, index) => {
      const row = document.createElement('div');
      row.className = 'home-agent-item';
      row.dataset.homeAgentId = profile.id;

      const checkbox = document.createElement('input');
      checkbox.id = `homeAgent-${profile.id}`;
      checkbox.type = 'checkbox';
      checkbox.dataset.homeAgentId = profile.id;
      checkbox.checked = selectedIds.has(profile.id);
      row.appendChild(checkbox);

      const icon = document.createElement('span');
      icon.className = 'home-agent-icon';
      const iconUri = providerIconUri(profile);
      if (iconUri) {
        const logo = document.createElement('img');
        logo.src = iconUri;
        logo.alt = '';
        logo.draggable = false;
        icon.appendChild(logo);
      } else {
        icon.textContent = profile.icon || profile.name.slice(0, 1);
      }
      row.appendChild(icon);

      const copy = document.createElement('label');
      copy.className = 'home-agent-copy';
      copy.htmlFor = checkbox.id;
      const name = document.createElement('span');
      name.className = 'home-agent-name';
      name.textContent = profile.name;
      copy.appendChild(name);

      const meta = document.createElement('span');
      meta.className = 'home-agent-meta';
      const version = formatProviderVersion(profile.version);
      meta.textContent = version
        ? i18n.t('homeAgents.installedVersion', { version })
        : i18n.t('provider.readyShort');
      copy.appendChild(meta);
      row.appendChild(copy);

      const sort = document.createElement('span');
      sort.className = 'home-agent-sort';
      sort.appendChild(createHomeAgentMoveButton(profile, 'up', index === 0));
      sort.appendChild(createHomeAgentMoveButton(profile, 'down', index === orderedProfiles.length - 1));
      row.appendChild(sort);

      homeAgentList.appendChild(row);
    });
  }

  function createHomeAgentMoveButton(profile, direction, disabled) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'home-agent-sort-button';
    button.dataset.homeAgentId = profile.id;
    button.dataset.homeAgentMove = direction;
    button.disabled = disabled;
    const labelKey = direction === 'up' ? 'homeAgents.moveUp' : 'homeAgents.moveDown';
    const label = i18n.t(labelKey, { name: profile.name });
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = direction === 'up'
      ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 9.5 8 6l3.5 3.5"/></svg>'
      : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 6.5 3.5 3.5 3.5-3.5"/></svg>';
    return button;
  }

  function homeAgentSelectionForUi() {
    const installedIds = orderedInstalledProfiles().map((profile) => profile.id);
    const configured = normalizeHomeAgentSettings(homeAgentSettings).visibleAgentIds;
    const selectedIds = configured.length > 0
      ? configured.filter((id) => installedIds.includes(id))
      : installedIds;
    return new Set(selectedIds.length > 0 ? selectedIds : installedIds);
  }

  function collectHomeAgentSettings() {
    const checkedIds = Array.from(homeAgentList?.querySelectorAll('input[data-home-agent-id]:checked') || [])
      .map((input) => input.dataset.homeAgentId)
      .filter(Boolean);
    const agentOrder = Array.from(homeAgentList?.querySelectorAll('.home-agent-item[data-home-agent-id]') || [])
      .map((item) => item.dataset.homeAgentId)
      .filter(Boolean);
    const installedIds = orderedInstalledProfiles().map((profile) => profile.id);
    const allSelected = installedIds.length > 0 && checkedIds.length === installedIds.length;
    return normalizeHomeAgentSettings({ visibleAgentIds: allSelected ? [] : checkedIds, agentOrder });
  }

  function moveHomeAgent(agentId, direction) {
    const settings = collectHomeAgentSettings();
    const order = settings.agentOrder.length > 0
      ? settings.agentOrder.slice()
      : orderedInstalledProfiles().map((profile) => profile.id);
    const fromIndex = order.indexOf(agentId);
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= order.length) {
      return;
    }

    [order[fromIndex], order[toIndex]] = [order[toIndex], order[fromIndex]];
    homeAgentSettings = normalizeHomeAgentSettings({ ...settings, agentOrder: order });
    renderAll();
    renderHomeAgentSettings();
    homeAgentList
      ?.querySelector(`button[data-home-agent-id="${agentId}"][data-home-agent-move="${direction}"]`)
      ?.focus();
  }

  function saveHomeAgentSettings() {
    homeAgentSettings = collectHomeAgentSettings();
    vscode.postMessage({ command: 'saveHomeAgentSettings', settings: homeAgentSettings });
    renderAll();
    renderHomeAgentSettings();
  }

  function renderCommitMessageSettings() {
    if (!commitMessageProviderSelect || !commitMessageLanguageSelect || !commitMessageMaxDiffChars) {
      return;
    }

    commitMessageProviderSelect.innerHTML = '';
    appendApiProviderOption(commitMessageProviderSelect, 'default', i18n.t('commitSettings.providerDefault'));
    profiles.forEach((profile) => {
      appendApiProviderOption(commitMessageProviderSelect, profile.id, profile.name);
    });

    const normalized = normalizeCommitMessageSettings(commitMessageSettings);
    commitMessageSettings = normalized;
    commitMessageProviderSelect.value = normalized.provider;
    commitMessageLanguageSelect.value = normalized.language;
    commitMessageMaxDiffChars.value = String(normalized.maxDiffChars);
  }

  function collectCommitMessageSettings() {
    return normalizeCommitMessageSettings({
      provider: commitMessageProviderSelect?.value || 'default',
      language: commitMessageLanguageSelect?.value || 'auto',
      maxDiffChars: commitMessageMaxDiffChars?.value || 60000,
    });
  }

  function saveCommitMessageSettings() {
    commitMessageSettings = collectCommitMessageSettings();
    vscode.postMessage({ command: 'saveCommitMessageSettings', settings: commitMessageSettings });
    renderCommitMessageSettings();
  }

  function resetCommitMessageSettings() {
    commitMessageSettings = { provider: 'default', language: 'auto', maxDiffChars: 60000 };
    renderCommitMessageSettings();
    vscode.postMessage({ command: 'saveCommitMessageSettings', settings: commitMessageSettings });
  }

  function normalizeApiProviderSettings(value) {
    const record = value && typeof value === 'object' ? value : {};
    const providers = Array.isArray(record.customProviders)
      ? record.customProviders
          .filter((provider) => provider && typeof provider === 'object')
          .map((provider, index) => ({
            id: sanitizeApiProviderId(provider.id || provider.name || `provider-${index + 1}`),
            name: String(provider.name || `Custom Provider ${index + 1}`).trim(),
            baseUrl: String(provider.baseUrl || '').trim(),
            apiKeyEnv: sanitizeEnvName(provider.apiKeyEnv || ''),
            model: String(provider.model || '').trim(),
            extraEnv: normalizeExtraEnv(provider.extraEnv),
            enabled: provider.enabled !== false,
          }))
      : [];
    const enabledIds = new Set(providers.filter((provider) => provider.enabled).map((provider) => provider.id));
    const defaultProviderId = enabledIds.has(record.defaultProviderId) ? record.defaultProviderId : '';
    const agentProviderByCliId = {};
    const bindings = record.agentProviderByCliId && typeof record.agentProviderByCliId === 'object'
      ? record.agentProviderByCliId
      : {};
    Object.entries(bindings).forEach(([cliId, providerId]) => {
      if (providerId === 'inherit' || enabledIds.has(providerId)) {
        agentProviderByCliId[cliId] = providerId;
      }
    });
    return { customProviders: providers, defaultProviderId, agentProviderByCliId };
  }

  function normalizeExtraEnv(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return Object.entries(value).reduce((result, [key, rawValue]) => {
      const envName = sanitizeEnvName(key);
      if (envName && typeof rawValue === 'string') {
        result[envName] = rawValue;
      }
      return result;
    }, {});
  }

  function sanitizeApiProviderId(value) {
    const id = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return id || `provider-${Date.now()}`;
  }

  function sanitizeEnvName(value) {
    return String(value || '').replace(/[^A-Za-z0-9_]/g, '');
  }

  function openApiProviderSettings() {
    openSettingsPage('agents');
  }

  function closeApiProviderSettings() {
    if (apiSettingsPage) {
      apiSettingsPage.hidden = true;
    }
    document.body.classList.remove('is-api-settings-open');
    clearApiSettingsError();
  }

  function createApiProviderDraft(id) {
    return {
      id: id || `custom-${Date.now()}`,
      name: '',
      baseUrl: '',
      apiKeyEnv: '',
      model: '',
      extraEnv: {},
      enabled: true,
    };
  }

  function currentApiProvider() {
    return apiProviderSettings.customProviders.find((provider) => provider.id === editingApiProviderId)
      || apiProviderSettings.customProviders[0]
      || undefined;
  }

  function renderApiProviderSettings() {
    renderApiProviderList();
    renderApiProviderForm();
    renderApiProviderBindings();
  }

  function renderApiProviderList() {
    if (!apiProviderList) {
      return;
    }
    apiProviderList.innerHTML = '';
    if (apiProviderSettings.customProviders.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'api-provider-status';
      empty.textContent = i18n.t('apiSettings.noProviders');
      apiProviderList.appendChild(empty);
      return;
    }

    apiProviderSettings.customProviders.forEach((provider) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `api-provider-list-item${provider.id === editingApiProviderId ? ' is-active' : ''}${provider.enabled ? '' : ' is-disabled'}`;
      button.dataset.providerId = provider.id;

      const name = document.createElement('span');
      name.textContent = provider.name || provider.id;
      button.appendChild(name);

      const status = document.createElement('span');
      status.className = 'api-provider-status';
      status.textContent = provider.enabled ? '' : i18n.t('apiSettings.disabled');
      const envStatus = apiProviderEnvStatusById[provider.id];
      if (provider.enabled && envStatus?.apiKeyEnv && envStatus.apiKeyEnvAvailable === false) {
        status.textContent = i18n.t('apiSettings.missingKeyEnv', { envName: envStatus.apiKeyEnv });
      }
      button.appendChild(status);

      apiProviderList.appendChild(button);
    });
  }

  function renderApiProviderForm() {
    const provider = currentApiProvider();
    const disabled = !provider;
    [apiProviderName, apiProviderBaseUrl, apiProviderApiKeyEnv, apiProviderModel].forEach((field) => {
      if (field) {
        field.disabled = disabled;
      }
    });
    if (apiProviderEnabled) {
      apiProviderEnabled.disabled = disabled;
    }
    if (apiProviderDelete) {
      apiProviderDelete.disabled = disabled;
    }

    if (!provider) {
      if (apiProviderName) apiProviderName.value = '';
      if (apiProviderBaseUrl) apiProviderBaseUrl.value = '';
      if (apiProviderApiKeyEnv) apiProviderApiKeyEnv.value = '';
      if (apiProviderModel) apiProviderModel.value = '';
      if (apiProviderEnabled) apiProviderEnabled.checked = true;
      renderExtraEnvRows({});
      return;
    }

    editingApiProviderId = provider.id;
    if (apiProviderName) apiProviderName.value = provider.name;
    if (apiProviderBaseUrl) apiProviderBaseUrl.value = provider.baseUrl;
    if (apiProviderApiKeyEnv) apiProviderApiKeyEnv.value = provider.apiKeyEnv;
    if (apiProviderModel) apiProviderModel.value = provider.model;
    if (apiProviderEnabled) apiProviderEnabled.checked = provider.enabled;
    renderExtraEnvRows(provider.extraEnv);
  }

  function renderExtraEnvRows(extraEnv) {
    if (!apiProviderExtraEnv) {
      return;
    }
    apiProviderExtraEnv.innerHTML = '';
    const entries = Object.entries(extraEnv);
    if (entries.length === 0) {
      entries.push(['', '']);
    }
    entries.forEach(([key, value]) => {
      apiProviderExtraEnv.appendChild(createExtraEnvRow(key, value));
    });
  }

  function createExtraEnvRow(key, value) {
    const row = document.createElement('div');
    row.className = 'api-extra-env-row';

    const keyInput = document.createElement('input');
    keyInput.dataset.envKey = 'true';
    keyInput.placeholder = 'ENV_NAME';
    keyInput.value = key;
    row.appendChild(keyInput);

    const valueInput = document.createElement('input');
    valueInput.dataset.envValue = 'true';
    valueInput.placeholder = 'value';
    valueInput.value = value;
    row.appendChild(valueInput);

    const remove = document.createElement('button');
    remove.className = 'api-env-remove';
    remove.type = 'button';
    remove.dataset.removeEnv = 'true';
    remove.textContent = '×';
    row.appendChild(remove);
    return row;
  }

  function renderApiProviderBindings() {
    renderApiProviderDefaultSelect();
    if (!apiProviderAgentBindings) {
      return;
    }
    apiProviderAgentBindings.innerHTML = '';
    profiles.forEach((profile) => {
      const row = document.createElement('label');
      row.className = 'api-agent-binding';

      const label = document.createElement('span');
      label.className = 'api-agent-binding-label';
      label.textContent = profile.name;
      row.appendChild(label);

      const select = document.createElement('select');
      select.dataset.cliId = profile.id;
      appendApiProviderOption(select, 'inherit', i18n.t('apiSettings.inherit'));
      enabledApiProviders().forEach((provider) => {
        appendApiProviderOption(select, provider.id, provider.name);
      });
      select.value = apiProviderSettings.agentProviderByCliId[profile.id] || 'inherit';
      row.appendChild(select);

      apiProviderAgentBindings.appendChild(row);
    });
  }

  function renderApiProviderDefaultSelect() {
    if (!apiProviderDefaultSelect) {
      return;
    }
    apiProviderDefaultSelect.innerHTML = '';
    appendApiProviderOption(apiProviderDefaultSelect, '', i18n.t('apiSettings.none'));
    enabledApiProviders().forEach((provider) => {
      appendApiProviderOption(apiProviderDefaultSelect, provider.id, provider.name);
    });
    apiProviderDefaultSelect.value = apiProviderSettings.defaultProviderId || '';
  }

  function appendApiProviderOption(select, value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  function enabledApiProviders() {
    return apiProviderSettings.customProviders.filter((provider) => provider.enabled);
  }

  function collectApiProviderForm() {
    const provider = currentApiProvider() || createApiProviderDraft(editingApiProviderId);
    const name = apiProviderName?.value.trim() || '';
    if (!name) {
      showApiSettingsError(i18n.t('apiSettings.nameRequired'));
      return undefined;
    }

    const nextProvider = {
      ...provider,
      name,
      baseUrl: apiProviderBaseUrl?.value.trim() || '',
      apiKeyEnv: sanitizeEnvName(apiProviderApiKeyEnv?.value || ''),
      model: apiProviderModel?.value.trim() || '',
      enabled: Boolean(apiProviderEnabled?.checked),
      extraEnv: collectExtraEnvRows(),
    };
    const providers = apiProviderSettings.customProviders.some((item) => item.id === nextProvider.id)
      ? apiProviderSettings.customProviders.map((item) => item.id === nextProvider.id ? nextProvider : item)
      : [...apiProviderSettings.customProviders, nextProvider];
    const enabledIds = new Set(providers.filter((item) => item.enabled).map((item) => item.id));
    const defaultProviderId = enabledIds.has(apiProviderDefaultSelect?.value || '')
      ? apiProviderDefaultSelect.value
      : '';
    const agentProviderByCliId = {};
    apiProviderAgentBindings?.querySelectorAll('select[data-cli-id]').forEach((select) => {
      if (select.value === 'inherit' || enabledIds.has(select.value)) {
        agentProviderByCliId[select.dataset.cliId] = select.value;
      }
    });

    return normalizeApiProviderSettings({
      customProviders: providers,
      defaultProviderId,
      agentProviderByCliId,
    });
  }

  function collectExtraEnvRows() {
    const result = {};
    apiProviderExtraEnv?.querySelectorAll('.api-extra-env-row').forEach((row) => {
      const key = sanitizeEnvName(row.querySelector('[data-env-key]')?.value || '');
      const value = row.querySelector('[data-env-value]')?.value || '';
      if (key) {
        result[key] = value;
      }
    });
    return result;
  }

  function showApiSettingsError(text) {
    if (!apiProviderSettingsError) {
      return;
    }
    apiProviderSettingsError.textContent = text;
    apiProviderSettingsError.hidden = false;
  }

  function clearApiSettingsError() {
    if (!apiProviderSettingsError) {
      return;
    }
    apiProviderSettingsError.textContent = '';
    apiProviderSettingsError.hidden = true;
  }

  function saveApiProviderSettings() {
    const next = collectApiProviderForm();
    if (!next) {
      return;
    }
    apiProviderSettings = next;
    clearApiSettingsError();
    vscode.postMessage({ command: 'saveApiProviderSettings', settings: apiProviderSettings });
    renderApiProviderSettings();
  }

  function providerStateLabel(profile) {
    if (!profile?.installed) {
      return i18n.t('provider.missing');
    }
    if (runningByProvider[profile.id]) {
      return i18n.t('provider.running');
    }
    if (pendingByProvider[profile.id]) {
      return i18n.t('provider.preparing');
    }
    return i18n.t('provider.ready');
  }

  function composerMenus() {
    return [modelMenu, runtimeMenu, permissionMenu, modeMenu, contextMenu].filter(Boolean);
  }

  function closeComposerMenus(exceptMenu) {
    composerMenus().forEach((menu) => {
      if (menu !== exceptMenu) {
        menu.open = false;
      }
    });
  }

  function composerPopoverFor(menu) {
    return menu?.querySelector('.option-popover, .mode-popover, .context-popover');
  }

  function scheduleComposerPopoverPosition() {
    requestAnimationFrame(positionOpenComposerPopovers);
  }

  function positionOpenComposerPopovers() {
    composerMenus().forEach((menu) => {
      if (!menu.open) {
        return;
      }
      positionComposerPopover(menu);
    });
  }

  function positionComposerPopover(menu) {
    const summary = menu?.querySelector('summary');
    const popover = composerPopoverFor(menu);
    if (!summary || !popover) {
      return;
    }

    const viewportPadding = 8;
    const gap = 6;
    const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    const triggerRect = summary.getBoundingClientRect();
    const availableWidth = Math.max(180, viewportWidth - viewportPadding * 2);

    popover.style.setProperty('--composer-popover-max-width', `${Math.round(availableWidth)}px`);
    popover.style.setProperty('--composer-popover-max-height', `${Math.max(120, viewportHeight - viewportPadding * 2)}px`);

    const popoverRect = popover.getBoundingClientRect();
    const popoverWidth = Math.min(popoverRect.width || availableWidth, availableWidth);
    const spaceAbove = Math.max(0, triggerRect.top - viewportPadding - gap);
    const spaceBelow = Math.max(0, viewportHeight - triggerRect.bottom - viewportPadding - gap);
    const openAbove = spaceAbove >= Math.min(popoverRect.height || 0, 240) || spaceAbove >= spaceBelow;
    const availableHeight = Math.max(120, openAbove ? spaceAbove : spaceBelow);
    const popoverHeight = Math.min(popoverRect.height || availableHeight, availableHeight);
    const alignToEnd = menu === modelMenu || menu === permissionMenu || menu === modeMenu || menu === runtimeMenu;

    let left = alignToEnd ? triggerRect.right - popoverWidth : triggerRect.left;
    left = Math.min(left, viewportWidth - viewportPadding - popoverWidth);
    left = Math.max(viewportPadding, left);

    let top = openAbove ? triggerRect.top - gap - popoverHeight : triggerRect.bottom + gap;
    top = Math.min(top, viewportHeight - viewportPadding - popoverHeight);
    top = Math.max(viewportPadding, top);

    popover.style.setProperty('--composer-popover-left', `${Math.round(left)}px`);
    popover.style.setProperty('--composer-popover-top', `${Math.round(top)}px`);
    popover.style.setProperty('--composer-popover-max-height', `${Math.round(availableHeight)}px`);
  }

  function refreshActiveContext() {
    if (!activeId) {
      return;
    }
    vscode.postMessage({ command: 'refreshContext', cliId: activeId, contextOptions, modelId: activeModelId() });
  }

  function switchActiveProvider(providerId) {
    const profile = profiles.find((item) => item.id === providerId);
    if (!profile?.installed || activeId === providerId) {
      return;
    }

    activeId = providerId;
    ensureActiveThread(activeId);
    activeAgentModeId(activeId);
    activeModelId(activeId);
    activeRuntimeId(activeId);
    activePermissionId(activeId);
    persist();
    persistUserSelection();
    renderAll();
    refreshActiveContext();
    input.focus();
  }

  function renderThreadSelect() {
    threadSelect.innerHTML = '';

    const thread = ensureActiveThread(activeId);
    if (!thread) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = i18n.t('history.untitled');
      threadSelect.appendChild(option);
      threadSelect.disabled = true;
      deleteThreadBtn.disabled = true;
      newChatBtn.disabled = true;
      return;
    }

    const threads = ensureThreadList(activeId)
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt);

    for (const item of threads) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.title || i18n.t('history.untitled');
      threadSelect.appendChild(option);
    }

    threadSelect.value = thread.id;
    threadSelect.disabled = threads.length <= 1 && thread.messages.length === 0;
    deleteThreadBtn.disabled =
      Boolean(runningByProvider[activeId] || pendingByProvider[activeId]) ||
      (threads.length <= 1 && thread.messages.length === 0);
    newChatBtn.disabled = !activeId;
  }

  function renderProviderHint() {
    const profile = activeProfile();
    providerHint.classList.remove('is-warning', 'is-loading');
    providerHint.textContent = '';
    providerHint.title = '';

    if (profilesLoading) {
      providerHint.classList.add('is-loading');
      providerHint.textContent = i18n.t('provider.loading');
      providerHint.title = i18n.t('provider.loadingSubtitle');
      return;
    }

    if (!profile) {
      providerHint.classList.add('is-warning');
      providerHint.textContent = i18n.t('provider.noInstalled');
      return;
    }

    if (!profile.installed) {
      providerHint.classList.add('is-warning');
      providerHint.textContent = i18n.t('provider.install', { hint: profile.installHint });
      return;
    }

    const versionLabel = formatProviderVersion(profile.version);

    if (runningByProvider[profile.id]) {
      providerHint.title = `${profile.name} · ${i18n.t('provider.running')} · ${activeAgentMode(profile).label}${versionLabel ? ` · ${versionLabel}` : ''}`;
      return;
    }

    if (pendingByProvider[profile.id]) {
      providerHint.title = `${profile.name} · ${i18n.t('provider.preparing')} · ${activeAgentMode(profile).label}${versionLabel ? ` · ${versionLabel}` : ''}`;
      return;
    }

    providerHint.title = `${profile.name} · ${i18n.t('provider.ready')} · ${activeAgentMode(profile).label}${versionLabel ? ` · ${versionLabel}` : ''}`;
  }

  function renderContextSummary() {
    if (!contextSummary) {
      return i18n.t('context.waiting');
    }

    const parts = [];
    if (contextSummary.workspace) {
      parts.push(contextSummary.workspace);
    }
    if (contextSummary.activeFile) {
      parts.push(contextSummary.activeFile);
    }
    if (contextSummary.selection) {
      parts.push(i18n.t('context.selectionValue', { value: contextSummary.selection }));
    }
    if (contextSummary.diagnostics) {
      parts.push(i18n.t('context.problemsValue', { count: String(contextSummary.diagnostics) }));
    }

    return parts.length
      ? `${i18n.t('context.prefix')}: ${parts.join(', ')}`
      : i18n.t('context.none');
  }

  function hasSelectionContext() {
    return Boolean(contextSummary?.selection);
  }

  function actionRequiresSelection(action) {
    return action === 'explainSelection' || action === 'refactorSelection';
  }

  function actionLabel(action) {
    const option = actionSelect.querySelector(`option[value="${action}"]`);
    return option?.textContent || i18n.t(`action.${action}`) || action;
  }

  function parseSlashInput(value) {
    const text = String(value || '');
    if (!text.startsWith('/') || text.includes('\n')) {
      return null;
    }

    const match = /^\/([^\s]*)\s*([\s\S]*)$/.exec(text);
    return match
      ? { query: match[1].toLowerCase(), args: (match[2] || '').trim() }
      : null;
  }

  function slashCommandMatchesProvider(command, profile) {
    if (profile?.id === 'opencode' && !OPENCODE_SLASH_COMMAND_NAMES.has(command.name)) {
      return false;
    }

    return !command.providers || command.providers.includes(profile?.id);
  }

  function slashCommandMatchesQuery(command, query) {
    if (!query) {
      return true;
    }

    const names = [command.name, ...(command.aliases || [])];
    return names.some((name) => name.toLowerCase().startsWith(query));
  }

  function slashCommandDescription(command, profile = activeProfile()) {
    return i18n.t(command.descriptionKey || 'slash.native.desc', {
      provider: profile?.name || activeId,
    });
  }

  function commandsForActiveProvider() {
    const profile = activeProfile();
    const seen = new Set();
    const commands = [];
    for (const command of SLASH_COMMANDS) {
      if (!slashCommandMatchesProvider(command, profile) || seen.has(command.name)) {
        continue;
      }

      seen.add(command.name);
      commands.push(command);
    }

    return commands;
  }

  function renderSlashPalette() {
    if (!slashPalette) {
      return;
    }

    const parsed = parseSlashInput(input.value);
    if (!parsed || input.disabled) {
      hideSlashPalette();
      return;
    }

    const profile = activeProfile();
    slashMatches = commandsForActiveProvider()
      .filter((command) => slashCommandMatchesQuery(command, parsed.query))
      .slice(0, 10);
    slashActiveIndex = Math.max(0, Math.min(slashActiveIndex, slashMatches.length - 1));
    slashPalette.innerHTML = '';

    if (slashMatches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'slash-empty';
      empty.textContent = i18n.t('slash.empty');
      slashPalette.appendChild(empty);
      slashPalette.hidden = false;
      return;
    }

    slashMatches.forEach((command, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `slash-command${index === slashActiveIndex ? ' is-active' : ''}`;
      button.dataset.command = command.name;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', index === slashActiveIndex ? 'true' : 'false');

      const title = document.createElement('span');
      title.className = 'slash-command-label';
      title.textContent = `/${command.name}`;
      const description = document.createElement('span');
      description.className = 'slash-command-description';
      description.textContent = slashCommandDescription(command, profile);
      button.appendChild(title);
      button.appendChild(description);
      slashPalette.appendChild(button);
    });

    slashPalette.hidden = false;
  }

  function hideSlashPalette() {
    slashMatches = [];
    slashActiveIndex = 0;
    if (slashPalette) {
      slashPalette.hidden = true;
      slashPalette.innerHTML = '';
    }
  }

  function slashPaletteVisible() {
    return Boolean(slashPalette && !slashPalette.hidden);
  }

  function moveSlashSelection(delta) {
    if (slashMatches.length === 0) {
      return;
    }

    slashActiveIndex = (slashActiveIndex + delta + slashMatches.length) % slashMatches.length;
    renderSlashPalette();
  }

  function buildSlashCommandPrompt(command, args) {
    if (!args) {
      return command.prompt || '';
    }

    return command.prompt ? `${command.prompt}\n\n${args}` : args;
  }

  function buildSlashHelpMessage() {
    return commandsForActiveProvider()
      .slice(0, 24)
      .map((command) => `/${command.name} - ${slashCommandDescription(command)}`)
      .join('\n');
  }

  function latestCompletedAssistantText() {
    return ensureConversation(activeId)
      .slice()
      .reverse()
      .find((message) => message.role === 'assistant' && !message.running && normalizeMessageText(message.text).trim())
      ?.text;
  }

  function executeLocalSlashCommand(command, args = '') {
    switch (command.local) {
      case 'new':
        startNewThread(activeId);
        return;
      case 'help':
        if (activeProfile()?.id === 'opencode') {
          closeComposerMenus();
          showOpenCodeStatusDialog('help');
          return;
        }
        addMessage(activeId, 'system', buildSlashHelpMessage());
        renderAll();
        return;
      case 'context':
        forceContextMenuVisible = true;
        contextMenu?.classList.add('is-visible');
        if (contextMenu) {
          contextMenu.open = true;
        }
        renderContextSummaryLabel();
        return;
      case 'refresh':
        vscode.postMessage({ command: 'checkProfiles' });
        vscode.postMessage({ command: 'refreshContext', cliId: activeId, contextOptions, modelId: activeModelId() });
        return;
      case 'stop':
        if (runningByProvider[activeId]) {
          vscode.postMessage({ command: 'stop', cliId: activeId });
        } else {
          addMessage(activeId, 'system', i18n.t('slash.noRun'));
        }
        return;
      case 'copy':
        {
          const latest = latestCompletedAssistantText();
          if (!latest) {
            addMessage(activeId, 'system', i18n.t('slash.copyEmpty'));
            return;
          }
          vscode.postMessage({ command: 'copyMessageText', text: markdownToCopyPlainText(latest) });
          addMessage(activeId, 'system', i18n.t('slash.copied'));
        }
        return;
      case 'sessions':
        closeComposerMenus();
        showOpenCodeStatusDialog('sessions');
        return;
      case 'models':
        closeComposerMenus();
        showOpenCodeStatusDialog('models');
        return;
      case 'agents':
        closeComposerMenus();
        showOpenCodeStatusDialog('agents');
        return;
      case 'mcp':
        closeComposerMenus();
        showOpenCodeStatusDialog('mcp');
        vscode.postMessage({ command: 'refreshContext', cliId: activeId, contextOptions, modelId: activeModelId() });
        return;
      case 'variants':
        closeComposerMenus();
        showOpenCodeStatusDialog('variants');
        return;
      case 'connect':
        closeComposerMenus();
        openSettingsPage('apiProviders');
        return;
      case 'org':
        closeComposerMenus();
        showOpenCodeStatusDialog('org');
        return;
      case 'status':
        closeComposerMenus();
        showOpenCodeStatusDialog('status');
        vscode.postMessage({ command: 'refreshContext', cliId: activeId, contextOptions, modelId: activeModelId() });
        return;
      case 'themes':
        closeComposerMenus();
        showOpenCodeStatusDialog('themes');
        return;
      case 'exit':
        closeComposerMenus();
        addMessage(activeId, 'system', i18n.t('slash.exit.message'));
        renderAll();
        return;
      case 'open':
        vscode.postMessage({ command: 'openFilePalette' });
        return;
      case 'terminal':
        vscode.postMessage({ command: 'openProviderExtension', cliId: activeId });
        return;
      default:
        return;
    }
  }

  function executeOpenCodeNativeSlashCommand(command) {
    if (!OPENCODE_NATIVE_API_COMMAND_NAMES.has(command.name)) {
      addMessage(
        activeId,
        'system',
        i18n.t('slash.unsupported', {
          command: `/${command.name}`,
          provider: activeProfile()?.name || activeId,
        })
      );
      return;
    }

    const openCodeSessionId = activeOpenCodeSessionId();
    if (!openCodeSessionId) {
      addMessage(activeId, 'error', i18n.t('slash.opencode.noSession'), undefined, false, activeThreadId(activeId));
      return;
    }

    vscode.postMessage({
      command: 'openCodeNativeCommand',
      nativeCommand: command.name,
      openCodeSessionId: activeOpenCodeSessionId(),
    });
  }

  function openCodeNativeCommandResultText(message) {
    const command = `/${message.nativeCommand || message.command || 'opencode'}`;
    if (message.ok) {
      if (message.newOpenCodeSessionId && message.nativeCommand === 'fork') {
        return i18n.t('slash.opencode.forked');
      }
      if (message.url) {
        return i18n.t('slash.opencode.shared', { url: message.url });
      }
      return i18n.t('slash.opencode.done', { command });
    }

    return i18n.t('slash.opencode.failed', {
      command,
      message: message.message || i18n.t('message.unknownError'),
    });
  }

  function cloneMessagesForOpenCodeFork(messages) {
    return (messages || []).map((message) => {
      if (!message || typeof message !== 'object') {
        return message;
      }

      const cloned = { ...message, running: false };
      delete cloned.startedAt;
      delete cloned.runningNotice;
      return cloned;
    });
  }

  function handleOpenCodeForkResult(message) {
    if (!message?.newOpenCodeSessionId) {
      return false;
    }

    const currentThread = ensureActiveThread('opencode');
    const forkedThread = createThread(
      'opencode',
      cloneMessagesForOpenCodeFork(currentThread?.messages || [])
    );
    forkedThread.openCodeSessionId = message.newOpenCodeSessionId;
    if (message.title) {
      forkedThread.title = message.title;
    }

    setActiveThread('opencode', forkedThread);
    activeId = 'opencode';
    addMessage('opencode', 'system', i18n.t('slash.opencode.forked'), undefined, false, forkedThread.id);
    persist();
    renderAll();
    return true;
  }

  function executeSlashCommand(command) {
    if (!command) {
      addMessage(activeId, 'system', i18n.t('slash.empty'));
      hideSlashPalette();
      return;
    }

    const parsed = parseSlashInput(input.value);
    const args = parsed?.args || '';
    input.value = '';
    input.style.height = 'auto';
    hideSlashPalette();

    if (command.kind === 'local') {
      executeLocalSlashCommand(command, args);
      renderComposer();
      return;
    }

    if (command.kind === 'native') {
      if (activeProfile()?.id === 'opencode') {
        executeOpenCodeNativeSlashCommand(command);
      } else {
        addMessage(
          activeId,
          'system',
          i18n.t('slash.unsupported', {
            command: `/${command.name}`,
            provider: activeProfile()?.name || activeId,
          })
        );
      }
      renderComposer();
      return;
    }

    if (command.action) {
      command.prompt = buildSlashCommandPrompt(command, args);
      send(command.action, command.prompt, command.modeByProvider?.[activeId]);
    }
  }

  function renderContextChipText() {
    if (!contextSummary) {
      return i18n.t('context.compactPending');
    }

    const parts = [];
    if (contextSummary.selection) {
      parts.push(i18n.t('context.compactSelection'));
    } else if (contextSummary.activeFile) {
      parts.push(i18n.t('context.compactFile'));
    }
    if (contextSummary.diagnostics) {
      parts.push(i18n.t('context.compactProblems'));
    }
    if (parts.length === 0 && contextSummary.workspace) {
      parts.push(i18n.t('context.compactWorkspace'));
    }

    return parts.length ? parts.slice(0, 2).join('+') : i18n.t('context.compactNone');
  }

  function renderContextSummaryLabel() {
    const summary = renderContextSummary();
    contextSummaryLabel.textContent = renderContextChipText();
    contextSummaryLabel.closest('.context-summary')?.setAttribute('title', summary);
    contextMenu?.classList.toggle(
      'is-visible',
      Boolean(
        forceContextMenuVisible ||
        (
          contextSummary &&
          (
            contextSummary.selection ||
            contextSummary.activeFile ||
            contextSummary.diagnostics ||
            contextSummary.workspace
          )
        )
      )
    );
  }

  function renderContextBudget() {
    if (
      !contextBudget ||
      !contextBudgetLabel ||
      !contextBudgetPercent ||
      !contextBudgetTokens ||
      !contextBudgetTokenizer ||
      !contextBudgetPolicy
    ) {
      return;
    }

    const profile = activeProfile();
    const tokenUsage = contextSummary?.tokenUsage;
    if (!profile || !contextSummary || !tokenUsage) {
      contextBudget.hidden = true;
      contextBudgetLabel.textContent = '';
      contextBudget.title = '';
      return;
    }

    contextBudget.hidden = false;
    const isExact = tokenUsage.precision === 'exact' && Number.isFinite(Number(tokenUsage.tokens));
    contextBudget.classList.toggle('has-total', Boolean(isExact && (contextSummary.contextWindowTokens || profile.contextWindowTokens)));
    contextBudget.classList.toggle('is-unavailable', !isExact);

    if (!isExact) {
      contextBudgetLabel.textContent = '';
      contextBudgetPercent.textContent = i18n.t('contextWindow.exactUnavailable', { provider: profile.name });
      contextBudgetTokens.textContent = i18n.t('contextWindow.providerManaged', { provider: profile.name });
      contextBudgetTokenizer.textContent = '';
      contextBudgetPolicy.textContent = '';
      contextBudget.title = [
        i18n.t('contextWindow.title'),
        contextBudgetPercent.textContent,
        contextBudgetTokens.textContent,
      ].filter(Boolean).join(' ');
      positionContextBudgetPopover();
      return;
    }

    const usedTokens = Math.max(0, Math.round(Number(tokenUsage.tokens) || 0));
    const totalTokens = Math.max(0, Math.round(Number(contextSummary.contextWindowTokens) || Number(profile.contextWindowTokens) || 0));
    const hasTotal = totalTokens > 0;
    const used = formatTokenCount(usedTokens);

    if (hasTotal) {
      const usedPercent = Math.min(100, Math.max(usedTokens > 0 ? 1 : 0, Math.round((usedTokens / totalTokens) * 100)));
      const total = formatTokenCount(totalTokens);
      const remaining = formatTokenCount(Math.max(0, totalTokens - usedTokens));
      contextBudgetLabel.textContent = `${usedPercent}%`;
      contextBudgetPercent.textContent = i18n.t('contextWindow.usedPercent', { percent: String(usedPercent) });
      contextBudgetTokens.textContent = i18n.t('contextWindow.usedTokens', { used });
      contextBudgetTokenizer.textContent = i18n.t('contextWindow.totalTokens', { total });
      contextBudgetPolicy.textContent = [
        i18n.t('contextWindow.remaining', { remaining }),
        profile.autoCompactsContext ? i18n.t('contextWindow.autoCompact') : '',
      ].filter(Boolean).join(' · ');
    } else {
      contextBudgetLabel.textContent = used;
      contextBudgetPercent.textContent = i18n.t('contextWindow.usedTokens', { used });
      contextBudgetTokens.textContent = contextSummary.workspace || '';
      contextBudgetTokenizer.textContent = contextSummary.activeFile || '';
      contextBudgetPolicy.textContent = profile.autoCompactsContext
        ? i18n.t('contextWindow.autoCompact')
        : '';
    }
    contextBudget.title = [
      i18n.t('contextWindow.title'),
      contextBudgetPercent.textContent,
      contextBudgetTokens.textContent,
      contextBudgetTokenizer.textContent,
      contextBudgetPolicy.textContent,
    ].filter(Boolean).join(' ');
    positionContextBudgetPopover();
  }

  function positionContextBudgetPopover() {
    if (!contextBudget || !contextBudgetPopover || contextBudget.hidden) {
      return;
    }

    const viewportPadding = 10;
    const triggerRect = contextBudget.getBoundingClientRect();
    const popoverWidth = Math.min(contextBudgetPopover.offsetWidth || 0, window.innerWidth - viewportPadding * 2);
    let left = 0;
    const rightOverflow = triggerRect.left + left + popoverWidth - (window.innerWidth - viewportPadding);
    if (rightOverflow > 0) {
      left -= rightOverflow;
    }

    const leftOverflow = triggerRect.left + left - viewportPadding;
    if (leftOverflow < 0) {
      left -= leftOverflow;
    }

    contextBudget.style.setProperty('--context-budget-popover-left', `${Math.round(left)}px`);
  }

  function formatOpenCodeNumber(value) {
    return Math.max(0, Math.round(Number(value) || 0)).toLocaleString('en-US');
  }

  function formatOpenCodeTimestamp(value) {
    const date = new Date(Number(value) || Date.now());
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  function compactOpenCodePath(value) {
    return String(value || '')
      .trim()
      .replace(/^\/Users\/[^/]+(?=\/|$)/, '~')
      .replace(/^\/home\/[^/]+(?=\/|$)/, '~');
  }

  function openCodeSessionTitle(thread) {
    const title = String(thread?.title || '').trim();
    if (!title || title === i18n.t('history.newThread') || title === i18n.t('history.untitled')) {
      return 'New session';
    }

    return title;
  }

  function openCodeContextMetrics(profile) {
    const tokenUsage = contextSummary?.tokenUsage;
    const isExact = tokenUsage?.precision === 'exact' && Number.isFinite(Number(tokenUsage.tokens));
    const usedTokens = isExact ? Math.max(0, Math.round(Number(tokenUsage.tokens) || 0)) : 0;
    const totalTokens = Math.max(0, Math.round(Number(contextSummary?.contextWindowTokens) || Number(profile?.contextWindowTokens) || 0));
    const usedPercent = totalTokens > 0 ? Math.min(100, Math.round((usedTokens / totalTokens) * 100)) : 0;

    return [
      { text: `${formatOpenCodeNumber(usedTokens)} tokens`, strong: true },
      { text: `${usedPercent}% used` },
      { text: '$0.00 spent' },
    ];
  }

  function openCodeMcpStatusLabel(entry) {
    const status = String(entry?.status || 'unknown');
    if (status === 'connected') {
      return i18n.t('opencode.dialog.mcp.status.connected');
    }
    if (status === 'needs_auth') {
      return i18n.t('opencode.dialog.mcp.status.needsAuth');
    }
    if (status === 'disabled') {
      return i18n.t('opencode.dialog.mcp.disabled');
    }
    if (status === 'failed') {
      return entry?.error || i18n.t('opencode.dialog.mcp.status.failed');
    }
    return entry?.error || status;
  }

  function openCodeMcpStatusKind(entry) {
    const status = String(entry?.status || '');
    if (status === 'connected') {
      return 'connected';
    }
    if (status === 'failed') {
      return 'error';
    }
    if (status === 'needs_auth') {
      return 'warning';
    }
    if (status === 'disabled') {
      return 'disabled';
    }
    return '';
  }

  function normalizedMcpMemory(value) {
    return Array.isArray(value) ? value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean) : [];
  }

  function disabledMcpNames(cliId = activeId) {
    return new Set(normalizedMcpMemory(disabledMcpByProvider[cliId]));
  }

  function isOpenCodeMcpDisabled(entry, cliId = activeId) {
    const name = String(entry?.name || '').trim();
    if (!name) {
      return false;
    }
    if (String(entry?.status || '') === 'disabled') {
      return true;
    }
    return disabledMcpNames(cliId).has(name);
  }

  function openCodeMcpDialogStatusLabel(entry) {
    const status = String(entry?.status || '').trim();
    if (!status) {
      return 'unknown';
    }
    if (status === 'connected') {
      return i18n.t('opencode.dialog.mcp.status.connected');
    }
    if (status === 'needs_auth') {
      return i18n.t('opencode.dialog.mcp.status.needsAuth');
    }
    if (status === 'disabled') {
      return i18n.t('opencode.dialog.mcp.disabled');
    }
    if (status === 'failed') {
      return i18n.t('opencode.dialog.mcp.status.failed');
    }
    return status;
  }

  function openCodeMcpEnabledStateLabel(enabled) {
    if (enabled) {
      return `✓ ${i18n.t('opencode.dialog.mcp.enabled')}`;
    }
    return `○ ${i18n.t('opencode.dialog.mcp.disabled')}`;
  }

  function openCodeMcpDialogOptions() {
    const servers = Array.isArray(contextSummary?.mcpServers) ? contextSummary.mcpServers : [];
    const needle = openCodeDialogQuery.trim().toLowerCase();
    return servers
      .map((entry) => {
        const name = String(entry?.name || '').trim();
        if (!name) {
          return undefined;
        }
        const enabled = !isOpenCodeMcpDisabled(entry);
        return {
          id: name,
          label: name,
          meta: openCodeMcpDialogStatusLabel(entry),
          footer: openCodeMcpEnabledStateLabel(enabled),
          enabled,
          status: openCodeMcpStatusKind(entry),
        };
      })
      .filter(Boolean)
      .filter((option) => {
        if (!needle) {
          return true;
        }
        return [option.label, option.meta, option.footer]
          .some((value) => String(value || '').toLowerCase().includes(needle));
      });
  }

  function toggleOpenCodeMcp(cliId, name) {
    const normalized = String(name || '').trim();
    if (!cliId || !normalized) {
      return;
    }
    const disabled = disabledMcpNames(cliId);
    if (disabled.has(normalized)) {
      disabled.delete(normalized);
    } else {
      disabled.add(normalized);
    }
    disabledMcpByProvider[cliId] = Array.from(disabled);
    persist();
  }

  function openCodeMcpLines() {
    const servers = contextSummary?.mcpServers;
    if (!Array.isArray(servers)) {
      return [{ text: contextSummary?.mcpStatusPending ? i18n.t('opencode.dialog.mcp.loading') : i18n.t('opencode.dialog.mcp.unavailable') }];
    }
    if (servers.length === 0) {
      return [{ text: contextSummary?.mcpStatusPending ? i18n.t('opencode.dialog.mcp.loading') : i18n.t('opencode.dialog.mcp.empty') }];
    }

    return servers.map((entry) => ({
      status: isOpenCodeMcpDisabled(entry) ? 'disabled' : openCodeMcpStatusKind(entry),
      text: [
        entry.name,
        isOpenCodeMcpDisabled(entry) ? i18n.t('opencode.dialog.mcp.disabled') : openCodeMcpStatusLabel(entry),
      ].filter(Boolean).join(' '),
    }));
  }

  function openCodeLspStatusLabel(entry) {
    const status = String(entry?.status || '').trim();
    if (!status) {
      return '';
    }
    if (status === 'connected') {
      return 'Connected';
    }
    if (status === 'failed') {
      return entry?.error || 'Failed';
    }
    if (status === 'disabled') {
      return 'Disabled';
    }
    return entry?.error || status;
  }

  function openCodeLspStatusKind(entry) {
    const status = String(entry?.status || '').trim();
    if (status === 'connected') {
      return 'connected';
    }
    if (status === 'failed') {
      return 'error';
    }
    if (status === 'disabled') {
      return 'disabled';
    }
    return '';
  }

  function openCodeLspLines() {
    const servers = Array.isArray(contextSummary?.lspServers) ? contextSummary.lspServers : [];
    if (servers.length === 0) {
      return [{ text: 'LSPs auto-detected from file types' }];
    }

    return servers.map((entry) => {
      const label = openCodeLspStatusLabel(entry);
      return {
        status: openCodeLspStatusKind(entry),
        text: [entry.name, label].filter(Boolean).join(' '),
      };
    });
  }

  function openCodeProjectPath() {
    return contextSummary?.openCodeProject?.worktree || contextSummary?.workspacePath || '';
  }

  function appendOpenCodeBlock(parent, titleText, lines, options = {}) {
    const section = document.createElement('section');
    section.className = 'opencode-sidebar-block';
    if (options.key) {
      section.dataset.openCodeBlock = options.key;
    }

    const title = document.createElement('div');
    title.className = `opencode-sidebar-heading${options.toggle ? ' is-toggle' : ''}${options.action ? ' is-action' : ''}`;
    title.textContent = options.toggle ? `▼ ${titleText}` : titleText;
    if (options.action) {
      title.setAttribute('role', 'button');
      title.setAttribute('tabindex', '0');
      title.addEventListener('click', options.action);
      title.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          options.action();
        }
      });
    }
    section.appendChild(title);

    lines.forEach((line) => {
      if (!line) {
        return;
      }
      const item = document.createElement('div');
      item.className = `opencode-sidebar-line${line.strong ? ' is-strong' : ''}${line.status ? ' is-status' : ''}`;
      if (line.status) {
        const dot = document.createElement('span');
        dot.className = `opencode-sidebar-dot is-${line.status}`;
        dot.setAttribute('aria-hidden', 'true');
        item.appendChild(dot);
      }
      const value = document.createElement('span');
      value.textContent = String(line.text || '');
      item.appendChild(value);
      section.appendChild(item);
    });

    parent.appendChild(section);
  }

  function openCodeWorkspaceFooter() {
    const workspace = compactOpenCodePath(openCodeProjectPath()) || contextSummary?.workspace || '';
    const branch = String(contextSummary?.workspaceBranch || '').trim();
    if (!workspace) {
      return '';
    }

    return branch ? `${workspace}:${branch}` : workspace;
  }

  function normalizedModelMemory(value) {
    return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
  }

  function recentModelIds(cliId = activeId) {
    const selected = activeModelId(cliId);
    const recent = normalizedModelMemory(recentModelByProvider[cliId]);
    return [selected, ...recent.filter((item) => item !== selected)].slice(0, 6);
  }

  function favoriteModelIds(cliId = activeId) {
    return normalizedModelMemory(favoriteModelByProvider[cliId]);
  }

  function rememberRecentModel(cliId, modelId) {
    if (!cliId || !modelId) {
      return;
    }
    const recent = normalizedModelMemory(recentModelByProvider[cliId]);
    recentModelByProvider[cliId] = [modelId, ...recent.filter((item) => item !== modelId)].slice(0, 8);
  }

  function toggleFavoriteModel(cliId, modelId) {
    if (!cliId || !modelId) {
      return;
    }
    const favorites = new Set(favoriteModelIds(cliId));
    if (favorites.has(modelId)) {
      favorites.delete(modelId);
    } else {
      favorites.add(modelId);
    }
    favoriteModelByProvider[cliId] = Array.from(favorites).slice(0, 12);
    persist();
  }

  function openCodeModelProviderId(modelId) {
    const value = String(modelId || '');
    return value.includes('/') ? value.split('/')[0] : 'configured';
  }

  function openCodeModelProviderName(providerId) {
    const names = {
      anthropic: 'Anthropic',
      google: 'Google',
      groq: 'Groq',
      mistral: 'Mistral',
      mimo: 'Xiaomi MiMo',
      ollama: 'Ollama',
      openai: 'OpenAI',
      opencode: 'OpenCode Zen',
      openrouter: 'OpenRouter',
      xai: 'xAI',
    };
    if (names[providerId]) {
      return names[providerId];
    }
    return String(providerId || 'Configured')
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function openCodeModelTokenTitle(token) {
    const known = {
      chatgpt: 'ChatGPT',
      claude: 'Claude',
      codestral: 'Codestral',
      deepseek: 'DeepSeek',
      gemini: 'Gemini',
      gpt: 'GPT',
      llama: 'Llama',
      minimax: 'MiniMax',
      mimo: 'MiMo',
      nemotron: 'Nemotron',
      qwen: 'Qwen',
    };
    const value = String(token || '');
    const lower = value.toLowerCase();
    if (known[lower]) {
      return known[lower];
    }
    if (/^v?\d/.test(lower)) {
      return lower.toUpperCase();
    }
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  function openCodeModelTitle(modelId, fallback) {
    const id = String(modelId || '');
    const raw = id.includes('/') ? id.split('/').pop() : id;
    const label = String(fallback || '').trim();
    if (label && label !== id) {
      return label;
    }
    return raw
      .split('-')
      .filter(Boolean)
      .map(openCodeModelTokenTitle)
      .join(' ') || id;
  }

  function openCodeModelFooter(option, providerId) {
    const id = String(option?.id || '');
    if (providerId === 'opencode' || /(?:^|-)free$/.test(id)) {
      return 'Free';
    }
    return '';
  }

  function openCodeDialogModelOptions() {
    const profile = activeProfile();
    const selectedId = activeModel(profile).id;
    const favorites = new Set(favoriteModelIds(activeId));
    return modelOptionsFor(profile).filter(selectableOption).map((option) => {
      const display = localizedCliOption(option, 'model');
      const providerId = openCodeModelProviderId(option.id);
      return {
        id: option.id,
        label: option.custom && activeCustomModel(activeId)
          ? activeCustomModel(activeId)
          : openCodeModelTitle(option.id, display.label),
        meta: option.custom ? display.description : openCodeModelProviderName(providerId),
        category: openCodeModelProviderName(providerId),
        providerId,
        footer: openCodeModelFooter(option, providerId),
        selected: option.id === selectedId,
        favorite: favorites.has(option.id),
        disabled: Boolean(option.disabled),
      };
    });
  }

  function openCodeModelOptionGroups() {
    const options = openCodeDialogModelOptions();
    const needle = openCodeDialogQuery.trim().toLowerCase();
    if (needle) {
      return [{
        title: '',
        options: options.filter((option) => [
          option.label,
          option.meta,
          option.category,
          option.id,
        ].some((value) => String(value || '').toLowerCase().includes(needle))),
      }];
    }

    const byId = new Map(options.map((option) => [option.id, option]));
    const favoriteIds = favoriteModelIds(activeId);
    const recentIds = recentModelIds(activeId).filter((id) => !favoriteIds.includes(id));
    const usedIds = new Set();
    const groups = [];
    const favoriteOptions = favoriteIds.map((id) => byId.get(id)).filter(Boolean);
    const recentOptions = recentIds.map((id) => byId.get(id)).filter(Boolean);

    if (favoriteOptions.length > 0) {
      groups.push({ title: 'Favorites', options: favoriteOptions });
      favoriteOptions.forEach((option) => usedIds.add(option.id));
    }
    if (recentOptions.length > 0) {
      groups.push({ title: 'Recent', options: recentOptions });
      recentOptions.forEach((option) => usedIds.add(option.id));
    }

    const grouped = new Map();
    options
      .filter((option) => !usedIds.has(option.id))
      .forEach((option) => {
        if (!grouped.has(option.category)) {
          grouped.set(option.category, []);
        }
        grouped.get(option.category).push(option);
      });

    grouped.forEach((items, title) => {
      groups.push({
        title,
        options: items.sort((a, b) => {
          if (a.footer === 'Free' && b.footer !== 'Free') {
            return -1;
          }
          if (a.footer !== 'Free' && b.footer === 'Free') {
            return 1;
          }
          return a.label.localeCompare(b.label);
        }),
      });
    });

    return groups;
  }

  function openCodeSessionOptions() {
    ensureActiveThread('opencode');
    const selectedId = activeThreadId('opencode');
    return ensureThreadList('opencode')
      .slice()
      .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
      .map((thread) => ({
        id: thread.id,
        label: openCodeSessionTitle(thread),
        meta: [
          thread.openCodeSessionId || '',
          formatOpenCodeTimestamp(thread.updatedAt || thread.createdAt),
        ].filter(Boolean).join(' · '),
        selected: thread.id === selectedId,
      }));
  }

  function openCodeStatusLines(profile) {
    const model = activeModel(profile);
    const modelLabel = model.custom && activeCustomModel(activeId)
      ? activeCustomModel(activeId)
      : localizedCliOption(model, 'model')?.label;
    const mode = localizedCliOption(activeAgentMode(profile), 'agentMode');
    const mcpServers = Array.isArray(contextSummary?.mcpServers) ? contextSummary.mcpServers : [];
    const connectedMcpCount = mcpServers.filter((entry) => entry?.status === 'connected').length;
    const versionLabel = formatProviderVersion(profile?.version);

    return [
      { text: versionLabel ? `OpenCode ${versionLabel}` : 'OpenCode' },
      { text: `Session ${activeOpenCodeSessionId() || activeThreadId('opencode') || 'local'}` },
      { text: `Model ${modelLabel || 'Default'}` },
      { text: `Agent ${mode?.label || 'Default'}` },
      { text: `MCP ${connectedMcpCount}/${mcpServers.length}` },
      ...openCodeContextMetrics(profile),
    ];
  }

  function openCodeHelpLines() {
    return commandsForActiveProvider()
      .map((command) => ({
        text: `/${command.name} - ${slashCommandDescription(command)}`,
      }));
  }

  function openCodeThemeLines() {
    return [{ text: 'Theme follows the active VS Code color theme' }];
  }

  function openCodeVariantLines() {
    return [{ text: 'No model variants configured' }];
  }

  function openCodeOrgLines() {
    return [{ text: 'Organizations are managed by the configured OpenCode provider' }];
  }

  function openCodeDialogEmptyText(kind) {
    if (kind === 'sessions') {
      return 'No sessions';
    }
    if (kind === 'models') {
      return 'No models';
    }
    if (kind === 'mcp') {
      return contextSummary?.mcpStatusPending ? i18n.t('opencode.dialog.mcp.loading') : i18n.t('opencode.dialog.mcp.empty');
    }
    if (kind === 'variants') {
      return 'No model variants configured';
    }
    return 'No options';
  }

  function openCodeDialogTitle(kind) {
    if (kind === 'sessions') {
      return 'Sessions';
    }
    if (kind === 'models') {
      return 'Select model';
    }
    if (kind === 'agents') {
      return 'Agents';
    }
    if (kind === 'variants') {
      return 'Variants';
    }
    if (kind === 'mcp') {
      return i18n.t('opencode.dialog.mcp.title');
    }
    if (kind === 'lsp') {
      return 'LSP';
    }
    if (kind === 'org') {
      return 'Organizations';
    }
    if (kind === 'status') {
      return 'Status';
    }
    if (kind === 'themes') {
      return 'Themes';
    }
    if (kind === 'help') {
      return 'Help';
    }
    return 'OpenCode';
  }

  function openCodeDialogDescription(kind) {
    if (kind === 'sessions') {
      const count = ensureThreadList('opencode').length;
      return `${count} ${count === 1 ? 'session' : 'sessions'}`;
    }
    if (kind === 'models') {
      return '';
    }
    if (kind === 'agents') {
      const mode = localizedCliOption(activeAgentMode(), 'agentMode');
      return mode?.label ? `Current agent: ${mode.label}` : 'Select an agent';
    }
    if (kind === 'mcp') {
      return '';
    }
    if (kind === 'lsp') {
      return 'LSPs auto-detected from file types';
    }
    if (kind === 'variants') {
      return 'Select a model variant';
    }
    if (kind === 'org') {
      return 'Switch OpenCode organization';
    }
    if (kind === 'status') {
      return 'Current OpenCode workspace status';
    }
    if (kind === 'themes') {
      return 'Theme selection follows VS Code';
    }
    if (kind === 'help') {
      return 'OpenCode slash commands';
    }
    return '';
  }

  function openCodeDialogLines(kind) {
    if (kind === 'lsp') {
      return openCodeLspLines();
    }
    if (kind === 'mcp') {
      return openCodeMcpLines();
    }
    if (kind === 'status') {
      return openCodeStatusLines(activeProfile());
    }
    if (kind === 'themes') {
      return openCodeThemeLines();
    }
    if (kind === 'variants') {
      return openCodeVariantLines();
    }
    if (kind === 'org') {
      return openCodeOrgLines();
    }
    if (kind === 'help') {
      return openCodeHelpLines();
    }
    return [];
  }

  function openCodeDialogOptions(kind) {
    const profile = activeProfile();
    if (kind === 'sessions') {
      return openCodeSessionOptions();
    }

    if (kind === 'models') {
      const selectedId = activeModel(profile).id;
      return modelOptionsFor(profile).filter(selectableOption).map((option) => {
        const display = localizedCliOption(option, 'model');
        return {
          id: option.id,
          label: option.custom && activeCustomModel(activeId) ? activeCustomModel(activeId) : display.label,
          meta: display.description || display.summaryLabel || '',
          selected: option.id === selectedId,
          disabled: Boolean(option.disabled),
        };
      });
    }

    if (kind === 'agents') {
      const selectedId = activeAgentModeId(activeId);
      return agentModesFor(profile).map((mode) => {
        const display = localizedCliOption(mode, 'agentMode');
        const splitMode = profile?.id === 'opencode' ? splitAgentModeLabel(display.label) : undefined;
        return {
          id: mode.id,
          label: splitMode?.title || display.label,
          meta: splitMode?.detail || display.description || mode.instruction || '',
          selected: mode.id === selectedId,
          disabled: Boolean(mode.disabled),
        };
      });
    }

    return [];
  }

  function closeOpenCodeStatusDialog() {
    openCodeDialogKind = '';
    renderOpenCodeStatusDialog();
  }

  function showOpenCodeStatusDialog(kind) {
    openCodeDialogKind = kind;
    openCodeDialogQuery = '';
    openCodeDialogActiveIndex = 0;
    renderOpenCodeStatusDialog();
  }

  function renderOpenCodeStatusDialog() {
    document.querySelector('.opencode-dialog-backdrop')?.remove();
    if (!openCodeDialogKind || activeProfile()?.id !== 'opencode') {
      return;
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'opencode-dialog-backdrop';
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) {
        closeOpenCodeStatusDialog();
      }
    });

    const dialog = document.createElement('section');
    dialog.className = `opencode-dialog is-${openCodeDialogKind}`;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const header = document.createElement('header');
    header.className = 'opencode-dialog-header';

    const titleWrap = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = openCodeDialogTitle(openCodeDialogKind);
    titleWrap.appendChild(title);
    const descriptionText = openCodeDialogDescription(openCodeDialogKind);
    if (descriptionText) {
      const description = document.createElement('p');
      description.textContent = descriptionText;
      titleWrap.appendChild(description);
    }

    const close = document.createElement('button');
    close.className = 'opencode-dialog-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = 'esc';
    close.addEventListener('click', closeOpenCodeStatusDialog);

    header.append(titleWrap, close);
    dialog.appendChild(header);

    const body = document.createElement('div');
    body.className = 'opencode-dialog-body';
    if (openCodeDialogKind === 'models') {
      renderOpenCodeGroupedOptionDialogBody(body, openCodeDialogKind);
      dialog.appendChild(body);
      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);
      body.querySelector('.opencode-dialog-filter')?.focus();
      return;
    }
    if (openCodeDialogKind === 'mcp') {
      dialog.addEventListener('keydown', handleOpenCodeMcpDialogKeydown);
      renderOpenCodeMcpDialogBody(body);
      dialog.appendChild(body);
      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);
      body.querySelector('.opencode-dialog-filter')?.focus();
      return;
    }
    if (openCodeDialogKind === 'sessions' || openCodeDialogKind === 'models' || openCodeDialogKind === 'agents') {
      renderOpenCodeOptionDialogBody(body, openCodeDialogKind);
      dialog.appendChild(body);
      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);
      return;
    }

    openCodeDialogLines(openCodeDialogKind).forEach((line) => {
      const row = document.createElement('div');
      row.className = `opencode-dialog-row${line.status ? ' is-status' : ''}`;
      if (line.status) {
        const dot = document.createElement('span');
        dot.className = `opencode-sidebar-dot is-${line.status}`;
        dot.setAttribute('aria-hidden', 'true');
        row.appendChild(dot);
      }
      const text = document.createElement('span');
      text.textContent = String(line.text || '');
      row.appendChild(text);
      body.appendChild(row);
    });
    dialog.appendChild(body);

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
  }

  function renderOpenCodeGroupedOptionDialogBody(body, kind) {
    const filter = document.createElement('input');
    filter.className = 'opencode-dialog-filter';
    filter.type = 'text';
    filter.value = openCodeDialogQuery;
    filter.placeholder = 'Search';
    filter.setAttribute('aria-label', 'Search');
    filter.addEventListener('input', () => {
      openCodeDialogQuery = filter.value;
      renderOpenCodeModelGroups(list);
    });
    body.appendChild(filter);

    const list = document.createElement('div');
    list.className = 'opencode-dialog-grouped-options';
    body.appendChild(list);
    renderOpenCodeModelGroups(list);

    const actions = document.createElement('div');
    actions.className = 'opencode-dialog-footer-actions';

    const connect = document.createElement('button');
    connect.type = 'button';
    connect.className = 'opencode-dialog-footer-action';
    connect.textContent = 'Connect provider';
    connect.addEventListener('click', () => {
      closeOpenCodeStatusDialog();
      openSettingsPage('apiProviders');
    });
    actions.appendChild(connect);

    const connectKey = document.createElement('span');
    connectKey.className = 'opencode-dialog-footer-key';
    connectKey.textContent = 'ctrl+a';
    actions.appendChild(connectKey);

    const favorite = document.createElement('button');
    favorite.type = 'button';
    favorite.className = 'opencode-dialog-footer-action';
    favorite.textContent = 'Favorite';
    favorite.addEventListener('click', () => {
      toggleFavoriteModel(activeId, activeModelId(activeId));
      renderOpenCodeModelGroups(list);
    });
    actions.appendChild(favorite);

    const favoriteKey = document.createElement('span');
    favoriteKey.className = 'opencode-dialog-footer-key';
    favoriteKey.textContent = 'ctrl+f';
    actions.appendChild(favoriteKey);

    body.appendChild(actions);
  }

  function renderOpenCodeMcpDialogBody(body) {
    const filter = document.createElement('input');
    filter.className = 'opencode-dialog-filter';
    filter.type = 'text';
    filter.value = openCodeDialogQuery;
    filter.placeholder = i18n.t('opencode.dialog.mcp.search');
    filter.setAttribute('aria-label', i18n.t('opencode.dialog.mcp.searchAria'));
    filter.addEventListener('input', () => {
      openCodeDialogQuery = filter.value;
      openCodeDialogActiveIndex = 0;
      renderOpenCodeMcpOptions(list);
    });
    body.appendChild(filter);

    const list = document.createElement('div');
    list.className = 'opencode-dialog-mcp-options';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', i18n.t('opencode.dialog.mcp.title'));
    body.appendChild(list);
    renderOpenCodeMcpOptions(list);

    const actions = document.createElement('div');
    actions.className = 'opencode-dialog-footer-actions';

    const toggle = document.createElement('span');
    toggle.className = 'opencode-dialog-footer-action';
    toggle.textContent = i18n.t('opencode.dialog.mcp.toggle');
    actions.appendChild(toggle);

    const key = document.createElement('span');
    key.className = 'opencode-dialog-footer-key';
    key.textContent = i18n.t('opencode.dialog.mcp.space');
    actions.appendChild(key);

    body.appendChild(actions);
  }

  function renderOpenCodeMcpOptions(parent) {
    parent.innerHTML = '';
    const options = openCodeMcpDialogOptions();
    if (options.length === 0) {
      openCodeDialogActiveIndex = 0;
      const empty = document.createElement('div');
      empty.className = 'opencode-dialog-row';
      empty.textContent = openCodeDialogEmptyText('mcp');
      parent.appendChild(empty);
      return;
    }

    openCodeDialogActiveIndex = Math.min(Math.max(openCodeDialogActiveIndex, 0), options.length - 1);
    options.forEach((option, index) => {
      parent.appendChild(createOpenCodeMcpOptionButton(option, index));
    });
  }

  function createOpenCodeMcpOptionButton(option, index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = [
      'opencode-dialog-option',
      index === openCodeDialogActiveIndex ? 'is-active' : '',
      option.enabled ? 'is-enabled' : 'is-disabled',
    ].filter(Boolean).join(' ');
    button.dataset.opencodeDialogKind = 'mcp';
    button.dataset.opencodeDialogValue = option.id;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', index === openCodeDialogActiveIndex ? 'true' : 'false');
    button.addEventListener('click', () => {
      openCodeDialogActiveIndex = index;
      toggleOpenCodeMcp(activeId, option.id);
      renderAll();
      requestAnimationFrame(focusOpenCodeMcpActiveOption);
    });

    const check = document.createElement('span');
    check.className = 'opencode-dialog-option-check';
    check.setAttribute('aria-hidden', 'true');
    button.appendChild(check);

    const content = document.createElement('span');
    content.className = 'opencode-dialog-option-content';

    const label = document.createElement('span');
    label.className = 'opencode-dialog-option-label';
    label.textContent = option.label;
    content.appendChild(label);

    if (option.meta) {
      const meta = document.createElement('span');
      meta.className = 'opencode-dialog-option-meta';
      meta.textContent = option.meta;
      content.appendChild(meta);
    }

    button.appendChild(content);

    const footer = document.createElement('span');
    footer.className = `opencode-dialog-option-footer is-${option.enabled ? 'enabled' : 'disabled'}`;
    footer.textContent = option.footer;
    button.appendChild(footer);

    return button;
  }

  function handleOpenCodeMcpDialogKeydown(event) {
    if (openCodeDialogKind !== 'mcp') {
      return;
    }

    const options = openCodeMcpDialogOptions();
    if (options.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      openCodeDialogActiveIndex = (openCodeDialogActiveIndex + delta + options.length) % options.length;
      renderOpenCodeStatusDialog();
      requestAnimationFrame(focusOpenCodeMcpActiveOption);
      return;
    }

    if (event.key === ' ') {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.classList.contains('opencode-dialog-filter')) {
        return;
      }
      event.preventDefault();
      const option = options[openCodeDialogActiveIndex];
      toggleOpenCodeMcp(activeId, option.id);
      renderAll();
      requestAnimationFrame(focusOpenCodeMcpActiveOption);
    }
  }

  function focusOpenCodeMcpActiveOption() {
    document.querySelector('.opencode-dialog.is-mcp .opencode-dialog-option.is-active')?.focus();
  }

  function renderOpenCodeModelGroups(parent) {
    parent.innerHTML = '';
    const groups = openCodeModelOptionGroups().filter((group) => group.options.length > 0);
    if (groups.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'opencode-dialog-row';
      empty.textContent = openCodeDialogEmptyText('models');
      parent.appendChild(empty);
      return;
    }

    groups.forEach((group) => {
      if (group.title) {
        const heading = document.createElement('div');
        heading.className = 'opencode-dialog-group-heading';
        heading.textContent = group.title;
        parent.appendChild(heading);
      }

      group.options.forEach((option) => {
        parent.appendChild(createOpenCodeDialogOptionButton('models', option));
      });
    });
  }

  function renderOpenCodeOptionDialogBody(body, kind) {
    const options = openCodeDialogOptions(kind);
    if (options.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'opencode-dialog-row';
      empty.textContent = openCodeDialogEmptyText(kind);
      body.appendChild(empty);
      return;
    }

    options.forEach((option) => {
      body.appendChild(createOpenCodeDialogOptionButton(kind, option));
    });
  }

  function createOpenCodeDialogOptionButton(kind, option) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = [
      'opencode-dialog-option',
      option.selected ? 'is-selected' : '',
      option.disabled ? 'is-disabled' : '',
    ].filter(Boolean).join(' ');
    button.dataset.opencodeDialogKind = kind;
    button.dataset.opencodeDialogValue = option.id;
    button.disabled = Boolean(option.disabled);
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-checked', option.selected ? 'true' : 'false');
    button.addEventListener('click', () => selectOpenCodeDialogOption(kind, option.id));

    const check = document.createElement('span');
    check.className = 'opencode-dialog-option-check';
    check.setAttribute('aria-hidden', 'true');
    button.appendChild(check);

    const content = document.createElement('span');
    content.className = 'opencode-dialog-option-content';

    const label = document.createElement('span');
    label.className = 'opencode-dialog-option-label';
    label.textContent = option.label;
    content.appendChild(label);

    if (option.meta) {
      const meta = document.createElement('span');
      meta.className = 'opencode-dialog-option-meta';
      meta.textContent = option.meta;
      content.appendChild(meta);
    }

    button.appendChild(content);

    if (option.footer) {
      const footer = document.createElement('span');
      footer.className = 'opencode-dialog-option-footer';
      footer.textContent = option.footer;
      button.appendChild(footer);
    }

    return button;
  }

  function selectOpenCodeDialogOption(kind, value) {
    if (kind === 'sessions') {
      const thread = findThread('opencode', value);
      if (!thread) {
        return;
      }

      setActiveThread('opencode', thread);
      activeId = 'opencode';
      persist();
      closeOpenCodeStatusDialog();
      renderAll();
      return;
    }

    if (kind === 'models') {
      const option = modelOptionsFor(activeProfile()).find((item) => item.id === value);
      activeModelByProvider[activeId] = value;
      modelSelect.value = value;
      rememberRecentModel(activeId, value);
      persist();
      persistUserSelection();
      closeOpenCodeStatusDialog();
      renderAll();
      if (option?.custom) {
        modelMenu.open = true;
        customModelInput.focus();
      }
      return;
    }

    if (kind === 'agents') {
      activeAgentModeByProvider[activeId] = value;
      agentModeSelect.value = value;
      legacyWorkflowMode = undefined;
      persist();
      persistUserSelection();
      closeOpenCodeStatusDialog();
      renderAll();
      return;
    }

    if (kind === 'mcp') {
      toggleOpenCodeMcp(activeId, value);
      renderAll();
    }
  }

  function renderOpenCodeSidebar() {
    if (!sidebar) {
      return;
    }

    const profile = activeProfile();
    sidebar.hidden = profile?.id !== 'opencode';
    sidebar.innerHTML = '';
    if (profile?.id !== 'opencode') {
      return;
    }

    const thread = ensureActiveThread(profile.id);
    const versionLabel = formatProviderVersion(profile.version);
    const shell = document.createElement('div');
    shell.className = 'opencode-sidebar';

    const sessionTitle = document.createElement('div');
    sessionTitle.className = 'opencode-sidebar-session-title';
    sessionTitle.textContent = `${openCodeSessionTitle(thread)} - ${formatOpenCodeTimestamp(thread?.createdAt)}`;
    shell.appendChild(sessionTitle);

    appendOpenCodeBlock(shell, 'Context', openCodeContextMetrics(profile), { key: 'context' });
    appendOpenCodeBlock(shell, 'MCP', openCodeMcpLines(), {
      key: 'mcp',
      toggle: true,
      action: () => showOpenCodeStatusDialog('mcp'),
    });
    appendOpenCodeBlock(shell, 'LSP', openCodeLspLines(), {
      key: 'lsp',
      action: () => showOpenCodeStatusDialog('lsp'),
    });

    const spacer = document.createElement('div');
    spacer.className = 'opencode-sidebar-spacer';
    shell.appendChild(spacer);

    const footer = document.createElement('div');
    footer.className = 'opencode-sidebar-footer';
    const workspace = openCodeWorkspaceFooter();
    if (workspace) {
      const workspaceLine = document.createElement('div');
      workspaceLine.textContent = workspace;
      footer.appendChild(workspaceLine);
    }
    const versionLine = document.createElement('div');
    versionLine.className = 'opencode-sidebar-version';
    versionLine.textContent = versionLabel ? `OpenCode ${versionLabel}` : 'OpenCode';
    footer.appendChild(versionLine);
    shell.appendChild(footer);

    sidebar.appendChild(shell);
  }

  function taskStatusCounts(source) {
    const counts = TASK_STATUSES.reduce((result, status) => ({ ...result, [status]: 0 }), {});
    (source || []).forEach((task) => {
      const status = TASK_STATUSES.includes(task.status) ? task.status : 'completed';
      counts[status] += 1;
    });
    return counts;
  }

  function isActiveTask(task) {
    return TASK_ACTIVE_STATUSES.includes(task?.status);
  }

  function visibleTasksForBoard() {
    if (!VISUAL_TASK_BOARD_ENABLED || taskBoardDismissed) {
      return [];
    }

    const activeTasks = tasks.filter(isActiveTask);
    if (activeTasks.length === 0) {
      return [];
    }

    return activeTasks.slice(0, 12);
  }

  function renderTaskBoard() {
    if (!taskBoard) {
      return;
    }

    const visibleTasks = visibleTasksForBoard();
    taskBoard.innerHTML = '';
    taskBoard.hidden = visibleTasks.length === 0;
    if (visibleTasks.length === 0) {
      return;
    }

    const counts = taskStatusCounts(visibleTasks);
    const summary = document.createElement('div');
    summary.className = 'task-board-summary';
    summary.setAttribute('aria-label', i18n.t('taskBoard.summary'));
    TASK_STATUSES.filter((status) => counts[status] > 0).forEach((status) => {
      const pill = document.createElement('span');
      pill.className = `task-status-pill is-${status}`;
      pill.dataset.taskStatus = status;
      pill.textContent = i18n.t('taskBoard.count', {
        status: i18n.t(`task.status.${status}`),
        count: String(counts[status]),
      });
      summary.appendChild(pill);
    });
    taskBoard.appendChild(summary);

    const currentTask = visibleTasks.find(isActiveTask) || visibleTasks[0];
    const menuTasks = visibleTasks.filter((task) => task.id !== currentTask.id);
    const current = document.createElement('button');
    current.type = 'button';
    current.className = `task-board-current is-${currentTask.status}`;
    current.dataset.taskId = currentTask.id;
    current.dataset.providerId = currentTask.providerId;
    current.dataset.threadId = currentTask.threadId || '';
    current.title = [
      currentTask.providerName,
      i18n.t(`task.status.${currentTask.status}`),
      currentTask.title,
    ].filter(Boolean).join(' · ');

    const currentDot = document.createElement('span');
    currentDot.className = 'task-board-current-dot';
    currentDot.setAttribute('aria-hidden', 'true');
    current.appendChild(currentDot);

    const currentBody = document.createElement('span');
    currentBody.className = 'task-board-current-body';

    const currentTitle = document.createElement('span');
    currentTitle.className = 'task-board-current-title';
    currentTitle.textContent = currentTask.title || i18n.t('task.untitled');
    currentBody.appendChild(currentTitle);

    const currentMeta = document.createElement('span');
    currentMeta.className = 'task-board-current-meta';
    currentMeta.textContent = [
      currentTask.providerName,
      i18n.t(`task.status.${currentTask.status}`),
      currentTask.agentMode || '',
    ].filter(Boolean).join(' · ');
    currentBody.appendChild(currentMeta);
    current.appendChild(currentBody);
    taskBoard.appendChild(current);

    const menu = document.createElement('details');
    menu.className = 'task-board-menu';
    menu.hidden = menuTasks.length === 0;

    const menuSummary = document.createElement('summary');
    menuSummary.className = 'task-board-menu-summary';
    menuSummary.textContent = `+${menuTasks.length}`;
    menuSummary.title = i18n.t('taskBoard.summary');
    menu.appendChild(menuSummary);

    const popover = document.createElement('div');
    popover.className = 'task-board-popover';
    menuTasks.forEach((task) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `task-board-row is-${task.status}`;
      button.dataset.taskId = task.id;
      button.dataset.providerId = task.providerId;
      button.dataset.threadId = task.threadId || '';
      button.title = [
        task.providerName,
        i18n.t(`task.status.${task.status}`),
        task.title,
      ].filter(Boolean).join(' · ');

      const statusDot = document.createElement('span');
      statusDot.className = 'task-board-row-dot';
      statusDot.setAttribute('aria-hidden', 'true');
      button.appendChild(statusDot);

      const body = document.createElement('span');
      body.className = 'task-board-row-body';

      const title = document.createElement('span');
      title.className = 'task-board-row-title';
      title.textContent = task.title || i18n.t('task.untitled');
      body.appendChild(title);

      const meta = document.createElement('span');
      meta.className = 'task-board-row-meta';
      meta.textContent = [
        task.providerName,
        i18n.t(`task.status.${task.status}`),
        task.agentMode || '',
      ].filter(Boolean).join(' · ');
      body.appendChild(meta);

      button.appendChild(body);
      popover.appendChild(button);
    });
    menu.appendChild(popover);
    taskBoard.appendChild(menu);

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'task-board-dismiss';
    dismiss.dataset.taskBoardDismiss = 'true';
    dismiss.title = i18n.t('action.dismiss');
    dismiss.setAttribute('aria-label', i18n.t('action.dismiss'));
    taskBoard.appendChild(dismiss);
  }

  function renderMessages() {
    const conversation = ensureConversation(activeId);
    const activeThread = ensureActiveThread(activeId);
    const messageThreadKey = `${activeId || 'none'}:${activeThread?.id || 'none'}`;
    const shouldStickToBottom = shouldAutoScrollMessages(messageThreadKey);
    const previousScrollTop = messages.scrollTop;
    const isPending = Boolean(pendingByProvider[activeId]);
    const selectedProfile = activeProfile();
    messages.innerHTML = '';

    if (profilesLoading) {
      syncMessageStatusTimer(false);
      appendProviderLoadingState();
      restoreMessageScroll(shouldStickToBottom, previousScrollTop, messageThreadKey);
      return;
    }

    if (!activeId || !selectedProfile) {
      const firstInstallHintProfile = profiles.find((profile) => profile?.installHint && !profile.installed);
      const noProviderSubtitle = firstInstallHintProfile
        ? providerUnavailableMessage(firstInstallHintProfile)
        : i18n.t('provider.unavailable');
      syncMessageStatusTimer(false);
      appendEmptyState(
        i18n.t('provider.noInstalled'),
        noProviderSubtitle,
        true,
        firstInstallHintProfile?.installHint
      );
      restoreMessageScroll(shouldStickToBottom, previousScrollTop, messageThreadKey);
      return;
    }

    if (conversation.length === 0 && !isPending) {
      syncMessageStatusTimer(false);
      if (!selectedProfile.installed) {
        appendEmptyState(
          i18n.t('provider.noInstalled'),
          providerUnavailableMessage(selectedProfile),
          true,
          selectedProfile.installHint
        );
        restoreMessageScroll(shouldStickToBottom, previousScrollTop, messageThreadKey);
        return;
      }

      appendEmptyState(i18n.t('empty.title'), i18n.t('empty.subtitle'));
      restoreMessageScroll(shouldStickToBottom, previousScrollTop, messageThreadKey);
      return;
    }

    let hasVisibleRunningMessage = false;
    for (let index = 0; index < conversation.length; index += 1) {
      const item = conversation[index];
      const itemRunning = Boolean(item.running && runningByProvider[activeId]);
      hasVisibleRunningMessage = hasVisibleRunningMessage || itemRunning;
      const wrapper = document.createElement('div');
      wrapper.className = `message ${item.role}${itemRunning ? ' is-running' : ''}`;

      const bubble = document.createElement('div');
      bubble.className = 'message-bubble';

      if (item.meta && item.role !== 'user') {
        const metaText = normalizeMessageText(item.meta);
        bubble.title = metaText;
        const meta = document.createElement('div');
        meta.className = 'message-meta';
        meta.textContent = metaText;
        bubble.appendChild(meta);
      }

      const body = document.createElement('div');
      body.className = 'message-content';
      if (item.role === 'assistant' && normalizeMessageText(item.thinking).trim()) {
        appendMessageThinking(bubble, item.thinking);
      }
      renderMarkdownLite(body, normalizeMessageText(item.text));
      bubble.appendChild(body);

      if (Array.isArray(item.attachments) && item.attachments.length > 0) {
        appendMessageAttachments(bubble, item.attachments);
      }

      if (shouldShowAssistantCopyButton(conversation, index, itemRunning)) {
        const copyActions = document.createElement('div');
        copyActions.className = 'message-actions';
        const copyButton = createMessageCopyButton();
        const copyGroupStart = assistantCopyGroupStart(conversation, index);
        copyButton.dataset.messageCopyStart = String(copyGroupStart);
        copyButton.dataset.messageCopyEnd = String(index);
        if (isCopiedFeedbackActive(copyGroupStart, index)) {
          applyCopiedFeedback(copyButton);
        }
        copyActions.appendChild(copyButton);
        bubble.appendChild(copyActions);
      }

      if (itemRunning) {
        appendMessageStatus(
          bubble,
          item.runningNotice ||
            runningMessageStatusText(
              item.text ? i18n.t('message.generating') : i18n.t('message.thinking'),
              item.startedAt
            )
        );
      }

      wrapper.appendChild(bubble);
      messages.appendChild(wrapper);
    }

    if (isPending && activeThread?.id === pendingThreadByProvider[activeId]) {
      appendLoadingMessage(i18n.t('message.preparing'));
    }

    syncMessageStatusTimer(hasVisibleRunningMessage);
    restoreMessageScroll(shouldStickToBottom, previousScrollTop, messageThreadKey);
  }

  function shouldShowAssistantCopyButton(conversation, index, itemRunning) {
    const item = conversation[index];
    if (item?.role !== 'assistant' || itemRunning || !normalizeMessageText(item.text).trim()) {
      return false;
    }

    for (let nextIndex = index + 1; nextIndex < conversation.length; nextIndex += 1) {
      const next = conversation[nextIndex];
      if (!next || next.role !== 'assistant') {
        return true;
      }
      const nextRunning = Boolean(next.running && runningByProvider[activeId]);
      if (nextRunning || normalizeMessageText(next.text).trim()) {
        return false;
      }
    }

    return true;
  }

  function assistantCopyGroupStart(conversation, index) {
    let start = index;
    while (start > 0 && conversation[start - 1]?.role === 'assistant') {
      start -= 1;
    }
    return start;
  }

  function assistantCopyGroupPlainText(conversation, start, end) {
    return (conversation || [])
      .slice(start, end + 1)
      .filter((item) => item?.role === 'assistant')
      .map((item) => markdownToCopyPlainText(item.text))
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }

  function shouldAutoScrollMessages(threadKey) {
    if (threadKey !== renderedMessageThreadKey) {
      return true;
    }

    if (messages.scrollHeight <= messages.clientHeight) {
      return true;
    }

    const distanceFromBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight;
    return distanceFromBottom <= MESSAGE_BOTTOM_STICKY_THRESHOLD;
  }

  function restoreMessageScroll(shouldStickToBottom, previousScrollTop, threadKey) {
    if (shouldStickToBottom) {
      messages.scrollTop = messages.scrollHeight;
    } else {
      const maxScrollTop = Math.max(0, messages.scrollHeight - messages.clientHeight);
      messages.scrollTop = Math.min(previousScrollTop, maxScrollTop);
    }
    renderedMessageThreadKey = threadKey;
  }

  var COPY_CLIPBOARD_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M16 4h2a2 2 0 0 1 2 2v4m1 4H11"/><path d="m15 10l-4 4l4 4"/></g></svg>';
  var COPY_CHECK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14l2 2l4-4"/></g></svg>';

  function createMessageCopyButton() {
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'message-copy-button';
    copyButton.dataset.messageCopy = 'true';
    copyButton.title = i18n.t('message.copy');
    copyButton.setAttribute('aria-label', i18n.t('message.copy'));
    copyButton.innerHTML = COPY_CLIPBOARD_SVG + '<span class="message-copy-label">' + i18n.t('message.copy') + '</span>';
    return copyButton;
  }

  var copiedFeedbackState = { start: -1, end: -1, at: 0 };
  var copiedFeedbackTimer = 0;
  var COPIED_FEEDBACK_DURATION = 2000;

  function showCopiedFeedback(button) {
    var start = Number(button.dataset.messageCopyStart);
    var end = Number(button.dataset.messageCopyEnd);
    copiedFeedbackState = { start: start, end: end, at: Date.now() };
    if (copiedFeedbackTimer) { clearTimeout(copiedFeedbackTimer); }
    applyCopiedFeedback(button);
    copiedFeedbackTimer = setTimeout(function() {
      copiedFeedbackState = { start: -1, end: -1, at: 0 };
      copiedFeedbackTimer = 0;
    }, COPIED_FEEDBACK_DURATION);
  }

  function applyCopiedFeedback(button) {
    button.classList.add('is-copied');
    button.innerHTML = COPY_CHECK_SVG + '<span class="message-copy-label">' + i18n.t('message.copied') + '</span>';
    button.title = i18n.t('message.copied');
    button.setAttribute('aria-label', i18n.t('message.copied'));
  }

  function restoreCopyDefault(button) {
    button.classList.remove('is-copied');
    button.innerHTML = COPY_CLIPBOARD_SVG + '<span class="message-copy-label">' + i18n.t('message.copy') + '</span>';
    button.title = i18n.t('message.copy');
    button.setAttribute('aria-label', i18n.t('message.copy'));
  }

  function isCopiedFeedbackActive(start, end) {
    return copiedFeedbackState.at > 0
      && Date.now() - copiedFeedbackState.at < COPIED_FEEDBACK_DURATION
      && copiedFeedbackState.start === start
      && copiedFeedbackState.end === end;
  }

  function syncMessageStatusTimer(shouldRun) {
    if (shouldRun && !messageStatusTimer) {
      messageStatusTimer = setInterval(() => {
        renderMessages();
      }, 1000);
      return;
    }

    if (!shouldRun && messageStatusTimer) {
      clearInterval(messageStatusTimer);
      messageStatusTimer = undefined;
    }
  }

  function runningMessageStatusText(stage, startedAt) {
    const elapsed = formatElapsedTime(startedAt);
    return elapsed ? i18n.t('message.statusElapsed', { status: stage, elapsed }) : stage;
  }

  function formatElapsedTime(startedAt) {
    const start = Number(startedAt);
    if (!Number.isFinite(start) || start <= 0) {
      return '';
    }

    const totalSeconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}m ${seconds}s`;
  }

  function appendMessageAttachments(container, attachments) {
    const wrap = document.createElement('div');
    wrap.className = 'message-attachments';
    normalizeMessageAttachments(attachments).forEach((attachment) => {
      const item = document.createElement('div');
      item.className = 'message-attachment';
      item.textContent = `${attachment.name} · ${formatBytes(attachment.size)}`;
      item.title = attachment.path || attachment.name;
      wrap.appendChild(item);
    });
    container.appendChild(wrap);
  }

  function appendEmptyState(titleText, subtitleText, showSetupAction = false, installHint) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';

    const title = document.createElement('div');
    title.className = 'empty-title';
    title.textContent = titleText;
    empty.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.className = 'empty-subtitle';
    subtitle.textContent = subtitleText;
    empty.appendChild(subtitle);

    const suggestions = document.createElement('div');
    suggestions.className = 'suggestion-list';

    const suggestionActions = showSetupAction
      ? [['openSettings', 'empty.configureProviders']]
      : [
        ['explainSelection', 'empty.explain'],
        ['reviewFile', 'empty.review'],
        ['generateTests', 'empty.tests'],
        ['refactorSelection', 'empty.refactor'],
      ];
    if (showSetupAction && installHint) {
      suggestionActions.push(['copyInstall', 'empty.copyInstall']);
    }

    for (const [action, labelKey] of suggestionActions) {
      const button = document.createElement('button');
      button.className = 'suggestion-button';
      if (action === 'openSettings') {
        button.classList.add('suggestion-button--primary');
      }
      button.dataset.action = action;
      if (action === 'copyInstall' && installHint) {
        button.dataset.installCommand = installHint;
      }
      button.textContent = i18n.t(labelKey);
      if (actionRequiresSelection(action) && !hasSelectionContext()) {
        button.disabled = true;
        button.title = i18n.t('quick.missingSelection');
      }
      suggestions.appendChild(button);
    }

    empty.appendChild(suggestions);
    messages.appendChild(empty);
  }

  function appendProviderLoadingState() {
    const empty = document.createElement('div');
    empty.className = 'empty-state is-loading';

    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    empty.appendChild(spinner);

    const title = document.createElement('div');
    title.className = 'empty-title';
    title.textContent = i18n.t('provider.loading');
    empty.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.className = 'empty-subtitle';
    subtitle.textContent = i18n.t('provider.loadingSubtitle');
    empty.appendChild(subtitle);

    messages.appendChild(empty);
  }

  function providerUnavailableMessage(profile) {
    const resolvedProfile = typeof profile === 'string'
      ? profiles.find((item) => item.id === profile)
      : profile;

    if (resolvedProfile?.installHint) {
      return i18n.t('provider.unavailableWithHint', { hint: resolvedProfile.installHint });
    }

    return i18n.t('provider.unavailable');
  }

  function appendLoadingMessage(text) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message assistant is-running';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    appendMessageStatus(bubble, text);

    wrapper.appendChild(bubble);
    messages.appendChild(wrapper);
  }

  function appendMessageStatus(container, text) {
    const status = document.createElement('div');
    status.className = 'message-status';

    const spinner = document.createElement('span');
    spinner.className = 'message-spinner';
    status.appendChild(spinner);

    const label = document.createElement('span');
    label.textContent = text;
    status.appendChild(label);

    container.appendChild(status);
  }

  function renderWorkflowMode() {
    renderModelSelect();
    renderRuntimeSelect();
    renderPermissionSelect();
    renderAgentModeSelect();
  }

  function renderOptionSelect(select, options, value, group) {
    select.innerHTML = '';
    options.filter(selectableOption).forEach((option) => {
      const displayOption = localizedCliOption(option, group);
      const item = document.createElement('option');
      item.value = option.id;
      item.textContent = displayOption.label;
      item.title = displayOption.description || displayOption.label;
      if (option.dangerous) {
        item.dataset.dangerous = 'true';
      }
      select.appendChild(item);
    });
    select.value = value;
  }

  function appendDangerBadge(button, option) {
    if (!option?.dangerous) {
      return;
    }

    const warning = document.createElement('span');
    warning.className = 'option-list-item-warning';
    warning.textContent = '!';
    warning.title = i18n.t('option.danger');
    warning.setAttribute('aria-label', i18n.t('option.danger'));
    button.appendChild(warning);
  }

  function renderRuntimeOptionList(options, selectedId) {
    if (!runtimeOptionList) {
      return;
    }

    runtimeOptionList.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'option-list-title';
    title.textContent = i18n.t('runtime.continue');
    runtimeOptionList.appendChild(title);

    options.forEach((option) => {
      const displayOption = localizedCliOption(option, 'runtime');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = [
        'option-list-item',
        option.id === selectedId ? 'is-selected' : '',
        option.disabled ? 'is-disabled' : '',
        option.actionOnly ? 'is-action' : '',
        option.external ? 'is-external' : '',
        option.dividerBefore ? 'has-divider' : '',
      ].filter(Boolean).join(' ');
      button.dataset.value = option.id;
      button.disabled = Boolean(option.disabled);
      button.setAttribute('role', selectableOption(option) ? 'menuitemradio' : 'menuitem');
      button.setAttribute('aria-checked', option.id === selectedId ? 'true' : 'false');
      button.title = displayOption.description || displayOption.label;

      const icon = document.createElement('span');
      icon.className = 'option-list-item-icon';
      icon.setAttribute('aria-hidden', 'true');
      button.appendChild(icon);

      const label = document.createElement('span');
      label.textContent = displayOption.label;
      button.appendChild(label);

      const trailing = document.createElement('span');
      trailing.className = 'option-list-item-trailing';
      trailing.setAttribute('aria-hidden', 'true');
      trailing.textContent = option.external ? '↗' : (option.actionOnly ? '›' : '');
      button.appendChild(trailing);
      appendDangerBadge(button, option);

      runtimeOptionList.appendChild(button);
    });
  }

  function renderPermissionOptionList(options, selectedId) {
    if (!permissionOptionList) {
      return;
    }

    permissionOptionList.innerHTML = '';
    const profile = activeProfile();
    const visibleOptions = options.filter((option) => (
      profile?.id !== 'codex' || option.id !== 'readOnly' || option.id === selectedId
    ));

    visibleOptions.forEach((option) => {
      const displayOption = localizedPermissionOption(option);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = [
        'option-list-item',
        'permission-option-item',
        option.id === selectedId ? 'is-selected' : '',
        option.dangerous ? 'is-danger' : '',
      ].filter(Boolean).join(' ');
      button.dataset.value = option.id;
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-checked', option.id === selectedId ? 'true' : 'false');
      button.title = displayOption.description || displayOption.label;

      const icon = document.createElement('span');
      icon.className = 'permission-option-icon';
      icon.setAttribute('aria-hidden', 'true');
      button.appendChild(icon);

      const label = document.createElement('span');
      label.textContent = displayOption.label;
      button.appendChild(label);

      const check = document.createElement('span');
      check.className = 'permission-option-check';
      check.setAttribute('aria-hidden', 'true');
      button.appendChild(check);
      appendDangerBadge(button, option);

      permissionOptionList.appendChild(button);
    });
  }

  function renderModelOptionList(options, selectedId) {
    if (!modelOptionList) {
      return;
    }

    modelOptionList.innerHTML = '';
    options.forEach((option) => {
      const displayOption = localizedCliOption(option, 'model');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = [
        'option-list-item',
        'model-option-item',
        option.id === selectedId ? 'is-selected' : '',
        option.custom ? 'is-custom' : '',
      ].filter(Boolean).join(' ');
      button.dataset.value = option.id;
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-checked', option.id === selectedId ? 'true' : 'false');
      button.title = displayOption.description || displayOption.label;

      const label = document.createElement('span');
      label.textContent = displayOption.label;
      button.appendChild(label);

      const check = document.createElement('span');
      check.className = 'model-option-check';
      check.setAttribute('aria-hidden', 'true');
      button.appendChild(check);

      modelOptionList.appendChild(button);
    });
  }

  function renderModelSelect() {
    const profile = activeProfile();
    const options = modelOptionsFor(profile);
    const model = activeModel(profile);
    const displayModel = localizedCliOption(model, 'model');
    renderOptionSelect(modelSelect, options, model.id, 'model');
    renderModelOptionList(options, model.id);
    modelSelect.title = displayModel.description || i18n.t('model.label');
    modelSummaryLabel.textContent = model.custom && activeCustomModel(activeId)
      ? activeCustomModel(activeId)
      : displayModel.summaryLabel || displayModel.label || i18n.t('model.short');
    modelSummaryLabel.closest('.option-summary')?.setAttribute('title', displayModel.description || i18n.t('model.label'));
    modelMenu?.classList.toggle('is-visible', Boolean(profile && options.length > 1));
    customModelField.hidden = !model.custom;
    customModelInput.value = activeCustomModel(activeId);
    customModelInput.disabled = !profile || !profile.installed;
  }

  function renderRuntimeSelect() {
    const profile = activeProfile();
    const options = runtimeModesFor(profile);
    const runtime = activeRuntime(profile);
    const displayRuntime = localizedCliOption(runtime, 'runtime');
    renderOptionSelect(runtimeSelect, options, runtime.id, 'runtime');
    renderRuntimeOptionList(options, runtime.id);
    runtimeSelect.title = displayRuntime.description || i18n.t('runtime.label');
    runtimeSummaryLabel.textContent = displayRuntime.summaryLabel || displayRuntime.label || i18n.t('runtime.short');
    runtimeSummaryLabel.closest('.option-summary')?.setAttribute(
      'title',
      [
        displayRuntime.description || i18n.t('runtime.label'),
        runtime.dangerous ? i18n.t('option.danger') : '',
      ].filter(Boolean).join(' · ')
    );
    runtimeMenu?.classList.toggle('is-visible', Boolean(profile && options.length > 1));
    runtimeMenu?.classList.toggle('is-danger', Boolean(runtime?.dangerous));
  }

  function renderPermissionSelect() {
    const profile = activeProfile();
    const options = permissionModesFor(profile);
    const permission = activePermission(profile);
    const displayPermission = localizedPermissionOption(permission);
    renderOptionSelect(permissionSelect, options, permission.id, 'permission');
    renderPermissionOptionList(options, permission.id);
    permissionSelect.title = displayPermission.description || i18n.t('permission.label');
    permissionSummaryLabel.textContent = displayPermission.label || i18n.t('permission.short');
    permissionSummaryLabel.closest('.option-summary')?.setAttribute(
      'title',
      [
        displayPermission.description || i18n.t('permission.label'),
        permission.dangerous ? i18n.t('option.danger') : '',
      ].filter(Boolean).join(' · ')
    );
    permissionMenu?.classList.toggle('is-visible', Boolean(profile && options.length > 1));
    permissionMenu?.classList.toggle('is-danger', Boolean(permission.dangerous));
  }

  function renderAgentModeSelect() {
    agentModeSelect.innerHTML = '';
    const profile = activeProfile();
    const modes = agentModesFor(profile);

    modes.forEach((mode) => {
      const displayMode = localizedCliOption(mode, 'agentMode');
      const option = document.createElement('option');
      option.value = mode.id;
      option.textContent = displayMode.label;
      option.title = displayMode.description || mode.instruction || displayMode.label;
      option.disabled = Boolean(mode.disabled);
      agentModeSelect.appendChild(option);
    });

    agentModeSelect.value = activeAgentModeId(activeId);
    renderAgentModeOptionList(modes, agentModeSelect.value);
    const mode = activeAgentMode();
    const displayMode = localizedCliOption(mode, 'agentMode');
    agentModeSelect.title = displayMode?.description || i18n.t('agentMode.label');
    if (agentModeSummaryLabel) {
      agentModeSummaryLabel.textContent = profile?.id === 'opencode'
        ? splitAgentModeLabel(displayMode?.label || i18n.t('agentMode.short')).title
        : (displayMode?.label || i18n.t('agentMode.short'));
      agentModeSummaryLabel.closest('.mode-summary')?.setAttribute(
        'title',
        `${profile?.name || i18n.t('provider.label')} · ${displayMode?.description || displayMode?.label || ''}`.trim()
      );
    }
    modeMenu?.classList.toggle('is-visible', Boolean(profile && (profile?.id === 'opencode' || modes.length > 1)));
  }

  function renderAgentModeOptionList(modes, selectedId) {
    if (!agentModeOptionList) {
      return;
    }

    agentModeOptionList.innerHTML = '';
    const profile = activeProfile();
    modes.forEach((mode) => {
      const displayMode = localizedCliOption(mode, 'agentMode');
      const splitMode = splitAgentModeLabel(displayMode.label);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = [
        'option-list-item',
        'mode-option-item',
        mode.id === selectedId ? 'is-selected' : '',
        mode.disabled ? 'is-disabled' : '',
      ].filter(Boolean).join(' ');
      button.dataset.value = mode.id;
      button.disabled = Boolean(mode.disabled);
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-checked', mode.id === selectedId ? 'true' : 'false');
      button.title = displayMode.description || mode.instruction || displayMode.label;

      const marker = document.createElement('span');
      marker.className = 'mode-option-marker';
      marker.setAttribute('aria-hidden', 'true');
      button.appendChild(marker);

      const label = document.createElement('span');
      label.className = 'mode-option-text';
      label.textContent = profile?.id === 'opencode' ? splitMode.title : displayMode.label;
      button.appendChild(label);

      const meta = document.createElement('span');
      meta.className = 'mode-option-meta';
      meta.textContent = profile?.id === 'opencode'
        ? splitMode.detail
        : (mode.disabled ? i18n.t('agentMode.subagent') : '');
      button.appendChild(meta);

      agentModeOptionList.appendChild(button);
    });
  }

  function renderContextControls() {
    document.querySelectorAll('[data-context]').forEach((checkbox) => {
      checkbox.checked = Boolean(contextOptions[checkbox.dataset.context]);
    });
  }

  function renderComposer() {
    const profile = activeProfile();
    const canSend = Boolean(profile && profile.installed);
    const busy = Boolean(runningByProvider[activeId] || pendingByProvider[activeId]);
    const hasPrompt = input.value.trim().length > 0;
    const hasAttachments = promptAttachments.length > 0;
    const selectedAction = actionSelect.value || 'freeform';
    const missingSelection = actionRequiresSelection(selectedAction) && !hasSelectionContext();
    const missingCustomModel = activeModel()?.custom && !activeCustomModel(activeId);
    const canRunAction = hasPrompt || hasAttachments || selectedAction !== 'freeform';
    input.disabled = !canSend;
    sendBtn.disabled = !canSend || busy || !canRunAction || missingSelection || missingCustomModel;
    document.querySelectorAll('[data-action]').forEach((button) => {
      const action = button.dataset.action;
      if (action === 'openSettings') {
        button.disabled = false;
        button.title = '';
        return;
      }

      button.disabled = !canSend || busy || (actionRequiresSelection(action) && !hasSelectionContext());
      button.title = button.disabled && actionRequiresSelection(action)
        ? i18n.t('quick.missingSelection')
        : '';
    });
    actionSelect.disabled = !canSend || busy;
    providerSelect.disabled = visibleInstalledProfiles().length === 0 || busy;
    threadSelect.disabled = !activeId || busy;
    modelSelect.disabled = !canSend || busy;
    runtimeSelect.disabled = !canSend || busy;
    permissionSelect.disabled = !canSend || busy;
    agentModeSelect.disabled = !canSend || busy;
    modelOptionList?.querySelectorAll('.option-list-item').forEach((button) => {
      button.disabled = !canSend || busy;
    });
    runtimeOptionList?.querySelectorAll('.option-list-item').forEach((button) => {
      button.disabled = button.classList.contains('is-disabled') || !canSend || busy;
    });
    permissionOptionList?.querySelectorAll('.option-list-item').forEach((button) => {
      button.disabled = !canSend || busy;
    });
    input.placeholder = profilesLoading ? i18n.t('input.placeholderLoading') : canSend
      ? (profile?.id === 'claude' && !missingSelection
          ? i18n.t('claude.placeholder')
          : (missingSelection
              ? i18n.t('quick.missingSelection')
              : i18n.t(
                  selectedAction === 'freeform' ? 'input.placeholderProvider' : 'input.placeholderAction',
                  { provider: profile.name, action: actionLabel(selectedAction) }
                )))
      : i18n.t('input.placeholderDisabled');
    const running = Boolean(runningByProvider[activeId]);
    stopBtn.hidden = !running;
    sendBtn.hidden = running;
    stopBtn.classList.toggle('is-visible', running);
    sendBtn.classList.toggle('is-hidden', running);
    renderSlashPalette();
    scheduleComposerPopoverPosition();
  }

  function renderClaudeTerminalBanner() {
    if (!claudeTerminalBanner) {
      return;
    }

    claudeTerminalBanner.hidden = activeId !== 'claude' || claudeTerminalBannerDismissed;
  }

  function renderCodexTerminalBanner() {
    if (!codexTerminalBanner) {
      return;
    }

    const codexRunning = Boolean(runningByProvider.codex);
    const taskBoardVisible = visibleTasksForBoard().length > 0;
    codexTerminalBanner.hidden = activeId !== 'codex' || !codexRunning || taskBoardVisible;
  }

  function renderAll() {
    const profile = activeProfile();
    document.body.dataset.provider = activeId || 'none';
    setAccent(profile);
    renderClaudeTerminalBanner();
    renderCodexTerminalBanner();
    renderProviderSelect();
    renderProviderTabs();
    renderTaskBoard();
    renderThreadSelect();
    renderWorkflowMode();
    renderContextControls();
    renderProviderHint();
    renderContextSummaryLabel();
    renderContextBudget();
    renderOpenCodeSidebar();
    renderOpenCodeStatusDialog();
    renderMessages();
    renderAttachmentStrip();
    renderComposer();
    if (apiSettingsPage && !apiSettingsPage.hidden) {
      renderSettingsPage();
    }
  }

  function send(action, text, preferredWorkflowMode) {
    const finalText = (text || input.value || '').trim();
    const finalAttachments = promptAttachments.map(attachmentPayload);
    if (!finalText && finalAttachments.length === 0 && action === 'freeform') {
      input.focus();
      return;
    }
    if (actionRequiresSelection(action) && !hasSelectionContext()) {
      addMessage(activeId, 'error', i18n.t('quick.missingSelection'));
      return;
    }

    const profile = activeProfile();
    if (!profile?.installed) {
      addMessage(activeId, 'error', providerUnavailableMessage(profile));
      return;
    }

    if (!sendToProvider(
      activeId,
      action,
      finalText,
      preferredWorkflowMode || activeAgentModeId(activeId),
      finalAttachments
    )) {
      return;
    }

    input.value = '';
    input.style.height = 'auto';
    promptAttachments = [];
    renderAttachmentStrip();
  }

  function sendToProvider(providerId, action, text, preferredWorkflowMode, attachments) {
    const profile = profiles.find((item) => item.id === providerId);
    if (!profile || !profile.installed) {
      addMessage(providerId || activeId, 'error', providerUnavailableMessage(profile || providerId));
      return false;
    }
    if (runningByProvider[providerId] || pendingByProvider[providerId]) {
      return false;
    }

    const model = activeModel(profile);
    if (model?.custom && !activeCustomModel(providerId)) {
      if (providerId === activeId) {
        customModelInput.focus();
      }
      return false;
    }

    const task = createRunTask(providerId, action, text, preferredWorkflowMode);
    pendingTaskByProvider[providerId] = task.id;
    pendingByProvider[providerId] = true;
    pendingThreadByProvider[providerId] = activeThreadId(providerId);
    renderAll();

    vscode.postMessage({
      command: action === 'freeform' ? 'send' : 'quickAction',
      cliId: providerId,
      text,
      mode: 'agent',
      agentMode: preferredWorkflowMode || activeAgentModeId(providerId),
      model: activeModelId(providerId),
      customModel: activeCustomModel(providerId),
      runtime: activeRuntimeId(providerId),
      permissionMode: activePermissionId(providerId),
      action,
      attachments,
      conversationHistory: conversationHistoryForSend(providerId),
      contextOptions,
    });
    return true;
  }

  function addMessage(cliId, role, text, meta, running, threadId, attachments) {
    const thread = ensureThread(cliId, threadId);
    const conversation = thread?.messages || [];
    conversation.push({
      role,
      text,
      meta,
      running: Boolean(running),
      startedAt: running ? Date.now() : undefined,
      attachments: normalizeMessageAttachments(attachments),
    });
    touchThread(thread, role === 'user' ? text : undefined);
    persist();
    if (cliId === activeId) {
      renderMessages();
    }
    return { threadId: thread?.id || '', index: conversation.length - 1 };
  }

  function appendChunkText(current, chunk) {
    const normalized = normalizeMessageText(chunk);
    if (!normalized) {
      return current || '';
    }

    return `${current || ''}${normalized}`;
  }

  function ensureStreamTarget(message) {
    let target = streamTargets[message.sessionId];
    if (target) {
      return target;
    }

    const result = addMessage(
      message.cliId,
      message.stream === 'error' ? 'error' : 'assistant',
      '',
      undefined,
      true
    );
    target = { cliId: message.cliId, threadId: result.threadId, index: result.index, buffer: '' };
    streamTargets[message.sessionId] = target;
    return target;
  }

  function updateStream(message) {
    const target = ensureStreamTarget(message);
    if (message.thinking) {
      updateStreamThinking(message);
      if (!normalizeMessageText(message.text).trim()) {
        return;
      }
    }

    const item = ensureConversation(target.cliId, target.threadId)[target.index];
    if (!item) {
      return;
    }
    noteOpenCodeSessionId(message.cliId, target.threadId, message.openCodeSessionId);

    const buffered = `${target.buffer || item.text || ''}${normalizeMessageText(message.text)}`;
    const filtered = filterInternalPromptEcho(buffered);
    target.buffer = filtered.pending ? buffered : filtered.text;
    item.text = filtered.text;
    if (normalizeMessageText(message.text).trim()) {
      delete item.runningNotice;
    }
    if (message.stream === 'error') {
      item.role = 'error';
      updateTaskStatus(taskBySessionId[message.sessionId], { status: 'failed' });
    }
    persist();
    if (target.cliId === activeId && target.threadId === activeThreadId(activeId)) {
      renderMessages();
    }
  }

  function updateStreamThinking(message) {
    const target = ensureStreamTarget(message);
    const item = ensureConversation(target.cliId, target.threadId)[target.index];
    if (!item) {
      return;
    }

    noteOpenCodeSessionId(message.cliId, target.threadId, message.openCodeSessionId);
    item.thinking = appendChunkText(item.thinking, message.thinking);
    persist();
    if (target.cliId === activeId && target.threadId === activeThreadId(activeId)) {
      renderMessages();
    }
  }

  function updateSessionNotice(message) {
    const target = streamTargets[message.sessionId];
    if (!target) {
      return;
    }

    const item = ensureConversation(target.cliId, target.threadId)[target.index];
    if (!item || !item.running) {
      return;
    }

    item.runningNotice = normalizeMessageText(message.text);
    persist();
    if (target.cliId === activeId && target.threadId === activeThreadId(activeId)) {
      renderMessages();
    }
  }

  function markSessionEnded(message) {
    const target = streamTargets[message.sessionId];
    if (target) {
      noteOpenCodeSessionId(message.cliId, target.threadId, message.openCodeSessionId);
    }
    updateTaskStatus(taskBySessionId[message.sessionId], {
      status: Number(message.exitCode) === 0 ? 'completed' : 'failed',
    });
    delete taskBySessionId[message.sessionId];
    if (target) {
      const item = ensureConversation(target.cliId, target.threadId)[target.index];
      if (item) {
        item.running = false;
        delete item.runningNotice;
        if (!normalizeMessageText(item.text).trim()) {
          ensureConversation(target.cliId, target.threadId).splice(target.index, 1);
        }
      }
      delete streamTargets[message.sessionId];
    }

    runningByProvider[message.cliId] = false;
    pendingByProvider[message.cliId] = false;
    delete pendingThreadByProvider[message.cliId];
    if (Number(message.exitCode) !== 0) {
      addMessage(
        message.cliId,
        'system',
        i18n.t('message.runFinishedCode', { code: String(message.exitCode) }),
        undefined,
        false,
        target?.threadId
      );
    }
    persist();
    renderAll();
  }

  function quickActionText(action) {
    switch (action) {
      case 'explainSelection':
        return i18n.t('quick.explain.text');
      case 'reviewFile':
        return i18n.t('quick.review.text');
      case 'generateTests':
        return i18n.t('quick.tests.text');
      case 'refactorSelection':
        return i18n.t('quick.refactor.text');
      default:
        return '';
    }
  }

  function agentModeLabel(value) {
    const profile = activeProfile();
    const mode = agentModesFor(profile).find((item) => item.id === value);
    return mode?.label || value || i18n.t('agentMode.label');
  }

  function summarizeRequestContext(summary) {
    if (!summary) {
      return undefined;
    }

    const parts = [];
    if (summary.activeFile) {
      parts.push(summary.activeFile);
    }
    if (summary.selection) {
      parts.push(summary.selection);
    }
    if (summary.diagnostics) {
      parts.push(i18n.t('context.problemsValue', { count: String(summary.diagnostics) }));
    }

    return parts.length ? `${i18n.t('context.prefix')}: ${parts.join(', ')}` : undefined;
  }

  function appendMessageThinking(bubble, text) {
    const normalized = normalizeMessageText(text);
    if (!normalized.trim()) {
      return;
    }

    const thinking = document.createElement('div');
    thinking.className = 'message-thinking';

    const label = document.createElement('div');
    label.className = 'message-thinking-label';
    label.textContent = `${i18n.t('message.thinking')}:`;
    thinking.appendChild(label);

    const body = document.createElement('div');
    body.className = 'message-thinking-body';
    body.textContent = normalized;
    thinking.appendChild(body);

    bubble.appendChild(thinking);
  }

  function renderMarkdownLite(container, text) {
    const lines = preprocessAssistantMessageLines(String(text || '').split('\n'));
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();

      const structuralTag = parseAssistantMarkupTag(trimmed);
      if (structuralTag) {
        if (!structuralTag.closing && shouldShowAssistantSectionLabel(lines, index, structuralTag.name)) {
          appendAssistantSectionLabel(container, structuralTag.name);
        }
        index += 1;
        continue;
      }

      const lineParts = splitAssistantMarkupTags(line);
      if (lineParts) {
        appendAssistantMarkupParts(container, lineParts);
        index += 1;
        continue;
      }

      if (trimmed.startsWith('```')) {
        const language = trimmed.replace(/^```/, '').trim();
        const codeLines = [];
        index += 1;

        while (index < lines.length && !lines[index].trim().startsWith('```')) {
          codeLines.push(lines[index]);
          index += 1;
        }

        appendCodeBlock(container, codeLines.join('\n'), language);
        index += index < lines.length ? 1 : 0;
        continue;
      }

      if (isTableStart(lines, index)) {
        const tableLines = [lines[index], lines[index + 1]];
        index += 2;
        while (index < lines.length && isTableRow(lines[index])) {
          tableLines.push(lines[index]);
          index += 1;
        }
        appendTable(container, tableLines, 'pipe');
        continue;
      }

      const tabbedTable = readTabbedTable(lines, index);
      if (tabbedTable) {
        appendTable(container, tabbedTable.lines, tabbedTable.kind);
        index += tabbedTable.lines.length;
        continue;
      }

      const fileResultBlock = readFileResultBlock(lines, index);
      if (fileResultBlock) {
        appendFileResultList(container, fileResultBlock.items);
        index += fileResultBlock.length;
        continue;
      }

      const sectionHeading = parseAssistantSectionHeading(trimmed);
      if (sectionHeading) {
        if (shouldShowAssistantSectionLabel(lines, index, sectionHeading)) {
          appendAssistantSectionLabel(container, sectionHeading);
        }
        index += 1;
        continue;
      }

      appendMarkdownLine(container, line);
      index += 1;
    }
  }

  function markdownToCopyPlainText(text) {
    const lines = preprocessAssistantMessageLines(normalizeMessageText(text).split('\n'));
    const output = [];
    let inCodeBlock = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (parseAssistantMarkupTag(trimmed)) {
        continue;
      }

      const lineParts = splitAssistantMarkupTags(line);
      if (lineParts) {
        const plainText = lineParts
          .filter((part) => Object.prototype.hasOwnProperty.call(part, 'text'))
          .map((part) => part.text)
          .join('')
          .trim();
        if (plainText) {
          output.push(stripInlineMarkdown(plainText));
        }
        continue;
      }

      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }

      if (inCodeBlock) {
        output.push(line);
        continue;
      }

      if (!trimmed) {
        output.push('');
        continue;
      }

      if (isTableSeparator(trimmed) || /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        continue;
      }

      const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
      if (heading) {
        output.push(stripInlineMarkdown(heading[2]));
        continue;
      }

      const sectionHeading = parseAssistantSectionHeading(trimmed);
      if (sectionHeading) {
        output.push(assistantSectionLabel(sectionHeading));
        continue;
      }

      const quote = /^>\s?(.*)$/.exec(trimmed);
      if (quote) {
        output.push(stripInlineMarkdown(quote[1]));
        continue;
      }

      const task = /^[-*]\s+\[([ xX])\]\s+(.+)$/.exec(trimmed);
      if (task) {
        output.push(`${task[1].trim() ? '✓' : '□'} ${stripInlineMarkdown(task[2])}`);
        continue;
      }

      const bullet = /^[-*•]\s+(.+)$/.exec(trimmed);
      if (bullet) {
        output.push(`• ${stripInlineMarkdown(bullet[1])}`);
        continue;
      }

      const numbered = /^(\d+)\.\s+(.+)$/.exec(trimmed);
      if (numbered) {
        output.push(`${numbered[1]}. ${stripInlineMarkdown(numbered[2])}`);
        continue;
      }

      if (isTableRow(line)) {
        output.push(splitTableCells(line).map(stripInlineMarkdown).join('\t'));
        continue;
      }

      if (isTabbedTableRow(line)) {
        output.push(splitTabbedCells(line).map(stripInlineMarkdown).join('\t'));
        continue;
      }

      output.push(stripInlineMarkdown(line));
    }

    return output.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  }

  function stripInlineMarkdown(text) {
    return String(text || '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1');
  }

  function renderedMessagePlainText(container) {
    if (!container) {
      return '';
    }

    return Array.from(container.children)
      .map(renderedMessageLineText)
      .join('\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
  }

  function renderedMessageLineText(node) {
    if (!(node instanceof HTMLElement)) {
      return node?.textContent || '';
    }

    if (node.classList.contains('md-spacer') || node.classList.contains('md-rule')) {
      return '';
    }

    if (node.classList.contains('md-code-wrap')) {
      return node.querySelector('.md-code-block')?.textContent || '';
    }

    if (node.classList.contains('md-table-wrap')) {
      return Array.from(node.querySelectorAll('tr'))
        .map((row) => Array.from(row.children).map((cell) => cell.textContent || '').join('\t'))
        .join('\n');
    }

    if (node.classList.contains('md-file-list')) {
      return Array.from(node.querySelectorAll('.md-file-row'))
        .map((row) => {
          const path = row.querySelector('.md-file-path')?.textContent || '';
          const detail = row.querySelector('.md-file-detail')?.textContent || '';
          return [path, detail].filter(Boolean).join(' - ');
        })
        .join('\n');
    }

    if (node.classList.contains('md-list-item') || node.classList.contains('md-numbered-item')) {
      const marker = node.querySelector('.md-marker')?.textContent || '';
      const content = Array.from(node.children)
        .filter((child) => !child.classList.contains('md-marker'))
        .map((child) => child.textContent || '')
        .join('');
      return [marker, content].filter(Boolean).join(' ');
    }

    return node.textContent || '';
  }

  function appendMarkdownLine(container, line) {
    const trimmed = line.trim();
    if (!trimmed) {
      const spacer = document.createElement('div');
      spacer.className = 'md-spacer';
      container.appendChild(spacer);
      return;
    }

    const structuralTag = parseAssistantMarkupTag(trimmed);
    if (structuralTag) {
      if (!structuralTag.closing) {
        appendAssistantSectionLabel(container, structuralTag.name);
      }
      return;
    }

    const lineParts = splitAssistantMarkupTags(line);
    if (lineParts) {
      appendAssistantMarkupParts(container, lineParts);
      return;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const node = document.createElement('div');
      node.className = `md-heading level-${heading[1].length}`;
      appendInlineMarkdown(node, normalizeAssistantDisplayLine(heading[2]));
      container.appendChild(node);
      return;
    }

    const sectionHeading = parseAssistantSectionHeading(trimmed);
    if (sectionHeading) {
      appendAssistantSectionLabel(container, sectionHeading);
      return;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      const rule = document.createElement('div');
      rule.className = 'md-rule';
      container.appendChild(rule);
      return;
    }

    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      const node = document.createElement('div');
      node.className = 'md-blockquote';
      appendInlineMarkdown(node, normalizeAssistantDisplayLine(quote[1]));
      container.appendChild(node);
      return;
    }

    const task = /^[-*]\s+\[([ xX])\]\s+(.+)$/.exec(trimmed);
    if (task) {
      appendListItem(container, task[1].trim() ? '✓' : '□', normalizeAssistantDisplayLine(task[2]), 'md-list-item');
      return;
    }

    const bullet = /^[-*•]\s+(.+)$/.exec(trimmed);
    if (bullet) {
      const fileResult = parseFileResultLine(bullet[1]);
      if (fileResult) {
        appendFileResultList(container, [fileResult]);
        return;
      }
      appendListItem(container, '•', normalizeAssistantDisplayLine(bullet[1]), 'md-list-item');
      return;
    }

    const numbered = /^(\d+)\.\s+(.+)$/.exec(trimmed);
    if (numbered) {
      appendListItem(container, `${numbered[1]}.`, normalizeAssistantDisplayLine(numbered[2]), 'md-numbered-item');
      return;
    }

    const paragraph = document.createElement('div');
    paragraph.className = 'md-paragraph';
    appendInlineMarkdown(paragraph, normalizeAssistantDisplayLine(line));
    container.appendChild(paragraph);
  }

  function preprocessAssistantMessageLines(lines) {
    const sourceLines = lines || [];
    const hasInternalSignals = sourceLines.some((line, index) => (
      isInternalAnalysisHeading(line, sourceLines, index)
        || isInternalAnalysisField(line)
        || isAssistantToolNoiseLine(line)
    ));

    const cleaned = [];
    let skippingInternalField = false;

    sourceLines.forEach((line, index) => {
      const source = stripHiddenAssistantInlineMarkup(line);
      const trimmed = source.trim();
      const structuralTag = parseAssistantMarkupTag(trimmed);

      if (skippingInternalField) {
        if (!trimmed) {
          skippingInternalField = false;
          return;
        }
        if (!structuralTag && !parseAssistantSectionHeading(trimmed)) {
          return;
        }
        skippingInternalField = false;
      }

      if (isInternalAnalysisHeading(source, sourceLines, index)
        || isAssistantToolNoiseLine(source)
        || (hasInternalSignals && isAssistantProgressNoiseLine(source))) {
        return;
      }

      if (isInternalAnalysisField(source)) {
        skippingInternalField = true;
        return;
      }

      cleaned.push(source);
    });

    return compactAssistantMessageLines(cleaned);
  }

  function compactAssistantMessageLines(lines) {
    const compacted = [];
    let previousBlank = true;

    (lines || []).forEach((line) => {
      const isBlank = !String(line || '').trim();
      if (isBlank) {
        if (!previousBlank) {
          compacted.push('');
        }
        previousBlank = true;
        return;
      }
      compacted.push(line);
      previousBlank = false;
    });

    while (compacted.length && !String(compacted[compacted.length - 1] || '').trim()) {
      compacted.pop();
    }

    return compacted;
  }

  function isInternalAnalysisHeading(line, lines, index) {
    const trimmed = String(line || '').trim();
    const tag = parseAssistantMarkupTag(trimmed);
    const section = tag?.name || parseAssistantSectionHeading(trimmed);
    if (section !== 'analysis') {
      return false;
    }

    return (lines || []).slice(index + 1, index + 5).some(isInternalAnalysisField);
  }

  function isInternalAnalysisField(line) {
    return /^(?:Literal Request|Actual Need|Success Looks Like|字面请求|实际需求|成功标准)\s*:/i.test(normalizeAssistantDiagnosticLine(line));
  }

  function isAssistantToolNoiseLine(line) {
    const source = normalizeAssistantDiagnosticLine(line);
    return /\bpermission requested:\s*.+auto-?rejecting\b/i.test(source)
      || /^!?\s*permission requested:\s*(?:read|write)\b/i.test(source);
  }

  function isAssistantProgressNoiseLine(line) {
    const source = normalizeAssistantDiagnosticLine(line);
    return /^(?:I(?:'|’)ll start\b|I will start\b|Let me\b|Now let me\b|Let me now\b|Good initial sweep\b|The TypeScript check returned no output\b|Now I have all the data\b|Here(?:'|’)s the comprehensive\b|后台分析任务已并行启动|项目规模不小。先并行跑|找到项目了|让我(?:先|进一步|深入|直接|并行))/i.test(source);
  }

  function normalizeAssistantDiagnosticLine(line) {
    return normalizeMessageText(line)
      .trim()
      .replace(/\*\*/g, '')
      .replace(/^[-*•]\s+/, '');
  }

  function stripHiddenAssistantInlineMarkup(line) {
    return normalizeMessageText(line).replace(/<analysis>[\s\S]*?<\/analysis>/gi, '').trimEnd();
  }

  function shouldHideAssistantSection(name) {
    return false;
  }

  function normalizeAssistantDisplayLine(line) {
    return normalizeMessageText(line)
      .replace(/([A-Za-z0-9])([\u3400-\u9fff])/g, '$1 $2')
      .replace(/([\u3400-\u9fff])([A-Za-z0-9])/g, '$1 $2')
      .replace(/([.!?])(?=[A-Z])/g, '$1 ');
  }

  function parseAssistantMarkupTag(line) {
    const source = String(line || '').trim();
    const tag = /^<\/?([a-z][\w-]*)>$/i.exec(source);
    if (!tag) {
      return null;
    }

    const name = tag[1].toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(assistantSectionLabels(), name)) {
      return null;
    }

    return { name, closing: source.startsWith('</') };
  }

  function splitAssistantMarkupTags(line) {
    const source = String(line || '');
    const pattern = /<\/?([a-z][\w-]*)>/gi;
    const parts = [];
    let lastIndex = 0;
    let found = false;
    let match;

    while ((match = pattern.exec(source)) !== null) {
      const tag = parseAssistantMarkupTag(match[0]);
      if (!tag) {
        continue;
      }

      found = true;
      if (match.index > lastIndex) {
        parts.push({ text: source.slice(lastIndex, match.index) });
      }
      parts.push({ tag });
      lastIndex = pattern.lastIndex;
    }

    if (!found) {
      return null;
    }

    if (lastIndex < source.length) {
      parts.push({ text: source.slice(lastIndex) });
    }

    return parts;
  }

  function appendAssistantMarkupParts(container, parts) {
    parts.forEach((part) => {
      if (part.tag) {
        if (!part.tag.closing && !shouldHideAssistantSection(part.tag.name)) {
          appendAssistantSectionLabel(container, part.tag.name);
        }
        return;
      }

      if (normalizeMessageText(part.text).trim()) {
        appendMarkdownLine(container, part.text);
      }
    });
  }

  function parseAssistantSectionHeading(line) {
    const key = String(line || '')
      .trim()
      .replace(/^[#>*\-\s•]+/, '')
      .replace(/\*\*/g, '')
      .replace(/[:：]+$/, '')
      .toLowerCase()
      .replace(/[^\w]+/g, '_')
      .replace(/^_+|_+$/g, '');

    return Object.prototype.hasOwnProperty.call(assistantSectionLabels(), key) ? key : null;
  }

  function shouldShowAssistantSectionLabel(lines, index, name) {
    if (shouldHideAssistantSection(name)) {
      return false;
    }

    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const source = normalizeMessageText(lines[nextIndex]).trim();
      if (!source) {
        continue;
      }

      const tag = parseAssistantMarkupTag(source);
      if (tag) {
        return tag.closing ? tag.name !== name : false;
      }

      if (parseAssistantSectionHeading(source)) {
        return false;
      }

      if (isInternalAnalysisField(source) || isAssistantToolNoiseLine(source) || isAssistantProgressNoiseLine(source)) {
        continue;
      }

      return true;
    }

    return false;
  }

  function appendAssistantSectionLabel(container, name) {
    const label = document.createElement('div');
    label.className = 'md-section-label';
    label.textContent = assistantSectionLabel(name);
    container.appendChild(label);
  }

  function assistantSectionLabel(name) {
    return assistantSectionLabels()[name] || name.replace(/[_-]+/g, ' ');
  }

  function assistantSectionLabels() {
    const labels = {
      en: {
        analysis: 'Analysis',
        results: 'Results',
        files: 'Files',
        answer: 'Answer',
        next_steps: 'Next steps',
        root_cause: 'Root cause',
        check_results: 'Check results',
        summary: 'Summary',
      },
      'zh-CN': {
        analysis: '分析',
        results: '结果',
        files: '文件',
        answer: '答复',
        next_steps: '下一步',
        root_cause: '根因',
        check_results: '检查结果',
        summary: '总结',
      },
    };

    return labels[i18n.locale] || labels.en;
  }

  function isTableStart(lines, index) {
    return isTableRow(lines[index]) && isTableSeparator(lines[index + 1]);
  }

  function readTabbedTable(lines, startIndex) {
    if (!isTabbedTableRow(lines[startIndex]) || !isTabbedTableRow(lines[startIndex + 1])) {
      return null;
    }

    const tableLines = [];
    let index = startIndex;
    while (index < lines.length && isTabbedTableRow(lines[index])) {
      tableLines.push(lines[index]);
      index += 1;
    }

    return { lines: tableLines, kind: 'tabbed' };
  }

  function isTabbedTableRow(line) {
    if (typeof line !== 'string' || !line.includes('\t')) {
      return false;
    }

    return splitTabbedCells(line).length >= 2;
  }

  function splitTabbedCells(line) {
    return String(line || '')
      .split('\t')
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0);
  }

  function readFileResultBlock(lines, startIndex) {
    const items = [];
    let index = startIndex;

    while (index < lines.length) {
      const trimmed = String(lines[index] || '').trim();
      const bullet = /^[-*•]\s+(.+)$/.exec(trimmed);
      if (!bullet) {
        break;
      }

      const fileResult = parseFileResultLine(bullet[1]);
      if (!fileResult) {
        break;
      }

      items.push(fileResult);
      index += 1;
    }

    return items.length ? { items, length: index - startIndex } : null;
  }

  function isTableRow(line) {
    return typeof line === 'string' && line.includes('|') && line.replace(/\|/g, '').trim();
  }

  function isTableSeparator(line) {
    if (!isTableRow(line)) {
      return false;
    }

    return splitTableCells(line).every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
  }

  function splitTableCells(line) {
    const cells = line.trim().split('|');
    if (cells[0] === '') {
      cells.shift();
    }
    if (cells[cells.length - 1] === '') {
      cells.pop();
    }
    return cells.map((cell) => cell.trim());
  }

  function appendTable(container, lines, kind = 'pipe') {
    const splitCells = kind === 'tabbed' ? splitTabbedCells : splitTableCells;
    const headers = splitCells(lines[0]);
    const rows = lines.slice(kind === 'tabbed' ? 1 : 2).map(splitCells);
    const wrap = document.createElement('div');
    wrap.className = 'md-table-wrap';

    const table = document.createElement('table');
    table.className = 'md-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headers.forEach((header) => {
      const th = document.createElement('th');
      appendInlineMarkdown(th, header);
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      headers.forEach((_, cellIndex) => {
        const td = document.createElement('td');
        appendInlineMarkdown(td, row[cellIndex] || '');
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  function appendListItem(container, marker, text, className) {
    const item = document.createElement('div');
    item.className = className;

    const markerNode = document.createElement('span');
    markerNode.className = 'md-marker';
    markerNode.textContent = marker;
    item.appendChild(markerNode);

    const content = document.createElement('span');
    appendInlineMarkdown(content, text);
    item.appendChild(content);

    container.appendChild(item);
  }

  function parseFileResultLine(text) {
    const source = normalizeMessageText(text).trim();
    const withDetail = /^((?:\/|~\/|\.\.?\/|[\w.-]+\/).+?)\s(?:[-–—])\s(.+)$/.exec(source);
    const withInlineStats = /^((?:\/|~\/|\.\.?\/|[\w.-]+\/).+?)\s+((?:\+\d+|-{1}\d+)(?:\s+(?:\+\d+|-{1}\d+))*)$/.exec(source);
    const path = (withDetail ? withDetail[1] : withInlineStats ? withInlineStats[1] : source).trim();
    const detail = (withDetail ? withDetail[2] : withInlineStats ? withInlineStats[2] : '').trim();
    if (!/^(?:\/|~\/|\.\.?\/|[\w.-]+\/).+/.test(path)) {
      return null;
    }

    const stats = parseFileResultStats(detail);
    return {
      path,
      detail,
      additions: stats.additions,
      deletions: stats.deletions,
    };
  }

  function parseFileResultStats(detail) {
    const add = /(?:^|\s)\+(\d+)\b/.exec(detail);
    const remove = /(?:^|\s)-(\d+)\b/.exec(detail);
    return {
      additions: add ? Number(add[1]) : 0,
      deletions: remove ? Number(remove[1]) : 0,
    };
  }

  function compactFilePathForDisplay(path) {
    const source = normalizeMessageText(path).replace(/\\/g, '/');
    const workspaceIndex = source.indexOf('/src/');
    if (workspaceIndex >= 0) {
      return source.slice(workspaceIndex + 1);
    }

    const parts = source.split('/').filter(Boolean);
    if (parts.length <= 3) {
      return source;
    }

    return `.../${parts.slice(-3).join('/')}`;
  }

  function appendFileResultList(container, fileResults) {
    const list = document.createElement('div');
    list.className = 'md-file-list';

    const summary = document.createElement('div');
    summary.className = 'md-file-summary';

    const icon = document.createElement('span');
    icon.className = 'md-file-header-icon';
    icon.innerHTML = FILE_CARD_ICON_SVG;
    summary.appendChild(icon);

    const summaryBody = document.createElement('div');
    summaryBody.className = 'md-file-summary-body';

    const summaryTitle = document.createElement('div');
    summaryTitle.className = 'md-file-summary-title';
    summaryTitle.textContent = i18n.t('fileCard.edited', {
      count: String(fileResults.length),
      fileLabel: fileCardFileLabel(fileResults.length),
    });
    summaryBody.appendChild(summaryTitle);

    const summaryMeta = document.createElement('div');
    summaryMeta.className = 'md-file-summary-meta';
    appendFileStats(summaryMeta, totalFileStats(fileResults), 'md-file-summary-stats');
    summaryBody.appendChild(summaryMeta);
    summary.appendChild(summaryBody);

    const actions = document.createElement('div');
    actions.className = 'md-file-actions';
    actions.appendChild(createFileCardActionButton('undo', i18n.t('fileCard.undo'), '↶'));
    actions.appendChild(createFileCardActionButton('review', i18n.t('fileCard.review')));
    summary.appendChild(actions);
    list.appendChild(summary);

    fileResults.slice(0, FILE_CARD_COLLAPSE_LIMIT).forEach((fileResult) => {
      list.appendChild(createFileResultRow(fileResult));
    });

    const hiddenResults = fileResults.slice(FILE_CARD_COLLAPSE_LIMIT);
    hiddenResults.forEach((fileResult) => {
      const row = createFileResultRow(fileResult);
      row.classList.add('is-hidden');
      row.hidden = true;
      list.appendChild(row);
    });

    if (hiddenResults.length > 0) {
      const showMore = document.createElement('button');
      showMore.className = 'md-file-show-more';
      showMore.type = 'button';
      showMore.dataset.fileCardShowMore = 'true';
      showMore.textContent = i18n.t('fileCard.showMore', {
        count: String(hiddenResults.length),
        fileLabel: fileCardFileLabel(hiddenResults.length),
      });
      list.appendChild(showMore);
    }

    container.appendChild(list);
  }

  function createFileCardActionButton(action, label, suffix = '') {
    const button = document.createElement('button');
    button.className = 'md-file-action';
    button.type = 'button';
    button.dataset.fileCardAction = action;
    button.textContent = suffix ? `${label} ${suffix}` : label;
    return button;
  }

  function fileCardFileLabel(count) {
    return i18n.t(count === 1 ? 'fileCard.file' : 'fileCard.files');
  }

  function totalFileStats(fileResults) {
    return fileResults.reduce((total, fileResult) => ({
      additions: total.additions + (fileResult.additions || 0),
      deletions: total.deletions + (fileResult.deletions || 0),
    }), { additions: 0, deletions: 0 });
  }

  function createFileResultRow(fileResult) {
    const hasDetail = Boolean(fileResult.detail && !isFileStatsOnly(fileResult.detail));
    const row = document.createElement(hasDetail ? 'details' : 'div');
    row.className = 'md-file-row';
    if (hasDetail) {
      row.dataset.collapsible = 'true';
    }

    const summary = document.createElement(hasDetail ? 'summary' : 'div');
    summary.className = 'md-file-row-summary';

    const path = document.createElement('code');
    path.className = 'md-file-path';
    path.textContent = compactFilePathForDisplay(fileResult.path);
    path.title = fileResult.path;
    summary.appendChild(path);

    appendFileStats(summary, fileResult, 'md-file-row-stats');

    if (hasDetail) {
      const chevron = document.createElement('span');
      chevron.className = 'md-file-chevron';
      chevron.textContent = '⌄';
      summary.appendChild(chevron);
    }

    row.appendChild(summary);

    if (hasDetail) {
      const detail = document.createElement('div');
      detail.className = 'md-file-detail';
      appendInlineMarkdown(detail, normalizeAssistantDisplayLine(fileResult.detail));
      row.appendChild(detail);
    }
    return row;
  }

  function appendFileStats(container, fileResult, className) {
    if (!fileResult.additions && !fileResult.deletions) {
      return;
    }

    const stats = document.createElement('span');
    stats.className = className;

    if (fileResult.additions) {
      const additions = document.createElement('span');
      additions.className = 'md-file-additions';
      additions.textContent = `+${fileResult.additions}`;
      stats.appendChild(additions);
    }

    if (fileResult.deletions) {
      const deletions = document.createElement('span');
      deletions.className = 'md-file-deletions';
      deletions.textContent = `-${fileResult.deletions}`;
      stats.appendChild(deletions);
    }

    container.appendChild(stats);
  }

  function isFileStatsOnly(detail) {
    return /^(?:(?:\+\d+|-\d+)\s*)+$/.test(normalizeMessageText(detail).trim());
  }

  function revealFileCardRows(button) {
    const card = button.closest('.md-file-list');
    if (!card) {
      return;
    }

    card.querySelectorAll('.md-file-row.is-hidden').forEach((row) => {
      row.classList.remove('is-hidden');
      row.hidden = false;
    });
    button.remove();
  }

  function fileCardReviewPrompt() {
    return i18n.t('fileCard.reviewPrompt');
  }

  function appendCodeBlock(container, code, language) {
    const wrap = document.createElement('div');
    wrap.className = 'md-code-wrap';
    const normalizedLanguage = normalizeCodeLanguage(language);

    if (language) {
      const label = document.createElement('div');
      label.className = 'md-code-label';
      label.textContent = language;
      wrap.appendChild(label);
    }

    const pre = document.createElement('pre');
    pre.className = 'md-code-block';
    if (normalizedLanguage) {
      pre.classList.add(`language-${normalizedLanguage}`);
    }
    appendHighlightedCode(pre, code, normalizedLanguage);
    wrap.appendChild(pre);
    container.appendChild(wrap);
  }

  function normalizeCodeLanguage(language) {
    const raw = String(language || '').trim().toLowerCase().replace(/[{}]/g, '');
    if (!raw) {
      return '';
    }

    const aliases = {
      javascript: 'js',
      typescript: 'ts',
      jsonc: 'json',
      bash: 'shell',
      sh: 'shell',
      zsh: 'shell',
      shellscript: 'shell',
      patch: 'diff',
      xml: 'html',
      html: 'html',
      css: 'css',
      scss: 'css',
    };
    return aliases[raw] || raw.replace(/[^a-z0-9+#-]/g, '');
  }

  function appendHighlightedCode(container, code, language) {
    const source = String(code || '');
    if (!source) {
      return;
    }

    if (language === 'diff') {
      appendDiffHighlightedCode(container, source);
      return;
    }

    const patterns = codeHighlightPatterns(language);
    if (patterns.length === 0) {
      container.appendChild(document.createTextNode(source));
      return;
    }

    let index = 0;
    let plainStart = 0;
    while (index < source.length) {
      let token = null;
      for (const pattern of patterns) {
        pattern.regex.lastIndex = index;
        const match = pattern.regex.exec(source);
        if (match && match.index === index && match[0]) {
          token = { className: pattern.className, text: match[0] };
          break;
        }
      }

      if (!token) {
        index += 1;
        continue;
      }

      if (plainStart < index) {
        container.appendChild(document.createTextNode(source.slice(plainStart, index)));
      }
      appendCodeToken(container, token.className, token.text);
      index += token.text.length;
      plainStart = index;
    }

    if (plainStart < source.length) {
      container.appendChild(document.createTextNode(source.slice(plainStart)));
    }
  }

  function appendCodeToken(container, className, text) {
    const token = document.createElement('span');
    token.className = `md-token ${className}`;
    token.textContent = text;
    container.appendChild(token);
  }

  function codeHighlightPatterns(language) {
    const jsKeywords =
      'abstract|as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|if|implements|import|in|instanceof|interface|let|new|of|private|protected|public|readonly|return|static|super|switch|this|throw|try|type|typeof|var|void|while|with|yield';

    if (['js', 'jsx', 'ts', 'tsx'].includes(language)) {
      return [
        { className: 'comment', regex: /\/\*[\s\S]*?\*\/|\/\/[^\n]*/y },
        { className: 'string', regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/y },
        { className: 'keyword', regex: new RegExp(`\\b(?:${jsKeywords})\\b`, 'y') },
        { className: 'constant', regex: /\b(?:true|false|null|undefined|NaN|Infinity)\b/y },
        { className: 'number', regex: /\b(?:0x[\da-f]+|\d+(?:\.\d+)?)\b/iy },
        { className: 'function', regex: /\b[A-Za-z_$][\w$]*(?=\s*\()/y },
      ];
    }

    if (language === 'json') {
      return [
        { className: 'property', regex: /"(?:\\.|[^"\\])*"(?=\s*:)/y },
        { className: 'string', regex: /"(?:\\.|[^"\\])*"/y },
        { className: 'constant', regex: /\b(?:true|false|null)\b/y },
        { className: 'number', regex: /-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/iy },
      ];
    }

    if (language === 'shell') {
      return [
        { className: 'comment', regex: /#[^\n]*/y },
        { className: 'string', regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y },
        { className: 'variable', regex: /\$\{[^}]+\}|\$[A-Za-z_][\w]*/y },
        { className: 'keyword', regex: /\b(?:case|cd|do|done|echo|elif|else|esac|export|fi|for|function|git|if|in|npm|pnpm|then|while|yarn)\b/y },
        { className: 'number', regex: /--?[\w-]+/y },
      ];
    }

    if (language === 'css') {
      return [
        { className: 'comment', regex: /\/\*[\s\S]*?\*\//y },
        { className: 'property', regex: /--?[\w-]+(?=\s*:)/y },
        { className: 'string', regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y },
        { className: 'number', regex: /#[\da-f]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms)?\b/iy },
        { className: 'keyword', regex: /\b(?:auto|block|flex|grid|inline|none|relative|absolute|fixed|sticky|solid|transparent|var)\b/y },
      ];
    }

    if (language === 'html') {
      return [
        { className: 'comment', regex: /<!--[\s\S]*?-->/y },
        { className: 'keyword', regex: /<\/?[A-Za-z][\w:-]*/y },
        { className: 'property', regex: /\s[A-Za-z_:][\w:.-]*(?=\=)/y },
        { className: 'string', regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y },
      ];
    }

    return [];
  }

  function appendDiffHighlightedCode(container, code) {
    const lines = String(code || '').split('\n');
    lines.forEach((line, index) => {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        appendCodeToken(container, 'diff-add', line);
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        appendCodeToken(container, 'diff-remove', line);
      } else if (line.startsWith('@@')) {
        appendCodeToken(container, 'diff-hunk', line);
      } else {
        container.appendChild(document.createTextNode(line));
      }

      if (index < lines.length - 1) {
        container.appendChild(document.createTextNode('\n'));
      }
    });
  }

  function appendInlineMarkdown(container, text) {
    const pattern = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g;
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }

      const token = match[0];
      if (token.startsWith('[')) {
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
        const anchor = document.createElement('a');
        anchor.className = 'md-link';
        anchor.textContent = link?.[1] || token;
        anchor.href = link?.[2] || '#';
        anchor.title = link?.[2] || '';
        container.appendChild(anchor);
      } else if (token.startsWith('**')) {
        const strong = document.createElement('strong');
        strong.className = 'md-strong';
        strong.textContent = token.slice(2, -2);
        container.appendChild(strong);
      } else {
        const code = document.createElement('code');
        code.className = 'md-code';
        code.textContent = token.slice(1, -1);
        container.appendChild(code);
      }

      lastIndex = pattern.lastIndex;
    }

    if (lastIndex < text.length) {
      container.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }

  function selectedAction() {
    return actionSelect.value || 'freeform';
  }

  function sendSelectedAction() {
    const slash = parseSlashInput(input.value);
    if (slash) {
      executeSlashCommand(slashMatches[slashActiveIndex]);
      return;
    }

    const action = selectedAction();
    send(action, input.value || quickActionText(action));
  }

  sendBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    sendSelectedAction();
  });

  newChatBtn.addEventListener('click', () => {
    startNewThread(activeId);
  });

  deleteThreadBtn.addEventListener('click', () => {
    if (!window.confirm(i18n.t('history.deleteConfirm'))) {
      return;
    }

    const threadId = activeThreadId(activeId);
    const threads = ensureThreadList(activeId);
    const index = threads.findIndex((thread) => thread.id === threadId);
    if (index >= 0) {
      threads.splice(index, 1);
    }

    const next = threads.sort((a, b) => b.updatedAt - a.updatedAt)[0] || createThread(activeId);
    if (!threads.includes(next)) {
      threads.push(next);
    }
    setActiveThread(activeId, next);
    persist();
    renderAll();
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 104)}px`;
    renderComposer();
  });

  input.addEventListener('paste', (event) => {
    const imageFiles = clipboardImageFiles({
      items: event.clipboardData?.items,
      files: event.clipboardData?.files,
    });
    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    void addImageFiles(imageFiles);
  });

  input.addEventListener('keydown', (event) => {
    if (slashPaletteVisible()) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveSlashSelection(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveSlashSelection(-1);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        hideSlashPalette();
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        executeSlashCommand(slashMatches[slashActiveIndex]);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendSelectedAction();
    }
  });

  slashPalette?.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });

  slashPalette?.addEventListener('click', (event) => {
    const button = event.target.closest('.slash-command');
    if (!button) {
      return;
    }

    const command = slashMatches.find((item) => item.name === button.dataset.command);
    executeSlashCommand(command);
  });

  stopBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'stop', cliId: activeId });
  });

  codexTerminalStop.addEventListener('click', () => {
    vscode.postMessage({ command: 'stop', cliId: activeId });
  });

  codexTerminalOpen.addEventListener('click', () => {
    vscode.postMessage({ command: 'openProviderExtension', cliId: activeId });
  });

  attachImageBtn?.addEventListener('click', () => {
    imageFileInput?.click();
  });

  claudeContextBtn.addEventListener('click', () => {
    executeLocalSlashCommand({ local: 'context' });
    input.focus();
  });

  claudeTerminalDismiss.addEventListener('click', () => {
    claudeTerminalBannerDismissed = true;
    persist();
    renderClaudeTerminalBanner();
  });

  imageFileInput?.addEventListener('change', () => {
    void addImageFiles(imageFileInput.files);
    imageFileInput.value = '';
  });

  attachmentStrip?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-attachment-id]');
    if (!button) {
      return;
    }

    promptAttachments = promptAttachments.filter((attachment) => attachment.id !== button.dataset.attachmentId);
    renderAttachmentStrip();
    renderComposer();
  });

  reloadBtn?.addEventListener('click', () => {
    vscode.postMessage({ command: 'reloadWindow' });
  });

  composerSettingsBtn?.addEventListener('click', () => {
    vscode.postMessage({ command: 'openSettings' });
  });

  apiSettingsBack?.addEventListener('click', closeApiProviderSettings);
  apiProviderCancel?.addEventListener('click', closeApiProviderSettings);

  settingsNav?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-settings-section]');
    if (!button) {
      return;
    }
    activeSettingsSection = ['agents', 'apiProviders', 'commitMessage'].includes(button.dataset.settingsSection)
      ? button.dataset.settingsSection
      : 'agents';
    renderSettingsPage();
  });

  homeAgentList?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-home-agent-move]');
    if (!button) {
      return;
    }

    event.preventDefault();
    moveHomeAgent(button.dataset.homeAgentId, button.dataset.homeAgentMove);
  });

  homeAgentsReset?.addEventListener('click', () => {
    homeAgentList?.querySelectorAll('input[data-home-agent-id]').forEach((checkbox) => {
      checkbox.checked = true;
    });
  });

  homeAgentsSave?.addEventListener('click', saveHomeAgentSettings);

  commitMessageSave?.addEventListener('click', saveCommitMessageSettings);
  commitMessageReset?.addEventListener('click', resetCommitMessageSettings);

  apiProviderAdd?.addEventListener('click', () => {
    const provider = createApiProviderDraft();
    apiProviderSettings = {
      ...apiProviderSettings,
      customProviders: [...apiProviderSettings.customProviders, provider],
    };
    editingApiProviderId = provider.id;
    clearApiSettingsError();
    renderApiProviderSettings();
    apiProviderName?.focus();
  });

  apiProviderList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-provider-id]');
    if (!button) {
      return;
    }
    editingApiProviderId = button.dataset.providerId;
    clearApiSettingsError();
    renderApiProviderSettings();
  });

  apiProviderAddEnv?.addEventListener('click', () => {
    apiProviderExtraEnv?.appendChild(createExtraEnvRow('', ''));
  });

  apiProviderExtraEnv?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-env]');
    if (!button) {
      return;
    }
    const row = button.closest('.api-extra-env-row');
    row?.remove();
    if (!apiProviderExtraEnv.children.length) {
      apiProviderExtraEnv.appendChild(createExtraEnvRow('', ''));
    }
  });

  apiProviderDelete?.addEventListener('click', () => {
    const provider = currentApiProvider();
    if (!provider) {
      return;
    }
    const customProviders = apiProviderSettings.customProviders.filter((item) => item.id !== provider.id);
    const agentProviderByCliId = Object.fromEntries(
      Object.entries(apiProviderSettings.agentProviderByCliId).filter(([, providerId]) => providerId !== provider.id)
    );
    apiProviderSettings = normalizeApiProviderSettings({
      customProviders,
      defaultProviderId: apiProviderSettings.defaultProviderId === provider.id ? '' : apiProviderSettings.defaultProviderId,
      agentProviderByCliId,
    });
    editingApiProviderId = apiProviderSettings.customProviders[0]?.id || '';
    clearApiSettingsError();
    vscode.postMessage({ command: 'saveApiProviderSettings', settings: apiProviderSettings });
    renderApiProviderSettings();
  });

  apiProviderForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveApiProviderSettings();
  });

  taskBoard?.addEventListener('click', (event) => {
    if (event.target.closest('[data-task-board-dismiss]')) {
      taskBoardDismissed = true;
      persist();
      renderTaskBoard();
      return;
    }

    const card = event.target.closest('[data-task-id]');
    if (!card) {
      return;
    }

    switchActiveProvider(card.dataset.providerId);
    if (card.dataset.threadId) {
      activeThreadByProvider[card.dataset.providerId] = card.dataset.threadId;
    }
    persist();
    renderAll();
  });

  providerSelect.addEventListener('change', () => {
    activeId = providerSelect.value;
    ensureActiveThread(activeId);
    activeAgentModeId(activeId);
    activeModelId(activeId);
    activeRuntimeId(activeId);
    activePermissionId(activeId);
    persist();
    persistUserSelection();
    renderAll();
    refreshActiveContext();
  });

  providerTabs.addEventListener('click', (event) => {
    const button = event.target.closest('.provider-tab-button');
    if (!button || button.disabled) {
      return;
    }

    switchActiveProvider(button.dataset.providerId);
  });

  threadSelect.addEventListener('change', () => {
    activeThreadByProvider[activeId] = threadSelect.value;
    persist();
    renderAll();
  });

  actionSelect.addEventListener('change', renderComposer);

  agentModeSelect.addEventListener('change', () => {
    activeAgentModeByProvider[activeId] = agentModeSelect.value;
    legacyWorkflowMode = undefined;
    persist();
    persistUserSelection();
    renderAll();
  });

  agentModeOptionList?.addEventListener('click', (event) => {
    const button = event.target.closest('.option-list-item');
    if (!button || button.disabled) {
      return;
    }

    activeAgentModeByProvider[activeId] = button.dataset.value;
    agentModeSelect.value = button.dataset.value;
    legacyWorkflowMode = undefined;
    persist();
    persistUserSelection();
    renderAll();
    modeMenu.open = false;
  });

  modelSelect.addEventListener('change', () => {
    activeModelByProvider[activeId] = modelSelect.value;
    rememberRecentModel(activeId, modelSelect.value);
    persist();
    persistUserSelection();
    renderAll();
  });

  modelOptionList?.addEventListener('click', (event) => {
    const button = event.target.closest('.option-list-item');
    if (!button || button.disabled) {
      return;
    }

    const option = modelOptionsFor(activeProfile()).find((item) => item.id === button.dataset.value);
    activeModelByProvider[activeId] = button.dataset.value;
    modelSelect.value = button.dataset.value;
    rememberRecentModel(activeId, button.dataset.value);
    persist();
    persistUserSelection();
    renderAll();

    if (option?.custom) {
      modelMenu.open = true;
      customModelInput.focus();
    } else {
      modelMenu.open = false;
    }
  });

  customModelInput.addEventListener('input', () => {
    customModelByProvider[activeId] = customModelInput.value;
    persist();
    renderComposer();
  });

  runtimeSelect.addEventListener('change', () => {
    activeRuntimeByProvider[activeId] = runtimeSelect.value;
    persist();
    renderAll();
  });

  runtimeOptionList?.addEventListener('click', (event) => {
    const button = event.target.closest('.option-list-item');
    if (!button || button.disabled || button.classList.contains('is-action')) {
      return;
    }

    activeRuntimeByProvider[activeId] = button.dataset.value;
    runtimeSelect.value = button.dataset.value;
    runtimeMenu.open = false;
    persist();
    renderAll();
  });

  permissionSelect.addEventListener('change', () => {
    activePermissionByProvider[activeId] = permissionSelect.value;
    persist();
    renderAll();
  });

  permissionOptionList.addEventListener('click', (event) => {
    const button = event.target.closest('.option-list-item');
    if (!button || button.disabled) {
      return;
    }

    activePermissionByProvider[activeId] = button.dataset.value;
    permissionSelect.value = button.dataset.value;
    permissionMenu.open = false;
    persist();
    renderAll();
  });

  document.querySelectorAll('[data-context]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      contextOptions[checkbox.dataset.context] = checkbox.checked;
      persist();
      refreshActiveContext();
      renderContextSummaryLabel();
    });
  });

  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      actionSelect.value = action;
      send(action, input.value || quickActionText(action));
    });
  });

  messages.addEventListener('click', (event) => {
    const fileCardShowMore = event.target.closest('[data-file-card-show-more]');
    if (fileCardShowMore) {
      event.preventDefault();
      event.stopPropagation();
      revealFileCardRows(fileCardShowMore);
      return;
    }

    const fileCardAction = event.target.closest('[data-file-card-action]');
    if (fileCardAction) {
      event.preventDefault();
      event.stopPropagation();
      if (fileCardAction.dataset.fileCardAction === 'undo') {
        executeOpenCodeNativeSlashCommand({ name: 'undo' });
      } else if (fileCardAction.dataset.fileCardAction === 'review') {
        send('freeform', fileCardReviewPrompt());
      }
      return;
    }

    const copyButton = event.target.closest('[data-message-copy]');
    if (copyButton) {
      event.preventDefault();
      event.stopPropagation();
      const start = Number(copyButton.dataset.messageCopyStart);
      const end = Number(copyButton.dataset.messageCopyEnd);
      const groupText = Number.isInteger(start) && Number.isInteger(end) && end >= start
        ? assistantCopyGroupPlainText(ensureConversation(activeId), start, end)
        : '';
      const body = copyButton.closest('.message-bubble')?.querySelector('.message-content');
      const text = groupText || renderedMessagePlainText(body);
      if (text.trim()) {
        vscode.postMessage({ command: 'copyMessageText', text });
        showCopiedFeedback(copyButton);
      }
      return;
    }

    const button = event.target.closest('.suggestion-button');
    if (!button) {
      return;
    }

    const action = button.dataset.action;
    if (action === 'openSettings') {
      event.preventDefault();
      event.stopPropagation();
      vscode.postMessage({ command: 'openSettings', section: 'apiProviders' });
      return;
    }

    if (action === 'copyInstall') {
      event.preventDefault();
      event.stopPropagation();
      vscode.postMessage({
        command: 'copyInstallCommand',
        installCommand: button.dataset.installCommand,
      });
      return;
    }

    actionSelect.value = action;
    send(action, input.value || quickActionText(action));
  });

  contextBudget?.addEventListener('pointerenter', positionContextBudgetPopover);
  contextBudget?.addEventListener('focus', positionContextBudgetPopover);
  contextBudget?.addEventListener('focusin', positionContextBudgetPopover);

  composerMenus().forEach((menu) => {
    menu.addEventListener('toggle', () => {
      if (!menu.open) {
        return;
      }
      closeComposerMenus(menu);
      scheduleComposerPopoverPosition();
    });
  });

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const currentMenu = target?.closest('details');
    const menus = composerMenus();

    closeComposerMenus(menus.includes(currentMenu) ? currentMenu : undefined);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (openCodeDialogKind) {
        closeOpenCodeStatusDialog();
        return;
      }
      if (apiSettingsPage && !apiSettingsPage.hidden) {
        closeApiProviderSettings();
        return;
      }
      closeComposerMenus();
    }
  });

  window.addEventListener('resize', () => {
    positionContextBudgetPopover();
    positionOpenComposerPopovers();
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.command) {
      case 'profiles':
        profilesLoading = false;
        profiles = message.profiles || [];
        {
          const availableProfiles = visibleInstalledProfiles();
          const storedAgentModes = persistedSelectionMap(message.activeAgentModeByProvider);
          const storedModels = persistedSelectionMap(message.activeModelByProvider);
          activeAgentModeByProvider = hasAppliedPersistentSelection
            ? { ...storedAgentModes, ...activeAgentModeByProvider }
            : { ...activeAgentModeByProvider, ...storedAgentModes };
          activeModelByProvider = hasAppliedPersistentSelection
            ? { ...storedModels, ...activeModelByProvider }
            : { ...activeModelByProvider, ...storedModels };
          const storedProviderProfile = availableProfiles.find(
            (profile) => profile.id === message.activeProviderId
          );
          const defaultProfile = availableProfiles.find(
            (profile) => profile.id === message.defaultProviderId
          );
          if (!hasAppliedPersistentSelection && storedProviderProfile) {
            activeId = storedProviderProfile.id;
          }
          hasAppliedPersistentSelection = true;
          if (!activeId || !availableProfiles.some((profile) => profile.id === activeId)) {
            activeId = defaultProfile?.id || availableProfiles[0]?.id || '';
          }
          if (activeId) {
            activeAgentModeId(activeId);
            activeModelId(activeId);
          }
        }
        persist();
        persistUserSelection();
        renderAll();
        refreshActiveContext();
        break;
      case 'switchProvider':
        switchActiveProvider(message.providerId);
        break;
      case 'contextSummary':
        contextSummary = message.summary;
        renderProviderHint();
        renderContextSummaryLabel();
        renderContextBudget();
        renderOpenCodeSidebar();
        renderOpenCodeStatusDialog();
        break;
      case 'apiProviderSettings':
        apiProviderSettings = normalizeApiProviderSettings(message.settings);
        apiProviderEnvStatusById = message.envStatusByProviderId || {};
        if (!editingApiProviderId || !apiProviderSettings.customProviders.some((provider) => provider.id === editingApiProviderId)) {
          editingApiProviderId = apiProviderSettings.customProviders[0]?.id || '';
        }
        renderSettingsPage();
        break;
      case 'homeAgentSettings':
        homeAgentSettings = normalizeHomeAgentSettings(message.settings);
        renderAll();
        break;
      case 'commitMessageSettings':
        commitMessageSettings = normalizeCommitMessageSettings(message.settings);
        renderSettingsPage();
        break;
      case 'openProviderSettings':
        openSettingsPage(message.section);
        break;
      case 'requestStarted':
        if (!activeId || !installedProfiles().some((profile) => profile.id === activeId)) {
          activeId = message.cliId;
        }
        pendingByProvider[message.cliId] = false;
        runningByProvider[message.cliId] = true;
        activeAgentModeByProvider[message.cliId] = message.agentMode || activeAgentModeId(message.cliId);
        {
          const threadId = pendingThreadByProvider[message.cliId] || activeThreadId(message.cliId);
          const taskId = pendingTaskByProvider[message.cliId] || createRunTask(
            message.cliId,
            message.action,
            message.text,
            message.agentMode
          ).id;
          delete pendingTaskByProvider[message.cliId];
          taskBySessionId[message.sessionId] = taskId;
          updateTaskStatus(taskId, {
            status: 'running',
            sessionId: message.sessionId,
            threadId,
            agentMode: message.agentModeLabel || message.agentMode || '',
          });
          activeThreadByProvider[message.cliId] = threadId;
          addMessage(
            message.cliId,
            'user',
            normalizeMessageText(message.text),
            `${message.actionLabel}${i18n.t('message.metaSeparator')}${agentModeLabel(message.agentMode)}`,
            false,
            threadId,
            message.attachments
          );
          const assistant = addMessage(
            message.cliId,
            'assistant',
            '',
            summarizeRequestContext(message.contextSummary),
            true,
            threadId
          );
          streamTargets[message.sessionId] = {
            cliId: message.cliId,
            threadId,
            index: assistant.index,
            buffer: '',
          };
          if (message.apiProviderWarning) {
            addMessage(message.cliId, 'system', normalizeMessageText(message.apiProviderWarning), undefined, false, threadId);
          }
        }
        persist();
        renderAll();
        break;
      case 'output':
        updateStream(message);
        break;
      case 'openCodeNativeCommandResult':
        if (message.ok && message.nativeCommand === 'fork' && handleOpenCodeForkResult(message)) {
          break;
        }
        addMessage(
          'opencode',
          message.ok ? 'system' : 'error',
          openCodeNativeCommandResultText(message),
          undefined,
          false,
          activeThreadId('opencode')
        );
        renderAll();
        break;
      case 'sessionNotice':
        updateSessionNotice(message);
        break;
      case 'sessionEnd':
        markSessionEnded(message);
        break;
      case 'stopped':
        runningByProvider[message.cliId] = false;
        pendingByProvider[message.cliId] = false;
        {
          const target = streamTargets[message.sessionId];
          updateTaskStatus(taskBySessionId[message.sessionId], { status: 'stopped' });
          delete taskBySessionId[message.sessionId];
          if (target) {
            delete streamTargets[message.sessionId];
          }
          delete pendingThreadByProvider[message.cliId];
          addMessage(message.cliId, 'system', i18n.t('message.runStopped'), undefined, false, target?.threadId);
        }
        renderAll();
        break;
      case 'error':
        runningByProvider[message.cliId || activeId] = false;
        pendingByProvider[message.cliId || activeId] = false;
        delete pendingThreadByProvider[message.cliId || activeId];
        updateTaskStatus(taskBySessionId[message.sessionId], { status: 'failed' });
        delete taskBySessionId[message.sessionId];
        addMessage(
          message.cliId || activeId,
          'error',
          normalizeMessageText(message.text) || i18n.t('message.unknownError')
        );
        renderAll();
        break;
    }
  });

  vscode.postMessage({ command: 'checkProfiles' });
  vscode.postMessage({ command: 'refreshApiProviderSettings' });
  refreshActiveContext();
  renderAll();
})();
