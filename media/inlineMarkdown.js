(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.AgentsGuiInlineMarkdown = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const INLINE_TOKEN_PATTERN = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g;
  const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
  const CONTROL_OR_SPACE_PATTERN = /[\u0000-\u0020\u007F]/;

  function safeMarkdownHref(value) {
    const href = String(value || '').trim();
    if (!href || CONTROL_OR_SPACE_PATTERN.test(href)) {
      return '';
    }

    try {
      const parsed = new URL(href);
      return SAFE_LINK_PROTOCOLS.has(parsed.protocol) ? href : '';
    } catch {
      return '';
    }
  }

  function appendInlineMarkdown(container, text) {
    const source = String(text || '');
    let lastIndex = 0;
    let match;

    INLINE_TOKEN_PATTERN.lastIndex = 0;
    while ((match = INLINE_TOKEN_PATTERN.exec(source)) !== null) {
      if (match.index > lastIndex) {
        container.appendChild(document.createTextNode(source.slice(lastIndex, match.index)));
      }

      appendInlineToken(container, match[0]);
      lastIndex = INLINE_TOKEN_PATTERN.lastIndex;
    }

    if (lastIndex < source.length) {
      container.appendChild(document.createTextNode(source.slice(lastIndex)));
    }
  }

  function appendInlineToken(container, token) {
    if (token.startsWith('[')) {
      appendLinkToken(container, token);
      return;
    }

    if (token.startsWith('**')) {
      const strong = document.createElement('strong');
      strong.className = 'md-strong';
      strong.textContent = token.slice(2, -2);
      container.appendChild(strong);
      return;
    }

    const code = document.createElement('code');
    code.className = 'md-code';
    code.textContent = token.slice(1, -1);
    container.appendChild(code);
  }

  function appendLinkToken(container, token) {
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
    const label = link?.[1] || token;
    const rawHref = link?.[2] || '';
    const href = safeMarkdownHref(rawHref);

    if (!href) {
      const span = document.createElement('span');
      span.className = 'md-link md-link-disabled';
      span.textContent = label;
      span.title = rawHref;
      container.appendChild(span);
      return;
    }

    const anchor = document.createElement('a');
    anchor.className = 'md-link';
    anchor.textContent = label;
    anchor.href = href;
    anchor.title = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    container.appendChild(anchor);
  }

  return {
    appendInlineMarkdown,
    safeMarkdownHref,
  };
});
