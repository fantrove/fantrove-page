/* assets/js/lang-sync.js
   URL <-> selectedLang verifier & synchronizer (safe mode)
   - Throttles and rate-limits redirects to avoid loops
   - Respects recent user interaction (won't auto-redirect while user interacts)
   - Allows "userInitiated" override from UI so language picks can navigate immediately
   - Uses sessionStorage markers for coordination (fv-forcereload / fv-reload-inflight / fv-reload-ack)
*/
(function(){
  const SKIP_PREFIXES = ['/assets/', '/static/', '/api/', '/_next/', '/favicon.ico', '/robots.txt', '/sitemap.xml'];
  const LANG_KEY = 'selectedLang';
  const FV_MARKER_KEY = 'fv-forcereload';
  const FV_INFLIGHT_KEY = 'fv-reload-inflight';
  const SYNC_DONE_PREFIX = 'fv-sync-done:'; // + lang + ':' + pathname

  // Safety controls
  const REDIRECT_LIMIT_PER_SESSION = 3; // max automatic redirects per session
  const REDIRECT_COOLDOWN_MS = 60 * 1000; // cooldown between redirects
  const USER_INTERACTION_WINDOW_MS = 5000; // if user interacted within 5s, skip auto-redirect
  const SYNC_THROTTLE_MS = 500; // debounce verifyAndSyncUrl calls

  // session keys for counters
  const REDIRECT_COUNT_KEY = 'fv-sync-redirect-count';
  const LAST_REDIRECT_TS_KEY = 'fv-sync-last-redirect-ts';
  const USER_INTERACT_TS_KEY = 'fv-sync-user-interaction-ts';

  // helper: environment
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
  function inflightExists() { try { return !!sessionStorage.getItem(FV_INFLIGHT_KEY); } catch(e){ return false; } }

  // counters
  function getRedirectCount() {
    try { return Number(sessionStorage.getItem(REDIRECT_COUNT_KEY) || 0); } catch(e){ return 0; }
  }
  function incRedirectCount() {
    try {
      const v = getRedirectCount() + 1;
      sessionStorage.setItem(REDIRECT_COUNT_KEY, String(v));
      sessionStorage.setItem(LAST_REDIRECT_TS_KEY, String(Date.now()));
      return v;
    } catch(e){ return null; }
  }
  function lastRedirectTs() {
    try { return Number(sessionStorage.getItem(LAST_REDIRECT_TS_KEY) || 0); } catch(e){ return 0; }
  }
  function recordUserInteraction() {
    try { sessionStorage.setItem(USER_INTERACT_TS_KEY, String(Date.now())); } catch(e){}
  }
  function lastUserInteractionTs() {
    try { return Number(sessionStorage.getItem(USER_INTERACT_TS_KEY) || 0); } catch(e){ return 0; }
  }

  // Track user interaction (global) - used to avoid redirecting while user interacts
  ['click','keydown','touchstart','pointerdown'].forEach(evt => {
    window.addEventListener(evt, () => {
      try { recordUserInteraction(); } catch(e){}
    }, { passive: true, capture: false });
  });

  // candidate building (same heuristic as before)
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
      candidates.push(pref + '/home/', pref + '/home/index.html');
    }
    return candidates.map(c => (c.startsWith('/') ? c : '/' + c));
  }

  async function headExists(url) {
    try {
      const resp = await fetch(url, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' });
      if (!resp || !resp.ok) return false;
      const ct = resp.headers.get('content-type') || '';
      if (ct && !/text\/html|application\/html|text\/plain/.test(ct)) return false;
      return true;
    } catch (e) {
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
      const headOk = await headExists(c);
      if (headOk === true) return c;
      if (headOk === false) continue;
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

  // Throttle / debounce wrapper
  let lastVerifyAt = 0;
  function throttleVerify(fn) {
    return function(opts) {
      const now = Date.now();
      if (now - lastVerifyAt < SYNC_THROTTLE_MS && !opts?.force) return Promise.resolve({ action: 'noop', reason: 'throttled' });
      lastVerifyAt = now;
      return fn(opts);
    };
  }

  // Main API: options = { force=false, reason=null, allowRedirect=true, userInitiated=false }
  const verifyAndSyncUrlImpl = async function({ force=false, reason=null, allowRedirect=true, userInitiated=false } = {}) {
    try {
      if (isLocalDev()) return { action: 'noop', reason: 'local-dev' };
      const selLang = getDesiredLang();
      if (!selLang) return { action: 'noop', reason: 'no-selected-lang' };
      const currentPath = location.pathname || '/';
      if (!shouldPrefix(currentPath)) return { action: 'noop', reason: 'no-prefix-needed' };

      const curLang = hasLangPrefix(currentPath);
      if (curLang === selLang) {
        // correct -> record mapping and return
        try {
          const key = currentPath + (location.search || '');
          const rawMap = sessionStorage.getItem('fv-nav-lang-map') || '{}';
          const map = JSON.parse(rawMap || '{}');
          map[key] = { lang: selLang, ts: Date.now(), evidence: 'verify-correct' };
          sessionStorage.setItem('fv-nav-lang-map', JSON.stringify(map));
        } catch(e){}
        return { action: 'noop', reason: 'already-correct' };
      }

      // If allowRedirect is false, mark done and return
      if (!allowRedirect && !force) {
        markSyncDone(selLang, currentPath);
        return { action: 'none', reason: 'redirect-disabled-by-caller' };
      }

      // If user did interact recently and this is not userInitiated -> skip to avoid breaking UX
      if (!userInitiated) {
        const lastInteract = lastUserInteractionTs();
        if (Date.now() - lastInteract < USER_INTERACTION_WINDOW_MS) {
          return { action: 'noop', reason: 'user-interacted-recently' };
        }
      }

      // Rate limit: don't redirect too often in session
      const redirectsSoFar = getRedirectCount();
      const lastTs = lastRedirectTs();
      if (!force && redirectsSoFar >= REDIRECT_LIMIT_PER_SESSION) {
        return { action: 'noop', reason: 'redirect-limit-reached' };
      }
      if (!force && lastTs && (Date.now() - lastTs) < REDIRECT_COOLDOWN_MS) {
        return { action: 'noop', reason: 'redirect-cooldown' };
      }

      // Prevent races: if someone else already inflight, abstain
      if (inflightExists() && !userInitiated) {
        return { action: 'noop', reason: 'another-inflight' };
      }

      // Avoid repeated checks in same session unless force
      if (!force && isSyncDone(selLang, currentPath)) {
        return { action: 'noop', reason: 'already-checked-this-session' };
      }

      // Build and probe candidates
      const candidates = buildPrefixedCandidatesFor(currentPath, selLang);
      const found = await findExistingCandidate(candidates);
      if (!found) {
        markSyncDone(selLang, currentPath);
        return { action: 'none', reason: 'no-prefixed-candidate-found' };
      }

      // Ready to navigate: mark inflight and increment counter
      try {
        const marker = setForceReloadMarker(reason || 'lang-sync');
        if (marker && marker.id) setInflight(marker.id);
      } catch(e){}

      // increment redirect count
      incRedirectCount();

      try {
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
        // Use replace to avoid creating an extra history entry
        location.replace(urlObj.toString());
        return { action: 'replaced', chosen: urlObj.toString(), reason: 'redirected-to-prefixed' };
      } catch (e) {
        try { location.href = found; return { action: 'navigated', chosen: found, reason: 'fallback-navigate' }; } catch(e2){}
      }
      return { action: 'none', reason: 'unexpected' };
    } catch (err) {
      return { action: 'noop', reason: 'error:' + (err && err.message) };
    }
  };

  const verifyAndSyncUrl = throttleVerify(verifyAndSyncUrlImpl);

  // Utility: reset session counters (for debugging / optional UI)
  function resetSessionCounters() {
    try {
      sessionStorage.removeItem(REDIRECT_COUNT_KEY);
      sessionStorage.removeItem(LAST_REDIRECT_TS_KEY);
      sessionStorage.removeItem(FV_INFLIGHT_KEY);
      sessionStorage.removeItem(FV_MARKER_KEY);
    } catch(e){}
  }

  // Expose API
  window.langSync = {
    isLocalDev,
    getDesiredLang,
    shouldPrefix,
    verifyAndSyncUrl, // options: {force, reason, allowRedirect, userInitiated}
    resetSessionCounters,
    _internal: { SKIP_PREFIXES }
  };

  // Auto-run light check on load (non-blocking) but delayed slightly
  if (!isLocalDev()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { setTimeout(()=>{ window.langSync.verifyAndSyncUrl().catch(()=>{}); }, 200); });
    } else {
      setTimeout(()=>{ window.langSync.verifyAndSyncUrl().catch(()=>{}); }, 200);
    }
  }
})();