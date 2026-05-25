// Path:    assets/js/ure/ure-modules/engine.js
// Purpose: Main orchestrator — wires all modules together and exposes the
//          public EngineHandle returned by URE.mount().
//
// Changes v1.3.0:
//   New mount options:
//     columns     — multi-column grid layout (passed to virtual-list)
//     gap         — gap between items/rows in px
//     overscan    — items beyond viewport to pre-render (alternative to buffer px)
//     onScrollEnd — callback fired once per scroll-idle period
//     itemKey     — function (item) => string for key extraction (overrides keyField)
//   New handle methods:
//     updateMany(items)              — batch-update items by key, more efficient than
//                                      calling setData() for small changes
//     scrollToKey(keyValue, bhv)     — scroll to item by its key value
//     getVisibleRange()              — { startIndex, endIndex } of mounted items

(function (M) {
  'use strict';

  const {
    CONFIG, Scheduler, DiffEngine,
    createStateStore, createVirtualList, createLazyAssets, createWorkerBridge,
  } = M;

  const _registry = new Map();

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
      itemKey,          // optional (item) => string — overrides keyField string
      lang            = (typeof localStorage !== 'undefined' && localStorage.getItem('selectedLang')) || 'en',
      poolCap         = CONFIG.RENDER.DEFAULT_POOL_CAP,
      horizontal      = false,
      columns         = CONFIG.GRID.DEFAULT_COLUMNS,
      gap             = CONFIG.GRID.DEFAULT_GAP_PX,
      overscan        = CONFIG.RENDER.DEFAULT_OVERSCAN,
      onVisible, onHidden, onUpdate, onItemClick, onScrollEnd,
    } = opts;

    if (typeof template !== 'function') throw new Error('[URE/Engine] template function is required');

    // Normalise key extraction: itemKey function takes priority over keyField string
    const _keyFn   = typeof itemKey === 'function' ? itemKey : null;
    const _keyField = keyField;

    function _extractKey(item, i) {
      if (_keyFn) {
        try { return String(_keyFn(item)); } catch (_) {}
      }
      const k = DiffEngine.extractKey(item, _keyField);
      return k !== undefined ? k : `__idx_${i}`;
    }

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
      onVisible : _onVisible,
      onHidden,
      onScrollEnd,
    });

    vl.mount();

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
      catch (e) { console.error('[URE/Engine] template error:', e); return `<div class="ure-render-error">Render error</div>`; }
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
        _currentItems = newItems; vl.setItems(_currentItems);
        if (onUpdate) try { onUpdate({ added: newItems.length, removed: 0, changed: 0 }); } catch (_) {}
        return;
      }
      const removedIndices = [];
      for (const key of result.removed) {
        const idx = _currentItems.findIndex((item, i) => _extractKey(item, i) === key);
        if (idx !== -1) removedIndices.push(idx);
      }
      removedIndices.sort((a, b) => b - a).forEach(idx => { vl.removeAt(idx, 1); _currentItems.splice(idx, 1); });
      for (const [, { index, item }] of result.changed) { _currentItems[index] = item; vl.updateItem(index, item); }
      for (const [, { item }] of result.added) { _currentItems.push(item); vl.insertAt(_currentItems.length - 1, [item]); }
      if (onUpdate) try { onUpdate({ added: result.added.size, removed: result.removed.size, changed: result.changed.size }); } catch (_) {}
    }

    const handle = {
      // ── Data ───────────────────────────────────────────────────────────────
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

      /**
       * Batch-update multiple items by their key values.
       * More efficient than setData() for small sets of changes because only
       * the matched items are re-rendered instead of diffing the whole list.
       *
       * @param {any[]} items — partial or complete item objects; each must have
       *                        the field identified by keyField / itemKey.
       */
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

      // ── Async Worker operations ────────────────────────────────────────────
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

      // ── UI ─────────────────────────────────────────────────────────────────
      setLang(lang)              { store.set('lang', lang); vl.setLang(lang); },
      scrollTo(index, behavior)  { vl.scrollToIndex(index, behavior); },

      /**
       * Scroll to the item matching keyValue.
       * @param {string|number} keyValue
       * @param {'smooth'|'instant'|'auto'} [behavior='smooth']
       */
      scrollToKey(keyValue, behavior = 'smooth') {
        const kv  = String(keyValue);
        const idx = _currentItems.findIndex((item, i) => _extractKey(item, i) === kv);
        if (idx !== -1) vl.scrollToIndex(idx, behavior);
      },

      refresh() { vl.refresh(); },

      // ── Visibility ─────────────────────────────────────────────────────────
      /** @returns {{ startIndex: number, endIndex: number }} */
      getVisibleRange() { return vl.getVisibleRange(); },

      // ── State subscription ─────────────────────────────────────────────────
      on(key, fn)    { return store.on(key, fn); },
      onAny(fn)      { return store.onAny(fn); },

      // ── Read-only properties ───────────────────────────────────────────────
      get itemCount() { return _currentItems.length; },
      get lang()      { return store.get('lang'); },
      get loading()   { return store.get('loading'); },

      // ── Debug ──────────────────────────────────────────────────────────────
      stats() { return { vl: vl.stats(), worker: { workerMode: worker.isWorkerMode }, store: store.snapshot() }; },

      destroy() {
        window.removeEventListener('languageChange', _onLangChange);
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