/**
 * banner-engine.js  v2.0.0
 * Headless Low-Code Banner Engine — Client SDK
 * v2: content blocks (heading/text/html) + multiple buttons
 */

(function (global) {
  'use strict';

  var BANNER_ENGINE_URL = (
    global.__BANNER_ENGINE_URL ||
    'https://fantrove-banner.vercel.app'
  );

  var API_BASE   = BANNER_ENGINE_URL + '/api/public/banners';
  var CACHE_TTL  = 60 * 1000;
  var MOUNT_ATTR = 'data-banner';

  var _cache = Object.create(null);

  function _getCached(slug) {
    var entry = _cache[slug];
    if (!entry) return null;
    if (Date.now() - entry.ts < CACHE_TTL) return entry.data;
    _fetchAndRender(slug, false);
    return entry.data;
  }

  function _setCache(slug, data) {
    _cache[slug] = { data: data, ts: Date.now() };
  }

  function _fetchAndRender(slug, withRender) {
    fetch(API_BASE + '/' + slug, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        if (!json.ok || !json.data) return;
        _setCache(slug, json.data);
        if (withRender) _renderAll(slug, json.data);
        else            _rerenderAll(slug, json.data);
      })
      .catch(function (err) {
        if (withRender) console.warn('[banner-engine] fetch failed for "' + slug + '":', err.message);
      });
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────
  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _safeAttr(s) {
    return String(s || '').replace(/[^a-zA-Z0-9\-_/.?=&#:]/g, '');
  }

  // ── Simple HTML sanitizer for html-type content blocks ────────────────────
  // Belt-and-suspenders: server already sanitizes. This guards against stale cache.
  function _sanitizeHtml(raw) {
    return String(raw || '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(/javascript\s*:/gi, '');
  }

  // ── CSS injection ─────────────────────────────────────────────────────────
  var _injectedStyles = Object.create(null);

  function _injectStyles(slug, rawCss) {
    if (_injectedStyles[slug]) {
      _injectedStyles[slug].textContent = _scopeCss(slug, rawCss);
      return;
    }
    var styleEl = document.createElement('style');
    styleEl.setAttribute('data-banner-style', slug);
    styleEl.textContent = _scopeCss(slug, rawCss);
    document.head.appendChild(styleEl);
    _injectedStyles[slug] = styleEl;
  }

  function _scopeCss(slug, rawCss) {
    var clean = String(rawCss || '').replace(/<\/?style[^>]*>/gi, '');
    return clean.replace(/\.banner-custom/g, '[data-banner-mount="' + slug + '"] .banner-custom');
  }

  // ── Build content blocks ──────────────────────────────────────────────────
  function _buildContentBlocks(blocks) {
    if (!blocks || !blocks.length) return null;
    var frag = document.createDocumentFragment();

    blocks.forEach(function (block) {
      var el;
      var align = block.align || 'left';

      switch (block.type) {
        case 'heading': {
          var level = block.level || 2;
          el = document.createElement('h' + level);
          el.textContent = block.value || '';
          break;
        }
        case 'text': {
          el = document.createElement('p');
          el.textContent = block.value || '';
          break;
        }
        case 'html': {
          el = document.createElement('div');
          // Sanitize before innerHTML — server is authoritative, this is defense-in-depth
          el.innerHTML = _sanitizeHtml(block.value || '');
          break;
        }
        default:
          return;
      }

      el.style.textAlign = align;
      frag.appendChild(el);
    });

    return frag;
  }

  // ── Build multiple buttons ─────────────────────────────────────────────────
  function _buildButtons(btns) {
    if (!btns || !btns.length) return null;
    var row = document.createElement('div');
    row.className = 'be-btn-row';
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;';

    btns.forEach(function (btnCfg) {
      var a = document.createElement('a');
      a.href      = _safeAttr(btnCfg.href || '/');
      a.className = String(btnCfg.className || 'button button-secondary');
      a.target    = btnCfg.target === '_blank' ? '_blank' : '_self';
      if (a.target === '_blank') a.rel = 'noopener noreferrer';
      a.textContent = btnCfg.label || '';
      row.appendChild(a);
    });

    return row;
  }

  // Legacy single button
  function _buildButton(btnCfg) {
    return _buildButtons([btnCfg]);
  }

  // ── Image ─────────────────────────────────────────────────────────────────
  function _buildImage(imgCfg) {
    if (!imgCfg || !imgCfg.url) return null;
    var img = document.createElement('img');
    img.src     = _safeAttr(imgCfg.url);
    img.alt     = imgCfg.alt || '';
    img.loading = 'lazy';
    img.decoding= 'async';
    if (imgCfg.width)  img.width  = parseInt(imgCfg.width,  10);
    if (imgCfg.height) img.height = parseInt(imgCfg.height, 10);
    img.style.maxWidth     = '100%';
    img.style.borderRadius = '6px';
    return img;
  }

  // ── Countdown ─────────────────────────────────────────────────────────────
  var _countdownTimers = Object.create(null);

  function _buildCountdown(cfg, mountEl) {
    var wrap  = document.createElement('div');
    wrap.className = 'be-countdown';
    var cells = {};
    var units  = ['days', 'hours', 'mins', 'secs'];

    units.forEach(function (u) {
      var cell = document.createElement('span');
      cell.className = 'be-cd-cell';
      var num = document.createElement('span');
      num.className = 'be-cd-num'; num.textContent = '--';
      var lbl = document.createElement('span');
      lbl.className = 'be-cd-lbl';
      lbl.textContent = (cfg.labels && cfg.labels[u]) || u;
      cell.appendChild(num); cell.appendChild(lbl);
      wrap.appendChild(cell);
      cells[u] = num;
    });

    var endTime  = new Date(cfg.endIso).getTime();
    var mountKey = (mountEl.getAttribute(MOUNT_ATTR) || 'cd') + '_cd';
    if (_countdownTimers[mountKey]) clearInterval(_countdownTimers[mountKey]);

    function tick() {
      var diff = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
      if (diff <= 0) {
        clearInterval(_countdownTimers[mountKey]);
        units.forEach(function (u) { cells[u].textContent = '00'; });
        return;
      }
      cells.days.textContent  = String(Math.floor(diff / 86400)).padStart(2, '0');
      cells.hours.textContent = String(Math.floor((diff % 86400) / 3600)).padStart(2, '0');
      cells.mins.textContent  = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
      cells.secs.textContent  = String(diff % 60).padStart(2, '0');
    }
    tick();
    _countdownTimers[mountKey] = setInterval(tick, 1000);
    return wrap;
  }

  // ── Slider ────────────────────────────────────────────────────────────────
  var _sliderTimers = Object.create(null);

  function _buildSlider(cfg, mountEl) {
    var wrap = document.createElement('div');
    wrap.className = 'be-slider';
    wrap.style.cssText = 'position:relative;overflow:hidden;border-radius:8px;';

    var images = (cfg.images || []).filter(function (i) { return i.url; });
    if (!images.length) return null;

    var slides = []; var current = 0;
    images.forEach(function (imgCfg, idx) {
      var img = document.createElement('img');
      img.src     = _safeAttr(imgCfg.url);
      img.alt     = imgCfg.alt || '';
      img.loading = idx === 0 ? 'eager' : 'lazy';
      img.style.cssText = 'width:100%;height:auto;display:block;transition:opacity .4s ease;' +
        'position:' + (idx === 0 ? 'relative' : 'absolute') + ';top:0;left:0;opacity:' + (idx === 0 ? '1' : '0') + ';';
      wrap.appendChild(img);
      slides.push(img);
    });

    if (slides.length < 2) return wrap;
    var animation = cfg.animation === 'slide' ? 'slide' : 'fade';
    var interval  = Math.max(1000, parseInt(cfg.interval, 10) || 3000);
    var mountKey  = (mountEl.getAttribute(MOUNT_ATTR) || 'sl') + '_sl';
    if (_sliderTimers[mountKey]) clearInterval(_sliderTimers[mountKey]);

    _sliderTimers[mountKey] = setInterval(function () {
      var prev = current;
      current  = (current + 1) % slides.length;
      if (animation === 'fade') {
        slides[prev].style.opacity = '0';
        slides[current].style.opacity = '1';
        slides[current].style.position = 'relative';
        slides[prev].style.position = 'absolute';
      } else {
        slides[prev].style.transform = 'translateX(-100%)';
        slides[current].style.transform = 'translateX(0)';
        slides[current].style.opacity = '1';
        slides[current].style.position = 'relative';
        setTimeout(function () {
          slides[prev].style.opacity = '0';
          slides[prev].style.position = 'absolute';
          slides[prev].style.transform = 'translateX(0)';
        }, 420);
      }
    }, interval);

    return wrap;
  }

  // ── JS Trigger Presets ────────────────────────────────────────────────────
  var JS_TRIGGERS = {
    confetti: function (bannerEl) {
      var count = 30;
      for (var i = 0; i < count; i++) {
        (function (i) {
          var dot = document.createElement('span');
          dot.style.cssText = [
            'position:absolute','width:6px','height:6px','border-radius:50%',
            'background:' + ['#13b47f','#0eb0d5','#ff9a9e','#fad0c4','#fff'][i % 5],
            'left:' + Math.random() * 100 + '%',
            'top:' + Math.random() * 100 + '%',
            'opacity:1','pointer-events:none',
            'animation:be-confetti-fall ' + (0.6 + Math.random() * 0.8) + 's ease forwards',
            'animation-delay:' + Math.random() * 0.4 + 's',
          ].join(';');
          bannerEl.appendChild(dot);
          setTimeout(function () { try { bannerEl.removeChild(dot); } catch (e) {} }, 1400);
        })(i);
      }
      if (!document.getElementById('be-confetti-kf')) {
        var s = document.createElement('style'); s.id = 'be-confetti-kf';
        s.textContent = '@keyframes be-confetti-fall{0%{transform:translateY(0) rotate(0);opacity:1}100%{transform:translateY(60px) rotate(360deg);opacity:0}}';
        document.head.appendChild(s);
      }
    },
    shake: function (bannerEl) {
      bannerEl.style.animation = 'be-shake .4s ease';
      if (!document.getElementById('be-shake-kf')) {
        var s = document.createElement('style'); s.id = 'be-shake-kf';
        s.textContent = '@keyframes be-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}';
        document.head.appendChild(s);
      }
      bannerEl.addEventListener('mouseover', function () {
        bannerEl.style.animation = '';
        setTimeout(function () { bannerEl.style.animation = 'be-shake .4s ease'; }, 16);
      });
    },
    pulse: function (bannerEl) {
      bannerEl.style.animation = 'be-pulse 2s ease-in-out infinite';
      if (!document.getElementById('be-pulse-kf')) {
        var s = document.createElement('style'); s.id = 'be-pulse-kf';
        s.textContent = '@keyframes be-pulse{0%,100%{box-shadow:0 0 0 0 rgba(19,180,127,.4)}50%{box-shadow:0 0 0 12px rgba(19,180,127,0)}}';
        document.head.appendChild(s);
      }
    },
    scroll_reveal: function (bannerEl) {
      bannerEl.style.opacity = '0';
      bannerEl.style.transform = 'translateY(16px)';
      bannerEl.style.transition = 'opacity .5s ease, transform .5s ease';
      if (!('IntersectionObserver' in window)) {
        bannerEl.style.opacity = '1'; bannerEl.style.transform = ''; return;
      }
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            bannerEl.style.opacity = '1'; bannerEl.style.transform = 'translateY(0)';
            io.disconnect();
          }
        });
      }, { threshold: 0.15 });
      io.observe(bannerEl);
    },
    bounce: function (bannerEl) {
      bannerEl.style.animation = 'be-bounce .6s cubic-bezier(.36,.07,.19,.97)';
      if (!document.getElementById('be-bounce-kf')) {
        var s = document.createElement('style'); s.id = 'be-bounce-kf';
        s.textContent = '@keyframes be-bounce{0%,100%{transform:translateY(0)}30%{transform:translateY(-10px)}60%{transform:translateY(-5px)}}';
        document.head.appendChild(s);
      }
    },
    glow: function (bannerEl) {
      bannerEl.style.animation = 'be-glow 2s ease-in-out infinite alternate';
      if (!document.getElementById('be-glow-kf')) {
        var s = document.createElement('style'); s.id = 'be-glow-kf';
        s.textContent = '@keyframes be-glow{from{box-shadow:0 0 8px rgba(19,180,127,.3)}to{box-shadow:0 0 22px rgba(19,180,127,.75)}}';
        document.head.appendChild(s);
      }
    },
  };

  // ── Base styles ───────────────────────────────────────────────────────────
  function _injectBaseStyles() {
    if (document.getElementById('be-base-styles')) return;
    var s = document.createElement('style');
    s.id = 'be-base-styles';
    s.textContent = [
      '.be-banner{position:relative;overflow:hidden;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:12px;background:linear-gradient(90deg,#13b47f,#0eb0d5);}',
      '.be-countdown{display:flex;gap:8px;align-items:center;}',
      '.be-cd-cell{display:flex;flex-direction:column;align-items:center;background:rgba(0,0,0,.18);border-radius:6px;padding:6px 10px;min-width:44px;}',
      '.be-cd-num{font-size:22px;font-weight:700;color:#fff;line-height:1;}',
      '.be-cd-lbl{font-size:10px;color:rgba(255,255,255,.75);margin-top:2px;}',
      '.be-slider{width:100%;border-radius:8px;overflow:hidden;}',
      '.be-btn-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}',
      '.be-banner .button{display:inline-flex;align-items:center;gap:6px;padding:10px 20px;border-radius:24px;font-weight:600;font-size:14px;text-decoration:none;transition:opacity .18s;cursor:pointer;}',
      '.be-banner .button-secondary{background:transparent;border:2px solid currentColor;color:inherit;}',
      '.be-banner .button-primary{background:#fff;color:#13b47f;border:2px solid #fff;}',
      '.be-banner .banner-btn-white{background:#fff;color:#1a1a2e;border:2px solid #fff;}',
      '.be-banner .banner-btn-dark{background:#1a1a2e;color:#fff;border:2px solid #1a1a2e;}',
    ].join('');
    document.head.appendChild(s);
  }

  // ── Render one banner ─────────────────────────────────────────────────────
  function _render(mountEl, data) {
    mountEl.setAttribute('data-banner-mount', data.slug);
    if (data.bannerStyles) _injectStyles(data.slug, data.bannerStyles);

    var wrapper = document.createElement('div');
    wrapper.className = 'be-banner banner-custom';
    wrapper.setAttribute('data-be', data.slug);

    // Slider
    if (data.sliderConfig) {
      var slider = _buildSlider(data.sliderConfig, mountEl);
      if (slider) wrapper.appendChild(slider);
    }

    // Image (if no slider)
    if (!data.sliderConfig) {
      var img = _buildImage(data.imageAssets);
      if (img) wrapper.appendChild(img);
    }

    // Content blocks (v2) — heading / text / html
    if (data.content && data.content.length) {
      var contentFrag = _buildContentBlocks(data.content);
      if (contentFrag) wrapper.appendChild(contentFrag);
    }

    // Countdown
    if (data.countdownConfig) {
      var cd = _buildCountdown(data.countdownConfig, mountEl);
      if (cd) wrapper.appendChild(cd);
    }

    // Buttons — v2 multiple buttons, fall back to legacy single button
    var btns = (data.buttons && data.buttons.length) ? data.buttons
             : data.buttonConfig ? [data.buttonConfig]
             : null;
    if (btns) {
      var btnRow = _buildButtons(btns);
      if (btnRow) wrapper.appendChild(btnRow);
    }

    // JS trigger
    mountEl.innerHTML = '';
    mountEl.appendChild(wrapper);

    if (data.jsTrigger && JS_TRIGGERS[data.jsTrigger]) {
      try { JS_TRIGGERS[data.jsTrigger](wrapper); }
      catch (e) { console.warn('[banner-engine] trigger error:', e); }
    }
  }

  function _renderAll(slug, data) {
    var mounts = document.querySelectorAll('[' + MOUNT_ATTR + '="' + slug + '"]');
    for (var i = 0; i < mounts.length; i++) _render(mounts[i], data);
  }

  function _rerenderAll(slug, data) {
    var mounts = document.querySelectorAll('[data-banner-mount="' + slug + '"]');
    if (!mounts.length) return;
    var newHash = JSON.stringify(data);
    if (mounts[0].__beHash === newHash) return;
    for (var i = 0; i < mounts.length; i++) {
      mounts[i].__beHash = newHash;
      _render(mounts[i], data);
    }
  }

  function _init() {
    _injectBaseStyles();
    var mounts = document.querySelectorAll('[' + MOUNT_ATTR + ']');
    var seen   = Object.create(null);
    for (var i = 0; i < mounts.length; i++) {
      var slug = mounts[i].getAttribute(MOUNT_ATTR);
      if (!slug || seen[slug]) continue;
      seen[slug] = true;
      var cached = _getCached(slug);
      if (cached) _renderAll(slug, cached);
      else        _fetchAndRender(slug, true);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────
  global.BannerEngine = {
    version: '2.0.0',
    mount: function (selector, slug) {
      var el = typeof selector === 'string' ? document.querySelector(selector) : selector;
      if (!el) return console.warn('[banner-engine] mount: element not found:', selector);
      el.setAttribute(MOUNT_ATTR, slug);
      var cached = _getCached(slug);
      if (cached) _render(el, cached);
      else        _fetchAndRender(slug, true);
    },
    refresh: function () {
      _cache = Object.create(null);
      _init();
    },
    destroy: function () {
      Object.keys(_countdownTimers).forEach(function (k) { clearInterval(_countdownTimers[k]); });
      Object.keys(_sliderTimers).forEach(function (k)    { clearInterval(_sliderTimers[k]);    });
      _countdownTimers = Object.create(null);
      _sliderTimers    = Object.create(null);
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

})(window);