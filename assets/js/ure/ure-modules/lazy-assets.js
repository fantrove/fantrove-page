// Path:    assets/js/ure/ure-modules/lazy-assets.js
// Purpose: Lazy-loads images and iframes inside rendered items.
//          Uses a sentinel IntersectionObserver to trigger fetch before the
//          element enters the viewport (respects buffer zone).
//          Adds aspect-ratio placeholders to prevent CLS.
// Used by: engine.js

(function (M) {
  'use strict';

  const { ObserverFactory } = M;

  /**
   * Create a LazyAssets instance scoped to one engine mount.
   * @param {number} [bufferPx=600] - Root margin for pre-loading
   * @returns {LazyAssets}
   */
  function createLazyAssets(bufferPx = 600) {

    // IO: fires before element enters viewport by bufferPx
    const margin = `${bufferPx}px`;
    const _io = ObserverFactory.createIO(_onIntersect, {
      rootMargin: `${margin} 0px ${margin} 0px`,
      threshold : 0,
    });

    // Track which elements we've already loaded (avoid double-fetch)
    const _loaded = new WeakSet();

    // ── Intersection callback ─────────────────────────────────────────────

    function _onIntersect(entries) {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        _io && _io.unobserve(el);
        _loadElement(el);
      }
    }

    function _loadElement(el) {
      if (_loaded.has(el)) return;
      _loaded.add(el);

      const tag = el.tagName;

      if (tag === 'IMG') {
        const ds = el.dataset;
        if (ds.src)    el.src    = ds.src;
        if (ds.srcset) el.srcset = ds.srcset;
        // Non-blocking decode: use async decoding
        el.decoding   = 'async';
        el.setAttribute('loading', 'lazy');
        el.classList.add('ure-img-loading');
        el.addEventListener('load',  () => { el.classList.remove('ure-img-loading'); el.classList.add('ure-img-loaded'); }, { once: true, passive: true });
        el.addEventListener('error', () => { el.classList.remove('ure-img-loading'); el.classList.add('ure-img-error');  }, { once: true, passive: true });
        return;
      }

      if (tag === 'IFRAME') {
        if (el.dataset.src) el.src = el.dataset.src;
        return;
      }

      // data-bg: background-image lazy load
      if (el.dataset.bg) {
        el.style.backgroundImage = `url(${el.dataset.bg})`;
      }
    }

    // ── Public API ────────────────────────────────────────────────────────

    const LazyAssets = {

      /**
       * Scan a container element and register all lazy-loadable children
       * with the IntersectionObserver.
       *
       * Supported patterns:
       *   <img data-src="...">
       *   <img data-srcset="...">
       *   <iframe data-src="...">
       *   <div data-bg="...">
       *
       * Also injects aspect-ratio style to prevent CLS when w/h attrs present.
       *
       * @param {Element} container
       */
      observe(container) {
        if (!_io || !container) return;

        // img with data-src or data-srcset
        const imgs = container.querySelectorAll('img[data-src],img[data-srcset]');
        for (const img of imgs) {
          _injectAspectRatio(img);
          _io.observe(img);
        }

        // iframes with data-src
        const iframes = container.querySelectorAll('iframe[data-src]');
        for (const iframe of iframes) {
          _io.observe(iframe);
        }

        // elements with data-bg
        const bgs = container.querySelectorAll('[data-bg]');
        for (const el of bgs) {
          _io.observe(el);
        }

        // Native lazy images: ensure decoding=async is set
        const nativeLazy = container.querySelectorAll('img[loading="lazy"]');
        for (const img of nativeLazy) {
          if (!img.decoding || img.decoding === 'auto') img.decoding = 'async';
        }
      },

      /**
       * Immediately load all lazy assets in a container (e.g. print mode).
       * @param {Element} container
       */
      loadAll(container) {
        if (!container) return;
        for (const el of container.querySelectorAll('img[data-src],img[data-srcset],iframe[data-src],[data-bg]')) {
          _loadElement(el);
        }
      },

      /** Unobserve all elements in a container (called on recycle). */
      unobserve(container) {
        if (!_io || !container) return;
        for (const el of container.querySelectorAll('img,iframe,[data-bg]')) {
          try { _io.unobserve(el); } catch (_) {}
        }
      },

      /** Full cleanup. */
      destroy() {
        ObserverFactory.disconnect(_io);
      },
    };

    return LazyAssets;
  }

  // ── CLS prevention: inject aspect-ratio from width/height attrs ──────────

  function _injectAspectRatio(img) {
    const w = img.getAttribute('width');
    const h = img.getAttribute('height');
    if (w && h && !img.style.aspectRatio) {
      img.style.aspectRatio = `${w} / ${h}`;
    }
  }

  M.createLazyAssets = createLazyAssets;

})(window.UREModules = window.UREModules || {});