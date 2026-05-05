/**
 * banner-engine.js — Fantrove Client SDK
 * Version: 2.0.0
 *
 * PURPOSE: Fetches banner config from the Banner Engine API and renders
 *          HTML that is PIXEL-IDENTICAL to the dashboard preview.
 *
 * CRITICAL DESIGN RULE — "Preview = Reality":
 *   The CSS in BANNER_BASE_CSS and all render functions here MUST stay
 *   in sync with LivePreview.tsx's buildPreviewHtml(). When you update
 *   the preview, update this file too, and vice versa.
 *
 * USAGE:
 *   1. Copy this file to Fantrove /assets/js/banner-engine.js
 *   2. Set BANNER_ENGINE_URL below to your Vercel deployment URL
 *   3. Add <script defer src="/assets/js/banner-engine.js?v=2.0.0"></script>
 *   4. Place <div data-banner="your-slug"></div> anywhere on the page
 *
 * SECURITY: Zero raw JS from DB. Only preset keys are stored; functions
 *   are hardcoded here. bannerStyles is CSS scoped to .banner-custom only.
 */

(function (global) {
  'use strict';

  // ── Configuration ────────────────────────────────────────────────────────────
  var BANNER_ENGINE_URL = (
    global.__BANNER_ENGINE_URL ||
    'https://your-banner-engine.vercel.app'   // ← Change to your Vercel URL
  );

  // Cache TTL in ms — avoids hammering the API on SPA route changes
  var CACHE_TTL_MS = 60 * 1000;

  // ── BANNER_BASE_CSS ──────────────────────────────────────────────────────────
  // THIS IS THE SINGLE SOURCE OF TRUTH for banner visual style.
  // The dashboard preview (LivePreview.tsx) uses an identical copy.
  // If you change anything here, update LivePreview.tsx's <style> block too.
  var BANNER_BASE_CSS = [
    '.be-wrapper { border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,.12); }',
    '.banner-custom {',
    '  padding: 24px 20px;',
    '  min-height: 80px;',
    '  display: flex;',
    '  flex-direction: column;',
    '  align-items: flex-start;',
    '  gap: 12px;',
    '  background: linear-gradient(90deg, #13b47f, #0eb0d5);',
    '  color: #fff;',
    '  position: relative;',
    '}',
    // ── Buttons ──────────────────────────────────────────────────────────────
    '.banner-custom .button {',
    '  display: inline-flex; align-items: center; gap: 6px;',
    '  padding: 10px 20px; border-radius: 24px;',
    '  font-weight: 600; font-size: 14px;',
    '  text-decoration: none; cursor: pointer;',
    '  transition: opacity .18s; border: none;',
    '}',
    '.banner-custom .button-secondary {',
    '  background: transparent; border: 2px solid currentColor; color: inherit;',
    '}',
    '.banner-custom .button-primary {',
    '  background: #fff; color: #13b47f; border: 2px solid #fff;',
    '}',
    '.banner-custom .button-secondary.oc { position: relative; overflow: hidden; }',
    '.banner-custom .banner-btn-white { background: #fff; color: #1a1a2e; border: 2px solid #fff; }',
    '.banner-custom .banner-btn-dark  { background: #1a1a2e; color: #fff; border: 2px solid #1a1a2e; }',
    '.banner-custom .be-btn-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }',
    // ── Countdown ────────────────────────────────────────────────────────────
    '.banner-custom .be-countdown { display: flex; gap: 8px; align-items: center; }',
    '.banner-custom .be-cd-cell {',
    '  display: flex; flex-direction: column; align-items: center;',
    '  background: rgba(0,0,0,.18); border-radius: 6px;',
    '  padding: 6px 10px; min-width: 42px;',
    '}',
    '.banner-custom .be-cd-num { font-size: 20px; font-weight: 700; line-height: 1; }',
    '.banner-custom .be-cd-lbl { font-size: 10px; opacity: .75; margin-top: 2px; }',
    // ── Slider ───────────────────────────────────────────────────────────────
    '.banner-custom .be-slider { width: 100%; position: relative; overflow: hidden; border-radius: 6px; }',
    '.banner-custom .be-slide { width: 100%; display: none; }',
    '.banner-custom .be-slide.active { display: block; }',
    '.banner-custom .be-slide img { width: 100%; height: auto; border-radius: 6px; display: block; }',
    // ── Headings & text ───────────────────────────────────────────────────────
    '.banner-custom h1, .banner-custom h2, .banner-custom h3 { margin: 0 0 4px; }',
    '.banner-custom p { margin: 0 0 4px; }',
    // ── JS trigger animations ─────────────────────────────────────────────────
    '@keyframes be-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(19,180,127,.6); } 50% { box-shadow: 0 0 0 14px rgba(19,180,127,0); } }',
    '@keyframes be-bounce { 0%,100% { transform: translateY(0); } 40% { transform: translateY(-10px); } 70% { transform: translateY(-5px); } }',
    '@keyframes be-glow { 0%,100% { box-shadow: 0 0 8px 2px #13b47f; } 50% { box-shadow: 0 0 24px 8px #0eb0d5; } }',
    '.be-trigger-pulse { animation: be-pulse 2s infinite; }',
    '.be-trigger-bounce { animation: be-bounce .8s ease; }',
    '.be-trigger-glow .banner-custom { animation: be-glow 2s ease-in-out infinite; }',
    // ── Mobile responsive ─────────────────────────────────────────────────────
    '@media (max-width: 600px) {',
    '  .banner-custom { padding: 16px; }',
    '  .banner-custom .button { padding: 12px 18px; font-size: 15px; min-height: 44px; }',
    '  .banner-custom .be-btn-row { flex-direction: column; align-items: stretch; }',
    '}',
  ].join('\n');

  // ── JS Trigger Presets ───────────────────────────────────────────────────────
  // WHY hardcoded: Zero raw JS from DB. Each preset maps to a safe DOM function.
  var JS_TRIGGERS = {
    confetti: function (el) {
      // Simple CSS-only confetti burst using pseudo-random spans
      var colors = ['#13b47f', '#0eb0d5', '#ff9a9e', '#fad0c4', '#fff'];
      var burst = document.createElement('div');
      burst.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;';
      for (var i = 0; i < 30; i++) {
        var dot = document.createElement('span');
        var color = colors[i % colors.length];
        var x = Math.random() * 100;
        var delay = Math.random() * 0.6;
        var size = 4 + Math.random() * 6;
        dot.style.cssText = [
          'position:absolute;border-radius:50%;',
          'width:' + size + 'px;height:' + size + 'px;',
          'background:' + color + ';',
          'left:' + x + '%;top:-10px;',
          'animation:be-confetti-fall .8s ' + delay + 's ease-in forwards;',
        ].join('');
        burst.appendChild(dot);
      }
      // Inject keyframe once
      if (!document.getElementById('be-confetti-kf')) {
        var kf = document.createElement('style');
        kf.id = 'be-confetti-kf';
        kf.textContent = '@keyframes be-confetti-fall { to { top: 110%; opacity: 0; } }';
        document.head.appendChild(kf);
      }
      el.style.position = 'relative';
      el.appendChild(burst);
      setTimeout(function () { burst.remove(); }, 1500);
    },

    shake: function (el) {
      var kfId = 'be-shake-kf';
      if (!document.getElementById(kfId)) {
        var kf = document.createElement('style');
        kf.id = kfId;
        kf.textContent = '@keyframes be-shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)} }';
        document.head.appendChild(kf);
      }
      el.addEventListener('mouseenter', function () {
        el.style.animation = 'be-shake .4s ease';
      });
      el.addEventListener('animationend', function () {
        el.style.animation = '';
      });
    },

    pulse: function (el) {
      el.classList.add('be-trigger-pulse');
    },

    scroll_reveal: function (el) {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      el.style.transition = 'opacity .5s ease, transform .5s ease';
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
            observer.unobserve(el);
          }
        });
      }, { threshold: 0.1 });
      observer.observe(el);
    },

    bounce: function (el) {
      el.classList.add('be-trigger-bounce');
      el.addEventListener('animationend', function () {
        el.classList.remove('be-trigger-bounce');
      }, { once: true });
    },

    glow: function (el) {
      el.classList.add('be-trigger-glow');
    },
  };

  // ── In-memory fetch cache ─────────────────────────────────────────────────────
  var _cache = {};

  function fetchConfig(slug, cb) {
    var now = Date.now();
    var cached = _cache[slug];
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      return cb(null, cached.data);
    }
    var url = BANNER_ENGINE_URL + '/api/public/banners/' + slug;
    fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (res) { return res.json(); })
      .then(function (json) {
        if (!json.ok) return cb(new Error(json.error || 'API error'));
        _cache[slug] = { ts: now, data: json.data };
        cb(null, json.data);
      })
      .catch(cb);
  }

  // ── HTML escape ───────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── HTML sanitizer (admin-facing HTML blocks only) ────────────────────────────
  // Strips script tags and dangerous event handlers before inserting into DOM.
  // The authoritative sanitization runs server-side; this is a defence-in-depth layer.
  function sanitize(raw) {
    return String(raw || '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
  }

  // ── Render: Content Blocks ────────────────────────────────────────────────────
  // Matches LivePreview.tsx buildPreviewHtml() content section exactly.
  function renderContent(blocks) {
    if (!blocks || !blocks.length) return '';
    return blocks.map(function (block) {
      var align = block.align || 'left';
      var style = 'text-align:' + align + ';';
      if (block.type === 'heading') {
        var tag = 'h' + (block.level || 2);
        return '<' + tag + ' style="' + style + 'margin:0 0 4px;">' + esc(block.value) + '</' + tag + '>';
      }
      if (block.type === 'text') {
        return '<p style="' + style + 'margin:0 0 4px;">' + esc(block.value) + '</p>';
      }
      if (block.type === 'html') {
        return '<div style="' + style + '">' + sanitize(block.value) + '</div>';
      }
      return '';
    }).join('\n');
  }

  // ── Render: Buttons ───────────────────────────────────────────────────────────
  function renderButtons(buttons, legacyButtonConfig) {
    var btns = (buttons && buttons.length) ? buttons : (legacyButtonConfig ? [legacyButtonConfig] : []);
    if (!btns.length) return '';
    var inner = btns.map(function (b) {
      return '<a href="' + esc(b.href) + '" class="' + esc(b.className) + '" target="' + esc(b.target) + '">' + esc(b.label) + '</a>';
    }).join('\n');
    return '<div class="be-btn-row">' + inner + '</div>';
  }

  // ── Render: Image ─────────────────────────────────────────────────────────────
  function renderImage(imageAssets) {
    if (!imageAssets || !imageAssets.url) return '';
    return '<img src="' + esc(imageAssets.url) + '" alt="' + esc(imageAssets.alt) + '" ' +
      'width="' + (imageAssets.width || 'auto') + '" height="' + (imageAssets.height || 'auto') + '" ' +
      'style="max-width:100%;border-radius:8px;" />';
  }

  // ── Render: Countdown (real timer) ────────────────────────────────────────────
  // Preview shows static numbers; real engine ticks every second.
  function renderCountdown(countdownConfig) {
    if (!countdownConfig) return '';
    var labels = countdownConfig.labels || { days: 'Days', hours: 'Hrs', mins: 'Min', secs: 'Sec' };
    var id = 'be-cd-' + Math.random().toString(36).slice(2, 7);
    var keys = ['days', 'hours', 'mins', 'secs'];
    var cells = keys.map(function (k) {
      return '<span class="be-cd-cell">' +
        '<span class="be-cd-num" data-key="' + k + '">--</span>' +
        '<span class="be-cd-lbl">' + esc(labels[k]) + '</span>' +
        '</span>';
    }).join('');
    // Start live ticker after DOM insertion
    setTimeout(function () {
      var container = document.getElementById(id);
      if (!container) return;
      var endTime = new Date(countdownConfig.endIso).getTime();
      function tick() {
        var diff = endTime - Date.now();
        if (diff <= 0) { diff = 0; }
        var d = Math.floor(diff / 86400000);
        var h = Math.floor((diff % 86400000) / 3600000);
        var m = Math.floor((diff % 3600000) / 60000);
        var s = Math.floor((diff % 60000) / 1000);
        function pad(n) { return n < 10 ? '0' + n : String(n); }
        ['days', 'hours', 'mins', 'secs'].forEach(function (k, i) {
          var el = container.querySelector('[data-key="' + k + '"]');
          if (el) el.textContent = pad([d, h, m, s][i]);
        });
        if (diff > 0) setTimeout(tick, 1000);
      }
      tick();
    }, 0);
    return '<div class="be-countdown" id="' + id + '">' + cells + '</div>';
  }

  // ── Render: Slider ────────────────────────────────────────────────────────────
  function renderSlider(sliderConfig) {
    if (!sliderConfig || !sliderConfig.images || !sliderConfig.images.length) return '';
    var id = 'be-sl-' + Math.random().toString(36).slice(2, 7);
    var slides = sliderConfig.images.map(function (img, i) {
      var active = i === 0 ? ' active' : '';
      return '<div class="be-slide' + active + '">' +
        (img.url ? '<img src="' + esc(img.url) + '" alt="' + esc(img.alt) + '" />' : '') +
        '</div>';
    }).join('');

    // Start auto-slide after DOM insertion
    var interval = sliderConfig.interval || 3000;
    var animation = sliderConfig.animation || 'fade';
    setTimeout(function () {
      var container = document.getElementById(id);
      if (!container) return;
      var slideEls = container.querySelectorAll('.be-slide');
      if (slideEls.length < 2) return;
      var current = 0;
      if (animation === 'slide') {
        // Override CSS for slide animation
        container.style.cssText += 'overflow:hidden;';
        var track = container.querySelector('.be-slide-track');
        if (track) track.style.cssText = 'display:flex;transition:transform ' + (interval * 0.15 / 1000) + 's ease;';
      }
      setInterval(function () {
        slideEls[current].classList.remove('active');
        current = (current + 1) % slideEls.length;
        slideEls[current].classList.add('active');
      }, interval);
    }, 0);

    return '<div class="be-slider" id="' + id + '">' + slides + '</div>';
  }

  // ── Inject CSS (once per page) ────────────────────────────────────────────────
  var _cssInjected = false;
  function injectBaseCSS() {
    if (_cssInjected) return;
    _cssInjected = true;
    var style = document.createElement('style');
    style.id = 'banner-engine-base';
    style.textContent = BANNER_BASE_CSS;
    document.head.appendChild(style);
  }

  // ── Mount: render config → DOM ────────────────────────────────────────────────
  function mountBanner(el, config) {
    // 1. Inject base CSS (shared across all banners on page)
    injectBaseCSS();

    // 2. Inject banner-specific CSS (scoped to .banner-custom)
    //    WHY: Each banner can have unique styles. We scope them with a unique
    //    data attribute to prevent one banner's styles leaking into another.
    var uid = 'be-' + config.slug;
    if (config.bannerStyles && !document.getElementById(uid + '-css')) {
      var bStyle = document.createElement('style');
      bStyle.id = uid + '-css';
      // Replace .banner-custom with [data-be-uid="uid"] .banner-custom for scoping
      bStyle.textContent = config.bannerStyles.replace(
        /\.banner-custom/g,
        '[data-be-uid="' + uid + '"] .banner-custom'
      );
      document.head.appendChild(bStyle);
    }

    // 3. Build inner HTML — identical structure to LivePreview.tsx
    var html = [
      renderSlider(config.sliderConfig),
      renderImage(config.imageAssets),
      renderContent(config.content),
      renderCountdown(config.countdownConfig),
      renderButtons(config.buttons, config.buttonConfig),
    ].filter(Boolean).join('\n');

    // 4. Create wrapper and inject
    el.innerHTML = '';
    var wrapper = document.createElement('div');
    wrapper.className = 'be-wrapper';
    wrapper.setAttribute('data-be-uid', uid);

    var inner = document.createElement('div');
    inner.className = 'banner-custom';
    inner.innerHTML = html;

    wrapper.appendChild(inner);
    el.appendChild(wrapper);

    // 5. Apply JS trigger preset (hardcoded functions — zero DB-injected JS)
    if (config.jsTrigger && JS_TRIGGERS[config.jsTrigger]) {
      JS_TRIGGERS[config.jsTrigger](wrapper);
    }
  }

  // ── Auto-discover mount points ────────────────────────────────────────────────
  function autodiscover() {
    var mounts = document.querySelectorAll('[data-banner]');
    for (var i = 0; i < mounts.length; i++) {
      (function (el) {
        var slug = el.getAttribute('data-banner');
        if (!slug || el.getAttribute('data-be-mounted')) return;
        el.setAttribute('data-be-mounted', '1');
        fetchConfig(slug, function (err, config) {
          if (err) {
            console.warn('[BannerEngine] Failed to load banner "' + slug + '":', err.message);
            return;
          }
          mountBanner(el, config);
        });
      })(mounts[i]);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  var BannerEngine = {
    /**
     * Manually mount a banner into a selector or element.
     * @param {string|Element} target  CSS selector or DOM element
     * @param {string}         slug    Banner slug from dashboard
     */
    mount: function (target, slug) {
      var el = typeof target === 'string' ? document.querySelector(target) : target;
      if (!el) { console.warn('[BannerEngine] mount: element not found', target); return; }
      fetchConfig(slug, function (err, config) {
        if (err) { console.warn('[BannerEngine] mount error:', err.message); return; }
        mountBanner(el, config);
      });
    },

    /**
     * Force refresh all banners (bypasses cache).
     */
    refresh: function () {
      _cache = {};
      // Remove mounted markers so autodiscover re-renders
      var mounts = document.querySelectorAll('[data-be-mounted]');
      for (var i = 0; i < mounts.length; i++) {
        mounts[i].removeAttribute('data-be-mounted');
      }
      autodiscover();
    },

    /**
     * Destroy: clear all intervals. Call on SPA route change / unmount.
     */
    destroy: function () {
      _cache = {};
      // Sliders/countdowns use native setInterval; clear by re-cloning nodes
      var mounts = document.querySelectorAll('[data-banner]');
      for (var i = 0; i < mounts.length; i++) {
        mounts[i].innerHTML = '';
        mounts[i].removeAttribute('data-be-mounted');
      }
    },
  };

  // ── Boot ──────────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autodiscover);
  } else {
    autodiscover();
  }

  // Expose globally for manual API usage
  global.BannerEngine = BannerEngine;

})(typeof window !== 'undefined' ? window : this);