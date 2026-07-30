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
      id: 'customize',
      titleKey: 'claude.actions.customize',
      actions: Object.freeze([
        { id: 'accountUsage', labelKey: 'claude.actions.accountUsage' },
        { id: 'settings', labelKey: 'claude.actions.settings' },
      ]),
    },
  ]);

  function actionSections(context = {}) {
    const translate = typeof context.translate === 'function' ? context.translate : defaultTranslate;
    return ACTION_SECTIONS.map((section) => ({
      ...section,
      title: translate(section.titleKey),
      actions: section.actions.map((action) => {
        return {
          ...action,
          name: action.id,
          sectionId: section.id,
          label: translate(action.labelKey),
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
