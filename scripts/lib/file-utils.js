'use strict';

/**
 * file-utils.js
 * File discovery and I/O helpers for the build system.
 */

const fs = require('fs');
const path = require('path');

/**
 * Recursively find all .html files under `dir`, excluding specified folders.
 *
 * [FIX 2026-07-28] แก้ bug ใน exclude check:
 *   เดิมใช้ `rel = fullPath` (absolute path) เทียบกับ `ex` (relative pattern
 *   เช่น 'dist') ทำให้ exclude ไม่ทำงานเลย เพราะ absolute path ไม่มีทาง
 *   `=== 'dist'` หรือ `startsWith('dist/')`. ผลที่ตามมา: build script สแกน
 *   HTML ใน `dist/` จากการ build ครั้งก่อน → ปรากฏใน sitemap เป็น
 *   `/en/dist/...` (รั่วเข้า sitemap จริงใน production)
 *
 *   วิธีแก้: เทียบ `entry` (ชื่อ directory ตรงๆ) กับแต่ละ exclude pattern
 *   แทน และเพิ่มเทียบ relative path (เทียบกับ root `dir`) ด้วยเพื่อรองรับ
 *   exclude pattern แบบ path prefix เช่น 'scripts/hooks'
 *
 * @param {string}   dir      — root directory to search
 * @param {string[]} exclude  — directory names / path prefixes to skip
 * @param {string[]} [files]  — accumulator (internal)
 * @returns {string[]} absolute or relative file paths
 */
function findHtmlFiles(dir, exclude = [], files = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    // relative path from the ORIGINAL root (passed in as `dir` on first call)
    // — แต่ recursion ส่ง fullPath เข้ามา จึงต้องใช้ entry สำหรับ top-level
    //   exclude check และ relative path สำหรับ nested exclude check
    const relFromRoot = path.relative(dir, fullPath).replace(/\\/g, '/');

    // Skip excluded paths — แก้ bug ใหม่: เทียบทั้ง entry name และ relFromRoot
    const isExcluded = exclude.some(ex => {
      if (!ex) return false;
      // 1) exact match on entry name (e.g. ex='dist', entry='dist')
      if (entry === ex) return true;
      // 2) exact match on relative path from root (e.g. ex='scripts/hooks')
      if (relFromRoot === ex) return true;
      // 3) relFromRoot starts with ex + '/' (e.g. ex='scripts', rel='scripts/hooks')
      if (relFromRoot.startsWith(ex + '/')) return true;
      return false;
    });
    if (isExcluded) continue;
    // Skip hidden directories
    if (entry.startsWith('.')) continue;

    let stat;
    try { stat = fs.statSync(fullPath); } catch { continue; }

    if (stat.isDirectory()) {
      findHtmlFiles(fullPath, exclude, files);
    } else if (entry.endsWith('.html')) {
      files.push(fullPath.replace(/\\/g, '/'));
    }
  }

  return files;
}

/**
 * Recursively copy a directory tree.
 * Skips hidden directories that start with '.' (e.g. .well-known, .github)
 * so the build system never touches them.
 *
 * @param {string} src
 * @param {string} dest
 */
function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  
  for (const entry of fs.readdirSync(src)) {
    // Skip hidden directories (e.g. .well-known, .github)
    if (entry.startsWith('.')) continue;
    
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    const stat = fs.statSync(srcPath);
    
    if (stat.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Ensure a directory exists (create if needed).
 * @param {string} dir
 */
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Write a file, creating parent directories as needed.
 * @param {string} filePath
 * @param {string} content
 */
function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Load and flatten a translation JSON file.
 * Returns an empty object if the file doesn't exist.
 *
 * @param {string} filePath
 * @param {Function} flattenFn  — flattenJson from marker-parser.js
 * @returns {Object}
 */
function loadTranslationFile(filePath, flattenFn) {
  if (!fs.existsSync(filePath)) {
    return null; // null = file missing (caller decides how to handle)
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return flattenFn(raw);
  } catch (e) {
    console.error(`[build] ✗ Error parsing ${filePath}:`, e.message);
    return {};
  }
}

/**
 * Load db.json (language config).
 * @param {string} filePath
 * @returns {Object|null}
 */
function loadDbJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error('[build] ✗ Error parsing db.json:', e.message);
    return null;
  }
}

module.exports = { findHtmlFiles, copyDir, ensureDir, writeFile, loadTranslationFile, loadDbJson };