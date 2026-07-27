// @ts-check
/**
 * @file suggestions.js
 * SuggestionService  — renders query-based suggestion list as user types.
 * ReadyModeService   — renders trending suggestions when the input is empty.
 *
 * Both render into #searchSuggestions inside the overlay.
 *
 * v2.0 — Comprehensive suggestion diversity
 *   Now renders suggestion "type" badges so users can distinguish item
 *   matches from type matches (e.g., "อีโมจิ") and category matches
 *   (e.g., "Arrows"). The underlying engine returns a `source` field
 *   that drives the badge label.
 *
 * @module suggestions
 * @depends {config.js, state.js, utils.js, engine.js}
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
        // Reset overlay scroll to top — user may have scrolled down in suggestions
        if (State.overlayScrollable) State.overlayScrollable.scrollTop = 0;
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
     *
     * Each suggestion may come from a different source (item name, type
     * name, category name, fuzzy match). We render a small badge next to
     * non-item suggestions so the user understands what they're selecting.
     *
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

        // Use SearchEngine from the module namespace; falls back to
        // window.SearchEngine for any legacy code paths.
        const engine = M.SearchEngine || window.SearchEngine;
        const sgs = engine?.querySuggestions?.(query, CONFIG.RENDER.suggestionsFullscreenMax) || [];
        if (!sgs.length) {
          ReadyModeService.renderReadyModeSuggestions();
          return;
        }

        let html = `<div class="suggestions-head">${LanguageService.t('suggestion_label')}</div>`;
        for (const s of sgs) {
          const badge = _sourceBadge(s.source);
          html += `<div class="suggestion-item" role="option" tabindex="0" data-val="${StringService.encodeUrl(s.raw)}">
  <div class="suggestion-body">${HighlightService.highlight(s.raw, query)}</div>${badge}
</div>`;
        }
        container.innerHTML     = html;
        container.style.display = 'block';
        // Reset overlay scroll to top on every suggestion update
        if (State.overlayScrollable) State.overlayScrollable.scrollTop = 0;

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

  // ── Source badge helper ─────────────────────────────────────────────────
  /**
   * Build a small badge HTML string indicating the suggestion's source.
   * Returns '' for item-name matches (the default — no badge needed).
   *
   * @param {string} source
   * @returns {string}
   */
  function _sourceBadge(source) {
    if (!source) return '';
    let label = '';
    let cls   = 'suggestion-badge';
    if (source === 'type') {
      label = LanguageService.t('type');
      cls  += ' suggestion-badge--type';
    } else if (source === 'category') {
      label = LanguageService.t('category');
      cls  += ' suggestion-badge--category';
    } else if (source === 'fuse' || source === 'immediate' || source === 'keyword-contains') {
      // No badge for fuzzy / fallback matches — keeps the UI clean
      return '';
    }
    // Default: item match — no badge
    if (!label) return '';
    return `<span class="${cls}" aria-hidden="true">${StringService.escapeHtml(label)}</span>`;
  }

  // ── Exports ───────────────────────────────────────────────────────────────
  M.ReadyModeService  = ReadyModeService;
  M.SuggestionService = SuggestionService;

})(window.SearchModules = window.SearchModules || {});
