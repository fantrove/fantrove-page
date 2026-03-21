// @ts-check
/**
 * @file state.js
 * Single shared mutable state.
 *
 * Rules:
 *  • State has no dependencies — other modules import from it, not vice versa.
 *  • Each field is owned by ONE service (noted in types.js).
 *  • แก้ค่าผ่าน service methods เท่านั้น ไม่แก้ตรงจากภายนอก
 *
 * @module state
 * @depends {types.js}
 */
(function(M) {
  'use strict';
  
  /** @type {LangState} */
  const State = {
    // ── Data ──────────────────────────────────────────────────────────────────
    languagesConfig: {}, // { en: { buttonText, label, enSource }, th: { ... } }
    languageCache: {}, // { 'th': { key: 'translated text', ... } }
    
    // ── Language state ────────────────────────────────────────────────────────
    selectedLang: '',
    lastSelectedLang: '',
    _userExplicitLang: null, // ภาษาที่ user กดเลือกเอง (override URL ในทุกกรณี)
    
    // ── Flags ─────────────────────────────────────────────────────────────────
    isUpdatingLanguage: false, // mutex ป้องกัน concurrent update
    isInitialized: false,
    
    // ── Worker & Channel ──────────────────────────────────────────────────────
    workerPool: null, // WorkerPool instance
    _bc: null, // BroadcastChannel instance
    _prefetchPromise: null, // Promise จาก LoaderService.prefetchEnterprise()
    maxWorker: (function() {
      // คำนวณตอน state init — ค่านี้ไม่เปลี่ยนตลอด lifetime
      const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ?
        navigator.hardwareConcurrency : 8;
      return Math.max(4, Math.floor(cores * 0.9));
    })(),
    
    // ── Observer ──────────────────────────────────────────────────────────────
    mutationObserver: null,
    mutationThrottleTimeout: null,
    
    // ── UI ────────────────────────────────────────────────────────────────────
    isLanguageDropdownOpen: false,
    scrollPosition: 0,
    languageButton: null, // cached #language-button ref
    languageOverlay: null, // overlay div ref
    languageDropdown: null, // dropdown div ref
    _dropdownWheelListener: null, // wheel handler ref สำหรับ removeEventListener
  };
  
  M.State = State;
  
})(window.LangModules = window.LangModules || {});