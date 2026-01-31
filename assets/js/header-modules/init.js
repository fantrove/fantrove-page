// init.js
// ✅ ปรับปรุง: Deferred initialization, phase-based loading, performance monitoring
import { showInstantLoadingOverlay } from './overlay.js';
import { _headerV2_utils, ErrorManager, showNotification } from './utils.js';
import dataManagerDefault from './dataManager.js';
import { contentLoadingManager } from './contentLoadingManager.js';
import { contentManager } from './contentManager.js';
import { scrollManager, performanceOptimizer, navigationManager, buttonManager, subNavManager } from './managers.js';
import unifiedCopy from './unifiedCopyToClipboard.js';
import router from './router.js';

// Optional runtime adapter (may have already been loaded by header.min.js)
// This provides window._headerV2_runtime with poolManager/createVirtualScroller etc.
let setupHeaderRuntimeAdapters;
try {
 // dynamic import to avoid bundling errors if file not present
 // note: we don't await here to avoid blocking initialization; we will call setup if available
 import('./runtime/registerOptimizations.js').then(mod => {
  try { if (mod && typeof mod.default === 'function') { mod.default(window); } } catch (e) {}
 }).catch(() => {});
} catch (e) {}

export async function init() {
 // ✅ Phase 1: Critical path initialization (synchronous binding)
 window._headerV2_utils = _headerV2_utils;
 window._headerV2_errorManager = _headerV2_utils.errorManager;
 window._headerV2_dataManager = dataManagerDefault;
 window._headerV2_contentLoadingManager = contentLoadingManager;
 window._headerV2_contentManager = contentManager;
 window._headerV2_scrollManager = scrollManager;
 window._headerV2_performanceOptimizer = performanceOptimizer;
 window._headerV2_navigationManager = navigationManager; // temporary shim (will be overwritten by router below)
 window._headerV2_buttonManager = buttonManager;
 window._headerV2_subNavManager = subNavManager;
 window.unifiedCopyToClipboard = unifiedCopy;
 
 // Expose router as the canonical navigation core
 try {
  if (!window._headerV2_router) window._headerV2_router = router;
  // Also set navigationManager global pointer to router for compatibility
  window._headerV2_navigationManager = window._headerV2_router;
 } catch (e) {}
 
 // ✅ Ensure DOM elements exist
 function ensureElement(selector, tag = 'div', id = '') {
  let el = document.querySelector(selector);
  if (!el) {
   el = document.createElement(tag);
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
 
 // Attempt to ensure runtime adapter exists (double-check)
 try {
  // If header.min.js didn't call registerOptimizations early, call it here (safe no-op if already applied)
  try {
   // dynamic import attempt, but only call if global not present
   if (!window._headerV2_runtime) {
    // We import and call default synchronously via then; do not await blocking init
    import('./runtime/registerOptimizations.js').then(mod => {
     try { if (mod && typeof mod.default === 'function') mod.default(window); } catch (e) {}
    }).catch(() => {});
   }
  } catch (e) {}
 } catch (e) {}
 
 // ✅ Show overlay early
 try { showInstantLoadingOverlay(); } catch {}
 
 // ✅ Phase 2: Setup core managers (critical for functionality)
 try {
  window._headerV2_performanceOptimizer.setupErrorBoundary();
  window._headerV2_scrollManager.init();
  window._headerV2_performanceOptimizer.init();
  
  // Network status events
  window.addEventListener('online', () => {
   window._headerV2_utils.showNotification('การเชื่อมต่อกลับมาแล้ว', 'success');
   window._headerV2_buttonManager.loadConfig().catch(() => {});
  }, { passive: true });
  
  window.addEventListener('offline', () => {
   window._headerV2_utils.showNotification('ขาดการเชื่อมต่ออินเทอร์เน็ต', 'warning');
  }, { passive: true });
  
  // History popstate is handled by router core; keep a fallback listener for legacy consumers
  window.addEventListener('popstate', async () => {
   try {
    const url = window.location.search;
    const navMgr = window._headerV2_router || window._headerV2_navigationManager;
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
  
  // Language change events
  window.addEventListener('languageChange', (event) => {
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
  
  // Resize events with debouncing
  let resizeTimeout;
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
  
  // ✅ Load button config
  try {
   await window._headerV2_buttonManager.loadConfig();
  } catch (e) {
   window._headerV2_utils.showNotification('โหลดข้อมูลปุ่มไม่สำเร็จ', 'error');
   console.error('loadConfig error', e);
  }
  
  // Initialize router after button config loaded to ensure validate/getDefaultRoute work
  try {
   if (window._headerV2_router && typeof window._headerV2_router.init === 'function') {
    window._headerV2_router.init();
   }
  } catch (e) {}
  
  // Runtime prewarm: pre-create pooled DOM nodes (if runtime adapter present)
  try {
   const rt = window._headerV2_runtime;
   if (rt && rt.poolManager) {
    // prewarm some nodes (non-blocking)
    try {
     if (typeof rt.poolManager.prewarm === 'function') {
      rt.poolManager.prewarm('card', 8);
      rt.poolManager.prewarm('button', 12);
     }
    } catch (e) {}
   }
  } catch (e) {}
  
  // Register service worker for caching con-data and static assets (optional, safe)
  try {
   if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/assets/js/header-modules/runtime/service-worker.js').catch(() => {});
   }
  } catch (e) {}
  
  // Warmup dataManager (prefetch light assets + category indexes)
  try {
   if (window._headerV2_dataManager && typeof window._headerV2_dataManager._warmup === 'function') {
    window._headerV2_dataManager._warmup().catch(() => {});
   } else {
    // call default instance if available
    dataManagerDefault._warmup && dataManagerDefault._warmup().catch(() => {});
   }
  } catch (e) {}
  
  // ✅ Initial navigation via router (router will pick default route if needed)
  try {
   const navMgr = window._headerV2_router || window._headerV2_navigationManager;
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
  // ✅ Hide overlay when ready
  try {
   if (typeof window.__removeInstantLoadingOverlay === "function" && window.__instantLoadingOverlayShown) {
    window.__removeInstantLoadingOverlay();
    window.__instantLoadingOverlayShown = false;
   }
  } catch {}
 }
}

export default { init };