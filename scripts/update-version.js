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

// ── Git helper ────────────────────────────────────────────────────────────────

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'], cwd: ROOT });
  return r.status === 0 ? r.stdout.trim() : null;
}

// ── Step 1: อ่าน whats-new.json (current release) ────────────────────────────

const whatsNewPath = path.join(ROOT, CONFIG.whatsNewFile);
let current = null;
try {
  current = JSON.parse(fs.readFileSync(whatsNewPath, 'utf8'));
  if (current.version !== newVersion) {
    console.warn(`⚠️   whats-new.json version (${current.version}) ไม่ตรงกับ APP_VERSION (${newVersion})`);
  } else {
    console.log(`✅  whats-new.json: v${current.version} ready`);
  }
} catch (e) {
  console.log(`⚠️   ไม่พบ whats-new.json: ${e.message}`);
}

// ── Step 2: สร้าง release-history จาก git log ────────────────────────────────
//
//  ปัญหาเดิม: version.json ไม่ถูก commit กลับ git → build ถัดไปได้ค่าเดิมเสมอ
//             → history ไม่มีวันสะสมได้
//
//  แก้: อ่าน whats-new.json จาก git history ทุก commit
//       → ได้เนื้อหาจริงของทุก version ที่เคย deploy
//       → สร้าง release-history.json ใหม่ทุก build จากข้อมูลจริง
//       → ไม่ต้อง commit ไฟล์ไหนกลับเลย
//
//  ผู้ใช้ทำแค่: แก้ whats-new.json → commit → deploy

console.log('📚  Building history from git log...');

// ดึง commit hash ทั้งหมดที่เคยแก้ whats-new.json (เก่า→ใหม่)
const commitLog = git(['log', '--format=%H', '--', CONFIG.whatsNewFile]);
const commits   = commitLog ? commitLog.split('\n').filter(Boolean).reverse() : [];

console.log(`    พบ ${commits.length} commit(s) ของ whats-new.json`);

const seenVersions = new Set([newVersion]); // ข้าม version ปัจจุบัน
const releases     = [];

for (let i = 0; i < commits.length; i++) {
  const hash = commits[i];

  // อ่าน whats-new.json ณ commit นั้น
  const raw = git(['show', `${hash}:${CONFIG.whatsNewFile}`]);
  if (!raw) continue;

  let wn;
  try { wn = JSON.parse(raw); } catch (_) { continue; }
  if (!wn || !wn.version) continue;

  const ver = wn.version;
  if (seenVersions.has(ver)) continue;
  seenVersions.add(ver);

  // วันที่จาก commit timestamp
  const tsRaw = git(['show', '-s', '--format=%ct', hash]);
  const ts    = tsRaw ? parseInt(tsRaw, 10) * 1000 : Date.now();
  const d     = new Date(ts);

  const dateEn = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long',  day: 'numeric', timeZone: 'UTC' });
  const dateTh = d.toLocaleDateString('th-TH',  { year: 'numeric', month: 'long',  day: 'numeric', timeZone: 'UTC' });

  // ดึง changelog จาก sections ถ้ามี
  let changelog = [];
  (wn.sections || []).forEach(s =>
    (s.items || []).forEach(item => {
      const t = item.title && (item.title.en || item.title.th);
      if (t) changelog.push(t);
    })
  );

  releases.push({
    version:   ver,
    date:      wn.date || { en: dateEn, th: dateTh },
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
    const diff = (pb[i] || 0) - (pa[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
});

const history = { releases };
const historyPath = path.join(ROOT, CONFIG.historyFile);
fs.mkdirSync(path.dirname(historyPath), { recursive: true });
fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + '\n');
console.log(`✅  release-history.json: ${releases.length}/${MAX_HISTORY} [${releases.map(r => r.version).join(', ')}]`);

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

const versionPath = path.join(ROOT, CONFIG.versionFile);
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
console.log(`\n✅  ${updated}/${scanned} HTML updated | 🚀  ${buildId}\n`);