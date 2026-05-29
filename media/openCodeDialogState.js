(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.AgentsGuiOpenCodeDialogState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const OPTION_DIALOG_KINDS = Object.freeze(['sessions', 'models', 'agents']);

  function optionDialogKinds() {
    return new Set(OPTION_DIALOG_KINDS);
  }

  function isOptionDialogKind(kind) {
    return OPTION_DIALOG_KINDS.includes(kind);
  }

  function normalizeCommandQuery(value) {
    return String(value || '').trim().replace(/^\/+/, '').toLowerCase();
  }

  function commandAliases(kind) {
    switch (kind) {
      case 'sessions':
        return ['session', 'sessions', 'resume', 'continue'];
      case 'models':
        return ['model', 'models'];
      case 'agents':
        return ['agent', 'agents'];
      case 'mcp':
        return ['mcp', 'mcps'];
      case 'themes':
        return ['theme', 'themes'];
      case 'org':
        return ['org', 'orgs', 'switch-org'];
      default:
        return [kind];
    }
  }

  function isCommandEcho(kind, value, echoQuery) {
    const query = normalizeCommandQuery(value);
    const normalizedEcho = normalizeCommandQuery(echoQuery);
    return Boolean(
      query
      && (
        query === normalizedEcho
        || commandAliases(kind).includes(query)
      )
    );
  }

  function keyboardOptions(kind, data = {}) {
    if (kind === 'models') {
      return (Array.isArray(data.modelGroups) ? data.modelGroups : [])
        .flatMap((group) => Array.isArray(group?.options) ? group.options : [])
        .filter((option) => !option?.disabled);
    }

    if (isOptionDialogKind(kind)) {
      return (Array.isArray(data.options) ? data.options : []).filter((option) => !option?.disabled);
    }

    return [];
  }

  function initialActiveIndex(options) {
    const list = Array.isArray(options) ? options : [];
    const selectedIndex = list.findIndex((option) => option?.selected);
    return selectedIndex >= 0 ? selectedIndex : 0;
  }

  function clampActiveIndex(index, options) {
    const list = Array.isArray(options) ? options : [];
    if (list.length === 0) {
      return 0;
    }
    return Math.min(Math.max(Number(index) || 0, 0), list.length - 1);
  }

  function moveActiveIndex(index, options, delta) {
    const list = Array.isArray(options) ? options : [];
    if (list.length === 0) {
      return 0;
    }
    return (clampActiveIndex(index, list) + delta + list.length) % list.length;
  }

  function activeOptionId(options, index) {
    const list = Array.isArray(options) ? options : [];
    return list[clampActiveIndex(index, list)]?.id || '';
  }

  function normalizedModelMemory(value) {
    return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
  }

  function recentModelIds(selectedId, recentValue, limit = 6) {
    const selected = String(selectedId || '');
    const recent = normalizedModelMemory(recentValue);
    return [selected, ...recent.filter((item) => item !== selected)].filter(Boolean).slice(0, limit);
  }

  function favoriteModelIds(value) {
    return normalizedModelMemory(value);
  }

  function modelProviderId(modelId) {
    const value = String(modelId || '');
    return value.includes('/') ? value.split('/')[0] : 'configured';
  }

  function modelProviderName(providerId) {
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

  function modelTokenTitle(token) {
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

  function modelTitle(modelId, fallback) {
    const id = String(modelId || '');
    const raw = id.includes('/') ? id.split('/').pop() : id;
    const label = String(fallback || '').trim();
    if (label && label !== id) {
      return label;
    }
    return raw
      .split('-')
      .filter(Boolean)
      .map(modelTokenTitle)
      .join(' ') || id;
  }

  function modelFooter(option, providerId) {
    const id = String(option?.id || '');
    if (providerId === 'opencode' || /(?:^|-)free$/.test(id)) {
      return 'Free';
    }
    return '';
  }

  function groupModelOptions(options, settings = {}) {
    const list = Array.isArray(options) ? options : [];
    const needle = String(settings.query || '').trim().toLowerCase();
    if (needle) {
      return [{
        title: '',
        options: list.filter((option) => [
          option.label,
          option.meta,
          option.category,
          option.id,
        ].some((value) => String(value || '').toLowerCase().includes(needle))),
      }];
    }

    const byId = new Map(list.map((option) => [option.id, option]));
    const favoriteIds = normalizedModelMemory(settings.favoriteIds);
    const recentIds = normalizedModelMemory(settings.recentIds).filter((id) => !favoriteIds.includes(id));
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
    list
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

  return {
    activeOptionId,
    clampActiveIndex,
    commandAliases,
    favoriteModelIds,
    groupModelOptions,
    initialActiveIndex,
    isCommandEcho,
    isOptionDialogKind,
    keyboardOptions,
    modelFooter,
    modelProviderId,
    modelProviderName,
    modelTitle,
    modelTokenTitle,
    moveActiveIndex,
    normalizeCommandQuery,
    normalizedModelMemory,
    optionDialogKinds,
    recentModelIds,
  };
});
