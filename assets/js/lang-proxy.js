/**
 * lang-proxy.js v2.2 - Smart Language Prefix Proxy
 *
 * ทำงาน: ก่อน DOM โหลด (ใส่ใน <head>)
 * หน้าที่:
 * - ถ้าเป็น localhost → ปิดตัวเองทันที ไม่ทำอะไรเลย
 * - ถ้า URL มี prefix /en/ หรือ /th/ → ผ่าน + sync ลง localStorage
 * - ถ้า URL ไม่มี prefix → redirect ไปหน้าที่มี prefix ทันที
 *
 * การเปลี่ยนแปลงใน v2.2:
 * - เพิ่ม getNavType() เพื่อแยก back_forward / reload / navigate
 * - CASE 1 (URL มี prefix):
 *     back_forward / reload  → ยึด storedLang เสมอ (user เพิ่งเปลี่ยนภาษา)
 *     navigate               → trust URL, อัพเดท localStorage ให้ตรงกับ urlLang
 *                              (user พิมพ์ URL เองหรือเปิด link จากที่อื่น)
 */

(function() {
  "use strict";

  const SUPPORTED_LANGS = ['en', 'th'];
  const DEFAULT_LANG = 'en';
  const LS_KEY = 'selectedLang';

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

  // ==================== LOCALHOST BYPASS ====================
  if (isLocalDev()) return;
  // ==================== END BYPASS ====================

  /**
   * อ่านประเภทของ navigation ที่พาเรามาถึงหน้านี้
   *
   * 'navigate'     → พิมพ์ URL เอง / คลิก link / เปิด bookmark
   * 'back_forward' → กด Back หรือ Forward
   * 'reload'       → กด Refresh / Ctrl+R
   * 'prerender'    → browser pre-render (ปฏิบัติเหมือน navigate)
   *
   * ใช้ Navigation Timing API Level 2 เป็น primary
   * fallback ไปที่ deprecated performance.navigation.type
   */
  function getNavType() {
    try {
      const entries = performance.getEntriesByType('navigation');
      if (entries && entries.length > 0 && entries[0].type) {
        return entries[0].type; // 'navigate' | 'reload' | 'back_forward' | 'prerender'
      }
    } catch (e) { /* ไม่รองรับ */ }

    try {
      // fallback: Navigation Timing Level 1 (deprecated แต่ยังใช้ได้บาง browser)
      if (performance && performance.navigation) {
        switch (performance.navigation.type) {
          case 0: return 'navigate';
          case 1: return 'reload';
          case 2: return 'back_forward';
          default: return 'navigate';
        }
      }
    } catch (e) { /* ไม่รองรับ */ }

    return 'navigate'; // safe default
  }

  /**
   * อ่านภาษาจาก URL path
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
    const urlLang     = getLangFromPath(currentPath);
    const storedLang  = getLangFromStorage();
    const navType     = getNavType();

    // ─────────────────────────────────────────────────────────────────────────
    // CASE 1: URL มี prefix ภาษา (/en/... หรือ /th/...)
    // ─────────────────────────────────────────────────────────────────────────
    if (urlLang) {

      if (storedLang && storedLang !== urlLang) {
        // มี conflict ระหว่าง URL กับ stored preference → ตัดสินจาก navType

        if (navType === 'back_forward' || navType === 'reload') {
          // ────────────────────────────────────────────────────────────────────
          // กด Back/Forward หรือ Refresh:
          //   user เพิ่งเปลี่ยนภาษาในหน้าอื่น → ยึด storedLang เสมอ
          //   URL เก่าคือหน้าเก่า ไม่ใช่ intent ปัจจุบันของ user
          // ────────────────────────────────────────────────────────────────────
          const newPath = currentPath.replace(/^\/(en|th)(\/|$)/, '/' + storedLang + '$2');
          const newURL  = newPath + location.search + location.hash;
          const marker  = setReloadMarker('proxy-back-override');
          if (marker) setInflight(marker.id);
          location.replace(newURL);
          return;
        }

        // navType === 'navigate' (หรือ 'prerender'):
        // ────────────────────────────────────────────────────────────────────
        // User พิมพ์ URL เอง / เปิด bookmark / คลิกจาก link ภายนอก:
        //   ถือว่า user มี intent ชัดเจนว่าต้องการหน้าภาษา urlLang
        //   → trust URL, อัพเดท localStorage ให้ตรงกับ URL
        //   ไม่ redirect เพราะ user ตั้งใจมาหน้านี้
        // ────────────────────────────────────────────────────────────────────
        try {
          localStorage.setItem(LS_KEY, urlLang);
        } catch (e) {}

        // บันทึก nav-lang map ตามปกติ แล้วปล่อยให้หน้าโหลด
        try {
          const key = currentPath + (location.search || '');
          const map = JSON.parse(sessionStorage.getItem('fv-nav-lang-map') || '{}');
          map[key] = { lang: urlLang, ts: Date.now(), source: 'url-navigate' };
          sessionStorage.setItem('fv-nav-lang-map', JSON.stringify(map));
        } catch (e) {}

        return;
      }

      // storedLang ตรงกับ urlLang แล้ว (หรือยังไม่มี stored preference)
      // → sync ลง localStorage แล้วปล่อยให้หน้าโหลดตามปกติ
      try {
        localStorage.setItem(LS_KEY, urlLang);

        const key = currentPath + (location.search || '');
        const map = JSON.parse(sessionStorage.getItem('fv-nav-lang-map') || '{}');
        map[key] = { lang: urlLang, ts: Date.now(), source: 'url-prefix' };
        sessionStorage.setItem('fv-nav-lang-map', JSON.stringify(map));
      } catch (e) {}

      return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASE 2: URL ไม่มี prefix → redirect ไปหน้าที่มี prefix ทันที
    // ─────────────────────────────────────────────────────────────────────────

    // ตัดสินว่าจะ redirect ไปภาษาไหน
    // Priority: localStorage (user choice) > browser detection
    let targetLang = storedLang;
    if (!targetLang) {
      targetLang = detectBrowserLang();
    }

    let newPath = '/' + targetLang;
    if (currentPath && currentPath !== '/') {
      newPath = '/' + targetLang + currentPath;
    }

    const newURL = newPath + location.search + location.hash;
    const marker = setReloadMarker('proxy-redirect');
    if (marker) setInflight(marker.id);

    location.replace(newURL);

  } catch (err) {
    console.error('lang-proxy error:', err);
    try {
      location.replace('/' + DEFAULT_LANG + '/');
    } catch (e) {}
  }
})();
