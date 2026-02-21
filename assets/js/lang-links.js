/**
 * Language Links - State-Driven Version
 * - อัพเดต links ตาม state ปัจจุบัน ไม่ใช่ตาม localStorage อย่างเดียว
 * - ทำงานร่วมกับ history state จาก language.min.js
 */

(function() {
  const SKIP_PREFIXES = ['/assets/', '/static/', '/api/', '/_next/', '/favicon.ico', '/robots.txt', '/sitemap.xml'];
  
  function isLocalDev() {
    try {
      const host = location.hostname || '';
      return !host || host === 'localhost' || host === '127.0.0.1' || 
             host.endsWith('.local') || ['3000','5173','8080'].includes(String(location.port));
    } catch (e) { return false; }
  }
  
  function getCurrentLang() {
    // อ่านจาก history state ก่อน (สำคัญ)
    try {
      const stateLang = history.state?.language;
      if (stateLang) return stateLang;
    } catch (e) {}
    
    // Fallback อ่านจาก URL
    const match = location.pathname.match(/^\/([a-z]{2})(\/|$)/i);
    if (match) return match[1].toLowerCase();
    
    // Fallback อ่านจาก localStorage
    try {
      return localStorage.getItem('selectedLang') || 'en';
    } catch (e) {
      return 'en';
    }
  }
  
  function shouldSkip(href) {
    if (!href || !href.startsWith('/')) return true;
    return SKIP_PREFIXES.some(p => href.startsWith(p));
  }
  
  function addPrefix(href, lang) {
    if (lang === 'en') return href;
    if (href.match(/^\/[a-z]{2}\b/i)) return href; // มี prefix แล้ว
    
    const clean = href.replace(/^\/[a-z]{2}\b/, '') || '/';
    return `/${lang}${clean === '/' ? '' : clean}`;
  }
  
  function updateLinks(root = document) {
    const lang = getCurrentLang();
    
    root.querySelectorAll('a[href^="/"]').forEach(a => {
      const href = a.getAttribute('href');
      if (shouldSkip(href)) return;
      
      const newHref = addPrefix(href, lang);
      if (href !== newHref) {
        a.setAttribute('href', newHref);
      }
    });
  }
  
  function init() {
    if (isLocalDev()) {
      // ใน dev mode อัพเดต links ตาม localStorage อย่างง่าย
      updateLinks();
      return;
    }
    
    // อัพเดต links เริ่มต้น
    updateLinks();
    
    // ฟัง languageChange event
    window.addEventListener('languageChange', (e) => {
      const lang = e.detail?.language;
      if (lang) {
        updateLinks();
      }
    });
    
    // ฟัง popstate เพื่ออัพเดต links เมื่อกด back/forward
    window.addEventListener('popstate', () => {
      // Delay นิดหน่อยให้ language.min.js อัพเดต state เสร็จก่อน
      setTimeout(() => updateLinks(), 10);
    });
    
    // Mutation observer สำหรับ links ที่เพิ่มเข้ามาใหม่
    const observer = new MutationObserver((muts) => {
      let hasNewLinks = false;
      muts.forEach(m => {
        m.addedNodes.forEach(n => {
          if (n.nodeType === 1) {
            if (n.tagName === 'A' || n.querySelector?.('a[href^="/"]')) {
              hasNewLinks = true;
            }
          }
        });
      });
      
      if (hasNewLinks) {
        setTimeout(() => updateLinks(), 0);
      }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    
    // Intercept clicks บน internal links (optional - เพื่อความสม่ำเสมอ)
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="/"]');
      if (!a) return;
      
      const href = a.getAttribute('href');
      if (shouldSkip(href)) return;
      
      // ถ้า link ไม่ตรงกับภาษาปัจจุบัน → แก้ไขก่อน navigate
      const currentLang = getCurrentLang();
      const expectedHref = addPrefix(href.replace(/^\/[a-z]{2}\b/, ''), currentLang);
      
      if (href !== expectedHref) {
        a.setAttribute('href', expectedHref);
        // ไม่ preventDefault ให้ navigate ตามปกติ
      }
    }, true);
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
