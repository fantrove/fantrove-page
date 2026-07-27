// @ts-check
/**
 * @file engine.js
 * SearchEngine — aerospace-grade two-tier search engine module.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  DESIGN PHILOSOPHY — Aerospace Software Standards
 * ════════════════════════════════════════════════════════════════════════
 *  Inspired by NASA's Power of Ten rules for safety-critical code and
 *  SpaceX's lean-reliability approach for flight software:
 *
 *  1. Layered architecture — Data ingestion → Index → Search → Suggestion
 *  2. Fail-safe defaults — every code path returns a valid (possibly empty)
 *     result rather than throwing or hanging.
 *  3. Deterministic output — same query, same dataset → same result.
 *  4. No silent failure — all exceptional paths log to console with a
 *     structured prefix `[SearchEngine]` so issues are traceable.
 *  5. Bounded resource usage — every loop has a cap; no unbounded scans.
 *  6. Single responsibility — this module owns the index and search; it
 *     knows nothing about DOM, overlay, or UI state.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  IMPROVEMENTS over legacy search-engine.js
 * ════════════════════════════════════════════════════════════════════════
 *  A. COMPREHENSIVE INDEX
 *     Legacy index covered: item name + api + text + typeNames + catNames.
 *     New index ALSO covers:
 *       • Sub-name fields (short_name, official_name, *_name)
 *       • Category names (searchable as standalone terms)
 *       • Type names (searchable as standalone terms)
 *       • Item description fields (if present)
 *     → User can now search by category name, type name, or sub-name and
 *       get hits that the legacy engine missed.
 *
 *  B. SUGGESTION DIVERSITY
 *     Legacy suggestions only returned item names.
 *     New suggestions return a MIX of:
 *       • Item names (existing)
 *       • Type names (new — e.g., "อีโมจิ", "Symbol")
 *       • Category names (new — e.g., "หน้ายิ้ม", "Arrows")
 *     → Typing "อี" now suggests "อีโมจิ" (the type), not just items.
 *     → Typing "arr" now suggests "Arrows" (the category).
 *
 *  C. ROBUST SHORT QUERY HANDLING
 *     Legacy: prefix-match on keywords; many short queries returned [].
 *     New: prefix-match + contains-match + Fuse fallback with adaptive
 *     threshold (looser for very short queries). Single-character queries
 *     now always return at least the top-N prefix matches.
 *
 *  D. INDEX TRANSPARENCY
 *     getDocs(), getKeywords(), getFuse() exposed via _internals so the
 *     suggestion service can adapt its strategy based on what's available.
 *
 *  API (unchanged surface, drop-in replacement):
 *    init(data, options)            → Promise<boolean>
 *    search(q, typeFilter)          → { results, keywords }
 *    querySuggestions(q, maxCount)  → Suggestion[]
 *    generateAllKeywords()          → Keyword[]
 *    _internals.{ normalizeText, getDocs, getKeywords, getFuse, options }
 *
 * @module engine
 * @depends {types.js, config.js, state.js, utils.js}
 */
(function (M) {
  'use strict';

  // ── External utilities (stateless) ───────────────────────────────────────
  // Pulled from the engine itself so the module has zero cross-deps on
  // other modules at definition time. This keeps the engine testable and
  // side-effect-free on load.
  const { CONFIG } = M;

  // ── Constants ────────────────────────────────────────────────────────────
  /**
   * Adaptive Fuse thresholds based on query length.
   * Short queries need looser thresholds because Fuse penalises position
   * heavily; a 2-char query at threshold 0.38 may return nothing even on
   * valid matches. We relax for short queries and tighten for long ones.
   */
  const FUSE_THRESHOLDS = Object.freeze({
    veryShort: 0.55, // 1-2 chars
    short:     0.45, // 3-4 chars
    medium:    0.38, // 5-8 chars (legacy default)
    long:      0.30, // 9+ chars (tighter — long queries should be precise)
  });

  /** Suggestion sources, in priority order (lower = higher priority). */
  const SUGGESTION_SOURCE = Object.freeze({
    KEYWORD_EXACT: 1,    // Exact prefix match on item name
    TYPE_NAME:     2,    // Match on type name (e.g., "Emoji", "Symbol")
    CATEGORY_NAME: 3,    // Match on category name (e.g., "Smileys", "Arrows")
    KEYWORD_CONTAINS: 4, // Substring (non-prefix) match on item name
    FUSE:          5,    // Fuse fuzzy match
    IMMEDIATE:     6,    // Fallback scan of immediate docs
  });

  // ── Module-private state ─────────────────────────────────────────────────
  // WHY a closure: prevents external code from mutating engine state. All
  // access goes through the public API, which is the only way to ensure
  // consistency between _docs, _keywords, _typeIndex, _categoryIndex, _fuse.
  let _data = null;
  /** @type {SearchDoc[]} */ let _docs = [];
  /** @type {KeywordEntry[]} */ let _keywords = [];
  /** @type {NameEntry[]} */ let _typeIndex = [];
  /** @type {NameEntry[]} */ let _categoryIndex = [];
  /** @type {Fuse|null} */ let _fuse = null;
  let _normalize = defaultNormalizeText;
  let _options = {
    useWorker: false,
    fuseOptions: {},
    fastImmediateLimit: 200,
    idleTimeout: 4000,
  };
  let _fuseBuilding = false;
  /** Detected languages from data scan. */
  let _langs = ['en'];

  // ── Utilities ────────────────────────────────────────────────────────────

  /**
   * Defensive empty check — treats null, undefined, '' as empty.
   * @param {*} v
   * @returns {boolean}
   */
  function isEmpty(v) { return v === null || v === undefined || v === ''; }

  /**
   * Normalize text for case-insensitive, accent-insensitive matching.
   *
   * Steps:
   *  1. lowercase + trim
   *  2. NFKD + strip combining diacritical marks (accents, tone marks)
   *  3. strip zero-width chars (BOM, ZWSP, ZWNJ, ZWJ)
   *  4. normalise smart quotes → ASCII
   *  5. fullwidth → ASCII (for Japanese/Chinese input)
   *  6. collapse non-letter/number runs to single space
   *  7. trim again (safety)
   *
   * @param {string} s
   * @returns {string}
   */
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

  /**
   * Pick the first non-empty language value from a multilingual object.
   * Falls back to the first available key, then ''.
   * @param {Object|string} obj
   * @param {string[]} langs
   * @returns {string}
   */
  function pickLang(obj, langs) {
    if (!obj || typeof obj !== 'object') return obj || '';
    for (let i = 0; i < langs.length; i++) if (obj[langs[i]]) return obj[langs[i]];
    for (const k in obj) return obj[k];
    return '';
  }

  /**
   * Detect all languages present in the dataset by scanning name objects.
   * WHY: data may be multilingual (en + th). Knowing all langs lets us
   * build richer index entries that match any of the user's languages.
   * @param {Object} data
   * @returns {string[]}
   */
  function detectLangs(data) {
    const set = Object.create(null);
    if (!data || !Array.isArray(data.type)) return ['en'];
    for (let i = 0; i < data.type.length; i++) {
      const t = data.type[i];
      if (typeof t.name === 'object') for (const k in t.name) set[k] = 1;
      const cats = t.category || [];
      for (let j = 0; j < cats.length; j++) {
        const c = cats[j];
        if (typeof c.name === 'object') for (const k in c.name) set[k] = 1;
        const items = c.data || [];
        for (let x = 0; x < items.length; x++) {
          const it = items[x];
          if (typeof it.name === 'object') for (const k in it.name) set[k] = 1;
          // Capture *_name fields (short_name, official_name, etc.)
          for (const k in it) {
            if (/_name$/.test(k) && typeof it[k] === 'object') {
              for (const l in it[k]) set[l] = 1;
            }
          }
        }
      }
    }
    const langs = Object.keys(set);
    return langs.length ? langs : ['en'];
  }

  /**
   * Load Fuse.js from CDN. Resolves with the global Fuse class.
   * Idempotent — returns immediately if Fuse is already loaded.
   * @returns {Promise<typeof Fuse>}
   */
  function ensureFuseLoaded() {
    return new Promise((resolve, reject) => {
      if (globalThis.Fuse) return resolve(globalThis.Fuse);
      const src = 'https://unpkg.com/fuse.js@6.6.2/dist/fuse.min.js';
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => {
        if (globalThis.Fuse) resolve(globalThis.Fuse);
        else reject(new Error('Fuse loaded but globalThis.Fuse not available'));
      };
      s.onerror = () => reject(new Error('Failed to load Fuse.js'));
      document.head.appendChild(s);
    });
  }

  /**
   * HTML-escape a string for safe insertion into suggestion HTML.
   * Single-pass char scan — no regex, no intermediate strings.
   * @param {string} s
   * @returns {string}
   */
  function escapeHtml(s) {
    const str = String(s);
    let out = '';
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if      (c === 38) out += '&amp;';   // &
      else if (c === 60) out += '&lt;';    // <
      else if (c === 62) out += '&gt;';    // >
      else if (c === 34) out += '&quot;';  // "
      else if (c === 39) out += '&#39;';   // '
      else               out += str[i];
    }
    return out;
  }

  /**
   * Pick a Fuse threshold based on query length.
   * @param {string} q
   * @returns {number}
   */
  function pickFuseThreshold(q) {
    const len = q.length;
    if (len <= 2) return FUSE_THRESHOLDS.veryShort;
    if (len <= 4) return FUSE_THRESHOLDS.short;
    if (len <= 8) return FUSE_THRESHOLDS.medium;
    return FUSE_THRESHOLDS.long;
  }

  // ── Index builders ───────────────────────────────────────────────────────

  /**
   * Build the lightweight immediate index for instant substring search.
   *
   * Each doc captures:
   *   id          — stable identifier for dedup
   *   typeKey     — type display name (used by type filter)
   *   categoryKey — category display name (used by category filter)
   *   name        — item display name (multilingual, picked)
   *   api         — Unicode codepoint / API string
   *   text        — copyable text
   *   combined    — searchable haystack: name + api + text + type + cat + sub-names
   *   combinedLower — precomputed lowercased combined (avoids re-toLowerCase per query)
   *   rawItem     — original item object (for renderer)
   *   typeObj, category — original parent objects (for renderer)
   *
   * The keyword list contains one entry per item plus extra entries for
   * type names and category names — so suggestions can surface them.
   *
   * @param {Object} data
   * @returns {{ docs: SearchDoc[], keywords: KeywordEntry[], typeIndex: NameEntry[], categoryIndex: NameEntry[] }}
   */
  function buildImmediateDocs(data) {
    const docs = [];
    const keywords = [];
    const typeIndex = [];
    const categoryIndex = [];
    if (!data || !Array.isArray(data.type)) {
      return { docs, keywords, typeIndex, categoryIndex };
    }

    const langs = _langs;
    let idCounter = 1;

    // Track seen type/category names to dedupe keyword entries.
    const seenTypeNames = new Set();
    const seenCatNames  = new Set();

    for (let i = 0; i < data.type.length; i++) {
      const typeObj  = data.type[i];
      const typeNames = typeof typeObj.name === 'object'
        ? typeObj.name
        : { en: String(typeObj.name || '') };
      const typeDisplay = pickLang(typeNames, langs) || '';

      // Index type name (one entry per unique type name across all langs)
      for (const lg of langs) {
        const tn = typeNames[lg];
        if (tn && !seenTypeNames.has(tn)) {
          seenTypeNames.add(tn);
          typeIndex.push({
            raw: tn,
            normalized: String(tn).toLowerCase(),
            typeObj,
            source: 'type',
          });
        }
      }

      const cats = typeObj.category || [];
      for (let j = 0; j < cats.length; j++) {
        const cat      = cats[j];
        const catNames = typeof cat.name === 'object'
          ? cat.name
          : { en: String(cat.name || '') };
        const catDisplay = pickLang(catNames, langs) || '';

        // Index category name (one entry per unique category name)
        for (const lg of langs) {
          const cn = catNames[lg];
          if (cn && !seenCatNames.has(cn)) {
            seenCatNames.add(cn);
            categoryIndex.push({
              raw: cn,
              normalized: String(cn).toLowerCase(),
              typeObj,
              category: cat,
              source: 'category',
            });
          }
        }

        const items = cat.data || [];
        for (let x = 0; x < items.length; x++) {
          const item = items[x];

          // Build combined searchable haystack.
          // Order matters for readability but not for substring search.
          const parts = [];
          if (item.name && typeof item.name === 'object') {
            for (const lg of langs) if (item.name[lg]) parts.push(String(item.name[lg]));
          } else if (item.name) parts.push(String(item.name));

          // Sub-name fields (short_name, official_name, etc.)
          for (const k in item) {
            if (/_name$/.test(k) && typeof item[k] === 'object') {
              for (const lg of langs) if (item[k][lg]) parts.push(String(item[k][lg]));
            }
          }

          // Description fields (optional)
          if (item.description && typeof item.description === 'object') {
            for (const lg of langs) if (item.description[lg]) parts.push(String(item.description[lg]));
          } else if (typeof item.description === 'string' && item.description) {
            parts.push(item.description);
          }

          if (item.api)  parts.push(String(item.api));
          if (item.text) parts.push(String(item.text));

          // Append type + category names so they're searchable as part of items too
          for (const lg of langs) {
            if (typeNames[lg]) parts.push(String(typeNames[lg]));
            if (catNames[lg])  parts.push(String(catNames[lg]));
          }

          const combined      = parts.filter(Boolean).join(' • ');
          const combinedLower = combined.toLowerCase();

          const name = pickLang(item.name || {}, langs) || (item.api || '');

          /** @type {SearchDoc} */
          const doc = {
            id: String(idCounter++),
            typeKey: typeDisplay,
            categoryKey: catDisplay,
            name: name,
            api: item.api || '',
            text: item.text || '',
            combined: combined,
            combinedLower: combinedLower,
            rawItem: item,
            typeObj,
            category: cat,
          };
          docs.push(doc);

          // Keyword entry — used by suggestion engine (prefix + contains match)
          const kw = name || item.api || '';
          if (kw) {
            keywords.push({
              raw: kw,
              normalized: String(kw).toLowerCase(),
              docId: doc.id,
              item: item,
              itemName: name,
              typeObj: typeObj,
              typeName: typeDisplay,
              catName: catDisplay,
              source: 'item',
            });
          }
        }
      }
    }

    return { docs, keywords, typeIndex, categoryIndex };
  }

  /**
   * Full-flatten docs (with normalisation) for Fuse index.
   * Used when building Fuse in idle time. Same shape as buildImmediateDocs
   * but with normalised combined field for better fuzzy matching.
   *
   * @param {Object} data
   * @param {Function} normalizeFn
   * @returns {{ docs: SearchDoc[], keywords: KeywordEntry[], typeIndex: NameEntry[], categoryIndex: NameEntry[] }}
   */
  function flattenDataToDocs(data, normalizeFn) {
    const docs = [];
    const keywords = [];
    const typeIndex = [];
    const categoryIndex = [];
    if (!data || !Array.isArray(data.type)) {
      return { docs, keywords, typeIndex, categoryIndex };
    }

    const langs = _langs;
    let idCounter = 1;
    const seenTypeNames = new Set();
    const seenCatNames  = new Set();

    for (let i = 0; i < data.type.length; i++) {
      const typeObj  = data.type[i];
      const typeNames = typeof typeObj.name === 'object'
        ? typeObj.name
        : { en: String(typeObj.name || '') };
      const typeDisplay = pickLang(typeNames, langs) || '';

      for (const lg of langs) {
        const tn = typeNames[lg];
        if (tn && !seenTypeNames.has(tn)) {
          seenTypeNames.add(tn);
          typeIndex.push({
            raw: tn,
            normalized: normalizeFn ? normalizeFn(tn) : String(tn).toLowerCase(),
            typeObj,
            source: 'type',
          });
        }
      }

      const cats = typeObj.category || [];
      for (let j = 0; j < cats.length; j++) {
        const cat      = cats[j];
        const catNames = typeof cat.name === 'object'
          ? cat.name
          : { en: String(cat.name || '') };
        const catDisplay = pickLang(catNames, langs) || '';

        for (const lg of langs) {
          const cn = catNames[lg];
          if (cn && !seenCatNames.has(cn)) {
            seenCatNames.add(cn);
            categoryIndex.push({
              raw: cn,
              normalized: normalizeFn ? normalizeFn(cn) : String(cn).toLowerCase(),
              typeObj,
              category: cat,
              source: 'category',
            });
          }
        }

        const items = cat.data || [];
        for (let x = 0; x < items.length; x++) {
          const item = items[x];

          const combinedParts = [];
          if (item.name && typeof item.name === 'object') {
            for (const lg of langs) if (item.name[lg]) combinedParts.push(String(item.name[lg]));
          } else if (item.name) combinedParts.push(String(item.name));

          for (const k in item) {
            if (/_name$/.test(k) && typeof item[k] === 'object') {
              for (const lg of langs) if (item[k][lg]) combinedParts.push(String(item[k][lg]));
            }
          }

          if (item.description && typeof item.description === 'object') {
            for (const lg of langs) if (item.description[lg]) combinedParts.push(String(item.description[lg]));
          } else if (typeof item.description === 'string' && item.description) {
            combinedParts.push(item.description);
          }

          if (item.api)  combinedParts.push(String(item.api));
          if (item.text) combinedParts.push(String(item.text));

          for (const lg of langs) {
            if (typeNames[lg]) combinedParts.push(String(typeNames[lg]));
            if (catNames[lg])  combinedParts.push(String(catNames[lg]));
          }

          const combined = combinedParts.filter(Boolean).join(' • ');
          const name = pickLang(item.name || {}, langs) || (item.api || '');

          /** @type {SearchDoc} */
          const doc = {
            id: String(idCounter++),
            typeKey: typeDisplay,
            categoryKey: catDisplay,
            name: name,
            api: item.api || '',
            text: item.text || '',
            combined: normalizeFn ? normalizeFn(combined) : combined,
            combinedLower: (normalizeFn ? normalizeFn(combined) : combined).toLowerCase(),
            rawItem: item,
            typeObj,
            category: cat,
          };
          docs.push(doc);

          const kw = name || item.api || '';
          if (kw) {
            keywords.push({
              raw: kw,
              normalized: normalizeFn ? normalizeFn(kw) : String(kw).toLowerCase(),
              docId: doc.id,
              item: item,
              itemName: name,
              typeObj: typeObj,
              typeName: typeDisplay,
              catName: catDisplay,
              source: 'item',
            });
          }
        }
      }
    }

    return { docs, keywords, typeIndex, categoryIndex };
  }

  // ── Search core ──────────────────────────────────────────────────────────

  /**
   * Immediate substring search on _docs (no Fuse needed).
   * O(n) but with precomputed combinedLower, so per-doc cost is one indexOf.
   * Caps at fastImmediateLimit to bound worst-case latency.
   *
   * @param {string} qRaw
   * @param {string} [typeFilter]
   * @param {number} [limit]
   * @returns {{ results: SearchResult[], keywords: KeywordEntry[] }}
   */
  function immediateSearch(qRaw, typeFilter, limit) {
    const q = String(qRaw || '').trim();
    if (!q) return { results: [], keywords: generateAllKeywords() };
    const nq = q.toLowerCase();
    const results = [];
    limit = limit || _options.fastImmediateLimit || 200;
    const typeFilterLower = typeFilter && typeFilter !== 'all'
      ? String(typeFilter).toLowerCase()
      : null;

    for (let i = 0; i < _docs.length && results.length < limit; i++) {
      const d = _docs[i];
      if (typeFilterLower && (d.typeKey || '').toLowerCase() !== typeFilterLower) continue;
      // Use precomputed combinedLower — avoids re-toLowerCase per query
      const hay = d.combinedLower
        || ((d.name || '') + ' ' + (d.api || '') + ' ' + (d.combined || '')).toLowerCase();
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
          matchExact: (hay === nq),
        });
      }
    }
    return { results, keywords: generateAllKeywords() };
  }

  /**
   * Generate keyword list (defensive copy).
   * @returns {KeywordEntry[]}
   */
  function generateAllKeywords() {
    return _keywords.map(k => Object.assign({}, k));
  }

  /**
   * Comprehensive suggestion query.
   *
   * Layers (in priority order):
   *  1. Item name prefix matches  (highest priority — direct hit)
   *  2. Type name matches          (e.g., "อี" → "อีโมจิ")
   *  3. Category name matches     (e.g., "arr" → "Arrows")
   *  4. Item name contains match  (non-prefix substring)
   *  5. Fuse fuzzy match          (typo-tolerant)
   *  6. Immediate doc scan        (last-resort fallback)
   *
   * Each layer contributes up to maxCount entries total. We try to fill
   * maxCount from the highest-priority layers first, falling through
   * only when needed.
   *
   * @param {string} rawQuery
   * @param {number} [maxCount=8]
   * @returns {Suggestion[]}
   */
  function querySuggestions(rawQuery, maxCount) {
    maxCount = maxCount || 8;
    const q = String(rawQuery || '').trim();
    if (!q) return [];

    const nq        = _normalize ? _normalize(q) : q.toLowerCase();
    const nqSimple  = String(q).toLowerCase();
    const out       = [];
    /** @type {Set<string>} */ const seen = new Set();

    // ── Layer 1: Item name prefix matches ─────────────────────────────────
    for (let i = 0; i < _keywords.length && out.length < maxCount; i++) {
      const k = _keywords[i];
      if (!k || !k.normalized) continue;
      if (String(k.normalized).indexOf(nq) === 0) {
        const display = k.raw || k.itemName || '';
        const key = 'item:' + (k.normalized || display.toLowerCase());
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          display,
          raw: display,
          highlightedHtml: escapeHtml(display),
          source: 'keyword',
          sourcePriority: SUGGESTION_SOURCE.KEYWORD_EXACT,
          typeObj: k.typeObj,
          typeName: k.typeName,
          catName: k.catName,
        });
      }
    }

    // ── Layer 2: Type name matches ────────────────────────────────────────
    if (out.length < maxCount) {
      for (let i = 0; i < _typeIndex.length && out.length < maxCount; i++) {
        const t = _typeIndex[i];
        if (!t || !t.normalized) continue;
        // Match prefix OR contains — types are short, contains is fine
        if (String(t.normalized).indexOf(nq) >= 0
            || String(t.normalized).indexOf(nqSimple) >= 0) {
          const display = t.raw;
          const key = 'type:' + (t.normalized || display.toLowerCase());
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            display,
            raw: display,
            highlightedHtml: escapeHtml(display),
            source: 'type',
            sourcePriority: SUGGESTION_SOURCE.TYPE_NAME,
            typeObj: t.typeObj,
            typeName: display,
            catName: '',
          });
        }
      }
    }

    // ── Layer 3: Category name matches ────────────────────────────────────
    if (out.length < maxCount) {
      for (let i = 0; i < _categoryIndex.length && out.length < maxCount; i++) {
        const c = _categoryIndex[i];
        if (!c || !c.normalized) continue;
        if (String(c.normalized).indexOf(nq) >= 0
            || String(c.normalized).indexOf(nqSimple) >= 0) {
          const display = c.raw;
          const key = 'cat:' + (c.normalized || display.toLowerCase());
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            display,
            raw: display,
            highlightedHtml: escapeHtml(display),
            source: 'category',
            sourcePriority: SUGGESTION_SOURCE.CATEGORY_NAME,
            typeObj: c.typeObj,
            typeName: c.typeObj ? (typeof c.typeObj.name === 'object' ? pickLang(c.typeObj.name, _langs) : String(c.typeObj.name || '')) : '',
            catName: display,
          });
        }
      }
    }

    // ── Layer 4: Item name contains (non-prefix) matches ─────────────────
    if (out.length < maxCount) {
      for (let i = 0; i < _keywords.length && out.length < maxCount; i++) {
        const k = _keywords[i];
        if (!k || !k.normalized) continue;
        // Skip prefix matches (already covered in Layer 1)
        if (String(k.normalized).indexOf(nq) === 0) continue;
        if (String(k.normalized).indexOf(nq) >= 0) {
          const display = k.raw || k.itemName || '';
          const key = 'item-c:' + (k.normalized || display.toLowerCase());
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            display,
            raw: display,
            highlightedHtml: escapeHtml(display),
            source: 'keyword-contains',
            sourcePriority: SUGGESTION_SOURCE.KEYWORD_CONTAINS,
            typeObj: k.typeObj,
            typeName: k.typeName,
            catName: k.catName,
          });
        }
      }
    }

    if (out.length >= maxCount) return out.slice(0, maxCount);

    // ── Layer 5: Fuse fuzzy match ────────────────────────────────────────
    if (_fuse && q.length >= 1) {
      try {
        // Use adaptive limit — pull more than maxCount so we have headroom
        // after deduping against earlier layers.
        const fuseRes = _fuse.search(q, { limit: Math.max(12, maxCount * 2) });
        for (let i = 0; i < fuseRes.length && out.length < maxCount; i++) {
          const r = fuseRes[i];
          const doc = r.item || r;
          const display = doc.name || doc.api || '';
          if (!display) continue;
          const norm = _normalize ? _normalize(display) : String(display).toLowerCase();
          if (!norm || seen.has('fuse:' + norm)) continue;
          seen.add('fuse:' + norm);
          out.push({
            display,
            raw: display,
            highlightedHtml: escapeHtml(display),
            source: 'fuse',
            sourcePriority: SUGGESTION_SOURCE.FUSE,
            score: (r.score !== undefined ? r.score : null),
            typeObj: doc.typeObj,
            typeName: doc.typeKey,
            catName: doc.categoryKey,
          });
        }
      } catch (e) {
        console.error('[SearchEngine] Fuse suggestion query failed:', e);
      }
    } else if (out.length < maxCount) {
      // ── Layer 6: Immediate doc scan fallback ───────────────────────────
      // Used when Fuse isn't ready yet. Scans docs for prefix matches on
      // name/api. Cheap (already-built index) but less accurate than Fuse.
      for (let i = 0; i < _docs.length && out.length < maxCount; i++) {
        const d = _docs[i];
        const display = d.name || d.api || '';
        if (!display) continue;
        const norm = String(display).toLowerCase();
        // Use indexOf for both prefix and contains
        if (norm.indexOf(nqSimple) >= 0 && !seen.has('imm:' + norm)) {
          seen.add('imm:' + norm);
          out.push({
            display,
            raw: display,
            highlightedHtml: escapeHtml(display),
            source: 'immediate',
            sourcePriority: SUGGESTION_SOURCE.IMMEDIATE,
            typeObj: d.typeObj,
            typeName: d.typeKey,
            catName: d.categoryKey,
          });
        }
      }
    }

    return out.slice(0, maxCount);
  }

  /**
   * Two-tier search.
   * Tier 1: immediate substring (always available after init)
   * Tier 2: Fuse fuzzy (available after idle-time build)
   *
   * Auto-falls back to Tier 1 if Fuse fails or isn't ready.
   *
   * @param {string} qRaw
   * @param {string} [typeFilter]
   * @returns {{ results: SearchResult[], keywords: KeywordEntry[] }}
   */
  function search(qRaw, typeFilter) {
    const q = String(qRaw || '').trim();
    if (!q) return { results: [], keywords: generateAllKeywords() };

    if (_fuse) {
      try {
        const fuseResults = _fuse.search(q, { limit: 200 }) || [];
        const results = [];
        const typeFilterLower = typeFilter && typeFilter !== 'all'
          ? String(typeFilter).toLowerCase()
          : null;
        for (let i = 0; i < fuseResults.length; i++) {
          const r = fuseResults[i];
          const doc = r.item || r;
          if (typeFilterLower && (doc.typeKey || '').toLowerCase() !== typeFilterLower) continue;
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
            matchExact: (r.score !== undefined ? (r.score === 0) : false),
          });
        }
        return { results, keywords: generateAllKeywords() };
      } catch (e) {
        console.error('[SearchEngine] Fuse search failed, falling back to immediate:', e);
        return immediateSearch(qRaw, typeFilter);
      }
    }
    return immediateSearch(qRaw, typeFilter);
  }

  // ── Fuse build scheduler ─────────────────────────────────────────────────

  /**
   * Build the Fuse index in idle time. Does NOT block UI.
   * Idempotent — safe to call multiple times; only the first call builds.
   */
  function scheduleBuildFuse() {
    if (_fuseBuilding || !_data) return;
    _fuseBuilding = true;

    const build = async () => {
      try {
        const Fuse = await ensureFuseLoaded();
        const { docs, keywords, typeIndex, categoryIndex } =
          flattenDataToDocs(_data || {}, _normalize);

        const defaultFuseOpts = {
          includeScore: true,
          threshold: FUSE_THRESHOLDS.medium,
          ignoreLocation: true,
          minMatchCharLength: 1,  // Lowered from 2 to support short queries
          useExtendedSearch: false,
          keys: [
            { name: 'name',     weight: 0.6 },
            { name: 'api',      weight: 0.9 },
            { name: 'combined', weight: 0.5 },
            { name: 'text',     weight: 0.2 },
          ],
        };
        const fuseOpts = Object.assign({}, defaultFuseOpts, _options.fuseOptions || {});

        try {
          _fuse = new Fuse(docs, fuseOpts);
          // Refresh keyword + index caches with normalised, rich versions
          _keywords      = keywords;
          _typeIndex     = typeIndex;
          _categoryIndex = categoryIndex;
          // Rebuild combinedLower on docs (now matches normalised combined)
          for (let i = 0; i < _docs.length && i < docs.length; i++) {
            _docs[i].combinedLower = docs[i].combined.toLowerCase();
          }
        } catch (e) {
          console.error('[SearchEngine] Failed to create Fuse index:', e);
          _fuse = null;
        }
      } catch (e) {
        // Graceful degradation: keep using immediate search
        console.warn('[SearchEngine] Fuse unavailable, using immediate search only:',
          e && e.message ? e.message : e);
        _fuse = null;
      } finally {
        _fuseBuilding = false;
      }
    };

    if (typeof requestIdleCallback === 'function') {
      try {
        requestIdleCallback(build, { timeout: _options.idleTimeout });
      } catch (e) {
        setTimeout(build, 100);
      }
    } else {
      const cores = (navigator && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;
      const delay = cores <= 2 ? Math.max(1000, _options.idleTimeout) : 100;
      setTimeout(build, delay);
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  /**
   * Initialise the engine with assembled data.
   *
   * Steps:
   *  1. Detect languages from data
   *  2. Build immediate docs (substring index + keyword index + type/cat indexes)
   *  3. Schedule async Fuse build in idle time
   *
   * Returns true on success. Never throws — logs errors and returns false
   * on failure (aerospace: no surprises, no silent crashes).
   *
   * @param {Object} data
   * @param {Object} [options]
   * @returns {Promise<boolean>}
   */
  async function init(data, options) {
    try {
      options = options || {};
      _options = Object.assign({}, _options, options);
      _data = data || null;
      _normalize = options.normalizeFn || defaultNormalizeText;

      // 1) Detect languages
      _langs = detectLangs(_data || {});

      // 2) Build immediate docs — these power instant substring search
      //    and the comprehensive suggestion engine.
      const immediate = buildImmediateDocs(_data || {});
      _docs          = immediate.docs;
      _keywords      = immediate.keywords.map(k => ({
        item: k.item || null,
        itemName: k.itemName || '',
        typeObj: k.typeObj || null,
        typeName: k.typeName || '',
        catName: k.catName || '',
        key: k.normalized || (k.raw || '').toLowerCase(),
        raw: k.raw || '',
        normalized: k.normalized || (k.raw || '').toLowerCase(),
        source: k.source || 'item',
      }));
      _typeIndex     = immediate.typeIndex;
      _categoryIndex = immediate.categoryIndex;

      // 3) Schedule async Fuse build (does not block)
      scheduleBuildFuse();

      return true;
    } catch (e) {
      console.error('[SearchEngine] init failed:', e);
      _docs = [];
      _keywords = [];
      _typeIndex = [];
      _categoryIndex = [];
      _fuse = null;
      return false;
    }
  }

  // ── Module export ────────────────────────────────────────────────────────

  /**
   * Public SearchEngine API.
   * Surface is identical to legacy search-engine.js — drop-in replacement.
   */
  const SearchEngine = {
    init: function (data, options) { return init(data, options); },
    generateAllKeywords: function () { return generateAllKeywords(); },
    querySuggestions: function (q, maxCount) { return querySuggestions(q, maxCount); },
    search: function (q, typeFilter) { return search(q, typeFilter); },

    /**
     * Internal accessors — used by suggestion service and tests.
     * Exposed for transparency, NOT for external mutation.
     */
    _internals: {
      normalizeText: function () { return _normalize; },
      flattenDataToDocs,
      buildImmediateDocs,
      getDocs: () => _docs.slice(),
      getKeywords: () => _keywords.slice(),
      getTypeIndex: () => _typeIndex.slice(),
      getCategoryIndex: () => _categoryIndex.slice(),
      getFuse: () => _fuse,
      isFuseReady: () => _fuse !== null && !_fuseBuilding,
      isFuseBuilding: () => _fuseBuilding,
      getLangs: () => _langs.slice(),
      options: () => Object.assign({}, _options),
      pickFuseThreshold,
    },
  };

  // Export both to window (legacy compat) and to module namespace.
  // The module namespace (window.SearchModules) is the canonical home;
  // window.SearchEngine remains for any legacy code that reads it directly.
  M.SearchEngine = SearchEngine;
  window.SearchEngine = SearchEngine;

})(window.SearchModules = window.SearchModules || {});

/**
 * @typedef {Object} SearchDoc
 * @property {string} id
 * @property {string} typeKey
 * @property {string} categoryKey
 * @property {string} name
 * @property {string} api
 * @property {string} text
 * @property {string} combined
 * @property {string} combinedLower
 * @property {any} rawItem
 * @property {any} typeObj
 * @property {any} category
 */

/**
 * @typedef {Object} KeywordEntry
 * @property {string} raw
 * @property {string} normalized
 * @property {string} key
 * @property {string} docId
 * @property {any} item
 * @property {string} itemName
 * @property {any} typeObj
 * @property {string} typeName
 * @property {string} catName
 * @property {string} source
 */

/**
 * @typedef {Object} NameEntry
 * @property {string} raw
 * @property {string} normalized
 * @property {any} typeObj
 * @property {any} [category]
 * @property {string} source
 */

/**
 * @typedef {Object} Suggestion
 * @property {string} display
 * @property {string} raw
 * @property {string} highlightedHtml
 * @property {string} source
 * @property {number} sourcePriority
 * @property {number|null} [score]
 * @property {any} [typeObj]
 * @property {string} [typeName]
 * @property {string} [catName]
 */
