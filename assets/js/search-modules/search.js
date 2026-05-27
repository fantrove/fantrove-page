// @ts-check
/**
 * @file search.js
 * SearchService — executes searches and manages history commits.
 *
 * PATCH v2 — performance + reliability
 *
 * BUG 1 FIXED (speed):
 *   doSearchFromURL used to wait up to 15 × 120ms = 1800ms for Fuse before
 *   showing anything, even though immediateSearch (substring) is ready the
 *   moment SearchEngine.init() resolves.
 *   FIX: show immediateSearch results right away; schedule one silent Fuse
 *   upgrade pass ~1s later so results improve without blocking the user.
 *
 * BUG 2 FIXED (no-results silent fail):
 *   doSearch form/enter handlers are attached synchronously in init() before
 *   loadData() resolves. If the user submits while docs are still loading,
 *   search() returns [] silently — nothing rendered, no retry.
 *   FIX: when docs aren't ready, stash the query in window.__pendingSearch
 *   and bail. search-ui.js drains __pendingSearch after init completes.
 *
 * BUG 3 FIXED (placeholder clipped when browser nav bar hides):
 *   _showPlaceholder() was calling _syncPlaceholderHeight() which sets
 *   --placeholder-h to a px snapshot of window.innerHeight. When the browser
 *   nav bar hides, innerHeight grows but --placeholder-h stays stale, so
 *   .search-result-here is clipped at the bottom.
 *   FIX: removed _syncPlaceholderHeight() and _ensureResizeListener() entirely.
 *   CSS already handles .search-result-here height correctly on its own.
 *   JS does not set --placeholder-h at all.
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

  // ── Fuse upgrade scheduler ────────────────────────────────────────────────
  // After we show immediate (substring) results, schedule one silent upgrade
  // to Fuse results once the index finishes building in idle time.
  // Only upgrades if the input value hasn't changed — avoids stale swaps.

  let _fuseUpgradeTimer = null;

  function _scheduleFuseUpgrade(q, type) {
    clearTimeout(_fuseUpgradeTimer);
    const CHECK_INTERVAL_MS = 500;
    const MAX_WAIT_MS       = 8000;
    const started           = Date.now();

    (function checkFuse() {
      try {
        const ready = window.SearchEngine?._internals?.getFuse?.() != null;
        const inp   = DOMService.get(CONFIG.DOM.searchInputId);
        const still = inp?.value?.trim() === q;

        if (ready && still) {
          let out = { results: [], keywords: [] };
          try { out = window.SearchEngine.search(q, type) || out; } catch {}
          if (out.results.length) {
            State.currentResults = out.results;
            FilterService.setupCategoryFilter(
              RenderingService.extractResultCategories(out.results), 'all'
            );
            RenderingService.renderResults(out.results);
          }
          _fuseUpgradeTimer = null;
          return;
        }

        if (!ready && Date.now() - started < MAX_WAIT_MS) {
          _fuseUpgradeTimer = setTimeout(checkFuse, CHECK_INTERVAL_MS);
        }
      } catch {
        _fuseUpgradeTimer = null;
      }
    })();
  }

  // ── SearchService ─────────────────────────────────────────────────────────

  const SearchService = {

    // ── Main search ──────────────────────────────────────────────────────

    /**
     * Execute a search from the current input value.
     *
     * @param {Event|null}  [e]
     * @param {boolean}     [preventPush]
     * @param {Object}      [options]
     * @param {boolean}     [options.closeOverlay]
     */
    doSearch(e, preventPush = false, options = {}) {
      try {
        e?.preventDefault?.();

        window.__renderIsRestore = !!preventPush;

        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        const q   = inp?.value || '';
        State.selectedCategory = 'all';

        // ── Guard: docs not ready yet ──────────────────────────────────────
        if (q.trim() && !preventPush) {
          const docsReady = (window.SearchEngine?._internals?.getDocs?.()?.length ?? 0) > 0;
          if (!docsReady) {
            window.__pendingSearch = { q: q.trim(), type: State.selectedType || 'all' };
            const rc = DOMService.get(CONFIG.DOM.searchResultsId);
            if (rc && !rc.querySelector('.search-result-here')) {
              rc.innerHTML = `<div class="search-result-here" style="opacity:.5">${LanguageService.t('search_result_here')}</div>`;
            }
            window.__renderIsRestore = false;
            return;
          }
        }

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
            State.lastCommittedSearchState = searchState;
          } else {
            URLService.commitSearch(searchState);
          }
        }

        // ── Render ─────────────────────────────────────────────────────────
        RenderingService.renderResults(State.currentResults, State.currentResults.length === 0);
        window.__renderIsRestore = false;

        if (State.overlayOpen) OverlayService.close('manual');

        ClearBtnService.sync();
        IconSlotService.update();
      } catch (err) {
        console.error('[SearchService] doSearch failed', err);
      }
    },

    // ── URL-init search ───────────────────────────────────────────────────

    /**
     * Run a search from URL parameters on page load.
     * Shows immediateSearch results right away; Fuse upgrade runs silently later.
     *
     * @param {string} q
     * @param {string} type
     * @param {string} category
     * @param {number} [retryCount=0]
     */
    doSearchFromURL(q, type, category, retryCount = 0) {
      const maxR    = CONFIG.TIMING.urlSearchMaxRetries;
      const retryMs = CONFIG.TIMING.urlSearchRetryMs;

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

        const internals = se._internals;
        const hasDocs = (() => {
          try { return (internals?.getDocs?.()?.length || 0) > 0; }
          catch { return false; }
        })();

        if (!hasDocs) { scheduleRetry(); return; }

        let out = { results: [], keywords: [] };
        try { out = se.search(q, type) || out; } catch {}

        State.suppressHistoryPush = true;
        try {
          const inp = DOMService.get(CONFIG.DOM.searchInputId);
          if (inp) inp.value = q;
          State.selectedType     = type     || 'all';
          State.selectedCategory = category || 'all';
          FilterService.setupTypeFilter(State.selectedType);
          this.doSearch(null, /* preventPush */ true);
          URLService.replaceSearch({ q, type: State.selectedType, category: State.selectedCategory });
        } finally {
          State.suppressHistoryPush = false;
        }

        ClearBtnService.sync();
        IconSlotService.update();

        // Schedule silent Fuse upgrade if not ready yet
        const hasFuse = (() => {
          try { return internals?.getFuse?.() != null; }
          catch { return false; }
        })();
        if (!hasFuse) _scheduleFuseUpgrade(q, type);

      } catch (e) {
        console.error('[SearchService] doSearchFromURL failed', e);
        scheduleRetry();
      }
    },

    // ── Private helpers ───────────────────────────────────────────────────

    /**
     * Show the "results will appear here" placeholder.
     *
     * BUG FIX: Removed _syncPlaceholderHeight() and _ensureResizeListener().
     * Those functions set --placeholder-h to a px snapshot of window.innerHeight,
     * which becomes stale when the browser nav bar shows/hides (innerHeight changes).
     * CSS already handles .search-result-here height correctly without any JS.
     *
     * @private
     */
    _showPlaceholder() {
      const rc = DOMService.get(CONFIG.DOM.searchResultsId);
      if (rc) {
        rc.innerHTML = `<div class="search-result-here">${LanguageService.t('search_result_here')}</div>`;
      }
      VirtualScrollEngine.destroy();
      FilterService.setupCategoryFilter([], 'all');
      UIService.updateUILanguage();
      if (!window.__renderIsRestore) {
        window.scrollTo({ top: 0, behavior: 'instant' });
        if (window._showStickyHeader) window._showStickyHeader();
      }
    },
  };

  // ── Export ──────────────────────────────────────────────────────────────
  M.SearchService = SearchService;

})(window.SearchModules = window.SearchModules || {});