// Path:    assets/js/ure/ure-modules/engine.js
// Purpose: Main orchestrator — adds `horizontal` option for axis-aware virtual scroll.
// Change from base: destructure + pass `horizontal` to createVirtualList.

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
      lang            = (typeof localStorage !== 'undefined' && localStorage.getItem('selectedLang')) || 'en',
      poolCap         = CONFIG.RENDER.DEFAULT_POOL_CAP,
      horizontal      = false,   // ← horizontal scroll mode
      onVisible, onHidden, onUpdate, onItemClick,
    } = opts;

    if (typeof template !== 'function') throw new Error('[URE/Engine] template function is required');

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
      horizontal,         // ← passed through
      onVisible : _onVisible,
      onHidden,
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
      const result = DiffEngine.diff(_currentItems, newItems, keyField);
      if (result.fullReplace) {
        _currentItems = newItems; vl.setItems(_currentItems);
        if (onUpdate) try { onUpdate({ added: newItems.length, removed: 0, changed: 0 }); } catch (_) {}
        return;
      }
      const removedIndices = [];
      for (const key of result.removed) {
        const idx = _currentItems.findIndex((item, i) => DiffEngine.extractKey(item, keyField) === key || `__idx_${i}` === key);
        if (idx !== -1) removedIndices.push(idx);
      }
      removedIndices.sort((a, b) => b - a).forEach(idx => { vl.removeAt(idx, 1); _currentItems.splice(idx, 1); });
      for (const [, { index, item }] of result.changed) { _currentItems[index] = item; vl.updateItem(index, item); }
      for (const [, { item }] of result.added) { _currentItems.push(item); vl.insertAt(_currentItems.length - 1, [item]); }
      if (onUpdate) try { onUpdate({ added: result.added.size, removed: result.removed.size, changed: result.changed.size }); } catch (_) {}
    }

    const handle = {
      setData(newData)          { _originalData = newData.slice(); _applyDiff(newData); store.set('items', _currentItems); },
      append(items)             { const a = items.slice(); const f = _currentItems.concat(a); _originalData = f.slice(); vl.insertAt(_currentItems.length, a); _currentItems = f; store.set('items', _currentItems); if (onUpdate) try { onUpdate({ added: a.length, removed: 0, changed: 0 }); } catch (_) {} },
      prepend(items)            { const p = items.slice(); vl.insertAt(0, p); _currentItems = p.concat(_currentItems); _originalData = _currentItems.slice(); store.set('items', _currentItems); if (onUpdate) try { onUpdate({ added: p.length, removed: 0, changed: 0 }); } catch (_) {} },
      removeByKey(keyValue)     { const idx = _currentItems.findIndex(item => DiffEngine.extractKey(item, keyField) === String(keyValue)); if (idx === -1) return; vl.removeAt(idx, 1); _currentItems.splice(idx, 1); store.set('items', _currentItems); },
      async filter(predicates)  { store.set('loading', true); try { const f = await worker.filter(_originalData, predicates); _applyDiff(f); store.set({ items: _currentItems, loading: false, error: null }); } catch (e) { store.set({ loading: false, error: e.message }); } },
      async sort(field, dir)    { store.set('loading', true); try { const s = await worker.sort(_currentItems, field, dir); _applyDiff(s); store.set({ items: _currentItems, loading: false, error: null }); } catch (e) { store.set({ loading: false, error: e.message }); } },
      resetFilter()             { _applyDiff(_originalData.slice()); store.set({ items: _currentItems, loading: false, error: null }); },
      async paginate(page, sz)  { store.set('loading', true); try { const r = await worker.paginate(_originalData, page, sz); _applyDiff(r.items); store.set({ items: _currentItems, loading: false }); return r; } catch (e) { store.set({ loading: false, error: e.message }); throw e; } },
      setLang(lang)             { store.set('lang', lang); vl.setLang(lang); },
      scrollTo(index, behavior) { vl.scrollToIndex(index, behavior); },
      refresh()                 { vl.refresh(); },
      on(key, fn)               { return store.on(key, fn); },
      onAny(fn)                 { return store.onAny(fn); },
      get itemCount()           { return _currentItems.length; },
      get lang()                { return store.get('lang'); },
      get loading()             { return store.get('loading'); },
      stats()                   { return { vl: vl.stats(), worker: { workerMode: worker.isWorkerMode }, store: store.snapshot() }; },
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