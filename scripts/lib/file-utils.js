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
    const rel = fullPath.replace(/\\/g, '/').replace(/^\.\//, '');
    
    // Skip excluded paths
    if (exclude.some(ex => rel === ex || rel.startsWith(ex + '/'))) continue;
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
 * @param {string} src
 * @param {string} dest
 */
function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  
  for (const entry of fs.readdirSync(src)) {
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