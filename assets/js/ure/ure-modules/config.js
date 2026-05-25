// Path:    assets/js/ure/ure-modules/config.js
// Purpose: All compile-time constants for URE. Nothing mutates.
// Used by: Every URE module
//
// Changes v1.3.0:
//   DOM.SETTLED_CLASS      — class applied when item height stabilises (removes will-change)
//   RENDER.DEFAULT_OVERSCAN        — item-count buffer (0 = use buffer px)
//   RENDER.INITIAL_MOUNT_MULTIPLIER — caps are relaxed on the first render frame
//   GRID section           — multi-column layout defaults

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
    // On the very first render frame the buffer-zone mount cap is multiplied by
    // this value so the area just outside the viewport fills without waiting
    // for multiple rAF cycles (still capped — viewport items are always uncapped).
    INITIAL_MOUNT_MULTIPLIER: 3,
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
    // Added once ResizeObserver confirms an item's height is stable.
    // CSS rule: .ure-visible.ure-settled { will-change: auto; }
    // Releasing compositing layers reduces GPU memory on long lists.
    SETTLED_CLASS: 'ure-settled',
  });
  
  // ── Grid layout defaults (NEW v1.3.0) ─────────────────────────────────────
  
  const GRID = Object.freeze({
    DEFAULT_COLUMNS: 1, // 1 = normal list; >1 = multi-column grid
    DEFAULT_GAP_PX: 0, // gap between columns and between rows
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
  
  M.CONFIG = Object.freeze({ RENDER, TIMING, DIFF, DOM, GRID, DEVICE_TIER, BATCH });
  
})(window.UREModules = window.UREModules || {});