// @ts-check
/**
 * @file nav-core.js
 * Entry point for NavCore — Navigation & Content Management System
 *
 * Module dependency graph + load phases:
 *
 *   Phase 1 (parallel, no deps):
 *     types  config  state
 *
 *   Phase 2 (parallel, need Phase 1):
 *     utils  data
 *
 *   Phase 3 (parallel, need Phase 2):
 *     loading  content  performance
 *
 *   Phase 4 (parallel, need Phase 3):
 *     buttons  router  copy
 *
 *   Phase 5 (sequential, needs all):
 *     init
 *
 * Public API (via window.NavCoreModules):
 *   NavCoreModules.RouterService.navigateTo(route, opts)
 *   NavCoreModules.LoadingService.show(opts)
 *   NavCoreModules.LoadingService.hide()
 *   NavCoreModules.DataService.loadApiDatabase()
 *
 * @module nav-core
 */
(function() {
  'use strict';
  
  // Guard: prevent double initialization
  if (window._navCore?._initialized) return;
  
  // ── Load phases ─────────────────────────────────────────────────────────────
  /** @type {string[][]} */
  const PHASES = [
    // Phase 1: foundation — no inter-module dependencies
    ['types.js', 'config.js', 'state.js'],
    
    // Phase 2: need CONFIG + STATE
    ['utils.js', 'data.js'],
    
    // Phase 3: need UTILS + DATA
    ['loading.js', 'content.js', 'performance.js'],
    
    // Phase 4: need LOADING + CONTENT + PERFORMANCE
    ['buttons.js', 'router.js', 'copy.js'],
    
    // Phase 5: orchestrator — needs everything above
    ['init.js'],
  ];
  
  // ── Resolve base path ────────────────────────────────────────────────────────
  /**
   * Resolve the nav-core-modules/ directory relative to this script.
   * Supports subpath deployments.
   * @returns {string}
   */
  function getModuleBase() {
    try {
      if (document.currentScript && document.currentScript.src) {
        return document.currentScript.src.replace(/\/[^\/?#]*$/, '/nav-core-modules/');
      }
      const scripts = document.getElementsByTagName('script');
      for (let i = 0; i < scripts.length; i++) {
        const src = scripts[i].src;
        if (!src) continue;
        try {
          if (/\/nav-core(?:\.min)?\.js(\?|#|$)/.test(src))
            return src.replace(/\/[^\/?#]*$/, '/nav-core-modules/');
        } catch (_) {}
      }
    } catch (_) {}
    return '/assets/js/nav-core-modules/';
  }
  
  // ── Script loader ─────────────────────────────────────────────────────────────
  /**
   * Inject a <script> tag and resolve when loaded.
   * @param {string} url
   * @returns {Promise<void>}
   */
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = false; // preserve execution order within parallel batches
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('[NavCore] Failed to load: ' + url));
      document.head.appendChild(s);
    });
  }
  
  /**
   * Load all scripts in a phase in parallel.
   * @param {string[]} names
   * @param {string}   base
   * @returns {Promise<void>}
   */
  function loadPhase(names, base) {
    return Promise.all(names.map(n => loadScript(base + n))).then(() => {});
  }
  
  /**
   * Load phases sequentially — phase N+1 starts only after phase N completes.
   * @param {string[][]} phases
   * @param {string}     base
   * @returns {Promise<void>}
   */
  function loadPhases(phases, base) {
    return phases.reduce(
      (chain, phase) => chain.then(() => loadPhase(phase, base)),
      Promise.resolve()
    );
  }
  
  // ── Boot ──────────────────────────────────────────────────────────────────────
  const base = getModuleBase();
  
  loadPhases(PHASES, base)
    .then(() => _boot())
    .catch(err => {
      console.error('[NavCore] Module loading failed:', err);
      // Run diagnostic fetch on failure
      _diagnose(base, PHASES.flat()).catch(() => {});
      // Ensure loading overlay is removed on failure
      try {
        if (typeof window.__removeInstantLoadingOverlay === 'function' &&
          window.__instantLoadingOverlayShown) {
          window.__removeInstantLoadingOverlay();
          window.__instantLoadingOverlayShown = false;
        }
      } catch (_) {}
    });
  
  /**
   * Called after all modules have loaded.
   */
  function _boot() {
    const M = window.NavCoreModules;
    if (!M) {
      console.error('[NavCore] NavCoreModules namespace missing after load');
      return;
    }
    
    if (!M.InitService || typeof M.InitService.start !== 'function') {
      console.error('[NavCore] InitService.start not found — init.js may have failed to load');
      return;
    }
    
    M.InitService.start();
    
    window._navCore = { _initialized: true };
    
    // Node.js / test environment compatibility
    if (typeof module !== 'undefined' && module.exports)
      module.exports = M;
  }
  
  /**
   * Diagnostic: fetch each module to reveal 404s or HTML error pages.
   * @param {string}   base
   * @param {string[]} names
   * @returns {Promise<void>}
   */
  async function _diagnose(base, names) {
    try {
      const results = await Promise.all(names.map(async n => {
        const url = base + n;
        try {
          const resp = await fetch(url, { cache: 'no-store' });
          const text = await resp.text().catch(() => '');
          return { url, status: resp.status, ok: resp.ok, snippet: text.slice(0, 200) };
        } catch (e) {
          return { url, error: String(e) };
        }
      }));
      console.error('[NavCore] Module diagnostics:', results);
    } catch (_) {}
  }
  
})();