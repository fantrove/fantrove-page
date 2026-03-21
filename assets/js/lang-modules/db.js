// @ts-check
/**
 * @file db.js
 * DBService — IndexedDB utilities สำหรับ language cache
 *
 * การปรับปรุง v4.0:
 *  - getCacheBatch คืน full record { key, data, version, ts }
 *    (เดิมคืนแค่ .data — ทำให้ version check ไม่ได้)
 *  - setCacheBatch รับ version field เพิ่มเติม
 *    ใช้สำหรับ cache invalidation เมื่อ translation file เปลี่ยน version
 *
 * ทุก method คืน Promise และ fail silently (ไม่ crash app)
 * ไม่มี dependency กับ module อื่น — standalone ได้
 *
 * @module db
 * @depends {config.js}
 */
(function(M) {
  'use strict';
  
  const DBService = {
    
    // ── Open DB ───────────────────────────────────────────────────────────────
    
    /**
     * เปิด (หรือสร้าง) IndexedDB database
     * @returns {Promise<IDBDatabase>}
     */
    openDB() {
      const { CONFIG } = M;
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(CONFIG.DB_STORE))
            db.createObjectStore(CONFIG.DB_STORE, { keyPath: 'key' });
          if (!db.objectStoreNames.contains(CONFIG.DB_META))
            db.createObjectStore(CONFIG.DB_META, { keyPath: 'key' });
        };
      });
    },
    
    // ── Translation cache ─────────────────────────────────────────────────────
    
    /**
     * อ่านหลาย lang keys พร้อมกัน
     *
     * คืน full record รวม version + timestamp สำหรับ invalidation:
     *   { key, data, version, ts } หรือ null ถ้าไม่มี
     *
     * @param {string[]} langKeys
     * @returns {Promise<(Object|null)[]>}
     */
    async getCacheBatch(langKeys) {
      const { CONFIG } = M;
      const db = await this.openDB();
      
      return Promise.all(langKeys.map(langKey =>
        new Promise(resolve => {
          const tx = db.transaction(CONFIG.DB_STORE, 'readonly');
          const req = tx.objectStore(CONFIG.DB_STORE).get(langKey);
          req.onsuccess = () => resolve(req.result || null); // full record
          req.onerror = () => resolve(null);
        })
      ));
    },
    
    /**
     * เขียนหลาย lang entries พร้อมกัน
     *
     * @param {Array<{ langKey: string, data: Object, version?: string|null }>} entries
     * @returns {Promise<void[]>}
     */
    async setCacheBatch(entries) {
      const { CONFIG } = M;
      const db = await this.openDB();
      
      return Promise.all(entries.map(({ langKey, data, version = null }) =>
        new Promise(resolve => {
          const tx = db.transaction(CONFIG.DB_STORE, 'readwrite');
          tx.objectStore(CONFIG.DB_STORE).put({
            key: langKey,
            data,
            version, // เก็บ version เพื่อ invalidation
            ts: Date.now(),
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        })
      ));
    },
    
    // ── Meta store ────────────────────────────────────────────────────────────
    
    /**
     * อ่าน meta value
     * @param {string} key
     * @returns {Promise<any>}
     */
    async getMeta(key) {
      const { CONFIG } = M;
      const db = await this.openDB();
      return new Promise(resolve => {
        const tx = db.transaction(CONFIG.DB_META, 'readonly');
        const req = tx.objectStore(CONFIG.DB_META).get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => resolve(null);
      });
    },
    
    /**
     * เขียน meta value
     * @param {string} key
     * @param {any}    value
     * @returns {Promise<void>}
     */
    async setMeta(key, value) {
      const { CONFIG } = M;
      const db = await this.openDB();
      return new Promise(resolve => {
        const tx = db.transaction(CONFIG.DB_META, 'readwrite');
        tx.objectStore(CONFIG.DB_META).put({ key, value });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    },
  };
  
  M.DBService = DBService;
  
})(window.LangModules = window.LangModules || {});