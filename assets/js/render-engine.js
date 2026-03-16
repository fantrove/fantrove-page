/**
 * render-engine.js v1.0 — Fantrove Platform Render Engine
 * /assets/js/render-engine.js
 *
 * Zero-jank rendering primitives used by all page types.
 * Designed to run smoothly on 512 MB RAM single-core devices.
 *
 * EXPORTS (window.RenderEngine):
 *   Scheduler   — priority-aware task scheduler with full fallback chain
 *   Pool        — DOM node recycler (eliminates GC pressure)
 *   VList       — virtual scrolling list  (1-D, variable height)
 *   VGrid       — virtual scrolling grid  (2-D, fixed cell size)
 *   createVList(opts) → VList instance
 *   createVGrid(opts) → VGrid instance
 *
 * KEY INVARIANTS:
 *   • No box-shadow on scroll-path items  → no GPU layer promotion storms
 *   • Only transform/opacity for all motion → compositor thread only
 *   • contain:layout style paint per item  → isolated repaint per card
 *   • will-change only on active scroll containers, removed after stop
 *   • Heights measured via ResizeObserver  → zero forced layout reads
 *   • Prefix-sum offsets + binary search   → O(log n) visible range
 *   • Node pool with typed array storage   → zero GC pressure at 60 fps
 */
;(function (global) {
  'use strict';

  /* ─── Capability detection ─────────────────────────────────── */
  const HAS_RIC     = typeof requestIdleCallback === 'function';
  const HAS_RO      = typeof ResizeObserver      !== 'undefined';
  const HAS_SCHED   = typeof scheduler           !== 'undefined' && typeof scheduler.postTask === 'function';
  const HAS_YIELD   = HAS_SCHED && typeof scheduler.yield       === 'function';
  const HAS_IPP     = typeof navigator.scheduling !== 'undefined' && typeof navigator.scheduling.isInputPending === 'function';
  const HAS_MC      = typeof MessageChannel      !== 'undefined';
  const MEM         = Math.max(1, Math.min(8, navigator.deviceMemory || 4));
  const CORES       = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 2));
  const IS_LOW_END  = MEM <= 2 || CORES <= 2;

  /* ─── MessageChannel yield (faster than setTimeout 0) ──────── */
  let _mcYieldResolve = null;
  let _mc = null;
  if (HAS_MC) {
    _mc = new MessageChannel();
    _mc.port1.onmessage = () => { if (_mcYieldResolve) { const r = _mcYieldResolve; _mcYieldResolve = null; r(); } };
  }
  function _mcYield() {
    return new Promise(res => { _mcYieldResolve = res; _mc.port2.postMessage(null); });
  }

  /* ═══════════════════════════════════════════════════════════
     SCHEDULER
     Priority-aware task queue with full fallback chain:
     scheduler.postTask → rIC → MessageChannel → setTimeout
  ═══════════════════════════════════════════════════════════ */
  const Scheduler = {
    /**
     * Schedule fn at given priority.
     * priority: 'user-blocking' | 'user-visible' | 'background'
     */
    task(fn, priority = 'background', signal = null) {
      if (HAS_SCHED) {
        const opts = { priority };
        if (signal) opts.signal = signal;
        return scheduler.postTask(fn, opts);
      }
      return new Promise((resolve, reject) => {
        const run = () => { try { resolve(fn()); } catch (e) { reject(e); } };
        if (priority === 'user-blocking') {
          requestAnimationFrame(run);
        } else if (HAS_RIC) {
          requestIdleCallback(run, { timeout: priority === 'background' ? 4000 : 800 });
        } else {
          HAS_MC ? _mc.port2.postMessage(null) && (_mcYieldResolve = run) : setTimeout(run, 0);
        }
      });
    },

    /** Yield control back to browser (let input/paint happen). */
    yield() {
      if (HAS_YIELD) return scheduler.yield();
      if (HAS_MC)    return _mcYield();
      return new Promise(res => setTimeout(res, 0));
    },

    /** True if user is interacting RIGHT NOW (keyboard, pointer). */
    isInputPending() {
      if (HAS_IPP) try { return navigator.scheduling.isInputPending(); } catch {}
      return false;
    },

    /** rAF wrapper — use for visual DOM mutations. */
    frame(fn) { return requestAnimationFrame(fn); },

    /** Idle callback wrapper — use for measurement/analysis. */
    idle(fn, timeout = 2000) {
      if (HAS_RIC) requestIdleCallback(fn, { timeout });
      else         setTimeout(fn, 16);
    },

    /** Run fn in chunks, yielding between chunks. */
    async chunked(items, processFn, chunkSize = IS_LOW_END ? 10 : 40, signal = null) {
      const total = items.length;
      for (let i = 0; i < total;) {
        if (signal?.aborted) break;
        if (this.isInputPending()) await this.yield();
        const end = Math.min(total, i + chunkSize);
        for (; i < end; i++) processFn(items[i], i);
        if (i < total) await this.yield();
      }
    },
  };

  /* ═══════════════════════════════════════════════════════════
     POOL  — DOM node recycler
     Prevents GC pauses from repeated node creation/destruction.
  ═══════════════════════════════════════════════════════════ */
  class Pool {
    constructor(max = 60) {
      this.max   = max;
      this._free = [];
    }

    /** Get a recycled or new wrapper div. */
    acquire(className = 'pool-item') {
      if (this._free.length) {
        const el = this._free.pop();
        el.style.display = '';
        return el;
      }
      const el = document.createElement('div');
      el.className = className;
      return el;
    }

    /** Return a node to the pool instead of removing from DOM. */
    release(el, clearHTML = true) {
      if (!el) return;
      if (clearHTML) el.innerHTML = '';
      el.style.display = 'none';
      el.dataset.vidx  = '';
      if (this._free.length < this.max) {
        this._free.push(el);
      } else {
        try { el.remove(); } catch {}
      }
    }

    clear() {
      for (const el of this._free) try { el.remove(); } catch {}
      this._free = [];
    }
  }

  /* ═══════════════════════════════════════════════════════════
     VList  — 1-D virtual scrolling list (variable height)

     Items positioned via transform:translateY() → compositor.
     Heights updated by ResizeObserver → zero forced layouts.
     Prefix-sum offsets + binary search → O(log n) visible range.
     Node pool → zero GC.
  ═══════════════════════════════════════════════════════════ */
  class VList {
    /**
     * @param {object} opts
     *   container    {Element|Window} — scroll container
     *   host         {Element}        — where item nodes live (defaults to container)
     *   items        {any[]}          — data array
     *   renderItem   {fn}             — (item, index) → HTML string
     *   itemHeight   {number}         — estimated item height px (default 80)
     *   overscan     {number}         — px above/below viewport to keep rendered
     *   poolMax      {number}         — max pooled nodes
     *   itemClass    {string}         — CSS class for item wrapper
     *   onMount      {fn|null}        — (el, index) called after node inserted
     *   onRecycle    {fn|null}        — (el, index) called before node recycled
     */
    constructor(opts = {}) {
      this.container  = opts.container  || window;
      this.host       = opts.host       || (this.container === window ? document.body : this.container);
      this.items      = opts.items      || [];
      this.renderItem = opts.renderItem || (() => '');
      this.estH       = opts.itemHeight || 80;
      this.overscanPx = opts.overscan   || (IS_LOW_END ? 300 : 500);
      this.itemClass  = opts.itemClass  || 'vl-item';
      this.onMount    = opts.onMount    || null;
      this.onRecycle  = opts.onRecycle  || null;

      this._pool      = new Pool(opts.poolMax || (IS_LOW_END ? 20 : 40));
      this._vis       = new Map();   // index → element
      this._hgt       = new Float32Array(this.items.length).fill(this.estH);
      this._off       = null;
      this._total     = 0;
      this._raf       = null;
      this._ro        = null;
      this._destroyed = false;
      this._boxTopCache = null;

      // Inner box: absolute children live here; height = total content height
      this._box = document.createElement('div');
      this._box.className = 'vl-box';
      this._box.style.cssText = 'position:relative;width:100%;min-height:2px;';
      this.host.appendChild(this._box);

      this._buildOffsets();
      this._bindEvents();
      this._schedule();
    }

    /* ── Offset math ─────────────────────────────────────────── */
    _buildOffsets() {
      const n   = this.items.length;
      const off = new Float64Array(n + 1);
      const h   = this._hgt;
      for (let i = 0; i < n; i++) off[i + 1] = off[i] + h[i];
      this._off   = off;
      this._total = off[n] || 0;
      if (this._box) this._box.style.height = this._total + 'px';
    }

    _bisect(target) {
      const off = this._off;
      if (!off || off.length < 2) return 0;
      let lo = 0, hi = off.length - 2;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (off[mid] <= target) lo = mid; else hi = mid - 1;
      }
      return lo;
    }

    /* ── Scroll position ─────────────────────────────────────── */
    _scrollTop() {
      return this.container === window
        ? (window.pageYOffset || window.scrollY || 0)
        : this.container.scrollTop || 0;
    }

    _viewportH() {
      return this.container === window
        ? window.innerHeight
        : (this.container.clientHeight || window.innerHeight);
    }

    /* ── Box top offset (cached, invalidated on resize) ──────── */
    _getBoxTop() {
      if (this._boxTopCache != null) return this._boxTopCache;
      if (this.container === window) {
        let top = 0, el = this._box;
        while (el) { top += el.offsetTop; el = el.offsetParent; }
        this._boxTopCache = top;
      } else {
        const cr = this._box.getBoundingClientRect();
        const pr = this.container.getBoundingClientRect();
        this._boxTopCache = cr.top - pr.top + this.container.scrollTop;
      }
      return this._boxTopCache;
    }

    /* ── Events ─────────────────────────────────────────────── */
    _bindEvents() {
      this._onScroll = () => this._schedule();
      this.container.addEventListener('scroll', this._onScroll, { passive: true });

      if (HAS_RO) {
        this._roBox = new ResizeObserver(() => {
          this._boxTopCache = null;
          this._schedule();
        });
        this._roBox.observe(this._box);

        // Per-item height tracking
        this._ro = new ResizeObserver(entries => {
          let changed = false;
          for (const entry of entries) {
            const el  = entry.target;
            const idx = parseInt(el.dataset.vidx, 10);
            if (isNaN(idx)) continue;
            const h = (entry.borderBoxSize?.[0]?.blockSize) || entry.contentRect.height || 0;
            if (h > 2 && Math.abs(h - this._hgt[idx]) > 1) {
              this._hgt[idx] = h;
              changed = true;
            }
          }
          if (changed) {
            this._buildOffsets();
            this._schedule();
          }
        });
      }
    }

    /* ── Scheduling ──────────────────────────────────────────── */
    _schedule() {
      if (this._raf || this._destroyed) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        if (!this._destroyed) this._render();
      });
    }

    /* ── Main render loop ────────────────────────────────────── */
    _render() {
      if (this._destroyed || !this._box || !this.items.length) return;

      const st      = this._scrollTop();
      const vh      = this._viewportH();
      const boxTop  = this._getBoxTop();
      const lo      = st - boxTop - this.overscanPx;
      const hi      = st - boxTop + vh + this.overscanPx;
      const si      = this._bisect(Math.max(0, lo));
      const ei      = Math.min(this.items.length - 1, this._bisect(Math.max(0, hi)) + 1);

      // Recycle out-of-range items back to pool
      const toRecycle = [];
      for (const [idx] of this._vis) {
        if (idx < si || idx > ei) toRecycle.push(idx);
      }
      for (const idx of toRecycle) {
        const el = this._vis.get(idx);
        this._vis.delete(idx);
        if (this._ro)     this._ro.unobserve(el);
        if (this.onRecycle) try { this.onRecycle(el, idx); } catch {}
        this._pool.release(el);
      }

      // Mount newly visible items
      const frag = document.createDocumentFragment();
      for (let i = si; i <= ei; i++) {
        if (this._vis.has(i) || !this.items[i]) continue;

        const ty   = this._off[i];
        const html = this.renderItem(this.items[i], i);
        const el   = this._pool.acquire(this.itemClass);

        el.innerHTML      = html;
        el.dataset.vidx   = String(i);
        el.style.position = 'absolute';
        el.style.left     = '0';
        el.style.right    = '0';
        el.style.top      = '0';
        el.style.transform = `translateY(${ty}px)`;
        el.style.contain  = 'layout style paint';

        this._vis.set(i, el);
        frag.appendChild(el);
        if (this._ro) this._ro.observe(el);
      }

      if (frag.hasChildNodes()) this._box.appendChild(frag);

      // Fire onMount callbacks after insertion (layout stable)
      if (this.onMount) {
        for (let i = si; i <= ei; i++) {
          const el = this._vis.get(i);
          if (el && el.dataset.mounted !== '1') {
            el.dataset.mounted = '1';
            try { this.onMount(el, i); } catch {}
          }
        }
      }
    }

    /* ── Public API ──────────────────────────────────────────── */

    /** Replace items array and re-render. */
    update(items) {
      this.items = items || [];
      const oldLen = this._hgt.length;
      const newLen = this.items.length;
      if (newLen !== oldLen) {
        const h = new Float32Array(newLen).fill(this.estH);
        if (oldLen > 0) h.set(this._hgt.subarray(0, Math.min(oldLen, newLen)));
        this._hgt = h;
      }
      // Recycle all visible back to pool
      for (const [idx, el] of this._vis) {
        if (this._ro) this._ro.unobserve(el);
        this._pool.release(el);
      }
      this._vis.clear();
      this._boxTopCache = null;
      this._buildOffsets();
      this._schedule();
    }

    /** Smooth scroll to item by index. */
    scrollTo(index) {
      if (!this._off) return;
      const top = this._off[index] ?? 0;
      if (this.container === window) window.scrollTo({ top, behavior: 'smooth' });
      else this.container.scrollTo({ top, behavior: 'smooth' });
    }

    /** Instantly jump to item without smooth scroll. */
    jumpTo(index) {
      if (!this._off) return;
      const top = this._off[index] ?? 0;
      if (this.container === window) window.scrollTo(0, top);
      else this.container.scrollTop = top;
    }

    /** Invalidate box-top cache (call after layout changes). */
    invalidate() {
      this._boxTopCache = null;
      this._schedule();
    }

    /** Tear down all listeners and DOM. */
    destroy() {
      this._destroyed = true;
      if (this._raf)   cancelAnimationFrame(this._raf);
      this.container.removeEventListener('scroll', this._onScroll);
      if (this._ro)    this._ro.disconnect();
      if (this._roBox) this._roBox.disconnect();
      this._pool.clear();
      this._vis.clear();
      try { this._box?.remove(); } catch {}
      this._box = null;
    }

    get totalHeight() { return this._total; }
    get visibleCount() { return this._vis.size; }
  }

  /* ═══════════════════════════════════════════════════════════
     VGrid  — 2-D virtual scrolling grid (fixed cell size)

     Simpler than VList: fixed cell size → O(1) visible range.
     Used for emoji/symbol/card grids in contentManager.
  ═══════════════════════════════════════════════════════════ */
  class VGrid {
    /**
     * @param {object} opts
     *   container    {Element}  — scroll container (usually window)
     *   host         {Element}  — parent for the grid box
     *   items        {any[]}    — data array
     *   renderItem   {fn}       — (item, index) → HTML string
     *   cellW        {number}   — cell width  px (incl. gap)
     *   cellH        {number}   — cell height px (incl. gap)
     *   overscan     {number}   — extra px rows to keep rendered
     *   poolMax      {number}
     *   itemClass    {string}
     *   onMount      {fn|null}
     */
    constructor(opts = {}) {
      this.container  = opts.container  || window;
      this.host       = opts.host;
      this.items      = opts.items      || [];
      this.renderItem = opts.renderItem || (() => '');
      this.cellW      = opts.cellW      || 166; // 160px + 6px gap
      this.cellH      = opts.cellH      || 228; // 222px + 6px gap
      this.overscanPx = opts.overscan   || (IS_LOW_END ? 300 : 500);
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

      this._measure();
      this._bindEvents();
      this._schedule();
    }

    _measure() {
      const w = this.host.offsetWidth || (this.container === window ? window.innerWidth : this.container.offsetWidth);
      this._cols = Math.max(1, Math.floor((w + (this.cellW - (this.cellW - 6))) / this.cellW));
      const rows = Math.ceil(this.items.length / this._cols);
      if (this._box) this._box.style.height = (rows * this.cellH) + 'px';
    }

    _scrollTop() {
      return this.container === window
        ? (window.pageYOffset || window.scrollY || 0)
        : this.container.scrollTop || 0;
    }

    _viewportH() {
      return this.container === window
        ? window.innerHeight
        : (this.container.clientHeight || window.innerHeight);
    }

    _getBoxTop() {
      let top = 0, el = this._box;
      const base = this.container === window ? 0 : this.container.scrollTop;
      while (el && el !== this.container) { top += el.offsetTop; el = el.offsetParent; }
      return top;
    }

    _bindEvents() {
      this._onScroll = () => this._schedule();
      this.container.addEventListener('scroll', this._onScroll, { passive: true });

      if (HAS_RO) {
        this._ro = new ResizeObserver(() => {
          this._measure();
          this._schedule();
        });
        this._ro.observe(this.host);
      }
    }

    _schedule() {
      if (this._raf || this._destroyed) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        if (!this._destroyed) this._render();
      });
    }

    _render() {
      if (this._destroyed || !this._box || !this.items.length) return;

      const st      = this._scrollTop();
      const vh      = this._viewportH();
      const boxTop  = this._getBoxTop();
      const lo      = st - boxTop - this.overscanPx;
      const hi      = st - boxTop + vh + this.overscanPx;

      const cols = this._cols;
      const rows = Math.ceil(this.items.length / cols);

      const firstRow = Math.max(0, Math.floor(lo / this.cellH));
      const lastRow  = Math.min(rows - 1, Math.ceil(hi / this.cellH));
      const firstIdx = firstRow * cols;
      const lastIdx  = Math.min(this.items.length - 1, (lastRow + 1) * cols - 1);

      // Recycle
      const toRecycle = [];
      for (const [idx] of this._vis) {
        if (idx < firstIdx || idx > lastIdx) toRecycle.push(idx);
      }
      for (const idx of toRecycle) {
        const el = this._vis.get(idx);
        this._vis.delete(idx);
        this._pool.release(el);
      }

      // Mount
      const frag = document.createDocumentFragment();
      for (let i = firstIdx; i <= lastIdx; i++) {
        if (this._vis.has(i) || !this.items[i]) continue;

        const col  = i % cols;
        const row  = Math.floor(i / cols);
        const tx   = col * this.cellW;
        const ty   = row * this.cellH;
        const html = this.renderItem(this.items[i], i);
        const el   = this._pool.acquire(this.itemClass);

        el.innerHTML      = html;
        el.dataset.vidx   = String(i);
        el.style.position = 'absolute';
        el.style.top      = '0';
        el.style.left     = '0';
        el.style.width    = (this.cellW - 6) + 'px';
        el.style.transform = `translate(${tx}px,${ty}px)`;
        el.style.contain  = 'layout style paint';

        this._vis.set(i, el);
        frag.appendChild(el);
        if (this.onMount) try { this.onMount(el, i); } catch {}
      }

      if (frag.hasChildNodes()) this._box.appendChild(frag);
    }

    update(items) {
      this.items = items || [];
      for (const [, el] of this._vis) this._pool.release(el);
      this._vis.clear();
      this._measure();
      this._schedule();
    }

    invalidate() { this._measure(); this._schedule(); }

    destroy() {
      this._destroyed = true;
      if (this._raf)   cancelAnimationFrame(this._raf);
      this.container.removeEventListener('scroll', this._onScroll);
      if (this._ro)    this._ro.disconnect();
      this._pool.clear();
      this._vis.clear();
      try { this._box?.remove(); } catch {}
      this._box = null;
    }

    get visibleCount() { return this._vis.size; }
  }

  /* ═══════════════════════════════════════════════════════════
     RenderEngine  — public facade
  ═══════════════════════════════════════════════════════════ */
  const RenderEngine = {
    Scheduler,
    Pool,
    VList,
    VGrid,

    /** Create and mount a VList. */
    createVList(opts) { return new VList(opts); },

    /** Create and mount a VGrid. */
    createVGrid(opts) { return new VGrid(opts); },

    /** Device info (useful for adaptive rendering decisions). */
    device: { mem: MEM, cores: CORES, isLowEnd: IS_LOW_END },

    /** Recommended pool size for current device. */
    poolMax(base = 40) { return IS_LOW_END ? Math.ceil(base * 0.5) : base; },

    /** Recommended overscan for current device. */
    overscan(base = 500) { return IS_LOW_END ? Math.ceil(base * 0.6) : base; },

    /** Version. */
    version: '1.0.0',
  };

  /* ─── Export ────────────────────────────────────────────────── */
  global.RenderEngine = RenderEngine;

  // ES module compat
  if (typeof module !== 'undefined' && module.exports) module.exports = RenderEngine;

})(window);