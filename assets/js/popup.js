// Path:    assets/js/popup.js
// Purpose: Self-loading entry point for the Popup System.
//          Loads all popup-modules/* in dependency order, then exposes
//          the public PopupSystem global API via init.js.
//
// HTML (add to any page):
//   <script defer src="/assets/js/popup.js?v=1.0.0"></script>
//
// Then anywhere on any page:
//   await PopupSystem.open({ type: 'dialog', title: 'Hello', body: '<p>World</p>' });
//   await PopupSystem.alert('Something happened!');
//   const ok = await PopupSystem.confirm('Are you sure?');
//   PopupSystem.toast('Saved successfully!');
//
// Module load order (dependency chain):
//   types.js     — JSDoc typedefs + namespace init (no runtime code)
//   config.js    — constants, presets, z-index, timing, DOM tokens
//   state.js     — instance registry, stack, groups, scroll lock, queue
//   utils.js     — DOM helpers, option merging, reduced motion detection
//   animator.js  — enter/exit animations (depends: CONFIG, Utils)
//   queue.js     — capacity queue manager (depends: CONFIG, State)
//   renderer.js  — DOM structure builder (depends: CONFIG, State, Utils)
//   overlay.js   — overlay/escape/click-outside listeners (depends: CONFIG, State, Utils)
//   theme.js     — theme token application (depends: tokens.css vars)
//   a11y.js      — focus trap, auto-focus, inert siblings (depends: CONFIG, Utils)
//   engine.js    — main orchestrator (depends: ALL above)
//   init.js      — creates frozen window.PopupSystem global

(function() {
  'use strict';
  
  if (window.PopupSystem?._initialized) return;
  
  // ── Build ID (replaced at build time by scripts/update-version.js) ──────────
  // WHY: popup-modules/*.js + popup.css ไม่ได้อยู่ใน HTML โดยตรง
  //   จึงไม่ถูก regex ?v= ของ update-version.js จับได้
  //   FV_BUILD_ID ถูก inject buildId จริงตอน build → ใช้ต่อ ?v= ท้าย URL
  //   dev mode: ค่า '' → _v() คืน '' → URL ไม่มี ?v= → browser cache ปกติ
  var FV_BUILD_ID = '';
  
  /** คืน query string '?v=<buildId>' ถ้าไม่มี buildId คืน '' */
  function _v() { return FV_BUILD_ID ? '?v=' + FV_BUILD_ID : ''; }
  
  // ── Module list in load order ─────────────────────────────────────────────
  
  var MODULES = [
    'types.js',
    'config.js',
    'state.js',
    'utils.js',
    'animator.js',
    'queue.js',
    'renderer.js',
    'overlay.js',
    'theme.js',
    'a11y.js',
    'engine.js',
    'init.js',
  ];
  
  // ── Resolve base path ────────────────────────────────────────────────────
  
  function getBasePath() {
    try {
      var scripts = document.querySelectorAll('script[src]');
      for (var i = 0; i < scripts.length; i++) {
        var s = scripts[i];
        var src = s.getAttribute('src') || '';
        var clean = src.split('?')[0].split('#')[0];
        if (/\/popup\.js$/.test(clean)) {
          return clean.replace(/\/popup\.js$/, '/popup-modules');
        }
      }
    } catch (_) {}
    return '/assets/js/popup-modules';
  }
  
  // ── Script loader (sequential — same pattern as ure.js) ───────────────────
  
  function loadScript(url) {
    return new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      // WHY _v(): ต่อ ?v=<buildId> เพื่อ cache-bust popup-modules ที่ไม่ได้อยู่ใน HTML
      s.src = url + _v();
      s.async = false;
      s.onload = function() { resolve(); };
      s.onerror = function() { reject(new Error('[PopupSystem] Failed to load: ' + url + _v())); };
      document.head.appendChild(s);
    });
  }
  
  function loadSequential(urls) {
    return urls.reduce(function(chain, url) {
      return chain.then(function() { return loadScript(url); });
    }, Promise.resolve());
  }
  
  // ── CSS auto-inject (idempotent) ─────────────────────────────────────────
  
  function injectCSS(base) {
    var cssUrl = base.replace('/popup-modules', '') + '/../css/popup.css';
    // Normalize path
    cssUrl = cssUrl.replace(/\/+$/, '');
    // WHY _v(): ต่อ ?v=<buildId> เพื่อ cache-bust popup.css ที่ไม่ได้อยู่ใน HTML
    var cssUrlVersioned = cssUrl + _v();
    if (document.querySelector('link[href*="popup.css"]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssUrlVersioned;
    document.head.appendChild(link);
  }
  
  // ── Boot ──────────────────────────────────────────────────────────────────
  
  var base = getBasePath();
  injectCSS(base);
  
  loadSequential(MODULES.map(function(n) { return base + '/' + n; }))
    .then(function() {
      var M = window.PopupModules;
      if (!M) {
        console.error('[PopupSystem] PopupModules namespace missing after load');
        return;
      }
      // init.js already ran and created window.PopupSystem
      if (!window.PopupSystem) {
        console.error('[PopupSystem] init.js did not create window.PopupSystem');
      }
    })
    .catch(function(err) {
      console.error('[PopupSystem] Module loading failed:', err);
    });
  
})();