// @ts-check
/**
 * @file data.js
 * DataService — data fetching, caching, and shared index management.
 *
 * Architecture:
 *   fetchWithRetry()       → fetch queue (max-concurrent=2) or ConDataService bridge
 *   loadApiDatabase()      → assembles DB from ConDataService + builds shared index
 *   _buildSharedIndex()    → structured walk of type→category→data, yields every 500 items
 *   fetchCategoryGroup()   → resolves category items + header from assembled DB
 *
 * ConDataService interface (matches con-data-service.js v2.0.0):
 *   getAssembled()              → { type: [{ id, name, category: [{ id, name, data: items[] }] }] }
 *   getItems(typeId, catId)     → item[]   — raw items for a specific category
 *   getTypeById(typeId)         → typeObj  — full type object with category[]
 *   findByApi(apiCode)          → enriched item | null
 *   findByText(text)            → enriched item | null
 *   invalidateCache()           → void
 *   preload()                   → Promise<void>
 *   registry.getName(obj, lang) → string
 *
 * Index structure (DataService._sharedIndex):
 *   apiMap       Map<api,   item>    — O(1) lookup by API code
 *   idMap        Map<id,    node>    — O(1) lookup by type / category ID
 *   textMap      Map<text,  item>    — O(1) lookup by text character
 *   catToTypeMap Map<catId, typeObj> — O(1) category → parent type
 *
 * @module data
 * @depends {config.js, state.js, utils.js}
 */
(function (M) {
  'use strict';

  const { CONFIG, Utils } = M;

  // ── ConDataService access helpers ─────────────────────────────────────────────

  /**
   * Synchronous getter — returns ConDataService immediately, or null if not yet loaded.
   * Use for optional / fire-and-forget calls where blocking is undesirable.
   * @returns {any|null}
   */
  function _getConDataService() {
    return window.ConDataService || null;
  }

  /**
   * Async getter — polls window.ConDataService until it is available.
   *
   * Why polling?
   *   ConDataService is an ES module loaded via <script type="module">.
   *   ES modules execute after deferred scripts in document order, but the exact
   *   moment window.ConDataService is set may be slightly after NavCore's IIFE
   *   modules begin executing.  Polling avoids a hard dependency on load order.
   *
   * @param {number} [timeoutMs=10000]
   * @returns {Promise<any>}
   */
  function _requireConDataService(timeoutMs = 10000) {
    const svc = window.ConDataService;
    if (svc) return Promise.resolve(svc);

    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const poll = () => {
        if (window.ConDataService) return resolve(window.ConDataService);
        if (Date.now() > deadline)
          return reject(new Error(
            '[NavCore/Data] ConDataService not available after ' + timeoutMs + 'ms. ' +
            'Ensure <script type="module" src="/assets/js/con-data-service/con-data-service.js"> ' +
            'is loaded before nav-core.js.'
          ));
        setTimeout(poll, 100);
      };
      setTimeout(poll, 50);
    });
  }

  // ── DataService ───────────────────────────────────────────────────────────────

  const DataService = {

    // ── Internal state ──────────────────────────────────────────────────────────

    /** @type {Map<string,{data:any, expiry:number}>} */
    cache: new Map(),

    /** @type {any|null} */ apiCache: null,
    /** @type {number}   */ apiCacheTimestamp: 0,

    /** @type {Map<string,any>}  */ _categoryIndexes:  new Map(),
    /** @type {Map<string,any>}  */ _subcategoryCache: new Map(),
    /** @type {any|null}         */ _topLevelIndex:    null,
    /** @type {Promise<any>|null} */ _topLevelIndexPromise: null,

    // Shared index — single source of truth for all consumers
    /** @type {{apiMap:Map,idMap:Map,textMap:Map,catToTypeMap:Map}|null} */
    _sharedIndex:        null,
    /** @type {Promise<any>|null} */
    _sharedIndexPromise: null,

    // Fetch queue
    /** @type {{url:string,options:any,priority:number,resolve:Function,reject:Function,timestamp:number}[]} */
    _fetchQueue:      [],
    /** @type {Map<string,boolean>} */
    _fetchInProgress: new Map(),
    _queueProcessing: false,
    _queueDirty:      false,

    // ── Fetch queue ─────────────────────────────────────────────────────────────

    /**
     * Enqueue a fetch with priority (lower number = higher priority).
     * @param {string}      url
     * @param {RequestInit} [options]
     * @param {number}      [priority=5]
     * @returns {Promise<any>}
     */
    async _enqueueFetch(url, options = {}, priority = 5) {
      return new Promise((resolve, reject) => {
        this._fetchQueue.push({
          url,
          options,
          priority: typeof priority === 'number' ? priority : 5,
          resolve,
          reject,
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

    /** @param {string} key @returns {any|null} */
    getCached(key) {
      const cached = this.cache.get(key);
      if (!cached) return null;
      if (Date.now() > cached.expiry) { this.cache.delete(key); return null; }
      return cached.data;
    },

    /**
     * @param {string} key
     * @param {any}    data
     * @param {number} [ttl]
     */
    setCache(key, data, ttl = CONFIG.FETCH.CACHE_DURATION) {
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
      // Tell ConDataService to invalidate its own cache too (optional — sync getter)
      try { _getConDataService()?.invalidateCache?.(); } catch (_) {}
    },

    // ── Fetch ───────────────────────────────────────────────────────────────────

    /**
     * @param {string}      url
     * @param {RequestInit} [options]
     * @returns {Promise<any>}
     */
    async _performFetch(url, options = {}) {
      const cached = this.getCached(url);
      if (cached) return cached;

      try {
        if (!Utils.isOnline()) throw new Error('Offline');

        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), CONFIG.FETCH.TIMEOUT);

        const response = await fetch(url, {
          ...options,
          headers: { 'Content-Type': 'application/json', ...options.headers },
          signal:  controller.signal,
          cache:   options.cache === 'reload' ? 'reload' : 'no-store',
        });
        clearTimeout(timeoutId);

        const respText = await response.text().catch(() => null);
        if (!response.ok) throw new Error(`Fetch error: ${response.status} ${response.statusText}`);

        let data;
        try { data = respText ? JSON.parse(respText) : null; }
        catch (_) { throw new Error(`Invalid JSON response from ${url}`); }

        if (options.cache !== false) this.setCache(url, data);
        return data;

      } catch (err) {
        try {
          Utils.errorManager.showError(url, err, {
            duration: 1200, type: 'error', dismissible: true, position: 'top-right',
          });
        } catch (_) {}
        throw err;
      }
    },

    /**
     * Public fetch entry point.
     * Routes /con-data/ URLs through ConDataService; everything else through the queue.
     * @param {string}      url
     * @param {RequestInit} [options]
     * @param {number}      [priority=5]
     * @returns {Promise<any>}
     */
    async fetchWithRetry(url, options = {}, priority = 5) {
      if (url && url.includes('/con-data/'))
        return this._fetchViaService(url);
      return this._enqueueFetch(url, options, priority);
    },

    // ── ConDataService bridge ───────────────────────────────────────────────────

    /**
     * Resolve a /con-data/ URL via the ConDataService API.
     *
     * Supported URL patterns (all relative to /assets/db/con-data/):
     *
     *   index.json                →  full assembled DB  (getAssembled)
     *   {type}.json               →  type object        (getTypeById)
     *   {type}/{category}.json    →  item array         (getItems)
     *
     * Falls back to the full assembled DB for unrecognised patterns.
     *
     * Uses _requireConDataService() so it waits if the ES module hasn't
     * finished loading yet.
     *
     * @param {string} url
     * @returns {Promise<any>}
     */
    async _fetchViaService(url) {
      const svc = await _requireConDataService();

      // Two-segment: /con-data/{type}/{category}.json  → item array
      const twoSeg = url.match(/\/con-data\/([^/?#]+)\/([^/?#]+?)(?:\.min)?\.json(?:[?#].*)?$/);
      if (twoSeg) {
        const [, typeId, catId] = twoSeg;
        const items = await svc.getItems(typeId, catId).catch(() => null);
        if (items != null) return items;
      }

      // One-segment: /con-data/{type}.json  → type object (skip index.json)
      const oneSeg = url.match(/\/con-data\/([^/?#/]+?)(?:\.min)?\.json(?:[?#].*)?$/);
      if (oneSeg && oneSeg[1] !== 'index') {
        const typeId  = oneSeg[1];
        const typeObj = await svc.getTypeById(typeId).catch(() => null);
        if (typeObj) return typeObj;
      }

      // Fallback: return full assembled DB
      return svc.getAssembled();
    },

    // ── Warmup ──────────────────────────────────────────────────────────────────

    _warmupPromise: null,

    /**
     * Pre-fetch button config and kick off ConDataService assembly in idle time.
     * Fire-and-forget; safe to call multiple times.
     * @returns {Promise<void>}
     */
    async _warmup() {
      if (this._warmupPromise) return this._warmupPromise;
      this._warmupPromise = new Promise(resolve => {
        const doWarmup = async () => {
          try {
            if (!Utils.isOnline()) return resolve();
            // Pre-cache the buttons config (low priority)
            await this._enqueueFetch(
              CONFIG.PATHS.BUTTONS_CONFIG, { cache: 'force-cache' }, 9
            ).catch(() => {});
            // Kick off ConDataService assembly without blocking (use sync getter)
            _getConDataService()?.preload?.().catch(() => {});
          } finally {
            resolve();
          }
        };
        if ('requestIdleCallback' in window)
          requestIdleCallback(doWarmup, { timeout: CONFIG.FETCH.WARMUP_TIMEOUT });
        else
          setTimeout(doWarmup, CONFIG.FETCH.WARMUP_DELAY);
      });
      return this._warmupPromise;
    },

    // ── loadApiDatabase ─────────────────────────────────────────────────────────

    /**
     * Load the assembled DB from ConDataService and ensure the shared index is ready.
     *
     * Assembled DB format (ConDataService.getAssembled()):
     *   { type: [{ id, name, category: [{ id, name, data: item[] }] }] }
     *
     * @returns {Promise<any>}
     */
    async loadApiDatabase() {
      this._warmup();

      // Cache hit — ensure index is also ready
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

    // ── _buildSharedIndex ───────────────────────────────────────────────────────

    /**
     * Build four O(1) lookup Maps from the assembled DB.
     *
     * Iterates exactly the structure returned by ConDataService.getAssembled():
     *   db.type[]  →  typeObj.category[]  →  cat.data[]  →  item
     *
     * This replaces the old generic DFS approach which traversed all object
     * properties (including name{} sub-objects) unnecessarily.
     *
     * Yields to the scheduler every INDEX_YIELD_N items to avoid blocking
     * the main thread on large datasets.
     *
     * @param {any} db  Assembled DB — { type: typeObj[] }
     * @returns {Promise<{apiMap:Map,idMap:Map,textMap:Map,catToTypeMap:Map}>}
     */
    async _buildSharedIndex(db) {
      if (this._sharedIndex)        return this._sharedIndex;
      if (this._sharedIndexPromise) return this._sharedIndexPromise;

      this._sharedIndexPromise = (async () => {
        const apiMap       = new Map();
        const idMap        = new Map();
        const textMap      = new Map();
        const catToTypeMap = new Map();

        let count = 0;

        // Walk: db.type[] → typeObj.category[] → cat.data[] → item
        for (const typeObj of (db?.type || [])) {
          if (!typeObj || typeof typeObj !== 'object') continue;

          // Index the type by its ID
          if (typeObj.id) idMap.set(typeObj.id, typeObj);

          for (const cat of (typeObj.category || [])) {
            if (!cat || typeof cat !== 'object') continue;

            // Index the category and record which type owns it
            if (cat.id) {
              idMap.set(cat.id, cat);
              catToTypeMap.set(cat.id, typeObj);
            }

            for (const item of (cat.data || [])) {
              if (!item || typeof item !== 'object') continue;

              if (item.api)  apiMap.set(item.api,  item);
              if (item.text) textMap.set(item.text, item);

              // Yield every N items so the compositor gets a frame slot
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

        const idx = { apiMap, idMap, textMap, catToTypeMap };
        this._sharedIndex        = idx;
        this._jsonDbIndex        = idx;   // backward-compat alias
        this._jsonDbIndexReady   = true;
        this._sharedIndexPromise = null;
        return idx;
      })();

      return this._sharedIndexPromise;
    },

    // ── Public lookup helpers ───────────────────────────────────────────────────

    /**
     * Resolve the text character for a given API code.
     * Uses the shared index (O(1)) when ready; falls back to ConDataService.findByApi().
     * @param {string} apiCode
     * @returns {Promise<string>}
     */
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

    /**
     * Fetch all items + a rendered header for a category ID.
     *
     * Searches db.type[].category[] for the matching category, then returns:
     *   { id, name, data: item[], header: { title, description, typeId, categoryId } }
     *
     * @param {string} categoryId
     * @returns {Promise<{id:string, name:any, data:any[], header:any}>}
     */
    async fetchCategoryGroup(categoryId) {
      const idRaw = categoryId.replace(/_category$/, '');
      const svc   = await _requireConDataService();
      const db    = await svc.getAssembled();
      const lang  = localStorage.getItem('selectedLang') || 'en';

      let foundCat = null;
      let typeObj  = null;

      // Search db.type[].category[] for a matching category ID
      for (const t of (db.type || [])) {
        const cat = (t.category || []).find(c => c.id === idRaw);
        if (cat) { foundCat = cat; typeObj = t; break; }
      }

      if (!foundCat) throw new Error(`Category not found: ${categoryId}`);

      // Resolve multilingual names via ConDataRegistry.getName()
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

    // ── Low-level loaders ───────────────────────────────────────────────────────

    /** Kick off ConDataService assembly in the background (fire-and-forget). */
    prefetchTopCategories() {
      _getConDataService()?.preload?.().catch(() => {});
    },

    /**
     * Build a top-level category list from the assembled DB.
     * @returns {Promise<{categories:{id,name,file}[]}|null>}
     */
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

    /**
     * Load sub-category metadata for a given type.
     * @param {string} type  — type ID (e.g. "emoji")
     * @returns {Promise<{id:string, name:any, categories:{id,name}[]}|null>}
     */
    async _loadCategoryIndex(type) {
      if (this._categoryIndexes.has(type)) return this._categoryIndexes.get(type);

      try {
        const svc     = await _requireConDataService();
        const db      = await svc.getAssembled();
        const typeObj = (db.type || []).find(t => t.id === type);

        if (!typeObj) {
          this._categoryIndexes.set(type, null);
          return null;
        }

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

    /**
     * Load item data for a specific subcategory.
     * @param {string} type    — type ID
     * @param {string} subcat  — category ID
     * @returns {Promise<{id:string, data:any[]}|null>}
     */
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

  // ── Export ────────────────────────────────────────────────────────────────────

  M.DataService = DataService;

})(window.NavCoreModules = window.NavCoreModules || {});