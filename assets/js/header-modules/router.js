// router.js
// Core router / navigation: normalization, history, validation, single-source navigation flow
// This module is designed to be the single authoritative navigation system for header V2.
//
// Updates:
// - Make router the single source of truth for URL/history operations.
// - Router now controls whether to pushState or replaceState during initial automatic navigation
//   to avoid duplicate history entries when the app bootstraps.
// - Exposes clear APIs and internal flagging so other modules can ask router to only update UI
//   without mutating history, or to navigate (and let router decide push vs replace).
// - Maintains backward-compatible public surface to minimize changes elsewhere.

const DEFAULT_STATE = {
  isNavigating: false,
  currentMainRoute: '',
  currentSubRoute: '',
  previousUrl: '',
  lastScrollPosition: 0
};

const router = {
  state: { ...DEFAULT_STATE },

  // internal flag: true until the router performs the first canonical navigation changeURL
  // This ensures initial automatic navigation uses replaceState (not pushState),
  // avoiding duplicate history entries when bootstrapping.
  _initialNavigation: true,

  // Normalize a route into canonical query-string form used by the app
  normalizeUrl(input) {
    if (!input) return '';
    const btnCfg = (window._headerV2_buttonManager && window._headerV2_buttonManager.buttonConfig) || {};
    let main = '', sub = '';
    if (typeof input === 'object') {
      main = (input.type || '').toString();
      sub = (input.page || '').toString();
    } else if (typeof input === 'string') {
      if (input.startsWith('?')) {
        const params = new URLSearchParams(input);
        main = (params.get('type') || '').replace(/__$/, '');
        sub = params.get('page') || '';
      } else if (input.includes('-')) {
        const [m, s] = input.split('-');
        main = m || '';
        sub = s || '';
      } else {
        main = input;
      }
    }

    main = main.toString();
    sub = sub.toString();

    const mainButton = (btnCfg.mainButtons || []).find(b => (b.url === main || b.jsonFile === main));
    const hasSub = !!(mainButton && Array.isArray(mainButton.subButtons) && mainButton.subButtons.length > 0);

    if (hasSub) {
      if (sub) return `?type=${main}__&page=${sub}`;
      return `?type=${main}__`;
    }
    return `?type=${main}`;
  },

  // Parse current window.location.search or a provided query into { main, sub }
  parseUrl(q = window.location.search) {
    if (!q || !q.startsWith('?')) {
      if (q && q.includes('-')) {
        const [m, s] = q.split('-');
        return { main: m || '', sub: s || '' };
      }
      return { main: q || '', sub: '' };
    }
    const params = new URLSearchParams(q);
    const main = (params.get('type') || '').replace(/__$/, '');
    const sub = params.get('page') || '';
    return { main, sub };
  },

  // Validate that a normalized route exists in button config
  async validateUrl(url) {
    try {
      const cfg = (window._headerV2_buttonManager && window._headerV2_buttonManager.buttonConfig);
      if (!cfg) return false;
      const parsed = this.parseUrl(typeof url === 'string' ? url : this.normalizeUrl(url));
      const main = parsed.main;
      const sub = parsed.sub;
      const mainBtn = (cfg.mainButtons || []).find(b => b.url === main || b.jsonFile === main);
      if (!mainBtn) return false;
      if (sub) {
        return !!(mainBtn.subButtons && mainBtn.subButtons.some(sb => sb.url === sub || sb.jsonFile === sub));
      }
      return true;
    } catch (e) {
      return false;
    }
  },

  // Return default route based on button config
  async getDefaultRoute() {
    const cfg = (window._headerV2_buttonManager && window._headerV2_buttonManager.buttonConfig);
    if (!cfg) return '';
    const defaultMain = (cfg.mainButtons || []).find(b => b.isDefault) || cfg.mainButtons[0];
    if (!defaultMain) return '';
    const mainRoute = defaultMain.url || defaultMain.jsonFile;
    if (!defaultMain.subButtons) return this.normalizeUrl(mainRoute);
    const defaultSub = (defaultMain.subButtons || []).find(sb => sb.isDefault) || defaultMain.subButtons[0];
    if (!defaultSub) return this.normalizeUrl(mainRoute);
    const subRoute = defaultSub.url || defaultSub.jsonFile;
    return this.normalizeUrl({ type: mainRoute, page: subRoute });
  },

  // Change browser URL + history state (canonical)
  // Options:
  //  - forcePush (boolean): when true force pushState even during initial navigation
  //  - replace (boolean): explicit replaceState (overrides initial navigation preference)
  async changeURL(url, forcePush = false, opts = {}) {
    try {
      if (!url) return;
      const normalized = this.normalizeUrl(url);
      if (!normalized) return;

      // If location already equals normalized, no history change needed.
      const currentSearch = window.location.search || '';
      if (currentSearch === normalized) {
        // Still update internal previousUrl, dispatch event for consistency
        this.state.previousUrl = normalized;
        window.dispatchEvent(new CustomEvent('urlChanged', {
          detail: { url: normalized, mainRoute: this.state.currentMainRoute, subRoute: this.state.currentSubRoute }
        }));
        // Mark that initial navigation has been handled (if it was)
        this._initialNavigation = false;
        return;
      }

      // Determine replace vs push:
      // - If caller explicitly asks for replace -> use replaceState
      // - Else if this is still initial navigation and caller did not forcePush -> replaceState
      // - Otherwise pushState
      let useReplace = false;
      if (opts.replace === true) useReplace = true;
      else if (this._initialNavigation && !forcePush) useReplace = true;
      else useReplace = false;

      if (useReplace) {
        try {
          window.history.replaceState({ url: normalized, scrollPosition: this.state.lastScrollPosition }, '', normalized);
        } catch (e) {
          // fallback to push if replaceState fails
          try { window.history.pushState({ url: normalized, scrollPosition: this.state.lastScrollPosition }, '', normalized); } catch (e2) {}
        }
      } else {
        try {
          window.history.pushState({ url: normalized, scrollPosition: this.state.lastScrollPosition }, '', normalized);
        } catch (e) {
          // fallback to replace if pushState fails
          try { window.history.replaceState({ url: normalized, scrollPosition: this.state.lastScrollPosition }, '', normalized); } catch (e2) {}
        }
      }

      this._initialNavigation = false;
      this.state.previousUrl = normalized;
      window.dispatchEvent(new CustomEvent('urlChanged', {
        detail: { url: normalized, mainRoute: this.state.currentMainRoute, subRoute: this.state.currentSubRoute }
      }));
    } catch (err) {
      console.error('router.changeURL error', err);
      try { window._headerV2_utils && window._headerV2_utils.showNotification('เปลี่ยน URL ไม่สำเร็จ', 'error'); } catch {}
    }
  },

  // Synchronously set active classes for nav and subnav based on main/sub
  setActiveButtons(main, sub) {
    try {
      const navList = window._headerV2_elements && window._headerV2_elements.navList;
      const subContainer = window._headerV2_elements && window._headerV2_elements.subButtonsContainer;

      // Main buttons
      if (navList) {
        const buttons = navList.querySelectorAll('button');
        let foundMain = null;
        buttons.forEach(btn => {
          const isActive = btn.getAttribute('data-url') === main;
          btn.classList.toggle('active', isActive);
          if (isActive) foundMain = btn;
        });
        // update manager state
        try {
          if (window._headerV2_buttonManager) {
            window._headerV2_buttonManager.state.currentMainButton = foundMain;
            window._headerV2_buttonManager.state.currentMainButtonUrl = main;
          }
        } catch (e) {}
      }

      // Sub buttons
      if (subContainer) {
        const buttons = subContainer.querySelectorAll('button');
        let foundSub = null;
        const target = `${main}-${sub}`;
        buttons.forEach(btn => {
          const isActive = btn.getAttribute('data-url') === target;
          btn.classList.toggle('active', isActive);
          if (isActive) foundSub = btn;
        });
        try {
          if (window._headerV2_buttonManager) {
            window._headerV2_buttonManager.state.currentSubButton = foundSub;
          }
        } catch (e) {}
      }
    } catch (err) {
      // tolerant: don't throw
      console.error('router.setActiveButtons error', err);
    }
  },

  // Update active buttons according to current location (synchronous)
  updateActiveFromLocation() {
    try {
      const { main, sub } = this.parseUrl(window.location.search);
      this.setActiveButtons(main, sub);
    } catch (e) {}
  },

  // Core navigateTo: single place to implement navigation flow used by the whole app.
  // Options:
  //  - skipUrlUpdate: if true, do not push/replace history (only update UI & load content)
  //  - isPopState: if true, navigation triggered by popstate (back/forward)
  //  - maintainScroll: keep current scroll (default false -> scroll to top)
  //  - forcePush: force pushState even if this looks like initial navigation
  //  - replace: explicitly perform replaceState
  async navigateTo(route, options = {}) {
    if (this.state.isNavigating) return;
    this.state.isNavigating = true;
    this.state.lastScrollPosition = window.pageYOffset || 0;

    try {
      // determine canonical route string
      let normalizedRoute = (typeof route === 'object' || (typeof route === 'string' && route.startsWith('?'))) ? this.normalizeUrl(route) : route;
      if (typeof route === 'string' && route.startsWith('?')) normalizedRoute = this.normalizeUrl(route);
      // ensure route valid else fallback to default
      let isValid = false;
      try { isValid = await this.validateUrl(normalizedRoute); } catch {}
      if (!isValid) {
        normalizedRoute = await this.getDefaultRoute();
      }

      // parse main/sub
      const { main, sub } = this.parseUrl(normalizedRoute);

      // Update internal state early and set active buttons synchronously (so UI reflects URL immediately)
      this.state.currentMainRoute = main;
      this.state.currentSubRoute = sub || '';
      this.setActiveButtons(main, sub);

      const lang = localStorage.getItem('selectedLang') || 'en';

      // update history (unless skip)
      if (!options.skipUrlUpdate) {
        // Decide replace vs push:
        // - If caller explicitly set replace, honor it
        // - Else let changeURL decide (it will replace when router._initialNavigation is true)
        await this.changeURL({ type: main, page: sub }, !!options.forcePush, { replace: !!options.replace });
      }

      // find button config
      const cfg = (window._headerV2_buttonManager && window._headerV2_buttonManager.buttonConfig);
      if (!cfg) throw new Error('buttonConfig not found for navigation');

      const mainButton = (cfg.mainButtons || []).find(b => b.url === main || b.jsonFile === main);
      if (!mainButton) throw new Error('mainButton not found');

      // show global overlay while navigating
      try { window._headerV2_contentLoadingManager && window._headerV2_contentLoadingManager.show(); } catch {}

      // If has sub buttons, pick sub or default and ensure subnav is rendered
      const hasSubButtons = mainButton.subButtons && mainButton.subButtons.length > 0;
      let chosenSubButton = null;
      if (hasSubButtons) {
        chosenSubButton = mainButton.subButtons.find(sb => sb.url === sub || sb.jsonFile === sub) || mainButton.subButtons.find(sb => sb.isDefault) || mainButton.subButtons[0];
        try {
          // render sub buttons (this function is expected to be fast)
          await window._headerV2_buttonManager.renderSubButtons(mainButton.subButtons, main, lang);
          window._headerV2_subNavManager && window._headerV2_subNavManager.showSubNav();
          // set active for chosen sub (again, to ensure correctness)
          this.setActiveButtons(main, chosenSubButton ? (chosenSubButton.url || chosenSubButton.jsonFile) : sub);
        } catch (e) {
          console.warn('render sub buttons failed', e);
        }
      } else {
        try { window._headerV2_subNavManager && window._headerV2_subNavManager.hideSubNav(); } catch {}
      }

      // Clear existing content and load required json(s)
      try {
        await window._headerV2_contentManager.clearContent();
      } catch (e) {}

      // Load JSONs (main and/or sub) in parallel if both present
      const jobs = [];
      if (mainButton.jsonFile) jobs.push(window._headerV2_dataManager.fetchWithRetry(mainButton.jsonFile, {}, 2).catch(()=>null));
      if (chosenSubButton && chosenSubButton.jsonFile) jobs.push(window._headerV2_dataManager.fetchWithRetry(chosenSubButton.jsonFile, {}, 3).catch(()=>null));

      if (jobs.length === 2) {
        try {
          const [mainResult, subResult] = await Promise.all(jobs);
          if (Array.isArray(mainResult) && Array.isArray(subResult)) {
            await window._headerV2_contentManager.renderContent([...mainResult, ...subResult]);
          } else if (Array.isArray(mainResult)) {
            await window._headerV2_contentManager.renderContent(mainResult);
          } else if (Array.isArray(subResult)) {
            await window._headerV2_contentManager.renderContent(subResult);
          } else if (mainResult && Array.isArray([mainResult])) {
            await window._headerV2_contentManager.renderContent([mainResult]);
          }
        } catch (e) {
          console.warn('parallel load main/sub failed', e);
        }
      } else if (jobs.length === 1) {
        try {
          const res = await jobs[0];
          if (res) {
            if (Array.isArray(res)) await window._headerV2_contentManager.renderContent(res);
            else await window._headerV2_contentManager.renderContent([res]);
          }
        } catch (e) {
          console.warn('load single content failed', e);
        }
      } else {
        // nothing to load
      }

      // After load: ensure DOM active states one more time for consistency
      this.setActiveButtons(main, chosenSubButton ? (chosenSubButton.url || chosenSubButton.jsonFile) : sub);

      // Dispatch routeChanged event for listeners
      window.dispatchEvent(new CustomEvent('routeChanged', { detail: { main, sub: chosenSubButton ? (chosenSubButton.url || chosenSubButton.jsonFile) : sub } }));

      // scroll to top unless asked to maintain
      if (!options.maintainScroll) {
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
      }

    } catch (err) {
      console.error('router.navigateTo error', err);
      try { window._headerV2_utils && window._headerV2_utils.showNotification('เกิดข้อผิดพลาดในการนำทาง', 'error'); } catch {}
      try { window._headerV2_contentLoadingManager && window._headerV2_contentLoadingManager.hide(); } catch {}
    } finally {
      try { window._headerV2_contentLoadingManager && window._headerV2_contentLoadingManager.hide(); } catch {}
      this.state.isNavigating = false;
    }
  },

  // Initialize router: setup popstate handling
  init() {
    try {
      // popstate -> update active synchronously and navigate (load content)
      window.addEventListener('popstate', async (ev) => {
        try {
          // immediate sync active update from location (fast)
          try { this.updateActiveFromLocation(); } catch (e) {}
          const url = window.location.search || '';
          // call navigateTo for loading content, but skip pushing history (it's a popstate)
          await this.navigateTo(url, { isPopState: true, skipUrlUpdate: true });
        } catch (e) {
          console.error('router popstate handler failed', e);
        }
      }, { passive: true });

      // listen to urlChanged for internal syncing if needed
      window.addEventListener('urlChanged', (ev) => {
        // Allow other systems to react to url changes if necessary
      }, { passive: true });
    } catch (e) {
      console.error('router.init error', e);
    }
  },

  // Utility: allow other modules to request activation of UI without touching history.
  // e.g., buttonManager can call router.activateUiOnly('main', 'sub') during initial rendering.
  activateUiOnly(main, sub) {
    try {
      this.state.currentMainRoute = main;
      this.state.currentSubRoute = sub || '';
      this.setActiveButtons(main, sub);
    } catch (e) {
      console.error('router.activateUiOnly error', e);
    }
  },

  // Utility: mark the router that initial automatic navigation has already been handled externally.
  // Useful if some bootstrap behavior has already done an initial replaceState.
  markInitialNavigationHandled() {
    this._initialNavigation = false;
  }
};

export default router;