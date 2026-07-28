/**
 * resolver.js — ระบบแก้ไข Unicode ID → ตัวอักษร (Unicode ID Resolver)
 *
 * Part of: Collection Service
 * Namespace: window.CollectionModules
 *
 * Dependencies: Phase 1-2 (config.js, state.js, registry.js, loader.js)
 *
 * Public API:
 *   M.Resolver — resolveUnicodeId, resolveItems, resolveCoverItems
 *
 * Architecture:
 *   - ใช้ ConDataService เป็นแหล่งข้อมูลหลัก (single source of truth)
 *   - Fallback: แปลง Unicode ID เป็นตัวอักษรด้วย String.fromCharCode
 *   - Cache: ทุกการ resolve ถูก cache เพื่อไม่ต้องค้นซ้ำ
 *   - Deterministic: ผลลัพธ์เดียวกันเสมอสำหรับ input เดียวกัน
 */

(function (M) {
  'use strict';

  var Config = M.Config;
  var State  = M.State;
  var Reg    = M.Registry;
  var Loader = M.Loader;

  // ── Internal: Unicode ID → Character Converter ────────────────────

  /**
   * แปลง Unicode ID (เช่น 'U+2764') เป็นตัวอักษรจริง
   * รองรับทั้ง BMP และ Supplementary Planes
   *
   * @param {string} unicodeId — เช่น 'U+2764', 'U+1F600'
   * @returns {string|null} — ตัวอักษร หรือ null ถ้าไม่ถูกต้อง
   * @private
   */
  function _unicodeIdToChar(unicodeId) {
    if (!unicodeId || typeof unicodeId !== 'string') return null;

    // ตรวจรูปแบบ U+XXXX หรือ U+XXXXX
    var match = unicodeId.match(/^U\+([0-9A-Fa-f]{4,6})$/);
    if (!match) return null;

    var codePoint = parseInt(match[1], 16);
    if (isNaN(codePoint) || codePoint < 0 || codePoint > 0x10FFFF) return null;

    try {
      return String.fromCodePoint(codePoint);
    } catch (e) {
      return null;
    }
  }

  // ── Resolver Module ───────────────────────────────────────────────

  var Resolver = {
    /**
     * แก้ไข Unicode ID เดียวเป็น ResolvedItem
     * พยายามใช้ ConDataService ก่อน ถ้าไม่ได้จะใช้ fallback
     *
     * @param {string} unicodeId — เช่น 'U+2764'
     * @param {string} lang — language code
     * @returns {Promise<Object|null>} — ResolvedItem หรือ null
     */
    resolveUnicodeId: function (unicodeId, lang) {
      if (!unicodeId) return Promise.resolve(null);
      lang = lang || Config.SEO.DEFAULT_LANG;

      // ตรวจ cache ก่อน
      var cacheKey = unicodeId + '|' + lang;
      if (State.resolvedCache && State.resolvedCache.has(cacheKey)) {
        return Promise.resolve(State.resolvedCache.get(cacheKey));
      }

      // พยายามใช้ ConDataService
      return _resolveViaConDataService(unicodeId, lang)
        .then(function (resolved) {
          if (resolved) {
            _cacheResolved(cacheKey, resolved);
            return resolved;
          }

          // Fallback: แปลง Unicode ID เป็นตัวอักษรโดยตรง
          var fallback = _resolveFallback(unicodeId, lang);
          if (fallback) {
            _cacheResolved(cacheKey, fallback);
          }
          return fallback;
        })
        .catch(function () {
          // ConDataService error → fallback
          var fallback = _resolveFallback(unicodeId, lang);
          if (fallback) {
            _cacheResolved(cacheKey, fallback);
          }
          return fallback;
        });
    },

    /**
     * แก้ไขหลาย Unicode IDs พร้อมกัน
     *
     * @param {string[]} unicodeIds
     * @param {string} lang
     * @returns {Promise<Object[]>}
     */
    resolveItems: function (unicodeIds, lang) {
      if (!Array.isArray(unicodeIds)) return Promise.resolve([]);
      lang = lang || Config.SEO.DEFAULT_LANG;

      return Promise.all(
        unicodeIds.map(function (id) {
          return Resolver.resolveUnicodeId(id, lang);
        })
      ).then(function (results) {
        return results.filter(Boolean);
      });
    },

    /**
     * แก้ไข cover items ของ collection
     *
     * @param {string} collectionId
     * @param {string} lang
     * @returns {Promise<Object[]>}
     */
    resolveCoverItems: function (collectionId, lang) {
      return Loader.assemble().then(function () {
        var col = State.idIndex ? State.idIndex.get(collectionId) : null;
        if (!col || !col.cover || !Array.isArray(col.cover.items)) {
          return [];
        }
        return Resolver.resolveItems(col.cover.items, lang);
      });
    },

    /**
     * แก้ไข Unicode ID แบบ synchronous (สำหรับ build time)
     * ไม่ใช้ ConDataService — แปลง Unicode ID เป็นตัวอักษรโดยตรง
     *
     * @param {string} unicodeId — เช่น 'U+2764'
     * @returns {Object|null}
     */
    resolveStatic: function (unicodeId) {
      if (!unicodeId) return null;
      var char = _unicodeIdToChar(unicodeId);
      if (!char) return null;

      return {
        unicodeId: unicodeId,
        char: char,
        name: unicodeId,
        nameObj: {},
        api: unicodeId,
        text: char,
      };
    },
  };

  // ── Internal: ConDataService Resolution ────────────────────────────

  /**
   * พยายามแก้ไขผ่าน ConDataService
   * @param {string} unicodeId
   * @param {string} lang
   * @returns {Promise<Object|null>}
   * @private
   */
  function _resolveViaConDataService(unicodeId, lang) {
    if (!window.ConDataService || !window.ConDataService.resolveItem) {
      return Promise.resolve(null);
    }

    return window.ConDataService.resolveItem({ api: unicodeId, lang: lang })
      .then(function (item) {
        if (!item) return null;

        return {
          unicodeId: unicodeId,
          char: item.text || _unicodeIdToChar(unicodeId) || '',
          name: item.displayName || Reg.getName(item.name, lang),
          nameObj: item.name || {},
          api: unicodeId,
          text: item.text || _unicodeIdToChar(unicodeId) || '',
          _typeId: item._typeId || null,
          _catId: item._catId || null,
        };
      })
      .catch(function () {
        return null;
      });
  }

  /**
   * Fallback: แก้ไขโดยแปลง Unicode ID เป็นตัวอักษรโดยตรง
   * @param {string} unicodeId
   * @param {string} lang
   * @returns {Object|null}
   * @private
   */
  function _resolveFallback(unicodeId, lang) {
    var char = _unicodeIdToChar(unicodeId);
    if (!char) return null;

    return {
      unicodeId: unicodeId,
      char: char,
      name: unicodeId,
      nameObj: {},
      api: unicodeId,
      text: char,
      _typeId: null,
      _catId: null,
    };
  }

  /**
   * Cache resolved item
   * @param {string} key
   * @param {Object} item
   * @private
   */
  function _cacheResolved(key, item) {
    if (State.resolvedCache) {
      State.resolvedCache.set(key, item);
    }
  }

  // ── Export ─────────────────────────────────────────────────────────

  M.Resolver = Resolver;

})(window.CollectionModules = window.CollectionModules || {});
