(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.AgentsGuiConversationStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX_MESSAGE_DURATION_MS = 30 * 60 * 1000;

  function normalizeThreadMessages(threadMessages, options = {}) {
    const normalizeAssistantText =
      typeof options.normalizeAssistantText === 'function'
        ? options.normalizeAssistantText
        : defaultNormalizeAssistantText;
    const sanitizeThinkingText =
      typeof options.sanitizeThinkingText === 'function'
        ? options.sanitizeThinkingText
        : defaultSanitizeThinkingText;

    return (Array.isArray(threadMessages) ? threadMessages : []).map((message) => {
      if (!message || typeof message !== 'object') {
        return message;
      }

      if (message.role !== 'assistant' && message.role !== 'error') {
        return message;
      }

      const { startedAt, durationMs, ...rest } = message;
      const normalized = {
        ...rest,
        running: false,
        text: normalizeAssistantText(message.text),
        thinking: sanitizeThinkingText(message.thinking),
      };
      const safeDurationMs = normalizeDurationMs(durationMs);
      if (safeDurationMs !== undefined) {
        normalized.durationMs = safeDurationMs;
      }
      return normalized;
    });
  }

  function serializeThreadsForState(source) {
    const serialized = {};
    Object.entries(source || {}).forEach(([cliId, threads]) => {
      serialized[cliId] = (Array.isArray(threads) ? threads : []).map((thread) => ({
        ...thread,
        messages: (Array.isArray(thread?.messages) ? thread.messages : []).map((message) => {
          if (!message || typeof message !== 'object') {
            return message;
          }
          const { startedAt, durationMs, ...rest } = message;
          const serializedMessage = { ...rest, running: false };
          const safeDurationMs = normalizeDurationMs(durationMs);
          if (safeDurationMs !== undefined) {
            serializedMessage.durationMs = safeDurationMs;
          }
          return serializedMessage;
        }),
      }));
    });
    return serialized;
  }

  function normalizeDurationMs(value, options = {}) {
    const duration = Number(value);
    if (!Number.isFinite(duration) || duration < 0) {
      return undefined;
    }

    const maxDuration = Number(options.maxDurationMs ?? MAX_MESSAGE_DURATION_MS);
    if (Number.isFinite(maxDuration) && maxDuration > 0 && duration > maxDuration) {
      return undefined;
    }

    return Math.floor(duration);
  }

  function makeThreadId(cliId, options = {}) {
    const now = typeof options.now === 'function' ? options.now() : Date.now();
    const randomValue = typeof options.random === 'function' ? options.random() : Math.random();
    const randomText = typeof randomValue === 'number'
      ? randomValue.toString(36).slice(2, 8)
      : String(randomValue).replace(/^0\./, '').slice(0, 6);
    return `${cliId || 'thread'}-${now}-${randomText || '000000'}`;
  }

  function createThread(cliId, messages, options = {}) {
    const nowValue = typeof options.now === 'function' ? options.now() : options.now;
    const now = Number(nowValue) || Date.now();
    const initialMessages = Array.isArray(messages) ? messages : [];
    const deriveThreadTitle =
      typeof options.deriveThreadTitle === 'function'
        ? options.deriveThreadTitle
        : defaultDeriveThreadTitle;
    const newThreadTitle = typeof options.newThreadTitle === 'string' ? options.newThreadTitle : 'New session';

    return {
      id: options.id || makeThreadId(cliId, { now: () => now, random: options.random }),
      title: deriveThreadTitle(initialMessages) || newThreadTitle,
      createdAt: now,
      updatedAt: now,
      messages: initialMessages,
    };
  }

  function ensureThreadList(source, cliId) {
    if (!cliId) {
      return [];
    }
    if (!source[cliId]) {
      source[cliId] = [];
    }
    return source[cliId];
  }

  function findThread(source, cliId, threadId) {
    return ensureThreadList(source, cliId).find((thread) => thread.id === threadId);
  }

  function ensureActiveThread(source, activeThreadByProvider, cliId, createThreadForCli) {
    if (!cliId) {
      return null;
    }

    const threads = ensureThreadList(source, cliId);
    let thread = findThread(source, cliId, activeThreadByProvider[cliId]);

    if (!thread) {
      thread = threads[0];
    }

    if (!thread) {
      thread = createThreadForCli(cliId);
      threads.unshift(thread);
    }

    activeThreadByProvider[cliId] = thread.id;
    return thread;
  }

  function setActiveThread(source, activeThreadByProvider, cliId, thread) {
    if (!cliId || !thread) {
      return null;
    }

    const threads = ensureThreadList(source, cliId);
    if (!threads.includes(thread)) {
      threads.unshift(thread);
    }
    activeThreadByProvider[cliId] = thread.id;
    return thread;
  }

  function latestThread(threads) {
    return (Array.isArray(threads) ? threads : [])
      .slice()
      .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))[0] || null;
  }

  function defaultNormalizeAssistantText(text) {
    return String(text || '');
  }

  function defaultSanitizeThinkingText(text) {
    return typeof text === 'string' ? text : '';
  }

  function defaultDeriveThreadTitle(messagesOrText) {
    if (typeof messagesOrText === 'string') {
      return messagesOrText.trim();
    }
    if (!Array.isArray(messagesOrText)) {
      return '';
    }
    return messagesOrText.find((message) => message?.role === 'user')?.text?.trim() || '';
  }

  return {
    createThread,
    ensureActiveThread,
    ensureThreadList,
    findThread,
    latestThread,
    makeThreadId,
    normalizeDurationMs,
    normalizeThreadMessages,
    serializeThreadsForState,
    setActiveThread,
  };
});
