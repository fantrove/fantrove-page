// @ts-check
/**
 * @file virtual-scroll.js
 * Virtual scroll engine — only renders visible DOM nodes.
 *
 * Performance contract (v3.4 — zero-jank scroll):
 *  1. _getCoOff()  Cached container offset. Recomputed ONLY when ResizeObserver fires.
 *                  Eliminates forced reflow every RAF.
 *  2. _measure()   Runs in requestIdleCallback — never on the scroll thread.
 *  3. scrollTop    Written ONLY when scroll is idle (>150ms since last event).
 *                  Prevents mid-scroll layout thrash.
 *  4. Read-Write   All DOM reads happen before all DOM writes in each _render() call.
 *
 * Usage:
 *   VirtualScrollEngine.mount(viewport, host, items, renderFn, lang);
 *   VirtualScrollEngine.destroy();
 *
 * @module virtual-scroll
 * @depends {config.js}
 */
(function (M) {
  'use strict';

  const { CONFIG } = M;

  /**
   * @callback RenderFn
   * @param {SearchResult} item
   * @param {string} lang
   * @returns {string}  HTML string for one card
   */

  const VirtualScrollEngine = {
    OVERSCAN : CONFIG.RENDER.vsOverscanPx,
    POOL_MAX : CONFIG.RENDER.vsPoolMax,
    EST_H    : CONFIG.RENDER.vsEstimatedItemHeight,

    /** @type {Element|null}                  */ _vp          : null,
    /** @type {Element|null}                  */ _host        : null,
    /** @type {HTMLElement|null}              */ _box         : null,
    /** @type {SearchResult[]}               */ _items       : [],
    /** @type {RenderFn|null}                */ _fn          : null,
    /** @type {string}                        */ _lang        : 'en',
    /** @type {Float32Array|null}             */ _hgt         : null,  // measured height[i]
    /** @type {Float64Array|null}             */ _off         : null,  // cumulative offset (length n+1)
    /** @type {number}                        */ _total       : 0,
    /** @type {Map<number,HTMLElement>|null}  */ _vis         : null,  // index → node
    /** @type {HTMLElement[]}                 */ _pool        : [],    // recycled nodes
    /** @type {number|null}                   */ _raf         : null,
    /** @type {Function|null}                 */ _onScroll    : null,
    /** @type {ResizeObserver|null}           */ _vpObs       : null,
    /** @type {number}                        */ _cachedCoOff : 0,
    /** @type {boolean}                       */ _coOffDirty  : true,
    /** @type {boolean}                       */ _scrolling   : false,
    /** @type {number|null}                   */ _scrollTimer : null,

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Mount the virtual scroller.
     * @param {Element}      viewport   Scrollable container
     * @param {Element}      host       Where the vs-container div is appended
     * @param {SearchResult[]} items   Full result array
     * @param {RenderFn}     renderFn   Returns card HTML for one item
     * @param {string}       lang
     */
    mount(viewport, host, items, renderFn, lang) {
      this.destroy();
      this._vp    = viewport;
      this._host  = host;
      this._items = items || [];
      this._fn    = renderFn;
      this._lang  = lang || 'en';
      this._vis   = new Map();
      this._hgt   = new Float32Array(this._items.length).fill(this.EST_H);
      this._buildOff();
      this._coOffDirty = true;

      const box = document.createElement('div');
      box.className = 'vs-container';
      box.style.cssText = `position:relative;height:${this._total}px;min-height:2px;contain:layout style;`;
      host.appendChild(box);
      this._box = box;

      // Passive scroll — never blocks the compositor thread
      this._onScroll = () => {
        this._scrolling = true;
        if (this._scrollTimer) clearTimeout(this._scrollTimer);
        this._scrollTimer = setTimeout(() => { this._scrolling = false; }, 150);
        this._sched();
      };
      viewport.addEventListener('scroll', this._onScroll, { passive: true });

      // Invalidate cached offset when layout changes
      if ('ResizeObserver' in window) {
        this._vpObs = new ResizeObserver(() => { this._coOffDirty = true; this._sched(); });
        this._vpObs.observe(viewport);
      }

      this._sched();
    },

    /** Tear down all DOM, listeners and state. Safe to call multiple times. */
    destroy() {
      if (this._raf)         { cancelAnimationFrame(this._raf); this._raf = null; }
      if (this._scrollTimer) { clearTimeout(this._scrollTimer); this._scrollTimer = null; }
      if (this._vp && this._onScroll) this._vp.removeEventListener('scroll', this._onScroll);
      this._vpObs?.disconnect(); this._vpObs = null;
      this._box?.remove();       this._box   = null;
      this._vis?.clear();
      this._pool  = [];
      this._items = [];
      this._vp = this._host = this._fn = this._onScroll = null;
      this._vis    = null;
      this._scrolling = false;
    },

    // ── Internal ──────────────────────────────────────────────────────────────

    _sched() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = null; this._render(); });
    },

    /** Rebuild cumulative offset array from measured heights. O(n). */
    _buildOff() {
      const n = this._hgt.length;
      this._off = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) this._off[i + 1] = this._off[i] + this._hgt[i];
      this._total = this._off[n] || 0;
    },

    /**
     * Binary search: last index i where _off[i] ≤ target. O(log n).
     * @param {number} target
     * @returns {number}
     */
    _find(target) {
      if (!this._off || this._off.length < 2) return 0;
      let lo = 0, hi = this._off.length - 2;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (this._off[mid] <= target) lo = mid; else hi = mid - 1;
      }
      return lo;
    },

    /**
     * Vertical distance from viewport top to container top.
     * Cached — only recomputed when _coOffDirty is true (set by ResizeObserver).
     * @returns {number}
     */
    _getCoOff() {
      if (!this._coOffDirty) return this._cachedCoOff;
      let off = 0, el = this._box;
      while (el && el !== this._vp) { off += el.offsetTop; el = el.offsetParent; }
      this._cachedCoOff = off;
      this._coOffDirty  = false;
      return off;
    },

    /** One render pass. All reads before all writes. */
    _render() {
      if (!this._vp || !this._box || !this._items.length) return;

      // Phase 1 — reads
      const st = this._vp.scrollTop;
      const vh = this._vp.clientHeight;
      if (!vh) return;

      const co = this._getCoOff();   // cached — no reflow
      const si = this._find(Math.max(0, st - co - this.OVERSCAN));
      const ei = Math.min(this._items.length - 1, this._find(Math.max(0, st - co + vh + this.OVERSCAN)) + 1);

      const toRecycle = [];
      for (const [idx, el] of this._vis) {
        if (idx < si || idx > ei) toRecycle.push([idx, el]);
      }

      // Phase 2 — writes
      const frag      = document.createDocumentFragment();
      const toMeasure = [];

      for (const [idx, el] of toRecycle) {
        el.style.display = 'none';
        this._vis.delete(idx);
        if (this._pool.length < this.POOL_MAX) this._pool.push(el); else el.remove();
      }

      for (let i = si; i <= ei; i++) {
        if (this._vis.has(i)) continue;
        const top  = this._off[i];
        const html = this._fn(this._items[i], this._lang);
        let   el   = this._pool.pop();

        if (el) {
          el.style.cssText = `position:absolute;left:0;right:0;top:${top}px;`;
          el.style.display = '';
          el.innerHTML     = html;
        } else {
          el               = document.createElement('div');
          el.className     = 'vs-item';
          el.style.cssText = `position:absolute;left:0;right:0;top:${top}px;contain:layout style paint;`;
          el.innerHTML     = html;
          frag.appendChild(el);
        }
        this._vis.set(i, el);
        toMeasure.push(i);
      }

      if (frag.hasChildNodes()) this._box.appendChild(frag);
      if (toMeasure.length)     this._measure(toMeasure);
    },

    /**
     * Measure rendered heights and correct cumulative offsets.
     * Always runs in requestIdleCallback — never on the scroll path.
     * @param {number[]} indices
     */
    _measure(indices) {
      const self = this;
      const exec = () => {
        if (!self._vis) return;

        // Phase 1 — reads
        const reads = [];
        for (const i of indices) {
          const el = self._vis.get(i);
          if (!el || el.style.display === 'none') continue;
          const h = el.firstElementChild?.offsetHeight || el.offsetHeight;
          if (h > 4) reads.push([i, h]);
        }

        // Phase 2 — compute deltas (no DOM access)
        let changed = false;
        let adj     = 0;
        const co    = self._cachedCoOff;
        const st    = self._vp?.scrollTop || 0;

        for (const [i, h] of reads) {
          const diff = h - self._hgt[i];
          if (Math.abs(diff) <= 2) continue;
          if (self._off[i] + co < st) adj += diff;
          self._hgt[i] = h;
          changed = true;
        }
        if (!changed) return;

        // Phase 3 — writes
        self._buildOff();
        if (self._box) self._box.style.height = self._total + 'px';
        for (const [idx, el] of self._vis) {
          const t = self._off[idx] + 'px';
          if (el.style.top !== t) el.style.top = t;
        }

        // Scroll correction ONLY when idle — never mid-scroll
        if (adj !== 0 && self._vp && !self._scrolling) {
          self._vp.scrollTop += adj;
        }
      };

      if ('requestIdleCallback' in window) requestIdleCallback(exec, { timeout: 800 });
      else setTimeout(exec, 100);
    },
  };

  M.VirtualScrollEngine = VirtualScrollEngine;

})(window.SearchModules = window.SearchModules || {});
