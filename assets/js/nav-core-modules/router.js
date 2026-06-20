// @ts-check
/**
 * @file router.js
 * RouterService + NavigationService
 *
 * v2 — "All" system button:
 *   • getDefaultRoute() คืน _all เสมอ ไม่ใช้ isDefault จาก config แล้ว
 *   • navigateTo(): main === _all → M.ContentService.renderFeed(lang)
 *     renderFeed จัดการ clearContent + infinite scroll ภายในตัวเอง
 *     ดังนั้นจึงข้าม clearContent ภายนอกสำหรับ route นี้
 *
 * v3 — "Latest-wins" navigation:
 *   • แก้ไข bug: คลิกรัวๆ ทำให้ loading overlay ติดค้าง
 *   • ใช้ _navGen (generation counter) — เฉพาะ navigation ล่าสุดเท่านั้น
 *     ที่จะทำ cleanup (hide overlay, restore nav)
 *   • ลบ _waitUntilFree — ไม่ต่อคิวแล้ว คลิกใหม่ = รีเสร็จทั้งหมดทันที
 *   • เรียก LoadingService._forceReset() ก่อน show() เสมอ
 *     เพื่อรีเซ็ต session counter และลบ overlay เดิมทิ้ง
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
    /** @type {number} Navigation generation — แต่ละครั้งที่ navigateTo เริ่มจะบวก 1
     *  finally block จะตรวจว่า gen ตรงกับ _navGen ปัจจุบันหรือไม่
     *  ถ้าไม่ตรง = navigation นี้ถูกแทนที่แล้ว ไม่ต้องทำ cleanup */
    _navGen: 0,

    // ── URL normalization ──────────────────────────────────────────────────────

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

    // ── changeURL ──────────────────────────────────────────────────────────────

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

    // ── Active button state ────────────────────────────────────────────────────

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

    // ── navigateTo ─────────────────────────────────────────────────────────────

    async navigateTo(route, options = {}) {
      // ── v3: Reset loading state ทันทีทุกครั้งที่เริ่ม navigation ใหม่ ──────
      // WHY: ถ้าผู้ใช้คลิกรัวๆ session counter จะสะสม ทำให้ overlay ไม่ซ่อน
      //   _forceReset() จะรีเซ็ต counter เป็น 0 และลบ overlay เดิมทิ้งทันที
      //   ทำให้ navigation ใหม่เริ่มต้นด้วยสถานะสะอาดเสมอ
      try { M.LoadingService?._forceReset(); } catch (_) {}

      // ── Smart loading: enable fvl-nav-mode + nav-loading state ──────────────
      // WHY fvl-nav-mode: tells FVL CSS to leave room for bottom nav so the
      //   spinner is centered in the visible area, not the full viewport.
      // WHY nav-loading: fades out the main nav buttons + sub-nav buttons so
      //   the user can't click another category mid-fetch, and gets a clear
      //   visual signal that "we're switching". Restored in finally block.
      this._setNavLoading(true);

      // ── Show loading overlay (เริ่ม session ใหม่ หลัง reset แล้ว) ────────
      try { M.LoadingService?.show(); } catch (_) {}

      // ── v4: Guarantee overlay paint before mutating content ──────────
      // WHY: LoadingService.show() ใช้ instant=true ซึ่ง set fvl-shown
      //   (opacity: 1) ทันที แต่ browser ยังไม่ได้ paint. ถ้าเราเริ่ม
      //   clearContent/fetch ใน microtask เดียวกัน browser จะ paint
      //   overlay และ content change พร้อมกัน → ผู้ใช้เห็น jank
      //   รอ 1 rAF จะทำให้ browser paint overlay ก่อน แล้วค่อยเปลี่ยน
      //   content ใน frame ถัดไป → ผู้ใช้เห็น loading เนียน ไม่กระตุก
      await new Promise(function (r) { requestAnimationFrame(r); });

      // ── Navigation generation: เฉพาะ navigation ล่าสุดที่จะทำ cleanup ──
      // WHY: เมื่อคลิกรัวๆ navigation เก่าๆ จะถูกแทนที่ ไม่ต้อง hide overlay
      //   เพราะ navigation ใหม่จะเป็นคนจัดการเอง
      this._navGen++;
      const myGen = this._navGen;

      // ไม่ต่อคิวแล้ว — คลิกใหม่ = บังคับเริ่ม navigation ใหม่ทันที
      this.state.isNavigating       = true;
      this.state.lastScrollPosition = window.pageYOffset || 0;

      if (this._safetyTimer) clearTimeout(this._safetyTimer);
      this._safetyTimer = setTimeout(() => {
        // ตรวจ myGen ด้วย — ถ้ามี navigation ใหม่แล้ว ไม่ต้อง reset
        if (this.state.isNavigating && this._navGen === myGen) {
          console.warn('[NavCore/Router] Navigation safety timeout (20s) — forcing reset');
          this.state.isNavigating = false;
          try {
            M.LoadingService._forceReset();
            this._setNavLoading(false);
          } catch (_) {}
          this._safetyTimer = null;
        }
      }, 20000);

      try {
        let normalized = (typeof route === 'object' || route?.startsWith?.('?'))
          ? this.normalizeUrl(route)
          : route;
        if (typeof route === 'string' && route.startsWith('?'))
          normalized = this.normalizeUrl(route);

        // ── Superseded check: ถ้ามี navigation ใหม่มาแล้ว หยุดทันที ───────
        if (myGen !== this._navGen) return;

        let valid = false;
        try { valid = await this.validateUrl(normalized); } catch (_) {}
        if (!valid) normalized = await this.getDefaultRoute();

        if (myGen !== this._navGen) return;

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

        if (myGen !== this._navGen) return;

        const cfg = State.buttons.config;
        if (!cfg) throw new Error('[NavCore/Router] buttonConfig not found');

        const mainButton = (cfg.mainButtons || []).find(b => b.url === main || b.jsonFile === main);
        if (!mainButton) throw new Error('[NavCore/Router] mainButton not found for: ' + main);

        // ── Smart loading message: use the active language label of the button ──
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

        // ── Content rendering ──────────────────────────────────────────────────
        // WHY: All feed route ข้าม clearContent ภายนอก
        //      เพราะ renderFeed() จัดการ clearContent + FeedService.reset() ภายในตัวเอง
        //      route อื่นทุก route ยังคง clearContent ปกติ

        if (main === CONFIG.ALL_BUTTON.URL) {
          // ── Smart infinite feed ───────────────────────────────────────────
          try {
            await M.ContentService.renderFeed(lang);
          } catch (feedErr) {
            console.error('[NavCore/Router] renderFeed error:', feedErr);
          }
        } else {
          // ── Normal content rendering ──────────────────────────────────────
          try { await M.ContentService.clearContent(); } catch (_) {}

          const jobs = [];
          if (mainButton.jsonFile)
            jobs.push(M.DataService.fetchWithRetry(mainButton.jsonFile, {}, 2).catch(() => null));
          if (chosenSub?.jsonFile)
            jobs.push(M.DataService.fetchWithRetry(chosenSub.jsonFile, {}, 3).catch(() => null));

          if (jobs.length) {
            const results  = await Promise.all(jobs);
            if (myGen !== this._navGen) return;
            const combined = results.flatMap(r => Array.isArray(r) ? r : (r ? [r] : []));
            if (combined.length) await M.ContentService.renderContent(combined);
          }
        }

        if (myGen !== this._navGen) return;

        this.setActiveButtons(main, chosenSub?.url || chosenSub?.jsonFile || sub);

        window.dispatchEvent(new CustomEvent('routeChanged', {
          detail: { main, sub: chosenSub?.url || chosenSub?.jsonFile || sub },
        }));

        if (!options.maintainScroll) {
          try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) {}
        }

      } catch (err) {
        // เฉพาะ navigation ล่าสุดเท่านั้นที่แสดง error
        if (myGen === this._navGen) {
          console.error('[NavCore/Router] navigateTo error:', err);
          try { Utils.showErrorFullscreen(err, { label: 'Navigation' }); } catch (_) {}
        }
      } finally {
        // ── v3: เฉพาะ navigation ล่าสุดเท่านั้นที่ทำ cleanup ─────────────────
        // WHY: navigation เก่าๆ ที่ถูกแทนที่ ไม่ต้องทำอะไรเลย
        //   content.js จัดการ hideInstant() เองแล้วหลัง render เสร็จ
        //   ถ้า finally มา hide อีกรอบ → counter ผิดเพี้ยน
        if (myGen === this._navGen) {
          this.state.isNavigating = false;
          if (this._safetyTimer) { clearTimeout(this._safetyTimer); this._safetyTimer = null; }
          // v3: ไม่เรียก hide() ที่นี่แล้ว — content.js จัดการเอง
          //   ยกเว้นกรณี content.js ไม่ถูกเรียก (เช่น error ก่อนถึง render)
          //   ในกรณีนั้น safety timer (20s) จะจัดการแทน
          try {
            requestAnimationFrame(() => {
              this._setNavLoading(false);
            });
          } catch (_) {}
        }
      }
    },

    /**
     * Toggle the "nav-loading" state.
     * Adds/removes the body class AND sets opacity directly via JS for
     * browsers that don't honor `!important` opacity on `nav` elements
     * (observed in some Chromium versions).
     *
     * @param {boolean} isLoading
     */
    _setNavLoading(isLoading) {
      try {
        if (isLoading) {
          document.body.classList.add('fvl-nav-mode', 'nav-loading');
        } else {
          document.body.classList.remove('nav-loading');
          // Keep fvl-nav-mode — it's a persistent page-mode class
        }

        // Direct style application (more reliable than CSS rules in some browsers)
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

    // ── _waitUntilFree ─────────────────────────────────────────────────────────

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

})(window.NavCoreModules = window.NavCoreModules || {});