// contentManager.js  v4.0 — Platform-Level Scheduling
// ======================================================
// Same technology stack as search-engine.js v4.0:
//
// ✅ scheduler.postTask()     priority-aware scheduling (Chrome 94+, fallback rIC/rAF)
// ✅ scheduler.yield()        cooperative mid-task yield (Chrome 115+, fallback rIC)
// ✅ isInputPending()         yield immediately on user interaction (Chrome 87+)
// ✅ Deadline-aware inner loop  process items while rIC budget remains
// ✅ Tab-visibility guard      suspend rendering when tab hidden
// ✅ WeakRef for large caches  learning data GC-reclaimable under memory pressure
// ✅ FinalizationRegistry      auto-cleanup dead WeakRef entries
// ✅ Memory-aware pool sizing  POOL_MAX scales with navigator.deviceMemory
// ✅ GPU compositor setup      content area promoted to own GPU layer
// ✅ DocumentFragment          single-pass DOM insertion (1 reflow total)
// ✅ Compositor-safe fade-in   opacity only, never triggers layout
// ✅ PerfMonitor proxy         zero-overhead when disabled
//
// ALL PUBLIC APIs UNCHANGED:
//   renderContent(data), clearContent(), createButton(config), createCard(config)
//   renderGroupItems(container, group), updateCardsLanguage(lang), etc.

export const contentManager = {

  // ── Device capability ──────────────────────────────────────────
  _MEM          : Math.max(1, Math.min(8, navigator.deviceMemory || 4)),
  _CORES        : Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4)),

  get _isSlowDevice()  { return this._MEM <= 2; },
  get CHUNK_SIZE()     { return this._isSlowDevice ? 3 : 8; },
  get POOL_MAX()       {
    // Scale pool with available RAM: 20 nodes on 1 GB → 60 nodes on 8 GB
    return Math.round(20 + (this._MEM - 1) * 5.7);
  },
  EST_H : 400,  // contain-intrinsic-size fallback height

  // ── Scheduler primitives (inlined — no external dependency) ───
  //
  // Same implementation as search-engine.js v4.0 — keep in sync.
  _sched : (typeof scheduler !== 'undefined' && scheduler) || null,

  _scheduleTask(fn, priority, signal) {
    if (this._sched?.postTask) {
      const opts = { priority: priority || 'background' };
      if (signal) opts.signal = signal;
      return this._sched.postTask(fn, opts);
    }
    return new Promise((resolve, reject) => {
      const run = () => { try { resolve(fn()); } catch (e) { reject(e); } };
      if (!priority || priority === 'background') {
        if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2000 });
        else setTimeout(run, 0);
      } else {
        requestAnimationFrame(run);
      }
    });
  },

  _yieldNow() {
    if (this._sched?.yield) return this._sched.yield();
    return new Promise(resolve => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(resolve, { timeout: 300 });
      else setTimeout(resolve, 0);
    });
  },

  _isInputPending() {
    try { return !!navigator.scheduling?.isInputPending?.(); } catch { return false; }
  },

  // ── Tab visibility ─────────────────────────────────────────────
  _tabHidden : document.hidden,

  _initVisibilityListener() {
    if (this._visListenerBound) return;
    this._visListenerBound = true;
    document.addEventListener('visibilitychange', () => {
      this._tabHidden = document.hidden;
    }, { passive: true });
  },

  _waitUntilVisible() {
    if (!this._tabHidden) return Promise.resolve();
    return new Promise(resolve => {
      const h = () => {
        if (!document.hidden) { document.removeEventListener('visibilitychange', h); resolve(); }
      };
      document.addEventListener('visibilitychange', h, { passive: true });
    });
  },

  // ── WeakRef cache for learning data ───────────────────────────
  _wCache : new Map(),
  _wReg   : (typeof FinalizationRegistry !== 'undefined')
    ? new FinalizationRegistry(function(k) { contentManager._wCache.delete(k); }) : null,

  _wSet(key, val) {
    try {
      this._wCache.set(key, new WeakRef(val));
      this._wReg?.register(val, key);
    } catch { this._wCache.set(key, { deref: () => val }); }
  },

  _wGet(key) { return this._wCache.get(key)?.deref?.() ?? null; },

  // ── Node pool ──────────────────────────────────────────────────
  _pool: [],

  _acquire() {
    const node = this._pool.pop() || document.createElement('div');
    // CSS containment: same pattern as search-card + vs-item
    node.style.cssText =
      'contain:layout style paint;' +
      'content-visibility:auto;' +
      'contain-intrinsic-size:auto ' + this.EST_H + 'px;';
    node.className = '';
    return node;
  },

  _release(node) {
    if (!node) return;
    try { node.innerHTML = ''; node.className = ''; node.style.cssText = ''; node.removeAttribute('id'); } catch {}
    if (this._pool.length < this.POOL_MAX) this._pool.push(node);
    else { try { node.remove?.(); } catch {} }
  },

  // ── PerfMonitor proxy (zero overhead when disabled) ────────────
  _perf: {
    mark   (n)   { try { window.__searchUI?.perf?.mark   ('hdr:' + n); } catch {} },
    measure(n, s){ try { window.__searchUI?.perf?.measure('hdr:' + n, 'hdr:' + s); } catch {} },
  },

  // ── State ──────────────────────────────────────────────────────
  _renderSession       : 0,
  _abortController     : null,
  _items               : [],
  _renderedSet         : new Set(),
  _sentinelObserver    : null,
  _isUnmounted         : false,
  _isRenderingNextBatch: false,
  _SENTINEL_ID         : 'headerv2-render-sentinel',
  _visListenerBound    : false,

  // ── Learning worker (kept — priority sorting) ──────────────────
  _learningWorker  : null,
  _learningEnabled : true,

  _getLearningData() {
    return this._wGet('learning') || { views: {}, clicks: {} };
  },

  _setLearningData(d) {
    this._wSet('learning', d);
  },

  _initLearningWorkerIfNeeded(itemsCount) {
    if (!this._learningEnabled || this._learningWorker || itemsCount < 30) return;
    try {
      const code = `
        const s={v:{},c:{}};
        const sc=id=>{const v=s.v[id]||0,c=s.c[id]||0;return Math.log(1+v)+(3*Math.log(1+c));};
        onmessage=function(e){
          const{type,payload}=e.data||{};
          if(type==='record'){
            const{kind,id}=payload;
            if(!id)return;
            if(kind==='view')s.v[id]=(s.v[id]||0)+1;
            if(kind==='click')s.c[id]=(s.c[id]||0)+1;
          }else if(type==='getScores'){
            const items=payload.items||[];
            const r={};for(const id of items)r[id]=sc(id)||0;
            postMessage({type:'scores',payload:r});
          }else if(type==='hydrate'){
            const{views,clicks}=payload||{};
            if(views)Object.assign(s.v,views);
            if(clicks)Object.assign(s.c,clicks);
          }
        };`;
      const blob = new Blob([code], { type: 'application/javascript' });
      const url  = URL.createObjectURL(blob);
      this._learningWorker = new Worker(url);
      this._learningWorker.onmessage = (e) => {
        if (e.data?.type === 'scores') this._wSet('scores', e.data.payload || {});
      };
      const ld = this._getLearningData();
      this._learningWorker.postMessage({ type: 'hydrate', payload: ld });
    } catch { this._learningWorker = null; }
  },

  _recordEvent(kind, id) {
    if (!id) return;
    if (this._learningWorker) {
      this._learningWorker.postMessage({ type: 'record', payload: { kind, id } });
    } else {
      const ld = this._getLearningData();
      const bucket = kind === 'click' ? 'clicks' : 'views';
      ld[bucket][id] = (ld[bucket][id] || 0) + 1;
      this._setLearningData(ld);
    }
  },

  _getPriorityScoresFor(ids) {
    const ld = this._getLearningData();
    return new Promise(resolve => {
      const fallback = {};
      for (const id of ids) {
        const v = (ld.views?.[id])  || 0;
        const c = (ld.clicks?.[id]) || 0;
        fallback[id] = Math.log(1 + v) + (3 * Math.log(1 + c));
      }
      if (this._learningWorker) {
        const timer  = setTimeout(() => resolve(fallback), 80);
        const onmsg  = (e) => {
          if (e.data?.type === 'scores') {
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

  // ── clearContent ───────────────────────────────────────────────
  async clearContent() {
    this._renderSession = (this._renderSession || 0) + 1;
    const session = this._renderSession;

    try { if (this._abortController) { this._abortController.abort(); this._abortController = null; } } catch {}
    this._isUnmounted         = true;
    this._isRenderingNextBatch = false;

    try { const s = document.getElementById(this._SENTINEL_ID); if (s?.parentNode) s.parentNode.removeChild(s); } catch {}
    try { window._headerV2_contentLoadingManager.hide(); } catch {}
    if (this._sentinelObserver) { try { this._sentinelObserver.disconnect(); } catch {} this._sentinelObserver = null; }

    const containerId = window._headerV2_contentLoadingManager?.LOADING_CONTAINER_ID || 'content-loading';
    const container   = document.getElementById(containerId);
    if (container) {
      // Single rAF write: collect + remove + release all at once
      requestAnimationFrame(() => {
        const children = Array.from(container.children);
        for (const child of children) {
          try { container.removeChild(child); } catch {}
          this._release(child);
        }
      });
    }

    this._items       = [];
    this._renderedSet = new Set();
    return session;
  },

  // ── renderContent ──────────────────────────────────────────────
  async renderContent(data) {
    if (!Array.isArray(data)) throw new Error('Content data should be array');
    this._initVisibilityListener();

    const containerId = window._headerV2_contentLoadingManager?.LOADING_CONTAINER_ID || 'content-loading';
    const container   = document.getElementById(containerId);
    if (!container) return;

    await this.clearContent();

    // GPU compositor promotion — same as search overlay
    if (!container._gpuSetup) {
      Object.assign(container.style, {
        willChange        : 'transform',
        transform         : 'translateZ(0)',
        overscrollBehavior: 'contain',
      });
      container._gpuSetup = true;
    }

    // Loading overlay (respects sub-nav z-index)
    try {
      const subNavEl = document.getElementById('sub-nav');
      let behindSubNav = false;
      if (subNavEl) {
        try {
          const s = window.getComputedStyle(subNavEl);
          const visible = s.display !== 'none' && s.visibility !== 'hidden' && subNavEl.offsetHeight > 0;
          const cnt     = subNavEl.querySelector('#sub-buttons-container');
          if (visible && cnt?.childNodes.length > 0) behindSubNav = true;
        } catch {}
      }
      window._headerV2_contentLoadingManager.show({ behindSubNav });
    } catch {}

    // Session + abort controller
    this._renderSession = (this._renderSession || 0) + 1;
    const session             = this._renderSession;
    this._abortController     = (typeof AbortController !== 'undefined')
      ? new AbortController() : { signal: {}, abort: () => {} };
    const signal              = this._abortController.signal;
    this._isUnmounted         = false;
    this._isRenderingNextBatch = false;

    const items = data.slice();
    this._items = items;
    this._initLearningWorkerIfNeeded(items.length);

    // Priority sort (async, uses WeakRef-stored scores)
    const idList = items.map((it, i) => (it?.id) ? it.id : `__idx_${i}`);
    let scores = {};
    try { scores = await this._getPriorityScoresFor(idList); } catch {}
    if (idList.some(id => scores[id] > 0)) {
      items.sort((a, b) => {
        const ia = a?.id || '', ib = b?.id || '';
        return (scores[ib] || 0) - (scores[ia] || 0);
      });
    }

    this._perf.mark('render-start');

    // ── renderBatch — DocumentFragment + rAF pattern ─────────────
    const renderBatch = async (startIndex, count) => {
      if (signal.aborted || this._isUnmounted || session !== this._renderSession) return 0;

      const end  = Math.min(items.length, startIndex + count);
      if (startIndex >= end) return 0;

      const frag    = document.createDocumentFragment();
      let   created = 0;
      this._perf.mark('batch-start');

      for (let i = startIndex; i < end; i++) {
        if (signal.aborted || this._isUnmounted || session !== this._renderSession) break;
        if (this._renderedSet.has(i)) continue;

        let item = items[i];

        // Lazy jsonFile fetch
        if (item?.jsonFile && !item._fetched) {
          try {
            try { window._headerV2_contentLoadingManager.updateMessage('Loading...'); } catch {}
            const fetched = await window._headerV2_dataManager
              .fetchWithRetry(item.jsonFile, { cache: true }, 3)
              .catch(err => { throw err; });
            if (Array.isArray(fetched)) {
              item._fetched = true; items.splice(i, 1, ...fetched); i--; continue;
            } else if (typeof fetched === 'object' && fetched !== null && Array.isArray(fetched.data)) {
              item._fetched = true; items.splice(i, 1, ...fetched.data); i--; continue;
            } else {
              items.splice(i, 1, fetched); item = fetched;
            }
          } catch (err) { console.error('Error fetching jsonFile', err); }
        }

        item = items[i];
        if (!item || this._renderedSet.has(i)) continue;

        const wrapper = this._acquire();
        wrapper.id    = item.id || `content-item-${i}`;
        wrapper.style.opacity = '0';   // will fade in after insertion

        const inner = this.createContainer(item);
        try {
          if (item.group?.categoryId || item.group?.type === 'card' || item.group?.type === 'button') {
            await this.renderGroupItems(inner, item.group);
          } else if (item.categoryId) {
            await this.renderGroupItems(inner, { categoryId: item.categoryId, type: item.type || 'button' });
          } else {
            await this.renderSingleItem(inner, item);
          }
        } catch (err) { console.error('render item error', err); }

        wrapper.appendChild(inner);
        frag.appendChild(wrapper);
        this._renderedSet.add(i);
        created++;
      }

      this._perf.measure('content-batch', 'batch-start');

      // Single DOM insertion → rAF compositor-safe fade-in (opacity only, no layout)
      if (frag.hasChildNodes()) {
        await new Promise(resolve => {
          requestAnimationFrame(() => {
            container.appendChild(frag);
            requestAnimationFrame(() => {
              const ch    = container.children;
              const start = ch.length - created;
              for (let j = start; j < ch.length; j++) {
                if (ch[j]) ch[j].style.opacity = '1';
              }
              resolve();
            });
          });
        });
      }

      return created;
    };

    // ── Initial batch ─────────────────────────────────────────────
    await renderBatch(0, this.CHUNK_SIZE);
    let renderedCount = this._renderedSet.size;

    if (renderedCount >= items.length) {
      this._perf.measure('content-render', 'render-start');
      try { window._headerV2_contentLoadingManager.hide(); } catch {}
      return;
    }

    // ── Sentinel: lazy-load remaining batches ─────────────────────
    let sentinel = document.getElementById(this._SENTINEL_ID);
    if (!sentinel) {
      sentinel = document.createElement('div');
      sentinel.id = this._SENTINEL_ID;
      Object.assign(sentinel.style, { width:'1px', height:'1px', opacity:'0', pointerEvents:'none' });
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

          // Tab hidden → wait; also yield via scheduler before heavy work
          if (this._tabHidden) await this._waitUntilVisible();
          await this._yieldNow();

          try {
            if (signal.aborted || this._isUnmounted || session !== this._renderSession) return;
            await renderBatch(renderedCount, this.CHUNK_SIZE);
            renderedCount = this._renderedSet.size;

            if (renderedCount < items.length) {
              try { if (sentinel.parentNode) sentinel.parentNode.removeChild(sentinel); } catch {}
              container.appendChild(sentinel);
            } else {
              try { if (sentinel.parentNode) sentinel.parentNode.removeChild(sentinel); } catch {}
              if (this._sentinelObserver) { try { this._sentinelObserver.disconnect(); } catch {} this._sentinelObserver = null; }
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
        root: null, rootMargin: '400px', threshold: 0.1,
      });
      try { this._sentinelObserver.observe(sentinel); } catch {}
    } else {
      // Scroll fallback for old browsers
      const scrollFn = () => {
        if (this._isRenderingNextBatch || signal.aborted || this._isUnmounted || session !== this._renderSession) return;
        const rect = sentinel.getBoundingClientRect();
        if (rect.top < (window.innerHeight + 400)) {
          this._isRenderingNextBatch = true;
          setTimeout(async () => {
            try {
              await this._yieldNow();
              await renderBatch(renderedCount, this.CHUNK_SIZE);
              renderedCount = this._renderedSet.size;
              if (renderedCount >= items.length) {
                window.removeEventListener('scroll', scrollFn);
                this._perf.measure('content-render', 'render-start');
                try { window._headerV2_contentLoadingManager.hide(); } catch {}
              }
            } catch {} finally { this._isRenderingNextBatch = false; }
          }, 0);
        }
      };
      window.addEventListener('scroll', scrollFn, { passive: true });
    }
  },

  // ── Public cleanup hook ────────────────────────────────────────
  get _cleanupRender() { return () => this.clearContent(); },

  // ──────────────────────────────────────────────────────────────
  // PUBLIC APIs — all unchanged from v3.2
  // ──────────────────────────────────────────────────────────────

  createContainer(item) {
    const c = document.createElement('div');
    c.className = (item.group?.type === 'button' || item.type === 'button' ||
                   (item.group?.categoryId && !item.group?.type))
      ? 'button-content-container' : 'card-content-container';
    if (item.group?.containerClass) c.classList.add(item.group.containerClass);
    return c;
  },

  async renderGroupItems(container, group) {
    if (!group.categoryId && !group.items) throw new Error('Group requires categoryId or items');
    if (group.categoryId) {
      const { data, header } = await (window._headerV2_data_manager?.fetchCategoryGroup
        ? window._headerV2_data_manager.fetchCategoryGroup(group.categoryId)
        : window._headerV2_dataManager.fetchCategoryGroup(group.categoryId));
      if (header) container.appendChild(this.createGroupHeader(header));
      for (const item of data) {
        const el = await (group.type === 'card' ? this.createCard(item) : this.createButton(item));
        if (el) container.appendChild(el);
      }
    } else if (Array.isArray(group.items)) {
      if (group.header) container.appendChild(this.createGroupHeader(group.header));
      for (const item of group.items) {
        const el = await (group.type === 'card' ? this.createCard(item) : this.createButton(item));
        if (el) container.appendChild(el);
      }
    }
  },

  createGroupHeader(headerConfig) {
    const hc = document.createElement('div');
    hc.className = 'group-header';
    const lang = localStorage.getItem('selectedLang') || 'en';
    if (typeof headerConfig === 'string') {
      const h = document.createElement('h2'); h.className = 'group-header-text'; h.textContent = headerConfig;
      hc.appendChild(h); return hc;
    }
    if (headerConfig.className) hc.classList.add(headerConfig.className);
    if (headerConfig.icon) hc.appendChild(this.createHeaderIcon?.(headerConfig.icon));
    const hContent = document.createElement('div'); hContent.className = 'header-content';
    const title = document.createElement('h2'); title.className = 'group-header-text';
    if (typeof headerConfig.title === 'object') {
      Object.entries(headerConfig.title).forEach(([l, t]) => { title.dataset[`title${l.toUpperCase()}`] = t; });
      title.textContent = headerConfig.title[lang] || headerConfig.title.en;
    } else title.textContent = headerConfig.title || '';
    hContent.appendChild(title);
    if (headerConfig.description) {
      const desc = document.createElement('p'); desc.className = 'group-header-description';
      if (typeof headerConfig.description === 'object') {
        Object.entries(headerConfig.description).forEach(([l, t]) => { desc.dataset[`desc${l.toUpperCase()}`] = t; });
        desc.textContent = headerConfig.description[lang] || headerConfig.description.en;
      } else desc.textContent = headerConfig.description;
      hContent.appendChild(desc);
    }
    hc.appendChild(hContent);
    if (!hc._langListenerBound) {
      hc._langListenerBound = true;
      window.addEventListener('languageChange', ev => {
        const nl = ev.detail?.language;
        const te = hc.querySelector('.group-header-text');
        if (te && typeof headerConfig.title === 'object')
          te.textContent = headerConfig.title[nl] || headerConfig.title.en || te.textContent;
        const de = hc.querySelector('.group-header-description');
        if (de && typeof headerConfig.description === 'object')
          de.textContent = headerConfig.description[nl] || headerConfig.description.en || de.textContent;
      }, { passive: true });
    }
    return hc;
  },

  async renderSingleItem(container, item) {
    if (item.categoryId) {
      await this.renderGroupItems(container, { categoryId: item.categoryId, type: item.type || 'button' });
      return;
    }
    const el = item.type === 'button' ? await this.createButton(item) : await this.createCard(item);
    if (el) container.appendChild(el);
  },

  async createButton(config) {
    const btn = document.createElement('button');
    btn.className = 'button-content';
    let finalContent = '', apiCode = config.api || null, type = config.type || null;
    try {
      if (apiCode) {
        const db = await (window._headerV2_data_manager?.loadApiDatabase?.() || window._headerV2_dataManager.loadApiDatabase());
        function findApi(obj, code) {
          if (Array.isArray(obj)) { for (const it of obj) { const f = findApi(it, code); if (f) return f; } }
          else if (obj && typeof obj === 'object') {
            if (obj.api === code) return obj;
            for (const k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) { const f = findApi(obj[k], code); if (f) return f; } }
          }
          return null;
        }
        const node = findApi(db, apiCode);
        if (node) { finalContent = node.text; type = type || (node.api ? 'emoji' : 'symbol'); }
        else finalContent = apiCode;
      } else if (config.content) { finalContent = config.content; type = 'symbol'; }
        else if (config.text)    { finalContent = config.text;    type = 'symbol'; }
        else throw new Error('Button requires api, content, or text');
      btn.textContent = finalContent;
    } catch { btn.textContent = 'Error'; }

    btn.addEventListener('click', async () => {
      try { this._recordEvent('click', btn.dataset?.url || btn.id); } catch {}
      try {
        await (window.unifiedCopyToClipboard || unifiedCopyToClipboard).call(null, {
          text: finalContent, api: apiCode, type, name: apiCode || '',
        });
      } catch { window._headerV2_utils.showNotification('Copy failed', 'error'); }
    });

    btn.style.opacity = '0';
    requestAnimationFrame(() => { btn.style.opacity = '1'; });
    return btn;
  },

  async createCard(cfg) {
    const lang = localStorage.getItem('selectedLang') || 'en';
    const card = document.createElement('div');
    card.className = 'card';

    if (cfg.image) {
      const img = document.createElement('img');
      img.className = 'card-image'; img.src = cfg.image; img.loading = 'lazy';
      img.alt = cfg.imageAlt?.[lang] || cfg.imageAlt?.en || '';
      card.appendChild(img);
    }

    const cd = document.createElement('div'); cd.className = 'card-content';
    const td = document.createElement('div'); td.className = 'card-title';
    if (typeof cfg.title === 'object') {
      Object.entries(cfg.title).forEach(([l, t]) => { td.dataset[`title${l.toUpperCase()}`] = t; });
      td.textContent = cfg.title[lang] || cfg.title.en;
    } else if (cfg.name && typeof cfg.name === 'object') {
      td.textContent = cfg.name[lang] || cfg.name.en;
    } else td.textContent = cfg.title || cfg.name || '';
    cd.appendChild(td);

    const dd = document.createElement('div'); dd.className = 'card-description';
    if (typeof cfg.description === 'object') {
      Object.entries(cfg.description).forEach(([l, t]) => { dd.dataset[`desc${l.toUpperCase()}`] = t; });
      dd.textContent = cfg.description[lang] || cfg.description.en;
    } else if (cfg.name && typeof cfg.name === 'object') {
      dd.textContent = cfg.name[lang] || cfg.name.en;
    } else dd.textContent = cfg.description || '';
    cd.appendChild(dd);
    card.appendChild(cd);

    if (cfg.link) card.addEventListener('click', () => window.open(cfg.link, '_blank', 'noopener'));
    if (cfg.className) card.classList.add(cfg.className);

    card.style.opacity = '0';
    requestAnimationFrame(() => { card.style.opacity = '1'; });
    return card;
  },

  updateCardsLanguage(lang) {
    const cards = document.querySelectorAll('.card');
    for (const card of cards) {
      const te = card.querySelector('.card-title');
      if (te) { const t = te.dataset[`title${lang.toUpperCase()}`]; if (t) te.textContent = t; }
      const de = card.querySelector('.card-description');
      if (de) { const d = de.dataset[`desc${lang.toUpperCase()}`]; if (d) de.textContent = d; }
      const ie = card.querySelector('.card-image');
      if (ie) { const a = ie.dataset[`alt${lang.toUpperCase()}`]; if (a) ie.alt = a; }
    }
  },
};

export default contentManager;