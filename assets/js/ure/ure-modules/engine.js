// Path:    assets/js/ure/ure-modules/engine.js
// Purpose: Main engine orchestrator. Wires VirtualList + DiffEngine +
//          LazyAssets + WorkerBridge + StateStore into a single public API.
//          Each call to Engine.mount() creates a fully-isolated instance.
// Used by: ure.js (public entry point)

(function (M) {
  'use strict';

  const {
    CONFIG,
    Scheduler,
    DiffEngine,
    createStateStore,
    createVirtualList,
    createLazyAssets,
    createWorkerBridge,
  } = M;

  // ── Instance registry: one entry per active mount ─────────────────────────
  // Prevents multiple mounts on the same container from conflicting.
  const _registry = new Map(); // container Element → instance

  // ── Engine factory ────────────────────────────────────────────────────────

  /**
   * Mount the URE on a container element and return a handle to control it.
   *
   * @param {UREngineOptions} opts
   * @returns {EngineHandle}
   */
  function mount(opts = {}) {

    // ── Resolve container ────────────────────────────────────────────────────
    const container = typeof opts.container === 'string'
      ? document.querySelector(opts.container)
      : opts.container;

    if (!container) throw new Error('[URE/Engine] container not found: ' + opts.container);

    // Unmount any existing instance on this container
    if (_registry.has(container)) {
      _registry.get(container).destroy();
    }

    // ── Options with defaults ────────────────────────────────────────────────
    const {
      data            = [],
      template,
      estimatedItemHeight = CONFIG.RENDER.DEFAULT_ITEM_HEIGHT,
      buffer          = CONFIG.RENDER.DEFAULT_BUFFER_PX,
      recycling       = true,
      diffing         = true,
      keyField        = CONFIG.DIFF.FALLBACK_KEY_FIELD,
      lang            = (typeof localStorage !== 'undefined' && localStorage.getItem('selectedLang')) || 'en',
      poolCap         = CONFIG.RENDER.DEFAULT_POOL_CAP,
      onVisible,
      onHidden,
      onUpdate,
      onItemClick,
    } = opts;

    if (typeof template !== 'function') throw new Error('[URE/Engine] template function is required');

    // ── Internal state ───────────────────────────────────────────────────────
    const store = createStateStore({
      items    : data.slice(),
      lang,
      loading  : false,
      error    : null,
    });

    // Current authoritative item array (may differ from store after worker ops)
    let _currentItems = data.slice();
    let _originalData = data.slice(); // pre-filter snapshot

    // ── Sub-systems ──────────────────────────────────────────────────────────
    // Mark container so CSS can scope styles
    container.setAttribute(CONFIG.DOM.CONTAINER_ATTR, '');

    const lazy   = createLazyAssets(buffer);
    const worker = createWorkerBridge();

    // Viewport: support both window-scroll and internal scroll
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
      onVisible : _onVisible,
      onHidden,
    });

    vl.mount();

    // ── Delegated click handler ──────────────────────────────────────────────
    if (onItemClick) {
      container.addEventListener('click', (e) => {
        const itemEl = e.target.closest(`[${CONFIG.DOM.ITEM_ATTR}]`);
        if (!itemEl) return;
        const idx  = parseInt(itemEl.getAttribute(CONFIG.DOM.ITEM_ATTR), 10);
        const item = _currentItems[idx];
        if (item) try { onItemClick(e, item); } catch (_) {}
      }, { passive: true });
    }

    // ── Language change listener ─────────────────────────────────────────────
    window.addEventListener('languageChange', _onLangChange, { passive: true });

    function _onLangChange(e) {
      const newLang = e?.detail?.language || localStorage.getItem('selectedLang') || 'en';
      if (newLang === store.get('lang')) return;
      store.set('lang', newLang);
      vl.setLang(newLang);
    }

    // ── Template wrapper ─────────────────────────────────────────────────────
    function _render(item, l) {
      try {
        return template(item, l || store.get('lang'));
      } catch (e) {
        console.error('[URE/Engine] template error:', e);
        return `<div class="ure-render-error">Render error</div>`;
      }
    }

    // ── Visible callback — auto-observe lazy assets ──────────────────────────
    function _onVisible(item, el) {
      lazy.observe(el);
      if (onVisible) try { onVisible(item, el); } catch (_) {}
    }

    // ── Data mutation helpers ────────────────────────────────────────────────

    function _applyDiff(newItems) {
      if (!diffing || _currentItems.length === 0) {
        // Full replace (faster for initial load or large replace)
        _currentItems = newItems;
        vl.setItems(_currentItems);
        if (onUpdate) try { onUpdate({ added: newItems.length, removed: 0, changed: 0 }); } catch (_) {}
        return;
      }

      const result = DiffEngine.diff(_currentItems, newItems, keyField);

      if (result.fullReplace) {
        _currentItems = newItems;
        vl.setItems(_currentItems);
        if (onUpdate) try { onUpdate({ added: newItems.length, removed: 0, changed: 0 }); } catch (_) {}
        return;
      }

      // Apply removed (reverse order to preserve indices)
      const removedIndices = [];
      for (const key of result.removed) {
        const idx = _currentItems.findIndex((item, i) => DiffEngine.extractKey(item, keyField) === key || `__idx_${i}` === key);
        if (idx !== -1) removedIndices.push(idx);
      }
      removedIndices.sort((a, b) => b - a).forEach(idx => {
        vl.removeAt(idx, 1);
        _currentItems.splice(idx, 1);
      });

      // Apply changed
      for (const [, { index, item }] of result.changed) {
        _currentItems[index] = item;
        vl.updateItem(index, item);
      }

      // Apply added (at tail for simplicity; move logic reserved for v2)
      for (const [, { item }] of result.added) {
        _currentItems.push(item);
        vl.insertAt(_currentItems.length - 1, [item]);
      }

      if (onUpdate) try { onUpdate({ added: result.added.size, removed: result.removed.size, changed: result.changed.size }); } catch (_) {}
    }

    // ── Public handle ────────────────────────────────────────────────────────

    const handle = {

      // ── Data operations ────────────────────────────────────────────────────

      /**
       * Replace all data. Diff engine decides what actually re-renders.
       * @param {any[]} newData
       */
      setData(newData) {
        _originalData = newData.slice();
        _applyDiff(newData);
        store.set('items', _currentItems);
      },

      /**
       * Append items to the end of the list.
       * @param {any[]} items
       */
      append(items) {
        const appended = items.slice();
        const newFull  = _currentItems.concat(appended);
        _originalData  = newFull.slice();
        vl.insertAt(_currentItems.length, appended);
        _currentItems  = newFull;
        store.set('items', _currentItems);
        if (onUpdate) try { onUpdate({ added: appended.length, removed: 0, changed: 0 }); } catch (_) {}
      },

      /**
       * Prepend items to the top of the list.
       * @param {any[]} items
       */
      prepend(items) {
        const prepended = items.slice();
        vl.insertAt(0, prepended);
        _currentItems   = prepended.concat(_currentItems);
        _originalData   = _currentItems.slice();
        store.set('items', _currentItems);
        if (onUpdate) try { onUpdate({ added: prepended.length, removed: 0, changed: 0 }); } catch (_) {}
      },

      /**
       * Remove an item by its key value.
       * @param {any} keyValue
       */
      removeByKey(keyValue) {
        const idx = _currentItems.findIndex(item => DiffEngine.extractKey(item, keyField) === String(keyValue));
        if (idx === -1) return;
        vl.removeAt(idx, 1);
        _currentItems.splice(idx, 1);
        store.set('items', _currentItems);
      },

      // ── Worker-powered data operations ────────────────────────────────────

      /**
       * Filter items using a predicate descriptor (runs in Worker).
       * Preserves original data so filters can be reset.
       *
       * Predicate format:
       *   { field: 'name', op: 'includes', value: 'hello' }
       *   or array of predicates (AND logic)
       *
       * @param {object|object[]} predicates
       * @returns {Promise<void>}
       */
      async filter(predicates) {
        store.set('loading', true);
        try {
          const filtered = await worker.filter(_originalData, predicates);
          _applyDiff(filtered);
          store.set({ items: _currentItems, loading: false, error: null });
        } catch (e) {
          store.set({ loading: false, error: e.message });
          console.error('[URE/Engine] filter error:', e);
        }
      },

      /**
       * Sort items (runs in Worker).
       * @param {string} field
       * @param {'asc'|'desc'} [dir='asc']
       * @returns {Promise<void>}
       */
      async sort(field, dir = 'asc') {
        store.set('loading', true);
        try {
          const sorted = await worker.sort(_currentItems, field, dir);
          _applyDiff(sorted);
          store.set({ items: _currentItems, loading: false, error: null });
        } catch (e) {
          store.set({ loading: false, error: e.message });
        }
      },

      /**
       * Reset any active filter, restoring the original data.
       */
      resetFilter() {
        _applyDiff(_originalData.slice());
        store.set({ items: _currentItems, loading: false, error: null });
      },

      /**
       * Paginate (runs in Worker). Returns page metadata.
       * Replaces the visible list with the requested page.
       * @param {number} page
       * @param {number} pageSize
       * @returns {Promise<{items, total, totalPages, page, pageSize}>}
       */
      async paginate(page, pageSize) {
        store.set('loading', true);
        try {
          const result = await worker.paginate(_originalData, page, pageSize);
          _applyDiff(result.items);
          store.set({ items: _currentItems, loading: false });
          return result;
        } catch (e) {
          store.set({ loading: false, error: e.message });
          throw e;
        }
      },

      // ── UI controls ────────────────────────────────────────────────────────

      /**
       * Change the active language. All visible nodes re-render immediately.
       * @param {string} lang
       */
      setLang(lang) {
        store.set('lang', lang);
        vl.setLang(lang);
      },

      /**
       * Scroll to a specific item by its index.
       * @param {number} index
       * @param {'smooth'|'instant'} [behavior='smooth']
       */
      scrollTo(index, behavior = 'smooth') {
        vl.scrollToIndex(index, behavior);
      },

      /**
       * Force a geometry refresh (call after CSS changes or container resize).
       */
      refresh() { vl.refresh(); },

      // ── State access ────────────────────────────────────────────────────────

      /** Subscribe to internal state changes. @see StateStore.on */
      on    : (key, fn) => store.on(key, fn),
      onAny : (fn)      => store.onAny(fn),

      /** Current number of rendered items. */
      get itemCount() { return _currentItems.length; },

      /** Current language. */
      get lang() { return store.get('lang'); },

      /** True while an async worker operation is in progress. */
      get loading() { return store.get('loading'); },

      /** Debug stats. */
      stats() {
        return {
          vl    : vl.stats(),
          worker: { workerMode: worker.isWorkerMode },
          store : store.snapshot(),
        };
      },

      // ── Teardown ────────────────────────────────────────────────────────────

      /**
       * Full unmount. Disconnects all observers, terminates worker,
       * drains pool, removes DOM. Safe to call multiple times.
       */
      destroy() {
        window.removeEventListener('languageChange', _onLangChange);
        vl.destroy();
        lazy.destroy();
        worker.destroy();
        store.destroy();
        container.removeAttribute(CONFIG.DOM.CONTAINER_ATTR);
        _registry.delete(container);
      },
    };

    _registry.set(container, handle);
    return handle;
  }

  // ── Registry query helpers ─────────────────────────────────────────────────

  /** Get an existing instance by its container element or selector. */
  function getInstance(container) {
    const el = typeof container === 'string' ? document.querySelector(container) : container;
    return _registry.get(el) || null;
  }

  /** Destroy every active instance (useful for SPA navigation cleanup). */
  function destroyAll() {
    for (const [, instance] of _registry) {
      try { instance.destroy(); } catch (_) {}
    }
    _registry.clear();
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  M.Engine = Object.freeze({ mount, getInstance, destroyAll });

})(window.UREModules = window.UREModules || {});