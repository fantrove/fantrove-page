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

// ✅ ใช้ getUTC* ทั้งหมด — ไม่ขึ้นกับ timezone ของ server/เครื่อง deploy
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

// รองรับทั้ง 3 ส่วน (X.Y.Z) และ 4 ส่วน (X.Y.Z.P)
function parseSemver(v) {
  var m = String(v || '').match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], sub: m[4] !== undefined ? +m[4] : null };
}

// ✅ auto-increment บวกแค่ส่วนที่ 4 (+0.0.0.1) เท่านั้น
// 1.0.5   → 1.0.5.1  |  1.0.5.3 → 1.0.5.4
// ถ้าต้องการเปลี่ยน X.Y.Z ให้ตั้ง APP_VERSION เอง
function incrementSubPatch(v) {
  var s = parseSemver(v);
  if (!s) return v;
  var sub = (s.sub !== null) ? s.sub : 0;
  return s.major + '.' + s.minor + '.' + s.patch + '.' + (sub + 1);
}

// ── Smart changelog จาก git diff ─────────────────────────────────────────────

const FILE_TYPE_LABELS = {
  '.js':   { en: 'JavaScript logic updated',        th: 'ปรับปรุงโค้ด JavaScript' },
  '.css':  { en: 'UI styling updated',               th: 'ปรับปรุงหน้าตาและ UI' },
  '.html': { en: 'Page content updated',             th: 'ปรับปรุงเนื้อหาหน้าเว็บ' },
  '.json': { en: 'Data / configuration updated',    th: 'ปรับปรุงข้อมูล / การตั้งค่า' },
  '.png':  { en: 'Images updated',                   th: 'อัปเดตรูปภาพ' },
  '.jpg':  { en: 'Images updated',                   th: 'อัปเดตรูปภาพ' },
  '.svg':  { en: 'Icons / graphics updated',         th: 'อัปเดตไอคอนและกราฟิก' }
};

function getGitChangedFiles() {
  try {
    // พยายาม diff กับ commit ก่อนหน้า
    const out = execSync('git diff --name-only HEAD~1 HEAD 2>/dev/null', { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
    return out.trim().split('\n').filter(Boolean);
  } catch(_) {
    try {
      // fallback: ดู staged files
      const out = execSync('git diff --name-only --cached 2>/dev/null', { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
      return out.trim().split('\n').filter(Boolean);
    } catch(_2) {
      return [];
    }
  }
}

function buildSmartChangelog(changedFiles, newVersion, currentVersion) {
  const sections = [];

  if (!changedFiles.length) {
    // ไม่สามารถดึง git diff ได้ → ใช้ข้อความทั่วไป
    sections.push({
      type: 'improved',
      items: [{
        title: { en: 'System improvements and stability fixes', th: 'ปรับปรุงระบบและความเสถียร' },
        desc:  { en: 'Various internal improvements for better performance.', th: 'ปรับปรุงภายในเพื่อประสิทธิภาพที่ดีขึ้น' }
      }]
    });
    return sections;
  }

  // จัดกลุ่มไฟล์ตามนามสกุล
  const grouped = {};
  const specificFiles = [];

  changedFiles.forEach(function(f) {
    // ข้ามไฟล์ที่ไม่เกี่ยวกับ user-facing
    if (f.includes('node_modules') || f.includes('.git')) return;

    const ext = path.extname(f).toLowerCase();
    const label = FILE_TYPE_LABELS[ext];
    if (label) {
      if (!grouped[ext]) grouped[ext] = { label, count: 0, files: [] };
      grouped[ext].count++;
      grouped[ext].files.push(path.basename(f));
    }

    // ดึงชื่อไฟล์ที่น่าสนใจ (ไม่ใช่ config/version files)
    const base = path.basename(f, path.extname(f));
    const skip = new Set(['version','whats-new','release-history','package-lock','package']);
    if (!skip.has(base) && ['.js','.css','.html'].includes(ext)) {
      specificFiles.push(base);
    }
  });

  // ── New / Improved / Fixed detection ──────────────────────────────────────
  // ถ้า minor หรือ major เปลี่ยน → "New features"
  const oldS = parseSemver(currentVersion);
  const newS = parseSemver(newVersion);
  const isMinorBump  = newS && oldS && (newS.minor > oldS.minor || newS.major > oldS.major);
  const isPatchBump  = newS && oldS && (newS.patch > oldS.patch);

  const improvedItems = [];
  const fixedItems    = [];
  const newItems      = [];

  Object.entries(grouped).forEach(function([ext, info]) {
    const item = {
      title: { en: info.label.en, th: info.label.th },
      desc:  {
        en: info.count + ' file' + (info.count > 1 ? 's' : '') + ' updated',
        th: 'อัปเดต ' + info.count + ' ไฟล์'
      }
    };
    if (ext === '.js' && isMinorBump) newItems.push(item);
    else if (ext === '.css') improvedItems.push(item);
    else improvedItems.push(item);
  });

  // ถ้า patch bump ให้ assume เป็น bug fix ด้วย
  if (isPatchBump && !isMinorBump) {
    fixedItems.push({
      title: { en: 'Bug fixes and minor corrections', th: 'แก้ไขข้อผิดพลาดเล็กน้อย' },
      desc:  { en: 'Addressed issues from the previous version.', th: 'แก้ไขปัญหาจากเวอร์ชันก่อนหน้า' }
    });
  }

  if (newItems.length)      sections.push({ type: 'new',      items: newItems });
  if (improvedItems.length) sections.push({ type: 'improved', items: improvedItems });
  if (fixedItems.length)    sections.push({ type: 'fixed',    items: fixedItems });

  // ถ้าไม่มีอะไรเลย
  if (!sections.length) {
    sections.push({
      type: 'improved',
      items: [{ title: { en: 'System improvements', th: 'ปรับปรุงระบบ' }, desc: { en: 'Internal enhancements.', th: 'ปรับปรุงภายใน' } }]
    });
  }

  return sections;
}

function buildSmartTitle(newVersion, currentVersion, isMinorBump) {
  if (isMinorBump) {
    return {
      title:    { en: 'New features', th: 'ฟีเจอร์ใหม่' },
      subtitle: {
        en: 'Version ' + newVersion + ' brings new features and improvements.',
        th: 'เวอร์ชัน ' + newVersion + ' มาพร้อมฟีเจอร์ใหม่และการปรับปรุง'
      }
    };
  }
  return {
    title:    { en: 'System update', th: 'อัปเดตระบบ' },
    subtitle: {
      en: 'Version ' + newVersion + ' includes stability improvements and fixes.',
      th: 'เวอร์ชัน ' + newVersion + ' มีการปรับปรุงความเสถียรและแก้ไขปัญหา'
    }
  };
}

// ── อ่าน APP_VERSION ──────────────────────────────────────────────────────────

var envVersion  = process.env.APP_VERSION || process.argv[2];
const isSilent  = process.env.DEPLOY_SILENT === '1' || process.argv.includes('--silent');
const ROOT      = path.resolve(__dirname, '..');
const NOW       = new Date();

// อ่าน version.json ปัจจุบัน
const versionPath = path.join(ROOT, CONFIG.versionFile);
let currentData = {};
try { currentData = JSON.parse(fs.readFileSync(versionPath, 'utf8')); } catch (_) {}
const currentVersion = currentData.version || '0.0.0';

// ── ตัดสินใจ version ใหม่ ─────────────────────────────────────────────────────

let newVersion;
let autoIncremented = false;

if (!envVersion) {
  console.error('\n  ❌  ไม่พบ APP_VERSION\n     ใช้: APP_VERSION=1.0.5 node scripts/update-version.js\n');
  process.exit(1);
}

if (!parseSemver(envVersion)) {
  console.error(`\n  ❌  APP_VERSION "${envVersion}" ไม่ใช่รูปแบบที่รองรับ (X.Y.Z หรือ X.Y.Z.P)\n`);
  process.exit(1);
}

// ✅ เปรียบเทียบ full version string (รวมส่วนที่ 4)
// - ตรงกันทุกส่วน       → auto-increment ส่วนที่ 4
// - ต่างกันไม่ว่าส่วนไหน → ใช้ค่าที่ตั้งมาเลย (ผู้ใช้ควบคุมเอง)

if (envVersion === currentVersion) {
  // version ตรงกันทุกส่วน → auto-increment +0.0.0.1
  newVersion = incrementSubPatch(currentVersion);
  autoIncremented = true;
  console.log(`\n⚡  APP_VERSION ตรงกับปัจจุบัน (${envVersion})`);
  console.log(`    Auto sub-patch (+0.0.0.1): ${currentVersion} → ${newVersion}`);
  console.log(`    💡 ถ้าต้องการระบุ version เองให้เปลี่ยน APP_VERSION เช่น APP_VERSION=1.0.5.3`);
} else {
  // version ต่างกัน → ใช้ที่ผู้ใช้ตั้งมาเลย ไม่ auto
  newVersion = envVersion;
  const oldS = parseSemver(currentVersion);
  const newS = parseSemver(newVersion);
  const bumpType = (newS.major > oldS.major)   ? 'major'
                 : (newS.minor > oldS.minor)   ? 'minor'
                 : (newS.patch > oldS.patch)   ? 'patch'
                 : (newS.sub   > (oldS.sub||0))? 'sub-patch'
                 : 'custom';
  console.log(`\n📦  Version: ${currentVersion} → ${newVersion} (${bumpType})`);
}

// ✅ buildId ใช้ UTC ทั้งหมด ไม่ขึ้นกับ timezone เครื่อง
const dateStr  = NOW.toISOString().slice(0, 10).replace(/-/g, '');
const timeStr  = pad2(NOW.getUTCHours()) + pad2(NOW.getUTCMinutes());
const buildId  = `${newVersion}-${dateStr}${timeStr}`;
const dateObj  = makeDateObj(NOW);

console.log(`    Build ID:  ${buildId}`);
console.log(`    Date:      ${dateObj.en}`);
console.log(`    Silent:    ${isSilent}\n`);

// ── อ่าน whats-new.json ───────────────────────────────────────────────────────

const whatsNewPath = path.join(ROOT, CONFIG.whatsNewFile);
let whatsNew = null;

try {
  whatsNew = JSON.parse(fs.readFileSync(whatsNewPath, 'utf8'));
} catch (e) {
  console.log(`⚠️   ไม่พบ whats-new.json หรืออ่านไม่ได้`);
}

// ── อ่าน release-history.json ────────────────────────────────────────────────

const historyPath = path.join(ROOT, CONFIG.historyFile);
let history = { releases: [] };
try {
  history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  if (!Array.isArray(history.releases)) history.releases = [];
} catch (_) {}

// ── STEP 1: ARCHIVE current version → history ─────────────────────────────────
//
// ❗ ต้องเกิดก่อน whats-new.json ถูก overwrite เสมอ
//
// ลำดับความน่าเชื่อถือของ content source:
//   1. whats-new.json (ถ้า version ตรงกับ currentVersion) ← อ่านได้ก่อน overwrite
//   2. version.json content field (จาก deploy ก่อนหน้า)   ← fallback ที่เพิ่มมาใหม่
//   3. Generic fallback                                      ← กรณีไม่มีทั้งสองอย่าง

function hasRealContent(obj) {
  return obj && Array.isArray(obj.sections) && obj.sections.length > 0 &&
         obj.sections.some(s => s.items && s.items.length > 0);
}

if (currentVersion !== newVersion && currentVersion !== '0.0.0') {
  const alreadyIn = history.releases.some(r => r.version === currentVersion);

  if (!alreadyIn) {
    // หา content source ที่ดีที่สุดสำหรับ currentVersion
    let archiveContent = null;
    let archiveSource  = 'fallback (generic)';

    // Priority 1: whats-new.json version === currentVersion
    // (ยังไม่ถูก overwrite เพราะเราอ่านก่อนในขั้นนี้)
    if (whatsNew && whatsNew.version === currentVersion && hasRealContent(whatsNew)) {
      archiveContent = whatsNew;
      archiveSource  = 'whats-new.json (ตรงกับ currentVersion)';
    }
    // Priority 2: content field ใน version.json (เก็บไว้ตอน deploy ครั้งก่อน)
    else if (hasRealContent(currentData.content)) {
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

  // เก็บแค่ MAX_HISTORY อันล่าสุด
  if (history.releases.length > MAX_HISTORY) {
    const removed = history.releases.splice(MAX_HISTORY);
    console.log(`🗑️   ลบประวัติเกิน ${MAX_HISTORY}: ${removed.map(r => r.version).join(', ')}`);
  }

  // ✅ เขียน history ทันทีก่อนทำอย่างอื่น
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + '\n');
  console.log(`✅  release-history.json: ${history.releases.length}/${MAX_HISTORY} versions`);
}

// ── STEP 2: ดึง git diff เพื่อ smart changelog ───────────────────────────────

const changedFiles = getGitChangedFiles();
if (changedFiles.length) {
  console.log(`🔍  Git diff: พบ ${changedFiles.length} ไฟล์ที่เปลี่ยนแปลง`);
} else {
  console.log(`🔍  Git diff: ไม่พบข้อมูล (ใช้ข้อความทั่วไป)`);
}

// ── STEP 3: ตัดสินใจเนื้อหาสำหรับ newVersion ─────────────────────────────────

const oldS = parseSemver(currentVersion);
const newS = parseSemver(newVersion);
const isMinorBump = newS && oldS && (newS.minor > oldS.minor || newS.major > oldS.major);

// ตรวจว่า whats-new.json มีเนื้อหาที่เขียนเองสำหรับ newVersion
const wnMatchesNew   = whatsNew && (whatsNew.version === newVersion);
const wnHasNewContent = wnMatchesNew && hasRealContent(whatsNew);

let contentToUse;
let usingUserContent = false;

if (wnHasNewContent) {
  // ✅ ผู้ใช้เขียน sections เองสำหรับ newVersion → ใช้ทั้งหมด, เติม date อัตโนมัติ
  contentToUse = Object.assign({}, whatsNew, {
    version: newVersion,
    date:    dateObj
  });
  usingUserContent = true;
  console.log(`✅  ใช้เนื้อหาจาก whats-new.json (ผู้ใช้กำหนดเอง)`);
  console.log(`    📅 วันเวลา UTC: ${dateObj.en}`);
} else {
  // ✅ ไม่มีเนื้อหาจากผู้ใช้ → auto-generate จาก git diff
  const smartTitle    = buildSmartTitle(newVersion, currentVersion, isMinorBump);
  const smartSections = buildSmartChangelog(changedFiles, newVersion, currentVersion);

  contentToUse = {
    version:  newVersion,
    date:     dateObj,
    title:    smartTitle.title,
    subtitle: smartTitle.subtitle,
    sections: smartSections
  };

  if (autoIncremented) {
    console.log(`ℹ️   Auto-increment → สร้างเนื้อหาอัตโนมัติ`);
  } else {
    console.log(`⚠️   whats-new.json ไม่มีเนื้อหาสำหรับ v${newVersion} → สร้างอัตโนมัติ`);
  }
  console.log(`    📅 วันเวลา UTC: ${dateObj.en}`);
}

// ✅ เขียน whats-new.json (เกิดหลัง archive เสมอ)
fs.writeFileSync(whatsNewPath, JSON.stringify(contentToUse, null, 2) + '\n');
console.log(`✅  whats-new.json: บันทึกแล้ว`);

// ── ดึง changelog ─────────────────────────────────────────────────────────────

let changelog = [];
(contentToUse.sections || []).forEach(function(s) {
  (s.items || []).forEach(function(item) {
    const title = item.title && (item.title.en || item.title.th);
    if (title) changelog.push(title);
  });
});

// ── อัปเดต version.json ───────────────────────────────────────────────────────

// ✅ เก็บ content (title/subtitle/sections) ไว้ใน version.json
// เพื่อให้ deploy ครั้งถัดไปดึง archive ได้ถูกต้อง
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

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(56)}`);
console.log(`  Version:    ${currentVersion} → ${newVersion}${autoIncremented ? ' (auto +0.0.0.1)' : ''}`);
console.log(`  Build:      ${buildId}`);
console.log(`  Date/Time:  ${dateObj.en}`);
console.log(`  Content:    ${usingUserContent ? 'ผู้ใช้กำหนดเอง (whats-new.json)' : 'อัตโนมัติ (smart auto)'}`);
console.log(`  Git files:  ${changedFiles.length} ไฟล์`);
console.log(`  HTML:       ${updated}/${scanned} updated`);
console.log(`${'─'.repeat(56)}\n🚀  Ready!\n`);