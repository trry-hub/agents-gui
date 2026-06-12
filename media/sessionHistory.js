(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.AgentsGuiSessionHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ACTIVE_TASK_STATUSES = Object.freeze(['preparing', 'running']);
  const TERMINAL_TASK_STATUSES = Object.freeze(['completed', 'failed', 'stopped']);

  function normalizeTimestamp(value) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
  }

  function threadTimestamp(thread) {
    return normalizeTimestamp(thread?.updatedAt) || normalizeTimestamp(thread?.createdAt);
  }

  function taskTimestamp(task) {
    return normalizeTimestamp(task?.updatedAt) || normalizeTimestamp(task?.createdAt);
  }

  function messageHasText(message) {
    return Boolean(String(message?.text || '').trim());
  }

  function threadHasAnswer(thread) {
    const messages = Array.isArray(thread?.messages) ? thread.messages : [];
    const hasUser = messages.some((message) => message?.role === 'user' && messageHasText(message));
    const hasAssistant = messages.some((message) => message?.role === 'assistant' && messageHasText(message));
    return hasUser && hasAssistant;
  }

  function threadHasConversation(thread) {
    return (Array.isArray(thread?.messages) ? thread.messages : []).some((message) => (
      message && messageHasText(message)
    ));
  }

  function threadHasRunningMessage(thread) {
    return (Array.isArray(thread?.messages) ? thread.messages : []).some((message) => (
      message && message.running
    ));
  }

  function tasksForThread(tasks, providerId, threadId) {
    return (Array.isArray(tasks) ? tasks : [])
      .filter((task) => (
        task &&
        task.providerId === providerId &&
        task.threadId === threadId
      ))
      .sort((a, b) => taskTimestamp(b) - taskTimestamp(a));
  }

  function latestTaskForThread(tasks, providerId, threadId) {
    return tasksForThread(tasks, providerId, threadId)[0];
  }

  function activeTaskForThread(tasks, providerId, threadId) {
    return tasksForThread(tasks, providerId, threadId)
      .find((task) => ACTIVE_TASK_STATUSES.includes(task.status));
  }

  function threadStatus(thread, options = {}) {
    const providerId = options.providerId || '';
    const threadId = thread?.id || '';
    const activeTask = activeTaskForThread(options.tasks, providerId, threadId);
    if (activeTask) {
      return activeTask.status === 'preparing' ? 'preparing' : 'running';
    }

    if (options.pendingByProvider?.[providerId] && options.pendingThreadByProvider?.[providerId] === threadId) {
      return 'preparing';
    }

    if (options.runningByProvider?.[providerId] && (options.activeThreadId || '') === threadId) {
      return 'running';
    }

    if (threadHasRunningMessage(thread)) {
      return 'running';
    }

    const latestTask = latestTaskForThread(options.tasks, providerId, threadId);
    if (TERMINAL_TASK_STATUSES.includes(latestTask?.status)) {
      return latestTask.status;
    }

    if (threadHasAnswer(thread)) {
      return 'answered';
    }

    if (threadHasConversation(thread)) {
      return 'answered';
    }

    return 'empty';
  }

  function sortedThreads(threads) {
    return (Array.isArray(threads) ? threads : [])
      .slice()
      .sort((a, b) => threadTimestamp(b) - threadTimestamp(a));
  }

  return {
    activeTaskForThread,
    latestTaskForThread,
    sortedThreads,
    taskTimestamp,
    threadHasAnswer,
    threadHasConversation,
    threadStatus,
    threadTimestamp,
  };
});
