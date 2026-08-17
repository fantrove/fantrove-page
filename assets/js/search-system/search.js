// Path:    assets/js/search-system/search.js
// Purpose: Self-loading entry point for the new unified search system.
//          Loads all search-modules/* in dependency order, then exposes
//          the public __searchUI + SearchEngine global APIs.
//
// This file consolidates the legacy `search-engine.js` and `search-ui.js`
// into a single entry point, following the same pattern used by the
// URE system (`assets/js/ure/ure.js`).
//
// HTML only needs ONE tag:
//   <script defer src="/assets/js/search-system/search.js"></script>
//
// Module load order (5 phases, parallel-within-phase):
//   Phase 1 (parallel): types, config, state          — no inter-deps
//   Phase 2 (parallel): utils, virtual-scroll          — need phase 1
//   Phase 3 (parallel): url-history, keyboard,         — need phase 2
//                       rendering, suggestions, input-bar
//   Phase 4 (parallel): overlay, discovery             — need phase 3
//   Phase 5 (parallel): engine, search-service         — need everything
//
// ARCHITECTURE (aerospace-grade, SpaceX/NASA-inspired):
//   Layer 1: Data ingestion    (ConDataService → engine.init)
//   Layer 2: Index             (engine builds docs + keywords + type/cat indexes + Fuse)
//   Layer 3: Search            (engine.search + engine.querySuggestions + engine.queryRelated)
//   Layer 4: Service           (search-service orchestrates search + history + render)
//   Layer 5: UI                (overlay, input-bar, suggestions, rendering, discovery)
//
// v4.0 — Discovery system + smart language detection
//   • Added discovery.js to Phase 4 — surfaces related content after
//     primary search results (YouTube-style discovery experience).
//   • LanguageService.detectQueryLanguage() powers smart suggestion
//     re-ranking so suggestions stay in the same language as the query.
//   • DiscoveryService is called from RenderingService.renderResults()
//     after primary results are rendered.
//   • Engine gains queryRelated() — deterministic, bounded, scored
//     related-content query (aerospace: no randomness, no unbounded loops).
//
// Public API:
//   window.SearchEngine  — search engine (init, search, querySuggestions, _internals)
//   window.__searchUI    — UI orchestrator (init, destroy, getState, getConfig, ...)
//
// RELIABILITY:
//   • Early data prefetch starts polling ConDataService the moment this script runs.
//   • Cold-start race condition fix: doSearch() stashes query in __pendingSearch;
//     drained here after init completes.
//   • Fail-safe: if ConDataService isn't ready, falls back to fetching db.min.json.
//   • All init errors are logged with `[Search]` prefix — no silent failures.

(function () {
  'use strict';

  if (window.__searchUI?._initialized) return;

  // ── Build ID (replaced at build time by scripts/update-version.js) ──────────
  // WHY: search-modules/*.js don't appear in HTML directly, so the
  // update-version.js ?v= regex can't catch them. FV_BUILD_ID is injected
  // with the real buildId at build time → appended to module URLs as ?v=.
  // Dev mode: '' → _v() returns '' → URLs have no ?v= → normal browser cache.
  var FV_BUILD_ID = '';

  /** Returns '?v=<buildId>' if a buildId exists, otherwise ''. */
  function _v() { return FV_BUILD_ID ? '?v=' + FV_BUILD_ID : ''; }

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
    // Phase 4: Overlay + Discovery — depend on Phase 3
    //   v4.0: discovery.js added here. It uses lazy lookups for
    //   RenderingService and SearchEngine so it can safely load before
    //   engine.js (Phase 5) — those references are resolved at runtime.
    ['overlay.js', 'discovery.js'],
    // Phase 5: Engine + Search service — depend on everything above
    ['engine.js', 'search-service.js'],
  ];

  // ── Early data prefetch ───────────────────────────────────────────────────
  // Start polling for ConDataService the moment this script runs.
  // The data fetch begins while modules are still loading, so both happen
  // in parallel. By the time _boot() calls loadData(), the promise is
  // already resolved (or nearly so).
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
      console.error('[Search] Early data prefetch setup failed:', e);
      return null;
    }
  })();

  // ── Path resolution ───────────────────────────────────────────────────────
  // Resolve the base path of this script so modules load relative to it.
  // Looks for the last <script> whose src ends with '/search.js' inside
  // the search-system directory. Falls back to the well-known absolute path.
  function getBasePath() {
    try {
      const scripts = document.querySelectorAll('script[src]');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i];
        const src = s.getAttribute('src') || '';
        // Match '/search-system/search.js' or 'search-system/search.js'
        // but NOT '/search-ui.js' or other search*.js
        if (/\/search-system\/search\.js(\?|$)/.test(src)) {
          return src.replace(/\/search\.js(\?.*)?$/, '');
        }
      }
    } catch (e) {
      console.warn('[Search] Path resolution fell back to default:', e);
    }
    return '/assets/js/search-system';
  }

  // ── Script loader ─────────────────────────────────────────────────────────
  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      const s  = document.createElement('script');
      // WHY _v(): append ?v=<buildId> for cache-bust of modules not in HTML
      s.src    = url + _v();
      s.async  = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('[Search] Failed to load: ' + url + _v()));
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
   * @param {string[][]} phases
   * @param {string}     base
   * @returns {Promise<void>}
   */
  function loadPhases(phases, base) {
    return phases.reduce(
      function (chain, phase) { return chain.then(() => loadPhase(phase, base)); },
      Promise.resolve()
    );
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  const base = getBasePath();

  // Auto-inject supplemental CSS (mirrors URE's ure.css auto-inject pattern).
  // The legacy /assets/css/search.css + search-compact-overrides.css remain
  // loaded by the page HTML — this file only adds new badge styles.
  _injectCSS(base);

  loadPhases(LOAD_PHASES, base)
    .then(() => _boot())
    .catch(err => console.error('[Search] Module loading failed:', err));

  // ── CSS auto-inject ───────────────────────────────────────────────────────
  function _injectCSS(basePath) {
    try {
      // basePath points to .../search-system (the directory containing this
      // search.js file). The CSS file sits next to search.js.
      const cssUrl = basePath + '/search-system.css' + _v();
      // Skip if already injected (e.g., HMR in dev)
      const existing = document.querySelector('link[data-search-system-css]');
      if (existing) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cssUrl;
      link.setAttribute('data-search-system-css', 'true');
      document.head.appendChild(link);
    } catch (e) {
      console.warn('[Search] CSS auto-inject failed:', e);
    }
  }

  // ── Main init ─────────────────────────────────────────────────────────────
  function _boot() {
    const M = window.SearchModules;
    if (!M) {
      console.error('[Search] SearchModules namespace missing after load');
      return;
    }

    const {
      CONFIG, State, Handlers,
      DOMService, StorageService, URLService,
      KeyboardService, FilterService,
      SearchService, UIService, OverlayService,
      ClearBtnService, IconSlotService,
      VirtualScrollEngine, KeyboardAutoToggleService,
      SearchEngine,
    } = M;

    if (!SearchEngine) {
      console.error('[Search] SearchEngine module missing after load');
      return;
    }

    // ── Data loading ────────────────────────────────────────────────────────
    // Uses _earlyDataPromise if the prefetch already has data.
    // Falls back to the normal ConDataService poll + fetch chain.

    /**
     * Poll for ConDataService availability up to `ms` milliseconds.
     * @param {number} ms
     * @returns {Promise<Object|null>}
     */
    function waitForConDataService(ms) {
      return new Promise(function (resolve) {
        if (window.ConDataService?.getAssembled) return resolve(window.ConDataService);
        const start = Date.now();
        const id = setInterval(function () {
          if (window.ConDataService?.getAssembled) {
            clearInterval(id);
            resolve(window.ConDataService);
          } else if (Date.now() - start >= ms) {
            clearInterval(id);
            resolve(null);
          }
        }, CONFIG.TIMING.conDataServicePollMs);
      });
    }

    /**
     * Load data via early-prefetch promise, or fall back to direct fetch.
     * @returns {Promise<Object>}
     */
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
            console.warn('[Search] ConDataService failed, using fallback:', err);
            return fetch(CONFIG.DB.path).then(r => r.json()).catch(() => ({}));
          });
        }
        console.warn('[Search] ConDataService not ready — using fallback db');
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
              console.warn('[Search] apiData missing .type[] — check ConDataService');
            return SearchEngine.init(State.apiData, {}).catch(e =>
              console.error('[Search] SearchEngine.init failed', e)
            );
          })
          .then(function () {
            try { State.allKeywordsCache = SearchEngine.generateAllKeywords?.() ?? []; }
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
          .catch(e => console.error('[Search] Initialisation failed', e));

        // Form/Enter handlers — attached synchronously so they work immediately.
        // doSearch() defers via __pendingSearch when docs aren't ready yet.
        const form = DOMService.get(CONFIG.DOM.searchFormId);
        if (form) {
          Handlers.formSubmit = e => {
            e.preventDefault();
            SearchService.doSearch();
            UIService.closeKB();
          };
          DOMService.on(form, 'submit', Handlers.formSubmit);
        }

        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        if (inp) {
          DOMService.on(inp, 'keydown', e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              SearchService.doSearch();
              UIService.closeKB();
            }
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
          } catch (e) {
            console.error('[Search] popstate handler failed:', e);
          }
        };
        DOMService.on(window, 'popstate', Handlers.popstate);
        State._handlersAttached = true;

      } catch (e) {
        console.error('[Search] init failed', e);
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
        // v4.0 — Tear down discovery section before the rest so URE
        // handles inside discovery get a clean shutdown.
        if (M.DiscoveryService?.destroy) {
          try { M.DiscoveryService.destroy(); } catch (_) {}
        }
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
        // v4.0 — Also remove discovery container if it still exists.
        DOMService.remove(DOMService.get(CONFIG.DOM.discoveryContainerId));

        window.__pendingSearch = null;
        _earlyDataPromise      = null;

        State.apiData                   = null;
        State.allKeywordsCache          = [];
        State.currentResults            = [];
        State.currentFilteredResults    = [];
        // v4.0 — Clear discovery state
        State.currentDiscovery          = [];
        State.discoveryActive           = false;
        State.discoveryHandle           = null;
        State.lastCommittedSearchState  = null;
        State._handlersAttached         = false;
        State.keyboardAutoToggleEnabled = false;
        UIService._wrapperBuilt         = false;
        window._copyResultTextHandlerSet  = false;

        if (window.__searchUI) window.__searchUI._initialized = false;
      } catch (e) { console.error('[Search] destroy failed', e); }
    }

    // ── Public API ───────────────────────────────────────────────────────────

    window.__searchUI = {
      _initialized : true,
      init,
      destroy,

      getConfig  : () => CONFIG,
      getState   : () => State,
      getModules : () => M,

      // Engine access — exposes the new SearchEngine module via the UI API too
      getEngine  : () => SearchEngine,

      getSessionHistory           : () => StorageService.getHistory(),
      getLastCommittedSearchState : () => State.lastCommittedSearchState,

      querySuggestions: q => SearchEngine?.querySuggestions?.(q, CONFIG.RENDER.suggestionMax) ?? [],
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

    // Dispatch ready event for any listeners (matches URE pattern)
    try {
      window.dispatchEvent(new CustomEvent('search:ready', { detail: { version: '4.0.0' } }));
    } catch (_) {}
  }

})();
