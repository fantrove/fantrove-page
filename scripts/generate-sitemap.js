#!/usr/bin/env node
'use strict';

/**
 * scripts/generate-sitemap.js
 * Generates sitemap.xml with hreflang alternates for every discovered HTML file.
 *
 * Usage:
 *   node scripts/generate-sitemap.js
 *
 * Requirements:
 *   - Uses scripts/lib/file-utils.js and scripts/lib/html-transformer.js config (to get baseUrl & langs).
 *   - Writes ./sitemap.xml (overwrites).
 */

const fs = require('fs');
const path = require('path');

const { findHtmlFiles, loadDbJson } = require('./lib/file-utils');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = {
  srcDir: ROOT,
  dbJsonPath: path.join('assets', 'lang', 'options', 'db.json'),
  baseUrl: 'https://fantrove.pages.dev'
};

function loadDb() {
  const db = loadDbJson(path.join(ROOT, CONFIG.dbJsonPath));
  if (!db) {
    console.error(`[sitemap] Cannot load db.json at ${CONFIG.dbJsonPath}`);
    process.exit(1);
  }
  return db;
}

function buildUrlEntries(htmlFiles, langs) {
  const entries = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const file of htmlFiles) {
    // compute relative path from root
    let rel = path.relative(CONFIG.srcDir, file).replace(/\\/g, '/');
    if (!rel) continue;
    // Normalize to site path: index.html -> /path/, page.html -> /path/page/
    if (rel.endsWith('index.html')) {
      rel = rel.replace(/index\.html$/, '');
    } else if (rel.endsWith('.html')) {
      rel = rel.replace(/\.html$/, '/');
    } else {
      continue;
    }

    if (!rel.startsWith('/')) rel = '/' + rel;
    // Skip root index.html mapping here (we'll include /home/ etc.). include everything though.
    const pathNoSlash = rel === '/' ? '/home/' : rel;

    const alternates = langs.map(l => {
      // ensure double slash not created
      return {
        lang: l,
        href: `${CONFIG.baseUrl}/${l}${pathNoSlash.startsWith('/') ? pathNoSlash : '/' + pathNoSlash}`
      };
    });

    entries.push({
      loc: `${CONFIG.baseUrl}/${langs[0]}${pathNoSlash}`, // default loc points to first lang
      lastmod: today,
      changefreq: 'weekly',
      priority: pathNoSlash === '/home/' ? '1.0' : '0.6',
      alternates
    });
  }

  // Deduplicate by loc
  const map = new Map();
  for (const e of entries) {
    if (!map.has(e.loc)) map.set(e.loc, e);
  }
  return Array.from(map.values());
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function generateXml(entries) {
  const header = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
    '        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';
  const footer = '</urlset>\n';

  const body = entries.map(e => {
    let out = '  <url>\n';
    out += `    <loc>${xmlEscape(e.loc)}</loc>\n`;
    out += `    <lastmod>${e.lastmod}</lastmod>\n`;
    out += `    <changefreq>${e.changefreq}</changefreq>\n`;
    out += `    <priority>${e.priority}</priority>\n`;
    for (const a of e.alternates) {
      out += `    <xhtml:link rel="alternate" hreflang="${a.lang}" href="${xmlEscape(a.href)}"/>\n`;
    }
    // x-default
    if (e.alternates.length) {
      out += `    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(e.alternates[0].href)}"/>\n`;
    }
    out += '  </url>\n';
    return out;
  }).join('\n');

  return header + body + footer;
}

function main() {
  const db = loadDb();
  const langs = Object.keys(db);
  if (!langs.length) {
    console.error('[sitemap] db.json has no languages');
    process.exit(1);
  }

  const htmlFiles = findHtmlFiles(CONFIG.srcDir, ['dist', 'node_modules', '.git', 'scripts', '.cloudflare']);
  console.log(`[sitemap] Found ${htmlFiles.length} HTML files`);

  const entries = buildUrlEntries(htmlFiles, langs);
  const xml = generateXml(entries);

  const outPath = path.join(ROOT, 'sitemap.xml');
  fs.writeFileSync(outPath, xml, 'utf8');
  console.log(`[sitemap] Written ${outPath} (${entries.length} entries)`);
}

main();