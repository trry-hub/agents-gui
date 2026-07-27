/**
 * Paced text reveal — throttles how fast streamed text is shown to the user.
 *
 * Inspired by OpenCode's createPacedValue (packages/session-ui/src/components/
 * message-part.tsx). This is a framework-agnostic port that works with vanilla
 * JS rendering instead of SolidJS signals.
 *
 * Why this exists:
 *   LLM token streams arrive in bursts. Rendering every token immediately
 *   causes layout thrashing, scroll jumps, and wasted markdown re-parses.
 *   Paced reveal:
 *     - Shows small deltas (≤ IMMEDIATE chars) immediately for snappy feel.
 *     - Throttles large deltas with an adaptive step that "catches up" faster
 *       as the backlog grows, so the display never falls behind the stream.
 *     - Snaps reveal boundaries to word/sentence edges for natural reading.
 *
 * Architecture:
 *   Each stream target (one per session) gets a PacedReveal instance. Call
 *   .update(fullText) whenever new text arrives. The instance schedules a
 *   setTimeout chain that progressively reveals the text and calls the
 *   provided onReveal callback with the currently-visible prefix. Call
 *   .finish() to flush everything immediately (e.g. on session end), and
 *   .reset() when switching sessions or clearing the buffer.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.AgentsGuiPacedReveal = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Interval between reveal steps when throttling (ms). ~42fps. */
  const PACE_MS = 24;

  /** If the unrevealed delta is ≤ this many chars, show immediately. */
  const IMMEDIATE = 512;

  /** Characters that make good reveal snap points (word/sentence boundaries). */
  const SNAP_RE = /[\s.,!?;:)\]]/;

  /**
   * Adaptive step size based on remaining characters.
   * The more backlog, the bigger each step — so we catch up faster and never
   * fall behind the stream.
   *
   * @param {number} size - remaining characters to reveal
   * @returns {number} step size for this round
   */
  function step(size) {
    if (size <= 12) return 2;
    if (size <= 48) return 4;
    if (size <= 96) return 8;
    return Math.min(256, Math.ceil(size / 4));
  }

  /**
   * Compute the next reveal end position, snapping to a word boundary when
   * one is within 8 chars after the base end.
   *
   * @param {string} text - full text
   * @param {number} start - current revealed length
   * @returns {number} next end position
   */
  function nextPosition(text, start) {
    const end = Math.min(text.length, start + step(text.length - start));
    const max = Math.min(text.length, end + 8);
    for (let i = end; i < max; i += 1) {
      if (SNAP_RE.test(text[i] ?? '')) return i + 1;
    }
    return end;
  }

  /**
   * Create a paced reveal controller for a single stream target.
   *
   * @param {object} options
   * @param {function(string): void} options.onReveal - called with the
   *   currently-visible text prefix whenever it changes during throttled
   *   reveal. Called synchronously for immediate updates.
   * @returns {PacedReveal}
   */
  function createPacedReveal(options) {
    const onReveal = typeof options?.onReveal === 'function' ? options.onReveal : () => {};
    let shown = '';        // how much text we've revealed so far
    let target = '';       // the full text we're revealing toward
    let timer = null;      // pending setTimeout handle
    let active = true;     // whether this controller is still in use

    function clearTimer() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function sync(text) {
      shown = text;
      onReveal(text);
    }

    /**
     * Advance one step and schedule the next if needed.
     */
    function run() {
      timer = null;
      if (!active) return;

      // If target was replaced or shortened, jump to it.
      if (!target.startsWith(shown) || target.length <= shown.length) {
        sync(target);
        return;
      }

      // Close enough — finish immediately.
      if (target.length - shown.length <= IMMEDIATE) {
        sync(target);
        return;
      }

      const end = nextPosition(target, shown.length);
      sync(target.slice(0, end));
      if (end < target.length) {
        timer = setTimeout(run, PACE_MS);
      }
    }

    /**
     * Called when the full streamed text changes (new tokens arrived).
     * @param {string} fullText - the complete accumulated text so far
     */
    function update(fullText) {
      if (!active) return;
      target = fullText;

      // Already fully revealed or no progress needed.
      if (target.length <= shown.length) {
        // Target may have changed entirely (e.g. echo filter rewrote text).
        if (target !== shown) {
          sync(target);
        }
        return;
      }

      // Target is not a prefix-extension of what we showed (text was replaced).
      if (!target.startsWith(shown)) {
        clearTimer();
        sync(target);
        return;
      }

      // Small delta — reveal immediately.
      if (target.length - shown.length <= IMMEDIATE) {
        clearTimer();
        sync(target);
        return;
      }

      // Large delta — schedule paced reveal if not already running.
      // The `timer !== null` check prevents stacking multiple timers.
      if (timer === null) {
        timer = setTimeout(run, PACE_MS);
      }
    }

    /**
     * Flush all pending text immediately (e.g. on session end or switch).
     */
    function finish() {
      clearTimer();
      if (target !== shown) {
        sync(target);
      }
    }

    /**
     * Reset to a new starting point (e.g. new message in same session slot).
     * @param {string} [initialText] - starting text, defaults to ''
     */
    function reset(initialText) {
      clearTimer();
      shown = '';
      target = typeof initialText === 'string' ? initialText : '';
      if (target) {
        sync(target);
      }
    }

    /**
     * Stop the controller permanently and clean up timers.
     */
    function dispose() {
      active = false;
      clearTimer();
    }

    /** How much text is currently visible. */
    function getShown() {
      return shown;
    }

    return {
      update,
      finish,
      reset,
      dispose,
      getShown,
    };
  }

  return {
    createPacedReveal,
    step,
    nextPosition,
    PACE_MS,
    IMMEDIATE,
    SNAP_RE,
  };
}));
