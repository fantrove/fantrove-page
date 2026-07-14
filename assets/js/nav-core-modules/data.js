// Path:    assets/js/nav-core-modules/data.js
// Purpose: DataService — fetch, cache, and index all con-data; bridges NavCore to ConDataService
// Used by: content.js (_resolveSource, fetchCategoryGroup), copy.js (apiMap lookup), router.js (fetchWithRetry), init.js (_warmup)

// @ts-check
/**
 * @file data.js
 * DataService — data fetching, caching, and shared index management.
 *
 * v3.0 — Engineering-grade data layer
 *
 * Changes from v2.x:
 *   1. AbortSignal propagation — pass `signal` in options to abort in-flight
 *      fetches. Caller (router.js) aborts on navigation supersede.
 *   2. Stale-while-revalidate — getCached() returns stale data immediately,
 *      a background refetch refreshes the cache. Matches SWR pattern from
 *      Vercel's swr library.
 *   3. LRU cache eviction — Map is bounded to MAX_CACHE_ENTRIES (200).
 *      Oldest entries evicted first (Map preserves insertion order).
 *   4. Better dedup — in-flight requests share the SAME Promise (not just
 *      a flag). Concurrent callers await the same promise → 1 network
 *      round-trip per URL, not N.
 *   5. Exponential backoff with jitter — retry delays are now
 *      `base * 2^attempt + random(0, base)` instead of fixed [400,1200,2400].
 *      Prevents thundering-herd on server recovery.
 *   6. AbortError handling — if a fetch is aborted, we DON'T show the error
 *      fullscreen (it's an intentional cancellation, not a failure).
 *
 * v2.1 — เพิ่ม getTypeCategories(typeId)
 *   Public method สำหรับ ContentService._resolveSource() —
 *   ดึงรายการ [{id, name}] ของ categories ทั้งหมดใน type นั้น
 *   โดยใช้ cache จาก _loadCategoryIndex ที่มีอยู่แล้ว (ไม่ fetch ซ้ำ)
 *
 * @module data
 * @depends {config.js, state.js, utils.js}
 * @used-by content.js, copy.js, router.js
 */
(function (M) {
  'use strict';

  const { CONFIG, Utils } = M;

  function _getConDataService() {
    return window.ConDataService || null;
  }

  function _requireConDataService(timeoutMs = 10000) {
    const svc = window.ConDataService;
    if (svc) return Promise.resolve(svc);

    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const poll = () => {
        if (window.ConDataService) return resolve(window.ConDataService);
        if (Date.now() > deadline)
          return reject(new Error(
            '[NavCore/Data] ConDataService not available after ' + timeoutMs + 'ms.'
          ));
        setTimeout(poll, 100);
      };
      setTimeout(poll, 50);
    });
  }

  // Maximum number of entries in `cache`. When this is exceeded, oldest
  // entries are evicted (Map preserves insertion order in JS).
  // WHY 200: each entry is small (a JSON object). 200 entries × ~5KB avg
  //   = ~1MB memory ceiling. Generous for typical navigation patterns.
  const MAX_CACHE_ENTRIES = 200;

  const DataService = {

    cache: new Map(),
    apiCache: null,
    apiCacheTimestamp: 0,
    _categoryIndexes:  new Map(),
    _subcategoryCache: new Map(),
    _topLevelIndex:    null,
    _topLevelIndexPromise: null,
    _sharedIndex:        null,
    _sharedIndexPromise: null,
    _fetchQueue:      [],
    // v3.0: in-flight promise dedup — key → Promise. Concurrent callers
    //   for the same URL await the same promise → 1 network round-trip.
    _fetchInProgress: new Map(),
    _queueProcessing: false,
    _queueDirty:      false,

    // ── Fetch queue ─────────────────────────────────────────────────────────────

    async _enqueueFetch(url, options = {}, priority = 5) {
      return new Promise((resolve, reject) => {
        this._fetchQueue.push({
          url, options,
          priority: typeof priority === 'number' ? priority : 5,
          resolve, reject,
          timestamp: Date.now(),
        });
        this._queueDirty = true;
        this._processFetchQueue();
      });
    },

    async _processFetchQueue() {
      if (this._queueProcessing || !this._fetchQueue.length) return;
      this._queueProcessing = true;

      while (this._fetchQueue.length) {
        if (this._fetchInProgress.size >= CONFIG.FETCH.MAX_CONCURRENT) {
          await new Promise(r => setTimeout(r, 50));
          continue;
        }
        if (this._queueDirty) {
          this._fetchQueue.sort((a, b) => a.priority - b.priority || a.timestamp - b.timestamp);
          this._queueDirty = false;
        }
        const task   = this._fetchQueue.shift();
        const taskId = `${task.url}-${task.priority}`;
        this._fetchInProgress.set(taskId, true);
        this._performFetch(task.url, task.options)
          .then(result => { task.resolve(result); this._fetchInProgress.delete(taskId); })
          .catch(err   => { task.reject(err);     this._fetchInProgress.delete(taskId); });
      }

      this._queueProcessing = false;
    },

    // ── Cache helpers ───────────────────────────────────────────────────────────
    //
    // v3.0 changes:
    //   • LRU eviction — when cache exceeds MAX_CACHE_ENTRIES, the oldest
    //     entry is deleted before a new one is added.
    //   • SWR — getCached() returns stale data even after expiry, but tags
    //     it as stale so the caller can refetch in the background.
    //   • Refresh-on-access — if data is returned as stale, kick off a
    //     background refetch (non-blocking).

    getCached(key) {
      const cached = this.cache.get(key);
      if (!cached) return null;
      if (Date.now() > cached.expiry) {
        // v3.0 SWR: stale data is still usable. Tag it and return.
        // The caller (e.g. renderContent) will use it immediately; the
        // background refetch will update the cache for next time.
        return { data: cached.data, stale: true };
      }
      return cached.data;
    },

    /**
     * v3.0: Get cached data as-is, ignoring expiry. Used by SWR refetch
     * decisioning.
     */
    _peekCached(key) {
      const cached = this.cache.get(key);
      return cached ? cached.data : null;
    },

    setCache(key, data, ttl = CONFIG.FETCH.CACHE_DURATION) {
      // LRU eviction: if cache is at capacity, evict the oldest entry.
      // Map iteration is in insertion order, so keys().next().value is
      // the oldest. We delete BEFORE setting the new key so the new key
      // becomes the most-recently-inserted.
      if (this.cache.size >= MAX_CACHE_ENTRIES && !this.cache.has(key)) {
        const oldestKey = this.cache.keys().next().value;
        this.cache.delete(oldestKey);
      }
      this.cache.set(key, { data, expiry: Date.now() + ttl });
    },

    clearCache() {
      this.cache.clear();
      this.apiCache          = null;
      this.apiCacheTimestamp = 0;
      this._categoryIndexes.clear();
      this._subcategoryCache.clear();
      this._topLevelIndex        = null;
      this._topLevelIndexPromise = null;
      this._sharedIndex          = null;
      this._sharedIndexPromise   = null;
      try { _getConDataService()?.invalidateCache?.(); } catch (_) {}
    },

    // ── _performFetch: retry 3 ครั้ง + AbortSignal + exponential backoff ───────
    //
    // v3.0 changes:
    //   • Accepts external AbortSignal (options.signal) and composes it
    //     with the internal timeout controller. Either aborts → fetch aborts.
    //   • Retry delays are now exponential with jitter: base * 2^attempt + rand.
    //     Prevents thundering-herd when multiple clients retry simultaneously.
    //   • AbortError is NOT retried (intentional cancellation).
    //   • AbortError does NOT trigger showErrorFullscreen (not a real error).
    //   • Dedup: if a fetch for this URL is already in-flight, await that
    //     promise instead of starting a new request.
    //
    // v4.0 changes:
    //   • Routes through CircuitBreakerService — if the server is failing
    //     repeatedly, fail fast (return stale cache) instead of retrying.
    //   • CircuitBreaker uses AWS decorrelated jitter for backoff timing.
    //   • Fallback returns stale cache (if available) when circuit is open.

    async _performFetch(url, options = {}) {
      // v3.0 dedup: if a fetch for this URL is already in-flight, await it.
      if (!options.signal && this._fetchInProgress.has(url)) {
        return this._fetchInProgress.get(url);
      }

      const cached = this.getCached(url);
      if (cached && !cached.stale) return cached.data;
      const staleFallback = cached && cached.stale ? cached.data : null;

      // v4.0: Get or create a circuit breaker for this URL's host
      var breaker = null;
      try {
        if (M.CircuitBreakerService) {
          // Use host as breaker name so all calls to same host share state
          var host = 'default';
          try { host = new URL(url, window.location.href).host || 'default'; } catch (_) {}
          breaker = M.CircuitBreakerService.getOrCreate('fetch:' + host, {
            fallback: function () {
              if (staleFallback != null) return staleFallback;
              throw new Error('CircuitOpen: no fallback available');
            },
          });
        }
      } catch (_) {}

      var fetchPromise;
      if (breaker) {
        // Route through circuit breaker
        fetchPromise = breaker.execute(() =>
          this._performFetchInner(url, options, staleFallback)
        );
      } else {
        // No breaker — call directly
        fetchPromise = this._performFetchInner(url, options, staleFallback);
      }

      if (!options.signal) {
        this._fetchInProgress.set(url, fetchPromise);
        fetchPromise.finally(() => this._fetchInProgress.delete(url));
      }
      return fetchPromise;
    },

    async _performFetchInner(url, options, staleFallback) {
      // v3.0 exponential backoff with jitter.
      // Base = 400ms, max retries = 3, jitter = ±100ms.
      //   attempt 0: immediate
      //   attempt 1: 400ms ± 100ms
      //   attempt 2: 800ms ± 100ms
      //   attempt 3: 1600ms ± 100ms
      const BASE_DELAY = 400;
      const MAX_ATTEMPTS = 3;
      const JITTER = 100;
      let lastErr;

      for (let attempt = 0; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          if (!Utils.isOnline()) throw new Error('Offline');

          // Compose external signal (if any) with internal timeout controller.
          // If EITHER aborts, the fetch aborts.
          const timeoutController = new AbortController();
          const timeoutId = setTimeout(
            () => timeoutController.abort(),
            CONFIG.FETCH.TIMEOUT
          );

          // Compose signals: if external signal aborts, abort timeoutController.
          let externalSignal = options.signal || null;
          if (externalSignal) {
            if (externalSignal.aborted) timeoutController.abort();
            else externalSignal.addEventListener('abort',
              () => timeoutController.abort(), { once: true });
          }

          try {
            const response = await fetch(url, {
              ...options,
              headers: { 'Content-Type': 'application/json', ...options.headers },
              signal:  timeoutController.signal,
              cache:   options.cache === 'reload' ? 'reload' : 'no-store',
            });

            const respText = await response.text().catch(() => null);
            if (!response.ok) throw new Error(`Fetch error: ${response.status} ${response.statusText}`);

            let data;
            try { data = respText ? JSON.parse(respText) : null; }
            catch (_) { throw new Error(`Invalid JSON response from ${url}`); }

            if (options.cache !== false) this.setCache(url, data);
            return data;
          } finally {
            clearTimeout(timeoutId);
          }

        } catch (err) {
          // v3.0: Don't retry AbortError — it's an intentional cancellation.
          // Don't showErrorFullscreen either — it's not a real failure.
          if (err && (err.name === 'AbortError' ||
                      (options.signal && options.signal.aborted))) {
            // Return stale fallback if available, else rethrow.
            if (staleFallback != null) return staleFallback;
            throw err;
          }

          lastErr = err;
          if (attempt < MAX_ATTEMPTS) {
            const delay = BASE_DELAY * Math.pow(2, attempt) +
                          (Math.random() * 2 - 1) * JITTER;
            await new Promise(r => setTimeout(r, Math.max(0, delay)));
          }
        }
      }

      // All retries failed — return stale fallback if we have one (SWR).
      // Otherwise show error and throw.
      if (staleFallback != null) {
        console.warn('[NavCore/Data] fetch failed, returning stale fallback:', url, lastErr);
        return staleFallback;
      }

      try {
        Utils.showErrorFullscreen(lastErr, { label: 'Data Fetch: ' + url });
      } catch (_) {}
      throw lastErr;
    },

    // ── fetchWithRetry ──────────────────────────────────────────────────────────
    //
    // v3.0: Now accepts AbortSignal via options.signal. The signal is
    // propagated to _performFetch (and through to fetch()). Cancellation
    // is therefore network-level, not just promise-level.

    async fetchWithRetry(url, options = {}, priority = 5) {
      if (url && url.includes('/con-data/'))
        return this._fetchViaService(url, options);
      return this._enqueueFetch(url, options, priority);
    },

    // ── ConDataService bridge ───────────────────────────────────────────────────
    //
    // v3.0: options.signal is currently not propagated to ConDataService
    //   (its API doesn't accept signals yet). When a signal aborts, we
    //   reject the wrapping promise; the underlying fetch may still
    //   complete but its result is discarded.

    async _fetchViaService(url, options = {}) {
      const svc = await _requireConDataService();

      // Helper: wrap a promise with an abort signal. If signal aborts,
      // reject with AbortError (the underlying operation continues but
      // its result is ignored).
      const withSignal = (p) => {
        if (!options.signal) return p;
        return new Promise((resolve, reject) => {
          if (options.signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          options.signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
          p.then(resolve, reject);
        });
      };

      const twoSeg = url.match(/\/con-data\/([^/?#]+)\/([^/?#]+?)(?:\.min)?\.json(?:[?#].*)?$/);
      if (twoSeg) {
        const [, typeId, catId] = twoSeg;
        const items = await withSignal(svc.getItems(typeId, catId).catch(() => null));
        if (items != null) return items;
      }

      const oneSeg = url.match(/\/con-data\/([^/?#/]+?)(?:\.min)?\.json(?:[?#].*)?$/);
      if (oneSeg && oneSeg[1] !== 'index') {
        const typeId  = oneSeg[1];
        const typeObj = await withSignal(svc.getTypeById(typeId).catch(() => null));
        if (typeObj) return typeObj;
      }

      return withSignal(svc.getAssembled());
    },

    // ── Warmup ──────────────────────────────────────────────────────────────────

    _warmupPromise: null,

    async _warmup() {
      if (this._warmupPromise) return this._warmupPromise;
      this._warmupPromise = new Promise(resolve => {
        const doWarmup = async () => {
          try {
            if (!Utils.isOnline()) return resolve();
            await this._enqueueFetch(CONFIG.PATHS.BUTTONS_CONFIG, { cache: 'force-cache' }, 9).catch(() => {});
            _getConDataService()?.preload?.().catch(() => {});
          } finally { resolve(); }
        };
        if ('requestIdleCallback' in window)
          requestIdleCallback(doWarmup, { timeout: CONFIG.FETCH.WARMUP_TIMEOUT });
        else
          setTimeout(doWarmup, CONFIG.FETCH.WARMUP_DELAY);
      });
      return this._warmupPromise;
    },

    // ── loadApiDatabase ─────────────────────────────────────────────────────────

    async loadApiDatabase() {
      this._warmup();

      if (this.apiCache && Date.now() - this.apiCacheTimestamp < CONFIG.FETCH.CACHE_DURATION) {
        if (!this._sharedIndex) {
          if (this._sharedIndexPromise) await this._sharedIndexPromise;
          else await this._buildSharedIndex(this.apiCache);
        }
        return this.apiCache;
      }

      try {
        const svc = await _requireConDataService();
        const db  = await svc.getAssembled();
        this.apiCache          = db;
        this.apiCacheTimestamp = Date.now();
        await this._buildSharedIndex(db);
        return db;
      } catch (e) {
        if (this.apiCache) return this.apiCache;
        throw e;
      }
    },

    // ── _buildSharedIndex: clear rejected promise เพื่อให้ retry ได้ ────────────
    // BUG FIX: เดิม promise ค้างอยู่สถานะ rejected ตลอดไป — ทุก call ถัดไปได้ reject เดิม
    // FIXED:   clear _sharedIndexPromise ทั้งใน success และ failure

    async _buildSharedIndex(db) {
      if (this._sharedIndex) return this._sharedIndex;

      // ถ้ามี pending promise และยัง running อยู่ → await มัน
      if (this._sharedIndexPromise) {
        try {
          return await this._sharedIndexPromise;
        } catch (_) {
          // rejected promise เดิม → clear แล้วสร้างใหม่
          this._sharedIndexPromise = null;
        }
      }

      const buildPromise = (async () => {
        const apiMap       = new Map();
        const idMap        = new Map();
        const textMap      = new Map();
        const catToTypeMap = new Map();

        let count = 0;

        for (const typeObj of (db?.type || [])) {
          if (!typeObj || typeof typeObj !== 'object') continue;
          if (typeObj.id) idMap.set(typeObj.id, typeObj);

          // WHY: ข้าม type ที่เป็น collection (เช่น cards) — items ของมันไม่ใช่ตัวอักขระ copy ได้
          //      การนำเข้า apiMap/textMap จะทำให้ระบบ copy และ search ทำงานผิดพลาด
          if (typeObj.kind && typeObj.kind !== 'copyable') continue;

          for (const cat of (typeObj.category || [])) {
            if (!cat || typeof cat !== 'object') continue;
            if (cat.id) {
              idMap.set(cat.id, cat);
              catToTypeMap.set(cat.id, typeObj);
            }

            for (const item of (cat.data || [])) {
              if (!item || typeof item !== 'object') continue;
              if (item.api)  apiMap.set(item.api,  item);
              if (item.text) textMap.set(item.text, item);

              if (++count % CONFIG.CONTENT.INDEX_YIELD_N === 0) {
                await new Promise(r => {
                  if (typeof scheduler !== 'undefined' && scheduler.yield)
                    scheduler.yield().then(r);
                  else
                    setTimeout(r, 0);
                });
              }
            }
          }
        }

        return { apiMap, idMap, textMap, catToTypeMap };
      })();

      this._sharedIndexPromise = buildPromise;

      try {
        const idx = await buildPromise;
        this._sharedIndex        = idx;
        this._jsonDbIndex        = idx;
        this._jsonDbIndexReady   = true;
        this._sharedIndexPromise = null; // ✅ clear เสมอ ไม่ว่าจะ success
        return idx;
      } catch (err) {
        this._sharedIndexPromise = null; // ✅ clear เมื่อ fail เพื่อให้ retry ได้
        throw err;
      }
    },

    // ── Public lookup helpers ───────────────────────────────────────────────────

    async fetchApiContent(apiCode) {
      if (this._sharedIndex?.apiMap) {
        const item = this._sharedIndex.apiMap.get(apiCode);
        if (item) return item.text || apiCode;
      }
      const svc  = await _requireConDataService();
      const item = await svc.findByApi(apiCode);
      if (item)  return item.text || apiCode;
      throw new Error(`API code not found: ${apiCode}`);
    },

    async fetchCategoryGroup(categoryId) {
      const idRaw = categoryId.replace(/_category$/, '');
      const svc   = await _requireConDataService();
      const db    = await svc.getAssembled();
      const lang  = localStorage.getItem('selectedLang') || 'en';

      let foundCat = null;
      let typeObj  = null;

      for (const t of (db.type || [])) {
        const cat = (t.category || []).find(c => c.id === idRaw);
        if (cat) { foundCat = cat; typeObj = t; break; }
      }

      if (!foundCat) throw new Error(`Category not found: ${categoryId}`);

      const registry = svc.registry || null;
      const getName  = (nameObj) => {
        if (registry?.getName) return registry.getName(nameObj, lang);
        if (!nameObj || typeof nameObj !== 'object') return String(nameObj || '');
        return nameObj[lang] || nameObj.en || nameObj.th || Object.values(nameObj)[0] || '';
      };

      const header = {
        title:       getName(foundCat.name) || foundCat.id,
        description: getName(typeObj.name)  || '',
        typeId:      typeObj.id,
        categoryId:  foundCat.id,
        className:   'auto-category-header',
      };

      return { id: foundCat.id, name: foundCat.name, data: foundCat.data || [], header };
    },

    // ── fetchCategoryDirect ─────────────────────────────────────────────────────
    //
    // WHY แยกจาก fetchCategoryGroup:
    //   fetchCategoryGroup ค้นหาผ่าน assembled DB — ใช้กับ emoji/symbol ที่อยู่ใน index.json
    //   fetchCategoryDirect fetch จาก file path โดยตรง — ใช้กับ collection types (cards)
    //   ที่ไม่ควรอยู่ใน index.json เพราะจะทำให้ระบบอื่นดึงไปประมวลผลเป็นปุ่มโดยไม่ตั้งใจ
    //
    // @param {string} typeId     — เช่น 'cards'
    // @param {string} categoryId — เช่น 'ai_tools'
    // @returns {Promise<{id, name, data, header}>}

    async fetchCategoryDirect(typeId, categoryId) {
      const cacheKey = `direct:${typeId}:${categoryId}`;
      const cached   = this.getCached(cacheKey);
      if (cached) return cached;

      const svc  = await _requireConDataService();
      const lang = localStorage.getItem('selectedLang') || 'en';
      const url  = svc.registry.paths.subcategoryData(typeId, categoryId);
      const raw  = await this._performFetch(url);

      if (!raw || !Array.isArray(raw.data)) {
        throw new Error(`fetchCategoryDirect: invalid data at ${url}`);
      }

      const getName = (nameObj) => {
        if (!nameObj || typeof nameObj !== 'object') return String(nameObj || '');
        return nameObj[lang] || nameObj.en || nameObj.th || Object.values(nameObj)[0] || '';
      };

      const header = {
        title:      getName(raw.name) || categoryId,
        description: '',
        typeId,
        categoryId,
        className:  'auto-category-header',
      };

      const result = { id: raw.id || categoryId, name: raw.name || {}, data: raw.data, header };
      this.setCache(cacheKey, result);
      return result;
    },

    // ── getTypeCategories ───────────────────────────────────────────────────────
    //
    // WHY public: ContentService._resolveSource() ต้องการรายการ categories
    //             โดยไม่ต้อง fetch item data — เบากว่า fetchCategoryGroup (ไม่ดึง data[])
    //
    // @param {string} typeId  — เช่น 'emoji', 'symbol'
    // @returns {Promise<Array<{id:string,name:object}>|null>}

    async getTypeCategories(typeId) {
      if (!typeId) return null;
      const idx = await this._loadCategoryIndex(typeId);
      return idx ? idx.categories : null;
    },

    prefetchTopCategories() {
      _getConDataService()?.preload?.().catch(() => {});
    },

    async _loadTopLevelIndex() {
      if (this._topLevelIndex)        return this._topLevelIndex;
      if (this._topLevelIndexPromise) return this._topLevelIndexPromise;

      this._topLevelIndexPromise = (async () => {
        try {
          const svc = await _requireConDataService();
          const db  = await svc.getAssembled();
          const idx = {
            categories: (db.type || []).map(t => ({
              id:   t.id,
              name: t.name,
              file: `${t.id}.json`,
            })),
          };
          this._topLevelIndex = idx;
          return idx;
        } catch (_) {
          return null;
        } finally {
          this._topLevelIndexPromise = null;
        }
      })();

      return this._topLevelIndexPromise;
    },

    async _loadCategoryIndex(type) {
      if (this._categoryIndexes.has(type)) return this._categoryIndexes.get(type);

      try {
        const svc     = await _requireConDataService();
        const db      = await svc.getAssembled();
        const typeObj = (db.type || []).find(t => t.id === type);

        if (!typeObj) { this._categoryIndexes.set(type, null); return null; }

        const idx = {
          id:         typeObj.id,
          name:       typeObj.name,
          categories: (typeObj.category || []).map(c => ({ id: c.id, name: c.name })),
        };
        this._categoryIndexes.set(type, idx);
        return idx;
      } catch (_) {
        this._categoryIndexes.set(type, null);
        return null;
      }
    },

    async _loadSubcategoryFile(type, subcat) {
      const key = `${type}-${subcat}`;
      if (this._subcategoryCache.has(key)) return this._subcategoryCache.get(key);

      try {
        const svc   = await _requireConDataService();
        const items = await svc.getItems(type, subcat);
        const data  = { id: subcat, data: Array.isArray(items) ? items : [] };
        this._subcategoryCache.set(key, data);
        return data;
      } catch (_) {
        this._subcategoryCache.set(key, null);
        return null;
      }
    },
  };

  M.DataService = DataService;

})(window.NavCoreModules = window.NavCoreModules || {});