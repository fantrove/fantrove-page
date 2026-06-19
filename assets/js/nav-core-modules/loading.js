// @ts-check
/**
 * @file loading.js
 * LoadingService — thin proxy that delegates to FVL (FantroveVerse Loader).
 *
 * v1.7.1 — "No-delay, always-consistent" architecture
 *
 * Key principles (v1.7.1):
 *   1. NO SMART DELAY — overlay shows immediately on show()
 *   2. NO MIN DISPLAY TIME — overlay hides immediately on hide() when no sessions remain
 *   3. State is ALWAYS reconciled against FVL's actual state, not our cached _visible
 *   4. Every show() is forwarded to FVL.show() — FVL's idempotent handling takes care of duplicates
 *   5. Every hide() is forwarded to FVL.hide() when sessionCount=0
 *
 * The previous v1.0.3 design used a cached `_visible` flag and `_hideDeferTimer` to
 * enforce minimum display time. This caused state-vs-DOM desync under rapid clicking:
 *   - LoadingService thinks `_visible=true`, but FVL already removed the DOM
 *   - `_reconcile` skips calling FVL.show() because it trusts the cached flag
 *   - Result: overlay never re-appears, even when sessions are open
 *
 * The v1.7.1 design eliminates the cached flag entirely. Every call checks FVL's
 * actual state via `FVL.isActive(id)` and forwards show/hide accordingly.
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
      s.src = base + '/loading-system/fvl.js';
      s.async = false;
      document.head.appendChild(s);
      return true;
    } catch (_) { return false; }
  }

  // ── LoadingService (proxy to FVL fullscreen mode) ─────────────────────────
  //
  // v1.7.1 Architecture: "Direct forward, no cache"
  // ────────────────────────────────────────────────
  // The previous design used cached state (_visible, _hideDeferTimer) and
  // a session counter. Under rapid clicking, the cached state could drift
  // from FVL's actual state, causing the overlay to get stuck.
  //
  // The new design is dead simple:
  //   - show(): if FVL doesn't have an active instance → call FVL.show()
  //             (FVL's show() is idempotent — handles re-show from 'hiding' state)
  //   - hide(): if no sessions remain → call FVL.hide() directly
  //   - No cached _visible flag, no defer timer, no minimum display time.
  //
  // This is "no-delay" as requested — overlay shows and hides immediately
  // based on actual FVL state, which is always consistent with the DOM.

  var LoadingService = {

    /** Content container ID — read by ContentService (kept for compat) */
    LOADING_CONTAINER_ID: 'content-loading',

    /** @type {HTMLElement|null} cached overlay element reference */
    _el: null,

    /** Navigation session counter — show() increments, hide() decrements */
    _sessionCount: 0,

    /** Last options passed to show() — used to update message if overlay already visible */
    _lastOpts: null,

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

    /**
     * Show the loading overlay (open a navigation session).
     *
     * Behavior:
     *   1. Increment session counter
     *   2. If FVL doesn't currently have an active overlay → call FVL.show()
     *      (FVL handles idempotency — calling show() while 'shown' just updates message,
     *       calling show() while 'hiding' cancels the hide and re-shows)
     *   3. If FVL already has an active overlay → just update message if changed
     *
     * NO DELAY. The overlay shows immediately on first show() call.
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

      // Normalize opts
      var o = (typeof opts === 'string') ? { message: opts } : (opts || {});
      o.mode = 'fullscreen';
      o.id = o.id || DEFAULT_ID;
      if (o.zIndex == null) o.zIndex = NAV_BEHIND_Z;
      this._lastOpts = o;

      // Forward to FVL — FVL.show() is idempotent and handles all state transitions:
      //   - If no instance exists → creates one and shows it
      //   - If instance is 'shown' or 'showing' → updates message, returns existing handle
      //   - If instance is 'hiding' → cancels hide, restores 'shown' state, returns handle
      //   - If instance is 'hidden' → creates new instance and shows it
      var handle = fvl.show(o);
      if (handle) {
        this._el = handle.element;
      }
      return handle;
    },

    /**
     * Hide the loading overlay (close one navigation session).
     *
     * Behavior:
     *   1. Decrement session counter (never below 0)
     *   2. If counter > 0 → do nothing (other sessions still active)
     *   3. If counter = 0 → call FVL.hide() immediately
     *
     * NO MIN DISPLAY TIME. The overlay hides immediately when the last session closes.
     */
    hide: function () {
      // Decrement session counter (never below 0)
      if (this._sessionCount > 0) this._sessionCount--;

      // If there are still open sessions, don't hide
      if (this._sessionCount > 0) {
        return Promise.resolve();
      }

      // All sessions closed — hide immediately
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
     * Returns true if there are open sessions OR FVL has an active overlay.
     * This dual check ensures we never report "not shown" while the overlay
     * is actually visible (or vice versa).
     *
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

    // Aliases for call-site compatibility
    showInContent: function (opts) { return this.show(opts); },
    hideFromContent: function ()   { return this.hide(); },

    // ── Emergency reset (used by safety timeout in router) ────────────────
    // Forces session count to 0 and hides overlay immediately.
    _forceReset: function () {
      this._sessionCount = 0;
      var fvl = _fvl();
      if (fvl) fvl.hide(DEFAULT_ID);
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
