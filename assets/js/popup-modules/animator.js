// Path:    assets/js/popup-modules/animator.js
// Purpose: Animation controller for popups.
//          Handles enter/exit transitions, respects prefers-reduced-motion.
//          Uses double-rAF technique (same as copyNotification.js) to
//          ensure initial state is painted before starting transitions.
//          v1.1 — fullscreen popups use opacity-only animation (no transform).
// Used by: engine.js

(function(M) {
  'use strict';
  
  const { CONFIG } = M;
  const { Utils } = M;
  
  // ── Helpers ──────────────────────────────────────────────────────────────
  
  /**
   * Check if the popup is a fullscreen type (by class).
   * @param {HTMLElement} el
   * @returns {boolean}
   */
  function _isFullscreen(el) {
    return el.classList.contains(CONFIG.DOM.CLASS_FULLSCREEN);
  }
  
  // ── Enter animation ────────────────────────────────────────────────────────
  
  /**
   * Animate a popup entering the viewport.
   *
   * @param {HTMLElement} popupEl    - The popup root element
   * @param {HTMLElement} [overlayEl]- The overlay element (if any)
   * @param {PopupOptions} options  - Resolved options
   * @returns {Promise<void>}
   */
  function enter(popupEl, overlayEl, options) {
    const duration = options._enterDuration;
    const easing = options._easing;
    const reducedMotion = Utils.prefersReducedMotion();
    const isFS = _isFullscreen(popupEl);
    
    return new Promise(function(resolve) {
      // Add entering class immediately
      popupEl.classList.add(CONFIG.DOM.ENTERING_CLASS);
      
      // Show overlay with fade-in
      if (overlayEl) {
        overlayEl.style.transition = 'opacity ' + CONFIG.TIMING.OVERLAY_FADE_IN + 'ms ' + easing;
        overlayEl.style.opacity = '1';
      }
      
      if (reducedMotion) {
        // Skip animation entirely — just show
        popupEl.classList.remove(CONFIG.DOM.ENTERING_CLASS);
        popupEl.classList.add(CONFIG.DOM.VISIBLE_CLASS);
        resolve();
        return;
      }
      
      // Double-rAF: ensures the initial (pre-animation) state has been
      // painted by the browser before we add the transition class.
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          if (isFS) {
            // Fullscreen: opacity-only fade (no transform since it fills viewport)
            popupEl.style.transition = 'opacity ' + duration + 'ms ' + easing;
          } else {
            popupEl.style.transition = 'transform ' + duration + 'ms ' + easing +
              ', opacity ' + duration + 'ms ' + easing;
          }
          popupEl.classList.remove(CONFIG.DOM.ENTERING_CLASS);
          popupEl.classList.add(CONFIG.DOM.VISIBLE_CLASS);
        });
      });
      
      // Resolve after animation completes
      setTimeout(function() {
        popupEl.style.transition = '';
        resolve();
      }, duration + CONFIG.TIMING.RAF_DOUBLE_BUFFER);
    });
  }
  
  // ── Exit animation ─────────────────────────────────────────────────────────
  
  /**
   * Animate a popup exiting the viewport.
   *
   * @param {HTMLElement} popupEl    - The popup root element
   * @param {HTMLElement} [overlayEl]- The overlay element (if any)
   * @param {PopupOptions} options  - Resolved options
   * @returns {Promise<void>}
   */
  function exit(popupEl, overlayEl, options) {
    const duration = options._exitDuration;
    const easing = CONFIG.EASING.EXIT; // Always use ease-in for exit
    const reducedMotion = Utils.prefersReducedMotion();
    const isFS = _isFullscreen(popupEl);
    
    return new Promise(function(resolve) {
      popupEl.classList.add(CONFIG.DOM.CLOSING_CLASS);
      
      // Fade out overlay
      if (overlayEl) {
        overlayEl.style.transition = 'opacity ' + CONFIG.TIMING.OVERLAY_FADE_OUT + 'ms ' + easing;
        overlayEl.style.opacity = '0';
      }
      
      if (reducedMotion) {
        popupEl.classList.remove(CONFIG.DOM.CLOSING_CLASS, CONFIG.DOM.VISIBLE_CLASS);
        resolve();
        return;
      }
      
      // Apply exit transition
      if (isFS) {
        // Fullscreen: opacity-only fade out
        popupEl.style.transition = 'opacity ' + duration + 'ms ' + easing;
      } else {
        popupEl.style.transition = 'transform ' + duration + 'ms ' + easing +
          ', opacity ' + duration + 'ms ' + easing;
      }
      popupEl.classList.remove(CONFIG.DOM.VISIBLE_CLASS);
      
      setTimeout(function() {
        popupEl.style.transition = '';
        popupEl.classList.remove(CONFIG.DOM.CLOSING_CLASS);
        resolve();
      }, duration + CONFIG.TIMING.DESTROY_CLEANUP);
    });
  }
  
  // ── Stagger helper for stacked popups ──────────────────────────────────────
  
  /**
   * Apply a stagger delay before starting the enter animation.
   * @param {number} stackIndex - Position in the stack (0 = bottom)
   * @returns {Promise<void>}
   */
  function staggerDelay(stackIndex) {
    const delay = Math.min(stackIndex * 30, 120); // max 120ms stagger
    return new Promise(function(resolve) {
      setTimeout(resolve, delay);
    });
  }
  
  M.Animator = Object.freeze({ enter, exit, staggerDelay });
  
})(window.PopupModules = window.PopupModules || {});