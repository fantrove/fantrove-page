/*
  search-engine.fuse.js (optimized for immediate display & low resource use)
  - Shows results immediately using a lightweight substring search (no Fuse required)
  - Builds Fuse index asynchronously during idle time to avoid blocking UI
  - Does NOT use any caching (no localStorage/sessionStorage)
  - API preserved: init(data, options), generateAllKeywords(), querySuggestions(q,maxCount), search(q,typeFilter)
*/
(function (global) {
  'use strict';

  // ---------- Utilities ----------
  function isEmpty(v) { return v === null || v === undefined || v === ''; }

  function defaultNormalizeText(s) {
    if (!s && s !== 0) return '';
    s = String(s).toLowerCase().trim();
    try { s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
    s = s.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'").replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
    s = s.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    s = s.replace(/[^\p{L}\p{N}\s]+/gu, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  function pickLang(obj, langs){
    if (!obj || typeof obj !== 'object') return obj || '';
    for (let i=0;i<langs.length;i++) if (obj[langs[i]]) return obj[langs[i]];
    for (const k in obj) return obj[k];
    return '';
  }

  // ---------- Loader for Fuse.js (CDN) ----------
  function ensureFuseLoaded() {
    return new Promise((resolve, reject) => {
      if (global.Fuse) return resolve(global.Fuse);
      const src = 'https://unpkg.com/fuse.js@6.6.2/dist/fuse.min.js';
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => {
        if (global.Fuse) resolve(global.Fuse);
        else reject(new Error('Fuse loaded but global.Fuse not available'));
      };
      s.onerror = () => reject(new Error('Failed to load Fuse.js'));
      document.head.appendChild(s);
    });
  }

  // ---------- Lightweight immediate doc builder ----------
  // Build minimal docs for instant substring-based search (cheap, no normalization by default)
  function buildImmediateDocs(data) {
    const docs = [];
    const keywords = [];
    if (!data || !Array.isArray(data.type)) return { docs, keywords };

    // detect langs minimally
    const langsSet = Object.create(null);
    for (let i=0;i<data.type.length;i++){
      const t = data.type[i];
      if (typeof t.name === 'object') for (const k in t.name) langsSet[k]=1;
      const cats = t.category || [];
      for (let j=0;j<cats.length;j++){
        const c = cats[j];
        if (typeof c.name === 'object') for (const k in c.name) langsSet[k]=1;
        const items = c.data || [];
        for (let x=0;x<items.length;x++){
          const it = items[x];
          if (typeof it.name === 'object') for (const k in it.name) langsSet[k]=1;
        }
      }
    }
    const langs = Object.keys(langsSet).length ? Object.keys(langsSet) : ['en'];

    let idCounter = 1;
    for (let i=0;i<data.type.length;i++){
      const typeObj = data.type[i];
      const typeNames = typeof typeObj.name === 'object' ? typeObj.name : { en: String(typeObj.name || '') };
      const cats = typeObj.category || [];
      for (let j=0;j<cats.length;j++){
        const cat = cats[j];
        const catNames = typeof cat.name === 'object' ? cat.name : { en: String(cat.name || '') };
        const items = cat.data || [];
        for (let x=0;x<items.length;x++){
          const item = items[x];
          // Build combined text cheaply (no heavy normalization)
          const parts = [];
          if (item.name && typeof item.name === 'object') {
            for (const lg of langs) if (item.name[lg]) parts.push(String(item.name[lg]));
          } else if (item.name) parts.push(String(item.name));
          if (item.api) parts.push(String(item.api));
          if (item.text) parts.push(String(item.text));
          for (const lg of langs) {
            if (typeNames[lg]) parts.push(String(typeNames[lg]));
            if (catNames[lg]) parts.push(String(catNames[lg]));
          }
          const combined = parts.filter(Boolean).join(' • ');

          const doc = {
            id: String(idCounter++),
            typeKey: pickLang(typeObj.name, langs) || '',
            categoryKey: pickLang(cat.name, langs) || '',
            name: pickLang(item.name || {}, langs) || (item.api || ''),
            api: item.api || '',
            text: item.text || '',
            combined: combined,
            rawItem: item,
            typeObj,
            category: cat
          };
          docs.push(doc);

          const kw = (doc.name || '') || (doc.api || '');
          if (kw) keywords.push({
            raw: kw,
            normalized: String(kw).toLowerCase(),
            docId: doc.id,
            item: item,
            itemName: doc.name,
            typeObj: typeObj,
            typeName: doc.typeKey,
            catName: doc.categoryKey
          });
        }
      }
    }
    return { docs, keywords };
  }

  // ---------- Full flatten to docs (keeps original behavior, optionally used when building Fuse) ----------
  function flattenDataToDocs(data, normalizeFn) {
    const docs = [];
    const keywords = [];
    if (!data || !Array.isArray(data.type)) return { docs, keywords };

    const langs = (function () {
      const set = Object.create(null);
      for (let i=0;i<data.type.length;i++){
        const t = data.type[i];
        if (typeof t.name === 'object') for (const k in t.name) set[k]=1;
        const cats = t.category || [];
        for (let j=0;j<cats.length;j++){
          const c = cats[j];
          if (typeof c.name === 'object') for (const k in c.name) set[k]=1;
          const items = c.data || [];
          for (let x=0;x<items.length;x++){
            const it = items[x];
            if (typeof it.name === 'object') for (const k in it.name) set[k]=1;
            for (const k in it) if (/_name$/.test(k) && typeof it[k] === 'object') for (const l in it[k]) set[l]=1;
          }
        }
      }
      return Object.keys(set).length ? Object.keys(set) : ['en'];
    })();

    let idCounter = 1;
    for (let i=0;i<data.type.length;i++){
      const typeObj = data.type[i];
      const typeNames = typeof typeObj.name === 'object' ? typeObj.name : { en: String(typeObj.name || '') };
      const cats = typeObj.category || [];
      for (let j=0;j<cats.length;j++){
        const cat = cats[j];
        const catNames = typeof cat.name === 'object' ? cat.name : { en: String(cat.name || '') };
        const items = cat.data || [];
        for (let x=0;x<items.length;x++){
          const item = items[x];
          let combinedParts = [];
          if (item.name && typeof item.name === 'object') {
            for (const lg of langs) {
              if (item.name[lg]) combinedParts.push(String(item.name[lg]));
            }
          } else if (item.name) combinedParts.push(String(item.name));
          for (const k in item) {
            if (/_name$/.test(k) && typeof item[k] === 'object') {
              for (const lg of langs) if (item[k][lg]) combinedParts.push(String(item[k][lg]));
            }
          }
          if (item.api) combinedParts.push(String(item.api));
          if (item.text) combinedParts.push(String(item.text));
          for (const lg of langs) {
            if (typeNames[lg]) combinedParts.push(String(typeNames[lg]));
            if (catNames[lg]) combinedParts.push(String(catNames[lg]));
          }
          const combined = combinedParts.filter(Boolean).join(' • ');
          const doc = {
            id: String(idCounter++),
            typeKey: pickLang(typeObj.name, langs) || '',
            categoryKey: pickLang(cat.name, langs) || '',
            name: pickLang(item.name || {}, langs) || (item.api || ''),
            api: item.api || '',
            text: item.text || '',
            combined: normalizeFn ? normalizeFn(combined) : combined,
            rawItem: item,
            typeObj,
            category: cat
          };
          docs.push(doc);

          const kw = (doc.name || '') || (doc.api || '');
          if (kw) keywords.push({ raw: kw, normalized: normalizeFn ? normalizeFn(kw) : String(kw).toLowerCase(), docId: doc.id, item: item, itemName: doc.name, typeObj: typeObj, typeName: doc.typeKey, catName: doc.categoryKey });
        }
      }
    }
    return { docs, keywords };
  }

  // ---------- Search Engine with immediate fallback & async Fuse building ----------
  const SearchEngine = (function(){
    let _data = null;
    let _docs = [];            // immediate docs (un-normalized combined strings)
    let _keywords = [];        // immediate keywords (normalized via toLowerCase for prefix match)
    let _fuse = null;         // Fuse instance (built async)
    let _normalize = defaultNormalizeText;
    let _options = { useWorker: false, fuseOptions: {}, fastImmediateLimit: 200, idleTimeout: 4000 };

    let _fuseBuilding = false;

    async function init(data, options) {
      options = options || {};
      _options = Object.assign({}, _options, options);
      _data = data || null;
      _normalize = options.normalizeFn || defaultNormalizeText;

      // 1) Build immediate lightweight docs so we can show results right away (cheap)
      const immediate = buildImmediateDocs(_data || {});
      _docs = immediate.docs;
      _keywords = immediate.keywords.map(k => ({
        item: k.item || null,
        itemName: k.itemName || (k.item && k.item.name ? (typeof k.item.name === 'string' ? k.item.name : JSON.stringify(k.item.name)) : ''),
        typeObj: k.typeObj || null,
        typeName: k.typeName || '',
        catName: k.catName || '',
        key: k.normalized || (k.raw || '').toLowerCase(),
        raw: k.raw || ''
      }));

      // 2) Schedule Fuse index build in idle time (do NOT block UI)
      scheduleBuildFuse();

      return true;
    }

    function scheduleBuildFuse() {
      if (_fuseBuilding || !_data) return;
      _fuseBuilding = true;

      const build = async () => {
        try {
          const Fuse = await ensureFuseLoaded();
          // Flatten fully (with normalization) for better Fuse results
          const { docs, keywords } = flattenDataToDocs(_data || {}, _normalize);
          // reduce memory pressure: reuse doc objects if possible, but assign to _docsForFuse
          let fuseDocs = docs;
          const defaultFuseOpts = {
            includeScore: true,
            threshold: 0.38,
            ignoreLocation: true,
            minMatchCharLength: 2,
            useExtendedSearch: false,
            keys: [
              { name: 'name', weight: 0.6 },
              { name: 'api', weight: 0.9 },
              { name: 'combined', weight: 0.5 },
              { name: 'text', weight: 0.2 }
            ]
          };
          const fuseOpts = Object.assign({}, defaultFuseOpts, _options.fuseOptions || {});
          try {
            _fuse = new Fuse(fuseDocs, fuseOpts);
            // overwrite keyword list with normalized, rich entries once Fuse-ready
            _keywords = keywords.map(k => {
              return {
                item: k.item || null,
                itemName: k.itemName || (k.item && k.item.name ? (typeof k.item.name === 'string' ? k.item.name : JSON.stringify(k.item.name)) : ''),
                typeObj: k.typeObj || null,
                typeName: k.typeName || '',
                catName: k.catName || '',
                key: k.normalized || (k.raw || '').toLowerCase(),
                raw: k.raw || ''
              };
            });
          } catch (e) {
            console.error('Failed to create Fuse index', e);
            _fuse = null;
          }
        } catch (e) {
          // If Fuse fails to load or build, we keep using immediate search — graceful degradation
          console.warn('Fuse not available for indexing (will use immediate search):', e && e.message ? e.message : e);
          _fuse = null;
        } finally {
          _fuseBuilding = false;
        }
      };

      // If requestIdleCallback available, use it for low-priority background work
      if (typeof requestIdleCallback === 'function') {
        try {
          requestIdleCallback(build, { timeout: _options.idleTimeout });
        } catch (e) {
          setTimeout(build, 100);
        }
      } else {
        // If device has very low concurrency, delay longer to reduce contention
        const cores = (navigator && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;
        const delay = cores <= 2 ? Math.max(1000, _options.idleTimeout) : 100;
        setTimeout(build, delay);
      }
    }

    // Immediate cheap substring search (case-insensitive) for instant UI feedback
    function immediateSearch(qRaw, typeFilter, limit) {
      const q = String(qRaw || '').trim();
      if (!q) return { results: [], keywords: generateAllKeywords() };
      const nq = q.toLowerCase();
      const results = [];
      limit = limit || _options.fastImmediateLimit || 200;
      for (let i=0;i<_docs.length && results.length < limit;i++){
        const d = _docs[i];
        if (typeFilter && typeFilter !== 'all') {
          if ((d.typeKey || '').toLowerCase() !== String(typeFilter || '').toLowerCase()) continue;
        }
        // check name, api, combined cheaply
        const hay = ((d.name || '') + ' ' + (d.api || '') + ' ' + (d.combined || '')).toLowerCase();
        if (hay.indexOf(nq) >= 0) {
          results.push({
            typeObj: d.typeObj,
            category: d.category,
            item: d.rawItem,
            typeName: d.typeKey,
            catName: d.categoryKey,
            itemName: d.name || '',
            lang: 'auto',
            fuzzy: false,
            fuzzyScore: null,
            matchExact: (hay === nq)
          });
        }
      }
      return { results, keywords: generateAllKeywords() };
    }

    // generateAllKeywords now returns entries compatible with original UI's expectations
    function generateAllKeywords() {
      return _keywords.map(k => Object.assign({}, k));
    }

    function querySuggestions(rawQuery, maxCount) {
      maxCount = maxCount || 8;
      const q = String(rawQuery || '').trim();
      if (!q) return [];
      const nq = _normalize ? _normalize(q) : q.toLowerCase();
      const out = [];
      const seen = new Set();
      // 1) keyword prefix matches from immediate keywords
      for (let i=0;i<_keywords.length && out.length < maxCount;i++){
        const k = _keywords[i];
        if (!k || !k.key) continue;
        if (String(k.key).indexOf(nq) === 0) {
          const display = k.raw || k.itemName || '';
          const norm = k.key;
          if (seen.has(norm)) continue;
          seen.add(norm);
          out.push({ display, raw: display, highlightedHtml: display, source: 'keyword' });
        }
      }
      if (out.length >= maxCount) return out.slice(0, maxCount);

      // 2) If Fuse ready, use Fuse suggestions (more accurate)
      if (_fuse && q.length >= 1) {
        try {
          const fuseRes = _fuse.search(q, { limit: Math.max(12, maxCount) });
          for (let i=0;i<fuseRes.length && out.length < maxCount;i++){
            const r = fuseRes[i];
            const doc = r.item || r;
            const display = doc.name || doc.api || (doc.rawItem && (doc.rawItem.name ? (typeof doc.rawItem.name === 'string' ? doc.rawItem.name : JSON.stringify(doc.rawItem.name)) : '')) || '';
            const norm = _normalize ? _normalize(display) : (String(display || '').toLowerCase());
            if (!norm) continue;
            if (seen.has(norm)) continue;
            seen.add(norm);
            const highlightedHtml = (typeof display === 'string') ? escapeHtml(display) : escapeHtml(String(display));
            out.push({ display, raw: display, highlightedHtml, source: 'fuse', score: (r.score !== undefined ? r.score : null) });
          }
        } catch (e) { console.error('Fuse search for suggestions failed', e); }
      } else {
        // 3) Fallback: do immediate doc scans for suggestions (cheap)
        const nqSimple = String(q).toLowerCase();
        for (let i=0;i<_docs.length && out.length < maxCount;i++){
          const d = _docs[i];
          const display = d.name || d.api || '';
          if (!display) continue;
          const norm = String(display).toLowerCase();
          if (norm.indexOf(nqSimple) === 0 && !seen.has(norm)) {
            seen.add(norm);
            out.push({ display, raw: display, highlightedHtml: display, source: 'immediate' });
          }
        }
      }
      return out;
    }

    function search(qRaw, typeFilter) {
      const q = String(qRaw || '').trim();
      if (!q) return { results: [], keywords: generateAllKeywords() };
      // If Fuse ready, use it (more thorough). Otherwise do immediate cheap search.
      if (_fuse) {
        try {
          const fuseResults = _fuse.search(q, { limit: 200 }) || [];
          const results = [];
          for (let i=0;i<fuseResults.length;i++){
            const r = fuseResults[i];
            const doc = r.item || r;
            if (typeFilter && typeFilter !== 'all') {
              if ((doc.typeKey || '').toLowerCase() !== String(typeFilter || '').toLowerCase()) continue;
            }
            results.push({
              typeObj: doc.typeObj,
              category: doc.category,
              item: doc.rawItem,
              typeName: doc.typeKey,
              catName: doc.categoryKey,
              itemName: doc.name || '',
              lang: 'auto',
              fuzzy: (r.score !== undefined && r.score > 0),
              fuzzyScore: (r.score !== undefined ? r.score : null),
              matchExact: (r.score !== undefined ? (r.score === 0) : false)
            });
          }
          return { results, keywords: generateAllKeywords() };
        } catch (e) {
          console.error('Fuse search failed, falling back to immediate search', e);
          return immediateSearch(qRaw, typeFilter);
        }
      } else {
        // immediate cheap substring search (fast, low resources)
        return immediateSearch(qRaw, typeFilter);
      }
    }

    function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    return {
      init: function(data, options) { return init(data, options); },
      generateAllKeywords: function() { return generateAllKeywords(); },
      querySuggestions: function(q, maxCount) { return querySuggestions(q, maxCount); },
      search: function(q, typeFilter) { return search(q, typeFilter); },
      _internals: {
        normalizeText: _normalize,
        flattenDataToDocs,
        buildImmediateDocs,
        getDocs: () => _docs.slice(),
        getFuse: () => _fuse,
        options: () => Object.assign({}, _options)
      }
    };
  })();

  global.SearchEngine = SearchEngine;

})(window);