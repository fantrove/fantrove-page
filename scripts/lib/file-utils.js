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
 * [FIX 2026-07-28 v3] แก้ bug ใน exclude check ให้ถูกต้องแบบถาวร:
 *
 *   ปัญหาเดิม (ครั้งที่ 1): exclude patterns เทียบกับ absolute path → ไม่ match
 *   ปัญหาที่แก้ (ครั้งที่ 2): เทียบ entry name (เช่น 'index.html') → ลบทุก
 *     index.html ในทุกระดับ ไม่ใช่แค่ root
 *
 *   วิธีแก้ที่ถูกต้อง (ครั้งที่ 3): track original root directory แยกจาก
 *   current directory ใน recursion แล้วเทียบ exclude patterns กับ relative
 *   path จาก original root เท่านั้น → 'index.html' จะ match เฉพาะไฟล์
 *   index.html ที่ root ไม่ใช่ /home/index.html หรือ /search/index.html
 *
 * @param {string}   dir       — current directory to search (recursion)
 * @param {string[]} exclude   — path patterns relative to original root to skip
 * @param {string[]} [files]   — accumulator (internal)
 * @param {string}   [rootDir] — original root directory (internal, for relative path)
 * @returns {string[]} absolute or relative file paths
 */
function findHtmlFiles(dir, exclude = [], files = [], rootDir = null) {
  // Track original root on first call (when rootDir is null)
  if (rootDir === null) rootDir = dir;

  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    // relative path from the ORIGINAL root (not current dir)
    const relFromRoot = path.relative(rootDir, fullPath).replace(/\\/g, '/');

    // Skip excluded paths — เทียบ relFromRoot กับแต่ละ exclude pattern
    const isExcluded = exclude.some(ex => {
      if (!ex) return false;
      // exact match on relative path from root
      if (relFromRoot === ex) return true;
      // path prefix match (e.g. ex='scripts', rel='scripts/hooks/file.html')
      if (relFromRoot.startsWith(ex + '/')) return true;
      return false;
    });
    if (isExcluded) continue;
    // Skip hidden directories
    if (entry.startsWith('.')) continue;

    let stat;
    try { stat = fs.statSync(fullPath); } catch { continue; }

    if (stat.isDirectory()) {
      // Pass rootDir down through recursion
      findHtmlFiles(fullPath, exclude, files, rootDir);
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