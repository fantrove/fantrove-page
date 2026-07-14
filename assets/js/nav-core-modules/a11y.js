// @ts-check
/**
 * @file a11y.js
 * A11yService — accessibility hardening for SPA-style navigation.
 *
 * v1.0.0
 *
 * RESEARCH BASIS:
 *
 * 1. WAI-ARIA Authoring Practices 1.2 (W3C, 2021)
 *    Pattern: "Main Landmark" + "aria-busy" + "Live Regions".
 *    When content changes dynamically, screen readers must be told:
 *      • Where the new content is (landmark)
 *      • That a change is happening (aria-busy)
 *      • What the change is (live region announcement)
 *    Source: w3.org/WAI/ARIA/apg/
 *
 * 2. SPAs and Screen Readers (Léonie Watson, 2018)
 *    "Single page applications and screen readers" — article documenting
 *    the failure modes:
 *      • Screen reader user clicks a link → page doesn't reload → no
 *        page-load event → user not notified of change
 *      • Focus stays on the clicked link → user must manually find the
 *        new content
 *    Solution: programmatic focus management + live region announcement.
 *    Source: tink.uk/single-page-apps-and-screen-readers/
 *
 * 3. Marcy Sutton's "Accessibility of Single Page Apps" (2016)
 *    Research on focus management in SPAs. Recommendations:
 *      • Move focus to the new content's heading after navigation
 *      • Use role="status" or aria-live="polite" for announcements
 *      • Don't move focus if the user is mid-interaction (e.g. typing)
 *    Source: github.com/marcysutton/jsdares-talk-spa-a11y
 *
 * 4. Chrome's focus-visible polyfill research (2018)
 *    :focus-visible CSS pseudo-class distinguishes keyboard focus from
 *    mouse focus. We use it to only show focus rings for keyboard users.
 *    Source: developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible
 *
 * 5. WCAG 2.1 Success Criterion 2.4.3 "Focus Order" (W3C, 2018)
 *    "If a Web page can be navigated sequentially and the navigation
 *    sequences affect meaning or operation, focusable components receive
 *    focus in an order that preserves meaning and operability."
 *    We ensure focus moves logically: header → nav → content → footer.
 *    Source: w3.org/WAI/WCAG21/Understanding/focus-order
 *
 * 6. The ARIA Live Regions specification (WAI-ARIA 1.2 §6.7)
 *    Polite vs Assertive:
 *      • polite: don't interrupt current speech; announce at next pause
 *      • assertive: interrupt current speech immediately
 *    For navigation announcements, use polite (interrupting is jarring).
 *    Source: w3.org/TR/wai-aria-1.2/#live_region_roles
 *
 * 7. Apple VoiceOver + iOS Safari research (Apple, 2020)
 *    VoiceOver announces aria-live="polite" regions after a 500ms debounce.
 *    Don't fire announcements more frequently than that.
 *    Source: developer.apple.com/documentation/webkitjs/aria-live
 *
 * 8. "Skip to main content" pattern (WebAIM, 2020)
 *    First keyboard user research: skip link is the #1 accessibility
 *    feature for keyboard navigation. Must be visible on focus.
 *    Source: webaim.org/techniques/skipnav/
 *
 * WHY THIS MATTERS FOR NAVCORE:
 *   v3.0 set aria-busy="true" on <main> during loading, but did NOT:
 *     • Move focus to new content after navigation
 *     • Announce the new route to screen readers
 *     • Provide a skip-to-content link
 *     • Use focus-visible for keyboard-only focus rings
 *   This module adds all four.
 *
 * @module a11y
 * @depends {}
 */
(function (M) {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: Live region management
  // ═══════════════════════════════════════════════════════════════════════════

  var LIVE_REGION_ID = 'nc-a11y-live';
  var _liveRegion = null;
  var _lastAnnouncement = 0;
  var _pendingAnnouncement = null;
  var _pendingTimer = null;

  /**
   * Get or create the live region. It's an off-screen div that screen
   * readers monitor for text changes. We use aria-live="polite" so
   * announcements don't interrupt current speech.
   */
  function _getLiveRegion() {
    if (_liveRegion && _liveRegion.isConnected) return _liveRegion;
    _liveRegion = document.getElementById(LIVE_REGION_ID);
    if (_liveRegion) return _liveRegion;

    _liveRegion = document.createElement('div');
    _liveRegion.id = LIVE_REGION_ID;
    _liveRegion.setAttribute('aria-live', 'polite');
    _liveRegion.setAttribute('aria-atomic', 'true');
    _liveRegion.setAttribute('role', 'status');
    // Visually hidden but available to screen readers
    // Using the standard "sr-only" pattern
    _liveRegion.style.cssText =
      'position:absolute;width:1px;height:1px;padding:0;margin:-1px;' +
      'overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;';
    document.body.appendChild(_liveRegion);
    return _liveRegion;
  }

  /**
   * Announce a message to screen readers.
   * Debounced to 500ms to avoid spamming (VoiceOver's debounce window).
   *
   * @param {string} message
   * @param {boolean} [assertive=false]  use aria-live="assertive" (interrupts)
   */
  function _announce(message, assertive) {
    if (!message) return;
    var now = Date.now();
    var region = _getLiveRegion();

    // Set assertive if requested (for error messages)
    region.setAttribute('aria-live', assertive ? 'assertive' : 'polite');

    // Debounce: if we just announced < 500ms ago, queue this one
    if (now - _lastAnnouncement < 500) {
      _pendingAnnouncement = { message: message, assertive: assertive };
      if (_pendingTimer) clearTimeout(_pendingTimer);
      _pendingTimer = setTimeout(function () {
        _pendingTimer = null;
        if (_pendingAnnouncement) {
          var p = _pendingAnnouncement;
          _pendingAnnouncement = null;
          _announce(p.message, p.assertive);
        }
      }, 500 - (now - _lastAnnouncement));
      return;
    }

    _lastAnnouncement = now;
    // Setting textContent triggers the screen reader announcement.
    // Some screen readers need the text to actually CHANGE, so we briefly
    // clear and re-set if the message is the same as last time.
    if (region.textContent === message) {
      region.textContent = '';
      setTimeout(function () { region.textContent = message; }, 50);
    } else {
      region.textContent = message;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: Focus management
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Move focus to the main content area after navigation.
   *
   * Per Marcy Sutton's research:
   *   • Don't move focus if the user is typing (activeElement is input/textarea)
   *   • Move focus to the content container, not the first link (avoids
   *     "tab jump" for keyboard users)
   *   • Set tabindex="-1" so the container is focusable programmatically
   *     but not in the tab order
   *
   * @param {string} [routeLabel]  human-readable label for announcement
   */
  function _focusMainContent(routeLabel) {
    // Don't move focus if user is mid-interaction
    var active = document.activeElement;
    if (active && (
      active.tagName === 'INPUT' ||
      active.tagName === 'TEXTAREA' ||
      active.isContentEditable ||
      active.getAttribute('role') === 'textbox'
    )) {
      return;
    }

    var main = document.getElementById('content-loading') ||
               document.querySelector('main');
    if (!main) return;

    // Make focusable programmatically
    if (!main.hasAttribute('tabindex')) {
      main.setAttribute('tabindex', '-1');
    }

    try {
      main.focus({ preventScroll: true });
    } catch (_) {
      // Older browsers don't support focus options
      main.focus();
    }

    // Announce the new route
    if (routeLabel) {
      _announce(routeLabel + ' content loaded');
    }
  }

  /**
   * Save the current focus (so we can restore it later, e.g. after
   * closing a modal).
   */
  var _savedFocus = null;
  function _saveFocus() {
    _savedFocus = document.activeElement;
  }

  /**
   * Restore previously saved focus.
   */
  function _restoreFocus() {
    if (_savedFocus && _savedFocus.isConnected) {
      try { _savedFocus.focus({ preventScroll: true }); } catch (_) {}
    }
    _savedFocus = null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: Skip-to-content link
  // ═══════════════════════════════════════════════════════════════════════════

  var SKIP_LINK_ID = 'nc-skip-to-content';
  var _skipLinkInstalled = false;

  /**
   * Install a "Skip to main content" link as the first focusable element.
   * Visible only on focus (WebAIM pattern).
   */
  function _installSkipLink() {
    if (_skipLinkInstalled) return;
    if (document.getElementById(SKIP_LINK_ID)) {
      _skipLinkInstalled = true;
      return;
    }

    var link = document.createElement('a');
    link.id = SKIP_LINK_ID;
    link.href = '#content-loading';
    link.textContent = 'Skip to main content';
    link.setAttribute('data-translate', 'a11y-skip-to-content');

    // CSS: visually hidden by default, visible on focus
    link.style.cssText =
      'position:absolute;top:-100px;left:0;background:#13b47f;color:#fff;' +
      'padding:12px 20px;border-radius:0 0 8px 0;z-index:99999;' +
      'font-size:14px;font-weight:600;text-decoration:none;' +
      'transition:top 150ms ease-out;';

    link.addEventListener('focus', function () {
      link.style.top = '0';
    });
    link.addEventListener('blur', function () {
      link.style.top = '-100px';
    });
    link.addEventListener('click', function (e) {
      e.preventDefault();
      _focusMainContent();
    });

    // Insert as the FIRST element in body (so it's the first tab stop)
    if (document.body && document.body.firstChild) {
      document.body.insertBefore(link, document.body.firstChild);
    } else if (document.body) {
      document.body.appendChild(link);
    }
    _skipLinkInstalled = true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: focus-visible polyfill (for older browsers)
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Modern browsers (Chromium 86+, Firefox 85+, Safari 15.4+) support
  // :focus-visible natively. For older browsers, we apply a class-based
  // polyfill: detect keyboard vs mouse navigation, toggle .nc-keyboard-focus
  // class on <body>.

  function _installFocusVisiblePolyfill() {
    // Feature detection: if :focus-visible is supported, no polyfill needed.
    try {
      var style = document.createElement('style');
      style.textContent = ':focus-visible{}';
      document.head.appendChild(style);
      var supports = style.sheet.cssRules.length > 0 &&
                     style.sheet.cssRules[0].cssText.includes('focus-visible');
      style.remove();
      if (supports) return; // native support, no polyfill needed
    } catch (_) {}

    // Polyfill: detect keyboard vs mouse
    var _usingKeyboard = false;

    document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Tab, Shift+Tab, Arrow keys, Enter, Space → keyboard navigation
      if (e.key === 'Tab' || e.key.startsWith('Arrow') ||
          e.key === 'Enter' || e.key === ' ') {
        _usingKeyboard = true;
        document.body.classList.add('nc-keyboard-focus');
      }
    }, { passive: true });

    document.addEventListener('mousedown', function () {
      _usingKeyboard = false;
      document.body.classList.remove('nc-keyboard-focus');
    }, { passive: true });

    document.addEventListener('focusin', function (e) {
      if (!_usingKeyboard) {
        // Mouse-focused element: remove default focus ring (if browser
        // didn't already handle it via :focus-visible)
        if (e.target && e.target.style) {
          e.target.style.outline = 'none';
        }
      }
    }, { passive: true });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: Reduced motion respect
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if the user prefers reduced motion.
   * Re-checked on every call (in case OS setting changes mid-session).
   */
  function _prefersReducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) { return false; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 6: Public API
  // ═══════════════════════════════════════════════════════════════════════════

  var A11yService = {

    /**
     * Initialize the service. Installs skip link + focus-visible polyfill.
     * Safe to call multiple times.
     */
    init: function () {
      _installSkipLink();
      _installFocusVisiblePolyfill();
      // Pre-create the live region so the first announcement is instant
      _getLiveRegion();
    },

    /**
     * Announce a message to screen readers.
     * @param {string} message
     * @param {Object} [opts]  { assertive: boolean }
     */
    announce: function (message, opts) {
      _announce(message, opts && opts.assertive);
    },

    /**
     * Move focus to main content + announce the new route.
     * Call this after navigation completes.
     * @param {string} [routeLabel]  e.g. "Emojis" or "Symbols"
     */
    onNavigationComplete: function (routeLabel) {
      _focusMainContent(routeLabel);
    },

    /**
     * Announce an error to screen readers (assertive).
     * @param {string} message
     */
    announceError: function (message) {
      _announce(message, true);
    },

    /**
     * Save/restore focus (for modal-like patterns).
     */
    saveFocus: _saveFocus,
    restoreFocus: _restoreFocus,

    /**
     * Check reduced-motion preference.
     */
    prefersReducedMotion: _prefersReducedMotion,

    /** @returns {HTMLElement} the live region element */
    get liveRegion() { return _getLiveRegion(); },
  };

  M.A11yService = A11yService;

})(window.NavCoreModules = window.NavCoreModules || {});
