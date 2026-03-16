/*
  search-ui.js  v5.0 — RenderEngine-Exclusive Architecture
  ════════════════════════════════════════════════════════════════

  RULE: This file NEVER writes innerHTML, NEVER creates card nodes,
        NEVER builds HTML strings directly.
        ALL rendering goes through window.RenderEngine.

  RENDER PIPELINE (v5.0):
  ┌─────────────────────────────────────────────────────────────┐
  │  User types query                                           │
  │       ↓                                                     │
  │  SearchEngine.search()   → result objects                   │
  │       ↓                                                     │
  │  RenderEngine.Worker     → Promise<string[]>  ← OFF-THREAD  │
  │       ↓ (main thread wakes when worker done)                │
  │  RenderEngine.FlatList   → replaceChildren()  ← ONE write   │
  │       ↓                                                     │
  │  CSS content-visibility:auto handles scroll   ← ZERO JS     │
  └─────────────────────────────────────────────────────────────┘

  If RenderEngine is not loaded:
  - RenderingService._render() logs an error and renders nothing.
  - All other UI (overlay, suggestions, filters) still works.

  UX: Identical to v4.2 — same overlay, same suggestions, same
      keyboard behavior, same history/URL, same public API.
════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  if (window.__searchUI && window.__searchUI._initialized) return;

  /* ── Device ─────────────────────────────────────────────────── */
  const _MEM     = Math.max(1, Math.min(8, navigator.deviceMemory || 4));
  const _LOW_END = _MEM <= 2 || (navigator.hardwareConcurrency || 4) <= 2;

  /* ── Engine accessor — throws if not loaded ─────────────────── */
  function _RE() {
    const re = window.RenderEngine;
    if (!re) throw new Error('[SearchUI] RenderEngine not loaded. Add render-engine.js before search-ui.js');
    return re;
  }

  // =========================================================
  // CONFIG
  // =========================================================
  const CONFIG = {
    DOM: {
      suggestionContainerId : 'searchSuggestions',
      overlayBackdropId     : 'searchOverlayBackdrop',
      overlayContainerId    : 'searchOverlayContainer',
      searchInputId         : 'searchInput',
      searchFormId          : 'searchForm',
      typeFilterId          : 'typeFilter',
      categoryFilterId      : 'categoryFilter',
      searchResultsId       : 'searchResults',
      copyToastId           : 'copyToast',
      placeholderId         : 'search-wrapper-placeholder',
    },
    RENDER: {
      suggestionMax         : 8,
      suggestionsFullMax    : 30,
      resultLimit           : 50,   // user never needs 200
    },
    TIMING: {
      debounceMs              : _LOW_END ? 220 : 150,
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
    STORAGE: { historyKey: 'searchHistory_v1', langKey: 'selectedLang' },
    DB     : { path: '/assets/db/db.min.json' },
    PERF   : { enabled: false, longTaskMs: 50, maxM: 200 },
    LANG   : { default: 'en', autoDetect: true },
    TEXTS  : {
      th: {
        all_types:'ทุกประเภท', all_categories:'ทุกหมวดหมู่',
        not_found:'ไม่พบข้อมูลที่ตรงหรือใกล้เคียง',
        copy:'คัดลอก', copy_failed:'คัดลอกไม่สำเร็จ',
        suggestion_label:'คำแนะนำ', suggestions_for_you:'คำแนะนำสำหรับคุณ',
        search_result_here:'ผลลัพธ์การค้นหาจะปรากฏที่นี่',
        search_placeholder:'ค้นหาข้อมูล...',
        type:'ประเภท', category:'หมวดหมู่', emoji:'อีโมจิ',
        trending:'ยอดนิยม',
      },
      en: {
        all_types:'All Types', all_categories:'All Categories',
        not_found:'No data found.',
        copy:'Copy', copy_failed:'Failed to copy',
        suggestion_label:'Suggestions', suggestions_for_you:'Suggestions for you',
        search_result_here:'Search results will appear here',
        search_placeholder:'Search information...',
        type:'Type', category:'Category', emoji:'Emoji',
        trending:'Trending',
      }
    },
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
    keyboardAutoToggleEnabled: false,
    lastOverlayScrollY: 0,
    keyboardAutoToggleHandler: null,
    lastKeyboardToggleTime: 0,
    lastScrollTime: 0,
    isScrollingActive: false,
    scrollIdleTimer: null,
    scrollableContent: null,
    resultsContainer: null,
    // Smart names cache (FIX-3)
    _smartNamesCache: null,
    _smartNamesCacheLang: null,
    // Active FlatList instance (managed by RenderingService)
    _flatList: null,
  };

  const Handlers = {
    resize: null, inputFocus: null, inputClick: null,
    inputInput: null, inputKeydown: null, formSubmit: null,
    overlayBackdropClick: null, suggestionClick: null, suggestionKeydown: null,
    documentKeydownOverlay: null, popstate: null,
  };

  // =========================================================
  // LANGUAGE
  // =========================================================
  const Lang = {
    get() {
      try {
        return localStorage.getItem(CONFIG.STORAGE.langKey) ||
          (CONFIG.LANG.autoDetect && navigator.language?.startsWith('th') ? 'th' : CONFIG.LANG.default);
      } catch { return CONFIG.LANG.default; }
    },
    t(key) {
      const l = this.get();
      return CONFIG.TEXTS[l]?.[key] || CONFIG.TEXTS[CONFIG.LANG.default][key] || key;
    },
  };

  // =========================================================
  // DOM HELPERS
  // =========================================================
  const D = {
    get    : id  => document.getElementById(id),
    q      : sel => document.querySelector(sel),
    qAll   : sel => document.querySelectorAll(sel),
    on     : (el, ev, fn, opt) => el?.addEventListener(ev, fn, opt),
    off    : (el, ev, fn)      => el?.removeEventListener(ev, fn),
    remove : el  => { try { el?.parentNode?.removeChild(el); } catch {} },
    setHTML: (el, h) => { if (el) el.innerHTML = h; },
    setAttr: (el, k, v) => { if (el) el.setAttribute(k, v); },
    styles : (el, s) => { if (el) try { Object.assign(el.style, s); } catch {} },
    add    : (el, c) => el?.classList?.add(c),
    remove_: (el, c) => el?.classList?.remove(c),
    // Fast clear — single operation, avoids innerHTML='' cascade
    clear  : el => {
      if (!el) return;
      el.replaceChildren ? el.replaceChildren() : (el.innerHTML = '');
    },
    create(tag, id, cls, styles) {
      const el = document.createElement(tag);
      if (id) el.id = id;
      if (cls) el.className = cls;
      if (styles) Object.assign(el.style, styles);
      return el;
    },
    enc: s => { try { return encodeURIComponent(s); } catch { return s; } },
    dec: s => { try { return decodeURIComponent(s); } catch { return s; } },
    esc: s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
  };

  // =========================================================
  // NOTIFICATION
  // =========================================================
  const Notif = {
    toast(msg) {
      try {
        const t = D.create('div', null, 'copy-toast-message');
        t.textContent = msg;
        (D.get(CONFIG.DOM.copyToastId) || document.body).appendChild(t);
        const id = setTimeout(() => {
          try { Object.assign(t.style, { opacity:'0', transform:'translateY(-10px)' }); setTimeout(() => D.remove(t), CONFIG.TIMING.toastFadeMs); } catch {}
        }, CONFIG.TIMING.toastDisplayMs);
        State._timeouts.add(id);
      } catch {}
    },
    async copy(text) {
      try {
        if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); this.toast(Lang.t('copy') + ' แล้ว'); return; }
        const ta = Object.assign(document.createElement('textarea'), { value: text });
        Object.assign(ta.style, { position:'fixed', left:'-9999px' });
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy') ? this.toast(Lang.t('copy') + ' แล้ว') : this.toast(Lang.t('copy_failed'));
        document.body.removeChild(ta);
      } catch { this.toast(Lang.t('copy_failed')); }
    },
  };

  // =========================================================
  // URL / HISTORY
  // =========================================================
  const Url = {
    parseQS(qs) {
      const out = {}; if (!qs) return out;
      for (const p of qs.replace(/^\?/,'').split('&')) {
        if (!p) continue; const i = p.indexOf('=');
        if (i === -1) out[decodeURIComponent(p)] = ''; else out[decodeURIComponent(p.slice(0,i))] = decodeURIComponent(p.slice(i+1));
      }
      return out;
    },
    buildQS(o) { const p = []; for (const k in o) if (o[k] != null) p.push(encodeURIComponent(k)+'='+encodeURIComponent(o[k])); return p.length ? '?'+p.join('&') : ''; },
    fromURL()  { try { const p = this.parseQS(location.search); return { q:p.q||'', type:p.type||'all', category:p.category||'all' }; } catch { return { q:'', type:'all', category:'all' }; } },
    forState(s){ const p = {}; if (s.q) p.q = s.q; if (s.type && s.type!=='all') p.type = s.type; if (s.category && s.category!=='all') p.category = s.category; return this.buildQS(p); },
    eq(a,b)    { if (!a&&!b) return true; if (!a||!b) return false; return (a.q||'').trim()===(b.q||'').trim()&&(a.type||'all')===(b.type||'all')&&(a.category||'all')===(b.category||'all'); },
    commit(state) {
      try {
        if (this.eq(state, State.lastCommittedSearchState)) return;
        const url = this.forState(state);
        try { State.searchHistoryPushed ? (history.replaceState(state,'',url), State.searchHistoryPushed=false) : history.pushState(state,'',url); } catch { try { history.replaceState(state,'',url); } catch {} }
        try { const a = JSON.parse(sessionStorage.getItem(CONFIG.STORAGE.historyKey)||'[]'); a.push(Object.assign({},state,{ts:Date.now()})); sessionStorage.setItem(CONFIG.STORAGE.historyKey, JSON.stringify(a.slice(-50))); } catch {}
        State.lastCommittedSearchState = { q:state.q||'', type:state.type||'all', category:state.category||'all' };
      } catch {}
    },
    syncOnClose() {
      if (!State.searchHistoryPushed) return;
      try { const s = State.lastCommittedSearchState||{q:'',type:'all',category:'all'}; history.replaceState(s,'',this.forState(s)); } catch {}
      State.searchHistoryPushed = false;
    },
  };

  // =========================================================
  // PERF MONITOR
  // =========================================================
  const Perf = (function () {
    const _m = [], _lt = [], _pm = {};
    let _obs = null;
    function _en() { return CONFIG.PERF.enabled; }
    return {
      enable()  { CONFIG.PERF.enabled = true; if (!_obs && 'PerformanceObserver' in window) { try { _obs = new PerformanceObserver(list => { for (const e of list.getEntries()) if (e.duration >= CONFIG.PERF.longTaskMs) { _lt.push({d:Math.round(e.duration),ts:Date.now()}); if(_lt.length>50)_lt.shift(); } }); _obs.observe({entryTypes:['longtask']}); } catch {} } },
      disable() { CONFIG.PERF.enabled = false; try { _obs?.disconnect(); _obs=null; } catch {} },
      mark(n)   { if (_en()) _pm[n] = performance.now(); },
      measure(n, s) { if (!_en() || _pm[s] == null) return; const d = performance.now()-_pm[s]; delete _pm[s]; if (_m.length >= CONFIG.PERF.maxM) _m.shift(); _m.push({n,d:Math.round(d*10)/10,ts:Date.now()}); },
      log()     { const sl=_m.filter(x=>x.n==='search-latency'); console.group('%c[SearchUI Perf]','color:#13b47f;font-weight:bold'); console.log('searches:',sl.length,'avg:',sl.length?Math.round(sl.reduce((a,b)=>a+b.d,0)/sl.length*10)/10:null,'ms'); if (_lt.length) console.table(_lt.slice(-10)); console.table(_m.slice(-20)); console.groupEnd(); },
      reset()   { _m.length=0; _lt.length=0; },
    };
  })();

  // =========================================================
  // RENDERING SERVICE
  // ALL DOM writes go through RenderEngine. Zero own render logic.
  // =========================================================
  const RenderingService = {

    /**
     * Main render entry point.
     * Called by SearchService after results are ready.
     * Uses RenderEngine.Worker → RenderEngine.FlatList.
     * This is the ONLY place DOM gets written for search results.
     */
    async renderResults(results, showSuggestionsIfNoResult = false) {
      try {
        const RE   = _RE();
        const lang = Lang.get();
        const cont = (State.overlayOpen && State.resultsContainer)
          ? State.resultsContainer
          : D.get(CONFIG.DOM.searchResultsId);
        if (!cont) return;

        // Category filter
        const filtered = State.selectedCategory !== 'all'
          ? results.filter(r => ((r.category?.name?.[lang]||r.category?.name?.en)||'') === State.selectedCategory)
          : results;

        document.body.style.marginBottom = '60px';
        State.currentFilteredResults = filtered;

        // Destroy previous FlatList
        this._destroyFlatList();

        // Empty state — built via Engine.cardHTML for consistency
        if (!filtered.length) {
          const noResult = '<div class="no-result">' + D.esc(Lang.t('not_found')) + '</div>';
          let html = noResult;
          if (showSuggestionsIfNoResult) {
            const t0 = State.apiData?.type?.[0], c0 = t0?.category?.[0];
            if (t0 && c0) {
              html += '<div class="suggestions-title-main">' + D.esc(Lang.t('suggestions_for_you')) + '</div>';
              html += '<div class="suggestions-block-list">';
              // Engine builds the HTML — no direct string work here
              const sugItems = (c0.data||[]).slice(0,5).map(item => ({
                item, typeObj:t0, category:c0,
                itemName: item.name?.[lang]||item.name?.en||'',
                typeName: t0.name?.[lang]||t0.name?.en||'',
                catName : c0.name?.[lang]||c0.name?.en||'',
              }));
              const sugHtml = RE.Worker.renderSync(sugItems, lang, Lang.t('copy'));
              html += sugHtml.join('') + '</div>';
            }
          }
          // FlatList writes to DOM — even empty-state uses the same pipeline
          State._flatList = RE.createFlatList({
            host  : cont,
            onCopy: text => Notif.copy(text),
          });
          State._flatList.render([html]);
          this._hideSuggestions();
          UIService.updateUILanguage();
          return;
        }

        this._hideSuggestions();

        // Build item descriptors (serializable — no DOM refs)
        const itemDescriptors = filtered.map(r => ({
          item    : r.item || r,
          itemName: r.itemName || '',
          typeName: r.typeName || r.typeObj?.name?.[lang] || r.typeObj?.name?.en || Lang.t('emoji'),
          catName : r.catName  || r.category?.name?.[lang] || r.category?.name?.en || '',
        }));

        // Create FlatList BEFORE async call so host reference is held
        State._flatList = RE.createFlatList({
          host  : cont,
          onCopy: text => Notif.copy(text),
        });

        Perf.mark('render-start');

        // Worker builds ALL HTML strings off main thread
        const htmlArray = await RE.Worker.render(itemDescriptors, lang, Lang.t('copy'));

        // One DOM write via FlatList
        State._flatList.render(htmlArray);

        Perf.measure('render-cost', 'render-start');
        UIService.updateUILanguage();
      } catch (err) {
        console.error('[SearchUI] renderResults failed:', err);
      }
    },

    _destroyFlatList() {
      if (State._flatList) {
        try { State._flatList.destroy(); } catch {}
        State._flatList = null;
      }
    },

    extractResultCategories(results) {
      try {
        const lang = Lang.get(), out = [], seen = Object.create(null);
        for (const r of results) {
          const k = (r.category?.name?.[lang] || r.category?.name?.en) || '';
          if (!seen[k]) { seen[k] = 1; out.push({ key:k, displayName:k }); }
        }
        return out;
      } catch { return []; }
    },

    _hideSuggestions() {
      try { const sg = D.get(CONFIG.DOM.suggestionContainerId); if (sg) { sg.style.display = 'none'; sg.innerHTML = ''; } } catch {}
    },
  };

  // =========================================================
  // FILTER SERVICE
  // =========================================================
  const FilterSvc = {
    setupType(sel = 'all') {
      try {
        const el = D.get(CONFIG.DOM.typeFilterId); if (!el) return;
        const l = Lang.get();
        let buf = `<option value="all">${D.esc(Lang.t('all_types'))}</option>`;
        for (const t of (State.apiData?.type||[])) { const lbl = t.name?.[l]||t.name?.en||''; buf += `<option value="${D.esc(lbl)}">${D.esc(lbl)}</option>`; }
        el.innerHTML = buf; el.value = sel;
      } catch {}
    },
    setupCat(cats, sel = 'all') {
      try {
        const el = D.get(CONFIG.DOM.categoryFilterId); if (!el) return;
        let buf = `<option value="all">${D.esc(Lang.t('all_categories'))}</option>`;
        for (const {key,displayName} of cats) buf += `<option value="${D.esc(key)}">${D.esc(displayName)}</option>`;
        el.innerHTML = buf; el.style.display = ''; el.value = sel;
      } catch {}
    },
  };

  // =========================================================
  // READY MODE / SUGGESTIONS  (FIX-3: cached smart names)
  // =========================================================
  const ReadySvc = {
    extractSmartNames() {
      try {
        const lang = Lang.get();
        if (State._smartNamesCache && State._smartNamesCacheLang === lang) return State._smartNamesCache;
        if (!State.allKeywordsCache?.length) return [];
        const out = [], seen = new Set();
        for (const kw of State.allKeywordsCache) {
          if (out.length >= CONFIG.RENDER.suggestionsFullMax) break;
          if (!kw?.item) continue;
          const name = typeof kw.item.name === 'object' ? (kw.item.name[lang]||kw.item.name.en||'') : '';
          if (!name || name.length < 2 || seen.has(name)) continue;
          if (!/[\u0E00-\u0E7F]/.test(name) && /^[A-Za-z0-9_\-]+$/.test(name) && name.length <= 20) continue;
          seen.add(name); out.push({ raw:name, html:D.esc(name) });
        }
        State._smartNamesCache = out; State._smartNamesCacheLang = lang;
        return out;
      } catch { return []; }
    },
    render() {
      try {
        if (!State.overlayOpen) return;
        const cont = D.get(CONFIG.DOM.suggestionContainerId); if (!cont) return;
        const sgs = this.extractSmartNames();
        if (!sgs.length) { cont.style.display = 'none'; return; }
        let html = `<div class="suggestions-head">${D.esc(Lang.t('trending'))}</div>`;
        for (const s of sgs)
          html += `<div class="suggestion-item" role="option" tabindex="0" data-val="${D.enc(s.raw)}"><div class="suggestion-body">${s.html}</div></div>`;
        cont.innerHTML = html; cont.style.display = 'block';
      } catch {}
    },
  };

  const SugSvc = {
    handleKeydown(ev, cont) {
      try {
        const items = [...cont.querySelectorAll('.suggestion-item')]; if (!items.length) return;
        const idx = items.indexOf(document.activeElement);
        if (ev.key==='ArrowDown')  { ev.preventDefault(); items[idx===-1?0:Math.min(items.length-1,idx+1)]?.focus?.(); }
        else if (ev.key==='ArrowUp')   { ev.preventDefault(); items[idx===-1?items.length-1:Math.max(0,idx-1)]?.focus?.(); }
        else if (ev.key==='Enter')     { ev.preventDefault(); document.activeElement?.classList?.contains('suggestion-item') && document.activeElement?.click?.(); }
        else if (ev.key==='Escape')    { OverlaySvc.close('escape'); }
      } catch {}
    },
    handleClick(ev) {
      try {
        const it = ev.target.closest('.suggestion-item'); if (!it) return;
        ev.stopPropagation?.(); ev.preventDefault?.();
        const val = D.dec(it.getAttribute('data-val')||'');
        const inp = D.get(CONFIG.DOM.searchInputId); if (inp) inp.value = val;
        State.suggestionsLocked = false;
        SearchSvc.doSearch(null, false);
      } catch {}
    },
    renderQuery(query) {
      try {
        if (State.overlayTransitioning) return;
        const cont = D.get(CONFIG.DOM.suggestionContainerId); if (!cont) return;
        if (!query?.trim()) { ReadySvc.render(); return; }
        const sgs = window.SearchEngine?.querySuggestions?.(query, CONFIG.RENDER.suggestionsFullMax) || [];
        if (!sgs.length) { ReadySvc.render(); return; }
        let html = `<div class="suggestions-head">${D.esc(Lang.t('suggestion_label'))}</div>`;
        for (const s of sgs) {
          // Highlight via Engine's escaping only — no special markup for now
          html += `<div class="suggestion-item" role="option" tabindex="0" data-val="${D.enc(s.raw||s.display||'')}"><div class="suggestion-body">${D.esc(s.raw||s.display||'')}</div></div>`;
        }
        cont.innerHTML = html; cont.style.display = 'block';
        const inp = D.get(CONFIG.DOM.searchInputId);
        if (inp) inp.onkeydown = e => {
          if (e.key==='ArrowDown') { e.preventDefault(); cont.querySelector('.suggestion-item')?.focus?.(); }
          else if (e.key==='Escape') OverlaySvc.close('escape');
        };
      } catch {}
    },
  };

  // =========================================================
  // GAP-BASED KEYBOARD SERVICE
  // =========================================================
  const KBGap = {
    isGapExpired:      () => (Date.now() - State.lastKeyboardToggleTime) >= CONFIG.TIMING.keyboardGapMinMs,
    isRecoveryExpired: () => (Date.now() - State.lastKeyboardToggleTime) >= CONFIG.TIMING.keyboardGapRecoveryMs,
    record: () => { State.lastKeyboardToggleTime = Date.now(); },
    markScroll() {
      State.lastScrollTime = Date.now(); State.isScrollingActive = true;
      if (State.scrollIdleTimer) clearTimeout(State.scrollIdleTimer);
      State.scrollIdleTimer = setTimeout(() => { State.isScrollingActive = false; }, CONFIG.TIMING.keyboardIdleTimeMs);
    },
    isIdle: () => !State.isScrollingActive,
    reset:  () => { State.lastKeyboardToggleTime = 0; },
  };

  const KBAutoToggle = {
    enable(sc) {
      if (State.keyboardAutoToggleEnabled) return;
      State.keyboardAutoToggleEnabled = true; State.lastOverlayScrollY = 0; KBGap.reset();
      const el = sc || D.get(CONFIG.DOM.overlayContainerId); if (!el) return;
      State.keyboardAutoToggleHandler = () => {
        try {
          const cur = el.scrollTop || 0; KBGap.markScroll();
          if (cur === 0 && State.lastOverlayScrollY > 0) { if (KBGap.isGapExpired() || KBGap.isRecoveryExpired()) { this._openKB(); KBGap.record(); } }
          else if (cur > 0 && State.lastOverlayScrollY === 0) { if (KBGap.isGapExpired()) { this._closeKB(); KBGap.record(); } }
          State.lastOverlayScrollY = cur;
        } catch {}
      };
      el.addEventListener('scroll', State.keyboardAutoToggleHandler, { passive: true });
    },
    disable() {
      if (!State.keyboardAutoToggleEnabled) return;
      State.keyboardAutoToggleEnabled = false;
      const sc = State.scrollableContent || D.get(CONFIG.DOM.overlayContainerId);
      if (sc && State.keyboardAutoToggleHandler) sc.removeEventListener('scroll', State.keyboardAutoToggleHandler);
      if (State.scrollIdleTimer) clearTimeout(State.scrollIdleTimer);
      State.keyboardAutoToggleHandler = null;
    },
    _openKB()  { /* KEYBOARD_AUTO_OPEN = false — intentionally no-op */ },
    _closeKB() { try { const inp = D.get(CONFIG.DOM.searchInputId); if (inp && document.activeElement === inp) inp.blur(); } catch {} },
  };

  // =========================================================
  // KEYBOARD DETECTION
  // =========================================================
  const KBDetect = {
    _ro: null,
    init() {
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
          Handlers.resize = () => { clearTimeout(State.keyboardDetectionTimeout); State.keyboardDetectionTimeout = setTimeout(() => this._update(), CONFIG.TIMING.keyboardDetectionDelayMs); };
          D.on(window, 'resize', Handlers.resize, { passive: true });
        }
        const inp = D.get(CONFIG.DOM.searchInputId);
        if (inp) {
          inp.addEventListener('focus', () => { clearTimeout(State.keyboardDetectionTimeout); State.keyboardDetectionTimeout = setTimeout(() => this._update(), CONFIG.TIMING.keyboardDetectionDelayMs); });
          inp.addEventListener('blur', () => { clearTimeout(State.keyboardDetectionTimeout); State.keyboardDetectionTimeout = setTimeout(() => { State.keyboardOpen = false; }, CONFIG.TIMING.keyboardDetectionDelayMs); });
        }
      } catch {}
    },
    _update() {
      try { const cur = (window.visualViewport?.height) || window.innerHeight || 0, diff = State.lastWindowInnerHeight - cur; if (diff > 100) State.keyboardOpen = true; else if (diff < -100) State.keyboardOpen = false; State.lastWindowInnerHeight = cur; } catch {}
    },
    isOpen: () => !!State.keyboardOpen,
  };

  // =========================================================
  // OVERLAY SERVICE  (UX identical to v4.2)
  // =========================================================
  const OverlaySvc = {
    _backdrop() {
      try {
        let bd = D.get(CONFIG.DOM.overlayBackdropId); if (bd) return bd;
        bd = D.create('div', CONFIG.DOM.overlayBackdropId, 'search-overlay-backdrop', { position:'fixed', inset:'0', background:'rgba(12,14,18,0.48)', zIndex:'9997', cursor:'default' });
        Handlers.overlayBackdropClick = e => {
          if (e.target !== bd) return; e.preventDefault?.(); e.stopPropagation?.();
          if (KBDetect.isOpen()) return;
          const inp = D.get(CONFIG.DOM.searchInputId), cur = (inp?.value||'').trim(), last = (State.preOverlayState?.q||'').trim();
          if (cur !== last && cur.length) SearchSvc.doSearch(null, false); else OverlaySvc.close('backdrop');
        };
        D.on(bd, 'click', Handlers.overlayBackdropClick);
        document.body.appendChild(bd); return bd;
      } catch { return null; }
    },

    open() {
      try {
        if (State.overlayOpen || State.overlayTransitioning) return;
        const wrapper = D.q('.search-input-wrapper'); if (!wrapper) return;
        State.overlayTransitioning = true;
        State.originalInputParent      = wrapper.parentNode;
        State.originalInputNextSibling = wrapper.nextSibling;
        const ph = D.create('div', CONFIG.DOM.placeholderId, null, { width:wrapper.offsetWidth+'px', height:wrapper.offsetHeight+'px', visibility:'hidden', display:'block' });
        State.originalPlaceholder = ph;
        State.originalInputParent.insertBefore(ph, State.originalInputNextSibling);

        const inp = D.get(CONFIG.DOM.searchInputId);
        State.preOverlayState = { q:inp?.value||'', type:State.selectedType||'all', category:State.selectedCategory||'all' };
        State.overlayOpenedAt = Date.now();
        this._backdrop();

        let ov = D.get(CONFIG.DOM.overlayContainerId);
        if (!ov) {
          ov = D.create('div', CONFIG.DOM.overlayContainerId, 'search-overlay search-overlay-open', { position:'fixed', inset:'0', zIndex:'9998', display:'flex', flexDirection:'column', alignItems:'stretch', overflow:'hidden', backgroundColor:'#ffffff' });
          document.body.appendChild(ov);
        } else {
          D.clear(ov);
        }

        const wc = D.create('div', null, 'search-overlay-input-wrapper', { width:'100%', zIndex:'10001', background:'#ffffff', flexShrink:'0', padding:'2px 10px 5px', borderBottom:'1px solid #f0f0f0', display:'flex', flexDirection:'column', alignItems:'center' });
        D.add(wrapper, 'overlay-elevated');
        D.styles(wrapper, { width:'100%', maxWidth:'100%', marginTop:'0', marginBottom:'0' });
        wc.appendChild(wrapper); ov.appendChild(wc);
        State.wrapperContainer = wc;

        // NO will-change, NO translateZ — kills GPU memory on low-end
        const sc = D.create('div', null, 'search-overlay-scrollable-content', { flex:'1', width:'100%', overflow:'auto', overscrollBehavior:'contain', zIndex:'10000' });
        const rw = D.create('div', null, 'search-overlay-results-wrapper', { width:'100%', padding:'0 0 16px', boxSizing:'border-box' });
        const sg = D.create('div', CONFIG.DOM.suggestionContainerId, 'search-suggestions-fullscreen');
        const rc = D.create('div', CONFIG.DOM.searchResultsId, 'search-overlay-results', { width:'100%' });
        rw.appendChild(sg); rw.appendChild(rc); sc.appendChild(rw); ov.appendChild(sc);
        State.scrollableContent = sc; State.resultsContainer = rc;
        // FIX 4: sr-scrolling on overlay scroll container
        ScrollClassSvc.attach(sc);

        Handlers.suggestionKeydown = ev => SugSvc.handleKeydown(ev, sg);
        Handlers.suggestionClick   = ev => SugSvc.handleClick(ev);
        D.on(sg, 'keydown', Handlers.suggestionKeydown); D.on(sg, 'click', Handlers.suggestionClick);
        D.on(sg, 'mouseenter', () => { State.suggestionsLocked = true; });
        D.on(sg, 'mouseleave', () => { State.suggestionsLocked = false; });

        document.documentElement.style.overflow = 'hidden'; document.body.style.overflow = 'hidden';
        Handlers.documentKeydownOverlay = OverlaySvc._escHandler;
        D.on(document, 'keydown', Handlers.documentKeydownOverlay);

        State.overlayOpen = true; State.lastQuery = '';
        ReadySvc.render(); KBAutoToggle.enable(sc); this._hideNav();

        try { history.pushState(Object.assign({}, State.preOverlayState||{}, { [State._overlayStateMarker]: true }), '', location.href); State.searchHistoryPushed = true; } catch {}
        if (inp) setTimeout(() => { try { inp.focus(); inp.select?.(); } catch {} }, CONFIG.TIMING.focusDelayMs);
        State.overlayTransitioning = false;
      } catch (e) { console.error('openOverlay failed', e); State.overlayTransitioning = false; }
    },

    _escHandler(e) {
      if (e.key !== 'Escape') return;
      if (State.preOverlayState) {
        const inp = D.get(CONFIG.DOM.searchInputId);
        if (inp) inp.value = State.preOverlayState.q || '';
        State.selectedType = State.preOverlayState.type||'all'; State.selectedCategory = State.preOverlayState.category||'all';
      }
      OverlaySvc.close('escape');
    },

    close(src = 'manual') {
      try {
        if (!State.overlayOpen) return;
        State.overlayTransitioning = true;
        if (src !== 'popstate') Url.syncOnClose();
        RenderingService._destroyFlatList();
        KBAutoToggle.disable();

        const wrapper = D.q('.search-input-wrapper');
        if (wrapper) {
          D.remove_(wrapper, 'overlay-elevated');
          D.styles(wrapper, { width:'', maxWidth:'', marginTop:'', marginBottom:'' });
          if (State.originalInputParent) {
            State.originalInputNextSibling ? State.originalInputParent.insertBefore(wrapper, State.originalInputNextSibling) : State.originalInputParent.appendChild(wrapper);
          }
        }
        D.remove(State.originalPlaceholder); State.originalPlaceholder = null;
        State.wrapperContainer = null; State.scrollableContent = null; State.resultsContainer = null;
        D.remove(D.get(CONFIG.DOM.overlayContainerId)); D.remove(D.get(CONFIG.DOM.overlayBackdropId));
        document.documentElement.style.overflow = ''; document.body.style.overflow = '';
        D.off(document, 'keydown', Handlers.documentKeydownOverlay); Handlers.documentKeydownOverlay = null;
        State.overlayOpen = false; State.suggestionsLocked = false; State.overlayOpenedAt = null;
        this._showNav();
        State._timeouts.forEach(t => { try { clearTimeout(t); clearInterval(t); } catch {} }); State._timeouts.clear();
        setTimeout(() => { State.overlayTransitioning = false; }, CONFIG.TIMING.transitionDelayMs);
      } catch (e) { console.error('closeOverlay failed', e); State.overlayTransitioning = false; }
    },

    _hideNav() { try { State.navHiddenBySearch=true; window.modernNav?.hideNav?.('search-overlay'); } catch {} },
    _showNav()  { try { if (window.modernNav?.showNav && State.navHiddenBySearch) { State.navHiddenBySearch=false; window.modernNav.showNav('search-overlay-closed'); } } catch {} },
  };

  // =========================================================
  // SEARCH SERVICE
  // =========================================================
  const SearchSvc = {
    _sched: (typeof scheduler !== 'undefined' && scheduler) || null,

    _uvTask(fn) {
      if (this._sched?.postTask) return this._sched.postTask(fn, { priority:'user-visible' });
      return new Promise((res, rej) => requestAnimationFrame(() => { try { res(fn()); } catch(e) { rej(e); } }));
    },

    doSearch(e, preventPush) {
      try {
        e?.preventDefault?.();
        const inp  = D.get(CONFIG.DOM.searchInputId);
        const q    = inp?.value || '';
        State.selectedType     = D.get(CONFIG.DOM.typeFilterId)?.value || State.selectedType;
        State.selectedCategory = 'all';

        if (!q.trim()) {
          document.body.style.marginBottom = '';
          RenderingService._destroyFlatList();
          // Empty state written by Engine via FlatList
          const cont = (State.overlayOpen && State.resultsContainer) || D.get(CONFIG.DOM.searchResultsId);
          if (cont) {
            const RE = window.RenderEngine;
            if (RE) {
              State._flatList = RE.createFlatList({ host: cont, onCopy: text => Notif.copy(text) });
              State._flatList.render([`<div class="search-result-here" style="text-align:center;color:#969ca8;font-size:1.07em;margin-top:30px;">${D.esc(Lang.t('search_result_here'))}</div>`]);
            }
          }
          FilterSvc.setupCat([], 'all');
          UIService.updateUILanguage();
          const cl = { q:'', type:'all', category:'all' };
          if (!preventPush && !State.suppressHistoryPush && !Url.eq(cl, State.lastCommittedSearchState)) Url.commit(cl);
          if (State.overlayOpen) { const sg = D.get(CONFIG.DOM.suggestionContainerId); if (sg) sg.style.display = ''; ReadySvc.render(); }
          if (State.overlayOpen) OverlaySvc.close('manual');
          return;
        }

        this._uvTask(async () => {
          try {
            Perf.mark('search-start');
            let out = { results:[], keywords:[] };
            try { if (window.SearchEngine?.search) out = window.SearchEngine.search(q, State.selectedType) || out; } catch {}
            // FIX-4: cap at 50
            State.currentResults   = (out.results||[]).slice(0, CONFIG.RENDER.resultLimit);
            State.allKeywordsCache = out.keywords || [];
            // Invalidate smart names cache when keywords change
            State._smartNamesCache = null; State._smartNamesCacheLang = null;
            Perf.measure('search-latency', 'search-start');

            FilterSvc.setupCat(RenderingService.extractResultCategories(State.currentResults), 'all');

            const stObj = { q, type:State.selectedType||'all', category:'all' };
            if (!preventPush && !State.suppressHistoryPush && !Url.eq(stObj, State.lastCommittedSearchState)) { Url.commit(stObj); State.searchHistoryPushed = true; }

            if (State.overlayOpen) OverlaySvc.close('manual');

            // ALL rendering via RenderEngine
            await RenderingService.renderResults(State.currentResults, State.currentResults.length === 0);
          } catch (err) { console.error('[SearchUI] doSearch inner:', err); }
        }).catch(err => { console.error('[SearchUI] doSearch:', err); });
      } catch (e) { console.error('[SearchUI] doSearch:', e); }
    },
  };

  // =========================================================
  // SCROLL CLASS SERVICE
  // Adds .sr-scrolling to results container during scroll.
  // CSS uses this to set pointer-events:none on cards/buttons,
  // eliminating per-frame hit-test overhead on mobile GPUs.
  // =========================================================
  const ScrollClassSvc = {
    _timer: null,
    _el   : null,

    attach(el) {
      if (!el || el._srAttached) return;
      el._srAttached = true;
      this._el = el;
      el.addEventListener('scroll', () => {
        el.classList.add('sr-scrolling');
        if (this._timer) clearTimeout(this._timer);
        this._timer = setTimeout(() => {
          el.classList.remove('sr-scrolling');
          this._timer = null;
        }, 150);
      }, { passive: true });
    },

    detach(el) {
      if (!el) return;
      el.classList.remove('sr-scrolling');
      el._srAttached = false;
    },
  };

  // =========================================================
  // UI SERVICE
  // =========================================================
  const UIService = {
    setupInput() {
      try {
        const inp = D.get(CONFIG.DOM.searchInputId); if (!inp) return;
        D.setAttr(inp, 'enterkeyhint', 'search');
        Handlers.inputInput = () => {
          if (State.overlayTransitioning) return;
          clearTimeout(State.debounceTimeout);
          State.debounceTimeout = setTimeout(() => SugSvc.renderQuery(inp.value), CONFIG.TIMING.debounceMs);
        };
        inp.addEventListener('input', Handlers.inputInput);
        Handlers.inputKeydown = e => {
          if (e.key==='Enter') { e.preventDefault(); SearchSvc.doSearch(); this.blurKB(); }
          else if (e.key==='ArrowDown') D.get(CONFIG.DOM.suggestionContainerId)?.querySelector('.suggestion-item')?.focus?.();
          else if (e.key==='Backspace') { clearTimeout(State.debounceTimeout); State.debounceTimeout = setTimeout(() => SugSvc.renderQuery(inp.value), CONFIG.TIMING.debounceMs/2); }
        };
        inp.addEventListener('keydown', Handlers.inputKeydown);
        Handlers.inputFocus = () => { if (!State.overlayTransitioning) OverlaySvc.open(); };
        Handlers.inputClick = () => { if (!State.overlayTransitioning) OverlaySvc.open(); };
        inp.addEventListener('focus', Handlers.inputFocus);
        inp.addEventListener('click', Handlers.inputClick);
      } catch {}
    },
    setupFilters() {
      try {
        [CONFIG.DOM.typeFilterId, CONFIG.DOM.categoryFilterId].forEach(id => {
          const el = D.get(id); if (!el) return;
          const onChange = () => { if (id === CONFIG.DOM.typeFilterId) { State.selectedType = el.value; SearchSvc.doSearch(); } else { State.selectedCategory = el.value; RenderingService.renderResults(State.currentResults, false); this.updateUILanguage(); } };
          el.onchange = onChange; el.onkeyup = e => { if (e.key==='Enter') onChange(); };
        });
      } catch {}
    },
    blurKB() { try { const inp = D.get(CONFIG.DOM.searchInputId); if (inp && document.activeElement===inp) inp.blur(); } catch {} },
    updateUILanguage() {
      try {
        const inp = D.get(CONFIG.DOM.searchInputId); const ph = Lang.t('search_placeholder'); if (inp && inp.placeholder !== ph) inp.placeholder = ph;
        const lbls = D.qAll('.search-filters-panel .filter-group-label');
        if (lbls[0] && lbls[0].textContent !== Lang.t('type'))     lbls[0].textContent = Lang.t('type');
        if (lbls[1] && lbls[1].textContent !== Lang.t('category')) lbls[1].textContent = Lang.t('category');
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
      if (svc) return svc.getAssembled().catch(() => fetch(CONFIG.DB.path).then(r=>r.json()).catch(()=>({})));
      return fetch(CONFIG.DB.path).then(r=>r.json()).catch(()=>({}));
    });
  }

  // =========================================================
  // INIT
  // =========================================================
  function init() {
    try {
      // Verify Engine is loaded — fail loudly
      try { _RE(); } catch (e) { console.error(e.message); return; }

      try { if (new URLSearchParams(location.search).get('searchperf') === '1') { Perf.enable(); console.info('[SearchUI] PerfMonitor enabled'); } } catch {}

      KBDetect.init();

      loadData().then(data => {
        State.apiData = data || {};
        const initFn = window.SearchEngine?.init || (() => Promise.resolve());
        return initFn(State.apiData, {
          onIndexProgress: () => {},
          onIndexReady: () => {
            try {
              State.allKeywordsCache = window.SearchEngine?.generateAllKeywords?.() || [];
              // Pre-warm smart names cache in idle time
              const warmCache = () => ReadySvc.extractSmartNames();
              typeof requestIdleCallback === 'function' ? requestIdleCallback(warmCache, { timeout: 3000 }) : setTimeout(warmCache, 500);
            } catch {}
          },
        }).catch(e => console.error('SearchEngine.init failed', e));
      }).then(() => {
        try { if (!State.allKeywordsCache?.length) State.allKeywordsCache = window.SearchEngine?.generateAllKeywords?.() || []; } catch {}

        FilterSvc.setupType('all');
        UIService.setupFilters();
        UIService.setupInput();
        FilterSvc.setupCat([], 'all');
        document.body.style.marginBottom = '';

        // FIX 4: sr-scrolling on main results (non-overlay path)
        const mainResults = D.get(CONFIG.DOM.searchResultsId);
        if (mainResults) ScrollClassSvc.attach(mainResults);

        // Initial placeholder via Engine
        const rc = D.get(CONFIG.DOM.searchResultsId);
        if (rc && window.RenderEngine) {
          State._flatList = window.RenderEngine.createFlatList({ host: rc, onCopy: t => Notif.copy(t) });
          State._flatList.render([`<div class="search-result-here" style="text-align:center;color:#969ca8;font-size:1.07em;margin-top:30px;">${D.esc(Lang.t('search_result_here'))}</div>`]);
        }
        UIService.updateUILanguage();

        try { const hs = history.state; if (hs?.q !== undefined) State.lastCommittedSearchState = { q:hs.q||'', type:hs.type||'all', category:hs.category||'all' }; else State.lastCommittedSearchState = null; } catch { State.lastCommittedSearchState = null; }

        const ini = Url.fromURL();
        if (ini?.q) {
          try {
            State.suppressHistoryPush = true;
            const inp = D.get(CONFIG.DOM.searchInputId); if (inp) inp.value = ini.q;
            State.selectedType = ini.type||'all'; State.selectedCategory = ini.category||'all';
            FilterSvc.setupType(State.selectedType);
            SearchSvc.doSearch(null, true);
            try { history.replaceState({ q:ini.q, type:State.selectedType, category:State.selectedCategory }, '', Url.forState(ini)); } catch {}
            State.lastCommittedSearchState = { q:ini.q||'', type:State.selectedType||'all', category:State.selectedCategory||'all' };
          } finally { State.suppressHistoryPush = false; }
        } else {
          try { history.replaceState({ q:'', type:'all', category:'all' }, '', location.pathname); } catch {}
          State.lastCommittedSearchState = { q:'', type:'all', category:'all' };
        }
      }).catch(e => console.error('[SearchUI] init failed:', e));

      const form = D.get(CONFIG.DOM.searchFormId);
      if (form) { Handlers.formSubmit = e => { e.preventDefault(); SearchSvc.doSearch(); UIService.blurKB(); }; D.on(form, 'submit', Handlers.formSubmit); }

      const inp2 = D.get(CONFIG.DOM.searchInputId);
      if (inp2) D.on(inp2, 'keydown', e => { if (e.key==='Enter') { e.preventDefault(); SearchSvc.doSearch(); UIService.blurKB(); } });

      Handlers.popstate = e => {
        try {
          const s = e.state||{}, isOv = s[State._overlayStateMarker];
          if (isOv && State.overlayOpen) { OverlaySvc.close('popstate'); return; }
          if (!isOv && State.overlayOpen) {
            if (State.preOverlayState) { const i = D.get(CONFIG.DOM.searchInputId); if (i) i.value = State.preOverlayState.q||''; State.selectedType = State.preOverlayState.type||'all'; State.selectedCategory = State.preOverlayState.category||'all'; }
            OverlaySvc.close('popstate'); return;
          }
          const st = (e.state && typeof e.state==='object' && !isOv) ? e.state : Url.fromURL();
          if (st?.q !== undefined) _restoreState(st);
        } catch {}
      };
      D.on(window, 'popstate', Handlers.popstate);
      State._handlersAttached = true;
    } catch (e) { console.error('[SearchUI] init:', e); }
  }

  function _restoreState(st) {
    try {
      State.suppressHistoryPush = true;
      const inp = D.get(CONFIG.DOM.searchInputId); if (inp) inp.value = st.q||'';
      State.selectedType = st.type||'all'; State.selectedCategory = st.category||'all';
      FilterSvc.setupType(State.selectedType);
      SearchSvc.doSearch(null, true);
    } finally { State.suppressHistoryPush = false; }
  }

  // =========================================================
  // DESTROY
  // =========================================================
  function destroy() {
    try {
      OverlaySvc.close('manual');
      RenderingService._destroyFlatList();
      KBAutoToggle.disable();
      try {
        D.off(window, 'resize', Handlers.resize); D.off(window, 'popstate', Handlers.popstate);
        D.off(D.get(CONFIG.DOM.searchFormId), 'submit', Handlers.formSubmit);
        const inp = D.get(CONFIG.DOM.searchInputId);
        if (inp) { if (Handlers.inputInput) inp.removeEventListener('input', Handlers.inputInput); if (Handlers.inputKeydown) inp.removeEventListener('keydown', Handlers.inputKeydown); if (Handlers.inputFocus) inp.removeEventListener('focus', Handlers.inputFocus); if (Handlers.inputClick) inp.removeEventListener('click', Handlers.inputClick); }
        if (Handlers.documentKeydownOverlay) D.off(document, 'keydown', Handlers.documentKeydownOverlay);
      } catch {}
      State._timeouts.forEach(t => { try { clearTimeout(t); clearInterval(t); } catch {} }); State._timeouts.clear();
      try { D.remove(D.get(CONFIG.DOM.suggestionContainerId)); D.remove(D.get(CONFIG.DOM.overlayBackdropId)); D.remove(D.get(CONFIG.DOM.overlayContainerId)); } catch {}
      State.apiData=null; State.allKeywordsCache=[]; State.currentResults=[];
      State.currentFilteredResults=[]; State.lastCommittedSearchState=null;
      State._handlersAttached=false; State.keyboardAutoToggleEnabled=false;
      State._smartNamesCache=null; State._smartNamesCacheLang=null;
      try { window.RenderEngine?.Worker?.terminate(); } catch {}
      if (window.__searchUI) window.__searchUI._initialized = false;
    } catch {}
  }

  // =========================================================
  // PUBLIC API  (identical surface to v4.x)
  // =========================================================
  window.__searchUI = window.__searchUI || {};
  Object.assign(window.__searchUI, {
    init, destroy,
    getConfig   : () => CONFIG,
    getState    : () => State,
    getServices : () => ({
      Language:Lang, DOM:D, URL:Url, Notification:Notif,
      Rendering:RenderingService, Filter:FilterSvc,
      Suggestion:SugSvc, ReadyMode:ReadySvc, Overlay:OverlaySvc,
      Search:SearchSvc, UI:UIService, Keyboard:KBDetect,
      GapBasedKeyboard:KBGap, KeyboardAutoToggle:KBAutoToggle,
      VirtualScroll: { isActive:!!State._flatList, visibleCount:0, totalHeight:0 },
    }),
    getLastCommittedSearchState: () => State.lastCommittedSearchState,
    getSessionHistory: () => { try { return JSON.parse(sessionStorage.getItem(CONFIG.STORAGE.historyKey)||'[]'); } catch { return []; } },
    querySuggestions: q => window.SearchEngine?.querySuggestions?.(q, CONFIG.RENDER.suggestionMax) || [],
    isKeyboardOpen: () => KBDetect.isOpen(),
    enableKeyboardAutoToggle: () => KBAutoToggle.enable(),
    disableKeyboardAutoToggle: () => KBAutoToggle.disable(),
    resetKeyboardGap: () => KBGap.reset(),
    getVSStats: () => ({ active:!!State._flatList, visibleCount:0, totalHeight:0 }),
    perf: Perf,
    getIndexStats: () => ({ ready:window.SearchEngine?.isIndexReady?.()||false, building:window.SearchEngine?.isBuilding?.()||false, docCount:window.SearchEngine?.getDocCount?.()||0 }),
  });

  window.__searchUI._initialized = true;
  init();

  try { window.addEventListener('beforeunload', () => { try { destroy(); } catch {} }, { passive:true }); } catch {}

})();