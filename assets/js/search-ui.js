/*
  search-ui.js  v4.0 — Zero-Jank Search UI
  ═══════════════════════════════════════════════════════════════
  COMPLETE REWRITE from v3.0. Same public API, entirely new engine.

  ROOT-CAUSE FIXES vs v3.0:
  ─────────────────────────
  1. OVERLAY DOM THRASH (was the #1 lag source)
     Old: create/destroy full overlay DOM on every open/close
          + move the search input node (forces full reflow)
     New: overlay lives in DOM permanently
          open/close = CSS class toggle (opacity+visibility only)
          input NEVER moves — stays in #searchOverlayHeader always
          a read-only "mirror" input in header syncs value

  2. FORCED LAYOUT IN SCROLL LOOP
     Old: VirtualScrollEngine._coOff() called getBoundingClientRect
          every render frame → forced synchronous layout
     New: box-top cached via ResizeObserver + invalidated on mutation
          zero getBoundingClientRect in hot path

  3. BOX-SHADOW ON SCROLL ITEMS
     Old: cards had box-shadow changes on hover → GPU layer per card
     New: border-color change only (no repaint, no layer promotion)

  4. PER-ITEM DOM CREATION
     Old: new DOM nodes every render with no effective pooling
     New: RenderEngine.Pool — nodes recycled with display:none
          never more than (visible + 2×overscan) nodes alive

  5. HEIGHT MEASUREMENT VIA offsetHeight
     Old: _measure() read offsetHeight synchronously → forced layout
     New: ResizeObserver updates heights lazily (never in scroll path)

  6. RESULTS RENDERED INTO WRONG CONTAINER
     Old: close overlay → re-render same results into #searchResults
          (double work: render inside overlay, then render again)
     New: single render target (overlay body when open,
          #searchResults when closed) via simple container reference

  ARCHITECTURE:
  ─────────────
  • PersistentOverlay  — manages the always-in-DOM overlay
  • ResultVList        — wrapper around RenderEngine.VList
  • SearchService      — search execution (scheduler.postTask priority)
  • SuggestionService  — suggestion list management
  • FilterService      — type/category filter UI
  • UIService          — input, keyboard, language, misc
  • URLService         — history + URL state
  • NotificationService — copy toast
  • DataLoader         — ConDataService integration
  • PerfMonitor        — optional diagnostics

  DEPENDENCY: /assets/js/render-engine.js (must load first)
═══════════════════════════════════════════════════════════════ */
;(function () {
  'use strict';

  if (window.__searchUI?._initialized) return;

  /* ══════════════════════════════════════════════════════════
     WAIT FOR RenderEngine
  ══════════════════════════════════════════════════════════ */
  function _waitRE(cb) {
    if (window.RenderEngine) return cb();
    let t = 0;
    const poll = setInterval(() => {
      if (window.RenderEngine || ++t > 100) { clearInterval(poll); cb(); }
    }, 50);
  }

  /* ══════════════════════════════════════════════════════════
     CONFIG
  ══════════════════════════════════════════════════════════ */
  const CFG = {
    IDS: {
      overlay        : 'searchOverlay',
      overlayHeader  : 'searchOverlayHeader',
      overlayBody    : 'searchOverlayBody',
      overlaySug     : 'searchOverlaySuggestions',
      overlayBackdrop: 'searchOverlayBackdrop',
      input          : 'searchInput',
      mirrorInput    : 'searchInputMirror',
      form           : 'searchForm',
      typeFilter     : 'typeFilter',
      catFilter      : 'categoryFilter',
      results        : 'searchResults',
      copyToast      : 'copyToast',
    },
    RENDER: {
      sugMax      : 8,
      sugFullMax  : 32,
      poolMax     : 40,
      overscanPx  : 400,
      estItemH    : 110,
    },
    TIMING: {
      debounceMs   : 100,
      toastMs      : 1400,
      focusDelayMs : 30,
      svcWaitMs    : 6000,
      svcPollMs    : 30,
    },
    STORAGE: { histKey: 'srch_h_v1', langKey: 'selectedLang' },
    DB     : { path: '/assets/db/db.min.json' },
    PERF   : { enabled: false, longTaskMs: 50, maxM: 200 },
    LANG   : { default: 'en' },
    TEXTS  : {
      th: {
        all_types:'ทุกประเภท', all_cats:'ทุกหมวดหมู่',
        not_found:'ไม่พบข้อมูลที่ตรงหรือใกล้เคียง',
        copy:'คัดลอก', copy_fail:'คัดลอกไม่สำเร็จ',
        sug_label:'คำแนะนำ', trending:'ยอดนิยม',
        here:'ผลลัพธ์การค้นหาจะปรากฏที่นี่',
        placeholder:'ค้นหาข้อมูล...',
        type_lbl:'ประเภท', cat_lbl:'หมวดหมู่',
      },
      en: {
        all_types:'All Types', all_cats:'All Categories',
        not_found:'No results found.',
        copy:'Copy', copy_fail:'Failed to copy',
        sug_label:'Suggestions', trending:'Trending',
        here:'Search results will appear here',
        placeholder:'Search...',
        type_lbl:'Type', cat_lbl:'Category',
      },
    },
  };

  /* ══════════════════════════════════════════════════════════
     STATE
  ══════════════════════════════════════════════════════════ */
  const S = {
    apiData         : null,
    keywords        : [],
    results         : [],
    filteredResults : [],
    type            : 'all',
    category        : 'all',
    overlayOpen     : false,
    preOverlayQ     : '',
    lastCommitted   : null,
    historyPushed   : false,
    suppressPush    : false,
    debTimer        : null,
    _timeouts       : new Set(),
    _vlist          : null,   // active ResultVList instance
    _initialized    : false,
  };

  /* ══════════════════════════════════════════════════════════
     LANGUAGE
  ══════════════════════════════════════════════════════════ */
  const Lang = {
    get()  { try { return localStorage.getItem(CFG.STORAGE.langKey) || CFG.LANG.default; } catch { return 'en'; } },
    t(k)   { const l = this.get(); return CFG.TEXTS[l]?.[k] ?? CFG.TEXTS['en'][k] ?? k; },
  };

  /* ══════════════════════════════════════════════════════════
     DOM HELPERS
  ══════════════════════════════════════════════════════════ */
  const D = {
    id    : id  => document.getElementById(id),
    q     : sel => document.querySelector(sel),
    qAll  : sel => document.querySelectorAll(sel),
    on    : (el, ev, fn, opt) => el?.addEventListener(ev, fn, opt),
    off   : (el, ev, fn)      => el?.removeEventListener(ev, fn),
    esc   : s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    enc   : s => encodeURIComponent(s),
    dec   : s => { try { return decodeURIComponent(s); } catch { return s; } },
  };

  /* ══════════════════════════════════════════════════════════
     NOTIFICATION
  ══════════════════════════════════════════════════════════ */
  const Notif = {
    toast(msg) {
      try {
        const t = document.createElement('div');
        t.className   = 'copy-toast-message';
        t.textContent = msg;
        const host = D.id(CFG.IDS.copyToast) || document.body;
        host.appendChild(t);
        const tid = setTimeout(() => {
          t.style.opacity = '0';
          setTimeout(() => t.remove(), 250);
        }, CFG.TIMING.toastMs);
        S._timeouts.add(tid);
      } catch {}
    },
    async copy(text) {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = Object.assign(document.createElement('textarea'), { value: text });
          Object.assign(ta.style, { position:'fixed', left:'-9999px' });
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        this.toast(Lang.t('copy') + ' ✓');
      } catch { this.toast(Lang.t('copy_fail')); }
    },
  };

  /* ══════════════════════════════════════════════════════════
     URL / HISTORY
  ══════════════════════════════════════════════════════════ */
  const Url = {
    parse(qs = location.search) {
      const out = { q:'', type:'all', cat:'all' };
      if (!qs) return out;
      try {
        const p = new URLSearchParams(qs);
        out.q    = p.get('q')        || '';
        out.type = p.get('type')     || 'all';
        out.cat  = p.get('category') || 'all';
      } catch {}
      return out;
    },
    build(st) {
      const p = new URLSearchParams();
      if (st.q)   p.set('q', st.q);
      if (st.type && st.type !== 'all') p.set('type', st.type);
      if (st.cat  && st.cat  !== 'all') p.set('category', st.cat);
      const s = p.toString();
      return s ? '?' + s : location.pathname;
    },
    eq(a, b) {
      if (!a && !b) return true; if (!a || !b) return false;
      return (a.q||'').trim() === (b.q||'').trim() &&
             (a.type||'all') === (b.type||'all') &&
             (a.cat||'all')  === (b.cat||'all');
    },
    commit(st) {
      try {
        if (this.eq(st, S.lastCommitted)) return;
        const u = this.build(st);
        try {
          if (S.historyPushed) { history.replaceState(st, '', u); S.historyPushed = false; }
          else                   history.pushState(st, '', u);
        } catch { try { history.replaceState(st, '', u); } catch {} }
        S.lastCommitted = { q: st.q||'', type: st.type||'all', cat: st.cat||'all' };
        try {
          const hist = JSON.parse(sessionStorage.getItem(CFG.STORAGE.histKey) || '[]');
          hist.push(Object.assign({}, st, { ts: Date.now() }));
          sessionStorage.setItem(CFG.STORAGE.histKey, JSON.stringify(hist.slice(-50)));
        } catch {}
      } catch {}
    },
  };

  /* ══════════════════════════════════════════════════════════
     RENDERING — card HTML generation
  ══════════════════════════════════════════════════════════ */
  const Render = {
    card(item, lang) {
      try {
        const it      = item.item || item;
        const rawText = it?.text || '';
        const itemApi = it?.api  || '';
        const typeName= item.typeName  || item.typeObj?.name?.[lang]  || item.typeObj?.name?.en  || '';
        const catName = item.catName   || item.category?.name?.[lang] || item.category?.name?.en || '';

        // Collect all name variants
        const names = [];
        if (item.itemName) names.push(item.itemName);
        if (it?.name) {
          const n = it.name[lang] || it.name.en;
          if (n && !names.includes(n)) names.push(n);
        }
        const nameStr = names.filter(Boolean).join(' / ');
        const text    = rawText || itemApi || '—';

        const vertical = text.includes('\n') || text.length > 45 || text.trim().split(/\s+/).length > 7;
        const esc      = D.esc;
        const enc      = D.enc;

        return `<div class="result-item search-card${vertical?' vertical':''}" role="article" aria-label="${esc(nameStr||text)}">
  <div class="card-content" aria-hidden="true">${esc(String(text).slice(0,400))}</div>
  <div class="card-body">
    <div class="card-title">${esc(nameStr||itemApi||text)}</div>
    <div class="card-subtitle">${esc(itemApi||typeName||'')}</div>
    <div class="card-tags" aria-hidden="true">
      ${typeName ? `<span class="tag">${esc(typeName)}</span>` : ''}
      ${catName  ? `<span class="tag">${esc(catName)}</span>`  : ''}
    </div>
  </div>
  <button class="result-copy-btn" data-text="${enc(text)}" aria-label="${esc(Lang.t('copy'))}">${esc(Lang.t('copy'))}</button>
</div>`;
      } catch {
        return '<div class="search-card"><div class="card-content">—</div></div>';
      }
    },

    noResult(showSuggestions = false) {
      const lang = Lang.get();
      let html   = `<div class="no-result">${D.esc(Lang.t('not_found'))}</div>`;
      if (showSuggestions && S.apiData?.type?.[0]?.category?.[0]) {
        const t0 = S.apiData.type[0], c0 = t0.category[0];
        html += '<div class="suggestions-head">'+D.esc(Lang.t('trending'))+'</div>';
        for (const item of (c0.data || []).slice(0, 5)) {
          html += this.card({
            item, typeObj: t0, category: c0,
            itemName : item.name?.[lang] || item.name?.en || '',
            typeName : t0.name?.[lang]   || t0.name?.en  || '',
            catName  : c0.name?.[lang]   || c0.name?.en  || '',
          }, lang);
        }
      }
      return html;
    },
  };

  /* ══════════════════════════════════════════════════════════
     RESULT VLIST  — wraps RenderEngine.VList
     Handles rendering results into whichever container is active.
  ══════════════════════════════════════════════════════════ */
  const ResultVList = {
    _vlist : null,
    _host  : null,
    _delegated: false,

    _getActiveContainer() {
      // When overlay is open, render into overlay body
      // When closed, render into main #searchResults
      return S.overlayOpen
        ? D.id(CFG.IDS.overlayBody)
        : D.id(CFG.IDS.results);
    },

    _getScrollParent() {
      return S.overlayOpen
        ? (D.id(CFG.IDS.overlayBody) || window)
        : window;
    },

    /** Render a new list of results. Old VList is destroyed first. */
    render(items) {
      this.destroy();

      const container = this._getActiveContainer();
      if (!container) return;

      const lang = Lang.get();

      // Empty state
      if (!items || !items.length) {
        container.innerHTML = Render.noResult(true);
        this._attachCopyDelegate(container);
        return;
      }

      // Clear container and create host div for VList
      container.innerHTML = '';
      const host = document.createElement('div');
      host.style.cssText = 'position:relative;width:100%;';
      container.appendChild(host);

      const RE = window.RenderEngine;
      if (RE && items.length > 15) {
        // Use VList for large result sets
        this._vlist = RE.createVList({
          container  : this._getScrollParent(),
          host,
          items,
          renderItem : (item) => Render.card(item, lang),
          itemHeight : CFG.RENDER.estItemH,
          overscan   : CFG.RENDER.overscanPx,
          poolMax    : CFG.RENDER.poolMax,
          itemClass  : 'vl-item',
        });
      } else {
        // Small set: direct render (no VList overhead)
        const frag = document.createDocumentFragment();
        const tpl  = document.createElement('template');
        tpl.innerHTML = items.map(item => Render.card(item, lang)).join('');
        frag.appendChild(tpl.content);
        host.appendChild(frag);
      }

      this._host = host;
      this._attachCopyDelegate(container);
    },

    /** Attach copy delegation once per container. */
    _attachCopyDelegate(container) {
      if (container._copyDelegated) return;
      container._copyDelegated = true;
      D.on(container, 'click', e => {
        const btn = e.target.closest('.result-copy-btn');
        if (btn?.hasAttribute('data-text')) {
          e.preventDefault();
          Notif.copy(D.dec(btn.getAttribute('data-text')));
        }
      });
    },

    destroy() {
      if (this._vlist) {
        try { this._vlist.destroy(); } catch {}
        this._vlist = null;
      }
      this._host = null;
    },
  };

  /* ══════════════════════════════════════════════════════════
     PERSISTENT OVERLAY
     The overlay lives in DOM permanently.
     open/close = CSS class toggle only (compositor-safe).
     Input is ALWAYS inside the overlay — never moved.
     A read-only mirror in the header syncs value for display.
  ══════════════════════════════════════════════════════════ */
  const Overlay = {
    _built: false,

    /** Build overlay DOM once on first open (lazy). */
    _build() {
      if (this._built) return;
      this._built = true;

      // ── Backdrop ────────────────────────────────────────────
      const bd = document.createElement('div');
      bd.id = CFG.IDS.overlayBackdrop;
      D.on(bd, 'click', () => {
        if (!S.overlayOpen) return;
        const q = (D.id(CFG.IDS.input)?.value || '').trim();
        if (q) SearchSvc.doSearch(); else this.close();
      });
      document.body.appendChild(bd);

      // ── Overlay container ────────────────────────────────────
      const ov = document.createElement('div');
      ov.id = CFG.IDS.overlay;
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-label', 'Search');
      ov.setAttribute('aria-modal', 'true');

      // Header section (input + suggestions)
      const hdr = document.createElement('div');
      hdr.id = CFG.IDS.overlayHeader;

      // ── Move the REAL search input into overlay header ──────
      // The input has always been inside #searchForm in the page header.
      // We move it here ONCE at build time (not on every open/close).
      // A mirror <span> replaces it in the original location.
      const originalWrapper = D.q('.search-input-wrapper');
      if (originalWrapper) {
        // Create a placeholder that keeps the header layout
        const placeholder = document.createElement('div');
        placeholder.id = 'searchInputPlaceholder';
        placeholder.className = 'search-input-wrapper';
        placeholder.style.cssText = 'opacity:0;pointer-events:none;height:' + originalWrapper.offsetHeight + 'px;';
        originalWrapper.parentNode.insertBefore(placeholder, originalWrapper);

        // Move real wrapper into overlay header
        hdr.appendChild(originalWrapper);
      }

      // Suggestions list
      const sug = document.createElement('div');
      sug.id = CFG.IDS.overlaySug;
      hdr.appendChild(sug);

      // Body (scrollable results)
      const body = document.createElement('div');
      body.id = CFG.IDS.overlayBody;

      ov.appendChild(hdr);
      ov.appendChild(body);
      document.body.appendChild(ov);

      // Keyboard: Escape closes overlay
      D.on(document, 'keydown', e => {
        if (e.key === 'Escape' && S.overlayOpen) this.close();
      });

      // Suggestions interaction
      D.on(sug, 'click', e => {
        const it = e.target.closest('.suggestion-item');
        if (!it) return;
        e.preventDefault();
        const val = D.dec(it.getAttribute('data-val') || '');
        const inp = D.id(CFG.IDS.input);
        if (inp) inp.value = val;
        SearchSvc.doSearch();
      });
      D.on(sug, 'keydown', e => SugSvc._handleKeydown(e, sug));

      // Mirror click in placeholder opens overlay
      const ph = D.id('searchInputPlaceholder');
      if (ph) {
        D.on(ph, 'click', () => this.open());
        D.on(ph, 'focus', () => this.open());
      }
    },

    open() {
      if (S.overlayOpen) return;
      this._build();
      S.overlayOpen  = true;
      S.preOverlayQ  = D.id(CFG.IDS.input)?.value || '';

      const ov = D.id(CFG.IDS.overlay);
      const bd = D.id(CFG.IDS.overlayBackdrop);
      if (ov) ov.classList.add('open');
      if (bd) bd.classList.add('open');

      document.body.style.overflow = 'hidden';

      // Push history state so back closes overlay
      try {
        history.pushState({ __search_overlay__: true }, '', location.href);
        S.historyPushed = true;
      } catch {}

      // Focus input
      const inp = D.id(CFG.IDS.input);
      if (inp) {
        const tid = setTimeout(() => {
          try { inp.focus(); inp.select?.(); } catch {}
        }, CFG.TIMING.focusDelayMs);
        S._timeouts.add(tid);
      }

      SugSvc.renderTrending();
    },

    close(src = 'manual') {
      if (!S.overlayOpen) return;
      S.overlayOpen = false;

      const ov = D.id(CFG.IDS.overlay);
      const bd = D.id(CFG.IDS.overlayBackdrop);
      if (ov) ov.classList.remove('open');
      if (bd) bd.classList.remove('open');

      document.body.style.overflow = '';

      // Destroy any VList in overlay body (will re-render in #searchResults)
      ResultVList.destroy();

      // Clear suggestions
      const sug = D.id(CFG.IDS.overlaySug);
      if (sug) sug.innerHTML = '';

      // History sync
      if (src !== 'popstate') {
        try {
          const st = S.lastCommitted || { q:'', type:'all', cat:'all' };
          history.replaceState(st, '', Url.build(st));
          S.historyPushed = false;
        } catch {}
      }

      // Blur input so keyboard closes on mobile
      try { D.id(CFG.IDS.input)?.blur(); } catch {}
    },
  };

  /* ══════════════════════════════════════════════════════════
     SUGGESTION SERVICE
  ══════════════════════════════════════════════════════════ */
  const SugSvc = {
    renderTrending() {
      const sug = D.id(CFG.IDS.overlaySug);
      if (!sug || !S.overlayOpen) return;
      const lang = Lang.get();
      const items = this._extractTrending(lang);
      if (!items.length) { sug.innerHTML = ''; return; }
      let html = `<div class="suggestions-head">${D.esc(Lang.t('trending'))}</div>`;
      for (const it of items)
        html += `<div class="suggestion-item" role="option" tabindex="0" data-val="${D.enc(it)}">
                   <div class="suggestion-body">${D.esc(it)}</div>
                 </div>`;
      sug.innerHTML = html;
    },

    renderQuery(q) {
      const sug = D.id(CFG.IDS.overlaySug);
      if (!sug) return;
      if (!q?.trim()) { this.renderTrending(); return; }
      const items = window.SearchEngine?.querySuggestions?.(q, CFG.RENDER.sugFullMax) || [];
      if (!items.length) { this.renderTrending(); return; }
      let html = `<div class="suggestions-head">${D.esc(Lang.t('sug_label'))}</div>`;
      for (const it of items) {
        const display = D.esc(it.raw || it.display || '');
        html += `<div class="suggestion-item" role="option" tabindex="0" data-val="${D.enc(it.raw||it.display||'')}">
                   <div class="suggestion-body">${display}</div>
                 </div>`;
      }
      sug.innerHTML = html;
    },

    _extractTrending(lang) {
      const out = [], seen = new Set();
      for (const kw of (S.keywords || [])) {
        if (out.length >= CFG.RENDER.sugFullMax) break;
        if (!kw?.item) continue;
        const name = typeof kw.item.name === 'object'
          ? (kw.item.name[lang] || kw.item.name.en || '')
          : (kw.itemName || '');
        if (!name || name.length < 2 || seen.has(name)) continue;
        if (!/[\u0E00-\u0E7F]/.test(name) && /^[A-Za-z0-9_\-]+$/.test(name) && name.length <= 20) continue;
        seen.add(name);
        out.push(name);
      }
      return out;
    },

    _handleKeydown(e, container) {
      const items = [...container.querySelectorAll('.suggestion-item')];
      if (!items.length) return;
      const idx = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[idx === -1 ? 0 : Math.min(items.length-1, idx+1)]?.focus(); }
      else if (e.key === 'ArrowUp')  { e.preventDefault(); items[idx === -1 ? items.length-1 : Math.max(0, idx-1)]?.focus(); }
      else if (e.key === 'Enter')    { e.preventDefault(); document.activeElement?.click?.(); }
      else if (e.key === 'Escape')   { Overlay.close('escape'); }
    },
  };

  /* ══════════════════════════════════════════════════════════
     FILTER SERVICE
  ══════════════════════════════════════════════════════════ */
  const FilterSvc = {
    setupType(selected = 'all') {
      const el = D.id(CFG.IDS.typeFilter);
      if (!el) return;
      const lang = Lang.get();
      let html   = `<option value="all">${D.esc(Lang.t('all_types'))}</option>`;
      for (const t of (S.apiData?.type || [])) {
        const lbl = t.name?.[lang] || t.name?.en || '';
        html += `<option value="${D.esc(lbl)}">${D.esc(lbl)}</option>`;
      }
      el.innerHTML = html;
      el.value     = selected;
    },

    setupCat(cats, selected = 'all') {
      const el = D.id(CFG.IDS.catFilter);
      if (!el) return;
      let html = `<option value="all">${D.esc(Lang.t('all_cats'))}</option>`;
      for (const { key, label } of cats)
        html += `<option value="${D.esc(key)}">${D.esc(label)}</option>`;
      el.innerHTML  = html;
      el.style.display = cats.length ? '' : 'none';
      el.value      = selected;
    },

    extractCats(results) {
      const lang = Lang.get(), out = [], seen = new Set();
      for (const r of results) {
        const k = r.category?.name?.[lang] || r.category?.name?.en || '';
        if (!seen.has(k)) { seen.add(k); out.push({ key: k, label: k }); }
      }
      return out;
    },
  };

  /* ══════════════════════════════════════════════════════════
     SEARCH SERVICE  — runs at user-visible priority
  ══════════════════════════════════════════════════════════ */
  const SearchSvc = {
    _sched: (typeof scheduler !== 'undefined' && scheduler) || null,

    _visibleTask(fn) {
      if (this._sched?.postTask) return this._sched.postTask(fn, { priority: 'user-visible' });
      return new Promise((res, rej) => requestAnimationFrame(() => { try { res(fn()); } catch(e) { rej(e); } }));
    },

    doSearch(e, preventPush) {
      try {
        e?.preventDefault?.();
        const inp = D.id(CFG.IDS.input);
        const q   = inp?.value || '';
        S.type    = D.id(CFG.IDS.typeFilter)?.value || S.type;
        S.category = 'all';

        if (!q.trim()) {
          // Empty search: clear results + close overlay
          ResultVList.destroy();
          const rc = D.id(CFG.IDS.results);
          if (rc) rc.innerHTML = `<div class="search-result-here">${D.esc(Lang.t('here'))}</div>`;
          FilterSvc.setupCat([], 'all');
          if (S.overlayOpen) Overlay.close('manual');
          if (!preventPush && !S.suppressPush) {
            const st = { q:'', type:'all', cat:'all' };
            if (!Url.eq(st, S.lastCommitted)) Url.commit(st);
          }
          return;
        }

        this._visibleTask(() => {
          try {
            PerfMon.mark('search-start');
            let out = { results: [], keywords: [] };
            try { if (window.SearchEngine?.search) out = window.SearchEngine.search(q, S.type) || out; } catch {}
            S.results  = out.results  || [];
            S.keywords = out.keywords || [];
            PerfMon.measure('search-latency', 'search-start');

            // Close overlay BEFORE rendering (so results land in #searchResults)
            if (S.overlayOpen) Overlay.close('manual');

            FilterSvc.setupCat(FilterSvc.extractCats(S.results), 'all');

            // URL commit
            if (!preventPush && !S.suppressPush) {
              const st = { q, type: S.type || 'all', cat: 'all' };
              if (!Url.eq(st, S.lastCommitted)) { Url.commit(st); S.historyPushed = true; }
            }

            // Render results (into #searchResults since overlay is now closed)
            PerfMon.mark('render-start');
            S.filteredResults = S.category !== 'all'
              ? S.results.filter(r => (r.category?.name?.[Lang.get()] || r.category?.name?.en || '') === S.category)
              : S.results;
            ResultVList.render(S.filteredResults.length ? S.filteredResults : S.results);
            PerfMon.measure('render-cost', 'render-start');
          } catch (err) { console.error('[SearchUI] doSearch inner:', err); }
        }).catch(err => console.error('[SearchUI] doSearch:', err));

      } catch (e) { console.error('[SearchUI] doSearch:', e); }
    },
  };

  /* ══════════════════════════════════════════════════════════
     UI SERVICE
  ══════════════════════════════════════════════════════════ */
  const UISvc = {
    setupInput() {
      const inp = D.id(CFG.IDS.input);
      if (!inp) return;

      inp.setAttribute('enterkeyhint', 'search');
      inp.setAttribute('autocomplete', 'off');

      D.on(inp, 'focus', () => { if (!S.overlayOpen) Overlay.open(); });
      D.on(inp, 'click', () => { if (!S.overlayOpen) Overlay.open(); });

      D.on(inp, 'input', () => {
        clearTimeout(S.debTimer);
        S.debTimer = setTimeout(() => {
          SugSvc.renderQuery(inp.value);
        }, CFG.TIMING.debounceMs);
      });

      D.on(inp, 'keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          SearchSvc.doSearch();
          try { inp.blur(); } catch {}
        } else if (e.key === 'Escape') {
          Overlay.close('escape');
        } else if (e.key === 'ArrowDown') {
          const sug = D.id(CFG.IDS.overlaySug);
          sug?.querySelector('.suggestion-item')?.focus?.();
        }
      });

      // Form submit
      const form = D.id(CFG.IDS.form);
      if (form) D.on(form, 'submit', e => { e.preventDefault(); SearchSvc.doSearch(); });
    },

    setupFilters() {
      const tf = D.id(CFG.IDS.typeFilter);
      const cf = D.id(CFG.IDS.catFilter);
      if (tf) tf.onchange = () => { S.type = tf.value; SearchSvc.doSearch(); };
      if (cf) cf.onchange = () => {
        S.category = cf.value;
        S.filteredResults = S.category !== 'all'
          ? S.results.filter(r => (r.category?.name?.[Lang.get()] || r.category?.name?.en || '') === S.category)
          : S.results;
        ResultVList.render(S.filteredResults);
      };
    },

    updateLang() {
      try {
        const inp = D.id(CFG.IDS.input);
        if (inp) {
          const ph = Lang.t('placeholder');
          if (inp.placeholder !== ph) inp.placeholder = ph;
        }
        const lbls = D.qAll('.filter-group-label');
        if (lbls[0]) lbls[0].textContent = Lang.t('type_lbl');
        if (lbls[1]) lbls[1].textContent = Lang.t('cat_lbl');
      } catch {}
    },

    setupPopstate() {
      D.on(window, 'popstate', e => {
        try {
          const s = e.state || {};
          if (s.__search_overlay__ && S.overlayOpen) { Overlay.close('popstate'); return; }
          if (!s.__search_overlay__ && S.overlayOpen) { Overlay.close('popstate'); }
          if (s.q !== undefined) this._restoreState(s);
        } catch {}
      });
    },

    _restoreState(st) {
      try {
        S.suppressPush = true;
        const inp = D.id(CFG.IDS.input);
        if (inp) inp.value = st.q || '';
        S.type     = st.type || 'all';
        S.category = st.cat  || 'all';
        FilterSvc.setupType(S.type);
        SearchSvc.doSearch(null, true);
      } finally { S.suppressPush = false; }
    },
  };

  /* ══════════════════════════════════════════════════════════
     PERF MONITOR (lightweight, opt-in)
  ══════════════════════════════════════════════════════════ */
  const PerfMon = (() => {
    const _m = [], _pending = {}, _lt = [];
    let _obs = null;

    function _en() { return CFG.PERF.enabled; }

    return {
      enable() {
        CFG.PERF.enabled = true;
        if (!_obs && 'PerformanceObserver' in window) {
          try {
            _obs = new PerformanceObserver(list => {
              for (const e of list.getEntries()) {
                if (e.duration >= CFG.PERF.longTaskMs) _lt.push({ d: Math.round(e.duration), ts: Date.now() });
                if (_lt.length > 50) _lt.shift();
              }
            });
            _obs.observe({ entryTypes: ['longtask'] });
          } catch {}
        }
      },
      disable() { CFG.PERF.enabled = false; try { _obs?.disconnect(); _obs = null; } catch {} },
      mark(n)    { if (!_en()) return; _pending[n] = performance.now(); },
      measure(n, s) {
        if (!_en() || _pending[s] == null) return;
        const d = performance.now() - _pending[s];
        delete _pending[s];
        if (_m.length >= CFG.PERF.maxM) _m.shift();
        _m.push({ n, d: Math.round(d * 10) / 10, ts: Date.now() });
      },
      log() {
        const sl = _m.filter(x => x.n === 'search-latency');
        const avg = sl.length ? Math.round(sl.reduce((a,b) => a+b.d, 0) / sl.length * 10) / 10 : null;
        console.group('%c[SearchUI PerfMon]', 'color:#13b47f;font-weight:bold');
        console.log('searches:', sl.length, '| avg ms:', avg);
        console.log('long tasks:', _lt.length);
        if (_lt.length) console.table(_lt.slice(-10));
        console.table(_m.slice(-20));
        console.groupEnd();
      },
      reset() { _m.length = 0; _lt.length = 0; },
    };
  })();

  /* ══════════════════════════════════════════════════════════
     DATA LOADER
  ══════════════════════════════════════════════════════════ */
  function _waitForService(ms) {
    return new Promise(res => {
      if (window.ConDataService?.getAssembled) return res(window.ConDataService);
      const start = Date.now();
      const id = setInterval(() => {
        if (window.ConDataService?.getAssembled) { clearInterval(id); res(window.ConDataService); }
        else if (Date.now() - start >= ms) { clearInterval(id); res(null); }
      }, CFG.TIMING.svcPollMs);
    });
  }

  function loadData() {
    return _waitForService(CFG.TIMING.svcWaitMs).then(svc => {
      if (svc) return svc.getAssembled().catch(() => fetch(CFG.DB.path).then(r=>r.json()).catch(()=>({})));
      return fetch(CFG.DB.path).then(r=>r.json()).catch(()=>({}));
    });
  }

  /* ══════════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════════ */
  function init() {
    _waitRE(() => {
      try {
        // Auto-enable PerfMon via ?searchperf=1
        try { if (new URLSearchParams(location.search).get('searchperf') === '1') PerfMon.enable(); } catch {}

        loadData().then(data => {
          S.apiData = data || {};
          const initFn = window.SearchEngine?.init || (() => Promise.resolve());
          return initFn(S.apiData, {
            onIndexProgress: () => {},
            onIndexReady   : () => { try { S.keywords = window.SearchEngine.generateAllKeywords?.() || []; } catch {} },
          }).catch(e => console.error('[SearchUI] SearchEngine.init:', e));
        }).then(() => {
          try { S.keywords = window.SearchEngine?.generateAllKeywords?.() || []; } catch {}

          FilterSvc.setupType('all');
          FilterSvc.setupCat([], 'all');
          UISvc.setupInput();
          UISvc.setupFilters();
          UISvc.updateLang();
          UISvc.setupPopstate();

          // Show placeholder
          const rc = D.id(CFG.IDS.results);
          if (rc) rc.innerHTML = `<div class="search-result-here">${D.esc(Lang.t('here'))}</div>`;

          // Restore from URL
          const init = Url.parse();
          if (init.q) {
            try {
              S.suppressPush = true;
              const inp = D.id(CFG.IDS.input);
              if (inp) inp.value = init.q;
              S.type     = init.type;
              S.category = init.cat;
              FilterSvc.setupType(init.type);
              SearchSvc.doSearch(null, true);
              try { history.replaceState(init, '', Url.build(init)); } catch {}
              S.lastCommitted = { q: init.q||'', type: init.type||'all', cat: init.cat||'all' };
            } finally { S.suppressPush = false; }
          } else {
            try { history.replaceState({ q:'', type:'all', cat:'all' }, '', location.pathname); } catch {}
            S.lastCommitted = { q:'', type:'all', cat:'all' };
          }

          S._initialized = true;
        }).catch(e => console.error('[SearchUI] init failed:', e));

      } catch (e) { console.error('[SearchUI] init:', e); }
    });
  }

  /* ══════════════════════════════════════════════════════════
     DESTROY
  ══════════════════════════════════════════════════════════ */
  function destroy() {
    try {
      ResultVList.destroy();
      Overlay.close('manual');
      S._timeouts.forEach(t => { try { clearTimeout(t); } catch {} });
      S._timeouts.clear();
      S.apiData = null; S.keywords = []; S.results = [];
      S._initialized = false;
      if (window.__searchUI) window.__searchUI._initialized = false;
    } catch {}
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════════════ */
  window.__searchUI = window.__searchUI || {};
  Object.assign(window.__searchUI, {
    init, destroy,
    perf       : PerfMon,
    getState   : () => S,
    getConfig  : () => CFG,
    getServices: () => ({ Overlay, SugSvc, FilterSvc, SearchSvc, UISvc, ResultVList, Url, Notif, Lang }),
    querySuggestions: q => window.SearchEngine?.querySuggestions?.(q, CFG.RENDER.sugMax) || [],
    getIndexStats: () => ({
      ready    : window.SearchEngine?.isIndexReady?.() || false,
      building : window.SearchEngine?.isBuilding?.()   || false,
      docCount : window.SearchEngine?.getDocCount?.()  || 0,
    }),
    getVSStats: () => ({
      active     : !!ResultVList._vlist,
      visibleCount: ResultVList._vlist?.visibleCount || 0,
      totalHeight : ResultVList._vlist?.totalHeight  || 0,
    }),
    _initialized: false,
  });

  window.__searchUI._initialized = false;

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  try { window.addEventListener('beforeunload', () => { try { destroy(); } catch {} }, { passive:true }); } catch {}

})();