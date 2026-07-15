// @ts-check
/**
 * @file loading.js
 * LoadingService — thin proxy that delegates to FVL (FantroveVerse Loader).
 *
 * v1.7.2 — "Always-show, force-restart" architecture
 *
 * Key principles:
 *   1. NO DELAY — overlay shows immediately on show() call
 *   2. ALWAYS SHOWS on every show() call, even if overlay is already visible
 *      (this is critical: when navigating between categories rapidly, each
 *       navigation must trigger a visible loading state, not be silently
 *       absorbed by idempotency)
 *   3. FORCE RESTART — when show() is called while overlay is already visible,
 *      the spinner animation is restarted to give clear visual feedback that
 *      a new operation has started
 *   4. Session counter — overlay only hides when ALL sessions are closed
 *   5. Direct forward — every show/hide is forwarded to FVL immediately,
 *      no cached state that can drift from FVL's actual state
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
  var MIN_VISIBLE_MS = 200;

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

  // ── LoadingService ────────────────────────────────────────────────────────
  //
  // v1.7.2 Architecture: "Always-show, force-restart"
  // ───────────────────────────────────────────────
  // The previous v1.7.1 design relied on FVL's idempotency: calling show()
  // on an already-shown instance just updated the message. But this meant
  // that rapid navigation between categories would NOT produce a visible
  // "loading" state on subsequent navigations — the overlay was already
  // there, so nothing changed visually.
  //
  // v1.7.2 fixes this by FORCING a visual restart on every show() call:
  //   - If FVL has no active instance → call FVL.show() (creates one)
  //   - If FVL has an active instance → "pulse" it (brief opacity dip +
  //     restart spinner animation) so the user sees that a new operation
  //     has started
  //
  // This ensures that EVERY navigation produces clear visual feedback,
  // even when navigations happen back-to-back.

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
     * v1.7.2 behavior:
     *   1. Increment session counter
     *   2. ALWAYS call FVL.show() — FVL.show() is idempotent:
     *      - If no instance exists → creates one and shows it
     *      - If instance is 'shown' → updates message, returns existing handle
     *      - If instance is 'hiding' → cancels hide, restores shown state
     *      - If instance is 'hidden' → creates new instance
     *   3. If overlay was already visible, also pulse to signal new operation
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

      // Normalize opts
      var o = (typeof opts === 'string') ? { message: opts } : (opts || {});
      o.mode = 'fullscreen';
      o.id = o.id || DEFAULT_ID;
      if (o.zIndex == null) o.zIndex = NAV_BEHIND_Z;
      // v1.8: Framework-level enhancements
      // WHY instant: Skip 140ms fade-in — overlay is opaque from the first paint.
      //   This prevents a race condition where content changes behind the
      //   overlay before it's fully visible (visible jank). The caller
      //   (router.js) awaits one rAF after show() to guarantee the paint.
      // WHY lockScroll: Block scrolling while loading — user should not be
      //   able to scroll the (hidden) content behind the overlay. This is
      //   a framework-level feature (FVL handles position:fixed + restore).
      o.instant = o.instant !== false;       // default true (caller can opt out)
      o.lockScroll = o.lockScroll !== false;  // default true
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
     * This gives clear visual feedback that a new operation has started,
     * even when the overlay was already visible.
     *
     * The pulse is implemented via CSS class toggle (.fvl-pulse), which
     * the CSS animates over 350ms. The spinner animation is restarted by
     * briefly removing and re-adding the animation property.
     */
    _pulse: function () {
      if (this._pulseInProgress) return; // don't stack pulses
      if (!this._el) return;

      var el = this._el;
      this._pulseInProgress = true;

      // Add pulse class (CSS handles the opacity dip)
      el.classList.add('fvl-pulse');

      // v3: Restart spinner โดยไม่ forced reflow
      // WHY เดิม: getComputedStyle() + void arc.offsetWidth = forced synchronous layout
      //   ทำให้ main thread block 5-20ms ระหว่าง navigation
      // วิธีใหม่: clone node → replace → animation restart โดยไม่ต้องอ่าน layout
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
     * Decrements session counter. Only hides the overlay when ALL sessions
     * are closed (counter reaches 0).
     *
     * MIN_VISIBLE_MS: if the overlay was shown less than 200ms ago, defer
     * the hide until the 200ms has elapsed. This prevents 1-frame flashes
     * on cached loads. The hide is NOT delayed if there are still open
     * sessions (only the final hide is delayed).
     */
    hide: function () {
      // Decrement session counter (never below 0)
      if (this._sessionCount > 0) this._sessionCount--;

      // If there are still open sessions, don't hide
      if (this._sessionCount > 0) {
        return Promise.resolve();
      }

      // All sessions closed — check minimum visible time
      var elapsed = Date.now() - this._visibleSince;
      if (this._visibleSince > 0 && elapsed < MIN_VISIBLE_MS) {
        // Defer hide until MIN_VISIBLE_MS has elapsed
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

      // Minimum time satisfied — hide immediately
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
     * v3→v4: Hide loading แบบ instant — ไม่มี fade-out animation
     * WHY: เมื่อ content พร้อมแล้ว ไม่ต้อง fade-out 180ms
     *   ซ่อนทันทีแบบ Google/Microsoft — content ปรากฏปั๊บ
     *   ลด forced reflow จาก CSS transition ด้วย
     *
     * v4: rAF guard — ถ้า overlay ถูกสร้างใน frame เดียวกับที่ hide
     *   ถูกเรียก (เช่น cached load เร็วมาก), browser อาจไม่เคย paint
     *   overlay เลย → ผู้ใช้เห็น content เปลี่ยนอยู่เบื้องหลัง
     *   วิธีแก้: ถ้า overlay อยู่ในสถานะ 'showing' (ยังไม่ถูก paint),
     *   รอ 1 rAF ก่อนลบ เพื่อให้ browser ได้ paint อย่างน้อย 1 ครั้ง
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

      // v4: Check if FVL instance is still in 'showing' state (not yet painted).
      // If so, defer removal by 1 rAF to guarantee at least one paint.
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

      // Normal case: overlay was fully shown — remove immediately.
      this._removeOverlayNow(fvl);
      return Promise.resolve();
    },

    /**
     * v4: Internal — actually remove overlay DOM + FVL instance.
     * Split from hideInstant() so the rAF guard can call it deferred.
     *
     * v2 FIX (scroll-lock restore):
     *   Previously this method removed the DOM element + FVL instance
     *   from the registry but NEVER restored the body scroll-lock styles
     *   that FVL applied when `lockScroll: true` (the default for
     *   fullscreen mode). The result: after the first navigation on
     *   pages that use ContentService (e.g. /data/verse/discover/),
     *   `body.style.position` remained `fixed` forever, making the page
     *   unscrollable. Other pages (home, etc.) don't use nav-core's
     *   navigation flow, which is why only the discover page was affected.
     *
     *   Fix: mirror the cleanup that FVL._cleanup() and _forceReset()
     *   already do — restore `position`/`top`/`width` on <body> and
     *   scroll back to the saved offset BEFORE removing the instance.
     *   Also add a defensive sweep in case the FVL instance was already
     *   removed from the registry (e.g. by a prior _forceReset) while
     *   the body styles were still locked.
     */
    _removeOverlayNow: function (fvl) {
      if (!fvl) fvl = _fvl();

      // ── Restore body scroll-lock (primary fix) ───────────────────────────
      // We MUST read the instance BEFORE removing it from the registry,
      // because the instance holds `_lockedScrollY` (the saved scroll offset).
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
        // Defensive sweep: if no instance was found (e.g. already removed
        // by an earlier _forceReset) but the body is still locked from a
        // previous show(), unlock it so the page can scroll again.
        try {
          if (document.body.style.position === 'fixed') {
            document.body.style.position = '';
            document.body.style.top      = '';
            document.body.style.width    = '';
          }
        } catch (_) {}
      }

      // ลบ DOM ทันที — ไม่ผ่าน FVL animation
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
    // v3: ลบ overlay DOM ทันที ไม่รอ leave animation
    // WHY: เมื่อคลิกรัวๆ เราต้องการ "รีเซ็ตทุกอย่างใหม่" ไม่ใช่ "รอให้เลือนหาย"
    //   การเรียก fvl.hide() จะมี animation delay 180ms ซึ่งทำให้ show() ตัวใหม่
    //   อาจเจอ instance ที่อยู่ในสถานะ 'hiding' แล้วทำให้การแสดงผลผิดพลาด
    _forceReset: function () {
      this._sessionCount = 0;
      this._pulseInProgress = false;
      this._visibleSince = 0;
      if (this._pendingHideTimer) {
        clearTimeout(this._pendingHideTimer);
        this._pendingHideTimer = null;
      }
      // ลบ overlay DOM ทันที — ไม่รอ animation
      if (this._el) {
        try {
          if (this._el.parentNode) this._el.parentNode.removeChild(this._el);
        } catch (_) {}
        this._el = null;
      }
      // ลบ FVL instance ออกจาก registry ทันที
      var fvl = _fvl();
      if (fvl) {
        try {
          var modules = fvl.modules();
          var inst = modules.State.getInstance(DEFAULT_ID);
          if (inst) {
            // ทำ cleanup เหมือน FVL ภายใน แต่ทันที (skip animation)
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
          // Fallback: ลอง hide ปกติ ถ้า internal API ใช้ไม่ได้
          try { fvl.hide(DEFAULT_ID); } catch (__) {}
        }
      }
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
