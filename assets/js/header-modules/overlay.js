// overlay.js — v2
// ─────────────────────────────────────────────────────────────
// v2 changes:
//  - ลบ ensureStyles() ออกทั้งหมด
//  - ลบ STYLE_ID และ style injection ทุกจุด
//    CSS ของ #instant-loading-overlay อยู่ใน /assets/css/loading.css
//  - โค้ดเบาลง ~80 บรรทัด
//  - ยังคง backward-compatible proxy ไป contentLoadingManager
// ─────────────────────────────────────────────────────────────

const OVERLAY_ID = 'instant-loading-overlay';
const DEFAULT_ZINDEX = 15000;
const FADE_DURATION_MS = 360;

function buildOverlayElement(message = '', zIndex = DEFAULT_ZINDEX) {
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.style.zIndex = String(zIndex ?? DEFAULT_ZINDEX);
  
  const spinnerWrap = document.createElement('div');
  spinnerWrap.className = 'content-loading-spinner';
  
  const spinnerSvgWrap = document.createElement('div');
  spinnerSvgWrap.className = 'spinner-svg';
  spinnerSvgWrap.setAttribute('aria-hidden', 'true');
  spinnerSvgWrap.innerHTML = `
<svg viewBox="0 0 48 48" focusable="false" aria-hidden="true" role="img">
  <circle class="spinner-svg-bg" cx="24" cy="24" r="20"/>
  <circle class="spinner-svg-fg" cx="24" cy="24" r="20"/>
</svg>`.trim();
  
  const messageEl = document.createElement('div');
  messageEl.className = 'loading-message';
  messageEl.textContent = message || (localStorage.getItem('selectedLang') === 'th' ?
    'กำลังโหลดเนื้อหา...' : 'Loading content...');
  
  spinnerWrap.appendChild(spinnerSvgWrap);
  spinnerWrap.appendChild(messageEl);
  overlay.appendChild(spinnerWrap);
  return overlay;
}

export function showInstantLoadingOverlay(options = {}) {
  try {
    // Proxy to canonical manager if available
    if (typeof window !== 'undefined' &&
      window._headerV2_contentLoadingManager &&
      typeof window._headerV2_contentLoadingManager.show === 'function') {
      return window._headerV2_contentLoadingManager.show(options);
    }
    
    // Legacy fallback — CSS comes from loading.css (no inline injection)
    const lang = options.lang || localStorage.getItem('selectedLang') || 'en';
    const message = typeof options.message === 'string' && options.message.length > 0 ?
      options.message :
      (lang === 'th' ? 'กำลังโหลดเนื้อหา...' : 'Loading content...');
    const zIndex = options.zIndex ?? DEFAULT_ZINDEX;
    
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
      const msgEl = overlay.querySelector('.loading-message');
      if (msgEl && msgEl.textContent !== message) msgEl.textContent = message;
      overlay.style.zIndex = String(zIndex);
      overlay.classList.remove('hidden');
    } else {
      overlay = buildOverlayElement(message, zIndex);
      document.body.appendChild(overlay);
      overlay.offsetHeight; // force reflow
      overlay.classList.remove('hidden');
    }
    
    if (options.autoHideAfterMs && Number(options.autoHideAfterMs) > 0) {
      setTimeout(() => removeInstantLoadingOverlay(), Number(options.autoHideAfterMs));
    }
    
    window.__removeInstantLoadingOverlay = removeInstantLoadingOverlay;
    window.__instantLoadingOverlayShown = true;
    return overlay;
  } catch (err) {
    console.error('showInstantLoadingOverlay error', err);
    return null;
  }
}

export function removeInstantLoadingOverlay() {
  try {
    if (typeof window !== 'undefined' &&
      window._headerV2_contentLoadingManager &&
      typeof window._headerV2_contentLoadingManager.hide === 'function') {
      return window._headerV2_contentLoadingManager.hide();
    }
    
    // Legacy fallback
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) { window.__instantLoadingOverlayShown = false; return; }
    overlay.classList.add('hidden');
    setTimeout(() => {
      try { const el = document.getElementById(OVERLAY_ID); if (el?.parentNode) el.parentNode.removeChild(el); }
      catch (_) {}
      window.__instantLoadingOverlayShown = false;
      try { delete window.__removeInstantLoadingOverlay; } catch (_) {}
    }, FADE_DURATION_MS + 40);
  } catch (err) {
    console.error('removeInstantLoadingOverlay error', err);
  }
}

export function isOverlayShown() {
  try {
    if (typeof window !== 'undefined' &&
      window._headerV2_contentLoadingManager &&
      typeof window._headerV2_contentLoadingManager.isShown === 'function') {
      return window._headerV2_contentLoadingManager.isShown();
    }
    const overlay = document.getElementById(OVERLAY_ID);
    return !!overlay && !overlay.classList.contains('hidden');
  } catch (e) { return false; }
}

export default { showInstantLoadingOverlay, removeInstantLoadingOverlay, isOverlayShown };