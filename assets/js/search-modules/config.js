// @ts-check
/**
 * @file config.js
 * All compile-time constants: CONFIG, TEXTS, Icons.
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
  
  // ── Timing & limits ────────────────────────────────────────────────────────
  /** @type {TimingConfig} */
  const TIMING = Object.freeze({
    debounceMs: 120,
    toastDisplayMs: 1400,
    toastFadeMs: 250,
    focusDelayMs: 30,
    transitionDelayMs: 300,
    keyboardDetectionDelayMs: 100,
    keyboardGapMinMs: 300,
    keyboardGapRecoveryMs: 800,
    keyboardIdleTimeMs: 500,
    conDataServiceWaitMs: 5000,
    conDataServicePollMs: 30,
    urlSearchRetryMs: 200,
    urlSearchMaxRetries: 25,
  });
  
  /** @type {Readonly<Record<string,number>>} */
  const RENDER = Object.freeze({
    suggestionMax: 8,
    suggestionsFullscreenMax: 30,
    vsOverscanPx: 320,
    vsPoolMax: 40,
    vsEstimatedItemHeight: 96,
  });
  
  /** @type {Readonly<Record<string,string>>} */
  const DOM = Object.freeze({
    suggestionContainerId: 'searchSuggestions',
    overlayContainerId: 'searchOverlayContainer',
    sentinelId: 'search-render-sentinel',
    searchInputId: 'searchInput',
    searchFormId: 'searchForm',
    typeFilterId: 'typeFilter',
    categoryFilterId: 'categoryFilter',
    searchResultsId: 'searchResults',
    copyToastId: 'copyToast',
    clearBtnId: 'search-clear-btn',
  });
  
  const STORAGE = Object.freeze({ historyKey: 'searchHistory_v1', langKey: 'selectedLang' });
  const LANG = Object.freeze({ default: 'en', autoDetect: true });
  const DB = Object.freeze({ path: '/assets/db/db.min.json' });
  
  // ── i18n ──────────────────────────────────────────────────────────────────
  /** @type {Readonly<Record<string,Record<string,string>>>} */
  const TEXTS = Object.freeze({
    th: {
      all_types: 'ทุกประเภท',
      all_categories: 'ทุกหมวดหมู่',
      not_found: 'ไม่พบข้อมูลที่ตรงหรือใกล้เคียง',
      copy: 'คัดลอก',
      copy_failed: 'คัดลอกไม่สำเร็จ',
      suggestion_label: 'คำแนะนำ',
      suggestions_for_you: 'คำแนะนำสำหรับคุณ',
      search_result_here: 'ผลลัพธ์การค้นหาจะปรากฏที่นี่',
      search_placeholder: 'ค้นหาข้อมูล...',
      type: 'ประเภท',
      category: 'หมวดหมู่',
      emoji: 'อีโมจิ',
      trending: 'ยอดนิยม',
      back: 'ย้อนกลับ',
      clear: 'ล้างคำค้นหา',
      click_to_copy: 'แตะการ์ดเพื่อคัดลอก',
      click_to_copy_demo: 'แตะเพื่อดูตัวอย่างการคัดลอก',
    },
    en: {
      all_types: 'All Types',
      all_categories: 'All Categories',
      not_found: 'No data found related to your keyword.',
      copy: 'Copy',
      copy_failed: 'Failed to copy',
      suggestion_label: 'Suggestions',
      suggestions_for_you: 'Suggestions for you',
      search_result_here: 'Search results will appear here',
      search_placeholder: 'Search information...',
      type: 'Type',
      category: 'Category',
      emoji: 'Emoji',
      trending: 'Trending',
      back: 'Back',
      clear: 'Clear',
      click_to_copy: 'Tap a card to copy',
      click_to_copy_demo: 'Tap to see a demo',
    },
  });
  
  // ── SVG icons ──────────────────────────────────────────────────────────────
  /** @type {Readonly<Record<string,string>>} */
  const Icons = Object.freeze({
    search: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
    back: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="M12 5l-7 7 7 7"/></svg>`,
    clear: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  });
  
  // ── Export ─────────────────────────────────────────────────────────────────
  /** @type {AppConfig} */
  M.CONFIG = Object.freeze({ TIMING, RENDER, DOM, STORAGE, LANG, DB, TEXTS, Icons });
  
})(window.SearchModules = window.SearchModules || {});