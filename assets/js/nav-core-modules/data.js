// @ts-check
/**
 * @file data.js
 * DataService — data fetching, caching, and shared index management.
 * (patched: _performFetch has real retry, _buildSharedIndex clears rejected promise)
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

    getCached(key) {
      const cached = this.cache.get(key);
      if (!cached) return null;
      if (Date.now() > cached.expiry) { this.cache.delete(key); return null; }
      return cached.data;
    },

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
      try { _getConDataService()?.invalidateCache?.(); } catch (_) {}
    },

    // ── _performFetch: ใส่ retry จริง 3 ครั้ง ────────────────────────────────────
    // BUG FIX: เดิมลองแค่ครั้งเดียว — network blip ครั้งเดียวทำระบบพัง
    // FIXED:   retry 3 ครั้ง ด้วย delay 400ms → 1200ms → 2400ms

    async _performFetch(url, options = {}) {
      const cached = this.getCached(url);
      if (cached) return cached;

      const DELAYS = [400, 1200, 2400];
      let lastErr;

      for (let attempt = 0; attempt <= DELAYS.length; attempt++) {
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
          lastErr = err;
          if (attempt < DELAYS.length) {
            await new Promise(r => setTimeout(r, DELAYS[attempt]));
          }
        }
      }

      // ทุก retry ล้มเหลว — แสดง error แล้ว throw
      try {
        Utils.errorManager.showError(url, lastErr, {
          duration: 1200, type: 'error', dismissible: true, position: 'top-right',
        });
      } catch (_) {}
      throw lastErr;
    },

    // ── fetchWithRetry ──────────────────────────────────────────────────────────

    async fetchWithRetry(url, options = {}, priority = 5) {
      if (url && url.includes('/con-data/'))
        return this._fetchViaService(url);
      return this._enqueueFetch(url, options, priority);
    },

    // ── ConDataService bridge ───────────────────────────────────────────────────

    async _fetchViaService(url) {
      const svc = await _requireConDataService();

      const twoSeg = url.match(/\/con-data\/([^/?#]+)\/([^/?#]+?)(?:\.min)?\.json(?:[?#].*)?$/);
      if (twoSeg) {
        const [, typeId, catId] = twoSeg;
        const items = await svc.getItems(typeId, catId).catch(() => null);
        if (items != null) return items;
      }

      const oneSeg = url.match(/\/con-data\/([^/?#/]+?)(?:\.min)?\.json(?:[?#].*)?$/);
      if (oneSeg && oneSeg[1] !== 'index') {
        const typeId  = oneSeg[1];
        const typeObj = await svc.getTypeById(typeId).catch(() => null);
        if (typeObj) return typeObj;
      }

      return svc.getAssembled();
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