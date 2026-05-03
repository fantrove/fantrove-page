// Path:    assets/js/ure/ure-modules/config.js
// Purpose: All compile-time constants for URE. Nothing mutates.
// Used by: Every URE module

(function(M) {
  'use strict';
  
  // ── Render geometry ───────────────────────────────────────────────────────
  
  const RENDER = Object.freeze({
    // px to pre-render outside the visible viewport (above + below)
    DEFAULT_BUFFER_PX: 600,
    // px estimate used before ResizeObserver measures a real height
    DEFAULT_ITEM_HEIGHT: 96,
    // max DOM nodes kept alive in the recycle pool per bucket type
    DEFAULT_POOL_CAP: 60,
    // min visible height before we consider an item "in viewport"
    IO_THRESHOLD: 0,
    // rootMargin for the sentinel IntersectionObserver (load-ahead)
    SENTINEL_MARGIN: '700px',
  });
  
  // ── Scheduler timing ──────────────────────────────────────────────────────
  
  const TIMING = Object.freeze({
    // ms between height-correction passes (rate-limits ResizeObserver cascade)
    HEIGHT_CORRECTION_RATE_MS: 100,
    // rIC timeout: if idle never comes, force-run after this many ms
    IDLE_CALLBACK_TIMEOUT_MS: 300,
    // debounce for scroll-idle detection
    SCROLL_IDLE_MS: 100,
    // debounce for resize-idle detection
    RESIZE_IDLE_MS: 150,
    // ms after mount before first background preload pass
    PRELOAD_DELAY_MS: 200,
  });
  
  // ── Diffing ───────────────────────────────────────────────────────────────
  
  const DIFF = Object.freeze({
    // field name used as item identity when keyField not in data
    FALLBACK_KEY_FIELD: 'id',
    // max items before diffing switches to full-replace for speed
    FULL_REPLACE_THRESHOLD: 50_000,
  });
  
  // ── DOM markers ──────────────────────────────────────────────────────────
  
  const DOM = Object.freeze({
    // attribute set on URE-managed container
    CONTAINER_ATTR: 'data-ure-container',
    // attribute on each rendered item node
    ITEM_ATTR: 'data-ure-key',
    // class on placeholder nodes (height-only divs)
    PLACEHOLDER_CLASS: 'ure-placeholder',
    // class on the spacer box that holds total list height
    SPACER_CLASS: 'ure-spacer',
    // class added to items entering the viewport
    VISIBLE_CLASS: 'ure-visible',
  });
  
  // ── Device tier (set once at module load) ─────────────────────────────────
  // Tier 0 = low-end  → smaller batches, longer yield gaps
  // Tier 1 = mid-range
  // Tier 2 = high-end → larger batches, shorter yield gaps
  
  const _cores = (navigator && navigator.hardwareConcurrency) || 4;
  const _mem = (navigator && navigator.deviceMemory) || 4;
  const DEVICE_TIER = (_cores <= 2 || _mem <= 1) ? 0 :
    (_cores <= 4 || _mem <= 2) ? 1 : 2;
  
  const BATCH = Object.freeze({
    // items rendered per rAF tick, scaled by device tier
    RENDER_CHUNK: [4, 8, 16][DEVICE_TIER],
    // items preprocessed per rIC slice
    PRELOAD_CHUNK: [8, 16, 32][DEVICE_TIER],
  });
  
  // ── Export ────────────────────────────────────────────────────────────────
  
  M.CONFIG = Object.freeze({ RENDER, TIMING, DIFF, DOM, DEVICE_TIER, BATCH });
  
})(window.UREModules = window.UREModules || {});