// Path:    assets/js/popup-modules/queue.js
// Purpose: Popup queue manager — ensures MAX_CONCURRENT limit is respected.
//          When the limit is reached, new popups wait in a FIFO queue.
//          When a popup closes, the next queued popup is automatically opened.
// Used by: engine.js

(function(M) {
  'use strict';
  
  const { CONFIG, State } = M;
  
  /**
   * Check if a new popup can be opened immediately.
   * @returns {boolean}
   */
  function canOpenNow() {
    if (!CONFIG.QUEUE.QUEUE_ENABLED) return true;
    return State.getActiveCount() < CONFIG.QUEUE.MAX_CONCURRENT;
  }
  
  /**
   * Attempt to open immediately or enqueue.
   *
   * @param {PopupOptions} options
   * @param {Function} openFn  - The actual function that creates and opens a popup
   * @returns {Promise<PopupHandle>}
   */
  function enqueueOrOpen(options, openFn) {
    if (canOpenNow()) {
      return openFn(options);
    }
    
    // Enqueue
    return new Promise(function(resolve, reject) {
      State.enqueue({ resolve: resolve, reject: reject, options: options });
      State._emit('queued', {
        id: null,
        position: State.getQueueLength(),
        options: options,
      });
    });
  }
  
  /**
   * Process the next item in the queue (called after a popup closes).
   * @param {Function} openFn
   */
  function processNext(openFn) {
    if (!canOpenNow()) return;
    
    const next = State.dequeue();
    if (!next) return;
    
    next.openFn = openFn;
    
    // Use microtask to avoid re-entrancy
    Promise.resolve().then(function() {
      try {
        openFn(next.options).then(next.resolve).catch(next.reject);
      } catch (e) {
        next.reject(e);
      }
    });
  }
  
  /**
   * Get queue status for debugging.
   * @returns {{ active: number, queued: number, max: number }}
   */
  function status() {
    return {
      active: State.getActiveCount(),
      queued: State.getQueueLength(),
      max: CONFIG.QUEUE.MAX_CONCURRENT,
    };
  }
  
  M.QueueManager = Object.freeze({ canOpenNow, enqueueOrOpen, processNext, status });
  
})(window.PopupModules = window.PopupModules || {});