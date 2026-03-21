// @ts-check
/**
 * @file router.js
 * RouterService    — SPA routing: navigateTo, validateUrl, parseUrl, changeURL.
 * NavigationService — backward-compatibility proxy to RouterService.
 *
 * Consolidated from router.js + managers.js:navigationManager.
 *
 * Key behaviors (preserved from v3):
 *  ① LoadingService.show() fires BEFORE the isNavigating guard
 *     → user always sees loading instantly, even on rapid nav
 *  ② isNavigating guard prevents double-render but never blocks show()
 *  ③ popstate has exactly ONE handler (registered in init())
 *  ④ replaceState used for initial navigation; pushState for all others
 *
 * @module router
 * @depends {config.js, state.js, utils.js, loading.js, content.js, buttons.js}
 */
(function (M) {
  'use strict';

  const { CONFIG, State, Utils } = M;

  // ── RouterService ──────────────────────────────────────────────────────────────

  const RouterService = {

    // ── Internal routing state (also exposed for backward compat) ────────────────
    state: {
      isNavigating:       false,
      currentMainRoute:   '',
      currentSubRoute:    '',
      previousUrl:        '',
      lastScrollPosition: 0,
    },

    _initialNavigation: true,

    // ── URL normalization ────────────────────────────────────────────────────────

    /**
     * Normalize any route input into a canonical ?type=...&page=... URL.
     * @param {string|{type:string,page:string}|null} input
     * @returns {string}
     */
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

    /**
     * Parse a URL query string into { main, sub }.
     * @param {string} [q]
     * @returns {ParsedUrl}
     */
    parseUrl(q = window.location.search) {
      if (!q?.startsWith('?')) {
        if (q?.includes('-')) { const [m, s] = q.split('-'); return { main: m || '', sub: s || '' }; }
        return { main: q || '', sub: '' };
      }
      const p = new URLSearchParams(q);
      return { main: (p.get('type') || '').replace(/__$/, ''), sub: p.get('page') || '' };
    },

    /**
     * Validate that a route maps to a known button + (optional) sub-button.
     * @param {string} url
     * @returns {Promise<boolean>}
     */
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
     * Resolve the default route from buttons.json.
     * @returns {Promise<string>}
     */
    async getDefaultRoute() {
      const cfg = State.buttons.config;
      if (!cfg) return '';
      const def  = (cfg.mainButtons || []).find(b => b.isDefault) || cfg.mainButtons?.[0];
      if (!def)  return '';
      const main = def.url || def.jsonFile;
      if (!def.subButtons?.length) return this.normalizeUrl(main);
      const defSub = def.subButtons.find(sb => sb.isDefault) || def.subButtons[0];
      return this.normalizeUrl({ type: main, page: defSub?.url || defSub?.jsonFile });
    },

    // ── History management ────────────────────────────────────────────────────────

    /**
     * Update browser history for the current navigation.
     * Uses replaceState for the initial navigation; pushState afterwards.
     * @param {string|{type:string,page:string}} url
     * @param {boolean} [forcePush=false]
     * @param {{replace?:boolean}} [opts]
     */
    async changeURL(url, forcePush = false, opts = {}) {
      try {
        const normalized = this.normalizeUrl(url);
        if (!normalized) return;

        if ((window.location.search || '') === normalized) {
          this.state.previousUrl = normalized;
          window.dispatchEvent(new CustomEvent('urlChanged', {
            detail: {
              url: normalized,
              mainRoute: this.state.currentMainRoute,
              subRoute:  this.state.currentSubRoute,
            },
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
          detail: {
            url: normalized,
            mainRoute: this.state.currentMainRoute,
            subRoute:  this.state.currentSubRoute,
          },
        }));
      } catch (err) { console.error('[NavCore/Router] changeURL error:', err); }
    },

    // ── Active button state ───────────────────────────────────────────────────────

    /**
     * Sync .active classes to match main + sub route.
     * @param {string} main
     * @param {string} [sub]
     */
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

    // ── navigateTo — main routing entry point ─────────────────────────────────────

    /**
     * Navigate to a route, rendering the appropriate content.
     *
     * ① show() fires BEFORE isNavigating guard — user always sees spinner instantly.
     * ② isNavigating guard prevents double-render but never blocks show().
     *
     * @param {string|{type:string,page:string}} route
     * @param {NavOptions} [options]
     */
    async navigateTo(route, options = {}) {
      // ① Always show loading immediately — before any guard
      try { M.LoadingService?.show(); } catch (_) {}

      // ② Guard: prevent double-render
      if (this.state.isNavigating) return;
      this.state.isNavigating        = true;
      this.state.lastScrollPosition  = window.pageYOffset || 0;

      try {
        // Resolve + validate route
        let normalized = (typeof route === 'object' || route?.startsWith?.('?'))
          ? this.normalizeUrl(route)
          : route;
        if (typeof route === 'string' && route.startsWith('?'))
          normalized = this.normalizeUrl(route);

        let valid = false;
        try { valid = await this.validateUrl(normalized); } catch (_) {}
        if (!valid) normalized = await this.getDefaultRoute();

        const { main, sub } = this.parseUrl(normalized);
        this.state.currentMainRoute = main;
        this.state.currentSubRoute  = sub || '';

        // Sync URL state to shared State
        State.navigation.currentMainRoute = main;
        State.navigation.currentSubRoute  = sub || '';

        this.setActiveButtons(main, sub);

        if (!options.skipUrlUpdate) {
          await this.changeURL(
            { type: main, page: sub },
            !!options.forcePush,
            { replace: !!options.replace }
          );
        }

        const cfg       = State.buttons.config;
        if (!cfg)        throw new Error('[NavCore/Router] buttonConfig not found');
        const mainButton = (cfg.mainButtons || []).find(b => b.url === main || b.jsonFile === main);
        if (!mainButton) throw new Error('[NavCore/Router] mainButton not found for: ' + main);

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
            // Update --clp-top after subnav becomes visible
            try { M.LoadingService?._updateTopVar(); } catch (_) {}
            this.setActiveButtons(main, chosenSub?.url || chosenSub?.jsonFile || sub);
          } catch (e) { console.warn('[NavCore/Router] renderSubButtons failed:', e); }
        } else {
          try { M.SubNavService?.hideSubNav(); } catch (_) {}
          try { M.LoadingService?._updateTopVar(); } catch (_) {}
        }

        try { await M.ContentService.clearContent(); } catch (_) {}

        // Fetch + render content
        const jobs = [];
        if (mainButton.jsonFile)
          jobs.push(M.DataService.fetchWithRetry(mainButton.jsonFile, {}, 2).catch(() => null));
        if (chosenSub?.jsonFile)
          jobs.push(M.DataService.fetchWithRetry(chosenSub.jsonFile, {}, 3).catch(() => null));

        if (jobs.length) {
          const results  = await Promise.all(jobs);
          const combined = results.flatMap(r => Array.isArray(r) ? r : (r ? [r] : []));
          if (combined.length) await M.ContentService.renderContent(combined);
        }

        this.setActiveButtons(main, chosenSub?.url || chosenSub?.jsonFile || sub);

        window.dispatchEvent(new CustomEvent('routeChanged', {
          detail: { main, sub: chosenSub?.url || chosenSub?.jsonFile || sub },
        }));

        if (!options.maintainScroll) {
          try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) {}
        }

      } catch (err) {
        console.error('[NavCore/Router] navigateTo error:', err);
        try { Utils.showNotification('เกิดข้อผิดพลาดในการนำทาง', 'error'); } catch (_) {}
        try { M.LoadingService?.hide(); } catch (_) {}
      } finally {
        this.state.isNavigating = false;
        // Loading hide is called by ContentService after first batch renders
      }
    },

    // ── Initialization ────────────────────────────────────────────────────────────

    /**
     * Attach the popstate handler.
     * Called once from InitService.start().
     * Having exactly one popstate handler here prevents double-navigation.
     */
    init() {
      window.addEventListener('popstate', async () => {
        try {
          try { this.updateActiveFromLocation(); } catch (_) {}
          await this.navigateTo(window.location.search || '', {
            isPopState:    true,
            skipUrlUpdate: true,
          });
        } catch (e) { console.error('[NavCore/Router] popstate error:', e); }
      }, { passive: true });
    },

    markInitialNavigationHandled() {
      this._initialNavigation = false;
    },

    /** @param {string} main @param {string} [sub] */
    activateUiOnly(main, sub) {
      try {
        this.state.currentMainRoute = main;
        this.state.currentSubRoute  = sub || '';
        this.setActiveButtons(main, sub);
      } catch (e) { console.error('[NavCore/Router] activateUiOnly error:', e); }
    },

    /** Scroll active buttons into view in both nav lists. */
    scrollActiveButtonsIntoView() {
      ['nav ul', `#${CONFIG.DOM.SUB_BUTTONS_ID}`].forEach(sel => {
        const c = document.querySelector(sel);
        const a = c?.querySelector('button.active');
        if (!c || !a) return;
        requestAnimationFrame(() => {
          try {
            const cb = c.getBoundingClientRect(), ab = a.getBoundingClientRect();
            c.scrollTo({
              left: Math.max(0, c.scrollLeft + ab.left - cb.left - 20),
              behavior: 'smooth',
            });
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
  };

  // ── NavigationService — backward-compat proxy ─────────────────────────────────
  // External code that still references window._headerV2_navigationManager
  // or M.NavigationService gets the same RouterService methods through this proxy.

  const NavigationService = {
    state: RouterService.state,

    normalizeUrl(u)   { return RouterService.normalizeUrl(u); },
    parseUrl(u)       { return RouterService.parseUrl(u); },
    validateUrl(u)    { return RouterService.validateUrl(u); },
    getDefaultRoute() { return RouterService.getDefaultRoute(); },
    changeURL(u, f)   { return RouterService.changeURL(u, f); },
    navigateTo(r, o)  { return RouterService.navigateTo(r, o); },

    updateButtonStates(url)         { return RouterService.updateButtonStates(url); },
    scrollActiveButtonsIntoView()   { return RouterService.scrollActiveButtonsIntoView(); },
  };

  // ── Export ────────────────────────────────────────────────────────────────────

  M.RouterService     = RouterService;
  M.NavigationService = NavigationService;

})(window.NavCoreModules = window.NavCoreModules || {});