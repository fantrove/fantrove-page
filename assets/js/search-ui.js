/*
  search-ui.js  v3.1  —  Production-Grade Performance
  =====================================================
  Changes from v3.0:

  OVERLAY UX
  ✅ Clean platform-style overlay design (Google/iOS Search style)
  ✅ Search icon replaced with back arrow (←) when overlay is open
  ✅ Back arrow closes overlay (with or without query)
  ✅ No auto-select on input when overlay opens (cursor placed at end)
  ✅ Clear (✕) button appears when input has text

  URL SEARCH FIX
  ✅ Retry logic when SearchEngine not ready at URL init time
  ✅ Waits for docs to be built before running URL-triggered search
  ✅ Falls back gracefully after max retries

  BACKWARD-COMPAT
  ✅ All public API methods preserved
  ✅ ConDataService timing fix (v2.2) retained
  ✅ CSS class names unchanged
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
      sentinelId            : 'search-render-sentinel',
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
      vsOverscanPx                : 320,
      vsPoolMax                   : 40,
      vsEstimatedItemHeight       : 96,
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
      // URL search retry settings
      urlSearchRetryMs        : 200,
      urlSearchMaxRetries     : 25,
    },
    STORAGE : { historyKey: 'searchHistory_v1', langKey: 'selectedLang' },
    DB      : { path: '/assets/db/db.min.json' },
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
    originalInputStyles: '',
    originalPlaceholder: null,
    debounceTimeout: null,
    suggestionsLocked: false,
    _timeouts: new Set(),
    _handlersAttached: false,
    _overlayStateMarker: '__searchUI_overlay_open__',
    wrapperContainer: null,
    navHiddenBySearch: false,
    keyboardAutoToggleEnabled: false,
    lastOverlayScrollY: 0,
    keyboardAutoToggleHandler: null,
    lastKeyboardToggleTime: 0,
    lastScrollTime: 0,
    isScrollingActive: false,
    scrollIdleTimer: null,
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
    OVERSCAN : CONFIG.RENDER.vsOverscanPx,
    POOL_MAX : CONFIG.RENDER.vsPoolMax,
    EST_H    : CONFIG.RENDER.vsEstimatedItemHeight,

    _vp:null, _host:null, _box:null, _items:[], _fn:null, _lang:'en',
    _hgt:null, _off:null, _total:0,
    _vis:null, _pool:[],
    _raf:null, _onScroll:null, _vpObs:null, _sgObs:null,

    mount(viewport, host, items, renderFn, lang) {
      this.destroy();
      this._vp = viewport; this._host = host;
      this._items = items || []; this._fn = renderFn; this._lang = lang || 'en';
      this._vis = new Map();
      this._hgt = new Float32Array(this._items.length).fill(this.EST_H);
      this._buildOff();

      const box = document.createElement('div');
      box.className = 'vs-container';
      box.style.cssText = `position:relative;height:${this._total}px;min-height:2px;contain:layout style;`;
      host.appendChild(box);
      this._box = box;

      this._onScroll = () => this._sched();
      viewport.addEventListener('scroll', this._onScroll, { passive:true });

      if ('ResizeObserver' in window) {
        this._vpObs = new ResizeObserver(() => this._sched());
        this._vpObs.observe(viewport);
        const sg = viewport.querySelector('#' + CONFIG.DOM.suggestionContainerId);
        if (sg) { this._sgObs = new ResizeObserver(() => this._sched()); this._sgObs.observe(sg); }
      }
      this._sched();
    },

    destroy() {
      if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
      if (this._vp && this._onScroll) this._vp.removeEventListener('scroll', this._onScroll);
      this._vpObs?.disconnect(); this._vpObs = null;
      this._sgObs?.disconnect(); this._sgObs = null;
      this._box?.remove(); this._box = null;
      this._vis?.clear(); this._pool = []; this._items = [];
      this._vp = this._host = this._fn = this._onScroll = null;
      this._vis = null;
    },

    _sched() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = null; this._render(); });
    },

    _buildOff() {
      const n = this._hgt.length;
      this._off = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) this._off[i+1] = this._off[i] + this._hgt[i];
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
      const st = this._vp.scrollTop, vh = this._vp.clientHeight;
      if (!vh) return;
      const co = this._coOff();
      const lo = st - co - this.OVERSCAN, hi = st - co + vh + this.OVERSCAN;
      const si = this._find(Math.max(0,lo));
      const ei = Math.min(this._items.length - 1, this._find(Math.max(0,hi)) + 1);

      const recycle = [];
      for (const [idx, el] of this._vis) { if (idx < si || idx > ei) recycle.push([idx, el]); }

      const frag = document.createDocumentFragment();
      const meas = [];

      for (const [idx, el] of recycle) {
        el.style.display = 'none';
        this._vis.delete(idx);
        if (this._pool.length < this.POOL_MAX) this._pool.push(el); else el.remove();
      }

      for (let i = si; i <= ei; i++) {
        if (this._vis.has(i)) continue;
        const top = this._off[i];
        const html = this._fn(this._items[i], this._lang);
        let el = this._pool.pop();
        if (el) {
          el.style.cssText = `position:absolute;left:0;right:0;top:${top}px;`;
          el.style.display = ''; el.innerHTML = html;
        } else {
          el = document.createElement('div');
          el.className = 'vs-item';
          el.style.cssText = `position:absolute;left:0;right:0;top:${top}px;contain:layout style paint;`;
          el.innerHTML = html;
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
        const st = this._vp?.scrollTop || 0, co = this._coOff();
        let adj = 0;
        for (const [i, h] of reads) {
          const diff = h - this._hgt[i];
          if (Math.abs(diff) <= 4) continue;
          if (this._off[i] + co < st) adj += diff;
          this._hgt[i] = h; changed = true;
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
      if ('requestIdleCallback' in window) requestIdleCallback(exec, { timeout:500 });
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
      State.lastScrollTime = Date.now(); State.isScrollingActive = true;
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
      el.addEventListener('scroll', State.keyboardAutoToggleHandler, { passive:true });
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
          }, { passive:true });
        } else {
          Handlers.resize = () => {
            clearTimeout(State.keyboardDetectionTimeout);
            State.keyboardDetectionTimeout = setTimeout(() => this._update(), CONFIG.TIMING.keyboardDetectionDelayMs);
          };
          DOMService.on(window, 'resize', Handlers.resize, { passive:true });
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
        const cur = (window.visualViewport?.height) || window.innerHeight || 0;
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
          try { Object.assign(t.style,{opacity:'0',transform:'translateY(-10px)'}); setTimeout(()=>DOMService.remove(t), CONFIG.TIMING.toastFadeMs); } catch {}
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
  // OVERLAY INPUT BAR  (v3.1 — platform-style: back + input + clear)
  // =========================================================
  const OverlayInputBarService = {
    _bar: null,
    _inputWrap: null,

    build(overlayEl) {
      const bar = DOMService.create('div', 'overlay-search-bar', null, {
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        padding: '8px 12px',
        background: '#fff',
        borderBottom: '1px solid rgba(0,0,0,0.07)',
        gap: '8px',
        boxSizing: 'border-box',
        flexShrink: '0',
        zIndex: '10001',
        minHeight: '56px',
      });

      // ── Back arrow ───────────────────────────────────
      const backBtn = document.createElement('button');
      backBtn.id = 'overlay-back-btn';
      backBtn.setAttribute('aria-label', 'ย้อนกลับ');
      backBtn.style.cssText = [
        'background:none', 'border:none', 'cursor:pointer',
        'padding:8px', 'display:flex', 'align-items:center',
        'justify-content:center', 'flex-shrink:0',
        'border-radius:50%', 'width:40px', 'height:40px',
        'color:#444', 'transition:background 150ms ease',
        'outline:none', '-webkit-tap-highlight-color:transparent',
      ].join(';');
      backBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="M12 5l-7 7 7 7"/></svg>`;
      backBtn.addEventListener('pointerenter', () => { backBtn.style.background = 'rgba(0,0,0,0.06)'; });
      backBtn.addEventListener('pointerleave', () => { backBtn.style.background = 'none'; });
      backBtn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        OverlayService.close('back-btn');
      });

      // ── Input pill ───────────────────────────────────
      const inputWrap = DOMService.create('div', 'overlay-input-pill', null, {
        flex: '1',
        display: 'flex',
        alignItems: 'center',
        background: '#f4f6f8',
        borderRadius: '24px',
        padding: '0 12px 0 14px',
        height: '42px',
        gap: '6px',
        overflow: 'hidden',
        minWidth: '0',
      });
      this._inputWrap = inputWrap;

      const inp = DOMService.get(CONFIG.DOM.searchInputId);
      if (inp) {
        // Restyle input for overlay bar
        inp.style.cssText = [
          'flex:1', 'background:transparent', 'border:none',
          'outline:none', 'font-size:1rem', 'font-weight:600',
          'color:#0f2335', 'min-width:0', 'padding:0',
          'font-family:inherit', 'letter-spacing:.2px',
        ].join(';');
        inputWrap.appendChild(inp);

        // Focus without selecting
        setTimeout(() => {
          try {
            inp.focus();
            const len = inp.value.length;
            inp.setSelectionRange(len, len);
          } catch {}
        }, CONFIG.TIMING.focusDelayMs);
      }

      // ── Clear (✕) button ─────────────────────────────
      const clearBtn = document.createElement('button');
      clearBtn.id = 'overlay-clear-btn';
      clearBtn.setAttribute('aria-label', 'ล้างคำค้นหา');
      clearBtn.style.cssText = [
        'background:rgba(0,0,0,0.12)', 'border:none', 'cursor:pointer',
        'padding:0', 'display:flex', 'align-items:center',
        'justify-content:center', 'flex-shrink:0',
        'width:20px', 'height:20px', 'min-width:20px',
        'color:#555', 'border-radius:50%',
        'transition:opacity 120ms ease',
        '-webkit-tap-highlight-color:transparent',
      ].join(';');
      clearBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

      const syncClear = () => {
        const has = inp && inp.value.length > 0;
        clearBtn.style.opacity = has ? '1' : '0';
        clearBtn.style.pointerEvents = has ? 'auto' : 'none';
      };
      syncClear();
      if (inp) inp.addEventListener('input', syncClear);

      clearBtn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        if (inp) {
          inp.value = '';
          inp.focus();
          syncClear();
          SearchService.doSearch(null, false);
        }
      });

      inputWrap.appendChild(clearBtn);
      bar.appendChild(backBtn);
      bar.appendChild(inputWrap);
      overlayEl.appendChild(bar);
      this._bar = bar;
      return bar;
    },

    syncClearBtn() {
      const clearBtn = DOMService.get('overlay-clear-btn');
      const inp = DOMService.get(CONFIG.DOM.searchInputId);
      if (!clearBtn || !inp) return;
      const has = inp.value.length > 0;
      clearBtn.style.opacity = has ? '1' : '0';
      clearBtn.style.pointerEvents = has ? 'auto' : 'none';
    },

    destroy() {
      this._bar = null;
      this._inputWrap = null;
    },
  };

  // =========================================================
  // RENDERING SERVICE
  // =========================================================
  const RenderingService = {
    renderResultItem(item, lang) {
      try {
        const itemData = item.item || item;
        const rawText  = itemData?.text || '';
        const itemText = rawText || itemData?.name?.[lang] || itemData?.name?.en || item.itemName || '';
        const itemApi  = itemData?.api || '';
        const typeName = item.typeName || item.typeObj?.name?.[lang] || item.typeObj?.name?.en || LanguageService.t('emoji');
        const catName  = item.catName  || item.category?.name?.[lang] || item.category?.name?.en || '';

        const names = [];
        if (item.itemName) names.push(item.itemName);
        if (itemData?.name) { const n = itemData.name[lang]||itemData.name.en; if (n && !names.includes(n)) names.push(n); }
        for (const k in (itemData||{})) {
          if (/_name$/.test(k) && itemData[k]) { const n = itemData[k][lang]||itemData[k].en; if (n && !names.includes(n)) names.push(n); }
        }
        const nameStr = names.filter(Boolean).join(' / ');
        const text    = itemText || itemApi || '-';
        const words   = text.trim().split(/\s+/);
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
            for (const it of (c0?.data?.slice(0,5)||[])) {
              html += this.renderResultItem({ item:it, typeObj:t0, category:c0,
                itemName:it.name?.[lang]||it.name?.en||'',
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

        if (State.overlayOpen && State.scrollableContent) {
          VirtualScrollEngine.mount(
            State.scrollableContent, container, filtered,
            (item, l) => this.renderResultItem(item, l), lang
          );
        } else {
          requestAnimationFrame(() => { this._batchRender(filtered, container, lang); });
        }

        this._attachCopyHandler(container);
        UIService.updateUILanguage();
      } catch (e) { console.error('renderResults failed', e); }
    },

    _batchRender(items, container, lang) {
      try {
        const tpl = document.createElement('template');
        tpl.innerHTML = items.map(item => this.renderResultItem(item, lang)).join('');
        container.appendChild(tpl.content);
        this._attachCopyHandler(container);
      } catch (e) { console.error('_batchRender failed', e); }
    },

    _attachCopyHandler(container) {
      if (!window._copyResultTextHandlerSet) {
        Handlers.copyClick = e => {
          const btn = e.target.closest('.result-copy-btn');
          if (btn?.hasAttribute('data-text')) { e.preventDefault(); NotificationService.copyText(StringService.decodeUrl(btn.getAttribute('data-text'))); }
        };
        DOMService.on(container, 'click', Handlers.copyClick);
        window._copyResultTextHandlerSet = true;
      }
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
          seen.add(name); out.push({ raw:name, display:name, highlightedHtml:StringService.escapeHtml(name) });
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
          html += `<div class="suggestion-item" role="option" tabindex="0" data-val="${StringService.encodeUrl(s.raw)}"><div class="suggestion-body">${s.highlightedHtml}</div></div>`;
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
        OverlayInputBarService.syncClearBtn();
        SearchService.doSearch(null, false);
      } catch {}
    },
    renderQuerySuggestions(query) {
      try {
        if (State.overlayTransitioning) return;
        const container = DOMService.get(CONFIG.DOM.suggestionContainerId);
        if (!container) return;
        if (!query?.trim()) { ReadyModeService.renderReadyModeSuggestions(); return; }
        const sgs = window.SearchEngine?.querySuggestions?.(query, CONFIG.RENDER.suggestionsFullscreenMax) || [];
        if (!sgs.length) { ReadyModeService.renderReadyModeSuggestions(); return; }
        let html = `<div class="suggestions-head">${LanguageService.t('suggestion_label')}</div>`;
        for (const s of sgs)
          html += `<div class="suggestion-item" role="option" tabindex="0" data-val="${StringService.encodeUrl(s.raw)}"><div class="suggestion-body">${HighlightService.highlight(s.raw, query)}</div></div>`;
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
  // OVERLAY SERVICE  (v3.1)
  // =========================================================
  const OverlayService = {
    open() {
      try {
        if (State.overlayOpen || State.overlayTransitioning) return;
        State.overlayTransitioning = true;

        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        State.preOverlayState = {
          q: inp?.value || '',
          type: State.selectedType || 'all',
          category: State.selectedCategory || 'all',
        };
        State.overlayOpenedAt = Date.now();

        // Save input's original position for restore
        State.originalInputStyles = inp ? inp.style.cssText : '';

        // ── Build full-screen overlay ──────────────────────
        let ov = DOMService.get(CONFIG.DOM.overlayContainerId);
        if (!ov) {
          ov = DOMService.create('div', CONFIG.DOM.overlayContainerId, 'search-overlay search-overlay-open', {
            position: 'fixed',
            inset: '0',
            zIndex: '9998',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            overflow: 'hidden',
            backgroundColor: '#ffffff',
          });
          document.body.appendChild(ov);
        } else {
          ov.innerHTML = '';
        }

        // ── Platform-style input bar (back arrow + input + clear) ──
        OverlayInputBarService.build(ov);

        // ── Scrollable area ────────────────────────────────
        const sc = DOMService.create('div', null, 'search-overlay-scrollable-content', {
          flex: '1',
          width: '100%',
          overflow: 'auto',
          overscrollBehavior: 'contain',
          zIndex: '10000',
          willChange: 'scroll-position',
          transform: 'translateZ(0)',
        });

        const rw = DOMService.create('div', null, 'search-overlay-results-wrapper', {
          width: '100%',
          padding: '0 0 16px',
          boxSizing: 'border-box',
        });

        const sg = DOMService.create('div', CONFIG.DOM.suggestionContainerId, 'search-suggestions-fullscreen');
        const rc = DOMService.create('div', CONFIG.DOM.searchResultsId, 'search-overlay-results', { width:'100%' });

        rw.appendChild(sg); rw.appendChild(rc);
        sc.appendChild(rw); ov.appendChild(sc);

        State.scrollableContent = sc;
        State.resultsContainer  = rc;

        // ── Suggestion handlers ────────────────────────────
        Handlers.suggestionKeydown = ev => SuggestionService.handleKeydown(ev, sg);
        Handlers.suggestionClick   = ev => SuggestionService.handleClick(ev);
        DOMService.on(sg, 'keydown',    Handlers.suggestionKeydown);
        DOMService.on(sg, 'click',      Handlers.suggestionClick);
        DOMService.on(sg, 'mouseenter', () => { State.suggestionsLocked = true; });
        DOMService.on(sg, 'mouseleave', () => { State.suggestionsLocked = false; });

        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';

        Handlers.documentKeydownOverlay = this._escHandler;
        DOMService.on(document, 'keydown', Handlers.documentKeydownOverlay);

        State.overlayOpen = true;
        State.lastQuery   = '';

        // If there's already a query, run search; otherwise show suggestions
        const currentQ = inp?.value?.trim() || '';
        if (currentQ) {
          SearchService.doSearch(null, true);
          OverlayInputBarService.syncClearBtn();
        } else {
          ReadyModeService.renderReadyModeSuggestions();
        }

        KeyboardAutoToggleService.enableAutoToggle(sc);
        this._hideNav();

        try {
          history.pushState(
            Object.assign({}, State.preOverlayState || {}, { [State._overlayStateMarker]: true }),
            '',
            location.href
          );
          State.searchHistoryPushed = true;
        } catch {}

        State.overlayTransitioning = false;
      } catch (e) {
        console.error('openOverlay failed', e);
        State.overlayTransitioning = false;
      }
    },

    _escHandler(e) {
      if (e.key === 'Escape') OverlayService.close('escape');
    },

    close(src = 'manual') {
      try {
        if (!State.overlayOpen) return;
        State.overlayTransitioning = true;

        if (src !== 'popstate') URLService.syncOnClose();

        VirtualScrollEngine.destroy();
        KeyboardAutoToggleService.disableAutoToggle();

        // ── Restore #searchInput back to the page header ───
        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        const headerWrapper = document.querySelector('.search-header .search-input-wrapper');
        if (inp && headerWrapper) {
          // Reset inline styles so stylesheet takes over
          inp.style.cssText = '';
          // Remove from overlay pill
          if (inp.parentNode && inp.parentNode !== headerWrapper) {
            inp.parentNode.removeChild(inp);
          }
          // Re-insert after the icon span
          const iconSpan = headerWrapper.querySelector('.search-input-icon');
          if (iconSpan) {
            const ref = iconSpan.nextSibling;
            if (ref) headerWrapper.insertBefore(inp, ref);
            else headerWrapper.appendChild(inp);
          } else {
            headerWrapper.appendChild(inp);
          }
        }

        OverlayInputBarService.destroy();

        DOMService.remove(DOMService.get(CONFIG.DOM.overlayContainerId));
        DOMService.remove(DOMService.get(CONFIG.DOM.overlayBackdropId));

        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
        DOMService.off(document, 'keydown', Handlers.documentKeydownOverlay);
        Handlers.documentKeydownOverlay = null;

        State.overlayOpen       = false;
        State.lastQuery         = '';
        State.suggestionsLocked = false;
        State.overlayOpenedAt   = null;
        State.scrollableContent = null;
        State.resultsContainer  = null;
        State.wrapperContainer  = null;
        this._showNav();

        State._timeouts.forEach(t => { try { clearTimeout(t); clearInterval(t); } catch {} });
        State._timeouts.clear();

        setTimeout(() => { State.overlayTransitioning = false; }, CONFIG.TIMING.transitionDelayMs);
      } catch (e) {
        console.error('closeOverlay failed', e);
        State.overlayTransitioning = false;
      }
    },

    _hideNav() {
      try { State.navHiddenBySearch = true; window.modernNav?.hideNav?.('search-overlay'); } catch {}
    },
    _showNav() {
      try {
        if (window.modernNav?.showNav && State.navHiddenBySearch) {
          State.navHiddenBySearch = false;
          window.modernNav.showNav('search-overlay-closed');
        }
      } catch {}
    },
  };

  // =========================================================
  // SEARCH SERVICE
  // =========================================================
  const SearchService = {
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
          if (State.overlayOpen && options.closeOverlay) OverlayService.close('manual');
          return;
        }

        let out = { results:[], keywords:[] };
        try { if (window.SearchEngine?.search) out = window.SearchEngine.search(q, State.selectedType) || out; } catch {}
        State.currentResults   = out.results || [];
        State.allKeywordsCache = out.keywords || [];

        FilterService.setupCategoryFilter(RenderingService.extractResultCategories(State.currentResults), 'all');

        const stObj = { q, type:State.selectedType||'all', category:'all' };
        if (!preventPush && !State.suppressHistoryPush && !URLService.isEqual(stObj, State.lastCommittedSearchState)) {
          URLService.commit(stObj); State.searchHistoryPushed = true;
        }

        RenderingService.renderResults(State.currentResults, State.currentResults.length === 0);

        if (State.overlayOpen && options.closeOverlay) OverlayService.close('manual');
      } catch (e) { console.error('doSearch failed', e); }
    },

    // ── URL search with retry ──────────────────────────────
    // Retries until SearchEngine has docs loaded (handles async Fuse init)
    doSearchFromURL(q, type, category, retryCount) {
      retryCount = retryCount || 0;
      const maxRetries = CONFIG.TIMING.urlSearchMaxRetries;
      const retryMs    = CONFIG.TIMING.urlSearchRetryMs;

      const attempt = () => {
        try {
          const se = window.SearchEngine;

          // Engine not initialized yet — retry
          if (!se || !se.search) {
            if (retryCount < maxRetries) {
              setTimeout(() => this.doSearchFromURL(q, type, category, retryCount + 1), retryMs);
            } else {
              console.warn('[SearchUI] SearchEngine unavailable after URL search retries');
            }
            return;
          }

          // Check if docs are available (immediate docs OR Fuse docs)
          const hasDocs = (() => {
            try { return (se._internals?.getDocs?.()?.length || 0) > 0; } catch { return false; }
          })();

          // Try searching with what we have
          let out = { results: [], keywords: [] };
          try { out = se.search(q, type) || out; } catch {}

          // If no results and docs not yet built, retry
          if (out.results.length === 0 && !hasDocs && retryCount < maxRetries) {
            setTimeout(() => this.doSearchFromURL(q, type, category, retryCount + 1), retryMs);
            return;
          }

          // Apply results
          State.suppressHistoryPush = true;
          try {
            const inp = DOMService.get(CONFIG.DOM.searchInputId);
            if (inp) inp.value = q;
            State.selectedType     = type     || 'all';
            State.selectedCategory = category || 'all';
            FilterService.setupTypeFilter(State.selectedType);
            this.doSearch(null, true);
            try {
              history.replaceState(
                { q, type: State.selectedType, category: State.selectedCategory },
                '',
                URLService.buildUrlForState({ q, type: State.selectedType, category: State.selectedCategory })
              );
            } catch {}
            State.lastCommittedSearchState = {
              q: q || '',
              type: State.selectedType || 'all',
              category: State.selectedCategory || 'all',
            };
          } finally {
            State.suppressHistoryPush = false;
          }
        } catch (e) {
          console.error('[SearchUI] doSearchFromURL attempt failed', e);
          if (retryCount < maxRetries) {
            setTimeout(() => this.doSearchFromURL(q, type, category, retryCount + 1), retryMs);
          }
        }
      };

      attempt();
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
          if (e.key==='Enter') {
            e.preventDefault();
            SearchService.doSearch();
            this.closeKB();
          } else if (e.key==='ArrowDown') {
            DOMService.get(CONFIG.DOM.suggestionContainerId)?.querySelector('.suggestion-item')?.focus?.();
          } else if (e.key==='Backspace') {
            clearTimeout(State.debounceTimeout);
            State.debounceTimeout = setTimeout(() => SuggestionService.renderQuerySuggestions(inp.value), CONFIG.TIMING.debounceMs/2);
          }
        };
        inp.addEventListener('keydown', Handlers.inputKeydown);

        Handlers.inputFocus = () => {
          if (!State.overlayTransitioning) {
            this.scrollToTop();
            OverlayService.open();
          }
        };
        inp.addEventListener('focus', Handlers.inputFocus);

        Handlers.inputClick = () => {
          if (!State.overlayTransitioning) {
            this.scrollToTop();
            OverlayService.open();
          }
        };
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

    closeKB() {
      try { const inp = DOMService.get(CONFIG.DOM.searchInputId); if (inp && document.activeElement===inp) inp.blur(); } catch {}
    },

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
      KeyboardService.initKeyboardDetection();

      loadData().then(data => {
        State.apiData = data || {};
        if (!Array.isArray(State.apiData.type))
          console.warn('[SearchUI] Data missing .type[] — check ConDataService', State.apiData);

        const initFn = window.SearchEngine?.init || (() => Promise.resolve());
        return initFn(State.apiData, {}).catch(e => console.error('SearchEngine.init failed', e));

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

        // ── URL search with retry-based engine wait ────────
        const init = URLService.readStateFromURL();
        if (init?.q) {
          SearchService.doSearchFromURL(init.q, init.type || 'all', init.category || 'all', 0);
        } else {
          try { history.replaceState({ q:'', type:'all', category:'all' }, '', location.pathname); } catch {}
          State.lastCommittedSearchState = { q:'', type:'all', category:'all' };
        }

      }).catch(e => { console.error('[SearchUI] init failed', e); State.apiData = State.apiData||{}; });

      // Form submit
      const form = DOMService.get(CONFIG.DOM.searchFormId);
      if (form) {
        Handlers.formSubmit = e => { e.preventDefault(); SearchService.doSearch(); UIService.closeKB(); };
        DOMService.on(form, 'submit', Handlers.formSubmit);
      }

      // Enter on main input (before overlay opens)
      const inp = DOMService.get(CONFIG.DOM.searchInputId);
      if (inp) {
        const kd = e => { if (e.key==='Enter') { e.preventDefault(); SearchService.doSearch(); UIService.closeKB(); } };
        Handlers.inputKeydown = kd;
        DOMService.on(inp,'keydown',kd);
      }

      // Popstate
      Handlers.popstate = e => {
        try {
          const s = e.state||{};
          const isOv = s[State._overlayStateMarker];
          if (isOv && State.overlayOpen) { OverlayService.close('popstate'); return; }
          if (!isOv && State.overlayOpen) { OverlayService.close('popstate'); return; }
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
        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        if (inp) {
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
      VirtualScroll:VirtualScrollEngine, OverlayInputBar:OverlayInputBarService,
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
    getVSStats: () => ({
      itemCount:   VirtualScrollEngine._items.length,
      visibleCount:VirtualScrollEngine._vis?.size || 0,
      poolSize:    VirtualScrollEngine._pool.length,
      totalHeight: VirtualScrollEngine._total,
    }),
  });

  window.__searchUI._initialized = true;
  initializeSearchEngine();

  try { window.addEventListener('beforeunload', () => { try { destroy(); } catch {} }, { passive:true }); } catch {}

})();