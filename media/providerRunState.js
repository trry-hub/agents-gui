(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.AgentsGuiProviderRunState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createProviderRunState() {
    return {
      pendingByProvider: {},
      pendingTaskByProvider: {},
      pendingThreadByProvider: {},
      runningByProvider: {},
    };
  }

  function isProviderBusy(state, providerId) {
    return Boolean(state?.runningByProvider?.[providerId] || state?.pendingByProvider?.[providerId]);
  }

  function setProviderPending(state, providerId, threadId, taskId) {
    if (!state || !providerId) {
      return;
    }

    state.pendingByProvider[providerId] = true;
    state.runningByProvider[providerId] = false;
    state.pendingThreadByProvider[providerId] = threadId || '';
    if (taskId) {
      state.pendingTaskByProvider[providerId] = taskId;
    }
  }

  function markProviderRunning(state, providerId) {
    if (!state || !providerId) {
      return;
    }

    state.pendingByProvider[providerId] = false;
    state.runningByProvider[providerId] = true;
  }

  function takePendingTaskId(state, providerId) {
    const taskId = state?.pendingTaskByProvider?.[providerId] || '';
    if (state?.pendingTaskByProvider && providerId) {
      delete state.pendingTaskByProvider[providerId];
    }
    return taskId;
  }

  function pendingThreadId(state, providerId) {
    return state?.pendingThreadByProvider?.[providerId] || '';
  }

  function clearProviderRunState(state, providerId) {
    if (!state || !providerId) {
      return;
    }

    state.runningByProvider[providerId] = false;
    state.pendingByProvider[providerId] = false;
    delete state.pendingThreadByProvider[providerId];
    delete state.pendingTaskByProvider[providerId];
  }

  return {
    clearProviderRunState,
    createProviderRunState,
    isProviderBusy,
    markProviderRunning,
    pendingThreadId,
    setProviderPending,
    takePendingTaskId,
  };
});
