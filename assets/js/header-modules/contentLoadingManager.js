// contentLoadingManager.js — Optimized
// - Removed will-change on overlay (causes compositor layer bloat)
// - Lighter fade transition (0.2s instead of 0.36s)
// - Single style injection
// - Passive state tracking

const LOADING_ID = 'content-loading-overlay';
const STYLE_ID   = 'content-loading-overlay-styles';
const DEFAULT_Z  = 15000;
const FADE_MS    = 200; // shorter = less perceived lag

const contentLoadingManager = {
  LOADING_CONTAINER_ID: 'content-loading',
  spinnerElement: null,
  _autoHideTimer: null,
  _currentOptions: null,
  _shown: false,

  _ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    // No will-change — overlay is not an animated layer that needs GPU promotion
    s.textContent = `
#${LOADING_ID}{
  position:fixed;inset:0;width:100vw;height:100vh;
  display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,0.96);
  opacity:1;z-index:${DEFAULT_Z};
  transition:opacity ${FADE_MS}ms ease;
  -webkit-font-smoothing:antialiased;
}
#${LOADING_ID}.hidden{opacity:0;pointer-events:none;}
#${LOADING_ID} .content-loading-spinner{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
}
#${LOADING_ID} .spinner-svg{
  margin-bottom:12px;width:52px;height:52px;
  display:inline-flex;align-items:center;justify-content:center;
}
#${LOADING_ID} .spinner-svg svg{width:100%;height:100%;}
#${LOADING_ID} .spinner-svg-fg{
  stroke:#4285f4;stroke-width:5;stroke-linecap:round;
  stroke-dasharray:90 125;
  animation:_spin 1s linear infinite;fill:none;
}
#${LOADING_ID} .spinner-svg-bg{stroke:#eee;stroke-width:5;fill:none;}
#${LOADING_ID} .loading-message{
  font-size:1rem;color:#2196f3;text-align:center;
  margin-top:6px;font-weight:500;opacity:0.92;
}
@keyframes _spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
`;
    document.head.appendChild(s);
  },

  _buildOverlay(message) {
    let el = document.getElementById(LOADING_ID);
    if (el) {
      const m = el.querySelector('.loading-message');
      if (m && message) m.textContent = message;
      return el;
    }

    el = document.createElement('div');
    el.id = LOADING_ID;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.classList.add('hidden');

    el.innerHTML = `
<div class="content-loading-spinner">
  <div class="spinner-svg" aria-hidden="true">
    <svg viewBox="0 0 48 48">
      <circle class="spinner-svg-bg" cx="24" cy="24" r="20"/>
      <circle class="spinner-svg-fg" cx="24" cy="24" r="20"/>
    </svg>
  </div>
  <div class="loading-message">${message || this._defaultMsg()}</div>
</div>`;

    document.body.appendChild(el);
    // Force style recalc so transition works on first show
    el.offsetHeight; // eslint-disable-line no-unused-expressions
    return el;
  },

  _defaultMsg() {
    return localStorage.getItem('selectedLang') === 'th' ? 'กำลังโหลด...' : 'Loading...';
  },

  _zIndex(opts) {
    if (typeof opts?.zIndex === 'number') return opts.zIndex;
    return DEFAULT_Z;
  },

  show(opts = '') {
    try {
      let msg = '', options = {};
      if (typeof opts === 'string') { msg = opts; }
      else if (opts && typeof opts === 'object') { msg = opts.message || ''; options = opts; }

      this._ensureStyles();
      const z = this._zIndex(options);
      const el = this._buildOverlay(msg);
      el.style.zIndex = String(z);

      const m = el.querySelector('.loading-message');
      if (m) m.textContent = msg || this._defaultMsg();

      el.classList.remove('hidden');
      this.spinnerElement = el;
      this._shown = true;
      this._currentOptions = { ...options, zIndex: z };

      this._clearAutoHide();
      if (options.autoHideAfterMs > 0) {
        this._autoHideTimer = setTimeout(() => { try { this.hide(); } catch (_) {} }, options.autoHideAfterMs);
      }

      // Proxy globals
      try {
        window.showInstantLoadingOverlay = (o) => this.show(o);
        window.removeInstantLoadingOverlay = () => this.hide();
        window.__instantLoadingOverlayShown = true;
        window.__removeInstantLoadingOverlay = () => this.hide();
      } catch (_) {}

      return el;
    } catch (err) {
      console.error('contentLoadingManager.show', err);
      return null;
    }
  },

  hide() {
    try {
      if (!this._shown && !document.getElementById(LOADING_ID)) return;
      const el = this.spinnerElement || document.getElementById(LOADING_ID);
      if (!el) { this._shown = false; return; }

      el.classList.add('hidden');

      setTimeout(() => {
        try { const e = document.getElementById(LOADING_ID); if (e?.parentNode) e.parentNode.removeChild(e); } catch (_) {}
      }, FADE_MS + 20);

      this._clearAutoHide();
      this._shown = false;
      this.spinnerElement = null;
      this._currentOptions = null;
      try { window.__instantLoadingOverlayShown = false; } catch (_) {}
    } catch (err) {
      console.error('contentLoadingManager.hide', err);
      this._shown = false;
      this.spinnerElement = null;
    }
  },

  updateMessage(msg) {
    try {
      const el = this.spinnerElement || document.getElementById(LOADING_ID);
      if (!el) return;
      const m = el.querySelector('.loading-message');
      if (m) m.textContent = msg || this._defaultMsg();
    } catch (_) {}
  },

  isShown() {
    try {
      const el = document.getElementById(LOADING_ID);
      return !!el && !el.classList.contains('hidden');
    } catch (_) { return false; }
  },

  _clearAutoHide() {
    if (this._autoHideTimer) { clearTimeout(this._autoHideTimer); this._autoHideTimer = null; }
  }
};

// Expose globally
try {
  if (typeof window !== 'undefined') {
    if (!window._headerV2_contentLoadingManager) window._headerV2_contentLoadingManager = contentLoadingManager;
    window.showInstantLoadingOverlay  = (o) => contentLoadingManager.show(o);
    window.removeInstantLoadingOverlay = () => contentLoadingManager.hide();
  }
} catch (_) {}

export { contentLoadingManager };
export default contentLoadingManager;