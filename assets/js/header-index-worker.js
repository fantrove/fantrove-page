// header-index-worker.js
// ✅ ปรับปรุง: Efficient indexing, optimized for large datasets
self.onmessage = function(e) {
 const { type, payload } = e.data || {};
 if (type === 'parseAndIndex') {
  const text = payload && payload.text;
  try {
   const db = JSON.parse(text);
   const apiEntries = [];
   const idEntries = [];
   const textEntries = [];
   const catToTypeEntries = [];
   
   function walk(obj, depth = 0) {
    if (depth > 50) return; // Prevent infinite recursion
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
   
   walk(db?.type || db);
   
   self.postMessage({
    type: 'indexReady',
    payload: {
     apiEntries,
     idEntries,
     textEntries,
     catToTypeEntries
    }
   });
  } catch (err) {
   self.postMessage({ type: 'indexError', payload: String(err && err.message || err) });
  }
 }
};