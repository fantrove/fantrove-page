/**
 * types.js — นิยามประเภทข้อมูล (Type Definitions) สำหรับ Collection Service
 *
 * Part of: Collection Service
 * Namespace: window.CollectionModules
 *
 * Dependencies: none (Phase 1 — pure definitions)
 *
 * Public API:
 *   M.Types — object containing all type definitions
 */

(function (M) {
  'use strict';

  // ── Type Definitions ──────────────────────────────────────────────

  /**
   * @typedef {Object} CollectionData
   * @property {string} id            — URL-safe identifier (เช่น 'cute-hearts')
   * @property {Object} name          — ชื่อ i18n { th, en }
   * @property {Object} description   — คำอธิบาย i18n { th, en }
   * @property {CoverConfig} cover    — ข้อมูลปก thumbnail
   * @property {string[]} items       — Unicode IDs ที่อยู่ในคอลเลกชัน
   */

  /**
   * @typedef {Object} CoverConfig
   * @property {string} type          — 'auto' (คำนวณจาก items) | 'manual' (ระบุเอง)
   * @property {string[]} items       — Unicode IDs สำหรับแสดงในปก (subset ของ items)
   * @property {string} [layout]      — 'grid' (default) | 'row' | 'spiral' | 'mosaic'
   * @property {string} [bgColor]     — สีพื้นหลัง (optional)
   */

  /**
   * @typedef {Object} ResolvedItem
   * @property {string} unicodeId     — Unicode ID ต้นฉบับ (เช่น 'U+2764')
   * @property {string} char          — ตัวอักษรจริง (เช่น '❤')
   * @property {string} name          — ชื่อแสดงผลตามภาษาที่ร้องขอ
   * @property {Object} nameObj       — ออบเจกต์ชื่อ i18n ฉบับเต็ม
   * @property {string} api           — API code (เท่ากับ unicodeId)
   * @property {string} text          — สตริงตัวอักษร (เท่ากับ char)
   * @property {string} [_typeId]     — ประเภทหลัก (เช่น 'emoji')
   * @property {string} [_catId]      — หมวดหมู่หลัก (เช่น 'smileys_emotion')
   */

  /**
   * @typedef {Object} CardLikeItem
   * @property {string} api           — 'collection-{id}' (เช่น 'collection-cute-hearts')
   * @property {string} text          — ชื่อคอลเลกชันตามภาษา
   * @property {Object} name          — ชื่อ i18n
   * @property {Object} description   — คำอธิบาย i18n
   * @property {string} image         — SVG ปกที่สร้างอัตโนมัติ (inline, ไม่ใช่ URL)
   * @property {string} link          — '/collections/{id}/' (ภายใน, ไม่เปิดแท็บใหม่)
   * @property {string} className     — 'collection-card' (CSS class พิเศษ)
   */

  /**
   * @typedef {Object} CollectionSEOData
   * @property {string} title          — ชื่อหน้า (i18n)
   * @property {string} description    — meta description (i18n)
   * @property {string} canonical      — canonical URL
   * @property {Object[]} hreflang     — URL ภาษาอื่น
   * @property {string} ogTitle        — Open Graph title
   * @property {string} ogDescription  — Open Graph description
   * @property {string} ogType         — 'website'
   */

  /**
   * @typedef {Object} RelatedResult
   * @property {string} id            — collection ID
   * @property {Object} name          — i18n name
   * @property {number} score         — คะแนนความเกี่ยวข้อง (0-1)
   */

  // ── Exports ────────────────────────────────────────────────────────

  var Types = {
    // ประเภท cover layout
    COVER_LAYOUT: Object.freeze({
      GRID: 'grid',
      ROW: 'row',
      SPIRAL: 'spiral',
      MOSAIC: 'mosaic',
    }),

    // ประเภท cover type
    COVER_TYPE: Object.freeze({
      AUTO: 'auto',
      MANUAL: 'manual',
    }),

    // น้ำหนักของ related algorithm
    RELATED_WEIGHTS: Object.freeze({
      JACCARD: 0.7,
      CATEGORY_AFFINITY: 0.3,
      CO_OCCURRENCE: 0.0,
    }),

    // ค่าสูงสุดของ related results
    RELATED_MAX_RESULTS: 8,

    // ค่าขั้นต่ำของ related score ที่จะแสดง
    RELATED_MIN_SCORE: 0.01,
  };

  M.Types = Types;

})(window.CollectionModules = window.CollectionModules || {});
