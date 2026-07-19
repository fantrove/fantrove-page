// Path:    assets/js/nav-core-modules/content.js
// Purpose: ContentService — renders content items (buttons, cards, source groups) via URE
//          + renderFeed() สำหรับ All button: infinite scroll, delegated click, memory-safe
// Used by: router.js (renderContent, renderFeed), init.js (updateCardsLanguage)

// @ts-check
/**
 * @file content.js
 * ContentService — URE-powered rendering + native infinite-scroll feed
 *                        + lazy paginated rendering สำหรับ source-based routes.
 *
 * Feed render path (renderFeed):
 *   - native DOM append แทน URE → รองรับ infinite scroll ได้โดยไม่ re-mount
 *   - IntersectionObserver (rootMargin 600px) preload ก่อนถึง bottom
 *   - content-visibility:auto บน .feed-page → browser discard off-screen rendering
 *   - delegated click บน #content-loading → copy + card open ทำงานเหมือนกัน
 *   - clearContent() disconnect observer → ไม่มี memory leak
 *   - state preservation: snapshot/restore ผ่าน RouteCache (X-style)
 *
 * Lazy render path (renderContentLazy):
 *   - ใช้สำหรับ route ที่ระบุ source (Symbols/Emojis/Fancy ฯลฯ)
 *   - ทยอย fetch categories ทีละหน้าผ่าน SourcePaginator
 *   - ใช้ IntersectionObserver เหมือน feed → scroll กดเพิ่ม category ถัดไป
 *   - แทนที่ renderContent() แบบเดิมที่ Promise.all fetch ทุก category ทีเดียว
 *   - state preservation: เก็บ DOM + paginator state + scroll ผ่าน RouteCache
 *
 * Feed page sizes:
 *   FEED_FIRST_PAGE_SIZE = 10 segments × 20 items = 200 items on first paint
 *   FEED_PAGE_SIZE       = 12 segments × 20 items = 240 items per scroll load
 *
 * @module content
 * @depends {config.js, state.js, data.js, loading.js, feed.js, paginator.js, route-cache.js}
 */
(function (M) {
  'use strict';

  const { CONFIG } = M;

  const _esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const _txt = (v, l) => !v ? '' : typeof v === 'object' ? (v[l] || v.en || '') : String(v);

  const BTN_ROW_SIZE = 10;

  const LAYOUT = Object.freeze({ BUTTON: 'button', CARD: 'card' });

  function _toLayout(val) {
    if (val === 'cards' || val === 'card') return LAYOUT.CARD;
    return LAYOUT.BUTTON;
  }

  // ── Feed constants ─────────────────────────────────────────────────────────────
  const FEED_SENTINEL_ID     = 'nc-feed-sentinel';
  // WHY 10/12: FeedService ส่ง segment ละ 20 items
  //   10 segments × 20 = 200 items on first paint  → ผู้ใช้เห็น content เยอะตั้งแต่ load แรก
  //   12 segments × 20 = 240 items ต่อ scroll load → scroll ได้ smooth ไม่ต้องรอบ่อย
  const FEED_FIRST_PAGE_SIZE = 10;
  const FEED_PAGE_SIZE       = 12;

  // ── CSS ────────────────────────────────────────────────────────────────────────

  const _CSS_ID = '_nc_content_css';
  function _ensureCss() {
    if (document.getElementById(_CSS_ID)) return;
    const s = document.createElement('style');
    s.id = _CSS_ID;
    s.textContent = `
.cm-group{contain:layout style;isolation:isolate;}

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

  const _FEED_CSS_ID = '_nc_feed_css';
  function _ensureFeedCss() {
    if (document.getElementById(_FEED_CSS_ID)) return;
    const s = document.createElement('style');
    s.id = _FEED_CSS_ID;
    // WHY content-visibility:auto:
    //   browser discard rendering + layout ของ .feed-page ที่อยู่นอก viewport
    //   ทำให้มี DOM 400+ pages โดยไม่กินแรง GPU/memory มากเกินไป
    //
    // v2.2 — Height caching ที่แม่นยำขึ้น:
    //   ก่อนหน้านี้: contain-intrinsic-block-size: 800px (ค่าคงที่)
    //     → แต่ละ .feed-page จอง 800px เสมอ แม้เนื้อหาจริงจะต่ำกว่า (เช่น 300px)
    //     → เกิด "ช่องว่าง" ระหว่างกลุ่มเนื้อหาที่ user เห็นชัด (ปัญหาเรื้อรัง)
    //     → ยิ่งหมวดเล็ก (20 items) ยิ่งเห็นช่องว่างมาก เพราะจอง 800px แต่ใช้จริง ~210px
    //
    //   ตอนนี้: contain-intrinsic-block-size: auto 300px
    //     → `auto` = browser จำความสูงจริงหลัง render ครั้งแรก แล้วใช้ค่านั้นเป็น placeholder
    //        ทำให้ scrollbar height ใกล้เคียงความจริง ลด layout shift ขณะ scroll
    //     → `300px` = fallback สำหรับ render ครั้งแรก (ก่อน browser จำค่าจริงได้)
    //        300px สมเหตุสมผลสำหรับ category เล็ก (header 50px + 2 rows × ~125px)
    //     → รองรับ browser สมัยใหม่ (Chrome 95+, Firefox 101+, Safari 17+)
    //
    //   ผลกระทบต่อ SPA:
    //     การ navigation ระหว่าง route → clearContent() ล้าง .feed-page เดิม
    //     → new route สร้าง .feed-page ใหม่ → เริ่มจาก fallback 300px
    //     → หลัง render แรก browser จำความสูงจริง → scroll ถัดไปใช้ค่าจริง
    //     → ลด "jumping scrollbar" ที่เคยเกิดจาก 800px → actual size
    s.textContent = `
.feed-page{
  content-visibility: auto;
  contain-intrinsic-block-size: auto 300px;
}
#${FEED_SENTINEL_ID}{
  height: 1px;
  width: 100%;
  pointer-events: none;
}`;
    document.head.appendChild(s);
  }

  // ── URE dependency guard ───────────────────────────────────────────────────────

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

  // ── Module state ───────────────────────────────────────────────────────────────

  let _ureHandle    = null;
  let _feedObserver = null;
  let _sess         = 0;

  // ── Active route tracking (for state preservation) ────────────────────────────
  // WHY: เก็บ routeKey ปัจจุบันเพื่อให้ router.js สามารถ trigger save ก่อน navigate-away
  //   และเรียก restore เมื่อกลับมา route เดิม
  let _activeRouteKey   = null;
  let _activeRouteKind  = null; // 'feed' | 'lazy' | 'ure'

  // ── ContentService ─────────────────────────────────────────────────────────────

  const ContentService = {

    LOADING_CONTAINER_ID: CONFIG.DOM.CONTENT_LOADING_ID,

    // ── clearContent ────────────────────────────────────────────────────────────

    async clearContent() {
      _sess++;

      // WHY disconnect ก่อน destroy: ป้องกัน observer fire ระหว่าง DOM clear
      if (_feedObserver) {
        _feedObserver.disconnect();
        _feedObserver = null;
      }

      if (_ureHandle) {
        try { _ureHandle.destroy(); } catch (err) { console.warn('[Content] URE destroy failed:', err); }
        _ureHandle = null;
      }

      const ctr = document.getElementById(CONFIG.DOM.CONTENT_LOADING_ID);
      if (ctr) ctr.innerHTML = '';
    },

    // ── renderContent (URE path — ใช้กับ route ทั่วไป) ──────────────────────────

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
        await M.DataService.loadApiDatabase().catch(err => {
          console.warn('[Content] loadApiDatabase failed, continuing:', err);
        });
        if (sess !== _sess) return;

        const items = await this._resolveAll(data, lang);
        if (sess !== _sess) return;

        // v4: Render content ก่อน แล้วค่อยซ่อน loading
        // WHY: ถ้าซ่อน loading ก่อน → ผู้ใช้เห็นหน้าว่างช่วงระหว่าง fade-out กับ render
        //   เหมือน Google/Microsoft — content พร้อมก่อน ถึงจะซ่อน overlay
        //   v4: This is the "render behind overlay" pattern (Netflix/Spotify).
        //     Content is mounted under the overlay, then hideInstant()
        //     waits 1 rAF for paint before removing the overlay.
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
      } finally {
        // v4: hideInstant — overlay will be removed after 1 rAF so the
        //   just-mounted content paints underneath first.
        //   This is the "render behind overlay" pattern.
        try { M.LoadingService?.hideInstant(); } catch (_) {}
      }
    },

    // ── renderFeed (All button — infinite scroll, native DOM) ────────────────────

    /**
     * Render smart infinite feed สำหรับ "All" button.
     *
     * v2 — state preservation (X-style):
     *   • ถ้ามี cache ของ route นี้ใน RouteCache → restore DOM + FeedService state
     *     + scroll position + re-attach observer (skip first page fetch)
     *   • ถ้าไม่มี cache → render ใหม่จากศูนย์ (เหมือน v1)
     *   • router.js จะเรียก saveActiveRoute() ก่อน navigate ออก → state ถูกเก็บใน RouteCache
     *
     * ทำไมไม่ใช้ URE:
     *   URE mount ครั้งเดียว ถ้าจะ append ต้องรู้ internal API
     *   feed ใช้ IntersectionObserver + DOM append แทน
     *   ทำให้ append ได้ไม่จำกัดโดยไม่ต้อง re-mount (ไม่มี scroll jump)
     *
     * Memory safety:
     *   .feed-page ใช้ content-visibility:auto → off-screen pages ไม่ render
     *   MAX_ROUNDS ใน FeedService จำกัด total emit
     *   clearContent() disconnect observer ก่อน clear DOM เสมอ
     *
     * @param {string} lang
     * @param {string} [routeKey]  key สำหรับ RouteCache (default '_all')
     */
    async renderFeed(lang, routeKey = '_all') {
      _ensureCss();
      _ensureFeedCss();

      const ctr = document.getElementById(CONFIG.DOM.CONTENT_LOADING_ID);
      if (!ctr) return;

      _activeRouteKey  = routeKey;
      _activeRouteKind = 'feed';

      // ── v2: ลอง restore จาก RouteCache ก่อน ────────────────────────────────
      const cached = M.RouteCache?.get?.(routeKey);
      if (cached && cached.routeKind === 'feed'
          && cached.domSnapshot
          && M.FeedService.canResume?.()) {

        // restore DOM (clone snapshot ลง container)
        M.RouteCache.restoreDom(ctr, cached.domSnapshot);
        // restore FeedService state
        M.FeedService.restore?.(cached.feedState);

        // re-attach delegated click + observer
        this._ensureFeedClickDelegate(ctr);

        // รอ 1 rAF ให้ browser paint ก่อน hide overlay (render-behind-overlay pattern)
        try { M.LoadingService?.hideInstant(); } catch (_) {}

        // restore scroll position (ใน frame ถัดไปเพื่อให้ DOM paint เสร็จ)
        const savedScroll = cached.scrollPosition || 0;
        requestAnimationFrame(() => {
          try { window.scrollTo({ top: savedScroll, behavior: 'instant' }); }
          catch (_) { window.scrollTo(0, savedScroll); }
        });

        // re-attach observer ถ้ายังมี content ให้โหลดต่อ
        if (cached.hasMore) {
          this._attachFeedSentinel(ctr, lang, _sess);
        }
        return;
      }

      // ── v1 path: ไม่มี cache → render ใหม่จากศูนย์ ─────────────────────────
      // WHY reset ก่อน clearContent: FeedService.reset() ต้องเรียกก่อน
      //   เพื่อให้ _ensureInit() ใน loadNextPage() สร้าง segments ใหม่ได้ถูกต้อง
      M.FeedService.reset();
      await this.clearContent();
      const sess = _sess;

      try {
        await M.DataService.loadApiDatabase().catch(err => {
          console.warn('[Content] renderFeed: loadApiDatabase failed:', err);
        });
        if (sess !== _sess) return;

        // Delegated click — attach ครั้งเดียว ตลอดอายุ ctr element
        this._ensureFeedClickDelegate(ctr);

        // ── First page ─────────────────────────────────────────────────────────
        const { groups: firstGroups, hasMore } =
          await M.FeedService.loadNextPage(lang, FEED_FIRST_PAGE_SIZE);
        if (sess !== _sess) return;

        if (firstGroups.length) {
          await this._appendFeedGroups(ctr, firstGroups, lang, null);
        }

        // v3: ซ่อน loading หลัง content แสดงผลแล้วเท่านั้น
        // WHY: ถ้าซ่อนก่อน render → ผู้ใช้เห็นหน้าว่าง 180ms+ (blank flash)
        //   ตอนนี้ content render เสร็จแล้ว → ซ่อน loading ทันที
        //   ใช้ hideInstant() — ลบ DOM ทันที เหมือน Google/Microsoft
        //   v4: hideInstant จะรอ 1 rAF ให้ browser paint content ก่อน remove overlay
        //     → render-behind-overlay pattern (Netflix/Spotify)
        try { M.LoadingService?.hideInstant(); } catch (_) {}

        if (sess !== _sess) return;

        if (hasMore) {
          this._attachFeedSentinel(ctr, lang, sess);
        }

      } catch (e) {
        console.error('[NavCore/Content] renderFeed error:', e);
        try { M.LoadingService?.hide(); } catch (_) {}
      }
    },

    // ── renderContentLazy (source-based routes — lazy paginated) ───────────────
    //
    // ใช้สำหรับ route ที่ระบุ source เช่น Symbols/Emojis/Fancy
    //   แทนที่ renderContent() สำหรับกรณี data = [{ source: 'symbol' }, ...]
    //   ทำงานเหมือน renderFeed แต่ใช้ SourcePaginator แทน FeedService
    //
    // WHY แยกจาก renderContent:
    //   renderContent ต้อง resolve ทุก categories ทีเดียวก่อน mount URE → ไม่ lazy
    //   renderContentLazy ทยอย fetch category ทีละหน้าผ่าน paginator
    //   ใช้ IntersectionObserver เหมือน feed → scroll เพิ่ม → load category ถัดไป
    //
    // @param {Array}  data      array of source descriptors: [{ source, as, only }]
    // @param {string} lang
    // @param {string} routeKey  key สำหรับ RouteCache
    async renderContentLazy(data, lang, routeKey) {
      _ensureCss();
      _ensureFeedCss();

      const ctr = document.getElementById(CONFIG.DOM.CONTENT_LOADING_ID);
      if (!ctr) return;

      _activeRouteKey  = routeKey;
      _activeRouteKind = 'lazy';

      // ── ลอง restore จาก RouteCache ก่อน ───────────────────────────────────
      const cached = M.RouteCache?.get?.(routeKey);
      if (cached && cached.routeKind === 'lazy'
          && cached.domSnapshot
          && cached.paginatorState) {

        // restore DOM
        M.RouteCache.restoreDom(ctr, cached.domSnapshot);
        // restore paginator state
        M.SourcePaginator?.restore?.(cached.paginatorState);

        // re-attach delegated click + observer
        this._ensureFeedClickDelegate(ctr);

        try { M.LoadingService?.hideInstant(); } catch (_) {}

        // restore scroll position
        const savedScroll = cached.scrollPosition || 0;
        requestAnimationFrame(() => {
          try { window.scrollTo({ top: savedScroll, behavior: 'instant' }); }
          catch (_) { window.scrollTo(0, savedScroll); }
        });

        // re-attach observer ถ้ายังมี content ให้โหลดต่อ
        if (cached.hasMore) {
          this._attachLazySentinel(ctr, lang, _sess);
        }
        return;
      }

      // ── ไม่มี cache → render ใหม่ ───────────────────────────────────────────
      await this.clearContent();
      const sess = _sess;

      try {
        await M.DataService.loadApiDatabase().catch(err => {
          console.warn('[Content] renderContentLazy: loadApiDatabase failed:', err);
        });
        if (sess !== _sess) return;

        // Delegated click — attach ครั้งเดียว
        this._ensureFeedClickDelegate(ctr);

        // ── Initialize paginator สำหรับ source descriptor ตัวแรกที่เจอ ──────
        // WHY ใช้แค่ตัวแรก: ปัจจุบัน source descriptors มักมีแค่ตัวเดียว
        //   เช่น symbols.json = [{ source: 'symbol' }]
        //   ถ้ามีหลาย source ในอนาคต ต้องปรับให้ paginator รองรับหลาย source
        const sourceDesc = data.find(d => d && d.source);
        if (!sourceDesc) {
          // ไม่ใช่ source-based → fallback ไป renderContent แบบเดิม
          await this.renderContent(data);
          return;
        }

        const layout = sourceDesc.as === 'cards' || sourceDesc.as === 'card'
          ? 'card' : 'button';
        const filter = Array.isArray(sourceDesc.only) ? sourceDesc.only : null;

        // reset paginator ก่อน init (clear state เดิม)
        M.SourcePaginator?.reset?.();
        await M.SourcePaginator.init(sourceDesc.source, layout, filter);
        if (sess !== _sess) return;

        // ── First page ─────────────────────────────────────────────────────────
        const { groups: firstGroups, hasMore } =
          await M.SourcePaginator.loadNextPage(lang, M.SourcePaginator.FIRST_PAGE_SIZE);
        if (sess !== _sess) return;

        if (firstGroups.length) {
          await this._appendFeedGroups(ctr, firstGroups, lang, null);
        }

        try { M.LoadingService?.hideInstant(); } catch (_) {}

        if (sess !== _sess) return;

        if (hasMore) {
          this._attachLazySentinel(ctr, lang, sess);
        }

      } catch (e) {
        console.error('[NavCore/Content] renderContentLazy error:', e);
        try { M.LoadingService?.hide(); } catch (_) {}
      }
    },

    /**
     * Sentinel สำหรับ lazy paginator — คล้าย _attachFeedSentinel แต่เรียก
     * SourcePaginator.loadNextPage แทน FeedService.loadNextPage
     */
    _attachLazySentinel(ctr, lang, sess) {
      if (_feedObserver) { _feedObserver.disconnect(); _feedObserver = null; }

      const sentinel = document.createElement('div');
      sentinel.id    = FEED_SENTINEL_ID;
      sentinel.setAttribute('aria-hidden', 'true');
      ctr.appendChild(sentinel);

      let _loading = false;

      _feedObserver = new IntersectionObserver(async entries => {
        if (!entries[0].isIntersecting || _loading) return;

        if (sess !== _sess) {
          _feedObserver?.disconnect();
          _feedObserver = null;
          return;
        }

        _loading = true;
        try {
          const { groups, hasMore } =
            await M.SourcePaginator.loadNextPage(lang, M.SourcePaginator.PAGE_SIZE);

          if (sess !== _sess) return;

          if (groups.length) {
            await this._appendFeedGroups(ctr, groups, lang, sentinel);
          }

          if (!hasMore) {
            _feedObserver?.disconnect();
            _feedObserver = null;
            sentinel.remove();
          }
        } catch (e) {
          console.error('[NavCore/Content] lazy loadMore error:', e);
        } finally {
          _loading = false;
        }
      }, {
        rootMargin: '600px',
        threshold:  0,
      });

      _feedObserver.observe(sentinel);
    },

    /**
     * Resolve groups → render HTML → append เป็น .feed-page div.
     * ใช้ _resolveAll + _tpl เหมือน URE path → HTML classes เหมือนกันทุกอย่าง
     * รองรับทั้ง button group และ card group จาก FeedService
     *
     * @param {HTMLElement}      ctr
     * @param {Array}            groups    group descriptors จาก FeedService
     * @param {string}           lang
     * @param {HTMLElement|null} sentinel  insertBefore ถ้ามี, append ถ้าไม่มี
     */
    async _appendFeedGroups(ctr, groups, lang, sentinel) {
      if (!groups.length) return;

      const resolvedItems = await this._resolveAll(groups, lang);
      if (!resolvedItems.length) return;

      const page     = document.createElement('div');
      page.className = 'feed-page';

      // WHY สร้าง HTML string ก่อนแล้ว set innerHTML ครั้งเดียว:
      //   ลด DOM mutation ให้น้อยที่สุด — browser parse + build subtree ครั้งเดียว
      //   ดีกว่า append element ทีละอัน (หลาย reflow)
      let html = '';
      for (const item of resolvedItems) html += this._tpl(item, lang);
      page.innerHTML = html;

      if (sentinel && sentinel.parentNode === ctr) {
        ctr.insertBefore(page, sentinel);
      } else {
        ctr.appendChild(page);
      }
    },

    /**
     * Attach sentinel div + IntersectionObserver สำหรับ infinite scroll.
     * rootMargin 600px: preload content ก่อน scroll ถึง bottom 600px
     * → ไม่มี "หยุดรอ" แม้ scroll เร็วบน mobile
     *
     * @param {HTMLElement} ctr
     * @param {string}      lang
     * @param {number}      sess  session snapshot — ยกเลิกถ้า navigate ออก
     */
    _attachFeedSentinel(ctr, lang, sess) {
      if (_feedObserver) { _feedObserver.disconnect(); _feedObserver = null; }

      const sentinel = document.createElement('div');
      sentinel.id    = FEED_SENTINEL_ID;
      sentinel.setAttribute('aria-hidden', 'true');
      ctr.appendChild(sentinel);

      // WHY _loading flag: ป้องกัน double-trigger ถ้า observer fires ซ้อนกัน
      //   (เช่น scroll เร็วมาก ทำให้ sentinel อยู่ใน viewport นานพอให้ fire ซ้ำ)
      let _loading = false;

      _feedObserver = new IntersectionObserver(async entries => {
        if (!entries[0].isIntersecting || _loading) return;

        // ตรวจ session ก่อน — ถ้า navigate ออกแล้ว ไม่ต้องทำอะไร
        if (sess !== _sess) {
          _feedObserver?.disconnect();
          _feedObserver = null;
          return;
        }

        _loading = true;
        try {
          const { groups, hasMore } = await M.FeedService.loadNextPage(lang, FEED_PAGE_SIZE);

          if (sess !== _sess) return; // ตรวจซ้ำหลัง async

          if (groups.length) {
            await this._appendFeedGroups(ctr, groups, lang, sentinel);
          }

          if (!hasMore) {
            // ครบ MAX_ROUNDS แล้ว — หยุด observe, ลบ sentinel
            _feedObserver?.disconnect();
            _feedObserver = null;
            sentinel.remove();
          }
          // ถ้ายัง hasMore: sentinel ยังอยู่ที่เดิม (ท้ายสุดของ ctr)
          // observer จะ fire อีกครั้งเมื่อ scroll ถึง

        } catch (e) {
          console.error('[NavCore/Content] feed loadMore error:', e);
        } finally {
          _loading = false;
        }
      }, {
        rootMargin: '600px',
        threshold:  0,
      });

      _feedObserver.observe(sentinel);
    },

    /**
     * Attach delegated click handler บน ctr ครั้งเดียวตลอดอายุ element.
     * WHY: feed groups เป็น plain HTML นอก URE
     *   click bubble ขึ้น ctr → _onClick จัดการ copy + card open
     *   ไม่ re-attach หลัง clearContent เพราะ ctr element ยังเป็นตัวเดิม
     *   listener ยังคงอยู่บน element เดิม ไม่หาย
     */
    _ensureFeedClickDelegate(ctr) {
      if (ctr._feedClickDelegated) return;
      ctr.addEventListener('click', e => this._onClick(e));
      ctr._feedClickDelegated = true;
    },

    // ── Resolution ──────────────────────────────────────────────────────────────

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

        if (item.source) {
          const descriptor = item.as ? { ...item, layout: _toLayout(item.as) } : item;
          const groups = await this._resolveSource(descriptor, lang);
          groups.forEach(g => this._emit(g, k, out));
          continue;
        }

        if (item.category) {
          const asLayout = _toLayout(item.as || item.layout);
          const cfg = {
            categoryId: item.category,
            typeId:     item.type || null,
            type:       asLayout === LAYOUT.CARD ? 'card' : 'button',
            layout:     item.horizontal ? 'horizontal' : undefined,
          };
          const resolved = await this._resolveGroup(cfg, lang);
          if (resolved) this._emit(resolved, k, out);
          continue;
        }

        if (item.group || item.categoryId) {
          const cfg      = item.group || { categoryId: item.categoryId, type: item.type || 'button' };
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

    async _resolveSource(item, lang) {
      const { source, layout = LAYOUT.BUTTON, only: filter = null } = item;
      if (!source) return [];

      const cats = await M.DataService.getTypeCategories(source);
      if (!cats || !cats.length) return [];

      const filtered = filter
        ? cats.filter(c => filter.includes(c.id))
        : cats;

      const groups = await Promise.all(
        filtered.map(cat => this._fetchSourceGroup(cat, layout, lang))
      );
      return groups.filter(Boolean);
    },

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
          const fetchFn = cfg.typeId
            ? () => M.DataService.fetchCategoryDirect(cfg.typeId, cfg.categoryId)
            : () => M.DataService.fetchCategoryGroup(cfg.categoryId);
          const { data, header } = await fetchFn();
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
          _type      : 'card',
          image      : item.image      || null,
          imageAlt   : item.imageAlt,
          title      : item.title      || item.name,
          description: item.description,
          link       : item.link       || null,
          className  : item.className  || null,
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

    // WHY: card item จาก collection มี api field (เช่น 'card-openai')
    //   แต่ก็มี image field ด้วย — ตรวจ group type ก่อน (forceCard จาก caller)
    //   ตรงนี้ใช้เป็น fallback สำหรับ item เดี่ยวที่ไม่มี group context
    _isCard: item =>
      item.type === 'card' || item.group?.type === 'card' || (!!item.image && !item.api),

    // ── Emit ──────────────────────────────────────────────────────────────────────

    _emit(group, k, out) {
      if (group._ureType === 'card-group' || group._ureType === 'card-group-h') {
        out.push({ ...group, _ureKey: `k${k.v++}` });
        return;
      }
      // btn-group → แบ่งเป็น btn-row (BTN_ROW_SIZE items ต่อ row)
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

    // ── Templates ──────────────────────────────────────────────────────────────────

    _tpl(item, lang) {
      switch (item._ureType) {
        case 'card-group':   return this._tplCardGroup(item, lang);
        case 'card-group-h': return this._tplCardGroupH(item, lang);
        default:             return this._tplBtnRow(item, lang);
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

    // ── Click delegation ────────────────────────────────────────────────────────────

    _onClick(e) {
      const btn = e.target.closest('.button-content');
      if (btn) {
        try {
          window.unifiedCopyToClipboard?.({
            text: btn.dataset.text,
            api:  btn.dataset.api || null,
            type: 'button',
            name: btn.dataset.api || '',
          })?.catch?.(() => M.Utils?.showNotification('Copy failed', 'error'));
        } catch (err) { console.warn('[Content] copy failed:', err); }
        return;
      }
      const card = e.target.closest('.card[data-link]');
      if (card) window.open(card.dataset.link, '_blank', 'noopener,noreferrer');
    },

    updateCardsLanguage(lang) {
      if (_ureHandle) try { _ureHandle.setLang(lang); } catch (err) { console.warn('[Content] setLang failed:', err); }
    },

    // ── State preservation (called by router.js before navigate-away) ──────────
    //
    // saveActiveRoute: snapshot DOM + scroll + service state ลง RouteCache
    //   ต้องเรียกก่อน clearContent() — ไม่งั้น DOM หาย
    //
    // @returns {boolean} true ถ้า save สำเร็จ
    saveActiveRoute() {
      if (!_activeRouteKey || !M.RouteCache) return false;

      const ctr = document.getElementById(CONFIG.DOM.CONTENT_LOADING_ID);
      if (!ctr || !ctr.childNodes.length) return false;

      const domSnapshot = M.RouteCache.snapshotDom(ctr);
      if (!domSnapshot) return false;

      const scrollPosition = window.pageYOffset || 0;

      /** @type {any} */
      const partial = {
        domSnapshot,
        scrollPosition,
        routeKind: _activeRouteKind || 'ure',
        hasMore:   false,
      };

      // ดึง state จาก service ที่เกี่ยวข้อง
      if (_activeRouteKind === 'feed') {
        partial.feedState = M.FeedService?.snapshot?.() || null;
        // hasMore: ถ้า FeedService ยังไม่ exhausted → ยังโหลดได้
        partial.hasMore = !!(M.FeedService?._isExhausted === false
                             && M.FeedService?._unseenPool?.length > 0);
      } else if (_activeRouteKind === 'lazy') {
        partial.paginatorState = M.SourcePaginator?.snapshot?.() || null;
        partial.hasMore = !!(partial.paginatorState?.hasMore);
      }

      M.RouteCache.save(_activeRouteKey, partial);
      return true;
    },

    /**
     * Clear active route tracking — เรียกเมื่อต้องการ reset (เช่น language change)
     */
    clearActiveRoute() {
      _activeRouteKey  = null;
      _activeRouteKind = null;
    },

    /**
     * Invalidate route cache — เรียกเมื่อ language change หรือ cache reset
     * @param {string} [routeKey]  เฉพาะ route นี้ ถ้าไม่ระบุ = ทั้งหมด
     */
    invalidateRouteCache(routeKey) {
      if (!M.RouteCache) return;
      if (routeKey) M.RouteCache.invalidate(routeKey);
      else M.RouteCache.invalidate();
    },

    createContainer()        { return document.createElement('div'); },
    async createButton()     { return document.createElement('button'); },
    async createCard()       { return document.createElement('div'); },
    async renderGroupItems() {},
    async renderSingleItem() {},
  };

  M.ContentService = ContentService;

})(window.NavCoreModules = window.NavCoreModules || {});