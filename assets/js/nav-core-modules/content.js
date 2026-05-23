// @ts-check
/**
 * @file content.js
 * ContentService — dynamic content rendering via URE (Universal Render Engine).
 *
 * Replaces the custom batch/IntersectionObserver pipeline with URE, which
 * handles virtual scroll, DOM pooling, and lazy loading internally.
 *
 * Public interface is IDENTICAL to the previous version — all callers
 * (RouterService, init.js, external scripts) work without changes.
 *
 * Pipeline:
 *   renderContent(data)
 *     → _resolveGroups()   — async pre-fetch (jsonFiles, categoryIds, API codes)
 *     → URE.mount()        — virtual scroll + DOM recycling
 *     → _tplGroup()        — sync HTML template per group (preserves all CSS classes)
 *
 * @module content
 * @depends {config.js, state.js, data.js, loading.js}
 */
(function (M) {
  'use strict';

  const { CONFIG } = M;

  // ── Helpers ───────────────────────────────────────────────────────────────

  const _esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const _txt = (v, l) => !v ? '' : typeof v === 'object' ? (v[l] || v.en || '') : String(v);

  // ── CSS injection (fade-in animation, preserved from original) ────────────

  const _CSS_ID = '_nc_content_css';
  function _ensureCss() {
    if (document.getElementById(_CSS_ID)) return;
    const s = document.createElement('style');
    s.id = _CSS_ID;
    s.textContent = `
.cm-group{contain:layout style;isolation:isolate;}
.cm-in{animation:_nc_fadein 0.12s ease-out both;}
@keyframes _nc_fadein{from{opacity:0}to{opacity:1}}
@media(prefers-reduced-motion:reduce){.cm-in{animation:none;}}`;
    document.head.appendChild(s);
  }

  // ── URE availability guard ────────────────────────────────────────────────
  // URE is a HARD dependency — this page will not render content without it.
  // Add <script defer src="/assets/js/ure/ure.js"> to the page HTML.
  // No dynamic loading fallback: if URE is absent, renderContent() throws.

  function _ensureURE() {
    if (window.URE) return Promise.resolve();
    // URE script is in the page but may still be loading (defer) — wait briefly
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(
          '[NavCore/Content] URE is required but not loaded. ' +
          'Add <script defer src="/assets/js/ure/ure.js"> before nav-core.js.'
        )),
        4000
      );
      window.addEventListener('ure:ready', () => { clearTimeout(timer); resolve(); }, { once: true });
      // ⚠️ No script injection here — URE must be declared explicitly in HTML.
    });
  }

  // ── Module state ──────────────────────────────────────────────────────────

  /** Active URE engine handle (one per rendered content section). */
  let _ureHandle = null;

  /**
   * Session counter — incremented on every clearContent().
   * Any in-flight _resolveGroups call checks sess === _sess before mounting
   * to avoid stale renders after fast navigation.
   */
  let _sess = 0;

  // ── ContentService ────────────────────────────────────────────────────────

  const ContentService = {

    /** Exposed so LoadingService can read the container ID. */
    LOADING_CONTAINER_ID: CONFIG.DOM.CONTENT_LOADING_ID,

    // ── Clear ───────────────────────────────────────────────────────────────

    async clearContent() {
      _sess++;
      if (_ureHandle) {
        try { _ureHandle.destroy(); } catch (_) {}
        _ureHandle = null;
      }
      const ctr = document.getElementById(CONFIG.DOM.CONTENT_LOADING_ID);
      if (ctr) ctr.innerHTML = '';
    },

    // ── Render ──────────────────────────────────────────────────────────────

    /**
     * Render an array of content items into #content-loading via URE.
     * @param {ContentItem[]} data
     */
    async renderContent(data) {
      if (!Array.isArray(data)) throw new Error('[Content] data must be array');
      _ensureCss();

      const ctr = document.getElementById(CONFIG.DOM.CONTENT_LOADING_ID);
      if (!ctr) return;

      await this.clearContent();
      const sess = _sess;

      try {
        // Ensure URE is ready before anything else
        await _ensureURE();
        if (sess !== _sess) return;

        const lang = localStorage.getItem('selectedLang') || 'en';

        // Pre-warm the API index once; all button text lookups below are then O(1)
        await M.DataService.loadApiDatabase().catch(() => {});
        if (sess !== _sess) return;

        const groups = await this._resolveGroups(data, lang);
        if (sess !== _sess) return;

        // Hide loading overlay before mounting URE
        try { M.LoadingService?.hide(); } catch (_) {}

        _ureHandle = window.URE.mount({
          container        : ctr,
          data             : groups,
          keyField         : '_ureKey',
          // estimatedItemHeight: URE's ResizeObserver corrects this immediately;
          // 160px is a reasonable middle-ground between btn-groups (~80px) and
          // card-groups (~260px) to minimize initial layout shift.
          estimatedItemHeight: 160,
          buffer           : 600,
          recycling        : true,
          template         : (group, l) => this._tplGroup(group, l),
          onItemClick      : (e, group) => this._onClick(e, group),
        });

      } catch (e) {
        console.error('[NavCore/Content] renderContent error:', e);
        try { M.LoadingService?.hide(); } catch (_) {}
      }
    },

    // ── Data resolution pipeline ────────────────────────────────────────────
    // Converts raw ContentItem[] → flat GroupRecord[] that URE can iterate.
    // All async work (DB, jsonFile, categoryId) is done here so the template
    // function can be synchronous.

    /**
     * @param {ContentItem[]} data
     * @param {string} lang
     * @returns {Promise<GroupRecord[]>}
     */
    async _resolveGroups(data, lang) {
      const out = [];
      let k = 0;

      for (const item of data) {
        if (!item) continue;

        // ── jsonFile reference ───────────────────────────────────────────
        if (item.jsonFile && !item._fetched) {
          try {
            const res = await M.DataService.fetchWithRetry(item.jsonFile, {}, 3);
            const arr = Array.isArray(res) ? res : [res];
            // Mark _fetched to prevent infinite recursion
            const sub = await this._resolveGroups(arr.map(r => ({ ...r, _fetched: true })), lang);
            for (const g of sub) { g._ureKey = `k${k++}`; out.push(g); }
          } catch (e) { console.error('[Content] jsonFile fetch error:', e); }
          continue;
        }

        // ── Group or category shorthand ──────────────────────────────────
        if (item.group || item.categoryId) {
          const grpCfg = item.group || { categoryId: item.categoryId, type: item.type || 'button' };
          const resolved = await this._resolveGroup(grpCfg, lang);
          if (resolved) { resolved._ureKey = `k${k++}`; out.push(resolved); }
          continue;
        }

        // ── Single item → wrap in a 1-item group ─────────────────────────
        const isCard = this._isCardItem(item);
        const ri = await this._resolveItem(item, lang, isCard);
        if (ri) {
          out.push({
            _ureKey  : `k${k++}`,
            _ureType : isCard ? 'card-group' : 'btn-group',
            header   : null,
            items    : [ri],
          });
        }
      }

      return out;
    },

    /**
     * Resolve a group descriptor (categoryId or inline items[]) into a GroupRecord.
     * @param {object} grp
     * @param {string} lang
     * @returns {Promise<GroupRecord|null>}
     */
    async _resolveGroup(grp, lang) {
      const isCard = grp.type === 'card';

      if (grp.categoryId) {
        try {
          const { data, header } = await M.DataService.fetchCategoryGroup(grp.categoryId);
          const items = (await Promise.all(
            data.map(d => this._resolveItem(d, lang, isCard))
          )).filter(Boolean);
          return { _ureType: isCard ? 'card-group' : 'btn-group', header: header || null, items };
        } catch (e) {
          console.error('[Content] categoryId resolve error:', e);
          return null;
        }
      }

      if (Array.isArray(grp.items)) {
        const items = (await Promise.all(
          grp.items.map(d => this._resolveItem(d, lang, isCard))
        )).filter(Boolean);
        return { _ureType: isCard ? 'card-group' : 'btn-group', header: grp.header || null, items };
      }

      return null;
    },

    /**
     * Resolve a single data item into a renderable record.
     * For buttons: text is resolved from the shared API index (O(1) after loadApiDatabase).
     * For cards: raw title/description are kept as-is so the template can localise them.
     * @param {ContentItem} item
     * @param {string}      lang
     * @param {boolean}     [forceCard=false]
     * @returns {Promise<object|null>}
     */
    async _resolveItem(item, lang, forceCard = false) {
      const isCard = forceCard || this._isCardItem(item);

      if (isCard) {
        return {
          _type      : 'card',
          image      : item.image      || null,
          imageAlt   : item.imageAlt,          // kept raw for lang resolution in template
          title      : item.title || item.name, // kept raw
          description: item.description,        // kept raw
          link       : item.link     || null,
          className  : item.className || null,
        };
      }

      // Button — resolve text from shared index (synchronous after warmup)
      let text = '', api = item.api || null;
      try {
        if (api) {
          const node = M.DataService._sharedIndex?.apiMap?.get(api);
          text = node?.text || api;
        } else {
          text = item.content || item.text || '';
        }
      } catch (_) {
        text = item.text || item.api || '?';
      }

      if (!text) return null;
      return { _type: 'button', text, api, name: item.name || api || '' };
    },

    /** @param {ContentItem} item @returns {boolean} */
    _isCardItem(item) {
      return item.type === 'card'
        || item.group?.type === 'card'
        || (!!item.image && !item.api);
    },

    // ── HTML templates ──────────────────────────────────────────────────────
    // These are called synchronously by URE on every render/recycle.
    // All CSS class names are identical to the original ContentService.

    /**
     * Render a full group (header + items) inside the standard container div.
     * @param {GroupRecord} group
     * @param {string}      lang
     * @returns {string} HTML string
     */
    _tplGroup(group, lang) {
      const isCard = group._ureType === 'card-group';
      const cls    = isCard ? 'card-content-container' : 'button-content-container';
      let html = `<div class="cm-group cm-in"><div class="${cls}">`;
      if (group.header) html += this._tplHeader(group.header, lang);
      for (const item of group.items) {
        html += isCard ? this._tplCard(item, lang) : this._tplBtn(item);
      }
      return html + '</div></div>';
    },

    /** @returns {string} */
    _tplHeader(cfg, lang) {
      if (typeof cfg === 'string') {
        return `<div class="group-header"><h2 class="group-header-text">${_esc(cfg)}</h2></div>`;
      }
      const extraCls = cfg.className ? ` ${_esc(cfg.className)}` : '';
      const title    = _esc(_txt(cfg.title, lang));
      const desc     = cfg.description
        ? `<p class="group-header-description">${_esc(_txt(cfg.description, lang))}</p>`
        : '';
      return `<div class="group-header${extraCls}"><h2 class="group-header-text">${title}</h2>${desc}</div>`;
    },

    /** @returns {string} */
    _tplBtn(item) {
      // data-text / data-api used by _onClick for clipboard copy
      return `<button class="button-content" data-text="${_esc(item.text)}" data-api="${_esc(item.api || '')}">${_esc(item.text)}</button>`;
    },

    /** @returns {string} */
    _tplCard(item, lang) {
      const cls   = item.className ? ` ${_esc(item.className)}` : '';
      const link  = item.link ? ` data-link="${_esc(item.link)}"` : '';
      const title = _esc(_txt(item.title, lang));
      const desc  = _esc(_txt(item.description, lang));
      const alt   = _esc(_txt(item.imageAlt, lang));
      const img   = item.image
        ? `<img class="card-image" src="${_esc(item.image)}" loading="lazy" decoding="async" fetchpriority="low" alt="${alt}">`
        : '';
      return (
        `<div class="card${cls}"${link}>` +
          img +
          `<div class="card-content">` +
            `<div class="card-title">${title}</div>` +
            `<div class="card-description">${desc}</div>` +
          `</div>` +
        `</div>`
      );
    },

    // ── Click delegation ────────────────────────────────────────────────────
    // URE calls this with (event, groupRecord). We then inspect e.target to
    // determine whether a button or a card link was clicked.

    _onClick(e, _group) {
      // Button copy
      const btn = e.target.closest('.button-content');
      if (btn) {
        const text = btn.dataset.text;
        const api  = btn.dataset.api || null;
        try {
          const p = window.unifiedCopyToClipboard?.({ text, api, type: 'button', name: api || '' });
          p?.catch?.(() => M.Utils?.showNotification('Copy failed', 'error'));
        } catch (_) {
          M.Utils?.showNotification('Copy failed', 'error');
        }
        return;
      }

      // Card link
      const card = e.target.closest('.card[data-link]');
      if (card) window.open(card.dataset.link, '_blank', 'noopener,noreferrer');
    },

    // ── Language update ─────────────────────────────────────────────────────
    // Called by init.js on 'languageChange' event.
    // URE re-renders all visible items immediately via setLang().

    /** @param {string} lang */
    updateCardsLanguage(lang) {
      if (_ureHandle) try { _ureHandle.setLang(lang); } catch (_) {}
    },

    // ── Backward-compat stubs ───────────────────────────────────────────────
    // These were used by external scripts in the previous version.
    // They're no-ops now but preserved so nothing breaks.

    createContainer()           { return document.createElement('div'); },
    async createButton()        { return document.createElement('button'); },
    async createCard()          { return document.createElement('div'); },
    async renderGroupItems()    {},
    async renderSingleItem()    {},
  };

  // ── Export ────────────────────────────────────────────────────────────────

  M.ContentService = ContentService;

})(window.NavCoreModules = window.NavCoreModules || {});