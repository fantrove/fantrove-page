'use strict';

/**
 * marker-parser.js
 * Port of the Web Worker translation logic from translator.js → Node.js
 *
 * Parses translation strings containing markers:
 *   @br              — line break
 *   @strong text@    — bold text
 *   @lsvg[:id]@      — local SVG reference
 *   @svg[:id]@       — SVG reference
 *   @slot:name@      — slot placeholder
 *   @a text@         — anchor element
 *
 * Returns a parts array identical to what the worker returns in the browser.
 */

const HTML_TAG_RE = /(<\/?[^>]+>)/;
const MARKER_RE_SRC =
  '(@lsvg(?::([^@]+))?@)' +
  '|(@svg(?::([^@]+))?@)' +
  '|(@slot:([^@]+)@)' +
  '|(@a(.*?)@)' +
  '|(@br)' +
  '|(@strong(.*?)@)';

/**
 * Parse a translation string into a parts array.
 * @param {string} str
 * @returns {Array<Object>} parts
 */
function parseTranslation(str) {
  if (!str || typeof str !== 'string') return [{ type: 'text', text: '' }];
  
  const htmlParts = str.split(HTML_TAG_RE);
  const parts = [];
  const markerRegex = new RegExp(MARKER_RE_SRC, 'g');
  
  for (const segment of htmlParts) {
    if (!segment) continue;
    
    // HTML tag captured by the split
    if (/^<\/?[^>]+>$/.test(segment)) {
      parts.push({ type: 'html', html: segment });
      continue;
    }
    
    let lastIndex = 0;
    let m;
    markerRegex.lastIndex = 0;
    
    while ((m = markerRegex.exec(segment)) !== null) {
      if (m.index > lastIndex)
        parts.push({ type: 'text', text: segment.slice(lastIndex, m.index) });
      
      if (m[1]) parts.push({ type: 'lsvg', id: m[2] || null });
      else if (m[3]) parts.push({ type: 'svg', id: m[4] || null });
      else if (m[5]) parts.push({ type: 'slot', name: m[6] || null });
      else if (m[7]) parts.push({ type: 'a', translate: (m[8] || '') !== '', text: m[8] || '' });
      else if (m[9]) parts.push({ type: 'br' });
      else if (m[10]) parts.push({ type: 'strong', text: m[11] || '' });
      
      lastIndex = markerRegex.lastIndex;
    }
    
    if (lastIndex < segment.length)
      parts.push({ type: 'text', text: segment.slice(lastIndex) });
  }
  
  return parts;
}

/**
 * Merge consecutive text/html parts (mirrors _normalizeParts in translator.js).
 * @param {Array<Object>} parts
 * @returns {Array<Object>}
 */
function normalizeParts(parts) {
  const out = [];
  let buf = '';
  let bufHasHtml = false;
  
  const flush = () => {
    if (!buf) return;
    out.push(bufHasHtml ? { type: 'html', html: buf } : { type: 'text', text: buf });
    buf = '';
    bufHasHtml = false;
  };
  
  for (const p of parts) {
    if (p.type === 'text' || p.type === 'html') {
      buf += p.type === 'text' ? (p.text || '') : (p.html || '');
      if (p.type === 'html' || /<[^>]+>/.test(p.text || '')) bufHasHtml = true;
    } else {
      flush();
      out.push(p);
    }
  }
  flush();
  return out;
}

/**
 * Flatten a nested JSON object (mirrors flattenLanguageJson in loader.js).
 * @param {Object} json
 * @returns {Object}
 */
function flattenJson(json) {
  const result = {};
  const stack = [json];
  
  while (stack.length) {
    const obj = stack.pop();
    for (const [k, v] of Object.entries(obj)) {
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        stack.push(v);
      } else {
        result[k] = v;
      }
    }
  }
  return result;
}

module.exports = { parseTranslation, normalizeParts, flattenJson };