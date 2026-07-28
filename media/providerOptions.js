(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.AgentsGuiProviderOptions = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
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

  function optionListFor(profile, key, fallbackLabelKey, capabilities, translate = defaultTranslate) {
    const control = controlForOptionKey(key);
    if (control && capabilities?.optionList) {
      return capabilities.optionList(profile, control, translate);
    }

    return [{ id: 'default', label: translate(fallbackLabelKey), description: '' }];
  }

  function normalizeOptionId(
    profile,
    value,
    key,
    defaultKey,
    fallbackLabelKey,
    capabilities,
    translate = defaultTranslate
  ) {
    const control = controlForOptionKey(key);
    if (control && capabilities?.normalizeOptionId) {
      return capabilities.normalizeOptionId(profile, value, control, translate);
    }

    const options = optionListFor(profile, key, fallbackLabelKey, capabilities, translate);
    const option = options.find((item) => item.id === value)
      || options.find((item) => item.id === profile?.[defaultKey])
      || options[0];
    return option.id;
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

  function splitAgentModeLabel(label) {
    const value = String(label || '').replace(/\u200b/g, '').trim();
    const parts = value.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
    if (parts.length <= 1) {
      return { title: value, detail: '' };
    }

    return { title: parts[0], detail: parts.slice(1).join(' - ') };
  }

  function effectiveModelId(option, customModel) {
    const customId = option?.custom ? String(customModel || '').trim() : '';
    return customId
      || String(option?.configuredModelId || '').trim()
      || String(option?.id || '').trim();
  }

  function contextSummaryMatches({
    expectedRequest,
    response,
    activeCliId,
    activeModelId,
  } = {}) {
    if (!expectedRequest || !response) {
      return false;
    }

    if (
      typeof expectedRequest.requestId !== 'string'
      || typeof expectedRequest.cliId !== 'string'
      || typeof expectedRequest.modelId !== 'string'
      || typeof response.requestId !== 'string'
      || typeof response.cliId !== 'string'
      || typeof response.modelId !== 'string'
      || !response.summary
      || typeof response.summary !== 'object'
    ) {
      return false;
    }

    const expectedRequestId = expectedRequest.requestId;
    const expectedCliId = expectedRequest.cliId;
    const expectedModelId = expectedRequest.modelId;
    const responseRequestId = response.requestId;
    const responseCliId = response.cliId;
    const responseModelId = response.modelId;
    if (
      !expectedRequestId
      || !expectedCliId
      || !expectedModelId
      || !responseRequestId
      || !responseCliId
      || !responseModelId
    ) {
      return false;
    }

    return responseRequestId === expectedRequestId
      && responseCliId === expectedCliId
      && responseModelId === expectedModelId
      && activeCliId === expectedCliId
      && activeModelId === expectedModelId;
  }

  function controlForOptionKey(key) {
    switch (key) {
      case 'agentModes':
        return 'agentMode';
      case 'modelOptions':
        return 'model';
      case 'runtimeModes':
        return 'runtime';
      case 'permissionModes':
        return 'permission';
      default:
        return undefined;
    }
  }

  function defaultTranslate(key) {
    return key;
  }

  return {
    agentModesFor,
    contextSummaryMatches,
    effectiveModelId,
    mapLegacyWorkflowMode,
    normalizeAgentModeId,
    normalizeOptionId,
    optionListFor,
    splitAgentModeLabel,
  };
}));
