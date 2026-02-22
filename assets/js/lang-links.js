/**
 * lang-links.js v2.1 - Smart Link Language Prefix Manager (updated)
 *
 * - อัพเดทลิงก์ทั้งหมดให้มี prefix ภาษา (เรียกได้จากภายนอก)
 * - Intercept การคลิกลิงก์ภายในเว็บไซต์ — ถ้าลิงก์ไม่มี prefix ให้เติม และใช้ history navigation
 * - ไม่แตะต้องลิงก์ภายนอก, mailto, tel, assets, APIs
 *
 * เพิ่ม: เปิดเผย API เล็ก ๆ ผ่าน window.FVLangLinks เพื่อให้ coordinator เรียกใช้งานได้
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
  
  function getCurrentLang() {
    try {
      const stored = localStorage.getItem(LS_KEY);
      return SUPPORTED_LANGS.includes(stored) ? stored : DEFAULT_LANG;
    } catch (e) {
      return DEFAULT_LANG;
    }
  }
  
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
  
  function shouldPrefixPath(path) {
    if (!path.startsWith('/')) return false;
    for (const skip of SKIP_PATHS) {
      if (path.startsWith(skip)) return false;
    }
    return true;
  }
  
  function hasLangPrefix(path) {
    return /^\/(en|th)(\/|$)/.test(path);
  }
  
  function addLangPrefix(href, lang) {
    try {
      const url = new URL(href, location.origin);
      
      // If prefix exists or shouldn't prefix, return original href
      if (hasLangPrefix(url.pathname) || !shouldPrefixPath(url.pathname)) return href;
      
      const newPath = '/' + lang + (url.pathname === '/' ? '' : url.pathname);
      url.pathname = newPath;
      return url.toString();
    } catch (e) {
      return href;
    }
  }
  
  function updateAllLinks(root, lang) {
    try {
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
    } catch (e) {
      // ignore
    }
  }
  
  // Intercept link clicks — read current language dynamically
  function interceptLinkClicks() {
    document.addEventListener('click', function(e) {
      try {
        const link = e.target.closest('a[href]');
        if (!link) return;
        
        const href = link.getAttribute('href');
        if (!href) return;
        if (!isInternalLink(href)) return;
        
        const url = new URL(href, location.origin);
        
        // If it already has prefix or shouldn't prefix, let it proceed
        if (hasLangPrefix(url.pathname) || !shouldPrefixPath(url.pathname)) return;
        
        // Add prefix based on current stored language at click time
        const lang = getCurrentLang();
        const newHref = addLangPrefix(href, lang);
        
        // Prevent default navigation — use history to keep SPA like behavior
        e.preventDefault();
        try {
          history.pushState({ lang: lang, ts: Date.now() }, '', newHref);
          // Dispatch popstate-like event so coordinator / language manager can react
          window.dispatchEvent(new PopStateEvent('popstate', { state: { lang: lang } }));
        } catch (err) {
          // Fallback
          window.location.href = newHref;
        }
      } catch (err) {
        // ignore
      }
    }, true); // capture phase
  }
  
  // Observe DOM mutations for dynamically added links
  function observeMutations() {
    const observer = new MutationObserver((mutations) => {
      const currentLang = getCurrentLang();
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            updateAllLinks(node, currentLang);
          }
        });
      });
    });
    try {
      observer.observe(document.body, { childList: true, subtree: true });
    } catch (e) {
      // ignore
    }
  }
  
  function isLocalDev() {
    try {
      const host = location.hostname || '';
      return host === 'localhost' || host === '127.0.0.1' ||
        host === '0.0.0.0' || host.endsWith('.local');
    } catch (e) {
      return false;
    }
  }
  
  // Initialization
  function init() {
    const lang = getCurrentLang();
    updateAllLinks(document, lang);
    if (!isLocalDev()) interceptLinkClicks();
    observeMutations();
    
    // Update links on languageChange events (language manager is expected to dispatch this)
    window.addEventListener('languageChange', function(e) {
      const newLang = e.detail && e.detail.language ? e.detail.language : getCurrentLang();
      updateAllLinks(document, newLang);
    });
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  // Expose some helpers to coordinator
  window.FVLangLinks = {
    addLangPrefix,
    updateAllLinks,
    isInternalLink,
    hasLangPrefix,
    getCurrentLang
  };
})();