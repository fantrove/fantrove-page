/**
 * lang-coordinator.js v1.0
 *
 * จุดประสานกลางสำหรับการจัดการภาษา / URL prefix / history navigation
 *
 * หน้าที่หลัก:
 *  - ดักจับ history.pushState / replaceState แล้วส่ง event 'fv:history'
 *  - ฟัง popstate / pageshow / storage events
 *  - เมื่อตรวจพบ navigation แบบย้อนกลับ (popstate) ให้ดู mapping (sessionStorage 'fv-nav-lang-map')
 *    แล้วแก้ URL ให้มี prefix ที่สอดคล้องกับภาษาใน mapping (replaceState)
 *  - ฟัง event 'languageChange' ที่ language manager ส่งมา (หรือ localStorage change)
 *    เพื่อบันทึก mapping ของ URL ปัจจุบัน -> language และปรับ URL ให้มี prefix ถ้าจำเป็น
 *  - บังคับ: ถ้า URL ปัจจุบันไม่มี prefix ให้เติม prefix จาก selectedLang และ replaceState (ไม่ reload)
 *
 * ติดตั้ง: ให้โหลดไฟล์นี้ใน <head> หลัง lang-proxy.js และ lang-sync.js แต่ก่อน language.min.js
 */

(function() {
  "use strict";

  const LS_KEY = 'selectedLang';
  const NAV_MAP_KEY = 'fv-nav-lang-map'; // sessionStorage map: { "<path+search>": {lang, ts, source} }
  const SUPPORTED_LANGS = ['en', 'th'];
  const DEFAULT_LANG = 'en';

  // Helper: parse lang from path
  function getLangFromPath(path) {
    const m = path.match(/^\/(en|th)(\/|$)/);
    return m ? m[1] : null;
  }

  function hasLangPrefix(path) {
    return /^\/(en|th)(\/|$)/.test(path);
  }

  function shouldPrefixPath(path) {
    if (!path.startsWith('/')) return false;
    // reuse same skip list as lang-links if present
    const SKIP_PATHS = window.FVLangLinks ? ['/assets/', '/static/', '/api/', '/_next/', '/favicon.ico', '/robots.txt', '/sitemap.xml', '/sw.js', '/manifest.json', '/.well-known/'] : ['/assets/'];
    for (const skip of SKIP_PATHS) {
      if (path.startsWith(skip)) return false;
    }
    return true;
  }

  function addLangPrefixToHref(href, lang) {
    if (!window.FVLangLinks) return href;
    return window.FVLangLinks.addLangPrefix(href, lang);
  }

  function getStoredLang() {
    try {
      const l = localStorage.getItem(LS_KEY);
      return SUPPORTED_LANGS.includes(l) ? l : null;
    } catch (e) {
      return null;
    }
  }

  function setStoredLang(lang) {
    try {
      if (!SUPPORTED_LANGS.includes(lang)) return;
      localStorage.setItem(LS_KEY, lang);
      // Also broadcast an event for same-tab listeners
      window.dispatchEvent(new CustomEvent('languageChange', { detail: { language: lang } }));
    } catch (e) {}
  }

  function loadNavMap() {
    try {
      return JSON.parse(sessionStorage.getItem(NAV_MAP_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function saveNavMap(map) {
    try {
      sessionStorage.setItem(NAV_MAP_KEY, JSON.stringify(map));
    } catch (e) {}
  }

  function recordNavLangForPath(pathKey, lang, source='coordinator') {
    try {
      const map = loadNavMap();
      map[pathKey] = { lang: lang, ts: Date.now(), source };
      saveNavMap(map);
    } catch (e) {}
  }

  function pathKeyForLocation(loc) {
    return (loc.pathname || '') + (loc.search || '');
  }

  // Monkeypatch history methods to emit event
  (function() {
    const origPush = history.pushState;
    history.pushState = function(state, title, url) {
      const result = origPush.apply(this, arguments);
      try {
        window.dispatchEvent(new CustomEvent('fv:history', { detail: { method: 'pushState', state: state, url: url } }));
      } catch (e) {}
      return result;
    };
    const origReplace = history.replaceState;
    history.replaceState = function(state, title, url) {
      const result = origReplace.apply(this, arguments);
      try {
        window.dispatchEvent(new CustomEvent('fv:history', { detail: { method: 'replaceState', state: state, url: url } }));
      } catch (e) {}
      return result;
    };
  })();

  // Replace current URL path to include lang prefix (without reload)
  function ensureUrlHasPrefix(lang) {
    try {
      const loc = location;
      if (!shouldPrefixPath(loc.pathname)) return; // don't touch
      const currentLang = getLangFromPath(loc.pathname);
      if (currentLang === lang) return; // already OK

      // Build new pathname
      const newPath = '/' + lang + (loc.pathname === '/' ? '' : loc.pathname);
      const newUrl = newPath + loc.search + loc.hash;

      // Replace state (no reload)
      history.replaceState({ lang: lang, forced: true }, document.title, newUrl);
      // record mapping
      recordNavLangForPath(newPath + loc.search, lang, 'ensureUrlHasPrefix');
    } catch (e) {
      // If replace fails, fallback to hard redirect
      try {
        location.replace('/' + (lang || DEFAULT_LANG) + location.pathname + location.search + location.hash);
      } catch (err) {}
    }
  }

  // When navigation occurs (popstate or fv:history), decide whether to apply mapped language
  function onNavigationEvent(ev) {
    try {
      const loc = location;
      const key = pathKeyForLocation(loc);
      const map = loadNavMap();
      const mapped = map[key];
      const urlLang = getLangFromPath(loc.pathname);

      // If mapping exists for exact key, prefer mapped language (for back/forward)
      if (mapped && mapped.lang) {
        const desiredLang = mapped.lang;
        // If URL's prefix is different, replace URL to match desiredLang
        if (urlLang !== desiredLang && shouldPrefixPath(loc.pathname)) {
          const newPath = '/' + desiredLang + (loc.pathname === '/' ? '' : loc.pathname);
          const newUrl = newPath + loc.search + loc.hash;
          history.replaceState({ lang: desiredLang, restored: true }, document.title, newUrl);
          // update stored lang if different
          if (getStoredLang() !== desiredLang) {
            setStoredLang(desiredLang);
          }
          // update links on page
          if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, desiredLang);
        } else {
          // URL already consistent; ensure stored lang is same
          if (getStoredLang() !== desiredLang) {
            setStoredLang(desiredLang);
            if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, desiredLang);
          }
        }
        return;
      }

      // No mapping — fallback behavior:
      // If URL has lang prefix, adopt URL language (and record mapping)
      if (urlLang) {
        recordNavLangForPath(key, urlLang, 'url-prefix');
        if (getStoredLang() !== urlLang) {
          setStoredLang(urlLang);
          if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, urlLang);
        }
        return;
      }

      // If no prefix in URL, enforce storedLang
      const stored = getStoredLang() || DEFAULT_LANG;
      ensureUrlHasPrefix(stored);
      if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, stored);
    } catch (e) {
      // ignore
    }
  }

  // React when language changes in-page (language manager should dispatch 'languageChange' with detail.language)
  function onLanguageChangeEvent(e) {
    try {
      const newLang = e.detail && e.detail.language ? e.detail.language : getStoredLang();
      if (!newLang) return;
      // record nav mapping for current path (map current URL to this language)
      const currentKey = pathKeyForLocation(location);
      recordNavLangForPath(currentKey, newLang, 'languageChangeEvent');

      // update storedLang (also triggers languageChange for same-tab)
      if (getStoredLang() !== newLang) {
        localStorage.setItem(LS_KEY, newLang);
      }

      // ensure the URL prefix matches the new language
      const urlLang = getLangFromPath(location.pathname);
      if (urlLang !== newLang && shouldPrefixPath(location.pathname)) {
        // Use replaceState (do not reload)
        const newPath = '/' + newLang + (location.pathname === '/' ? '' : location.pathname);
        const newUrl = newPath + location.search + location.hash;
        history.replaceState({ lang: newLang, fromLangChange: true }, document.title, newUrl);
        recordNavLangForPath(newPath + location.search, newLang, 'languageChangeEvent-replace');
      }

      // update links
      if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, newLang);
    } catch (err) {}
  }

  // Listen cross-tab/localStorage changes
  function onStorageEvent(e) {
    try {
      if (!e) return;
      if (e.key === LS_KEY) {
        const newLang = e.newValue;
        if (!newLang) return;
        // Update links and URL if needed
        if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, newLang);
        // Ensure URL has prefix
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
      }
    } catch (e) {}
  }

  // When the page first loads, ensure URL has prefix (cooperate with lang-proxy which normally redirects early)
  function initialEnforce() {
    try {
      const urlLang = getLangFromPath(location.pathname);
      if (urlLang) {
        // record mapping for current path
        recordNavLangForPath(pathKeyForLocation(location), urlLang, 'initial-url');
        // sync storage
        if (getStoredLang() !== urlLang) setStoredLang(urlLang);
        if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, urlLang);
        return;
      }

      // No prefix in URL — try to enforce storedLang or fallback detect
      const stored = getStoredLang() || DEFAULT_LANG;
      ensureUrlHasPrefix(stored);
      if (window.FVLangLinks) window.FVLangLinks.updateAllLinks(document, stored);
    } catch (e) {}
  }

  // Wiring
  window.addEventListener('popstate', function(ev) {
    onNavigationEvent(ev);
  });

  window.addEventListener('fv:history', function(ev) {
    // pushState/replaceState origin — treat as navigation event (e.g. SPA click)
    // Small delay to let location update
    setTimeout(() => onNavigationEvent(ev), 0);
  });

  window.addEventListener('pageshow', function(ev) {
    // pageshow can indicate bfcache restore — ensure consistency
    setTimeout(() => onNavigationEvent(ev), 0);
  });

  window.addEventListener('languageChange', onLanguageChangeEvent, false);

  window.addEventListener('storage', onStorageEvent, false);

  // page initial
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialEnforce);
  } else {
    initialEnforce();
  }

  // Expose small API for debugging
  window.FVLangCoordinator = {
    ensureUrlHasPrefix,
    recordNavLangForPath,
    loadNavMap,
    saveNavMap
  };

})();