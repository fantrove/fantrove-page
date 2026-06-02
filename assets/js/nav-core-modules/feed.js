// Path:    assets/js/nav-core-modules/feed.js
// Purpose: FeedService — smart discovery feed สำหรับ "All" system button
//          สุ่มเนื้อหาจากหลาย category ด้วย seeded algorithm เพื่อการค้นพบเนื้อหาใหม่
// Used by: router.js (navigateTo เมื่อ main === CONFIG.ALL_BUTTON.URL)

// @ts-check
(function (M) {
  'use strict';

  const { CONFIG } = M;

  // ── Seeded LCG PRNG ────────────────────────────────────────────────────────────
  // WHY: ใช้ seed แทน Math.random() เพื่อให้ฟีดเหมือนกันตลอด seed window (30 min)
  //      ผู้ใช้ refresh หน้าภายใน 30 นาทีเห็นฟีดเดิม — ไม่กระพริบทุกครั้ง
  //      Math.imul ให้ 32-bit integer multiplication โดยไม่ overflow

  function _seededRng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  // Fisher-Yates shuffle ด้วย seeded rng
  function _shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // seed เปลี่ยนทุก FEED_SEED_TTL ms → ฟีดหมุนเวียนอัตโนมัติ
  function _currentSeed() {
    return Math.floor(Date.now() / CONFIG.ALL_BUTTON.FEED_SEED_TTL);
  }

  function _resolveName(nameObj, lang) {
    if (!nameObj || typeof nameObj !== 'object') return String(nameObj || '');
    return nameObj[lang] || nameObj.en || nameObj.th || Object.values(nameObj)[0] || '';
  }

  // ── FeedService ────────────────────────────────────────────────────────────────

  const FeedService = {

    _lastSeed:   null,
    _cachedData: null,

    /**
     * Build renderContent-compatible descriptors สำหรับ smart feed.
     * Output format: [{ group: { type, header, items } }, ...]
     *
     * Algorithm:
     *  1. ดึง assembled DB → กรองเฉพาะ copyable types (emoji, symbol, ...)
     *  2. รวม categories ทั้งหมด → Fisher-Yates shuffle ด้วย seed
     *  3. เลือก FEED_SAMPLE_CATS categories แรก
     *  4. แต่ละ category: random window ขนาด FEED_ITEMS_PER_CAT items
     *     (offset ต่างกันทุก seed window → ค้นพบ item ใหม่เรื่อยๆ)
     *
     * @param {string} lang
     * @returns {Promise<Array>}
     */
    async buildRenderData(lang) {
      const seed = _currentSeed();

      // WHY: cache ต่อ seed window — ไม่ rebuild ถ้า seed ยังเหมือนเดิม
      if (seed === this._lastSeed && this._cachedData) return this._cachedData;

      const SAMPLE_CATS   = CONFIG.ALL_BUTTON.FEED_SAMPLE_CATS;
      const ITEMS_PER_CAT = CONFIG.ALL_BUTTON.FEED_ITEMS_PER_CAT;

      // ── Resolve copyable type IDs ──────────────────────────────────────────────
      // WHY: collection types (cards) ไม่ควรปรากฏในฟีด
      //      item ของ cards ไม่ใช่ตัวอักขระ copy ได้ — ใช้ ConDataRegistry เป็น source of truth
      const registry    = window.ConDataService?.registry || window.ConDataRegistry || null;
      const knownKinds  = registry?.knownKinds || {};
      const copyableIds = new Set(
        Object.entries(knownKinds)
          .filter(([, kind]) => kind === 'copyable')
          .map(([id]) => id)
      );
      // WHY fallback: registry อาจยังไม่ mount ตอน feed เรียกครั้งแรก
      if (!copyableIds.size) { copyableIds.add('emoji'); copyableIds.add('symbol'); }

      // ── Fetch assembled DB ─────────────────────────────────────────────────────
      const db = await M.DataService.loadApiDatabase();
      if (!db?.type?.length) return [];

      // ── Collect all eligible categories ───────────────────────────────────────
      const allCats = [];
      for (const typeObj of db.type) {
        if (!copyableIds.has(typeObj.id)) continue;
        for (const cat of (typeObj.category || [])) {
          if (!(cat.data?.length)) continue;
          allCats.push({
            typeId:   typeObj.id,
            typeName: typeObj.name,
            catId:    cat.id,
            catName:  cat.name,
            items:    cat.data,
          });
        }
      }

      if (!allCats.length) return [];

      // ── Shuffle → sample N categories ─────────────────────────────────────────
      const rng     = _seededRng(seed);
      const sampled = _shuffle(allCats, rng).slice(0, SAMPLE_CATS);

      // ── Build render groups ────────────────────────────────────────────────────
      // WHY: ส่งออกเป็น { group: { type, header, items } } ซึ่ง ContentService._resolveAll()
      //      รับได้โดยตรง ผ่าน _resolveGroup() → _fetchItems() → _resolveItem()
      const renderData = sampled.map(entry => {
        // สุ่ม offset ภายใน category ให้ได้ item ที่ต่างกันทุก seed window
        const maxOffset = Math.max(0, entry.items.length - ITEMS_PER_CAT);
        const offset    = Math.floor(rng() * (maxOffset + 1));
        const slice     = entry.items.slice(offset, offset + ITEMS_PER_CAT);

        return {
          group: {
            type:   'button',
            header: {
              title:       _resolveName(entry.catName,  lang),
              description: _resolveName(entry.typeName, lang),
              className:   'auto-category-header',
            },
            items: slice,
          },
        };
      });

      this._lastSeed   = seed;
      this._cachedData = renderData;
      return renderData;
    },

    /**
     * Force rebuild ครั้งถัดไป.
     * เรียกเมื่อ: ผู้ใช้เปลี่ยนภาษา หรือต้องการล้าง cache ด้วยตนเอง
     */
    invalidate() {
      this._lastSeed   = null;
      this._cachedData = null;
    },
  };

  // ── Export ──────────────────────────────────────────────────────────────────────
  M.FeedService = FeedService;

})(window.NavCoreModules = window.NavCoreModules || {});