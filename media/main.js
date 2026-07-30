(function () {
  const vscode = acquireVsCodeApi();
  const i18n = window.AssistantI18n;
  const messageText = window.AgentsGuiMessageText;
  const messageChoices = window.AgentsGuiMessageChoices;
  const providerRunState = window.AgentsGuiProviderRunState;
  const providerCapabilities = window.AgentsGuiProviderCapabilities;
  const conversationStore = window.AgentsGuiConversationStore;
  const sessionHistoryState = window.AgentsGuiSessionHistory;
  const slashCommands = window.AgentsGuiSlashCommands;
  const openCodeDialogState = window.AgentsGuiOpenCodeDialogState;
  const claudeActions = window.AgentsGuiClaudeActions;
  const inlineMarkdown = window.AgentsGuiInlineMarkdown;
  const workbenchLayout = window.AgentsGuiWorkbenchLayout;
  const taskBoardState = window.AgentsGuiTaskBoardState;
  const composerState = window.AgentsGuiComposerState;
  const providerOptions = window.AgentsGuiProviderOptions;
  const stateManager = window.AgentsGuiStateManager;
  const pacedReveal = window.AgentsGuiPacedReveal;
  const codexRenderer = window.AgentsGuiCodexRenderer;
  const contextBudgetPresentation = window.AgentsGuiContextBudget;
  const codexRendererEnabled = document.body.dataset.codexRenderer === 'true'
    && Boolean(codexRenderer);
  const normalizeMessageText = messageText.normalizeMessageText;
  const stripInlineMarkdown = messageText.stripInlineMarkdown;
  const appendInlineMarkdown = inlineMarkdown.appendInlineMarkdown;
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

  const INTERNAL_PROMPT_START = 'You are an AI coding assistant embedded in VS Code.';
  const INTERNAL_PROMPT_END_MARKER = '- Risks and caveats: call out assumptions, follow-up work, and edge cases.';
  const INTERNAL_PROMPT_START_MARKERS = [
    INTERNAL_PROMPT_START,
    '[search-mode]',
    'search-mode]',
    'earch-mode]',
    '[analyze-mode]',
    'Recent conversation in this thread:',
    'IDE context, use only if relevant:',
    'IDE context:',
    'Response requirements:',
  ];
  const MAX_IMAGE_ATTACHMENTS = 8;
  const MAX_IMAGE_ATTACHMENT_BYTES = 12 * 1024 * 1024;
  const VISUAL_TASK_BOARD_ENABLED = false;
  const MESSAGE_BOTTOM_STICKY_THRESHOLD = 48;
  const FILE_CARD_COLLAPSE_LIMIT = 3;
  const PROMPT_INPUT_MAX_HEIGHT_FALLBACK = 104;
  const FILE_CARD_ICON_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 2.8h5.2l2 2v8.4H3.6V2.8h1.6z"/><path d="M10.4 2.8v2h2M8 6.2v4.2M5.9 8.3h4.2"/></svg>';
  const THINKING_ICON_SVG = '<svg class="message-thinking-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.75a4.25 4.25 0 0 0-2.35 7.79c.45.3.72.74.72 1.21v.25h3.26v-.25c0-.47.27-.91.72-1.21A4.25 4.25 0 0 0 8 1.75Z"/><path d="M6.5 12.25h3M6.9 14h2.2"/></svg>';
  const THINKING_CHEVRON_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>';
  const ACTIVITY_INLINE_ICON_SVG = '<svg class="message-activity-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5h9v9h-9z"/><path d="m5.7 6 2 2-2 2M8.8 10h1.9"/></svg>';
  const SETTINGS_SAVE_STATUS_TIMEOUT_MS = 5000;
  const SESSION_HISTORY_MIN_WIDTH = 180;
  const SESSION_HISTORY_MAX_WIDTH = 480;
  const SESSION_HISTORY_DEFAULT_WIDTH = 220;

  function clampSessionHistoryWidth(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
      return SESSION_HISTORY_DEFAULT_WIDTH;
    }
    return Math.min(SESSION_HISTORY_MAX_WIDTH, Math.max(SESSION_HISTORY_MIN_WIDTH, Math.round(num)));
  }

  function applySessionHistoryWidth(width) {
    const clamped = clampSessionHistoryWidth(width);
    sessionHistoryWidth = clamped;
    document.documentElement.style.setProperty('--session-history-width', `${clamped}px`);
  }
  const DEFAULT_CONTEXT_OPTIONS = Object.freeze({
    includeWorkspace: true,
    includeCurrentFile: true,
    includeSelection: true,
    includeDiagnostics: true,
  });
  const SETUP_PROVIDER_ORDER = Object.freeze(['opencode', 'codex', 'claude', 'gemini', 'goose', 'aider']);

  const saved = vscode.getState() || {};
  let profiles = [];
  let setupProfiles = [];
  let profilesLoading = true;
  let activeId = saved.activeId || '';
  let activeAgentModeByProvider = persistableAgentModeMap(saved.activeAgentModeByProvider);
  let disabledMcpByProvider = saved.disabledMcpByProvider || {};
  let homeAgentSettings = { visibleAgentIds: [], agentOrder: [] };
  let commitMessageSettings = { provider: 'default', language: 'auto', maxDiffChars: 60000 };
  let activeSettingsSection = 'agents';
  const settingsSaveStatusTimers = {};
  let mcpServersByCli = {};
  let mcpConfigPathByCli = {};
  let mcpSupportedByCli = {};
  let mcpReasonByCli = {};
  let editingMcpServerName = '';
  let mcpServerFormDirty = false;
  let claudeTerminalBannerDismissed = Boolean(saved.claudeTerminalBannerDismissed);
  let taskBoardDismissed = Boolean(saved.taskBoardDismissed);
  let legacyWorkflowMode = saved.workflowMode || (saved.mode === 'agent' ? 'execute' : undefined);
  let hasAppliedPersistentSelection = false;
  const projectedLegacyThreads = codexRendererEnabled
    ? undefined
    : codexRenderer?.projectLegacySnapshot(saved.conversationSnapshot);
  const retainedConversationSnapshot =
    !codexRendererEnabled &&
    !projectedLegacyThreads &&
    saved.conversationSnapshot?.version === 2
      ? saved.conversationSnapshot
      : undefined;
  let threadsByProvider = normalizeSavedThreads(
    projectedLegacyThreads ?? saved.threadsByProvider,
    saved.conversations
  );
  let tasks = normalizeSavedTasks(saved.tasks);
  let activeThreadByProvider = saved.activeThreadByProvider || {};
  let contextOptions = { ...DEFAULT_CONTEXT_OPTIONS };
  let contextSummary = null;
  const contextRequestNamespace = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let contextRequestSequence = 0;
  let latestContextRequest = null;
  let contextSummaryPending = false;
  // Session history panel width (px), persisted across sessions via webview state.
  let sessionHistoryWidth = clampSessionHistoryWidth(saved.sessionHistoryWidth);
  let streamTargets = {};
  // Paced reveal controllers per session — throttle how fast streamed text
  // is shown to avoid layout thrash on large token bursts.
  const textPacedReveals = {};
  const thinkingPacedReveals = {};
  let taskBySessionId = {};
  const stoppedSessionIds = new Set();
  const dismissedClaudeApprovalKeys = new Set();
  const providerRunStore = providerRunState.createProviderRunState();
  let pendingTaskByProvider = providerRunStore.pendingTaskByProvider;
  let runningByProvider = providerRunStore.runningByProvider;
  let pendingByProvider = providerRunStore.pendingByProvider;
  let pendingThreadByProvider = providerRunStore.pendingThreadByProvider;
  let messageStatusTimer = undefined;
  let renderedMessageThreadKey = '';
  let persistUserSelectionTimer = undefined;
  const openMessageDetailKeys = new Set();
  let promptAttachments = [];
  let openCodeDialogKind = '';
  let openCodeDialogQuery = '';
  let openCodeDialogActiveIndex = 0;
  let openCodeDialogOpenSequence = 0;
  let openCodeDialogOpenedAt = 0;
  let openCodeDialogCommandEchoQuery = '';
  let openCodeDialogEchoCleanupPending = false;
  let openCodeDialogHistory = [];

  const taskBoard = document.getElementById('taskBoard');
  const sessionHistory = document.getElementById('sessionHistory');
  const sessionHistoryResizer = document.getElementById('sessionHistoryResizer');
  const sidebar = document.getElementById('sidebar');
  const providerSelect = document.getElementById('providerSelect');
  const providerTabs = document.getElementById('providerTabs');
  const providerHint = document.getElementById('providerHint');
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
  const contextBudgetTitle = document.getElementById('contextBudgetTitle');
  const contextBudgetPercent = document.getElementById('contextBudgetPercent');
  const contextBudgetTokens = document.getElementById('contextBudgetTokens');
  const contextBudgetTokenizer = document.getElementById('contextBudgetTokenizer');
  const contextBudgetPolicy = document.getElementById('contextBudgetPolicy');
  const slashPalette = document.getElementById('slashPalette');
  const claudeTerminalBanner = document.getElementById('claudeTerminalBanner');
  const claudeTerminalDismiss = document.getElementById('claudeTerminalDismiss');
  const claudeSlashBtn = document.getElementById('claudeSlashBtn');
  const codexTerminalBanner = document.getElementById('codexTerminalBanner');
  const codexTerminalStop = document.getElementById('codexTerminalStop');
  const codexTerminalOpen = document.getElementById('codexTerminalOpen');
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
  const apiSettingsPage = document.querySelector('.api-settings-page');
  const apiSettingsBack = document.querySelector('.api-settings-back');
  const settingsNav = document.getElementById('settingsNav');
  const settingsNavAgents = document.getElementById('settingsNavAgents');
  const settingsNavCommitMessage = document.getElementById('settingsNavCommitMessage');
  const settingsNavMcp = document.getElementById('settingsNavMcp');
  const settingsSectionAgents = document.getElementById('settingsSectionAgents');
  const settingsSectionCommitMessage = document.getElementById('settingsSectionCommitMessage');
  const settingsSectionMcp = document.getElementById('settingsSectionMcp');
  const mcpConfigPath = document.getElementById('mcpConfigPath');
  const mcpUnsupported = document.getElementById('mcpUnsupported');
  const mcpUnsupportedReason = document.getElementById('mcpUnsupportedReason');
  const mcpSettingsBody = document.getElementById('mcpSettingsBody');
  const mcpServerList = document.getElementById('mcpServerList');
  const mcpServerAdd = document.getElementById('mcpServerAdd');
  const mcpRefresh = document.getElementById('mcpRefresh');
  const mcpServerForm = document.getElementById('mcpServerForm');
  const mcpServerName = document.getElementById('mcpServerName');
  const mcpServerType = document.getElementById('mcpServerType');
  const mcpServerCommand = document.getElementById('mcpServerCommand');
  const mcpServerCommandField = document.getElementById('mcpServerCommandField');
  const mcpServerUrl = document.getElementById('mcpServerUrl');
  const mcpServerUrlField = document.getElementById('mcpServerUrlField');
  const mcpServerEnabled = document.getElementById('mcpServerEnabled');
  const mcpCliToggles = document.getElementById('mcpCliToggles');
  const mcpServerEnvList = document.getElementById('mcpServerEnvList');
  const mcpServerAddEnv = document.getElementById('mcpServerAddEnv');
  const mcpServerHeadersList = document.getElementById('mcpServerHeadersList');
  const mcpServerAddHeader = document.getElementById('mcpServerAddHeader');
  const mcpServerHeadersSection = document.getElementById('mcpServerHeadersSection');
  const mcpServerError = document.getElementById('mcpServerError');
  const mcpServerSaveStatus = document.getElementById('mcpServerSaveStatus');
  const mcpServerDelete = document.getElementById('mcpServerDelete');
  const mcpServerCancel = document.getElementById('mcpServerCancel');
  const homeAgentList = document.getElementById('homeAgentList');
  const homeAgentsReset = document.getElementById('homeAgentsReset');
  const homeAgentsSave = document.getElementById('homeAgentsSave');
  const homeAgentsSaveStatus = document.getElementById('homeAgentsSaveStatus');
  const commitMessageProviderSelect = document.getElementById('commitMessageProviderSelect');
  const commitMessageLanguageSelect = document.getElementById('commitMessageLanguageSelect');
  const commitMessageMaxDiffChars = document.getElementById('commitMessageMaxDiffChars');
  const commitMessageReset = document.getElementById('commitMessageReset');
  const commitMessageSave = document.getElementById('commitMessageSave');
  const commitMessageSaveStatus = document.getElementById('commitMessageSaveStatus');
  const SLASH_COMMANDS = slashCommands.createBaseSlashCommands((key, params) => i18n.t(key, params));
  let slashMatches = [];
  let slashActiveIndex = 0;
  let slashPaletteMode = '';
  let claudeActionQuery = '';
  let forceContextMenuVisible = false;

  /**
   * Filter internal prompt echo from output text
   *
   * This is a SECONDARY defense layer. The primary filtering happens in the
   * backend (agentSessionController.ts -> outputFormatter.ts). This frontend
   * filter exists as a safety net for cases where:
   * - Backend filtering is incomplete due to chunk boundaries
   * - Cross-chunk state is lost during buffering
   * - Edge cases in prompt echo detection
   *
   * Architecture note (inspired by OpenCode):
   * Ideally, output normalization should happen ONLY in the backend (single
   * source of truth). This frontend filter is kept for backward compatibility
   * and should be removed once backend filtering is proven robust.
   */
  function filterInternalPromptEcho(text) {
    const normalized = normalizeMessageText(text);
    const firstContentIndex = normalized.search(/\S/);
    if (firstContentIndex === -1) {
      return { text: normalized, pending: false };
    }

    if (!startsWithInternalPromptEcho(normalized, firstContentIndex)) {
      return { text: normalized, pending: false };
    }

    const promptEndIndex = normalized.indexOf(INTERNAL_PROMPT_END_MARKER, firstContentIndex);
    if (promptEndIndex === -1) {
      return { text: '', pending: true };
    }

    return {
      text: stripPromptBoundary(normalized.slice(promptEndIndex + INTERNAL_PROMPT_END_MARKER.length)),
      pending: false,
    };
  }

  function startsWithInternalPromptEcho(text, firstContentIndex) {
    const candidate = text.slice(firstContentIndex);
    return INTERNAL_PROMPT_START_MARKERS.some((marker) => candidate.startsWith(marker));
  }

  function stripPromptBoundary(text) {
    return String(text || '').replace(/^[\s"'“”]+/, '');
  }

  function sanitizeThinkingText(text) {
    const filtered = filterInternalPromptEcho(text);
    return (filtered.pending ? '' : filtered.text).trim();
  }

  function persist() {
    vscode.setState({
      activeId,
      activeAgentModeByProvider: persistableAgentModeMap(activeAgentModeByProvider),
      disabledMcpByProvider,
      claudeTerminalBannerDismissed,
      taskBoardDismissed,
      conversationSnapshot: codexRendererEnabled
        ? codexRenderer.serialize()
        : retainedConversationSnapshot,
      threadsByProvider: conversationStore.serializeThreadsForState(threadsByProvider),
      tasks: serializeTasksForState(tasks),
      activeThreadByProvider,
      contextOptions: defaultContextOptions(),
      sessionHistoryWidth,
    });
    schedulePersistUserSelection();
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

  function usesProviderNativeAgentConfig(providerId) {
    return providerCapabilities.usesNativeAgentConfig(providerId);
  }

  function persistableAgentModeMap(value) {
    return Object.fromEntries(
      Object.entries(persistedSelectionMap(value)).filter(([providerId]) => (
        !usesProviderNativeAgentConfig(providerId)
      ))
    );
  }

  function schedulePersistUserSelection() {
    if (persistUserSelectionTimer) {
      clearTimeout(persistUserSelectionTimer);
    }
    persistUserSelectionTimer = setTimeout(() => {
      persistUserSelectionTimer = undefined;
      persistUserSelection();
    }, 150);
  }

  function persistUserSelection() {
    vscode.postMessage({
      command: 'saveSelectionState',
      activeProviderId: activeId,
      activeAgentModeByProvider: persistableAgentModeMap(activeAgentModeByProvider),
      disabledMcpByProvider,
      contextOptions: defaultContextOptions(),
      claudeTerminalBannerDismissed,
      taskBoardDismissed,
    });
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

  function normalizeSetupProfile(profile) {
    if (!profile || typeof profile !== 'object') {
      return undefined;
    }

    const id = String(profile.id || '').trim();
    const name = String(profile.name || id).trim();
    const installHint = String(profile.installHint || '').trim();
    if (!id || !name || !installHint) {
      return undefined;
    }

    return {
      ...profile,
      id,
      name,
      description: String(profile.description || '').trim(),
      installHint,
      installed: profile.installed === true,
    };
  }

  function normalizeSetupProfiles(value) {
    const seen = new Set();
    return (Array.isArray(value) ? value : [])
      .map(normalizeSetupProfile)
      .filter((profile) => {
        if (!profile || seen.has(profile.id)) {
          return false;
        }
        seen.add(profile.id);
        return true;
      });
  }

  function setupProfilesForOnboarding() {
    const rank = new Map(SETUP_PROVIDER_ORDER.map((id, index) => [id, index]));
    return setupProfiles
      .filter((profile) => !profile.installed)
      .slice()
      .sort((a, b) => (
        (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999)
        || a.name.localeCompare(b.name)
      ));
  }

  function recommendedSetupProfile(list = setupProfilesForOnboarding()) {
    return list.find((profile) => profile.id === 'opencode') || list[0];
  }

  function configurableAgentProfiles() {
    return installedProfiles();
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
    return taskBoardState.normalizeSavedTasks(savedTasks, {
      fallbackTitle: i18n.t('task.untitled'),
      limit: 20,
    });
  }

  function makeThreadId(cliId) {
    return conversationStore.makeThreadId(cliId);
  }

  function makeTaskId(providerId) {
    return taskBoardState.makeTaskId(providerId);
  }

  function createThread(cliId, messages) {
    return conversationStore.createThread(cliId, messages, {
      deriveThreadTitle,
      newThreadTitle: i18n.t('history.newThread'),
    });
  }

  function normalizeThreadMessages(threadMessages) {
    return conversationStore.normalizeThreadMessages(threadMessages, {
      normalizeAssistantText: (text) => filterInternalPromptEcho(text).text,
      sanitizeThinkingText,
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
    return conversationStore.ensureThreadList(threadsByProvider, cliId);
  }

  function findThread(cliId, threadId) {
    return conversationStore.findThread(threadsByProvider, cliId, threadId);
  }

  function ensureActiveThread(cliId) {
    return conversationStore.ensureActiveThread(
      threadsByProvider,
      activeThreadByProvider,
      cliId,
      createThread
    );
  }

  function codexThreadSummaries(providerId) {
    if (!codexRendererEnabled) {
      return [];
    }
    return codexRenderer.getThreadSummaries()
      .filter((thread) => !providerId || thread.providerId === providerId);
  }

  function codexThreadSummary(providerId, threadId) {
    return codexThreadSummaries(providerId)
      .find((thread) => thread.id === threadId);
  }

  function setActiveThread(cliId, thread) {
    const active = conversationStore.setActiveThread(
      threadsByProvider,
      activeThreadByProvider,
      cliId,
      thread
    );
    if (codexRendererEnabled && active) {
      codexRenderer.ensureThread(cliId, thread.id, thread.title, thread.updatedAt);
      codexRenderer.setActiveThread(cliId, thread.id);
    }
    return active;
  }

  function startNewThread(cliId = activeId) {
    const current = ensureActiveThread(cliId);
    const currentSummary = current
      ? codexThreadSummary(cliId, current.id)
      : undefined;
    if (
      !current ||
      current.messages.length > 0 ||
      Boolean(currentSummary?.turnCount)
    ) {
      setActiveThread(cliId, createThread(cliId));
    } else {
      setActiveThread(cliId, current);
    }
    const thread = ensureActiveThread(cliId);
    if (codexRendererEnabled && thread) {
      codexRenderer.ensureThread(cliId, thread.id, thread.title, thread.updatedAt);
      codexRenderer.setActiveThread(cliId, thread.id);
    }
    persist();
    renderAll();
  }

  function latestThread(threads) {
    return conversationStore.latestThread(threads);
  }

  function canDeleteActiveThread(cliId = activeId) {
    if (!cliId || runningByProvider[cliId] || pendingByProvider[cliId]) {
      return false;
    }

    const thread = ensureActiveThread(cliId);
    if (!thread) {
      return false;
    }

    return (codexRendererEnabled
      ? codexThreadSummaries(cliId).length
      : ensureThreadList(cliId).length) > 1 ||
      thread.messages.length > 0 ||
      Boolean(codexThreadSummary(cliId, thread.id)?.turnCount) ||
      Boolean(thread.openCodeSessionId);
  }

  function requestOpenCodeSessionDelete(openCodeSessionId) {
    if (!openCodeSessionId || !String(openCodeSessionId).startsWith('ses')) {
      return;
    }

    vscode.postMessage({
      command: 'deleteOpenCodeSession',
      openCodeSessionId,
    });
  }

  function deleteActiveThread(cliId = activeId) {
    if (!canDeleteActiveThread(cliId)) {
      return null;
    }

    const thread = ensureActiveThread(cliId);
    if (!thread) {
      return null;
    }

    const deletedOpenCodeSessionId = cliId === 'opencode' ? thread.openCodeSessionId : '';
    if (codexRendererEnabled) {
      codexRenderer.deleteThread(cliId, thread.id);
    }
    const threads = ensureThreadList(cliId);
    const remainingThreads = threads.filter((item) => item.id !== thread.id);
    const shouldDeleteRemoteOpenCodeSession =
      Boolean(deletedOpenCodeSessionId) &&
      !remainingThreads.some((item) => item.openCodeSessionId === deletedOpenCodeSessionId);
    threads.splice(0, threads.length, ...remainingThreads);
    delete activeThreadByProvider[cliId];

    const next = latestThread(remainingThreads) || createThread(cliId);
    if (!threads.includes(next)) {
      threads.unshift(next);
    }
    setActiveThread(cliId, next);
    if (shouldDeleteRemoteOpenCodeSession) {
      requestOpenCodeSessionDelete(deletedOpenCodeSessionId);
    }
    persist();
    renderAll();
    return next;
  }

  function closeDeleteThreadDialog() {
    document.querySelector('.session-delete-backdrop')?.remove();
  }

  function showDeleteThreadDialog(cliId = activeId) {
    if (!canDeleteActiveThread(cliId)) {
      return;
    }

    closeDeleteThreadDialog();

    const backdrop = document.createElement('div');
    backdrop.className = 'session-delete-backdrop';
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) {
        closeDeleteThreadDialog();
      }
    });

    const dialog = document.createElement('section');
    dialog.className = 'session-delete-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'sessionDeleteTitle');
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDeleteThreadDialog();
      }
    });

    const title = document.createElement('h2');
    title.id = 'sessionDeleteTitle';
    title.textContent = i18n.t('history.deleteConfirmTitle');
    dialog.appendChild(title);

    const body = document.createElement('p');
    body.textContent = i18n.t('history.deleteConfirmBody');
    dialog.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'session-delete-actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'session-delete-button';
    cancel.textContent = i18n.t('history.deleteCancel');
    cancel.addEventListener('click', closeDeleteThreadDialog);
    actions.appendChild(cancel);

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'session-delete-button is-danger';
    confirm.textContent = i18n.t('history.deleteAction');
    confirm.addEventListener('click', () => {
      closeDeleteThreadDialog();
      deleteActiveThread(cliId);
    });
    actions.appendChild(confirm);

    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => cancel.focus());
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
    const conversation = codexRendererEnabled
      ? codexRenderer.getConversationHistory(cliId, activeThreadId(cliId))
      : ensureConversation(cliId, activeThreadId(cliId));
    return conversation
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
    const task = taskBoardState.createTask({
      providerId,
      providerName: profile?.name || providerId,
      title: deriveThreadTitle(text) || i18n.t('task.untitled'),
      action: action || 'freeform',
      agentMode: agentMode || '',
      status: 'preparing',
      threadId: activeThreadId(providerId),
      now,
    });

    tasks = taskBoardState.upsertRecentTask(tasks, task, { limit: 20 });
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
    renderSessionHistory();
    return task;
  }

  function setAccent(profile) {
    document.documentElement.style.setProperty(
      '--assistant-accent',
      profile?.accent || 'var(--vscode-focusBorder)'
    );
  }

  function agentModesFor(profile) {
    return providerOptions.agentModesFor(profile);
  }

  function normalizeAgentModeId(profile, value) {
    return providerOptions.normalizeAgentModeId(profile, value);
  }

  function activeAgentModeId(cliId = activeId) {
    const profile = profiles.find((item) => item.id === cliId);
    const legacy = legacyWorkflowMode ? mapLegacyWorkflowMode(profile, legacyWorkflowMode) : undefined;
    const requested = activeAgentModeByProvider[cliId] || legacy;
    const normalized = normalizeAgentModeId(profile, requested);
    if (usesProviderNativeAgentConfig(cliId)) {
      if (requested && requested === normalized) {
        activeAgentModeByProvider[cliId] = normalized;
      } else {
        delete activeAgentModeByProvider[cliId];
      }
      return normalized;
    }

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
    return providerOptions.splitAgentModeLabel(label);
  }

  function mapLegacyWorkflowMode(profile, value) {
    return providerOptions.mapLegacyWorkflowMode(profile, value);
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
      providerTabs.style.removeProperty('--provider-tabs-expanded-width');
      return;
    }

    const tabWidth = 24;
    const tabGap = 3;
    const tabChrome = 4;
    const collapsedWidth = 28;
    const expandedWidth = Math.max(
      collapsedWidth,
      tabChrome + availableProfiles.length * tabWidth + Math.max(0, availableProfiles.length - 1) * tabGap
    );
    providerTabs.style.setProperty('--provider-tabs-expanded-width', `${expandedWidth}px`);

    const existingButtons = new Map();
    for (const child of Array.from(providerTabs.children)) {
      if (child instanceof HTMLButtonElement && child.dataset.providerId) {
        existingButtons.set(child.dataset.providerId, child);
      }
    }

    for (const profile of availableProfiles) {
      const isActive = profile.id === activeId;
      const providerIsRunning = Boolean(runningByProvider[profile.id]);
      const providerIsPending = Boolean(pendingByProvider[profile.id]);
      const providerIsBusy = providerIsRunning || providerIsPending;
      const button = existingButtons.get(profile.id) || document.createElement('button');

      button.type = 'button';
      button.dataset.providerId = profile.id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(isActive));
      button.setAttribute('aria-busy', String(providerIsBusy));
      button.title = [
        profile.name || '',
        providerIsRunning ? i18n.t('provider.running') : '',
        providerIsPending ? i18n.t('provider.preparing') : '',
      ].filter(Boolean).join(' · ');
      button.disabled = false;
      button.className = 'provider-tab-button';
      if (isActive) {
        button.classList.add('is-active');
      }
      if (providerIsBusy) {
        button.classList.add('is-busy');
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
      'ask',
      ...installedProfiles().map((profile) => profile.id),
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
    activeSettingsSection = ['agents', 'commitMessage', 'mcp'].includes(section)
      ? section
      : 'agents';
    renderSettingsPage();
    apiSettingsPage.hidden = false;
    document.body.classList.add('is-api-settings-open');
    const focusTarget = activeSettingsSection === 'commitMessage'
        ? commitMessageProviderSelect
        : activeSettingsSection === 'mcp'
          ? mcpServerList?.querySelector('.api-provider-list-item') || mcpServerAdd
          : homeAgentList?.querySelector('input');
    focusTarget?.focus();
    if (activeSettingsSection === 'mcp') {
      requestMcpServers(activeProviderId());
    }
  }

  function closeSettingsPage() {
    if (apiSettingsPage) {
      apiSettingsPage.hidden = true;
    }
    document.body.classList.remove('is-api-settings-open');
  }

  function renderSettingsPage() {
    renderSettingsSection();
    switch (activeSettingsSection) {
      case 'commitMessage':
        renderCommitMessageSettings();
        break;
      case 'mcp':
        renderMcpSettings();
        break;
      default:
        renderHomeAgentSettings();
        break;
    }
  }

  function renderSettingsSection() {
    const isAgents = activeSettingsSection === 'agents';
    const isCommitMessage = activeSettingsSection === 'commitMessage';
    const isMcp = activeSettingsSection === 'mcp';
    settingsNavAgents?.classList.toggle('is-active', isAgents);
    settingsNavCommitMessage?.classList.toggle('is-active', isCommitMessage);
    settingsNavMcp?.classList.toggle('is-active', isMcp);
    settingsNavAgents?.setAttribute('aria-current', isAgents ? 'page' : 'false');
    settingsNavCommitMessage?.setAttribute('aria-current', isCommitMessage ? 'page' : 'false');
    settingsNavMcp?.setAttribute('aria-current', isMcp ? 'page' : 'false');
    if (settingsSectionAgents) {
      settingsSectionAgents.hidden = !isAgents;
    }
    if (settingsSectionCommitMessage) {
      settingsSectionCommitMessage.hidden = !isCommitMessage;
    }
    if (settingsSectionMcp) {
      settingsSectionMcp.hidden = !isMcp;
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

      const authActions = createHomeAgentAuthActions(profile);
      if (authActions) {
        row.appendChild(authActions);
      }

      const sort = document.createElement('span');
      sort.className = 'home-agent-sort';
      sort.appendChild(createHomeAgentMoveButton(profile, 'up', index === 0));
      sort.appendChild(createHomeAgentMoveButton(profile, 'down', index === orderedProfiles.length - 1));
      row.appendChild(sort);

      homeAgentList.appendChild(row);
    });
  }

  function createHomeAgentAuthActions(profile) {
    const commands = profile?.authCommands || {};
    const actions = ['status', 'login', 'logout'].filter((action) => Array.isArray(commands[action]));
    if (actions.length === 0) {
      return null;
    }

    const container = document.createElement('span');
    container.className = 'home-agent-auth-actions';
    actions.forEach((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `home-agent-auth-button${action === 'logout' ? ' is-danger' : ''}`;
      button.dataset.homeAgentId = profile.id;
      button.dataset.cliAuthAction = action;
      button.textContent = homeAgentAuthLabel(action);
      button.title = `${profile.name} · ${button.textContent}`;
      container.appendChild(button);
    });
    return container;
  }

  function homeAgentAuthLabel(action) {
    switch (action) {
      case 'login':
        return i18n.t('homeAgents.signIn');
      case 'logout':
        return i18n.t('homeAgents.signOut');
      case 'status':
      default:
        return i18n.t('homeAgents.authStatus');
    }
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
    setSettingsSaveStatus('agents', 'info', i18n.t('homeAgents.orderChangedStatus'));
    homeAgentList
      ?.querySelector(`button[data-home-agent-id="${agentId}"][data-home-agent-move="${direction}"]`)
      ?.focus();
  }

  function showAllHomeAgentsForUi() {
    homeAgentSettings = normalizeHomeAgentSettings({ visibleAgentIds: [], agentOrder: [] });
    renderAll();
    renderHomeAgentSettings();
    setSettingsSaveStatus('agents', 'info', i18n.t('homeAgents.showAllStatus'));
    homeAgentList?.querySelector('input[data-home-agent-id]')?.focus();
  }

  function settingsSaveStatusElement(section) {
    switch (section) {
      case 'agents':
        return homeAgentsSaveStatus;
      case 'commitMessage':
        return commitMessageSaveStatus;
      case 'mcp':
        return mcpServerSaveStatus;
      default:
        return null;
    }
  }

  function clearSettingsSaveStatus(section) {
    const element = settingsSaveStatusElement(section);
    if (!element) {
      return;
    }
    window.clearTimeout(settingsSaveStatusTimers[section]);
    settingsSaveStatusTimers[section] = undefined;
    element.textContent = '';
    element.classList.remove('is-saving', 'is-success', 'is-error', 'is-info');
  }

  function setSettingsSaveStatus(section, state, message) {
    const element = settingsSaveStatusElement(section);
    if (!element) {
      return;
    }

    window.clearTimeout(settingsSaveStatusTimers[section]);
    settingsSaveStatusTimers[section] = undefined;
    element.classList.remove('is-saving', 'is-success', 'is-error', 'is-info');

    if (!state) {
      element.textContent = '';
      return;
    }

    const defaultTextByState = {
      saving: i18n.t('settings.saveStatus.saving'),
      success: i18n.t('settings.saveStatus.saved'),
      error: i18n.t('settings.saveStatus.failed'),
      info: '',
    };
    element.textContent = message || defaultTextByState[state] || '';
    element.classList.add(`is-${state}`);

    if (state === 'success') {
      settingsSaveStatusTimers[section] = window.setTimeout(() => {
        clearSettingsSaveStatus(section);
      }, SETTINGS_SAVE_STATUS_TIMEOUT_MS);
    }
    if (state === 'info') {
      settingsSaveStatusTimers[section] = window.setTimeout(() => {
        clearSettingsSaveStatus(section);
      }, SETTINGS_SAVE_STATUS_TIMEOUT_MS);
    }
  }

  function saveHomeAgentSettings() {
    homeAgentSettings = collectHomeAgentSettings();
    setSettingsSaveStatus('agents', 'saving');
    vscode.postMessage({ command: 'saveHomeAgentSettings', settings: homeAgentSettings });
    renderAll();
    renderHomeAgentSettings();
  }

  function renderCommitMessageSettings() {
    if (!commitMessageProviderSelect || !commitMessageLanguageSelect || !commitMessageMaxDiffChars) {
      return;
    }

    commitMessageProviderSelect.innerHTML = '';
    appendCliOption(commitMessageProviderSelect, 'default', i18n.t('commitSettings.providerDefault'));
    appendCliOption(commitMessageProviderSelect, 'ask', i18n.t('commitSettings.providerAsk'));
    profiles.forEach((profile) => {
      appendCliOption(commitMessageProviderSelect, profile.id, profile.name);
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
    setSettingsSaveStatus('commitMessage', 'saving');
    vscode.postMessage({ command: 'saveCommitMessageSettings', settings: commitMessageSettings });
    renderCommitMessageSettings();
  }

  function resetCommitMessageSettings() {
    commitMessageSettings = { provider: 'default', language: 'auto', maxDiffChars: 60000 };
    renderCommitMessageSettings();
    setSettingsSaveStatus('commitMessage', 'saving');
    vscode.postMessage({ command: 'saveCommitMessageSettings', settings: commitMessageSettings });
  }

  function currentMcpCliId() {
    return activeProviderId() || 'opencode';
  }

  function activeMcpServers() {
    const cliId = currentMcpCliId();
    const servers = mcpServersByCli[cliId];
    return Array.isArray(servers) ? servers : [];
  }

  function isMcpSupported() {
    return mcpSupportedByCli[currentMcpCliId()] !== false;
  }

  function requestMcpServers(cliId) {
    const target = cliId || currentMcpCliId();
    vscode.postMessage({ command: 'loadMcpServers', cliId: target });
  }

  function mcpStatusLabel(status) {
    const kind = mcpStatusKind(status);
    if (kind === 'connected') {
      return i18n.t('mcpSettings.statusConnected');
    }
    if (kind === 'failed') {
      return i18n.t('mcpSettings.statusFailed');
    }
    if (kind === 'disabled') {
      return i18n.t('mcpSettings.statusDisabled');
    }
    if (kind === 'needs_auth') {
      return i18n.t('mcpSettings.statusNeedsAuth');
    }
    return i18n.t('mcpSettings.statusUnknown');
  }

  function mcpStatusKind(status) {
    const normalized = String(status || '').trim().toLowerCase();
    if (!normalized) {
      return 'unknown';
    }
    if (normalized === 'connected' || normalized === 'ready' || normalized === 'running') {
      return 'connected';
    }
    if (normalized === 'failed' || normalized === 'error') {
      return 'failed';
    }
    if (normalized === 'disabled' || normalized === 'off') {
      return 'disabled';
    }
    if (normalized.includes('auth')) {
      return 'needs_auth';
    }
    return 'unknown';
  }

  function renderMcpSettings() {
    const cliId = currentMcpCliId();
    const supported = isMcpSupported();
    if (mcpUnsupported) {
      mcpUnsupported.hidden = supported;
    }
    if (mcpUnsupportedReason && !supported) {
      const reason = mcpReasonByCli[cliId] || i18n.t('mcpSettings.unsupported');
      mcpUnsupportedReason.textContent = reason;
    }
    if (mcpConfigPath) {
      const path = mcpConfigPathByCli[cliId] || '';
      mcpConfigPath.hidden = !path;
      mcpConfigPath.textContent = path;
    }
    if (mcpSettingsBody) {
      mcpSettingsBody.hidden = !supported;
    }
    if (!supported) {
      return;
    }
    renderMcpServerList();
    renderMcpServerForm();
  }

  function renderMcpServerList() {
    if (!mcpServerList) {
      return;
    }
    mcpServerList.innerHTML = '';
    const servers = activeMcpServers();
    if (servers.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'api-provider-status';
      empty.textContent = i18n.t('mcpSettings.empty');
      mcpServerList.appendChild(empty);
      return;
    }
    servers.forEach((server) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'api-provider-list-item mcp-list-item';
      button.dataset.mcpServerName = server.name;
      if (server.name === editingMcpServerName) {
        button.classList.add('is-active');
      }
      if (server.enabled === false) {
        button.classList.add('is-disabled');
      }

      const label = document.createElement('span');
      label.textContent = server.name;
      button.appendChild(label);

      const status = document.createElement('span');
      status.className = `mcp-list-item-status is-${mcpStatusKind(server.runtimeStatus?.status)}`;
      status.textContent = server.enabled === false
        ? i18n.t('mcpSettings.statusDisabled')
        : mcpStatusLabel(server.runtimeStatus?.status);
      button.appendChild(status);

      mcpServerList.appendChild(button);
    });
  }

  const MCP_CLI_TOGGLE_IDS = ['claude', 'codex', 'gemini', 'opencode'];

  function renderMcpCliToggles(enabledByCli) {
    if (!mcpCliToggles) {
      return;
    }
    mcpCliToggles.innerHTML = '';
    const state = enabledByCli || {};
    MCP_CLI_TOGGLE_IDS.forEach((cliId) => {
      const label = document.createElement('label');
      label.className = 'mcp-cli-toggle';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.mcpCliToggle = cliId;
      checkbox.checked = state[cliId] !== false;
      label.appendChild(checkbox);

      const text = document.createElement('span');
      text.textContent = i18n.t(`mcpSettings.cli.${cliId}`);
      label.appendChild(text);

      mcpCliToggles.appendChild(label);
    });
  }

  function collectMcpCliToggles() {
    const result = {};
    if (!mcpCliToggles) {
      return result;
    }
    mcpCliToggles.querySelectorAll('[data-mcp-cli-toggle]').forEach((checkbox) => {
      const cliId = checkbox.dataset.mcpCliToggle;
      if (cliId) {
        result[cliId] = checkbox.checked;
      }
    });
    return result;
  }

  function renderMcpServerForm() {
    if (!mcpServerForm) {
      return;
    }
    const server = activeMcpServers().find((entry) => entry.name === editingMcpServerName);
    if (mcpServerName) {
      mcpServerName.value = server?.name || '';
      mcpServerName.disabled = Boolean(server);
    }
    if (mcpServerType) {
      mcpServerType.value = server?.type === 'remote' ? 'remote' : 'local';
    }
    if (mcpServerCommand) {
      const command = Array.isArray(server?.command) ? server.command.join(' ') : '';
      mcpServerCommand.value = command;
    }
    if (mcpServerUrl) {
      mcpServerUrl.value = server?.url || '';
    }
    if (mcpServerEnabled) {
      mcpServerEnabled.value = server?.enabled === false ? 'false' : 'true';
    }
    renderMcpCliToggles(server?.enabledByCli);
    renderEnvList(mcpServerEnvList, server?.environment || {});
    renderEnvList(mcpServerHeadersList, server?.headers || {});
    updateMcpFormVisibility();
    if (mcpServerError) {
      mcpServerError.hidden = true;
    }
    if (mcpServerDelete) {
      mcpServerDelete.disabled = !server;
    }
  }

  function renderEnvList(container, values) {
    if (!container) {
      return;
    }
    container.innerHTML = '';
    const entries = Object.entries(values || {});
    if (entries.length === 0) {
      entries.push(['', '']);
    }
    entries.forEach(([key, value]) => {
      container.appendChild(createExtraEnvRow(key, value));
    });
  }

  function updateMcpFormVisibility() {
    const type = mcpServerType?.value || 'local';
    if (mcpServerCommandField) {
      mcpServerCommandField.hidden = type === 'remote';
    }
    if (mcpServerUrlField) {
      mcpServerUrlField.hidden = type !== 'remote';
    }
    if (mcpServerHeadersSection) {
      mcpServerHeadersSection.hidden = type !== 'remote';
    }
  }

  function collectMcpServerForm() {
    const name = (mcpServerName?.value || '').trim();
    const type = mcpServerType?.value === 'remote' ? 'remote' : 'local';
    const enabled = mcpServerEnabled?.value !== 'false';
    const server = { name, type, enabled };

    if (type === 'remote') {
      server.url = (mcpServerUrl?.value || '').trim();
      server.headers = collectEnvList(mcpServerHeadersList);
    } else {
      const commandText = (mcpServerCommand?.value || '').trim();
      server.command = parseCommandString(commandText);
    }
    server.environment = collectEnvList(mcpServerEnvList);
    server.enabledByCli = collectMcpCliToggles();
    return server;
  }

  function collectEnvList(container) {
    if (!container) {
      return {};
    }
    const result = {};
    container.querySelectorAll('.api-extra-env-row').forEach((row) => {
      const keyInput = row.querySelector('[data-env-key]');
      const valueInput = row.querySelector('[data-env-value]');
      const key = (keyInput?.value || '').trim();
      const value = valueInput?.value || '';
      if (!key) {
        return;
      }
      result[key] = value;
    });
    return result;
  }

  function parseCommandString(text) {
    if (!text) {
      return [];
    }
    const tokens = [];
    const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      tokens.push(match[1] ?? match[2] ?? match[3]);
    }
    return tokens.filter((token) => token && token.length > 0);
  }

  function clearMcpFormError() {
    if (mcpServerError) {
      mcpServerError.hidden = true;
      mcpServerError.textContent = '';
    }
  }

  function showMcpFormError(message) {
    if (mcpServerError) {
      mcpServerError.hidden = false;
      mcpServerError.textContent = message;
    }
  }

  function startNewMcpServer() {
    editingMcpServerName = '';
    renderMcpServerList();
    renderMcpServerForm();
    mcpServerName?.focus();
  }

  function saveMcpServer() {
    const payload = collectMcpServerForm();
    if (!payload.name) {
      showMcpFormError(i18n.t('mcpSettings.errorNameRequired'));
      return;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(payload.name)) {
      showMcpFormError(i18n.t('mcpSettings.errorNameInvalid'));
      return;
    }
    if (payload.type === 'remote') {
      if (!payload.url || !/^https?:\/\//i.test(payload.url)) {
        showMcpFormError(i18n.t('mcpSettings.errorUrl'));
        return;
      }
    } else if (!Array.isArray(payload.command) || payload.command.length === 0) {
      showMcpFormError(i18n.t('mcpSettings.errorCommand'));
      return;
    }
    clearMcpFormError();
    setSettingsSaveStatus('mcp', 'saving');
    vscode.postMessage({ command: 'saveMcpServer', cliId: currentMcpCliId(), server: payload });
  }

  function deleteMcpServer() {
    const server = activeMcpServers().find((entry) => entry.name === editingMcpServerName);
    if (!server) {
      return;
    }
    setSettingsSaveStatus('mcp', 'saving');
    vscode.postMessage({ command: 'deleteMcpServer', cliId: currentMcpCliId(), name: server.name });
    editingMcpServerName = '';
  }

  function toggleMcpServerEnabled(name, enabled) {
    vscode.postMessage({ command: 'toggleMcpServer', cliId: currentMcpCliId(), name, enabled });
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
    return [modeMenu, contextMenu].filter(Boolean);
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
    const alignToEnd = menu === modeMenu;

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

  function nextContextRequestId() {
    contextRequestSequence += 1;
    return `${contextRequestNamespace}-${contextRequestSequence}`;
  }

  function refreshActiveContext() {
    if (!activeId) {
      return;
    }
    const request = {
      requestId: nextContextRequestId(),
      cliId: activeId,
    };
    contextSummary = null;
    latestContextRequest = request;
    contextSummaryPending = true;
    renderProviderHint();
    renderContextSummaryLabel();
    renderContextBudget();
    renderOpenCodeSidebar();
    renderOpenCodeStatusDialog();
    vscode.postMessage({
      command: 'refreshContext',
      ...request,
      contextOptions: defaultContextOptions(),
    });
  }

  function switchActiveProvider(providerId) {
    const profile = profiles.find((item) => item.id === providerId);
    if (!profile?.installed || activeId === providerId) {
      return;
    }

    activeId = providerId;
    ensureActiveThread(activeId);
    activeAgentModeId(activeId);
    closeComposerMenus();
    persist();
    persistUserSelection();
    refreshActiveContext();
    renderAll();
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

    const threads = threadsForShell(activeId)
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt);

    for (const item of threads) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.title || i18n.t('history.untitled');
      threadSelect.appendChild(option);
    }

    threadSelect.value = thread.id;
    threadSelect.disabled = threads.length <= 1;
    deleteThreadBtn.disabled = !canDeleteActiveThread(activeId);
    newChatBtn.disabled = !activeId;
  }

  function threadsForShell(providerId) {
    if (!codexRendererEnabled) {
      return ensureThreadList(providerId);
    }
    return codexThreadSummaries(providerId).map((summary) => {
      const legacy = findThread(providerId, summary.id);
      return {
        ...(legacy || {}),
        id: summary.id,
        title: summary.title,
        updatedAt: summary.updatedAt,
        messages: [],
        rendererStatus: summary.status,
        turnCount: summary.turnCount,
      };
    });
  }

  function historyProviderIds() {
    const ids = new Set();
    profiles.forEach((profile) => {
      if (profile?.installed) {
        ids.add(profile.id);
      }
    });
    Object.keys(threadsByProvider || {}).forEach((providerId) => {
      if (ensureThreadList(providerId).length > 0) {
        ids.add(providerId);
      }
    });
    codexThreadSummaries().forEach((thread) => ids.add(thread.providerId));
    if (activeId) {
      ids.add(activeId);
    }
    return Array.from(ids);
  }

  function historyProviderName(providerId) {
    return profiles.find((profile) => profile.id === providerId)?.name || providerId || i18n.t('provider.label');
  }

  function historyStatusForThread(providerId, thread) {
    if (codexRendererEnabled && thread?.rendererStatus) {
      if (thread.rendererStatus === 'idle') {
        return thread.turnCount > 0 ? 'answered' : 'empty';
      }
      return thread.rendererStatus;
    }
    return sessionHistoryState.threadStatus(thread, {
      providerId,
      tasks,
      pendingByProvider,
      runningByProvider,
      pendingThreadByProvider,
      activeThreadId: activeThreadByProvider[providerId],
    });
  }

  function historyStatusLabel(status) {
    return i18n.t(`history.status.${status}`);
  }

  function formatHistoryRelativeTime(timestamp) {
    const time = sessionHistoryState.threadTimestamp({ updatedAt: timestamp });
    if (!time) {
      return '';
    }

    const elapsed = Math.max(0, Date.now() - time);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const week = 7 * day;
    if (elapsed < minute) {
      return i18n.t('history.time.now');
    }
    if (elapsed < hour) {
      return i18n.t('history.time.minutes', { count: String(Math.max(1, Math.floor(elapsed / minute))) });
    }
    if (elapsed < day) {
      return i18n.t('history.time.hours', { count: String(Math.max(1, Math.floor(elapsed / hour))) });
    }
    if (elapsed < week) {
      return i18n.t('history.time.days', { count: String(Math.max(1, Math.floor(elapsed / day))) });
    }
    return i18n.t('history.time.weeks', { count: String(Math.max(1, Math.floor(elapsed / week))) });
  }

  function setSessionHistoryHidden(hidden) {
    if (typeof workbenchLayout?.setSessionHistoryHidden === 'function') {
      workbenchLayout.setSessionHistoryHidden(document.body, sessionHistory, hidden);
    } else {
      if (sessionHistory) {
        sessionHistory.hidden = Boolean(hidden);
      }
      document.body.classList.toggle('is-session-history-hidden', Boolean(hidden));
      document.body.classList.toggle('is-session-history-visible', !Boolean(hidden));
    }
    if (sessionHistoryResizer) {
      sessionHistoryResizer.hidden = Boolean(hidden);
    }
  }

  let sessionHistoryResizePersistTimer = undefined;

  function initSessionHistoryResizer() {
    if (!sessionHistoryResizer) {
      return;
    }

    let dragging = false;
    let startX = 0;
    let startWidth = 0;

    const beginDrag = (clientX) => {
      dragging = true;
      startX = clientX;
      startWidth = sessionHistoryWidth;
      sessionHistoryResizer.classList.add('is-dragging');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    };

    const moveDrag = (clientX) => {
      if (!dragging) {
        return;
      }
      // The panel is on the left, so dragging right increases width.
      const delta = clientX - startX;
      applySessionHistoryWidth(startWidth + delta);
    };

    const endDrag = () => {
      if (!dragging) {
        return;
      }
      dragging = false;
      sessionHistoryResizer.classList.remove('is-dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      persistSessionHistoryWidth();
    };

    sessionHistoryResizer.addEventListener('mousedown', (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      beginDrag(event.clientX);
    });

    document.addEventListener('mousemove', (event) => {
      moveDrag(event.clientX);
    });

    document.addEventListener('mouseup', () => {
      endDrag();
    });

    // Keyboard support: arrow keys to adjust width.
    sessionHistoryResizer.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 32 : 8;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        applySessionHistoryWidth(sessionHistoryWidth - step);
        persistSessionHistoryWidth();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        applySessionHistoryWidth(sessionHistoryWidth + step);
        persistSessionHistoryWidth();
      }
    });
  }

  function persistSessionHistoryWidth() {
    if (sessionHistoryResizePersistTimer) {
      clearTimeout(sessionHistoryResizePersistTimer);
    }
    sessionHistoryResizePersistTimer = setTimeout(() => {
      sessionHistoryResizePersistTimer = undefined;
      persist();
    }, 300);
  }

  function renderSessionHistory() {
    if (!sessionHistory) {
      return;
    }

    sessionHistory.innerHTML = '';
    setSessionHistoryHidden(true);

    const header = document.createElement('div');
    header.className = 'session-history-header';

    const title = document.createElement('div');
    title.className = 'session-history-title';
    title.textContent = i18n.t('history.label');
    header.appendChild(title);

    const newSession = document.createElement('button');
    newSession.type = 'button';
    newSession.className = 'session-history-new';
    newSession.dataset.historyNew = 'true';
    newSession.title = i18n.t('history.newThread');
    newSession.setAttribute('aria-label', i18n.t('history.newThread'));
    newSession.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';
    newSession.disabled = !activeId;
    header.appendChild(newSession);

    const body = document.createElement('div');
    body.className = 'session-history-body';

    // Flatten all threads across providers into a single list sorted by recency.
    // Provider is distinguished by an inline logo on each item instead of a
    // separate group section.
    const allThreads = [];
    for (const providerId of historyProviderIds()) {
      const threads = sessionHistoryState.sortedThreads(threadsForShell(providerId));
      threads.forEach((thread) => {
        allThreads.push({ providerId, thread });
      });
    }
    allThreads.sort((a, b) => (
      sessionHistoryState.threadTimestamp(b.thread) - sessionHistoryState.threadTimestamp(a.thread)
    ));

    let rendered = 0;
    allThreads.forEach(({ providerId, thread }) => {
      const status = historyStatusForThread(providerId, thread);
      const selected = providerId === activeId && thread.id === activeThreadId(activeId);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = [
        'session-history-row',
        `is-${status}`,
        selected ? 'is-active' : '',
      ].filter(Boolean).join(' ');
      row.dataset.providerId = providerId;
      row.dataset.threadId = thread.id;
      row.setAttribute('aria-current', selected ? 'true' : 'false');
      row.title = [
        historyProviderName(providerId),
        historyStatusLabel(status),
        thread.title || i18n.t('history.untitled'),
      ].filter(Boolean).join(' · ');

      const providerIcon = createSessionHistoryProviderIcon(providerId);
      row.appendChild(providerIcon);

      const content = document.createElement('span');
      content.className = 'session-history-content';

      const rowTitle = document.createElement('span');
      rowTitle.className = 'session-history-row-title';
      rowTitle.textContent = thread.title || i18n.t('history.untitled');
      content.appendChild(rowTitle);

      const meta = document.createElement('span');
      meta.className = 'session-history-meta';

      const statusLabel = document.createElement('span');
      statusLabel.classList.add('session-history-status-label');
      const statusDot = document.createElement('span');
      statusDot.classList.add('session-history-status-dot');
      statusDot.setAttribute('aria-hidden', 'true');
      statusLabel.appendChild(statusDot);
      const statusText = document.createElement('span');
      statusText.classList.add('session-history-status-text');
      statusText.textContent = historyStatusLabel(status);
      statusLabel.appendChild(statusText);
      meta.appendChild(statusLabel);

      const time = formatHistoryRelativeTime(sessionHistoryState.threadTimestamp(thread));
      if (time) {
        const timeLabel = document.createElement('span');
        timeLabel.textContent = time;
        meta.appendChild(timeLabel);
      }
      content.appendChild(meta);
      row.appendChild(content);

      body.appendChild(row);
      rendered += 1;
    });

    if (rendered === 0 && !profilesLoading) {
      setSessionHistoryHidden(true);
      return;
    }

    if (rendered === 0 && profilesLoading) {
      const empty = document.createElement('div');
      empty.className = 'session-history-empty';
      empty.textContent = i18n.t('provider.loading');
      body.appendChild(empty);
    }

    sessionHistory.appendChild(header);
    sessionHistory.appendChild(body);
    setSessionHistoryHidden(false);
  }

  function createSessionHistoryProviderIcon(providerId) {
    const wrapper = document.createElement('span');
    wrapper.className = 'session-history-provider-icon';
    wrapper.setAttribute('aria-hidden', 'true');

    const profile = profiles.find((item) => item.id === providerId);
    const iconUri = providerIconUri(profile);
    if (iconUri) {
      const img = document.createElement('img');
      img.src = iconUri;
      img.alt = '';
      img.draggable = false;
      wrapper.appendChild(img);
    } else {
      wrapper.textContent = profile?.icon || historyProviderName(providerId).slice(0, 1);
    }

    return wrapper;
  }

  function activateHistoryThread(providerId, threadId) {
    const profile = profiles.find((item) => item.id === providerId);
    const thread = findThread(providerId, threadId);
    if (!thread || (profile && !profile.installed)) {
      return;
    }

    activeId = providerId;
    activeThreadByProvider[providerId] = thread.id;
    activeAgentModeId(activeId);
    closeComposerMenus();
    persist();
    persistUserSelection();
    refreshActiveContext();
    renderAll();
    input.focus();
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
      return i18n.t(contextSummaryPending ? 'context.waiting' : 'context.none');
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

  function defaultContextOptions() {
    return { ...DEFAULT_CONTEXT_OPTIONS };
  }

  function actionLabel(action) {
    const option = actionSelect.querySelector(`option[value="${action}"]`);
    return option?.textContent || i18n.t(`action.${action}`) || action;
  }

  function parseSlashInput(value) {
    return slashCommands.parseSlashInput(value);
  }

  function slashInputLooksLikeCommand(query) {
    return slashCommands.slashInputLooksLikeCommand(query);
  }

  function slashCommandMatchesProvider(command, profile) {
    return slashCommands.slashCommandMatchesProvider(command, profile);
  }

  function slashCommandMatchesQuery(command, query) {
    return slashCommands.slashCommandMatchesQuery(command, query);
  }

  function slashCommandDescription(command, profile = activeProfile()) {
    return i18n.t(command.descriptionKey || 'slash.native.desc', {
      provider: profile?.name || activeId,
    });
  }

  function profileSlashCommands(profile) {
    return slashCommands.profileSlashCommands(profile);
  }

  function commandsForActiveProvider() {
    return slashCommands.commandsForProvider(SLASH_COMMANDS, activeProfile());
  }

  function claudeActionDrawerSections(profile = activeProfile()) {
    return claudeActions.actionSections({
      translate: (key, params) => i18n.t(key, params),
      profile,
    });
  }

  function claudeActionMatchesQuery(action, query) {
    return claudeActions.actionMatchesQuery(action, query);
  }

  function renderClaudeActionDrawer({ focusFilter = false } = {}) {
    if (!slashPalette) {
      return;
    }

    const hadFilterFocus = slashPalette.querySelector('.claude-action-filter') === document.activeElement;
    const query = claudeActionQuery.trim().toLowerCase();
    const sections = claudeActionDrawerSections();
    slashMatches = [];
    slashActiveIndex = Math.max(0, slashActiveIndex);
    slashPaletteMode = 'claudeActions';
    slashPalette.innerHTML = '';
    slashPalette.classList.add('is-claude-actions');
    slashPalette.setAttribute('role', 'dialog');
    slashPalette.setAttribute('aria-label', i18n.t('claude.actions.label'));

    const filter = document.createElement('input');
    filter.className = 'claude-action-filter';
    filter.type = 'text';
    filter.value = claudeActionQuery;
    filter.autocomplete = 'off';
    filter.spellcheck = false;
    filter.placeholder = i18n.t('claude.actions.filterPlaceholder');
    filter.setAttribute('aria-label', i18n.t('claude.actions.filterLabel'));
    filter.addEventListener('input', () => {
      claudeActionQuery = filter.value;
      slashActiveIndex = 0;
      renderClaudeActionDrawer({ focusFilter: true });
    });
    slashPalette.appendChild(filter);

    const list = document.createElement('div');
    list.className = 'claude-action-list';
    slashPalette.appendChild(list);

    sections.forEach((section) => {
      const matches = section.actions.filter((action) => claudeActionMatchesQuery(action, query));
      if (matches.length === 0) {
        return;
      }

      const group = document.createElement('section');
      group.className = 'claude-action-section';

      const heading = document.createElement('div');
      heading.className = 'claude-action-section-title';
      heading.textContent = section.title;
      group.appendChild(heading);

      matches.forEach((action) => {
        const index = slashMatches.length;
        slashMatches.push(action);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = `slash-command claude-action-item${index === slashActiveIndex ? ' is-active' : ''}`;
        button.dataset.claudeAction = action.id;
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', index === slashActiveIndex ? 'true' : 'false');

        const label = document.createElement('span');
        label.className = 'claude-action-label';
        label.textContent = action.label;
        button.appendChild(label);

        group.appendChild(button);
      });

      list.appendChild(group);
    });

    if (slashMatches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'slash-empty claude-action-empty';
      empty.textContent = i18n.t('claude.actions.empty');
      list.appendChild(empty);
    }

    slashActiveIndex = Math.max(0, Math.min(slashActiveIndex, Math.max(0, slashMatches.length - 1)));
    slashPalette.querySelectorAll('.claude-action-item').forEach((button, index) => {
      const active = index === slashActiveIndex;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    slashPalette.hidden = false;

    if (focusFilter || hadFilterFocus) {
      requestAnimationFrame(() => {
        filter.focus();
        filter.setSelectionRange(filter.value.length, filter.value.length);
      });
    }
  }

  function renderSlashPalette() {
    if (!slashPalette) {
      return;
    }

    const profile = activeProfile();
    const parsed = parseSlashInput(input.value);
    if (profile?.id === 'claude') {
      if (slashPaletteMode === 'claudeActions' && !input.disabled) {
        renderClaudeActionDrawer();
        return;
      }
      if (parsed && !input.disabled) {
        slashPaletteMode = 'claudeActions';
        claudeActionQuery = parsed.query || '';
        input.value = '';
        resizePromptInput();
        renderClaudeActionDrawer({ focusFilter: true });
        return;
      }
    }

    if (!parsed || input.disabled) {
      hideSlashPalette();
      return;
    }

    slashPaletteMode = 'commands';
    slashPalette.classList.remove('is-claude-actions');
    slashPalette.setAttribute('role', 'listbox');
    slashPalette.setAttribute('aria-label', i18n.t('slash.label'));
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

    const footer = document.createElement('div');
    footer.className = 'slash-footer';

    const acceptHint = document.createElement('span');
    acceptHint.textContent = i18n.t('slash.footer.accept', { command: slashMatches[slashActiveIndex].name });
    footer.appendChild(acceptHint);

    const commandHint = document.createElement('span');
    commandHint.textContent = i18n.t('slash.footer.commands');
    footer.appendChild(commandHint);

    slashPalette.appendChild(footer);
    slashPalette.hidden = false;
  }

  function hideSlashPalette() {
    slashMatches = [];
    slashActiveIndex = 0;
    slashPaletteMode = '';
    claudeActionQuery = '';
    if (slashPalette) {
      slashPalette.hidden = true;
      slashPalette.innerHTML = '';
      slashPalette.classList.remove('is-claude-actions');
      slashPalette.setAttribute('role', 'listbox');
      slashPalette.setAttribute('aria-label', i18n.t('slash.label'));
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
    return slashCommands.buildSlashCommandPrompt(command, args);
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

  function executeLocalSlashCommand(command, args = '', sourceQuery = '') {
    switch (command.local) {
      case 'new':
        startNewThread(activeId);
        return;
      case 'help':
        if (activeProfile()?.id === 'opencode') {
          closeComposerMenus();
          showOpenCodeStatusDialog('help', { commandQuery: sourceQuery });
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
        vscode.postMessage({ command: 'checkProfiles', force: true });
        refreshActiveContext();
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
      case 'agents':
        closeComposerMenus();
        showOpenCodeStatusDialog('agents', { commandQuery: sourceQuery });
        return;
      case 'mcp':
        closeComposerMenus();
        showOpenCodeStatusDialog('mcp', { commandQuery: sourceQuery });
        refreshActiveContext();
        return;
      case 'connect':
        closeComposerMenus();
        openSettingsPage('agents');
        return;
      case 'org':
        closeComposerMenus();
        showOpenCodeStatusDialog('org', { commandQuery: sourceQuery });
        return;
      case 'status':
        closeComposerMenus();
        showOpenCodeStatusDialog('status', { commandQuery: sourceQuery });
        refreshActiveContext();
        return;
      case 'themes':
        closeComposerMenus();
        showOpenCodeStatusDialog('themes', { commandQuery: sourceQuery });
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

  function rewindActiveConversation() {
    const thread = ensureActiveThread(activeId);
    const messages = thread?.messages || [];
    if (messages.length === 0) {
      addMessage(activeId, 'system', i18n.t('claude.actions.rewindEmpty'));
      renderAll();
      return;
    }

    let rewindStart = messages.length - 1;
    while (rewindStart > 0 && messages[rewindStart]?.role !== 'user') {
      rewindStart -= 1;
    }

    thread.messages = messages.slice(0, rewindStart);
    persist();
    renderAll();
  }

  function executeClaudeAction(action) {
    if (!action) {
      return;
    }

    switch (action.id) {
      case 'attachFile':
        hideSlashPalette();
        imageFileInput?.click();
        return;
      case 'mentionFile':
        hideSlashPalette();
        vscode.postMessage({ command: 'openFilePalette' });
        return;
      case 'clearConversation':
        hideSlashPalette();
        startNewThread(activeId);
        return;
      case 'rewind':
        hideSlashPalette();
        rewindActiveConversation();
        return;
      case 'accountUsage':
        hideSlashPalette();
        vscode.postMessage({ command: 'openProviderExtension', cliId: activeId });
        return;
      case 'settings':
        hideSlashPalette();
        vscode.postMessage({ command: 'openSettings', section: 'agents' });
        return;
      default:
        return;
    }
  }

  function executeSlashCommand(command) {
    if (!command) {
      addMessage(activeId, 'system', i18n.t('slash.empty'));
      hideSlashPalette();
      return;
    }

    const parsed = parseSlashInput(input.value);
    const args = parsed?.args || '';
    const sourceQuery = parsed?.query || command.name || '';
    input.value = '';
    resizePromptInput();
    hideSlashPalette();

    if (command.kind === 'local') {
      executeLocalSlashCommand(command, args, sourceQuery);
      renderComposer();
      return;
    }

    if (command.kind === 'native') {
      send('freeform', `/${command.name}${args ? ` ${args}` : ''}`);
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
      return i18n.t(
        contextSummaryPending ? 'context.compactPending' : 'context.compactNone'
      );
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

  function clearContextBudget() {
    contextBudget.hidden = true;
    contextBudgetLabel.textContent = '';
    contextBudgetTitle.textContent = '';
    contextBudgetPercent.textContent = '';
    contextBudgetTokens.textContent = '';
    contextBudgetTokenizer.textContent = '';
    contextBudgetPolicy.textContent = '';
    contextBudget.title = '';
    contextBudget.setAttribute('aria-label', i18n.t('contextWindow.label'));
    contextBudget.classList.toggle('has-total', false);
    contextBudget.classList.toggle('is-unavailable', false);
    contextBudget.classList.toggle('is-estimated', false);
    contextBudget.classList.toggle('is-attached', false);
  }

  function contextWindowTotal(summary, profile) {
    if (
      summary
      && Object.prototype.hasOwnProperty.call(summary, 'contextWindowTokens')
    ) {
      return summary.contextWindowTokens;
    }
    return profile?.contextWindowTokens;
  }

  function renderContextBudget() {
    if (
      !contextBudget ||
      !contextBudgetLabel ||
      !contextBudgetTitle ||
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
      clearContextBudget();
      return;
    }

    const presentation = contextBudgetPresentation.deriveContextBudgetPresentation({
      tokenUsage,
      totalTokens: contextWindowTotal(contextSummary, profile),
      autoCompact: profile.autoCompactsContext,
    });
    contextBudget.hidden = !presentation.visible;
    contextBudget.classList.toggle('has-total', presentation.ring === 'usage');
    contextBudget.classList.toggle('is-unavailable', presentation.mode === 'unavailable');
    contextBudget.classList.toggle('is-estimated', presentation.precision === 'estimated');
    contextBudget.classList.toggle('is-attached', presentation.mode === 'attached');

    if (contextBudget.hidden) {
      clearContextBudget();
      return;
    }

    if (presentation.mode === 'unavailable') {
      contextBudgetTitle.textContent = i18n.t('contextWindow.title');
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
      contextBudget.setAttribute('aria-label', contextBudget.title);
      positionContextBudgetPopover();
      return;
    }

    if (presentation.mode === 'attached') {
      contextBudgetTitle.textContent = i18n.t('contextWindow.attachedTitle');
      contextBudgetLabel.textContent = presentation.tokenLabel;
      contextBudgetPercent.textContent = i18n.t(
        presentation.precision === 'estimated'
          ? 'contextWindow.attachedTokens'
          : 'contextWindow.attachedExactTokens',
        {
        tokens: presentation.tokenValueLabel,
        }
      );
      contextBudgetTokens.textContent = presentation.hasTotal
        ? i18n.t('contextWindow.attachedReference', {
            percent: presentation.percentageLabel,
            total: presentation.totalLabel,
          })
        : '';
      contextBudgetTokenizer.textContent = i18n.t('contextWindow.attachedExcludes');
      contextBudgetPolicy.textContent = '';
    } else if (presentation.hasTotal) {
      contextBudgetTitle.textContent = i18n.t('contextWindow.title');
      contextBudgetLabel.textContent = `${presentation.percentageLabel}%`;
      contextBudgetPercent.textContent = i18n.t('contextWindow.usedPercent', { percent: presentation.percentageLabel });
      contextBudgetTokens.textContent = i18n.t('contextWindow.usedTokens', { used: presentation.tokenValueLabel });
      contextBudgetTokenizer.textContent = i18n.t('contextWindow.totalTokens', { total: presentation.totalLabel });
      contextBudgetPolicy.textContent = [
        presentation.showRemaining ? i18n.t('contextWindow.remaining', { remaining: presentation.remainingLabel }) : '',
        presentation.showAutoCompact ? i18n.t('contextWindow.autoCompact') : '',
      ].filter(Boolean).join(' · ');
    } else {
      contextBudgetTitle.textContent = i18n.t('contextWindow.title');
      contextBudgetLabel.textContent = presentation.tokenLabel;
      contextBudgetPercent.textContent = i18n.t('contextWindow.usedTokens', { used: presentation.tokenValueLabel });
      contextBudgetTokens.textContent = contextSummary.workspace || '';
      contextBudgetTokenizer.textContent = contextSummary.activeFile || '';
      contextBudgetPolicy.textContent = '';
    }
    contextBudget.title = [
      contextBudgetTitle.textContent,
      contextBudgetPercent.textContent,
      contextBudgetTokens.textContent,
      contextBudgetTokenizer.textContent,
      contextBudgetPolicy.textContent,
    ].filter(Boolean).join(' ');
    contextBudget.setAttribute('aria-label', contextBudget.title);
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
    const presentation = contextBudgetPresentation.deriveContextBudgetPresentation({
      tokenUsage: contextSummary?.tokenUsage,
      totalTokens: contextWindowTotal(contextSummary, profile),
      autoCompact: profile?.autoCompactsContext,
    });
    if (!presentation.visible || presentation.mode === 'unavailable') {
      return [];
    }

    if (presentation.mode === 'attached') {
      return [
        {
          text: `${i18n.t('contextWindow.attachedTitle')}: ${i18n.t(
            presentation.precision === 'estimated'
              ? 'contextWindow.attachedTokens'
              : 'contextWindow.attachedExactTokens',
            { tokens: presentation.tokenValueLabel }
          )}`,
          strong: true,
        },
        ...(presentation.hasTotal
          ? [
              {
                text: i18n.t('contextWindow.attachedReference', {
                  percent: presentation.percentageLabel,
                  total: presentation.totalLabel,
                }),
              },
            ]
          : []),
        { text: i18n.t('contextWindow.attachedExcludes') },
      ];
    }

    return [
      { text: i18n.t('contextWindow.usedTokens', { used: presentation.tokenValueLabel }), strong: true },
      ...(presentation.hasTotal
        ? [
            { text: i18n.t('contextWindow.usedPercent', { percent: presentation.percentageLabel }) },
            { text: i18n.t('contextWindow.remaining', { remaining: presentation.remainingLabel }) },
          ]
        : []),
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

  function openCodeStatusLines(profile) {
    const mode = localizedCliOption(activeAgentMode(profile), 'agentMode');
    const mcpServers = Array.isArray(contextSummary?.mcpServers) ? contextSummary.mcpServers : [];
    const connectedMcpCount = mcpServers.filter((entry) => entry?.status === 'connected').length;
    const versionLabel = formatProviderVersion(profile?.version);

    return [
      { text: versionLabel ? `OpenCode ${versionLabel}` : 'OpenCode' },
      { text: `Thread ${activeThreadId('opencode') || 'local'}` },
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

  function openCodeOrgLines() {
    return [{ text: 'Organizations are managed by the configured OpenCode provider' }];
  }

  function openCodeDialogEmptyText(kind) {
    if (kind === 'mcp') {
      return contextSummary?.mcpStatusPending ? i18n.t('opencode.dialog.mcp.loading') : i18n.t('opencode.dialog.mcp.empty');
    }
    return 'No options';
  }

  function openCodeDialogTitle(kind) {
    if (kind === 'agents') {
      return 'Agents';
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

  function openCodeDialogKeyboardOptions(kind) {
    return openCodeDialogOptions(kind).filter((option) => !option.disabled);
  }

  function initialOpenCodeDialogActiveIndex(kind) {
    return openCodeDialogState.initialActiveIndex(openCodeDialogKeyboardOptions(kind));
  }

  function syncOpenCodeDialogActiveIndex(kind) {
    const options = openCodeDialogKeyboardOptions(kind);
    openCodeDialogActiveIndex = openCodeDialogState.clampActiveIndex(openCodeDialogActiveIndex, options);
    return options;
  }

  function openCodeDialogActiveOptionId(kind) {
    const options = syncOpenCodeDialogActiveIndex(kind);
    return openCodeDialogState.activeOptionId(options, openCodeDialogActiveIndex);
  }

  function openCodeDialogCommandAliases(kind) {
    return openCodeDialogState.commandAliases(kind);
  }

  function normalizeOpenCodeDialogCommandQuery(value) {
    return openCodeDialogState.normalizeCommandQuery(value);
  }

  function isOpenCodeDialogCommandEcho(kind, value) {
    return openCodeDialogState.isCommandEcho(kind, value, openCodeDialogCommandEchoQuery);
  }

  function configureOpenCodeDialogFilter(filter, kind) {
    filter.name = `opencode-${kind}-filter-${openCodeDialogOpenSequence}`;
    filter.autocomplete = 'off';
    filter.spellcheck = false;
    filter.setAttribute('autocapitalize', 'off');
    filter.setAttribute('autocorrect', 'off');
    filter.setAttribute('data-lpignore', 'true');
    filter.setAttribute('data-1p-ignore', 'true');
  }

  function clearInitialOpenCodeDialogCommandEcho(filter, kind, renderOptions) {
    const isInitialOpen = Date.now() - openCodeDialogOpenedAt < 1000;
    if (
      !openCodeDialogEchoCleanupPending
      || !isInitialOpen
      || openCodeDialogQuery
      || !isOpenCodeDialogCommandEcho(kind, filter.value)
    ) {
      return false;
    }

    filter.value = '';
    openCodeDialogQuery = '';
    openCodeDialogEchoCleanupPending = false;
    openCodeDialogActiveIndex = initialOpenCodeDialogActiveIndex(kind);
    renderOptions();
    return true;
  }

  function focusPromptInputAfterDialogClose() {
    requestAnimationFrame(() => {
      input.focus();
      resizePromptInput();
    });
  }

  function openCodeDialogSnapshot(kind = openCodeDialogKind) {
    return {
      kind,
      query: openCodeDialogQuery,
      activeIndex: openCodeDialogActiveIndex,
      commandEchoQuery: openCodeDialogCommandEchoQuery,
      echoCleanupPending: openCodeDialogEchoCleanupPending,
    };
  }

  function closeOpenCodeStatusDialog({ focusPrompt = true } = {}) {
    openCodeDialogKind = '';
    openCodeDialogQuery = '';
    openCodeDialogCommandEchoQuery = '';
    openCodeDialogEchoCleanupPending = false;
    openCodeDialogHistory = [];
    renderOpenCodeStatusDialog();
    if (focusPrompt) {
      focusPromptInputAfterDialogClose();
    }
  }

  function restoreOpenCodeStatusDialog(snapshot) {
    if (!snapshot?.kind) {
      return false;
    }

    openCodeDialogKind = snapshot.kind;
    openCodeDialogQuery = snapshot.query || '';
    openCodeDialogCommandEchoQuery = snapshot.commandEchoQuery || '';
    openCodeDialogEchoCleanupPending = Boolean(snapshot.echoCleanupPending);
    openCodeDialogOpenSequence += 1;
    openCodeDialogOpenedAt = Date.now();
    openCodeDialogActiveIndex = Number.isFinite(snapshot.activeIndex)
      ? snapshot.activeIndex
      : initialOpenCodeDialogActiveIndex(snapshot.kind);
    renderOpenCodeStatusDialog();
    return true;
  }

  function dismissOpenCodeStatusDialog(options = {}) {
    const previous = openCodeDialogHistory.pop();
    if (previous && restoreOpenCodeStatusDialog(previous)) {
      return;
    }

    closeOpenCodeStatusDialog(options);
  }

  function showOpenCodeStatusDialog(kind, options = {}) {
    openCodeDialogKind = kind;
    openCodeDialogQuery = '';
    openCodeDialogCommandEchoQuery = normalizeOpenCodeDialogCommandQuery(options.commandQuery);
    openCodeDialogEchoCleanupPending = Boolean(openCodeDialogCommandEchoQuery);
    openCodeDialogHistory = options.returnTo ? [options.returnTo] : [];
    openCodeDialogOpenSequence += 1;
    openCodeDialogOpenedAt = Date.now();
    openCodeDialogActiveIndex = initialOpenCodeDialogActiveIndex(kind);
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
    title.id = `openCodeDialogTitle-${openCodeDialogKind}`;
    title.textContent = openCodeDialogTitle(openCodeDialogKind);
    titleWrap.appendChild(title);
    dialog.setAttribute('aria-labelledby', title.id);
    const descriptionText = openCodeDialogDescription(openCodeDialogKind);
    if (descriptionText) {
      const description = document.createElement('p');
      description.id = `openCodeDialogDescription-${openCodeDialogKind}`;
      description.textContent = descriptionText;
      titleWrap.appendChild(description);
      dialog.setAttribute('aria-describedby', description.id);
    }

    const close = document.createElement('button');
    close.className = 'opencode-dialog-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = 'esc';
    close.addEventListener('click', () => dismissOpenCodeStatusDialog());

    header.append(titleWrap, close);
    dialog.appendChild(header);

    const body = document.createElement('div');
    body.className = 'opencode-dialog-body';
    if (openCodeDialogKind === 'mcp') {
      dialog.addEventListener('keydown', handleOpenCodeMcpDialogKeydown);
      renderOpenCodeMcpDialogBody(body);
      dialog.appendChild(body);
      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);
      body.querySelector('.opencode-dialog-filter')?.focus();
      return;
    }
    if (openCodeDialogKind === 'agents') {
      dialog.addEventListener('keydown', handleOpenCodeOptionDialogKeydown);
      renderOpenCodeOptionDialogBody(body, openCodeDialogKind);
      dialog.appendChild(body);
      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);
      requestAnimationFrame(focusOpenCodeOptionDialogActiveTarget);
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

  function renderOpenCodeMcpDialogBody(body) {
    const filter = document.createElement('input');
    filter.className = 'opencode-dialog-filter';
    filter.type = 'text';
    configureOpenCodeDialogFilter(filter, 'mcp');
    filter.value = openCodeDialogQuery;
    filter.placeholder = i18n.t('opencode.dialog.mcp.search');
    filter.setAttribute('aria-label', i18n.t('opencode.dialog.mcp.searchAria'));
    filter.addEventListener('input', () => {
      if (clearInitialOpenCodeDialogCommandEcho(filter, 'mcp', () => renderOpenCodeMcpOptions(list))) {
        return;
      }

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
    const openSequence = openCodeDialogOpenSequence;
    requestAnimationFrame(() => {
      if (openSequence !== openCodeDialogOpenSequence || openCodeDialogKind !== 'mcp') {
        return;
      }

      clearInitialOpenCodeDialogCommandEcho(filter, 'mcp', () => renderOpenCodeMcpOptions(list));
    });

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
      openCodeDialogActiveIndex = openCodeDialogState.moveActiveIndex(openCodeDialogActiveIndex, options, delta);
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

  function handleOpenCodeOptionDialogKeydown(event) {
    if (openCodeDialogKind !== 'agents') {
      return;
    }

    const options = syncOpenCodeDialogActiveIndex(openCodeDialogKind);
    if (options.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      openCodeDialogActiveIndex = openCodeDialogState.moveActiveIndex(openCodeDialogActiveIndex, options, delta);
      renderOpenCodeStatusDialog();
      requestAnimationFrame(focusOpenCodeOptionDialogActiveTarget);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[openCodeDialogActiveIndex];
      selectOpenCodeDialogOption(openCodeDialogKind, option.id);
    }
  }

  function focusOpenCodeOptionDialogActiveTarget() {
    const filter = document.querySelector(`.opencode-dialog.is-${openCodeDialogKind} .opencode-dialog-filter`);
    if (filter instanceof HTMLElement) {
      filter.focus();
      return;
    }

    document.querySelector(`.opencode-dialog.is-${openCodeDialogKind} .opencode-dialog-option.is-active`)?.focus();
  }

  function focusOpenCodeMcpActiveOption() {
    document.querySelector('.opencode-dialog.is-mcp .opencode-dialog-option.is-active')?.focus();
  }

  function renderOpenCodeOptionDialogBody(body, kind) {
    const options = openCodeDialogOptions(kind);
    syncOpenCodeDialogActiveIndex(kind);
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
      option.id === openCodeDialogActiveOptionId(kind) ? 'is-active' : '',
      option.selected ? 'is-selected' : '',
      option.disabled ? 'is-disabled' : '',
    ].filter(Boolean).join(' ');
    button.dataset.opencodeDialogKind = kind;
    button.dataset.opencodeDialogValue = option.id;
    button.disabled = Boolean(option.disabled);
    button.tabIndex = option.id === openCodeDialogActiveOptionId(kind) ? 0 : -1;
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
    const sidebarVisible = profile?.id === 'opencode';
    sidebar.hidden = !sidebarVisible;
    document.body.classList.toggle('is-sidebar-visible', sidebarVisible);
    sidebar.innerHTML = '';
    if (!sidebarVisible) {
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
    return taskBoardState.statusCounts(source);
  }

  function isActiveTask(task) {
    return taskBoardState.isActiveTask(task);
  }

  function visibleTasksForBoard() {
    return taskBoardState.visibleTasks(tasks, {
      enabled: VISUAL_TASK_BOARD_ENABLED,
      dismissed: taskBoardDismissed,
      limit: 12,
    });
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
    taskBoardState.TASK_STATUSES.filter((status) => counts[status] > 0).forEach((status) => {
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
    if (codexRendererEnabled) {
      syncCodexRendererContext();
      return;
    }
    const conversation = ensureConversation(activeId);
    const activeThread = ensureActiveThread(activeId);
    const messageThreadKey = `${activeId || 'none'}:${activeThread?.id || 'none'}`;
    const shouldStickToBottom = shouldAutoScrollMessages(messageThreadKey);
    const previousScrollTop = messages.scrollTop;
    const isPending = Boolean(pendingByProvider[activeId]);
    const activeConversationRunning = Boolean(runningByProvider[activeId] || pendingByProvider[activeId]);
    const selectedProfile = activeProfile();
    messages.innerHTML = '';

    if (profilesLoading) {
      syncMessageStatusTimer(false);
      appendProviderLoadingState();
      restoreMessageScroll(shouldStickToBottom, previousScrollTop, messageThreadKey);
      return;
    }

    if (!activeId || !selectedProfile) {
      syncMessageStatusTimer(false);
      appendCliSetupState();
      restoreMessageScroll(shouldStickToBottom, previousScrollTop, messageThreadKey);
      return;
    }

    if (conversation.length === 0 && !isPending) {
      syncMessageStatusTimer(false);
      if (!selectedProfile.installed) {
        appendCliSetupState(selectedProfile);
        restoreMessageScroll(shouldStickToBottom, previousScrollTop, messageThreadKey);
        return;
      }

      if (selectedProfile.id === 'claude') {
        appendClaudeCodeHeader();
        appendClaudeEmptyState();
      } else {
        appendEmptyState(i18n.t('empty.title'), i18n.t('empty.subtitle'));
      }
      restoreMessageScroll(shouldStickToBottom, previousScrollTop, messageThreadKey);
      return;
    }

    if (selectedProfile.id === 'claude') {
      appendClaudeCodeHeader();
    }

    let hasVisibleRunningMessage = false;
    for (let index = 0; index < conversation.length; index += 1) {
      const item = conversation[index];
      const itemRunning = Boolean(item.running && runningByProvider[activeId]);
      hasVisibleRunningMessage = hasVisibleRunningMessage || itemRunning;
      const wrapper = document.createElement('div');
      wrapper.className = `message ${item.role}${itemRunning ? ' is-running' : ''}`;
      wrapper.dataset.messageIndex = String(index);

      const bubble = document.createElement('div');
      bubble.className = 'message-bubble';
      const baseDetailKey = messageDetailKey(activeId, activeThread?.id, index, 'message');

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
      const hasAssistantThinking = item.role === 'assistant' && Boolean(normalizeMessageText(item.thinking).trim());
      const hasAssistantActivity = hasOpenCodeActivity(item.activity);
      const hasInlineAssistantActivity = hasOpenCodeActivityTimeline(item.activityTimeline);
      const showAssistantThinkingDetails = shouldShowAssistantThinkingDetails(
        hasAssistantThinking,
        hasAssistantActivity,
        hasInlineAssistantActivity
      );
      if (item.role === 'assistant' && showAssistantThinkingDetails) {
        appendMessageThinking(bubble, item.thinking, {
          activity: item.activity,
          suppressActivityDetails: hasInlineAssistantActivity,
          running: shouldShowThinkingRunningTimer(itemRunning, item),
          startedAt: item.startedAt,
          durationMs: item.durationMs,
          detailKey: messageDetailKey(activeId, activeThread?.id, index, 'thinking'),
        });
      }
      renderMarkdownWithActivity(
        body,
        normalizeMessageText(item.text),
        item.activity,
        item.activityTimeline,
        itemRunning,
        baseDetailKey
      );
      bubble.appendChild(body);

      if (Array.isArray(item.attachments) && item.attachments.length > 0) {
        appendMessageAttachments(bubble, item.attachments);
      }

      if (itemRunning) {
        appendMessageRunningStatus(bubble, item);
      } else {
        if (item.role === 'assistant') {
          appendMessageChoiceActions(bubble, item.text);
        }
        if (shouldShowAssistantCopyButton(conversation, index, activeConversationRunning)) {
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

  function shouldShowAssistantCopyButton(conversation, index, activeConversationRunning) {
    const item = conversation[index];
    if (activeConversationRunning || item?.role !== 'assistant' || !normalizeMessageText(item.text).trim()) {
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

  function runningMessageText(item) {
    return item.runningNotice ||
      runningMessageStatusText(
        item.text ? i18n.t('message.generating') : i18n.t('message.thinking'),
        item.startedAt
      );
  }

  function appendMessageRunningStatus(container, item) {
    appendMessageStatus(container, runningMessageText(item), true);
  }

  function syncMessageRunningStatusElement(container, item, itemRunning) {
    let status = container.querySelector(':scope > .message-status');
    if (!itemRunning) {
      status?.remove();
      return;
    }

    const text = runningMessageText(item);
    if (!status) {
      appendMessageRunningStatus(container, item);
      return;
    }

    status.classList.add('is-running');
    let label = status.querySelector('.message-status-label');
    if (!label) {
      label = document.createElement('span');
      label.className = 'message-status-label';
      status.appendChild(label);
    }
    if (label.textContent !== text) {
      label.textContent = text;
    }
  }

  function syncMessageThinkingSummaryLabel(container, item, index, itemRunning) {
    const thinking = container.querySelector(':scope > .message-thinking');
    const label = thinking?.querySelector(':scope > .message-thinking-summary .message-thinking-label');
    if (!label) {
      return;
    }

    const text = openCodeThinkingSummaryText(
      item.activity,
      shouldShowThinkingRunningTimer(itemRunning, item),
      item.startedAt,
      item.durationMs
    );
    if (label.textContent !== text) {
      label.textContent = text;
    }

    const activeThread = ensureActiveThread(activeId);
    applyMessageDetailOpenState(thinking, messageDetailKey(activeId, activeThread?.id, index, 'thinking'));
  }

  function syncVisibleRunningMessageStatuses() {
    const conversation = ensureConversation(activeId);
    const providerRunning = Boolean(runningByProvider[activeId]);
    let hasVisibleRunningMessage = false;

    messages.querySelectorAll('.message[data-message-index]').forEach((wrapper) => {
      const index = Number(wrapper.dataset.messageIndex);
      const item = conversation[index];
      if (!item) {
        return;
      }

      const itemRunning = Boolean(item.running && providerRunning);
      hasVisibleRunningMessage = hasVisibleRunningMessage || itemRunning;
      const bubble = wrapper.querySelector(':scope > .message-bubble');
      if (!bubble) {
        return;
      }

      syncMessageRunningStatusElement(bubble, item, itemRunning);
      if (item.role === 'assistant') {
        syncMessageThinkingSummaryLabel(bubble, item, index, itemRunning);
      }
    });

    return hasVisibleRunningMessage;
  }

  function shouldShowAssistantThinkingDetails(hasThinking, hasActivity, hasInlineActivity) {
    return Boolean(hasThinking || (hasActivity && !hasInlineActivity));
  }

  function shouldShowThinkingRunningTimer(itemRunning, item) {
    return Boolean(itemRunning && !normalizeMessageText(item?.text).trim());
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
        if (!syncVisibleRunningMessageStatuses()) {
          syncMessageStatusTimer(false);
        }
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

  function formatDurationMs(durationMs) {
    const duration = conversationStore.normalizeDurationMs(durationMs);
    if (duration === undefined) {
      return '';
    }

    const totalSeconds = Math.floor(duration / 1000);
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}m ${seconds}s`;
  }

  function completedMessageDurationMs(startedAt) {
    const start = Number(startedAt);
    if (!Number.isFinite(start) || start <= 0) {
      return undefined;
    }

    return conversationStore.normalizeDurationMs(Date.now() - start);
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

  function appendCliSetupState(fallbackProfile) {
    const setupList = setupProfilesForOnboarding();
    const recommended = recommendedSetupProfile(setupList)
      || normalizeSetupProfile(fallbackProfile);
    if (setupList.length === 0 && !recommended) {
      appendEmptyState(
        i18n.t('provider.noInstalled'),
        i18n.t('provider.unavailable'),
        true
      );
      return;
    }

    const empty = document.createElement('div');
    empty.className = 'empty-state cli-setup-state';

    const title = document.createElement('div');
    title.className = 'empty-title';
    title.textContent = i18n.t('setup.title');
    empty.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.className = 'empty-subtitle';
    subtitle.textContent = i18n.t('setup.subtitle');
    empty.appendChild(subtitle);

    const cards = document.createElement('div');
    cards.className = 'cli-setup-list';
    for (const profile of setupList) {
      cards.appendChild(createCliSetupCard(profile, profile.id === recommended?.id));
    }
    empty.appendChild(cards);

    const footer = document.createElement('div');
    footer.className = 'suggestion-list cli-setup-footer';
    [
      ['refreshProviders', 'setup.refresh'],
      ['copyInstall', 'setup.copyRecommended'],
      ['openSettings', 'setup.openSettings'],
    ].forEach(([action, labelKey]) => {
      const button = document.createElement('button');
      button.className = 'suggestion-button';
      button.dataset.action = action;
      if (action === 'copyInstall' && recommended?.installHint) {
        button.dataset.installCommand = recommended.installHint;
      }
      if (action === 'openSettings') {
        button.dataset.settingsSection = 'agents';
      }
      button.textContent = i18n.t(labelKey);
      footer.appendChild(button);
    });
    empty.appendChild(footer);
    messages.appendChild(empty);
  }

  function createCliSetupCard(profile, recommended) {
    const card = document.createElement('div');
    card.className = 'cli-setup-card';
    if (recommended) {
      card.classList.add('is-recommended');
    }
    card.dataset.cliId = profile.id;

    const header = document.createElement('div');
    header.className = 'cli-setup-card-header';

    const icon = document.createElement('span');
    icon.className = 'cli-setup-icon';
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
    header.appendChild(icon);

    const heading = document.createElement('div');
    heading.className = 'cli-setup-heading';
    const name = document.createElement('div');
    name.className = 'cli-setup-name';
    name.textContent = profile.name;
    heading.appendChild(name);
    const badge = document.createElement('div');
    badge.className = 'cli-setup-badge';
    badge.textContent = recommended ? i18n.t('setup.recommendedBadge') : i18n.t('provider.missing');
    heading.appendChild(badge);
    header.appendChild(heading);
    card.appendChild(header);

    const description = document.createElement('div');
    description.className = 'cli-setup-description';
    description.textContent = recommended
      ? i18n.t('setup.openCodeDescription')
      : profile.description;
    card.appendChild(description);

    const command = document.createElement('code');
    command.className = 'cli-setup-command';
    command.textContent = profile.installHint;
    card.appendChild(command);

    const actions = document.createElement('div');
    actions.className = 'cli-setup-actions';

    const installButton = document.createElement('button');
    installButton.className = 'suggestion-button';
    if (recommended) {
      installButton.classList.add('suggestion-button--primary');
    }
    installButton.dataset.action = 'installCli';
    installButton.dataset.cliId = profile.id;
    installButton.textContent = recommended
      ? i18n.t('setup.installRecommended')
      : i18n.t('setup.installCli', { provider: profile.name });
    actions.appendChild(installButton);

    const copyButton = document.createElement('button');
    copyButton.className = 'suggestion-button cli-setup-copy';
    copyButton.dataset.action = 'copyInstall';
    copyButton.dataset.installCommand = profile.installHint;
    copyButton.textContent = i18n.t('empty.copyInstall');
    actions.appendChild(copyButton);

    card.appendChild(actions);
    return card;
  }

  function appendClaudeCodeHeader() {
    const header = document.createElement('div');
    header.className = 'claude-code-header';

    const mark = document.createElement('span');
    mark.className = 'claude-code-mark';
    mark.setAttribute('aria-hidden', 'true');
    header.appendChild(mark);

    const label = document.createElement('span');
    label.textContent = i18n.t('claude.header');
    header.appendChild(label);

    messages.appendChild(header);
  }

  function appendClaudeEmptyState() {
    const empty = document.createElement('div');
    empty.className = 'claude-empty-state';

    const mark = document.createElement('div');
    mark.className = 'claude-empty-mark';
    mark.setAttribute('aria-hidden', 'true');
    empty.appendChild(mark);

    const title = document.createElement('div');
    title.className = 'claude-empty-title';
    title.textContent = i18n.t('claude.empty.title');
    empty.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.className = 'claude-empty-subtitle';
    subtitle.textContent = i18n.t('claude.empty.subtitle');
    empty.appendChild(subtitle);

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
    appendMessageStatus(bubble, text, true);

    wrapper.appendChild(bubble);
    messages.appendChild(wrapper);
  }

  function appendMessageStatus(container, text, running = false) {
    const status = document.createElement('div');
    status.className = 'message-status';
    status.classList.toggle('is-running', running);

    const spinner = document.createElement('span');
    spinner.className = 'message-spinner';
    status.appendChild(spinner);

    const label = document.createElement('span');
    label.className = 'message-status-label';
    label.textContent = text;
    status.appendChild(label);

    container.appendChild(status);
  }

  function renderWorkflowMode() {
    renderAgentModeSelect();
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
    modeMenu?.classList.toggle(
      'is-visible',
      providerCapabilities.controlVisibility(profile, 'agentMode', { translate: (labelKey) => i18n.t(labelKey) })
    );
    modeMenu?.classList.toggle(
      'is-default',
      Boolean(profile && mode?.id === normalizeAgentModeId(profile, profile?.defaultAgentMode))
    );
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

  function focusAgentModeOption(modeId) {
    const buttons = Array.from(agentModeOptionList?.querySelectorAll('.option-list-item') || []);
    const button = buttons.find((item) => item.dataset.value === modeId);
    button?.focus();
  }

  function setActiveAgentMode(value, options = {}) {
    activeAgentModeByProvider[activeId] = value;
    agentModeSelect.value = value;
    legacyWorkflowMode = undefined;
    persist();
    persistUserSelection();
    renderAll();
    if (options.keepMenuOpen && modeMenu) {
      modeMenu.open = true;
      requestAnimationFrame(() => focusAgentModeOption(value));
    }
  }

  function switchAgentModeByDelta(delta) {
    const profile = activeProfile();
    const modes = agentModesFor(profile).filter((mode) => !mode.disabled);
    if (modes.length <= 1) {
      return;
    }

    const currentId = activeAgentModeId(activeId);
    const currentIndex = Math.max(0, modes.findIndex((mode) => mode.id === currentId));
    const next = modes[(currentIndex + delta + modes.length) % modes.length];
    setActiveAgentMode(next.id, { keepMenuOpen: true });
  }

  function renderContextControls() {
    document.querySelectorAll('[data-context]').forEach((checkbox) => {
      checkbox.checked = Boolean(contextOptions[checkbox.dataset.context]);
    });
  }

  function renderComposer() {
    const profile = activeProfile();
    const selectedAction = actionSelect.value || 'freeform';
    const state = composerState.deriveComposerState({
      profile,
      activeId,
      running: runningByProvider[activeId],
      pending: pendingByProvider[activeId],
      promptText: input.value,
      attachmentCount: promptAttachments.length,
      selectedAction,
      requiresSelection: actionRequiresSelection(selectedAction),
      hasSelection: hasSelectionContext(),
      installedProviderCount: visibleInstalledProfiles().length,
      profilesLoading,
      translate: (key, values) => i18n.t(key, values),
      actionLabel,
    });
    input.disabled = state.inputDisabled;
    sendBtn.disabled = state.sendDisabled;
    document.querySelectorAll('[data-action]').forEach((button) => {
      const action = button.dataset.action;
      const actionState = composerState.actionButtonState(
        action,
        state,
        actionRequiresSelection(action),
        hasSelectionContext()
      );
      button.disabled = actionState.disabled;
      button.title = actionState.missingSelection && actionState.disabled
        ? i18n.t('quick.missingSelection')
        : '';
    });
    actionSelect.disabled = state.actionSelectDisabled;
    providerSelect.disabled = state.providerSelectDisabled;
    threadSelect.disabled = state.threadSelectDisabled;
    agentModeSelect.disabled = state.optionSelectDisabled;
    if (attachImageBtn) {
      attachImageBtn.disabled = state.attachmentDisabled;
    }
    if (imageFileInput) {
      imageFileInput.disabled = state.attachmentDisabled;
    }
    input.placeholder = state.placeholder;
    stopBtn.hidden = !state.running;
    sendBtn.hidden = state.running;
    stopBtn.classList.toggle('is-visible', state.running);
    sendBtn.classList.toggle('is-hidden', state.running);
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

  function mountCodexRenderer() {
    if (!codexRendererEnabled || !messages) {
      return;
    }
    const thread = activeId ? ensureActiveThread(activeId) : null;
    codexRenderer.mount({
      container: messages,
      providerId: activeId,
      threadId: thread?.id || '',
      snapshot: saved.conversationSnapshot,
      legacyThreads: threadsByProvider,
      activeThreadByProvider,
      persist: () => persist(),
      renderMarkdown: (container, item) => {
        renderMarkdownWithActivity(
          container,
          normalizeMessageText(item.content),
          item.activity,
          undefined,
          item.status === 'running',
          `${item.turnId}:${item.id}`
        );
      },
      onDisable: () => vscode.postMessage({ command: 'disableCodexRenderer' }),
    });
    for (const [providerId, threads] of Object.entries(threadsByProvider)) {
      for (const item of threads) {
        codexRenderer.ensureThread(providerId, item.id, item.title, item.updatedAt);
      }
    }
    vscode.postMessage({ command: 'codexRendererReady' });
  }

  function syncCodexRendererContext() {
    if (!codexRendererEnabled || !activeId) {
      return;
    }
    const thread = ensureActiveThread(activeId);
    if (!thread) {
      return;
    }
    codexRenderer.ensureThread(activeId, thread.id, thread.title, thread.updatedAt);
    codexRenderer.setActiveContext(activeId, thread.id);
  }

  /**
   * Main render function - called by stateManager on state changes
   * Also called directly for backward compatibility during migration
   */
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
    renderSessionHistory();
    renderWorkflowMode();
    renderContextControls();
    renderProviderHint();
    renderContextSummaryLabel();
    renderContextBudget();
    renderOpenCodeSidebar();
    renderOpenCodeStatusDialog();
    if (codexRendererEnabled) {
      syncCodexRendererContext();
    } else {
      renderMessages();
    }
    renderAttachmentStrip();
    renderComposer();
    if (apiSettingsPage && !apiSettingsPage.hidden) {
      renderSettingsPage();
    }
  }

  // Set up stateManager render callback (progressive migration)
  if (stateManager) {
    stateManager.setRenderCallback(renderAll);
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
    if (providerRunState.isProviderBusy(providerRunStore, providerId)) {
      return false;
    }

    const task = createRunTask(providerId, action, text, preferredWorkflowMode);
    providerRunState.setProviderPending(providerRunStore, providerId, activeThreadId(providerId), task.id);
    renderAll();

    vscode.postMessage({
      command: 'send',
      cliId: providerId,
      text: text,
      mode: 'agent',
      agentMode: preferredWorkflowMode || activeAgentModeId(providerId),
      action: action,
      attachments,
      threadId: activeThreadId(providerId),
      conversationHistory: conversationHistoryForSend(providerId),
      contextOptions: defaultContextOptions(),
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
    renderSessionHistory();
    return { threadId: thread?.id || '', index: conversation.length - 1 };
  }

  function appendShellFeedback(cliId, role, text, threadId) {
    const targetThreadId = threadId || activeThreadId(cliId);
    if (codexRendererEnabled && targetThreadId) {
      codexRenderer.appendFeedback(
        cliId,
        targetThreadId,
        normalizeMessageText(text),
        role === 'error'
      );
      return;
    }
    addMessage(cliId, role, text, undefined, false, targetThreadId);
  }

  function mergeStreamText(current, chunk) {
    const existing = normalizeMessageText(current);
    const incoming = normalizeMessageText(chunk);
    if (!incoming) {
      return existing || '';
    }
    if (!existing) {
      return incoming;
    }
    if (incoming === existing) {
      return existing;
    }
    if (incoming.startsWith(existing)) {
      return incoming;
    }
    if (existing.endsWith(incoming) && incoming.length > 32) {
      return existing;
    }

    return `${existing}${incoming}`;
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
    if (Array.isArray(message.activities) && message.activities.length > 0) {
      updateStreamActivity(message);
      if (!message.thinking && !normalizeMessageText(message.text).trim()) {
        return;
      }
    }

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

    const buffered = mergeStreamText(target.buffer || item.text || '', message.text);
    const filtered = filterInternalPromptEcho(buffered);
    target.buffer = filtered.pending ? buffered : filtered.text;
    const fullText = filtered.text;
    if (normalizeMessageText(message.text).trim()) {
      delete item.runningNotice;
    }
    if (message.stream === 'error') {
      item.role = 'error';
      updateTaskStatus(taskBySessionId[message.sessionId], { status: 'failed' });
    }
    persist();
    revealStreamText(target, item, fullText);
  }

  /**
   * Reveal streamed text via paced throttle to avoid layout thrash.
   * Small deltas (≤ 512 chars) render immediately; large bursts are throttled
   * with an adaptive step that snaps to word boundaries.
   */
  function revealStreamText(target, item, fullText) {
    if (target.cliId !== activeId || target.threadId !== activeThreadId(activeId)) {
      // Inactive thread: set immediately, no animation needed.
      item.text = fullText;
      return;
    }

    if (!pacedReveal) {
      item.text = fullText;
      renderStreamTarget(target);
      return;
    }

    let controller = textPacedReveals[getSessionKey(target)];
    if (!controller) {
      controller = pacedReveal.createPacedReveal({
        onReveal(visibleText) {
          item.text = visibleText;
          renderStreamTarget(target);
        },
      });
      textPacedReveals[getSessionKey(target)] = controller;
    }
    controller.update(fullText);
  }

  function renderStreamTarget(target) {
    if (target.cliId !== activeId || target.threadId !== activeThreadId(activeId)) {
      return;
    }
    if (!renderActiveStreamMessage(target)) {
      renderMessages();
    }
  }

  function getSessionKey(target) {
    return `${target.cliId}:${target.threadId}:${target.index}`;
  }

  function updateStreamThinking(message) {
    const target = ensureStreamTarget(message);
    const item = ensureConversation(target.cliId, target.threadId)[target.index];
    if (!item) {
      return;
    }

    noteOpenCodeSessionId(message.cliId, target.threadId, message.openCodeSessionId);
    const existingThinking = target.thinkingBuffer ?? item.thinking ?? '';
    target.thinkingBuffer = mergeStreamText(existingThinking, message.thinking);
    const filtered = filterInternalPromptEcho(target.thinkingBuffer);
    const fullThinking = filtered.pending ? '' : sanitizeThinkingText(filtered.text);
    if (!filtered.pending) {
      target.thinkingBuffer = fullThinking;
    }
    persist();

    if (target.cliId !== activeId || target.threadId !== activeThreadId(activeId)) {
      item.thinking = fullThinking;
      return;
    }
    if (!pacedReveal) {
      item.thinking = fullThinking;
      renderStreamTarget(target);
      return;
    }
    const key = getSessionKey(target);
    let controller = thinkingPacedReveals[key];
    if (!controller) {
      controller = pacedReveal.createPacedReveal({
        onReveal(visible) {
          item.thinking = visible;
          renderStreamTarget(target);
        },
      });
      thinkingPacedReveals[key] = controller;
    }
    controller.update(fullThinking);
  }

  function updateStreamActivity(message) {
    const target = ensureStreamTarget(message);
    const item = ensureConversation(target.cliId, target.threadId)[target.index];
    if (!item) {
      return;
    }

    noteOpenCodeSessionId(message.cliId, target.threadId, message.openCodeSessionId);
    item.activity = mergeOpenCodeActivity(item.activity, message.activities);
    item.activityTimeline = mergeOpenCodeActivityTimeline(
      item.activityTimeline,
      message.activities,
      normalizeMessageText(item.text).length
    );
    persist();
    if (target.cliId === activeId && target.threadId === activeThreadId(activeId)) {
      if (!renderActiveStreamMessage(target)) {
        renderMessages();
      }
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

  function finishStreamTarget(message, { removeEmpty = true } = {}) {
    const target = streamTargets[message.sessionId];
    if (target) {
      noteOpenCodeSessionId(message.cliId, target.threadId, message.openCodeSessionId);
      const conversation = ensureConversation(target.cliId, target.threadId);
      const item = conversation[target.index];
      if (item) {
        const finalText = finalStreamTargetText(target, item);
        if (finalText) {
          item.text = finalText;
        }
        item.running = false;
        const durationMs = completedMessageDurationMs(item.startedAt);
        if (durationMs === undefined) {
          delete item.durationMs;
        } else {
          item.durationMs = durationMs;
        }
        item.thinking = sanitizeThinkingText(target.thinkingBuffer ?? item.thinking);
        delete item.runningNotice;
        if (removeEmpty && isEmptyAssistantStreamMessage(item)) {
          conversation.splice(target.index, 1);
        }
      }
      delete streamTargets[message.sessionId];
      disposePacedReveals(target);
    }

    return target;
  }

  /**
   * Flush and dispose paced reveal controllers for a stream target.
   * Called when a session ends or is stopped so no pending timers remain.
   */
  function disposePacedReveals(target) {
    const key = getSessionKey(target);
    const textController = textPacedReveals[key];
    if (textController) {
      textController.finish();
      textController.dispose();
      delete textPacedReveals[key];
    }
    const thinkingController = thinkingPacedReveals[key];
    if (thinkingController) {
      thinkingController.finish();
      thinkingController.dispose();
      delete thinkingPacedReveals[key];
    }
  }

  function finalStreamTargetText(target, item) {
    const candidates = [
      target?.buffer,
      item?.text,
    ];
    for (const candidate of candidates) {
      const filtered = filterInternalPromptEcho(candidate);
      const text = filtered.pending ? normalizeMessageText(candidate) : filtered.text;
      if (normalizeMessageText(text).trim()) {
        return text;
      }
    }
    return '';
  }

  function isEmptyAssistantStreamMessage(item) {
    return !normalizeMessageText(item?.text).trim()
      && !sanitizeThinkingText(item?.thinking).trim()
      && !hasOpenCodeActivity(item?.activity)
      && !hasOpenCodeActivityTimeline(item?.activityTimeline);
  }

  function markSessionEnded(message) {
    const wasStopped = stoppedSessionIds.delete(message.sessionId);
    const target = finishStreamTarget(message);
    updateTaskStatus(taskBySessionId[message.sessionId], {
      status: wasStopped ? 'stopped' : (Number(message.exitCode) === 0 ? 'completed' : 'failed'),
    });
    delete taskBySessionId[message.sessionId];
    providerRunState.clearProviderRunState(providerRunStore, message.cliId);
    if (Number(message.exitCode) !== 0 && !wasStopped) {
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

  function markCodexSessionEnded(message) {
    const wasStopped = stoppedSessionIds.delete(message.sessionId);
    updateTaskStatus(taskBySessionId[message.sessionId], {
      status: wasStopped ? 'stopped' : (Number(message.exitCode) === 0 ? 'completed' : 'failed'),
    });
    delete taskBySessionId[message.sessionId];
    providerRunState.clearProviderRunState(providerRunStore, message.cliId);
    persist();
    renderAll();
  }

  function restoreRendererRuntimeSnapshot(rawRuns) {
    const runs = (Array.isArray(rawRuns) ? rawRuns : []).filter((run) => (
      run &&
      typeof run.providerId === 'string' &&
      typeof run.threadId === 'string' &&
      typeof run.sessionId === 'string'
    ));
    const activeProviders = new Set(runs.map((run) => run.providerId));
    for (const providerId of new Set([
      ...Object.keys(runningByProvider),
      ...Object.keys(pendingByProvider),
    ])) {
      if (!activeProviders.has(providerId)) {
        providerRunState.clearProviderRunState(providerRunStore, providerId);
      }
    }

    taskBySessionId = {};
    for (const run of runs) {
      providerRunState.markProviderRunning(providerRunStore, run.providerId);
      activeThreadByProvider[run.providerId] = run.threadId;
      codexRenderer?.ensureThread(run.providerId, run.threadId);

      let task = tasks.find((item) => (
        item.providerId === run.providerId &&
        item.threadId === run.threadId &&
        (item.status === 'running' || item.status === 'preparing' || item.status === 'stopped')
      ));
      if (!task) {
        const profile = profiles.find((item) => item.id === run.providerId);
        const thread = codexThreadSummary(run.providerId, run.threadId);
        task = taskBoardState.createTask({
          providerId: run.providerId,
          providerName: profile?.name || run.providerId,
          title: thread?.title || i18n.t('task.untitled'),
          action: 'freeform',
          agentMode: '',
          status: 'running',
          threadId: run.threadId,
          now: Date.now(),
        });
        tasks = taskBoardState.upsertRecentTask(tasks, task, { limit: 20 });
      }
      Object.assign(task, {
        status: 'running',
        sessionId: run.sessionId,
        threadId: run.threadId,
        updatedAt: Date.now(),
      });
      taskBySessionId[run.sessionId] = task.id;
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

  function mergeMessageMeta(...values) {
    return values
      .map((value) => normalizeMessageText(value))
      .filter(Boolean)
      .join(i18n.t('message.metaSeparator')) || undefined;
  }

  function messageDetailKey(cliId, threadId, index, kind, localKey = '') {
    return [
      normalizeMessageText(cliId || 'none'),
      normalizeMessageText(threadId || 'none'),
      String(Math.max(0, Number(index) || 0)),
      normalizeMessageText(kind || 'detail'),
      normalizeMessageText(localKey || ''),
    ].join(':');
  }

  function syncMessageDetailOpenState(detail) {
    const key = detail?.dataset?.messageDetailKey;
    if (!key) {
      return;
    }

    if (detail.open) {
      openMessageDetailKeys.add(key);
    } else {
      openMessageDetailKeys.delete(key);
    }
  }

  function applyMessageDetailOpenState(detail, key) {
    if (!detail || !key) {
      return;
    }

    detail.dataset.messageDetailKey = key;
    detail.open = openMessageDetailKeys.has(key);
    if (!detail.dataset.messageDetailListening) {
      detail.dataset.messageDetailListening = 'true';
      detail.addEventListener('toggle', () => syncMessageDetailOpenState(detail));
    }
  }

  function renderActiveStreamMessage(target) {
    if (!target || target.cliId !== activeId || target.threadId !== activeThreadId(activeId)) {
      return false;
    }

    const conversation = ensureConversation(target.cliId, target.threadId);
    const item = conversation[target.index];
    const wrapper = messages.querySelector(`.message[data-message-index="${target.index}"]`);
    const bubble = wrapper?.querySelector('.message-bubble');
    const body = bubble?.querySelector('.message-content');
    if (!item || !wrapper || !bubble || !body) {
      return false;
    }

    const messageThreadKey = `${activeId || 'none'}:${target.threadId || 'none'}`;
    const shouldStickToBottom = shouldAutoScrollMessages(messageThreadKey);
    const previousScrollTop = messages.scrollTop;
    const itemRunning = Boolean(item.running && runningByProvider[activeId]);
    const hasAssistantThinking = item.role === 'assistant' && Boolean(normalizeMessageText(item.thinking).trim());
    const hasAssistantActivity = hasOpenCodeActivity(item.activity);
    const hasInlineAssistantActivity = hasOpenCodeActivityTimeline(item.activityTimeline);
    const showAssistantThinkingDetails = shouldShowAssistantThinkingDetails(
      hasAssistantThinking,
      hasAssistantActivity,
      hasInlineAssistantActivity
    );
    const baseDetailKey = messageDetailKey(target.cliId, target.threadId, target.index, 'message');

    wrapper.className = `message ${item.role}${itemRunning ? ' is-running' : ''}`;
    if (item.role === 'assistant' && showAssistantThinkingDetails) {
      syncMessageThinkingElement(bubble, item.thinking, {
        activity: item.activity,
        suppressActivityDetails: hasInlineAssistantActivity,
        running: shouldShowThinkingRunningTimer(itemRunning, item),
        startedAt: item.startedAt,
        durationMs: item.durationMs,
        detailKey: messageDetailKey(target.cliId, target.threadId, target.index, 'thinking'),
      });
    } else {
      bubble.querySelector(':scope > .message-thinking')?.remove();
    }

    body.replaceChildren();
    renderMarkdownWithActivity(
      body,
      normalizeMessageText(item.text),
      item.activity,
      item.activityTimeline,
      itemRunning,
      baseDetailKey
    );
    syncMessageRunningStatusElement(bubble, item, itemRunning);
    if (itemRunning || Boolean(runningByProvider[activeId] || pendingByProvider[activeId])) {
      bubble.querySelector(':scope > .message-actions')?.remove();
      bubble.querySelector(':scope > .message-choice-actions')?.remove();
    } else if (item.role === 'assistant') {
      appendMessageChoiceActions(bubble, item.text);
    }
    restoreMessageScroll(shouldStickToBottom, previousScrollTop, messageThreadKey);
    return true;
  }

  function appendMessageChoiceActions(bubble, text) {
    const choices = messageChoices?.extractMessageChoices
      ? messageChoices.extractMessageChoices(text, {
        promptForChoice: (index, label) => i18n.t('message.choice.prompt', { index, label }),
      })
      : [];
    bubble.querySelector(':scope > .message-choice-actions')?.remove();
    if (choices.length === 0) {
      return;
    }

    const actions = document.createElement('div');
    actions.className = 'message-choice-actions';
    actions.setAttribute('role', 'group');
    actions.setAttribute('aria-label', i18n.t('message.choice.label'));

    for (const choice of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'message-choice-button';
      button.dataset.messageChoicePrompt = choice.prompt;
      button.title = choice.prompt;
      const index = document.createElement('span');
      index.className = 'message-choice-index';
      index.textContent = choice.index;
      const label = document.createElement('span');
      label.className = 'message-choice-label';
      label.textContent = choice.label;
      button.append(index, label);
      actions.appendChild(button);
    }

    bubble.appendChild(actions);
  }

  function extractClaudeApprovalRequest(text) {
    const source = normalizeMessageText(text).trim();
    if (!source) {
      return undefined;
    }

    const lines = source
      .split('\n')
      .map((line) => stripInlineMarkdown(line).trim())
      .filter(Boolean);
    if (lines.length === 0) {
      return undefined;
    }

    const titleIndex = lines.findIndex((line) => isClaudeApprovalTitle(line));
    const choices = extractClaudeApprovalChoices(lines);
    const hasDefaultChoiceSet = choices.some((choice) => choice.normalized === 'yes') &&
      choices.some((choice) => choice.normalized === 'yes, allow all edits this session') &&
      choices.some((choice) => choice.normalized === 'no');
    const hasPermissionSignal = /\b(?:permission|approval|approve|allow|edit|write|run|execute)\b/i.test(source) ||
      /(?:确认|允许|批准|修改|编辑|执行|运行)/.test(source);

    if (titleIndex < 0 && !(hasDefaultChoiceSet && hasPermissionSignal)) {
      return undefined;
    }

    const title = titleIndex >= 0
      ? lines[titleIndex]
      : i18n.t('claude.approval.defaultTitle');
    const normalizedChoices = normalizeClaudeApprovalChoices(choices);
    const key = [
      'claude-approval',
      title,
      ...normalizedChoices.map((choice) => choice.label),
    ].join('|');

    return {
      key,
      title,
      choices: normalizedChoices,
    };
  }

  function isClaudeApprovalTitle(line) {
    const source = String(line || '').trim();
    return /^Make this edit(?:\s+to\s+.+)?\?$/i.test(source) ||
      /^(?:Approve|Allow|Run|Execute|Write|Edit)\b.+\?$/i.test(source) ||
      /\b(?:permission|approval)\b.+\?$/i.test(source) ||
      /^(?:确认|允许|批准|执行|运行|修改|编辑).+[？?]$/.test(source);
  }

  function extractClaudeApprovalChoices(lines) {
    const choices = [];
    for (const line of lines) {
      const match = /^(?:([1-9])[\).、]?\s+)?(Yes, allow all edits this session|Yes|No)$/i.exec(line);
      if (!match) {
        continue;
      }

      const label = match[2].replace(/\s+/g, ' ').trim();
      choices.push({
        index: match[1] || String(choices.length + 1),
        label,
        normalized: label.toLowerCase(),
        prompt: label,
      });
    }

    return choices;
  }

  function normalizeClaudeApprovalChoices(choices) {
    const byLabel = new Map((choices || []).map((choice) => [choice.normalized, choice]));
    return [
      { index: '1', label: i18n.t('claude.approval.yes'), normalized: 'yes', prompt: 'Yes' },
      {
        index: '2',
        label: i18n.t('claude.approval.yesSession'),
        normalized: 'yes, allow all edits this session',
        prompt: 'Yes, allow all edits this session',
      },
      { index: '3', label: i18n.t('claude.approval.no'), normalized: 'no', prompt: 'No' },
    ].map((fallback) => {
      const matched = byLabel.get(fallback.normalized);
      return matched
        ? { ...fallback, index: matched.index || fallback.index, label: matched.label || fallback.label }
        : fallback;
    });
  }

  function appendClaudeApprovalPanel(container, approval) {
    const panel = document.createElement('div');
    panel.className = 'claude-approval-panel';
    panel.dataset.claudeApprovalKey = approval.key;
    panel.tabIndex = -1;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', approval.title);
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissClaudeApproval(approval.key);
      }
    });

    const title = document.createElement('div');
    title.className = 'claude-approval-title';
    title.textContent = approval.title;
    panel.appendChild(title);

    const choices = document.createElement('div');
    choices.className = 'claude-approval-choices';
    choices.setAttribute('role', 'listbox');
    choices.setAttribute('aria-label', i18n.t('claude.approval.choices'));

    approval.choices.forEach((choice, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `claude-approval-choice${index === 0 ? ' is-selected' : ''}`;
      button.dataset.claudeApprovalPrompt = choice.prompt;
      button.dataset.claudeApprovalKey = approval.key;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', index === 0 ? 'true' : 'false');

      const number = document.createElement('span');
      number.className = 'claude-approval-choice-number';
      number.textContent = choice.index;

      const label = document.createElement('span');
      label.className = 'claude-approval-choice-label';
      label.textContent = choice.label;

      button.append(number, label);
      choices.appendChild(button);
    });
    panel.appendChild(choices);

    const fallback = document.createElement('input');
    fallback.className = 'claude-approval-input';
    fallback.type = 'text';
    fallback.autocomplete = 'off';
    fallback.spellcheck = false;
    fallback.placeholder = i18n.t('claude.approval.placeholder');
    fallback.dataset.claudeApprovalKey = approval.key;
    fallback.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissClaudeApproval(approval.key);
        return;
      }

      if (event.key === 'Enter') {
        const value = fallback.value.trim();
        if (value) {
          event.preventDefault();
          submitClaudeApprovalPrompt(value, approval.key);
        }
      }
    });
    panel.appendChild(fallback);

    const hint = document.createElement('div');
    hint.className = 'claude-approval-hint';
    hint.textContent = i18n.t('claude.approval.cancelHint');
    panel.appendChild(hint);

    container.appendChild(panel);
  }

  function dismissClaudeApproval(key) {
    if (key) {
      dismissedClaudeApprovalKeys.add(key);
    }
    refreshAfterClaudeApproval(key);
    requestAnimationFrame(() => input.focus());
  }

  function submitClaudeApprovalPrompt(prompt, key) {
    const text = normalizeMessageText(prompt).trim();
    if (!text) {
      return;
    }

    if (key) {
      dismissedClaudeApprovalKeys.add(key);
    }

    if (runningByProvider[activeId] || pendingByProvider[activeId]) {
      addMessage(activeId, 'system', i18n.t('claude.approval.unavailable'));
      renderAll();
      refreshAfterClaudeApproval(key);
    } else {
      send('freeform', text);
    }
    requestAnimationFrame(() => input.focus());
  }

  function refreshAfterClaudeApproval(key) {
    if (!codexRendererEnabled) {
      renderMessages();
      return;
    }
    messages
      ?.querySelectorAll('.claude-approval-panel')
      .forEach((panel) => {
        if (!key || panel.dataset.claudeApprovalKey === key) {
          panel.remove();
        }
      });
  }

  function appendMessageThinking(bubble, text, options = {}) {
    const thinking = createMessageThinkingElement(text, options);
    if (thinking) {
      bubble.appendChild(thinking);
    }
  }

  function createMessageThinkingElement(text, options = {}) {
    const normalized = normalizeMessageText(text);
    const activity = normalizeOpenCodeActivity(options.activity);
    if (!normalized.trim() && !hasOpenCodeActivity(activity)) {
      return undefined;
    }

    const thinking = document.createElement('details');
    thinking.className = 'message-thinking';
    syncMessageThinkingElement(thinking, normalized, options);
    return thinking;
  }

  function syncMessageThinkingElement(parent, text, options = {}) {
    const normalized = normalizeMessageText(text);
    const activity = normalizeOpenCodeActivity(options.activity);
    let thinking = parent.classList?.contains('message-thinking')
      ? parent
      : parent.querySelector(':scope > .message-thinking');

    if (!thinking) {
      thinking = document.createElement('details');
      thinking.className = 'message-thinking';
      const content = parent.querySelector(':scope > .message-content');
      parent.insertBefore(thinking, content || null);
    }

    thinking.className = 'message-thinking';
    if (options.detailKey) {
      applyMessageDetailOpenState(thinking, options.detailKey);
    }

    let summary = thinking.querySelector(':scope > .message-thinking-summary');
    if (!summary) {
      summary = document.createElement('summary');
      summary.className = 'message-thinking-summary';
      summary.innerHTML = THINKING_ICON_SVG;
      const label = document.createElement('span');
      label.className = 'message-thinking-label';
      summary.appendChild(label);
      const chevron = document.createElement('span');
      chevron.className = 'message-thinking-chevron';
      chevron.innerHTML = THINKING_CHEVRON_SVG;
      summary.appendChild(chevron);
      thinking.appendChild(summary);
    }

    let label = summary.querySelector('.message-thinking-label');
    if (!label) {
      label = document.createElement('span');
      label.className = 'message-thinking-label';
      summary.appendChild(label);
    }
    label.textContent = openCodeThinkingSummaryText(activity, options.running, options.startedAt, options.durationMs);

    if (!summary.querySelector('.message-thinking-chevron')) {
      const chevron = document.createElement('span');
      chevron.className = 'message-thinking-chevron';
      chevron.innerHTML = THINKING_CHEVRON_SVG;
      summary.appendChild(chevron);
    }

    let body = thinking.querySelector(':scope > .message-thinking-body');
    if (!body) {
      body = document.createElement('div');
      body.className = 'message-thinking-body';
      thinking.appendChild(body);
    }
    body.innerHTML = '';
    const detailKey = options.detailKey || '';
    if (!options.suppressActivityDetails) {
      appendOpenCodeActivityDetails(body, activity.entries, detailKey ? `${detailKey}:activity` : '');
    }

    const thinkingText = sanitizeThinkingText(normalized);
    if (thinkingText) {
      const thinkingTextBlock = document.createElement('div');
      thinkingTextBlock.className = 'message-thinking-detail-text';
      thinkingTextBlock.textContent = thinkingText;
      body.appendChild(thinkingTextBlock);
    }
  }

  function normalizeOpenCodeActivity(activity) {
    const source = activity && typeof activity === 'object' ? activity : {};
    return {
      ids: uniqueStrings(source.ids).slice(-120),
      files: uniqueStrings(source.files).slice(-120),
      fileEvents: Math.max(0, Number(source.fileEvents) || 0),
      searches: Math.max(0, Number(source.searches) || 0),
      commands: Math.max(0, Number(source.commands) || 0),
      tools: Math.max(0, Number(source.tools) || 0),
      entries: Array.isArray(source.entries)
        ? source.entries.map(normalizeOpenCodeActivityEntry).filter(Boolean).slice(-40)
        : [],
    };
  }

  function mergeOpenCodeActivity(existing, activities) {
    const state = normalizeOpenCodeActivity(existing);
    const seen = new Set(state.ids);
    for (const activity of Array.isArray(activities) ? activities : []) {
      const entry = normalizeOpenCodeActivityEntry(activity);
      if (!entry) {
        continue;
      }

      const key = openCodeActivityEntryKey(entry);
      if (key && seen.has(key)) {
        const index = state.entries.findIndex((existingEntry) => openCodeActivityEntryKey(existingEntry) === key);
        if (index >= 0) {
          state.entries[index] = mergeOpenCodeActivityEntry(state.entries[index], entry);
        }
        continue;
      }
      if (key) {
        seen.add(key);
        state.ids.push(key);
      }

      if (entry.kind === 'file') {
        if (entry.target) {
          state.files = uniqueStrings([...state.files, entry.target]);
        } else {
          state.fileEvents += 1;
        }
      } else if (entry.kind === 'search') {
        state.searches += 1;
      } else if (entry.kind === 'command') {
        state.commands += 1;
      } else {
        state.tools += 1;
      }
      state.entries.push(entry);
    }

    state.ids = state.ids.slice(-120);
    state.entries = state.entries.slice(-40);
    return state;
  }

  function openCodeActivityEntryKey(entry, offset) {
    const normalized = normalizeOpenCodeActivityEntry(entry);
    if (!normalized) {
      return '';
    }

    const fallback = offset === undefined
      ? `${normalized.kind}:${normalized.name || ''}:${normalized.target || ''}`
      : `${normalized.kind}:${normalized.name || ''}:${normalized.target || ''}:${offset}`;
    return normalizeMessageText(normalized.id || fallback).trim();
  }

  function mergeOpenCodeActivityEntry(existing, next) {
    const current = normalizeOpenCodeActivityEntry(existing) || {};
    const incoming = normalizeOpenCodeActivityEntry(next) || {};
    return {
      kind: incoming.kind || current.kind || 'tool',
      id: incoming.id || current.id || '',
      name: incoming.name || current.name || '',
      target: incoming.target || current.target || '',
      detail: incoming.detail || current.detail || '',
    };
  }

  function normalizeOpenCodeActivityEntry(activity) {
    if (!activity || typeof activity !== 'object') {
      return undefined;
    }

    const kind = ['file', 'search', 'command', 'tool'].includes(activity.kind) ? activity.kind : 'tool';
    return {
      kind,
      id: normalizeMessageText(activity.id).trim(),
      name: normalizeMessageText(activity.name).trim(),
      target: normalizeMessageText(activity.target).trim(),
      detail: normalizeMessageText(activity.detail).trim(),
    };
  }

  function normalizeOpenCodeActivityTimeline(activityTimeline) {
    return (Array.isArray(activityTimeline) ? activityTimeline : [])
      .map((item) => {
        const entry = normalizeOpenCodeActivityEntry(item);
        if (!entry) {
          return undefined;
        }

        return {
          ...entry,
          offset: Math.max(0, Number(item.offset) || 0),
        };
      })
      .filter(Boolean)
      .slice(-80);
  }

  function mergeOpenCodeActivityTimeline(existing, activities, offset) {
    const timeline = normalizeOpenCodeActivityTimeline(existing);
    const indexByKey = new Map();
    timeline.forEach((entry, index) => {
      const key = openCodeActivityEntryKey(entry, entry.offset);
      if (key) {
        indexByKey.set(key, index);
      }
    });
    const seen = new Set(indexByKey.keys());
    const safeOffset = Math.max(0, Number(offset) || 0);

    for (const activity of Array.isArray(activities) ? activities : []) {
      const entry = normalizeOpenCodeActivityEntry(activity);
      if (!entry) {
        continue;
      }

      const key = openCodeActivityEntryKey(entry, safeOffset);
      if (key && seen.has(key)) {
        const index = indexByKey.get(key);
        if (Number.isInteger(index)) {
          timeline[index] = {
            ...mergeOpenCodeActivityEntry(timeline[index], entry),
            offset: timeline[index].offset,
          };
        }
        continue;
      }
      if (key) {
        seen.add(key);
        indexByKey.set(key, timeline.length);
      }

      timeline.push({ ...entry, offset: safeOffset });
    }

    return timeline.slice(-80);
  }

  function hasOpenCodeActivity(activity) {
    const state = normalizeOpenCodeActivity(activity);
    return openCodeActivityFileCount(state) > 0 || state.searches > 0 || state.commands > 0 || state.tools > 0;
  }

  function hasOpenCodeActivityTimeline(activityTimeline) {
    return normalizeOpenCodeActivityTimeline(activityTimeline).length > 0;
  }

  function openCodeActivityFileCount(activity) {
    const state = normalizeOpenCodeActivity(activity);
    return state.files.length + state.fileEvents;
  }

  function openCodeActivitySummaryText(activity, running, startedAt, durationMs) {
    const state = normalizeOpenCodeActivity(activity);
    const parts = [];
    const fileCount = openCodeActivityFileCount(state);
    if (fileCount > 0) {
      parts.push(i18n.t('message.activity.files', {
        count: String(fileCount),
        fileLabel: i18n.t(fileCount === 1 ? 'message.activity.file' : 'message.activity.filesLabel'),
      }));
    }
    if (state.searches > 0) {
      parts.push(i18n.t('message.activity.searches', { count: String(state.searches) }));
    }
    if (state.commands > 0) {
      parts.push(i18n.t('message.activity.commands', { count: String(state.commands) }));
    }
    if (state.tools > 0) {
      parts.push(i18n.t('message.activity.tools', { count: String(state.tools) }));
    }

    if (parts.length > 0) {
      return parts.join(' ');
    }

    if (running) {
      return runningMessageStatusText(i18n.t('message.activity.thinkingRunning'), startedAt);
    }

    const elapsed = formatDurationMs(durationMs);
    return elapsed
      ? i18n.t('message.statusElapsed', { status: i18n.t('message.activity.thinkingDone'), elapsed })
      : i18n.t('message.activity.thinking');
  }

  function openCodeThinkingSummaryText(activity, running, startedAt, durationMs) {
    const state = normalizeOpenCodeActivity(activity);
    const hasActivity = hasOpenCodeActivity(state);
    if (running) {
      return runningMessageStatusText(i18n.t('message.activity.thinkingRunning'), startedAt);
    }

    const status = hasActivity
      ? i18n.t('message.activity.processed')
      : i18n.t('message.activity.thinkingDone');
    const elapsed = formatDurationMs(durationMs);
    if (elapsed) {
      return i18n.t('message.statusElapsed', { status, elapsed });
    }

    return status || i18n.t('message.activity.thinking');
  }

  function openCodeActivityDetailLine(entry) {
    const target = entry.target || entry.name;
    if (!target) {
      return '';
    }

    const key = entry.kind === 'file'
      ? 'message.activity.detail.file'
      : entry.kind === 'search'
        ? 'message.activity.detail.search'
        : entry.kind === 'command'
          ? 'message.activity.detail.command'
          : 'message.activity.detail.tool';
    return i18n.t(key, { target });
  }

  function renderMarkdownWithActivity(container, text, activity, activityTimeline, running, baseDetailKey = '') {
    const normalized = normalizeMessageText(text);
    const claudeApproval = activeId === 'claude' ? extractClaudeApprovalRequest(normalized) : undefined;
    if (claudeApproval) {
      if (!dismissedClaudeApprovalKeys.has(claudeApproval.key)) {
        appendClaudeApprovalPanel(container, claudeApproval);
      }
      return;
    }

    const timeline = normalizeOpenCodeActivityTimeline(activityTimeline);
    const fallbackEntries = timeline.length > 0
      ? []
      : normalizeOpenCodeActivity(activity).entries.map((entry) => ({ ...entry, offset: 0 }));
    const activityEntries = timeline.length > 0 ? timeline : fallbackEntries;
    const choiceLineKeys = !running && messageChoices?.extractMessageChoiceLineKeys
      ? new Set(messageChoices.extractMessageChoiceLineKeys(normalized))
      : undefined;

    renderMarkdownLite(container, normalized, {
      hiddenChoiceLineKeys: choiceLineKeys,
      hideProgressNoise: activityEntries.length > 0,
    });

    if (activityEntries.length > 0) {
      appendOpenCodeActivityTrail(
        container,
        activityEntries,
        running,
        baseDetailKey ? `${baseDetailKey}:activity` : ''
      );
    }
  }

  function appendOpenCodeActivityTrail(container, entries, running, detailKey = '') {
    const normalizedEntries = normalizeOpenCodeActivityTimeline(entries);
    if (normalizedEntries.length === 0) {
      return;
    }

    const stack = document.createElement('div');
    stack.className = 'message-activity-stack';
    appendInlineActivityGroup(stack, normalizedEntries, running, detailKey);
    container.appendChild(stack);
  }

  function appendInlineActivityGroup(container, entries, running, detailKey = '') {
    const normalizedEntries = normalizeOpenCodeActivityTimeline(entries);
    if (normalizedEntries.length === 0) {
      return;
    }

    const row = document.createElement('details');
    row.className = `message-activity-inline${running ? ' is-running' : ''}`;
    if (detailKey) {
      row.dataset.messageDetailKey = detailKey;
      applyMessageDetailOpenState(row, detailKey);
    }

    const summary = document.createElement('summary');
    summary.className = 'message-activity-summary';
    summary.innerHTML = ACTIVITY_INLINE_ICON_SVG;

    const label = document.createElement('span');
    label.className = 'message-activity-text';
    label.textContent = openCodeActivityEntriesSummaryText(normalizedEntries);
    summary.appendChild(label);

    const chevron = document.createElement('span');
    chevron.className = 'message-activity-chevron';
    chevron.innerHTML = THINKING_CHEVRON_SVG;
    summary.appendChild(chevron);
    row.appendChild(summary);

    const hasDetail = normalizedEntries.some((entry) => Boolean(openCodeActivityDetailLine(entry) || entry.detail));
    if (hasDetail) {
      const body = document.createElement('div');
      body.className = 'message-activity-body';
      appendActivityDetailRows(body, normalizedEntries);
      row.appendChild(body);
    }
    container.appendChild(row);
  }

  function appendOpenCodeActivityDetails(container, entries, detailKey = '') {
    const normalizedEntries = normalizeOpenCodeActivityTimeline(entries);
    if (normalizedEntries.length === 0) {
      return;
    }

    appendInlineActivityGroup(container, normalizedEntries, false, detailKey);
  }

  function appendActivityDetailRows(body, entries) {
    const normalizedEntries = normalizeOpenCodeActivityTimeline(entries);
    for (const entry of normalizedEntries) {
      const detail = openCodeActivityDetailLine(entry);
      if (detail) {
        const detailRow = document.createElement('div');
        detailRow.className = 'message-activity-detail-row';
        detailRow.textContent = detail;
        body.appendChild(detailRow);
      }

      if (entry.detail) {
        const log = document.createElement('pre');
        log.className = 'message-activity-log';
        log.textContent = entry.detail;
        body.appendChild(log);
      }
    }
  }

  function openCodeActivityEntriesSummaryText(entries) {
    const state = normalizeOpenCodeActivity({ entries });
    state.entries.forEach((entry) => {
      if (entry.kind === 'file' && entry.target) {
        state.files = uniqueStrings([...state.files, entry.target]);
      } else if (entry.kind === 'file') {
        state.fileEvents += 1;
      } else if (entry.kind === 'search') {
        state.searches += 1;
      } else if (entry.kind === 'command') {
        state.commands += 1;
      } else {
        state.tools += 1;
      }
    });

    return openCodeActivitySummaryText(state, false);
  }

  function uniqueStrings(values) {
    const seen = new Set();
    const result = [];
    for (const value of Array.isArray(values) ? values : []) {
      const normalized = normalizeMessageText(value).trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      result.push(normalized);
    }

    return result;
  }

  function renderMarkdownLite(container, text, options = {}) {
    const lines = preprocessAssistantMessageLines(String(text || '').split('\n'), options);
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

  function preprocessAssistantMessageLines(lines, options = {}) {
    const sourceLines = lines || [];
    const hasInternalSignals = sourceLines.some((line, index) => (
      isInternalAnalysisHeading(line, sourceLines, index)
        || isInternalAnalysisField(line)
        || isAssistantIntentDiagnosticLine(line)
        || isAssistantToolNoiseLine(line)
    ));
    const hideProgressNoise = Boolean(options.hideProgressNoise);
    const hiddenChoiceLineKeys = options.hiddenChoiceLineKeys instanceof Set
      ? options.hiddenChoiceLineKeys
      : new Set(options.hiddenChoiceLineKeys || []);

    const cleaned = [];
    let skippingInternalField = false;

    sourceLines.forEach((line, index) => {
      const source = stripHiddenAssistantInlineMarkup(line);
      const trimmed = source.trim();
      const structuralTag = parseAssistantMarkupTag(trimmed);
      const choiceLineKey = messageChoices?.normalizeMessageChoiceLine
        ? messageChoices.normalizeMessageChoiceLine(source)
        : '';

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
        || isAssistantIntentDiagnosticLine(source)
        || isAssistantToolNoiseLine(source)
        || (choiceLineKey && hiddenChoiceLineKeys.has(choiceLineKey))
        || ((hasInternalSignals || hideProgressNoise) && isAssistantProgressNoiseLine(source))) {
        if (isAssistantIntentDiagnosticLine(source)) {
          skippingInternalField = true;
        }
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

  function isAssistantIntentDiagnosticLine(line) {
    const source = normalizeAssistantDiagnosticLine(line);
    return /^I detect [\w -]+ intent\b/i.test(source)
      || /^我(?:检测|判断|识别)到.+意图/.test(source);
  }

  function isAssistantToolNoiseLine(line) {
    const source = normalizeAssistantDiagnosticLine(line);
    return /\bpermission requested:\s*.+auto-?rejecting\b/i.test(source)
      || /^!?\s*permission requested:\s*(?:read|write)\b/i.test(source);
  }

  function isAssistantProgressNoiseLine(line) {
    const source = normalizeAssistantDiagnosticLine(line);
    return /^(?:I(?:'|’)ll start\b|I will start\b|Let me\b|Now let me\b|Let me now\b|Good initial sweep\b|The TypeScript check returned no output\b|Now I have all the data\b|Here(?:'|’)s the comprehensive\b|后台分析任务已并行启动|项目规模不小。先并行跑|找到项目了|让我(?:先|进一步|深入|直接|并行|查看|看一下|查一下|继续)|同时我(?:也|会)?(?:直接|先|继续|进一步)|我(?:先|继续|再|进一步)(?:查看|检查|搜索|确认|探查|看看))/i.test(source);
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

      if (isInternalAnalysisField(source)
        || isAssistantIntentDiagnosticLine(source)
        || isAssistantToolNoiseLine(source)
        || isAssistantProgressNoiseLine(source)) {
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

  function promptInputMaxHeight() {
    const parsedMaxHeight = Number.parseFloat(window.getComputedStyle(input).maxHeight);
    return Number.isFinite(parsedMaxHeight) && parsedMaxHeight > 0
      ? parsedMaxHeight
      : PROMPT_INPUT_MAX_HEIGHT_FALLBACK;
  }

  function resizePromptInput() {
    input.style.height = 'auto';
    const maxHeight = promptInputMaxHeight();
    const nextHeight = Math.min(input.scrollHeight, maxHeight);
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  function selectedAction() {
    return actionSelect.value || 'freeform';
  }

  function openSlashCommandPalette() {
    if (activeProfile()?.id === 'claude') {
      closeComposerMenus();
      slashPaletteMode = 'claudeActions';
      claudeActionQuery = '';
      renderClaudeActionDrawer({ focusFilter: true });
      return;
    }

    closeComposerMenus();
    input.value = '/';
    resizePromptInput();
    renderComposer();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function sendSelectedAction() {
    if (slashPaletteMode === 'claudeActions' && slashPaletteVisible()) {
      executeClaudeAction(slashMatches[slashActiveIndex]);
      return;
    }

    const slash = parseSlashInput(input.value);
    if (slash && slashMatches.length > 0) {
      executeSlashCommand(slashMatches[slashActiveIndex]);
      return;
    }

    const action = selectedAction();
    send(action, input.value || quickActionText(action));
  }

  function requestStopActiveProvider() {
    if (!runningByProvider[activeId]) {
      return false;
    }

    vscode.postMessage({ command: 'stop', cliId: activeId });
    return true;
  }

  sendBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    sendSelectedAction();
  });

  newChatBtn.addEventListener('click', () => {
    closeDeleteThreadDialog();
    startNewThread(activeId);
  });

  deleteThreadBtn.addEventListener('click', () => {
    showDeleteThreadDialog(activeId);
  });

  input.addEventListener('input', () => {
    resizePromptInput();
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
      if (slashPaletteMode === 'claudeActions') {
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
        if (slashMatches.length > 0 && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey))) {
          event.preventDefault();
          executeClaudeAction(slashMatches[slashActiveIndex]);
          return;
        }
      }
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
      if (slashMatches.length > 0 && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey))) {
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
    if (event.target instanceof Element && event.target.closest('.claude-action-filter')) {
      return;
    }
    event.preventDefault();
  });

  slashPalette?.addEventListener('keydown', (event) => {
    if (slashPaletteMode !== 'claudeActions') {
      return;
    }

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
      input.focus();
      return;
    }
    if (slashMatches.length > 0 && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey))) {
      event.preventDefault();
      executeClaudeAction(slashMatches[slashActiveIndex]);
    }
  });

  slashPalette?.addEventListener('click', (event) => {
    if (slashPaletteMode === 'claudeActions') {
      const button = event.target.closest('.claude-action-item');
      if (!button) {
        return;
      }

      const action = slashMatches.find((item) => item.id === button.dataset.claudeAction);
      executeClaudeAction(action);
      return;
    }

    const button = event.target.closest('.slash-command');
    if (!button) {
      return;
    }

    const command = slashMatches.find((item) => item.name === button.dataset.command);
    executeSlashCommand(command);
  });

  stopBtn.addEventListener('click', () => {
    requestStopActiveProvider();
  });

  codexTerminalStop.addEventListener('click', () => {
    requestStopActiveProvider();
  });

  codexTerminalOpen.addEventListener('click', () => {
    vscode.postMessage({ command: 'openProviderExtension', cliId: activeId });
  });

  attachImageBtn?.addEventListener('click', () => {
    if (attachImageBtn.disabled || imageFileInput?.disabled) {
      return;
    }

    imageFileInput?.click();
  });

  claudeSlashBtn?.addEventListener('click', () => {
    openSlashCommandPalette();
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

  apiSettingsBack?.addEventListener('click', closeSettingsPage);

  settingsNav?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-settings-section]');
    if (!button) {
      return;
    }
    activeSettingsSection = ['agents', 'commitMessage', 'mcp'].includes(button.dataset.settingsSection)
      ? button.dataset.settingsSection
      : 'agents';
    renderSettingsPage();
  });

  homeAgentList?.addEventListener('click', (event) => {
    const authButton = event.target.closest('button[data-cli-auth-action]');
    if (authButton) {
      event.preventDefault();
      vscode.postMessage({
        command: 'runCliAuthAction',
        cliId: authButton.dataset.homeAgentId,
        action: authButton.dataset.cliAuthAction,
      });
      return;
    }

    const button = event.target.closest('button[data-home-agent-move]');
    if (!button) {
      return;
    }

    event.preventDefault();
    moveHomeAgent(button.dataset.homeAgentId, button.dataset.homeAgentMove);
  });

  homeAgentsReset?.addEventListener('click', showAllHomeAgentsForUi);

  homeAgentsSave?.addEventListener('click', saveHomeAgentSettings);

  commitMessageSave?.addEventListener('click', saveCommitMessageSettings);
  commitMessageReset?.addEventListener('click', resetCommitMessageSettings);


  settingsNavMcp?.addEventListener('click', () => {
    openSettingsPage('mcp');
  });

  mcpRefresh?.addEventListener('click', () => {
    requestMcpServers(currentMcpCliId());
  });

  mcpServerAdd?.addEventListener('click', () => {
    startNewMcpServer();
  });

  mcpServerList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mcp-server-name]');
    if (!button) {
      return;
    }
    const name = button.dataset.mcpServerName;
    if (event.target.closest('.mcp-list-item-status')) {
      const server = activeMcpServers().find((entry) => entry.name === name);
      toggleMcpServerEnabled(name, server?.enabled === false);
      return;
    }
    editingMcpServerName = name;
    clearMcpFormError();
    renderMcpServerList();
    renderMcpServerForm();
  });

  mcpServerType?.addEventListener('change', updateMcpFormVisibility);

  mcpServerAddEnv?.addEventListener('click', () => {
    mcpServerEnvList?.appendChild(createExtraEnvRow('', ''));
  });

  mcpServerEnvList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-env]');
    if (!button) {
      return;
    }
    button.closest('.api-extra-env-row')?.remove();
    if (!mcpServerEnvList.children.length) {
      mcpServerEnvList.appendChild(createExtraEnvRow('', ''));
    }
  });

  mcpServerAddHeader?.addEventListener('click', () => {
    mcpServerHeadersList?.appendChild(createExtraEnvRow('', ''));
  });

  mcpServerHeadersList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-env]');
    if (!button) {
      return;
    }
    button.closest('.api-extra-env-row')?.remove();
    if (!mcpServerHeadersList.children.length) {
      mcpServerHeadersList.appendChild(createExtraEnvRow('', ''));
    }
  });

  mcpServerCancel?.addEventListener('click', () => {
    editingMcpServerName = '';
    clearMcpFormError();
    renderMcpServerList();
    renderMcpServerForm();
  });

  mcpServerDelete?.addEventListener('click', () => {
    deleteMcpServer();
  });

  mcpServerForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveMcpServer();
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

  sessionHistory?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const newButton = target?.closest('[data-history-new]');
    if (newButton) {
      startNewThread(activeId);
      return;
    }

    const row = target?.closest('[data-thread-id]');
    if (!row) {
      return;
    }

    activateHistoryThread(row.dataset.providerId, row.dataset.threadId);
  });

  providerSelect.addEventListener('change', () => {
    activeId = providerSelect.value;
    ensureActiveThread(activeId);
    activeAgentModeId(activeId);
    closeComposerMenus();
    persist();
    persistUserSelection();
    refreshActiveContext();
    renderAll();
  });

  providerTabs.addEventListener('click', (event) => {
    const button = event.target.closest('.provider-tab-button');
    if (!button) {
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
    setActiveAgentMode(agentModeSelect.value);
  });

  agentModeOptionList?.addEventListener('click', (event) => {
    const button = event.target.closest('.option-list-item');
    if (!button || button.disabled) {
      return;
    }

    setActiveAgentMode(button.dataset.value);
    modeMenu.open = false;
  });

  modeMenu?.addEventListener('keydown', (event) => {
    if (!modeMenu.open || event.key !== 'Tab') {
      return;
    }

    event.preventDefault();
    switchAgentModeByDelta(event.shiftKey ? -1 : 1);
  });

  document.querySelectorAll('[data-context]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      contextOptions = defaultContextOptions();
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
        send('freeform', '/undo');
      } else if (fileCardAction.dataset.fileCardAction === 'review') {
        send('freeform', fileCardReviewPrompt());
      }
      return;
    }

    const choiceButton = event.target.closest('[data-message-choice-prompt]');
    if (choiceButton) {
      event.preventDefault();
      event.stopPropagation();
      const prompt = normalizeMessageText(choiceButton.dataset.messageChoicePrompt);
      if (prompt && !runningByProvider[activeId] && !pendingByProvider[activeId]) {
        send('freeform', prompt);
      }
      return;
    }

    const claudeApprovalButton = event.target.closest('[data-claude-approval-prompt]');
    if (claudeApprovalButton) {
      event.preventDefault();
      event.stopPropagation();
      submitClaudeApprovalPrompt(
        claudeApprovalButton.dataset.claudeApprovalPrompt,
        claudeApprovalButton.dataset.claudeApprovalKey
      );
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
      vscode.postMessage({ command: 'openSettings', section: button.dataset.settingsSection || 'agents' });
      return;
    }

    if (action === 'refreshProviders') {
      event.preventDefault();
      event.stopPropagation();
      profilesLoading = true;
      vscode.postMessage({ command: 'checkProfiles', force: true });
      renderAll();
      return;
    }

    if (action === 'installCli') {
      event.preventDefault();
      event.stopPropagation();
      vscode.postMessage({ command: 'installCli', cliId: button.dataset.cliId });
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

    if (
      slashPaletteVisible()
      && target
      && !slashPalette.contains(target)
      && target !== input
    ) {
      hideSlashPalette();
    }

    closeComposerMenus(menus.includes(currentMenu) ? currentMenu : undefined);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (openCodeDialogKind) {
        event.preventDefault();
        dismissOpenCodeStatusDialog();
        return;
      }
      if (apiSettingsPage && !apiSettingsPage.hidden) {
        closeSettingsPage();
        return;
      }
      if (slashPaletteVisible()) {
        event.preventDefault();
        hideSlashPalette();
        return;
      }
      if (requestStopActiveProvider()) {
        event.preventDefault();
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
      case 'refreshStarted':
        profilesLoading = true;
        renderAll();
        break;
      case 'profiles':
        profilesLoading = false;
        profiles = message.profiles || [];
        setupProfiles = normalizeSetupProfiles(message.setupProfiles);
        {
          const availableProfiles = visibleInstalledProfiles();
          const storedAgentModes = persistableAgentModeMap(message.activeAgentModeByProvider);
          activeAgentModeByProvider = hasAppliedPersistentSelection
            ? { ...storedAgentModes, ...activeAgentModeByProvider }
            : { ...activeAgentModeByProvider, ...storedAgentModes };
          disabledMcpByProvider = hasAppliedPersistentSelection
            ? { ...(message.disabledMcpByProvider || {}), ...disabledMcpByProvider }
            : { ...disabledMcpByProvider, ...(message.disabledMcpByProvider || {}) };
          contextOptions = defaultContextOptions();
          if (!hasAppliedPersistentSelection) {
            claudeTerminalBannerDismissed = Boolean(message.claudeTerminalBannerDismissed);
            taskBoardDismissed = Boolean(message.taskBoardDismissed);
          }
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
          }
        }
        persist();
        persistUserSelection();
        contextSummary = null;
        latestContextRequest = null;
        contextSummaryPending = false;
        renderAll();
        break;
      case 'switchProvider':
        switchActiveProvider(message.providerId);
        break;
      case 'contextInvalidated':
        if (!message.cliId || message.cliId === activeId) {
          refreshActiveContext();
        }
        break;
      case 'contextSummary':
        {
          const matches = providerOptions.contextSummaryMatches({
            expectedRequest: latestContextRequest,
            response: message,
            activeCliId: activeId,
          });
          if (!matches) {
            break;
          }
        }
        contextSummaryPending = false;
        contextSummary = message.summary;
        renderProviderHint();
        renderContextSummaryLabel();
        renderContextBudget();
        renderOpenCodeSidebar();
        renderOpenCodeStatusDialog();
        break;

      case 'settingsSaveResult': {
        if (message.ok) {
          setSettingsSaveStatus(message.section, 'success');
          break;
        }
        const errorMessage = typeof message.message === 'string' ? message.message.trim() : '';
        setSettingsSaveStatus(
          message.section,
          'error',
          errorMessage ? i18n.t('settings.saveStatus.failedWithMessage', { message: errorMessage }) : undefined
        );
        break;
      }
      case 'homeAgentSettings':
        homeAgentSettings = normalizeHomeAgentSettings(message.settings);
        renderAll();
        break;
      case 'commitMessageSettings':
        commitMessageSettings = normalizeCommitMessageSettings(message.settings);
        renderSettingsPage();
        break;
      case 'mcpServers': {
        const cliId = String(message.cliId || activeProviderId());
        mcpSupportedByCli[cliId] = message.supported !== false;
        mcpConfigPathByCli[cliId] = typeof message.configPath === 'string' ? message.configPath : '';
        mcpReasonByCli[cliId] = typeof message.reason === 'string' ? message.reason : '';
        const servers = Array.isArray(message.servers) ? message.servers : [];
        mcpServersByCli[cliId] = servers;
        if (activeSettingsSection === 'mcp' && cliId === activeProviderId()) {
          renderMcpSettings();
        }
        break;
      }
      case 'mcpServerSaved': {
        const ok = message.ok === true;
        const messageText = typeof message.message === 'string' ? message.message.trim() : '';
        const section = activeProviderId();
        if (ok) {
          setSettingsSaveStatus('mcp', 'success');
        } else {
          setSettingsSaveStatus(
            'mcp',
            'error',
            messageText || i18n.t('mcpSettings.saveFailed')
          );
          if (mcpServerError) {
            mcpServerError.hidden = false;
            mcpServerError.textContent = messageText;
          }
        }
        if (typeof message.code === 'string') {
          // no-op, code surfaced via message
        }
        // Trigger MCP server list refresh
        requestMcpServers(section);
        break;
      }
      case 'openProviderSettings':
        openSettingsPage(message.section);
        break;
      case 'threadEvent':
        codexRenderer?.dispatch(message);
        if (
          codexRendererEnabled &&
          message.event?.type !== 'item/assistantMessage/delta' &&
          message.event?.type !== 'item/reasoning/delta'
        ) {
          renderThreadSelect();
          renderSessionHistory();
        }
        break;
      case 'rendererRuntimeSnapshot':
        restoreRendererRuntimeSnapshot(message.runs);
        break;
      case 'requestStarted':
        if (!activeId || !installedProfiles().some((profile) => profile.id === activeId)) {
          activeId = message.cliId;
        }
        providerRunState.markProviderRunning(providerRunStore, message.cliId);
        activeAgentModeByProvider[message.cliId] = message.agentMode || activeAgentModeId(message.cliId);
        {
          const threadId = message.threadId ||
            providerRunState.pendingThreadId(providerRunStore, message.cliId) ||
            activeThreadId(message.cliId);
          const taskId = providerRunState.takePendingTaskId(providerRunStore, message.cliId) || createRunTask(
            message.cliId,
            message.action,
            message.text,
            message.agentMode
          ).id;
          taskBySessionId[message.sessionId] = taskId;
          updateTaskStatus(taskId, {
            status: 'running',
            sessionId: message.sessionId,
            threadId,
            agentMode: message.agentModeLabel || message.agentMode || '',
          });
          activeThreadByProvider[message.cliId] = threadId;
          if (codexRendererEnabled) {
            codexRenderer.setActiveContext(message.cliId, threadId);
          } else {
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
          }
        }
        persist();
        renderAll();
        break;
      case 'output':
        if (!codexRendererEnabled) {
          updateStream(message);
        }
        break;
      case 'sessionNotice':
        if (!codexRendererEnabled) {
          updateSessionNotice(message);
        }
        break;
      case 'sessionEnd':
        if (codexRendererEnabled) {
          markCodexSessionEnded(message);
        } else {
          markSessionEnded(message);
        }
        break;
      case 'stopped':
        providerRunState.clearProviderRunState(providerRunStore, message.cliId);
        {
          stoppedSessionIds.add(message.sessionId);
          updateTaskStatus(taskBySessionId[message.sessionId], { status: 'stopped' });
          delete taskBySessionId[message.sessionId];
          if (!codexRendererEnabled) {
            const target = finishStreamTarget(message);
            addMessage(message.cliId, 'system', i18n.t('message.runStopped'), undefined, false, target?.threadId);
          }
        }
        renderAll();
        break;
      case 'error':
        providerRunState.clearProviderRunState(providerRunStore, message.cliId || activeId);
        updateTaskStatus(taskBySessionId[message.sessionId], { status: 'failed' });
        delete taskBySessionId[message.sessionId];
        if (codexRendererEnabled && message.threadId) {
          activeId = message.cliId || activeId;
          activeThreadByProvider[activeId] = message.threadId;
          codexRenderer.ensureThread(activeId, message.threadId);
          codexRenderer.setActiveContext(activeId, message.threadId);
        } else if (!codexRendererEnabled) {
          addMessage(
            message.cliId || activeId,
            'error',
            normalizeMessageText(message.text) || i18n.t('message.unknownError')
          );
        }
        renderAll();
        break;
    }
  });

  vscode.postMessage({ command: 'checkProfiles' });
  applySessionHistoryWidth(sessionHistoryWidth);
  initSessionHistoryResizer();
  mountCodexRenderer();
  document.addEventListener('visibilitychange', () => {
    if (codexRendererEnabled && document.hidden) {
      codexRenderer.onHidden();
    }
  });
  window.addEventListener('beforeunload', () => {
    if (codexRendererEnabled) {
      codexRenderer.dispose();
    }
  });
  renderAll();
})();
