import { showInstantLoadingOverlay } from './overlay.js';
import { _headerV2_utils, ErrorManager, showNotification } from './utils.js';
import dataManagerDefault from './dataManager.js';
import { contentLoadingManager } from './contentLoadingManager.js';
import { contentManager } from './contentManager.js';
import { scrollManager, performanceOptimizer, navigationManager, buttonManager, subNavManager } from './managers.js';
import unifiedCopy from './unifiedCopyToClipboard.js';

try {
  import('./runtime/registerOptimizations.js').then(mod => {
    try { if (mod && typeof mod.default === 'function') { mod.default(window); } } catch (e) {}
  }).catch(() => {});
} catch (e) {}

export async function init() {
  window._headerV2_utils = _headerV2_utils;
  window._headerV2_errorManager = _headerV2_utils.errorManager;
  window._headerV2_dataManager = dataManagerDefault;
  window._headerV2_contentLoadingManager = contentLoadingManager;
  window._headerV2_contentManager = contentManager;
  window._headerV2_scrollManager = scrollManager;
  window._headerV2_performanceOptimizer = performanceOptimizer;
  window._headerV2_navigationManager = navigationManager;
  window._headerV2_buttonManager = buttonManager;
  window._headerV2_subNavManager = subNavManager;
  window.unifiedCopyToClipboard = unifiedCopy;

  function ensureElement(selector: string, tag = 'div', id = '') {
    let el = document.querySelector(selector) as HTMLElement | null;
    if (!el) {
      el = document.createElement(tag) as HTMLElement;
      if (id) el.id = id;
      document.body.appendChild(el);
    }
    return el;
  }

  const header = ensureElement('header', 'header');
  const navList = ensureElement('#nav-list', 'ul', 'nav-list');
  const subButtonsContainer = ensureElement('#sub-buttons-container', 'div', 'sub-buttons-container');
  const contentLoading = ensureElement('#content-loading', 'div', 'content-loading');
  const logo = ensureElement('.logo', 'div', 'logo');

  window._headerV2_elements = { header, navList, subButtonsContainer, contentLoading, logo };

  try {
    if (!window._headerV2_runtime) {
      import('./runtime/registerOptimizations.js').then(mod => {
        try { if (mod && typeof mod.default === 'function') mod.default(window); } catch (e) {}
      }).catch(() => {});
    }
  } catch (e) {}

  try { showInstantLoadingOverlay(); } catch {}

  try {
    window._headerV2_performanceOptimizer.setupErrorBoundary();
    window._headerV2_scrollManager.init();
    window._headerV2_performanceOptimizer.init();

    window.addEventListener('online', () => {
      window._headerV2_utils.showNotification('การเชื่อมต่อกลับมาแล้ว', 'success');
      window._headerV2_buttonManager.loadConfig().catch(() => {});
    }, { passive: true });

    window.addEventListener('offline', () => {
      window._headerV2_utils.showNotification('ขาดการเชื่อมต่ออินเทอร์เน็ต', 'warning');
    }, { passive: true });

    window.addEventListener('popstate', async () => {
      try {
        const url = window.location.search;
        const navMgr = window._headerV2_navigationManager;
        if (!navMgr) throw new Error('navigationManager missing');
        if (!url || url === '?') {
          const defaultRoute = await navMgr.getDefaultRoute();
          await navMgr.navigateTo(defaultRoute, { skipUrlUpdate: true, isPopState: true });
        } else {
          await navMgr.navigateTo(url, { skipUrlUpdate: true, isPopState: true });
        }
      } catch (e) {
        window._headerV2_utils.showNotification('เกิดข้อผิดพลาดในการนำทางย้อนกลับ', 'error');
        console.error('popstate error', e);
      }
    }, { passive: true });

    window.addEventListener('languageChange', (event: any) => {
      const newLang = event.detail?.language || 'en';
      try {
        if (window._headerV2_buttonManager.updateButtonsLanguage)
          window._headerV2_buttonManager.updateButtonsLanguage(newLang);
        if (window._headerV2_contentManager.updateCardsLanguage)
          window._headerV2_contentManager.updateCardsLanguage(newLang);
      } catch (e) {
        window._headerV2_utils.showNotification('เกิดข้อผิดพลาดการเปลี่ยนภาษา', 'error');
      }
    }, { passive: true });

    let resizeTimeout: any;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        try {
          if (window._headerV2_navigationManager.scrollActiveButtonsIntoView)
            window._headerV2_navigationManager.scrollActiveButtonsIntoView();
        } catch (e) {
          window._headerV2_utils.showNotification('เกิดข้อผิดพลาด resize', 'error');
        }
      }, 150);
    }, { passive: true });

    try {
      await window._headerV2_buttonManager.loadConfig();
    } catch (e) {
      window._headerV2_utils.showNotification('โหลดข้อมูลปุ่มไม่สำเร็จ', 'error');
      console.error('loadConfig error', e);
    }

    try {
      const rt = window._headerV2_runtime;
      if (rt && rt.poolManager) {
        try {
          if (typeof rt.poolManager.prewarm === 'function') {
            rt.poolManager.prewarm('card', 8);
            rt.poolManager.prewarm('button', 12);
          }
        } catch (e) {}
      }
    } catch (e) {}

    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/assets/js/header-modules/runtime/service-worker.js').catch(() => {});
      }
    } catch (e) {}

    try {
      if (window._headerV2_dataManager && typeof window._headerV2_dataManager._warmup === 'function') {
        window._headerV2_dataManager._warmup().catch(() => {});
      } else {
        dataManagerDefault._warmup && dataManagerDefault._warmup().catch(() => {});
      }
    } catch (e) {}

    try {
      const navMgr = window._headerV2_navigationManager;
      const url = window.location.search;
      if (!url || url === '?') {
        const defaultRoute = await navMgr.getDefaultRoute();
        await navMgr.navigateTo(defaultRoute, { skipUrlUpdate: true });
      } else {
        await navMgr.navigateTo(url, { skipUrlUpdate: true });
      }
    } catch (e) {
      window._headerV2_utils.showNotification('เกิดข้อผิดพลาดในการนำทางเริ่มต้น', 'error');
      console.error('initial navigation error', e);
    }
  } catch (error) {
    console.error('init error', error);
    try {
      window._headerV2_utils.showNotification('เกิดข้อผิดพลาดในการโหลดแอพพลิเคชัน กรุณารีเฟรชหน้า', 'error');
    } catch {}
  } finally {
    try {
      if (typeof window.__removeInstantLoadingOverlay === "function" && window.__instantLoadingOverlayShown) {
        window.__removeInstantLoadingOverlay();
        window.__instantLoadingOverlayShown = false;
      }
    } catch {}
  }
}

export default { init };