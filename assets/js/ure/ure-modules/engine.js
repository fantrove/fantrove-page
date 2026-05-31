// Path:    assets/js/ure/ure-modules/engine.js
// Purpose: Main orchestrator — wires all modules together and exposes the
//          public EngineHandle returned by URE.mount().
//
// v1.3.0  Grid layout, overscan, itemKey, updateMany, scrollToKey, getVisibleRange.
// v1.5.0  Height persistence + scroll-position restore (social-app grade scroll quality):
//
//   Height cache — measured item heights are stored in sessionStorage keyed by
//     item identity (keyField / itemKey). On remount (SPA nav back), heights are
//     restored so the virtual list starts with real dimensions instead of
//     estimates, eliminating the correction storm that caused layout shift when
//     scrolling up through previously-seen items.
//
//   Scroll position persistence — scroll position is saved on pagehide /
//     visibilitychange:hidden and passed to the virtual list as scrollRestorePos
//     so the first render frame targets the saved position (warm start).
//
//   Orientation change invalidation — device rotation changes item widths and
//     therefore heights; the cache is cleared on orientation change to prevent
//     stale heights from producing wrong offsets at the new viewport width.

(function (M) {
  'use strict';

  const {
    CONFIG, Scheduler, DiffEngine,
    createStateStore, createVirtualList, createLazyAssets, createWorkerBridge,
  } = M;

  const _registry = new Map();

  // ── Height cache helpers ──────────────────────────────────────────────────

  /**
   * Load height map from sessionStorage.
   * Returns an empty Map on any parse error or version mismatch.
   * @param {string} storageKey
   * @returns {Map<string, number>}
   */
  function _loadHeightCache(storageKey) {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return new Map();
      const { v, d } = JSON.parse(raw);
      if (v !== CONFIG.CACHE.VERSION) return new Map();
      return new Map(d);
    } catch (_) {
      return new Map();
    }
  }

  /**
   * Persist height map to sessionStorage, capped at MAX_ENTRIES.
   * Silently swallows QuotaExceededError — cache is advisory, not critical.
   * @param {string}           storageKey
   * @param {Map<string, number>} cache
   */
  function _saveHeightCache(storageKey, cache) {
    if (cache.size === 0) return;
    try {
      let entries = Array.from(cache.entries());
      if (entries.length > CONFIG.CACHE.MAX_ENTRIES) {
        // Keep newest entries (they're appended in measurement order)
        entries = entries.slice(-CONFIG.CACHE.MAX_ENTRIES);
      }
      sessionStorage.setItem(storageKey, JSON.stringify({ v: CONFIG.CACHE.VERSION, d: entries }));
    } catch (_) {
      // QuotaExceededError or unavailable (private browsing) — continue without cache
    }
  }

  /** @param {string} key  @returns {number} saved scrollTop, 0 if none */
  function _loadScrollPos(key) {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? (parseFloat(raw) || 0) : 0;
    } catch (_) { return 0; }
  }

  /** @param {string} key  @param {number} pos */
  function _saveScrollPos(key, pos) {
    try { sessionStorage.setItem(key, String(pos)); } catch (_) {}
  }

  // ── mount ─────────────────────────────────────────────────────────────────

  function mount(opts = {}) {
    const container = typeof opts.container === 'string'
      ? document.querySelector(opts.container) : opts.container;
    if (!container) throw new Error('[URE/Engine] container not found: ' + opts.container);
    if (_registry.has(container)) _registry.get(container).destroy();

    const {
      data            = [],
      template,
      estimatedItemHeight = CONFIG.RENDER.DEFAULT_ITEM_HEIGHT,
      buffer          = CONFIG.RENDER.DEFAULT_BUFFER_PX,
      recycling       = true,
      diffing         = true,
      keyField        = CONFIG.DIFF.FALLBACK_KEY_FIELD,
      itemKey,
      lang            = (typeof localStorage !== 'undefined' && localStorage.getItem('selectedLang')) || 'en',
      poolCap         = CONFIG.RENDER.DEFAULT_POOL_CAP,
      horizontal      = false,
      columns         = CONFIG.GRID.DEFAULT_COLUMNS,
      gap             = CONFIG.GRID.DEFAULT_GAP_PX,
      overscan        = CONFIG.RENDER.DEFAULT_OVERSCAN,
      // Opt-in to height + scroll persistence with a stable key.
      // Defaults to container.id + keyField; set explicitly when container
      // has no id or when multiple instances share the same id.
      cacheKey,
      onVisible, onHidden, onUpdate, onItemClick, onScrollEnd,
    } = opts;

    if (typeof template !== 'function') throw new Error('[URE/Engine] template function is required');

    const _keyFn    = typeof itemKey === 'function' ? itemKey : null;
    const _keyField = keyField;

    function _extractKey(item, i) {
      if (_keyFn) {
        try { return String(_keyFn(item)); } catch (_) {}
      }
      const k = DiffEngine.extractKey(item, _keyField);
      return k !== undefined ? k : `__idx_${i}`;
    }

    // Key extractor for height cache — index-based keys are not stable across
    // data mutations, so we exclude them to avoid caching wrong heights.
    function _cacheKeyFor(item, i) {
      const k = _extractKey(item, i);
      return k.startsWith('__idx_') ? null : k;
    }

    // ── Persistence setup ────────────────────────────────────────────────────
    const _resolvedCacheKey = cacheKey
      || (container.id ? `${container.id}_${_keyField}` : _keyField);
    const _hCacheKey = CONFIG.CACHE.HEIGHT_PREFIX + _resolvedCacheKey;
    const _sCacheKey = CONFIG.CACHE.SCROLL_PREFIX + _resolvedCacheKey;

    const _heightCache   = _loadHeightCache(_hCacheKey);
    const _scrollRestorePos = _loadScrollPos(_sCacheKey);

    // ── State + data ──────────────────────────────────────────────────────────
    const store = createStateStore({ items: data.slice(), lang, loading: false, error: null });
    let _currentItems = data.slice();
    let _originalData = data.slice();

    container.setAttribute(CONFIG.DOM.CONTAINER_ATTR, '');

    const lazy   = createLazyAssets(buffer);
    const worker = createWorkerBridge();
    const _scrollEl = document.scrollingElement || document.documentElement;

    const vl = createVirtualList({
      container,
      viewport  : _scrollEl,
      items     : _currentItems,
      renderFn  : _render,
      lang,
      buffer,
      recycling,
      poolCap,
      horizontal,
      columns,
      gap,
      overscan,
      onVisible       : _onVisible,
      onHidden,
      onScrollEnd,
      // v1.5.0 — height cache integration
      heightCache     : _heightCache,
      keyExtractor    : _cacheKeyFor,
      scrollRestorePos: _scrollRestorePos,
    });

    vl.mount();

    // ── Delegated click ───────────────────────────────────────────────────────
    if (onItemClick) {
      container.addEventListener('click', (e) => {
        const itemEl = e.target.closest(`[${CONFIG.DOM.ITEM_ATTR}]`);
        if (!itemEl) return;
        const idx  = parseInt(itemEl.getAttribute(CONFIG.DOM.ITEM_ATTR), 10);
        const item = _currentItems[idx];
        if (item) try { onItemClick(e, item); } catch (_) {}
      }, { passive: true });
    }

    // ── Language sync ─────────────────────────────────────────────────────────
    window.addEventListener('languageChange', _onLangChange, { passive: true });

    function _onLangChange(e) {
      const newLang = e?.detail?.language || localStorage.getItem('selectedLang') || 'en';
      if (newLang === store.get('lang')) return;
      store.set('lang', newLang);
      vl.setLang(newLang);
    }

    // ── Render template ───────────────────────────────────────────────────────
    function _render(item, l) {
      try { return template(item, l || store.get('lang')); }
      catch (e) {
        console.error('[URE/Engine] template error:', e);
        return `<div class="ure-render-error">Render error</div>`;
      }
    }

    // ── Visible callback ──────────────────────────────────────────────────────
    function _onVisible(item, el) {
      lazy.observe(el);
      if (onVisible) try { onVisible(item, el); } catch (_) {}
    }

    // ── Diff apply ────────────────────────────────────────────────────────────
    function _applyDiff(newItems) {
      if (!diffing || _currentItems.length === 0) {
        _currentItems = newItems;
        vl.setItems(_currentItems);
        if (onUpdate) try { onUpdate({ added: newItems.length, removed: 0, changed: 0 }); } catch (_) {}
        return;
      }
      const result = DiffEngine.diff(_currentItems, newItems, _keyField, _keyFn);
      if (result.fullReplace) {
        _currentItems = newItems;
        vl.setItems(_currentItems);
        if (onUpdate) try { onUpdate({ added: newItems.length, removed: 0, changed: 0 }); } catch (_) {}
        return;
      }

      const removedIndices = [];
      for (const key of result.removed) {
        const idx = _currentItems.findIndex((item, i) => _extractKey(item, i) === key);
        if (idx !== -1) removedIndices.push(idx);
      }
      removedIndices.sort((a, b) => b - a).forEach(idx => {
        vl.removeAt(idx, 1);
        _currentItems.splice(idx, 1);
      });
      for (const [, { index, item }] of result.changed) {
        _currentItems[index] = item;
        vl.updateItem(index, item);
      }
      for (const [, { item }] of result.added) {
        _currentItems.push(item);
        vl.insertAt(_currentItems.length - 1, [item]);
      }
      if (onUpdate) {
        try { onUpdate({ added: result.added.size, removed: result.removed.size, changed: result.changed.size }); } catch (_) {}
      }
    }

    // ── Persistence lifecycle ─────────────────────────────────────────────────

    function _persistAll() {
      _saveHeightCache(_hCacheKey, _heightCache);
      const scrollEl = document.scrollingElement || document.documentElement;
      _saveScrollPos(_sCacheKey, scrollEl.scrollTop);
    }

    // Clear height cache when orientation changes — heights are viewport-width
    // dependent; stale heights from the previous orientation would be wrong.
    function _onOrientationChange() {
      _heightCache.clear();
      try { sessionStorage.removeItem(_hCacheKey); } catch (_) {}
    }

    const _onVisibilityChange = () => { if (document.hidden) _persistAll(); };
    const _onPageHide         = () => _persistAll();

    document.addEventListener('visibilitychange',   _onVisibilityChange);
    window.addEventListener('pagehide',             _onPageHide);

    // screen.orientation is more reliable than orientationchange event
    if (screen.orientation) {
      screen.orientation.addEventListener('change', _onOrientationChange);
    } else {
      window.addEventListener('orientationchange',  _onOrientationChange);
    }

    // ── Public handle ─────────────────────────────────────────────────────────
    const handle = {

      setData(newData) {
        _originalData = newData.slice();
        _applyDiff(newData);
        store.set('items', _currentItems);
      },

      append(items) {
        const a = items.slice();
        const f = _currentItems.concat(a);
        _originalData = f.slice();
        vl.insertAt(_currentItems.length, a);
        _currentItems = f;
        store.set('items', _currentItems);
        if (onUpdate) try { onUpdate({ added: a.length, removed: 0, changed: 0 }); } catch (_) {}
      },

      prepend(items) {
        const p = items.slice();
        vl.insertAt(0, p);
        _currentItems = p.concat(_currentItems);
        _originalData = _currentItems.slice();
        store.set('items', _currentItems);
        if (onUpdate) try { onUpdate({ added: p.length, removed: 0, changed: 0 }); } catch (_) {}
      },

      removeByKey(keyValue) {
        const kv  = String(keyValue);
        const idx = _currentItems.findIndex((item, i) => _extractKey(item, i) === kv);
        if (idx === -1) return;
        vl.removeAt(idx, 1);
        _currentItems.splice(idx, 1);
        store.set('items', _currentItems);
      },

      updateMany(items) {
        let changedCount = 0;
        for (const newItem of items) {
          const key = _keyFn ? String(_keyFn(newItem)) : DiffEngine.extractKey(newItem, _keyField);
          if (key === undefined) continue;
          const idx = _currentItems.findIndex((item, i) => _extractKey(item, i) === key);
          if (idx === -1) continue;
          _currentItems[idx] = newItem;
          vl.updateItem(idx, newItem);
          changedCount++;
        }
        if (changedCount > 0) store.set('items', _currentItems);
        if (onUpdate) try { onUpdate({ added: 0, removed: 0, changed: changedCount }); } catch (_) {}
      },

      // ── Async Worker ──────────────────────────────────────────────────────
      async filter(predicates) {
        store.set('loading', true);
        try {
          const f = await worker.filter(_originalData, predicates);
          _applyDiff(f);
          store.set({ items: _currentItems, loading: false, error: null });
        } catch (e) { store.set({ loading: false, error: e.message }); }
      },

      async sort(field, dir) {
        store.set('loading', true);
        try {
          const s = await worker.sort(_currentItems, field, dir);
          _applyDiff(s);
          store.set({ items: _currentItems, loading: false, error: null });
        } catch (e) { store.set({ loading: false, error: e.message }); }
      },

      resetFilter() {
        _applyDiff(_originalData.slice());
        store.set({ items: _currentItems, loading: false, error: null });
      },

      async paginate(page, sz) {
        store.set('loading', true);
        try {
          const r = await worker.paginate(_originalData, page, sz);
          _applyDiff(r.items);
          store.set({ items: _currentItems, loading: false });
          return r;
        } catch (e) { store.set({ loading: false, error: e.message }); throw e; }
      },

      // ── UI ────────────────────────────────────────────────────────────────
      setLang(lang)              { store.set('lang', lang); vl.setLang(lang); },
      scrollTo(index, behavior)  { vl.scrollToIndex(index, behavior); },

      scrollToKey(keyValue, behavior = 'smooth') {
        const kv  = String(keyValue);
        const idx = _currentItems.findIndex((item, i) => _extractKey(item, i) === kv);
        if (idx !== -1) vl.scrollToIndex(idx, behavior);
      },

      refresh() { vl.refresh(); },

      // ── Visibility ────────────────────────────────────────────────────────
      getVisibleRange() { return vl.getVisibleRange(); },

      // ── State ─────────────────────────────────────────────────────────────
      on(key, fn)    { return store.on(key, fn); },
      onAny(fn)      { return store.onAny(fn); },

      // ── Read-only ─────────────────────────────────────────────────────────
      get itemCount() { return _currentItems.length; },
      get lang()      { return store.get('lang'); },
      get loading()   { return store.get('loading'); },

      // ── Debug ─────────────────────────────────────────────────────────────
      stats() {
        return {
          vl     : vl.stats(),
          worker : { workerMode: worker.isWorkerMode },
          store  : store.snapshot(),
          cache  : { heightEntries: _heightCache.size, cacheKey: _resolvedCacheKey },
        };
      },

      destroy() {
        // Persist before teardown so the next mount has fresh data
        _persistAll();
        window.removeEventListener('languageChange',    _onLangChange);
        document.removeEventListener('visibilitychange', _onVisibilityChange);
        window.removeEventListener('pagehide',          _onPageHide);
        if (screen.orientation) {
          screen.orientation.removeEventListener('change', _onOrientationChange);
        } else {
          window.removeEventListener('orientationchange', _onOrientationChange);
        }
        vl.destroy(); lazy.destroy(); worker.destroy(); store.destroy();
        container.removeAttribute(CONFIG.DOM.CONTAINER_ATTR);
        _registry.delete(container);
      },
    };

    _registry.set(container, handle);
    return handle;
  }

  function getInstance(container) {
    const el = typeof container === 'string' ? document.querySelector(container) : container;
    return _registry.get(el) || null;
  }

  function destroyAll() {
    for (const [, i] of _registry) try { i.destroy(); } catch (_) {}
    _registry.clear();
  }

  M.Engine = Object.freeze({ mount, getInstance, destroyAll });

})(window.UREModules = window.UREModules || {});