// @ts-check
/**
 * @file rendering.js
 * RenderingService — builds card HTML, renders results to the main page.
 * FilterService    — populates type/category <select> elements.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Rendering architecture (v4.5)                              │
 * │                                                             │
 * │  ROOT CAUSE of "smooth top 20, lag rest, smooth return":   │
 * │                                                             │
 * │  content-visibility:auto defers layout for off-screen       │
 * │  cards (correct). But "first-time layout" on scroll arrival │
 * │  costs 1-3ms per card on low-end mobile. Browser only       │
 * │  pre-renders ~2-3 screenfulls ahead natively. Cards beyond  │
 * │  that zone → layout on scroll thread → jank.               │
 * │  Return to top → heights cached via contain-intrinsic:auto  │
 * │  → smooth again. This EXACTLY matches the reported pattern. │
 * │                                                             │
 * │  FIX: IntersectionObserver pre-reveal (production pattern)  │
 * │                                                             │
 * │  After ONE DOM insert (all cards), observe all cards with   │
 * │  rootMargin: '0px 0px 800px 0px' (~4 screenfulls ahead).   │
 * │                                                             │
 * │  When a card enters this pre-render zone:                   │
 * │   → requestIdleCallback: add class '.cv-prerendered'        │
 * │   → CSS: .cv-prerendered { content-visibility: visible }    │
 * │   → Browser does first-time layout NOW (idle, not scroll)   │
 * │   → contain-intrinsic-size:auto caches real height          │
 * │   → Unobserve (each card processed exactly once)            │
 * │                                                             │
 * │  By scroll arrival: layout already done → smooth.           │
 * │  Cards never scrolled to: stay as content-visibility:auto.  │
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

  const SYNC_LIMIT = 300;
  const _tpl = document.createElement('template');

  // ── RenderingService ──────────────────────────────────────────────────────
  const RenderingService = {
    /** @type {IntersectionObserver|null} */
    _preRenderIO: null,

    /**
     * Build HTML for one result card.
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
     * IntersectionObserver pre-reveal.
     *
     * Observes all off-screen cards with rootMargin 800px (below viewport).
     * When a card enters the 800px zone, idle callback adds .cv-prerendered
     * → CSS sets content-visibility:visible → browser does layout during idle.
     * Each card is unobserved immediately and processed exactly once.
     *
     * @private
     * @param {Element} container
     */
    _setupPreRender(container) {
      if (!('IntersectionObserver' in window)) return;
      if (this._preRenderIO) this._preRenderIO.disconnect();

      const self = this;

      this._preRenderIO = new IntersectionObserver((entries) => {
        // Collect cards entering the pre-render zone
        const toReveal = [];
        for (const e of entries) {
          if (e.isIntersecting) {
            toReveal.push(/** @type {HTMLElement} */ (e.target));
            self._preRenderIO?.unobserve(e.target);
          }
        }
        if (!toReveal.length) return;

        // Force layout during idle time — never on scroll thread
        const reveal = () => {
          for (const el of toReveal) el.classList.add('cv-prerendered');
        };

        if ('requestIdleCallback' in window) {
          requestIdleCallback(reveal, { timeout: 50 });
        } else {
          setTimeout(reveal, 0);
        }
      }, {
        // Watch 800px below viewport — ~4 screenfulls ahead on mobile
        rootMargin: '0px 0px 800px 0px',
        threshold : 0,
      });

      // Only observe cards that are NOT yet in viewport or close to it.
      // Cards already visible are being rendered by browser natively.
      const vh    = window.innerHeight;
      const cards = container.querySelectorAll('.search-card');
      for (const card of cards) {
        const top = card.getBoundingClientRect().top;
        // Observe only cards that start below the visible area + small buffer
        if (top > vh + 50) this._preRenderIO.observe(card);
      }
    },

    /**
     * Large result set: build HTML strings in idle chunks → ONE insert.
     * String concat never touches DOM. Layout only happens in the final rAF.
     * @private
     */
    _buildAndInsert(items, container, lang) {
      const self  = this;
      const parts = [];
      let   idx   = 0;
      const BATCH = 50;

      const buildChunk = (/** @type {any} */ deadline) => {
        while (idx < items.length) {
          const hasTime      = deadline?.timeRemaining ? deadline.timeRemaining() > 2 : true;
          const inputPending = navigator.scheduling?.isInputPending?.({ includeContinuous: true }) ?? false;
          if (!hasTime || inputPending) break;
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
