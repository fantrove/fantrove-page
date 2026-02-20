/* assets/js/lang-proxy.js
   Dynamic language prefix proxy for /en/ and /th/
   - Place this script as early as possible in <head>
   - If URL starts with /en or /th, it will:
     1. set localStorage.selectedLang
     2. fetch the "real" HTML (stripping the lang prefix)
     3. document.write() the fetched HTML so existing language.min.js runs
     4. keep the URL with the lang prefix in the address bar
   - Uses sessionStorage 'fv-proxy-done' to avoid infinite loops
   - EXTENDED: If current URL does NOT have a lang prefix but localStorage.selectedLang is set,
     the proxy will aggressively try to locate and navigate to a prefixed version of the current page.
*/
(function() {
  try {
    const m = location.pathname.match(/^\/(en|th)(\/.*|$)/);
    const sessionKey = 'fv-proxy-done';
    // If there's an explicit lang prefix in path -> proxy for that prefix
    if (m) {
      const lang = m[1];
      // Avoid repeating proxy when we've already proxied for this language in this session
      if (sessionStorage.getItem(sessionKey) === lang) return;
      sessionStorage.setItem(sessionKey, lang);
      try { localStorage.setItem('selectedLang', lang); } catch (e) {}
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
      
      // Avoid looping: store a per-path+lang marker for this session
      const markKey = 'fv-proxy-done:' + sel + ':' + location.pathname;
      if (sessionStorage.getItem(markKey)) return;
      sessionStorage.setItem(markKey, '1');
      
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
              // Found a prefixed page: navigate user there (preserve search/hash)
              try {
                const urlObj = new URL(c, location.origin);
                urlObj.search = location.search || '';
                urlObj.hash = location.hash || '';
                location.replace(urlObj.toString());
                return;
              } catch (e) {
                try { location.replace(c); return; } catch (e2) {}
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