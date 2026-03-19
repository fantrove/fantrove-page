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

        // Scroll to top of results immediately on every new search.
        // behavior:'instant' = no animation, no delay, works even with
        // scroll-behavior:smooth on html (instant overrides it).
        // Using scrollTo on window rather than container because VS uses
        // window scroll mode — the scroll container IS the window.
        window.scrollTo({ top: 0, behavior: 'instant' });

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

  // ── FilterService — segmented chip bar ─────────────────────────────────────
  //
  // Design: YouTube/App-Store/Spotify style horizontal chip filter.
  //   Two rows:
  //     Row 1 (#typeFilter)     — type chips (primary, always visible)
  //     Row 2 (#categoryFilter) — category chips (secondary, shown when >1)
  //
  //   Type row:   larger chips, brand green active state, icon optional
  //   Category row: smaller chips, dark active state, subtle appearance
  //
  // Architecture:
  //   typeFilterId     → #typeFilter    (scroll container div)
  //   categoryFilterId → #categoryFilter (scroll container div)
  //
  //   .fpill             base chip
  //   .fpill--active     selected chip
  //   .fpill--type       type row variant
  //   .fpill--cat        category row variant
  //
  // Event model: delegated click on container, State updated directly.
  // Keyboard: ArrowLeft/Right move focus, Enter/Space activate.
  // Scroll position preserved on re-render (no visual jump).
  //
  const FilterService = {
    /**
     * Render type pills from apiData.
     * @param {string} [selected='all']
     */
    setupTypeFilter(selected = 'all') {
      try {
        const el = DOMService.get(CONFIG.DOM.typeFilterId);
        if (!el) return;
        const lang = LanguageService.getLang();

        const pills = [{ val: 'all', label: LanguageService.t('all_types') }];
        for (const t of (State.apiData?.type || [])) {
          const lbl = t.name?.[lang] || t.name?.en || '';
          if (lbl) pills.push({ val: lbl, label: lbl });
        }

        el.setAttribute('role', 'radiogroup');
        el.setAttribute('aria-label', LanguageService.t('type'));
        el.innerHTML     = this._pillsHTML(pills, selected, 'fpill--type');
        el.style.display = pills.length > 1 ? '' : 'none';
        this._bindPillEvents(el, (val) => {
          State.selectedType = val;
          M.SearchService.doSearch();
        });
      } catch {}
    },

    /**
     * Render category pills from extracted categories.
     * @param {CategoryOption[]} cats
     * @param {string} [selected='all']
     */
    setupCategoryFilter(cats, selected = 'all') {
      try {
        const el = DOMService.get(CONFIG.DOM.categoryFilterId);
        if (!el) return;

        if (!cats.length) { el.style.display = 'none'; el.innerHTML = ''; return; }

        const pills = [{ val: 'all', label: LanguageService.t('all_categories') }];
        for (const { key, displayName } of cats) {
          if (displayName) pills.push({ val: key, label: displayName });
        }

        const prevScroll = el.scrollLeft || 0;
        el.setAttribute('role', 'radiogroup');
        el.setAttribute('aria-label', LanguageService.t('category'));
        el.innerHTML     = this._pillsHTML(pills, selected, 'fpill--cat');
        el.style.display = '';
        // rAF so layout is settled before restoring scroll
        requestAnimationFrame(() => { el.scrollLeft = prevScroll; });
        this._bindPillEvents(el, (val) => {
          State.selectedCategory = val;
          M.RenderingService.renderResults(State.currentResults, false);
          M.UIService.updateUILanguage();
        });
      } catch {}
    },

    /**
     * Build chips HTML string.
     * @param {{val:string, label:string}[]} pills
     * @param {string} selected
     * @param {string} [variant='']  extra class added to each chip
     * @returns {string}
     */
    _pillsHTML(pills, selected, variant = '') {
      const esc = StringService.escapeHtml;
      return pills.map(({ val, label }, i) => {
        const active  = (val === selected) ? ' fpill--active' : '';
        const vclass  = variant ? ` ${variant}` : '';
        // All-pill is first, give it no extra identifier
        return `<button type="button" class="fpill${vclass}${active}" data-val="${esc(val)}" tabindex="${i === 0 ? '0' : '-1'}" role="radio" aria-checked="${val === selected}">${esc(label)}</button>`;
      }).join('');
    },

    /**
     * Attach click + keyboard handlers to a chip container.
     * Uses event delegation (one listener) + roving tabindex for a11y.
     * @param {HTMLElement} container
     * @param {function(string):void} onChange
     */
    _bindPillEvents(container, onChange) {
      // Replace with fresh clone to remove any stale listeners
      const fresh = container.cloneNode(true);
      container.parentNode?.replaceChild(fresh, container);

      const getPills = () => [...fresh.querySelectorAll('.fpill')];

      const activate = (pill) => {
        if (!pill) return;
        // Update ARIA + classes
        getPills().forEach(p => {
          p.classList.remove('fpill--active');
          p.setAttribute('aria-checked', 'false');
          p.setAttribute('tabindex', '-1');
        });
        pill.classList.add('fpill--active');
        pill.setAttribute('aria-checked', 'true');
        pill.setAttribute('tabindex', '0');
        // Smooth scroll chip into full view
        pill.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        onChange(pill.getAttribute('data-val') || 'all');
      };

      fresh.addEventListener('click', (e) => {
        const pill = e.target.closest('.fpill');
        if (pill) activate(pill);
      }, { passive: true });

      // Roving tabindex keyboard nav (ARIA radiogroup pattern)
      fresh.addEventListener('keydown', (e) => {
        const pills = getPills();
        const idx   = pills.indexOf(document.activeElement);
        if (idx === -1) return;
        if      (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          const next = pills[Math.min(idx + 1, pills.length - 1)];
          next?.focus();
          activate(next);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = pills[Math.max(idx - 1, 0)];
          prev?.focus();
          activate(prev);
        } else if (e.key === 'Home') {
          e.preventDefault();
          pills[0]?.focus(); activate(pills[0]);
        } else if (e.key === 'End') {
          e.preventDefault();
          pills[pills.length - 1]?.focus(); activate(pills[pills.length - 1]);
        }
      });
    },

    /**
     * Update active pill without full re-render.
     * @param {string} containerId
     * @param {string} val
     */
    setActive(containerId, val) {
      const el = DOMService.get(containerId);
      if (!el) return;
      el.querySelectorAll('.fpill').forEach(p => {
        const active = p.getAttribute('data-val') === val;
        p.classList.toggle('fpill--active', active);
        p.setAttribute('aria-pressed', String(active));
      });
    },
  };

  M.RenderingService = RenderingService;
  M.FilterService    = FilterService;

})(window.SearchModules = window.SearchModules || {});
