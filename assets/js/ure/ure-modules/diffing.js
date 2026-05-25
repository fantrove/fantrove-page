// Path:    assets/js/ure/ure-modules/diffing.js
// Purpose: O(n+m) data diffing engine.
// Used by: engine.js
//
// Changes v1.3.0:
//   extractKey() — accepts optional keyFn (item) => string for function-based keys.
//   diff()       — accepts optional keyFn, passed through to extractKey.
//                  Fully backward-compatible: existing callers omitting keyFn behave identically.

(function(M) {
  'use strict';
  
  const { CONFIG } = M;
  
  // ── Key extractor ─────────────────────────────────────────────────────────
  
  /**
   * Derive a stable string key from an item.
   * @param {any}           item
   * @param {string}        keyField
   * @param {Function|null} [keyFn]  — optional (item) => string override
   * @returns {string|undefined}
   */
  function extractKey(item, keyField, keyFn) {
    if (keyFn) {
      try { return String(keyFn(item)); } catch (_) {}
    }
    if (!item || typeof item !== 'object') return String(item);
    if (item[keyField] !== undefined) return String(item[keyField]);
    return undefined;
  }
  
  // ── Diff engine ───────────────────────────────────────────────────────────
  
  /**
   * Compare two data arrays and classify every change.
   * Two-pass O(n + m) algorithm.
   *
   * @param {any[]}         oldItems
   * @param {any[]}         newItems
   * @param {string}        [keyField]
   * @param {Function|null} [keyFn]   — optional (item) => string, overrides keyField
   * @returns {URDiffResult & { fullReplace: boolean }}
   */
  function diff(
    oldItems,
    newItems,
    keyField = CONFIG.DIFF.FALLBACK_KEY_FIELD,
    keyFn = null,
  ) {
    const total = oldItems.length + newItems.length;
    
    if (total > CONFIG.DIFF.FULL_REPLACE_THRESHOLD) {
      return { fullReplace: true, added: new Map(), removed: new Set(), changed: new Map(), moved: new Map() };
    }
    
    const _key = (item, i) => extractKey(item, keyField, keyFn) ?? `__idx_${i}`;
    
    /** @type {Map<string, {index:number, item:any}>} */
    const oldMap = new Map();
    const added = new Map();
    const removed = new Set();
    const changed = new Map();
    const moved = new Map();
    
    // Pass 1 — index old items
    for (let i = 0; i < oldItems.length; i++) {
      oldMap.set(_key(oldItems[i], i), { index: i, item: oldItems[i] });
    }
    
    // Pass 2 — walk new items
    const seen = new Set();
    for (let i = 0; i < newItems.length; i++) {
      const key = _key(newItems[i], i);
      const oldRec = oldMap.get(key);
      seen.add(key);
      
      if (!oldRec) {
        added.set(key, { index: i, item: newItems[i] });
        continue;
      }
      if (oldRec.index !== i) moved.set(key, i);
      if (!_shallowEqual(oldRec.item, newItems[i])) {
        changed.set(key, { index: i, item: newItems[i] });
      }
    }
    
    // Pass 3 — removals
    for (const [key] of oldMap) {
      if (!seen.has(key)) removed.add(key);
    }
    
    return { fullReplace: false, added, removed, changed, moved };
  }
  
  // ── Shallow equality ──────────────────────────────────────────────────────
  
  function _shallowEqual(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const k of keysA) { if (a[k] !== b[k]) return false; }
    return true;
  }
  
  // ── Export ────────────────────────────────────────────────────────────────
  
  M.DiffEngine = Object.freeze({ diff, extractKey });
  
})(window.UREModules = window.UREModules || {});