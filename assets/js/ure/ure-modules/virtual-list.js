// Path:    assets/js/ure/ure-modules/virtual-list.js
// Purpose: Core virtual scroll engine. Maintains a Float64Array of cumulative
//          offsets, positions visible nodes with transform:translateY (no top:),
//          recycles nodes through pool.js, and measures real heights via RO.
//          Supports both window-scroll mode and container-scroll mode.
// Used by: engine.js

(function (M) {
  'use strict';

  const { CONFIG, Scheduler, ObserverFactory, createPool } = M;

  /**
   * Create a new VirtualList instance (one per engine mount).
   * @param {object} opts
   * @param {Element}   opts.container   - The URE spacer/host element
   * @param {Element}   opts.viewport    - Scroll root (use scrollingElement for window mode)
   * @param {any[]}     opts.items       - Initial data array
   * @param {Function}  opts.renderFn    - (item, lang) => HTML string
   * @param {string}    opts.lang        - Active language
   * @param {number}    opts.buffer      - Buffer px
   * @param {boolean}   opts.recycling   - Use DOM pool
   * @param {number}    opts.poolCap     - Pool bucket cap
   * @param {Function}  [opts.onVisible] - Callback(item, el)
   * @param {Function}  [opts.onHidden]  - Callback(item)
   * @returns {VirtualList}
   */
  function createVirtualList(opts) {
    const {
      container,
      viewport,
      items      = [],
      renderFn,
      lang       = 'en',
      buffer     = CONFIG.RENDER.DEFAULT_BUFFER_PX,
      recycling  = true,
      poolCap    = CONFIG.RENDER.DEFAULT_POOL_CAP,
      onVisible,
      onHidden,
    } = opts;

    // ── State ────────────────────────────────────────────────────────────────

    let _items    = items.slice();
    let _lang     = lang;
    let _rendered = false;

    // Height tracking: Float32Array(n) per-item, Float64Array(n+1) cumulative
    let _hgt = new Float32Array(_items.length).fill(CONFIG.RENDER.DEFAULT_ITEM_HEIGHT);
    let _off = new Float64Array(_items.length + 1); // prefix sum
    let _totalH = 0;

    // Visible window: Map<index, HTMLElement>
    const _vis    = new Map();
    // Reverse map: HTMLElement → index (for ResizeObserver callbacks)
    const _elIdx  = new WeakMap();

    // Pool
    const pool = recycling ? createPool(poolCap) : null;

    // Spacer box: one absolute-positioned div that sets container height
    const _spacer = document.createElement('div');
    _spacer.className   = CONFIG.DOM.SPACER_CLASS;
    _spacer.style.cssText = 'position:relative;width:100%;';
    container.appendChild(_spacer);

    // Determine scroll mode
    const _scrollEl = document.scrollingElement || document.documentElement;
    const _winMode  = (viewport === _scrollEl || viewport === document.body || viewport === window);
    const _scrollTarget = _winMode ? window : viewport;

    // Observers
    let _cardRO    = null;
    let _vpRO      = null;
    let _scrollRAF = null;
    let _corrTimer = null;
    let _lastCorr  = 0;
    let _coOff     = 0;   // cached container offset from scroll root top
    let _coOffDirty = true;

    // Scroll state
    let _scrolling    = false;
    let _scrollTimer  = null;

    // ── Height index ─────────────────────────────────────────────────────────

    function _buildOffsets() {
      const n = _hgt.length;
      if (_off.length !== n + 1) _off = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) _off[i + 1] = _off[i] + _hgt[i];
      _totalH = _off[n] || 0;
      _spacer.style.height = _totalH + 'px';
    }

    // Binary search: find index whose cumulative offset contains `target`
    function _find(target) {
      if (!_off || _off.length < 2) return 0;
      let lo = 0, hi = _off.length - 2;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (_off[mid] <= target) lo = mid; else hi = mid - 1;
      }
      return lo;
    }

    // ── Geometry ──────────────────────────────────────────────────────────────

    function _scrollTop() {
      return _winMode
        ? (window.scrollY || window.pageYOffset || 0)
        : (viewport.scrollTop || 0);
    }

    function _viewportH() {
      return _winMode ? window.innerHeight : (viewport.clientHeight || window.innerHeight);
    }

    function _getContainerOffset() {
      if (!_coOffDirty) return _coOff;
      if (_winMode) {
        const r = _spacer.getBoundingClientRect();
        _coOff = r.top + (window.scrollY || window.pageYOffset || 0);
      } else {
        let off = 0, el = _spacer;
        while (el && el !== viewport) { off += el.offsetTop || 0; el = el.offsetParent; }
        _coOff = off;
      }
      _coOffDirty = false;
      return _coOff;
    }

    // ── Render cycle ──────────────────────────────────────────────────────────

    function _render() {
      if (!_spacer.isConnected) return;

      const st   = _scrollTop();
      const vh   = _viewportH();
      const co   = _getContainerOffset();
      const from = Math.max(0, st - co - buffer);
      const to   = Math.max(0, st - co + vh + buffer);

      const si = _find(from);
      const ei = Math.min(_items.length - 1, _find(to) + 1);

      // Recycle nodes that scrolled out of range
      const toRecycle = [];
      for (const [idx, el] of _vis) {
        if (idx < si || idx > ei) toRecycle.push([idx, el]);
      }
      for (const [idx, el] of toRecycle) {
        _vis.delete(idx);
        _elIdx.delete(el);
        if (_cardRO) _cardRO.unobserve(el);
        if (onHidden) try { onHidden(_items[idx]); } catch (_) {}
        if (pool) pool.release(el, _getType(idx));
        else if (el.parentNode) el.parentNode.removeChild(el);
      }

      // Mount nodes that entered the range
      const frag = document.createDocumentFragment();
      for (let i = si; i <= ei; i++) {
        if (_vis.has(i)) continue;
        const item = _items[i];
        const y    = _off[i];

        const el = pool ? pool.acquire(_getType(i)) : document.createElement('div');
        el.className   = CONFIG.DOM.VISIBLE_CLASS;
        el.style.cssText = `position:absolute;left:0;right:0;top:0;contain:layout style paint;transform:translateY(${y}px);`;
        el.setAttribute(CONFIG.DOM.ITEM_ATTR, i);
        el.innerHTML = renderFn(item, _lang);

        frag.appendChild(el);
        _vis.set(i, el);
        _elIdx.set(el, i);
        if (_cardRO) _cardRO.observe(el);
        if (onVisible) try { onVisible(item, el); } catch (_) {}
      }
      if (frag.hasChildNodes()) _spacer.appendChild(frag);
    }

    // ── ResizeObserver: measure real heights, then correct offsets ────────────

    function _onCardsResized(entries) {
      let dirty = false;
      for (const entry of entries) {
        const idx = _elIdx.get(entry.target);
        if (idx === undefined) continue;
        const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        if (h > 4 && Math.abs(h - _hgt[idx]) > 2) {
          _hgt[idx] = h;
          dirty = true;
        }
      }
      if (!dirty || _corrTimer) return;
      const elapsed = performance.now() - _lastCorr;
      const wait    = elapsed >= CONFIG.TIMING.HEIGHT_CORRECTION_RATE_MS ? 0
                    : CONFIG.TIMING.HEIGHT_CORRECTION_RATE_MS - elapsed;
      _corrTimer = setTimeout(_applyCorrection, wait);
    }

    function _applyCorrection() {
      _corrTimer  = null;
      _lastCorr   = performance.now();
      const st    = _scrollTop();
      const vTop  = Math.max(0, st - _getContainerOffset());
      const ref   = _find(vTop);
      const oldOff= _off[ref];
      _buildOffsets();
      // Update visible nodes' transforms
      for (const [idx, el] of _vis) {
        const t = `translateY(${_off[idx]}px)`;
        if (el.style.transform !== t) el.style.transform = t;
      }
      // Scroll-anchor: nudge scroll to maintain visual position
      const adj = _off[ref] - oldOff;
      if (Math.abs(adj) > 0.5 && !_scrolling) {
        if (_winMode) window.scrollBy(0, adj);
        else viewport.scrollTop = st + adj;
      }
      Scheduler.schedule(_render, 'vl-render-post-correction');
    }

    // ── Scroll handler ────────────────────────────────────────────────────────

    function _onScroll() {
      _scrolling = true;
      clearTimeout(_scrollTimer);
      _scrollTimer = setTimeout(() => { _scrolling = false; }, CONFIG.TIMING.SCROLL_IDLE_MS);
      if (_scrollRAF) return;
      _scrollRAF = requestAnimationFrame(() => { _scrollRAF = null; _render(); });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _getType(idx) {
      const item = _items[idx];
      if (!item || typeof item !== 'object') return 'item';
      return item._ureType || item.type || 'item';
    }

    // Grow typed arrays when data grows
    function _growArrays(n) {
      if (_hgt.length < n) {
        const newHgt = new Float32Array(n).fill(CONFIG.RENDER.DEFAULT_ITEM_HEIGHT);
        newHgt.set(_hgt);
        _hgt = newHgt;
      }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    const VL = {

      mount() {
        if (_rendered) return;
        _rendered = true;

        _buildOffsets();

        // ResizeObserver for individual cards
        _cardRO = ObserverFactory.createRO(_onCardsResized);

        // ResizeObserver for viewport size changes
        _vpRO = ObserverFactory.createRO(() => {
          _coOffDirty = true;
          Scheduler.schedule(_render, 'vl-render-resize');
        });
        if (_vpRO) {
          _vpRO.observe(_winMode ? document.body : viewport);
        }

        // Scroll listener
        _scrollTarget.addEventListener('scroll', _onScroll, { passive: true });

        // Initial render
        Scheduler.schedule(_render, 'vl-initial-render');
      },

      /** Replace entire dataset (used for full-replace or initial load). */
      setItems(newItems) {
        _items = newItems.slice();
        _growArrays(_items.length);
        _buildOffsets();
        // Recycle all visible nodes
        for (const [, el] of _vis) {
          if (_cardRO) _cardRO.unobserve(el);
          if (pool) pool.release(el, 'item');
          else if (el.parentNode) el.parentNode.removeChild(el);
        }
        _vis.clear();
        Scheduler.schedule(_render, 'vl-set-items');
      },

      /** Update a single item in-place without full re-render. */
      updateItem(index, newData) {
        if (index < 0 || index >= _items.length) return;
        _items[index] = newData;
        const el = _vis.get(index);
        if (el) el.innerHTML = renderFn(newData, _lang);
      },

      /** Insert items at a given index. */
      insertAt(index, newItems) {
        _items.splice(index, 0, ...newItems);
        const extra = new Float32Array(newItems.length).fill(CONFIG.RENDER.DEFAULT_ITEM_HEIGHT);
        const merged = new Float32Array(_hgt.length + extra.length);
        merged.set(_hgt.slice(0, index));
        merged.set(extra, index);
        merged.set(_hgt.slice(index), index + extra.length);
        _hgt = merged;
        _buildOffsets();
        Scheduler.schedule(_render, 'vl-insert');
      },

      /** Remove items by index range. */
      removeAt(index, count = 1) {
        _items.splice(index, count);
        const merged = new Float32Array(_hgt.length - count);
        merged.set(_hgt.slice(0, index));
        merged.set(_hgt.slice(index + count));
        _hgt = merged;
        _buildOffsets();
        // Force-recycle any visible nodes in removed range
        for (let i = index; i < index + count; i++) {
          const el = _vis.get(i);
          if (el) {
            _vis.delete(i);
            _elIdx.delete(el);
            if (_cardRO) _cardRO.unobserve(el);
            if (pool) pool.release(el, _getType(i));
          }
        }
        Scheduler.schedule(_render, 'vl-remove');
      },

      /** Change active language and re-render all visible nodes. */
      setLang(newLang) {
        _lang = newLang;
        for (const [idx, el] of _vis) {
          el.innerHTML = renderFn(_items[idx], _lang);
        }
      },

      /** Force a re-render pass (e.g. after external CSS changes). */
      refresh() {
        _coOffDirty = true;
        Scheduler.schedule(_render, 'vl-refresh');
      },

      /** Scroll to a specific item index. */
      scrollToIndex(index, behavior = 'smooth') {
        const offset = _off[Math.min(index, _items.length - 1)] || 0;
        const co     = _getContainerOffset();
        if (_winMode) window.scrollTo({ top: co + offset, behavior });
        else viewport.scrollTo({ top: offset, behavior });
      },

      /** Stat snapshot for debugging. */
      stats() {
        return {
          items      : _items.length,
          visible    : _vis.size,
          totalHeight: _totalH,
          pool       : pool ? pool.stats() : null,
        };
      },

      /** Full teardown: disconnect observers, drain pool, remove DOM. */
      destroy() {
        _scrollTarget.removeEventListener('scroll', _onScroll);
        ObserverFactory.disconnect(_cardRO);
        ObserverFactory.disconnect(_vpRO);
        if (_scrollRAF) cancelAnimationFrame(_scrollRAF);
        if (_corrTimer) clearTimeout(_corrTimer);
        if (_scrollTimer) clearTimeout(_scrollTimer);
        _vis.clear();
        if (pool) pool.destroy();
        if (_spacer.parentNode) _spacer.parentNode.removeChild(_spacer);
        _rendered = false;
      },
    };

    return VL;
  }

  M.createVirtualList = createVirtualList;

})(window.UREModules = window.UREModules || {});