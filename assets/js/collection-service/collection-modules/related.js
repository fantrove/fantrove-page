/**
 * related.js — อัลกอริทึมคอลเลกชันที่เกี่ยวข้อง (Related Collections Algorithm)
 *
 * Part of: Collection Service
 * Namespace: window.CollectionModules
 *
 * Dependencies: Phase 1-3 (config.js, state.js, loader.js, resolver.js)
 *
 * Public API:
 *   M.Related — computeRelated, computeRelatedSync
 *
 * Architecture (aerospace-grade):
 *   - Deterministic: ผลลัพธ์เดียวกันเสมอสำหรับ input เดียวกัน
 *   - Bounded: ไม่มี unbounded loops, จำนวน iterations จำกัด
 *   - No randomness: คะแนนคำนวณจากข้อมูล ไม่ใช่สุ่ม
 *   - Fail-safe: คืน empty array ถ้าเกิดข้อผิดพลาด
 *   - Bounded results: จำนวนผลลัพธ์สูงสุดถูกจำกัด
 *
 * Algorithm: Weighted Jaccard Similarity
 *   Signal 1: Shared Items (Jaccard Index) — 70% weight
 *   Signal 2: Category Affinity — 30% weight
 *   Signal 3: Co-occurrence (reserved for future) — 0% weight
 */

(function (M) {
  'use strict';

  var Config = M.Config;
  var State  = M.State;
  var Loader = M.Loader;

  // ── Constants ─────────────────────────────────────────────────────

  var WEIGHTS = M.Types.RELATED_WEIGHTS;
  var MAX_RESULTS = M.Types.RELATED_MAX_RESULTS;
  var MIN_SCORE = M.Types.RELATED_MIN_SCORE;

  // ── Related Module ────────────────────────────────────────────────

  var Related = {
    /**
     * คำนวณ related collections สำหรับ collection ที่ระบุ
     *
     * @param {string} collectionId
     * @param {number} maxResults — จำนวนผลลัพธ์สูงสุด (default 4, max 8)
     * @returns {Promise<Object[]>} — { id, name, score }[]
     */
    computeRelated: function (collectionId, maxResults) {
      return Loader.assemble().then(function () {
        return Related.computeRelatedSync(collectionId, maxResults);
      });
    },

    /**
     * คำนวณ related collections (synchronous version — ใช้เมื่อข้อมูลโหลดแล้ว)
     *
     * @param {string} collectionId
     * @param {number} maxResults
     * @returns {Object[]}
     */
    computeRelatedSync: function (collectionId, maxResults) {
      try {
        // BOUND: cap maxResults
        maxResults = Math.min(
          maxResults || Config.RELATED.DEFAULT_MAX_RESULTS,
          MAX_RESULTS
        );

        if (!State.assembled || !State.idIndex) return [];

        var source = State.idIndex.get(collectionId);
        if (!source) return [];

        // ตรวจ cache
        if (State.relatedCache && State.relatedCache.has(collectionId)) {
          var cached = State.relatedCache.get(collectionId);
          return cached.slice(0, maxResults);
        }

        var sourceItems = new Set(source.items);
        var sourceTypeCats = _computeTypeCatDistribution(source.items);

        var allCollections = State.assembled.collections || [];
        var scored = [];

        // BOUND: iterate over finite collections (typically < 50)
        for (var i = 0; i < allCollections.length; i++) {
          var target = allCollections[i];
          if (target.id === collectionId) continue; // skip self

          var targetItems = new Set(target.items);

          // Signal 1: Jaccard similarity on items
          var intersection = 0;
          sourceItems.forEach(function (id) {
            if (targetItems.has(id)) intersection++;
          });
          var union = sourceItems.size + targetItems.size - intersection;
          var jaccard = union > 0 ? intersection / union : 0;

          // Signal 2: Category affinity
          var targetTypeCats = _computeTypeCatDistribution(target.items);
          var catAffinity = _computeCatAffinity(sourceTypeCats, targetTypeCats);

          // Final score (deterministic)
          var score = WEIGHTS.JACCARD * jaccard +
                      WEIGHTS.CATEGORY_AFFINITY * catAffinity;

          // BOUND: only consider collections with score > threshold
          if (score > MIN_SCORE) {
            scored.push({
              id: target.id,
              name: target.name,
              score: score,
            });
          }
        }

        // Deterministic sort: by score descending, then by id ascending (tiebreak)
        scored.sort(function (a, b) {
          return b.score - a.score || a.id.localeCompare(b.id);
        });

        // BOUND: return at most maxResults
        var results = scored.slice(0, maxResults);

        // Cache
        if (State.relatedCache) {
          State.relatedCache.set(collectionId, results);
        }

        return results;
      } catch (e) {
        console.error('[CollectionService] computeRelated failed:', e);
        return [];
      }
    },
  };

  // ── Internal Helpers ──────────────────────────────────────────────

  /**
   * คำนวณ type/category distribution ของ Unicode IDs
   * ใช้ ConDataService index ถ้ามี, fallback เป็น empty object
   *
   * @param {string[]} items — Unicode IDs
   * @returns {Object} — { 'emoji/smileys_emotion': 3, ... }
   * @private
   */
  function _computeTypeCatDistribution(items) {
    var dist = {};
    if (!Array.isArray(items)) return dist;

    // พยายามใช้ ConDataService index
    var indexEngine = window.ConDataService && window.ConDataService._indexEngine
      ? null : null; // ConDataService ไม่เปิด _indexEngine เป็น public API

    // Fallback: ใช้ resolver cache ถ้ามี
    for (var i = 0; i < items.length; i++) {
      var id = items[i];
      // พยายามหา type/category จาก resolved cache
      if (State.resolvedCache) {
        var keys = Array.from(State.resolvedCache.keys());
        for (var j = 0; j < keys.length; j++) {
          if (keys[j].startsWith(id + '|')) {
            var resolved = State.resolvedCache.get(keys[j]);
            if (resolved && resolved._typeId && resolved._catId) {
              var key = resolved._typeId + '/' + resolved._catId;
              dist[key] = (dist[key] || 0) + 1;
            }
            break;
          }
        }
      }
    }

    return dist;
  }

  /**
   * คำนวณ category affinity ระหว่างสอง distributions
   *
   * @param {Object} distA
   * @param {Object} distB
   * @returns {number} — 0-1
   * @private
   */
  function _computeCatAffinity(distA, distB) {
    var keysA = Object.keys(distA);
    var keysB = Object.keys(distB);

    if (keysA.length === 0 && keysB.length === 0) return 0;

    var sharedCount = 0;
    var allKeys = new Set(keysA.concat(keysB));

    keysA.forEach(function (key) {
      if (distB[key]) sharedCount++;
    });

    return allKeys.size > 0 ? sharedCount / allKeys.size : 0;
  }

  // ── Export ─────────────────────────────────────────────────────────

  M.Related = Related;

})(window.CollectionModules = window.CollectionModules || {});
