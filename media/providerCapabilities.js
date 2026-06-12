(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.AgentsGuiProviderCapabilities = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CONTROL_CONFIG = Object.freeze({
    agentMode: {
      optionsKey: 'agentModes',
      defaultKey: 'defaultAgentMode',
      fallbackId: 'agent',
      fallbackLabelKey: 'agentMode.short',
    },
    model: {
      optionsKey: 'modelOptions',
      defaultKey: 'defaultModel',
      fallbackId: 'default',
      fallbackLabelKey: 'model.short',
    },
    runtime: {
      optionsKey: 'runtimeModes',
      defaultKey: 'defaultRuntime',
      fallbackId: 'default',
      fallbackLabelKey: 'runtime.short',
    },
    permission: {
      optionsKey: 'permissionModes',
      defaultKey: 'defaultPermissionMode',
      fallbackId: 'default',
      fallbackLabelKey: 'permission.short',
    },
  });

  function controlConfig(control) {
    return CONTROL_CONFIG[control] || CONTROL_CONFIG.model;
  }

  function fallbackOption(control, label) {
    const config = controlConfig(control);
    return {
      id: config.fallbackId,
      label: label || config.fallbackLabelKey,
      description: '',
    };
  }

  function optionList(profile, control, translate = defaultTranslate) {
    const config = controlConfig(control);
    const options = Array.isArray(profile?.[config.optionsKey]) ? profile[config.optionsKey] : [];
    return options.length > 0
      ? options
      : [fallbackOption(control, translate(config.fallbackLabelKey))];
  }

  function selectableOption(option) {
    return !option?.disabled && !option?.actionOnly;
  }

  function defaultOptionId(profile, control) {
    const config = controlConfig(control);
    return profile?.[config.defaultKey];
  }

  function normalizeOptionId(profile, value, control, translate = defaultTranslate) {
    const options = optionList(profile, control, translate);
    const selectableOptions = options.filter(selectableOption);
    const pool = selectableOptions.length > 0 ? selectableOptions : options;
    const option = pool.find((item) => item.id === value)
      || pool.find((item) => item.id === defaultOptionId(profile, control))
      || pool[0];

    return option?.id || controlConfig(control).fallbackId;
  }

  function usesNativeAgentConfig(profileOrId) {
    const providerId = typeof profileOrId === 'string' ? profileOrId : profileOrId?.id;
    return providerId === 'opencode';
  }

  function supportsModelVariants(profileOrId) {
    const providerId = typeof profileOrId === 'string' ? profileOrId : profileOrId?.id;
    return providerId === 'opencode';
  }

  function controlVisibility(profile, control, options = {}) {
    if (!profile) {
      return false;
    }

    const optionCount = optionList(profile, control, options.translate || defaultTranslate).length;
    switch (control) {
      case 'agentMode':
        return usesNativeAgentConfig(profile) || optionCount > 1;
      case 'model':
      case 'runtime':
      case 'permission':
        return optionCount > 1;
      default:
        return false;
    }
  }

  function defaultTranslate(key) {
    return key;
  }

  return {
    controlConfig,
    controlVisibility,
    defaultOptionId,
    normalizeOptionId,
    optionList,
    selectableOption,
    supportsModelVariants,
    usesNativeAgentConfig,
  };
});
