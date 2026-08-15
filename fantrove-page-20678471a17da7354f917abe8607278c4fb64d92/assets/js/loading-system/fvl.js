// Path:    assets/js/loading-system/fvl.js
// Purpose: FVL (FantroveVerse Loader) v1.0.0 — flexible loading framework.
//          Supports 4 display modes: fullscreen / scoped / inline / topbar.
//          Single-file hybrid architecture (entry + internal modules in one file)
//          for maximum lightweight — 1 HTTP request only.
//
// HTML (add to any page):
//   <script defer src="/assets/js/loading-system/fvl.js?v=1.0.0"></script>
//
// Then anywhere on any page:
//   FVL.show({ message: 'Loading...' });                              // fullscreen (default)
//   FVL.show({ mode: 'scoped',  target: '#card',  message: '...' });  // scoped to container
//   FVL.show({ mode: 'inline',  target: '#btn' });                    // inline spinner in button
//   FVL.show({ mode: 'topbar',  progress: 0.5 });                     // top progress bar
//
//   const h = FVL.show(...);
//   h.hide();
//   h.update({ message: 'Almost done', progress: 0.9 });
//
//   FVL.hideAll();
//   FVL.on('shown', (detail) => {});
//
// Backward-compat (auto-installed):
//   window.showInstantLoadingOverlay(opts)        → FVL fullscreen
//   window.removeInstantLoadingOverlay()          → FVL hide default fullscreen
//   window.NavCoreModules.LoadingService.show()   → FVL fullscreen (proxy)
//   window.NavCoreModules.LoadingService.hide()   → FVL hide (proxy)
//
// Module sections (in this single file):
//   1. types     — JSDoc typedefs
//   2. config    — constants, presets, z-index, timing
//   3. utils     — DOM helpers, option merging, reduced motion, lang detection
//   4. state     — instance registry, group registry, system events
//   5. renderer  — DOM structure builders for each of 4 modes
//   6. animator  — enter/exit animations (double-rAF)
//   7. engine    — main orchestrator + lifecycle
//   8. compat    — backward-compat proxy for nav-core LoadingService
//   9. init      — creates frozen window.FVL global

(function() {
  'use strict';

  if (window.FVL && window.FVL._initialized) return;

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 1: Namespace
  // ════════════════════════════════════════════════════════════════════════════

  /** @type {FVLModules} */
  var M = window.FVLModules = window.FVLModules || {};

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 2: types.js — JSDoc typedefs (no runtime code)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Display mode for the loader.
   * @typedef {'fullscreen'|'scoped'|'inline'|'topbar'} FVLMode
   */

  /**
   * Visualization type. Currently only 'ring' is supported — kept as enum for
   * future expansion without breaking API.
   * @typedef {'ring'} FVLVisual
   */

  /**
   * Options for FVL.show().
   * All properties are optional — sensible defaults apply per mode.
   *
   * @typedef {Object|string} FVLOptions
   * @property {FVLMode}    [mode='fullscreen']  - Display mode.
   * @property {string}     [id]                 - Unique ID. Auto-generated if omitted.
   * @property {string}     [group]              - Group name — only one loader per group
   *                                                open at a time. Opening new in same
   *                                                group hides the old one.
   * @property {string|HTMLElement} [target]     - CSS selector or element. Required for
   *                                                'scoped' and 'inline' modes. The
   *                                                container/button to attach to.
   * @property {string}     [message]            - Loading message text. For fullscreen,
   *                                                shows below spinner. For inline,
   *                                                shows after spinner inside target.
   *                                                Ignored for topbar.
   * @property {string}     [subMessage]         - Secondary message (fullscreen only).
   *                                                Defaults to English translation of
   *                                                `message` when active lang !== 'en'.
   * @property {string}     [lang]               - Language code ('en'|'th'|...).
   *                                                Auto-detected from localStorage.selectedLang
   *                                                if omitted.
   * @property {FVLVisual}  [visual='ring']      - Spinner visualization.
   * @property {number}     [size]               - Spinner size in px. Auto-sized per mode
   *                                                if omitted (fullscreen=68, scoped=40,
   *                                                inline=18, topbar=N/A).
   * @property {string}     [theme='light']      - 'light' | 'dark' | 'brand' | 'auto'.
   *                                                'auto' picks based on target bg color
   *                                                (scoped/inline only).
   * @property {number}     [progress]           - [topbar] 0..1 progress. omit = indeterminate.
   * @property {boolean}    [overlay=true]       - [scoped] Show semi-transparent backdrop.
   * @property {boolean}    [lockScroll=false]   - [fullscreen] Lock page scroll while shown.
   * @property {number}     [zIndex]             - Override z-index.
   * @property {number}     [autoHideAfterMs]    - Auto-hide after N ms (0 = manual).
   * @property {boolean}    [replaceContent=false] - [inline] Replace target's content
   *                                                entirely with spinner+message.
   *                                                Default = prepend (keep original visible).
   * @property {boolean}    [persistent=false]   - Cannot be dismissed via API shortcuts
   *                                                (must use handle.hide()).
   * @property {boolean}    [instant=false]      - Skip enter animation — overlay becomes
   *                                                visible immediately (opacity: 1) without
   *                                                the double-rAF fade-in. Use when the overlay
   *                                                must hide content changes happening in the
   *                                                same frame (prevents race conditions).
   * @property {boolean}    [coverAll=false]     - [fullscreen] Override top to 0 so the
   *                                                overlay covers the ENTIRE viewport including
   *                                                the header. Used for initial page load where
   *                                                the user should not see any unready UI.
   *                                                The fvl-nav-mode bottom/left rules still apply.
   * @property {Function}   [onShow]             - (id, handle) => void — after enter animation.
   * @property {Function}   [onHide]             - (id) => void — after exit animation.
   * @property {Function}   [onMount]            - (rootEl, handle) => void — DOM ready, pre-animation.
   */

  /**
   * Handle returned by FVL.show(). Used to control a single loader instance.
   *
   * @typedef {Object} FVLHandle
   * @property {string}      id          - Unique instance ID.
   * @property {FVLMode}     mode        - Resolved display mode.
   * @property {FVLOptions}  options     - Resolved options.
   * @property {HTMLElement} element     - Root DOM element.
   * @property {Function}    hide        - () => Promise<void> — hide this loader.
   * @property {Function}    update      - (newOpts) => void — merge new options.
   * @property {Function}    setMessage  - (string|null) => void — update message.
   * @property {Function}    setProgress - (0..1|null) => void — update progress (topbar).
   * @property {Function}    getState    - () => 'showing'|'shown'|'hiding'|'hidden'.
   * @property {Function}    on          - (event, fn) => unsub — instance events.
   */

  /**
   * Internal loader instance.
   * @typedef {Object} FVLInstance
   * @property {string}      id
   * @property {FVLMode}     mode
   * @property {FVLOptions}  options
   * @property {HTMLElement} rootEl
   * @property {HTMLElement} [spinnerEl]
   * @property {HTMLElement} [msgEl]
   * @property {HTMLElement} [subEl]
   * @property {HTMLElement} [barEl]
   * @property {HTMLElement} [targetEl]
   * @property {string}      state         - 'showing'|'shown'|'hiding'|'hidden'|'destroyed'
   * @property {number}      shownAt
   * @property {number|null} autoHideTimer
   * @property {number|null} rafId
   * @property {number|null} leaveTimer
   * @property {string}      origTargetPos - saved target.position for scoped mode
   * @property {string}      origTargetHTML - saved target.innerHTML for inline-replace mode
   * @property {Set<Function>} listeners
   */

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 3: config.js — constants & presets
  // ════════════════════════════════════════════════════════════════════════════

  var VERSION = '1.0.0';

  var CONFIG = Object.freeze({
    VERSION: VERSION,

    // ── Z-index layers (one per mode, separated by 100 for safety) ──
    Z_INDEX: Object.freeze({
      topbar:     17500,
      fullscreen: 17000,  // matches --fv-z-overlay (17000) for back-compat
      scoped:     1600,
      inline:     0,      // inline participates in normal flow
    }),

    // ── Animation timing (ms) ──
    TIMING: Object.freeze({
      ENTER: 140,    // fade-in duration
      LEAVE: 180,    // fade-out duration
      SPIN: 800,     // spinner rotation period
      TOPBAR_INDETERMINATE_CYCLE: 1200, // topbar back-and-forth cycle
    }),

    // ── Default spinner sizes per mode (px) ──
    SIZES: Object.freeze({
      fullscreen: 68,
      scoped: 40,
      inline: 18,
      topbar: 0, // N/A
    }),

    // ── DOM tokens ──
    DOM: Object.freeze({
      ROOT_CLASS: 'fvl',
      DATA_ATTR: 'data-fvl-id',
      DATA_MODE: 'data-fvl-mode',
      DEFAULT_FULLSCREEN_ID: 'fvl-default-fullscreen', // singleton for back-compat
      CSS_PATH: '/assets/css/loading-system.css',
    }),

    // ── i18n fallback messages ──
    // To add a new language: add a key here — no other changes needed.
    MESSAGES: Object.freeze({
      en: Object.freeze({ loading: 'Loading...' }),
      th: Object.freeze({ loading: 'กำลังโหลด...' }),
      ja: Object.freeze({ loading: '読み込み中...' }),
      zh: Object.freeze({ loading: '加载中...' }),
    }),

    // ── Language key in localStorage ──
    LANG_KEY: 'selectedLang',

    // ── Mode presets — defaults applied per mode ──
    PRESETS: Object.freeze({
      fullscreen: Object.freeze({
        overlay: true,
        lockScroll: false,
        theme: 'light',
        visual: 'ring',
      }),
      scoped: Object.freeze({
        overlay: true,
        theme: 'auto',
        visual: 'ring',
      }),
      inline: Object.freeze({
        overlay: false,
        theme: 'auto',
        visual: 'ring',
        replaceContent: false,
      }),
      topbar: Object.freeze({
        overlay: false,
        theme: 'brand',
        visual: 'ring', // unused but kept for consistency
      }),
    }),
  });

  M.CONFIG = CONFIG;

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 4: utils.js — DOM helpers, option merging, lang detection
  // ════════════════════════════════════════════════════════════════════════════

  var Utils = (function() {

    // ── DOM helpers ──
    var DOM = {
      create: function(tag, className, attrs) {
        var el = document.createElement(tag);
        if (className) el.className = className;
        if (attrs) {
          for (var k in attrs) {
            if (attrs.hasOwnProperty(k)) el.setAttribute(k, attrs[k]);
          }
        }
        return el;
      },
      query: function(sel, parent) {
        try { return (parent || document).querySelector(sel); } catch (_) { return null; }
      },
      resolveTarget: function(target) {
        if (!target) return null;
        if (typeof target === 'string') return DOM.query(target);
        if (target instanceof HTMLElement) return target;
        return null;
      },
      remove: function(el) {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      },
    };

    // ── Option merging ──
    function mergeOptions(userOpts, mode) {
      // Accept string shorthand: FVL.show('Loading...') === FVL.show({ message: 'Loading...' })
      if (typeof userOpts === 'string') {
        userOpts = { message: userOpts };
      }
      userOpts = userOpts || {};

      var resolvedMode = userOpts.mode || mode || 'fullscreen';
      var preset = CONFIG.PRESETS[resolvedMode] || CONFIG.PRESETS.fullscreen;

      var o = Object.assign({}, preset, userOpts);
      o.mode = resolvedMode;
      o.visual = o.visual || preset.visual;
      o.theme = o.theme || preset.theme;
      o.size = o.size != null ? o.size : CONFIG.SIZES[resolvedMode];

      return o;
    }

    // ── prefers-reduced-motion ──
    function prefersReducedMotion() {
      try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch (_) { return false; }
    }

    // ── Language detection ──
    function detectLang(explicit) {
      if (explicit) return explicit;
      try { return localStorage.getItem(CONFIG.LANG_KEY) || 'en'; }
      catch (_) { return 'en'; }
    }

    // ── i18n message resolver ──
    function getMessage(lang, key) {
      key = key || 'loading';
      var msgs = CONFIG.MESSAGES;
      return (msgs[lang] && msgs[lang][key])
          || (msgs.en && msgs.en[key])
          || (msgs[Object.keys(msgs)[0]] || {})[key]
          || 'Loading...';
    }

    // ── Generate unique ID ──
    var _idCounter = 0;
    function generateId(prefix) {
      return (prefix || 'fvl') + '-' + Date.now().toString(36) + '-' + (++_idCounter).toString(36);
    }

    // ── Hex/rgb to luminance for theme auto-detection ──
    function _relLuminance(rgb) {
      // rgb = [r, g, b] in 0..255
      var a = rgb.map(function(v) {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    }

    function _parseRgb(color) {
      // returns [r,g,b] or null
      if (!color) return null;
      var m = color.match(/rgba?\(([^)]+)\)/i);
      if (m) {
        var parts = m[1].split(',').map(function(s) { return parseFloat(s.trim()); });
        return [parts[0], parts[1], parts[2]];
      }
      m = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
      if (m) {
        var hex = m[1];
        if (hex.length === 3) hex = hex.split('').map(function(c) { return c + c; }).join('');
        return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
      }
      return null;
    }

    function autoTheme(targetEl) {
      // 'auto' → 'light' or 'dark' based on target's background luminance
      try {
        var el = targetEl || document.body;
        var bg = window.getComputedStyle(el).backgroundColor;
        var rgb = _parseRgb(bg);
        if (!rgb) return 'light';
        return _relLuminance(rgb) > 0.5 ? 'light' : 'dark';
      } catch (_) { return 'light'; }
    }

    return Object.freeze({
      DOM: DOM,
      mergeOptions: mergeOptions,
      prefersReducedMotion: prefersReducedMotion,
      detectLang: detectLang,
      getMessage: getMessage,
      generateId: generateId,
      autoTheme: autoTheme,
    });
  })();

  M.Utils = Utils;

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 5: state.js — instance registry, group registry, system events
  // ════════════════════════════════════════════════════════════════════════════

  var State = (function() {
    /** @type {Map<string, FVLInstance>} */
    var _instances = new Map();
    /** @type {Map<string, string>} group → instanceId */
    var _groups = new Map();
    /** @type {Map<string, Set<Function>>} event → listeners */
    var _listeners = new Map();

    function addInstance(inst) {
      _instances.set(inst.id, inst);
      if (inst.options.group) {
        var existingId = _groups.get(inst.options.group);
        if (existingId && existingId !== inst.id) {
          // Hide existing in same group (caller handles via event)
          _emit('group:replace', { oldId: existingId, newId: inst.id, group: inst.options.group });
        }
        _groups.set(inst.options.group, inst.id);
      }
    }

    function removeInstance(id) {
      var inst = _instances.get(id);
      if (inst && inst.options.group) {
        var g = inst.options.group;
        if (_groups.get(g) === id) _groups.delete(g);
      }
      _instances.delete(id);
    }

    function getInstance(id) { return _instances.get(id) || null; }
    function getAllInstances() { return Array.from(_instances.values()); }
    function getActiveCount() { return _instances.size; }
    function getByGroup(group) {
      var id = _groups.get(group);
      return id ? _instances.get(id) || null : null;
    }
    function getByMode(mode) {
      return getAllInstances().filter(function(i) { return i.mode === mode; });
    }

    function on(event, fn) {
      if (!_listeners.has(event)) _listeners.set(event, new Set());
      _listeners.get(event).add(fn);
      return function() { off(event, fn); };
    }
    function off(event, fn) {
      var s = _listeners.get(event);
      if (s) s.delete(fn);
    }
    function _emit(event, detail) {
      var s = _listeners.get(event);
      if (s) {
        s.forEach(function(fn) {
          try { fn(detail); } catch (e) { console.error('[FVL] event error:', e); }
        });
      }
      try { window.dispatchEvent(new CustomEvent('fvl:' + event, { detail: detail })); }
      catch (_) {}
    }

    function destroyAll() {
      _instances.forEach(function(inst) { _emit('destroy', { id: inst.id }); });
      _instances.clear();
      _groups.clear();
      _listeners.clear();
    }

    return Object.freeze({
      addInstance: addInstance,
      removeInstance: removeInstance,
      getInstance: getInstance,
      getAllInstances: getAllInstances,
      getActiveCount: getActiveCount,
      getByGroup: getByGroup,
      getByMode: getByMode,
      on: on,
      off: off,
      emit: _emit,
      destroyAll: destroyAll,
    });
  })();

  M.State = State;

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 6: renderer.js — DOM structure builders for each of 4 modes
  // ════════════════════════════════════════════════════════════════════════════

  var Renderer = (function() {

    // ── Spinner SVG (ring) — sized via CSS, themed via CSS vars ──
    function spinnerSVG() {
      return '<svg viewBox="0 0 52 52" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
           +   '<circle class="fvl-track" cx="26" cy="26" r="22"/>'
           +   '<circle class="fvl-arc"   cx="26" cy="26" r="22"/>'
           + '</svg>';
    }

    // ── Apply theme class ──
    function applyTheme(rootEl, theme, targetEl) {
      var resolved = theme;
      if (theme === 'auto') {
        resolved = Utils.autoTheme(targetEl);
      }
      rootEl.setAttribute('data-fvl-theme', resolved);
    }

    // ── Fullscreen mode ──
    function buildFullscreen(inst) {
      // NOTE: Do NOT set `hidden` attribute here — CSS `.fvl-fullscreen[hidden]`
      // forces `display: none !important`, which would prevent the overlay
      // from ever showing. Visibility is controlled via the .fvl-entering /
      // .fvl-shown / .fvl-leaving classes (opacity transitions) instead.
      var root = Utils.DOM.create('div', 'fvl fvl-fullscreen', {
        'role': 'status',
        'aria-live': 'polite',
        'aria-atomic': 'true',
      });
      root.setAttribute(CONFIG.DOM.DATA_MODE, 'fullscreen');
      root.setAttribute(CONFIG.DOM.DATA_ATTR, inst.id);

      // coverAll: cover entire viewport including header (for initial page load)
      if (inst.options.coverAll) {
        root.classList.add('fvl-cover-all');
      }

      var spinner = Utils.DOM.create('div', 'fvl-spinner', { 'aria-hidden': 'true' });
      spinner.innerHTML = spinnerSVG();

      var text = Utils.DOM.create('div', 'fvl-text');
      var msg  = Utils.DOM.create('div', 'fvl-msg');
      var sub  = Utils.DOM.create('div', 'fvl-sub');
      text.appendChild(msg);
      text.appendChild(sub);

      root.appendChild(spinner);
      root.appendChild(text);

      inst.spinnerEl = spinner;
      inst.msgEl = msg;
      inst.subEl = sub;

      return root;
    }

    // ── Scoped mode (covers target container) ──
    function buildScoped(inst) {
      var root = Utils.DOM.create('div', 'fvl fvl-scoped', {
        'role': 'status',
        'aria-live': 'polite',
        'aria-hidden': 'true',
      });
      root.setAttribute(CONFIG.DOM.DATA_MODE, 'scoped');
      root.setAttribute(CONFIG.DOM.DATA_ATTR, inst.id);

      var inner = Utils.DOM.create('div', 'fvl-scoped-inner');
      var spinner = Utils.DOM.create('div', 'fvl-spinner', { 'aria-hidden': 'true' });
      spinner.innerHTML = spinnerSVG();

      inner.appendChild(spinner);
      if (inst.options.message) {
        var msg = Utils.DOM.create('div', 'fvl-msg');
        msg.textContent = inst.options.message;
        inner.appendChild(msg);
        inst.msgEl = msg;
      }
      root.appendChild(inner);

      inst.spinnerEl = spinner;

      // Overlay backdrop?
      if (inst.options.overlay) {
        root.classList.add('fvl-scoped-overlay');
      }

      return root;
    }

    // ── Inline mode (inside target — e.g. button) ──
    function buildInline(inst) {
      var wrap = Utils.DOM.create('span', 'fvl fvl-inline', { 'aria-hidden': 'true' });
      wrap.setAttribute(CONFIG.DOM.DATA_MODE, 'inline');
      wrap.setAttribute(CONFIG.DOM.DATA_ATTR, inst.id);

      var spinner = Utils.DOM.create('span', 'fvl-spinner fvl-spinner-inline', { 'aria-hidden': 'true' });
      spinner.innerHTML = spinnerSVG();
      wrap.appendChild(spinner);

      if (inst.options.message) {
        var msg = Utils.DOM.create('span', 'fvl-inline-msg');
        msg.textContent = inst.options.message;
        wrap.appendChild(msg);
        inst.msgEl = msg;
      }

      inst.spinnerEl = spinner;
      return wrap;
    }

    // ── Topbar mode (NProgress-style bar at top of viewport) ──
    function buildTopbar(inst) {
      var root = Utils.DOM.create('div', 'fvl fvl-topbar', { 'role': 'status', 'aria-live': 'polite' });
      root.setAttribute(CONFIG.DOM.DATA_MODE, 'topbar');
      root.setAttribute(CONFIG.DOM.DATA_ATTR, inst.id);

      var bar = Utils.DOM.create('div', 'fvl-topbar-bar');
      if (inst.options.progress != null) {
        bar.classList.add('fvl-topbar-determinate');
        bar.style.width = Math.max(0, Math.min(1, inst.options.progress)) * 100 + '%';
      } else {
        bar.classList.add('fvl-topbar-indeterminate');
      }
      root.appendChild(bar);

      inst.barEl = bar;
      return root;
    }

    // ── Build entry point ──
    function build(inst) {
      var root;
      switch (inst.mode) {
        case 'scoped':    root = buildScoped(inst);    break;
        case 'inline':    root = buildInline(inst);    break;
        case 'topbar':    root = buildTopbar(inst);    break;
        case 'fullscreen':
        default:          root = buildFullscreen(inst); break;
      }
      applyTheme(root, inst.options.theme, inst.targetEl);
      return root;
    }

    return Object.freeze({ build: build, applyTheme: applyTheme });
  })();

  M.Renderer = Renderer;

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 7: animator.js — enter/exit animations (double-rAF)
  // ════════════════════════════════════════════════════════════════════════════

  var Animator = (function() {

    function _doubleRaf(fn) {
      // Two RAFs ensure the browser paints the initial state before transitioning.
      requestAnimationFrame(function() {
        requestAnimationFrame(fn);
      });
    }

    function enter(inst, done) {
      var el = inst.rootEl;
      if (!el) { if (done) done(); return; }

      var reduced = Utils.prefersReducedMotion();
      // Initial state
      el.classList.add('fvl-entering');

      if (reduced) {
        // No animation — jump to final state
        el.classList.remove('fvl-entering');
        el.classList.add('fvl-shown');
        if (done) done();
        return;
      }

      _doubleRaf(function() {
        el.classList.remove('fvl-entering');
        el.classList.add('fvl-shown');
        var onEnd = function() {
          el.removeEventListener('animationend', onEnd);
          el.removeEventListener('transitionend', onEnd);
          if (done) done();
        };
        el.addEventListener('animationend', onEnd, { once: true });
        el.addEventListener('transitionend', onEnd, { once: true });
        // Safety timeout in case events don't fire
        setTimeout(onEnd, CONFIG.TIMING.ENTER + 80);
      });
    }

    function leave(inst, done) {
      var el = inst.rootEl;
      if (!el) { if (done) done(); return; }

      var reduced = Utils.prefersReducedMotion();
      el.classList.remove('fvl-shown');
      el.classList.add('fvl-leaving');

      if (reduced) {
        if (done) done();
        return;
      }

      var onEnd = function() {
        el.removeEventListener('animationend', onEnd);
        el.removeEventListener('transitionend', onEnd);
        if (done) done();
      };
      el.addEventListener('animationend', onEnd, { once: true });
      el.addEventListener('transitionend', onEnd, { once: true });
      setTimeout(onEnd, CONFIG.TIMING.LEAVE + 80);
    }

    return Object.freeze({ enter: enter, leave: leave });
  })();

  M.Animator = Animator;

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 8: engine.js — main orchestrator + lifecycle
  // ════════════════════════════════════════════════════════════════════════════

  var Engine = (function() {

    // ── i18n text resolver for fullscreen mode ──
    function _setTexts(inst) {
      if (!inst.msgEl) return;
      var opts = inst.options;
      var lang = Utils.detectLang(opts.lang);

      if (opts.message) {
        inst.msgEl.textContent = opts.message;
        if (inst.subEl) {
          // Show English subtitle when active lang !== 'en'
          inst.subEl.textContent = (lang !== 'en' && !opts.subMessage)
            ? Utils.getMessage('en', 'loading')
            : (opts.subMessage || '');
        }
        if (inst.rootEl) {
          var ariaText = inst.subEl && inst.subEl.textContent
            ? inst.msgEl.textContent + ' / ' + inst.subEl.textContent
            : inst.msgEl.textContent;
          inst.rootEl.setAttribute('aria-label', ariaText);
        }
      } else {
        // Default loading message from i18n
        var primary = Utils.getMessage(lang, 'loading');
        inst.msgEl.textContent = primary;
        if (inst.subEl) {
          inst.subEl.textContent = (lang !== 'en') ? Utils.getMessage('en', 'loading') : '';
        }
        if (inst.rootEl) {
          var ariaT = inst.subEl && inst.subEl.textContent
            ? primary + ' / ' + inst.subEl.textContent
            : primary;
          inst.rootEl.setAttribute('aria-label', ariaT);
        }
      }
    }

    // ── Update top offset var (fullscreen mode — back-compat with --clp-top) ──
    // v3: แคช height เพื่อลด forced reflow
    // WHY เดิม: offsetHeight อ่าน forced layout ทุกครั้งที่ show() ถูกเรียก
    //   วิธีใหม่: ใช้ ResizeObserver และแคชค่า — อ่าน DOM cache แทน forced layout
    var _topCache = 0;
    var _topDirty = true;

    var _topRO = null;
    function _ensureTopRO() {
      if (_topRO || typeof ResizeObserver === 'undefined') return;
      _topRO = new ResizeObserver(function() { _topDirty = true; });
      try {
        var h = document.querySelector('header');
        var s = document.getElementById('sub-nav');
        if (h) _topRO.observe(h);
        if (s) _topRO.observe(s);
      } catch (_) {}
    }

    function _updateTopVar() {
      try {
        if (!_topDirty) return;
        _topDirty = false;
        _ensureTopRO();
        var header = document.querySelector('header');
        var subnav = document.getElementById('sub-nav');
        var top = 0;
        // v3: อ่านจาก ResizeObserver cache (boundingRect ไม่ force layout เพราะเราไม่ trigger layout ก่อน)
        //   offsetHeight ยังใช้ได้เพราะ ResizeObserver จะ invalidate ให้แล้ว
        if (header) top += header.offsetHeight;
        if (subnav && subnav.offsetHeight > 0) {
          top += subnav.offsetHeight;
        }
        _topCache = top;
        document.documentElement.style.setProperty('--fvl-top', top + 'px');
        document.documentElement.style.setProperty('--clp-top', top + 'px');
      } catch (_) {}
    }

    // ── Position scoped loader inside target ──
    function _attachScoped(inst) {
      var target = inst.targetEl;
      if (!target) {
        console.warn('[FVL] scoped mode requires a target');
        return false;
      }
      // Save original position to restore on hide
      inst.origTargetPos = window.getComputedStyle(target).position;
      if (inst.origTargetPos === 'static') {
        target.style.position = 'relative';
      }
      target.appendChild(inst.rootEl);
      return true;
    }

    // ── Insert inline loader into target ──
    function _attachInline(inst) {
      var target = inst.targetEl;
      if (!target) {
        console.warn('[FVL] inline mode requires a target');
        return false;
      }
      if (inst.options.replaceContent) {
        inst.origTargetHTML = target.innerHTML;
        target.textContent = '';
        target.appendChild(inst.rootEl);
      } else {
        target.insertBefore(inst.rootEl, target.firstChild);
      }
      return true;
    }

    // ── Track header height for fullscreen (uses ResizeObserver) ──
    var _ro = null;
    function _ensureResizeObserver() {
      if (_ro || typeof ResizeObserver === 'undefined') return;
      _ro = new ResizeObserver(function() { _updateTopVar(); });
      try {
        var header = document.querySelector('header');
        var subnav = document.getElementById('sub-nav');
        if (header) _ro.observe(header);
        if (subnav) _ro.observe(subnav);
      } catch (_) {}
    }

    // ── Show entry point ──
    function show(userOpts) {
      var opts = Utils.mergeOptions(userOpts);
      var mode = opts.mode;

      // Generate ID
      var id = opts.id;
      if (!id) {
        if (mode === 'fullscreen' && !State.getByMode('fullscreen')) {
          // Use stable default ID for back-compat (singleton-style)
          id = CONFIG.DOM.DEFAULT_FULLSCREEN_ID;
        } else {
          id = Utils.generateId('fvl-' + mode);
        }
      }
      opts.id = id;

      // Resolve target for scoped/inline
      var targetEl = null;
      if (mode === 'scoped' || mode === 'inline') {
        targetEl = Utils.DOM.resolveTarget(opts.target);
        if (!targetEl) {
          console.error('[FVL] ' + mode + ' mode requires valid target');
          return null;
        }
      }

      // If existing instance with same ID, handle based on its state
      var existing = State.getInstance(id);
      if (existing && existing.state !== 'hidden' && existing.state !== 'destroyed') {
        // v3 fix: ถ้า instance อยู่ในสถานะ 'hiding' (leave animation กำลังเล่นอยู่)
        // ให้ cleanup ทันทีแล้วสร้าง instance ใหม่ มิฉะนั้น show() จะ return
        // instance ที่กำลังจะหายไป ทำให้ overlay ไม่แสดงผล
        if (existing.state === 'hiding') {
          try { _cleanup(existing); } catch (_) {}
          // ลงไปสร้าง instance ใหม่ด้านล่าง
        } else {
          // showing หรือ shown — อัปเดต message แล้ว return (idempotent)
          if (existing.options.message !== opts.message && opts.message !== undefined) {
            existing.options.message = opts.message;
            _setTexts(existing);
          }
          return _makeHandle(existing);
        }
      }

      // If using a group, hide any existing instance in the same group first
      // (synchronously — ensures only one loader per group is visible at a time)
      if (opts.group) {
        var existingGroupInst = State.getByGroup(opts.group);
        if (existingGroupInst && existingGroupInst.id !== id) {
          // Detach immediately so the new one can take over without visual overlap.
          try { _cleanup(existingGroupInst); } catch (_) {}
          State.emit('group:replace', { oldId: existingGroupInst.id, newId: id, group: opts.group });
        }
      }

      // Resolve z-index
      var zBase = opts.zIndex != null ? opts.zIndex : CONFIG.Z_INDEX[mode];
      if (mode === 'topbar') zBase = opts.zIndex != null ? opts.zIndex : CONFIG.Z_INDEX.topbar;

      // Build instance
      /** @type {FVLInstance} */
      var inst = {
        id: id,
        mode: mode,
        options: opts,
        rootEl: null,
        spinnerEl: null,
        msgEl: null,
        subEl: null,
        barEl: null,
        targetEl: targetEl,
        state: 'showing',
        shownAt: Date.now(),
        autoHideTimer: null,
        rafId: null,
        leaveTimer: null,
        origTargetPos: '',
        origTargetHTML: '',
        listeners: new Set(),
      };

      // Build DOM
      inst.rootEl = Renderer.build(inst);
      if (!inst.rootEl) return null;

      // Set z-index (except inline which participates in normal flow)
      if (mode !== 'inline') {
        inst.rootEl.style.zIndex = zBase;
      }

      // Set spinner size if specified
      if (opts.size && inst.spinnerEl) {
        inst.spinnerEl.style.width = opts.size + 'px';
        inst.spinnerEl.style.height = opts.size + 'px';
      }

      // i18n texts (fullscreen)
      if (mode === 'fullscreen') {
        _setTexts(inst);
        _updateTopVar();
        _ensureResizeObserver();
      } else if (mode === 'scoped' && inst.msgEl && opts.message) {
        inst.msgEl.textContent = opts.message;
      }

      // Attach to DOM
      switch (mode) {
        case 'scoped':
          if (!_attachScoped(inst)) return null;
          break;
        case 'inline':
          if (!_attachInline(inst)) return null;
          break;
        case 'topbar':
          document.body.appendChild(inst.rootEl);
          break;
        case 'fullscreen':
        default:
          document.body.appendChild(inst.rootEl);
          break;
      }

      // Register in state
      State.addInstance(inst);
      State.emit('showing', { id: id, mode: mode });

      // onMount callback
      if (typeof opts.onMount === 'function') {
        try { opts.onMount(inst.rootEl, _makeHandle(inst)); } catch (e) { console.error('[FVL] onMount error:', e); }
      }

      // Enter animation (or instant skip)
      if (opts.instant) {
        // v1.1: instant mode — skip double-rAF fade-in, set shown immediately.
        // WHY: When the caller needs the overlay to hide content changes in the
        //   SAME frame (e.g., navigation loading), the 140ms+ enter animation
        //   creates a race condition: content may change before the overlay is
        //   fully opaque, causing visible jank. Instant mode sets opacity: 1
        //   via fvl-shown class immediately, so the overlay is opaque from the
        //   very first browser paint. Caller should still await one rAF after
        //   show() to guarantee the paint has occurred before mutating content.
        inst.rootEl.classList.add('fvl-shown');
        inst.state = 'shown';
        State.emit('shown', { id: id, mode: mode });
        if (typeof opts.onShow === 'function') {
          try { opts.onShow(id, _makeHandle(inst)); } catch (e) { console.error('[FVL] onShow error:', e); }
        }
      } else {
        Animator.enter(inst, function() {
          inst.state = 'shown';
          State.emit('shown', { id: id, mode: mode });
          if (typeof opts.onShow === 'function') {
            try { opts.onShow(id, _makeHandle(inst)); } catch (e) { console.error('[FVL] onShow error:', e); }
          }
        });
      }

      // Auto-hide
      if (opts.autoHideAfterMs > 0) {
        inst.autoHideTimer = setTimeout(function() { hide(id); }, opts.autoHideAfterMs);
      }

      // Lock scroll (fullscreen only)
      if (mode === 'fullscreen' && opts.lockScroll) {
        try {
          var prev = window.scrollY || 0;
          document.body.style.position = 'fixed';
          document.body.style.top = '-' + prev + 'px';
          document.body.style.width = '100%';
          inst._lockedScrollY = prev;
        } catch (_) {}
      }

      return _makeHandle(inst);
    }

    // ── Hide by ID ──
    function hide(id) {
      var inst = State.getInstance(id);
      if (!inst || inst.state === 'hidden' || inst.state === 'destroyed') return Promise.resolve();
      if (inst.state === 'hiding') return Promise.resolve();

      inst.state = 'hiding';
      if (inst.autoHideTimer) { clearTimeout(inst.autoHideTimer); inst.autoHideTimer = null; }
      State.emit('hiding', { id: id, mode: inst.mode });

      return new Promise(function(resolve) {
        Animator.leave(inst, function() {
          _cleanup(inst);
          inst.state = 'hidden';
          State.emit('hidden', { id: id, mode: inst.mode });
          if (typeof inst.options.onHide === 'function') {
            try { inst.options.onHide(id); } catch (e) { console.error('[FVL] onHide error:', e); }
          }
          resolve();
        });
      });
    }

    // ── Cleanup DOM + restore target ──
    function _cleanup(inst) {
      // Restore scroll lock
      if (inst.mode === 'fullscreen' && inst._lockedScrollY != null) {
        try {
          document.body.style.position = '';
          document.body.style.top = '';
          document.body.style.width = '';
          window.scrollTo(0, inst._lockedScrollY);
          inst._lockedScrollY = null;
        } catch (_) {}
      }
      // Restore scoped target position
      if (inst.mode === 'scoped' && inst.targetEl && inst.origTargetPos) {
        if (inst.origTargetPos === 'static') {
          inst.targetEl.style.position = '';
        } else {
          inst.targetEl.style.position = inst.origTargetPos;
        }
      }
      // Restore inline-replace original HTML
      if (inst.mode === 'inline' && inst.targetEl && inst.options.replaceContent && inst.origTargetHTML != null) {
        inst.targetEl.innerHTML = inst.origTargetHTML;
        inst.origTargetHTML = '';
      }
      // Remove root element
      if (inst.rootEl && inst.rootEl.parentNode) {
        inst.rootEl.parentNode.removeChild(inst.rootEl);
      }
      State.removeInstance(inst.id);
    }

    // ── Update options on a live instance ──
    function update(id, newOpts) {
      var inst = State.getInstance(id);
      if (!inst) return;
      newOpts = newOpts || {};
      Object.assign(inst.options, newOpts);

      // Update message
      if (newOpts.message !== undefined || newOpts.lang !== undefined) {
        _setTexts(inst);
      }
      // Update progress (topbar)
      if (newOpts.progress !== undefined && inst.barEl) {
        if (newOpts.progress == null) {
          inst.barEl.classList.remove('fvl-topbar-determinate');
          inst.barEl.classList.add('fvl-topbar-indeterminate');
          inst.barEl.style.width = '';
        } else {
          inst.barEl.classList.remove('fvl-topbar-indeterminate');
          inst.barEl.classList.add('fvl-topbar-determinate');
          inst.barEl.style.width = Math.max(0, Math.min(1, newOpts.progress)) * 100 + '%';
        }
      }
      State.emit('updated', { id: id, mode: inst.mode });
    }

    // ── Hide all active instances ──
    function hideAll() {
      var all = State.getAllInstances().filter(function(i) {
        return i.state === 'showing' || i.state === 'shown';
      });
      return Promise.all(all.map(function(i) { return hide(i.id); }));
    }

    // ── Hide by group ──
    function hideByGroup(group) {
      var inst = State.getByGroup(group);
      return inst ? hide(inst.id) : Promise.resolve();
    }

    // ── Stats ──
    function stats() {
      var all = State.getAllInstances();
      return {
        active: all.length,
        modes: {
          fullscreen: all.filter(function(i) { return i.mode === 'fullscreen'; }).length,
          scoped:     all.filter(function(i) { return i.mode === 'scoped'; }).length,
          inline:     all.filter(function(i) { return i.mode === 'inline'; }).length,
          topbar:     all.filter(function(i) { return i.mode === 'topbar'; }).length,
        },
        instances: all.map(function(i) {
          return { id: i.id, mode: i.mode, state: i.state, shownAt: i.shownAt };
        }),
      };
    }

    // ── Build handle from instance ──
    function _makeHandle(inst) {
      return Object.freeze({
        id: inst.id,
        mode: inst.mode,
        options: inst.options,
        element: inst.rootEl,
        hide: function() { return hide(inst.id); },
        update: function(o) { update(inst.id, o); },
        setMessage: function(msg) { update(inst.id, { message: msg }); },
        setProgress: function(p) { update(inst.id, { progress: p }); },
        getState: function() { return inst.state; },
        on: function(event, fn) {
          return State.on('instance:' + inst.id + ':' + event, fn);
        },
      });
    }

    return Object.freeze({
      show: show,
      hide: hide,
      hideAll: hideAll,
      hideByGroup: hideByGroup,
      update: update,
      stats: stats,
      _updateTopVar: _updateTopVar,
      _setTexts: function(id) {
        var inst = State.getInstance(id);
        if (inst) _setTexts(inst);
      },
      _makeHandle: function(inst) { return _makeHandle(inst); },
    });
  })();

  M.Engine = Engine;

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 9: compat.js — backward-compat proxy for nav-core LoadingService
  // ════════════════════════════════════════════════════════════════════════════

  var Compat = (function() {

    function _ensureFVL() {
      // Lazily ensure CSS is loaded (idempotent)
      _injectCSS();
    }

    function _injectCSS() {
      if (document.querySelector('link[href*="loading-system.css"]')) return;
      try {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = CONFIG.DOM.CSS_PATH;
        document.head.appendChild(link);
      } catch (_) {}
    }

    // ── NavCore LoadingService proxy ──
    var LoadingService = {
      LOADING_CONTAINER_ID: 'content-loading',

      init: function() {
        _ensureFVL();
        // No-op — FVL auto-inits on first show()
      },

      show: function(opts) {
        _ensureFVL();
        // Accept string shorthand
        var o = (typeof opts === 'string') ? { message: opts } : (opts || {});
        o.mode = 'fullscreen';
        o.id = CONFIG.DOM.DEFAULT_FULLSCREEN_ID;
        return Engine.show(o);
      },

      hide: function() {
        return Engine.hide(CONFIG.DOM.DEFAULT_FULLSCREEN_ID);
      },

      updateMessage: function(msg) {
        Engine.update(CONFIG.DOM.DEFAULT_FULLSCREEN_ID, { message: msg });
      },

      isShown: function() {
        var inst = State.getInstance(CONFIG.DOM.DEFAULT_FULLSCREEN_ID);
        return !!(inst && (inst.state === 'showing' || inst.state === 'shown'));
      },

      getMessages: function() { return CONFIG.MESSAGES; },

      // Internal aliases used by nav-core router/init
      _updateTopVar: function() { Engine._updateTopVar(); },
      _setTexts: function() { Engine._setTexts(CONFIG.DOM.DEFAULT_FULLSCREEN_ID); },
      _getEl: function() {
        var inst = State.getInstance(CONFIG.DOM.DEFAULT_FULLSCREEN_ID);
        return inst ? inst.rootEl : null;
      },

      // Aliases for call-site compatibility
      showInContent: function(opts) { return this.show(opts); },
      hideFromContent: function()   { return this.hide(); },
    };

    function installGlobalAliases() {
      try {
        // window.showInstantLoadingOverlay / removeInstantLoadingOverlay
        window.showInstantLoadingOverlay   = function(opts) { return LoadingService.show(opts); };
        window.removeInstantLoadingOverlay = function()     { return LoadingService.hide(); };

        // window._navCore_contentLoadingManager (used by nav-core/init.js)
        if (!window._navCore_contentLoadingManager) {
          window._navCore_contentLoadingManager = LoadingService;
        }

        // window._headerV2_contentLoadingManager (legacy alias)
        if (!window._headerV2_contentLoadingManager) {
          window._headerV2_contentLoadingManager = LoadingService;
        }

        // window.__removeInstantLoadingOverlay (used by nav-core/init.js)
        window.__removeInstantLoadingOverlay = function() { return LoadingService.hide(); };
      } catch (_) {}
    }

    function installNavCoreProxy() {
      // Register into NavCoreModules namespace IF it exists
      try {
        if (window.NavCoreModules) {
          window.NavCoreModules.LoadingService = LoadingService;
        }
      } catch (_) {}
    }

    return Object.freeze({
      LoadingService: LoadingService,
      installGlobalAliases: installGlobalAliases,
      installNavCoreProxy: installNavCoreProxy,
      ensureCSS: _injectCSS,
    });
  })();

  M.Compat = Compat;

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 10: init.js — create window.FVL global + auto-inject CSS
  // ════════════════════════════════════════════════════════════════════════════

  function _injectCSS() {
    if (document.querySelector('link[href*="loading-system.css"]')) return;
    try {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = CONFIG.DOM.CSS_PATH;
      document.head.appendChild(link);
    } catch (_) {}
  }

  function _boot() {
    // Inject CSS early (idempotent)
    _injectCSS();
    Compat.ensureCSS();

    // Install backward-compat aliases immediately (so any caller can use them
    // even before FVL.show() is invoked)
    Compat.installGlobalAliases();
    Compat.installNavCoreProxy();

    // Dispatch ready event
    try {
      window.dispatchEvent(new CustomEvent('fvl:ready', { detail: { version: VERSION } }));
    } catch (_) {}
  }

  // ── Public API ──
  window.FVL = Object.freeze({
    _initialized: true,
    version: VERSION,

    /**
     * Show a loader. Returns a handle or null on failure.
     * @param {FVLOptions|string} [opts]
     * @returns {FVLHandle|null}
     */
    show: function(opts) { return Engine.show(opts); },

    /**
     * Hide a loader by ID.
     * @param {string} [id]  - Defaults to the default fullscreen ID.
     * @returns {Promise<void>}
     */
    hide: function(id) {
      if (!id) id = CONFIG.DOM.DEFAULT_FULLSCREEN_ID;
      return Engine.hide(id);
    },

    /** Hide all active loaders. */
    hideAll: function() { return Engine.hideAll(); },

    /** Hide the loader in a specific group. */
    hideByGroup: function(group) { return Engine.hideByGroup(group); },

    /** Update options on a live loader. */
    update: function(id, opts) { Engine.update(id, opts); },

    /** Get a handle for an existing loader. Returns null if not found. */
    get: function(id) {
      var inst = State.getInstance(id);
      return inst ? Engine._makeHandle(inst) : null;
    },

    /** Check if a loader is currently active. */
    isActive: function(id) {
      var inst = State.getInstance(id);
      return !!(inst && (inst.state === 'showing' || inst.state === 'shown'));
    },

    /** Subscribe to system events: showing, shown, hiding, hidden, destroyed, updated. */
    on: function(event, fn) { return State.on(event, fn); },

    /** Get diagnostic stats. */
    stats: function() { return Engine.stats(); },

    /** Access internal modules namespace. */
    modules: function() { return M; },

    /** Access config constants. */
    config: function() { return CONFIG; },

    // ── Convenience shortcuts per mode ──
    fullscreen: function(opts) {
      opts = (typeof opts === 'string') ? { message: opts } : (opts || {});
      opts.mode = 'fullscreen';
      opts.id = opts.id || CONFIG.DOM.DEFAULT_FULLSCREEN_ID;
      return Engine.show(opts);
    },
    scoped: function(opts) {
      opts = opts || {};
      opts.mode = 'scoped';
      return Engine.show(opts);
    },
    inline: function(opts) {
      opts = opts || {};
      opts.mode = 'inline';
      return Engine.show(opts);
    },
    topbar: function(opts) {
      opts = opts || {};
      opts.mode = 'topbar';
      return Engine.show(opts);
    },
  });

  // ── Boot ──
  _boot();

})();
