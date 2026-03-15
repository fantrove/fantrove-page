// con-data-service.js  v2.0.0
// =========================================================
// ระบบศูนย์กลางข้อมูล — Neutral Data Service
//
// หลักการออกแบบ:
//  - ไม่เอนเอียงต่อระบบใดระบบหนึ่ง
//  - ระบบอื่นขอข้อมูลในรูปแบบที่ต้องการได้ทันที
//  - ไม่ต้องรู้ว่าไฟล์อยู่ที่ไหนหรือโครงสร้างเป็นอย่างไร
//  - รองรับการดึงข้อมูลทุกรูปแบบ
//
// =========================================================

import ConDataRegistry from './con-data-registry.js';

// =========================================================
// INTERNAL — Fetch Engine
// =========================================================
const _fetcher = {
  _cache: new Map(),
  _pending: new Map(),
  _CACHE_TTL: 2 * 60 * 60 * 1000,
  _TIMEOUT_MS: 8000,

  _isCacheValid(entry) {
    return entry && (Date.now() - entry.ts) < this._CACHE_TTL;
  },

  async fetch(url) {
    const cached = this._cache.get(url);
    if (this._isCacheValid(cached)) return cached.data;
    if (this._pending.has(url)) return this._pending.get(url);

    const promise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this._TIMEOUT_MS);
      try {
        const resp = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
        clearTimeout(timer);
        if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${url}`);
        const text = await resp.text();
        let data;
        try { data = JSON.parse(text); }
        catch (e) { throw new Error(`Invalid JSON at ${url}: ${text.slice(0, 200)}`); }
        this._cache.set(url, { data, ts: Date.now() });
        return data;
      } catch (err) {
        clearTimeout(timer);
        throw err;
      } finally {
        this._pending.delete(url);
      }
    })();

    this._pending.set(url, promise);
    return promise;
  },

  invalidate(url) { this._cache.delete(url); },
  invalidateAll() { this._cache.clear(); },
  getCacheSize() { return this._cache.size; }
};

// =========================================================
// INTERNAL — Index Engine
// =========================================================
const _indexEngine = {
  _apiIndex:  null,
  _textIndex: null,
  _nameIndex: null,
  _typeIndex: null,
  _catIndex:  null,
  _allItems:  null,
  _built: false,

  reset() {
    this._apiIndex  = new Map();
    this._textIndex = new Map();
    this._nameIndex = new Map();
    this._typeIndex = new Map();
    this._catIndex  = new Map();
    this._allItems  = [];
    this._built = false;
  },

  build(assembled) {
    this.reset();
    if (!assembled || !Array.isArray(assembled.type)) return;

    for (const typeObj of assembled.type) {
      const typeId = typeObj.id;
      this._typeIndex.set(typeId, typeObj);

      for (const cat of (typeObj.category || [])) {
        const catKey = `${typeId}/${cat.id}`;
        const items  = cat.data || [];
        this._catIndex.set(catKey, items);

        for (const item of items) {
          if (!item) continue;
          // เพิ่ม parent context ให้ทุก item (ไม่ mutate ต้นฉบับ)
          const enriched = Object.assign({}, item, {
            _typeId:  typeId,
            _typeObj: typeObj,
            _catId:   cat.id,
            _catObj:  cat
          });

          if (item.api)  this._apiIndex.set(item.api, enriched);
          if (item.text) this._textIndex.set(item.text, enriched);
          this._allItems.push(enriched);

          if (item.name && typeof item.name === 'object') {
            for (const lang of Object.keys(item.name)) {
              const key = (item.name[lang] || '').toLowerCase().trim();
              if (!key) continue;
              if (!this._nameIndex.has(key)) this._nameIndex.set(key, []);
              this._nameIndex.get(key).push(enriched);
            }
          }
        }
      }
    }
    this._built = true;
  },

  isReady()    { return this._built; },
  findByApi(api)  { return (this._apiIndex  && this._apiIndex.get(api))   || null; },
  findByText(txt) { return (this._textIndex && this._textIndex.get(txt))  || null; },
  getType(id)     { return (this._typeIndex && this._typeIndex.get(id))   || null; },
  getAllItems()    { return this._allItems ? [...this._allItems] : []; },

  getCategoryItems(typeId, catId) {
    if (!this._catIndex) return null;
    return this._catIndex.get(`${typeId}/${catId}`) || null;
  },

  searchByName(query) {
    if (!this._nameIndex || !query) return [];
    const q = query.toLowerCase().trim();
    const results = new Map();
    const exact = this._nameIndex.get(q);
    if (exact) exact.forEach(i => results.set(i.api || i.text || i, i));
    for (const [key, items] of this._nameIndex) {
      if (key.includes(q)) items.forEach(i => results.set(i.api || i.text || i, i));
    }
    return Array.from(results.values());
  },

  getStats() {
    const stats = { types: 0, categories: 0, items: 0, byType: {} };
    if (this._typeIndex) {
      this._typeIndex.forEach((typeObj, typeId) => {
        stats.types++;
        const cats = typeObj.category || [];
        stats.byType[typeId] = { categories: cats.length, items: 0 };
        cats.forEach(c => {
          const count = (c.data || []).length;
          stats.categories++;
          stats.items += count;
          stats.byType[typeId].items += count;
        });
      });
    }
    return stats;
  }
};

// =========================================================
// INTERNAL — Event Bus
// =========================================================
const _eventBus = {
  _listeners: new Map(),
  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this.off(event, fn);
  },
  off(event, fn) { const b = this._listeners.get(event); if (b) b.delete(fn); },
  emit(event, payload) {
    const b = this._listeners.get(event);
    if (!b) return;
    b.forEach(fn => { try { fn(payload); } catch (e) { console.warn('ConDataService event error', e); } });
  }
};

// =========================================================
// INTERNAL — Loader
// =========================================================
const _loader = {
  _topIndex: null,
  _assembledDb: null,
  _assemblePromise: null,

  async loadTopIndex() {
    if (this._topIndex) return this._topIndex;
    const raw = await _fetcher.fetch(ConDataRegistry.paths.topIndex());
    if (!ConDataRegistry.validate.topIndex(raw)) throw new Error('con-data index.json: invalid structure');
    this._topIndex = raw;
    return raw;
  },

  async assemble() {
    if (this._assembledDb) return this._assembledDb;
    if (this._assemblePromise) return this._assemblePromise;

    this._assemblePromise = (async () => {
      let topIndex;
      try {
        topIndex = await this.loadTopIndex();
      } catch (e) {
        topIndex = { categories: ConDataRegistry.knownTypes.map(id => ({ id, name: { en: id }, file: `${id}.min.json` })) };
      }

      const typeResults = await Promise.all(
        topIndex.categories.map(async (catEntry) => {
          try {
            const raw = await _fetcher.fetch(ConDataRegistry.resolvePath(catEntry.file));
            if (!ConDataRegistry.validate.typeIndex(raw)) return null;
            return { id: catEntry.id, name: catEntry.name || raw.name || {}, typeData: ConDataRegistry.normalize.typeIndex(raw) };
          } catch (e) { return null; }
        })
      );

      const typeObjs = [];
      await Promise.all(
        typeResults.filter(Boolean).map(async ({ id: typeId, name: typeName, typeData }) => {
          const loadedCats = await Promise.all(
            (typeData.categories || []).map(async (catEntry) => {
              try {
                const filePath = catEntry.file
                  ? ConDataRegistry.resolvePath(catEntry.file)
                  : ConDataRegistry.paths.subcategoryData(typeId, catEntry.id);
                const raw = await _fetcher.fetch(filePath);
                if (!ConDataRegistry.validate.dataFile(raw)) return null;
                const normalized = ConDataRegistry.normalize.dataFile(raw);
                return { id: catEntry.id, name: catEntry.name || normalized.name || {}, data: normalized.data };
              } catch (e) { return null; }
            })
          );
          typeObjs.push({ id: typeId, name: typeName || typeData.name || {}, category: loadedCats.filter(Boolean) });
        })
      );

      const assembled = { type: typeObjs };
      _indexEngine.build(assembled);
      _eventBus.emit('ready', { assembled });
      this._assembledDb = assembled;
      return assembled;
    })();

    try {
      const result = await this._assemblePromise;
      this._assemblePromise = null;
      return result;
    } catch (err) {
      this._assemblePromise = null;
      throw err;
    }
  },

  invalidate() {
    this._topIndex = null;
    this._assembledDb = null;
    this._assemblePromise = null;
    _indexEngine.reset();
    _fetcher.invalidateAll();
    _eventBus.emit('invalidated', {});
  }
};

// =========================================================
// PUBLIC API — ConDataService
// =========================================================
const ConDataService = {

  version: '2.0.0',
  registry: ConDataRegistry,

  // -------------------------------------------------------
  // EVENT SYSTEM
  // -------------------------------------------------------
  on(event, fn)  { return _eventBus.on(event, fn); },
  off(event, fn) { _eventBus.off(event, fn); },

  // -------------------------------------------------------
  // CORE: getAssembled()
  // รูปแบบนี้ตรงกับที่ SearchEngine ต้องการโดยตรง
  // { type: [{ id, name, category: [{ id, name, data: [] }] }] }
  // -------------------------------------------------------
  async getAssembled() { return _loader.assemble(); },

  // -------------------------------------------------------
  // TYPE / CATEGORY
  // -------------------------------------------------------
  async getTypes() {
    const db = await _loader.assemble();
    return (db.type || []).map(t => ({ id: t.id, name: t.name }));
  },

  async getTypeById(typeId) {
    if (!typeId) return null;
    await _loader.assemble();
    return _indexEngine.getType(typeId) || null;
  },

  async getCategories(typeId) {
    if (!typeId) throw new Error('getCategories: typeId is required');
    const db = await _loader.assemble();
    const typeObj = (db.type || []).find(t => t.id === typeId);
    if (!typeObj) throw new Error(`getCategories: type "${typeId}" not found`);
    return (typeObj.category || []).map(c => ({
      id: c.id, name: c.name,
      count: Array.isArray(c.data) ? c.data.length : 0
    }));
  },

  async getCategoryById(typeId, categoryId) {
    if (!typeId || !categoryId) return null;
    const db = await _loader.assemble();
    const typeObj = (db.type || []).find(t => t.id === typeId);
    if (!typeObj) return null;
    const cat = (typeObj.category || []).find(c => c.id === categoryId);
    if (!cat) return null;
    return { ...cat, typeId: typeObj.id, typeName: typeObj.name };
  },

  async getCategoryMeta(typeId, categoryId) {
    const cat = await this.getCategoryById(typeId, categoryId);
    if (!cat) throw new Error(`getCategoryMeta: not found ${typeId}/${categoryId}`);
    return { id: cat.id, name: cat.name, typeId: cat.typeId, typeName: cat.typeName, count: Array.isArray(cat.data) ? cat.data.length : 0 };
  },

  // -------------------------------------------------------
  // ITEMS
  // -------------------------------------------------------
  async getItems(typeId, categoryId) {
    if (!typeId || !categoryId) throw new Error('getItems: typeId and categoryId required');
    await _loader.assemble();
    const cached = _indexEngine.getCategoryItems(typeId, categoryId);
    if (cached) return cached;
    const db = _loader._assembledDb;
    const typeObj = (db && db.type || []).find(t => t.id === typeId);
    if (!typeObj) throw new Error(`getItems: type "${typeId}" not found`);
    const cat = (typeObj.category || []).find(c => c.id === categoryId);
    if (!cat) throw new Error(`getItems: category "${categoryId}" not found`);
    return cat.data || [];
  },

  async getAllItems(typeId = null) {
    await _loader.assemble();
    if (!typeId) return _indexEngine.getAllItems();
    const db = _loader._assembledDb;
    const results = [];
    for (const t of (db.type || [])) {
      if (t.id !== typeId) continue;
      for (const c of (t.category || []))
        for (const item of (c.data || []))
          results.push(Object.assign({}, item, { _typeId: t.id, _typeObj: t, _catId: c.id, _catObj: c }));
    }
    return results;
  },

  // -------------------------------------------------------
  // LOOKUPS
  // -------------------------------------------------------
  async findByApi(apiCode) {
    if (!apiCode) return null;
    await _loader.assemble();
    return _indexEngine.findByApi(apiCode) || null;
  },

  async findByText(text) {
    if (!text) return null;
    await _loader.assemble();
    return _indexEngine.findByText(text) || null;
  },

  async findByApiBatch(apiCodes) {
    if (!Array.isArray(apiCodes) || !apiCodes.length) return [];
    await _loader.assemble();
    return apiCodes.map(api => ({ api, item: _indexEngine.findByApi(api) || null }));
  },

  async search(query, lang = null) {
    if (!query) return [];
    await _loader.assemble();
    return _indexEngine.searchByName(query);
  },

  // -------------------------------------------------------
  // FORMATTED OUTPUTS
  //
  // format:
  //   'assembled'          → { type:[...] }   ← default, SearchEngine format
  //   'flat'               → item[]
  //   'flat-with-context'  → item[] + _typeId/_catId
  //   'by-type'            → { [typeId]: item[] }
  //   'by-category'        → { 'typeId/catId': item[] }
  //   'api-map'            → { [api]: item }
  //   'text-map'           → { [text]: item }
  //   'types-only'         → [{ id, name }]
  //   'categories-only'    → [{ id, name, typeId, count }]
  // -------------------------------------------------------
  async getFormatted(format = 'assembled', options = {}) {
    const db = await _loader.assemble();

    switch (format) {
      case 'assembled': return db;

      case 'flat': {
        const items = [];
        for (const t of (db.type || []))
          for (const c of (t.category || []))
            for (const item of (c.data || []))
              items.push(item);
        return items;
      }

      case 'flat-with-context': return _indexEngine.getAllItems();

      case 'by-type': {
        const out = {};
        for (const t of (db.type || [])) {
          out[t.id] = [];
          for (const c of (t.category || []))
            for (const item of (c.data || []))
              out[t.id].push(item);
        }
        return out;
      }

      case 'by-category': {
        const out = {};
        for (const t of (db.type || []))
          for (const c of (t.category || []))
            out[`${t.id}/${c.id}`] = c.data || [];
        return out;
      }

      case 'api-map': {
        const out = {};
        if (this._apiIndex) {
          for (const [api, item] of _indexEngine._apiIndex) out[api] = item;
        } else {
          for (const t of (db.type || []))
            for (const c of (t.category || []))
              for (const item of (c.data || []))
                if (item.api) out[item.api] = item;
        }
        return out;
      }

      case 'text-map': {
        const out = {};
        for (const [text, item] of (_indexEngine._textIndex || new Map()))
          out[text] = item;
        return out;
      }

      case 'types-only': return (db.type || []).map(t => ({ id: t.id, name: t.name }));

      case 'categories-only': {
        const out = [];
        for (const t of (db.type || []))
          for (const c of (t.category || []))
            out.push({ id: c.id, name: c.name, typeId: t.id, typeName: t.name, count: (c.data || []).length });
        return out;
      }

      default: throw new Error(`getFormatted: unknown format "${format}"`);
    }
  },

  // -------------------------------------------------------
  // DATA MANIPULATION
  // -------------------------------------------------------
  async paginate(typeId, categoryId, page = 1, pageSize = 50) {
    const all = await this.getItems(typeId, categoryId);
    const total = all.length;
    const totalPages = Math.ceil(total / pageSize);
    const safePage = Math.max(1, Math.min(page, totalPages || 1));
    const start = (safePage - 1) * pageSize;
    return {
      items: all.slice(start, start + pageSize),
      page: safePage, pageSize, total, totalPages,
      hasNext: safePage < totalPages,
      hasPrev: safePage > 1
    };
  },

  async slice(typeId = null, offset = 0, limit = 50) {
    const all = await this.getAllItems(typeId);
    return all.slice(offset, offset + limit);
  },

  async filter(fn, typeId = null) {
    if (typeof fn !== 'function') throw new Error('filter: fn must be a function');
    const all = await this.getAllItems(typeId);
    return all.filter(fn);
  },

  async transform(fn) {
    if (typeof fn !== 'function') throw new Error('transform: fn must be a function');
    const db = await _loader.assemble();
    return fn(db);
  },

  // -------------------------------------------------------
  // HELPERS
  // -------------------------------------------------------
  getName(item, lang = 'en') {
    if (!item) return '';
    if (item.name && typeof item.name === 'object') {
      return item.name[lang] || item.name.en || item.name.th || Object.values(item.name)[0] || '';
    }
    return ConDataRegistry.getName(item.name, lang);
  },

  async getStats() {
    await _loader.assemble();
    return _indexEngine.getStats();
  },

  // -------------------------------------------------------
  // UNIVERSAL REQUEST INTERFACE
  // -------------------------------------------------------
  async request(descriptor = {}) {
    const { action, ...params } = descriptor;
    switch (action) {
      case 'getAssembled':     return this.getAssembled();
      case 'getTypes':         return this.getTypes();
      case 'getTypeById':      return this.getTypeById(params.typeId);
      case 'getCategories':    return this.getCategories(params.typeId);
      case 'getCategoryById':  return this.getCategoryById(params.typeId, params.categoryId);
      case 'getCategoryMeta':  return this.getCategoryMeta(params.typeId, params.categoryId);
      case 'getItems':         return this.getItems(params.typeId, params.categoryId);
      case 'getAllItems':       return this.getAllItems(params.typeId || null);
      case 'findByApi':        return this.findByApi(params.api || params.apiCode);
      case 'findByText':       return this.findByText(params.text);
      case 'findByApiBatch':   return this.findByApiBatch(params.apiCodes || params.apis || []);
      case 'search':           return this.search(params.query, params.lang || null);
      case 'getFormatted':     return this.getFormatted(params.format || 'assembled', params.options || {});
      case 'paginate':         return this.paginate(params.typeId, params.categoryId, params.page, params.pageSize);
      case 'slice':            return this.slice(params.typeId || null, params.offset || 0, params.limit || 50);
      case 'filter':
        if (typeof params.fn !== 'function') throw new Error('request filter: fn required');
        return this.filter(params.fn, params.typeId || null);
      case 'transform':
        if (typeof params.fn !== 'function') throw new Error('request transform: fn required');
        return this.transform(params.fn);
      case 'getStats':         return this.getStats();
      default: throw new Error(`ConDataService.request: unknown action "${action}"`);
    }
  },

  // -------------------------------------------------------
  // CACHE & STATUS
  // -------------------------------------------------------
  invalidateCache() { _loader.invalidate(); },
  preload()         { return _loader.assemble().catch(() => {}); },
  status() {
    return {
      assembled: !!_loader._assembledDb,
      indexReady: _indexEngine.isReady(),
      cacheSize: _fetcher.getCacheSize(),
      version: this.version
    };
  }
};

if (typeof window !== 'undefined') window.ConDataService = ConDataService;

export default ConDataService;
export { ConDataRegistry };