// @ts-check
/**
 * @file rendering.js
 * RenderingService + FilterService (v6.0 — URE-backed virtual scroll)
 *
 * Changes from v5.1:
 *   - VirtualScrollEngine replaced by URE (Universal Render Engine).
 *     URE handles virtual scroll, DOM pool, diff, lazy assets — zero config.
 *   - _searchHandle: single URE instance reused across searches.
 *     First search → URE.mount(). Subsequent searches → handle.setData()
 *     so URE's diff engine only re-renders what actually changed.
 *   - disconnectRenderObserver() → destroys the URE instance + clears handle.
 *   - No other behavioral changes: copy handler, data-name, FilterService
 *     are identical to v5.1.
 *
 * URE dependency:
 *   ure.js must be loaded before search-ui.js on search/index.html.
 *   URE exposes window.URE after its own sequential module boot.
 *
 * @module rendering
 * @depends {config.js, state.js, utils.js}
 *          window.URE (ure.js — loaded before this module)
 */
(function (M) {
  'use strict';

  const {
    CONFIG, State, Handlers,
    DOMService, StringService, LanguageService, NotificationService,
  } = M;

  // ── URE instance (one per search session, reused across queries) ──────────
  //
  // WHY one instance:
  //   URE.mount() sets up ResizeObserver, scroll listener, pool, etc.
  //   Tearing that down and re-creating it on every keystroke is wasteful.
  //   handle.setData(newResults) runs URE's diff engine instead —
  //   only nodes whose content changed get a new innerHTML.
  //
  /** @type {object|null} */
  let _searchHandle = null;

  // ── Hoisted i18n cache ──────────────────────────────────────────────────
  let _lbl = { emoji: '' };
  function _refreshLabels() {
    _lbl.emoji = LanguageService.t('emoji');
  }
  _refreshLabels();

  // ── Zero-allocation helpers ─────────────────────────────────────────────

  function _wordCount(s) {
    let n = 0, inW = false;
    for (let i = 0; i < s.length; i++) {
      const ws = s.charCodeAt(i) <= 32;
      if      (!ws && !inW) { n++; inW = true; }
      else if (ws)           { inW = false; }
    }
    return n;
  }

  // ── RenderingService ──────────────────────────────────────────────────────
  const RenderingService = {

    /** Refresh i18n cache after language change. */
    refreshCache() { _refreshLabels(); },

    /**
     * Build card HTML string — passed to URE as the template function.
     *
     * data-name carries the human-readable item name (URI-encoded) so
     * _attachCopyHandler can pass it to showCopyNotification without
     * re-querying the data layer.
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

        const typeName = item.typeObj?.name?.[lang]
          || item.typeObj?.name?.en
          || item.typeName
          || _lbl.emoji;

        const catName = item.category?.name?.[lang]
          || item.category?.name?.en
          || item.catName
          || '';

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
        const encodedName = nameStr ? StringService.encodeUrl(nameStr) : '';

        return `<div class="sc${vertical ? ' sv' : ''}" role="button" tabindex="0" aria-label="${esc(nameStr || text)}" data-text="${StringService.encodeUrl(text)}" data-name="${encodedName}"><div class="scc" aria-hidden="true">${esc(disp)}</div><div class="scb"><div class="sct">${esc(titleStr)}</div><div class="scs">${esc(subStr)}</div>${tags ? `<div class="scg" aria-hidden="true">${tags}</div>` : ''}</div></div>`;
      } catch {
        return '<div class="sc"><div class="scc">-</div></div>';
      }
    },

    /**
     * Destroy the active URE instance.
     * Called before a full reset (empty query, destroy lifecycle).
     *
     * v4.0 — Also tears down the DiscoveryService URE handle so that
     *        a full reset cleans up both primary results and discovery.
     */
    disconnectRenderObserver() {
      if (_searchHandle) {
        try { _searchHandle.destroy(); } catch (_) {}
        _searchHandle = null;
      }
      DOMService.remove(DOMService.get(CONFIG.DOM.sentinelId));
      // v4.0 — Tear down discovery section too so it doesn't leak.
      if (M.DiscoveryService?.clearDiscovery) {
        try { M.DiscoveryService.clearDiscovery(); } catch (_) {}
      }
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
     * Render results via URE.
     *
     * First call: URE.mount() — creates VS instance, attaches copy handler.
     * Subsequent calls: handle.setData() — diff-aware, only changed nodes repaint.
     * Empty results: destroy URE instance, show plain empty state HTML.
     *
     * v4.0 — After rendering primary results, also triggers DiscoveryService
     *        to render the discovery section below. The discovery section
     *        shows related items so the user can keep exploring after the
     *        primary results. On empty results, discovery replaces the old
     *        random-5-suggestions block with a larger scrollable list.
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

        State.currentFilteredResults = filtered;

        if (!filtered.length) {
          // Tear down URE — empty state needs plain HTML, not a VS container
          this.disconnectRenderObserver();
          DOMService.setHTML(container, '');
          this._renderEmpty(container, lang, showSuggestionsIfNoResult);
          if (!window.__renderIsRestore) {
            if (window.SearchModules?.State?.overlayOpen) window.__overlayDidSearch = true;
            window.scrollTo({ top: 0, behavior: 'instant' });
            if (window._showStickyHeader) window._showStickyHeader();
          }
          // v4.0 — Empty-state discovery: surface related items so the
          // user has something to explore even when search returns nothing.
          // DiscoveryService.renderDiscovery handles the empty-state case
          // by showing the first N items from the dataset.
          this._triggerDiscovery('');
          return;
        }

        _refreshLabels();

        if (_searchHandle) {
          // Reuse existing URE — diff engine handles what changed
          _searchHandle.setLang(lang);
          _searchHandle.setData(filtered);
        } else {
          // First render: mount URE fresh
          DOMService.setHTML(container, '');
          this._attachCopyHandler(container);

          _searchHandle = window.URE.mount({
            container,
            data    : filtered,
            template: (item, l) => this.renderResultItem(item, l),
            lang,
            buffer  : 700,
            recycling: true,
            keyField: 'api',
          });
        }

        if (!window.__renderIsRestore) {
          if (window.SearchModules?.State?.overlayOpen) window.__overlayDidSearch = true;
          window.scrollTo({ top: 0, behavior: 'instant' });
          if (window._showStickyHeader) window._showStickyHeader();
        }

        // v4.0 — Trigger discovery rendering after primary results.
        // Reads the query from the input so we don't need an extra param.
        this._triggerDiscovery(this._currentQuery());

        M.UIService.updateUILanguage();
      } catch (e) {
        console.error('[RenderingService] renderResults failed', e);
      }
    },

    /**
     * Read the current query from the search input.
     * Used by renderResults() to pass the query to DiscoveryService
     * without changing the public method signature.
     * @returns {string}
     * @private
     */
    _currentQuery() {
      try {
        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        return inp?.value || '';
      } catch { return ''; }
    },

    /**
     * Trigger discovery rendering via DiscoveryService.
     *
     * This is a thin wrapper that defends against DiscoveryService not
     * being loaded yet (e.g., during early boot). If DiscoveryService
     * is unavailable, the call is silently skipped — primary results
     * still render normally.
     *
     * @param {string} query
     * @private
     */
    _triggerDiscovery(query) {
      try {
        if (!M.DiscoveryService?.renderDiscovery) return;
        M.DiscoveryService.renderDiscovery(query, State.currentResults || []);
      } catch (e) {
        console.warn('[RenderingService] _triggerDiscovery failed:', e);
      }
    },

    /**
     * Render the empty-state UI.
     *
     * v4.0 — Friendlier, smaller copy. The old empty state showed a
     *        large "ไม่พบข้อมูลที่ตรงหรือใกล้เคียง" message followed by
     *        5 random suggestions. The new empty state shows a smaller,
     *        friendlier message ("ไม่พบผลลัพธ์สำหรับคำค้นนี้ — ลองดูสิ่งเหล่านี้แทน")
     *        and lets DiscoveryService handle the suggestion list below.
     *
     *        The random 5 suggestions were removed because DiscoveryService
     *        now renders a larger, scrollable discovery list (12 items in
     *        empty state, 60 items in normal state) that gives the user
     *        more to explore.
     *
     * @private
     */
    _renderEmpty(container, lang, showSuggestions) {
      // v4.0 — Smaller, friendlier empty-state message.
      // The discovery section below (rendered by DiscoveryService) shows
      // related items the user can explore, so we keep this header minimal.
      const notFound = LanguageService.t('not_found');
      const hint     = LanguageService.t('not_found_hint');
      let html = '<div class="no-result no-result--compact">';
      html += `<div class="no-result__title">${notFound}</div>`;
      html += `<div class="no-result__hint">${hint}</div>`;
      html += '</div>';
      DOMService.setHTML(container, html);
      const cfEl = DOMService.get(CONFIG.DOM.categoryFilterId);
      if (cfEl) cfEl.style.display = '';
      M.UIService.updateUILanguage();
    },

    /**
     * Delegated copy handler on the results container.
     * Keyboard: Enter / Space on focused card also copies.
     *
     * Attached once on first URE mount — the container element persists
     * across setData() calls so this listener stays valid for the session.
     *
     * @private
     */
    _attachCopyHandler(container) {
      if (window._copyResultTextHandlerSet) return;

      const _copy = (card) => {
        if (!card?.hasAttribute('data-text')) return;
        const text = StringService.decodeUrl(card.getAttribute('data-text'));
        const name = StringService.decodeUrl(card.getAttribute('data-name') || '');
        NotificationService.copyText(text, name || undefined);
      };

      Handlers.copyClick = (e) => {
        const card = e.target.closest('.sc');
        if (card) { e.preventDefault(); _copy(card); }
      };
      DOMService.on(container, 'click', Handlers.copyClick);

      DOMService.on(container, 'keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const card = e.target.closest('.sc');
        if (card) { e.preventDefault(); _copy(card); }
      });

      window._copyResultTextHandlerSet = true;
    },
  };

  // ── FilterService ─────────────────────────────────────────────────────────
  const FilterService = {

    setupTypeFilter(selected = 'all') {
      try {
        const el = DOMService.get(CONFIG.DOM.typeFilterId);
        if (!el) return;
        const lang   = LanguageService.getLang();
        const active = selected || 'all';
        const pills  = [];

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

        el._pillHandler && el.removeEventListener('click', el._pillHandler);
        el._pillHandler = (e) => {
          const btn = e.target.closest('.filter-pill');
          if (!btn) return;
          const val = btn.getAttribute('data-filter-type') || 'all';
          if (val === State.selectedType) return;
          State.selectedType = val;
          el.querySelectorAll('.filter-pill').forEach(p => {
            const isActive = p.getAttribute('data-filter-type') === val;
            p.classList.toggle('active', isActive);
            p.setAttribute('aria-pressed', isActive ? 'true' : 'false');
          });
          State.selectedCategory = 'all';
          if (window.SearchModules?.SearchService) {
            window.SearchModules.SearchService.doSearch(null, false);
          }
        };
        el.addEventListener('click', el._pillHandler);
      } catch {}
    },

    setupCategoryFilter(cats, selected = 'all') {
      try {
        const el   = DOMService.get(CONFIG.DOM.categoryFilterId);
        const btn  = document.getElementById('filterCatToggle');
        const wrap = document.getElementById('filterCatWrap');
        if (!el) return;

        if (!cats || cats.length === 0) {
          el.innerHTML = '';
          if (btn)  { btn.style.visibility = 'hidden'; btn.classList.remove('active'); btn.setAttribute('aria-expanded', 'false'); }
          if (wrap) { wrap.classList.remove('open'); wrap.setAttribute('aria-hidden', 'true'); }
          const sticky = document.getElementById('search-sticky');
          if (sticky) sticky.classList.remove('cat-open');
          if (window._closeCatBar) window._closeCatBar();
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
        if (btn) btn.style.visibility = '';
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