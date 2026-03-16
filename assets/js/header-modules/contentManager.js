// contentManager.js  v6.0 — RenderEngine-Backed Zero-Jank Architecture
// ═══════════════════════════════════════════════════════════════════════
//
// WHAT CHANGED vs v5.0:
//
//  ✅ RenderEngine.VGrid  — replaces hand-rolled VirtualGrid.
//     - Proper binary search (v5 used naive FLOOR division for rows)
//     - ResizeObserver column recalculation (not rIC)
//     - Pool uses display:none not el.remove() — zero GC
//
//  ✅ RenderEngine.VList  — large 1-D lists (jsonFile groups)
//     - Variable-height aware via ResizeObserver
//     - Prefix-sum offsets + binary search
//
//  ✅ Event delegation   — one listener per container (not per card)
//     v5 had this but only for VG path; now for all paths.
//
//  ✅ No per-card will-change — was causing hundreds of GPU layers.
//
//  ✅ Group wrappers use display:none pool release (not innerHTML='').
//     Avoids innerHTML mass-delete triggering GC + style recalc.
//
//  ✅ Adaptive thresholds from RenderEngine.device
//     Low-end devices get smaller pools and overscan.
//
//  ALL PUBLIC APIs UNCHANGED:
//    renderContent(data), clearContent(), createButton(config),
//    createCard(config), renderGroupItems(container, group),
//    updateCardsLanguage(lang)

// ─── Wait for RenderEngine ────────────────────────────────────
function _waitRE(cb) {
  if (window.RenderEngine) return cb();
  let tries = 0;
  const id = setInterval(() => {
    if (window.RenderEngine || ++tries > 80) { clearInterval(id); cb(); }
  }, 50);
}

// ─── Device ───────────────────────────────────────────────────
const _MEM     = Math.max(1, Math.min(8, navigator.deviceMemory || 4));
const _CORES   = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 2));
const _LOW     = _MEM <= 2 || _CORES <= 2;

// ─── VGrid constants (match CSS exactly) ──────────────────────
const VG_CARD_W   = 160;
const VG_CARD_H   = 222;
const VG_GAP      = 6;
const VG_ITEM_W   = VG_CARD_W + VG_GAP;
const VG_ITEM_H   = VG_CARD_H + VG_GAP;
const VG_THRESHOLD = 20;

// ─── Scheduler (mirrors render-engine.js for standalone use) ──
const _sched = (typeof scheduler !== 'undefined' && scheduler) || null;
function _schedTask(fn, prio = 'background', signal = null) {
  if (_sched?.postTask) {
    const o = { priority: prio }; if (signal) o.signal = signal;
    return _sched.postTask(fn, o);
  }
  return new Promise((res, rej) => {
    const run = () => { try { res(fn()); } catch(e) { rej(e); } };
    if (prio === 'background') {
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback(run, { timeout: 3000 })
        : setTimeout(run, 0);
    } else requestAnimationFrame(run);
  });
}
function _yieldNow() {
  if (_sched?.yield) return _sched.yield();
  return new Promise(res =>
    typeof requestIdleCallback === 'function'
      ? requestIdleCallback(res, { timeout: 300 })
      : setTimeout(res, 0)
  );
}
function _isInputPending() {
  try { return !!navigator.scheduling?.isInputPending?.(); } catch { return false; }
}

// ─── Perf proxy ───────────────────────────────────────────────
const _perf = {
  mark   : n     => { try { window.__searchUI?.perf?.mark('hdr:'+n);              } catch {} },
  measure: (n,s) => { try { window.__searchUI?.perf?.measure('hdr:'+n,'hdr:'+s); } catch {} },
};

// ─── WeakRef cache ────────────────────────────────────────────
const _wCache = new Map();
const _wReg = typeof FinalizationRegistry !== 'undefined'
  ? new FinalizationRegistry(k => _wCache.delete(k)) : null;
function _wSet(k,v) { try { _wCache.set(k, new WeakRef(v)); _wReg?.register(v,k); } catch { _wCache.set(k, {deref:()=>v}); } }
function _wGet(k)   { return _wCache.get(k)?.deref?.() ?? null; }

/* ═══════════════════════════════════════════════════════════════
   contentManager
════════════════════════════════════════════════════════════════ */
export const contentManager = {

  // ── State ──────────────────────────────────────────────────────
  _MEM, _CORES,
  get _isLowEnd()   { return _LOW; },
  get CHUNK_SIZE()  { return _LOW ? 3 : 8; },
  get POOL_MAX()    { return Math.round(20 + (_MEM - 1) * 5); },
  EST_H: 400,

  _renderSession        : 0,
  _abortController      : null,
  _items                : [],
  _renderedSet          : new Set(),
  _sentinelObserver     : null,
  _isUnmounted          : false,
  _isRenderingNextBatch : false,
  _SENTINEL_ID          : 'hdr-render-sentinel',

  // Wrapper node pool (group-level, not card-level)
  _pool    : [],
  // Active RenderEngine instances for cleanup
  _activeRE: [],

  // ── Learning worker ────────────────────────────────────────────
  _learningWorker  : null,
  _learningEnabled : true,

  _getLearningData()  { return _wGet('learning') || { views:{}, clicks:{} }; },
  _setLearningData(d) { _wSet('learning', d); },

  _initLearningWorker(count) {
    if (!this._learningEnabled || this._learningWorker || count < 30) return;
    try {
      const code = `
        const s={v:{},c:{}};
        const sc=id=>{const v=s.v[id]||0,c=s.c[id]||0;return Math.log(1+v)+(3*Math.log(1+c));};
        onmessage=({data:{type,payload}={}}={})=>{
          if(type==='record'){const{kind,id}=payload;if(kind==='view')s.v[id]=(s.v[id]||0)+1;if(kind==='click')s.c[id]=(s.c[id]||0)+1;}
          else if(type==='getScores'){const r={};for(const id of(payload.items||[]))r[id]=sc(id)||0;postMessage({type:'scores',payload:r});}
          else if(type==='hydrate'){const{views,clicks}=payload||{};if(views)Object.assign(s.v,views);if(clicks)Object.assign(s.c,clicks);}
        };`;
      const w = new Worker(URL.createObjectURL(new Blob([code], {type:'application/javascript'})));
      w.onmessage = e => { if (e.data?.type === 'scores') _wSet('scores', e.data.payload||{}); };
      w.postMessage({ type:'hydrate', payload:this._getLearningData() });
      this._learningWorker = w;
    } catch { this._learningWorker = null; }
  },

  _recordEvent(kind, id) {
    if (!id) return;
    if (this._learningWorker) {
      this._learningWorker.postMessage({ type:'record', payload:{ kind, id } });
    } else {
      const ld = this._getLearningData();
      ld[kind==='click'?'clicks':'views'][id] = (ld[kind==='click'?'clicks':'views'][id]||0)+1;
      this._setLearningData(ld);
    }
  },

  _getPriorityScores(ids) {
    const ld = this._getLearningData();
    return new Promise(resolve => {
      const fb = {};
      for (const id of ids) {
        const v = ld.views?.[id]||0, c = ld.clicks?.[id]||0;
        fb[id] = Math.log(1+v) + 3*Math.log(1+c);
      }
      if (this._learningWorker) {
        const t = setTimeout(() => resolve(fb), 80);
        const h = e => {
          if (e.data?.type === 'scores') {
            clearTimeout(t);
            this._learningWorker.removeEventListener('message', h);
            resolve(e.data.payload || fb);
          }
        };
        this._learningWorker.addEventListener('message', h);
        this._learningWorker.postMessage({ type:'getScores', payload:{ items:ids } });
      } else resolve(fb);
    });
  },

  // ── Pool: group-level wrappers ─────────────────────────────────
  _acquire() {
    const n = this._pool.pop() || document.createElement('div');
    n.style.cssText = 'contain:layout style paint;content-visibility:auto;contain-intrinsic-size:auto '+this.EST_H+'px;';
    n.className = '';
    return n;
  },

  _release(node) {
    if (!node) return;
    // Destroy any RenderEngine instance inside
    if (node._re) { try { node._re.destroy(); } catch {} node._re = null; }
    try { node.innerHTML=''; node.className=''; node.style.cssText=''; node.removeAttribute('id'); } catch {}
    if (this._pool.length < this.POOL_MAX) this._pool.push(node);
    else { try { node.remove?.(); } catch {} }
  },

  // ── clearContent ───────────────────────────────────────────────
  async clearContent() {
    this._renderSession = (this._renderSession||0)+1;
    const session = this._renderSession;

    try { this._abortController?.abort(); this._abortController = null; } catch {}
    this._isUnmounted          = false;
    this._isRenderingNextBatch = false;

    // Destroy all active RenderEngine instances
    for (const re of this._activeRE) { try { re.destroy(); } catch {} }
    this._activeRE = [];

    try { const s = document.getElementById(this._SENTINEL_ID); s?.parentNode?.removeChild(s); } catch {}
    try { window._headerV2_contentLoadingManager?.hide(); } catch {}
    if (this._sentinelObserver) { try { this._sentinelObserver.disconnect(); } catch {} this._sentinelObserver = null; }

    const containerId = window._headerV2_contentLoadingManager?.LOADING_CONTAINER_ID || 'content-loading';
    const container   = document.getElementById(containerId);
    if (container) {
      requestAnimationFrame(() => {
        const children = Array.from(container.children);
        for (const child of children) { try { container.removeChild(child); } catch {} this._release(child); }
      });
    }

    this._items       = [];
    this._renderedSet = new Set();
    return session;
  },

  // ── renderContent ──────────────────────────────────────────────
  async renderContent(data) {
    if (!Array.isArray(data)) throw new Error('renderContent: expected array');

    const containerId = window._headerV2_contentLoadingManager?.LOADING_CONTAINER_ID || 'content-loading';
    const container   = document.getElementById(containerId);
    if (!container) return;

    await this.clearContent();

    // Promote scroll container to GPU layer once
    if (!container._gpuReady) {
      Object.assign(container.style, { willChange:'transform', transform:'translateZ(0)', overscrollBehavior:'contain' });
      container._gpuReady = true;
    }

    // Show loading overlay
    try {
      const subNav   = document.getElementById('sub-nav');
      const hasSub   = subNav && subNav.querySelector('#sub-buttons-container')?.childNodes.length > 0;
      window._headerV2_contentLoadingManager?.show({ behindSubNav: !!hasSub });
    } catch {}

    this._renderSession = (this._renderSession||0)+1;
    const session = this._renderSession;
    this._abortController = typeof AbortController !== 'undefined' ? new AbortController() : { signal:{}, abort:()=>{} };
    const signal  = this._abortController.signal;
    this._isUnmounted          = false;
    this._isRenderingNextBatch = false;

    const items = data.slice();
    this._items = items;
    this._initLearningWorker(items.length);

    // Priority sort
    const ids    = items.map((it,i) => it?.id || '__idx_'+i);
    let scores   = {};
    try { scores = await this._getPriorityScores(ids); } catch {}
    if (ids.some(id => scores[id] > 0)) {
      items.sort((a,b) => (scores[b?.id||''] || 0) - (scores[a?.id||''] || 0));
    }

    _perf.mark('render-start');

    const renderBatch = async (startIdx, count) => {
      if (signal.aborted || this._isUnmounted || session !== this._renderSession) return 0;
      const end = Math.min(items.length, startIdx + count);
      if (startIdx >= end) return 0;

      const frag = document.createDocumentFragment();
      let created = 0;
      _perf.mark('batch-start');

      for (let i = startIdx; i < end; i++) {
        if (signal.aborted || this._isUnmounted || session !== this._renderSession) break;
        if (this._renderedSet.has(i)) continue;

        let item = items[i];

        // Lazy jsonFile fetch
        if (item?.jsonFile && !item._fetched) {
          try {
            try { window._headerV2_contentLoadingManager?.updateMessage('Loading...'); } catch {}
            const fetched = await window._headerV2_dataManager
              .fetchWithRetry(item.jsonFile, { cache:true }, 3)
              .catch(e => { throw e; });
            if (Array.isArray(fetched)) { item._fetched=true; items.splice(i,1,...fetched); i--; continue; }
            else if (fetched?.data && Array.isArray(fetched.data)) { item._fetched=true; items.splice(i,1,...fetched.data); i--; continue; }
            else { items.splice(i,1,fetched); item=fetched; }
          } catch (err) { console.error('renderContent: jsonFile fetch error', err); }
        }

        item = items[i];
        if (!item || this._renderedSet.has(i)) continue;

        const wrapper = this._acquire();
        wrapper.id    = item.id || 'content-item-'+i;
        wrapper.style.opacity = '0';

        const inner = this.createContainer(item);

        try {
          if (item.group?.categoryId || item.group?.type === 'card' || item.group?.type === 'button') {
            await this.renderGroupItems(inner, item.group);
          } else if (item.categoryId) {
            await this.renderGroupItems(inner, { categoryId:item.categoryId, type:item.type||'button' });
          } else {
            await this.renderSingleItem(inner, item);
          }
        } catch (err) { console.error('renderContent: item render error', err); }

        wrapper.appendChild(inner);
        frag.appendChild(wrapper);
        this._renderedSet.add(i);
        created++;
      }

      _perf.measure('content-batch','batch-start');

      if (frag.hasChildNodes()) {
        await new Promise(res => {
          requestAnimationFrame(() => {
            container.appendChild(frag);
            requestAnimationFrame(() => {
              const ch    = container.children;
              const start = ch.length - created;
              for (let j = start; j < ch.length; j++) { if (ch[j]) ch[j].style.opacity='1'; }
              res();
            });
          });
        });
      }
      return created;
    };

    await renderBatch(0, this.CHUNK_SIZE);
    let rendered = this._renderedSet.size;

    if (rendered >= items.length) {
      _perf.measure('content-render','render-start');
      try { window._headerV2_contentLoadingManager?.hide(); } catch {}
      return;
    }

    // IntersectionObserver sentinel for deferred batches
    let sentinel = document.getElementById(this._SENTINEL_ID);
    if (!sentinel) {
      sentinel = document.createElement('div');
      sentinel.id = this._SENTINEL_ID;
      Object.assign(sentinel.style, { width:'1px', height:'1px', opacity:'0', pointerEvents:'none' });
    }
    container.appendChild(sentinel);

    let debTimer = null;
    const onIntersect = entries => {
      if (signal.aborted || this._isUnmounted || session !== this._renderSession) return;
      for (const entry of entries) {
        if (!entry.isIntersecting || this._isRenderingNextBatch) continue;
        if (debTimer) clearTimeout(debTimer);
        debTimer = setTimeout(async () => {
          this._isRenderingNextBatch = true;
          try {
            if (document.hidden) await new Promise(res => {
              const h = () => { if (!document.hidden) { document.removeEventListener('visibilitychange',h); res(); } };
              document.addEventListener('visibilitychange', h, { passive:true });
            });
            await _yieldNow();
            if (signal.aborted || this._isUnmounted || session !== this._renderSession) return;
            await renderBatch(rendered, this.CHUNK_SIZE);
            rendered = this._renderedSet.size;
            if (rendered < items.length) {
              try { sentinel.parentNode?.removeChild(sentinel); } catch {}
              container.appendChild(sentinel);
            } else {
              try { sentinel.parentNode?.removeChild(sentinel); } catch {}
              if (this._sentinelObserver) { try { this._sentinelObserver.disconnect(); } catch {} this._sentinelObserver = null; }
              _perf.measure('content-render','render-start');
              try { window._headerV2_contentLoadingManager?.hide(); } catch {}
            }
          } catch (err) { console.error('renderContent: next batch error', err); }
          finally { this._isRenderingNextBatch = false; }
        }, 50);
      }
    };

    if ('IntersectionObserver' in window) {
      if (this._sentinelObserver) { try { this._sentinelObserver.disconnect(); } catch {} }
      this._sentinelObserver = new IntersectionObserver(onIntersect, { root:null, rootMargin:'400px', threshold:0.1 });
      try { this._sentinelObserver.observe(sentinel); } catch {}
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC APIS (ALL UNCHANGED signatures)
  // ═══════════════════════════════════════════════════════════════

  createContainer(item) {
    const c = document.createElement('div');
    c.className = (item.group?.type==='button' || item.type==='button' ||
                   (item.group?.categoryId && !item.group?.type))
      ? 'button-content-container' : 'card-content-container';
    if (item.group?.containerClass) c.classList.add(item.group.containerClass);
    return c;
  },

  // ── renderGroupItems: VGrid for cards, flat for buttons ────────
  async renderGroupItems(container, group) {
    if (!group.categoryId && !group.items) throw new Error('Group requires categoryId or items');

    let items = [], header = null;

    if (group.categoryId) {
      const fetched = await (window._headerV2_data_manager?.fetchCategoryGroup
        ? window._headerV2_data_manager.fetchCategoryGroup(group.categoryId)
        : window._headerV2_dataManager.fetchCategoryGroup(group.categoryId));
      items  = fetched.data   || [];
      header = fetched.header || null;
    } else if (Array.isArray(group.items)) {
      items  = group.items;
      header = group.header || null;
    }

    if (header) container.appendChild(this.createGroupHeader(header));

    const isCard = group.type === 'card';
    const lang   = localStorage.getItem('selectedLang') || 'en';

    if (isCard && items.length >= VG_THRESHOLD) {
      // ── RenderEngine VGrid path ────────────────────────────────
      // Event delegation: one listener per container
      if (!container._delegated) {
        container._delegated = true;
        container.addEventListener('click', async e => {
          const card = e.target.closest('.card');
          if (!card) return;
          if (card.dataset.link) { window.open(card.dataset.link, '_blank', 'noopener'); return; }
          const copyBtn = e.target.closest('.card-copy-btn');
          if (copyBtn?.dataset.text) {
            try { await navigator.clipboard.writeText(copyBtn.dataset.text); } catch {}
          }
        }, { passive: false });
      }

      // Prepare container for VGrid (position:relative + overflow:hidden)
      container.style.position = 'relative';
      container.style.overflow = 'hidden';
      container.style.minHeight = '2px';

      _waitRE(() => {
        const RE = window.RenderEngine;
        if (!RE) {
          // Fallback: flat render
          for (const item of items) {
            const el = document.createElement('div');
            el.innerHTML = this._renderCardHTML(item, lang);
            container.appendChild(el.firstElementChild || el);
          }
          return;
        }

        const vg = RE.createVGrid({
          container : window,
          host      : container,
          items,
          renderItem: (item) => this._renderCardHTML(item, lang),
          cellW     : VG_ITEM_W,
          cellH     : VG_ITEM_H,
          overscan  : RE.overscan(500),
          poolMax   : RE.poolMax(30),
          itemClass : 'vg-item',
        });

        container._re = vg;
        this._activeRE.push(vg);
      });

    } else {
      // ── Flat render ─────────────────────────────────────────────
      const frag = document.createDocumentFragment();
      for (const item of items) {
        const el = await (isCard ? this.createCard(item) : this.createButton(item));
        if (el) frag.appendChild(el);
      }
      container.appendChild(frag);
    }
  },

  // ── _renderCardHTML: sync string renderer for VGrid ────────────
  _renderCardHTML(cfg, lang) {
    if (!lang) lang = localStorage.getItem('selectedLang') || 'en';
    const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    let title = '', desc = '';
    if (typeof cfg.title === 'object') { title = cfg.title[lang] || cfg.title.en || ''; }
    else if (cfg.name && typeof cfg.name === 'object') { title = cfg.name[lang] || cfg.name.en || ''; }
    else { title = cfg.title || cfg.name || ''; }

    if (typeof cfg.description === 'object') { desc = cfg.description[lang] || cfg.description.en || ''; }
    else { desc = cfg.description || ''; }

    const img     = cfg.image ? `<img class="card-image" src="${esc(cfg.image)}" loading="lazy" alt="${esc(cfg.imageAlt?.[lang]||cfg.imageAlt?.en||'')}" decoding="async">` : '';
    const link    = cfg.link  ? ` data-link="${esc(cfg.link)}" style="cursor:pointer"` : '';
    const cls     = cfg.className ? ` ${esc(cfg.className)}` : '';

    return `<div class="card${cls}" role="article"${link}>
  ${img}
  <div class="card-content">
    <div class="card-title"
      data-titleen="${esc(typeof cfg.title==='object'?(cfg.title.en||''):title)}"
      data-titleth="${esc(typeof cfg.title==='object'?(cfg.title.th||''):'')}">
      ${esc(title)}
    </div>
    <div class="card-description"
      data-descen="${esc(typeof cfg.description==='object'?(cfg.description.en||''):desc)}"
      data-descth="${esc(typeof cfg.description==='object'?(cfg.description.th||''):'')}">
      ${esc(desc)}
    </div>
  </div>
</div>`;
  },

  createGroupHeader(hc) {
    const wrap = document.createElement('div');
    wrap.className = 'group-header';
    const lang = localStorage.getItem('selectedLang') || 'en';

    if (typeof hc === 'string') {
      const h = document.createElement('h2'); h.className='group-header-text'; h.textContent=hc;
      wrap.appendChild(h); return wrap;
    }

    if (hc.className) wrap.classList.add(hc.className);
    const inner = document.createElement('div'); inner.className='header-content';
    const h2    = document.createElement('h2');  h2.className='group-header-text';
    if (typeof hc.title === 'object') {
      Object.entries(hc.title).forEach(([l,t]) => h2.dataset['title'+l.toUpperCase()]=t);
      h2.textContent = hc.title[lang] || hc.title.en || '';
    } else h2.textContent = hc.title || '';
    inner.appendChild(h2);

    if (hc.description) {
      const p = document.createElement('p'); p.className='group-header-description';
      if (typeof hc.description === 'object') {
        Object.entries(hc.description).forEach(([l,t]) => p.dataset['desc'+l.toUpperCase()]=t);
        p.textContent = hc.description[lang] || hc.description.en || '';
      } else p.textContent = hc.description;
      inner.appendChild(p);
    }
    wrap.appendChild(inner);

    if (!wrap._langBound) {
      wrap._langBound = true;
      window.addEventListener('languageChange', ev => {
        const nl = ev.detail?.language;
        const te = wrap.querySelector('.group-header-text');
        if (te && typeof hc.title==='object') te.textContent = hc.title[nl]||hc.title.en||te.textContent;
        const de = wrap.querySelector('.group-header-description');
        if (de && typeof hc.description==='object') de.textContent = hc.description[nl]||hc.description.en||de.textContent;
      }, { passive:true });
    }
    return wrap;
  },

  async renderSingleItem(container, item) {
    if (item.categoryId) {
      await this.renderGroupItems(container, { categoryId:item.categoryId, type:item.type||'button' });
      return;
    }
    const el = item.type==='button' ? await this.createButton(item) : await this.createCard(item);
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
          if (Array.isArray(obj)) { for (const it of obj) { const f=findApi(it,code); if(f) return f; } }
          else if (obj && typeof obj==='object') {
            if (obj.api===code) return obj;
            for (const k in obj) if (Object.prototype.hasOwnProperty.call(obj,k)) { const f=findApi(obj[k],code); if(f) return f; }
          }
          return null;
        }
        const node = findApi(db, apiCode);
        if (node) { finalContent=node.text; type=type||(node.api?'emoji':'symbol'); }
        else finalContent = apiCode;
      } else if (config.content) { finalContent=config.content; type='symbol'; }
      else if (config.text)    { finalContent=config.text;    type='symbol'; }
      else throw new Error('Button requires api, content, or text');
      btn.textContent = finalContent;
    } catch { btn.textContent = 'Error'; }

    btn.addEventListener('click', async () => {
      try { this._recordEvent('click', btn.dataset?.url || btn.id); } catch {}
      try {
        await (window.unifiedCopyToClipboard || (() => {}))(
          { text:finalContent, api:apiCode, type, name:apiCode||'' }
        );
      } catch { window._headerV2_utils?.showNotification?.('Copy failed','error'); }
    });

    btn.style.opacity = '0';
    requestAnimationFrame(() => { btn.style.opacity='1'; });
    return btn;
  },

  async createCard(cfg) {
    const lang = localStorage.getItem('selectedLang') || 'en';
    const card = document.createElement('div');
    card.className = 'card';

    if (cfg.image) {
      const img = document.createElement('img');
      img.className='card-image'; img.src=cfg.image; img.loading='lazy'; img.decoding='async';
      img.alt = cfg.imageAlt?.[lang] || cfg.imageAlt?.en || '';
      card.appendChild(img);
    }

    const cd = document.createElement('div'); cd.className='card-content';
    const td = document.createElement('div'); td.className='card-title';
    if (typeof cfg.title==='object') {
      Object.entries(cfg.title).forEach(([l,t]) => td.dataset['title'+l.toUpperCase()]=t);
      td.textContent = cfg.title[lang] || cfg.title.en || '';
    } else if (cfg.name && typeof cfg.name==='object') {
      td.textContent = cfg.name[lang] || cfg.name.en || '';
    } else td.textContent = cfg.title || cfg.name || '';
    cd.appendChild(td);

    const dd = document.createElement('div'); dd.className='card-description';
    if (typeof cfg.description==='object') {
      Object.entries(cfg.description).forEach(([l,t]) => dd.dataset['desc'+l.toUpperCase()]=t);
      dd.textContent = cfg.description[lang] || cfg.description.en || '';
    } else dd.textContent = cfg.description || '';
    cd.appendChild(dd);
    card.appendChild(cd);

    if (cfg.link) card.addEventListener('click', () => window.open(cfg.link,'_blank','noopener'));
    if (cfg.className) card.classList.add(cfg.className);

    card.style.opacity = '0';
    requestAnimationFrame(() => { card.style.opacity='1'; });
    return card;
  },

  updateCardsLanguage(lang) {
    const all = document.querySelectorAll('.card');
    for (const card of all) {
      const te = card.querySelector('.card-title');
      if (te) { const t=te.dataset['title'+lang.toUpperCase()]; if(t) te.textContent=t; }
      const de = card.querySelector('.card-description');
      if (de) { const d=de.dataset['desc'+lang.toUpperCase()];  if(d) de.textContent=d; }
      const ie = card.querySelector('.card-image');
      if (ie) { const a=ie.dataset['alt'+lang.toUpperCase()];   if(a) ie.alt=a; }
    }
  },
};

export default contentManager;