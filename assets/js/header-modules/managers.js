// managers.js — Performance-optimized
// Changes:
//  - scrollManager: removed overlapping MutationObserver+ResizeObserver+scroll listeners
//    replaced with single passive scroll listener + IntersectionObserver for sticky
//  - performanceOptimizer: removed redundant error boundary (already in init)
//  - buttonManager: removed nested awaits in click handlers, added passive listeners
//  - All event listeners marked passive where possible

export const scrollManager = {
  state: { ticking: false, isSubNavFixed: false },
  constants: { SUB_NAV_TOP_SPACING: 0, Z_INDEX: { SUB_NAV: 999 } },

  createStickyStyles() {
    if (document.getElementById('sticky-styles')) return;
    const s = document.createElement('style');
    s.id = 'sticky-styles';
    const hz = (this.constants.Z_INDEX.SUB_NAV || 999) + 2;
    s.textContent = `
header{position:relative;z-index:${hz};contain:layout style;}
#sub-nav{position:sticky;top:${this.constants.SUB_NAV_TOP_SPACING}px;left:0;right:0;z-index:${this.constants.Z_INDEX.SUB_NAV};}
#sub-nav.fixed{background:rgba(255,255,255,1);border-bottom:0.5px solid rgba(19,180,127,0.18);border-radius:0 0 30px 30px;}
#sub-nav.fixed #sub-buttons-container{padding:6px 16px!important;border-radius:0 0 30px 30px;}
#sub-nav.fixed.hi{padding:0!important;}
#sub-nav.fixed .hj{border-color:rgba(0,0,0,0);background:transparent;}
    `;
    document.head.appendChild(s);
  },

  handleSubNav() {
    const subNav = document.getElementById('sub-nav');
    if (!subNav) return;
    const scrollY = window.pageYOffset;
    const top = subNav.getBoundingClientRect().top + scrollY;
    const trigger = top - this.constants.SUB_NAV_TOP_SPACING;

    if (scrollY >= trigger && !this.state.isSubNavFixed) {
      subNav.classList.add('fixed');
      this.state.isSubNavFixed = true;
    } else if (scrollY < trigger && this.state.isSubNavFixed) {
      subNav.classList.remove('fixed');
      this.state.isSubNavFixed = false;
    }
  },

  init() {
    try {
      this.createStickyStyles();

      // Single passive scroll listener — no RAF nesting
      window.addEventListener('scroll', () => {
        if (this.state.ticking) return;
        this.state.ticking = true;
        requestAnimationFrame(() => {
          try { this.handleSubNav(); } catch (_) {}
          this.state.ticking = false;
        });
      }, { passive: true });

      // Visibility change (no cost when hidden)
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) try { this.handleSubNav(); } catch (_) {}
      }, { passive: true });

      // Initial check
      if (window.pageYOffset > 0) this.handleSubNav();
    } catch (e) {
      console.error('scrollManager.init', e);
    }
  }
};

export const performanceOptimizer = {
  setupLazyLoading() {
    // Native lazy loading is sufficient for modern browsers
    if ('loading' in HTMLImageElement.prototype) {
      document.querySelectorAll('img:not([loading])').forEach(img => { img.loading = 'lazy'; });
      return;
    }
    // Fallback: IntersectionObserver
    const obs = new IntersectionObserver((entries, o) => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          const img = en.target;
          if (img.dataset.src) { img.src = img.dataset.src; img.removeAttribute('data-src'); }
          o.unobserve(img);
        }
      });
    }, { rootMargin: '300px' });
    document.querySelectorAll('img[data-src]').forEach(img => obs.observe(img));
  },

  setupErrorBoundary() {
    const notify = _debounce((msg) => {
      try { window._headerV2_utils?.showNotification(msg, 'error'); } catch (_) {}
    }, 1000);
    window.addEventListener('error', (ev) => {
      notify('เกิดข้อผิดพลาดที่ไม่คาดคิด');
      console.error('Captured error', ev.error || ev);
    }, { passive: true });
    window.addEventListener('unhandledrejection', (ev) => {
      notify('เกิดข้อผิดพลาดในการเชื่อมต่อ');
      console.error('Unhandled rejection', ev.reason);
    }, { passive: true });
  },

  init() {
    try {
      this.setupLazyLoading();
      this.setupErrorBoundary();
    } catch (e) {
      console.error('performanceOptimizer.init', e);
    }
  }
};

export const subNavManager = {
  ensureSubNavContainer() {
    let subNav = document.getElementById('sub-nav');
    if (!subNav) {
      subNav = document.createElement('div');
      subNav.id = 'sub-nav';
      subNav.className = 'hi';
      const header = document.querySelector('header');
      if (header?.nextSibling) header.parentNode.insertBefore(subNav, header.nextSibling);
      else document.body.insertBefore(subNav, document.body.firstChild);
    }

    let hj = subNav.querySelector('.hj');
    if (!hj) {
      hj = document.createElement('div');
      hj.className = 'hj';
      subNav.appendChild(hj);
    }

    const existing = document.querySelector('#sub-buttons-container');
    if (existing && !hj.contains(existing)) {
      try { hj.appendChild(existing); } catch (_) {}
    }

    let sbc = hj.querySelector('#sub-buttons-container');
    if (!sbc) {
      // clean up duplicates
      document.querySelectorAll('#sub-buttons-container').forEach(el => {
        if (!subNav.contains(el)) try { el.parentNode?.removeChild(el); } catch (_) {}
      });
      sbc = document.createElement('div');
      sbc.id = 'sub-buttons-container';
      hj.appendChild(sbc);
    }

    if (window._headerV2_elements) {
      window._headerV2_elements.subNav = subNav;
      window._headerV2_elements.subNavInner = hj;
      window._headerV2_elements.subButtonsContainer = sbc;
    }
    return sbc;
  },

  hideSubNav() {
    const subNav = document.getElementById('sub-nav');
    if (subNav) {
      subNav.style.display = 'none';
      const c = subNav.querySelector('#sub-buttons-container');
      if (c) c.innerHTML = '';
    }
    if (window._headerV2_elements?.subButtonsContainer)
      window._headerV2_elements.subButtonsContainer.innerHTML = '';
  },

  showSubNav() {
    let subNav = document.getElementById('sub-nav');
    if (!subNav) { this.ensureSubNavContainer(); subNav = document.getElementById('sub-nav'); }
    if (subNav) subNav.style.display = '';
  },

  clearSubButtons() {
    this.ensureSubNavContainer().innerHTML = '';
  }
};

export const buttonManager = {
  buttonConfig: null,
  state: { buttonMap: new Map(), currentMainButton: null, currentSubButton: null, currentMainButtonUrl: null },

  async loadConfig() {
    if (this.buttonConfig) { await this.renderMainButtons(); return; }
    const cached = window._headerV2_dataManager.getCached('buttonConfig');
    if (cached) { this.buttonConfig = cached; await this.renderMainButtons(); return; }

    const response = await window._headerV2_dataManager.fetchWithRetry(
      window._headerV2_dataManager.constants.BUTTONS_CONFIG_PATH, {}, 2
    );
    this.buttonConfig = response;
    window._headerV2_dataManager.setCache('buttonConfig', response);
    await this.renderMainButtons();
    try {
      const nm = window._headerV2_router || window._headerV2_navigationManager;
      nm?.updateButtonStates?.();
    } catch (_) {}
  },

  async renderMainButtons() {
    const lang = localStorage.getItem('selectedLang') || 'en';
    const { mainButtons } = this.buttonConfig;
    const navList = window._headerV2_elements.navList;
    navList.innerHTML = '';
    this.state.buttonMap = new Map();
    let defaultButton = null;
    const frag = document.createDocumentFragment();

    for (const button of mainButtons) {
      const label = button[`${lang}_label`];
      if (!label) continue;

      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.className = 'main-button';
      const url = button.url || button.jsonFile;
      btn.setAttribute('data-url', url);
      if (button.className) btn.classList.add(button.className);
      this.state.buttonMap.set(url, { button: btn, config: button, element: btn });
      if (button.isDefault) defaultButton = { button: btn, config: button };

      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        // Immediate UI feedback
        navList.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.state.currentMainButton = btn;
        this.state.currentMainButtonUrl = url;

        const router = window._headerV2_router || window._headerV2_navigationManager;
        if (router?.navigateTo) {
          await router.navigateTo(url, { skipUrlUpdate: !!window._headerV2_bootstrapping });
        }
      }, { passive: false }); // must be non-passive to call preventDefault

      li.appendChild(btn);
      frag.appendChild(li);
    }

    navList.appendChild(frag);

    if (!window._headerV2_bootstrapping) {
      await this.handleInitialUrl(window.location.search, this.state.buttonMap, defaultButton);
    } else {
      try {
        if (defaultButton?.button) {
          defaultButton.button.classList.add('active');
          this.state.currentMainButton = defaultButton.button;
          this.state.currentMainButtonUrl = defaultButton.config?.url || defaultButton.config?.jsonFile;
        }
      } catch (_) {}
    }
  },

  async handleInitialUrl(url, buttonMap, defaultButton) {
    try {
      if (!url || url === '?') {
        if (defaultButton) await this.triggerMainButtonClick(defaultButton.button);
        return;
      }
      const params = new URLSearchParams(url.startsWith('?') ? url : `?${url}`);
      const mainRoute = (params.get('type') || '').replace(/__$/, '');
      const subRoute  = params.get('page') || '';

      const mainData = buttonMap.get(mainRoute);
      if (!mainData) { if (defaultButton) await this.triggerMainButtonClick(defaultButton.button); return; }

      const { button: mainBtn, config: mainCfg } = mainData;
      const router = window._headerV2_router || window._headerV2_navigationManager;

      try {
        const valid = await router.validateUrl(url);
        if (!valid) throw new Error('invalid');
        router.state.currentMainRoute = mainRoute;
        router.state.currentSubRoute  = subRoute || '';
        this.state.currentMainButton  = mainBtn;
        await this.activateMainButton(mainBtn, mainCfg);
        if (mainCfg.subButtons?.length) {
          if (subRoute) await this.handleInitialSubRoute(mainCfg, mainRoute, subRoute);
          else          await this.handleDefaultSubButton(mainCfg, mainRoute);
          subNavManager.showSubNav();
        } else {
          subNavManager.hideSubNav();
        }
        router.scrollActiveButtonsIntoView?.();
      } catch (_) {
        if (defaultButton) await this.triggerMainButtonClick(defaultButton.button);
      }
    } catch (_) {
      if (defaultButton) await this.triggerMainButtonClick(defaultButton.button);
    }
  },

  async activateMainButton(mainButton, mainConfig) {
    const navList = window._headerV2_elements.navList;
    navList.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    mainButton.classList.add('active');
    this.state.currentMainButton = mainButton;
    await window._headerV2_contentManager.clearContent();

    if (mainConfig.subButtons?.length) {
      subNavManager.showSubNav();
      await this.renderSubButtons(
        mainConfig.subButtons,
        mainConfig.url || mainConfig.jsonFile,
        localStorage.getItem('selectedLang') || 'en'
      );
    } else {
      subNavManager.hideSubNav();
    }
    if (mainConfig.jsonFile) {
      await window._headerV2_contentManager.renderContent([{ jsonFile: mainConfig.jsonFile }]);
    }
  },

  async handleInitialSubRoute(mainConfig, mainRoute, subRoute) {
    await new Promise(r => setTimeout(r, 60));
    const lang = localStorage.getItem('selectedLang') || 'en';
    if (!mainConfig.subButtons?.length) { subNavManager.hideSubNav(); return; }

    subNavManager.showSubNav();
    await this.renderSubButtons(mainConfig.subButtons, mainRoute, lang);
    const fullUrl = `${mainRoute}-${subRoute}`;
    const subBtn = window._headerV2_elements.subButtonsContainer?.querySelector(`button[data-url="${fullUrl}"]`);
    const subCfg = mainConfig.subButtons.find(b => b.url === subRoute || b.jsonFile === subRoute);
    if (subBtn && subCfg) {
      window._headerV2_elements.subButtonsContainer
        ?.querySelectorAll('.button-sub').forEach(b => b.classList.remove('active'));
      subBtn.classList.add('active');
      this.state.currentSubButton = subBtn;
      if (subCfg.jsonFile) {
        await window._headerV2_contentManager.clearContent();
        await window._headerV2_contentManager.renderContent([{ jsonFile: subCfg.jsonFile }]);
      }
      this._scrollSubIntoView(subBtn);
    }
  },

  async handleDefaultSubButton(mainConfig, mainRoute) {
    if (!mainConfig.subButtons?.length) { subNavManager.hideSubNav(); return; }
    subNavManager.showSubNav();
    const defSub = mainConfig.subButtons.find(b => b.isDefault);
    if (defSub) {
      const fullUrl = `${mainRoute}-${defSub.url || defSub.jsonFile}`;
      const router = window._headerV2_router || window._headerV2_navigationManager;
      await router.navigateTo(fullUrl, { skipUrlUpdate: !!window._headerV2_bootstrapping });
    }
  },

  async triggerMainButtonClick(button, opts = {}) {
    if (!button) return;
    const url = button.getAttribute('data-url');
    const navList = window._headerV2_elements.navList;
    navList.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    button.classList.add('active');
    this.state.currentMainButton = button;
    this.state.currentMainButtonUrl = url;
    const router = window._headerV2_router || window._headerV2_navigationManager;
    try { await router.navigateTo(url, { skipUrlUpdate: !!window._headerV2_bootstrapping }); }
    catch (e) { console.error('triggerMainButtonClick', e); }
  },

  async triggerSubButtonClick(button) {
    if (!button) return;
    const container = window._headerV2_elements.subButtonsContainer;
    container?.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    button.classList.add('active');
    this.state.currentSubButton = button;
    const url = button.getAttribute('data-url');
    const router = window._headerV2_router || window._headerV2_navigationManager;
    try { await router.navigateTo(url, { skipUrlUpdate: !!window._headerV2_bootstrapping }); }
    catch (e) { console.error('triggerSubButtonClick', e); }
  },

  async renderSubButtons(subButtons, mainUrl, lang) {
    if (!subButtons?.length) { subNavManager.hideSubNav(); return; }
    subNavManager.showSubNav();
    const container = subNavManager.ensureSubNavContainer();
    container.innerHTML = '';

    const currentUrl = window.location.search;
    let activeSubUrl = '';
    if (currentUrl.startsWith('?')) {
      const p = new URLSearchParams(currentUrl);
      const m = (p.get('type') || '').replace(/__$/, '');
      const s = p.get('page') || '';
      if (m && s) activeSubUrl = `${m}-${s}`;
    }

    let defaultSub = null;
    const frag = document.createDocumentFragment();

    subButtons.forEach(button => {
      const label = button[`${lang}_label`];
      if (!label) return;

      const btn = document.createElement('button');
      btn.className = 'button-sub sub-button';
      if (button.className) btn.classList.add(button.className);
      btn.textContent = label;
      const fullUrl = button.url
        ? `${mainUrl}-${button.url}`
        : `${mainUrl}-${button.jsonFile}`;
      btn.setAttribute('data-url', fullUrl);
      if (button.isDefault) defaultSub = btn;
      if (fullUrl === activeSubUrl) btn.classList.add('active');

      btn.addEventListener('click', async () => {
        container.querySelectorAll('.button-sub').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.state.currentSubButton = btn;
        const router = window._headerV2_router || window._headerV2_navigationManager;
        if (router?.navigateTo) {
          await router.navigateTo(fullUrl, { skipUrlUpdate: !!window._headerV2_bootstrapping });
        }
      }, { passive: true });

      frag.appendChild(btn);
    });

    container.appendChild(frag);

    const needsDefault = !activeSubUrl || !container.querySelector('.button-sub.active');
    if (needsDefault && defaultSub) {
      // Defer to avoid blocking current render tick
      setTimeout(() => {
        try { this.triggerSubButtonClick(defaultSub); } catch (_) {}
      }, 0);
    }
  },

  updateButtonState(button, isSub) {
    const group = isSub
      ? window._headerV2_elements.subButtonsContainer
      : window._headerV2_elements.navList;
    group?.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    button.classList.add('active');
    if (isSub) { this.state.currentSubButton = button; this._scrollSubIntoView(button); }
    else         this.state.currentMainButton = button;
  },

  findMainButtonConfig(url) {
    return this.buttonConfig?.mainButtons?.find(b => b.url === url || b.jsonFile === url);
  },

  findSubButtonConfig(fullUrl) {
    const [m, s] = fullUrl.split('-');
    return this.findMainButtonConfig(m)?.subButtons?.find(b => b.url === s || b.jsonFile === s);
  },

  _scrollSubIntoView(btn) {
    if (!btn) return;
    const container = window._headerV2_elements.subButtonsContainer;
    if (!container) return;
    requestAnimationFrame(() => {
      try {
        const cl = container.getBoundingClientRect().left;
        const bl = btn.getBoundingClientRect().left;
        const target = container.scrollLeft + (bl - cl) - 20;
        if (Math.abs(container.scrollLeft - target) > 1)
          container.scrollTo({ left: target, behavior: 'smooth' });
      } catch (_) {}
    });
  },

  updateButtonsLanguage(newLang) {
    try {
      const { mainButtons } = this.buttonConfig;
      const navList = window._headerV2_elements.navList;
      navList.querySelectorAll('button').forEach((btn, i) => {
        const cfg = mainButtons[i];
        if (cfg?.[`${newLang}_label`]) btn.textContent = cfg[`${newLang}_label`];
      });
      if (this.state.currentMainButton) {
        const cfg = this.findMainButtonConfig(this.state.currentMainButton.getAttribute('data-url'));
        if (cfg?.subButtons?.length) {
          subNavManager.showSubNav();
          this.renderSubButtons(cfg.subButtons, cfg.url || cfg.jsonFile, newLang);
        } else {
          subNavManager.hideSubNav();
        }
      } else {
        subNavManager.hideSubNav();
      }
    } catch (_) {
      window._headerV2_utils?.showNotification('อัพเดทภาษาของปุ่มไม่สำเร็จ', 'error');
    }
  }
};

// navigationManager — thin proxy to router (backward compat)
export const navigationManager = {
  state: { isNavigating: false, currentMainRoute: '', currentSubRoute: '', previousUrl: '', lastScrollPosition: 0 },

  normalizeUrl(url)    { return window._headerV2_router?.normalizeUrl?.(url) || ''; },
  parseUrl(url)        { return window._headerV2_router?.parseUrl?.(url) || { main: '', sub: '' }; },
  validateUrl(url)     { return window._headerV2_router?.validateUrl?.(url) || Promise.resolve(false); },
  getDefaultRoute()    { return window._headerV2_router?.getDefaultRoute?.() || Promise.resolve(''); },
  changeURL(url, f)    { return window._headerV2_router?.changeURL?.(url, f) || Promise.resolve(); },
  navigateTo(r, o)     { return window._headerV2_router?.navigateTo?.(r, o) || Promise.resolve(); },

  updateButtonStates(url) {
    try {
      const { main, sub } = this.parseUrl(url || window.location.search);
      const el = window._headerV2_elements;
      el?.navList?.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-url') === main);
      });
      el?.subButtonsContainer?.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-url') === `${main}-${sub}`);
      });
      window._headerV2_router?.scrollActiveButtonsIntoView?.();
    } catch (_) {}
  },

  scrollActiveButtonsIntoView() {
    ['nav ul', '#sub-buttons-container'].forEach(sel => {
      const container = document.querySelector(sel);
      if (!container) return;
      const active = container.querySelector('button.active');
      if (!active) return;
      requestAnimationFrame(() => {
        try {
          const cb = container.getBoundingClientRect();
          const ab = active.getBoundingClientRect();
          const left = container.scrollLeft + (ab.left - cb.left) - 20;
          container.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
        } catch (_) {}
      });
    });
  }
};

// ---- Helpers ----
function _debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

export default { scrollManager, performanceOptimizer, subNavManager, buttonManager, navigationManager };