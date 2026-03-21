// @ts-check
/**
 * @file content.js
 * ContentService — dynamic content rendering (buttons and cards).
 *
 * Architecture:
 *   renderContent(data)    → batch render with IntersectionObserver lazy-load
 *   clearContent()         → abort any in-progress render, return nodes to pool
 *   renderBatch(from, sz)  → yield every _YIELD_EVERY items so spinner stays smooth
 *
 * Optimizations (all preserved from v4.4):
 *   ① content-visibility:auto on wrapper groups  → off-screen CSS containment
 *   ② MessageChannel-based yield                 → compositor gets a frame slot
 *   ③ Yield threshold adapts to device tier       → tier0=4, tier1=8, tier2=16
 *   ④ DOM pool (_pool)                            → reuse wrapper divs across renders
 *   ⑤ BitSet (_Bits)                              → O(1) rendered-index tracking
 *   ⑥ DocumentFragment batching                  → single DOM write per yield
 *
 * CSS is injected once via _ensureCss().
 *
 * @module content
 * @depends {config.js, state.js, data.js, loading.js}
 */
(function (M) {
  'use strict';

  const { CONFIG } = M;

  // ── One-time CSS injection ────────────────────────────────────────────────────

  const _CSS_ID = '_nc_content_css';

  function _ensureCss() {
    if (document.getElementById(_CSS_ID)) return;
    const s = document.createElement('style');
    s.id = _CSS_ID;
    s.textContent = `
.cm-group{content-visibility:auto;contain-intrinsic-size:auto 260px;contain:layout style paint;isolation:isolate;}
.cm-group[data-gt="btn"]  {contain-intrinsic-size:auto 76px;}
.cm-group[data-gt="card"] {contain-intrinsic-size:auto 240px;}
.cm-group[data-gt="mixed"]{contain-intrinsic-size:auto 300px;}
.cm-in{animation:_nc_fadein 0.12s ease-out both;will-change:opacity;}
@keyframes _nc_fadein{from{opacity:0}to{opacity:1}}
.cm-in.cm-done{will-change:auto;}
@media(prefers-reduced-motion:reduce){.cm-in,.cm-in.cm-done{animation:none;will-change:auto;}}
#cm4-sentinel{width:1px;height:1px;opacity:0;pointer-events:none;flex-basis:100%;}`;
    document.head.appendChild(s);
  }

  // ── Background scheduler ──────────────────────────────────────────────────────

  /** Run fn in idle / background time. */
  function _bg(fn) {
    if (typeof scheduler !== 'undefined' && scheduler.postTask)
      return scheduler.postTask(fn, { priority: 'background' });
    if (typeof requestIdleCallback !== 'undefined')
      return requestIdleCallback(fn, { timeout: 400 });
    return setTimeout(fn, 24);
  }

  // ── MessageChannel yield ──────────────────────────────────────────────────────
  // Fires after paint (unlike Promise.resolve which fires before).
  // Gives compositor a frame slot so the spinner keeps rotating.

  const _mc = (() => {
    try {
      const { port1, port2 } = new MessageChannel();
      let _res = null;
      port1.onmessage = () => { if (_res) { const r = _res; _res = null; r(); } };
      return {
        yield() {
          return new Promise(resolve => { _res = resolve; port2.postMessage(null); });
        },
      };
    } catch (_) {
      return { yield() { return new Promise(r => setTimeout(r, 0)); } };
    }
  })();

  async function _yield() {
    if (typeof scheduler !== 'undefined' && scheduler.yield) return scheduler.yield();
    return _mc.yield();
  }

  // ── BitSet — O(1) rendered-index tracking ────────────────────────────────────

  class _Bits {
    constructor(n) { this.b = new Uint32Array(Math.ceil((n || 256) / 32)); this._cnt = 0; }
    has(i)  { return !!(this.b[i >> 5] & (1 << (i & 31))); }
    add(i)  { if (this.has(i)) return; this.b[i >> 5] |= (1 << (i & 31)); this._cnt++; }
    count() { return this._cnt; }
    clear() { this.b.fill(0); this._cnt = 0; }
    grow(n) {
      const need = Math.ceil(n / 32);
      if (need > this.b.length) {
        const nb = new Uint32Array(need); nb.set(this.b); this.b = nb;
      }
    }
  }

  // ── DOM pool — reuse wrapper divs across renders ──────────────────────────────

  const _pool = {
    _s: new Map(), CAP: CONFIG.CONTENT.POOL_CAP,
    get(t) { const a = this._s.get(t); return a?.length ? a.pop() : null; },
    put(t, n) {
      if (!n) return;
      try {
        const f = n.cloneNode(false);
        f.className = '';
        f.style.cssText = '';
        f.removeAttribute('data-gt');
        f.removeAttribute('data-id');
        n = f;
      } catch (_) {}
      let a = this._s.get(t);
      if (!a) { a = []; this._s.set(t, a); }
      if (a.length < this.CAP) a.push(n);
    },
    clear() { this._s.clear(); },
  };

  // ── Device tier — adapts batch size and yield threshold ──────────────────────

  const _vp = { w: window.innerWidth };
  try {
    const ro = new ResizeObserver(e => { for (const r of e) _vp.w = r.contentRect.width; });
    ro.observe(document.documentElement);
  } catch (_) {}

  // tier 0 = low-end (≤1GB RAM / ≤2 cores), tier 1 = mid, tier 2 = high
  const _T = (() => {
    const m = navigator.deviceMemory, c = navigator.hardwareConcurrency || 2;
    if ((m && m <= 1) || c <= 2) return 0;
    if ((m && m <= 2) || c <= 4) return 1;
    return 2;
  })();

  /** Items per batch, scaled by viewport width */
  const _bsz = () => {
    const b = [3, 6, 12][_T];
    return _vp.w >= 1024 ? b * 2 : _vp.w >= 600 ? Math.ceil(b * 1.5) : b;
  };

  /** Max DOM nodes before evicting oldest */
  const _maxdom = () => {
    const b = [14, 28, 56][_T];
    return _vp.w >= 1024 ? b * 2 : b;
  };

  /** Yield after this many items — tier 0=4, tier 1=8, tier 2=16 */
  const _YIELD_EVERY = [4, 8, 16][_T];

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const _txt = (v, l) => !v ? '' : typeof v === 'object' ? (v[l] || v.en || '') : String(v);
  const _esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const _offscreen = new WeakSet();
  function _cvsc(el) {
    if (!('oncontentvisibilityautostatechange' in el)) return;
    el.addEventListener('contentvisibilityautostatechange', ev => {
      if (ev.skipped) _offscreen.add(el); else _offscreen.delete(el);
    }, { passive: true });
  }

  function _hideLoading() {
    try { M.LoadingService?.hide(); } catch (_) {}
  }

  // ── ContentService ────────────────────────────────────────────────────────────

  const ContentService = {
    _sess:  0,
    _abort: null,
    /** @type {HTMLElement[]} */ _nodes: [],
    /** @type {ContentItem[]} */ _items: [],
    _done:  null,
    _io:    null,
    _busy:  false,
    _SID:   CONFIG.DOM.SENTINEL_ID,

    // ── Clear ───────────────────────────────────────────────────────────────────

    async clearContent() {
      this._sess++;
      if (this._abort) { try { this._abort.abort(); } catch (_) {} this._abort = null; }
      this._busy = false;
      if (this._io) { try { this._io.disconnect(); } catch (_) {} this._io = null; }

      const s = document.getElementById(this._SID);
      if (s?.parentNode) s.parentNode.removeChild(s);

      for (const n of this._nodes) {
        const t = n.dataset.gt || 'btn';
        try { if (n.parentNode) n.parentNode.removeChild(n); } catch (_) {}
        _pool.put(t, n);
      }
      this._nodes.length = 0;
      this._items        = [];
      this._done         = new _Bits(256);
    },

    // ── Render ──────────────────────────────────────────────────────────────────

    /**
     * Render an array of content items into #content-loading.
     * @param {ContentItem[]} data
     */
    async renderContent(data) {
      if (!Array.isArray(data)) throw new Error('data must be array');
      _ensureCss();

      const ctr = document.getElementById(M.LoadingService.LOADING_CONTAINER_ID);
      if (!ctr) return;

      await this.clearContent();
      const sess   = this._sess;
      this._done.grow(data.length + 64);
      this._abort  = new AbortController();
      const { signal } = this._abort;
      const items  = data.slice();
      this._items  = items;

      // ── renderBatch ──────────────────────────────────────────────────────────
      const renderBatch = async (from, bsz) => {
        if (signal.aborted || sess !== this._sess) return 0;
        const to = Math.min(items.length, from + bsz);
        if (from >= to) return 0;

        // Parallel jsonFile resolution
        const jsonSlots = [];
        for (let i = from; i < to; i++) {
          if (items[i]?.jsonFile && !items[i]._fetched) jsonSlots.push(i);
        }
        if (jsonSlots.length) {
          await Promise.all(jsonSlots.map(async i => {
            try {
              const res = await M.DataService.fetchWithRetry(items[i].jsonFile, {}, 3);
              if (Array.isArray(res)) {
                items[i]._fetched = true;
                items.splice(i, 1, ...res);
                this._done.grow(items.length + 64);
              } else {
                items[i] = res;
              }
            } catch (e) { console.error('[NavCore/Content] jsonFile error', e); }
          }));
        }

        if (signal.aborted || sess !== this._sess) return 0;

        const frag = document.createDocumentFragment();
        let n = 0, sinceYield = 0;
        const limit = Math.min(items.length, to + (jsonSlots.length || 0));

        for (let i = from; i < limit; i++) {
          if (signal.aborted || sess !== this._sess) break;
          if (this._done.has(i)) continue;
          const item = items[i];
          if (!item) continue;

          const isCard = this._isCard(item);
          const gt     = isCard ? 'card' : 'btn';
          let   wrap   = _pool.get(gt) || document.createElement('div');
          wrap.className = 'cm-group cm-in';
          wrap.dataset.gt = gt;
          wrap.dataset.id = item.id || `g${i}`;
          wrap.addEventListener('animationend', function h() {
            wrap.classList.add('cm-done');
            wrap.removeEventListener('animationend', h);
          }, { once: true, passive: true });
          _cvsc(wrap);

          const inner = this._mkCtr(item);
          try {
            const grp = item.group || (item.categoryId ? { categoryId: item.categoryId, type: item.type || 'button' } : null);
            if (grp) await this._renderGroup(inner, grp);
            else     await this._renderSingle(inner, item);
          } catch (e) { console.error('[NavCore/Content] render item error', e); }

          wrap.appendChild(inner);
          frag.appendChild(wrap);
          this._nodes.push(wrap);
          this._done.add(i);
          n++;
          sinceYield++;

          // Flush fragment + yield so compositor gets a frame slot
          if (sinceYield >= _YIELD_EVERY) {
            if (frag.childNodes.length) ctr.appendChild(frag);
            await _yield();
            if (signal.aborted || sess !== this._sess) return n;
            sinceYield = 0;
          }
        }

        if (frag.childNodes.length) ctr.appendChild(frag);

        // Evict oldest nodes beyond max DOM cap
        const cap = _maxdom();
        while (this._nodes.length > cap) {
          const old = this._nodes.shift();
          try { if (old.parentNode) old.parentNode.removeChild(old); } catch (_) {}
          _pool.put(old.dataset.gt || 'btn', old);
        }

        return n;
      };

      // First batch + hide loading
      await renderBatch(0, _bsz());
      _hideLoading();

      let done = this._done.count();
      if (done >= items.length) return;

      // Remaining batches: IntersectionObserver sentinel lazy-load
      let sentinel = document.getElementById(this._SID);
      if (!sentinel) { sentinel = document.createElement('div'); sentinel.id = this._SID; }
      ctr.appendChild(sentinel);

      this._io = new IntersectionObserver(entries => {
        if (signal.aborted || sess !== this._sess || this._busy) return;
        if (!entries[0]?.isIntersecting) return;
        this._busy = true;
        _bg(async () => {
          try {
            if (signal.aborted || sess !== this._sess) return;
            await renderBatch(done, _bsz());
            done = this._done.count();
            try { sentinel.parentNode?.removeChild(sentinel); } catch (_) {}
            if (done < items.length) ctr.appendChild(sentinel);
            else if (this._io) { this._io.disconnect(); this._io = null; }
          } catch (e) { console.error('[NavCore/Content] lazy batch error', e); }
          finally     { this._busy = false; }
        });
      }, { root: null, rootMargin: '700px', threshold: 0 });

      this._io.observe(sentinel);
    },

    // ── Item helpers ─────────────────────────────────────────────────────────────

    /** @param {ContentItem} item @returns {boolean} */
    _isCard(item) {
      return item.type === 'card'
        || item.group?.type === 'card'
        || (!!(item.image) && !item.api);
    },

    /** @param {ContentItem} item @returns {HTMLDivElement} */
    _mkCtr(item) {
      const d  = document.createElement('div');
      const isBtn = item.group?.type === 'button'
        || item.type === 'button'
        || (item.group?.categoryId && !item.group?.type);
      d.className = isBtn ? 'button-content-container' : 'card-content-container';
      if (item.group?.containerClass) d.classList.add(item.group.containerClass);
      return d;
    },

    /**
     * Render a group of items (categoryId or inline items[]).
     * @param {HTMLElement}  ctr
     * @param {any}          grp
     */
    async _renderGroup(ctr, grp) {
      const isCard = grp.type === 'card';
      if (grp.categoryId) {
        const { data, header } = await M.DataService.fetchCategoryGroup(grp.categoryId);
        if (header) ctr.appendChild(this._mkHeader(header));
        const frag = document.createDocumentFragment();
        for (const item of data)
          frag.appendChild(isCard ? await this._mkCard(item) : await this._mkBtn(item));
        ctr.appendChild(frag);
        return;
      }
      if (Array.isArray(grp.items)) {
        if (grp.header) ctr.appendChild(this._mkHeader(grp.header));
        const frag = document.createDocumentFragment();
        for (const item of grp.items)
          frag.appendChild(isCard ? await this._mkCard(item) : await this._mkBtn(item));
        ctr.appendChild(frag);
      }
    },

    /**
     * Render a single item (button or card).
     * @param {HTMLElement}  ctr
     * @param {ContentItem}  item
     */
    async _renderSingle(ctr, item) {
      if (item.categoryId) {
        await this._renderGroup(ctr, { categoryId: item.categoryId, type: item.type || 'button' });
        return;
      }
      ctr.appendChild(item.type === 'button' ? await this._mkBtn(item) : await this._mkCard(item));
    },

    /**
     * Build a group header element.
     * @param {any} cfg
     * @returns {HTMLElement}
     */
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
      h.className   = 'group-header-text';
      h.textContent = _txt(cfg.title, lang);
      wrap.appendChild(h);

      if (cfg.description) {
        const p = document.createElement('p');
        p.className   = 'group-header-description';
        p.textContent = _txt(cfg.description, lang);
        wrap.appendChild(p);
      }

      // React to language changes
      if (!wrap._ll) {
        wrap._ll = true;
        window.addEventListener('languageChange', ev => {
          const nl = ev.detail?.language || 'en';
          const ht = wrap.querySelector('.group-header-text');
          if (ht && cfg.title) ht.textContent = _txt(cfg.title, nl);
          const hd = wrap.querySelector('.group-header-description');
          if (hd && cfg.description) hd.textContent = _txt(cfg.description, nl);
        }, { passive: true });
      }

      return wrap;
    },

    /**
     * Build a copy-button element.
     * @param {ContentItem} cfg
     * @returns {Promise<HTMLButtonElement>}
     */
    async _mkBtn(cfg) {
      const btn = document.createElement('button');
      btn.className = 'button-content';

      let text = '', api = cfg.api || null, type = cfg.type || null;
      try {
        if (api) {
          await M.DataService.loadApiDatabase();
          const node = M.DataService._sharedIndex?.apiMap?.get(api) || null;
          text  = node?.text || api;
          type  = type || 'emoji';
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
          await window.unifiedCopyToClipboard({ text: ft, api: fa, type: ftype, name: fa || '' });
        } catch (_) {
          M.Utils?.showNotification('Copy failed', 'error');
        }
      }, { passive: true });

      return btn;
    },

    /**
     * Build a card element.
     * @param {ContentItem} cfg
     * @returns {Promise<HTMLDivElement>}
     */
    async _mkCard(cfg) {
      const lang = localStorage.getItem('selectedLang') || 'en';
      const card = document.createElement('div');
      card.className = 'card';

      let html = '';
      if (cfg.image) {
        html += `<img class="card-image" src="${_esc(cfg.image)}" loading="lazy" decoding="async" fetchpriority="low" alt="${_esc(_txt(cfg.imageAlt, lang))}">`;
      }
      html +=
        `<div class="card-content">` +
          `<div class="card-title">${_esc(_txt(cfg.title || cfg.name, lang))}</div>` +
          `<div class="card-description">${_esc(_txt(cfg.description, lang))}</div>` +
        `</div>`;
      card.innerHTML = html;

      if (cfg.link)
        card.addEventListener('click', () => window.open(cfg.link, '_blank', 'noopener,noreferrer'), { passive: true });
      if (cfg.className) card.classList.add(cfg.className);

      return card;
    },

    // ── Language update ───────────────────────────────────────────────────────────

    /** @param {string} lang */
    updateCardsLanguage(lang) {
      document.querySelectorAll('.card').forEach(c => {
        const t = c.querySelector('.card-title');
        if (t) { const v = t.dataset[`title${lang.toUpperCase()}`]; if (v) t.textContent = v; }
        const d = c.querySelector('.card-description');
        if (d) { const v = d.dataset[`desc${lang.toUpperCase()}`];  if (v) d.textContent = v; }
      });
    },

    // ── Public aliases ─────────────────────────────────────────────────────────────
    createContainer(item)            { return this._mkCtr(item); },
    async createButton(cfg)          { return this._mkBtn(cfg); },
    async createCard(cfg)            { return this._mkCard(cfg); },
    async renderGroupItems(ctr, grp) { return this._renderGroup(ctr, grp); },
    async renderSingleItem(ctr, item){ return this._renderSingle(ctr, item); },
  };

  // ── Export ────────────────────────────────────────────────────────────────────

  M.ContentService = ContentService;

})(window.NavCoreModules = window.NavCoreModules || {});