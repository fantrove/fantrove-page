/**
 * lang-links.js v2.0 - Smart Link Language Prefix Manager
 * 
 * หน้าที่:
 * 1. อัพเดทลิงก์ทั้งหมดในหน้าให้มี prefix ภาษาตามที่เลือก
 * 2. Intercept การคลิกลิงก์ภายในเว็บไซต์ - ถ้าลิงก์ไม่มี prefix ให้เติมให้
 * 3. ไม่แตะต้องลิงก์ภายนอก, mailto, tel, assets, APIs
 * 
 * การทำงาน:
 * - ตอน DOM ready: อัพเดทลิงก์ทั้งหมดให้มี prefix ตาม localStorage
 * - ตอนคลิก: ถ้าเป็น internal link ไม่มี prefix → เติม prefix → navigate
 * - ตอน languageChange: อัพเดทลิงก์ทั้งหมดใหม่ตามภาษาใหม่
 * 
 * ไม่รองรับ: URL parameters (?lang=th) - ใช้ path prefix เท่านั้น
 */

(function() {
  "use strict";
  
  const SUPPORTED_LANGS = ['en', 'th'];
  const DEFAULT_LANG = 'en';
  const LS_KEY = 'selectedLang';
  
  // Paths ที่ไม่ควรใส่ prefix
  const SKIP_PATHS = [
    '/assets/', '/static/', '/api/', '/_next/', 
    '/favicon.ico', '/robots.txt', '/sitemap.xml',
    '/sw.js', '/manifest.json', '/.well-known/'
  ];
  
  // Schemes ที่ไม่ควรแตะ
  const SKIP_SCHEMES = /^(mailto:|tel:|javascript:|data:|#|blob:|file:)/i;
  
  /**
   * อ่านภาษาปัจจุบันจาก localStorage
   */
  function getCurrentLang() {
    try {
      const stored = localStorage.getItem(LS_KEY);
      return SUPPORTED_LANGS.includes(stored) ? stored : DEFAULT_LANG;
    } catch (e) {
      return DEFAULT_LANG;
    }
  }
  
  /**
   * ตรวจสอบว่าเป็น internal link หรือไม่
   */
  function isInternalLink(href) {
    try {
      if (!href) return false;
      if (SKIP_SCHEMES.test(href)) return false;
      
      const url = new URL(href, location.origin);
      return url.origin === location.origin;
    } catch (e) {
      return false;
    }
  }
  
  /**
   * ตรวจสอบว่า path ควรใส่ prefix หรือไม่
   */
  function shouldPrefixPath(path) {
    if (!path.startsWith('/')) return false;
    for (const skip of SKIP_PATHS) {
      if (path.startsWith(skip)) return false;
    }
    return true;
  }
  
  /**
   * ตรวจสอบว่า path มี prefix ภาษาอยู่แล้วหรือไม่
   */
  function hasLangPrefix(path) {
    return /^\/(en|th)(\/|$)/.test(path);
  }
  
  /**
   * เพิ่ม prefix ภาษาให้กับ URL
   */
  function addLangPrefix(href, lang) {
    try {
      const url = new URL(href, location.origin);
      
      // ถ้ามี prefix อยู่แล้ว ไม่ต้องทำอะไร
      if (hasLangPrefix(url.pathname)) return href;
      
      // ถ้าไม่ควรใส่ prefix ให้ path นี้
      if (!shouldPrefixPath(url.pathname)) return href;
      
      // สร้าง path ใหม่
      const newPath = '/' + lang + (url.pathname === '/' ? '' : url.pathname);
      url.pathname = newPath;
      
      return url.toString();
    } catch (e) {
      return href;
    }
  }
  
  /**
   * อัพเดทลิงก์ทั้งหมดใน root ให้มี prefix ภาษา
   */
  function updateAllLinks(root, lang) {
    const links = root.querySelectorAll('a[href]');
    links.forEach(link => {
      const href = link.getAttribute('href');
      if (!href) return;
      if (!isInternalLink(href)) return;
      
      const newHref = addLangPrefix(href, lang);
      if (newHref !== href) {
        link.setAttribute('href', newHref);
      }
    });
  }
  
  /**
   * Intercept การคลิกลิงก์
   */
  function interceptLinkClicks(lang) {
    document.addEventListener('click', function(e) {
      try {
        const link = e.target.closest('a[href]');
        if (!link) return;
        
        const href = link.getAttribute('href');
        if (!href) return;
        if (!isInternalLink(href)) return;
        
        // ถ้าลิงก์มี prefix อยู่แล้ว ให้ผ่านไปตามปกติ
        if (hasLangPrefix(new URL(href, location.origin).pathname)) {
          return;
        }
        
        // ถ้าไม่ควรใส่ prefix
        if (!shouldPrefixPath(new URL(href, location.origin).pathname)) {
          return;
        }
        
        // เติม prefix และ navigate
        e.preventDefault();
        const newHref = addLangPrefix(href, lang);
        
        // ใช้ history.pushState เพื่อให้เป็น SPA-like navigation
        try {
          history.pushState({ lang: lang, ts: Date.now() }, '', newHref);
          // Dispatch popstate-like event ให้ languageManager จับได้
          window.dispatchEvent(new PopStateEvent('popstate', { state: { lang: lang } }));
        } catch (err) {
          // Fallback ถ้า pushState ไม่ได้
          window.location.href = newHref;
        }
        
      } catch (e) {
        // Ignore errors
      }
    }, true); // Use capture phase
  }
  
  /**
   * ตรวจสอบว่าเป็น local dev หรือไม่ (disable aggressive features)
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
   * Main initialization
   */
  function init() {
    const lang = getCurrentLang();
    
    // อัพเดทลิงก์ทั้งหมด
    updateAllLinks(document, lang);
    
    // Intercept การคลิก (ยกเว้น local dev)
    if (!isLocalDev()) {
      interceptLinkClicks(lang);
    }
    
    // ฟัง event languageChange เพื่ออัพเดทลิงก์ใหม่
    window.addEventListener('languageChange', function(e) {
      if (e.detail && e.detail.language) {
        updateAllLinks(document, e.detail.language);
      }
    });
    
    // Observe DOM mutations สำหรับ dynamic content
    const observer = new MutationObserver((mutations) => {
      const currentLang = getCurrentLang();
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            updateAllLinks(node, currentLang);
          }
        });
      });
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
  }
  
  // Run
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
