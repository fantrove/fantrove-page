// @ts-check
/**
 * @file search.js
 * SearchService — executes searches and manages history commits.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  History rules (two-stack model)                            │
 * │                                                             │
 * │  Overlay OPEN  → do NOT pushState.                         │
 * │    Reason: overlay already pushed its entry when it opened. │
 * │    If we pushState too, the stack gets an extra entry.      │
 * │    Instead: just mark lastCommittedSearchState.            │
 * │    close() → collapseOverlayEntry() → replaceState on the  │
 * │    overlay entry itself.                                    │
 * │    Net: exactly 1 new entry regardless of how many         │
 * │    searches happen inside the overlay.                      │
 * │                                                             │
 * │  Overlay CLOSED → commitSearch() → pushState normally.     │
 * └─────────────────────────────────────────────────────────────┘
 *
 * URL-init search:
 *   doSearchFromURL() retries until SearchEngine has docs built.
 *   Fuse index is built asynchronously; early calls may return [].
 *   Retries every urlSearchRetryMs up to urlSearchMaxRetries times.
 *
 * @module search
 * @depends {config.js, state.js, utils.js, url-history.js,
 *           rendering.js, suggestions.js, overlay.js, input-bar.js}
 */
(function (M) {
  'use strict';

  const {
    CONFIG, State,
    DOMService, LanguageService, URLService,
    RenderingService, FilterService,
    ReadyModeService, OverlayService,
    UIService, IconSlotService, ClearBtnService,
    VirtualScrollEngine,
  } = M;

  const SearchService = {

    // ── Main search ──────────────────────────────────────────────────────

    /**
     * Execute a search from the current input value.
     *
     * @param {Event|null}  [e]            Optional event to preventDefault
     * @param {boolean}     [preventPush]  If true, skip history push
     * @param {Object}      [options]
     * @param {boolean}     [options.closeOverlay]  Force overlay close
     */
    doSearch(e, preventPush = false, options = {}) {
      try {
        e?.preventDefault?.();

        // Set restore flag at the TOP — covers ALL paths including _showPlaceholder.
        // preventPush=true = state-restore (back button / _restoreUIState), not new search.
        window.__renderIsRestore = !!preventPush;

        const inp  = DOMService.get(CONFIG.DOM.searchInputId);
        const q    = inp?.value || '';
        // typeFilter is now a pill-bar div — read from State, not .value
        State.selectedCategory = 'all';

        // ── Empty query ────────────────────────────────────────────────────
        if (!q.trim()) {
          this._showPlaceholder();

          if (!preventPush && !State.suppressHistoryPush) {
            const cleared = { q: '', type: 'all', category: 'all' };
            if (!URLService.isEqual(cleared, State.lastCommittedSearchState)) {
              URLService.replaceSearch(cleared);
            }
          }

          if (State.overlayOpen) ReadyModeService.renderReadyModeSuggestions();
          if (State.overlayOpen && options.closeOverlay) OverlayService.close('manual');
          ClearBtnService.sync();
          IconSlotService.update();
          window.__renderIsRestore = false;
          return;
        }

        // ── Execute search ─────────────────────────────────────────────────
        let out = { results: [], keywords: [] };
        try {
          if (window.SearchEngine?.search) out = window.SearchEngine.search(q, State.selectedType) || out;
        } catch {}

        State.currentResults   = out.results  || [];
        State.allKeywordsCache = out.keywords || [];

        FilterService.setupCategoryFilter(
          RenderingService.extractResultCategories(State.currentResults),
          'all'
        );

        // ── History commit (two-stack model) ───────────────────────────────
        if (!preventPush && !State.suppressHistoryPush) {
          const searchState = { q, type: State.selectedType || 'all', category: 'all' };
          if (State.overlayOpen) {
            // Overlay is open: mark state only.
            // OverlayService.close() → collapseOverlayEntry() will replaceState.
            State.lastCommittedSearchState = searchState;
          } else {
            URLService.commitSearch(searchState);
          }
        }

        // ── Render (main page only) ────────────────────────────────────────
        RenderingService.renderResults(State.currentResults, State.currentResults.length === 0);
        window.__renderIsRestore = false;

        // Close overlay — results are now on the main page
        if (State.overlayOpen) OverlayService.close('manual');

        ClearBtnService.sync();
        IconSlotService.update();
      } catch (err) {
        console.error('[SearchService] doSearch failed', err);
      }
    },

    // ── URL-init search with retry ────────────────────────────────────────

    /**
     * Run a search from URL parameters on page load.
     *
     * SearchEngine builds its Fuse index asynchronously. If called too early
     * the index isn't ready and returns []. This method retries automatically.
     *
     * @param {string} q
     * @param {string} type
     * @param {string} category
     * @param {number} [retryCount=0]
     */
    doSearchFromURL(q, type, category, retryCount = 0) {
      const maxR    = CONFIG.TIMING.urlSearchMaxRetries;
      const retryMs = CONFIG.TIMING.urlSearchRetryMs;

      /** Schedule one more retry or warn if exhausted. */
      const scheduleRetry = () => {
        if (retryCount < maxR) {
          setTimeout(() => this.doSearchFromURL(q, type, category, retryCount + 1), retryMs);
        } else {
          console.warn('[SearchService] SearchEngine not ready after', maxR, 'retries for URL query:', q);
        }
      };

      try {
        const se = window.SearchEngine;
        if (!se?.search) { scheduleRetry(); return; }

        // Check whether the immediate doc index has been built yet
        const hasDocs = (() => {
          try { return (se._internals?.getDocs?.()?.length || 0) > 0; }
          catch { return false; }
        })();

        let out = { results: [], keywords: [] };
        try { out = se.search(q, type) || out; } catch {}

        // If no results and docs not ready yet, retry
        if (out.results.length === 0 && !hasDocs && retryCount < maxR) {
          scheduleRetry();
          return;
        }

        // Apply results
        State.suppressHistoryPush = true;
        try {
          const inp = DOMService.get(CONFIG.DOM.searchInputId);
          if (inp) inp.value = q;
          State.selectedType     = type     || 'all';
          State.selectedCategory = category || 'all';
          FilterService.setupTypeFilter(State.selectedType);
          this.doSearch(null, /* preventPush */ true);
          // Use replaceSearch — this doesn't count as a user-initiated push
          URLService.replaceSearch({ q, type: State.selectedType, category: State.selectedCategory });
        } finally {
          State.suppressHistoryPush = false;
        }

        ClearBtnService.sync();
        IconSlotService.update();
      } catch (e) {
        console.error('[SearchService] doSearchFromURL failed', e);
        scheduleRetry();
      }
    },

    // ── Private helpers ───────────────────────────────────────────────────

    /**
     * Show the "results will appear here" placeholder.
     * Called when the query is cleared.
     * @private
     */
    _showPlaceholder() {
      const rc = DOMService.get(CONFIG.DOM.searchResultsId);
      if (rc) {
        rc.innerHTML = `<div class="search-result-here" style="text-align:center;color:#969ca8;font-size:1.05em;margin-top:30px;">${LanguageService.t('search_result_here')}</div>`;
      }
      VirtualScrollEngine.destroy();
      FilterService.setupCategoryFilter([], 'all');
      UIService.updateUILanguage();
      // Only scroll to top when this is a NEW user-initiated clear, not a restore
      if (!window.__renderIsRestore) {
        window.scrollTo({ top: 0, behavior: 'instant' });
        if (window._showStickyHeader) window._showStickyHeader();
      }
    },
  };

  // ── Export ──────────────────────────────────────────────────────────────
  M.SearchService = SearchService;

})(window.SearchModules = window.SearchModules || {});
