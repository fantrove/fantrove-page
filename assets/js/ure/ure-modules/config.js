// Path:    assets/js/ure/ure-modules/config.js
// Purpose: All compile-time constants for URE. Nothing mutates.
// Used by: Every URE module
//
// v1.5.0: CACHE, ANCHOR sections
// v1.6.0: LARGE_DATASET section — thresholds for worker persistence,
//         chunked height init, and template HTML cache cap
// v1.7.0: MEMORY section — adaptive memory pressure system:
//           DEVICE_MEMORY_THRESHOLDS_GB  — static device tier breakpoints
//           HEAP_USAGE_THRESHOLDS        — dynamic Chromium heap ratio breakpoints
//           POLL_INTERVAL_MS             — how often to re-sample heap
//           BUDGETS                      — per-component caps at each pressure level
//             index 0 = COMFORTABLE, 1 = MODERATE, 2 = TIGHT, 3 = CRITICAL

(function(M) {
  'use strict';

  const RENDER = Object.freeze({
    DEFAULT_BUFFER_PX          : 600,
    DEFAULT_ITEM_HEIGHT        : 96,
    DEFAULT_POOL_CAP           : 60,
    IO_THRESHOLD               : 0,
    SENTINEL_MARGIN            : '700px',
    DEFAULT_OVERSCAN           : 0,
    INITIAL_MOUNT_MULTIPLIER   : 1,
  });

  const ANCHOR = Object.freeze({
    APPLY_VEL_THRESHOLD : 1.5,
  });

  const CACHE = Object.freeze({
    HEIGHT_PREFIX : 'ure_h_',
    SCROLL_PREFIX : 'ure_sp_',
    MAX_ENTRIES   : 5000,
    VERSION       : 1,
  });

  // ── Large-dataset complexity control (v1.6.0) ─────────────────────────────
  // These are the comfortable-level defaults. MemoryManager will override
  // per-instance at runtime when pressure increases.

  const LARGE_DATASET = Object.freeze({
    WORKER_PERSIST_N   : 10_000,
    CHUNK_INIT_N       : 50_000,
    INIT_CHUNK_SIZE    : 5_000,
    TEMPLATE_CACHE_CAP : 2_000,
  });

  // ── Adaptive memory management (v1.7.0) ───────────────────────────────────
  //
  // DEVICE_MEMORY_THRESHOLDS_GB — navigator.deviceMemory breakpoints.
  //   comfortable if ≥ index[0], moderate if ≥ index[1], tight if ≥ index[2].
  //
  // HEAP_USAGE_THRESHOLDS — performance.memory (usedJSHeapSize/jsHeapSizeLimit)
  //   breakpoints for moderate, tight, critical respectively.
  //   Only available in Chromium; memory.js falls back to static tier elsewhere.
  //
  // BUDGETS — each key maps to [comfortable, moderate, tight, critical].
  //   POOL_CAP         — max nodes per bucket in DOM recycle pool.
  //   TMPL_CACHE_CAP   — max rendered-HTML entries in template cache.
  //   PRE_CACHE_CAP    — max items in idle pre-render cache.
  //   HEIGHT_CACHE_MAX — max entries to keep in sessionStorage height cache.
  //   WORKER_PERSIST_N — items threshold to pre-load into Web Worker.
  //   CHUNK_INIT_N     — items threshold to switch to chunked height init.
  //   BUFFER_PX        — virtual scroll pre-render buffer in px.
  //   MOUNT_CAP_SCALE  — multiplier applied to device-tier _MOUNT_CAP.

  const MEMORY = Object.freeze({
    POLL_INTERVAL_MS             : 30_000,
    DEVICE_MEMORY_THRESHOLDS_GB  : Object.freeze([4, 2, 1]),
    HEAP_USAGE_THRESHOLDS        : Object.freeze([0.50, 0.70, 0.85]),
    BUDGETS: Object.freeze({
      POOL_CAP         : Object.freeze([60,    40,    20,    8   ]),
      TMPL_CACHE_CAP   : Object.freeze([2_000, 800,   200,   50  ]),
      PRE_CACHE_CAP    : Object.freeze([48,    24,    8,     2   ]),
      HEIGHT_CACHE_MAX : Object.freeze([5_000, 3_000, 1_500, 500 ]),
      WORKER_PERSIST_N : Object.freeze([10_000, 5_000, 2_000, 1_000]),
      CHUNK_INIT_N     : Object.freeze([50_000,30_000,15_000, 5_000]),
      BUFFER_PX        : Object.freeze([600,   400,   200,   100 ]),
      MOUNT_CAP_SCALE  : Object.freeze([1.0,   1.0,   0.75,  0.5 ]),
    }),
  });

  const TIMING = Object.freeze({
    HEIGHT_CORRECTION_RATE_MS : 100,
    IDLE_CALLBACK_TIMEOUT_MS  : 300,
    SCROLL_IDLE_MS            : 100,
    RESIZE_IDLE_MS            : 150,
    PRELOAD_DELAY_MS          : 200,
  });

  const DIFF = Object.freeze({
    FALLBACK_KEY_FIELD      : 'id',
    FULL_REPLACE_THRESHOLD  : 50_000,
  });

  const DOM = Object.freeze({
    CONTAINER_ATTR    : 'data-ure-container',
    ITEM_ATTR         : 'data-ure-key',
    PLACEHOLDER_CLASS : 'ure-placeholder',
    SPACER_CLASS      : 'ure-spacer',
    VISIBLE_CLASS     : 'ure-visible',
    SETTLED_CLASS     : 'ure-settled',
  });

  const GRID = Object.freeze({
    DEFAULT_COLUMNS : 1,
    DEFAULT_GAP_PX  : 0,
  });

  const _cores = (navigator && navigator.hardwareConcurrency) || 4;
  const _mem   = (navigator && navigator.deviceMemory)        || 4;
  const DEVICE_TIER = (_cores <= 2 || _mem <= 1) ? 0 :
    (_cores <= 4 || _mem <= 2) ? 1 : 2;

  const BATCH = Object.freeze({
    RENDER_CHUNK  : [4,  8,  16][DEVICE_TIER],
    PRELOAD_CHUNK : [8, 16,  32][DEVICE_TIER],
  });

  M.CONFIG = Object.freeze({
    RENDER, ANCHOR, CACHE, LARGE_DATASET, MEMORY,
    TIMING, DIFF, DOM, GRID, DEVICE_TIER, BATCH,
  });

})(window.UREModules = window.UREModules || {});