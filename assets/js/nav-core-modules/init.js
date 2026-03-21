// @ts-check
/**
 * @file init.js
 * InitService — bootstrap orchestrator for NavCore.
 *
 * Responsibilities:
 *  1. Ensure required DOM elements exist (create if missing)
 *  2. Cache DOM refs into State.elements
 *  3. Show loading overlay early
 *  4. Setup ScrollService + PerformanceService
 *  5. Register network status listeners
 *  6. Load button config
 *  7. Init RouterService (registers single popstate handler)
 *  8. Kick off DataService._warmup()
 *  9. Perform initial navigation
 *  10. Expose window globals (new _navCore_* names + backward-compat _headerV2_* aliases)
 *
 * Called by nav-core.js after all modules have loaded.
 *
 * @module init
 * @depends {config.js, state.js, utils.js, data.js, loading.js, content.js,
 *           performance.js, buttons.js, router.js, copy.js}
 */
(function (M) {
  'use strict';

  const {
    CONFIG, State, Utils,
    DataService, LoadingService, ContentService,
    ScrollService, PerformanceService,
    SubNavService, ButtonService,
    RouterService, NavigationService,
    CopyService,
  } = M;

  // ── InitService ───────────────────────────────────────────────────────────────

  const InitService = {

    /**
     * Bootstrap entry point — called once from nav-core.js _boot().
     * @returns {Promise<void>}
     */
    async start() {
      // Signal that bootstrap is in progress
      State.isBootstrapping = true;
      window._navCore_bootstrapping = true;

      // Expose LoadingService early so it's available before full init completes
      try {
        if (!window._navCore_contentLoadingManager)
          window._navCore_contentLoadingManager = LoadingService;
      } catch (_) {}

      // ── Phase 1: Synchronous bindings ────────────────────────────────────────
      this._exposeGlobals();

      // ── Phase 2: Ensure DOM structure ─────────────────────────────────────────
      this._ensureElements();
      this._cacheElements();

      // ── Phase 3: Show loading overlay early ──────────────────────────────────
      try { LoadingService.show(); } catch (_) {}

      // ── Phase 4: Core service setup ───────────────────────────────────────────
      try {
        PerformanceService.setupErrorBoundary();
        ScrollService.init();
        PerformanceService.init();

        // Network status
        window.addEventListener('online', () => {
          Utils.showNotification('การเชื่อมต่อกลับมาแล้ว', 'success');
          ButtonService.loadConfig().catch(() => {});
        }, { passive: true });

        window.addEventListener('offline', () => {
          Utils.showNotification('ขาดการเชื่อมต่ออินเทอร์เน็ต', 'warning');
        }, { passive: true });

        // Language changes
        window.addEventListener('languageChange', ev => {
          const newLang = ev.detail?.language || 'en';
          try { ButtonService.updateButtonsLanguage?.(newLang); }  catch (_) {}
          try { ContentService.updateCardsLanguage?.(newLang); }   catch (_) {}
        }, { passive: true });

        // Resize with debounce
        let _resizeTimer;
        window.addEventListener('resize', () => {
          clearTimeout(_resizeTimer);
          _resizeTimer = setTimeout(() => {
            try { RouterService.scrollActiveButtonsIntoView?.(); } catch (_) {}
          }, 150);
        }, { passive: true });

        // ── Phase 5: Load button config ─────────────────────────────────────────
        try {
          await ButtonService.loadConfig();
        } catch (e) {
          Utils.showNotification('โหลดข้อมูลปุ่มไม่สำเร็จ', 'error');
          console.error('[NavCore/Init] loadConfig error:', e);
        }

        // ── Phase 6: Init router (registers popstate handler) ──────────────────
        try {
          RouterService.init();
        } catch (e) { console.error('[NavCore/Init] RouterService.init error:', e); }

        // ── Phase 7: Warmup data (prefetch in idle time) ───────────────────────
        try {
          DataService._warmup().catch(() => {});
        } catch (_) {}

        // ── Phase 8: Initial navigation ─────────────────────────────────────────
        try {
          const url = window.location.search;
          if (!url || url === '?') {
            const defaultRoute = await RouterService.getDefaultRoute();
            await RouterService.navigateTo(defaultRoute, { skipUrlUpdate: false, replace: false });
          } else {
            await RouterService.navigateTo(url, { skipUrlUpdate: false, replace: false });
          }

          State.isBootstrapping                      = false;
          window._navCore_bootstrapping              = false;
          window._headerV2_bootstrapping             = false; // backward compat

          RouterService.markInitialNavigationHandled?.();
        } catch (e) {
          Utils.showNotification('เกิดข้อผิดพลาดในการนำทางเริ่มต้น', 'error');
          console.error('[NavCore/Init] initial navigation error:', e);
          State.isBootstrapping         = false;
          window._navCore_bootstrapping = false;
          window._headerV2_bootstrapping = false;
        }

      } catch (error) {
        console.error('[NavCore/Init] bootstrap error:', error);
        try { Utils.showNotification('เกิดข้อผิดพลาดในการโหลดแอพพลิเคชัน กรุณารีเฟรชหน้า', 'error'); } catch (_) {}
      } finally {
        // Always remove loading overlay when done (success or error)
        try {
          if (typeof window.__removeInstantLoadingOverlay === 'function'
            && window.__instantLoadingOverlayShown) {
            window.__removeInstantLoadingOverlay();
            window.__instantLoadingOverlayShown = false;
          }
        } catch (_) {}

        State.isBootstrapping         = false;
        window._navCore_bootstrapping = false;
        window._headerV2_bootstrapping = false;
      }
    },

    // ── DOM setup ─────────────────────────────────────────────────────────────────

    /**
     * Ensure all required DOM elements exist — create missing ones.
     */
    _ensureElements() {
      const ensure = (selector, tag = 'div', id = '') => {
        let el = document.querySelector(selector);
        if (!el) {
          el    = document.createElement(tag);
          if (id) el.id = id;
          document.body.appendChild(el);
        }
        return el;
      };

      ensure(CONFIG.DOM.HEADER_TAG, 'header');
      ensure(`#${CONFIG.DOM.NAV_LIST_ID}`, 'ul', CONFIG.DOM.NAV_LIST_ID);
      ensure(`#${CONFIG.DOM.SUB_BUTTONS_ID}`, 'div', CONFIG.DOM.SUB_BUTTONS_ID);
      ensure(`#${CONFIG.DOM.CONTENT_LOADING_ID}`, 'div', CONFIG.DOM.CONTENT_LOADING_ID);
      ensure(CONFIG.DOM.LOGO_CLASS, 'div');
    },

    /**
     * Cache DOM element references into State.elements.
     */
    _cacheElements() {
      State.elements.header              = document.querySelector(CONFIG.DOM.HEADER_TAG);
      State.elements.navList             = document.getElementById(CONFIG.DOM.NAV_LIST_ID);
      State.elements.subButtonsContainer = document.getElementById(CONFIG.DOM.SUB_BUTTONS_ID);
      State.elements.contentLoading      = document.getElementById(CONFIG.DOM.CONTENT_LOADING_ID);
      State.elements.logo                = document.querySelector(CONFIG.DOM.LOGO_CLASS);
    },

    // ── Global exposure ────────────────────────────────────────────────────────────

    /**
     * Expose services as window globals.
     * New canonical names: window._navCore_*
     * Backward-compat aliases: window._headerV2_* (for external scripts)
     */
    _exposeGlobals() {
      // ── New canonical globals ──────────────────────────────────────────────────
      window._navCore_utils                = Utils;
      window._navCore_errorManager         = Utils.errorManager;
      window._navCore_dataManager          = DataService;
      window._navCore_contentLoadingManager = LoadingService;
      window._navCore_contentManager       = ContentService;
      window._navCore_scrollManager        = ScrollService;
      window._navCore_performanceOptimizer = PerformanceService;
      window._navCore_navigationManager    = RouterService;   // router IS the nav manager
      window._navCore_buttonManager        = ButtonService;
      window._navCore_subNavManager        = SubNavService;
      window._navCore_router               = RouterService;
      window._navCore_elements             = State.elements;

      // ── Backward-compat aliases (_headerV2_*) ──────────────────────────────────
      window._headerV2_utils                = Utils;
      window._headerV2_errorManager         = Utils.errorManager;
      window._headerV2_dataManager          = DataService;
      window._headerV2_contentLoadingManager = LoadingService;
      window._headerV2_contentManager       = ContentService;
      window._headerV2_scrollManager        = ScrollService;
      window._headerV2_performanceOptimizer = PerformanceService;
      window._headerV2_navigationManager    = RouterService;
      window._headerV2_buttonManager        = ButtonService;
      window._headerV2_subNavManager        = SubNavService;
      window._headerV2_router               = RouterService;
      window._headerV2_data_manager         = DataService;   // alternate alias used in contentManager
      window._headerV2_elements             = State.elements;

      // ── Public function globals ────────────────────────────────────────────────
      window.unifiedCopyToClipboard = (info) => CopyService.copy(info);

      // showNotification / removeInstantLoadingOverlay are set in their own modules
    },
  };

  // ── Export ────────────────────────────────────────────────────────────────────

  M.InitService = InitService;

})(window.NavCoreModules = window.NavCoreModules || {});