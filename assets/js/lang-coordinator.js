/**
 * lang-coordinator.js v1.2
 *
 * ปรับปรุง:
 * - ทำ initialEnforce อย่างทันทีเมื่อสคริปต์ถูก parse (ไม่รอ DOMContentLoaded)
 * - เมื่อ enforce URL จะตั้ง localStorage.selectedLang และ fv-last-lang-change ก่อน
 * - ยังคงใช้ mapping (sessionStorage fv-nav-lang-map) และ last-change (localStorage fv-last-lang-change)
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

  function getLangFromPath(path) {
    const m = path.match(/^\/(en|th)(\/|$)/);
    return m ? m[1] : null;
  }

  function shouldPrefixPath(path) {
    if (!path || !path.startsWith('/')) return false;
    const SKIP_PATHS = window.FVLangLinks ? ['/assets/', '/static/', '/api/', '/_next/', '/favicon.ico', '/robots.txt', '/sitemap.xml', '/sw.js', '/manifest.json', '/.well-known/'] : ['/assets/'];
    for (const skip of SKIP_PATHS) if (path.startsWith(skip)) return false;
    return true;
  }

  function getStoredLang() {
    try { const l = localStorage.getItem(LS_KEY); return SUPPORTED_LANGS.includes(l) ? l : null; } catch (e) { return null; }
  }
  function setStoredLangImmediate(lang, source='coordinator-set') {
    try {
      if (!SUPPORTED_LANGS.includes(lang)) return;
      localStorage.setItem(LS_KEY, lang);
      // dispatch in-tab event immediately
      window.dispatchEvent(new CustomEvent('languageChange', { detail: { language: lang, source } }));
    } catch (e) {}
  }

  function getLastChange() {
    try { return JSON.parse(localStorage.getItem(LAST_CHANGE_KEY) || 'null'); } catch (e) { return null; }
  }
  function setLastChangeImmediate(lang, source='user') {
    try {
      if (!SUPPORTED_LANGS.includes(lang)) return;
      const payload = { lang: lang, ts: nowTs(), source: source };
      localStorage.setItem(LAST_CHANGE_KEY, JSON.stringify(payload));
      // also set selectedLang to keep consistent immediately
      localStorage.setItem(LS_KEY, lang);
      // dispatch in-tab languageChange
      window.dispatchEvent(new CustomEvent('languageChange', { detail: { language: lang, source } }));
    } catch (e) {}
  }

  function loadNavMap() { try { return JSON.parse(sessionStorage.getItem(NAV_MAP_KEY) || '{}'); } catch (e) { return {}; } }
  function saveNavMap(map) { try { sessionStorage.setItem(NAV_MAP_KEY, JSON.stringify(map)); } catch (e) {} }
  function recordNavLangForPath(pathKey, lang, source='coordinator') {
    try {
      const map = loadNavMap();
      map[pathKey] = { lang: lang, ts: nowTs(), source };
      saveNavMap(map);
    } catch (e) {}
  }
  function pathKeyForLocation(loc) { return (loc.pathname || '') + (loc.search || ''); }

  // Monkeypatch history to emit 'fv:history'
  (function() {
    const origPush = history.pushState;
    history.pushState = function(state, title, url) {
      const res = origPush.apply(this, arguments);
      try { window.dispatchEvent(new CustomEvent('fv:history', { detail: { method: 'pushState', state: state, url: url } })); } catch (e) {}
      return res;
    };
    const origReplace = history.replaceState;
    history.replaceState = function(state, title, url) {
      const res = origReplace.apply(this, arguments);
      try { window.dispatchEvent(new CustomEvent('fv:history', { detail: { method: 'replaceState', state: state, url: url } })); } catch (e) {}
      return res;
    };
  })();

  // Ensure URL has prefix and synchronously set storage/event BEFORE language manager loads
  function ensureUrlHasPrefixImmediate(lang) {
    try {
      const loc = location;
      if (!shouldPrefixPath(loc.pathname)) return;
      const currentLang = getLangFromPath(loc.pathname);
      if (currentLang === lang) {
        // still set stored/last-change to ensure language manager picks it up
        setLastChangeImmediate(lang, 'ensure-no-op');
        return;
      }
      // set last-change & selectedLang first (so language manager reads correct lang)
      setLastChangeImmediate(lang, 'ensure-before-replace');
      // Build new path
      const newPath = '/' + lang + (loc.pathname === '/' ? '' : loc.pathname);
      const newUrl = newPath + loc.search + loc.hash;
      // replaceState (no reload)
      history.replaceState({ lang: lang, forced: true }, document.title, newUrl);
      recordNavLangForPath(newPath + loc.search, lang, 'ensureUrlHasPrefix');
    } catch (e) {
      try { location.replace('/' + (lang || DEFAULT_LANG) + location.pathname + location.search + location.hash); } catch (err) {}
    }
  }

  // Main nav decision: prefer lastChange when newer than mapping
  function onNavigationEvent(ev) {
    try {
      const loc = location;
      const key = pathKeyForLocation(loc);
      const map = loadNavMap();
      const mapped = map[key];
      const urlLang = getLangFromPath(loc.pathname);
      const lastChange = getLastChange();

      // If lastChange newer than mapping => override to lastChange.lang
      if (lastChange && (!mapped || (mapped.ts && lastChange.ts > mapped.ts))) {
        const desiredLang = lastChange.lang;
        if (shouldPrefixPath(loc.pathname) && urlLang !== desiredLang) {
          // set storage immediately, replace URL
          setLastChangeImmediate(desiredLang, 'nav-override-lastchange');
          const newPath = '/' + desiredLang + (loc.pathname === '/' ? '' : loc.pathname);
          const newUrl = newPath + loc.search + loc.hash;
          history.replaceState({ lang: desiredLang, restoredFromLastChange: true }, document.title, newUrl);
          recordNavLangForPath(newPath + loc.search, desiredLang, 'override-last-change');
        } else {
          // ensure stored lang sync
          setStoredLangImmediate(desiredLang, 'nav-ensure-sync');
        }
        if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, desiredLang);
        return;
      }

      // mapping exists -> honor mapping
      if (mapped && mapped.lang) {
        const desiredLang = mapped.lang;
        if (shouldPrefixPath(loc.pathname) && urlLang !== desiredLang) {
          setStoredLangImmediate(desiredLang, 'restore-mapped');
          const newPath = '/' + desiredLang + (loc.pathname === '/' ? '' : loc.pathname);
          const newUrl = newPath + loc.search + loc.hash;
          history.replaceState({ lang: desiredLang, restored: true }, document.title, newUrl);
          recordNavLangForPath(newPath + loc.search, desiredLang, 'restore-mapped');
        } else {
          setStoredLangImmediate(desiredLang, 'restore-mapped-noop');
        }
        if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, desiredLang);
        return;
      }

      // No mapping: if URL has prefix, adopt it and record mapping & last-change
      if (urlLang) {
        recordNavLangForPath(key, urlLang, 'url-prefix');
        setLastChangeImmediate(urlLang, 'manual-url');
        setStoredLangImmediate(urlLang, 'url-prefix');
        if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, urlLang);
        return;
      }

      // No prefix & no mapping -> enforce lastChange -> stored -> default
      const last = getLastChange();
      const stored = getStoredLang();
      const chosen = (last && last.lang) ? last.lang : (stored || DEFAULT_LANG);
      ensureUrlHasPrefixImmediate(chosen);
      if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, chosen);
    } catch (e) {
      // ignore
    }
  }

  // Reaction to explicit languageChange events (from language manager/UI)
  function onLanguageChangeEvent(e) {
    try {
      const newLang = e.detail && e.detail.language ? e.detail.language : getStoredLang();
      if (!newLang) return;
      // record last change immediately (user action)
      setLastChangeImmediate(newLang, (e.detail && e.detail.source) ? e.detail.source : 'user');
      // record nav mapping
      const currentKey = pathKeyForLocation(location);
      recordNavLangForPath(currentKey, newLang, 'languageChangeEvent');
      // ensure URL prefix matches (replaceState) and storedLang is set
      const urlLang = getLangFromPath(location.pathname);
      if (urlLang !== newLang && shouldPrefixPath(location.pathname)) {
        // set storage already done above; now replace url
        const newPath = '/' + newLang + (location.pathname === '/' ? '' : location.pathname);
        const newUrl = newPath + location.search + location.hash;
        history.replaceState({ lang: newLang, fromLangChange: true }, document.title, newUrl);
        recordNavLangForPath(newPath + location.search, newLang, 'languageChangeEvent-replace');
      }
      if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, newLang);
    } catch (err) {}
  }

  // Storage events (cross-tab)
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

  // INITIAL ENFORCE: run IMMEDIATELY when script parsed so language.min.js sees correct storage & URL
  function initialEnforceImmediate() {
    try {
      const urlLang = getLangFromPath(location.pathname);
      if (urlLang) {
        // record and treat as user selection (manual prefix) — set storage & last-change immediately
        recordNavLangForPath(pathKeyForLocation(location), urlLang, 'initial-url');
        setLastChangeImmediate(urlLang, 'initial-url');
        setStoredLangImmediate(urlLang, 'initial-url');
        if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, urlLang);
        return;
      }
      // No prefix — prefer lastChange -> stored -> default
      const last = getLastChange();
      const stored = getStoredLang();
      const chosen = (last && last.lang) ? last.lang : (stored || DEFAULT_LANG);
      // set storage & last-change early and replace URL
      ensureUrlHasPrefixImmediate(chosen);
      if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, chosen);
    } catch (e) {}
  }

  // Wiring: navigation events
  window.addEventListener('popstate', function(ev) { onNavigationEvent(ev); });
  window.addEventListener('fv:history', function(ev) { setTimeout(() => onNavigationEvent(ev), 0); });
  window.addEventListener('pageshow', function(ev) { setTimeout(() => onNavigationEvent(ev), 0); });
  window.addEventListener('languageChange', onLanguageChangeEvent, false);
  window.addEventListener('storage', onStorageEvent, false);

  // Run initial enforcement immediately (synchronous)
  initialEnforceImmediate();

  // Expose small API for debug
  window.FVLangCoordinator = {
    ensureUrlHasPrefixImmediate,
    recordNavLangForPath,
    loadNavMap,
    saveNavMap,
    getLastChange
  };

})();