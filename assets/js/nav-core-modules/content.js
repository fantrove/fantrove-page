// Path:    assets/js/nav-core-modules/content.js
// Purpose: ContentService — renders content items (buttons, cards, source groups) via URE
// Used by: router.js (M.ContentService.renderContent), init.js (M.ContentService.updateCardsLanguage)

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
 * Data spec for source descriptor (v2 — pulls entire type from con-data):
 *   { "source": "emoji" }
 *   { "source": "symbol", "layout": "button" }
 *   { "source": "emoji", "only": ["smileys_emotion", "activities"] }
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

  // WHY: กำหนด constant เพื่อป้องกัน magic string ใน _resolveSource / _fetchSourceGroup
  const LAYOUT = Object.freeze({ BUTTON: 'button', CARD: 'card' });

  // WHY: content JSON ใช้ plural ('cards', 'buttons') เพื่อความอ่านง่าย
  //      แต่ LAYOUT constant ใช้ singular — normalize ที่ entry point เดียว
  function _toLayout(val) {
    if (val === 'cards' || val === 'card') return LAYOUT.CARD;
    return LAYOUT.BUTTON;
  }

  // ── CSS (injected once) ───────────────────────────────────────────────────

  const _CSS_ID = '_nc_content_css';
  function _ensureCss() {
    if (document.getElementById(_CSS_ID)) return;
    const s = document.createElement('style');
    s.id = _CSS_ID;
    s.textContent = `
.cm-group{contain:layout style;isolation:isolate;}
/* fade-in moved to ure-new in virtual-list.js */



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
      if (_ureHandle) { try { _ureHandle.destroy(); } catch (err) { console.warn('[Content] URE destroy failed:', err); } _ureHandle = null; }
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
        await M.DataService.loadApiDatabase().catch(err => { console.warn('[Content] loadApiDatabase failed, continuing:', err); });
        if (sess !== _sess) return;

        const items = await this._resolveAll(data, lang);
        if (sess !== _sess) return;

        try { M.LoadingService?.hide(); } catch (err) { console.warn('[Content] LoadingService.hide failed:', err); }

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
        try { M.LoadingService?.hide(); } catch (err) { console.warn('[Content] LoadingService.hide failed in catch:', err); }
      }
    },

    // ── Resolution ────────────────────────────────────────────────────────────

    async _resolveAll(data, lang) {
      const out = [];
      const k   = { v: 0 };

      for (const item of data) {
        if (!item) continue;

        // jsonFile: fetch then recurse
        if (item.jsonFile && !item._fetched) {
          try {
            const res = await M.DataService.fetchWithRetry(item.jsonFile, {}, 3);
            const arr = Array.isArray(res) ? res : [res];
            const sub = await this._resolveAll(arr.map(r => ({ ...r, _fetched: true })), lang);
            for (const g of sub) { g._ureKey = `k${k.v++}`; out.push(g); }
          } catch (e) { console.error('[Content] jsonFile:', e); }
          continue;
        }

        // source: ดึงทั้ง type จาก con-data
        // WHY: remap 'as' → 'layout' ที่นี่เพื่อไม่ต้องแก้ _resolveSource signature
        if (item.source) {
          const descriptor = item.as ? { ...item, layout: _toLayout(item.as) } : item;
          const groups = await this._resolveSource(descriptor, lang);
          groups.forEach(g => this._emit(g, k, out));
          continue;
        }

        // category: ดึง subcategory เดียวจาก con-data — ข้อมูลดิบอยู่ใน con-data เท่านั้น
        // WHY: แยกจาก 'source' เพื่อระบุ subcategory เดียวได้โดยไม่ fetch ทั้ง type
        if (item.category) {
          const asLayout = _toLayout(item.as || item.layout);
          const cfg = {
            categoryId: item.category,
            type:       asLayout === LAYOUT.CARD ? 'card' : 'button',
            layout:     item.horizontal ? 'horizontal' : undefined,
          };
          const resolved = await this._resolveGroup(cfg, lang);
          if (resolved) this._emit(resolved, k, out);
          continue;
        }

        // group / categoryId: legacy path — รองรับ format เดิม ไม่เปลี่ยน
        if (item.group || item.categoryId) {
          const cfg      = item.group || { categoryId: item.categoryId, type: item.type || 'button' };
          const resolved = await this._resolveGroup(cfg, lang);
          if (resolved) this._emit(resolved, k, out);
          continue;
        }

        // single item
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

    // ── _resolveSource ────────────────────────────────────────────────────────
    //
    // WHY: แทนที่การเขียน categoryId ทีละตัวใน content JSON
    //      ด้วย { "source": "emoji" } ตัวเดียว — ระบบดึงทุก category ของ type นั้นเอง
    //
    // @param {{ source: string, layout?: string, only?: string[] }} item
    // @param {string} lang
    // @returns {Promise<Array>}

    async _resolveSource(item, lang) {
      const { source, layout = LAYOUT.BUTTON, only: filter = null } = item;
      if (!source) return [];

      const cats = await M.DataService.getTypeCategories(source);
      if (!cats || !cats.length) return [];

      // WHY filter หลัง fetch cats: ไม่ต้อง fetch ทีละ cat ก่อน — cats มาจาก index แล้ว
      const filtered = filter
        ? cats.filter(c => filter.includes(c.id))
        : cats;

      const groups = await Promise.all(
        filtered.map(cat => this._fetchSourceGroup(cat, layout, lang))
      );
      return groups.filter(Boolean);
    },

    // ── _fetchSourceGroup ─────────────────────────────────────────────────────
    //
    // WHY แยกจาก _resolveSource: แต่ละ category resolve อิสระ
    //     category เดียวพังไม่ทำให้ทั้ง type พัง
    //
    // @param {{ id: string, name: object }} cat
    // @param {string} layout
    // @param {string} lang
    // @returns {Promise<Object|null>}

    async _fetchSourceGroup(cat, layout, lang) {
      try {
        const { data, header } = await M.DataService.fetchCategoryGroup(cat.id);
        const isCard  = layout === LAYOUT.CARD;
        const items   = (await Promise.all(
          data.map(d => this._resolveItem(d, lang, isCard))
        )).filter(Boolean);
        return { _ureType: isCard ? 'card-group' : 'btn-group', header, items };
      } catch (err) {
        console.warn('[Content] _fetchSourceGroup failed:', cat.id, err.message);
        return null;
      }
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
      let html = `<div class="cm-group"><div class="ure-btn-row ure-btn-row--${pos}">`;
      if (item.header) html += this._tplHeader(item.header, lang);
      for (const b of item.items) html += this._tplBtn(b);
      return html + '</div></div>';
    },

    _tplCardGroup(item, lang) {
      let html = `<div class="cm-group"><div class="card-content-container">`;
      if (item.header) html += this._tplHeader(item.header, lang);
      for (const c of item.items) html += this._tplCard(c, lang);
      return html + '</div></div>';
    },

    // Horizontal card strip — CSS overflow-x scroll, no X-axis virtual scroll.
    // Appropriate for carousels with up to ~30 items.
    // For large horizontal datasets use URE.mount({ horizontal: true }) directly.
    _tplCardGroupH(item, lang) {
      let html = `<div class="cm-group"><div class="card-content-container card-content-container--h">`;
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
        } catch (err) { console.warn('[Content] copy failed:', err); }
        return;
      }
      const card = e.target.closest('.card[data-link]');
      if (card) window.open(card.dataset.link, '_blank', 'noopener,noreferrer');
    },

    updateCardsLanguage(lang) {
      if (_ureHandle) try { _ureHandle.setLang(lang); } catch (err) { console.warn('[Content] setLang failed:', err); }
    },

    createContainer()        { return document.createElement('div'); },
    async createButton()     { return document.createElement('button'); },
    async createCard()       { return document.createElement('div'); },
    async renderGroupItems() {},
    async renderSingleItem() {},
  };

  M.ContentService = ContentService;

})(window.NavCoreModules = window.NavCoreModules || {});