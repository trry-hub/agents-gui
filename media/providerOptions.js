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
      : [{ id: 'agent', label: 'Agent', description: '', instruction: 'Use this provider as a coding agent.' }];
    const selectable = modes.filter((mode) => !mode.disabled);
    return selectable.length > 0 ? selectable : modes;
  }

  function normalizeAgentModeId(profile, value) {
    const modes = agentModesFor(profile);
    return (modes.find((mode) => mode.id === value)
      || modes.find((mode) => mode.id === profile?.defaultAgentMode)
      || modes[0]).id;
  }

  function mapLegacyWorkflowMode(profile, value) {
    const desired = { auto: profile?.defaultAgentMode, plan: 'plan', execute: profile?.defaultAgentMode }[value];
    return agentModesFor(profile).some((mode) => mode.id === desired) ? desired : undefined;
  }

  function splitAgentModeLabel(label) {
    const parts = String(label || '').replace(/\u200b/g, '').trim().split(/\s+-\s+/).filter(Boolean);
    return parts.length <= 1 ? { title: parts[0] || '', detail: '' } : { title: parts[0], detail: parts.slice(1).join(' - ') };
  }

  function contextSummaryMatches({ expectedRequest, response, activeCliId } = {}) {
    return Boolean(
      expectedRequest
      && response
      && expectedRequest.requestId
      && expectedRequest.cliId
      && response.requestId === expectedRequest.requestId
      && response.cliId === expectedRequest.cliId
      && activeCliId === expectedRequest.cliId
      && response.summary
      && typeof response.summary === 'object'
    );
  }

  return { agentModesFor, contextSummaryMatches, mapLegacyWorkflowMode, normalizeAgentModeId, splitAgentModeLabel };
}));
