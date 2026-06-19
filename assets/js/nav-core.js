// @ts-check
/**
 * @file nav-core.js
 * Entry point for NavCore — Navigation & Content Management System
 * (fixed: getModuleBase() now handles ?v=BUILD_ID query strings)
 */
(function() {
  'use strict';
  
  if (window._navCore?._initialized) return;
  
  const PHASES = [
    ['types.js', 'config.js', 'state.js'],
    ['utils.js', 'data.js'],
    ['loading.js', 'content.js', 'performance.js', 'feed.js'], // feed.js ต้องอยู่หลัง data.js (Phase 2)
    ['buttons.js', 'router.js', 'copy.js'],
    ['init.js'],
  ];
  
  function getModuleBase() {
    // Return only the directory path (with trailing slash). The query string
    // for cache-busting is added separately in loadScript() so that we don't
    // accidentally produce URLs like `/nav-core-modules/?v=1.0.0types.js`.
    try {
      if (document.currentScript && document.currentScript.src) {
        var cs = document.currentScript.src.split('#')[0].split('?')[0];
        return cs.replace(/\/[^/]*$/, '/nav-core-modules/');
      }
      var scripts = document.getElementsByTagName('script');
      for (var i = 0; i < scripts.length; i++) {
        var s = scripts[i];
        if (!s.src) continue;
        try {
          if (/\/nav-core(?:\.min)?\.js(\?|$)/.test(s.src)) {
            var sp = s.src.split('#')[0].split('?')[0];
            return sp.replace(/\/[^/]*$/, '/nav-core-modules/');
          }
        } catch (_) {}
      }
    } catch (_) {}
    return '/assets/js/nav-core-modules/';
  }

  // Extract the version query from the nav-core.js <script> tag so that
  // bumping the version (e.g. ?v=1.0.0-20250619) in HTML also busts the
  // cache for every sub-module loaded from nav-core-modules/.
  // Without this, browsers cache loading.js / router.js / etc. independently
  // and code changes to those files never reach users until they hard-refresh.
  function getModuleQuery() {
    try {
      if (document.currentScript && document.currentScript.src) {
        var src = document.currentScript.src;
        if (src.indexOf('?') !== -1) return '?' + src.split('?')[1].split('#')[0];
      }
      var scripts = document.getElementsByTagName('script');
      for (var i = 0; i < scripts.length; i++) {
        var s = scripts[i];
        if (!s.src) continue;
        try {
          if (/\/nav-core(?:\.min)?\.js(\?|$)/.test(s.src)) {
            if (s.src.indexOf('?') !== -1) {
              return '?' + s.src.split('?')[1].split('#')[0];
            }
            break;
          }
        } catch (_) {}
      }
    } catch (_) {}
    return '';
  }

  var _moduleQuery = getModuleQuery();
  
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      // Append module query string for cache-busting (e.g. ?v=1.0.0-20250619)
      s.src = url + _moduleQuery;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('[NavCore] Failed to load: ' + s.src));
      document.head.appendChild(s);
    });
  }
  
  function loadPhase(names, base) {
    return Promise.all(names.map(n => loadScript(base + n))).then(() => {});
  }
  
  function loadPhases(phases, base) {
    return phases.reduce(
      (chain, phase) => chain.then(() => loadPhase(phase, base)),
      Promise.resolve()
    );
  }
  
  const base = getModuleBase();
  
  loadPhases(PHASES, base)
    .then(() => _boot())
    .catch(err => {
      console.error('[NavCore] Module loading failed:', err);
      _diagnose(base, PHASES.flat()).catch(() => {});
      try {
        if (typeof window.__removeInstantLoadingOverlay === 'function' &&
          window.__instantLoadingOverlayShown) {
          window.__removeInstantLoadingOverlay();
          window.__instantLoadingOverlayShown = false;
        }
      } catch (_) {}
    });
  
  function _boot() {
    const M = window.NavCoreModules;
    if (!M) {
      console.error('[NavCore] NavCoreModules namespace missing after load');
      return;
    }
    if (!M.InitService || typeof M.InitService.start !== 'function') {
      console.error('[NavCore] InitService.start not found');
      return;
    }
    M.InitService.start();
    window._navCore = { _initialized: true };
    if (typeof module !== 'undefined' && module.exports)
      module.exports = M;
  }
  
  async function _diagnose(base, names) {
    try {
      const results = await Promise.all(names.map(async n => {
        const url = base + n + _moduleQuery;
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
