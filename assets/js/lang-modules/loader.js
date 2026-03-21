// @ts-check
/**
 * @file loader.js
 * LoaderService — โหลด language config และ translation data
 *
 * หน้าที่:
 *  prefetchEnterprise()   — preconnect + preload + โหลด db.json config
 *  loadLanguagesConfig()  — await prefetch แล้ว validate config
 *  loadLanguageData(lang) — โหลด /assets/lang/{lang}.json แล้ว flatten
 *  flattenLanguageJson()  — flatten nested JSON เป็น flat key-value map
 *  getEnSource()          — อ่านว่า English ใช้ JSON หรือ HTML
 *
 * @module loader
 * @depends {config.js, state.js}
 */
(function(M) {
  'use strict';
  
  const LoaderService = {
    
    // ── Config prefetch ───────────────────────────────────────────────────────
    
    /**
     * เริ่ม preconnect, preload, และโหลด db.json ทันที (ก่อน DOM ready)
     * เก็บ config ลง State.languagesConfig
     * @returns {Promise<void>}
     */
    async prefetchEnterprise() {
      const { CONFIG, State } = M;
      
      // Preconnect ไว้ก่อน (non-blocking)
      if (typeof document !== 'undefined' && document.head) {
        CONFIG.PRECONNECT_URLS.forEach(href => {
          if (!document.head.querySelector(`link[href^="${href}"]`)) {
            const l = document.createElement('link');
            l.rel = 'preconnect';
            l.href = href;
            l.crossOrigin = 'anonymous';
            document.head.appendChild(l);
          }
        });
        
        // Preload db.json
        if (!document.head.querySelector('link[rel="preload"][as="fetch"]')) {
          const preload = document.createElement('link');
          preload.rel = 'preload';
          preload.as = 'fetch';
          preload.href = CONFIG.DB_JSON_URL;
          preload.crossOrigin = 'anonymous';
          document.head.appendChild(preload);
        }
      }
      
      // ลองอ่านจาก cache ก่อน
      let config = null;
      try {
        const lc = localStorage.getItem(CONFIG.CFG_CACHE_KEY);
        const sc = sessionStorage.getItem(CONFIG.CFG_CACHE_KEY);
        if (lc) config = JSON.parse(lc);
        else if (sc) config = JSON.parse(sc);
      } catch (e) {}
      
      // Fetch ใหม่เสมอ (cache: no-cache เพื่อความสดของ config)
      try {
        const resp = await fetch(CONFIG.DB_JSON_URL, { cache: 'no-cache' });
        if (resp.ok) {
          const newConfig = await resp.json();
          config = newConfig;
          try {
            localStorage.setItem(CONFIG.CFG_CACHE_KEY, JSON.stringify(config));
            sessionStorage.setItem(CONFIG.CFG_CACHE_KEY, JSON.stringify(config));
          } catch (e) {}
        }
      } catch (e) {}
      
      if (config) State.languagesConfig = config;
    },
    
    /**
     * รอ prefetch เสร็จ แล้ว validate ว่า config ถูกต้อง
     * เรียกจาก LanguageManager.initialize()
     * @returns {Promise<void>}
     * @throws {Error} ถ้า config ผิดหรือโหลดไม่ได้
     */
    async loadLanguagesConfig() {
      const { State } = M;
      
      // รอ prefetch ที่เริ่มไว้แล้วตอน boot
      await State._prefetchPromise;
      
      if (!State.languagesConfig || !Object.keys(State.languagesConfig).length) {
        throw new Error('Config ไม่ถูกต้อง');
      }
    },
    
    // ── Language data ─────────────────────────────────────────────────────────
    
    /**
     * โหลด translation data สำหรับภาษาที่ระบุ
     * cache ไว้ใน State.languageCache เพื่อไม่ต้องโหลดซ้ำ
     * @param {string} lang
     * @returns {Promise<Object|null>}
     */
    async loadLanguageData(lang) {
      const { CONFIG, State } = M;
      
      // return cache ถ้ามีแล้ว
      if (State.languageCache[lang]) return State.languageCache[lang];
      
      try {
        const resp = await fetch(CONFIG.LANG_JSON_URL(lang), { cache: 'no-cache' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const flattened = this.flattenLanguageJson(data);
        State.languageCache[lang] = flattened;
        return flattened;
      } catch (e) {
        console.error(`[LoaderService] Error loading language ${lang}:`, e);
        return null;
      }
    },
    
    /**
     * Flatten nested JSON เป็น { key: value } map แบบ flat
     * { a: { b: 'hello' } } → { b: 'hello' }
     * @param {Object} json
     * @returns {Object}
     */
    flattenLanguageJson(json) {
      const result = {};
      const recur = (obj) => {
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'object' && v !== null) recur(v);
          else result[k] = v;
        }
      };
      recur(json);
      return result;
    },
    
    /**
     * อ่านว่า English content มาจาก JSON หรือ HTML (original DOM)
     * @returns {'json'|'html'}
     */
    getEnSource() {
      const { State } = M;
      return State.languagesConfig?.en?.enSource === 'json' ? 'json' : 'html';
    },
  };
  
  M.LoaderService = LoaderService;
  
})(window.LangModules = window.LangModules || {});