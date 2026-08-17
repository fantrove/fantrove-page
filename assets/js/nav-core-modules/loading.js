// @ts-check
/**
 * @file loading.js
 * LoadingService — thin proxy that delegates to FVL (FantroveVerse Loader).
 *
 * v2.1 — "Always-show, render-behind-overlay, single-message"
 *
 * Simplified from v2.0 based on user feedback:
 *   • แสดงแค่ข้อความ "กำลังโหลด…" / "Loading…" เท่านั้น
 *   • ไม่มี phase indicators (เช่น "2/4 · Fetching content…")
 *   • ไม่มี topbar progress bar
 *   • ไม่มี sub-message
 *   • เหลือแค่ ring spinner + ข้อความเดียว
 *
 * สิ่งที่ยังคงไว้จาก v2.0:
 *   • ALWAYS-SHOW on every show() call (force-restart + pulse)
 *   • Session counter
 *   • MIN_VISIBLE_MS = 300ms (กัน flash บน cached loads)
 *   • RENDER-BEHIND-OVERLAY pattern (hideInstant รอ 1 rAF ให้ content paint ก่อน)
 *
 * Preserved from v1.7.2:
 *   • NO DELAY — overlay shows immediately on show() call
 *   • FORCE RESTART — show() while visible pulses the spinner
 *   • Direct forward to FVL
 *
 * @module loading
 * @depends {config.js, state.js, fvl.js (loaded separately)}
 */
(function (M) {
  'use strict';

  // ── Build ID (replaced at build time by scripts/update-version.js) ──────────
  // WHY: FVL (loading-system/fvl.js) ไม่ได้อยู่ใน HTML ทุกหน้า
  //   บางหน้า loading.js โหลด FVL เองแบบ dynamic → URL ไม่มี ?v= → ใช้ cache เดิม
  //   FV_BUILD_ID ถูก inject buildId จริงตอน build → ใช้ต่อ ?v= ท้าย URL
  //   dev mode: ค่า '' → _v() คืน '' → URL ไม่มี ?v= → browser cache ปกติ
  var FV_BUILD_ID = '';

  /** คืน query string '?v=<buildId>' ถ้าไม่มี buildId คืน '' */
  function _v() { return FV_BUILD_ID ? '?v=' + FV_BUILD_ID : ''; }

  var DEFAULT_ID = 'fvl-default-fullscreen';

  // ── Z-index strategy ──────────────────────────────────────────────────────
  // WHY 15999: Bottom nav uses --fv-z-nav (16000). Loading overlay must sit
  // BEHIND the bottom nav so the nav remains visible and clickable while
  // loading is in progress. 15999 = (16000 - 1).
  var NAV_BEHIND_Z = 15999;

  // ── Minimum visible time ──────────────────────────────────────────────────
  // WHY 300ms: UX research (NN/g, virtuslab.com) recommends 300-600ms as the
  // sweet spot. 300ms prevents 1-frame flashes on cached loads while still
  // feeling snappy. The overlay shows INSTANTLY on show() — this is only a
  // delay on the FINAL hide.
  var MIN_VISIBLE_MS = 300;

  // ── Single loading message (localized) ─────────────────────────────────────
  // v2.1: แสดงแค่ข้อความเดียว ไม่มี phase indicators
  var LOADING_MESSAGE = Object.freeze({
    en: 'Loading…',
    th: 'กำลังโหลด…',
  });

  // ── FVL availability check ────────────────────────────────────────────────
  function _fvl() {
    return (typeof window !== 'undefined') ? window.FVL : null;
  }

  function _ensureFVL() {
    if (window.FVL) return true;
    try {
      var scripts = document.querySelectorAll('script[src]');
      var base = null;
      for (var i = 0; i < scripts.length; i++) {
        var src = (scripts[i].getAttribute('src') || '').split('?')[0];
        if (/\/nav-core-modules\/loading\.js$/.test(src)) {
          base = src.replace('/nav-core-modules/loading.js', '');
          break;
        }
      }
      if (!base) return false;
      var s = document.createElement('script');
      // WHY _v(): ต่อ ?v=<buildId> เพื่อ cache-bust fvl.js ที่ loading.js โหลดเองแบบ dynamic
      s.src = base + '/loading-system/fvl.js' + _v();
      s.async = false;
      document.head.appendChild(s);
      return true;
    } catch (_) { return false; }
  }

  /**
   * Get the localized loading message.
   * @returns {string}
   */
  function _loadingMessage() {
    var lang = 'en';
    try {
      lang = localStorage.getItem('selectedLang') || 'en';
    } catch (_) {}
    return LOADING_MESSAGE[lang] || LOADING_MESSAGE.en;
  }

  // ── LoadingService ────────────────────────────────────────────────────────

  var LoadingService = {

    /** Content container ID — read by ContentService (kept for compat) */
    LOADING_CONTAINER_ID: 'content-loading',

    /** @type {HTMLElement|null} cached overlay element reference */
    _el: null,

    /** Navigation session counter — show() increments, hide() decrements */
    _sessionCount: 0,

    /** Last options passed to show() — used to update message if overlay already visible */
    _lastOpts: null,

    /** Whether a pulse animation is in progress (prevents overlapping pulses) */
    _pulseInProgress: false,

    /** Timestamp when overlay last became visible (used for MIN_VISIBLE_MS) */
    _visibleSince: 0,

    /** Pending hide timer (set when hide() arrives too soon after show) */
    _pendingHideTimer: null,

    /**
     * Initialize. Idempotent.
     */
    init: function () {
      _ensureFVL();
      var fvl = _fvl();
      if (fvl) {
        try { fvl.modules(); } catch (_) {}
      }
    },

    // ── Phase API (kept for back-compat but no-op visually) ─────────────────
    //
    // v2.1: setPhase() ยังคงไว้เพื่อไม่ให้ code ที่เรียกใช้ (router.js,
    //   content.js, init.js) พัง แต่ไม่เปลี่ยนข้อความที่แสดงผล
    //   ข้อความยังคงเป็น "Loading…" / "กำลังโหลด…" เสมอ
    //
    //   ถ้าต้องการเปิด phase messages ภายหลัง สามารถ uncomment โค้ดด้านล่าง
    //   และใส่ PHASE_MESSAGES + step indicator กลับเข้าไปได้

    /**
     * Set the current loading phase.
     * v2.1: NO-OP visually — just updates internal state.
     * Kept for back-compat with router.js / content.js / init.js that call it.
     *
     * @param {string} phase    One of: 'initializing' | 'fetching' | 'processing' | 'rendering' | 'ready'
     * @param {string} [customMsg] Optional override message (ignored in v2.1)
     */
    setPhase: function (phase, customMsg) {
      // v2.1: NO-OP — แสดงแค่ "Loading…" เสมอ ไม่เปลี่ยนตาม phase
      // เก็บไว้เพื่อ back-compat เท่านั้น
      this._currentPhase = phase || 'initializing';
    },

    /** Internal phase state (kept for debugging) */
    _currentPhase: 'initializing',

    /**
     * Show the loading overlay (open a navigation session).
     *
     * v2.1 behavior:
     *   1. Increment session counter
     *   2. ALWAYS call FVL.show() — idempotent
     *   3. Apply single "Loading…" message (localized)
     *   4. If overlay was already visible, pulse to signal new operation
     *
     * NO DELAY. The overlay shows immediately on every show() call.
     *
     * @param {LoadingOptions} [opts]
     */
    show: function (opts) {
      _ensureFVL();
      var fvl = _fvl();
      if (!fvl) {
        console.warn('[LoadingService] FVL not available, cannot show');
        return;
      }

      // Open a new session
      this._sessionCount++;

      // Normalize opts — v2.1: ใส่ข้อความ "Loading…" เสมอ ไม่รับ message จาก caller
      var o = (typeof opts === 'string') ? { message: opts } : (opts || {});
      o.mode = 'fullscreen';
      o.id = o.id || DEFAULT_ID;
      if (o.zIndex == null) o.zIndex = NAV_BEHIND_Z;
      o.instant = o.instant !== false;       // default true
      o.lockScroll = o.lockScroll !== false; // default true

      // v2.1: แสดงแค่ "Loading…" ไม่รับ message อื่น
      o.message = _loadingMessage();

      this._lastOpts = o;

      // Check if overlay was already active (for pulse decision)
      var wasActive = fvl.isActive(DEFAULT_ID);

      // ALWAYS call FVL.show() — it's idempotent and handles all states
      var handle = fvl.show(o);
      if (handle) {
        this._el = handle.element;
        this._visibleSince = Date.now();
      }

      // If overlay was already visible, pulse to signal new operation
      if (wasActive) {
        this._pulse();
      }

      return handle;
    },

    /**
     * Pulse the overlay: briefly dip opacity + restart spinner animation.
     * (Unchanged from v1.7.2)
     */
    _pulse: function () {
      if (this._pulseInProgress) return;
      if (!this._el) return;

      var el = this._el;
      this._pulseInProgress = true;

      el.classList.add('fvl-pulse');

      var arc = el.querySelector('.fvl-arc');
      if (arc) {
        var clone = arc.cloneNode(true);
        arc.parentNode.replaceChild(clone, arc);
      }

      var self = this;
      setTimeout(function() {
        el.classList.remove('fvl-pulse');
        self._pulseInProgress = false;
      }, 350);
    },

    /**
     * Hide the loading overlay (close one navigation session).
     *
     * Decrements session counter. Only hides the overlay when ALL sessions
     * are closed (counter reaches 0).
     *
     * MIN_VISIBLE_MS: if the overlay was shown less than 300ms ago, defer
     * the hide until the 300ms has elapsed (prevents 1-frame flashes).
     *
     * @returns {Promise<void>}
     */
    hide: function () {
      if (this._sessionCount > 0) this._sessionCount--;

      if (this._sessionCount > 0) {
        return Promise.resolve();
      }

      var elapsed = Date.now() - this._visibleSince;
      if (this._visibleSince > 0 && elapsed < MIN_VISIBLE_MS) {
        var self = this;
        if (this._pendingHideTimer) clearTimeout(this._pendingHideTimer);
        return new Promise(function(resolve) {
          self._pendingHideTimer = setTimeout(function() {
            self._pendingHideTimer = null;
            var fvl = _fvl();
            if (fvl) fvl.hide(DEFAULT_ID);
            resolve();
          }, MIN_VISIBLE_MS - elapsed);
        });
      }

      var fvl = _fvl();
      if (!fvl) return Promise.resolve();
      return fvl.hide(DEFAULT_ID);
    },

    /** @param {string|null} [msg] */
    updateMessage: function (msg) {
      var fvl = _fvl();
      if (!fvl) return;
      fvl.update(DEFAULT_ID, { message: msg });
    },

    /**
     * Check if loading is active.
     * @returns {boolean}
     */
    isShown: function () {
      if (this._sessionCount > 0) return true;
      var fvl = _fvl();
      if (!fvl) return false;
      return fvl.isActive(DEFAULT_ID);
    },

    /** @returns {typeof CONFIG.LOADING_MESSAGES} */
    getMessages: function () {
      var fvl = _fvl();
      if (fvl) return fvl.config().MESSAGES;
      return Object.freeze({
        en: Object.freeze({ loading: 'Loading...' }),
        th: Object.freeze({ loading: 'กำลังโหลด...' }),
      });
    },

    // ── Internal aliases (called by Nav-Core router/init) ──────────────────
    _updateTopVar: function () {
      var fvl = _fvl();
      if (fvl) fvl.modules().Engine._updateTopVar();
    },

    _setTexts: function () {
      var fvl = _fvl();
      if (fvl) fvl.modules().Engine._setTexts(DEFAULT_ID);
    },

    _getEl: function () {
      var fvl = _fvl();
      if (!fvl) return this._el;
      var handle = fvl.get(DEFAULT_ID);
      return handle ? handle.element : this._el;
    },

    /**
     * v2.1: Hide loading แบบ instant — ไม่มี fade-out animation
     *
     * RENDER-BEHIND-OVERLAY PATTERN (Netflix/Spotify/Instagram):
     *   Content is already mounted into the DOM BEFORE hideInstant() is
     *   called. We then:
     *     1. Wait 1 rAF so the browser paints the content under the overlay
     *     2. Remove the overlay instantly (no fade-out)
     *   This eliminates the "blank flash" between hide-loading and
     *   show-content.
     */
    hideInstant: function () {
      if (this._sessionCount > 0) this._sessionCount--;
      if (this._sessionCount > 0) return Promise.resolve();

      this._visibleSince = 0;
      if (this._pendingHideTimer) {
        clearTimeout(this._pendingHideTimer);
        this._pendingHideTimer = null;
      }

      var self = this;
      var fvl = _fvl();
      var inst = null;
      if (fvl) {
        try {
          inst = fvl.modules().State.getInstance(DEFAULT_ID);
        } catch (_) {}
      }

      if (inst && inst.state === 'showing') {
        // Overlay was created but browser hasn't painted it yet.
        // Wait 1 frame so the user sees at least 1 frame of loading,
        // then remove. This prevents content jank from being visible.
        requestAnimationFrame(function () {
          self._removeOverlayNow(fvl);
        });
        return Promise.resolve();
      }

      // v2.0: Wait 1 rAF before removing overlay so any pending content
      // mount (which happened just before hideInstant() was called) gets
      // painted by the browser FIRST. Then the overlay is removed,
      // revealing the already-painted content underneath.
      //
      // This is the "render behind overlay" pattern: content paints under
      // the overlay, then overlay disappears — user sees smooth transition
      // from loading → content with no blank frame.
      requestAnimationFrame(function () {
        self._removeOverlayNow(fvl);
      });
      return Promise.resolve();
    },

    /**
     * v4: Internal — actually remove overlay DOM + FVL instance.
     * (Preserved from v1.7.2 with scroll-lock restore fix)
     */
    _removeOverlayNow: function (fvl) {
      if (!fvl) fvl = _fvl();

      var inst = null;
      if (fvl) {
        try { inst = fvl.modules().State.getInstance(DEFAULT_ID); } catch (_) {}
      }
      if (inst && inst.mode === 'fullscreen' && inst._lockedScrollY != null) {
        try {
          document.body.style.position = '';
          document.body.style.top      = '';
          document.body.style.width    = '';
          window.scrollTo(0, inst._lockedScrollY);
          inst._lockedScrollY = null;
        } catch (_) {}
      } else {
        try {
          if (document.body.style.position === 'fixed') {
            document.body.style.position = '';
            document.body.style.top      = '';
            document.body.style.width    = '';
          }
        } catch (_) {}
      }

      if (this._el) {
        try {
          if (this._el.parentNode) this._el.parentNode.removeChild(this._el);
        } catch (_) {}
        this._el = null;
      }
      if (fvl && inst) {
        try {
          inst.state = 'destroyed';
          fvl.modules().State.removeInstance(DEFAULT_ID);
        } catch (_) {}
      }
    },
    showInContent: function (opts) { return this.show(opts); },
    hideFromContent: function ()   { return this.hide(); },

    // ── Emergency reset (used at start of each navigateTo) ───────────────
    // (Preserved from v1.7.2)
    _forceReset: function () {
      this._sessionCount = 0;
      this._pulseInProgress = false;
      this._visibleSince = 0;
      this._currentPhase = 'initializing';
      if (this._pendingHideTimer) {
        clearTimeout(this._pendingHideTimer);
        this._pendingHideTimer = null;
      }
      // Remove fullscreen overlay
      if (this._el) {
        try {
          if (this._el.parentNode) this._el.parentNode.removeChild(this._el);
        } catch (_) {}
        this._el = null;
      }
      var fvl = _fvl();
      if (fvl) {
        try {
          var modules = fvl.modules();
          var inst = modules.State.getInstance(DEFAULT_ID);
          if (inst) {
            if (inst.mode === 'fullscreen' && inst._lockedScrollY != null) {
              try {
                document.body.style.position = '';
                document.body.style.top = '';
                document.body.style.width = '';
                window.scrollTo(0, inst._lockedScrollY);
              } catch (_) {}
            }
            inst.state = 'destroyed';
            modules.State.removeInstance(DEFAULT_ID);
          }
        } catch (_) {
          try { fvl.hide(DEFAULT_ID); } catch (__) {}
        }
      }
    },

    /** Get current phase. Useful for debugging. */
    getCurrentPhase: function () {
      return this._currentPhase;
    },
  };

  // ── Auto-init ──────────────────────────────────────────────────────────────

  function _autoInit() { LoadingService.init(); }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', _autoInit, { once: true });
  else
    _autoInit();

  // ── Export into NavCoreModules namespace ──────────────────────────────────

  M.LoadingService = LoadingService;

  // ── Global convenience aliases (kept for back-compat with external scripts) ──
  try {
    if (!window._navCore_contentLoadingManager)
      window._navCore_contentLoadingManager = LoadingService;
    if (!window._headerV2_contentLoadingManager)
      window._headerV2_contentLoadingManager = LoadingService;
    if (!window.showInstantLoadingOverlay)
      window.showInstantLoadingOverlay = function (opts) { return LoadingService.show(opts); };
    if (!window.removeInstantLoadingOverlay)
      window.removeInstantLoadingOverlay = function () { return LoadingService.hide(); };
    if (!window.__removeInstantLoadingOverlay)
      window.__removeInstantLoadingOverlay = function () { return LoadingService.hide(); };
  } catch (_) {}

})(window.NavCoreModules = window.NavCoreModules || {});
