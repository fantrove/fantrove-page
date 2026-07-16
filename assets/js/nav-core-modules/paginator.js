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

// @ts-check
(function (M) {
  'use strict';

  const { CONFIG } = M;

  // ── Paginator constants ────────────────────────────────────────────────────
  const PC = Object.freeze({
    // WHY 4: เท่ากับ sub-nav layout — ผู้ใช้เห็น content เยอะพอใน first paint
    //   แต่ไม่มากเกินไปจน block first render นาน
    //   4 categories × ~20-50 items ต่อ category = ~100-200 items ต่อ first page
    FIRST_PAGE_SIZE: 4,
    // WHY 3: scroll-load แต่ละครั้งเพิ่ม 3 categories — พอเห็น content ใหม่ต่อรอบ
    //   แต่ไม่น้อยเกินไปจนต้อง fetch บ่อย
    PAGE_SIZE:       3,
    // ถ้า category เดียวมี items เยอะมาก (เช่น emoji 1000+) ให้ slice เป็น chunk
    //   ไม่งั้น URE/dom ต้อง render 1000+ items ทีเดียว → กระทบ memory
    MAX_ITEMS_PER_CATEGORY_CHUNK: 60,
    // เก็บ sub-chunk cursor สำหรับ category ใหญ่ — ถ้าเลื่อนจบ chunk 0 แล้วยัง
    //   ไม่หมด category ก็โหลด chunk ถัดไปของ category เดิมก่อน
  });

  /**
   * State shape (can be saved to / restored from RouteCache):
   *   {
   *     source:    string,         // e.g. 'symbol', 'emoji', 'fancy'
   *     layout:    'button'|'card',
   *     filter:    string[]|null,
   *     categories: Array<{id,name}>,
   *     catCursor: number,         // index ใน categories ที่จะโหลดต่อไป
   *     itemCursor: number,        // sub-chunk cursor ใน category ปัจจุบัน (ถ้ามี)
   *     currentCatId: string|null, // id ของ category ที่กำลัง chunk อยู่
   *     hasMore:   boolean,
   *   }
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

      // ถ้ามี state อยู่แล้วและ source เดียวกัน → ไม่ re-init
      const existing = this._states.get(source);
      if (existing && existing.source === source) return;

      const cats = await M.DataService.getTypeCategories(source);
      if (!cats || !cats.length) {
        this._states.set(source, {
          source, layout, filter,
          categories: [],
          catCursor: 0, itemCursor: 0,
          currentCatId: null,
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
        itemCursor: 0,
        currentCatId: null,
        hasMore: filtered.length > 0,
      });
    },

    /**
     * Load next page — returns group descriptors เหมือน FeedService.loadNextPage
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

        // ── Sub-chunking: ถ้ากำลัง chunk category ใหญ่อยู่ → โหลด chunk ถัดไป ──
        if (st.currentCatId && st.itemCursor > 0) {
          const chunkGroup = await this._loadNextChunk(st, lang);
          if (chunkGroup) {
            groups.push(chunkGroup);
            // ถ้า chunk นี้ยังไม่จบ category → ยังอยู่ใน category เดิม ไม่เลื่อน catCursor
            // ถ้า chunk นี้คือ chunk สุดท้ายของ category → ปรับ catCursor และ reset itemCursor
            continue;
          }
          // chunk ว่าง → ไป category ถัดไป
          st.currentCatId = null;
          st.itemCursor = 0;
        }

        // ── Category ใหม่ ──────────────────────────────────────────────────
        if (st.catCursor >= st.categories.length) {
          st.hasMore = false;
          break;
        }

        const cat = st.categories[st.catCursor];
        const group = await this._fetchCategoryGroup(st, cat, lang);
        if (group) {
          // ตรวจว่า category นี้ใหญ่เกิน MAX_ITEMS_PER_CATEGORY_CHUNK ไหม
          //   ถ้าใช่ → slice เอาแค่ chunk แรก แล้วเก็บ currentCatId ไว้ทยอยโหลด chunk ถัดไป
          if (group.items.length > PC.MAX_ITEMS_PER_CATEGORY_CHUNK) {
            const firstChunk = group.items.slice(0, PC.MAX_ITEMS_PER_CATEGORY_CHUNK);
            st.currentCatId = cat.id;
            st.itemCursor = PC.MAX_ITEMS_PER_CATEGORY_CHUNK;
            groups.push({
              group: {
                type: st.layout,
                header: group.header,
                items: firstChunk,
              },
            });
          } else {
            groups.push({ group });
          }
          st.catCursor++;
        } else {
          // fetch fail → ข้ามไป category ถัดไป
          st.catCursor++;
          i--; // นับรอบนี้ใหม่
        }
      }

      // อัปเดต hasMore
      st.hasMore = st.catCursor < st.categories.length
        || (st.currentCatId !== null && st.itemCursor > 0);

      return { groups, hasMore: st.hasMore };
    },

    /**
     * โหลด chunk ถัดไปของ category ปัจจุบัน (sub-chunking สำหรับ category ใหญ่)
     */
    async _loadNextChunk(st, lang) {
      if (!st.currentCatId) return null;

      // หา category object จาก id
      const cat = st.categories.find(c => c.id === st.currentCatId);
      if (!cat) {
        st.currentCatId = null;
        st.itemCursor = 0;
        return null;
      }

      // ดึง items ทั้งหมดของ category นี้อีกครั้ง (จาก cache ของ DataService — ไม่ fetch network ซ้ำ)
      const full = await this._fetchCategoryGroup(st, cat, lang);
      if (!full || !full.items.length) {
        st.currentCatId = null;
        st.itemCursor = 0;
        return null;
      }

      const slice = full.items.slice(
        st.itemCursor,
        st.itemCursor + PC.MAX_ITEMS_PER_CATEGORY_CHUNK
      );

      if (!slice.length) {
        // หมด category แล้ว
        st.currentCatId = null;
        st.itemCursor = 0;
        st.catCursor++; // ไป category ถัดไปในรอบถัดไป
        return null;
      }

      st.itemCursor += slice.length;

      return {
        group: {
          type: st.layout,
          header: null, // ไม่ show header ซ้ำ — เคย show ใน chunk แรกแล้ว
          items: slice,
        },
      };
    },

    /**
     * Fetch category data (delegated to DataService — ใช้ cache ของมัน)
     * ส่งกลับ { type, header, items } เหมือน _fetchSourceGroup ของเดิม
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
      this._states.set(snap.source, JSON.parse(JSON.stringify(snap)));
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
    FIRST_PAGE_SIZE: PC.FIRST_PAGE_SIZE,
    PAGE_SIZE:       PC.PAGE_SIZE,
  };

  // ── Export ──────────────────────────────────────────────────────────────────
  M.SourcePaginator = SourcePaginator;

})(window.NavCoreModules = window.NavCoreModules || {});
