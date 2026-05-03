// Path:    assets/js/ure/ure-modules/observer.js
// Purpose: Factory functions for IntersectionObserver, ResizeObserver, and
//          MutationObserver. Centralises creation, error handling, and cleanup
//          so individual modules never manage observer lifecycle manually.
// Used by: virtual-list.js, lazy-assets.js, engine.js

(function(M) {
  'use strict';
  
  const { CONFIG } = M;
  
  // ── IntersectionObserver factory ──────────────────────────────────────────
  
  /**
   * Create an IntersectionObserver with built-in error handling.
   *
   * @param {IntersectionObserverCallback} callback
   * @param {IntersectionObserverInit}     [opts]
   * @returns {IntersectionObserver|null}   null if API unavailable
   */
  function createIO(callback, opts = {}) {
    if (!('IntersectionObserver' in window)) return null;
    try {
      return new IntersectionObserver((entries, observer) => {
        try { callback(entries, observer); }
        catch (e) { console.error('[URE/Observer] IO callback failed:', e); }
      }, opts);
    } catch (e) {
      console.error('[URE/Observer] IntersectionObserver creation failed:', e);
      return null;
    }
  }
  
  /**
   * Create an IO tuned for lazy-load triggering (large root margin).
   * @param {IntersectionObserverCallback} callback
   * @param {string} [rootMargin] - defaults to CONFIG sentinel margin
   * @returns {IntersectionObserver|null}
   */
  function createSentinelIO(callback, rootMargin = CONFIG.RENDER.SENTINEL_MARGIN) {
    return createIO(callback, { rootMargin, threshold: CONFIG.RENDER.IO_THRESHOLD });
  }
  
  /**
   * Create an IO that watches item visibility inside a specific scroll root.
   * @param {Element|null}                 root
   * @param {IntersectionObserverCallback} callback
   * @param {number}                       bufferPx
   * @returns {IntersectionObserver|null}
   */
  function createViewportIO(root, callback, bufferPx) {
    const margin = `${bufferPx}px`;
    return createIO(callback, {
      root: root || null,
      rootMargin: `${margin} 0px`,
      threshold: 0,
    });
  }
  
  // ── ResizeObserver factory ────────────────────────────────────────────────
  
  /**
   * Create a ResizeObserver with error-safe callback.
   * @param {ResizeObserverCallback} callback
   * @returns {ResizeObserver|null}
   */
  function createRO(callback) {
    if (!('ResizeObserver' in window)) return null;
    try {
      return new ResizeObserver((entries) => {
        try { callback(entries); }
        catch (e) { console.error('[URE/Observer] RO callback failed:', e); }
      });
    } catch (e) {
      console.error('[URE/Observer] ResizeObserver creation failed:', e);
      return null;
    }
  }
  
  // ── MutationObserver factory ──────────────────────────────────────────────
  
  /**
   * Create a MutationObserver watching childList + subtree for external DOM
   * changes. Used to detect when third-party scripts mutate the container.
   * @param {MutationCallback} callback
   * @returns {MutationObserver}
   */
  function createMO(callback) {
    return new MutationObserver((mutations) => {
      try { callback(mutations); }
      catch (e) { console.error('[URE/Observer] MO callback failed:', e); }
    });
  }
  
  // ── Safe disconnect helper ────────────────────────────────────────────────
  
  /**
   * Disconnect an observer if it exists. Safe to call with null.
   * @param {IntersectionObserver|ResizeObserver|MutationObserver|null} obs
   */
  function disconnect(obs) {
    if (obs) try { obs.disconnect(); } catch (_) {}
  }
  
  // ── Export ────────────────────────────────────────────────────────────────
  
  M.ObserverFactory = Object.freeze({
    createIO,
    createSentinelIO,
    createViewportIO,
    createRO,
    createMO,
    disconnect,
  });
  
})(window.UREModules = window.UREModules || {});