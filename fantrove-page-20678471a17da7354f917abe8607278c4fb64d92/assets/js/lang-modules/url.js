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
     * localhost → ไม่ทำอะไรเลย
     *
     * @param {string} lang
     */
    updateURLForLanguage(lang) {
      const { DetectorService } = M;
      
      // localhost ไม่ยุ่งกับ URL เด็ดขาด
      if (DetectorService.isLocalDev()) return;
      
      try {
        const currentPath = location.pathname;
        const currentLang = DetectorService.getLangFromURL();
        
        // ถ้า URL ตรงกับภาษาที่เลือกแล้ว ไม่ต้องทำอะไร
        if (currentLang === lang) return;
        
        let newPath;
        if (currentLang) {
          // แทนที่ prefix เดิม /en/ → /th/
          newPath = currentPath.replace(/^\/(en|th)(\/|$)/, '/' + lang + '$2');
        } else {
          // เพิ่ม prefix ใหม่
          newPath = '/' + lang + (currentPath === '/' ? '' : currentPath);
        }
        
        const newURL = newPath + location.search + location.hash;
        history.replaceState({ lang, ts: Date.now() }, '', newURL);
        
      } catch (e) {
        console.error('[URLService] Error updating URL:', e);
      }
    },
  };
  
  M.URLService = URLService;
  
})(window.LangModules = window.LangModules || {});