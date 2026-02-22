/**
 * lang-coordinator.js v1.1
 *
 * Coordinator ปรับปรุง: บันทึก 'last language change' (fv-last-lang-change)
 * และใช้ข้อมูลนี้เป็นเกณฑ์ในการตัดสินเมื่อ navigation แบบย้อนกลับ
 *
 * โหลดไฟล์นี้หลัง lang-proxy.js/lang-sync.js แต่ก่อน language.min.js
 */

(function() {
  "use strict";

  const LS_KEY = 'selectedLang';
  const LAST_CHANGE_KEY = 'fv-last-lang-change'; // localStorage: { lang, ts, source }
  const NAV_MAP_KEY = 'fv-nav-lang-map'; // sessionStorage map: { "<path+search>": {lang, ts, source} }
  const SUPPORTED_LANGS = ['en', 'th'];
  const DEFAULT_LANG = 'en';

  function nowTs() { return Date.now(); }

  // Helpers
  function getLangFromPath(path) {
    const m = path.match(/^\/(en|th)(\/|$)/);
    return m ? m[1] : null;
  }

  function hasLangPrefix(path) {
    return /^\/(en|th)(\/|$)/.test(path);
  }

  function shouldPrefixPath(path) {
    if (!path.startsWith('/')) return false;
    const SKIP_PATHS = window.FVLangLinks ? ['/assets/', '/static/', '/api/', '/_next/', '/favicon.ico', '/robots.txt', '/sitemap.xml', '/sw.js', '/manifest.json', '/.well-known/'] : ['/assets/'];
    for (const skip of SKIP_PATHS) {
      if (path.startsWith(skip)) return false;
    }
    return true;
  }

  function getStoredLang() {
    try {
      const l = localStorage.getItem(LS_KEY);
      return SUPPORTED_LANGS.includes(l) ? l : null;
    } catch (e) { return null; }
  }

  function setStoredLang(lang, source='coordinator-set') {
    try {
      if (!SUPPORTED_LANGS.includes(lang)) return;
      localStorage.setItem(LS_KEY, lang);
      // dispatch languageChange in-tab
      window.dispatchEvent(new CustomEvent('languageChange', { detail: { language: lang, source } }));
    } catch (e) {}
  }

  function getLastChange() {
    try {
      return JSON.parse(localStorage.getItem(LAST_CHANGE_KEY) || 'null');
    } catch (e) { return null; }
  }

  function setLastChange(lang, source='user') {
    try {
      if (!SUPPORTED_LANGS.includes(lang)) return;
      const payload = { lang: lang, ts: nowTs(), source: source };
      localStorage.setItem(LAST_CHANGE_KEY, JSON.stringify(payload));
    } catch (e) {}
  }

  function loadNavMap() {
    try { return JSON.parse(sessionStorage.getItem(NAV_MAP_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveNavMap(map) {
    try { sessionStorage.setItem(NAV_MAP_KEY, JSON.stringify(map)); } catch (e) {}
  }
  function recordNavLangForPath(pathKey, lang, source='coordinator') {
    try {
      const map = loadNavMap();
      map[pathKey] = { lang: lang, ts: nowTs(), source };
      saveNavMap(map);
    } catch (e) {}
  }
  function pathKeyForLocation(loc) {
    return (loc.pathname || '') + (loc.search || '');
  }

  // Monkeypatch history to emit 'fv:history'
  (function() {
    const origPush = history.pushState;
    history.pushState = function(state, title, url) {
      const res = origPush.apply(this, arguments);
      try {
        window.dispatchEvent(new CustomEvent('fv:history', { detail: { method: 'pushState', state: state, url: url } }));
      } catch (e) {}
      return res;
    };
    const origReplace = history.replaceState;
    history.replaceState = function(state, title, url) {
      const res = origReplace.apply(this, arguments);
      try {
        window.dispatchEvent(new CustomEvent('fv:history', { detail: { method: 'replaceState', state: state, url: url } }));
      } catch (e) {}
      return res;
    };
  })();

  function ensureUrlHasPrefix(lang) {
    try {
      const loc = location;
      if (!shouldPrefixPath(loc.pathname)) return;
      const currentLang = getLangFromPath(loc.pathname);
      if (currentLang === lang) return;
      const newPath = '/' + lang + (loc.pathname === '/' ? '' : loc.pathname);
      const newUrl = newPath + loc.search + loc.hash;
      history.replaceState({ lang: lang, forced: true }, document.title, newUrl);
      recordNavLangForPath(newPath + loc.search, lang, 'ensureUrlHasPrefix');
    } catch (e) {
      try { location.replace('/' + (lang || DEFAULT_LANG) + location.pathname + location.search + location.hash); } catch (err) {}
    }
  }

  /**
   * หลักการตัดสินเมื่อ navigation (back/forward/pushState/replaceState/pageshow)
   * - โหลด mapped info (sessionStorage) สำหรับหน้าเป้าหมาย
   * - โหลด lastChange (localStorage) ที่บันทึกเมื่อ user เปลี่ยนภาษา
   * - ถ้า lastChange มีและ newer กว่า mapped.ts → ให้ override ด้วย lastChange.lang
   * - ถ้า mapped มีและ newer → ใช้ mapped.lang
   * - ถ้าไม่มี mapping แต่ URL มี prefix → ใช้ URL lang (และบันทึก)
   * - ถ้าไม่มี prefix เลย → enforce storedLang / lastChange.lang
   */
  function onNavigationEvent(ev) {
    try {
      const loc = location;
      const key = pathKeyForLocation(loc);
      const map = loadNavMap();
      const mapped = map[key];
      const urlLang = getLangFromPath(loc.pathname);
      const lastChange = getLastChange();

      // If last change exists and is newer than mapping -> prefer lastChange.lang
      if (lastChange && (!mapped || (mapped.ts && lastChange.ts > mapped.ts))) {
        const desiredLang = lastChange.lang;
        if (urlLang !== desiredLang && shouldPrefixPath(loc.pathname)) {
          const newPath = '/' + desiredLang + (loc.pathname === '/' ? '' : loc.pathname);
          const newUrl = newPath + loc.search + loc.hash;
          history.replaceState({ lang: desiredLang, restoredFromLastChange: true }, document.title, newUrl);
          // record mapping for newPath
          recordNavLangForPath(newPath + loc.search, desiredLang, 'override-last-change');
        }
        // sync stored lang
        if (getStoredLang() !== desiredLang) {
          setStoredLang(desiredLang, 'override-last-change');
        }
        if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, desiredLang);
        return;
      }

      // Otherwise if mapping exists, honor it
      if (mapped && mapped.lang) {
        const desiredLang = mapped.lang;
        if (urlLang !== desiredLang && shouldPrefixPath(loc.pathname)) {
          const newPath = '/' + desiredLang + (loc.pathname === '/' ? '' : loc.pathname);
          const newUrl = newPath + loc.search + loc.hash;
          history.replaceState({ lang: desiredLang, restored: true }, document.title, newUrl);
          recordNavLangForPath(newPath + loc.search, desiredLang, 'restore-mapped');
        }
        if (getStoredLang() !== desiredLang) {
          setStoredLang(desiredLang, 'restore-mapped');
        }
        if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, desiredLang);
        return;
      }

      // No mapping: if URL has prefix, adopt it and record mapping & last-change (manual prefix is user action)
      if (urlLang) {
        recordNavLangForPath(key, urlLang, 'url-prefix');
        // treat manual URL prefix as user selection -> update lastChange
        setLastChange(urlLang, 'manual-url');
        if (getStoredLang() !== urlLang) setStoredLang(urlLang, 'url-prefix');
        if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, urlLang);
        return;
      }

      // No prefix & no mapping -> enforce storedLang or lastChange or default
      const stored = getStoredLang();
      const fallback = (lastChange && lastChange.lang) ? lastChange.lang : (stored || DEFAULT_LANG);
      ensureUrlHasPrefix(fallback);
      if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, fallback);

    } catch (e) {
      // ignore
    }
  }

  // When language is changed programmatically (language manager, UI)
  // Expect language manager to dispatch 'languageChange' with detail.language
  function onLanguageChangeEvent(e) {
    try {
      const newLang = e.detail && e.detail.language ? e.detail.language : getStoredLang();
      if (!newLang) return;
      // record last change (explicit user action)
      setLastChange(newLang, (e.detail && e.detail.source) ? e.detail.source : 'user');

      // record nav mapping for current path
      const currentKey = pathKeyForLocation(location);
      recordNavLangForPath(currentKey, newLang, 'languageChangeEvent');

      // update storedLang (triggers languageChange in-tab)
      if (getStoredLang() !== newLang) {
        localStorage.setItem(LS_KEY, newLang);
        window.dispatchEvent(new CustomEvent('languageChange', { detail: { language: newLang, source: 'coordinator-set' } }));
      }

      // ensure URL prefix matches
      const urlLang = getLangFromPath(location.pathname);
      if (urlLang !== newLang && shouldPrefixPath(location.pathname)) {
        const newPath = '/' + newLang + (location.pathname === '/' ? '' : location.pathname);
        const newUrl = newPath + location.search + location.hash;
        history.replaceState({ lang: newLang, fromLangChange: true }, document.title, newUrl);
        recordNavLangForPath(newPath + location.search, newLang, 'languageChangeEvent-replace');
      }

      // update links
      if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, newLang);
    } catch (err) {}
  }

  // Storage event (cross-tab)
  function onStorageEvent(e) {
    try {
      if (!e) return;
      if (e.key === LS_KEY) {
        const newLang = e.newValue;
        if (!newLang) return;
        if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, newLang);
        const urlLang = getLangFromPath(location.pathname);
        if (urlLang !== newLang && shouldPrefixPath(location.pathname)) {
          const newPath = '/' + newLang + (location.pathname === '/' ? '' : location.pathname);
          const newUrl = newPath + location.search + location.hash;
          try {
            history.replaceState({ lang: newLang, crossTab: true }, document.title, newUrl);
            recordNavLangForPath(newPath + location.search, newLang, 'storageEvent');
          } catch (err) {
            location.replace(newUrl);
          }
        }
      } else if (e.key === LAST_CHANGE_KEY) {
        // cross-tab last change: ensure links/url follow
        const last = getLastChange();
        if (last && last.lang) {
          if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, last.lang);
          const urlLang = getLangFromPath(location.pathname);
          if (urlLang !== last.lang && shouldPrefixPath(location.pathname)) {
            const newPath = '/' + last.lang + (location.pathname === '/' ? '' : location.pathname);
            const newUrl = newPath + location.search + location.hash;
            try {
              history.replaceState({ lang: last.lang, crossTabLastChange: true }, document.title, newUrl);
              recordNavLangForPath(newPath + location.search, last.lang, 'storageEvent-lastChange');
            } catch (err) {
              location.replace(newUrl);
            }
          }
        }
      }
    } catch (e) {}
  }

  // Initial enforcement on page load
  function initialEnforce() {
    try {
      const urlLang = getLangFromPath(location.pathname);
      if (urlLang) {
        // record mapping and treat as manual selection
        recordNavLangForPath(pathKeyForLocation(location), urlLang, 'initial-url');
        setLastChange(urlLang, 'initial-url');
        if (getStoredLang() !== urlLang) setStoredLang(urlLang, 'initial-url');
        if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, urlLang);
        return;
      }

      // no prefix: try lastChange -> stored -> default
      const last = getLastChange();
      const stored = getStoredLang();
      const chosen = (last && last.lang) ? last.lang : (stored || DEFAULT_LANG);
      ensureUrlHasPrefix(chosen);
      if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, chosen);
    } catch (e) {}
  }

  // Wiring
  window.addEventListener('popstate', function(ev) { onNavigationEvent(ev); });
  window.addEventListener('fv:history', function(ev) { setTimeout(() => onNavigationEvent(ev), 0); });
  window.addEventListener('pageshow', function(ev) { setTimeout(() => onNavigationEvent(ev), 0); });

  window.addEventListener('languageChange', onLanguageChangeEvent, false);
  window.addEventListener('storage', onStorageEvent, false);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialEnforce);
  } else {
    initialEnforce();
  }

  // Small API for debugging
  window.FVLangCoordinator = {
    ensureUrlHasPrefix,
    recordNavLangForPath,
    loadNavMap,
    saveNavMap,
    getLastChange: getLastChange
  };

})();