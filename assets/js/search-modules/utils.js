// @ts-check
/**
 * @file utils.js
 * Pure utility services — stateless helpers with no side-effects on import.
 *
 * Exports:
 *  LanguageService    — language detection + translation
 *  DOMService         — element creation and event helpers
 *  StringService      — HTML escaping, URL encode/decode
 *  StorageService     — session history read/write
 *  NotificationService — toast messages + clipboard copy
 *  HighlightService   — character-level match highlighting
 *
 * @module utils
 * @depends {config.js, state.js}
 */
(function (M) {
  'use strict';

  const { CONFIG } = M;

  // ── LanguageService ───────────────────────────────────────────────────────
  const LanguageService = {
    /**
     * Returns the active UI language code.
     * Priority: localStorage → browser lang → default ('en').
     * @returns {'th'|'en'}
     */
    getLang() {
      try {
        return (
          localStorage.getItem(CONFIG.STORAGE.langKey) ||
          (CONFIG.LANG.autoDetect && navigator.language?.startsWith('th') ? 'th' : CONFIG.LANG.default)
        );
      } catch {
        return CONFIG.LANG.default;
      }
    },

    /**
     * Translate a key to the active language.
     * Falls back to 'en', then returns the key itself.
     * @param {string} key
     * @returns {string}
     */
    t(key) {
      const lang = this.getLang();
      return CONFIG.TEXTS[lang]?.[key] ?? CONFIG.TEXTS[CONFIG.LANG.default][key] ?? key;
    },
  };

  // ── DOMService ────────────────────────────────────────────────────────────
  const DOMService = {
    /** @param {string} id @returns {HTMLElement|null} */
    get: (id) => document.getElementById(id),

    /** @param {string} sel @returns {Element|null} */
    query: (sel) => document.querySelector(sel),

    /** @param {string} sel @returns {NodeListOf<Element>} */
    queryAll: (sel) => document.querySelectorAll(sel),

    /**
     * Create a DOM element with optional id, class and inline styles.
     * @param {string} tag
     * @param {string|null} [id]
     * @param {string|null} [cls]
     * @param {Partial<CSSStyleDeclaration>} [styles]
     * @returns {HTMLElement}
     */
    create(tag, id, cls, styles) {
      const el = document.createElement(tag);
      if (id)     el.id        = id;
      if (cls)    el.className = cls;
      if (styles) Object.assign(el.style, styles);
      return el;
    },

    /** Safely remove an element from the DOM. */
    remove(/** @type {Element|null|undefined} */ el) {
      try { el?.parentNode?.removeChild(el); } catch {}
    },

    /** @param {Element|null} el @param {Partial<CSSStyleDeclaration>} s */
    setStyles(el, s) { if (el) try { Object.assign(el.style, s); } catch {} },

    /** @param {Element|null} el @param {string} html */
    setHTML(el, html) { if (el) el.innerHTML = html; },

    /** @param {Element|null} el @param {string} k @param {string} v */
    setAttr(el, k, v) { if (el) el.setAttribute(k, v); },

    /**
     * @param {EventTarget|null} el
     * @param {string} ev
     * @param {EventListener} fn
     * @param {AddEventListenerOptions} [opts]
     */
    on(el, ev, fn, opts) { if (el && fn) el.addEventListener(ev, fn, opts); },

    /** @param {EventTarget|null} el @param {string} ev @param {EventListener|null} fn */
    off(el, ev, fn) { if (el && fn) el.removeEventListener(ev, fn); },
  };

  // ── StringService ─────────────────────────────────────────────────────────
  const StringService = {
    /** @param {unknown} s @returns {string} */
    escapeHtml: (s) =>
      String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),

    /** @param {string} s @returns {string} */
    encodeUrl: (s) => encodeURIComponent(s),

    /** @param {string} s @returns {string} */
    decodeUrl(s) { try { return decodeURIComponent(s); } catch { return s; } },
  };

  // ── StorageService ────────────────────────────────────────────────────────
  const StorageService = {
    /**
     * Read session search history.
     * @returns {SearchHistoryEntry[]}
     */
    getHistory() {
      try { return JSON.parse(sessionStorage.getItem(CONFIG.STORAGE.historyKey) || '[]'); }
      catch { return []; }
    },

    /**
     * Append one entry to session search history.
     * @param {Omit<SearchHistoryEntry,'ts'>} entry
     */
    addSearchToHistory(entry) {
      try {
        const arr = this.getHistory();
        arr.push({ ...entry, ts: Date.now() });
        sessionStorage.setItem(CONFIG.STORAGE.historyKey, JSON.stringify(arr));
      } catch {}
    },
  };

  // ── NotificationService ───────────────────────────────────────────────────
  const NotificationService = {
    /**
     * Show a dismissing toast message.
     * @param {string} msg
     */
    toast(msg) {
      try {
        const el = DOMService.create('div', null, 'copy-toast-message');
        el.textContent = msg;
        (DOMService.get(CONFIG.DOM.copyToastId) || document.body).appendChild(el);
        const id = setTimeout(() => {
          try {
            Object.assign(el.style, { opacity: '0', transform: 'translateX(14px)' });
            setTimeout(() => DOMService.remove(el), CONFIG.TIMING.toastFadeMs);
          } catch {}
        }, CONFIG.TIMING.toastDisplayMs);
        M.State._timeouts.add(id);
      } catch {}
    },

    /**
     * Copy text to clipboard, then show a toast.
     * Falls back to execCommand('copy') for older browsers.
     * @param {string} text
     * @returns {Promise<void>}
     */
    async copyText(text) {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          this.toast(LanguageService.t('copy') + ' แล้ว');
          return;
        }
        // Fallback for older browsers
        const ta = Object.assign(document.createElement('textarea'), { value: text });
        Object.assign(ta.style, { position: 'fixed', left: '-9999px' });
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy')
          ? this.toast(LanguageService.t('copy') + ' แล้ว')
          : this.toast(LanguageService.t('copy_failed'));
        document.body.removeChild(ta);
      } catch {
        this.toast(LanguageService.t('copy_failed'));
      }
    },
  };

  // ── HighlightService ──────────────────────────────────────────────────────
  const HighlightService = {
    /**
     * Wrap characters that appear in `query` with <strong> tags.
     * Character-level (not substring) matching — intentional for CJK/emoji data.
     * @param {string} text
     * @param {string} query
     * @returns {string} Safe HTML string
     */
    highlight(text, query) {
      if (!text || !query) return StringService.escapeHtml(text || '');
      try {
        const lower = String(text).toLowerCase();
        const chars = new Set(String(query).toLowerCase());
        let out = '';
        for (let i = 0; i < lower.length; i++) {
          out += chars.has(lower[i])
            ? `<strong style="background-color:#fff3cd;font-weight:700">${StringService.escapeHtml(String(text)[i])}</strong>`
            : StringService.escapeHtml(String(text)[i]);
        }
        return out;
      } catch {
        return StringService.escapeHtml(text);
      }
    },
  };

  // ── Exports ───────────────────────────────────────────────────────────────
  M.LanguageService     = LanguageService;
  M.DOMService          = DOMService;
  M.StringService       = StringService;
  M.StorageService      = StorageService;
  M.NotificationService = NotificationService;
  M.HighlightService    = HighlightService;

})(window.SearchModules = window.SearchModules || {});
