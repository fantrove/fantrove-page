// Path:    assets/js/popup-modules/a11y.js
// Purpose: Accessibility management for popup instances.
//          Handles focus trapping, auto-focus, return-focus,
//          and ARIA live regions.
// Used by: engine.js

(function(M) {
  'use strict';

  const { CONFIG, Utils } = M;

  // ── Focus trap ─────────────────────────────────────────────────────────────

  /**
   * Install a focus trap inside the popup root element.
   * Tab and Shift+Tab cycle through focusable elements within the popup.
   *
   * @param {string} instanceId - For tagging the handler
   * @param {HTMLElement} rootEl - The popup root
   * @returns {Function} Cleanup function
   */
  function installFocusTrap(instanceId, rootEl) {
    var handler = function(e) {
      if (e.key !== 'Tab') return;

      var focusable = rootEl.querySelectorAll(CONFIG.A11Y.AUTO_FOCUS_SELECTOR);
      if (focusable.length === 0) {
        // If no focusable elements, prevent tab from escaping
        e.preventDefault();
        return;
      }

      var first = focusable[0];
      var last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: if focus is on first element, wrap to last
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: if focus is on last element, wrap to first
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    handler._instanceId = instanceId;

    document.addEventListener('keydown', handler, false);

    // Return cleanup function
    return function() {
      document.removeEventListener('keydown', handler, false);
    };
  }

  // ── Auto-focus ─────────────────────────────────────────────────────────────

  /**
   * Move focus to the first focusable element inside the popup body,
   * or the popup root itself if no focusable element exists.
   *
   * @param {HTMLElement} rootEl
   * @param {HTMLElement} bodyEl
   * @param {number} [delayMs=CONFIG.A11Y.FOCUS_DELAY_MS]
   */
  function autoFocus(rootEl, bodyEl, delayMs) {
    var delay = delayMs !== undefined ? delayMs : CONFIG.A11Y.FOCUS_DELAY_MS;
    setTimeout(function() {
      // Priority 1: element with autofocus attribute inside popup
      var autoFocusEl = rootEl.querySelector('[autofocus]');
      if (autoFocusEl) {
        try { autoFocusEl.focus({ preventScroll: true }); } catch(_) {}
        return;
      }

      // Priority 2: first focusable in body
      var first = bodyEl.querySelector(CONFIG.A11Y.AUTO_FOCUS_SELECTOR);
      if (first) {
        try { first.focus({ preventScroll: true }); } catch(_) {}
        return;
      }

      // Priority 3: close button (if exists)
      var closeBtn = rootEl.querySelector('[data-fp-close]');
      if (closeBtn) {
        try { closeBtn.focus({ preventScroll: true }); } catch(_) {}
        return;
      }

      // Fallback: focus the root itself for screen readers
      try { rootEl.focus({ preventScroll: true }); } catch(_) {}
    }, delay);
  }

  // ── Return focus ───────────────────────────────────────────────────────────

  /**
   * Return focus to the trigger element that opened the popup.
   *
   * @param {Element|null} triggerEl
   */
  function returnFocus(triggerEl) {
    if (!triggerEl) return;
    setTimeout(function() {
      try {
        // Only focus if the trigger is still in the DOM and visible
        if (triggerEl.isConnected && triggerEl.offsetParent !== null) {
          triggerEl.focus({ preventScroll: true });
        }
      } catch(_) {}
    }, 16); // next frame
  }

  // ── ARIA management ─────────────────────────────────────────────────────────

  /**
   * Hide all other content from screen readers when a blocking popup is open.
   * Sets aria-hidden on sibling elements.
   *
   * @param {boolean} isOpen
   * @param {HTMLElement} [popupRootEl]
   */
  function manageInertSiblings(isOpen, popupRootEl) {
    if (!isOpen) {
      // Restore: remove aria-hidden from everything we hid
      var hiddenEls = document.querySelectorAll('[data-fp-aria-hidden]');
      hiddenEls.forEach(function(el) {
        el.removeAttribute('aria-hidden');
        el.removeAttribute('data-fp-aria-hidden');
        el.removeAttribute('inert');
      });
      return;
    }

    // Hide all top-level body children except the popup and its overlay
    var children = document.body.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child === popupRootEl) continue;
      // Skip overlay elements
      if (child.hasAttribute && child.hasAttribute('data-fp-overlay')) continue;
      // Skip script, style, link, meta tags
      var tag = (child.tagName || '').toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta') continue;

      child.setAttribute('aria-hidden', 'true');
      child.setAttribute('data-fp-aria-hidden', 'true');
      if ('inert' in HTMLElement.prototype) {
        child.inert = true;
      }
    }
  }

  M.A11yService = Object.freeze({
    installFocusTrap, autoFocus, returnFocus, manageInertSiblings,
  });

})(window.PopupModules = window.PopupModules || {});