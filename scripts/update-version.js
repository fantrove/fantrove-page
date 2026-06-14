#!/usr/bin/env node
// scripts/update-version.js — Fantrove Verse Release Tool
// v3: Per-language Markdown — อ่าน {lang}/current.md และ {lang}/releases/*.md
//     รวมทุกภาษาเป็น release-history.json (i18n combined)
//     รองรับ legacy: current.md เดียว, whats-new.json
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

const historyPath = path.join(ROOT, CONFIG.historyFile);
const versionPath = path.join(ROOT, CONFIG.versionFile);

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

console.log(`\n📦  Fantrove Release Tool v3 (Per-Language MD)`);
console.log(`    Version:  ${newVersion}`);
console.log(`    Build ID: ${buildId}`);
console.log(`    Date:     ${dateObj.en}`);
console.log(`    Source:   ${usePerLang ? 'Per-language MD' : useLegacyMd ? 'Legacy MD' : 'Legacy JSON'}\n`);

// ── STEP 1: สร้าง history จาก git log ─────────────────────────────────────────

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

var seenVersions = new Set([newVersion]);
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
    var d = new Date(commit.ts || Date.now());
    var relDate = combinedData.date || makeDateObj(d);
    if (typeof relDate === 'string') relDate = makeDateObj(new Date(relDate));

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

releases.reverse(); // ใหม่ → เก่า

fs.mkdirSync(path.dirname(historyPath), { recursive: true });
fs.writeFileSync(historyPath, JSON.stringify({ releases: releases }, null, 2) + '\n');
console.log(`✅  release-history.json: ${releases.length}/${MAX_HISTORY} [${releases.map(function(r){return r.version;}).join(', ')}]`);

// ── STEP 2: อัพเดท source files ────────────────────────────────────────────

if (usePerLang) {
  // อัพเดท date ในทุกภาษา
  for (const lang of LANGS) {
    var fp = path.join(ROOT, CONFIG.perLangCurrent.replace('{lang}', lang));
    if (fs.existsSync(fp)) {
      var content = fs.readFileSync(fp, 'utf8');
      if (/^date:\s*.+$/m.test(content)) {
        content = content.replace(/^date:\s*.+$/m, 'date: ' + NOW.toISOString());
      } else {
        content = content.replace(/^(version:\s*.+)$/m, '$1\ndate: ' + NOW.toISOString());
      }
      fs.writeFileSync(fp, content, 'utf8');
      console.log(`✅  ${CONFIG.perLangCurrent.replace('{lang}', lang)} → date updated`);
    }
  }
} else if (useLegacyMd) {
  var lp = path.join(ROOT, CONFIG.legacyMdFile);
  var lc = fs.readFileSync(lp, 'utf8');
  if (/^date:\s*.+$/m.test(lc)) lc = lc.replace(/^date:\s*.+$/m, 'date: '+NOW.toISOString());
  else lc = lc.replace(/^(version:\s*.+)$/m, '$1\ndate: '+NOW.toISOString());
  fs.writeFileSync(lp, lc, 'utf8');
  console.log('✅  current.md → date updated');
} else {
  var jp = path.join(ROOT, CONFIG.legacyJsonFile);
  var jd = JSON.parse(fs.readFileSync(jp, 'utf8'));
  jd.version = newVersion; jd.date = dateObj;
  fs.writeFileSync(jp, JSON.stringify(jd, null, 2) + '\n');
  console.log('✅  whats-new.json → v' + newVersion);
}

// ── STEP 3: version.json ─────────────────────────────────────────────────────

fs.mkdirSync(path.dirname(versionPath), { recursive: true });
fs.writeFileSync(versionPath, JSON.stringify({ version: newVersion }, null, 2) + '\n');
console.log(`✅  version.json → ${newVersion}`);

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
console.log('  Version:  ' + newVersion);
console.log('  Build ID: ' + buildId);
console.log('  Date:     ' + dateObj.en);
console.log('  Source:   ' + (usePerLang ? 'Per-language MD' : useLegacyMd ? 'Legacy MD' : 'Legacy JSON'));
console.log('  History:  ' + releases.length + '/' + MAX_HISTORY);
console.log('  HTML:     ' + updated + '/' + scanned + ' updated');
console.log('─'.repeat(56) + '\n🚀  Ready!\n');