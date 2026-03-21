// @ts-check
/**
 * @file loader.js
 * LoaderService — โหลด language config และ translation data
 *
 * การปรับปรุง v4.0:
 *  - ใช้ DBService (IndexedDB) สำหรับ cache translation data จริง
 *    เดิมเก็บแค่ใน memory (หายทุก session reload)
 *    ตอนนี้ persist ข้าม session → เปิดหน้าซ้ำเร็วขึ้นมาก
 *
 *  - Version-based cache invalidation:
 *    ถ้า db.json ประกาศ { en: { version: "2" } }
 *    และ IDB cache เก็บ version "1" ไว้ → re-fetch อัตโนมัติ
 *
 *  - flattenLanguageJson: เปลี่ยนจาก recursive → iterative
 *    (stack-safe สำหรับ JSON ที่ซ้อนลึกมาก)
 *
 * Cache hierarchy (เร็ว → ช้า):
 *   1. Memory (State.languageCache)     — ไม่ persist
 *   2. IndexedDB (DBService)            — persist ข้าม session
 *   3. Network fetch                    — ช้าที่สุด
 *
 * @module loader
 * @depends {config.js, state.js, db.js}
 */
(function(M) {
  'use strict';
  
  const LoaderService = {
    
    // ── Config prefetch ───────────────────────────────────────────────────────
    
    /**
     * เริ่ม preconnect, preload, และโหลด db.json ทันที (ก่อน DOM ready)
     * @returns {Promise<void>}
     */
    async prefetchEnterprise() {
      const { CONFIG, State } = M;
      
      // Preconnect (non-blocking, ไม่รอ)
      if (document.head) {
        for (const href of CONFIG.PRECONNECT_URLS) {
          if (!document.head.querySelector(`link[href^="${href}"]`)) {
            const l = document.createElement('link');
            l.rel = 'preconnect';
            l.href = href;
            l.crossOrigin = 'anonymous';
            document.head.appendChild(l);
          }
        }
        
        // Preload db.json ให้ browser เริ่ม fetch ก่อน
        if (!document.head.querySelector('link[rel="preload"][as="fetch"]')) {
          const preload = document.createElement('link');
          preload.rel = 'preload';
          preload.as = 'fetch';
          preload.href = CONFIG.DB_JSON_URL;
          preload.crossOrigin = 'anonymous';
          document.head.appendChild(preload);
        }
      }
      
      // ลองอ่าน config cache ก่อน (fast path สำหรับ repeat visit)
      let config = _readConfigCache(CONFIG);
      
      // Fetch ใหม่เสมอ (no-cache = เช็ค server update)
      try {
        const resp = await fetch(CONFIG.DB_JSON_URL, { cache: 'no-cache' });
        if (resp.ok) {
          config = await resp.json();
          _writeConfigCache(CONFIG, config);
        }
      } catch (e) {
        // Network fail → ใช้ cache ที่มีอยู่แล้ว (graceful degradation)
      }
      
      if (config) State.languagesConfig = config;
    },
    
    /**
     * รอ prefetch เสร็จและ validate config
     * เรียกจาก LanguageManager.initialize()
     * @returns {Promise<void>}
     * @throws {Error} ถ้า config ไม่ถูกต้อง
     */
    async loadLanguagesConfig() {
      await M.State._prefetchPromise;
      
      if (!M.State.languagesConfig || !Object.keys(M.State.languagesConfig).length)
        throw new Error('[LoaderService] Config invalid or missing');
    },
    
    // ── Language data ─────────────────────────────────────────────────────────
    
    /**
     * โหลด translation data สำหรับภาษาที่ระบุ
     *
     * Cache flow:
     *   memory hit  → return immediately
     *   IDB hit     → verify version → return (or re-fetch if stale)
     *   miss        → fetch network → save IDB → return
     *
     * IDB write เป็น fire-and-forget (ไม่ block return)
     *
     * @param {string} lang
     * @returns {Promise<Object|null>}
     */
    async loadLanguageData(lang) {
      const { CONFIG, State, DBService } = M;
      
      // 1. Memory cache (fastest)
      if (State.languageCache[lang]) return State.languageCache[lang];
      
      // 2. IndexedDB cache
      try {
        const [record] = await DBService.getCacheBatch([lang]);
        const expectedVersion = State.languagesConfig?.[lang]?.version ?? null;
        
        if (_isCacheValid(record, expectedVersion)) {
          // Cache hit + version match → ใช้เลย
          State.languageCache[lang] = record.data;
          return record.data;
        }
        // Cache miss หรือ version ไม่ตรง → ไป fetch
      } catch (e) {
        // IDB unavailable → ไป fetch ต่อ
      }
      
      // 3. Network fetch
      try {
        const resp = await fetch(CONFIG.LANG_JSON_URL(lang), { cache: 'no-cache' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        
        const raw = await resp.json();
        const flattened = this.flattenLanguageJson(raw);
        const version = State.languagesConfig?.[lang]?.version ?? null;
        
        // Save to IDB (fire and forget — ไม่รอ)
        DBService.setCacheBatch([{ langKey: lang, data: flattened, version }])
          .catch(() => {});
        
        State.languageCache[lang] = flattened;
        return flattened;
        
      } catch (e) {
        console.error(`[LoaderService] Error loading language "${lang}":`, e);
        return null;
      }
    },
    
    // ── JSON flatten ──────────────────────────────────────────────────────────
    
    /**
     * Flatten nested JSON → flat key-value map (iterative, stack-safe)
     *
     * เดิมใช้ recursion → อาจ stack overflow กับ JSON ที่ซ้อนลึกมาก
     * ตอนนี้ใช้ explicit stack แทน call stack
     *
     * { a: { b: 'hello' }, c: 'world' } → { b: 'hello', c: 'world' }
     *
     * หมายเหตุ: key ชั้นบนถูกทิ้ง (เหมือนเดิม) — เก็บแค่ leaf nodes
     *
     * @param {Object} json
     * @returns {Object}
     */
    flattenLanguageJson(json) {
      const result = {};
      const stack = [json];
      
      while (stack.length) {
        const obj = stack.pop();
        for (const [k, v] of Object.entries(obj)) {
          if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            stack.push(v); // ลงลึกต่อ
          } else {
            result[k] = v; // leaf node
          }
        }
      }
      
      return result;
    },
    
    /**
     * อ่านว่า English content มาจาก JSON หรือ HTML (original DOM)
     * @returns {'json'|'html'}
     */
    getEnSource() {
      return M.State.languagesConfig?.en?.enSource === 'json' ? 'json' : 'html';
    },
  };
  
  // ── Private helpers ───────────────────────────────────────────────────────
  
  /**
   * อ่าน config จาก localStorage หรือ sessionStorage
   * @param {Object} CONFIG
   * @returns {Object|null}
   */
  function _readConfigCache(CONFIG) {
    try {
      const raw = localStorage.getItem(CONFIG.CFG_CACHE_KEY) ||
        sessionStorage.getItem(CONFIG.CFG_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  
  /**
   * เขียน config ลง localStorage + sessionStorage
   * @param {Object} CONFIG
   * @param {Object} config
   */
  function _writeConfigCache(CONFIG, config) {
    const json = JSON.stringify(config);
    try { localStorage.setItem(CONFIG.CFG_CACHE_KEY, json); } catch (e) {}
    try { sessionStorage.setItem(CONFIG.CFG_CACHE_KEY, json); } catch (e) {}
  }
  
  /**
   * ตรวจว่า IDB record ยังใช้งานได้:
   *   - มี data อยู่
   *   - version ตรงกับที่คาดหวัง (ถ้ามีการประกาศ version)
   *
   * @param {Object|null} record           — full record จาก getCacheBatch
   * @param {string|null} expectedVersion  — จาก languagesConfig[lang].version
   * @returns {boolean}
   */
  function _isCacheValid(record, expectedVersion) {
    if (!record || !record.data) return false;
    if (expectedVersion !== null && record.version !== expectedVersion) return false;
    return true;
  }
  
  M.LoaderService = LoaderService;
  
})(window.LangModules = window.LangModules || {});