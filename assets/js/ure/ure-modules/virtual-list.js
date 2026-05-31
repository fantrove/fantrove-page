// Path:    assets/js/ure/ure-modules/virtual-list.js
// Purpose: Virtual scroll — list + grid, all perf systems.
//
// v1.2.0  Fast-scroll fixes (two-tier mount, partial correction, snap-correct).
// v1.3.0  Grid layout, type-avg heights, overscan, bidirectional pre-render,
//          will-change lifecycle, onScrollEnd, getVisibleRange.
// v1.4.0  Jank regression fixes — deferred will-change, inline range calc,
//          removed first-render cap boost.
// v1.5.0  Social-app grade scroll quality — three root causes addressed:
//
//  [FIX-A] Height Cache (heightCache + keyExtractor params)
//    _estimatedH() checks the Map<key,height> passed from engine.js before
//    falling back to type-average or DEFAULT_ITEM_HEIGHT. On SPA nav back,
//    heights from the previous session are available immediately, so the
//    virtual list builds correct offsets from mount — no correction storm
//    when scrolling through previously-seen items.
//    _onCardsResized() writes newly measured heights back into the cache.
//
//  [FIX-B] Scroll Anchor Protocol (_captureAnchor / _restoreAnchor)
//    Replaces the position-based "ref / oldOff / adj" approach in
//    _applyCorrection() with an anchor-based approach used by Twitter,
//    Linear, and most modern virtual lists:
//      1. Before rebuilding offsets: _captureAnchor() records the first
//         item at-or-after viewport top plus its current offset (prevTop).
//      2. Rebuild offsets from the first dirty index.
//      3. _restoreAnchor() computes delta = newTop - prevTop and calls
//         scrollBy(0, delta) synchronously.
//    Key differences from v1.4.0:
//      - Works for both list AND grid mode (single code path).
//      - Applies correction during slow/medium scroll (vel ≤ APPLY_VEL_THRESHOLD),
//        not just when scroll is idle. Fast scroll (vel > threshold) defers to
//        the scroll-idle snap-correct, same as before — avoids interrupting
//        browser momentum on mobile.
//      - Removed the `else { setTimeout(_applyCorrection, ...) }` re-queue
//        branch; the scroll-idle handler already calls _applyCorrection() as
//        a snap-correct when _minCorrIdx < Infinity.
//
//  [FIX-C] Warm Start (scrollRestorePos param)
//    When engine.js passes a saved scroll position (from sessionStorage),
//    mount() sets window.scrollTo(pos, 'instant') synchronously before the
//    first render frame so _render() reads the correct scroll position on its
//    very first call — rendering the right items without a flash or jump.

(function (M) {
  'use strict';

  const { CONFIG, Scheduler, ObserverFactory, createPool } = M;

  // Velocity threshold above which _restoreAnchor defers the scrollBy to
  // the scroll-idle flush. Prevents interrupting browser momentum on iOS.
  // Value in px/ms.
  const ANCHOR_APPLY_VEL = CONFIG.ANCHOR.APPLY_VEL_THRESHOLD;

  // ── One-time CSS ──────────────────────────────────────────────────────────
  const _VL_CSS_ID = '_ure_vl_css';
  function _ensureVLCss() {
    if (document.getElementById(_VL_CSS_ID)) return;
    const s = document.createElement('style');
    s.id = _VL_CSS_ID;
    s.textContent = `
@keyframes _ure_fi{from{opacity:0}to{opacity:1}}
.ure-new{animation:_ure_fi 0.16s cubic-bezier(0.22,1,0.36,1) both;will-change:opacity;}
.ure-new.ure-done{will-change:auto;animation:none;}`;
    document.head.appendChild(s);
  }

  // ─────────────────────────────────────────────────────────────────────────
  function createVirtualList(opts) {
    const {
      container, viewport,
      items           = [],
      renderFn,
      lang            = 'en',
      buffer          = CONFIG.RENDER.DEFAULT_BUFFER_PX,
      recycling       = true,
      poolCap         = CONFIG.RENDER.DEFAULT_POOL_CAP,
      horizontal      = false,
      columns         = CONFIG.GRID.DEFAULT_COLUMNS,
      gap             = CONFIG.GRID.DEFAULT_GAP_PX,
      overscan        = CONFIG.RENDER.DEFAULT_OVERSCAN,
      // v1.5.0 — height persistence
      heightCache     = null,   // Map<string, number> — loaded by engine.js
      keyExtractor    = null,   // (item, idx) => string|null — provided by engine.js
      scrollRestorePos = 0,     // px — saved position from sessionStorage
      onVisible, onHidden, onScrollEnd,
    } = opts;

    _ensureVLCss();

    const _H        = !!horizontal;
    const _columns  = (!_H && columns > 1) ? (columns | 0) : 1;
    const _gap      = Math.max(0, gap | 0);
    const _isGrid   = _columns > 1;
    const _overscan = Math.max(0, overscan | 0);

    // ── State ─────────────────────────────────────────────────────────────
    let _items    = items.slice();
    let _lang     = lang;
    let _rendered = false;

    let _hgt      = new Float32Array(_items.length).fill(CONFIG.RENDER.DEFAULT_ITEM_HEIGHT);
    let _measured = new Uint8Array(_items.length);
    let _seenIdx  = new Uint8Array(_items.length);

    let _off    = new Float64Array(_items.length + 1);
    let _totalH = 0;

    let _rHgt = _isGrid ? new Float32Array(Math.max(1, Math.ceil(_items.length / _columns))) : null;
    let _rOff = _isGrid ? new Float64Array(Math.max(2, Math.ceil(_items.length / _columns) + 1)) : null;

    let _cw = 0, _itemW = 0;
    let _minCorrIdx = Infinity;

    // ── Type-average height system ────────────────────────────────────────
    /** @type {Map<string, {sum:number, count:number, avg:number}>} */
    const _typeAvgHgt = new Map();

    function _updateTypeAvg(type, h) {
      const e = _typeAvgHgt.get(type);
      if (!e) { _typeAvgHgt.set(type, { sum: h, count: 1, avg: h }); return; }
      e.sum += h; e.count++; e.avg = e.sum / e.count;
    }

    /**
     * Best height estimate for an item at idx.
     * Priority: height cache (real measured) > type average > default.
     * [FIX-A] Height cache check eliminates correction storms on remount.
     */
    function _estimatedH(idx) {
      if (heightCache && keyExtractor) {
        const key = keyExtractor(_items[idx], idx);
        if (key !== null && heightCache.has(key)) return heightCache.get(key);
      }
      const type = _getType(idx);
      return _typeAvgHgt.get(type)?.avg || CONFIG.RENDER.DEFAULT_ITEM_HEIGHT;
    }

    // ── Deferred settled set (v1.4.0 FIX-1) ──────────────────────────────
    const _pendingSettled = new Set();

    // ── Device tier ───────────────────────────────────────────────────────
    const _T = (() => {
      const m = navigator.deviceMemory, c = navigator.hardwareConcurrency || 2;
      if ((m && m <= 1) || c <= 2) return 0;
      if ((m && m <= 2) || c <= 4) return 1;
      return 2;
    })();
    const _MOUNT_CAP = [4, 8, 16][_T];
    const _PRE_CAP   = _MOUNT_CAP * 3;

    const _vis      = new Map();
    const _elIdx    = new WeakMap();
    const _preCache = new Map();
    let   _preRafId = null;

    const pool = recycling ? createPool(poolCap) : null;

    // ── Axis abstraction ──────────────────────────────────────────────────
    const _scrollEl     = document.scrollingElement || document.documentElement;
    const _winMode      = (viewport === _scrollEl || viewport === document.body || viewport === window);
    const _scrollTarget = _winMode ? window : viewport;

    const _ax = {
      scrollPos()  { return _winMode ? (_H ? window.scrollX||0 : window.scrollY||0) : (_H ? viewport.scrollLeft : viewport.scrollTop); },
      viewportSz() { return _winMode ? (_H ? window.innerWidth : window.innerHeight) : (_H ? viewport.clientWidth||window.innerWidth : viewport.clientHeight||window.innerHeight); },
      spacerBase : _H ? 'position:relative;height:100%;min-height:1px;' : 'position:relative;width:100%;',
      spacerProp : _H ? 'width' : 'height',
      itemBase   : _H ? 'position:absolute;top:0;bottom:0;left:0;contain:layout style paint;' : 'position:absolute;left:0;right:0;top:0;contain:layout style paint;',
      translate  : v => _H ? `translateX(${v}px)` : `translateY(${v}px)`,
      roSize(e)  { return _H ? (e.borderBoxSize?.[0]?.inlineSize ?? e.contentRect.width) : (e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height); },
    };

    // ── Spacer ────────────────────────────────────────────────────────────
    const _spacer = document.createElement('div');
    _spacer.className   = CONFIG.DOM.SPACER_CLASS;
    _spacer.style.cssText = _ax.spacerBase;
    container.appendChild(_spacer);

    // ── Scroll velocity + state ───────────────────────────────────────────
    let _vel = 0, _velPos = 0, _velTime = 0;
    let _scrolling = false, _scrollTimer = null, _scrollRAF = null;

    // ── Container offset cache ────────────────────────────────────────────
    let _coOff = 0, _coOffDirty = true, _coOffPending = false;

    function _getContainerOffset() {
      if (!_coOffDirty) return _coOff;
      if (_winMode) {
        const r = _spacer.getBoundingClientRect();
        _coOff = _H ? r.left + (window.scrollX||0) : r.top + (window.scrollY||0);
      } else {
        const prop = _H ? 'offsetLeft' : 'offsetTop';
        let off = 0, el = _spacer;
        while (el && el !== viewport) { off += el[prop]||0; el = el.offsetParent; }
        _coOff = off;
      }
      _coOffDirty = false;
      return _coOff;
    }

    // ── Grid width ────────────────────────────────────────────────────────
    function _updateGridWidth() {
      if (!_isGrid) return;
      _cw    = container.clientWidth || window.innerWidth;
      _itemW = Math.max(1, (_cw - _gap * (_columns - 1)) / _columns);
    }

    // ── Offset system — list mode ─────────────────────────────────────────
    function _buildListOffsets() {
      const n = _items.length;
      if (_off.length !== n + 1) _off = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) _off[i + 1] = _off[i] + _hgt[i];
      _totalH = _off[n] || 0;
      _spacer.style[_ax.spacerProp] = _totalH + 'px';
    }

    function _rebuildListFrom(start) {
      start = Math.max(0, start | 0);
      const n = _items.length;
      if (_off.length !== n + 1) { _buildListOffsets(); return; }
      for (let i = start; i < n; i++) _off[i + 1] = _off[i] + _hgt[i];
      _totalH = _off[n] || 0;
      _spacer.style[_ax.spacerProp] = _totalH + 'px';
    }

    function _find(target) {
      if (!_off || _off.length < 2) return 0;
      let lo = 0, hi = _off.length - 2;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (_off[mid] <= target) lo = mid; else hi = mid - 1;
      }
      return lo;
    }

    // ── Offset system — grid mode ─────────────────────────────────────────
    function _numRows() { return _items.length > 0 ? Math.ceil(_items.length / _columns) : 0; }

    function _buildGridOffsets() {
      const rows = _numRows();
      if (rows === 0) { _totalH = 0; _spacer.style[_ax.spacerProp] = '0px'; return; }
      if (!_rHgt || _rHgt.length < rows) {
        const r2 = new Float32Array(rows).fill(CONFIG.RENDER.DEFAULT_ITEM_HEIGHT);
        if (_rHgt) r2.set(_rHgt.subarray(0, Math.min(_rHgt.length, rows)));
        _rHgt = r2;
      }
      if (!_rOff || _rOff.length !== rows + 1) _rOff = new Float64Array(rows + 1);
      for (let r = 0; r < rows; r++) {
        let maxH = 0;
        for (let c = 0; c < _columns; c++) {
          const i = r * _columns + c;
          if (i >= _items.length) break;
          const h = _measured[i] ? _hgt[i] : _estimatedH(i);
          if (h > maxH) maxH = h;
        }
        _rHgt[r] = maxH || CONFIG.RENDER.DEFAULT_ITEM_HEIGHT;
      }
      _rOff[0] = 0;
      for (let r = 0; r < rows; r++) {
        _rOff[r + 1] = _rOff[r] + _rHgt[r] + (r < rows - 1 ? _gap : 0);
      }
      _totalH = _rOff[rows] || 0;
      _spacer.style[_ax.spacerProp] = _totalH + 'px';
    }

    function _rebuildGridFrom(startRow) {
      startRow = Math.max(0, startRow | 0);
      const rows = _numRows();
      if (!_rOff || _rOff.length !== rows + 1) { _buildGridOffsets(); return; }
      for (let r = startRow; r < rows; r++) {
        let maxH = 0;
        for (let c = 0; c < _columns; c++) {
          const i = r * _columns + c;
          if (i >= _items.length) break;
          const h = _measured[i] ? _hgt[i] : _estimatedH(i);
          if (h > maxH) maxH = h;
        }
        _rHgt[r] = maxH || CONFIG.RENDER.DEFAULT_ITEM_HEIGHT;
        _rOff[r + 1] = _rOff[r] + _rHgt[r] + (r < rows - 1 ? _gap : 0);
      }
      _totalH = _rOff[rows] || 0;
      _spacer.style[_ax.spacerProp] = _totalH + 'px';
    }

    function _findRow(target) {
      if (!_rOff || _rOff.length < 2) return 0;
      let lo = 0, hi = _rOff.length - 2;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (_rOff[mid] <= target) lo = mid; else hi = mid - 1;
      }
      return lo;
    }

    // ── Unified delegates ─────────────────────────────────────────────────
    function _buildOffsets() { _isGrid ? _buildGridOffsets() : _buildListOffsets(); }

    function _rebuildFrom(startIdxOrRow) {
      _isGrid ? _rebuildGridFrom(startIdxOrRow) : _rebuildListFrom(startIdxOrRow);
    }

    // ── Grid transform ────────────────────────────────────────────────────
    function _gridTransform(i) {
      const row = (i / _columns) | 0;
      const y   = (_rOff && _rOff[row]) || 0;
      const x   = (i % _columns) * (_itemW + _gap);
      return `translate(${x}px,${y}px)`;
    }

    function _updateItemTransform(i, el) {
      if (_isGrid) {
        const t = _gridTransform(i);
        if (el.style.transform !== t) el.style.transform = t;
        if (_itemW > 0 && el.style.width !== _itemW + 'px') el.style.width = _itemW + 'px';
      } else {
        const t = _ax.translate(_off[i]);
        if (el.style.transform !== t) el.style.transform = t;
      }
    }

    // ── Effective buffer ──────────────────────────────────────────────────
    function _effectiveBuf() {
      if (_overscan < 1) return buffer;
      let sum = 0, cnt = 0;
      for (const [, v] of _typeAvgHgt) { sum += v.avg * v.count; cnt += v.count; }
      const avgH = cnt > 0 ? sum / cnt : CONFIG.RENDER.DEFAULT_ITEM_HEIGHT;
      return Math.max(buffer, _overscan * avgH);
    }

    // ── Idle pre-render — bidirectional, velocity-aware ───────────────────
    function _schedulePreRender(si, ei) {
      if (_preRafId) return;
      const vel      = _vel;
      const goingFwd = vel >= 0;
      const half     = Math.ceil(_PRE_CAP / 2);

      const aheadS = goingFwd ? ei + 1                              : Math.max(0, si - _PRE_CAP);
      const aheadE = goingFwd ? Math.min(_items.length - 1, ei + _PRE_CAP) : si - 1;
      const behinS = goingFwd ? Math.max(0, si - half)              : ei + 1;
      const behinE = goingFwd ? si - 1                              : Math.min(_items.length - 1, ei + half);

      const doIdle = typeof requestIdleCallback !== 'undefined'
        ? fn => { _preRafId = requestIdleCallback(fn, { timeout: 300 }); }
        : fn => { _preRafId = setTimeout(fn, 50); };

      doIdle(dl => {
        _preRafId = null;
        const hasTime = dl?.timeRemaining ? () => dl.timeRemaining() > 1 : () => true;
        const cache = (s, e) => {
          for (let i = s; i <= e && hasTime(); i++) {
            if (_vis.has(i) || _preCache.has(i) || !_items[i]) continue;
            if (_preCache.size >= _PRE_CAP) return;
            _preCache.set(i, renderFn(_items[i], _lang));
          }
        };
        cache(Math.min(aheadS, aheadE), Math.max(aheadS, aheadE));
        cache(Math.min(behinS, behinE), Math.max(behinS, behinE));
      });
    }

    // ── Scroll anchor protocol (v1.5.0 FIX-B) ────────────────────────────

    /**
     * Capture the "scroll anchor" — the first item at-or-after viewport top
     * and its current offset — BEFORE rebuilding offsets.
     *
     * Both list and grid mode are handled. Returns null when the list is empty.
     * @returns {{ idx: number, row: number, prevTop: number } | null}
     */
    function _captureAnchor() {
      if (_items.length === 0) return null;
      const st   = _ax.scrollPos();
      const co   = _getContainerOffset();
      const vTop = Math.max(0, st - co);

      if (_isGrid) {
        const row = _findRow(vTop);
        const idx = Math.min(row * _columns, _items.length - 1);
        return { idx, row, prevTop: (_rOff && _rOff[row]) || 0 };
      }
      const idx = Math.min(_find(vTop), _items.length - 1);
      return { idx, row: 0, prevTop: (_off && _off[idx]) || 0 };
    }

    /**
     * Restore scroll position after a height correction by computing the
     * delta between the anchor's old and new offset and calling scrollBy.
     *
     * Skips the scrollBy when velocity exceeds ANCHOR_APPLY_VEL to avoid
     * interrupting browser momentum scroll on iOS. The scroll-idle snap-correct
     * will flush any deferred correction when the user stops scrolling.
     * @param {{ idx: number, row: number, prevTop: number } | null} anchor
     */
    function _restoreAnchor(anchor) {
      if (!anchor) return;
      const newTop = _isGrid
        ? ((_rOff && _rOff[anchor.row]) || 0)
        : ((_off  && _off[anchor.idx])  || 0);
      const delta = newTop - anchor.prevTop;
      if (Math.abs(delta) < 0.5) return;
      // Defer during fast scroll — momentum must not be interrupted
      if (Math.abs(_vel) > ANCHOR_APPLY_VEL) return;
      if (_winMode) {
        _H ? window.scrollBy(delta, 0) : window.scrollBy(0, delta);
      } else {
        if (_H) viewport.scrollLeft += delta;
        else    viewport.scrollTop  += delta;
      }
    }

    // ── Mount node ────────────────────────────────────────────────────────
    function _mountNode(i, frag, applyStagger, staggerIndex) {
      const el = pool ? pool.acquire(_getType(i)) : document.createElement('div');
      el.className = CONFIG.DOM.VISIBLE_CLASS;
      el.style.cssText = _isGrid
        ? `position:absolute;top:0;left:0;width:${_itemW}px;contain:layout style paint;transform:${_gridTransform(i)};`
        : `${_ax.itemBase}transform:${_ax.translate(_off[i])};`;
      el.setAttribute(CONFIG.DOM.ITEM_ATTR, i);
      el.innerHTML = _preCache.get(i) ?? renderFn(_items[i], _lang);
      _preCache.delete(i);

      if (!_seenIdx[i]) {
        _seenIdx[i] = 1;
        el.classList.add('ure-new');
        el.style.animationDelay = (applyStagger && staggerIndex > 0) ? `${staggerIndex * 18}ms` : '';
        el.addEventListener('animationend', () => {
          el.classList.remove('ure-new');
          el.classList.add('ure-done');
          el.style.animationDelay = '';
        }, { once: true, passive: true });
      }

      frag.appendChild(el);
      _vis.set(i, el);
      _elIdx.set(el, i);
      if (_cardRO && !_measured[i]) _cardRO.observe(el);
      if (onVisible) try { onVisible(_items[i], el); } catch (_) {}
    }

    // ── Render ────────────────────────────────────────────────────────────
    function _render() {
      if (!_spacer.isConnected) return;

      const st  = _ax.scrollPos();
      const vh  = _ax.viewportSz();
      const co  = _getContainerOffset();
      const vel = _vel;

      const buf       = _effectiveBuf();
      const fast      = Math.abs(vel) > 0.3;
      const bufAhead  = fast ? buf * 1.6 : buf;
      const bufBehind = fast ? buf * 0.4 : buf;

      const vpFrom = st - co;
      const vpTo   = st - co + vh;
      const from   = vpFrom - (vel >= 0 ? bufBehind : bufAhead);
      const to     = vpTo   + (vel >= 0 ? bufAhead  : bufBehind);

      // [v1.4.0 FIX-2] Inline range calculations — no object allocation per frame
      let vsi, vei, si, ei;
      if (_isGrid) {
        const nr  = _numRows();
        const vr1 = _findRow(Math.max(0, vpFrom));
        const vr2 = Math.min(nr - 1, _findRow(Math.max(0, vpTo)) + 1);
        vsi = vr1 * _columns;
        vei = Math.min(_items.length - 1, (vr2 + 1) * _columns - 1);
        const r1 = _findRow(Math.max(0, from));
        const r2 = Math.min(nr - 1, _findRow(Math.max(0, to)) + 1);
        si  = r1 * _columns;
        ei  = Math.min(_items.length - 1, (r2 + 1) * _columns - 1);
      } else {
        vsi = _find(Math.max(0, vpFrom));
        vei = Math.min(_items.length - 1, _find(Math.max(0, vpTo)) + 1);
        si  = _find(Math.max(0, from));
        ei  = Math.min(_items.length - 1, _find(Math.max(0, to)) + 1);
      }

      // ── Recycle out-of-range items ──────────────────────────────────────
      const toRecycle = [];
      for (const [idx, el] of _vis) {
        if (idx < si || idx > ei) toRecycle.push([idx, el]);
      }
      for (const [idx, el] of toRecycle) {
        _vis.delete(idx); _elIdx.delete(el);
        if (_cardRO) _cardRO.unobserve(el);
        if (onHidden) try { onHidden(_items[idx]); } catch (_) {}
        _pendingSettled.delete(el); // [v1.4.0 FIX-1]
        if (pool) pool.release(el, _getType(idx));
        else if (el.parentNode) el.parentNode.removeChild(el);
      }

      const frag       = document.createDocumentFragment();
      const slowScroll = Math.abs(vel) < 0.5;
      let staggerCount = 0;

      // Pass 1: viewport — mount all, no cap
      for (let i = vsi; i <= vei; i++) {
        if (_vis.has(i)) continue;
        _mountNode(i, frag, slowScroll, staggerCount < 5 ? staggerCount++ : -1);
      }

      // Pass 2: buffer zone — capped per frame [v1.4.0 FIX-3]
      let bufMounts = 0;
      for (let i = si; i <= ei; i++) {
        if (_vis.has(i)) continue;
        if (bufMounts >= _MOUNT_CAP) {
          if (!_scrollRAF) _scrollRAF = requestAnimationFrame(() => { _scrollRAF = null; _render(); });
          break;
        }
        _mountNode(i, frag, false, -1);
        bufMounts++;
      }

      if (frag.hasChildNodes()) _spacer.appendChild(frag);
      _schedulePreRender(si, ei);
    }

    // ── ResizeObserver callbacks ──────────────────────────────────────────
    let _cardRO = null, _vpRO = null, _corrTimer = null, _lastCorr = 0;

    function _onCardsResized(entries) {
      let dirty = false;
      for (const entry of entries) {
        const idx = _elIdx.get(entry.target);
        if (idx === undefined) continue;
        const h = _ax.roSize(entry);
        if (h <= 4) continue;

        if (Math.abs(h - _hgt[idx]) > 2) {
          _hgt[idx] = h; _measured[idx] = 0;
          if (idx < _minCorrIdx) _minCorrIdx = idx;
          dirty = true;
        } else if (!_measured[idx]) {
          _measured[idx] = 1;
          _updateTypeAvg(_getType(idx), h);
          if (_cardRO) try { _cardRO.unobserve(entry.target); } catch (_) {}

          // [v1.5.0 FIX-A] Write measured height to persistent cache so it's
          // available on the next remount without needing another correction.
          if (heightCache && keyExtractor) {
            const key = keyExtractor(_items[idx], idx);
            if (key !== null) heightCache.set(key, h);
          }

          // [v1.4.0 FIX-1] Defer will-change removal to after scroll idle
          _pendingSettled.add(entry.target);
        }
      }
      if (!dirty || _corrTimer) return;
      const elapsed = performance.now() - _lastCorr;
      const wait    = elapsed >= CONFIG.TIMING.HEIGHT_CORRECTION_RATE_MS ? 0
                    : CONFIG.TIMING.HEIGHT_CORRECTION_RATE_MS - elapsed;
      _corrTimer = setTimeout(_applyCorrection, wait);
    }

    // ── Height correction (v1.5.0 FIX-B) ─────────────────────────────────
    //
    // Rewritten to use the anchor protocol:
    //   1. Capture anchor (first item at-or-after viewport top + its offset)
    //   2. Rebuild offsets from the first dirty index
    //   3. Update transforms for all visible items
    //   4. Restore scroll via scrollBy(delta) — velocity-gated
    //
    // Removed: the `else { setTimeout(_applyCorrection, ...) }` re-queue
    // branch. The scroll-idle handler already performs a snap-correct flush
    // when _minCorrIdx < Infinity, so pending corrections are never lost.
    function _applyCorrection() {
      _corrTimer = null;
      _lastCorr  = performance.now();

      // 1. Capture anchor BEFORE rebuilding (reads current offsets)
      const anchor = _captureAnchor();

      // 2. Rebuild from first dirty index
      if (_isGrid) {
        const dirtyRow = _minCorrIdx === Infinity ? 0 : (_minCorrIdx / _columns | 0);
        _rebuildGridFrom(dirtyRow);
      } else {
        _rebuildListFrom(_minCorrIdx === Infinity ? 0 : _minCorrIdx);
      }
      _minCorrIdx = Infinity;

      // 3. Update all visible transforms
      for (const [idx, el] of _vis) _updateItemTransform(idx, el);

      // 4. Restore scroll (velocity-gated — deferred by _restoreAnchor when fast)
      _restoreAnchor(anchor);

      Scheduler.schedule(_render, 'vl-post-correction');
    }

    // ── Scroll handler ────────────────────────────────────────────────────
    function _onScroll() {
      const now = performance.now(), pos = _ax.scrollPos(), dt = now - _velTime;
      if (dt > 0 && dt < 150) _vel = (pos - _velPos) / dt;
      _velPos = pos; _velTime = now;
      _scrolling = true;
      clearTimeout(_scrollTimer);

      _scrollTimer = setTimeout(() => {
        _scrolling = false;
        _vel = 0;

        if (_coOffPending) { _coOffPending = false; _coOffDirty = true; }

        // Snap-correct: flush any corrections deferred during fast scroll
        if (_minCorrIdx < Infinity) {
          if (_corrTimer) { clearTimeout(_corrTimer); _corrTimer = null; }
          _applyCorrection();
        } else {
          Scheduler.schedule(_render, 'vl-scroll-end');
        }

        // [v1.4.0 FIX-1] Deferred will-change lifecycle flush
        if (_pendingSettled.size > 0) {
          Scheduler.schedule(() => {
            for (const el of _pendingSettled) {
              if (_vis.has(_elIdx.get(el) ?? -1)) {
                el.classList.add(CONFIG.DOM.SETTLED_CLASS);
              }
            }
            _pendingSettled.clear();
          }, 'vl-settled-flush');
        }

        if (onScrollEnd) try { onScrollEnd(); } catch (_) {}
      }, CONFIG.TIMING.SCROLL_IDLE_MS);

      if (_scrollRAF) return;
      _scrollRAF = requestAnimationFrame(() => { _scrollRAF = null; _render(); });
    }

    // ── Helpers ───────────────────────────────────────────────────────────
    function _getType(idx) {
      const item = _items[idx];
      if (!item || typeof item !== 'object') return 'item';
      return item._ureType || item.type || 'item';
    }

    function _growArrays(n) {
      if (_hgt.length >= n) return;
      const h2 = new Float32Array(n);
      h2.set(_hgt);
      for (let i = _hgt.length; i < n; i++) h2[i] = _estimatedH(i);
      _hgt = h2;
      const m2 = new Uint8Array(n); m2.set(_measured); _measured = m2;
      const s2 = new Uint8Array(n); s2.set(_seenIdx);  _seenIdx  = s2;
    }

    // ── Public ────────────────────────────────────────────────────────────
    const VL = {

      mount() {
        if (_rendered) return;
        _rendered = true;
        if (_isGrid) _updateGridWidth();

        // [FIX-A] _buildOffsets() now uses heightCache via _estimatedH(),
        // so the spacer starts at approximately the correct total height.
        _buildOffsets();

        _cardRO = ObserverFactory.createRO(_onCardsResized);

        _vpRO = ObserverFactory.createRO(() => {
          if (_isGrid) {
            _updateGridWidth();
            for (const [idx, el] of _vis) _updateItemTransform(idx, el);
            _buildGridOffsets();
          }
          if (_scrolling) {
            _coOffPending = true;
          } else {
            _coOffDirty = true;
            Scheduler.schedule(_render, 'vl-resize');
          }
        });

        if (_vpRO) _vpRO.observe(_winMode ? document.body : viewport);

        // [FIX-C] Warm start: set scroll synchronously before the first rAF
        // so _render() reads the correct scroll position on its first call,
        // rendering the right items without a cold-start flash.
        // scrollTo with 'instant' updates window.scrollY synchronously.
        if (scrollRestorePos > 0) {
          if (_winMode) {
            _H
              ? window.scrollTo({ left: scrollRestorePos, behavior: 'instant' })
              : window.scrollTo({ top : scrollRestorePos, behavior: 'instant' });
          } else {
            if (_H) viewport.scrollLeft = scrollRestorePos;
            else    viewport.scrollTop  = scrollRestorePos;
          }
        }

        _scrollTarget.addEventListener('scroll', _onScroll, { passive: true });
        Scheduler.schedule(_render, 'vl-initial');
      },

      setItems(newItems) {
        _items = newItems.slice();
        const n = _items.length;
        _hgt = new Float32Array(n);
        // [FIX-A] Use cached heights for newly set items where available
        for (let i = 0; i < n; i++) _hgt[i] = _estimatedH(i);
        _measured   = new Uint8Array(n);
        _seenIdx    = new Uint8Array(n);
        _minCorrIdx = Infinity;
        _preCache.clear();
        _pendingSettled.clear();
        _buildOffsets();
        for (const [, el] of _vis) {
          if (_cardRO) _cardRO.unobserve(el);
          if (pool) pool.release(el, 'item'); else if (el.parentNode) el.parentNode.removeChild(el);
        }
        _vis.clear();
        Scheduler.schedule(_render, 'vl-set-items');
      },

      updateItem(index, newData) {
        if (index < 0 || index >= _items.length) return;
        _items[index] = newData; _measured[index] = 0; _preCache.delete(index);
        const el = _vis.get(index);
        if (el) { el.innerHTML = renderFn(newData, _lang); if (_cardRO) _cardRO.observe(el); }
      },

      insertAt(index, newItems) {
        _items.splice(index, 0, ...newItems);
        const len = newItems.length;
        const xh  = new Float32Array(len);
        // [FIX-A] Use cached heights for inserted items where available
        for (let i = 0; i < len; i++) xh[i] = _estimatedH(index + i);
        const mh = new Float32Array(_hgt.length + len);
        mh.set(_hgt.slice(0, index)); mh.set(xh, index); mh.set(_hgt.slice(index), index + len);
        _hgt = mh;
        const mm = new Uint8Array(_measured.length + len);
        mm.set(_measured.slice(0, index)); mm.set(_measured.slice(index), index + len); _measured = mm;
        const ms = new Uint8Array(_seenIdx.length + len);
        ms.set(_seenIdx.slice(0, index)); ms.set(_seenIdx.slice(index), index + len); _seenIdx = ms;
        _rebuildFrom(_isGrid ? (index / _columns | 0) : index);
        Scheduler.schedule(_render, 'vl-insert');
      },

      removeAt(index, count = 1) {
        _items.splice(index, count);
        const mh = new Float32Array(_hgt.length - count);
        mh.set(_hgt.slice(0, index)); mh.set(_hgt.slice(index + count)); _hgt = mh;
        const mm = new Uint8Array(_measured.length - count);
        mm.set(_measured.slice(0, index)); mm.set(_measured.slice(index + count)); _measured = mm;
        const ms = new Uint8Array(_seenIdx.length - count);
        ms.set(_seenIdx.slice(0, index)); ms.set(_seenIdx.slice(index + count)); _seenIdx = ms;
        for (let i = index; i < index + count; i++) {
          const el = _vis.get(i);
          if (el) {
            _vis.delete(i); _elIdx.delete(el);
            _pendingSettled.delete(el);
            if (_cardRO) _cardRO.unobserve(el);
            if (pool) pool.release(el, _getType(i));
          }
        }
        _rebuildFrom(_isGrid ? (index / _columns | 0) : index);
        Scheduler.schedule(_render, 'vl-remove');
      },

      setLang(newLang) {
        _lang = newLang; _preCache.clear();
        for (const [idx, el] of _vis) el.innerHTML = renderFn(_items[idx], _lang);
      },

      refresh() {
        if (_isGrid) { _updateGridWidth(); _buildGridOffsets(); }
        _coOffDirty = true;
        Scheduler.schedule(_render, 'vl-refresh');
      },

      scrollToIndex(index, behavior = 'smooth') {
        let offset;
        if (_isGrid) {
          const row = (Math.min(Math.max(0, index), _items.length - 1) / _columns) | 0;
          offset = (_rOff && _rOff[row]) || 0;
        } else {
          offset = (_off && _off[Math.min(Math.max(0, index), _items.length - 1)]) || 0;
        }
        const co = _getContainerOffset();
        if (_winMode) { _H ? window.scrollTo({ left: co + offset, behavior }) : window.scrollTo({ top: co + offset, behavior }); }
        else { if (_H) viewport.scrollLeft = offset; else viewport.scrollTo({ top: offset, behavior }); }
      },

      getVisibleRange() {
        if (_vis.size === 0) return { startIndex: -1, endIndex: -1 };
        let min = Infinity, max = -Infinity;
        for (const [idx] of _vis) {
          if (idx < min) min = idx;
          if (idx > max) max = idx;
        }
        return { startIndex: min, endIndex: max };
      },

      stats() {
        const stable = _measured.reduce((n, v) => n + v, 0);
        return {
          items: _items.length, visible: _vis.size, totalSize: _totalH,
          stable, unstable: _items.length - stable,
          preCached: _preCache.size,
          pendingSettled: _pendingSettled.size,
          mountCap: _MOUNT_CAP, horizontal: _H,
          isGrid: _isGrid, columns: _columns, gap: _gap,
          typeAvgCount: _typeAvgHgt.size,
          cachedHeights: heightCache ? heightCache.size : 0,
          pool: pool ? pool.stats() : null,
        };
      },

      destroy() {
        _scrollTarget.removeEventListener('scroll', _onScroll);
        ObserverFactory.disconnect(_cardRO); ObserverFactory.disconnect(_vpRO);
        if (_scrollRAF) cancelAnimationFrame(_scrollRAF);
        if (_corrTimer) clearTimeout(_corrTimer);
        if (_scrollTimer) clearTimeout(_scrollTimer);
        if (_preRafId) { typeof cancelIdleCallback !== 'undefined' ? cancelIdleCallback(_preRafId) : clearTimeout(_preRafId); }
        _vis.clear(); _preCache.clear(); _pendingSettled.clear();
        if (pool) pool.destroy();
        if (_spacer.parentNode) _spacer.parentNode.removeChild(_spacer);
        _rendered = false;
      },
    };

    return VL;
  }

  M.createVirtualList = createVirtualList;

})(window.UREModules = window.UREModules || {});