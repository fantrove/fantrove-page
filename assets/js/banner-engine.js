/**
 * banner-engine.js  v3.0.0 (scoped CSS patch)
 * v3: Multi-language (reads selectedLang from localStorage like search system)
 *     + HTML mode (customHtml per lang) + data-i18n substitution
 *
 * NOTE:
 * - This patched version scopes base CSS to the banner container (.be-banner)
 *   to avoid leaking rules like ".button" into the global page styles.
 */
(function (global) {
  'use strict';

  var BANNER_ENGINE_URL = (
    global.__BANNER_ENGINE_URL || 'https://fantrove-banner.vercel.app'
  );
  var API_BASE   = BANNER_ENGINE_URL + '/api/public/banners';
  var CACHE_TTL  = 60 * 1000;
  var MOUNT_ATTR = 'data-banner';

  // ── Language (mirrors search system getLang()) ─────────────────────────────
  function _getLang() {
    try {
      return localStorage.getItem('selectedLang') ||
        (navigator.language && navigator.language.startsWith('th') ? 'th' : 'en');
    } catch { return 'en'; }
  }

  // ── Cache ───────────────────────────────────────────────────────────────
  var _cache = Object.create(null);
  function _getCached(slug) {
    var entry = _cache[slug];
    if (!entry) return null;
    if (Date.now() - entry.ts < CACHE_TTL) return entry.data;
    _fetchAndRender(slug, false);
    return entry.data;
  }
  function _setCache(slug, data) { _cache[slug] = { data: data, ts: Date.now() }; }

  // ── Fetch ───────────────────────────────────────────────────────────────
  function _fetchAndRender(slug, withRender) {
    fetch(API_BASE + '/' + slug, { method:'GET', headers:{'Accept':'application/json'}, cache:'no-store' })
      .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(function(json) {
        if (!json.ok || !json.data) return;
        _setCache(slug, json.data);
        if (withRender) _renderAll(slug, json.data);
        else            _rerenderAll(slug, json.data);
      })
      .catch(function(err) {
        if (withRender) console.warn('[banner-engine] fetch failed "' + slug + '":', err.message);
      });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  function _esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _safeAttr(s) { return String(s||'').replace(/[^a-zA-Z0-9\-_/.?=&#:%]/g,''); }
  function _sanitizeHtml(raw) {
    return String(raw||'')
      .replace(/<script[\s\S]*?<\/script>/gi,'')
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi,'')
      .replace(/javascript\s*:/gi,'javascript-blocked:');
  }

  // ── LangValue resolver (mirrors resolveLang() in banner.ts) ──────────────
  function _resolve(val, lang) {
    if (!val) return '';
    if (typeof val === 'string') return val;
    return val[lang] || val['en'] || Object.values(val)[0] || '';
  }

  // ── data-i18n substitution ───────────────────────────────────────────────
  function _applyI18n(bannerEl, translations, lang) {
    if (!translations || !lang) return;
    var langMap = translations[lang] || translations['en'] || {};
    bannerEl.querySelectorAll('[data-i18n]').forEach(function(el) {
      var key = el.getAttribute('data-i18n');
      if (key && langMap[key] !== undefined) el.textContent = langMap[key];
    });
  }

  // ── CSS injection (SCOPED) ───────────────────────────────────────────────
  var _injectedStyles = Object.create(null);

  function _injectBaseStyles() {
    if (document.getElementById('be-base')) return;
    var s = document.createElement('style');
    s.id = 'be-base';
    // SCOPED base CSS: selectors that target elements inside the banner are prefixed with ".be-banner "
    s.textContent = [
      /* Container */
      '.be-banner{position:relative;overflow:hidden;border-radius:16px;padding:28px 24px;display:flex;flex-direction:column;gap:14px;background:linear-gradient(135deg,#13b47f 0%,#0eb0d5 100%);color:#fff;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,"Helvetica Neue",Arial,sans-serif;}',
      '.be-banner h1,.be-banner h2,.be-banner h3{margin:0;line-height:1.2;font-weight:700;}',
      '.be-banner h1{font-size:clamp(22px,4vw,36px);}',
      '.be-banner h2{font-size:clamp(18px,3vw,28px);}',
      '.be-banner h3{font-size:clamp(15px,2.5vw,22px);}',
      '.be-banner p{margin:0;font-size:14px;line-height:1.6;opacity:.95;}',

      /* Button row and buttons (SCOPED) */
      '.be-banner .be-btn-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;}',
      '.be-banner .button{display:inline-flex;align-items:center;gap:6px;padding:10px 22px;border-radius:999px;font-weight:600;font-size:14px;text-decoration:none;border:2px solid transparent;cursor:pointer;transition:all .12s ease;background:transparent;color:inherit;}',
      '.be-banner .button:hover{opacity:.92;transform:translateY(-1px);}',

      '.be-banner .button-secondary{background:transparent;border-color:currentColor;color:inherit;}',
      '.be-banner .button-primary{background:#fff;color:#13b47f;border-color:#fff;}',
      '.be-banner .banner-btn-white{background:#fff;color:#1a1a2e;border-color:#fff;}',
      '.be-banner .banner-btn-dark{background:#1a1a2e;color:#fff;border-color:#1a1a2e;}',

      /* Countdown */
      '.be-banner .be-countdown{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}',
      '.be-banner .be-cd-cell{display:flex;flex-direction:column;align-items:center;background:rgba(0,0,0,.12);border-radius:8px;padding:8px 12px;min-width:48px;}',
      '.be-banner .be-cd-num{font-size:24px;font-weight:700;line-height:1;}',
      '.be-banner .be-cd-lbl{font-size:10px;opacity:.85;margin-top:3px;letter-spacing:.05em;}',

      /* Image and slider */
      '.be-banner .be-image{max-width:100%;border-radius:8px;display:block;}',
      '.be-banner .be-slider{position:relative;overflow:hidden;border-radius:10px;width:100%;}.be-banner .be-slider img{width:100%;height:auto;display:block;}',

      /* Responsive tweaks */
      '@media(max-width:480px){.be-banner{padding:20px 16px;border-radius:12px;}.be-banner .button{padding:12px 20px;font-size:15px;width:100%;justify-content:center;}.be-banner .be-btn-row{flex-direction:column;}.be-banner .be-cd-num{font-size:20px;}}'
    ].join('');
    document.head.appendChild(s);
  }

  function _injectUserStyles(slug, rawCss) {
    var clean  = String(rawCss||'').replace(/<\/?style[^>]*>/gi,'');
    // Replace any occurrence of .banner-custom in user CSS with an explicit attribute selector scoped to mount slug
    // This preserves user's intention for ".banner-custom" while scoping to the specific mounted banner.
    var scoped = clean.replace(/\.banner-custom/g,'[data-banner-mount="'+slug+'"] .be-banner');
    if (_injectedStyles[slug]) { _injectedStyles[slug].textContent = scoped; return; }
    var s = document.createElement('style');
    s.setAttribute('data-be-style', slug);
    s.textContent = scoped;
    document.head.appendChild(s);
    _injectedStyles[slug] = s;
  }

  // ── buildInnerHtml — MIRROR of buildBannerInnerHtml() in bannerTemplate.ts ─
  function _buildInnerHtml(data, lang) {
    // HTML mode: use customHtml[lang] or fallback
    if (data.editorMode === 'html') {
      var html = (data.customHtml && (data.customHtml[lang] || data.customHtml['en'])) || '';
      return _sanitizeHtml(html);
    }

    // Builder mode
    var parts = [];

    // Slider
    if (data.sliderConfig && data.sliderConfig.images && data.sliderConfig.images.length) {
      var imgs = data.sliderConfig.images.filter(function(i){return i.url;}).map(function(img, idx){
        return '<img src="'+_safeAttr(img.url)+'" alt="'+_esc(_resolve(img.alt,lang))+'" class="be-slide-img" loading="'+(idx===0?'eager':'lazy')+'" style="display:'+(idx===0?'block':'none')+';" />';
      }).join('\n');
      parts.push('<div class="be-slider" data-interval="'+_esc(data.sliderConfig.interval)+'" data-animation="'+_esc(data.sliderConfig.animation)+'">'+imgs+'</div>');
    }

    // Image (no slider)
    if (!data.sliderConfig && data.imageAssets && data.imageAssets.url) {
      var img = data.imageAssets;
      parts.push('<img src="'+_safeAttr(img.url)+'" alt="'+_esc(img.alt)+'" class="be-image"'+(img.width?' width="'+img.width+'"':'')+(img.height?' height="'+img.height+'"':'')+' />');
    }

    // Content blocks — i18n via _resolve()
    if (data.content && data.content.length) {
      data.content.forEach(function(block) {
        var text  = _resolve(block.value, lang);
        var align = 'text-align:'+(block.align||'left')+';';
        if (block.type === 'heading') {
          var tag = 'h'+(block.level||2);
          parts.push('<'+tag+' style="'+align+'">'+_esc(text)+'</'+tag+'>');
        } else if (block.type === 'text') {
          parts.push('<p style="'+align+'">'+_esc(text)+'</p>');
        } else if (block.type === 'html') {
          parts.push('<div style="'+align+'">'+_sanitizeHtml(text)+'</div>');
        }
      });
    }

    // Countdown — i18n labels
    if (data.countdownConfig) {
      var lbl  = data.countdownConfig.labels || {};
      var units = ['days','hours','mins','secs'];
      var cells = units.map(function(u){
        return '<span class="be-cd-cell"><span class="be-cd-num" data-cd-unit="'+u+'">--</span><span class="be-cd-lbl">'+_esc(_resolve(lbl[u]||u,lang))+'</span></span>';
      }).join('');
      parts.push('<div class="be-countdown" data-end-iso="'+_esc(data.countdownConfig.endIso)+'">'+cells+'</div>');
    }

    // Buttons — i18n labels, v2 array + legacy fallback
    var btns = (data.buttons && data.buttons.length) ? data.buttons : data.buttonConfig ? [data.buttonConfig] : [];
    if (btns.length) {
      var btnHtml = btns.map(function(b){
        var label  = _resolve(b.label, lang);
        var target = b.target === '_blank' ? '_blank' : '_self';
        var rel    = target === '_blank' ? ' rel="noopener noreferrer"' : '';
        // Ensure className is escaped and will be scoped by injected CSS (.be-banner .button ...)
        return '<a href="'+_safeAttr(b.href)+'" class="'+_esc(b.className || 'button')+'" target="'+target+'"'+rel+'>'+_esc(label)+'</a>';
      }).join('\n');
      parts.push('<div class="be-btn-row">'+btnHtml+'</div>');
    }

    return parts.join('\n');
  }

  // ── Countdown ticker ───────────────────────────────────────────────────────
  var _cdTimers = Object.create(null);
  function _startCountdown(bannerEl) {
    var cdEl = bannerEl.querySelector('.be-countdown');
    if (!cdEl) return;
    var endTime = new Date(cdEl.getAttribute('data-end-iso')||'').getTime();
    if (!endTime) return;
    var key = bannerEl.getAttribute('data-be') + '_cd';
    if (_cdTimers[key]) clearInterval(_cdTimers[key]);
    function tick() {
      var diff = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
      var map  = { days:Math.floor(diff/86400), hours:Math.floor((diff%86400)/3600), mins:Math.floor((diff%3600)/60), secs:diff%60 };
      bannerEl.querySelectorAll('[data-cd-unit]').forEach(function(el){
        el.textContent = String(map[el.getAttribute('data-cd-unit')]||0).padStart(2,'0');
      });
      if (diff <= 0) clearInterval(_cdTimers[key]);
    }
    tick();
    _cdTimers[key] = setInterval(tick, 1000);
  }

  // ── Slider ticker ──────────────────────────────────────────────────────────
  var _slTimers = Object.create(null);
  function _startSlider(bannerEl) {
    var sliderEl = bannerEl.querySelector('.be-slider');
    if (!sliderEl) return;
    var slides   = Array.prototype.slice.call(sliderEl.querySelectorAll('.be-slide-img'));
    if (slides.length < 2) return;
    var interval  = Math.max(1000, parseInt(sliderEl.getAttribute('data-interval'),10)||3000);
    var animation = sliderEl.getAttribute('data-animation') || 'fade';
    var current   = 0;
    var key = bannerEl.getAttribute('data-be') + '_sl';
    if (_slTimers[key]) clearInterval(_slTimers[key]);
    _slTimers[key] = setInterval(function() {
      var prev = current; current = (current+1) % slides.length;
      slides[prev].style.display = 'none';
      slides[current].style.display = 'block';
      if (animation === 'fade') {
        slides[current].style.opacity = '0';
        slides[current].style.transition = 'opacity .4s ease';
        requestAnimationFrame(function(){ slides[current].style.opacity = '1'; });
      }
    }, interval);
  }

  // ── JS Triggers ──────────────────────────────────────────────────────────
  var JS_TRIGGERS = {
    confetti: function(el) {
      for (var i=0;i<30;i++){(function(i){var d=document.createElement('span');d.style.cssText='position:absolute;width:6px;height:6px;border-radius:50%;pointer-events:none;background:'+['#13b47f','#0eb0d5','#fff','#ffd166'][i%4]+';left:'+Math.floor(Math.random()*100)+'%;top:'+Math.floor(Math.random()*100)+'%;transform:translateY(-10px) scale(.9);opacity:0.95;z-index:9999;';el.appendChild(d);setTimeout(function(){d.style.transition='transform .9s ease,opacity .9s ease';d.style.transform='translateY(120px) scale(.6)';d.style.opacity='0';setTimeout(function(){d.remove();},1000);},2);})(i);}
      if(!document.getElementById('be-cf-kf')){var s=document.createElement('style');s.id='be-cf-kf';s.textContent='@keyframes be-cf{0%{transform:translateY(0) rotate(0);opacity:1}100%{transform:translateY(120px) rotate(360deg);opacity:0}}';document.head.appendChild(s);}
    },
    shake: function(el) {
      if(!document.getElementById('be-shake-kf')){var s=document.createElement('style');s.id='be-shake-kf';s.textContent='@keyframes be-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%{transform:translateX(6px)}}';document.head.appendChild(s);}
      el.style.animation='be-shake .4s ease';
      el.addEventListener('mouseover',function(){el.style.animation='none';requestAnimationFrame(function(){el.style.animation='be-shake .4s ease';});});
    },
    pulse: function(el) {
      if(!document.getElementById('be-pulse-kf')){var s=document.createElement('style');s.id='be-pulse-kf';s.textContent='@keyframes be-pulse{0%,100%{box-shadow:0 0 0 0 rgba(19,180,127,.2)}50%{box-shadow:0 0 26px 6px rgba(19,180,127,.04)}}';document.head.appendChild(s);}
      el.style.animation='be-pulse 2s ease-in-out infinite';
    },
    scroll_reveal: function(el) {
      el.style.opacity='0';el.style.transform='translateY(18px)';el.style.transition='opacity .5s ease, transform .5s ease';
      if(!('IntersectionObserver' in window)){el.style.opacity='1';el.style.transform='';return;}
      var io=new IntersectionObserver(function(e){if(e[0].isIntersecting){el.style.opacity='1';el.style.transform='translateY(0)';io.disconnect();}},{threshold:0.15});
      io.observe(el);
    },
    bounce: function(el) {
      if(!document.getElementById('be-bounce-kf')){var s=document.createElement('style');s.id='be-bounce-kf';s.textContent='@keyframes be-bounce{0%,100%{transform:translateY(0)}30%{transform:translateY(-6px)}50%{transform:translateY(0)}}';document.head.appendChild(s);}
      el.style.animation='be-bounce .6s cubic-bezier(.36,.07,.19,.97)';
    },
    glow: function(el) {
      if(!document.getElementById('be-glow-kf')){var s=document.createElement('style');s.id='be-glow-kf';s.textContent='@keyframes be-glow{from{box-shadow:0 0 8px rgba(19,180,127,.3)}to{box-shadow:0 0 18px rgba(14,176,213,.25)}}';document.head.appendChild(s);}
      el.style.animation='be-glow 2s ease-in-out infinite alternate';
    },
  };

  // ── Render ───────────────────────────────────────────────────────────────
  function _render(mountEl, data) {
    var lang = _getLang();
    mountEl.setAttribute('data-banner-mount', data.slug);
    if (data.bannerStyles) _injectUserStyles(data.slug, data.bannerStyles);

    var wrapper = document.createElement('div');
    wrapper.className = 'be-banner banner-custom';
    wrapper.setAttribute('data-be', data.slug);
    wrapper.innerHTML = _buildInnerHtml(data, lang);

    mountEl.innerHTML = '';
    mountEl.appendChild(wrapper);

    // Apply data-i18n translations (works for both modes)
    if (data.translations) _applyI18n(wrapper, data.translations, lang);

    _startCountdown(wrapper);
    _startSlider(wrapper);

    if (data.jsTrigger && JS_TRIGGERS[data.jsTrigger]) {
      try { JS_TRIGGERS[data.jsTrigger](wrapper); } catch(e) { console.warn('[banner-engine] trigger error:', e); }
    }
  }

  function _renderAll(slug, data) {
    document.querySelectorAll('['+MOUNT_ATTR+'="'+slug+'"]').forEach(function(el){ _render(el, data); });
  }
  function _rerenderAll(slug, data) {
    var mounts = document.querySelectorAll('[data-banner-mount="'+slug+'"]');
    if (!mounts.length) return;
    var hash = JSON.stringify(data) + _getLang(); // re-render on lang change too
    if (mounts[0].__beHash === hash) return;
    mounts.forEach(function(el){ el.__beHash = hash; _render(el, data); });
  }

  function _init() {
    _injectBaseStyles();
    var seen = Object.create(null);
    document.querySelectorAll('['+MOUNT_ATTR+']').forEach(function(el){
      var slug = el.getAttribute(MOUNT_ATTR);
      if (!slug || seen[slug]) return;
      seen[slug] = true;
      var cached = _getCached(slug);
      if (cached) _renderAll(slug, cached);
      else        _fetchAndRender(slug, true);
    });
  }

  // ── Public API ──────────────────────────────��────────────────────────────
  global.BannerEngine = {
    version: '3.0.0-scoped',
    mount: function(selector, slug) {
      var el = typeof selector === 'string' ? document.querySelector(selector) : selector;
      if (!el) return console.warn('[banner-engine] element not found:', selector);
      el.setAttribute(MOUNT_ATTR, slug);
      var cached = _getCached(slug);
      if (cached) _render(el, cached);
      else        _fetchAndRender(slug, true);
    },
    // Call after user changes language — re-renders all banners in new language
    refresh: function() { _cache = Object.create(null); _init(); },
    destroy: function() {
      Object.keys(_cdTimers).forEach(function(k){ clearInterval(_cdTimers[k]); });
      Object.keys(_slTimers).forEach(function(k){ clearInterval(_slTimers[k]); });
      _cdTimers = Object.create(null); _slTimers = Object.create(null);
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  // ── Auto re-render on language change ─────────────────────────────────────
  window.addEventListener('storage', function(e) {
    if (e.key === 'selectedLang') global.BannerEngine.refresh();
  });

})(window);