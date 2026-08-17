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
    LS_KEY: 'selectedLang',
    CFG_CACHE_KEY: '__lang_cfg',
    
    // ── URLs ───────────────────────────────────────────────────────────────
    DB_JSON_URL: '/assets/lang/options/db.json',
    LANG_JSON_URL: (lang) => `/assets/lang/${lang}.json`,
    
    // ── Preconnect ─────────────────────────────────────────────────────────
    PRECONNECT_URLS: ['//cdn.jsdelivr.net', '//fonts.googleapis.com'],
    
    // ── UI ─────────────────────────────────────────────────────────────────
    FADE_DURATION: 300,
    
    // ── IndexedDB ─────────────────────────────────────────────────────────
    DB_NAME: 'LanguageCacheDB_v3',
    DB_STORE: 'langs',
    DB_META: 'meta',
    DB_VERSION: 4,
    
    // ── Gate (v4.1) ────────────────────────────────────────────────────────
    //
    // SCRIPT_INTERCEPTOR:
    //   true  → ดักจับ <script> ที่ inject เข้า DOM ระหว่างที่ gate ปิดอยู่
    //           queue ไว้ แล้ว flush ทั้งหมดเมื่อระบบภาษาพร้อม
    //           เหมาะสำหรับ: third-party analytics, widget scripts,
    //           dynamic loaders ที่รัน ก่อนหน้าจะ rendered เป็นภาษาที่ถูกต้อง
    //
    //   false → ไม่ดักจับอะไร (default, safe mode)
    //           script อื่นใช้ T1/T2/T3 แทน (cooperative)
    //
    // ⚠  ใช้ด้วยความระมัดระวัง:
    //    - script ที่มี data-lang-nowait จะไม่ถูก queue เลย
    //    - หาก initialize() fail → queue จะถูก flush ให้อัตโนมัติ
    //      เพื่อไม่ให้หน้าค้าง
    //
    SCRIPT_INTERCEPTOR: false,
  });
  
  M.CONFIG = CONFIG;
  
})(window.LangModules = window.LangModules || {});