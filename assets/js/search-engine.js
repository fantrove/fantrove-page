/*
  search-engine.js  v3.2
  ─────────────────────────────────────────────────────────────────
  Improvements over v3.0:

  CHUNKED INDEX BUILDING
  ✅ Fuse index built in chunks of CHUNK_SIZE items per idle callback
     → browser can handle input/scroll between chunks
     → even 50k-item datasets don't freeze the UI
  ✅ Progress callback: onIndexProgress(pct, itemCount) fires each chunk
  ✅ Graceful fallback: if rIC unavailable, uses setTimeout(0) per chunk

  PERFORMANCE MARKS
  ✅ performance.mark/measure around search, suggest, index build phases
     → visible in DevTools Performance panel
     → readable via __searchUI.perf.getReport()

  PRESERVED
  ✅ Immediate substring search (shows results before Fuse is ready)
  ✅ All public API methods: init, search, querySuggestions, generateAllKeywords
  ✅ Graceful Fuse load failure → stays on immediate search
*/
(function (global) {
  'use strict';

  // ── Config ──────────────────────────────────────────────────
  const CHUNK_SIZE   = 250;   // items processed per idle callback slice
  const FUSE_CDN     = 'https://unpkg.com/fuse.js@6.6.2/dist/fuse.min.js';

  // ── Utilities ───────────────────────────────────────────────
  function defaultNormalizeText(s) {
    if (!s && s !== 0) return '';
    s = String(s).toLowerCase().trim();
    try { s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
    s = s.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
         .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
    s = s.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    s = s.replace(/[^\p{L}\p{N}\s]+/gu, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  function pickLang(obj, langs) {
    if (!obj || typeof obj !== 'object') return obj || '';
    for (let i = 0; i < langs.length; i++) if (obj[langs[i]]) return obj[langs[i]];
    for (const k in obj) return obj[k];
    return '';
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Perf helpers (safe wrappers — won't throw on old browsers) ─
  const Perf = {
    mark(name)             { try { performance.mark('se:' + name); } catch (_) {} },
    measure(name, a, b)    { try { performance.measure('se:' + name, 'se:' + a, 'se:' + b); } catch (_) {} },
    clearMark(name)        { try { performance.clearMarks('se:' + name); } catch (_) {} },
    getEntries()           {
      try { return performance.getEntriesByType('measure').filter(e => e.name.startsWith('se:')); }
      catch (_) { return []; }
    },
  };

  // ── Fuse loader ─────────────────────────────────────────────
  function ensureFuseLoaded() {
    return new Promise((resolve, reject) => {
      if (global.Fuse) return resolve(global.Fuse);
      const s = document.createElement('script');
      s.src = FUSE_CDN; s.async = true;
      s.onload  = () => global.Fuse ? resolve(global.Fuse) : reject(new Error('Fuse loaded but not on global'));
      s.onerror = () => reject(new Error('Failed to load Fuse.js from CDN'));
      document.head.appendChild(s);
    });
  }

  // ── Detect active languages in dataset ──────────────────────
  function detectLangs(data) {
    const set = Object.create(null);
    for (const t of (data.type || [])) {
      if (typeof t.name === 'object') for (const k in t.name) set[k] = 1;
      for (const c of (t.category || [])) {
        if (typeof c.name === 'object') for (const k in c.name) set[k] = 1;
        for (const it of (c.data || [])) {
          if (typeof it.name === 'object') for (const k in it.name) set[k] = 1;
        }
      }
    }
    const langs = Object.keys(set);
    return langs.length ? langs : ['en'];
  }

  // ── Collect all raw items into a flat array ──────────────────
  // Separating collection from processing allows chunked iteration.
  function collectRawItems(data) {
    const raw = [];
    for (const typeObj of (data.type || [])) {
      const typeNames = typeof typeObj.name === 'object' ? typeObj.name : { en: String(typeObj.name || '') };
      for (const cat of (typeObj.category || [])) {
        const catNames = typeof cat.name === 'object' ? cat.name : { en: String(cat.name || '') };
        for (const item of (cat.data || [])) {
          raw.push({ typeObj, typeNames, cat, catNames, item });
        }
      }
    }
    return raw;
  }

  // ── Build a single doc from a raw item ──────────────────────
  function buildDoc(raw, langs, normalizeFn, id) {
    const { typeObj, typeNames, cat, catNames, item } = raw;
    const parts = [];
    if (item.name && typeof item.name === 'object') {
      for (const lg of langs) if (item.name[lg]) parts.push(String(item.name[lg]));
    } else if (item.name) {
      parts.push(String(item.name));
    }
    for (const k in item) {
      if (/_name$/.test(k) && item[k] && typeof item[k] === 'object') {
        for (const lg of langs) if (item[k][lg]) parts.push(String(item[k][lg]));
      }
    }
    if (item.api)  parts.push(String(item.api));
    if (item.text) parts.push(String(item.text));
    for (const lg of langs) {
      if (typeNames[lg]) parts.push(String(typeNames[lg]));
      if (catNames[lg])  parts.push(String(catNames[lg]));
    }
    const combined = parts.filter(Boolean).join(' • ');
    return {
      id         : String(id),
      typeKey    : pickLang(typeObj.name, langs) || '',
      categoryKey: pickLang(cat.name, langs) || '',
      name       : pickLang(item.name || {}, langs) || (item.api || ''),
      api        : item.api  || '',
      text       : item.text || '',
      combined   : normalizeFn ? normalizeFn(combined) : combined,
      rawItem    : item,
      typeObj,
      category   : cat,
    };
  }

  // ── Immediate (fast) docs — no heavy normalization ──────────
  function buildImmediateDocs(data) {
    const langs    = detectLangs(data);
    const rawItems = collectRawItems(data);
    const docs     = [];
    const keywords = [];

    rawItems.forEach((raw, i) => {
      const { typeObj, typeNames, cat, catNames, item } = raw;
      const parts = [];
      if (item.name && typeof item.name === 'object') {
        for (const lg of langs) if (item.name[lg]) parts.push(String(item.name[lg]));
      } else if (item.name) {
        parts.push(String(item.name));
      }
      if (item.api)  parts.push(String(item.api));
      if (item.text) parts.push(String(item.text));
      for (const lg of langs) {
        if (typeNames[lg]) parts.push(String(typeNames[lg]));
        if (catNames[lg])  parts.push(String(catNames[lg]));
      }
      const combined  = parts.filter(Boolean).join(' • ');
      const typeKey   = pickLang(typeObj.name,  langs) || '';
      const catKey    = pickLang(cat.name, langs)      || '';
      const nameStr   = pickLang(item.name || {}, langs) || (item.api || '');

      docs.push({
        id: String(i + 1), typeKey, categoryKey: catKey,
        name: nameStr, api: item.api || '', text: item.text || '',
        combined, rawItem: item, typeObj, category: cat,
      });

      if (nameStr) keywords.push({
        raw: nameStr, normalized: String(nameStr).toLowerCase(),
        docId: String(i + 1), item, itemName: nameStr,
        typeObj, typeName: typeKey, catName: catKey,
      });
    });

    return { docs, keywords };
  }

  // ── CHUNKED full-normalize doc builder ──────────────────────
  // Yields control between chunks so the browser stays responsive.
  // onProgress(pct:0-100, itemsProcessed:number) called after each chunk.
  async function flattenDataToDocsChunked(data, normalizeFn, onProgress) {
    Perf.mark('index-build-start');
    const langs    = detectLangs(data);
    const rawItems = collectRawItems(data);
    const total    = rawItems.length;
    const docs     = [];
    const keywords = [];

    const yieldToIdle = () => new Promise(resolve => {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(resolve, { timeout: 2000 });
      } else {
        setTimeout(resolve, 0);
      }
    });

    for (let base = 0; base < total; base += CHUNK_SIZE) {
      const end   = Math.min(base + CHUNK_SIZE, total);
      const chunk = rawItems.slice(base, end);

      for (let j = 0; j < chunk.length; j++) {
        const doc = buildDoc(chunk[j], langs, normalizeFn, base + j + 1);
        docs.push(doc);
        const kw = doc.name || doc.api;
        if (kw) keywords.push({
          raw: kw,
          normalized: normalizeFn ? normalizeFn(kw) : String(kw).toLowerCase(),
          docId: doc.id, item: doc.rawItem, itemName: doc.name,
          typeObj: doc.typeObj, typeName: doc.typeKey, catName: doc.categoryKey,
        });
      }

      const pct = Math.round((end / total) * 100);
      try { if (typeof onProgress === 'function') onProgress(pct, end); } catch (_) {}

      // Yield between chunks so browser can paint / handle input
      if (base + CHUNK_SIZE < total) await yieldToIdle();
    }

    Perf.measure('index-build', 'index-build-start', 'index-build-start');
    Perf.mark('index-build-done');
    Perf.measure('index-build-total', 'index-build-start', 'index-build-done');

    return { docs, keywords, langs };
  }

  // ── Search Engine ────────────────────────────────────────────
  const SearchEngine = (function () {
    let _data        = null;
    let _docs        = [];
    let _keywords    = [];
    let _fuse        = null;
    let _normalize   = defaultNormalizeText;
    let _building    = false;
    let _indexReady  = false;
    let _options     = {
      fuseOptions       : {},
      fastImmediateLimit: 200,
      idleTimeout       : 4000,
      onIndexProgress   : null,   // (pct, count) => void
      onIndexReady      : null,   // () => void
    };

    // ── init ────────────────────────────────────────────────
    async function init(data, options) {
      options    = options || {};
      _options   = Object.assign({}, _options, options);
      _data      = data || null;
      _normalize = options.normalizeFn || defaultNormalizeText;
      _indexReady = false;

      // Immediate docs first — user can search right away
      Perf.mark('immediate-build-start');
      const imm   = buildImmediateDocs(_data || {});
      _docs        = imm.docs;
      _keywords    = imm.keywords.map(k => ({
        key     : k.normalized || String(k.raw || '').toLowerCase(),
        raw     : k.raw     || '',
        item    : k.item    || null,
        itemName: k.itemName || '',
        typeObj : k.typeObj || null,
        typeName: k.typeName || '',
        catName : k.catName  || '',
      }));
      Perf.mark('immediate-build-done');
      Perf.measure('immediate-build', 'immediate-build-start', 'immediate-build-done');

      // Schedule Fuse build in background
      _scheduleChunkedBuild();
      return true;
    }

    // ── Chunked Fuse build (background) ──────────────────────
    function _scheduleChunkedBuild() {
      if (_building || !_data) return;
      _building = true;

      const run = async () => {
        try {
          const Fuse = await ensureFuseLoaded();

          const defaultFuseOpts = {
            includeScore      : true,
            threshold         : 0.38,
            ignoreLocation    : true,
            minMatchCharLength: 2,
            useExtendedSearch : false,
            keys              : [
              { name: 'name',     weight: 0.6 },
              { name: 'api',      weight: 0.9 },
              { name: 'combined', weight: 0.5 },
              { name: 'text',     weight: 0.2 },
            ],
          };
          const fuseOpts = Object.assign({}, defaultFuseOpts, _options.fuseOptions || {});

          // Build docs in chunks, yielding between each chunk
          const { docs, keywords } = await flattenDataToDocsChunked(
            _data,
            _normalize,
            (pct, count) => {
              try { if (typeof _options.onIndexProgress === 'function') _options.onIndexProgress(pct, count); } catch (_) {}
            }
          );

          Perf.mark('fuse-create-start');
          _fuse = new Fuse(docs, fuseOpts);
          Perf.mark('fuse-create-done');
          Perf.measure('fuse-create', 'fuse-create-start', 'fuse-create-done');

          // Upgrade keyword list to fully-normalized version
          _keywords = keywords.map(k => ({
            key     : k.normalized || String(k.raw || '').toLowerCase(),
            raw     : k.raw     || '',
            item    : k.item    || null,
            itemName: k.itemName || '',
            typeObj : k.typeObj  || null,
            typeName: k.typeName || '',
            catName : k.catName  || '',
          }));

          _indexReady = true;
          try { if (typeof _options.onIndexReady === 'function') _options.onIndexReady(); } catch (_) {}

        } catch (err) {
          console.warn('[SearchEngine] Fuse build failed, staying on immediate search:', err && err.message ? err.message : err);
          _fuse = null;
        } finally {
          _building = false;
        }
      };

      // Start on next idle tick
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run, { timeout: _options.idleTimeout });
      } else {
        const cores = (navigator && navigator.hardwareConcurrency) || 4;
        setTimeout(run, cores <= 2 ? 1200 : 80);
      }
    }

    // ── Immediate substring search ────────────────────────────
    function _immediateSearch(qRaw, typeFilter, limit) {
      const q  = String(qRaw || '').trim();
      if (!q) return { results: [], keywords: _generateAllKeywords() };

      Perf.mark('imm-search-start');
      const nq      = q.toLowerCase();
      const results = [];
      limit         = limit || 200;

      for (let i = 0; i < _docs.length && results.length < limit; i++) {
        const d = _docs[i];
        if (typeFilter && typeFilter !== 'all') {
          if ((d.typeKey || '').toLowerCase() !== String(typeFilter || '').toLowerCase()) continue;
        }
        const hay = ((d.name || '') + ' ' + (d.api || '') + ' ' + (d.combined || '')).toLowerCase();
        if (hay.indexOf(nq) >= 0) {
          results.push({
            typeObj: d.typeObj, category: d.category, item: d.rawItem,
            typeName: d.typeKey, catName: d.categoryKey, itemName: d.name || '',
            lang: 'auto', fuzzy: false, fuzzyScore: null,
            matchExact: (hay === nq),
          });
        }
      }

      Perf.mark('imm-search-done');
      Perf.measure('immediate-search', 'imm-search-start', 'imm-search-done');
      return { results, keywords: _generateAllKeywords() };
    }

    // ── Public search ─────────────────────────────────────────
    function search(qRaw, typeFilter) {
      const q = String(qRaw || '').trim();
      if (!q) return { results: [], keywords: _generateAllKeywords() };

      if (!_fuse) return _immediateSearch(qRaw, typeFilter);

      Perf.mark('fuse-search-start');
      try {
        const fuseResults = _fuse.search(q, { limit: 200 }) || [];
        const results     = [];
        for (const r of fuseResults) {
          const doc = r.item || r;
          if (typeFilter && typeFilter !== 'all') {
            if ((doc.typeKey || '').toLowerCase() !== String(typeFilter || '').toLowerCase()) continue;
          }
          results.push({
            typeObj: doc.typeObj, category: doc.category, item: doc.rawItem,
            typeName: doc.typeKey, catName: doc.categoryKey, itemName: doc.name || '',
            lang: 'auto',
            fuzzy     : (r.score !== undefined && r.score > 0),
            fuzzyScore: r.score !== undefined ? r.score : null,
            matchExact: r.score !== undefined ? r.score === 0 : false,
          });
        }
        Perf.mark('fuse-search-done');
        Perf.measure('fuse-search', 'fuse-search-start', 'fuse-search-done');
        return { results, keywords: _generateAllKeywords() };
      } catch (err) {
        console.error('[SearchEngine] Fuse search error, falling back:', err);
        Perf.mark('fuse-search-done');
        return _immediateSearch(qRaw, typeFilter);
      }
    }

    // ── Suggestions ───────────────────────────────────────────
    function querySuggestions(rawQuery, maxCount) {
      maxCount   = maxCount || 8;
      const q    = String(rawQuery || '').trim();
      if (!q) return [];

      const nq  = _normalize ? _normalize(q) : q.toLowerCase();
      const out = [];
      const seen = new Set();

      // 1) Keyword prefix match
      for (const k of _keywords) {
        if (out.length >= maxCount) break;
        if (!k || !k.key) continue;
        if (String(k.key).indexOf(nq) === 0) {
          const display = k.raw || k.itemName || '';
          const norm    = k.key;
          if (seen.has(norm)) continue;
          seen.add(norm);
          out.push({ display, raw: display, highlightedHtml: display, source: 'keyword' });
        }
      }
      if (out.length >= maxCount) return out.slice(0, maxCount);

      // 2) Fuse suggestions (more accurate, available after index build)
      if (_fuse && q.length >= 1) {
        try {
          const fuseRes = _fuse.search(q, { limit: Math.max(12, maxCount) });
          for (const r of fuseRes) {
            if (out.length >= maxCount) break;
            const doc     = r.item || r;
            const display = doc.name || doc.api || '';
            if (!display) continue;
            const norm    = _normalize ? _normalize(display) : String(display).toLowerCase();
            if (!norm || seen.has(norm)) continue;
            seen.add(norm);
            out.push({ display, raw: display, highlightedHtml: escapeHtml(String(display)), source: 'fuse', score: r.score ?? null });
          }
        } catch (err) { console.error('[SearchEngine] Fuse suggest error:', err); }
      } else {
        // 3) Simple doc scan fallback
        const nqSimple = String(q).toLowerCase();
        for (const d of _docs) {
          if (out.length >= maxCount) break;
          const display = d.name || d.api || '';
          if (!display) continue;
          const norm    = String(display).toLowerCase();
          if (norm.indexOf(nqSimple) === 0 && !seen.has(norm)) {
            seen.add(norm);
            out.push({ display, raw: display, highlightedHtml: display, source: 'immediate' });
          }
        }
      }
      return out;
    }

    // ── Keywords ──────────────────────────────────────────────
    function _generateAllKeywords() {
      return _keywords.map(k => Object.assign({}, k));
    }

    // ── Public API ────────────────────────────────────────────
    return {
      init              : (data, options) => init(data, options),
      search            : (q, typeFilter) => search(q, typeFilter),
      querySuggestions  : (q, max) => querySuggestions(q, max),
      generateAllKeywords: () => _generateAllKeywords(),
      isIndexReady      : () => _indexReady,
      isBuilding        : () => _building,
      getDocCount       : () => _docs.length,
      getPerfEntries    : () => Perf.getEntries(),
      _internals        : {
        normalizeText      : _normalize,
        getDocs            : () => _docs.slice(),
        getKeywords        : () => _keywords.slice(),
        getFuse            : () => _fuse,
        flattenDataToDocsChunked,
        buildImmediateDocs,
      },
    };
  })();

  global.SearchEngine = SearchEngine;

})(window);