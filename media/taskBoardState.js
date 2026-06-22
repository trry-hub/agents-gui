(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.AgentsGuiTaskBoardState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const TASK_STATUSES = Object.freeze(['preparing', 'running', 'completed', 'failed', 'stopped']);
  const ACTIVE_TASK_STATUSES = Object.freeze(['preparing', 'running']);
  const DEFAULT_TASK_LIMIT = 20;

  function normalizeStatus(status) {
    return TASK_STATUSES.includes(status) ? status : 'completed';
  }

  function statusCounts(source) {
    const counts = TASK_STATUSES.reduce((result, status) => ({ ...result, [status]: 0 }), {});
    (Array.isArray(source) ? source : []).forEach((task) => {
      counts[normalizeStatus(task?.status)] += 1;
    });
    return counts;
  }

  function isActiveTask(task) {
    return ACTIVE_TASK_STATUSES.includes(task?.status);
  }

  function visibleTasks(source, options = {}) {
    if (!options.enabled || options.dismissed) {
      return [];
    }

    return (Array.isArray(source) ? source : [])
      .filter(isActiveTask)
      .slice(0, Math.max(0, Number(options.limit) || 12));
  }

  function makeTaskId(providerId, options = {}) {
    const now = typeof options.now === 'function' ? options.now() : Date.now();
    const randomValue = typeof options.random === 'function' ? options.random() : Math.random();
    const randomText = typeof randomValue === 'number'
      ? randomValue.toString(36).slice(2, 8)
      : String(randomValue).replace(/^0\./, '').slice(0, 6);
    return `${providerId || 'task'}-${now}-${randomText || '000000'}`;
  }

  function normalizeSavedTasks(savedTasks, options = {}) {
    const fallbackTitle = options.fallbackTitle || 'Untitled task';
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const makeId = typeof options.makeTaskId === 'function' ? options.makeTaskId : makeTaskId;
    const limit = Math.max(0, Number(options.limit) || DEFAULT_TASK_LIMIT);

    return (Array.isArray(savedTasks) ? savedTasks : [])
      .filter((task) => task && typeof task === 'object' && task.providerId)
      .slice(0, limit)
      .map((task) => ({
        id: task.id || makeId(task.providerId),
        providerId: task.providerId,
        providerName: task.providerName || task.providerId,
        title: task.title || fallbackTitle,
        action: task.action || 'freeform',
        agentMode: task.agentMode || '',
        status: isActiveTask(task) ? 'stopped' : normalizeStatus(task.status),
        threadId: task.threadId || '',
        createdAt: Number(task.createdAt) || now(),
        updatedAt: Number(task.updatedAt) || now(),
      }));
  }

  function createTask(options = {}) {
    const providerId = options.providerId || '';
    const now = Number(options.now) || Date.now();
    return {
      id: options.id || makeTaskId(providerId, { now: () => now }),
      providerId,
      providerName: options.providerName || providerId,
      title: options.title || 'Untitled task',
      action: options.action || 'freeform',
      agentMode: options.agentMode || '',
      status: options.status || 'preparing',
      threadId: options.threadId || '',
      createdAt: now,
      updatedAt: now,
    };
  }

  function upsertRecentTask(source, task, options = {}) {
    if (!task?.id) {
      return Array.isArray(source) ? source.slice() : [];
    }
    const limit = Math.max(0, Number(options.limit) || DEFAULT_TASK_LIMIT);
    return [
      task,
      ...(Array.isArray(source) ? source : []).filter((item) => item?.id !== task.id),
    ].slice(0, limit);
  }

  return {
    ACTIVE_TASK_STATUSES,
    TASK_STATUSES,
    createTask,
    isActiveTask,
    makeTaskId,
    normalizeStatus,
    normalizeSavedTasks,
    statusCounts,
    upsertRecentTask,
    visibleTasks,
  };
});
