// contentManager.js  v3.2 — Search-Aligned Rendering
// =====================================================
// All public APIs (renderContent, clearContent, createButton, createCard, etc.)
// remain unchanged. Only the rendering engine internals are upgraded.
//
// TECHNOLOGY ALIGNMENT WITH SEARCH SYSTEM (search-engine.js / search-ui.js)
// ──────────────────────────────────────────────────────────────────────────
// ✅ Same CHUNK_SIZE + yieldToIdle chunked rendering   (← search-engine.js)
// ✅ Same POOL_MAX node-pool pattern                   (← VirtualScrollEngine)
// ✅ Same rIC (data processing) + rAF (DOM write)      (← search-ui.js)
// ✅ Same DocumentFragment single-pass insertion        (← _batchRender)
// ✅ Same CSS containment on item wrappers              (← .search-card rule)
// ✅ Same GPU compositor setup on scroll container     (← overlay scroll)
// ✅ Same PerfMonitor proxy (window.__searchUI.perf)   (← PerfMonitor service)
// ✅ content-visibility:auto + contain-intrinsic-size  (← search.min.css)
//
// REMOVED from old implementation (complexity → replaced by CSS)
// ──────────────────────────────────────────────────────────────
// ✗ _frameSamples / _avgFrameTime / _computeAdaptiveBatchSize
//     → replaced by simple fixed CHUNK_SIZE (same as search-engine.js)
// ✗ MAX_IN_DOM + _animateOutAndRemove hot-path
//     → replaced by content-visibility:auto (CSS native skip, zero JS cost)
// ✗ _poolCleanupTimer / _poolLastUsed
//     → simplified to same POOL_MAX pattern as VirtualScrollEngine
//
// KEPT from old implementation
// ─────────────────────────────
// ✓ Learning worker (priority sort)
// ✓ IntersectionObserver sentinel (lazy loading for jsonFile items)
// ✓ All render* / create* / update* methods (APIs unchanged)

export const contentManager = {

  // ── Constants — aligned with search system ────────────────────
  CHUNK_SIZE : 8,     // items processed per idle callback chunk
                      // (search-engine uses 250, but header items involve
                      //  async API lookups + deep DOM creation → smaller is safer)
  POOL_MAX   : 40,    // max pooled nodes (same as VirtualScrollEngine.POOL_MAX)
  EST_H      : 400,   // estimated wrapper height for contain-intrinsic-size fallback

  // ── State ─────────────────────────────────────────────────────
  _renderSession      : 0,
  _abortController    : null,
  _items              : [],
  _renderedSet        : new Set(),
  _sentinelObserver   : null,
  _isUnmounted        : false,
  _isRenderingNextBatch: false,
  _SENTINEL_ID        : 'headerv2-render-sentinel',

  // ── Node pool (same pattern as VirtualScrollEngine) ───────────
  _pool: [],

  // ── Device info ───────────────────────────────────────────────
  _deviceMemory : navigator.deviceMemory || 4,
  _isSlowDevice : !!(navigator.deviceMemory && navigator.deviceMemory <= 2),

  // ── Learning worker (kept — priority sorting) ─────────────────
  _learningWorker : null,
  _learningData   : { views: {}, clicks: {} },
  _learningEnabled: true,
  _lastScores     : {},

  // ── PerfMonitor proxy ─────────────────────────────────────────
  //   Zero overhead when monitor is disabled (window.__searchUI?.perf is null).
  //   Tags prefixed 'hdr:' so header and search entries don't collide in DevTools.
  _perf: {
    mark   (n)   { try { window.__searchUI?.perf?.mark   ('hdr:' + n); } catch {} },
    measure(n, s){ try { window.__searchUI?.perf?.measure('hdr:' + n, 'hdr:' + s); } catch {} },
  },

  // ── yieldToIdle — same implementation as search-engine.js ─────
  _yieldToIdle() {
    return new Promise(resolve => {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(resolve, { timeout: 200 });
      } else {
        setTimeout(resolve, 0);
      }
    });
  },

  // ── Batch size (simple, device-aware) ─────────────────────────
  _batchSize() {
    return this._isSlowDevice ? 3 : this.CHUNK_SIZE;
  },

  // ── Node pool: acquire with CSS containment ───────────────────
  //   Same technique as VirtualScrollEngine: pop from pool or create new,
  //   apply inline containment styles so every item wrapper is isolated.
  _acquire() {
    const node = this._pool.pop() || document.createElement('div');
    // Apply CSS containment — same property set as .search-card wrapper
    // contain:layout style paint  → isolate repaint/reflow from siblings
    // content-visibility:auto     → browser skips off-screen groups natively
    // contain-intrinsic-size      → accurate scrollbar when groups are skipped
    node.style.cssText =
      'contain:layout style paint;' +
      'content-visibility:auto;' +
      'contain-intrinsic-size:auto ' + this.EST_H + 'px;';
    node.className = '';
    return node;
  },

  // ── Node pool: release ────────────────────────────────────────
  _release(node) {
    if (!node) return;
    try {
      node.innerHTML = '';
      node.className = '';
      node.style.cssText = '';
      node.removeAttribute('id');
    } catch {}
    if (this._pool.length < this.POOL_MAX) this._pool.push(node);
    else { try { node.remove?.(); } catch {} }
  },

  // ── Learning worker helpers (unchanged from v3.0) ─────────────
  _initLearningWorkerIfNeeded(itemsCount = 0) {
    if (!this._learningEnabled || this._learningWorker) return;
    if (itemsCount < 30) return;
    try {
      const workerCode = `
        const state = { views: {}, clicks: {} };
        function score(id) {
          const v = state.views[id] || 0;
          const c = state.clicks[id] || 0;
          return Math.log(1 + v) + (3 * Math.log(1 + c));
        }
        onmessage = function(e) {
          const { type, payload } = e.data || {};
          if (type === 'record') {
            const { kind, id } = payload;
            if (!id) return;
            if (kind === 'view')  state.views[id]  = (state.views[id]  || 0) + 1;
            if (kind === 'click') state.clicks[id] = (state.clicks[id] || 0) + 1;
          } else if (type === 'getScores') {
            const items = payload.items || [];
            const result = {};
            for (const id of items) result[id] = score(id) || 0;
            postMessage({ type: 'scores', payload: result });
          } else if (type === 'hydrate') {
            const { views, clicks } = payload || {};
            if (views)  Object.assign(state.views,  views);
            if (clicks) Object.assign(state.clicks, clicks);
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const url  = URL.createObjectURL(blob);
      this._learningWorker = new Worker(url);
      this._learningWorker.onmessage = (e) => {
        const { type, payload } = e.data || {};
        if (type === 'scores') this._lastScores = payload || {};
      };
      this._learningWorker.postMessage({ type: 'hydrate', payload: this._learningData });
    } catch {
      this._learningWorker = null;
    }
  },

  _recordEvent(kind, id) {
    if (!id) return;
    try {
      if (this._learningWorker) {
        this._learningWorker.postMessage({ type: 'record', payload: { kind, id } });
      } else {
        const bucket = kind === 'click' ? 'clicks' : 'views';
        this._learningData[bucket][id] = (this._learningData[bucket][id] || 0) + 1;
      }
    } catch {}
  },

  _getPriorityScoresFor(ids) {
    return new Promise((resolve) => {
      const fallback = {};
      for (const id of ids) {
        const v = (this._learningData.views  && this._learningData.views[id])  || 0;
        const c = (this._learningData.clicks && this._learningData.clicks[id]) || 0;
        fallback[id] = Math.log(1 + v) + (3 * Math.log(1 + c));
      }
      if (this._learningWorker) {
        const timer = setTimeout(() => resolve(fallback), 80);
        const onmsg = (e) => {
          if (e.data && e.data.type === 'scores') {
            clearTimeout(timer);
            this._learningWorker.removeEventListener('message', onmsg);
            resolve(e.data.payload || fallback);
          }
        };
        this._learningWorker.addEventListener('message', onmsg);
        this._learningWorker.postMessage({ type: 'getScores', payload: { items: ids } });
      } else {
        resolve(fallback);
      }
    });
  },

  // ── clearContent ──────────────────────────────────────────────
  async clearContent() {
    this._renderSession = (this._renderSession || 0) + 1;
    const currentSession = this._renderSession;

    // Abort any in-flight rendering
    try { if (this._abortController) { this._abortController.abort(); this._abortController = null; } } catch {}
    this._isUnmounted = true;
    this._isRenderingNextBatch = false;

    // Remove sentinel
    try {
      const sentinel = document.getElementById(this._SENTINEL_ID);
      if (sentinel && sentinel.parentNode) sentinel.parentNode.removeChild(sentinel);
    } catch {}

    try { window._headerV2_contentLoadingManager.hide(); } catch {}

    // Disconnect IntersectionObserver
    if (this._sentinelObserver) {
      try { this._sentinelObserver.disconnect(); } catch {}
      this._sentinelObserver = null;
    }

    // Clear container + release nodes to pool (single rAF, no layout read)
    const containerId = window._headerV2_contentLoadingManager?.LOADING_CONTAINER_ID || 'content-loading';
    const container = document.getElementById(containerId);
    if (container) {
      requestAnimationFrame(() => {
        try {
          // Batch DOM removal: collect all children first, then remove
          const children = Array.from(container.children);
          for (const child of children) {
            try { container.removeChild(child); } catch {}
            this._release(child);
          }
        } catch {}
      });
    }

    this._items       = [];
    this._renderedSet = new Set();
    return currentSession;
  },

  // ── renderContent ─────────────────────────────────────────────
  async renderContent(data) {
    if (!Array.isArray(data)) throw new Error('Content data should be array');

    const containerId = window._headerV2_contentLoadingManager?.LOADING_CONTAINER_ID || 'content-loading';
    const container   = document.getElementById(containerId);
    if (!container) return;

    await this.clearContent();

    // ── GPU compositor setup — same as search overlay scrollable content ──
    // transform:translateZ(0) promotes the content area to its own GPU layer.
    // Scrolling and fade-in animations then run on the compositor thread,
    // keeping the main thread free for JS work (Fuse search, fetch, etc.)
    if (!container._gpuSetup) {
      Object.assign(container.style, {
        willChange        : 'transform',
        transform         : 'translateZ(0)',
        overscrollBehavior: 'contain',
      });
      container._gpuSetup = true;
    }

    // Show loading overlay (respects sub-nav z-index)
    try {
      const subNavEl = document.getElementById('sub-nav');
      let behindSubNav = false;
      if (subNavEl) {
        try {
          const s = window.getComputedStyle(subNavEl);
          const visible = s.display !== 'none' && s.visibility !== 'hidden' && subNavEl.offsetHeight > 0;
          const cnt = subNavEl.querySelector('#sub-buttons-container');
          if (visible && cnt && cnt.childNodes.length > 0) behindSubNav = true;
        } catch {}
      }
      try { window._headerV2_contentLoadingManager.show({ behindSubNav }); } catch {}
    } catch {}

    // Session + abort controller (same pattern as search-engine chunked build)
    this._renderSession = (this._renderSession || 0) + 1;
    const session            = this._renderSession;
    this._abortController    = new AbortController();
    const signal             = this._abortController.signal;
    this._isUnmounted        = false;
    this._isRenderingNextBatch = false;

    const items = data.slice();
    this._items = items;
    this._initLearningWorkerIfNeeded(items.length);

    // Priority sort via learning worker (async, yields to idle)
    const idList = items.map((it, idx) => (it && it.id) ? it.id : `__idx_${idx}`);
    let priorityScores = {};
    try { priorityScores = await this._getPriorityScoresFor(idList); } catch {}
    const scored = idList.some(id => priorityScores[id] && priorityScores[id] > 0);
    if (scored) {
      items.sort((a, b) => {
        const idA = (a && a.id) || '';
        const idB = (b && b.id) || '';
        return (priorityScores[idB] || 0) - (priorityScores[idA] || 0);
      });
    }

    this._perf.mark('render-start');

    // ── renderBatch — same DocumentFragment + rAF pattern as search _batchRender ──
    const renderBatch = async (startIndex, count) => {
      if (signal.aborted || this._isUnmounted || session !== this._renderSession) return 0;

      const end = Math.min(items.length, startIndex + count);
      if (startIndex >= end) return 0;

      // DocumentFragment: all DOM writes batched into single insertion (= 1 reflow)
      const frag    = document.createDocumentFragment();
      let   created = 0;

      this._perf.mark('batch-start');

      for (let i = startIndex; i < end; i++) {
        if (signal.aborted || this._isUnmounted || session !== this._renderSession) break;
        if (this._renderedSet.has(i)) continue;

        let item = items[i];

        // ── Lazy-fetch jsonFile items (async, only when needed) ──
        if (item && item.jsonFile && !item._fetched) {
          try {
            try { window._headerV2_contentLoadingManager.updateMessage('Loading...'); } catch {}
            const fetched = await window._headerV2_dataManager
              .fetchWithRetry(item.jsonFile, { cache: true }, 3)
              .catch(err => { throw err; });
            if (Array.isArray(fetched)) {
              item._fetched = true;
              items.splice(i, 1, ...fetched);
              i--;
              continue;
            } else if (typeof fetched === 'object' && fetched !== null && Array.isArray(fetched.data)) {
              item._fetched = true;
              items.splice(i, 1, ...fetched.data);
              i--;
              continue;
            } else {
              items.splice(i, 1, fetched);
              item = fetched;
            }
          } catch (err) {
            console.error('Error fetching referenced jsonFile', err);
          }
        }

        item = items[i];
        if (!item || this._renderedSet.has(i)) continue;

        // Acquire from pool (CSS containment pre-applied in _acquire)
        const wrapper = this._acquire();
        wrapper.id    = item.id || `content-item-${i}`;

        // Opacity 0 → will be set to 1 in rAF after insertion (compositor-safe)
        wrapper.style.opacity = '0';

        const inner = this.createContainer(item);
        try {
          if (item.group?.categoryId) {
            await this.renderGroupItems(inner, item.group);
          } else if (item.group?.type === 'card' && Array.isArray(item.group.items)) {
            await this.renderGroupItems(inner, item.group);
          } else if (item.group?.type === 'button' && Array.isArray(item.group.items)) {
            await this.renderGroupItems(inner, item.group);
          } else if (item.categoryId) {
            await this.renderGroupItems(inner, { categoryId: item.categoryId, type: item.type || 'button' });
          } else {
            await this.renderSingleItem(inner, item);
          }
        } catch (err) {
          console.error('render item error', err);
        }

        wrapper.appendChild(inner);
        frag.appendChild(wrapper);
        this._renderedSet.add(i);
        created++;
      }

      this._perf.measure('content-batch', 'batch-start');

      // ── Single DOM insertion + compositor-safe fade-in ──
      // Mirrors search _batchRender: DocumentFragment → single reflow → rAF fade-in.
      if (frag.hasChildNodes()) {
        await new Promise(resolve => {
          // rAF #1: insert (layout pass)
          requestAnimationFrame(() => {
            container.appendChild(frag);
            // rAF #2: fade-in (paint pass — opacity is compositor-only, no layout)
            requestAnimationFrame(() => {
              const children = container.children;
              const start    = children.length - created;
              for (let j = start; j < children.length; j++) {
                if (children[j]) children[j].style.opacity = '1';
              }
              resolve();
            });
          });
        });
      }

      return created;
    };

    // ── Initial batch (synchronous-ish, before sentinel is set up) ──
    await renderBatch(0, this._batchSize());
    let renderedCount = this._renderedSet.size;

    if (renderedCount >= items.length) {
      this._perf.measure('content-render', 'render-start');
      try { window._headerV2_contentLoadingManager.hide(); } catch {}
      return;
    }

    // ── Sentinel for remaining items ──────────────────────────────
    // Same IntersectionObserver pattern as before; now triggers yieldToIdle
    // before each batch (same scheduling as search-engine chunked build).
    let sentinel = document.getElementById(this._SENTINEL_ID);
    if (!sentinel) {
      sentinel = document.createElement('div');
      sentinel.id = this._SENTINEL_ID;
      Object.assign(sentinel.style, { width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
    }
    container.appendChild(sentinel);

    let debounceTimer = null;
    const onIntersect = (entries) => {
      if (signal.aborted || this._isUnmounted || session !== this._renderSession) return;
      for (const entry of entries) {
        if (!entry.isIntersecting || this._isRenderingNextBatch) continue;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          this._isRenderingNextBatch = true;
          // yieldToIdle — same as search-engine.js between chunks
          await this._yieldToIdle();
          try {
            if (signal.aborted || this._isUnmounted || session !== this._renderSession) return;
            await renderBatch(renderedCount, this._batchSize());
            renderedCount = this._renderedSet.size;
            if (renderedCount < items.length) {
              try { if (sentinel.parentNode) sentinel.parentNode.removeChild(sentinel); } catch {}
              container.appendChild(sentinel);
            } else {
              try { if (sentinel.parentNode) sentinel.parentNode.removeChild(sentinel); } catch {}
              if (this._sentinelObserver) {
                try { this._sentinelObserver.disconnect(); } catch {}
                this._sentinelObserver = null;
              }
              this._perf.measure('content-render', 'render-start');
              try { window._headerV2_contentLoadingManager.hide(); } catch {}
            }
          } catch (err) {
            console.error('Error rendering next batch', err);
          } finally {
            this._isRenderingNextBatch = false;
          }
        }, 50);
      }
    };

    if ('IntersectionObserver' in window) {
      if (this._sentinelObserver) { try { this._sentinelObserver.disconnect(); } catch {} }
      this._sentinelObserver = new IntersectionObserver(onIntersect, {
        root: null, rootMargin: '400px', threshold: 0.1
      });
      try { this._sentinelObserver.observe(sentinel); } catch {}
    } else {
      // Fallback for old browsers without IntersectionObserver
      const scrollFallback = () => {
        if (this._isRenderingNextBatch || signal.aborted || this._isUnmounted || session !== this._renderSession) return;
        const rect = sentinel.getBoundingClientRect();
        if (rect.top < (window.innerHeight + 400)) {
          this._isRenderingNextBatch = true;
          setTimeout(async () => {
            try {
              await this._yieldToIdle();
              await renderBatch(renderedCount, this._batchSize());
              renderedCount = this._renderedSet.size;
              if (renderedCount >= items.length) {
                window.removeEventListener('scroll', scrollFallback);
                this._perf.measure('content-render', 'render-start');
                try { window._headerV2_contentLoadingManager.hide(); } catch {}
              }
            } catch {} finally {
              this._isRenderingNextBatch = false;
            }
          }, 0);
        }
      };
      window.addEventListener('scroll', scrollFallback, { passive: true });
    }
  },

  // ── Public cleanup hook (called externally) ───────────────────
  // Wraps clearContent for backward compat.
  get _cleanupRender() {
    return () => this.clearContent();
  },

  // ──────────────────────────────────────────────────────────────
  // ALL METHODS BELOW ARE UNCHANGED FROM v3.0
  // Public APIs: createContainer, renderGroupItems, createGroupHeader,
  // renderSingleItem, createButton, createCard, updateCardsLanguage
  // ──────────────────────────────────────────────────────────────

  createContainer(item) {
    const container = document.createElement('div');
    if (
      item.group?.type === 'button' ||
      item.type === 'button' ||
      (item.group?.categoryId && !item.group?.type)
    ) {
      container.className = 'button-content-container';
    } else {
      container.className = 'card-content-container';
    }
    if (item.group?.containerClass) container.classList.add(item.group.containerClass);
    return container;
  },

  async renderGroupItems(container, group) {
    if (!group.categoryId && !group.items) throw new Error('Group ต้องระบุ categoryId หรือ items');

    if (group.categoryId) {
      const { id, name, data, header } = await window._headerV2_data_manager?.fetchCategoryGroup
        ? await window._headerV2_data_manager.fetchCategoryGroup(group.categoryId)
        : await window._headerV2_dataManager.fetchCategoryGroup(group.categoryId);
      if (header) container.appendChild(this.createGroupHeader(header));
      if (group.type === 'card') {
        for (const item of data) { const card = await this.createCard(item); if (card) container.appendChild(card); }
      } else if (group.type === 'button') {
        for (const item of data) { const btn = await this.createButton(item); if (btn) container.appendChild(btn); }
      } else {
        throw new Error("รองรับเฉพาะ type: 'button' หรือ 'card' ใน group");
      }
    } else if (Array.isArray(group.items)) {
      if (group.header) container.appendChild(this.createGroupHeader(group.header));
      if (group.type === 'card') {
        for (const item of group.items) { const card = await this.createCard(item); if (card) container.appendChild(card); }
      } else if (group.type === 'button') {
        for (const item of group.items) { const btn = await this.createButton(item); if (btn) container.appendChild(btn); }
      }
    }
  },

  createGroupHeader(headerConfig) {
    const headerContainer = document.createElement('div');
    headerContainer.className = 'group-header';
    const currentLang = localStorage.getItem('selectedLang') || 'en';
    if (typeof headerConfig === 'string') return this.createSimpleHeader(headerConfig, headerContainer);
    if (headerConfig.className) headerContainer.classList.add(headerConfig.className);
    this.createHeaderComponents(headerContainer, headerConfig, currentLang);
    this.addLanguageChangeListener(headerContainer, headerConfig);
    return headerContainer;
  },

  createSimpleHeader(text, container) {
    const h = document.createElement('h2');
    h.className = 'group-header-text';
    h.textContent = text;
    container.appendChild(h);
    return container;
  },

  createHeaderComponents(container, config, currentLang) {
    if (config.icon) container.appendChild(this.createHeaderIcon(config.icon));
    const headerContent = document.createElement('div');
    headerContent.className = 'header-content';
    headerContent.appendChild(this.createHeaderTitle(config, currentLang));
    if (config.description) headerContent.appendChild(this.createHeaderDescription(config.description, currentLang));
    container.appendChild(headerContent);
    if (config.actions) container.appendChild(this.createHeaderActions(config.actions, currentLang));
  },

  createHeaderTitle(config, currentLang) {
    const title = document.createElement('h2');
    title.className = 'group-header-text';
    if (typeof config.title === 'object') {
      Object.entries(config.title).forEach(([lang, text]) => { title.dataset[`title${lang.toUpperCase()}`] = text; });
      title.textContent = config.title[currentLang] || config.title.en;
    } else {
      title.textContent = config.title;
    }
    return title;
  },

  createHeaderDescription(description, currentLang) {
    const desc = document.createElement('p');
    desc.className = 'group-header-description';
    if (typeof description === 'object') {
      Object.entries(description).forEach(([lang, text]) => { desc.dataset[`desc${lang.toUpperCase()}`] = text; });
      desc.textContent = description[currentLang] || description.en;
    } else {
      desc.textContent = description;
    }
    return desc;
  },

  addLanguageChangeListener(container, config) {
    if (!container._langListenerBound) {
      window.addEventListener('languageChange', event => {
        this.updateHeaderLanguage(container, config, event.detail.language);
      });
      container._langListenerBound = true;
    }
  },

  updateHeaderLanguage(container, config, newLang) {
    const titleEl = container.querySelector('.group-header-text');
    if (titleEl && config.title && typeof config.title === 'object')
      titleEl.textContent = config.title[newLang] || config.title.en || titleEl.textContent;
    const descEl = container.querySelector('.group-header-description');
    if (descEl && config.description && typeof config.description === 'object')
      descEl.textContent = config.description[newLang] || config.description.en || descEl.textContent;
  },

  async renderSingleItem(container, item) {
    if (item.categoryId) {
      await this.renderGroupItems(container, { categoryId: item.categoryId, type: item.type || 'button' });
      return;
    }
    const element = item.type === 'button' ? await this.createButton(item) : await this.createCard(item);
    if (element) container.appendChild(element);
  },

  async createButton(config) {
    const button = document.createElement('button');
    button.className = 'button-content';
    let finalContent = '';
    let apiCode = config.api || null;
    let type    = config.type || null;

    try {
      if (apiCode) {
        const db = await window._headerV2_data_manager?.loadApiDatabase?.()
          || await window._headerV2_dataManager.loadApiDatabase();
        function findApiNode(obj, code) {
          if (Array.isArray(obj)) { for (const item of obj) { const f = findApiNode(item, code); if (f) return f; } }
          else if (typeof obj === 'object' && obj !== null) {
            if (obj.api === code) return obj;
            for (const key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { const f = findApiNode(obj[key], code); if (f) return f; } }
          }
          return null;
        }
        const apiNode = findApiNode(db, apiCode);
        if (apiNode) {
          finalContent = apiNode.text;
          type = type || (apiNode.api ? 'emoji' : 'symbol');
        } else {
          finalContent = apiCode;
        }
      } else if (config.content) {
        finalContent = config.content; type = 'symbol';
      } else if (config.text) {
        finalContent = config.text; type = 'symbol';
      } else {
        throw new Error('ต้องระบุ api, content หรือ text สำหรับ button content type');
      }
      button.textContent = finalContent;
    } catch { button.textContent = 'Error'; }

    button.addEventListener('click', async () => {
      try { this._recordEvent('click', button.dataset && (button.dataset.url || button.id)); } catch {}
      try {
        await (window.unifiedCopyToClipboard || unifiedCopyToClipboard).call(null, {
          text: finalContent, api: apiCode, type, name: apiCode ? `${apiCode}` : ''
        });
      } catch {
        window._headerV2_utils.showNotification('Copy failed', 'error');
      }
    });

    // Compositor-safe fade-in (opacity only — no layout triggered)
    button.style.opacity = '0';
    requestAnimationFrame(() => { button.style.opacity = '1'; });
    return button;
  },

  async createCard(cardConfig) {
    const lang    = localStorage.getItem('selectedLang') || 'en';
    const card    = document.createElement('div');
    card.className = 'card';

    if (cardConfig.image) {
      const img = document.createElement('img');
      img.className = 'card-image';
      img.src       = cardConfig.image;
      img.loading   = 'lazy';
      img.alt       = cardConfig.imageAlt?.[lang] || cardConfig.imageAlt?.en || '';
      card.appendChild(img);
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'card-content';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'card-title';
    if (typeof cardConfig.title === 'object') {
      Object.entries(cardConfig.title).forEach(([langCode, text]) => { titleDiv.dataset[`title${langCode.toUpperCase()}`] = text; });
      titleDiv.textContent = cardConfig.title[lang] || cardConfig.title.en;
    } else if (cardConfig.name && typeof cardConfig.name === 'object') {
      titleDiv.textContent = cardConfig.name[lang] || cardConfig.name.en;
    } else {
      titleDiv.textContent = cardConfig.title || cardConfig.name || '';
    }
    contentDiv.appendChild(titleDiv);

    const descDiv = document.createElement('div');
    descDiv.className = 'card-description';
    if (typeof cardConfig.description === 'object') {
      Object.entries(cardConfig.description).forEach(([langCode, text]) => { descDiv.dataset[`desc${langCode.toUpperCase()}`] = text; });
      descDiv.textContent = cardConfig.description[lang] || cardConfig.description.en;
    } else if (cardConfig.name && typeof cardConfig.name === 'object') {
      descDiv.textContent = cardConfig.name[lang] || cardConfig.name.en;
    } else {
      descDiv.textContent = cardConfig.description || '';
    }
    contentDiv.appendChild(descDiv);
    card.appendChild(contentDiv);

    if (cardConfig.link) {
      card.addEventListener('click', () => window.open(cardConfig.link, '_blank', 'noopener'));
    }
    if (cardConfig.className) card.classList.add(cardConfig.className);

    // Compositor-safe fade-in (opacity only)
    card.style.opacity = '0';
    requestAnimationFrame(() => { card.style.opacity = '1'; });
    return card;
  },

  updateCardsLanguage(lang) {
    const cards = document.querySelectorAll('.card');
    for (const card of cards) {
      const titleEl = card.querySelector('.card-title');
      if (titleEl) { const t = titleEl.dataset[`title${lang.toUpperCase()}`]; if (t) titleEl.textContent = t; }
      const descEl  = card.querySelector('.card-description');
      if (descEl)  { const d = descEl.dataset[`desc${lang.toUpperCase()}`];  if (d) descEl.textContent  = d; }
      const imgEl   = card.querySelector('.card-image');
      if (imgEl)   { const a = imgEl.dataset[`alt${lang.toUpperCase()}`];    if (a) imgEl.alt           = a; }
    }
  },
};

export default contentManager;