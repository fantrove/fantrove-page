/* assets/js/lang-sync.js
   Smart URL Sync System - Phase 2: Continuous Monitoring
   ทำงานหลังจาก DOM พร้อมใช้งาน เพื่อตรวจสอบและซิงค์ URL ตลอดเวลา
   
   หน้าที่:
   1. ตรวจสอบ URL ทุกครั้งที่โหลดหน้าใหม่
   2. ตรวจสอบเมื่อมีการเปลี่ยนแปลงภาษา (จาก tab อื่น, storage event)
   3. ตรวจสอบเมื่อผู้ใช้กด back/forward (popstate)
   4. อัพเดท links ทั้งหมดให้ตรงกับภาษาปัจจุบัน
   5. ตรวจจับการเปลี่ยนแปลงภาษาที่ไม่ได้มาจากการคลิกปุ่มภาษา
*/

(function() {
  'use strict';
  
  const DEBUG = false;
  const log = DEBUG ? console.log.bind(console, '[LangSync]') : () => {};
  
  const CONFIG = {
    CHECK_INTERVAL: 1000,        // ตรวจสอบทุก 1 วินาที (สำหรับกรณีพิเศษ)
    SYNC_DEBOUNCE: 100,          // ดีเลย์การซิงค์เล็กน้อย
    COORD_TIMEOUT: 5000          // Timeout สำหรับ coordination
  };
  
  const COORD = {
    MARKER: 'fv-sync-marker',
    INFLIGHT: 'fv-sync-inflight',
    ACK: 'fv-sync-ack'
  };
  
  const LANGS = ['en', 'th'];
  
  // State
  let currentLang = null;
  let isSyncing = false;
  let checkInterval = null;
  
  // Utility: Get stored lang
  function getStoredLang() {
    try { return localStorage.getItem('selectedLang'); } catch (e) { return null; }
  }
  
  // Utility: Parse current URL
  function parseUrl() {
    const path = location.pathname;
    const match = path.match(/^\/(en|th)(\/|$)/);
    return {
      hasPrefix: !!match,
      lang: match ? match[1] : null,
      path: path,
      rest: match ? path.replace(new RegExp(`^/${match[1]}`), '') || '/' : path
    };
  }
  
  // Utility: Build correct URL
  function buildCorrectUrl(lang, keepCurrentPath = true) {
    const current = parseUrl();
    let targetPath;
    
    if (keepCurrentPath) {
      // Use current path but ensure correct prefix
      targetPath = current.rest || '/';
    } else {
      targetPath = '/';
    }
    
    const url = new URL(location.href);
    url.pathname = `/${lang}${targetPath === '/' ? '/' : targetPath}`;
    return url.toString();
  }
  
  // Coordination: Check if sync needed
  function shouldSync() {
    try {
      const markerRaw = sessionStorage.getItem(COORD.MARKER);
      const inflight = sessionStorage.getItem(COORD.INFLIGHT);
      const ack = sessionStorage.getItem(COORD.ACK);
      
      if (!markerRaw) return true;
      
      const marker = JSON.parse(markerRaw);
      
      // If acknowledged, clear and proceed
      if (ack === marker.id) {
        sessionStorage.removeItem(COORD.ACK);
        sessionStorage.removeItem(COORD.MARKER);
        sessionStorage.removeItem(COORD.INFLIGHT);
        return true;
      }
      
      // If inflight and recent, wait
      if (inflight === marker.id && (Date.now() - marker.ts < CONFIG.COORD_TIMEOUT)) {
        return false;
      }
      
      // Timeout or stale, clear and proceed
      sessionStorage.removeItem(COORD.MARKER);
      sessionStorage.removeItem(COORD.INFLIGHT);
      return true;
    } catch (e) { return true; }
  }
  
  // Coordination: Set sync marker
  function setSyncMarker(source) {
    try {
      const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
      const marker = { id, ts: Date.now(), source };
      sessionStorage.setItem(COORD.MARKER, JSON.stringify(marker));
      sessionStorage.setItem(COORD.INFLIGHT, id);
      return marker;
    } catch (e) { return null; }
  }
  
  // Coordination: Acknowledge
  function ackSync(id) {
    try {
      sessionStorage.setItem(COORD.ACK, id);
      setTimeout(() => {
        sessionStorage.removeItem(COORD.MARKER);
        sessionStorage.removeItem(COORD.INFLIGHT);
        sessionStorage.removeItem(COORD.ACK);
      }, 500);
    } catch (e) {}
  }
  
  // Core: Perform URL sync
  function performSync(source) {
    if (isSyncing) {
      log('Sync already in progress');
      return;
    }
    
    if (!shouldSync()) {
      log('Waiting for coordination');
      return;
    }
    
    const storedLang = getStoredLang();
    const current = parseUrl();
    
    log('Checking sync:', { stored: storedLang, current: current.lang, source });
    
    // No stored lang, set from URL or default
    if (!storedLang) {
      if (current.lang && LANGS.includes(current.lang)) {
        try {
          localStorage.setItem('selectedLang', current.lang);
          currentLang = current.lang;
          updateAllLinks(current.lang);
        } catch (e) {}
      }
      return;
    }
    
    currentLang = storedLang;
    
    // Check if URL matches stored lang
    if (current.lang === storedLang) {
      log('URL already correct');
      updateAllLinks(storedLang);
      return;
    }
    
    // Need to sync URL
    isSyncing = true;
    const marker = setSyncMarker(source);
    const targetUrl = buildCorrectUrl(storedLang);
    
    log('Syncing URL to', targetUrl);
    
    // Small delay to allow other scripts to prepare
    setTimeout(() => {
      try {
        location.replace(targetUrl);
      } catch (e) {
        location.href = targetUrl;
      }
    }, CONFIG.SYNC_DEBOUNCE);
  }
  
  // Update all internal links to match current language
  function updateAllLinks(lang) {
    const links = document.querySelectorAll('a[href]');
    const skipPatterns = [
      /^\/(en|th)\//,  // Already prefixed
      /^\/(assets|static|api|_next)\//,
      /^\/(favicon|robots|sitemap)/,
      /^(mailto|tel|javascript|#|http|\/\/)/i
    ];
    
    links.forEach(link => {
      const href = link.getAttribute('href');
      if (!href) return;
      
      // Skip if matches any pattern
      if (skipPatterns.some(p => p.test(href))) return;
      
      // Skip external links
      if (href.includes('://') && !href.includes(location.host)) return;
      
      // Add prefix
      try {
        const url = new URL(href, location.origin);
        if (url.origin !== location.origin) return;
        
        // Check if already has lang prefix
        if (skipPatterns[0].test(url.pathname)) return;
        
        url.pathname = `/${lang}${url.pathname}`;
        link.setAttribute('href', url.toString());
        link.setAttribute('data-lang-prefixed', 'true');
      } catch (e) {}
    });
    
    log('Updated links for lang:', lang);
  }
  
  // Event: Language change from LanguageManager
  function onLanguageChange(newLang) {
    log('Language change detected:', newLang);
    currentLang = newLang;
    
    // Update links immediately
    updateAllLinks(newLang);
    
    // Sync URL without full page reload if possible
    const current = parseUrl();
    if (current.lang !== newLang) {
      const newUrl = buildCorrectUrl(newLang);
      try {
        history.replaceState({ lang: newLang }, '', newUrl);
        // Trigger storage event for other tabs
        localStorage.setItem('selectedLang', newLang);
      } catch (e) {
        // Fallback to reload if replaceState fails
        performSync('language-change');
      }
    }
  }
  
  // Event: Storage change (from other tab)
  function onStorageChange(e) {
    if (e.key === 'selectedLang') {
      const newLang = e.newValue;
      if (newLang && newLang !== currentLang) {
        log('Storage change detected:', newLang);
        onLanguageChange(newLang);
        performSync('storage-change');
      }
    }
  }
  
  // Event: Popstate (back/forward)
  function onPopState(e) {
    log('Popstate detected', e.state);
    // Check if URL matches current stored lang
    setTimeout(() => performSync('popstate'), 0);
  }
  
  // Event: Visibility change (tab becomes active)
  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      log('Tab became visible, checking sync');
      performSync('visibility');
    }
  }
  
  // Periodic check (safety net)
  function startPeriodicCheck() {
    if (checkInterval) clearInterval(checkInterval);
    checkInterval = setInterval(() => {
      const stored = getStoredLang();
      const current = parseUrl();
      if (stored && current.lang !== stored) {
        log('Periodic check found mismatch');
        performSync('periodic');
      }
    }, CONFIG.CHECK_INTERVAL);
  }
  
  // Initialize
  function init() {
    log('Initializing LangSync');
    
    // Set initial currentLang
    currentLang = getStoredLang() || parseUrl().lang || 'en';
    
    // Initial sync check
    performSync('init');
    
    // Event listeners
    window.addEventListener('storage', onStorageChange);
    window.addEventListener('popstate', onPopState);
    document.addEventListener('visibilitychange', onVisibilityChange);
    
    // Listen for language change events from LanguageManager
    window.addEventListener('languageChange', (e) => {
      if (e.detail && e.detail.language) {
        onLanguageChange(e.detail.language);
      }
    });
    
    // Start periodic check
    startPeriodicCheck();
    
    // Expose API for other scripts
    window.LangSync = {
      sync: () => performSync('manual'),
      getCurrentLang: () => currentLang,
      updateLinks: (lang) => updateAllLinks(lang || currentLang),
      onLanguageChange: onLanguageChange
    };
  }
  
  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
