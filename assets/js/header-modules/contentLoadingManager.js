// contentLoadingManager.js
// Centralized loading overlay manager (single source of truth).
// Responsibilities:
// - Only this module creates, shows, hides and updates the global loading overlay.
// - Other modules should call window._headerV2_contentLoadingManager.show/hide/updateMessage
//   (or the global helpers window.showInstantLoadingOverlay / window.removeInstantLoadingOverlay
//   which are proxied to this manager).
// - Options callers may pass:
//     { message, zIndex, autoHideAfterMs, behindSubNav }
//   If zIndex is not provided the manager will choose sensible defaults.
// - Show/hide/update are idempotent and safe to call repeatedly.
// - Manager will not implicitly change history or do unrelated side-effects.

const LOADING_ID = 'content-loading-overlay';
const STYLE_ID = 'content-loading-overlay-styles';
const DEFAULT_ZINDEX = 15000;
const FADE_MS = 360;

const contentLoadingManager = {
  // public constants (for external use)
  LOADING_CONTAINER_ID: 'content-loading',
  spinnerElement: null,

  // internal state
  _autoHideTimer: null,
  _currentOptions: null,

  // Ensure overlay CSS exists (idempotent)
  _ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
#${LOADING_ID} {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.94);
  transition: opacity ${FADE_MS}ms cubic-bezier(.7,0,.7,1);
  opacity: 1;
  z-index: ${DEFAULT_ZINDEX};
  -webkit-font-smoothing:antialiased;
  -moz-osx-font-smoothing:grayscale;
  will-change: opacity;
  contain: strict;
}
#${LOADING_ID}.hidden {
  opacity: 0 !important;
  pointer-events: none;
}
#${LOADING_ID} .content-loading-spinner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  animation: content-loading-fade-in 240ms ease-in;
}
#${LOADING_ID} .spinner-svg {
  margin-bottom: 12px;
  width: 56px;
  height: 56px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
#${LOADING_ID} .spinner-svg svg { width: 100%; height: 100%; }
#${LOADING_ID} .spinner-svg-fg {
  stroke: #4285f4;
  stroke-width: 5;
  stroke-linecap: round;
  stroke-dasharray: 90 125;
  animation: instant-spinner-rotate 1s linear infinite;
  fill: none;
}
#${LOADING_ID} .spinner-svg-bg {
  stroke: #eee;
  stroke-width: 5;
  fill: none;
}
#${LOADING_ID} .loading-message {
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
    document.head.appendChild(s);
  },

  // Build overlay DOM (idempotent w.r.t. existing element)
  _buildOverlay(message = '') {
    let overlay = document.getElementById(LOADING_ID);
    if (overlay) {
      // update message if needed
      const msgEl = overlay.querySelector('.loading-message');
      if (msgEl) msgEl.textContent = message || msgEl.textContent;
      return overlay;
    }

    overlay = document.createElement('div');
    overlay.id = LOADING_ID;
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.classList.add('hidden'); // start hidden; show() will remove class

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
    messageEl.textContent = message || this.getDefaultMessage();

    spinnerWrap.appendChild(spinnerSvgWrap);
    spinnerWrap.appendChild(messageEl);
    overlay.appendChild(spinnerWrap);

    document.body.appendChild(overlay);
    // force style recalc so transition works
    // eslint-disable-next-line no-unused-expressions
    overlay.offsetHeight;

    return overlay;
  },

  // Default messages per language
  getDefaultMessage() {
    const lang = (typeof localStorage !== 'undefined' && localStorage.getItem('selectedLang')) || 'en';
    return lang === 'th' ? 'กำลังโหลดเนื้อหา...' : 'Loading content...';
  },

  // Compute a sensible z-index if none provided. Honor behindSubNav if requested.
  _computeZIndex(opts = {}) {
    if (typeof opts.zIndex === 'number') return Math.max(0, Math.floor(opts.zIndex));
    try {
      let headerZ = 0, subZ = 0;
      try {
        const headerEl = document.querySelector('header');
        if (headerEl) {
          const s = window.getComputedStyle(headerEl);
          headerZ = parseInt(s.zIndex, 10) || 0;
        }
      } catch (e) { headerZ = 0; }

      try {
        const subEl = document.getElementById('sub-nav');
        if (subEl) {
          const s = window.getComputedStyle(subEl);
          subZ = parseInt(s.zIndex, 10) || 0;
        }
      } catch (e) { subZ = 0; }

      if (opts.behindSubNav) {
        // If caller requested behindSubNav, attempt to sit just below subNav/header if possible.
        const target = subZ || headerZ || DEFAULT_ZINDEX;
        return Math.max(0, target - 1);
      }

      // default: place overlay above everything (use DEFAULT_ZINDEX)
      return DEFAULT_ZINDEX;
    } catch (e) {
      return DEFAULT_ZINDEX;
    }
  },

  // Show overlay. Accepts string or options object.
  // options: { message, zIndex, autoHideAfterMs, behindSubNav }
  show(messageOrOptions = '') {
    try {
      let message = '';
      let opts = {};
      if (typeof messageOrOptions === 'string') {
        message = messageOrOptions;
      } else if (typeof messageOrOptions === 'object' && messageOrOptions !== null) {
        message = messageOrOptions.message || '';
        opts = { ...messageOrOptions };
      }

      this._ensureStyles();

      const z = this._computeZIndex(opts);
      const overlay = this._buildOverlay(message);

      // set z-index and message
      overlay.style.zIndex = String(z);
      const msgEl = overlay.querySelector('.loading-message');
      if (msgEl) msgEl.textContent = message || this.getDefaultMessage();

      // ensure visible
      overlay.classList.remove('hidden');

      // store state
      this.spinnerElement = overlay;
      this._currentOptions = { ...opts, zIndex: z, message: msgEl ? msgEl.textContent : '' };

      // auto-hide handling
      if (this._autoHideTimer) {
        clearTimeout(this._autoHideTimer);
        this._autoHideTimer = null;
      }
      if (opts.autoHideAfterMs && Number(opts.autoHideAfterMs) > 0) {
        this._autoHideTimer = setTimeout(() => {
          try { this.hide(); } catch (e) {}
        }, Number(opts.autoHideAfterMs));
      }

      // Expose convenience globals (proxied to manager) so legacy code calling
      // window.showInstantLoadingOverlay/removeInstantLoadingOverlay works but still
      // routs through this manager (single source of truth).
      try {
        window.__removeInstantLoadingOverlay = () => this.hide();
        window.__instantLoadingOverlayShown = true;
        // Also add short global helpers (non-destructive)
        window.showInstantLoadingOverlay = (o) => this.show(o);
        window.removeInstantLoadingOverlay = () => this.hide();
      } catch (e) {}

      return overlay;
    } catch (err) {
      console.error('contentLoadingManager.show error', err);
      return null;
    }
  },

  // Hide overlay (idempotent)
  hide() {
    try {
      if (!this.spinnerElement) {
        // try to find element in DOM (in case created elsewhere)
        const existing = document.getElementById(LOADING_ID);
        if (!existing) {
          this._clearAutoHide();
          this._currentOptions = null;
          try { window.__instantLoadingOverlayShown = false; } catch (e) {}
          return;
        }
        this.spinnerElement = existing;
      }
      const overlay = this.spinnerElement;
      overlay.classList.add('hidden');

      // remove after transition
      setTimeout(() => {
        try {
          const el = document.getElementById(LOADING_ID);
          if (el && el.parentNode) el.parentNode.removeChild(el);
        } catch (e) {}
      }, FADE_MS + 40);

      this._clearAutoHide();
      this._currentOptions = null;
      this.spinnerElement = null;
      try { window.__instantLoadingOverlayShown = false; } catch (e) {}
    } catch (err) {
      console.error('contentLoadingManager.hide error', err);
      this._clearAutoHide();
      this._currentOptions = null;
      this.spinnerElement = null;
      try { window.__instantLoadingOverlayShown = false; } catch (e) {}
    }
  },

  // Update message of existing overlay without touching z-index or timers
  updateMessage(message = '') {
    try {
      const overlay = this.spinnerElement || document.getElementById(LOADING_ID);
      if (!overlay) return;
      const msgEl = overlay.querySelector('.loading-message');
      if (msgEl) msgEl.textContent = message || this.getDefaultMessage();
      if (!this._currentOptions) this._currentOptions = {};
      this._currentOptions.message = msgEl ? msgEl.textContent : '';
    } catch (e) {
      console.error('contentLoadingManager.updateMessage error', e);
    }
  },

  // Return true if overlay exists & visible
  isShown() {
    try {
      const overlay = document.getElementById(LOADING_ID);
      return !!overlay && !overlay.classList.contains('hidden');
    } catch (e) {
      return false;
    }
  },

  // Set default z-index for future overlays (not retroactive)
  setDefaultZIndex(n) {
    if (typeof n === 'number' && !Number.isNaN(n)) {
      try {
        // mutate constant by storing override on object
        this._defaultZIndexOverride = Math.max(0, Math.floor(n));
      } catch (e) {}
    }
  },

  // Internal: clear any auto-hide timer
  _clearAutoHide() {
    if (this._autoHideTimer) {
      try { clearTimeout(this._autoHideTimer); } catch (e) {}
      this._autoHideTimer = null;
    }
  }
};

// Expose manager globally as canonical controller
try {
  if (!window) {
    // noop in SSR
  } else {
    if (!window._headerV2_contentLoadingManager) window._headerV2_contentLoadingManager = contentLoadingManager;
    // Proxy legacy global functions to the manager to enforce single source
    window.showInstantLoadingOverlay = (opts) => window._headerV2_contentLoadingManager.show(opts);
    window.removeInstantLoadingOverlay = () => window._headerV2_contentLoadingManager.hide();
  }
} catch (e) { /* ignore in restricted env */ }

export { contentLoadingManager as contentLoadingManager };
export default contentLoadingManager;