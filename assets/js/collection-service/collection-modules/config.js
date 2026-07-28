/**
 * config.js — ค่าคงที่และการตั้งค่า (Constants & Configuration) สำหรับ Collection Service
 *
 * Part of: Collection Service
 * Namespace: window.CollectionModules
 *
 * Dependencies: none (Phase 1 — pure definitions)
 *
 * Public API:
 *   M.Config — object containing all configuration
 */

(function (M) {
  'use strict';

  // ── Path Configuration ────────────────────────────────────────────

  var PATHS = {
    /** Base path สำหรับ collection data files */
    BASE_PATH: '/assets/db/con-data',

    /** Type index file สำหรับ collections */
    COLLECTIONS_INDEX: '/assets/db/con-data/collections.json',

    /** URL pattern สำหรับ collection pages */
    COLLECTION_URL_PATTERN: '/collections/{id}/',

    /** Template สำหรับสร้าง collection subcategory path */
    collectionDataPath: function (id) {
      return '/assets/db/con-data/collections/' + id + '.json';
    },

    /** สร้าง URL สำหรับ collection page */
    collectionPageUrl: function (id, lang) {
      var langPrefix = lang ? '/' + lang : '';
      return langPrefix + '/collections/' + id + '/';
    },
  };

  // ── Cover Configuration ───────────────────────────────────────────

  var COVER = {
    /** จำนวน items สูงสุดที่จะแสดงในปก */
    MAX_COVER_ITEMS: 8,

    /** จำนวน items สูงสุดสำหรับ layout 'row' */
    ROW_MAX_ITEMS: 2,

    /** จำนวน items สูงสุดสำหรับ layout 'grid' */
    GRID_MAX_ITEMS: 8,

    /** จำนวน items สูงสุดสำหรับ layout 'spiral' */
    SPIRAL_MAX_ITEMS: 16,

    /** CSS class prefix สำหรับ cover */
    CSS_PREFIX: 'cover-',

    /** ขนาด font ต่ำสุดสำหรับ cover characters */
    FONT_SIZE_MIN: '2rem',

    /** ขนาด font สูงสุดสำหรับ cover characters */
    FONT_SIZE_MAX: '5rem',
  };

  // ── Fetch Configuration ───────────────────────────────────────────

  var FETCH = {
    /** Cache TTL สำหรับ collection data (2 ชั่วโมง) */
    CACHE_TTL_MS: 2 * 60 * 60 * 1000,

    /** Timeout สำหรับ fetch request */
    TIMEOUT_MS: 8000,

    /** จำนวนครั้งสูงสุดในการ poll ConDataService */
    CONDATA_POLL_MAX: 40,

    /** ระยะเวลาระหว่าง poll (ms) */
    CONDATA_POLL_INTERVAL_MS: 20,

    /** ระยะเวลาสูงสุดในการรอ ConDataService (ms) */
    CONDATA_WAIT_MS: 800,
  };

  // ── Related Collections Configuration ─────────────────────────────

  var RELATED = {
    /** จำนวน related collections เริ่มต้น */
    DEFAULT_MAX_RESULTS: 4,

    /** จำนวน related collections สูงสุด */
    ABSOLUTE_MAX_RESULTS: 8,

    /** คะแนนขั้นต่ำที่จะแสดงเป็น related */
    MIN_SCORE: 0.01,
  };

  // ── Card Bridge Configuration ─────────────────────────────────────

  var CARD = {
    /** API prefix สำหรับ collection cards */
    API_PREFIX: 'collection-',

    /** CSS class สำหรับ collection card */
    CLASS_NAME: 'collection-card',
  };

  // ── SEO Configuration ─────────────────────────────────────────────

  var SEO = {
    /** Base URL สำหรับ canonical + hreflang */
    BASE_URL: 'https://fantrove.pages.dev',

    /** ภาษาเริ่มต้น */
    DEFAULT_LANG: 'en',

    /** ภาษาที่รองรับ */
    SUPPORTED_LANGS: ['en', 'th'],
  };

  // ── Timing Configuration ──────────────────────────────────────────

  var TIMING = {
    /** Animation delay ต่อ character ใน cover */
    COVER_CHAR_DELAY_MS: 60,

    /** Fade-in duration สำหรับ cover */
    COVER_FADE_MS: 400,
  };

  // ── Version ───────────────────────────────────────────────────────

  var VERSION = '1.0.0';

  // ── Export ─────────────────────────────────────────────────────────

  var Config = Object.freeze({
    PATHS: PATHS,
    COVER: COVER,
    FETCH: FETCH,
    RELATED: RELATED,
    CARD: CARD,
    SEO: SEO,
    TIMING: TIMING,
    VERSION: VERSION,
  });

  M.Config = Config;

})(window.CollectionModules = window.CollectionModules || {});
