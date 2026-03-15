// dataManager.js (อัพเดท)
// =========================================================
// ปรับให้ใช้ ConDataService สำหรับ con-data database
// ยังคงทำงานกับ buttons.min.json เหมือนเดิม (backward compatible 100%)
//
// การเปลี่ยนแปลง:
//  - con-data requests  → ผ่าน ConDataService
//  - buttons.min.json   → ยังคงอ่านเองเหมือนเดิม
//  - Public API         → ไม่เปลี่ยนแปลงเลย (backward compatible)
// =========================================================
import { _headerV2_utils } from './utils.js';
import ConDataService from '../con-data-service/con-data-service.js';

const dataManager = {
    constants: {
        FETCH_TIMEOUT: 5000,
        RETRY_DELAY: 300,
        MAX_RETRIES: 1,
        CACHE_DURATION: 2 * 60 * 60 * 1000,
        // Buttons config ยังคงอยู่ที่นี่ (dataManager ยังรับผิดชอบอยู่)
        BUTTONS_CONFIG_PATH: '/assets/json/buttons.min.json',
        // con-data paths (คงไว้เพื่อ backward compat แต่ไม่ได้ใช้โดยตรงแล้ว)
        API_DATABASE_PATH: '/assets/db/con-data/',
        TOP_INDEX_FILE: 'index.json',
        KNOWN_TOP_CATEGORIES: ['emoji', 'symbol', 'unicode']
    },

    // =========================================================
    // CACHE (สำหรับ buttons + misc)
    // con-data cache ถูกจัดการโดย ConDataService แทนแล้ว
    // =========================================================
    cache: new Map(),
    apiCache: null,            // backward compat — จะชี้ไปที่ assembled db
    apiCacheTimestamp: 0,
    _categoryIndexes: new Map(),
    _subcategoryCache: new Map(),
    _dbPromise: null,
    _jsonDbIndex: null,
    _jsonDbIndexReady: false,
    _jsonDbIndexPromise: null,
    _topLevelIndex: null,
    _topLevelIndexPromise: null,

    _fetchQueue: [],
    _fetchInProgress: new Map(),
    _queueProcessing: false,

    // =========================================================
    // FETCH QUEUE (ยังคงไว้สำหรับ buttons.min.json และไฟล์อื่นๆ)
    // =========================================================
    async _enqueueFetch(url, options = {}, priority = 5) {
        return new Promise((resolve, reject) => {
            const task = { url, options, priority: typeof priority === 'number' ? priority : 5, resolve, reject, timestamp: Date.now() };
            this._fetchQueue.push(task);
            this._fetchQueue.sort((a, b) => a.priority - b.priority || a.timestamp - b.timestamp);
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
    // CACHE HELPERS (ยังคงไว้สำหรับ buttons + misc)
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
        // invalidate con-data service cache ด้วย
        try { ConDataService.invalidateCache(); } catch (e) {}
    },

    // =========================================================
    // FETCH (ใช้สำหรับ buttons.min.json และไฟล์ที่ไม่ใช่ con-data)
    // =========================================================
    async _performFetch(url, options = {}) {
        const key = `${url}-${JSON.stringify(options)}`;
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
        // ถ้า URL อยู่ใน con-data path → ให้ ConDataService จัดการ
        // (ใช้สำหรับ jsonFile references ที่มาจาก buttons config)
        if (url && url.includes('/con-data/')) {
            return this._fetchViaService(url, options);
        }
        return this._enqueueFetch(url, options, priority);
    },

    // =========================================================
    // CON-DATA VIA SERVICE
    // แทนที่ของเดิมที่ fetch ตรงๆ
    // =========================================================
    async _fetchViaService(url, options = {}) {
        // ดึง assembled db จาก service และ filter ตาม URL
        const assembled = await ConDataService.getAssembled();
        // พยายาม parse url เพื่อหา typeId/categoryId
        const match = url.match(/\/con-data\/([^/]+)\/([^/]+)\.min\.json/);
        if (match) {
            const [, typeId, catId] = match;
            const items = await ConDataService.getItems(typeId, catId).catch(() => null);
            if (items) return items;
        }
        // fallback: ดึงทั้งหมด
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
                    // warmup buttons config
                    await this._enqueueFetch(this.constants.BUTTONS_CONFIG_PATH, { cache: 'force-cache' }, 9).catch(() => {});
                    // warmup con-data service ด้วย (โหลด assembled db)
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
    // PUBLIC — backward compatible
    // คืนค่า assembled db ในรูปแบบเดิม { type: [...] }
    // =========================================================
    async loadApiDatabase() {
        this._warmup();
        // ถ้า cache ยังใช้ได้
        if (this.apiCache && Date.now() - this.apiCacheTimestamp < this.constants.CACHE_DURATION) {
            if (!this._jsonDbIndexReady) {
                ConDataService.getAssembled().then(db => this._buildJsonDbIndex(db)).catch(() => {});
            }
            return this.apiCache;
        }
        try {
            // ใช้ ConDataService แทน _assembleFullDatabase เดิม
            const db = await ConDataService.getAssembled();
            this.apiCache = db;
            this.apiCacheTimestamp = Date.now();
            // สร้าง index สำหรับ backward compat (fetchApiContent, fetchCategoryGroup)
            this._buildJsonDbIndex(db).catch(() => {});
            return db;
        } catch (e) {
            if (this.apiCache) return this.apiCache;
            throw e;
        }
    },

    // =========================================================
    // fetchApiContent()
    // PUBLIC — backward compatible
    // =========================================================
    async fetchApiContent(apiCode) {
        // ใช้ ConDataService โดยตรง
        const item = await ConDataService.findByApi(apiCode);
        if (item) return item.text || item;
        throw new Error(`API code not found: ${apiCode}`);
    },

    // =========================================================
    // fetchCategoryGroup()
    // PUBLIC — backward compatible
    // =========================================================
    async fetchCategoryGroup(categoryId) {
        const idRaw = categoryId.replace(/_category$/, '');
        const db = await ConDataService.getAssembled();
        const currentLang = localStorage.getItem('selectedLang') || 'en';

        // ค้นหา category ในทุก type
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

    // =========================================================
    // _buildJsonDbIndex()
    // สร้าง index สำหรับ backward compat
    // (contentManager และ unifiedCopyToClipboard ยังใช้อยู่)
    // =========================================================
    async _buildJsonDbIndex(db) {
        if (this._jsonDbIndexReady && this._jsonDbIndex) return this._jsonDbIndex;
        if (this._jsonDbIndexPromise) return this._jsonDbIndexPromise;

        this._jsonDbIndexPromise = new Promise((resolve) => {
            const apiMap     = new Map();
            const idMap      = new Map();
            const textMap    = new Map();
            const catToTypeMap = new Map();

            function walk(obj) {
                if (Array.isArray(obj)) { obj.forEach(item => walk(item)); return; }
                if (typeof obj !== 'object' || !obj) return;
                if (obj.api)  apiMap.set(obj.api, obj);
                if (obj.id)   idMap.set(obj.id, obj);
                if (obj.text) textMap.set(obj.text, obj);
                if (obj.category && Array.isArray(obj.category) && obj.id) {
                    for (const cat of obj.category) catToTypeMap.set(cat.id, obj);
                }
                for (const key in obj) {
                    if (Object.prototype.hasOwnProperty.call(obj, key)) walk(obj[key]);
                }
            }
            try { walk(db?.type || db); } catch {}
            this._jsonDbIndex = { apiMap, idMap, textMap, catToTypeMap };
            this._jsonDbIndexReady = true;
            resolve(this._jsonDbIndex);
        });

        await this._jsonDbIndexPromise;
        this._jsonDbIndexPromise = null;
        return this._jsonDbIndex;
    },

    // =========================================================
    // prefetchTopCategories()
    // PUBLIC — backward compatible
    // =========================================================
    async prefetchTopCategories(priority = 8) {
        // delegate ไปยัง service (warmup ทำให้แล้ว)
        ConDataService.getAssembled().catch(() => {});
    },

    // =========================================================
    // _loadTopLevelIndex / _loadCategoryIndex / _loadSubcategoryFile
    // backward compat stubs — ยังคงมีฟังก์ชันให้เรียกได้
    // แต่ delegate ไปที่ service แทน
    // =========================================================
    async _loadTopLevelIndex() {
        if (this._topLevelIndex) return this._topLevelIndex;
        if (this._topLevelIndexPromise) return this._topLevelIndexPromise;
        this._topLevelIndexPromise = ConDataService.getAssembled()
            .then(db => {
                const idx = {
                    categories: (db.type || []).map(t => ({
                        id: t.id,
                        name: t.name,
                        file: `${t.id}.min.json`
                    }))
                };
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
        const idx = {
            id: typeObj.id,
            name: typeObj.name,
            categories: (typeObj.category || []).map(c => ({ id: c.id, name: c.name }))
        };
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