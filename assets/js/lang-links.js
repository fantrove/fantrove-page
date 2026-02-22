/* assets/js/lang-links.js
   Update internal links on the page to include current language prefix (if selected)
   - Adds debug logging (localStorage 'fv-debug' = '1')
   - Dev override for intercept: 'fv-dev-force-intercept' = '1'
   - Better popstate handling and mapping checks
*/
(function() {
  const SKIP_PREFIXES = ['/assets/', '/static/', '/api/', '/_next/', '/favicon.ico', '/robots.txt', '/sitemap.xml'];
  const LANG_KEY = 'selectedLang';
  const CLICK_INTERCEPT_KEY = 'fv-links-intercept-done';
  const DEBUG = (function(){ try { return localStorage.getItem('fv-debug') === '1'; } catch(e){ return false; } })();
  function debugLog(...args){ if (DEBUG) console.debug('[lang-links]', ...args); }

  function isInternalHref(href) {
    if (!href) return false;
    try {
      const url = new URL(href, location.origin);
      if (url.origin !== location.origin) return false;
      return true;
    } catch (e) {
      return false;
    }
  }
  
  function shouldPrefix(hrefPath) {
    if (!hrefPath.startsWith('/')) return false;
    for (const p of SKIP_PREFIXES) {
      if (hrefPath.startsWith(p)) return false;
    }
    return true;
  }
  
  function prefixHref(href, lang) {
    try {
      const url = new URL(href, location.origin);
      let path = url.pathname;
      if (path.match(/^\/(en|th)(\/|$)/)) return href;
      if (!path.startsWith('/')) path = '/' + path;
      const newPath = '/' + lang + (path === '/' ? '/' : path);
      url.pathname = newPath;
      return url.toString();
    } catch (e) {
      return href;
    }
  }
  
  function updateLinksIn(root, lang) {
    try {
      const anchors = root.querySelectorAll('a[href]');
      anchors.forEach(a => {
        const raw = a.getAttribute('href');
        if (!raw) return;
        if (/^(mailto:|tel:|javascript:|#)/i.test(raw)) return;
        if (!isInternalHref(raw)) return;
        const url = new URL(raw, location.origin);
        if (!shouldPrefix(url.pathname)) return;
        const newHref = prefixHref(raw, lang);
        if (newHref !== raw) {
          debugLog('Updating link', raw, '->', newHref);
          a.setAttribute('href', newHref);
        }
      });
    } catch (e) { debugLog('updateLinksIn error', e); }
  }
  
  function isLocalDev() {
    try {
      const host = location.hostname || '';
      if (!host) return false;
      if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return true;
      if (host.endsWith('.local')) return true;
      return false;
    } catch (e) { return false; }
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

  function interceptClicks(lang) {
    // Allow dev override to test intercept even on local dev
    const devForce = (function(){ try { return localStorage.getItem('fv-dev-force-intercept') === '1'; } catch(e){ return false; } })();
    if (isLocalDev() && !devForce) {
      debugLog('Dev host, skipping click intercept (devForce=', devForce, ')');
      return;
    }
    if (window[CLICK_INTERCEPT_KEY]) return;
    window[CLICK_INTERCEPT_KEY] = true;
    document.addEventListener('click', function(ev) {
      try {
        if (ev.defaultPrevented) return;
        if (ev.button !== 0) return;
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;

        const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
        if (!a) return;
        const raw = a.getAttribute('href') || '';
        if (/^(mailto:|tel:|javascript:|#)/i.test(raw)) return;
        if (!isInternalHref(raw)) return;
        const url = new URL(raw, location.origin);
        if (!shouldPrefix(url.pathname)) return;
        if (url.pathname.match(/^\/(en|th)(\/|$)/)) return;
        if (lang) {
          try {
            const key = url.pathname + (url.search || '');
            const rawMap = sessionStorage.getItem('fv-nav-lang-map') || '{}';
            const map = JSON.parse(rawMap || '{}');
            map[key] = { lang: lang, ts: Date.now(), evidence: 'click' };
            sessionStorage.setItem('fv-nav-lang-map', JSON.stringify(map));
            debugLog('Saved click mapping', key, '->', lang);
          } catch (e) { debugLog('Saving mapping failed', e); }
          ev.preventDefault();
          const newHref = prefixHref(raw, lang);
          debugLog('Intercepting navigation', raw, '->', newHref);
          try { window.location.assign(newHref); } catch (e) { location.href = newHref; }
        }
      } catch (e) { debugLog('click listener error', e); }
    }, true);
  }
  
  function ensureSelectedLang() {
    try {
      let lang = null;
      try {
        const m = location.pathname.match(/^\/(en|th)(\/|$)/);
        if (m && m[1]) {
          lang = m[1];
          try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
          debugLog('ensureSelectedLang: honor explicit prefix', lang);
          return lang;
        }
      } catch (e) { debugLog('ensureSelectedLang prefix check error', e); }

      try { lang = localStorage.getItem(LANG_KEY); } catch (e) { lang = null; }
      if (lang) {
        debugLog('ensureSelectedLang: from localStorage', lang);
        return lang;
      }

      try {
        const bros = navigator.languages || [navigator.language || navigator.userLanguage];
        if (bros && bros.length) {
          const first = bros[0].split('-')[0];
          if (first && ['en', 'th'].includes(first)) {
            lang = first;
            try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
            debugLog('ensureSelectedLang: from browser prefs', lang);
            return lang;
          }
        }
      } catch (e) { debugLog('ensureSelectedLang bros failed', e); }
      debugLog('ensureSelectedLang: none found');
      return null;
    } catch (e) { debugLog('ensureSelectedLang top error', e); return null; }
  }
  
  function runOnce() {
    const lang = ensureSelectedLang();
    if (!lang) {
      debugLog('No lang chosen - abort runOnce');
      return;
    }
    debugLog('runOnce chosen lang', lang);

    updateLinksIn(document, lang);
    interceptClicks(lang);
    
    const mo = new MutationObserver(muts => {
      muts.forEach(m => {
        m.addedNodes.forEach(n => {
          if (n.nodeType === 1) {
            try { updateLinksIn(n, lang); } catch (e) { debugLog('mutation update error', e); }
          }
        });
      });
    });
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true });

    window.addEventListener('popstate', (ev) => {
      try {
        const key = location.pathname + (location.search || '');
        const rawMap = sessionStorage.getItem('fv-nav-lang-map') || '{}';
        const map = JSON.parse(rawMap || '{}');
        if (map && map[key] && map[key].lang) {
          const mappedLang = map[key].lang;
          try { localStorage.setItem(LANG_KEY, mappedLang); } catch (e) {}
          debugLog('popstate: applying mappedLang', mappedLang);
          updateLinksIn(document, mappedLang);
          return;
        }
        const m = location.pathname.match(/^\/(en|th)(\/|$)/);
        if (m && m[1]) {
          try { localStorage.setItem(LANG_KEY, m[1]); } catch (e) {}
          debugLog('popstate: detected explicit prefix', m[1]);
          updateLinksIn(document, m[1]);
        } else {
          debugLog('popstate: no mapping or prefix for', location.pathname);
        }
      } catch (e) { debugLog('popstate handler error', e); }
    });
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runOnce);
  } else runOnce();
})();