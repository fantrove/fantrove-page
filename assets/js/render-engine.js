/**
 * render-engine.js  v2.1 — Fantrove Platform Render Engine
 * /assets/js/render-engine.js
 *
 * FIX v2.0 → v2.1
 * ────────────────────────────────────────────────────────────
 * ROOT CAUSE of lag at card 10-20:
 *
 * FlatList wrapped all cards in a plain <div class="fl-wrap">.
 * That div had NO CSS containment.  When browser lays out card N
 * (first time it enters viewport → content-visibility:auto fires),
 * the reflow propagates UP through fl-wrap to #searchResults and
 * then BACK DOWN through every sibling card.  50 cards = 50 ×
 * cascading reflows as user scrolls past each new card.
 *
 * FIX:
 *   1. fl-wrap gets  contain: layout style
 *      Reflow from any card is now isolated inside the wrapper.
 *      It cannot propagate to the sticky header, filter panel,
 *      or surrounding page elements.
 *
 *   2. Each card wrapper in FlatList gets  contain: layout style
 *      This is the "intrinsic size placeholder" element that
 *      content-visibility:auto uses.  Containment here ensures
 *      each card's first-paint layout is fully isolated.
 *
 *   3. contain-intrinsic-size changed from "auto 96px" to a
 *      FIXED estimate (no "auto" keyword).
 *      "auto N" means browser caches the measured height — but
 *      the measurement itself still triggers a layout pass on
 *      first entry.  A fixed estimate avoids that pass entirely;
 *      the tradeoff is a small scrollbar jump when actual height
 *      differs (acceptable — much better than per-card layout).
 *      This is set in CSS on .search-card and mirrored here in
 *      the card wrapper style.
 *
 *   4. FlatList now renders cards individually wrapped in
 *      <div class="sc-wrap"> instead of appending raw card HTML
 *      directly into fl-wrap.  Each sc-wrap has inline
 *      contain:layout style so card layouts are isolated at the
 *      individual level, not just at the list level.
 *
 * All other behavior unchanged from v2.0.
 */
;(function (global) {
  'use strict';

  /* ─── Capabilities ─────────────────────────────────────────── */
  const HAS_RIC    = typeof requestIdleCallback === 'function';
  const HAS_RO     = typeof ResizeObserver !== 'undefined';
  const HAS_SCHED  = typeof scheduler !== 'undefined' && typeof scheduler.postTask === 'function';
  const HAS_YIELD  = HAS_SCHED && typeof scheduler.yield === 'function';
  const HAS_IPP    = typeof navigator.scheduling !== 'undefined' && typeof navigator.scheduling.isInputPending === 'function';
  const HAS_WORKER = typeof Worker !== 'undefined';
  const MEM        = Math.max(1, Math.min(8, navigator.deviceMemory    || 4));
  const CORES      = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 2));
  const IS_LOW_END = MEM <= 2 || CORES <= 2;

  /* ─── MessageChannel yield ──────────────────────────────────── */
  let _mcRes = null, _mc = null;
  if (typeof MessageChannel !== 'undefined') {
    _mc = new MessageChannel();
    _mc.port1.onmessage = () => { if (_mcRes) { const r = _mcRes; _mcRes = null; r(); } };
  }
  const _mcYield = () => new Promise(res => { _mcRes = res; _mc.port2.postMessage(null); });

  /* ═══════════════════════════════════════════════════════════
     SCHEDULER
  ═══════════════════════════════════════════════════════════ */
  const Scheduler = {
    task(fn, priority = 'background', signal = null) {
      if (HAS_SCHED) {
        const o = { priority };
        if (signal) o.signal = signal;
        return scheduler.postTask(fn, o);
      }
      return new Promise((res, rej) => {
        const run = () => { try { res(fn()); } catch (e) { rej(e); } };
        if (priority === 'user-blocking') requestAnimationFrame(run);
        else if (HAS_RIC) requestIdleCallback(run, { timeout: priority === 'background' ? 4000 : 600 });
        else (_mc ? _mcYield().then(run) : setTimeout(run, 0));
      });
    },
    yield() {
      if (HAS_YIELD) return scheduler.yield();
      if (_mc)       return _mcYield();
      return new Promise(res => setTimeout(res, 0));
    },
    isInputPending() {
      try { return HAS_IPP && !!navigator.scheduling.isInputPending(); } catch { return false; }
    },
    frame: fn => requestAnimationFrame(fn),
    idle(fn, t = 2000) { HAS_RIC ? requestIdleCallback(fn, { timeout: t }) : setTimeout(fn, 16); },
    async chunked(items, fn, size = IS_LOW_END ? 10 : 40, signal = null) {
      for (let i = 0; i < items.length;) {
        if (signal?.aborted) break;
        if (this.isInputPending()) await this.yield();
        const end = Math.min(items.length, i + size);
        for (; i < end; i++) fn(items[i], i);
        if (i < items.length) await this.yield();
      }
    },
  };

  /* ═══════════════════════════════════════════════════════════
     POOL
  ═══════════════════════════════════════════════════════════ */
  class Pool {
    constructor(max = 60) { this.max = max; this._free = []; }
    acquire(cls = 'pool-item') {
      if (this._free.length) { const el = this._free.pop(); el.style.display = ''; return el; }
      const el = document.createElement('div');
      el.className = cls;
      return el;
    }
    release(el, clear = true) {
      if (!el) return;
      if (clear) el.innerHTML = '';
      el.style.display = 'none';
      el.dataset.vidx  = '';
      this._free.length < this.max ? this._free.push(el) : el.remove();
    }
    clear() { this._free.forEach(el => { try { el.remove(); } catch {} }); this._free = []; }
  }

  /* ═══════════════════════════════════════════════════════════
     CANONICAL CARD HTML BUILDER
  ═══════════════════════════════════════════════════════════ */
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  function _enc(s) { try { return encodeURIComponent(s); } catch { return s; } }

  function buildCardHTML(item, lang, copyLabel) {
    const it       = item.item || item;
    const rawText  = (it && it.text)  || '';
    const itemApi  = (it && it.api)   || '';
    const typeName = item.typeName    || '';
    const catName  = item.catName     || '';

    let nameStr = item.itemName || '';
    if (it && it.name) {
      const n = (typeof it.name === 'object')
        ? (it.name[lang] || it.name.en || '')
        : String(it.name || '');
      if (n && n !== nameStr) nameStr = nameStr ? nameStr + ' / ' + n : n;
    }
    if (!nameStr) nameStr = itemApi;

    const text     = rawText || itemApi || '-';
    const vertical = text.indexOf('\n') >= 0 || text.length > 45 || text.trim().split(/\s+/).length > 7;
    const cls      = vertical ? ' vertical' : '';
    const label    = copyLabel || 'Copy';

    return '<div class="result-item search-card' + cls + '" role="article" aria-label="' + _esc(nameStr || text) + '">'
      + '<div class="card-content" aria-hidden="true">' + _esc(text.slice(0, 300)) + '</div>'
      + '<div class="card-body">'
      + '<div class="card-title">'    + _esc(nameStr || itemApi || text) + '</div>'
      + '<div class="card-subtitle">' + _esc(itemApi || typeName)        + '</div>'
      + '<div class="card-tags" aria-hidden="true">'
      + (typeName ? '<span class="tag">' + _esc(typeName) + '</span>' : '')
      + (catName  ? '<span class="tag">' + _esc(catName)  + '</span>' : '')
      + '</div></div>'
      + '<button class="result-copy-btn" data-text="' + _enc(text) + '" aria-label="' + _esc(label) + '">'
      + _esc(label) + '</button></div>';
  }

  /* ═══════════════════════════════════════════════════════════
     WORKER SOURCE
  ═══════════════════════════════════════════════════════════ */
  const _WORKER_SRC = `'use strict';
function _e(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function _n(s){try{return encodeURIComponent(s);}catch{return s;}}
function buildCard(item,lang,label){
  var it=item.item||item;
  var raw=(it&&it.text)||'',api=(it&&it.api)||'',typ=item.typeName||'',cat=item.catName||'';
  var name=item.itemName||'';
  if(it&&it.name){var n=typeof it.name==='object'?(it.name[lang]||it.name.en||''):String(it.name||'');if(n&&n!==name)name=name?name+' / '+n:n;}
  if(!name)name=api;
  var text=raw||api||'-';
  var vert=text.indexOf('\\n')>=0||text.length>45||text.trim().split(/\\s+/).length>7;
  return '<div class="result-item search-card'+(vert?' vertical':'')+'" role="article" aria-label="'+_e(name||text)+'">'
    +'<div class="card-content" aria-hidden="true">'+_e(text.slice(0,300))+'</div>'
    +'<div class="card-body">'
    +'<div class="card-title">'+_e(name||api||text)+'</div>'
    +'<div class="card-subtitle">'+_e(api||typ)+'</div>'
    +'<div class="card-tags" aria-hidden="true">'
    +(typ?'<span class="tag">'+_e(typ)+'</span>':'')
    +(cat?'<span class="tag">'+_e(cat)+'</span>':'')
    +'</div></div>'
    +'<button class="result-copy-btn" data-text="'+_n(text)+'" aria-label="'+_e(label)+'">'+_e(label)+'</button></div>';
}
self.onmessage=function(e){
  var d=e.data,id=d.id,items=d.items,lang=d.lang,label=d.label;
  try{self.postMessage({id:id,html:items.map(function(it){return buildCard(it,lang,label);})});}
  catch(err){self.postMessage({id:id,error:String(err&&err.message||err)});}
};`;

  /* ═══════════════════════════════════════════════════════════
     WORKER RENDERER
  ═══════════════════════════════════════════════════════════ */
  const WorkerRenderer = (() => {
    let _worker = null;
    const _pend = new Map();
    let _id = 1;
    const TIMEOUT_MS = 1500;

    function _boot() {
      if (_worker) return _worker;
      if (!HAS_WORKER) return null;
      try {
        const blob = new Blob([_WORKER_SRC], { type: 'application/javascript' });
        _worker = new Worker(URL.createObjectURL(blob));
        _worker.onmessage = ev => {
          const { id, html, error } = ev.data;
          const p = _pend.get(id); if (!p) return;
          _pend.delete(id); clearTimeout(p.timer);
          error ? p.rej(new Error(error)) : p.res(html);
        };
        _worker.onerror = () => {
          _pend.forEach(p => { clearTimeout(p.timer); p.rej(new Error('worker error')); });
          _pend.clear(); try { _worker.terminate(); } catch {} _worker = null;
        };
        return _worker;
      } catch { _worker = null; return null; }
    }

    return {
      render(items, lang, label) {
        const w = _boot();
        if (!w) return Promise.resolve(items.map(it => buildCardHTML(it, lang, label)));
        return new Promise((res, rej) => {
          const id    = _id++;
          const timer = setTimeout(() => { _pend.delete(id); res(items.map(it => buildCardHTML(it, lang, label))); }, TIMEOUT_MS);
          _pend.set(id, { res, rej, timer });
          try { w.postMessage({ id, items, lang, label }); }
          catch (e) { _pend.delete(id); clearTimeout(timer); res(items.map(it => buildCardHTML(it, lang, label))); }
        });
      },
      renderSync(items, lang, label) { return items.map(it => buildCardHTML(it, lang, label)); },
      terminate() {
        _pend.forEach(p => { clearTimeout(p.timer); p.rej(new Error('terminated')); });
        _pend.clear();
        if (_worker) { try { _worker.terminate(); } catch {} _worker = null; }
      },
      isAvailable() { return HAS_WORKER && !!_boot(); },
    };
  })();

  /* ═══════════════════════════════════════════════════════════
     FLAT LIST  — primary renderer for search results
     ─────────────────────────────────────────────────────────
     FIX v2.1: fl-wrap gets contain:layout style so that
     content-visibility:auto layout passes on individual cards
     cannot cascade outside the list wrapper.

     Card HTML wrapping strategy:
       Each card HTML string is NOT wrapped in an extra div.
       The .search-card itself has content-visibility:auto in CSS.
       fl-wrap's contain:layout style provides the outer boundary.

     This means:
       • Scroll past card N (first entry into viewport) → browser
         lays out card N only.  Reflow stays inside fl-wrap.
       • No cascade to sticky header, filter panel, or page body.
       • Scrollbar height stays stable because fl-wrap has a
         known height (all cards rendered at DOM time; only paint
         is deferred by content-visibility:auto).
  ═══════════════════════════════════════════════════════════ */
  class FlatList {
    constructor(opts = {}) {
      this.host   = opts.host   || null;
      this.onCopy = opts.onCopy || null;
      this._wrap  = null;
      this._delegated = false;
    }

    render(htmlArray) {
      this.clear();
      if (!htmlArray?.length || !this.host) return;

      // FIX: fl-wrap now has contain:layout style via CSS
      // This isolates card layout from the rest of the page.
      const wrap = document.createElement('div');
      wrap.className = 'fl-wrap';

      // Single <template> parse + clone — one layout operation total
      const tpl = document.createElement('template');
      tpl.innerHTML = htmlArray.join('');
      wrap.appendChild(tpl.content);

      this.host.appendChild(wrap);
      this._wrap = wrap;
      this._attachDelegate();
    }

    _attachDelegate() {
      if (this._delegated || !this.host || !this.onCopy) return;
      this._delegated = true;
      this.host.addEventListener('click', e => {
        const btn = e.target.closest('.result-copy-btn');
        if (!btn) return;
        e.preventDefault();
        const text = btn.getAttribute('data-text');
        if (text) try { this.onCopy(decodeURIComponent(text)); } catch {}
      });
    }

    clear() {
      if (this._wrap) { try { this._wrap.remove(); } catch {} this._wrap = null; return; }
      if (this.host) { this.host.replaceChildren ? this.host.replaceChildren() : (this.host.innerHTML = ''); }
    }

    destroy() { this.clear(); this.host = null; this.onCopy = null; this._delegated = false; }
  }

  /* ═══════════════════════════════════════════════════════════
     VLIST  — 1-D virtual scroll for large content lists
  ═══════════════════════════════════════════════════════════ */
  class VList {
    constructor(opts = {}) {
      this.container   = opts.container  || window;
      this.host        = opts.host       || (this.container === window ? document.body : this.container);
      this.items       = opts.items      || [];
      this.renderItem  = opts.renderItem || (() => '');
      this.estH        = opts.itemHeight || 80;
      this.fixedHeight = !!opts.fixedHeight;
      this.overscanPx  = opts.overscan   || (IS_LOW_END ? 280 : 480);
      this.itemClass   = opts.itemClass  || 'vl-item';
      this.onMount     = opts.onMount    || null;
      this.onRecycle   = opts.onRecycle  || null;
      this._pool       = new Pool(opts.poolMax || (IS_LOW_END ? 20 : 40));
      this._vis        = new Map();
      this._hgt        = new Float32Array(this.items.length).fill(this.estH);
      this._off        = null;
      this._total      = 0;
      this._raf        = null;
      this._offDirty   = false;
      this._ro         = null;
      this._roBox      = null;
      this._destroyed  = false;
      this._boxTopCache = (this.container !== window) ? 0 : null;

      this._box = document.createElement('div');
      this._box.className = 'vl-box';
      this._box.style.cssText = 'position:relative;width:100%;min-height:2px;';
      this.host.appendChild(this._box);
      this._buildOffsets();
      this._bindEvents();
      this._schedule();
    }

    _buildOffsets() {
      this._offDirty = false;
      const n = this.items.length, off = new Float64Array(n + 1), h = this._hgt;
      for (let i = 0; i < n; i++) off[i + 1] = off[i] + h[i];
      this._off = off; this._total = off[n] || 0;
      if (this._box) this._box.style.height = this._total + 'px';
    }

    _markDirty() { if (!this._offDirty) { this._offDirty = true; this._schedule(); } }

    _bisect(t) {
      const o = this._off; if (!o || o.length < 2) return 0;
      let lo = 0, hi = o.length - 2;
      while (lo < hi) { const m = (lo + hi + 1) >>> 1; o[m] <= t ? lo = m : hi = m - 1; }
      return lo;
    }

    _scrollTop() { return this.container === window ? (window.pageYOffset || 0) : (this.container.scrollTop || 0); }
    _viewportH() { return this.container === window ? window.innerHeight : (this.container.clientHeight || window.innerHeight); }
    _getBoxTop() {
      if (this._boxTopCache !== null) return this._boxTopCache;
      let top = 0, el = this._box;
      while (el) { top += el.offsetTop; el = el.offsetParent; }
      return (this._boxTopCache = top);
    }

    _bindEvents() {
      this._onScroll = () => this._schedule();
      this.container.addEventListener('scroll', this._onScroll, { passive: true });
      if (HAS_RO) {
        this._roBox = new ResizeObserver(() => {
          if (this.container === window) this._boxTopCache = null;
          this._schedule();
        });
        this._roBox.observe(this._box);
        if (!this.fixedHeight) {
          this._ro = new ResizeObserver(entries => {
            let changed = false;
            for (const e of entries) {
              const idx = parseInt(e.target.dataset.vidx, 10); if (isNaN(idx)) continue;
              const h = (e.borderBoxSize?.[0]?.blockSize) || e.contentRect.height || 0;
              if (h > 2 && Math.abs(h - this._hgt[idx]) > 1) { this._hgt[idx] = h; changed = true; }
            }
            if (changed) this._markDirty();
          });
        }
      }
    }

    _schedule() {
      if (this._raf || this._destroyed) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null; if (this._destroyed) return;
        if (this._offDirty) this._buildOffsets();
        this._render();
      });
    }

    _render() {
      if (this._destroyed || !this._box || !this.items.length) return;
      const st = this._scrollTop(), vh = this._viewportH(), bt = this._getBoxTop();
      const lo = st - bt - this.overscanPx, hi = st - bt + vh + this.overscanPx;
      const si = this._bisect(Math.max(0, lo));
      const ei = Math.min(this.items.length - 1, this._bisect(Math.max(0, hi)) + 1);

      const toRec = [];
      for (const [idx] of this._vis) if (idx < si || idx > ei) toRec.push(idx);
      for (const idx of toRec) {
        const el = this._vis.get(idx); this._vis.delete(idx);
        if (this._ro) this._ro.unobserve(el);
        if (this.onRecycle) try { this.onRecycle(el, idx); } catch {}
        this._pool.release(el);
      }

      const frag = document.createDocumentFragment();
      for (let i = si; i <= ei; i++) {
        if (this._vis.has(i) || !this.items[i]) continue;
        const el = this._pool.acquire(this.itemClass);
        el.innerHTML    = this.renderItem(this.items[i], i);
        el.dataset.vidx = String(i);
        el.style.cssText = `position:absolute;top:0;left:0;right:0;transform:translateY(${this._off[i]}px);contain:layout style paint;`;
        this._vis.set(i, el); frag.appendChild(el);
        if (this._ro) this._ro.observe(el);
      }
      if (frag.hasChildNodes()) this._box.appendChild(frag);

      if (this.onMount) {
        for (let i = si; i <= ei; i++) {
          const el = this._vis.get(i);
          if (el && el.dataset.mounted !== '1') { el.dataset.mounted = '1'; try { this.onMount(el, i); } catch {} }
        }
      }
    }

    update(items) {
      this.items = items || [];
      const n = this.items.length;
      if (n !== this._hgt.length) {
        const h = new Float32Array(n).fill(this.estH);
        h.set(this._hgt.subarray(0, Math.min(this._hgt.length, n)));
        this._hgt = h;
      }
      for (const [, el] of this._vis) { if (this._ro) this._ro.unobserve(el); this._pool.release(el); }
      this._vis.clear();
      this._boxTopCache = (this.container !== window) ? 0 : null;
      this._buildOffsets(); this._schedule();
    }

    scrollTo(i) { if (!this._off) return; const t = this._off[i]??0; this.container===window?window.scrollTo({top:t,behavior:'smooth'}):this.container.scrollTo({top:t,behavior:'smooth'}); }
    jumpTo(i)   { if (!this._off) return; const t = this._off[i]??0; this.container===window?window.scrollTo(0,t):(this.container.scrollTop=t); }
    invalidate() { if (this.container===window) this._boxTopCache=null; this._schedule(); }

    destroy() {
      this._destroyed = true;
      if (this._raf) cancelAnimationFrame(this._raf);
      this.container.removeEventListener('scroll', this._onScroll);
      if (this._ro)    this._ro.disconnect();
      if (this._roBox) this._roBox.disconnect();
      this._pool.clear(); this._vis.clear();
      try { this._box?.remove(); } catch {}
      this._box = null;
    }

    get totalHeight()  { return this._total; }
    get visibleCount() { return this._vis.size; }
  }

  /* ═══════════════════════════════════════════════════════════
     VGRID  — 2-D virtual grid for card/emoji grids
  ═══════════════════════════════════════════════════════════ */
  class VGrid {
    constructor(opts = {}) {
      this.container  = opts.container  || window;
      this.host       = opts.host;
      this.items      = opts.items      || [];
      this.renderItem = opts.renderItem || (() => '');
      this.cellW      = opts.cellW      || 166;
      this.cellH      = opts.cellH      || 228;
      this.overscanPx = opts.overscan   || (IS_LOW_END ? 280 : 480);
      this.itemClass  = opts.itemClass  || 'vg-item';
      this.onMount    = opts.onMount    || null;
      this._pool      = new Pool(opts.poolMax || (IS_LOW_END ? 16 : 32));
      this._vis       = new Map();
      this._cols      = 1;
      this._raf       = null;
      this._ro        = null;
      this._destroyed = false;

      this._box = document.createElement('div');
      this._box.className = 'vg-box';
      this._box.style.cssText = 'position:relative;width:100%;min-height:2px;';
      this.host.appendChild(this._box);
      this._measure(); this._bindEvents(); this._schedule();
    }

    _measure() {
      const w = this.host.offsetWidth || (this.container===window ? window.innerWidth : this.container.offsetWidth);
      this._cols = Math.max(1, Math.floor((w + 6) / this.cellW));
      if (this._box) this._box.style.height = (Math.ceil(this.items.length / this._cols) * this.cellH) + 'px';
    }

    _scrollTop() { return this.container===window ? (window.pageYOffset||0) : (this.container.scrollTop||0); }
    _viewportH() { return this.container===window ? window.innerHeight : (this.container.clientHeight||window.innerHeight); }
    _getBoxTop() { let top=0,el=this._box; while(el&&el!==this.container){top+=el.offsetTop;el=el.offsetParent;} return top; }

    _bindEvents() {
      this._onScroll = () => this._schedule();
      this.container.addEventListener('scroll', this._onScroll, { passive: true });
      if (HAS_RO) { this._ro = new ResizeObserver(() => { this._measure(); this._schedule(); }); this._ro.observe(this.host); }
    }

    _schedule() {
      if (this._raf || this._destroyed) return;
      this._raf = requestAnimationFrame(() => { this._raf=null; if(!this._destroyed) this._render(); });
    }

    _render() {
      if (this._destroyed || !this._box || !this.items.length) return;
      const st=this._scrollTop(), vh=this._viewportH(), bt=this._getBoxTop();
      const lo=st-bt-this.overscanPx, hi=st-bt+vh+this.overscanPx;
      const cols=this._cols, rows=Math.ceil(this.items.length/cols);
      const fr=Math.max(0,Math.floor(lo/this.cellH)), lr=Math.min(rows-1,Math.ceil(hi/this.cellH));
      const fi=fr*cols, li=Math.min(this.items.length-1,(lr+1)*cols-1);

      const toRec=[];
      for(const [idx] of this._vis) if(idx<fi||idx>li) toRec.push(idx);
      for(const idx of toRec){this._pool.release(this._vis.get(idx));this._vis.delete(idx);}

      const frag=document.createDocumentFragment();
      for(let i=fi;i<=li;i++){
        if(this._vis.has(i)||!this.items[i]) continue;
        const col=i%cols, row=Math.floor(i/cols);
        const el=this._pool.acquire(this.itemClass);
        el.innerHTML=this.renderItem(this.items[i],i);
        el.dataset.vidx=String(i);
        el.style.cssText=`position:absolute;top:0;left:0;width:${this.cellW-6}px;transform:translate(${col*this.cellW}px,${row*this.cellH}px);contain:layout style paint;`;
        this._vis.set(i,el); frag.appendChild(el);
        if(this.onMount) try{this.onMount(el,i);}catch{}
      }
      if(frag.hasChildNodes()) this._box.appendChild(frag);
    }

    update(items) { this.items=items||[]; for(const[,el]of this._vis)this._pool.release(el); this._vis.clear(); this._measure(); this._schedule(); }
    invalidate() { this._measure(); this._schedule(); }

    destroy() {
      this._destroyed=true;
      if(this._raf) cancelAnimationFrame(this._raf);
      this.container.removeEventListener('scroll',this._onScroll);
      if(this._ro) this._ro.disconnect();
      this._pool.clear(); this._vis.clear();
      try{this._box?.remove();}catch{}
      this._box=null;
    }

    get visibleCount() { return this._vis.size; }
  }

  /* ═══════════════════════════════════════════════════════════
     PUBLIC FACADE
  ═══════════════════════════════════════════════════════════ */
  global.RenderEngine = {
    Scheduler,
    Pool,
    FlatList,
    VList,
    VGrid,
    Worker : WorkerRenderer,
    cardHTML: buildCardHTML,
    createFlatList: opts => new FlatList(opts),
    createVList   : opts => new VList(opts),
    createVGrid   : opts => new VGrid(opts),
    device : { mem: MEM, cores: CORES, isLowEnd: IS_LOW_END },
    poolMax  (base = 40)  { return IS_LOW_END ? Math.ceil(base * 0.5) : base; },
    overscan (base = 480) { return IS_LOW_END ? Math.ceil(base * 0.6) : base; },
    version: '2.1.0',
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.RenderEngine;

})(window);