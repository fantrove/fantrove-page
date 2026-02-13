/*
  search-engine.fuse.js
  - Modern replacement using Fuse.js for flexible fuzzy/full-text search
  - Keeps the same public API: init({data, options}), generateAllKeywords(), querySuggestions(q,maxCount), search(q,typeFilter)
  - _internals exposes fuse instance and helper utils for debugging/tests
  - Auto-loads Fuse.js from CDN if not present (can be removed if bundling)
  - Optionally you can build the index in a Web Worker for large datasets (not inlined here)
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
      // Load from CDN (unpkg). If you bundle, remove this loader.
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

  // ---------- Flatten dataset into documents for Fuse ----------
  // Each doc: { id, typeKey, categoryKey, name, api, text, extra, rawItem }
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
          // Build a combined searchable text that includes all language variants + api + text
          let combinedParts = [];
          // names per language
          if (item.name && typeof item.name === 'object') {
            for (const lg of langs) {
              if (item.name[lg]) combinedParts.push(String(item.name[lg]));
            }
          } else if (item.name) combinedParts.push(String(item.name));
          // other *_name fields
          for (const k in item) {
            if (/_name$/.test(k) && typeof item[k] === 'object') {
              for (const lg of langs) if (item[k][lg]) combinedParts.push(String(item[k][lg]));
            }
          }
          if (item.api) combinedParts.push(String(item.api));
          if (item.text) combinedParts.push(String(item.text));
          // category/type names
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

          // push relevant keywords (for suggestions)
          const kw = (doc.name || '') || (doc.api || '');
          if (kw) keywords.push({ raw: kw, normalized: normalizeFn ? normalizeFn(kw) : kw, docId: doc.id });
        }
      }
    }
    return { docs, keywords };
  }

  // ---------- Search Engine with Fuse.js ----------
  const SearchEngine = (function(){
    let _data = null;
    let _docs = [];
    let _keywords = [];
    let _fuse = null;
    let _normalize = defaultNormalizeText;
    let _options = { useWorker: false, fuseOptions: {} };

    async function init(data, options) {
      options = options || {};
      _options = Object.assign({}, _options, options);
      _data = data || null;
      _normalize = options.normalizeFn || defaultNormalizeText;
      // ensure Fuse is loaded
      const Fuse = await ensureFuseLoaded();
      // flatten data
      const { docs, keywords } = flattenDataToDocs(_data || {}, _normalize);
      _docs = docs;
      _keywords = keywords;

      // default Fuse options tuned for flexible fuzzy matching
      const defaultFuseOpts = {
        includeScore: true,
        threshold: 0.38,         // lower => stricter; 0.38 is fairly flexible but not too noisy
        ignoreLocation: true,    // allow matches anywhere
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
      // create Fuse index
      try {
        _fuse = new Fuse(_docs, fuseOpts);
      } catch (e) {
        console.error('Failed to create Fuse index', e);
        _fuse = null;
      }
      return true;
    }

    function generateAllKeywords() {
      // return shallow copy of normalized keywords (display raw)
      return _keywords.map(k => ({ raw: k.raw, normalized: k.normalized, docId: k.docId }));
    }

    // Query suggestions: use fuse.search but short-circuit to keywords for short queries
    function querySuggestions(rawQuery, maxCount) {
      maxCount = maxCount || 8;
      const q = String(rawQuery || '').trim();
      if (!q) return [];
      const nq = _normalize ? _normalize(q) : q;

      // Prefer direct keyword prefix matches first
      const out = [];
      const seen = new Set();
      // 1) keyword prefix search (fast linear scan on keywords)
      for (let i=0;i<_keywords.length && out.length < maxCount;i++){
        const k = _keywords[i];
        if (!k || !k.normalized) continue;
        if (k.normalized.indexOf(nq) === 0) {
          const display = k.raw;
          const norm = k.normalized;
          if (seen.has(norm)) continue;
          seen.add(norm);
          out.push({ display, raw: display, highlightedHtml: display, source: 'keyword' });
        }
      }
      if (out.length >= maxCount) return out.slice(0, maxCount);

      // 2) Fuse based suggestions (docs)
      if (_fuse && q.length >= 1) {
        try {
          const fuseRes = _fuse.search(q, { limit: Math.max(12, maxCount) });
          for (let i=0;i<fuseRes.length && out.length < maxCount;i++){
            const r = fuseRes[i];
            const doc = r.item || r;
            const display = doc.name || doc.api || (doc.rawItem && (doc.rawItem.name ? (typeof doc.rawItem.name === 'string' ? doc.rawItem.name : JSON.stringify(doc.rawItem.name)) : '')) || '';
            const norm = _normalize ? _normalize(display) : display;
            if (!norm) continue;
            if (seen.has(norm)) continue;
            seen.add(norm);
            const highlightedHtml = (typeof display === 'string') ? escapeHtml(display) : escapeHtml(String(display));
            out.push({ display, raw: display, highlightedHtml, source: 'fuse', score: (r.score !== undefined ? r.score : null) });
          }
        } catch (e) { console.error('Fuse search for suggestions failed', e); }
      }
      return out;
    }

    function search(qRaw, typeFilter) {
      const q = String(qRaw || '').trim();
      if (!q) return { results: [], keywords: generateAllKeywords() };
      const fuseResults = (_fuse ? _fuse.search(q, { limit: 200 }) : []);
      const results = [];
      for (let i=0;i<fuseResults.length;i++){
        const r = fuseResults[i];
        const doc = r.item || r;
        if (typeFilter && typeFilter !== 'all') {
          // try to match typeKey (case-insensitive compare)
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
    }

    // small helper for escaping
    function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    return {
      init: function(data, options) {
        return init(data, options);
      },
      generateAllKeywords: function() { return generateAllKeywords(); },
      querySuggestions: function(q, maxCount) { return querySuggestions(q, maxCount); },
      search: function(q, typeFilter) { return search(q, typeFilter); },
      _internals: {
        normalizeText: _normalize,
        flattenDataToDocs,
        getDocs: () => _docs.slice(),
        getFuse: () => _fuse,
        options: () => _options
      }
    };
  })();

  // expose global for compatibility
  global.SearchEngine = SearchEngine;

})(window);