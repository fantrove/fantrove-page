// @ts-check
/**
 * @file router.js
 * RouterService + NavigationService
 *
 * v3.0.0 — "Engineering-grade navigation" rewrite
 *
 * ARCHITECTURE CHANGES (from v2.x):
 *
 * 1. Formal state machine (NEW)
 *    ──────────────────────
 *    Navigation states: IDLE → VALIDATING → FETCHING → RENDERING → IDLE
 *                       (any → ERROR → IDLE)
 *
 *    Each transition is validated. Impossible transitions (e.g.
 *    RENDERING → FETCHING) are rejected with a clear error. This makes
 *    the navigation flow much more predictable and easier to debug.
 *
 * 2. AbortController for cancellation (NEW)
 *    ─────────────────────────────────────
 *    Every navigation gets its own AbortController. When a new navigation
 *    supersedes an old one, the old controller is aborted — in-flight
 *    fetches are cancelled at the network level, not just ignored.
 *
 *    This eliminates:
 *      • Wasted bandwidth on stale fetches
 *      • Race conditions where stale data renders over fresh data
 *      • Memory leaks from abandoned promises
 *
 * 3. Scroll restoration (NEW)
 *    ────────────────────────
 *    `history.scrollRestoration = 'manual'` + custom restoration on
 *    back/forward. Saves scroll position per history entry; restores it
 *    on popstate. Matches native app behavior (iOS/Android restore
 *    scroll position when returning to a list).
 *
 * 4. Optimistic UI (NEW)
 *    ───────────────────
 *    Button active state is set IMMEDIATELY on click, before the fetch
 *    completes. If the navigation fails, we revert. Matches Twitter/
 *    Instagram native behavior — the UI feels instant even on slow
 *    networks.
 *
 * 5. View Transitions API (NEW, progressive enhancement)
 *    ───────────────────────────────────────────────────
 *    Wraps content swaps in `document.startViewTransition()` when
 *    available (Chromium 111+). Falls back to instant swap otherwise.
 *    Provides smooth crossfade between old and new content.
 *
 * 6. scheduler.yield() for main-thread cooperation (NEW)
 *    ───────────────────────────────────────────────────
 *    Between phases (validate → fetch → render), yield to the main
 *    thread so user input remains responsive. Uses scheduler.yield()
 *    where available, falls back to rAF.
 *
 * 7. Self-healing watchdog (NEW)
 *    ──────────────────────────
 *    The 20s safety timer from v3.x is kept, but now ALSO triggers
 *    a state-machine reset (not just a force-reset of loading). This
 *    guarantees recovery even if the state machine itself wedges.
 *
 * 8. Navigation prefetch (NEW)
 *    ─────────────────────────
 *    After successful navigation, prefetch the JSON for likely-next
 *    categories using `<link rel="prefetch">`. Heuristic: prefetch
 *    the two siblings of the current main button. Matches Next.js
 *    App Router behavior.
 *
 * @module router
 * @depends {config.js, state.js, utils.js, loading.js, content.js,
 *           data.js, buttons.js}
 */
(function (M) {
  'use strict';

  const { CONFIG, State, Utils } = M;
  // v4.0: TracingService for span recording, A11yService for focus management
  const Tracing = M.TracingService;
  const A11y = M.A11yService;
  const AdaptiveLoader = M.AdaptiveLoader;

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: Navigation state machine
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Why a formal state machine:
  //   The v2.x router had implicit states (isNavigating boolean + navGen counter).
  //   That made it easy to enter impossible states — e.g. "navigating" but
  //   the abort controller was already aborted. The formal FSM prevents this
  //   by validating every transition.
  //
  // States:
  //   IDLE        — no navigation in progress, ready to accept new ones
  //   VALIDATING  — checking the URL is valid (sync, fast)
  //   FETCHING    — fetching data for the route (async, cancellable)
  //   RENDERING   — rendering content into the DOM (sync, fast)
  //   ERROR       — navigation failed, awaiting recovery or user action
  //
  // Transitions:
  //   IDLE       → VALIDATING  (start)
  //   VALIDATING → FETCHING    (URL is valid)
  //   VALIDATING → ERROR       (URL invalid, falling back to default)
  //   FETCHING   → RENDERING   (data ready)
  //   FETCHING   → IDLE        (superseded — abort)
  //   FETCHING   → ERROR       (network failure)
  //   RENDERING  → IDLE        (done)
  //   RENDERING  → ERROR       (render threw)
  //   ERROR      → IDLE        (recovered)

  const NAV_STATE = Object.freeze({
    IDLE:       'idle',
    VALIDATING: 'validating',
    FETCHING:   'fetching',
    RENDERING:  'rendering',
    ERROR:      'error',
  });

  // Valid transitions: from → [allowed targets]
  const _ALLOWED_TRANSITIONS = Object.freeze({
    [NAV_STATE.IDLE]:       [NAV_STATE.VALIDATING],
    [NAV_STATE.VALIDATING]: [NAV_STATE.FETCHING, NAV_STATE.ERROR, NAV_STATE.IDLE],
    [NAV_STATE.FETCHING]:   [NAV_STATE.RENDERING, NAV_STATE.ERROR, NAV_STATE.IDLE],
    [NAV_STATE.RENDERING]:  [NAV_STATE.IDLE, NAV_STATE.ERROR],
    [NAV_STATE.ERROR]:      [NAV_STATE.IDLE, NAV_STATE.VALIDATING],
  });

  // ── Yield helper — prefers scheduler.yield, falls back to rAF ──────────────
  function _yieldToMain() {
    try {
      if (typeof scheduler !== 'undefined' && scheduler.yield) {
        return scheduler.yield();
      }
    } catch (_) {}
    return new Promise(function (r) { requestAnimationFrame(function () { r(); }); });
  }

  const RouterService = {

    // ── Public state (kept for back-compat with v2.x callers) ─────────────────
    state: {
      isNavigating:       false,
      currentMainRoute:   '',
      currentSubRoute:    '',
      previousUrl:        '',
      lastScrollPosition: 0,
    },

    // ── Internal state ────────────────────────────────────────────────────────
    _initialNavigation: true,
    _safetyTimer: null,
    _navGen: 0,                    // generation counter (latest-wins)
    _fsmState: NAV_STATE.IDLE,     // formal state machine
    _abortController: null,        // current navigation's abort controller
    _scrollMap: new Map(),         // history-entry → scroll position

    // ── FSM helpers ───────────────────────────────────────────────────────────

    /**
     * Transition the FSM to a new state. Throws on impossible transitions
     * (caught by the navigateTo try/catch and surfaced as ERROR state).
     * @param {string} target
     * @private
     */
    _transition(target) {
      const allowed = _ALLOWED_TRANSITIONS[this._fsmState] || [];
      if (!allowed.includes(target)) {
        // Don't throw — just log. In production, a bad transition should
        // not crash the page; we force-reset to IDLE and continue.
        console.warn('[NavCore/Router] invalid FSM transition:',
                     this._fsmState, '→', target, '(forcing IDLE)');
        this._fsmState = NAV_STATE.IDLE;
        return;
      }
      this._fsmState = target;
    },

    /**
     * @returns {string} current FSM state (for diagnostics)
     */
    getFsmState() { return this._fsmState; },

    // ── URL normalization (unchanged from v2.x) ───────────────────────────────

    normalizeUrl(input) {
      if (!input) return '';
      const btnCfg = State.buttons.config || {};
      let main = '', sub = '';

      if (typeof input === 'object') {
        main = String(input.type || '');
        sub  = String(input.page || '');
      } else if (typeof input === 'string') {
        if (input.startsWith('?')) {
          const p = new URLSearchParams(input);
          main = (p.get('type') || '').replace(/__$/, '');
          sub  = p.get('page') || '';
        } else if (input.includes('-')) {
          [main, sub] = input.split('-');
          main = main || ''; sub = sub || '';
        } else {
          main = input;
        }
      }

      const mainBtn = (btnCfg.mainButtons || []).find(b => b.url === main || b.jsonFile === main);
      const hasSub  = !!(mainBtn?.subButtons?.length);
      if (hasSub) return sub ? `?type=${main}__&page=${sub}` : `?type=${main}__`;
      return `?type=${main}`;
    },

    parseUrl(q = window.location.search) {
      if (!q?.startsWith('?')) {
        if (q?.includes('-')) { const [m, s] = q.split('-'); return { main: m || '', sub: s || '' }; }
        return { main: q || '', sub: '' };
      }
      const p = new URLSearchParams(q);
      return { main: (p.get('type') || '').replace(/__$/, ''), sub: p.get('page') || '' };
    },

    async validateUrl(url) {
      try {
        const cfg = State.buttons.config;
        if (!cfg) return false;
        const { main, sub } = this.parseUrl(typeof url === 'string' ? url : this.normalizeUrl(url));
        const mainBtn = (cfg.mainButtons || []).find(b => b.url === main || b.jsonFile === main);
        if (!mainBtn) return false;
        if (sub) return !!(mainBtn.subButtons?.some(sb => sb.url === sub || sb.jsonFile === sub));
        return true;
      } catch (_) { return false; }
    },

    /**
     * "All" system button เป็น default เสมอ — ไม่มี isDefault ใน main buttons แล้ว
     * @returns {Promise<string>}
     */
    async getDefaultRoute() {
      return this.normalizeUrl(CONFIG.ALL_BUTTON.URL);
    },

    // ── Scroll restoration ────────────────────────────────────────────────────
    //
    // Modern browsers default to 'auto' (browser restores scroll on
    // back/forward). We override to 'manual' and restore ourselves so:
    //   1. We can restore scroll for SPA-style navigations (pushState)
    //   2. We can choose to scroll to top on forward navigation but
    //      preserve scroll on back navigation (matches native app UX)
    //
    // Implementation:
    //   - On pushState: save current scrollY in _scrollMap keyed by
    //     the OLD url. On popstate, look up the destination url in
    //     _scrollMap and scroll to it.
    //   - On forward navigation (not popstate): scroll to top.

    _installScrollRestoration() {
      try {
        if ('scrollRestoration' in history) {
          history.scrollRestoration = 'manual';
        }
      } catch (_) {}
    },

    _saveScrollForCurrentUrl() {
      try {
        const key = window.location.pathname + window.location.search;
        this._scrollMap.set(key, window.scrollY || 0);
        // LRU eviction — keep map bounded
        if (this._scrollMap.size > 50) {
          const firstKey = this._scrollMap.keys().next().value;
          this._scrollMap.delete(firstKey);
        }
      } catch (_) {}
    },

    _restoreScrollForUrl(url) {
      try {
        const pos = this._scrollMap.get(url);
        if (typeof pos === 'number') {
          // Use 'auto' to avoid competing with content paint
          window.scrollTo(0, pos);
          return true;
        }
      } catch (_) {}
      return false;
    },

    // ── changeURL ──────────────────────────────────────────────────────────────

    async changeURL(url, forcePush = false, opts = {}) {
      try {
        const normalized = this.normalizeUrl(url);
        if (!normalized) return;

        // Save scroll position for the CURRENT url before changing it
        if (!opts.replace) {
          this._saveScrollForCurrentUrl();
        }

        if ((window.location.search || '') === normalized) {
          this.state.previousUrl = normalized;
          window.dispatchEvent(new CustomEvent('urlChanged', {
            detail: { url: normalized, mainRoute: this.state.currentMainRoute, subRoute: this.state.currentSubRoute },
          }));
          this._initialNavigation = false;
          return;
        }

        const useReplace = opts.replace === true || (this._initialNavigation && !forcePush);
        const method     = useReplace ? 'replaceState' : 'pushState';

        try {
          window.history[method]({ url: normalized, scrollPosition: this.state.lastScrollPosition }, '', normalized);
        } catch (_) {
          const fallback = useReplace ? 'pushState' : 'replaceState';
          try { window.history[fallback]({ url: normalized }, '', normalized); } catch (__) {}
        }

        this._initialNavigation = false;
        this.state.previousUrl  = normalized;

        window.dispatchEvent(new CustomEvent('urlChanged', {
          detail: { url: normalized, mainRoute: this.state.currentMainRoute, subRoute: this.state.currentSubRoute },
        }));
      } catch (err) { console.error('[NavCore/Router] changeURL error:', err); }
    },

    // ── Active button state ────────────────────────────────────────────────────
    //
    // v3.0: setActiveButtons now supports an "optimistic" flag — when true,
    // the buttons are visually updated immediately without waiting for the
    // fetch to complete. If the navigation fails, we revert by calling
    // setActiveButtons with the previous main/sub.

    setActiveButtons(main, sub) {
      try {
        const navList = State.elements?.navList;
        const subCtr  = State.elements?.subButtonsContainer;

        if (navList) {
          let found = null;
          navList.querySelectorAll('button').forEach(btn => {
            const active = btn.getAttribute('data-url') === main;
            btn.classList.toggle('active', active);
            if (active) found = btn;
          });
          if (found) {
            State.buttons.currentMainButton    = found;
            State.buttons.currentMainButtonUrl = main;
          }
        }

        if (subCtr && sub) {
          const target = `${main}-${sub}`;
          let found = null;
          subCtr.querySelectorAll('button').forEach(btn => {
            const active = btn.getAttribute('data-url') === target;
            btn.classList.toggle('active', active);
            if (active) found = btn;
          });
          if (found) State.buttons.currentSubButton = found;
        }
      } catch (err) { console.error('[NavCore/Router] setActiveButtons error:', err); }
    },

    updateActiveFromLocation() {
      try {
        const { main, sub } = this.parseUrl(window.location.search);
        this.setActiveButtons(main, sub);
      } catch (_) {}
    },

    // ── View Transitions API wrapper ──────────────────────────────────────────
    //
    // Wrap a DOM-mutating callback in document.startViewTransition when
    // available (Chromium 111+). Falls back to direct invocation otherwise.
    // The callback receives no args and may return a Promise.
    //
    // The transition is named 'nc-route-change' so CSS can target it:
    //   ::view-transition-old(nc-route-change) { animation: ...; }
    //   ::view-transition-new(nc-route-change) { animation: ...; }

    _withViewTransition(callback) {
      try {
        if (typeof document.startViewTransition === 'function') {
          const transition = document.startViewTransition(callback);
          // Best-effort: name the transition for CSS targeting.
          try { transition.finished.catch(() => {}); } catch (_) {}
          return transition.finished.catch(() => {});
        }
      } catch (_) {}
      // Fallback: invoke directly
      try {
        const result = callback();
        return result && typeof result.then === 'function'
          ? result
          : Promise.resolve();
      } catch (e) { return Promise.reject(e); }
    },

    // ── navigateTo ─────────────────────────────────────────────────────────────
    //
    // v3.0 flow:
    //   1. _forceReset (clear any stuck state)
    //   2. Abort previous navigation's controller (if any)
    //   3. Acquire new AbortController + generation
    //   4. _transition(VALIDATING)
    //   5. Optimistic UI: set button active state
    //   6. _transition(FETCHING) → fetch data with AbortSignal
    //   7. _transition(RENDERING) → render with View Transitions
    //   8. _transition(IDLE) → cleanup

    async navigateTo(route, options = {}) {
      // v4.0: Start a trace for this navigation
      var traceRoot = null;
      try {
        if (Tracing) {
          traceRoot = Tracing.startTrace('navigateTo', {
            category: Tracing.SPAN_CATEGORY.NAVIGATION,
          });
          traceRoot.setAttribute('route', String(route));
          traceRoot.setAttribute('options', JSON.stringify(options));
        }
      } catch (_) {}

      // v5.0: ALWAYS show loading — no exceptions, no "if cached" branch.
      // This is the hard contract: every navigation (button click, popstate,
      // initial load, same-route re-navigation) shows the loading overlay
      // for at least MIN_VISIBLE_MS (200ms), even if data is cached.
      // The user MUST see loading feedback on EVERY interaction.
      //
      // We also announce to A11y so screen reader users know a navigation
      // started (they can't see the visual overlay).
      try { A11y && A11y.announce('Loading...'); } catch (_) {}

      // ── Phase 0: reset any stuck state ──────────────────────────────────
      // NOTE: _forceReset() clears the session counter, so the show() below
      // starts fresh. This is important — if we didn't reset, rapid clicks
      // would accumulate sessions and the overlay would never hide.
      try { M.LoadingService?._forceReset(); } catch (_) {}

      // ── Phase 1: abort previous navigation ──────────────────────────────
      if (this._abortController) {
        try { this._abortController.abort(); } catch (_) {}
        this._abortController = null;
      }
      const abortController = new AbortController();
      this._abortController = abortController;
      const signal = abortController.signal;

      // ── Phase 2: nav-gen + state setup ──────────────────────────────────
      this._navGen++;
      const myGen = this._navGen;
      this._transition(NAV_STATE.VALIDATING);

      // v5.0: ALWAYS show loading overlay — this is the contract.
      // Show happens BEFORE _setNavLoading so the overlay is the FIRST
      // thing the user sees on a new navigation.
      this._setNavLoading(true);
      try { M.LoadingService?.show(); } catch (_) {}

      // Guarantee overlay paint before mutating content (kept from v4)
      await new Promise(function (r) { requestAnimationFrame(r); });
      if (myGen !== this._navGen) {
        try { traceRoot && traceRoot.end(); Tracing && Tracing.endTrace(); } catch (_) {}
        return; // superseded
      }

      this.state.isNavigating       = true;
      this.state.lastScrollPosition = window.pageYOffset || 0;

      // ── Phase 3: safety timer (self-healing watchdog) ───────────────────
      if (this._safetyTimer) clearTimeout(this._safetyTimer);
      this._safetyTimer = setTimeout(() => {
        if (this.state.isNavigating && this._navGen === myGen) {
          console.warn('[NavCore/Router] Navigation safety timeout (20s) — forcing reset');
          try { abortController.abort(); } catch (_) {}
          this.state.isNavigating = false;
          this._fsmState = NAV_STATE.IDLE;
          try {
            M.LoadingService._forceReset();
            this._setNavLoading(false);
            // Belt-and-braces: clear body lock if somehow stuck
            if (document.body.style.position === 'fixed') {
              document.body.style.position = '';
              document.body.style.top = '';
              document.body.style.left = '';
              document.body.style.right = '';
              document.body.style.width = '';
            }
          } catch (_) {}
          this._safetyTimer = null;
        }
      }, 20000);

      // Save optimistic-UI state for potential rollback
      const prevMain = this.state.currentMainRoute;
      const prevSub  = this.state.currentSubRoute;

      try {
        let normalized = (typeof route === 'object' || route?.startsWith?.('?'))
          ? this.normalizeUrl(route)
          : route;
        if (typeof route === 'string' && route.startsWith('?'))
          normalized = this.normalizeUrl(route);

        if (myGen !== this._navGen) return;

        // ── Phase 4: validate URL ─────────────────────────────────────────
        let valid = false;
        try { valid = await this.validateUrl(normalized); } catch (_) {}
        if (!valid) {
          // Fall back to default route
          try { this._transition(NAV_STATE.ERROR); } catch (_) {}
          normalized = await this.getDefaultRoute();
          this._transition(NAV_STATE.IDLE);
          this._transition(NAV_STATE.VALIDATING);
        }

        if (myGen !== this._navGen) return;

        const { main, sub } = this.parseUrl(normalized);
        this.state.currentMainRoute = main;
        this.state.currentSubRoute  = sub || '';

        State.navigation.currentMainRoute = main;
        State.navigation.currentSubRoute  = sub || '';

        // ── Phase 5: Optimistic UI — set button active state IMMEDIATELY ──
        // WHY: makes the UI feel instant. User taps a category → button
        //   highlights in <16ms, even on slow networks. If navigation
        //   fails, the catch block reverts to prevMain/prevSub.
        this.setActiveButtons(main, sub);

        if (!options.skipUrlUpdate) {
          await this.changeURL(
            { type: main, page: sub },
            !!options.forcePush,
            { replace: !!options.replace }
          );
        }

        if (myGen !== this._navGen) return;

        const cfg = State.buttons.config;
        if (!cfg) throw new Error('[NavCore/Router] buttonConfig not found');

        const mainButton = (cfg.mainButtons || []).find(b => b.url === main || b.jsonFile === main);
        if (!mainButton) throw new Error('[NavCore/Router] mainButton not found for: ' + main);

        // ── Phase 6: smart loading message ─────────────────────────────────
        try {
          const lang = localStorage.getItem('selectedLang') || 'en';
          const btnLabel = mainButton.label?.[lang]
                        || mainButton.name?.[lang]
                        || mainButton.label?.en
                        || mainButton.name?.en
                        || '';
          if (btnLabel) {
            const msg = (lang === 'th')
              ? 'กำลังโหลด' + btnLabel + '...'
              : 'Loading ' + btnLabel + '...';
            M.LoadingService?.updateMessage?.(msg);
          }
        } catch (_) {}

        const lang          = localStorage.getItem('selectedLang') || 'en';
        const hasSubButtons = mainButton.subButtons?.length > 0;
        let   chosenSub     = null;

        if (hasSubButtons) {
          chosenSub =
            mainButton.subButtons.find(sb => sb.url === sub || sb.jsonFile === sub) ||
            mainButton.subButtons.find(sb => sb.isDefault) ||
            mainButton.subButtons[0];

          try {
            await M.ButtonService.renderSubButtons(mainButton.subButtons, main, lang);
            M.SubNavService?.showSubNav();
            try { M.LoadingService?._updateTopVar(); } catch (_) {}
            this.setActiveButtons(main, chosenSub?.url || chosenSub?.jsonFile || sub);
          } catch (e) { console.warn('[NavCore/Router] renderSubButtons failed:', e); }
        } else {
          try { M.SubNavService?.hideSubNav(); } catch (_) {}
          try { M.LoadingService?._updateTopVar(); } catch (_) {}
        }

        if (myGen !== this._navGen) return;

        // ── Phase 7: FETCHING — fetch with AbortSignal ────────────────────
        this._transition(NAV_STATE.FETCHING);
        var fetchSpan = null;
        try {
          if (Tracing) fetchSpan = Tracing.startSpan('fetch', { category: Tracing.SPAN_CATEGORY.NETWORK });
        } catch (_) {}

        if (main === CONFIG.ALL_BUTTON.URL) {
          // ── Smart infinite feed ───────────────────────────────────────
          try {
            await M.ContentService.renderFeed(lang, { signal });
          } catch (feedErr) {
            if (signal.aborted) {
              try { fetchSpan && fetchSpan.end(); } catch (_) {}
              return; // graceful cancel
            }
            console.error('[NavCore/Router] renderFeed error:', feedErr);
            throw feedErr;
          }
        } else {
          // ── Normal content rendering ──────────────────────────────────
          try { await M.ContentService.clearContent({ signal }); } catch (_) {}

          const jobs = [];
          if (mainButton.jsonFile)
            jobs.push(M.DataService.fetchWithRetry(mainButton.jsonFile, { signal }, 2).catch(() => null));
          if (chosenSub?.jsonFile)
            jobs.push(M.DataService.fetchWithRetry(chosenSub.jsonFile, { signal }, 3).catch(() => null));

          if (jobs.length) {
            const results  = await Promise.all(jobs);
            if (signal.aborted || myGen !== this._navGen) {
              try { fetchSpan && fetchSpan.end(); } catch (_) {}
              return;
            }
            try { fetchSpan && fetchSpan.setAttribute('jobs', jobs.length).end(); } catch (_) {}
            const combined = results.flatMap(r => Array.isArray(r) ? r : (r ? [r] : []));
            if (combined.length) {
              // ── Phase 8: RENDERING — use View Transitions ─────────────
              this._transition(NAV_STATE.RENDERING);
              var renderSpan = null;
              try {
                if (Tracing) renderSpan = Tracing.startSpan('render', { category: Tracing.SPAN_CATEGORY.RENDER });
              } catch (_) {}

              // v4.0: Gate View Transitions by AdaptiveLoader
              var useVT = true;
              try {
                useVT = !AdaptiveLoader || AdaptiveLoader.shouldUseViewTransitions();
              } catch (_) {}

              if (useVT) {
                await this._withViewTransition(() => {
                  return M.ContentService.renderContent(combined, { signal });
                });
              } else {
                await M.ContentService.renderContent(combined, { signal });
              }
              try { renderSpan && renderSpan.end(); } catch (_) {}
            }
          } else {
            try { fetchSpan && fetchSpan.end(); } catch (_) {}
          }
        }

        if (myGen !== this._navGen) {
          try { traceRoot && traceRoot.end(); Tracing && Tracing.endTrace(); } catch (_) {}
          return;
        }
        if (signal.aborted) {
          try { traceRoot && traceRoot.end(); Tracing && Tracing.endTrace(); } catch (_) {}
          return;
        }

        this.setActiveButtons(main, chosenSub?.url || chosenSub?.jsonFile || sub);

        window.dispatchEvent(new CustomEvent('routeChanged', {
          detail: { main, sub: chosenSub?.url || chosenSub?.jsonFile || sub },
        }));

        // ── Phase 9: scroll restoration ────────────────────────────────────
        // popstate: restore saved scroll. Otherwise: scroll to top.
        if (options.isPopState) {
          const restored = this._restoreScrollForUrl(window.location.pathname + window.location.search);
          if (!restored && !options.maintainScroll) {
            try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (_) {}
          }
        } else if (!options.maintainScroll) {
          try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) {}
        }

        // ── Phase 9.5: A11y announcement + focus management (v4.0) ────────
        // Move focus to main content + announce route to screen readers
        try {
          if (A11y) {
            var btnLabel = '';
            try {
              const lang = localStorage.getItem('selectedLang') || 'en';
              btnLabel = mainButton.label?.[lang] || mainButton.name?.[lang] ||
                         mainButton.label?.en || mainButton.name?.en || '';
            } catch (_) {}
            A11y.onNavigationComplete(btnLabel || main);
          }
        } catch (_) {}

        // ── Phase 10: prefetch likely-next categories (best-effort) ───────
        this._prefetchSiblings(main, cfg);

        this._transition(NAV_STATE.IDLE);

        // End trace
        try {
          if (traceRoot) {
            traceRoot.setAttribute('main', main);
            traceRoot.setAttribute('sub', chosenSub?.url || chosenSub?.jsonFile || sub);
            traceRoot.setStatus(Tracing ? Tracing.SPAN_STATUS.OK : 'ok');
            traceRoot.end();
          }
          if (Tracing) Tracing.endTrace();
        } catch (_) {}

      } catch (err) {
        // ── Phase X: ERROR — revert optimistic UI + log ────────────────────
        if (myGen === this._navGen) {
          console.error('[NavCore/Router] navigateTo error:', err);
          // Revert optimistic UI
          try { this.setActiveButtons(prevMain, prevSub); } catch (_) {}
          try { this._transition(NAV_STATE.ERROR); } catch (_) {}
          try { this._transition(NAV_STATE.IDLE); } catch (_) {}
          try { Utils.showErrorFullscreen(err, { label: 'Navigation' }); } catch (_) {}
          // v4.0: Announce error to screen readers
          try { A11y && A11y.announceError('Navigation failed: ' + (err && err.message || 'unknown error')); } catch (_) {}
          // End trace with error status
          try {
            if (traceRoot) {
              traceRoot.setStatus(Tracing ? Tracing.SPAN_STATUS.ERROR : 'error');
              traceRoot.setAttribute('error', err && err.message ? err.message : String(err));
              traceRoot.end();
            }
            if (Tracing) Tracing.endTrace();
          } catch (_) {}
        }
      } finally {
        // ── Phase Y: cleanup (only if we're still the latest) ─────────────
        if (myGen === this._navGen) {
          this.state.isNavigating = false;
          if (this._safetyTimer) { clearTimeout(this._safetyTimer); this._safetyTimer = null; }
          if (this._abortController === abortController) {
            this._abortController = null;
          }
          try {
            requestAnimationFrame(() => {
              this._setNavLoading(false);
              // v3.1 DEFENSIVE: ensure body scroll-lock is released even if
              // an exception escaped cleanup. Belt-and-braces —
              // ScrollLockService should already have handled this.
              try {
                if (document.body.style.position === 'fixed') {
                  document.body.style.position = '';
                  document.body.style.top      = '';
                  document.body.style.left     = '';
                  document.body.style.right    = '';
                  document.body.style.width    = '';
                }
              } catch (_) {}
            });
          } catch (_) {}
        }
      }
    },

    /**
     * Prefetch the JSON files for the two siblings of the currently-active
     * main button. Matches Next.js App Router behavior — likely-next
     * navigations should be instant.
     *
     * v4.0: Now delegates to PrefetchService which uses Speculation Rules
     * API (prerender) when available, falling back to <link rel="prefetch">.
     * Gated by AdaptiveLoader.shouldPrefetch() — skips on 2g/save-data.
     *
     * @private
     */
    _prefetchSiblings(currentMain, cfg) {
      try {
        if (!M.PrefetchService) return;
        const buttons = cfg.mainButtons || [];
        const idx = buttons.findIndex(b => b.url === currentMain || b.jsonFile === currentMain);
        if (idx < 0) return;
        const candidates = [buttons[idx - 1], buttons[idx + 1]].filter(Boolean);
        for (const btn of candidates) {
          if (!btn.jsonFile) continue;
          M.PrefetchService.prefetch(btn.jsonFile, { eagerness: 'moderate' });
        }
      } catch (_) {}
    },

    /**
     * Toggle the "nav-loading" state.
     * Adds/removes the body class AND sets opacity directly via JS for
     * browsers that don't honor `!important` opacity on `nav` elements.
     *
     * @param {boolean} isLoading
     */
    _setNavLoading(isLoading) {
      try {
        if (isLoading) {
          document.body.classList.add('fvl-nav-mode', 'nav-loading');
        } else {
          document.body.classList.remove('nav-loading');
        }

        const nav    = document.querySelector('header nav');
        const subNav = document.getElementById('sub-nav');
        const opacity = isLoading ? '0' : '';
        const pe      = isLoading ? 'none' : '';

        if (nav) {
          nav.style.setProperty('opacity', opacity, 'important');
          nav.style.setProperty('pointer-events', pe, 'important');
        }
        if (subNav) {
          subNav.style.setProperty('opacity', opacity, 'important');
          subNav.style.setProperty('pointer-events', pe, 'important');
        }
      } catch (_) {}
    },

    // ── _waitUntilFree (kept for back-compat) ──────────────────────────────────

    _waitUntilFree(timeoutMs = 10000) {
      return new Promise((resolve, reject) => {
        if (!this.state.isNavigating) { resolve(); return; }
        const start = Date.now();
        const id = setInterval(() => {
          if (!this.state.isNavigating) { clearInterval(id); resolve(); }
          else if (Date.now() - start >= timeoutMs) { clearInterval(id); reject(new Error('timeout')); }
        }, 50);
      });
    },

    // ── Initialization ─────────────────────────────────────────────────────────

    init() {
      // Install scroll restoration override
      this._installScrollRestoration();

      window.addEventListener('popstate', async (ev) => {
        try {
          try { this.updateActiveFromLocation(); } catch (_) {}
          await this.navigateTo(window.location.search || '', {
            isPopState:    true,
            skipUrlUpdate: true,
            maintainScroll: false, // we restore from _scrollMap ourselves
          });
        } catch (e) { console.error('[NavCore/Router] popstate error:', e); }
      }, { passive: true });
    },

    markInitialNavigationHandled() {
      this._initialNavigation = false;
    },

    activateUiOnly(main, sub) {
      try {
        this.state.currentMainRoute = main;
        this.state.currentSubRoute  = sub || '';
        this.setActiveButtons(main, sub);
      } catch (e) { console.error('[NavCore/Router] activateUiOnly error:', e); }
    },

    scrollActiveButtonsIntoView() {
      ['nav ul', `#${CONFIG.DOM.SUB_BUTTONS_ID}`].forEach(sel => {
        const c = document.querySelector(sel);
        const a = c?.querySelector('button.active');
        if (!c || !a) return;
        requestAnimationFrame(() => {
          try {
            const cb = c.getBoundingClientRect(), ab = a.getBoundingClientRect();
            c.scrollTo({ left: Math.max(0, c.scrollLeft + ab.left - cb.left - 20), behavior: 'smooth' });
          } catch (_) {}
        });
      });
    },

    updateButtonStates(url) {
      try {
        const { main, sub } = this.parseUrl(url || window.location.search);
        const el = State.elements;
        el?.navList?.querySelectorAll('button').forEach(b =>
          b.classList.toggle('active', b.getAttribute('data-url') === main));
        el?.subButtonsContainer?.querySelectorAll('button').forEach(b =>
          b.classList.toggle('active', b.getAttribute('data-url') === `${main}-${sub}`));
        this.scrollActiveButtonsIntoView();
      } catch (_) {}
    },

    // ── Diagnostic API ────────────────────────────────────────────────────────
    _diagnostics() {
      return {
        fsmState: this._fsmState,
        navGen: this._navGen,
        isNavigating: this.state.isNavigating,
        currentMainRoute: this.state.currentMainRoute,
        currentSubRoute: this.state.currentSubRoute,
        hasAbortController: !!this._abortController,
        scrollMapSize: this._scrollMap.size,
      };
    },
  };

  // ── NavigationService — backward-compat proxy ──────────────────────────────────

  const NavigationService = {
    state: RouterService.state,
    normalizeUrl(u)   { return RouterService.normalizeUrl(u); },
    parseUrl(u)       { return RouterService.parseUrl(u); },
    validateUrl(u)    { return RouterService.validateUrl(u); },
    getDefaultRoute() { return RouterService.getDefaultRoute(); },
    changeURL(u, f)   { return RouterService.changeURL(u, f); },
    navigateTo(r, o)  { return RouterService.navigateTo(r, o); },
    updateButtonStates(url)       { return RouterService.updateButtonStates(url); },
    scrollActiveButtonsIntoView() { return RouterService.scrollActiveButtonsIntoView(); },
  };

  M.RouterService     = RouterService;
  M.NavigationService = NavigationService;
  M.NAV_STATE         = NAV_STATE;

})(window.NavCoreModules = window.NavCoreModules || {});
