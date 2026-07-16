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
 *           performance.js, buttons.js, router.js, copy.js, feed.js}
 */
(function (M) {
  'use strict';

  const {
    CONFIG, State, Utils,
    DataService, LoadingService, ContentService,
    ScrollService, PerformanceService,
    SubNavService, ButtonService,
    RouterService, NavigationService,
    CopyService, FeedService,
  } = M;

  // ── InitService ───────────────────────────────────────────────────────────────

  const InitService = {

    /**
     * Bootstrap entry point — called once from nav-core.js _boot().
     * @returns {Promise<void>}
     */
    async start() {
      State.isBootstrapping = true;
      window._navCore_bootstrapping = true;

      try {
        if (!window._navCore_contentLoadingManager)
          window._navCore_contentLoadingManager = LoadingService;
      } catch (_) {}

      // ── Phase 1: Synchronous bindings ──────────────────────────────────────
      this._exposeGlobals();

      // ── Phase 2: Ensure DOM structure ──────────────────────────────────────
      this._ensureElements();
      this._cacheElements();

      // ── Phase 3: Show loading overlay early ────────────────────────────────
      // v4: show() จะแสดงข้อความ "Loading…" / "กำลังโหลด…" เท่านั้น
      try { LoadingService.show(); } catch (_) {}

      // ── Phase 4: Core service setup ────────────────────────────────────────
      try {
        PerformanceService.setupErrorBoundary();
        ScrollService.init();
        PerformanceService.init();

        window.addEventListener('online', () => {
          Utils.showNotification('การเชื่อมต่อกลับมาแล้ว', 'success');
          ButtonService.loadConfig().catch(() => {});
        }, { passive: true });

        window.addEventListener('offline', () => {
          Utils.showNotification('ขาดการเชื่อมต่ออินเทอร์เน็ต', 'warning');
        }, { passive: true });

        window.addEventListener('languageChange', ev => {
          const newLang = ev.detail?.language || 'en';
          try { ButtonService.updateButtonsLanguage?.(newLang); }  catch (_) {}
          try { ContentService.updateCardsLanguage?.(newLang); }   catch (_) {}
          // WHY: feed cache เก็บชื่อ category ตามภาษา — ต้อง invalidate เมื่อเปลี่ยนภาษา
          //      ไม่เช่นนั้น ฟีดจะแสดงชื่อภาษาเก่าจนกว่า seed window จะหมดอายุ (30 min)
          try { FeedService?.invalidate?.(); }                      catch (_) {}
        }, { passive: true });

        let _resizeTimer;
        window.addEventListener('resize', () => {
          clearTimeout(_resizeTimer);
          _resizeTimer = setTimeout(() => {
            try { RouterService.scrollActiveButtonsIntoView?.(); } catch (_) {}
          }, 150);
        }, { passive: true });

        // ── Phase 5: Load button config ────────────────────────────────────
        try {
          await ButtonService.loadConfig();
        } catch (e) {
          Utils.showErrorFullscreen(e, { label: 'Button Config Load' });
          console.error('[NavCore/Init] loadConfig error:', e);
        }

        // ── Phase 6: Init router ───────────────────────────────────────────
        try {
          RouterService.init();
        } catch (e) { console.error('[NavCore/Init] RouterService.init error:', e); }

        // ── Phase 7: Warmup data ───────────────────────────────────────────
        try {
          DataService._warmup().catch(() => {});
        } catch (_) {}

        // ── Phase 8: Initial navigation ────────────────────────────────────
        // v4: navigateTo จะเรียก hideInstant() เมื่อ content พร้อม
        //   (content mount ใต้ overlay ก่อน → 1 rAF → ลบ overlay)
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
          window._headerV2_bootstrapping             = false;

          RouterService.markInitialNavigationHandled?.();
        } catch (e) {
          Utils.showErrorFullscreen(e, { label: 'Initial Navigation' });
          console.error('[NavCore/Init] initial navigation error:', e);
          State.isBootstrapping         = false;
          window._navCore_bootstrapping = false;
          window._headerV2_bootstrapping = false;
        }

      } catch (error) {
        console.error('[NavCore/Init] bootstrap error:', error);
        try { Utils.showErrorFullscreen(error, { label: 'App Bootstrap', title: 'เกิดข้อผิดพลาดในการโหลดแอพพลิเคชัน กรุณารีเฟรชหน้า' }); } catch (_) {}
      } finally {
        // v4: ตรวจว่า LoadingService ยัง active อยู่หรือไม่ — ถ้าใช่ ให้ force hide
        //   (defensive: บาง route ไม่ได้เรียก renderContent ก็จะไม่ถึง hideInstant)
        try {
          if (LoadingService.isShown()) {
            await LoadingService.hideInstant();
          }
        } catch (_) {}

        try {
          if (typeof window.__removeInstantLoadingOverlay === 'function'
            && window.__instantLoadingOverlayShown) {
            window.__removeInstantLoadingOverlay();
            window.__instantLoadingOverlayShown = false;
          }
        } catch (_) {}

        // v4: ลบ boot loader inline (ถ้ามี) — เผื่อกรณีที่ user มาจากหน้า
        //   discover ที่มี inline boot loader แสดงอยู่ก่อน NavCore พร้อม
        try {
          if (typeof window.__removeBootLoader === 'function') {
            window.__removeBootLoader();
          } else {
            // Fallback: remove by ID ถ้า function ไม่ถูก export
            var bl = document.getElementById('fv-boot-loader');
            if (bl && bl.parentNode) bl.parentNode.removeChild(bl);
          }
        } catch (_) {}

        State.isBootstrapping         = false;
        window._navCore_bootstrapping = false;
        window._headerV2_bootstrapping = false;
      }
    },

    // ── DOM setup ─────────────────────────────────────────────────────────────

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

    _cacheElements() {
      State.elements.header              = document.querySelector(CONFIG.DOM.HEADER_TAG);
      State.elements.navList             = document.getElementById(CONFIG.DOM.NAV_LIST_ID);
      State.elements.subButtonsContainer = document.getElementById(CONFIG.DOM.SUB_BUTTONS_ID);
      State.elements.contentLoading      = document.getElementById(CONFIG.DOM.CONTENT_LOADING_ID);
      State.elements.logo                = document.querySelector(CONFIG.DOM.LOGO_CLASS);
    },

    // ── Global exposure ────────────────────────────────────────────────────────

    _exposeGlobals() {
      // ── New canonical globals ────────────────────────────────────────────────
      window._navCore_utils                = Utils;
      window._navCore_errorManager         = Utils.errorManager;
      window._navCore_dataManager          = DataService;
      window._navCore_contentLoadingManager = LoadingService;
      window._navCore_contentManager       = ContentService;
      window._navCore_scrollManager        = ScrollService;
      window._navCore_performanceOptimizer = PerformanceService;
      window._navCore_navigationManager    = RouterService;
      window._navCore_buttonManager        = ButtonService;
      window._navCore_subNavManager        = SubNavService;
      window._navCore_router               = RouterService;
      window._navCore_feedService          = FeedService;
      window._navCore_elements             = State.elements;

      // ── Backward-compat aliases (_headerV2_*) ──────────────────────────────
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
      window._headerV2_data_manager         = DataService;
      window._headerV2_elements             = State.elements;

      // ── Public function globals ──────────────────────────────────────────────
      window.unifiedCopyToClipboard = (info) => CopyService.copy(info);
    },
  };

  // ── Export ────────────────────────────────────────────────────────────────────

  M.InitService = InitService;

})(window.NavCoreModules = window.NavCoreModules || {});