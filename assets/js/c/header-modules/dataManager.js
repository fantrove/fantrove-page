// dataManager.js
// ปรับปรุง: อ่าน top-level index.json ของ /assets/db/con-data/ ก่อนประกอบรายการ category
// - ถ้า index.json มี จะใช้ไฟล์ที่ระบุใน index.json (รองรับ absolute/relative path)
// - ถ้าไม่มี จะ fallback ไปยัง KNOWN_TOP_CATEGORIES (เดิม)
// - ปรับการจัดการข้อผิดพลาดเพื่อหลีกเลี่ยง "Unexpected token '<'"
// - เก็บ caches เพื่อลด fetch ที่ซ้ำซ้อน
import { _headerV2_utils } from './utils.js';

const dataManager = {
    constants: {
        FETCH_TIMEOUT: 5000,
        RETRY_DELAY: 300,
        MAX_RETRIES: 1,
        CACHE_DURATION: 2 * 60 * 60 * 1000,
        // โฟลเดอร์ฐานข้อมูลแบบใหม่
        API_DATABASE_PATH: '/assets/db/con-data/',
        TOP_INDEX_FILE: 'index.json', // file that lists top-level categories
        BUTTONS_CONFIG_PATH: '/assets/json/buttons.min.json',
        // รายการประเภทที่ระบบคาดว่าจะมี (fallback)
        KNOWN_TOP_CATEGORIES: ['emoji', 'symbol', 'unicode']
    },

    // memory caches
    cache: new Map(),
    apiCache: null,
    apiCacheTimestamp: 0,
    _categoryIndexes: new Map(),
    _subcategoryCache: new Map(),
    _dbPromise: null,
    _jsonDbIndex: null,
    _jsonDbIndexReady: false,
    _jsonDbIndexPromise: null,
    _topLevelIndex: null, // cached top-level index.json
    _topLevelIndexPromise: null,

    _fetchQueue: [],
    _fetchInProgress: new Map(),
    _queueProcessing: false,

    _indexWorker: null,
    _indexWorkerSupported: typeof Worker !== 'undefined' && typeof URL !== 'undefined',

    _initIndexWorker() {
        if (this._indexWorker) return;
        if (!this._indexWorkerSupported) return;
        try {
            this._indexWorker = new Worker('/assets/js/header-index-worker.js');
        } catch (err) {
            this._indexWorker = null;
        }
    },

    async _enqueueFetch(url, options = {}, priority = 5) {
        return new Promise((resolve, reject) => {
            const task = {
                url,
                options,
                priority: typeof priority === 'number' ? priority : 5,
                resolve,
                reject,
                timestamp: Date.now()
            };
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
                .then(result => {
                    task.resolve(result);
                    this._fetchInProgress.delete(taskId);
                })
                .catch(err => {
                    task.reject(err);
                    this._fetchInProgress.delete(taskId);
                });
        }
        this._queueProcessing = false;
    },

    _openIndexedDB() {
        if (this._dbPromise) return this._dbPromise;
        this._dbPromise = new Promise((resolve, reject) => {
            try {
                const req = indexedDB.open('HeaderV2DB', 5);
                req.onupgradeneeded = e => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('json')) db.createObjectStore('json');
                };
                req.onsuccess = e => resolve(e.target.result);
                req.onerror = e => reject(e.target.error);
            } catch (err) {
                reject(err);
            }
        });
        return this._dbPromise;
    },

    async _getFromIndexedDB(key) {
        return null;
    },

    async _setToIndexedDB(key, data) {
        // placeholder
    },

    getCached(key) {
        const cached = this.cache.get(key);
        if (!cached) return null;
        if (Date.now() > cached.expiry) {
            this.cache.delete(key);
            return null;
        }
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
    },

    _warmupPromise: null,
    async _warmup() {
        if (this._warmupPromise) return this._warmupPromise;
        this._warmupPromise = new Promise(resolve => {
            const doWarmup = async () => {
                try {
                    if (!window._headerV2_utils.isOnline()) return resolve();
                    await this._enqueueFetch(
                        this.constants.BUTTONS_CONFIG_PATH,
                        { cache: 'force-cache' },
                        9
                    ).catch(()=>{});
                    try {
                        this.prefetchTopCategories(9).catch(()=>{});
                    } catch (e) {}
                } finally {
                    resolve();
                }
            };
            if ('requestIdleCallback' in window) requestIdleCallback(doWarmup, { timeout: 2000 });
            else setTimeout(doWarmup, 1200);
        });
        return this._warmupPromise;
    },

    // Robust fetch: read text first and provide helpful error snippets
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
            const contentType = (response.headers && response.headers.get && response.headers.get('content-type')) || '';

            if (!response.ok) {
                const snippet = typeof respText === 'string' ? respText.slice(0, 300) : '';
                throw new Error(`Fetch error: ${response.status} ${response.statusText} ${snippet ? '- ' + snippet : ''}`);
            }

            let data;
            if (contentType.toLowerCase().includes('application/json') || typeof respText === 'string') {
                try {
                    data = respText ? JSON.parse(respText) : null;
                } catch (parseErr) {
                    const snippet = typeof respText === 'string' ? respText.slice(0, 400) : '';
                    throw new Error(`Invalid JSON response from ${url}. Response snippet: ${snippet}`);
                }
            } else {
                try {
                    data = respText ? JSON.parse(respText) : null;
                } catch (parseErr) {
                    const snippet = typeof respText === 'string' ? respText.slice(0, 400) : '';
                    throw new Error(`Unexpected non-JSON response for ${url}. Snippet: ${snippet}`);
                }
            }

            if (options.cache !== false) {
                this.setCache(key, data);
            }
            return data;
        } catch (err) {
            try {
                window._headerV2_utils.errorManager.showError(key, err, {
                    duration: 1200,
                    type: 'error',
                    dismissible: true,
                    position: 'top-right'
                });
            } catch (e) {}
            throw err;
        }
    },

    async fetchWithRetry(url, options = {}, priority = 5) {
        return this._enqueueFetch(url, options, priority);
    },

    // Load top-level index.json (e.g., /assets/db/con-data/index.json) which lists available top categories
    async _loadTopLevelIndex() {
        if (this._topLevelIndex) return this._topLevelIndex;
        if (this._topLevelIndexPromise) return this._topLevelIndexPromise;

        this._topLevelIndexPromise = (async () => {
            const path = this.constants.API_DATABASE_PATH + this.constants.TOP_INDEX_FILE;
            try {
                const idx = await this._enqueueFetch(path, {}, 4).catch(()=>null);
                if (idx && Array.isArray(idx.categories)) {
                    this._topLevelIndex = idx;
                    return idx;
                }
            } catch (e) {}
            // if failed or not present, leave _topLevelIndex null and return null
            this._topLevelIndex = null;
            return null;
        })();

        return this._topLevelIndexPromise;
    },

    async _loadCategoryIndex(category) {
        if (this._categoryIndexes.has(category)) return this._categoryIndexes.get(category);
        // If top-level index exists, try to find matching entry first
        let path = null;
        try {
            const topIndex = await this._loadTopLevelIndex();
            if (topIndex && Array.isArray(topIndex.categories)) {
                const entry = topIndex.categories.find(c => c.id === category);
                if (entry) {
                    // entry.file may be absolute (starts with /) or relative
                    if (entry.file) {
                        path = entry.file.startsWith('/') ? entry.file : (this.constants.API_DATABASE_PATH + entry.file);
                    } else {
                        path = `${this.constants.API_DATABASE_PATH}${category}.min.json`;
                    }
                }
            }
        } catch (e) {}
        if (!path) path = `${this.constants.API_DATABASE_PATH}${category}.min.json`;
        try {
            const idx = await this._enqueueFetch(path, {}, 3);
            if (idx && (Array.isArray(idx.categories) || Array.isArray(idx.category) || Array.isArray(idx.data))) {
                // normalize shape for category index files
                this._categoryIndexes.set(category, idx);
                return idx;
            }
            this._categoryIndexes.set(category, null);
            return null;
        } catch (err) {
            this._categoryIndexes.set(category, null);
            return null;
        }
    },

    async _loadSubcategoryFile(category, subcat) {
        const cacheKey = `${category}-${subcat}`;
        if (this._subcategoryCache.has(cacheKey)) return this._subcategoryCache.get(cacheKey);

        let filePath;
        const catIndex = this._categoryIndexes.get(category);
        if (catIndex && Array.isArray(catIndex.categories)) {
            const entry = catIndex.categories.find(c => c.id === subcat);
            if (entry && entry.file) filePath = entry.file.startsWith('/') ? entry.file : (this.constants.API_DATABASE_PATH + entry.file);
        }
        if (!filePath) {
            filePath = `${this.constants.API_DATABASE_PATH}${category}/${subcat}.min.json`;
        }

        try {
            const data = await this._enqueueFetch(filePath, {}, 4);
            this._subcategoryCache.set(cacheKey, data);
            return data;
        } catch (err) {
            this._subcategoryCache.set(cacheKey, null);
            return null;
        }
    },

    async _assembleFullDatabase() {
        if (this.apiCache && Date.now() - this.apiCacheTimestamp < this.constants.CACHE_DURATION) {
            return this.apiCache;
        }

        // Determine top-level categories: prefer index.json, otherwise fallback to known list
        let topList = null;
        try {
            const topIndex = await this._loadTopLevelIndex();
            if (topIndex && Array.isArray(topIndex.categories)) {
                topList = topIndex.categories.map(c => ({
                    categoryKey: c.id,
                    idxFile: c.file ? (c.file.startsWith('/') ? c.file : (this.constants.API_DATABASE_PATH + c.file)) : `${this.constants.API_DATABASE_PATH}${c.id}.min.json`,
                    rawEntry: c
                }));
            }
        } catch (e) {
            topList = null;
        }

        if (!topList) {
            // fallback: attempt to load known categories
            topList = (this.constants.KNOWN_TOP_CATEGORIES || []).map(cat => ({
                categoryKey: cat,
                idxFile: `${this.constants.API_DATABASE_PATH}${cat}.min.json`
            }));
        }

        // Load each top category index (but only those we found)
        const loadedTop = [];
        for (const top of topList) {
            try {
                // try to fetch the index file
                const potentialPath = top.idxFile;
                // attempt to fetch and normalize
                let idx = null;
                try {
                    idx = await this._enqueueFetch(potentialPath, {}, 3).catch(()=>null);
                } catch (e) { idx = null; }
                if (!idx) {
                    // also try categoryKey based fallback path if different
                    const altPath = `${this.constants.API_DATABASE_PATH}${top.categoryKey}.min.json`;
                    try { idx = await this._enqueueFetch(altPath, {}, 4).catch(()=>null); } catch (e) { idx = null; }
                }
                if (idx) {
                    const normalized = {
                        id: idx.id || top.categoryKey,
                        name: idx.name || idx.title || (top.rawEntry && top.rawEntry.name) || {},
                        categories: idx.categories || idx.category || (idx.data ? [{ id: idx.id || top.categoryKey, data: idx.data }] : [])
                    };
                    loadedTop.push({ categoryKey: top.categoryKey, idx: normalized });
                    this._categoryIndexes.set(top.categoryKey, idx);
                } else {
                    // mark as missing to avoid repeated attempts
                    this._categoryIndexes.set(top.categoryKey, null);
                }
            } catch (e) {
                this._categoryIndexes.set(top.categoryKey, null);
            }
        }

        // Parallel fetch subcategories (enqueue)
        const subFetchPromises = [];
        for (const top of loadedTop) {
            const cat = top.categoryKey;
            const idx = top.idx;
            if (!Array.isArray(idx.categories)) continue;
            for (const sub of idx.categories) {
                const subId = sub.id;
                subFetchPromises.push((async () => {
                    const subData = await this._loadSubcategoryFile(cat, subId).catch(()=>null);
                    return { topCat: cat, subId, subIndexEntry: sub, subData };
                })());
            }
        }

        const allSubResults = await Promise.all(subFetchPromises);

        // assemble final structure
        const finalTypes = [];
        for (const top of loadedTop) {
            const idx = top.idx;
            const cats = (idx.categories || []).map(c => {
                const match = allSubResults.find(r => r.topCat === top.categoryKey && r.subId === c.id);
                const data = match && match.subData ? (match.subData.data || match.subData.items || match.subData) : c.data || [];
                return { ...c, data };
            });
            finalTypes.push({
                id: idx.id || top.categoryKey,
                name: idx.name || {},
                category: cats
            });
        }

        const assembled = { type: finalTypes };
        this.apiCache = assembled;
        this.apiCacheTimestamp = Date.now();
        try { await this._buildJsonDbIndex(assembled); } catch {}
        return assembled;
    },

    async loadApiDatabase() {
        this._warmup();
        if (this.apiCache && Date.now() - this.apiCacheTimestamp < this.constants.CACHE_DURATION) {
            if (!this._jsonDbIndexReady) this._buildJsonDbIndex(this.apiCache).catch(()=>{});
            return this.apiCache;
        }
        try {
            const db = await this._assembleFullDatabase();
            return db;
        } catch (e) {
            if (this.apiCache) return this.apiCache;
            throw e;
        }
    },

    async fetchApiContent(apiCode) {
        if (this._jsonDbIndexReady && this._jsonDbIndex && this._jsonDbIndex.apiMap && this._jsonDbIndex.apiMap.has(apiCode)) {
            const node = this._jsonDbIndex.apiMap.get(apiCode);
            return node.text || node;
        }

        const db = await this.loadApiDatabase();
        function findApiValue(obj, targetApi) {
            if (Array.isArray(obj)) {
                for (const item of obj) {
                    const found = findApiValue(item, targetApi);
                    if (found) return found;
                }
            } else if (typeof obj === 'object' && obj !== null) {
                if (obj.api === targetApi) return obj.text || obj;
                for (const key in obj) {
                    if (Object.prototype.hasOwnProperty.call(obj, key)) {
                        const found = findApiValue(obj[key], targetApi);
                        if (found) return found;
                    }
                }
            }
            return null;
        }
        const content = findApiValue(db, apiCode);
        if (!content) throw new Error(`API code not found: ${apiCode}`);
        return content;
    },

    async fetchCategoryGroup(categoryId) {
        const idRaw = categoryId.replace(/_category$/, '');
        const db = await this.loadApiDatabase();
        const idx = this._jsonDbIndexReady ? this._jsonDbIndex : (await this._buildJsonDbIndex(db));
        let found = null, typeName = "", typeId = "";
        if (idx && idx.idMap.has(idRaw)) {
            found = idx.idMap.get(idRaw);
            const typeObj = idx.catToTypeMap.get(idRaw);
            if (typeObj) {
                typeId = typeObj.id;
                typeName = typeObj.name;
            }
        }
        if (!found && Array.isArray(db?.type)) {
            for (const typeObj of db.type) {
                typeId = typeObj.id;
                typeName = typeObj.name;
                if (Array.isArray(typeObj.category)) {
                    for (const cat of typeObj.category) {
                        if (cat.id === idRaw) { found = cat; break; }
                    }
                }
                if (found) break;
            }
        }
        if (!found) throw new Error(`Category not found: ${categoryId}`);
        const currentLang = localStorage.getItem('selectedLang') || 'en';
        const header = {
            title: found.name?.[currentLang] || found.name?.en || found.id,
            description: typeName?.[currentLang] || typeName?.en || "",
            typeId,
            categoryId: found.id,
            className: "auto-category-header"
        };
        return { id: found.id, name: found.name, data: found.data || [], header };
    },

    async _buildJsonDbIndex(db, rawText) {
        if (this._jsonDbIndexReady && this._jsonDbIndex) return this._jsonDbIndex;
        if (this._jsonDbIndexPromise) return this._jsonDbIndexPromise;

        this._jsonDbIndexPromise = new Promise((resolve) => {
            const tryWorker = () => {
                try {
                    this._initIndexWorker();
                    if (this._indexWorker && rawText) {
                        const onmsg = (e) => {
                            const { type, payload } = e.data || {};
                            if (type === 'indexReady') {
                                try {
                                    const apiMap = new Map(payload.apiEntries || []);
                                    const idMap = new Map(payload.idEntries || []);
                                    const textMap = new Map(payload.textEntries || []);
                                    const catToTypeMap = new Map(payload.catToTypeEntries || []);
                                    this._jsonDbIndex = { apiMap, idMap, textMap, catToTypeMap };
                                    this._jsonDbIndexReady = true;
                                    this._indexWorker.removeEventListener('message', onmsg);
                                    resolve(this._jsonDbIndex);
                                } catch (err) {
                                    this._indexWorker.removeEventListener('message', onmsg);
                                    fallbackIndex();
                                }
                            } else if (type === 'indexError') {
                                this._indexWorker.removeEventListener('message', onmsg);
                                fallbackIndex();
                            }
                        };
                        this._indexWorker.addEventListener('message', onmsg);
                        try {
                            this._indexWorker.postMessage({ type: 'parseAndIndex', payload: { text: rawText } });
                            setTimeout(() => {
                                if (!this._jsonDbIndexReady) fallbackIndex();
                            }, 6000);
                            return;
                        } catch (e) {
                            this._indexWorker.removeEventListener('message', onmsg);
                        }
                    }
                } catch (e) {}
                fallbackIndex();
            };

            const fallbackIndex = () => {
                const apiMap = new Map();
                const idMap = new Map();
                const textMap = new Map();
                const catToTypeMap = new Map();
                function walk(obj) {
                    if (Array.isArray(obj)) {
                        obj.forEach(item => walk(item));
                    } else if (typeof obj === 'object' && obj !== null) {
                        if (obj.api) apiMap.set(obj.api, obj);
                        if (obj.id) idMap.set(obj.id, obj);
                        if (obj.text) textMap.set(obj.text, obj);
                        if (obj.category && Array.isArray(obj.category) && obj.id) {
                            for (const cat of obj.category) {
                                catToTypeMap.set(cat.id, obj);
                            }
                        }
                        for (const key in obj) {
                            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                                walk(obj[key]);
                            }
                        }
                    }
                }
                try {
                    walk(db?.type || db);
                } catch (err) {}
                this._jsonDbIndex = { apiMap, idMap, textMap, catToTypeMap };
                this._jsonDbIndexReady = true;
                resolve(this._jsonDbIndex);
            };

            if (rawText) {
                tryWorker();
            } else {
                try {
                    const text = JSON.stringify(db || {});
                    tryWorker(text);
                } catch (e) {
                    fallbackIndex();
                }
            }
        });

        await this._jsonDbIndexPromise;
        return this._jsonDbIndex;
    },

    async prefetchTopCategories(priority = 8, subPerCategory = 2) {
        try {
            const topIndex = await this._loadTopLevelIndex();
            const known = (topIndex && Array.isArray(topIndex.categories))
                ? topIndex.categories.map(c => ({ id: c.id, file: c.file }))
                : (this.constants.KNOWN_TOP_CATEGORIES || []).map(c => ({ id: c, file: `${this.constants.API_DATABASE_PATH}${c}.min.json` }));

            for (const cat of known) {
                (async () => {
                    try {
                        const filePath = (cat.file && cat.file.startsWith('/')) ? cat.file : (this.constants.API_DATABASE_PATH + (typeof cat.file === 'string' ? cat.file.replace(this.constants.API_DATABASE_PATH, '') : `${cat.id}.min.json`));
                        const idx = await this._enqueueFetch(filePath, {}, priority).catch(()=>null);
                        if (!idx || !Array.isArray(idx.categories)) return;
                        for (let i = 0; i < Math.min(subPerCategory, idx.categories.length); i++) {
                            const entry = idx.categories[i];
                            const path = entry && entry.file ? (entry.file.startsWith('/') ? entry.file : (this.constants.API_DATABASE_PATH + entry.file)) : `${this.constants.API_DATABASE_PATH}${cat.id}/${entry.id}.min.json`;
                            this._enqueueFetch(path, {}, priority + 1).catch(()=>null);
                        }
                    } catch (e) {}
                })();
            }
        } catch (e) {}
    }
};

export default dataManager;