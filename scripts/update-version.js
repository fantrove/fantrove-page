#!/usr/bin/env node
// scripts/update-version.js — Fantrove Verse Release Tool
// ─────────────────────────────────────────────────────────
//
//  การทำงาน (3 ไฟล์ วนรอบ):
//
//  ทุก deploy:
//    1. อ่าน whats-new.json  → รู้ว่า version ใหม่คืออะไร + เนื้อหา
//    2. อ่าน version.json    → เนื้อหา/version ปัจจุบันที่สำรองไว้
//    3. ถ้า version ใหม่ ≠ ปัจจุบัน:
//         → บันทึก version.json ลง release-history.json (archive)
//         → เขียน version.json ใหม่ด้วยเนื้อหาจาก whats-new.json
//    4. cache-bust HTML
//
//  ผู้ใช้ทำแค่:
//    แก้ whats-new.json (version + sections) → deploy
//
// ─────────────────────────────────────────────────────────
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

// ── Date helpers (UTC) ────────────────────────────────────

const EN_M = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const TH_M = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

function pad2(n) { return String(n).padStart(2, '0'); }

function makeDateObj(d) {
  const en = EN_M[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear()
    + ' at ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' UTC';
  const th = d.getUTCDate() + ' ' + TH_M[d.getUTCMonth()] + ' ' + (d.getUTCFullYear() + 543)
    + ' เวลา ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' UTC';
  return { en, th };
}

// ── Init ──────────────────────────────────────────────────

const isSilent = process.env.DEPLOY_SILENT === '1' || process.argv.includes('--silent');
const ROOT     = path.resolve(__dirname, '..');
const NOW      = new Date();
const dateObj  = makeDateObj(NOW);
const dateStr  = NOW.toISOString().slice(0, 10).replace(/-/g, '');
const timeStr  = pad2(NOW.getUTCHours()) + pad2(NOW.getUTCMinutes());

// ── อ่าน whats-new.json ───────────────────────────────────

const whatsNewPath = path.join(ROOT, CONFIG.whatsNewFile);
let whatsNew;
try { whatsNew = JSON.parse(fs.readFileSync(whatsNewPath, 'utf8')); }
catch (_) { console.error('\n  ❌  ไม่พบ whats-new.json\n'); process.exit(1); }

const newVersion = (whatsNew.version || '').trim();
if (!newVersion) {
  console.error('\n  ❌  whats-new.json ไม่มี "version"\n'); process.exit(1);
}

// ── อ่าน version.json (เนื้อหาปัจจุบัน) ─────────────────

const versionPath = path.join(ROOT, CONFIG.versionFile);
let currentData   = {};
try { currentData = JSON.parse(fs.readFileSync(versionPath, 'utf8')); } catch (_) {}
const currentVersion = currentData.version || '';

const buildId = `${newVersion}-${dateStr}${timeStr}`;

console.log(`\n📦  Version:  ${currentVersion || '(ไม่มี)'} → ${newVersion}`);
console.log(`    Build ID: ${buildId}`);
console.log(`    Date:     ${dateObj.en}\n`);

// ── อ่าน release-history.json ────────────────────────────

const historyPath = path.join(ROOT, CONFIG.historyFile);
let history = { releases: [] };
try {
  const h = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  if (Array.isArray(h.releases)) history = h;
} catch (_) {}

// ── STEP 1: archive version ปัจจุบัน → history ───────────
//
//  version.json เก็บเนื้อหาของ version ที่ deploy ครั้งล่าสุดไว้
//  เมื่อมี version ใหม่เข้ามา → ย้ายเนื้อหานั้นลง history ก่อน

if (currentVersion && currentVersion !== newVersion) {

  const alreadyIn = history.releases.some(r => r.version === currentVersion);

  if (!alreadyIn) {
    // ดึงเนื้อหาจาก content field ที่บันทึกไว้ใน version.json
    const saved = currentData.content || {};

    const entry = {
      version:  currentVersion,
      date:     currentData.buildDate || dateObj,
      title:    saved.title    || { en: 'System update',       th: 'อัปเดตระบบ' },
      subtitle: saved.subtitle || { en: 'Minor improvements.', th: 'ปรับปรุงเล็กน้อย' },
      sections: saved.sections || []
    };

    history.releases.unshift(entry);
    console.log(`📋  Archive v${currentVersion} → history`);
  } else {
    console.log(`ℹ️   v${currentVersion} อยู่ใน history แล้ว`);
  }

  // เก็บแค่ MAX_HISTORY
  if (history.releases.length > MAX_HISTORY) {
    const removed = history.releases.splice(MAX_HISTORY);
    console.log(`🗑️   ลบประวัติเก่า: ${removed.map(r => r.version).join(', ')}`);
  }

  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + '\n');
  console.log(`✅  release-history.json: ${history.releases.length}/${MAX_HISTORY}\n`);
}

// ── STEP 2: เขียน whats-new.json (เพิ่ม date) ────────────

const contentToSave = Object.assign({}, whatsNew, { version: newVersion, date: dateObj });
fs.writeFileSync(whatsNewPath, JSON.stringify(contentToSave, null, 2) + '\n');
console.log(`✅  whats-new.json → v${newVersion}`);

// ── STEP 3: เขียน version.json ───────────────────────────
//
//  บันทึกเนื้อหาของ version ใหม่ไว้ใน content field
//  เพื่อให้ deploy ถัดไปสามารถดึงไปเก็บใน history ได้

let changelog = [];
(whatsNew.sections || []).forEach(s =>
  (s.items || []).forEach(item => {
    const t = item.title && (item.title.en || item.title.th);
    if (t) changelog.push(t);
  })
);

const newVersionData = {
  version:   newVersion,
  build:     buildId,
  buildDate: dateObj,
  timestamp: NOW.getTime(),
  notify:    !isSilent,
  changelog,
  // สำรองเนื้อหาไว้ให้ deploy ถัดไปเอาไปเก็บ history
  content: {
    title:    whatsNew.title    || null,
    subtitle: whatsNew.subtitle || null,
    sections: whatsNew.sections || []
  }
};

fs.mkdirSync(path.dirname(versionPath), { recursive: true });
fs.writeFileSync(versionPath, JSON.stringify(newVersionData, null, 2) + '\n');
console.log(`✅  version.json → ${buildId}`);

// ── STEP 4: cache-bust HTML ───────────────────────────────

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
    const next = orig.replace(CONFIG.assetPattern, `$1?v=${buildId}`);
    if (next !== orig) {
      fs.writeFileSync(full, next, 'utf8');
      updated++;
      console.log(`  ✅  ${path.relative(ROOT, full)}`);
    }
  }
}

console.log('\nScanning HTML...');
walk(ROOT);

// ── Summary ───────────────────────────────────────────────

console.log(`\n${'─'.repeat(52)}`);
console.log(`  Version:  ${currentVersion || '-'} → ${newVersion}`);
console.log(`  Build:    ${buildId}`);
console.log(`  History:  ${history.releases.length}/${MAX_HISTORY}`);
console.log(`  HTML:     ${updated}/${scanned} updated`);
console.log(`${'─'.repeat(52)}\n🚀  Ready!\n`);