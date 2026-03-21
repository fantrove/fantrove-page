// @ts-check
/**
 * @file language.js
 * Entry point สำหรับระบบภาษา — v4.0
 *
 * การปรับปรุงหลัก:
 *  - Phase-based parallel loading แทน sequential ล้วน
 *    ลด time-to-boot ได้ ~50% บน slow connections
 *
 * Module dependency graph + load phases:
 *
 *   Phase 1 (parallel, no deps):
 *     types  config  state  worker-pool
 *
 *   Phase 2 (parallel, need Phase 1):
 *     db  detector  loader  markers  translator  ui
 *
 *   Phase 3 (parallel, need Phase 2):
 *     url  navigation  manager
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
  
  // ── Load phases ───────────────────────────────────────────────────────────
  /**
   * modules ถูกจัดกลุ่มตาม dependency level
   * ภายใน phase เดียวกันโหลดแบบ parallel (Promise.all)
   * ระหว่าง phase โหลดแบบ sequential (chain)
   *
   * @type {string[][]}
   */
  const PHASES = [
    // Phase 1: ไม่มี dependency ต่อกัน
    ['types.js', 'config.js', 'state.js', 'worker-pool.js'],
    
    // Phase 2: ต้องการ config + state (+ worker-pool สำหรับ translator)
    ['db.js', 'detector.js', 'loader.js', 'markers.js', 'translator.js', 'ui.js'],
    
    // Phase 3: ต้องการทุกอย่างจาก Phase 2
    ['url.js', 'navigation.js', 'manager.js'],
  ];
  
  // ── Resolve base path ─────────────────────────────────────────────────────
  /**
   * หา directory ที่มี language.js อยู่ (รองรับ subpath deployment)
   * @returns {string}  เช่น '/assets/js'
   */
  function getBasePath() {
    try {
      for (const s of document.querySelectorAll('script[src]')) {
        const src = s.getAttribute('src') || '';
        if (src.includes('language.js'))
          return src.replace(/\/language\.js(\?.*)?$/, '');
      }
    } catch (e) {}
    return '/assets/js';
  }
  
  // ── Script loaders ────────────────────────────────────────────────────────
  /**
   * inject <script> tag แล้ว resolve เมื่อโหลดเสร็จ
   * @param {string} url
   * @returns {Promise<void>}
   */
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = false; // รักษา execution order ใน parallel batch
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('[LangUI] Failed to load: ' + url));
      document.head.appendChild(s);
    });
  }
  
  /**
   * โหลด scripts ใน phase เดียวกันพร้อมกัน
   * @param {string[]} names
   * @param {string}   base
   * @returns {Promise<void>}
   */
  function loadPhase(names, base) {
    return Promise.all(
      names.map(n => loadScript(`${base}/lang-modules/${n}`))
    ).then(() => {}); // flatten to void
  }
  
  /**
   * โหลดแต่ละ phase ตามลำดับ — phase N+1 เริ่มหลัง phase N เสร็จ
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
  
  // ── Boot sequence ─────────────────────────────────────────────────────────
  const base = getBasePath();
  
  loadPhases(PHASES, base)
    .then(() => _boot())
    .catch(err => console.error('[LangUI] Module loading failed:', err));
  
  /**
   * รันหลัง modules ทุกตัวโหลดเสร็จ
   */
  function _boot() {
    const M = window.LangModules;
    if (!M) {
      console.error('[LangUI] LangModules namespace missing after load');
      return;
    }
    
    const { State, TranslatorService, NavigationService, LoaderService, LanguageManager } = M;
    
    // 1. init WorkerPool (lazy — workers จะสร้างตอนใช้งานจริงครั้งแรก)
    TranslatorService.initPool();
    
    // 2. BroadcastChannel สำหรับ cross-tab sync
    NavigationService.initBroadcastChannel();
    
    // 3. เริ่ม prefetch config ทันที (ก่อน DOM ready)
    State._prefetchPromise = LoaderService.prefetchEnterprise();
    
    // 4. Initialize เมื่อ DOM พร้อม
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => LanguageManager.initialize());
    } else {
      LanguageManager.initialize();
    }
    
    // ── Public API ─────────────────────────────────────────────────────────
    window.languageManager = LanguageManager;
    window.__langUI = { _initialized: true };
    
    // Node.js test environment compatibility
    if (typeof module !== 'undefined' && module.exports)
      module.exports = LanguageManager;
  }
  
})();