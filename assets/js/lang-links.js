/* assets/js/lang-links.js
   Smart URL Sync System - Phase 3: Link Management
   จัดการ links บนหน้าเว็บให้ตรงกับภาษาปัจจุบันเสมอ
   
   หน้าที่:
   1. อัพเดททุก link บนหน้าให้มี prefix ตรงกับภาษาปัจจุบัน
   2. Intercept clicks เพื่อตรวจสอบภาษาก่อนนำทาง
   3. จัดการกรณีผู้ใช้เปลี่ยนภาษาแล้วคลิก link เก่า
*/

(function() {
  'use strict';
  
  const DEBUG = false;
  const log = DEBUG ? console.log.bind(console, '[LangLinks]') : () => {};
  
  const CONFIG = {
    LANGS: ['en', 'th'],
    SKIP_PATHS: ['/assets/', '/static/', '/api/', '/_next/', '/favicon.ico', '/robots.txt', '/sitemap.xml'],
    ATTR_PREFIXED: 'data-lang-prefixed',
    ATTR_ORIGINAL: 'data-original-href'
  };
  
  let currentLang = null;
  
  // Utility: Get current language
  function getCurrentLang() {
    if (currentLang) return currentLang;
    try {
      currentLang = localStorage.getItem('selectedLang');
    } catch (e) {}
    if (!currentLang) {
      const match = location.pathname.match(/^\/(en|th)(\/|$)/);
      currentLang = match ? match[1] : 'en';
    }
    return currentLang;
  }
  
  // Utility: Check if href should be processed
  function shouldProcess(href) {
    if (!href || typeof href !== 'string') return false;
    if (/^(mailto|tel|javascript|#|data:)/i.test(href)) return false;
    if (href.startsWith('http') && !href.includes(location.host)) return false;
    return true;
  }
  
  // Utility: Check if already has lang prefix
  function hasLangPrefix(href) {
    return /^\/(en|th)(\/|$)/.test(href);
  }
  
  // Core: Add language prefix to href
  function addLangPrefix(href, lang) {
    if (!shouldProcess(href)) return href;
    if (hasLangPrefix(href)) {
      // Check if prefix matches current lang
      const match = href.match(/^\/(en|th)(\/|$)/);
      if (match && match[1] === lang) return href;
      // Replace wrong prefix
      return href.replace(/^\/(en|th)(\/|$)/, `/${lang}$2`);
    }
    
    try {
      const url = new URL(href, location.origin);
      if (url.origin !== location.origin) return href;
      
      // Check skip paths
      for (const skip of CONFIG.SKIP_PATHS) {
        if (url.pathname.startsWith(skip)) return href;
      }
      
      url.pathname = `/${lang}${url.pathname}`;
      return url.toString();
    } catch (e) {
      // Relative path
      if (href.startsWith('/')) {
        for (const skip of CONFIG.SKIP_PATHS) {
          if (href.startsWith(skip)) return href;
        }
        return `/${lang}${href}`;
      }
      return href;
    }
  }
  
  // Core: Process all links in container
  function processLinks(container = document) {
    const lang = getCurrentLang();
    const links = container.querySelectorAll('a[href]');
    
    links.forEach(link => {
      const href = link.getAttribute('href');
      if (!shouldProcess(href)) return;
      
      // Store original if not stored
      if (!link.hasAttribute(CONFIG.ATTR_ORIGINAL)) {
        link.setAttribute(CONFIG.ATTR_ORIGINAL, href);
      }
      
      const original = link.getAttribute(CONFIG.ATTR_ORIGINAL);
      const newHref = addLangPrefix(original, lang);
      
      if (href !== newHref) {
        link.setAttribute('href', newHref);
        link.setAttribute(CONFIG.ATTR_PREFIXED, 'true');
        log('Updated link:', original, '->', newHref);
      }
    });
  }
  
  // Core: Handle click interception
  function handleClick(e) {
    const link = e.target.closest('a[href]');
    if (!link) return;
    
    const href = link.getAttribute('href');
    if (!shouldProcess(href)) return;
    
    const lang = getCurrentLang();
    const current = location.pathname.match(/^\/(en|th)(\/|$)/);
    const currentPathLang = current ? current[1] : null;
    
    // If clicking a link with different lang prefix than current
    if (hasLangPrefix(href)) {
      const linkMatch = href.match(/^\/(en|th)(\/|$)/);
      if (linkMatch && linkMatch[1] !== currentPathLang) {
        // Update stored lang to match link
        try {
          localStorage.setItem('selectedLang', linkMatch[1]);
          currentLang = linkMatch[1];
          log('Lang changed via link click to', linkMatch[1]);
        } catch (e) {}
      }
      return; // Let it navigate normally
    }
    
    // If no prefix in link but we have lang, add it
    const newHref = addLangPrefix(href, lang);
    if (newHref !== href) {
      e.preventDefault();
      log('Intercepted click, navigating to', newHref);
      location.href = newHref;
    }
  }
  
  // Update language and refresh all links
  function updateLanguage(lang) {
    currentLang = lang;
    log('Language updated to', lang);
    
    // Update all existing links
    processLinks();
    
    // Update links that were dynamically added
    setTimeout(() => processLinks(), 0);
  }
  
  // Watch for DOM changes
  function observeDOM() {
    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === 1) { // Element
            if (node.tagName === 'A' || node.querySelector('a[href]')) {
              shouldProcess = true;
            }
          }
        });
      });
      
      if (shouldProcess) {
        setTimeout(() => processLinks(), 0);
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
  
  // Listen for language changes
  function setupListeners() {
    // From LanguageManager
    window.addEventListener('languageChange', (e) => {
      if (e.detail && e.detail.language) {
        updateLanguage(e.detail.language);
      }
    });
    
    // Storage events (other tabs)
    window.addEventListener('storage', (e) => {
      if (e.key === 'selectedLang') {
        updateLanguage(e.newValue);
      }
    });
    
    // Click interception
    document.addEventListener('click', handleClick, true);
  }
  
  // Initialize
  function init() {
    log('Initializing LangLinks');
    
    // Initial processing
    processLinks();
    
    // Setup observers and listeners
    observeDOM();
    setupListeners();
    
    // Expose API
    window.LangLinks = {
      process: processLinks,
      updateLanguage: updateLanguage,
      getCurrentLang: getCurrentLang,
      addPrefix: (href, lang) => addLangPrefix(href, lang || getCurrentLang())
    };
  }
  
  // Run
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
