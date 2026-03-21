// @ts-check
/**
 * @file router.js
 * RouterService + NavigationService
 * (patched: navigateTo guard hides loading, safety timeout, auto-recovery)
 */
(function (M) {
  'use strict';

  const { CONFIG, State, Utils } = M;

  const RouterService = {

    state: {
      isNavigating:       false,
      currentMainRoute:   '',
      currentSubRoute:    '',
      previousUrl:        '',
      lastScrollPosition: 0,
    },

    _initialNavigation: true,
    _safetyTimer: null,

    // ── URL normalization ────────────────────────────────────────────────────────

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

    // ── changeURL ────────────────────────────────────────────────────────────────

    async changeURL(url, forcePush = false, opts = {}) {
      try {
        const normalized = this.normalizeUrl(url);
        if (!normalized) return;

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

    // ── Active button state ───────────────────────────────────────────────────────

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

    // ── navigateTo ───────────────────────────────────────────────────────────────
    // BUG FIX 1: guard "if (isNavigating) return" ทำให้ loading overlay ที่ show ไปแล้วไม่ถูก hide
    //            → เปลี่ยนเป็น queue ด้วย waitUntil + safety timeout
    // BUG FIX 2: เพิ่ม safety timeout 20s force-reset ป้องกัน isNavigating ค้าง

    async navigateTo(route, options = {}) {
      // แสดง loading ทันที — ก่อน guard ทุกอย่าง
      try { M.LoadingService?.show(); } catch (_) {}

      // ── Guard: isNavigating อยู่ → รอให้จบก่อน (ไม่ return ทิ้ง) ──────────────
      if (this.state.isNavigating) {
        try {
          await this._waitUntilFree(10000);
        } catch (_) {
          // timeout → force reset แล้วดำเนินการต่อ
          console.warn('[NavCore/Router] isNavigating timeout — forcing reset');
          this.state.isNavigating = false;
        }
      }

      this.state.isNavigating       = true;
      this.state.lastScrollPosition = window.pageYOffset || 0;

      // Safety timeout: ถ้า navigation ใช้เวลานาน 20s → force reset
      if (this._safetyTimer) clearTimeout(this._safetyTimer);
      this._safetyTimer = setTimeout(() => {
        if (this.state.isNavigating) {
          console.warn('[NavCore/Router] Navigation safety timeout (20s) — forcing reset');
          this.state.isNavigating = false;
          try { M.LoadingService?.hide(); } catch (_) {}
          this._safetyTimer = null;
        }
      }, 20000);

      try {
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

        const cfg = State.buttons.config;
        if (!cfg) throw new Error('[NavCore/Router] buttonConfig not found');

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
            try { M.LoadingService?._updateTopVar(); } catch (_) {}
            this.setActiveButtons(main, chosenSub?.url || chosenSub?.jsonFile || sub);
          } catch (e) { console.warn('[NavCore/Router] renderSubButtons failed:', e); }
        } else {
          try { M.SubNavService?.hideSubNav(); } catch (_) {}
          try { M.LoadingService?._updateTopVar(); } catch (_) {}
        }

        try { await M.ContentService.clearContent(); } catch (_) {}

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
        // ✅ isNavigating ต้อง reset เสมอ ไม่ว่าจะ success หรือ error
        this.state.isNavigating = false;
        if (this._safetyTimer) { clearTimeout(this._safetyTimer); this._safetyTimer = null; }
      }
    },

    // ── _waitUntilFree: รอให้ isNavigating = false ────────────────────────────────

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

    // ── Initialization ────────────────────────────────────────────────────────────

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
  };

  // ── NavigationService — backward-compat proxy ─────────────────────────────────

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

})(window.NavCoreModules = window.NavCoreModules || {});