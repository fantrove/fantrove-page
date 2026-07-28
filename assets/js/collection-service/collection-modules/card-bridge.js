/**
 * card-bridge.js — สร้างข้อมูลการ์ดจาก Collection (Card Bridge)
 *
 * Part of: Collection Service
 * Namespace: window.CollectionModules
 *
 * Dependencies: Phase 1-3 (config.js, state.js, loader.js, cover-generator.js)
 *
 * Public API:
 *   M.CardBridge — generateCards, generateCard
 *
 * Architecture:
 *   - แปลง Collection data → Card-like format เพื่อให้ระบบเดิมใช้ต่อได้
 *   - Card-like items มีโครงสร้างเดียวกับ cards เดิมแต่:
 *     - image เป็น inline SVG (ไม่ใช่ URL)
 *     - link เป็น internal path (ไม่เปิดแท็บใหม่)
 *     - api ขึ้นต้นด้วย 'collection-' prefix
 *   - ระบบเดิม (home.js, content.js) ไม่ต้องแก้ไขในช่วง migration
 */

(function (M) {
  'use strict';

  var Config = M.Config;
  var State  = M.State;
  var Loader = M.Loader;
  var Reg    = M.Registry;
  var CoverGen = M.CoverGenerator;

  // ── Card Bridge Module ────────────────────────────────────────────

  var CardBridge = {
    /**
     * สร้าง card data จากทุก collections
     *
     * @param {string} lang — language code
     * @returns {Promise<Object[]>} — CardLikeItem[]
     */
    generateCards: function (lang) {
      lang = lang || Config.SEO.DEFAULT_LANG;

      return Loader.assemble().then(function () {
        if (!State.assembled || !State.assembled.collections) return [];

        // ตรวจ cache
        var cacheKey = 'all|' + lang;
        if (State.cardCache && State.cardCache.has(cacheKey)) {
          return State.cardCache.get(cacheKey);
        }

        var cards = [];
        var collections = State.assembled.collections;

        for (var i = 0; i < collections.length; i++) {
          var col = collections[i];
          var card = CardBridge.generateCardSync(col, lang);
          if (card) cards.push(card);
        }

        // Cache
        if (State.cardCache) {
          State.cardCache.set(cacheKey, cards);
        }

        return cards;
      });
    },

    /**
     * สร้าง card data สำหรับ collection เดียว
     *
     * @param {string} collectionId
     * @param {string} lang
     * @returns {Promise<Object|null>}
     */
    generateCard: function (collectionId, lang) {
      lang = lang || Config.SEO.DEFAULT_LANG;

      return Loader.assemble().then(function () {
        var col = State.idIndex ? State.idIndex.get(collectionId) : null;
        if (!col) return null;
        return CardBridge.generateCardSync(col, lang);
      });
    },

    /**
     * สร้าง card data แบบ synchronous (ใช้เมื่อข้อมูลโหลดแล้ว)
     *
     * @param {Object} collection — CollectionData
     * @param {string} lang
     * @returns {Object|null} — CardLikeItem
     */
    generateCardSync: function (collection, lang) {
      if (!collection || !collection.id) return null;
      lang = lang || Config.SEO.DEFAULT_LANG;

      // Resolve cover items
      var coverItems = collection.cover && collection.cover.items
        ? collection.cover.items : [];
      var resolvedChars = [];
      for (var i = 0; i < coverItems.length; i++) {
        var char = _unicodeIdToChar(coverItems[i]);
        if (char) resolvedChars.push(char);
      }

      // Generate cover HTML
      var coverHtml = CoverGen.generateCoverHtmlStatic(collection, resolvedChars);

      // Build card-like object
      return {
        api: Config.CARD.API_PREFIX + collection.id,
        text: Reg.getName(collection.name, lang),
        name: collection.name,
        description: collection.description,
        image: coverHtml,
        link: Config.PATHS.collectionPageUrl(collection.id, ''),
        className: Config.CARD.CLASS_NAME,
        _collectionId: collection.id,
        _itemCount: collection.items ? collection.items.length : 0,
      };
    },
  };

  // ── Internal Helpers ──────────────────────────────────────────────

  /**
   * แปลง Unicode ID เป็นตัวอักษร
   * @param {string} unicodeId
   * @returns {string|null}
   * @private
   */
  function _unicodeIdToChar(unicodeId) {
    if (!unicodeId || typeof unicodeId !== 'string') return null;
    var match = unicodeId.match(/^U\+([0-9A-Fa-f]{4,6})$/);
    if (!match) return null;
    var codePoint = parseInt(match[1], 16);
    if (isNaN(codePoint) || codePoint < 0 || codePoint > 0x10FFFF) return null;
    try { return String.fromCodePoint(codePoint); } catch (e) { return null; }
  }

  // ── Export ─────────────────────────────────────────────────────────

  M.CardBridge = CardBridge;

})(window.CollectionModules = window.CollectionModules || {});
