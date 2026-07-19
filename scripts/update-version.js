#!/usr/bin/env node
// scripts/update-version.js — Fantrove Verse Release Tool
// v6.2: FIX — ประวัติไม่ถูกบันทึก (AUTO-SNAPSHOT อ้างอิง HEAD ผิดจังหวะ)
//
// v6.2 bug fix (จาก v6.1):
//     ปัญหา: เดิมระบบหา "เวอร์ชั่นก่อนหน้า" ด้วย `git show HEAD:current.md`
//     ตรงๆ โดยสมมติว่า HEAD ยังเป็น commit เก่าเสมอ แต่ใน CI จริง ลำดับคือ
//     dev แก้ current.md เป็นเวอร์ชั่นใหม่ → commit → push → CI ค่อยรัน
//     สคริปต์นี้ ดังนั้นตอนที่สคริปต์รัน HEAD **คือ** commit เวอร์ชั่นใหม่ไปแล้ว
//     → HEAD:current.md ให้เนื้อหาเวอร์ชั่นใหม่ ไม่ใช่เวอร์ชั่นก่อนหน้า
//     → prevVersion ทายผิดว่าเท่ากับ newVersion → ระบบคิดว่า "ไม่ใช่เวอร์ชั่น
//     ใหม่" → ข้าม AUTO-SNAPSHOT และการสร้างไฟล์ประวัติไปทั้งหมด (ประวัติหาย)
//
//     แก้ไข: เพิ่ม getPreviousCurrentMdContent() — ตรวจก่อนว่าเนื้อหาที่ HEAD
//     ตรงกับเวอร์ชั่นใหม่หรือไม่ ถ้าตรง (กรณี CI หลัง push) ให้ย้อนหา commit
//     ล่าสุด "ก่อนหน้า HEAD" ที่เคยแก้ไฟล์นี้จริงๆ แทน ใช้ได้ถูกต้องทั้งตอนรัน
//     ก่อน commit (local/pre-commit) และตอนรันหลัง push (CI)
//
// v6.1 changes จาก v6.0:
//     - ประวัติกลับไปอยู่ใน releases/ folder ของแต่ละภาษา (ตามที่ผู้ใช้ต้องการ)
//     - assets/md/{lang}/releases/v{version}.md (history)
//     - assets/md/{lang}/releases/index.json (per-language manifest)
//     - current.md อยู่นอก releases/ เพื่อแยกชัดเจนระหว่าง current และ history
//     - นักพัฒนาไม่ต้องสร้างไฟล์ใน releases/ เอง — ระบบทำ AUTO-SNAPSHOT ให้
//
// โครงสร้าง:
//   assets/md/
//     en/
//       current.md                  ← นักพัฒนาเขียน (version ปัจจุบัน)
//       releases/
//         index.json                ← generated (manifest ของภาษานี้)
//         v2.2.0.md                 ← generated (history — snapshot อัตโนมัติ)
//         v2.1.1.md
//         ...
//     th/
//       current.md
//       releases/
//         index.json
//         v2.2.0.md
//         ...
//
// กฎเหล็ก:
//   - นักพัฒนาแตะได้แค่ assets/md/{en,th}/current.md เท่านั้น
//   - ไฟล์อื่นทั้งหมดเป็น generated artifacts — ระบบสร้าง/จัดการเอง
//   - date ใน current.md ถูก sync อัตโนมัติ (นักพัฒนาไม่ต้องเขียน)
//   - เมื่อ bump version ระบบ snapshot current.md เก่าเป็น releases/v{prev}.md อัตโนมัติ
//   - index.json เก็บเฉพาะ 7 versions ล่าสุด ไม่รวม version ปัจจุบัน
//
// Build: git fetch --unshallow && node scripts/update-version.js
'use strict';

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_HISTORY = 7;                          // จำนวนประวัติสูงสุดใน index.json (ไม่รวมปัจจุบัน)
const LANGS = ['en', 'th'];                     // ภาษาที่รองรับ

const CONFIG = {
  perLangCurrent:   'assets/md/{lang}/current.md',
  perLangReleasesDir: 'assets/md/{lang}/releases',          // v6.1: releases/ folder ของแต่ละภาษา
  perLangIndex:     'assets/md/{lang}/releases/index.json', // v6.1: index.json ใน releases/
  perLangVersionMd: 'assets/md/{lang}/releases/v{version}.md', // v6.1: history files
  versionFile:      'assets/json/version.json',        // backward compat (new.js poll)
  excludeDirs:      new Set(['node_modules','.git','scripts','.cloudflare','dist','build']),
  htmlExts:         new Set(['.html','.htm']),
  assetPattern:     /((?:src|href)=["'][^"':]*?\.(?:js|css|json))\?v=[^"'\s&]*/g
};

const ROOT = path.resolve(__dirname, '..');
const NOW  = new Date();

// ── Helpers ──────────────────────────────────────────────────────────────────
function pad2(n) { return String(n).padStart(2, '0'); }

function git(args) {
  const r = spawnSync('git', args, { encoding:'utf8', stdio:['pipe','pipe','pipe'], cwd:ROOT });
  return r.status === 0 ? r.stdout.trim() : null;
}

function compareSemver(a, b) {
  var pa = String(a || '0').split(/[.+-]/).map(function (n) { return parseInt(n, 10) || 0; });
  var pb = String(b || '0').split(/[.+-]/).map(function (n) { return parseInt(n, 10) || 0; });
  var len = Math.max(pa.length, pb.length);
  for (var i = 0; i < len; i++) { var na = pa[i] || 0, nb = pb[i] || 0; if (na !== nb) return na - nb; }
  return 0;
}

// ── Markdown parser (single-language) ────────────────────────────────────────
function parseMD(mdText, lang) {
  var result = { version:'', date:null, title:null, subtitle:null, notify:true, sections:[] };
  try {
    var body = mdText;
    var fmMatch = mdText.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (fmMatch) {
      body = mdText.substring(fmMatch[0].length);
      var fm = fmMatch[1];
      var vM = fm.match(/^version:\s*(.+)$/m); if(vM) result.version = String(vM[1]).trim();
      var dM = fm.match(/^date:\s*(.+)$/m); if(dM) { var p=Date.parse(String(dM[1]).trim()); if(!isNaN(p)) result.date=new Date(p).toISOString(); }
      var nM = fm.match(/^notify:\s*(false|true)$/m); if(nM) result.notify = nM[1] !== 'false';
      var tL = fm.match(/^title:\s*(.+)$/m);
      if (tL && lang) { result.title = {}; result.title[lang] = String(tL[1]).trim(); }
      var sL = fm.match(/^subtitle:\s*(.+)$/m);
      if (sL && lang) { result.subtitle = {}; result.subtitle[lang] = String(sL[1]).trim(); }
    }
    var lines = body.split('\n');
    var cs = null, ci = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var hm = line.match(/^###\s+(New|Improved|Fixed|Removed)\s*$/i);
      if (hm) { if(cs) result.sections.push(cs); cs={type:hm[1].toLowerCase(),items:[]}; ci=null; continue; }
      if (line.match(/^\s*-\s+\*\*/)) { if(ci&&cs) cs.items.push(ci); ci=parseItemLine(line,lang); continue; }
      if (ci && line.trim() && !line.match(/^---/) && !line.match(/^###/)) {
        if (!ci.desc) { ci.desc = {}; ci.desc[lang||'en'] = ''; }
        ci.desc[lang||'en'] += (ci.desc[lang||'en'] ? ' ' : '') + line.trim();
      }
    }
    if (ci&&cs) cs.items.push(ci);
    if (cs) result.sections.push(cs);
  } catch(e) { console.warn('[update-version] MD parse error:', e.message); }
  return result;
}

function parseItemLine(line, lang) {
  var item = { title:{}, desc:null };
  var m = line.match(/^\s*-\s+\*\*(.+?)\*\*\s*(.*)?$/);
  if (m) {
    item.title = {}; item.title[lang||'en'] = m[1].trim();
    if (m[2]&&m[2].trim()) { item.desc = {}; item.desc[lang||'en'] = m[2].trim(); }
  }
  return item;
}

// ── v6.0: Read version + date from current.md ────────────────────────────────
function readCurrentMd(lang) {
  var p = path.join(ROOT, CONFIG.perLangCurrent.replace('{lang}', lang));
  if (!fs.existsSync(p)) return null;
  return parseMD(fs.readFileSync(p, 'utf8'), lang);
}

// ── v6.0: Scan history files in language folder ──────────────────────────────
// สแกนไฟล์ v{version}.md ใน assets/md/{lang}/ แล้วอ่าน date จากแต่ละไฟล์
function scanHistoryFiles(lang) {
  // v6.1: อ่านจาก releases/ folder ของแต่ละภาษา
  var dir = path.join(ROOT, CONFIG.perLangReleasesDir.replace('{lang}', lang));
  if (!fs.existsSync(dir)) return [];

  var files = fs.readdirSync(dir).filter(function(f) {
    return /^v\.?\d/.test(f) && f.endsWith('.md');
  });

  var entries = [];
  for (var i = 0; i < files.length; i++) {
    var filePath = path.join(dir, files[i]);
    try {
      var content = fs.readFileSync(filePath, 'utf8');
      var parsed = parseMD(content, lang);
      // ดึง version จากชื่อไฟล์ (เช่น "v2.1.0.md" → "2.1.0")
      var ver = files[i].replace(/^v/, '').replace(/\.md$/, '');
      entries.push({
        version: ver,
        date: parsed.date || null,
        title: parsed.title || null,
        subtitle: parsed.subtitle || null,
        sections: parsed.sections || [],
        fileName: files[i],
      });
    } catch (e) {
      console.warn('[update-version] scanHistoryFiles: failed to parse', files[i], e.message);
    }
  }

  // เรียงจากใหม่ → เก่า ตาม date (fallback semver)
  entries.sort(function(a, b) {
    if (a.date && b.date) return b.date.localeCompare(a.date);
    return compareSemver(b.version, a.version);
  });

  return entries;
}

// ── v6.2: หาเนื้อหา current.md "เวอร์ชั่นก่อนหน้า" จริงๆ (ไม่ใช่แค่ HEAD ตรงๆ) ──
//  ปัญหาเดิม: `git show HEAD:file` สมมติว่า HEAD ยังเป็น commit เก่าเสมอ แต่ใน
//  CI จริง (รันหลัง push) HEAD คือ commit ที่ bump เวอร์ชั่นไปแล้ว
//  วิธีแก้: เช็คก่อนว่า version ใน HEAD ตรงกับ newVersion หรือไม่
//    - ไม่ตรง (ปกติ, รันตอน local/pre-commit) → HEAD คือของเก่าจริง ใช้ได้เลย
//    - ตรงกัน (CI หลัง push) → HEAD คือ commit ใหม่ ต้องย้อนไปหา commit ก่อนหน้า
//      ที่แก้ไฟล์นี้จริงๆ ด้วย `git log` แทน
function getPreviousCurrentMdContent(lang, newVersion) {
  var relPath = CONFIG.perLangCurrent.replace('{lang}', lang);
  var headContent = git(['show', 'HEAD:' + relPath]);
  if (!headContent) return null;

  var headVersionMatch = headContent.match(/^version:\s*(.+)$/m);
  var headVersion = headVersionMatch ? headVersionMatch[1].trim() : null;

  if (headVersion !== newVersion) {
    // HEAD ยังไม่ใช่ commit ที่ bump — เป็นของเก่าจริง ใช้ได้ตรงๆ
    return headContent;
  }

  // HEAD คือ commit ที่ bump ไปแล้ว (เช่น CI หลัง push) — ย้อนหา commit ก่อนหน้า
  // ที่แก้ไขไฟล์นี้จริงๆ (ข้าม HEAD เอง)
  var log = git(['log', '--format=%H', '-n', '2', '--', relPath]);
  var hashes = log ? log.split('\n').filter(Boolean) : [];
  if (hashes.length < 2) return null; // ไม่มีประวัติก่อนหน้า (เป็น release แรก)
  return git(['show', hashes[1] + ':' + relPath]);
}

// ── v6.0: AUTO-SNAPSHOT previous version ─────────────────────────────────────
//  ก่อน bump version ใหม่ ระบบอ่าน current.md เก่าจาก git HEAD
//  แล้ว snapshot เป็น v{prevVersion}.md อัตโนมัติ
function autoSnapshotPrevious(newVersion) {
  var prevVersion = null;
  var prevContents = {};

  for (var i = 0; i < LANGS.length; i++) {
    var lang = LANGS[i];
    var content = getPreviousCurrentMdContent(lang, newVersion);
    if (content) {
      prevContents[lang] = content;
      var match = content.match(/^version:\s*(.+)$/m);
      if (match && !prevVersion) {
        prevVersion = match[1].trim();
      }
    }
  }

  if (!prevVersion) {
    console.log('ℹ️  v6.0 AUTO-SNAPSHOT: ไม่พบ version เก่าใน git HEAD — skip');
    return;
  }

  if (prevVersion === newVersion) {
    console.log('ℹ️  v6.0 AUTO-SNAPSHOT: version เก่า (' + prevVersion + ') เท่ากับ version ใหม่ — skip');
    return;
  }

  console.log('📸  v6.0 AUTO-SNAPSHOT: บันทึก current.md เก่า (v' + prevVersion + ') เป็นไฟล์ประวัติ');

  for (var j = 0; j < LANGS.length; j++) {
    var snapLang = LANGS[j];
    var snapContent = prevContents[snapLang];
    if (!snapContent) continue;

    // v6.1: snapshot ไปยัง releases/ folder ของแต่ละภาษา
    var snapDestPath = path.join(ROOT, CONFIG.perLangReleasesDir.replace('{lang}', snapLang), 'v' + prevVersion + '.md');

    // ถ้ายังไม่มีไฟล์ → สร้างใหม่ (ถ้ามีแล้วไม่เขียนทับ)
    if (!fs.existsSync(snapDestPath)) {
      // sync date ใน snapshot ให้เป็น commit time ของ HEAD (หรือ NOW ถ้าไม่ได้)
      var headCommitTime = git(['log', '-1', '--format=%ct', 'HEAD']);
      var snapDate = headCommitTime
        ? new Date(parseInt(headCommitTime, 10) * 1000).toISOString()
        : NOW.toISOString();

      if (/^date:\s*.+$/m.test(snapContent)) {
        snapContent = snapContent.replace(/^date:\s*.+$/m, 'date: ' + snapDate);
      } else {
        snapContent = snapContent.replace(/^(version:\s*.+)$/m, '$1\ndate: ' + snapDate);
      }

      fs.mkdirSync(path.dirname(snapDestPath), { recursive: true });
      fs.writeFileSync(snapDestPath, snapContent, 'utf8');
      console.log('✅  ' + CONFIG.perLangReleasesDir.replace('{lang}', snapLang) + '/v' + prevVersion + '.md → AUTO-SNAPSHOT สร้างใหม่');
    } else {
      console.log('⏭️   ' + CONFIG.perLangReleasesDir.replace('{lang}', snapLang) + '/v' + prevVersion + '.md → มีอยู่แล้ว (skip)');
    }
  }
}

// ── v6.0: Generate per-language index.json ───────────────────────────────────
//  สร้าง index.json ในแต่ละภาษา โดยอ่าน date จาก MD โดยตรง
//  เก็บเฉพาะ 7 versions ล่าสุด ไม่รวม version ปัจจุบัน
function generateIndex(lang, currentVersion) {
  var historyEntries = scanHistoryFiles(lang);

  // กรอง version ปัจจุบันออก (current.md แสดงแยก)
  var filtered = historyEntries.filter(function(e) {
    return e.version !== currentVersion;
  });

  // เก็บเฉพาะ MAX_HISTORY ล่าสุด
  var limited = filtered.slice(0, MAX_HISTORY);

  var indexData = {
    versions: limited.map(function(e) {
      return {
        version: e.version,
        date: e.date,
        hasDetails: true,  // v6.0: ถ้าอยู่ใน list แสดงว่ามีไฟล์
      };
    }),
    updatedAt: NOW.toISOString(),
  };

  var indexPath = path.join(ROOT, CONFIG.perLangIndex.replace('{lang}', lang));
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2) + '\n');
  console.log('✅  ' + CONFIG.perLangIndex.replace('{lang}', lang) + ' → ' + limited.length + '/' + MAX_HISTORY + ' versions');
}

// ── v6.1: Sync date in current.md ────────────────────────────────────────────
//  ถ้า version ใหม่ → เขียน date = NOW
//  ถ้า version เดิม → อ่าน date จาก releases/v{version}.md ถ้ามี, ไม่งั้นใช้ NOW
function syncCurrentMdDate(lang, version, isNewVersion) {
  var fp = path.join(ROOT, CONFIG.perLangCurrent.replace('{lang}', lang));
  if (!fs.existsSync(fp)) return;

  var content = fs.readFileSync(fp, 'utf8');

  // หา date ที่ควรใช้
  var targetDate;
  if (isNewVersion) {
    targetDate = NOW.toISOString();
  } else {
    // v6.1: อ่าน date จากไฟล์ประวัติของ version นี้ใน releases/ (ถ้ามี)
    var histPath = path.join(ROOT, CONFIG.perLangReleasesDir.replace('{lang}', lang), 'v' + version + '.md');
    if (fs.existsSync(histPath)) {
      var histParsed = parseMD(fs.readFileSync(histPath, 'utf8'), lang);
      targetDate = histParsed.date || NOW.toISOString();
    } else {
      // ถ้าไม่มีไฟล์ประวัติ → ใช้ date ปัจจุบันใน current.md (ถ้ามี), ไม่งั้น NOW
      var existingMatch = content.match(/^date:\s*(.+)$/m);
      targetDate = existingMatch ? existingMatch[1].trim() : NOW.toISOString();
    }
  }

  var existingDateMatch = content.match(/^date:\s*(.+)$/m);
  var existingDate = existingDateMatch ? existingDateMatch[1].trim() : null;

  if (existingDate !== targetDate) {
    if (/^date:\s*.+$/m.test(content)) {
      content = content.replace(/^date:\s*.+$/m, 'date: ' + targetDate);
    } else {
      content = content.replace(/^(version:\s*.+)$/m, '$1\ndate: ' + targetDate);
    }
    fs.writeFileSync(fp, content, 'utf8');
    console.log('✅  ' + CONFIG.perLangCurrent.replace('{lang}', lang) + ' → date = ' + targetDate + (isNewVersion ? ' (version ใหม่)' : ' (sync)'));
  } else {
    console.log('⏭️   ' + CONFIG.perLangCurrent.replace('{lang}', lang) + ' → date ถูกต้องแล้ว (' + targetDate + ')');
  }
}

// ── v6.1: Create v{version}.md for new version ───────────────────────────────
function createNewVersionSnapshot(lang, version) {
  var srcPath = path.join(ROOT, CONFIG.perLangCurrent.replace('{lang}', lang));
  // v6.1: snapshot ไปยัง releases/ folder
  var destPath = path.join(ROOT, CONFIG.perLangReleasesDir.replace('{lang}', lang), 'v' + version + '.md');

  if (!fs.existsSync(srcPath)) return;

  var content = fs.readFileSync(srcPath, 'utf8');
  // sync date
  if (/^date:\s*.+$/m.test(content)) {
    content = content.replace(/^date:\s*.+$/m, 'date: ' + NOW.toISOString());
  } else {
    content = content.replace(/^(version:\s*.+)$/m, '$1\ndate: ' + NOW.toISOString());
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, content, 'utf8');
  console.log('✅  ' + CONFIG.perLangReleasesDir.replace('{lang}', lang) + '/v' + version + '.md → สร้างใหม่');
}

// ── v6.0: Generate version.json (backward compat for new.js poll) ────────────
function generateVersionJson(version, date) {
  var versionPath = path.join(ROOT, CONFIG.versionFile);
  fs.mkdirSync(path.dirname(versionPath), { recursive: true });
  fs.writeFileSync(versionPath, JSON.stringify({
    version: version,
    date: date,
  }, null, 2) + '\n');
  console.log('✅  ' + CONFIG.versionFile + ' → ' + version + ' (date: ' + date + ')');
}

// ── v6.0: HTML cache busting ─────────────────────────────────────────────────
function htmlCacheBust(buildId) {
  var scanned = 0, updated = 0;
  function walk(dir) {
    var entries; try { entries = fs.readdirSync(dir, {withFileTypes:true}); } catch(_) { return; }
    for (var e of entries) {
      if (e.name.startsWith('.') || CONFIG.excludeDirs.has(e.name)) continue;
      var full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!CONFIG.htmlExts.has(path.extname(e.name).toLowerCase())) continue;
      scanned++;
      var orig = fs.readFileSync(full, 'utf8');
      var next = orig.replace(CONFIG.assetPattern, '$1?v='+buildId);
      if (next !== orig) { fs.writeFileSync(full, next, 'utf8'); updated++; console.log('  ✅  '+path.relative(ROOT,full)); }
    }
  }
  console.log('\nScanning HTML...'); walk(ROOT);
  return { scanned: scanned, updated: updated };
}

// ── v6.3: Dynamic loader cache busting ──────────────────────────────────────
// ปัญหา: ไฟล์ที่ถูกโหลดแบบ dynamic (nav-core-modules/*.js, ure-modules/*.js, ฯลฯ)
//   ไม่ได้อยู่ใน HTML โดยตรง จึงไม่ถูก regex ?v= ของ htmlCacheBust จับได้
//   เมื่อไฟล์เหล่านี้ถูกอัพเดท browser ใช้ cache เดิม (1 วันตาม _headers) → user
//   ไม่ได้รับการอัพเดท
//
// แนวทางแก้: แต่ละ dynamic loader (nav-core.js, ure.js, popup.js, ฯลฯ) มีตัวแปร
//   `var FV_BUILD_ID = '';` ที่ build script จะแทนที่ด้วย buildId จริง
//   loader ใช้ _v() helper ต่อ ?v=<buildId> ท้าย URL ของ modules ที่โหลด
//
// นอกจากนี้ยังจัดการ ES module imports (con-data-service.js → con-data-registry.js)
//   โดยแทนที่ import path จาก './foo.js' → './foo.js?v=<buildId>'
//
// รายชื่อไฟล์ที่มี FV_BUILD_ID variable:
var DYNAMIC_LOADERS = [
  'assets/js/nav-core.js',
  'assets/js/ure/ure.js',
  'assets/js/popup.js',
  'assets/js/search-ui.js',
  'assets/js/language.js',
  'assets/js/nav-core-modules/loading.js',
];

// รายชื่อไฟล์ที่มี ES module imports ที่ต้อง cache-bust:
var ES_MODULE_FILES = [
  'assets/js/con-data-service/con-data-service.js',
];

// Regex สำหรับจับ FV_BUILD_ID = '...' หรือ FV_BUILD_ID = "..."
//   จับทั้งกรณีที่มีค่าเดิม (เช่น build ครั้งก่อน) และกรณีที่เป็น '' (source)
var FV_BUILD_ID_PATTERN = /(FV_BUILD_ID\s*=\s*)['"][^'"]*['"]/;

// Regex สำหรับจับ ES module import path ที่ลงท้ายด้วย .js (มีหรือไม่มี ?v= ก็ได้)
//   จับทั้ง relative imports (./foo.js, ../bar.js) และ absolute (/assets/.../foo.js)
//   ไม่จับ CDN URLs (https://...) เพราะไม่ใช่ internal assets
var ES_IMPORT_PATTERN = /(from\s+['"])([^'"]+\.js)(\?v=[^'"]*)?(['"])/g;

function dynamicLoaderCacheBust(buildId) {
  var updated = 0;
  var scanned = 0;

  // ── Phase 1: แทนที่ FV_BUILD_ID ใน dynamic loaders ──────────────────────
  console.log('\n  Phase 1: Injecting FV_BUILD_ID into dynamic loaders...');
  for (var i = 0; i < DYNAMIC_LOADERS.length; i++) {
    var relPath = DYNAMIC_LOADERS[i];
    var fullPath = path.join(ROOT, relPath);
    if (!fs.existsSync(fullPath)) {
      console.log('  ⚠️  ' + relPath + ' — file not found, skip');
      continue;
    }
    scanned++;
    var orig = fs.readFileSync(fullPath, 'utf8');
    var next = orig.replace(FV_BUILD_ID_PATTERN, "$1'" + buildId + "'");
    if (next !== orig) {
      fs.writeFileSync(fullPath, next, 'utf8');
      updated++;
      console.log('  ✅  ' + relPath + ' — FV_BUILD_ID = ' + buildId);
    } else {
      console.log('  ⚠️  ' + relPath + ' — FV_BUILD_ID pattern not found');
    }
  }

  // ── Phase 2: แทนที่ ES module import paths ──────────────────────────────
  console.log('\n  Phase 2: Cache-busting ES module import paths...');
  for (var j = 0; j < ES_MODULE_FILES.length; j++) {
    var esRelPath = ES_MODULE_FILES[j];
    var esFullPath = path.join(ROOT, esRelPath);
    if (!fs.existsSync(esFullPath)) {
      console.log('  ⚠️  ' + esRelPath + ' — file not found, skip');
      continue;
    }
    scanned++;
    var esOrig = fs.readFileSync(esFullPath, 'utf8');
    var esNext = esOrig.replace(ES_IMPORT_PATTERN, function(match, prefix, importPath, oldVersion, quote) {
      // ข้าม CDN URLs (http://, https://)
      if (/^https?:\/\//.test(importPath)) return match;
      // ถ้าไม่ใช่ relative import (./ หรือ ../) ก็ข้าม — อาจเป็น bare specifier
      if (!importPath.startsWith('./') && !importPath.startsWith('../')) return match;
      // แทนที่ด้วย importPath?v=<buildId> (เขียนทับ oldVersion ถ้ามี)
      return prefix + importPath + '?v=' + buildId + quote;
    });
    if (esNext !== esOrig) {
      fs.writeFileSync(esFullPath, esNext, 'utf8');
      updated++;
      console.log('  ✅  ' + esRelPath + ' — ES imports cache-busted');
    } else {
      console.log('  ⏭️  ' + esRelPath + ' — no ES imports to update');
    }
  }

  return { scanned: scanned, updated: updated };
}

// ── Cleanup legacy files (v6.1) ──────────────────────────────────────────────
//  ย้ายไฟล์จาก v6.0 structure (lang/v*.md, lang/index.json) ไป v6.1 (lang/releases/)
//  ลบไฟล์ legacy อื่นๆ ที่ไม่ใช้แล้ว
function cleanupLegacy() {
  // v6.1: ลบไฟล์ legacy ที่ไม่ใช้แล้ว
  var legacyPaths = [
    'assets/json/release-dates.json',     // v6.0: ลบ — date อยู่ใน MD แล้ว
    'assets/md/releases/index.json',      // legacy root-level releases (เดิม)
    'assets/md/releases',                  // legacy root-level releases folder
  ];

  for (var i = 0; i < legacyPaths.length; i++) {
    var p = path.join(ROOT, legacyPaths[i]);
    if (fs.existsSync(p)) {
      try {
        if (fs.statSync(p).isDirectory()) {
          fs.rmSync(p, { recursive: true, force: true });
        } else {
          fs.unlinkSync(p);
        }
        console.log('🗑️  ลบ legacy: ' + legacyPaths[i]);
      } catch (e) {
        console.warn('⚠️  ไม่สามารถลบ ' + legacyPaths[i] + ': ' + e.message);
      }
    }
  }

  // v6.1: ย้ายไฟล์จาก v6.0 structure (lang/v*.md, lang/index.json) ไป lang/releases/
  for (var j = 0; j < LANGS.length; j++) {
    var lang = LANGS[j];
    var langDir = path.join(ROOT, 'assets/md/' + lang);
    var releasesDir = path.join(ROOT, 'assets/md/' + lang + '/releases');

    if (!fs.existsSync(langDir)) continue;
    fs.mkdirSync(releasesDir, { recursive: true });

    // ย้าย v*.md จาก langDir ไป releasesDir (v6.1: รองรับทั้ง v1.0.0 และ v.1.0.0)
    var langFiles = fs.readdirSync(langDir).filter(function(f) {
      return /^v\.?\d/.test(f) && f.endsWith('.md');
    });
    for (var k = 0; k < langFiles.length; k++) {
      var oldPath = path.join(langDir, langFiles[k]);
      var newPath = path.join(releasesDir, langFiles[k]);
      if (!fs.existsSync(newPath)) {
        fs.copyFileSync(oldPath, newPath);
        console.log('📦  ย้าย: ' + lang + '/' + langFiles[k] + ' → ' + lang + '/releases/' + langFiles[k]);
      }
      // ลบไฟล์เก่าจาก langDir
      try { fs.unlinkSync(oldPath); } catch (_) {}
    }

    // ย้าย index.json จาก langDir ไป releasesDir (ถ้ามี แต่เราจะ regenerate อยู่แล้ว)
    var oldIndex = path.join(langDir, 'index.json');
    if (fs.existsSync(oldIndex)) {
      try { fs.unlinkSync(oldIndex); } catch (_) {}
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════════════════════════════════════

// v6.1: อ่าน version จาก current.md
var newVersion = null;
for (var li = 0; li < LANGS.length; li++) {
  var parsed = readCurrentMd(LANGS[li]);
  if (parsed && parsed.version) { newVersion = parsed.version; break; }
}

if (!newVersion) {
  console.error('\n  ❌  ไม่พบ version ใน assets/md/{en,th}/current.md');
  console.error('      กรุณาเพิ่ม version: X.Y.Z ใน frontmatter ของ current.md\n');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+/.test(newVersion)) {
  console.error('\n  ❌  "' + newVersion + '" ไม่ใช่ semver ที่ถูกต้อง\n');
  process.exit(1);
}

// ตรว version เก่า (จุดที่เคยเป็นบั๊ก v6.1: ใช้ HEAD ตรงๆ ซึ่งหลัง push แล้ว
// HEAD คือ commit ใหม่ไปแล้ว ทำให้ prevVersion == newVersion เสมอ)
// v6.2: ใช้ getPreviousCurrentMdContent() ที่ย้อนหา commit ก่อนหน้าจริงๆ
var prevVersion = null;
for (var pi = 0; pi < LANGS.length; pi++) {
  var prevContent = getPreviousCurrentMdContent(LANGS[pi], newVersion);
  if (prevContent) {
    var prevMatch = prevContent.match(/^version:\s*(.+)$/m);
    if (prevMatch) { prevVersion = prevMatch[1].trim(); break; }
  }
}
var isNewVersion = prevVersion !== newVersion;

var dateStr = NOW.toISOString().slice(0,10).replace(/-/g,'');
var timeStr = pad2(NOW.getUTCHours()) + pad2(NOW.getUTCMinutes());
var buildId = newVersion + '-' + dateStr + timeStr;

console.log('\n📦  Fantrove Release Tool v6.1 (PER-LANG releases/ FOLDER)');
console.log('    Version:  ' + newVersion + (isNewVersion ? ' (NEW)' : ' (same)'));
console.log('    Prev:     ' + (prevVersion || '(none)'));
console.log('    Build ID: ' + buildId);
console.log('    Date:     ' + NOW.toISOString());
console.log('');

// ── STEP 1: Cleanup legacy files ─────────────────────────────────────────────
console.log('🧹  STEP 1: Cleanup legacy files...');
cleanupLegacy();
console.log('');

// ── STEP 2: AUTO-SNAPSHOT previous version ───────────────────────────────────
console.log('📸  STEP 2: AUTO-SNAPSHOT previous version...');
if (isNewVersion) {
  autoSnapshotPrevious(newVersion);
} else {
  console.log('ℹ️  Skip — version เดิม');
}
console.log('');

// ── STEP 3: Sync date in current.md ──────────────────────────────────────────
console.log('📅  STEP 3: Sync date in current.md...');
for (var si = 0; si < LANGS.length; si++) {
  syncCurrentMdDate(LANGS[si], newVersion, isNewVersion);
}
console.log('');

// ── STEP 4: Create v{version}.md for new version ─────────────────────────────
console.log('📄  STEP 4: Create version snapshot...');
if (isNewVersion) {
  for (var ci = 0; ci < LANGS.length; ci++) {
    createNewVersionSnapshot(LANGS[ci], newVersion);
  }
} else {
  console.log('ℹ️  Skip — version เดิม (ไฟล์ v' + newVersion + '.md มีอยู่แล้ว)');
}
console.log('');

// ── STEP 5: Generate per-language index.json ─────────────────────────────────
console.log('📋  STEP 5: Generate per-language index.json...');
for (var ii = 0; ii < LANGS.length; ii++) {
  generateIndex(LANGS[ii], newVersion);
}
console.log('');

// ── STEP 6: Generate version.json (backward compat) ──────────────────────────
console.log('📦  STEP 6: Generate version.json...');
var currentReleaseDateISO;
if (isNewVersion) {
  currentReleaseDateISO = NOW.toISOString();
} else {
  // อ่าน date จาก current.md
  var curParsed = readCurrentMd('en') || readCurrentMd('th');
  currentReleaseDateISO = (curParsed && curParsed.date) ? curParsed.date : NOW.toISOString();
}
generateVersionJson(newVersion, currentReleaseDateISO);
console.log('');

// ── STEP 7: HTML cache busting ───────────────────────────────────────────────
console.log('🌐  STEP 7: HTML cache busting...');
var htmlResult = htmlCacheBust(buildId);
console.log('');

// ── STEP 7.5: Dynamic loader cache busting (v6.3) ────────────────────────────
//  WHY: HTML cache busting (STEP 7) จับเฉพาะ ?v= ที่อยู่ใน src/href ของ HTML
//    ไฟล์ที่ถูกโหลดแบบ dynamic (เช่น nav-core-modules/*.js) ไม่ได้อยู่ใน HTML
//    จึงต้อง inject buildId ลงในตัว loader เอง (FV_BUILD_ID variable)
//    และ ES module imports ที่ไม่ได้ผ่าน HTML (เช่น con-data-registry.js)
console.log('🔌  STEP 7.5: Dynamic loader cache busting...');
var loaderResult = dynamicLoaderCacheBust(buildId);
console.log('');

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(56));
console.log('  Version:  ' + newVersion + (isNewVersion ? ' (NEW)' : ' (same)'));
console.log('  Build ID: ' + buildId);
console.log('  Release:  ' + currentReleaseDateISO + (isNewVersion ? ' — บันทึกใหม่' : ' — คงเดิม'));
console.log('  Source:   Per-language MD (v6.1 — releases/ folder per lang)');
console.log('  HTML:     ' + htmlResult.updated + '/' + htmlResult.scanned + ' updated');
console.log('  Loaders:  ' + loaderResult.updated + '/' + loaderResult.scanned + ' updated (v6.3 dynamic + ES imports)');
console.log('─'.repeat(56) + '\n🚀  Ready!\n');
