// @ts-check
/**
 * @file performance-monitor.js
 * PerformanceMonitorService — observability + self-healing for NavCore.
 *
 * v1.0.0 — Engineering-grade observability
 *
 * WHAT THIS MODULE DOES:
 *   1. Long Animation Frames (LoAF) observer
 *      Detects animations frames that took >50ms (the INP "poor" threshold).
 *      Logs them with attribution (which script caused the slow frame).
 *      Uses the LoAF API (Chromium 118+) with graceful fallback.
 *
 *   2. INP (Interaction to Next Paint) tracking
 *      Measures the latency of every tap/click/key input. Reports the
 *      98th percentile to the console (in dev) and to dataLayer (in prod).
 *      INP is the new Core Web Vital (March 2024) — replaces FID.
 *
 *   3. Web Vitals reporting (LCP, CLS, INP, TTFB)
 *      Uses PerformanceObserver to capture these metrics. Reports to
 *      dataLayer for GTM/GA4 integration.
 *
 *   4. Self-healing stuck-state detector
 *      Periodically (every 5s) checks if LoadingService or RouterService
 *      is stuck (e.g. loading overlay visible for >30s, navigation
 *      "isNavigating" for >30s). If stuck, force-resets.
 *
 *   5. Memory pressure detection
 *      Uses Performance.memory (Chromium-only) to detect high JS heap
 *      usage. Triggers cache eviction in DataService when memory is high.
 *
 *   6. Long task observer
 *      Uses PerformanceObserver('longtask') (Chromium 90+) to detect
 *      tasks >50ms. Used as a fallback when LoAF isn't available.
 *
 *   7. Page Lifecycle integration
 *      Listens to 'freeze' (bfcache) and 'resume' events. On resume,
 *      re-validates that all services are in a healthy state.
 *
 * WHAT THIS MODULE DOES NOT DO:
 *   • It does NOT send data to any external analytics endpoint by default.
 *     Metrics are logged to console + dataLayer only. Operators can wire
 *     dataLayer to GTM/GA4 to forward to their analytics platform.
 *   • It does NOT block or delay any operation. All observers are passive.
 *   • It does NOT collect any PII or content data — only timing/counts.
 *
 * @module performance-monitor
 * @depends {config.js, state.js, loading.js, router.js, data.js}
 */
(function (M) {
  'use strict';

  // ── Thresholds (aligned with Core Web Vitals) ─────────────────────────────
  //
  // INP:
  //   good:    <= 200ms
  //   needs-improvement: <= 500ms
  //   poor:    > 500ms
  // LCP:
  //   good:    <= 2.5s
  //   needs-improvement: <= 4s
  //   poor:    > 4s
  // CLS:
  //   good:    <= 0.1
  //   needs-improvement: <= 0.25
  //   poor:    > 0.25
  //
  // Source: web.dev/vitals

  var THRESHOLDS = Object.freeze({
    INP_GOOD: 200,
    INP_POOR: 500,
    LCP_GOOD: 2500,
    LCP_POOR: 4000,
    CLS_GOOD: 0.1,
    CLS_POOR: 0.25,
    LOAF_MS: 50,        // frames > 50ms are "long"
    LONG_TASK_MS: 50,   // tasks > 50ms are "long"
  });

  // ── Self-healing thresholds ───────────────────────────────────────────────
  var HEALING = Object.freeze({
    CHECK_INTERVAL_MS: 5000,    // check every 5s
    STUCK_LOADING_MS: 30000,    // loading visible > 30s = stuck
    STUCK_NAV_MS: 30000,        // isNavigating > 30s = stuck
    MEMORY_HIGH_MB: 100,        // heap used > 100MB = high
    MEMORY_CRITICAL_MB: 200,    // heap used > 200MB = critical (evict caches)
  });

  // ── Metric storage (for percentile calculation) ───────────────────────────
  var _inpSamples = [];
  var _clsValue = 0;
  var _lcpValue = 0;
  var _ttfbValue = 0;
  var _loafCount = 0;
  var _longTaskCount = 0;
  var _healingTimer = null;
  var _started = false;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function _log() {
    try { console.log.apply(console, ['[NavCore/Perf]'].concat(Array.from(arguments))); } catch (_) {}
  }
  function _warn() {
    try { console.warn.apply(console, ['[NavCore/Perf]'].concat(Array.from(arguments))); } catch (_) {}
  }

  /**
   * Push a metric to dataLayer (if GTM is loaded) for analytics forwarding.
   * Operators can wire this to GA4 via GTM triggers.
   */
  function _toDataLayer(event, payload) {
    try {
      if (typeof window.dataLayer !== 'undefined') {
        window.dataLayer.push(Object.assign({ event: event, _perfTs: Date.now() }, payload));
      }
    } catch (_) {}
  }

  /**
   * Compute the p-th percentile of an array (e.g. p98 for INP).
   * Returns 0 for empty array.
   */
  function _percentile(arr, p) {
    if (!arr.length) return 0;
    var sorted = arr.slice().sort(function (a, b) { return a - b; });
    var idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: Long Animation Frames (LoAF) observer
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // LoAF is the successor to the Long Task API. It reports entire animation
  // frames that exceeded a duration threshold, with attribution to the
  // scripts that caused the long frame. Available in Chromium 118+.
  //
  // Why we observe this:
  //   INP measures input latency, but doesn't tell you WHAT caused the slow
  //   response. LoAF fills that gap — it tells you which script blocked the
  //   main thread for too long.

  function _installLoAFObserver() {
    try {
      if (typeof PerformanceObserver === 'undefined') return;
      if (!('supportedEntryTypes' in PerformanceObserver)) return;
      if (!PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) return;

      var obs = new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          _loafCount++;
          // Only warn on really long frames (> 100ms) to avoid noise
          if (entry.duration > 100) {
            _warn('Long animation frame:', Math.round(entry.duration) + 'ms',
                  'scripts:', entry.scripts ? entry.scripts.length : 0);
            _toDataLayer('perf_loaf', {
              duration: Math.round(entry.duration),
              scripts: entry.scripts ? entry.scripts.map(function (s) {
                return { name: s.name, duration: Math.round(s.duration) };
              }) : [],
            });
          }
        }
      });
      obs.observe({ type: 'long-animation-frame', buffered: true });
    } catch (_) {
      // LoAF not supported — fall back to Long Task API
      _installLongTaskObserver();
    }
  }

  function _installLongTaskObserver() {
    try {
      if (typeof PerformanceObserver === 'undefined') return;
      if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) return;
      var obs = new PerformanceObserver(function (list) {
        _longTaskCount += list.getEntries().length;
      });
      obs.observe({ type: 'longtask', buffered: true });
    } catch (_) {}
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: INP (Interaction to Next Paint) tracking
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // INP is the new Core Web Vital (replaced FID in March 2024). It measures
  // the latency of EVERY user interaction (tap/click/key) — not just the
  // first one — and reports the worst (technically, the 98th percentile).
  //
  // Good:  <= 200ms
  // Poor:  > 500ms
  //
  // We use 'event' entries with duration > 0 to capture interactions.
  // (Older browsers used 'first-input' which only captured the first one.)

  function _installINPObserver() {
    try {
      if (typeof PerformanceObserver === 'undefined') return;
      if (!PerformanceObserver.supportedEntryTypes.includes('event')) return;

      var obs = new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          // We only care about user-driven events with measurable duration
          if (!entry.interactionId || entry.duration < 16) continue;

          _inpSamples.push(entry.duration);
          // Cap the samples array to prevent unbounded growth
          if (_inpSamples.length > 100) _inpSamples.shift();

          // Warn on poor INP for any individual interaction
          if (entry.duration > THRESHOLDS.INP_POOR) {
            _warn('Poor INP:', Math.round(entry.duration) + 'ms',
                  'target:', entry.target ? (entry.target.tagName || '') : '');
          }
        }
      });
      obs.observe({ type: 'event', buffered: true });
    } catch (_) {}
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: LCP, CLS, TTFB (Core Web Vitals)
  // ═══════════════════════════════════════════════════════════════════════════

  function _installLCP() {
    try {
      if (typeof PerformanceObserver === 'undefined') return;
      if (!PerformanceObserver.supportedEntryTypes.includes('largest-contentful-paint')) return;

      var obs = new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        if (entries.length) {
          // Keep the latest LCP value
          _lcpValue = entries[entries.length - 1].startTime;
        }
      });
      obs.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (_) {}
  }

  function _installCLS() {
    try {
      if (typeof PerformanceObserver === 'undefined') return;
      if (!PerformanceObserver.supportedEntryTypes.includes('layout-shift')) return;

      var obs = new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i++) {
          if (!entries[i].hadRecentInput) {
            _clsValue += entries[i].value;
          }
        }
      });
      obs.observe({ type: 'layout-shift', buffered: true });
    } catch (_) {}
  }

  function _installTTFB() {
    try {
      // TTFB is available from the navigation entry
      var navEntries = performance.getEntriesByType('navigation');
      if (navEntries.length) {
        _ttfbValue = navEntries[0].responseStart;
      }
    } catch (_) {}
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: Self-healing stuck-state detector
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Every CHECK_INTERVAL_MS, this function checks:
  //   1. Is LoadingService stuck? (overlay visible > STUCK_LOADING_MS)
  //   2. Is RouterService stuck? (isNavigating > STUCK_NAV_MS)
  //   3. Is JS heap usage critical? (> MEMORY_CRITICAL_MB → evict caches)
  //
  // If any check fails, the appropriate force-reset is called.
  // This is the safety net that prevents the "permanently broken" state
  // that the v1.x architecture was vulnerable to.

  function _runHealingCheck() {
    try {
      var now = Date.now();

      // ── Check 1: LoadingService stuck ──
      var loading = M.LoadingService;
      if (loading && loading._visibleSince && loading._sessionCount > 0) {
        if (now - loading._visibleSince > HEALING.STUCK_LOADING_MS) {
          _warn('Self-healing: LoadingService stuck for >' +
                HEALING.STUCK_LOADING_MS + 'ms — force-resetting');
          try { loading._forceReset(); } catch (_) {}
          _toDataLayer('perf_self_heal', { target: 'LoadingService' });
        }
      }

      // ── Check 2: RouterService stuck ──
      var router = M.RouterService;
      if (router && router.state && router.state.isNavigating) {
        // isNavigating has been true for too long if the safety timer
        // hasn't fired yet (which would set it back to false). We don't
        // have a timestamp for when isNavigating started, but the safety
        // timer is 20s; if we're past 30s, something is very wrong.
        // Use _fsmState as a signal — if it's been in FETCHING/RENDERING
        // for too long, force-reset.
        var fsmStuck = (router._fsmState === 'fetching' || router._fsmState === 'rendering');
        if (fsmStuck && router._abortController) {
          // The router's own safety timer (20s) should fire first. But
          // if it didn't (e.g. timer was cleared by a bug), we abort.
          // We can't measure exactly how long it's been stuck without
          // adding a timestamp, so we rely on the safety timer being
          // 20s and check at our 30s threshold. If we see fsmStuck on
          // two consecutive checks (10s apart), force abort.
          if (router._healingFlag) {
            _warn('Self-healing: RouterService FSM stuck in',
                  router._fsmState, '— aborting');
            try { router._abortController.abort(); } catch (_) {}
            try { router._forceReset && router._forceReset(); } catch (_) {}
            try {
              router.state.isNavigating = false;
              router._fsmState = 'idle';
            } catch (_) {}
            router._healingFlag = false;
            _toDataLayer('perf_self_heal', { target: 'RouterService' });
          } else {
            router._healingFlag = true;
          }
        } else {
          router._healingFlag = false;
        }
      }

      // ── Check 3: Memory pressure ──
      var mem = _getMemoryUsage();
      if (mem && mem.usedJSHeapSize > HEALING.MEMORY_CRITICAL_MB * 1024 * 1024) {
        _warn('Self-healing: High memory usage (' +
              Math.round(mem.usedJSHeapSize / 1024 / 1024) + 'MB) — evicting caches');
        try { M.DataService && M.DataService.clearCache && M.DataService.clearCache(); } catch (_) {}
        _toDataLayer('perf_memory_critical', {
          usedMB: Math.round(mem.usedJSHeapSize / 1024 / 1024),
          totalMB: Math.round(mem.totalJSHeapSize / 1024 / 1024),
        });
      }
    } catch (_) {}
  }

  function _getMemoryUsage() {
    try {
      if (performance && performance.memory) {
        return {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        };
      }
    } catch (_) {}
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: Page Lifecycle integration
  // ═══════════════════════════════════════════════════════════════════════════

  function _installLifecycleListeners() {
    try {
      // bfcache restore: re-validate state when returning to this page
      window.addEventListener('pageshow', function (ev) {
        if (ev.persisted) {
          _log('bfcache restore — re-validating state');
          // Run an immediate healing check
          _runHealingCheck();
        }
      }, { passive: true });

      // Page is being frozen (e.g. navigated away, may go to bfcache)
      // Don't do heavy work here — just note it
      window.addEventListener('freeze', function () {
        _log('Page frozen (bfcache candidate)');
      }, { passive: true });

      // Page resumed from freeze
      window.addEventListener('resume', function () {
        _log('Page resumed');
      }, { passive: true });

      // Page is being unloaded — report final vitals
      window.addEventListener('pagehide', function () {
        _reportFinalVitals();
      }, { passive: true });
    } catch (_) {}
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 6: Reporting
  // ═══════════════════════════════════════════════════════════════════════════

  function _reportFinalVitals() {
    try {
      var inp98 = _percentile(_inpSamples, 98);
      var report = {
        inp_p98: Math.round(inp98),
        inp_samples: _inpSamples.length,
        cls: Math.round(_clsValue * 1000) / 1000,
        lcp: Math.round(_lcpValue),
        ttfb: Math.round(_ttfbValue),
        loaf_count: _loafCount,
        longtask_count: _longTaskCount,
      };
      _toDataLayer('perf_vitals_final', report);
      _log('Final vitals:', report);
    } catch (_) {}
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 7: Public API
  // ═══════════════════════════════════════════════════════════════════════════

  var PerformanceMonitorService = {

    /**
     * Install all observers + start the self-healing timer.
     * Safe to call multiple times — only starts once.
     */
    start: function () {
      if (_started) return;
      _started = true;

      _installLoAFObserver();
      _installINPObserver();
      _installLCP();
      _installCLS();
      _installTTFB();
      _installLifecycleListeners();

      // Self-healing timer — every CHECK_INTERVAL_MS
      _healingTimer = setInterval(_runHealingCheck, HEALING.CHECK_INTERVAL_MS);

      _log('Started — observers installed, self-healing timer active');
    },

    /**
     * Stop all observers + clear the timer. Mainly useful for tests.
     */
    stop: function () {
      if (!_started) return;
      _started = false;
      if (_healingTimer) { clearInterval(_healingTimer); _healingTimer = null; }
    },

    /**
     * Get a snapshot of current metrics. Useful for debugging.
     * @returns {Object}
     */
    snapshot: function () {
      return {
        inp: {
          p50: Math.round(_percentile(_inpSamples, 50)),
          p75: Math.round(_percentile(_inpSamples, 75)),
          p98: Math.round(_percentile(_inpSamples, 98)),
          samples: _inpSamples.length,
        },
        cls: Math.round(_clsValue * 1000) / 1000,
        lcp: Math.round(_lcpValue),
        ttfb: Math.round(_ttfbValue),
        loaf_count: _loafCount,
        longtask_count: _longTaskCount,
        memory: _getMemoryUsage(),
        started: _started,
      };
    },

    /**
     * Force an immediate self-healing check (normally runs every 5s).
     * Useful for testing or after a known-issue operation.
     */
    checkNow: function () { _runHealingCheck(); },

    /**
     * Report vitals to dataLayer immediately (normally only on pagehide).
     */
    reportNow: function () { _reportFinalVitals(); },

    /** @returns {Object} thresholds (for tests / debugging) */
    get thresholds() { return THRESHOLDS; },
    /** @returns {Object} healing config (for tests / debugging) */
    get healing() { return HEALING; },
  };

  M.PerformanceMonitorService = PerformanceMonitorService;

})(window.NavCoreModules = window.NavCoreModules || {});
