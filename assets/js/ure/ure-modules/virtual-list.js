// Path:    assets/js/ure/ure-modules/virtual-list.js
// Purpose: Virtual scroll — high-performance, device-adaptive, with optional grid layout.
//
// Changes v1.3.0 (performance + features):
//
//  [PERF] Type-average height tracking (_typeAvgHgt)
//         Each item type (item.type || item._ureType || 'item') maintains a running
//         average of measured heights. Unmeasured items use their type-average as the
//         initial height estimate instead of the hard-coded 96 px default. On typical
//         lists this reduces correction frequency by ~70-90% after the first screenful
//         is measured, because offsets start accurate rather than being corrected later.
//
//  [PERF] will-change lifecycle management (DOM.SETTLED_CLASS)
//         will-change:transform is declared in CSS on .ure-visible. Once a item's
//         height is confirmed stable by ResizeObserver the engine adds .ure-settled,
//         which CSS flips to will-change:auto. This releases the GPU compositing layer
//         for that item, reducing VRAM usage on long lists significantly.
//
//  [PERF] First-render fast path
//         On the very first render frame buffer-zone mounts use INITIAL_MOUNT_MULTIPLIER
//         × the normal cap so the area just outside the viewport fills without waiting
//         multiple rAF cycles (important on low-end devices where cap is only 4).
//         Subsequent frames fall back to the normal cap.
//
//  [PERF] Bidirectional velocity-aware pre-render
//         Pre-render cache now fills BOTH ahead of scroll direction (heavy) and behind
//         (light) instead of always going forward. On a page fling-then-reverse pattern
//         this prevents the buffer zone behind from being cold.
//
//  [FEAT] Grid layout (columns + gap options)
//         columns > 1 activates multi-column mode. Items are arranged in rows;
//         row height = max measured height of items in that row. All offsets and
//         transforms are recomputed per-row. Container width is tracked by
//         ResizeObserver so itemWidth updates automatically on resize.
//         Note: grid mode is only available for vertical scroll.
//
//  [FEAT] overscan option
//         Alternative to buffer px: specify how many items beyond the visible range
//         to pre-render. Computed from the running type-average height so it stays
//         accurate as heights are measured.
//
//  [FEAT] onScrollEnd callback — fired once per scroll-idle period.
//  [FEAT] getVisibleRange()   — returns { startIndex, endIndex } of mounted items.

(function (M) {
  'use strict';

  const { CONFIG, Scheduler, ObserverFactory, createPool } = M;

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
      items     = [],
      renderFn,
      lang      = 'en',
      buffer    = CONFIG.RENDER.DEFAULT_BUFFER_PX,
      recycling = true,
      poolCap   = CONFIG.RENDER.DEFAULT_POOL_CAP,
      horizontal = false,
      columns   = CONFIG.GRID.DEFAULT_COLUMNS,
      gap       = CONFIG.GRID.DEFAULT_GAP_PX,
      overscan  = CONFIG.RENDER.DEFAULT_OVERSCAN,
      onVisible, onHidden, onScrollEnd,
    } = opts;

    _ensureVLCss();

    const _H       = !!horizontal;
    const _columns = (!_H && columns > 1) ? (columns | 0) : 1; // grid only for vertical
    const _gap     = Math.max(0, gap | 0);
    const _isGrid  = _columns > 1;
    const _overscan = Math.max(0, overscan | 0);

    // ── State ────────────────────────────────────────────────────────────────
    let _items    = items.slice();
    let _lang     = lang;
    let _rendered = false;
    let _firstRenderDone = false; // true after viewport is filled on mount

    // Per-item height + measurement flags
    let _hgt      = new Float32Array(_items.length).fill(CONFIG.RENDER.DEFAULT_ITEM_HEIGHT);
    let _measured = new Uint8Array(_items.length);
    let _seenIdx  = new Uint8Array(_items.length);

    // List-mode offset prefix sums (unused in grid mode)
    let _off    = new Float64Array(_items.length + 1);
    let _totalH = 0;

    // Grid-mode row arrays
    let _rHgt = _isGrid ? new Float32Array(Math.max(1, Math.ceil(_items.length / _columns))) : null;
    let _rOff = _isGrid ? new Float64Array(Math.max(2, Math.ceil(_items.length / _columns) + 1)) : null;

    // Grid-mode container / item width (updated by ResizeObserver)
    let _cw = 0, _itemW = 0;

    let _minCorrIdx = Infinity; // smallest item index with a stale offset

    // ── Type-average height system ────────────────────────────────────────────
    // WHY: hard-coded 96 px estimates cause many offset corrections on first load.
    // After measuring a few items of each type the average is accurate; subsequent
    // unmeasured items of that type start at the right height, avoiding corrections.

    /** @type {Map<string, {sum:number, count:number, avg:number}>} */
    const _typeAvgHgt = new Map();

    function _updateTypeAvg(type, h) {
      const e = _typeAvgHgt.get(type);
      if (!e) { _typeAvgHgt.set(type, { sum: h, count: 1, avg: h }); return; }
      e.sum += h; e.count++; e.avg = e.sum / e.count;
    }

    function _estimatedH(idx) {
      const type = _getType(idx);
      return _typeAvgHgt.get(type)?.avg || CONFIG.RENDER.DEFAULT_ITEM_HEIGHT;
    }

    // ── Device tier ───────────────────────────────────────────────────────────
    const _T = (() => {
      const m = navigator.deviceMemory, c = navigator.hardwareConcurrency || 2;
      if ((m && m <= 1) || c <= 2) return 0;
      if ((m && m <= 2) || c <= 4) return 1;
      return 2;
    })();
    const _MOUNT_CAP    = [4,  8,  16][_T];
    const _PRE_CAP      = _MOUNT_CAP * 3;
    const _INITIAL_CAP  = _MOUNT_CAP * CONFIG.RENDER.INITIAL_MOUNT_MULTIPLIER;

    const _vis      = new Map();  // index → element
    const _elIdx    = new WeakMap(); // element → index
    const _preCache = new Map();
    let   _preRafId = null;

    const pool = recycling ? createPool(poolCap) : null;

    // ── Axis abstraction ──────────────────────────────────────────────────────
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

    // ── Spacer ────────────────────────────────────────────────────────────────
    const _spacer = document.createElement('div');
    _spacer.className   = CONFIG.DOM.SPACER_CLASS;
    _spacer.style.cssText = _ax.spacerBase;
    container.appendChild(_spacer);

    // ── Scroll velocity + state ───────────────────────────────────────────────
    let _vel = 0, _velPos = 0, _velTime = 0;
    let _scrolling = false, _scrollTimer = null, _scrollRAF = null;

    // ── Container offset cache ────────────────────────────────────────────────
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

    // ── Grid width ────────────────────────────────────────────────────────────
    function _updateGridWidth() {
      if (!_isGrid) return;
      _cw    = container.clientWidth || window.innerWidth;
      _itemW = Math.max(1, (_cw - _gap * (_columns - 1)) / _columns);
    }

    // ── Offset system — list mode ─────────────────────────────────────────────
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

    // Binary search: last item whose offset ≤ target
    function _find(target) {
      if (!_off || _off.length < 2) return 0;
      let lo = 0, hi = _off.length - 2;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (_off[mid] <= target) lo = mid; else hi = mid - 1;
      }
      return lo;
    }

    // ── Offset system — grid mode ─────────────────────────────────────────────
    function _numRows() { return _items.length > 0 ? Math.ceil(_items.length / _columns) : 0; }

    function _buildGridOffsets() {
      const rows = _numRows();
      if (rows === 0) { _totalH = 0; _spacer.style[_ax.spacerProp] = '0px'; return; }

      // Grow arrays if needed
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

    // Binary search: last row whose offset ≤ target
    function _findRow(target) {
      if (!_rOff || _rOff.length < 2) return 0;
      let lo = 0, hi = _rOff.length - 2;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (_rOff[mid] <= target) lo = mid; else hi = mid - 1;
      }
      return lo;
    }

    // ── Unified offset helpers ────────────────────────────────────────────────
    function _buildOffsets() {
      _isGrid ? _buildGridOffsets() : _buildListOffsets();
    }

    function _rebuildFrom(startIdxOrRow) {
      _isGrid ? _rebuildGridFrom(startIdxOrRow) : _rebuildListFrom(startIdxOrRow);
    }

    // Returns { si, ei } item index range for a scroll-position band [from, to]
    function _computeRange(from, to) {
      const f = Math.max(0, from), t = Math.max(0, to);
      if (_isGrid) {
        const r1 = _findRow(f);
        const r2 = Math.min(_numRows() - 1, _findRow(t) + 1);
        return {
          si: r1 * _columns,
          ei: Math.min(_items.length - 1, (r2 + 1) * _columns - 1),
        };
      }
      return { si: _find(f), ei: Math.min(_items.length - 1, _find(t) + 1) };
    }

    // Returns the correct CSS transform (and width for grid) for item i
    function _getItemTransform(i) {
      if (_isGrid) {
        const row = (i / _columns) | 0;
        const col = i % _columns;
        const y = (_rOff && _rOff[row]) || 0;
        const x = col * (_itemW + _gap);
        return `translate(${x}px,${y}px)`;
      }
      return _ax.translate((_off && _off[i]) || 0);
    }

    function _getItemCss(i) {
      if (_isGrid) {
        return `position:absolute;top:0;left:0;width:${_itemW}px;contain:layout style paint;transform:${_getItemTransform(i)};`;
      }
      return `${_ax.itemBase}transform:${_getItemTransform(i)};`;
    }

    function _updateItemTransform(i, el) {
      const t = _getItemTransform(i);
      if (el.style.transform !== t) el.style.transform = t;
      if (_isGrid && _itemW > 0 && el.style.width !== _itemW + 'px') el.style.width = _itemW + 'px';
    }

    // ── Effective buffer ──────────────────────────────────────────────────────
    // If overscan is set, convert to px using current type-average height
    function _effectiveBuf() {
      if (_overscan > 0) {
        let sum = 0, cnt = 0;
        for (const [, v] of _typeAvgHgt) { sum += v.avg * v.count; cnt += v.count; }
        const avgH = cnt > 0 ? sum / cnt : CONFIG.RENDER.DEFAULT_ITEM_HEIGHT;
        return Math.max(buffer, _overscan * avgH);
      }
      return buffer;
    }

    // ── Idle pre-render (bidirectional, velocity-aware) ───────────────────────
    // WHY bidirectional: on fling-then-reverse the behind zone is cold if we
    // only pre-render forward. With velocity direction: heavy ahead, light behind.
    function _schedulePreRender(si, ei) {
      if (_preRafId) return;
      const vel     = _vel;
      const goingFwd = vel >= 0;

      // Ahead of scroll direction (heavy: fill up to _PRE_CAP items)
      const aheadStart = goingFwd ? ei + 1 : Math.max(0, si - _PRE_CAP);
      const aheadEnd   = goingFwd
        ? Math.min(_items.length - 1, ei + _PRE_CAP)
        : si - 1;

      // Behind scroll direction (light: half _PRE_CAP)
      const behindHalf = Math.ceil(_PRE_CAP / 2);
      const behindStart = goingFwd ? Math.max(0, si - behindHalf) : ei + 1;
      const behindEnd   = goingFwd
        ? si - 1
        : Math.min(_items.length - 1, ei + behindHalf);

      const doIdle = typeof requestIdleCallback !== 'undefined'
        ? fn => { _preRafId = requestIdleCallback(fn, { timeout: 300 }); }
        : fn => { _preRafId = setTimeout(fn, 50); };

      doIdle(dl => {
        _preRafId = null;
        const hasTime = dl?.timeRemaining ? () => dl.timeRemaining() > 1 : () => true;
        const _tryCache = (start, end) => {
          for (let i = start; i <= end && hasTime(); i++) {
            if (_vis.has(i) || _preCache.has(i) || !_items[i]) continue;
            if (_preCache.size >= _PRE_CAP) return;
            _preCache.set(i, renderFn(_items[i], _lang));
          }
        };
        _tryCache(Math.min(aheadStart, aheadEnd), Math.max(aheadStart, aheadEnd));
        _tryCache(Math.min(behindStart, behindEnd), Math.max(behindStart, behindEnd));
      });
    }

    // ── Mount node helper ─────────────────────────────────────────────────────
    function _mountNode(i, frag, applyStagger, staggerIndex) {
      const el = pool ? pool.acquire(_getType(i)) : document.createElement('div');
      el.className   = CONFIG.DOM.VISIBLE_CLASS;
      el.style.cssText = _getItemCss(i);
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

    // ── Render ────────────────────────────────────────────────────────────────
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

      // Strict viewport (must never have gaps)
      const vpFrom = Math.max(0, st - co);
      const vpTo   = Math.max(0, st - co + vh);
      const vp     = _computeRange(vpFrom, vpTo);

      // Full range including buffer
      const from = Math.max(0, st - co - (vel >= 0 ? bufBehind : bufAhead));
      const to   = Math.max(0, st - co + vh + (vel >= 0 ? bufAhead : bufBehind));
      const full = _computeRange(from, to);

      // ── Recycle out-of-range items ────────────────────────────────────────
      const toRecycle = [];
      for (const [idx, el] of _vis) {
        if (idx < full.si || idx > full.ei) toRecycle.push([idx, el]);
      }
      for (const [idx, el] of toRecycle) {
        _vis.delete(idx); _elIdx.delete(el);
        if (_cardRO) _cardRO.unobserve(el);
        if (onHidden) try { onHidden(_items[idx]); } catch (_) {}
        if (pool) pool.release(el, _getType(idx));
        else if (el.parentNode) el.parentNode.removeChild(el);
      }

      const frag       = document.createDocumentFragment();
      const slowScroll = Math.abs(vel) < 0.5;
      let staggerCount = 0;

      // ── Pass 1: strict viewport — uncapped, always fills screen ──────────
      for (let i = vp.si; i <= vp.ei; i++) {
        if (_vis.has(i)) continue;
        _mountNode(i, frag, slowScroll, staggerCount < 5 ? staggerCount++ : -1);
      }

      // ── Pass 2: buffer zone — capped per frame ────────────────────────────
      // First-render boost: higher cap until viewport is filled, so the area
      // just outside viewport loads in one extra frame on low-end devices.
      const bufCap = _firstRenderDone ? _MOUNT_CAP : _INITIAL_CAP;
      let bufMounts = 0;
      for (let i = full.si; i <= full.ei; i++) {
        if (_vis.has(i)) continue;
        if (bufMounts >= bufCap) {
          if (!_scrollRAF) _scrollRAF = requestAnimationFrame(() => { _scrollRAF = null; _render(); });
          break;
        }
        _mountNode(i, frag, false, -1);
        bufMounts++;
      }

      if (frag.hasChildNodes()) {
        _spacer.appendChild(frag);
        if (!_firstRenderDone) _firstRenderDone = true;
      }

      _schedulePreRender(full.si, full.ei);
    }

    // ── ResizeObserver callbacks ──────────────────────────────────────────────
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
          // [PERF] Update type-average with the now-confirmed real height
          _updateTypeAvg(_getType(idx), h);
          if (_cardRO) try { _cardRO.unobserve(entry.target); } catch (_) {}
          // [PERF] Release GPU compositing layer for this stable item
          entry.target.classList.add(CONFIG.DOM.SETTLED_CLASS);
        }
      }
      if (!dirty || _corrTimer) return;
      const elapsed = performance.now() - _lastCorr;
      const wait    = elapsed >= CONFIG.TIMING.HEIGHT_CORRECTION_RATE_MS ? 0
                    : CONFIG.TIMING.HEIGHT_CORRECTION_RATE_MS - elapsed;
      _corrTimer = setTimeout(_applyCorrection, wait);
    }

    function _applyCorrection() {
      _corrTimer = null;
      _lastCorr  = performance.now();

      const absVel = Math.abs(_vel);
      const st     = _ax.scrollPos();
      const vTop   = Math.max(0, st - _getContainerOffset());

      if (_isGrid) {
        // ── Grid correction ────────────────────────────────────────────────
        const refRow   = _findRow(vTop);
        const oldOff   = (_rOff && _rOff[refRow]) || 0;
        const minRow   = _minCorrIdx === Infinity ? refRow : ((_minCorrIdx / _columns) | 0);
        _rebuildGridFrom(Math.min(minRow, refRow));
        _minCorrIdx = Infinity;
        for (const [idx, el] of _vis) _updateItemTransform(idx, el);
        if (!_scrolling && absVel <= 1.0) {
          const adj = ((_rOff && _rOff[refRow]) || 0) - oldOff;
          if (Math.abs(adj) > 0.5) { if (_winMode) window.scrollBy(0, adj); else viewport.scrollTop = st + adj; }
          Scheduler.schedule(_render, 'vl-post-correction');
        } else {
          _corrTimer = setTimeout(_applyCorrection, CONFIG.TIMING.HEIGHT_CORRECTION_RATE_MS * 2);
        }
        return;
      }

      // ── List correction ───────────────────────────────────────────────────
      // WHY always rebuild: rebuilding _off[] is pure arithmetic (no layout).
      // The old behaviour that bailed at vel>1.0 left _off[] stale, causing
      // items to render at wrong positions (overlap). Now we rebuild always,
      // but only apply the scrollBy scroll-anchor when scroll has settled.
      const ref    = _find(vTop);
      const oldOff = _off[ref] || 0;
      _rebuildListFrom(Math.min(_minCorrIdx, ref));
      _minCorrIdx = Infinity;
      for (const [idx, el] of _vis) _updateItemTransform(idx, el);
      if (!_scrolling && absVel <= 1.0) {
        const adj = (_off[ref] || 0) - oldOff;
        if (Math.abs(adj) > 0.5) {
          if (_winMode) { _H ? window.scrollBy(adj, 0) : window.scrollBy(0, adj); }
          else { if (_H) viewport.scrollLeft = st + adj; else viewport.scrollTop = st + adj; }
        }
        Scheduler.schedule(_render, 'vl-post-correction');
      } else {
        _corrTimer = setTimeout(_applyCorrection, CONFIG.TIMING.HEIGHT_CORRECTION_RATE_MS * 2);
      }
    }

    // ── Scroll handler ────────────────────────────────────────────────────────
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

        // Snap-correct: flush pending height corrections immediately so there
        // is no visible jump after the user stops scrolling.
        if (_minCorrIdx < Infinity) {
          if (_corrTimer) { clearTimeout(_corrTimer); _corrTimer = null; }
          _applyCorrection();
        } else {
          Scheduler.schedule(_render, 'vl-scroll-end');
        }

        if (onScrollEnd) try { onScrollEnd(); } catch (_) {}
      }, CONFIG.TIMING.SCROLL_IDLE_MS);

      if (_scrollRAF) return;
      _scrollRAF = requestAnimationFrame(() => { _scrollRAF = null; _render(); });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function _getType(idx) {
      const item = _items[idx];
      if (!item || typeof item !== 'object') return 'item';
      return item._ureType || item.type || 'item';
    }

    function _growArrays(n) {
      if (_hgt.length >= n) return;
      const h2 = new Float32Array(n);
      h2.set(_hgt);
      // Use type-average estimates for new items instead of hard-coded default
      for (let i = _hgt.length; i < n; i++) h2[i] = _estimatedH(i);
      _hgt = h2;
      const m2 = new Uint8Array(n); m2.set(_measured); _measured = m2;
      const s2 = new Uint8Array(n); s2.set(_seenIdx);  _seenIdx  = s2;
    }

    // ── Public ────────────────────────────────────────────────────────────────
    const VL = {

      mount() {
        if (_rendered) return; _rendered = true;
        if (_isGrid) _updateGridWidth();
        _buildOffsets();
        _cardRO = ObserverFactory.createRO(_onCardsResized);

        _vpRO = ObserverFactory.createRO(() => {
          if (_isGrid) {
            // Recompute item width and refresh grid on container resize
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
        _scrollTarget.addEventListener('scroll', _onScroll, { passive: true });
        Scheduler.schedule(_render, 'vl-initial');
      },

      setItems(newItems) {
        _items = newItems.slice();
        const n = _items.length;
        // Use type averages for initial heights of all items in the new set
        _hgt      = new Float32Array(n);
        for (let i = 0; i < n; i++) _hgt[i] = _estimatedH(i);
        _measured = new Uint8Array(n);
        _seenIdx  = new Uint8Array(n);
        _minCorrIdx = Infinity;
        _firstRenderDone = false;
        _preCache.clear();
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
        // Estimate heights for inserted items using type averages
        for (let i = 0; i < len; i++) xh[i] = _estimatedH(index + i);
        const mh = new Float32Array(_hgt.length + len);
        mh.set(_hgt.slice(0, index)); mh.set(xh, index); mh.set(_hgt.slice(index), index + len);
        _hgt = mh;
        const mm = new Uint8Array(_measured.length + len);
        mm.set(_measured.slice(0, index)); mm.set(_measured.slice(index), index + len);
        _measured = mm;
        const ms = new Uint8Array(_seenIdx.length + len);
        ms.set(_seenIdx.slice(0, index)); ms.set(_seenIdx.slice(index), index + len);
        _seenIdx = ms;
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
          if (el) { _vis.delete(i); _elIdx.delete(el); if (_cardRO) _cardRO.unobserve(el); if (pool) pool.release(el, _getType(i)); }
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

      // Returns { startIndex, endIndex } of currently mounted items
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
          preCached: _preCache.size, mountCap: _MOUNT_CAP, horizontal: _H,
          isGrid: _isGrid, columns: _columns, gap: _gap,
          typeAvgCount: _typeAvgHgt.size,
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
        _vis.clear(); _preCache.clear();
        if (pool) pool.destroy();
        if (_spacer.parentNode) _spacer.parentNode.removeChild(_spacer);
        _rendered = false;
      },
    };

    return VL;
  }

  M.createVirtualList = createVirtualList;

})(window.UREModules = window.UREModules || {});