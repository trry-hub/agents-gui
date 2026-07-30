(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.AgentsGuiProviderCapabilities = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function usesNativeAgentConfig(profileOrId) {
    const providerId = typeof profileOrId === 'string' ? profileOrId : profileOrId?.id;
    return providerId === 'opencode';
  }

  function controlVisibility(profile) {
    return Boolean(profile) && (
      usesNativeAgentConfig(profile)
      || (Array.isArray(profile.agentModes) && profile.agentModes.length > 1)
    );
  }

  return {
    controlVisibility,
    usesNativeAgentConfig,
  };
});
