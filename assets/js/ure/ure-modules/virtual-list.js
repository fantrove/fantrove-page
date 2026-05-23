// Path:    assets/js/ure/ure-modules/virtual-list.js
// Purpose: Core virtual scroll — optimized build, velocity buffer, horizontal mode.
//
// Optimizations over base:
//   _measured[]       — Uint8Array; unobserve confirmed-stable items (no RO churn)
//   _rebuildFrom(i)   — partial offset rebuild O(n-i) instead of O(n)
//   _MOUNT_CAP        — per-frame DOM cap; excess deferred to next rAF
//   velocity buffer   — extend buffer in scroll direction, shrink behind
//   deferred anchor   — skip scrollBy() during active scroll; apply on scroll-idle
//   horizontal mode   — full axis abstraction (X / Y)

(function (M) {
  'use strict';

  const { CONFIG, Scheduler, ObserverFactory, createPool } = M;

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
      horizontal = false,
      onVisible,
      onHidden,
    } = opts;

    const _H = !!horizontal;

    // ── State ────────────────────────────────────────────────────────────────

    let _items    = items.slice();
    let _lang     = lang;
    let _rendered = false;

    let _hgt      = new Float32Array(_items.length).fill(CONFIG.RENDER.DEFAULT_ITEM_HEIGHT);
    let _off      = new Float64Array(_items.length + 1);
    let _totalH   = 0;
    let _measured = new Uint8Array(_items.length);
    let _minCorrIdx = Infinity;  // lowest index with pending height correction

    const _T = (() => {
      const m = navigator.deviceMemory, c = navigator.hardwareConcurrency || 2;
      if ((m && m <= 1) || c <= 2) return 0;
      if ((m && m <= 2) || c <= 4) return 1;
      return 2;
    })();

    const _MOUNT_CAP = [4, 8, 16][_T];

    const _vis   = new Map();
    const _elIdx = new WeakMap();

    const pool = recycling ? createPool(poolCap) : null;

    // ── Axis abstraction (vertical / horizontal) ──────────────────────────────

    const _scrollEl     = document.scrollingElement || document.documentElement;
    const _winMode      = (viewport === _scrollEl || viewport === document.body || viewport === window);
    const _scrollTarget = _winMode ? window : viewport;

    const _ax = {
      scrollPos() {
        return _winMode
          ? (_H ? (window.scrollX || 0) : (window.scrollY || 0))
          : (_H ? viewport.scrollLeft : viewport.scrollTop);
      },
      viewportSz() {
        return _winMode
          ? (_H ? window.innerWidth  : window.innerHeight)
          : (_H ? (viewport.clientWidth  || window.innerWidth)
                : (viewport.clientHeight || window.innerHeight));
      },
      spacerBase : _H ? 'position:relative;height:100%;min-height:1px;'
                      : 'position:relative;width:100%;',
      spacerProp : _H ? 'width' : 'height',
      itemBase   : _H ? 'position:absolute;top:0;bottom:0;left:0;contain:layout style paint;'
                      : 'position:absolute;left:0;right:0;top:0;contain:layout style paint;',
      translate  : v => _H ? `translateX(${v}px)` : `translateY(${v}px)`,
      roSize(entry) {
        return _H
          ? (entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width)
          : (entry.borderBoxSize?.[0]?.blockSize  ?? entry.contentRect.height);
      },
    };

    // ── Spacer ────────────────────────────────────────────────────────────────

    const _spacer = document.createElement('div');
    _spacer.className   = CONFIG.DOM.SPACER_CLASS;
    _spacer.style.cssText = _ax.spacerBase;
    container.appendChild(_spacer);

    // ── Scroll velocity tracking ──────────────────────────────────────────────

    let _vel      = 0;   // px/ms, positive = forward (down / right)
    let _velPos   = 0;
    let _velTime  = 0;
    let _scrolling  = false;
    let _scrollTimer = null;
    let _scrollRAF   = null;

    // ── Container offset cache ────────────────────────────────────────────────

    let _coOff      = 0;
    let _coOffDirty = true;

    function _getContainerOffset() {
      if (!_coOffDirty) return _coOff;
      if (_winMode) {
        const r = _spacer.getBoundingClientRect();
        _coOff = _H
          ? r.left + (window.scrollX || 0)
          : r.top  + (window.scrollY || 0);
      } else {
        const prop = _H ? 'offsetLeft' : 'offsetTop';
        let off = 0, el = _spacer;
        while (el && el !== viewport) { off += el[prop] || 0; el = el.offsetParent; }
        _coOff = off;
      }
      _coOffDirty = false;
      return _coOff;
    }

    // ── Offset index ──────────────────────────────────────────────────────────

    function _buildOffsets() {
      const n = _hgt.length;
      if (_off.length !== n + 1) _off = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) _off[i + 1] = _off[i] + _hgt[i];
      _totalH = _off[n] || 0;
      _spacer.style[_ax.spacerProp] = _totalH + 'px';
    }

    // Partial rebuild — only recompute from `start` onwards.
    // O(n - start) vs O(n) for full rebuild.
    function _rebuildFrom(start) {
      start = Math.max(0, start | 0);
      const n = _hgt.length;
      if (_off.length !== n + 1) { _buildOffsets(); return; }
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

    // ── Render ────────────────────────────────────────────────────────────────

    function _render() {
      if (!_spacer.isConnected) return;

      const st  = _ax.scrollPos();
      const vh  = _ax.viewportSz();
      const co  = _getContainerOffset();
      const vel = _vel;

      // Directional buffer: extend ahead, shrink behind on fast scroll
      const fast        = Math.abs(vel) > 0.3;
      const bufAhead    = fast ? buffer * 1.6 : buffer;
      const bufBehind   = fast ? buffer * 0.4 : buffer;
      const bufFrom     = vel >= 0 ? bufBehind : bufAhead;  // top/left side
      const bufTo       = vel >= 0 ? bufAhead  : bufBehind; // bottom/right side

      const from = Math.max(0, st - co - bufFrom);
      const to   = Math.max(0, st - co + vh + bufTo);
      const si   = _find(from);
      const ei   = Math.min(_items.length - 1, _find(to) + 1);

      // Recycle out-of-range
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

      // Mount in-range — capped per frame
      const frag = document.createDocumentFragment();
      let newMounts = 0;

      for (let i = si; i <= ei; i++) {
        if (_vis.has(i)) continue;
        if (newMounts >= _MOUNT_CAP) {
          // Defer rest to next frame
          if (!_scrollRAF) _scrollRAF = requestAnimationFrame(() => { _scrollRAF = null; _render(); });
          break;
        }

        const el = pool ? pool.acquire(_getType(i)) : document.createElement('div');
        el.className   = CONFIG.DOM.VISIBLE_CLASS;
        el.style.cssText = `${_ax.itemBase}transform:${_ax.translate(_off[i])};`;
        el.setAttribute(CONFIG.DOM.ITEM_ATTR, i);
        el.innerHTML = renderFn(_items[i], _lang);

        frag.appendChild(el);
        _vis.set(i, el);
        _elIdx.set(el, i);

        if (_cardRO && !_measured[i]) _cardRO.observe(el);
        if (onVisible) try { onVisible(_items[i], el); } catch (_) {}
        newMounts++;
      }

      if (frag.hasChildNodes()) _spacer.appendChild(frag);
    }

    // ── ResizeObserver ────────────────────────────────────────────────────────

    let _cardRO = null, _vpRO = null, _corrTimer = null, _lastCorr = 0;

    function _onCardsResized(entries) {
      let dirty = false;
      for (const entry of entries) {
        const idx = _elIdx.get(entry.target);
        if (idx === undefined) continue;
        const h = _ax.roSize(entry);
        if (h <= 4) continue;

        if (Math.abs(h - _hgt[idx]) > 2) {
          _hgt[idx]      = h;
          _measured[idx] = 0;
          if (idx < _minCorrIdx) _minCorrIdx = idx;
          dirty = true;
        } else if (!_measured[idx]) {
          _measured[idx] = 1;
          if (_cardRO) try { _cardRO.unobserve(entry.target); } catch (_) {}
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

      const st     = _ax.scrollPos();
      const vTop   = Math.max(0, st - _getContainerOffset());
      const ref    = _find(vTop);
      const oldOff = _off[ref];

      // Partial rebuild from lowest changed index (or ref, whichever is lower)
      _rebuildFrom(Math.min(_minCorrIdx, ref));
      _minCorrIdx = Infinity;

      // Update visible transforms
      for (const [idx, el] of _vis) {
        const t = _ax.translate(_off[idx]);
        if (el.style.transform !== t) el.style.transform = t;
      }

      // Scroll-anchor only when idle — avoids fighting active scroll
      if (!_scrolling) {
        const adj = _off[ref] - oldOff;
        if (Math.abs(adj) > 0.5) {
          if (_winMode) {
            _H ? window.scrollBy(adj, 0) : window.scrollBy(0, adj);
          } else {
            if (_H) viewport.scrollLeft = st + adj;
            else    viewport.scrollTop  = st + adj;
          }
        }
      }

      Scheduler.schedule(_render, 'vl-post-correction');
    }

    // ── Scroll handler ────────────────────────────────────────────────────────

    function _onScroll() {
      const now = performance.now();
      const pos = _ax.scrollPos();
      const dt  = now - _velTime;
      if (dt > 0 && dt < 150) _vel = (pos - _velPos) / dt;
      _velPos  = pos;
      _velTime = now;

      _scrolling = true;
      clearTimeout(_scrollTimer);
      _scrollTimer = setTimeout(() => {
        _scrolling = false;
        _vel       = 0;
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
      if (_hgt.length < n) {
        const newHgt = new Float32Array(n).fill(CONFIG.RENDER.DEFAULT_ITEM_HEIGHT);
        newHgt.set(_hgt);
        _hgt = newHgt;
        const newM = new Uint8Array(n);
        newM.set(_measured);
        _measured = newM;
      }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    const VL = {

      mount() {
        if (_rendered) return;
        _rendered = true;
        _buildOffsets();

        _cardRO = ObserverFactory.createRO(_onCardsResized);
        _vpRO   = ObserverFactory.createRO(() => {
          _coOffDirty = true;
          Scheduler.schedule(_render, 'vl-resize');
        });
        if (_vpRO) _vpRO.observe(_winMode ? document.body : viewport);

        _scrollTarget.addEventListener('scroll', _onScroll, { passive: true });
        Scheduler.schedule(_render, 'vl-initial');
      },

      setItems(newItems) {
        _items    = newItems.slice();
        _growArrays(_items.length);
        _measured = new Uint8Array(_items.length);
        _minCorrIdx = Infinity;
        _buildOffsets();
        for (const [, el] of _vis) {
          if (_cardRO) _cardRO.unobserve(el);
          if (pool) pool.release(el, 'item');
          else if (el.parentNode) el.parentNode.removeChild(el);
        }
        _vis.clear();
        Scheduler.schedule(_render, 'vl-set-items');
      },

      updateItem(index, newData) {
        if (index < 0 || index >= _items.length) return;
        _items[index]    = newData;
        _measured[index] = 0;
        const el = _vis.get(index);
        if (el) { el.innerHTML = renderFn(newData, _lang); if (_cardRO) _cardRO.observe(el); }
      },

      insertAt(index, newItems) {
        _items.splice(index, 0, ...newItems);
        const extra  = new Float32Array(newItems.length).fill(CONFIG.RENDER.DEFAULT_ITEM_HEIGHT);
        const mHgt   = new Float32Array(_hgt.length + extra.length);
        mHgt.set(_hgt.slice(0, index)); mHgt.set(extra, index); mHgt.set(_hgt.slice(index), index + extra.length);
        _hgt = mHgt;
        const mM = new Uint8Array(_measured.length + newItems.length);
        mM.set(_measured.slice(0, index)); mM.set(_measured.slice(index), index + newItems.length);
        _measured = mM;
        _rebuildFrom(index);
        Scheduler.schedule(_render, 'vl-insert');
      },

      removeAt(index, count = 1) {
        _items.splice(index, count);
        const mHgt = new Float32Array(_hgt.length - count);
        mHgt.set(_hgt.slice(0, index)); mHgt.set(_hgt.slice(index + count));
        _hgt = mHgt;
        const mM = new Uint8Array(_measured.length - count);
        mM.set(_measured.slice(0, index)); mM.set(_measured.slice(index + count));
        _measured = mM;
        for (let i = index; i < index + count; i++) {
          const el = _vis.get(i);
          if (el) { _vis.delete(i); _elIdx.delete(el); if (_cardRO) _cardRO.unobserve(el); if (pool) pool.release(el, _getType(i)); }
        }
        _rebuildFrom(index);
        Scheduler.schedule(_render, 'vl-remove');
      },

      setLang(newLang) {
        _lang = newLang;
        for (const [idx, el] of _vis) el.innerHTML = renderFn(_items[idx], _lang);
      },

      refresh() { _coOffDirty = true; Scheduler.schedule(_render, 'vl-refresh'); },

      scrollToIndex(index, behavior = 'smooth') {
        const offset = _off[Math.min(index, _items.length - 1)] || 0;
        const co     = _getContainerOffset();
        if (_winMode) {
          _H ? window.scrollTo({ left: co + offset, behavior })
             : window.scrollTo({ top:  co + offset, behavior });
        } else {
          if (_H) viewport.scrollLeft = offset;
          else    viewport.scrollTo({ top: offset, behavior });
        }
      },

      stats() {
        const stable = _measured.reduce((n, v) => n + v, 0);
        return {
          items: _items.length, visible: _vis.size, totalSize: _totalH,
          stable, unstable: _items.length - stable,
          mountCap: _MOUNT_CAP, horizontal: _H,
          pool: pool ? pool.stats() : null,
        };
      },

      destroy() {
        _scrollTarget.removeEventListener('scroll', _onScroll);
        ObserverFactory.disconnect(_cardRO);
        ObserverFactory.disconnect(_vpRO);
        if (_scrollRAF)  cancelAnimationFrame(_scrollRAF);
        if (_corrTimer)  clearTimeout(_corrTimer);
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