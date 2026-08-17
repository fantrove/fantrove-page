// Path:    assets/js/popup-modules/overlay.js
// Purpose: Overlay interaction management.
//          Handles overlay click-to-dismiss, escape key, and click-outside.
//          Attaches and removes document-level listeners cleanly.
// Used by: engine.js

(function(M) {
  'use strict';

  const { CONFIG, State, Utils } = M;
  const D = CONFIG.DOM;

  // ── Active listeners registry (per-instance cleanup) ──────────────────────

  /**
   * Set of { element, event, handler } tuples currently attached by the overlay system.
   * Used for guaranteed cleanup on popup close/destroy.
   * @type {Set<{el: Element, event: string, handler: Function}>}
   */
  const _attached = new Set();

  /**
   * Attach an event listener and track it for cleanup.
   * @param {Element} el
   * @param {string} event
   * @param {Function} handler
   * @param {Object} [options]
   */
  function on(el, event, handler, options) {
    el.addEventListener(event, handler, options);
    _attached.add({ el: el, event: event, handler: handler, options: options });
  }

  /**
   * Remove a specific tracked listener.
   */
  function off(el, event, handler) {
    el.removeEventListener(event, handler);
    for (const entry of _attached) {
      if (entry.el === el && entry.event === event && entry.handler === handler) {
        _attached.delete(entry);
        break;
      }
    }
  }

  /**
   * Remove ALL listeners tracked for a given instance ID.
   * Called during popup close to guarantee zero listener leaks.
   * @param {string} instanceId
   */
  function detachAll(instanceId) {
    // We tag each handler with the instanceId it belongs to
    for (const entry of _attached) {
      if (entry._instanceId === instanceId) {
        entry.el.removeEventListener(entry.event, entry.handler, entry.options);
        _attached.delete(entry);
      }
    }
  }

  // ── Overlay click handler ──────────────────────────────────────────────────

  /**
   * Attach overlay click-to-dismiss for a popup instance.
   * Only fires if the click is directly on the overlay (not the popup content).
   *
   * @param {string} instanceId
   * @param {HTMLElement} overlayEl
   * @param {Function} closeFn - Called when overlay is clicked
   */
  function attachOverlayClick(instanceId, overlayEl, closeFn) {
    var handler = function(e) {
      if (e.target === overlayEl) {
        e.preventDefault();
        closeFn();
      }
    };
    handler._instanceId = instanceId;
    on(overlayEl, 'click', handler, { passive: false });
  }

  // ── Escape key handler ─────────────────────────────────────────────────────

  /**
   * Attach Escape key listener for a popup.
   * Only the TOPMOST popup with dismissOnEscape=true responds.
   *
   * @param {string} instanceId
   * @param {Function} closeFn
   */
  function attachEscapeKey(instanceId, closeFn) {
    var handler = function(e) {
      if (e.key !== 'Escape') return;

      // Only respond if this instance is the topmost popup
      var top = State.getTopInstance();
      if (!top || top.id !== instanceId) return;

      // Check dismissOnEscape on the instance
      if (top.options.dismissOnEscape !== false) {
        e.preventDefault();
        e.stopPropagation();
        closeFn();
      }
    };
    handler._instanceId = instanceId;
    on(document, 'keydown', handler, false);
  }

  // ── Click outside (for non-overlay popups like popovers) ───────────────────

  /**
   * Close popup when clicking outside of it (for overlay-less popups).
   *
   * @param {string} instanceId
   * @param {HTMLElement} rootEl
   * @param {Function} closeFn
   */
  function attachClickOutside(instanceId, rootEl, closeFn) {
    var handler = function(e) {
      // Don't close if click is inside the popup or its anchor trigger
      if (rootEl.contains(e.target)) return;
      var trigger = rootEl.getAttribute(CONFIG.DOM.TRIGGER_ATTR);
      if (trigger && document.querySelector(trigger)?.contains(e.target)) return;
      closeFn();
    };
    handler._instanceId = instanceId;
    // Use capture phase so we see the click before it reaches children
    on(document, 'mousedown', handler, true);
  }

  // ── Window resize handler (for anchored popups) ────────────────────────────

  /**
   * Re-position anchored popups on window resize.
   *
   * @param {string} instanceId
   * @param {HTMLElement} rootEl
   * @param {PopupOptions} options
   * @param {Function} repositionFn
   */
  function attachResize(instanceId, rootEl, options, repositionFn) {
    if (!options.anchor) return;
    var handler = function() {
      Utils.safe(function() { repositionFn(); }, undefined);
    };
    handler._instanceId = instanceId;
    on(window, 'resize', handler, { passive: true });
    on(window, 'scroll', handler, { passive: true, capture: true });
  }

  M.OverlayService = Object.freeze({
    on, off, detachAll,
    attachOverlayClick, attachEscapeKey, attachClickOutside, attachResize,
  });

})(window.PopupModules = window.PopupModules || {});