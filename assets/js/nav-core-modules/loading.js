// @ts-check
/**
 * @file loading.js
 * LoadingService — fullscreen loading overlay management.
 *
 * Merges contentLoadingManager.js + overlay.js (legacy proxy) into one file.
 *
 * Features:
 *  ① i18n: LOADING_MESSAGES map from CONFIG — add language = add one key only
 *  ② Dual-language display:
 *       .clp-msg  = active language (primary, bold)
 *       .clp-sub  = English subtitle (shown only when active ≠ en)
 *  ③ CSS var --clp-top tracks header + subnav height via ResizeObserver
 *  ④ Animation: fade-in on show, fade-out on hide (CSS in loading.css)
 *
 * CSS lives in /assets/css/loading.css — NOT injected here.
 *
 * @module loading
 * @depends {config.js, state.js}
 */
(function (M) {
  'use strict';

  const { CONFIG } = M;

  // ── i18n helper ───────────────────────────────────────────────────────────────

  /**
   * Resolve a loading message for a given language.
   * Fallback chain: requested lang → 'en' → first key in map.
   * @param {string} [lang]
   * @param {string} [key='loading']
   * @returns {string}
   */
  function _getMsg(lang, key = 'loading') {
    const msgs = CONFIG.LOADING_MESSAGES;
    return msgs[lang]?.[key]
      || msgs['en']?.[key]
      || msgs[Object.keys(msgs)[0]]?.[key]
      || 'Loading...';
  }

  // ── LoadingService ────────────────────────────────────────────────────────────

  const LoadingService = {

    /** Content container ID — read by ContentService */
    LOADING_CONTAINER_ID: CONFIG.DOM.CONTENT_LOADING_ID,

    // ── Internal state ──────────────────────────────────────────────────────────
    /** @type {HTMLElement|null} */ _el:          null,
    /** @type {boolean}          */ _shown:       false,
    /** @type {number|null}      */ _rafId:       null,
    /** @type {number|null}      */ _leaveTimer:  null,
    /** @type {ResizeObserver|null} */ _ro:        null,

    // ── Initialization ──────────────────────────────────────────────────────────

    /**
     * Create the overlay element and attach ResizeObserver.
     * Safe to call multiple times (idempotent).
     */
    init() {
      if (!document.getElementById(CONFIG.DOM.OVERLAY_ID)) {
        const el = document.createElement('div');
        el.id = CONFIG.DOM.OVERLAY_ID;
        el.setAttribute('role',       'status');
        el.setAttribute('aria-live',  'polite');
        el.setAttribute('aria-atomic', 'true');
        el.hidden   = true;
        el.innerHTML = this._html();
        document.body.appendChild(el);
        this._el = el;
      } else {
        this._el = document.getElementById(CONFIG.DOM.OVERLAY_ID);
      }

      this._updateTopVar();

      // Track header + subnav height changes so overlay aligns correctly
      if (typeof ResizeObserver !== 'undefined' && !this._ro) {
        this._ro = new ResizeObserver(() => this._updateTopVar());
        const header = document.querySelector(CONFIG.DOM.HEADER_TAG);
        const subnav = document.getElementById(CONFIG.DOM.SUB_NAV_ID);
        if (header) this._ro.observe(header);
        if (subnav) this._ro.observe(subnav);
      }

      // Expose global helpers (used by legacy scripts)
      try {
        window.showInstantLoadingOverlay   = opts => this.show(opts);
        window.removeInstantLoadingOverlay = ()   => this.hide();
      } catch (_) {}
    },

    /** @returns {string} Inner HTML for the overlay */
    _html() {
      return (
        `<div class="clp-spinner" aria-hidden="true">` +
          `<svg viewBox="0 0 52 52" xmlns="http://www.w3.org/2000/svg">` +
            `<circle class="clp-track" cx="26" cy="26" r="22"/>` +
            `<circle class="clp-arc"   cx="26" cy="26" r="22"/>` +
          `</svg>` +
        `</div>` +
        `<div class="clp-text">` +
          `<div class="clp-msg"></div>` +
          `<div class="clp-sub"></div>` +
        `</div>`
      );
    },

    // ── CSS variable ────────────────────────────────────────────────────────────

    /**
     * Update --clp-top to = header height + subnav height.
     * Called by ResizeObserver and before show().
     */
    _updateTopVar() {
      try {
        const header = document.querySelector(CONFIG.DOM.HEADER_TAG);
        const subnav = document.getElementById(CONFIG.DOM.SUB_NAV_ID);
        let top = 0;
        if (header) top += header.offsetHeight;
        if (subnav && subnav.style.display !== 'none' && subnav.offsetHeight > 0)
          top += subnav.offsetHeight;
        document.documentElement.style.setProperty('--clp-top', `${top}px`);
      } catch (_) {}
    },

    /** @returns {HTMLElement|null} */
    _getEl() {
      if (this._el) return this._el;
      this.init();
      return this._el;
    },

    // ── i18n text update ─────────────────────────────────────────────────────────

    /**
     * Update the overlay message.
     * Primary = active language; subtitle = English (when active ≠ en).
     * @param {string|null} [customMsg]
     */
    _setTexts(customMsg) {
      const el = this._getEl();
      if (!el) return;

      const msgEl = el.querySelector('.clp-msg');
      const subEl = el.querySelector('.clp-sub');
      if (!msgEl) return;

      if (customMsg) {
        msgEl.textContent = customMsg;
        if (subEl) subEl.textContent = '';
        return;
      }

      const lang    = localStorage.getItem(CONFIG.LOADING.LANG_KEY) || 'en';
      const primary = _getMsg(lang, 'loading');
      msgEl.textContent = primary;

      if (subEl) subEl.textContent = (lang !== 'en') ? _getMsg('en', 'loading') : '';

      const ariaText = (lang !== 'en')
        ? `${primary} / ${_getMsg('en', 'loading')}`
        : primary;
      el.setAttribute('aria-label', ariaText);
    },

    // ── Show ─────────────────────────────────────────────────────────────────────

    /**
     * Show the loading overlay.
     * @param {LoadingOptions} [opts]
     */
    show(opts = '') {
      const msg = typeof opts === 'string' ? opts : (opts?.message || '');
      const el  = this._getEl();
      if (!el) return;

      if (this._leaveTimer) { clearTimeout(this._leaveTimer);  this._leaveTimer = null; }
      if (this._rafId)      { cancelAnimationFrame(this._rafId); this._rafId = null; }

      this._updateTopVar();
      this._setTexts(msg || null);

      el.classList.remove('leaving');
      el.style.willChange = '';
      el.hidden = false;

      this._rafId = requestAnimationFrame(() => {
        this._rafId = null;
        el.classList.add('entering');
        const onEnd = () => {
          el.classList.remove('entering');
          el.style.willChange = '';
          el.removeEventListener('animationend', onEnd);
        };
        el.addEventListener('animationend', onEnd, { once: true, passive: true });
      });

      this._shown = true;

      try {
        window.__instantLoadingOverlayShown  = true;
        window.__removeInstantLoadingOverlay = () => this.hide();
      } catch (_) {}

      if (opts?.autoHideAfterMs > 0)
        setTimeout(() => this.hide(), opts.autoHideAfterMs);
    },

    // ── Hide ─────────────────────────────────────────────────────────────────────

    hide() {
      const el = this._getEl();
      if (!el || !this._shown) return;

      this._shown = false;
      try { window.__instantLoadingOverlayShown = false; } catch (_) {}

      if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }

      el.classList.remove('entering');
      el.style.willChange = 'opacity';
      el.classList.add('leaving');

      this._leaveTimer = setTimeout(() => {
        this._leaveTimer = null;
        el.classList.remove('leaving');
        el.style.willChange = '';
        el.hidden = true;
      }, CONFIG.LOADING.FADE_OUT_MS + 10);
    },

    // ── Utilities ─────────────────────────────────────────────────────────────────

    /** @param {string|null} [msg] */
    updateMessage(msg) { this._setTexts(msg || null); },

    /** @returns {boolean} */
    isShown()       { return this._shown; },

    /** @returns {typeof CONFIG.LOADING_MESSAGES} */
    getMessages()   { return CONFIG.LOADING_MESSAGES; },

    // Aliases for call-site compatibility
    showInContent(opts) { return this.show(opts); },
    hideFromContent()   { return this.hide(); },
  };

  // ── Auto-init ─────────────────────────────────────────────────────────────────

  function _autoInit() { LoadingService.init(); }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', _autoInit, { once: true });
  else
    _autoInit();

  // ── Export ────────────────────────────────────────────────────────────────────

  M.LoadingService = LoadingService;

  // Global convenience aliases (used by external scripts)
  try {
    if (!window._navCore_contentLoadingManager)
      window._navCore_contentLoadingManager = LoadingService;
    window.showInstantLoadingOverlay   = opts => LoadingService.show(opts);
    window.removeInstantLoadingOverlay = ()   => LoadingService.hide();
  } catch (_) {}

})(window.NavCoreModules = window.NavCoreModules || {});