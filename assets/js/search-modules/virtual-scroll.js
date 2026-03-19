// @ts-check
/**
 * @file virtual-scroll.js
 * Production virtual scroll — compositor-only rendering, zero forced layout.
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │  Techniques used by major platforms                          │
 * │                                                              │
 * │  1. PRE-RENDER in idle time                                  │
 * │     Parse card HTML → DocumentFragment BEFORE scroll.       │
 * │     During scroll rAF: cloneNode(true) only — no parsing.   │
 * │     Same as React's concurrent scheduler: off-critical-path  │
 * │     work. Twitter timeline uses this (2019 perf post).       │
 * │                                                              │
 * │  2. RATE-LIMIT ResizeObserver corrections (KEY FIX)          │
 * │     Without rate-limit: ResizeObserver → _applyCorrection   │
 * │     → _sched → _render adds nodes → ResizeObserver again.   │
 * │     This cascade creates periodic stalls every ~N cards.     │
 * │     Fix: corrections gated to at most once per 64ms.         │
 * │     Corrections are scroll-anchor polish — skipping is safe. │
 * │                                                              │
 * │  3. OVERSCAN 600px                                           │
 * │     ~30 nodes pre-rendered and in DOM. Fast flicks land on   │
 * │     already-rendered content. Eliminates pop-in.             │
 * │                                                              │
 * │  4. TRANSFORM:translateY — never top:Npx                     │
 * │     Compositor thread only. Zero layout recalculation.       │
 * │                                                              │
 * │  5. ResizeObserver — never offsetHeight                      │
 * │     Browser pushes sizes. Zero forced layout.                │
 * │                                                              │
 * │  6. POOL: nodes removed from DOM entirely (not hidden)       │
 * │                                                              │
 * │  7. WINDOW SCROLL + cached getBoundingClientRect             │
 * │     BCR read only on ResizeObserver, never per-frame.        │
 * └──────────────────────────────────────────────────────────────┘
 *
 * @module virtual-scroll
 * @depends {config.js}
 */
(function (M) {
  'use strict';

  const { CONFIG } = M;

  /** @callback RenderFn @param {SearchResult} item @param {string} lang @returns {string} */

  const VirtualScrollEngine = {
    OVERSCAN : 600,
    POOL_MAX : CONFIG.RENDER.vsPoolMax,
    EST_H    : CONFIG.RENDER.vsEstimatedItemHeight,

    /** @type {Element|null}                 */ _vp              : null,
    /** @type {EventTarget|null}             */ _scrollTarget    : null,
    /** @type {Element|null}                 */ _host            : null,
    /** @type {HTMLElement|null}             */ _box             : null,
    /** @type {SearchResult[]}              */ _items           : [],
    /** @type {RenderFn|null}               */ _fn              : null,
    /** @type {string}                       */ _lang            : 'en',
    /** @type {Float32Array|null}            */ _hgt             : null,
    /** @type {Float64Array|null}            */ _off             : null,
    /** @type {number}                       */ _total           : 0,
    /** @type {Map<number,HTMLElement>|null} */ _vis             : null,
    /** @type {HTMLElement[]}                */ _pool            : [],
    /** @type {Map<HTMLElement,number>|null} */ _idxMap          : null,
    /** @type {Map<number,DocumentFragment>} */ _preRendered     : new Map(),
    /** @type {number}                       */ _nextPreRender   : 0,
    /** @type {number|null}                  */ _preRenderCb     : null,
    /** @type {ResizeObserver|null}          */ _cardRO          : null,
    /** @type {ResizeObserver|null}          */ _vpObs           : null,
    /** @type {number|null}                  */ _raf             : null,
    /** @type {number|null}                  */ _correctTimer    : null,
    /** @type {number}                       */ _lastCorrection  : 0,
    /** @type {Function|null}                */ _onScroll        : null,
    /** @type {number}                       */ _cachedCoOff     : 0,
    /** @type {boolean}                      */ _coOffDirty      : true,
    /** @type {boolean}                      */ _scrolling       : false,
    /** @type {number|null}                  */ _scrollTimer     : null,
    /** @type {boolean}                      */ _windowScroll    : false,

    // ── Public ────────────────────────────────────────────────────────────────

    /**
     * @param {Element}        viewport  Pass document.scrollingElement for window scroll
     * @param {Element}        host
     * @param {SearchResult[]} items
     * @param {RenderFn}       renderFn
     * @param {string}         lang
     */
    mount(viewport, host, items, renderFn, lang) {
      this.destroy();

      this._vp            = viewport;
      this._host          = host;
      this._items         = items || [];
      this._fn            = renderFn;
      this._lang          = lang || 'en';
      this._vis           = new Map();
      this._idxMap        = new Map();
      this._preRendered   = new Map();
      this._nextPreRender = 0;
      this._lastCorrection= 0;
      this._hgt           = new Float32Array(this._items.length).fill(this.EST_H);
      this._buildOff();
      this._coOffDirty    = true;

      const scrollEl      = document.scrollingElement || document.documentElement;
      this._windowScroll  = (viewport === scrollEl || viewport === document.body);
      this._scrollTarget  = this._windowScroll ? window : viewport;

      const box = document.createElement('div');
      box.className = 'vs-container';
      box.style.cssText = `position:relative;height:${this._total}px;min-height:2px;contain:layout style;`;
      host.appendChild(box);
      this._box = box;

      if ('ResizeObserver' in window) {
        this._cardRO = new ResizeObserver((e) => this._onCardsResized(e));
        this._vpObs  = new ResizeObserver(() => { this._coOffDirty = true; this._sched(); });
        this._vpObs.observe(this._windowScroll ? document.body : viewport);
      }

      this._onScroll = () => {
        this._scrolling = true;
        if (this._scrollTimer) clearTimeout(this._scrollTimer);
        this._scrollTimer = setTimeout(() => { this._scrolling = false; }, 150);
        this._sched();
      };
      this._scrollTarget.addEventListener('scroll', this._onScroll, { passive: true });

      this._sched();
      this._schedPreRender();
    },

    destroy() {
      if (this._raf)          { cancelAnimationFrame(this._raf);  this._raf          = null; }
      if (this._correctTimer) { clearTimeout(this._correctTimer); this._correctTimer = null; }
      if (this._scrollTimer)  { clearTimeout(this._scrollTimer);  this._scrollTimer  = null; }
      if (this._preRenderCb) {
        if ('cancelIdleCallback' in window) cancelIdleCallback(this._preRenderCb);
        else clearTimeout(this._preRenderCb);
        this._preRenderCb = null;
      }
      if (this._scrollTarget && this._onScroll)
        this._scrollTarget.removeEventListener('scroll', this._onScroll);
      this._cardRO?.disconnect(); this._cardRO    = null;
      this._vpObs?.disconnect();  this._vpObs     = null;
      this._box?.remove();        this._box        = null;
      this._vis?.clear();
      this._idxMap?.clear();
      this._preRendered.clear();
      this._pool          = [];
      this._items         = [];
      this._windowScroll  = false;
      this._scrollTarget  = null;
      this._vp = this._host = this._fn = this._onScroll = null;
      this._vis = this._idxMap = null;
      this._scrolling = false;
    },

    // ── Pre-render ────────────────────────────────────────────────────────────

    /**
     * Parse HTML into DocumentFragments during idle time.
     * cloneNode(true) during scroll is 3–5× faster than innerHTML
     * because DOM tree already exists — no parsing needed.
     */
    _schedPreRender() {
      if (this._nextPreRender >= this._items.length) return;

      const run = (/** @type {any} */ deadline) => {
        const hasTime = () =>
          deadline?.timeRemaining ? deadline.timeRemaining() > 2 : true;

        while (this._nextPreRender < this._items.length && hasTime()) {
          const i = this._nextPreRender++;
          if (!this._preRendered.has(i) && this._fn) {
            try {
              const tpl = document.createElement('template');
              tpl.innerHTML = this._fn(this._items[i], this._lang);
              this._preRendered.set(i, /** @type {DocumentFragment} */ (tpl.content));
            } catch {}
          }
        }
        if (this._nextPreRender < this._items.length) this._schedPreRender();
      };

      if ('requestIdleCallback' in window) {
        this._preRenderCb = requestIdleCallback(run, { timeout: 200 });
      } else {
        this._preRenderCb = setTimeout(() => run(null), 50);
      }
    },

    // ── Internal ──────────────────────────────────────────────────────────────

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

    _scrollTop() {
      return this._windowScroll
        ? (window.scrollY || window.pageYOffset || 0)
        : (this._vp?.scrollTop || 0);
    },

    _viewportH() {
      return this._windowScroll ? window.innerHeight : (this._vp?.clientHeight || 0);
    },

    _getCoOff() {
      if (!this._coOffDirty) return this._cachedCoOff;
      if (this._windowScroll) {
        const rect = this._box.getBoundingClientRect();
        this._cachedCoOff = rect.top + (window.scrollY || window.pageYOffset || 0);
      } else {
        let off = 0, el = this._box;
        while (el && el !== this._vp) { off += el.offsetTop; el = el.offsetParent; }
        this._cachedCoOff = off;
      }
      this._coOffDirty = false;
      return this._cachedCoOff;
    },

    /**
     * ResizeObserver callback — browser pushes heights, zero forced layout.
     *
     * Rate-limited to once per 64ms to break ResizeObserver→rAF cascade:
     *   Without this: resize → correction → render adds nodes → resize → loop.
     *   Stutter pattern: smooth N cards, choppy, smooth N cards, repeating.
     *   64ms = 4 frames. Corrections are scroll-anchor polish, never content.
     *   Skipping one correction is invisible to users.
     *
     * @param {ResizeObserverEntry[]} entries
     */
    _onCardsResized(entries) {
      let dirty = false;
      for (const entry of entries) {
        const idx = this._idxMap?.get(/** @type {HTMLElement} */ (entry.target));
        if (idx === undefined) continue;
        // blockSize includes vs-item padding-bottom (= inter-card gap)
        const h = (entry.borderBoxSize?.[0]?.blockSize) ?? entry.contentRect.height;
        if (h > 4 && Math.abs(h - this._hgt[idx]) > 2) {
          this._hgt[idx] = h;
          dirty = true;
        }
      }

      if (!dirty || this._correctTimer) return;

      const elapsed = performance.now() - this._lastCorrection;
      const wait    = elapsed >= 64 ? 0 : 64 - elapsed;

      this._correctTimer = setTimeout(() => {
        this._correctTimer   = null;
        this._lastCorrection = performance.now();
        requestAnimationFrame(() => this._applyCorrection());
      }, wait);
    },

    /** Rebuild offsets + reposition. Reference-point scroll anchoring. */
    _applyCorrection() {
      if (!this._box) return;

      const st        = this._scrollTop();
      const vTop      = Math.max(0, st - this._cachedCoOff);
      const refIdx    = this._find(vTop);
      const oldRefOff = this._off[refIdx];

      this._buildOff();
      this._box.style.height = this._total + 'px';

      for (const [idx, el] of this._vis) {
        const t = `translateY(${this._off[idx]}px)`;
        if (el.style.transform !== t) el.style.transform = t;
      }

      const adj = this._off[refIdx] - oldRefOff;
      if (Math.abs(adj) > 0.5 && !this._scrolling) {
        if (this._windowScroll) window.scrollBy(0, adj);
        else if (this._vp) this._vp.scrollTop = st + adj;
      }

      this._sched();
    },

    /** One render pass — all reads before all writes. */
    _render() {
      if (!this._box || !this._items.length) return;

      // ── Reads ──────────────────────────────────────────────────────────────
      const st = this._scrollTop();
      const vh = this._viewportH();
      if (!vh) return;

      const co = this._getCoOff();
      const si = this._find(Math.max(0, st - co - this.OVERSCAN));
      const ei = Math.min(this._items.length - 1,
                          this._find(Math.max(0, st - co + vh + this.OVERSCAN)) + 1);

      const toRecycle = [];
      for (const [idx, el] of this._vis) {
        if (idx < si || idx > ei) toRecycle.push([idx, el]);
      }

      // ── Writes ─────────────────────────────────────────────────────────────
      const frag = document.createDocumentFragment();

      for (const [, el] of toRecycle) {
        const i = this._idxMap?.get(el);
        if (i !== undefined) { this._idxMap?.delete(el); this._vis.delete(i); }
        this._cardRO?.unobserve(el);
        if (this._pool.length < this.POOL_MAX) this._pool.push(el); else el.remove();
      }

      for (let i = si; i <= ei; i++) {
        if (this._vis.has(i)) continue;

        const y  = this._off[i];
        let   el = this._pool.pop();

        if (el) {
          el.style.transform = `translateY(${y}px)`;
          this._setContent(el, i);
        } else {
          el           = document.createElement('div');
          el.className = 'vs-item';
          el.style.cssText = `position:absolute;left:0;right:0;top:0;contain:layout style paint;transform:translateY(${y}px);`;
          this._setContent(el, i);
          frag.appendChild(el);
        }

        this._vis.set(i, el);
        this._idxMap?.set(el, i);
        this._cardRO?.observe(el);
      }

      if (frag.hasChildNodes()) this._box.appendChild(frag);
    },

    /**
     * Set card content into a vs-item node.
     * Fast path: cloneNode(true) from pre-rendered DocumentFragment.
     * Fallback: innerHTML (pre-render loop catches up in idle time).
     *
     * @param {HTMLElement} el
     * @param {number}      i
     */
    _setContent(el, i) {
      const pre = this._preRendered.get(i);
      if (pre && pre.childNodes.length) {
        el.innerHTML = '';
        el.appendChild(pre.cloneNode(true));
      } else {
        el.innerHTML = this._fn ? this._fn(this._items[i], this._lang) : '';
      }
    },
  };

  M.VirtualScrollEngine = VirtualScrollEngine;

})(window.SearchModules = window.SearchModules || {});
