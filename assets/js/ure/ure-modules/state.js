// Path:    assets/js/ure/ure-modules/state.js
// Purpose: Lightweight reactive state store for each engine instance.
//          Subscribers are notified synchronously on state change so
//          the engine can react immediately (re-render, emit events, etc.).
//          NOT a global singleton — each engine.mount() gets its own store.
// Used by: engine.js

(function (M) {
  'use strict';

  /**
   * Create a new StateStore.
   *
   * @param {object} initial - Initial state values
   * @returns {StateStore}
   */
  function createStateStore(initial = {}) {

    let _state = Object.assign({}, initial);

    /** @type {Map<string, Set<Function>>} key → listener set */
    const _listeners = new Map();

    /** @type {Set<Function>} catch-all listeners (fired on every change) */
    const _globalListeners = new Set();

    const Store = {

      // ── Read ──────────────────────────────────────────────────────────────

      /**
       * Get the current value of a key.
       * @param {string} key
       * @returns {any}
       */
      get(key) { return _state[key]; },

      /** Get a snapshot of the full state (shallow copy). */
      snapshot() { return Object.assign({}, _state); },

      // ── Write ─────────────────────────────────────────────────────────────

      /**
       * Set one or more state keys. Fires listeners for each changed key.
       * @param {string|object} keyOrObj - Key string OR { key: value } map
       * @param {any}           [value]  - Value (only when key is a string)
       */
      set(keyOrObj, value) {
        const changes = typeof keyOrObj === 'string'
          ? { [keyOrObj]: value }
          : keyOrObj;

        const changed = [];
        for (const k in changes) {
          const prev = _state[k];
          const next = changes[k];
          // Skip if value is identical (reference equality for objects)
          if (prev === next) continue;
          _state[k] = next;
          changed.push({ key: k, prev, next });
        }

        if (!changed.length) return;

        // Notify key-specific listeners
        for (const { key, prev, next } of changed) {
          const listeners = _listeners.get(key);
          if (listeners) {
            for (const fn of listeners) {
              try { fn(next, prev, key); } catch (e) { console.error('[URE/State] listener error:', e); }
            }
          }
        }

        // Notify global listeners once with the full change set
        for (const fn of _globalListeners) {
          try { fn(changed, _state); } catch (e) { console.error('[URE/State] global listener error:', e); }
        }
      },

      // ── Subscribe ─────────────────────────────────────────────────────────

      /**
       * Subscribe to changes on a specific key.
       * @param {string}   key
       * @param {Function} fn  - (newValue, prevValue, key) => void
       * @returns {Function} Unsubscribe function
       */
      on(key, fn) {
        if (!_listeners.has(key)) _listeners.set(key, new Set());
        _listeners.get(key).add(fn);
        return () => this.off(key, fn);
      },

      /**
       * Subscribe to ALL state changes.
       * @param {Function} fn - (changedArray, fullState) => void
       * @returns {Function} Unsubscribe
       */
      onAny(fn) {
        _globalListeners.add(fn);
        return () => _globalListeners.delete(fn);
      },

      /** Remove a specific key listener. */
      off(key, fn) {
        const s = _listeners.get(key);
        if (s) s.delete(fn);
      },

      /** Remove all listeners (called on engine destroy). */
      destroy() {
        _listeners.clear();
        _globalListeners.clear();
        _state = {};
      },
    };

    return Store;
  }

  M.createStateStore = createStateStore;

})(window.UREModules = window.UREModules || {});