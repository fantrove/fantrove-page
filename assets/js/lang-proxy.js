/**
 * lang-proxy.js v2.0 - Smart Language Prefix Proxy
 * 
 * ทำงาน: ก่อน DOM โหลด (ใส่ใน <head>)
 * หน้าที่: 
 * - ถ้า URL มี prefix /en/ หรือ /th/ → ผ่าน + sync ลง localStorage
 * - ถ้า URL ไม่มี prefix → redirect ไปหน้าที่มี prefix ทันที
 * 
 * ไม่มีทางให้ user เข้าหน้าไม่มี prefix เด็ดขาด
 */

(function() {
  "use strict";
  
  const SUPPORTED_LANGS = ['en', 'th'];
  const DEFAULT_LANG = 'en';
  const LS_KEY = 'selectedLang';
  
  /**
   * อ่านภาษาจาก URL path
   * @returns {string|null} 'en', 'th' หรือ null
   */
  function getLangFromPath(path) {
    const m = path.match(/^\/(en|th)(\/|$)/);
    return m ? m[1] : null;
  }
  
  /**
   * อ่านภาษาจาก localStorage
   */
  function getLangFromStorage() {
    try {
      const stored = localStorage.getItem(LS_KEY);
      return SUPPORTED_LANGS.includes(stored) ? stored : null;
    } catch (e) {
      return null;
    }
  }
  
  /**
   * Detect ภาษาจาก browser
   */
  function detectBrowserLang() {
    try {
      const langs = navigator.languages || [navigator.language || navigator.userLanguage];
      for (const lang of langs) {
        const code = lang.split('-')[0];
        if (SUPPORTED_LANGS.includes(code)) return code;
      }
    } catch (e) {}
    return DEFAULT_LANG;
  }
  
  /**
   * ตรวจสอบว่าเป็น local dev หรือไม่
   */
  function isLocalDev() {
    try {
      const host = location.hostname || '';
      return host === 'localhost' || host === '127.0.0.1' || 
             host === '0.0.0.0' || host.endsWith('.local');
    } catch (e) { 
      return false; 
    }
  }
  
  /**
   * สร้าง reload marker สำหรับ coordination
   */
  function setReloadMarker(source) {
    try {
      const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
      const marker = { id, ts: Date.now(), source: source || 'proxy' };
      sessionStorage.setItem('fv-forcereload', JSON.stringify(marker));
      return marker;
    } catch (e) { 
      return null; 
    }
  }
  
  function setInflight(id) {
    try { 
      if (id) sessionStorage.setItem('fv-reload-inflight', id); 
    } catch (e) {}
  }
  
  // ==================== MAIN LOGIC ====================
  
  try {
    const currentPath = location.pathname;
    const urlLang = getLangFromPath(currentPath);
    const storedLang = getLangFromStorage();
    
    // CASE 1: URL มี prefix ภาษา (/en/... หรือ /th/...)
    if (urlLang) {
      // Sync ลง localStorage ทันที (URL เป็น source of truth)
      try {
        localStorage.setItem(LS_KEY, urlLang);
        
        // บันทึก mapping สำหรับ popstate prediction
        const key = currentPath + (location.search || '');
        const map = JSON.parse(sessionStorage.getItem('fv-nav-lang-map') || '{}');
        map[key] = { 
          lang: urlLang, 
          ts: Date.now(), 
          source: 'url-prefix' 
        };
        sessionStorage.setItem('fv-nav-lang-map', JSON.stringify(map));
      } catch (e) {}
      
      // ไม่ต้องทำอะไรต่อ ให้หน้าโหลดตามปกติ
      return;
    }
    
    // CASE 2: URL ไม่มี prefix → ห้ามเข้า! ต้อง redirect ทันที
    
    // ตัดสินใจว่าจะ redirect ไปภาษาไหน
    let targetLang = storedLang;
    if (!targetLang) {
      targetLang = detectBrowserLang();
    }
    
    // สร้าง path ใหม่โดยเพิ่ม prefix
    let newPath = '/' + targetLang;
    if (currentPath && currentPath !== '/') {
      newPath = '/' + targetLang + currentPath;
    }
    
    // สร้าง URL เต็ม
    const newURL = newPath + location.search + location.hash;
    
    // ตั้ง marker ก่อน redirect (สำหรับ coordination)
    const marker = setReloadMarker('proxy-redirect');
    if (marker) setInflight(marker.id);
    
    // ใช้ replace ไม่ให้สร้าง history entry เพิ่ม (เพราะเป็นการ "fix" URL)
    location.replace(newURL);
    
  } catch (err) {
    console.error('lang-proxy error:', err);
    // fail silently แต่พยายาม recover
    try {
      location.replace('/' + DEFAULT_LANG + '/');
    } catch (e) {}
  }
})();
