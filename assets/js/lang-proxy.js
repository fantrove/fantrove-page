/**
 * Language Proxy v3.0 - URL Guardian & Navigation Context Detector
 * ทำหน้าที่: 
 * 1. ตรวจจับทุกการเข้าหน้าและบันทึก navigation context
 * 2. บังคับใช้ URL prefix ในทุกกรณี
 * 3. จัดการกรณีผู้ใช้พิมพ์/แก้ไข URL เอง
 * 4. ประสานงานกับระบบเมื่อมีการย้อนกลับ
 */

(function() {
  'use strict';
  
  // Constants
  const LANGS = ['en', 'th'];
  const STORAGE_KEYS = {
    LANG: 'selectedLang',
    NAV_CONTEXT: 'fv-nav-context',
    LAST_LANG: 'fv-last-lang',
    BACK_INTENT: 'fv-back-intent',
    RELOAD_MARKER: 'fv-reload-marker',
    NAV_HISTORY: 'fv-nav-history'
  };
  
  // Navigation Context Types
  const NAV_TYPE = {
    DIRECT: 'direct',           // เข้ามาจาก URL โดยตรง/พิมพ์เอง
    BACK_FORWARD: 'back_forward', // ย้อนกลับ/ไปข้างหน้า
    REFRESH: 'refresh',         // รีเฟรชหน้า
    PROGRAMMATIC: 'programmatic', // เปลี่ยนผ่าน JS
    PROXY_REDIRECT: 'proxy_redirect' // ถูก redirect โดย proxy
  };

  // Utility: Detect if local development
  function isLocalDev() {
    try {
      const host = location.hostname || '';
      return host === 'localhost' || host === '127.0.0.1' || 
             host === '0.0.0.0' || host.endsWith('.local');
    } catch (e) { return false; }
  }

  // Utility: Get current timestamp
  function now() { return Date.now(); }

  // Utility: Generate unique ID
  function uuid() {
    return now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
  }

  // Utility: Safe storage operations
  const storage = {
    get(key) {
      try { return sessionStorage.getItem(key); } catch(e) { return null; }
    },
    set(key, value) {
      try { sessionStorage.setItem(key, value); } catch(e) {}
    },
    remove(key) {
      try { sessionStorage.removeItem(key); } catch(e) {}
    },
    getLocal(key) {
      try { return localStorage.getItem(key); } catch(e) { return null; }
    },
    setLocal(key, value) {
      try { localStorage.setItem(key, value); } catch(e) {}
    }
  };

  // ==========================================
  // Navigation Context Detection System
  // ==========================================
  
  class NavigationContext {
    constructor() {
      this.type = this.detectType();
      this.timestamp = now();
      this.fromUrl = document.referrer || '';
      this.currentUrl = location.href;
      this.currentPath = location.pathname;
    }

    detectType() {
      // Check for reload marker from previous session
      const reloadMarker = storage.get(STORAGE_KEYS.RELOAD_MARKER);
      if (reloadMarker) {
        storage.remove(STORAGE_KEYS.RELOAD_MARKER);
        return NAV_TYPE.PROGRAMMATIC;
      }

      // Check for back intent from back-button.js
      const backIntent = storage.get(STORAGE_KEYS.BACK_INTENT);
      if (backIntent) {
        storage.remove(STORAGE_KEYS.BACK_INTENT);
        return NAV_TYPE.BACK_FORWARD;
      }

      // Check navigation type from performance API
      if (window.performance && performance.navigation) {
        const navType = performance.navigation.type;
        if (navType === 1) return NAV_TYPE.REFRESH;
        if (navType === 2) return NAV_TYPE.BACK_FORWARD;
      }

      // Check from PerformanceEntry (modern browsers)
      if (window.performance && performance.getEntriesByType) {
        const entries = performance.getEntriesByType('navigation');
        if (entries.length > 0) {
          const entry = entries[0];
          if (entry.type === 'reload') return NAV_TYPE.REFRESH;
          if (entry.type === 'back_forward') return NAV_TYPE.BACK_FORWARD;
        }
      }

      // Check if same origin referrer exists
      if (document.referrer) {
        try {
          const refUrl = new URL(document.referrer);
          if (refUrl.origin === location.origin) {
            return NAV_TYPE.PROGRAMMATIC;
          }
        } catch(e) {}
      }

      return NAV_TYPE.DIRECT;
    }

    isBackNavigation() {
      return this.type === NAV_TYPE.BACK_FORWARD;
    }

    isDirectAccess() {
      return this.type === NAV_TYPE.DIRECT;
    }
  }

  // ==========================================
  // URL Parser & Language Extractor
  // ==========================================
  
  class UrlManager {
    static extractLangFromPath(path) {
      const match = path.match(/^\/(en|th)(\/|$)/);
      return match ? match[1] : null;
    }

    static stripLangPrefix(path) {
      return path.replace(/^\/(en|th)(\/|$)/, '/');
    }

    static addLangPrefix(path, lang) {
      if (!lang || !LANGS.includes(lang)) lang = 'en';
      
      // Remove existing prefix first
      const cleanPath = this.stripLangPrefix(path);
      
      // Add new prefix
      if (cleanPath === '/' || cleanPath === '') {
        return `/${lang}/`;
      }
      return `/${lang}${cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath}`;
    }

    static hasLangPrefix(path) {
      return /^\/(en|th)(\/|$)/.test(path);
    }

    static normalizePath(path) {
      // Remove trailing index.html for comparison
      return path.replace(/\/index\.html$/, '/').replace(/\/$/, '') || '/';
    }
  }

  // ==========================================
  // Language Authority Resolver
  // ==========================================
  
  class LanguageAuthority {
    constructor(navContext) {
      this.context = navContext;
      this.resolvedLang = null;
      this.authoritySource = null;
    }

    /**
     * Resolve language based on navigation context priority:
     * 1. Back navigation: Use stored language (highest priority)
     * 2. Direct access with URL prefix: Use URL prefix
     * 3. Direct access without prefix: Use localStorage or detect
     * 4. Always sync URL to match resolved language
     */
    resolve() {
      // Priority 1: Back navigation - use stored language
      if (this.context.isBackNavigation()) {
        const storedLang = storage.getLocal(STORAGE_KEYS.LANG);
        if (storedLang && LANGS.includes(storedLang)) {
          this.resolvedLang = storedLang;
          this.authoritySource = 'back_navigation_storage';
          return this.resolvedLang;
        }
      }

      // Priority 2: URL prefix (for direct access or programmatic)
      const urlLang = UrlManager.extractLangFromPath(location.pathname);
      if (urlLang && LANGS.includes(urlLang)) {
        this.resolvedLang = urlLang;
        this.authoritySource = 'url_prefix';
        
        // Sync to localStorage
        storage.setLocal(STORAGE_KEYS.LANG, urlLang);
        return this.resolvedLang;
      }

      // Priority 3: localStorage (returning user)
      const storedLang = storage.getLocal(STORAGE_KEYS.LANG);
      if (storedLang && LANGS.includes(storedLang)) {
        this.resolvedLang = storedLang;
        this.authoritySource = 'local_storage';
        return this.resolvedLang;
      }

      // Priority 4: Browser detection
      const browserLang = this.detectBrowserLanguage();
      this.resolvedLang = browserLang;
      this.authoritySource = 'browser_detect';
      storage.setLocal(STORAGE_KEYS.LANG, browserLang);
      
      return this.resolvedLang;
    }

    detectBrowserLanguage() {
      try {
        const langs = navigator.languages || [navigator.language || 'en'];
        for (const lang of langs) {
          const code = lang.split('-')[0].toLowerCase();
          if (LANGS.includes(code)) return code;
        }
      } catch(e) {}
      return 'en';
    }

    getAuthoritySource() {
      return this.authoritySource;
    }
  }

  // ==========================================
  // URL Enforcement Engine
  // ==========================================
  
  class UrlEnforcer {
    constructor(targetLang) {
      this.targetLang = targetLang;
      this.currentPath = location.pathname;
      this.currentSearch = location.search;
      this.currentHash = location.hash;
    }

    /**
     * Check if current URL matches target language
     */
    needsCorrection() {
      const currentLang = UrlManager.extractLangFromPath(this.currentPath);
      return currentLang !== this.targetLang;
    }

    /**
     * Calculate correct URL for target language
     */
    getCorrectUrl() {
      const newPath = UrlManager.addLangPrefix(this.currentPath, this.targetLang);
      return newPath + this.currentSearch + this.currentHash;
    }

    /**
     * Execute URL correction without adding history entry
     */
    enforce() {
      if (!this.needsCorrection()) return false;
      
      const correctUrl = this.getCorrectUrl();
      
      // Set marker to prevent loops
      storage.set(STORAGE_KEYS.RELOAD_MARKER, JSON.stringify({
        id: uuid(),
        timestamp: now(),
        from: location.href,
        to: correctUrl
      }));

      // Use replaceState first to update URL without history entry
      try {
        history.replaceState({
          lang: this.targetLang,
          timestamp: now(),
          source: 'proxy_enforce'
        }, '', correctUrl);
      } catch(e) {}

      // If path actually changed (not just state), reload to ensure correct content
      if (correctUrl !== location.pathname + location.search + location.hash) {
        // For local dev, just update URL without reload to avoid loops
        if (isLocalDev()) {
          console.log('[LangProxy] Would redirect to:', correctUrl);
          return true;
        }
        
        location.replace(correctUrl);
        return true;
      }

      return false;
    }
  }

  // ==========================================
  // Manual URL Change Detector
  // สำหรับตรวจจับเมื่อผู้ใช้พิมพ์/แก้ไข URL เอง
  // ==========================================
  
  class ManualChangeDetector {
    constructor() {
      this.lastUrl = location.href;
      this.checkInterval = null;
    }

    start() {
      // Check on popstate (back/forward buttons)
      window.addEventListener('popstate', (e) => {
        this.handleUrlChange('popstate', e);
      });

      // Periodic check for manual URL bar edits (some browsers)
      this.checkInterval = setInterval(() => {
        if (location.href !== this.lastUrl) {
          this.handleUrlChange('manual_edit');
        }
      }, 100);
    }

    handleUrlChange(source, event) {
      const newUrl = location.href;
      const newLang = UrlManager.extractLangFromPath(location.pathname);
      const oldLang = UrlManager.extractLangFromPath(new URL(this.lastUrl).pathname);

      this.lastUrl = newUrl;

      // If language prefix changed, update system
      if (newLang && newLang !== oldLang) {
        // Update localStorage
        storage.setLocal(STORAGE_KEYS.LANG, newLang);
        
        // Notify language manager
        window.dispatchEvent(new CustomEvent('lang:manualUrlChange', {
          detail: { 
            oldLang, 
            newLang, 
            source,
            path: location.pathname 
          }
        }));

        // Force reload to ensure content matches
        if (!isLocalDev()) {
          storage.set(STORAGE_KEYS.RELOAD_MARKER, JSON.stringify({
            id: uuid(),
            timestamp: now(),
            reason: 'manual_lang_change'
          }));
          location.reload();
        }
      }
    }

    stop() {
      if (this.checkInterval) {
        clearInterval(this.checkInterval);
      }
    }
  }

  // ==========================================
  // Main Execution
  // ==========================================
  
  function main() {
    // Skip if already processed
    if (window.__langProxyExecuted) return;
    window.__langProxyExecuted = true;

    // Detect navigation context
    const navContext = new NavigationContext();
    
    // Resolve language authority
    const authority = new LanguageAuthority(navContext);
    const targetLang = authority.resolve();
    
    // Log for debugging
    console.log('[LangProxy] Context:', navContext.type, '| Authority:', authority.getAuthoritySource(), '| Lang:', targetLang);

    // Enforce URL has correct prefix
    const enforcer = new UrlEnforcer(targetLang);
    const redirected = enforcer.enforce();

    // If not redirected, start manual change detector
    if (!redirected) {
      const detector = new ManualChangeDetector();
      detector.start();
      
      // Store nav context for other scripts
      storage.set(STORAGE_KEYS.NAV_CONTEXT, JSON.stringify({
        type: navContext.type,
        timestamp: navContext.timestamp,
        authority: authority.getAuthoritySource(),
        lang: targetLang
      }));
    }

    // Expose utilities globally
    window.__langUtils = {
      UrlManager,
      storage,
      LANGS,
      NAV_TYPE
    };
  }

  // Execute immediately
  main();
})();
