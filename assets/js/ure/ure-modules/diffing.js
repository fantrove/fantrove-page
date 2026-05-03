// Path:    assets/js/ure/ure-modules/diffing.js
// Purpose: O(n) data diffing engine. Compares old vs new item arrays and
//          returns a URDiffResult so the engine only re-renders what changed.
//          Prevents full-list repaints when only a few items are updated.
// Used by: engine.js

(function(M) {
  'use strict';
  
  const { CONFIG } = M;
  
  // ── Key extractor ─────────────────────────────────────────────────────────
  
  /**
   * Derive a stable string key from an item.
   * Falls back to JSON-stable stringify for keyless objects.
   * @param {any}    item
   * @param {string} keyField
   * @returns {string}
   */
  function extractKey(item, keyField) {
    if (!item || typeof item !== 'object') return String(item);
    if (item[keyField] !== undefined) return String(item[keyField]);
    // Fallback: use index-stable string (caller must pass index as tiebreaker)
    // We return undefined here; caller should handle index fallback.
    return undefined;
  }
  
  // ── Diff engine ───────────────────────────────────────────────────────────
  
  /**
   * Compare two data arrays and classify every change.
   *
   * Algorithm: two-pass O(n + m)
   *  1. Build a Map of { key → {index, item} } for the old array.
   *  2. Walk the new array:
   *     - key not in old  → added
   *     - key in old, data changed  → changed
   *     - key in old, index changed → moved
   *     - key in old, unchanged     → stable
   *  3. Keys remaining in old but not seen in new → removed
   *
   * Bails out to a full-replace signal when list exceeds
   * CONFIG.DIFF.FULL_REPLACE_THRESHOLD (avoids O(n) overhead on huge lists).
   *
   * @param {any[]}  oldItems
   * @param {any[]}  newItems
   * @param {string} [keyField]
   * @returns {URDiffResult & { fullReplace: boolean }}
   */
  function diff(oldItems, newItems, keyField = CONFIG.DIFF.FALLBACK_KEY_FIELD) {
    const total = oldItems.length + newItems.length;
    
    // Full-replace fast path for very large lists
    if (total > CONFIG.DIFF.FULL_REPLACE_THRESHOLD) {
      return { fullReplace: true, added: new Map(), removed: new Set(), changed: new Map(), moved: new Map() };
    }
    
    /** @type {Map<string, {index:number, item:any}>} */
    const oldMap = new Map();
    /** @type {Map<string, {index:number, item:any}>} */
    const added = new Map();
    /** @type {Set<string>}                           */
    const removed = new Set();
    /** @type {Map<string, {index:number, item:any}>} */
    const changed = new Map();
    /** @type {Map<string, number>}                   */
    const moved = new Map();
    
    // Pass 1: index old items
    for (let i = 0; i < oldItems.length; i++) {
      const key = extractKey(oldItems[i], keyField) ?? `__idx_${i}`;
      oldMap.set(key, { index: i, item: oldItems[i] });
    }
    
    // Pass 2: walk new items
    const seen = new Set();
    for (let i = 0; i < newItems.length; i++) {
      const key = extractKey(newItems[i], keyField) ?? `__idx_${i}`;
      const oldRec = oldMap.get(key);
      seen.add(key);
      
      if (!oldRec) {
        // Brand-new item
        added.set(key, { index: i, item: newItems[i] });
        continue;
      }
      
      if (oldRec.index !== i) {
        // Same key, different position
        moved.set(key, i);
      }
      
      // Check if the data itself changed (shallow comparison)
      if (!_shallowEqual(oldRec.item, newItems[i])) {
        changed.set(key, { index: i, item: newItems[i] });
      }
    }
    
    // Pass 3: keys in old but not in new → removed
    for (const [key] of oldMap) {
      if (!seen.has(key)) removed.add(key);
    }
    
    return { fullReplace: false, added, removed, changed, moved };
  }
  
  // ── Shallow equality ──────────────────────────────────────────────────────
  
  /**
   * Shallow compare two values.
   * For objects: compares own enumerable properties one level deep.
   * @param {any} a
   * @param {any} b
   * @returns {boolean}
   */
  function _shallowEqual(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const k of keysA) {
      if (a[k] !== b[k]) return false;
    }
    return true;
  }
  
  // ── Export ────────────────────────────────────────────────────────────────
  
  M.DiffEngine = Object.freeze({ diff, extractKey });
  
})(window.UREModules = window.UREModules || {});