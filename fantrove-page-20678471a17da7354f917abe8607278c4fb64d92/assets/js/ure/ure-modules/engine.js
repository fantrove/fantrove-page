// Path:    assets/js/ure/ure-modules/engine.js
// Purpose: Main orchestrator — wires all modules together and exposes the
//          public EngineHandle returned by URE.mount().
//
// v1.5.0  Height cache, scroll persistence, orientation invalidation.
// v1.6.0  Large-dataset complexity control: worker persistence, loadChunked.
// v1.7.0  Adaptive memory management:
//
//   Mount-time: initial budget from MemoryManager clamps poolCap and buffer
//     so low-memory devices start with conservative allocations immediately.
//
//   Runtime: subscribes to MemoryManager.on() — on each pressure change:
//     • Propagates full budget to vl.setMemoryBudget()
//     • Trims _heightCache to HEIGHT_CACHE_MAX
//     • On CRITICAL + page hidden: clears worker stored data to reclaim the
//       largest single in-memory allocation. Worker data is reloaded
//       automatically on the next setData() / loadChunked() call.
//
//   _unsubMemory is stored and called in destroy() to prevent listener leaks
//   across SPA route changes where URE.destroyAll() is called.

(function (M) {
  'use strict';

  const {
    CONFIG, Scheduler, DiffEngine, MemoryManager,
    createStateStore, createVirtualList, createLazyAssets, createWorkerBridge,
  } = M;

  const _registry = new Map();

  // ── Height cache helpers ──────────────────────────────────────────────────

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

  function _saveHeightCache(storageKey, cache) {
    if (cache.size === 0) return;
    try {
      let entries = Array.from(cache.entries());
      if (entries.length > CONFIG.CACHE.MAX_ENTRIES) {
        entries = entries.slice(-CONFIG.CACHE.MAX_ENTRIES);
      }
      sessionStorage.setItem(storageKey, JSON.stringify({ v: CONFIG.CACHE.VERSION, d: entries }));
    } catch (_) {}
  }

  function _loadScrollPos(key) {
    try { const r = sessionStorage.getItem(key); return r ? (parseFloat(r) || 0) : 0; } catch (_) { return 0; }
  }

  function _saveScrollPos(key, pos) {
    try { sessionStorage.setItem(key, String(pos)); } catch (_) {}
  }

  // ── Height cache trim helper (v1.7.0) ─────────────────────────────────────
  // Removes the oldest entries (Map insertion order) until size ≤ maxEntries.

  function _trimHeightCache(cache, maxEntries) {
    while (cache.size > maxEntries) {
      cache.delete(cache.keys().next().value);
    }
  }

  // ── mount ─────────────────────────────────────────────────────────────────

  function mount(opts = {}) {
    const container = typeof opts.container === 'string'
      ? document.querySelector(opts.container) : opts.container;
    if (!container) throw new Error('[URE/Engine] container not found: ' + opts.container);
    if (_registry.has(container)) _registry.get(container).destroy();

    const {
      data        = [],
      template,
      buffer      = CONFIG.RENDER.DEFAULT_BUFFER_PX,
      recycling   = true,
      diffing     = true,
      keyField    = CONFIG.DIFF.FALLBACK_KEY_FIELD,
      itemKey,
      lang        = (typeof localStorage !== 'undefined' && localStorage.getItem('selectedLang')) || 'en',
      poolCap     = CONFIG.RENDER.DEFAULT_POOL_CAP,
      horizontal  = false,
      columns     = CONFIG.GRID.DEFAULT_COLUMNS,
      gap         = CONFIG.GRID.DEFAULT_GAP_PX,
      overscan    = CONFIG.RENDER.DEFAULT_OVERSCAN,
      cacheKey,
      onVisible, onHidden, onUpdate, onItemClick, onScrollEnd,
    } = opts;

    if (typeof template !== 'function') throw new Error('[URE/Engine] template function is required');

    const _keyFn    = typeof itemKey === 'function' ? itemKey : null;
    const _keyField = keyField;

    function _extractKey(item, i) {
      if (_keyFn) { try { return String(_keyFn(item)); } catch (_) {} }
      const k = DiffEngine.extractKey(item, _keyField);
      return k !== undefined ? k : `__idx_${i}`;
    }

    function _cacheKeyFor(item, i) {
      const k = _extractKey(item, i);
      return k.startsWith('__idx_') ? null : k;
    }

    // ── Persistence setup ─────────────────────────────────────────────────
    const _resolvedCacheKey = cacheKey
      || (container.id ? `${container.id}_${_keyField}` : _keyField);
    const _hCacheKey = CONFIG.CACHE.HEIGHT_PREFIX + _resolvedCacheKey;
    const _sCacheKey = CONFIG.CACHE.SCROLL_PREFIX + _resolvedCacheKey;

    const _heightCache      = _loadHeightCache(_hCacheKey);
    const _scrollRestorePos = _loadScrollPos(_sCacheKey);

    // ── v1.7.0: apply initial memory budget ─────────────────────────────
    // Take the more conservative of user option and current memory budget.
    // This ensures low-memory devices (TIGHT/CRITICAL) start with small caps
    // rather than mounting at comfortable defaults and then immediately trimming.
    const _initBudget       = MemoryManager.getAllBudgets();
    const _effectivePoolCap = Math.min(poolCap, _initBudget.POOL_CAP);
    const _effectiveBuffer  = Math.min(buffer,  _initBudget.BUFFER_PX);

    // ── Core state ────────────────────────────────────────────────────────
    const store = createStateStore({ items: data.slice(), lang, loading: false, error: null });
    let _currentItems = data.slice();
    let _originalData = data.slice();

    container.setAttribute(CONFIG.DOM.CONTAINER_ATTR, '');

    const lazy   = createLazyAssets(_effectiveBuffer);
    const worker = createWorkerBridge();
    const _scrollEl = document.scrollingElement || document.documentElement;

    const vl = createVirtualList({
      container,
      viewport         : _scrollEl,
      items            : _currentItems,
      renderFn         : _render,
      lang,
      buffer           : _effectiveBuffer,
      recycling,
      poolCap          : _effectivePoolCap,
      horizontal,
      columns,
      gap,
      overscan,
      onVisible        : _onVisible,
      onHidden,
      onScrollEnd,
      heightCache      : _heightCache,
      keyExtractor     : _cacheKeyFor,
      scrollRestorePos : _scrollRestorePos,
    });

    vl.mount();

    // ── v1.7.0: subscribe to memory pressure changes ──────────────────────
    const _unsubMemory = MemoryManager.on(_onMemoryPressure);

    // ── v1.6.0: pre-load large datasets into worker ───────────────────────
    function _maybeLoadWorkerData(items) {
      // Use current budget threshold — adapts to memory pressure
      const threshold = MemoryManager.getBudget('WORKER_PERSIST_N')
        ?? CONFIG.LARGE_DATASET.WORKER_PERSIST_N;
      if (items.length < threshold) return;
      worker.loadData(items).catch(err => {
        console.warn('[URE/Engine] worker.loadData failed:', err.message);
      });
    }

    _maybeLoadWorkerData(_originalData);

    // ── Memory pressure handler (v1.7.0) ──────────────────────────────────
    // Responds to MemoryManager pressure changes by:
    //   1. Propagating the full budget to virtual-list (trims caches immediately)
    //   2. Trimming the height cache to its new budget limit
    //   3. On CRITICAL + hidden: releasing worker stored data
    function _onMemoryPressure(next /*, prev */) {
      const budget = MemoryManager.getAllBudgets();
      vl.setMemoryBudget(budget);
      _trimHeightCache(_heightCache, budget.HEIGHT_CACHE_MAX);
      if (next === MemoryManager.PRESSURE.CRITICAL && document.hidden && worker.dataLoaded) {
        // Release the largest in-memory allocation. Will be reloaded on next
        // setData() / loadChunked() when the page becomes active again.
        worker.clearData().catch(() => {});
      }
    }

    // ── Delegated click ───────────────────────────────────────────────────
    if (onItemClick) {
      container.addEventListener('click', (e) => {
        const itemEl = e.target.closest(`[${CONFIG.DOM.ITEM_ATTR}]`);
        if (!itemEl) return;
        const idx  = parseInt(itemEl.getAttribute(CONFIG.DOM.ITEM_ATTR), 10);
        const item = _currentItems[idx];
        if (item) try { onItemClick(e, item); } catch (_) {}
      }, { passive: true });
    }

    window.addEventListener('languageChange', _onLangChange, { passive: true });

    function _onLangChange(e) {
      const newLang = e?.detail?.language || localStorage.getItem('selectedLang') || 'en';
      if (newLang === store.get('lang')) return;
      store.set('lang', newLang);
      vl.setLang(newLang);
    }

    function _render(item, l) {
      try { return template(item, l || store.get('lang')); }
      catch (e) {
        console.error('[URE/Engine] template error:', e);
        return `<div class="ure-render-error">Render error</div>`;
      }
    }

    function _onVisible(item, el) {
      lazy.observe(el);
      if (onVisible) try { onVisible(item, el); } catch (_) {}
    }

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

    // ── Persistence lifecycle ─────────────────────────────────────────────
    function _persistAll() {
      _saveHeightCache(_hCacheKey, _heightCache);
      const el = document.scrollingElement || document.documentElement;
      _saveScrollPos(_sCacheKey, el.scrollTop);
    }

    function _onOrientationChange() {
      _heightCache.clear();
      try { sessionStorage.removeItem(_hCacheKey); } catch (_) {}
    }

    const _onVisibilityChange = () => { if (document.hidden) _persistAll(); };
    const _onPageHide         = () => _persistAll();

    document.addEventListener('visibilitychange', _onVisibilityChange);
    window.addEventListener('pagehide', _onPageHide);
    if (screen.orientation) {
      screen.orientation.addEventListener('change', _onOrientationChange);
    } else {
      window.addEventListener('orientationchange', _onOrientationChange);
    }

    // ── Idle yield helper ─────────────────────────────────────────────────
    function _idleYield(timeoutMs = 200) {
      return new Promise(r => {
        typeof requestIdleCallback !== 'undefined'
          ? requestIdleCallback(r, { timeout: timeoutMs })
          : setTimeout(r, 16);
      });
    }

    // ── Public handle ─────────────────────────────────────────────────────
    const handle = {

      setData(newData) {
        _originalData = newData.slice();
        _applyDiff(newData);
        store.set('items', _currentItems);
        _maybeLoadWorkerData(_originalData);
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

      async loadChunked(source, chunkSize = CONFIG.LARGE_DATASET.INIT_CHUNK_SIZE) {
        const isAsync = source != null && typeof source[Symbol.asyncIterator] === 'function';

        async function* _toChunks() {
          if (isAsync) {
            for await (const chunk of source) {
              yield Array.isArray(chunk) ? chunk : [chunk];
            }
          } else {
            for (let i = 0; i < source.length; i += chunkSize) {
              yield source.slice(i, i + chunkSize);
            }
          }
        }

        let first = true;
        for await (const chunk of _toChunks()) {
          if (first) { handle.setData(chunk); first = false; }
          else        { handle.append(chunk); }
          if (!isAsync) await _idleYield();
        }
        _maybeLoadWorkerData(_originalData);
      },

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

      setLang(lang)             { store.set('lang', lang); vl.setLang(lang); },
      scrollTo(index, behavior) { vl.scrollToIndex(index, behavior); },

      scrollToKey(keyValue, behavior = 'smooth') {
        const kv  = String(keyValue);
        const idx = _currentItems.findIndex((item, i) => _extractKey(item, i) === kv);
        if (idx !== -1) vl.scrollToIndex(idx, behavior);
      },

      refresh()          { vl.refresh(); },
      getVisibleRange()  { return vl.getVisibleRange(); },

      on(key, fn)  { return store.on(key, fn); },
      onAny(fn)    { return store.onAny(fn); },

      get itemCount() { return _currentItems.length; },
      get lang()      { return store.get('lang'); },
      get loading()   { return store.get('loading'); },

      stats() {
        return {
          vl     : vl.stats(),
          worker : { workerMode: worker.isWorkerMode, dataLoaded: worker.dataLoaded },
          store  : store.snapshot(),
          cache  : { heightEntries: _heightCache.size, cacheKey: _resolvedCacheKey },
          // v1.7.0: memory pressure snapshot
          memory : MemoryManager.stats(),
        };
      },

      destroy() {
        _persistAll();
        _unsubMemory();   // unsubscribe from MemoryManager — prevents listener leak
        window.removeEventListener('languageChange',     _onLangChange);
        document.removeEventListener('visibilitychange', _onVisibilityChange);
        window.removeEventListener('pagehide',           _onPageHide);
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