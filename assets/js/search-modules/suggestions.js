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

    /**
     * Extract type/category names for the trending list.
     * Adds structural names (type/category) in the active UI language.
     * @returns {{raw:string, highlightedHtml:string}[]}
     */
    extractStructuralNames() {
      try {
        const lang = LanguageService.getLang();
        const out  = [];
        const seen = new Set();

        for (const t of (State.apiData?.type || [])) {
          const name = t.name?.[lang] || t.name?.en || '';
          if (name && !seen.has(name)) {
            seen.add(name);
            out.push({ raw: name, highlightedHtml: StringService.escapeHtml(name) });
          }
          for (const c of (t.category || [])) {
            const cname = c.name?.[lang] || c.name?.en || '';
            if (cname && !seen.has(cname)) {
              seen.add(cname);
              out.push({ raw: cname, highlightedHtml: StringService.escapeHtml(cname) });
            }
          }
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

        const itemNames  = this.extractSmartNames();
        const typeNames  = this.extractStructuralNames();

        // Merge: item names first (more specific), then type/category names
        // Deduplicate by raw value
        const seen   = new Set(itemNames.map(s => s.raw));
        const merged = [...itemNames];
        for (const s of typeNames) {
          if (!seen.has(s.raw)) {
            seen.add(s.raw);
            merged.push(s);
          }
          if (merged.length >= CONFIG.RENDER.suggestionsFullscreenMax) break;
        }
        const sgs = merged;

        if (!sgs.length) { container.style.display = 'none'; return; }

        let html = `<div class="suggestions-head">${LanguageService.t('trending')}</div>`;
        for (const s of sgs) {
          html += `<div class="suggestion-item" role="option" tabindex="0" data-val="${StringService.encodeUrl(s.raw)}">
  <div class="suggestion-body">${s.highlightedHtml}</div>
</div>`;
        }
        HighlightService.clearHighlights();
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
     * @param {string} query
     */
    /**
     * Extract type/category names from apiData that match the query.
     * Used to supplement SearchEngine suggestions with structural names.
     * @param {string} q  lowercased query
     * @returns {{raw:string}[]}
     */
    /**
     * Search ALL language variants of type/category names against the query.
     *
     * Why all languages:
     *   If UI lang = 'en' and user types 'อีโมจิ' (Thai), the name in lang='en'
     *   is 'Emoji' — 'emoji'.includes('อีโมจิ') = false → never matched.
     *   By searching ALL available language keys (th, en, etc.), we match
     *   regardless of which language the user is typing in.
     *
     *   The displayed suggestion always uses the UI-language name (lang-aware).
     *   We only use the other-language values for matching, not display.
     *
     * @param {string} q  lowercased query
     * @returns {{raw:string}[]}
     */
    _matchStructuralNames(q) {
      try {
        const lang    = LanguageService.getLang();
        const results = [];
        const seen    = new Set();

        for (const t of (State.apiData?.type || [])) {
          // Display name: UI language first, then English fallback
          const displayName = t.name?.[lang] || t.name?.en || '';
          if (!displayName) continue;

          // Match against ALL language variants (not just current lang)
          const nameObj = t.name || {};
          const matchFound = Object.values(nameObj).some(
            v => typeof v === 'string' && v.toLowerCase().includes(q)
          );

          if (matchFound && !seen.has(displayName)) {
            seen.add(displayName);
            results.push({ raw: displayName });
          }

          for (const c of (t.category || [])) {
            const catDisplay = c.name?.[lang] || c.name?.en || '';
            if (!catDisplay) continue;

            const catNameObj   = c.name || {};
            const catMatchFound = Object.values(catNameObj).some(
              v => typeof v === 'string' && v.toLowerCase().includes(q)
            );

            if (catMatchFound && !seen.has(catDisplay)) {
              seen.add(catDisplay);
              results.push({ raw: catDisplay });
            }
          }
        }
        return results;
      } catch { return []; }
    },

    renderQuerySuggestions(query) {
      try {
        if (State.overlayTransitioning) return;
        const container = DOMService.get(CONFIG.DOM.suggestionContainerId);
        if (!container) return;

        if (!query?.trim()) {
          ReadyModeService.renderReadyModeSuggestions();
          return;
        }

        const q   = query.trim().toLowerCase();
        const max = CONFIG.RENDER.suggestionsFullscreenMax;

        // Get keyword-based suggestions from SearchEngine
        const engineSgs = window.SearchEngine?.querySuggestions?.(query, max) || [];

        // Also match type and category names (not in SearchEngine index)
        const structSgs  = this._matchStructuralNames(q);

        // Merge: engine suggestions first, then structural matches, deduplicated
        const seen   = new Set(engineSgs.map(s => s.raw.toLowerCase()));
        const merged = [...engineSgs];
        for (const s of structSgs) {
          if (!seen.has(s.raw.toLowerCase())) {
            seen.add(s.raw.toLowerCase());
            merged.push(s);
          }
          if (merged.length >= max) break;
        }

        const sgs = merged;
        if (!sgs.length) {
          ReadyModeService.renderReadyModeSuggestions();
          return;
        }

        // Always clear stale ranges first (single call, before render)
        HighlightService.clearHighlights();

        let html = `<div class="suggestions-head">${LanguageService.t('suggestion_label')}</div>`;
        for (const s of sgs) {
          // Tier 2 fallback: <mark> wrapping whole grapheme cluster.
          // On browsers with CSS Custom Highlight API, Tier 1 is applied
          // AFTER innerHTML via _applyTier1Highlights() below — it supersedes
          // these <mark> tags by painting at the font rendering level.
          html += `<div class="suggestion-item" role="option" tabindex="0" data-val="${StringService.encodeUrl(s.raw)}">
  <div class="suggestion-body">${HighlightService.highlight(s.raw, query)}</div>
</div>`;
        }
        container.innerHTML     = html;
        container.style.display = 'block';
        if (State.overlayScrollable) State.overlayScrollable.scrollTop = 0;

        // Tier 1: CSS Custom Highlight API (Chrome 105+, Safari 17.2+, FF 117+).
        // Paints highlight BEHIND glyphs at font-rendering level — covers
        // above-baseline Thai diacritics (ิ ้ ั ็ etc.) that CSS box cannot reach.
        // Applied after innerHTML so DOM nodes exist.
        if (typeof CSS !== 'undefined' && CSS.highlights) {
          // Re-clear: innerHTML may have triggered micro-tasks that set ranges
          HighlightService.clearHighlights();
          const bodies = container.querySelectorAll('.suggestion-body');
          for (const node of bodies) {
            // Pass domNode → _highlightViaCSS path: creates Ranges from text node
            HighlightService.highlight(node.textContent || '', query, node);
          }
        }

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
