// dataManager.js (v2.1 — fixed)
// =========================================================
// v2.1 fix:
//  loadApiDatabase() ตอนนี้ await _buildSharedIndex() ให้เสร็จก่อน return
//  แทนที่จะ fire-and-forget (.catch(()=>{}))
//  ทำให้ทุก caller ที่ await loadApiDatabase() ได้รับ _sharedIndex พร้อมใช้เสมอ
//
// v2 changes (ยังคงอยู่):
//  ① Single shared index (_sharedIndex) — DB walked once
//  ② _buildSharedIndex yields every 500 items (scheduler.yield)
//  ③ _performFetch cache key = url only
//  ④ _fetchQueue lazy sort
// =========================================================
import { _headerV2_utils } from './utils.js';
import ConDataService from '../con-data-service/con-data-service.js';

const dataManager = {
    constants: {
        FETCH_TIMEOUT: 5000,
        RETRY_DELAY: 300,
        MAX_RETRIES: 1,
        CACHE_DURATION: 2 * 60 * 60 * 1000,
        BUTTONS_CONFIG_PATH: '/assets/json/buttons.min.json',
        API_DATABASE_PATH: '/assets/db/con-data/',
        TOP_INDEX_FILE: 'index.json',
        KNOWN_TOP_CATEGORIES: ['emoji', 'symbol', 'unicode']
    },

    cache: new Map(),
    apiCache: null,
    apiCacheTimestamp: 0,
    _categoryIndexes: new Map(),
    _subcategoryCache: new Map(),
    _dbPromise: null,
    _jsonDbIndex: null,
    _jsonDbIndexReady: false,
    _jsonDbIndexPromise: null,
    _topLevelIndex: null,
    _topLevelIndexPromise: null,

    // Shared index — single source of truth for all consumers
    _sharedIndex: null,
    _sharedIndexPromise: null,

    _fetchQueue: [],
    _fetchInProgress: new Map(),
    _queueProcessing: false,
    _queueDirty: false,

    // =========================================================
    // FETCH QUEUE
    // =========================================================
    async _enqueueFetch(url, options = {}, priority = 5) {
        return new Promise((resolve, reject) => {
            const task = { url, options, priority: typeof priority === 'number' ? priority : 5, resolve, reject, timestamp: Date.now() };
            this._fetchQueue.push(task);
            this._queueDirty = true;
            this._processFetchQueue();
        });
    },

    async _processFetchQueue() {
        if (this._queueProcessing || this._fetchQueue.length === 0) return;
        this._queueProcessing = true;
        while (this._fetchQueue.length > 0) {
            if (this._fetchInProgress.size >= 2) {
                await new Promise(r => setTimeout(r, 50));
                continue;
            }
            if (this._queueDirty) {
                this._fetchQueue.sort((a, b) => a.priority - b.priority || a.timestamp - b.timestamp);
                this._queueDirty = false;
            }
            const task = this._fetchQueue.shift();
            const taskId = `${task.url}-${task.priority}`;
            this._fetchInProgress.set(taskId, true);
            this._performFetch(task.url, task.options)
                .then(result => { task.resolve(result); this._fetchInProgress.delete(taskId); })
                .catch(err => { task.reject(err); this._fetchInProgress.delete(taskId); });
        }
        this._queueProcessing = false;
    },

    // =========================================================
    // CACHE HELPERS
    // =========================================================
    getCached(key) {
        const cached = this.cache.get(key);
        if (!cached) return null;
        if (Date.now() > cached.expiry) { this.cache.delete(key); return null; }
        return cached.data;
    },

    setCache(key, data, expiry = this.constants.CACHE_DURATION) {
        this.cache.set(key, { data, expiry: Date.now() + expiry });
    },

    clearCache() {
        this.cache.clear();
        this.apiCache = null;
        this.apiCacheTimestamp = 0;
        this._jsonDbIndex = null;
        this._jsonDbIndexReady = false;
        this._jsonDbIndexPromise = null;
        this._categoryIndexes.clear();
        this._subcategoryCache.clear();
        this._topLevelIndex = null;
        this._topLevelIndexPromise = null;
        this._sharedIndex = null;
        this._sharedIndexPromise = null;
        try { ConDataService.invalidateCache(); } catch (e) {}
    },

    // =========================================================
    // FETCH
    // =========================================================
    async _performFetch(url, options = {}) {
        const key = url;
        const cached = this.getCached(key);
        if (cached) return cached;
        try {
            if (!window._headerV2_utils.isOnline()) throw new Error('Offline');
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.constants.FETCH_TIMEOUT);
            const response = await fetch(url, {
                ...options,
                headers: { 'Content-Type': 'application/json', ...options.headers },
                signal: controller.signal,
                cache: options.cache === 'reload' ? 'reload' : 'no-store'
            });
            clearTimeout(timeoutId);
            const respText = await response.text().catch(() => null);
            if (!response.ok) throw new Error(`Fetch error: ${response.status} ${response.statusText}`);
            let data;
            try { data = respText ? JSON.parse(respText) : null; }
            catch (parseErr) { throw new Error(`Invalid JSON response from ${url}`); }
            if (options.cache !== false) this.setCache(key, data);
            return data;
        } catch (err) {
            try {
                window._headerV2_utils.errorManager.showError(key, err, { duration: 1200, type: 'error', dismissible: true, position: 'top-right' });
            } catch (e) {}
            throw err;
        }
    },

    async fetchWithRetry(url, options = {}, priority = 5) {
        if (url && url.includes('/con-data/')) {
            return this._fetchViaService(url, options);
        }
        return this._enqueueFetch(url, options, priority);
    },

    // =========================================================
    // CON-DATA VIA SERVICE
    // =========================================================
    async _fetchViaService(url, options = {}) {
        const assembled = await ConDataService.getAssembled();
        const match = url.match(/\/con-data\/([^/]+)\/([^/]+)\.min\.json/);
        if (match) {
            const [, typeId, catId] = match;
            const items = await ConDataService.getItems(typeId, catId).catch(() => null);
            if (items) return items;
        }
        return assembled;
    },

    // =========================================================
    // WARMUP
    // =========================================================
    _warmupPromise: null,
    async _warmup() {
        if (this._warmupPromise) return this._warmupPromise;
        this._warmupPromise = new Promise(resolve => {
            const doWarmup = async () => {
                try {
                    if (!window._headerV2_utils.isOnline()) return resolve();
                    await this._enqueueFetch(this.constants.BUTTONS_CONFIG_PATH, { cache: 'force-cache' }, 9).catch(() => {});
                    ConDataService.getAssembled().catch(() => {});
                } finally {
                    resolve();
                }
            };
            if ('requestIdleCallback' in window) requestIdleCallback(doWarmup, { timeout: 2000 });
            else setTimeout(doWarmup, 1200);
        });
        return this._warmupPromise;
    },

    // =========================================================
    // loadApiDatabase()
    // FIX v2.1: await _buildSharedIndex() ก่อน return เสมอ
    // =========================================================
    async loadApiDatabase() {
        this._warmup();

        if (this.apiCache && Date.now() - this.apiCacheTimestamp < this.constants.CACHE_DURATION) {
            // Cache hit — ถ้า index ยังไม่พร้อม await ให้เสร็จก่อน
            if (!this._sharedIndex) {
                if (this._sharedIndexPromise) {
                    await this._sharedIndexPromise;
                } else {
                    await this._buildSharedIndex(this.apiCache);
                }
            }
            return this.apiCache;
        }

        try {
            const db = await ConDataService.getAssembled();
            this.apiCache = db;
            this.apiCacheTimestamp = Date.now();
            // FIX: await ให้ index build เสร็จก่อน return
            await this._buildSharedIndex(db);
            return db;
        } catch (e) {
            if (this.apiCache) return this.apiCache;
            throw e;
        }
    },

    // =========================================================
    // _buildSharedIndex — single walk, yields every 500 items
    // =========================================================
    async _buildSharedIndex(db) {
        if (this._sharedIndex) return this._sharedIndex;
        if (this._sharedIndexPromise) return this._sharedIndexPromise;

        this._sharedIndexPromise = (async () => {
            const apiMap       = new Map();
            const idMap        = new Map();
            const textMap      = new Map();
            const catToTypeMap = new Map();

            const stack = [{ obj: db?.type || db, typeId: null }];
            let count = 0;

            while (stack.length) {
                const { obj, typeId } = stack.pop();
                if (!obj || typeof obj !== 'object') continue;

                if (Array.isArray(obj)) {
                    for (let i = obj.length - 1; i >= 0; i--)
                        stack.push({ obj: obj[i], typeId });
                    continue;
                }

                if (obj.api)  apiMap.set(obj.api, obj);
                if (obj.id)   idMap.set(obj.id, obj);
                if (obj.text) textMap.set(obj.text, obj);

                const currentTypeId = (obj.id && obj.category) ? obj.id : typeId;

                if (obj.category && Array.isArray(obj.category) && obj.id) {
                    for (const cat of obj.category) catToTypeMap.set(cat.id, obj);
                }

                for (const k in obj) {
                    if (Object.prototype.hasOwnProperty.call(obj, k)) {
                        const v = obj[k];
                        if (v && typeof v === 'object')
                            stack.push({ obj: v, typeId: currentTypeId });
                    }
                }

                if (++count % 500 === 0) {
                    await new Promise(r => {
                        if (typeof scheduler !== 'undefined' && scheduler.yield)
                            scheduler.yield().then(r);
                        else
                            setTimeout(r, 0);
                    });
                }
            }

            const idx = { apiMap, idMap, textMap, catToTypeMap };
            this._sharedIndex = idx;

            if (window._headerV2_dataManager)
                window._headerV2_dataManager._sharedIndex = idx;

            // Backward compat
            this._jsonDbIndex = { apiMap, idMap, textMap, catToTypeMap };
            this._jsonDbIndexReady = true;
            this._jsonDbIndexPromise = null;

            return idx;
        })();

        return this._sharedIndexPromise;
    },

    // =========================================================
    // fetchApiContent()
    // =========================================================
    async fetchApiContent(apiCode) {
        if (this._sharedIndex?.apiMap) {
            const item = this._sharedIndex.apiMap.get(apiCode);
            if (item) return item.text || item;
        }
        const item = await ConDataService.findByApi(apiCode);
        if (item) return item.text || item;
        throw new Error(`API code not found: ${apiCode}`);
    },

    // =========================================================
    // fetchCategoryGroup()
    // =========================================================
    async fetchCategoryGroup(categoryId) {
        const idRaw = categoryId.replace(/_category$/, '');
        const db = await ConDataService.getAssembled();
        const currentLang = localStorage.getItem('selectedLang') || 'en';

        let foundCat = null, typeObj = null;
        for (const t of (db.type || [])) {
            const cat = (t.category || []).find(c => c.id === idRaw);
            if (cat) { foundCat = cat; typeObj = t; break; }
        }

        if (!foundCat) throw new Error(`Category not found: ${categoryId}`);

        const header = {
            title: ConDataService.registry.getName(foundCat.name, currentLang) || foundCat.id,
            description: ConDataService.registry.getName(typeObj.name, currentLang) || '',
            typeId: typeObj.id,
            categoryId: foundCat.id,
            className: 'auto-category-header'
        };

        return { id: foundCat.id, name: foundCat.name, data: foundCat.data || [], header };
    },

    async _buildJsonDbIndex(db) {
        return this._buildSharedIndex(db);
    },

    async prefetchTopCategories(priority = 8) {
        ConDataService.getAssembled().catch(() => {});
    },

    async _loadTopLevelIndex() {
        if (this._topLevelIndex) return this._topLevelIndex;
        if (this._topLevelIndexPromise) return this._topLevelIndexPromise;
        this._topLevelIndexPromise = ConDataService.getAssembled()
            .then(db => {
                const idx = { categories: (db.type || []).map(t => ({ id: t.id, name: t.name, file: `${t.id}.min.json` })) };
                this._topLevelIndex = idx;
                return idx;
            })
            .catch(() => null);
        return this._topLevelIndexPromise;
    },

    async _loadCategoryIndex(category) {
        if (this._categoryIndexes.has(category)) return this._categoryIndexes.get(category);
        const db = await ConDataService.getAssembled().catch(() => null);
        if (!db) { this._categoryIndexes.set(category, null); return null; }
        const typeObj = (db.type || []).find(t => t.id === category);
        if (!typeObj) { this._categoryIndexes.set(category, null); return null; }
        const idx = { id: typeObj.id, name: typeObj.name, categories: (typeObj.category || []).map(c => ({ id: c.id, name: c.name })) };
        this._categoryIndexes.set(category, idx);
        return idx;
    },

    async _loadSubcategoryFile(category, subcat) {
        const cacheKey = `${category}-${subcat}`;
        if (this._subcategoryCache.has(cacheKey)) return this._subcategoryCache.get(cacheKey);
        try {
            const items = await ConDataService.getItems(category, subcat);
            const data = { id: subcat, data: items };
            this._subcategoryCache.set(cacheKey, data);
            return data;
        } catch (e) {
            this._subcategoryCache.set(cacheKey, null);
            return null;
        }
    }
};

export default dataManager;