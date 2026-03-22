#!/usr/bin/env node
// scripts/update-version.js — Fantrove Verse Release Tool
//
// ══════════════════════════════════════════════════════════════
//  3 โหมด (ตัดสินโดย APP_VERSION + เนื้อหา whats-new.json)
// ──────────────────────────────────────────────────────────────
//  EXPLICIT      : APP_VERSION=x.x.x ตั้งมาเอง → ใช้ตามนั้น
//  AUTO-INCREMENT: ไม่ตั้ง APP_VERSION แต่ whats-new.json เปลี่ยน
//                  → patch +1 (1.0.9 → 1.0.10, ไม่ใช่ 1.1.0)
//  SILENT REBUILD: ไม่ตั้ง APP_VERSION + ไม่มีอะไรเปลี่ยนเลย
//                  → build date ใหม่, notify=false, ไม่ pop-up ซ้ำ
// ══════════════════════════════════════════════════════════════
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

const ROOT = path.resolve(__dirname, '..');

// ── Utility: เพิ่ม patch ทีละ 1 แบบ integer ─────────────────────────────────
// ทำให้ 1.0.9 → 1.0.10  (ไม่ใช่ 1.1.0 จากการบวกทศนิยม)
function incrementPatch(version) {
  const parts = String(version || '0.0.0').split('.');
  const major = parseInt(parts[0], 10) || 0;
  const minor = parseInt(parts[1], 10) || 0;
  const patch = parseInt(parts[2], 10) || 0;
  return `${major}.${minor}.${patch + 1}`;
}

// ── Utility: hash เนื้อหา whats-new.json เพื่อตรวจว่า "เปลี่ยนจริงไหม" ──────
// ใช้ djb2 — เร็ว เพียงพอสำหรับ content fingerprint
function hashContent(obj) {
  const str = JSON.stringify(obj, null, 0);
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0; // unsigned 32-bit
  }
  return h.toString(16).padStart(8, '0');
}

// ── อ่านไฟล์ JSON อย่างปลอดภัย ──────────────────────────────────────────────
function readJSON(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

// ════════════════════════════════════════════════════════════════
//  ขั้นตอนที่ 0: ตรวจสอบโหมดและหา version ที่จะใช้
// ════════════════════════════════════════════════════════════════

const explicitVersion = process.env.APP_VERSION || process.argv[2];
const isForceSilent   = process.env.DEPLOY_SILENT === '1' || process.argv.includes('--silent');

const versionPath  = path.join(ROOT, CONFIG.versionFile);
const whatsNewPath = path.join(ROOT, CONFIG.whatsNewFile);
const historyPath  = path.join(ROOT, CONFIG.historyFile);

// อ่านสถานะปัจจุบัน
const oldVerData  = readJSON(versionPath, { version: '1.0.0', build: '', contentHash: '' });
const oldVersion  = oldVerData.version || '1.0.0';
const oldHash     = oldVerData.contentHash || '';

// อ่าน whats-new.json (current release)
const current = readJSON(whatsNewPath, null);
const newHash = current ? hashContent(current) : '';

// ─── ตัดสินโหมด ─────────────────────────────────────────────────────────────
let MODE, newVersion, isSilent;

if (explicitVersion) {
  // ── EXPLICIT MODE ─────────────────────────────────────────────
  if (!/^\d+\.\d+\.\d+/.test(explicitVersion)) {
    console.error(`\n  ❌  APP_VERSION "${explicitVersion}" ไม่ใช่ semver (ต้องเป็น x.y.z)\n`);
    process.exit(1);
  }
  MODE       = 'EXPLICIT';
  newVersion = explicitVersion;
  isSilent   = isForceSilent;

} else if (newHash && newHash !== oldHash) {
  // ── AUTO-INCREMENT MODE ──────────────────────────────────────
  // whats-new.json เปลี่ยน → บวก patch +1
  MODE       = 'AUTO-INCREMENT';
  newVersion = incrementPatch(oldVersion);
  isSilent   = isForceSilent;

} else {
  // ── SILENT REBUILD MODE ──────────────────────────────────────
  // ไม่มีอะไรเปลี่ยน → build ใหม่วันนี้ แต่ไม่ pop-up
  MODE       = 'SILENT-REBUILD';
  newVersion = oldVersion;  // version เดิม
  isSilent   = true;        // บังคับ silent เสมอ
}

// build ID ใช้วันที่ปัจจุบันเสมอ
const today   = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const buildId = `${newVersion}-${today}`;

// ─── แสดงผลสรุป ──────────────────────────────────────────────────────────────
const modeLabel = {
  'EXPLICIT':       '📌 EXPLICIT       (version จากผู้ใช้)',
  'AUTO-INCREMENT': '🔢 AUTO-INCREMENT (patch +1 จาก content เปลี่ยน)',
  'SILENT-REBUILD': '♻️  SILENT-REBUILD (ไม่มีอะไรเปลี่ยน, ไม่ pop-up)',
};
console.log(`\n📦  Fantrove Release Tool`);
console.log(`    Mode:    ${modeLabel[MODE]}`);
console.log(`    Old:     v${oldVersion}  (hash: ${oldHash || 'none'})`);
console.log(`    New:     v${newVersion}  (hash: ${newHash})`);
console.log(`    Build:   ${buildId}`);
console.log(`    Silent:  ${isSilent}\n`);

// ════════════════════════════════════════════════════════════════
//  ขั้นตอนที่ 1: ตรวจ whats-new.json
// ════════════════════════════════════════════════════════════════

if (!current) {
  console.warn(`⚠️   ไม่พบ whats-new.json`);
} else {
  // ใน AUTO-INCREMENT ต้องอัปเดต version field ใน whats-new.json ด้วย
  if (MODE === 'AUTO-INCREMENT') {
    current.version = newVersion;
    fs.writeFileSync(whatsNewPath, JSON.stringify(current, null, 2) + '\n');
    console.log(`✅  whats-new.json: version อัปเดตเป็น ${newVersion}`);
  } else if (current.version !== newVersion && MODE === 'EXPLICIT') {
    console.warn(`⚠️   whats-new.json version (${current.version}) ≠ APP_VERSION (${newVersion})`);
    console.warn(`    ควรอัปเดต whats-new.json ให้ตรงก่อน deploy`);
  } else {
    console.log(`✅  whats-new.json: v${current.version} (${MODE === 'SILENT-REBUILD' ? 'unchanged' : 'ready'})`);
  }
}

// ════════════════════════════════════════════════════════════════
//  ขั้นตอนที่ 2: อัปเดต release-history.json
// ════════════════════════════════════════════════════════════════

let history = readJSON(historyPath, { releases: [] });
if (!Array.isArray(history.releases)) history.releases = [];

// เพิ่ม version เก่าเข้า history เฉพาะเมื่อ version เปลี่ยนจริง
const versionChanged = (newVersion !== oldVersion);

if (versionChanged && current) {
  const alreadyIn = history.releases.some(r => r.version === oldVersion);
  if (!alreadyIn && oldVersion) {
    // สร้าง record สำหรับ version เก่า
    // พยายามอ่าน whats-new เก่าจาก content ที่มีอยู่ (ก่อนถูก overwrite)
    // ถ้าเป็น AUTO-INCREMENT current ก็คือ content ของ version เก่า (เพิ่งอ่านมา)
    const dateStr   = new Date();
    const dateEn    = dateStr.toLocaleDateString('en-US',  { year:'numeric', month:'long', day:'numeric' });
    const dateTh    = dateStr.toLocaleDateString('th-TH',  { year:'numeric', month:'long', day:'numeric' });

    let oldRelease;
    if (MODE === 'AUTO-INCREMENT' && current) {
      // ใช้ content จาก whats-new.json ก่อน increment (current ยังมี title/sections เดิม)
      oldRelease = {
        version:  oldVersion,
        date:     current.date || { en: dateEn, th: dateTh },
        title:    current.title,
        subtitle: current.subtitle,
        sections: current.sections || []
      };
    } else {
      oldRelease = {
        version:  oldVersion,
        date:     { en: dateEn, th: dateTh },
        changelog: oldVerData.changelog || []
      };
    }

    history.releases.unshift(oldRelease);
    console.log(`📋  เพิ่ม v${oldVersion} เข้า history`);
  }

  // ตัดเกิน MAX_HISTORY
  if (history.releases.length > MAX_HISTORY) {
    const removed = history.releases.splice(MAX_HISTORY);
    console.log(`🗑️   ลบประวัติเก่า: ${removed.map(r => r.version).join(', ')} (เก็บแค่ ${MAX_HISTORY})`);
  }

  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + '\n');
  console.log(`✅  release-history.json: ${history.releases.length} releases`);
} else {
  console.log(`ℹ️   release-history.json: ไม่มีการเปลี่ยนแปลง (version เดิม)`);
}

// ════════════════════════════════════════════════════════════════
//  ขั้นตอนที่ 3: ดึง changelog จาก whats-new.json
// ════════════════════════════════════════════════════════════════

let changelog = [];
if (current) {
  (current.sections || []).forEach(s => {
    (s.items || []).forEach(item => {
      const title = item.title && (item.title.en || item.title.th);
      if (title) changelog.push(title);
    });
  });
}

// ════════════════════════════════════════════════════════════════
//  ขั้นตอนที่ 4: เขียน version.json ใหม่
// ════════════════════════════════════════════════════════════════

const newData = {
  version:     newVersion,
  build:       buildId,
  timestamp:   Date.now(),
  notify:      !isSilent,
  changelog,
  contentHash: newHash   // เก็บ hash ไว้ตรวจครั้งถัดไป
};

fs.mkdirSync(path.dirname(versionPath), { recursive: true });
fs.writeFileSync(versionPath, JSON.stringify(newData, null, 2) + '\n');
console.log(`✅  version.json → ${buildId} | notify=${!isSilent}`);

// ════════════════════════════════════════════════════════════════
//  ขั้นตอนที่ 5: Scan & rewrite HTML (bust cache ด้วย ?v=buildId)
// ════════════════════════════════════════════════════════════════

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

console.log('\nScanning HTML...');
walk(ROOT);

// ── สรุปผล ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(56)}`);
console.log(`  Mode:    ${MODE}`);
console.log(`  Version: v${oldVersion} → v${newVersion}`);
console.log(`  Build:   ${buildId}`);
console.log(`  Notify:  ${!isSilent}`);
console.log(`  HTML:    ${updated}/${scanned} files updated`);
console.log(`${'─'.repeat(56)}\n`);