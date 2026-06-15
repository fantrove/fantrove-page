/**
 * lang-core.js — v1.0.0
 * Central Language API for Fantrove
 *
 * โหลดก่อนทุกอย่าง (script แรกใน <head> ก่อน language.js)
 * อ่านภาษาทันทีจาก:
 *   1. data-fv-built (production static mode — เร็วสุด)
 *   2. URL path prefix (/en/..., /th/...)
 *   3. localStorage (user choice)
 *   4. Browser language detection
 *
 * Public API — window.FvLang:
 *   .lang              — ภาษาปัจจุบัน ('en' | 'th')
 *   .supportedLangs    — ['en', 'th']
 *   .isReady           — true เมื่อตั้งค่าเรียบร้อยแล้ว
 *   .isStaticMode      — true ถ้าเป็น production built page
 *   .onChange(fn)      — subscribe ถ้าภาษาเปลี่ยน (return unsubscribe fn)
 *   .forceRefresh()    — dispatch fv:langchange ให้ทุกระบบ refresh ทั้งหน้า
 *   .setLang(lang)     — ตั้งภาษาใหม่ + dispatch event (ใช้โดย language.js)
 *
 * Events:
 *   'fv:langchange'  — CustomEvent บน window, detail: { lang, previousLang }
 *     ทุกระบบ JS ควรฟัง event นี้แทนอ่าน localStorage เอง
 *
 * ใน production (static mode):
 *   - อ่านภาษาจาก data-fv-built + URL prefix ทันที
 *   - ไม่ต้องรอ language.js โหลดเสร็จ
 *   - language.js ยังทำงานได้ (UI dropdown) แต่เมื่อ user เลือกภาษา
 *     จะเรียก FvLang.setLang() ก่อน redirect
 *
 * Architecture:
 *   lang-core.js (สร้าง FvLang ทันที)
 *     → language.js (รอ FvLang.isReady หรือใช้ FvLang.lang)
 *     → ทุก script อื่น (ใช้ FvLang.lang แทน localStorage)
 */

(function() {
  'use strict';
  
  // Guard: ไม่ init ซ้ำ
  if (window.FvLang && window.FvLang._v) return;
  
  var SUPPORTED = ['en', 'th'];
  var DEFAULT_LANG = 'en';
  var LS_KEY = 'selectedLang';
  
  // ── Detect language — synchronous, deterministic ──────────────────────
  
  /**
   * อ่านภาษาจาก data-fv-built attribute (production only)
   * @returns {string|null}
   */
  function getBuiltLang() {
    try {
      var built = document.documentElement.getAttribute('data-fv-built');
      if (built && SUPPORTED.indexOf(built) >= 0) return built;
    } catch (e) {}
    return null;
  }
  
  /**
   * ตรวจสอบ URL มี prefix ภาษาหรือไม่
   * @returns {string|null}
   */
  function getUrlLang() {
    try {
      var m = location.pathname.match(/^\/(en|th)(\/|$)/);
      return m ? m[1] : null;
    } catch (e) {}
    return null;
  }
  
  /**
   * อ่านจาก localStorage
   * @returns {string|null}
   */
  function getStoredLang() {
    try {
      var l = localStorage.getItem(LS_KEY);
      return (l && SUPPORTED.indexOf(l) >= 0) ? l : null;
    } catch (e) {}
    return null;
  }
  
  /**
   * Detect จาก browser
   * @returns {string}
   */
  function getBrowserLang() {
    try {
      var langs = navigator.languages || [navigator.language || navigator.userLanguage];
      for (var i = 0; i < langs.length; i++) {
        var code = (langs[i] || '').split('-')[0];
        if (SUPPORTED.indexOf(code) >= 0) return code;
      }
    } catch (e) {}
    return DEFAULT_LANG;
  }
  
  /**
   * ตรวจสอบว่าเป็น localhost หรือไม่ (dev mode)
   * @returns {boolean}
   */
  function isLocalDev() {
    try {
      var host = location.hostname || '';
      return host === 'localhost' || host === '127.0.0.1' ||
        host === '0.0.0.0' || host.endsWith('.local');
    } catch (e) {}
    return false;
  }
  
  // ── Resolve language immediately ───────────────────────────────────────
  
  var builtLang = getBuiltLang();
  var isStatic = !!builtLang;
  
  var resolvedLang;
  if (isStatic) {
    // Production static mode: ยึด built language เป็นหลัก
    // URL prefix อาจต่าง (เช่น user พิมพ์ URL เอง) แต่ built page content
    // ถูก bake เป็น builtLang แล้ว → ใช้ builtLang
    resolvedLang = builtLang;
  } else if (!isLocalDev()) {
    // Production ที่ยังไม่ build (หรือ dev ที่ไม่ใช่ localhost)
    // Priority: URL > localStorage > browser
    resolvedLang = getUrlLang() || getStoredLang() || getBrowserLang();
  } else {
    // Dev mode (localhost): localStorage > browser
    resolvedLang = getStoredLang() || getBrowserLang();
  }
  
  // Ensure valid
  if (SUPPORTED.indexOf(resolvedLang) < 0) resolvedLang = DEFAULT_LANG;
  
  // Sync to localStorage (เพื่อความสอดคล้อง)
  if (!isLocalDev()) {
    try { localStorage.setItem(LS_KEY, resolvedLang); } catch (e) {}
  }
  
  // ── Subscriber system ──────────────────────────────────────────────────
  
  /** @type {Array<Function>} */
  var _subscribers = [];
  
  // ── FvLang API ─────────────────────────────────────────────────────────
  
  var FvLang = {
    _v: '1.0.0',
    
    /** ภาษาปัจจุบัน */
    lang: resolvedLang,
    
    /** ภาษาที่รองรับ */
    supportedLangs: SUPPORTED,
    
    /** เรียบร้อยแล้ว — เสมอ true เพราะ resolve แบบ sync */
    isReady: true,
    
    /** Production built page หรือไม่ */
    isStaticMode: isStatic,
    
    /**
     * Subscribe เมื่อภาษาเปลี่ยน
     * @param {Function} fn — callback(lang, previousLang)
     * @returns {Function} unsubscribe function
     */
    onChange: function(fn) {
      if (typeof fn !== 'function') return function() {};
      _subscribers.push(fn);
      return function() {
        var idx = _subscribers.indexOf(fn);
        if (idx >= 0) _subscribers.splice(idx, 1);
      };
    },
    
    /**
     * ตั้งภาษาใหม่ + dispatch event ให้ทักทายระบบทั้งหน้า refresh
     * เรียกจาก language.js เมื่อ user เลือกภาษาใหม่
     *
     * @param {string} newLang
     * @param {Object} [opts]
     * @param {boolean} [opts.silent] — ไม่ dispatch event (สำหรับ init sync)
     */
    setLang: function(newLang, opts) {
      if (!newLang || SUPPORTED.indexOf(newLang) < 0) return;
      if (newLang === this.lang) return;
      
      var previous = this.lang;
      this.lang = newLang;
      
      // Sync localStorage
      try { localStorage.setItem(LS_KEY, newLang); } catch (e) {}
      
      // Update <html lang>
      try { document.documentElement.setAttribute('lang', newLang); } catch (e) {}
      
      if (opts && opts.silent) return;
      
      // Call subscribers
      for (var i = 0; i < _subscribers.length; i++) {
        try { _subscribers[i](newLang, previous); } catch (e) {}
      }
      
      // Dispatch global event
      try {
        window.dispatchEvent(new CustomEvent('fv:langchange', {
          detail: { lang: newLang, previousLang: previous },
          bubbles: false,
          cancelable: false
        }));
      } catch (e) {}
    },
    
    /**
     * Force refresh ทุกระบบในหน้าให้ render ใหม่ตามภาษาปัจจุบัน
     * ใช้เมื่อต้องการบังคับให้ทุกอย่าง refresh โดยไม่เปลี่ยนภาษา
     * (เช่น หลัง dynamic content โหลดเสร็จ)
     */
    forceRefresh: function() {
      var currentLang = this.lang;
      // Call subscribers with same lang (they should re-render)
      for (var i = 0; i < _subscribers.length; i++) {
        try { _subscribers[i](currentLang, currentLang); } catch (e) {}
      }
      // Dispatch event with previousLang === lang (signal: refresh, not change)
      try {
        window.dispatchEvent(new CustomEvent('fv:langchange', {
          detail: { lang: currentLang, previousLang: currentLang },
          bubbles: false,
          cancelable: false
        }));
      } catch (e) {}
    }
  };
  
  // ── Expose ─────────────────────────────────────────────────────────────
  
  window.FvLang = FvLang;
  
  // Also set on languageReady promise for backward compat
  // (scripts ที่ยังใช้ await window.languageReady อยู่)
  if (!window.languageReady) {
    window.languageReady = Promise.resolve({ lang: FvLang.lang, translations: null });
  }
  if (!window.onLanguageReady) {
    window.onLanguageReady = function(fn) {
      if (typeof fn === 'function') {
        try { fn({ lang: FvLang.lang, translations: null }); } catch (e) {}
      }
    };
  }
  
})();