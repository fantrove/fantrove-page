// Path:    assets/js/ure/ure-modules/config.js
// Purpose: All compile-time constants for URE. Nothing mutates.
// Used by: Every URE module
//
// v1.5.0 changes:
//   CACHE section — height persistence + scroll position storage keys/limits
//   ANCHOR_APPLY_VEL — velocity threshold above which anchor restore is deferred

(function(M) {
  'use strict';
  
  // ── Render geometry ───────────────────────────────────────────────────────
  
  const RENDER = Object.freeze({
    DEFAULT_BUFFER_PX: 600,
    DEFAULT_ITEM_HEIGHT: 96,
    DEFAULT_POOL_CAP: 60,
    IO_THRESHOLD: 0,
    SENTINEL_MARGIN: '700px',
    // 0 = use DEFAULT_BUFFER_PX; >0 = number of items to pre-render beyond visible range
    DEFAULT_OVERSCAN: 0,
    // v1.3.0: first-frame mount multiplier — removed in v1.4.0 (caused initial jank).
    // Kept as a named constant (= 1) to document the intentional revert.
    INITIAL_MOUNT_MULTIPLIER: 1,
  });
  
  // ── Scroll anchor ─────────────────────────────────────────────────────────
  
  const ANCHOR = Object.freeze({
    // px/ms — below this velocity the anchor scrollBy is applied immediately.
    // Above it we skip the scrollBy and let the scroll-idle flush handle it,
    // to avoid interrupting browser momentum scrolling on mobile.
    APPLY_VEL_THRESHOLD: 1.5,
  });
  
  // ── Height + scroll-position persistence (v1.5.0) ────────────────────────
  // Heights are cached per item key in sessionStorage so remounts (SPA
  // navigation back) use real heights instead of estimates, eliminating
  // the correction storm that caused layout shift during scroll-up.
  
  const CACHE = Object.freeze({
    HEIGHT_PREFIX: 'ure_h_', // sessionStorage key prefix for height maps
    SCROLL_PREFIX: 'ure_sp_', // sessionStorage key prefix for scroll position
    MAX_ENTRIES: 5000, // prune oldest entries beyond this limit
    // Schema version — bump whenever the stored format changes so stale
    // data in sessionStorage is discarded rather than mis-parsed.
    VERSION: 1,
  });
  
  // ── Scheduler timing ──────────────────────────────────────────────────────
  
  const TIMING = Object.freeze({
    HEIGHT_CORRECTION_RATE_MS: 100,
    IDLE_CALLBACK_TIMEOUT_MS: 300,
    SCROLL_IDLE_MS: 100,
    RESIZE_IDLE_MS: 150,
    PRELOAD_DELAY_MS: 200,
  });
  
  // ── Diffing ───────────────────────────────────────────────────────────────
  
  const DIFF = Object.freeze({
    FALLBACK_KEY_FIELD: 'id',
    FULL_REPLACE_THRESHOLD: 50_000,
  });
  
  // ── DOM markers ───────────────────────────────────────────────────────────
  
  const DOM = Object.freeze({
    CONTAINER_ATTR: 'data-ure-container',
    ITEM_ATTR: 'data-ure-key',
    PLACEHOLDER_CLASS: 'ure-placeholder',
    SPACER_CLASS: 'ure-spacer',
    VISIBLE_CLASS: 'ure-visible',
    // Applied once ResizeObserver confirms an item's height is stable.
    // CSS rule: .ure-visible.ure-settled { will-change: auto; }
    SETTLED_CLASS: 'ure-settled',
  });
  
  // ── Grid layout defaults ──────────────────────────────────────────────────
  
  const GRID = Object.freeze({
    DEFAULT_COLUMNS: 1,
    DEFAULT_GAP_PX: 0,
  });
  
  // ── Device tier (set once at module load) ─────────────────────────────────
  
  const _cores = (navigator && navigator.hardwareConcurrency) || 4;
  const _mem = (navigator && navigator.deviceMemory) || 4;
  const DEVICE_TIER = (_cores <= 2 || _mem <= 1) ? 0 :
    (_cores <= 4 || _mem <= 2) ? 1 : 2;
  
  const BATCH = Object.freeze({
    RENDER_CHUNK: [4, 8, 16][DEVICE_TIER],
    PRELOAD_CHUNK: [8, 16, 32][DEVICE_TIER],
  });
  
  // ── Export ────────────────────────────────────────────────────────────────
  
  M.CONFIG = Object.freeze({ RENDER, ANCHOR, CACHE, TIMING, DIFF, DOM, GRID, DEVICE_TIER, BATCH });
  
})(window.UREModules = window.UREModules || {});