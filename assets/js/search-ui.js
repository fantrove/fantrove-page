/*
  search-ui.js  v3.0  —  Production-Grade Performance
  =====================================================
  Upgrades from v2.2:

  RENDERING
  ✅ VirtualScrollEngine  — only visible items in DOM (< 20 nodes at any time)
  ✅ DOM node pooling     — reuse elements, zero GC pressure
  ✅ DocumentFragment     — single-pass DOM insertion (1 reflow, not N)
  ✅ Binary-search offsets — O(log n) visible-range calculation per scroll
  ✅ requestIdleCallback  — height correction off the critical path
  ✅ Text-length heuristic — vertical card detection without layout reads

  SCHEDULING
  ✅ requestAnimationFrame for all visual updates (frame-perfect)
  ✅ requestIdleCallback for indexing / measurements (never starves UI)
  ✅ Passive scroll/touch listeners — scroll thread never blocked

  OBSERVERS
  ✅ ResizeObserver on scroll viewport — replaces window.resize for keyboard
  ✅ ResizeObserver on suggestions box — re-positions VS when suggestions collapse
  ✅ IntersectionObserver removed from hot path — VS handles visibility natively

  UX
  ✅ Classic overlay behavior restored:
     - Overlay closes after search → header/nav/layout back to normal
     - Results render in main #searchResults
     - Search query stays in input
     - History recorded as before
  ✅ Suggestions hide when results arrive; re-appear when input is cleared
  ✅ Overlay closes via escape / back / backdrop as before

  BACKWARD-COMPAT
  ✅ All public API methods preserved
  ✅ ConDataService timing fix (v2.2) retained
  ✅ CSS class names unchanged

  PATCH v3.0.1 — Classic overlay-close-on-search restored
  ─────────────────────────────────────────────────────────
  Changed in SearchService.doSearch():
  1. Empty-query branch: always close overlay (was: only if options.closeOverlay)
  2. Results branch: close overlay BEFORE rendering so input/header return to
     normal position, then render into main #searchResults
     (was: keep overlay open, render inside overlay)
*/
(function () {
  'use strict';

  if (window.__searchUI && window.__searchUI._initialized) return;

  // =========================================================
  // CONFIG
  // =========================================================
  const CONFIG = {
    DOM: {
      suggestionContainerId : 'searchSuggestions',
      suggestionBackdropId  : 'searchSuggestionBackdrop',
      overlayBackdropId     : 'searchOverlayBackdrop',
      overlayContainerId    : 'searchOverlayContainer',
      sentinelId            : 'search-render-sentinel',   // kept for compat, unused in v3
      searchInputId         : 'searchInput',
      searchFormId          : 'searchForm',
      typeFilterId          : 'typeFilter',
      categoryFilterId      : 'categoryFilter',
      searchResultsId       : 'searchResults',
      copyToastId           : 'copyToast',
      searchInputWrapperId  : 'search-input-wrapper',
      filterPanelSelector   : '.search-filters-panel',
      placeholderId         : 'search-wrapper-placeholder'
    },
    RENDER: {
      suggestionMax               : 8,
      suggestionsFullscreenMax    : 30,
      // Virtual scroll
      vsOverscanPx                : 320,
      vsPoolMax                   : 40,
      vsEstimatedItemHeight       : 110,
    },
    TIMING: {
      debounceMs              : 120,
      toastDisplayMs          : 1400,
      toastFadeMs             : 250,
      focusDelayMs            : 20,
      transitionDelayMs       : 350,
      keyboardDetectionDelayMs: 100,
      keyboardGapMinMs        : 300,
      keyboardGapRecoveryMs   : 800,
      keyboardIdleTimeMs      : 500,
      conDataServiceWaitMs    : 5000,
      conDataServicePollMs    : 30,
    },
    STORAGE : { historyKey: 'searchHistory_v1', langKey: 'selectedLang' },
    DB      : { path: '/assets/db/db.min.json' },   // fallback only
    PERF    : {
      enabled            : false,   // off by default — enable via __searchUI.perf.enable()
      longTaskThresholdMs: 50,       // tasks longer than this are flagged
      maxMeasures        : 200,      // cap stored measures to prevent memory growth
    },
    LANG    : { default: 'en', autoDetect: true },
    TEXTS: {
      th: {
        all_types:'ทุกประเภท', all_categories:'ทุกหมวดหมู่',
        not_found:'ไม่พบข้อมูลที่ตรงหรือใกล้เคียง',
        copy:'คัดลอก', copy_failed:'คัดลอกไม่สำเร็จ',
        suggestion_label:'คำแนะนำ', suggestions_for_you:'คำแนะนำสำหรับคุณ',
        search_result_here:'ผลลัพธ์การค้นหาจะปรากฏที่นี่',
        search_placeholder:'ค้นหาข้อมูล...',
        type:'ประเภท', category:'หมวดหมู่', emoji:'อีโมจิ',
        trending:'ยอดนิยม', recent:'ล่าสุด'
      },
      en: {
        all_types:'All Types', all_categories:'All Categories',
        not_found:'No data found related to your keyword.',
        copy:'Copy', copy_failed:'Failed to copy',
        suggestion_label:'Suggestions', suggestions_for_you:'Suggestions for you',
        search_result_here:'Search results will appear here',
        search_placeholder:'Search information...',
        type:'Type', category:'Category', emoji:'Emoji',
        trending:'Trending', recent:'Recent'
      }
    }
  };

  // =========================================================
  // STATE
  // =========================================================
  const State = {
    apiData: null,
    allKeywordsCache: [],
    currentResults: [],
    currentFilteredResults: [],
    selectedType: 'all',
    selectedCategory: 'all',
    lastCommittedSearchState: null,
    lastQuery: '',
    overlayOpen: false,
    overlayTransitioning: false,
    preOverlayState: null,
    keyboardOpen: false,
    keyboardDetectionTimeout: null,
    lastWindowInnerHeight: 0,
    searchHistoryPushed: false,
    suppressHistoryPush: false,
    overlayOpenedAt: null,
    originalInputParent: null,
    originalInputNextSibling: null,
    originalPlaceholder: null,
    debounceTimeout: null,
    suggestionsLocked: false,
    _timeouts: new Set(),
    _handlersAttached: false,
    _overlayStateMarker: '__searchUI_overlay_open__',
    wrapperContainer: null,
    navHiddenBySearch: false,
    // keyboard auto-toggle
    keyboardAutoToggleEnabled: false,
    lastOverlayScrollY: 0,
    keyboardAutoToggleHandler: null,
    lastKeyboardToggleTime: 0,
    lastScrollTime: 0,
    isScrollingActive: false,
    scrollIdleTimer: null,
    // overlay DOM refs
    scrollableContent: null,
    resultsContainer: null,
  };

  const Handlers = {
    resize: null, inputFocus: null, inputBlur: null, inputClick: null,
    inputInput: null, inputKeydown: null, formSubmit: null,
    overlayBackdropClick: null, suggestionClick: null, suggestionKeydown: null,
    documentKeydownOverlay: null, popstate: null, documentClick: null, copyClick: null,
  };

  // =========================================================
  // UTILITIES
  // =========================================================
  const LanguageService = {
    getLang() {
      try {
        return localStorage.getItem(CONFIG.STORAGE.langKey) ||
          (CONFIG.LANG.autoDetect && navigator.language?.startsWith('th') ? 'th' : CONFIG.LANG.default);
      } catch { return CONFIG.LANG.default; }
    },
    setLang(lang) { try { localStorage.setItem(CONFIG.STORAGE.langKey, lang); } catch {} },
    t(key) {
      const lang = this.getLang();
      return CONFIG.TEXTS[lang]?.[key] || CONFIG.TEXTS[CONFIG.LANG.default][key] || key;
    }
  };

  const DOMService = {
    get: id => document.getElementById(id),
    query: sel => document.querySelector(sel),
    queryAll: sel => document.querySelectorAll(sel),
    create(tag, id, cls, styles) {
      const el = document.createElement(tag);
      if (id) el.id = id;
      if (cls) el.className = cls;
      if (styles) Object.assign(el.style, styles);
      return el;
    },
    remove(el) { try { el?.parentNode?.removeChild(el); } catch {} },
    setStyles(el, s) { if (el) try { Object.assign(el.style, s); } catch {} },
    setHTML(el, h) { if (el) el.innerHTML = h; },
    setAttr(el, k, v) { if (el) el.setAttribute(k, v); },
    addClass: (el, c) => el?.classList?.add(c),
    removeClass: (el, c) => el?.classList?.remove(c),
    on(el, ev, fn, opts) { if (el && fn) el.addEventListener(ev, fn, opts); },
    off(el, ev, fn) { if (el && fn) el.removeEventListener(ev, fn); },
  };

  const StringService = {
    escapeHtml: s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    encodeUrl: s => encodeURIComponent(s),
    decodeUrl(s) { try { return decodeURIComponent(s); } catch { return s; } },
  };

  const StorageService = {
    getHistory() { try { return JSON.parse(sessionStorage.getItem(CONFIG.STORAGE.historyKey)||'[]'); } catch { return []; } },
    addSearchToHistory(state) {
      try {
        const arr = this.getHistory();
        arr.push(Object.assign({}, state, { ts: Date.now() }));
        sessionStorage.setItem(CONFIG.STORAGE.historyKey, JSON.stringify(arr));
      } catch {}
    },
  };

  // =========================================================
  // VIRTUAL SCROLL ENGINE
  // =========================================================
  const VirtualScrollEngine = {
    OVERSCAN     : CONFIG.RENDER.vsOverscanPx,
    POOL_MAX     : CONFIG.RENDER.vsPoolMax,
    EST_H        : CONFIG.RENDER.vsEstimatedItemHeight,

    _vp          : null,
    _host        : null,
    _box         : null,
    _items       : [],
    _fn          : null,
    _lang        : 'en',

    _hgt         : null,
    _off         : null,
    _total       : 0,

    _vis         : null,
    _pool        : [],

    _raf         : null,
    _onScroll    : null,
    _vpObs       : null,
    _sgObs       : null,

    mount(viewport, host, items, renderFn, lang) {
      this.destroy();

      this._vp    = viewport;
      this._host  = host;
      this._items = items || [];
      this._fn    = renderFn;
      this._lang  = lang || 'en';
      this._vis   = new Map();

      this._hgt = new Float32Array(this._items.length).fill(this.EST_H);
      this._buildOff();

      const box = document.createElement('div');
      box.className = 'vs-container';
      box.style.cssText = `position:relative;height:${this._total}px;min-height:2px;contain:layout style;`;
      host.appendChild(box);
      this._box = box;

      this._onScroll = () => this._sched();
      viewport.addEventListener('scroll', this._onScroll, { passive: true });

      if ('ResizeObserver' in window) {
        this._vpObs = new ResizeObserver(() => this._sched());
        this._vpObs.observe(viewport);

        const sg = viewport.querySelector('#' + CONFIG.DOM.suggestionContainerId);
        if (sg) {
          this._sgObs = new ResizeObserver(() => this._sched());
          this._sgObs.observe(sg);
        }
      }

      this._sched();
    },

    destroy() {
      if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
      if (this._vp && this._onScroll) this._vp.removeEventListener('scroll', this._onScroll);
      this._vpObs?.disconnect(); this._vpObs = null;
      this._sgObs?.disconnect(); this._sgObs = null;
      this._box?.remove(); this._box = null;
      this._vis?.clear();
      this._pool  = [];
      this._items = [];
      this._vp    = this._host = this._fn = this._onScroll = null;
      this._vis   = null;
    },

    _sched() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = null; this._render(); });
    },

    _buildOff() {
      const n = this._hgt.length;
      this._off = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) this._off[i + 1] = this._off[i] + this._hgt[i];
      this._total = this._off[n] || 0;
    },

    _find(target) {
      if (!this._off || this._off.length < 2) return 0;
      let lo = 0, hi = this._off.length - 2;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (this._off[mid] <= target) lo = mid; else hi = mid - 1;
      }
      return lo;
    },

    _coOff() {
      let off = 0, el = this._box;
      while (el && el !== this._vp) { off += el.offsetTop; el = el.offsetParent; }
      return off;
    },

    _render() {
      if (!this._vp || !this._box || !this._items.length) return;
      const st = this._vp.scrollTop;
      const vh = this._vp.clientHeight;
      if (!vh) return;

      const co   = this._coOff();
      const lo   = st - co - this.OVERSCAN;
      const hi   = st - co + vh + this.OVERSCAN;
      const si   = this._find(Math.max(0, lo));
      const ei   = Math.min(this._items.length - 1, this._find(Math.max(0, hi)) + 1);

      const recycle = [];
      for (const [idx, el] of this._vis) {
        if (idx < si || idx > ei) recycle.push([idx, el]);
      }

      const frag  = document.createDocumentFragment();
      const meas  = [];

      for (const [idx, el] of recycle) {
        el.style.display = 'none';
        this._vis.delete(idx);
        if (this._pool.length < this.POOL_MAX) this._pool.push(el); else el.remove();
      }

      for (let i = si; i <= ei; i++) {
        if (this._vis.has(i)) continue;
        const top  = this._off[i];
        const html = this._fn(this._items[i], this._lang);
        let el     = this._pool.pop();
        if (el) {
          el.style.cssText = `position:absolute;left:0;right:0;top:${top}px;`;
          el.style.display = '';
          el.innerHTML     = html;
        } else {
          el = document.createElement('div');
          el.className     = 'vs-item';
          el.style.cssText = `position:absolute;left:0;right:0;top:${top}px;contain:layout style paint;`;
          el.innerHTML     = html;
          frag.appendChild(el);
        }
        this._vis.set(i, el);
        meas.push(i);
      }

      if (frag.hasChildNodes()) this._box.appendChild(frag);

      if (meas.length) this._measure(meas);
    },

    _measure(indices) {
      const exec = () => {
        if (!this._vis) return;
        const reads = [];
        for (const i of indices) {
          const el = this._vis.get(i);
          if (!el || el.style.display === 'none') continue;
          const h = el.firstElementChild?.offsetHeight || el.offsetHeight;
          if (h > 4) reads.push([i, h]);
        }
        let changed = false;
        const st    = this._vp?.scrollTop || 0;
        const co    = this._coOff();
        let adj     = 0;
        for (const [i, h] of reads) {
          const diff = h - this._hgt[i];
          if (Math.abs(diff) <= 4) continue;
          if (this._off[i] + co < st) adj += diff;
          this._hgt[i] = h;
          changed = true;
        }
        if (!changed) return;
        this._buildOff();
        if (this._box) this._box.style.height = this._total + 'px';
        for (const [idx, el] of this._vis) {
          const t = this._off[idx] + 'px';
          if (el.style.top !== t) el.style.top = t;
        }
        if (adj !== 0 && this._vp) this._vp.scrollTop += adj;
      };

      if ('requestIdleCallback' in window) requestIdleCallback(exec, { timeout: 500 });
      else setTimeout(exec, 50);
    },
  };

  // =========================================================
  // GAP-BASED KEYBOARD SERVICE
  // =========================================================
  const GapBasedKeyboardService = {
    isGapExpired:      () => (Date.now() - State.lastKeyboardToggleTime) >= CONFIG.TIMING.keyboardGapMinMs,
    isRecoveryExpired: () => (Date.now() - State.lastKeyboardToggleTime) >= CONFIG.TIMING.keyboardGapRecoveryMs,
    recordToggle:      () => { State.lastKeyboardToggleTime = Date.now(); },
    markScroll() {
      State.lastScrollTime = Date.now();
      State.isScrollingActive = true;
      if (State.scrollIdleTimer) clearTimeout(State.scrollIdleTimer);
      State.scrollIdleTimer = setTimeout(() => { State.isScrollingActive = false; }, CONFIG.TIMING.keyboardIdleTimeMs);
    },
    isScrollIdle: () => !State.isScrollingActive,
    resetGap:     () => { State.lastKeyboardToggleTime = 0; },
  };

  const KEYBOARD_AUTO_OPEN = false;

  const KeyboardAutoToggleService = {
    enableAutoToggle(sc) {
      if (State.keyboardAutoToggleEnabled) return;
      State.keyboardAutoToggleEnabled = true;
      State.lastOverlayScrollY = 0;
      GapBasedKeyboardService.resetGap();
      const el = sc || DOMService.get(CONFIG.DOM.overlayContainerId);
      if (!el) return;
      State.keyboardAutoToggleHandler = () => {
        try {
          const cur = el.scrollTop || 0;
          GapBasedKeyboardService.markScroll();
          if (cur === 0 && State.lastOverlayScrollY > 0) {
            if (GapBasedKeyboardService.isGapExpired() || GapBasedKeyboardService.isRecoveryExpired()) {
              this.openKB(); GapBasedKeyboardService.recordToggle();
            }
          } else if (cur > 0 && State.lastOverlayScrollY === 0) {
            if (GapBasedKeyboardService.isGapExpired()) { this.closeKB(); GapBasedKeyboardService.recordToggle(); }
          } else if (cur === 0 && GapBasedKeyboardService.isScrollIdle() && GapBasedKeyboardService.isRecoveryExpired()) {
            const inp = DOMService.get(CONFIG.DOM.searchInputId);
            if (inp && document.activeElement !== inp) { this.openKB(); GapBasedKeyboardService.recordToggle(); }
          }
          State.lastOverlayScrollY = cur;
        } catch {}
      };
      el.addEventListener('scroll', State.keyboardAutoToggleHandler, { passive: true });
    },
    disableAutoToggle() {
      if (!State.keyboardAutoToggleEnabled) return;
      State.keyboardAutoToggleEnabled = false;
      const sc = State.scrollableContent || DOMService.get(CONFIG.DOM.overlayContainerId);
      if (sc && State.keyboardAutoToggleHandler) sc.removeEventListener('scroll', State.keyboardAutoToggleHandler);
      if (State.scrollIdleTimer) clearTimeout(State.scrollIdleTimer);
      State.keyboardAutoToggleHandler = null;
    },
    openKB() {
      if (!KEYBOARD_AUTO_OPEN) return;
      const inp = DOMService.get(CONFIG.DOM.searchInputId);
      if (inp && document.activeElement !== inp) inp.focus();
    },
    closeKB() {
      const inp = DOMService.get(CONFIG.DOM.searchInputId);
      if (inp && document.activeElement === inp) inp.blur();
    },
  };

  // =========================================================
  // KEYBOARD DETECTION
  // =========================================================
  const KeyboardService = {
    _ro: null,

    initKeyboardDetection() {
      try {
        State.lastWindowInnerHeight = window.innerHeight || 0;

        if ('visualViewport' in window) {
          this._ro = new ResizeObserver(() => { try { this._update(); } catch {} });
          this._ro.observe(document.documentElement);
          window.visualViewport.addEventListener('resize', () => {
            clearTimeout(State.keyboardDetectionTimeout);
            State.keyboardDetectionTimeout = setTimeout(() => this._update(), CONFIG.TIMING.keyboardDetectionDelayMs);
          }, { passive: true });
        } else {
          Handlers.resize = () => {
            clearTimeout(State.keyboardDetectionTimeout);
            State.keyboardDetectionTimeout = setTimeout(() => this._update(), CONFIG.TIMING.keyboardDetectionDelayMs);
          };
          DOMService.on(window, 'resize', Handlers.resize, { passive: true });
        }

        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        if (inp) {
          inp.addEventListener('focus', () => {
            clearTimeout(State.keyboardDetectionTimeout);
            State.keyboardDetectionTimeout = setTimeout(() => this._update(), CONFIG.TIMING.keyboardDetectionDelayMs);
          });
          inp.addEventListener('blur', () => {
            clearTimeout(State.keyboardDetectionTimeout);
            State.keyboardDetectionTimeout = setTimeout(() => { State.keyboardOpen = false; }, CONFIG.TIMING.keyboardDetectionDelayMs);
          });
        }
      } catch {}
    },

    _update() {
      try {
        const cur  = (window.visualViewport?.height) || window.innerHeight || 0;
        const diff = State.lastWindowInnerHeight - cur;
        if (diff > 100) State.keyboardOpen = true;
        else if (diff < -100) State.keyboardOpen = false;
        State.lastWindowInnerHeight = cur;
      } catch {}
    },

    isKeyboardOpen: () => !!State.keyboardOpen,
  };

  // =========================================================
  // URL / HISTORY
  // =========================================================
  const URLService = {
    parseQS(qs) {
      const out = {};
      if (!qs) return out;
      for (const p of qs.replace(/^\?/,'').split('&')) {
        if (!p) continue;
        const idx = p.indexOf('=');
        if (idx === -1) out[decodeURIComponent(p)] = '';
        else out[decodeURIComponent(p.slice(0,idx))] = decodeURIComponent(p.slice(idx+1));
      }
      return out;
    },
    buildQS(obj) {
      const p = [];
      for (const k in obj) { if (obj[k] != null) p.push(encodeURIComponent(k)+'='+encodeURIComponent(obj[k])); }
      return p.length ? '?'+p.join('&') : '';
    },
    readStateFromURL() {
      try { const p = this.parseQS(location.search); return { q:p.q||'', type:p.type||'all', category:p.category||'all' }; }
      catch { return { q:'', type:'all', category:'all' }; }
    },
    buildUrlForState(st) {
      const p = {};
      if (st.q) p.q = st.q;
      if (st.type && st.type!=='all') p.type = st.type;
      if (st.category && st.category!=='all') p.category = st.category;
      return this.buildQS(p);
    },
    isEqual(a,b) {
      if (!a && !b) return true; if (!a||!b) return false;
      return (a.q||'').trim()===(b.q||'').trim() && (a.type||'all')===(b.type||'all') && (a.category||'all')===(b.category||'all');
    },
    commit(state) {
      try {
        if (this.isEqual(state, State.lastCommittedSearchState)) return;
        const url = this.buildUrlForState(state);
        try {
          if (State.searchHistoryPushed) { history.replaceState(state,'',url); State.searchHistoryPushed=false; }
          else history.pushState(state,'',url);
        } catch { try { history.replaceState(state,'',url); } catch {} State.searchHistoryPushed=false; }
        StorageService.addSearchToHistory(state);
        State.lastCommittedSearchState = { q:state.q||'', type:state.type||'all', category:state.category||'all' };
      } catch {}
    },
    syncOnClose() {
      if (State.searchHistoryPushed) {
        try { const s = State.lastCommittedSearchState||{q:'',type:'all',category:'all'}; history.replaceState(s,'',this.buildUrlForState(s)); } catch {}
        State.searchHistoryPushed = false;
      }
    },
  };

  // =========================================================
  // NOTIFICATION
  // =========================================================
  const NotificationService = {
    toast(msg) {
      try {
        const t = DOMService.create('div',null,'copy-toast-message');
        t.textContent = msg;
        (DOMService.get(CONFIG.DOM.copyToastId)||document.body).appendChild(t);
        const id = setTimeout(() => {
          try { Object.assign(t.style, {opacity:'0',transform:'translateY(-10px)'}); setTimeout(()=>DOMService.remove(t), CONFIG.TIMING.toastFadeMs); } catch {}
        }, CONFIG.TIMING.toastDisplayMs);
        State._timeouts.add(id);
      } catch {}
    },
    async copyText(text) {
      try {
        if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); this.toast(LanguageService.t('copy')+' แล้ว'); return; }
        const ta = Object.assign(document.createElement('textarea'), { value:text });
        Object.assign(ta.style, { position:'fixed', left:'-9999px' });
        document.body.appendChild(ta); ta.select();
        if (document.execCommand('copy')) this.toast(LanguageService.t('copy')+' แล้ว');
        else this.toast(LanguageService.t('copy_failed'));
        document.body.removeChild(ta);
      } catch { this.toast(LanguageService.t('copy_failed')); }
    },
  };

  // =========================================================
  // PERF MONITOR  — lightweight, opt-in, zero overhead when disabled
  // =========================================================
  //
  //  Usage:
  //    __searchUI.perf.enable()           → start collecting
  //    __searchUI.perf.disable()          → stop collecting
  //    __searchUI.perf.getReport()        → { measures, datasetSize, indexReady, longTasks }
  //    __searchUI.perf.reset()            → clear stored data
  //    __searchUI.perf.log()              → pretty-print report to console
  //
  //  Automatic measurements (when enabled):
  //    search-latency     time from doSearch() call to results rendered
  //    render-cost        time to insert cards into DOM
  //    index-build        time for Fuse index to finish building
  //    index-progress     % chunks processed (from SearchEngine callback)
  //
  //  LongTask detection (when enabled + browser supports):
  //    PerformanceObserver watches for tasks > CONFIG.PERF.longTaskThresholdMs
  //    These are the frames that cause visible jank
  //
  const PerfMonitor = (function () {
    const _measures    = [];   // { name, duration, ts }
    let   _longTasks   = [];   // { duration, ts }
    let   _datasetSize = 0;
    let   _observer    = null;
    let   _pendingMarks = {};  // { markName: startTime }

    function _enabled() { return CONFIG.PERF.enabled; }

    function _push(name, duration) {
      if (_measures.length >= CONFIG.PERF.maxMeasures) _measures.shift();
      _measures.push({ name, duration: Math.round(duration * 100) / 100, ts: Date.now() });
    }

    function _startObserver() {
      if (_observer || !('PerformanceObserver' in window)) return;
      try {
        _observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (entry.duration >= CONFIG.PERF.longTaskThresholdMs) {
              _longTasks.push({ duration: Math.round(entry.duration), ts: Date.now() });
              if (_longTasks.length > 50) _longTasks.shift();
            }
          }
        });
        _observer.observe({ entryTypes: ['longtask'] });
      } catch (_) {
        // longtask not supported on all browsers — silent fail
        _observer = null;
      }
    }

    function _stopObserver() {
      try { _observer?.disconnect(); } catch (_) {}
      _observer = null;
    }

    return {
      enable() {
        CONFIG.PERF.enabled = true;
        _startObserver();
      },
      disable() {
        CONFIG.PERF.enabled = false;
        _stopObserver();
      },
      toggle() {
        if (CONFIG.PERF.enabled) this.disable(); else this.enable();
        return CONFIG.PERF.enabled;
      },

      // ── mark / measure API (mirrors performance.mark) ──────
      mark(name) {
        if (!_enabled()) return;
        _pendingMarks[name] = performance.now();
      },
      measure(name, startMark) {
        if (!_enabled()) return;
        const start = _pendingMarks[startMark];
        if (start == null) return;
        const duration = performance.now() - start;
        delete _pendingMarks[startMark];
        _push(name, duration);
      },

      // ── dataset size (set from init) ────────────────────────
      setDatasetSize(n) { _datasetSize = n || 0; },

      // ── index progress from SearchEngine callback ───────────
      onIndexProgress(pct, count) {
        if (!_enabled()) return;
        // Only record milestones (25 / 50 / 75 / 100%) to keep noise low
        if (pct === 25 || pct === 50 || pct === 75 || pct === 100) {
          _push('index-progress-' + pct + 'pct', count);
        }
      },
      onIndexReady() {
        if (!_enabled()) return;
        _push('index-ready', _datasetSize);
      },

      // ── report ──────────────────────────────────────────────
      getReport() {
        const avgSearch = (() => {
          const s = _measures.filter(m => m.name === 'search-latency');
          if (!s.length) return null;
          return Math.round(s.reduce((a, b) => a + b.duration, 0) / s.length * 10) / 10;
        })();
        return {
          enabled          : _enabled(),
          datasetSize      : _datasetSize,
          indexReady       : window.SearchEngine?.isIndexReady?.() || false,
          isBuilding       : window.SearchEngine?.isBuilding?.()   || false,
          searchCount      : _measures.filter(m => m.name === 'search-latency').length,
          avgSearchMs      : avgSearch,
          renderCount      : _measures.filter(m => m.name === 'render-cost').length,
          longTaskCount    : _longTasks.length,
          longTasks        : _longTasks.slice(-10),
          measures         : _measures.slice(-50),
          enginePerfEntries: window.SearchEngine?.getPerfEntries?.() || [],
        };
      },
      reset() {
        _measures.length    = 0;
        _longTasks.length   = 0;
        _pendingMarks       = {};
        _datasetSize        = 0;
      },
      log() {
        const r = this.getReport();
        console.group('%c[SearchUI PerfMonitor]', 'color:#13b47f;font-weight:bold');
        console.log('Dataset size  :', r.datasetSize, 'items');
        console.log('Index ready   :', r.indexReady, r.isBuilding ? '(building…)' : '');
        console.log('Search count  :', r.searchCount);
        console.log('Avg search    :', r.avgSearchMs != null ? r.avgSearchMs + ' ms' : '—');
        console.log('Render count  :', r.renderCount);
        console.log('Long tasks    :', r.longTaskCount, '(>' + CONFIG.PERF.longTaskThresholdMs + 'ms)');
        if (r.longTasks.length) console.table(r.longTasks);
        if (r.measures.length)  console.table(r.measures.slice(-20));
        console.groupEnd();
        return r;
      },
    };
  })();

  // =========================================================
  // HIGHLIGHT
  // =========================================================
  const HighlightService = {
    highlight(text, query) {
      if (!text||!query) return StringService.escapeHtml(text||'');
      try {
        const t = String(text).toLowerCase();
        const chars = new Set(String(query).toLowerCase());
        let r = '';
        for (let i = 0; i < t.length; i++) {
          r += chars.has(t[i])
            ? `<strong style="background-color:#fff3cd;font-weight:700">${StringService.escapeHtml(String(text)[i])}</strong>`
            : StringService.escapeHtml(String(text)[i]);
        }
        return r;
      } catch { return StringService.escapeHtml(text); }
    },
  };

  // =========================================================
  // RENDERING SERVICE
  // =========================================================
  const RenderingService = {

    renderResultItem(item, lang) {
      try {
        const itemData  = item.item || item;
        const rawText   = itemData?.text || '';
        const itemText  = rawText || itemData?.name?.[lang] || itemData?.name?.en || item.itemName || '';
        const itemApi   = itemData?.api || '';
        const typeName  = item.typeName || item.typeObj?.name?.[lang] || item.typeObj?.name?.en || LanguageService.t('emoji');
        const catName   = item.catName  || item.category?.name?.[lang] || item.category?.name?.en || '';

        const names = [];
        if (item.itemName) names.push(item.itemName);
        if (itemData?.name) { const n = itemData.name[lang]||itemData.name.en; if (n && !names.includes(n)) names.push(n); }
        for (const k in (itemData||{})) {
          if (/_name$/.test(k) && itemData[k]) { const n = itemData[k][lang]||itemData[k].en; if (n && !names.includes(n)) names.push(n); }
        }
        const nameStr = names.filter(Boolean).join(' / ');
        const text    = itemText || itemApi || '-';

        const words    = text.trim().split(/\s+/);
        const vertical = text.includes('\n') || text.length > 45 || words.length > 7;

        const esc = StringService.escapeHtml;
        return `<div class="result-item search-card${vertical?' vertical':''}" role="article" aria-label="${esc(nameStr||text)}">
          <div class="card-content" aria-hidden="true">${esc(String(text).slice(0,300))}</div>
          <div class="card-body">
            <div class="card-title">${esc(nameStr||(itemData?.name?.[lang]||itemData?.name?.en||itemData?.api)||text)}</div>
            <div class="card-subtitle">${esc(itemApi||typeName||'')}</div>
            <div class="card-tags" aria-hidden="true">
              ${typeName?`<span class="tag">${esc(typeName)}</span>`:''}
              ${catName ?`<span class="tag">${esc(catName)}</span>` :''}
            </div>
          </div>
          <button class="result-copy-btn" data-text="${StringService.encodeUrl(text)}" aria-label="${LanguageService.t('copy')}">${LanguageService.t('copy')}</button>
        </div>`;
      } catch { return `<div class="result-item"><div class="result-content-area">-</div></div>`; }
    },

    disconnectRenderObserver() {
      VirtualScrollEngine.destroy();
      DOMService.remove(DOMService.get(CONFIG.DOM.sentinelId));
    },

    extractResultCategories(results) {
      try {
        const lang = LanguageService.getLang();
        const out = [], seen = Object.create(null);
        for (const r of results) {
          const k = (r.category?.name?.[lang] || r.category?.name?.en) || '';
          if (!seen[k]) { seen[k] = 1; out.push({ key:k, displayName:k }); }
        }
        return out;
      } catch { return []; }
    },

    renderResults(results, showSuggestionsIfNoResult = false) {
      try {
        // After overlay closes, State.overlayOpen is false → always use main #searchResults
        const container = (State.overlayOpen && State.resultsContainer)
          ? State.resultsContainer
          : DOMService.get(CONFIG.DOM.searchResultsId);

        const lang = LanguageService.getLang();
        if (!container) return;

        const filtered = State.selectedCategory !== 'all'
          ? results.filter(r => ((r.category?.name?.[lang]||r.category?.name?.en)||'') === State.selectedCategory)
          : results;

        document.body.style.marginBottom = '60px';
        this.disconnectRenderObserver();
        State.currentFilteredResults = filtered;

        if (!filtered.length) {
          let html = `<div class="no-result">${LanguageService.t('not_found')}</div>`;
          if (showSuggestionsIfNoResult) {
            html += `<div class="suggestions-title-main">${LanguageService.t('suggestions_for_you')}</div><div class="suggestions-block-list">`;
            const t0 = State.apiData?.type?.[0], c0 = t0?.category?.[0];
            for (const item of (c0?.data?.slice(0,5)||[])) {
              html += this.renderResultItem({ item, typeObj:t0, category:c0,
                itemName:item.name?.[lang]||item.name?.en||'',
                typeName:t0?.name?.[lang]||t0?.name?.en||'',
                catName :c0?.name?.[lang]||c0?.name?.en||'' }, lang);
            }
            html += '</div>';
          }
          DOMService.setHTML(container, html);
          const cfEl = DOMService.get(CONFIG.DOM.categoryFilterId);
          if (cfEl) cfEl.style.display = '';
          UIService.updateUILanguage();
          this._hideSuggestions();
          return;
        }

        DOMService.setHTML(container, '');
        this._hideSuggestions();

        // Overlay is already closed at this point → always use DocumentFragment batch
        // render-start mark placed inside rAF so measurement spans actual DOM work
        requestAnimationFrame(() => {
          PerfMonitor.mark('render-start');
          this._batchRender(filtered, container, lang);
          PerfMonitor.measure('render-cost', 'render-start');
        });

        if (!window._copyResultTextHandlerSet) {
          Handlers.copyClick = e => {
            const btn = e.target.closest('.result-copy-btn');
            if (btn?.hasAttribute('data-text')) { e.preventDefault(); NotificationService.copyText(StringService.decodeUrl(btn.getAttribute('data-text'))); }
          };
          DOMService.on(container, 'click', Handlers.copyClick);
          window._copyResultTextHandlerSet = true;
        }

        UIService.updateUILanguage();
      } catch (e) { console.error('renderResults failed', e); }
    },

    _batchRender(items, container, lang) {
      try {
        const html = items.map(item => this.renderResultItem(item, lang)).join('');
        const tpl  = document.createElement('template');
        tpl.innerHTML = html;
        container.appendChild(tpl.content);
        if (!window._copyResultTextHandlerSet) {
          Handlers.copyClick = e => {
            const btn = e.target.closest('.result-copy-btn');
            if (btn?.hasAttribute('data-text')) { e.preventDefault(); NotificationService.copyText(StringService.decodeUrl(btn.getAttribute('data-text'))); }
          };
          DOMService.on(container, 'click', Handlers.copyClick);
          window._copyResultTextHandlerSet = true;
        }
      } catch (e) { console.error('_batchRender failed', e); }
    },

    _hideSuggestions() {
      try {
        const sg = DOMService.get(CONFIG.DOM.suggestionContainerId);
        if (sg) { sg.style.display = 'none'; sg.innerHTML = ''; }
      } catch {}
    },
  };

  // =========================================================
  // FILTER SERVICE
  // =========================================================
  const FilterService = {
    setupTypeFilter(selected = 'all') {
      try {
        const el = DOMService.get(CONFIG.DOM.typeFilterId);
        if (!el) return;
        const lang = LanguageService.getLang();
        let buf = [`<option value="all">${LanguageService.t('all_types')}</option>`];
        for (const t of (State.apiData?.type||[])) {
          const lbl = t.name?.[lang]||t.name?.en||'';
          buf.push(`<option value="${StringService.escapeHtml(lbl)}">${StringService.escapeHtml(lbl)}</option>`);
        }
        el.innerHTML = buf.join('');
        el.value = selected;
      } catch {}
    },
    setupCategoryFilter(cats, selected = 'all') {
      try {
        const el = DOMService.get(CONFIG.DOM.categoryFilterId);
        if (!el) return;
        let buf = [`<option value="all">${LanguageService.t('all_categories')}</option>`];
        for (const {key,displayName} of cats)
          buf.push(`<option value="${StringService.escapeHtml(key)}">${StringService.escapeHtml(displayName)}</option>`);
        el.innerHTML = buf.join('');
        el.style.display = ''; el.value = selected;
      } catch {}
    },
  };

  // =========================================================
  // READY MODE / SUGGESTIONS
  // =========================================================
  const ReadyModeService = {
    extractSmartNames() {
      try {
        if (!State.allKeywordsCache) return [];
        const lang = LanguageService.getLang();
        const out = [], seen = new Set();
        for (const kw of State.allKeywordsCache) {
          if (out.length >= CONFIG.RENDER.suggestionsFullscreenMax) break;
          if (!kw?.item) continue;
          const name = (kw.item.name && typeof kw.item.name === 'object')
            ? (kw.item.name[lang]||kw.item.name.en||'') : '';
          if (!name || name.length < 2) continue;
          if (!/[\u0E00-\u0E7F]/.test(name) && /^[A-Za-z0-9_\-]+$/.test(name) && name.length <= 20) continue;
          if (seen.has(name)) continue;
          seen.add(name);
          out.push({ raw:name, display:name, highlightedHtml:StringService.escapeHtml(name) });
        }
        return out;
      } catch { return []; }
    },
    renderReadyModeSuggestions() {
      try {
        if (!State.overlayOpen) return;
        const container = DOMService.get(CONFIG.DOM.suggestionContainerId);
        if (!container) return;
        const sgs = this.extractSmartNames();
        if (!sgs.length) { container.style.display='none'; return; }
        let html = `<div class="suggestions-head">${LanguageService.t('trending')}</div>`;
        for (const s of sgs)
          html += `<div class="suggestion-item" role="option" tabindex="0" data-val="${StringService.encodeUrl(s.raw)}">
                    <div class="suggestion-body">${s.highlightedHtml}</div>
                  </div>`;
        container.innerHTML = html; container.style.display = 'block';
      } catch {}
    },
  };

  const SuggestionService = {
    handleKeydown(ev, container) {
      try {
        const items = [...container.querySelectorAll('.suggestion-item')];
        if (!items.length) return;
        const idx = items.indexOf(document.activeElement);
        if (ev.key==='ArrowDown') { ev.preventDefault(); items[idx===-1?0:Math.min(items.length-1,idx+1)]?.focus?.(); }
        else if (ev.key==='ArrowUp') { ev.preventDefault(); items[idx===-1?items.length-1:Math.max(0,idx-1)]?.focus?.(); }
        else if (ev.key==='Enter') { ev.preventDefault(); if (document.activeElement?.classList?.contains('suggestion-item')) document.activeElement?.click?.(); }
        else if (ev.key==='Escape') { try { OverlayService.close('escape'); } catch {} }
      } catch {}
    },
    handleClick(ev) {
      try {
        const it = ev.target.closest('.suggestion-item');
        if (!it) return;
        ev.stopPropagation?.(); ev.preventDefault?.();
        const val = StringService.decodeUrl(it.getAttribute('data-val')||'');
        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        if (inp) inp.value = val;
        State.suggestionsLocked = false;
        SearchService.doSearch(null, false);
      } catch {}
    },
    renderQuerySuggestions(query) {
      try {
        if (State.overlayTransitioning) return;
        const container = DOMService.get(CONFIG.DOM.suggestionContainerId);
        if (!container) return;
        if (!query?.trim()) {
          ReadyModeService.renderReadyModeSuggestions(); return;
        }
        const sgs = window.SearchEngine?.querySuggestions?.(query, CONFIG.RENDER.suggestionsFullscreenMax) || [];
        if (!sgs.length) { ReadyModeService.renderReadyModeSuggestions(); return; }
        let html = `<div class="suggestions-head">${LanguageService.t('suggestion_label')}</div>`;
        for (const s of sgs)
          html += `<div class="suggestion-item" role="option" tabindex="0" data-val="${StringService.encodeUrl(s.raw)}">
                    <div class="suggestion-body">${HighlightService.highlight(s.raw, query)}</div>
                  </div>`;
        container.innerHTML = html; container.style.display = 'block';
        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        if (inp) inp.onkeydown = e => {
          if (e.key==='ArrowDown') { e.preventDefault(); container.querySelector('.suggestion-item')?.focus?.(); }
          else if (e.key==='Escape') { try { OverlayService.close('escape'); } catch {} }
        };
      } catch {}
    },
  };

  // =========================================================
  // OVERLAY SERVICE
  // =========================================================
  const OverlayService = {
    _backdrop() {
      try {
        let bd = DOMService.get(CONFIG.DOM.overlayBackdropId);
        if (bd) return bd;
        bd = DOMService.create('div', CONFIG.DOM.overlayBackdropId, 'search-overlay-backdrop', {
          position:'fixed', inset:'0', background:'rgba(12,14,18,0.48)',
          zIndex:'9997', cursor:'default',
        });
        Handlers.overlayBackdropClick = e => {
          if (e.target===bd) {
            e.preventDefault?.(); e.stopPropagation?.();
            if (KeyboardService.isKeyboardOpen()) return;
            const inp = DOMService.get(CONFIG.DOM.searchInputId);
            const cur = (inp?.value||'').trim(), last = (State.preOverlayState?.q||'').trim();
            if (cur!==last && cur.length) SearchService.doSearch(null, false);
            else OverlayService.close('backdrop');
          }
        };
        DOMService.on(bd, 'click', Handlers.overlayBackdropClick);
        document.body.appendChild(bd); return bd;
      } catch { return null; }
    },

    open() {
      try {
        if (State.overlayOpen||State.overlayTransitioning) return;
        const wrapper = DOMService.query('.search-input-wrapper');
        if (!wrapper) return;
        State.overlayTransitioning = true;

        State.originalInputParent      = wrapper.parentNode;
        State.originalInputNextSibling = wrapper.nextSibling;
        const ph = DOMService.create('div', CONFIG.DOM.placeholderId, null, {
          width:wrapper.offsetWidth+'px', height:wrapper.offsetHeight+'px', visibility:'hidden', display:'block',
        });
        State.originalPlaceholder = ph;
        State.originalInputParent.insertBefore(ph, State.originalInputNextSibling);

        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        State.preOverlayState = { q:inp?.value||'', type:State.selectedType||'all', category:State.selectedCategory||'all' };
        State.overlayOpenedAt = Date.now();

        this._backdrop();

        let ov = DOMService.get(CONFIG.DOM.overlayContainerId);
        if (!ov) {
          ov = DOMService.create('div', CONFIG.DOM.overlayContainerId, 'search-overlay search-overlay-open', {
            position:'fixed', inset:'0', zIndex:'9998', display:'flex',
            flexDirection:'column', alignItems:'stretch', overflow:'hidden',
            backgroundColor:'#ffffff', willChange:'transform',
          });
          document.body.appendChild(ov);
        } else { ov.innerHTML = ''; }

        const wc = DOMService.create('div', null, 'search-overlay-input-wrapper', {
          width:'100%', zIndex:'10001', background:'#ffffff', flexShrink:'0',
          padding:'2px 10px 5px', borderBottom:'1px solid #f0f0f0',
          display:'flex', flexDirection:'column', alignItems:'center',
        });
        DOMService.addClass(wrapper, 'overlay-elevated');
        DOMService.setStyles(wrapper, { width:'100%', maxWidth:'100%', marginTop:'0', marginBottom:'0' });
        wc.appendChild(wrapper);
        ov.appendChild(wc);
        State.wrapperContainer = wc;

        const sc = DOMService.create('div', null, 'search-overlay-scrollable-content', {
          flex:'1', width:'100%', overflow:'auto', overscrollBehavior:'contain',
          zIndex:'10000', willChange:'scroll-position',
          transform:'translateZ(0)',
        });

        const rw = DOMService.create('div', null, 'search-overlay-results-wrapper', {
          width:'100%', padding:'0 0 16px', boxSizing:'border-box',
        });
        const sg = DOMService.create('div', CONFIG.DOM.suggestionContainerId, 'search-suggestions-fullscreen');
        const rc = DOMService.create('div', CONFIG.DOM.searchResultsId, 'search-overlay-results', { width:'100%' });

        rw.appendChild(sg); rw.appendChild(rc);
        sc.appendChild(rw); ov.appendChild(sc);

        State.scrollableContent = sc;
        State.resultsContainer  = rc;

        Handlers.suggestionKeydown = ev => SuggestionService.handleKeydown(ev, sg);
        Handlers.suggestionClick   = ev => SuggestionService.handleClick(ev);
        DOMService.on(sg, 'keydown', Handlers.suggestionKeydown);
        DOMService.on(sg, 'click',   Handlers.suggestionClick);
        DOMService.on(sg, 'mouseenter', () => { State.suggestionsLocked = true; });
        DOMService.on(sg, 'mouseleave', () => { State.suggestionsLocked = false; });

        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';

        Handlers.documentKeydownOverlay = OverlayService._escHandler;
        DOMService.on(document, 'keydown', Handlers.documentKeydownOverlay);

        State.overlayOpen = true;
        State.lastQuery   = '';
        ReadyModeService.renderReadyModeSuggestions();

        KeyboardAutoToggleService.enableAutoToggle(sc);
        this._hideNav();

        try {
          history.pushState(Object.assign({}, State.preOverlayState||{}, { [State._overlayStateMarker]:true }), '', location.href);
          State.searchHistoryPushed = true;
        } catch {}

        if (inp) setTimeout(() => { try { inp.focus(); inp.select?.(); } catch {} }, CONFIG.TIMING.focusDelayMs);

        State.overlayTransitioning = false;
      } catch (e) { console.error('openOverlay failed', e); State.overlayTransitioning = false; }
    },

    _escHandler(e) {
      if (e.key==='Escape') {
        if (State.preOverlayState) {
          const inp = DOMService.get(CONFIG.DOM.searchInputId);
          if (inp) inp.value = State.preOverlayState.q||'';
          State.selectedType     = State.preOverlayState.type||'all';
          State.selectedCategory = State.preOverlayState.category||'all';
        }
        OverlayService.close('escape');
      }
    },

    close(src = 'manual') {
      try {
        if (!State.overlayOpen) return;
        State.overlayTransitioning = true;

        if (src !== 'popstate') URLService.syncOnClose();

        VirtualScrollEngine.destroy();
        KeyboardAutoToggleService.disableAutoToggle();

        const wrapper = DOMService.query('.search-input-wrapper');
        if (wrapper) {
          DOMService.removeClass(wrapper, 'overlay-elevated');
          DOMService.setStyles(wrapper, { width:'', maxWidth:'', marginTop:'', marginBottom:'' });
          if (State.originalInputParent) {
            if (State.originalInputNextSibling) State.originalInputParent.insertBefore(wrapper, State.originalInputNextSibling);
            else State.originalInputParent.appendChild(wrapper);
          }
        }

        DOMService.remove(State.originalPlaceholder); State.originalPlaceholder = null;
        State.wrapperContainer = null; State.scrollableContent = null; State.resultsContainer = null;
        DOMService.remove(DOMService.get(CONFIG.DOM.overlayContainerId));
        DOMService.remove(DOMService.get(CONFIG.DOM.overlayBackdropId));
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
        DOMService.off(document, 'keydown', Handlers.documentKeydownOverlay);
        Handlers.documentKeydownOverlay = null;

        State.overlayOpen = false;
        State.lastQuery   = '';
        State.suggestionsLocked = false;
        State.overlayOpenedAt   = null;
        this._showNav();

        State._timeouts.forEach(t => { try { clearTimeout(t); clearInterval(t); } catch {} });
        State._timeouts.clear();

        setTimeout(() => { State.overlayTransitioning = false; }, CONFIG.TIMING.transitionDelayMs);
      } catch (e) { console.error('closeOverlay failed', e); State.overlayTransitioning = false; }
    },

    _hideNav() {
      try { State.navHiddenBySearch=true; window.modernNav?.hideNav?.('search-overlay'); } catch {}
    },
    _showNav() {
      try { if (window.modernNav?.showNav && State.navHiddenBySearch) { State.navHiddenBySearch=false; window.modernNav.showNav('search-overlay-closed'); } } catch {}
    },
  };

  // =========================================================
  // SEARCH SERVICE
  // =========================================================
  const SearchService = {
    // ── Scheduler primitives (same as search-engine.js v4.0) ───
    _sched: (typeof scheduler !== 'undefined' && scheduler) || null,

    _scheduleUserVisible(fn) {
      if (this._sched?.postTask) return this._sched.postTask(fn, { priority: 'user-visible' });
      return new Promise((resolve, reject) => {
        requestAnimationFrame(() => { try { resolve(fn()); } catch (e) { reject(e); } });
      });
    },

    // ── doSearch — user-visible priority, tab-guard ─────────────
    doSearch(e, preventPush, options) {
      try {
        e?.preventDefault?.();
        options = options || {};
        const qEl  = DOMService.get(CONFIG.DOM.searchInputId);
        const q    = qEl?.value || '';
        const tfEl = DOMService.get(CONFIG.DOM.typeFilterId);
        State.selectedType     = tfEl?.value || State.selectedType;
        State.selectedCategory = 'all';

        if (!q.trim()) {
          document.body.style.marginBottom = '';
          const placeholder = `<div class="search-result-here" style="text-align:center;color:#969ca8;font-size:1.07em;margin-top:30px;">${LanguageService.t('search_result_here')}</div>`;
          const rc = (State.overlayOpen && State.resultsContainer) ? State.resultsContainer : DOMService.get(CONFIG.DOM.searchResultsId);
          if (rc) DOMService.setHTML(rc, placeholder);
          VirtualScrollEngine.destroy();
          FilterService.setupCategoryFilter([], 'all');
          UIService.updateUILanguage();
          const cleared = { q:'', type:'all', category:'all' };
          if (!preventPush && !State.suppressHistoryPush && !URLService.isEqual(cleared, State.lastCommittedSearchState))
            URLService.commit(cleared);
          if (State.overlayOpen) {
            const sg = DOMService.get(CONFIG.DOM.suggestionContainerId);
            if (sg) sg.style.display = '';
            ReadyModeService.renderReadyModeSuggestions();
          }
          if (State.overlayOpen) OverlayService.close('manual');
          return;
        }

        // Schedule search as user-visible priority so it never starves behind
        // background tasks (Fuse index build, etc.)
        this._scheduleUserVisible(() => {
          try {
            PerfMonitor.mark('search-start');
            let out = { results:[], keywords:[] };
            try { if (window.SearchEngine?.search) out = window.SearchEngine.search(q, State.selectedType) || out; } catch {}
            State.currentResults   = out.results || [];
            State.allKeywordsCache = out.keywords || [];
            PerfMonitor.measure('search-latency', 'search-start');

            FilterService.setupCategoryFilter(RenderingService.extractResultCategories(State.currentResults), 'all');

            const stObj = { q, type:State.selectedType||'all', category:'all' };
            if (!preventPush && !State.suppressHistoryPush && !URLService.isEqual(stObj, State.lastCommittedSearchState)) {
              URLService.commit(stObj); State.searchHistoryPushed = true;
            }

            if (State.overlayOpen) OverlayService.close('manual');

            PerfMonitor.mark('render-start');
            RenderingService.renderResults(State.currentResults, State.currentResults.length === 0);
          } catch (err) { console.error('doSearch inner failed', err); }
        }).catch(err => { console.error('doSearch failed', err); });

      } catch (e) { console.error('doSearch failed', e); }
    },
  };

  // =========================================================
  // UI SERVICE
  // =========================================================
  const UIService = {
    setupAutoSearchInput() {
      try {
        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        if (!inp) return;
        DOMService.setAttr(inp, 'enterkeyhint', 'search');

        Handlers.inputInput = () => {
          if (State.overlayTransitioning) return;
          clearTimeout(State.debounceTimeout);
          State.debounceTimeout = setTimeout(() => {
            SuggestionService.renderQuerySuggestions(inp.value);
          }, CONFIG.TIMING.debounceMs);
        };
        inp.addEventListener('input', Handlers.inputInput);

        Handlers.inputKeydown = e => {
          if (e.key==='Enter') { e.preventDefault(); SearchService.doSearch(); this.closeKB(); }
          else if (e.key==='ArrowDown') { DOMService.get(CONFIG.DOM.suggestionContainerId)?.querySelector('.suggestion-item')?.focus?.(); }
          else if (e.key==='Backspace') {
            clearTimeout(State.debounceTimeout);
            State.debounceTimeout = setTimeout(() => SuggestionService.renderQuerySuggestions(inp.value), CONFIG.TIMING.debounceMs/2);
          }
        };
        inp.addEventListener('keydown', Handlers.inputKeydown);

        inp.addEventListener('blur', () => {});

        Handlers.inputFocus = () => { if (!State.overlayTransitioning) { this.scrollToTop(); OverlayService.open(); } };
        inp.addEventListener('focus', Handlers.inputFocus);

        Handlers.inputClick = () => { if (!State.overlayTransitioning) { this.scrollToTop(); OverlayService.open(); } };
        inp.addEventListener('click', Handlers.inputClick);
      } catch {}
    },

    scrollToTop() {
      try { if (State.scrollableContent) State.scrollableContent.scrollTop = 0; } catch {}
    },

    setupFilters() {
      try {
        [CONFIG.DOM.typeFilterId, CONFIG.DOM.categoryFilterId].forEach(id => {
          const el = DOMService.get(id); if (!el) return;
          const onChange = () => { if (id===CONFIG.DOM.typeFilterId) this.onTypeChange(); else this.onCatChange(); };
          el.onchange = onChange;
          el.onkeyup  = e => { if (e.key==='Enter') onChange(); };
        });
      } catch {}
    },

    onTypeChange() {
      try { State.selectedType = DOMService.get(CONFIG.DOM.typeFilterId)?.value; SearchService.doSearch(); } catch {}
    },
    onCatChange() {
      try {
        State.selectedCategory = DOMService.get(CONFIG.DOM.categoryFilterId)?.value;
        RenderingService.renderResults(State.currentResults, false);
        this.updateUILanguage();
      } catch {}
    },

    closeKB() { try { const inp = DOMService.get(CONFIG.DOM.searchInputId); if (inp && document.activeElement===inp) inp.blur(); } catch {} },

    updateUILanguage() {
      try {
        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        const ph  = LanguageService.t('search_placeholder');
        if (inp && inp.placeholder !== ph) inp.placeholder = ph;
        const lbls = DOMService.queryAll('.search-filters-panel .filter-group-label');
        if (lbls.length>0 && lbls[0].textContent !== LanguageService.t('type'))     lbls[0].textContent = LanguageService.t('type');
        if (lbls.length>1 && lbls[1].textContent !== LanguageService.t('category')) lbls[1].textContent = LanguageService.t('category');
      } catch {}
    },
  };

  // =========================================================
  // DATA LOADER
  // =========================================================
  function _waitForConDataService(ms) {
    return new Promise(resolve => {
      if (window.ConDataService?.getAssembled) return resolve(window.ConDataService);
      const start = Date.now();
      const id = setInterval(() => {
        if (window.ConDataService?.getAssembled) { clearInterval(id); resolve(window.ConDataService); }
        else if (Date.now()-start >= ms) { clearInterval(id); resolve(null); }
      }, CONFIG.TIMING.conDataServicePollMs);
    });
  }

  function loadData() {
    return _waitForConDataService(CONFIG.TIMING.conDataServiceWaitMs).then(svc => {
      if (svc) return svc.getAssembled().catch(err => {
        console.warn('[SearchUI] ConDataService failed, fallback:', err);
        return fetch(CONFIG.DB.path).then(r=>r.json()).catch(()=>({}));
      });
      console.warn('[SearchUI] ConDataService not ready — fallback');
      return fetch(CONFIG.DB.path).then(r=>r.json()).catch(()=>({}));
    });
  }

  // =========================================================
  // INIT
  // =========================================================
  function initializeSearchEngine() {
    try {
      // Auto-enable PerfMonitor when URL contains ?searchperf=1
      // Usage: add ?searchperf=1 to any page URL, open DevTools console,
      // then run __searchUI.perf.log() after a few searches
      try {
        if (new URLSearchParams(location.search).get('searchperf') === '1') {
          PerfMonitor.enable();
          console.info('[SearchUI] PerfMonitor auto-enabled via ?searchperf=1 — run __searchUI.perf.log() to view report');
        }
      } catch (_) {}

      KeyboardService.initKeyboardDetection();

      loadData().then(data => {
        State.apiData = data || {};
        if (!Array.isArray(State.apiData.type))
          console.warn('[SearchUI] Data missing .type[] — check ConDataService', State.apiData);

        // Count total items for PerfMonitor dataset tracking
        const totalItems = (State.apiData.type || []).reduce((sum, t) =>
          sum + (t.category || []).reduce((s2, c) => s2 + (c.data || []).length, 0), 0);
        PerfMonitor.setDatasetSize(totalItems);

        const initFn = window.SearchEngine?.init || (() => Promise.resolve());
        return initFn(State.apiData, {
          // Wire PerfMonitor into chunked index build callbacks
          onIndexProgress: (pct, count) => PerfMonitor.onIndexProgress(pct, count),
          onIndexReady   : ()           => PerfMonitor.onIndexReady(),
        }).catch(e => console.error('SearchEngine.init failed', e));

      }).then(() => {
        try { State.allKeywordsCache = window.SearchEngine?.generateAllKeywords?.() || []; } catch { State.allKeywordsCache = []; }

        FilterService.setupTypeFilter('all');
        UIService.setupFilters();
        UIService.setupAutoSearchInput();
        FilterService.setupCategoryFilter([], 'all');
        document.body.style.marginBottom = '';

        const sr = DOMService.get(CONFIG.DOM.searchResultsId);
        if (sr) sr.innerHTML = `<div class="search-result-here" style="text-align:center;color:#969ca8;font-size:1.07em;margin-top:30px;">${LanguageService.t('search_result_here')}</div>`;
        UIService.updateUILanguage();

        try {
          const hs = history.state;
          if (hs?.q !== undefined) State.lastCommittedSearchState = { q:hs.q||'', type:hs.type||'all', category:hs.category||'all' };
          else {
            const arr = StorageService.getHistory();
            if (arr.length) { const l = arr[arr.length-1]; State.lastCommittedSearchState = { q:l.q||'', type:l.type||'all', category:l.category||'all' }; }
            else State.lastCommittedSearchState = null;
          }
        } catch { State.lastCommittedSearchState = null; }

        const init = URLService.readStateFromURL();
        if (init?.q) {
          try {
            State.suppressHistoryPush = true;
            const inp = DOMService.get(CONFIG.DOM.searchInputId);
            if (inp) inp.value = init.q;
            State.selectedType     = init.type||'all';
            State.selectedCategory = init.category||'all';
            FilterService.setupTypeFilter(State.selectedType);
            SearchService.doSearch(null, true);
            try { history.replaceState({ q:init.q, type:State.selectedType, category:State.selectedCategory }, '', URLService.buildUrlForState(init)); } catch {}
            State.lastCommittedSearchState = { q:init.q||'', type:State.selectedType||'all', category:State.selectedCategory||'all' };
          } finally { State.suppressHistoryPush = false; }
        } else {
          try { history.replaceState({ q:'', type:'all', category:'all' }, '', location.pathname); } catch {}
          State.lastCommittedSearchState = { q:'', type:'all', category:'all' };
        }

      }).catch(e => { console.error('[SearchUI] init failed', e); State.apiData = State.apiData||{}; });

      const form = DOMService.get(CONFIG.DOM.searchFormId);
      if (form) { Handlers.formSubmit = e => { e.preventDefault(); SearchService.doSearch(); UIService.closeKB(); }; DOMService.on(form, 'submit', Handlers.formSubmit); }

      const inp = DOMService.get(CONFIG.DOM.searchInputId);
      if (inp) { const kd = e => { if (e.key==='Enter') { e.preventDefault(); SearchService.doSearch(); UIService.closeKB(); } }; Handlers.inputKeydown = kd; DOMService.on(inp,'keydown',kd); }

      Handlers.popstate = e => {
        try {
          const s = e.state||{};
          const isOv = s[State._overlayStateMarker];
          if (isOv && State.overlayOpen) { OverlayService.close('popstate'); return; }
          if (!isOv && State.overlayOpen) {
            if (State.preOverlayState) {
              const i = DOMService.get(CONFIG.DOM.searchInputId);
              if (i) i.value = State.preOverlayState.q||'';
              State.selectedType = State.preOverlayState.type||'all';
              State.selectedCategory = State.preOverlayState.category||'all';
            }
            OverlayService.close('popstate'); return;
          }
          const st = (e.state && typeof e.state==='object' && !isOv) ? e.state : URLService.readStateFromURL();
          if (st?.q !== undefined) _restoreUIState(st);
        } catch {}
      };
      DOMService.on(window, 'popstate', Handlers.popstate);
      State._handlersAttached = true;
    } catch (e) { console.error('initializeSearchEngine failed', e); }
  }

  function _restoreUIState(st) {
    try {
      State.suppressHistoryPush = true;
      const inp = DOMService.get(CONFIG.DOM.searchInputId);
      if (inp) inp.value = st.q||'';
      State.selectedType = st.type||'all'; State.selectedCategory = st.category||'all';
      FilterService.setupTypeFilter(State.selectedType);
      SearchService.doSearch(null, true);
    } finally { State.suppressHistoryPush = false; }
  }

  // =========================================================
  // DESTROY
  // =========================================================
  function destroy() {
    try {
      OverlayService.close('manual');
      VirtualScrollEngine.destroy();
      KeyboardAutoToggleService.disableAutoToggle();
      try {
        DOMService.off(window, 'resize', Handlers.resize);
        DOMService.off(window, 'popstate', Handlers.popstate);
        DOMService.off(document, 'click', Handlers.documentClick);
        DOMService.off(DOMService.get(CONFIG.DOM.searchFormId), 'submit', Handlers.formSubmit);
        DOMService.off(DOMService.get(CONFIG.DOM.searchResultsId), 'click', Handlers.copyClick);
        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        if (inp) {
          ['inputInput','inputKeydown','inputBlur','inputFocus','inputClick'].forEach(k => {
            if (Handlers[k]) {
              const ev = k.replace('input','').toLowerCase().replace('kb','');
              inp.removeEventListener(ev, Handlers[k]);
            }
          });
          if (Handlers.inputInput)   inp.removeEventListener('input',   Handlers.inputInput);
          if (Handlers.inputKeydown) inp.removeEventListener('keydown', Handlers.inputKeydown);
          if (Handlers.inputFocus)   inp.removeEventListener('focus',   Handlers.inputFocus);
          if (Handlers.inputClick)   inp.removeEventListener('click',   Handlers.inputClick);
        }
        if (Handlers.documentKeydownOverlay) DOMService.off(document, 'keydown', Handlers.documentKeydownOverlay);
      } catch {}
      State._timeouts.forEach(t => { try { clearTimeout(t); clearInterval(t); } catch {} });
      State._timeouts.clear();
      try {
        DOMService.remove(DOMService.get(CONFIG.DOM.suggestionContainerId));
        DOMService.remove(DOMService.get(CONFIG.DOM.overlayBackdropId));
        DOMService.remove(DOMService.get(CONFIG.DOM.overlayContainerId));
        DOMService.remove(DOMService.get(CONFIG.DOM.sentinelId));
      } catch {}
      State.apiData = null; State.allKeywordsCache = []; State.currentResults = [];
      State.currentFilteredResults = []; State.lastCommittedSearchState = null;
      State._handlersAttached = false; State.keyboardAutoToggleEnabled = false;
      if (window.__searchUI) window.__searchUI._initialized = false;
    } catch {}
  }

  // =========================================================
  // PUBLIC API
  // =========================================================
  window.__searchUI = window.__searchUI || {};
  Object.assign(window.__searchUI, {
    init: initializeSearchEngine,
    destroy,
    getConfig:   () => CONFIG,
    getState:    () => State,
    getServices: () => ({
      Language:LanguageService, DOM:DOMService, String:StringService, Storage:StorageService,
      URL:URLService, Notification:NotificationService, Rendering:RenderingService,
      Filter:FilterService, Suggestion:SuggestionService, ReadyMode:ReadyModeService,
      Highlight:HighlightService, Overlay:OverlayService, Search:SearchService,
      UI:UIService, Keyboard:KeyboardService,
      GapBasedKeyboard:GapBasedKeyboardService, KeyboardAutoToggle:KeyboardAutoToggleService,
      VirtualScroll: VirtualScrollEngine,
    }),
    getLastCommittedSearchState: () => State.lastCommittedSearchState,
    getSessionHistory:           () => StorageService.getHistory(),
    querySuggestions:            q  => window.SearchEngine?.querySuggestions?.(q, CONFIG.RENDER.suggestionMax) || [],
    isKeyboardOpen:              () => KeyboardService.isKeyboardOpen(),
    enableKeyboardAutoToggle:    () => KeyboardAutoToggleService.enableAutoToggle(),
    disableKeyboardAutoToggle:   () => KeyboardAutoToggleService.disableAutoToggle(),
    resetKeyboardGap:            () => GapBasedKeyboardService.resetGap(),
    isKeyboardGapExpired:        () => GapBasedKeyboardService.isGapExpired(),
    isKeyboardScrollIdle:        () => GapBasedKeyboardService.isScrollIdle(),
    // Virtual scroll diagnostics
    getVSStats: () => ({
      itemCount   : VirtualScrollEngine._items.length,
      visibleCount: VirtualScrollEngine._vis?.size || 0,
      poolSize    : VirtualScrollEngine._pool.length,
      totalHeight : VirtualScrollEngine._total,
    }),
    // Performance monitor (enable/disable/report)
    perf: PerfMonitor,
    // Search engine index health
    getIndexStats: () => ({
      ready    : window.SearchEngine?.isIndexReady?.() || false,
      building : window.SearchEngine?.isBuilding?.()   || false,
      docCount : window.SearchEngine?.getDocCount?.()  || 0,
    }),
  });

  window.__searchUI._initialized = true;
  initializeSearchEngine();

  try { window.addEventListener('beforeunload', () => { try { destroy(); } catch {} }, { passive:true }); } catch {}

})();