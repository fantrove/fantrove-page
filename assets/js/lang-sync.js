/* assets/js/lang-sync.js
   URL Sync Manager
   - Sync address bar with localStorage.selectedLang / window.languageManager
   - Try to avoid reloads: use history.replaceState when page content already matches selectedLang
   - If server-side prefixed resource is required, perform coordinated location.replace using fv-forcereload/fv-reload-inflight/fv-reload-ack
   - Run on load, languageChange, storage, popstate, visibility/focus
*/
(function() {
  'use strict';

  // ========== Config / helpers ==========
  function isLocalDev() {
    try {
      const host = location.hostname || '';
      if (!host) return false;
      if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return true;
      if (host.endsWith('.local')) return true;
      return false;
    } catch (e) { return false; }
  }

  function getSelectedLang() {
    try { return localStorage.getItem('selectedLang'); } catch (e) { return null; }
  }

  function pathHasLangPrefix(path) {
    if (!path) path = location.pathname;
    const m = (path || '').match(/^\/(en|th)(\/|$)/);
    return m ? m[1] : null;
  }

  function stripLangPrefix(path) {
    if (!path) path = location.pathname;
    const m = path.match(/^\/(en|th)(\/.*|$)/);
    if (!m) return path || '/';
    let t = m[2] || '/';
    if (!t.startsWith('/')) t = '/' + t;
    return t || '/';
  }

  function normalizePathForCandidates(t) {
    if (!t || t === '') return '/';
    return t;
  }

  function buildPrefixedCandidatesForPath(rawPath, lang) {
    // mirrors logic used in lang-proxy.js / lang-links.js but focused on prefixed candidates
    const t = normalizePathForCandidates(rawPath === '/' ? '/' : rawPath);
    const pref = '/' + lang;
    const candidates = new Set();
    if (t === '/' || t === '') {
      candidates.add(pref + '/');
      candidates.add(pref + '/home/');
      candidates.add(pref + '/home/index.html');
      candidates.add(pref + '/index.html');
    } else {
      if (t.endsWith('/')) {
        candidates.add(pref + t);
        candidates.add(pref + t + 'index.html');
      } else {
        candidates.add(pref + t);
        candidates.add(pref + t + '/index.html');
      }
    }
    // add home variants
    candidates.add(pref + '/home/');
    candidates.add(pref + '/home/index.html');
    return Array.from(candidates);
  }

  // small HEAD check with timeout
  function headCheck(url, timeout = 3000) {
    return new Promise((resolve) => {
      const controller = ('AbortController' in window) ? new AbortController() : null;
      const signal = controller ? controller.signal : undefined;
      let done = false;
      fetch(url, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin', signal }).then(resp => {
        if (done) return;
        done = true;
        resolve(resp && resp.ok);
      }).catch(() => {
        if (done) return;
        done = true;
        resolve(false);
      });
      if (controller) setTimeout(() => { if (!done) { done = true; try { controller.abort(); } catch (e){} resolve(false); } }, timeout);
      else setTimeout(() => { if (!done) { done = true; resolve(false); } }, timeout);
    });
  }

  // coordination markers (same pattern used elsewhere)
  function genReloadId() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,9); }
  function setForceReloadMarker(source) {
    try {
      const id = genReloadId();
      const marker = { id: id, ts: Date.now(), source: source || 'lang-sync' };
      sessionStorage.setItem('fv-forcereload', JSON.stringify(marker));
      return marker;
    } catch (e) { return null; }
  }
  function setInflight(id) { try { if (!id) return; sessionStorage.setItem('fv-reload-inflight', id); } catch (e){} }
  function ackReload(id) { try { if (!id) return; sessionStorage.setItem('fv-reload-ack', id); try{ sessionStorage.removeItem('fv-reload-inflight'); sessionStorage.removeItem('fv-forcereload'); }catch(e){} } catch(e){} }

  function recordNavLangMap(path, lang, evidence) {
    try {
      const tmp = new URL(path, location.origin);
      const key = tmp.pathname + (tmp.search || '');
      const raw = sessionStorage.getItem('fv-nav-lang-map') || '{}';
      const map = JSON.parse(raw || '{}');
      map[key] = { lang, ts: Date.now(), evidence: evidence || 'sync' };
      sessionStorage.setItem('fv-nav-lang-map', JSON.stringify(map));
    } catch (e) {}
  }

  function getPredictedLangFromSession(path) {
    try {
      const raw = sessionStorage.getItem('fv-nav-lang-map') || '{}';
      const map = JSON.parse(raw || '{}');
      const key = (new URL(path, location.origin)).pathname + ((new URL(path, location.origin)).search || '');
      if (map[key] && map[key].lang) return map[key].lang;
      return null;
    } catch (e) { return null; }
  }

  function currentDocumentLanguage() {
    try {
      const docLang = (document && document.documentElement && document.documentElement.getAttribute('lang')) || '';
      if (docLang) return docLang.split('-')[0];
      // try languageManager if present
      if (window.languageManager && window.languageManager.selectedLang) return window.languageManager.selectedLang;
      return null;
    } catch (e) { return null; }
  }

  // apply address bar change without reload (replaceState)
  function applyReplaceToPrefixed(prefPath) {
    try {
      const urlObj = new URL(prefPath, location.origin);
      urlObj.search = location.search || '';
      urlObj.hash = location.hash || '';
      history.replaceState(history.state, '', urlObj.toString());
      // record map so prediction works for future
      recordNavLangMap(urlObj.pathname + (urlObj.search || ''), getSelectedLang() || '', 'sync-replace');
    } catch (e) {}
  }

  // coordinated navigation to prefixed URL (perform replace to fetch host prefixed variant)
  function coordinatedNavigateTo(prefPath) {
    try {
      const urlObj = new URL(prefPath, location.origin);
      urlObj.search = location.search || '';
      urlObj.hash = location.hash || '';
      const marker = setForceReloadMarker('lang-sync');
      if (marker && marker.id) setInflight(marker.id);
      location.replace(urlObj.toString());
    } catch (e) {
      try { location.replace(prefPath); } catch (e2) {}
    }
  }

  // decide whether we can safely change address bar without reload:
  // - if document indicates current selected language equals desiredLang (documentElement.lang or languageManager), then safe
  function canApplyUrlReplaceWithoutReload(desiredLang) {
    try {
      if (!desiredLang) return false;
      if (isLocalDev()) return false; // be conservative on dev hosts
      const docLang = currentDocumentLanguage();
      if (docLang && docLang === desiredLang) return true;
      // fallback: if languageManager exists and has data loaded & selectedLang == desiredLang
      if (window.languageManager && window.languageManager.selectedLang === desiredLang && window.languageManager.isInitialized) return true;
      return false;
    } catch (e) { return false; }
  }

  // main sync function
  let syncInFlight = false;
  async function syncUrlWithSelectedLang(opts) {
    opts = opts || {};
    if (syncInFlight && !opts.force) return;
    syncInFlight = true;
    try {
      const desired = getSelectedLang();
      if (!desired) { syncInFlight = false; return; }
      if (isLocalDev()) { syncInFlight = false; return; } // do not aggressively promote on dev hosts

      const currentPrefix = pathHasLangPrefix(location.pathname);
      const currPathStripped = stripLangPrefix(location.pathname);
      // if already prefixed correctly -> ensure mapping recorded and bail out
      if (currentPrefix && currentPrefix === desired) {
        recordNavLangMap(location.pathname + (location.search||''), desired, 'sync-ok');
        syncInFlight = false; return;
      }

      // If page already represents desiredLang, replace address bar without reload
      if (canApplyUrlReplaceWithoutReload(desired)) {
        // build a canonical prefixed path (use stripped path if we have it)
        const pref = '/' + desired + (currPathStripped === '/' ? '/' : currPathStripped);
        applyReplaceToPrefixed(pref);
        syncInFlight = false; return;
      }

      // If not safe to replace without reload -> check if server has a prefixed resource
      const candidates = buildPrefixedCandidatesForPath(currPathStripped, desired);
      for (const c of candidates) {
        try {
          const ok = await headCheck(c, 2000);
          if (ok) {
            // navigate to prefixed resource (coordinated)
            coordinatedNavigateTo(c);
            syncInFlight = false; return;
          }
        } catch (e) { /* try next */ }
      }

      // nothing found -> no-op; we keep unprefixed page. But record mapping that this unprefixed path is associated with desiredLang for prediction on future navigations
      try { recordNavLangMap(location.pathname + (location.search||''), desired, 'sync-fallback'); } catch (e) {}
    } catch (e) {
      // swallow to avoid breaking page
    } finally {
      syncInFlight = false;
    }
  }

  // ========== Event wiring ==========
  // run on initial load (DOM ready or load)
  function runInitialSync() {
    try { syncUrlWithSelectedLang(); } catch (e) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runInitialSync);
    window.addEventListener('load', runInitialSync);
  } else {
    runInitialSync();
  }

  // language change from languageManager
  window.addEventListener('languageChange', function(e) {
    try {
      // slight delay to let languageManager finish internal updates if called synchronously
      setTimeout(() => syncUrlWithSelectedLang({force:true}), 30);
    } catch (err) {}
  });

  // storage sync across tabs
  window.addEventListener('storage', function(e) {
    try {
      if (e.key === 'selectedLang' || e.key === 'langVersion') {
        syncUrlWithSelectedLang({force:true});
      }
    } catch (err) {}
  });

  // visibility/focus re-check
  function visibilityHandler() {
    try {
      if (document.visibilityState === 'visible') syncUrlWithSelectedLang();
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', visibilityHandler);
  window.addEventListener('focus', visibilityHandler);

  // popstate: try to predict language for new location; force sync if mismatch
  window.addEventListener('popstate', function(ev) {
    try {
      // if event.state has lang, prefer it
      const st = ev && ev.state && typeof ev.state === 'object' ? ev.state : null;
      if (st && st.lang) {
        // ensure localStorage matches - but do not overwrite if different source-of-truth is desired
        try { localStorage.setItem('selectedLang', st.lang); } catch (e) {}
        setTimeout(() => syncUrlWithSelectedLang({force:true}), 10);
        return;
      }
      // else try to use session prediction
      const predicted = getPredictedLangFromSession(location.pathname + (location.search||''));
      if (predicted) {
        try { localStorage.setItem('selectedLang', predicted); } catch (e) {}
        setTimeout(() => syncUrlWithSelectedLang({force:true}), 10);
        return;
      }
      // otherwise just re-sync
      setTimeout(() => syncUrlWithSelectedLang({force:true}), 10);
    } catch (e) {}
  });

  // expose for diagnostics
  window.langSync = {
    sync: syncUrlWithSelectedLang,
    canReplaceNoReload: canApplyUrlReplaceWithoutReload,
    isDev: isLocalDev
  };
})();