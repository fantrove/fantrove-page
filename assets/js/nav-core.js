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
    ['loading.js', 'content.js', 'performance.js'],
    ['buttons.js', 'router.js', 'copy.js'],
    ['init.js'],
  ];
  
  function getModuleBase() {
    try {
      if (document.currentScript && document.currentScript.src) {
        // ✅ ตัด ?query และ #hash ออกก่อน แล้วค่อย strip ชื่อไฟล์
        const clean = document.currentScript.src.split('?')[0].split('#')[0];
        return clean.replace(/\/[^/]*$/, '/nav-core-modules/');
      }
      const scripts = document.getElementsByTagName('script');
      for (let i = 0; i < scripts.length; i++) {
        const src = scripts[i].src;
        if (!src) continue;
        try {
          if (/\/nav-core(?:\.min)?\.js/.test(src)) {
            // ✅ ตัด query/hash ออกก่อนเสมอ
            const clean = src.split('?')[0].split('#')[0];
            return clean.replace(/\/[^/]*$/, '/nav-core-modules/');
          }
        } catch (_) {}
      }
    } catch (_) {}
    return '/assets/js/nav-core-modules/';
  }
  
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('[NavCore] Failed to load: ' + url));
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