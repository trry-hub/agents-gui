(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.AgentsGuiOpenCodeDialogState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalizeCommandQuery(value) {
    return String(value || '').trim().replace(/^\/+/, '').toLowerCase();
  }

  function commandAliases(kind) {
    return kind === 'agents' ? ['agent', 'agents'] : [kind];
  }

  function isCommandEcho(kind, value, echoQuery) {
    const query = normalizeCommandQuery(value);
    return Boolean(query && (query === normalizeCommandQuery(echoQuery) || commandAliases(kind).includes(query)));
  }

  function initialActiveIndex(options) {
    const selected = (Array.isArray(options) ? options : []).findIndex((option) => option?.selected);
    return selected >= 0 ? selected : 0;
  }

  function clampActiveIndex(index, options) {
    const list = Array.isArray(options) ? options : [];
    return list.length ? Math.min(Math.max(Number(index) || 0, 0), list.length - 1) : 0;
  }

  function moveActiveIndex(index, options, delta) {
    const list = Array.isArray(options) ? options : [];
    return list.length ? (clampActiveIndex(index, list) + delta + list.length) % list.length : 0;
  }

  function activeOptionId(options, index) {
    const list = Array.isArray(options) ? options : [];
    return list[clampActiveIndex(index, list)]?.id || '';
  }

  function applyMcpOperationResult(errors, message, fallbackCliId, fallbackMessage) {
    const cliId = String(message?.cliId || fallbackCliId || '').trim();
    const nextErrors = { ...(errors || {}) };
    if (cliId) {
      nextErrors[cliId] = message?.ok === true
        ? ''
        : String(message?.message || fallbackMessage || '').trim();
    }
    return { cliId, errors: nextErrors };
  }

  return {
    activeOptionId,
    applyMcpOperationResult,
    clampActiveIndex,
    commandAliases,
    initialActiveIndex,
    isCommandEcho,
    moveActiveIndex,
    normalizeCommandQuery,
  };
});
