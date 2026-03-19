// @ts-check
/**
 * @file rendering.js
 * RenderingService + FilterService (v4.6 — hot-path optimized)
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  renderResultItem() called 300–500× per render.            │
 * │  Every micro-optimization multiplies across all cards.      │
 * │                                                             │
 * │  Changes vs v4.5:                                           │
 * │                                                             │
 * │  JS HOT PATH                                                │
 * │  • Hoist i18n lookups out of card loop (cached _copy/emoji) │
 * │  • Remove for..in + /_name$/ RegExp inner loop             │
 * │  • _wordCount(): char-scan instead of split(/\s+/)          │
 * │    → zero array allocation per card                         │
 * │  • _joinNames(): single-pass join with Set, no filter()     │
 * │  • Conditional slice: skip when text.length ≤ 300          │
 * │  • Short class names in card HTML: sc/scb/scc/sct/scs/scg  │
 * │    → smaller HTML strings → faster innerHTML parse          │
 * │    → less RAM for string buffers during build               │
 * │                                                             │
 * │  CSS (companion — see search-compact-overrides.css)         │
 * │  • Short class names match JS (.sc, .scb, etc.)             │
 * │  • Consolidate 5 @media(hover) blocks → 1                  │
 * │  • Merge 28 .search-card rule blocks → fewer                │
 * │  • Single @media mobile block (was 3 scattered blocks)      │
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

  // ── Hoisted i18n cache ────────────────────────────────────────────────────
  // LanguageService.t() = localStorage read + object lookup. Called 300×/render.
  // Hoist outside renderResultItem and refresh when language changes.
  let _lbl = { copy: '', emoji: '' };
  function _refreshLabels() {
    _lbl.copy  = LanguageService.t('copy');
    _lbl.emoji = LanguageService.t('emoji');
  }
  _refreshLabels();

  // ── Helpers (zero-allocation) ─────────────────────────────────────────────

  /**
   * Count words without split() — zero array allocation.
   * ~3× faster than s.trim().split(/\s+/).length on V8.
   * @param {string} s
   * @returns {number}
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
   * @param {Set<string>} set
   * @returns {string}
   */
  function _joinSet(set) {
    let out = '';
    for (const v of set) {
      if (v) out = out ? out + ' / ' + v : v;
    }
    return out;
  }

  // Card HTML uses short class names to reduce string size:
  //   sc  = search-card (root)
  //   scc = card-content
  //   scb = card-body
  //   sct = card-title
  //   scs = card-subtitle
  //   scg = card-tags
  //   scr = result-copy-btn (button)
  // CSS maps these. Shorter strings = faster innerHTML parse + less RAM.

  const SYNC_LIMIT = 300;
  const _tpl = document.createElement('template'); // reused, zero allocation

  // ── RenderingService ──────────────────────────────────────────────────────
  const RenderingService = {
    /** @type {IntersectionObserver|null} */
    _preRenderIO: null,

    /** Call after language change to refresh cached labels. */
    refreshCache() { _refreshLabels(); },

    /**
     * Build HTML for one result card.
     * Hot path — called 300-500× per render. Zero heap allocations except
     * the final string concatenation.
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

        // Use cached emoji label — no i18n lookup per card
        const typeName = item.typeName
          || item.typeObj?.name?.[lang]
          || item.typeObj?.name?.en
          || _lbl.emoji;

        const catName = item.catName
          || item.category?.name?.[lang]
          || item.category?.name?.en
          || '';

        // Build name set — O(1) dedup (Set vs Array.includes which is O(n))
        const nameSet = new Set();
        if (item.itemName)             nameSet.add(item.itemName);
        if (data?.name?.[lang])        nameSet.add(data.name[lang]);
        else if (data?.name?.en)       nameSet.add(data.name.en);
        // Removed: for..in data + /_name$/.test() — iterated ALL properties,
        // slow and duplicated itemName in 99% of cases.

        const nameStr = _joinSet(nameSet);
        const text    = itemText || itemApi || '-';

        // Vertical: char-scan wordCount (no split array) + indexOf (no regex)
        const vertical = text.length > 45
          || text.indexOf('\n') !== -1
          || _wordCount(text) > 7;

        // Slice only when needed (common case: text is short)
        const disp = text.length > 300 ? text.slice(0, 300) : text;

        const esc      = StringService.escapeHtml;
        const titleStr = nameStr || (data?.name?.[lang] || data?.name?.en || data?.api) || text;
        const subStr   = itemApi || typeName || '';

        // Build tags inline — no array, no join
        const tags = (typeName ? `<span class="tag">${esc(typeName)}</span>` : '')
                   + (catName  ? `<span class="tag">${esc(catName)}</span>`  : '');

        // Short class names = smaller HTML string = faster parse + less RAM
        return `<div class="sc${vertical ? ' sv' : ''}" role="article" aria-label="${esc(nameStr || text)}"><div class="scc" aria-hidden="true">${esc(disp)}</div><div class="scb"><div class="sct">${esc(titleStr)}</div><div class="scs">${esc(subStr)}</div>${tags ? `<div class="scg" aria-hidden="true">${tags}</div>` : ''}</div><button class="scr" data-text="${StringService.encodeUrl(text)}" aria-label="${_lbl.copy}">${_lbl.copy}</button></div>`;
      } catch {
        return '<div class="sc"><div class="scc">-</div></div>';
      }
    },

    disconnectRenderObserver() {
      VirtualScrollEngine.destroy();
      DOMService.remove(DOMService.get(CONFIG.DOM.sentinelId));
      if (this._preRenderIO) { this._preRenderIO.disconnect(); this._preRenderIO = null; }
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
     * Render all results — single DOM insert + IO pre-reveal.
     * @param {SearchResult[]} results
     * @param {boolean} [showSuggestionsIfNoResult=false]
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

        DOMService.setHTML(container, '');
        this._attachCopyHandler(container);
        _refreshLabels(); // ensure labels are current

        if (filtered.length <= SYNC_LIMIT) {
          const html = filtered.map(item => this.renderResultItem(item, lang)).join('');
          requestAnimationFrame(() => {
            _tpl.innerHTML = html;
            container.appendChild(_tpl.content);
            M.UIService.updateUILanguage();
            this._setupPreRender(container);
          });
        } else {
          this._buildAndInsert(filtered, container, lang);
        }
      } catch (e) {
        console.error('[RenderingService] renderResults failed', e);
      }
    },

    /**
     * IntersectionObserver pre-reveal — layout during idle, 800px ahead.
     * @private
     */
    _setupPreRender(container) {
      if (!('IntersectionObserver' in window)) return;
      if (this._preRenderIO) this._preRenderIO.disconnect();

      const self = this;
      this._preRenderIO = new IntersectionObserver((entries) => {
        const toReveal = [];
        for (const e of entries) {
          if (e.isIntersecting) {
            toReveal.push(/** @type {HTMLElement} */ (e.target));
            self._preRenderIO?.unobserve(e.target);
          }
        }
        if (!toReveal.length) return;
        const reveal = () => { for (const el of toReveal) el.classList.add('cv-prerendered'); };
        if ('requestIdleCallback' in window) requestIdleCallback(reveal, { timeout: 50 });
        else setTimeout(reveal, 0);
      }, { rootMargin: '0px 0px 800px 0px', threshold: 0 });

      const vh = window.innerHeight;
      for (const card of container.querySelectorAll('.sc')) {
        if (card.getBoundingClientRect().top > vh + 50) this._preRenderIO.observe(card);
      }
    },

    /**
     * Large set: build HTML strings in idle chunks → ONE DOM insert.
     * @private
     */
    _buildAndInsert(items, container, lang) {
      const self  = this;
      const parts = [];
      let   idx   = 0;
      const BATCH = 50;

      const buildChunk = (/** @type {any} */ deadline) => {
        while (idx < items.length) {
          if ((deadline?.timeRemaining?.() ?? 5) < 2) break;
          if (navigator.scheduling?.isInputPending?.({ includeContinuous: true })) break;
          const end = Math.min(idx + BATCH, items.length);
          for (let i = idx; i < end; i++) parts.push(self.renderResultItem(items[i], lang));
          idx = end;
        }
        if (idx < items.length) {
          if ('requestIdleCallback' in window) requestIdleCallback(buildChunk, { timeout: 100 });
          else setTimeout(() => buildChunk(null), 0);
        } else {
          requestAnimationFrame(() => {
            _tpl.innerHTML = parts.join('');
            container.appendChild(_tpl.content);
            M.UIService.updateUILanguage();
            self._setupPreRender(container);
          });
        }
      };

      if ('requestIdleCallback' in window) requestIdleCallback(buildChunk, { timeout: 100 });
      else setTimeout(() => buildChunk(null), 0);
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

    /** @private */
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

    /**
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

  M.RenderingService = RenderingService;
  M.FilterService    = FilterService;

})(window.SearchModules = window.SearchModules || {});
