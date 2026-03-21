// @ts-check
/**
 * @file buttons.js
 * SubNavService  — ensures #sub-nav and #sub-buttons-container exist in the DOM.
 * ButtonService  — renders and manages main-nav + sub-nav buttons.
 *
 * Consolidated from managers.js (buttonManager + subNavManager).
 * SubNavService is a dependency of ButtonService, so they live in the same file.
 *
 * Rendering optimizations:
 *   • buildFragment() → all buttons created inside DocumentFragment → single DOM write
 *
 * @module buttons
 * @depends {config.js, state.js, utils.js, loading.js, content.js}
 */
(function (M) {
  'use strict';

  const { CONFIG, State, Utils } = M;

  // ── SubNavService ──────────────────────────────────────────────────────────────

  /**
   * Ensures the sub-nav DOM structure exists and exposes show/hide/clear helpers.
   * Accessing SubNavService from ButtonService is done via M.SubNavService.
   */
  const SubNavService = {

    /**
     * Ensure #sub-nav → .hj → #sub-buttons-container structure exists.
     * Idempotent — safe to call multiple times.
     * @returns {HTMLElement} the #sub-buttons-container element
     */
    ensureSubNavContainer() {
      let sn = document.getElementById(CONFIG.DOM.SUB_NAV_ID);
      if (!sn) {
        sn            = document.createElement('div');
        sn.id         = CONFIG.DOM.SUB_NAV_ID;
        sn.className  = 'hi';
        const h = document.querySelector(CONFIG.DOM.HEADER_TAG);
        if (h?.nextSibling) h.parentNode.insertBefore(sn, h.nextSibling);
        else document.body.prepend(sn);
      }

      let hj = sn.querySelector(`.${CONFIG.DOM.SUB_NAV_CLASS}`);
      if (!hj) {
        hj           = document.createElement('div');
        hj.className = CONFIG.DOM.SUB_NAV_CLASS;
        sn.appendChild(hj);
      }

      // Move any externally-placed #sub-buttons-container inside .hj
      const ext = document.querySelector(`#${CONFIG.DOM.SUB_BUTTONS_ID}`);
      if (ext && !hj.contains(ext)) try { hj.appendChild(ext); } catch (_) {}

      let sbc = hj.querySelector(`#${CONFIG.DOM.SUB_BUTTONS_ID}`);
      if (!sbc) {
        document.querySelectorAll(`#${CONFIG.DOM.SUB_BUTTONS_ID}`).forEach(el => {
          if (!sn.contains(el)) try { el.parentNode?.removeChild(el); } catch (_) {}
        });
        sbc    = document.createElement('div');
        sbc.id = CONFIG.DOM.SUB_BUTTONS_ID;
        hj.appendChild(sbc);
      }

      // Sync element cache
      State.elements.subNav              = sn;
      State.elements.subNavInner         = hj;
      State.elements.subButtonsContainer = sbc;

      return sbc;
    },

    hideSubNav() {
      const sn = document.getElementById(CONFIG.DOM.SUB_NAV_ID);
      if (!sn) return;
      sn.style.display = 'none';
      const c = sn.querySelector(`#${CONFIG.DOM.SUB_BUTTONS_ID}`);
      if (c) c.innerHTML = '';
      if (State.elements.subButtonsContainer)
        State.elements.subButtonsContainer.innerHTML = '';
    },

    showSubNav() {
      let sn = document.getElementById(CONFIG.DOM.SUB_NAV_ID);
      if (!sn) { this.ensureSubNavContainer(); sn = document.getElementById(CONFIG.DOM.SUB_NAV_ID); }
      if (sn) sn.style.display = '';
    },

    clearSubButtons() { this.ensureSubNavContainer().innerHTML = ''; },
  };

  // ── ButtonService ──────────────────────────────────────────────────────────────

  const ButtonService = {

    // ── Config + state loading ──────────────────────────────────────────────────

    /**
     * Load buttons.json and render main navigation buttons.
     * Idempotent — uses DataService cache on repeat calls.
     * @returns {Promise<void>}
     */
    async loadConfig() {
      if (State.buttons.config) { await this.renderMainButtons(); return; }

      const cached = M.DataService.getCached('buttonConfig');
      if (cached) { State.buttons.config = cached; await this.renderMainButtons(); return; }

      const res = await M.DataService.fetchWithRetry(
        CONFIG.PATHS.BUTTONS_CONFIG, {}, 2
      );
      State.buttons.config = res;
      M.DataService.setCache('buttonConfig', res);
      await this.renderMainButtons();

      try { M.RouterService?.updateButtonStates?.(); } catch (_) {}
    },

    // ── Main button rendering ───────────────────────────────────────────────────

    /**
     * Render all main navigation buttons into #nav-list.
     * Uses DocumentFragment — single DOM write.
     */
    async renderMainButtons() {
      const lang                = localStorage.getItem('selectedLang') || 'en';
      const { mainButtons }     = State.buttons.config;
      const navList             = State.elements.navList;
      navList.innerHTML         = '';
      State.buttons.buttonMap   = new Map();
      let def                   = null;

      const frag = document.createDocumentFragment();

      for (const cfg of mainButtons) {
        const label = cfg[`${lang}_label`];
        if (!label) continue;

        const li  = document.createElement('li');
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.className   = 'main-button';
        const url = cfg.url || cfg.jsonFile;
        btn.setAttribute('data-url', url);
        if (cfg.className) btn.classList.add(cfg.className);

        State.buttons.buttonMap.set(url, { button: btn, config: cfg });
        if (cfg.isDefault) def = { button: btn, config: cfg };

        btn.addEventListener('click', async ev => {
          ev.preventDefault();
          navList.querySelectorAll('button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          State.buttons.currentMainButton    = btn;
          State.buttons.currentMainButtonUrl = url;
          await M.RouterService.navigateTo(url, {
            skipUrlUpdate: !!State.isBootstrapping,
          });
        }); // non-passive: needs preventDefault

        li.appendChild(btn);
        frag.appendChild(li);
      }

      navList.appendChild(frag); // single DOM write

      if (!State.isBootstrapping) {
        await this._handleInitialUrl(window.location.search, def);
      } else if (def?.button) {
        def.button.classList.add('active');
        State.buttons.currentMainButton    = def.button;
        State.buttons.currentMainButtonUrl = def.config?.url || def.config?.jsonFile;
      }
    },

    // ── Initial URL handling ────────────────────────────────────────────────────

    async _handleInitialUrl(url, def) {
      try {
        if (!url || url === '?') { if (def) await this.triggerMainButtonClick(def.button); return; }

        const p    = new URLSearchParams(url.startsWith('?') ? url : `?${url}`);
        const main = (p.get('type') || '').replace(/__$/, '');
        const sub  = p.get('page') || '';
        const md   = State.buttons.buttonMap.get(main);
        if (!md) { if (def) await this.triggerMainButtonClick(def.button); return; }

        const valid = await M.RouterService.validateUrl(url).catch(() => false);
        if (!valid) { if (def) await this.triggerMainButtonClick(def.button); return; }

        M.RouterService.state.currentMainRoute = main;
        M.RouterService.state.currentSubRoute  = sub || '';
        State.buttons.currentMainButton        = md.button;
        await this._activateMain(md.button, md.config);

        if (md.config.subButtons?.length) {
          if (sub) await this._handleInitialSub(md.config, main, sub);
          else     await this._handleDefaultSub(md.config, main);
          SubNavService.showSubNav();
        } else {
          SubNavService.hideSubNav();
        }

        M.RouterService.scrollActiveButtonsIntoView?.();
      } catch (_) { if (def) await this.triggerMainButtonClick(def.button); }
    },

    async _activateMain(btn, cfg) {
      State.elements.navList.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.buttons.currentMainButton = btn;
      await M.ContentService.clearContent();

      const lang = localStorage.getItem('selectedLang') || 'en';
      if (cfg.subButtons?.length) {
        SubNavService.showSubNav();
        await this.renderSubButtons(cfg.subButtons, cfg.url || cfg.jsonFile, lang);
      } else {
        SubNavService.hideSubNav();
      }

      if (cfg.jsonFile)
        await M.ContentService.renderContent([{ jsonFile: cfg.jsonFile }]);
    },

    async _handleInitialSub(cfg, main, sub) {
      await new Promise(r => setTimeout(r, 60));
      if (!cfg.subButtons?.length) { SubNavService.hideSubNav(); return; }
      SubNavService.showSubNav();

      const lang = localStorage.getItem('selectedLang') || 'en';
      await this.renderSubButtons(cfg.subButtons, main, lang);

      const fullUrl = `${main}-${sub}`;
      const el      = State.elements.subButtonsContainer?.querySelector(`button[data-url="${fullUrl}"]`);
      const scf     = cfg.subButtons.find(b => b.url === sub || b.jsonFile === sub);

      if (el && scf) {
        State.elements.subButtonsContainer?.querySelectorAll('.button-sub')
          .forEach(b => b.classList.remove('active'));
        el.classList.add('active');
        State.buttons.currentSubButton = el;
        if (scf.jsonFile) {
          await M.ContentService.clearContent();
          await M.ContentService.renderContent([{ jsonFile: scf.jsonFile }]);
        }
        this._scrollSub(el);
      }
    },

    async _handleDefaultSub(cfg, main) {
      if (!cfg.subButtons?.length) { SubNavService.hideSubNav(); return; }
      SubNavService.showSubNav();
      const d = cfg.subButtons.find(b => b.isDefault);
      if (d) {
        await M.RouterService.navigateTo(
          `${main}-${d.url || d.jsonFile}`,
          { skipUrlUpdate: !!State.isBootstrapping }
        );
      }
    },

    // ── Click triggers ──────────────────────────────────────────────────────────

    async triggerMainButtonClick(btn) {
      if (!btn) return;
      const url = btn.getAttribute('data-url');
      State.elements.navList.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.buttons.currentMainButton    = btn;
      State.buttons.currentMainButtonUrl = url;
      try {
        await M.RouterService.navigateTo(url, { skipUrlUpdate: !!State.isBootstrapping });
      } catch (e) { console.error('[NavCore/Buttons] triggerMainButtonClick', e); }
    },

    async triggerSubButtonClick(btn) {
      if (!btn) return;
      State.elements.subButtonsContainer?.querySelectorAll('button')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.buttons.currentSubButton = btn;
      const url = btn.getAttribute('data-url');
      try {
        await M.RouterService.navigateTo(url, { skipUrlUpdate: !!State.isBootstrapping });
      } catch (e) { console.error('[NavCore/Buttons] triggerSubButtonClick', e); }
    },

    // ── Sub-button rendering ────────────────────────────────────────────────────

    /**
     * Render sub-navigation buttons into #sub-buttons-container.
     * Uses DocumentFragment — single DOM write.
     * @param {SubButtonConfig[]} subBtns
     * @param {string}            mainUrl
     * @param {string}            lang
     */
    async renderSubButtons(subBtns, mainUrl, lang) {
      if (!subBtns?.length) { SubNavService.hideSubNav(); return; }
      SubNavService.showSubNav();

      const ctr = SubNavService.ensureSubNavContainer();
      ctr.innerHTML = '';

      const p = new URLSearchParams(
        window.location.search.startsWith('?') ? window.location.search : `?${window.location.search}`
      );
      const curMain   = (p.get('type') || '').replace(/__$/, '');
      const curSub    = p.get('page') || '';
      const activeUrl = curMain && curSub ? `${curMain}-${curSub}` : '';

      let defBtn = null;
      const frag = document.createDocumentFragment();

      subBtns.forEach(cfg => {
        const label = cfg[`${lang}_label`];
        if (!label) return;

        const btn    = document.createElement('button');
        btn.className = 'button-sub sub-button';
        if (cfg.className) btn.classList.add(cfg.className);
        btn.textContent = label;

        const fullUrl = `${mainUrl}-${cfg.url || cfg.jsonFile}`;
        btn.setAttribute('data-url', fullUrl);
        if (cfg.isDefault) defBtn = btn;
        if (fullUrl === activeUrl) btn.classList.add('active');

        btn.addEventListener('click', async () => {
          ctr.querySelectorAll('.button-sub').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          State.buttons.currentSubButton = btn;
          await M.RouterService.navigateTo(fullUrl, {
            skipUrlUpdate: !!State.isBootstrapping,
          });
        }, { passive: true });

        frag.appendChild(btn);
      });

      ctr.appendChild(frag); // single DOM write

      const needDef = !activeUrl || !ctr.querySelector('.button-sub.active');
      if (needDef && defBtn)
        setTimeout(() => { try { this.triggerSubButtonClick(defBtn); } catch (_) {} }, 0);
    },

    // ── Utilities ───────────────────────────────────────────────────────────────

    /** @param {string} url @returns {MainButtonConfig|undefined} */
    findMainButtonConfig(url) {
      return State.buttons.config?.mainButtons?.find(b => b.url === url || b.jsonFile === url);
    },

    /** @param {HTMLElement} btn */
    _scrollSub(btn) {
      const ctr = State.elements?.subButtonsContainer;
      if (!ctr || !btn) return;
      requestAnimationFrame(() => {
        try {
          const cl = ctr.getBoundingClientRect().left;
          const bl = btn.getBoundingClientRect().left;
          const t  = ctr.scrollLeft + (bl - cl) - 20;
          if (Math.abs(ctr.scrollLeft - t) > 1) ctr.scrollTo({ left: t, behavior: 'smooth' });
        } catch (_) {}
      });
    },

    /** Update button text labels after language change. */
    updateButtonsLanguage(lang) {
      try {
        const { mainButtons } = State.buttons.config;
        State.elements.navList.querySelectorAll('button').forEach((b, i) => {
          const l = mainButtons[i]?.[`${lang}_label`];
          if (l) b.textContent = l;
        });
        if (State.buttons.currentMainButton) {
          const cfg = this.findMainButtonConfig(State.buttons.currentMainButton.getAttribute('data-url'));
          if (cfg?.subButtons?.length) {
            SubNavService.showSubNav();
            this.renderSubButtons(cfg.subButtons, cfg.url || cfg.jsonFile, lang);
          } else {
            SubNavService.hideSubNav();
          }
        } else {
          SubNavService.hideSubNav();
        }
      } catch (_) {}
    },

    /** @param {HTMLElement} btn @param {boolean} isSub */
    updateButtonState(btn, isSub) {
      const g = isSub
        ? State.elements.subButtonsContainer
        : State.elements.navList;
      g?.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (isSub) { State.buttons.currentSubButton = btn; this._scrollSub(btn); }
      else         State.buttons.currentMainButton = btn;
    },

    // Backward-compat aliases
    activateMainButton(btn, cfg)        { return this._activateMain(btn, cfg); },
    handleInitialUrl(url, map, def)     { return this._handleInitialUrl(url, def); },
    handleInitialSubRoute(cfg, m, s)    { return this._handleInitialSub(cfg, m, s); },
    handleDefaultSubButton(cfg, m)      { return this._handleDefaultSub(cfg, m); },
    scrollActiveSubButtonIntoView(btn)  { return this._scrollSub(btn); },
  };

  // ── Export ────────────────────────────────────────────────────────────────────

  M.SubNavService = SubNavService;
  M.ButtonService = ButtonService;

})(window.NavCoreModules = window.NavCoreModules || {});