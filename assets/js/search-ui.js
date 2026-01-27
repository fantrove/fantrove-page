/*
  search-ui-enhanced.min.js (v1.0 - MERGED BEST FEATURES)
  - ✅ GAP-BASED KEYBOARD CONTROL from v21 (NOT consecutive counting)
  - ✅ IDLE DETECTION & RECOVERY from v21
  - ✅ AUTO-TOGGLE SCROLL with smart spacing
  - ✅ STABLE HISTORY SYSTEM from v12.4
  - ✅ ROBUST ERROR HANDLING & CLEANUP
  - Back button support with complete state synchronization
  - Sticky input with scrollable overlay
  - Safe IntersectionObserver usage
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
      // ✅ NEW: Gap-based keyboard timing from v21
      keyboardGapMinMs: 300,
      keyboardGapRecoveryMs: 800,
      keyboardIdleTimeMs: 500
    },
    STORAGE: {
      historyKey: 'searchHistory_v1',
      langKey: 'selectedLang'
    },
    DB: { path: '/assets/db/db.min.json' },
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
    // ✅ IMPROVED: Wrapper container reference
    wrapperContainer: null,
    // ✅ NEW: Navigation control state (from v21)
    navHiddenBySearch: false,

    // ✅ NEW: Gap-based keyboard system from v21
    keyboardAutoToggleEnabled: false,
    lastOverlayScrollY: 0,
    keyboardAutoToggleHandler: null,
    lastKeyboardToggleTime: 0,
    lastScrollTime: 0,
    isScrollingActive: false,
    scrollIdleTimer: null
  };

  const Handlers = {
    resize: null,
    inputFocus: null,
    inputBlur: null,
    inputClick: null,
    inputInput: null,
    inputKeydown: null,
    formSubmit: null,
    overlayBackdropClick: null,
    suggestionClick: null,
    suggestionKeydown: null,
    documentKeydownOverlay: null,
    popstate: null,
    documentClick: null,
    copyClick: null,
    overlayScroll: null
  };

  // -------------------------
  // Utility Services
  // -------------------------
  const LanguageService = {
    getLang: function() {
      try {
        return localStorage.getItem(CONFIG.STORAGE.langKey) ||
               (CONFIG.LANG.autoDetect && navigator.language?.startsWith('th') ? 'th' : CONFIG.LANG.default);
      } catch (e) { return CONFIG.LANG.default; }
    },
    setLang: function(lang) { try { localStorage.setItem(CONFIG.STORAGE.langKey, lang); } catch (e) {} },
    t: function(key) {
      const lang = this.getLang();
      return (CONFIG.TEXTS[lang]?.[key]) || CONFIG.TEXTS[CONFIG.LANG.default][key] || key;
    }
  };

  const DOMService = {
    get: (id) => document.getElementById(id),
    query: (sel) => document.querySelector(sel),
    queryAll: (sel) => document.querySelectorAll(sel),
    create: (tag, id, className, styles) => {
      const el = document.createElement(tag);
      if (id) el.id = id;
      if (className) el.className = className;
      if (styles) Object.assign(el.style, styles);
      return el;
    },
    remove: (el) => { try { if (el?.parentNode) el.parentNode.removeChild(el); } catch (e) {} },
    setStyles: (el, styles) => { if (!el) return; try { Object.assign(el.style, styles); } catch (e) {} },
    setText: (el, text) => { if (el) el.textContent = text; },
    setHTML: (el, html) => { if (el) el.innerHTML = html; },
    setAttr: (el, key, value) => { if (el) el.setAttribute(key, value); },
    getAttr: (el, key) => el?.getAttribute(key),
    addClass: (el, cls) => el?.classList?.add(cls),
    removeClass: (el, cls) => el?.classList?.remove(cls),
    hasClass: (el, cls) => el?.classList?.contains(cls),
    on: (el, ev, handler, opts) => { if (el && handler) el.addEventListener(ev, handler, opts); },
    off: (el, ev, handler) => { if (el && handler) el.removeEventListener(ev, handler); }
  };

  const StringService = {
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    encodeUrl: (s) => encodeURIComponent(s),
    decodeUrl: (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } }
  };

  const StorageService = {
    getHistory: function() {
      try { return JSON.parse(sessionStorage.getItem(CONFIG.STORAGE.historyKey) || '[]'); } catch (e) { return []; }
    },
    addSearchToHistory: function(state) {
      try {
        const arr = this.getHistory();
        arr.push(Object.assign({}, state, { ts: Date.now() }));
        sessionStorage.setItem(CONFIG.STORAGE.historyKey, JSON.stringify(arr));
      } catch (e) { console.error('Failed to save search history', e); }
    },
    clearHistory: function() { try { sessionStorage.removeItem(CONFIG.STORAGE.historyKey); } catch (e) {} }
  };

  // ✅ NEW: Gap-based Keyboard Service from v21
  const GapBasedKeyboardService = {
    isGapExpired: function() {
      const now = Date.now();
      const timeSinceLastToggle = now - State.lastKeyboardToggleTime;
      return timeSinceLastToggle >= CONFIG.TIMING.keyboardGapMinMs;
    },

    isRecoveryTimeExpired: function() {
      const now = Date.now();
      const timeSinceLastToggle = now - State.lastKeyboardToggleTime;
      return timeSinceLastToggle >= CONFIG.TIMING.keyboardGapRecoveryMs;
    },

    recordToggle: function() {
      State.lastKeyboardToggleTime = Date.now();
    },

    markScrollActivity: function() {
      State.lastScrollTime = Date.now();
      if (!State.isScrollingActive) {
        State.isScrollingActive = true;
      }
      if (State.scrollIdleTimer) {
        clearTimeout(State.scrollIdleTimer);
      }
      State.scrollIdleTimer = setTimeout(() => {
        State.isScrollingActive = false;
      }, CONFIG.TIMING.keyboardIdleTimeMs);
    },

    isScrollIdle: function() {
      return !State.isScrollingActive;
    },

    resetGap: function() {
      State.lastKeyboardToggleTime = 0;
    }
  };

// เพิ่มใน CONFIG หรือ State
const KEYBOARD_AUTO_OPEN_ENABLED = false; // ตั้งเป็น true ถ้าต้องการเปิดอัตโนมัติ

// ✅ IMPROVED: Enhanced Keyboard Auto Toggle with scrollable content parameter
const KeyboardAutoToggleService = {
  enableAutoToggle: function(scrollableContainer) {
    if (State.keyboardAutoToggleEnabled) return;
    
    State.keyboardAutoToggleEnabled = true;
    State.lastOverlayScrollY = 0;
    GapBasedKeyboardService.resetGap();
    
    const scrollable = scrollableContainer || DOMService.get(CONFIG.DOM.overlayContainerId);
    if (!scrollable) return;
    
    State.keyboardAutoToggleHandler = () => {
      try {
        const currentScrollY = scrollable.scrollTop || 0;
        
        GapBasedKeyboardService.markScrollActivity();
        
        // At top after scrolling away
        if (currentScrollY === 0 && State.lastOverlayScrollY > 0) {
          if (GapBasedKeyboardService.isGapExpired() || GapBasedKeyboardService.isRecoveryTimeExpired()) {
            this.openKeyboard();
            GapBasedKeyboardService.recordToggle();
          }
        }
        // Away from top after being at top
        else if (currentScrollY > 0 && State.lastOverlayScrollY === 0) {
          if (GapBasedKeyboardService.isGapExpired()) {
            this.closeKeyboard();
            GapBasedKeyboardService.recordToggle();
          }
        }
        // Recovery: at top + idle + recovery time
        else if (currentScrollY === 0 && GapBasedKeyboardService.isScrollIdle() && GapBasedKeyboardService.isRecoveryTimeExpired()) {
          const inputEl = DOMService.get(CONFIG.DOM.searchInputId);
          if (inputEl && document.activeElement !== inputEl) {
            this.openKeyboard();
            GapBasedKeyboardService.recordToggle();
          }
        }
        
        State.lastOverlayScrollY = currentScrollY;
      } catch (e) { console.error('Auto-toggle scroll handler failed', e); }
    };
    
    scrollable.addEventListener('scroll', State.keyboardAutoToggleHandler, { passive: true });
  },
  
  disableAutoToggle: function() {
    if (!State.keyboardAutoToggleEnabled) return;
    
    State.keyboardAutoToggleEnabled = false;
    
    const scrollable = State.scrollableContent || DOMService.get(CONFIG.DOM.overlayContainerId);
    if (scrollable && State.keyboardAutoToggleHandler) {
      scrollable.removeEventListener('scroll', State.keyboardAutoToggleHandler);
    }
    
    if (State.scrollIdleTimer) {
      clearTimeout(State.scrollIdleTimer);
    }
    
    State.keyboardAutoToggleHandler = null;
  },

openKeyboard: function() {
  if (!KEYBOARD_AUTO_OPEN_ENABLED) return; // ⬅️ ข้ามการเปิดหากปิดอยู่
  
  const inputEl = DOMService.get(CONFIG.DOM.searchInputId);
  if (inputEl && document.activeElement !== inputEl) {
    inputEl.focus();
  }
},
  
  closeKeyboard: function() {
    const inputEl = DOMService.get(CONFIG.DOM.searchInputId);
    if (inputEl && document.activeElement === inputEl) {
      inputEl.blur();
    }
  }
};

  // -------------------------
  // Keyboard Detection
  // -------------------------
  const KeyboardService = {
    initKeyboardDetection: function() {
      try {
        State.lastWindowInnerHeight = window.innerHeight || 0;
        Handlers.resize = () => {
          clearTimeout(State.keyboardDetectionTimeout);
          State.keyboardDetectionTimeout = setTimeout(() => {
            try { this.updateKeyboardStatus(); } catch (e) {}
          }, CONFIG.TIMING.keyboardDetectionDelayMs);
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
      } catch (e) { console.error('Keyboard detection init failed', e); }
    },

    updateKeyboardStatus: function() {
      try {
        const currentHeight = window.innerHeight || 0;
        const heightDiff = State.lastWindowInnerHeight - currentHeight;
        if (heightDiff > 100) State.keyboardOpen = true;
        else if (heightDiff < -100) State.keyboardOpen = false;
        State.lastWindowInnerHeight = currentHeight;
      } catch (e) {}
    },

    isKeyboardOpen: function() { return !!State.keyboardOpen; }
  };

  // -------------------------
  // URL Service & History
  // -------------------------
  const URLService = {
    parseQueryString: function(qs) {
      const out = {};
      if (!qs) return out;
      qs = qs.replace(/^\?/, '');
      const parts = qs.split('&');
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]; if (!p) continue;
        const idx = p.indexOf('='); if (idx === -1) out[decodeURIComponent(p)] = '';
        else out[decodeURIComponent(p.substring(0, idx))] = decodeURIComponent(p.substring(idx + 1));
      }
      return out;
    },
    buildQueryString: function(obj) {
      const parts = [];
      for (const k in obj) {
        if (obj[k] === undefined || obj[k] === null) continue;
        parts.push(StringService.encodeUrl(k) + '=' + StringService.encodeUrl(obj[k]));
      }
      return parts.length ? ('?' + parts.join('&')) : '';
    },
    readStateFromURL: function() {
      try {
        const params = this.parseQueryString(window.location.search || '');
        return { q: params.q || '', type: params.type || 'all', category: params.category || 'all' };
      } catch (e) { return { q: '', type: 'all', category: 'all' }; }
    },
    buildUrlForState: function(state) {
      const params = {};
      if (state.q) params.q = state.q;
      if (state.type && state.type !== 'all') params.type = state.type;
      if (state.category && state.category !== 'all') params.category = state.category;
      return this.buildQueryString(params);
    },
    isStateEqual: function(a, b) {
      if (!a && !b) return true;
      if (!a || !b) return false;
      const aq = (a.q || '').trim();
      const bq = (b.q || '').trim();
      const at = (a.type || 'all'); const bt = (b.type || 'all');
      const ac = (a.category || 'all'); const bc = (b.category || 'all');
      return aq === bq && at === bt && ac === bc;
    },
    commitSearchState: function(state) {
      try {
        if (URLService.isStateEqual(state, State.lastCommittedSearchState)) return;
        const url = this.buildUrlForState(state);
        try {
          if (State.searchHistoryPushed) {
            history.replaceState(state, '', url);
            State.searchHistoryPushed = false;
          } else {
            history.pushState(state, '', url);
          }
        } catch (e) {
          try { history.replaceState(state, '', url); } catch (ee) {}
          State.searchHistoryPushed = false;
        }
        StorageService.addSearchToHistory(state);
        State.lastCommittedSearchState = { q: state.q || '', type: state.type || 'all', category: state.category || 'all' };
      } catch (e) { console.error('commitSearchState failed', e); }
    },
    syncOverlayCloseWithHistory: function() {
      if (State.searchHistoryPushed) {
        try {
          const stateToRestore = State.lastCommittedSearchState || { q: '', type: 'all', category: 'all' };
          history.replaceState(stateToRestore, '', this.buildUrlForState(stateToRestore));
        } catch (e) {}
        State.searchHistoryPushed = false;
      }
    }
  };

  // -------------------------
  // Notification & Clipboard
  // -------------------------
  const NotificationService = {
    showCopyToast: function(msg) {
      try {
        const toast = DOMService.create('div', null, 'copy-toast-message');
        DOMService.setText(toast, msg);
        const area = DOMService.get(CONFIG.DOM.copyToastId) || document.body;
        area.appendChild(toast);
        const t = setTimeout(() => {
          try {
            DOMService.setStyles(toast, { opacity: '0', transform: 'translateY(-10px)' });
            setTimeout(() => DOMService.remove(toast), CONFIG.TIMING.toastFadeMs);
          } catch (e) {}
        }, CONFIG.TIMING.toastDisplayMs);
        State._timeouts.add(t);
      } catch (e) { console.error('showCopyToast failed', e); }
    },
    async copyText(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          this.showCopyToast(LanguageService.t('copy') + ' แล้ว');
          return;
        }
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) this.showCopyToast(LanguageService.t('copy') + ' แล้ว');
        else this.showCopyToast(LanguageService.t('copy_failed'));
      } catch (e) {
        this.showCopyToast(LanguageService.t('copy_failed'));
      }
    }
  };

  // -------------------------
  // Highlight Service
  // -------------------------
  const HighlightService = {
    highlightAllMatches: function(text, query) {
      if (!text || !query) return StringService.escapeHtml(text || '');
      try {
        const textStr = String(text).toLowerCase();
        const queryStr = String(query).toLowerCase();
        const queryChars = new Set(queryStr.split(''));
        let result = '';
        for (let i = 0; i < textStr.length; i++) {
          const char = textStr[i];
          if (queryChars.has(char)) {
            result += '<strong style="background-color:#fff3cd;font-weight:700">' + StringService.escapeHtml(String(text)[i]) + '</strong>';
          } else {
            result += StringService.escapeHtml(String(text)[i]);
          }
        }
        return result;
      } catch (e) { return StringService.escapeHtml(text); }
    }
  };

  // -------------------------
  // Rendering Service
  // -------------------------
  const RenderingService = {
    renderResultItem: function(item, lang) {
      try {
        const itemData = item.item || item;
        const itemText = itemData?.text || itemData?.name?.[lang] || itemData?.name?.['en'] || item.itemName || '';
        const itemApi = itemData?.api || '';
        const typeName = item.typeName || item.typeObj?.name?.[lang] || item.typeObj?.name?.['en'] || LanguageService.t('emoji');
        const catName = item.catName || item.category?.name?.[lang] || item.category?.name?.['en'] || '';
        let itemNames = [];
        if (item.itemName) itemNames.push(item.itemName);
        if (itemData?.name) {
          const nameLang = itemData.name[lang] || itemData.name['en'];
          if (nameLang && !itemNames.includes(nameLang)) itemNames.push(nameLang);
        }
        for (const k in (itemData || {})) {
          if (/_name$/.test(k) && itemData[k]) {
            const nameLang = itemData[k][lang] || itemData[k]['en'];
            if (nameLang && !itemNames.includes(nameLang)) itemNames.push(nameLang);
          }
        }
        const itemNamesStr = itemNames.filter(Boolean).join(' / ');
        const text = itemText || itemApi || '-';
        const copyTextVal = StringService.encodeUrl(text);

        // New card markup: combine .result-item (for compatibility) and .search-card (compact look)
        return `<div class="result-item search-card" role="article" aria-label="${StringService.escapeHtml(itemNamesStr || text)}">
          <div class="card-content" aria-hidden="true">${StringService.escapeHtml(String(text).slice(0, 300))}</div>
          <div class="card-body">
            <div class="card-title">${StringService.escapeHtml(itemNamesStr || (itemData && (itemData.name ? (itemData.name[lang]||itemData.name['en']) : itemData.api) ) || text)}</div>
            <div class="card-subtitle">${StringService.escapeHtml(itemApi || typeName || '')}</div>
            <div class="card-tags" aria-hidden="true">
              ${typeName ? `<span class="tag">${StringService.escapeHtml(typeName)}</span>` : ''}
              ${catName ? `<span class="tag">${StringService.escapeHtml(catName)}</span>` : ''}
            </div>
          </div>
          <button class="result-copy-btn" data-text="${copyTextVal}" aria-label="${LanguageService.t('copy')}">${LanguageService.t('copy')}</button>
        </div>`;
      } catch (e) { return `<div class="result-item"><div class="result-content-area">-</div></div>`; }
    },

    // New: decide whether a card should be vertical or horizontal based on rendered content
    adjustCardLayout: function(cardEl) {
      try {
        if (!cardEl) return;
        // already checked?
        if (cardEl.getAttribute('data-layout-checked')) return;
        const content = cardEl.querySelector('.card-content');
        const body = cardEl.querySelector('.card-body');
        if (!content || !body) { cardEl.setAttribute('data-layout-checked', '1'); return; }

        // measure rendered sizes
        const clientH = content.clientHeight || parseInt(window.getComputedStyle(content).height) || 56;
        const scrollH = content.scrollHeight || 0;
        const txt = (content.textContent || '').trim();
        const newline = txt.indexOf('\n') !== -1;
        const longTextThreshold = 40; // char threshold (can tune)
        const manyWords = txt.split(/\s+/).filter(Boolean).length > 6;

        // conditions to prefer vertical layout:
        // 1) content overflows rendered box
        // 2) contains newline(s)
        // 3) long text with spaces (likely phrase/sentence)
        // 4) many words
        if (scrollH > clientH + 4 || newline || (txt.length > longTextThreshold && txt.indexOf(' ') !== -1) || manyWords) {
          DOMService.addClass(cardEl, 'vertical');
        } else {
          DOMService.removeClass(cardEl, 'vertical');
        }

        cardEl.setAttribute('data-layout-checked', '1');
      } catch (e) { try { cardEl.setAttribute('data-layout-checked', '1'); } catch (ee) {} }
    },

    applySmartCardLayoutToNewCards: function() {
      try {
        const container = DOMService.get(CONFIG.DOM.searchResultsId);
        if (!container) return;
        const cards = container.querySelectorAll('.search-card:not([data-layout-checked])');
        if (!cards || !cards.length) return;
        cards.forEach(c => {
          try { this.adjustCardLayout(c); } catch (e) {}
        });
      } catch (e) {}
    },

    disconnectRenderObserver: function() {
      try {
        if (State.renderObserver) { State.renderObserver.disconnect(); State.renderObserver = null; }
      } catch (e) {}
      const old = DOMService.get(CONFIG.DOM.sentinelId);
      DOMService.remove(old);
    },

    renderNextBatch: function() {
      try {
        const container = DOMService.get(CONFIG.DOM.searchResultsId);
        if (!container) return;
        const lang = LanguageService.getLang();
        const start = State.currentRenderIndex;
        const end = Math.min(State.currentRenderIndex + CONFIG.RENDER.batchSize, State.currentFilteredResults.length);
        let fragment = '';
        for (let i = start; i < end; i++) {
          fragment += this.renderResultItem(State.currentFilteredResults[i], lang);
        }
        const sentinelEl = DOMService.get(CONFIG.DOM.sentinelId);
        if (sentinelEl) sentinelEl.insertAdjacentHTML('beforebegin', fragment);
        else container.insertAdjacentHTML('beforeend', fragment);
        State.currentRenderIndex = end;

        // After inserting, run smart layout adjust for newly added cards
        // small timeout to let browser compute layout/scrollHeight correctly
        setTimeout(() => {
          try { this.applySmartCardLayoutToNewCards(); } catch (e) {}
        }, 20);

        if (State.currentRenderIndex >= State.currentFilteredResults.length) this.disconnectRenderObserver();
        else {
          if (!DOMService.get(CONFIG.DOM.sentinelId)) {
            const s = DOMService.create('div', CONFIG.DOM.sentinelId, 'search-sentinel', {
              width: '100%', height: CONFIG.RENDER.sentinelHeight, display: 'block'
            });
            container.appendChild(s);
          }
          if (!State.renderObserver) {
            if ('IntersectionObserver' in window) {
              try {
                State.renderObserver = new IntersectionObserver((entries) => {
                  try {
                    for (let i = 0; i < entries.length; i++) {
                      if (entries[i].isIntersecting) {
                        setTimeout(() => {
                          if (State.currentRenderIndex < State.currentFilteredResults.length) this.renderNextBatch();
                        }, 50);
                      }
                    }
                  } catch (e) { console.error('renderObserver callback failed', e); }
                }, {
                  root: null,
                  rootMargin: CONFIG.RENDER.intersectionRootMargin,
                  threshold: CONFIG.RENDER.intersectionThreshold
                });
                const sEl = DOMService.get(CONFIG.DOM.sentinelId);
                if (sEl) State.renderObserver.observe(sEl);
              } catch (e) { console.error('Failed to create IntersectionObserver', e); }
            }
          }
        }
      } catch (e) { console.error('renderNextBatch failed', e); }
    },

    extractResultCategories: function(results) {
      try {
        const lang = LanguageService.getLang();
        let categories = [], seen = Object.create(null);
        for (let i = 0; i < results.length; i++) {
          const cat = results[i].category || { name: '' };
          const key = (cat.name?.[lang] || cat.name?.['en']) || '';
          const displayName = key;
          if (!seen[key]) { seen[key] = 1; categories.push({ key, displayName }); }
        }
        return categories;
      } catch (e) { return []; }
    },

    renderResults: function(results, showSuggestionsIfNoResult = false) {
      try {
        const container = DOMService.get(CONFIG.DOM.searchResultsId);
        const lang = LanguageService.getLang();
        if (!container) return;

        let filtered = (State.selectedCategory !== 'all')
          ? results.filter(res => ((res.category?.name?.[lang] || res.category?.name?.['en']) || '') === State.selectedCategory)
          : results;

        document.body.style.marginBottom = '60px';
        this.disconnectRenderObserver();
        State.currentFilteredResults = [];
        State.currentRenderIndex = 0;

        if (!filtered.length) {
          let html = `<div class="no-result">${LanguageService.t('not_found')}</div>`;
          if (showSuggestionsIfNoResult) {
            html += `<div class="suggestions-title-main">${LanguageService.t('suggestions_for_you')}</div>`;
            const sample = (State.apiData?.type?.[0]?.category?.[0]?.data) ? State.apiData.type[0].category[0].data.slice(0, 5) : [];
            html += `<div class="suggestions-block-list">`;
            for (let i = 0; i < sample.length; i++) {
              const item = sample[i];
              const recommendationObj = {
                item: item,
                typeObj: State.apiData?.type?.[0],
                category: State.apiData?.type?.[0]?.category?.[0],
                itemName: item.name?.[lang] || item.name?.['en'] || '',
                typeName: State.apiData?.type?.[0]?.name?.[lang] || State.apiData?.type?.[0]?.name?.['en'] || '',
                catName: State.apiData?.type?.[0]?.category?.[0]?.name?.[lang] || State.apiData?.type?.[0]?.category?.[0]?.name?.['en'] || ''
              };
              html += this.renderResultItem(recommendationObj, lang);
            }
            html += `</div>`;
          }
          DOMService.setHTML(container, html);
          const catFilterEl = DOMService.get(CONFIG.DOM.categoryFilterId);
          if (catFilterEl) catFilterEl.style.display = '';
          UIService.updateUILanguage();

          // ensure layout adjust runs for suggestion samples
          setTimeout(() => { try { this.applySmartCardLayoutToNewCards(); } catch (e) {} }, 20);

          return;
        }

        State.currentFilteredResults = filtered;
        State.currentRenderIndex = 0;
        DOMService.setHTML(container, '');
        this.renderNextBatch();

        if (!window._copyResultTextHandlerSet) {
          Handlers.copyClick = (e) => {
            const btn = e.target.closest('.result-copy-btn');
            if (btn?.hasAttribute('data-text')) {
              e.preventDefault();
              NotificationService.copyText(StringService.decodeUrl(btn.getAttribute('data-text')));
            }
          };
          DOMService.on(container, 'click', Handlers.copyClick);
          window._copyResultTextHandlerSet = true;
        }

        UIService.updateUILanguage();
      } catch (e) { console.error('renderResults failed', e); }
    }
  };

  // -------------------------
  // Filter Service
  // -------------------------
  const FilterService = {
    setupTypeFilter: function(selected = 'all') {
      try {
        const typeFilter = DOMService.get(CONFIG.DOM.typeFilterId);
        if (!typeFilter) return;
        let buf = [`<option value="all">${LanguageService.t('all_types')}</option>`];
        if (State.apiData?.type && Array.isArray(State.apiData.type)) {
          const lang = LanguageService.getLang();
          for (let i = 0; i < State.apiData.type.length; i++) {
            const label = State.apiData.type[i].name?.[lang] || State.apiData.type[i].name?.['en'] || '';
            buf.push(`<option value="${StringService.escapeHtml(label)}">${StringService.escapeHtml(label)}</option>`);
          }
        }
        DOMService.setHTML(typeFilter, buf.join(''));
        typeFilter.value = selected;
      } catch (e) { console.error('setupTypeFilter failed', e); }
    },

    setupCategoryFilter: function(categories, selected = 'all') {
      try {
        const catFilter = DOMService.get(CONFIG.DOM.categoryFilterId);
        if (!catFilter) return;
        let buf = [`<option value="all">${LanguageService.t('all_categories')}</option>`];
        for (let i = 0; i < categories.length; i++) {
          const { key, displayName } = categories[i];
          buf.push(`<option value="${StringService.escapeHtml(key)}">${StringService.escapeHtml(displayName)}</option>`);
        }
        DOMService.setHTML(catFilter, buf.join(''));
        catFilter.style.display = '';
        catFilter.value = selected;
      } catch (e) { console.error('setupCategoryFilter failed', e); }
    }
  };

  // -------------------------
  // Ready Mode & Suggestion Service
  // -------------------------
  const ReadyModeService = {
    extractSmartNames: function() {
      try {
        if (!State.apiData || !State.allKeywordsCache) return [];
        const lang = LanguageService.getLang();
        const suggestions = [];
        const seen = new Set();
        for (let i = 0; i < State.allKeywordsCache.length && suggestions.length < CONFIG.RENDER.suggestionsFullscreenMax; i++) {
          const kw = State.allKeywordsCache[i];
          if (!kw || !kw.item) continue;
          let name = '';
          if (kw.item.name && typeof kw.item.name === 'object') {
            name = kw.item.name[lang] || kw.item.name['en'] || '';
          }
          if (!name || name.length < 2) continue;
          if (name.includes('/') || name.includes('.') || name.includes(':') || /^[A-Za-z0-9_]+$/.test(name)) {
            if (!/[\u0E00-\u0E7F]/.test(name) && /^[A-Za-z0-9_\-]+$/.test(name) && name.length <= 20) {
              continue;
            }
          }
          if (seen.has(name)) continue;
          seen.add(name);
          suggestions.push({
            raw: name,
            display: name,
            highlightedHtml: StringService.escapeHtml(name),
            source: 'trending'
          });
        }
        return suggestions;
      } catch (e) { return []; }
    },

    renderReadyModeSuggestions: function() {
      try {
        if (!State.isReadyMode || !State.overlayOpen) return;
        const container = SuggestionService.ensureSuggestionContainer();
        if (!container) return;
        const suggestions = this.extractSmartNames();
        if (!suggestions?.length) {
          DOMService.setHTML(container, '');
          container.style.display = 'none';
          return;
        }
        let html = `<div class="suggestions-head" >${LanguageService.t('trending')}</div>`;
        for (let i = 0; i < suggestions.length; i++) {
          const s = suggestions[i];
          html += `<div class="suggestion-item" role="option" tabindex="0" data-val="${StringService.encodeUrl(s.raw)}">
                    <div class="suggestion-body" style="flex:1;word-break:break-word">${s.highlightedHtml || StringService.escapeHtml(s.raw)}</div>
                  </div>`;
        }
        DOMService.setHTML(container, html);
        container.style.display = 'block';
        SuggestionService.createSuggestionBackdrop();
        State.readyModeSuggestions = suggestions;
      } catch (e) { console.error('renderReadyModeSuggestions failed', e); }
    }
  };

// ✅ IMPROVED: Enhanced Suggestion Service for overlay
const SuggestionService = {
  ensureSuggestionContainer: function() {
    // Container is now created in OverlayService.openSearchOverlay
    return DOMService.get(CONFIG.DOM.suggestionContainerId);
  },
  
  createSuggestionBackdrop: function() {
    try {
      const overlay = DOMService.get(CONFIG.DOM.overlayContainerId);
      if (!overlay) return null;
      let bd = DOMService.get(CONFIG.DOM.suggestionBackdropId);
      if (bd) return bd;
      bd = DOMService.create('div', CONFIG.DOM.suggestionBackdropId, null, {
        position: 'absolute',
        left: '0',
        top: '0',
        right: '0',
        bottom: '0',
        zIndex: '9997',
        background: 'transparent',
        pointerEvents: 'none'
      });
      overlay.insertBefore(bd, overlay.firstChild);
      return bd;
    } catch (e) { return null; }
  },
  
  removeSuggestionBackdrop: function() {
    DOMService.remove(DOMService.get(CONFIG.DOM.suggestionBackdropId));
  },
  
  handleSuggestionKeydown: function(ev, container) {
    try {
      const items = Array.from(container.querySelectorAll('.suggestion-item'));
      if (!items.length) return;
      const active = document.activeElement;
      const idx = items.indexOf(active);
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        const next = (idx === -1) ? items[0] : items[Math.min(items.length - 1, idx + 1)];
        next?.focus?.();
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        const prev = (idx === -1) ? items[items.length - 1] : items[Math.max(0, idx - 1)];
        prev?.focus?.();
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        if (active?.classList?.contains('suggestion-item')) active?.click?.();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        try { OverlayService.closeSearchOverlay('escape'); } catch (e) {}
      }
    } catch (e) { console.error('handleSuggestionKeydown failed', e); }
  },
  
  handleSuggestionClick: function(ev) {
    try {
      const it = ev.target.closest('.suggestion-item');
      if (!it) return;
      ev.stopPropagation?.();
      ev.preventDefault?.();
      let val = it.getAttribute('data-val') || '';
      val = StringService.decodeUrl(val);
      const inputEl = DOMService.get(CONFIG.DOM.searchInputId);
      if (inputEl) inputEl.value = val;
      State.suggestionsLocked = false;
      SearchService.doSearch(null, false);
    } catch (e) { console.error('handleSuggestionClick failed', e); }
  },
  
  renderQuerySuggestions: function(query) {
    try {
      if (State.overlayTransitioning) return;
      const container = this.ensureSuggestionContainer();
      if (!container) return;
      if (!query?.trim()) {
        State.isReadyMode = true;
        State.lastQuery = '';
        ReadyModeService.renderReadyModeSuggestions();
        return;
      }
      State.lastQuery = query;
      State.isReadyMode = false;
      
      const suggestions = (window.SearchEngine && typeof window.SearchEngine.querySuggestions === 'function') ?
        window.SearchEngine.querySuggestions(query, CONFIG.RENDER.suggestionsFullscreenMax) :
        [];
      
      if (!suggestions?.length) {
        State.isReadyMode = true;
        ReadyModeService.renderReadyModeSuggestions();
        return;
      }
      
      let html = `<div class="suggestions-head" >${LanguageService.t('suggestion_label')}</div>`;
      for (let i = 0; i < suggestions.length; i++) {
        const s = suggestions[i];
        const highlighted = HighlightService.highlightAllMatches(s.raw, query);
        html += `<div class="suggestion-item" role="option" tabindex="0" data-val="${StringService.encodeUrl(s.raw)}">
                  <div class="suggestion-body">${highlighted}</div>
                </div>`;
      }
      DOMService.setHTML(container, html);
      container.style.display = 'block';
      this.createSuggestionBackdrop();
      
      const inputEl = DOMService.get(CONFIG.DOM.searchInputId);
      if (inputEl) {
        inputEl.onkeydown = (e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            const first = container.querySelector('.suggestion-item');
            first?.focus?.();
          } else if (e.key === 'Escape') {
            try { OverlayService.closeSearchOverlay('escape'); } catch (err) {}
          }
        };
      }
    } catch (e) { console.error('renderQuerySuggestions failed', e); }
  }
};

  // -------------------------
  // Overlay Service
  // -------------------------
// ✅ ENHANCED: OverlayService with improved input locking
const OverlayService = {
  createOverlayBackdrop: function() {
    try {
      let backdrop = DOMService.get(CONFIG.DOM.overlayBackdropId);
      if (backdrop) return backdrop;
      
      backdrop = DOMService.create('div', CONFIG.DOM.overlayBackdropId, 'search-overlay-backdrop', {
        position: 'fixed',
        left: '0',
        top: '0',
        width: '100%',
        height: '100%',
        background: 'rgba(12,14,18,0.48)',
        zIndex: '9997',
        backdropFilter: 'blur(4px)',
        pointerEvents: 'auto',
        cursor: 'default'
      });

      Handlers.overlayBackdropClick = (e) => {
        try {
          if (e.target === backdrop) {
            e.preventDefault?.();
            e.stopPropagation?.();
            if (KeyboardService.isKeyboardOpen()) { return; }
            const inputEl = DOMService.get(CONFIG.DOM.searchInputId);
            const currentValue = (inputEl?.value || '').trim();
            const lastQ = (State.preOverlayState?.q || '').trim();
            if (currentValue !== lastQ && currentValue.length > 0) {
              SearchService.doSearch(null, false, { keepOverlay: false });
            } else {
              OverlayService.closeSearchOverlay('backdrop');
            }
          }
        } catch (err) { console.error('overlay backdrop click handler failed', err); }
      };

      DOMService.on(backdrop, 'click', Handlers.overlayBackdropClick);
      document.body.appendChild(backdrop);
      return backdrop;
    } catch (e) { console.error('createOverlayBackdrop failed', e); return null; }
  },

  openSearchOverlay: function() {
    try {
      if (State.overlayOpen || State.overlayTransitioning) return;
      const wrapper = DOMService.query('.search-input-wrapper');
      if (!wrapper) return;

      State.overlayTransitioning = true;
      State.originalInputParent = wrapper.parentNode;
      State.originalInputNextSibling = wrapper.nextSibling;

      // ✅ IMPROVED: Create placeholder with exact dimensions
      const placeholder = DOMService.create('div', CONFIG.DOM.placeholderId, null, {
        width: wrapper.offsetWidth + 'px',
        height: wrapper.offsetHeight + 'px',
        visibility: 'hidden',
        display: 'block'
      });
      State.originalPlaceholder = placeholder;
      State.originalInputParent.insertBefore(placeholder, State.originalInputNextSibling);

      const inputEl = DOMService.get(CONFIG.DOM.searchInputId);
      State.preOverlayState = {
        q: inputEl?.value || '',
        type: State.selectedType || 'all',
        category: State.selectedCategory || 'all'
      };

      State.overlayOpenedAt = Date.now();
      this.createOverlayBackdrop();

      // ✅ IMPROVED: Overlay container with scrollable content
      let overlay = DOMService.get(CONFIG.DOM.overlayContainerId);
      if (!overlay) {
        overlay = DOMService.create('div', CONFIG.DOM.overlayContainerId, 'search-overlay search-overlay-open', {
          position: 'fixed',
          left: '0',
          top: '0',
          width: '100%',
          height: '100%',
          zIndex: '9998',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          justifyContent: 'flex-start',
          padding: '0',
          overflow: 'hidden',
          pointerEvents: 'auto',
          backgroundColor: '#ffffff'
        });
        document.body.appendChild(overlay);
      } else {
        DOMService.setHTML(overlay, '');
      }

      // ✅ IMPROVED: Input wrapper container - FIXED at top
      const wrapperContainer = DOMService.create('div', null, 'search-overlay-input-wrapper', {
        position: 'relative',
        top: '0',
        left: '0',
        right: '0',
        width: '100%',
        zIndex: '10001',
        background: '#ffffff',
        pointerEvents: 'auto',
        paddingTop: '2px',
        paddingBottom: '5px',
        paddingLeft: '10px',
        paddingRight: '10px',
        borderBottom: '1px solid #f0f0f0',
        flexShrink: 0, // ✅ CRITICAL: Prevent shrinking
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
      });

      // ✅ IMPROVED: Apply overlay styles to input wrapper
      DOMService.addClass(wrapper, 'overlay-elevated');
      DOMService.setStyles(wrapper, {
        width: '100%',
        maxWidth: '100%',
        marginTop: '0',
        marginBottom: '0',
        pointerEvents: 'auto'
      });

      wrapperContainer.appendChild(wrapper);
      overlay.appendChild(wrapperContainer);
      State.wrapperContainer = wrapperContainer;

      // ✅ NEW: Scrollable content container
      const scrollableContent = DOMService.create('div', null, 'search-overlay-scrollable-content', {
        flex: '1',
        width: '100%',
        overflow: 'auto',
        overscrollBehavior: 'contain',
        zIndex: '10000',
        pointerEvents: 'auto'
      });

      // ✅ IMPROVED: Results container inside scrollable area
      const resultsWrapper = DOMService.create('div', null, 'search-overlay-results-wrapper', {
        width: '100%',
        padding: '0 0px 16px 0px',
        boxSizing: 'border-box'
      });

      const resultsContainer = DOMService.create('div', CONFIG.DOM.searchResultsId, 'search-overlay-results', {
        width: '100%'
      });

      const suggestionsContainer = DOMService.create('div', CONFIG.DOM.suggestionContainerId, 'search-suggestions-fullscreen');

      resultsWrapper.appendChild(suggestionsContainer);
      resultsWrapper.appendChild(resultsContainer);
      scrollableContent.appendChild(resultsWrapper);
      overlay.appendChild(scrollableContent);

      State.scrollableContent = scrollableContent;
      State.resultsContainer = resultsContainer;

      // ✅ IMPROVED: Set up suggestion handlers
      Handlers.suggestionKeydown = (ev) => SuggestionService.handleSuggestionKeydown(ev, suggestionsContainer);
      Handlers.suggestionClick = (ev) => SuggestionService.handleSuggestionClick(ev);
      DOMService.on(suggestionsContainer, 'keydown', Handlers.suggestionKeydown);
      DOMService.on(suggestionsContainer, 'click', Handlers.suggestionClick, { capture: false });
      DOMService.on(suggestionsContainer, 'mouseenter', () => { State.suggestionsLocked = true; });
      DOMService.on(suggestionsContainer, 'mouseleave', () => { State.suggestionsLocked = false; });

      if (inputEl) {
        setTimeout(() => {
          try {
            inputEl.focus();
            inputEl.select?.();
          } catch (e) {}
        }, CONFIG.TIMING.focusDelayMs);
      }

      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';

      Handlers.documentKeydownOverlay = OverlayService.overlayEscHandler;
      DOMService.on(document, 'keydown', Handlers.documentKeydownOverlay);

      State.overlayOpen = true;
      State.isReadyMode = true;
      State.lastQuery = '';
      ReadyModeService.renderReadyModeSuggestions();

      // ✅ IMPROVED: Enable gap-based keyboard auto-toggle
      KeyboardAutoToggleService.enableAutoToggle(scrollableContent);

      // ✅ IMPROVED: Hide navigation bar
      OverlayService._hideNavigation();

      // Push state to history
      try {
        const overlayState = Object.assign({}, State.preOverlayState || {}, { [State._overlayStateMarker]: true });
        history.pushState(overlayState, '', window.location.href);
        State.searchHistoryPushed = true;
      } catch (e) { console.error('Failed to push overlay state to history', e); }

      State.overlayTransitioning = false;
    } catch (e) { console.error('openSearchOverlay failed', e); State.overlayTransitioning = false; }
  },

  overlayEscHandler: function(e) {
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
    } catch (e) { console.error('overlayEscHandler failed', e); }
  },

  closeSearchOverlay: function(closeSource = 'manual') {
    try {
      if (!State.overlayOpen) return;
      State.overlayTransitioning = true;

      if (closeSource === 'popstate') {
        // Popstate already handled
      } else {
        URLService.syncOverlayCloseWithHistory();
      }

      // ✅ IMPROVED: Disable gap-based keyboard auto-toggle
      KeyboardAutoToggleService.disableAutoToggle();

      // ✅ IMPROVED: Restore wrapper to original position
      const wrapper = DOMService.query('.search-input-wrapper');
      if (wrapper) {
        DOMService.removeClass(wrapper, 'overlay-elevated');
        DOMService.setStyles(wrapper, {
          width: '',
          maxWidth: '',
          marginTop: '',
          marginBottom: '',
          pointerEvents: ''
        });
        if (State.originalInputParent) {
          if (State.originalInputNextSibling) {
            State.originalInputParent.insertBefore(wrapper, State.originalInputNextSibling);
          } else {
            State.originalInputParent.appendChild(wrapper);
          }
        }
      }

      if (State.originalPlaceholder) {
        DOMService.remove(State.originalPlaceholder);
        State.originalPlaceholder = null;
      }

      State.wrapperContainer = null;
      State.scrollableContent = null;
      State.resultsContainer = null;

      const overlay = DOMService.get(CONFIG.DOM.overlayContainerId);
      DOMService.remove(overlay);

      const backdrop = DOMService.get(CONFIG.DOM.overlayBackdropId);
      DOMService.remove(backdrop);

      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';

      DOMService.off(document, 'keydown', Handlers.documentKeydownOverlay);
      Handlers.documentKeydownOverlay = null;

      State.overlayOpen = false;
      State.isReadyMode = false;
      State.suggestionsLocked = false;
      State.lastQuery = '';
      State.overlayOpenedAt = null;

      // ✅ IMPROVED: Show navigation bar
      OverlayService._showNavigation();

      State._timeouts.forEach(t => {
        try { clearTimeout(t); clearInterval(t); } catch (e) {}
      });
      State._timeouts.clear();

      setTimeout(() => { State.overlayTransitioning = false; }, CONFIG.TIMING.transitionDelayMs);
    } catch (e) { console.error('closeSearchOverlay failed', e); State.overlayTransitioning = false; }
  },

  // ✅ NEW: Navigation bar control
  _hideNavigation: function() {
    try {
      State.navHiddenBySearch = true;
      if (typeof window.modernNav !== 'undefined' && window.modernNav.hideNav) {
        window.modernNav.hideNav('search-overlay');
      }
    } catch (e) { console.error('Failed to hide navigation', e); }
  },

  // ✅ NEW: Show navigation bar
  _showNavigation: function() {
    try {
      if (typeof window.modernNav !== 'undefined' && window.modernNav.showNav && State.navHiddenBySearch) {
        State.navHiddenBySearch = false;
        window.modernNav.showNav('search-overlay-closed');
      }
    } catch (e) { console.error('Failed to show navigation', e); }
  }
};

  // -------------------------
  // Search Service
  // -------------------------
  const SearchService = {
    doSearch: function(e, preventPush, options) {
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
          const placeholderHtml = `<div class="search-result-here" style="text-align:center;color:#969ca8;font-size:1.07em;margin-top:30px;">${LanguageService.t('search_result_here')}</div>`;
          const sr = DOMService.get(CONFIG.DOM.searchResultsId);
          if (sr) DOMService.setHTML(sr, placeholderHtml);
          FilterService.setupCategoryFilter([], 'all');
          UIService.updateUILanguage();
          const stateCleared = { q: '', type: 'all', category: 'all' };
          if (!preventPush && !State.suppressHistoryPush && !URLService.isStateEqual(stateCleared, State.lastCommittedSearchState)) URLService.commitSearchState(stateCleared);
          if (State.overlayOpen && !options.keepOverlay) OverlayService.closeSearchOverlay('manual');
          return;
        }

        let out = { results: [], keywords: [] };
        try {
          if (window.SearchEngine && typeof window.SearchEngine.search === 'function') out = window.SearchEngine.search(q, State.selectedType) || out;
        } catch (e) { console.error('SearchEngine.search failed', e); }

        State.currentResults = out.results || [];
        State.allKeywordsCache = out.keywords || [];

        const filterCategories = RenderingService.extractResultCategories(State.currentResults);
        FilterService.setupCategoryFilter(filterCategories, 'all');

        const stateObj = { q: q, type: State.selectedType || 'all', category: 'all' };
        const willCommit = (!preventPush && !State.suppressHistoryPush && !URLService.isStateEqual(stateObj, State.lastCommittedSearchState));
        if (willCommit) {
          URLService.commitSearchState(stateObj);
          State.searchHistoryPushed = true;
        }

        RenderingService.renderResults(State.currentResults, State.currentResults.length === 0);
        if (State.overlayOpen && !options.keepOverlay) OverlayService.closeSearchOverlay('manual');
      } catch (e) { console.error('doSearch failed', e); }
    }
  };

  // -------------------------
  // UI Service
  // -------------------------
// ✅ IMPROVED: UI Service with warp functionality
const UIService = {
  setupAutoSearchInput: function() {
    try {
      const input = DOMService.get(CONFIG.DOM.searchInputId);
      if (!input) return;
      DOMService.setAttr(input, 'enterkeyhint', 'search');
      
      Handlers.inputInput = () => {
        if (State.overlayTransitioning) return;
        clearTimeout(State.debounceTimeout);
        State.debounceTimeout = setTimeout(() => {
          SuggestionService.renderQuerySuggestions(input.value);
        }, CONFIG.TIMING.debounceMs);
      };
      input.addEventListener('input', Handlers.inputInput);
      
      Handlers.inputKeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          SearchService.doSearch();
          UIService.closeMobileKeyboard();
        } else if (e.key === 'ArrowDown') {
          const container = DOMService.get(CONFIG.DOM.suggestionContainerId);
          if (container) {
            const first = container.querySelector('.suggestion-item');
            first?.focus?.();
          }
        } else if (e.key === 'Backspace') {
          clearTimeout(State.debounceTimeout);
          State.debounceTimeout = setTimeout(() => {
            SuggestionService.renderQuerySuggestions(input.value);
          }, CONFIG.TIMING.debounceMs / 2);
        }
      };
      input.addEventListener('keydown', Handlers.inputKeydown);
      
      Handlers.inputBlur = () => {};
      input.addEventListener('blur', Handlers.inputBlur);
      
      Handlers.inputFocus = () => {
        if (!State.overlayTransitioning) {
          this.warpToTopOfOverlay();
          OverlayService.openSearchOverlay();
        }
      };
      input.addEventListener('focus', Handlers.inputFocus);
      
      Handlers.inputClick = () => {
        if (!State.overlayTransitioning) {
          this.warpToTopOfOverlay();
          OverlayService.openSearchOverlay();
        }
      };
      input.addEventListener('click', Handlers.inputClick);
    } catch (e) { console.error('setupAutoSearchInput failed', e); }
  },
  
  // ✅ IMPROVED: Warp to top of scrollable content
  warpToTopOfOverlay: function() {
    try {
      const scrollable = State.scrollableContent || DOMService.get(CONFIG.DOM.overlayContainerId);
      if (scrollable) {
        scrollable.scrollTop = 0;
      }
    } catch (e) { console.error('warpToTopOfOverlay failed', e); }
  },
  
  setupMobileSelectEnter: function() {
    try {
      [CONFIG.DOM.typeFilterId, CONFIG.DOM.categoryFilterId].forEach(id => {
        const el = DOMService.get(id);
        if (!el) return;
        const onChange = () => {
          if (id === CONFIG.DOM.typeFilterId) this.onTypeChange();
          else this.onCategoryChange();
        };
        el.onchange = onChange;
        el.onkeyup = (e) => { if (e.key === 'Enter') onChange(); };
      });
    } catch (e) { console.error('setupMobileSelectEnter failed', e); }
  },
  
  onTypeChange: function() {
    try {
      State.selectedType = DOMService.get(CONFIG.DOM.typeFilterId)?.value;
      SearchService.doSearch();
    } catch (e) {}
  },
  
  onCategoryChange: function() {
    try {
      State.selectedCategory = DOMService.get(CONFIG.DOM.categoryFilterId)?.value;
      RenderingService.renderResults(State.currentResults, false);
      this.updateUILanguage();
    } catch (e) {}
  },
  
  closeMobileKeyboard: function() {
    try {
      const input = DOMService.get(CONFIG.DOM.searchInputId);
      if (input && document.activeElement === input) input.blur();
    } catch (e) {}
  },
  
  updateUILanguage: function() {
    try {
      const input = DOMService.get(CONFIG.DOM.searchInputId);
      const placeholder = LanguageService.t('search_placeholder');
      if (input && input.placeholder !== placeholder) input.placeholder = placeholder;
      const filterGroupLabels = DOMService.queryAll('.search-filters-panel .filter-group-label');
      if (filterGroupLabels.length > 0 && filterGroupLabels[0].textContent !== LanguageService.t('type')) filterGroupLabels[0].textContent = LanguageService.t('type');
      if (filterGroupLabels.length > 1 && filterGroupLabels[1].textContent !== LanguageService.t('category')) filterGroupLabels[1].textContent = LanguageService.t('category');
    } catch (e) {}
  }
};

// ✅ IMPROVED: State additions for overlay input locking
const AdditionalState = {
  scrollableContent: null, // ✅ Reference to scrollable container
  resultsContainer: null, // ✅ Reference to results element
  wrapperContainer: null, // ✅ Reference to wrapper container
  navHiddenBySearch: false // ✅ Navigation state tracking
};

  // -------------------------
  // Initialization (continued)
  // -------------------------
  function initializeSearchEngine() {
    try {
      KeyboardService.initKeyboardDetection();

      fetch(CONFIG.DB.path)
        .then(res => res.json().catch(() => ({})))
        .then(data => {
          State.apiData = data || {};
          const initFn = (window.SearchEngine && typeof window.SearchEngine.init === 'function') ? window.SearchEngine.init : async () => Promise.resolve();
          return initFn(State.apiData, {}).catch(err => { console.error('SearchEngine.init failed', err); });
        })
        .then(() => {
          try {
            State.allKeywordsCache = (window.SearchEngine && typeof window.SearchEngine.generateAllKeywords === 'function') ? window.SearchEngine.generateAllKeywords() : [];
          } catch (e) { State.allKeywordsCache = []; }
          FilterService.setupTypeFilter('all');
          UIService.setupMobileSelectEnter();
          UIService.setupAutoSearchInput();
          FilterService.setupCategoryFilter([], 'all');
          document.body.style.marginBottom = '';
          const placeholderHtml = `<div class="search-result-here" style="text-align:center;color:#969ca8;font-size:1.07em;margin-top:30px;">${LanguageService.t('search_result_here')}</div>`;
          const sr = DOMService.get(CONFIG.DOM.searchResultsId);
          if (sr) DOMService.setHTML(sr, placeholderHtml);
          UIService.updateUILanguage();

          try {
            const hs = window.history?.state;
            if (hs && typeof hs === 'object' && (hs.q !== undefined)) {
              State.lastCommittedSearchState = { q: hs.q || '', type: hs.type || 'all', category: hs.category || 'all' };
            } else {
              const arr = StorageService.getHistory();
              if (arr?.length) {
                const last = arr[arr.length - 1];
                State.lastCommittedSearchState = { q: last.q || '', type: last.type || 'all', category: last.category || 'all' };
              } else State.lastCommittedSearchState = null;
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
              try { history.replaceState({ q: initial.q, type: State.selectedType, category: State.selectedCategory }, '', URLService.buildUrlForState(initial)); } catch (e) {}
              State.lastCommittedSearchState = { q: initial.q || '', type: State.selectedType || 'all', category: State.selectedCategory || 'all' };
            } finally { State.suppressHistoryPush = false; }
          } else {
            try { history.replaceState({ q: '', type: 'all', category: 'all' }, '', window.location.pathname); } catch (e) {}
            State.lastCommittedSearchState = { q: '', type: 'all', category: 'all' };
          }
        })
        .catch(err => {
          console.error('Failed to load api database', err);
          State.apiData = State.apiData || {};
        });

      const formEl = DOMService.get(CONFIG.DOM.searchFormId);
      if (formEl) {
        Handlers.formSubmit = (e) => { e.preventDefault(); SearchService.doSearch(); UIService.closeMobileKeyboard(); };
        DOMService.on(formEl, 'submit', Handlers.formSubmit);
      }

      const inputEl = DOMService.get(CONFIG.DOM.searchInputId);
      if (inputEl) {
        const kdown = (e) => { if (e.key === 'Enter') { e.preventDefault(); SearchService.doSearch(); UIService.closeMobileKeyboard(); } };
        Handlers.inputKeydown = kdown;
        DOMService.on(inputEl, 'keydown', kdown);
      }

      // ✅ popstate handling with gap-based keyboard support
      Handlers.popstate = function(e) {
        try {
          const state = e.state || {};
          const isOverlayState = state[State._overlayStateMarker];
          
          if (isOverlayState && State.overlayOpen) {
            OverlayService.closeSearchOverlay('popstate');
            return;
          }
          
          if (!isOverlayState && State.overlayOpen) {
            if (State.preOverlayState) {
              const inp = DOMService.get(CONFIG.DOM.searchInputId);
              if (inp) inp.value = State.preOverlayState.q || '';
              State.selectedType = State.preOverlayState.type || 'all';
              State.selectedCategory = State.preOverlayState.category || 'all';
            }
            OverlayService.closeSearchOverlay('popstate');
            return;
          }
          
          const st = (e.state && typeof e.state === 'object' && !isOverlayState) ? e.state : URLService.readStateFromURL();
          if (st?.q !== undefined) restoreUIState(st);
        } catch (e) { console.error('popstate handler failed', e); }
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

  // -------------------------
  // Cleanup / Destroy Function
  // -------------------------
  function destroy() {
    try {
      // Close overlay and disable auto-toggle
      OverlayService.closeSearchOverlay && OverlayService.closeSearchOverlay('manual');
      KeyboardAutoToggleService.disableAutoToggle();

      // Remove registered DOM handlers
      try {
        if (Handlers.resize) DOMService.off(window, 'resize', Handlers.resize);
        if (Handlers.popstate) DOMService.off(window, 'popstate', Handlers.popstate);
        if (Handlers.documentClick) DOMService.off(document, 'click', Handlers.documentClick);
        if (Handlers.formSubmit) DOMService.off(DOMService.get(CONFIG.DOM.searchFormId), 'submit', Handlers.formSubmit);
        if (Handlers.copyClick) DOMService.off(DOMService.get(CONFIG.DOM.searchResultsId), 'click', Handlers.copyClick);
        
        const input = DOMService.get(CONFIG.DOM.searchInputId);
        if (input) {
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

      // Disconnect render observer
      try { if (State.renderObserver) { State.renderObserver.disconnect(); State.renderObserver = null; } } catch (e) {}

      // Clear timeouts/intervals
      State._timeouts.forEach(t => { try { clearTimeout(t); clearInterval(t); } catch (e) {} });
      State._timeouts.clear();

      // Remove generated DOM
      try {
        DOMService.remove(DOMService.get(CONFIG.DOM.suggestionContainerId));
        DOMService.remove(DOMService.get(CONFIG.DOM.suggestionBackdropId));
        DOMService.remove(DOMService.get(CONFIG.DOM.overlayBackdropId));
        DOMService.remove(DOMService.get(CONFIG.DOM.overlayContainerId));
        DOMService.remove(DOMService.get(CONFIG.DOM.sentinelId));
      } catch (e) {}

      // Reset state
      State.apiData = null;
      State.allKeywordsCache = [];
      State.currentResults = [];
      State.currentFilteredResults = [];
      State.lastCommittedSearchState = null;
      State._handlersAttached = false;
      State.keyboardAutoToggleEnabled = false;

      if (window.__searchUI) window.__searchUI._initialized = false;
    } catch (e) { console.error('destroy failed', e); }
  }

  // -------------------------
  // Public API Exposure
  // -------------------------
  window.__searchUI = window.__searchUI || {};
  Object.assign(window.__searchUI, {
    init: initializeSearchEngine,
    destroy,
    getConfig: () => CONFIG,
    getState: () => State,
    getServices: () => ({
      Language: LanguageService,
      DOM: DOMService,
      String: StringService,
      Storage: StorageService,
      URL: URLService,
      Notification: NotificationService,
      Rendering: RenderingService,
      Filter: FilterService,
      Suggestion: SuggestionService,
      ReadyMode: ReadyModeService,
      Highlight: HighlightService,
      Overlay: OverlayService,
      Search: SearchService,
      UI: UIService,
      Keyboard: KeyboardService,
      GapBasedKeyboard: GapBasedKeyboardService,
      KeyboardAutoToggle: KeyboardAutoToggleService
    }),
    getLastCommittedSearchState: () => State.lastCommittedSearchState,
    getSessionHistory: () => StorageService.getHistory(),
    querySuggestions: (q) => (window.SearchEngine && typeof window.SearchEngine.querySuggestions === 'function') ? window.SearchEngine.querySuggestions(q, CONFIG.RENDER.suggestionMax) : [],
    isKeyboardOpen: () => KeyboardService.isKeyboardOpen(),
    
    // ✅ NEW: Public API for gap-based keyboard control
    enableKeyboardAutoToggle: () => KeyboardAutoToggleService.enableAutoToggle(),
    disableKeyboardAutoToggle: () => KeyboardAutoToggleService.disableAutoToggle(),
    resetKeyboardGap: () => GapBasedKeyboardService.resetGap(),
    isKeyboardGapExpired: () => GapBasedKeyboardService.isGapExpired(),
    isKeyboardRecoveryTimeExpired: () => GapBasedKeyboardService.isRecoveryTimeExpired(),
    isKeyboardScrollIdle: () => GapBasedKeyboardService.isScrollIdle(),
    
    // ✅ DEBUG: Get gap-based system state
    getKeyboardAutoToggleState: () => ({
      enabled: State.keyboardAutoToggleEnabled,
      lastToggleTime: State.lastKeyboardToggleTime,
      lastScrollTime: State.lastScrollTime,
      isScrollingActive: State.isScrollingActive,
      keyboardGapMinMs: CONFIG.TIMING.keyboardGapMinMs,
      keyboardGapRecoveryMs: CONFIG.TIMING.keyboardGapRecoveryMs,
      keyboardIdleTimeMs: CONFIG.TIMING.keyboardIdleTimeMs,
      timeSinceLastToggle: Date.now() - State.lastKeyboardToggleTime,
      gapExpired: GapBasedKeyboardService.isGapExpired(),
      recoveryExpired: GapBasedKeyboardService.isRecoveryTimeExpired(),
      scrollIdle: GapBasedKeyboardService.isScrollIdle()
    })
  });

  window.__searchUI._initialized = true;

  // Initialize immediately
  initializeSearchEngine();

  // Auto-destroy on unload to minimize leaks
  try {
    window.addEventListener('beforeunload', function cleanupBeforeUnload() {
      try { destroy(); } catch (e) {}
    }, { passive: true });
  } catch (e) {}

})();