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
    /**
     * Escape HTML special characters.
     * Single-pass char scan — one output string, zero regex, zero intermediate strings.
     * 3 chained .replace() = 3 full scans + 2 intermediate strings per call.
     * Called ~300×/render frame (10× per card × 30 visible cards).
     * @param {unknown} s
     * @returns {string}
     */
    escapeHtml(s) {
      const str = String(s);
      let out = '';
      for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        if      (c === 38) out += '&amp;';   // &
        else if (c === 60) out += '&lt;';    // <
        else if (c === 62) out += '&gt;';    // >
        else if (c === 34) out += '&quot;';  // " (bonus: safe in attributes)
        else               out += str[i];
      }
      return out;
    },

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
    // Cache last query's char Set — one Set per query, reused for all items in batch
    _lastQuery : '',
    _lastChars : /** @type {Set<string>} */ (new Set()),

    /**
     * Wrap matching grapheme clusters in <mark> tags.
     *
     * KEY FIX — Thai diacritic displacement:
     *   Thai vowel marks (U+0E30–U+0E4E) are COMBINING characters.
     *   They render relative to the PRECEDING base consonant.
     *   Wrapping a combining char alone in <mark> = separate inline box =
     *   the mark floats away from its base → visual displacement.
     *
     *   Fix: use Intl.Segmenter (Chrome 87+, Safari 16.4+, FF 125+) to get
     *   grapheme clusters. Each cluster = base consonant + all its combining
     *   marks = one visual unit. We highlight the whole cluster together.
     *
     *   Fallback for older browsers: manual Thai combining char detection.
     *   Thai combining range: U+0E30–U+0E4E (sara, mai han akat, tone marks).
     *   We attach combining chars to the PREVIOUS cluster before deciding
     *   whether to wrap in <mark>.
     *
     * A cluster is highlighted if ANY character in it matches the query chars.
     * This is correct: highlighting ย in ยิ้ม highlights the whole cluster.
     *
     * @param {string} text
     * @param {string} query
     * @returns {string} Safe HTML string
     */
    highlight(text, query) {
      if (!text || !query) return StringService.escapeHtml(text || '');
      try {
        const t = String(text);
        const q = String(query).toLowerCase();

        // Rebuild char set only when query changes (amortised O(1) per item)
        if (q !== this._lastQuery) {
          this._lastQuery = q;
          this._lastChars = new Set(q);
        }

        const chars   = this._lastChars;
        const clusters = this._graphemeClusters(t);
        let out = '';

        for (const cluster of clusters) {
          // Escape the entire cluster as a unit
          let esc = '';
          for (let i = 0; i < cluster.length; i++) {
            const c = cluster[i];
            esc += c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : c;
          }
          // Check if any char in this cluster matches query chars
          const match = cluster.toLowerCase().split('').some(c => chars.has(c));
          out += match ? `<mark>${esc}</mark>` : esc;
        }
        return out;
      } catch {
        return StringService.escapeHtml(text);
      }
    },

    /**
     * Split text into grapheme clusters (base + combining chars stay together).
     *
     * Uses Intl.Segmenter when available (modern browsers).
     * Falls back to manual Thai combining char grouping for older browsers.
     *
     * Thai combining range U+0E30–U+0E4E:
     *   sara a, sara aa, sara i, sara ii, sara ue, sara uee, sara u, sara uu,
     *   sara e, sara ae, sara o, sara ai, sara am, mai han akat,
     *   and all tone marks (mai ek, mai tho, mai tri, mai chattawa).
     *
     * @param {string} text
     * @returns {string[]} array of grapheme cluster strings
     */
    _graphemeClusters(text) {
      // Modern path: Intl.Segmenter with grapheme granularity
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        try {
          const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
          return Array.from(seg.segment(text), s => s.segment);
        } catch {}
      }

      // Fallback: manual combining char grouping
      // Thai combining characters U+0E30–U+0E4E attach to the preceding consonant
      const out     = [];
      let   cluster = '';

      for (let i = 0; i < text.length; i++) {
        const cp = text.codePointAt(i) ?? 0;

        // Skip the second code unit of a surrogate pair
        if (cp > 0xFFFF) i++;

        const ch = String.fromCodePoint(cp);

        // Thai combining: sara, mai han akat, tone marks
        const isThaicombining = cp >= 0x0E30 && cp <= 0x0E4E;
        // General Unicode combining categories (Mn, Mc, Me):
        // Simple heuristic — most common ranges
        const isGeneralCombining = (cp >= 0x0300 && cp <= 0x036F)   // Combining Diacritical Marks
                                 || (cp >= 0x1AB0 && cp <= 0x1AFF)  // Combining Diacritical Marks Extended
                                 || (cp >= 0x20D0 && cp <= 0x20FF); // Combining Diacritical Marks for Symbols

        if (isThaicombining || isGeneralCombining) {
          // Attach to current cluster (or start a new one if none)
          cluster += ch;
        } else {
          if (cluster) out.push(cluster);
          cluster = ch;
        }
      }
      if (cluster) out.push(cluster);
      return out;
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
