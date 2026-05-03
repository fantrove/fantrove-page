// Path:    assets/js/ure/ure.js
// Purpose: Self-loading entry point for the Universal Render Engine.
//          Loads all ure-modules/* in dependency order, then exposes
//          the public URE global API.
//
// HTML:
//   <script src="/assets/js/ure/ure.js"></script>
//
// Then anywhere on any page:
//   const list = URE.mount({ container: '#app', data: [...], template: ... });
//
// Module load order (dependency chain):
//   types.js        — typedefs only
//   config.js       — constants, device tier
//   scheduler.js    — rAF + rIC orchestration
//   pool.js         — DOM node recycling
//   observer.js     — IO / RO / MO factories
//   diffing.js      — O(n) data diff
//   state.js        — reactive state store
//   worker.js       — Web Worker bridge
//   lazy-assets.js  — lazy img/iframe/bg loading
//   virtual-list.js — core virtual scroll
//   engine.js       — main orchestrator

(function() {
  'use strict';
  
  if (window.URE?._initialized) return;
  
  // ── Module list in load order ─────────────────────────────────────────────
  
  const MODULES = [
    'types.js',
    'config.js',
    'scheduler.js',
    'pool.js',
    'observer.js',
    'diffing.js',
    'state.js',
    'worker.js',
    'lazy-assets.js',
    'virtual-list.js',
    'engine.js',
  ];
  
  // ── Resolve base path ─────────────────────────────────────────────────────
  
  function getBasePath() {
    try {
      const scripts = document.querySelectorAll('script[src]');
      for (const s of scripts) {
        const src = s.getAttribute('src') || '';
        const clean = src.split('?')[0].split('#')[0];
        if (/\/ure\.js$/.test(clean)) {
          return clean.replace(/\/ure\.js$/, '/ure-modules');
        }
      }
    } catch (_) {}
    return '/assets/js/ure/ure-modules';
  }
  
  // ── Script loader ─────────────────────────────────────────────────────────
  
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('[URE] Failed to load: ' + url));
      document.head.appendChild(s);
    });
  }
  
  function loadSequential(urls) {
    return urls.reduce(
      (chain, url) => chain.then(() => loadScript(url)),
      Promise.resolve()
    );
  }
  
  // ── CSS auto-inject ───────────────────────────────────────────────────────
  
  function injectCSS(base) {
    const cssUrl = base.replace('/ure-modules', '') + '/ure.css';
    if (document.querySelector(`link[href="${cssUrl}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssUrl;
    document.head.appendChild(link);
  }
  
  // ── Boot ──────────────────────────────────────────────────────────────────
  
  const base = getBasePath();
  injectCSS(base);
  
  loadSequential(MODULES.map(n => `${base}/${n}`))
    .then(_boot)
    .catch(err => console.error('[URE] Module loading failed:', err));
  
  function _boot() {
    const M = window.UREModules;
    if (!M) { console.error('[URE] UREModules namespace missing after load'); return; }
    
    const { Engine, CONFIG } = M;
    
    // ── Public API ────────────────────────────────────────────────────────────
    
    window.URE = Object.freeze({
      _initialized: true,
      
      /**
       * Mount URE on a container and return a handle.
       *
       * @param {UREngineOptions} opts
       * @returns {EngineHandle}
       *
       * @example
       * const list = URE.mount({
       *   container : '#discover-container',
       *   data      : myJsonArray,
       *   template  : (item, lang) => `<div class="card">${item.name}</div>`,
       *   buffer    : 500,
       *   recycling : true,
       *   onItemClick: (e, item) => console.log('clicked', item),
       * });
       */
      mount: (opts) => Engine.mount(opts),
      
      /**
       * Get an existing engine instance by its container element or selector.
       * @param {Element|string} container
       * @returns {EngineHandle|null}
       */
      getInstance: (container) => Engine.getInstance(container),
      
      /**
       * Destroy every active engine instance on the page.
       * Useful during SPA route transitions.
       */
      destroyAll: () => Engine.destroyAll(),
      
      /**
       * Access raw module internals for advanced use.
       * @returns {UREModules}
       */
      modules: () => M,
      
      /**
       * Active config constants.
       * @returns {AppConfig}
       */
      config: () => CONFIG,
      
      /**
       * Log a stats snapshot for every active instance.
       * Handy for debugging from the browser console.
       */
      debug() {
        const instances = [];
        document.querySelectorAll(`[${CONFIG.DOM.CONTAINER_ATTR}]`).forEach(el => {
          const inst = Engine.getInstance(el);
          if (inst) instances.push({ el, stats: inst.stats() });
        });
        console.table(instances.map(({ el, stats }) => ({
          container: el.id || el.className || el.tagName,
          items: stats.vl.items,
          visible: stats.vl.visible,
          totalHeight: stats.vl.totalHeight,
          workerMode: stats.worker.workerMode,
        })));
        return instances;
      },
    });
    
    // Dispatch ready event so page scripts can detect URE is loaded
    try {
      window.dispatchEvent(new CustomEvent('ure:ready', { detail: { version: '1.0.0' } }));
    } catch (_) {}
  }
  
})();