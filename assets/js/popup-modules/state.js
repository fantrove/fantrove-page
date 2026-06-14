// Path:    assets/js/popup-modules/state.js
// Purpose: Central state manager for the Popup System.
//          Tracks all active popups, stacking order, scroll lock state,
//          and the popup queue.
// Used by: engine.js, queue.js, overlay.js

(function(M) {
  'use strict';

  const { CONFIG } = M;

  // ── Private state ──────────────────────────────────────────────────────────

  /**
   * All active (non-destroyed) popup instances, keyed by ID.
   * @type {Map<string, PopupInstance>}
   */
  const _instances = new Map();

  /**
   * Stack-ordered array of popup IDs (bottom to top).
   * The last entry is the topmost popup.
   * @type {string[]}
   */
  const _stack = [];

  /**
   * Group registry — maps group name to the currently open popup ID in that group.
   * Only one popup per group can be open at a time.
   * @type {Map<string, string>}
   */
  const _groups = new Map();

  /**
   * Queue of pending popup open requests (when MAX_CONCURRENT is reached).
   * @type {Array<{ resolve: Function, reject: Function, options: PopupOptions }>}
   */
  const _queue = [];

  /**
   * Page scroll lock reference counter.
   * Incremented for every popup that requests lockScroll.
   * Scroll is only unlocked when the counter returns to 0.
   * @type {number}
   */
  let _scrollLockCount = 0;

  /**
   * Saved scroll position when scroll lock is active.
   * @type {number}
   */
  let _savedScrollY = 0;

  /**
   * Whether the system has been destroyed (for testing / cleanup).
   * @type {boolean}
   */
  let _destroyed = false;

  /**
   * Global key/value event listeners for the system.
   * @type {Map<string, Set<Function>>}
   */
  const _systemListeners = new Map();

  // ── ID generator ────────────────────────────────────────────────────────────

  let _idCounter = 0;
  function generateId() {
    return 'fp-' + Date.now().toString(36) + '-' + (++_idCounter).toString(36);
  }

  // ── Instance management ────────────────────────────────────────────────────

  function addInstance(instance) {
    _instances.set(instance.id, instance);
    _stack.push(instance.id);

    // Register group
    if (instance.options.group) {
      const existingId = _groups.get(instance.options.group);
      if (existingId && existingId !== instance.id) {
        const existing = _instances.get(existingId);
        if (existing && existing.state === 'open') {
          // Close the existing popup in this group
          // The engine handles the actual close logic
          _emit('group:replace', { oldId: existingId, newId: instance.id, group: instance.options.group });
        }
      }
      _groups.set(instance.options.group, instance.id);
    }
  }

  function removeInstance(id) {
    const instance = _instances.get(id);
    if (instance && instance.options.group) {
      const groupId = instance.options.group;
      if (_groups.get(groupId) === id) {
        _groups.delete(groupId);
      }
    }
    _instances.delete(id);
    const idx = _stack.indexOf(id);
    if (idx !== -1) _stack.splice(idx, 1);
  }

  function getInstance(id) {
    return _instances.get(id) || null;
  }

  function getTopInstance() {
    if (_stack.length === 0) return null;
    return _instances.get(_stack[_stack.length - 1]) || null;
  }

  function getInstancesByGroup(group) {
    const groupId = _groups.get(group);
    return groupId ? (_instances.get(groupId) || null) : null;
  }

  function getAllInstances() {
    return Array.from(_instances.values());
  }

  function getActiveCount() {
    return _instances.size;
  }

  // ── Stacking ────────────────────────────────────────────────────────────────

  function getStackHeight() {
    return _stack.length;
  }

  function getStackTopZIndex() {
    if (_stack.length === 0) return CONFIG.Z_INDEX.BASE_OFFSET;
    const top = _instances.get(_stack[_stack.length - 1]);
    return top ? top.zIndex : CONFIG.Z_INDEX.BASE_OFFSET;
  }

  // ── Scroll lock ────────────────────────────────────────────────────────────

  /**
   * Increment scroll lock. Uses the same body-fixed technique as
   * SearchOverlay to prevent layout shift (no scrollbar jump).
   */
  function lockScroll() {
    _scrollLockCount++;
    if (_scrollLockCount === 1) {
      _savedScrollY = window.scrollY || window.pageYOffset || 0;
      if (_savedScrollY > 0) {
        window.scrollTo({ top: 0, behavior: 'instant' });
      }
      document.body.style.position = 'fixed';
      document.body.style.top = '-' + _savedScrollY + 'px';
      document.body.style.width = '100%';
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.documentElement.style.overflow = 'hidden';
    }
  }

  /**
   * Decrement scroll lock. Only unlocks when counter reaches 0.
   */
  function unlockScroll() {
    if (_scrollLockCount <= 0) return;
    _scrollLockCount--;
    if (_scrollLockCount === 0) {
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.documentElement.style.overflow = '';
      if (_savedScrollY > 0) {
        window.scrollTo({ top: _savedScrollY, behavior: 'instant' });
        _savedScrollY = 0;
      }
    }
  }

  function getScrollLockCount() {
    return _scrollLockCount;
  }

  // ── Queue ───────────────────────────────────────────────────────────────────

  function enqueue(request) {
    _queue.push(request);
  }

  function dequeue() {
    return _queue.shift() || null;
  }

  function peekQueue() {
    return _queue.length > 0 ? _queue[0] : null;
  }

  function getQueueLength() {
    return _queue.length;
  }

  function clearQueue() {
    const pending = _queue.splice(0);
    for (const req of pending) {
      try { req.reject(new Error('[PopupSystem] Queue cleared')); } catch (_) {}
    }
  }

  // ── System events ──────────────────────────────────────────────────────────

  function on(event, fn) {
    if (!_systemListeners.has(event)) _systemListeners.set(event, new Set());
    _systemListeners.get(event).add(fn);
    return () => off(event, fn);
  }

  function off(event, fn) {
    const set = _systemListeners.get(event);
    if (set) set.delete(fn);
  }

  function _emit(event, detail) {
    const set = _systemListeners.get(event);
    if (set) {
      for (const fn of set) {
        try { fn(detail); } catch (e) { console.error('[PopupSystem/State] event error:', e); }
      }
    }
    // Also dispatch on window for external listeners
    try {
      window.dispatchEvent(new CustomEvent('fp:' + event, { detail }));
    } catch (_) {}
  }

  // ── Destroy ─────────────────────────────────────────────────────────────────

  function destroyAll() {
    _destroyed = true;
    _queue.splice(0);
    for (const [, inst] of _instances) {
      try { _emit('destroy', { id: inst.id }); } catch (_) {}
    }
    _instances.clear();
    _stack.length = 0;
    _groups.clear();
    _systemListeners.clear();
    // Force unlock scroll
    if (_scrollLockCount > 0) {
      _scrollLockCount = 1;
      unlockScroll();
    }
  }

  function isDestroyed() {
    return _destroyed;
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  M.State = Object.freeze({
    generateId, addInstance, removeInstance, getInstance, getTopInstance,
    getInstancesByGroup, getAllInstances, getActiveCount,
    getStackHeight, getStackTopZIndex,
    lockScroll, unlockScroll, getScrollLockCount,
    enqueue, dequeue, peekQueue, getQueueLength, clearQueue,
    on, off, _emit,
    destroyAll, isDestroyed,
  });

})(window.PopupModules = window.PopupModules || {});