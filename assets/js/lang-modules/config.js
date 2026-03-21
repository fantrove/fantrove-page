// @ts-check
/**
 * @file config.js
 * All compile-time constants.
 *
 * Rules:
 *  • Nothing mutates — every value is Object.freeze()'d.
 *  • No dependencies on other modules.
 *  • Change a value here and every module sees it immediately.
 *
 * @module config
 * @depends {types.js}
 */
(function(M) {
  'use strict';
  
  const CONFIG = Object.freeze({
    // ── Language settings ──────────────────────────────────────────────────
    SUPPORTED_LANGS: ['en', 'th'],
    DEFAULT_LANG: 'en',
    LS_KEY: 'selectedLang', // localStorage key สำหรับ preference
    CFG_CACHE_KEY: '__lang_cfg', // key สำหรับ cache config ใน localStorage/sessionStorage
    
    // ── URLs ───────────────────────────────────────────────────────────────
    DB_JSON_URL: '/assets/lang/options/db.json',
    LANG_JSON_URL: (lang) => `/assets/lang/${lang}.json`,
    
    // ── Preconnect ─────────────────────────────────────────────────────────
    PRECONNECT_URLS: ['//cdn.jsdelivr.net', '//fonts.googleapis.com'],
    
    // ── UI ─────────────────────────────────────────────────────────────────
    FADE_DURATION: 300, // ms สำหรับ dropdown fade animation
    
    // ── IndexedDB ─────────────────────────────────────────────────────────
    DB_NAME: 'LanguageCacheDB_v3',
    DB_STORE: 'langs',
    DB_META: 'meta',
    DB_VERSION: 4,
  });
  
  M.CONFIG = CONFIG;
  
})(window.LangModules = window.LangModules || {});