#!/usr/bin/env node
// scripts/update-version.js — Fantrove Verse Release Tool
// v4: Per-language Markdown — อ่าน {lang}/current.md จาก git history
//     รวมทุกภาษาเป็น release-history.json (i18n combined)
//     รองรับ legacy: current.md เดียว, whats-new.json
//
//     v4 ใหม่: บันทึก release date ครั้งแรกของแต่ละ version เท่านั้น
//     - ใช้ assets/json/release-dates.json เป็น registry ของ "วันที่ build ครั้งแรก"
//     - ถ้าอัปเดทเนื้อหาแต่ version เดิม → ไม่เปลี่ยน date, ไม่สร้าง record ใหม่
//     - ถ้าเปลี่ยน version → บันทึก date ปัจจุบันเป็น release date ถาวร
//
// Build: git fetch --unshallow && APP_VERSION=1.5.0 node scripts/update-version.js
'use strict';

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_HISTORY = 7;
const LANGS = ['en', 'th']; // ภาษาที่รองรับ

const CONFIG = {
  perLangDir:     'assets/md/{lang}',
  perLangCurrent: 'assets/md/{lang}/current.md',
  perLangReleases:'assets/md/{lang}/releases',
  legacyMdFile:   'assets/md/current.md',
  legacyJsonFile: 'assets/json/whats-new.json',
  historyFile:    'assets/json/release-history.json',
  versionFile:    'assets/json/version.json',
  releaseDatesFile: 'assets/json/release-dates.json',
  excludeDirs:    new Set(['node_modules','.git','scripts','.cloudflare','dist','build']),
  htmlExts:       new Set(['.html','.htm']),
  assetPattern:   /((?:src|href)=["'][^"':]*?\.(?:js|css|json))\?v=[^"'\s&]*/g
};

const APP_VERSION = process.env.APP_VERSION || process.argv[2];
if (!APP_VERSION) { console.error('\n  ❌  ไม่พบ APP_VERSION\n'); process.exit(1); }
if (!/^\d+\.\d+\.\d+/.test(APP_VERSION)) { console.error(`\n  ❌  "${APP_VERSION}" ไม่ใช่ semver\n`); process.exit(1); }

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

const historyPath       = path.join(ROOT, CONFIG.historyFile);
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

// ตรวจสอบว่าใช้ระบบไหน
let usePerLang = false;
let useLegacyMd = false;
let useLegacyJson = false;
let newVersion = APP_VERSION;

// ลอง per-language files
for (const lang of LANGS) {
  const p = path.join(ROOT, CONFIG.perLangCurrent.replace('{lang}', lang));
  if (fs.existsSync(p)) { usePerLang = true; break; }
}

// Fallback: legacy single-file MD
if (!usePerLang) {
  const lp = path.join(ROOT, CONFIG.legacyMdFile);
  if (fs.existsSync(lp)) useLegacyMd = true;
}

// Fallback: JSON
if (!usePerLang && !useLegacyMd) {
  const jp = path.join(ROOT, CONFIG.legacyJsonFile);
  if (fs.existsSync(jp)) {
    useLegacyJson = true;
    try {
      const json = JSON.parse(fs.readFileSync(jp, 'utf8'));
      if (json.version) newVersion = json.version;
    } catch(_) {}
  }
}

// อ่าน version จาก per-language file
if (usePerLang) {
  for (const lang of LANGS) {
    const p = path.join(ROOT, CONFIG.perLangCurrent.replace('{lang}', lang));
    if (fs.existsSync(p)) {
      const parsed = parseMD(fs.readFileSync(p, 'utf8'), lang);
      if (parsed.version) { newVersion = parsed.version; break; }
    }
  }
}

const dateObj = makeDateObj(NOW);
const dateStr = NOW.toISOString().slice(0,10).replace(/-/g,'');
const timeStr = pad2(NOW.getUTCHours()) + pad2(NOW.getUTCMinutes());
const buildId = `${newVersion}-${dateStr}${timeStr}`;

console.log(`\n📦  Fantrove Release Tool v4 (Per-Language MD + Stable Release Dates)`);
console.log(`    Version:  ${newVersion}`);
console.log(`    Build ID: ${buildId}`);
console.log(`    Date:     ${dateObj.en}`);
console.log(`    Source:   ${usePerLang ? 'Per-language MD' : useLegacyMd ? 'Legacy MD' : 'Legacy JSON'}\n`);

// ── STEP 0: โหลด release-dates registry (source of truth ของ release date) ────────
//  จะใช้ registry นี้เป็น source of truth สำหรับ "วันที่ build ครั้งแรกของแต่ละ version"
//  ถ้า version มีอยู่แล้วใน registry → ใช้ date เดิม (ไม่เปลี่ยน)
//  ถ้า version ใหม่:
//    1) ถ้ามี date ใน current.md อยู่แล้ว (ผู้ใช้เขียนไว้) → ใช้ date นั้น (เคารพ input)
//    2) ถ้าไม่มี date ใน current.md → ใช้ NOW (เป็น release date ครั้งแรก)

console.log('📋  Loading release-dates registry...');
var releaseDatesRegistry = loadReleaseDates();
var registryVersions = Object.keys(releaseDatesRegistry.versions || {});
console.log(`    มี ${registryVersions.length} version(s) ใน registry: [${registryVersions.join(', ')}]`);

// อ่าน date ที่อยู่ใน current.md (ถ้ามี) เพื่อใช้เป็น fallback สำหรับ version ใหม่
//  เหตุผล: ผู้ใช้อาจเขียน date ใน current.md ไว้ก่อนแล้ว (เช่น "2026-06-20T00:00:00.000Z")
//  เราควรเคารพค่านั้นแทนที่จะใช้ NOW เสมอ
var existingDateInMD = null;
if (usePerLang) {
  for (var li0 = 0; li0 < LANGS.length && !existingDateInMD; li0++) {
    var lang0 = LANGS[li0];
    var fp0 = path.join(ROOT, CONFIG.perLangCurrent.replace('{lang}', lang0));
    if (fs.existsSync(fp0)) {
      var c0 = fs.readFileSync(fp0, 'utf8');
      var dM0 = c0.match(/^date:\s*(.+)$/m);
      if (dM0) {
        var parsed0 = Date.parse(dM0[1].trim());
        if (!isNaN(parsed0)) existingDateInMD = new Date(parsed0).toISOString();
      }
    }
  }
} else if (useLegacyMd) {
  var lp0 = path.join(ROOT, CONFIG.legacyMdFile);
  if (fs.existsSync(lp0)) {
    var lc0 = fs.readFileSync(lp0, 'utf8');
    var dMl0 = lc0.match(/^date:\s*(.+)$/m);
    if (dMl0) {
      var parsedL0 = Date.parse(dMl0[1].trim());
      if (!isNaN(parsedL0)) existingDateInMD = new Date(parsedL0).toISOString();
    }
  }
}

// กำหนด release date ของ version ปัจจุบัน
//  priority: registry > date ใน current.md > NOW
var isNewVersion = !releaseDatesRegistry.versions[newVersion];
var currentReleaseDateISO;
if (!isNewVersion) {
  currentReleaseDateISO = releaseDatesRegistry.versions[newVersion];
  console.log(`    ♻️  Version "${newVersion}" มีอยู่แล้ว → คง release date เดิม: ${currentReleaseDateISO}`);
} else if (existingDateInMD) {
  currentReleaseDateISO = existingDateInMD;
  releaseDatesRegistry.versions[newVersion] = currentReleaseDateISO;
  console.log(`    ✨  Version ใหม่ "${newVersion}" → ใช้ date จาก current.md: ${currentReleaseDateISO}`);
} else {
  currentReleaseDateISO = NOW.toISOString();
  releaseDatesRegistry.versions[newVersion] = currentReleaseDateISO;
  console.log(`    ✨  Version ใหม่ "${newVersion}" → บันทึก release date จาก NOW: ${currentReleaseDateISO}`);
}
var currentReleaseDate = new Date(currentReleaseDateISO);

// ── STEP 1: สร้าง history จาก git log ─────────────────────────────────────────
//  walk commits จากเก่า → ใหม่ เพื่อหา "version" ที่เคยปรากฏ
//  release date ของแต่ละ version มาจาก release-dates registry (source of truth)
//  ถ้าไม่มีใน registry (กรณี history version เก่าที่ registry ยังไม่ได้บันทึก)
//  จะใช้ commit.ts ของ commit แรกที่เห็น version นั้น (เก่าที่สุด) เป็น fallback
//  แล้วบันทึกลง registry ด้วย

console.log('📚  Building history from git log...');

// รวบรวมไฟล์ที่ต้อง track
var trackFiles = [];
if (usePerLang) {
  for (const lang of LANGS) {
    trackFiles.push(CONFIG.perLangCurrent.replace('{lang}', lang));
    const relDir = path.join(ROOT, CONFIG.perLangReleases.replace('{lang}', lang));
    if (fs.existsSync(relDir)) {
      fs.readdirSync(relDir).filter(f => f.endsWith('.md')).forEach(f => {
        trackFiles.push(CONFIG.perLangReleases.replace('{lang}', lang) + '/' + f);
      });
    }
  }
} else if (useLegacyMd) {
  trackFiles.push(CONFIG.legacyMdFile);
} else {
  trackFiles.push(CONFIG.legacyJsonFile);
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

  if (usePerLang) {
    // อ่านทุกภาษาจาก commit นี้ แล้ว merge
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
  } else if (useLegacyMd) {
    var mdContent = git(['show', commit.hash + ':' + CONFIG.legacyMdFile]);
    if (mdContent) {
      var parsed = parseMD(mdContent, 'en'); // legacy เป็น i18n อยู่แล้ว
      // แปลง title/subtitle จาก string → object (สำหรับ legacy single-file format)
      if (parsed.version && !seenVersions.has(parsed.version)) {
        versionFound = parsed.version;
        combinedData = parsed;
      }
    }
  } else {
    var jsonContent = git(['show', commit.hash + ':' + CONFIG.legacyJsonFile]);
    if (jsonContent) {
      try {
        var jp = JSON.parse(jsonContent);
        if (jp.version && !seenVersions.has(jp.version)) {
          versionFound = jp.version;
          combinedData = jp;
        }
      } catch(_) {}
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
  if (usePerLang) {
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
  } else if (useLegacyMd) {
    var lp2 = path.join(ROOT, CONFIG.legacyMdFile);
    if (fs.existsSync(lp2)) currentData = parseMD(fs.readFileSync(lp2, 'utf8'), 'en');
  } else {
    var jp2 = path.join(ROOT, CONFIG.legacyJsonFile);
    if (fs.existsSync(jp2)) {
      try { currentData = JSON.parse(fs.readFileSync(jp2, 'utf8')); } catch (_) {}
    }
  }
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

fs.mkdirSync(path.dirname(historyPath), { recursive: true });
fs.writeFileSync(historyPath, JSON.stringify({ releases: releases }, null, 2) + '\n');
console.log(`✅  release-history.json: ${releases.length}/${MAX_HISTORY} [${releases.map(function(r){return r.version;}).join(', ')}]`);

// ── STEP 2: อัพเดท source files ────────────────────────────────────────────
//  v4: อัปเดท date ใน current.md เฉพาะเมื่อ version เปลี่ยน (isNewVersion=true)
//  ถ้า version เดิม → คง date เดิมไว้, ไม่เขียนทับ
//  เหตุผล: date ใน current.md ใช้สำหรับแสดง popup (version-core.js) และหน้า What's New (new.js)
//  ถ้าเขียนทับทุกครั้ง ผู้ใช้จะเห็น date เปลี่ยนแม้ไม่ได้เปลี่ยน version

if (usePerLang) {
  for (const lang of LANGS) {
    var fp = path.join(ROOT, CONFIG.perLangCurrent.replace('{lang}', lang));
    if (fs.existsSync(fp)) {
      var content = fs.readFileSync(fp, 'utf8');
      if (isNewVersion) {
        // version ใหม่ → เขียน date ใหม่
        if (/^date:\s*.+$/m.test(content)) {
          content = content.replace(/^date:\s*.+$/m, 'date: ' + currentReleaseDateISO);
        } else {
          content = content.replace(/^(version:\s*.+)$/m, '$1\ndate: ' + currentReleaseDateISO);
        }
        fs.writeFileSync(fp, content, 'utf8');
        console.log(`✅  ${CONFIG.perLangCurrent.replace('{lang}', lang)} → date = ${currentReleaseDateISO} (version ใหม่)`);
      } else {
        // version เดิม → sync date ให้ตรงกับ registry (ถ้าผู้ใช้เผลอเขียนทับ)
        var existingDateMatch = content.match(/^date:\s*(.+)$/m);
        var existingDate = existingDateMatch ? existingDateMatch[1].trim() : null;
        if (existingDate !== currentReleaseDateISO) {
          if (/^date:\s*.+$/m.test(content)) {
            content = content.replace(/^date:\s*.+$/m, 'date: ' + currentReleaseDateISO);
          } else {
            content = content.replace(/^(version:\s*.+)$/m, '$1\ndate: ' + currentReleaseDateISO);
          }
          fs.writeFileSync(fp, content, 'utf8');
          console.log(`♻️   ${CONFIG.perLangCurrent.replace('{lang}', lang)} → date sync กับ registry (${currentReleaseDateISO})`);
        } else {
          console.log(`⏭️   ${CONFIG.perLangCurrent.replace('{lang}', lang)} → date ไม่เปลี่ยน (version เดิม)`);
        }
      }
    }
  }
} else if (useLegacyMd) {
  var lp = path.join(ROOT, CONFIG.legacyMdFile);
  var lc = fs.readFileSync(lp, 'utf8');
  var legacyDateMatch = lc.match(/^date:\s*(.+)$/m);
  var legacyExisting = legacyDateMatch ? legacyDateMatch[1].trim() : null;
  if (isNewVersion || legacyExisting !== currentReleaseDateISO) {
    if (/^date:\s*.+$/m.test(lc)) lc = lc.replace(/^date:\s*.+$/m, 'date: ' + currentReleaseDateISO);
    else lc = lc.replace(/^(version:\s*.+)$/m, '$1\ndate: ' + currentReleaseDateISO);
    fs.writeFileSync(lp, lc, 'utf8');
    console.log(`✅  current.md → date = ${currentReleaseDateISO}` + (isNewVersion ? ' (version ใหม่)' : ' (sync กับ registry)'));
  } else {
    console.log('⏭️   current.md → date ไม่เปลี่ยน (version เดิม)');
  }
} else {
  var jp = path.join(ROOT, CONFIG.legacyJsonFile);
  var jd = JSON.parse(fs.readFileSync(jp, 'utf8'));
  jd.version = newVersion;
  jd.date = makeDateObj(currentReleaseDate);
  fs.writeFileSync(jp, JSON.stringify(jd, null, 2) + '\n');
  console.log('✅  whats-new.json → v' + newVersion);
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
console.log('  Source:   ' + (usePerLang ? 'Per-language MD' : useLegacyMd ? 'Legacy MD' : 'Legacy JSON'));
console.log('  History:  ' + releases.length + '/' + MAX_HISTORY);
console.log('  HTML:     ' + updated + '/' + scanned + ' updated');
console.log('─'.repeat(56) + '\n🚀  Ready!\n');