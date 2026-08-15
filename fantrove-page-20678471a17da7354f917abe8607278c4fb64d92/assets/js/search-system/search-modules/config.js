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
 * v1.1 — Performance tuning
 *  conDataServiceWaitMs 5000 → 1200
 *    WHY: con-data-service.js now calls preload() immediately on
 *    module load. The data fetch is in-flight before search-ui
 *    even finishes loading its modules (~200ms). 1200ms is more
 *    than enough headroom even on slow connections, while the old
 *    5000ms caused a noticeable blank period on every page load.
 *
 *  conDataServicePollMs 30 → 20
 *    WHY: tighter poll = faster detection when module lands.
 *    20ms is still async-friendly and won't block the main thread.
 *
 *  urlSearchRetryMs 200 → 120
 *    WHY: URL-based search (page load with ?q=...) retries faster,
 *    so results appear sooner after the Fuse index is built.
 *
 * v4.0 — Discovery system + smart language detection
 *  • Added DISCOVERY config block — controls related-content
 *    recommendations shown after primary search results.
 *  • Added LANG_WEIGHT config — controls query-language detection
 *    thresholds used by SuggestionService to keep suggestions in
 *    the same language the user is typing in.
 *  • Reworked TEXTS — friendlier, Google-inspired copy across both
 *    Thai and English. Replaced generic labels ("แนะนำ", "ยอดนิยม")
 *    with phrasing closer to what large platforms actually show
 *    ("คำค้นที่เกี่ยวข้อง", "กำลังได้รับความนิยม").
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

    // Reduced from 5000 → 1200ms (preload starts immediately in con-data-service)
    conDataServiceWaitMs: 1200,
    // Tighter poll for faster ConDataService detection
    conDataServicePollMs: 20,

    // Faster URL-search retry so results after ?q=... appear sooner
    urlSearchRetryMs: 120,
    urlSearchMaxRetries: 30,
  });

  /** @type {Readonly<Record<string,number>>} */
  const RENDER = Object.freeze({
    suggestionMax: 8,
    suggestionsFullscreenMax: 30,
    vsOverscanPx: 320,
    vsPoolMax: 40,
    vsEstimatedItemHeight: 96,
  });

  /**
   * Discovery system configuration (v4.0).
   *
   * Controls how related content is recommended after the primary
   * search results. Inspired by YouTube's "more to explore" pattern:
   * show what the user searched for first, then keep surfacing related
   * items so users can discover new content continuously.
   *
   * @type {Readonly<DiscoveryConfig>}
   */
  const DISCOVERY = Object.freeze({
    // Maximum number of related items to compute per search.
    // Bounded to keep latency predictable (aerospace: bounded loops).
    maxRelatedItems: 60,
    // Number of top results to sample when computing the dominant
    // type/category for related-content selection.
    sampleTopN: 8,
    // Minimum number of primary results before discovery kicks in.
    // Below this threshold, discovery is suppressed because the
    // primary results are too few to derive a meaningful signal.
    minResultsForDiscovery: 1,
    // Maximum number of items to show in the empty-state discovery
    // block (when primary search returns 0 results).
    emptyStateMaxItems: 12,
    // Score weights for related-item ranking.
    // Higher = stronger signal that the item is related.
    weights: Object.freeze({
      sameType:     1.0,  // item is in the same type as top result
      sameCategory: 1.5,  // item is in the same category as top result
      tokenOverlap: 0.5,  // item name shares tokens with query
    }),
  });

  /**
   * Language-detection weights (v4.0).
   *
   * Used by SuggestionService.detectQueryLanguage() to decide which
   * language the user is typing in, so suggestions stay in the same
   * language as the query.
   *
   * Design rationale (aerospace: deterministic, no magic):
   *  • We count Unicode-script characters in the query.
   *  • A language "wins" only when its char count is meaningfully
   *    larger than the other language's. The ratio below is the
   *    minimum dominance ratio required.
   *  • If neither language dominates (close to 50/50), we fall back
   *    to the active UI language. This handles the edge case the
   *    user described — typing mostly in English with one or two
   *    Thai characters should NOT flip the whole suggestion list
   *    to Thai.
   *
   * @type {Readonly<LangWeightConfig>}
   */
  const LANG_WEIGHT = Object.freeze({
    // Minimum ratio of (dominantLang / otherLang) required to call
    // the query that language. 1.5 means "50% more chars than the
    // other language". A single stray character (e.g. one Thai char
    // in an otherwise English query) will not flip the language.
    dominanceRatio: 1.5,
    // Minimum absolute character count in a language before it can
    // be considered dominant. Prevents one-off characters from
    // triggering a language switch on very short queries.
    minCharsForDominance: 2,
    // When neither language meets the dominance threshold, fall
    // back to this language. 'auto' = use the active UI language.
    fallback: 'auto',
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
    // v4.0 — Discovery section DOM IDs
    discoveryContainerId: 'searchDiscovery',
    discoverySentinelId: 'search-discovery-sentinel',
  });

  const STORAGE = Object.freeze({ historyKey: 'searchHistory_v1', langKey: 'selectedLang' });
  const LANG = Object.freeze({ default: 'en', autoDetect: true });
  const DB = Object.freeze({ path: '/assets/db/db.min.json' });

  // ── i18n ──────────────────────────────────────────────────────────────────
  //
  // v4.0 — Friendlier, Google-inspired copy.
  //
  // Design principles (aerospace: deterministic + user-friendly):
  //  • Use platform-standard phrasing that users already recognise
  //    from Google, YouTube, etc.
  //  • Replace vague labels ("แนะนำ", "ยอดนิยม") with descriptive
  //    ones ("คำค้นที่เกี่ยวข้อง", "กำลังได้รับความนิยม").
  //  • Empty-state copy is small and friendly — tells the user
  //    what to do next instead of just announcing failure.
  //  • Discovery section headers indicate progression: primary
  //    results → related → more to explore.
  //
  /** @type {Readonly<Record<string,Record<string,string>>>} */
  const TEXTS = Object.freeze({
    th: {
      all_types: 'ทุกประเภท',
      all_categories: 'ทุกหมวดหมู่',
      // v4.0 — Friendlier empty state, smaller and less alarming
      not_found: 'ไม่พบผลลัพธ์สำหรับคำค้นนี้',
      not_found_hint: 'ลองดูสิ่งเหล่านี้แทน',
      copy: 'คัดลอก',
      copy_failed: 'คัดลอกไม่สำเร็จ',
      // v4.0 — Clearer label: "related queries" instead of generic "suggestions"
      suggestion_label: 'คำค้นที่เกี่ยวข้อง',
      // v4.0 — Discovery section headers (YouTube-style progression)
      suggestions_for_you: 'อาจเกี่ยวข้อง',
      discovery_label: 'คุณอาจสนใจ',
      discovery_more: 'ยังมีให้สำรวจอีก',
      discovery_hint: 'เลื่อนลงเพื่อดูสิ่งอื่นๆ ต่อ',
      search_result_here: 'ผลลัพธ์การค้นหาจะปรากฏที่นี่',
      search_placeholder: 'ค้นหาข้อมูล...',
      type: 'ประเภท',
      category: 'หมวดหมู่',
      emoji: 'อีโมจิ',
      // v4.0 — Friendlier trending label (Google-style)
      trending: 'กำลังได้รับความนิยม',
      back: 'ย้อนกลับ',
      clear: 'ล้างคำค้นหา',
      click_to_copy: 'แตะการ์ดเพื่อคัดลอก',
      click_to_copy_demo: 'แตะเพื่อดูตัวอย่างการคัดลอก',
    },
    en: {
      all_types: 'All Types',
      all_categories: 'All Categories',
      // v4.0 — Friendlier empty state
      not_found: 'No results for this search',
      not_found_hint: 'Try these instead',
      copy: 'Copy',
      copy_failed: 'Failed to copy',
      // v4.0 — Clearer label
      suggestion_label: 'Related searches',
      // v4.0 — Discovery section headers
      suggestions_for_you: 'You might also like',
      discovery_label: 'You might also like',
      discovery_more: 'More to explore',
      discovery_hint: 'Scroll down for more',
      search_result_here: 'Search results will appear here',
      search_placeholder: 'Search information...',
      type: 'Type',
      category: 'Category',
      emoji: 'Emoji',
      // v4.0 — Friendlier trending label
      trending: 'Trending now',
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
  M.CONFIG = Object.freeze({
    TIMING, RENDER, DOM, STORAGE, LANG, DB, TEXTS, Icons,
    // v4.0 — New top-level config blocks
    DISCOVERY, LANG_WEIGHT,
  });

})(window.SearchModules = window.SearchModules || {});
