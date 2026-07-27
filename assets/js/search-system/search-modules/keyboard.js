// @ts-check
/**
 * @file keyboard.js
 * Soft keyboard detection and auto-toggle service.
 *
 * KeyboardService          — detects whether the virtual keyboard is open.
 * GapBasedKeyboardService  — throttles rapid open/close oscillation.
 * KeyboardAutoToggleService — blurs/focuses input on scroll position changes.
 *
 * @module keyboard
 * @depends {config.js, state.js, utils.js}
 */
(function (M) {
  'use strict';

  const { CONFIG, State, Handlers, DOMService } = M;

  // ── GapBasedKeyboardService ───────────────────────────────────────────────
  /**
   * Prevents rapid keyboard open/close oscillation by enforcing minimum gaps
   * between consecutive toggles.
   */
  const GapBasedKeyboardService = {
    /** @returns {boolean} True if enough time has passed since last toggle */
    isGapExpired:      () => (Date.now() - State.lastKeyboardToggleTime) >= CONFIG.TIMING.keyboardGapMinMs,
    isRecoveryExpired: () => (Date.now() - State.lastKeyboardToggleTime) >= CONFIG.TIMING.keyboardGapRecoveryMs,
    recordToggle:      () => { State.lastKeyboardToggleTime = Date.now(); },
    resetGap:          () => { State.lastKeyboardToggleTime = 0; },

    /** Mark that scrolling is active; clears after keyboardIdleTimeMs. */
    markScroll() {
      State.isScrollingActive = true;
      if (State.scrollIdleTimer) clearTimeout(State.scrollIdleTimer);
      State.scrollIdleTimer = setTimeout(
        () => { State.isScrollingActive = false; },
        CONFIG.TIMING.keyboardIdleTimeMs
      );
    },

    /** @returns {boolean} True when scroll has been idle for keyboardIdleTimeMs */
    isScrollIdle: () => !State.isScrollingActive,
  };

  // ── KeyboardAutoToggleService ─────────────────────────────────────────────
  /**
   * Listens to scroll events inside the overlay and automatically blurs the
   * input (dismissing the soft keyboard) when scrolling starts, then
   * re-focuses when the user scrolls back to the top.
   */
  const KeyboardAutoToggleService = {
    /**
     * Begin listening. Call after overlay opens with the scrollable container.
     * @param {Element|null} sc  The overlay's scrollable div
     */
    enableAutoToggle(sc) {
      if (State.keyboardAutoToggleEnabled) return;
      State.keyboardAutoToggleEnabled = true;
      State.lastOverlayScrollY        = 0;
      GapBasedKeyboardService.resetGap();

      const el = sc || DOMService.get(CONFIG.DOM.overlayContainerId);
      if (!el) return;

      State.keyboardAutoToggleHandler = () => {
        try {
          const cur = el.scrollTop || 0;
          GapBasedKeyboardService.markScroll();

          if (cur === 0 && State.lastOverlayScrollY > 0) {
            // Scrolled back to top — re-open keyboard if gap expired
            if (GapBasedKeyboardService.isGapExpired() || GapBasedKeyboardService.isRecoveryExpired()) {
              const inp = DOMService.get(CONFIG.DOM.searchInputId);
              if (inp && document.activeElement !== inp) inp.focus();
              GapBasedKeyboardService.recordToggle();
            }
          } else if (cur > 0 && State.lastOverlayScrollY === 0) {
            // Started scrolling down — dismiss keyboard
            if (GapBasedKeyboardService.isGapExpired()) {
              const inp = DOMService.get(CONFIG.DOM.searchInputId);
              if (inp && document.activeElement === inp) inp.blur();
              GapBasedKeyboardService.recordToggle();
            }
          }

          State.lastOverlayScrollY = cur;
        } catch {}
      };

      el.addEventListener('scroll', State.keyboardAutoToggleHandler, { passive: true });
    },

    /** Stop listening. Call when overlay closes. */
    disableAutoToggle() {
      if (!State.keyboardAutoToggleEnabled) return;
      State.keyboardAutoToggleEnabled = false;
      const sc = State.overlayScrollable || DOMService.get(CONFIG.DOM.overlayContainerId);
      if (sc && State.keyboardAutoToggleHandler) {
        sc.removeEventListener('scroll', State.keyboardAutoToggleHandler);
      }
      if (State.scrollIdleTimer) clearTimeout(State.scrollIdleTimer);
      State.keyboardAutoToggleHandler = null;
    },
  };

  // ── KeyboardService ───────────────────────────────────────────────────────
  /**
   * Detects whether the virtual keyboard is open by comparing window/viewport
   * height before and after resize events.
   */
  const KeyboardService = {
    /**
     * Attach resize listeners. Call once during app init.
     */
    initKeyboardDetection() {
      try {
        State.lastWindowInnerHeight = window.innerHeight || 0;

        if ('visualViewport' in window) {
          // Modern: visualViewport gives accurate keyboard-aware height
          window.visualViewport.addEventListener('resize', () => {
            clearTimeout(State.keyboardDetectionTimeout);
            State.keyboardDetectionTimeout = setTimeout(
              () => this._update(),
              CONFIG.TIMING.keyboardDetectionDelayMs
            );
          }, { passive: true });
        } else {
          // Fallback: window resize event
          const onResize = () => {
            clearTimeout(State.keyboardDetectionTimeout);
            State.keyboardDetectionTimeout = setTimeout(
              () => this._update(),
              CONFIG.TIMING.keyboardDetectionDelayMs
            );
          };
          Handlers.resize = onResize;
          window.addEventListener('resize', onResize, { passive: true });
        }
      } catch {}
    },

    /** Recalculate keyboard state from current viewport height. */
    _update() {
      try {
        const cur  = window.visualViewport?.height || window.innerHeight || 0;
        const diff = State.lastWindowInnerHeight - cur;
        if (diff > 100)       State.keyboardOpen = true;
        else if (diff < -100) State.keyboardOpen = false;
        State.lastWindowInnerHeight = cur;
      } catch {}
    },

    /** @returns {boolean} */
    isKeyboardOpen: () => !!State.keyboardOpen,
  };

  // ── Exports ───────────────────────────────────────────────────────────────
  M.GapBasedKeyboardService   = GapBasedKeyboardService;
  M.KeyboardAutoToggleService = KeyboardAutoToggleService;
  M.KeyboardService           = KeyboardService;

})(window.SearchModules = window.SearchModules || {});
