/**
 * Language Links Manager v3.0
 * ทำหน้าที่:
 * 1. อัปเดตลิงก์ทั้งหมดให้มี prefix ภาษา
 * 2. จัดการการนำทางโดยคงภาษาปัจจุบันไว้
 * 3. บันทึก mapping สำหรับการย้อนกลับ
 */

(function() {
  'use strict';

  const CONFIG = {
    LANGS: ['en', 'th'],
    SKIP_PREFIXES: ['/assets/', '/static/', '/api/', '/_next/', '/favicon.ico', '/robots.txt', '/sitemap.xml'],
    STORAGE_KEY: 'selectedLang',
    NAV_MAP_KEY: 'fv-nav-lang-map'
  };

  // Utility: URL Manager
  const UrlManager = {
    extractLang(path) {
      const match = path.match(/^\/(en|th)(\/|$)/);
      return match ? match[1] : null;
    },

    stripLang(path) {
      return path.replace(/^\/(en|th)(\/|$)/, '/');
    },

    addLang(path, lang) {
      const clean = this.stripLang(path);
      if (clean === '/' || clean === '') return `/${lang}/`;
      return `/${lang}${clean.startsWith('/') ? clean : '/' + clean}`;
    },

    hasLangPrefix(path) {
      return /^\/(en|th)(\/|$)/.test(path);
    },

    isInternal(href) {
      if (!href) return false;
      try {
        const url = new URL(href, location.origin);
        return url.origin === location.origin;
      } catch(e) {
        return false;
      }
    },

    shouldPrefix(path) {
      if (!path.startsWith('/')) return false;
      return !CONFIG.SKIP_PREFIXES.some(p => path.startsWith(p));
    }
  };

  // Utility: Storage
  const Storage = {
    getLang() {
      try { return localStorage.getItem(CONFIG.STORAGE_KEY); } 
      catch(e) { return null; }
    },

    setLang(lang) {
      try { localStorage.setItem(CONFIG.STORAGE_KEY, lang); } 
      catch(e) {}
    },

    recordNav(path, lang) {
      try {
        const raw = sessionStorage.getItem(CONFIG.NAV_MAP_KEY) || '{}';
        const map = JSON.parse(raw);
        map[path] = { lang, timestamp: Date.now() };
        sessionStorage.setItem(CONFIG.NAV_MAP_KEY, JSON.stringify(map));
      } catch(e) {}
    }
  };

  // Link Processor
  class LinkProcessor {
    constructor(currentLang) {
      this.currentLang = currentLang;
    }

    processLink(anchor) {
      const raw = anchor.getAttribute('href');
      if (!raw) return;

      // Skip special protocols
      if (/^(mailto:|tel:|javascript:|#|data:)/i.test(raw)) return;
      
      // Skip external
      if (!UrlManager.isInternal(raw)) return;

      const url = new URL(raw, location.origin);
      
      // Skip non-prefixable paths
      if (!UrlManager.shouldPrefix(url.pathname)) return;

      // Skip if already has correct prefix
      const existingLang = UrlManager.extractLang(url.pathname);
      if (existingLang === this.currentLang) return;

      // Update href with current language prefix
      const newPath = UrlManager.addLang(url.pathname, this.currentLang);
      url.pathname = newPath;
      
      anchor.setAttribute('href', url.toString());
      
      // Record for back navigation tracking
      Storage.recordNav(url.pathname, this.currentLang);
    }

    processContainer(container) {
      const anchors = container.querySelectorAll('a[href]');
      anchors.forEach(a => this.processLink(a));
    }
  }

  // Navigation Interceptor
  class NavigationInterceptor {
    constructor(currentLang) {
      this.currentLang = currentLang;
      this.isLocalDev = this.checkLocalDev();
    }

    checkLocalDev() {
      const host = location.hostname || '';
      return host === 'localhost' || host === '127.0.0.1' || 
             host === '0.0.0.0' || host.endsWith('.local');
    }

    attach() {
      if (this.isLocalDev) return; // Skip aggressive intercept in dev
      
      document.addEventListener('click', (e) => this.handleClick(e), true);
    }

    handleClick(e) {
      const anchor = e.target.closest('a[href]');
      if (!anchor) return;

      const raw = anchor.getAttribute('href') || '';
      
      // Skip special links
      if (/^(mailto:|tel:|javascript:|#)/i.test(raw)) return;
      if (!UrlManager.isInternal(raw)) return;

      const url = new URL(raw, location.origin);
      
      // Skip assets
      if (!UrlManager.shouldPrefix(url.pathname)) return;

      // If already has prefix, allow default
      if (UrlManager.hasLangPrefix(url.pathname)) {
        // But record the mapping
        Storage.recordNav(url.pathname, UrlManager.extractLang(url.pathname));
        return;
      }

      // Intercept and add language prefix
      e.preventDefault();
      
      const newPath = UrlManager.addLang(url.pathname, this.currentLang);
      url.pathname = newPath;
      
      // Record navigation
      Storage.recordNav(newPath, this.currentLang);
      
      // Navigate
      window.location.assign(url.toString());
    }
  }

  // Main Controller
  class LanguageLinkManager {
    constructor() {
      this.currentLang = Storage.getLang() || 'en';
      this.processor = new LinkProcessor(this.currentLang);
      this.interceptor = new NavigationInterceptor(this.currentLang);
    }

    init() {
      // Process existing links
      this.processor.processContainer(document);
      
      // Setup interceptor
      this.interceptor.attach();
      
      // Watch for new links
      this.setupMutationObserver();
      
      // Listen for language changes
      window.addEventListener('languageChange', (e) => {
        this.handleLanguageChange(e.detail.language);
      });
    }

    setupMutationObserver() {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              this.processor.processContainer(node);
            }
          });
        });
      });
      
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });
    }

    handleLanguageChange(newLang) {
      this.currentLang = newLang;
      this.processor.currentLang = newLang;
      this.interceptor.currentLang = newLang;
      
      // Re-process all links
      this.processor.processContainer(document);
    }
  }

  // Initialize when DOM ready
  function init() {
    const manager = new LanguageLinkManager();
    manager.init();
    window.__linkManager = manager;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
