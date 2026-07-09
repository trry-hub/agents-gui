/**
 * Reactive State Manager for agents-gui webview
 *
 * Inspired by OpenCode's Effect-based architecture, this module provides:
 * - Centralized state management
 * - Reactive state updates (listeners notified on change)
 * - Automatic rendering on state changes
 * - Event logging for debugging
 *
 * Architecture:
 * - StateManager holds all application state
 * - dispatch() is the single entry point for state changes
 * - Listeners are automatically notified on state changes
 * - renderAll() is called after each dispatch (debounced)
 */

(function () {
  'use strict';

  /**
   * Create a reactive state value
   * @template T
   * @param {T} initialValue
   * @returns {{ value: T, set: (v: T) => void, subscribe: (fn: (v: T) => void) => () => void }}
   */
  function createReactiveValue(initialValue) {
    let _value = initialValue;
    const listeners = new Set();

    return {
      get value() {
        return _value;
      },
      set(newValue) {
        const oldValue = _value;
        _value = newValue;
        if (oldValue !== newValue) {
          listeners.forEach(fn => {
            try {
              fn(newValue, oldValue);
            } catch (err) {
              console.error('[StateManager] Listener error:', err);
            }
          });
        }
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      // For batch updates - set without notifying
      setSilent(newValue) {
        _value = newValue;
      }
    };
  }

  /**
   * Event log for debugging state changes
   */
  class EventLog {
    constructor(maxEntries = 100) {
      this.entries = [];
      this.maxEntries = maxEntries;
    }

    log(type, payload, prevState, nextState) {
      this.entries.push({
        type,
        payload,
        timestamp: Date.now(),
        stateSnapshot: { ...nextState }
      });

      if (this.entries.length > this.maxEntries) {
        this.entries.shift();
      }

      // Log to console in development
      if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
        console.log(`[StateManager] ${type}`, payload);
      }
    }

    getEntries() {
      return [...this.entries];
    }

    clear() {
      this.entries = [];
    }
  }

  /**
   * Main state manager
   */
  class StateManager {
    constructor() {
      this.eventLog = new EventLog();
      this.renderTimer = null;
      this.renderCallback = null;
      this.isUpdating = false;

      // Core application state
      this.state = {
        // Active provider
        activeId: '',

        // Provider run state
        providerRunStore: {
          pendingByProvider: {},
          runningByProvider: {},
          pendingTaskByProvider: {},
          pendingThreadByProvider: {}
        },

        // Stream targets for active sessions
        streamTargets: {},

        // Stopped session IDs
        stoppedSessionIds: new Set(),

        // Task mapping
        taskBySessionId: {},

        // Messages by provider and thread
        threadsByProvider: {},

        // Active threads
        activeThreadByProvider: {},

        // Provider profiles
        profiles: [],
        profilesLoading: true,

        // UI state
        isSettingsOpen: false,
        activeSettingsSection: 'agents',

        // Context
        contextSummary: null
      };

      // Event listeners
      this.listeners = new Map();
    }

    /**
     * Register a render callback
     * @param {Function} renderFn - Function to call for rendering
     */
    setRenderCallback(renderFn) {
      this.renderCallback = renderFn;
    }

    /**
     * Dispatch a state change
     * @param {{ type: string, payload: any }} action
     */
    dispatch(action) {
      const { type, payload } = action;
      const prevState = { ...this.state };

      this.isUpdating = true;

      try {
        switch (type) {
          case 'SET_ACTIVE_PROVIDER':
            this.state.activeId = payload.providerId;
            break;

          case 'REQUEST_STARTED':
            this._handleRequestStarted(payload);
            break;

          case 'OUTPUT_RECEIVED':
            this._handleOutputReceived(payload);
            break;

          case 'SESSION_ENDED':
            this._handleSessionEnded(payload);
            break;

          case 'SESSION_STOPPED':
            this._handleSessionStopped(payload);
            break;

          case 'ERROR_RECEIVED':
            this._handleError(payload);
            break;

          case 'UPDATE_STREAM_TARGET':
            this._updateStreamTarget(payload);
            break;

          case 'CLEAR_PROVIDER_STATE':
            this._clearProviderState(payload.providerId);
            break;

          case 'SET_PROFILES':
            this.state.profiles = payload.profiles;
            this.state.profilesLoading = false;
            break;

          case 'SET_CONTEXT_SUMMARY':
            this.state.contextSummary = payload.summary;
            break;

          case 'SETTINGS_OPENED':
            this.state.isSettingsOpen = true;
            this.state.activeSettingsSection = payload.section || 'agents';
            break;

          case 'SETTINGS_CLOSED':
            this.state.isSettingsOpen = false;
            break;

          default:
            console.warn(`[StateManager] Unknown action type: ${type}`);
        }

        this.eventLog.log(type, payload, prevState, this.state);
        this._scheduleRender();
      } finally {
        this.isUpdating = false;
      }
    }

    /**
     * Get current state (read-only)
     */
    getState() {
      return { ...this.state };
    }

    /**
     * Subscribe to state changes
     * @param {string} eventType - Event type to listen for
     * @param {Function} listener - Callback function
     * @returns {Function} Unsubscribe function
     */
    on(eventType, listener) {
      if (!this.listeners.has(eventType)) {
        this.listeners.set(eventType, new Set());
      }
      this.listeners.get(eventType).add(listener);
      return () => this.listeners.get(eventType)?.delete(listener);
    }

    /**
     * Emit an event to listeners
     */
    emit(eventType, data) {
      this.listeners.get(eventType)?.forEach(fn => {
        try {
          fn(data);
        } catch (err) {
          console.error(`[StateManager] Event listener error for ${eventType}:`, err);
        }
      });
    }

    // ========== Internal state handlers ==========

    _handleRequestStarted(payload) {
      const { cliId, sessionId, threadId, taskId } = payload;

      // Update provider run state
      this.state.providerRunStore.runningByProvider[cliId] = true;
      this.state.providerRunStore.pendingByProvider[cliId] = false;

      // Store task mapping
      if (taskId) {
        this.state.taskBySessionId[sessionId] = taskId;
      }

      // Initialize stream target
      this.state.streamTargets[sessionId] = {
        cliId,
        threadId,
        buffer: '',
        thinkingBuffer: ''
      };
    }

    _handleOutputReceived(payload) {
      const { sessionId, text, thinking } = payload;
      const target = this.state.streamTargets[sessionId];

      if (!target) {
        console.warn(`[StateManager] No stream target for session ${sessionId}`);
        return;
      }

      // Append to buffer
      if (text) {
        target.buffer += text;
      }
      if (thinking) {
        target.thinkingBuffer += thinking;
      }
    }

    _handleSessionEnded(payload) {
      const { cliId, sessionId } = payload;

      // Clear stream target
      delete this.state.streamTargets[sessionId];

      // Clear provider run state
      this._clearProviderState(cliId);
    }

    _handleSessionStopped(payload) {
      const { cliId, sessionId } = payload;

      // Mark as stopped
      this.state.stoppedSessionIds.add(sessionId);

      // Clear stream target
      delete this.state.streamTargets[sessionId];

      // Clear provider run state
      this._clearProviderState(cliId);

      // Clean up task mapping
      delete this.state.taskBySessionId[sessionId];
    }

    _handleError(payload) {
      const { cliId } = payload;

      // Clear provider run state
      this._clearProviderState(cliId);
    }

    _updateStreamTarget(payload) {
      const { sessionId, buffer, thinkingBuffer } = payload;
      const target = this.state.streamTargets[sessionId];

      if (target) {
        if (buffer !== undefined) {
          target.buffer = buffer;
        }
        if (thinkingBuffer !== undefined) {
          target.thinkingBuffer = thinkingBuffer;
        }
      }
    }

    _clearProviderState(providerId) {
      this.state.providerRunStore.pendingByProvider[providerId] = false;
      this.state.providerRunStore.runningByProvider[providerId] = false;
      delete this.state.providerRunStore.pendingTaskByProvider[providerId];
      delete this.state.providerRunStore.pendingThreadByProvider[providerId];
    }

    /**
     * Schedule a render (debounced)
     */
    _scheduleRender() {
      if (this.renderTimer) {
        cancelAnimationFrame(this.renderTimer);
      }
      this.renderTimer = requestAnimationFrame(() => {
        this.renderTimer = null;
        if (this.renderCallback) {
          try {
            this.renderCallback();
          } catch (err) {
            console.error('[StateManager] Render callback error:', err);
          }
        }
      });
    }
  }

  // Create singleton instance
  const stateManager = new StateManager();

  // Export to window
  window.AgentsGuiStateManager = stateManager;
})();
