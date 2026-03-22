#!/usr/bin/env node
// scripts/update-version.js — Fantrove Verse Release Tool
// รับ version จาก environment variable APP_VERSION
// ตัวอย่าง build command ใน Cloudflare Pages:
//   node scripts/update-version.js
'use strict';

const fs   = require('fs');
const path = require('path');

const CONFIG = {
  versionFile:  'assets/json/version.json',
  whatsNewFile: 'assets/json/whats-new.json',
  excludeDirs:  new Set(['node_modules', '.git', 'scripts', '.cloudflare', 'dist', 'build']),
  htmlExts:     new Set(['.html', '.htm']),
  assetPattern: /((?:src|href)=["'][^"':]*?\.(?:js|css|json))\?v=[^"'\s&]*/g
};

// อ่าน version จาก ENV ก่อน ถ้าไม่มีค่อยดูจาก arg
const newVersion = process.env.APP_VERSION || process.argv[2];

if (!newVersion) {
  console.error('\n  ❌  ไม่พบ version');
  console.error('  กรุณาตั้ง APP_VERSION ใน Cloudflare Pages environment variables\n');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+/.test(newVersion)) {
  console.error(`\n  ❌  APP_VERSION "${newVersion}" ไม่ใช่รูปแบบ semver (1.2.3)\n`);
  process.exit(1);
}

const isSilent = process.env.DEPLOY_SILENT === '1' || process.argv.includes('--silent');
const ROOT     = path.resolve(__dirname, '..');
const today    = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const buildId  = `${newVersion}-${today}`;

console.log(`\n📦  Fantrove Release Tool`);
console.log(`    Version:  ${newVersion}`);
console.log(`    Build ID: ${buildId}`);
console.log(`    Silent:   ${isSilent}\n`);

// Step 1: อ่าน whats-new.json ดึง changelog ของ version นี้
const whatsNewPath = path.join(ROOT, CONFIG.whatsNewFile);
let changelog = [];

try {
  const whatsNew = JSON.parse(fs.readFileSync(whatsNewPath, 'utf8'));
  const release  = whatsNew;
  if (release) {
    (release.sections || []).forEach(function(section) {
      (section.items || []).forEach(function(item) {
        const title = item.title && (item.title.en || item.title.th);
        if (title) changelog.push(title);
      });
    });
    console.log(`✅  whats-new.json: พบ release "${newVersion}" — ${changelog.length} items`);
  } else {
    console.log(`⚠️   whats-new.json: ไม่พบ release "${newVersion}" — changelog จะว่างเปล่า`);
  }
} catch (e) {
  console.log(`⚠️   whats-new.json: ${e.message}`);
}

// Step 2: อัปเดต version.json
const versionPath = path.join(ROOT, CONFIG.versionFile);
try { JSON.parse(fs.readFileSync(versionPath, 'utf8')); } catch (_) {}

const newData = {
  version:   newVersion,
  build:     buildId,
  timestamp: Date.now(),
  notify:    !isSilent,
  changelog
};

fs.mkdirSync(path.dirname(versionPath), { recursive: true });
fs.writeFileSync(versionPath, JSON.stringify(newData, null, 2) + '\n');
console.log(`✅  version.json updated`);

// Step 3: Scan & rewrite HTML
let scanned = 0, updated = 0;

function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') || CONFIG.excludeDirs.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (!CONFIG.htmlExts.has(path.extname(e.name).toLowerCase())) continue;
    scanned++;
    const orig      = fs.readFileSync(full, 'utf8');
    const rewritten = orig.replace(CONFIG.assetPattern, `$1?v=${buildId}`);
    if (rewritten !== orig) {
      fs.writeFileSync(full, rewritten, 'utf8');
      updated++;
      console.log(`  ✅  ${path.relative(ROOT, full)}`);
    }
  }
}

console.log('\nScanning HTML files...');
walk(ROOT);
console.log(`\n✅  ${updated}/${scanned} HTML files updated`);
console.log(`\n🚀  Build complete: ${buildId}\n`);