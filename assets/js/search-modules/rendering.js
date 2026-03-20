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

        // Resolve typeName and catName from the name OBJECT in the active language.
        // Do NOT use item.typeName / item.catName — they are pre-resolved by
        // SearchEngine in a fixed language (often Thai) and do not follow the
        // current UI language, causing Thai tags to show when UI is English.
        const typeName = item.typeObj?.name?.[lang]
          || item.typeObj?.name?.en
          || item.typeName          // fallback: pre-resolved string (any lang)
          || _lbl.emoji;

        const catName = item.category?.name?.[lang]
          || item.category?.name?.en
          || item.catName           // fallback: pre-resolved string (any lang)
          || '';

        // Build display name in the ACTIVE UI LANGUAGE only.
        // Do NOT include names from other languages.
        //
        // Why: item.itemName is set by SearchEngine from the matched keyword
        // and can be in any language (e.g. Thai name when UI is English).
        // Adding it to nameSet would show both languages: "ยิ้ม / Smile".
        //
        // Rule: use data.name[lang] (UI language) as the canonical name.
        // Fall back to en only if the current language has no entry.
        // item.itemName is used only as last-resort when no name obj exists.
        const nameStr = data?.name?.[lang]
          || (lang !== 'en' ? data?.name?.en : '')
          || item.itemName
          || '';
        const text     = itemText || itemApi || '-';
        const vertical = text.length > 45
          || text.indexOf('\n') !== -1
          || _wordCount(text) > 7;
        const disp     = text.length > 300 ? text.slice(0, 300) : text;
        const esc      = StringService.escapeHtml;
        const titleStr = nameStr || data?.api || text;
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

        // Scroll to top instantly on every filter/search change.
        // Also ensure sticky header is visible (may have been scroll-hidden).
        window.scrollTo({ top: 0, behavior: 'instant' });
        if (window._showStickyHeader) window._showStickyHeader();

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

    /**
     * Build type pill buttons.
     * The container (#typeFilter) is now a div.filter-pills-row, not a <select>.
     * Clicking a pill sets State.selectedType and re-runs doSearch.
     * @param {string} [selected='all']
     */
    setupTypeFilter(selected = 'all') {
      try {
        const el = DOMService.get(CONFIG.DOM.typeFilterId);
        if (!el) return;
        const lang   = LanguageService.getLang();
        const active = selected || 'all';
        const pills  = [];

        // "All" pill
        pills.push(
          `<button class="filter-pill${active === 'all' ? ' active' : ''}" data-filter-type="all" aria-pressed="${active === 'all'}">`
          + StringService.escapeHtml(LanguageService.t('all_types'))
          + `</button>`
        );

        for (const t of (State.apiData?.type || [])) {
          const lbl = t.name?.[lang] || t.name?.en || '';
          if (!lbl) continue;
          const esc = StringService.escapeHtml(lbl);
          pills.push(
            `<button class="filter-pill${active === lbl ? ' active' : ''}" data-filter-type="${esc}" aria-pressed="${active === lbl}">`
            + esc
            + `</button>`
          );
        }

        el.innerHTML = pills.join('');
        State.selectedType = active;

        // Delegate click on the container (single listener, no per-pill binding)
        el._pillHandler && el.removeEventListener('click', el._pillHandler);
        el._pillHandler = (e) => {
          const btn = e.target.closest('.filter-pill');
          if (!btn) return;
          const val = btn.getAttribute('data-filter-type') || 'all';
          if (val === State.selectedType) return;
          State.selectedType = val;
          // Update active state visually
          el.querySelectorAll('.filter-pill').forEach(p => {
            const isActive = p.getAttribute('data-filter-type') === val;
            p.classList.toggle('active', isActive);
            p.setAttribute('aria-pressed', isActive ? 'true' : 'false');
          });
          // Reset category, re-search
          State.selectedCategory = 'all';
          if (window.SearchModules?.SearchService) {
            window.SearchModules.SearchService.doSearch(null, false);
          }
        };
        el.addEventListener('click', el._pillHandler);
      } catch {}
    },

    /**
     * Build category pill buttons.
     * Visibility is handled by grid-template-rows (0fr/1fr) + opacity in CSS.
     * We never use display:none on the inner row — it breaks grid animation.
     * @param {CategoryOption[]} cats
     * @param {string} [selected='all']
     */
    setupCategoryFilter(cats, selected = 'all') {
      try {
        const el   = DOMService.get(CONFIG.DOM.categoryFilterId);
        const btn  = document.getElementById('filterCatToggle');
        const wrap = document.getElementById('filterCatWrap');
        if (!el) return;

        // No categories — clear pills and hide toggle button.
        // Close the wrap if open. Leave display intact (grid handles hiding).
        if (!cats || cats.length === 0) {
          el.innerHTML = '';
          if (btn)  { btn.style.visibility = 'hidden'; btn.classList.remove('active'); }
          if (wrap) {
            wrap.classList.remove('open');
            wrap.setAttribute('aria-hidden', 'true');
            if (btn) btn.setAttribute('aria-expanded', 'false');
          }
          return;
        }

        const active = selected || 'all';
        const pills  = [];

        pills.push(
          `<button class="filter-pill filter-pill--cat${active === 'all' ? ' active' : ''}" data-filter-cat="all" aria-pressed="${active === 'all'}">`
          + StringService.escapeHtml(LanguageService.t('all_categories'))
          + `</button>`
        );

        for (const { key, displayName } of cats) {
          if (!key) continue;
          const esc = StringService.escapeHtml(key);
          const lbl = StringService.escapeHtml(displayName || key);
          pills.push(
            `<button class="filter-pill filter-pill--cat${active === key ? ' active' : ''}" data-filter-cat="${esc}" aria-pressed="${active === key}">`
            + lbl
            + `</button>`
          );
        }

        el.innerHTML = pills.join('');
        // Reveal toggle button (was hidden when no cats)
        if (btn) btn.style.visibility = '';
        // Update --cat-bar-h so CSS spacer has correct height
        if (window._updateCatBarHeight) requestAnimationFrame(window._updateCatBarHeight);

        el._pillHandler && el.removeEventListener('click', el._pillHandler);
        el._pillHandler = (e) => {
          const p = e.target.closest('.filter-pill--cat');
          if (!p) return;
          const val = p.getAttribute('data-filter-cat') || 'all';
          if (val === State.selectedCategory) return;
          State.selectedCategory = val;
          el.querySelectorAll('.filter-pill--cat').forEach(chip => {
            const isActive = chip.getAttribute('data-filter-cat') === val;
            chip.classList.toggle('active', isActive);
            chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
          });
          RenderingService.renderResults(State.currentResults);
        };
        el.addEventListener('click', el._pillHandler);
      } catch {}
    },
  };

  M.RenderingService = RenderingService;
  M.FilterService    = FilterService;

})(window.SearchModules = window.SearchModules || {});
