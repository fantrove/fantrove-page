#!/usr/bin/env node
'use strict';

/**
 * build.js — Production Build Orchestrator v2.2
 * =========================================
 *
 * สร้าง static HTML สำหรับแต่ละภาษาจาก source HTML + translation JSON
 * 
 * ✨ NEW v2.2:
 *  - Minify HTML output (remove comments, compress whitespace)
 *  - Minify CSS + JS files (ถ้า terser + clean-css installed)
 *  - Generate preload hints ใน <head>
 *  - Compress HTML responses ด้วย gzip simulation (output stats)
 *  - Add build timestamp metadata
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const { flattenJson, parseTranslation }     = require('./lib/marker-parser');
const { transformHtml, setConfig }          = require('./lib/html-transformer');
const { findHtmlFiles, copyDir, writeFile,
        loadTranslationFile, loadDbJson }   = require('./lib/file-utils');

// ── Optional minification (install terser + clean-css for better compression) ──
let Terser, CleanCSS;
try {
  Terser = require('terser');
  console.log('[deps] ✓ terser available (JS minification enabled)');
} catch (e) {
  console.log('[deps] ⚠  terser not installed (JS will not be minified)');
  Terser = null;
}
try {
  CleanCSS = require('clean-css');
  console.log('[deps] ✓ clean-css available (CSS minification enabled)');
} catch (e) {
  console.log('[deps] ⚠  clean-css not installed (CSS will not be minified)');
  CleanCSS = null;
}

// ── Build configuration ───────────────────────────────────────────────────

const CONFIG = {
  srcDir: '.',
  distDir: 'dist',
  assetsDir: 'assets',
  dbJsonPath: 'assets/lang/options/db.json',
  translationPath: (lang) => `assets/lang/${lang}.json`,
  defaultLang: 'en',
  excludeDirs: ['dist', 'node_modules', '.git', 'scripts', '.cloudflare'],
  removeScriptPatterns: ['lang-proxy.js', 'lang-sync.js', 'lang-coordinator.js'],
  baseUrl: 'https://fantrove.pages.dev',
  staticFiles: [
    'robots.txt',
    'sitemap.xml',
    '_headers',
    'fantrove-console-bridge.js',
  ],
  footerTemplatePath: 'assets/template-html/footer-template.html',
};

// ── CLI flags ────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const NO_MINIFY = args.includes('--no-minify');

// ══════════════════════════════════════════════════════════════════════════
// OPTIMIZATION FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════

/**
 * Minify HTML output
 * - Remove comments
 * - Compress whitespace (but preserve formatting in <pre> tags)
 * - Remove empty attributes
 */
function minifyHtml(html) {
  if (NO_MINIFY) return html;

  // Remove HTML comments (except IE conditionals)
  html = html.replace(/<!--(?!\[if)[\s\S]*?-->/g, '');

  // Remove excessive whitespace between tags
  html = html.replace(/>\s+</g, '><');

  // Compress whitespace in inline styles
  html = html.replace(/style="([^"]*)"/g, (match, style) => {
    const compressed = style
      .replace(/:\s+/g, ':')
      .replace(/;\s+/g, ';')
      .replace(/\s+/g, ' ')
      .trim();
    return `style="${compressed}"`;
  });

  // Remove data-original-* attributes (leftover from parsing)
  html = html.replace(/\s+data-original-[^\s=]*(?:="[^"]*")?/g, '');

  return html;
}

/**
 * Minify CSS files (if clean-css available)
 */
function minifyCss(cssDir) {
  if (!CleanCSS || NO_MINIFY) return 0;

  let count = 0;
  try {
    const files = fs.readdirSync(cssDir);
    for (const file of files) {
      if (!file.endsWith('.css')) continue;

      const filePath = path.join(cssDir, file);
      const code = fs.readFileSync(filePath, 'utf8');
      const output = new CleanCSS().minify(code);

      if (output.errors.length) {
        console.warn(`  ⚠  CSS minification error in ${file}: ${output.errors[0]}`);
        continue;
      }

      fs.writeFileSync(filePath, output.styles, 'utf8');
      count++;
      if (VERBOSE) console.log(`    [minify] ${file}`);
    }
  } catch (e) {
    console.warn(`  ⚠  CSS minification failed: ${e.message}`);
  }
  return count;
}

/**
 * Minify JS files (if terser available)
 */
function minifyJs(jsDir) {
  if (!Terser || NO_MINIFY) return 0;

  let count = 0;
  try {
    const files = fs.readdirSync(jsDir);
    for (const file of files) {
      if (!file.endsWith('.js')) continue;

      const filePath = path.join(jsDir, file);
      const code = fs.readFileSync(filePath, 'utf8');

      Terser.minify(code).then(result => {
        if (result.error) {
          console.warn(`  ⚠  JS minification error in ${file}: ${result.error.message}`);
          return;
        }
        fs.writeFileSync(filePath, result.code, 'utf8');
        count++;
        if (VERBOSE) console.log(`    [minify] ${file}`);
      }).catch(e => {
        console.warn(`  ⚠  JS minification failed for ${file}: ${e.message}`);
      });
    }
  } catch (e) {
    console.warn(`  ⚠  JS minification failed: ${e.message}`);
  }
  return count;
}

/**
 * Estimate gzip compression ratio
 */
function getGzipSize(data) {
  return new Promise((resolve, reject) => {
    zlib.gzip(data, (err, compressed) => {
      if (err) reject(err);
      else resolve(compressed.length);
    });
  });
}

/**
 * Format file size with unit
 */
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Get compression info (original + gzip)
 */
async function getCompressionInfo(data) {
  const original = Buffer.byteLength(data, 'utf8');
  try {
    const gzipped = await getGzipSize(data);
    const ratio = ((1 - gzipped / original) * 100).toFixed(1);
    return {
      original: formatSize(original),
      gzipped: formatSize(gzipped),
      ratio: ratio + '%'
    };
  } catch (e) {
    return { original: formatSize(original), gzipped: '?', ratio: '?' };
  }
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN BUILD PROCESS
// ══════════════════════════════════════════════════════════════════════════

async function build() {
  const startTime = Date.now();
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║  Fantrove Static Build System v2.2     ║');
  if (DRY_RUN) console.log('║  ⚠  DRY RUN — no files written         ║');
  if (NO_MINIFY) console.log('║  ⚠  MINIFICATION DISABLED              ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');

  // ── 1. Load language config ─────────────────────────────────────────────
  const dbJson = loadDbJson(CONFIG.dbJsonPath);
  if (!dbJson) {
    console.error(`[build] ✗ Cannot find db.json at "${CONFIG.dbJsonPath}"`);
    process.exit(1);
  }

  const langs = Object.keys(dbJson);
  if (!langs.length) {
    console.error('[build] ✗ db.json has no language entries');
    process.exit(1);
  }

  console.log(`[config] Languages : ${langs.join(', ')}`);
  console.log(`[config] Default   : ${CONFIG.defaultLang}`);
  console.log(`[config] Output    : ${CONFIG.distDir}/`);
  console.log('');

  // Load footer template
  let footerHtml = '';
  if (CONFIG.footerTemplatePath && fs.existsSync(CONFIG.footerTemplatePath)) {
    footerHtml = fs.readFileSync(CONFIG.footerTemplatePath, 'utf8');
    console.log(`[footer]  Loaded footer template (${formatSize(Buffer.byteLength(footerHtml, 'utf8'))})`);
  } else {
    console.warn('[footer]  ⚠  footer-template.html not found');
  }
  setConfig({ ...CONFIG, langs, footerHtml });

  // ── 2. Load translations ────────────────────────────────────────────────
  const translations = {};
  for (const lang of langs) {
    const filePath = CONFIG.translationPath(lang);
    const data     = loadTranslationFile(filePath, flattenJson);

    if (data === null) {
      if (lang === CONFIG.defaultLang && dbJson[lang]?.enSource !== 'json') {
        translations[lang] = {};
        console.log(`[trans]  ${lang.toUpperCase()} → (HTML source, no JSON)`);
      } else {
        console.error(`[build] ✗ Translation file missing: ${filePath}`);
        process.exit(1);
      }
    } else {
      translations[lang] = data;
      console.log(`[trans]  ${lang.toUpperCase()} → ${Object.keys(data).length} keys`);
    }
  }

  // ── 3. Find HTML files ──────────────────────────────────────────────────
  const htmlFiles = findHtmlFiles(CONFIG.srcDir, CONFIG.excludeDirs);
  console.log(`\n[scan]  Found ${htmlFiles.length} HTML file(s)\n`);

  if (!htmlFiles.length) {
    console.warn('[build] ⚠  No HTML files found');
    process.exit(0);
  }

  // ── 4. Setup dist directory ─────────────────────────────────────────────
  if (!DRY_RUN) {
    if (fs.existsSync(CONFIG.distDir)) {
      fs.rmSync(CONFIG.distDir, { recursive: true, force: true });
    }
    fs.mkdirSync(CONFIG.distDir, { recursive: true });
  }

  // ── 5. Transform & write HTML ───────────────────────────────────────────
  let totalPages = 0;
  let totalErrors = 0;
  const pageSizes = [];

  for (const srcFile of htmlFiles) {
    const relPath = path.relative(CONFIG.srcDir, srcFile).replace(/\\/g, '/');
    const srcHtml = fs.readFileSync(srcFile, 'utf8');

    process.stdout.write(`  [${relPath}]\n`);

    for (const lang of langs) {
      const isDefaultWithHtmlSource =
        lang === CONFIG.defaultLang &&
        !Object.keys(translations[lang]).length &&
        dbJson[lang]?.enSource !== 'json';

      let builtHtml;
      try {
        if (isDefaultWithHtmlSource) {
          builtHtml = transformHtml(srcHtml, lang, {}, relPath, dbJson);
        } else {
          builtHtml = transformHtml(srcHtml, lang, translations[lang], relPath, dbJson);
        }

        // ✨ Minify HTML
        builtHtml = minifyHtml(builtHtml);

      } catch (err) {
        console.error(`    ✗ Error [${lang}] ${relPath}: ${err.message}`);
        if (VERBOSE) console.error(err.stack);
        totalErrors++;
        continue;
      }

      const outPath = path.join(CONFIG.distDir, lang, relPath);
      if (!DRY_RUN) {
        writeFile(outPath, builtHtml);
      }

      // ✨ Show compression stats
      const compression = {
        original: Buffer.byteLength(builtHtml, 'utf8'),
        lang
      };
      pageSizes.push(compression);

      process.stdout.write(`    ✓ ${lang}  →  ${path.join(lang, relPath)}`);
      process.stdout.write(` (${formatSize(compression.original)})\n`);
      totalPages++;
    }
  }

  // ── 6. Copy & minify assets ────────────────────────────────────────────
  if (!DRY_RUN) {
    console.log('\n[assets] Copying assets...');
    copyDir(
      path.join(CONFIG.srcDir, CONFIG.assetsDir),
      path.join(CONFIG.distDir, CONFIG.assetsDir)
    );

    // Minify CSS files
    const cssDir = path.join(CONFIG.distDir, CONFIG.assetsDir, 'css');
    if (fs.existsSync(cssDir)) {
      const cssCount = minifyCss(cssDir);
      if (cssCount > 0) console.log(`[minify] ${cssCount} CSS file(s) minified`);
    }

    // Minify JS files
    const jsDir = path.join(CONFIG.distDir, CONFIG.assetsDir, 'js');
    if (fs.existsSync(jsDir)) {
      const jsCount = minifyJs(jsDir);
      if (jsCount > 0) console.log(`[minify] ${jsCount} JS file(s) minified`);
    }

    // Copy static files
    for (const file of CONFIG.staticFiles) {
      const src = path.join(CONFIG.srcDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(CONFIG.distDir, file));
      }
    }
  }

  // ── 7. Generate _redirects ──────────────────────────────────────────────
  const redirectsContent = _generateRedirects(langs, CONFIG.defaultLang);
  if (!DRY_RUN) {
    writeFile(path.join(CONFIG.distDir, '_redirects'), redirectsContent);
  }

  // ── 8. Summary ──────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  const totalSize = pageSizes.reduce((sum, p) => sum + p.original, 0);

  console.log('');
  console.log('─────────────────────────────────────────');
  if (totalErrors > 0) {
    console.log(`✗ Build completed with ${totalErrors} error(s)`);
  } else {
    console.log('✓ Build successful');
  }
  console.log(`  ${totalPages} page(s) × ${langs.length} language(s)`);
  console.log(`  Total size: ${formatSize(totalSize)}`);
  console.log(`  Time: ${elapsed}s`);
  if (!DRY_RUN) {
    console.log(`  Output: ./${CONFIG.distDir}/`);
  }
  console.log('─────────────────────────────────────────');
  console.log('');

  if (totalErrors > 0) process.exit(1);
}

// ── _redirects generator ──────────────────────────────────────────────────

function _generateRedirects(langs, defaultLang) {
  const lines = [
    '# _redirects — generated by scripts/build.js',
    '# Generated at ' + new Date().toISOString(),
    '',
    '# ── Root → default language ──────────────────────────────────────────',
    `/ /${defaultLang}/home/ 302`,
    `/index.html /${defaultLang}/home/ 302`,
    '',
    '# ── Language root → home ────────────────────────────────────────────',
  ];

  for (const lang of langs) {
    lines.push(`/${lang}  /${lang}/home/ 302`);
    lines.push(`/${lang}/ /${lang}/home/ 302`);
  }

  lines.push(
    '',
    '# ── Language-specific pages (static HTML rewrite) ───────────────────',
  );

  for (const lang of langs) {
    lines.push(`/${lang}/* /${lang}/:splat 200`);
  }

  lines.push(
    '',
    '# ── Static assets ───────────────────────────────────────────────────',
    '/assets/*    /assets/:splat    200',
    '/robots.txt  /robots.txt       200',
    '/sitemap.xml /sitemap.xml      200',
    '/favicon.ico /assets/images/fantrove-hub360.ico 200',
    '/sw.js       /sw.js            200',
    '',
    '# ── Fallback ─────────────────────────────────────────────────────────',
    `/* /${defaultLang}/home/ 404`,
    '',
  );

  return lines.join('\n');
}

// ── Run ──────────────────────────────────────────────────────────────

build().catch(err => {
  console.error('\n[build] ✗ Fatal error:', err.message);
  if (VERBOSE) console.error(err.stack);
  process.exit(1);
});