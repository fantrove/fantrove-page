// Path:    assets/js/popup-modules/utils.js
// Purpose: Shared utility functions for the Popup System.
//          DOM helpers, option merging, ID generation.
// Used by: engine.js, renderer.js, overlay.js, a11y.js

(function(M) {
  'use strict';

  const { CONFIG, State } = M;

  // ── DOM helpers ─────────────────────────────────────────────────────────────

  const DOM = {
    /**
     * Create an element with optional id, className, and inline styles.
     * @param {string} tag
     * @param {string} [id]
     * @param {string} [className]
     * @param {Object} [styles] - camelCase CSS properties
     * @returns {HTMLElement}
     */
    create(tag, id, className, styles) {
      const el = document.createElement(tag);
      if (id) el.id = id;
      if (className) el.className = className;
      if (styles) Object.assign(el.style, styles);
      return el;
    },

    /**
     * Shortcut for querySelector.
     * @param {string} selector
     * @param {Element} [parent=document]
     * @returns {Element|null}
     */
    query(selector, parent) {
      return (parent || document).querySelector(selector);
    },

    /**
     * Shortcut for querySelectorAll → Array.
     * @param {string} selector
     * @param {Element} [parent=document]
     * @returns {Element[]}
     */
    queryAll(selector, parent) {
      return Array.from((parent || document).querySelectorAll(selector));
    },

    /**
     * Remove an element from its parent.
     * @param {Element|null} el
     */
    remove(el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    },
  };

  // ── Option merging ──────────────────────────────────────────────────────────

  /**
   * Deep-merge user options with a preset configuration.
   * User options ALWAYS win over preset defaults.
   *
   * @param {PopupOptions} userOpts
   * @param {PresetConfig}  preset
   * @returns {PopupOptions} Resolved options
   */
  function mergeOptions(userOpts, preset) {
    const o = Object.assign({}, userOpts);

    // Apply preset defaults for any missing values
    if (o.type === undefined) o.type = preset.type;
    if (o.size === undefined) o.size = preset.defaultSize;
    if (o.position === undefined) o.position = preset.defaultPosition;
    if (o.closable === undefined) o.closable = preset.defaultClosable;
    if (o.blocking === undefined) o.blocking = preset.defaultBlocking;
    if (o.lockScroll === undefined) o.lockScroll = preset.defaultLockScroll;
    if (o.focusTrap === undefined) o.focusTrap = preset.defaultFocusTrap;
    if (o.stackable === undefined) o.stackable = preset.defaultStackable;
    if (o.dismissOnOverlay === undefined) o.dismissOnOverlay = preset.defaultDismissOnOverlay;
    if (o.dismissOnEscape === undefined) o.dismissOnEscape = preset.defaultDismissOnEscape;
    if (o.enterAnimation === undefined) o.enterAnimation = preset.enterAnimation;
    if (o.exitAnimation === undefined) o.exitAnimation = preset.exitAnimation;
    if (o.role === undefined) o.role = preset.defaultRole;

    // Persistent overrides closable, dismissOnOverlay, dismissOnEscape
    if (o.persistent) {
      o.closable = false;
      o.dismissOnOverlay = false;
      o.dismissOnEscape = false;
    }

    // Blocking overrides stackable
    if (o.blocking) {
      o.stackable = false;
    }

    // Resolve language
    o.lang = o.lang ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('selectedLang')) ||
      'en';

    // Easing resolution
    const easingMap = { ease: CONFIG.EASING.EASE, spring: CONFIG.EASING.SPRING, bounce: CONFIG.EASING.BOUNCE, linear: CONFIG.EASING.LINEAR };
    o._easing = easingMap[o.easing] || CONFIG.EASING.EASE;

    // Shadow resolution
    o._shadow = CONFIG.SHADOWS[o.shadow] || CONFIG.SHADOWS.md;

    // Animation duration
    o._enterDuration = o.animationDuration || CONFIG.TIMING.ENTER_DURATION;
    o._exitDuration = o.animationDuration || CONFIG.TIMING.EXIT_DURATION;

    return o;
  }

  /**
   * Generate z-index for a new popup based on its layer and stack position.
   * @param {number} baseZ - From preset's zIndexLayer
   * @param {number} stackPosition - 0-based position in the stack
   * @returns {number}
   */
  function resolveZIndex(baseZ, stackPosition) {
    return baseZ + (stackPosition * CONFIG.Z_INDEX.STACK_STEP);
  }

  /**
   * Get the preset config for a given type, with fallback to 'dialog'.
   * @param {PopupPreset} type
   * @returns {PresetConfig}
   */
  function getPreset(type) {
    return State.getCustomPreset(type) || CONFIG.PRESETS[type] || CONFIG.PRESETS.dialog;
  }

  /**
   * Safe wrapper — runs fn, catches errors, returns fallback.
   * @param {Function} fn
   * @param {*} fallback
   * @returns {*}
   */
  function safe(fn, fallback) {
    try { return fn(); } catch (_) { return fallback; }
  }

  /**
   * Check if the current device likely prefers reduced motion.
   * @returns {boolean}
   */
  function prefersReducedMotion() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false;
  }

  M.Utils = Object.freeze({
    DOM, mergeOptions, resolveZIndex, getPreset, safe, prefersReducedMotion,
  });

})(window.PopupModules = window.PopupModules || {});