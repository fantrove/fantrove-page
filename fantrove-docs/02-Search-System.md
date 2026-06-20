# 02 — ระบบ Search (Search System)

> เอกสารนี้อธิบายระบบ Search ของ **Fantrove** — ระบบค้นหา client-side แบบ two-tier (substring + Fuse.js fuzzy) ที่ทำงานร่วมกับ URE สำหรับ virtual scroll rendering
>
> **สำหรับ:** AI และนักพัฒนาที่จะแก้/ขยายระบบ Search
>
> **ไฟล์หลัก:** `assets/js/search-engine.js` (Fuse engine singleton) + `assets/js/search-ui.js` (orchestrator, public API `window.__searchUI`) + `assets/js/search-modules/` (12 modules)
>
> **ครอบคลุม:** สถาปัตยกรรม, อัลกอริทึม, โมดูลทั้งหมด, การผสานรวมกับ URE, URL/History, performance

---

## สารบัญ

1. [ภาพรวมสถาปัตยกรรม](#1-ภาพรวมสถาปัตยกรรม)
2. [ไฟล์และโครงสร้างโมดูล](#2-ไฟล์และโครงสร้างโมดูล)
3. [ขั้นตอนการบูตและการโหลด](#3-ขั้นตอนการบูตและการโหลด)
4. [Search Engine — อัลกอริทึมค้นหา](#4-search-engine--อัลกอริทึมค้นหา)
5. [Two-Tier Search — ระบบค้นหาสองชั้น](#5-two-tier-search--ระบบค้นหาสองชั้น)
6. [ระบบ Suggestion (ข้อเสนอแนะ)](#6-ระบบ-suggestion-ข้อเสนอแนะ)
7. [การเรนเดอร์ผลลัพธ์และการผสาน URE](#7-การเรนเดอร์ผลลัพธ์และการผสาน-ure)
8. [Overlay — หน้าจอค้นหาเต็มจอ](#8-overlay--หน้าจอค้นหาเต็มจอ)
9. [ระบบ URL Routing และ History](#9-ระบบ-url-routing-และ-history)
10. [Virtual Scroll Engine](#10-virtual-scroll-engine)
11. [ระบบคีย์บอร์ด (Mobile)](#11-ระบบคีย์บอร์ด-mobile)
12. [ระบบ Input Bar, Filter, และ Icon](#12-ระบบ-input-bar-filter-และ-icon)
13. [Config, State, Types — ฐานรากของระบบ](#13-config-state-types--ฐานรากของระบบ)
14. [ตัวแปร Global และ Events](#14-ตัวแปร-global-และ-events)
15. [การเพิ่มประสิทธิภาพ (Performance)](#15-การเพิ่มประสิทธิภาพ-performance)
16. [วงจรชีวิต (Lifecycle)](#16-วงจรชีวิต-lifecycle)

---

## 1. ภาพรวมสถาปัตยกรรม

ระบบ Search ของ Fantrove ถูกออกแบบแบบ **modular architecture** ประกอบด้วย:

- **`search-engine.js`** — เอนจินค้นหาหลัก (IIFE, ไม่มี dependency) ใช้ **substring search** แบบเบาสำหรับผลลัพธ์ทันที และ **Fuse.js** สำหรับ fuzzy search ที่แม่นยำกว่า
- **`search-ui.js`** — Orchestrator ที่โหลดโมดูลทั้งหมดแบบ parallel phases, จัดการข้อมูล และบูตระบบ
- **`search-modules/`** — กลุ่มโมดูล 12 ไฟล์ แบ่งเป็น 5 phases ตาม dependency

### โครงสร้างข้อมูล (Data Shape)

ข้อมูลที่ป้อนเข้ามามีลักษณะ:

```
{
  type: [
    {
      name: { th: "อีโมจิ", en: "Emoji" },   // ชื่อประเภท (multilingual)
      category: [
        {
          name: { th: "หน้ายิ้ม", en: "Smileys" },
          data: [
            { name: { th: "ยิ้มแย้ม", en: "Grinning" }, api: "😀", text: "😀" },
            ...
          ]
        },
        ...
      ]
    },
    ...
  ]
}
```

### แผนภาพสถาปัตยกรรม

```
┌──────────────────────────────────────────────────────────────┐
│  HTML: <script defer src="search-ui.js">                     │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  search-ui.js (Orchestrator)                                 │
│  • Early data prefetch (_earlyDataPromise)                   │
│  • 5-phase parallel module loader                            │
│  • _boot() → init() → loadData() → SearchEngine.init()      │
│  • Popstate handler, form/Enter handlers                     │
│  • destroy() lifecycle                                       │
└────────────┬─────────────────────────────────┬───────────────┘
             │                                 │
             ▼                                 ▼
┌─────────────────────────┐    ┌──────────────────────────────┐
│  search-engine.js       │    │  search-modules/ (12 files)  │
│  • Immediate substring  │    │  Phase 1: types, config,     │
│    search (O(n))        │    │          state               │
│  • Fuse.js (CDN, async) │    │  Phase 2: utils,             │
│  • Keyword extraction   │    │          virtual-scroll      │
│  • Suggestion query     │    │  Phase 3: url-history,       │
│                         │    │    keyboard, rendering,      │
│  API: init(), search(), │    │    suggestions, input-bar    │
│  querySuggestions(),    │    │  Phase 4: overlay            │
│  generateAllKeywords()  │    │  Phase 5: search             │
└─────────────────────────┘    └──────────────┬───────────────┘
                                              │
                                              ▼
                               ┌──────────────────────────────┐
                               │  window.URE (External)       │
                               │  • Virtual scroll            │
                               │  • DOM pool recycling        │
                               │  • Diff engine               │
                               │  • Lazy asset loading        │
                               └──────────────────────────────┘
```

---

## 2. ไฟล์และโครงสร้างโมดูล

### ไฟล์หลัก

| ไฟล์ | บทบาท | Global API |
|------|--------|------------|
| `assets/js/search-engine.js` | เอนจินค้นหา (IIFE) | `window.SearchEngine` |
| `assets/js/search-ui.js` | Orchestrator/entry point | `window.__searchUI` |

### โมดูลย่อย (`search-modules/`)

| Phase | ไฟล์ | Service | หน้าที่ |
|-------|------|---------|---------|
| 1 | `types.js` | — | JSDoc typedef เท่านั้น ไม่มี runtime code |
| 1 | `config.js` | `CONFIG` | ค่าคงที่ทั้งหมด (timing, DOM IDs, i18n, icons) |
| 1 | `state.js` | `State`, `Handlers` | State กลาง + อ้างอิง event handlers สำหรับ destroy |
| 2 | `utils.js` | `LanguageService`, `DOMService`, `StringService`, `StorageService`, `NotificationService`, `HighlightService` | ฟังก์ชันช่วยเหลือที่ไร้ side-effect |
| 2 | `virtual-scroll.js` | `VirtualScrollEngine` | Virtual scroll O(1) DOM nodes (สำรอง, ปัจจุบันใช้ URE แทน) |
| 3 | `url-history.js` | `URLService` | จัดการ browser history แบบ two-stack model |
| 3 | `keyboard.js` | `KeyboardService`, `GapBasedKeyboardService`, `KeyboardAutoToggleService` | ตรวจจับ/จัดการ virtual keyboard บนมือถือ |
| 3 | `rendering.js` | `RenderingService`, `FilterService` | เรนเดอร์ผลลัพธ์ผ่าน URE + ตัวกรองประเภท/หมวดหมู่ |
| 3 | `suggestions.js` | `SuggestionService`, `ReadyModeService` | ข้อเสนอแนะระหว่างพิมพ์ + trending เมื่อ input ว่าง |
| 3 | `input-bar.js` | `UIService`, `IconSlotService`, `ClearBtnService` | จัดการ input bar, ปุ่มล้าง, ไอคอน search/back |
| 4 | `overlay.js` | `OverlayService` | จัดการ fullscreen search overlay |
| 5 | `search.js` | `SearchService` | ดำเนินการค้นหา จัดการ history commit, Fuse upgrade |

### Namespace

โมดูลทั้งหมดถูกจัดเก็บใน namespace เดียว:

```javascript
window.SearchModules = {
  CONFIG, State, Handlers,
  LanguageService, DOMService, StringService,
  StorageService, NotificationService, HighlightService,
  URLService, KeyboardService, GapBasedKeyboardService,
  KeyboardAutoToggleService, RenderingService, FilterService,
  SuggestionService, ReadyModeService, UIService,
  IconSlotService, ClearBtnService, OverlayService,
  SearchService, VirtualScrollEngine,
};
```

---

## 3. ขั้นตอนการบูตและการโหลด

### 3.1 Parallel Phase Loading

`search-ui.js` โหลดโมดูลแบบ **5 phases** เพื่อลด HTTP round trips จาก 12 ครั้ง (sequential) เหลือ 5 ครั้ง:

```javascript
const LOAD_PHASES = [
  // Phase 1: Pure foundation — โหลดพร้อมกัน 3 ไฟล์
  ['types.js', 'config.js', 'state.js'],
  // Phase 2: Core utilities — โหลดพร้อมกัน 2 ไฟล์
  ['utils.js', 'virtual-scroll.js'],
  // Phase 3: Feature modules — โหลดพร้อมกัน 5 ไฟล์
  ['url-history.js', 'keyboard.js', 'rendering.js', 'suggestions.js', 'input-bar.js'],
  // Phase 4: Overlay — โหลด 1 ไฟล์
  ['overlay.js'],
  // Phase 5: Search service — โหลด 1 ไฟล์
  ['search.js'],
];
```

**กลไก:** แต่ละ phase ใช้ `Promise.all()` โหลด parallel ภายใน phase แล้วใช้ `.reduce()` ต่อกันแบบ sequential ระหว่าง phase:

```javascript
function loadPhases(phases, base) {
  return phases.reduce(
    function (chain, phase) { return chain.then(() => loadPhase(phase, base)); },
    Promise.resolve()
  );
}
```

### 3.2 Early Data Prefetch

ข้อมูลเริ่มโหลด **ทันที** ที่ `search-ui.js` รัน — ก่อนที่โมดูลใดๆ จะโหลดเสร็จ:

```javascript
let _earlyDataPromise = (function () {
  return new Promise(function (resolve) {
    if (window.ConDataService?.getAssembled) {
      resolve(window.ConDataService.getAssembled().catch(() => null));
      return;
    }
    var attempts = 0;
    var MAX = 40;   // 40 × 20ms = 800ms window
    var id = setInterval(function () {
      attempts++;
      if (window.ConDataService?.getAssembled) {
        clearInterval(id);
        resolve(window.ConDataService.getAssembled().catch(() => null));
      } else if (attempts >= MAX) {
        clearInterval(id);
        resolve(null);
      }
    }, 20);
  });
})();
```

- Poll `ConDataService` ทุก 20ms สูงสุด 40 ครั้ง (800ms)
- ถ้า `ConDataService` ไม่พร้อม ให้ `loadData()` fallback ไป fetch `db.min.json` โดยตรง

### 3.3 ลำดับ Boot สมบูรณ์

```
search-ui.js รัน
  ├── _earlyDataPromise เริ่ม poll ConDataService (parallel)
  ├── loadPhase(1) → types, config, state
  ├── loadPhase(2) → utils, virtual-scroll
  ├── loadPhase(3) → url-history, keyboard, rendering, suggestions, input-bar
  ├── loadPhase(4) → overlay
  ├── loadPhase(5) → search
  └── _boot()
       ├── KeyboardService.initKeyboardDetection()
       ├── loadData() → ใช้ _earlyDataPromise (อาจเรียบร้อยแล้ว)
       │    └── fallback → fetch('/assets/db/db.min.json')
       ├── SearchEngine.init(data)
       │    ├── buildImmediateDocs() → พร้อมใช้ทันที
       │    └── scheduleBuildFuse() → สร้าง Fuse index ใน idle time
       ├── generateAllKeywords() → cache keywords
       ├── UIService.buildWrapper()
       ├── FilterService.setupTypeFilter('all')
       ├── UIService.setupAutoSearchInput()
       ├── _restoreLastCommitted()
       ├── Drain window.__pendingSearch (ถ้ามี)
       ├── URL-based search (ถ้า ?q=... อยู่ใน URL)
       ├── แนบ Form submit handler
       ├── แนบ Enter keydown handler
       └── แนบ popstate handler
```

---

## 4. Search Engine — อัลกอริทึมค้นหา

`search-engine.js` เป็น IIFE ที่ไม่มี dependency เลย โหลดอย่างอิสระ ผ่าน `<script>` tag แยก

### 4.1 โครงสร้างภายใน

```javascript
const SearchEngine = {
  // State ภายใน (private ผ่าน closure)
  _data,        // ข้อมูลดิบจาก ConDataService
  _docs,        // immediate docs (สำหรับ substring search)
  _keywords,    // keyword list (สำหรับ suggestions)
  _fuse,        // Fuse instance (สร้าง async ภายหลัง)
  _normalize,   // ฟังก์ชัน normalize text
  _options,     // configuration options
  _fuseBuilding,// flag ป้องกัน build ซ้ำ

  // Public API
  init(data, options),
  search(q, typeFilter),
  querySuggestions(q, maxCount),
  generateAllKeywords(),
  _internals: { normalizeText, flattenDataToDocs, buildImmediateDocs, getDocs, getFuse, options }
};
```

### 4.2 Text Normalization

ฟังก์ชัน `defaultNormalizeText()` ทำ normalize ลำดับดังนี้:

```javascript
function defaultNormalizeText(s) {
  s = String(s).toLowerCase().trim();
  // 1) NFKD normalization → ลบ combining diacritical marks
  s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  // 2) ลบ zero-width characters
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
  // 3) Normalize quotes (smart quotes → ASCII)
  s = s.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
       .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
  // 4) Fullwidth → ASCII (ภาษาญี่ปุ่น/จีน input)
  s = s.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  // 5) ลบ non-alphanumeric (ยกเว้น Unicode letters/numbers)
  s = s.replace(/[^\p{L}\p{N}\s]+/gu, ' ');
  // 6) ย่อ spaces หลายตัวเป็นตัวเดียว
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}
```

### 4.3 การ Build Documents

มีสองฟังก์ชัน build documents:

**`buildImmediateDocs(data)`** — เบา ใช้สำหรับ substring search ทันที:
- ไม่ทำ normalization หนัก
- รวม name + api + text + typeNames + catNames เป็น `combined` string
- สร้าง `doc` object และ `keyword` entry สำหรับแต่ละ item

**`flattenDataToDocs(data, normalizeFn)`** — เต็มรูปแบบ ใช้สำหรับ Fuse.js:
- ทำ normalization ผ่าน `normalizeFn` ที่ส่งเข้ามา
- รวม field เพิ่มเติม: `*_name` fields (เช่น `short_name`, `official_name`)
- ใช้เมื่อสร้าง Fuse index เท่านั้น

### 4.4 การตรวจจับภาษา (Language Detection)

ระบบตรวจจับภาษาอัตโนมัติจากข้อมูล:

```javascript
// สแกนทุก type → category → item หาคีย์ภาษาใน name objects
const langsSet = Object.create(null);
for (let i=0; i<data.type.length; i++){
  const t = data.type[i];
  if (typeof t.name === 'object') for (const k in t.name) langsSet[k]=1;
  // ... เดียวกันสำหรับ category และ item names
}
const langs = Object.keys(langsSet).length ? Object.keys(langsSet) : ['en'];
```

ฟังก์ชัน `pickLang(obj, langs)` เลือกภาษาแรกที่มีใน object ตามลำดับ priority ของ `langs` array

### 4.5 Fuse.js Configuration

Fuse.js โหลดจาก CDN แบบ lazy:

```javascript
function ensureFuseLoaded() {
  return new Promise((resolve, reject) => {
    if (global.Fuse) return resolve(global.Fuse);
    const src = 'https://unpkg.com/fuse.js@6.6.2/dist/fuse.min.js';
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve(global.Fuse);
    s.onerror = () => reject(new Error('Failed to load Fuse.js'));
    document.head.appendChild(s);
  });
}
```

ค่า Fuse options ที่ใช้:

```javascript
const defaultFuseOpts = {
  includeScore: true,
  threshold: 0.38,          // ความเข้มงวด (ยิ่งต่ำยิ่งเข้มงวด)
  ignoreLocation: true,     // ไม่สนตำแหน่ง match
  minMatchCharLength: 2,    // ต้อง match อย่างน้อย 2 ตัวอักษร
  useExtendedSearch: false,
  keys: [
    { name: 'name',     weight: 0.6 },  // ชื่อ item
    { name: 'api',      weight: 0.9 },  // API/code (สำคัญที่สุด)
    { name: 'combined', weight: 0.5 },  // ข้อความรวม
    { name: 'text',     weight: 0.2 },  // เนื้อหา
  ]
};
```

### 4.6 กำหนดการสร้าง Fuse Index

Fuse index สร้างใน **idle time** เพื่อไม่ block UI:

```javascript
function scheduleBuildFuse() {
  if (_fuseBuilding || !_data) return;
  _fuseBuilding = true;

  const build = async () => {
    const Fuse = await ensureFuseLoaded();
    const { docs, keywords } = flattenDataToDocs(_data, _normalize);
    _fuse = new Fuse(docs, fuseOpts);
    _keywords = keywords; // อัปเดต keywords ด้วย normalized versions
    _fuseBuilding = false;
  };

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(build, { timeout: 4000 });
  } else {
    // อุปกรณ์ low-end: delay ยาวขึ้น
    const cores = navigator.hardwareConcurrency || 4;
    const delay = cores <= 2 ? Math.max(1000, 4000) : 100;
    setTimeout(build, delay);
  }
}
```

---

## 5. Two-Tier Search — ระบบค้นหาสองชั้น

ระบบค้นหาของ Fantrove ใช้ **สองชั้น** เพื่อสร้างสมดุลระหว่างความเร็วและความแม่นยำ:

### Tier 1: Immediate Substring Search

พร้อมใช้ทันทีหลัง `init()` — ไม่ต้องรอ Fuse index

```javascript
function immediateSearch(qRaw, typeFilter, limit) {
  const q = String(qRaw || '').trim();
  const nq = q.toLowerCase();
  const results = [];
  limit = limit || 200;

  for (let i = 0; i < _docs.length && results.length < limit; i++) {
    const d = _docs[i];
    // กรองตาม typeFilter
    if (typeFilter && typeFilter !== 'all') {
      if ((d.typeKey || '').toLowerCase() !== String(typeFilter).toLowerCase()) continue;
    }
    // Substring match แบบ case-insensitive
    const hay = ((d.name || '') + ' ' + (d.api || '') + ' ' + (d.combined || '')).toLowerCase();
    if (hay.indexOf(nq) >= 0) {
      results.push({
        typeObj: d.typeObj,
        category: d.category,
        item: d.rawItem,
        typeName: d.typeKey,
        catName: d.categoryKey,
        itemName: d.name || '',
        lang: 'auto',
        fuzzy: false,          // ไม่ใช่ fuzzy match
        fuzzyScore: null,
        matchExact: (hay === nq)  // ตรงทั้งหมดพอดี
      });
    }
  }
  return { results, keywords: generateAllKeywords() };
}
```

**ลักษณะ:**
- เวลา: O(n) เช็กทุก doc
- ไม่มี normalization หนัก
- จำกัดผลลัพธ์สูงสุด 200 รายการ (`fastImmediateLimit`)
- `matchExact: true` เมื่อข้อความตรงกันพอดี

### Tier 2: Fuse.js Fuzzy Search

ใช้เมื่อ Fuse index สร้างเสร็จแล้ว — ให้ผลลัพธ์ที่แม่นยำกว่า

```javascript
function search(qRaw, typeFilter) {
  const q = String(qRaw || '').trim();
  if (!q) return { results: [], keywords: generateAllKeywords() };

  if (_fuse) {
    // Tier 2: Fuse.js search
    const fuseResults = _fuse.search(q, { limit: 200 });
    const results = fuseResults.map(r => ({
      ...extractFields(r.item),
      fuzzy: (r.score > 0),
      fuzzyScore: r.score,
      matchExact: (r.score === 0)
    }));
    return { results, keywords: generateAllKeywords() };
  } else {
    // Fallback: Tier 1 immediate search
    return immediateSearch(qRaw, typeFilter);
  }
}
```

### การสลับ Tier อัตโนมัติ

ระบบสลับอัตโนมัติโดยไม่ต้องแทรกแซง:

```
เวลา t=0:   SearchEngine.init() → immediate docs พร้อม → substring search ใช้ได้
เวลา t~1s:  Fuse index สร้างเสร็จ (idle time) → search() ใช้ Fuse อัตโนมัติ
```

### Fuse Upgrade สำหรับ URL Search

เมื่อโหลดหน้าด้วย `?q=hello` ระบบแสดงผล substring ทันที แล้ว upgrade เป็น Fuse อย่างเงียบ:

```javascript
function _scheduleFuseUpgrade(q, type) {
  const CHECK_INTERVAL_MS = 500;
  const MAX_WAIT_MS = 8000;

  (function checkFuse() {
    const ready = window.SearchEngine?._internals?.getFuse?.() != null;
    const still = inp?.value?.trim() === q;

    if (ready && still) {
      // Fuse พร้อม และ query ยังเดียวกัน → รันค้นหาใหม่ด้วย Fuse
      let out = window.SearchEngine.search(q, type);
      RenderingService.renderResults(out.results);
      return;
    }
    if (!ready && Date.now() - started < MAX_WAIT_MS) {
      _fuseUpgradeTimer = setTimeout(checkFuse, CHECK_INTERVAL_MS);
    }
  })();
}
```

---

## 6. ระบบ Suggestion (ข้อเสนอแนะ)

### 6.1 querySuggestions() — Search Engine ระดับ

ฟังก์ชัน `querySuggestions(rawQuery, maxCount)` ใช้ **3 ชั้น fallback**:

```javascript
function querySuggestions(rawQuery, maxCount) {
  maxCount = maxCount || 8;
  const nq = _normalize ? _normalize(q) : q.toLowerCase();
  const out = [];
  const seen = new Set();

  // ชั้น 1: Keyword prefix match (จาก immediate keywords)
  for (const k of _keywords) {
    if (String(k.key).indexOf(nq) === 0) {  // prefix match
      if (seen.has(k.key)) continue;
      seen.add(k.key);
      out.push({ display: k.raw, source: 'keyword' });
    }
  }
  if (out.length >= maxCount) return out;

  // ชั้น 2: Fuse suggestions (ถ้าพร้อม)
  if (_fuse && q.length >= 1) {
    const fuseRes = _fuse.search(q, { limit: 12 });
    for (const r of fuseRes) {
      // ... เพิ่มจากผลลัพธ์ Fuse
      out.push({ display, source: 'fuse', score: r.score });
    }
  }

  // ชั้น 3: Immediate doc scan fallback
  else {
    for (const d of _docs) {
      const norm = String(d.name).toLowerCase();
      if (norm.indexOf(nqSimple) === 0 && !seen.has(norm)) {
        out.push({ display: d.name, source: 'immediate' });
      }
    }
  }
  return out;
}
```

### 6.2 ReadyModeService — Trending แบบ Smart

เมื่อ overlay เปิดและ input ว่าง ระบบแสดง "trending" suggestions:

```javascript
extractSmartNames() {
  for (const kw of State.allKeywordsCache) {
    const name = kw.item.name?.[lang] || kw.item.name?.en || '';
    // กรอง: ข้ามชื่อสั้นๆ ที่เป็น ASCII ล้วน (internal API codes)
    if (!/[\u0E00-\u0E7F]/.test(name) && /^[A-Za-z0-9_\-]+$/.test(name) && name.length <= 20)
      continue;
    if (!name || name.length < 2) continue;
    // ... เก็บไว้แสดง
  }
}
```

### 6.3 SuggestionService — UI Layer

รับผิดชอบ:
- `renderQuerySuggestions(query)` — เรนเดอร์ข้อเสนอแนะขณะพิมพ์ พร้อม highlight ตัวอักษรที่ match
- `handleKeydown(ev, container)` — นำทางด้วย Arrow keys, Enter, Escape
- `handleClick(ev)` — เลือก suggestion → เติมใน input → ค้นหาทันที

ข้อความที่แสดงใช้ `HighlightService.highlight()` เพื่อ highlight ตัวอักษรที่ match:

```javascript
html += `<div class="suggestion-item" data-val="${encodeUrl(s.raw)}">
  <div class="suggestion-body">${HighlightService.highlight(s.raw, query)}</div>
</div>`;
```

### 6.4 HighlightService — Thai Grapheme Cluster Support

ระบบ highlight จัดการ **Thai diacritics** อย่างถูกต้อง:

```javascript
highlight(text, query) {
  // สร้าง Set ของตัวอักษร query (cache ไว้ใช้ซ้ำทั้ง batch)
  if (q !== this._lastQuery) {
    this._lastQuery = q;
    this._lastChars = new Set(q);
  }

  const clusters = this._graphemeClusters(text); // แบ่งเป็น grapheme clusters
  for (const cluster of clusters) {
    // Escape HTML ทั้ง cluster
    let esc = '';
    for (const c of cluster) {
      esc += c === '&' ? '&amp;' : c === '<' ? '&lt;' : ...;
    }
    // Highlight ถ้า cluster ใดมีตัวอักษร match ใดๆ
    const match = cluster.toLowerCase().split('').some(c => chars.has(c));
    out += match ? `<mark>${esc}</mark>` : esc;
  }
}
```

**การแบ่ง Grapheme Clusters:**

```javascript
_graphemeClusters(text) {
  // Modern path: Intl.Segmenter (Chrome 87+, Safari 16.4+, FF 125+)
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(seg.segment(text), s => s.segment);
  }
  // Fallback: manual Thai combining char grouping
  // Thai combining range: U+0E30–U+0E4E (sara, tone marks, etc.)
  // General combining: U+0300-U+036F, U+1AB0-U+1AFF, U+20D0-U+20FF
}
```

**ทำไมต้องใช้ Grapheme Clusters:**
> สระไทย (U+0E30–U+0E4E) เป็น combining characters ที่ render ต่อท้ายพยัญชนะฐาน
> ถ้า wrap เฉพาะสระด้วย `<mark>` → สระจะลอยห่างจากพยัญชนะ (visual displacement)
> วิธีแก้: ใช้ grapheme cluster = พยัญชนะ + สระ + วรรณยุกต์ ถูก highlight พร้อมกัน

---

## 7. การเรนเดอร์ผลลัพธ์และการผสาน URE

### 7.1 การผสานกับ URE (Universal Render Engine)

`rendering.js` ใช้ **URE** (`window.URE`) สำหรับเรนเดอร์ผลลัพธ์แทน VirtualScrollEngine แบบเดิม

**การ mount ครั้งแรก:**

```javascript
_searchHandle = window.URE.mount({
  container,       // #searchResults element
  data    : filtered,     // SearchResult[]
  template: (item, l) => this.renderResultItem(item, l),
  lang,                 // 'th' หรือ 'en'
  buffer  : 700,          // overscan pixels
  recycling: true,       // เปิด DOM pool recycling
  keyField: 'api',       // ใช้ api field เป็น key สำหรับ diff
});
```

**การอัปเดต (ค้นหาใหม่):**

```javascript
if (_searchHandle) {
  _searchHandle.setLang(lang);
  _searchHandle.setData(filtered);  // URE diff engine เรนเดอร์เฉพาะที่เปลี่ยน
} else {
  // Mount ใหม่ถ้าไม่มี handle
}
```

**ทำไมต้องใช้ URE แทน VirtualScrollEngine:**
- URE จัดการ virtual scroll, DOM pool, diffing, lazy assets — ไร้ config
- `setData()` ใช้ diff engine → เรนเดอร์เฉพาะ nodes ที่เปลี่ยน → ประหยัด CPU
- ไม่ต้องทำลายและสร้างใหม่ทุกครั้ง → ลด GC pressure

### 7.2 renderResultItem() — Template Function

สร้าง HTML สำหรับแต่ละการ์ดผลลัพธ์:

```javascript
renderResultItem(item, lang) {
  const data     = item.item || item;
  const rawText  = data?.text || '';
  const itemText = rawText || data?.name?.[lang] || data?.name?.en || item.itemName || '';
  const itemApi  = data?.api || '';

  const typeName = item.typeObj?.name?.[lang] || item.typeObj?.name?.en || item.typeName || 'อีโมจิ';
  const catName  = item.category?.name?.[lang] || item.category?.name?.en || item.catName || '';
  const nameStr  = data?.name?.[lang] || data?.name?.en || item.itemName || '';

  const text     = itemText || itemApi || '-';
  const vertical = text.length > 45 || text.indexOf('\n') !== -1 || _wordCount(text) > 7;
  const disp     = text.length > 300 ? text.slice(0, 300) : text;

  // data-name ส่งชื่อ item (encoded) ไปยัง showCopyNotification
  const encodedName = nameStr ? StringService.encodeUrl(nameStr) : '';

  return `<div class="sc${vertical ? ' sv' : ''}" role="button" tabindex="0"
    aria-label="${esc(nameStr || text)}"
    data-text="${encodeUrl(text)}"
    data-name="${encodedName}">
    <div class="scc" aria-hidden="true">${esc(disp)}</div>
    <div class="scb">
      <div class="sct">${esc(titleStr)}</div>
      <div class="scs">${esc(subStr)}</div>
      ${tags ? `<div class="scg">${tags}</div>` : ''}
    </div>
  </div>`;
}
```

**โครงสร้าง DOM ของการ์ด:**
```
.sc (search card) — role="button", tabindex="0"
├── .scc (content) — ข้อความหลัก (emoji, text)  aria-hidden
└── .scb (bottom bar)
    ├── .sct (title) — ชื่อ item
    ├── .scs (subtitle) — API code หรือ type name
    └── .scg (tags) — type + category tags
```

### 7.3 การจัดการ Category Filter

`extractResultCategories()` ดึงหมวดหมู่ที่ไม่ซ้ำจากผลลัพธ์:

```javascript
extractResultCategories(results) {
  const lang = LanguageService.getLang();
  const seen = Object.create(null);
  for (const r of results) {
    const k = (r.category?.name?.[lang] || r.category?.name?.en) || '';
    if (!seen[k]) { seen[k] = 1; out.push({ key: k, displayName: k }); }
  }
  return out;
}
```

### 7.4 Copy Handler

ใช้ **delegated event** บน container — แนบครั้งเดียวตอน mount ครั้งแรก:

```javascript
_attachCopyHandler(container) {
  if (window._copyResultTextHandlerSet) return;

  const _copy = (card) => {
    const text = StringService.decodeUrl(card.getAttribute('data-text'));
    const name = StringService.decodeUrl(card.getAttribute('data-name') || '');
    NotificationService.copyText(text, name || undefined);
  };

  Handlers.copyClick = (e) => {
    const card = e.target.closest('.sc');
    if (card) { e.preventDefault(); _copy(card); }
  };
  DOMService.on(container, 'click', Handlers.copyClick);

  // Keyboard: Enter/Space บนการ์ดก็คัดลอกได้
  DOMService.on(container, 'keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const card = e.target.closest('.sc');
      if (card) { e.preventDefault(); _copy(card); }
    }
  });

  window._copyResultTextHandlerSet = true;
}
```

`NotificationService.copyText()` ใช้ `navigator.clipboard.writeText()` และเรียก `window.showCopyNotification()` ที่ถูกโหลดมาจาก `copyNotification.js` แยกต่างหาก:

```javascript
async copyText(text, name) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    // Fallback: execCommand('copy')
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  window.showCopyNotification?.({ text, name, lang });
}
```

---

## 8. Overlay — หน้าจอค้นหาเต็มจอ

### 8.1 โครงสร้าง DOM

```
#searchOverlayContainer (position:fixed, full screen, z-index:9998)
├── #overlay-header-bar
│    └── .search-input-wrapper  ← ย้ายมาจาก header ชั่วคราว
│         ├── .search-input-icon (🔍 หรือ ←)
│         ├── #searchInput
│         └── #search-clear-btn
└── .search-overlay-scrollable-content (flex:1, overflow:auto)
     └── #searchSuggestions
          ├── .suggestions-head ("ข้อเสนอแนะ" / "Suggestions")
          └── .suggestion-item × N
```

**ผลลัพธ์ค้นหาอยู่บนหน้าหลัก** (`#searchResults`) — **ไม่อยู่ใน overlay**

### 8.2 การเปิด Overlay

```javascript
open() {
  // 1. กำหนด scrollRestoration = 'manual' (ป้องกัน browser auto-restore)
  _scrollRestorationOrig = history.scrollRestoration;
  history.scrollRestoration = 'manual';

  // 2. Snapshot state ก่อนเปิด
  State.preOverlayState = { q: inp.value, type, category };

  // 3. สร้าง/เคลียร์ overlay container
  // 4. ย้าย .search-input-wrapper เข้า overlay header
  // 5. สร้าง scrollable content area + suggestions container

  // 6. Scroll-lock แบบไม่ทำให้ layout ขยับ
  const _savedScrollY = window.scrollY;
  window.scrollTo({ top: 0, behavior: 'instant' });
  document.body.style.position = 'fixed';
  document.body.style.top = `-${_savedScrollY}px`;
  document.body.style.width = '100%';

  // 7. แนบ Escape handler
  // 8. ซ่อน nav
  // 9. Push overlay history entry (Stack B)
  URLService.pushOverlayEntry(State.preOverlayState);

  // 10. เคลียร์ transitioning flag → render suggestions → focus input
  State.overlayTransitioning = false;
  if (currentQ) SuggestionService.renderQuerySuggestions(currentQ);
  else ReadyModeService.renderReadyModeSuggestions();
}
```

### 8.3 การปิด Overlay (Sole Authority)

`OverlayService.close()` **เป็นฟังก์ชันเดียว** ที่มีสิทธิ์ปิด overlay:

```javascript
close(src = 'manual') {
  // ① History — collapse หรือ clear overlay entry
  if (src === 'popstate') {
    State.overlayHistoryPushed = false;
  } else {
    URLService.collapseOverlayEntry(closingState);
  }

  // ② Cleanup keyboard auto-toggle
  KeyboardAutoToggleService.disableAutoToggle();

  // ③ คืน .search-input-wrapper ไป header ตำแหน่งเดิม
  wrapper.parentNode.insertBefore(wrapper, State._wrapperNext);

  // ④ ลบ overlay DOM
  DOMService.remove(DOMService.get('searchOverlayContainer'));

  // ⑤ คืน scroll-lock
  document.body.style.position = '';
  document.body.style.top = '';
  window.scrollTo({ top: savedScrollY, behavior: 'instant' });
  history.scrollRestoration = _scrollRestorationOrig;

  // ⑥ ลบ document keydown listener
  // ⑦ Reset overlay state fields
  // ⑧ Update icon slot
  // ⑨ แสดง nav อีกครั้ง
}
```

**เส้นทางการปิดทั้งหมด:**
| ที่มา | ตัวอย่าง | วิธีเรียก |
|--------|---------|----------|
| Escape key | กดปุ่ม Escape | `close('escape')` |
| ปุ่มย้อนกลับ | กด ← ใน icon slot | `history.back()` → popstate → `close('popstate')` |
| หลังค้นหา | กด Enter หรือเลือก suggestion | `close('manual')` |
| destroy() | ทำลายระบบ | `close('manual')` |

### 8.4 Scroll Lock Technique

ใช้เทคนิคที่ไม่ทำให้ layout ขยับ (Bootstrap/MUI pattern):

```
เปิด:
  saved = window.scrollY
  window.scrollTo(0)                    // เลื่อนขึ้นบนก่อน (overlay inset:0 ต้องตรง)
  body.style.position = 'fixed'         // ล็อกตำแหน่ง
  body.style.top = -saved + 'px'        // รักษาตำแหน่งที่ตาเห็น
  body.style.width = '100%'             // ป้องกัน scrollbar หาย → หน้ากว้างขึ้น

ปิด:
  body.style.position = ''              // ปลดล็อก
  body.style.top = ''
  window.scrollTo(saved)                // กลับตำแหน่งเดิม
  history.scrollRestoration = original  // คืนค่า
```

---

## 9. ระบบ URL Routing และ History

### 9.1 Two-Stack History Model

ระบบใช้ **สอง stacks** ใน browser history:

```
Stack A — Search entries (สร้างโดย commitSearch → pushState)
Stack B — Overlay entry  (สร้างโดย pushOverlayEntry, ยุบโดย collapseOverlayEntry)
```

**ตัวอย่าง flow:**

```
[init] → ผู้ใช้พิมพ์ "hello" → Enter → overlay ปิด → ผู้ใช้พิมพ์ "world"

History stack:
  [init] → [hello] → open overlay → search "world" → close overlay

After collapseOverlayEntry():
  [init] → [hello] → [world]    ← overlay entry ถูก replace ไม่ใช่ push ใหม่
```

**ผลลัพธ์สุทธิ:** เปิด overlay + ค้นหา = **push เพียง 1 ครั้ง**

### 9.2 URLService API

```javascript
URLService = {
  // Query string utilities
  parseQS(qs),              // '?q=hello&type=all' → { q: 'hello', type: 'all' }
  buildQS(obj),             // { q: 'hello' } → '?q=hello'
  readStateFromURL(),       // อ่าน state จาก URL ปัจจุบัน
  buildUrlForState(st),     // สร้าง URL จาก state (ละค่า default)

  // Stack A: search commits
  commitSearch(searchState),    // pushState (ค้นหาใหม่)
  replaceSearch(searchState),   // replaceState (URL init, ล้าง)

  // Stack B: overlay
  pushOverlayEntry(searchState),     // pushState + __searchUI_overlay_open__ marker
  collapseOverlayEntry(searchState), // replaceState — ยุบ overlay entry

  isEqual(a, b),  // เปรียบเทียบ state (ignore timestamp)
};
```

### 9.3 Overlay State Marker

Entry ของ overlay ถูกทำเครื่องหมายด้วย:

```javascript
State._overlayStateMarker = '__searchUI_overlay_open__';

// เมื่อ push:
const st = { ...searchState, [State._overlayStateMarker]: true };
history.pushState(st, '', location.href);

// เมื่อ popstate:
const isOverlayEntry = !!s[State._overlayStateMarker];
```

### 9.4 Popstate Handler

```javascript
Handlers.popstate = function (e) {
  const s = e.state || {};
  const isOverlayEntry = !!s[State._overlayStateMarker];

  if (State.overlayOpen) {
    // Case 1: overlay เปิดอยู่ → ปิด overlay
    OverlayService.close('popstate');
    if (!isOverlayEntry && s.q !== undefined) {
      // กลับไป state ค้นหาก่อนหน้า → restore UI
      setTimeout(() => _restoreUIState(backState), 50);
    }
    return;
  }

  if (isOverlayEntry) {
    // Case 2: กลับเข้ามาที่ overlay entry (ไม่ควรเกิดปกติ)
    URLService.replaceSearch(st);
    _restoreUIState(st);
    return;
  }

  // Case 3: กลับไป state ค้นหาอื่น
  _restoreUIState(st);
};
```

### 9.5 Session Storage History

```javascript
StorageService = {
  getHistory() {
    return JSON.parse(sessionStorage.getItem('searchHistory_v1') || '[]');
  },
  addSearchToHistory(entry) {
    const arr = this.getHistory();
    arr.push({ ...entry, ts: Date.now() });
    sessionStorage.setItem('searchHistory_v1', JSON.stringify(arr));
  }
};
```

---

## 10. Virtual Scroll Engine

> **หมายเหตุ:** ปัจจุบัน `rendering.js` ใช้ **URE** แทน VirtualScrollEngine สำหรับเรนเดอร์ผลลัพธ์ค้นหา อย่างไรก็ตาม VirtualScrollEngine ยังคงอยู่ใน codebase และถูก export ผ่าน `SearchModules`

### 10.1 หลักการ O(1) DOM

```
┌──────────────────────────────────────────────────────────────┐
│  Memory model                                                │
│                                                              │
│  _vis  Map    visible nodes only   ≈ 30-40 nodes    O(1)   │
│  _pool []     recycled nodes       ≤ POOL_MAX=40    O(1)   │
│  _idxMap Map  node → index         ≈ 30-40 entries  O(1)   │
│  _hgt  F32    height per item      4B × n           O(n)†  │
│  _off  F64    cumul. offsets       8B × n           O(n)†  │
│  DOM nodes    always ~30-40        regardless of n   O(1)  │
│                                                              │
│  † 10,000 items = 120KB. 100,000 items = 1.2MB. Fine.       │
└──────────────────────────────────────────────────────────────┘
```

### 10.2 การทำงานหลัก

```javascript
mount(viewport, host, items, renderFn, lang) {
  // สร้าง container div สูง = total height ของ items ทั้งหมด
  const box = document.createElement('div');
  box.className = 'vs-container';
  box.style.height = `${this._total}px`;

  // ResizeObserver สำหรับวัดความสูงจริงของ cards
  this._cardRO = new ResizeObserver((e) => this._onCardsResized(e));
  this._vpObs  = new ResizeObserver(() => { this._coOffDirty = true; this._sched(); });

  // Scroll handler (passive, rAF-scheduled)
  this._onScroll = () => { this._scrolling = true; this._sched(); };
  this._scrollTarget.addEventListener('scroll', this._onScroll, { passive: true });
}
```

### 10.3 Render Loop

```javascript
_render() {
  // Phase 1: reads (scrollTop, viewport height, container offset)
  const st = this._scrollTop();
  const vh = this._viewportH();
  const co = this._getCoOff();
  const si = this._find(Math.max(0, st - co - OVERSCAN));    // start index
  const ei = Math.min(n-1, this._find(st - co + vh + OVERSCAN) + 1);  // end index

  // Phase 2: writes (recycle + create)
  // 1. Recycle nodes ที่ออกจาก viewport เข้า pool
  for (const [idx, el] of this._vis) {
    if (idx < si || idx > ei) {
      this._pool.push(el);  // หรือ el.remove() ถ้า pool เต็ม
    }
  }
  // 2. สร้าง/รีไซเคิล nodes สำหรับ items ใน viewport
  for (let i = si; i <= ei; i++) {
    let el = this._pool.pop();  // ดึงจาก pool
    if (!el) el = document.createElement('div');  // สร้างใหม่
    el.style.transform = `translateY(${this._off[i]}px)`;
    el.innerHTML = this._fn(this._items[i], this._lang);
  }
}
```

### 10.4 การวัดความสูงแบบ Dynamic

ใช้ `ResizeObserver` + rate-limited correction (64ms):

```javascript
_onCardsResized(entries) {
  for (const entry of entries) {
    const idx = this._idxMap.get(entry.target);
    const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
    if (h > 4 && Math.abs(h - this._hgt[idx]) > 2) {
      this._hgt[idx] = h;
      dirty = true;
    }
  }
  // Rate-limited: 100ms ครั้งละสูงสุด
  if (dirty && !this._correctTimer) {
    this._correctTimer = setTimeout(() => this._applyCorrection(), wait);
  }
}
```

### 10.5 ทำไม _preRendered ถูกลบ

> เคยมี `Map<index, DocumentFragment>` สำหรับ pre-render ทุก item ใน idle time
> **ปัญหา:** 10,000 items × ~3KB = ~30MB → OOM บนมือถือรุ่นเก่า
> **แก้:** innerHTML ≈ 0.3ms/card × 30 visible = ~10ms → ยังอยู่ใน 16.7ms budget

---

## 11. ระบบคีย์บอร์ด (Mobile)

### 11.1 KeyboardService — การตรวจจับ

ตรวจจับ virtual keyboard โดยเปรียบเทียบ viewport height:

```javascript
initKeyboardDetection() {
  State.lastWindowInnerHeight = window.innerHeight;

  if ('visualViewport' in window) {
    // Modern: visualViewport ให้ความสูงที่คำนึง keyboard แล้ว
    window.visualViewport.addEventListener('resize', () => {
      setTimeout(() => this._update(), 100);
    });
  } else {
    // Fallback: window resize
    window.addEventListener('resize', onResize);
  }
}

_update() {
  const cur = window.visualViewport?.height || window.innerHeight;
  const diff = State.lastWindowInnerHeight - cur;
  if (diff > 100)       State.keyboardOpen = true;   // ลดลง > 100px = keyboard เปิด
  else if (diff < -100) State.keyboardOpen = false;  // เพิ่ม > 100px = keyboard ปิด
  State.lastWindowInnerHeight = cur;
}
```

### 11.2 GapBasedKeyboardService — ป้องกัน Oscillation

ป้องกันการเปิด/ปิด keyboard ซ้ำเร็วเกินไป:

```javascript
GapBasedKeyboardService = {
  isGapExpired:      () => (Date.now() - lastToggle) >= 300,   // ค่าต่ำสุด 300ms
  isRecoveryExpired: () => (Date.now() - lastToggle) >= 800,   // recovery 800ms
  recordToggle:      () => { lastToggle = Date.now(); },
  markScroll:        () => { isScrolling = true; clearTimeout(idleTimer); /* reset after 500ms */ },
};
```

### 11.3 KeyboardAutoToggleService

จัดการ keyboard อัตโนมัติขณะ scroll ใน overlay:

```
เลื่อนลง (scrollTop เพิ่ม) → blur input → ปิด keyboard
เลื่อนขึ้นกลับบนสุด (scrollTop === 0) → focus input → เปิด keyboard
```

```javascript
enableAutoToggle(sc) {
  State.keyboardAutoToggleHandler = () => {
    const cur = el.scrollTop;

    if (cur === 0 && lastScroll > 0) {
      // กลับบนสุด → เปิด keyboard (ถ้า gap หมด)
      if (isGapExpired() || isRecoveryExpired()) {
        inp.focus();
        recordToggle();
      }
    } else if (cur > 0 && lastScroll === 0) {
      // เริ่มเลื่อนลง → ปิด keyboard
      if (isGapExpired()) {
        inp.blur();
        recordToggle();
      }
    }
    lastScroll = cur;
  };
  el.addEventListener('scroll', handler, { passive: true });
}
```

---

## 12. ระบบ Input Bar, Filter, และ Icon

### 12.1 IconSlotService — สลับไอคอน

3 โหมดของไอคอน:

```
A) Overlay เปิด           → ← (back arrow) → history.back()
B) หน้าหลัก + มี query    → ← (back arrow) → history.back() (Stack A)
C) หน้าหลัก, ไม่มี query  → 🔍 (search icon, non-interactive)
```

> **ทำไมต้อง `history.back()` ไม่ใช่ `OverlayService.close()` โดยตรง?**
> `close()` ใช้ `replaceState` — ทิ้ง entry ไว้ใน stack
> `history.back()` POP entry แบบ native → popstate ไฟร์ → `close('popstate')` ทำคลีนอัพถูกต้อง

```javascript
update() {
  const hasQuery = (DOMService.get('searchInput')?.value || '').trim().length > 0;
  const showBack = State.overlayOpen || hasQuery;

  if (showBack) {
    slot.innerHTML = CONFIG.Icons.back;
    this._clickHandler = (e) => { e.preventDefault(); history.back(); };
    slot.addEventListener('click', this._clickHandler);
  } else {
    slot.innerHTML = CONFIG.Icons.search;
    slot.style.pointerEvents = 'none';
  }
}
```

### 12.2 ClearBtnService — ปุ่มล้าง

```javascript
build() {
  const btn = document.createElement('button');
  btn.id = 'search-clear-btn';
  btn.innerHTML = CONFIG.Icons.clear;
  btn.addEventListener('click', (e) => {
    inp.value = '';
    inp.focus();
    this.sync();
    IconSlotService.update();
    SearchService.doSearch(null, false);
  });
}

sync() {
  const hasText = (inp?.value || '').length > 0;
  btn.style.display = hasText ? 'flex' : 'none';
}
```

### 12.3 UIService — Input Event Handlers

```javascript
setupAutoSearchInput() {
  // Debounced: อัปเดต suggestions + clear-btn + icon ทุก keystroke
  Handlers.inputInput = () => {
    ClearBtnService.sync();
    IconSlotService.update();
    clearTimeout(State.debounceTimeout);
    State.debounceTimeout = setTimeout(
      () => SuggestionService.renderQuerySuggestions(inp.value),
      120  // debounceMs
    );
  };

  // Keydown: Enter → search, ArrowDown → focus suggestion, Backspace → debounced
  Handlers.inputKeydown = (e) => {
    if (e.key === 'Enter') {
      SearchService.doSearch();
      this.closeKB();  // ปิด keyboard
    } else if (e.key === 'ArrowDown') {
      // focus ตัวแรกใน suggestion list
    } else if (e.key === 'Backspace') {
      // debounce เร็วกว่าปกติ (60ms)
    }
  };

  // Focus/Click → เปิด overlay
  Handlers.inputFocus = () => OverlayService.open();
  Handlers.inputClick = () => OverlayService.open();
}
```

### 12.4 FilterService — ตัวกรองประเภทและหมวดหมู่

**Type Filter (ปุ่ม pill):**

```javascript
setupTypeFilter(selected = 'all') {
  // สร้าง pill buttons: "ทุกประเภท" + หนึ่ง pill ต่อ type
  pills.push(`<button class="filter-pill" data-filter-type="all">ทุกประเภท</button>`);
  for (const t of State.apiData.type) {
    pills.push(`<button class="filter-pill" data-filter-type="${lbl}">${lbl}</button>`);
  }
  el.innerHTML = pills.join('');

  // Click delegate
  el._pillHandler = (e) => {
    State.selectedType = val;
    State.selectedCategory = 'all';  // รีเซ็ต category
    SearchService.doSearch(null, false);  // ค้นหาใหม่
  };
}
```

**Category Filter:**

```javascript
setupCategoryFilter(cats, selected = 'all') {
  // ถ้าไม่มี categories → ซ่อน filter
  // ถ้ามี → สร้าง pill buttons
  el._pillHandler = (e) => {
    State.selectedCategory = val;
    RenderingService.renderResults(State.currentResults);  // กรองใหม่ (ไม่ค้นหาใหม่)
  };
}
```

---

## 13. Config, State, Types — ฐานรากของระบบ

### 13.1 CONFIG — ค่าคงที่ทั้งหมด

ทุกค่าถูก `Object.freeze()` — ห้าม mutate:

```javascript
CONFIG = {
  TIMING: {
    debounceMs: 120,               // input debounce
    toastDisplayMs: 1400,          // toast display
    toastFadeMs: 250,              // toast fade
    focusDelayMs: 30,              // input focus delay
    transitionDelayMs: 300,        // overlay transition
    keyboardDetectionDelayMs: 100, // keyboard detection
    keyboardGapMinMs: 300,         // minimum gap between keyboard toggles
    keyboardGapRecoveryMs: 800,    // recovery gap
    keyboardIdleTimeMs: 500,       // scroll idle time
    conDataServiceWaitMs: 1200,    // รอ ConDataService (ลดจาก 5000ms)
    conDataServicePollMs: 20,      // poll interval
    urlSearchRetryMs: 120,         // URL search retry interval
    urlSearchMaxRetries: 30,       // สูงสุด 30 retries
  },
  RENDER: {
    suggestionMax: 8,              // ข้อเสนอแนะใน dropdown
    suggestionsFullscreenMax: 30,  // ข้อเสนอแนะใน overlay
    vsOverscanPx: 320,             // overscan buffer
    vsPoolMax: 40,                 // DOM pool size
    vsEstimatedItemHeight: 96,     // ความสูงเริ่มต้นของ item
  },
  DOM: {
    suggestionContainerId: 'searchSuggestions',
    overlayContainerId: 'searchOverlayContainer',
    sentinelId: 'search-render-sentinel',
    searchInputId: 'searchInput',
    searchFormId: 'searchForm',
    typeFilterId: 'typeFilter',
    categoryFilterId: 'categoryFilter',
    searchResultsId: 'searchResults',
    copyToastId: 'copyToast',
    clearBtnId: 'search-clear-btn',
  },
  STORAGE: {
    historyKey: 'searchHistory_v1',
    langKey: 'selectedLang',
  },
  LANG: { default: 'en', autoDetect: true },
  DB: { path: '/assets/db/db.min.json' },
  TEXTS: { th: {...}, en: {...} },  // i18n strings
  Icons: { search: '...', back: '...', clear: '...' },  // SVG strings
};
```

### 13.2 State — State กลางที่ Mutable

ทุก field มี **owner service** เดียว (ระบุใน types.js):

```javascript
State = {
  // Data (owned by search-ui.js)
  apiData: null,                    // ข้อมูลจาก ConDataService
  allKeywordsCache: [],             // cache ของ keywords ทั้งหมด
  currentResults: [],               // ผลลัพธ์ค้นหาปัจจุบัน
  currentFilteredResults: [],       // ผลลัพธ์หลัง category filter

  // Filter (owned by UIService / SearchService)
  selectedType: 'all',
  selectedCategory: 'all',
  lastCommittedSearchState: null,   // state ล่าสุดที่ push ลง history

  // Overlay (owned by OverlayService)
  overlayOpen: false,
  overlayTransitioning: false,
  overlayHistoryPushed: false,
  preOverlayState: null,
  overlayOpenedAt: null,
  _savedScrollY: 0,
  overlayScrollable: null,
  _wrapperParent: null,             // ตำแหน่งเดิมของ input wrapper
  _wrapperNext: null,

  // History (owned by URLService / SearchService)
  suppressHistoryPush: false,

  // Keyboard (owned by KeyboardService)
  keyboardOpen: false,
  lastWindowInnerHeight: 0,
  keyboardAutoToggleEnabled: false,
  // ...

  // Input (owned by UIService)
  debounceTimeout: null,
  suggestionsLocked: false,

  // Nav (owned by OverlayService)
  navHiddenBySearch: false,

  // Internals
  _timeouts: new Set(),             // timeout IDs สำหรับ cleanup
  _handlersAttached: false,
  _overlayStateMarker: '__searchUI_overlay_open__',
};
```

### 13.3 Handlers — Event Handler References

เก็บ references สำหรับ `removeEventListener` ใน `destroy()`:

```javascript
Handlers = {
  resize: null,
  inputFocus: null,
  inputClick: null,
  inputInput: null,
  inputKeydown: null,
  formSubmit: null,
  suggestionClick: null,
  suggestionKeydown: null,
  documentKeydownOverlay: null,
  popstate: null,
  copyClick: null,
};
```

### 13.4 Types (JSDoc)

`types.js` กำหนด typedef ทั้งหมด:
- `SearchResult` — ผลลัพธ์จาก SearchEngine
- `SearchHistoryEntry` — state ใน browser history
- `CategoryOption` — ตัวเลือกใน category filter
- `SearchState` — state กลาง (มี owner แต่ละ field)
- `SearchHandlers` — event handler references
- `TimingConfig`, `AppConfig` — config types

---

## 14. ตัวแปร Global และ Events

### 14.1 Global Variables

| ตัวแปร | Type | จุดสร้าง | หน้าที่ |
|--------|------|----------|---------|
| `window.SearchEngine` | Object | `search-engine.js` | เอนจินค้นหาหลัก |
| `window.SearchModules` | Object | ทุกโมดูล | Namespace ของทุก service |
| `window.__searchUI` | Object | `search-ui.js` | Public API ของระบบ (init, destroy, getState) |
| `window.__pendingSearch` | Object\|null | `search.js` | Stash query เมื่อ docs ยังไม่พร้อม |
| `window.__renderIsRestore` | boolean | `search.js` | Flag ป้องกัน scroll-to-top ตอน restore |
| `window.__overlayDidSearch` | boolean | `rendering.js` | Flag บอกว่าค้นหาจาก overlay |
| `window._copyResultTextHandlerSet` | boolean | `rendering.js` | Guard ป้องกัน attach copy handler ซ้ำ |
| `window._showStickyHeader` | Function | ภายนอก | แสดง sticky header หลังค้นหา |
| `window.showCopyNotification` | Function | `copyNotification.js` | แสดง notification เมื่อคัดลอก |
| `window.ConDataService` | Object | ภายนอก | บริการข้อมูลหลัก |
| `window.URE` | Object | `ure.js` | Universal Render Engine |
| `window.modernNav` | Object | ภายนอก | Navigation bar (hideNav/showNav) |
| `window.Fuse` | Class | CDN (lazy) | Fuse.js fuzzy search library |

### 14.2 Global Events

| Event | Target | Handler | หน้าที่ |
|-------|--------|---------|---------|
| `submit` | `#searchForm` | `Handlers.formSubmit` | ป้องกัน default + doSearch + closeKB |
| `keydown` (Enter) | `#searchInput` | anonymous | ป้องกัน default + doSearch + closeKB |
| `input` | `#searchInput` | `Handlers.inputInput` | Debounce → update suggestions/clear/icon |
| `keydown` (ArrowDown) | `#searchInput` | `Handlers.inputKeydown` | Focus ตัวแรกใน suggestion list |
| `focus` | `#searchInput` | `Handlers.inputFocus` | เปิด overlay |
| `click` | `#searchInput` | `Handlers.inputClick` | เปิด overlay |
| `popstate` | `window` | `Handlers.popstate` | จัดการ back/forward navigation |
| `resize` | `window`/`visualViewport` | `Handlers.resize` | ตรวจจับ keyboard open/close |
| `click` | `#searchResults` | `Handlers.copyClick` | Delegated copy on card click |
| `keydown` (Enter/Space) | `#searchResults` | anonymous | Copy ด้วย keyboard |
| `keydown` (Escape) | `document` | `Handlers.documentKeydownOverlay` | ปิด overlay |
| `scroll` | overlay scrollable | `keyboardAutoToggleHandler` | Auto toggle keyboard |
| `click` | `#searchSuggestions` | `Handlers.suggestionClick` | เลือก suggestion |
| `keydown` | `#searchSuggestions` | `Handlers.suggestionKeydown` | นำทางด้วย arrow keys |
| `beforeunload` | `window` | anonymous | เรียก destroy() |

### 14.3 `window.__searchUI` Public API

```javascript
window.__searchUI = {
  _initialized: true,
  init,                              // เริ่มต้นระบบ
  destroy,                           // ทำลายระบบ
  getConfig: () => CONFIG,           // ดูค่า config
  getState: () => State,             // ดู state ปัจจุบัน
  getModules: () => M,               // ดูทุก service
  getSessionHistory: () => StorageService.getHistory(),
  getLastCommittedSearchState: () => State.lastCommittedSearchState,
  querySuggestions: q => SearchEngine.querySuggestions(q, 8),
  isKeyboardOpen: () => KeyboardService.isKeyboardOpen(),
  getVSStats: () => ({               // สถิติ virtual scroll
    itemCount, visibleCount, poolSize, totalHeight
  }),
};
```

---

## 15. การเพิ่มประสิทธิภาพ (Performance)

### 15.1 การโหลดโมดูล

| เทคนิค | ก่อน | หลัง | ประหยัด |
|---------|------|------|--------|
| Parallel phase loading | 12 round trips ต่อเนื่อง | 5 phases (parallel ภายใน) | ~210ms บนมือถือ (30ms RTT) |
| Early data prefetch | โหลด data หลัง modules เสร็จ | โหลดพร้อมกับ modules | ~รอครึ่งหนึ่งของเวลา |

### 15.2 การค้นหา

| เทคนิค | รายละเอียด |
|---------|------------|
| Two-tier search | Substring ทันที → Fuse upgrade อย่างเงียบ |
| Fuse index in idle | สร้างด้วย `requestIdleCallback` ไม่ block UI |
| Lazy Fuse.js CDN | โหลดเฉพาะเมื่อต้องการ ไม่ block initial render |
| No caching | ไม่ใช้ localStorage/sessionStorage สำหรับ search results |
| Fuse upgrade polling | ทุก 500ms สูงสุด 8 วินาที — upgrade เฉพาะเมื่อ query ยังเดียวกัน |

### 15.3 การเรนเดอร์

| เทคนิค | รายละเอียด |
|---------|------------|
| URE diff engine | `setData()` เรนเดอร์เฉพาะ nodes ที่เปลี่ยน |
| DOM pool recycling | รีไซเคิล DOM nodes ไม่สร้างใหม่ทุกครั้ง |
| Virtual scroll | O(1) DOM nodes ไม่ว่ามีกี่ผลลัพธ์ |
| `transform:translateY` | ใช้ GPU compositing ไม่ trigger layout |
| ResizeObserver | วัดความสูงแบบ async ไม่ force layout |
| Rate-limited correction | 100ms cap สำหรับ height correction |
| `contain: layout style paint` | CSS containment จำกัด layout scope |
| Single-pass HTML escape | char scan แทน regex replace × 3 |

### 15.4 StringService.escapeHtml — Single Pass

```javascript
// เดิม: 3 × .replace() = 3 full scans + 2 intermediate strings
// ตอนนี้: single-pass char scan — zero regex, zero intermediate strings
escapeHtml(s) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if      (c === 38) out += '&amp;';   // &
    else if (c === 60) out += '&lt;';    // <
    else if (c === 62) out += '&gt;';    // >
    else if (c === 34) out += '&quot;';  // "
    else               out += str[i];
  }
  return out;
}
```

เรียก ~300 ครั้ง/frame (10 ต่อการ์ด × 30 การ์ด visible) → single-pass สำคัญมาก

### 15.5 HighlightService — Query Cache

```javascript
// Rebuild char Set เฉพาะเมื่อ query เปลี่ยน (amortised O(1) per item)
if (q !== this._lastQuery) {
  this._lastQuery = q;
  this._lastChars = new Set(q);
}
```

### 15.6 ConDataService Timing

```
conDataServiceWaitMs: 5000 → 1200ms  (preload เริ่มทันทีใน con-data-service)
conDataServicePollMs: 30 → 20ms       (ตรวจเร็วขึ้น)
urlSearchRetryMs: 200 → 120ms         (retry เร็วขึ้น)
```

### 15.7 Cold-Start Race Condition Fix

```
ปัญหา: ผู้ใช้กด Enter ก่อน docs โหลดเสร็จ → search() คืน [] เงียบๆ
แก้:  stash query ใน window.__pendingSearch
      search-ui.js drain หลัง init() เสร็จ
```

---

## 16. วงจรชีวิต (Lifecycle)

### 16.1 Init Flow

```
HTML: <script defer src="search-ui.js">
  │
  ▼
search-ui.js IIFE รัน
  ├── ตรวจ window.__searchUI._initialized → ถ้า true, return
  ├── เริ่ม _earlyDataPromise (poll ConDataService)
  ├── loadPhases(LOAD_PHASES, base)
  │    ├── Phase 1: types + config + state (parallel)
  │    ├── Phase 2: utils + virtual-scroll (parallel)
  │    ├── Phase 3: url-history + keyboard + rendering + suggestions + input-bar (parallel)
  │    ├── Phase 4: overlay
  │    └── Phase 5: search
  │
  ▼
_boot()
  ├── Destructure ทุก service จาก window.SearchModules
  ├── KeyboardService.initKeyboardDetection()
  ├── loadData()
  │    ├── Fast path: _earlyDataPromise (อาจ resolved แล้ว)
  │    └── Normal path: waitForConDataService(1200ms) →getAssembled() || fetch(db.min.json)
  ├── SearchEngine.init(data)
  │    ├── buildImmediateDocs() → _docs, _keywords พร้อม
  │    └── scheduleBuildFuse() → สร้าง Fuse index ใน background
  ├── generateAllKeywords() → State.allKeywordsCache
  ├── UIService.buildWrapper() → จัด DOM order
  ├── FilterService.setupTypeFilter('all')
  ├── UIService.setupAutoSearchInput() → แนบ input event handlers
  ├── _restoreLastCommitted()
  ├── Drain window.__pendingSearch (ถ้ามี)
  ├── URL-based search (ถ้า ?q=... ใน URL)
  ├── แนบ form submit + Enter handlers (synchronous → ทำงานทันที)
  ├── แนบ popstate handler
  └── window.addEventListener('beforeunload', destroy)
```

### 16.2 Search Flow

```
ผู้ใช้พิมพ์ → input event → debounce 120ms
  → SuggestionService.renderQuerySuggestions()
  → SearchEngine.querySuggestions() → 3-tier fallback
  → Highlight + render ใน #searchSuggestions

ผู้ใช้กด Enter:
  ├── doSearch()
  │    ├── ตรวจ docs ready → ถ้าไม่: stash __pendingSearch, return
  │    ├── ถ้า query ว่าง: _showPlaceholder(), replaceSearch({q:''})
  │    ├── SearchEngine.search(q, type) → Tier 1 หรือ Tier 2
  │    ├── FilterService.setupCategoryFilter()
  │    ├── URLService.commitSearch() (ถ้าไม่ overlay, ไม่ suppress)
  │    └── RenderingService.renderResults()
  │         ├── ถ้ามีผล: URE.setData() หรือ URE.mount()
  │         └── ถ้าไม่มี: _renderEmpty()
  └── OverlayService.close('manual')
       ├── URLService.collapseOverlayEntry()
       ├── คืน input wrapper → header
       ├── ลบ overlay DOM
       ├── คืน scroll lock
       └── แสดง nav
```

### 16.3 Destroy Flow

```javascript
destroy() {
  if (State.overlayOpen) OverlayService.close('manual');
  VirtualScrollEngine.destroy();
  KeyboardAutoToggleService.disableAutoToggle();

  // ลบ event listeners ทั้งหมด
  DOMService.off(window, 'resize', Handlers.resize);
  DOMService.off(window, 'popstate', Handlers.popstate);
  DOMService.off(form, 'submit', Handlers.formSubmit);
  DOMService.off(results, 'click', Handlers.copyClick);
  // ... ลบ input listeners

  // Clear timeouts
  State._timeouts.forEach(t => clearTimeout(t));

  // ลบ DOM ที่สร้าง
  DOMService.remove(suggestionContainer);
  DOMService.remove(overlayContainer);
  DOMService.remove(sentinel);

  // Reset state
  State.apiData = null;
  State.currentResults = [];
  window.__pendingSearch = null;
  window.__searchUI._initialized = false;
}
```

---

## Appendix: การทำงานร่วมกับระบบอื่น

### กับ ConDataService

```
search-ui.js → poll ConDataService.getAssembled() → ข้อมูลแบบ assembled
fallback → fetch('/assets/db/db.min.json')
```

### กับ URE

```
RenderingService.renderResults()
  → URE.mount({ container, data, template, lang, buffer, recycling, keyField })
  → URE จัดการ virtual scroll + DOM pool + diff
  → ครั้งต่อไป: URE.handle.setData(newData) → diff engine
```

### กับ Navigation (modernNav)

```
OverlayService.open()  → window.modernNav.hideNav('search-overlay')
OverlayService.close() → window.modernNav.showNav('search-overlay-closed')
```

### กับ copyNotification.js

```
NotificationService.copyText(text, name)
  → navigator.clipboard.writeText(text)
  → window.showCopyNotification({ text, name, lang })
```esults = [];
  window.__pendingSearch = null;
  window.__searchUI._initialized = false;
}
```

---

## Appendix: การทำงานร่วมกับระบบอื่น

### กับ ConDataService

```
search-ui.js → poll ConDataService.getAssembled() → ข้อมูลแบบ assembled
fallback → fetch('/assets/db/db.min.json')
```

### กับ URE

```
RenderingService.renderResults()
  → URE.mount({ container, data, template, lang, buffer, recycling, keyField })
  → URE จัดการ virtual scroll + DOM pool + diff
  → ครั้งต่อไป: URE ใช้ instance เดิม (single instance reuse, rendering.js v6.0)
```

---

## 17. อ้างอิงข้ามเอกสาร

- [`00-System-Architecture.md`](./00-system-architecture.md) — ภาพรวมสถาปัตยกรรมทั้งโปรเจกต์
- [`01-URE-Universal-Render-Engine.md`](./01-URE-Universal-Render-Engine.md) — URE ที่ใช้ render ผลลัพธ์การค้นหา
- [`05-ConData-Service.md`](./05-ConData-Service.md) — ConDataService ที่เป็นแหล่งข้อมูล
- [`08-Performance-Architecture.md`](./08-Performance-Architecture.md) — เทคนิค performance ที่ใช้
- [`AI_CODING_GUIDE.md`](./AI_CODING_GUIDE.md) — มาตรฐานโค้ดที่ต้องยึดเมื่อแก้ Search
- [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) — กฎเหล็กก่อนแตะ Search
- [`12-SEO-Guide.md`](./12-SEO-Guide.md) — ⭐ SEO considerations (priority สูงสุด) ที่เกี่ยวข้องกับระบบนี้
