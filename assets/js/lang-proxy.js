/* assets/js/lang-proxy.js
   Dynamic language prefix proxy for /en/ and /th/
   Changes:
   - Debug logging controlled by localStorage 'fv-debug' (set to '1' to enable)
   - Dev override: localStorage 'fv-dev-force-prefix' = '1' bypasses isLocalDev() guard for testing
   - If HEAD fails (405/other), try GET as fallback
   - More defensive error logging to sessionStorage for quick inspection when page 404s
*/
(function() {
  try {
    const DEBUG = (function(){ try { return localStorage.getItem('fv-debug') === '1'; } catch(e){ return false; } })();
    function debugLog(...args){ if (DEBUG) console.debug('[lang-proxy]', ...args); }

    function isLocalDev() {
      try {
        const host = location.hostname || '';
        if (!host) return false;
        if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return true;
        if (host.endsWith('.local')) return true;
        return false;
      } catch (e) { return false; }
    }
    
    function genReloadId() {
      return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
    }
    
    function setForceReloadMarker(source) {
      try {
        const id = genReloadId();
        const marker = { id: id, ts: Date.now(), source: source || 'proxy' };
        sessionStorage.setItem('fv-forcereload', JSON.stringify(marker));
        debugLog('setForceReloadMarker', marker);
        return marker;
      } catch (e) { return null; }
    }
    
    function setInflight(id) {
      try {
        if (!id) return;
        sessionStorage.setItem('fv-reload-inflight', id);
        debugLog('setInflight', id);
      } catch (e) {}
    }

    function getNavigationType() {
      try {
        if (performance && typeof performance.getEntriesByType === 'function') {
          const nav = performance.getEntriesByType('navigation');
          if (nav && nav.length) return nav[0].type || 'navigate';
        }
        if (performance && performance.navigation && typeof performance.navigation.type !== 'undefined') {
          const t = performance.navigation.type;
          return t === 0 ? 'navigate' : (t === 1 ? 'reload' : (t === 2 ? 'back_forward' : 'navigate'));
        }
      } catch (e) {}
      return 'navigate';
    }
    
    function isReferrerSameOrigin() {
      try {
        const ref = document.referrer || '';
        if (!ref) return false;
        const r = new URL(ref, location.origin);
        return r.origin === location.origin;
      } catch (e) { return false; }
    }

    function isUserTypedNavigation() {
      try {
        const navType = getNavigationType();
        if (navType === 'navigate' && !isReferrerSameOrigin()) return true;
        return false;
      } catch (e) { return false; }
    }

    const m = location.pathname.match(/^\/(en|th)(\/.*|$)/);
    const sessionKey = 'fv-proxy-done';

    // If there's an explicit lang prefix in path -> proxy for that prefix
    if (m) {
      const lang = m[1];
      debugLog('Detected explicit prefix on load:', lang, location.pathname);
      if (sessionStorage.getItem(sessionKey) === lang) {
        debugLog('Already proxied for this session, returning');
        return;
      }
      sessionStorage.setItem(sessionKey, lang);
      try { localStorage.setItem('selectedLang', lang); } catch (e) {}

      // record mapping for popstate heuristics
      try {
        const key = location.pathname + (location.search || '');
        const rawMap = sessionStorage.getItem('fv-nav-lang-map') || '{}';
        const map = JSON.parse(rawMap || '{}');
        map[key] = { lang: lang, ts: Date.now(), evidence: 'proxy' };
        sessionStorage.setItem('fv-nav-lang-map', JSON.stringify(map));
        debugLog('Mapped', key, '->', lang);
      } catch (e) { debugLog('Mapping store failed', e); }

      // compute target path by stripping the language prefix
      let target = m[2] || '/';
      if (!target) target = '/';
      if (!target.startsWith('/')) target = '/' + target;

      function buildCandidates(t) {
        const candidates = [];
        if (t === '/' || t === '') {
          candidates.push('/home/index.html', '/index.html', '/home/');
        } else {
          if (t.endsWith('/')) {
            candidates.push(t + 'index.html', t);
          } else {
            candidates.push(t + '/index.html', t);
          }
        }
        return candidates.map(c => (c.startsWith('/') ? c : '/' + c));
      }

      (async function tryFetch() {
        const candidates = buildCandidates(target);
        for (const c of candidates) {
          try {
            debugLog('Trying fetch for candidate (proxy):', c);
            const resp = await fetch(c, { cache: 'no-store', credentials: 'same-origin' });
            if (!resp.ok) {
              debugLog('Candidate fetch not ok:', c, resp.status);
              continue;
            }
            const text = await resp.text();
            document.open();
            document.write(text);
            document.close();
            try {
              history.replaceState({}, '', location.pathname + location.search + location.hash);
            } catch (e) {}
            try {
              const marker = setForceReloadMarker('proxy');
              if (marker && marker.id) setInflight(marker.id);
            } catch (e) {}
            try {
              location.replace(location.pathname + location.search + location.hash);
            } catch (e) {
              try { location.reload(); } catch (e2) {}
            }
            return;
          } catch (e) {
            debugLog('fetch candidate error', c, e);
          }
        }
        try {
          const fallback = target === '/' ? '/' : target;
          debugLog('No candidate succeeded, fallback replace to', fallback);
          location.replace(fallback);
        } catch (e) { debugLog('fallback replace failed', e); }
      })();
      return;
    }

    // No prefix: try to promote to prefixed variant
    (function tryPromoteToPrefixed() {
      let sel = null;
      try { sel = localStorage.getItem('selectedLang'); } catch (e) { sel = null; }
      if (!sel) {
        debugLog('No selectedLang present, abort promotion');
        return;
      }

      // Allow dev override for testing
      const devForce = (function(){ try { return localStorage.getItem('fv-dev-force-prefix') === '1'; } catch(e){ return false; } })();
      if (isLocalDev() && !devForce) {
        debugLog('isLocalDev and no devForce -> skip promotion');
        return;
      }
      if (isLocalDev() && devForce) {
        debugLog('isLocalDev but devForce enabled -> performing promotion for testing');
      }

      const markKey = 'fv-proxy-done:' + sel + ':' + location.pathname;
      if (sessionStorage.getItem(markKey)) {
        debugLog('Promotion already attempted for', markKey);
        return;
      }
      sessionStorage.setItem(markKey, '1');

      // If there is mapping evidence for this path, prefer that lang
      try {
        const navKey = location.pathname + (location.search || '');
        const rawMap = sessionStorage.getItem('fv-nav-lang-map') || '{}';
        const map = JSON.parse(rawMap || '{}');
        if (map && map[navKey] && map[navKey].lang) {
          sel = map[navKey].lang;
          debugLog('Using session mapping for path', navKey, '->', sel);
        }
      } catch (e) { debugLog('reading session map failed', e); }

      function buildPrefixedCandidatesForCurrent(selLang) {
        const t = location.pathname || '/';
        const base = t.endsWith('/') || t === '/' ? t : t;
        const candidates = [];
        const pref = '/' + selLang;
        if (base === '/' || base === '') {
          candidates.push(pref + '/', pref + '/home/', pref + '/home/index.html', pref + '/index.html');
        } else {
          if (base.endsWith('/')) {
            candidates.push(pref + base, pref + base + 'index.html');
          } else {
            candidates.push(pref + base, pref + base + '/index.html');
          }
        }
        candidates.push(pref + '/home/', pref + '/home/index.html');
        return candidates;
      }

      (async function tryFetchPrefixed() {
        const candidates = buildPrefixedCandidatesForCurrent(sel);
        for (const c of candidates) {
          try {
            debugLog('HEAD check for candidate:', c);
            let resp = null;
            try {
              resp = await fetch(c, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' });
            } catch (e) {
              debugLog('HEAD failed', c, e);
              // if HEAD fails (server doesn't allow), fall through to GET attempt
            }
            if (resp && resp.ok) {
              debugLog('HEAD ok -> redirect to', c);
              const urlObj = new URL(c, location.origin);
              urlObj.search = location.search || '';
              urlObj.hash = location.hash || '';
              try {
                const marker = setForceReloadMarker('proxy');
                if (marker && marker.id) setInflight(marker.id);
              } catch (e) {}
              location.replace(urlObj.toString());
              return;
            }
            // Fallback: try GET if HEAD not ok or not available
            debugLog('Trying GET as fallback for', c);
            try {
              resp = await fetch(c, { method: 'GET', cache: 'no-store', credentials: 'same-origin' });
              if (resp && resp.ok) {
                debugLog('GET ok -> redirect to', c);
                const urlObj = new URL(c, location.origin);
                urlObj.search = location.search || '';
                urlObj.hash = location.hash || '';
                try {
                  const marker = setForceReloadMarker('proxy');
                  if (marker && marker.id) setInflight(marker.id);
                } catch (e) {}
                location.replace(urlObj.toString());
                return;
              } else {
                debugLog('GET not ok', c, resp && resp.status);
              }
            } catch (e) {
              debugLog('GET fallback failed', c, e);
            }
          } catch (e) {
            debugLog('candidate loop error', e);
          }
        }
        debugLog('No prefixed candidate found; leaving unprefixed page to continue loading');
      })();
    })();
    
  } catch (err) {
    try { console.error('lang-proxy error', err); } catch (e) {}
  }
})();