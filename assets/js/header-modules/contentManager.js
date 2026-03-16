// contentManager.js — featherweight rewrite
//
// Design goals:
//  1. Zero global side-effects (no injecting global styles, no will-change on everything)
//  2. Single IntersectionObserver for lazy batching
//  3. No nested RAF / no adaptive frame sampling — device tier set once at load
//  4. Uses CSS class 'hdr-fade' (scoped in styles.min.css) instead of inline opacity
//  5. Element pool: flat LIFO array, no timers
//  6. Does NOT touch prefers-reduced-motion globally — CSS handles it scoped

export const contentManager = {
  _session: 0,
  _abort: null,
  _nodes: [],       // mounted wrapper nodes
  _items: [],
  _rendered: null,  // Set
  _observer: null,
  _busy: false,
  _SENTINEL: 'hdrv2-sentinel',

  // ── Device tier (once, at import time) ──────────────────────────────────
  _tier: (() => {
    const m = navigator.deviceMemory;
    const c = navigator.hardwareConcurrency || 2;
    if ((m && m <= 1) || c <= 2) return 0;   // low
    if ((m && m <= 2) || c <= 4) return 1;   // mid
    return 2;                                  // high
  })(),

  _batch() {
    // Small batches = smooth frame pacing on weak CPUs
    return [3, 5, 10][this._tier];
  },

  _maxDOM() {
    // Limit live DOM nodes — key for low-RAM devices
    return [10, 18, 30][this._tier];
  },

  // ── Pool (flat, no timer) ────────────────────────────────────────────────
  _pool: [],
  _POOL_CAP: 20,

  _get() {
    const n = this._pool.pop() || document.createElement('div');
    n.className = '';
    n.style.cssText = '';
    n.removeAttribute('id');
    return n;
  },

  _put(n) {
    if (!n) return;
    try { n.innerHTML = ''; n.className = ''; n.style.cssText = ''; n.removeAttribute('id'); } catch (_) {}
    if (this._pool.length < this._POOL_CAP) this._pool.push(n);
  },

  // ── Clear ────────────────────────────────────────────────────────────────
  async clearContent() {
    this._session++;
    if (this._abort) { try { this._abort.abort(); } catch (_) {} this._abort = null; }
    this._busy = false;

    if (this._observer) { try { this._observer.disconnect(); } catch (_) {} this._observer = null; }

    const s = document.getElementById(this._SENTINEL);
    if (s?.parentNode) try { s.parentNode.removeChild(s); } catch (_) {}

    try { window._headerV2_contentLoadingManager.hide(); } catch (_) {}

    for (const n of this._nodes) {
      try { if (n.parentNode) n.parentNode.removeChild(n); } catch (_) {}
      this._put(n);
    }
    this._nodes.length = 0;
    this._items = [];
    this._rendered = new Set();
  },

  // ── Render ───────────────────────────────────────────────────────────────
  async renderContent(data) {
    if (!Array.isArray(data)) throw new Error('data must be array');

    const ctr = document.getElementById(
      window._headerV2_contentLoadingManager.LOADING_CONTAINER_ID
    );
    if (!ctr) return;

    await this.clearContent();
    const session = this._session;

    // Show overlay
    try {
      let behind = false;
      const sn = document.getElementById('sub-nav');
      if (sn) {
        const st = window.getComputedStyle(sn);
        behind = st.display !== 'none' && sn.offsetHeight > 0
          && !!sn.querySelector('#sub-buttons-container')?.childNodes.length;
      }
      window._headerV2_contentLoadingManager.show({ behindSubNav: behind });
    } catch (_) {}

    this._abort = new AbortController();
    const { signal } = this._abort;
    const items = data.slice();
    this._items = items;

    // ── Batch render fn ──────────────────────────────────────────────────
    const renderBatch = async (from, size) => {
      if (signal.aborted || session !== this._session) return 0;
      const to = Math.min(items.length, from + size);
      if (from >= to) return 0;

      const frag = document.createDocumentFragment();
      let n = 0;

      for (let i = from; i < to; i++) {
        if (signal.aborted || session !== this._session) break;
        if (this._rendered.has(i)) continue;

        let item = items[i];

        // Resolve jsonFile reference
        if (item?.jsonFile && !item._fetched) {
          try {
            const res = await window._headerV2_dataManager
              .fetchWithRetry(item.jsonFile, {}, 3);
            if (Array.isArray(res)) {
              item._fetched = true;
              items.splice(i, 1, ...res);
              i--; continue;
            }
            items[i] = res; item = res;
          } catch (e) { console.error('jsonFile', e); }
        }

        item = items[i];
        if (!item || this._rendered.has(i)) continue;

        const wrap = this._get();
        wrap.id = item.id || `hi-${i}`;

        const inner = this._mkContainer(item);
        try {
          const grp = item.group || (item.categoryId
            ? { categoryId: item.categoryId, type: item.type || 'button' }
            : null);
          if (grp) await this.renderGroupItems(inner, grp);
          else      await this.renderSingleItem(inner, item);
        } catch (e) { console.error('render item', e); }

        wrap.appendChild(inner);
        // Use scoped CSS class — never touches global animation state
        wrap.classList.add('hdr-fade');
        frag.appendChild(wrap);
        this._nodes.push(wrap);
        this._rendered.add(i);
        n++;
      }

      if (frag.childNodes.length) ctr.appendChild(frag);

      // Trim old nodes to stay under maxDOM budget
      const cap = this._maxDOM();
      while (this._nodes.length > cap) {
        const old = this._nodes.shift();
        try { if (old.parentNode) old.parentNode.removeChild(old); } catch (_) {}
        this._put(old);
      }
      return n;
    };

    // ── First batch ──────────────────────────────────────────────────────
    await renderBatch(0, this._batch());
    let done = this._rendered.size;

    if (done >= items.length) {
      try { window._headerV2_contentLoadingManager.hide(); } catch (_) {}
      return;
    }

    // ── Sentinel + IntersectionObserver for remaining ────────────────────
    let sentinel = document.getElementById(this._SENTINEL);
    if (!sentinel) {
      sentinel = document.createElement('div');
      sentinel.id = this._SENTINEL;
      sentinel.style.cssText = 'width:1px;height:1px;opacity:0;pointer-events:none;';
    }
    ctr.appendChild(sentinel);

    const schedule = typeof requestIdleCallback === 'function'
      ? (fn) => requestIdleCallback(fn, { timeout: 300 })
      : (fn) => setTimeout(fn, 16);

    this._observer = new IntersectionObserver((entries) => {
      if (signal.aborted || session !== this._session || this._busy) return;
      if (!entries[0]?.isIntersecting) return;

      this._busy = true;
      schedule(async () => {
        try {
          if (signal.aborted || session !== this._session) return;
          await renderBatch(done, this._batch());
          done = this._rendered.size;

          try { sentinel.parentNode?.removeChild(sentinel); } catch (_) {}
          if (done < items.length) {
            ctr.appendChild(sentinel);
          } else {
            if (this._observer) { this._observer.disconnect(); this._observer = null; }
            try { window._headerV2_contentLoadingManager.hide(); } catch (_) {}
          }
        } catch (e) { console.error('lazy batch', e); }
        finally { this._busy = false; }
      });
    }, { root: null, rootMargin: '500px', threshold: 0 });

    this._observer.observe(sentinel);
  },

  // ── Container ────────────────────────────────────────────────────────────
  _mkContainer(item) {
    const d = document.createElement('div');
    const isBtnType = item.group?.type === 'button' || item.type === 'button'
      || (item.group?.categoryId && !item.group?.type);
    d.className = isBtnType ? 'button-content-container' : 'card-content-container';
    if (item.group?.containerClass) d.classList.add(item.group.containerClass);
    return d;
  },

  // ── Group ────────────────────────────────────────────────────────────────
  async renderGroupItems(ctr, grp) {
    const dm = window._headerV2_data_manager || window._headerV2_dataManager;
    const isCard = grp.type === 'card';

    if (grp.categoryId) {
      const { data, header } = await dm.fetchCategoryGroup(grp.categoryId);
      if (header) ctr.appendChild(this._mkHeader(header));
      for (const item of data)
        ctr.appendChild(isCard ? await this._mkCard(item) : await this._mkBtn(item));
      return;
    }

    if (Array.isArray(grp.items)) {
      if (grp.header) ctr.appendChild(this._mkHeader(grp.header));
      for (const item of grp.items)
        ctr.appendChild(isCard ? await this._mkCard(item) : await this._mkBtn(item));
    }
  },

  // ── Header element ────────────────────────────────────────────────────────
  _mkHeader(cfg) {
    const lang = localStorage.getItem('selectedLang') || 'en';
    const wrap = document.createElement('div');
    wrap.className = 'group-header';
    if (typeof cfg === 'string') {
      wrap.innerHTML = `<h2 class="group-header-text">${cfg}</h2>`;
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

    // Language listener — attached once per element
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
      await this.renderGroupItems(ctr, { categoryId: item.categoryId, type: item.type || 'button' });
      return;
    }
    ctr.appendChild(item.type === 'button'
      ? await this._mkBtn(item)
      : await this._mkCard(item));
  },

  // ── Button ────────────────────────────────────────────────────────────────
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

    const finalText = text, finalApi = api, finalType = type;
    btn.addEventListener('click', async () => {
      try {
        await (window.unifiedCopyToClipboard)({
          text: finalText, api: finalApi, type: finalType, name: finalApi || ''
        });
      } catch (_) {
        window._headerV2_utils?.showNotification('Copy failed', 'error');
      }
    }, { passive: true });

    return btn;
  },

  // ── Card ──────────────────────────────────────────────────────────────────
  async _mkCard(cfg) {
    const lang = localStorage.getItem('selectedLang') || 'en';
    const card = document.createElement('div');
    card.className = 'card';

    if (cfg.image) {
      const img = document.createElement('img');
      img.className = 'card-image';
      img.src = cfg.image;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = _txt(cfg.imageAlt, lang);
      card.appendChild(img);
    }

    const body = document.createElement('div');
    body.className = 'card-content';
    body.innerHTML =
      `<div class="card-title">${_esc(_txt(cfg.title || cfg.name, lang))}</div>` +
      `<div class="card-description">${_esc(_txt(cfg.description, lang))}</div>`;
    card.appendChild(body);

    if (cfg.link)
      card.addEventListener('click', () => window.open(cfg.link, '_blank', 'noopener,noreferrer'),
        { passive: true });
    if (cfg.className) card.classList.add(cfg.className);
    return card;
  },

  // ── Language update ───────────────────────────────────────────────────────
  updateCardsLanguage(lang) {
    document.querySelectorAll('.card').forEach(c => {
      const t = c.querySelector('.card-title');
      if (t) { const v = t.dataset[`title${lang.toUpperCase()}`]; if (v) t.textContent = v; }
      const d = c.querySelector('.card-description');
      if (d) { const v = d.dataset[`desc${lang.toUpperCase()}`]; if (v) d.textContent = v; }
    });
  },

  // Legacy alias
  createContainer(item) { return this._mkContainer(item); },
  async createButton(cfg) { return this._mkBtn(cfg); },
  async createCard(cfg)   { return this._mkCard(cfg); },
};

// ── Pure helpers (no closure overhead per call) ───────────────────────────────
function _findApi(obj, code, depth = 0) {
  if (depth > 40) return null;
  if (Array.isArray(obj)) {
    for (const x of obj) { const r = _findApi(x, code, depth+1); if (r) return r; }
  } else if (obj && typeof obj === 'object') {
    if (obj.api === code) return obj;
    for (const k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      const r = _findApi(obj[k], code, depth+1);
      if (r) return r;
    }
  }
  return null;
}

function _txt(v, lang) {
  if (!v) return '';
  if (typeof v === 'object') return v[lang] || v.en || '';
  return String(v);
}

function _esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export default contentManager;