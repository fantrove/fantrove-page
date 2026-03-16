// contentManager.js (ต่อจากเดิม)
// ✅ ปรับปรุง: Incremental batch processing, memory optimization, deferred DOM operations
export const contentManager = {
  _renderSession: 0,
  _abortController: null,
  _virtualNodes: [],
  _items: [],
  _renderedSet: new Set(),
  _sentinelObserver: null,
  _cleanupRender: null,
  _scheduleId: null,
  _isUnmounted: false,

  _elementPool: [],
  _poolMax: 20,
  _poolCleanupTimer: null,
  _poolLastUsed: 0,

  _frameSamples: [],
  _avgFrameTime: 16,
  _baseBatch: 6,
  _minBatch: 3,
  _maxBatch: 18,

  _maxBatchLimit: 12,
  _deviceMemory: navigator.deviceMemory || 4,
  _isSlowDevice: navigator.deviceMemory && navigator.deviceMemory <= 2,

  _learningWorker: null,
  _learningData: { views: {}, clicks: {} },
  _learningEnabled: true,
  _lastScores: {},

  _SENTINEL_ID: 'headerv2-render-sentinel',
  _isRenderingNextBatch: false,
  _throttledScrollCheck: null,
  _pendingDOMUpdates: [],

  _acquireFromPool() {
    const node = this._elementPool.pop() || document.createElement('div');
    node.className = '';
    node.style.opacity = '';
    node.style.transition = '';
    this._poolLastUsed = Date.now();
    return node;
  },

  _releaseToPool(node) {
    if (!node) return;
    try {
      node.innerHTML = '';
      node.className = '';
      node.style.cssText = '';
      node.removeAttribute('id');
    } catch {}
    if (this._elementPool.length < this._poolMax) this._elementPool.push(node);
    
    if (!this._poolCleanupTimer) {
      this._poolCleanupTimer = setTimeout(() => {
        this._poolLastUsed = 0;
        this._poolCleanupTimer = null;
      }, 30000);
    }
  },

  _recordFrameSample(durationMs) {
    this._frameSamples.push(durationMs);
    if (this._frameSamples.length > 30) this._frameSamples.shift();
    const alpha = 0.18;
    if (!this._avgFrameTime) this._avgFrameTime = durationMs;
    else this._avgFrameTime = (alpha * durationMs) + ((1 - alpha) * this._avgFrameTime);
  },

  _getBatchLimit() {
    try {
      if (typeof window !== 'undefined' && window._headerV2_contentManagerConfig && window._headerV2_contentManagerConfig.maxBatchLimit != null) {
        const v = Number(window._headerV2_contentManagerConfig.maxBatchLimit);
        if (!isNaN(v) && v > 0) return Math.max(1, Math.floor(v));
      }
    } catch (e) {}
    return this._maxBatchLimit;
  },

  _computeAdaptiveBatchSize() {
    const target = 14;
    const ratio = Math.max(0.25, Math.min(4, target / (this._avgFrameTime || 16)));
    let batch = Math.round(this._baseBatch * ratio);
    batch = Math.max(this._minBatch, Math.min(this._maxBatch, batch));
    
    if (this._isSlowDevice) {
      batch = Math.max(this._minBatch, Math.round(batch * 0.6));
    }
    
    const limit = this._getBatchLimit();
    batch = Math.min(batch, limit);
    return batch;
  },

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
            if (kind === 'view') state.views[id] = (state.views[id] || 0) + 1;
            if (kind === 'click') state.clicks[id] = (state.clicks[id] || 0) + 1;
          } else if (type === 'getScores') {
            const items = payload.items || [];
            const result = {};
            for (const id of items) result[id] = score(id) || 0;
            postMessage({ type: 'scores', payload: result });
          } else if (type === 'hydrate') {
            const { views, clicks } = payload || {};
            if (views) Object.assign(state.views, views);
            if (clicks) Object.assign(state.clicks, clicks);
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      this._learningWorker = new Worker(url);
      this._learningWorker.onmessage = (e) => {
        const { type, payload } = e.data || {};
        if (type === 'scores') this._lastScores = payload || {};
      };
      this._learningWorker.postMessage({ type: 'hydrate', payload: this._learningData });
    } catch (err) {
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
        const v = (this._learningData.views && this._learningData.views[id]) || 0;
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
      } else resolve(fallback);
    });
  },

  async clearContent() {
    this._renderSession = (this._renderSession || 0) + 1;
    const currentSession = this._renderSession;

    try {
      if (this._abortController) {
        try { this._abortController.abort(); } catch {}
        this._abortController = null;
      }
    } catch {}

    this._isUnmounted = true;
    this._isRenderingNextBatch = false;
    this._pendingDOMUpdates = [];

    try {
      const sentinel = document.getElementById(this._SENTINEL_ID);
      if (sentinel && sentinel.parentNode) sentinel.parentNode.removeChild(sentinel);
    } catch {}

    try { window._headerV2_contentLoadingManager.hide(); } catch {}

    if (this._sentinelObserver) {
      try { this._sentinelObserver.disconnect(); } catch {}
      this._sentinelObserver = null;
    }

    if (this._scheduleId) {
      try {
        if (typeof cancelIdleCallback === 'function') cancelIdleCallback(this._scheduleId);
        else clearTimeout(this._scheduleId);
      } catch {}
      this._scheduleId = null;
    }

    if (this._throttledScrollCheck) {
      try { window.removeEventListener('scroll', this._throttledScrollCheck); } catch {}
      this._throttledScrollCheck = null;
    }

    try {
      for (const node of this._virtualNodes) {
        try { if (node && node.parentNode) node.parentNode.removeChild(node); } catch {}
        try { this._releaseToPool(node); } catch {}
      }
    } catch {}

    this._virtualNodes.length = 0;
    this._items = [];
    this._renderedSet = new Set();

    this._frameSamples.length = 0;
    this._avgFrameTime = 16;

    return currentSession;
  },

  async renderContent(data) {
    if (!Array.isArray(data)) throw new Error('Content data should be array');
    const container = document.getElementById(window._headerV2_contentLoadingManager.LOADING_CONTAINER_ID);
    if (!container) return;

    await this.clearContent();

    try {
      const subNavEl = document.getElementById('sub-nav');
      let behindSubNav = false;
      if (subNavEl) {
        try {
          const style = window.getComputedStyle(subNavEl);
          const visible = style.display !== 'none' && style.visibility !== 'hidden' && subNavEl.offsetHeight > 0;
          const containerEl = subNavEl.querySelector('#sub-buttons-container');
          const hasButtons = containerEl && containerEl.childNodes && containerEl.childNodes.length > 0;
          if (visible && hasButtons) behindSubNav = true;
        } catch (e) { behindSubNav = false; }
      }
      try { window._headerV2_contentLoadingManager.show({ behindSubNav }); } catch (e) {}
    } catch (e) {}

    this._renderSession = (this._renderSession || 0) + 1;
    const session = this._renderSession;
    this._abortController = new AbortController();
    const signal = this._abortController.signal;
    this._isUnmounted = false;
    this._isRenderingNextBatch = false;

    const items = data.slice();
    this._items = items;
    this._initLearningWorkerIfNeeded(items.length);

    if (!document.getElementById('gpu-accel-style')) {
      const style = document.createElement('style');
      style.id = 'gpu-accel-style';
      style.textContent = `
        .fade-in, .fade-out, .card { will-change: opacity; content-visibility: auto; contain-intrinsic-size: auto 200px; }
        .fade-in { opacity: 0; }
        .fade-out { opacity: 0; }
      `;
      document.head.appendChild(style);
    }

    const idList = items.map((it, idx) => (it && it.id) ? it.id : `__idx_${idx}`);
    let priorityScores = {};
    try { priorityScores = await this._getPriorityScoresFor(idList); } catch {}
    const scored = idList.some(id => priorityScores && priorityScores[id] && priorityScores[id] > 0);
    if (scored) {
      items.sort((a, b) => {
        const idA = a && (a.id || '') || '';
        const idB = b && (b.id || '') || '';
        const sa = priorityScores[idA] || 0;
        const sb = priorityScores[idB] || 0;
        return sb - sa;
      });
    }

    const createSentinel = () => {
      let sentinel = document.getElementById(this._SENTINEL_ID);
      if (!sentinel) {
        sentinel = document.createElement('div');
        sentinel.id = this._SENTINEL_ID;
        sentinel.style.width = '1px';
        sentinel.style.height = '1px';
        sentinel.style.opacity = '0';
        sentinel.style.pointerEvents = 'none';
      }
      return sentinel;
    };

    const renderBatch = async (startIndex, batchSize) => {
      if (signal.aborted || this._isUnmounted || session !== this._renderSession) return 0;
      const limit = this._getBatchLimit();
      batchSize = Math.min(batchSize, limit);
      let end = Math.min(items.length, startIndex + batchSize);
      if (startIndex >= end) return 0;
      
      const frag = document.createDocumentFragment();
      const t0 = performance.now();
      let created = 0;

      for (let i = startIndex; i < end; i++) {
        if (signal.aborted || this._isUnmounted || session !== this._renderSession) break;
        if (this._renderedSet.has(i)) continue;
        let item = items[i];

        if (item && item.jsonFile && !item._fetched) {
          try {
            try { window._headerV2_contentLoadingManager.updateMessage('Loading...'); } catch {}
            const fetched = await window._headerV2_dataManager.fetchWithRetry(item.jsonFile, { cache: true }, 3).catch(err => { throw err; });
            if (Array.isArray(fetched)) {
              item._fetched = true;
              items.splice(i, 1, ...fetched);
              const delta = fetched.length - 1;
              end = Math.min(items.length, end + delta);
              i = i - 1;
              continue;
            } else if (typeof fetched === 'object' && fetched !== null && Array.isArray(fetched.data)) {
              const arr = fetched.data;
              item._fetched = true;
              items.splice(i, 1, ...arr);
              const delta = arr.length - 1;
              end = Math.min(items.length, end + delta);
              i = i - 1;
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
        if (!item) continue;
        if (this._renderedSet.has(i)) continue;

        const wrapper = this._acquireFromPool();
        wrapper.id = item.id || `content-item-${i}`;
        const inner = this.createContainer(item);
        try {
          if (item.group?.categoryId) {
            await this.renderGroupItems(inner, item.group);
          } else if (item.group?.type === "card" && Array.isArray(item.group.items)) {
            await this.renderGroupItems(inner, item.group);
          } else if (item.group?.type === "button" && Array.isArray(item.group.items)) {
            await this.renderGroupItems(inner, item.group);
          } else if (item.categoryId) {
            await this.renderGroupItems(inner, { categoryId: item.categoryId, type: item.type || "button" });
          } else {
            await this.renderSingleItem(inner, item);
          }
        } catch (err) {
          console.error('render item error', err);
        }
        wrapper.appendChild(inner);
        wrapper.classList.add('fade-in');
        wrapper.style.opacity = 0;
        frag.appendChild(wrapper);
        this._virtualNodes.push(wrapper);
        this._renderedSet.add(i);
        created++;
      }

      if (frag.childNodes.length > 0) {
        container.appendChild(frag);
        const appended = Array.from(container.children).slice(-created);
        requestAnimationFrame(() => {
          for (const node of appended) node.style.opacity = 1;
        });
      }

      const MAX_IN_DOM = this._isSlowDevice ? 20 : 28;
      while (this._virtualNodes.length > MAX_IN_DOM) {
        const old = this._virtualNodes.shift();
        this._animateOutAndRemove(old, 28);
      }

      const dt = performance.now() - t0;
      this._recordFrameSample(dt);
      return created;
    };

    const scheduleIdle = (fn) => {
      if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout: 200 });
      else setTimeout(fn, 16);
    };

    const initialBatch = Math.min(items.length, this._computeAdaptiveBatchSize(), this._getBatchLimit());
    await renderBatch(0, initialBatch);
    let renderedCount = this._renderedSet.size;

    if (renderedCount >= items.length) {
      try { window._headerV2_contentLoadingManager.hide(); } catch (e) {}
      return;
    }

    let sentinel = createSentinel();
    container.appendChild(sentinel);

    let sentinelDebounceTimer = null;
    const onSentinelIntersect = (entries) => {
      if (signal.aborted || this._isUnmounted || session !== this._renderSession) return;
      for (const entry of entries) {
        if (entry.isIntersecting && !this._isRenderingNextBatch) {
          if (sentinelDebounceTimer) clearTimeout(sentinelDebounceTimer);
          sentinelDebounceTimer = setTimeout(() => {
            this._isRenderingNextBatch = true;
            scheduleIdle(async () => {
              try {
                if (signal.aborted || this._isUnmounted || session !== this._renderSession) return;
                const nextBatch = Math.min(this._computeAdaptiveBatchSize(), this._getBatchLimit());
                const created = await renderBatch(renderedCount, nextBatch);
                renderedCount = this._renderedSet.size;
                if (renderedCount < items.length) {
                  try { if (sentinel.parentNode) sentinel.parentNode.removeChild(sentinel); } catch {}
                  container.appendChild(sentinel);
                } else {
                  try { if (sentinel.parentNode) sentinel.parentNode.removeChild(sentinel); } catch {}
                  if (this._sentinelObserver) { try { this._sentinelObserver.disconnect(); } catch {} this._sentinelObserver = null; }
                  try { window._headerV2_contentLoadingManager.hide(); } catch (e) {}
                }
              } catch (err) {
                console.error('Error rendering next batch', err);
              } finally {
                this._isRenderingNextBatch = false;
              }
            });
          }, 50);
        }
      }
    };

    if ('IntersectionObserver' in window) {
      if (this._sentinelObserver) { try { this._sentinelObserver.disconnect(); } catch {} this._sentinelObserver = null; }
      this._sentinelObserver = new IntersectionObserver(onSentinelIntersect, { root: null, rootMargin: '400px', threshold: 0.1 });
      try { this._sentinelObserver.observe(sentinel); } catch {}
    } else {
      this._throttledScrollCheck = this._throttledScrollCheck || (() => {
        if (this._isRenderingNextBatch || signal.aborted || this._isUnmounted || session !== this._renderSession) return;
        const rect = sentinel.getBoundingClientRect();
        if (rect.top < (window.innerHeight + 400)) {
          this._isRenderingNextBatch = true;
          scheduleIdle(async () => {
            try {
              if (signal.aborted || this._isUnmounted || session !== this._renderSession) return;
              const nextBatch = Math.min(this._computeAdaptiveBatchSize(), this._getBatchLimit());
              const created = await renderBatch(renderedCount, nextBatch);
              renderedCount = this._renderedSet.size;
              if (renderedCount >= items.length) {
                window.removeEventListener('scroll', this._throttledScrollCheck);
                try { window._headerV2_contentLoadingManager.hide(); } catch (e) {}
              }
            } catch (err) {}
            finally { this._isRenderingNextBatch = false; }
          });
        }
      });
      window.addEventListener('scroll', this._throttledScrollCheck, { passive: true });
    }

    this._cleanupRender = () => {
      try { if (this._abortController) this._abortController.abort(); } catch {}
      this._isUnmounted = true;
      if (this._sentinelObserver) { try { this._sentinelObserver.disconnect(); } catch {} this._sentinelObserver = null; }
      if (this._throttledScrollCheck) { try { window.removeEventListener('scroll', this._throttledScrollCheck); } catch {} this._throttledScrollCheck = null; }
      for (const node of this._virtualNodes) {
        if (node && node.parentNode) this._animateOutAndRemove(node, 28);
      }
      this._virtualNodes.length = 0;
      this._renderedSet.clear();
      try { window._headerV2_contentLoadingManager.hide(); } catch (e) {}
    };
  },

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
    if (!group.categoryId && !group.items) throw new Error("Group ต้องระบุ categoryId หรือ items");

    if (group.categoryId) {
      const { id, name, data, header } = await window._headerV2_data_manager?.fetchCategoryGroup
        ? await window._headerV2_data_manager.fetchCategoryGroup(group.categoryId)
        : await window._headerV2_dataManager.fetchCategoryGroup(group.categoryId);
      if (header) {
        const headerElement = this.createGroupHeader(header);
        container.appendChild(headerElement);
      }
      if (group.type === "card") {
        for (const item of data) {
          const card = await this.createCard(item);
          if (card) container.appendChild(card);
        }
      } else if (group.type === "button") {
        for (const item of data) {
          const btn = await this.createButton(item);
          if (btn) container.appendChild(btn);
        }
      } else {
        throw new Error("รองรับเฉพาะ type: 'button' หรือ 'card' ใน group");
      }
    } else if (Array.isArray(group.items)) {
      if (group.header) {
        const headerElement = this.createGroupHeader(group.header);
        container.appendChild(headerElement);
      }
      if (group.type === "card") {
        for (const item of group.items) {
          const card = await this.createCard(item);
          if (card) container.appendChild(card);
        }
      } else if (group.type === "button") {
        for (const item of group.items) {
          const btn = await this.createButton(item);
          if (btn) container.appendChild(btn);
        }
      }
    }
  },

  createGroupHeader(headerConfig) {
    const headerContainer = document.createElement('div');
    headerContainer.className = 'group-header';
    const currentLang = localStorage.getItem('selectedLang') || 'en';
    if (typeof headerConfig === 'string') {
      return this.createSimpleHeader(headerConfig, headerContainer);
    }
    if (headerConfig.className) {
      headerContainer.classList.add(headerConfig.className);
    }
    this.createHeaderComponents(headerContainer, headerConfig, currentLang);
    this.addLanguageChangeListener(headerContainer, headerConfig);
    return headerContainer;
  },

  createSimpleHeader(text, container) {
    const headerText = document.createElement('h2');
    headerText.className = 'group-header-text';
    headerText.textContent = text;
    container.appendChild(headerText);
    return container;
  },

  createHeaderComponents(container, config, currentLang) {
    if (config.icon) container.appendChild(this.createHeaderIcon(config.icon));
    const headerContent = document.createElement('div');
    headerContent.className = 'header-content';
    const title = this.createHeaderTitle(config, currentLang);
    headerContent.appendChild(title);
    if (config.description) {
      const desc = this.createHeaderDescription(config.description, currentLang);
      headerContent.appendChild(desc);
    }
    container.appendChild(headerContent);
    if (config.actions) container.appendChild(this.createHeaderActions(config.actions, currentLang));
  },

  createHeaderTitle(config, currentLang) {
    const title = document.createElement('h2');
    title.className = 'group-header-text';
    if (typeof config.title === 'object') {
      Object.entries(config.title).forEach(([lang, text]) => {
        title.dataset[`title${lang.toUpperCase()}`] = text;
      });
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
      Object.entries(description).forEach(([lang, text]) => {
        desc.dataset[`desc${lang.toUpperCase()}`] = text;
      });
      desc.textContent = description[currentLang] || description.en;
    } else {
      desc.textContent = description;
    }
    return desc;
  },

  addLanguageChangeListener(container, config) {
    if (!container._langListenerBound) {
      window.addEventListener('languageChange', event => {
        const newLang = event.detail.language;
        this.updateHeaderLanguage(container, config, newLang);
      });
      container._langListenerBound = true;
    }
  },

  updateHeaderLanguage(container, config, newLang) {
    const titleElement = container.querySelector('.group-header-text');
    if (titleElement && config.title) {
      if (typeof config.title === 'object') {
        titleElement.textContent =
          config.title[newLang] || config.title.en || titleElement.textContent;
      }
    }
    const descElement = container.querySelector('.group-header-description');
    if (descElement && config.description) {
      if (typeof config.description === 'object') {
        descElement.textContent =
          config.description[newLang] ||
          config.description.en ||
          descElement.textContent;
      }
    }
  },

  async renderSingleItem(container, item) {
    if (item.categoryId) {
      await this.renderGroupItems(container, { categoryId: item.categoryId, type: item.type || "button" });
      return;
    }
    const element =
      item.type === 'button'
        ? await this.createButton(item)
        : await this.createCard(item);
    if (element) container.appendChild(element);
  },

  async createButton(config) {
    const button = document.createElement('button');
    button.className = 'button-content';
    let finalContent = '';
    let apiCode = config.api || null;
    let type = config.type || null;
    try {
      if (apiCode) {
        const db = await window._headerV2_data_manager?.loadApiDatabase?.()
          || await window._headerV2_dataManager.loadApiDatabase();
        function findApiNode(obj, code) {
          if (Array.isArray(obj)) {
            for (const item of obj) {
              const found = findApiNode(item, code);
              if (found) return found;
            }
          } else if (typeof obj === 'object' && obj !== null) {
            if (obj.api === code) return obj;
            for (const key in obj) {
              if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const found = findApiNode(obj[key], code);
                if (found) return found;
              }
            }
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
        finalContent = config.content;
        type = 'symbol';
      } else if (config.text) {
        finalContent = config.text;
        type = 'symbol';
      } else {
        throw new Error('ต้องระบุ api, content หรือ text สำหรับ button content type');
      }
      button.textContent = finalContent;
    } catch (error) {
      button.textContent = 'Error';
    }

    button.addEventListener('click', async () => {
      try { this._recordEvent('click', button.dataset && (button.dataset.url || button.id)); } catch {}
      try {
        await (window.unifiedCopyToClipboard || unifiedCopyToClipboard).call(null, {
          text: finalContent,
          api: apiCode,
          type,
          name: apiCode ? `${apiCode}` : ''
        });
      } catch (error) {
        window._headerV2_utils.showNotification('Copy failed', 'error');
      }
    });

    button.classList.add('fade-in');
    button.style.opacity = 0;
    requestAnimationFrame(() => { button.style.opacity = 1; });
    return button;
  },

  async createCard(cardConfig) {
    const lang = localStorage.getItem('selectedLang') || 'en';
    const card = document.createElement('div');
    card.className = 'card';
    if (cardConfig.image) {
      const img = document.createElement('img');
      img.className = 'card-image';
      img.src = cardConfig.image;
      img.loading = 'lazy';
      img.alt = cardConfig.imageAlt?.[lang] || cardConfig.imageAlt?.en || '';
      card.appendChild(img);
    }
    const contentDiv = document.createElement('div');
    contentDiv.className = 'card-content';
    const titleDiv = document.createElement('div');
    titleDiv.className = 'card-title';
    if (typeof cardConfig.title === 'object') {
      Object.entries(cardConfig.title).forEach(([langCode, text]) => {
        titleDiv.dataset[`title${langCode.toUpperCase()}`] = text;
      });
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
      Object.entries(cardConfig.description).forEach(([langCode, text]) => {
        descDiv.dataset[`desc${langCode.toUpperCase()}`] = text;
      });
      descDiv.textContent = cardConfig.description[lang] || cardConfig.description.en;
    } else if (cardConfig.name && typeof cardConfig.name === 'object') {
      descDiv.textContent = cardConfig.name[lang] || cardConfig.name.en;
    } else {
      descDiv.textContent = cardConfig.description || '';
    }
    contentDiv.appendChild(descDiv);

    card.appendChild(contentDiv);

    if (cardConfig.link) {
      card.addEventListener('click', () => {
        window.open(cardConfig.link, '_blank', 'noopener');
      });
    }
    if (cardConfig.className) {
      card.classList.add(cardConfig.className);
    }
    card.classList.add('fade-in');
    card.style.opacity = 0;
    requestAnimationFrame(() => { card.style.opacity = 1; });
    return card;
  },

  _animateOutAndRemove(node, duration) {
    if (!node || !node.parentNode) return;
    node.classList.add('fade-out');
    setTimeout(() => {
      try { if (node.parentNode) node.parentNode.removeChild(node); } catch {}
      this._releaseToPool(node);
    }, duration + 8);
  },

  updateCardsLanguage(lang) {
    const cards = document.querySelectorAll('.card');
    for (const card of cards) {
      const titleElement = card.querySelector('.card-title');
      if (titleElement) {
        const newTitle = titleElement.dataset[`title${lang.toUpperCase()}`];
        if (newTitle) titleElement.textContent = newTitle;
      }
      const descElement = card.querySelector('.card-description');
      if (descElement) {
        const newDesc = descElement.dataset[`desc${lang.toUpperCase()}`];
        if (newDesc) descElement.textContent = newDesc;
      }
      const imgElement = card.querySelector('.card-image');
      if (imgElement) {
        const newAlt = imgElement.dataset[`alt${lang.toUpperCase()}`];
        if (newAlt) imgElement.alt = newAlt;
      }
    }
  }
};

export default contentManager;