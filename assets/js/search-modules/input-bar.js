// @ts-check
/**
 * @file input-bar.js
 * Manages the .search-input-wrapper widget.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  .search-input-wrapper  (flex row)                         │
 * │  ┌──────────┐ ┌──────────────────────────┐ ┌────────────┐  │
 * │  │ icon-slot│ │     #searchInput          │ │ clear-btn  │  │
 * │  └──────────┘ └──────────────────────────┘ └────────────┘  │
 * └─────────────────────────────────────────────────────────────┘
 *
 * IconSlotService   — swaps 🔍 ↔ ← inside .search-input-icon.
 *   Icon modes:
 *     A) Overlay open           → ← → history.back()
 *        (popstate fires → OverlayService.close('popstate'))
 *     B) Main page + has query  → ← → history.back() (Stack A)
 *     C) Main page, no query    → 🔍 (non-interactive)
 *   Why history.back() and NOT OverlayService.close() directly?
 *     close() uses replaceState — leaves the entry in the stack.
 *     history.back() POPs the entry natively, then popstate fires,
 *     then OverlayService.close('popstate') cleans up correctly.
 *
 * ClearBtnService   — shows/hides the ✕ button based on input value.
 *
 * UIService         — attaches input/filter listeners; buildWrapper()
 *                     ensures correct DOM order on init.
 *
 * @module input-bar
 * @depends {config.js, state.js, utils.js}
 */
(function (M) {
  'use strict';

  const { CONFIG, State, Handlers, DOMService, LanguageService } = M;

  // ── IconSlotService ─────────────────────────────────────────────────────
  const IconSlotService = {
    /** @type {Function|null} */ _clickHandler : null,
    /** @type {Function|null} */ _keyHandler   : null,

    /** @returns {Element|null} */
    _slot: () => DOMService.query('.search-input-icon'),

    /**
     * Recalculate which icon to show and rebind listeners.
     * Call after: overlay opens/closes, input value changes, clear clicked.
     */
    update() {
      const slot = this._slot();
      if (!slot) return;

      const hasQuery = (DOMService.get(CONFIG.DOM.searchInputId)?.value || '').trim().length > 0;
      const showBack = State.overlayOpen || hasQuery;

      // Remove stale listeners before adding new ones
      if (this._clickHandler) { slot.removeEventListener('click',   this._clickHandler); this._clickHandler = null; }
      if (this._keyHandler)   { slot.removeEventListener('keydown', this._keyHandler);   this._keyHandler   = null; }

      if (showBack) {
        slot.innerHTML = M.CONFIG.Icons.back;
        slot.setAttribute('role',       'button');
        slot.setAttribute('tabindex',   '0');
        slot.setAttribute('aria-label', LanguageService.t('back'));
        slot.style.cssText = 'cursor:pointer;color:var(--tx-mid,#2b4539);pointer-events:auto;';

        // history.back() in ALL cases — browser pops the entry.
        // Popstate handler calls OverlayService.close('popstate') if overlay was open.
        this._clickHandler = (e) => { e.preventDefault(); e.stopPropagation(); history.back(); };
        this._keyHandler   = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); history.back(); } };

        slot.addEventListener('click',   this._clickHandler);
        slot.addEventListener('keydown', this._keyHandler);
      } else {
        slot.innerHTML = M.CONFIG.Icons.search;
        slot.setAttribute('role', 'presentation');
        slot.removeAttribute('tabindex');
        slot.removeAttribute('aria-label');
        slot.style.cssText = 'cursor:default;color:var(--g5,#13b47f);pointer-events:none;';
      }
    },
  };

  // ── ClearBtnService ─────────────────────────────────────────────────────
  const ClearBtnService = {
    /** @type {HTMLElement|null} */ _btn: null,

    /**
     * Build the ✕ button and return it.
     * Safe to call multiple times — only creates the element once.
     * @returns {HTMLElement}
     */
    build() {
      let btn = DOMService.get(CONFIG.DOM.clearBtnId);
      if (!btn) {
        btn = Object.assign(document.createElement('button'), {
          id       : CONFIG.DOM.clearBtnId,
          type     : 'button',
          innerHTML: M.CONFIG.Icons.clear,
        });
        btn.setAttribute('aria-label', LanguageService.t('clear'));
        Object.assign(btn.style, {
          flexShrink            : '0',
          display               : 'none',   // shown via sync()
          alignItems            : 'center',
          justifyContent        : 'center',
          width                 : '20px',
          height                : '20px',
          minWidth              : '20px',
          borderRadius          : '50%',
          background            : 'rgba(0,0,0,.10)',
          border                : 'none',
          cursor                : 'pointer',
          color                 : 'var(--tx-lo,#637a6e)',
          padding               : '0',
          outline               : 'none',
          WebkitTapHighlightColor: 'transparent',
        });

        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const inp = DOMService.get(CONFIG.DOM.searchInputId);
          if (inp) { inp.value = ''; inp.focus(); }
          this.sync();
          IconSlotService.update();
          M.SearchService.doSearch(null, false);
        });
      }

      this._btn = btn;
      return btn;
    },

    /** Show or hide the ✕ button depending on whether the input has text. */
    sync() {
      const btn     = this._btn || DOMService.get(CONFIG.DOM.clearBtnId);
      if (!btn) return;
      const hasText = (DOMService.get(CONFIG.DOM.searchInputId)?.value || '').length > 0;
      btn.style.display = hasText ? 'flex' : 'none';
    },
  };

  // ── UIService ───────────────────────────────────────────────────────────
  const UIService = {
    /** @type {boolean} */ _wrapperBuilt: false,

    /**
     * Ensure .search-input-wrapper contains elements in correct flex order:
     *   [.search-input-icon] [#searchInput] [#search-clear-btn]
     *
     * Must be called once after data loads.
     * Idempotent — safe to call again (guarded by _wrapperBuilt).
     */
    buildWrapper() {
      if (this._wrapperBuilt) return;
      const wrapper = DOMService.query('.search-input-wrapper');
      const inp     = DOMService.get(CONFIG.DOM.searchInputId);
      if (!wrapper || !inp) return;

      // 1. Ensure icon slot is the first child
      let slot = wrapper.querySelector('.search-input-icon');
      if (!slot) {
        slot = DOMService.create('span', null, 'search-input-icon');
        wrapper.insertBefore(slot, wrapper.firstChild);
      }
      slot.innerHTML = M.CONFIG.Icons.search;

      // 2. Input comes right after the icon slot
      if (slot.nextSibling !== inp) wrapper.insertBefore(inp, slot.nextSibling);

      // 3. Clear button is the last child
      const clearBtn = ClearBtnService.build();
      if (!wrapper.contains(clearBtn)) wrapper.appendChild(clearBtn);

      this._wrapperBuilt = true;
    },

    /**
     * Attach all event listeners to #searchInput.
     * Must be called after buildWrapper().
     */
    setupAutoSearchInput() {
      try {
        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        if (!inp) return;
        DOMService.setAttr(inp, 'enterkeyhint', 'search');

        // Debounced: update suggestions, clear-btn, icon slot on every keystroke
        Handlers.inputInput = () => {
          if (State.overlayTransitioning) return;
          ClearBtnService.sync();
          IconSlotService.update();
          clearTimeout(State.debounceTimeout);
          State.debounceTimeout = setTimeout(
            () => M.SuggestionService.renderQuerySuggestions(inp.value),
            CONFIG.TIMING.debounceMs
          );
        };
        inp.addEventListener('input', Handlers.inputInput);

        // Enter → run search; ArrowDown → focus first suggestion; Backspace → debounce
        Handlers.inputKeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            M.SearchService.doSearch();
            this.closeKB();
          } else if (e.key === 'ArrowDown') {
            DOMService.get(CONFIG.DOM.suggestionContainerId)?.querySelector('.suggestion-item')?.focus?.();
          } else if (e.key === 'Backspace') {
            clearTimeout(State.debounceTimeout);
            State.debounceTimeout = setTimeout(() => {
              ClearBtnService.sync();
              M.SuggestionService.renderQuerySuggestions(inp.value);
              IconSlotService.update();
            }, CONFIG.TIMING.debounceMs / 2);
          }
        };
        inp.addEventListener('keydown', Handlers.inputKeydown);

        // Focus or click → open overlay
        Handlers.inputFocus = () => { if (!State.overlayTransitioning) M.OverlayService.open(); };
        Handlers.inputClick = () => { if (!State.overlayTransitioning) M.OverlayService.open(); };
        inp.addEventListener('focus', Handlers.inputFocus);
        inp.addEventListener('click', Handlers.inputClick);

        // Initial icon state
        IconSlotService.update();
        ClearBtnService.sync();
      } catch {}
    },

    /**
     * Attach onChange handlers to the type and category <select> elements.
     */
    setupFilters() {
      try {
        [CONFIG.DOM.typeFilterId, CONFIG.DOM.categoryFilterId].forEach((id) => {
          const el = DOMService.get(id);
          if (!el) return;
          const onChange = () => {
            if (id === CONFIG.DOM.typeFilterId) this.onTypeChange();
            else this.onCatChange();
          };
          el.onchange = onChange;
          el.onkeyup  = (e) => { if (e.key === 'Enter') onChange(); };
        });
      } catch {}
    },

    /** Handle type filter change — re-runs the current search. */
    onTypeChange() {
      try {
        State.selectedType = DOMService.get(CONFIG.DOM.typeFilterId)?.value;
        M.SearchService.doSearch();
      } catch {}
    },

    /** Handle category filter change — re-filters current results. */
    onCatChange() {
      try {
        State.selectedCategory = DOMService.get(CONFIG.DOM.categoryFilterId)?.value;
        M.RenderingService.renderResults(State.currentResults, false);
        this.updateUILanguage();
      } catch {}
    },

    /** Blur the input to dismiss the soft keyboard. */
    closeKB() {
      try {
        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        if (inp && document.activeElement === inp) inp.blur();
      } catch {}
    },

    /**
     * Sync placeholder text and filter labels to the active language.
     * Safe to call at any time — checks before writing.
     */
    updateUILanguage() {
      try {
        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        const ph  = LanguageService.t('search_placeholder');
        if (inp && inp.placeholder !== ph) inp.placeholder = ph;

        const lbls = DOMService.queryAll('.search-filters-panel .filter-group-label');
        if (lbls[0] && lbls[0].textContent !== LanguageService.t('type'))     lbls[0].textContent = LanguageService.t('type');
        if (lbls[1] && lbls[1].textContent !== LanguageService.t('category')) lbls[1].textContent = LanguageService.t('category');
      } catch {}
    },
  };

  // ── Exports ─────────────────────────────────────────────────────────────
  M.IconSlotService = IconSlotService;
  M.ClearBtnService = ClearBtnService;
  M.UIService       = UIService;

})(window.SearchModules = window.SearchModules || {});
