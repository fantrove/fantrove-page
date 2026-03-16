// contentLoadingManager.js — featherweight
//
// Changes vs previous:
//  - Styles are scoped to #content-loading-overlay only
//  - No will-change injection
//  - No global animation rule injection
//  - Faster fade (0.15s)
//  - Spinner uses prefixed @keyframes _hdr_spin (no collision)

const ID      = 'content-loading-overlay';
const FADE_MS = 150;
const Z       = 15000;

const contentLoadingManager = {
  LOADING_CONTAINER_ID: 'content-loading',
  _el: null,
  _shown: false,
  _timer: null,

  _injectStyles() {
    if (document.getElementById('_hdr_ov_css')) return;
    const s = document.createElement('style');
    s.id = '_hdr_ov_css';
    // All rules prefixed with #content-loading-overlay — zero global bleed
    s.textContent = `
#${ID}{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
background:rgba(255,255,255,.96);z-index:${Z};opacity:1;transition:opacity ${FADE_MS}ms ease;
contain:strict;}
#${ID}.h{opacity:0;pointer-events:none;}
#${ID} .w{display:flex;flex-direction:column;align-items:center;}
#${ID} .s{width:48px;height:48px;margin-bottom:10px;}
#${ID} .s svg{width:100%;height:100%;}
#${ID} .bg{stroke:#eee;stroke-width:5;fill:none;}
#${ID} .fg{stroke:#4285f4;stroke-width:5;stroke-linecap:round;stroke-dasharray:90 125;fill:none;
animation:_hdr_spin .9s linear infinite;}
@keyframes _hdr_spin{to{transform:rotate(360deg)}}
#${ID} .m{font-size:.88rem;color:#2196f3;font-weight:500;}`;
    document.head.appendChild(s);
  },

  _build(msg) {
    let el = document.getElementById(ID);
    if (el) { this._setMsg(el, msg); return el; }

    el = document.createElement('div');
    el.id = ID;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.classList.add('h'); // start hidden
    el.innerHTML =
      `<div class="w"><div class="s" aria-hidden="true"><svg viewBox="0 0 48 48">` +
      `<circle class="bg" cx="24" cy="24" r="20"/><circle class="fg" cx="24" cy="24" r="20"/>` +
      `</svg></div><div class="m">${msg || this._msg()}</div></div>`;
    document.body.appendChild(el);
    el.offsetHeight; // force style recalc before removing 'h'
    return el;
  },

  _setMsg(el, msg) {
    const m = el.querySelector('.m');
    if (m) m.textContent = msg || this._msg();
  },

  _msg() {
    return localStorage.getItem('selectedLang') === 'th' ? 'กำลังโหลด...' : 'Loading...';
  },

  show(opts = '') {
    try {
      const msg = typeof opts === 'string' ? opts : (opts?.message || '');
      const z   = typeof opts?.zIndex === 'number' ? opts.zIndex : Z;
      this._injectStyles();
      const el = this._build(msg);
      el.style.zIndex = String(z);
      this._setMsg(el, msg);
      el.classList.remove('h');
      this._el = el;
      this._shown = true;
      this._clearTimer();
      if (opts?.autoHideAfterMs > 0)
        this._timer = setTimeout(() => { try { this.hide(); } catch(_){} }, opts.autoHideAfterMs);
      // Proxy globals
      try {
        window.__instantLoadingOverlayShown  = true;
        window.__removeInstantLoadingOverlay = () => this.hide();
        window.showInstantLoadingOverlay     = (o) => this.show(o);
        window.removeInstantLoadingOverlay   = () => this.hide();
      } catch(_) {}
      return el;
    } catch(e) { console.error('clm.show', e); return null; }
  },

  hide() {
    try {
      const el = this._el || document.getElementById(ID);
      this._clearTimer();
      this._shown = false;
      this._el = null;
      try { window.__instantLoadingOverlayShown = false; } catch(_) {}
      if (!el) return;
      el.classList.add('h');
      setTimeout(() => {
        try { const e=document.getElementById(ID); if(e?.parentNode) e.parentNode.removeChild(e); }
        catch(_) {}
      }, FADE_MS + 20);
    } catch(e) { console.error('clm.hide', e); this._shown = false; this._el = null; }
  },

  updateMessage(msg) {
    const el = this._el || document.getElementById(ID);
    if (el) this._setMsg(el, msg);
  },

  isShown() {
    try { const e=document.getElementById(ID); return !!e && !e.classList.contains('h'); }
    catch(_) { return false; }
  },

  _clearTimer() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }
};

try {
  if (typeof window !== 'undefined') {
    if (!window._headerV2_contentLoadingManager) window._headerV2_contentLoadingManager = contentLoadingManager;
    window.showInstantLoadingOverlay  = (o) => contentLoadingManager.show(o);
    window.removeInstantLoadingOverlay = () => contentLoadingManager.hide();
  }
} catch(_) {}

export { contentLoadingManager };
export default contentLoadingManager;