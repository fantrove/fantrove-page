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
 * v4.0 — Smart query-language detection
 *   The user reported a long-standing issue: typing an English query
 *   sometimes surfaced Thai suggestions, and vice versa. The root cause
 *   was that the engine returned matches in any language without
 *   considering what script the user was typing in.
 *
 *   SuggestionService now detects the dominant language of the query
 *   (via LanguageService.detectQueryLanguage) and re-ranks the
 *   suggestion list so that suggestions in the same language as the
 *   query appear first. Suggestions in the other language are kept as
 *   a fallback so the user still sees them if the primary language
 *   doesn't have enough matches — but they no longer dominate the list.
 *
 *   The detection uses a configurable dominance ratio (default 1.5×)
 *   so a single stray character in the other script will NOT flip the
 *   suggestion language.
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
   *
   * v4.0 — Re-ranks by UI language so trending suggestions the user
   *        sees first match their UI language. Trending is a discovery
   *        surface, so we still show items in the other language below
   *        the primary-language ones rather than hiding them entirely.
   */
  const ReadyModeService = {
    /**
     * Extract human-readable display names from allKeywordsCache,
     * re-ranked so items in the active UI language come first.
     * @returns {{raw:string, highlightedHtml:string}[]}
     */
    extractSmartNames() {
      try {
        if (!State.allKeywordsCache?.length) return [];
        const uiLang = LanguageService.getLang();
        const out    = [];
        const seen   = new Set();
        // Two buckets: primary (UI lang) and secondary (other lang)
        const primary   = [];
        const secondary = [];
        const max = CONFIG.RENDER.suggestionsFullscreenMax;

        for (const kw of State.allKeywordsCache) {
          if (primary.length + secondary.length >= max) break;
          if (!kw?.item) continue;

          const name = (kw.item.name && typeof kw.item.name === 'object')
            ? (kw.item.name[uiLang] || kw.item.name.en || '')
            : '';

          if (!name || name.length < 2) continue;
          // Skip short pure-ASCII strings (internal API names, not user-facing)
          if (!/[\u0E00-\u0E7F]/.test(name) && /^[A-Za-z0-9_\-]+$/.test(name) && name.length <= 20) continue;
          if (seen.has(name)) continue;

          seen.add(name);
          const entry = { raw: name, highlightedHtml: StringService.escapeHtml(name) };

          // v4.0 — Bucket by language: items whose name matches the UI
          // language go to primary; everything else goes to secondary.
          // We use hasThaiChars() to classify — Thai chars → 'th' bucket.
          const isThaiName = LanguageService.hasThaiChars(name);
          if ((uiLang === 'th' && isThaiName) || (uiLang === 'en' && !isThaiName)) {
            primary.push(entry);
          } else {
            secondary.push(entry);
          }
        }

        // Concatenate primary first, then secondary, up to max.
        for (const e of primary)   { if (out.length >= max) break; out.push(e); }
        for (const e of secondary) { if (out.length >= max) break; out.push(e); }
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
     * v4.0 — Smart language re-ranking:
     *   1. Detect the dominant language of the query using
     *      LanguageService.detectQueryLanguage().
     *   2. Pull a larger candidate pool from the engine (2× maxCount).
     *   3. Split into same-language and other-language buckets.
     *   4. Concatenate: same-language first, then other-language.
     *   5. Slice to maxCount.
     *
     *   This keeps suggestions in the language the user is typing in
     *   at the top of the list, without hiding the other language
     *   entirely (in case the user is searching for a cross-language
     *   term). The dominance ratio in LANG_WEIGHT prevents a single
     *   stray character from flipping the detected language.
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

        // v4.0 — Pull a larger candidate pool so we have headroom for
        // language re-ranking. If we only pull maxCount, we might end
        // up with too few same-language suggestions after filtering.
        const max = CONFIG.RENDER.suggestionsFullscreenMax;
        const poolSize = Math.min(max * 2, max + 16);
        const raw = engine?.querySuggestions?.(query, poolSize) || [];
        if (!raw.length) {
          ReadyModeService.renderReadyModeSuggestions();
          return;
        }

        // v4.0 — Detect dominant query language and re-rank.
        const langInfo = LanguageService.detectQueryLanguage(query);
        const sgs = _rerankByLanguage(raw, langInfo.language, max);

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

  // ── Language re-ranking helper (v4.0) ─────────────────────────────────────
  /**
   * Re-rank a suggestion pool so items in the target language appear first.
   *
   * Strategy:
   *   • Walk the pool once. Bucket each suggestion into "same-lang" or
   *     "other-lang" based on whether its display string contains Thai
   *     characters (for target='th') or not (for target='en').
   *   • Concatenate same-lang first, then other-lang.
   *   • Slice to maxCount.
   *
   * This preserves the engine's priority ordering within each bucket
   * (e.g., prefix matches still come before fuzzy matches in the same
   * language), so the user still gets the best matches first — they
   * just no longer have to scan past cross-language suggestions.
   *
   * @param {Suggestion[]} pool
   * @param {string}       targetLang  'th' | 'en'
   * @param {number}       maxCount
   * @returns {Suggestion[]}
   */
  function _rerankByLanguage(pool, targetLang, maxCount) {
    const sameLang  = [];
    const otherLang = [];
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i];
      if (!s) continue;
      const isThai = LanguageService.hasThaiChars(s.raw || '');
      // targetLang 'th' → Thai strings go to sameLang
      // targetLang 'en' → non-Thai strings go to sameLang
      if ((targetLang === 'th' && isThai) || (targetLang !== 'th' && !isThai)) {
        sameLang.push(s);
      } else {
        otherLang.push(s);
      }
    }
    const out = [];
    for (const s of sameLang)  { if (out.length >= maxCount) break; out.push(s); }
    for (const s of otherLang) { if (out.length >= maxCount) break; out.push(s); }
    return out;
  }

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
