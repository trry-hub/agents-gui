(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.AgentsGuiWorkbenchLayout = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function setSessionHistoryHidden(body, sessionHistory, hidden) {
    const shouldHide = Boolean(hidden);
    if (sessionHistory) {
      sessionHistory.hidden = shouldHide;
    }
    if (body?.classList) {
      body.classList.toggle('is-session-history-hidden', shouldHide);
      body.classList.toggle('is-session-history-visible', !shouldHide);
    }
  }

  return {
    setSessionHistoryHidden,
  };
}));
