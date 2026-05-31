// Path:    assets/js/ure/ure-modules/config.js
// Purpose: All compile-time constants for URE. Nothing mutates.
// Used by: Every URE module
//
// v1.5.0: CACHE, ANCHOR sections
// v1.6.0: LARGE_DATASET section — thresholds for worker persistence,
//         chunked height init, and template HTML cache cap

(function(M) {
  'use strict';

  const RENDER = Object.freeze({
    DEFAULT_BUFFER_PX: 600,
    DEFAULT_ITEM_HEIGHT: 96,
    DEFAULT_POOL_CAP: 60,
    IO_THRESHOLD: 0,
    SENTINEL_MARGIN: '700px',
    DEFAULT_OVERSCAN: 0,
    INITIAL_MOUNT_MULTIPLIER: 1,
  });

  const ANCHOR = Object.freeze({
    APPLY_VEL_THRESHOLD: 1.5,
  });

  const CACHE = Object.freeze({
    HEIGHT_PREFIX : 'ure_h_',
    SCROLL_PREFIX : 'ure_sp_',
    MAX_ENTRIES   : 5000,
    VERSION       : 1,
  });

  // ── Large-dataset complexity control (v1.6.0) ─────────────────────────────
  //
  // Three levers for O(n) cost at scale:
  //
  //  WORKER_PERSIST_N — above this count, engine.js pre-loads the full dataset
  //    into the Web Worker once (loadData). Subsequent filter / paginate calls
  //    skip the structured-clone transfer entirely; only the predicate + result
  //    slice cross the boundary. Prevents O(n) serialization on every filter.
  //
  //  CHUNK_INIT_N — above this count, virtual-list.js initialises the height
  //    array with typed-array .fill() then refines with height-cache values in
  //    idle-time chunks instead of one synchronous O(n) loop. Keeps the main
  //    thread free during the first render frame.
  //
  //  INIT_CHUNK_SIZE — items processed per requestIdleCallback tick during the
  //    chunked height-cache pass.
  //
  //  TEMPLATE_CACHE_CAP — max entries in the per-key HTML template cache.
  //    Caches the rendered string for items whose data + lang haven't changed,
  //    so recycled nodes that scroll back into view skip renderFn entirely.
  //    Eviction: oldest-insertion-order entry is dropped when cap is reached.

  const LARGE_DATASET = Object.freeze({
    WORKER_PERSIST_N   : 10_000,
    CHUNK_INIT_N       : 50_000,
    INIT_CHUNK_SIZE    : 5_000,
    TEMPLATE_CACHE_CAP : 2_000,
  });

  const TIMING = Object.freeze({
    HEIGHT_CORRECTION_RATE_MS: 100,
    IDLE_CALLBACK_TIMEOUT_MS: 300,
    SCROLL_IDLE_MS: 100,
    RESIZE_IDLE_MS: 150,
    PRELOAD_DELAY_MS: 200,
  });

  const DIFF = Object.freeze({
    FALLBACK_KEY_FIELD: 'id',
    FULL_REPLACE_THRESHOLD: 50_000,
  });

  const DOM = Object.freeze({
    CONTAINER_ATTR: 'data-ure-container',
    ITEM_ATTR: 'data-ure-key',
    PLACEHOLDER_CLASS: 'ure-placeholder',
    SPACER_CLASS: 'ure-spacer',
    VISIBLE_CLASS: 'ure-visible',
    SETTLED_CLASS: 'ure-settled',
  });

  const GRID = Object.freeze({
    DEFAULT_COLUMNS: 1,
    DEFAULT_GAP_PX: 0,
  });

  const _cores = (navigator && navigator.hardwareConcurrency) || 4;
  const _mem   = (navigator && navigator.deviceMemory) || 4;
  const DEVICE_TIER = (_cores <= 2 || _mem <= 1) ? 0 :
    (_cores <= 4 || _mem <= 2) ? 1 : 2;

  const BATCH = Object.freeze({
    RENDER_CHUNK:  [4, 8, 16][DEVICE_TIER],
    PRELOAD_CHUNK: [8, 16, 32][DEVICE_TIER],
  });

  M.CONFIG = Object.freeze({
    RENDER, ANCHOR, CACHE, LARGE_DATASET,
    TIMING, DIFF, DOM, GRID, DEVICE_TIER, BATCH,
  });

})(window.UREModules = window.UREModules || {});