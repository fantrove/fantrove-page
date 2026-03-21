// @ts-check
/**
 * @file rendering.js
 * RenderingService + FilterService (v5.0 — VS for main page, O(1) DOM)
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
  let _lbl = { emoji: '', clickToCopy: '', clickToCopyDemo: '' };
  function _refreshLabels() {
    _lbl.emoji           = LanguageService.t('emoji');
    _lbl.clickToCopy     = LanguageService.t('click_to_copy');
    _lbl.clickToCopyDemo = LanguageService.t('click_to_copy_demo');
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
     * Build card HTML string.
     * The entire .sc card is the click target — no copy button.
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

        return `<div class="sc${vertical ? ' sv' : ''}" role="button" tabindex="0" aria-label="${esc(nameStr || text)}" data-text="${StringService.encodeUrl(text)}"><div class="scc" aria-hidden="true">${esc(disp)}</div><div class="scb"><div class="sct">${esc(titleStr)}</div><div class="scs">${esc(subStr)}</div>${tags ? `<div class="scg" aria-hidden="true">${tags}</div>` : ''}</div></div>`;
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
     * Render results using VirtualScrollEngine.
     *
     * Hint animation logic:
     *   Check if .copy-hint is already in the container BEFORE clearing.
     *   - Hint already there  → user is refining an existing search
     *                         → restore hint without animation (stable UX)
     *   - Hint not there      → fresh appearance from placeholder/empty state
     *                         → add .copy-hint--enter to trigger CSS animation
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

        // Capture hint state BEFORE clearing — this is the critical read.
        // Must happen before setHTML('') destroys the existing hint element.
        const hintWasVisible = !!container.querySelector('.copy-hint');

        this.disconnectRenderObserver();
        State.currentFilteredResults = filtered;

        if (!filtered.length) {
          DOMService.setHTML(container, '');
          this._renderEmpty(container, lang, showSuggestionsIfNoResult);
          if (!window.__renderIsRestore) {
            if (window.SearchModules?.State?.overlayOpen) window.__overlayDidSearch = true;
            window.scrollTo({ top: 0, behavior: 'instant' });
            if (window._showStickyHeader) window._showStickyHeader();
          }
          return;
        }

        DOMService.setHTML(container, '');
        this._attachCopyHandler(container);
        _refreshLabels();

        // Build hint element.
        // Inner <span class="copy-hint__text"> is the animated text slot.
        const hint = document.createElement('div');
        hint.className = hintWasVisible ? 'copy-hint' : 'copy-hint copy-hint--enter';
        // Build inner structure: icon comes from ::before, text in a span
        const _textSpan = document.createElement('span');
        _textSpan.className   = 'copy-hint__text';
        _textSpan.textContent = _lbl.clickToCopy;
        hint.appendChild(_textSpan);
        container.appendChild(hint);

        // Interactive demo — only set up on fresh appearance
        if (!hintWasVisible) {
          let _autoRemoveTimer = null;
          let _cycleTimer      = null;

          const _texts = [ _lbl.clickToCopy, LanguageService.t('click_to_copy_demo') ];
          let   _idx   = 0;

          const _exitHint = () => {
            if (!hint.parentNode) return;
            clearInterval(_cycleTimer);
            hint.classList.remove('copy-hint--enter');
            hint.classList.add('copy-hint--exit');
            hint.addEventListener('animationend', () => {
              try { hint.remove(); } catch {}
            }, { once: true });
          };

          // Text slot cycle: slide current text down-out, swap, slide new text up-in.
          const _cycleText = () => {
            _textSpan.classList.add('copy-hint__text--out');
            setTimeout(() => {
              _idx = (_idx + 1) % _texts.length;
              _textSpan.textContent = _texts[_idx];
              _textSpan.classList.remove('copy-hint__text--out');
              _textSpan.classList.add('copy-hint__text--in');
              setTimeout(() => _textSpan.classList.remove('copy-hint__text--in'), 640);
            }, 220);  // matches --out transition duration
          };

          // Demo: flash first card 2× with tap-label overlay — NO clipboard.
          const _runDemo = () => {
            const firstCard = container.querySelector('.sc[data-text]');
            if (!firstCard) return;

            // Ensure card has position:relative for the absolute label
            const _prevPos = firstCard.style.position;
            firstCard.style.position = 'relative';

            // Create tap label overlay
            const _label = document.createElement('span');
            _label.className   = 'sc--demo-label';
            _label.textContent = '👆 ' + _lbl.clickToCopy;
            firstCard.appendChild(_label);

            const _on  = () => {
              firstCard.classList.remove('sc--demo-active');
              // force reflow so animation restarts on second flash
              void firstCard.offsetWidth;
              firstCard.classList.add('sc--demo-active');
            };
            const _off = () => firstCard.classList.remove('sc--demo-active');

            _on();
            setTimeout(_off, 350);
            setTimeout(_on,  600);
            setTimeout(() => {
              _off();
              // Fade label out then remove
              _label.style.transition = 'opacity 250ms ease';
              _label.style.opacity    = '0';
              setTimeout(() => {
                try { _label.remove(); } catch {}
                firstCard.style.position = _prevPos;
              }, 260);
            }, 950);

            NotificationService.toast('👆 ' + _lbl.clickToCopy);
          };

          // Click handler
          hint.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            clearTimeout(_autoRemoveTimer);
            _runDemo();
            setTimeout(_exitHint, 2500);
          });

          // Start cycling after enter animation completes
          hint.addEventListener('animationend', function onEntered() {
            if (hint.classList.contains('copy-hint--exit')) return;
            hint.removeEventListener('animationend', onEntered);
            // First cycle after 2.5s, then every 3s
            _cycleTimer = setTimeout(function _tick() {
              _cycleText();
              _cycleTimer = setTimeout(_tick, 3000);
            }, 2500);
            _autoRemoveTimer = setTimeout(_exitHint, 20000);
          });
        }

        // Mount VS
        const viewport = document.scrollingElement || document.documentElement;
        VirtualScrollEngine.mount(
          viewport,
          container,
          filtered,
          (item, l) => this.renderResultItem(item, l),
          lang
        );

        if (!window.__renderIsRestore) {
          if (window.SearchModules?.State?.overlayOpen) window.__overlayDidSearch = true;
          window.scrollTo({ top: 0, behavior: 'instant' });
          if (window._showStickyHeader) window._showStickyHeader();
        }

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

    /**
     * Delegated copy handler — whole .sc card is the target.
     * Keyboard: Enter / Space on focused card also copies.
     * @private
     */
    _attachCopyHandler(container) {
      if (window._copyResultTextHandlerSet) return;

      Handlers.copyClick = (e) => {
        // Guard: demo is running — do not copy to clipboard
        if (window._hintDemoBlocking) return;
        const card = e.target.closest('.sc');
        if (card?.hasAttribute('data-text')) {
          e.preventDefault();
          NotificationService.copyText(StringService.decodeUrl(card.getAttribute('data-text')));
        }
      };
      DOMService.on(container, 'click', Handlers.copyClick);

      DOMService.on(container, 'keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const card = e.target.closest('.sc');
        if (card?.hasAttribute('data-text')) {
          e.preventDefault();
          NotificationService.copyText(StringService.decodeUrl(card.getAttribute('data-text')));
        }
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
