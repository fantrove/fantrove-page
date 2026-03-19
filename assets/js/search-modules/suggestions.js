// @ts-check
/**
 * @file suggestions.js
 * SuggestionService  — renders query-based suggestion list as user types.
 * ReadyModeService   — renders trending suggestions when the input is empty.
 *
 * Both render into #searchSuggestions inside the overlay.
 *
 * @module suggestions
 * @depends {config.js, state.js, utils.js}
 */
(function (M) {
  'use strict';

  const {
    CONFIG, State,
    DOMService, StringService, LanguageService, HighlightService,
  } = M;

  // ── ReadyModeService ──────────────────────────────────────────────────────
  /**
   * Shows "trending" suggestions when the overlay opens with no query.
   * Filters out short Latin-only strings (likely internal API codes).
   */
  const ReadyModeService = {
    /**
     * Extract human-readable display names from allKeywordsCache.
     * @returns {{raw:string, highlightedHtml:string}[]}
     */
    extractSmartNames() {
      try {
        if (!State.allKeywordsCache?.length) return [];
        const lang = LanguageService.getLang();
        const out  = [];
        const seen = new Set();

        for (const kw of State.allKeywordsCache) {
          if (out.length >= CONFIG.RENDER.suggestionsFullscreenMax) break;
          if (!kw?.item) continue;

          const name = (kw.item.name && typeof kw.item.name === 'object')
            ? (kw.item.name[lang] || kw.item.name.en || '')
            : '';

          if (!name || name.length < 2) continue;
          // Skip short pure-ASCII strings (internal API names, not user-facing)
          if (!/[\u0E00-\u0E7F]/.test(name) && /^[A-Za-z0-9_\-]+$/.test(name) && name.length <= 20) continue;
          if (seen.has(name)) continue;

          seen.add(name);
          out.push({ raw: name, highlightedHtml: StringService.escapeHtml(name) });
        }

        return out;
      } catch { return []; }
    },

    /** Render trending suggestions into #searchSuggestions. */
    renderReadyModeSuggestions() {
      try {
        if (!State.overlayOpen) return;
        const container = DOMService.get(CONFIG.DOM.suggestionContainerId);
        if (!container) return;

        const sgs = this.extractSmartNames();
        if (!sgs.length) { container.style.display = 'none'; return; }

        let html = `<div class="suggestions-head">${LanguageService.t('trending')}</div>`;
        for (const s of sgs) {
          html += `<div class="suggestion-item" role="option" tabindex="0" data-val="${StringService.encodeUrl(s.raw)}">
  <div class="suggestion-body">${s.highlightedHtml}</div>
</div>`;
        }
        container.innerHTML     = html;
        container.style.display = 'block';
      } catch {}
    },
  };

  // ── SuggestionService ─────────────────────────────────────────────────────
  const SuggestionService = {
    /**
     * Handle keyboard navigation inside the suggestion list.
     * Arrow keys move focus; Enter clicks the focused item; Escape closes overlay.
     * @param {KeyboardEvent} ev
     * @param {Element}       container  The suggestion list element
     */
    handleKeydown(ev, container) {
      try {
        const items = [...container.querySelectorAll('.suggestion-item')];
        if (!items.length) return;
        const idx = items.indexOf(document.activeElement);

        if      (ev.key === 'ArrowDown') { ev.preventDefault(); items[idx === -1 ? 0 : Math.min(items.length - 1, idx + 1)]?.focus?.(); }
        else if (ev.key === 'ArrowUp')   { ev.preventDefault(); items[idx === -1 ? items.length - 1 : Math.max(0, idx - 1)]?.focus?.(); }
        else if (ev.key === 'Enter')     { ev.preventDefault(); document.activeElement?.classList?.contains('suggestion-item') && document.activeElement?.click?.(); }
        else if (ev.key === 'Escape')    { M.OverlayService.close('escape'); }
      } catch {}
    },

    /**
     * Handle click on a suggestion item — fills the input and triggers search.
     * @param {MouseEvent} ev
     */
    handleClick(ev) {
      try {
        const item = ev.target.closest('.suggestion-item');
        if (!item) return;
        ev.stopPropagation?.();
        ev.preventDefault?.();

        const val = StringService.decodeUrl(item.getAttribute('data-val') || '');
        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        if (inp) inp.value = val;

        State.suggestionsLocked = false;
        M.ClearBtnService.sync();
        M.SearchService.doSearch(null, false);
      } catch {}
    },

    /**
     * Render query-based suggestions as the user types.
     * Falls back to ReadyModeService if no suggestions found.
     * @param {string} query
     */
    renderQuerySuggestions(query) {
      try {
        if (State.overlayTransitioning) return;
        const container = DOMService.get(CONFIG.DOM.suggestionContainerId);
        if (!container) return;

        if (!query?.trim()) {
          ReadyModeService.renderReadyModeSuggestions();
          return;
        }

        const sgs = window.SearchEngine?.querySuggestions?.(query, CONFIG.RENDER.suggestionsFullscreenMax) || [];
        if (!sgs.length) {
          ReadyModeService.renderReadyModeSuggestions();
          return;
        }

        let html = `<div class="suggestions-head">${LanguageService.t('suggestion_label')}</div>`;
        for (const s of sgs) {
          html += `<div class="suggestion-item" role="option" tabindex="0" data-val="${StringService.encodeUrl(s.raw)}">
  <div class="suggestion-body">${HighlightService.highlight(s.raw, query)}</div>
</div>`;
        }
        container.innerHTML     = html;
        container.style.display = 'block';

        // Let ArrowDown from the input focus the first suggestion
        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        if (inp) {
          inp.onkeydown = (e) => {
            if      (e.key === 'ArrowDown') { e.preventDefault(); container.querySelector('.suggestion-item')?.focus?.(); }
            else if (e.key === 'Escape')    { M.OverlayService.close('escape'); }
          };
        }
      } catch {}
    },
  };

  // ── Exports ───────────────────────────────────────────────────────────────
  M.ReadyModeService  = ReadyModeService;
  M.SuggestionService = SuggestionService;

})(window.SearchModules = window.SearchModules || {});
