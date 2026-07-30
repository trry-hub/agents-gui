(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.AgentsGuiConversationStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX_MESSAGE_DURATION_MS = 30 * 60 * 1000;
  const LIMITS = Object.freeze({
    maxThreadsPerProvider: 100,
    maxMessagesPerThread: 200,
    maxMessageTextChars: 200000,
    maxThinkingTextChars: 100000,
    maxAttachmentsPerMessage: 8,
    maxPersistedBytes: 4 * 1024 * 1024,
  });

  function boundTextForMemory(value, maxChars = LIMITS.maxMessageTextChars) {
    const text = typeof value === 'string' ? value : String(value || '');
    return text.length > maxChars ? text.slice(0, maxChars) : text;
  }

  function boundAttachments(attachments) {
    return (Array.isArray(attachments) ? attachments : [])
      .filter((attachment) => attachment && typeof attachment === 'object')
      .slice(0, LIMITS.maxAttachmentsPerMessage)
      .map((attachment) => {
        return {
          kind: attachment.kind,
          name: boundTextForMemory(attachment.name, 256),
          mimeType: boundTextForMemory(attachment.mimeType, 128),
          size: Number(attachment.size) || 0,
          path: boundTextForMemory(attachment.path, 2048),
        };
      });
  }

  function boundActivityEntry(activity) {
    if (!activity || typeof activity !== 'object') {
      return undefined;
    }
    return {
      kind: ['file', 'search', 'command', 'tool'].includes(activity.kind)
        ? activity.kind
        : 'tool',
      id: boundTextForMemory(activity.id, 256),
      name: boundTextForMemory(activity.name, 512),
      target: boundTextForMemory(activity.target, 2048),
      detail: boundTextForMemory(activity.detail, 4096),
      ...(Number.isFinite(Number(activity.offset))
        ? { offset: Math.max(0, Number(activity.offset)) }
        : {}),
    };
  }

  function boundActivity(activity) {
    if (!activity || typeof activity !== 'object') {
      return undefined;
    }
    return {
      files: (Array.isArray(activity.files) ? activity.files : [])
        .slice(-40)
        .map((value) => boundTextForMemory(value, 2048)),
      fileEvents: Math.max(0, Number(activity.fileEvents) || 0),
      searches: Math.max(0, Number(activity.searches) || 0),
      commands: Math.max(0, Number(activity.commands) || 0),
      tools: Math.max(0, Number(activity.tools) || 0),
      ids: (Array.isArray(activity.ids) ? activity.ids : [])
        .slice(-120)
        .map((value) => boundTextForMemory(value, 256)),
      entries: (Array.isArray(activity.entries) ? activity.entries : [])
        .slice(-40)
        .map(boundActivityEntry)
        .filter(Boolean),
    };
  }

  function boundMessage(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return undefined;
    }
    const bounded = {};
    if ('role' in message) bounded.role = boundTextForMemory(message.role, 32);
    if ('text' in message) bounded.text = boundTextForMemory(message.text);
    if ('meta' in message) bounded.meta = boundTextForMemory(message.meta, 2048);
    if ('running' in message) bounded.running = Boolean(message.running);
    if ('startedAt' in message && Number.isFinite(Number(message.startedAt))) {
      bounded.startedAt = Number(message.startedAt);
    }
    if ('durationMs' in message && Number.isFinite(Number(message.durationMs))) {
      bounded.durationMs = Number(message.durationMs);
    }
    if ('runningNotice' in message) {
      bounded.runningNotice = boundTextForMemory(message.runningNotice, 2048);
    }
    if ('thinking' in message) {
      bounded.thinking = boundTextForMemory(
        message.thinking,
        LIMITS.maxThinkingTextChars
      );
    }
    if ('attachments' in message) {
      bounded.attachments = boundAttachments(message.attachments);
    }
    if ('activity' in message) {
      bounded.activity = boundActivity(message.activity);
    }
    if ('activityTimeline' in message) {
      bounded.activityTimeline = (Array.isArray(message.activityTimeline)
        ? message.activityTimeline
        : [])
        .slice(-80)
        .map(boundActivityEntry)
        .filter(Boolean);
    }
    return bounded;
  }

  function appendMessage(thread, message) {
    if (!thread || typeof thread !== 'object') {
      return -1;
    }
    if (!Array.isArray(thread.messages)) {
      thread.messages = [];
    }
    const bounded = boundMessage(message);
    if (!bounded) {
      return -1;
    }
    thread.messages.push(bounded);
    if (thread.messages.length > LIMITS.maxMessagesPerThread) {
      thread.messages.splice(0, thread.messages.length - LIMITS.maxMessagesPerThread);
    }
    return thread.messages.length - 1;
  }

  function serializedByteLength(value) {
    const json = JSON.stringify(value);
    if (typeof TextEncoder === 'function') {
      return new TextEncoder().encode(json).byteLength;
    }
    return unescape(encodeURIComponent(json)).length;
  }

  function normalizeThreadMessages(threadMessages, options = {}) {
    const normalizeAssistantText =
      typeof options.normalizeAssistantText === 'function'
        ? options.normalizeAssistantText
        : defaultNormalizeAssistantText;
    const sanitizeThinkingText =
      typeof options.sanitizeThinkingText === 'function'
        ? options.sanitizeThinkingText
        : defaultSanitizeThinkingText;

    return (Array.isArray(threadMessages) ? threadMessages : [])
      .filter((message) => message && typeof message === 'object' && !Array.isArray(message))
      .slice(-LIMITS.maxMessagesPerThread)
      .map((message) => {
        if (message.role !== 'assistant' && message.role !== 'error') {
          return boundMessage(message);
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
        return boundMessage(normalized);
      });
  }

  function serializeThreadsForState(source) {
    const serialized = {};
    Object.entries(source || {}).forEach(([cliId, threads]) => {
      if (!cliId || cliId.length > 128) {
        return;
      }
      serialized[cliId] = [];
      const boundedThreads = (Array.isArray(threads) ? threads : []).slice(
        0,
        LIMITS.maxThreadsPerProvider
      );
      for (const thread of boundedThreads) {
        const serializedThread = {
          id: boundTextForMemory(thread?.id, 512),
          messages: (Array.isArray(thread?.messages) ? thread.messages : [])
            .filter(
              (message) =>
                message && typeof message === 'object' && !Array.isArray(message)
            )
            .slice(-LIMITS.maxMessagesPerThread)
            .map((message) => {
              const { startedAt, durationMs, ...rest } = boundMessage(message);
              const serializedMessage = { ...rest, running: false };
              const safeDurationMs = normalizeDurationMs(durationMs);
              if (safeDurationMs !== undefined) {
                serializedMessage.durationMs = safeDurationMs;
              }
              return serializedMessage;
            }),
        };
        if (typeof thread?.title === 'string') {
          serializedThread.title = boundTextForMemory(thread.title, 500);
        }
        if (Number.isFinite(Number(thread?.createdAt))) {
          serializedThread.createdAt = Number(thread.createdAt);
        }
        if (Number.isFinite(Number(thread?.updatedAt))) {
          serializedThread.updatedAt = Number(thread.updatedAt);
        }
        serialized[cliId].push(serializedThread);
        if (serializedByteLength(serialized) > LIMITS.maxPersistedBytes) {
          serialized[cliId].pop();
          break;
        }
      }
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
    const initialMessages = (Array.isArray(messages) ? messages : [])
      .filter((message) => message && typeof message === 'object' && !Array.isArray(message))
      .slice(-LIMITS.maxMessagesPerThread)
      .map(boundMessage);
    const deriveThreadTitle =
      typeof options.deriveThreadTitle === 'function'
        ? options.deriveThreadTitle
        : defaultDeriveThreadTitle;
    const newThreadTitle = typeof options.newThreadTitle === 'string' ? options.newThreadTitle : 'New session';

    return {
      id: options.id || makeThreadId(cliId, { now: () => now, random: options.random }),
      title: boundTextForMemory(
        deriveThreadTitle(initialMessages) || newThreadTitle,
        500
      ),
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
    if (source[cliId].length > LIMITS.maxThreadsPerProvider) {
      source[cliId].splice(LIMITS.maxThreadsPerProvider);
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
      if (threads.length > LIMITS.maxThreadsPerProvider) {
        threads.splice(LIMITS.maxThreadsPerProvider);
      }
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
    LIMITS,
    appendMessage,
    boundTextForMemory,
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
