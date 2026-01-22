// dataManager.js
// ปรับปรุง: รองรับโครงสร้างฐานข้อมูลแบบแยกไฟล์ (con-data/*)
// - ยังคงรักษาฟังก์ชันเดิม (loadApiDatabase, fetchApiContent, fetchCategoryGroup, fetchWithRetry ฯลฯ)
// - โหลด index ของแต่ละ category แล้วโหลด subcategory (data) แบบควบคุม (concurrent queue + cache)
// - หากไฟล์ใดไม่พบ จะข้ามไป (fail-safe)
// - เก็บ cache ในหน่วยความจำเพื่อลดการเรียกซ้ำ
import { _headerV2_utils } from './utils.js';

const dataManager = {
    constants: {
        FETCH_TIMEOUT: 5000,
        RETRY_DELAY: 300,
        MAX_RETRIES: 1,
        CACHE_DURATION: 2 * 60 * 60 * 1000,
        // โฟลเดอร์ฐานข้อมูลแบบใหม่
        API_DATABASE_PATH: '/assets/db/con-data/',
        BUTTONS_CONFIG_PATH: '/assets/json/buttons.min.json',
        // รายการประ���ภทที่ระบบคาดว่าจะมี (สามารถขยายเพิ่มได้)
        KNOWN_TOP_CATEGORIES: ['emoji', 'symbol', 'fancy-text', 'unicode']
    },

    // memory caches
    cache: new Map(),               // generic cache for fetch results
    apiCache: null,                 // full assembled DB (virtual)
    apiCacheTimestamp: 0,
    _categoryIndexes: new Map(),    // category => index object (emoji.min.json content)
    _subcategoryCache: new Map(),   // `${category}-${subcategoryId}` => subcategory full data
    _dbPromise: null,
    _jsonDbIndex: null,
    _jsonDbIndexReady: false,
    _jsonDbIndexPromise: null,

    // fetch queue / concurrency control
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
                priority: typeof priority === 'number' ? priority : 5, // 1=highest, 10=lowest
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
        // Not used currently. Keep placeholder for future persistence.
        return null;
    },

    async _setToIndexedDB(key, data) {
        // placeholder — do nothing
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
                    // Additionally, prefetch top categories indexes in background to warm caches / SW
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
            if (!response.ok) throw new Error(`Fetch error: ${response.status} ${response.statusText}`);

            const data = await response.json();
            if (options.cache !== false) {
                this.setCache(key, data);
            }
            return data;
        } catch (err) {
            window._headerV2_utils.errorManager.showError(key, err, {
                duration: 1200,
                type: 'error',
                dismissible: true,
                position: 'top-right'
            });
            throw err;
        }
    },

    // Public API: priority-aware fetch
    async fetchWithRetry(url, options = {}, priority = 5) {
        return this._enqueueFetch(url, options, priority);
    },

    // Internal: load a top-level category index (e.g., /con-data/emoji.min.json)
    async _loadCategoryIndex(category) {
        if (this._categoryIndexes.has(category)) return this._categoryIndexes.get(category);
        const path = `${this.constants.API_DATABASE_PATH}${category}.min.json`;
        try {
            const idx = await this._enqueueFetch(path, {}, 3);
            // normalize if needed: ensure categories is array
            if (idx && Array.isArray(idx.categories) === false && Array.isArray(idx.category)) {
                idx.categories = idx.category;
            }
            this._categoryIndexes.set(category, idx);
            return idx;
        } catch (err) {
            // missing index - treat as absent
            this._categoryIndexes.set(category, null);
            return null;
        }
    },

    // Internal: load subcategory file (e.g., /con-data/emoji/smileys_emotion.min.json)
    async _loadSubcategoryFile(category, subcat) {
        const cacheKey = `${category}-${subcat}`;
        if (this._subcategoryCache.has(cacheKey)) return this._subcategoryCache.get(cacheKey);

        // try to get file path from category index if present
        let filePath;
        const catIndex = this._categoryIndexes.get(category);
        if (catIndex && Array.isArray(catIndex.categories)) {
            const entry = catIndex.categories.find(c => c.id === subcat);
            if (entry && entry.file) filePath = entry.file;
        }
        if (!filePath) {
            // fallback path convention
            filePath = `${this.constants.API_DATABASE_PATH}${category}/${subcat}.min.json`;
        }

        try {
            const data = await this._enqueueFetch(filePath, {}, 4);
            this._subcategoryCache.set(cacheKey, data);
            return data;
        } catch (err) {
            // missing subcategory - cache null to avoid repeated failing fetches
            this._subcategoryCache.set(cacheKey, null);
            return null;
        }
    },

    // Build a combined virtual DB object similar shape to previous single-file db:
    // { type: [ { id, name, category: [ { id, name, data: [...] }, ... ] }, ... ] }
    async _assembleFullDatabase() {
        if (this.apiCache && Date.now() - this.apiCacheTimestamp < this.constants.CACHE_DURATION) {
            return this.apiCache;
        }

        // ensure category indexes are loaded (try known categories)
        const categories = this.constants.KNOWN_TOP_CATEGORIES || [];
        const loadedTop = [];
        for (const cat of categories) {
            try {
                const idx = await this._loadCategoryIndex(cat);
                if (idx) {
                    // normalize shape to have id, name, categories array
                    const normalized = { id: idx.id || cat, name: idx.name || idx.title || {}, categories: idx.categories || idx.category || [] };
                    loadedTop.push({ categoryKey: cat, idx: normalized });
                }
            } catch (e) {
                // ignore
            }
        }

        // For each top category, load all its subcategory files in parallel (with enqueue)
        const subFetchPromises = [];
        for (const top of loadedTop) {
            const cat = top.categoryKey;
            const idx = top.idx;
            if (!Array.isArray(idx.categories)) continue;
            for (const sub of idx.categories) {
                const subId = sub.id;
                // push promise but do not await here to allow parallel queueing
                subFetchPromises.push((async () => {
                    const subData = await this._loadSubcategoryFile(cat, subId).catch(()=>null);
                    // attach data array into the category entry if present
                    return { topCat: cat, subId, subIndexEntry: sub, subData };
                })());
            }
        }

        const allSubResults = await Promise.all(subFetchPromises);

        // assemble final structure
        const finalTypes = [];
        for (const top of loadedTop) {
            const idx = top.idx;
            // clone categories entries and attach data where available
            const cats = (idx.categories || []).map(c => {
                // find matching fetched data
                const match = allSubResults.find(r => r.topCat === top.categoryKey && r.subId === c.id);
                const data = match && match.subData ? (match.subData.data || match.subData.items || match.subData) : c.data || [];
                // keep file property if present
                const entry = { ...c, data };
                return entry;
            });
            // final type object
            finalTypes.push({
                id: idx.id || top.categoryKey,
                name: idx.name || {},
                category: cats
            });
        }

        const assembled = { type: finalTypes };
        // cache
        this.apiCache = assembled;
        this.apiCacheTimestamp = Date.now();
        // try build index for searching
        try { await this._buildJsonDbIndex(assembled); } catch {}
        return assembled;
    },

    // loadApiDatabase: return assembled DB object (loads indexes + subcategory data)
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
        // try to use index first
        if (this._jsonDbIndexReady && this._jsonDbIndex && this._jsonDbIndex.apiMap && this._jsonDbIndex.apiMap.has(apiCode)) {
            const node = this._jsonDbIndex.apiMap.get(apiCode);
            return node.text || node;
        }

        // fallback: ensure full DB loaded and search
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

    // fetchCategoryGroup: given categoryId (e.g., 'smileys_emotion' or 'smileys_emotion_category'), return {id, name, data, header}
    async fetchCategoryGroup(categoryId) {
        const idRaw = categoryId.replace(/_category$/, '');
        // ensure full DB assembled (this will attempt to load indexes and subcategory files)
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
        // fallback search through assembled db.type
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
                // if rawText not provided, generate text from JSON string of assembled db
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

    // New: prefetch top categories indexes and optionally first N subcategories
    // This is non-blocking and used to warm SW/cache for con-data files.
    async prefetchTopCategories(priority = 8, subPerCategory = 2) {
        try {
            const known = this.constants.KNOWN_TOP_CATEGORIES || [];
            for (const cat of known) {
                // load category index (low priority)
                (async () => {
                    try {
                        const idx = await this._enqueueFetch(`${this.constants.API_DATABASE_PATH}${cat}.min.json`, {}, priority).catch(()=>null);
                        if (!idx || !Array.isArray(idx.categories)) return;
                        // enqueue first subPerCategory subcategory files
                        for (let i = 0; i < Math.min(subPerCategory, idx.categories.length); i++) {
                            const entry = idx.categories[i];
                            const path = entry && entry.file ? entry.file : `${this.constants.API_DATABASE_PATH}${cat}/${entry.id}.min.json`;
                            this._enqueueFetch(path, {}, priority + 1).catch(()=>null);
                        }
                    } catch (e) {}
                })();
            }
        } catch (e) {}
    }
};

export default dataManager;