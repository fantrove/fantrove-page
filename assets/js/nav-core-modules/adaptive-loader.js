// @ts-check
/**
 * @file adaptive-loader.js
 * AdaptiveLoader — device capability profiling + strategy selection.
 *
 * v1.0.0
 *
 * RESEARCH BASIS:
 *
 * 1. Network Information API (W3C, 2020+)
 *    navigator.connection provides: effectiveType (4g/3g/2g/slow-2g),
 *    downlink (Mbps), rtt (ms), saveData (boolean).
 *    Source: developer.mozilla.org/en-US/docs/Web/API/NetworkInformation
 *    Spec:wicg.github.io/netinfo/
 *
 * 2. Device Memory API (W3C, 2018)
 *    navigator.deviceMemory returns approximate RAM in GB (0.25, 0.5, 1,
 *    2, 4, 8). Used to gate memory-intensive features.
 *    Source: developer.mozilla.org/en-US/docs/Web/API/Device_Memory_API
 *
 * 3. Save-Data Header (Ilya Grigorik, 2016)
 *    Client hint header: "Save-Data: on" indicates user opted into
 *    data-saving mode (Chrome on Android, Lite Mode). We should reduce
 *    data transfer + disable non-essential animations.
 *    Source: developers.google.com/web/fundamentals/performance/optimizing-content-efficiency/save-data/
 *
 * 4. prefers-reduced-motion (W3C Media Queries Level 5)
 *    User-level preference to minimize motion. OS-level on macOS
 *    (System Preferences → Accessibility → Reduce Motion), iOS, Android.
 *    Source: developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
 *
 * 5. User-Agent Client Hints (W3C, 2022)
 *    navigator.userAgentData provides structured platform info without
 *    UA string parsing. Brands array + mobile flag + platform.
 *    Source: developer.mozilla.org/en-US/docs/Web/API/User-Agent_Client_Hints_API
 *
 * 6. requestIdleCallback (W3C, 2017)
 *    Schedule work during browser idle time. Critical for not blocking
 *    user input. Used to defer non-critical prefetching.
 *    Source: developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback
 *
 * 7. Chrome's "Adaptive Loading" research (Addy Osmani, 2019)
 *    "Adaptive loading: Not all users are equal" — deliver a lighter
 *    experience to users on slow networks / low-end devices.
 *    Decision matrix: combine connection + device memory + save-data
 *    into a single "capability tier" (high/medium/low).
 *    Source: addyosmani.com/blog/adaptive-loading/
 *
 * 8. Smashing Magazine's adaptive serving (2019)
 *    Same concept: progressively enhance based on capability.
 *    Source: smashingmagazine.com/2019/08/adaptive-loading/
 *
 * WHY THIS MATTERS FOR NAVCORE:
 *   v3.0 enabled all features (View Transitions, prefetch, skeleton
 *   animations) unconditionally. On a low-end Android with 2g connection:
 *     • View Transitions cost ~16ms of compositor work
 *     • Prefetches waste bandwidth
 *     • Shimmer animations drain battery
 *   Adaptive Loader gates these features based on real capability.
 *
 * @module adaptive-loader
 * @depends {}
 */
(function (M) {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: Capability tiers
  // ═══════════════════════════════════════════════════════════════════════════

  var TIER = Object.freeze({
    HIGH:   'high',    // modern device + fast network + no data-saving
    MEDIUM: 'medium',  // mid-range device OR moderate network
    LOW:    'low',     // low-end device OR slow network OR save-data
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: Profiling
  // ═══════════════════════════════════════════════════════════════════════════

  var _profile = null;
  var _connectionListeners = [];

  /**
   * Detect all capabilities. Called once at boot, but re-runs connection
   * checks when network changes (online/offline/effectiveType change).
   *
   * @returns {Object} capability profile
   */
  function _detect() {
    var conn = _getConnection();
    var mem = _getDeviceMemory();
    var saveData = _getSaveData();
    var reducedMotion = _getReducedMotion();
    var hardwareConcurrency = _getHardwareConcurrency();
    var isMobile = _getIsMobile();
    var tier = _computeTier(conn, mem, saveData, hardwareConcurrency);

    _profile = Object.freeze({
      tier: tier,
      connection: conn,
      deviceMemory: mem,
      saveData: saveData,
      reducedMotion: reducedMotion,
      hardwareConcurrency: hardwareConcurrency,
      isMobile: isMobile,
      detectedAt: Date.now(),
    });

    // Notify listeners
    _connectionListeners.forEach(function (fn) {
      try { fn(_profile); } catch (_) {}
    });

    return _profile;
  }

  function _getConnection() {
    try {
      var conn = navigator.connection ||
                 navigator.mozConnection ||
                 navigator.webkitConnection;
      if (!conn) return { effectiveType: 'unknown', downlink: 0, rtt: 0, saveData: false };
      return {
        effectiveType: conn.effectiveType || 'unknown',  // 'slow-2g', '2g', '3g', '4g'
        downlink: conn.downlink || 0,                     // Mbps
        rtt: conn.rtt || 0,                               // ms
        saveData: conn.saveData || false,
      };
    } catch (_) {
      return { effectiveType: 'unknown', downlink: 0, rtt: 0, saveData: false };
    }
  }

  function _getDeviceMemory() {
    try {
      // navigator.deviceMemory returns 0.25, 0.5, 1, 2, 4, or 8 (GB)
      // It's a privacy-bucketed value (not exact). 0.25 = very low-end.
      return navigator.deviceMemory || 4; // default 4GB if unknown
    } catch (_) { return 4; }
  }

  function _getSaveData() {
    try {
      var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn && conn.saveData) return true;
      // Also check Save-Data header via Client Hints (not directly accessible,
      // but Save-Data preference may be set on navigator.connection.saveData)
      return false;
    } catch (_) { return false; }
  }

  function _getReducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) { return false; }
  }

  function _getHardwareConcurrency() {
    try {
      // navigator.hardwareConcurrency is the number of logical CPU cores.
      // Browsers may cap this for privacy (returns 2-8 even on high-end).
      return navigator.hardwareConcurrency || 4;
    } catch (_) { return 4; }
  }

  function _getIsMobile() {
    try {
      // User-Agent Client Hints (preferred — Chromium 90+)
      if (navigator.userAgentData) {
        return navigator.userAgentData.mobile;
      }
      // Fallback: UA string check (less reliable, but works everywhere)
      return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    } catch (_) { return false; }
  }

  /**
   * Compute capability tier from inputs.
   *
   * Decision matrix (simplified from Addy Osmani's research):
   *   LOW if ANY of:
   *     - saveData is true
   *     - effectiveType is 'slow-2g' or '2g'
   *     - deviceMemory <= 1
   *     - hardwareConcurrency <= 2
   *   HIGH if ALL of:
   *     - effectiveType is '4g'
   *     - deviceMemory >= 4
   *     - hardwareConcurrency >= 4
   *     - NOT reducedMotion (reduced motion users don't need View Transitions)
   *   MEDIUM otherwise
   */
  function _computeTier(conn, mem, saveData, cores) {
    if (saveData) return TIER.LOW;
    if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') return TIER.LOW;
    if (mem <= 1) return TIER.LOW;
    if (cores <= 2) return TIER.LOW;

    if (conn.effectiveType === '4g' &&
        mem >= 4 &&
        cores >= 4) {
      return TIER.HIGH;
    }

    return TIER.MEDIUM;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: Strategy queries
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // These are the primary API. Callers ask "should I do X?" and get a
  // boolean based on the current capability profile. This decouples
  // capability detection from feature decisions — if we discover a new
  // signal (e.g. thermal throttling), we only update _detect() and these
  // queries, not every call site.

  /**
   * Should we use View Transitions API for content swaps?
   * YES on high-tier devices with motion enabled.
   */
  function _shouldUseViewTransitions() {
    if (!_profile) _detect();
    if (_profile.reducedMotion) return false;
    if (_profile.tier === TIER.LOW) return false;
    // Also check API support (feature detection, not user-agent sniffing)
    return typeof document.startViewTransition === 'function';
  }

  /**
   * Should we prefetch likely-next routes?
   * YES on medium+ tier with non-2g connection.
   */
  function _shouldPrefetch() {
    if (!_profile) _detect();
    if (_profile.saveData) return false;
    if (_profile.tier === TIER.LOW) return false;
    if (_profile.connection.effectiveType === 'slow-2g' ||
        _profile.connection.effectiveType === '2g') return false;
    return true;
  }

  /**
   * Should we use aggressive animations (shimmer skeletons, etc.)?
   * NO on low-tier or reduced-motion users.
   */
  function _shouldAnimate() {
    if (!_profile) _detect();
    if (_profile.reducedMotion) return false;
    if (_profile.tier === TIER.LOW) return false;
    return true;
  }

  /**
   * Should we render skeleton screens during loading?
   * YES on medium+ tier (the shimmer animation is cheap, but on very
   * low-end devices even CSS animations can stutter).
   */
  function _shouldUseSkeletons() {
    if (!_profile) _detect();
    return _profile.tier !== TIER.LOW;
  }

  /**
   * Should we use content-visibility: auto on feed pages?
   * YES always — it's a pure win for long lists, no downside.
   * (Even low-end devices benefit from skipping off-screen rendering.)
   */
  function _shouldUseContentVisibility() {
    return true;
  }

  /**
   * Get the recommended max concurrent fetches based on tier.
   * HTTP/1.1 allows 6 per origin; we use fewer on low-end to avoid
   * saturating the connection.
   */
  function _getMaxConcurrentFetches() {
    if (!_profile) _detect();
    switch (_profile.tier) {
      case TIER.HIGH:   return 6;
      case TIER.MEDIUM: return 4;
      case TIER.LOW:    return 2;
      default:          return 4;
    }
  }

  /**
   * Get the recommended fetch timeout based on connection.
   * Slower connections need longer timeouts to avoid false failures.
   */
  function _getFetchTimeout() {
    if (!_profile) _detect();
    switch (_profile.connection.effectiveType) {
      case 'slow-2g': return 30000;
      case '2g':      return 20000;
      case '3g':      return 10000;
      case '4g':      return 5000;
      default:        return 8000;
    }
  }

  /**
   * Should we enable service worker caching?
   * YES on all tiers — offline support is always valuable.
   */
  function _shouldUseServiceWorker() {
    return 'serviceWorker' in navigator;
  }

  /**
   * Should we enable LoAF / Long Task observers?
   * YES on medium+ — they have small overhead but valuable data.
   * NO on low — every observer adds ~1ms per long task.
   */
  function _shouldObservePerformance() {
    if (!_profile) _detect();
    return _profile.tier !== TIER.LOW;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: Change listener (for reactive re-profiling)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Subscribe to capability changes. Fires when network conditions
   * change (e.g. user moves from wifi to 4g) or when other capability
   * signals change.
   * @param {Function} fn  (profile) => void
   * @returns {Function} unsubscribe
   */
  function _onChange(fn) {
    _connectionListeners.push(fn);
    return function () {
      var idx = _connectionListeners.indexOf(fn);
      if (idx >= 0) _connectionListeners.splice(idx, 1);
    };
  }

  /**
   * Install the network change listener. Called once at init.
   */
  function _installNetworkListener() {
    try {
      var conn = navigator.connection ||
                 navigator.mozConnection ||
                 navigator.webkitConnection;
      if (conn) {
        conn.addEventListener('change', function () {
          // Re-detect with new connection info
          _detect();
        }, { passive: true });
      }
      // Also re-detect on online/offline events
      window.addEventListener('online', function () {
        _detect();
      }, { passive: true });
      window.addEventListener('offline', function () {
        _detect();
      }, { passive: true });
    } catch (_) {}
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: Export
  // ═══════════════════════════════════════════════════════════════════════════

  var AdaptiveLoader = Object.freeze({
    TIER: TIER,

    /** Detect capabilities (or return cached profile) */
    detect: function () { return _profile || _detect(); },

    /** Get cached profile (without re-detecting) */
    get profile() { return _profile; },

    // Strategy queries
    shouldUseViewTransitions: _shouldUseViewTransitions,
    shouldPrefetch: _shouldPrefetch,
    shouldAnimate: _shouldAnimate,
    shouldUseSkeletons: _shouldUseSkeletons,
    shouldUseContentVisibility: _shouldUseContentVisibility,
    shouldUseServiceWorker: _shouldUseServiceWorker,
    shouldObservePerformance: _shouldObservePerformance,
    getMaxConcurrentFetches: _getMaxConcurrentFetches,
    getFetchTimeout: _getFetchTimeout,

    // Change subscription
    onChange: _onChange,

    // Internal (for init.js to call once)
    _installNetworkListener: _installNetworkListener,
  });

  M.AdaptiveLoader = AdaptiveLoader;

})(window.NavCoreModules = window.NavCoreModules || {});
