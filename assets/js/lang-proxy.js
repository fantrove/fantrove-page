/* assets/js/lang-proxy.js
   Dynamic language prefix proxy for /en/ and /th/
   Updated: improve navigation-type heuristics so explicit URL prefixes and typed/bookmarked navigations
   are respected, while still promoting unprefixed pages to prefixed variants where appropriate.
*/
(function() {
  try {
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
        return marker;
      } catch (e) { return null; }
    }
    
    function setInflight(id) {
      try {
        if (!id) return;
        sessionStorage.setItem('fv-reload-inflight', id);
      } catch (e) {}
    }
    
    // --- New helpers: navigation-type & user-typed detection ---
    function getNavigationType() {
      try {
        // Preferred modern API
        if (performance && typeof performance.getEntriesByType === 'function') {
          const nav = performance.getEntriesByType('navigation');
          if (nav && nav.length) return nav[0].type || 'navigate';
        }
        // Fallback (deprecated)
        if (performance && performance.navigation && typeof performance.navigation.type !== 'undefined') {
          const t = performance.navigation.type;
          // 0 = navigate (typed/bookmark/link), 1 = reload, 2 = back_forward
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
        // A 'navigate' with empty referrer (or cross-origin referrer) is often typed/bookmark
        if (navType === 'navigate' && !isReferrerSameOrigin()) return true;
        return false;
      } catch (e) { return false; }
    }
    // --- end new helpers ---
    
    const m = location.pathname.match(/^\/(en|th)(\/.*|$)/);
    const sessionKey = 'fv-proxy-done';
    // If there's an explicit lang prefix in path -> proxy for that prefix
    if (m) {
      const lang = m[1];
      // Avoid repeating proxy when we've already proxied for this language in this session
      if (sessionStorage.getItem(sessionKey) === lang) return;
      sessionStorage.setItem(sessionKey, lang);
      try { localStorage.setItem('selectedLang', lang); } catch (e) {}
      
      // Record mapping of the current (prefixed) URL -> lang so popstate / heuristics can use it
      try {
        const key = location.pathname + (location.search || '');
        const rawMap = sessionStorage.getItem('fv-nav-lang-map') || '{}';
        const map = JSON.parse(rawMap || '{}');
        map[key] = { lang: lang, ts: Date.now(), evidence: 'proxy' };
        sessionStorage.setItem('fv-nav-lang-map', JSON.stringify(map));
      } catch (e) {}
      
      // compute target path by stripping the language prefix
      let target = m[2] || '/';
      if (!target) target = '/';
      if (!target.startsWith('/')) target = '/' + target;
      
      // Build candidate fetch paths to try (common mapping patterns in this repo)
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
            const resp = await fetch(c, { cache: 'no-store' });
            if (!resp.ok) continue;
            const text = await resp.text();
            document.open();
            document.write(text);
            document.close();
            try {
              history.replaceState({}, '', location.pathname + location.search + location.hash);
            } catch (e) {}
            // Create a marker and mark inflight before performing the navigation (replace),
            // so the landing page can acknowledge instead of issuing another reload.
            try {
              const marker = setForceReloadMarker('proxy');
              if (marker && marker.id) setInflight(marker.id);
            } catch (e) {}
            try {
              // replace to the same prefixed URL so the host serves the correct (prefixed) variant normally
              location.replace(location.pathname + location.search + location.hash);
            } catch (e) {
              try { location.reload(); } catch (e2) {}
            }
            return;
          } catch (e) {}
        }
        try {
          const fallback = target === '/' ? '/' : target;
          location.replace(fallback);
        } catch (e) {}
      })();
      return;
    }
    
    // If there's no lang prefix in path, try to proactively find prefixed variant
    (function tryPromoteToPrefixed() {
      // Do nothing early if no selectedLang present
      let sel = null;
      try { sel = localStorage.getItem('selectedLang'); } catch (e) { sel = null; }
      if (!sel) return;
      
      // If running on local dev host, don't try aggressive promotion
      if (isLocalDev()) return;
      
      // Avoid looping: store a per-path+lang marker for this session
      const markKey = 'fv-proxy-done:' + sel + ':' + location.pathname;
      if (sessionStorage.getItem(markKey)) return;
      sessionStorage.setItem(markKey, '1');
      
      // Attempt to adjust selectedLang by checking session mapping for back/forward navigations:
      try {
        const navKey = location.pathname + (location.search || '');
        const rawMap = sessionStorage.getItem('fv-nav-lang-map') || '{}';
        const map = JSON.parse(rawMap || '{}');
        if (map && map[navKey] && map[navKey].lang) {
          // If we have evidence that this path was recently associated with a lang (e.g. via click/proxy),
          // honor that mapping rather than blindly using the stored selectedLang.
          sel = map[navKey].lang;
        }
      } catch (e) {}
      
      // If the navigation appears to be a user-typed navigation AND the current unprefixed URL is visited,
      // we still enforce prefixing (policy: app uses prefix-only). This ensures user doesn't stay on 'unprefixed' pages.
      // However, if user typed a prefixed URL above, we would already have matched earlier.
      const userTyped = isUserTypedNavigation();
      
      // Build candidate prefixed paths for current location.pathname
      function buildPrefixedCandidatesForCurrent(selLang) {
        const t = location.pathname || '/';
        const base = t.endsWith('/') || t === '/' ? t : t;
        const candidates = [];
        const pref = '/' + selLang;
        // prefixed direct
        if (base === '/' || base === '') {
          candidates.push(pref + '/', pref + '/home/', pref + '/home/index.html', pref + '/index.html');
        } else {
          if (base.endsWith('/')) {
            candidates.push(pref + base, pref + base + 'index.html');
          } else {
            candidates.push(pref + base, pref + base + '/index.html');
          }
        }
        // also try with /home variants
        candidates.push(pref + '/home/', pref + '/home/index.html');
        return candidates;
      }
      
      (async function tryFetchPrefixed() {
        const candidates = buildPrefixedCandidatesForCurrent(sel);
        for (const c of candidates) {
          try {
            const resp = await fetch(c, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' });
            if (resp && resp.ok) {
              // Found a prefixed page.
              // Decide whether to navigate:
              // - If this was a user-typed navigation (unprefixed) -> enforce redirect to prefixed (policy)
              // - If there is session evidence (we updated sel from map) -> go
              // - If navigation type is back_forward, and we have mapping evidence -> go
              // - Otherwise (normal arrival by link but no evidence) -> still go (policy: no unprefixed)
              try {
                const urlObj = new URL(c, location.origin);
                urlObj.search = location.search || '';
                urlObj.hash = location.hash || '';
                // set marker + inflight so the landing page knows to ACK instead of reloading again
                try {
                  const marker = setForceReloadMarker('proxy');
                  if (marker && marker.id) setInflight(marker.id);
                } catch (e) {}
                location.replace(urlObj.toString());
                return;
              } catch (e) {
                try {
                  try {
                    const marker = setForceReloadMarker('proxy');
                    if (marker && marker.id) setInflight(marker.id);
                  } catch (e2) {}
                  location.replace(c);
                  return;
                } catch (e2) {}
              }
            }
          } catch (e) {
            // try next
          }
        }
        // nothing found -> do nothing and allow unprefixed page to continue loading
      })();
    })();
    
  } catch (err) {
    // fail silently; do not block page
    console.error('lang-proxy error', err);
  }
})();