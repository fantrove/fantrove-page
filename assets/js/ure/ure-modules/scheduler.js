// Path:    assets/js/ure/ure-modules/scheduler.js
// Purpose: Centralised task scheduler that batches visual work into rAF and
//          background work into requestIdleCallback (or setTimeout fallback).
//          Prevents layout-thrashing by separating reads from writes.
// Used by: virtual-list.js, engine.js

(function (M) {
  'use strict';

  const { CONFIG } = M;

  // ── MessageChannel yield (faster than setTimeout(0)) ────────────────────
  // Fires after paint, giving the compositor a frame slot.
  const _mc = (() => {
    try {
      const { port1, port2 } = new MessageChannel();
      let _res = null;
      port1.onmessage = () => { if (_res) { const r = _res; _res = null; r(); } };
      return { yield: () => new Promise(r => { _res = r; port2.postMessage(null); }) };
    } catch (_) {
      return { yield: () => new Promise(r => setTimeout(r, 0)) };
    }
  })();

  // ── Scheduler ─────────────────────────────────────────────────────────────

  const Scheduler = {
    _rafId      : null,
    _idleId     : null,
    _visualQueue: [],  // tasks to run this rAF frame
    _idleQueue  : [],  // tasks to run during idle time

    // ── Public: queue a visual-priority task (runs in next rAF) ───────────

    /**
     * Schedule a DOM read/write task for the next animation frame.
     * @param {Function} fn   - Task to execute
     * @param {string}   [name] - Debug label
     */
    schedule(fn, name = 'task') {
      this._visualQueue.push({ fn, name });
      this._requestFrame();
    },

    // ── Public: queue a background task (runs in idle time) ───────────────

    /**
     * Schedule a non-visual task (data processing, preloading) for idle time.
     * @param {Function} fn
     * @param {string}   [name]
     */
    scheduleIdle(fn, name = 'idle-task') {
      this._idleQueue.push({ fn, name });
      this._requestIdle();
    },

    // ── Public: async yield to compositor ─────────────────────────────────

    /** Yield execution to the browser compositor (post-paint). */
    yield() {
      if (typeof scheduler !== 'undefined' && scheduler.yield) return scheduler.yield();
      return _mc.yield();
    },

    // ── Public: flush a batch of work with yields between chunks ──────────

    /**
     * Process an array of items in chunks, yielding between each chunk.
     * Prevents long tasks from blocking input handling.
     * @param {any[]}    items
     * @param {Function} processFn  - Called with each item
     * @param {number}   chunkSize
     */
    async processBatched(items, processFn, chunkSize) {
      for (let i = 0; i < items.length; i++) {
        processFn(items[i], i);
        if ((i + 1) % chunkSize === 0) await this.yield();
      }
    },

    // ── Private: rAF pump ────────────────────────────────────────────────

    _requestFrame() {
      if (this._rafId) return;
      this._rafId = requestAnimationFrame(() => this._flushVisual());
    },

    _flushVisual() {
      this._rafId = null;
      // Drain the queue in FIFO order; any task that re-schedules will land
      // in the next frame, not the current one.
      const batch = this._visualQueue.splice(0);
      for (const { fn, name } of batch) {
        try { fn(); }
        catch (e) { console.error(`[URE/Scheduler] visual task "${name}" failed:`, e); }
      }
      if (this._visualQueue.length) this._requestFrame();
    },

    // ── Private: idle pump ────────────────────────────────────────────────

    _requestIdle() {
      if (this._idleId) return;
      if (typeof requestIdleCallback === 'function') {
        this._idleId = requestIdleCallback(
          dl => this._flushIdle(dl),
          { timeout: CONFIG.TIMING.IDLE_CALLBACK_TIMEOUT_MS }
        );
      } else {
        this._idleId = setTimeout(() => this._flushIdle(null), 50);
      }
    },

    _flushIdle(deadline) {
      this._idleId = null;
      while (this._idleQueue.length) {
        // Stop if we've used up the current idle slice (deadline-aware)
        if (deadline && deadline.timeRemaining && deadline.timeRemaining() < 2) break;
        const { fn, name } = this._idleQueue.shift();
        try { fn(); }
        catch (e) { console.error(`[URE/Scheduler] idle task "${name}" failed:`, e); }
      }
      if (this._idleQueue.length) this._requestIdle();
    },

    // ── Public: cancel all pending work ────────────────────────────────────

    cancel() {
      if (this._rafId) { cancelAnimationFrame(this._rafId);  this._rafId  = null; }
      if (this._idleId) {
        if (typeof cancelIdleCallback === 'function') cancelIdleCallback(this._idleId);
        else clearTimeout(this._idleId);
        this._idleId = null;
      }
      this._visualQueue = [];
      this._idleQueue   = [];
    },
  };

  M.Scheduler = Scheduler;

})(window.UREModules = window.UREModules || {});