// Path:    assets/js/ure/ure-modules/virtual-list.js
// Purpose: Virtual scroll — scroll-guard coOff invalidation prevents
//          getBoundingClientRect mid-scroll (nav show/hide jank fix).
//          Also gates height corrections during fast scroll.

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

  function createVirtualList(opts) {
    const {
      container, viewport,
      items = [], renderFn,
      lang = 'en',
      buffer   = CONFIG.RENDER.DEFAULT_BUFFER_PX,
      recycling = true,
      poolCap  = CONFIG.RENDER.DEFAULT_POOL_CAP,
      horizontal = false,
      onVisible, onHidden,
    } = opts;

    _ensureVLCss();

    const _H = !!horizontal;

    // ── State ────────────────────────────────────────────────────────────────
    let _items    = items.slice();
    let _lang     = lang;
    let _rendered = false;

    let _hgt      = new Float32Array(_items.length).fill(CONFIG.RENDER.DEFAULT_ITEM_HEIGHT);
    let _off      = new Float64Array(_items.length + 1);
    let _totalH   = 0;
    let _measured = new Uint8Array(_items.length);
    let _seenIdx  = new Uint8Array(_items.length);
    let _minCorrIdx = Infinity;

    const _T = (() => {
      const m = navigator.deviceMemory, c = navigator.hardwareConcurrency || 2;
      if ((m && m <= 1) || c <= 2) return 0;
      if ((m && m <= 2) || c <= 4) return 1;
      return 2;
    })();
    const _MOUNT_CAP = [4, 8, 16][_T];
    const _PRE_CAP   = _MOUNT_CAP * 3;

    const _vis    = new Map();
    const _elIdx  = new WeakMap();
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
    // WHY _coOffPending:
    //   When nav bar shows/hides via CSS transform, ResizeObserver on body fires.
    //   Setting _coOffDirty=true MID-SCROLL forces getBoundingClientRect() on the
    //   next rAF, which causes a synchronous layout pass = jank during scroll.
    //   Fix: queue the invalidation, flush it only after scroll comes to rest.
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

    // ── Offset index ──────────────────────────────────────────────────────────
    function _buildOffsets() {
      const n = _hgt.length;
      if (_off.length !== n + 1) _off = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) _off[i + 1] = _off[i] + _hgt[i];
      _totalH = _off[n] || 0;
      _spacer.style[_ax.spacerProp] = _totalH + 'px';
    }

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

    // ── Idle pre-render ───────────────────────────────────────────────────────
    function _schedulePreRender(lastVisible) {
      if (_preRafId) return;
      const start = lastVisible + 1;
      const end   = Math.min(_items.length - 1, lastVisible + _PRE_CAP);
      if (start > end) return;

      const doPreRender = typeof requestIdleCallback !== 'undefined'
        ? fn => requestIdleCallback(fn, { timeout: 300 })
        : fn => (_preRafId = setTimeout(fn, 50));

      doPreRender(dl => {
        _preRafId = null;
        const hasTime = dl?.timeRemaining ? () => dl.timeRemaining() > 1 : () => true;
        for (let i = start; i <= end && hasTime(); i++) {
          if (_vis.has(i) || _preCache.has(i) || !_items[i]) continue;
          if (_preCache.size >= _PRE_CAP) break;
          _preCache.set(i, renderFn(_items[i], _lang));
        }
      });
    }

    // ── Render ────────────────────────────────────────────────────────────────
    function _render() {
      if (!_spacer.isConnected) return;

      const st  = _ax.scrollPos();
      const vh  = _ax.viewportSz();
      const co  = _getContainerOffset();
      const vel = _vel;

      const fast      = Math.abs(vel) > 0.3;
      const bufAhead  = fast ? buffer * 1.6 : buffer;
      const bufBehind = fast ? buffer * 0.4 : buffer;
      const from = Math.max(0, st - co - (vel >= 0 ? bufBehind : bufAhead));
      const to   = Math.max(0, st - co + vh + (vel >= 0 ? bufAhead : bufBehind));
      const si   = _find(from);
      const ei   = Math.min(_items.length - 1, _find(to) + 1);

      // Recycle
      const toRecycle = [];
      for (const [idx, el] of _vis) {
        if (idx < si || idx > ei) toRecycle.push([idx, el]);
      }
      for (const [idx, el] of toRecycle) {
        _vis.delete(idx); _elIdx.delete(el);
        if (_cardRO) _cardRO.unobserve(el);
        if (onHidden) try { onHidden(_items[idx]); } catch (_) {}
        if (pool) pool.release(el, _getType(idx));
        else if (el.parentNode) el.parentNode.removeChild(el);
      }

      // Mount (capped per frame)
      const frag       = document.createDocumentFragment();
      let newMounts    = 0;
      let staggerCount = 0;
      const slowScroll = Math.abs(vel) < 0.5;

      for (let i = si; i <= ei; i++) {
        if (_vis.has(i)) continue;
        if (newMounts >= _MOUNT_CAP) {
          if (!_scrollRAF) _scrollRAF = requestAnimationFrame(() => { _scrollRAF = null; _render(); });
          break;
        }

        const el = pool ? pool.acquire(_getType(i)) : document.createElement('div');
        el.className   = CONFIG.DOM.VISIBLE_CLASS;
        el.style.cssText = `${_ax.itemBase}transform:${_ax.translate(_off[i])};`;
        el.setAttribute(CONFIG.DOM.ITEM_ATTR, i);

        el.innerHTML = _preCache.get(i) ?? renderFn(_items[i], _lang);
        _preCache.delete(i);

        if (!_seenIdx[i]) {
          _seenIdx[i] = 1;
          el.classList.add('ure-new');
          if (slowScroll && staggerCount < 5) {
            el.style.animationDelay = staggerCount > 0 ? `${staggerCount * 18}ms` : '';
            staggerCount++;
          } else {
            el.style.animationDelay = '';
          }
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
        newMounts++;
      }

      if (frag.hasChildNodes()) _spacer.appendChild(frag);

      _schedulePreRender(ei);
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
          _hgt[idx] = h; _measured[idx] = 0;
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

      // WHY: Don't correct offsets during fast scroll — scrollTop adjustment
      // fights momentum scrolling and causes visible jumps. Reschedule for
      // when scroll has slowed or stopped.
      if (Math.abs(_vel) > 1.0) {
        _corrTimer = setTimeout(_applyCorrection, CONFIG.TIMING.HEIGHT_CORRECTION_RATE_MS * 2);
        return;
      }

      _lastCorr = performance.now();
      const st     = _ax.scrollPos();
      const vTop   = Math.max(0, st - _getContainerOffset());
      const ref    = _find(vTop);
      const oldOff = _off[ref];
      _rebuildFrom(Math.min(_minCorrIdx, ref));
      _minCorrIdx  = Infinity;
      for (const [idx, el] of _vis) {
        const t = _ax.translate(_off[idx]);
        if (el.style.transform !== t) el.style.transform = t;
      }
      if (!_scrolling) {
        const adj = _off[ref] - oldOff;
        if (Math.abs(adj) > 0.5) {
          if (_winMode) { _H ? window.scrollBy(adj, 0) : window.scrollBy(0, adj); }
          else { if (_H) viewport.scrollLeft = st + adj; else viewport.scrollTop = st + adj; }
        }
      }
      Scheduler.schedule(_render, 'vl-post-correction');
    }

    // ── Scroll ────────────────────────────────────────────────────────────────
    function _onScroll() {
      const now = performance.now(), pos = _ax.scrollPos(), dt = now - _velTime;
      if (dt > 0 && dt < 150) _vel = (pos - _velPos) / dt;
      _velPos = pos; _velTime = now;
      _scrolling = true;
      clearTimeout(_scrollTimer);
      _scrollTimer = setTimeout(() => {
        _scrolling = false;
        _vel = 0;
        // Flush deferred coOff invalidation — safe to do getBoundingClientRect
        // now that scroll has stopped and nav animation has settled.
        if (_coOffPending) {
          _coOffPending = false;
          _coOffDirty = true;
          Scheduler.schedule(_render, 'vl-cooff-flush');
        }
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
        const h2 = new Float32Array(n).fill(CONFIG.RENDER.DEFAULT_ITEM_HEIGHT); h2.set(_hgt); _hgt = h2;
        const m2 = new Uint8Array(n); m2.set(_measured); _measured = m2;
        const s2 = new Uint8Array(n); s2.set(_seenIdx);  _seenIdx  = s2;
      }
    }

    // ── Public ────────────────────────────────────────────────────────────────
    const VL = {
      mount() {
        if (_rendered) return; _rendered = true;
        _buildOffsets();
        _cardRO = ObserverFactory.createRO(_onCardsResized);

        // WHY scroll-guard in vpRO:
        //   Nav bar show/hide (CSS transform) triggers body ResizeObserver.
        //   Setting _coOffDirty during active scroll forces getBoundingClientRect()
        //   on the next rAF which stalls the compositor = jank.
        //   Instead: set _coOffPending flag, flush after scroll idle timer fires.
        _vpRO = ObserverFactory.createRO(() => {
          if (_scrolling) {
            // Queue until scroll stops — nav is probably mid-animation right now
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
        _items = newItems.slice(); _growArrays(_items.length);
        _measured = new Uint8Array(_items.length);
        _seenIdx  = new Uint8Array(_items.length);
        _minCorrIdx = Infinity; _preCache.clear();
        _buildOffsets();
        for (const [, el] of _vis) {
          if (_cardRO) _cardRO.unobserve(el);
          if (pool) pool.release(el, 'item'); else if (el.parentNode) el.parentNode.removeChild(el);
        }
        _vis.clear(); Scheduler.schedule(_render, 'vl-set-items');
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
        const xh = new Float32Array(len).fill(CONFIG.RENDER.DEFAULT_ITEM_HEIGHT);
        const mh = new Float32Array(_hgt.length + len);
        mh.set(_hgt.slice(0, index)); mh.set(xh, index); mh.set(_hgt.slice(index), index + len); _hgt = mh;
        const mm = new Uint8Array(_measured.length + len);
        mm.set(_measured.slice(0, index)); mm.set(_measured.slice(index), index + len); _measured = mm;
        const ms = new Uint8Array(_seenIdx.length + len);
        ms.set(_seenIdx.slice(0, index)); ms.set(_seenIdx.slice(index), index + len); _seenIdx = ms;
        _rebuildFrom(index); Scheduler.schedule(_render, 'vl-insert');
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
        _rebuildFrom(index); Scheduler.schedule(_render, 'vl-remove');
      },

      setLang(newLang) {
        _lang = newLang; _preCache.clear();
        for (const [idx, el] of _vis) el.innerHTML = renderFn(_items[idx], _lang);
      },

      refresh() { _coOffDirty = true; Scheduler.schedule(_render, 'vl-refresh'); },

      scrollToIndex(index, behavior = 'smooth') {
        const offset = _off[Math.min(index, _items.length - 1)] || 0;
        const co     = _getContainerOffset();
        if (_winMode) { _H ? window.scrollTo({ left: co + offset, behavior }) : window.scrollTo({ top: co + offset, behavior }); }
        else { if (_H) viewport.scrollLeft = offset; else viewport.scrollTo({ top: offset, behavior }); }
      },

      stats() {
        const stable = _measured.reduce((n, v) => n + v, 0);
        return {
          items: _items.length, visible: _vis.size, totalSize: _totalH,
          stable, unstable: _items.length - stable,
          preCached: _preCache.size, mountCap: _MOUNT_CAP, horizontal: _H,
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