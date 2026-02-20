/* assets/js/lang-proxy.js
   Dynamic language prefix proxy for /en/ and /th/
   - Place this script as early as possible in <head>
   - If URL starts with /en or /th, it will:
     1. set localStorage.selectedLang
     2. fetch the "real" HTML (stripping the lang prefix)
     3. document.write() the fetched HTML so existing language.min.js runs
     4. keep the URL with the lang prefix in the address bar
   - Uses sessionStorage 'fv-proxy-done' to avoid infinite loops
*/
(function() {
  try {
    const m = location.pathname.match(/^\/(en|th)(\/.*|$)/);
    if (!m) return; // no lang prefix
    const lang = m[1];
    // Avoid repeating proxy when we've already proxied for this language in this session
    const sessionKey = 'fv-proxy-done';
    if (sessionStorage.getItem(sessionKey) === lang) return;
    // mark as proxied for this language
    sessionStorage.setItem(sessionKey, lang);
    // write selectedLang so language.min.js can detect it
    try { localStorage.setItem('selectedLang', lang); } catch (e) {}
    // compute target path by stripping the language prefix
    let target = m[2] || '/';
    if (!target) target = '/';
    // normalize target to start with '/'
    if (!target.startsWith('/')) target = '/' + target;
    
    // Build candidate fetch paths to try (common mapping patterns in this repo)
    function buildCandidates(t) {
      const candidates = [];
      if (t === '/' || t === '') {
        // root -> try home/index.html, index.html, fallback home/
        candidates.push('/home/index.html', '/index.html', '/home/');
      } else {
        // ensure trailing slash handling: try both /path/index.html and /path
        if (t.endsWith('/')) {
          candidates.push(t + 'index.html', t);
        } else {
          candidates.push(t + '/index.html', t);
        }
      }
      // also try removing a trailing slash variant
      return candidates.map(c => (c.startsWith('/') ? c : '/' + c));
    }
    
    // Try to fetch candidates sequentially
    (async function tryFetch() {
      const candidates = buildCandidates(target);
      for (const c of candidates) {
        try {
          // Use no-store to avoid cached stale content during development/updates
          const resp = await fetch(c, { cache: 'no-store' });
          if (!resp.ok) continue;
          const text = await resp.text();
          // Replace document with fetched HTML
          document.open();
          document.write(text);
          document.close();
          // Ensure address bar still shows the language-prefixed URL
          try {
            history.replaceState({}, '', location.pathname + location.search + location.hash);
          } catch (e) {}
          return;
        } catch (e) {
          // ignore and try next candidate
        }
      }
      // If nothing found, fallback: remove lang prefix and navigate (graceful)
      try {
        const fallback = target === '/' ? '/' : target;
        location.replace(fallback);
      } catch (e) {
        // last resort: do nothing
      }
    })();
  } catch (err) {
    // fail silently; do not block page
    console.error('lang-proxy error', err);
  }
})();