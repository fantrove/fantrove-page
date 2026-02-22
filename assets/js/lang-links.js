/* assets/js/lang-links.js
   Update internal links on the page to include current language prefix (if selected)
   - Load deferred (after DOM ready)
   - Prefixes only applied to internal navigational links (not assets/APIs)
   - Observes DOM mutations to update dynamically-inserted links
   - Intercepts clicks to ensure navigation always goes to a prefixed URL when possible
   - Now: disabled aggressive intercept/prefix in local development hosts (localhost, 127.0.0.1, *.local, 0.0.0.0)
   - Improvements:
     * Respect explicit URL prefix on load (override selectedLang when present)
     * Avoid intercepting ctrl/meta/shift (open in new tab/window) and modified clicks
     * Use session mapping to improve popstate/back behaviour
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
  
  // Detect local/dev hosts where aggressive behavior should be disabled
  function isLocalDev() {
    try {
      const host = location.hostname || '';
      if (!host) return false;
      if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return true;
      if (host.endsWith('.local')) return true;
      return false;
    } catch (e) { return false; }
  }
  
  // Try to detect navigation type to understand typed/bookmark vs back/forward vs link
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
  
  // Intercept clicks on internal links that would navigate to non-prefixed paths,
  // and redirect to a prefixed variant when a selectedLang is available.
  // Also record a session mapping target path -> lang so popstate can predict language.
  function interceptClicks(lang) {
    // If running on a dev host, do not intercept aggressively
    if (isLocalDev()) return;
    // Attach single capture-phase listener
    if (window[CLICK_INTERCEPT_KEY]) return;
    window[CLICK_INTERCEPT_KEY] = true;
    document.addEventListener('click', function(ev) {
      try {
        // Don't intercept modified clicks (open in new tab/window) or right-clicks
        if (ev.defaultPrevented) return;
        if (ev.button !== 0) return; // only left-click
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        
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
          // Record mapping for the target path -> lang in sessionStorage
          try {
            const key = url.pathname + (url.search || '');
            const rawMap = sessionStorage.getItem('fv-nav-lang-map') || '{}';
            const map = JSON.parse(rawMap || '{}');
            map[key] = { lang: lang, ts: Date.now(), evidence: 'click' };
            sessionStorage.setItem('fv-nav-lang-map', JSON.stringify(map));
          } catch (e) {}
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
      // First: if current pathname explicitly has prefix, honor it and override localStorage
      try {
        const m = location.pathname.match(/^\/(en|th)(\/|$)/);
        if (m && m[1]) {
          lang = m[1];
          try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
          return lang;
        }
      } catch (e) {}
      // Next: try localStorage (user preference)
      try { lang = localStorage.getItem(LANG_KEY); } catch (e) { lang = null; }
      if (lang) return lang;
      // fallback to browser prefs if available
      try {
        const bros = navigator.languages || [navigator.language || navigator.userLanguage];
        if (bros && bros.length) {
          const first = bros[0].split('-')[0];
          if (first) {
            // only set to en/th by default to avoid unexpected prefixes for unknown langs
            if (['en', 'th'].includes(first)) {
              lang = first;
              try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
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
    // Immediately update links using lang chosen (honors explicit prefix on load)
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
    
    // Optional: on popstate, try to update links / local state based on session mapping
    window.addEventListener('popstate', (ev) => {
      try {
        const key = location.pathname + (location.search || '');
        const rawMap = sessionStorage.getItem('fv-nav-lang-map') || '{}';
        const map = JSON.parse(rawMap || '{}');
        if (map && map[key] && map[key].lang) {
          const mappedLang = map[key].lang;
          // Update localStorage to reflect recent evidence (but keep honoring explicit prefix if present)
          try { localStorage.setItem(LANG_KEY, mappedLang); } catch (e) {}
          // Update links to mapped lang
          updateLinksIn(document, mappedLang);
        } else {
          // If pathname has explicit prefix, ensure links are updated to that too
          const m = location.pathname.match(/^\/(en|th)(\/|$)/);
          if (m && m[1]) {
            try { localStorage.setItem(LANG_KEY, m[1]); } catch (e) {}
            updateLinksIn(document, m[1]);
          }
        }
      } catch (e) {}
    });
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runOnce);
  } else runOnce();
})();