/**
 * lang-proxy.js v3.0 - Passive Language Prefix Sync (NO Auto-Redirect)
 *
 * ทำงาน: ก่อน DOM โหลด (ใส่ใน <head>)
 * หน้าที่ (v3.0):
 * - ถ้าเป็น localhost → ปิดตัวเองทันที ไม่ทำอะไรเลย
 * - ถ้า URL มี prefix /en/ หรือ /th/ → sync ลง localStorage เท่านั้น
 * - ถ้า URL ไม่มี prefix → ไม่ทำอะไรเลย (ปล่อยให้หน้าโหลดตามปกติ)
 *
 * ════════════════════════════════════════════════════════════════════════
 * การเปลี่ยนแปลง v3.0 (FIX GSC "Page with redirect"):
 * ════════════════════════════════════════════════════════════════════════
 *
 *  ปัญหา: v2.2 มีการ redirect อัตโนมัติ 3 จุด ทำให้ Google Search Console
 *         ฟักว่าเป็น "Page with redirect" และไม่สามารถจัดทำดัชนีได้
 *
 *  การแก้ไข:
 *   1. ยกเลิก CASE 2 (URL ไม่มี prefix → redirect ไป URL ที่มี prefix)
 *      เหตุผล: เป็นการเปลี่ยนเส้นทางอัตโนมัติ — Googlebot มองเป็น redirect
 *   2. ยกเลิก CASE 1 back_forward/reload override
 *      (URL มี prefix แต่ storedLang ขัดแย้ง → redirect ไป URL ของ storedLang)
 *      เหตุผล: เป็นการเปลี่ยนเส้นทางอัตโนมัติเช่นกัน
 *   3. ยกเลิก error fallback redirect (ใน catch block)
 *      เหตุผล: แม้จะ error ก็ไม่ควร redirect เพื่อกัน Google มองเป็น redirect
 *
 *  สิ่งที่ยังคงอยู่ (ไม่ถูกแก้):
 *   - sync localStorage เมื่อ URL มี prefix (ไม่ใช่ redirect, ไม่มีผลต่อ Google)
 *   - การเปลี่ยนภาษาด้วยตนเองผ่านปุ่มเลือกภาษา (manager.js → selectLanguage)
 *     ยังคงทำการ redirect ผ่าน location.replace() ตามปกติ
 *     → เป็นการกระทำโดยตรงของ user ไม่ใช่อัตโนมัติ
 *
 *  หมายเหตุ:
 *   - ใน production built pages ไฟล์นี้จะถูกลบออกจาก HTML โดย build.js
 *     (removeScriptPatterns: ['lang-proxy.js']) → ไม่ทำงานอยู่แล้ว
 *   - แต่เก็บการแก้ไขนี้ไว้เพื่อ:
 *     a) ป้องกันปัญหาในอนาคตหาก build config เปลี่ยน
 *     b) แก้ปัญหาใน dev mode หรือการ deploy โดยไม่ผ่าน build
 *     c) ตรงกับคำขอของ user: "ยกเลิกระบบที่บังคับให้เพิ่ม prefix อัตโนมัติ"
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
   * อ่านภาษาจาก URL path
   */
  function getLangFromPath(path) {
    const m = path.match(/^\/(en|th)(\/|$)/);
    return m ? m[1] : null;
  }

  // ==================== MAIN LOGIC (v3.0 — Passive Sync Only) ====================

  try {
    const currentPath = location.pathname;
    const urlLang = getLangFromPath(currentPath);

    // ─────────────────────────────────────────────────────────────────────────
    // URL มี prefix ภาษา (/en/... หรือ /th/...)
    // → sync ลง localStorage เท่านั้น
    // → ไม่ redirect ไม่ว่ากรณีใดๆ (แม้ storedLang จะขัดแย้งกับ urlLang)
    //
    // [FIX v3.0] ยกเลิก back_forward/reload override ที่เคย redirect
    //   เหตุผล: เป็นการเปลี่ยนเส้นทางอัตโนมัติ — Googlebot มองเป็น redirect
    //   ตอนนี้ยึด URL เป็นหลักเสมอ (user เจอ URL นี้มา ก็ใช้ URL นี้)
    //   localStorage จะถูก sync ให้ตรงกับ URL แทน
    // ─────────────────────────────────────────────────────────────────────────
    if (urlLang) {
      try {
        // sync localStorage ให้ตรงกับ URL (เพื่อความสอดคล้องข้าม tabs)
        localStorage.setItem(LS_KEY, urlLang);

        // บันทึก nav-lang map ตามปกติ (ใช้โดย navigation.js สำหรับ sync)
        const key = currentPath + (location.search || '');
        const map = JSON.parse(sessionStorage.getItem('fv-nav-lang-map') || '{}');
        map[key] = { lang: urlLang, ts: Date.now(), source: 'url-prefix' };
        sessionStorage.setItem('fv-nav-lang-map', JSON.stringify(map));
      } catch (e) {}

      // ปล่อยให้หน้าโหลดต่อ — ไม่ redirect
      return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // URL ไม่มี prefix ภาษา
    // → ไม่ทำอะไรเลย ปล่อยให้หน้าโหลดตามปกติ
    //
    // [FIX v3.0] ยกเลิก CASE 2 ที่เคย redirect ไป URL ที่มี prefix
    //   เหตุผล: เป็นการเปลี่ยนเส้นทางอัตโนมัติ — Googlebot มองเป็น redirect
    //          ทำให้ GSC ขึ้น "Page with redirect" และไม่สามารถจัดทำดัชนีได้
    //
    //   ผลกระทบ:
    //   - URL ที่ไม่มี prefix จะถูกจัดการโดย _redirects ของ Cloudflare Pages
    //     (อาจเป็น 404 หรือ rewrite ตาม config — ไม่ใช่ redirect ของ JS)
    //   - หน้าเว็บที่ build แล้ว (มี /en/ และ /th/) ยังคงทำงานปกติ
    //   - การเปลี่ยนภาษาด้วยตนเองผ่านปุ่มเลือกภาษายังคงทำงานปกติ
    //     (ผ่าน manager.js → selectLanguage → location.replace)
    // ─────────────────────────────────────────────────────────────────────────
    return;

  } catch (err) {
    // ─────────────────────────────────────────────────────────────────────────
    // [FIX v3.0] Error fallback — ไม่ redirect แม้จะ error
    //
    //   ก่อนหน้านี้: catch block จะ redirect ไป /en/ (DEFAULT_LANG)
    //   ปัญหา: เป็นการ redirect อัตโนมัติ — Googlebot มองเป็น redirect
    //   ตอนนี้: ปล่อยให้หน้าโหลดตามปกติแม้จะ error
    // ─────────────────────────────────────────────────────────────────────────
    // (intentionally empty — silent fail, no redirect)
    return;
  }
})();
