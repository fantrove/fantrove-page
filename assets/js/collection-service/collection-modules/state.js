/**
 * state.js — สถานะของโมดูล (Module State) สำหรับ Collection Service
 *
 * Part of: Collection Service
 * Namespace: window.CollectionModules
 *
 * Dependencies: none (Phase 1 — pure definitions)
 *
 * Public API:
 *   M.State — object containing all mutable state
 */

(function (M) {
  'use strict';

  // ── Module State ──────────────────────────────────────────────────

  var State = {
    // ── ข้อมูลที่โหลดแล้ว ──────────────────────────────────────────
    /** ข้อมูล collections ที่ assembled แล้ว */
    assembled: null,

    /** Map<id, CollectionData> — index ตาม ID */
    idIndex: null,

    /** Map<unicodeId, string[]> — index ว่าแต่ละ Unicode ID อยู่ใน collection ไหนบ้าง */
    itemIndex: null,

    /** ข้อมูลที่ resolved แล้ว (cache) */
    resolvedCache: null,

    // ── สถานะการโหลด ────────────────────────────────────────────────
    /** Promise ของ assembly ที่กำลังทำอยู่ (dedup) */
    assemblePromise: null,

    /** กำลังโหลดอยู่หรือไม่ */
    isLoading: false,

    /** โหลดเสร็จแล้วหรือไม่ */
    isReady: false,

    // ── Cache ──────────────────────────────────────────────────────
    /** Cache สำหรับ cover HTML */
    coverCache: null,

    /** Cache สำหรับ card data */
    cardCache: null,

    /** Cache สำหรับ related results */
    relatedCache: null,

    // ── Event listeners ────────────────────────────────────────────
    /** Event listeners registry */
    _listeners: null,

    // ── Methods ────────────────────────────────────────────────────

    /**
     * รีเซ็ตสถานะทั้งหมด (ใช้เมื่อ invalidate cache)
     */
    reset: function () {
      State.assembled = null;
      State.idIndex = null;
      State.itemIndex = null;
      State.resolvedCache = null;
      State.assemblePromise = null;
      State.isLoading = false;
      State.isReady = false;
      State.coverCache = null;
      State.cardCache = null;
      State.relatedCache = null;
    },

    /**
     * สร้าง index จาก assembled data
     * @param {Object} assembled — { collections: CollectionData[] }
     */
    buildIndexes: function (assembled) {
      if (!assembled || !Array.isArray(assembled.collections)) return;

      State.idIndex = new Map();
      State.itemIndex = new Map();
      State.resolvedCache = new Map();
      State.coverCache = new Map();
      State.cardCache = new Map();
      State.relatedCache = new Map();

      for (var i = 0; i < assembled.collections.length; i++) {
        var col = assembled.collections[i];
        if (!col || !col.id) continue;

        // Index by ID
        State.idIndex.set(col.id, col);

        // Index items → collection IDs
        if (Array.isArray(col.items)) {
          for (var j = 0; j < col.items.length; j++) {
            var itemId = col.items[j];
            if (!State.itemIndex.has(itemId)) {
              State.itemIndex.set(itemId, []);
            }
            State.itemIndex.get(itemId).push(col.id);
          }
        }
      }
    },
  };

  // ── Exports ────────────────────────────────────────────────────────

  M.State = State;

})(window.CollectionModules = window.CollectionModules || {});
