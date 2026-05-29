(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.AgentsGuiMessageText = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ORPHAN_ANSI_PATTERN = /(?:^|(?<=\s))\[(?:\??25[hl]|[0-9;]*[ABCDEFGJKSTfimnsu]|[0-9;]*[hl])(?![A-Za-z0-9_-])/g;
  const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

  function normalizeMessageText(text) {
    return String(text || '')
      .replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g, '')
      .replace(ORPHAN_ANSI_PATTERN, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(CONTROL_PATTERN, '')
      .replace(/\n{4,}/g, '\n\n\n');
  }

  function stripInlineMarkdown(text) {
    return String(text || '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1');
  }

  return {
    normalizeMessageText,
    stripInlineMarkdown,
  };
});
