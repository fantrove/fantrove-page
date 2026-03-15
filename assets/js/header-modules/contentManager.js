// contentManager.js  v5.0 — VirtualGrid + Zero-Jank Architecture
// ================================================================
//
// WHAT CHANGED FROM v4.0:
//
//  ✅ VirtualGrid        — card containers render ONLY visible rows.
//                          Off-screen nodes are recycled (pool), total live
//                          DOM count stays ≤ ~40 cards regardless of dataset.
//  ✅ Compositor scroll   — items positioned via transform:translate(x,y)
//                          so scroll never touches layout engine.
//  ✅ Event delegation    — one listener per container, zero per card.
//  ✅ ResizeObserver      — responsive column-count without resize events.
//  ✅ Adaptive thresholds — VG activates at ≥20 cards; tiny groups render
//                          flat (no overhead for small datasets).
//  ✅ Sync HTML renderer  — _renderCardHTML() produces HTML strings for VG
//                          without async overhead in the hot path.
//
//  ALL PUBLIC APIs UNCHANGED:
//    renderContent(data), clearContent(), createButton(config),
//    createCard(config), renderGroupItems(container, group),
//    updateCardsLanguage(lang)

// ─── Device caps ──────────────────────────────────────────────
const _MEM   = Math.max(1, Math.min(8, navigator.deviceMemory || 4));
const _CORES = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4));

// ─── VirtualGrid constants ────────────────────────────────────
// These match the CSS values in styles.min.css exactly.
const VG_CARD_W   = 160;   // .card width
const VG_CARD_H   = 222;   // .card max-height
const VG_GAP      = 6;     // gap in .card-content-container
const VG_ITEM_W   = VG_CARD_W + VG_GAP;   // 166px per column stride
const VG_ITEM_H   = VG_CARD_H + VG_GAP;   // 228px per row stride
const VG_OVERSCAN = _MEM <= 2 ? 300 : 500; // px above/below viewport
const VG_POOL_MAX = Math.round(12 + _MEM * 4); // ~16-44 pooled nodes
const VG_THRESHOLD = 20;   // activate VG when card count ≥ this

// ─── Scheduler ────────────────────────────────────────────────
const _sched = (typeof scheduler !== 'undefined' && scheduler) || null;

function _scheduleTask(fn, priority, signal) {
  if (_sched?.postTask) {
    const opts = { priority: priority || 'background' };
    if (signal) opts.signal = signal;
    return _sched.postTask(fn, opts);
  }
  return new Promise((res, rej) => {
    const run = () => { try { res(fn()); } catch (e) { rej(e); } };
    if (!priority || priority === 'background') {
      if (typeof requestIdleCallback === 'function')
        requestIdleCallback(run, { timeout: 2000 });
      else setTimeout(run, 0);
    } else {
      requestAnimationFrame(run);
    }
  });
}

function _yieldNow() {
  if (_sched?.yield) return _sched.yield();
  return new Promise(resolve => {
    if (typeof requestIdleCallback === 'function')
      requestIdleCallback(resolve, { timeout: 300 });
    else setTimeout(resolve, 0);
  });
}

function _isInputPending() {
  try { return !!navigator.scheduling?.isInputPending?.(); } catch { return false; }
}

// ─── WeakRef cache ────────────────────────────────────────────
const _wCache = new Map();
const _wReg = (typeof FinalizationRegistry !== 'undefined')
  ? new FinalizationRegistry(k => _wCache.delete(k)) : null;

function _wSet(key, val) {
  try {
    _wCache.set(key, new WeakRef(val));
    _wReg?.register(val, key);
  } catch { _wCache.set(key, { deref: () => val }); }
}
function _wGet(key) { return _wCache.get(key)?.deref?.() ?? null; }

// ─── PerfMonitor proxy ────────────────────────────────────────
const _perf = {
  mark   (n)    { try { window.__searchUI?.perf?.mark   ('hdr:' + n); } catch {} },
  measure(n, s) { try { window.__searchUI?.perf?.measure('hdr:' + n, 'hdr:' + s); } catch {} },
};

// ================================================================
// VirtualGrid
// ================================================================
// One instance per .card-content-container.
// Renders only cards that are within VG_OVERSCAN px of viewport,
// recycles the rest into a pool of reusable <div> nodes.
// Uses transform:translate(x,y) for all positioning — pure compositor,
// no layout recalculation on scroll.
// ================================================================
class VirtualGrid {
  constructor(container, items, renderItemHTML, scrollParent) {
    this._container   = container;
    this._items       = items;
    this._renderHTML  = renderItemHTML;   // (item, index) → HTML string
    this._scrollP     = scrollParent || window;
    this._destroyed   = false;

    this._colCount    = 1;
    this._pool        = [];
    this._rendered    = new Map();  // itemIndex → element
    this._raf         = null;

    // Create inner box that is absolutely positioned inside container
    this._box = document.createElement('div');
    this._box.className = 'vg-box';
    this._box.style.cssText =
      'position:relative;' +
      'contain:layout style;' +
      'min-height:2px;' +
      'width:100%;';

    // The container must be relative so absolute children position inside it
    container.style.position = 'relative';
    container.style.overflow = 'hidden';
    container.appendChild(this._box);

    // Bind listeners
    this._onScroll = () => this._sched();
    this._onResize = () => { this._measure(); this._sched(); };

    this._scrollP.addEventListener('scroll', this._onScroll, { passive: true });

    if ('ResizeObserver' in window) {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(container);
    }

    this._measure();
    this._sched();
  }

  // ── Column layout ──────────────────────────────────────────────
  _measure() {
    if (this._destroyed) return;
    const containerW = this._container.offsetWidth || window.innerWidth;
    this._colCount = Math.max(1, Math.floor((containerW + VG_GAP) / VG_ITEM_W));
    const rowCount  = Math.ceil(this._items.length / this._colCount);
    this._box.style.height = (rowCount * VG_ITEM_H) + 'px';
  }

  // ── Scheduling ────────────────────────────────────────────────
  _sched() {
    if (this._destroyed || this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      if (!this._destroyed) this._render();
    });
  }

  _scrollTop() {
    return this._scrollP === window
      ? (window.pageYOffset || window.scrollY || 0)
      : this._scrollP.scrollTop;
  }

  // ── Main render loop ──────────────────────────────────────────
  _render() {
    if (this._destroyed || !this._box || !this._items.length) return;

    const st  = this._scrollTop();
    const vh  = window.innerHeight;
    const brc = this._box.getBoundingClientRect();
    const boxTopAbs = brc.top + st;

    const lo = st - boxTopAbs - VG_OVERSCAN;
    const hi = st - boxTopAbs + vh + VG_OVERSCAN;

    const rowCount  = Math.ceil(this._items.length / this._colCount);
    const firstRow  = Math.max(0, Math.floor(lo / VG_ITEM_H));
    const lastRow   = Math.min(rowCount - 1, Math.ceil(hi / VG_ITEM_H));

    const firstIdx  = firstRow * this._colCount;
    const lastIdx   = Math.min(this._items.length - 1,
                               (lastRow + 1) * this._colCount - 1);

    // ── Recycle off-screen elements ────────────────────────────
    const toRecycle = [];
    for (const [idx] of this._rendered) {
      if (idx < firstIdx || idx > lastIdx) toRecycle.push(idx);
    }
    for (const idx of toRecycle) {
      const el = this._rendered.get(idx);
      this._rendered.delete(idx);
      el.innerHTML = '';
      if (this._pool.length < VG_POOL_MAX) this._pool.push(el);
      else el.remove();
    }

    // ── Mount visible elements ─────────────────────────────────
    const frag = document.createDocumentFragment();
    for (let i = firstIdx; i <= lastIdx; i++) {
      if (this._rendered.has(i) || !this._items[i]) continue;

      const col = i % this._colCount;
      const row = Math.floor(i / this._colCount);
      const tx  = col * VG_ITEM_W;
      const ty  = row * VG_ITEM_H;

      let el = this._pool.pop();
      const isNew = !el;
      if (!el) {
        el = document.createElement('div');
        el.className = 'vg-item';
        // contain:strict would prevent interaction — use layout+style+paint
        el.style.cssText =
          'position:absolute;' +
          'top:0;left:0;' +
          `width:${VG_CARD_W}px;` +
          'contain:layout style paint;' +
          'will-change:transform;';
      }

      // Position via transform — compositor only, no layout
      el.style.transform = `translate(${tx}px,${ty}px)`;
      el.innerHTML = this._renderHTML(this._items[i], i);

      this._rendered.set(i, el);
      if (isNew) frag.appendChild(el);
    }

    if (frag.hasChildNodes()) this._box.appendChild(frag);
  }

  // ── Public API ─────────────────────────────────────────────────
  update(newItems) {
    this._items = newItems;
    this._measure();
    this._sched();
  }

  destroy() {
    this._destroyed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._scrollP.removeEventListener('scroll', this._onScroll);
    if (this._ro) this._ro.disconnect();
    this._box?.remove();
    this._rendered.clear();
    this._pool = [];
    this._container.style.position = '';
    this._container.style.overflow = '';
  }
}

// ================================================================
// contentManager
// ================================================================
export const contentManager = {

  // ── Device ──────────────────────────────────────────────────────
  _MEM  : _MEM,
  _CORES: _CORES,
  get _isSlowDevice() { return this._MEM <= 2; },
  get CHUNK_SIZE()    { return this._isSlowDevice ? 3 : 8; },
  get POOL_MAX()      { return Math.round(20 + (this._MEM - 1) * 5.7); },
  EST_H : 400,

  // ── Scheduler ─────────────────────────────────────────────────
  _sched: _sched,
  _scheduleTask,
  _yieldNow,
  _isInputPending,

  // ── Tab visibility ─────────────────────────────────────────────
  _tabHidden        : document.hidden,
  _visListenerBound : false,

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
        if (!document.hidden) {
          document.removeEventListener('visibilitychange', h);
          resolve();
        }
      };
      document.addEventListener('visibilitychange', h, { passive: true });
    });
  },

  // ── WeakRef cache ──────────────────────────────────────────────
  _wCache : new Map(),
  _wReg   : _wReg,
  _wSet, _wGet,

  // ── DOM pool (for group wrappers, not VG cards) ────────────────
  _pool: [],

  _acquire() {
    const node = this._pool.pop() || document.createElement('div');
    node.style.cssText =
      'contain:layout style paint;' +
      'content-visibility:auto;' +
      `contain-intrinsic-size:auto ${this.EST_H}px;`;
    node.className = '';
    return node;
  },

  _release(node) {
    if (!node) return;
    // Destroy any embedded VirtualGrid before recycling wrapper
    if (node._vg) { try { node._vg.destroy(); } catch {} node._vg = null; }
    try {
      node.innerHTML = ''; node.className = '';
      node.style.cssText = ''; node.removeAttribute('id');
    } catch {}
    if (this._pool.length < this.POOL_MAX) this._pool.push(node);
    else { try { node.remove?.(); } catch {} }
  },

  // ── PerfMonitor proxy ──────────────────────────────────────────
  _perf,

  // ── State ──────────────────────────────────────────────────────
  _renderSession        : 0,
  _abortController      : null,
  _items                : [],
  _renderedSet          : new Set(),
  _sentinelObserver     : null,
  _isUnmounted          : false,
  _isRenderingNextBatch : false,
  _SENTINEL_ID          : 'headerv2-render-sentinel',

  // ── Active VirtualGrids (for cleanup) ─────────────────────────
  _activeGrids: [],

  // ── Learning worker ────────────────────────────────────────────
  _learningWorker  : null,
  _learningEnabled : true,

  _getLearningData()  { return this._wGet('learning') || { views: {}, clicks: {} }; },
  _setLearningData(d) { this._wSet('learning', d); },

  _initLearningWorkerIfNeeded(itemsCount) {
    if (!this._learningEnabled || this._learningWorker || itemsCount < 30) return;
    try {
      const code = `
        const s={v:{},c:{}};
        const sc=id=>{const v=s.v[id]||0,c=s.c[id]||0;return Math.log(1+v)+(3*Math.log(1+c));};
        onmessage=function(e){
          const{type,payload}=e.data||{};
          if(type==='record'){const{kind,id}=payload;if(!id)return;if(kind==='view')s.v[id]=(s.v[id]||0)+1;if(kind==='click')s.c[id]=(s.c[id]||0)+1;}
          else if(type==='getScores'){const items=payload.items||[];const r={};for(const id of items)r[id]=sc(id)||0;postMessage({type:'scores',payload:r});}
          else if(type==='hydrate'){const{views,clicks}=payload||{};if(views)Object.assign(s.v,views);if(clicks)Object.assign(s.c,clicks);}
        };`;
      const blob = new Blob([code], { type: 'application/javascript' });
      this._learningWorker = new Worker(URL.createObjectURL(blob));
      this._learningWorker.onmessage = e => {
        if (e.data?.type === 'scores') this._wSet('scores', e.data.payload || {});
      };
      this._learningWorker.postMessage({ type: 'hydrate', payload: this._getLearningData() });
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
        const v = ld.views?.[id] || 0;
        const c = ld.clicks?.[id] || 0;
        fallback[id] = Math.log(1 + v) + (3 * Math.log(1 + c));
      }
      if (this._learningWorker) {
        const timer = setTimeout(() => resolve(fallback), 80);
        const onmsg = e => {
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
    this._isUnmounted          = false;
    this._isRenderingNextBatch = false;

    // Destroy all active VirtualGrids
    for (const vg of this._activeGrids) {
      try { vg.destroy(); } catch {}
    }
    this._activeGrids = [];

    try { const s = document.getElementById(this._SENTINEL_ID); if (s?.parentNode) s.parentNode.removeChild(s); } catch {}
    try { window._headerV2_contentLoadingManager.hide(); } catch {}
    if (this._sentinelObserver) { try { this._sentinelObserver.disconnect(); } catch {} this._sentinelObserver = null; }

    const containerId = window._headerV2_contentLoadingManager?.LOADING_CONTAINER_ID || 'content-loading';
    const container   = document.getElementById(containerId);
    if (container) {
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

    // GPU layer on scroll container
    if (!container._gpuSetup) {
      Object.assign(container.style, {
        willChange        : 'transform',
        transform         : 'translateZ(0)',
        overscrollBehavior: 'contain',
      });
      container._gpuSetup = true;
    }

    // Loading overlay
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

    this._renderSession = (this._renderSession || 0) + 1;
    const session = this._renderSession;
    this._abortController = (typeof AbortController !== 'undefined')
      ? new AbortController() : { signal: {}, abort: () => {} };
    const signal = this._abortController.signal;
    this._isUnmounted          = false;
    this._isRenderingNextBatch = false;

    const items = data.slice();
    this._items = items;
    this._initLearningWorkerIfNeeded(items.length);

    // Priority sort
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

    // ── renderBatch ──────────────────────────────────────────────
    const renderBatch = async (startIndex, count) => {
      if (signal.aborted || this._isUnmounted || session !== this._renderSession) return 0;

      const end = Math.min(items.length, startIndex + count);
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

        const wrapper   = this._acquire();
        wrapper.id      = item.id || `content-item-${i}`;
        wrapper.style.opacity = '0';

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

    // Initial batch
    await renderBatch(0, this.CHUNK_SIZE);
    let renderedCount = this._renderedSet.size;

    if (renderedCount >= items.length) {
      this._perf.measure('content-render', 'render-start');
      try { window._headerV2_contentLoadingManager.hide(); } catch {}
      return;
    }

    // Sentinel for remaining batches
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

  get _cleanupRender() { return () => this.clearContent(); },

  // ================================================================
  // PUBLIC APIs (ALL UNCHANGED)
  // ================================================================

  createContainer(item) {
    const c = document.createElement('div');
    c.className = (item.group?.type === 'button' || item.type === 'button' ||
                   (item.group?.categoryId && !item.group?.type))
      ? 'button-content-container' : 'card-content-container';
    if (item.group?.containerClass) c.classList.add(item.group.containerClass);
    return c;
  },

  // ── renderGroupItems: uses VirtualGrid for large card groups ───
  async renderGroupItems(container, group) {
    if (!group.categoryId && !group.items) throw new Error('Group requires categoryId or items');

    let items = [], header = null;

    if (group.categoryId) {
      const fetched = await (window._headerV2_data_manager?.fetchCategoryGroup
        ? window._headerV2_data_manager.fetchCategoryGroup(group.categoryId)
        : window._headerV2_dataManager.fetchCategoryGroup(group.categoryId));
      items  = fetched.data || [];
      header = fetched.header || null;
    } else if (Array.isArray(group.items)) {
      items  = group.items;
      header = group.header || null;
    }

    if (header) container.appendChild(this.createGroupHeader(header));

    const isCard = group.type === 'card';
    const lang   = localStorage.getItem('selectedLang') || 'en';

    if (isCard && items.length >= VG_THRESHOLD) {
      // ── Virtual Grid path ──────────────────────────────────────
      // Delegate click events on the container (event delegation)
      if (!container._vgDelegated) {
        container._vgDelegated = true;
        container.addEventListener('click', async e => {
          const card = e.target.closest('.card');
          if (!card) return;
          const link = card.dataset.link;
          if (link) { window.open(link, '_blank', 'noopener'); return; }
          // If the card has a copy button, handle copy
          const copyBtn = e.target.closest('.card-copy-btn');
          if (copyBtn) {
            const text = copyBtn.dataset.text;
            if (text) {
              try { await navigator.clipboard.writeText(text); } catch {}
            }
          }
        }, { passive: false });
      }

      const vg = new VirtualGrid(
        container,
        items,
        (item) => this._renderCardHTML(item, lang),
        window
      );

      // Store for cleanup
      container._vg = vg;
      this._activeGrids.push(vg);

    } else {
      // ── Normal flat render ──────────────────────────────────────
      for (const item of items) {
        const el = await (isCard ? this.createCard(item) : this.createButton(item));
        if (el) container.appendChild(el);
      }
    }
  },

  // ── _renderCardHTML: synchronous HTML renderer for VG ──────────
  // Returns HTML string for a card item. Used by VirtualGrid hot path.
  _renderCardHTML(cfg, lang) {
    if (!lang) lang = localStorage.getItem('selectedLang') || 'en';

    const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    let title = '', description = '';

    if (typeof cfg.title === 'object') {
      title = cfg.title[lang] || cfg.title.en || '';
    } else if (cfg.name && typeof cfg.name === 'object') {
      title = cfg.name[lang] || cfg.name.en || '';
    } else {
      title = cfg.title || cfg.name || '';
    }

    if (typeof cfg.description === 'object') {
      description = cfg.description[lang] || cfg.description.en || '';
    } else if (cfg.name && typeof cfg.name === 'object') {
      description = cfg.name[lang] || cfg.name.en || '';
    } else {
      description = cfg.description || '';
    }

    const imgHtml = cfg.image
      ? `<img class="card-image" src="${esc(cfg.image)}" loading="lazy" alt="${esc(cfg.imageAlt?.[lang] || cfg.imageAlt?.en || '')}" decoding="async">`
      : '';

    const linkAttr = cfg.link ? ` data-link="${esc(cfg.link)}" style="cursor:pointer"` : '';
    const clsAttr  = cfg.className ? ` ${esc(cfg.className)}` : '';

    return `<div class="card${clsAttr}" role="article"${linkAttr}>
  ${imgHtml}
  <div class="card-content">
    <div class="card-title"
      data-titleen="${esc(typeof cfg.title === 'object' ? (cfg.title.en || '') : title)}"
      data-titleth="${esc(typeof cfg.title === 'object' ? (cfg.title.th || '') : '')}">
      ${esc(title)}
    </div>
    <div class="card-description"
      data-descen="${esc(typeof cfg.description === 'object' ? (cfg.description.en || '') : description)}"
      data-descth="${esc(typeof cfg.description === 'object' ? (cfg.description.th || '') : '')}">
      ${esc(description)}
    </div>
  </div>
</div>`;
  },

  createGroupHeader(headerConfig) {
    const hc   = document.createElement('div');
    hc.className = 'group-header';
    const lang = localStorage.getItem('selectedLang') || 'en';

    if (typeof headerConfig === 'string') {
      const h = document.createElement('h2'); h.className = 'group-header-text'; h.textContent = headerConfig;
      hc.appendChild(h); return hc;
    }

    if (headerConfig.className) hc.classList.add(headerConfig.className);
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
      img.className = 'card-image';
      img.src = cfg.image;
      img.loading = 'lazy';
      img.decoding = 'async';
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
    // Update virtual-grid rendered cards (HTML strings with data-attributes)
    const vgItems = document.querySelectorAll('.vg-item .card');
    for (const card of vgItems) {
      const te = card.querySelector('.card-title');
      if (te) {
        const t = te.dataset[`title${lang.toUpperCase()}`];
        if (t) te.textContent = t;
      }
      const de = card.querySelector('.card-description');
      if (de) {
        const d = de.dataset[`desc${lang.toUpperCase()}`];
        if (d) de.textContent = d;
      }
    }

    // Update normally rendered cards
    const cards = document.querySelectorAll('.card:not(.vg-item .card)');
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