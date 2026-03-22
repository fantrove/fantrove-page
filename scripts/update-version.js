#!/usr/bin/env node
// scripts/update-version.js — Fantrove Verse Release Tool
'use strict';

const fs   = require('fs');
const path = require('path');

const MAX_HISTORY = 7;

const CONFIG = {
  versionFile:  'assets/json/version.json',
  whatsNewFile: 'assets/json/whats-new.json',
  historyFile:  'assets/json/release-history.json',
  excludeDirs:  new Set(['node_modules', '.git', 'scripts', '.cloudflare', 'dist', 'build']),
  htmlExts:     new Set(['.html', '.htm']),
  assetPattern: /((?:src|href)=["'][^"':]*?\.(?:js|css|json))\?v=[^"'\s&]*/g
};

// ── ข้อความ fallback เมื่อไม่ได้อัปเดต whats-new.json ─────────────────────
// ใช้เมื่อ deploy โดยไม่เปลี่ยน version หรือไม่เปลี่ยนเนื้อหา
const FALLBACK_CONTENT = {
  title:    { en: 'System update',     th: 'อัปเดตระบบ' },
  subtitle: { en: 'Minor improvements and stability fixes.',
              th: 'ปรับปรุงเล็กน้อยและแก้ไขความเสถียรของระบบ' },
  sections: [{
    type: 'improved',
    items: [{
      title: { en: 'System improvements', th: 'ปรับปรุงระบบ' },
      desc:  { en: 'Various under-the-hood improvements.',
               th: 'ปรับปรุงการทำงานภายในระบบ' }
    }]
  }]
};

// ── Semver helpers ────────────────────────────────────────────────────────────

function parseSemver(v) {
  var m = String(v || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

// บวก patch ทีละ 1: 1.0.3 → 1.0.4, 1.0.9 → 1.0.10 (ไม่ wrap ไป minor)
function incrementPatch(v) {
  var s = parseSemver(v);
  if (!s) return v;
  return s.major + '.' + s.minor + '.' + (s.patch + 1);
}

// ── อ่าน APP_VERSION ──────────────────────────────────────────────────────────

var envVersion = process.env.APP_VERSION || process.argv[2];
const isSilent = process.env.DEPLOY_SILENT === '1' || process.argv.includes('--silent');
const ROOT     = path.resolve(__dirname, '..');

// อ่าน version.json ปัจจุบัน
const versionPath = path.join(ROOT, CONFIG.versionFile);
let currentData = {};
try { currentData = JSON.parse(fs.readFileSync(versionPath, 'utf8')); } catch (_) {}
const currentVersion = currentData.version || '0.0.0';

// ── ตัดสินใจ version ใหม่ ─────────────────────────────────────────────────────

let newVersion;
let autoIncremented = false;

if (!envVersion) {
  console.error('\n  ❌  ไม่พบ APP_VERSION\n'); process.exit(1);
}

if (!parseSemver(envVersion)) {
  console.error(`\n  ❌  APP_VERSION "${envVersion}" ไม่ใช่ semver\n`); process.exit(1);
}

if (envVersion === currentVersion) {
  // APP_VERSION ไม่ได้เปลี่ยน → auto-increment patch
  newVersion = incrementPatch(currentVersion);
  autoIncremented = true;
  console.log(`\n⚡  APP_VERSION ไม่เปลี่ยน (${envVersion})`);
  console.log(`    Auto-increment patch: ${currentVersion} → ${newVersion}`);
} else {
  newVersion = envVersion;
  console.log(`\n📦  Version: ${currentVersion} → ${newVersion}`);
}

const today   = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const buildId = `${newVersion}-${today}`;
console.log(`    Build ID: ${buildId} | Silent: ${isSilent}\n`);

// ── อ่าน whats-new.json ───────────────────────────────────────────────────────

const whatsNewPath = path.join(ROOT, CONFIG.whatsNewFile);
let whatsNew = null;
let whatsNewMatchesVersion = false;

try {
  whatsNew = JSON.parse(fs.readFileSync(whatsNewPath, 'utf8'));
  whatsNewMatchesVersion = (whatsNew.version === newVersion);
} catch (e) {
  console.log(`⚠️   ไม่พบ whats-new.json`);
}

// ── ตัดสินใจเนื้อหา ───────────────────────────────────────────────────────────

let contentToUse;
let usingFallback = false;

if (whatsNewMatchesVersion) {
  contentToUse = whatsNew;
  console.log(`✅  whats-new.json: ตรงกับ v${newVersion}`);
} else {
  // whats-new.json ไม่ตรง (ไม่ได้อัปเดต หรือ auto-increment)
  // → ใช้ fallback content + version ใหม่
  contentToUse = Object.assign({}, FALLBACK_CONTENT, { version: newVersion });
  usingFallback = true;

  if (autoIncremented) {
    console.log(`ℹ️   Auto-increment → ใช้ข้อความ fallback`);
  } else {
    console.log(`⚠️   whats-new.json version (${whatsNew && whatsNew.version}) ไม่ตรงกับ v${newVersion}`);
    console.log(`    ใช้ข้อความ fallback แทน`);
  }

  // เขียน whats-new.json ให้ตรงกับ version ใหม่ (ใช้ fallback content)
  const updatedWhatsNew = Object.assign({}, contentToUse);
  fs.writeFileSync(whatsNewPath, JSON.stringify(updatedWhatsNew, null, 2) + '\n');
  console.log(`✅  whats-new.json: เขียน fallback content สำหรับ v${newVersion}`);
}

// ── จัดการ release-history.json ──────────────────────────────────────────────

const historyPath = path.join(ROOT, CONFIG.historyFile);
let history = { releases: [] };
try {
  history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  if (!Array.isArray(history.releases)) history.releases = [];
} catch (_) {}

if (currentVersion !== newVersion) {
  const alreadyIn = history.releases.some(r => r.version === currentVersion);
  if (!alreadyIn && currentVersion !== '0.0.0') {
    // เพิ่ม version เก่าเข้า history
    const oldEntry = {
      version:  currentVersion,
      date:     { en: new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }),
                  th: new Date().toLocaleDateString('th-TH',  { year:'numeric', month:'long', day:'numeric' }) },
      title:    (whatsNew && whatsNew.title)    || FALLBACK_CONTENT.title,
      subtitle: (whatsNew && whatsNew.subtitle) || FALLBACK_CONTENT.subtitle,
      sections: (whatsNew && whatsNew.sections) || FALLBACK_CONTENT.sections
    };
    history.releases.unshift(oldEntry);
    console.log(`📋  เพิ่ม v${currentVersion} เข้า history`);
  }

  if (history.releases.length > MAX_HISTORY) {
    const removed = history.releases.splice(MAX_HISTORY);
    console.log(`🗑️   ลบประวัติเก่า: ${removed.map(r => r.version).join(', ')}`);
  }

  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + '\n');
  console.log(`✅  release-history.json: ${history.releases.length}/${MAX_HISTORY}`);
}

// ── ดึง changelog ─────────────────────────────────────────────────────────────

let changelog = [];
(contentToUse.sections || []).forEach(function(s) {
  (s.items || []).forEach(function(item) {
    const title = item.title && (item.title.en || item.title.th);
    if (title) changelog.push(title);
  });
});

// ── อัปเดต version.json ───────────────────────────────────────────────────────

const newData = {
  version:   newVersion,
  build:     buildId,
  timestamp: Date.now(),
  notify:    !isSilent,
  changelog
};
fs.mkdirSync(path.dirname(versionPath), { recursive: true });
fs.writeFileSync(versionPath, JSON.stringify(newData, null, 2) + '\n');
console.log(`✅  version.json → ${buildId}`);

// ── Scan & rewrite HTML ───────────────────────────────────────────────────────

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
    if (rewritten !== orig) { fs.writeFileSync(full, rewritten, 'utf8'); updated++; console.log(`  ✅  ${path.relative(ROOT, full)}`); }
  }
}
console.log('\nScanning HTML...');
walk(ROOT);

console.log(`\n${'─'.repeat(52)}`);
console.log(`  Version:    ${currentVersion} → ${newVersion}${autoIncremented ? ' (auto)' : ''}`);
console.log(`  Build:      ${buildId}`);
console.log(`  Content:    ${usingFallback ? 'fallback (generic)' : 'whats-new.json'}`);
console.log(`  HTML:       ${updated}/${scanned} updated`);
console.log(`${'─'.repeat(52)}\n🚀  Ready!\n`);