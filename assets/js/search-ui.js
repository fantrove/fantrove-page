/*
  search-ui.js  v3.3
  =====================================================
  FIXES in v3.3:

  HISTORY (complete rework)
  ✅ Two-stack model:
     Stack A (search): pushState per search commit — browser back navigates between queries
     Stack B (overlay): pushState when overlay opens — browser back closes overlay
  ✅ Overlay open pushes its own entry tagged _overlayStateMarker
  ✅ Overlay close (any path): replaceState with the search state that was active before overlay
  ✅ searchHistoryPushed flag only tracks overlay's own push — never mixed with search commits
  ✅ URL always reflects current search query correctly
  ✅ popstate correctly distinguishes overlay entry vs search entry

  INPUT LAYOUT
  ✅ Icon slot is flex-shrink:0 inside wrapper flex row — no absolute positioning
  ✅ Input has no conflicting padding-left — icon sits to the left naturally in flex
  ✅ Clear (✕) button restored inside the flex row on the right

  ICON SLOT / BACK ARROW
  ✅ On main page with active query: icon slot shows ← and calls history.back()
  ✅ On main page without query: icon slot shows 🔍 (non-interactive)
  ✅ Inside overlay: icon slot always shows ← and calls OverlayService.close()
  ✅ All overlay close paths go through OverlayService.close()

  CLEAR BUTTON
  ✅ Restored inside .search-input-wrapper flex row (right side)
  ✅ Clears input, triggers doSearch (empty → shows placeholder), stays in overlay
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
      overlayContainerId    : 'searchOverlayContainer',
      sentinelId            : 'search-render-sentinel',
      searchInputId         : 'searchInput',
      searchFormId          : 'searchForm',
      typeFilterId          : 'typeFilter',
      categoryFilterId      : 'categoryFilter',
      searchResultsId       : 'searchResults',
      copyToastId           : 'copyToast',
      clearBtnId            : 'search-clear-btn',
    },
    RENDER: {
      suggestionMax            : 8,
      suggestionsFullscreenMax : 30,
      vsOverscanPx             : 320,
      vsPoolMax                : 40,
      vsEstimatedItemHeight    : 96,
    },
    TIMING: {
      debounceMs               : 120,
      toastDisplayMs           : 1400,
      toastFadeMs              : 250,
      focusDelayMs             : 30,
      transitionDelayMs        : 300,
      keyboardDetectionDelayMs : 100,
      keyboardGapMinMs         : 300,
      keyboardGapRecoveryMs    : 800,
      keyboardIdleTimeMs       : 500,
      conDataServiceWaitMs     : 5000,
      conDataServicePollMs     : 30,
      urlSearchRetryMs         : 200,
      urlSearchMaxRetries      : 25,
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
        trending:'ยอดนิยม', recent:'ล่าสุด', back:'ย้อนกลับ', clear:'ล้างคำค้นหา',
      },
      en: {
        all_types:'All Types', all_categories:'All Categories',
        not_found:'No data found related to your keyword.',
        copy:'Copy', copy_failed:'Failed to copy',
        suggestion_label:'Suggestions', suggestions_for_you:'Suggestions for you',
        search_result_here:'Search results will appear here',
        search_placeholder:'Search information...',
        type:'Type', category:'Category', emoji:'Emoji',
        trending:'Trending', recent:'Recent', back:'Back', clear:'Clear',
      }
    }
  };

  // =========================================================
  // SVG ICONS
  // =========================================================
  const Icons = {
    search: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
    back:   `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="M12 5l-7 7 7 7"/></svg>`,
    clear:  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  };

  // =========================================================
  // STATE
  // =========================================================
  const State = {
    apiData               : null,
    allKeywordsCache      : [],
    currentResults        : [],
    currentFilteredResults: [],
    selectedType          : 'all',
    selectedCategory      : 'all',
    lastCommittedSearchState: null,   // last search state pushed/replaced in history
    lastQuery             : '',
    overlayOpen           : false,
    overlayTransitioning  : false,
    preOverlayState       : null,     // search state snapshot when overlay opened
    overlayHistoryPushed  : false,    // true = overlay pushed its own history entry
    keyboardOpen          : false,
    keyboardDetectionTimeout: null,
    lastWindowInnerHeight : 0,
    suppressHistoryPush   : false,
    overlayOpenedAt       : null,
    debounceTimeout       : null,
    suggestionsLocked     : false,
    _timeouts             : new Set(),
    _handlersAttached     : false,
    _overlayStateMarker   : '__searchUI_overlay_open__',
    navHiddenBySearch     : false,
    keyboardAutoToggleEnabled  : false,
    lastOverlayScrollY    : 0,
    keyboardAutoToggleHandler  : null,
    lastKeyboardToggleTime: 0,
    lastScrollTime        : 0,
    isScrollingActive     : false,
    scrollIdleTimer       : null,
    overlayScrollable     : null,
    _wrapperParent        : null,
    _wrapperNext          : null,
  };

  const Handlers = {
    resize: null, inputFocus: null, inputClick: null,
    inputInput: null, inputKeydown: null, formSubmit: null,
    suggestionClick: null, suggestionKeydown: null,
    documentKeydownOverlay: null, popstate: null, copyClick: null,
  };

  // =========================================================
  // UTILITIES
  // =========================================================
  const LanguageService = {
    getLang() {
      try { return localStorage.getItem(CONFIG.STORAGE.langKey) || (CONFIG.LANG.autoDetect && navigator.language?.startsWith('th') ? 'th' : CONFIG.LANG.default); }
      catch { return CONFIG.LANG.default; }
    },
    t(key) { const l = this.getLang(); return CONFIG.TEXTS[l]?.[key] || CONFIG.TEXTS[CONFIG.LANG.default][key] || key; }
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
        const a = this.getHistory();
        a.push(Object.assign({}, state, { ts: Date.now() }));
        sessionStorage.setItem(CONFIG.STORAGE.historyKey, JSON.stringify(a));
      } catch {}
    },
  };

  // =========================================================
  // URL / HISTORY SERVICE  (v3.3 — two-stack model)
  //
  // Stack A (search entries): pushState per unique search query
  //   state = { q, type, category }
  //
  // Stack B (overlay entry): pushState when overlay opens
  //   state = { ...searchState, __searchUI_overlay_open__: true }
  //   Closed by: replaceState back to the search state
  //
  // This means:
  //   browser back on overlay entry → popstate fires → OverlayService.close()
  //   browser back on search entry  → popstate fires → _restoreUIState()
  //   ← icon while overlay open     → OverlayService.close() (no history.back())
  //   ← icon while on main page with query → history.back() (Stack A)
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
      for (const k in obj) { if (obj[k] != null && obj[k] !== '') p.push(encodeURIComponent(k)+'='+encodeURIComponent(obj[k])); }
      return p.length ? '?'+p.join('&') : '';
    },
    readStateFromURL() {
      try { const p = this.parseQS(location.search); return { q:p.q||'', type:p.type||'all', category:p.category||'all' }; }
      catch { return { q:'', type:'all', category:'all' }; }
    },
    buildUrlForState(st) {
      const p = {};
      if (st.q) p.q = st.q;
      if (st.type && st.type !== 'all') p.type = st.type;
      if (st.category && st.category !== 'all') p.category = st.category;
      return this.buildQS(p) || location.pathname;
    },
    isEqual(a, b) {
      if (!a && !b) return true; if (!a || !b) return false;
      return (a.q||'').trim() === (b.q||'').trim() &&
             (a.type||'all') === (b.type||'all') &&
             (a.category||'all') === (b.category||'all');
    },

    // Commit a search to Stack A
    commitSearch(state) {
      try {
        if (this.isEqual(state, State.lastCommittedSearchState)) return;
        const url = this.buildUrlForState(state);
        const st  = { q: state.q||'', type: state.type||'all', category: state.category||'all' };
        // Always pushState for a new unique search
        try { history.pushState(st, '', url); } catch { try { history.replaceState(st, '', url); } catch {} }
        StorageService.addSearchToHistory(st);
        State.lastCommittedSearchState = st;
      } catch {}
    },

    // Replace current entry (no new push) — used for URL init and empty-query reset
    replaceSearch(state) {
      try {
        const url = this.buildUrlForState(state);
        const st  = { q: state.q||'', type: state.type||'all', category: state.category||'all' };
        history.replaceState(st, '', url);
        State.lastCommittedSearchState = st;
      } catch {}
    },

    // Push overlay entry onto Stack B
    pushOverlayEntry(searchState) {
      try {
        const st = Object.assign({}, searchState, { [State._overlayStateMarker]: true });
        history.pushState(st, '', location.href);
        State.overlayHistoryPushed = true;
      } catch {}
    },

    // When overlay closes: replace the overlay entry with the current search state.
    // This collapses [prev, overlay_entry] → [prev, search_entry] — exactly 1 new entry.
    // Skip if overlayHistoryPushed is false (e.g. close('popstate') already consumed it).
    collapseOverlayEntry(searchState) {
      try {
        if (!State.overlayHistoryPushed) return;
        const url = this.buildUrlForState(searchState);
        const st  = { q: searchState.q||'', type: searchState.type||'all', category: searchState.category||'all' };
        history.replaceState(st, '', url);
        State.lastCommittedSearchState = st;
        // Record in session history only when there's an actual search query
        if (st.q) StorageService.addSearchToHistory(st);
      } catch {}
      State.overlayHistoryPushed = false;
    },
  };

  // =========================================================
  // ICON SLOT SERVICE  (v3.3)
  //
  // Modes:
  //   A) Overlay open        → always ← → history.back()
  //                            (popstate fires → OverlayService.close('popstate'))
  //                            This is the ONLY correct way to pop the overlay entry.
  //   B) Main page + query   → ← → history.back() (navigate Stack A)
  //   C) Main page, no query → 🔍 (non-interactive)
  //
  // Why history.back() and NOT OverlayService.close() directly for back-btn?
  //   close('back-btn') calls history.replaceState() — that REPLACES but does NOT POP
  //   the overlay entry. The extra entry stays in the stack.
  //   history.back() tells the browser to POP the entry natively, then popstate fires,
  //   then OverlayService.close('popstate') cleans up. Stack is correct.
  // =========================================================
  const IconSlotService = {
    _clickHandler : null,
    _keyHandler   : null,

    _slot() { return DOMService.query('.search-input-icon'); },

    update() {
      const slot = this._slot();
      if (!slot) return;

      const hasQuery = (DOMService.get(CONFIG.DOM.searchInputId)?.value || '').trim().length > 0;
      const showBack = State.overlayOpen || hasQuery;

      // Remove old listeners first
      if (this._clickHandler) { slot.removeEventListener('click', this._clickHandler); this._clickHandler = null; }
      if (this._keyHandler)   { slot.removeEventListener('keydown', this._keyHandler); this._keyHandler = null; }

      if (showBack) {
        slot.innerHTML = Icons.back;
        slot.setAttribute('role', 'button');
        slot.setAttribute('tabindex', '0');
        slot.setAttribute('aria-label', LanguageService.t('back'));
        slot.style.cssText = 'cursor:pointer;color:var(--text-main,#0f2335);pointer-events:auto;';

        this._clickHandler = e => {
          e.preventDefault(); e.stopPropagation();
          // history.back() in ALL cases:
          //   Overlay open  → browser POPs overlay entry → popstate fires
          //                   → popstate handler calls OverlayService.close('popstate')
          //                   → overlay entry REMOVED from stack (not just replaced)
          //   Main page     → navigate backward in Stack A (search history)
          history.back();
        };
        this._keyHandler = e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            history.back();  // same as click — works for both overlay and main page
          }
        };
        slot.addEventListener('click', this._clickHandler);
        slot.addEventListener('keydown', this._keyHandler);
      } else {
        slot.innerHTML = Icons.search;
        slot.setAttribute('role', 'presentation');
        slot.removeAttribute('tabindex');
        slot.removeAttribute('aria-label');
        slot.style.cssText = 'cursor:default;color:var(--accent,#13b47f);pointer-events:none;';
      }
    },
  };

  // =========================================================
  // CLEAR BUTTON SERVICE
  // Manages the ✕ button inside .search-input-wrapper
  // =========================================================
  const ClearBtnService = {
    _btn: null,

    build() {
      // Only create once; it moves with the wrapper
      let btn = DOMService.get(CONFIG.DOM.clearBtnId);
      if (!btn) {
        btn = DOMService.create('button', CONFIG.DOM.clearBtnId, null, {
          background: 'rgba(0,0,0,0.13)',
          border: 'none',
          cursor: 'pointer',
          padding: '0',
          display: 'none',          // hidden until there's text
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: '0',
          width: '20px',
          height: '20px',
          minWidth: '20px',
          borderRadius: '50%',
          color: '#555',
          outline: 'none',
          WebkitTapHighlightColor: 'transparent',
        });
        btn.setAttribute('type', 'button');
        btn.setAttribute('aria-label', LanguageService.t('clear'));
        btn.innerHTML = Icons.clear;
        btn.addEventListener('click', e => {
          e.preventDefault(); e.stopPropagation();
          const inp = DOMService.get(CONFIG.DOM.searchInputId);
          if (inp) { inp.value = ''; inp.focus(); }
          this.sync();
          IconSlotService.update();
          SearchService.doSearch(null, false);
        });
      }
      this._btn = btn;
      return btn;
    },

    sync() {
      const btn = this._btn || DOMService.get(CONFIG.DOM.clearBtnId);
      if (!btn) return;
      const hasText = (DOMService.get(CONFIG.DOM.searchInputId)?.value || '').length > 0;
      btn.style.display = hasText ? 'flex' : 'none';
    },
  };

  // =========================================================
  // VIRTUAL SCROLL ENGINE  (unchanged)
  // =========================================================
  const VirtualScrollEngine = {
    OVERSCAN:CONFIG.RENDER.vsOverscanPx, POOL_MAX:CONFIG.RENDER.vsPoolMax, EST_H:CONFIG.RENDER.vsEstimatedItemHeight,
    _vp:null,_host:null,_box:null,_items:[],_fn:null,_lang:'en',
    _hgt:null,_off:null,_total:0,_vis:null,_pool:[],_raf:null,_onScroll:null,_vpObs:null,

    mount(viewport,host,items,renderFn,lang){
      this.destroy();
      this._vp=viewport;this._host=host;this._items=items||[];this._fn=renderFn;this._lang=lang||'en';this._vis=new Map();
      this._hgt=new Float32Array(this._items.length).fill(this.EST_H);this._buildOff();
      const box=document.createElement('div');box.className='vs-container';
      box.style.cssText=`position:relative;height:${this._total}px;min-height:2px;contain:layout style;`;
      host.appendChild(box);this._box=box;
      this._onScroll=()=>this._sched();viewport.addEventListener('scroll',this._onScroll,{passive:true});
      if('ResizeObserver'in window){this._vpObs=new ResizeObserver(()=>this._sched());this._vpObs.observe(viewport);}
      this._sched();
    },
    destroy(){
      if(this._raf){cancelAnimationFrame(this._raf);this._raf=null;}
      if(this._vp&&this._onScroll)this._vp.removeEventListener('scroll',this._onScroll);
      this._vpObs?.disconnect();this._vpObs=null;this._box?.remove();this._box=null;
      this._vis?.clear();this._pool=[];this._items=[];this._vp=this._host=this._fn=this._onScroll=null;this._vis=null;
    },
    _sched(){if(this._raf)return;this._raf=requestAnimationFrame(()=>{this._raf=null;this._render();});},
    _buildOff(){const n=this._hgt.length;this._off=new Float64Array(n+1);for(let i=0;i<n;i++)this._off[i+1]=this._off[i]+this._hgt[i];this._total=this._off[n]||0;},
    _find(t){if(!this._off||this._off.length<2)return 0;let lo=0,hi=this._off.length-2;while(lo<hi){const mid=(lo+hi+1)>>>1;if(this._off[mid]<=t)lo=mid;else hi=mid-1;}return lo;},
    _coOff(){let off=0,el=this._box;while(el&&el!==this._vp){off+=el.offsetTop;el=el.offsetParent;}return off;},
    _render(){
      if(!this._vp||!this._box||!this._items.length)return;
      const st=this._vp.scrollTop,vh=this._vp.clientHeight;if(!vh)return;
      const co=this._coOff(),lo=st-co-this.OVERSCAN,hi=st-co+vh+this.OVERSCAN;
      const si=this._find(Math.max(0,lo)),ei=Math.min(this._items.length-1,this._find(Math.max(0,hi))+1);
      const recycle=[];for(const[idx,el]of this._vis){if(idx<si||idx>ei)recycle.push([idx,el]);}
      const frag=document.createDocumentFragment(),meas=[];
      for(const[idx,el]of recycle){el.style.display='none';this._vis.delete(idx);if(this._pool.length<this.POOL_MAX)this._pool.push(el);else el.remove();}
      for(let i=si;i<=ei;i++){
        if(this._vis.has(i))continue;
        const top=this._off[i],html=this._fn(this._items[i],this._lang);
        let el=this._pool.pop();
        if(el){el.style.cssText=`position:absolute;left:0;right:0;top:${top}px;`;el.style.display='';el.innerHTML=html;}
        else{el=document.createElement('div');el.className='vs-item';el.style.cssText=`position:absolute;left:0;right:0;top:${top}px;contain:layout style paint;`;el.innerHTML=html;frag.appendChild(el);}
        this._vis.set(i,el);meas.push(i);
      }
      if(frag.hasChildNodes())this._box.appendChild(frag);if(meas.length)this._measure(meas);
    },
    _measure(indices){
      const exec=()=>{
        if(!this._vis)return;
        const reads=[];for(const i of indices){const el=this._vis.get(i);if(!el||el.style.display==='none')continue;const h=el.firstElementChild?.offsetHeight||el.offsetHeight;if(h>4)reads.push([i,h]);}
        let changed=false;const st=this._vp?.scrollTop||0,co=this._coOff();let adj=0;
        for(const[i,h]of reads){const diff=h-this._hgt[i];if(Math.abs(diff)<=4)continue;if(this._off[i]+co<st)adj+=diff;this._hgt[i]=h;changed=true;}
        if(!changed)return;this._buildOff();if(this._box)this._box.style.height=this._total+'px';
        for(const[idx,el]of this._vis){const t=this._off[idx]+'px';if(el.style.top!==t)el.style.top=t;}
        if(adj!==0&&this._vp)this._vp.scrollTop+=adj;
      };
      if('requestIdleCallback'in window)requestIdleCallback(exec,{timeout:500});else setTimeout(exec,50);
    },
  };

  // =========================================================
  // KEYBOARD SERVICES  (unchanged)
  // =========================================================
  const GapBasedKeyboardService = {
    isGapExpired:      ()=>(Date.now()-State.lastKeyboardToggleTime)>=CONFIG.TIMING.keyboardGapMinMs,
    isRecoveryExpired: ()=>(Date.now()-State.lastKeyboardToggleTime)>=CONFIG.TIMING.keyboardGapRecoveryMs,
    recordToggle:      ()=>{State.lastKeyboardToggleTime=Date.now();},
    markScroll(){State.lastScrollTime=Date.now();State.isScrollingActive=true;if(State.scrollIdleTimer)clearTimeout(State.scrollIdleTimer);State.scrollIdleTimer=setTimeout(()=>{State.isScrollingActive=false;},CONFIG.TIMING.keyboardIdleTimeMs);},
    isScrollIdle:()=>!State.isScrollingActive,
    resetGap:()=>{State.lastKeyboardToggleTime=0;},
  };

  const KeyboardAutoToggleService = {
    enableAutoToggle(sc){
      if(State.keyboardAutoToggleEnabled)return;State.keyboardAutoToggleEnabled=true;State.lastOverlayScrollY=0;GapBasedKeyboardService.resetGap();
      const el=sc||DOMService.get(CONFIG.DOM.overlayContainerId);if(!el)return;
      State.keyboardAutoToggleHandler=()=>{try{const cur=el.scrollTop||0;GapBasedKeyboardService.markScroll();
        if(cur===0&&State.lastOverlayScrollY>0){if(GapBasedKeyboardService.isGapExpired()||GapBasedKeyboardService.isRecoveryExpired()){const inp=DOMService.get(CONFIG.DOM.searchInputId);if(inp&&document.activeElement!==inp)inp.focus();GapBasedKeyboardService.recordToggle();}}
        else if(cur>0&&State.lastOverlayScrollY===0){if(GapBasedKeyboardService.isGapExpired()){const inp=DOMService.get(CONFIG.DOM.searchInputId);if(inp&&document.activeElement===inp)inp.blur();GapBasedKeyboardService.recordToggle();}}
        State.lastOverlayScrollY=cur;}catch{}};
      el.addEventListener('scroll',State.keyboardAutoToggleHandler,{passive:true});
    },
    disableAutoToggle(){
      if(!State.keyboardAutoToggleEnabled)return;State.keyboardAutoToggleEnabled=false;
      const sc=State.overlayScrollable||DOMService.get(CONFIG.DOM.overlayContainerId);
      if(sc&&State.keyboardAutoToggleHandler)sc.removeEventListener('scroll',State.keyboardAutoToggleHandler);
      if(State.scrollIdleTimer)clearTimeout(State.scrollIdleTimer);State.keyboardAutoToggleHandler=null;
    },
  };

  const KeyboardService = {
    initKeyboardDetection(){
      try{
        State.lastWindowInnerHeight=window.innerHeight||0;
        if('visualViewport'in window){
          window.visualViewport.addEventListener('resize',()=>{clearTimeout(State.keyboardDetectionTimeout);State.keyboardDetectionTimeout=setTimeout(()=>{try{const cur=window.visualViewport.height||0;const diff=State.lastWindowInnerHeight-cur;if(diff>100)State.keyboardOpen=true;else if(diff<-100)State.keyboardOpen=false;State.lastWindowInnerHeight=cur;}catch{}},CONFIG.TIMING.keyboardDetectionDelayMs);},{passive:true});
        } else {
          Handlers.resize=()=>{clearTimeout(State.keyboardDetectionTimeout);State.keyboardDetectionTimeout=setTimeout(()=>{const cur=window.innerHeight||0;const diff=State.lastWindowInnerHeight-cur;if(diff>100)State.keyboardOpen=true;else if(diff<-100)State.keyboardOpen=false;State.lastWindowInnerHeight=cur;},CONFIG.TIMING.keyboardDetectionDelayMs);};
          DOMService.on(window,'resize',Handlers.resize,{passive:true});
        }
      }catch{}
    },
    isKeyboardOpen:()=>!!State.keyboardOpen,
  };

  // =========================================================
  // NOTIFICATION
  // =========================================================
  const NotificationService = {
    toast(msg){
      try{
        const t=DOMService.create('div',null,'copy-toast-message');t.textContent=msg;
        (DOMService.get(CONFIG.DOM.copyToastId)||document.body).appendChild(t);
        const id=setTimeout(()=>{try{Object.assign(t.style,{opacity:'0',transform:'translateY(-10px)'});setTimeout(()=>DOMService.remove(t),CONFIG.TIMING.toastFadeMs);}catch{}},CONFIG.TIMING.toastDisplayMs);
        State._timeouts.add(id);
      }catch{}
    },
    async copyText(text){
      try{
        if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);this.toast(LanguageService.t('copy')+' แล้ว');return;}
        const ta=Object.assign(document.createElement('textarea'),{value:text});Object.assign(ta.style,{position:'fixed',left:'-9999px'});
        document.body.appendChild(ta);ta.select();
        if(document.execCommand('copy'))this.toast(LanguageService.t('copy')+' แล้ว');
        else this.toast(LanguageService.t('copy_failed'));
        document.body.removeChild(ta);
      }catch{this.toast(LanguageService.t('copy_failed'));}
    },
  };

  // =========================================================
  // HIGHLIGHT
  // =========================================================
  const HighlightService = {
    highlight(text,query){
      if(!text||!query)return StringService.escapeHtml(text||'');
      try{
        const t=String(text).toLowerCase(),chars=new Set(String(query).toLowerCase());let r='';
        for(let i=0;i<t.length;i++)r+=chars.has(t[i])?`<strong style="background-color:#fff3cd;font-weight:700">${StringService.escapeHtml(String(text)[i])}</strong>`:StringService.escapeHtml(String(text)[i]);
        return r;
      }catch{return StringService.escapeHtml(text);}
    },
  };

  // =========================================================
  // RENDERING SERVICE — main page only
  // =========================================================
  const RenderingService = {
    renderResultItem(item,lang){
      try{
        const itemData=item.item||item,rawText=itemData?.text||'',
          itemText=rawText||itemData?.name?.[lang]||itemData?.name?.en||item.itemName||'',
          itemApi=itemData?.api||'',
          typeName=item.typeName||item.typeObj?.name?.[lang]||item.typeObj?.name?.en||LanguageService.t('emoji'),
          catName=item.catName||item.category?.name?.[lang]||item.category?.name?.en||'';
        const names=[];if(item.itemName)names.push(item.itemName);
        if(itemData?.name){const n=itemData.name[lang]||itemData.name.en;if(n&&!names.includes(n))names.push(n);}
        for(const k in(itemData||{})){if(/_name$/.test(k)&&itemData[k]){const n=itemData[k][lang]||itemData[k].en;if(n&&!names.includes(n))names.push(n);}}
        const nameStr=names.filter(Boolean).join(' / '),text=itemText||itemApi||'-';
        const vertical=text.includes('\n')||text.length>45||text.trim().split(/\s+/).length>7;
        const esc=StringService.escapeHtml;
        return `<div class="result-item search-card${vertical?' vertical':''}" role="article" aria-label="${esc(nameStr||text)}">
          <div class="card-content" aria-hidden="true">${esc(String(text).slice(0,300))}</div>
          <div class="card-body">
            <div class="card-title">${esc(nameStr||(itemData?.name?.[lang]||itemData?.name?.en||itemData?.api)||text)}</div>
            <div class="card-subtitle">${esc(itemApi||typeName||'')}</div>
            <div class="card-tags" aria-hidden="true">
              ${typeName?`<span class="tag">${esc(typeName)}</span>`:''}${catName?`<span class="tag">${esc(catName)}</span>`:''}
            </div>
          </div>
          <button class="result-copy-btn" data-text="${StringService.encodeUrl(text)}" aria-label="${LanguageService.t('copy')}">${LanguageService.t('copy')}</button>
        </div>`;
      }catch{return`<div class="result-item"><div class="result-content-area">-</div></div>`;}
    },
    disconnectRenderObserver(){VirtualScrollEngine.destroy();DOMService.remove(DOMService.get(CONFIG.DOM.sentinelId));},
    extractResultCategories(results){
      try{const lang=LanguageService.getLang(),out=[],seen=Object.create(null);for(const r of results){const k=(r.category?.name?.[lang]||r.category?.name?.en)||'';if(!seen[k]){seen[k]=1;out.push({key:k,displayName:k});}}return out;}catch{return[];}
    },
    renderResults(results,showSuggestionsIfNoResult=false){
      try{
        const container=DOMService.get(CONFIG.DOM.searchResultsId);
        const lang=LanguageService.getLang();if(!container)return;
        const filtered=State.selectedCategory!=='all'?results.filter(r=>((r.category?.name?.[lang]||r.category?.name?.en)||'')===State.selectedCategory):results;
        document.body.style.marginBottom='60px';this.disconnectRenderObserver();State.currentFilteredResults=filtered;
        if(!filtered.length){
          let html=`<div class="no-result">${LanguageService.t('not_found')}</div>`;
          if(showSuggestionsIfNoResult){
            html+=`<div class="suggestions-title-main">${LanguageService.t('suggestions_for_you')}</div><div class="suggestions-block-list">`;
            const t0=State.apiData?.type?.[0],c0=t0?.category?.[0];
            for(const it of(c0?.data?.slice(0,5)||[]))html+=this.renderResultItem({item:it,typeObj:t0,category:c0,itemName:it.name?.[lang]||it.name?.en||'',typeName:t0?.name?.[lang]||t0?.name?.en||'',catName:c0?.name?.[lang]||c0?.name?.en||''},lang);
            html+='</div>';
          }
          DOMService.setHTML(container,html);
          const cfEl=DOMService.get(CONFIG.DOM.categoryFilterId);if(cfEl)cfEl.style.display='';
          UIService.updateUILanguage();return;
        }
        DOMService.setHTML(container,'');
        requestAnimationFrame(()=>this._batchRender(filtered,container,lang));
        this._attachCopyHandler(container);UIService.updateUILanguage();
      }catch(e){console.error('renderResults failed',e);}
    },
    _batchRender(items,container,lang){
      try{const tpl=document.createElement('template');tpl.innerHTML=items.map(item=>this.renderResultItem(item,lang)).join('');container.appendChild(tpl.content);this._attachCopyHandler(container);}catch(e){console.error('_batchRender failed',e);}
    },
    _attachCopyHandler(container){
      if(!window._copyResultTextHandlerSet){
        Handlers.copyClick=e=>{const btn=e.target.closest('.result-copy-btn');if(btn?.hasAttribute('data-text')){e.preventDefault();NotificationService.copyText(StringService.decodeUrl(btn.getAttribute('data-text')));} };
        DOMService.on(container,'click',Handlers.copyClick);window._copyResultTextHandlerSet=true;
      }
    },
  };

  // =========================================================
  // FILTER SERVICE
  // =========================================================
  const FilterService = {
    setupTypeFilter(selected='all'){
      try{const el=DOMService.get(CONFIG.DOM.typeFilterId);if(!el)return;const lang=LanguageService.getLang();
        let buf=[`<option value="all">${LanguageService.t('all_types')}</option>`];
        for(const t of(State.apiData?.type||[])){const lbl=t.name?.[lang]||t.name?.en||'';buf.push(`<option value="${StringService.escapeHtml(lbl)}">${StringService.escapeHtml(lbl)}</option>`);}
        el.innerHTML=buf.join('');el.value=selected;}catch{}
    },
    setupCategoryFilter(cats,selected='all'){
      try{const el=DOMService.get(CONFIG.DOM.categoryFilterId);if(!el)return;
        let buf=[`<option value="all">${LanguageService.t('all_categories')}</option>`];
        for(const{key,displayName}of cats)buf.push(`<option value="${StringService.escapeHtml(key)}">${StringService.escapeHtml(displayName)}</option>`);
        el.innerHTML=buf.join('');el.style.display='';el.value=selected;}catch{}
    },
  };

  // =========================================================
  // READY MODE / SUGGESTIONS
  // =========================================================
  const ReadyModeService = {
    extractSmartNames(){
      try{
        if(!State.allKeywordsCache)return[];const lang=LanguageService.getLang(),out=[],seen=new Set();
        for(const kw of State.allKeywordsCache){if(out.length>=CONFIG.RENDER.suggestionsFullscreenMax)break;if(!kw?.item)continue;
          const name=(kw.item.name&&typeof kw.item.name==='object')?(kw.item.name[lang]||kw.item.name.en||''):'';
          if(!name||name.length<2)continue;if(!/[\u0E00-\u0E7F]/.test(name)&&/^[A-Za-z0-9_\-]+$/.test(name)&&name.length<=20)continue;
          if(seen.has(name))continue;seen.add(name);out.push({raw:name,display:name,highlightedHtml:StringService.escapeHtml(name)});}
        return out;
      }catch{return[];}
    },
    renderReadyModeSuggestions(){
      try{if(!State.overlayOpen)return;const container=DOMService.get(CONFIG.DOM.suggestionContainerId);if(!container)return;
        const sgs=this.extractSmartNames();if(!sgs.length){container.style.display='none';return;}
        let html=`<div class="suggestions-head">${LanguageService.t('trending')}</div>`;
        for(const s of sgs)html+=`<div class="suggestion-item" role="option" tabindex="0" data-val="${StringService.encodeUrl(s.raw)}"><div class="suggestion-body">${s.highlightedHtml}</div></div>`;
        container.innerHTML=html;container.style.display='block';}catch{}
    },
  };

  const SuggestionService = {
    handleKeydown(ev,container){
      try{const items=[...container.querySelectorAll('.suggestion-item')];if(!items.length)return;const idx=items.indexOf(document.activeElement);
        if(ev.key==='ArrowDown'){ev.preventDefault();items[idx===-1?0:Math.min(items.length-1,idx+1)]?.focus?.();}
        else if(ev.key==='ArrowUp'){ev.preventDefault();items[idx===-1?items.length-1:Math.max(0,idx-1)]?.focus?.();}
        else if(ev.key==='Enter'){ev.preventDefault();if(document.activeElement?.classList?.contains('suggestion-item'))document.activeElement?.click?.();}
        else if(ev.key==='Escape'){OverlayService.close('escape');}}catch{}
    },
    handleClick(ev){
      try{const it=ev.target.closest('.suggestion-item');if(!it)return;ev.stopPropagation?.();ev.preventDefault?.();
        const val=StringService.decodeUrl(it.getAttribute('data-val')||'');
        const inp=DOMService.get(CONFIG.DOM.searchInputId);if(inp)inp.value=val;
        State.suggestionsLocked=false;ClearBtnService.sync();SearchService.doSearch(null,false);}catch{}
    },
    renderQuerySuggestions(query){
      try{if(State.overlayTransitioning)return;const container=DOMService.get(CONFIG.DOM.suggestionContainerId);if(!container)return;
        if(!query?.trim()){ReadyModeService.renderReadyModeSuggestions();return;}
        const sgs=window.SearchEngine?.querySuggestions?.(query,CONFIG.RENDER.suggestionsFullscreenMax)||[];
        if(!sgs.length){ReadyModeService.renderReadyModeSuggestions();return;}
        let html=`<div class="suggestions-head">${LanguageService.t('suggestion_label')}</div>`;
        for(const s of sgs)html+=`<div class="suggestion-item" role="option" tabindex="0" data-val="${StringService.encodeUrl(s.raw)}"><div class="suggestion-body">${HighlightService.highlight(s.raw,query)}</div></div>`;
        container.innerHTML=html;container.style.display='block';
        const inp=DOMService.get(CONFIG.DOM.searchInputId);
        if(inp)inp.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();container.querySelector('.suggestion-item')?.focus?.();}else if(e.key==='Escape'){OverlayService.close('escape');}};}catch{}
    },
  };

  // =========================================================
  // OVERLAY SERVICE  (v3.3 — sole close authority)
  // =========================================================
  const OverlayService = {

    open() {
      try {
        if (State.overlayOpen || State.overlayTransitioning) return;
        State.overlayTransitioning = true;

        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        // Snapshot current search state before overlay
        State.preOverlayState = {
          q       : inp?.value || '',
          type    : State.selectedType || 'all',
          category: State.selectedCategory || 'all',
        };
        State.overlayOpenedAt = Date.now();

        // Build overlay container
        let ov = DOMService.get(CONFIG.DOM.overlayContainerId);
        if (ov) ov.innerHTML = '';
        else {
          ov = DOMService.create('div', CONFIG.DOM.overlayContainerId, 'search-overlay search-overlay-open', {
            position:'fixed', inset:'0', zIndex:'9998',
            display:'flex', flexDirection:'column', alignItems:'stretch',
            overflow:'hidden', backgroundColor:'#ffffff',
          });
          document.body.appendChild(ov);
        }

        // Move .search-input-wrapper into overlay header bar
        const wrapper = DOMService.query('.search-input-wrapper');
        if (wrapper) {
          State._wrapperParent = wrapper.parentNode;
          State._wrapperNext   = wrapper.nextSibling;
          const bar = DOMService.create('div', 'overlay-header-bar', null, {
            display:'flex', alignItems:'center',
            padding:'6px 8px', background:'#fff',
            borderBottom:'1px solid rgba(0,0,0,0.08)',
            flexShrink:'0', width:'100%', boxSizing:'border-box',
          });
          bar.appendChild(wrapper);
          ov.appendChild(bar);
        }

        // Suggestions area (scrollable)
        const sg = DOMService.create('div', CONFIG.DOM.suggestionContainerId, 'search-suggestions-fullscreen');
        const sc = DOMService.create('div', null, 'search-overlay-scrollable-content', {
          flex:'1', width:'100%', overflow:'auto',
          overscrollBehavior:'contain', transform:'translateZ(0)', willChange:'scroll-position',
        });
        sc.appendChild(sg);
        ov.appendChild(sc);
        State.overlayScrollable = sc;

        // Suggestion handlers
        Handlers.suggestionKeydown = ev => SuggestionService.handleKeydown(ev, sg);
        Handlers.suggestionClick   = ev => SuggestionService.handleClick(ev);
        DOMService.on(sg,'keydown',Handlers.suggestionKeydown);
        DOMService.on(sg,'click',Handlers.suggestionClick);
        DOMService.on(sg,'mouseenter',()=>{State.suggestionsLocked=true;});
        DOMService.on(sg,'mouseleave',()=>{State.suggestionsLocked=false;});

        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';

        // Escape → OverlayService.close() only
        Handlers.documentKeydownOverlay = e => { if (e.key === 'Escape') OverlayService.close('escape'); };
        DOMService.on(document,'keydown',Handlers.documentKeydownOverlay);

        State.overlayOpen = true;
        State.lastQuery   = '';

        // Update icon slot → back arrow
        IconSlotService.update();
        ClearBtnService.sync();

        // Show suggestions or existing query
        const currentQ = (inp?.value || '').trim();
        if (currentQ) SuggestionService.renderQuerySuggestions(currentQ);
        else ReadyModeService.renderReadyModeSuggestions();

        KeyboardAutoToggleService.enableAutoToggle(sc);
        this._hideNav();

        // Push overlay history entry (Stack B)
        URLService.pushOverlayEntry(State.preOverlayState);

        // Focus input, cursor at end — no text selection
        if (inp) {
          setTimeout(() => {
            try { inp.focus({ preventScroll:true }); const l=inp.value.length; inp.setSelectionRange(l,l); }
            catch { try { inp.focus(); } catch {} }
          }, CONFIG.TIMING.focusDelayMs);
        }

        State.overlayTransitioning = false;
      } catch(e) { console.error('openOverlay failed',e); State.overlayTransitioning = false; }
    },

    // THE sole authority for all close paths
    // src: 'escape' | 'back-btn' | 'popstate' | 'manual'
    close(src = 'manual') {
      try {
        if (!State.overlayOpen) return;
        State.overlayTransitioning = true;

        // ① Determine what search state we're closing with
        //    (may differ from preOverlayState if user searched while overlay was open)
        const closingSearchState = State.lastCommittedSearchState
          || State.preOverlayState
          || { q:'', type:'all', category:'all' };

        // ② Collapse overlay history entry → replace with search state
        //    Skip if popstate already consumed the entry
        if (src !== 'popstate') {
          URLService.collapseOverlayEntry(closingSearchState);
        } else {
          State.overlayHistoryPushed = false;
        }

        // ③ Cleanup
        VirtualScrollEngine.destroy();
        KeyboardAutoToggleService.disableAutoToggle();

        // ④ Return .search-input-wrapper to original header position
        const wrapper = DOMService.query('.search-input-wrapper');
        if (wrapper && State._wrapperParent) {
          if (State._wrapperNext && State._wrapperNext.parentNode === State._wrapperParent) {
            State._wrapperParent.insertBefore(wrapper, State._wrapperNext);
          } else {
            State._wrapperParent.appendChild(wrapper);
          }
        }
        State._wrapperParent = null;
        State._wrapperNext   = null;

        // ⑤ Remove overlay DOM
        DOMService.remove(DOMService.get(CONFIG.DOM.overlayContainerId));

        // ⑥ Restore page scroll
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';

        // ⑦ Remove keydown listener
        DOMService.off(document,'keydown',Handlers.documentKeydownOverlay);
        Handlers.documentKeydownOverlay = null;

        // ⑧ Reset state
        State.overlayOpen       = false;
        State.overlayScrollable = null;
        State.lastQuery         = '';
        State.suggestionsLocked = false;
        State.overlayOpenedAt   = null;

        // ⑨ Update icon slot (may show ← if query still present, or 🔍)
        IconSlotService.update();
        ClearBtnService.sync();

        this._showNav();
        State._timeouts.forEach(t=>{try{clearTimeout(t);clearInterval(t);}catch{}});
        State._timeouts.clear();
        setTimeout(()=>{ State.overlayTransitioning=false; }, CONFIG.TIMING.transitionDelayMs);
      } catch(e) { console.error('closeOverlay failed',e); State.overlayTransitioning=false; }
    },

    _hideNav(){ try{State.navHiddenBySearch=true;window.modernNav?.hideNav?.('search-overlay');}catch{} },
    _showNav(){ try{if(window.modernNav?.showNav&&State.navHiddenBySearch){State.navHiddenBySearch=false;window.modernNav.showNav('search-overlay-closed');}}catch{} },
  };

  // =========================================================
  // SEARCH SERVICE  (v3.3 — uses URLService.commitSearch)
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

        // ── Empty query ─────────────────────────────────────
        if (!q.trim()) {
          document.body.style.marginBottom = '';
          const rc = DOMService.get(CONFIG.DOM.searchResultsId);
          if (rc) DOMService.setHTML(rc, `<div class="search-result-here" style="text-align:center;color:#969ca8;font-size:1.07em;margin-top:30px;">${LanguageService.t('search_result_here')}</div>`);
          VirtualScrollEngine.destroy();
          FilterService.setupCategoryFilter([], 'all');
          UIService.updateUILanguage();
          if (!preventPush && !State.suppressHistoryPush) {
            const cleared = { q:'', type:'all', category:'all' };
            if (!URLService.isEqual(cleared, State.lastCommittedSearchState)) {
              URLService.replaceSearch(cleared);
            }
          }
          if (State.overlayOpen) ReadyModeService.renderReadyModeSuggestions();
          if (State.overlayOpen && options.closeOverlay) OverlayService.close('manual');
          ClearBtnService.sync();
          IconSlotService.update();
          return;
        }

        // ── Run search ──────────────────────────────────────
        let out = { results:[], keywords:[] };
        try { if (window.SearchEngine?.search) out = window.SearchEngine.search(q, State.selectedType) || out; } catch {}
        State.currentResults   = out.results || [];
        State.allKeywordsCache = out.keywords || [];

        FilterService.setupCategoryFilter(RenderingService.extractResultCategories(State.currentResults), 'all');

        // ── History management ──────────────────────────────
        // CRITICAL: When overlay is open, DON'T pushState.
        // Reason: overlay already pushed its own entry when it opened.
        //   If we pushState here too, the stack gets:
        //     [prev, overlay_entry, search_entry]  ← overlay_entry stays!
        //   Instead we just mark lastCommittedSearchState, then
        //   OverlayService.close('manual') → collapseOverlayEntry()
        //   does replaceState ON the overlay_entry itself:
        //     [prev, search_entry]  ← correct, only 1 new entry total
        //
        // When overlay is closed, use normal pushState via commitSearch().
        if (!preventPush && !State.suppressHistoryPush) {
          const searchState = { q, type: State.selectedType||'all', category: 'all' };
          if (State.overlayOpen) {
            // Mark state only — close() will collapseOverlayEntry → replaceState
            State.lastCommittedSearchState = searchState;
          } else {
            URLService.commitSearch(searchState);
          }
        }

        // Render results on main page
        RenderingService.renderResults(State.currentResults, State.currentResults.length === 0);

        // Close overlay after search — results visible on main page
        if (State.overlayOpen) OverlayService.close('manual');

        ClearBtnService.sync();
        IconSlotService.update();
      } catch(e) { console.error('doSearch failed',e); }
    },

    // URL-init search with retry loop (handles async Fuse/SearchEngine init)
    doSearchFromURL(q, type, category, retryCount) {
      retryCount = retryCount || 0;
      const maxR    = CONFIG.TIMING.urlSearchMaxRetries;
      const retryMs = CONFIG.TIMING.urlSearchRetryMs;

      const attempt = () => {
        try {
          const se = window.SearchEngine;
          if (!se || !se.search) {
            if (retryCount < maxR) setTimeout(()=>this.doSearchFromURL(q,type,category,retryCount+1), retryMs);
            else console.warn('[SearchUI] SearchEngine unavailable after retries');
            return;
          }
          const hasDocs = (()=>{ try{ return (se._internals?.getDocs?.()?.length||0)>0; }catch{ return false; } })();
          let out = { results:[], keywords:[] };
          try { out = se.search(q, type) || out; } catch {}
          if (out.results.length === 0 && !hasDocs && retryCount < maxR) {
            setTimeout(()=>this.doSearchFromURL(q,type,category,retryCount+1), retryMs);
            return;
          }

          State.suppressHistoryPush = true;
          try {
            const inp = DOMService.get(CONFIG.DOM.searchInputId);
            if (inp) inp.value = q;
            State.selectedType     = type     || 'all';
            State.selectedCategory = category || 'all';
            FilterService.setupTypeFilter(State.selectedType);
            this.doSearch(null, true);
            // Use replaceSearch so this doesn't count as a user navigation push
            URLService.replaceSearch({ q, type:State.selectedType, category:State.selectedCategory });
          } finally { State.suppressHistoryPush = false; }
          ClearBtnService.sync();
          IconSlotService.update();
        } catch(e) {
          console.error('[SearchUI] doSearchFromURL failed',e);
          if (retryCount < maxR) setTimeout(()=>this.doSearchFromURL(q,type,category,retryCount+1), retryMs);
        }
      };
      attempt();
    },
  };

  // =========================================================
  // UI SERVICE
  // =========================================================
  const UIService = {
    _wrapperBuilt: false,

    // Ensure .search-input-wrapper contains icon slot + input + clear btn
    // in the correct flex order — called once on init
    buildWrapper() {
      if (this._wrapperBuilt) return;
      const wrapper = DOMService.query('.search-input-wrapper');
      const inp     = DOMService.get(CONFIG.DOM.searchInputId);
      if (!wrapper || !inp) return;

      // Ensure icon slot exists
      let slot = wrapper.querySelector('.search-input-icon');
      if (!slot) {
        slot = DOMService.create('span', null, 'search-input-icon');
        wrapper.insertBefore(slot, wrapper.firstChild);
      }
      slot.innerHTML = Icons.search;

      // Move input after slot if not already
      if (slot.nextSibling !== inp) wrapper.insertBefore(inp, slot.nextSibling);

      // Build and append clear button
      const clearBtn = ClearBtnService.build();
      if (!wrapper.contains(clearBtn)) wrapper.appendChild(clearBtn);

      this._wrapperBuilt = true;
    },

    setupAutoSearchInput() {
      try {
        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        if (!inp) return;
        DOMService.setAttr(inp, 'enterkeyhint', 'search');

        Handlers.inputInput = () => {
          if (State.overlayTransitioning) return;
          ClearBtnService.sync();
          IconSlotService.update();
          clearTimeout(State.debounceTimeout);
          State.debounceTimeout = setTimeout(() => SuggestionService.renderQuerySuggestions(inp.value), CONFIG.TIMING.debounceMs);
        };
        inp.addEventListener('input', Handlers.inputInput);

        Handlers.inputKeydown = e => {
          if (e.key === 'Enter') { e.preventDefault(); SearchService.doSearch(); this.closeKB(); }
          else if (e.key === 'ArrowDown') { DOMService.get(CONFIG.DOM.suggestionContainerId)?.querySelector('.suggestion-item')?.focus?.(); }
          else if (e.key === 'Backspace') {
            clearTimeout(State.debounceTimeout);
            State.debounceTimeout = setTimeout(()=>{ ClearBtnService.sync(); SuggestionService.renderQuerySuggestions(inp.value); IconSlotService.update(); }, CONFIG.TIMING.debounceMs/2);
          }
        };
        inp.addEventListener('keydown', Handlers.inputKeydown);

        Handlers.inputFocus = () => { if (!State.overlayTransitioning) OverlayService.open(); };
        inp.addEventListener('focus', Handlers.inputFocus);

        Handlers.inputClick = () => { if (!State.overlayTransitioning) OverlayService.open(); };
        inp.addEventListener('click', Handlers.inputClick);

        IconSlotService.update();
        ClearBtnService.sync();
      } catch {}
    },

    setupFilters() {
      try {
        [CONFIG.DOM.typeFilterId, CONFIG.DOM.categoryFilterId].forEach(id => {
          const el = DOMService.get(id); if (!el) return;
          const onChange = () => { if (id === CONFIG.DOM.typeFilterId) this.onTypeChange(); else this.onCatChange(); };
          el.onchange = onChange;
          el.onkeyup  = e => { if (e.key === 'Enter') onChange(); };
        });
      } catch {}
    },

    onTypeChange() { try { State.selectedType = DOMService.get(CONFIG.DOM.typeFilterId)?.value; SearchService.doSearch(); } catch {} },
    onCatChange() {
      try {
        State.selectedCategory = DOMService.get(CONFIG.DOM.categoryFilterId)?.value;
        RenderingService.renderResults(State.currentResults, false);
        this.updateUILanguage();
      } catch {}
    },

    closeKB() { try { const inp = DOMService.get(CONFIG.DOM.searchInputId); if (inp && document.activeElement === inp) inp.blur(); } catch {} },

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
        if (!Array.isArray(State.apiData.type)) console.warn('[SearchUI] Data missing .type[]', State.apiData);
        const initFn = window.SearchEngine?.init || (()=>Promise.resolve());
        return initFn(State.apiData, {}).catch(e=>console.error('SearchEngine.init failed',e));

      }).then(() => {
        try { State.allKeywordsCache = window.SearchEngine?.generateAllKeywords?.() || []; } catch { State.allKeywordsCache = []; }

        UIService.buildWrapper();
        FilterService.setupTypeFilter('all');
        UIService.setupFilters();
        UIService.setupAutoSearchInput();
        FilterService.setupCategoryFilter([], 'all');
        document.body.style.marginBottom = '';

        const sr = DOMService.get(CONFIG.DOM.searchResultsId);
        if (sr) sr.innerHTML = `<div class="search-result-here" style="text-align:center;color:#969ca8;font-size:1.07em;margin-top:30px;">${LanguageService.t('search_result_here')}</div>`;
        UIService.updateUILanguage();

        // Restore lastCommittedSearchState from history or session
        try {
          const hs = history.state;
          if (hs && hs.q !== undefined && !hs[State._overlayStateMarker]) {
            State.lastCommittedSearchState = { q:hs.q||'', type:hs.type||'all', category:hs.category||'all' };
          } else {
            const arr = StorageService.getHistory();
            if (arr.length) { const l=arr[arr.length-1]; State.lastCommittedSearchState = { q:l.q||'', type:l.type||'all', category:l.category||'all' }; }
            else State.lastCommittedSearchState = null;
          }
        } catch { State.lastCommittedSearchState = null; }

        // URL query on page load
        const init = URLService.readStateFromURL();
        if (init?.q) {
          SearchService.doSearchFromURL(init.q, init.type||'all', init.category||'all', 0);
        } else {
          URLService.replaceSearch({ q:'', type:'all', category:'all' });
        }

      }).catch(e => { console.error('[SearchUI] init failed', e); State.apiData = State.apiData||{}; });

      // Form submit
      const form = DOMService.get(CONFIG.DOM.searchFormId);
      if (form) {
        Handlers.formSubmit = e => { e.preventDefault(); SearchService.doSearch(); UIService.closeKB(); };
        DOMService.on(form, 'submit', Handlers.formSubmit);
      }

      // Enter on main input (before overlay listeners attach)
      const inp = DOMService.get(CONFIG.DOM.searchInputId);
      if (inp) {
        const kd = e => { if (e.key === 'Enter') { e.preventDefault(); SearchService.doSearch(); UIService.closeKB(); } };
        DOMService.on(inp, 'keydown', kd);
      }

      // Popstate handler (v3.3 — two-stack model)
      // back-btn now calls history.back() → this handler fires → closes overlay
      Handlers.popstate = e => {
        try {
          const s = e.state || {};
          const isOverlayEntry = !!s[State._overlayStateMarker];

          if (State.overlayOpen) {
            // Popstate while overlay open = back-btn was pressed (or browser back)
            // close() with 'popstate' so collapseOverlayEntry is skipped
            // (browser already popped the entry natively)
            OverlayService.close('popstate');

            // Restore search UI to wherever we landed
            // If it's a real search entry (not overlay marker), restore it
            if (!isOverlayEntry && s.q !== undefined) {
              // Small delay to let overlay close animation start first
              setTimeout(() => _restoreUIState(s), 50);
            } else if (isOverlayEntry) {
              // Shouldn't happen (popping overlay entry IS what triggered this)
              // but guard: treat wrapped state as search state
              const searchSt = { q: s.q||'', type: s.type||'all', category: s.category||'all' };
              setTimeout(() => _restoreUIState(searchSt), 50);
            }
            return;
          }

          if (isOverlayEntry) {
            // Forward navigation landed on an overlay entry without overlay open
            // Replace it with the search state it wraps, then restore
            const searchSt = { q: s.q||'', type: s.type||'all', category: s.category||'all' };
            URLService.replaceSearch(searchSt);
            _restoreUIState(searchSt);
            return;
          }

          // Regular search entry — restore UI to this state
          const st = (e.state && typeof e.state === 'object') ? e.state : URLService.readStateFromURL();
          if (st?.q !== undefined) _restoreUIState(st);
        } catch {}
      };
      DOMService.on(window, 'popstate', Handlers.popstate);
      State._handlersAttached = true;
    } catch(e) { console.error('initializeSearchEngine failed', e); }
  }

  function _restoreUIState(st) {
    try {
      State.suppressHistoryPush = true;
      const inp = DOMService.get(CONFIG.DOM.searchInputId);
      if (inp) inp.value = st.q || '';
      State.selectedType     = st.type     || 'all';
      State.selectedCategory = st.category || 'all';
      FilterService.setupTypeFilter(State.selectedType);
      SearchService.doSearch(null, true);
      ClearBtnService.sync();
      IconSlotService.update();
    } finally { State.suppressHistoryPush = false; }
  }

  // =========================================================
  // DESTROY
  // =========================================================
  function destroy() {
    try {
      if (State.overlayOpen) OverlayService.close('manual');
      VirtualScrollEngine.destroy();
      KeyboardAutoToggleService.disableAutoToggle();
      try {
        DOMService.off(window, 'resize', Handlers.resize);
        DOMService.off(window, 'popstate', Handlers.popstate);
        DOMService.off(DOMService.get(CONFIG.DOM.searchFormId), 'submit', Handlers.formSubmit);
        DOMService.off(DOMService.get(CONFIG.DOM.searchResultsId), 'click', Handlers.copyClick);
        const inp = DOMService.get(CONFIG.DOM.searchInputId);
        if (inp) {
          if (Handlers.inputInput)   inp.removeEventListener('input',   Handlers.inputInput);
          if (Handlers.inputKeydown) inp.removeEventListener('keydown', Handlers.inputKeydown);
          if (Handlers.inputFocus)   inp.removeEventListener('focus',   Handlers.inputFocus);
          if (Handlers.inputClick)   inp.removeEventListener('click',   Handlers.inputClick);
        }
        if (Handlers.documentKeydownOverlay) DOMService.off(document,'keydown',Handlers.documentKeydownOverlay);
      } catch {}
      State._timeouts.forEach(t=>{ try{clearTimeout(t);clearInterval(t);}catch{} });
      State._timeouts.clear();
      try {
        DOMService.remove(DOMService.get(CONFIG.DOM.suggestionContainerId));
        DOMService.remove(DOMService.get(CONFIG.DOM.overlayContainerId));
        DOMService.remove(DOMService.get(CONFIG.DOM.sentinelId));
      } catch {}
      State.apiData=null; State.allKeywordsCache=[]; State.currentResults=[];
      State.currentFilteredResults=[]; State.lastCommittedSearchState=null;
      State._handlersAttached=false; State.keyboardAutoToggleEnabled=false;
      UIService._wrapperBuilt=false; window._copyResultTextHandlerSet=false;
      if (window.__searchUI) window.__searchUI._initialized=false;
    } catch {}
  }

  // =========================================================
  // PUBLIC API
  // =========================================================
  window.__searchUI = window.__searchUI || {};
  Object.assign(window.__searchUI, {
    init    : initializeSearchEngine,
    destroy,
    getConfig   : () => CONFIG,
    getState    : () => State,
    getServices : () => ({
      Language:LanguageService, DOM:DOMService, String:StringService, Storage:StorageService,
      URL:URLService, Notification:NotificationService, Rendering:RenderingService,
      Filter:FilterService, Suggestion:SuggestionService, ReadyMode:ReadyModeService,
      Highlight:HighlightService, Overlay:OverlayService, Search:SearchService,
      UI:UIService, Keyboard:KeyboardService, IconSlot:IconSlotService,
      ClearBtn:ClearBtnService, GapBasedKeyboard:GapBasedKeyboardService,
      KeyboardAutoToggle:KeyboardAutoToggleService, VirtualScroll:VirtualScrollEngine,
    }),
    getLastCommittedSearchState : () => State.lastCommittedSearchState,
    getSessionHistory           : () => StorageService.getHistory(),
    querySuggestions            : q  => window.SearchEngine?.querySuggestions?.(q, CONFIG.RENDER.suggestionMax) || [],
    isKeyboardOpen              : () => KeyboardService.isKeyboardOpen(),
    enableKeyboardAutoToggle    : () => KeyboardAutoToggleService.enableAutoToggle(),
    disableKeyboardAutoToggle   : () => KeyboardAutoToggleService.disableAutoToggle(),
    resetKeyboardGap            : () => GapBasedKeyboardService.resetGap(),
    isKeyboardGapExpired        : () => GapBasedKeyboardService.isGapExpired(),
    isKeyboardScrollIdle        : () => GapBasedKeyboardService.isScrollIdle(),
    getVSStats: () => ({
      itemCount   : VirtualScrollEngine._items.length,
      visibleCount: VirtualScrollEngine._vis?.size || 0,
      poolSize    : VirtualScrollEngine._pool.length,
      totalHeight : VirtualScrollEngine._total,
    }),
  });

  window.__searchUI._initialized = true;
  initializeSearchEngine();

  try { window.addEventListener('beforeunload', ()=>{ try{destroy();}catch{} }, { passive:true }); } catch {}

})();
