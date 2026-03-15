/*
  search-ui.js (v2.2 — ConDataService timing fix)
  ────────────────────────────────────────────────
  ✅ GAP-BASED KEYBOARD CONTROL
  ✅ IDLE DETECTION & RECOVERY
  ✅ AUTO-TOGGLE SCROLL
  ✅ STABLE HISTORY SYSTEM
  ✅ ROBUST ERROR HANDLING & CLEANUP
  ✅ v2.2: DATA SOURCE = ConDataService (ไม่ใช้ db.min.json แล้ว)
       - waitForConDataService() แก้ปัญหา ES Module timing
       - fallback ไป db.min.json เฉพาะเมื่อ ConDataService ไม่พร้อมจริงๆ
*/
(function () {
  'use strict';

  if (window.__searchUI && window.__searchUI._initialized) return;

  const CONFIG = {
    DOM: {
      suggestionContainerId: 'searchSuggestions',
      suggestionBackdropId: 'searchSuggestionBackdrop',
      overlayBackdropId: 'searchOverlayBackdrop',
      overlayContainerId: 'searchOverlayContainer',
      sentinelId: 'search-render-sentinel',
      searchInputId: 'searchInput',
      searchFormId: 'searchForm',
      typeFilterId: 'typeFilter',
      categoryFilterId: 'categoryFilter',
      searchResultsId: 'searchResults',
      copyToastId: 'copyToast',
      searchInputWrapperId: 'search-input-wrapper',
      filterPanelSelector: '.search-filters-panel',
      placeholderId: 'search-wrapper-placeholder'
    },
    RENDER: {
      batchSize: 12,
      sentinelHeight: '36px',
      suggestionMax: 8,
      intersectionThreshold: 0.1,
      intersectionRootMargin: '0px',
      suggestionsFullscreenMax: 30
    },
    TIMING: {
      debounceMs: 120,
      toastDisplayMs: 1400,
      toastFadeMs: 250,
      focusDelayMs: 20,
      renderDelayMs: 40,
      transitionDelayMs: 350,
      blurDelayMs: 200,
      keyboardDetectionDelayMs: 100,
      keyboardGapMinMs: 300,
      keyboardGapRecoveryMs: 800,
      keyboardIdleTimeMs: 500,
      // ✅ v2.2: รอ ConDataService โหลด (ES Module defer)
      conDataServiceWaitMs: 5000,
      conDataServicePollMs: 30
    },
    STORAGE: {
      historyKey: 'searchHistory_v1',
      langKey: 'selectedLang'
    },
    DB: { path: '/assets/db/db.min.json' }, // fallback เท่านั้น
    LANG: { default: 'en', autoDetect: true },
    TEXTS: {
      th: {
        all_types: 'ทุกประเภท',
        all_categories: 'ทุกหมวดหมู่',
        not_found: 'ไม่พบข้อมูลที่ตรงหรือใกล้เคียง',
        copy: 'คัดลอก',
        copy_failed: 'คัดลอกไม่สำเร็จ',
        suggestion_label: 'คำแนะนำ',
        suggestions_for_you: 'คำแนะนำสำหรับคุณ',
        search_result_here: 'ผลลัพธ์การค้นหาจะปรากฏที่นี่',
        search_placeholder: 'ค้นหาข้อมูล...',
        type: 'ประเภท',
        category: 'หมวดหมู่',
        emoji: 'อีโมจิ',
        trending: 'ยอดนิยม',
        recent: 'ล่าสุด'
      },
      en: {
        all_types: 'All Types',
        all_categories: 'All Categories',
        not_found: 'No data found related to your keyword.',
        copy: 'Copy',
        copy_failed: 'Failed to copy',
        suggestion_label: 'Suggestions',
        suggestions_for_you: 'Suggestions for you',
        search_result_here: 'Search results will appear here',
        search_placeholder: 'Search information...',
        type: 'Type',
        category: 'Category',
        emoji: 'Emoji',
        trending: 'Trending',
        recent: 'Recent'
      }
    }
  };

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
    ignoreNextHideSuggestions: false,
    overlayOpenedAt: null,
    originalInputParent: null,
    originalInputNextSibling: null,
    originalPlaceholder: null,
    debounceTimeout: null,
    renderObserver: null,
    currentRenderIndex: 0,
    isReadyMode: false,
    readyModeSuggestions: [],
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
    resultsContainer: null
  };

  const Handlers = {
    resize: null, inputFocus: null, inputBlur: null, inputClick: null,
    inputInput: null, inputKeydown: null, formSubmit: null,
    overlayBackdropClick: null, suggestionClick: null, suggestionKeydown: null,
    documentKeydownOverlay: null, popstate: null, documentClick: null,
    copyClick: null, overlayScroll: null
  };

  // -------------------------
  // Utility Services
  // -------------------------
  const LanguageService = {
    getLang() {
      try {
        return localStorage.getItem(CONFIG.STORAGE.langKey) ||
               (CONFIG.LANG.autoDetect && navigator.language?.startsWith('th') ? 'th' : CONFIG.LANG.default);
      } catch (e) { return CONFIG.LANG.default; }
    },
    setLang(lang) { try { localStorage.setItem(CONFIG.STORAGE.langKey, lang); } catch (e) {} },
    t(key) {
      const lang = this.getLang();
      return CONFIG.TEXTS[lang]?.[key] || CONFIG.TEXTS[CONFIG.LANG.default][key] || key;
    }
  };

  const DOMService = {
    get: id => document.getElementById(id),
    query: sel => document.querySelector(sel),
    queryAll: sel => document.querySelectorAll(sel),
    create(tag, id, className, styles) {
      const el = document.createElement(tag);
      if (id) el.id = id;
      if (className) el.className = className;
      if (styles) Object.assign(el.style, styles);
      return el;
    },
    remove(el) { try { if (el?.parentNode) el.parentNode.removeChild(el); } catch (e) {} },
    setStyles(el, styles) { if (!el) return; try { Object.assign(el.style, styles); } catch (e) {} },
    setText(el, text) { if (el) el.textContent = text; },
    setHTML(el, html) { if (el) el.innerHTML = html; },
    setAttr(el, key, value) { if (el) el.setAttribute(key, value); },
    getAttr: (el, key) => el?.getAttribute(key),
    addClass: (el, cls) => el?.classList?.add(cls),
    removeClass: (el, cls) => el?.classList?.remove(cls),
    hasClass: (el, cls) => el?.classList?.contains(cls),
    on(el, ev, handler, opts) { if (el && handler) el.addEventListener(ev, handler, opts); },
    off(el, ev, handler) { if (el && handler) el.removeEventListener(ev, handler); }
  };

  const StringService = {
    escapeHtml: s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    encodeUrl: s => encodeURIComponent(s),
    decodeUrl: s => { try { return decodeURIComponent(s); } catch (e) { return s; } }
  };

  const StorageService = {
    getHistory() {
      try { return JSON.parse(sessionStorage.getItem(CONFIG.STORAGE.historyKey) || '[]'); } catch (e) { return []; }
    },
    addSearchToHistory(state) {
      try {
        const arr = this.getHistory();
        arr.push(Object.assign({}, state, { ts: Date.now() }));
        sessionStorage.setItem(CONFIG.STORAGE.historyKey, JSON.stringify(arr));
      } catch (e) {}
    },
    clearHistory() { try { sessionStorage.removeItem(CONFIG.STORAGE.historyKey); } catch (e) {} }
  };

  // -------------------------
  // Gap-based Keyboard Service
  // -------------------------
  const GapBasedKeyboardService = {
    isGapExpired: () => (Date.now() - State.lastKeyboardToggleTime) >= CONFIG.TIMING.keyboardGapMinMs,
    isRecoveryTimeExpired: () => (Date.now() - State.lastKeyboardToggleTime) >= CONFIG.TIMING.keyboardGapRecoveryMs,
    recordToggle: () => { State.lastKeyboardToggleTime = Date.now(); },
    markScrollActivity() {
      State.lastScrollTime = Date.now();
      if (!State.isScrollingActive) State.isScrollingActive = true;
      if (State.scrollIdleTimer) clearTimeout(State.scrollIdleTimer);
      State.scrollIdleTimer = setTimeout(() => { State.isScrollingActive = false; }, CONFIG.TIMING.keyboardIdleTimeMs);
    },
    isScrollIdle: () => !State.isScrollingActive,
    resetGap: () => { State.lastKeyboardToggleTime = 0; }
  };

  const KEYBOARD_AUTO_OPEN_ENABLED = false;

  const KeyboardAutoToggleService = {
    enableAutoToggle(scrollableContainer) {
      if (State.keyboardAutoToggleEnabled) return;
      State.keyboardAutoToggleEnabled = true;
      State.lastOverlayScrollY = 0;
      GapBasedKeyboardService.resetGap();
      const scrollable = scrollableContainer || DOMService.get(CONFIG.DOM.overlayContainerId);
      if (!scrollable) return;
      State.keyboardAutoToggleHandler = () => {
        try {
          const cur = scrollable.scrollTop || 0;
          GapBasedKeyboardService.markScrollActivity();
          if (cur === 0 && State.lastOverlayScrollY > 0) {
            if (GapBasedKeyboardService.isGapExpired() || GapBasedKeyboardService.isRecoveryTimeExpired()) {
              this.openKeyboard(); GapBasedKeyboardService.recordToggle();
            }
          } else if (cur > 0 && State.lastOverlayScrollY === 0) {
            if (GapBasedKeyboardService.isGapExpired()) { this.closeKeyboard(); GapBasedKeyboardService.recordToggle(); }
          } else if (cur === 0 && GapBasedKeyboardService.isScrollIdle() && GapBasedKeyboardService.isRecoveryTimeExpired()) {
            const inputEl = DOMService.get(CONFIG.DOM.searchInputId);
            if (inputEl && document.activeElement !== inputEl) { this.openKeyboard(); GapBasedKeyboardService.recordToggle(); }
          }
          State.lastOverlayScrollY = cur;
        } catch (e) {}
      };
      scrollable.addEventListener('scroll', State.keyboardAutoToggleHandler, { passive: true });
    },
    disableAutoToggle() {
      if (!State.keyboardAutoToggleEnabled) return;
      State.keyboardAutoToggleEnabled = false;
      const scrollable = State.scrollableContent || DOMService.get(CONFIG.DOM.overlayContainerId);
      if (scrollable && State.keyboardAutoToggleHandler) scrollable.removeEventListener('scroll', State.keyboardAutoToggleHandler);
      if (State.scrollIdleTimer) clearTimeout(State.scrollIdleTimer);
      State.keyboardAutoToggleHandler = null;
    },
    openKeyboard() {
      if (!KEYBOARD_AUTO_OPEN_ENABLED) return;
      const inputEl = DOMService.get(CONFIG.DOM.searchInputId);
      if (inputEl && document.activeElement !== inputEl) inputEl.focus();
    },
    closeKeyboard() {
      const inputEl = DOMService.get(CONFIG.DOM.searchInputId);
      if (inputEl && document.activeElement === inputEl) inputEl.blur();
    }
  };

  const KeyboardService = {
    initKeyboardDetection() {
      try {
        State.lastWindowInnerHeight = window.innerHeight || 0;
        Handlers.resize = () => {
          clearTimeout(State.keyboardDetectionTimeout);
          State.keyboardDetectionTimeout = setTimeout(() => { try { this.updateKeyboardStatus(); } catch (e) {} }, CONFIG.TIMING.keyboardDetectionDelayMs);
        };
        DOMService.on(window, 'resize', Handlers.resize);
        const inputEl = DOMService.get(CONFIG.DOM.searchInputId);
        if (inputEl) {
          Handlers.inputFocus = () => {
            clearTimeout(State.keyboardDetectionTimeout);
            State.keyboardDetectionTimeout = setTimeout(() => { this.updateKeyboardStatus(); }, CONFIG.TIMING.keyboardDetectionDelayMs);
          };
          Handlers.inputBlur = () => {
            clearTimeout(State.keyboardDetectionTimeout);
            State.keyboardDetectionTimeout = setTimeout(() => { State.keyboardOpen = false; }, CONFIG.TIMING.keyboardDetectionDelayMs);
          };
          DOMService.on(inputEl, 'focus', Handlers.inputFocus);
          DOMService.on(inputEl, 'blur', Handlers.inputBlur);
        }
      } catch (e) {}
    },
    updateKeyboardStatus() {
      try {
        const cur = window.innerHeight || 0;
        const diff = State.lastWindowInnerHeight - cur;
        if (diff > 100) State.keyboardOpen = true;
        else if (diff < -100) State.keyboardOpen = false;
        State.lastWindowInnerHeight = cur;
      } catch (e) {}
    },
    isKeyboardOpen: () => !!State.keyboardOpen
  };

  const URLService = {
    parseQueryString(qs) {
      const out = {};
      if (!qs) return out;
      for (const p of qs.replace(/^\?/,'').split('&')) {
        if (!p) continue;
        const idx = p.indexOf('=');
        if (idx === -1) out[decodeURIComponent(p)] = '';
        else out[decodeURIComponent(p.substring(0,idx))] = decodeURIComponent(p.substring(idx+1));
      }
      return out;
    },
    buildQueryString(obj) {
      const parts = [];
      for (const k in obj) {
        if (obj[k] == null) continue;
        parts.push(StringService.encodeUrl(k) + '=' + StringService.encodeUrl(obj[k]));
      }
      return parts.length ? '?' + parts.join('&') : '';
    },
    readStateFromURL() {
      try {
        const p = this.parseQueryString(window.location.search || '');
        return { q: p.q||'', type: p.type||'all', category: p.category||'all' };
      } catch (e) { return { q:'', type:'all', category:'all' }; }
    },
    buildUrlForState(state) {
      const p = {};
      if (state.q) p.q = state.q;
      if (state.type && state.type !== 'all') p.type = state.type;
      if (state.category && state.category !== 'all') p.category = state.category;
      return this.buildQueryString(p);
    },
    isStateEqual(a, b) {
      if (!a && !b) return true; if (!a || !b) return false;
      return (a.q||'').trim() === (b.q||'').trim() && (a.type||'all') === (b.type||'all') && (a.category||'all') === (b.category||'all');
    },
    commitSearchState(state) {
      try {
        if (this.isStateEqual(state, State.lastCommittedSearchState)) return;
        const url = this.buildUrlForState(state);
        try {
          if (State.searchHistoryPushed) { history.replaceState(state,'',url); State.searchHistoryPushed = false; }
          else history.pushState(state,'',url);
        } catch (e) { try { history.replaceState(state,'',url); } catch (ee) {} State.searchHistoryPushed = false; }
        StorageService.addSearchToHistory(state);
        State.lastCommittedSearchState = { q:state.q||'', type:state.type||'all', category:state.category||'all' };
      } catch (e) {}
    },
    syncOverlayCloseWithHistory() {
      if (State.searchHistoryPushed) {
        try { const s = State.lastCommittedSearchState||{q:'',type:'all',category:'all'}; history.replaceState(s,'',this.buildUrlForState(s)); } catch (e) {}
        State.searchHistoryPushed = false;
      }
    }
  };

  const NotificationService = {
    showCopyToast(msg) {
      try {
        const toast = DOMService.create('div', null, 'copy-toast-message');
        DOMService.setText(toast, msg);
        const area = DOMService.get(CONFIG.DOM.copyToastId) || document.body;
        area.appendChild(toast);
        const t = setTimeout(() => {
          try { DOMService.setStyles(toast, {opacity:'0',transform:'translateY(-10px)'}); setTimeout(() => DOMService.remove(toast), CONFIG.TIMING.toastFadeMs); } catch (e) {}
        }, CONFIG.TIMING.toastDisplayMs);
        State._timeouts.add(t);
      } catch (e) {}
    },
    async copyText(text) {
      try {
        if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); this.showCopyToast(LanguageService.t('copy') + ' แล้ว'); return; }
        const ta = document.createElement('textarea'); ta.value = text; ta.style.position='fixed'; ta.style.left='-9999px';
        document.body.appendChild(ta); ta.select();
        if (document.execCommand('copy')) this.showCopyToast(LanguageService.t('copy') + ' แล้ว');
        else this.showCopyToast(LanguageService.t('copy_failed'));
        document.body.removeChild(ta);
      } catch (e) { this.showCopyToast(LanguageService.t('copy_failed')); }
    }
  };

  const HighlightService = {
    highlightAllMatches(text, query) {
      if (!text || !query) return StringService.escapeHtml(text || '');
      try {
        const t = String(text).toLowerCase();
        const chars = new Set(String(query).toLowerCase().split(''));
        let result = '';
        for (let i = 0; i < t.length; i++) {
          if (chars.has(t[i])) result += '<strong style="background-color:#fff3cd;font-weight:700">' + StringService.escapeHtml(String(text)[i]) + '</strong>';
          else result += StringService.escapeHtml(String(text)[i]);
        }
        return result;
      } catch (e) { return StringService.escapeHtml(text); }
    }
  };

  const RenderingService = {
    renderResultItem(item, lang) {
      try {
        const itemData = item.item || item;
        const itemText = itemData?.text || itemData?.name?.[lang] || itemData?.name?.en || item.itemName || '';
        const itemApi = itemData?.api || '';
        const typeName = item.typeName || item.typeObj?.name?.[lang] || item.typeObj?.name?.en || LanguageService.t('emoji');
        const catName = item.catName || item.category?.name?.[lang] || item.category?.name?.en || '';
        const itemNames = [];
        if (item.itemName) itemNames.push(item.itemName);
        if (itemData?.name) { const n = itemData.name[lang] || itemData.name.en; if (n && !itemNames.includes(n)) itemNames.push(n); }
        for (const k in (itemData||{})) {
          if (/_name$/.test(k) && itemData[k]) { const n = itemData[k][lang] || itemData[k].en; if (n && !itemNames.includes(n)) itemNames.push(n); }
        }
        const nameStr = itemNames.filter(Boolean).join(' / ');
        const text = itemText || itemApi || '-';
        return `<div class="result-item search-card" role="article" aria-label="${StringService.escapeHtml(nameStr||text)}">
          <div class="card-content" aria-hidden="true">${StringService.escapeHtml(String(text).slice(0,300))}</div>
          <div class="card-body">
            <div class="card-title">${StringService.escapeHtml(nameStr||(itemData&&(itemData.name?(itemData.name[lang]||itemData.name.en):itemData.api))||text)}</div>
            <div class="card-subtitle">${StringService.escapeHtml(itemApi||typeName||'')}</div>
            <div class="card-tags" aria-hidden="true">
              ${typeName?`<span class="tag">${StringService.escapeHtml(typeName)}</span>`:''}
              ${catName?`<span class="tag">${StringService.escapeHtml(catName)}</span>`:''}
            </div>
          </div>
          <button class="result-copy-btn" data-text="${StringService.encodeUrl(text)}" aria-label="${LanguageService.t('copy')}">${LanguageService.t('copy')}</button>
        </div>`;
      } catch (e) { return `<div class="result-item"><div class="result-content-area">-</div></div>`; }
    },
    adjustCardLayout(cardEl) {
      try {
        if (!cardEl || cardEl.getAttribute('data-layout-checked')) return;
        const content = cardEl.querySelector('.card-content');
        const body = cardEl.querySelector('.card-body');
        if (!content || !body) { cardEl.setAttribute('data-layout-checked','1'); return; }
        const clientH = content.clientHeight || parseInt(window.getComputedStyle(content).height) || 56;
        const txt = (content.textContent||'').trim();
        if (content.scrollHeight > clientH+4 || txt.indexOf('\n')!==-1 || (txt.length>40&&txt.indexOf(' ')!==-1) || txt.split(/\s+/).filter(Boolean).length>6)
          DOMService.addClass(cardEl,'vertical');
        else DOMService.removeClass(cardEl,'vertical');
        cardEl.setAttribute('data-layout-checked','1');
      } catch (e) { try { cardEl.setAttribute('data-layout-checked','1'); } catch (ee) {} }
    },
    applySmartCardLayoutToNewCards() {
      try {
        const container = DOMService.get(CONFIG.DOM.searchResultsId);
        if (!container) return;
        container.querySelectorAll('.search-card:not([data-layout-checked])').forEach(c => { try { this.adjustCardLayout(c); } catch (e) {} });
      } catch (e) {}
    },
    disconnectRenderObserver() {
      try { if (State.renderObserver) { State.renderObserver.disconnect(); State.renderObserver = null; } } catch (e) {}
      DOMService.remove(DOMService.get(CONFIG.DOM.sentinelId));
    },
    renderNextBatch() {
      try {
        const container = DOMService.get(CONFIG.DOM.searchResultsId);
        if (!container) return;
        const lang = LanguageService.getLang();
        const end = Math.min(State.currentRenderIndex + CONFIG.RENDER.batchSize, State.currentFilteredResults.length);
        let frag = '';
        for (let i = State.currentRenderIndex; i < end; i++) frag += this.renderResultItem(State.currentFilteredResults[i], lang);
        const sentinel = DOMService.get(CONFIG.DOM.sentinelId);
        if (sentinel) sentinel.insertAdjacentHTML('beforebegin', frag);
        else container.insertAdjacentHTML('beforeend', frag);
        State.currentRenderIndex = end;
        setTimeout(() => { try { this.applySmartCardLayoutToNewCards(); } catch (e) {} }, 20);
        if (State.currentRenderIndex >= State.currentFilteredResults.length) { this.disconnectRenderObserver(); return; }
        if (!DOMService.get(CONFIG.DOM.sentinelId)) {
          container.appendChild(DOMService.create('div', CONFIG.DOM.sentinelId, 'search-sentinel', {width:'100%',height:CONFIG.RENDER.sentinelHeight,display:'block'}));
        }
        if (!State.renderObserver && 'IntersectionObserver' in window) {
          try {
            State.renderObserver = new IntersectionObserver((entries) => {
              for (const e of entries) if (e.isIntersecting) setTimeout(() => { if (State.currentRenderIndex < State.currentFilteredResults.length) this.renderNextBatch(); }, 50);
            }, { root:null, rootMargin:CONFIG.RENDER.intersectionRootMargin, threshold:CONFIG.RENDER.intersectionThreshold });
            const sEl = DOMService.get(CONFIG.DOM.sentinelId);
            if (sEl) State.renderObserver.observe(sEl);
          } catch (e) {}
        }
      } catch (e) { console.error('renderNextBatch failed', e); }
    },
    extractResultCategories(results) {
      try {
        const lang = LanguageService.getLang();
        const categories = [], seen = Object.create(null);
        for (const r of results) {
          const key = (r.category?.name?.[lang] || r.category?.name?.en) || '';
          if (!seen[key]) { seen[key] = 1; categories.push({ key, displayName: key }); }
        }
        return categories;
      } catch (e) { return []; }
    },
    renderResults(results, showSuggestionsIfNoResult = false) {
      try {
        const container = DOMService.get(CONFIG.DOM.searchResultsId);
        const lang = LanguageService.getLang();
        if (!container) return;
        const filtered = State.selectedCategory !== 'all'
          ? results.filter(r => ((r.category?.name?.[lang] || r.category?.name?.en) || '') === State.selectedCategory)
          : results;
        document.body.style.marginBottom = '60px';
        this.disconnectRenderObserver();
        State.currentFilteredResults = []; State.currentRenderIndex = 0;
        if (!filtered.length) {
          let html = `<div class="no-result">${LanguageService.t('not_found')}</div>`;
          if (showSuggestionsIfNoResult) {
            html += `<div class="suggestions-title-main">${LanguageService.t('suggestions_for_you')}</div><div class="suggestions-block-list">`;
            const sample = State.apiData?.type?.[0]?.category?.[0]?.data?.slice(0,5) || [];
            const t0 = State.apiData?.type?.[0], c0 = t0?.category?.[0];
            for (const item of sample) {
              html += this.renderResultItem({ item, typeObj:t0, category:c0,
                itemName: item.name?.[lang] || item.name?.en || '',
                typeName: t0?.name?.[lang] || t0?.name?.en || '',
                catName: c0?.name?.[lang] || c0?.name?.en || '' }, lang);
            }
            html += '</div>';
          }
          DOMService.setHTML(container, html);
          const catFilterEl = DOMService.get(CONFIG.DOM.categoryFilterId);
          if (catFilterEl) catFilterEl.style.display = '';
          UIService.updateUILanguage();
          setTimeout(() => { try { this.applySmartCardLayoutToNewCards(); } catch (e) {} }, 20);
          return;
        }
        State.currentFilteredResults = filtered; State.currentRenderIndex = 0;
        DOMService.setHTML(container, '');
        this.renderNextBatch();
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
    }
  };

  const FilterService = {
    setupTypeFilter(selected = 'all') {
      try {
        const typeFilter = DOMService.get(CONFIG.DOM.typeFilterId);
        if (!typeFilter) return;
        const lang = LanguageService.getLang();
        let buf = [`<option value="all">${LanguageService.t('all_types')}</option>`];
        for (const t of (State.apiData?.type || [])) {
          const label = t.name?.[lang] || t.name?.en || '';
          buf.push(`<option value="${StringService.escapeHtml(label)}">${StringService.escapeHtml(label)}</option>`);
        }
        DOMService.setHTML(typeFilter, buf.join(''));
        typeFilter.value = selected;
      } catch (e) {}
    },
    setupCategoryFilter(categories, selected = 'all') {
      try {
        const catFilter = DOMService.get(CONFIG.DOM.categoryFilterId);
        if (!catFilter) return;
        let buf = [`<option value="all">${LanguageService.t('all_categories')}</option>`];
        for (const {key, displayName} of categories)
          buf.push(`<option value="${StringService.escapeHtml(key)}">${StringService.escapeHtml(displayName)}</option>`);
        DOMService.setHTML(catFilter, buf.join(''));
        catFilter.style.display = ''; catFilter.value = selected;
      } catch (e) {}
    }
  };

  const ReadyModeService = {
    extractSmartNames() {
      try {
        if (!State.apiData || !State.allKeywordsCache) return [];
        const lang = LanguageService.getLang();
        const suggestions = [], seen = new Set();
        for (const kw of State.allKeywordsCache) {
          if (suggestions.length >= CONFIG.RENDER.suggestionsFullscreenMax) break;
          if (!kw?.item) continue;
          let name = '';
          if (kw.item.name && typeof kw.item.name === 'object') name = kw.item.name[lang] || kw.item.name.en || '';
          if (!name || name.length < 2) continue;
          if (!/[\u0E00-\u0E7F]/.test(name) && /^[A-Za-z0-9_\-]+$/.test(name) && name.length <= 20) continue;
          if (seen.has(name)) continue;
          seen.add(name);
          suggestions.push({ raw: name, display: name, highlightedHtml: StringService.escapeHtml(name), source: 'trending' });
        }
        return suggestions;
      } catch (e) { return []; }
    },
    renderReadyModeSuggestions() {
      try {
        if (!State.isReadyMode || !State.overlayOpen) return;
        const container = SuggestionService.ensureSuggestionContainer();
        if (!container) return;
        const suggestions = this.extractSmartNames();
        if (!suggestions?.length) { DOMService.setHTML(container,''); container.style.display='none'; return; }
        let html = `<div class="suggestions-head">${LanguageService.t('trending')}</div>`;
        for (const s of suggestions)
          html += `<div class="suggestion-item" role="option" tabindex="0" data-val="${StringService.encodeUrl(s.raw)}">
                    <div class="suggestion-body" style="flex:1;word-break:break-word">${s.highlightedHtml}</div>
                  </div>`;
        DOMService.setHTML(container, html); container.style.display = 'block';
        SuggestionService.createSuggestionBackdrop();
        State.readyModeSuggestions = suggestions;
      } catch (e) {}
    }
  };

  const SuggestionService = {
    ensureSuggestionContainer: () => DOMService.get(CONFIG.DOM.suggestionContainerId),
    createSuggestionBackdrop() {
      try {
        const overlay = DOMService.get(CONFIG.DOM.overlayContainerId);
        if (!overlay) return null;
        let bd = DOMService.get(CONFIG.DOM.suggestionBackdropId);
        if (bd) return bd;
        bd = DOMService.create('div', CONFIG.DOM.suggestionBackdropId, null, {
          position:'absolute', left:'0', top:'0', right:'0', bottom:'0', zIndex:'9997', background:'transparent', pointerEvents:'none'
        });
        overlay.insertBefore(bd, overlay.firstChild);
        return bd;
      } catch (e) { return null; }
    },
    removeSuggestionBackdrop: () => DOMService.remove(DOMService.get(CONFIG.DOM.suggestionBackdropId)),
    handleSuggestionKeydown(ev, container) {
      try {
        const items = Array.from(container.querySelectorAll('.suggestion-item'));
        if (!items.length) return;
        const idx = items.indexOf(document.activeElement);
        if (ev.key === 'ArrowDown') { ev.preventDefault(); items[Math.min(items.length-1, idx===-1?0:idx+1)]?.focus?.(); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); items[Math.max(0, idx===-1?items.length-1:idx-1)]?.focus?.(); }
        else if (ev.key === 'Enter') { ev.preventDefault(); if (document.activeElement?.classList?.contains('suggestion-item')) document.activeElement?.click?.(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); try { OverlayService.closeSearchOverlay('escape'); } catch (e) {} }
      } catch (e) {}
    },
    handleSuggestionClick(ev) {
      try {
        const it = ev.target.closest('.suggestion-item');
        if (!it) return;
        ev.stopPropagation?.(); ev.preventDefault?.();
        const val = StringService.decodeUrl(it.getAttribute('data-val') || '');
        const inputEl = DOMService.get(CONFIG.DOM.searchInputId);
        if (inputEl) inputEl.value = val;
        State.suggestionsLocked = false;
        SearchService.doSearch(null, false);
      } catch (e) {}
    },
    renderQuerySuggestions(query) {
      try {
        if (State.overlayTransitioning) return;
        const container = this.ensureSuggestionContainer();
        if (!container) return;
        if (!query?.trim()) { State.isReadyMode = true; State.lastQuery = ''; ReadyModeService.renderReadyModeSuggestions(); return; }
        State.lastQuery = query; State.isReadyMode = false;
        const suggestions = window.SearchEngine?.querySuggestions?.(query, CONFIG.RENDER.suggestionsFullscreenMax) || [];
        if (!suggestions?.length) { State.isReadyMode = true; ReadyModeService.renderReadyModeSuggestions(); return; }
        let html = `<div class="suggestions-head">${LanguageService.t('suggestion_label')}</div>`;
        for (const s of suggestions)
          html += `<div class="suggestion-item" role="option" tabindex="0" data-val="${StringService.encodeUrl(s.raw)}">
                    <div class="suggestion-body">${HighlightService.highlightAllMatches(s.raw, query)}</div>
                  </div>`;
        DOMService.setHTML(container, html); container.style.display = 'block';
        this.createSuggestionBackdrop();
        const inputEl = DOMService.get(CONFIG.DOM.searchInputId);
        if (inputEl) inputEl.onkeydown = e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); container.querySelector('.suggestion-item')?.focus?.(); }
          else if (e.key === 'Escape') { try { OverlayService.closeSearchOverlay('escape'); } catch (err) {} }
        };
      } catch (e) {}
    }
  };

  const OverlayService = {
    createOverlayBackdrop() {
      try {
        let bd = DOMService.get(CONFIG.DOM.overlayBackdropId);
        if (bd) return bd;
        bd = DOMService.create('div', CONFIG.DOM.overlayBackdropId, 'search-overlay-backdrop', {
          position:'fixed', left:'0', top:'0', width:'100%', height:'100%',
          background:'rgba(12,14,18,0.48)', zIndex:'9997', backdropFilter:'blur(4px)', pointerEvents:'auto', cursor:'default'
        });
        Handlers.overlayBackdropClick = e => {
          try {
            if (e.target === bd) {
              e.preventDefault?.(); e.stopPropagation?.();
              if (KeyboardService.isKeyboardOpen()) return;
              const inputEl = DOMService.get(CONFIG.DOM.searchInputId);
              const cur = (inputEl?.value||'').trim(), last = (State.preOverlayState?.q||'').trim();
              if (cur !== last && cur.length > 0) SearchService.doSearch(null, false, {keepOverlay:false});
              else OverlayService.closeSearchOverlay('backdrop');
            }
          } catch (err) {}
        };
        DOMService.on(bd, 'click', Handlers.overlayBackdropClick);
        document.body.appendChild(bd); return bd;
      } catch (e) { return null; }
    },
    openSearchOverlay() {
      try {
        if (State.overlayOpen || State.overlayTransitioning) return;
        const wrapper = DOMService.query('.search-input-wrapper');
        if (!wrapper) return;
        State.overlayTransitioning = true;
        State.originalInputParent = wrapper.parentNode;
        State.originalInputNextSibling = wrapper.nextSibling;
        const placeholder = DOMService.create('div', CONFIG.DOM.placeholderId, null, {
          width: wrapper.offsetWidth+'px', height: wrapper.offsetHeight+'px', visibility:'hidden', display:'block'
        });
        State.originalPlaceholder = placeholder;
        State.originalInputParent.insertBefore(placeholder, State.originalInputNextSibling);
        const inputEl = DOMService.get(CONFIG.DOM.searchInputId);
        State.preOverlayState = { q: inputEl?.value||'', type: State.selectedType||'all', category: State.selectedCategory||'all' };
        State.overlayOpenedAt = Date.now();
        this.createOverlayBackdrop();
        let overlay = DOMService.get(CONFIG.DOM.overlayContainerId);
        if (!overlay) {
          overlay = DOMService.create('div', CONFIG.DOM.overlayContainerId, 'search-overlay search-overlay-open', {
            position:'fixed', left:'0', top:'0', width:'100%', height:'100%', zIndex:'9998',
            display:'flex', flexDirection:'column', alignItems:'stretch', justifyContent:'flex-start',
            padding:'0', overflow:'hidden', pointerEvents:'auto', backgroundColor:'#ffffff'
          });
          document.body.appendChild(overlay);
        } else DOMService.setHTML(overlay,'');
        const wrapperContainer = DOMService.create('div', null, 'search-overlay-input-wrapper', {
          position:'relative', top:'0', left:'0', right:'0', width:'100%', zIndex:'10001',
          background:'#ffffff', pointerEvents:'auto', paddingTop:'2px', paddingBottom:'5px',
          paddingLeft:'10px', paddingRight:'10px', borderBottom:'1px solid #f0f0f0', flexShrink:'0',
          display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center'
        });
        DOMService.addClass(wrapper, 'overlay-elevated');
        DOMService.setStyles(wrapper, {width:'100%',maxWidth:'100%',marginTop:'0',marginBottom:'0',pointerEvents:'auto'});
        wrapperContainer.appendChild(wrapper); overlay.appendChild(wrapperContainer);
        State.wrapperContainer = wrapperContainer;
        const scrollableContent = DOMService.create('div', null, 'search-overlay-scrollable-content', {
          flex:'1', width:'100%', overflow:'auto', overscrollBehavior:'contain', zIndex:'10000', pointerEvents:'auto'
        });
        const resultsWrapper = DOMService.create('div', null, 'search-overlay-results-wrapper', {
          width:'100%', padding:'0 0px 16px 0px', boxSizing:'border-box'
        });
        const resultsContainer = DOMService.create('div', CONFIG.DOM.searchResultsId, 'search-overlay-results', {width:'100%'});
        const suggestionsContainer = DOMService.create('div', CONFIG.DOM.suggestionContainerId, 'search-suggestions-fullscreen');
        resultsWrapper.appendChild(suggestionsContainer); resultsWrapper.appendChild(resultsContainer);
        scrollableContent.appendChild(resultsWrapper); overlay.appendChild(scrollableContent);
        State.scrollableContent = scrollableContent; State.resultsContainer = resultsContainer;
        Handlers.suggestionKeydown = ev => SuggestionService.handleSuggestionKeydown(ev, suggestionsContainer);
        Handlers.suggestionClick = ev => SuggestionService.handleSuggestionClick(ev);
        DOMService.on(suggestionsContainer, 'keydown', Handlers.suggestionKeydown);
        DOMService.on(suggestionsContainer, 'click', Handlers.suggestionClick, {capture:false});
        DOMService.on(suggestionsContainer, 'mouseenter', () => { State.suggestionsLocked = true; });
        DOMService.on(suggestionsContainer, 'mouseleave', () => { State.suggestionsLocked = false; });
        if (inputEl) setTimeout(() => { try { inputEl.focus(); inputEl.select?.(); } catch (e) {} }, CONFIG.TIMING.focusDelayMs);
        document.documentElement.style.overflow = 'hidden'; document.body.style.overflow = 'hidden';
        Handlers.documentKeydownOverlay = OverlayService.overlayEscHandler;
        DOMService.on(document, 'keydown', Handlers.documentKeydownOverlay);
        State.overlayOpen = true; State.isReadyMode = true; State.lastQuery = '';
        ReadyModeService.renderReadyModeSuggestions();
        KeyboardAutoToggleService.enableAutoToggle(scrollableContent);
        this._hideNavigation();
        try {
          const overlayState = Object.assign({}, State.preOverlayState||{}, {[State._overlayStateMarker]:true});
          history.pushState(overlayState, '', window.location.href);
          State.searchHistoryPushed = true;
        } catch (e) {}
        State.overlayTransitioning = false;
      } catch (e) { console.error('openSearchOverlay failed', e); State.overlayTransitioning = false; }
    },
    overlayEscHandler(e) {
      try {
        if (e.key === 'Escape') {
          if (State.preOverlayState) {
            const inp = DOMService.get(CONFIG.DOM.searchInputId);
            if (inp) inp.value = State.preOverlayState.q || '';
            State.selectedType = State.preOverlayState.type || 'all';
            State.selectedCategory = State.preOverlayState.category || 'all';
          }
          OverlayService.closeSearchOverlay('escape');
        }
      } catch (e) {}
    },
    closeSearchOverlay(closeSource = 'manual') {
      try {
        if (!State.overlayOpen) return;
        State.overlayTransitioning = true;
        if (closeSource !== 'popstate') URLService.syncOverlayCloseWithHistory();
        KeyboardAutoToggleService.disableAutoToggle();
        const wrapper = DOMService.query('.search-input-wrapper');
        if (wrapper) {
          DOMService.removeClass(wrapper, 'overlay-elevated');
          DOMService.setStyles(wrapper, {width:'',maxWidth:'',marginTop:'',marginBottom:'',pointerEvents:''});
          if (State.originalInputParent) {
            if (State.originalInputNextSibling) State.originalInputParent.insertBefore(wrapper, State.originalInputNextSibling);
            else State.originalInputParent.appendChild(wrapper);
          }
        }
        if (State.originalPlaceholder) { DOMService.remove(State.originalPlaceholder); State.originalPlaceholder = null; }
        State.wrapperContainer = null; State.scrollableContent = null; State.resultsContainer = null;
        DOMService.remove(DOMService.get(CONFIG.DOM.overlayContainerId));
        DOMService.remove(DOMService.get(CONFIG.DOM.overlayBackdropId));
        document.documentElement.style.overflow = ''; document.body.style.overflow = '';
        DOMService.off(document, 'keydown', Handlers.documentKeydownOverlay);
        Handlers.documentKeydownOverlay = null;
        State.overlayOpen = false; State.isReadyMode = false; State.suggestionsLocked = false;
        State.lastQuery = ''; State.overlayOpenedAt = null;
        this._showNavigation();
        State._timeouts.forEach(t => { try { clearTimeout(t); clearInterval(t); } catch (e) {} });
        State._timeouts.clear();
        setTimeout(() => { State.overlayTransitioning = false; }, CONFIG.TIMING.transitionDelayMs);
      } catch (e) { console.error('closeSearchOverlay failed', e); State.overlayTransitioning = false; }
    },
    _hideNavigation() {
      try { State.navHiddenBySearch = true; if (window.modernNav?.hideNav) window.modernNav.hideNav('search-overlay'); } catch (e) {}
    },
    _showNavigation() {
      try { if (window.modernNav?.showNav && State.navHiddenBySearch) { State.navHiddenBySearch = false; window.modernNav.showNav('search-overlay-closed'); } } catch (e) {}
    }
  };

  const SearchService = {
    doSearch(e, preventPush, options) {
      try {
        if (e) e.preventDefault?.();
        options = options || {};
        const qEl = DOMService.get(CONFIG.DOM.searchInputId);
        const q = qEl?.value || '';
        const typeFilterEl = DOMService.get(CONFIG.DOM.typeFilterId);
        State.selectedType = typeFilterEl?.value || State.selectedType;
        State.selectedCategory = 'all';
        if (!q.trim()) {
          document.body.style.marginBottom = '';
          const sr = DOMService.get(CONFIG.DOM.searchResultsId);
          if (sr) DOMService.setHTML(sr, `<div class="search-result-here" style="text-align:center;color:#969ca8;font-size:1.07em;margin-top:30px;">${LanguageService.t('search_result_here')}</div>`);
          FilterService.setupCategoryFilter([], 'all');
          UIService.updateUILanguage();
          const stateCleared = {q:'',type:'all',category:'all'};
          if (!preventPush && !State.suppressHistoryPush && !URLService.isStateEqual(stateCleared, State.lastCommittedSearchState))
            URLService.commitSearchState(stateCleared);
          if (State.overlayOpen && !options.keepOverlay) OverlayService.closeSearchOverlay('manual');
          return;
        }
        let out = {results:[],keywords:[]};
        try { if (window.SearchEngine?.search) out = window.SearchEngine.search(q, State.selectedType) || out; } catch (e) {}
        State.currentResults = out.results || [];
        State.allKeywordsCache = out.keywords || [];
        FilterService.setupCategoryFilter(RenderingService.extractResultCategories(State.currentResults), 'all');
        const stateObj = {q, type:State.selectedType||'all', category:'all'};
        if (!preventPush && !State.suppressHistoryPush && !URLService.isStateEqual(stateObj, State.lastCommittedSearchState)) {
          URLService.commitSearchState(stateObj); State.searchHistoryPushed = true;
        }
        RenderingService.renderResults(State.currentResults, State.currentResults.length === 0);
        if (State.overlayOpen && !options.keepOverlay) OverlayService.closeSearchOverlay('manual');
      } catch (e) { console.error('doSearch failed', e); }
    }
  };

  const UIService = {
    setupAutoSearchInput() {
      try {
        const input = DOMService.get(CONFIG.DOM.searchInputId);
        if (!input) return;
        DOMService.setAttr(input, 'enterkeyhint', 'search');
        Handlers.inputInput = () => {
          if (State.overlayTransitioning) return;
          clearTimeout(State.debounceTimeout);
          State.debounceTimeout = setTimeout(() => SuggestionService.renderQuerySuggestions(input.value), CONFIG.TIMING.debounceMs);
        };
        input.addEventListener('input', Handlers.inputInput);
        Handlers.inputKeydown = e => {
          if (e.key === 'Enter') { e.preventDefault(); SearchService.doSearch(); this.closeMobileKeyboard(); }
          else if (e.key === 'ArrowDown') { const c = DOMService.get(CONFIG.DOM.suggestionContainerId); if (c) c.querySelector('.suggestion-item')?.focus?.(); }
          else if (e.key === 'Backspace') {
            clearTimeout(State.debounceTimeout);
            State.debounceTimeout = setTimeout(() => SuggestionService.renderQuerySuggestions(input.value), CONFIG.TIMING.debounceMs/2);
          }
        };
        input.addEventListener('keydown', Handlers.inputKeydown);
        Handlers.inputBlur = () => {}; input.addEventListener('blur', Handlers.inputBlur);
        Handlers.inputFocus = () => { if (!State.overlayTransitioning) { this.warpToTopOfOverlay(); OverlayService.openSearchOverlay(); } };
        input.addEventListener('focus', Handlers.inputFocus);
        Handlers.inputClick = () => { if (!State.overlayTransitioning) { this.warpToTopOfOverlay(); OverlayService.openSearchOverlay(); } };
        input.addEventListener('click', Handlers.inputClick);
      } catch (e) {}
    },
    warpToTopOfOverlay() { try { const s = State.scrollableContent || DOMService.get(CONFIG.DOM.overlayContainerId); if (s) s.scrollTop = 0; } catch (e) {} },
    setupMobileSelectEnter() {
      try {
        [CONFIG.DOM.typeFilterId, CONFIG.DOM.categoryFilterId].forEach(id => {
          const el = DOMService.get(id); if (!el) return;
          const onChange = () => { if (id === CONFIG.DOM.typeFilterId) this.onTypeChange(); else this.onCategoryChange(); };
          el.onchange = onChange; el.onkeyup = e => { if (e.key === 'Enter') onChange(); };
        });
      } catch (e) {}
    },
    onTypeChange() { try { State.selectedType = DOMService.get(CONFIG.DOM.typeFilterId)?.value; SearchService.doSearch(); } catch (e) {} },
    onCategoryChange() { try { State.selectedCategory = DOMService.get(CONFIG.DOM.categoryFilterId)?.value; RenderingService.renderResults(State.currentResults, false); this.updateUILanguage(); } catch (e) {} },
    closeMobileKeyboard() { try { const input = DOMService.get(CONFIG.DOM.searchInputId); if (input && document.activeElement === input) input.blur(); } catch (e) {} },
    updateUILanguage() {
      try {
        const input = DOMService.get(CONFIG.DOM.searchInputId);
        const ph = LanguageService.t('search_placeholder');
        if (input && input.placeholder !== ph) input.placeholder = ph;
        const labels = DOMService.queryAll('.search-filters-panel .filter-group-label');
        if (labels.length > 0 && labels[0].textContent !== LanguageService.t('type')) labels[0].textContent = LanguageService.t('type');
        if (labels.length > 1 && labels[1].textContent !== LanguageService.t('category')) labels[1].textContent = LanguageService.t('category');
      } catch (e) {}
    }
  };

  // =========================================================
  // ✅ v2.2  DATA LOADER — แก้ปัญหา ES Module timing
  // =========================================================
  //
  //  ROOT CAUSE ที่ระบบดึงข้อมูลจาก db.min.json เดิม:
  //
  //  search-ui.js   = regular <script>   → รันทันทีที่ parse
  //  con-data-service.js = ES Module     → browser defer ไว้
  //
  //  ผลลัพธ์: ตอนที่ loadData() ทำงาน → window.ConDataService
  //  ยังไม่ถูก set → fallthrough ไป fetch(db.min.json) ทันที
  //
  //  วิธีแก้: _waitForConDataService() poll ทุก 30ms สูงสุด 5 วินาที
  //  จนกว่า window.ConDataService จะพร้อม แล้วค่อยเรียก getAssembled()
  // =========================================================

  function _waitForConDataService(timeoutMs) {
    return new Promise(function(resolve) {
      // พร้อมแล้ว → resolve ทันที
      if (window.ConDataService && typeof window.ConDataService.getAssembled === 'function') {
        return resolve(window.ConDataService);
      }
      const start = Date.now();
      const id = setInterval(function() {
        if (window.ConDataService && typeof window.ConDataService.getAssembled === 'function') {
          clearInterval(id);
          resolve(window.ConDataService);
        } else if (Date.now() - start >= timeoutMs) {
          clearInterval(id); // timeout → fallback
          resolve(null);
        }
      }, CONFIG.TIMING.conDataServicePollMs);
    });
  }

  function _fallbackFetch() {
    return fetch(CONFIG.DB.path).then(r => r.json()).catch(() => ({}));
  }

  function loadData() {
    return _waitForConDataService(CONFIG.TIMING.conDataServiceWaitMs).then(function(svc) {
      if (svc) {
        return svc.getAssembled().catch(function(err) {
          console.warn('[SearchUI] ConDataService.getAssembled() failed, using fallback:', err);
          return _fallbackFetch();
        });
      }
      console.warn('[SearchUI] ConDataService not available after ' + CONFIG.TIMING.conDataServiceWaitMs + 'ms — using fallback');
      return _fallbackFetch();
    });
  }

  // =========================================================
  // Initialization
  // =========================================================
  function initializeSearchEngine() {
    try {
      KeyboardService.initKeyboardDetection();

      // ✅ v2.2: ใช้ loadData() แทน fetch โดยตรง
      loadData()
        .then(function(data) {
          State.apiData = data || {};
          if (!State.apiData.type || !Array.isArray(State.apiData.type)) {
            console.warn('[SearchUI] Loaded data is missing .type[] — check ConDataService or fallback db', State.apiData);
          }
          const initFn = (window.SearchEngine && typeof window.SearchEngine.init === 'function')
            ? window.SearchEngine.init : () => Promise.resolve();
          return initFn(State.apiData, {}).catch(err => { console.error('SearchEngine.init failed', err); });
        })
        .then(function() {
          try { State.allKeywordsCache = window.SearchEngine?.generateAllKeywords?.() || []; } catch (e) { State.allKeywordsCache = []; }
          FilterService.setupTypeFilter('all');
          UIService.setupMobileSelectEnter();
          UIService.setupAutoSearchInput();
          FilterService.setupCategoryFilter([], 'all');
          document.body.style.marginBottom = '';
          const sr = DOMService.get(CONFIG.DOM.searchResultsId);
          if (sr) DOMService.setHTML(sr, `<div class="search-result-here" style="text-align:center;color:#969ca8;font-size:1.07em;margin-top:30px;">${LanguageService.t('search_result_here')}</div>`);
          UIService.updateUILanguage();
          try {
            const hs = window.history?.state;
            if (hs && typeof hs === 'object' && hs.q !== undefined) {
              State.lastCommittedSearchState = {q:hs.q||'',type:hs.type||'all',category:hs.category||'all'};
            } else {
              const arr = StorageService.getHistory();
              if (arr?.length) { const last = arr[arr.length-1]; State.lastCommittedSearchState = {q:last.q||'',type:last.type||'all',category:last.category||'all'}; }
              else State.lastCommittedSearchState = null;
            }
          } catch (e) { State.lastCommittedSearchState = null; }
          const initial = URLService.readStateFromURL();
          if (initial?.q) {
            try {
              State.suppressHistoryPush = true;
              const input = DOMService.get(CONFIG.DOM.searchInputId);
              if (input) input.value = initial.q;
              State.selectedType = initial.type || 'all';
              State.selectedCategory = initial.category || 'all';
              FilterService.setupTypeFilter(State.selectedType);
              SearchService.doSearch(null, true);
              try { history.replaceState({q:initial.q,type:State.selectedType,category:State.selectedCategory},'',URLService.buildUrlForState(initial)); } catch (e) {}
              State.lastCommittedSearchState = {q:initial.q||'',type:State.selectedType||'all',category:State.selectedCategory||'all'};
            } finally { State.suppressHistoryPush = false; }
          } else {
            try { history.replaceState({q:'',type:'all',category:'all'},'',window.location.pathname); } catch (e) {}
            State.lastCommittedSearchState = {q:'',type:'all',category:'all'};
          }
        })
        .catch(err => { console.error('[SearchUI] Failed to load data', err); State.apiData = State.apiData || {}; });

      const formEl = DOMService.get(CONFIG.DOM.searchFormId);
      if (formEl) { Handlers.formSubmit = e => { e.preventDefault(); SearchService.doSearch(); UIService.closeMobileKeyboard(); }; DOMService.on(formEl, 'submit', Handlers.formSubmit); }
      const inputEl = DOMService.get(CONFIG.DOM.searchInputId);
      if (inputEl) { const kdown = e => { if (e.key==='Enter') { e.preventDefault(); SearchService.doSearch(); UIService.closeMobileKeyboard(); } }; Handlers.inputKeydown = kdown; DOMService.on(inputEl, 'keydown', kdown); }

      Handlers.popstate = function(e) {
        try {
          const state = e.state || {};
          const isOverlayState = state[State._overlayStateMarker];
          if (isOverlayState && State.overlayOpen) { OverlayService.closeSearchOverlay('popstate'); return; }
          if (!isOverlayState && State.overlayOpen) {
            if (State.preOverlayState) {
              const inp = DOMService.get(CONFIG.DOM.searchInputId);
              if (inp) inp.value = State.preOverlayState.q || '';
              State.selectedType = State.preOverlayState.type || 'all';
              State.selectedCategory = State.preOverlayState.category || 'all';
            }
            OverlayService.closeSearchOverlay('popstate'); return;
          }
          const st = (e.state && typeof e.state === 'object' && !isOverlayState) ? e.state : URLService.readStateFromURL();
          if (st?.q !== undefined) restoreUIState(st);
        } catch (e) {}
      };
      DOMService.on(window, 'popstate', Handlers.popstate);
      State._handlersAttached = true;
    } catch (e) { console.error('initializeSearchEngine failed', e); }
  }

  function restoreUIState(st) {
    try {
      State.suppressHistoryPush = true;
      const input = DOMService.get(CONFIG.DOM.searchInputId);
      if (input) input.value = st.q || '';
      State.selectedType = st.type || 'all';
      State.selectedCategory = st.category || 'all';
      FilterService.setupTypeFilter(State.selectedType);
      SearchService.doSearch(null, true);
    } finally { State.suppressHistoryPush = false; }
  }

  function destroy() {
    try {
      OverlayService.closeSearchOverlay?.('manual');
      KeyboardAutoToggleService.disableAutoToggle();
      try {
        if (Handlers.resize) DOMService.off(window, 'resize', Handlers.resize);
        if (Handlers.popstate) DOMService.off(window, 'popstate', Handlers.popstate);
        if (Handlers.documentClick) DOMService.off(document, 'click', Handlers.documentClick);
        if (Handlers.formSubmit) DOMService.off(DOMService.get(CONFIG.DOM.searchFormId), 'submit', Handlers.formSubmit);
        if (Handlers.copyClick) DOMService.off(DOMService.get(CONFIG.DOM.searchResultsId), 'click', Handlers.copyClick);
        const input = DOMService.get(CONFIG.DOM.searchInputId);
        if (input) {
          ['inputInput','inputKeydown','inputBlur','inputFocus','inputClick'].forEach(k => { if (Handlers[k]) input.removeEventListener(k.replace('input','').toLowerCase(), Handlers[k]); });
          if (Handlers.inputInput) input.removeEventListener('input', Handlers.inputInput);
          if (Handlers.inputKeydown) input.removeEventListener('keydown', Handlers.inputKeydown);
          if (Handlers.inputBlur) input.removeEventListener('blur', Handlers.inputBlur);
          if (Handlers.inputFocus) input.removeEventListener('focus', Handlers.inputFocus);
          if (Handlers.inputClick) input.removeEventListener('click', Handlers.inputClick);
        }
        const sugg = DOMService.get(CONFIG.DOM.suggestionContainerId);
        if (sugg) {
          if (Handlers.suggestionKeydown) sugg.removeEventListener('keydown', Handlers.suggestionKeydown);
          if (Handlers.suggestionClick) sugg.removeEventListener('click', Handlers.suggestionClick);
        }
        const backdrop = DOMService.get(CONFIG.DOM.overlayBackdropId);
        if (backdrop && Handlers.overlayBackdropClick) backdrop.removeEventListener('click', Handlers.overlayBackdropClick);
        if (Handlers.documentKeydownOverlay) DOMService.off(document, 'keydown', Handlers.documentKeydownOverlay);
      } catch (e) {}
      try { if (State.renderObserver) { State.renderObserver.disconnect(); State.renderObserver = null; } } catch (e) {}
      State._timeouts.forEach(t => { try { clearTimeout(t); clearInterval(t); } catch (e) {} });
      State._timeouts.clear();
      try {
        DOMService.remove(DOMService.get(CONFIG.DOM.suggestionContainerId));
        DOMService.remove(DOMService.get(CONFIG.DOM.suggestionBackdropId));
        DOMService.remove(DOMService.get(CONFIG.DOM.overlayBackdropId));
        DOMService.remove(DOMService.get(CONFIG.DOM.overlayContainerId));
        DOMService.remove(DOMService.get(CONFIG.DOM.sentinelId));
      } catch (e) {}
      State.apiData = null; State.allKeywordsCache = []; State.currentResults = [];
      State.currentFilteredResults = []; State.lastCommittedSearchState = null;
      State._handlersAttached = false; State.keyboardAutoToggleEnabled = false;
      if (window.__searchUI) window.__searchUI._initialized = false;
    } catch (e) {}
  }

  // -------------------------
  // Public API
  // -------------------------
  window.__searchUI = window.__searchUI || {};
  Object.assign(window.__searchUI, {
    init: initializeSearchEngine, destroy,
    getConfig: () => CONFIG, getState: () => State,
    getServices: () => ({
      Language:LanguageService, DOM:DOMService, String:StringService, Storage:StorageService,
      URL:URLService, Notification:NotificationService, Rendering:RenderingService,
      Filter:FilterService, Suggestion:SuggestionService, ReadyMode:ReadyModeService,
      Highlight:HighlightService, Overlay:OverlayService, Search:SearchService,
      UI:UIService, Keyboard:KeyboardService,
      GapBasedKeyboard:GapBasedKeyboardService, KeyboardAutoToggle:KeyboardAutoToggleService
    }),
    getLastCommittedSearchState: () => State.lastCommittedSearchState,
    getSessionHistory: () => StorageService.getHistory(),
    querySuggestions: q => window.SearchEngine?.querySuggestions?.(q, CONFIG.RENDER.suggestionMax) || [],
    isKeyboardOpen: () => KeyboardService.isKeyboardOpen(),
    enableKeyboardAutoToggle: () => KeyboardAutoToggleService.enableAutoToggle(),
    disableKeyboardAutoToggle: () => KeyboardAutoToggleService.disableAutoToggle(),
    resetKeyboardGap: () => GapBasedKeyboardService.resetGap(),
    isKeyboardGapExpired: () => GapBasedKeyboardService.isGapExpired(),
    isKeyboardRecoveryTimeExpired: () => GapBasedKeyboardService.isRecoveryTimeExpired(),
    isKeyboardScrollIdle: () => GapBasedKeyboardService.isScrollIdle(),
    getKeyboardAutoToggleState: () => ({
      enabled: State.keyboardAutoToggleEnabled,
      lastToggleTime: State.lastKeyboardToggleTime,
      gapExpired: GapBasedKeyboardService.isGapExpired(),
      recoveryExpired: GapBasedKeyboardService.isRecoveryTimeExpired(),
      scrollIdle: GapBasedKeyboardService.isScrollIdle()
    })
  });

  window.__searchUI._initialized = true;
  initializeSearchEngine();
  try { window.addEventListener('beforeunload', () => { try { destroy(); } catch (e) {} }, { passive: true }); } catch (e) {}

})();