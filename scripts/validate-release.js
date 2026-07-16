#!/usr/bin/env node
// scripts/validate-release.js — Fantrove Release Validator
// v1.4: v6.1 PER-LANG releases/ FOLDER — ปรับ generated patterns
//
// v1.4 changes จาก v1.3:
//     - ปรับ GENERATED_PATTERNS สำหรับ v6.1:
//       • assets/md/{lang}/releases/index.json (per-language manifest)
//       • assets/md/{lang}/releases/v{version}.md (history ใน releases/)
//     - ลบ patterns เดิม:
//       • assets/md/{lang}/index.json (ย้ายไป releases/ แล้ว)
//       • assets/md/{lang}/v{version}.md (ย้ายไป releases/ แล้ว)
//
// v1.2: STRICT current.md ONLY
// v1.1: 4-layer version control + bypass mechanism
//
// 4-layer system:
//   Layer 1 (pre-commit): validate-release.js --staged (this script)
//   Layer 2 (pre-push): validate-release.js --staged --pre-push
//   Layer 3 (CI): validate-release.js --ci
//   Layer 4 (Deploy): only if Layer 3 passes
//
// วิธีใช้:
//   node scripts/validate-release.js                    # ตรวจ working tree
//   node scripts/validate-release.js --staged           # ตรวจไฟล์ staged (pre-commit)
//   node scripts/validate-release.js --staged --pre-push # ตรวจ pre-push
//   node scripts/validate-release.js --ci               # ตรวจ CI mode
//   node scripts/validate-release.js --commit <hash>    # ตรวจ commit ใด commit หนึ่ง
//
// Exit codes:
//   0 = pass
//   1 = fail

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// ── ไฟล์ที่นักพัฒนาเขียน/แก้ได้ (allowlist) ─────────────────────────────────
const ALLOWED_FILES = new Set([
  'assets/md/en/current.md',
  'assets/md/th/current.md',
]);

// ── ไฟล์ที่เป็น generated artifacts (blocklist) ─────────────────────────────
// v1.4: ปรับสำหรับ v6.1 — releases/ folder ในแต่ละภาษา
const GENERATED_PATTERNS = [
  // v6.1: per-language releases/ folder
  /^assets\/md\/en\/releases\/index\.json$/,
  /^assets\/md\/th\/releases\/index\.json$/,
  /^assets\/md\/en\/releases\/v.*\.md$/,
  /^assets\/md\/th\/releases\/v.*\.md$/,
  // v6.0 legacy: index.json / v*.md ใน root ของภาษา (ควรจะย้ายไป releases/ แล้ว)
  /^assets\/md\/en\/index\.json$/,
  /^assets\/md\/th\/index\.json$/,
  /^assets\/md\/en\/v.*\.md$/,
  /^assets\/md\/th\/v.*\.md$/,
  // version.json (backward compat for new.js poll)
  /^assets\/json\/version\.json$/,
  // Legacy paths (ถ้ามีอยู่ให้ block ด้วย)
  /^assets\/md\/releases\/.*$/,
  /^assets\/json\/release-dates\.json$/,
  /^assets\/json\/whats-new\.json$/,
  /^assets\/json\/release-history\.json$/,
  /^assets\/md\/current\.md$/,
];

// ── Bypass files ────────────────────────────────────────────────────────────
const BYPASS_FILE = path.join(ROOT, '.release-bypass');
const BYPASS_COUNTER_FILE = path.join(ROOT, '.release-bypass-counter');

function isReleaseNotesFile(filePath) {
  // v1.4: ปรับสำหรับ v6.1 — releases/ folder ในแต่ละภาษา
  return /^assets\/md\/(en|th)\/(current\.md|index\.json|v.*\.md)$/.test(filePath)
      || /^assets\/md\/(en|th)\/releases\//.test(filePath)
      || /^assets\/md\/releases\//.test(filePath)
      || /^assets\/json\/(version|whats-new|release-history|release-dates)\.json$/.test(filePath);
}

function isGenerated(filePath) {
  return GENERATED_PATTERNS.some(p => p.test(filePath));
}

function isAllowed(filePath) {
  return ALLOWED_FILES.has(filePath);
}

// ── Bypass logic ────────────────────────────────────────────────────────────
function readBypassCounter() {
  try {
    const content = fs.readFileSync(BYPASS_FILE, 'utf8').trim();
    const n = parseInt(content, 10);
    return isNaN(n) ? 0 : n;
  } catch (_) { return 0; }
}

function readBypassUsedCounter() {
  try {
    const content = fs.readFileSync(BYPASS_COUNTER_FILE, 'utf8').trim();
    const n = parseInt(content, 10);
    return isNaN(n) ? 0 : n;
  } catch (_) { return 0; }
}

function writeBypassUsedCounter(n) {
  fs.writeFileSync(BYPASS_COUNTER_FILE, String(n) + '\n');
}

/**
 * ตรวจว่า bypass ใช้ได้ไหม
 * @returns {{bypass: boolean, counter: number, used: number, message: string}}
 */
function checkBypass() {
  const counter = readBypassCounter();
  const used = readBypassUsedCounter();

  if (counter === 0) {
    return {
      bypass: false,
      counter: 0,
      used: used,
      message: 'ไม่มี bypass token (ไฟล์ .release-bypass ว่างหรือเป็น 0)',
    };
  }

  if (counter <= used) {
    return {
      bypass: false,
      counter: counter,
      used: used,
      message: `bypass token ${counter} ถูกใช้แล้ว (counter=${used}) — ต้องเพิ่มเป็น ${used + 1} เพื่อ bypass อีกครั้ง`,
    };
  }

  return {
    bypass: true,
    counter: counter,
    used: used,
    message: `bypass token ${counter} ใช้ได้ (counter=${counter} > used=${used})`,
  };
}

/**
 * ใช้ bypass token — อัปเดต counter และ stage ไฟล์
 */
function consumeBypass() {
  const counter = readBypassCounter();
  writeBypassUsedCounter(counter);
  try {
    spawnSync('git', ['add', '.release-bypass-counter'], { cwd: ROOT });
  } catch (_) {}
}

// ── ดึงรายการไฟล์ที่เปลี่ยน ──────────────────────────────────────────────────
function getChangedFiles(mode, commitHash) {
  let args;
  if (mode === 'staged') {
    args = ['diff', '--cached', '--name-only', '--diff-filter=ACMRT'];
  } else if (mode === 'commit' && commitHash) {
    args = ['show', '--name-only', '--pretty=format:', commitHash];
  } else {
    args = ['status', '--porcelain'];
  }

  const r = spawnSync('git', args, { encoding: 'utf8', cwd: ROOT });
  if (r.status !== 0) {
    console.error('git command failed:', r.stderr);
    return [];
  }

  let lines = r.stdout.split('\n').filter(Boolean);

  if (mode === 'working' || (!mode || mode === 'working')) {
    lines = lines.map(line => {
      const status = line.slice(0, 2);
      if (status.includes('D')) return null;
      let filename = line.slice(3);
      if (filename.startsWith('"') && filename.endsWith('"')) {
        filename = filename.slice(1, -1);
      }
      return filename;
    }).filter(Boolean);
  }

  return lines;
}

// ── ดึง version จาก current.md ──────────────────────────────────────────────
function readVersionFromCurrentMd(lang) {
  try {
    const fp = path.join(ROOT, `assets/md/${lang}/current.md`);
    const content = fs.readFileSync(fp, 'utf8');
    const m = content.match(/^version:\s*(.+)$/m);
    return m ? m[1].trim() : null;
  } catch (_) { return null; }
}

function getLastCommittedVersion(lang) {
  try {
    const r = spawnSync('git', ['show', `HEAD:assets/md/${lang}/current.md`], {
      encoding: 'utf8', cwd: ROOT,
    });
    if (r.status !== 0 || !r.stdout) return null;
    const m = r.stdout.match(/^version:\s*(.+)$/m);
    return m ? m[1].trim() : null;
  } catch (_) { return null; }
}

function checkVersionBump() {
  const enCurrent = readVersionFromCurrentMd('en');
  const thCurrent = readVersionFromCurrentMd('th');
  const enLast = getLastCommittedVersion('en');
  const thLast = getLastCommittedVersion('th');

  const current = enCurrent || thCurrent;
  const lastCommitted = enLast || thLast;

  if (!current) {
    return { bumped: false, current: null, lastCommitted, reason: 'ไม่พบ version ใน current.md' };
  }

  if (!lastCommitted) {
    return { bumped: true, current, lastCommitted: null };
  }

  const bumped = current !== lastCommitted;
  return { bumped, current, lastCommitted };
}

// ── Validation logic ─────────────────────────────────────────────────────────
function validate(files) {
  const violations = [];
  const releaseNotesChanges = [];

  for (const f of files) {
    if (!isReleaseNotesFile(f)) continue;
    releaseNotesChanges.push(f);

    if (isGenerated(f)) {
      violations.push({
        file: f,
        reason: 'generated artifact — ห้ามแก้ไขด้วยมือ, ระบบสร้างให้อัตโนมัติใน CI/CD',
      });
    } else if (!isAllowed(f)) {
      violations.push({
        file: f,
        reason: 'ไม่อยู่ใน allowlist ของ release-notes files ที่นักพัฒนาเขียนได้',
      });
    }
  }

  return { violations, releaseNotesChanges };
}

function checkCurrentMdWarnings() {
  const warnings = [];
  const enVersion = readVersionFromCurrentMd('en');
  const thVersion = readVersionFromCurrentMd('th');

  if (enVersion && thVersion && enVersion !== thVersion) {
    warnings.push({
      type: 'version_mismatch',
      message: `assets/md/en/current.md (version: ${enVersion}) ไม่ตรงกับ assets/md/th/current.md (version: ${thVersion})`,
    });
  }

  for (const lang of ['en', 'th']) {
    try {
      const fp = path.join(ROOT, `assets/md/${lang}/current.md`);
      const content = fs.readFileSync(fp, 'utf8');
      if (/^date:\s*.+$/m.test(content)) {
        warnings.push({
          type: 'manual_date',
          message: `assets/md/${lang}/current.md มี date: — ระบบจะ sync ทับด้วยค่าจาก registry ใน CI/CD`,
        });
      }
    } catch (_) {}
  }

  return { enVersion, thVersion, warnings };
}

// ── Main ─────────────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  let mode = 'working';
  let commitHash = null;
  let allowGenerated = false;
  let ciMode = false;
  let prePushMode = false;
  let requireVersionBump = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--staged') mode = 'staged';
    else if (argv[i] === '--commit') { mode = 'commit'; commitHash = argv[i + 1]; i++; }
    else if (argv[i] === '--allow-generated') allowGenerated = true;
    else if (argv[i] === '--ci') { ciMode = true; requireVersionBump = true; }
    else if (argv[i] === '--pre-push') { prePushMode = true; requireVersionBump = true; }
    else if (argv[i] === '--require-version-bump') requireVersionBump = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: node scripts/validate-release.js [options]');
      console.log('');
      console.log('Options:');
      console.log('  --staged                 ตรวจไฟล์ที่ staged ใน git');
      console.log('  --commit <hash>          ตรวจไฟล์ที่เปลี่ยนใน commit ใด commit หนึ่ง');
      console.log('  --allow-generated        อนุญาตให้แก้ generated artifacts (CI/CD เท่านั้น)');
      console.log('  --ci                     CI mode — บังคับ version bump, อนุญาต generated');
      console.log('  --pre-push               Pre-push mode — บังคับ version bump');
      console.log('  --require-version-bump   บังคับ version bump (ยกเว้นมี bypass)');
      console.log('');
      console.log('Bypass mechanism:');
      console.log('  แก้ไขไฟล์ .release-bypass ให้เป็นเลขที่มากกว่า .release-bypass-counter');
      console.log('  ตัวอย่าง: ถ้า counter=1, ใส่ 2 ใน .release-bypass เพื่อ bypass ครั้งถัดไป');
      process.exit(0);
    }
  }

  if (mode === 'staged' && !ciMode) {
    requireVersionBump = true;
  }
  if (prePushMode) {
    allowGenerated = true;
  }

  const modeLabel = ciMode ? 'CI' : prePushMode ? 'pre-push' : mode === 'staged' ? 'pre-commit' : mode;
  console.log('🔍  Fantrove Release Validator v1.4 (v6.1 — per-lang releases/ folder)');
  console.log('    Mode: ' + modeLabel + (commitHash ? ' (' + commitHash + ')' : '') + (allowGenerated || ciMode ? ' (allow-generated)' : ''));
  console.log('');

  let files;
  if (prePushMode) {
    const r = spawnSync('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
      encoding: 'utf8', cwd: ROOT,
    });
    let upstream = r.status === 0 ? r.stdout.trim() : 'origin/main';
    if (!upstream) upstream = 'origin/main';

    const diffR = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMRT', upstream + '...HEAD'], {
      encoding: 'utf8', cwd: ROOT,
    });
    if (diffR.status === 0 && diffR.stdout.trim()) {
      files = diffR.stdout.split('\n').filter(Boolean);
    } else {
      files = getChangedFiles('working', null);
    }
  } else {
    files = getChangedFiles(mode, commitHash);
  }

  if (!files.length && !ciMode) {
    console.log('   ไม่มีไฟล์ที่เปลี่ยน — ไม่ต้องตรวจ');
    process.exit(0);
  }

  const { violations, releaseNotesChanges } = validate(files);

  console.log('   ไฟล์ release-notes ที่เปลี่ยน: ' + releaseNotesChanges.length);
  releaseNotesChanges.forEach(f => {
    const status = isAllowed(f) ? '✓ allowed' : isGenerated(f) ? '✗ generated' : '? unknown';
    console.log('     ' + status + '  ' + f);
  });
  console.log('');

  const { enVersion, thVersion, warnings } = checkCurrentMdWarnings();
  const { bumped, current, lastCommitted, reason } = checkVersionBump();

  if (enVersion || thVersion) {
    console.log('   📦  Version ใน current.md: en=' + (enVersion || '-') + ', th=' + (thVersion || '-'));
    console.log('   📦  Version ล่าสุดใน git: ' + (lastCommitted || '-'));
  }

  if (requireVersionBump) {
    if (!bumped) {
      console.log('   ⚠️  Version ไม่เปลี่ยน (current=' + current + ', last=' + lastCommitted + ')');
      if (reason) console.log('       เหตุผล: ' + reason);

      const bypassResult = checkBypass();
      if (bypassResult.bypass) {
        console.log('   🔓  Bypass ใช้งานได้: ' + bypassResult.message);
        console.log('       ใช้ bypass token ' + bypassResult.counter + ' — ครั้งถัดไปต้องเพิ่มเป็น ' + (bypassResult.counter + 1));
        consumeBypass();
        console.log('       ✅ Bypass token ถูกใช้แล้ว — .release-bypass-counter อัปเดตเป็น ' + bypassResult.counter);
        console.log('');
      } else {
        console.log('   ❌  Bypass ไม่ได้: ' + bypassResult.message);
        console.log('');
        console.log('   💡  วิธีแก้:');
        console.log('       1. เปลี่ยน version ใน assets/md/{en,th}/current.md เป็นเลขใหม่');
        console.log('       2. หรือแก้ไข .release-bypass เป็นเลขที่มากกว่า .release-bypass-counter');
        console.log('          (ถ้า counter=' + bypassResult.used + ', ใส่ ' + (bypassResult.used + 1) + ' ใน .release-bypass)');
        console.log('');
        process.exit(1);
      }
    } else {
      console.log('   ✅  Version เปลี่ยน: ' + lastCommitted + ' → ' + current);
      console.log('');
    }
  } else {
    console.log('');
  }

  if (warnings.length) {
    console.log('   ⚠️  Warnings:');
    warnings.forEach(w => console.log('     • ' + w.message));
    console.log('');
  }

  if (violations.length) {
    if (allowGenerated || ciMode) {
      console.log('⚠️  CI/CD mode — อนุญาตให้แก้ generated artifacts:');
      violations.forEach(v => {
        console.log('     • ' + v.file);
      });
      console.log('');
      console.log('   ตรวจสอบว่าการเปลี่ยนแปลงเหล่านี้มาจาก update-version.js เท่านั้น');
      console.log('');
    } else {
      console.log('❌  FAILED — พบการแก้ generated artifacts ที่ห้ามแก้:');
      violations.forEach(v => {
        console.log('     • ' + v.file);
        console.log('       ' + v.reason);
      });
      console.log('');
      console.log('   💡  วิธีแก้:');
      console.log('       1. แก้ไขเฉพาะ assets/md/{en,th}/current.md เท่านั้น');
      console.log('       2. ไฟล์อื่นๆ ระบบจะสร้างให้อัตโนมัติใน CI/CD');
      console.log('       3. git checkout -- <file> เพื่อ revert การแก้ไขที่ผิด');
      console.log('');
      process.exit(1);
    }
  }

  if (prePushMode) {
    const enExists = fs.existsSync(path.join(ROOT, 'assets/md/en/current.md'));
    const thExists = fs.existsSync(path.join(ROOT, 'assets/md/th/current.md'));
    if (!enExists || !thExists) {
      console.log('❌  FAILED — ไม่พบ current.md:');
      if (!enExists) console.log('     • assets/md/en/current.md');
      if (!thExists) console.log('     • assets/md/th/current.md');
      console.log('');
      process.exit(1);
    }

    const jsFiles = files.filter(f => f.endsWith('.js') && fs.existsSync(path.join(ROOT, f)));
    let syntaxError = false;
    for (const jsf of jsFiles) {
      const r = spawnSync('node', ['--check', jsf], { encoding: 'utf8', cwd: ROOT });
      if (r.status !== 0) {
        console.log('❌  JS syntax error: ' + jsf);
        console.log('   ' + r.stderr.split('\n')[0]);
        syntaxError = true;
      }
    }
    if (syntaxError) {
      console.log('');
      process.exit(1);
    }
    console.log('   ✅  JS syntax check ผ่าน (' + jsFiles.length + ' ไฟล์)');
    console.log('');
  }

  console.log('✅  PASS — ทุกการตรวจสอบผ่าน');
  process.exit(0);
}

main();
