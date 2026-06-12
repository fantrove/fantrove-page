# 03 — ระบบ Nav-Core และไฟล์ JavaScript อิสระ

> เอกสารนี้อธิบายระบบ Nav-Core ซึ่งเป็นหัวใจสำคัญของการนำทางแบบ SPA (Single Page Application) และการจัดการเนื้อหาทั้งหมดของ Fantrove Verse รวมถึงไฟล์ JavaScript อิสระที่ทำงานร่วมกับ Nav-Core

---

## สารบัญ

1. [ภาพรวมสถาปัตยกรรม](#1-ภาพรวมสถาปัตยกรรม)
2. [ไฟล์ Bootstrap: `nav-core-early.js`](#2-ไฟล์-bootstrap-nav-core-earlyjs)
3. [Orchestrator: `nav-core.js`](#3-orchestrator-nav-corejs)
4. [ระบบ Loading Overlay: `loading.js`](#4-ระบบ-loading-overlay-loadingjs)
5. [ระบบ Config: `config.js`](#5-ระบบ-config-configjs)
6. [ระบบ State: `state.js`](#6-ระบบ-state-statejs)
7. [ระบบ Utils: `utils.js`](#7-ระบบ-utils-utilsjs)
8. [ระบบ Data Service: `data.js`](#8-ระบบ-data-service-datajs)
9. [ระบบ Content Rendering: `content.js`](#9-ระบบ-content-rendering-contentjs)
10. [ระบบ Performance: `performance.js`](#10-ระบบ-performance-performancejs)
11. [ระบบ Feed: `feed.js`](#11-ระบบ-feed-feedjs)
12. [ระบบ Buttons: `buttons.js`](#12-ระบบ-buttons-buttonsjs)
13. [ระบบ Router: `router.js`](#13-ระบบ-router-routerjs)
14. [ระบบ Copy: `copy.js`](#14-ระบบ-copy-copyjs)
15. [ระบบ Init: `init.js`](#15-ระบบ-init-initjs)
16. [Web Worker: `index-worker.js`](#16-web-worker-index-workerjs)
17. [ไฟล์ TypeScript Types: `types.js`](#17-ไฟล์-typescript-types-typesjs)
18. [ตัวแปรและเหตุการณ์ Global](#18-ตัวแปรและเหตุการณ์-global)
19. [การผสานรวมกับ URE](#19-การผสานรวมกับ-ure)
20. [ไฟล์ JavaScript อิสระ](#20-ไฟล์-javascript-อิสระ)
    - [`modern-navigation.js`](#201-modern-navigationjs)
    - [`copyNotification.js`](#202-copynotificationjs)
    - [`footer-template.js`](#203-footer-templatejs)
    - [`banner-engine.js`](#204-banner-enginejs)
    - [`home.js`](#205-homejs)
    - [`new.js`](#206-newjs)
    - [`roadmap.js`](#207-roadmapjs)
    - [`version-core.js`](#208-version-corejs)
    - [`back-to-top.js`](#209-back-to-topjs)
    - [`back-button.js`](#210-back-buttonjs)
21. [ผังการทำงานรวม](#21-ผังการทำงานรวม)

---

## 1. ภาพรวมสถาปัตยกรรม

### 1.1 Nav-Core คืออะไร

Nav-Core เป็นระบบ **Navigation & Content Management System** ที่ทำหน้าที่เป็น "สมองกลาง" ของทุกหน้าในเว็บ Fantrove Verse โดยจัดการ:

- **SPA Routing** — การนำทางแบบ Single Page Application โดยใช้ query string `?type=...&page=...`
- **Content Rendering** — การแสดงผลเนื้อหา (ปุ่มคัดลอก, การ์ด) ผ่านระบบ URE (Universal Render Engine)
- **Feed System** — ระบบฟีดอัจฉริยะ (All button) ที่ใช้ algorithmic recommendation
- **Data Layer** — การดึงข้อมูลจาก ConDataService พร้อม cache + index
- **State Management** — สถานะรวมของแอปพลิเคชัน
- **i18n** — รองรับหลายภาษา (ไทย, อังกฤษ)

### 1.2 โครงสร้างไฟล์

```
assets/js/
├── nav-core.js               ← Orchestrator (จุดเริ่มต้น)
├── nav-core-early.js         ← Bootstrap แสดง UI เร็วที่สุด
└── nav-core-modules/
    ├── types.js              ← Phase 1: TypeScript typedef
    ├── config.js             ← Phase 1: ค่าคงที่ทั้งหมด
    ├── state.js              ← Phase 1: สถานะรวม
    ├── utils.js              ← Phase 2: Utility functions
    ├── data.js               ← Phase 2: Data fetching + caching
    ├── loading.js            ← Phase 3: Loading overlay
    ├── content.js            ← Phase 3: Content rendering (URE)
    ├── performance.js        ← Phase 3: Scroll + Performance
    ├── feed.js               ← Phase 3: Feed recommendation engine
    ├── buttons.js            ← Phase 4: Button rendering
    ├── router.js             ← Phase 4: SPA router
    ├── copy.js               ← Phase 4: Clipboard handler
    ├── init.js               ← Phase 5: Bootstrap orchestrator
    └── index-worker.js       ← Web Worker (optional)
```

### 1.3 การโหลดแบบ Phase

Nav-Core โหลด modules ตามลำดับ 5 phase เพื่อให้ dependencies พร้อมก่อน:

```
Phase 1: types.js → config.js → state.js        (พื้นฐาน)
Phase 2: utils.js → data.js                     (เครื่องมือ + ข้อมูล)
Phase 3: loading.js → content.js → perf.js → feed.js  (การแสดงผล)
Phase 4: buttons.js → router.js → copy.js        (นำทาง + การคัดลอก)
Phase 5: init.js                                (เริ่มต้นทั้งหมด)
```

รูปแบบการโหลดใน `nav-core.js`:

```javascript
const PHASES = [
  ['types.js', 'config.js', 'state.js'],
  ['utils.js', 'data.js'],
  ['loading.js', 'content.js', 'performance.js', 'feed.js'],
  ['buttons.js', 'router.js', 'copy.js'],
  ['init.js'],
];
```

### 1.4 Namespace

ทุก module อาศัย namespace เดียวคือ `window.NavCoreModules` (ย่อว่า `M` ภายใน module):

```javascript
// ทุก module มี IIFE pattern:
(function(M) {
  'use strict';
  M.ServiceName = { /* ... */ };
})(window.NavCoreModules = window.NavCoreModules || {});
```

---

## 2. ไฟล์ Bootstrap: `nav-core-early.js`

### บทบาท

ไฟล์นี้เป็น **"เกราะเร็ว"** ที่ทำงานทันทีก่อน Nav-Core โหลดเสร็จ เพื่อให้ผู้ใช้เห็น UI โดยเร็วที่สุด แม้ยังไม่มี CSS/Module เต็มรูปแบบ

### กลไกหลัก

1. **`ensureDom()`** — สร้าง DOM elements ขั้นต่ำที่จำเป็น (`header`, `nav-list`, `sub-nav`, `content-loading`)
2. **`showEarlyOverlay()`** — แสดง overlay โหลดแบบเบา (SVG spinner + "Loading…") พร้อมระบบป้องกันซ้ำ
3. **`fetchButtonsConfig()`** — ดึง `/assets/json/buttons.json` ด้วย `force-cache` แล้ว fallback ไป `no-store`
4. **`renderMinimal()`** — แสดงผลปุ่มหลักและ content preview แบบง่าย (สูงสุด 20 รายการ)

### ระบบป้องกันซ้ำ

```javascript
if (window._navCoreEarlyBoot) return;
window._navCoreEarlyBoot = true;
```

### Timeout Safety

```javascript
// auto-hide หลัง 2 วินาที ถ้า loading ยังอยู่
setTimeout(() => {
  try { const e = q('#nc-early-overlay'); if (e) e.remove(); } catch (_) {}
}, 2000);
```

### เหตุการณ์ Navigation เบื้องต้น

ปุ่มที่สร้างใน early bootstrap จะใช้ navigation แบบง่าย:

```javascript
btn.onclick = () => {
  try { window.location.search = `?type=${encodeURIComponent(btn.dataset.url)}__`; } catch (_) {}
};
```

เมื่อ Nav-Core โหลดเสร็จ ระบบจะเข้าควบคุม RouterService แทน

---

## 3. Orchestrator: `nav-core.js`

### บทบาท

เป็น **จุดเริ่มต้น (Entry Point)** ของระบบ Nav-Core ทำหน้าที่:

1. ตรวจสอบว่ายังไม่ได้ initialize ซ้ำ
2. หา path ของ `nav-core-modules/` อัตโนมัติ
3. โหลดทุก phase ตามลำดับ
4. เรียก `_boot()` เพื่อเริ่ม InitService
5. มีระบบ diagnose กรณี module load ล้มเหลว

### ค้นหา Module Path

```javascript
function getModuleBase() {
  try {
    if (document.currentScript && document.currentScript.src) {
      const clean = document.currentScript.src.split('?')[0].split('#')[0];
      return clean.replace(/\/[^/]*$/, '/nav-core-modules/');
    }
    // ... fallback: ค้นจาก script tags
  } catch (_) {}
  return '/assets/js/nav-core-modules/';
}
```

รองรับ `?v=BUILD_ID` query string ใน production build

### Loading Pipeline

```javascript
function loadPhases(phases, base) {
  return phases.reduce(
    (chain, phase) => chain.then(() => loadPhase(phase, base)),
    Promise.resolve()
  );
}
```

แต่ละ phase ใช้ `Promise.all()` โหลดพร้อมกันภายใน phase แต่ละ phase รอ phase ก่อนหน้าเสร็จก่อน

### Boot Sequence

```javascript
function _boot() {
  const M = window.NavCoreModules;
  if (!M || !M.InitService || typeof M.InitService.start !== 'function') {
    console.error('[NavCore] NavCoreModules namespace missing / InitService.start not found');
    return;
  }
  M.InitService.start();
  window._navCore = { _initialized: true };
}
```

### Diagnostic System

เมื่อโหลดล้มเหลว ระบบจะวินิจฉัยทุก module:

```javascript
async function _diagnose(base, names) {
  const results = await Promise.all(names.map(async n => {
    const resp = await fetch(url, { cache: 'no-store' });
    return { url, status: resp.status, ok: resp.ok, snippet: text.slice(0, 200) };
  }));
  console.error('[NavCore] Module diagnostics:', results);
}
```

---

## 4. ระบบ Loading Overlay: `loading.js`

### บทบาท

`LoadingService` จัดการ loading overlay แบบ fullscreen ที่แสดงขณะรอโหลดเนื้อหา

### คุณสมบัติเด่น

- **i18n** — แสดงข้อความ 2 ภาษา (`.clp-msg` = ภาษาหลัก, `.clp-sub` = English subtitle)
- **CSS Variable tracking** — `--clp-top` ตาม header + subnav height ผ่าน ResizeObserver
- **Animation** — fade-in เมื่อ show, fade-out เมื่อ hide

### DOM Structure

```html
<div id="clp-overlay" role="status" aria-live="polite" aria-atomic="true" hidden>
  <div class="clp-spinner">
    <svg><!-- animated circle --></svg>
  </div>
  <div class="clp-text">
    <div class="clp-msg">กำลังโหลด...</div>
    <div class="clp-sub">Loading...</div>
  </div>
</div>
```

### API หลัก

```javascript
LoadingService.show(opts);    // แสดง overlay
LoadingService.hide();        // ซ่อน overlay
LoadingService.init();        // สร้าง element + ResizeObserver
LoadingService.isShown();     // สอบถามสถานะ
LoadingService.updateMessage(msg); // อัพเดทข้อความ
```

### Global Aliases

```javascript
window.showInstantLoadingOverlay = opts => LoadingService.show(opts);
window.removeInstantLoadingOverlay = () => LoadingService.hide();
```

---

## 5. ระบบ Config: `config.js`

### บทบาท

กำหนดค่าคงที่ทั้งหมดของระบบ Nav-Core ทุก module อ่านค่าจากที่นี่ แก้ไขที่เดียว ทุก module เห็นผลทันที

### กลุ่มค่าคงที่

```javascript
M.CONFIG = Object.freeze({
  FETCH: {
    TIMEOUT: 5000,           // ms ก่อน abort fetch
    RETRY_DELAY: 300,         // ms ระหว่าง retry
    MAX_RETRIES: 1,           // จำนวน retry
    CACHE_DURATION: 2*60*60*1000,  // 2 ชั่วโมง
    MAX_CONCURRENT: 2,        // จำนวน fetch พร้อมกันสูงสุด
    WARMUP_DELAY: 1200,       // ms ก่อน warmup
    WARMUP_TIMEOUT: 2000,     // ms timeout สำหรับ requestIdleCallback
  },
  PATHS: {
    BUTTONS_CONFIG: '/assets/json/buttons.json',
    API_DATABASE: '/assets/db/con-data/',
    TOP_INDEX_FILE: 'index.json',
    KNOWN_TOP_CATS: ['emoji', 'symbol', 'unicode'],
  },
  DOM: {
    OVERLAY_ID: 'clp-overlay',
    CONTENT_LOADING_ID: 'content-loading',
    HEADER_TAG: 'header',
    NAV_LIST_ID: 'nav-list',
    SUB_NAV_ID: 'sub-nav',
    SUB_NAV_CLASS: 'hj',
    SUB_BUTTONS_ID: 'sub-buttons-container',
    LOGO_CLASS: '.logo',
    SENTINEL_ID: 'cm4-sentinel',
  },
  CONTENT: {
    POOL_CAP: 48,
    INDEX_YIELD_N: 500,
  },
  ALL_BUTTON: {
    URL: '_all',              // route สำหรับ All feed
    EN_LABEL: 'All',
    TH_LABEL: 'ทั้งหมด',
    FEED_SAMPLE_CATS: 12,
    FEED_ITEMS_PER_CAT: 8,
    FEED_SEED_TTL: 30*60*1000, // 30 นาที
  },
  LOADING_MESSAGES: {
    en: { loading: 'Loading...' },
    th: { loading: 'กำลังโหลด...' },
  },
});
```

---

## 6. ระบบ State: `state.js`

### บทบาท

จัดเก็บสถานะรวม (Single Shared State) ที่ทุก service ใช้ร่วมกัน แต่ละ field มี owner เฉพาะ

### โครงสร้าง State

```javascript
const State = {
  // [InitService] — true จนกว่า bootstrap เสร็จ
  isBootstrapping: true,

  // [InitService] — cached DOM references
  elements: {
    header: null,
    navList: null,
    subButtonsContainer: null,
    contentLoading: null,
    logo: null,
    subNav: null,
    subNavInner: null,
  },

  // [RouterService] — routing state
  navigation: {
    isNavigating: false,
    currentMainRoute: '',
    currentSubRoute: '',
    previousUrl: '',
    lastScrollPosition: 0,
    initialNavigation: true,
  },

  // [ButtonService] — button config + active state
  buttons: {
    config: null,
    buttonMap: new Map(),        // url → {button, config}
    currentMainButton: null,
    currentSubButton: null,
    currentMainButtonUrl: null,
  },
};
```

---

## 7. ระบบ Utils: `utils.js`

### บทบาท

รวม utility functions ที่ไม่มี side effect และ pure helper:

### showNotification

```javascript
M.showNotification(message, type, options)
// type: 'info' | 'success' | 'error' | 'warning' | 'loading'
// options: { duration?, position?, dismissible? }
```

### ErrorManager

คลาสสำหรับ deduplicate error notifications ป้องกัน notification flood:

```javascript
M.ErrorManager.showError(errorKey, error, opts)
M.ErrorManager.clearErrors()
M.ErrorManager.isDuplicateError(key, message)
```

### Function Utilities

```javascript
M.Utils.debounce(fn, wait)              // standard debounce
M.Utils.throttle(fn, limit)             // standard throttle
M.Utils.debounceWithMaxWait(fn, wait, maxWait)  // debounce with ceiling
M.Utils.batchDOMReads(tasks)           // batch read/write ลด layout thrashing
M.Utils.isOnline()                      // navigator.onLine
```

---

## 8. ระบบ Data Service: `data.js`

### บทบาท

`DataService` เป็นชั้นข้อมูลหลักที่:

- ดึงข้อมูลจาก ConDataService พร้อม retry + timeout
- จัดการ cache ระดับ memory (Map-based พร้อม TTL)
- สร้าง shared index (apiMap, idMap, textMap, catToTypeMap) สำหรับ O(1) lookup
- มี fetch queue รองรับ priority + concurrent limit

### ระบบ Fetch Queue

```javascript
DataService._enqueueFetch(url, options, priority)
// priority: ต่ำ = สำคัญกว่า (sort ascending)
// MAX_CONCURRENT: 2 fetch พร้อมกัน
```

### Retry Logic

```javascript
// retry 4 ครั้ง ด้วย delay 400ms → 1200ms → 2400ms
const DELAYS = [400, 1200, 2400];
for (let attempt = 0; attempt <= DELAYS.length; attempt++) {
  try { /* fetch */ }
  catch (err) {
    if (attempt < DELAYS.length) await new Promise(r => setTimeout(r, DELAYS[attempt]));
  }
}
```

### Shared Index

```javascript
await DataService._buildSharedIndex(db);
// สร้าง 4 Maps:
//   apiMap      → {apiCode} → item (O(1) หา text จาก API code)
//   idMap       → {id} → item
//   textMap     → {text} → item
//   catToTypeMap → {catId} → typeObj
```

**สำคัญ**: Index ข้าม type ที่ `kind !== 'copyable'` เพื่อป้องกัน card data รบกวนระบบ copy

### ConDataService Bridge

```javascript
DataService._fetchViaService(url)
// แปลง URL เป็นการเรียก ConDataService.getItems() / getTypeById()
// รองรับ URL patterns:
//   /con-data/{typeId}/{catId}.json  → svc.getItems(typeId, catId)
//   /con-data/{typeId}.json           → svc.getTypeById(typeId)
//   fallback                           → svc.getAssembled()
```

### Public Methods

```javascript
DataService.fetchWithRetry(url, options, priority)
DataService.loadApiDatabase()
DataService.fetchApiContent(apiCode)
DataService.fetchCategoryGroup(categoryId)
DataService.fetchCategoryDirect(typeId, categoryId)
DataService.getTypeCategories(typeId)
DataService.clearCache()
DataService.getCached(key)
DataService.setCache(key, data, ttl)
```

---

## 9. ระบบ Content Rendering: `content.js`

### บทบาท

`ContentService` จัดการการแสดงผลเนื้อหาทั้งหมด:

- **URE Path** — สำหรับ route ทั่วไป ใช้ `window.URE.mount()` สำหรับ virtualized rendering
- **Feed Path** — สำหรับ "All" button ใช้ native DOM + infinite scroll

### URE Rendering Path

```javascript
await ContentService.renderContent(data);
// 1. clearContent()
// 2. _ensureURE() — รอ URE พร้อม
// 3. loadApiDatabase()
// 4. _resolveAll(data, lang) — แปลง raw data → renderable groups
// 5. URE.mount({ container, data, template, onItemClick })
```

### Feed Rendering Path

```javascript
await ContentService.renderFeed(lang);
// 1. FeedService.reset()
// 2. clearContent()
// 3. loadApiDatabase()
// 4. FeedService.loadNextPage() × N segments
// 5. _appendFeedGroups() → สร้าง .feed-page div
// 6. _attachFeedSentinel() → IntersectionObserver สำหรับ infinite scroll
```

**ทำไมไม่ใช้ URE สำหรับ Feed**:
- URE mount ครั้งเดียว การ append เพิ่มต้อง re-mount → scroll jump
- Feed ใช้ native DOM append + `content-visibility: auto` จึง append ได้ไม่จำกัด

### Resolution Pipeline

```
_resolveAll(data, lang)
  ├── jsonFile → fetch + recursive resolve
  ├── source → _resolveSource() → _fetchSourceGroup()
  ├── category → _resolveGroup() → fetchCategoryGroup/Direct
  ├── group/categoryId → _resolveGroup()
  └── รายการเดี่ยว → _resolveItem() → {button} หรือ {card}
```

### Layout Types

- `btn-row` — ปุ่มคัดลอก 10 ปุ่ม/แถว แบ่งเป็น first/mid/last/only
- `card-group` — การ์ด grid layout
- `card-group-h` — การ์ด horizontal scroll

### Click Delegation

```javascript
ContentService._onClick(e)
// button-content → unifiedCopyToClipboard()
// card[data-link] → window.open(link, '_blank')
```

---

## 10. ระบบ Performance: `performance.js`

### ScrollService

ทำให้ `#sub-nav` sticky ด้วย single passive scroll listener:

```javascript
ScrollService.init()
// - สร้าง CSS สำหรับ #sub-nav position: sticky
// - สลับ .fx class เมื่อ top <= 0
// - ใช้ requestAnimationFrame เพื่อ batch scroll reads
```

### PerformanceService

```javascript
PerformanceService.init()
// 1. Lazy load ทุก <img> ที่ยังไม่มี loading="lazy"
// 2. Error boundary — throttle error/unhandledrejection notifications
// 3. Connection API — ตั้ง window._navCore_slowConnection เมื่อ 2g/slow-2g/saveData
```

---

## 11. ระบบ Feed: `feed.js`

### บทบาท

`FeedService` เป็น **Universal Explore Feed** — ระบบแนะนำเนื้อหาแบบ algorithmic โดยไม่ใช้ ML แต่ใช้ deterministic algorithms

### Algorithm ที่ใช้

| Concept | แหล่งที่มา | การนำไปใช้ |
|---------|-----------|-------------|
| UCB1 | Upper Confidence Bound | Noveltly bonus (inverse frequency) |
| Netflix WRMF | Size normalization | `log₂(n)^0.65` dampens large categories |
| Thompson Sampling | Weighted top-K stochastic | Top-3 proportional sampling |
| Hacker News ranking | Time decay | Chunk-index penalty |
| Mulberry32 PRNG | Bernstein & Schindler 2020 | Seeded random jitter |

### Scoring Formula

```
score(segment) = 100
  × [card boost]         × [card-slot bonus]
  × [novelty: 1 + 2/(shown+1)]
  × [size-norm: 1/log₂(n+2)^0.65]
  × [chunk-decay: (1-0.4)^k]
  × [diversity penalty]
  × [type-variety penalty]
  × [jitter: ±28% seeded random]
```

### Pool Architecture

```
_buildPools(db)
  ├── _buttonSegs[]  ← ปุ่ม copyable (chunk 20 items)
  ├── _cardSegs[]    ← การ์ด collection (chunk 30 items)
  └── _masterPool = [...cardSegs, ...buttonSegs]

_unseenPool → หดลงทุกครั้งที่ emit → refill โดย _softReset()
```

### Soft Reset

เมื่อ unseenPool ว่าง — ไม่ hard reset (แสดงลำดับเดิม) แต่ soft reset:

```javascript
_softReset() {
  // 1. Decay show counts × 0.50
  for (const [catId, count] of this._catShowCounts) {
    const next = Math.round(count * FC.SOFT_RESET_DECAY);
    if (next === 0) this._catShowCounts.delete(catId);
    else this._catShowCounts.set(catId, next);
  }
  // 2. New seed → different jitter landscape
  this._seed = (this._seed + 0x9E3779B9 + this._softResets * 0x45678901) >>> 0;
  // 3. Refill pool
  this._unseenPool = this._masterPool.slice();
}
```

MAX_SOFT_RESETS = 5 → หลังจากนั้น feed ส่ง `hasMore: false`

### Feed Constants

```javascript
const FC = {
  CHUNK_BUTTON: 20,        // items per button segment
  CHUNK_CARD: 30,          // items per card segment
  CARD_BASE_BOOST: 2.5,
  CARD_SLOT_BOOST: 1.6,
  NOVELTY_BASE: 2.0,
  SIZE_NORM_EXP: 0.65,
  CHUNK_DECAY: 0.40,
  JITTER: 0.28,
  DIV_WINDOW: 6,           // sliding window สำหรับ diversity
  DIV_PENALTY: 0.07,
  TYPE_WIN: 4,
  TYPE_PENALTY: 0.22,
  COLD_CARD_COUNT: 2,      // 2 slots แรก = card priority
  CARD_SLOT_EVERY: 4,      // ทุก 4 slots = card priority
  SOFT_RESET_DECAY: 0.50,
  MAX_SOFT_RESETS: 5,
  TOP_K: 3,                // weighted sample จาก top-3
};
```

### Public API

```javascript
FeedService.loadNextPage(lang, n)    // → {groups: [], hasMore: boolean}
FeedService.reset()                  // เริ่ม feed ใหม่
FeedService.invalidate()             // เรียกเมื่อเปลี่ยนภาษา
```

---

## 12. ระบบ Buttons: `buttons.js`

### บทบาท

`ButtonService` + `SubNavService` จัดการปุ่มนำทางทั้งหมด

### "All" System Button

ปุ่ม "ทั้งหมด / All" ถูก inject อัตโนมัติที่ index 0 เสมอ:

```javascript
const _ALL_BTN_CFG = Object.freeze({
  url: CONFIG.ALL_BUTTON.URL,   // '_all'
  en_label: 'All',
  th_label: 'ทั้งหมด',
  _isSystemButton: true,
  className: 'all-feed-button',
});
```

**ไม่มี `isDefault` สำหรับ main buttons แล้ว** — All button เป็น default เสมอ

### SubNavService

```javascript
SubNavService.ensureSubNavContainer()  // สร้าง #sub-nav ถ้ายังไม่มี
SubNavService.hideSubNav()              // ซ่อน sub-nav
SubNavService.showSubNav()              // แสดง sub-nav
SubNavService.clearSubButtons()         // ล้างปุ่ม sub
```

### ButtonService Flow

```
loadConfig()
  ├── fetch buttons.json (via DataService)
  ├── inject All button at index 0
  └── renderMainButtons()
        ├── DocumentFragment (single DOM write)
        ├── bind click handlers → RouterService.navigateTo()
        └── trigger initial URL handling
```

### Sub Button Rendering

```javascript
renderSubButtons(subBtns, mainUrl, lang)
// สร้างปุ่ม sub ใน #sub-buttons-container
// URL pattern: "{mainUrl}-{subUrl}"
// รองรับ isDefault สำหรับ sub buttons
```

---

## 13. ระบบ Router: `router.js`

### บทบาท

`RouterService` เป็น SPA router ที่ใช้ query string pattern:

```
?type={mainRoute}__&page={subRoute}
```

ตัวอย่าง: `?type=emoji__&page=smileys`

### URL Normalization

```javascript
RouterService.normalizeUrl(input)
// รับ string, object, หรือ query string
// เพิ่ม '__' suffix ตามมาตรฐาน

RouterService.parseUrl(q)
// คืน { main: 'emoji', sub: 'smileys' }

RouterService.validateUrl(url)
// ตรวจว่า main/sub มีอยู่ใน buttons.json
```

### navigateTo Flow

```javascript
async navigateTo(route, options = {}) {
  // 1. LoadingService.show()
  // 2. รอ isNavigating mutex (timeout 10s)
  // 3. Safety timer 20s — force reset ถ้าค้าง
  // 4. Normalize + validate URL
  // 5. setActiveButtons(main, sub)
  // 6. changeURL() — pushState/replaceState
  // 7. สร้าง sub buttons (ถ้ามี)
  // 8. Content rendering:
  //    - main === '_all' → ContentService.renderFeed(lang)
  //    - อื่นๆ → DataService.fetch → ContentService.renderContent()
  // 9. Dispatch 'routeChanged' event
  // 10. Scroll to top (smooth)
  // 11. finally: isNavigating = false, clear safety timer
}
```

### Backward-compat

`NavigationService` เป็น proxy ที่เรียก `RouterService` เดิมทุก method:

```javascript
const NavigationService = {
  navigateTo(r, o)  { return RouterService.navigateTo(r, o); },
  normalizeUrl(u)   { return RouterService.normalizeUrl(u); },
  // ... เป็นต้น
};
```

---

## 14. ระบบ Copy: `copy.js`

### บทบาท

`CopyService` จัดการการคัดลอกข้อความไปยัง clipboard พร้อม resolve item name สำหรับ notification

### Flow

```javascript
await CopyService.copy({ text, api, type, name })
// 1. navigator.clipboard.writeText(text)
// 2. loadApiDatabase() ถ้ายังไม่พร้อม
// 3. Resolve item info:
//    - มี api → O(1) apiMap lookup
//    - ไม่มี api → O(1) textMap lookup
// 4. Resolve typeId จาก catToTypeMap
// 5. เรียก window.showCopyNotification(params)
```

### Global Alias

```javascript
window.unifiedCopyToClipboard = (info) => CopyService.copy(info);
```

---

## 15. ระบบ Init: `init.js`

### บทบาท

`InitService` เป็น bootstrap orchestrator ที่เริ่มทำงานหลังทุก module โหลดเสร็จ

### 10 Phase Bootstrap

```
Phase 1: _exposeGlobals()         — ตั้ง window globals + backward-compat aliases
Phase 2: _ensureElements()        — สร้าง DOM elements ที่จำเป็น
         _cacheElements()         — cache refs ลง State.elements
Phase 3: LoadingService.show()    — แสดง loading overlay
Phase 4: ScrollService.init()     — sticky sub-nav
         PerformanceService.init() — lazy images, error boundary, connection API
         Event listeners:
           'online'  → reload config
           'offline' → warning notification
           'languageChange' → update buttons/cards/feed
Phase 5: ButtonService.loadConfig() — โหลดปุ่มจาก buttons.json
Phase 6: RouterService.init()     — ลงทะเบียน popstate handler
Phase 7: DataService._warmup()    — prefetch config + preload con-data
Phase 8: Initial navigation      — อ่าน URL → navigateTo()
```

### Global Exposure

```javascript
// ชื่อใหม่ (canonical):
window._navCore_utils                = Utils
window._navCore_dataManager          = DataService
window._navCore_contentLoadingManager = LoadingService
window._navCore_contentManager       = ContentService
window._navCore_router               = RouterService
window._navCore_feedService          = FeedService
// ... เป็นต้น

// Backward-compat (_headerV2_*):
window._headerV2_utils                = Utils
window._headerV2_dataManager          = DataService
// ... เป็นต้น
```

---

## 16. Web Worker: `index-worker.js`

### บทบาท

Web Worker สำหรับ offload JSON parsing + indexing ไปยัง background thread กรณี dataset ใหญ่มาก

### Message Protocol

**Input:**
```javascript
{ type: 'parseAndIndex', payload: { text: jsonString } }
```

**Output (success):**
```javascript
{ type: 'indexReady', payload: {
    apiEntries,        // [apiCode, item][]
    idEntries,         // [id, item][]
    textEntries,       // [text, item][]
    catToTypeEntries,  // [catId, typeObj][]
}}
```

**Output (error):**
```javascript
{ type: 'indexError', payload: errorMessage }
```

Entry arrays ออกแบบให้ใช้กับ `new Map(entries)` ได้โดยตรง

### หมายเหตุ

ในปัจจุบัน `DataService._buildSharedIndex()` ทำ indexing บน main thread ด้วย `scheduler.yield()` Worker นี้อยู่ในโหมด reserve สำหรับ use case ที่ต้องการ offload

---

## 17. ไฟล์ TypeScript Types: `types.js`

### บทบาท

ไฟล์นี้ **ไม่มี runtime code** มีเฉพาะ JSDoc `@typedef` เพื่อให้ IDE เข้าใจ type ของทุก module

### Types สำคัญ

| Type | คำอธิบาย |
|------|---------|
| `NavElements` | Cached DOM refs (header, navList, subButtonsContainer...) |
| `NavigationState` | SPA routing state (isNavigating, currentMainRoute...) |
| `ButtonState` | Button config + active state (config, buttonMap...) |
| `NavState` | Root state object (isBootstrapping, elements, navigation, buttons) |
| `MainButtonConfig` | โครงสร้าง main button จาก buttons.json |
| `SubButtonConfig` | โครงสร้าง sub button |
| `ContentItem` | Renderable content item (button, card, group) |
| `ParsedUrl` | URL parse result { main, sub } |
| `NavOptions` | navigateTo options (skipUrlUpdate, replace...) |

---

## 18. ตัวแปรและเหตุการณ์ Global

### ตัวแปร Global

| Variable | Type | คำอธิบาย |
|----------|------|---------|
| `window.NavCoreModules` | Object | Namespace หลักของทุก service |
| `window._navCore` | `{_initialized: true}` | Guard flag |
| `window._navCore_bootstrapping` | boolean | true ระหว่าง init |
| `window.unifiedCopyToClipboard` | Function | Copy to clipboard |
| `window.showCopyNotification` | Function | Show copy notification (จาก copyNotification.js) |
| `window.__instantLoadingOverlayShown` | boolean | Loading overlay state |
| `window.__removeInstantLoadingOverlay` | Function | Hide early overlay |
| `window._navCore_slowConnection` | boolean | true เมื่อ 2g/slow-2g |
| `window.showInstantLoadingOverlay` | Function | Show overlay (legacy) |
| `window.removeInstantLoadingOverlay` | Function | Hide overlay (legacy) |
| `window._navCore_contentLoadingManager` | LoadingService | Loading service reference |
| `window.modernNav` | Object | Modern navigation controller |

### Backward-compat Aliases (`_headerV2_*`)

ระบบยังคงตั้ง alias เก่าไว้เพื่อความเข้ากันได้กับ scripts ที่ยังใช้ชื่อเดิม

### Custom Events

| Event | Trigger | Detail |
|-------|---------|--------|
| `urlChanged` | RouterService.changeURL() | `{ url, mainRoute, subRoute }` |
| `routeChanged` | RouterService.navigateTo() | `{ main, sub }` |
| `languageChange` | หลายจุด | `{ language: string }` |
| `ure:ready` | ตั้งค่าใน URE | — |

---

## 19. การผสานรวมกับ URE

### URE (Universal Render Engine) คืออะไร

URE เป็นระบบ virtualized rendering ที่ ContentService ใช้สำหรับแสดงผลเนื้อหา route ทั่วไป โดย mount ครั้งเดียวแล้วใช้ recycling DOM

### Dependency Guard

```javascript
function _ensureURE() {
  if (window.URE) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error('[NavCore/Content] URE required.')),
      4000
    );
    window.addEventListener('ure:ready', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}
```

### URE Mount Call

```javascript
_ureHandle = window.URE.mount({
  container:          ctr,                    // #content-loading
  data:               items,                  // resolved groups
  keyField:           '_ureKey',             // unique key per item
  estimatedItemHeight: 130,                  // px
  buffer:             700,                    // px pre-buffer
  recycling:          true,                   // reuse DOM nodes
  template:           (item, l) => this._tpl(item, l),  // HTML generator
  onItemClick:        (e) => this._onClick(e),        // click handler
});
```

### Template System

ContentService สร้าง HTML string ด้วย template functions:

```javascript
_tpl(item, lang)
  ├── 'btn-row'       → _tplBtnRow()
  ├── 'card-group'    → _tplCardGroup()
  ├── 'card-group-h'  → _tplCardGroupH()
```

### Content-visibility สำหรับ Feed

เนื่องจาก feed ใช้ native DOM (ไม่ใช่ URE) จึงใช้ `content-visibility: auto`:

```css
.feed-page {
  content-visibility: auto;
  contain-intrinsic-block-size: 800px;
}
```

ทำให้ browser ไม่ต้อง render pages ที่อยู่นอก viewport แต่ scrollbar height ยังถูกต้อง

### URE Handle Lifecycle

```javascript
// สร้าง:
_ureHandle = window.URE.mount({...});

// ทำลาย (เมื่อ navigate ออก):
_ureHandle.destroy();

// อัพเดทภาษา:
_ureHandle.setLang(lang);
```

---

## 20. ไฟล์ JavaScript อิสระ

### 20.1 `modern-navigation.js`

**บทบาท**: สร้าง bottom navigation bar + left rail (desktop) + mobile auto-hide

**ส่วนประกอบหลัก**:

| Class | หน้าที่ |
|------|--------|
| `EventBus` | Tiny pub/sub สำหรับ internal use |
| `StorageAPI` | Safe wrappers สำหรับ localStorage/sessionStorage |
| `NavConfigLoader` | โหลด `/assets/json/template/template.json` |
| `NavPrefixManager` | จัดการ URL language prefix (เช่น `/th/home/`) |
| `NavRenderer` | สร้าง DOM elements สำหรับ nav items |
| `NavController` | Orchestrator หลัก |

**NavPrefixManager**:
- รองรับ 16 ภาษา: `th, en, ja, ko, zh, fr, de, es, it, pt, ru, ar, vi, id, ms, tl`
- `addPrefix(path, lang)` — เพิ่ม prefix `/th/` ตามภาษา
- `buildCandidates()` — สร้าง URL candidates สำหรับ language fallback
- `isDevMode` — ข้าม prefix เมื่อพัฒนาที่ localhost

**Screen Behavior**:
- **Desktop** (≥768px) — Left rail nav, fixed, height 100vh, width 88px
- **Mobile** (<768px) — Bottom nav, auto-hide เมื่อ scroll down, show เมื่อ scroll up

**Health Check System**:
- ตรวจทุก 5 วินาที (12 ครั้งแรก) แล้วทุก 30 วินาที
- Auto-recreate nav ถ้า DOM หาย หรือ items ว่าง

**Global API**:
```javascript
window.modernNav = {
  forceResync: () => controller.forceResync(),
  destroy: () => controller.destroy(),
  hideNav: (r) => controller._hideNav(),
  showNav: (r) => controller._showNav(),
};
```

---

### 20.2 `copyNotification.js`

**บทบาท**: แสดง notification "คัดลอกแล้ว / Copied" แบบ premium capsule

**การออกแบบ**:
- Off-white frosted-glass capsule (`backdrop-filter: blur(24px)`)
- จัดเรียง: `[Emoji] [คัดลอกแล้ว] | [ชื่อ item]`
- ตำแหน่ง: `bottom: calc(120px + safe-area-inset-bottom)` เพื่อไม่บัง bottom nav

**Timing**:
- Fade in: 320ms (ease-out)
- Display: 1800ms
- Fade out: 480ms (ease-in)

**Name Resolution Priority**:
1. `name` ที่ส่งมาโดยตรง (จาก home.js)
2. `ConDataService.resolveItem({ text })` — in-memory index
3. ไม่มีชื่อ — แสดงโดยไม่มี item name

**Global API**:
```javascript
window.showCopyNotification({ text, name, typeId, lang })
```

---

### 20.3 `footer-template.js`

**บทบาท**: สร้าง footer HTML จาก template file

**ขั้นตอน**:
1. โหลด CSS `/assets/css/footer.css`
2. Fetch `/assets/template-html/footer-template.html` (force-cache)
3. Parse + inject ต่อท้าย `<body>`
4. Fallback: สร้าง `<footer class="footer-minimal">© Fantrove</footer>` ถ้า fetch ล้มเหลว

**Guard**:
```javascript
if (window.__fantroveFooterInjected) return;
```

---

### 20.4 `banner-engine.js`

**บทบาท**: แสดง promotional banner จาก API ภายใน Shadow DOM

**2 Rendering Modes**:
- **builder** — สร้าง HTML จาก JSON config (slider, image, text, countdown, buttons)
- **html** — ใช้ customHtml + customCss โดยตรง

**ทำไมใช้ Shadow DOM**:
- Banner ต้องดูเหมือนกันทุกหน้า โดยไม่ถูกรบกวนจาก CSS ของหน้านั้น
- Shadow DOM สร้าง style boundary สมบูรณ์

**JS Triggers**: `confetti`, `shake`, `pulse`, `scroll_reveal`, `bounce`, `glow`

**Cache**: 60 วินาที พร้อม stale-while-revalidate

**Mounting**:
```html
<div data-banner="my-banner-slug"></div>
```

**Global API**:
```javascript
window.BannerEngine = {
  version: '5.0.0',
  mount: (selector, slug) => {},
  refresh: () => {},
  destroy: () => {},
};
```

---

### 20.5 `home.js`

**บทบาท**: แสดงหน้า Home ด้วย carousel ของ categories + view all button

**ข้อมูล**:
- ดึงจาก ConDataService (`getAssembled()`)
- Reorder ตามลำดับใน `index.json` files
- แสดงเฉพาะ copyable types (ข้าม card collections)

**Carousel System**:
- IntersectionObserver ตรวจ first/last card
- Left/Right arrow buttons แสดงเมื่อมี content ซ่อนอยู่
- `getCardStep()` คำนวณ step size จาก card width + gap

**Layout**:
```
Type Section
  ├── h2: type name
  ├── "View All" link
  └── Category Sections × 4
        ├── h2: category name
        └── Carousel Wrapper
              ├── Left Arrow
              ├── Track
              │   ├── Item Card × 20
              │   └── View All Card
              └── Right Arrow
```

**Copy Integration**:
```javascript
card.addEventListener('click', async () => {
  await copyToClipboard(item.text);
  window.showCopyNotification({ text, name, typeId, lang });
});
```

---

### 20.6 `new.js`

**บทบาท**: แสดงหน้า "What's New" พร้อม release notes + live relative timestamps

**ข้อมูล**:
- `whats-new.json` — release ปัจจุบัน
- `release-history.json` — ประวัติ releases
- `version.json` — สำหรับ version check

**Section Types**:
- `new` (เขียว) — ฟีเจอร์ใหม่
- `improved` (น้ำเงิน) — ปรับปรุง
- `fixed` (เหลือง) — แก้ไขปัญหา

**Live Relative Time**:
- อัพเดททุก 10-300 วินาทีขึ้นกับอายุ
- หลัง 10 วัน → แสดงวันที่แบบเต็มแทน relative time

**Polling**:
- `POLL_INTERVAL_MS = 60,000` — ตรวจ version update ทุก 60 วินาที
- Visibility refresh — ตรวจอีกครั้งเมื่อ tab กลับมา active

---

### 20.7 `roadmap.js`

**บทบาท**: แสดงหน้า Roadmap พร้อม stage-based feature list

**ข้อมูล**: `/assets/json/current-stage.json`

**Cache Strategy**:
- ลำดับความสำคัญ: In-memory → IndexedDB → localStorage
- Paint from cache ทันที → fetch เบื้องหลัง อัพเดทถ้าต่างกัน

**Feature Classification**:
```javascript
if (stageNumber < currentStage)       → 'past-feature'
else if (stageNumber === currentStage)  → 'new-feature' (ปัจจุบัน)
else if (stageNumber === currentStage + 1) → 'upcoming-feature'
else                                    → 'not-feature'
```

**Fast Compare**: `isDataDifferent()` เปรียบเทียบ version + stage + features ทุก field

---

### 20.8 `version-core.js`

**บทบาท**: ระบบ popup update notification แสดงเมื่อมี version ใหม่

**Logic**:
1. Fetch `whats-new.json` (single source of truth)
2. ตรวจ `wn.notify === false` → ไม่แสดง popup
3. ตรวจ dismissed state ใน localStorage
4. Session fresh check — แสดงอีกครั้งถ้า idle ≥ 90 นาที
5. แสดง popup modal พร้อม:
   - Version badge
   - Title + subtitle
   - รายการ changes (สูงสุด 4 items)
   - "See what's new" button → `/info/whats_new/`
   - "Don't show again" dismiss button

**Auto-Update Toggle**:
```javascript
// มี toggle ปิด/เปิด auto-update popup
// เก็บใน localStorage key: fv_noupdate
```

**Session Management**:
```javascript
// sessionStorage keys:
fv_ss_shown_{buildId}  // แสดงใน session นี้แล้วหรือยัง
fv_last_active          // เวลา active ล่าสุด
```

---

### 20.9 `back-to-top.js`

**บทบาท**: สร้างปุ่ม "กลับด้านบน" พร้อม auto show/hide

**Logic**:
- แสดงเฉพาะเมื่อ: `scrollY > 120` **และ** กำลัง scroll ขึ้น
- ซ่อนเมื่อ scroll ลงหรืออยู่ด้านบน
- ใช้ `requestAnimationFrame` ป้องกัน layout thrashing

```javascript
btn.className = (over && up) ? 'btt-shown' : 'btt-hidden';
```

**Accessibility**: `aria-label`, keyboard support (Enter/Space), `tabIndex: 0`

---

### 20.10 `back-button.js`

**บทบาท**: จัดการปุ่มย้อนกลับ (`#back-button`)

**Flow**:
1. ตรวจ `document.getElementById('back-button')` → ไม่มีก็จบ
2. กดปุ่ม → `setTimeout(100ms)` → `navigateBack()`
3. `navigateBack()`:
   - มี history → `history.back()` + ตรวจ referrer
   - ไม่มี history → redirect ไป `/home`
4. หลัง `history.back()` รอ 100ms ตรวจ referrer:
   - ไม่มี referrer → พยายาม predict language แล้ว redirect home

**Intent Tracking**:
```javascript
sessionStorage.setItem('fv-back-intent', String(Date.now()));
```

---

## 21. ผังการทำงานรวม

### 21.1 Application Startup Sequence

```
HTML Parsing
  │
  ├── <script> nav-core-early.js        ← เริ่มทันที (synchronous)
  │     ├── ensureDom()                  ← สร้าง DOM ขั้นต่ำ
  │     ├── showEarlyOverlay()           ← แสดง spinner
  │     └── fetchButtonsConfig()         ← ดึง buttons.json (force-cache)
  │           └── renderMinimal()        ← แสดงปุ่ม + content preview
  │
  ├── <script> modern-navigation.js     ← เริ่ม queueMicrotask
  │     └── NavController.init()         ← สร้าง bottom/left nav
  │
  ├── <script defer> ไฟล์อิสระ...       ← แต่ละไฟล์ทำงานอิสระ
  │
  └── <script defer> nav-core.js         ← เริ่มหลัง DOM พร้อม
        ├── Phase 1-5 loading (sequential)
        │     └── 14 module files
        └── _boot() → InitService.start()
              ├── Expose globals
              ├── Ensure DOM elements
              ├── Show loading overlay
              ├── ScrollService.init()
              ├── PerformanceService.init()
              ├── Load buttons.json
              ├── RouterService.init()
              ├── DataService._warmup()
              └── Initial navigation
                    └── RouterService.navigateTo()
                          ├── All button → ContentService.renderFeed()
                          │     ├── FeedService.loadNextPage()
                          │     ├── _appendFeedGroups()
                          │     └── _attachFeedSentinel()
                          └── Other route → ContentService.renderContent()
                                ├── DataService.fetchWithRetry()
                                ├── _resolveAll()
                                └── URE.mount()
```

### 21.2 Navigation Flow (User Clicks Button)

```
button click
  │
  ├── Remove .active จากปุ่มอื่น
  ├── Add .active ให้ปุ่มที่กด
  └── RouterService.navigateTo(url)
        │
        ├── LoadingService.show()
        ├── Acquire navigation mutex
        ├── Normalize URL → validate
        ├── setActiveButtons(main, sub)
        ├── history.pushState() → 'urlChanged' event
        │
        ├── main === '_all' ?
        │     ├── YES → ContentService.renderFeed(lang)
        │     └── NO  → clearContent()
        │               ├── fetch mainButton.jsonFile
        │               ├── fetch subButton.jsonFile (ถ้ามี)
        │               └── ContentService.renderContent(combined)
        │
        ├── 'routeChanged' event
        ├── scrollTo top (smooth)
        └── LoadingService.hide()
```

### 21.3 Content Click Flow (Copy)

```
button-content click
  │
  ├── e.target.closest('.button-content')
  └── ContentService._onClick(e)
        │
        └── unifiedCopyToClipboard({ text, api, type })
              │
              └── CopyService.copy()
                    ├── navigator.clipboard.writeText(text)
                    ├── Resolve item info from sharedIndex
                    └── showCopyNotification({ text, name, typeId, lang })
                          │
                          └── copyNotification.js
                                ├── resolveName() (optional ConDataService lookup)
                                └── show capsule with fade animation
```

---

> เอกสารนี้ครอบคลุมทุกระบบ JavaScript ของ Fantrove Verse ทั้ง Nav-Core system และไฟล์อิสระ AI สามารถอ่านเอกสารนี้อย่างเดียวแล้วเข้าใจ architecture, data flow, และการทำงานของทุกส่วนได้
tService._onClick(e)
        │
        └── unifiedCopyToClipboard({ text, api, type })
              │
              └── CopyService.copy()
                    ├── navigator.clipboard.writeText(text)
                    ├── Resolve item info from sharedIndex
                    └── showCopyNotification({ text, name, typeId, lang })
                          │
                          └── copyNotification.js
                                ├── resolveName() (optional ConDataService lookup)
     