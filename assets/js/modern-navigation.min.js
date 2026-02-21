/**
 * ModernNavigation - Hardened Edition (Resilience, HealthChecks, Defensive Init)
 * - More robust init, CSS load timeout/retry, periodic health-check & auto-recover
 * - Defensive wrappers around storage, broadcast, fetch, and DOM operations
 * - Throttled sync and active-state updates to reduce races on fast hosts (Cloudflare Pages)
 *
 * Replacement for previous modern-navigation.min.js. Place in assets/js/.
 */
 /* --- [BEGIN: Wave Effect Loader] --- */
(function() {
  var waveScriptSrc = "https://marcumat-js.pages.dev/dist/wave-effect.js";
  if (!document.querySelector('script[src="' + waveScriptSrc + '"]')) {
    var script = document.createElement('script');
    script.src = waveScriptSrc;
    script.async = true;
    document.head.appendChild(script);
  }
})();
/* --- [END: Wave Effect Loader] --- */

(function () {
  // --- Feature detection / helpers ---
  const SUPPORTS_BC = (function () { try { return typeof BroadcastChannel !== 'undefined'; } catch (e) { return false; } })();
  const NOW = () => Date.now();

  function safeJSONParse(s, fallback) { try { return JSON.parse(s || 'null') || fallback; } catch (e) { return fallback; } }

  // simple throttle
  function throttle(fn, wait) {
    let last = 0;
    let timeout = null;
    return function(...args) {
      const now = Date.now();
      const remaining = wait - (now - last);
      if (remaining <= 0) {
        if (timeout) { clearTimeout(timeout); timeout = null; }
        last = now;
        fn.apply(this, args);
      } else if (!timeout) {
        timeout = setTimeout(() => {
          last = Date.now();
          timeout = null;
          try { fn.apply(this, args); } catch (e) {}
        }, remaining);
      }
    };
  }

  // debounce
  function debounce(fn, wait) {
    let t = null;
    return function(...args) {
      if (t) clearTimeout(t);
      t = setTimeout(() => { try { fn.apply(this, args); } catch (e) {} }, wait);
    };
  }

  // --- EventBus: tiny pub/sub ---
  class EventBus {
    constructor() { this.listeners = new Map(); }
    on(event, fn) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event).push(fn);
      return () => this.off(event, fn);
    }
    off(event, fn) {
      if (!this.listeners.has(event)) return;
      const arr = this.listeners.get(event).filter(x => x !== fn);
      if (arr.length) this.listeners.set(event, arr); else this.listeners.delete(event);
    }
    emit(event, detail) {
      const arr = this.listeners.get(event);
      if (!arr || !arr.length) return;
      arr.slice().forEach(fn => { try { fn(detail); } catch (e) {} });
    }
  }

  // --- StorageAPI: safe wrappers ---
  class StorageAPI {
    static getLS(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
    static setLS(key, val) { try { localStorage.setItem(key, val); return true; } catch (e) { return false; } }
    static removeLS(key) { try { localStorage.removeItem(key); return true; } catch (e) { return false; } }
    static getSS(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
    static setSS(key, val) { try { sessionStorage.setItem(key, val); return true; } catch (e) { return false; } }
  }

  // --- NavConfigLoader ---
  class NavConfigLoader {
    constructor(configPath) { this.configPath = configPath || '/assets/json/template/template.min.json'; this._cached = null; this._loading = false; }
    async load(force = false) {
      if (this._cached && !force) return this._cached;
      if (this._loading) {
        // wait briefly if concurrent
        await new Promise(r => setTimeout(r, 50));
        return this._cached || { navigation: [] };
      }
      this._loading = true;
      try {
        const res = await fetch(this.configPath, { cache: 'no-store', credentials: 'same-origin' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        this._cached = await res.json();
        return this._cached;
      } catch (e) {
        return { navigation: [] };
      } finally {
        this._loading = false;
      }
    }
  }

  // --- NavPrefixManager (centralized) ---
  class NavPrefixManager {
    constructor(options = {}) {
      this.defaultLang = options.defaultLang || 'en';
      this.supportedLangCodes = options.supportedLangCodes || ['th','en','ja','ko','zh','fr','de','es','it','pt','ru','ar','vi','id','ms','tl'];
      this.readSelectedLang = options.readSelectedLang || (() => {
        try { return localStorage.getItem('selectedLang') || this.defaultLang; } catch (e) { return this.defaultLang; }
      });
      this.isDevMode = !!options.isDevMode;
    }

    _isLangCode(segment) {
      return !!segment && this.supportedLangCodes.includes(segment.toLowerCase());
    }

    normalizePath(path) {
      if (!path) return '/';
      try {
        const withoutQueryHash = (path.split('?')[0] || '').split('#')[0];
        let p = withoutQueryHash.replace(/\/+/g, '/');
        if (!p.startsWith('/')) p = '/' + p;
        if (p !== '/' && p.endsWith('/')) p = p.replace(/\/+$/, '');
        return p || '/';
      } catch (e) { return path || '/'; }
    }

    parse(path) {
      const p = this.normalizePath(path);
      const segments = p.split('/').filter(Boolean);
      if (segments.length > 0 && this._isLangCode(segments[0])) {
        const lang = segments[0].toLowerCase();
        const clean = segments.length > 1 ? '/' + segments.slice(1).join('/') : '/';
        return { hasLangPrefix: true, lang, cleanPath: clean, originalPath: p };
      }
      return { hasLangPrefix: false, lang: null, cleanPath: p, originalPath: p };
    }

    // Add prefix using provided lang (explicit takes precedence). If none provided, use readSelectedLang()
    addPrefix(path, explicitLang = null) {
      const base = this.normalizePath(path);
      const parsed = this.parse(base);
      if (parsed.hasLangPrefix) return base;
      const lang = explicitLang || (this.readSelectedLang && this.readSelectedLang()) || this.defaultLang;
      if (this.isDevMode) return base;
      // ensure we don't create double slashes: '/en' + '/' => '/en/'
      return '/' + lang + (base === '/' ? '/' : (base.startsWith('/') ? base : '/' + base));
    }

    hasPrefix(path) { return this.parse(path).hasLangPrefix; }

    resolvePreferredLang(currentPath) {
      const parsed = this.parse(currentPath || (typeof window !== 'undefined' ? window.location.pathname : '/'));
      if (parsed.lang) return parsed.lang;
      const sel = this.readSelectedLang();
      return sel || this.defaultLang;
    }

    // Aggressive candidate generation (same deterministic order)
    buildCandidates(baseUrl) {
      const base = this.normalizePath(baseUrl);
      if (this.isDevMode) return [ base ];
      const parsedCurrent = this.parse(typeof window !== 'undefined' ? window.location.pathname : '/');
      const langs = [];
      if (parsedCurrent.lang) langs.push(parsedCurrent.lang);
      const sel = this.readSelectedLang();
      if (sel && !langs.includes(sel)) langs.push(sel);
      if (this.defaultLang && !langs.includes(this.defaultLang)) langs.push(this.defaultLang);
      const uniq = Array.from(new Set(langs));
      const out = [];
      uniq.forEach(lang => {
        const pref = '/' + lang;
        const c1 = pref + base;
        out.push(c1, c1.endsWith('/') ? c1 + 'index.html' : c1 + '/index.html');
        if (!c1.endsWith('/')) out.push(c1 + '/');
      });
      out.push(base, base.endsWith('/') ? base + 'index.html' : base + '/index.html');
      if (base === '/' || base === '/index.html') {
        uniq.forEach(lang => { out.push('/' + lang + '/home/'); out.push('/' + lang + '/home/index.html'); });
        out.push('/home/'); out.push('/home/index.html');
      }
      const seen = new Set(); const res = [];
      for (const c of out) { if (!seen.has(c)) { seen.add(c); res.push(c); } }
      return res;
    }
  }

  // --- NavRenderer: DOM creation & updates ---
  class NavRenderer {
    constructor(options = {}) {
      this.itemClass = options.itemClass || 'nav-item';
      this.labelClass = options.labelClass || 'label';
      this.svgWrapperClass = options.svgWrapperClass || 'svg-wrapper';
      this.defaultButtonClass = options.defaultButtonClass || 'default-button';
    }

    createFragment(navConfig, currentLang, navPrefixManager) {
      const frag = document.createDocumentFragment();
      const list = Array.isArray(navConfig) ? navConfig : [];
      list.forEach(item => {
        try {
          const a = document.createElement('a');
          a.className = `${this.itemClass} ${item.customClass || this.defaultButtonClass}`;
          a.setAttribute('role', 'menuitem');
          const baseUrl = item.go_url || item.url || '/';
          a.dataset.baseUrl = baseUrl;
          if (item.url) a.dataset.link = item.url;
          if (item.go_url) a.dataset.goUrl = item.go_url;
          a.dataset.isExternal = (baseUrl.startsWith('http') || baseUrl.startsWith('//')) ? 'true' : 'false';
          // initial href uses explicit stored lang to be authoritative
          try {
            const storedLang = (function(){ try { return localStorage.getItem('selectedLang'); } catch (e) { return null; } })();
            a.href = navPrefixManager.addPrefix(baseUrl, storedLang || navPrefixManager.defaultLang);
          } catch (e) { a.href = baseUrl; }
          a.setAttribute('wave-delegate', `.${this.svgWrapperClass}`);
          if (item.icon) {
            const tmp = document.createElement('div'); tmp.innerHTML = item.icon;
            const wrap = document.createElement('span'); wrap.className = this.svgWrapperClass; wrap.setAttribute('wave', '');
            while (tmp.firstChild) wrap.appendChild(tmp.firstChild);
            a.appendChild(wrap);
          }
          const lbl = document.createElement('div'); lbl.className = this.labelClass;
          try { lbl.textContent = item[`${currentLang}_label`] || item.en_label || 'Missing Label'; } catch (e) { lbl.textContent = item.en_label || 'Missing Label'; }
          a.appendChild(lbl);
          frag.appendChild(a);
        } catch (e) {
          // continue building other items even if one fails
        }
      });
      return frag;
    }

    createNavElement(fragment) {
      const nav = document.createElement('div');
      nav.className = 'bottom-nav';
      nav.setAttribute('role', 'navigation');
      // to reduce layout flash, hide initially and reveal after CSS loaded
      nav.style.visibility = 'hidden';
      nav.appendChild(fragment);
      return nav;
    }

    mount(navEl) {
      if (!navEl) return;
      try {
        // ensure document.body exists
        if (!document.body) {
          // schedule mount when body is ready
          document.addEventListener('DOMContentLoaded', () => {
            try { if (!document.querySelector('.bottom-nav')) document.body.insertBefore(navEl, document.body.firstChild); } catch (e) {}
          }, { once: true });
          return;
        }
        if (document.querySelector('.bottom-nav')) return;
        document.body.insertBefore(navEl, document.body.firstChild);
      } catch (e) {}
    }

    unmount() {
      try {
        const el = document.querySelector('.bottom-nav');
        if (el && el.parentNode) el.parentNode.removeChild(el);
      } catch (e) {}
    }

    getNavElement() { try { return document.querySelector('.bottom-nav'); } catch (e) { return null; } }

    getItems() {
      const nav = this.getNavElement();
      try { return nav ? Array.from(nav.querySelectorAll('.' + this.itemClass)) : []; } catch (e) { return []; }
    }

    updateHref(itemEl, href) { try { if (itemEl && itemEl.href !== href) itemEl.href = href; } catch (e) {} }
    updateLabel(itemEl, text) { try { const l = itemEl.querySelector('.' + this.labelClass); if (l) l.textContent = text; } catch (e) {} }

    // reveal nav (used after CSS loaded)
    reveal(navEl) { try { if (!navEl) navEl = this.getNavElement(); if (navEl) { navEl.style.visibility = ''; } } catch (e) {} }
  }

  // --- NavController: orchestrates behavior, ensures stored-lang authoritative ---
  class NavController {
    constructor(opts = {}) {
      this.cssPath = opts.cssPath || '/assets/css/modern-styles.min.css';
      this.configPath = opts.configPath || '/assets/json/template/template.min.json';
      this.defaultLang = opts.defaultLang || 'en';
      this.supportedLangCodes = opts.supportedLangCodes || ['th','en','ja','ko','zh','fr','de','es','it','pt','ru','ar','vi','id','ms','tl'];
      this.eventBus = new EventBus();
      this.configLoader = new NavConfigLoader(this.configPath);
      this.navPrefixManager = new NavPrefixManager({
        defaultLang: this.defaultLang,
        supportedLangCodes: this.supportedLangCodes,
        readSelectedLang: () => { try { return localStorage.getItem('selectedLang'); } catch (e) { return null; } },
        isDevMode: NavController._isLocalDev()
      });
      this.navRenderer = new NavRenderer({ defaultButtonClass: opts.defaultButtonClass || 'default-button' });
      this.isDevMode = NavController._isLocalDev();
      this._initialized = false;
      this._navEl = null;

      // bindings
      this._onClickBound = this._onClick.bind(this);
      this._onScrollBound = throttle(this._onScrollForActiveState.bind(this), 120);
      this._onStorageBound = this._onStorageEvent.bind(this);
      this._onPopStateBound = this._onPopState.bind(this);
      this._onLangChangedBound = this._onLangChanged.bind(this);

      // BroadcastChannel
      try { this._bc = SUPPORTS_BC ? new BroadcastChannel('fv-lang') : null; } catch (e) { this._bc = null; }
      if (this._bc) this._bc.onmessage = (ev) => { try { if (ev && ev.data && ev.data.lang) this._onLangChanged(ev.data.lang); } catch (e) {} };

      // session prediction window sizes
      this.RECENT_WINDOW_MS = 45000; // 45s recent heuristic

      // Health-check & recovery
      this._healthInterval = null;
      this._healthChecksRun = 0;
      this._maxInitRetries = 4;
      this._initAttempt = 0;

      // throttle heavy syncs
      this.syncAllToStoredLang = throttle(this.syncAllToStoredLang.bind(this), 200);
      this._updateActiveState = throttle(this._updateActiveState.bind(this), 150);

      // debounce mutation heavy updates
      this._updateLinksIn = debounce(this._updateLinksIn.bind(this), 120);
    }

    static _isLocalDev() {
      try {
        const host = location.hostname || '';
        if (!host) return false;
        if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return true;
        if (host.endsWith('.local')) return true;
        if (location.port && ['3000','5173','7700','8080','3001'].includes(String(location.port))) return true;
        if (location.protocol === 'file:') return true;
        return false;
      } catch (e) { return false; }
    }

    async init() {
      if (this._initialized) return;
      this._initAttempt++;
      try {
        // Wait for DOM to be ready (but don't block forever)
        await this._ensureDOMReady(2500);

        // Ensure CSS loaded with timeout and fallback behaviour
        await this._ensureCSSWithTimeout(2500);

        const cfg = await this.configLoader.load();
        const storedLang = this._readStoredLang() || this.defaultLang;
        const frag = this.navRenderer.createFragment(cfg.navigation || [], storedLang, this.navPrefixManager);
        const navEl = this.navRenderer.createNavElement(frag);
        // mount defensively
        this.navRenderer.mount(navEl);
        this._navEl = this.navRenderer.getNavElement();

        // bind events
        this._bind();
        this._initialized = true;
        this._initAttempt = 0;

        // initial sync
        this.syncAllToStoredLang();
        this._updateActiveState();
        this._applyScreenBehavior();

        // make nav visible after CSS load or after small delay to avoid flash
        setTimeout(() => { try { this.navRenderer.reveal(this._navEl); } catch (e) {} }, 120);

        // start health checks
        this._startHealthChecks();
      } catch (e) {
        // if init failed, schedule a retry with exponential backoff (but limited)
        if (this._initAttempt <= this._maxInitRetries) {
          const backoff = 200 * Math.pow(2, this._initAttempt);
          setTimeout(() => { this.init().catch(() => {}); }, backoff);
        } else {
          // final fallback: ensure minimal mount to avoid missing UI entirely
          try {
            const frag = this.navRenderer.createFragment([], this.defaultLang, this.navPrefixManager);
            const navEl = this.navRenderer.createNavElement(frag);
            this.navRenderer.mount(navEl);
            this._navEl = this.navRenderer.getNavElement();
            this._bind();
            this._initialized = true;
            this._startHealthChecks();
          } catch (err) {}
        }
      }
    }

    _ensureDOMReady(timeoutMs = 2000) {
      return new Promise(resolve => {
        if (document.readyState === 'complete' || document.readyState === 'interactive') return resolve();
        let done = false;
        function finish() { if (done) return; done = true; resolve(); }
        document.addEventListener('DOMContentLoaded', finish, { once: true });
        setTimeout(finish, timeoutMs);
      });
    }

    _ensureCSSWithTimeout(timeoutMs = 2000) {
      return new Promise(resolve => {
        try {
          if (!this.cssPath) return resolve();
          // already loaded?
          if (document.querySelector(`link[href="${this.cssPath}"]`)) return resolve();
          const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = this.cssPath; document.head.appendChild(link);
          let settled = false;
          function done() { if (settled) return; settled = true; resolve(); }
          link.onload = done;
          link.onerror = done;
          setTimeout(done, timeoutMs);
        } catch (e) { resolve(); }
      });
    }

    _bind() {
      try {
        if (!this._navEl) return;
        // prevent duplicate bindings
        if (this._bound) return;
        this._navEl.addEventListener('click', this._onClickBound, { passive: false });
        window.addEventListener('scroll', this._onScrollBound, { passive: true });
        window.addEventListener('storage', this._onStorageBound);
        window.addEventListener('popstate', this._onPopStateBound);
        window.addEventListener('languageChange', (e) => { try { if (e?.detail?.language) this._onLangChanged(e.detail.language); } catch (e) {} });

        // MutationObserver to update dynamically added links according to stored lang right away
        try {
          this._mo = new MutationObserver(muts => {
            try {
              muts.forEach(m => {
                m.addedNodes.forEach(node => { if (node && node.nodeType === 1) this._updateLinksIn(node); });
              });
            } catch (e) {}
          });
          this._mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
        } catch (e) {}

        this._bound = true;
      } catch (e) {}
    }

    _unbind() {
      try {
        if (!this._bound) return;
        if (this._navEl) this._navEl.removeEventListener('click', this._onClickBound, { passive: false });
        window.removeEventListener('scroll', this._onScrollBound);
        window.removeEventListener('storage', this._onStorageBound);
        window.removeEventListener('popstate', this._onPopStateBound);
        if (this._mo) this._mo.disconnect();
        if (this._bc) try { this._bc.close(); } catch (e) {}
        this._bound = false;
      } catch (e) {}
    }

    _readStoredLang() { try { return localStorage.getItem('selectedLang'); } catch (e) { return null; } }
    _writeStoredLang(lang) { try { localStorage.setItem('selectedLang', lang); } catch (e) {} }

    // Heuristic prediction using sessionStorage 'fv-nav-lang-map' and 'fv-lang-recent'
    getPredictedLangForPath(path) {
      try {
        if (!path) return null;
        const tmp = new URL(path, location.origin);
        const pathname = tmp.pathname || '/';
        const search = tmp.search || '';
        const exact = pathname + search;
        const raw = sessionStorage.getItem('fv-nav-lang-map') || '{}';
        const map = safeJSONParse(raw, {});

        // 1) exact match
        if (map[exact] && map[exact].lang) return map[exact].lang;

        // helper variants
        const variants = new Set();
        function addVariants(p, s) {
          let v = p;
          if (v.endsWith('/index.html')) v = v.slice(0, -11) || '/';
          if (v.endsWith('/home/index.html')) v = v.replace(/\/home\/index\.html$/, '/');
          if (v !== '/' && v.endsWith('/')) v = v.slice(0, -1);
          variants.add(v + s);
          variants.add(v + (s ? s : ''));
        }
        addVariants(pathname, search);

        // 2) normalized variants
        for (const v of variants) {
          if (map[v] && map[v].lang) return map[v].lang;
        }

        // 3) parent path fallback
        const parts = pathname.split('/').filter(Boolean);
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = '/' + parts.slice(0, i).join('/');
          const k1 = (p === '/' ? '/' : p) + '';
          if (map[k1] && map[k1].lang) return map[k1].lang;
          if (map[k1 + '/'] && map[k1 + '/'].lang) return map[k1 + '/'].lang;
        }

        // 4) recent language-change heuristic (45s window)
        try {
          const recentRaw = sessionStorage.getItem('fv-lang-recent') || '[]';
          const recent = safeJSONParse(recentRaw, []);
          if (Array.isArray(recent) && recent.length) {
            const now = Date.now();
            for (let i = recent.length - 1; i >= 0; i--) {
              const rec = recent[i];
              if (rec && rec.lang && (now - (rec.ts || 0) < this.RECENT_WINDOW_MS)) { return rec.lang; }
              if (now - (rec.ts || 0) > 120000) break;
            }
          }
        } catch (e) {}
        return null;
      } catch (e) { return null; }
    }

    // Update hrefs and labels to reflect stored-selected language (authoritative)
    async syncAllToStoredLang() {
      try {
        const storedLang = this._readStoredLang() || this.defaultLang;
        const items = this.navRenderer.getItems();
        items.forEach(it => {
          try {
            const base = it.dataset.baseUrl || it.dataset.goUrl || it.dataset.link;
            if (!base) return;
            if (it.dataset.isExternal === 'true') return;
            const newHref = this.navPrefixManager.addPrefix(base, storedLang);
            this.navRenderer.updateHref(it, newHref);
          } catch (e) {}
          // labels: try to update from cached config (if present)
          try {
            const cfgList = this.configLoader._cached && this.configLoader._cached.navigation ? this.configLoader._cached.navigation : [];
            const cfg = cfgList.find(n => (n.url === (it.dataset.link || '')) || (n.go_url === (it.dataset.goUrl || '')));
            if (cfg) {
              const newLabel = cfg[`${storedLang}_label`] || cfg.en_label || '';
              if (newLabel) this.navRenderer.updateLabel(it, newLabel);
            }
          } catch (e) {}
        });
      } catch (e) {}
    }

    // Update newly added DOM subtree links to match stored language immediately
    _updateLinksIn(root) {
      try {
        const anchors = root.querySelectorAll ? root.querySelectorAll('a[href]') : [];
        const storedLang = this._readStoredLang() || this.defaultLang;
        const SKIP_PREFIXES = ['/assets/', '/static/', '/api/', '/_next/', '/favicon.ico', '/robots.txt', '/sitemap.xml'];
        anchors.forEach(a => {
          try {
            const raw = a.getAttribute('href') || '';
            if (/^(mailto:|tel:|javascript:|#)/i.test(raw)) return;
            const url = new URL(raw, location.origin);
            if (url.origin !== location.origin) return;
            for (const p of SKIP_PREFIXES) if (url.pathname.startsWith(p)) return;
            if (this.navPrefixManager.hasPrefix(url.pathname)) {
              // If link already has prefix but not matching storedLang -> rewrite to storedLang
              const parsed = this.navPrefixManager.parse(url.pathname);
              if (parsed.hasLangPrefix && parsed.lang !== storedLang) {
                const newHref = this.navPrefixManager.addPrefix(parsed.cleanPath, storedLang) + url.search + url.hash;
                a.setAttribute('href', newHref);
              }
              return;
            }
            // add prefix using storedLang
            if (!this.isDevMode) {
              const newHref = this.navPrefixManager.addPrefix(url.pathname, storedLang) + url.search + url.hash;
              a.setAttribute('href', newHref);
            }
          } catch (e) {}
        });
      } catch (e) {}
    }

    // Click interception: attempt aggressive resolution only when appropriate
    _onClick(ev) {
      try {
        const anchor = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
        if (!anchor) return;
        const raw = anchor.getAttribute('href') || '';
        if (/^(mailto:|tel:|javascript:|#)/i.test(raw)) return;
        const url = new URL(raw, location.origin);
        if (url.origin !== location.origin) return;
        const path = url.pathname || '/';
        const SKIP_PREFIXES = ['/assets/', '/static/', '/api/', '/_next/', '/favicon.ico', '/robots.txt', '/sitemap.xml'];
        for (const p of SKIP_PREFIXES) if (path.startsWith(p)) return;

        // If anchor already has a prefix, but it differs from storedLang, prefer storedLang and navigate to that variant
        const storedLang = this._readStoredLang() || this.defaultLang;
        const parsed = this.navPrefixManager.parse(path);
        if (parsed.hasLangPrefix && parsed.lang !== storedLang) {
          // Prevent default and navigate to storedLang version of cleanPath preserving query/hash
          ev.preventDefault();
          try {
            const targetUrl = this.navPrefixManager.addPrefix(parsed.cleanPath, storedLang) + url.search + url.hash;
            window.location.assign(targetUrl);
            return;
          } catch (e) {}
        }

        // If link has no prefix and not in dev mode, intercept to try candidate resolution
        if (!parsed.hasLangPrefix && !this.isDevMode) {
          ev.preventDefault();
          // store click mapping for heuristics
          try {
            const key = path + (url.search || '');
            const rawMap = sessionStorage.getItem('fv-nav-lang-map') || '{}';
            const map = safeJSONParse(rawMap, {});
            map[key] = { lang: storedLang, ts: NOW(), evidence: 'click' };
            sessionStorage.setItem('fv-nav-lang-map', JSON.stringify(map));
          } catch (e) {}

          (async () => {
            const done = await this._attemptCandidates(path, ev);
            if (!done) {
              try { window.location.assign(anchor.href); } catch (e) { window.location.href = anchor.href; }
            }
          })();
        }
      } catch (e) {}
    }

    async _attemptCandidates(destPath, originalEvent) {
      if (this.isDevMode) return false;
      const candidates = this.navPrefixManager.buildCandidates(destPath);
      for (const c of candidates) {
        try {
          const resp = await fetch(c, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' });
          if (resp && resp.ok) {
            // found candidate
            const parsed = this.navPrefixManager.parse(c);
            if (parsed.hasLangPrefix) {
              try { this._writeStoredLang(parsed.lang); } catch (e) {}
              try {
                const rawMap = sessionStorage.getItem('fv-nav-lang-map') || '{}';
                const map = safeJSONParse(rawMap, {});
                map[parsed.originalPath] = { lang: parsed.lang, ts: NOW(), evidence: 'head-found' };
                sessionStorage.setItem('fv-nav-lang-map', JSON.stringify(map));
              } catch (e) {}
            }
            const urlObj = new URL(c, location.origin);
            // preserve original anchor's search/hash if present
            try {
              const linkEl = originalEvent && originalEvent.target && originalEvent.target.closest ? originalEvent.target.closest('a[href]') : null;
              if (linkEl) {
                const raw = linkEl.getAttribute('href') || '';
                const resolved = new URL(raw, location.origin);
                if (resolved.search) urlObj.search = resolved.search;
                if (resolved.hash) urlObj.hash = resolved.hash;
              }
            } catch (e) {}
            try { window.location.assign(urlObj.toString()); } catch (e) { window.location.href = urlObj.toString(); }
            return true;
          }
        } catch (e) {}
      }
      return false;
    }

    // popstate handling: authoritative stored-lang sync using history.state.lang -> session map -> localStorage
    _onPopState(ev) {
      try {
        // 1) prefer explicit state.lang
        let desiredLang = null;
        try {
          const st = ev && ev.state && typeof ev.state === 'object' ? ev.state : null;
          if (st && st.lang) desiredLang = st.lang;
        } catch (e) {}
        // 2) if not present, use session prediction for this path
        if (!desiredLang) {
          try {
            const predicted = this.getPredictedLangForPath(location.pathname + (location.search || ''));
            if (predicted) desiredLang = predicted;
          } catch (e) {}
        }
        // 3) fallback to stored localStorage.selectedLang
        const stored = this._readStoredLang() || this.defaultLang;
        if (!desiredLang) desiredLang = stored;

        // If desiredLang differs from stored -> write and trigger immediate sync
        if (desiredLang && desiredLang !== stored) {
          try { this._writeStoredLang(desiredLang); } catch (e) {}
          // Broadcast + languageChange custom event for in-page listeners
          try { if (this._bc) this._bc.postMessage({ lang: desiredLang, version: (Number(localStorage.getItem('langVersion')||0) + 1) }); } catch (e) {}
          try { window.dispatchEvent(new CustomEvent('languageChange', { detail: { language: desiredLang } })); } catch (e) {}
          // Immediately sync nav hrefs to desiredLang synchronously
          this.syncAllToStoredLang();
        } else {
          // still ensure hrefs reflect stored language
          this.syncAllToStoredLang();
        }
        // Update active state after sync
        this._updateActiveState();
      } catch (e) {}
    }

    // storage event cross-tab: authoritative localStorage.selectedLang
    _onStorageEvent(e) {
      try {
        if (e.key === 'selectedLang' || e.key === 'langVersion') {
          const newLang = localStorage.getItem('selectedLang') || this.defaultLang;
          // Immediately sync nav hrefs
          this.syncAllToStoredLang();
          // dispatch languageChange so other modules update
          try { window.dispatchEvent(new CustomEvent('languageChange', { detail: { language: newLang } })); } catch (e) {}
        }
      } catch (e) {}
    }

    // internal handler when lang changes (from BroadcastChannel or languageChange)
    _onLangChanged(lang) {
      if (!lang) return;
      const stored = this._readStoredLang();
      if (lang !== stored) {
        try { this._writeStoredLang(lang); } catch (e) {}
      }
      // immediate sync to stored lang
      this.syncAllToStoredLang();
      this._updateActiveState();
    }

    // scroll/active update
    _onScrollForActiveState() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._updateActiveState(); this._raf = null; });
    }

    _updateActiveState() {
      try {
        const items = this.navRenderer.getItems();
        const currentPath = window.location.pathname || '/';
        items.forEach(it => {
          try {
            const navLink = it.dataset.link || it.dataset.goUrl || it.dataset.baseUrl || '';
            const active = this._isNavLinkActive(navLink, currentPath);
            const was = it.classList.contains('active-1');
            it.classList.toggle('active-1', active);
            const wrap = it.querySelector('.svg-wrapper');
            if (wrap && active && !was) { wrap.classList.remove('animate'); void wrap.offsetWidth; wrap.classList.add('animate'); }
          } catch (e) {}
        });
      } catch (e) {}
    }

    _isNavLinkActive(navLink, currentPath) {
      if (!navLink) return false;
      const normNav = this.navPrefixManager.normalizePath(navLink);
      const parsedCur = this.navPrefixManager.parse(currentPath);
      const cleanCur = parsedCur.cleanPath;
      if (normNav === '/' || normNav === '/index.html') {
        return cleanCur === '/' || cleanCur === '/index.html' || (parsedCur.hasLangPrefix && parsedCur.cleanPath === '/');
      }
      if (cleanCur === normNav) return true;
      const navWith = normNav.endsWith('/') ? normNav : normNav + '/';
      const curWith = cleanCur.endsWith('/') ? cleanCur : cleanCur + '/';
      if (curWith.startsWith(navWith)) return true;
      return false;
    }

    // public method to force resync (useful externally)
    forceResyncToStoredLang() { this.syncAllToStoredLang(); this._updateActiveState(); }

    // Screen behavior (left rail / mobile)
    _applyScreenBehavior() {
      try {
        const nav = this._navEl;
        if (!nav) return;
        const isMobile = window.innerWidth < 768;
        nav.classList.toggle('vertical', !isMobile);
        if (isMobile) { this._unmountLeftRail(); this._enableMobileSync(); } else { this._mountLeftRail(); this._disableMobileSync(); }
      } catch (e) {}
    }

    _mountLeftRail() {
      try {
        if (!this._navEl) return;
        if (document.body.classList.contains('has-left-rail')) return;
        const nav = this._navEl;
        const siteMain = document.createElement('div'); siteMain.className = 'site-main';
        const nodes = Array.from(document.body.childNodes);
        for (const node of nodes) { if (node === nav) continue; siteMain.appendChild(node); }
        document.body.appendChild(siteMain);
        document.body.classList.add('has-left-rail');
        document.documentElement.style.setProperty('--left-rail-width', '88px');
        document.documentElement.style.setProperty('--left-rail-collapsed-width', '72px');
        nav.style.position = 'fixed'; nav.style.top = '0'; nav.style.left = '0'; nav.style.transform = 'none'; nav.style.zIndex = '1000';
        nav.style.height = '100vh'; nav.style.overflow = 'auto';
        siteMain.style.marginLeft = '88px';
      } catch (e) {}
    }

    _unmountLeftRail() {
      try {
        if (!this._navEl) return;
        if (!document.body.classList.contains('has-left-rail')) return;
        const nav = this._navEl;
        const siteMain = document.querySelector('.site-main');
        if (siteMain) {
          const children = Array.from(siteMain.childNodes);
          for (const c of children) document.body.insertBefore(c, siteMain);
          if (siteMain.parentNode) siteMain.parentNode.removeChild(siteMain);
        }
        document.body.classList.remove('has-left-rail');
        document.documentElement.style.removeProperty('--left-rail-width'); document.documentElement.style.removeProperty('--left-rail-collapsed-width');
        nav.style.position = ''; nav.style.top = ''; nav.style.height = ''; nav.style.left = ''; nav.style.transform = ''; nav.style.zIndex = ''; nav.style.overflow = '';
        const bodyChildren = Array.from(document.body.children);
        bodyChildren.forEach(el => { if (el.style && el.style.marginLeft === '88px') el.style.marginLeft = ''; });
      } catch (e) {}
    }

    _enableMobileSync() {
      try {
        if (this._mobileSyncEnabled) return;
        window.addEventListener('scroll', this._onMobileScrollBound = this._onMobileScroll.bind(this), { passive: true });
        window.addEventListener('touchstart', this._onTouchStartBound = this._onTouchStart.bind(this), { passive: true });
        window.addEventListener('touchend', this._onTouchEndBound = this._onTouchEnd.bind(this), { passive: true });
        if (this._navEl) {
          this._navEl.style.transition = 'transform 0.22s cubic-bezier(0.33,1,0.68,1)';
          this._navEl.style.transform = 'translateZ(0) translateY(0%)';
          this._navVisible = true;
          this._externalHidden = false;
        }
        this._mobileSyncEnabled = true;
      } catch (e) {}
    }

    _disableMobileSync() {
      try {
        if (!this._mobileSyncEnabled) return;
        window.removeEventListener('scroll', this._onMobileScrollBound, { passive: true });
        window.removeEventListener('touchstart', this._onTouchStartBound, { passive: true });
        window.removeEventListener('touchend', this._onTouchEndBound, { passive: true });
        if (this._navEl && !this._externalHidden) { this._navEl.style.transform = 'translateZ(0) translateY(0%)'; this._navVisible = true; }
        this._mobileSyncEnabled = false;
      } catch (e) {}
    }

    _onTouchStart() { this._touching = true; this._lastScrollY = window.scrollY; }
    _onTouchEnd() { this._touching = false; }

    _onMobileScroll() {
      try {
        if (this._externalHidden) return;
        const y = window.scrollY; const delta = y - (this._lastScrollY || 0); this._lastScrollY = y;
        if (y <= 40) { if (!this._navVisible) this._showNav(); return; }
        if (this._touching) { if (delta > 15 && this._navVisible) this._hideNav(); else if (delta < -10 && !this._navVisible) this._showNav(); }
      } catch (e) {}
    }

    _hideNav() { if (!this._navEl) return; this._navEl.style.transform = 'translateZ(0) translateY(100%)'; this._navVisible = false; }
    _showNav() { if (!this._navEl) return; this._navEl.style.transform = 'translateZ(0) translateY(0%)'; this._navVisible = true; }

    // Public API helpers
    forceResync() { this.syncAllToStoredLang(); }

    destroy() { try { this._unbind(); this.navRenderer.unmount(); this._navEl = null; this._initialized = false; this._stopHealthChecks(); } catch (e) {} }

    /* ------------------------
       Health-check & auto-recovery
       ------------------------ */
    _startHealthChecks() {
      try {
        if (this._healthInterval) return;
        this._healthChecksRun = 0;
        // Run more frequently initially, then back off
        this._healthInterval = setInterval(() => {
          this._healthChecksRun++;
          try { this._runHealthCheck(); } catch (e) {}
          // backoff: after 12 runs (~1 minute if interval=5000), slow down
          if (this._healthChecksRun === 12) {
            clearInterval(this._healthInterval);
            this._healthInterval = setInterval(() => { try { this._runHealthCheck(); } catch (e) {} }, 30000);
          }
        }, 5000);
      } catch (e) {}
    }

    _stopHealthChecks() {
      try { if (this._healthInterval) { clearInterval(this._healthInterval); this._healthInterval = null; } } catch (e) {}
    }

    _runHealthCheck() {
      try {
        // 1) ensure nav exists
        const nav = this.navRenderer.getNavElement();
        if (!nav) {
          // attempt re-render using cached config
          try {
            const cfg = this.configLoader._cached || { navigation: [] };
            const frag = this.navRenderer.createFragment(cfg.navigation || [], this._readStoredLang() || this.defaultLang, this.navPrefixManager);
            const navEl = this.navRenderer.createNavElement(frag);
            this.navRenderer.mount(navEl);
            this._navEl = this.navRenderer.getNavElement();
            this._bind();
            this.syncAllToStoredLang();
            this._updateActiveState();
            return;
          } catch (e) {}
        }
        // 2) ensure at least one nav item exists or re-load config
        const items = this.navRenderer.getItems();
        if (!items || items.length === 0) {
          // try reload config once
          this.configLoader.load(true).then(cfg => {
            try {
              this.navRenderer.unmount();
              const frag = this.navRenderer.createFragment(cfg.navigation || [], this._readStoredLang() || this.defaultLang, this.navPrefixManager);
              const navEl = this.navRenderer.createNavElement(frag);
              this.navRenderer.mount(navEl);
              this._navEl = this.navRenderer.getNavElement();
              this._bind();
              this.syncAllToStoredLang();
              this._updateActiveState();
            } catch (e) {}
          }).catch(() => {});
        }
        // 3) verify CSS visibility: if nav is visible but stylesheet failed, reveal anyway
        try {
          if (nav && nav.style && nav.style.visibility === 'hidden') {
            // if page has had time, reveal
            nav.style.visibility = '';
          }
        } catch (e) {}
      } catch (e) {}
    }
  }

  // --- Bootstrap single instance and expose global API ---
  const controller = new NavController({
    cssPath: '/assets/css/modern-styles.min.css',
    configPath: '/assets/json/template/template.min.json',
    defaultLang: 'en',
    supportedLangCodes: ['th','en','ja','ko','zh','fr','de','es','it','pt','ru','ar','vi','id','ms','tl'],
    defaultButtonClass: 'default-button'
  });

  // Defer init until microtask but ensure DOM ready guard handled inside init
  queueMicrotask(() => { controller.init().catch(e => { try { console.error('ModernNavigation init failed:', e); } catch (e2) {} }); });

  window.modernNav = {
    forceResync: () => controller.forceResync(),
    destroy: () => controller.destroy(),
    hideNav: (r) => controller._hideNav && controller._hideNav(r),
    showNav: (r) => controller._showNav && controller._showNav(r),
    _internal: { controller }
  };

})();