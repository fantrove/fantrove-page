#!/usr/bin/env node
// scripts/validate-release.js — Fantrove Release Validator
// v1.0: Closed-system validator สำหรับ release notes
//
// WHY: ระบบ release notes ต้องเป็น "ระบบปิด" — นักพัฒนาเขียน/แก้ได้แค่ไฟล์เดียว:
//   • assets/md/en/current.md (release notes ภาษาอังกฤษของ version ปัจจุบัน)
//   • assets/md/th/current.md (release notes ภาษาไทยของ version ปัจจุบัน)
//
// ไฟล์อื่นทุกไฟล์ในระบบ release notes เป็น "generated artifacts" — สร้างโดย
// scripts/update-version.js ใน CI/CD เท่านั้น นักพัฒนาห้ามแก้:
//   • assets/md/{en,th}/releases/v*.md (per-version snapshots)
//   • assets/md/releases/index.json (manifest สำหรับ client)
//   • assets/json/release-dates.json (registry ของ release dates)
//   • assets/json/version.json (runtime metadata)
//
// วิธีใช้:
//   node scripts/validate-release.js           # ตรวจ working tree
//   node scripts/validate-release.js --staged  # ตรวจไฟล์ที่ staged ใน git
//   node scripts/validate-release.js --commit <hash>  # ตรวจไฟล์ที่เปลี่ยนใน commit
//
// Exit codes:
//   0 = pass (ทุกไฟล์ที่เปลี่ยนเป็นไฟล์ที่นักพัฒนาเขียนได้)
//   1 = fail (มีการแก้ generated artifact — ต้อง revert)
//
// แนะนำให้ติดตั้งเป็น git pre-commit hook:
//   cp scripts/validate-release.js .githooks/pre-commit
//   chmod +x .githooks/pre-commit
//   git config core.hooksPath .githooks

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// ── ไฟล์ที่นักพัฒนาเขียน/แก้ได้ (allowlist) ─────────────────────────────────
// เพิ่มไฟล์ที่นี่หากต้องการให้นักพัฒนาแตะได้ — แต่ควรจำกัดมากที่สุด
const ALLOWED_FILES = new Set([
  'assets/md/en/current.md',
  'assets/md/th/current.md',
]);

// ── ไฟล์ที่เป็น generated artifacts (blocklist) ─────────────────────────────
// ระบบสร้างไฟล์เหล่านี้เอง — นักพัฒนาห้ามแก้
const GENERATED_PATTERNS = [
  /^assets\/md\/en\/releases\/v.*\.md$/,         // per-version snapshots (en)
  /^assets\/md\/th\/releases\/v.*\.md$/,         // per-version snapshots (th)
  /^assets\/md\/releases\/index\.json$/,         // manifest สำหรับ client
  /^assets\/json\/release-dates\.json$/,         // registry ของ release dates
  /^assets\/json\/version\.json$/,               // runtime metadata
  // Legacy ที่ยกเลิกแล้ว — ถ้ามีการสร้างใหม่ให้ block
  /^assets\/json\/whats-new\.json$/,
  /^assets\/json\/release-history\.json$/,
];

// ── รวมไฟล์อื่นที่อนุญาต (non-release-notes ไฟล์ทั่วไป) ──────────────────────
// WHY: validator นี้ตรวจเฉพาะ release-notes-related ไฟล์ — นักพัฒนายังแก้ไฟล์
// อื่นๆ (เช่น assets/js/*, assets/css/*, *.html) ได้ปกติ
function isReleaseNotesFile(filePath) {
  return /^assets\/(md|json)\/(releases|whats-new|release-history|release-dates|version)/.test(filePath)
      || /^assets\/md\/(en|th)\/(current\.md|releases\/)/.test(filePath);
}

function isGenerated(filePath) {
  return GENERATED_PATTERNS.some(p => p.test(filePath));
}

function isAllowed(filePath) {
  return ALLOWED_FILES.has(filePath);
}

// ── ดึงรายการไฟล์ที่เปลี่ยน ──────────────────────────────────────────────────
function getChangedFiles(mode, commitHash) {
  let args;
  if (mode === 'staged') {
    args = ['diff', '--cached', '--name-only', '--diff-filter=ACMRT'];
  } else if (mode === 'commit' && commitHash) {
    args = ['show', '--name-only', '--pretty=format:', commitHash];
  } else if (mode === 'working') {
    args = ['status', '--porcelain'];
  } else {
    args = ['status', '--porcelain'];
  }

  const r = spawnSync('git', args, { encoding: 'utf8', cwd: ROOT });
  if (r.status !== 0) {
    console.error('git command failed:', r.stderr);
    return [];
  }

  let lines = r.stdout.split('\n').filter(Boolean);

  // working tree mode: ต้อง parse porcelain format (XY filename)
  if (mode === 'working' || (!mode || mode === 'working')) {
    lines = lines.map(line => {
      // Porcelain format: "XY filename" หรือ "XY \"filename\""
      // เราสนใจเฉพาะไฟล์ที่ modified/added/deleted (MARC)
      const status = line.slice(0, 2);
      if (status.includes('D')) return null; // skip deletions
      let filename = line.slice(3);
      if (filename.startsWith('"') && filename.endsWith('"')) {
        filename = filename.slice(1, -1);
      }
      return filename;
    }).filter(Boolean);
  }

  return lines;
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

// ── ตรวจสอบ current.md ที่เขียนใหม่ — ดูว่า version เปลี่ยนหรือไม่ ───────────────
// WHY: ถ้านักพัฒนาแก้ current.md โดยไม่เปลี่ยน version → ถือว่าแก้เนื้อหาของ version
//      ปัจจุบันซึ่งไม่สมควร (version ปัจจุบัน "ล็อค" แล้ว) — เว้นแต่เป็นการเขียน version ใหม่
function checkVersionBump(enPath, thPath) {
  const warnings = [];

  function readVersion(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const m = content.match(/^version:\s*(.+)$/m);
      return m ? m[1].trim() : null;
    } catch (_) { return null; }
  }

  const enVersion = readVersion(enPath);
  const thVersion = readVersion(thPath);

  // ตรวจว่า en กับ th เขียน version เดียวกันไหม
  if (enVersion && thVersion && enVersion !== thVersion) {
    warnings.push({
      type: 'version_mismatch',
      message: `assets/md/en/current.md (version: ${enVersion}) ไม่ตรงกับ assets/md/th/current.md (version: ${thVersion})`,
    });
  }

  // ตรวจว่ามี date: อยู่ใน current.md ไหม — ถ้ามี แสดงว่านักพัฒนาเขียนเอง (ระบบจะ sync ทับ)
  function hasDate(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return /^date:\s*.+$/m.test(content);
    } catch (_) { return false; }
  }

  if (hasDate(enPath)) {
    warnings.push({
      type: 'manual_date',
      message: 'assets/md/en/current.md มี date: — ระบบจะ sync ทับด้วยค่าจาก registry ใน CI/CD',
    });
  }
  if (hasDate(thPath)) {
    warnings.push({
      type: 'manual_date',
      message: 'assets/md/th/current.md มี date: — ระบบจะ sync ทับด้วยค่าจาก registry ใน CI/CD',
    });
  }

  return { enVersion, thVersion, warnings };
}

// ── Main ─────────────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  let mode = 'working';
  let commitHash = null;
  let allowGenerated = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--staged') mode = 'staged';
    else if (argv[i] === '--commit') { mode = 'commit'; commitHash = argv[i + 1]; i++; }
    else if (argv[i] === '--allow-generated') allowGenerated = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: node scripts/validate-release.js [--staged|--commit <hash>] [--allow-generated]');
      console.log('');
      console.log('Options:');
      console.log('  --staged            ตรวจไฟล์ที่ staged ใน git');
      console.log('  --commit <hash>     ตรวจไฟล์ที่เปลี่ยนใน commit ใด commit หนึ่ง');
      console.log('  --allow-generated   อนุญาตให้แก้ generated artifacts (สำหรับ CI/CD เท่านั้น)');
      process.exit(0);
    }
  }

  console.log('🔍  Fantrove Release Validator v1.0');
  console.log('    Mode: ' + mode + (commitHash ? ' (' + commitHash + ')' : '') + (allowGenerated ? ' (CI/CD mode)' : ''));
  console.log('');

  const files = getChangedFiles(mode, commitHash);
  if (!files.length) {
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

  if (releaseNotesChanges.some(f => isAllowed(f))) {
    const { enVersion, thVersion, warnings } = checkVersionBump(
      path.join(ROOT, 'assets/md/en/current.md'),
      path.join(ROOT, 'assets/md/th/current.md')
    );

    if (enVersion || thVersion) {
      console.log('   📦  Version ใน current.md: en=' + (enVersion || '-') + ', th=' + (thVersion || '-'));
    }

    if (warnings.length) {
      console.log('');
      console.log('   ⚠️  Warnings:');
      warnings.forEach(w => console.log('     • ' + w.message));
    }
    console.log('');
  }

  if (violations.length) {
    if (allowGenerated) {
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

  console.log('✅  PASS — ทุกไฟล์ที่เปลี่ยนเป็นไฟล์ที่นักพัฒนาเขียนได้');
  process.exit(0);
}

main();
