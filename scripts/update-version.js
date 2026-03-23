#!/usr/bin/env node
// scripts/update-version.js — Fantrove Verse Release Tool
// whats-new.json  = current release เท่านั้น (เขียนเองก่อน deploy)
// release-history.json = build script จัดการอัตโนมัติ ไม่ต้องแตะ
// version.json = build script สร้างเองอัตโนมัติ ไม่ต้องแตะ
'use strict';

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_HISTORY = 7;

const CONFIG = {
  versionFile:  'assets/json/version.json',
  whatsNewFile: 'assets/json/whats-new.json',
  historyFile:  'assets/json/release-history.json',
  excludeDirs:  new Set(['node_modules', '.git', 'scripts', '.cloudflare', 'dist', 'build']),
  htmlExts:     new Set(['.html', '.htm']),
  assetPattern: /((?:src|href)=["'][^"':]*?\.(?:js|css|json))\?v=[^"'\s&]*/g
};

const APP_VERSION = process.env.APP_VERSION || process.argv[2];
if (!APP_VERSION) {
  console.error('\n  ❌  ไม่พบ APP_VERSION\n'); process.exit(1);
}
if (!/^\d+\.\d+\.\d+/.test(APP_VERSION)) {
  console.error(`\n  ❌  APP_VERSION "${APP_VERSION}" ไม่ใช่ semver\n`); process.exit(1);
}

const isSilent = process.env.DEPLOY_SILENT === '1' || process.argv.includes('--silent');
const ROOT     = path.resolve(__dirname, '..');
const NOW      = new Date();

// ── UTC Date helpers ──────────────────────────────────────────────────────────

const EN_M = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const TH_M = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

function pad2(n) { return String(n).padStart(2, '0'); }

function makeDateObj(d) {
  return {
    en: EN_M[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear()
      + ' at ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' UTC',
    th: d.getUTCDate() + ' ' + TH_M[d.getUTCMonth()] + ' ' + (d.getUTCFullYear() + 543)
      + ' เวลา ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' UTC'
  };
}

// ── Git helper ────────────────────────────────────────────────────────────────

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'], cwd: ROOT });
  return r.status === 0 ? r.stdout.trim() : null;
}

// ── อ่านไฟล์ ──────────────────────────────────────────────────────────────────

const whatsNewPath = path.join(ROOT, CONFIG.whatsNewFile);
const versionPath  = path.join(ROOT, CONFIG.versionFile);
const historyPath  = path.join(ROOT, CONFIG.historyFile);

// อ่าน whats-new.json → รู้ version จริงที่จะ deploy
let whatsNew;
try { whatsNew = JSON.parse(fs.readFileSync(whatsNewPath, 'utf8')); }
catch (_) { console.error('\n  ❌  ไม่พบ whats-new.json\n'); process.exit(1); }

// ✅ ใช้ version จาก whats-new.json เป็น newVersion จริง
// ไม่ใช้ APP_VERSION เพราะ APP_VERSION อาจเป็นแค่ "1.0.5" ตลอด
// แต่ whats-new.json จะมีเลขที่ถูกต้องกว่าเสมอ เช่น "1.0.5.14"
const newVersion = (whatsNew.version || APP_VERSION).trim();

const dateObj = makeDateObj(NOW);
const dateStr = NOW.toISOString().slice(0, 10).replace(/-/g, '');
const timeStr = pad2(NOW.getUTCHours()) + pad2(NOW.getUTCMinutes());
const buildId = `${newVersion}-${dateStr}${timeStr}`;

console.log(`\n📦  Fantrove Release Tool`);
console.log(`    Version:  ${newVersion} | Build: ${buildId}`);
console.log(`    Date:     ${dateObj.en}\n`);

// ── STEP 1: จัดการ history ก่อน (ก่อนแตะไฟล์ใดๆ) ─────────────────────────────
//
//  อ่าน whats-new.json จาก git log ทุก commit
//  → ได้เนื้อหาจริงของทุก version ที่เคย deploy
//  → ✅ exclude ด้วย newVersion จาก whats-new.json ไม่ใช่ APP_VERSION
//     (นี่คือ root cause ของ bug 5.14 = 5.14)
//
//  ลำดับ: history ต้องเสร็จก่อนที่จะเขียน whats-new.json หรือ version.json

console.log('📚  Building history from git log...');

const commitLog = git(['log', '--format=%H %ct', '--', CONFIG.whatsNewFile]);
const commits   = commitLog
  ? commitLog.split('\n').filter(Boolean).map(line => {
      const [hash, ts] = line.split(' ');
      return { hash, ts: parseInt(ts, 10) * 1000 };
    }).reverse()   // เก่าสุดก่อน
  : [];

console.log(`    พบ ${commits.length} commit(s) ของ whats-new.json`);

// ✅ exclude newVersion (จาก whats-new.json) ไม่ใช่ APP_VERSION
const seenVersions = new Set([newVersion]);
const releases     = [];

for (let i = 0; i < commits.length; i++) {
  const { hash, ts } = commits[i];

  const raw = git(['show', `${hash}:${CONFIG.whatsNewFile}`]);
  if (!raw) continue;

  let wn;
  try { wn = JSON.parse(raw); } catch (_) { continue; }
  if (!wn || !wn.version) continue;

  const ver = wn.version;
  if (seenVersions.has(ver)) continue;   // ข้าม version ซ้ำ
  seenVersions.add(ver);

  // วันที่จาก commit timestamp (UTC)
  const d      = new Date(ts || Date.now());
  const relDate = wn.date || makeDateObj(d);

  // ดึง changelog จาก sections
  let changelog = [];
  (wn.sections || []).forEach(s =>
    (s.items || []).forEach(item => {
      const t = item.title && (item.title.en || item.title.th);
      if (t) changelog.push(t);
    })
  );

  releases.push({
    version:   ver,
    date:      relDate,
    title:     wn.title    || { en: 'System update',       th: 'อัปเดตระบบ' },
    subtitle:  wn.subtitle || { en: 'Minor improvements.', th: 'ปรับปรุงเล็กน้อย' },
    sections:  wn.sections || [],
    changelog
  });

  if (releases.length >= MAX_HISTORY) break;
}

// เรียงจากใหม่→เก่า
releases.sort((a, b) => {
  const pa = a.version.split('.').map(Number);
  const pb = b.version.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
});

const history = { releases };
fs.mkdirSync(path.dirname(historyPath), { recursive: true });
fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + '\n');
console.log(`✅  release-history.json: ${releases.length}/${MAX_HISTORY} [${releases.map(r => r.version).join(', ')}]`);

// ── STEP 2: เขียน whats-new.json (เพิ่ม date UTC) ────────────────────────────

const contentToSave = Object.assign({}, whatsNew, {
  version: newVersion,
  date:    dateObj       // ✅ UTC date en/th ครบถ้วน
});
fs.writeFileSync(whatsNewPath, JSON.stringify(contentToSave, null, 2) + '\n');
console.log(`✅  whats-new.json → v${newVersion}`);

// ── STEP 3: เขียน version.json ───────────────────────────────────────────────

let changelog = [];
(whatsNew.sections || []).forEach(s =>
  (s.items || []).forEach(item => {
    const t = item.title && (item.title.en || item.title.th);
    if (t) changelog.push(t);
  })
);

const newData = {
  version:   newVersion,
  build:     buildId,
  buildDate: dateObj,    // ✅ UTC date en/th ครบถ้วน
  timestamp: NOW.getTime(),
  notify:    !isSilent,
  changelog
};
fs.mkdirSync(path.dirname(versionPath), { recursive: true });
fs.writeFileSync(versionPath, JSON.stringify(newData, null, 2) + '\n');
console.log(`✅  version.json → ${buildId} (${dateObj.en})`);

// ── STEP 4: Scan & rewrite HTML ───────────────────────────────────────────────

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

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(56)}`);
console.log(`  Version:  ${newVersion}`);
console.log(`  Build:    ${buildId}`);
console.log(`  Date:     ${dateObj.en}`);
console.log(`  History:  ${releases.length}/${MAX_HISTORY} versions`);
console.log(`  HTML:     ${updated}/${scanned} updated`);
console.log(`${'─'.repeat(56)}\n🚀  Ready!\n`);