# Search System v3.0

> Unified, aerospace-grade search system for Fantrove.
> Consolidates legacy `search-engine.js` + `search-ui.js` into a single
> self-loading entry point — same pattern as the URE system.

## ไฟล์ในโฟลเดอร์นี้

```
search-system/
├── search.js                    ← Entry point (load ไฟล์นี้ใน HTML)
├── search-system.css            ← CSS เสริม (auto-inject)
├── MIGRATION.md                 ← คู่มือ migration จาก v2.x
├── README.md                    ← ไฟล์นี้
└── search-modules/              ← 13 modules
    ├── types.js                 ← JSDoc typedefs
    ├── config.js                ← Constants (Object.freeze)
    ├── state.js                 ← Shared mutable state
    ├── utils.js                 ← Stateless helpers
    ├── virtual-scroll.js        ← Legacy VSE (backup, URE used in prod)
    ├── url-history.js           ← Two-stack browser history
    ├── keyboard.js              ← Soft keyboard detection
    ├── rendering.js             ← URE-backed result rendering
    ├── suggestions.js           ← Multi-source suggestions + badges
    ├── input-bar.js             ← Input widget + clear button + icon
    ├── overlay.js               ← Fullscreen search overlay
    ├── engine.js                ← ★ NEW — comprehensive search engine
    └── search-service.js        ← Search orchestrator (rename จาก search.js)
```

## การใช้งาน

### HTML (เพิ่ม 1 บรรทัด)

```html
<script defer src="/assets/js/ure/ure.js?v=..."></script>
<script defer src="/assets/js/search-system/search.js?v=..."></script>
```

### Public API

```javascript
// UI orchestrator
window.__searchUI.init();
window.__searchUI.destroy();
window.__searchUI.getState();
window.__searchUI.getConfig();
window.__searchUI.querySuggestions('heart');

// Search engine (also available via window.SearchModules.SearchEngine)
window.SearchEngine.search('heart', 'all');
window.SearchEngine.querySuggestions('heart', 8);
window.SearchEngine.generateAllKeywords();
window.SearchEngine._internals.getDocs();
window.SearchEngine._internals.getTypeIndex();
window.SearchEngine._internals.getCategoryIndex();
window.SearchEngine._internals.getFuse();
window.SearchEngine._internals.isFuseReady();
```

## การปรับปรุงจาก v2.x

1. **Unified entry point** — 1 ไฟล์แทน 2 ไฟล์ (เหมือน `ure.js`)
2. **Comprehensive index** — index ครอบคลุม type names + category names + sub-names + descriptions
3. **Multi-source suggestions** — พิมพ์ "อี" เสนอ "อีโมจิ" (type), พิมพ์ "arr" เสนอ "Arrows" (category)
4. **Source badges in UI** — badge เล็กๆ บอกว่า suggestion มาจาก type/category/item
5. **Robust short queries** — single-char queries ได้ผลลัพธ์เสมอ (adaptive Fuse threshold)
6. **Aerospace standards** — fail-safe defaults, no silent failure, bounded loops, layered architecture

ดูรายละเอียดเต็มใน [`MIGRATION.md`](./MIGRATION.md).

## มาตรฐานการพัฒนา

ปฏิบัติตาม:
- [`AI_CODING_GUIDE.md`](../../fantrove-docs/AI_CODING_GUIDE.md) — IIFE pattern, 2-space indent, single quotes
- [`AI_FORBIDDEN.md`](../../fantrove-docs/AI_FORBIDDEN.md) — ห้าม ES modules, ห้าม React/jQuery
- [`02-Search-System.md`](../../fantrove-docs/02-Search-System.md) — เอกสารระบบ Search
