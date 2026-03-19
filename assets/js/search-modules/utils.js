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
    // Cached char Set for last query — one Set creation per query value
    _lastQuery : '',
    _lastChars : /** @type {Set<string>} */ (new Set()),

    /**
     * Highlight matched characters in `text` for query `query`.
     *
     * ┌─────────────────────────────────────────────────────────────────┐
     * │  Thai diacritic highlight — root cause & fix                    │
     * │                                                                  │
     * │  PROBLEM (visual perception):                                    │
     * │    Thai vowel marks (ิ ี ึ ็ ั etc.) sit ABOVE the baseline.    │
     * │    A <mark> background rectangle lives at baseline height.       │
     * │    Result: ย in <mark>ยิ้</mark> appears highlighted,            │
     * │    but ิ้ (above-baseline) look unhighlighted.                   │
     * │    User perceives: only the base consonant is marked.            │
     * │                                                                   │
     * │  FIX — two-tier approach:                                         │
     * │                                                                   │
     * │  Tier 1 (Chrome 105+, Safari 17.2+, FF 117+):                    │
     * │    CSS Custom Highlight API.                                      │
     * │    Paints highlights BEHIND glyphs at the font rendering level.  │
     * │    No DOM changes → zero displacement, covers full glyph extent  │
     * │    including above-baseline diacritics exactly.                  │
     * │    Same mechanism as browser "Find in Page".                     │
     * │    Implementation: render plain text, then create Range per      │
     * │    matched character code-point and register via CSS.highlights. │
     * │                                                                   │
     * │  Tier 2 (fallback — older browsers):                             │
     * │    Wrap whole cluster in <mark>.                                  │
     * │    Add box-decoration-break:clone + padding-top to extend the    │
     * │    background rectangle upward to cover above-baseline glyphs.  │
     * └─────────────────────────────────────────────────────────────────┘
     *
     * @param {string}   text      Display text to highlight
     * @param {string}   query     User's search query
     * @param {Element}  [domNode] When provided, apply CSS Custom Highlight
     *                             to this node's text content (Tier 1).
     *                             When omitted, returns HTML string (Tier 2).
     * @returns {string}  HTML string (Tier 2 path) or plain escaped text (Tier 1 path)
     */
    highlight(text, query, domNode) {
      if (!text || !query) return StringService.escapeHtml(text || '');
      try {
        const t = String(text);
        const q = String(query).toLowerCase();

        // Rebuild char Set only when query changes (O(1) amortised per item)
        if (q !== this._lastQuery) {
          this._lastQuery = q;
          this._lastChars = new Set(q);
        }
        const chars = this._lastChars;

        // ── Tier 1: CSS Custom Highlight API ─────────────────────────────
        // Available: Chrome 105+, Safari 17.2+, Firefox 117+
        // Paints highlight at glyph level — no DOM modification, no displacement.
        if (domNode && typeof CSS !== 'undefined' && CSS.highlights) {
          return this._highlightViaCSS(t, q, chars, domNode);
        }

        // ── Tier 2: cluster-wrap <mark> ───────────────────────────────────
        return this._highlightViaHTML(t, chars);
      } catch {
        return StringService.escapeHtml(text);
      }
    },

    /**
     * Tier 1: CSS Custom Highlight API.
     * Applies highlight ranges directly to a text node — zero displacement.
     *
     * Flow:
     *  1. Write plain escaped text into domNode (no <mark> tags)
     *  2. Walk text nodes, find code-point offsets of matched chars
     *  3. Create one Range per matched code-point
     *  4. Register all ranges under 'sg-match' highlight name
     *
     * CSS: ::highlight(sg-match) { background-color: var(--g1); }
     *
     * @param {string}   t       Text to render
     * @param {string}   q       Lowercased query
     * @param {Set}      chars   Set of lowercased query chars
     * @param {Element}  node    DOM node to apply highlights on
     * @returns {string}  Plain escaped text (no <mark>)
     */
    _highlightViaCSS(t, q, chars, node) {
      // Render plain text immediately — Range highlight applied after via rAF
      const plain = StringService.escapeHtml(t);

      requestAnimationFrame(() => {
        try {
          if (!CSS.highlights || !node.isConnected) return;

          // Find the text node inside the element
          const textNode = node.firstChild?.nodeType === 3
            ? node.firstChild
            : [...node.childNodes].find(n => n.nodeType === 3);
          if (!textNode) return;

          const raw    = textNode.textContent || '';
          const ranges = [];

          // Create one Range per GRAPHEME CLUSTER that contains a matching char.
          //
          // Why clusters, not individual code-points:
          //   Thai combining chars (ิ ้ ั ็ etc.) are part of a cluster with
          //   their base consonant. CSS Custom Highlight API paints a rectangle
          //   for each Range. A Range spanning the whole cluster (base + above)
          //   produces a single highlight that covers the full visual extent —
          //   including above-baseline diacritics that the user typed.
          //
          //   Range for single ้ alone (without base) might not cover the visual
          //   advance of the preceding consonant's glyph ascent on all engines.
          //   Spanning the whole cluster is more reliable.
          let offset = 0;
          const clusters = this._graphemeClusters(raw);

          for (const cluster of clusters) {
            const clusterLen = cluster.length;

            // Build per-char position map: [{cp, len, isCombining, localOffset}]
            const charMap = [];
            let pos = 0;
            for (let i = 0; i < cluster.length; i++) {
              const cp = cluster.codePointAt(i) ?? 0;
              if (cp > 0xFFFF) i++;
              const clen = cp > 0xFFFF ? 2 : 1;
              const isCombining = (cp >= 0x0E30 && cp <= 0x0E3A)
                                || (cp >= 0x0E47 && cp <= 0x0E4E)
                                || (cp >= 0x0300 && cp <= 0x036F)
                                || (cp >= 0x1AB0 && cp <= 0x1AFF)
                                || (cp >= 0x20D0 && cp <= 0x20FF);
              charMap.push({ cp, len: clen, isCombining, pos });
              pos += clen;
            }

            const baseEntry  = charMap.find(m => !m.isCombining);
            const baseMatches = baseEntry
              ? chars.has(String.fromCodePoint(baseEntry.cp).toLowerCase())
              : false;

            if (baseMatches) {
              // Case A: base char matched → one Range over entire cluster
              const r = document.createRange();
              r.setStart(textNode, offset);
              r.setEnd(textNode, offset + clusterLen);
              ranges.push(r);
            } else {
              // Case B: check each combining char individually
              // Create a separate Range for each matched combining char
              for (const m of charMap) {
                if (!m.isCombining) continue;
                const ch = String.fromCodePoint(m.cp).toLowerCase();
                if (chars.has(ch)) {
                  const r = document.createRange();
                  r.setStart(textNode, offset + m.pos);
                  r.setEnd(textNode, offset + m.pos + m.len);
                  ranges.push(r);
                }
              }
            }

            offset += clusterLen;
          }

          if (ranges.length) {
            // Register or update the named highlight
            const existing = CSS.highlights.get('sg-match');
            if (existing) {
              // Add to the shared highlight set for this render pass
              ranges.forEach(r => existing.add(r));
            } else {
              CSS.highlights.set('sg-match', new Highlight(...ranges));
            }
          }
        } catch {}
      });

      return plain;
    },

    /**
     * Tier 2 (fallback): wrap matched grapheme clusters in <mark>.
     *
     * Always wraps WHOLE cluster (base + combining chars together) to prevent
     * displacement. CSS extends mark box upward via padding-top so above-baseline
     * diacritics are visually covered.
     *
     * @param {string} t      Text to render
     * @param {Set}    chars  Set of lowercased query chars
     * @returns {string}  HTML string
     */
    /**
     * Tier 2: wrap matched portions in <mark>.
     *
     * Precise marking rule:
     *   Case A — base char in cluster matches query:
     *     Wrap entire cluster → one <mark> covers base + all combining chars above.
     *     Combining chars belong visually to the base; wrapping together is correct.
     *
     *   Case B — only combining chars match (e.g. user typed ่ in อุ่):
     *     Split cluster: output base char plain, wrap only combining chars.
     *     Prevents highlighting อ when user only typed ่.
     *
     * @param {string} t
     * @param {Set<string>} chars  lowercased query chars
     * @returns {string}
     */
    /**
     * Tier 2 (<mark> fallback): precise per-character marking.
     *
     * Case A — base char in cluster matches query chars:
     *   Wrap entire cluster in one <mark>.
     *   Base and combining chars form one visual unit; wrapping together correct.
     *
     * Case B — only combining chars match (user typed a diacritic):
     *   Output base char undecorated.
     *   Then for each combining char: wrap in <mark> only if IT individually matches.
     *   Example: อบอุ่น + query ่
     *     cluster อุ่: base=อ (no match), ุ (no match), ่ (match)
     *     output: อ + ุ + <mark>่</mark>
     *
     * @param {string}      t
     * @param {Set<string>} chars  lowercased query chars
     * @returns {string}
     */
    _highlightViaHTML(t, chars) {
      const clusters = this._graphemeClusters(t);
      let out = '';

      for (const cluster of clusters) {
        const esc1 = (c) => c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : c;

        // Separate base and combining chars within this cluster
        let base            = '';
        const combiningList = []; // individual combining chars in order
        for (let i = 0; i < cluster.length; i++) {
          const cp = cluster.codePointAt(i) ?? 0;
          if (cp > 0xFFFF) i++;
          const ch = String.fromCodePoint(cp);
          const isCombining = (cp >= 0x0E30 && cp <= 0x0E3A)
                           || (cp >= 0x0E47 && cp <= 0x0E4E)
                           || (cp >= 0x0300 && cp <= 0x036F)
                           || (cp >= 0x1AB0 && cp <= 0x1AFF)
                           || (cp >= 0x20D0 && cp <= 0x20FF);
          if (isCombining) combiningList.push(ch);
          else             base += ch;
        }

        const baseMatches = base.toLowerCase().split('').some(c => chars.has(c));

        if (baseMatches) {
          // Case A: base char matched → wrap entire cluster as one unit
          out += `<mark>${[...cluster].map(esc1).join('')}</mark>`;
        } else if (combiningList.some(ch => chars.has(ch.toLowerCase()))) {
          // Case B: only specific combining chars match
          // Output base undecorated, then wrap each combining char individually
          out += [...base].map(esc1).join('');
          for (const ch of combiningList) {
            const e = esc1(ch);
            out += chars.has(ch.toLowerCase()) ? `<mark>${e}</mark>` : e;
          }
        } else {
          // No match — output whole cluster undecorated
          out += [...cluster].map(esc1).join('');
        }
      }
      return out;
    },

    /**
     * Clear CSS Custom Highlight registry between renders.
     * Must be called before each suggestion list render to remove stale ranges.
     */
    clearHighlights() {
      try {
        if (typeof CSS !== 'undefined' && CSS.highlights) {
          CSS.highlights.delete('sg-match');
        }
      } catch {}
    },

    /**
     * Split text into grapheme clusters (base consonant + combining marks together).
     *
     * Modern: Intl.Segmenter (Chrome 87+, Safari 16.4+, FF 125+).
     * Fallback: manual Thai combining char detection.
     *
     * Thai combining ranges (true combining only — NOT leading vowels):
     *   U+0E30–U+0E3A  sara a, aa, i, ii, ue, uee, u, uu, sara am, mai han akat
     *   U+0E47–U+0E4E  mai tai khu, tone marks, thanthakhat, nikhahit, yamakkan
     *
     * NOT included (leading vowels, visually before consonant):
     *   U+0E40–U+0E46  เ แ โ ใ ไ + mai yamok
     *
     * @param {string} text
     * @returns {string[]}
     */
    _graphemeClusters(text) {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        try {
          const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
          return Array.from(seg.segment(text), s => s.segment);
        } catch {}
      }

      const out = [];
      let cluster = '';
      for (let i = 0; i < text.length; i++) {
        const cp = text.codePointAt(i) ?? 0;
        if (cp > 0xFFFF) i++;
        const ch = String.fromCodePoint(cp);

        const isThaiCombining    = (cp >= 0x0E30 && cp <= 0x0E3A) || (cp >= 0x0E47 && cp <= 0x0E4E);
        const isGeneralCombining = (cp >= 0x0300 && cp <= 0x036F)
                                || (cp >= 0x1AB0 && cp <= 0x1AFF)
                                || (cp >= 0x20D0 && cp <= 0x20FF);

        if (isThaiCombining || isGeneralCombining) {
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
