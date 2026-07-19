// Path:    assets/js/nav-core-modules/paginator.js
// Purpose: SourcePaginator — incremental category streamer for source-based routes
//          (Symbols, Emojis, Fancy, etc.) แบบเดียวกับที่ FeedService ทำ แต่เรียงตามลำดับ
//          category ใน index ไม่ใช่ algorithmic ranking
//
// Used by: content.js (renderContentLazy → loadNextPage)
//
// Design:
//   - init(source, filter) โหลด category list จาก DataService.getTypeCategories()
//     (lightweight — ไม่ fetch items เลย ดึงแค่ [{id, name}] จาก index)
//   - loadNextPage(lang, n) ทยอย fetch category data ทีละหน้า n categories
//   - ใช้ cache จาก DataService (เหมือน _fetchSourceGroup เดิม) → fetch ครั้งเดียวใช้ซ้ำได้
//   - state เก็บ cursor + categories list → save/restore ได้ผ่าน RouteCache
//
// ข้อแตกต่างจาก FeedService:
//   - FeedService: algorithmic ranking (UCB1 + diversity + jitter)
//   - SourcePaginator: sequential — เรียงตาม category order ใน index
//   - เหมาะกับ route เฉพาะ type (เช่น Symbols) ที่ user คาดหวัง order คงที่
//
// v2.2 — Dynamic first page + ลบ sub-chunking:
//   • FIRST_PAGE_SIZE คำนวณจาก viewport height แบบ dynamic (2–6 categories)
//     ทำให้ first paint เพียงพอเติม viewport บนจอใหญ่ → sentinel อยู่ล่าง viewport
//     → observer ไม่ fire ทันที → user scroll ได้ก่อน แล้วค่อย trigger load ถัดไป
//   • ลบ sub-chunking (MAX_ITEMS_PER_CATEGORY_CHUNK, _loadNextChunk, currentCatId, itemCursor)
//     WHY: sub-chunking แบ่งหมวดใหญ่เป็นก้อน 20 items แต่ละ chunk กลายเป็น group แยก
//          แถวสุดท้ายของแต่ละ chunk มี margin: 0 0 40px (ure-btn-row--last)
//          → ระหว่าง chunk ของหมวดเดียวกันเกิดช่องว่าง 40px (1 แถวว่าง)
//          ซึ่งเป็นปัญหาที่ user รายงานเป็นเวลานาน
//   • ตอนนี้แต่ละ category ถูก render เป็น group เดียวต่อเนื่อง ไม่มีช่องว่างภายใน
//     ส่วน performance ของหมวดใหญ่ (100+ items) อยู่ในมือของ content-visibility: auto
//     บน .feed-page ที่ browser ข้ามการ render ของ off-screen content อยู่แล้ว

// @ts-check
(function (M) {
  'use strict';

  const { CONFIG } = M;

  // ── Paginator constants ────────────────────────────────────────────────────
  // v2.2: FIRST_PAGE_SIZE เป็น dynamic — คำนวณจาก viewport height ที่ runtime
  //   ดู _calcFirstPageSize() ด้านล่าง
  //   ก่อนหน้านี้ FIRST_PAGE_SIZE = 2 (คงที่) → บนจอใหญ่เนื้อหาสั้นเกินไป
  const PC = Object.freeze({
    // Dynamic range สำหรับ first paint (คำนวณจาก viewport)
    //   ต่ำสุด 2: กรณี viewport เล็กมาก (มือถือ landscape)
    //   สูงสุด 6: กรณีจอ desktop ใหญ่ — มากกว่านี้ first paint ช้าเกินไป
    FIRST_PAGE_SIZE_MIN:     2,
    FIRST_PAGE_SIZE_MAX:     6,
    FIRST_PAGE_SIZE_DEFAULT: 3, // fallback ถ้า window ไม่ available

    // Scroll-load ถัดไป — ทยอยทีละ 2 categories
    //   WHY 2: พอให้ scroll ลงมาเจอ content ใหม่ต่อเนื่อง ไม่มากเกินจน render หนัก
    PAGE_SIZE: 2,
  });

  /**
   * คำนวณจำนวน categories สำหรับ first paint ตาม viewport height
   *
   * หลักการ:
   *   - ประมาณความสูงต่อ category = 210px (header ~50px + 2 rows × ~80px)
   *   - ต้องการเติม viewport × 1.5 เพื่อให้ sentinel อยู่ล่าง viewport
   *     → observer ไม่ fire ทันที → user scroll ได้ก่อน
   *   - ระหว่าง MIN-MAX เพื่อกัน extreme cases
   *
   * @returns {number} จำนวน categories สำหรับ first paint
   */
  function _calcFirstPageSize() {
    try {
      const vh = window.innerHeight
        || document.documentElement.clientHeight
        || document.body?.clientHeight
        || 800;
      // WHY 210px: ประมาณการจาก layout จริง
      //   header ~50px + 2 rows × ~80px = ~210px (กรณี category เล็ก 20 items)
      //   ถ้า category ใหญ่กว่า 20 items ความสูงจะมากกว่านี้ → sentinel ไกลลงไปอีก
      //   ซึ่งดี เพราะ user ต้อง scroll มากขึ้นก่อน trigger load ถัดไป
      const estHeightPerCat = 210;
      // WHY 1.5×: ต้องการเนื้อหาเกิน viewport 50% เพื่อให้ sentinel อยู่ล่าง viewport
      //   ถ้าใส่ 1.0× sentinel อาจอยู่ใน viewport ทันที (rootMargin 600px จะ fire)
      const target = Math.ceil((vh * 1.5) / estHeightPerCat);
      return Math.max(PC.FIRST_PAGE_SIZE_MIN, Math.min(PC.FIRST_PAGE_SIZE_MAX, target));
    } catch (_) {
      return PC.FIRST_PAGE_SIZE_DEFAULT;
    }
  }

  /**
   * State shape (can be saved to / restored from RouteCache):
   *   {
   *     source:     string,         // e.g. 'symbol', 'emoji', 'fancy'
   *     layout:     'button'|'card',
   *     filter:     string[]|null,
   *     categories: Array<{id,name}>,
   *     catCursor:  number,         // index ใน categories ที่จะโหลดต่อไป
   *     hasMore:    boolean,
   *   }
   *
   * v2.2: ลบ currentCatId และ itemCursor (sub-chunking fields) ออกจาก state
   *   ถ้า restore จาก cache เก่าที่มี field เหล่านี้ → จะถูก ignore (ไม่ใช้)
   *   ไม่กระทบการทำงานเพราะ code ใหม่ไม่อ้างถึง
   */
  const SourcePaginator = {

    // ── Per-source state map (keyed by source string) ───────────────────────
    // WHY Map: paginator อาจถูกใช้พร้อมกันหลาย source ในอนาคต
    //   (เช่น nested navigation) — ปัจจุบันใช้ทีละ source แต่เก็บเป็น Map ไว้
    _states: new Map(),

    /**
     * Initialize paginator สำหรับ source ใด source หนึ่ง
     * @param {string}        source  typeId เช่น 'symbol', 'emoji', 'fancy'
     * @param {'button'|'card'} layout
     * @param {string[]|null}  filter  เฉพาะ category id เหล่านี้ (optional)
     * @returns {Promise<void>}
     */
    async init(source, layout = 'button', filter = null) {
      if (!source) throw new Error('[Paginator] source required');

      // ถ้ามี state อยู่แล้วและ source + layout เดียวกัน → ไม่ re-init
      const existing = this._states.get(source);
      if (existing && existing.source === source && existing.layout === layout) return;

      const cats = await M.DataService.getTypeCategories(source);
      if (!cats || !cats.length) {
        this._states.set(source, {
          source,
          layout,
          filter,
          categories: [],
          catCursor: 0,
          hasMore: false,
        });
        return;
      }

      const filtered = filter
        ? cats.filter(c => filter.includes(c.id))
        : cats;

      this._states.set(source, {
        source,
        layout,
        filter,
        categories: filtered,
        catCursor: 0,
        hasMore: filtered.length > 0,
      });
    },

    /**
     * Load next page — returns group descriptors เหมือน FeedService.loadNextPage
     *
     * v2.2: ลบ sub-chunking logic ออก — แต่ละ category ถูก load ทั้งหมดในครั้งเดียว
     *   ก่อนหน้านี้: แบ่ง category ใหญ่เป็น chunk 20 items ทำให้เกิดช่องว่างระหว่าง chunk
     *   ตอนนี้: โหลด category เต็ม ๆ ในครั้งเดียว → content-visibility: auto จัดการ render
     *
     * @param {string} lang
     * @param {number} [n]  number of categories to load (default PAGE_SIZE)
     * @returns {Promise<{groups: Array, hasMore: boolean}>}
     */
    async loadNextPage(lang, n = PC.PAGE_SIZE) {
      const st = this._states.values().next().value;
      if (!st) return { groups: [], hasMore: false };

      const groups = [];

      for (let i = 0; i < n; i++) {
        if (!st.hasMore) break;

        if (st.catCursor >= st.categories.length) {
          st.hasMore = false;
          break;
        }

        const cat = st.categories[st.catCursor];
        const group = await this._fetchCategoryGroup(st, cat, lang);
        if (group) {
          // v2.2: ส่งทั้ง group เลย — ไม่ slice เป็น chunk
          //   WHY: content-visibility: auto บน .feed-page ข้าม render off-screen content
          //        อยู่แล้ว → ไม่ต้อง split เพื่อ limit render
          //        และการ split ทำให้เกิดช่องว่าง 40px ระหว่าง chunk (ure-btn-row--last margin)
          groups.push({ group });
          st.catCursor++;
        } else {
          // fetch fail → ข้ามไป category ถัดไป
          st.catCursor++;
          i--; // นับรอบนี้ใหม่
        }
      }

      // อัปเดต hasMore
      st.hasMore = st.catCursor < st.categories.length;

      return { groups, hasMore: st.hasMore };
    },

    /**
     * Fetch category data (delegated to DataService — ใช้ cache ของมัน)
     * ส่งกลับ { type, header, items } เหมือน _fetchSourceGroup ของเดิม
     *
     * v2.2: ไม่มีการ slice items ออกเป็น chunk แล้ว — ส่ง items ทั้งหมดของ category
     */
    async _fetchCategoryGroup(st, cat, lang) {
      try {
        const isCard = st.layout === 'card';
        // WHY fetchCategoryGroup แทน fetchCategoryDirect:
        //   - fetchCategoryGroup ค้นหาผ่าน assembled DB — ใช้กับ copyable types (emoji/symbol/fancy)
        //   - fetchCategoryDirect fetch จาก file — ใช้กับ collection types (cards)
        //   ปัจจุบัน paginator ใช้กับ copyable เป็นหลัก แต่รองรับ card ได้ผ่าน layout param
        const fetchFn = isCard
          ? () => this._fetchCardCategory(cat.id, lang)
          : () => M.DataService.fetchCategoryGroup(cat.id);

        const { data, header } = await fetchFn();
        if (!data || !data.length) return null;

        // resolve items เป็น render-ready format (เหมือน _resolveItem ของ content.js)
        const items = (await Promise.all(
          data.map(d => this._resolveItem(d, lang, isCard))
        )).filter(Boolean);

        if (!items.length) return null;

        return {
          type: isCard ? 'card' : 'button',
          header,
          items,
        };
      } catch (err) {
        console.warn('[Paginator] fetchCategoryGroup failed:', cat.id, err.message);
        return null;
      }
    },

    async _fetchCardCategory(categoryId, lang) {
      // ค้นหา typeId จาก categoryId ผ่าน catToTypeMap
      const idx = M.DataService._sharedIndex;
      const typeObj = idx?.catToTypeMap?.get(categoryId);
      if (!typeObj) {
        // fallback ไป fetchCategoryGroup
        return M.DataService.fetchCategoryGroup(categoryId);
      }
      return M.DataService.fetchCategoryDirect(typeObj.id, categoryId);
    },

    /**
     * Resolve raw item → render-ready object (mirror ContentService._resolveItem)
     * ทำซ้ำที่นี่เพื่อให้ paginator ใช้งานได้แม้ ContentService ยังไม่ ready
     */
    async _resolveItem(item, lang, forceCard = false) {
      if (!item) return null;

      if (forceCard || item.type === 'card' || (!!item.image && !item.api)) {
        return {
          _type:       'card',
          image:       item.image || null,
          imageAlt:    item.imageAlt,
          title:       item.title || item.name,
          description: item.description,
          link:        item.link || null,
          className:   item.className || null,
        };
      }

      const api = item.api || null;
      let text = '';
      try {
        text = api
          ? (M.DataService._sharedIndex?.apiMap?.get(api)?.text || api)
          : (item.content || item.text || '');
      } catch (_) { text = item.text || api || ''; }
      if (!text) return null;
      return { _type: 'button', text, api, name: item.name || api || '' };
    },

    // ── State save/restore (for RouteCache) ───────────────────────────────────

    /**
     * Snapshot state ปัจจุบัน — ใช้บันทึกลง RouteCache
     * @returns {object|null}
     */
    snapshot() {
      const st = this._states.values().next().value;
      if (!st) return null;
      // clone แบบ deep เพื่อกัน mutation
      return JSON.parse(JSON.stringify(st));
    },

    /**
     * Restore state จาก snapshot — ใช้ตอนกลับมาหน้าเดิม
     * @param {object} snap
     */
    restore(snap) {
      if (!snap || !snap.source) return;
      this._states.clear();
      // v2.2: ลบ currentCatId/itemCursor ถ้ามีอยู่ใน snap เก่า (backward compat)
      const clean = { ...snap };
      delete clean.currentCatId;
      delete clean.itemCursor;
      this._states.set(snap.source, JSON.parse(JSON.stringify(clean)));
    },

    /**
     * Reset state ทั้งหมด — เรียกเมื่อเริ่ม render ใหม่จากศูนย์
     */
    reset() {
      this._states.clear();
    },

    /**
     * Invalidate — เรียกเมื่อเปลี่ยนภาษา
     */
    invalidate() {
      // เก็บ cursor ไว้ แค่ clear category list cache (จะ re-fetch ตอน loadNextPage)
      // จริงๆ categories list เป็น id/name ไม่ใช่ content ที่แปล — ไม่ต้อง invalidate
      // แต่ header ใน cache ของ DataService ใช้ lang ตอน fetch → ต้อง clear cache
      try { M.DataService?.clearCache?.(); } catch (_) {}
    },

    // ── Constants exposed for content.js ──────────────────────────────────────
    // v2.2: FIRST_PAGE_SIZE เป็น getter — คำนวณ dynamic ตาม viewport
    //   content.js เรียก M.SourcePaginator.FIRST_PAGE_SIZE ตอน initial load
    //   แต่ละครั้งที่เข้า route จะคำนวณใหม่ตาม viewport ปัจจุบัน
    //   (รองรับ resize / orientation change โดยอัตโนมัติ)
    get FIRST_PAGE_SIZE() { return _calcFirstPageSize(); },
    PAGE_SIZE:            PC.PAGE_SIZE,
  };

  // ── Export ──────────────────────────────────────────────────────────────────
  M.SourcePaginator = SourcePaginator;

})(window.NavCoreModules = window.NavCoreModules || {});
