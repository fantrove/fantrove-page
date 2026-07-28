// Path:    assets/js/collection-service/collection-service.js
// Purpose: Self-loading entry point for the Collection Service.
//          Loads all collection-modules/* in dependency order, then exposes
//          the public CollectionService global API.
//
// This file follows the same pattern as the Search system (search.js)
// and NavCore (nav-core.js).
//
// HTML only needs ONE tag:
//   <script defer src="/assets/js/collection-service/collection-service.js"></script>
//
// Module load order (5 phases):
//   Phase 1 (parallel): types, config, state                   — no inter-deps
//   Phase 2 (sequential): registry, loader                     — registry before loader
//   Phase 3 (parallel): resolver, cover-generator              — need phase 1-2
//   Phase 4 (parallel): related, card-bridge                   — need phase 1-3
//   Phase 5 (parallel): seo, service                           — need everything
//
// ARCHITECTURE (aerospace-grade, NASA/SpaceX-inspired):
//   Layer 1: Data ingestion    (Loader fetches + validates + normalizes)
//   Layer 2: Index             (State builds idIndex + itemIndex)
//   Layer 3: Resolution        (Resolver converts Unicode IDs → characters)
//   Layer 4: Visual + Bridge   (CoverGenerator + CardBridge + Related)
//   Layer 5: Service           (Service orchestrates public API)
//
// Public API:
//   window.CollectionService — main service API
//   window.CollectionModules — internal namespace
//
// v1.0.0 — Initial release

(function () {
  'use strict';

  if (window.CollectionService && window.CollectionService._initialized) return;

  // ── Build ID (replaced at build time by scripts/update-version.js) ──────────
  var FV_BUILD_ID = '';

  /** Returns '?v=<buildId>' if a buildId exists, otherwise ''. */
  function _v() { return FV_BUILD_ID ? '?v=' + FV_BUILD_ID : ''; }

  // ── Phase definitions ──────────────────────────────────────────────
  var LOAD_PHASES = [
    // Phase 1: Foundation — no inter-module dependencies
    ['types.js', 'config.js', 'state.js'],
    // Phase 2: Data layer — registry must load before loader
    ['registry.js'],
    ['loader.js'],
    // Phase 3: Resolution + visual
    ['resolver.js', 'cover-generator.js'],
    // Phase 4: Intelligence + bridge
    ['related.js', 'card-bridge.js'],
    // Phase 5: SEO + Service orchestration
    ['seo.js', 'service.js'],
  ];

  // ── Path resolution ────────────────────────────────────────────────
  function getBasePath() {
    try {
      var scripts = document.querySelectorAll('script[src]');
      for (var i = scripts.length - 1; i >= 0; i--) {
        var s = scripts[i];
        var src = s.getAttribute('src') || '';
        if (/\/collection-service\/collection-service\.js(\?|$)/.test(src)) {
          return src.replace(/\/collection-service\.js(\?.*)?$/, '');
        }
      }
    } catch (e) {
      console.warn('[Collection] Path resolution fell back to default:', e);
    }
    return '/assets/js/collection-service';
  }

  // ── Script loader ──────────────────────────────────────────────────
  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url + _v();
      s.async = false;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('[Collection] Failed to load: ' + url + _v())); };
      document.head.appendChild(s);
    });
  }

  function loadPhase(names, base) {
    return Promise.all(names.map(function (n) {
      return loadScript(base + '/collection-modules/' + n);
    }));
  }

  function loadPhases(phases, base) {
    return phases.reduce(function (chain, phase) {
      return chain.then(function () { return loadPhase(phase, base); });
    }, Promise.resolve());
  }

  // ── CSS auto-inject ────────────────────────────────────────────────
  function _injectCSS(basePath) {
    try {
      var cssUrl = basePath + '/collection-service.css' + _v();
      var existing = document.querySelector('link[data-collection-service-css]');
      if (existing) return;

      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cssUrl;
      link.setAttribute('data-collection-service-css', 'true');
      document.head.appendChild(link);
    } catch (e) {
      console.warn('[Collection] CSS auto-inject failed:', e);
    }
  }

  // ── Boot ──────────────────────────────────────────────────────────
  var base = getBasePath();
  _injectCSS(base);

  loadPhases(LOAD_PHASES, base)
    .then(function () {
      _boot();
    })
    .catch(function (err) {
      console.error('[Collection] Module loading failed:', err);
    });

  function _boot() {
    var Service = window.CollectionModules && window.CollectionModules.Service;
    if (!Service) {
      console.error('[Collection] Service module missing after load');
      return;
    }

    // Mark as initialized
    Service._initialized = true;

    // Dispatch ready event
    try {
      window.dispatchEvent(new CustomEvent('collection:ready', {
        detail: { version: '1.0.0' },
      }));
    } catch (_) {}

    console.log('[Collection] Service ready v1.0.0');
  }

})();
