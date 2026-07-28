/**
 * loader.js — Fetch Engine + Assembly Pipeline สำหรับ Collection data
 *
 * Part of: Collection Service
 * Namespace: window.CollectionModules
 *
 * Dependencies: Phase 1 (config.js, state.js), registry.js
 *
 * Public API:
 *   M.Loader — fetch, assemble, invalidate, status
 *
 * Architecture (aerospace-grade):
 *   - Deduplication: Promise is shared across concurrent calls
 *   - Caching: TTL-based cache with automatic invalidation
 *   - Timeout: AbortController for network timeouts
 *   - Validation: Schema validation on every loaded dataset
 *   - Fail-safe: Graceful degradation on any error
 */

(function (M) {
  'use strict';

  var Config = M.Config;
  var State  = M.State;
  var Reg    = M.Registry;

  // ── Internal Fetch Engine ──────────────────────────────────────────

  var _fetcher = {
    _cache: new Map(),
    _pending: new Map(),
    _CACHE_TTL: Config.FETCH.CACHE_TTL_MS,
    _TIMEOUT_MS: Config.FETCH.TIMEOUT_MS,

    /**
     * ตรวจสอบว่า cache entry ยังใช้ได้หรือไม่
     * @param {Object} entry
     * @returns {boolean}
     * @private
     */
    _isCacheValid: function (entry) {
      return entry && (Date.now() - entry.ts) < this._CACHE_TTL;
    },

    /**
     * Fetch URL พร้อม cache + dedup + timeout
     * @param {string} url
     * @returns {Promise<Object>}
     */
    fetch: function (url) {
      var self = this;

      // ตรวจ cache ก่อน
      var cached = this._cache.get(url);
      if (this._isCacheValid(cached)) return Promise.resolve(cached.data);

      // ตรวจ pending request (dedup)
      if (this._pending.has(url)) return this._pending.get(url);

      var promise = new Promise(function (resolve, reject) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, self._TIMEOUT_MS);

        fetch(url, {
          signal: controller.signal,
          headers: { 'Accept': 'application/json' },
        })
          .then(function (resp) {
            clearTimeout(timer);
            if (!resp.ok) {
              throw new Error('HTTP ' + resp.status + ' — ' + url);
            }
            return resp.text();
          })
          .then(function (text) {
            var data;
            try {
              data = JSON.parse(text);
            } catch (e) {
              throw new Error('Invalid JSON at ' + url + ': ' + text.slice(0, 200));
            }
            self._cache.set(url, { data: data, ts: Date.now() });
            resolve(data);
          })
          .catch(function (err) {
            clearTimeout(timer);
            reject(err);
          })
          .finally(function () {
            self._pending.delete(url);
          });
      });

      this._pending.set(url, promise);
      return promise;
    },

    /**
     * ลบ cache เฉพาะ URL
     * @param {string} url
     */
    invalidate: function (url) { this._cache.delete(url); },

    /**
     * ลบ cache ทั้งหมด
     */
    invalidateAll: function () { this._cache.clear(); },

    /**
     * ดึงขนาด cache
     * @returns {number}
     */
    getCacheSize: function () { return this._cache.size; },
  };

  // ── Assembly Pipeline ─────────────────────────────────────────────

  var Loader = {
    /**
     * โหลดและประกอบข้อมูล collections ทั้งหมด
     * @returns {Promise<{ collections: Object[] }>}
     */
    assemble: function () {
      // ถ้ามีข้อมูลอยู่แล้ว → คืนเลย
      if (State.assembled) return Promise.resolve(State.assembled);

      // ถ้ากำลังโหลดอยู่ → รอ promise เดิม (dedup)
      if (State.assemblePromise) return State.assemblePromise;

      State.isLoading = true;

      State.assemblePromise = _loadAndAssemble()
        .then(function (result) {
          State.assembled = result;
          State.isLoading = false;
          State.isReady = true;
          State.assemblePromise = null;
          State.buildIndexes(result);
          return result;
        })
        .catch(function (err) {
          State.isLoading = false;
          State.assemblePromise = null;
          console.error('[CollectionService] Assembly failed:', err);
          throw err;
        });

      return State.assemblePromise;
    },

    /**
     * ลบ cache และ reset state ทั้งหมด
     */
    invalidate: function () {
      State.reset();
      _fetcher.invalidateAll();
    },

    /**
     * ดึงสถานะปัจจุบัน
     * @returns {Object}
     */
    status: function () {
      return {
        isReady: State.isReady,
        isLoading: State.isLoading,
        cacheSize: _fetcher.getCacheSize(),
        collectionCount: State.idIndex ? State.idIndex.size : 0,
      };
    },
  };

  // ── Internal: Load and Assemble ───────────────────────────────────

  /**
   * โหลด collections.json แล้วโหลดแต่ละ collection file
   * @returns {Promise<{ collections: Object[] }>}
   * @private
   */
  function _loadAndAssemble() {
    // 1. โหลด type index
    return _fetcher.fetch(Reg.paths.collectionsIndex())
      .then(function (rawIndex) {
        if (!Reg.validate.collectionsIndex(rawIndex)) {
          throw new Error('collections.json: invalid structure');
        }

        var index = Reg.normalize.collectionsIndex(rawIndex);
        var categories = index.categories || [];

        // 2. โหลดแต่ละ collection file (parallel)
        return Promise.all(
          categories.map(function (catEntry) {
            return _fetchCollectionData(catEntry);
          })
        );
      })
      .then(function (results) {
        // 3. กรอง null entries และสร้าง assembled object
        var collections = results.filter(Boolean);
        return { collections: collections };
      });
  }

  /**
   * โหลด collection data file เดียว
   * @param {Object} catEntry — { id, name, file }
   * @returns {Promise<Object|null>}
   * @private
   */
  function _fetchCollectionData(catEntry) {
    var filePath = catEntry.file
      ? (catEntry.file.startsWith('/') ? catEntry.file : Config.PATHS.BASE_PATH + '/' + catEntry.file)
      : Reg.paths.collectionData(catEntry.id);

    return _fetcher.fetch(filePath)
      .then(function (rawData) {
        if (!Reg.validate.collectionData(rawData)) {
          console.warn('[CollectionService] Invalid collection data:', catEntry.id);
          return null;
        }
        return Reg.normalize.collectionData(rawData);
      })
      .catch(function (err) {
        console.warn('[CollectionService] Failed to load collection:', catEntry.id, err.message);
        return null;
      });
  }

  // ── Export ─────────────────────────────────────────────────────────

  M.Loader = Loader;

})(window.CollectionModules = window.CollectionModules || {});
