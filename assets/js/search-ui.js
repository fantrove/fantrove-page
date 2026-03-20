// @ts-check
/**
 * @file search-ui.js
 * Self-loading entry point for the search system.
 *
 * HTML only needs ONE tag:
 *   <script src="/assets/js/search-ui.js"></script>
 *
 * This file:
 *  1. Resolves its own directory path
 *  2. Loads all search-modules/* in dependency order (sequential, blocking)
 *  3. After all modules are ready → runs init()
 *
 * Module load order (dependency chain):
 *   types.js          — typedefs only, no runtime deps
 *   config.js         — constants, no deps
 *   state.js          — shared state, no deps
 *   utils.js          — helpers, needs config + state
 *   url-history.js    — history, needs config + state + utils
 *   virtual-scroll.js — VS engine, needs config
 *   keyboard.js       — KB detection, needs config + state + utils
 *   rendering.js      — card HTML + filters, needs config + state + utils + virtual-scroll
 *   suggestions.js    — suggestions, needs config + state + utils
 *   input-bar.js      — icon/clear/UIService, needs config + state + utils
 *   overlay.js        — overlay, needs almost everything above
 *   search.js         — SearchService, needs everything above
 *
 * @module search-ui
 */
(function () {
  'use strict';

  if (window.__searchUI?._initialized) return;

  // ── Module list in load order ─────────────────────────────────────────────
  const MODULES = [
    'types.js',
    'config.js',
    'state.js',
    'utils.js',
    'url-history.js',
    'virtual-scroll.js',
    'keyboard.js',
    'rendering.js',
    'suggestions.js',
    'input-bar.js',
    'overlay.js',
    'search.js',
  ];

  // ── Resolve base path from this script's src ──────────────────────────────
  /**
   * Find the directory that contains search-ui.js.
   * Works even when the page is served from a subpath.
   * Falls back to '/assets/js' if detection fails.
   * @returns {string}  e.g. '/assets/js'
   */
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

  // ── Sequential script loader ──────────────────────────────────────────────
  /**
   * Load scripts one at a time in order.
   * Sequential loading is required because each module depends on the previous.
   *
   * @param {string[]} urls
   * @returns {Promise<void>}
   */
  function loadSequential(urls) {
    return urls.reduce(
      (chain, url) => chain.then(() => loadScript(url)),
      Promise.resolve()
    );
  }

  /**
   * Inject a <script> tag and resolve when it loads, reject on error.
   * @param {string} url
   * @returns {Promise<void>}
   */
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s    = document.createElement('script');
      s.src      = url;
      s.async    = false;   // preserve execution order within the sequence
      s.onload   = () => resolve();
      s.onerror  = () => reject(new Error('[SearchUI] Failed to load module: ' + url));
      document.head.appendChild(s);
    });
  }

  // ── Boot sequence ─────────────────────────────────────────────────────────
  const base = getBasePath();
  const urls = MODULES.map(name => `${base}/search-modules/${name}`);

  loadSequential(urls)
    .then(() => {
      // All modules are ready — SearchModules namespace is fully populated
      _boot();
    })
    .catch((err) => {
      console.error('[SearchUI] Module loading failed:', err);
    });

  // ── Main init (runs after all modules loaded) ─────────────────────────────
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

    function waitForConDataService(ms) {
      return new Promise((resolve) => {
        if (window.ConDataService?.getAssembled) return resolve(window.ConDataService);
        const start = Date.now();
        const id = setInterval(() => {
          if (window.ConDataService?.getAssembled) { clearInterval(id); resolve(window.ConDataService); }
          else if (Date.now() - start >= ms)        { clearInterval(id); resolve(null); }
        }, CONFIG.TIMING.conDataServicePollMs);
      });
    }

    function loadData() {
      return waitForConDataService(CONFIG.TIMING.conDataServiceWaitMs).then((svc) => {
        if (svc) {
          return svc.getAssembled().catch((err) => {
            console.warn('[SearchUI] ConDataService failed, using fallback:', err);
            return fetch(CONFIG.DB.path).then((r) => r.json()).catch(() => ({}));
          });
        }
        console.warn('[SearchUI] ConDataService not ready — using fallback db');
        return fetch(CONFIG.DB.path).then((r) => r.json()).catch(() => ({}));
      });
    }

    // ── Init ────────────────────────────────────────────────────────────────

    function init() {
      try {
        KeyboardService.initKeyboardDetection();

        loadData()
          .then((data) => {
            State.apiData = data || {};
            if (!Array.isArray(State.apiData.type))
              console.warn('[SearchUI] apiData missing .type[] — check ConDataService');
            const engineInit = window.SearchEngine?.init ?? (() => Promise.resolve());
            return engineInit(State.apiData, {}).catch((e) =>
              console.error('[SearchUI] SearchEngine.init failed', e)
            );
          })
          .then(() => {
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
              sr.innerHTML = `<div class="search-result-here" style="text-align:center;color:#969ca8;font-size:1.05em;margin-top:30px;">${M.LanguageService.t('search_result_here')}</div>`;
            }
            UIService.updateUILanguage();

            _restoreLastCommitted();

            const urlState = URLService.readStateFromURL();
            if (urlState.q) {
              SearchService.doSearchFromURL(urlState.q, urlState.type || 'all', urlState.category || 'all');
            } else {
              URLService.replaceSearch({ q: '', type: 'all', category: 'all' });
            }
          })
          .catch((e) => console.error('[SearchUI] Initialisation failed', e));

        // Form submit
        const form = DOMService.get(CONFIG.DOM.searchFormId);
        if (form) {
          Handlers.formSubmit = (e) => { e.preventDefault(); SearchService.doSearch(); UIService.closeKB(); };
          DOMService.on(form, 'submit', Handlers.formSubmit);
        }

        // Enter on input (fires before overlay's own listener)
        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        if (inp) {
          DOMService.on(inp, 'keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); SearchService.doSearch(); UIService.closeKB(); }
          });
        }

        // ── Popstate — two-stack history model ──────────────────────────────
        //
        // Case A: overlay open       → close it; restore search state if needed
        // Case B: orphaned overlay entry → clean up + restore
        // Case C: regular search entry  → restore UI
        //
        Handlers.popstate = (e) => {
          try {
            const s              = e.state || {};
            const isOverlayEntry = !!s[State._overlayStateMarker];

            if (State.overlayOpen) {
              OverlayService.close('popstate');
              if (!isOverlayEntry && s.q !== undefined) {
                // Build a normalised representation of the state we are going back to.
                const backState = {
                  q        : s.q        || '',
                  type     : s.type     || 'all',
                  category : s.category || 'all',
                };
                // Only re-render if the state we're navigating back to differs
                // from what is already shown on the main page.
                //
                // WHY: if the user opened the overlay and closed it WITHOUT
                // changing the query, backState === lastCommittedSearchState.
                // Calling _restoreUIState anyway would:
                //   1. Trigger VirtualScrollEngine.destroy() + mount()
                //   2. Cause a brief empty-frame flash
                //   3. Scroll position stays correct but content blinks
                //
                // Skipping is safe because the results, type-filter state, and
                // input value are already correct — nothing changed.
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

      querySuggestions: (q) => window.SearchEngine?.querySuggestions?.(q, CONFIG.RENDER.suggestionMax) ?? [],
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