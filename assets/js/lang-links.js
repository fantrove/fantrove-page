/* assets/js/lang-links.js
   Update internal links on the page to include current language prefix (if selected)
   - Load deferred (after DOM ready)
   - Prefixes only applied to internal navigational links (not assets/APIs)
   - Observes DOM mutations to update dynamically-inserted links
   - Intercepts clicks to ensure navigation always goes to a prefixed URL when possible
*/
(function() {
  const SKIP_PREFIXES = ['/assets/', '/static/', '/api/', '/_next/', '/favicon.ico', '/robots.txt', '/sitemap.xml'];
  const LANG_KEY = 'selectedLang';
  const CLICK_INTERCEPT_KEY = 'fv-links-intercept-done';
  
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
  
  // Intercept clicks on internal links that would navigate to non-prefixed paths,
  // and redirect to a prefixed variant when a selectedLang is available.
  function interceptClicks(lang) {
    // Attach single capture-phase listener
    if (window[CLICK_INTERCEPT_KEY]) return;
    window[CLICK_INTERCEPT_KEY] = true;
    document.addEventListener('click', function(ev) {
      try {
        const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
        if (!a) return;
        const raw = a.getAttribute('href') || '';
        if (/^(mailto:|tel:|javascript:|#)/i.test(raw)) return;
        if (!isInternalHref(raw)) return;
        const url = new URL(raw, location.origin);
        if (!shouldPrefix(url.pathname)) return;
        // If link already has language prefix, allow default
        if (url.pathname.match(/^\/(en|th)(\/|$)/)) return;
        // If selectedLang available, navigate to prefixed URL
        if (lang) {
          ev.preventDefault();
          const newHref = prefixHref(raw, lang);
          // Use location.assign so history is natural for users
          try { window.location.assign(newHref); } catch (e) { location.href = newHref; }
        }
      } catch (e) {
        // swallow
      }
    }, true);
  }
  
  function ensureSelectedLang() {
    try {
      let lang = null;
      try { lang = localStorage.getItem(LANG_KEY); } catch (e) { lang = null; }
      if (lang) return lang;
      // try detect from current pathname (/en/... or /th/...)
      try {
        const m = location.pathname.match(/^\/(en|th)(\/|$)/);
        if (m) {
          lang = m[1];
          localStorage.setItem(LANG_KEY, lang);
          return lang;
        }
      } catch (e) {}
      // fallback to browser prefs if available
      try {
        const bros = navigator.languages || [navigator.language || navigator.userLanguage];
        if (bros && bros.length) {
          const first = bros[0].split('-')[0];
          if (first) {
            // only set to en/th by default to avoid unexpected prefixes for unknown langs
            if (['en', 'th'].includes(first)) {
              lang = first;
              localStorage.setItem(LANG_KEY, lang);
              return lang;
            }
          }
        }
      } catch (e) {}
      return null;
    } catch (e) { return null; }
  }
  
  function runOnce() {
    const lang = ensureSelectedLang();
    if (!lang) return;
    updateLinksIn(document, lang);
    interceptClicks(lang);
    
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