// Path:    assets/js/ure/ure-modules/memory.js
// Purpose: Adaptive memory pressure monitor. Detects heap usage via
//          performance.memory (Chromium), device class via navigator.deviceMemory,
//          and page-visibility events. Notifies URE modules when pressure
//          changes so each can trim caches or restore capacity accordingly.
//
// v1.7.0  New module.
//
// Pressure levels: COMFORTABLE(0) → MODERATE(1) → TIGHT(2) → CRITICAL(3)
//
// Detection strategy (highest wins):
//   1. Static — navigator.deviceMemory at init (all browsers)
//   2. Dynamic — performance.memory heap ratio polled every 30 s (Chromium only)
//   3. Page-hidden — immediate re-evaluation on visibilitychange
//
// Budgets are defined in CONFIG.MEMORY.BUDGETS as [comfortable, moderate, tight, critical].
// Consumers call getBudget(key) to read the current cap for their component.
//
// Used by: engine.js

(function (M) {
  'use strict';

  const { CONFIG } = M;
  const { MEMORY }  = CONFIG;

  // ── Pressure enum ─────────────────────────────────────────────────────────

  const PRESSURE = Object.freeze({
    COMFORTABLE : 0,
    MODERATE    : 1,
    TIGHT       : 2,
    CRITICAL    : 3,
  });

  const PRESSURE_NAMES = ['COMFORTABLE', 'MODERATE', 'TIGHT', 'CRITICAL'];

  // ── Static baseline from device memory ───────────────────────────────────
  // navigator.deviceMemory → 0.25 | 0.5 | 1 | 2 | 4 | 8 (GB) or undefined
  // Treat undefined as 4 GB (capable device, cautious default).

  function _staticPressure() {
    const gb = (navigator && navigator.deviceMemory) || 4;
    const [t0, t1, t2] = MEMORY.DEVICE_MEMORY_THRESHOLDS_GB;
    if (gb >= t0) return PRESSURE.COMFORTABLE;
    if (gb >= t1) return PRESSURE.MODERATE;
    if (gb >= t2) return PRESSURE.TIGHT;
    return PRESSURE.CRITICAL;
  }

  // ── Dynamic heap check (Chromium only) ───────────────────────────────────
  // Returns null if performance.memory is unavailable — caller falls back to
  // static pressure in that case.

  function _heapPressure() {
    try {
      const m = performance.memory;
      if (!m || !m.jsHeapSizeLimit || m.jsHeapSizeLimit === 0) return null;
      const ratio = m.usedJSHeapSize / m.jsHeapSizeLimit;
      const [t1, t2, t3] = MEMORY.HEAP_USAGE_THRESHOLDS;
      if (ratio < t1) return PRESSURE.COMFORTABLE;
      if (ratio < t2) return PRESSURE.MODERATE;
      if (ratio < t3) return PRESSURE.TIGHT;
      return PRESSURE.CRITICAL;
    } catch (_) {
      return null;
    }
  }

  // ── Singleton state ───────────────────────────────────────────────────────

  let _level     = _staticPressure();
  let _pollId    = null;
  let _destroyed = false;

  /** @type {Set<(next: number, prev: number) => void>} */
  const _listeners = new Set();

  // ── Evaluate + notify ─────────────────────────────────────────────────────

  function _evaluate() {
    if (_destroyed) return;
    const heap = _heapPressure();
    // Take max(static, heap) so a degrading heap can raise pressure even on
    // a capable device. If heap is unavailable, static baseline stands.
    const next = heap !== null
      ? Math.max(_staticPressure(), heap)
      : _staticPressure();
    if (next === _level) return;
    const prev = _level;
    _level = next;
    _notifyAll(prev, next);
  }

  function _notifyAll(prev, next) {
    for (const fn of _listeners) {
      try { fn(next, prev); }
      catch (e) { console.error('[URE/Memory] listener error:', e); }
    }
  }

  // ── Polling + page-visibility ─────────────────────────────────────────────

  function _startPolling() {
    if (_pollId || _destroyed) return;
    _pollId = setInterval(_evaluate, MEMORY.POLL_INTERVAL_MS);
  }

  function _onVisibilityChange() {
    // Re-evaluate immediately when page hides — the CRITICAL+hidden path in
    // engine.js clears worker data to reclaim the largest single allocation.
    if (document.hidden) _evaluate();
  }

  document.addEventListener('visibilitychange', _onVisibilityChange, { passive: true });
  _startPolling();

  // ── Public API ────────────────────────────────────────────────────────────

  const MemoryManager = Object.freeze({

    PRESSURE,

    /** Current pressure level (0–3). */
    get level() { return _level; },

    /**
     * Return the budget cap for one component at the current pressure level.
     * @param {string} key — must match a key in CONFIG.MEMORY.BUDGETS
     * @returns {number|null}
     */
    getBudget(key) {
      const row = MEMORY.BUDGETS[key];
      return row ? row[_level] : null;
    },

    /** All budgets as a plain object at the current pressure level. */
    getAllBudgets() {
      const out = {};
      for (const key of Object.keys(MEMORY.BUDGETS)) {
        out[key] = MEMORY.BUDGETS[key][_level];
      }
      return out;
    },

    /**
     * Subscribe to pressure changes.
     * @param {(next: number, prev: number) => void} fn
     * @returns {() => void} unsubscribe
     */
    on(fn) {
      _listeners.add(fn);
      return () => _listeners.delete(fn);
    },

    /** Force an immediate evaluation — call after large data operations. */
    checkpoint() { _evaluate(); },

    /** Human-readable pressure label for debugging. */
    levelName() { return PRESSURE_NAMES[_level] || 'UNKNOWN'; },

    /** Stats snapshot — safe to call at any time. */
    stats() {
      try {
        const m = performance.memory;
        return {
          level        : _level,
          levelName    : MemoryManager.levelName(),
          deviceMemGB  : (navigator && navigator.deviceMemory) || null,
          heapUsed     : m ? m.usedJSHeapSize  : null,
          heapLimit    : m ? m.jsHeapSizeLimit : null,
          heapRatio    : (m && m.jsHeapSizeLimit)
            ? (m.usedJSHeapSize / m.jsHeapSizeLimit) : null,
          budgets      : MemoryManager.getAllBudgets(),
          listenerCount: _listeners.size,
        };
      } catch (_) {
        return { level: _level, levelName: MemoryManager.levelName() };
      }
    },

    /**
     * Full cleanup. Only needed in test environments; the manager is
     * page-scoped and survives the lifetime of the page normally.
     */
    destroy() {
      _destroyed = true;
      if (_pollId) { clearInterval(_pollId); _pollId = null; }
      document.removeEventListener('visibilitychange', _onVisibilityChange);
      _listeners.clear();
    },
  });

  M.MemoryManager = MemoryManager;

})(window.UREModules = window.UREModules || {});