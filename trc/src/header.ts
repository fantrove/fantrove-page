// header.ts (bootstrap ESM -> emitted JS should be same runtime behavior)
// Keep as an IIFE-like bootstrap that resolves module base and imports modules dynamically.

(async function() {
  function detectModuleBase() {
    try {
      if (document.currentScript && (document.currentScript as HTMLScriptElement).src) {
        return (document.currentScript as HTMLScriptElement).src.replace(/\/[^\/?#]*$/, '/header-modules/');
      }
      const scripts = document.getElementsByTagName('script');
      for (let i = 0; i < scripts.length; i++) {
        const s = scripts[i];
        if (!s.src) continue;
        try {
          if (/\/header(?:\.min)?\.js(\?|#|$)/.test(s.src)) {
            return s.src.replace(/\/[^\/?#]*$/, '/header-modules/');
          }
        } catch (e) {}
      }
    } catch (e) {}
    return '/assets/js/header-modules/';
  }
  
  const MODULE_BASE = detectModuleBase();
  const RUNTIME_MODULE = 'runtime/registerOptimizations.js';
  const MODULES = [
    'overlay.js',
    'utils.js',
    'dataManager.js',
    'contentLoadingManager.js',
    'contentManager.js',
    'managers.js',
    'unifiedCopyToClipboard.js',
    'init.js'
  ];
  
  async function loadAll() {
    try {
      try {
        await import(MODULE_BASE + RUNTIME_MODULE).then((rmod: any) => {
          try {
            if (rmod && typeof rmod.default === 'function') {
              try { rmod.default(window); } catch (e) {}
            }
          } catch (e) {}
        }).catch(() => {});
      } catch (e) {}
      
      const imports = MODULES.map(m => import(MODULE_BASE + m));
      const mods = await Promise.all(imports);
      
      const initMod = mods.find((m: any) => m && typeof m.init === 'function');
      const init = initMod || mods[mods.length - 1];
      if (init && typeof init.init === 'function') {
        await init.init();
      } else if (typeof(window as any).headerV2_initializeApp === 'function') {
        await (window as any).headerV2_initializeApp();
      }
    } catch (err) {
      console.error('header.min.js bootstrap error', err);
      
      try {
        const diag = await Promise.all(MODULES.map(async (m) => {
          const url = MODULE_BASE + m;
          try {
            const resp = await fetch(url, { cache: 'no-store' });
            const text = await resp.text();
            return {
              url,
              status: resp.status,
              ok: resp.ok,
              contentSnippet: (typeof text === 'string') ? text.slice(0, 400) : ''
            };
          } catch (fetchErr) {
            return { url, fetchError: String(fetchErr) };
          }
        }));
        console.error('Module diagnostics:', diag);
      } catch (diagErr) {
        console.error('Diagnostics failed', diagErr);
      }
      
      try {
        if ((window as any)._headerV2_utils && (window as any)._headerV2_utils.showNotification) {
          (window as any)._headerV2_utils.showNotification('โหลด header modules ไม่สำเร็จ', 'error');
        }
      } catch {}
    } finally {
      try {
        if (typeof(window as any).__removeInstantLoadingOverlay === 'function' && (window as any).__instantLoadingOverlayShown) {
          (window as any).__removeInstantLoadingOverlay();
          (window as any).__instantLoadingOverlayShown = false;
        }
      } catch {}
    }
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAll);
  } else {
    loadAll();
  }
})();