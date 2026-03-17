// contentLoadingManager.js — v5
// ─────────────────────────────────────────────────────────
// v5 changes:
//  ① i18n system: CLP_MESSAGES map แยกออกมาชัดเจน
//     เพิ่มภาษาใหม่ = เพิ่ม key เดียว ไม่ต้องแก้ logic
//  ② dual-language display:
//     .clp-msg  = ภาษา active (primary, เข้ม)
//     .clp-sub  = ภาษา en เป็น subtitle (จาง) ถ้าไม่ใช่ en
//     → ผู้ใช้เห็นทั้ง native + English เสมอ
//  ③ DOM structure ใหม่: .clp-text wrapper
//  ④ platform optimizations จาก v4 ยังคงอยู่ครบ
// ─────────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════
// I18N — เพิ่มภาษาใหม่ที่นี่เพียงที่เดียว
// ─────────────────────────────────────────────────────────
// Key    = BCP 47 language tag (ตรงกับ localStorage 'selectedLang')
// loading = ข้อความหลักขณะโหลด
// ════════════════════════════════════════════════════════
const CLP_MESSAGES = {
  en: {
    loading: 'Loading...',
  },
  th: {
    loading: 'กำลังโหลด...',
  },
  // เพิ่มภาษาใหม่ได้ที่นี่ เช่น:
  // ja: { loading: '読み込み中...' },
  // zh: { loading: '加载中...' },
  // ko: { loading: '로딩 중...' },
  // id: { loading: 'Memuat...' },
  // ms: { loading: 'Memuatkan...' },
  // vi: { loading: 'Đang tải...' },
};

// Fallback chain: lang → 'en' → first key in map
function _getMsg(lang, key = 'loading') {
  return (
    CLP_MESSAGES[lang]?.[key] ||
    CLP_MESSAGES['en']?.[key] ||
    CLP_MESSAGES[Object.keys(CLP_MESSAGES)[0]]?.[key] ||
    'Loading...'
  );
}

// ════════════════════════════════════════════════════════
const OVERLAY_ID  = 'clp-overlay';
const FADE_OUT_MS = 200;
const LANG_KEY    = 'selectedLang';

const contentLoadingManager = {
  LOADING_CONTAINER_ID: 'content-loading',

  _el: null,
  _shown: false,
  _rafId: null,
  _leaveTimer: null,
  _ro: null,

  // ── Init ──────────────────────────────────────────────
  init() {
    if (!document.getElementById(OVERLAY_ID)) {
      const el = document.createElement('div');
      el.id = OVERLAY_ID;
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.setAttribute('aria-atomic', 'true');
      el.hidden = true;
      el.innerHTML = this._html();
      document.body.appendChild(el);
      this._el = el;
    } else {
      this._el = document.getElementById(OVERLAY_ID);
    }

    this._updateTopVar();

    // ResizeObserver: อัพเดท --clp-top เมื่อ nav เปลี่ยนขนาด
    if (typeof ResizeObserver !== 'undefined' && !this._ro) {
      this._ro = new ResizeObserver(() => this._updateTopVar());
      const header = document.querySelector('header');
      const subnav = document.getElementById('sub-nav');
      if (header) this._ro.observe(header);
      if (subnav) this._ro.observe(subnav);
    }

    try {
      window.showInstantLoadingOverlay   = (o) => this.show(o);
      window.removeInstantLoadingOverlay = ()  => this.hide();
    } catch(_) {}
  },

  _html() {
    return (
      `<div class="clp-spinner" aria-hidden="true">` +
        `<svg viewBox="0 0 52 52" xmlns="http://www.w3.org/2000/svg">` +
          `<circle class="clp-track" cx="26" cy="26" r="22"/>` +
          `<circle class="clp-arc"   cx="26" cy="26" r="22"/>` +
        `</svg>` +
      `</div>` +
      `<div class="clp-text">` +
        `<div class="clp-msg"></div>` +
        `<div class="clp-sub"></div>` +
      `</div>`
    );
  },

  // ── CSS var ───────────────────────────────────────────
  _updateTopVar() {
    try {
      const header = document.querySelector('header');
      const subnav = document.getElementById('sub-nav');
      let top = 0;
      if (header) top += header.offsetHeight;
      if (subnav && subnav.style.display !== 'none' && subnav.offsetHeight > 0)
        top += subnav.offsetHeight;
      document.documentElement.style.setProperty('--clp-top', `${top}px`);
    } catch(_) {}
  },

  _getEl() {
    if (this._el) return this._el;
    this.init();
    return this._el;
  },

  // ── i18n text update ──────────────────────────────────
  // primary  = ภาษา active
  // subtitle = ภาษา en (แสดงเมื่อ active ไม่ใช่ en)
  _setTexts(customMsg) {
    const el = this._getEl();
    if (!el) return;

    const msgEl = el.querySelector('.clp-msg');
    const subEl = el.querySelector('.clp-sub');
    if (!msgEl) return;

    if (customMsg) {
      // ถ้ามี custom message ใช้เลย ไม่ต้อง i18n
      msgEl.textContent = customMsg;
      if (subEl) subEl.textContent = '';
      return;
    }

    const lang = localStorage.getItem(LANG_KEY) || 'en';
    const primary = _getMsg(lang, 'loading');
    msgEl.textContent = primary;

    // subtitle: แสดง en ถ้าภาษา active ไม่ใช่ en
    if (subEl) {
      subEl.textContent = (lang !== 'en') ? _getMsg('en', 'loading') : '';
    }

    // aria-label อ่านทั้งคู่สำหรับ screen reader
    const ariaText = (lang !== 'en')
      ? `${primary} / ${_getMsg('en', 'loading')}`
      : primary;
    el.setAttribute('aria-label', ariaText);
  },

  // ── Show ──────────────────────────────────────────────
  show(opts = '') {
    const msg = typeof opts === 'string' ? opts : (opts?.message || '');
    const el  = this._getEl();
    if (!el) return;

    // ยกเลิก leaving
    if (this._leaveTimer) { clearTimeout(this._leaveTimer); this._leaveTimer = null; }
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }

    this._updateTopVar();
    this._setTexts(msg || null);

    el.classList.remove('leaving');
    el.style.willChange = '';
    el.hidden = false;

    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      el.classList.add('entering');
      const onEnd = () => {
        el.classList.remove('entering');
        el.style.willChange = '';
        el.removeEventListener('animationend', onEnd);
      };
      el.addEventListener('animationend', onEnd, { once: true, passive: true });
    });

    this._shown = true;
    try {
      window.__instantLoadingOverlayShown  = true;
      window.__removeInstantLoadingOverlay = () => this.hide();
    } catch(_) {}

    if (opts?.autoHideAfterMs > 0)
      setTimeout(() => this.hide(), opts.autoHideAfterMs);
  },

  // Aliases
  showInContent(opts) { return this.show(opts); },

  // ── Hide ──────────────────────────────────────────────
  hide() {
    const el = this._getEl();
    if (!el || !this._shown) return;

    this._shown = false;
    try { window.__instantLoadingOverlayShown = false; } catch(_) {}

    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }

    el.classList.remove('entering');
    el.style.willChange = 'opacity';
    el.classList.add('leaving');

    this._leaveTimer = setTimeout(() => {
      this._leaveTimer = null;
      el.classList.remove('leaving');
      el.style.willChange = '';
      el.hidden = true;
    }, FADE_OUT_MS + 10);
  },

  hideFromContent() { return this.hide(); },

  // ── Utilities ─────────────────────────────────────────
  updateMessage(msg) { this._setTexts(msg || null); },
  isShown() { return this._shown; },

  // อ่าน i18n map สาธารณะ (สำหรับ module อื่นที่ต้องการ)
  getMessages() { return CLP_MESSAGES; },
};

// Auto-init
function _autoInit() { contentLoadingManager.init(); }
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _autoInit, { once: true });
} else {
  _autoInit();
}

// Expose
try {
  if (typeof window !== 'undefined') {
    if (!window._headerV2_contentLoadingManager)
      window._headerV2_contentLoadingManager = contentLoadingManager;
    window.showInstantLoadingOverlay   = (o) => contentLoadingManager.show(o);
    window.removeInstantLoadingOverlay = ()  => contentLoadingManager.hide();
  }
} catch(_) {}

export { contentLoadingManager };
export default contentLoadingManager;