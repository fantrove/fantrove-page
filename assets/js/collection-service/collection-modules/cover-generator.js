/**
 * cover-generator.js — ระบบสร้างภาพปกอัตโนมัติ (Auto Cover Generator)
 *
 * Part of: Collection Service
 * Namespace: window.CollectionModules
 *
 * Dependencies: Phase 1-2 (config.js, state.js, registry.js, loader.js)
 *
 * Public API:
 *   M.CoverGenerator — generateCoverHtml, generateCoverHtmlStatic, selectLayout
 *
 * Architecture:
 *   - สร้างภาพปกจาก Unicode characters โดยใช้ CSS Grid (ไม่ใช้ไฟล์รูป)
 *   - Deterministic: collection เดียวกัน → ปกเดียวกันเสมอ
 *   - 4 layout strategies: grid, row, spiral, mosaic
 *   - รองรับทั้ง runtime (DOM) และ build time (static HTML string)
 *   - ไม่ใช้ทรัพยากรมาก (ไม่ต้องโหลดรูปภาพ)
 */

(function (M) {
  'use strict';

  var Config = M.Config;
  var State  = M.State;
  var Loader = M.Loader;
  var Reg    = M.Registry;

  // ── Layout Selection ──────────────────────────────────────────────

  /**
   * เลือก layout ที่เหมาะสมตามจำนวน items
   * Deterministic: จำนวนเดียวกัน → layout เดียวกันเสมอ
   *
   * @param {Object} coverConfig — cover configuration
   * @param {number} itemCount — จำนวน items
   * @returns {string} — layout name
   */
  function selectLayout(coverConfig, itemCount) {
    // ถ้าระบุ layout ชัดเจน → ใช้ตามนั้น
    if (coverConfig && coverConfig.layout) return coverConfig.layout;

    // Auto-select ตามจำนวน
    if (itemCount <= Config.COVER.ROW_MAX_ITEMS) return 'row';
    if (itemCount <= Config.COVER.GRID_MAX_ITEMS) return 'grid';
    if (itemCount <= Config.COVER.SPIRAL_MAX_ITEMS) return 'spiral';
    return 'mosaic';
  }

  // ── Cover Generator Module ────────────────────────────────────────

  var CoverGenerator = {
    /**
     * สร้าง cover HTML สำหรับ collection (runtime)
     *
     * @param {string} collectionId
     * @returns {Promise<string>} — HTML string
     */
    generateCoverHtml: function (collectionId) {
      return Loader.assemble().then(function () {
        var col = State.idIndex ? State.idIndex.get(collectionId) : null;
        if (!col) return '';

        // ตรวจ cache
        if (State.coverCache && State.coverCache.has(collectionId)) {
          return State.coverCache.get(collectionId);
        }

        // Resolve cover items
        var coverItems = col.cover && col.cover.items ? col.cover.items : [];
        var resolvedChars = [];

        for (var i = 0; i < coverItems.length; i++) {
          var id = coverItems[i];
          var char = _unicodeIdToChar(id);
          if (char) resolvedChars.push(char);
        }

        var html = CoverGenerator.generateCoverHtmlStatic(col, resolvedChars);

        // Cache
        if (State.coverCache) {
          State.coverCache.set(collectionId, html);
        }

        return html;
      });
    },

    /**
     * สร้าง cover HTML แบบ static (ไม่ต้องมี DOM)
     * ใช้สำหรับ build time และ runtime
     *
     * @param {Object} collection — CollectionData object
     * @param {string[]} resolvedChars — resolved characters array
     * @returns {string} — HTML string
     */
    generateCoverHtmlStatic: function (collection, resolvedChars) {
      if (!collection || !Array.isArray(resolvedChars) || resolvedChars.length === 0) {
        return '';
      }

      var coverItems = collection.cover && collection.cover.items ? collection.cover.items : [];
      var displayChars = resolvedChars.slice(0, Config.COVER.MAX_COVER_ITEMS);
      var layout = selectLayout(collection.cover, displayChars.length);
      var name = Reg.getName(collection.name, 'en');

      var html = '<div class="collection-cover" role="img" aria-label="' +
        _escapeAttr(name) + ' collection preview">';

      // Background gradient
      html += '<div class="cover-bg cover-bg--' + _escapeAttr(layout) + '">';

      // Characters container
      html += '<div class="cover-grid cover-grid--' + _escapeAttr(layout) +
        ' cover-grid--' + displayChars.length + '">';

      for (var i = 0; i < displayChars.length; i++) {
        html += '<span class="cover-char" style="--cover-char-index:' + i + '">' +
          _escapeHtml(displayChars[i]) + '</span>';
      }

      html += '</div>'; // /cover-grid
      html += '</div>'; // /cover-bg
      html += '</div>'; // /collection-cover

      return html;
    },

    /**
     * เลือก layout ที่เหมาะสม (public API)
     */
    selectLayout: selectLayout,
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

  /**
   * Escape HTML special characters
   * @param {string} str
   * @returns {string}
   * @private
   */
  function _escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Escape HTML attribute value
   * @param {string} str
   * @returns {string}
   * @private
   */
  function _escapeAttr(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ── Export ─────────────────────────────────────────────────────────

  M.CoverGenerator = CoverGenerator;

})(window.CollectionModules = window.CollectionModules || {});
