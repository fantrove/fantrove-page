/**
 * service.js — Public API Orchestration สำหรับ Collection Service
 *
 * Part of: Collection Service
 * Namespace: window.CollectionModules
 *
 * Dependencies: Phase 1-4 (all modules)
 *
 * Public API:
 *   M.Service — CollectionService public API
 *
 * Exposes:
 *   window.CollectionService — global public API
 */

(function (M) {
  'use strict';

  var Config   = M.Config;
  var State    = M.State;
  var Loader   = M.Loader;
  var Reg      = M.Registry;
  var Resolver = M.Resolver;
  var CoverGen = M.CoverGenerator;
  var Related  = M.Related;
  var CardBridge = M.CardBridge;
  var SEO      = M.SEO;

  // ── Event Bus ─────────────────────────────────────────────────────

  var _listeners = new Map();

  function _on(event, fn) {
    if (!_listeners.has(event)) _listeners.set(event, new Set());
    _listeners.get(event).add(fn);
    return function () { _off(event, fn); };
  }

  function _off(event, fn) {
    var b = _listeners.get(event);
    if (b) b.delete(fn);
  }

  function _emit(event, payload) {
    var b = _listeners.get(event);
    if (!b) return;
    b.forEach(function (fn) {
      try { fn(payload); } catch (e) {
        console.warn('[CollectionService] event error', e);
      }
    });
  }

  // ── CollectionService Public API ──────────────────────────────────

  var CollectionService = {
    version: Config.VERSION,

    // ── CORE ──────────────────────────────────────────────────────────

    /**
     * โหลดและประกอบข้อมูล collections ทั้งหมด
     * @returns {Promise<{ collections: Object[] }>}
     */
    getAssembled: function () {
      return Loader.assemble().then(function (result) {
        _emit('ready', { assembled: result });
        return result;
      });
    },

    /**
     * ดึง collection เดียวตาม ID
     * @param {string} id
     * @returns {Promise<Object|null>}
     */
    getById: function (id) {
      if (!id) return Promise.resolve(null);
      return Loader.assemble().then(function () {
        return State.idIndex ? State.idIndex.get(id) || null : null;
      });
    },

    /**
     * ดึงรายการ collections ทั้งหมด (แบบย่อ)
     * @param {string} lang
     * @returns {Promise<Object[]>}
     */
    getAll: function (lang) {
      lang = lang || Config.SEO.DEFAULT_LANG;
      return Loader.assemble().then(function () {
        if (!State.assembled || !State.assembled.collections) return [];

        return State.assembled.collections.map(function (col) {
          return {
            id: col.id,
            name: Reg.getName(col.name, lang),
            itemCount: col.items ? col.items.length : 0,
          };
        });
      });
    },

    // ── ITEM RESOLUTION ───────────────────────────────────────────────

    /**
     * แก้ไข items ของ collection จาก Unicode IDs เป็น ResolvedItems
     * @param {string} collectionId
     * @param {string} lang
     * @returns {Promise<Object[]>}
     */
    getResolvedItems: function (collectionId, lang) {
      return Resolver.resolveItems(
        _getCollectionItemIds(collectionId),
        lang
      );
    },

    /**
     * แก้ไข Unicode ID เดียว
     * @param {string} unicodeId
     * @param {string} lang
     * @returns {Promise<Object|null>}
     */
    resolveUnicodeId: function (unicodeId, lang) {
      return Resolver.resolveUnicodeId(unicodeId, lang);
    },

    // ── COVER GENERATION ──────────────────────────────────────────────

    /**
     * สร้าง cover HTML สำหรับ collection
     * @param {string} collectionId
     * @returns {Promise<string>}
     */
    generateCoverHtml: function (collectionId) {
      return CoverGen.generateCoverHtml(collectionId);
    },

    /**
     * สร้าง cover HTML แบบ static (ไม่ต้องมี DOM)
     * @param {Object} collection
     * @param {string[]} resolvedCoverItems
     * @returns {string}
     */
    generateCoverHtmlStatic: function (collection, resolvedCoverItems) {
      return CoverGen.generateCoverHtmlStatic(collection, resolvedCoverItems);
    },

    // ── RELATED COLLECTIONS ───────────────────────────────────────────

    /**
     * ดึง related collections สำหรับ collection ที่ระบุ
     * @param {string} collectionId
     * @param {number} maxResults
     * @returns {Promise<Object[]>}
     */
    getRelated: function (collectionId, maxResults) {
      return Related.computeRelated(collectionId, maxResults);
    },

    // ── CARD BRIDGE ───────────────────────────────────────────────────

    /**
     * สร้าง card data จากทุก collections
     * @param {string} lang
     * @returns {Promise<Object[]>}
     */
    generateCards: function (lang) {
      return CardBridge.generateCards(lang);
    },

    /**
     * สร้าง card data สำหรับ collection เดียว
     * @param {string} collectionId
     * @param {string} lang
     * @returns {Promise<Object|null>}
     */
    generateCard: function (collectionId, lang) {
      return CardBridge.generateCard(collectionId, lang);
    },

    // ── SEO ───────────────────────────────────────────────────────────

    /**
     * ดึง SEO meta data สำหรับ collection page
     * @param {string} collectionId
     * @param {string} lang
     * @returns {Promise<Object|null>}
     */
    getSeoData: function (collectionId, lang) {
      return SEO.getSeoData(collectionId, lang);
    },

    /**
     * สร้าง JSON-LD structured data สำหรับ collection page
     * @param {string} collectionId
     * @param {string} lang
     * @returns {Promise<Object|null>}
     */
    generateStructuredData: function (collectionId, lang) {
      return SEO.generateStructuredData(collectionId, lang);
    },

    // ── EVENT SYSTEM ──────────────────────────────────────────────────

    on: function (event, fn) { return _on(event, fn); },
    off: function (event, fn) { _off(event, fn); },

    // ── CACHE & STATUS ────────────────────────────────────────────────

    /**
     * ลบ cache ทั้งหมด
     */
    invalidateCache: function () {
      Loader.invalidate();
      _emit('invalidated', {});
    },

    /**
     * เริ่มโหลดข้อมูลล่วงหน้า (fire-and-forget)
     */
    preload: function () {
      return Loader.assemble().catch(function () {});
    },

    /**
     * ดึงสถานะปัจจุบัน
     * @returns {Object}
     */
    status: function () {
      return Loader.status();
    },
  };

  // ── Internal Helpers ──────────────────────────────────────────────

  /**
   * ดึง item IDs ของ collection
   * @param {string} collectionId
   * @returns {string[]}
   * @private
   */
  function _getCollectionItemIds(collectionId) {
    if (!State.idIndex) return [];
    var col = State.idIndex.get(collectionId);
    return col && col.items ? col.items : [];
  }

  // ── Export ─────────────────────────────────────────────────────────

  M.Service = CollectionService;

  // Register global
  if (typeof window !== 'undefined') {
    window.CollectionService = CollectionService;
    // Auto-preload (mirrors ConDataService pattern)
    CollectionService.preload();
  }

})(window.CollectionModules = window.CollectionModules || {});
