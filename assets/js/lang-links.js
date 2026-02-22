(function() {
  const SKIP_PREFIXES = ['/assets/', '/static/', '/api/', '/_next/', '/favicon.ico', '/robots.txt', '/sitemap.xml'];
  const LANG_KEY = 'selectedLang';
  const CLICK_INTERCEPT_KEY = 'fv-links-intercept-done';
  function isInternalHref(href) {
    if (!href) return false;
    try {
      const url = new URL(href, location.origin);
      if (url.origin !== location.origin) return false;
      return true;
    } catch (e) { return false; }
  }
  function shouldPrefix(hrefPath) {
    if (!hrefPath.startsWith('/')) return false;
    for (const p of SKIP_PREFIXES) if (hrefPath.startsWith(p)) return false;
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
      return url.pathname + (url.search || '') + (url.hash || '');
    } catch (e) { return href; }
  }
  function updateLinksIn(root, lang) {
    const anchors = root.querySelectorAll('a[href]');
    anchors.forEach(a => {
      const raw = a.getAttribute('href');
      if (!raw) return;
      if (/^(mailto:|tel:|javascript:|#)/i.test(raw)) return;
      if (!isInternalHref(raw)) return;
      const url = new URL(raw, location.origin);
      if (!shouldPrefix(url.pathname)) return;
      const newHref = prefixHref(raw, lang);
      console.debug('[lang-links] update', raw, '->', newHref);
      a.setAttribute('href', newHref);
    });
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
  function interceptClicks(lang) {
    if (isLocalDev()) { console.debug('[lang-links] local dev, not intercepting'); return; }
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
        if (url.pathname.match(/^\/(en|th)(\/|$)/)) return;
        console.debug('[lang-links] intercepted click', raw, 'selectedLang=', lang);
        if (lang) {
          try {
            const key = url.pathname + (url.search || '');
            const rawMap = sessionStorage.getItem('fv-nav-lang-map') || '{}';
            const map = JSON.parse(rawMap || '{}');
            map[key] = { lang: lang, ts: Date.now(), evidence: 'click' };
            sessionStorage.setItem('fv-nav-lang-map', JSON.stringify(map));
          } catch (e) {}
          ev.preventDefault();
          const newHref = prefixHref(raw, lang);
          console.debug('[lang-links] redirecting to', newHref);
          try { window.location.assign(newHref); } catch (e) { location.href = newHref; }
        }
      } catch (e) { console.error('[lang-links] intercept error', e); }
    }, true);
  }
  function ensureSelectedLang() {
    try {
      let lang = null;
      try { lang = localStorage.getItem(LANG_KEY); } catch (e) { lang = null; }
      console.debug('[lang-links] ensureSelectedLang initial', lang);
      if (lang) return lang;
      try {
        const m = location.pathname.match(/^\/(en|th)(\/|$)/);
        if (m) {
          lang = m[1];
          try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
          console.debug('[lang-links] detected lang from path', lang);
          return lang;
        }
      } catch (e) {}
      try {
        const bros = navigator.languages || [navigator.language || navigator.userLanguage];
        if (bros && bros.length) {
          const first = bros[0].split('-')[0];
          if (first && ['en','th'].includes(first)) {
            lang = first;
            try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
            console.debug('[lang-links] detected lang from browser', lang);
            return lang;
          }
        }
      } catch (e) {}
      return null;
    } catch (e) { return null; }
  }
  function runOnce() {
    const lang = ensureSelectedLang();
    console.debug('[lang-links] runOnce lang=', lang);
    if (!lang) return;
    updateLinksIn(document, lang);
    interceptClicks(lang);
    const mo = new MutationObserver(muts => {
      muts.forEach(m => {
        m.addedNodes.forEach(n => {
          if (n.nodeType === 1) {
            try { updateLinksIn(n, lang); } catch (e) {}
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