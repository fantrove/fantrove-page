/*
  search-engine.refactored.js
  - Pure search engine module with pluggable normalizer/tokenizer/scorer
  - Basic inverted token index for faster candidate selection
  - Worker-ready message API (lightweight wrapper)
  - Exposes window.SearchEngine for compatibility:
      init({data, options})
      generateAllKeywords()
      querySuggestions(q, maxCount)
      search(q, typeFilter)
  - Internals exported under _internals for debugging and tests
*/
(function (global) {
  'use strict';

  // ---------- Utilities ----------
  function isEmpty(v) { return v === null || v === undefined || v === ''; }

  // Normalizer: single place for text normalization; pluggable via options
  function defaultNormalizeText(s) {
    if (!s && s !== 0) return '';
    s = String(s).toLowerCase().trim();
    try { s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
    s = s.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'").replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
    s = s.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    // replace non letters/numbers/spaces with space, keep unicode letters
    s = s.replace(/[^\p{L}\p{N}\s]+/gu, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  function containsThai(s){ return /[\u0E00-\u0E7F]/.test(String(s||'')); }
  function containsLatin(s){ return /[A-Za-z]/.test(String(s||'')); }

  function isLikelyCode(s) {
    const str = String(s||'').trim();
    if (!str) return false;
    if (/^[A-Za-z0-9_\-\/\.\:\~\+\=\#]+$/.test(str) && str.length <= 80) return true;
    return false;
  }

  function scriptsCompatible(query, target){
    if (!query) return true;
    const qHasThai = containsThai(query);
    const qHasLatin = containsLatin(query);
    if (qHasThai) return containsThai(target);
    if (qHasLatin) return containsLatin(target);
    return true;
  }

  // ---------- Levenshtein (fast) ----------
  function levenshtein(a,b){
    if (a===b) return 0;
    const al=a.length, bl=b.length;
    if (!al) return bl;
    if (!bl) return al;
    let v0 = new Uint16Array(bl+1), v1 = new Uint16Array(bl+1);
    for (let i=0;i<=bl;i++) v0[i]=i;
    for (let i=0;i<al;i++){
      v1[0]=i+1;
      for (let j=0;j<bl;j++){
        v1[j+1]=Math.min(v1[j]+1, v0[j+1]+1, v0[j] + (a[i]===b[j]?0:1));
      }
      let t=v0; v0=v1; v1=t;
    }
    return v0[bl];
  }

  // ---------- i18n-lite helper ----------
  function pickLang(obj, langs){
    if (!obj || typeof obj !== 'object') return obj;
    for (let i=0;i<langs.length;i++) if (obj[langs[i]]) return obj[langs[i]];
    for (const k in obj) return obj[k];
    return '';
  }

  // ---------- Indexer (simple inverted index) ----------
  // Creates:
  // - keywords: array of keyword entries ({ key, typeObj, category, item, itemName, catName, typeName, lang, flags... })
  // - tokenIndex: token -> Set of keyword indices
  function buildKeywordIndex(data, normalizeFn) {
    const keywords = [];
    const tokenIndex = Object.create(null);

    function addKeywordEntry(entry) {
      const idx = keywords.length;
      keywords.push(entry);
      const tokens = tokenizeForIndex(entry.key || '', normalizeFn);
      for (let i=0;i<tokens.length;i++){
        const t = tokens[i];
        if (!tokenIndex[t]) tokenIndex[t] = new Set();
        tokenIndex[t].add(idx);
      }
    }

    const langs = getAllAvailableLangs(data);
    if (!data || !Array.isArray(data.type)) return { keywords: [], tokenIndex: {} };

    for (let i=0;i<data.type.length;i++){
      const typeObj = data.type[i];
      for (let l=0;l<langs.length;l++){
        const lang = langs[l];
        const typeName = pickLang(typeObj.name, [lang]);
        if (typeName) addKeywordEntry({ typeObj, typeName, lang, key: normalizeFn(typeName), isType: true });
      }
      const categories = typeObj.category || [];
      for (let j=0;j<categories.length;j++){
        const cat = categories[j];
        for (let l=0;l<langs.length;l++){
          const lang = langs[l];
          const catName = pickLang(cat.name, [lang]);
          if (catName) addKeywordEntry({ typeObj, category: cat, typeName: pickLang(typeObj.name, [lang]), catName, lang, key: normalizeFn(catName), isCategory: true });
        }
        const items = cat.data || [];
        for (let x=0;x<items.length;x++){
          const item = items[x];
          for (let l=0;l<langs.length;l++){
            const lang = langs[l];
            const itemName = pickLang(item.name, [lang]);
            if (itemName) addKeywordEntry({ typeObj, category: cat, item, typeName: pickLang(typeObj.name, [lang]), catName: pickLang(cat.name,[lang]), itemName, lang, key: normalizeFn(itemName) });
          }
          for (const k in item) {
            if (/_name$/.test(k) && typeof item[k] === 'object') {
              for (let l=0;l<langs.length;l++){
                const lang = langs[l];
                const vVal = pickLang(item[k],[lang]);
                if (vVal) addKeywordEntry({ typeObj, category: cat, item, typeName: pickLang(typeObj.name,[lang]), catName: pickLang(cat.name,[lang]), itemName: vVal, lang, key: normalizeFn(vVal) });
              }
            }
          }
          if (item.api) addKeywordEntry({ typeObj, category: cat, item, typeName: pickLang(typeObj.name, langs), catName: pickLang(cat.name, langs), itemName: pickLang(item.name, langs), lang: 'api', key: normalizeFn(item.api || '') });
        }
      }
    }
    return { keywords, tokenIndex };
  }

  // Tokenization used for index: split normalized string on spaces and also produce substrings (prefixes)
  function tokenizeForIndex(normStr, normalizeFn) {
    if (!normStr) return [];
    const parts = String(normStr).split(/\s+/).filter(Boolean);
    const out = new Set();
    for (let p of parts) {
      out.add(p);
      // add prefixes to help startsWith search
      for (let i=2;i<=Math.min(6, p.length);i++){
        out.add(p.substring(0,i));
      }
      // also add full string for multi-word
      if (parts.length > 1) out.add(parts.join(' '));
    }
    return Array.from(out);
  }

  // Retrieve all languages available in dataset (same logic as original)
  function getAllAvailableLangs(data) {
    const langs = Object.create(null);
    if (!data || !Array.isArray(data.type)) return ['en'];
    for (let i=0;i<data.type.length;i++) {
      const typeObj = data.type[i];
      if (typeof typeObj.name === 'object') for (const k in typeObj.name) langs[k]=1;
      const categories = typeObj.category || [];
      for (let j=0;j<categories.length;j++) {
        const cat = categories[j];
        if (typeof cat.name === 'object') for (const k in cat.name) langs[k]=1;
        const items = cat.data || [];
        for (let x=0;x<items.length;x++) {
          const item = items[x];
          if (typeof item.name === 'object') for (const k in item.name) langs[k]=1;
          for (const k in item) if (/_name$/.test(k) && typeof item[k] === 'object') for (const l in item[k]) langs[l]=1;
        }
      }
    }
    return Object.keys(langs);
  }

  // ---------- Scoring helpers ----------
  const computeRelevanceScore = (query,target,baseScore=100) => (!target ? baseScore : (() => {
    let s = levenshtein(query, target);
    if (target.startsWith(query)) s -= 2;
    if (target.includes(query)) s -= 1;
    return s;
  })());

  function keywordExactSubstringMatch(query, allKeywords) {
    if (!query) return false;
    const nq = String(query);
    for (let i=0;i<allKeywords.length;i++) if ((allKeywords[i].key||'').includes(nq)) return true;
    return false;
  }

  // ---------- Query processing ----------
  function getBestKeywordMatches(query, allKeywords, tokenIndex, normalizeFn, maxCount=12, allowGuess=true) {
    if (!query) return [];
    const nq = normalizeFn(query);
    if (!allowGuess && keywordExactSubstringMatch(nq, allKeywords)) return [];
    // find candidate indices by tokens
    const tokens = tokenizeForIndex(nq, normalizeFn);
    const candSet = new Set();
    for (let t of tokens) {
      const s = tokenIndex[t];
      if (s) {
        for (let idx of s) candSet.add(idx);
      }
    }
    // fallback: if no candidates, consider all
    const candidateIndices = candSet.size ? Array.from(candSet) : allKeywords.map((_,i)=>i);
    const out = [];
    for (let i=0;i<candidateIndices.length;i++){
      const k = allKeywords[candidateIndices[i]];
      let sarr = [computeRelevanceScore(nq, k.key||'', 100)];
      if (k.isCategory && k.catName) sarr.push(computeRelevanceScore(nq, normalizeFn(k.catName), 110));
      if (k.typeName) sarr.push(computeRelevanceScore(nq, normalizeFn(k.typeName), 110));
      if (k.itemName) sarr.push(computeRelevanceScore(nq, normalizeFn(k.itemName), 120));
      if (k.item) {
        if (k.item.api) sarr.push(computeRelevanceScore(nq, normalizeFn(k.item.api), 125));
      }
      k._score = Math.min.apply(null, sarr);
      out.push(k);
    }
    out.sort((a,b) => a._score - b._score);
    let seen = new Set(), uniq=[], cnt=0;
    for (let i=0;i<out.length && cnt<maxCount;i++){
      const k = out[i];
      if (k._score > 5) break;
      const uniqKey = k.isType ? `type|${k.typeName}|${k.lang}` : k.isCategory ? `cat|${k.typeName}|${k.catName}|${k.lang}` : `item|${k.typeName}|${k.catName}|${k.item && (k.item.api||'')}`;
      if (!seen.has(uniqKey)) { seen.add(uniqKey); uniq.push(Object.assign({}, k, { fuzzyScore: k._score })); ++cnt; }
    }
    return uniq;
  }

  // ---------- Smart search returning result objects ----------
  function smartSearch(data, rawQuery, typeFilter, allKeywords, tokenIndex, normalizeFn) {
    const qRaw = String(rawQuery || '').trim();
    const q = normalizeFn(qRaw);
    if (!q) return [];
    let results = [];
    const langs = getAllAvailableLangs(data);
    if (!data || !Array.isArray(data.type)) return results;
    for (let i=0;i<data.type.length;i++){
      const typeObj = data.type[i];
      for (let l=0;l<langs.length;l++){
        const lang = langs[l];
        const typeLabel = pickLang(typeObj.name, [lang]);
        if (typeFilter !== 'all' && pickLang(typeObj.name,['en']) !== typeFilter && pickLang(typeObj.name,[lang]) !== typeFilter) {
          if (typeFilter !== 'all') continue;
        }
        const cats = typeObj.category || [];
        for (let j=0;j<cats.length;j++){
          const cat = cats[j];
          const catName = pickLang(cat.name, [lang]);
          const items = cat.data || [];
          for (let x=0;x<items.length;x++){
            const item = items[x];
            const tokens = [];
            if (item.name) tokens.push(normalizeFn(pickLang(item.name, [lang])));
            for (const k in item) if (/_name$/.test(k) && item[k]) tokens.push(normalizeFn(pickLang(item[k],[lang])));
            if (catName) tokens.push(normalizeFn(catName));
            if (item.text) tokens.push(normalizeFn(item.text));
            if (item.api) tokens.push(normalizeFn(item.api));
            const flat = Array.from(new Set(tokens.filter(Boolean)));
            let isMatch = false;
            let bestFuzz = Infinity;
            for (let f=0; f<flat.length; f++){
              const txt = flat[f];
              if (!txt) continue;
              if (!scriptsCompatible(qRaw, txt)) continue;
              if (txt === q) { isMatch = true; bestFuzz = 0; break; }
              if (txt.startsWith(q)) { isMatch = true; bestFuzz = Math.min(bestFuzz, 1); }
              if (txt.includes(q)) { isMatch = true; bestFuzz = Math.min(bestFuzz, 2); }
              bestFuzz = Math.min(bestFuzz, levenshtein(q, txt));
            }
            const maxFuzzAllowed = Math.max(1, Math.min(2, Math.floor(q.length * 0.18)));
            const isFuzzy = !isMatch && bestFuzz <= maxFuzzAllowed;
            if (isMatch || isFuzzy) {
              const itemName = pickLang(item.name || {}, [lang]) || '';
              results.push({
                typeObj, category: cat, item,
                typeName: typeLabel, catName: catName, itemName: itemName,
                lang, fuzzy: !isMatch && isFuzzy, fuzzyScore: bestFuzz, matchExact: bestFuzz === 0
              });
            }
          }
        }
      }
    }
    // If any exact substring among keywords exists, prefer non-fuzzy
    if (keywordExactSubstringMatch(q, allKeywords)) {
      const sub = results.filter(r => !r.fuzzy);
      if (sub.length) results = sub;
    }
    // scoring & sort
    results.forEach(r => {
      let score = 10 + (r.fuzzyScore || 0);
      const normItemName = normalizeFn(r.itemName || '');
      const normApi = normalizeFn(r.item && r.item.api || '');
      const normCat = normalizeFn(r.catName || '');
      const normType = normalizeFn(r.typeName || '');
      if (normItemName === q || normApi === q || normCat === q || normType === q) score = 0;
      else if ((normItemName && normItemName.startsWith(q)) || (normApi && normApi.startsWith(q)) || (normCat && normCat.startsWith(q)) || (normType && normType.startsWith(q))) score = 1;
      else if ((normItemName && normItemName.includes(q)) || (normApi && normApi.includes(q)) || (normCat && normCat.includes(q)) || (normType && normType.includes(q))) score = 2;
      else if (r.fuzzy) score = 3 + (r.fuzzyScore || 0);
      r._score = score;
    });
    results.sort((a,b) => a._score - b._score);
    return results;
  }

  // ---------- HTML highlight helper (kept simple) ----------
  function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function highlightMatchesHtml(text, query, normalizeFn) {
    if (!text) return '';
    if (!query) return escapeHtml(text);
    const normQuery = normalizeFn(query);
    try {
      const normText = normalizeFn(text);
      let startIdx = normText.indexOf(normQuery);
      if (startIdx !== -1) {
        // naive character-by-character mapping that respects original chars
        let out = '';
        let qi = 0;
        for (let i=0;i<text.length;i++) {
          const ch = text[i];
          const nch = normalizeFn(ch);
          if (nch && nch.length && qi < normQuery.length && normQuery.indexOf(nch) !== -1 && normalizeFn(text.substr(i,1)) === nch && normQuery[qi] === nch) {
            out += '<strong>' + escapeHtml(ch) + '</strong>';
            qi++;
          } else {
            out += escapeHtml(ch);
          }
        }
        return out;
      }
    } catch (e) {}
    // fallback: highlight any char that appears in query
    const nqSet = new Set(Array.from(normQuery));
    let out = '';
    for (let i=0;i<text.length;i++) {
      const ch = text[i];
      const nch = normalizeFn(ch);
      if (nch && nch.length && nqSet.has(nch[0])) out += '<strong>' + escapeHtml(ch) + '</strong>';
      else out += escapeHtml(ch);
    }
    return out;
  }

  // ---------- Worker adapter (lightweight) ----------
  // This adapter exposes same API but delegates init/query to worker if available.
  // For now it's a thin wrapper; actual worker file is not inlined here. Use option.useWorker = true to enable.
  function createWorkerAdapter() {
    let worker = null;
    let ready = false;
    let queue = [];
    function post(msg) {
      if (worker && ready) worker.postMessage(msg);
      else queue.push(msg);
    }
    function initWorker(blobUrl) {
      if (!window.Worker) return null;
      try {
        worker = new Worker(blobUrl);
        worker.onmessage = (ev) => {
          const d = ev.data;
          if (d && d.type === '__ready') {
            ready = true;
            while (queue.length) worker.postMessage(queue.shift());
          }
        };
        return worker;
      } catch (e) { return null; }
    }
    return { initWorker, post, setOnMessage: (fn) => { if (worker) worker.onmessage = (e)=>fn(e.data); } };
  }

  // ---------- SearchEngine public API & state ----------
  const SearchEngine = (function(){
    let _data = null;
    let _keywords = [];
    let _tokenIndex = {};
    let _normalize = defaultNormalizeText;
    let _options = { useWorker: false };
    return {
      init: function(data, options) {
        options = options || {};
        _options = Object.assign({}, _options, options);
        _data = data || null;
        _normalize = options.normalizeFn || defaultNormalizeText;
        const idx = buildKeywordIndex(_data || {}, _normalize);
        _keywords = idx.keywords || [];
        _tokenIndex = idx.tokenIndex || {};
        return Promise.resolve(true);
      },
      // expose current keywords (shallow copy)
      generateAllKeywords: function() { return _keywords.slice(); },

      // query suggestions: prefer tokenIndex lookup then fuzzy scoring
      querySuggestions: function(rawQuery, maxCount) {
        maxCount = maxCount || 8;
        const q = String(rawQuery||'').trim();
        if (!q) return [];
        const matches = getBestKeywordMatches(q, _keywords, _tokenIndex, _normalize, Math.max(12, maxCount), true);
        if (!matches || !matches.length) return [];
        const seen = new Set();
        const out = [];
        const queryHasThai = containsThai(rawQuery);
        for (let i=0;i<matches.length && out.length < maxCount;i++){
          const s = matches[i];
          const candidates = [];
          if (s.item) {
            const it = s.item;
            const itemName = it.name ? pickLang(it.name, ['en']) : (s.itemName||'');
            if (itemName) candidates.push({ raw: itemName, source: 'item' });
            if (it.api) candidates.push({ raw: it.api, source: 'api' });
            if (s.catName) candidates.push({ raw: s.catName, source: 'category' });
            if (s.typeName) candidates.push({ raw: s.typeName, source: 'type' });
          } else if (s.isCategory && s.category) {
            const catName = pickLang(s.category.name||{}, ['en']) || s.catName || '';
            if (catName) candidates.push({ raw: catName, source: 'category' });
            const items = s.category.data || [];
            for (let k=0;k<items.length;k++){
              const it = items[k];
              const itName = it && it.name ? pickLang(it.name, ['en']) : (it && it.api ? it.api : '');
              if (itName) candidates.push({ raw: itName, source: 'item' });
            }
            if (s.typeName) candidates.push({ raw: s.typeName, source: 'type' });
          } else if (s.isType && s.typeObj) {
            const typeName = pickLang(s.typeObj.name||{}, ['en']) || s.typeName || '';
            if (typeName) candidates.push({ raw: typeName, source: 'type' });
            const cats = s.typeObj.category || [];
            for (let c=0;c<cats.length;c++){
              const cat = cats[c];
              const catName = pickLang(cat.name||{}, ['en']) || '';
              if (catName) candidates.push({ raw: catName, source: 'category' });
            }
          } else {
            if (s.itemName) candidates.push({ raw: s.itemName, source: 'item' });
            else if (s.key) candidates.push({ raw: s.key, source: 'keyword' });
          }

          for (let cidx=0;cidx<candidates.length && out.length < maxCount;cidx++){
            const cand = candidates[cidx];
            if (!cand || !cand.raw) continue;
            const raw = String(cand.raw).trim();
            const norm = _normalize(raw);
            if (!norm) continue;
            if (!scriptsCompatible(rawQuery, raw)) continue;
            if (norm.indexOf(_normalize(q)) === -1) {
              const dist = levenshtein(_normalize(q), norm);
              if (!(_normalize(q).length <= 3 && dist <= 1)) continue;
            }
            if (queryHasThai && isLikelyCode(raw)) continue;
            if (seen.has(norm)) continue;
            seen.add(norm);
            out.push({ display: raw, raw: raw, highlightedHtml: highlightMatchesHtml(raw, rawQuery, _normalize), source: cand.source });
          }
        }
        return out;
      },

      // main search entrypoint that returns results & keywords
      search: function(q, typeFilter) {
        const keywords = _keywords;
        const results = smartSearch(_data, q, typeFilter || 'all', keywords, _tokenIndex, _normalize);
        return { results: results, keywords: keywords };
      },

      // debug internals
      _internals: {
        normalizeText: _normalize,
        levenshtein,
        buildKeywordIndex,
        tokenizeForIndex,
        getAllAvailableLangs
      }
    };
  })();

  // export global for backward compatibility
  global.SearchEngine = SearchEngine;

})(window);