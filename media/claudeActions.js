(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.AgentsGuiClaudeActions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ACTION_SECTIONS = Object.freeze([
    {
      id: 'context',
      titleKey: 'claude.actions.context',
      actions: Object.freeze([
        { id: 'attachFile', labelKey: 'claude.actions.attachFile' },
        { id: 'mentionFile', labelKey: 'claude.actions.mentionFile' },
        { id: 'clearConversation', labelKey: 'claude.actions.clearConversation' },
        { id: 'rewind', labelKey: 'claude.actions.rewind' },
      ]),
    },
    {
      id: 'model',
      titleKey: 'claude.actions.model',
      actions: Object.freeze([
        { id: 'switchModel', labelKey: 'claude.actions.switchModel', trailingKey: 'claude.actions.defaultRecommended' },
        { id: 'effort', labelKey: 'claude.actions.effort', kind: 'effort' },
        { id: 'thinking', labelKey: 'claude.actions.thinking', kind: 'toggle' },
        { id: 'accountUsage', labelKey: 'claude.actions.accountUsage' },
      ]),
    },
    {
      id: 'customize',
      titleKey: 'claude.actions.customize',
      actions: Object.freeze([
        { id: 'permissions', labelKey: 'claude.actions.permissions' },
        { id: 'settings', labelKey: 'claude.actions.settings' },
      ]),
    },
  ]);

  function actionSections(context = {}) {
    const translate = typeof context.translate === 'function' ? context.translate : defaultTranslate;
    const runtimeId = context.runtimeId || 'defaultEffort';
    const modelId = context.modelId || '';
    const modelLabel = context.modelLabel || '';
    const effortValueLabel = context.effortValueLabel || '';

    return ACTION_SECTIONS.map((section) => ({
      ...section,
      title: translate(section.titleKey),
      actions: section.actions.map((action) => {
        const label = action.kind === 'effort'
          ? translate(action.labelKey, { value: effortValueLabel })
          : translate(action.labelKey);
        const trailing = action.id === 'switchModel'
          ? (modelId === 'configured' ? translate(action.trailingKey) : modelLabel)
          : '';

        return {
          ...action,
          name: action.id,
          sectionId: section.id,
          label,
          trailing,
          active: action.kind === 'toggle' && runtimeId !== 'defaultEffort',
        };
      }),
    }));
  }

  function actionMatchesQuery(action, query) {
    if (!query) {
      return true;
    }

    const text = `${action.id} ${action.label} ${action.trailing || ''}`.toLowerCase();
    return text.includes(String(query || '').toLowerCase());
  }

  function defaultTranslate(key) {
    return key;
  }

  return {
    actionMatchesQuery,
    actionSections,
  };
});
