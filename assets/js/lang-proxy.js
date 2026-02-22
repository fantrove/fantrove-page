/* assets/js/lang-proxy.js
   Smart URL Sync System - Phase 1: Initial URL Validation
   ทำงานเป็นอันดับแรกสุดใน <head> เพื่อตรวจสอบ URL ก่อนโหลดเนื้อหา
   
   หลักการ:
   - ถ้า URL ไม่มี prefix แต่มี selectedLang → redirect ไป prefixed URL
   - ถ้า URL มี prefix แต่ไม่ตรงกับ selectedLang → redirect ไป prefix ที่ถูกต้อง
   - ถ้า URL มี prefix ตรงกับ selectedLang → ปล่อยผ่าน (proxy เนื้อหา)
   - ถ้าไม่มี selectedLang → detect จาก URL/browser และ set ค่า
*/

(function() {
  'use strict';
  
  const DEBUG = false;
  const log = DEBUG ? console.log.bind(console, '[LangProxy]') : () => {};
  
  // Coordination keys
  const COORD = {
    MARKER: 'fv-sync-marker',
    INFLIGHT: 'fv-sync-inflight',
    ACK: 'fv-sync-ack',
    LAST_CHECK: 'fv-last-url-check'
  };
  
  const LANGS = ['en', 'th'];
  
  // Utility: Check if running on local dev
  function isLocalDev() {
    try {
      const host = location.hostname || '';
      return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host.endsWith('.local');
    } catch (e) { return false; }
  }
  
  // Utility: Generate unique ID
  function genId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }
  
  // Utility: Parse URL path
  function parsePath(path) {
    const match = path.match(/^\/(en|th)(\/.*|$)/);
    if (match) {
      return { hasPrefix: true, lang: match[1], rest: match[2] || '/' };
    }
    return { hasPrefix: false, lang: null, rest: path };
  }
  
  // Utility: Get stored language
  function getStoredLang() {
    try { return localStorage.getItem('selectedLang'); } catch (e) { return null; }
  }
  
  // Utility: Set stored language
  function setStoredLang(lang) {
    try { localStorage.setItem('selectedLang', lang); } catch (e) {}
  }
  
  // Utility: Detect from browser
  function detectBrowserLang() {
    try {
      const langs = navigator.languages || [navigator.language || 'en'];
      const first = langs[0].split('-')[0];
      return LANGS.includes(first) ? first : 'en';
    } catch (e) { return 'en'; }
  }
  
  // Coordination: Check if we should proceed or wait
  function checkCoordination() {
    try {
      const markerRaw = sessionStorage.getItem(COORD.MARKER);
      const inflight = sessionStorage.getItem(COORD.INFLIGHT);
      const ack = sessionStorage.getItem(COORD.ACK);
      
      if (!markerRaw) return { shouldProceed: true, isCoordinator: true, marker: null };
      
      const marker = JSON.parse(markerRaw);
      
      // If we already acknowledged this marker, ignore
      if (ack === marker.id) {
        log('Already acknowledged marker', marker.id);
        return { shouldProceed: false, isCoordinator: false, marker };
      }
      
      // If there's an inflight marker that's recent (< 5s), wait
      if (inflight === marker.id && (Date.now() - marker.ts < 5000)) {
        log('Sync in progress, waiting...');
        return { shouldProceed: false, isCoordinator: false, marker };
      }
      
      // Otherwise, we become the coordinator
      return { shouldProceed: true, isCoordinator: true, marker };
    } catch (e) {
      return { shouldProceed: true, isCoordinator: true, marker: null };
    }
  }
  
  // Coordination: Set marker
  function setMarker(source) {
    try {
      const marker = { id: genId(), ts: Date.now(), source: source || 'proxy' };
      sessionStorage.setItem(COORD.MARKER, JSON.stringify(marker));
      sessionStorage.setItem(COORD.INFLIGHT, marker.id);
      return marker;
    } catch (e) { return { id: genId(), ts: Date.now() }; }
  }
  
  // Coordination: Acknowledge completion
  function ackMarker(id) {
    try {
      sessionStorage.setItem(COORD.ACK, id);
      sessionStorage.removeItem(COORD.INFLIGHT);
      // Clear marker after a delay to allow other tabs to see it
      setTimeout(() => {
        try {
          const current = sessionStorage.getItem(COORD.MARKER);
          if (current) {
            const parsed = JSON.parse(current);
            if (parsed.id === id) {
              sessionStorage.removeItem(COORD.MARKER);
            }
          }
        } catch (e) {}
      }, 1000);
    } catch (e) {}
  }
  
  // Core: Determine correct URL based on stored language
  function getCorrectUrl() {
    const current = parsePath(location.pathname);
    const storedLang = getStoredLang();
    
    // Case 1: No stored lang - detect and set
    if (!storedLang) {
      const detected = detectBrowserLang();
      setStoredLang(detected);
      
      if (current.hasPrefix) {
        // URL has prefix, check if it matches detected
        if (current.lang === detected) {
          return { action: 'proxy', lang: detected, target: location.pathname };
        } else {
          return { action: 'redirect', lang: detected, target: '/' + detected + current.rest };
        }
      } else {
        // No prefix, add detected
        return { action: 'redirect', lang: detected, target: '/' + detected + location.pathname };
      }
    }
    
    // Case 2: Has stored lang
    if (current.hasPrefix) {
      if (current.lang === storedLang) {
        // Correct prefix - just proxy content
        return { action: 'proxy', lang: storedLang, target: location.pathname };
      } else {
        // Wrong prefix - redirect to correct one
        return { action: 'redirect', lang: storedLang, target: '/' + storedLang + current.rest };
      }
    } else {
      // No prefix but has stored lang - must redirect
      return { action: 'redirect', lang: storedLang, target: '/' + storedLang + location.pathname };
    }
  }
  
  // Core: Fetch and proxy content for prefixed URL
  async function proxyContent(lang, targetPath) {
    log('Proxying content for', lang, targetPath);
    
    // Mark that we've proxied for this lang in this session
    sessionStorage.setItem('fv-proxied-lang', lang);
    
    // Build candidates to fetch
    const candidates = [];
    if (targetPath === '/' || targetPath === `/${lang}/` || targetPath === `/${lang}`) {
      candidates.push(`/${lang}/index.html`, `/${lang}/home/index.html`, '/index.html', '/home/index.html');
    } else {
      const base = targetPath.replace(new RegExp(`^/${lang}`), '') || '/';
      candidates.push(
        `/${lang}${base}`,
        `/${lang}${base}${base.endsWith('/') ? 'index.html' : '/index.html'}`,
        base,
        base + (base.endsWith('/') ? 'index.html' : '/index.html')
      );
    }
    
    // Try fetch
    for (const url of candidates) {
      try {
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) continue;
        
        const html = await resp.text();
        
        // Write content
        document.open();
        document.write(html);
        document.close();
        
        // Update URL to show prefixed version
        try {
          history.replaceState({ lang: lang, proxied: true }, '', `/${lang}${targetPath.replace(new RegExp(`^/${lang}`), '') || '/'}`);
        } catch (e) {}
        
        // Set marker for coordination
        const marker = setMarker('proxy-success');
        
        // Trigger reload to get clean state with correct URL
        setTimeout(() => {
          ackMarker(marker.id);
          location.replace(location.href);
        }, 50);
        
        return true;
      } catch (e) {
        continue;
      }
    }
    
    return false;
  }
  
  // Core: Redirect to correct URL
  function performRedirect(targetUrl, marker) {
    log('Redirecting to', targetUrl);
    
    try {
      // Preserve query and hash
      const url = new URL(targetUrl, location.origin);
      url.search = location.search;
      url.hash = location.hash;
      
      // Set inflight before navigation
      if (marker) sessionStorage.setItem(COORD.INFLIGHT, marker.id);
      
      // Use replace to avoid history pollution
      location.replace(url.toString());
    } catch (e) {
      location.replace(targetUrl);
    }
  }
  
  // Main execution
  function main() {
    try {
      // Skip on local dev (optional, can be removed)
      // if (isLocalDev()) { log('Local dev mode, skipping'); return; }
      
      // Check coordination
      const coord = checkCoordination();
      if (!coord.shouldProceed) {
        log('Waiting for coordination');
        return;
      }
      
      // Determine what to do
      const decision = getCorrectUrl();
      log('Decision:', decision);
      
      if (decision.action === 'redirect') {
        const marker = setMarker('redirect');
        performRedirect(decision.target, marker);
        return;
      }
      
      if (decision.action === 'proxy') {
        // Check if we already proxied this session to avoid loops
        const proxied = sessionStorage.getItem('fv-proxied-lang');
        if (proxied === decision.lang) {
          log('Already proxied this session, continuing normally');
          ackMarker(coord.marker?.id || genId());
          return;
        }
        
        // Proxy content
        proxyContent(decision.lang, location.pathname).then(success => {
          if (!success) {
            log('Proxy failed, falling back to redirect');
            const marker = setMarker('proxy-fallback');
            performRedirect(`/${decision.lang}/`, marker);
          }
        });
      }
    } catch (err) {
      console.error('[LangProxy] Error:', err);
    }
  }
  
  // Run immediately
  main();
})();
