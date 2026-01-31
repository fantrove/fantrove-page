/// <reference lib="webworker" />
self.onmessage = function(e: MessageEvent < any > ) {
  const { type, payload } = e.data || {};
  if (type === 'parseAndIndex') {
    const text = payload && payload.text;
    try {
      const db = JSON.parse(text);
      const apiEntries: [string, any][] = [];
      const idEntries: [string, any][] = [];
      const textEntries: [string, any][] = [];
      const catToTypeEntries: [string, any][] = [];
      
      function walk(obj: any, depth = 0) {
        if (depth > 50) return;
        if (Array.isArray(obj)) {
          for (let item of obj) walk(item, depth + 1);
        } else if (obj && typeof obj === 'object') {
          if (obj.api) apiEntries.push([obj.api, obj]);
          if (obj.id) idEntries.push([obj.id, obj]);
          if (obj.text) textEntries.push([obj.text, obj]);
          if (obj.category && Array.isArray(obj.category) && obj.id) {
            for (const cat of obj.category) {
              catToTypeEntries.push([cat.id, obj]);
            }
          }
          for (const k in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, k)) {
              walk(obj[k], depth + 1);
            }
          }
        }
      }
      
      walk((db as any)?.type || db);
      
      (self as any).postMessage({
        type: 'indexReady',
        payload: {
          apiEntries,
          idEntries,
          textEntries,
          catToTypeEntries
        }
      });
    } catch (err) {
      (self as any).postMessage({ type: 'indexError', payload: String((err && (err as any).message) || err) });
    }
  }
};