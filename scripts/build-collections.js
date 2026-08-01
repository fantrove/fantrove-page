#!/usr/bin/env node
'use strict';

/**
 * build-collections.js — Collection Page Generator
 *
 * สร้าง static HTML สำหรับแต่ละ collection × แต่ละภาษา
 *
 * สิ่งที่ script นี้ทำ:
 *  1. อ่าน collections.json เพื่อรู้จำนวน collections
 *  2. โหลดแต่ละ collection JSON file
 *  3. อ่าน template HTML จาก collections/_template/index.html
 *  4. โหลด translation JSON ของแต่ละภาษา
 *  5. สำหรับแต่ละ collection × ภาษา:
 *       - Resolve Unicode IDs → characters + names
 *       - Generate cover HTML (deterministic, same as runtime)
 *       - Generate items HTML
 *       - Generate related collections HTML
 *       - Inject SEO tags (meta, hreflang, canonical, JSON-LD)
 *       - Translate template content
 *       - Write to dist/{lang}/collections/{id}/index.html
 *
 * Usage:
 *   node scripts/build-collections.js
 *   node scripts/build-collections.js --dry-run
 *   node scripts/build-collections.js --verbose
 */

const fs   = require('fs');
const path = require('path');

// ── CLI flags ───────────────────────────────────────────────────────
// [v3.2] Moved before CONFIG so srcDir getter can reference args
const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

// ── Configuration ───────────────────────────────────────────────────

/**
 * Resolve project root directory.
 * v3.2: Auto-detect from script location — works from any cwd.
 *   - If --srcDir is passed via CLI, use that.
 *   - Otherwise, derive from __dirname (scripts/ → project root).
 */
const _autoRoot = path.resolve(__dirname, '..');

const CONFIG = {
  /** Source root (auto-detected or overridden via --srcDir) */
  get srcDir() {
    const srcArg = args.find(a => a.startsWith('--srcDir='));
    if (srcArg) return srcArg.split('=')[1];
    return _autoRoot;
  },

  /** Build output directory */
  distDir: 'dist',

  /** Path to collections type index */
  collectionsIndexPath: 'assets/db/con-data/collections.json',

  /** Path to collection data directory */
  collectionsDataDir: 'assets/db/con-data/collections',

  /** Path to template HTML */
  templatePath: 'collections/_template/index.html',

  /** Path to language config */
  dbJsonPath: 'assets/lang/options/db.json',

  /** Path template for translation JSON */
  translationPath: function (lang) { return 'assets/lang/' + lang + '.json'; },

  /** Default language */
  defaultLang: 'en',

  /** Base URL for SEO */
  baseUrl: 'https://fantrove.pages.dev',

  /** Supported languages */
  supportedLangs: ['en', 'th'],

  /** Con-data directory for item resolution */
  conDataDir: 'assets/db/con-data',

  /** Directories to exclude from item resolution */
  excludeDirs: ['cards', 'collections'],
};

// ── Main ────────────────────────────────────────────────────────────

async function buildCollections() {
  const startTime = Date.now();
  console.log('');
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   Collection Page Builder v3.2             ║');
  if (DRY_RUN) console.log('║   ⚠  DRY RUN — no files written            ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log('');

  // v3.2: Resolve all paths relative to srcDir
  const srcDir = CONFIG.srcDir;
  console.log('[collections] Source dir: ' + srcDir);

  // 1. Load collections index
  const collectionsIndexPath = path.resolve(srcDir, CONFIG.collectionsIndexPath);
  const collectionsIndex = loadJsonFile(collectionsIndexPath);
  if (!collectionsIndex) {
    console.error('[collections] ✗ Cannot load collections.json from: ' + collectionsIndexPath);
    process.exit(1);
  }

  const categories = collectionsIndex.categories || [];
  console.log('[collections] Found ' + categories.length + ' collection(s)');

  // 2. Load each collection data
  const collections = [];
  const collectionsDataDir = path.resolve(srcDir, CONFIG.collectionsDataDir);
  for (const cat of categories) {
    const filePath = cat.file
      ? (cat.file.startsWith('/') ? cat.file.slice(1) : cat.file)
      : path.join(collectionsDataDir, cat.id + '.json');

    const data = loadJsonFile(filePath);
    if (data) {
      collections.push(data);
      console.log('  ✓ ' + data.id + ' (' + (data.items ? data.items.length : 0) + ' items)');
    } else {
      console.warn('  ✗ ' + cat.id + ' — failed to load from: ' + filePath);
    }
  }

  if (!collections.length) {
    console.warn('[collections] ⚠ No collections loaded — nothing to build');
    return { totalPages: 0, totalErrors: 0 };
  }

  // 3. Load language config
  const dbJsonPath = path.resolve(srcDir, CONFIG.dbJsonPath);
  const dbJson = loadJsonFile(dbJsonPath);
  const langs = dbJson ? Object.keys(dbJson) : CONFIG.supportedLangs;
  console.log('\n[collections] Languages: ' + langs.join(', '));

  // 4. Load translations
  const translations = {};
  for (const lang of langs) {
    const filePath = path.resolve(srcDir, CONFIG.translationPath(lang));
    translations[lang] = loadJsonFile(filePath) || {};
  }

  // 5. Load template
  const templatePath = path.resolve(srcDir, CONFIG.templatePath);
  if (!fs.existsSync(templatePath)) {
    console.error('[collections] ✗ Template not found: ' + templatePath);
    process.exit(1);
  }
  const templateHtml = fs.readFileSync(templatePath, 'utf8');
  console.log('[collections] Template loaded (' + templateHtml.length + ' chars)');

  // 6. Build item resolver (offline — reads con-data JSON files)
  const conDataDir = path.resolve(srcDir, CONFIG.conDataDir);
  const itemResolver = buildItemResolver(conDataDir, srcDir);
  console.log('[collections] Item resolver built (' + itemResolver.size + ' items indexed)');

  // 7. Resolve distDir relative to srcDir
  const distDir = path.resolve(srcDir, CONFIG.distDir);

  // 8. Generate pages
  let totalPages = 0;
  let totalErrors = 0;

  for (const col of collections) {
    for (const lang of langs) {
      try {
        const html = generateCollectionPage(col, lang, langs, templateHtml, translations, itemResolver, collections);

        const outPath = path.join(distDir, lang, 'collections', col.id, 'index.html');
        if (!DRY_RUN) {
          writeFile(outPath, html);
        }

        console.log('  ✓ ' + lang + '/' + col.id);
        totalPages++;
      } catch (err) {
        console.error('  ✗ ' + lang + '/' + col.id + ': ' + err.message);
        if (VERBOSE) console.error(err.stack);
        totalErrors++;
      }
    }
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('');
  console.log('─────────────────────────────────────────');
  if (totalErrors > 0) {
    console.log('✗ Collection build completed with ' + totalErrors + ' error(s)');
  } else {
    console.log('✓ Collection build successful');
  }
  console.log('  ' + totalPages + ' page(s) × ' + langs.length + ' language(s) in ' + elapsed + 's');
  console.log('─────────────────────────────────────────');

  return { totalPages, totalErrors };
}

// ── Item Resolver (offline) ──────────────────────────────────────────

/**
 * สร้าง Map<api, item> จาก con-data JSON files ทั้งหมด
 * ใช้สำหรับ resolve Unicode IDs → characters + names ที่ build time
 * v3.2: Accept conDataDir and srcDir as parameters
 * @param {string} conDataDir  Absolute path to con-data directory
 * @param {string} srcDir      Absolute path to project root
 * @returns {Map<string, Object>}
 */
function buildItemResolver(conDataDir, srcDir) {
  const resolver = new Map();

  // อ่าน index.json เพื่อหา type files
  const indexPath = path.join(conDataDir, 'index.json');
  const indexData = loadJsonFile(indexPath);
  if (!indexData || !indexData.categories) return resolver;

  for (const catEntry of indexData.categories) {
    // [FIX v3.2] แก้บั๊ก: cat.file → catEntry.file (typo ที่ทำให้ resolver ไม่ทำงาน)
    // v3.2: Resolve absolute paths (/assets/...) against srcDir, relative against conDataDir
    const typeFilePath = catEntry.file
      ? (catEntry.file.startsWith('/')
        ? path.join(srcDir, catEntry.file.slice(1))
        : path.resolve(conDataDir, catEntry.file))
      : path.join(conDataDir, catEntry.id + '.json');

    const typeData = loadJsonFile(typeFilePath);
    if (!typeData) continue;

    const categories = typeData.categories || typeData.category || [];
    for (const subCat of categories) {
      const subFilePath = subCat.file
        ? (subCat.file.startsWith('/')
          ? path.join(srcDir, subCat.file.slice(1))
          : path.resolve(conDataDir, subCat.file))
        : path.join(conDataDir, catEntry.id, subCat.id + '.json');

      const subData = loadJsonFile(subFilePath);
      if (!subData || !subData.data) continue;

      for (const item of subData.data) {
        if (item && item.api) {
          resolver.set(item.api, item);
        }
      }
    }
  }

  return resolver;
}

// ── Page Generator ───────────────────────────────────────────────────

/**
 * สร้าง HTML สำหรับ collection page เดียว
 */
function generateCollectionPage(collection, lang, langs, templateHtml, translations, itemResolver, allCollections) {
  const name = getName(collection.name, lang);
  const desc = getName(collection.description, lang);
  const itemCount = collection.items ? collection.items.length : 0;

  // Resolve items
  const resolvedItems = resolveItems(collection.items, itemResolver, lang);

  // Generate cover HTML
  const coverHtml = generateCoverHtmlStatic(collection, resolvedItems);

  // Generate items HTML
  const itemsHtml = generateItemsHtml(resolvedItems, lang);

  // Generate related collections
  const related = computeRelatedStatic(collection, allCollections, 4);
  const relatedHtml = generateRelatedHtml(related, lang, itemResolver);

  // SEO data
  const seoData = generateSeoData(collection, lang, langs);

  // Build HTML
  let html = templateHtml;

  // Replace title
  html = html.replace(
    /<title[^>]*>.*?<\/title>/,
    '<title>' + escapeHtml(seoData.title) + '</title>'
  );

  // Replace meta description
  html = html.replace(
    /<meta\s+name="description"[^>]*>/,
    '<meta name="description" content="' + escapeAttr(seoData.description) + '">'
  );

  // Add hreflang + canonical (before </head>)
  const seoTags = generateSeoTagsHtml(seoData);
  html = html.replace('</head>', seoTags + '\n</head>');

  // Set html lang attribute
  html = html.replace(/<html\s+lang="[^"]*"/, '<html lang="' + lang + '"');

  // Replace collection name
  html = html.replace(
    /id="collectionName"[^>]*>[^<]*/,
    'id="collectionName">' + escapeHtml(name)
  );

  // Replace collection eyebrow label ("Collection" / "คอลเลกชัน")
  //   v2.0 Discovery Refresh — makes it explicit that this is a collection page.
  var eyebrowText = (lang === 'th') ? 'คอลเลกชัน' : 'Collection';
  html = html.replace(
    /id="collectionEyebrow"[^>]*>[^<]*/,
    'id="collectionEyebrow">' + escapeHtml(eyebrowText)
  );

  // Replace collection description
  html = html.replace(
    /id="collectionDescription"[^>]*>[^<]*/,
    'id="collectionDescription">' + escapeHtml(desc)
  );

  // Replace item count
  html = html.replace(
    /id="collectionItemCount"[^>]*>[^<]*/,
    'id="collectionItemCount">' + itemCount + ' items'
  );

  // Replace cover
  html = html.replace(
    /id="collectionCover">/,
    'id="collectionCover">' + coverHtml
  );

  // Replace items
  html = html.replace(
    /id="collectionItems">/,
    'id="collectionItems">' + itemsHtml
  );

  // Replace related
  html = html.replace(
    /id="collectionRelated">/,
    'id="collectionRelated">' + relatedHtml
  );

  // Replace back link
  html = html.replace(
    /href="\/home\/"/,
    'href="/' + lang + '/home/"'
  );

  // Translate data-translate attributes
  const trans = translations[lang] || {};
  html = html.replace(/data-translate="([^"]+)"/g, function (match, key) {
    if (trans[key]) {
      return match + ' data-original="' + escapeAttr(trans[key]) + '"';
    }
    return match;
  });

  return html;
}

// ── Cover HTML Generator (static) ────────────────────────────────────

/**
 * สร้าง cover HTML แบบ static (ไม่ต้องมี DOM)
 */
function generateCoverHtmlStatic(collection, resolvedItems) {
  const coverItems = collection.cover && collection.cover.items ? collection.cover.items : [];
  const displayChars = [];

  for (const itemId of coverItems.slice(0, 8)) {
    const char = unicodeIdToChar(itemId);
    if (char) displayChars.push(char);
  }

  if (!displayChars.length) return '';

  const layout = selectLayout(collection.cover, displayChars.length);
  const name = getName(collection.name, 'en');

  let html = '<div class="collection-cover" role="img" aria-label="' +
    escapeAttr(name) + ' collection preview">';
  html += '<div class="cover-bg cover-bg--' + layout + '">';
  html += '<div class="cover-grid cover-grid--' + layout + ' cover-grid--' + displayChars.length + '">';

  for (let i = 0; i < displayChars.length; i++) {
    html += '<span class="cover-char" style="--cover-char-index:' + i + '">' +
      escapeHtml(displayChars[i]) + '</span>';
  }

  html += '</div></div></div>';
  return html;
}

// ── Items HTML Generator ─────────────────────────────────────────────

/**
 * สร้าง HTML สำหรับ items grid
 */
function generateItemsHtml(resolvedItems, lang) {
  if (!resolvedItems.length) return '';

  let html = '';
  for (const item of resolvedItems) {
    html += '<div class="collection-item" data-api="' + escapeAttr(item.api || '') + '" tabindex="0">';
    html += '<span class="collection-item-char">' + escapeHtml(item.char || '') + '</span>';
    html += '<span class="collection-item-name">' + escapeHtml(item.name || '') + '</span>';
    html += '</div>';
  }

  return html;
}

// ── Related HTML Generator ───────────────────────────────────────────

/**
 * สร้าง HTML สำหรับ related collections
 */
function generateRelatedHtml(related, lang, itemResolver) {
  if (!related.length) return '';

  let html = '';
  for (const rel of related) {
    const name = getName(rel.name, lang);
    const desc = getName(rel.description || {}, lang);
    const coverHtml = generateCoverHtmlStatic(rel, resolveItems(rel.cover ? rel.cover.items : [], itemResolver, lang));

    html += '<a href="/' + lang + '/collections/' + rel.id + '/" class="collection-related-card">';
    html += '<div class="collection-related-card-cover">' + coverHtml + '</div>';
    html += '<div class="collection-related-card-info">';
    html += '<div class="collection-related-card-name">' + escapeHtml(name) + '</div>';
    html += '<div class="collection-related-card-desc">' + escapeHtml(desc) + '</div>';
    html += '</div></a>';
  }

  return html;
}

// ── Related Collections Algorithm (static) ────────────────────────────

/**
 * คำนวณ related collections แบบ static (build time)
 * Deterministic, bounded, no randomness
 */
function computeRelatedStatic(source, allCollections, maxResults) {
  maxResults = Math.min(maxResults || 4, 8);
  if (!source || !source.items) return [];

  const sourceItems = new Set(source.items);
  const scored = [];

  for (const target of allCollections) {
    if (target.id === source.id) continue;

    const targetItems = new Set(target.items || []);

    // Jaccard similarity
    let intersection = 0;
    sourceItems.forEach(id => { if (targetItems.has(id)) intersection++; });
    const union = sourceItems.size + targetItems.size - intersection;
    const jaccard = union > 0 ? intersection / union : 0;

    if (jaccard > 0.01) {
      scored.push({
        id: target.id,
        name: target.name,
        description: target.description,
        cover: target.cover,
        items: target.items,
        score: jaccard,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, maxResults);
}

// ── SEO Helpers ──────────────────────────────────────────────────────

function generateSeoData(collection, lang, langs) {
  const name = getName(collection.name, lang);
  const desc = getName(collection.description, lang);
  const canonical = CONFIG.baseUrl + '/' + lang + '/collections/' + collection.id + '/';

  const hreflang = langs.map(l => ({
    lang: l,
    href: CONFIG.baseUrl + '/' + l + '/collections/' + collection.id + '/',
  }));
  hreflang.push({
    lang: 'x-default',
    href: CONFIG.baseUrl + '/' + CONFIG.defaultLang + '/collections/' + collection.id + '/',
  });

  return {
    title: name + ' — Fantrove',
    description: desc,
    canonical: canonical,
    hreflang: hreflang,
  };
}

function generateSeoTagsHtml(seoData) {
  let tags = '';

  // Canonical
  tags += '  <link rel="canonical" href="' + escapeAttr(seoData.canonical) + '">\n';

  // hreflang
  for (const alt of seoData.hreflang) {
    tags += '  <link rel="alternate" hreflang="' + alt.lang + '" href="' + escapeAttr(alt.href) + '">\n';
  }

  // Open Graph
  tags += '  <meta property="og:title" content="' + escapeAttr(seoData.title) + '">\n';
  tags += '  <meta property="og:description" content="' + escapeAttr(seoData.description) + '">\n';
  tags += '  <meta property="og:type" content="website">\n';
  tags += '  <meta property="og:url" content="' + escapeAttr(seoData.canonical) + '">\n';
  tags += '  <meta property="og:site_name" content="Fantrove">\n';

  return tags;
}

// ── Utility Functions ────────────────────────────────────────────────

function unicodeIdToChar(unicodeId) {
  if (!unicodeId || typeof unicodeId !== 'string') return null;
  const match = unicodeId.match(/^U\+([0-9A-Fa-f]{4,6})$/);
  if (!match) return null;
  const codePoint = parseInt(match[1], 16);
  if (isNaN(codePoint) || codePoint < 0 || codePoint > 0x10FFFF) return null;
  try { return String.fromCodePoint(codePoint); } catch (e) { return null; }
}

function selectLayout(coverConfig, itemCount) {
  if (coverConfig && coverConfig.layout) return coverConfig.layout;
  if (itemCount <= 2) return 'row';
  if (itemCount <= 8) return 'grid';
  if (itemCount <= 16) return 'spiral';
  return 'mosaic';
}

function resolveItems(itemIds, itemResolver, lang) {
  if (!Array.isArray(itemIds)) return [];
  return itemIds.map(id => {
    const char = unicodeIdToChar(id);
    const item = itemResolver.get(id);
    return {
      unicodeId: id,
      char: char || '',
      name: item ? getName(item.name, lang) : id,
      api: id,
      text: char || '',
    };
  }).filter(item => item.char);
}

function getName(nameObj, lang) {
  if (!nameObj || typeof nameObj !== 'object') return String(nameObj || '');
  return nameObj[lang] || nameObj.en || nameObj.th || Object.values(nameObj)[0] || '';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function loadJsonFile(filePath) {
  try {
    // v3.2: Use absolute path directly — caller already resolved via path.resolve()
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    if (VERBOSE) console.warn('[load] Failed to load: ' + filePath, e.message);
    return null;
  }
}

function writeFile(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

// ── Export for integration with build.js ──────────────────────────────
// v3.2: Export buildCollections so it can be called from the main build
module.exports = { buildCollections, CONFIG };

// ── Run standalone ──────────────────────────────────────────────────
// Only run when executed directly (not when required by build.js)
if (require.main === module) {
  buildCollections().catch(function (err) {
    console.error('\n[collections] ✗ Fatal error:', err.message);
    if (VERBOSE) console.error(err.stack);
    process.exit(1);
  });
}
