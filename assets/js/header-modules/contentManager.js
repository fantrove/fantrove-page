// contentManager.js — Performance-optimized rewrite
// Key changes vs original:
//  - Removed inline learning worker (unnecessary overhead)
//  - Simplified element pool (no timer, no complex cleanup)
//  - Single IntersectionObserver only (removed parallel scroll fallback)
//  - Removed nested RAF chains
//  - Batch DOM writes in single fragment per tick
//  - Removed will-change injection (CSS handles it now)
//  - Smaller adaptive batch sizes for low-end devices
//  - Removed fade-in opacity animation on every element (CSS handles it)

export const contentManager = {
  _renderSession: 0,
  _abortController: null,
  _virtualNodes: [],
  _items: [],
  _renderedSet: new Set(),
  _sentinelObserver: null,
  _isRenderingNextBatch: false,
  _SENTINEL_ID: 'headerv2-render-sentinel',

  // ---- Device detection (once) ----
  _deviceTier: (() => {
    const mem = navigator.deviceMemory;
    const cores = navigator.hardwareConcurrency || 2;
    if (mem && mem <= 1) return 'low';
    if (mem && mem <= 2) return 'mid';
    if (cores <= 2) return 'mid';
    return 'high';
  })(),

  _batchSize() {
    // Keep batches small — better frame pacing
    if (this._deviceTier === 'low') return 3;
    if (this._deviceTier === 'mid') return 5;
    return 8;
  },

  // ---- Element pool (simple LIFO, no timer) ----
  _pool: [],
  _poolMax: 30,

  _acquire() {
    const n = this._pool.pop() || document.createElement('div');
    n.className = '';
    n.style.cssText = '';
    return n;
  },

  _release(n) {
    if (!n) return;
    try {
      n.innerHTML = '';
      n.className = '';
      n.style.cssText = '';
      n.removeAttribute('id');
    } catch (_) {}
    if (this._pool.length < this._poolMax) this._pool.push(n);
  },

  // ---- Clear ----
  async clearContent() {
    this._renderSession++;
    const session = this._renderSession;

    if (this._abortController) {
      try { this._abortController.abort(); } catch (_) {}
      this._abortController = null;
    }

    this._isRenderingNextBatch = false;

    // disconnect observer
    if (this._sentinelObserver) {
      try { this._sentinelObserver.disconnect(); } catch (_) {}
      this._sentinelObserver = null;
    }

    // remove sentinel
    try {
      const s = document.getElementById(this._SENTINEL_ID);
      if (s && s.parentNode) s.parentNode.removeChild(s);
    } catch (_) {}

    // hide overlay
    try { window._headerV2_contentLoadingManager.hide(); } catch (_) {}

    // release pooled nodes
    for (const node of this._virtualNodes) {
      try { if (node.parentNode) node.parentNode.removeChild(node); } catch (_) {}
      this._release(node);
    }
    this._virtualNodes.length = 0;
    this._items = [];
    this._renderedSet = new Set();

    return session;
  },

  // ---- Main render ----
  async renderContent(data) {
    if (!Array.isArray(data)) throw new Error('Content data should be array');

    const container = document.getElementById(
      window._headerV2_contentLoadingManager.LOADING_CONTAINER_ID
    );
    if (!container) return;

    await this.clearContent();

    // Show overlay
    try {
      const subNavEl = document.getElementById('sub-nav');
      let behindSubNav = false;
      if (subNavEl) {
        try {
          const st = window.getComputedStyle(subNavEl);
          const vis = st.display !== 'none' && subNavEl.offsetHeight > 0;
          const hasBtns = !!(subNavEl.querySelector('#sub-buttons-container')?.childNodes.length);
          if (vis && hasBtns) behindSubNav = true;
        } catch (_) {}
      }
      window._headerV2_contentLoadingManager.show({ behindSubNav });
    } catch (_) {}

    this._renderSession++;
    const session = this._renderSession;
    this._abortController = new AbortController();
    const { signal } = this._abortController;

    const items = data.slice();
    this._items = items;

    // ---- Batch render helper ----
    const renderBatch = async (startIdx, batchSz) => {
      if (signal.aborted || session !== this._renderSession) return 0;

      const end = Math.min(items.length, startIdx + batchSz);
      if (startIdx >= end) return 0;

      const frag = document.createDocumentFragment();
      let created = 0;

      for (let i = startIdx; i < end; i++) {
        if (signal.aborted || session !== this._renderSession) break;
        if (this._renderedSet.has(i)) continue;

        let item = items[i];

        // Handle jsonFile indirection
        if (item && item.jsonFile && !item._fetched) {
          try {
            const fetched = await window._headerV2_dataManager
              .fetchWithRetry(item.jsonFile, { cache: true }, 3)
              .catch(err => { throw err; });

            if (Array.isArray(fetched)) {
              item._fetched = true;
              items.splice(i, 1, ...fetched);
              end = Math.min(items.length, startIdx + batchSz); // recalc
              i--;
              continue;
            } else {
              items.splice(i, 1, fetched);
              item = fetched;
            }
          } catch (err) {
            console.error('jsonFile fetch error', err);
          }
        }

        item = items[i];
        if (!item || this._renderedSet.has(i)) continue;

        const wrapper = this._acquire();
        wrapper.id = item.id || `ci-${i}`;

        const inner = this.createContainer(item);
        try {
          if (item.group?.categoryId || item.group?.items || item.categoryId) {
            const grp = item.group || { categoryId: item.categoryId, type: item.type || 'button' };
            await this.renderGroupItems(inner, grp);
          } else {
            await this.renderSingleItem(inner, item);
          }
        } catch (err) {
          console.error('render item error', err);
        }

        wrapper.appendChild(inner);
        // CSS class triggers lightweight fade-in (opacity only)
        wrapper.classList.add('fade-in');
        frag.appendChild(wrapper);
        this._virtualNodes.push(wrapper);
        this._renderedSet.add(i);
        created++;
      }

      if (frag.childNodes.length > 0) {
        container.appendChild(frag);
      }

      // Trim DOM: keep last N nodes to limit memory
      const MAX = this._deviceTier === 'low' ? 12 : (this._deviceTier === 'mid' ? 20 : 30);
      while (this._virtualNodes.length > MAX) {
        const old = this._virtualNodes.shift();
        try { if (old.parentNode) old.parentNode.removeChild(old); } catch (_) {}
        this._release(old);
      }

      return created;
    };

    // ---- Initial batch ----
    await renderBatch(0, this._batchSize());
    let rendered = this._renderedSet.size;

    if (rendered >= items.length) {
      try { window._headerV2_contentLoadingManager.hide(); } catch (_) {}
      return;
    }

    // ---- Sentinel for lazy loading remaining items ----
    let sentinel = document.getElementById(this._SENTINEL_ID);
    if (!sentinel) {
      sentinel = document.createElement('div');
      sentinel.id = this._SENTINEL_ID;
      sentinel.style.cssText = 'width:1px;height:1px;opacity:0;pointer-events:none;';
    }
    container.appendChild(sentinel);

    if (this._sentinelObserver) {
      try { this._sentinelObserver.disconnect(); } catch (_) {}
    }

    this._sentinelObserver = new IntersectionObserver((entries) => {
      if (signal.aborted || session !== this._renderSession) return;
      if (this._isRenderingNextBatch) return;
      if (!entries[0]?.isIntersecting) return;

      this._isRenderingNextBatch = true;

      // Use rIC when available to avoid blocking main thread
      const schedule = (fn) =>
        'requestIdleCallback' in window
          ? requestIdleCallback(fn, { timeout: 300 })
          : setTimeout(fn, 16);

      schedule(async () => {
        try {
          if (signal.aborted || session !== this._renderSession) return;
          await renderBatch(rendered, this._batchSize());
          rendered = this._renderedSet.size;

          if (rendered >= items.length) {
            try { sentinel.parentNode && sentinel.parentNode.removeChild(sentinel); } catch (_) {}
            if (this._sentinelObserver) {
              this._sentinelObserver.disconnect();
              this._sentinelObserver = null;
            }
            try { window._headerV2_contentLoadingManager.hide(); } catch (_) {}
          } else {
            // Re-append sentinel to trigger next load
            try { sentinel.parentNode && sentinel.parentNode.removeChild(sentinel); } catch (_) {}
            container.appendChild(sentinel);
          }
        } catch (err) {
          console.error('lazy batch error', err);
        } finally {
          this._isRenderingNextBatch = false;
        }
      });
    }, {
      root: null,
      rootMargin: '600px', // preload far ahead
      threshold: 0
    });

    this._sentinelObserver.observe(sentinel);
  },

  // ---- Container factory ----
  createContainer(item) {
    const c = document.createElement('div');
    if (item.group?.type === 'button' || item.type === 'button' || item.group?.categoryId) {
      c.className = 'button-content-container';
    } else {
      c.className = 'card-content-container';
    }
    if (item.group?.containerClass) c.classList.add(item.group.containerClass);
    return c;
  },

  // ---- Group render ----
  async renderGroupItems(container, group) {
    if (!group.categoryId && !group.items) throw new Error('Group must have categoryId or items');

    if (group.categoryId) {
      const dm = window._headerV2_data_manager || window._headerV2_dataManager;
      const { data, header } = await dm.fetchCategoryGroup(group.categoryId);
      if (header) container.appendChild(this.createGroupHeader(header));

      if (group.type === 'card') {
        for (const item of data) {
          const el = await this.createCard(item);
          if (el) container.appendChild(el);
        }
      } else {
        for (const item of data) {
          const el = await this.createButton(item);
          if (el) container.appendChild(el);
        }
      }
    } else if (Array.isArray(group.items)) {
      if (group.header) container.appendChild(this.createGroupHeader(group.header));
      if (group.type === 'card') {
        for (const item of group.items) {
          const el = await this.createCard(item);
          if (el) container.appendChild(el);
        }
      } else {
        for (const item of group.items) {
          const el = await this.createButton(item);
          if (el) container.appendChild(el);
        }
      }
    }
  },

  // ---- Header factory ----
  createGroupHeader(headerConfig) {
    const wrap = document.createElement('div');
    wrap.className = 'group-header';
    const lang = localStorage.getItem('selectedLang') || 'en';

    if (typeof headerConfig === 'string') {
      const h = document.createElement('h2');
      h.className = 'group-header-text';
      h.textContent = headerConfig;
      wrap.appendChild(h);
      return wrap;
    }

    if (headerConfig.className) wrap.classList.add(headerConfig.className);

    const h = document.createElement('h2');
    h.className = 'group-header-text';
    h.textContent = typeof headerConfig.title === 'object'
      ? (headerConfig.title[lang] || headerConfig.title.en || '')
      : (headerConfig.title || '');
    wrap.appendChild(h);

    if (headerConfig.description) {
      const d = document.createElement('p');
      d.className = 'group-header-description';
      d.textContent = typeof headerConfig.description === 'object'
        ? (headerConfig.description[lang] || headerConfig.description.en || '')
        : (headerConfig.description || '');
      wrap.appendChild(d);
    }

    // Language update listener (attached once via WeakMap-style check)
    if (!wrap._langBound) {
      wrap._langBound = true;
      window.addEventListener('languageChange', (ev) => {
        const nl = ev.detail?.language || 'en';
        const ht = wrap.querySelector('.group-header-text');
        if (ht && typeof headerConfig.title === 'object') {
          ht.textContent = headerConfig.title[nl] || headerConfig.title.en || ht.textContent;
        }
        const hd = wrap.querySelector('.group-header-description');
        if (hd && typeof headerConfig.description === 'object') {
          hd.textContent = headerConfig.description[nl] || headerConfig.description.en || hd.textContent;
        }
      }, { passive: true });
    }

    return wrap;
  },

  // ---- Single item ----
  async renderSingleItem(container, item) {
    if (item.categoryId) {
      await this.renderGroupItems(container, {
        categoryId: item.categoryId,
        type: item.type || 'button'
      });
      return;
    }
    const el = item.type === 'button'
      ? await this.createButton(item)
      : await this.createCard(item);
    if (el) container.appendChild(el);
  },

  // ---- Button factory ----
  async createButton(config) {
    const btn = document.createElement('button');
    btn.className = 'button-content';

    let finalContent = '';
    let apiCode = config.api || null;
    let type = config.type || null;

    try {
      if (apiCode) {
        const db = await (window._headerV2_data_manager?.loadApiDatabase?.()
          || window._headerV2_dataManager.loadApiDatabase());
        const apiNode = _findApi(db, apiCode);
        if (apiNode) {
          finalContent = apiNode.text;
          type = type || 'emoji';
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
        throw new Error('Button requires api, content or text');
      }
      btn.textContent = finalContent;
    } catch (_) {
      btn.textContent = 'Error';
    }

    btn.addEventListener('click', async () => {
      try {
        await (window.unifiedCopyToClipboard || unifiedCopyToClipboard)({
          text: finalContent,
          api: apiCode,
          type,
          name: apiCode || ''
        });
      } catch (_) {
        window._headerV2_utils.showNotification('Copy failed', 'error');
      }
    }, { passive: true });

    return btn;
  },

  // ---- Card factory ----
  async createCard(cfg) {
    const lang = localStorage.getItem('selectedLang') || 'en';
    const card = document.createElement('div');
    card.className = 'card';

    if (cfg.image) {
      const img = document.createElement('img');
      img.className = 'card-image';
      img.src = cfg.image;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = cfg.imageAlt?.[lang] || cfg.imageAlt?.en || '';
      card.appendChild(img);
    }

    const content = document.createElement('div');
    content.className = 'card-content';

    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = _getText(cfg.title || cfg.name, lang);
    content.appendChild(title);

    const desc = document.createElement('div');
    desc.className = 'card-description';
    desc.textContent = _getText(cfg.description, lang);
    content.appendChild(desc);

    card.appendChild(content);

    if (cfg.link) {
      card.addEventListener('click', () => {
        window.open(cfg.link, '_blank', 'noopener,noreferrer');
      }, { passive: true });
    }
    if (cfg.className) card.classList.add(cfg.className);

    return card;
  },

  // ---- Language update ----
  updateCardsLanguage(lang) {
    const cards = document.querySelectorAll('.card');
    for (const card of cards) {
      const t = card.querySelector('.card-title');
      if (t) { const v = t.dataset[`title${lang.toUpperCase()}`]; if (v) t.textContent = v; }
      const d = card.querySelector('.card-description');
      if (d) { const v = d.dataset[`desc${lang.toUpperCase()}`]; if (v) d.textContent = v; }
    }
  }
};

// ---- Helpers (module-level, no closure overhead per call) ----
function _findApi(obj, code) {
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = _findApi(item, code);
      if (r) return r;
    }
  } else if (obj && typeof obj === 'object') {
    if (obj.api === code) return obj;
    for (const k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        const r = _findApi(obj[k], code);
        if (r) return r;
      }
    }
  }
  return null;
}

function _getText(val, lang) {
  if (!val) return '';
  if (typeof val === 'object') return val[lang] || val.en || '';
  return val;
}

export default contentManager;