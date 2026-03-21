// @ts-check
/**
 * @file db.js
 * DBService — IndexedDB utilities สำหรับ language cache.
 *
 * ไม่มี dependency กับ module อื่น — ใช้ได้แบบ standalone
 * ทุก method คืน Promise และ fail silently
 *
 * @module db
 * @depends {config.js}
 */
(function(M) {
  'use strict';
  
  const DBService = {
    
    /**
     * เปิด (หรือสร้าง) IndexedDB database
     * @returns {Promise<IDBDatabase>}
     */
    openDB() {
      const { CONFIG } = M;
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
        req.onerror = () => reject(req.error);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(CONFIG.DB_STORE)) {
            db.createObjectStore(CONFIG.DB_STORE, { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains(CONFIG.DB_META)) {
            db.createObjectStore(CONFIG.DB_META, { keyPath: 'key' });
          }
        };
        req.onsuccess = () => resolve(req.result);
      });
    },
    
    /**
     * อ่านหลาย lang keys พร้อมกัน
     * @param {string[]} langKeys
     * @returns {Promise<(Object|null)[]>}
     */
    async getCacheBatch(langKeys) {
      const { CONFIG } = M;
      const db = await this.openDB();
      return Promise.all(langKeys.map(langKey =>
        new Promise(resolve => {
          const tx = db.transaction(CONFIG.DB_STORE, 'readonly');
          const store = tx.objectStore(CONFIG.DB_STORE);
          const req = store.get(langKey);
          req.onsuccess = () => resolve(req.result ? req.result.data : null);
          req.onerror = () => resolve(null);
        })
      ));
    },
    
    /**
     * เขียนหลาย lang entries พร้อมกัน
     * @param {{ langKey: string, data: Object }[]} langDatas
     * @returns {Promise<void[]>}
     */
    async setCacheBatch(langDatas) {
      const { CONFIG } = M;
      const db = await this.openDB();
      return Promise.all(langDatas.map(({ langKey, data }) =>
        new Promise(resolve => {
          const tx = db.transaction(CONFIG.DB_STORE, 'readwrite');
          const store = tx.objectStore(CONFIG.DB_STORE);
          store.put({ key: langKey, data, ts: Date.now() });
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        })
      ));
    },
    
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
        const store = tx.objectStore(CONFIG.DB_META);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => resolve(null);
      });
    },
    
    /**
     * เขียน meta value
     * @param {string} key
     * @param {any} value
     * @returns {Promise<void>}
     */
    async setMeta(key, value) {
      const { CONFIG } = M;
      const db = await this.openDB();
      return new Promise(resolve => {
        const tx = db.transaction(CONFIG.DB_META, 'readwrite');
        const store = tx.objectStore(CONFIG.DB_META);
        store.put({ key, value });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    },
  };
  
  M.DBService = DBService;
  
})(window.LangModules = window.LangModules || {});