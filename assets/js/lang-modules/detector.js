// @ts-check
/**
 * @file detector.js
 * DetectorService — ตรวจจับ environment, navigation type, และภาษา
 *
 * หน้าที่:
 *  isLocalDev()       — เป็น localhost หรือไม่
 *  _getNavType()      — navigate / back_forward / reload
 *  getLangFromURL()   — อ่านภาษาจาก /en/ หรือ /th/ prefix
 *  getLangFromStorage() — อ่านจาก localStorage
 *  detectBrowserLanguage() — อ่านจาก navigator.languages
 *  resolveCurrentLang()   — ตัดสินใจภาษาตาม priority + navType
 *
 * @module detector
 * @depends {config.js, state.js}
 */
(function (M) {
  'use strict';

  const DetectorService = {

    // ── Environment ───────────────────────────────────────────────────────────

    /**
     * ตรวจสอบว่าเป็น localhost/local dev หรือไม่
     * ถ้าใช่ → ปิดทุกอย่างที่เกี่ยวกับ URL prefix
     * @returns {boolean}
     */
    isLocalDev() {
      try {
        const host = location.hostname || '';
        return host === 'localhost' || host === '127.0.0.1' ||
               host === '0.0.0.0'   || host.endsWith('.local');
      } catch (e) {
        return false;
      }
    },

    // ── Navigation type ───────────────────────────────────────────────────────

    /**
     * อ่านประเภทของ navigation ที่พาเรามาถึงหน้านี้
     *
     * 'navigate'     → พิมพ์ URL เอง / คลิก link / เปิด bookmark
     * 'back_forward' → กด Back หรือ Forward
     * 'reload'       → กด Refresh
     * 'prerender'    → browser pre-render
     *
     * หมายเหตุ: ค่านี้ fixed ตอนโหลดหน้า ไม่เปลี่ยนตาม popstate
     * สำหรับ bfcache ให้ใช้ pageshow event.persisted แทน
     *
     * @returns {'navigate'|'back_forward'|'reload'|'prerender'}
     */
    _getNavType() {
      // Navigation Timing API Level 2 (primary)
      try {
        const entries = performance.getEntriesByType('navigation');
        if (entries && entries.length > 0 && entries[0].type) {
          return entries[0].type;
        }
      } catch (e) { /* ไม่รองรับ */ }

      // Navigation Timing Level 1 (deprecated fallback)
      try {
        if (performance && performance.navigation) {
          switch (performance.navigation.type) {
            case 0: return 'navigate';
            case 1: return 'reload';
            case 2: return 'back_forward';
            default: return 'navigate';
          }
        }
      } catch (e) { /* ไม่รองรับ */ }

      return 'navigate'; // safe default
    },

    // ── Language detection ────────────────────────────────────────────────────

    /**
     * อ่านภาษาจาก URL path (/en/... หรือ /th/...)
     * localhost → คืน null เสมอ (ไม่ใช้ URL prefix)
     * @returns {string|null}
     */
    getLangFromURL() {
      if (this.isLocalDev()) return null;
      try {
        const m = location.pathname.match(/^\/(en|th)(\/|$)/);
        return m ? m[1] : null;
      } catch (e) {
        return null;
      }
    },

    /**
     * อ่านภาษาจาก localStorage
     * @returns {string|null}
     */
    getLangFromStorage() {
      const { CONFIG } = M;
      try {
        const stored = localStorage.getItem(CONFIG.LS_KEY);
        return CONFIG.SUPPORTED_LANGS.includes(stored) ? stored : null;
      } catch (e) {
        return null;
      }
    },

    /**
     * Detect ภาษาจาก browser settings
     * @returns {string}
     */
    detectBrowserLanguage() {
      const { CONFIG } = M;
      try {
        const langs = navigator.languages || [navigator.language || navigator.userLanguage];
        for (const lang of langs) {
          const code = lang.split('-')[0];
          if (CONFIG.SUPPORTED_LANGS.includes(code)) return code;
        }
      } catch (e) {}
      return CONFIG.DEFAULT_LANG;
    },

    // ── Decision ──────────────────────────────────────────────────────────────

    /**
     * ตัดสินใจภาษาที่ควรใช้ตอนนี้ (v3.2 nav-type-aware)
     *
     * Priority สำหรับ initial load:
     *   localhost:              storage > browser  (ไม่มี URL)
     *   navigate / prerender:   URL > storage > browser
     *   back_forward / reload:  storage > URL > browser
     *     เหตุผล: user เพิ่งเปลี่ยนภาษาในหน้าอื่น
     *             URL เก่าในหน้านี้ไม่ควรบังคับเปลี่ยนกลับ
     *
     * @returns {LangDecision}
     */
    resolveCurrentLang() {
      const { CONFIG } = M;

      // localhost: ไม่ดู URL เลย
      if (this.isLocalDev()) {
        const s = this.getLangFromStorage();
        if (s) return { lang: s, source: 'storage' };
        return { lang: this.detectBrowserLanguage(), source: 'browser' };
      }

      const navType = this._getNavType();

      // back_forward / reload → storage ก่อน URL
      // (lang-proxy.js จะ redirect ให้แล้วในกรณีนี้ แต่ใส่ไว้เป็น safety net)
      if (navType === 'back_forward' || navType === 'reload') {
        const s = this.getLangFromStorage();
        if (s) return { lang: s, source: 'storage' };
        const u = this.getLangFromURL();
        if (u) return { lang: u, source: 'url' };
        return { lang: this.detectBrowserLanguage(), source: 'browser' };
      }

      // navigate / prerender → URL ก่อน (เดิม)
      const u = this.getLangFromURL();
      if (u) return { lang: u, source: 'url' };

      const s = this.getLangFromStorage();
      if (s) return { lang: s, source: 'storage' };

      return { lang: this.detectBrowserLanguage(), source: 'browser' };
    },
  };

  M.DetectorService = DetectorService;

})(window.LangModules = window.LangModules || {});