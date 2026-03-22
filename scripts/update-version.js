#!/usr/bin/env node
// scripts/update-version.js — Fantrove Verse Release Tool
// whats-new.json  = current release เท่านั้น (เขียนเองก่อน deploy)
// release-history.json = build script จัดการอัตโนมัติ ไม่ต้องแตะ
'use strict';

const fs   = require('fs');
const path = require('path');

const MAX_HISTORY = 7;

const CONFIG = {
  versionFile:   'assets/json/version.json',
  whatsNewFile:  'assets/json/whats-new.json',
  historyFile:   'assets/json/release-history.json',
  excludeDirs:   new Set(['node_modules', '.git', 'scripts', '.cloudflare', 'dist', 'build']),
  htmlExts:      new Set(['.html', '.htm']),
  assetPattern:  /((?:src|href)=["'][^"':]*?\.(?:js|css|json))\?v=[^"'\s&]*/g
};

const newVersion = process.env.APP_VERSION || process.argv[2];
if (!newVersion) {
  console.error('\n  ❌  ไม่พบ APP_VERSION\n'); process.exit(1);
}
if (!/^\d+\.\d+\.\d+/.test(newVersion)) {
  console.error(`\n  ❌  APP_VERSION "${newVersion}" ไม่ใช่ semver\n`); process.exit(1);
}

const isSilent = process.env.DEPLOY_SILENT === '1' || process.argv.includes('--silent');
const ROOT     = path.resolve(__dirname, '..');
const today    = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const buildId  = `${newVersion}-${today}`;

console.log(`\n📦  Fantrove Release Tool`);
console.log(`    Version:  ${newVersion} | Build: ${buildId} | Silent: ${isSilent}\n`);

// ── Step 1: อ่าน whats-new.json (current release) ────────────────────────────
const whatsNewPath = path.join(ROOT, CONFIG.whatsNewFile);
let current = null;
try {
  current = JSON.parse(fs.readFileSync(whatsNewPath, 'utf8'));
  if (current.version !== newVersion) {
    console.warn(`⚠️   whats-new.json version (${current.version}) ไม่ตรงกับ APP_VERSION (${newVersion})`);
    console.warn(`    อัปเดต whats-new.json ให้ตรงกับ version ใหม่ก่อน deploy`);
  } else {
    console.log(`✅  whats-new.json: v${current.version} ready`);
  }
} catch (e) {
  console.log(`⚠️   ไม่พบ whats-new.json: ${e.message}`);
}

// ── Step 2: อ่าน release-history.json แล้วอัปเดต ────────────────────────────
// ไฟล์นี้ build script จัดการเอง ไม่ต้องแตะด้วยมือ
const historyPath = path.join(ROOT, CONFIG.historyFile);
let history = { releases: [] };
try {
  history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  if (!Array.isArray(history.releases)) history.releases = [];
} catch (e) {
  console.log(`ℹ️   สร้าง release-history.json ใหม่`);
}

// หา version ก่อนหน้าใน history เพื่อเอาไปเพิ่ม
// (ดึงจาก version.json เดิมก่อนที่จะ overwrite)
const oldVersionPath = path.join(ROOT, CONFIG.versionFile);
let oldVersion = null;
try {
  const oldData = JSON.parse(fs.readFileSync(oldVersionPath, 'utf8'));
  oldVersion = oldData.version;
} catch (e) {}

// ถ้า version ใหม่ต่างจากเดิม และ current มีข้อมูล → เพิ่มเข้า history
if (current && oldVersion && oldVersion !== newVersion) {
  // ตรวจว่ายังไม่มีใน history
  const alreadyIn = history.releases.some(r => r.version === oldVersion);
  if (!alreadyIn) {
    // ดึง release เก่าจาก history หรือ whats-new เพื่อเพิ่ม
    // อ่าน whats-new ของ version ก่อนหน้าจาก history ที่มีอยู่แล้ว
    // ถ้าไม่มี → ใช้ข้อมูลจาก version.json เดิม
    let oldRelease = null;
    try {
      const oldVerData = JSON.parse(fs.readFileSync(oldVersionPath, 'utf8'));
      // สร้าง minimal release record จาก version.json เดิม
      oldRelease = {
        version:  oldVerData.version,
        date:     { en: new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }),
                    th: new Date().toLocaleDateString('th-TH',  { year:'numeric', month:'long', day:'numeric' }) },
        changelog: oldVerData.changelog || []
      };
    } catch (e) {}

    if (oldRelease) {
      history.releases.unshift(oldRelease);
      console.log(`📋  เพิ่ม v${oldRelease.version} เข้า history`);
    }
  }

  // ตัดเกิน MAX_HISTORY
  if (history.releases.length > MAX_HISTORY) {
    const removed = history.releases.splice(MAX_HISTORY);
    console.log(`🗑️   ลบประวัติเก่า ${removed.map(r=>r.version).join(', ')} (เก็บแค่ ${MAX_HISTORY})`);
  }

  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + '\n');
  console.log(`✅  release-history.json: ${history.releases.length} releases`);
}

// ── Step 3: ดึง changelog จาก whats-new.json ────────────────────────────────
let changelog = [];
if (current) {
  (current.sections || []).forEach(s => {
    (s.items || []).forEach(item => {
      const title = item.title && (item.title.en || item.title.th);
      if (title) changelog.push(title);
    });
  });
}

// ── Step 4: อัปเดต version.json ─────────────────────────────────────────────
const versionPath = oldVersionPath;
const newData = { version: newVersion, build: buildId, timestamp: Date.now(), notify: !isSilent, changelog };
fs.mkdirSync(path.dirname(versionPath), { recursive: true });
fs.writeFileSync(versionPath, JSON.stringify(newData, null, 2) + '\n');
console.log(`✅  version.json → ${buildId}`);

// ── Step 5: Scan & rewrite HTML ──────────────────────────────────────────────
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
    const orig = fs.readFileSync(full, 'utf8');
    const rewritten = orig.replace(CONFIG.assetPattern, `$1?v=${buildId}`);
    if (rewritten !== orig) { fs.writeFileSync(full, rewritten, 'utf8'); updated++; console.log(`  ✅  ${path.relative(ROOT, full)}`); }
  }
}
console.log('\nScanning HTML...');
walk(ROOT);
console.log(`\n✅  ${updated}/${scanned} HTML updated | 🚀  ${buildId}\n`);