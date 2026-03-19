// @ts-check
/**
 * @file rendering.js
 * RenderingService — builds card HTML, renders results via VirtualScrollEngine.
 * FilterService    — populates type/category <select> elements.
 *
 * Results always render to #searchResults on the main page (never overlay).
 *
 * Rendering strategy (v4.1):
 *   VirtualScrollEngine with window scroll — only ~20 nodes in DOM at any time.
 *   This eliminates the content-visibility:auto jank pattern where each card
 *   triggered a layout restoration as it entered the viewport.
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

  // ── RenderingService ──────────────────────────────────────────────────────
  const RenderingService = {

    /**
     * Build HTML string for one result card.
     * Layout heuristic (vertical vs horizontal) avoids DOM measurement.
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
        const typeName = item.typeName || item.typeObj?.name?.[lang] || item.typeObj?.name?.en || LanguageService.t('emoji');
        const catName  = item.catName  || item.category?.name?.[lang] || item.category?.name?.en || '';

        // Collect all display names
        const names = [];
        if (item.itemName) names.push(item.itemName);
        if (data?.name) {
          const n = data.name[lang] || data.name.en;
          if (n && !names.includes(n)) names.push(n);
        }
        for (const k in (data || {})) {
          if (/_name$/.test(k) && data[k]) {
            const n = data[k][lang] || data[k].en;
            if (n && !names.includes(n)) names.push(n);
          }
        }

        const nameStr  = names.filter(Boolean).join(' / ');
        const text     = itemText || itemApi || '-';
        const vertical = text.includes('\n') || text.length > 45 || text.trim().split(/\s+/).length > 7;
        const esc      = StringService.escapeHtml;

        return `<div class="result-item search-card${vertical ? ' vertical' : ''}" role="article" aria-label="${esc(nameStr || text)}">
  <div class="card-content" aria-hidden="true">${esc(String(text).slice(0, 300))}</div>
  <div class="card-body">
    <div class="card-title">${esc(nameStr || (data?.name?.[lang] || data?.name?.en || data?.api) || text)}</div>
    <div class="card-subtitle">${esc(itemApi || typeName || '')}</div>
    <div class="card-tags" aria-hidden="true">
      ${typeName ? `<span class="tag">${esc(typeName)}</span>` : ''}
      ${catName  ? `<span class="tag">${esc(catName)}</span>`  : ''}
    </div>
  </div>
  <button class="result-copy-btn" data-text="${StringService.encodeUrl(text)}" aria-label="${LanguageService.t('copy')}">${LanguageService.t('copy')}</button>
</div>`;
      } catch {
        return '<div class="result-item"><div class="result-content-area">-</div></div>';
      }
    },

    /** Destroy virtual scroller and remove legacy sentinel. */
    disconnectRenderObserver() {
      VirtualScrollEngine.destroy();
      DOMService.remove(DOMService.get(CONFIG.DOM.sentinelId));
    },

    /**
     * Extract unique category options from a result list.
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
     * Render results to #searchResults on the main page.
     *
     * Uses VirtualScrollEngine with window scroll so only the visible window
     * of cards (~20 nodes) is ever in the DOM. This replaces the old
     * _batchRender approach that dumped all cards into DOM at once and
     * relied on content-visibility:auto for deferred layout — which caused
     * per-card layout restoration jank as each card entered the viewport.
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

        document.body.style.marginBottom = '60px';
        this.disconnectRenderObserver();
        State.currentFilteredResults = filtered;

        if (!filtered.length) {
          this._renderEmpty(container, lang, showSuggestionsIfNoResult);
          return;
        }

        // Clear container — VS engine will manage all child nodes
        DOMService.setHTML(container, '');

        // Use window as the scroll viewport for main page results.
        // document.scrollingElement is the root scroll element (html or body).
        const viewport = document.scrollingElement || document.documentElement;

        VirtualScrollEngine.mount(
          viewport,
          container,
          filtered,
          (item, l) => this.renderResultItem(item, l),
          lang
        );

        // Attach copy handler once (delegated click on the container)
        this._attachCopyHandler(container);
        M.UIService.updateUILanguage();
      } catch (e) {
        console.error('[RenderingService] renderResults failed', e);
      }
    },

    // ── Private helpers ───────────────────────────────────────────────────────

    /** @private */
    _renderEmpty(container, lang, showSuggestions) {
      let html = `<div class="no-result">${LanguageService.t('not_found')}</div>`;

      if (showSuggestions) {
        html += `<div class="suggestions-title-main">${LanguageService.t('suggestions_for_you')}</div><div class="suggestions-block-list">`;
        const t0 = State.apiData?.type?.[0];
        const c0 = t0?.category?.[0];
        for (const it of (c0?.data?.slice(0, 5) || [])) {
          html += this.renderResultItem({
            item     : it,
            typeObj  : t0,
            category : c0,
            itemName : it.name?.[lang] || it.name?.en || '',
            typeName : t0?.name?.[lang] || t0?.name?.en || '',
            catName  : c0?.name?.[lang] || c0?.name?.en || '',
          }, lang);
        }
        html += '</div>';
      }

      DOMService.setHTML(container, html);
      const cfEl = DOMService.get(CONFIG.DOM.categoryFilterId);
      if (cfEl) cfEl.style.display = '';
      M.UIService.updateUILanguage();
    },

    /** @private — attach delegated copy handler once per container lifetime */
    _attachCopyHandler(container) {
      if (window._copyResultTextHandlerSet) return;
      Handlers.copyClick = (e) => {
        const btn = e.target.closest('.result-copy-btn');
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
     * Populate the type <select> from State.apiData.
     * @param {string} [selected='all']
     */
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

    /**
     * Populate the category <select>.
     * @param {CategoryOption[]} cats
     * @param {string} [selected='all']
     */
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

  // ── Exports ───────────────────────────────────────────────────────────────
  M.RenderingService = RenderingService;
  M.FilterService    = FilterService;

})(window.SearchModules = window.SearchModules || {});
