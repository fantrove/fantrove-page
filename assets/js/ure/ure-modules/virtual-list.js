// Path:    assets/js/ure/ure-modules/virtual-list.js
// Purpose: Core virtual scroll — optimized with stable-height tracking and
//          per-frame mount cap to eliminate scroll jank on dense button grids.
//
// Key changes from base version:
//   _measured[]    — Uint8Array tracking confirmed-stable heights per index.
//                    Once ResizeObserver confirms a height, we unobserve and
//                    skip re-observing on recycle. Mid/last btn-rows all share
//                    the same height → measured after 1-2 scrolls, never again.
//   _MOUNT_CAP     — Max new DOM nodes per rAF frame (device-tier scaled).
//                    Excess items defer to the next frame so the compositor
//                    always gets a full slot.

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
      onVisible,
      onHidden,
    } = opts;

    // ── State ────────────────────────────────────────────────────────────────

    let _items    = items.slice();
    let _lang     = lang;
    let _rendered = false;

    // Height arrays
    let _hgt      = new Float32Array(_items.length).fill(CONFIG.RENDER.DEFAULT_ITEM_HEIGHT);
    let _off      = new Float64Array(_items.length + 1);
    let _totalH   = 0;

    // Stable-height tracking: 1 = ResizeObserver confirmed this index's height.
    // Once stable, we skip observe() on mount and call unobserve() immediately.
    let _measured = new Uint8Array(_items.length);

    // Device tier: 0=low, 1=mid, 2=high
    const _T = (() => {
      const m = navigator.deviceMemory, c = navigator.hardwareConcurrency || 2;
      if ((m && m <= 1) || c <= 2) return 0;
      if ((m && m <= 2) || c <= 4) return 1;
      return 2;
    })();

    // Max new items to mount per rAF — prevents jank on fast scroll.
    // btn-row items are small; exceeding the cap defers to the next frame.
    const _MOUNT_CAP = [4, 8, 16][_T];

    const _vis   = new Map();   // index → HTMLElement
    const _elIdx = new WeakMap(); // HTMLElement → index

    const pool = recycling ? createPool(poolCap) : null;

    // Spacer
    const _spacer = document.createElement('div');
    _spacer.className   = CONFIG.DOM.SPACER_CLASS;
    _spacer.style.cssText = 'position:relative;width:100%;';
    container.appendChild(_spacer);

    // Scroll mode
    const _scrollEl     = document.scrollingElement || document.documentElement;
    const _winMode      = (viewport === _scrollEl || viewport === document.body || viewport === window);
    const _scrollTarget = _winMode ? window : viewport;

    let _cardRO    = null;
    let _vpRO      = null;
    let _scrollRAF = null;
    let _corrTimer = null;
    let _lastCorr  = 0;
    let _coOff     = 0;
    let _coOffDirty = true;
    let _scrolling    = false;
    let _scrollTimer  = null;

    // ── Height index ──────────────────────────────────────────────────────────

    function _buildOffsets() {
      const n = _hgt.length;
      if (_off.length !== n + 1) _off = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) _off[i + 1] = _off[i] + _hgt[i];
      _totalH = _off[n] || 0;
      _spacer.style.height = _totalH + 'px';
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

    // ── Geometry ──────────────────────────────────────────────────────────────

    const _scrollTop = () => _winMode ? (window.scrollY || 0) : (viewport.scrollTop || 0);
    const _viewportH = () => _winMode ? window.innerHeight : (viewport.clientHeight || window.innerHeight);

    function _getContainerOffset() {
      if (!_coOffDirty) return _coOff;
      if (_winMode) {
        const r = _spacer.getBoundingClientRect();
        _coOff = r.top + (window.scrollY || 0);
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

      // Mount in-range — capped at _MOUNT_CAP new items per frame
      const frag = document.createDocumentFragment();
      let newMounts = 0;
      let deferred  = false;

      for (let i = si; i <= ei; i++) {
        if (_vis.has(i)) continue;

        // Defer excess to next frame to keep main thread responsive
        if (newMounts >= _MOUNT_CAP) {
          deferred = true;
          break;
        }

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

        // Only observe items whose height is not yet confirmed stable
        if (_cardRO && !_measured[i]) _cardRO.observe(el);

        if (onVisible) try { onVisible(item, el); } catch (_) {}
        newMounts++;
      }

      if (frag.hasChildNodes()) _spacer.appendChild(frag);

      // Continue in next frame if items were deferred
      if (deferred && !_scrollRAF) {
        _scrollRAF = requestAnimationFrame(() => { _scrollRAF = null; _render(); });
      }
    }

    // ── ResizeObserver: measure + confirm stable heights ──────────────────────

    function _onCardsResized(entries) {
      let dirty = false;
      for (const entry of entries) {
        const idx = _elIdx.get(entry.target);
        if (idx === undefined) continue;
        const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        if (h <= 4) continue;

        if (Math.abs(h - _hgt[idx]) > 2) {
          // Height changed — update and reset stability flag
          _hgt[idx]      = h;
          _measured[idx] = 0;
          dirty = true;
        } else if (!_measured[idx]) {
          // Height matches estimate — confirm stable, stop observing this index
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
      _corrTimer  = null;
      _lastCorr   = performance.now();
      const st    = _scrollTop();
      const vTop  = Math.max(0, st - _getContainerOffset());
      const ref   = _find(vTop);
      const oldOff= _off[ref];
      _buildOffsets();
      for (const [idx, el] of _vis) {
        const t = `translateY(${_off[idx]}px)`;
        if (el.style.transform !== t) el.style.transform = t;
      }
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

        _vpRO = ObserverFactory.createRO(() => {
          _coOffDirty = true;
          Scheduler.schedule(_render, 'vl-render-resize');
        });
        if (_vpRO) _vpRO.observe(_winMode ? document.body : viewport);

        _scrollTarget.addEventListener('scroll', _onScroll, { passive: true });
        Scheduler.schedule(_render, 'vl-initial-render');
      },

      setItems(newItems) {
        _items    = newItems.slice();
        _growArrays(_items.length);
        // Reset all stability flags — new data, heights unknown
        _measured = new Uint8Array(_items.length);
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
        _measured[index] = 0; // height may change with new content
        const el = _vis.get(index);
        if (el) {
          el.innerHTML = renderFn(newData, _lang);
          // Re-observe since height is uncertain
          if (_cardRO) _cardRO.observe(el);
        }
      },

      insertAt(index, newItems) {
        _items.splice(index, 0, ...newItems);

        // Splice _hgt
        const extra  = new Float32Array(newItems.length).fill(CONFIG.RENDER.DEFAULT_ITEM_HEIGHT);
        const merged = new Float32Array(_hgt.length + extra.length);
        merged.set(_hgt.slice(0, index));
        merged.set(extra, index);
        merged.set(_hgt.slice(index), index + extra.length);
        _hgt = merged;

        // Splice _measured (new items = unmeasured = 0)
        const mergedM = new Uint8Array(_measured.length + newItems.length);
        mergedM.set(_measured.slice(0, index));
        mergedM.set(_measured.slice(index), index + newItems.length);
        _measured = mergedM;

        _buildOffsets();
        Scheduler.schedule(_render, 'vl-insert');
      },

      removeAt(index, count = 1) {
        _items.splice(index, count);

        const merged = new Float32Array(_hgt.length - count);
        merged.set(_hgt.slice(0, index));
        merged.set(_hgt.slice(index + count));
        _hgt = merged;

        const mergedM = new Uint8Array(_measured.length - count);
        mergedM.set(_measured.slice(0, index));
        mergedM.set(_measured.slice(index + count));
        _measured = mergedM;

        _buildOffsets();
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

      setLang(newLang) {
        _lang = newLang;
        for (const [idx, el] of _vis) {
          el.innerHTML = renderFn(_items[idx], _lang);
        }
      },

      refresh() {
        _coOffDirty = true;
        Scheduler.schedule(_render, 'vl-refresh');
      },

      scrollToIndex(index, behavior = 'smooth') {
        const offset = _off[Math.min(index, _items.length - 1)] || 0;
        const co     = _getContainerOffset();
        if (_winMode) window.scrollTo({ top: co + offset, behavior });
        else viewport.scrollTo({ top: offset, behavior });
      },

      stats() {
        const stable = _measured.reduce((n, v) => n + v, 0);
        return {
          items      : _items.length,
          visible    : _vis.size,
          totalHeight: _totalH,
          stable     : stable,           // how many heights are confirmed
          unstable   : _items.length - stable,
          mountCap   : _MOUNT_CAP,
          pool       : pool ? pool.stats() : null,
        };
      },

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