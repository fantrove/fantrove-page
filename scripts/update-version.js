#!/usr/bin/env node
// scripts/update-version.js — Fantrove Verse Release Tool
'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MAX_HISTORY = 7;

const CONFIG = {
  versionFile:  'assets/json/version.json',
  whatsNewFile: 'assets/json/whats-new.json',
  historyFile:  'assets/json/release-history.json',
  excludeDirs:  new Set(['node_modules', '.git', 'scripts', '.cloudflare', 'dist', 'build']),
  htmlExts:     new Set(['.html', '.htm']),
  assetPattern: /((?:src|href)=["'][^"':]*?\.(?:js|css|json))\?v=[^"'\s&]*/g
};

// ── Date/Time helpers (UTC+0 เสมอ) ───────────────────────────────────────────

const EN_MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];
const TH_MONTHS = [
  'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'
];

function pad2(n) { return String(n).padStart(2, '0'); }

function formatDateEN(d) {
  return EN_MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear()
    + ' at ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' UTC';
}

function formatDateTH(d) {
  const buddhistYear = d.getUTCFullYear() + 543;
  return d.getUTCDate() + ' ' + TH_MONTHS[d.getUTCMonth()] + ' ' + buddhistYear
    + ' เวลา ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' UTC';
}

function makeDateObj(d) {
  return { en: formatDateEN(d), th: formatDateTH(d) };
}

// ── Semver helpers ────────────────────────────────────────────────────────────

function parseSemver(v) {
  // รองรับทั้ง X.Y.Z และ X.Y.Z.P
  var m = String(v || '').match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], sub: m[4] !== undefined ? +m[4] : null };
}

function incrementPatch(v) {
  // auto-increment: X.Y.Z → X.Y.Z.1 | X.Y.Z.P → X.Y.Z.(P+1)
  var s = parseSemver(v);
  if (!s) return v;
  var sub = (s.sub !== null) ? s.sub : 0;
  return s.major + '.' + s.minor + '.' + s.patch + '.' + (sub + 1);
}

// ── Smart changelog จาก git diff ─────────────────────────────────────────────

const FILE_TYPE_LABELS = {
  '.js':   { en: 'JavaScript logic updated',      th: 'ปรับปรุงโค้ด JavaScript' },
  '.css':  { en: 'UI styling updated',             th: 'ปรับปรุงหน้าตาและ UI' },
  '.html': { en: 'Page content updated',           th: 'ปรับปรุงเนื้อหาหน้าเว็บ' },
  '.json': { en: 'Data / configuration updated',  th: 'ปรับปรุงข้อมูล / การตั้งค่า' },
  '.png':  { en: 'Images updated',                 th: 'อัปเดตรูปภาพ' },
  '.jpg':  { en: 'Images updated',                 th: 'อัปเดตรูปภาพ' },
  '.svg':  { en: 'Icons / graphics updated',       th: 'อัปเดตไอคอนและกราฟิก' }
};

function getGitChangedFiles() {
  try {
    const out = execSync('git diff --name-only HEAD~1 HEAD 2>/dev/null', { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
    return out.trim().split('\n').filter(Boolean);
  } catch(_) {
    try {
      const out = execSync('git diff --name-only --cached 2>/dev/null', { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
      return out.trim().split('\n').filter(Boolean);
    } catch(_2) { return []; }
  }
}

function buildSmartChangelog(changedFiles, newVersion, currentVersion) {
  const sections = [];

  if (!changedFiles.length) {
    sections.push({ type: 'improved', items: [{
      title: { en: 'System improvements and stability fixes', th: 'ปรับปรุงระบบและความเสถียร' },
      desc:  { en: 'Various internal improvements for better performance.', th: 'ปรับปรุงภายในเพื่อประสิทธิภาพที่ดีขึ้น' }
    }]});
    return sections;
  }

  const grouped = {};
  changedFiles.forEach(function(f) {
    if (f.includes('node_modules') || f.includes('.git')) return;
    const ext = path.extname(f).toLowerCase();
    const label = FILE_TYPE_LABELS[ext];
    if (label) {
      if (!grouped[ext]) grouped[ext] = { label, count: 0, files: [] };
      grouped[ext].count++;
      grouped[ext].files.push(path.basename(f));
    }
  });

  const oldS = parseSemver(currentVersion);
  const newS = parseSemver(newVersion);
  const isMinorBump = newS && oldS && (newS.minor > oldS.minor || newS.major > oldS.major);
  const isPatchBump = newS && oldS && (newS.patch > oldS.patch);

  const improvedItems = [], fixedItems = [], newItems = [];

  Object.entries(grouped).forEach(function([ext, info]) {
    const item = {
      title: { en: info.label.en, th: info.label.th },
      desc:  { en: info.count + ' file' + (info.count > 1 ? 's' : '') + ' updated', th: 'อัปเดต ' + info.count + ' ไฟล์' }
    };
    if (ext === '.js' && isMinorBump) newItems.push(item);
    else if (ext === '.css') improvedItems.push(item);
    else improvedItems.push(item);
  });

  if (isPatchBump && !isMinorBump) {
    fixedItems.push({
      title: { en: 'Bug fixes and minor corrections', th: 'แก้ไขข้อผิดพลาดเล็กน้อย' },
      desc:  { en: 'Addressed issues from the previous version.', th: 'แก้ไขปัญหาจากเวอร์ชันก่อนหน้า' }
    });
  }

  if (newItems.length)      sections.push({ type: 'new',      items: newItems });
  if (improvedItems.length) sections.push({ type: 'improved', items: improvedItems });
  if (fixedItems.length)    sections.push({ type: 'fixed',    items: fixedItems });

  if (!sections.length) {
    sections.push({ type: 'improved', items: [{
      title: { en: 'System improvements', th: 'ปรับปรุงระบบ' },
      desc:  { en: 'Internal enhancements.', th: 'ปรับปรุงภายใน' }
    }]});
  }

  return sections;
}

function buildSmartTitle(newVersion, currentVersion, isMinorBump) {
  if (isMinorBump) {
    return {
      title:    { en: 'New features', th: 'ฟีเจอร์ใหม่' },
      subtitle: { en: 'Version ' + newVersion + ' brings new features and improvements.', th: 'เวอร์ชัน ' + newVersion + ' มาพร้อมฟีเจอร์ใหม่และการปรับปรุง' }
    };
  }
  return {
    title:    { en: 'System update', th: 'อัปเดตระบบ' },
    subtitle: { en: 'Version ' + newVersion + ' includes stability improvements and fixes.', th: 'เวอร์ชัน ' + newVersion + ' มีการปรับปรุงความเสถียรและแก้ไขปัญหา' }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

var envVersion = process.env.APP_VERSION || process.argv[2];
const isSilent = process.env.DEPLOY_SILENT === '1' || process.argv.includes('--silent');
const ROOT     = path.resolve(__dirname, '..');
const NOW      = new Date();

if (!envVersion) {
  console.error('\n  ❌  ไม่พบ APP_VERSION\n'); process.exit(1);
}
if (!parseSemver(envVersion)) {
  console.error(`\n  ❌  APP_VERSION "${envVersion}" ไม่ใช่ semver\n`); process.exit(1);
}

// ── STEP 1: อ่านทุกไฟล์ก่อน (ก่อนแก้ไขอะไรทั้งนั้น) ─────────────────────────

const versionPath  = path.join(ROOT, CONFIG.versionFile);
const whatsNewPath = path.join(ROOT, CONFIG.whatsNewFile);
const historyPath  = path.join(ROOT, CONFIG.historyFile);

// อ่าน version.json → ข้อมูล version ที่ deploy ครั้งล่าสุด
// ✅ สำคัญ: version.json เก็บ content (title/subtitle/sections) ของ version ล่าสุดไว้
//    เพื่อให้ deploy ครั้งนี้เอาไป archive ได้ถูกต้อง
let currentData = {};
try { currentData = JSON.parse(fs.readFileSync(versionPath, 'utf8')); } catch (_) {}
const currentVersion = currentData.version || '0.0.0';

// อ่าน whats-new.json → เนื้อหาของ version ใหม่ที่จะ deploy
let whatsNew = null;
let whatsNewHasContent = false;
try {
  whatsNew = JSON.parse(fs.readFileSync(whatsNewPath, 'utf8'));
  const hasSections = Array.isArray(whatsNew.sections) && whatsNew.sections.length > 0;
  const hasItems    = hasSections && whatsNew.sections.some(s => s.items && s.items.length > 0);
  whatsNewHasContent = hasSections && hasItems;
} catch (e) {
  console.log(`⚠️   ไม่พบ whats-new.json หรืออ่านไม่ได้`);
}

// อ่าน release-history.json
let history = { releases: [] };
try {
  history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  if (!Array.isArray(history.releases)) history.releases = [];
} catch (_) {}

// ── ตัดสินใจ version ใหม่ ─────────────────────────────────────────────────────

let newVersion;
let autoIncremented = false;

const envParsed = parseSemver(envVersion);
const curParsed = parseSemver(currentVersion);

// auto-increment: ถ้า env ตรงกับ current (ทั้ง 4 ส่วน) หรือ env เป็นแค่ base (3 ส่วน)
// ที่ตรงกับ 3 ส่วนแรกของ current → นับ sub-patch ต่อ
const envIsBase    = (envParsed && envParsed.sub === null);
const baseMatches  = envParsed && curParsed &&
                     envParsed.major === curParsed.major &&
                     envParsed.minor === curParsed.minor &&
                     envParsed.patch === curParsed.patch;

if (envVersion === currentVersion || (envIsBase && baseMatches)) {
  newVersion      = incrementPatch(currentVersion);
  autoIncremented = true;
  console.log(`\n⚡  Auto sub-patch: ${currentVersion} → ${newVersion}`);
} else {
  newVersion = envVersion;
  const oldS = parseSemver(currentVersion);
  const newS = parseSemver(newVersion);
  const bumpType = !oldS || !newS         ? 'custom'
    : newS.major > oldS.major             ? 'major'
    : newS.minor > oldS.minor             ? 'minor'
    : newS.patch > oldS.patch             ? 'patch'
    : (newS.sub||0) > (oldS.sub||0)       ? 'sub-patch'
    : 'custom';
  console.log(`\n📦  Version: ${currentVersion} → ${newVersion} (${bumpType})`);
}

const dateStr = NOW.toISOString().slice(0, 10).replace(/-/g, '');
const timeStr = pad2(NOW.getUTCHours()) + pad2(NOW.getUTCMinutes());
const buildId = `${newVersion}-${dateStr}${timeStr}`;
const dateObj = makeDateObj(NOW);

console.log(`    Build ID:  ${buildId}`);
console.log(`    Date:      ${dateObj.en}`);
console.log(`    Silent:    ${isSilent}\n`);

// ── STEP 2: ARCHIVE ก่อน (ก่อนเขียนไฟล์ใดๆ) ──────────────────────────────────
//
//  ✅ ดึงเนื้อหาจาก currentData.content (version.json ของ deploy ก่อนหน้า)
//     ไม่ใช่จาก whatsNew ซึ่งเป็นเนื้อหาของ version ใหม่
//
//  นี่คือ root cause ของ bug เดิม:
//    เดิม → archive ใช้ whatsNew.title/subtitle/sections
//           ซึ่งเป็นเนื้อหาของ version ใหม่ ไม่ใช่ version เก่า
//    ใหม่ → archive ใช้ currentData.content
//           ซึ่งถูกบันทึกไว้ตอน deploy ก่อนหน้า (เนื้อหาจริงของ version เก่า)

if (currentVersion !== newVersion && currentVersion !== '0.0.0') {
  const alreadyIn = history.releases.some(r => r.version === currentVersion);

  if (!alreadyIn) {
    // ✅ ดึงเนื้อหาจาก content field ที่บันทึกไว้ใน version.json
    const savedContent = currentData.content || {};

    const archiveEntry = {
      version:  currentVersion,
      date:     currentData.buildDate || makeDateObj(NOW),
      title:    savedContent.title    || { en: 'System update',       th: 'อัปเดตระบบ' },
      subtitle: savedContent.subtitle || { en: 'Minor improvements.', th: 'ปรับปรุงเล็กน้อย' },
      sections: savedContent.sections || []
    };

    history.releases.unshift(archiveEntry);
    console.log(`📋  Archive v${currentVersion} → history`);

    const srcLabel = savedContent.sections && savedContent.sections.length
      ? 'version.json (content field)' : 'fallback (generic)';
    console.log(`    [source: ${srcLabel}]`);
  } else {
    console.log(`ℹ️   v${currentVersion} อยู่ใน history แล้ว ข้าม`);
  }

  if (history.releases.length > MAX_HISTORY) {
    const removed = history.releases.splice(MAX_HISTORY);
    console.log(`🗑️   ลบประวัติเก่า: ${removed.map(r => r.version).join(', ')}`);
  }

  // เขียน history ทันที ก่อนทำอย่างอื่น
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + '\n');
  console.log(`✅  release-history.json: ${history.releases.length}/${MAX_HISTORY}`);
}

// ── STEP 3: ตัดสินใจเนื้อหาของ version ใหม่ ─────────────────────────────────

const changedFiles = getGitChangedFiles();
console.log(changedFiles.length
  ? `🔍  Git diff: พบ ${changedFiles.length} ไฟล์`
  : `🔍  Git diff: ไม่พบข้อมูล (ใช้ข้อความทั่วไป)`
);

const oldS = parseSemver(currentVersion);
const newS = parseSemver(newVersion);
const isMinorBump = newS && oldS && (newS.minor > oldS.minor || newS.major > oldS.major);

let contentToUse;
let usingUserContent = false;

const whatsNewMatchesVersion = whatsNew && (whatsNew.version === newVersion);

if (whatsNewMatchesVersion && whatsNewHasContent) {
  // ✅ ผู้ใช้เขียนเนื้อหาใน whats-new.json ตรงกับ version ใหม่
  contentToUse     = Object.assign({}, whatsNew, { version: newVersion, date: dateObj });
  usingUserContent = true;
  console.log(`✅  ใช้เนื้อหาจาก whats-new.json (ผู้ใช้กำหนดเอง)`);
} else {
  // auto-generate จาก git diff
  const smartTitle    = buildSmartTitle(newVersion, currentVersion, isMinorBump);
  const smartSections = buildSmartChangelog(changedFiles, newVersion, currentVersion);
  contentToUse = {
    version:  newVersion,
    date:     dateObj,
    title:    smartTitle.title,
    subtitle: smartTitle.subtitle,
    sections: smartSections
  };
  console.log(autoIncremented
    ? `ℹ️   Auto-increment → สร้างเนื้อหาอัตโนมัติ`
    : `⚠️   whats-new.json ไม่มีเนื้อหาสำหรับ v${newVersion} → สร้างอัตโนมัติ`
  );
}
console.log(`    📅 วันเวลา UTC: ${dateObj.en}`);

// ── STEP 4: เขียน whats-new.json ─────────────────────────────────────────────

fs.writeFileSync(whatsNewPath, JSON.stringify(contentToUse, null, 2) + '\n');
console.log(`✅  whats-new.json: บันทึกแล้ว`);

// ── STEP 5: เขียน version.json ───────────────────────────────────────────────
//
//  ✅ บันทึก content (title/subtitle/sections) ไว้ใน version.json ด้วย
//     เพื่อให้ deploy ถัดไปสามารถดึงไป archive ได้ถูกต้อง
//     (นี่คือกลไกหลักที่ทำให้ประวัติทำงานได้โดยไม่ต้อง commit กลับ git)

let changelog = [];
(contentToUse.sections || []).forEach(function(s) {
  (s.items || []).forEach(function(item) {
    const title = item.title && (item.title.en || item.title.th);
    if (title) changelog.push(title);
  });
});

const newData = {
  version:   newVersion,
  build:     buildId,
  buildDate: dateObj,
  timestamp: NOW.getTime(),
  notify:    !isSilent,
  changelog,
  // ✅ เก็บเนื้อหาไว้สำหรับ archive ในรอบถัดไป
  content: {
    title:    contentToUse.title    || null,
    subtitle: contentToUse.subtitle || null,
    sections: contentToUse.sections || []
  }
};

fs.mkdirSync(path.dirname(versionPath), { recursive: true });
fs.writeFileSync(versionPath, JSON.stringify(newData, null, 2) + '\n');
console.log(`✅  version.json → ${buildId} (${dateObj.en})`);

// ── STEP 6: Scan & rewrite HTML ───────────────────────────────────────────────

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
console.log(`  Version:    ${currentVersion} → ${newVersion}${autoIncremented ? ' (auto +sub)' : ''}`);
console.log(`  Build:      ${buildId}`);
console.log(`  Date/Time:  ${dateObj.en}`);
console.log(`  Content:    ${usingUserContent ? 'ผู้ใช้กำหนดเอง (whats-new.json)' : 'อัตโนมัติ (smart auto)'}`);
console.log(`  History:    ${history.releases.length}/${MAX_HISTORY}`);
console.log(`  Git files:  ${changedFiles.length} ไฟล์`);
console.log(`  HTML:       ${updated}/${scanned} updated`);
console.log(`${'─'.repeat(56)}\n🚀  Ready!\n`);