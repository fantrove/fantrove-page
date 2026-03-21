/**
 * @file index-worker.js
 * Web Worker — parses and indexes a database JSON into four lookup Maps.
 *
 * Note: DataService._buildSharedIndex() performs the same indexing on the main
 * thread with scheduler-aware yields. This worker exists for use cases where
 * the indexing must be offloaded to a background thread (e.g. very large datasets
 * or low-end devices where even yielded main-thread work causes jank).
 *
 * Message in:
 *   { type: 'parseAndIndex', payload: { text: string } }
 *
 * Message out (success):
 *   { type: 'indexReady', payload: { apiEntries, idEntries, textEntries, catToTypeEntries } }
 *
 * Message out (error):
 *   { type: 'indexError', payload: string }
 *
 * Each *Entries value is an array of [key, value] pairs suitable for
 * passing to `new Map(entries)` on the main thread.
 */

self.onmessage = function(e) {
  const { type, payload } = e.data || {};
  if (type !== 'parseAndIndex') return;
  
  const text = payload && payload.text;
  
  try {
    const db = JSON.parse(text);
    const apiEntries = [];
    const idEntries = [];
    const textEntries = [];
    const catToTypeEntries = [];
    
    /**
     * Iterative depth-first walk (avoids call-stack overflow on deep JSON).
     * @param {any} root
     */
    function walk(root) {
      const stack = [root];
      while (stack.length) {
        const obj = stack.pop();
        if (!obj || typeof obj !== 'object') continue;
        
        if (Array.isArray(obj)) {
          for (let i = obj.length - 1; i >= 0; i--) stack.push(obj[i]);
          continue;
        }
        
        if (obj.api) apiEntries.push([obj.api, obj]);
        if (obj.id) idEntries.push([obj.id, obj]);
        if (obj.text) textEntries.push([obj.text, obj]);
        
        if (obj.category && Array.isArray(obj.category) && obj.id) {
          for (const cat of obj.category) catToTypeEntries.push([cat.id, obj]);
        }
        
        for (const k in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, k)) {
            const v = obj[k];
            if (v && typeof v === 'object') stack.push(v);
          }
        }
      }
    }
    
    walk(db?.type || db);
    
    self.postMessage({
      type: 'indexReady',
      payload: { apiEntries, idEntries, textEntries, catToTypeEntries },
    });
    
  } catch (err) {
    self.postMessage({
      type: 'indexError',
      payload: String(err && err.message || err),
    });
  }
};