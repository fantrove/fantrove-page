// @ts-check
/**
 * @file content.js
 * ContentService — URE-powered rendering.
 * Adds horizontal card group support (card-group-h) alongside existing
 * btn-row split and card-group types.
 *
 * Layout types emitted to URE:
 *   btn-row      — 10 buttons per item; --first/mid/last/only position
 *   card-group   — vertical card grid (normal wrapping)
 *   card-group-h — horizontal scroll strip (overflow-x; no virtual scroll on X)
 *
 * Data spec for horizontal cards:
 *   { "group": { "categoryId": "...", "type": "card", "layout": "horizontal" } }
 *
 * @module content
 * @depends {config.js, state.js, data.js, loading.js}
 */
(function (M) {
  'use strict';

  const { CONFIG } = M;

  const _esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const _txt = (v, l) => !v ? '' : typeof v === 'object' ? (v[l] || v.en || '') : String(v);

  const BTN_ROW_SIZE = 10;

  // ── CSS (injected once) ───────────────────────────────────────────────────

  const _CSS_ID = '_nc_content_css';
  function _ensureCss() {
    if (document.getElementById(_CSS_ID)) return;
    const s = document.createElement('style');
    s.id = _CSS_ID;
    s.textContent = `
.cm-group{contain:layout style;isolation:isolate;}
.cm-in{animation:_nc_fadein 0.12s ease-out both;}
@keyframes _nc_fadein{from{opacity:0}to{opacity:1}}
@media(prefers-reduced-motion:reduce){.cm-in{animation:none;}}

/* btn-row: replicates button-content-container across split URE items */
.ure-btn-row{
  display:flex!important;flex-wrap:wrap!important;
  background:var(--fv-surface-page);
  justify-content:center!important;align-items:center!important;
  gap:5px!important;
  contain:layout style;
}
.ure-btn-row--only {border-radius:25px!important;padding:1rem 5px!important;margin:0 0 40px!important;}
.ure-btn-row--first{border-radius:25px 25px 0 0!important;padding:1rem 5px 0!important;}
.ure-btn-row--mid  {border-radius:0!important;padding:2px 5px!important;}
.ure-btn-row--last {border-radius:0 0 25px 25px!important;padding:0 5px 1rem!important;margin:0 0 40px!important;}

/* horizontal card strip */
.card-content-container--h{
  flex-wrap:nowrap!important;
  overflow-x:auto;
  justify-content:flex-start!important;
  padding:1rem 10px!important;
  -webkit-overflow-scrolling:touch;
  scrollbar-width:none;
  overscroll-behavior-x:contain;
  touch-action:pan-x;
}
.card-content-container--h::-webkit-scrollbar{display:none;}
.card-content-container--h .card{flex-shrink:0;width:160px;}`;
    document.head.appendChild(s);
  }

  // ── URE hard-dependency guard ─────────────────────────────────────────────

  function _ensureURE() {
    if (window.URE) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error(
          '[NavCore/Content] URE required. ' +
          'Add <script defer src="/assets/js/ure/ure.js"> before nav-core.js.'
        )), 4000);
      window.addEventListener('ure:ready', () => { clearTimeout(t); resolve(); }, { once: true });
    });
  }

  // ── Module state ──────────────────────────────────────────────────────────

  let _ureHandle = null;
  let _sess      = 0;

  // ── ContentService ────────────────────────────────────────────────────────

  const ContentService = {

    LOADING_CONTAINER_ID: CONFIG.DOM.CONTENT_LOADING_ID,

    async clearContent() {
      _sess++;
      if (_ureHandle) { try { _ureHandle.destroy(); } catch (_) {} _ureHandle = null; }
      const ctr = document.getElementById(CONFIG.DOM.CONTENT_LOADING_ID);
      if (ctr) ctr.innerHTML = '';
    },

    async renderContent(data) {
      if (!Array.isArray(data)) throw new Error('[Content] data must be array');
      _ensureCss();
      const ctr = document.getElementById(CONFIG.DOM.CONTENT_LOADING_ID);
      if (!ctr) return;

      await this.clearContent();
      const sess = _sess;

      try {
        await _ensureURE();
        if (sess !== _sess) return;

        const lang = localStorage.getItem('selectedLang') || 'en';
        await M.DataService.loadApiDatabase().catch(() => {});
        if (sess !== _sess) return;

        const items = await this._resolveAll(data, lang);
        if (sess !== _sess) return;

        try { M.LoadingService?.hide(); } catch (_) {}

        _ureHandle = window.URE.mount({
          container          : ctr,
          data               : items,
          keyField           : '_ureKey',
          estimatedItemHeight: 130,
          buffer             : 700,
          recycling          : true,
          template           : (item, l) => this._tpl(item, l),
          onItemClick        : (e)        => this._onClick(e),
        });

      } catch (e) {
        console.error('[NavCore/Content] renderContent error:', e);
        try { M.LoadingService?.hide(); } catch (_) {}
      }
    },

    // ── Resolution ────────────────────────────────────────────────────────────

    async _resolveAll(data, lang) {
      const out = [];
      const k   = { v: 0 };

      for (const item of data) {
        if (!item) continue;

        if (item.jsonFile && !item._fetched) {
          try {
            const res = await M.DataService.fetchWithRetry(item.jsonFile, {}, 3);
            const arr = Array.isArray(res) ? res : [res];
            const sub = await this._resolveAll(arr.map(r => ({ ...r, _fetched: true })), lang);
            for (const g of sub) { g._ureKey = `k${k.v++}`; out.push(g); }
          } catch (e) { console.error('[Content] jsonFile:', e); }
          continue;
        }

        if (item.group || item.categoryId) {
          const cfg     = item.group || { categoryId: item.categoryId, type: item.type || 'button' };
          const resolved = await this._resolveGroup(cfg, lang);
          if (resolved) this._emit(resolved, k, out);
          continue;
        }

        const isCard = this._isCard(item);
        const ri     = await this._resolveItem(item, lang, isCard);
        if (ri) {
          out.push({
            _ureKey : `k${k.v++}`,
            _ureType: isCard ? 'card-group' : 'btn-row',
            header  : null,
            items   : [ri],
            _rowPos : 'only',
          });
        }
      }
      return out;
    },

    async _resolveGroup(cfg, lang) {
      const isCard  = cfg.type === 'card';
      const isHoriz = isCard && cfg.layout === 'horizontal';

      const _fetchItems = async (data) =>
        (await Promise.all(data.map(d => this._resolveItem(d, lang, isCard)))).filter(Boolean);

      if (cfg.categoryId) {
        try {
          const { data, header } = await M.DataService.fetchCategoryGroup(cfg.categoryId);
          const items = await _fetchItems(data);
          const type  = isHoriz ? 'card-group-h' : isCard ? 'card-group' : 'btn-group';
          return { _ureType: type, header: header || null, items };
        } catch (e) { console.error('[Content] categoryId:', e); return null; }
      }

      if (Array.isArray(cfg.items)) {
        const items = await _fetchItems(cfg.items);
        const type  = isHoriz ? 'card-group-h' : isCard ? 'card-group' : 'btn-group';
        return { _ureType: type, header: cfg.header || null, items };
      }
      return null;
    },

    async _resolveItem(item, lang, forceCard = false) {
      if (forceCard || this._isCard(item)) {
        return {
          _type: 'card', image: item.image || null, imageAlt: item.imageAlt,
          title: item.title || item.name, description: item.description,
          link: item.link || null, className: item.className || null,
        };
      }
      const api  = item.api || null;
      let text = '';
      try {
        text = api
          ? (M.DataService._sharedIndex?.apiMap?.get(api)?.text || api)
          : (item.content || item.text || '');
      } catch (_) { text = item.text || api || '?'; }
      if (!text) return null;
      return { _type: 'button', text, api, name: item.name || api || '' };
    },

    _isCard: item =>
      item.type === 'card' || item.group?.type === 'card' || (!!item.image && !item.api),

    // ── Emit ─────────────────────────────────────────────────────────────────
    // card-group and card-group-h: single URE item.
    // btn-group: split into row items (same visual appearance, smaller DOM per item).

    _emit(group, k, out) {
      if (group._ureType === 'card-group' || group._ureType === 'card-group-h') {
        out.push({ ...group, _ureKey: `k${k.v++}` });
        return;
      }
      // btn-group → rows
      const rows = [];
      for (let i = 0; i < group.items.length; i += BTN_ROW_SIZE)
        rows.push(group.items.slice(i, i + BTN_ROW_SIZE));

      rows.forEach((row, ri) => {
        const only = rows.length === 1, last = ri === rows.length - 1;
        out.push({
          _ureKey : `k${k.v++}`,
          _ureType: 'btn-row',
          header  : ri === 0 ? (group.header || null) : null,
          items   : row,
          _rowPos : only ? 'only' : ri === 0 ? 'first' : last ? 'last' : 'mid',
        });
      });
    },

    // ── Templates ─────────────────────────────────────────────────────────────

    _tpl(item, lang) {
      switch (item._ureType) {
        case 'card-group':   return this._tplCardGroup(item, lang);
        case 'card-group-h': return this._tplCardGroupH(item, lang);
        default:             return this._tplBtnRow(item, lang);   // 'btn-row'
      }
    },

    _tplBtnRow(item, lang) {
      const pos = item._rowPos || 'only';
      let html = `<div class="cm-group cm-in"><div class="ure-btn-row ure-btn-row--${pos}">`;
      if (item.header) html += this._tplHeader(item.header, lang);
      for (const b of item.items) html += this._tplBtn(b);
      return html + '</div></div>';
    },

    _tplCardGroup(item, lang) {
      let html = `<div class="cm-group cm-in"><div class="card-content-container">`;
      if (item.header) html += this._tplHeader(item.header, lang);
      for (const c of item.items) html += this._tplCard(c, lang);
      return html + '</div></div>';
    },

    // Horizontal card strip — CSS overflow-x scroll, no X-axis virtual scroll.
    // Appropriate for carousels with up to ~30 items.
    // For large horizontal datasets use URE.mount({ horizontal: true }) directly.
    _tplCardGroupH(item, lang) {
      let html = `<div class="cm-group cm-in"><div class="card-content-container card-content-container--h">`;
      if (item.header) html += this._tplHeader(item.header, lang);
      for (const c of item.items) html += this._tplCard(c, lang);
      return html + '</div></div>';
    },

    _tplHeader(cfg, lang) {
      if (typeof cfg === 'string')
        return `<div class="group-header"><h2 class="group-header-text">${_esc(cfg)}</h2></div>`;
      const cls  = cfg.className ? ` ${_esc(cfg.className)}` : '';
      const desc = cfg.description
        ? `<p class="group-header-description">${_esc(_txt(cfg.description, lang))}</p>` : '';
      return `<div class="group-header${cls}"><h2 class="group-header-text">${_esc(_txt(cfg.title, lang))}</h2>${desc}</div>`;
    },

    _tplBtn(item) {
      return `<button class="button-content" data-text="${_esc(item.text)}" data-api="${_esc(item.api||'')}">${_esc(item.text)}</button>`;
    },

    _tplCard(item, lang) {
      const cls  = item.className ? ` ${_esc(item.className)}` : '';
      const link = item.link ? ` data-link="${_esc(item.link)}"` : '';
      const img  = item.image
        ? `<img class="card-image" src="${_esc(item.image)}" loading="lazy" decoding="async" fetchpriority="low" alt="${_esc(_txt(item.imageAlt, lang))}">`
        : '';
      return (
        `<div class="card${cls}"${link}>${img}` +
        `<div class="card-content">` +
          `<div class="card-title">${_esc(_txt(item.title, lang))}</div>` +
          `<div class="card-description">${_esc(_txt(item.description, lang))}</div>` +
        `</div></div>`
      );
    },

    // ── Click delegation ──────────────────────────────────────────────────────

    _onClick(e) {
      const btn = e.target.closest('.button-content');
      if (btn) {
        try {
          window.unifiedCopyToClipboard?.({ text: btn.dataset.text, api: btn.dataset.api || null, type: 'button', name: btn.dataset.api || '' })
            ?.catch?.(() => M.Utils?.showNotification('Copy failed', 'error'));
        } catch (_) {}
        return;
      }
      const card = e.target.closest('.card[data-link]');
      if (card) window.open(card.dataset.link, '_blank', 'noopener,noreferrer');
    },

    updateCardsLanguage(lang) {
      if (_ureHandle) try { _ureHandle.setLang(lang); } catch (_) {}
    },

    createContainer()        { return document.createElement('div'); },
    async createButton()     { return document.createElement('button'); },
    async createCard()       { return document.createElement('div'); },
    async renderGroupItems() {},
    async renderSingleItem() {},
  };

  M.ContentService = ContentService;

})(window.NavCoreModules = window.NavCoreModules || {});