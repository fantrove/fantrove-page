// @ts-check
/**
 * @file config.js
 * All compile-time constants for NavCore.
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
  
  // ── Data fetching ─────────────────────────────────────────────────────────────
  const FETCH = Object.freeze({
    TIMEOUT: 5000,
    RETRY_DELAY: 300,
    MAX_RETRIES: 1,
    CACHE_DURATION: 2 * 60 * 60 * 1000, // 2 hours
    MAX_CONCURRENT: 2, // max simultaneous fetch-queue workers
    WARMUP_DELAY: 1200, // ms before warmup on non-idle browsers
    WARMUP_TIMEOUT: 2000, // requestIdleCallback timeout
  });
  
  // ── Paths ─────────────────────────────────────────────────────────────────────
  const PATHS = Object.freeze({
    BUTTONS_CONFIG: '/assets/json/buttons.json',
    API_DATABASE: '/assets/db/con-data/',
    TOP_INDEX_FILE: 'index.json',
    KNOWN_TOP_CATS: Object.freeze(['emoji', 'symbol', 'unicode']),
  });
  
  // ── DOM identifiers ───────────────────────────────────────────────────────────
  const DOM = Object.freeze({
    // Loading overlay
    OVERLAY_ID: 'clp-overlay',
    CONTENT_LOADING_ID: 'content-loading',
    
    // Navigation
    HEADER_TAG: 'header',
    NAV_LIST_ID: 'nav-list',
    SUB_NAV_ID: 'sub-nav',
    SUB_NAV_CLASS: 'hj',
    SUB_BUTTONS_ID: 'sub-buttons-container',
    LOGO_CLASS: '.logo',
    
    // Content
    SENTINEL_ID: 'cm4-sentinel',
  });
  
  // ── Loading overlay ───────────────────────────────────────────────────────────
  const LOADING = Object.freeze({
    FADE_OUT_MS: 200,
    LANG_KEY: 'selectedLang',
  });
  
  // ── Content rendering ─────────────────────────────────────────────────────────
  const CONTENT = Object.freeze({
    POOL_CAP: 48, // max recycled DOM nodes in pool
    INDEX_YIELD_N: 500, // items between scheduler yields during index build
  });
  
  // ── i18n messages — loading overlay ──────────────────────────────────────────
  // To add a new language: add a key here — no other changes needed.
  const LOADING_MESSAGES = Object.freeze({
    en: Object.freeze({ loading: 'Loading...' }),
    th: Object.freeze({ loading: 'กำลังโหลด...' }),
    // ja: Object.freeze({ loading: '読み込み中...'  }),
    // zh: Object.freeze({ loading: '加载中...'      }),
  });
  
  // ── Export ────────────────────────────────────────────────────────────────────
  M.CONFIG = Object.freeze({
    FETCH,
    PATHS,
    DOM,
    LOADING,
    CONTENT,
    LOADING_MESSAGES,
  });
  
})(window.NavCoreModules = window.NavCoreModules || {});