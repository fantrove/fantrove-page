// @ts-check
/**
 * @file performance.js
 * ScrollService      — sticky sub-nav via a single passive scroll listener + RAF.
 * PerformanceService — lazy image setup, error boundary, Connection API awareness.
 *
 * Both services are consolidated here from managers.js because they share
 * no state and are purely environmental optimizations.
 *
 * CSS injected once by ScrollService._injectStyles().
 *
 * @module performance
 * @depends {config.js, state.js, utils.js}
 */
(function (M) {
  'use strict';

  const { CONFIG, Utils } = M;

  // ── ScrollService ──────────────────────────────────────────────────────────────

  /**
   * Makes #sub-nav sticky by toggling .fx class via a single passive scroll listener.
   * Uses one RAF per scroll event to batch reads.
   */
  const ScrollService = {
    _ticking: false,
    _fixed:   false,
    _Z:       999,

    _injectStyles() {
      if (document.getElementById('_nc_sticky_css')) return;
      const s   = document.createElement('style');
      s.id      = '_nc_sticky_css';
      const hz  = this._Z + 2;
      s.textContent = `
header{position:relative;z-index:${hz};contain:layout style;}
#sub-nav{position:sticky;top:0;left:0;right:0;z-index:${this._Z};}
#sub-nav.fx{background:rgba(255,255,255,1);border-bottom:0.5px solid rgba(19,180,127,0.18);border-radius:0 0 30px 30px;}
#sub-nav.fx #sub-buttons-container{padding:6px 16px!important;border-radius:0 0 30px 30px;}
#sub-nav.fx.hi{padding:0!important;}
#sub-nav.fx .hj{border-color:rgba(0,0,0,0);background:transparent;}`;
      document.head.appendChild(s);
    },

    _tick() {
      const sn = document.getElementById(CONFIG.DOM.SUB_NAV_ID);
      if (!sn) return;
      const top = sn.getBoundingClientRect().top;
      if (top <= 0 && !this._fixed)  { sn.classList.add('fx');    this._fixed = true;  }
      else if (top > 0 && this._fixed) { sn.classList.remove('fx'); this._fixed = false; }
    },

    init() {
      this._injectStyles();

      window.addEventListener('scroll', () => {
        if (this._ticking) return;
        this._ticking = true;
        requestAnimationFrame(() => {
          try { this._tick(); } catch (_) {}
          this._ticking = false;
        });
      }, { passive: true });

      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) try { this._tick(); } catch (_) {}
      }, { passive: true });

      if (window.pageYOffset > 0) this._tick();
    },
  };

  // ── PerformanceService ────────────────────────────────────────────────────────

  /**
   * One-time performance setup: lazy images, error boundary, Connection API.
   */
  const PerformanceService = {

    init() {
      // Lazy-load images (prefer native loading="lazy")
      if ('loading' in HTMLImageElement.prototype) {
        document.querySelectorAll('img:not([loading])').forEach(i => { i.loading = 'lazy'; });
      }
      document.querySelectorAll('img[loading="lazy"]').forEach(img => {
        if (!img.hasAttribute('fetchpriority')) img.setAttribute('fetchpriority', 'low');
      });

      // Error boundary — throttle notifications to max 1 per second
      let _errT;
      const _notify = msg => {
        clearTimeout(_errT);
        _errT = setTimeout(() => {
          try { Utils.showNotification(msg, 'error'); } catch (_) {}
        }, 1000);
      };
      window.addEventListener('error', e => {
        _notify('เกิดข้อผิดพลาดที่ไม่คาดคิด');
        console.error(e.error || e);
      }, { passive: true });
      window.addEventListener('unhandledrejection', e => {
        _notify('เกิดข้อผิดพลาดในการเชื่อมต่อ');
        console.error(e.reason);
      }, { passive: true });

      // Connection API — flag slow connections so warmup can back off
      try {
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (conn) {
          const _check = () => {
            window._navCore_slowConnection =
              conn.saveData
              || conn.effectiveType === '2g'
              || conn.effectiveType === 'slow-2g';
          };
          _check();
          conn.addEventListener('change', _check, { passive: true });
        }
      } catch (_) {}
    },

    // Called during init — setupErrorBoundary is handled inside init()
    setupErrorBoundary() { /* handled in init() */ },
    setupLazyLoading()   { /* handled in init() */ },
  };

  // ── Export ────────────────────────────────────────────────────────────────────

  M.ScrollService      = ScrollService;
  M.PerformanceService = PerformanceService;

})(window.NavCoreModules = window.NavCoreModules || {});