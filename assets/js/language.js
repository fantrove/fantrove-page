// @ts-check
/**
 * @file language.js
 * Entry point สำหรับระบบภาษา
 *
 * HTML ต้องการแค่ tag เดียว:
 *   <script src="/assets/js/language.js"></script>
 *
 * ไฟล์นี้:
 *  1. หา base path จาก script src
 *  2. โหลด lang-modules/* ตามลำดับ dependency (sequential, blocking)
 *  3. หลังโหลดครบ → _boot() เพื่อ init ระบบ
 *
 * Module load order (dependency chain):
 *   types.js        — typedefs, ไม่มี runtime deps
 *   config.js       — constants, ไม่มี deps
 *   state.js        — shared state, ไม่มี deps
 *   db.js           — IndexedDB utils, ไม่มี deps
 *   worker-pool.js  — WorkerPool class, ไม่มี deps
 *   detector.js     — lang detection, ต้องการ config
 *   loader.js       — data loading, ต้องการ config + state
 *   url.js          — URL management, ต้องการ config + state + detector
 *   translator.js   — translation engine, ต้องการ config + state + worker-pool
 *   ui.js           — dropdown UI, ต้องการ config + state
 *   navigation.js   — event handlers, ต้องการเกือบทุก module
 *   manager.js      — orchestrator, ต้องการทุก module
 *
 * Public API:
 *   window.languageManager.selectLanguage(lang)
 *   window.languageManager.updatePageLanguage(lang, updateURL)
 *   window.languageManager.destroy()
 *
 * @module language
 */
(function() {
  'use strict';
  
  // Guard: ไม่ init ซ้ำ
  if (window.__langUI?._initialized) return;
  
  // ── Module list in load order ─────────────────────────────────────────────
  const MODULES = [
    'types.js',
    'config.js',
    'state.js',
    'db.js',
    'worker-pool.js',
    'detector.js',
    'loader.js',
    'url.js',
    'translator.js',
    'ui.js',
    'navigation.js',
    'manager.js',
  ];
  
  // ── Resolve base path ─────────────────────────────────────────────────────
  /**
   * หา directory ที่มี language.js อยู่
   * รองรับ subpath deployment
   * @returns {string}  เช่น '/assets/js'
   */
  function getBasePath() {
    try {
      const scripts = document.querySelectorAll('script[src]');
      for (const s of scripts) {
        const src = s.getAttribute('src') || '';
        if (src.includes('language.js')) {
          return src.replace(/\/language\.js(\?.*)?$/, '');
        }
      }
    } catch (e) {}
    return '/assets/js';
  }
  
  // ── Sequential script loader ──────────────────────────────────────────────
  /**
   * โหลด scripts ทีละตัวตามลำดับ (sequential = ตาม dependency chain)
   * @param {string[]} urls
   * @returns {Promise<void>}
   */
  function loadSequential(urls) {
    return urls.reduce(
      (chain, url) => chain.then(() => loadScript(url)),
      Promise.resolve()
    );
  }
  
  /**
   * inject <script> tag และ resolve เมื่อโหลดเสร็จ
   * @param {string} url
   * @returns {Promise<void>}
   */
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = false; // รักษา execution order ภายใน sequence
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('[LangUI] Failed to load module: ' + url));
      document.head.appendChild(s);
    });
  }
  
  // ── Boot sequence ─────────────────────────────────────────────────────────
  const base = getBasePath();
  const urls = MODULES.map(name => `${base}/lang-modules/${name}`);
  
  loadSequential(urls)
    .then(() => _boot())
    .catch(err => console.error('[LangUI] Module loading failed:', err));
  
  // ── Main boot (runs after all modules loaded) ─────────────────────────────
  function _boot() {
    const M = window.LangModules;
    if (!M) {
      console.error('[LangUI] LangModules namespace missing after load');
      return;
    }
    
    const { State, TranslatorService, NavigationService, LoaderService, LanguageManager } = M;
    
    // 1. สร้าง WorkerPool (ต้องก่อนแปลใดๆ)
    TranslatorService.initPool();
    
    // 2. สร้าง BroadcastChannel (สำหรับ cross-tab sync)
    NavigationService.initBroadcastChannel();
    
    // 3. เริ่ม prefetch config ทันที (ก่อน DOM ready)
    //    เก็บไว้ใน State._prefetchPromise
    //    LoaderService.loadLanguagesConfig() จะ await promise นี้
    State._prefetchPromise = LoaderService.prefetchEnterprise();
    
    // 4. Initialize เมื่อ DOM พร้อม
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => LanguageManager.initialize());
    } else {
      LanguageManager.initialize();
    }
    
    // ── Export public API ──────────────────────────────────────────────────
    // window.languageManager รักษา backward compatibility
    // external code ยังเรียก window.languageManager.selectLanguage() ได้เหมือนเดิม
    window.languageManager = LanguageManager;
    
    // Node.js compatibility (ถ้าใช้ใน test environment)
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = LanguageManager;
    }
    
    window.__langUI = { _initialized: true };
  }
  
})();