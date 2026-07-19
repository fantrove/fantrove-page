// @ts-check
/**
 * @file nav-core.js
 * Entry point for NavCore — Navigation & Content Management System
 * (fixed: getModuleBase() now handles ?v=BUILD_ID query strings)
 *
 * Cache-busting v1.0:
 *   FV_BUILD_ID ถูกแทนที่ด้วย build ID จริงโดย scripts/update-version.js
 *   ทุก module ที่ nav-core.js โหลดแบบ dynamic จะได้ ?v=<buildId> ต่อท้าย URL
 *   → browser ไม่ใช้ cache เดิมเมื่อ module ถูกอัพเดท
 *   ใน dev mode (ไม่ผ่าน build) FV_BUILD_ID = '' → _v() คืน '' → ไม่มี ?v=
 */
(function() {
  'use strict';
  
  if (window._navCore?._initialized) return;
  
  // ── Build ID (replaced at build time by scripts/update-version.js) ──────────
  // WHY: dynamic-loaded modules (nav-core-modules/*.js) ไม่ได้อยู่ใน HTML
  //   จึงไม่ถูก regex ?v= ของ update-version.js จับได้
  //   ตัวแปรนี้ถูก inject buildId จริงตอน build → ใช้ต่อ ?v= ท้าย URL ของ modules
  //   dev mode: ค่า '' (ว่าง) → _v() คืน '' → URL ไม่มี ?v= → browser cache ปกติ
  var FV_BUILD_ID = '';
  
  /** คืน query string '?v=<buildId>' สำหรับ cache-busting ถ้าไม่มี buildId คืน '' */
  function _v() { return FV_BUILD_ID ? '?v=' + FV_BUILD_ID : ''; }
  
  const PHASES = [
    ['types.js', 'config.js', 'state.js'],
    ['utils.js', 'data.js', 'route-cache.js'], // route-cache.js ไม่มี dependency อื่น
    ['loading.js', 'feed.js', 'paginator.js', 'content.js', 'performance.js'],
    // feed.js ต้องอยู่หลัง data.js (Phase 2)
    // paginator.js ต้องอยู่หลัง data.js (Phase 2) — ใช้ DataService.getTypeCategories
    // content.js ต้องอยู่หลัง feed.js + paginator.js + route-cache.js (Phase 2) — ใช้ทั้ง 3
    ['buttons.js', 'router.js', 'copy.js'],
    ['init.js'],
  ];
  
  function getModuleBase() {
    try {
      if (document.currentScript && document.currentScript.src) {
        const clean = document.currentScript.src.split('?')[0].split('#')[0];
        return clean.replace(/\/[^/]*$/, '/nav-core-modules/');
      }
      const scripts = document.getElementsByTagName('script');
      for (let i = 0; i < scripts.length; i++) {
        const src = scripts[i].src;
        if (!src) continue;
        try {
          if (/\/nav-core(?:\.min)?\.js/.test(src)) {
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
      // WHY _v(): ต่อ ?v=<buildId> เพื่อ cache-bust module ที่ไม่ได้อยู่ใน HTML
      s.src = url + _v();
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('[NavCore] Failed to load: ' + url + _v()));
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