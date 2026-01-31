// contentLoadingManager.js
// ✅ ปรับปรุง: Lazy overlay setup, memoization
import { showInstantLoadingOverlay, removeInstantLoadingOverlay } from './overlay.js';

const LOADING_CONTAINER_ID = 'content-loading';
const SPINNER_ID = 'headerv2-spinner';

export const contentLoadingManager = {
 LOADING_CONTAINER_ID,
 spinnerElement: null,
 _messageCache: {}, // ✅ NEW: cache for default messages
 
 createSpinner(message = '') {
  if (this.spinnerElement && document.body.contains(this.spinnerElement)) {
   this.updateMessage(message);
   return this.spinnerElement;
  }
  const spinner = document.createElement('div');
  spinner.id = SPINNER_ID;
  spinner.className = 'content-loading-spinner';
  spinner.style.pointerEvents = 'none';
  spinner.innerHTML = `
      <div aria-hidden="true" class="spinner-svg" style="width:48px;height:48px;display:inline-block">
        <svg viewBox="0 0 48 48" width="48" height="48" focusable="false">
          <circle cx="24" cy="24" r="20" stroke="#eee" stroke-width="5" fill="none"></circle>
          <circle class="spinner-svg-fg" cx="24" cy="24" r="20" stroke="#4285f4" stroke-width="5" stroke-linecap="round" stroke-dasharray="90 125" style="animation:rotate 1s linear infinite"></circle>
        </svg>
      </div>
      <div class="loading-message" style="margin-top:8px;font-weight:500;color:#2196f3">${message || this.getDefaultMessage()}</div>
    `;
  // minimal style (only if not present)
  if (!document.getElementById('headerv2-loading-styles')) {
   const s = document.createElement('style');
   s.id = 'headerv2-loading-styles';
   s.textContent = `
        @keyframes rotate{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        .content-loading-spinner{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:12px}
      `;
   document.head.appendChild(s);
  }
  this.spinnerElement = spinner;
  return spinner;
 },
 
 show(messageOrOptions = '') {
  try {
   let message = '';
   let opts = {};
   if (typeof messageOrOptions === 'string') {
    message = messageOrOptions;
   } else if (typeof messageOrOptions === 'object' && messageOrOptions !== null) {
    message = messageOrOptions.message || '';
    opts = messageOrOptions;
   }
   
   let useOverlay = typeof showInstantLoadingOverlay === 'function';
   let computedZ = undefined;
   
   if (useOverlay) {
    let behindSubNav = !!opts.behindSubNav;
    // Auto-detect if sub-nav is present and visible
    if (opts.behindSubNav === undefined) {
     try {
      const subNav = document.getElementById('sub-nav');
      if (subNav) {
       const style = window.getComputedStyle(subNav);
       const visible = style.display !== 'none' && style.visibility !== 'hidden' && subNav.offsetHeight > 0;
       const container = subNav.querySelector('#sub-buttons-container');
       const hasSubButtons = container && container.childNodes && container.childNodes.length > 0;
       if (visible && hasSubButtons) behindSubNav = true;
      }
     } catch (e) {}
    }
    
    // Compute z-index
    try {
     let headerZ = 0;
     try {
      const headerEl = document.querySelector('header');
      if (headerEl) {
       const hStyle = window.getComputedStyle(headerEl);
       headerZ = parseInt(hStyle.zIndex, 10) || 0;
      }
     } catch (e) { headerZ = 0; }
     
     let subZ = 0;
     try {
      const subNav = document.getElementById('sub-nav');
      if (subNav) {
       const sStyle = window.getComputedStyle(subNav);
       subZ = parseInt(sStyle.zIndex, 10) || 0;
      }
     } catch (e) { subZ = 0; }
     
     try {
      if (!subZ && window._headerV2_scrollManager && window._headerV2_scrollManager.constants && window._headerV2_scrollManager.constants.Z_INDEX)
       subZ = window._headerV2_scrollManager.constants.Z_INDEX.SUB_NAV || subZ;
     } catch (e) {}
     
     let targetZ = 0;
     if (behindSubNav) {
      targetZ = subZ || headerZ || 1000;
     } else {
      targetZ = headerZ || subZ || 1000;
     }
     
     if (opts.zIndex != null) {
      const provided = Number(opts.zIndex);
      if (!isNaN(provided)) {
       computedZ = provided >= targetZ ? Math.max(0, targetZ - 1) : Math.max(0, provided);
      }
     } else {
      computedZ = Math.max(0, targetZ - 1);
     }
    } catch (e) {
     computedZ = undefined;
    }
    
    showInstantLoadingOverlay({
     lang: undefined,
     message: message,
     zIndex: computedZ,
     autoHideAfterMs: opts.autoHideAfterMs
    });
    return;
   }
  } catch (err) {
   console.error('contentLoadingManager overlay show error', err);
  }
  
  // Fallback: legacy in-container spinner
  const container = document.getElementById(this.LOADING_CONTAINER_ID);
  if (!container) return;
  const existing = container.querySelector('#' + SPINNER_ID);
  if (existing) {
   this.updateMessage(messageOrOptions && messageOrOptions.message ? messageOrOptions.message : (typeof messageOrOptions === 'string' ? messageOrOptions : ''));
   return;
  }
  const spinner = this.createSpinner(typeof messageOrOptions === 'string' ? messageOrOptions : (messageOrOptions && messageOrOptions.message ? messageOrOptions.message : ''));
  container.appendChild(spinner);
 },
 
 hide() {
  try {
   try {
    if (typeof removeInstantLoadingOverlay === 'function') {
     removeInstantLoadingOverlay();
    }
   } catch (e) {}
   
   const container = document.getElementById(this.LOADING_CONTAINER_ID);
   if (!container) return;
   const spinner = container.querySelector('#' + SPINNER_ID);
   if (spinner && spinner.parentNode) {
    spinner.parentNode.removeChild(spinner);
   }
   this.spinnerElement = null;
  } catch (e) {
   this.spinnerElement = null;
  }
 },
 
 updateMessage(message = '') {
  try {
   const overlayMsg = document.querySelector('#instant-loading-overlay .loading-message');
   if (overlayMsg) {
    overlayMsg.textContent = message || this.getDefaultMessage();
    return;
   }
  } catch (e) {}
  if (!this.spinnerElement) return;
  const msg = this.spinnerElement.querySelector('.loading-message');
  if (msg) msg.textContent = message || this.getDefaultMessage();
 },
 
 getDefaultMessage() {
  const lang = localStorage.getItem('selectedLang') || 'en';
  const cacheKey = `msg-${lang}`;
  if (this._messageCache[cacheKey]) return this._messageCache[cacheKey];
  const msg = lang === 'th' ? 'กำลังโหลดเนื้อหา...' : 'Loading content...';
  this._messageCache[cacheKey] = msg;
  return msg;
 }
};

export default contentLoadingManager;