// Path:    assets/js/con-data-service/collection-service.js
// Purpose: CollectionService — ศูนย์กลางข้อมูลคอลเลกชัน ให้บริการข้อมูล collection
//          แก่ทุกระบบ (discover, search, cards, static pages)
// Used by: feed.js (collection segments), content.js (card rendering), search
//
// collection-service.js  v3.0.0
// =========================================================
// ระบบศูนย์กลางคอลเลกชัน — Collection Service
//
// v3.0.0 — รวมเข้ากับ ConDataService pipeline
//   ตอนนี้ ConDataService จัดการการแปลง Unicode IDs → items ที่มี api/text/name
//   ทำให้ CollectionService ไม่ต้องทำงานซ้ำ — ขอข้อมูลจาก ConDataService ได้เลย
//
// หลักการออกแบบ:
//  - 1 collection = 1 card (auto-generated)
//  - ข้อมูล collection มาจาก ConDataService.getAssembled() โดยตรง
//  - ไม่ต้องโหลดแยก — ข้อมูลไหลผ่าน pipeline เดียวกับ copyable data
//  - ยืดหยุ่นเหมือน ConDataService — ระบบอื่นขอข้อมูลได้ทุกรูปแบบ
//
// Data flow:
//   ConDataService.getAssembled() → CollectionService กรอง type=collection
//   → แปลงเป็น card format ที่ ContentService._tplCard เข้าใจ
//
// Collection data model (ใน assembled DB):
//   {
//     id: "cute-hearts",
//     name: { th: "หัวใจน่ารัก", en: "Cute Hearts" },
//     description: { th: "...", en: "..." },
//     cover: { type: "auto", items: ["U+2764", "U+1FA77", ...] },
//     items: ["U+2764", "U+1FA77", ...],  // Unicode IDs ต้นฉบับ
//     data: [{ api: "U+2764", text: "❤", name: {...} }, ...]  // แปลงแล้ว
//   }
// =========================================================

// @ts-check
(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  const COLLECTION_TYPE_ID = 'collections';
  const COLLECTION_CARD_CLASS = 'collection-card';
  const COLLECTIONS_BASE_PATH = '/collections';

  // ── Internal state ────────────────────────────────────────────────────────
  let _collectionsCache = null;   // Map<collectionId, collectionData>
  let _isInitialized = false;

  // ── Helper: resolve i18n name ─────────────────────────────────────────────
  function _resolveName(nameObj, lang) {
    if (!nameObj || typeof nameObj !== 'object') return String(nameObj || '');
    return nameObj[lang] || nameObj.en || nameObj.th || Object.values(nameObj)[0] || '';
  }

  // ── Helper: resolve text from Unicode code point ──────────────────────────
  // แปลง "U+2764" → "❤" สำหรับ cover preview
  function _codePointToText(apiCode) {
    if (!apiCode || typeof apiCode !== 'string') return '';
    // ถ้ามี FE0F (variation selector) อยู่ ให้เก็บไว้
    const cleaned = apiCode.replace(/^U\+/i, '');
    const parts = cleaned.split(/\s+/);
    try {
      return parts.map(p => String.fromCodePoint(parseInt(p, 16))).join('');
    } catch (_) {
      return '';
    }
  }

  // ── Helper: build cover preview string ────────────────────────────────────
  // รวมตัวอักษรจาก cover.items เป็น string สั้นๆ สำหรับแสดงบน card
  function _buildCoverPreview(coverItems) {
    if (!Array.isArray(coverItems) || !coverItems.length) return '';
    return coverItems.slice(0, 4).map(item => {
      // item อาจเป็น api code ("U+2764") หรือ text ("❤")
      if (item.startsWith('U+')) return _codePointToText(item);
      return item;
    }).join(' ');
  }

  // ── CollectionService ─────────────────────────────────────────────────────

  const CollectionService = {

    version: '3.0.0',

    // ── Initialization ──────────────────────────────────────────────────────

    /**
     * Initialize collection cache from assembled database.
     * Called automatically on first use — no need to call manually.
     * @param {object} db — assembled database from ConDataService.getAssembled()
     */
    init(db) {
      if (_isInitialized && _collectionsCache) return;

      _collectionsCache = new Map();

      if (!db || !Array.isArray(db.type)) return;

      // หา type ที่เป็น collection
      for (const typeObj of db.type) {
        // ตรวจจาก kind field หรือ id
        const isCollection = typeObj.kind === 'collection' || typeObj.id === COLLECTION_TYPE_ID;
        if (!isCollection) continue;

        // แต่ละ category ใน type คือ 1 collection
        for (const cat of (typeObj.category || [])) {
          if (!cat.data || !cat.data.length) continue;

          // หา collection metadata จาก data items
          // collection data format: { id, name, description, cover, items }
          // แต่ใน assembled DB, cat.data = array of items (api, text, name)
          // เราต้องสร้าง collection card จาก category metadata + items

          _collectionsCache.set(cat.id, {
            id:          cat.id,
            name:        cat.name || {},
            typeId:      typeObj.id,
            typeName:    typeObj.name || {},
            items:       cat.data || [],
            itemCount:   (cat.data || []).length,
          });
        }
      }

      _isInitialized = true;
    },

    /**
     * Reset cache — call when database changes or language changes.
     */
    reset() {
      _collectionsCache = null;
      _isInitialized = false;
    },

    // ── Collection data access ──────────────────────────────────────────────

    /**
     * Get all collections as card-ready objects.
     * @param {string} lang — language code
     * @returns {Array} — array of card objects for ContentService
     */
    getAllCollections(lang = 'en') {
      if (!_collectionsCache) return [];
      const results = [];
      _collectionsCache.forEach((col, id) => {
        results.push(this.toCard(col, lang));
      });
      return results;
    },

    /**
     * Get a single collection by ID.
     * @param {string} collectionId
     * @returns {object|null}
     */
    getCollection(collectionId) {
      if (!_collectionsCache) return null;
      return _collectionsCache.get(collectionId) || null;
    },

    /**
     * Get collection IDs in order.
     * @returns {string[]}
     */
    getCollectionIds() {
      if (!_collectionsCache) return [];
      return Array.from(_collectionsCache.keys());
    },

    /**
     * Get the number of collections.
     * @returns {number}
     */
    getCount() {
      return _collectionsCache ? _collectionsCache.size : 0;
    },

    // ── Card conversion ─────────────────────────────────────────────────────

    /**
     * Convert a collection data object to a card object for ContentService.
     *
     * Output format matches ContentService._tplCard expectations:
     *   { _type, title, description, image, link, className, coverPreview }
     *
     * @param {object} collection — collection data from cache
     * @param {string} lang — language code
     * @returns {object} — card object
     */
    toCard(collection, lang = 'en') {
      if (!collection) return null;

      // สร้าง cover preview จาก items ตัวแรก
      const previewItems = (collection.items || []).slice(0, 4);
      const coverPreview = previewItems
        .map(item => item.text || '')
        .filter(Boolean)
        .join(' ');

      // สร้าง description จากข้อมูลที่มี
      // ถ้า collection มี description field → ใช้
      // ถ้าไม่มี → สร้างจาก item count + preview
      const desc = collection.itemCount
        ? `${_resolveName(collection.typeName, lang)} · ${collection.itemCount} items`
        : _resolveName(collection.typeName, lang);

      return {
        _type:         'card',
        title:         collection.name || {},
        description:   collection.description || desc,
        image:         null,  // อนาคต: auto-generated thumbnail
        coverPreview:  coverPreview,
        link:          `${COLLECTIONS_BASE_PATH}/${collection.id}`,
        className:     COLLECTION_CARD_CLASS,
        // เก็บ raw data สำหรับใช้ในระบบอื่น
        _collectionId: collection.id,
        _itemCount:    collection.itemCount || 0,
      };
    },

    /**
     * Convert a collection to a feed segment for FeedService.
     * Each collection = 1 segment containing 1 card (the collection card itself).
     *
     * @param {object} collection — collection data from cache
     * @returns {object} — segment object for FeedService
     */
    toFeedSegment(collection) {
      if (!collection) return null;
      return Object.freeze({
        id:            `collections:${collection.id}:0`,
        groupType:     'card',
        typeId:        COLLECTION_TYPE_ID,
        typeName:      collection.typeName || {},
        catId:         collection.id,
        catName:       collection.name || {},
        catTotalItems: 1,  // 1 collection = 1 card
        chunkIndex:    0,
        items:         [collection],  // ส่ง raw collection data — FeedService._buildGroup จะจัดการ
      });
    },

    // ── Utility ─────────────────────────────────────────────────────────────

    /**
     * Check if a type ID is a collection type.
     * @param {string} typeId
     * @returns {boolean}
     */
    isCollectionType(typeId) {
      return typeId === COLLECTION_TYPE_ID;
    },

    /**
     * Check if CollectionService is initialized.
     * @returns {boolean}
     */
    isReady() {
      return _isInitialized && _collectionsCache !== null;
    },

    /**
     * Get the collection type ID constant.
     * @returns {string}
     */
    getTypeId() {
      return COLLECTION_TYPE_ID;
    },

    /**
     * Get the base path for collection static pages.
     * @returns {string}
     */
    getBasePath() {
      return COLLECTIONS_BASE_PATH;
    },
  };

  // ── Register globally ────────────────────────────────────────────────────
  if (typeof window !== 'undefined') {
    window.CollectionService = CollectionService;
  }

  // Export for ES modules
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CollectionService;
  }

  export default CollectionService;
})();
