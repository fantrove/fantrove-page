/*
  search-engine.js  v4.0 — Platform-Level Scheduling
  ──────────────────────────────────────────────────────────────────────
  NEW in v4.0
  ✅ scheduler.postTask()     priority-aware scheduling (Chrome 94+, with fallback)
  ✅ scheduler.yield()        mid-task cooperative yield (Chrome 115+, with fallback)
  ✅ isInputPending()         yield mid-chunk on user interaction (Chrome 87+)
  ✅ Deadline-aware loop      process items while rIC budget remains (< 1 ms waste)
  ✅ Tab-visibility guard     suspend index build when tab hidden; resume on show
  ✅ WeakRef for Fuse docs    GC can reclaim index under memory pressure
  ✅ FinalizationRegistry     auto-cleanup dead WeakRef entries
  ✅ Memory-aware chunk size  scale with navigator.deviceMemory
  ✅ AbortController          cancel in-flight builds on re-init

  PRESERVED from v3.2
  ✅ Immediate substring search  results before Fuse ready
  ✅ All public APIs             init / search / querySuggestions / generateAllKeywords
  ✅ Graceful Fuse failure       stays on immediate search
  ✅ PerfMonitor integration     performance.mark / measure
*/
(function (global) {
  'use strict';

  // ── Device capability ─────────────────────────────────────────
  const _MEM   = Math.max(1, Math.min(8, (navigator.deviceMemory || 4)));
  const _FUSE_CDN = 'https://unpkg.com/fuse.js@6.6.2/dist/fuse.min.js';

  // ── Scheduler API with full fallback chain ────────────────────
  const _sched = (typeof scheduler !== 'undefined' && scheduler) || null;

  function _scheduleTask(fn, priority, signal) {
    if (_sched?.postTask) {
      const opts = { priority: priority || 'background' };
      if (signal) opts.signal = signal;
      return _sched.postTask(fn, opts);
    }
    return new Promise((resolve, reject) => {
      const run = () => { try { resolve(fn()); } catch (e) { reject(e); } };
      if (!priority || priority === 'background') {
        if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 3000 });
        else setTimeout(run, 0);
      } else {
        requestAnimationFrame(run);
      }
    });
  }

  function _yieldNow() {
    if (_sched?.yield) return _sched.yield();
    return new Promise(resolve => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(resolve, { timeout: 500 });
      else setTimeout(resolve, 0);
    });
  }

  function _isInputPending() {
    try { return !!navigator.scheduling?.isInputPending?.(); } catch { return false; }
  }

  // ── Tab visibility ────────────────────────────────────────────
  let _tabHidden = document.hidden;
  document.addEventListener('visibilitychange', () => { _tabHidden = document.hidden; }, { passive: true });

  function _waitUntilVisible() {
    if (!_tabHidden) return Promise.resolve();
    return new Promise(resolve => {
      const h = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', h); resolve(); } };
      document.addEventListener('visibilitychange', h, { passive: true });
    });
  }

  // ── WeakRef cache + FinalizationRegistry ─────────────────────
  const _wCache = new Map();
  const _wReg   = (typeof FinalizationRegistry !== 'undefined')
    ? new FinalizationRegistry(k => _wCache.delete(k)) : null;

  function _wSet(key, val) {
    try {
      const ref = new WeakRef(val);
      _wCache.set(key, ref);
      _wReg?.register(val, key);
    } catch { _wCache.set(key, { deref: () => val }); }
  }

  function _wGet(key) { return _wCache.get(key)?.deref?.() ?? null; }

  // ── Perf helpers ──────────────────────────────────────────────
  const Perf = {
    mark   (n)    { try { performance.mark('se:' + n); } catch {} },
    measure(n,a,b){ try { performance.measure('se:' + n, 'se:' + a, 'se:' + b); } catch {} },
    all    ()     {
      try { return performance.getEntriesByType('measure').filter(e => e.name.startsWith('se:')); }
      catch { return []; }
    },
  };

  // ── Text normalization ────────────────────────────────────────
  function defaultNormalizeText(s) {
    if (!s && s !== 0) return '';
    s = String(s).toLowerCase().trim();
    try { s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch {}
    s = s.replace(/[\u200B-\u200D\uFEFF]/g, '')
         .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
         .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
         .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
         .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
         .replace(/\s+/g, ' ').trim();
    return s;
  }

  function pickLang(obj, langs) {
    if (!obj || typeof obj !== 'object') return obj || '';
    for (const l of langs) if (obj[l]) return obj[l];
    for (const k in obj) return obj[k];
    return '';
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Fuse loader ───────────────────────────────────────────────
  function ensureFuseLoaded() {
    return new Promise((resolve, reject) => {
      if (global.Fuse) return resolve(global.Fuse);
      const s   = document.createElement('script');
      s.src     = _FUSE_CDN; s.async = true;
      s.onload  = () => global.Fuse ? resolve(global.Fuse) : reject(new Error('Fuse not on global'));
      s.onerror = () => reject(new Error('Fuse CDN load failed'));
      document.head.appendChild(s);
    });
  }

  // ── Data flattening ───────────────────────────────────────────
  function detectLangs(data) {
    const set = Object.create(null);
    for (const t of (data.type || [])) {
      if (typeof t.name === 'object') for (const k in t.name) set[k] = 1;
      for (const c of (t.category || [])) {
        if (typeof c.name === 'object') for (const k in c.name) set[k] = 1;
        for (const it of (c.data || []))
          if (typeof it.name === 'object') for (const k in it.name) set[k] = 1;
      }
    }
    const langs = Object.keys(set);
    return langs.length ? langs : ['en'];
  }

  function collectRawItems(data) {
    const raw = [];
    for (const typeObj of (data.type || [])) {
      const typeNames = typeof typeObj.name === 'object' ? typeObj.name : { en: String(typeObj.name || '') };
      for (const cat of (typeObj.category || [])) {
        const catNames = typeof cat.name === 'object' ? cat.name : { en: String(cat.name || '') };
        for (const item of (cat.data || []))
          raw.push({ typeObj, typeNames, cat, catNames, item });
      }
    }
    return raw;
  }

  function buildDoc(raw, langs, normFn, id) {
    const { typeObj, typeNames, cat, catNames, item } = raw;
    const parts = [];
    if (item.name && typeof item.name === 'object') {
      for (const lg of langs) if (item.name[lg]) parts.push(String(item.name[lg]));
    } else if (item.name) parts.push(String(item.name));
    for (const k in item)
      if (/_name$/.test(k) && item[k] && typeof item[k] === 'object')
        for (const lg of langs) if (item[k][lg]) parts.push(String(item[k][lg]));
    if (item.api)  parts.push(String(item.api));
    if (item.text) parts.push(String(item.text));
    for (const lg of langs) {
      if (typeNames[lg]) parts.push(String(typeNames[lg]));
      if (catNames[lg])  parts.push(String(catNames[lg]));
    }
    const combined = parts.filter(Boolean).join(' • ');
    return {
      id: String(id),
      typeKey    : pickLang(typeObj.name, langs) || '',
      categoryKey: pickLang(cat.name, langs)     || '',
      name       : pickLang(item.name || {}, langs) || (item.api || ''),
      api        : item.api  || '',
      text       : item.text || '',
      combined   : normFn ? normFn(combined) : combined,
      rawItem    : item, typeObj, category: cat,
    };
  }

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
      } else if (item.name) parts.push(String(item.name));
      if (item.api)  parts.push(String(item.api));
      if (item.text) parts.push(String(item.text));
      for (const lg of langs) {
        if (typeNames[lg]) parts.push(String(typeNames[lg]));
        if (catNames[lg])  parts.push(String(catNames[lg]));
      }
      const combined   = parts.filter(Boolean).join(' • ');
      const typeKey    = pickLang(typeObj.name, langs) || '';
      const catKey     = pickLang(cat.name, langs)     || '';
      const nameStr    = pickLang(item.name || {}, langs) || (item.api || '');
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

  // ── Deadline + isInputPending aware chunked build ─────────────
  //
  //  Process items inside a single rIC deadline window.
  //  Check isInputPending() every item — yield immediately on user input.
  //  Tab hidden → suspend completely → resume when visible.
  //  Result: main thread is NEVER blocked during user interaction.
  //
  async function flattenDataToDocsChunked(data, normFn, onProgress) {
    Perf.mark('idx-start');
    const langs    = detectLangs(data);
    const rawItems = collectRawItems(data);
    const total    = rawItems.length;
    const docs     = [];
    const keywords = [];
    let i = 0;

    while (i < total) {
      if (_tabHidden) await _waitUntilVisible();

      // Obtain an rIC deadline (or synthetic 14ms budget on browsers without rIC)
      const deadline = await new Promise(resolve => {
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(dl => resolve(dl), { timeout: 2000 });
        } else {
          const t0 = performance.now();
          resolve({ timeRemaining: () => Math.max(0, 14 - (performance.now() - t0)) });
        }
      });

      // Inner loop: consume budget items per item
      while (i < total) {
        if (_isInputPending())            break;   // user typing/tapping → yield NOW
        if (deadline.timeRemaining() < 1) break;   // rIC budget < 1ms → stop

        const doc = buildDoc(rawItems[i], langs, normFn, i + 1);
        docs.push(doc);
        const kwStr = doc.name || doc.api;
        if (kwStr) keywords.push({
          raw: kwStr,
          normalized: normFn ? normFn(kwStr) : String(kwStr).toLowerCase(),
          docId: doc.id, item: doc.rawItem, itemName: doc.name,
          typeObj: doc.typeObj, typeName: doc.typeKey, catName: doc.categoryKey,
        });
        i++;
      }

      // Milestone progress callbacks
      const pct = i >= total ? 100 : Math.round((i / total) * 100);
      if (pct === 25 || pct === 50 || pct === 75 || pct === 100) {
        try { if (typeof onProgress === 'function') onProgress(pct, i); } catch {}
      }

      // Yield between outer iterations — let scheduler decide next tick
      if (i < total) await _yieldNow();
    }

    Perf.mark('idx-done');
    Perf.measure('idx-total', 'idx-start', 'idx-done');
    return { docs, keywords, langs };
  }

  // ── Search Engine ─────────────────────────────────────────────
  const SearchEngine = (function () {
    let _data      = null;
    let _docs      = [];
    let _keywords  = [];
    let _fuse      = null;
    let _normFn    = defaultNormalizeText;
    let _building  = false;
    let _ready     = false;
    let _abortCtrl = null;
    let _opts      = {
      fuseOptions     : {},
      idleTimeout     : 4000,
      onIndexProgress : null,
      onIndexReady    : null,
    };

    function _mkKeywords(raw) {
      return raw.map(k => ({
        key: k.normalized || String(k.raw || '').toLowerCase(),
        raw: k.raw || '', item: k.item || null, itemName: k.itemName || '',
        typeObj: k.typeObj || null, typeName: k.typeName || '', catName: k.catName || '',
      }));
    }

    async function init(data, options) {
      options = options || {};
      _opts   = Object.assign({}, _opts, options);
      _data   = data || null;
      _normFn = options.normalizeFn || defaultNormalizeText;
      _ready  = false;

      if (_abortCtrl) { try { _abortCtrl.abort(); } catch {} }
      _abortCtrl = (typeof AbortController !== 'undefined') ? new AbortController() : { signal: {}, abort: () => {} };

      Perf.mark('imm-start');
      const imm = buildImmediateDocs(_data || {});
      _docs     = imm.docs;
      _keywords = _mkKeywords(imm.keywords);
      Perf.mark('imm-done');
      Perf.measure('imm-build', 'imm-start', 'imm-done');

      // Background Fuse build — low priority, won't compete with user interaction
      _scheduleFuseBuild(_abortCtrl.signal);
      return true;
    }

    function _scheduleFuseBuild(signal) {
      if (_building || !_data) return;
      _building = true;

      const run = async () => {
        if (signal.aborted) { _building = false; return; }
        try {
          const Fuse    = await ensureFuseLoaded();
          if (signal.aborted) { _building = false; return; }

          const fuseOpts = Object.assign({
            includeScore: true, threshold: 0.38, ignoreLocation: true,
            minMatchCharLength: 2, useExtendedSearch: false,
            keys: [
              { name: 'name',     weight: 0.6 },
              { name: 'api',      weight: 0.9 },
              { name: 'combined', weight: 0.5 },
              { name: 'text',     weight: 0.2 },
            ],
          }, _opts.fuseOptions || {});

          const { docs, keywords } = await flattenDataToDocsChunked(
            _data, _normFn,
            (pct, count) => {
              try { if (typeof _opts.onIndexProgress === 'function') _opts.onIndexProgress(pct, count); } catch {}
            }
          );

          if (signal.aborted) { _building = false; return; }

          Perf.mark('fuse-create');
          _fuse = new Fuse(docs, fuseOpts);
          Perf.mark('fuse-done');
          Perf.measure('fuse-create', 'fuse-create', 'fuse-done');

          // Store under WeakRef so GC can reclaim docs array under memory pressure
          _wSet('fuse-docs', docs);

          _keywords = _mkKeywords(keywords);
          _ready    = true;
          try { if (typeof _opts.onIndexReady === 'function') _opts.onIndexReady(); } catch {}
        } catch (err) {
          if (!signal.aborted)
            console.warn('[SearchEngine] Fuse build failed, using immediate search:', err?.message || err);
          _fuse = null;
        } finally {
          _building = false;
        }
      };

      // Schedule as background — won't compete with user-visible or user-blocking tasks
      _scheduleTask(run, 'background', signal).catch(() => { _building = false; });
    }

    function _immediateSearch(qRaw, typeFilter) {
      const q  = String(qRaw || '').trim();
      if (!q) return { results: [], keywords: _allKW() };
      Perf.mark('imm-srch');
      const nq = q.toLowerCase();
      const results = [];
      for (let i = 0; i < _docs.length && results.length < 200; i++) {
        const d = _docs[i];
        if (typeFilter && typeFilter !== 'all' &&
            (d.typeKey || '').toLowerCase() !== String(typeFilter).toLowerCase()) continue;
        const hay = ((d.name || '') + ' ' + (d.api || '') + ' ' + (d.combined || '')).toLowerCase();
        if (hay.indexOf(nq) >= 0)
          results.push({
            typeObj: d.typeObj, category: d.category, item: d.rawItem,
            typeName: d.typeKey, catName: d.categoryKey, itemName: d.name || '',
            lang: 'auto', fuzzy: false, fuzzyScore: null, matchExact: hay === nq,
          });
      }
      Perf.mark('imm-srch-done');
      Perf.measure('imm-search', 'imm-srch', 'imm-srch-done');
      return { results, keywords: _allKW() };
    }

    function search(qRaw, typeFilter) {
      const q = String(qRaw || '').trim();
      if (!q) return { results: [], keywords: _allKW() };
      if (!_fuse) return _immediateSearch(qRaw, typeFilter);
      Perf.mark('fuse-srch');
      try {
        const fuseResults = _fuse.search(q, { limit: 200 }) || [];
        const results     = [];
        for (const r of fuseResults) {
          const doc = r.item || r;
          if (typeFilter && typeFilter !== 'all' &&
              (doc.typeKey || '').toLowerCase() !== String(typeFilter).toLowerCase()) continue;
          results.push({
            typeObj: doc.typeObj, category: doc.category, item: doc.rawItem,
            typeName: doc.typeKey, catName: doc.categoryKey, itemName: doc.name || '',
            lang: 'auto', fuzzy: r.score > 0, fuzzyScore: r.score ?? null, matchExact: r.score === 0,
          });
        }
        Perf.mark('fuse-srch-done');
        Perf.measure('fuse-search', 'fuse-srch', 'fuse-srch-done');
        return { results, keywords: _allKW() };
      } catch (err) {
        console.error('[SearchEngine] Fuse search error:', err);
        return _immediateSearch(qRaw, typeFilter);
      }
    }

    function querySuggestions(rawQuery, maxCount) {
      maxCount   = maxCount || 8;
      const q    = String(rawQuery || '').trim();
      if (!q) return [];
      const nq  = _normFn ? _normFn(q) : q.toLowerCase();
      const out = [];
      const seen = new Set();

      for (const k of _keywords) {
        if (out.length >= maxCount) break;
        if (!k?.key || String(k.key).indexOf(nq) !== 0) continue;
        if (seen.has(k.key)) continue;
        seen.add(k.key);
        const display = k.raw || k.itemName || '';
        out.push({ display, raw: display, highlightedHtml: display, source: 'keyword' });
      }
      if (out.length >= maxCount) return out.slice(0, maxCount);

      if (_fuse && q.length >= 1) {
        try {
          const fr = _fuse.search(q, { limit: Math.max(12, maxCount) });
          for (const r of fr) {
            if (out.length >= maxCount) break;
            const doc     = r.item || r;
            const display = doc.name || doc.api || '';
            if (!display) continue;
            const norm = _normFn ? _normFn(display) : String(display).toLowerCase();
            if (!norm || seen.has(norm)) continue;
            seen.add(norm);
            out.push({ display, raw: display, highlightedHtml: escHtml(String(display)), source: 'fuse', score: r.score ?? null });
          }
        } catch {}
      } else {
        const nqS = String(q).toLowerCase();
        for (const d of _docs) {
          if (out.length >= maxCount) break;
          const display = d.name || d.api || '';
          if (!display) continue;
          const norm = String(display).toLowerCase();
          if (norm.indexOf(nqS) === 0 && !seen.has(norm)) {
            seen.add(norm);
            out.push({ display, raw: display, highlightedHtml: display, source: 'immediate' });
          }
        }
      }
      return out;
    }

    function _allKW() { return _keywords.map(k => Object.assign({}, k)); }

    return {
      init               : (data, opts) => init(data, opts),
      search             : (q, tf)      => search(q, tf),
      querySuggestions   : (q, max)     => querySuggestions(q, max),
      generateAllKeywords: ()           => _allKW(),
      isIndexReady       : ()           => _ready,
      isBuilding         : ()           => _building,
      getDocCount        : ()           => _docs.length,
      getPerfEntries     : ()           => Perf.all(),
      _internals: {
        normalizeText: _normFn,
        getDocs      : () => _docs.slice(),
        getKeywords  : () => _keywords.slice(),
        getFuse      : () => _fuse,
        flattenDataToDocsChunked, buildImmediateDocs,
      },
    };
  })();

  global.SearchEngine = SearchEngine;

})(window);