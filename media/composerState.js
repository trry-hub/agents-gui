(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.AgentsGuiComposerState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function deriveComposerState(options) {
    const profile = options.profile || undefined;
    const activeId = String(options.activeId || '');
    const selectedAction = String(options.selectedAction || 'freeform');
    const canSend = Boolean(profile && profile.installed);
    const busy = Boolean(options.running || options.pending);
    const hasPrompt = String(options.promptText || '').trim().length > 0;
    const hasAttachments = Number(options.attachmentCount || 0) > 0;
    const missingSelection = Boolean(options.requiresSelection && !options.hasSelection);
    const canRunAction = hasPrompt || hasAttachments || selectedAction !== 'freeform';
    const running = Boolean(options.running);
    const translate = typeof options.translate === 'function' ? options.translate : defaultTranslate;
    const actionLabel = typeof options.actionLabel === 'function'
      ? options.actionLabel
      : (action) => String(action || '');

    return {
      canSend,
      busy,
      canRunAction,
      missingSelection,
      running,
      inputDisabled: !canSend,
      sendDisabled: !canSend || busy || !canRunAction || missingSelection,
      actionSelectDisabled: !canSend || busy,
      providerSelectDisabled: Number(options.installedProviderCount || 0) === 0 || busy,
      threadSelectDisabled: !activeId || busy,
      optionSelectDisabled: !canSend || busy,
      attachmentDisabled: !canSend || busy,
      placeholder: placeholderText({
        profile,
        canSend,
        profilesLoading: Boolean(options.profilesLoading),
        missingSelection,
        selectedAction,
        translate,
        actionLabel,
      }),
    };
  }

  function actionButtonState(action, composerState, requiresSelection, hasSelection) {
    if (action === 'openSettings') {
      return { disabled: false, missingSelection: false };
    }

    const missingSelection = Boolean(requiresSelection && !hasSelection);
    return {
      disabled: !composerState.canSend || composerState.busy || missingSelection,
      missingSelection,
    };
  }

  function placeholderText(options) {
    if (options.profilesLoading) {
      return options.translate('input.placeholderLoading');
    }
    if (!options.canSend) {
      return options.translate('input.placeholderDisabled');
    }
    if (options.profile?.id === 'claude' && !options.missingSelection) {
      return options.translate('claude.placeholder');
    }
    if (options.missingSelection) {
      return options.translate('quick.missingSelection');
    }
    return options.translate(
      options.selectedAction === 'freeform' ? 'input.placeholderProvider' : 'input.placeholderAction',
      { provider: options.profile.name, action: options.actionLabel(options.selectedAction) }
    );
  }

  function defaultTranslate(key) {
    return key;
  }

  return {
    actionButtonState,
    deriveComposerState,
  };
}));
