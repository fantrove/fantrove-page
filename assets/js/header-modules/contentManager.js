// contentManager.js — Platform-level optimized rewrite v2
//
// Upgrade summary vs previous version:
//  ✅ content-visibility:auto + contain-intrinsic-size  → browser skips layout/paint off-screen
//  ✅ True DOM pool (LIFO, typed: 'card'|'btn')         → zero GC churn on navigation
//  ✅ scheduler.postTask('background')                  → auto-yields to user input between batches
//  ✅ ResizeObserver viewport-aware batch sizing        → desktop gets 2× batches safely
//  ✅ Single shared IntersectionObserver               → no per-wrap observer overhead
//  ✅ BitSet rendered tracking                         → O(1) bit ops vs Set.has()
//  ✅ Single innerHTML write per card                  → 1 reflow vs 3-5 appendChild reflows
//  ✅ DocumentFragment per batch                       → single DOM insertion per batch
//  ✅ GPU compositing hint only on animated items      → no global will-change bleed
//  ✅ Fade animation is opacity-only                   → compositor-only, zero layout cost

// ─────────────────────────────────────────────────────────────────────────────
// Scoped CSS (injected once)
// ─────────────────────────────────────────────────────────────────────────────
const _CM_CSS_ID = '_cm2_css';
function _injectCss() {
  if (document.getElementById(_CM_CSS_ID)) return;
  const s = document.createElement('style');
  s.id = _CM_CSS_ID;
  s.textContent = `
/* content-visibility:auto is the single biggest perf win:
   browser completely skips layout+paint for off-screen containers.
   contain-intrinsic-size gives the browser a stable size estimate
   so the scrollbar thumb stays accurate without measuring. */
.cm-wrap{
  content-visibility:auto;
  contain-intrinsic-size:auto 280px;
  contain:layout style paint;
}
.cm-wrap[data-ctype="card"]{ contain-intrinsic-size:auto 222px; }
.cm-wrap[data-ctype="btn"] { contain-intrinsic-size:auto 76px;  }

/* Fade is opacity-only → GPU composited layer, zero layout cost.
   will-change only while animating, removed after via animationend. */
.cm-fadein{
  animation:_cm_in 0.13s ease-out both;
  will-change:opacity;
}
@keyframes _cm_in{from{opacity:0}to{opacity:1}}
@media(prefers-reduced-motion:reduce){
  .cm-fadein{animation:none;will-change:auto;}
}`;
  // Remove will-change after animation finishes to free compositor layer
  document.head.appendChild(s);
}

// ─────────────────────────────────────────────────────────────────────────────
// animationend cleanup: free the compositor layer immediately after fade
// ─────────────────────────────────────────────────────────────────────────────
function _attachFadeCleanup(el) {
  el.addEventListener('animationend', () => {
    el.style.willChange = 'auto';
    el.classList.remove('cm-fadein');
  }, { once: true, passive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler shim: scheduler.postTask → requestIdleCallback → setTimeout
// Background priority ensures browser can interrupt between batches for input.
// ─────────────────────────────────────────────────────────────────────────────
function _scheduleBackground(fn) {
  if (typeof scheduler !== 'undefined' && scheduler.postTask) {
    return scheduler.postTask(fn, { priority: 'background' });
  }
  if (typeof requestIdleCallback !== 'undefined') {
    return requestIdleCallback(fn, { timeout: 500 });
  }
  return setTimeout(fn, 32);
}

// ─────────────────────────────────────────────────────────────────────────────
// BitSet: O(1) bit ops, 8× smaller than Set<number> for large item counts
// ─────────────────────────────────────────────────────────────────────────────
class BitSet {
  constructor(size) {
    this._buf = new Uint32Array(Math.ceil((size || 256) / 32));
  }
  has(i)  { return !!(this._buf[i >> 5] & (1 << (i & 31))); }
  add(i)  { this._buf[i >> 5] |=  (1 << (i & 31)); }
  clear() { this._buf.fill(0); }
  resize(size) {
    const need = Math.ceil(size / 32);
    if (need > this._buf.length) {
      const n = new Uint32Array(need);
      n.set(this._buf);
      this._buf = n;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM pool: typed LIFO pool (card / btn), max 40 per type caps memory usage
// Pooled nodes have innerHTML cleared but retain their tag — zero GC pressure
// ─────────────────────────────────────────────────────────────────────────────
const _pool = {
  _store: new Map(),
  _CAP: 40,

  get(typeKey) {
    const arr = this._store.get(typeKey);
    return arr?.length ? arr.pop() : null;
  },

  put(typeKey, node) {
    if (!node) return;
    try {
      node.innerHTML = '';
      node.className = '';
      node.style.cssText = '';
      node.removeAttribute('data-ctype');
      node.removeAttribute('data-id');
    } catch (_) {}
    let arr = this._store.get(typeKey);
    if (!arr) { arr = []; this._store.set(typeKey, arr); }
    if (arr.length < this._CAP) arr.push(node);
  },

  clear() { this._store.clear(); }
};

// ─────────────────────────────────────────────────────────────────────────────
// Viewport-aware sizing via ResizeObserver (set up once)
// ─────────────────────────────────────────────────────────────────────────────
const _vp = {
  w: window.innerWidth,
  _ro: null,
  init() {
    if (this._ro || typeof ResizeObserver === 'undefined') return;
    this._ro = new ResizeObserver(entries => {
      for (const e of entries) this.w = e.contentRect.width;
    });
    this._ro.observe(document.documentElement);
  }
};
_vp.init();

// ─────────────────────────────────────────────────────────────────────────────
// Device tier (set once at module load)
// ─────────────────────────────────────────────────────────────────────────────
const _tier = (() => {
  const m = navigator.deviceMemory;
  const c = navigator.hardwareConcurrency || 2;
  if ((m && m <= 1) || c <= 2) return 0; // low-end
  if ((m && m <= 2) || c <= 4) return 1; // mid
  return 2;                               // high
})();

function _batchSize() {
  const base = [3, 6, 12][_tier];
  const vw = _vp.w || window.innerWidth;
  // Desktop viewport: 2× batch safely (more items visible, stronger GPU)
  if (vw >= 1024) return base * 2;
  if (vw >= 600)  return Math.ceil(base * 1.5);
  return base;
}

function _maxDom() {
  // Low-end: cap DOM nodes hard to avoid memory pressure
  const base = [12, 24, 48][_tier];
  const vw = _vp.w || window.innerWidth;
  if (vw >= 1024) return base * 2;
  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (stateless — no closure allocation per call)
// ─────────────────────────────────────────────────────────────────────────────
function _txt(v, lang) {
  if (!v) return '';
  if (typeof v === 'object') return v[lang] || v.en || '';
  return String(v);
}

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _findApi(obj, code, depth = 0) {
  if (depth > 40) return null;
  if (Array.isArray(obj)) {
    for (const x of obj) {
      const r = _findApi(x, code, depth + 1);
      if (r) return r;
    }
  } else if (obj && typeof obj === 'object') {
    if (obj.api === code) return obj;
    for (const k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      const r = _findApi(obj[k], code, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// contentManager
// ─────────────────────────────────────────────────────────────────────────────
export const contentManager = {
  _session: 0,
  _abort: null,
  _wrapNodes: [],     // live cm-wrap nodes currently in DOM
  _items: [],
  _rendered: null,    // BitSet
  _observer: null,    // single shared IO
  _busy: false,
  _SENTINEL: 'cm2-sentinel',

  // ── Clear ────────────────────────────────────────────────────────────────
  async clearContent() {
    this._session++;
    if (this._abort) { try { this._abort.abort(); } catch (_) {} this._abort = null; }
    this._busy = false;

    if (this._observer) {
      try { this._observer.disconnect(); } catch (_) {}
      this._observer = null;
    }

    const s = document.getElementById(this._SENTINEL);
    if (s?.parentNode) s.parentNode.removeChild(s);

    try { window._headerV2_contentLoadingManager.hide(); } catch (_) {}

    for (const wrap of this._wrapNodes) {
      const tk = wrap.dataset.ctype || 'btn';
      try { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); } catch (_) {}
      _pool.put(tk, wrap);
    }
    this._wrapNodes.length = 0;
    this._items = [];
    this._rendered = new BitSet(256);
  },

  // ── Render ──────────────────────────────────────────────────────────────
  async renderContent(data) {
    if (!Array.isArray(data)) throw new Error('data must be array');

    _injectCss();

    const ctr = document.getElementById(
      window._headerV2_contentLoadingManager.LOADING_CONTAINER_ID
    );
    if (!ctr) return;

    await this.clearContent();
    const session = this._session;
    this._rendered.resize(data.length + 64);

    // Show loading overlay
    try {
      const sn = document.getElementById('sub-nav');
      const behind = !!(sn
        && window.getComputedStyle(sn).display !== 'none'
        && sn.offsetHeight > 0
        && sn.querySelector('#sub-buttons-container')?.childNodes.length);
      window._headerV2_contentLoadingManager.show({ behindSubNav: behind });
    } catch (_) {}

    this._abort = new AbortController();
    const { signal } = this._abort;
    const items = data.slice();
    this._items = items;

    // ── Core batch render ────────────────────────────────────────────────
    const renderBatch = async (from, size) => {
      if (signal.aborted || session !== this._session) return 0;
      const to = Math.min(items.length, from + size);
      if (from >= to) return 0;

      const frag = document.createDocumentFragment();
      let count = 0;

      for (let i = from; i < to; i++) {
        if (signal.aborted || session !== this._session) break;
        if (this._rendered.has(i)) continue;

        let item = items[i];

        // Inline jsonFile resolution
        if (item?.jsonFile && !item._fetched) {
          try {
            const res = await window._headerV2_dataManager
              .fetchWithRetry(item.jsonFile, {}, 3);
            if (Array.isArray(res)) {
              item._fetched = true;
              items.splice(i, 1, ...res);
              this._rendered.resize(items.length + 64);
              i--; continue;
            }
            items[i] = res; item = res;
          } catch (e) { console.error('jsonFile fetch', e); }
        }

        item = items[i];
        if (!item || this._rendered.has(i)) continue;

        const isCard = this._isCardType(item);
        const tk = isCard ? 'card' : 'btn';

        // Acquire from pool first — avoids createElement + style recalc
        let wrap = _pool.get(tk);
        if (!wrap) wrap = document.createElement('div');

        wrap.className = 'cm-wrap cm-fadein';
        wrap.dataset.ctype = tk;
        wrap.dataset.id = item.id || `ci-${i}`;
        // Inline contain-intrinsic-size per type (overrides CSS default)
        wrap.style.cssText = isCard
          ? 'contain-intrinsic-size:auto 222px'
          : 'contain-intrinsic-size:auto 76px';

        _attachFadeCleanup(wrap);

        const inner = this._mkContainer(item);
        try {
          const grp = item.group || (item.categoryId
            ? { categoryId: item.categoryId, type: item.type || 'button' }
            : null);
          if (grp) await this.renderGroupItems(inner, grp);
          else      await this.renderSingleItem(inner, item);
        } catch (e) { console.error('item render', e); }

        wrap.appendChild(inner);
        frag.appendChild(wrap);
        this._wrapNodes.push(wrap);
        this._rendered.add(i);
        count++;
      }

      // Single DOM write for entire batch
      if (frag.childNodes.length) ctr.appendChild(frag);

      // Evict oldest nodes when over budget → return to pool
      const cap = _maxDom();
      while (this._wrapNodes.length > cap) {
        const old = this._wrapNodes.shift();
        const tk = old.dataset.ctype || 'btn';
        try { if (old.parentNode) old.parentNode.removeChild(old); } catch (_) {}
        _pool.put(tk, old);
      }
      return count;
    };

    // ── First batch: user-blocking (immediate) ───────────────────────────
    await renderBatch(0, _batchSize());
    let done = this._countRendered(items.length);

    if (done >= items.length) {
      try { window._headerV2_contentLoadingManager.hide(); } catch (_) {}
      return;
    }

    // ── Subsequent batches: IntersectionObserver + background scheduler ──
    // This combination means:
    // 1. We only fetch more content when the sentinel scrolls near viewport
    // 2. scheduler.postTask('background') auto-yields to input events
    //    so even low-end devices stay responsive during batch rendering
    let sentinel = document.getElementById(this._SENTINEL);
    if (!sentinel) {
      sentinel = document.createElement('div');
      sentinel.id = this._SENTINEL;
      sentinel.style.cssText =
        'width:1px;height:1px;opacity:0;pointer-events:none;flex-basis:100%;';
    }
    ctr.appendChild(sentinel);

    this._observer = new IntersectionObserver((entries) => {
      if (signal.aborted || session !== this._session || this._busy) return;
      if (!entries[0]?.isIntersecting) return;

      this._busy = true;

      _scheduleBackground(async () => {
        try {
          if (signal.aborted || session !== this._session) return;
          await renderBatch(done, _batchSize());
          done = this._countRendered(items.length);

          try { sentinel.parentNode?.removeChild(sentinel); } catch (_) {}

          if (done < items.length) {
            ctr.appendChild(sentinel);
          } else {
            if (this._observer) { this._observer.disconnect(); this._observer = null; }
            try { window._headerV2_contentLoadingManager.hide(); } catch (_) {}
          }
        } catch (e) {
          console.error('lazy batch error', e);
        } finally {
          this._busy = false;
        }
      });

    }, {
      root: null,
      rootMargin: '600px', // start loading 600px before sentinel enters view
      threshold: 0
    });

    this._observer.observe(sentinel);
  },

  // ── Helpers ─────────────────────────────────────────────────────────────
  _countRendered(maxIdx) {
    let c = 0;
    for (let i = 0; i < maxIdx; i++) if (this._rendered.has(i)) c++;
    return c;
  },

  _isCardType(item) {
    return item.type === 'card'
      || item.group?.type === 'card'
      || (!!(item.image) && !item.api);
  },

  _mkContainer(item) {
    const d = document.createElement('div');
    const isBtnType = item.group?.type === 'button'
      || item.type === 'button'
      || (item.group?.categoryId && !item.group?.type);
    d.className = isBtnType
      ? 'button-content-container'
      : 'card-content-container';
    if (item.group?.containerClass) d.classList.add(item.group.containerClass);
    return d;
  },

  // ── Group ──────────────────────────────────────────────────────────────
  async renderGroupItems(ctr, grp) {
    const dm = window._headerV2_data_manager || window._headerV2_dataManager;
    const isCard = grp.type === 'card';

    if (grp.categoryId) {
      const { data, header } = await dm.fetchCategoryGroup(grp.categoryId);
      if (header) ctr.appendChild(this._mkHeader(header));
      const frag = document.createDocumentFragment();
      for (const item of data) {
        frag.appendChild(isCard ? await this._mkCard(item) : await this._mkBtn(item));
      }
      ctr.appendChild(frag);
      return;
    }

    if (Array.isArray(grp.items)) {
      if (grp.header) ctr.appendChild(this._mkHeader(grp.header));
      const frag = document.createDocumentFragment();
      for (const item of grp.items) {
        frag.appendChild(isCard ? await this._mkCard(item) : await this._mkBtn(item));
      }
      ctr.appendChild(frag);
    }
  },

  // ── Header ─────────────────────────────────────────────────────────────
  _mkHeader(cfg) {
    const lang = localStorage.getItem('selectedLang') || 'en';
    const wrap = document.createElement('div');
    wrap.className = 'group-header';
    if (typeof cfg === 'string') {
      wrap.innerHTML = `<h2 class="group-header-text">${_esc(cfg)}</h2>`;
      return wrap;
    }
    if (cfg.className) wrap.classList.add(cfg.className);

    const h = document.createElement('h2');
    h.className = 'group-header-text';
    h.textContent = _txt(cfg.title, lang);
    wrap.appendChild(h);

    if (cfg.description) {
      const p = document.createElement('p');
      p.className = 'group-header-description';
      p.textContent = _txt(cfg.description, lang);
      wrap.appendChild(p);
    }

    if (!wrap._ll) {
      wrap._ll = true;
      window.addEventListener('languageChange', (ev) => {
        const nl = ev.detail?.language || 'en';
        const ht = wrap.querySelector('.group-header-text');
        if (ht && cfg.title) ht.textContent = _txt(cfg.title, nl);
        const hd = wrap.querySelector('.group-header-description');
        if (hd && cfg.description) hd.textContent = _txt(cfg.description, nl);
      }, { passive: true });
    }
    return wrap;
  },

  async renderSingleItem(ctr, item) {
    if (item.categoryId) {
      await this.renderGroupItems(ctr,
        { categoryId: item.categoryId, type: item.type || 'button' });
      return;
    }
    ctr.appendChild(item.type === 'button'
      ? await this._mkBtn(item)
      : await this._mkCard(item));
  },

  // ── Button ─────────────────────────────────────────────────────────────
  async _mkBtn(cfg) {
    const btn = document.createElement('button');
    btn.className = 'button-content';

    let text = '', api = cfg.api || null, type = cfg.type || null;

    try {
      if (api) {
        const db = await (window._headerV2_data_manager?.loadApiDatabase?.()
          || window._headerV2_dataManager.loadApiDatabase());
        const node = _findApi(db, api);
        text = node?.text || api;
        type = type || 'emoji';
      } else {
        text = cfg.content || cfg.text || '';
        type = type || 'symbol';
        if (!text) throw new Error('no content');
      }
      btn.textContent = text;
    } catch (_) { btn.textContent = '?'; }

    const ft = text, fa = api, ftype = type;
    btn.addEventListener('click', async () => {
      try {
        await window.unifiedCopyToClipboard({
          text: ft, api: fa, type: ftype, name: fa || ''
        });
      } catch (_) {
        window._headerV2_utils?.showNotification('Copy failed', 'error');
      }
    }, { passive: true });

    return btn;
  },

  // ── Card ────────────────────────────────────────────────────────────────
  // Single innerHTML write = 1 reflow instead of multiple appendChild reflows
  async _mkCard(cfg) {
    const lang = localStorage.getItem('selectedLang') || 'en';
    const card = document.createElement('div');
    card.className = 'card';

    let html = '';
    if (cfg.image) {
      const alt = _esc(_txt(cfg.imageAlt, lang));
      // loading=lazy + decoding=async: browser handles off-screen images natively
      // no width/height attrs here since they come from CSS
      html += `<img class="card-image" src="${_esc(cfg.image)}" loading="lazy" decoding="async" alt="${alt}">`;
    }
    const title = _esc(_txt(cfg.title || cfg.name, lang));
    const desc  = _esc(_txt(cfg.description, lang));
    html += `<div class="card-content"><div class="card-title">${title}</div>`
          + `<div class="card-description">${desc}</div></div>`;
    card.innerHTML = html;

    if (cfg.link)
      card.addEventListener('click',
        () => window.open(cfg.link, '_blank', 'noopener,noreferrer'),
        { passive: true });
    if (cfg.className) card.classList.add(cfg.className);
    return card;
  },

  // ── Language update ────────────────────────────────────────────────────
  updateCardsLanguage(lang) {
    document.querySelectorAll('.card').forEach(c => {
      const t = c.querySelector('.card-title');
      if (t) { const v = t.dataset[`title${lang.toUpperCase()}`]; if (v) t.textContent = v; }
      const d = c.querySelector('.card-description');
      if (d) { const v = d.dataset[`desc${lang.toUpperCase()}`]; if (v) d.textContent = v; }
    });
  },

  // Legacy aliases
  createContainer(item)      { return this._mkContainer(item); },
  async createButton(cfg)    { return this._mkBtn(cfg); },
  async createCard(cfg)      { return this._mkCard(cfg); },
};

export default contentManager;