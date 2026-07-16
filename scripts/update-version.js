#!/usr/bin/env node
// scripts/update-version.js — Fantrove Verse Release Tool
// v5.2: AUTO-SNAPSHOT PREVIOUS + STRICT 7-HISTORY LIMIT
//
// v5.2 changes จาก v5.1:
//     - AUTO-SNAPSHOT: ก่อน bump version ใหม่ ระบบจะ snapshot current.md เก่า
//       (จาก git HEAD) เป็น releases/v{prevVersion}.md อัตโนมัติ
//       ทำให้ประวัติย้อนหลังถูกบันทึกโดยอัตโนมัติ ไม่ต้องเขียนเอง
//     - STRICT 7-HISTORY LIMIT: index.json เก็บเฉพาะ 7 versions ล่าสุด (ไม่รวมปัจจุบัน)
//       เก่ากว่านั้นจะถูก prune ออกจาก index.json (แต่ไฟล์ MD ยังอยู่ใน releases/)
//     - DEEP STRICT MODE: นักพัฒนาแตะได้แค่ current.md เท่านั้น — แก้ date หรือ
//       generated artifacts เองไม่มีผล เพราะระบบเขียนทับเสมอ
//
// v5.1: CLOSED SYSTEM + NO APP_VERSION — อ่าน version จาก current.md โดยตรง
// v5.0: CLOSED SYSTEM — ระบบ release notes แบบปิด
//
//     สิ่งที่ script นี้ทำ (ทุกขั้นตอนอัตโนมัติ ไม่ต้อง intervention):
//     1. อ่าน assets/md/{en,th}/current.md (version, title, subtitle, sections)
//     2. [v5.2] AUTO-SNAPSHOT: ถ้า version ใหม่ → อ่าน current.md เก่าจาก git HEAD
//        แล้ว snapshot เป็น releases/v{prevVersion}.md ทั้ง en + th
//     3. ตรวจ version ใน release-dates.json registry:
//        - version ใหม่ → บันทึก NOW เป็น release date ถาวร
//        - version เดิม → คง date เดิม (date ไม่เปลี่ยนแม้แก้เนื้อหา)
//     4. sync date: ใน current.md ให้ตรง registry เสมอ (เขียนทับเสมอ)
//     5. สร้าง assets/md/{en,th}/releases/v{version}.md (เมื่อ version ใหม่)
//     6. สร้าง assets/md/releases/index.json (manifest สำหรับ client)
//        [v5.2] เก็บเฉพาะ 7 versions ล่าสุด ไม่รวม version ปัจจุบัน
//     7. สร้าง assets/json/version.json (runtime metadata)
//     8. บันทึก release-dates.json (registry ที่อัปเดตแล้ว)
//     9. HTML cache busting (?v={version}-{dateStr})
//
// Build: git fetch --unshallow && node scripts/update-version.js
//        (ไม่ต้องส่ง APP_VERSION แล้ว — อ่านจาก current.md โดยตรง)
'use strict';

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_HISTORY = 7;
const LANGS = ['en', 'th']; // ภาษาที่รองรับ

const CONFIG = {
  perLangDir:       'assets/md/{lang}',
  perLangCurrent:   'assets/md/{lang}/current.md',
  perLangReleases:  'assets/md/{lang}/releases',
  // index.json เก็บไว้ที่ root ของ md/ (ฝั่ง client อ่านจาก path เดียวกันทุกภาษา)
  releasesIndexFile: 'assets/md/releases/index.json',
  legacyMdFile:     'assets/md/current.md',
  legacyJsonFile:   'assets/json/whats-new.json',
  // ⚠️ release-history.json ถูกยกเลิกใน v4.1 — ใช้ releases/ folder + index.json แทน
  versionFile:      'assets/json/version.json',
  releaseDatesFile: 'assets/json/release-dates.json',
  excludeDirs:      new Set(['node_modules','.git','scripts','.cloudflare','dist','build']),
  htmlExts:         new Set(['.html','.htm']),
  assetPattern:     /((?:src|href)=["'][^"':]*?\.(?:js|css|json))\?v=[^"'\s&]*/g
};

// v5.1: ลบ APP_VERSION requirement — อ่าน version จาก current.md โดยตรง
// ไม่ต้องส่ง APP_VERSION env var หรือ argument อีกต่อไป

const ROOT = path.resolve(__dirname, '..');
const NOW  = new Date();

const EN_M = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const TH_M = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
function pad2(n) { return String(n).padStart(2, '0'); }
function makeDateObj(d) {
  return {
    en: EN_M[d.getUTCMonth()]+' '+d.getUTCDate()+', '+d.getUTCFullYear()+' at '+pad2(d.getUTCHours())+':'+pad2(d.getUTCMinutes())+' UTC',
    th: d.getUTCDate()+' '+TH_M[d.getUTCMonth()]+' '+(d.getUTCFullYear()+543)+' เวลา '+pad2(d.getUTCHours())+':'+pad2(d.getUTCMinutes())+' UTC'
  };
}

function git(args) {
  const r = spawnSync('git', args, { encoding:'utf8', stdio:['pipe','pipe','pipe'], cwd:ROOT });
  return r.status === 0 ? r.stdout.trim() : null;
}

// ══════════════════════════════════════════════════════════════════════════════
//  MARKDOWN PARSER (single-language mode)
// ══════════════════════════════════════════════════════════════════════════════

function parseMD(mdText, lang) {
  const result = { version:'', date:null, title:null, subtitle:null, notify:true, sections:[] };
  try {
    let body = mdText;
    const fmMatch = mdText.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (fmMatch) {
      body = mdText.substring(fmMatch[0].length);
      const fm = fmMatch[1];
      const vM = fm.match(/^version:\s*(.+)$/m); if(vM) result.version = String(vM[1]).trim();
      const dM = fm.match(/^date:\s*(.+)$/m); if(dM) { const p=Date.parse(String(dM[1]).trim()); if(!isNaN(p)) result.date=new Date(p).toISOString(); }
      const nM = fm.match(/^notify:\s*(false|true)$/m); if(nM) result.notify = nM[1] !== 'false';
      // title — single string (per-language)
      const tL = fm.match(/^title:\s*(.+)$/m);
      if (tL && lang) { result.title = {}; result.title[lang] = String(tL[1]).trim(); }
      // subtitle
      const sL = fm.match(/^subtitle:\s*(.+)$/m);
      if (sL && lang) { result.subtitle = {}; result.subtitle[lang] = String(sL[1]).trim(); }
    }
    const lines = body.split('\n');
    let cs = null, ci = null;
    for (const line of lines) {
      const hm = line.match(/^###\s+(New|Improved|Fixed)\s*$/i);
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
  const item = { title:{}, desc:null };
  const m = line.match(/^\s*-\s+\*\*(.+?)\*\*\s*(.*)?$/);
  if (m) {
    item.title = {}; item.title[lang||'en'] = m[1].trim();
    if (m[2]&&m[2].trim()) { item.desc = {}; item.desc[lang||'en'] = m[2].trim(); }
  }
  return item;
}

// ── Merge 2 per-language releases เป็น i18n combined ─────────────────────────

function mergeReleases(langReleases) {
  // langReleases = { en: parsedRelease, th: parsedRelease, ... }
  // Returns a single combined release with i18n objects
  const versions = new Set();
  const entries = {};

  for (const lang of LANGS) {
    const r = langReleases[lang];
    if (!r || !r.version) continue;
    versions.add(r.version);

    if (!entries[r.version]) {
      entries[r.version] = {
        version: r.version,
        date: r.date || null,
        title: {},
        subtitle: {},
        notify: r.notify,
        sections: []
      };
    }

    const entry = entries[r.version];

    // Merge title
    if (r.title && typeof r.title === 'object') {
      for (const k of Object.keys(r.title)) entry.title[k] = r.title[k];
    }

    // Merge subtitle
    if (r.subtitle && typeof r.subtitle === 'object') {
      for (const k of Object.keys(r.subtitle)) entry.subtitle[k] = r.subtitle[k];
    }

    // Merge sections + items
    // สำหรับแต่ละภาษา อาจมี sections ไม่เหมือนกัน — merge ตาม type
    if (r.sections && r.sections.length) {
      if (!entry.sections.length) {
        // ภาษาแรก — ใช้เป็น base
        entry.sections = r.sections.map(s => ({
          type: s.type,
          items: s.items.map(item => ({
            title: Object.assign({}, item.title),
            desc: item.desc ? Object.assign({}, item.desc) : null
          }))
        }));
      } else {
        // ภาษาต่อไป — merge items เข้า sections ที่มี type เดียวกัน
        r.sections.forEach(s => {
          let existing = entry.sections.find(es => es.type === s.type);
          if (!existing) {
            existing = { type: s.type, items: [] };
            entry.sections.push(existing);
          }
          s.items.forEach(item => {
            // หา item ที่ตรงกัน (เทียบ title ภาษาแรกที่มี)
            let matchIdx = -1;
            const itemTitle = item.title[lang] || '';
            for (let i = 0; i < existing.items.length; i++) {
              if (existing.items[i].title[lang]) {
                // ถ้าภาษานี้มีอยู่แล้ว skip
              }
              // เปรียบเทียบกับภาษาอื่น
              const otherLang = LANGS.find(l => l !== lang && existing.items[i].title[l]);
              if (otherLang && item.title[otherLang] === existing.items[i].title[otherLang]) {
                matchIdx = i; break;
              }
            }
            if (matchIdx >= 0) {
              // Merge เข้า item ที่มี
              for (const k of Object.keys(item.title)) existing.items[matchIdx].title[k] = item.title[k];
              if (item.desc) {
                if (!existing.items[matchIdx].desc) existing.items[matchIdx].desc = {};
                for (const k of Object.keys(item.desc)) existing.items[matchIdx].desc[k] = item.desc[k];
              }
            } else {
              // เพิ่ม item ใหม่
              existing.items.push({
                title: Object.assign({}, item.title),
                desc: item.desc ? Object.assign({}, item.desc) : null
              });
            }
          });
        });
      }
    }
  }

  return entries;
}

// ── อ่านไฟล์ ──────────────────────────────────────────────────────────────────

const releasesIndexPath = path.join(ROOT, CONFIG.releasesIndexFile);
const versionPath       = path.join(ROOT, CONFIG.versionFile);
const releaseDatesPath  = path.join(ROOT, CONFIG.releaseDatesFile);

// ── Release Dates Registry ──────────────────────────────────────────────────────
//  registry ของ "วันที่ build ครั้งแรกของแต่ละ version" — เป็น source of truth
//  สำหรับ release date เพื่อกัน date เปลี่ยนเมื่ออัปเดทเนื้อหาแต่ version เดิม
//  โครงสร้าง: { versions: { "1.8.0": "2026-06-20T00:00:00.000Z", ... } }
//
//  กฎเหล็ก (AI_FORBIDDEN.md section 9.2): ห้ามแก้ไฟล์นี้เอง — build script ดูแลเอง

function loadReleaseDates() {
  try {
    if (!fs.existsSync(releaseDatesPath)) return { versions: {} };
    var data = JSON.parse(fs.readFileSync(releaseDatesPath, 'utf8'));
    if (!data || typeof data !== 'object') return { versions: {} };
    if (!data.versions || typeof data.versions !== 'object') data.versions = {};
    return data;
  } catch (e) {
    console.warn('[update-version] release-dates.json parse error:', e.message);
    return { versions: {} };
  }
}

function saveReleaseDates(registry) {
  fs.mkdirSync(path.dirname(releaseDatesPath), { recursive: true });
  // sort keys ตาม semver เพื่อให้อ่านง่าย
  var sorted = {};
  Object.keys(registry.versions).sort(compareSemver).forEach(function (v) {
    sorted[v] = registry.versions[v];
  });
  var out = { versions: sorted, updatedAt: NOW.toISOString() };
  fs.writeFileSync(releaseDatesPath, JSON.stringify(out, null, 2) + '\n');
}

function compareSemver(a, b) {
  var pa = String(a || '0').split(/[.+-]/).map(function (n) { return parseInt(n, 10) || 0; });
  var pb = String(b || '0').split(/[.+-]/).map(function (n) { return parseInt(n, 10) || 0; });
  var len = Math.max(pa.length, pb.length);
  for (var i = 0; i < len; i++) { var na = pa[i] || 0, nb = pb[i] || 0; if (na !== nb) return na - nb; }
  return 0;
}

// ── v5.0: CLOSED SYSTEM — ตรวจ source files ─────────────────────────────────
// นักพัฒนาเขียน/แก้ได้แค่ assets/md/{en,th}/current.md เท่านั้น
// ถ้าหาไม่ได้ → fail ทันที (ไม่มี legacy fallback แล้ว)

let usePerLang = false;
// v5.1: ไม่ใช้ APP_VERSION แล้ว — อ่าน version จาก current.md โดยตรง
let newVersion = null;

for (const lang of LANGS) {
  const p = path.join(ROOT, CONFIG.perLangCurrent.replace('{lang}', lang));
  if (fs.existsSync(p)) { usePerLang = true; break; }
}

if (!usePerLang) {
  console.error('\n  ❌  CLOSED SYSTEM: ไม่พบ assets/md/{en,th}/current.md');
  console.error('      ระบบ release notes ต้องการไฟล์ current.md อย่างน้อย 1 ภาษา');
  console.error('      นักพัฒนาเขียน/แก้ได้เฉพาะไฟล์นี้เท่านั้น — ไม่มี legacy fallback\n');
  process.exit(1);
}

// ตรวจว่ามี legacy ไฟล์ค้างอยู่ไหม — เตือนให้ลบ
const legacyFiles = [
  CONFIG.legacyMdFile,        // assets/md/current.md (single-file legacy)
  CONFIG.legacyJsonFile,      // assets/json/whats-new.json
  'assets/json/release-history.json',  // deprecated
];
for (const lf of legacyFiles) {
  const lp = path.join(ROOT, lf);
  if (fs.existsSync(lp)) {
    console.warn('  ⚠️  พบ legacy file: ' + lf + ' — ควรลบออก (ระบบปิดไม่ใช้แล้ว)');
  }
}

// v5.1: อ่าน version จาก per-language file (source of truth)
// ไม่ต้องส่ง APP_VERSION แล้ว — version มาจาก current.md โดยตรง
for (const lang of LANGS) {
  const p = path.join(ROOT, CONFIG.perLangCurrent.replace('{lang}', lang));
  if (fs.existsSync(p)) {
    const parsed = parseMD(fs.readFileSync(p, 'utf8'), lang);
    if (parsed.version) { newVersion = parsed.version; break; }
  }
}

// v5.1: ตรวจว่าอ่าน version ได้หรือไม่
if (!newVersion) {
  console.error('\n  ❌  ไม่พบ version ใน assets/md/{en,th}/current.md');
  console.error('      กรุณาเพิ่ม version: X.Y.Z ใน frontmatter ของ current.md\n');
  process.exit(1);
}

// v5.1: ตรวจ semver format
if (!/^\d+\.\d+\.\d+/.test(newVersion)) {
  console.error(`\n  ❌  "${newVersion}" ไม่ใช่ semver ที่ถูกต้อง\n`);
  process.exit(1);
}

const dateObj = makeDateObj(NOW);
const dateStr = NOW.toISOString().slice(0,10).replace(/-/g,'');
const timeStr = pad2(NOW.getUTCHours()) + pad2(NOW.getUTCMinutes());
const buildId = `${newVersion}-${dateStr}${timeStr}`;

console.log(`\n📦  Fantrove Release Tool v5.2 (AUTO-SNAPSHOT + STRICT 7-HISTORY LIMIT)`);
console.log(`    Version:  ${newVersion} (อ่านจาก current.md โดยตรง)`);
console.log(`    Build ID: ${buildId}`);
console.log(`    Date:     ${dateObj.en}`);
console.log(`    Source:   Per-language MD (assets/md/{en,th}/current.md)\n`);

// ── STEP 0: โหลด release-dates registry (source of truth ของ release date) ────────
//  จะใช้ registry นี้เป็น source of truth สำหรับ "วันที่ build ครั้งแรกของแต่ละ version"
//  ถ้า version มีอยู่แล้วใน registry → ใช้ date เดิม (ไม่เปลี่ยน)
//  ถ้า version ใหม่ → ใช้ NOW (เวลา ณ ตอน build ครั้งแรกของ version นี้)
//
//  ⚠️ ผู้ใช้ไม่ควรเขียน date: ใน current.md เอง — ระบบจะใช้เวลา ณ ตอน build แทน
//     ถ้ามี date: อยู่ใน current.md ระบบจะ sync กลับเป็นค่าจาก registry (หรือ NOW ถ้าเป็น version ใหม่)
//     ทำให้วันที่ที่ผู้ใช้เห็นสะท้อนเวลาที่ build จริง ไม่ใช่เวลาที่ผู้ใช้เขียนมั่วๆ

console.log('📋  Loading release-dates registry...');
var releaseDatesRegistry = loadReleaseDates();
var registryVersions = Object.keys(releaseDatesRegistry.versions || {});
console.log(`    มี ${registryVersions.length} version(s) ใน registry: [${registryVersions.join(', ')}]`);

// กำหนด release date ของ version ปัจจุบัน
//  priority: registry > NOW (ไม่อ่าน date: จาก current.md เพราะผู้ใช้เขียนเองไม่น่าเชื่อถือ)
//  - ถ้า version มีอยู่แล้ว → ใช้ date เดิม (stable)
//  - ถ้า version ใหม่ → ใช้ NOW (เป็น "วันที่ build ครั้งแรกของ version นี้" ถาวร)
var isNewVersion = !releaseDatesRegistry.versions[newVersion];
var currentReleaseDateISO;
if (isNewVersion) {
  currentReleaseDateISO = NOW.toISOString();
  releaseDatesRegistry.versions[newVersion] = currentReleaseDateISO;
  console.log(`    ✨  Version ใหม่ "${newVersion}" → บันทึก release date จาก NOW: ${currentReleaseDateISO}`);
} else {
  currentReleaseDateISO = releaseDatesRegistry.versions[newVersion];
  console.log(`    ♻️  Version "${newVersion}" มีอยู่แล้ว → คง release date เดิม: ${currentReleaseDateISO}`);
}
var currentReleaseDate = new Date(currentReleaseDateISO);

// ── STEP 1: สร้าง history จาก git log ─────────────────────────────────────────

console.log('📚  Building history from git log...');

// รวบรวมไฟล์ที่ต้อง track — v5.0: เฉพาะ per-language MD เท่านั้น
var trackFiles = [];
for (const lang of LANGS) {
  trackFiles.push(CONFIG.perLangCurrent.replace('{lang}', lang));
  const relDir = path.join(ROOT, CONFIG.perLangReleases.replace('{lang}', lang));
  if (fs.existsSync(relDir)) {
    fs.readdirSync(relDir).filter(f => f.endsWith('.md')).forEach(f => {
      trackFiles.push(CONFIG.perLangReleases.replace('{lang}', lang) + '/' + f);
    });
  }
}

// git log
var allCommits = {};
trackFiles.forEach(function(filePath) {
  var log = git(['log', '--format=%H %ct', '--', filePath]);
  if (!log) return;
  log.split('\n').filter(Boolean).forEach(function(line) {
    var parts = line.split(' ');
    var hash = parts[0], ts = parseInt(parts[1], 10) * 1000;
    if (!allCommits[hash]) allCommits[hash] = { hash: hash, ts: ts, files: [] };
    allCommits[hash].files.push(filePath);
  });
});

var commits = Object.values(allCommits).sort(function(a,b) { return a.ts - b.ts; });
console.log(`    พบ ${commits.length} unique commit(s)`);

var seenVersions = new Set(); // v4: ไม่ skip version ปัจจุบัน เพราะต้องการให้มันปรากฏใน history ด้วย
var releases = [];

for (var i = 0; i < commits.length; i++) {
  var commit = commits[i];
  var versionFound = null;
  var combinedData = null;

  // v5.0: อ่านทุกภาษาจาก commit นี้ แล้ว merge — ไม่มี legacy fallback แล้ว
  var langReleases = {};
  var hasAny = false;
  for (var li = 0; li < LANGS.length; li++) {
    var lang = LANGS[li];
    // ลอง current.md
    var content = git(['show', commit.hash + ':' + CONFIG.perLangCurrent.replace('{lang}', lang)]);
    if (!content) {
      // ลอง releases/*.md
      commit.files.forEach(function(fp) {
        if (fp.indexOf(CONFIG.perLangReleases.replace('{lang}', lang) + '/') === 0 && fp.endsWith('.md')) {
          if (!content) content = git(['show', commit.hash + ':' + fp]);
        }
      });
    }
    if (content) {
      langReleases[lang] = parseMD(content, lang);
      if (langReleases[lang].version) hasAny = true;
    }
  }
  if (hasAny) {
    var merged = mergeReleases(langReleases);
    var versions = Object.keys(merged);
    for (var vi = 0; vi < versions.length; vi++) {
      var ver = versions[vi];
      if (!seenVersions.has(ver)) {
        versionFound = ver;
        combinedData = merged[ver];
        break;
      }
    }
  }

  if (combinedData && versionFound) {
    seenVersions.add(versionFound);

    // v4: release date มาจาก release-dates registry (source of truth)
    //  ถ้าไม่มีใน registry → ใช้ commit.ts ของ commit แรกที่เห็น version นั้น
    //  (commit นี้คือ commit แรกเพราะ walk จากเก่า → ใหม่ และ seenVersions กันซ้ำ)
    //  แล้วบันทึกลง registry เพื่อใช้ในครั้งต่อไป
    var releaseDateISO = releaseDatesRegistry.versions[versionFound];
    if (!releaseDateISO) {
      var fallbackDate = new Date(commit.ts || Date.now());
      releaseDateISO = fallbackDate.toISOString();
      releaseDatesRegistry.versions[versionFound] = releaseDateISO;
      console.log(`    📌  Backfill registry: "${versionFound}" → ${releaseDateISO} (from commit ${commit.hash.slice(0,7)})`);
    }
    var relDateObj = new Date(releaseDateISO);
    var relDate = makeDateObj(relDateObj);

    releases.push({
      version: versionFound,
      date: relDate,
      title: combinedData.title || { en: 'System update', th: 'อัปเดตระบบ' },
      subtitle: combinedData.subtitle || { en: 'Minor improvements.', th: 'ปรับปรุงเล็กน้อย' },
      sections: combinedData.sections || []
    });

    if (releases.length >= MAX_HISTORY) break;
  }
}

// v4: ตรวจดูว่า version ปัจจุบันอยู่ใน releases หรือยัง
//  ถ้าไม่อยู่ (เช่น ยังไม่มี commit ของ version ใหม่) → เพิ่มจาก source file ปัจจุบัน
var hasCurrentVersion = releases.some(function (r) { return r.version === newVersion; });
if (!hasCurrentVersion) {
  var currentData = null;
  // v5.0: ใช้ per-language MD เท่านั้น — ไม่มี legacy fallback
  var langReleasesCur = {};
  for (var li2 = 0; li2 < LANGS.length; li2++) {
    var lang2 = LANGS[li2];
    var fp2 = path.join(ROOT, CONFIG.perLangCurrent.replace('{lang}', lang2));
    if (fs.existsSync(fp2)) {
      langReleasesCur[lang2] = parseMD(fs.readFileSync(fp2, 'utf8'), lang2);
    }
  }
  var mergedCur = mergeReleases(langReleasesCur);
  if (mergedCur[newVersion]) currentData = mergedCur[newVersion];
  if (currentData) {
    releases.push({
      version: newVersion,
      date: makeDateObj(currentReleaseDate),
      title: currentData.title || { en: 'System update', th: 'อัปเดตระบบ' },
      subtitle: currentData.subtitle || { en: 'Minor improvements.', th: 'ปรับปรุงเล็กน้อย' },
      sections: currentData.sections || []
    });
    console.log(`    ✨  เพิ่ม version ปัจจุบัน "${newVersion}" เข้า history (ยังไม่มี commit)`);
  }
}

releases.sort(function (a, b) {
  // เรียงจากใหม่ → เก่า โดยใช้ release date จาก registry
  var aISO = releaseDatesRegistry.versions[a.version] || '';
  var bISO = releaseDatesRegistry.versions[b.version] || '';
  if (aISO && bISO) return bISO.localeCompare(aISO);
  return compareSemver(b.version, a.version);
});
if (releases.length > MAX_HISTORY) releases = releases.slice(0, MAX_HISTORY);

// ── STEP 1.6.5: [v5.2] AUTO-SNAPSHOT PREVIOUS VERSION ──────────────────────────
//  ก่อน bump version ใหม่ ระบบจะ snapshot current.md เก่า (จาก git HEAD) เป็น
//  releases/v{prevVersion}.md อัตโนมัติ ทำให้ประวัติย้อนหลังถูกบันทึกโดยอัตโนมัติ
//
//  WHY: ก่อนหน้านี้ ถ้านักพัฒนาแก้ current.md เป็น version ใหม่ แล้ว commit + push
//       โดยไม่ได้สร้าง releases/v{prevVersion}.md เอง ประวัติของ version เก่าจะหายไป
//       (current.md ถูกเขียนทับด้วย version ใหม่)
//
//  v5.2 fix: ระบบอ่าน current.md เก่าจาก git HEAD ก่อน แล้ว snapshot เป็น
//            releases/v{prevVersion}.md อัตโนมัติ ไม่ต้องเขียนเอง
//
//  เงื่อนไข:
//   - ทำงานเฉพาะเมื่อ isNewVersion = true (มีการ bump version ใหม่)
//   - ถ้ายังไม่มี releases/v{prevVersion}.md อยู่ → สร้างใหม่
//   - ถ้ามีอยู่แล้ว → skip (ไม่เขียนทับ)
//   - ใช้ git show HEAD:path เพื่ออ่าน current.md เก่า (ก่อน commit ปัจจุบัน)

if (isNewVersion) {
  // อ่าน version เก่าจาก git HEAD (current.md ก่อนที่นักพัฒนาจะแก้)
  var prevVersion = null;
  for (var pl = 0; pl < LANGS.length; pl++) {
    var prevLang = LANGS[pl];
    var prevContent = git(['show', 'HEAD:' + CONFIG.perLangCurrent.replace('{lang}', prevLang)]);
    if (prevContent) {
      var prevMatch = prevContent.match(/^version:\s*(.+)$/m);
      if (prevMatch) {
        prevVersion = prevMatch[1].trim();
        break;
      }
    }
  }

  if (prevVersion && prevVersion !== newVersion) {
    console.log(`📸  v5.2 AUTO-SNAPSHOT: บันทึก current.md เก่า (v${prevVersion}) เป็น releases/v${prevVersion}.md`);

    var prevReleaseDateISO = releaseDatesRegistry.versions[prevVersion];
    if (!prevReleaseDateISO) {
      // ถ้ายังไม่มีใน registry → ใช้ commit time ของ HEAD
      var headCommitTime = git(['log', '-1', '--format=%ct', 'HEAD']);
      if (headCommitTime) {
        prevReleaseDateISO = new Date(parseInt(headCommitTime, 10) * 1000).toISOString();
      } else {
        prevReleaseDateISO = NOW.toISOString();
      }
      releaseDatesRegistry.versions[prevVersion] = prevReleaseDateISO;
      console.log(`    📌  Backfill registry จาก HEAD: "${prevVersion}" → ${prevReleaseDateISO}`);
    }

    for (var sl = 0; sl < LANGS.length; sl++) {
      var snapLang = LANGS[sl];
      var snapSrcContent = git(['show', 'HEAD:' + CONFIG.perLangCurrent.replace('{lang}', snapLang)]);
      if (snapSrcContent) {
        var snapRelDir = path.join(ROOT, CONFIG.perLangReleases.replace('{lang}', snapLang));
        var snapDestPath = path.join(snapRelDir, 'v' + prevVersion + '.md');

        // ถ้ายังไม่มีไฟล์ → สร้างใหม่ (ถ้ามีแล้วไม่เขียนทับ เพื่อ preserve integrity)
        if (!fs.existsSync(snapDestPath)) {
          fs.mkdirSync(snapRelDir, { recursive: true });

          // sync date ใน content ที่จะ snapshot
          var snapContent = snapSrcContent;
          if (/^date:\s*.+$/m.test(snapContent)) {
            snapContent = snapContent.replace(/^date:\s*.+$/m, 'date: ' + prevReleaseDateISO);
          } else {
            snapContent = snapContent.replace(/^(version:\s*.+)$/m, '$1\ndate: ' + prevReleaseDateISO);
          }

          fs.writeFileSync(snapDestPath, snapContent, 'utf8');
          console.log(`✅  ${CONFIG.perLangReleases.replace('{lang}', snapLang)}/v${prevVersion}.md → AUTO-SNAPSHOT สร้างใหม่`);
        } else {
          console.log(`⏭️   ${CONFIG.perLangReleases.replace('{lang}', snapLang)}/v${prevVersion}.md → มีอยู่แล้ว (skip)`);
        }
      }
    }
  } else if (!prevVersion) {
    console.log(`ℹ️  v5.2 AUTO-SNAPSHOT: ไม่พบ version เก่าใน git HEAD (อาจเป็น commit แรก) — skip`);
  } else {
    console.log(`ℹ️  v5.2 AUTO-SNAPSHOT: version เก่า (${prevVersion}) เท่ากับ version ใหม่ (${newVersion}) — skip`);
  }
}

// ── STEP 1.7: สร้าง releases/v{version}.md สำหรับ version ปัจจุบัน (เมื่อ version ใหม่) ──
//  v4.1: ยกเลิก release-history.json ใช้ releases/ folder + index.json แทน
//  - ถ้าเป็น version ใหม่ → copy current.md (ที่มี date แล้ว) ไป releases/v{version}.md
//  - ถ้าเป็น version เดิม → ไม่ต้องสร้างไฟล์ใหม่ (ไฟล์เก่ายังอยู่)
//  - ไฟล์ releases/v{version}.md เป็น source ของรายละเอียด release notes สำหรับ version นั้น
//  - client (new.js) อ่าน releases/index.json เพื่อรู้ว่ามีกี่ version แล้ว fetch ไฟล์ markdown แต่ละ version

// v5.0: usePerLang เป็น always true แล้ว — ไม่ต้องเช็ค
if (isNewVersion) {
  for (const lang of LANGS) {
    var srcPath = path.join(ROOT, CONFIG.perLangCurrent.replace('{lang}', lang));
    var relDir = path.join(ROOT, CONFIG.perLangReleases.replace('{lang}', lang));
    var destPath = path.join(relDir, 'v' + newVersion + '.md');
    if (fs.existsSync(srcPath)) {
      fs.mkdirSync(relDir, { recursive: true });
      // อ่าน current.md แล้ว sync date ใน content ที่จะ copy
      var srcContent = fs.readFileSync(srcPath, 'utf8');
      if (/^date:\s*.+$/m.test(srcContent)) {
        srcContent = srcContent.replace(/^date:\s*.+$/m, 'date: ' + currentReleaseDateISO);
      } else {
        srcContent = srcContent.replace(/^(version:\s*.+)$/m, '$1\ndate: ' + currentReleaseDateISO);
      }
      fs.writeFileSync(destPath, srcContent, 'utf8');
      console.log(`✅  ${CONFIG.perLangReleases.replace('{lang}', lang)}/v${newVersion}.md → สร้างใหม่`);
    }
  }
}

// ── STEP 1.8: สร้าง releases/index.json (manifest สำหรับ client อ่าน) ──────────
//  index.json เก็บ list ของทุก version + date + hasDetails (ว่ามีไฟล์ markdown หรือไม่)
//  client (new.js) อ่าน index.json แล้ว fetch ไฟล์ markdown สำหรับแต่ละ version
//
//  v4.1: นอกจาก registry แล้ว ยังสแกนไฟล์ใน releases/ เพื่อหา version เก่าที่มีไฟล์
//  แต่ไม่ได้อยู่ใน registry (เช่น v1.0.8, v1.3.0 ที่สร้างไว้ก่อน) แล้ว backfill registry ด้วย
//  date จากไฟล์ markdown เอง (ถ้ามี) หรือใช้ NOW

// v5.0: usePerLang เป็น always true แล้ว — ไม่ต้องเช็ค
for (var li3 = 0; li3 < LANGS.length; li3++) {
  var lang3 = LANGS[li3];
  var scanDir = path.join(ROOT, CONFIG.perLangReleases.replace('{lang}', lang3));
  if (fs.existsSync(scanDir)) {
    var mdFiles = fs.readdirSync(scanDir).filter(function (f) { return f.endsWith('.md'); });
    for (var mi = 0; mi < mdFiles.length; mi++) {
      // ดึง version จากชื่อไฟล์ (เช่น "v1.3.0.md" → "1.3.0", "v.1.0.8.md" → "1.0.8")
      var verFromFile = mdFiles[mi].replace(/^v?\.?/, '').replace(/\.md$/, '');
      if (!releaseDatesRegistry.versions[verFromFile]) {
        // ไม่มีใน registry → อ่าน date จากไฟล์ markdown
        var mdPath = path.join(scanDir, mdFiles[mi]);
        try {
          var mdContent3 = fs.readFileSync(mdPath, 'utf8');
          var dM3 = mdContent3.match(/^date:\s*(.+)$/m);
          var parsedDate3 = dM3 ? Date.parse(dM3[1].trim()) : NaN;
          var iso3 = !isNaN(parsedDate3) ? new Date(parsedDate3).toISOString() : NOW.toISOString();
          releaseDatesRegistry.versions[verFromFile] = iso3;
          console.log(`    📌  Backfill registry จากไฟล์: "${verFromFile}" → ${iso3} (from ${mdFiles[mi]})`);
        } catch (_) {
          releaseDatesRegistry.versions[verFromFile] = NOW.toISOString();
          console.log(`    📌  Backfill registry จากไฟล์: "${verFromFile}" → ${NOW.toISOString()} (NOW, อ่าน date ไม่ได้)`);
        }
      }
    }
  }
}

var indexEntries = [];
var allVersions = Object.keys(releaseDatesRegistry.versions).sort(function (a, b) {
  // เรียงจากใหม่ → เก่า ตาม date ใน registry
  var aISO = releaseDatesRegistry.versions[a] || '';
  var bISO = releaseDatesRegistry.versions[b] || '';
  if (aISO && bISO) return bISO.localeCompare(aISO);
  return compareSemver(b, a);
});

// สร้าง index entries พร้อมตรวจสอบ hasDetails
// v5.0: ใช้ per-lang MD เท่านั้น — ตรวจไฟล์ใน releases/{lang}/v{version}.md ทุกภาษา
for (var ai = 0; ai < allVersions.length; ai++) {
  var v = allVersions[ai];
  var vDate = releaseDatesRegistry.versions[v];
  var hasDetails = true;
  for (var hi = 0; hi < LANGS.length; hi++) {
    var checkPath = path.join(ROOT, CONFIG.perLangReleases.replace('{lang}', LANGS[hi]), 'v' + v + '.md');
    if (!fs.existsSync(checkPath)) { hasDetails = false; break; }
  }
  indexEntries.push({ version: v, date: vDate, hasDetails: hasDetails });
}

// v5.2 STRICT 7-HISTORY LIMIT — เก็บเฉพาะ 7 versions ล่าสุด ไม่รวม version ปัจจุบัน
// WHY: ก่อนหน้านี้ index.json เก็บ MAX_HISTORY=7 รวม version ปัจจุบัน ทำให้เห็น
//      แค่ 6 ประวัติย้อนหลัง + 1 ปัจจุบัน ผู้ใช้ต้องการ 7 ประวัติย้อนหลังจริงๆ
//      (ไม่รวม version ปัจจุบันที่แสดงแยกในหน้า What's New)
//
// วิธี:
//   1. กรอง version ปัจจุบัน (newVersion) ออกจาก indexEntries — ปัจจุบันแสดงแยกใน current.md
//   2. ให้ priority กับ version ที่มีไฟล์ markdown (hasDetails: true) ก่อน
//   3. เลือก MAX_HISTORY ล่าสุด (7 ประวัติ)
//   4. re-sort ตาม date (ใหม่ → เก่า)
//
// หมายเหตุ: ไฟล์ releases/v{oldVersion}.md ของ version เก่ากว่า 7 ล่าสุดยังอยู่ใน
//           releases/ folder — แค่ไม่ปรากฏใน index.json อีก เพื่อ limit ขนาด manifest

// v5.2: กรอง version ปัจจุบันออกจาก indexEntries
var indexEntriesFiltered = indexEntries.filter(function (e) {
  return e.version !== newVersion;
});

var withDetails = indexEntriesFiltered.filter(function (e) { return e.hasDetails; });
var withoutDetails = indexEntriesFiltered.filter(function (e) { return !e.hasDetails; });

// v5.2: ให้ priority กับ hasDetails=true ก่อน (ตามลำดับเวลา ใหม่ → เก่า)
// ถ้า hasDetails=true มากกว่า MAX_HISTORY → เอา MAX_HISTORY ล่าสุด
// ถ้า hasDetails=true น้อยกว่า MAX_HISTORY → เติม hasDetails=false จนครบ MAX_HISTORY
if (withDetails.length >= MAX_HISTORY) {
  indexEntries = withDetails.slice(0, MAX_HISTORY);
} else {
  var remaining = MAX_HISTORY - withDetails.length;
  indexEntries = withDetails.concat(withoutDetails.slice(0, remaining));
}

// re-sort ตาม date (ใหม่ → เก่า) หลังจาก concat
indexEntries.sort(function (a, b) {
  var aISO = a.date || '';
  var bISO = b.date || '';
  if (aISO && bISO) return bISO.localeCompare(aISO);
  return compareSemver(b.version, a.version);
});

// v5.2: ตัดให้เหลือ MAX_HISTORY หลัง re-sort (กันกรณี edge case)
if (indexEntries.length > MAX_HISTORY) {
  indexEntries = indexEntries.slice(0, MAX_HISTORY);
}

fs.mkdirSync(path.dirname(releasesIndexPath), { recursive: true });
fs.writeFileSync(releasesIndexPath, JSON.stringify({
  versions: indexEntries,
  updatedAt: NOW.toISOString()
}, null, 2) + '\n');
console.log(`✅  releases/index.json: ${indexEntries.length}/${MAX_HISTORY} versions [${indexEntries.map(function(e){return e.version + (e.hasDetails ? '' : ' (no-file)');}).join(', ')}]`);

// ── STEP 2: อัพเดท source files ────────────────────────────────────────────
//  v5.0 CLOSED SYSTEM: sync date ใน current.md ให้ตรง registry เสมอ
//  - นักพัฒนาไม่ควรเขียน date: ใน current.md เอง — ระบบเขียนทับด้วยค่าจาก registry
//  - ถ้า version ใหม่ → เขียน date = NOW (ที่บันทึกใน registry ใน STEP 0)
//  - ถ้า version เดิม → เขียน date = registry date (คงเดิม)
//  - ถ้า date ใน current.md ตรง registry แล้ว → skip ไม่เขียน (ประหยัด I/O)
//
//  เหตุผล: นักพัฒนาอาจเขียน date: มั่วๆ ใน current.md ซึ่งไม่ตรงกับเวลาที่ build จริง
//         ระบบจะ sync กลับเป็นค่าจาก registry ทุกครั้ง เพื่อให้ date สะท้อนเวลาจริง

for (const lang of LANGS) {
  var fp = path.join(ROOT, CONFIG.perLangCurrent.replace('{lang}', lang));
  if (fs.existsSync(fp)) {
    var content = fs.readFileSync(fp, 'utf8');
    var existingDateMatch = content.match(/^date:\s*(.+)$/m);
    var existingDate = existingDateMatch ? existingDateMatch[1].trim() : null;
    if (existingDate !== currentReleaseDateISO) {
      // date ไม่ตรง registry → เขียนทับ (หรือเพิ่มใหม่ถ้ายังไม่มี)
      if (/^date:\s*.+$/m.test(content)) {
        content = content.replace(/^date:\s*.+$/m, 'date: ' + currentReleaseDateISO);
      } else {
        content = content.replace(/^(version:\s*.+)$/m, '$1\ndate: ' + currentReleaseDateISO);
      }
      fs.writeFileSync(fp, content, 'utf8');
      console.log(`✅  ${CONFIG.perLangCurrent.replace('{lang}', lang)} → date = ${currentReleaseDateISO}` + (isNewVersion ? ' (version ใหม่)' : ' (sync กับ registry)'));
    } else {
      console.log(`⏭️   ${CONFIG.perLangCurrent.replace('{lang}', lang)} → date ถูกต้องแล้ว (${currentReleaseDateISO})`);
    }
  }
}

// ── STEP 3: version.json ─────────────────────────────────────────────────────

fs.mkdirSync(path.dirname(versionPath), { recursive: true });
// v4: เพิ่ม date ที่เป็น ISO string จาก registry (stable — ไม่เปลี่ยนถ้า version เดิม)
fs.writeFileSync(versionPath, JSON.stringify({
  version: newVersion,
  date: currentReleaseDateISO
}, null, 2) + '\n');
console.log(`✅  version.json → ${newVersion} (date: ${currentReleaseDateISO})`);

// ── STEP 3.5: บันทึก release-dates registry ──────────────────────────────────
//  เขียน release-dates.json ที่อัปเดตแล้วกลับลงดิสก์
//  registry นี้เป็น source of truth ของ "วันที่ build ครั้งแรกของแต่ละ version"
//  ห้ามแก้ไฟล์นี้เอง — ดู AI_FORBIDDEN.md section 9.2

saveReleaseDates(releaseDatesRegistry);
console.log(`✅  release-dates.json → ${Object.keys(releaseDatesRegistry.versions).length} version(s)`);

// ── STEP 4: HTML cache busting ────────────────────────────────────────────────

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

console.log('\n' + '─'.repeat(56));
console.log('  Version:  ' + newVersion + (isNewVersion ? ' (NEW)' : ' (same)'));
console.log('  Build ID: ' + buildId);
console.log('  Release:  ' + currentReleaseDateISO + (isNewVersion ? ' — บันทึกใหม่' : ' — คงเดิมจาก registry'));
console.log('  Source:   Per-language MD (closed system v5.2 — auto-snapshot + 7-history)');
console.log('  History:  ' + releases.length + '/' + MAX_HISTORY);
console.log('  HTML:     ' + updated + '/' + scanned + ' updated');
console.log('─'.repeat(56) + '\n🚀  Ready!\n');