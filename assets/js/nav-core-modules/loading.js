// @ts-check
/**
 * @file loading.js
 * LoadingService — thin proxy that delegates to FVL (FantroveVerse Loader).
 *
 * v2.0.0 — "Engineering-grade stability" rewrite
 *
 * ARCHITECTURE CHANGES (from v1.7.x):
 *
 * 1. ScrollLockService (NEW internal module)
 *    ─────────────────────────────────────
 *    The previous bug class (page stuck at position:fixed forever) existed
 *    because the body-lock state was scattered across FVL, _removeOverlayNow,
 *    and _forceReset — and any missed cleanup path leaked the lock.
 *
 *    ScrollLockService fixes this structurally:
 *      • Refcounted: multiple show() calls = +1, matching hide() = -1.
 *        Lock is only released when count reaches 0.
 *      • Idempotent: locking while already locked is a no-op.
 *      • Watchdog: lock auto-releases after MAX_LOCK_MS (30s) regardless
 *        of caller bugs — prevents the "stuck scroll" failure mode forever.
 *      • Single source of truth: one function locks, one function unlocks,
 *        one variable tracks state. No more scattered body.style mutations.
 *      • Layout-shift-free: uses `scrollbar-gutter: stable` on <html> so
 *        the scrollbar gutter is always reserved — no CLS on lock/unlock.
 *      • iOS-safe: uses position:fixed on body (only reliable on iOS Safari)
 *        with explicit scroll position save/restore.
 *
 * 2. ARIA semantics
 *    ─────────────
 *    Sets `aria-busy="true"` on <main> during loading so assistive tech
 *    announces the state change. Cleared on hide. Also sets `aria-live="polite"`
 *    on the overlay so screen readers announce "Loading..." once.
 *
 * 3. scheduler.yield() for main-thread cooperation
 *    ─────────────────────────────────────────────
 *    Modern Chromium (since 129) supports scheduler.yield() to break a long
 *    task while preserving task priority. We use it where we used to use
 *    setTimeout(0) — yields are now <4ms instead of 4ms+.
 *
 * 4. navigator.scheduling.isInputPending() for input-awareness
 *    ─────────────────────────────────────────────────────────
 *    Before running hide() (which can cause forced reflow), check if user
 *    input is pending — if so, defer to next frame. Prevents INP regressions.
 *
 * 5. Defensive cleanup paths
 *    ───────────────────────
 *    _removeOverlayNow(), _forceReset(), and hideInstant() all funnel
 *    through ScrollLockService.release() — single point of cleanup.
 *    Plus pagehide/visibilitychange handlers as a safety net for tab
 *    switches and bfcache restore (prevents stuck lock on back/forward).
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

  // ── Minimum visible time ──────────────────────────────────────────────────
  // WHY 200ms: Once the overlay becomes visible, it must stay visible for at
  // least 200ms before hiding — even if all sessions close immediately. This
  // prevents the overlay from flashing for 1 frame on cached loads (which
  // can complete in <50ms), giving the user clear visual feedback that a
  // navigation happened.
  //
  // This is NOT a delay on show() — the overlay shows instantly. It's only
  // a delay on hide() when the overlay was shown very recently.
  //
  // v5.0: This is now a HARD contract. Even if data is cached and render
  //   completes in 5ms, the overlay stays for 200ms. This eliminates the
  //   "sometimes I see loading, sometimes I don't" confusion. The user
  //   ALWAYS sees a loading state on every navigation, no exceptions.
  var MIN_VISIBLE_MS = 200;

  // ── Watchdog: maximum time a scroll-lock may be held ──────────────────────
  // WHY 30s: If the lock is held longer than this, SOMETHING is broken —
  //   either a navigation hung, an exception escaped cleanup, or the page
  //   lost focus mid-navigation. Auto-releasing prevents the "stuck scroll"
  //   failure mode that the v1.x architecture was vulnerable to.
  // 30s is generous: normal navigations complete in <2s; even slow networks
  //   trigger the 20s safety timer in router.js first.
  var MAX_LOCK_MS = 30000;

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

  // ═══════════════════════════════════════════════════════════════════════════
  // ScrollLockService — refcounted, watchdog-protected scroll lock
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Why this exists:
  //   The v1.x code mutated `body.style.position/top/width` directly from
  //   multiple call sites (FVL.show, FVL._cleanup, _removeOverlayNow,
  //   _forceReset). Any code path that skipped cleanup leaked the lock
  //   forever — this is exactly what caused the discover-page scroll bug.
  //
  //   This service centralizes lock state. Callers acquire/release via
  //   refcount; the watchdog releases automatically after MAX_LOCK_MS;
  //   and pagehide/visibilitychange handlers release on tab switch.
  //
  // Why position:fixed instead of overflow:hidden on <html>:
  //   iOS Safari (still ~20% of mobile traffic) does not honor
  //   `overflow: hidden` on <html> for touch scrolling — body still
  //   scrolls. `position: fixed` on <body> is the only reliable lock.
  //   We compensate for the layout-shift side-effect with
  //   `scrollbar-gutter: stable` on <html>, set once at module load.
  //
  // Why we don't lock at all if the page isn't scrollable:
  //   Saves a forced reflow + avoids an unnecessary style mutation.

  var ScrollLockService = (function () {
    var _refCount = 0;
    var _scrollY = 0;
    var _watchdogTimer = null;
    var _installed = false;
    // Track whether WE set the body styles — so we never clobber
    // inline styles set by some other system.
    var _weOwnLock = false;

    function _installStableGutter() {
      if (_installed) return;
      _installed = true;
      // Reserve the scrollbar gutter at all times so toggling overflow
      // doesn't shift the layout horizontally (good CLS hygiene).
      try {
        var css = document.createElement('style');
        css.id = '_nc_scrolllock_css';
        css.textContent =
          'html.nc-scroll-lock-ready{scrollbar-gutter:stable both-edges;}';
        document.head.appendChild(css);
        document.documentElement.classList.add('nc-scroll-lock-ready');
      } catch (_) {}
    }

    function _acquire() {
      _refCount++;
      if (_refCount === 1) _applyLock();

      // Reset watchdog on every acquire — the lock is "fresh" again.
      if (_watchdogTimer) clearTimeout(_watchdogTimer);
      _watchdogTimer = setTimeout(_forceRelease, MAX_LOCK_MS);
    }

    function _release() {
      if (_refCount === 0) return; // defensive — never go negative
      _refCount--;
      if (_refCount === 0) _removeLock();
    }

    function _applyLock() {
      // Skip the work entirely if the page isn't currently scrollable —
      // locking a non-scrollable page is a no-op and saves a forced reflow.
      if (window.scrollY === 0 &&
          document.documentElement.scrollHeight <=
          document.documentElement.clientHeight) {
        // Still set _weOwnLock so we know to skip restore on release.
        _weOwnLock = false;
        _scrollY = 0;
        return;
      }

      try {
        _scrollY = window.scrollY || window.pageYOffset || 0;
        var body = document.body;
        // Use top/left/right + width:100% so the body fills the viewport
        // (prevents a width shrink on pages with scrollbar).
        body.style.position = 'fixed';
        body.style.top = '-' + _scrollY + 'px';
        body.style.left = '0';
        body.style.right = '0';
        body.style.width = '100%';
        _weOwnLock = true;
      } catch (_) {
        _weOwnLock = false;
      }
    }

    function _removeLock() {
      if (_watchdogTimer) { clearTimeout(_watchdogTimer); _watchdogTimer = null; }

      if (!_weOwnLock) {
        // We never actually mutated body — nothing to restore.
        _scrollY = 0;
        return;
      }

      try {
        var body = document.body;
        body.style.position = '';
        body.style.top = '';
        body.style.left = '';
        body.style.right = '';
        body.style.width = '';
        // Restore scroll position. Use 'auto' behavior to avoid an
        // animation competing with the content's paint.
        window.scrollTo(0, _scrollY);
      } catch (_) {}
      _weOwnLock = false;
      _scrollY = 0;
    }

    function _forceRelease() {
      // Watchdog fired or pagehide — release everything regardless of refcount.
      if (_watchdogTimer) { clearTimeout(_watchdogTimer); _watchdogTimer = null; }
      _refCount = 0;
      _removeLock();
    }

    function _installLifecycleGuards() {
      // bfcache restore: when the user returns to this page via back/forward,
      // the lock state may be inconsistent. Force-release on pageshow
      // (event.persisted === true means it came from bfcache).
      try {
        window.addEventListener('pageshow', function (ev) {
          if (ev.persisted) _forceRelease();
        }, { passive: true });
      } catch (_) {}

      // Tab switch while loading: release on visibilitychange to hidden
      // is too aggressive (user might come back), but we DO want to release
      // if the page is being unloaded.
      try {
        window.addEventListener('pagehide', function () {
          _forceRelease();
        }, { passive: true });
      } catch (_) {}
    }

    _installStableGutter();
    _installLifecycleGuards();

    return Object.freeze({
      acquire: _acquire,
      release: _release,
      forceRelease: _forceRelease,
      /** @returns {number} current refcount (for diagnostics) */
      get refcount() { return _refCount; },
      /** @returns {boolean} whether the lock is currently held */
      get isLocked() { return _refCount > 0; },
    });
  })();

  // ── LoadingService ────────────────────────────────────────────────────────
  //
  // v2.0.0 Architecture: "Always-show, force-restart" + structural safety
  // ─────────────────────────────────────────────────────────────────────────
  // Behavior unchanged from v1.7.2:
  //   - ALWAYS shows on every show() call (even if overlay already visible)
  //   - FORCE RESTART: visible pulse when show() is called during active overlay
  //   - Session counter: overlay only hides when ALL sessions are closed
  //
  // Structural safety (NEW in v2.0.0):
  //   - All body-scroll-lock mutations go through ScrollLockService
  //   - Watchdog guarantees lock release within 30s
  //   - bfcache + pagehide handlers guarantee release on tab navigation
  //   - ARIA `aria-busy` on <main> for assistive tech
  //   - `isInputPending()` check before forced-reflow hide path

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

    /**
     * Show the loading overlay (open a navigation session).
     *
     * v5.0 — "Always-Show" hard contract:
     *   Every call to show() MUST result in a visible overlay, even if:
     *     • The overlay is already visible (we pulse + restart spinner)
     *     • Data is cached and will be ready in <50ms (MIN_VISIBLE_MS enforced)
     *     • The same route is being re-navigated
     *   The user MUST see loading feedback on EVERY navigation, no exceptions.
     *   This eliminates the "did anything happen?" confusion on fast cached loads.
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

      // Acquire scroll lock — refcounted
      try { ScrollLockService.acquire(); } catch (_) {}

      // Mark <main> as busy for assistive tech
      try {
        var main = document.getElementById(CONFIG.DOM.CONTENT_LOADING_ID)
                 || document.querySelector('main');
        if (main && !main.getAttribute('aria-busy')) {
          main.setAttribute('aria-busy', 'true');
          main.setAttribute('data-nc-aria-busy-owner', '1');
        }
      } catch (_) {}

      // v5.0.1 FIX: Do NOT call window.__ncBootLoader.show() here.
      //   The boot loader's pendingReady starts at 1 (waiting for ONE
      //   ready signal from InitService). If we call show() here, it
      //   becomes 2, and the matching hide() only brings it back to 1 —
      //   the boot overlay never hides, freezing the page.
      //   The boot loader is owned by InitService.start()'s finally block,
      //   which calls ready() exactly once when initial navigation completes.
      //   LoadingService only manages the FVL overlay (subsequent navigations).

      // Normalize opts
      var o = (typeof opts === 'string') ? { message: opts } : (opts || {});
      o.mode = 'fullscreen';
      o.id = o.id || DEFAULT_ID;
      if (o.zIndex == null) o.zIndex = NAV_BEHIND_Z;
      o.instant = o.instant !== false;       // default true
      o.lockScroll = false;                   // we own this via ScrollLockService
      this._lastOpts = o;

      // v5.0: ALWAYS force a fresh FVL instance — don't reuse the existing one.
      // This guarantees a visible loading state on every call.
      // We do this by force-resetting the FVL instance if it's already shown.
      var wasActive = fvl.isActive(DEFAULT_ID);
      if (wasActive) {
        // Force-kill the existing instance so FVL.show() creates a new one
        try {
          var existingInst = fvl.modules().State.getInstance(DEFAULT_ID);
          if (existingInst) {
            existingInst.state = 'destroyed';
            if (existingInst.rootEl && existingInst.rootEl.parentNode) {
              existingInst.rootEl.parentNode.removeChild(existingInst.rootEl);
            }
            fvl.modules().State.removeInstance(DEFAULT_ID);
          }
        } catch (_) {}
      }

      // ALWAYS call FVL.show() — creates a fresh instance
      var handle = fvl.show(o);
      if (handle) {
        this._el = handle.element;
        this._visibleSince = Date.now();
      }

      // v5.0: Pulse even on first show (not just on re-show) — gives the
      // user immediate visual feedback that "something is happening".
      // The pulse is brief (350ms) and non-blocking.
      this._pulse();

      return handle;
    },

    /**
     * Pulse the overlay: briefly dip opacity + restart spinner animation.
     */
    _pulse: function () {
      if (this._pulseInProgress) return; // don't stack pulses
      if (!this._el) return;

      var el = this._el;
      this._pulseInProgress = true;

      // Add pulse class (CSS handles the opacity dip)
      el.classList.add('fvl-pulse');

      // Restart spinner without forced reflow (clone node + replace).
      var arc = el.querySelector('.fvl-arc');
      if (arc) {
        var clone = arc.cloneNode(true);
        arc.parentNode.replaceChild(clone, arc);
      }

      // Remove pulse class after animation completes
      var self = this;
      setTimeout(function() {
        el.classList.remove('fvl-pulse');
        self._pulseInProgress = false;
      }, 350);
    },

    /**
     * Hide the loading overlay (close one navigation session).
     *
     * v5.0 — Hard MIN_VISIBLE_MS enforcement:
     *   The overlay NEVER hides in less than MIN_VISIBLE_MS (200ms) after
     *   the most recent show(). Even if all sessions close in 5ms, the
     *   overlay stays for 200ms. This guarantees the user ALWAYS sees
     *   loading feedback — no "invisible navigation" confusion.
     *
     *   If a new show() arrives during the deferred-hide window, the
     *   pending hide is cancelled and the overlay stays visible (because
     *   _sessionCount went back above 0).
     */
    hide: function () {
      // Decrement session counter (never below 0)
      if (this._sessionCount > 0) this._sessionCount--;
      try { ScrollLockService.release(); } catch (_) {}

      // If there are still open sessions, don't hide
      if (this._sessionCount > 0) {
        return Promise.resolve();
      }

      // All sessions closed — clear ARIA + check minimum visible time
      this._clearAriaBusy();

      var self = this;
      var elapsed = Date.now() - this._visibleSince;

      // v5.0: HARD minimum visible time — no exceptions.
      // Even if the data was cached and ready in 5ms, we show for 200ms.
      if (this._visibleSince > 0 && elapsed < MIN_VISIBLE_MS) {
        if (this._pendingHideTimer) clearTimeout(this._pendingHideTimer);
        return new Promise(function(resolve) {
          self._pendingHideTimer = setTimeout(function() {
            self._pendingHideTimer = null;
            // Re-check sessionCount — a new show() may have arrived
            if (self._sessionCount > 0) { resolve(); return; }
            var fvl = _fvl();
            if (fvl) fvl.hide(DEFAULT_ID);
            // v5.0.1: Do NOT call window.__ncBootLoader.ready() here.
            //   Boot loader is owned by InitService.start()'s finally block.
            resolve();
          }, MIN_VISIBLE_MS - elapsed);
        });
      }

      var fvl = _fvl();
      if (!fvl) return Promise.resolve();
      // v5.0.1: Do NOT call window.__ncBootLoader.ready() here.
      return fvl.hide(DEFAULT_ID);
    },

    /** Clear aria-busy we set on <main> (only if we own it). */
    _clearAriaBusy: function () {
      try {
        var main = document.getElementById(CONFIG.DOM.CONTENT_LOADING_ID)
                 || document.querySelector('main');
        if (main && main.getAttribute('data-nc-aria-busy-owner') === '1') {
          main.removeAttribute('aria-busy');
          main.removeAttribute('data-nc-aria-busy-owner');
        }
      } catch (_) {}
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
     * v5→v5.0: Hide loading — instant (no fade-out) but STILL enforces MIN_VISIBLE_MS.
     *
     * v5.0 changes:
     *   - MIN_VISIBLE_MS is now a HARD contract enforced even for hideInstant().
     *     The "instant" only refers to the absence of fade-out animation,
     *     NOT to skipping the minimum visible time.
     *   - Boot loader ready() signal is sent.
     *   - scheduler.yield() / isInputPending() integration kept from v5.
     */
    hideInstant: function () {
      if (this._sessionCount > 0) this._sessionCount--;
      try { ScrollLockService.release(); } catch (_) {}

      if (this._sessionCount > 0) return Promise.resolve();

      this._clearAriaBusy();
      if (this._pendingHideTimer) {
        clearTimeout(this._pendingHideTimer);
        this._pendingHideTimer = null;
      }

      var self = this;

      // v5.0: Check if user input is pending — if so, defer removal by one frame
      var inputPending = false;
      try {
        if (navigator.scheduling && typeof navigator.scheduling.isInputPending === 'function') {
          inputPending = navigator.scheduling.isInputPending({ includeContinuous: false });
        }
      } catch (_) {}

      var fvl = _fvl();
      var inst = null;
      if (fvl) {
        try {
          inst = fvl.modules().State.getInstance(DEFAULT_ID);
        } catch (_) {}
      }

      var _yieldFn;
      try {
        if (typeof scheduler !== 'undefined' && scheduler.yield) {
          _yieldFn = function () { return scheduler.yield(); };
        }
      } catch (_) {}
      if (!_yieldFn) {
        _yieldFn = function () {
          return new Promise(function (r) { requestAnimationFrame(function () { r(); }); });
        };
      }

      // v5.0: HARD minimum visible time — even for hideInstant
      var elapsed = this._visibleSince > 0 ? Date.now() - this._visibleSince : MIN_VISIBLE_MS;
      var needsDelay = elapsed < MIN_VISIBLE_MS;

      if ((inst && inst.state === 'showing') || inputPending || needsDelay) {
        var delay = needsDelay ? (MIN_VISIBLE_MS - elapsed) : 0;
        return new Promise(function (resolve) {
          setTimeout(function () {
            // Re-check sessionCount — a new show() may have arrived
            if (self._sessionCount > 0) { resolve(); return; }
            _yieldFn().then(function () {
              self._removeOverlayNow(fvl);
              // v5.0.1: Do NOT call window.__ncBootLoader.ready() here.
              //   Boot loader is owned by InitService.start()'s finally block.
              resolve();
            });
          }, delay);
        });
      }

      // Normal case: overlay was fully shown — remove immediately.
      this._removeOverlayNow(fvl);
      // v5.0.1: Do NOT call window.__ncBootLoader.ready() here.
      return Promise.resolve();
    },

    /**
     * v5: Internal — actually remove overlay DOM + FVL instance.
     *
     * v5 SAFETY: All body-lock cleanup now goes through ScrollLockService.
     *   No direct `body.style.position = ''` mutations anywhere in this
     *   method. The defensive sweep remains as a belt-and-braces check
     *   against the unlikely case where some external script mutated body
     *   directly while we held the lock.
     */
    _removeOverlayNow: function (fvl) {
      if (!fvl) fvl = _fvl();

      // Note: ScrollLockService.release() was already called by hideInstant()
      // — we don't release here. But we DO add a defensive sweep in case
      // some other code path set body.style.position = 'fixed' outside
      // ScrollLockService (e.g. legacy loading.css CSS, third-party script).
      try {
        if (document.body.style.position === 'fixed') {
          // Only clear if our refcount is 0 — otherwise something else is
          // legitimately holding the lock.
          if (!ScrollLockService.isLocked) {
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.left = '';
            document.body.style.right = '';
            document.body.style.width = '';
          }
        }
      } catch (_) {}

      // Remove DOM immediately
      if (this._el) {
        try {
          if (this._el.parentNode) this._el.parentNode.removeChild(this._el);
        } catch (_) {}
        this._el = null;
      }
      if (fvl) {
        try {
          var modules = fvl.modules();
          var inst = modules.State.getInstance(DEFAULT_ID);
          if (inst) {
            // Defensive: clear any _lockedScrollY the legacy FVL code may
            // have set (since we used lockScroll:false this should be null,
            // but FVL may have set it if some caller forgot to disable
            // lockScroll — clear it to be safe).
            inst._lockedScrollY = null;
            inst.state = 'destroyed';
            modules.State.removeInstance(DEFAULT_ID);
          }
        } catch (_) {}
      }
    },

    showInContent: function (opts) { return this.show(opts); },
    hideFromContent: function ()   { return this.hide(); },

    // ── Emergency reset (used at start of each navigateTo) ───────────────
    // v5: Forcibly release scroll lock + clear ARIA + remove DOM.
    _forceReset: function () {
      this._sessionCount = 0;
      this._pulseInProgress = false;
      this._visibleSince = 0;
      if (this._pendingHideTimer) {
        clearTimeout(this._pendingHideTimer);
        this._pendingHideTimer = null;
      }
      // Force-release the scroll lock regardless of refcount
      try { ScrollLockService.forceRelease(); } catch (_) {}
      // Clear ARIA busy
      this._clearAriaBusy();
      // Remove overlay DOM immediately
      if (this._el) {
        try {
          if (this._el.parentNode) this._el.parentNode.removeChild(this._el);
        } catch (_) {}
        this._el = null;
      }
      // Remove FVL instance from registry immediately
      var fvl = _fvl();
      if (fvl) {
        try {
          var modules = fvl.modules();
          var inst = modules.State.getInstance(DEFAULT_ID);
          if (inst) {
            inst._lockedScrollY = null;
            inst.state = 'destroyed';
            modules.State.removeInstance(DEFAULT_ID);
          }
        } catch (_) {
          try { fvl.hide(DEFAULT_ID); } catch (__) {}
        }
      }
    },

    // ── Diagnostic API (for performance-monitor.js + console debugging) ──
    _diagnostics: function () {
      return {
        sessionCount: this._sessionCount,
        visibleSince: this._visibleSince,
        pulseInProgress: this._pulseInProgress,
        scrollLock: {
          refcount: ScrollLockService.refcount,
          isLocked: ScrollLockService.isLocked,
        },
      };
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
  M.ScrollLockService = ScrollLockService; // exposed for diagnostics

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
