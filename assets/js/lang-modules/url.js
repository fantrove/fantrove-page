// @ts-check
/**
 * @file url.js
 * URLService — อัพเดท URL ให้ตรงกับภาษาที่เลือก
 *
 * ใช้ history.replaceState (ไม่สร้าง history entry ใหม่)
 * localhost → ไม่ทำอะไร
 *
 * @module url
 * @depends {config.js, state.js, detector.js}
 */
(function(M) {
  'use strict';
  
  const URLService = {
    
    /**
     * แก้ URL ให้มี language prefix ที่ถูกต้อง โดยไม่ reload หน้า
     * ใช้ replaceState — ไม่เพิ่ม history entry
     *
     * [FIX v3.1] เปลี่ยนเป็น no-op — ปิดระบบบังคับเพิ่ม prefix อัตโนมัติ
     *
     * เหตุผล: Google Search Console ฟังว่าเป็น "Page with redirect" เพราะระบบ
     *   อัตโนมัติเติม prefix ภาษาผ่าน replaceState → Googlebot มองเป็น redirect
     *   → ไม่สามารถจัดทำดัชนีได้
     *
     * สิ่งที่ยังคงอยู่:
     *   - การเปลี่ยนภาษาด้วยตนเอง (selectLanguage) จะเปลี่ยน URL โดยตรง
     *     ผ่าน replaceState ใน selectLanguage() แทน ไม่ผ่าน URLService
     *   - Built pages มี prefix ในลิงก์อยู่แล้ว (html-transformer)
     *   - _redirects ของ Cloudflare Pages จัดการ routing โดย rewrite (200)
     *
     * @param {string} lang
     */
    updateURLForLanguage(lang) {
      // [FIX v3.1] No-op — automatic URL prefix forcing disabled for GSC
      // Manual language switching handles URL change directly in selectLanguage()
      return;
    },
  };
  
  M.URLService = URLService;
  
})(window.LangModules = window.LangModules || {});