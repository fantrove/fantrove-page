/* assets/js/lang-links.js
   Update internal links on the page to include current language prefix (if selected)
   - Load deferred (after DOM ready)
   - Prefixes only applied to internal navigational links (not assets/APIs)
   - Observes DOM mutations to update dynamically-inserted links
   - Intercepts clicks to ensure navigation always goes to a prefixed URL when possible
   - Now: disabled aggressive intercept/prefix in local development hosts (localhost, 127.0.0.1, *.local, 0.0.0.0)
   - LISTENS: storage / BroadcastChannel('fv-lang') / window 'fv-language-updated' / popstate -> to re-sync prefixes
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
    if (!root || !lang) return;
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
  
  // Intercept clicks on internal links that would navigate to non-prefixed paths,
  // and redirect to a prefixed variant when a selectedLang is available.
  // Also record a session mapping target path -> lang so popstate can predict language.
  // NOTE: reads current selectedLang dynamically so it reacts to language changes mid-session.
  function interceptClicks() {
    // If running on a dev host, do not intercept aggressively
    if (isLocalDev()) return;
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
        try {
          // read selectedLang dynamically
          let lang = null;
          try { lang = localStorage.getItem(LANG_KEY); } catch (e) { lang = null; }
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
    if (!lang) {
      // still attach intercept so if user selects language later, clicks will use dynamic read
      interceptClicks();
      return;
    }
    updateLinksIn(document, lang);
    interceptClicks();
    
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
    
    // LISTEN for language changes from other modules/tabs
    try {
      window.addEventListener('storage', (e) => {
        if (e.key === LANG_KEY) {
          const newLang = ensureSelectedLang();
          if (newLang) updateLinksIn(document, newLang);
        }
      });
    } catch (e) {}
    try {
      const bc = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('fv-lang') : null;
      if (bc) {
        bc.onmessage = (msg) => {
          const newLang = ensureSelectedLang();
          if (newLang) updateLinksIn(document, newLang);
        };
      }
    } catch (e) {}
    // custom event dispatched by languageManager when language changed
    try {
      window.addEventListener('fv-language-updated', (ev) => {
        const newLang = (ev && ev.detail && ev.detail.language) ? ev.detail.language : ensureSelectedLang();
        if (newLang) updateLinksIn(document, newLang);
      });
    } catch (e) {}
    // popstate -> try to re-run update (helps when user navigates back)
    try {
      window.addEventListener('popstate', () => {
        const newLang = ensureSelectedLang();
        if (newLang) updateLinksIn(document, newLang);
      });
    } catch (e) {}
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runOnce);
  } else runOnce();
})();