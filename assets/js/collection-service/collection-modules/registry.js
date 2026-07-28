/**
 * registry.js — Schema Registry สำหรับ Collection data
 *
 * Part of: Collection Service
 * Namespace: window.CollectionModules
 *
 * Dependencies: Phase 1 (types.js, config.js)
 *
 * Public API:
 *   M.Registry — schema definitions, validators, normalizers, path resolvers
 */

(function (M) {
  'use strict';

  var Config = M.Config;

  // ── Schema Definitions ────────────────────────────────────────────

  var schema = {
    /** collections.json (type index) */
    collectionsIndex: {
      required: ['id', 'kind', 'name', 'categories'],
      categories: {
        required: ['id', 'name', 'file'],
        name: { required: ['en'] },
      },
    },

    /** {collection-id}.json (individual collection) */
    collectionData: {
      required: ['id', 'name', 'description', 'cover', 'items'],
      name: { required: ['en'] },
      description: { required: ['en'] },
      cover: {
        required: ['type', 'items'],
      },
    },
  };

  // ── Path Resolvers ────────────────────────────────────────────────

  var paths = {
    /** ดึง path ของ collections type index */
    collectionsIndex: function () {
      return Config.PATHS.COLLECTIONS_INDEX;
    },

    /** ดึง path ของ collection data file */
    collectionData: function (id) {
      return Config.PATHS.collectionDataPath(id);
    },
  };

  // ── Validators ────────────────────────────────────────────────────

  var validate = {
    /** ตรวจสอบ collections.json structure */
    collectionsIndex: function (data) {
      return data
        && typeof data.id === 'string'
        && data.kind === 'collection'
        && data.name
        && typeof data.name === 'object'
        && Array.isArray(data.categories);
    },

    /** ตรวจสอบ collection data file structure */
    collectionData: function (data) {
      return data
        && typeof data.id === 'string'
        && data.name
        && typeof data.name === 'object'
        && data.description
        && typeof data.description === 'object'
        && data.cover
        && typeof data.cover === 'object'
        && data.cover.type
        && Array.isArray(data.cover.items)
        && Array.isArray(data.items);
    },

    /** ตรวจสอบว่า cover config ถูกต้อง */
    coverConfig: function (cover) {
      return cover
        && typeof cover.type === 'string'
        && Array.isArray(cover.items)
        && cover.items.length > 0;
    },
  };

  // ── Normalizers ───────────────────────────────────────────────────

  var normalize = {
    /** แปลง collections.json ให้อยู่ในรูปแบบมาตรฐาน */
    collectionsIndex: function (raw) {
      if (!raw) return null;
      return {
        id: raw.id || 'collections',
        kind: raw.kind || 'collection',
        name: raw.name || {},
        categories: raw.categories || raw.category || [],
      };
    },

    /** แปลง collection data file ให้อยู่ในรูปแบบมาตรฐาน */
    collectionData: function (raw) {
      if (!raw) return null;
      return {
        id: raw.id || '',
        name: raw.name || {},
        description: raw.description || {},
        cover: _normalizeCover(raw.cover),
        items: Array.isArray(raw.items) ? raw.items : [],
      };
    },
  };

  /**
   * แปลง cover config ให้อยู่ในรูปแบบมาตรฐาน
   * @param {Object} raw
   * @returns {Object}
   * @private
   */
  function _normalizeCover(raw) {
    if (!raw) return { type: 'auto', items: [] };
    return {
      type: raw.type || 'auto',
      items: Array.isArray(raw.items) ? raw.items : [],
      layout: raw.layout || null,
      bgColor: raw.bgColor || null,
    };
  }

  // ── Name Helper ───────────────────────────────────────────────────

  /**
   * ดึงชื่อตามภาษาที่ร้องขอ
   * @param {Object} nameObj — { th, en }
   * @param {string} lang — language code
   * @returns {string}
   */
  function getName(nameObj, lang) {
    if (!nameObj || typeof nameObj !== 'object') return String(nameObj || '');
    return nameObj[lang] || nameObj.en || nameObj.th || Object.values(nameObj)[0] || '';
  }

  // ── Export ─────────────────────────────────────────────────────────

  var Registry = {
    schema: schema,
    paths: paths,
    validate: validate,
    normalize: normalize,
    getName: getName,
  };

  M.Registry = Registry;

})(window.CollectionModules = window.CollectionModules || {});
