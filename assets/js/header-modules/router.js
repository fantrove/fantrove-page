// router.js — v3
// ─────────────────────────────────────────────────────────
// v3 changes:
//  ① show() เรียกทุกครั้งก่อน isNavigating guard
//     → ผู้ใช้เห็น loading ทันทีแม้ navigate ซ้อน
//  ② isNavigating guard ยังคงป้องกัน double render
//     แต่ไม่ block show() อีกต่อไป
//  ③ ลบ double-popstate handler ออก (init.js มีแล้ว)
//     router.init() จัดการ popstate เพียงที่เดียว
// ─────────────────────────────────────────────────────────

const DEFAULT_STATE = {
  isNavigating: false,
  currentMainRoute: '',
  currentSubRoute: '',
  previousUrl: '',
  lastScrollPosition: 0
};

const router = {
  state: { ...DEFAULT_STATE },
  _initialNavigation: true,

  normalizeUrl(input) {
    if (!input) return '';
    const btnCfg = window._headerV2_buttonManager?.buttonConfig || {};
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
      if (q?.includes('-')) { const [m,s]=q.split('-'); return {main:m||'',sub:s||''}; }
      return { main: q || '', sub: '' };
    }
    const p = new URLSearchParams(q);
    return { main: (p.get('type')||'').replace(/__$/,''), sub: p.get('page')||'' };
  },

  async validateUrl(url) {
    try {
      const cfg = window._headerV2_buttonManager?.buttonConfig;
      if (!cfg) return false;
      const { main, sub } = this.parseUrl(typeof url === 'string' ? url : this.normalizeUrl(url));
      const mainBtn = (cfg.mainButtons||[]).find(b => b.url===main||b.jsonFile===main);
      if (!mainBtn) return false;
      if (sub) return !!(mainBtn.subButtons?.some(sb => sb.url===sub||sb.jsonFile===sub));
      return true;
    } catch(_) { return false; }
  },

  async getDefaultRoute() {
    const cfg = window._headerV2_buttonManager?.buttonConfig;
    if (!cfg) return '';
    const def = (cfg.mainButtons||[]).find(b=>b.isDefault) || cfg.mainButtons?.[0];
    if (!def) return '';
    const main = def.url || def.jsonFile;
    if (!def.subButtons?.length) return this.normalizeUrl(main);
    const defSub = def.subButtons.find(sb=>sb.isDefault) || def.subButtons[0];
    return this.normalizeUrl({ type: main, page: defSub?.url || defSub?.jsonFile });
  },

  async changeURL(url, forcePush = false, opts = {}) {
    try {
      const normalized = this.normalizeUrl(url);
      if (!normalized) return;
      if ((window.location.search||'') === normalized) {
        this.state.previousUrl = normalized;
        window.dispatchEvent(new CustomEvent('urlChanged', {
          detail: { url: normalized, mainRoute: this.state.currentMainRoute, subRoute: this.state.currentSubRoute }
        }));
        this._initialNavigation = false;
        return;
      }
      const useReplace = opts.replace === true || (this._initialNavigation && !forcePush);
      const method = useReplace ? 'replaceState' : 'pushState';
      try {
        window.history[method]({ url: normalized, scrollPosition: this.state.lastScrollPosition }, '', normalized);
      } catch(_) {
        const fallback = useReplace ? 'pushState' : 'replaceState';
        try { window.history[fallback]({ url: normalized }, '', normalized); } catch(__) {}
      }
      this._initialNavigation = false;
      this.state.previousUrl = normalized;
      window.dispatchEvent(new CustomEvent('urlChanged', {
        detail: { url: normalized, mainRoute: this.state.currentMainRoute, subRoute: this.state.currentSubRoute }
      }));
    } catch(err) { console.error('router.changeURL', err); }
  },

  setActiveButtons(main, sub) {
    try {
      const navList  = window._headerV2_elements?.navList;
      const subCtr   = window._headerV2_elements?.subButtonsContainer;
      if (navList) {
        let found = null;
        navList.querySelectorAll('button').forEach(btn => {
          const active = btn.getAttribute('data-url') === main;
          btn.classList.toggle('active', active);
          if (active) found = btn;
        });
        if (window._headerV2_buttonManager) {
          window._headerV2_buttonManager.state.currentMainButton    = found;
          window._headerV2_buttonManager.state.currentMainButtonUrl = main;
        }
      }
      if (subCtr) {
        const target = `${main}-${sub}`;
        let found = null;
        subCtr.querySelectorAll('button').forEach(btn => {
          const active = btn.getAttribute('data-url') === target;
          btn.classList.toggle('active', active);
          if (active) found = btn;
        });
        if (window._headerV2_buttonManager) window._headerV2_buttonManager.state.currentSubButton = found;
      }
    } catch(err) { console.error('router.setActiveButtons', err); }
  },

  updateActiveFromLocation() {
    try { const {main,sub}=this.parseUrl(window.location.search); this.setActiveButtons(main,sub); } catch(_){}
  },

  // ── navigateTo ────────────────────────────────────────
  async navigateTo(route, options = {}) {
    // ① Show loading BEFORE isNavigating guard — ทุกกรณีไม่มียกเว้น
    try { window._headerV2_contentLoadingManager?.show(); } catch(_) {}

    // ② Guard: ป้องกัน double render แต่ไม่ block show()
    if (this.state.isNavigating) return;
    this.state.isNavigating = true;
    this.state.lastScrollPosition = window.pageYOffset || 0;

    try {
      // Resolve + validate route
      let normalized = (typeof route === 'object' || route?.startsWith?.('?'))
        ? this.normalizeUrl(route) : route;
      if (typeof route === 'string' && route.startsWith('?')) normalized = this.normalizeUrl(route);

      let valid = false;
      try { valid = await this.validateUrl(normalized); } catch(_) {}
      if (!valid) normalized = await this.getDefaultRoute();

      const { main, sub } = this.parseUrl(normalized);
      this.state.currentMainRoute = main;
      this.state.currentSubRoute  = sub || '';
      this.setActiveButtons(main, sub);

      if (!options.skipUrlUpdate) {
        await this.changeURL({ type: main, page: sub }, !!options.forcePush, { replace: !!options.replace });
      }

      const cfg = window._headerV2_buttonManager?.buttonConfig;
      if (!cfg) throw new Error('buttonConfig not found');
      const mainButton = (cfg.mainButtons||[]).find(b => b.url===main||b.jsonFile===main);
      if (!mainButton) throw new Error('mainButton not found');

      const lang = localStorage.getItem('selectedLang') || 'en';
      const hasSubButtons = mainButton.subButtons?.length > 0;
      let chosenSub = null;

      if (hasSubButtons) {
        chosenSub =
          mainButton.subButtons.find(sb => sb.url===sub||sb.jsonFile===sub) ||
          mainButton.subButtons.find(sb => sb.isDefault) ||
          mainButton.subButtons[0];
        try {
          await window._headerV2_buttonManager.renderSubButtons(mainButton.subButtons, main, lang);
          window._headerV2_subNavManager?.showSubNav();
          // ④ อัพเดท --clp-top หลัง subnav แสดง
          try { window._headerV2_contentLoadingManager?._updateTopVar(); } catch(_) {}
          this.setActiveButtons(main, chosenSub?.url || chosenSub?.jsonFile || sub);
        } catch(e) { console.warn('render sub buttons', e); }
      } else {
        try { window._headerV2_subNavManager?.hideSubNav(); } catch(_) {}
        try { window._headerV2_contentLoadingManager?._updateTopVar(); } catch(_) {}
      }

      try { await window._headerV2_contentManager.clearContent(); } catch(_) {}

      // Fetch + render
      const jobs = [];
      if (mainButton.jsonFile)
        jobs.push(window._headerV2_dataManager.fetchWithRetry(mainButton.jsonFile, {}, 2).catch(()=>null));
      if (chosenSub?.jsonFile)
        jobs.push(window._headerV2_dataManager.fetchWithRetry(chosenSub.jsonFile, {}, 3).catch(()=>null));

      if (jobs.length) {
        const results = await Promise.all(jobs);
        const combined = results.flatMap(r => Array.isArray(r) ? r : (r ? [r] : []));
        if (combined.length) await window._headerV2_contentManager.renderContent(combined);
      }

      this.setActiveButtons(main, chosenSub?.url || chosenSub?.jsonFile || sub);
      window.dispatchEvent(new CustomEvent('routeChanged', {
        detail: { main, sub: chosenSub?.url || chosenSub?.jsonFile || sub }
      }));

      if (!options.maintainScroll) {
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch(_) {}
      }

    } catch(err) {
      console.error('router.navigateTo', err);
      try { window._headerV2_utils?.showNotification('เกิดข้อผิดพลาดในการนำทาง', 'error'); } catch(_) {}
      // hide loading on error
      try { window._headerV2_contentLoadingManager?.hide(); } catch(_) {}
    } finally {
      this.state.isNavigating = false;
      // loading hide ถูกเรียกโดย contentManager หลัง batch แรก
    }
  },

  init() {
    // ③ popstate — single handler ที่นี่เท่านั้น
    window.addEventListener('popstate', async () => {
      try {
        try { this.updateActiveFromLocation(); } catch(_) {}
        await this.navigateTo(window.location.search || '', { isPopState: true, skipUrlUpdate: true });
      } catch(e) { console.error('router popstate', e); }
    }, { passive: true });
  },

  activateUiOnly(main, sub) {
    try {
      this.state.currentMainRoute = main;
      this.state.currentSubRoute  = sub || '';
      this.setActiveButtons(main, sub);
    } catch(e) { console.error('router.activateUiOnly', e); }
  },

  markInitialNavigationHandled() {
    this._initialNavigation = false;
  },

  // backward compat
  scrollActiveButtonsIntoView() {
    ['nav ul', '#sub-buttons-container'].forEach(sel => {
      const c = document.querySelector(sel);
      const a = c?.querySelector('button.active');
      if (!c || !a) return;
      requestAnimationFrame(() => {
        try {
          const cb = c.getBoundingClientRect(), ab = a.getBoundingClientRect();
          c.scrollTo({ left: Math.max(0, c.scrollLeft + ab.left - cb.left - 20), behavior: 'smooth' });
        } catch(_) {}
      });
    });
  }
};

export default router;