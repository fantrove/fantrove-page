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
  var m = String(v || '').match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], sub: m[4] !== undefined ? +m[4] : null };
}

function versionGt(a, b) {
  // returns true ถ้า a > b
  const pa = parseSemver(a), pb = parseSemver(b);
  if (!pa || !pb) return false;
  if (pa.major !== pb.major) return pa.major > pb.major;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch;
  return (pa.sub || 0) > (pb.sub || 0);
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
      if (!grouped[ext]) grouped[ext] = { label, count: 0 };
      grouped[ext].count++;
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

function buildSmartTitle(newVersion, currentVersion) {
  const oldS = parseSemver(currentVersion);
  const newS = parseSemver(newVersion);
  const isMinorBump = newS && oldS && (newS.minor > oldS.minor || newS.major > oldS.major);
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

// ── INIT ──────────────────────────────────────────────────────────────────────

const isSilent = process.env.DEPLOY_SILENT === '1' || process.argv.includes('--silent');
const ROOT     = path.resolve(__dirname, '..');
const NOW      = new Date();

// ── อ่านไฟล์ทั้งสาม ───────────────────────────────────────────────────────────

const versionPath  = path.join(ROOT, CONFIG.versionFile);
const whatsNewPath = path.join(ROOT, CONFIG.whatsNewFile);
const historyPath  = path.join(ROOT, CONFIG.historyFile);

let currentData = {};
try { currentData = JSON.parse(fs.readFileSync(versionPath, 'utf8')); } catch (_) {}

let whatsNew = null;
try { whatsNew = JSON.parse(fs.readFileSync(whatsNewPath, 'utf8')); } catch (e) {
  console.error('\n  ❌  ไม่พบ whats-new.json หรืออ่านไม่ได้\n');
  process.exit(1);
}

let history = { releases: [] };
try {
  history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  if (!Array.isArray(history.releases)) history.releases = [];
} catch (_) {}

// ── ✅ อ่าน version จาก whats-new.json เป็น source of truth ─────────────────
//
//   ผู้ใช้แก้แค่ whats-new.json ไฟล์เดียว ระบบจะรู้เองว่า version ใหม่คืออะไร
//   ไม่ต้องแก้ version.json หรือตั้ง APP_VERSION เลย

const currentVersion = currentData.version || '0.0.0';
const newVersion     = whatsNew.version;

if (!newVersion || !parseSemver(newVersion)) {
  console.error(`\n  ❌  whats-new.json ไม่มี "version" หรือรูปแบบไม่ถูกต้อง\n`);
  process.exit(1);
}

// ── ตรวจว่า version ใหม่ > เดิม ──────────────────────────────────────────────

if (newVersion === currentVersion) {
  console.log(`\n⚠️   whats-new.json version (${newVersion}) ตรงกับ version ปัจจุบันอยู่แล้ว`);
  console.log(`    ไม่มีการเปลี่ยนแปลง version — deploy ต่อโดยไม่ archive\n`);
} else if (!versionGt(newVersion, currentVersion)) {
  console.error(`\n  ❌  whats-new.json version (${newVersion}) น้อยกว่าหรือเท่ากับปัจจุบัน (${currentVersion})`);
  console.error(`      กรุณาเพิ่ม version ใน whats-new.json ให้มากกว่าเดิม\n`);
  process.exit(1);
}

const dateStr = NOW.toISOString().slice(0, 10).replace(/-/g, '');
const timeStr = pad2(NOW.getUTCHours()) + pad2(NOW.getUTCMinutes());
const buildId = `${newVersion}-${dateStr}${timeStr}`;
const dateObj = makeDateObj(NOW);

console.log(`\n📦  Version: ${currentVersion} → ${newVersion}`);
console.log(`    Build ID:  ${buildId}`);
console.log(`    Date:      ${dateObj.en}`);
console.log(`    Silent:    ${isSilent}\n`);

// ── STEP 1: ARCHIVE current → history ────────────────────────────────────────

function hasRealContent(obj) {
  return obj && Array.isArray(obj.sections) && obj.sections.length > 0 &&
         obj.sections.some(s => s.items && s.items.length > 0);
}

if (newVersion !== currentVersion && currentVersion !== '0.0.0') {
  const alreadyIn = history.releases.some(r => r.version === currentVersion);

  if (!alreadyIn) {
    // source priority: version.json content field → generic fallback
    // (whats-new.json ตอนนี้มีเนื้อหาของ newVersion แล้ว ไม่ใช่ currentVersion)
    let archiveContent = null;
    let archiveSource  = 'fallback (generic)';

    if (hasRealContent(currentData.content)) {
      archiveContent = currentData.content;
      archiveSource  = 'version.json (content field)';
    }

    const archiveEntry = {
      version:  currentVersion,
      date:     currentData.buildDate || makeDateObj(new Date()),
      title:    (archiveContent && archiveContent.title)    || { en: 'System update',       th: 'อัปเดตระบบ' },
      subtitle: (archiveContent && archiveContent.subtitle) || { en: 'Minor improvements.', th: 'ปรับปรุงเล็กน้อย' },
      sections: (archiveContent && archiveContent.sections) || []
    };

    history.releases.unshift(archiveEntry);
    console.log(`📋  Archive v${currentVersion} → history  [source: ${archiveSource}]`);
  } else {
    console.log(`ℹ️   v${currentVersion} อยู่ใน history แล้ว ข้าม`);
  }

  if (history.releases.length > MAX_HISTORY) {
    const removed = history.releases.splice(MAX_HISTORY);
    console.log(`🗑️   ลบประวัติเกิน ${MAX_HISTORY}: ${removed.map(r => r.version).join(', ')}`);
  }

  // เขียน history ก่อนทุกอย่าง
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + '\n');
  console.log(`✅  release-history.json: ${history.releases.length}/${MAX_HISTORY} versions`);
}

// ── STEP 2: git diff ──────────────────────────────────────────────────────────

const changedFiles = getGitChangedFiles();
console.log(changedFiles.length
  ? `🔍  Git diff: พบ ${changedFiles.length} ไฟล์ที่เปลี่ยนแปลง`
  : `🔍  Git diff: ไม่พบข้อมูล (ใช้ข้อความทั่วไป)`
);

// ── STEP 3: เนื้อหาสำหรับ newVersion ─────────────────────────────────────────

let contentToUse;
let usingUserContent = false;

if (hasRealContent(whatsNew)) {
  // ✅ ผู้ใช้เขียน sections ไว้ใน whats-new.json → ใช้เลย เติมแค่ date
  contentToUse = Object.assign({}, whatsNew, { version: newVersion, date: dateObj });
  usingUserContent = true;
  console.log(`✅  ใช้เนื้อหาจาก whats-new.json (ผู้ใช้กำหนดเอง)`);
  console.log(`    📅 วันเวลา UTC: ${dateObj.en}`);
} else {
  // ไม่มี sections → auto-generate จาก git diff
  const smartTitle    = buildSmartTitle(newVersion, currentVersion);
  const smartSections = buildSmartChangelog(changedFiles, newVersion, currentVersion);
  contentToUse = {
    version:  newVersion,
    date:     dateObj,
    title:    smartTitle.title,
    subtitle: smartTitle.subtitle,
    sections: smartSections
  };
  console.log(`⚠️   whats-new.json ไม่มี sections → สร้างเนื้อหาอัตโนมัติ`);
  console.log(`    📅 วันเวลา UTC: ${dateObj.en}`);
}

// เขียน whats-new.json (หลัง archive เสมอ)
fs.writeFileSync(whatsNewPath, JSON.stringify(contentToUse, null, 2) + '\n');
console.log(`✅  whats-new.json: บันทึกแล้ว`);

// ── STEP 4: อัปเดต version.json ──────────────────────────────────────────────

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
  content: {
    title:    contentToUse.title    || null,
    subtitle: contentToUse.subtitle || null,
    sections: contentToUse.sections || []
  }
};
fs.mkdirSync(path.dirname(versionPath), { recursive: true });
fs.writeFileSync(versionPath, JSON.stringify(newData, null, 2) + '\n');
console.log(`✅  version.json → ${buildId} (${dateObj.en})`);

// ── STEP 5: Scan & rewrite HTML ───────────────────────────────────────────────

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

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(56)}`);
console.log(`  Version:    ${currentVersion} → ${newVersion}`);
console.log(`  Build:      ${buildId}`);
console.log(`  Date/Time:  ${dateObj.en}`);
console.log(`  Source:     whats-new.json → version.json (อัตโนมัติ)`);
console.log(`  Content:    ${usingUserContent ? 'ผู้ใช้กำหนดเอง' : 'อัตโนมัติ (smart auto)'}`);
console.log(`  Git files:  ${changedFiles.length} ไฟล์`);
console.log(`  HTML:       ${updated}/${scanned} updated`);
console.log(`${'─'.repeat(56)}\n🚀  Ready!\n`);