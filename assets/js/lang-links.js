/* assets/js/lang-links.js
   Update internal links on the page to include current language prefix (if selected)
   - Load deferred (after DOM ready)
   - Prefixes only applied to internal navigational links (not assets/APIs)
   - Observes DOM mutations to update dynamically-inserted links
*/
(function() {
  const SKIP_PREFIXES = ['/assets/', '/static/', '/api/', '/_next/', '/favicon.ico', '/robots.txt', '/sitemap.xml'];
  const LANG_KEY = 'selectedLang';
  
  function isInternalHref(href) {
    if (!href) return false;
    // absolute URLs pointing to another host -> skip
    try {
      const url = new URL(href, location.origin);
      if (url.origin !== location.origin) return false;
      // path-only or same-origin -> internal
      return true;
    } catch (e) {
      return false;
    }
  }
  
  function shouldPrefix(hrefPath) {
    if (!hrefPath.startsWith('/')) return false; // relative link (keep as-is)
    for (const p of SKIP_PREFIXES) {
      if (hrefPath.startsWith(p)) return false;
    }
    return true;
  }
  
  function prefixHref(href, lang) {
    try {
      const url = new URL(href, location.origin);
      let path = url.pathname;
      // Avoid double-prefixing if already prefixed
      if (path.match(/^\/(en|th)(\/|$)/)) return href;
      // Ensure leading slash
      if (!path.startsWith('/')) path = '/' + path;
      // Special-case: root path -> "/"
      const newPath = '/' + lang + (path === '/' ? '/' : path);
      url.pathname = newPath;
      return url.toString();
    } catch (e) {
      return href;
    }
  }
  
  function updateLinksIn(root, lang) {
    const anchors = root.querySelectorAll('a[href]');
    anchors.forEach(a => {
      const raw = a.getAttribute('href');
      if (!raw) return;
      // keep mailto:, tel:, javascript:, hash-only
      if (/^(mailto:|tel:|javascript:|#)/i.test(raw)) return;
      // compute absolute path
      if (!isInternalHref(raw)) return;
      // get path portion relative to origin
      const url = new URL(raw, location.origin);
      if (!shouldPrefix(url.pathname)) return;
      // update href but preserve query/hash
      const newHref = prefixHref(raw, lang);
      a.setAttribute('href', newHref);
    });
  }
  
  function runOnce() {
    const lang = (function() {
      try { return localStorage.getItem(LANG_KEY); } catch (e) { return null; }
    })();
    if (!lang) return;
    updateLinksIn(document, lang);
    
    // observe mutations
    const mo = new MutationObserver(muts => {
      muts.forEach(m => {
        m.addedNodes.forEach(n => {
          if (n.nodeType === 1) {
            try {
              updateLinksIn(n, lang);
            } catch (e) {}
          }
        });
      });
    });
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runOnce);
  } else runOnce();
})();