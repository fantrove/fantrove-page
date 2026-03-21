#!/usr/bin/env node
// =============================================================
// scripts/update-version.js — Fantrove Verse Release Tool
// =============================================================
//
// ใช้งาน:
//   node scripts/update-version.js <version> [options] [changelog...]
//
// ตัวอย่าง:
//   node scripts/update-version.js 1.0.1 "Added dark mode" "Fixed login"
//   node scripts/update-version.js 1.0.1 --silent
//   node scripts/update-version.js 1.0.1 --keep-changelog
//   node scripts/update-version.js 1.0.1 --silent --keep-changelog
//
// Options:
//   --silent          ไม่แสดง popup แจ้งเตือนผู้ใช้ (silent update)
//   --keep-changelog  ใช้ changelog เดิมจาก version.json ไม่ reset
//
// Cloudflare Pages build command:
//   node scripts/update-version.js $CF_PAGES_BRANCH
//   (หรือตั้ง VERSION ใน environment variables)
//
// =============================================================

'use strict';

const fs   = require('fs');
const path = require('path');

// ── ⚙️  CONFIG — ปรับได้ตามโปรเจกต์ ─────────────────────────────────────
const CONFIG = {
  // Path ของ version.json (relative จาก project root)
  versionFile: 'assets/json/version.json',

  // Directories ที่ข้ามไม่ scan
  excludeDirs: new Set([
    'node_modules', '.git', 'scripts', '.cloudflare',
    'dist', 'build', '.next', '.nuxt', 'vendor', 'coverage'
  ]),

  // Extensions ของไฟล์ HTML ที่จะอัปเดต
  htmlExtensions: new Set(['.html', '.htm']),

  // Regex จับ versioned asset references ใน HTML
  // จับได้: src="...file.js?v=xxx"  href="...file.css?v=xxx"
  // ไม่จับ: external CDN URLs (เพราะมี :// อยู่ใน URL)
  assetPattern: /((?:src|href)=["'][^"':]*?\.(?:js|css|json))\?v=[^"'\s&]*/g
};
// ──────────────────────────────────────────────────────────────────────────

// ── Parse args ─────────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);

if (!rawArgs.length) {
  printUsage();
  process.exit(1);
}

const newVersion = rawArgs[0];

if (newVersion === '--help' || newVersion === '-h') {
  printUsage();
  process.exit(0);
}

if (!/^\d+\.\d+\.\d+/.test(newVersion)) {
  err(`Version must follow semver: 1.2.3  (got: ${newVersion})`);
  process.exit(1);
}

const isSilent       = rawArgs.includes('--silent');
const keepChangelog  = rawArgs.includes('--keep-changelog');

// Changelog = positional args after version, ข้าม flags ทั้งหมด
const changelog = rawArgs.slice(1).filter(a => !a.startsWith('--'));

// ── Build ID ────────────────────────────────────────────────────────────────

const today   = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const buildId = `${newVersion}-${today}`;

// ── Project root = parent ของ scripts/ ─────────────────────────────────────

const ROOT = path.resolve(__dirname, '..');

// ── Step 1: Update version.json ─────────────────────────────────────────────

const versionPath = path.join(ROOT, CONFIG.versionFile);

let existing = {};
try {
  existing = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
} catch (_) {}

// ถ้า keepChangelog และไม่มี changelog ใหม่ → ใช้อันเดิม
const finalChangelog = changelog.length
  ? changelog
  : (keepChangelog && existing.changelog ? existing.changelog : []);

const newData = {
  version:   newVersion,
  build:     buildId,
  timestamp: Date.now(),
  notify:    !isSilent,
  changelog: finalChangelog
};

fs.mkdirSync(path.dirname(versionPath), { recursive: true });
fs.writeFileSync(versionPath, JSON.stringify(newData, null, 2) + '\n');

ok(`version.json updated`);
console.log(`    version:   ${newVersion}`);
console.log(`    build:     ${buildId}`);
console.log(`    notify:    ${!isSilent}`);
if (finalChangelog.length) {
  console.log(`    changelog:`);
  finalChangelog.forEach(c => console.log(`      • ${c}`));
} else {
  console.log(`    changelog: (none)`);
}
console.log('');

// ── Step 2: Auto-scan & rewrite all HTML files ──────────────────────────────

let scanned = 0;
let updated = 0;

console.log('Scanning HTML files...\n');

walkDir(ROOT);

function walkDir(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }

  for (const entry of entries) {
    // ข้าม hidden folders และ excluded dirs
    if (entry.name.startsWith('.') || CONFIG.excludeDirs.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walkDir(fullPath);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!CONFIG.htmlExtensions.has(ext)) continue;

      scanned++;
      const original = fs.readFileSync(fullPath, 'utf8');
      const rewritten = original.replace(CONFIG.assetPattern, `$1?v=${buildId}`);

      if (rewritten !== original) {
        fs.writeFileSync(fullPath, rewritten, 'utf8');
        ok(path.relative(ROOT, fullPath));
        updated++;
      }
    }
  }
}

// ── Summary ─────────────────────────────────────────────────────────────────

console.log('');
console.log('─'.repeat(52));
console.log(`  ✅  ${updated} / ${scanned} HTML files updated`);
console.log(`  📦  Build:  ${buildId}`);
console.log(`  🔔  Notify: ${isSilent ? 'NO (silent deploy)' : 'YES — popup will show'}`);
if (finalChangelog.length) {
  console.log(`  📋  ${finalChangelog.length} changelog item(s) included`);
}
console.log('─'.repeat(52));
console.log('\n🚀  Ready to commit & push!\n');

// ── Helpers ─────────────────────────────────────────────────────────────────

function ok(msg)  { console.log(`  ✅  ${msg}`); }
function err(msg) { console.error(`\n  ❌  ${msg}\n`); }

function printUsage() {
  console.log(`
  Fantrove Verse — Release Tool
  ─────────────────────────────────────────────────────────
  Usage:
    node scripts/update-version.js <version> [options] [changelog...]

  Arguments:
    version       Semver string, e.g. 1.0.1
    changelog...  One or more quoted strings describing changes

  Options:
    --silent          Deploy without user notification popup
    --keep-changelog  Reuse existing changelog from version.json
    --help, -h        Show this help

  Examples:
    node scripts/update-version.js 1.0.1
    node scripts/update-version.js 1.0.1 "Dark mode" "Bug fixes"
    node scripts/update-version.js 1.0.1 --silent
    node scripts/update-version.js 1.0.1 --keep-changelog
  ─────────────────────────────────────────────────────────
`);
}