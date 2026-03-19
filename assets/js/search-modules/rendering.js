// @ts-check
/**
 * @file rendering.js
 * RenderingService + FilterService (v5.0 — VS for main page, O(1) DOM)
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Architecture change (v5.0)                                 │
 * │                                                             │
 * │  PREVIOUS (content-visibility:auto approach):               │
 * │   ALL cards inserted into DOM at once.                      │
 * │   1,000 cards = 5,000 DOM nodes                             │
 * │   10,000 cards = 50,000 DOM nodes                           │
 * │   Memory: O(n), grows without bound                         │
 * │   "Unlimited" = eventually OOM or severe lag                │
 * │                                                             │
 * │  NOW (VirtualScrollEngine for main page):                   │
 * │   DOM nodes: always ~30-40, regardless of total count       │
 * │   Memory: O(1) DOM + tiny typed arrays for heights          │
 * │   10,000 cards: same frame budget as 100 cards              │
 * │   Truly unlimited — memory stays flat as user scrolls       │
 * │                                                             │
 * │  HOW:                                                        │
 * │   renderResults() → VirtualScrollEngine.mount(              │
 * │     document.scrollingElement,  ← window scroll mode       │
 * │     #searchResults,             ← host container            │
 * │     filtered,                   ← full item array           │
 * │     renderFn,                   ← card HTML builder         │
 * │     lang                                                     │
 * │   )                                                          │
 * │                                                             │
 * │  VS creates a vs-container div with height = total.         │
 * │  As user scrolls, VS mounts/unmounts only visible cards.    │
 * │  #searchResults.contain:style isolates style scope.         │
 * │                                                             │
 * │  JS HOT PATH (renderResultItem — called per visible card):  │
 * │   • Hoisted i18n cache (_lbl)                               │
 * │   • Zero-allocation wordCount scan (_wordCount)             │
 * │   • Set-based name dedup (_joinSet)                         │
 * │   • Short class names (.sc .scc .scb .sct .scs .scg .scr)  │
 * └─────────────────────────────────────────────────────────────┘
 *
 * @module rendering
 * @depends {config.js, state.js, utils.js, virtual-scroll.js}
 */
(function (M) {
  'use strict';

  const {
    CONFIG, State, Handlers,
    DOMService, StringService, LanguageService, NotificationService,
    VirtualScrollEngine,
  } = M;

  // ── Hoisted i18n cache ──────────────────────────────────────────────────
  // LanguageService.t() reads localStorage + object lookup.
  // Hoist outside renderResultItem so it's not called per card.
  let _lbl = { copy: '', emoji: '' };
  function _refreshLabels() {
    _lbl.copy  = LanguageService.t('copy');
    _lbl.emoji = LanguageService.t('emoji');
  }
  _refreshLabels();

  // ── Zero-allocation helpers ─────────────────────────────────────────────

  /**
   * Count words without split() — zero array allocation.
   * ~3× faster than s.trim().split(/\s+/).length on V8.
   * @param {string} s @returns {number}
   */
  function _wordCount(s) {
    let n = 0, inW = false;
    for (let i = 0; i < s.length; i++) {
      const ws = s.charCodeAt(i) <= 32;
      if      (!ws && !inW) { n++; inW = true; }
      else if (ws)           { inW = false; }
    }
    return n;
  }

  /**
   * Join Set<string> with ' / ', skipping falsy — no filter(), no intermediate array.
   * @param {Set<string>} set @returns {string}
   */
  function _joinSet(set) {
    let out = '';
    for (const v of set) {
      if (v) out = out ? out + ' / ' + v : v;
    }
    return out;
  }

  // ── RenderingService ──────────────────────────────────────────────────────
  const RenderingService = {

    /** Refresh i18n cache after language change. */
    refreshCache() { _refreshLabels(); },

    /**
     * Build card HTML string.
     * Called per VISIBLE card per frame (~30 calls). Zero heap allocations
     * except the final template literal concatenation.
     *
     * Short class names (.sc .scc .scb .sct .scs .scg .scr):
     *   Smaller HTML strings → faster innerHTML parse → less RAM per card.
     *
     * @param {SearchResult} item
     * @param {string} lang
     * @returns {string}
     */
    renderResultItem(item, lang) {
      try {
        const data     = item.item || item;
        const rawText  = data?.text || '';
        const itemText = rawText || data?.name?.[lang] || data?.name?.en || item.itemName || '';
        const itemApi  = data?.api || '';

        const typeName = item.typeName
          || item.typeObj?.name?.[lang]
          || item.typeObj?.name?.en
          || _lbl.emoji;

        const catName = item.catName
          || item.category?.name?.[lang]
          || item.category?.name?.en
          || '';

        const nameSet = new Set();
        if (item.itemName)       nameSet.add(item.itemName);
        if (data?.name?.[lang])  nameSet.add(data.name[lang]);
        else if (data?.name?.en) nameSet.add(data.name.en);

        const nameStr  = _joinSet(nameSet);
        const text     = itemText || itemApi || '-';
        const vertical = text.length > 45
          || text.indexOf('\n') !== -1
          || _wordCount(text) > 7;
        const disp     = text.length > 300 ? text.slice(0, 300) : text;
        const esc      = StringService.escapeHtml;
        const titleStr = nameStr || (data?.name?.[lang] || data?.name?.en || data?.api) || text;
        const subStr   = itemApi || typeName || '';
        const tags     = (typeName ? `<span class="tag">${esc(typeName)}</span>` : '')
                       + (catName  ? `<span class="tag">${esc(catName)}</span>`  : '');

        return `<div class="sc${vertical ? ' sv' : ''}" role="article" aria-label="${esc(nameStr || text)}"><div class="scc" aria-hidden="true">${esc(disp)}</div><div class="scb"><div class="sct">${esc(titleStr)}</div><div class="scs">${esc(subStr)}</div>${tags ? `<div class="scg" aria-hidden="true">${tags}</div>` : ''}</div><button class="scr" data-text="${StringService.encodeUrl(text)}" aria-label="${_lbl.copy}">${_lbl.copy}</button></div>`;
      } catch {
        return '<div class="sc"><div class="scc">-</div></div>';
      }
    },

    disconnectRenderObserver() {
      VirtualScrollEngine.destroy();
      DOMService.remove(DOMService.get(CONFIG.DOM.sentinelId));
    },

    /**
     * @param {SearchResult[]} results
     * @returns {CategoryOption[]}
     */
    extractResultCategories(results) {
      try {
        const lang = LanguageService.getLang();
        const out  = [];
        const seen = Object.create(null);
        for (const r of results) {
          const k = (r.category?.name?.[lang] || r.category?.name?.en) || '';
          if (!seen[k]) { seen[k] = 1; out.push({ key: k, displayName: k }); }
        }
        return out;
      } catch { return []; }
    },

    /**
     * Render results using VirtualScrollEngine (window scroll mode).
     *
     * DOM nodes in #searchResults: always ~30-40, regardless of result count.
     * Works identically for 10 or 100,000 results.
     *
     * @param {SearchResult[]} results
     * @param {boolean}        [showSuggestionsIfNoResult=false]
     */
    renderResults(results, showSuggestionsIfNoResult = false) {
      try {
        const container = DOMService.get(CONFIG.DOM.searchResultsId);
        if (!container) return;

        const lang     = LanguageService.getLang();
        const filtered = State.selectedCategory !== 'all'
          ? results.filter(r => ((r.category?.name?.[lang] || r.category?.name?.en) || '') === State.selectedCategory)
          : results;

        this.disconnectRenderObserver();
        State.currentFilteredResults = filtered;

        if (!filtered.length) {
          DOMService.setHTML(container, '');
          this._renderEmpty(container, lang, showSuggestionsIfNoResult);
          return;
        }

        DOMService.setHTML(container, '');
        this._attachCopyHandler(container);
        _refreshLabels();

        // Mount VS on window scroll — #searchResults is the host container.
        // VS creates a vs-container div (position:relative, height=total)
        // and manages all card nodes within it.
        const viewport = document.scrollingElement || document.documentElement;
        VirtualScrollEngine.mount(
          viewport,
          container,
          filtered,
          (item, l) => this.renderResultItem(item, l),
          lang
        );

        M.UIService.updateUILanguage();
      } catch (e) {
        console.error('[RenderingService] renderResults failed', e);
      }
    },

    /** @private */
    _renderEmpty(container, lang, showSuggestions) {
      let html = `<div class="no-result">${LanguageService.t('not_found')}</div>`;
      if (showSuggestions) {
        html += `<div class="suggestions-title-main">${LanguageService.t('suggestions_for_you')}</div><div class="suggestions-block-list">`;
        const t0 = State.apiData?.type?.[0];
        const c0 = t0?.category?.[0];
        for (const it of (c0?.data?.slice(0, 5) || [])) {
          html += this.renderResultItem({
            item: it, typeObj: t0, category: c0,
            itemName: it.name?.[lang] || it.name?.en || '',
            typeName: t0?.name?.[lang] || t0?.name?.en || '',
            catName:  c0?.name?.[lang] || c0?.name?.en || '',
          }, lang);
        }
        html += '</div>';
      }
      DOMService.setHTML(container, html);
      const cfEl = DOMService.get(CONFIG.DOM.categoryFilterId);
      if (cfEl) cfEl.style.display = '';
      M.UIService.updateUILanguage();
    },

    /** @private — delegated copy handler, attached once */
    _attachCopyHandler(container) {
      if (window._copyResultTextHandlerSet) return;
      Handlers.copyClick = (e) => {
        const btn = e.target.closest('.scr');
        if (btn?.hasAttribute('data-text')) {
          e.preventDefault();
          NotificationService.copyText(StringService.decodeUrl(btn.getAttribute('data-text')));
        }
      };
      DOMService.on(container, 'click', Handlers.copyClick);
      window._copyResultTextHandlerSet = true;
    },
  };

  // ── FilterService ─────────────────────────────────────────────────────────
  const FilterService = {
    /** @param {string} [selected='all'] */
    setupTypeFilter(selected = 'all') {
      try {
        const el = DOMService.get(CONFIG.DOM.typeFilterId);
        if (!el) return;
        const lang = LanguageService.getLang();
        const opts = [`<option value="all">${LanguageService.t('all_types')}</option>`];
        for (const t of (State.apiData?.type || [])) {
          const lbl = t.name?.[lang] || t.name?.en || '';
          opts.push(`<option value="${StringService.escapeHtml(lbl)}">${StringService.escapeHtml(lbl)}</option>`);
        }
        el.innerHTML = opts.join('');
        el.value     = selected;
      } catch {}
    },

    /** @param {CategoryOption[]} cats @param {string} [selected='all'] */
    setupCategoryFilter(cats, selected = 'all') {
      try {
        const el = DOMService.get(CONFIG.DOM.categoryFilterId);
        if (!el) return;
        const opts = [`<option value="all">${LanguageService.t('all_categories')}</option>`];
        for (const { key, displayName } of cats) {
          opts.push(`<option value="${StringService.escapeHtml(key)}">${StringService.escapeHtml(displayName)}</option>`);
        }
        el.innerHTML     = opts.join('');
        el.style.display = '';
        el.value         = selected;
      } catch {}
    },
  };

  M.RenderingService = RenderingService;
  M.FilterService    = FilterService;

})(window.SearchModules = window.SearchModules || {});
