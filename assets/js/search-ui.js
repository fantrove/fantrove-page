// @ts-check
/**
 * @file search-ui.js
 * Self-loading entry point for the search system.
 *
 * PERF v3 — two major speed improvements over v1:
 *
 * 1. PARALLEL MODULE LOADING (was: sequential, 12 round trips in a row)
 *    Modules are grouped into 5 dependency phases. Within each phase,
 *    all scripts load in parallel. Reduces HTTP round trips from 12 to 5.
 *    Estimated saving on mobile (30ms RTT): 360ms → 150ms.
 *
 *    Phase 1 (parallel): types, config, state          — no inter-deps
 *    Phase 2 (parallel): utils, virtual-scroll          — need phase 1
 *    Phase 3 (parallel): url-history, keyboard,         — need phase 2
 *                        rendering, suggestions, input-bar
 *    Phase 4:            overlay                        — needs phase 3
 *    Phase 5:            search                         — needs everything
 *
 * 2. DATA PREFETCH (was: data fetch started after all modules loaded)
 *    _earlyDataPromise fires immediately when this script runs.
 *    By the time 5 load phases finish (~150ms), the data fetch is already
 *    in-flight or complete. init() awaits the same promise — zero extra wait.
 *
 * RELIABILITY v2 (from previous patch):
 *    doSearch() stashes query in window.__pendingSearch when docs not ready.
 *    Drained here after init() completes — fixes cold-start no-results bug.
 *
 * HTML only needs ONE tag:
 *   <script defer src="/assets/js/search-ui.js"></script>
 *
 * @module search-ui
 */
(function () {
  'use strict';

  if (window.__searchUI?._initialized) return;

  // ── Parallel phase definitions ────────────────────────────────────────────
  // Each inner array = one phase (scripts load in parallel within the phase).
  // Phases are sequential (phase N+1 starts only after phase N completes).
  const LOAD_PHASES = [
    // Phase 1: Pure foundation — no inter-module dependencies
    ['types.js', 'config.js', 'state.js'],
    // Phase 2: Core utilities — depend only on Phase 1
    ['utils.js', 'virtual-scroll.js'],
    // Phase 3: Feature modules — depend on Phase 2
    ['url-history.js', 'keyboard.js', 'rendering.js', 'suggestions.js', 'input-bar.js'],
    // Phase 4: Overlay — depends on suggestions + input-bar (Phase 3)
    ['overlay.js'],
    // Phase 5: Search service — depends on everything above
    ['search.js'],
  ];

  // ── Early data prefetch ───────────────────────────────────────────────────
  // Start polling for ConDataService the moment this script runs.
  // The data fetch begins while modules are still loading, so both happen
  // in parallel. By the time _boot() calls loadData(), the promise is already
  // resolved (or nearly so).
  //
  // Poll interval: 20ms, max 40 attempts = 800ms window.
  // If ConDataService isn't available in time, resolve(null) and let
  // loadData() fall back to fetching db.min.json directly.
  let _earlyDataPromise = (function () {
    try {
      return new Promise(function (resolve) {
        if (window.ConDataService?.getAssembled) {
          resolve(window.ConDataService.getAssembled().catch(() => null));
          return;
        }
        var attempts = 0;
        var MAX      = 40;   // 40 × 20ms = 800ms
        var id = setInterval(function () {
          attempts++;
          if (window.ConDataService?.getAssembled) {
            clearInterval(id);
            resolve(window.ConDataService.getAssembled().catch(() => null));
          } else if (attempts >= MAX) {
            clearInterval(id);
            resolve(null); // loadData() will handle fallback
          }
        }, 20);
      });
    } catch (e) {
      return null;
    }
  })();

  // ── Path resolution ───────────────────────────────────────────────────────
  function getBasePath() {
    try {
      const scripts = document.querySelectorAll('script[src]');
      for (const s of scripts) {
        const src = s.getAttribute('src') || '';
        if (src.includes('search-ui.js')) {
          return src.replace(/\/search-ui\.js(\?.*)?$/, '');
        }
      }
    } catch {}
    return '/assets/js';
  }

  // ── Script loader ─────────────────────────────────────────────────────────
  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      const s  = document.createElement('script');
      s.src    = url;
      s.async  = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('[SearchUI] Failed to load: ' + url));
      document.head.appendChild(s);
    });
  }

  /**
   * Load one phase: all scripts in parallel, resolve when all done.
   * @param {string[]} names
   * @param {string}   base
   */
  function loadPhase(names, base) {
    return Promise.all(names.map(n => loadScript(base + '/search-modules/' + n)));
  }

  /**
   * Load all phases sequentially (each phase waits for the previous).
   * Within each phase, scripts load in parallel.
   */
  function loadPhases(phases, base) {
    return phases.reduce(
      function (chain, phase) { return chain.then(() => loadPhase(phase, base)); },
      Promise.resolve()
    );
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  const base = getBasePath();

  loadPhases(LOAD_PHASES, base)
    .then(() => _boot())
    .catch(err => console.error('[SearchUI] Module loading failed:', err));

  // ── Main init ─────────────────────────────────────────────────────────────
  function _boot() {
    const M = window.SearchModules;
    if (!M) { console.error('[SearchUI] SearchModules namespace missing after load'); return; }

    const {
      CONFIG, State, Handlers,
      DOMService, StorageService, URLService,
      KeyboardService, FilterService,
      SearchService, UIService, OverlayService,
      ClearBtnService, IconSlotService,
      VirtualScrollEngine, KeyboardAutoToggleService,
    } = M;

    // ── Data loading ────────────────────────────────────────────────────────
    // Uses _earlyDataPromise if the prefetch already has data.
    // Falls back to the normal ConDataService poll + fetch chain.

    function waitForConDataService(ms) {
      return new Promise(function (resolve) {
        if (window.ConDataService?.getAssembled) return resolve(window.ConDataService);
        const start = Date.now();
        const id = setInterval(function () {
          if (window.ConDataService?.getAssembled) { clearInterval(id); resolve(window.ConDataService); }
          else if (Date.now() - start >= ms)        { clearInterval(id); resolve(null); }
        }, CONFIG.TIMING.conDataServicePollMs);
      });
    }

    function loadData() {
      // Fast path: prefetch already resolved
      if (_earlyDataPromise) {
        const p = _earlyDataPromise;
        _earlyDataPromise = null;
        return p.then(function (data) {
          if (data) return data;
          // Prefetch returned null — fall through to normal path
          return _normalLoadData();
        });
      }
      return _normalLoadData();
    }

    function _normalLoadData() {
      return waitForConDataService(CONFIG.TIMING.conDataServiceWaitMs).then(function (svc) {
        if (svc) {
          return svc.getAssembled().catch(function (err) {
            console.warn('[SearchUI] ConDataService failed, using fallback:', err);
            return fetch(CONFIG.DB.path).then(r => r.json()).catch(() => ({}));
          });
        }
        console.warn('[SearchUI] ConDataService not ready — using fallback db');
        return fetch(CONFIG.DB.path).then(r => r.json()).catch(() => ({}));
      });
    }

    // ── Init ────────────────────────────────────────────────────────────────

    function init() {
      try {
        KeyboardService.initKeyboardDetection();

        loadData()
          .then(function (data) {
            State.apiData = data || {};
            if (!Array.isArray(State.apiData.type))
              console.warn('[SearchUI] apiData missing .type[] — check ConDataService');
            const engineInit = window.SearchEngine?.init ?? (() => Promise.resolve());
            return engineInit(State.apiData, {}).catch(e =>
              console.error('[SearchUI] SearchEngine.init failed', e)
            );
          })
          .then(function () {
            try { State.allKeywordsCache = window.SearchEngine?.generateAllKeywords?.() ?? []; }
            catch { State.allKeywordsCache = []; }

            UIService.buildWrapper();
            FilterService.setupTypeFilter('all');
            FilterService.setupCategoryFilter([], 'all');
            UIService.setupFilters();
            UIService.setupAutoSearchInput();

            document.body.style.marginBottom = '';
            const sr = DOMService.get(CONFIG.DOM.searchResultsId);
            if (sr) {
              sr.innerHTML = `<div class="search-result-here">${M.LanguageService.t('search_result_here')}</div>`;
            }
            UIService.updateUILanguage();

            _restoreLastCommitted();

            // ── Drain pending search (cold-start race condition fix) ──────────
            // If user pressed Enter before data loaded, doSearch() stashed the
            // query in window.__pendingSearch. Run it now that docs are ready.
            const pending = window.__pendingSearch;
            if (pending?.q) {
              window.__pendingSearch = null;
              const inp = DOMService.get(CONFIG.DOM.searchInputId);
              if (inp) inp.value = pending.q;
              State.selectedType = pending.type || 'all';
              FilterService.setupTypeFilter(State.selectedType);
              SearchService.doSearch(null, false);
              URLService.replaceSearch({ q: pending.q, type: State.selectedType, category: 'all' });
              return;
            }

            // ── Normal path: URL-based search ─────────────────────────────────
            const urlState = URLService.readStateFromURL();
            if (urlState.q) {
              SearchService.doSearchFromURL(urlState.q, urlState.type || 'all', urlState.category || 'all');
            } else {
              URLService.replaceSearch({ q: '', type: 'all', category: 'all' });
            }
          })
          .catch(e => console.error('[SearchUI] Initialisation failed', e));

        // Form/Enter handlers — attached synchronously so they work immediately.
        // doSearch() defers via __pendingSearch when docs aren't ready yet.
        const form = DOMService.get(CONFIG.DOM.searchFormId);
        if (form) {
          Handlers.formSubmit = e => { e.preventDefault(); SearchService.doSearch(); UIService.closeKB(); };
          DOMService.on(form, 'submit', Handlers.formSubmit);
        }

        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        if (inp) {
          DOMService.on(inp, 'keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); SearchService.doSearch(); UIService.closeKB(); }
          });
        }

        // ── Popstate ───────────────────────────────────────────────────────
        Handlers.popstate = function (e) {
          try {
            const s              = e.state || {};
            const isOverlayEntry = !!s[State._overlayStateMarker];

            if (State.overlayOpen) {
              OverlayService.close('popstate');
              if (!isOverlayEntry && s.q !== undefined) {
                const backState = { q: s.q || '', type: s.type || 'all', category: s.category || 'all' };
                if (!URLService.isEqual(backState, State.lastCommittedSearchState)) {
                  setTimeout(() => _restoreUIState(backState), 50);
                }
              }
              return;
            }

            if (isOverlayEntry) {
              const st = { q: s.q || '', type: s.type || 'all', category: s.category || 'all' };
              URLService.replaceSearch(st);
              _restoreUIState(st);
              return;
            }

            const st = (e.state && typeof e.state === 'object') ? e.state : URLService.readStateFromURL();
            if (st?.q !== undefined) _restoreUIState(st);
          } catch {}
        };
        DOMService.on(window, 'popstate', Handlers.popstate);
        State._handlersAttached = true;

      } catch (e) {
        console.error('[SearchUI] init failed', e);
      }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    function _restoreLastCommitted() {
      try {
        const hs = history.state;
        if (hs && hs.q !== undefined && !hs[State._overlayStateMarker]) {
          State.lastCommittedSearchState = { q: hs.q || '', type: hs.type || 'all', category: hs.category || 'all' };
        } else {
          const arr = StorageService.getHistory();
          if (arr.length) {
            const last = arr[arr.length - 1];
            State.lastCommittedSearchState = { q: last.q || '', type: last.type || 'all', category: last.category || 'all' };
          } else {
            State.lastCommittedSearchState = null;
          }
        }
      } catch { State.lastCommittedSearchState = null; }
    }

    function _restoreUIState(st) {
      try {
        State.suppressHistoryPush = true;
        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        if (inp) inp.value = st.q || '';
        State.selectedType     = st.type     || 'all';
        State.selectedCategory = st.category || 'all';
        FilterService.setupTypeFilter(State.selectedType);
        SearchService.doSearch(null, true);
        ClearBtnService.sync();
        IconSlotService.update();
      } finally { State.suppressHistoryPush = false; }
    }

    // ── Destroy ─────────────────────────────────────────────────────────────

    function destroy() {
      try {
        if (State.overlayOpen) OverlayService.close('manual');
        VirtualScrollEngine.destroy();
        KeyboardAutoToggleService.disableAutoToggle();

        DOMService.off(window,   'resize',   Handlers.resize);
        DOMService.off(window,   'popstate', Handlers.popstate);
        DOMService.off(DOMService.get(CONFIG.DOM.searchFormId),    'submit', Handlers.formSubmit);
        DOMService.off(DOMService.get(CONFIG.DOM.searchResultsId), 'click',  Handlers.copyClick);

        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        if (inp) {
          if (Handlers.inputInput)   inp.removeEventListener('input',   Handlers.inputInput);
          if (Handlers.inputKeydown) inp.removeEventListener('keydown', Handlers.inputKeydown);
          if (Handlers.inputFocus)   inp.removeEventListener('focus',   Handlers.inputFocus);
          if (Handlers.inputClick)   inp.removeEventListener('click',   Handlers.inputClick);
        }
        if (Handlers.documentKeydownOverlay)
          DOMService.off(document, 'keydown', Handlers.documentKeydownOverlay);

        State._timeouts.forEach(t => { try { clearTimeout(t); } catch {} });
        State._timeouts.clear();

        DOMService.remove(DOMService.get(CONFIG.DOM.suggestionContainerId));
        DOMService.remove(DOMService.get(CONFIG.DOM.overlayContainerId));
        DOMService.remove(DOMService.get(CONFIG.DOM.sentinelId));

        window.__pendingSearch = null;
        _earlyDataPromise      = null;

        State.apiData                   = null;
        State.allKeywordsCache          = [];
        State.currentResults            = [];
        State.currentFilteredResults    = [];
        State.lastCommittedSearchState  = null;
        State._handlersAttached         = false;
        State.keyboardAutoToggleEnabled = false;
        UIService._wrapperBuilt         = false;
        window._copyResultTextHandlerSet  = false;

        if (window.__searchUI) window.__searchUI._initialized = false;
      } catch (e) { console.error('[SearchUI] destroy failed', e); }
    }

    // ── Public API ───────────────────────────────────────────────────────────

    window.__searchUI = {
      _initialized : true,
      init,
      destroy,

      getConfig  : () => CONFIG,
      getState   : () => State,
      getModules : () => M,

      getSessionHistory           : () => StorageService.getHistory(),
      getLastCommittedSearchState : () => State.lastCommittedSearchState,

      querySuggestions: q => window.SearchEngine?.querySuggestions?.(q, CONFIG.RENDER.suggestionMax) ?? [],
      isKeyboardOpen  : () => M.KeyboardService.isKeyboardOpen(),

      getVSStats: () => ({
        itemCount   : VirtualScrollEngine._items.length,
        visibleCount: VirtualScrollEngine._vis?.size ?? 0,
        poolSize    : VirtualScrollEngine._pool.length,
        totalHeight : VirtualScrollEngine._total,
      }),
    };

    init();
    window.addEventListener('beforeunload', () => { try { destroy(); } catch {} }, { passive: true });
  }

})();