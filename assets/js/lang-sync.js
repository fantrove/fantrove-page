/* assets/js/lang-sync.js
   URL <-> selectedLang verifier & synchronizer
   - Provides verifyAndSyncUrl() used by lang-proxy, languageManager, and lang-links
   - Uses fv-forcereload / fv-reload-inflight / fv-reload-ack coordination (sessionStorage)
   - Protects local dev hosts and skip prefixes (assets/api/_next/_static)
*/
(function(){
  const SKIP_PREFIXES = ['/assets/', '/static/', '/api/', '/_next/', '/favicon.ico', '/robots.txt', '/sitemap.xml'];
  const LANG_KEY = 'selectedLang';
  const FV_MARKER_KEY = 'fv-forcereload';
  const FV_INFLIGHT_KEY = 'fv-reload-inflight';
  const FV_ACK_KEY = 'fv-reload-ack';
  const SYNC_DONE_PREFIX = 'fv-sync-done:'; // + lang + ':' + pathname

  function isLocalDev() {
    try {
      const host = location.hostname || '';
      if (!host) return false;
      if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return true;
      if (host.endsWith('.local')) return true;
      return false;
    } catch (e) { return false; }
  }

  function shouldPrefix(path) {
    if (!path.startsWith('/')) return false;
    for (const p of SKIP_PREFIXES) if (path.startsWith(p)) return false;
    return true;
  }

  function hasLangPrefix(path) {
    const m = path.match(/^\/(en|th)(\/|$)/);
    return m ? m[1] : null;
  }

  function getDesiredLang() {
    try {
      const ls = localStorage.getItem(LANG_KEY);
      if (ls) return ls;
      // try languageManager prediction if present
      if (window.languageManager && typeof window.languageManager.getPredictedLangForPath === 'function') {
        try {
          const predicted = window.languageManager.getPredictedLangForPath(location.pathname + (location.search||''));
          if (predicted) return predicted;
        } catch(e){}
      }
      return null;
    } catch(e){ return null; }
  }

  function genReloadId() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,9); }
  function setForceReloadMarker(source) {
    try {
      const id = genReloadId();
      const marker = { id: id, ts: Date.now(), source: source || 'lang-sync' };
      sessionStorage.setItem(FV_MARKER_KEY, JSON.stringify(marker));
      return marker;
    } catch(e){ return null; }
  }
  function setInflight(id) { try { if (!id) return; sessionStorage.setItem(FV_INFLIGHT_KEY, id); } catch(e){} }
  function ackReload(id) { try { if (!id) return; sessionStorage.setItem(FV_ACK_KEY, id); sessionStorage.removeItem(FV_INFLIGHT_KEY); sessionStorage.removeItem(FV_MARKER_KEY); } catch(e){} }

  function buildPrefixedCandidatesFor(pathname, selLang) {
    const t = (pathname === '/' || pathname === '') ? '/' : pathname;
    const pref = '/' + selLang;
    const candidates = [];
    if (t === '/' || t === '') {
      candidates.push(pref + '/', pref + '/home/', pref + '/home/index.html', pref + '/index.html');
    } else {
      if (t.endsWith('/')) {
        candidates.push(pref + t, pref + t + 'index.html');
      } else {
        candidates.push(pref + t, pref + t + '/index.html');
      }
      // also try home variants in case site maps there
      candidates.push(pref + '/home/', pref + '/home/index.html');
    }
    // normalize
    return candidates.map(c => (c.startsWith('/') ? c : '/' + c));
  }

  async function headExists(url) {
    try {
      const resp = await fetch(url, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' });
      if (!resp || !resp.ok) return false;
      const ct = resp.headers.get('content-type') || '';
      if (ct && !/text\/html|application\/html|text\/plain/.test(ct)) {
        // reject non-HTML responses conservatively
        return false;
      }
      return true;
    } catch (e) {
      // HEAD may be blocked/unsupported -> return null (caller can fallback to GET)
      return null;
    }
  }

  async function getExists(url) {
    try {
      const resp = await fetch(url, { method: 'GET', cache: 'no-store', credentials: 'same-origin' });
      if (!resp || !resp.ok) return false;
      const ct = resp.headers.get('content-type') || '';
      if (ct && !/text\/html|application\/html|text\/plain/.test(ct)) return false;
      const text = await resp.text();
      return (typeof text === 'string' && text.trim().length > 0);
    } catch(e){ return false; }
  }

  async function findExistingCandidate(candidates) {
    for (const c of candidates) {
      // test HEAD first
      const headOk = await headExists(c);
      if (headOk === true) return c;
      if (headOk === false) continue;
      // headOk === null -> fallback GET
      const getOk = await getExists(c);
      if (getOk) return c;
    }
    return null;
  }

  function markSyncDone(selLang, pathname) {
    try {
      const key = SYNC_DONE_PREFIX + selLang + ':' + pathname;
      sessionStorage.setItem(key, '1');
    } catch(e){}
  }
  function isSyncDone(selLang, pathname) {
    try {
      const key = SYNC_DONE_PREFIX + selLang + ':' + pathname;
      return !!sessionStorage.getItem(key);
    } catch(e){ return false; }
  }

  // main exported function
  async function verifyAndSyncUrl({ force=false, reason=null } = {}) {
    try {
      if (isLocalDev()) return { action: 'noop', reason: 'local-dev' };
      const selLang = getDesiredLang();
      if (!selLang) return { action: 'noop', reason: 'no-selected-lang' };
      const currentPath = location.pathname || '/';
      if (!shouldPrefix(currentPath)) return { action: 'noop', reason: 'no-prefix-needed' };

      const curLang = hasLangPrefix(currentPath);
      if (curLang === selLang) {
        // correct
        try {
          // record mapping for path
          const key = currentPath + (location.search || '');
          const rawMap = sessionStorage.getItem('fv-nav-lang-map') || '{}';
          const map = JSON.parse(rawMap || '{}');
          map[key] = { lang: selLang, ts: Date.now(), evidence: 'verify-correct' };
          sessionStorage.setItem('fv-nav-lang-map', JSON.stringify(map));
        } catch(e){}
        return { action: 'noop', reason: 'already-correct' };
      }

      // avoid repeated work in same session
      if (!force && isSyncDone(selLang, currentPath)) {
        return { action: 'noop', reason: 'already-checked-this-session' };
      }

      // Build candidates and try find existing prefixed page
      const candidates = buildPrefixedCandidatesFor(currentPath, selLang);
      const found = await findExistingCandidate(candidates);
      if (!found) {
        markSyncDone(selLang, currentPath);
        return { action: 'none', reason: 'no-prefixed-candidate-found' };
      }

      // found: perform coordinated replace
      try {
        const marker = setForceReloadMarker(reason || 'lang-sync');
        if (marker && marker.id) setInflight(marker.id);
      } catch(e){}
      try {
        // preserve search/hash
        const urlObj = new URL(found, location.origin);
        urlObj.search = location.search || '';
        urlObj.hash = location.hash || '';
        // record mapping pre-nav
        try {
          const key = urlObj.pathname + (urlObj.search || '');
          const rawMap = sessionStorage.getItem('fv-nav-lang-map') || '{}';
          const map = JSON.parse(rawMap || '{}');
          map[key] = { lang: selLang, ts: Date.now(), evidence: 'verify-redirect' };
          sessionStorage.setItem('fv-nav-lang-map', JSON.stringify(map));
        } catch(e){}
        // replace so no extra history entry
        location.replace(urlObj.toString());
        return { action: 'replaced', chosen: urlObj.toString(), reason: 'redirected-to-prefixed' };
      } catch(e) {
        try { location.href = found; return { action: 'navigated', chosen: found, reason: 'fallback-navigate' }; } catch(e2){}
      }
      return { action: 'none', reason: 'unexpected' };
    } catch (err) {
      return { action: 'noop', reason: 'error:' + (err && err.message) };
    }
  }

  // Expose
  window.langSync = {
    isLocalDev,
    getDesiredLang,
    shouldPrefix,
    verifyAndSyncUrl,
    buildPrefixedCandidatesFor,
    headExists,
    // helper for tests
    _internal: { SKIP_PREFIXES }
  };

  // Auto-run light check on load (non-blocking)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { setTimeout(()=>{ window.langSync.verifyAndSyncUrl().catch(()=>{}); }, 10); });
  } else {
    setTimeout(()=>{ window.langSync.verifyAndSyncUrl().catch(()=>{}); }, 10);
  }

  // also listen to visibility/focus and languageChange events to rerun
  window.addEventListener('focus', () => { window.langSync.verifyAndSyncUrl().catch(()=>{}); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') window.langSync.verifyAndSyncUrl().catch(()=>{}); });
  window.addEventListener('languageChange', (e) => { window.langSync.verifyAndSyncUrl({ force: true, reason: 'languageChange' }).catch(()=>{}); });

})();