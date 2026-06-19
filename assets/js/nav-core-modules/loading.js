// @ts-check
/**
 * @file loading.js
 * LoadingService — thin proxy that delegates to FVL (FantroveVerse Loader).
 *
 * ⚠️  This file is now a BACKWARD-COMPAT shim. The real implementation lives in
 *     /assets/js/loading-system/fvl.js (FVL v1.0.0+).
 *
 * Why this file still exists:
 *   • Nav-Core's PHASES loader (see nav-core.js) lists `loading.js` in Phase 3.
 *     Removing it would break the load order. Keeping it as a thin proxy means
 *     Nav-Core keeps working unchanged.
 *   • Other Nav-Core modules call `M.LoadingService.show()/hide()`. This proxy
 *     preserves that surface and forwards every call to FVL fullscreen mode.
 *   • Legacy globals (`window.showInstantLoadingOverlay`,
 *     `window.removeInstantLoadingOverlay`, `window._navCore_contentLoadingManager`,
 *     `window._headerV2_contentLoadingManager`, `window.__removeInstantLoadingOverlay`)
 *     are all installed by FVL's compat layer at boot — so they work even before
 *     Nav-Core's Phase 3 runs.
 *
 * Migration path:
 *   • Direct callers can switch to `FVL.show(...)` / `FVL.hide(...)` for the new
 *     4-mode API (fullscreen / scoped / inline / topbar).
 *   • See /fantrove-docs/07-Loading-System-FVL.md for the full FVL API.
 *
 * @module loading
 * @depends {config.js, state.js, fvl.js (loaded separately)}
 */
(function (M) {
  'use strict';

  var DEFAULT_ID = 'fvl-default-fullscreen';

  // ── Z-index strategy ──────────────────────────────────────────────────────
  // WHY 15999: Bottom nav uses --fv-z-nav (16000). Loading overlay must sit
  // BEHIND the bottom nav so the nav remains visible and clickable while
  // loading is in progress. 15999 = (16000 - 1).
  var NAV_BEHIND_Z = 15999;

  // ── Minimum display time ──────────────────────────────────────────────────
  // WHY 250ms: Once the overlay IS visible, hold it for at least 250ms so
  // the user gets clear visual feedback that a transition happened. Without
  // this, ultra-fast loads (<50ms) would cause a 1-frame flash that looks
  // like a rendering glitch rather than an intentional loading state.
  var MIN_DISPLAY_MS = 250;

  // ── FVL availability check ────────────────────────────────────────────────
  function _fvl() {
    return (typeof window !== 'undefined') ? window.FVL : null;
  }

  function _ensureFVL() {
    // If FVL isn't loaded yet (e.g. this file ran before fvl.js), try to
    // load it on demand so the proxy still works.
    if (window.FVL) return true;
    try {
      // Find the script base path the same way nav-core.js does
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
      // Synchronously inject FVL (async=false → blocks until loaded)
      var s = document.createElement('script');
      s.src = base + '/loading-system/fvl.js';
      s.async = false;
      document.head.appendChild(s);
      return true;
    } catch (_) { return false; }
  }

  // ── LoadingService (proxy to FVL fullscreen mode) ─────────────────────────
  //
  // Architecture: "navigation session" pattern
  // ─────────────────────────────────────────────────
  // Each show() call opens a "navigation session" tracked by a counter.
  // Each hide() call closes one session. The overlay is only hidden when
  // ALL sessions are closed. This is critical for rapid-click scenarios:
  //
  //   User clicks Symbols → show() → _sessionCount=1, overlay shown
  //   User clicks Emojis  → show() → _sessionCount=2, overlay stays shown
  //   Symbols nav done    → hide() → _sessionCount=1, overlay stays shown
  //   Emojis nav done     → hide() → _sessionCount=0, overlay hidden
  //
  // Without this pattern, rapid clicking would cause:
  //   show() → hide() → show() → hide() → ... → race conditions
  //   where state and DOM get out of sync, leaving the overlay stuck.
  //
  // The _sessionCount + _reconcile() approach guarantees:
  //   • Overlay always shows when at least one session is open
  //   • Overlay always hides when all sessions close
  //   • No race between show/hide timers

  var LoadingService = {

    /** Content container ID — read by ContentService (kept for compat) */
    LOADING_CONTAINER_ID: 'content-loading',

    /** @type {HTMLElement|null} cached overlay element reference */
    _el: null,

    /** Navigation session counter — increments on show(), decrements on hide() */
    _sessionCount: 0,

    /** Whether the overlay is currently visible (post reconcile) */
    _visible: false,

    /** Timestamp when overlay became visible */
    _visibleSince: 0,

    /** Hide-deferred timer (set when hide arrives too soon after show) */
    _hideDeferTimer: null,

    /**
     * Initialize. Idempotent. Ensures FVL is loaded and ready.
     * Safe to call multiple times.
     */
    init: function () {
      _ensureFVL();
      var fvl = _fvl();
      if (fvl) {
        try { fvl.modules(); } catch (_) {}
      }
    },

    /**
     * Show the loading overlay (open a navigation session).
     *
     * Increments the session counter and reconciles the visual state.
     * If overlay was hidden → show immediately. If overlay was already
     * visible → no visual change, just increment counter.
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

      // Open a new navigation session
      this._sessionCount++;

      // Normalize opts (accept string shorthand)
      var o = (typeof opts === 'string') ? { message: opts } : (opts || {});
      o.mode = 'fullscreen';
      o.id = o.id || DEFAULT_ID;
      if (o.zIndex == null) o.zIndex = NAV_BEHIND_Z;

      // Cancel any pending hide — we want to stay visible
      if (this._hideDeferTimer) {
        clearTimeout(this._hideDeferTimer);
        this._hideDeferTimer = null;
      }

      // Reconcile visual state
      this._reconcile(o);
      return null; // no handle needed for show path
    },

    /**
     * Hide the loading overlay (close one navigation session).
     *
     * Decrements the session counter. Only hides the overlay when ALL
     * sessions are closed (counter reaches 0). This is what makes the
     * system robust against rapid clicking.
     */
    hide: function () {
      // Decrement session counter (never below 0)
      if (this._sessionCount > 0) this._sessionCount--;

      // If there are still open sessions, don't hide
      if (this._sessionCount > 0) {
        return Promise.resolve();
      }

      // All sessions closed — proceed with hide (respecting min display time)
      return this._scheduleHide();
    },

    /**
     * Schedule hide after MIN_DISPLAY_MS if overlay was visible.
     * If overlay was never visible (show came and went before reconciling),
     * hide immediately.
     */
    _scheduleHide: function () {
      var self = this;

      // Already deferred? Wait for existing timer.
      if (this._hideDeferTimer) return Promise.resolve();

      // If overlay is visible, respect minimum display time
      if (this._visible) {
        var elapsed = Date.now() - this._visibleSince;
        if (elapsed < MIN_DISPLAY_MS) {
          var remaining = MIN_DISPLAY_MS - elapsed;
          return new Promise(function (resolve) {
            self._hideDeferTimer = setTimeout(function () {
              self._hideDeferTimer = null;
              self._doHide();
              resolve();
            }, remaining);
          });
        }
      }

      // Hide immediately
      this._doHide();
      return Promise.resolve();
    },

    /**
     * Actually call FVL.hide() and reset visible state.
     */
    _doHide: function () {
      var fvl = _fvl();
      if (!fvl) return;
      this._visible = false;
      fvl.hide(DEFAULT_ID);
    },

    /**
     * Reconcile visual state with session counter.
     * If counter > 0 → overlay should be visible (show if not)
     * If counter = 0 → overlay should be hidden (deferred via _scheduleHide)
     *
     * @param {Object} opts - options to pass to FVL.show() if showing
     */
    _reconcile: function (opts) {
      if (this._sessionCount > 0 && !this._visible) {
        // Need to show
        var fvl = _fvl();
        if (!fvl) return;
        var handle = fvl.show(opts);
        if (handle) {
          this._el = handle.element;
          this._visible = true;
          this._visibleSince = Date.now();
        }
      } else if (this._sessionCount > 0 && this._visible && opts && opts.message !== undefined) {
        // Already visible — update message if provided
        var fvl2 = _fvl();
        if (fvl2) fvl2.update(DEFAULT_ID, { message: opts.message });
      }
    },

    /** @param {string|null} [msg] */
    updateMessage: function (msg) {
      var fvl = _fvl();
      if (!fvl) return;
      fvl.update(DEFAULT_ID, { message: msg });
    },

    /** @returns {boolean} — true if overlay is visible OR a session is open */
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

    // Aliases for call-site compatibility
    showInContent: function (opts) { return this.show(opts); },
    hideFromContent: function ()   { return this.hide(); },

    // ── Emergency reset (used by safety timeout in router) ────────────────
    // Forces session count to 0 and hides overlay immediately.
    _forceReset: function () {
      this._sessionCount = 0;
      if (this._hideDeferTimer) {
        clearTimeout(this._hideDeferTimer);
        this._hideDeferTimer = null;
      }
      this._doHide();
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

  // ── Global convenience aliases (kept for back-compat with external scripts)
  // FVL's compat layer also installs these — but we install them here too as
  // a safety net in case FVL loads after Nav-Core Phase 3.
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
