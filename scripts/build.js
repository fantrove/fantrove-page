#!/usr/bin/env node
'use strict';

/**
 * build.js — Production Build Orchestrator
 * =========================================
 *
 * สร้าง static HTML สำหรับแต่ละภาษาจาก source HTML + translation JSON
 *
 * สิ่งที่ script นี้ทำ:
 *  1. อ่าน db.json เพื่อรู้จำนวนภาษาและ config
 *  2. โหลด translation JSON ของแต่ละภาษา
 *  3. หาไฟล์ HTML ทุกไฟล์ใน project
 *  4. สำหรับแต่ละ HTML × ภาษา:
 *       - แปลงเนื้อหา [data-translate] → text จริง
 *       - ลบ data-translate + attribute พวก data-original-* ออก
 *       - ลบ language system scripts ออก
 *       - ลบ body opacity:0 ออก
 *       - เพิ่ม hreflang + canonical สำหรับ SEO
 *       - prefix internal links ด้วย /lang
 *       - บันทึกไปที่ dist/{lang}/{path}
 *  5. Copy assets/ ไปที่ dist/assets/
 *  6. สร้าง _redirects สำหรับ production
 *  7. Copy _headers ไปยัง dist/
 *
 * โครงสร้าง output:
 *   dist/
 *     en/
 *       home/index.html
 *       info/about/index.html
 *       setting/index.html
 *       …
 *     th/
 *       home/index.html
 *       …
 *     assets/             ← copied as-is
 *     _redirects          ← generated
 *     _headers            ← copied from source
 *
 * Usage:
 *   node scripts/build.js             (normal build)
 *   node scripts/build.js --dry-run   (show what would be built, no file writes)
 *   node scripts/build.js --verbose   (show per-element translation details)
 */

const fs   = require('fs');
const path = require('path');

const { flattenJson, parseTranslation }     = require('./lib/marker-parser');
const { transformHtml, setConfig }          = require('./lib/html-transformer');
const { findHtmlFiles, copyDir, writeFile,
        loadTranslationFile, loadDbJson }   = require('./lib/file-utils');

// ── Build configuration ───────────────────────────────────────────────────

const CONFIG = {
  /** Source root (where your HTML files are) */
  srcDir: '.',

  /** Build output directory */
  distDir: 'dist',

  /** Assets directory name */
  assetsDir: 'assets',

  /** Path to db.json (language config) */
  dbJsonPath: 'assets/lang/options/db.json',

  /** Path template for translation JSON files */
  translationPath: (lang) => `assets/lang/${lang}.json`,

  /** Default language (used for x-default hreflang + fallback) */
  defaultLang: 'en',

  /**
   * Directories to exclude from HTML discovery.
   * These are checked against the path relative to srcDir.
   */
  excludeDirs: [
    'dist',
    'node_modules',
    '.git',
    'scripts',
    '.cloudflare',
  ],

  /**
   * Script src patterns that identify language system scripts.
   * Any <script src="..."> whose src contains one of these patterns
   * will be removed from the built HTML.
   *
   * Add to this list if you add new lang-*.js files.
   */
  langScriptPatterns: [
    'lang-proxy.js',
    'lang-sync.js',
    'lang-coordinator.js',
    'language.js',
    'lang-links.js',
    '/lang-modules/',
  ],

  /**
   * Static files (in srcDir) to copy directly to dist/ root.
   */
  staticFiles: [
    'robots.txt',
    'sitemap.xml',
    '_headers',
    'fantrove-console-bridge.js',
  ],
};

// ── CLI flags ─────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

// ── Main ──────────────────────────────────────────────────────────────────

async function build() {
  const startTime = Date.now();
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║   Fantrove Static Build System v1.0  ║');
  if (DRY_RUN) console.log('║   ⚠  DRY RUN — no files written       ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');

  // ── 1. Load language config ─────────────────────────────────────────────
  const dbJson = loadDbJson(CONFIG.dbJsonPath);
  if (!dbJson) {
    console.error(`[build] ✗ Cannot find db.json at "${CONFIG.dbJsonPath}"`);
    console.error('        Please ensure the path is correct and re-run.');
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

  // Inject config into html-transformer
  setConfig({ ...CONFIG, langs });

  // ── 2. Load translations ────────────────────────────────────────────────
  const translations = {};
  for (const lang of langs) {
    const filePath = CONFIG.translationPath(lang);
    const data     = loadTranslationFile(filePath, flattenJson);

    if (data === null) {
      if (lang === CONFIG.defaultLang && dbJson[lang]?.enSource !== 'json') {
        // English with enSource='html' → content lives in HTML itself, no JSON needed
        translations[lang] = {};
        console.log(`[trans]  ${lang.toUpperCase()} → (HTML source, no JSON translation file)`);
      } else {
        console.error(`[build] ✗ Translation file missing: ${filePath}`);
        process.exit(1);
      }
    } else {
      translations[lang] = data;
      console.log(`[trans]  ${lang.toUpperCase()} → ${Object.keys(data).length} keys loaded`);
    }
  }

  // ── 3. Find HTML files ──────────────────────────────────────────────────
  const htmlFiles = findHtmlFiles(CONFIG.srcDir, CONFIG.excludeDirs);
  console.log(`\n[scan]  Found ${htmlFiles.length} HTML file(s)\n`);

  if (!htmlFiles.length) {
    console.warn('[build] ⚠  No HTML files found. Check your project structure.');
    process.exit(0);
  }

  // ── 4. Transform & write ────────────────────────────────────────────────
  if (!DRY_RUN) {
    // Clean dist directory
    if (fs.existsSync(CONFIG.distDir)) {
      fs.rmSync(CONFIG.distDir, { recursive: true, force: true });
    }
    fs.mkdirSync(CONFIG.distDir, { recursive: true });
  }

  let totalPages  = 0;
  let totalErrors = 0;

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
          // English → just clean up without translating content
          builtHtml = transformHtml(srcHtml, lang, {}, relPath);
        } else {
          builtHtml = transformHtml(srcHtml, lang, translations[lang], relPath);
        }
      } catch (err) {
        console.error(`    ✗ Error transforming [${lang}] ${relPath}:`, err.message);
        if (VERBOSE) console.error(err.stack);
        totalErrors++;
        continue;
      }

      const outPath = path.join(CONFIG.distDir, lang, relPath);
      if (!DRY_RUN) {
        writeFile(outPath, builtHtml);
      }

      process.stdout.write(`    ✓ ${lang}  →  ${path.join(lang, relPath)}\n`);
      totalPages++;
    }
  }

  // ── 5. Copy assets ──────────────────────────────────────────────────────
  if (!DRY_RUN) {
    console.log('\n[assets] Copying assets/...');
    copyDir(
      path.join(CONFIG.srcDir, CONFIG.assetsDir),
      path.join(CONFIG.distDir, CONFIG.assetsDir)
    );

    // Copy static root files
    for (const file of CONFIG.staticFiles) {
      const src = path.join(CONFIG.srcDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(CONFIG.distDir, file));
        console.log(`[assets] Copied ${file}`);
      }
    }
  }

  // ── 6. Generate _redirects ──────────────────────────────────────────────
  const redirectsContent = _generateRedirects(langs, CONFIG.defaultLang);
  if (!DRY_RUN) {
    writeFile(path.join(CONFIG.distDir, '_redirects'), redirectsContent);
    console.log('\n[redirects] Generated _redirects');
  } else {
    console.log('\n[redirects] (dry-run) Would generate:');
    console.log(redirectsContent.split('\n').map(l => '  ' + l).join('\n'));
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('');
  console.log('─────────────────────────────────────────');
  if (totalErrors > 0) {
    console.log(`✗ Build completed with ${totalErrors} error(s)`);
  } else {
    console.log('✓ Build successful');
  }
  console.log(`  ${totalPages} page(s) × ${langs.length} language(s) in ${elapsed}s`);
  if (!DRY_RUN) {
    console.log(`  Output: ./${CONFIG.distDir}/`);
  }
  console.log('─────────────────────────────────────────');
  console.log('');

  if (totalErrors > 0) process.exit(1);
}

// ── _redirects generator ──────────────────────────────────────────────────

/**
 * Generate a Cloudflare Pages _redirects file for the production build.
 *
 * Logic:
 *  - Root "/" → short redirect to /{defaultLang}/home/
 *  - Each "/{lang}/*" → serves from dist/{lang}/:splat
 *  - Assets served directly
 *
 * @param {string[]} langs
 * @param {string}   defaultLang
 * @returns {string}
 */
function _generateRedirects(langs, defaultLang) {
  const lines = [
    '# _redirects — generated by scripts/build.js',
    '# DO NOT EDIT MANUALLY — edit build.js to change redirect logic',
    '',
    '# ── Root: redirect to default language ──────────────────────────────',
    `/ /${defaultLang}/home/ 302`,
    '',
    '# ── Language-specific pages ─────────────────────────────────────────',
  ];

  for (const lang of langs) {
    lines.push(`/${lang}     /${lang}/home/index.html 200`);
    lines.push(`/${lang}/    /${lang}/home/index.html 200`);
    lines.push(`/${lang}/*   /${lang}/:splat           200`);
    lines.push('');
  }

  lines.push(
    '# ── Static assets (served directly) ─────────────────────────────────',
    '/assets/*    /assets/:splat    200',
    '/robots.txt  /robots.txt       200',
    '/sitemap.xml /sitemap.xml      200',
    '/favicon.ico /assets/images/fantrove-hub360.ico 200',
    '',
    '# ── Fallback: unknown routes → default 404 ──────────────────────────',
    `/*  /${defaultLang}/home/index.html 404`,
    '',
  );

  return lines.join('\n');
}

// ── Run ───────────────────────────────────────────────────────────────────

build().catch(err => {
  console.error('\n[build] ✗ Fatal error:', err.message);
  if (VERBOSE) console.error(err.stack);
  process.exit(1);
});