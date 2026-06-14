#!/usr/bin/env node
// scripts/update-version.js — Fantrove Verse Release Tool
// v2: Markdown-based — อ่าน current.md แทน whats-new.json
//     สร้าง release-history.json จาก git log ของ current.md + releases/*.md
//     รองรับ whats-new.json เก่า (fallback) ถ้า current.md ยังไม่มี
//
// Build command: git fetch --unshallow && APP_VERSION=1.4.0 node scripts/update-version.js
'use strict';

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_HISTORY = 7;

const CONFIG = {
  // ไฟล์หลัก — MD format ใหม่
  currentMdFile: 'assets/md/current.md',
  releasesDir:  'assets/md/releases',

  // ไฟล์ JSON — สำหรับ runtime (สร้างโดย script นี้)
  historyFile:   'assets/json/release-history.json',
  versionFile:   'assets/json/version.json',

  // ไฟล์ JSON เก่า — fallback ถ้ายังไม่มี MD
  legacyWhatsNew: 'assets/json/whats-new.json',

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

const ROOT = path.resolve(__dirname, '..');
const NOW  = new Date();

// ── Date helpers (UTC) ────────────────────────────────────────────────────────

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

// ══════════════════════════════════════════════════════════════════════════════
//  MARKDOWN PARSER (Node.js version)
// ══════════════════════════════════════════════════════════════════════════════

function parseMD(mdText) {
  const result = { version: '', date: null, title: null, subtitle: null, notify: true, sections: [] };
  try {
    let body = mdText;
    const fmMatch = mdText.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (fmMatch) {
      body = mdText.substring(fmMatch[0].length);
      const fm = fmMatch[1];

      const vMatch = fm.match(/^version:\s*(.+)$/m);
      if (vMatch) result.version = String(vMatch[1]).trim();

      const dMatch = fm.match(/^date:\s*(.+)$/m);
      if (dMatch) {
        const parsed = Date.parse(String(dMatch[1]).trim());
        if (!isNaN(parsed)) result.date = new Date(parsed).toISOString();
      }

      const nMatch = fm.match(/^notify:\s*(false|true)$/m);
      if (nMatch) result.notify = nMatch[1] !== 'false';

      // i18n block หรือ single line
      const titleBlock = fm.match(/^(title:)\s*\n((?:  \w+:\s*.+\n?)+)/m);
      if (titleBlock) result.title = parseI18nBlock(titleBlock[2]);
      else { const tl = fm.match(/^title:\s*(.+)$/m); if (tl) result.title = { en: String(tl[1]).trim() }; }

      const subBlock = fm.match(/^(subtitle:)\s*\n((?:  \w+:\s*.+\n?)+)/m);
      if (subBlock) result.subtitle = parseI18nBlock(subBlock[2]);
      else { const sl = fm.match(/^subtitle:\s*(.+)$/m); if (sl) result.subtitle = { en: String(sl[1]).trim() }; }
    }

    const lines = body.split('\n');
    let currentSection = null, currentItem = null;

    for (const line of lines) {
      const headingMatch = line.match(/^###\s+(New|Improved|Fixed)\s*$/i);
      if (headingMatch) {
        if (currentSection) result.sections.push(currentSection);
        currentSection = { type: headingMatch[1].toLowerCase(), items: [] };
        currentItem = null;
        continue;
      }
      if (line.match(/^\s*-\s+\*\*/)) {
        if (currentItem && currentSection) currentSection.items.push(currentItem);
        currentItem = parseItemLine(line);
        continue;
      }
      if (currentItem && line.trim() && !line.match(/^---/) && !line.match(/^###/)) {
        if (!currentItem.desc) currentItem.desc = { en: '', th: '' };
        currentItem.desc.en += (currentItem.desc.en ? ' ' : '') + line.trim();
        currentItem.desc.th += (currentItem.desc.th ? ' ' : '') + line.trim();
      }
    }
    if (currentItem && currentSection) currentSection.items.push(currentItem);
    if (currentSection) result.sections.push(currentSection);
  } catch (e) {
    console.warn('[update-version] MD parse error:', e.message);
  }
  return result;
}

function parseI18nBlock(block) {
  const obj = {};
  const re = /^\s+(\w+):\s*(.+)$/gm;
  let m;
  while ((m = re.exec(block)) !== null) obj[m[1]] = m[2].trim();
  return Object.keys(obj).length ? obj : null;
}

function parseItemLine(line) {
  const item = { title: { en: '', th: '' }, desc: null };
  const match = line.match(/^\s*-\s+\*\*(.+?)\*\*\s*(.*)?$/);
  if (match) {
    item.title = { en: match[1].trim(), th: match[1].trim() };
    if (match[2] && match[2].trim()) item.desc = { en: match[2].trim(), th: match[2].trim() };
  }
  return item;
}

// ── อ่านไฟล์ ──────────────────────────────────────────────────────────────────

const currentMdPath = path.join(ROOT, CONFIG.currentMdFile);
const historyPath   = path.join(ROOT, CONFIG.historyFile);
const versionPath   = path.join(ROOT, CONFIG.versionFile);
const legacyPath    = path.join(ROOT, CONFIG.legacyWhatsNew);

// อ่าน current.md — ไฟล์หลักของ release ปัจจุบัน
let currentData = null;
let useMd = false; // track ว่าใช้ MD หรือ JSON

if (fs.existsSync(currentMdPath)) {
  const mdText = fs.readFileSync(currentMdPath, 'utf8');
  const parsed = parseMD(mdText);
  if (parsed.version) {
    currentData = parsed;
    useMd = true;
  }
}

// Fallback: ถ้าไม่มี current.md หรือ parse ไม่ได้ → อ่าน whats-new.json เก่า
if (!currentData && fs.existsSync(legacyPath)) {
  try {
    currentData = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
  } catch (_) {}
}

if (!currentData) {
  console.error('\n  ❌  ไม่พบ current.md หรือ whats-new.json\n'); process.exit(1);
}

const newVersion = (currentData.version || APP_VERSION).trim();
const dateObj    = makeDateObj(NOW);
const dateStr    = NOW.toISOString().slice(0, 10).replace(/-/g, '');
const timeStr    = pad2(NOW.getUTCHours()) + pad2(NOW.getUTCMinutes());
const buildId    = `${newVersion}-${dateStr}${timeStr}`;

console.log(`\n📦  Fantrove Release Tool v2 (MD)`);
console.log(`    Version:  ${newVersion}`);
console.log(`    Build ID: ${buildId}`);
console.log(`    Date:     ${dateObj.en}`);
console.log(`    Source:   ${useMd ? 'current.md (Markdown)' : 'whats-new.json (legacy)'}\n`);

// ── STEP 1: สร้าง history จาก git log ─────────────────────────────────────────
// ติดตามไฟล์ที่เกี่ยวข้อง:
//   - current.md (MD ใหม่) หรือ whats-new.json (เก่า)
//   - releases/*.md (ไฟล์ประวัติ MD ที่เคยเขียนไว้)

console.log('📚  Building history from git log...');

// เก็บ path ของไฟล์ที่จะติดตาม
var trackFiles = [CONFIG.currentMdFile];
if (!useMd) trackFiles.push(CONFIG.legacyWhatsNew);

// ถ้ามี releases/ directory อยู่ ก็ติดตามทั้ง directory
var releasesDirPath = path.join(ROOT, CONFIG.releasesDir);
if (fs.existsSync(releasesDirPath)) {
  var mdFiles = fs.readdirSync(releasesDirPath).filter(f => f.endsWith('.md'));
  mdFiles.forEach(f => trackFiles.push(CONFIG.releasesDir + '/' + f));
  console.log(`    Tracking ${mdFiles.length} file(s) in ${CONFIG.releasesDir}/`);
}

// git log ของทุกไฟล์ที่ track
var allCommits = {};
trackFiles.forEach(function(filePath) {
  var commitLog = git(['log', '--format=%H %ct', '--', filePath]);
  if (!commitLog) return;

  commitLog.split('\n').filter(Boolean).forEach(function(line) {
    var parts = line.split(' ');
    var hash = parts[0];
    var ts   = parseInt(parts[1], 10) * 1000;
    if (!allCommits[hash]) allCommits[hash] = { hash: hash, ts: ts, files: [] };
    allCommits[hash].files.push(filePath);
  });
});

// เรียง commits ตามเวลา
var commits = Object.values(allCommits).sort(function(a, b) { return a.ts - b.ts; });
console.log(`    พบ ${commits.length} unique commit(s) ของไฟล์ release notes`);

var seenVersions = new Set([newVersion]);
var releases     = [];

// อ่านไฟล์ในแต่ละ commit แล้วสร้าง release entry
for (var i = 0; i < commits.length; i++) {
  var commit = commits[i];
  var versionFound = null;
  var releaseData  = null;

  // ลองอ่าน current.md จาก commit นี้
  var mdContent = git(['show', commit.hash + ':' + CONFIG.currentMdFile]);
  if (mdContent) {
    var parsed = parseMD(mdContent);
    if (parsed.version && !seenVersions.has(parsed.version)) {
      versionFound = parsed.version;
      releaseData  = parsed;
    }
  }

  // ถ้าไม่ได้จาก current.md ลอง whats-new.json (เก่า)
  if (!releaseData && !useMd) {
    var jsonContent = git(['show', commit.hash + ':' + CONFIG.legacyWhatsNew]);
    if (jsonContent) {
      try {
        var jsonParsed = JSON.parse(jsonContent);
        if (jsonParsed.version && !seenVersions.has(jsonParsed.version)) {
          versionFound = jsonParsed.version;
          releaseData  = jsonParsed;
        }
      } catch (_) {}
    }
  }

  // ลองอ่าน releases/*.md จาก commit นี้
  if (!releaseData) {
    commit.files.forEach(function(filePath) {
      if (filePath.startsWith(CONFIG.releasesDir + '/')) {
        var fileContent = git(['show', commit.hash + ':' + filePath]);
        if (fileContent) {
          var p = parseMD(fileContent);
          if (p.version && !seenVersions.has(p.version)) {
            versionFound = p.version;
            releaseData  = p;
          }
        }
      }
    });
  }

  if (releaseData && versionFound) {
    seenVersions.add(versionFound);
    var d       = new Date(commit.ts || Date.now());
    var relDate = releaseData.date || makeDateObj(d);

    // ถ้า date เป็น ISO string แปลงเป็น date object สำหรับ JSON
    if (typeof relDate === 'string') {
      relDate = makeDateObj(new Date(relDate));
    }

    releases.push({
      version:  versionFound,
      date:     relDate,
      title:    releaseData.title    || { en: 'System update',        th: 'อัปเดตระบบ' },
      subtitle: releaseData.subtitle || { en: 'Minor improvements.',  th: 'ปรับปรุงเล็กน้อย' },
      sections: releaseData.sections || []
    });

    if (releases.length >= MAX_HISTORY) break;
  }
}

// เรียงจากใหม่ → เก่า
releases.reverse();

var history = { releases: releases };
fs.mkdirSync(path.dirname(historyPath), { recursive: true });
fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + '\n');
console.log(`✅  release-history.json: ${releases.length}/${MAX_HISTORY} [${releases.map(function(r){return r.version;}).join(', ')}]`);

// ── STEP 2: อัพเดท current.md — เพิ่ม date ลงไป (ถ้าเป็น MD) ──────────────

if (useMd) {
  // อ่าน current.md อีกครั้ง แล้ว update date field ใน front matter
  var currentMdContent = fs.readFileSync(currentMdPath, 'utf8');
  var updatedContent   = currentMdContent;

  if (/^date:\s*.+$/m.test(currentMdContent)) {
    // มี date อยู่แล้ว — replace
    updatedContent = currentMdContent.replace(/^date:\s*.+$/m, 'date: ' + NOW.toISOString());
  } else {
    // ยังไม่มี date — เพิ่มหลัง version
    updatedContent = currentMdContent.replace(
      /^(version:\s*.+)$/m,
      '$1\ndate: ' + NOW.toISOString()
    );
  }

  fs.writeFileSync(currentMdPath, updatedContent, 'utf8');
  console.log(`✅  current.md → v${newVersion} (date updated)`);
} else {
  // Legacy: อัพเดท whats-new.json พร้อม date
  var contentToSave = Object.assign({}, currentData, {
    version: newVersion,
    date:    dateObj
  });
  fs.writeFileSync(legacyPath, JSON.stringify(contentToSave, null, 2) + '\n');
  console.log(`✅  whats-new.json → v${newVersion}`);
}

// ── STEP 3: อัพเดท version.json ──────────────────────────────────────────────

fs.mkdirSync(path.dirname(versionPath), { recursive: true });
fs.writeFileSync(versionPath, JSON.stringify({ version: newVersion }, null, 2) + '\n');
console.log(`✅  version.json → ${newVersion}`);

// ── STEP 4: Scan & rewrite HTML (cache busting) ───────────────────────────────

var scanned = 0, updated = 0;
function walk(dir) {
  var entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (var e of entries) {
    if (e.name.startsWith('.') || CONFIG.excludeDirs.has(e.name)) continue;
    var full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (!CONFIG.htmlExts.has(path.extname(e.name).toLowerCase())) continue;
    scanned++;
    var orig = fs.readFileSync(full, 'utf8');
    var next = orig.replace(CONFIG.assetPattern, '$1?v=' + buildId);
    if (next !== orig) {
      fs.writeFileSync(full, next, 'utf8');
      updated++;
      console.log('  ✅  ' + path.relative(ROOT, full));
    }
  }
}
console.log('\nScanning HTML...');
walk(ROOT);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(56));
console.log('  Version:  ' + newVersion);
console.log('  Build ID: ' + buildId);
console.log('  Date:     ' + dateObj.en);
console.log('  Source:   ' + (useMd ? 'Markdown (current.md)' : 'Legacy JSON'));
console.log('  History:  ' + releases.length + '/' + MAX_HISTORY + ' (from git log)');
console.log('  HTML:     ' + updated + '/' + scanned + ' updated');
console.log('─'.repeat(56) + '\n🚀  Ready!\n');