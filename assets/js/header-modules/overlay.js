// overlay.js
// Backward-compatible wrapper that proxies to window._headerV2_contentLoadingManager if available.
// If manager is not yet present, fallback to a local lightweight overlay implementation.
// This allows legacy imports of showInstantLoadingOverlay/removeInstantLoadingOverlay to keep working
// while enforcing contentLoadingManager as the canonical controller.

const OVERLAY_ID = 'instant-loading-overlay';
const STYLE_ID = 'instant-loading-styles';
const DEFAULT_ZINDEX = 15000;
const FADE_DURATION_MS = 360;

function ensureStyles() {
  let style = document.getElementById(STYLE_ID);
  if (style) return style;
  style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
#${OVERLAY_ID} {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255,255,255,0.94);
    transition: opacity ${FADE_DURATION_MS}ms cubic-bezier(.7,0,.7,1);
    opacity: 1;
    z-index: ${DEFAULT_ZINDEX};
    -webkit-font-smoothing:antialiased;
    -moz-osx-font-smoothing:grayscale;
    will-change: opacity;
    contain: strict;
}
#${OVERLAY_ID}.hidden {
    opacity: 0 !important;
    pointer-events: none;
}
#${OVERLAY_ID} .content-loading-spinner {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    animation: content-loading-fade-in 240ms ease-in;
}
#${OVERLAY_ID} .spinner-svg {
    margin-bottom: 12px;
    width: 56px;
    height: 56px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
#${OVERLAY_ID} .spinner-svg svg { width: 100%; height: 100%; }
#${OVERLAY_ID} .spinner-svg-fg {
    stroke: #4285f4;
    stroke-width: 5;
    stroke-linecap: round;
    stroke-dasharray: 90 125;
    animation: instant-spinner-rotate 1s linear infinite;
    fill: none;
}
#${OVERLAY_ID} .spinner-svg-bg {
    stroke: #eee;
    stroke-width: 5;
    fill: none;
}
#${OVERLAY_ID} .loading-message {
    font-size: 1.06rem;
    color: #2196f3;
    text-align: center;
    margin-top: 6px;
    font-weight: 500;
    letter-spacing: 0.02em;
    opacity: 0.94;
}
@keyframes content-loading-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes instant-spinner-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
`;
  document.head.appendChild(style);
  return style;
}

function buildOverlayElement(message = '', zIndex = DEFAULT_ZINDEX) {
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.style.zIndex = String(zIndex ?? DEFAULT_ZINDEX);
  overlay.className = '';
  const spinnerWrap = document.createElement('div');
  spinnerWrap.className = 'content-loading-spinner';
  const spinnerSvgWrap = document.createElement('div');
  spinnerSvgWrap.className = 'spinner-svg';
  spinnerSvgWrap.setAttribute('aria-hidden', 'true');
  spinnerSvgWrap.innerHTML = `
<svg viewBox="0 0 48 48" focusable="false" aria-hidden="true" role="img">
    <circle class="spinner-svg-bg" cx="24" cy="24" r="20" />
    <circle class="spinner-svg-fg" cx="24" cy="24" r="20" />
</svg>`.trim();
  const messageEl = document.createElement('div');
  messageEl.className = 'loading-message';
  messageEl.textContent = message || (localStorage.getItem('selectedLang') === 'th' ? 'กำลังโหลดเนื้อหา...' : 'Loading content...');
  spinnerWrap.appendChild(spinnerSvgWrap);
  spinnerWrap.appendChild(messageEl);
  overlay.appendChild(spinnerWrap);
  return overlay;
}

// Primary exported helpers: proxy to contentLoadingManager if present.
export function showInstantLoadingOverlay(options = {}) {
  try {
    // If canonical manager exists, delegate call
    if (typeof window !== 'undefined' && window._headerV2_contentLoadingManager && typeof window._headerV2_contentLoadingManager.show === 'function') {
      return window._headerV2_contentLoadingManager.show(options);
    }
    
    // Fallback: local lightweight implementation (legacy)
    ensureStyles();
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
      // force repaint
      // eslint-disable-next-line no-unused-expressions
      overlay.offsetHeight;
      overlay.classList.remove('hidden');
    }
    if (options.autoHideAfterMs && Number(options.autoHideAfterMs) > 0) {
      setTimeout(() => {
        removeInstantLoadingOverlay();
      }, Number(options.autoHideAfterMs));
    }
    // expose global helpers for compatibility
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
    if (typeof window !== 'undefined' && window._headerV2_contentLoadingManager && typeof window._headerV2_contentLoadingManager.hide === 'function') {
      return window._headerV2_contentLoadingManager.hide();
    }
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      const style = document.getElementById(STYLE_ID);
      if (style && style.parentNode) style.parentNode.removeChild(style);
      window.__instantLoadingOverlayShown = false;
      return;
    }
    overlay.classList.add('hidden');
    setTimeout(() => {
      try {
        const el = document.getElementById(OVERLAY_ID);
        if (el && el.parentNode) el.parentNode.removeChild(el);
      } catch {}
      try {
        const style = document.getElementById(STYLE_ID);
        if (style && style.parentNode) style.parentNode.removeChild(style);
      } catch {}
      window.__instantLoadingOverlayShown = false;
      try { delete window.__removeInstantLoadingOverlay; } catch {}
    }, FADE_DURATION_MS + 40);
  } catch (err) {
    console.error('removeInstantLoadingOverlay error', err);
  }
}

export function isOverlayShown() {
  // If manager present, ask it; otherwise fallback to DOM check
  try {
    if (typeof window !== 'undefined' && window._headerV2_contentLoadingManager && typeof window._headerV2_contentLoadingManager.isShown === 'function') {
      return window._headerV2_contentLoadingManager.isShown();
    }
    const overlay = document.getElementById(OVERLAY_ID);
    return !!overlay && !overlay.classList.contains('hidden');
  } catch (e) {
    return false;
  }
}

export default {
  showInstantLoadingOverlay,
  removeInstantLoadingOverlay,
  isOverlayShown
};