# URE (Universal Render Engine) v1.7.0

## 1. ภาพรวม

**URE** เป็น virtual scrolling engine หลักของโปรเจกต์ Fantrove (หรือ Fantrove Verse) ที่ออกแบบมาเพื่อแสดงข้อมูลจำนวนมหาศาล (หลายหมื่นถึงหลายแสนรายการ) บนหน้าเว็บโดยไม่ทำให้หน้าเว็บช้า URE ทำงานโดยแสดงเฉพาะ DOM elements ที่อยู่ภายใน viewport และ buffer zone เท่านั้น และรีไซเคิล DOM nodes ที่หมดการใช้งานกลับเข้าสู่ pool แทนที่จะสร้าง/ทำลายใหม่ทุกครั้ง ซึ่งลด GC pressure ลงได้ 80-95%

URE โหลดผ่าน `<script src="/assets/js/ure/ure.js">` เพียง tag เดียว จากนั้นระบบจะทำการโหลด module ทั้ง 12 ไฟล์ตามลำดับ dependency อัตโนมัติ รวมถึง auto-inject CSS ด้วย

**เวอร์ชันปัจจุบัน**: 1.7.0 (เพิ่ม Adaptive Memory Management)

---

## 2. สถาปัตยกรรม

### 2.1 การโหลด Module

`ure.js` ทำหน้าที่เป็น entry point โหลด module ทั้ง 12 ไฟล์ใน `ure-modules/` ตามลำดับ dependency อย่างเคร่งครัด:

```
types.js        → Typedefs (JSDoc only, ไม่มี runtime code)
config.js       → Constants, device tier, memory budgets
memory.js       → MemoryManager singleton (v1.7.0) — ต้องโหลดหลัง config
scheduler.js    → rAF + rIC orchestration
pool.js         → DOM node recycling
observer.js     → IO / RO / MO factories
diffing.js      → O(n) data diff
state.js        → Reactive state store
worker.js       → Web Worker bridge
lazy-assets.js  → Lazy img/iframe/bg loading
virtual-list.js → Core virtual scroll engine
engine.js       → Main orchestrator
```

### 2.2 Module Pattern

ทุก module ใช้ **IIFE pattern** เดียวกันทั้งระบบ:

```javascript
(function(M) {
  'use strict';
  // ... module code ...
  M.ModuleName = ModuleName; // export ไปยัง namespace
})(window.UREModules = window.UREModules || {});
```

Namespace หลัก: `window.UREModules` — เป็นที่เก็บทุก module internal

### 2.3 Public API

หลังจาก boot เสร็จ `ure.js` จะสร้าง `window.URE` (frozen object) ที่เป็น public API:

```javascript
window.URE = Object.freeze({
  mount(opts)           // สร้าง engine instance ใหม่ → EngineHandle
  getInstance(container) // ดึง instance ที่ mount อยู่
  destroyAll()          // ทำลายทุก instance (SPA route transition)
  modules()             // ดึง UREModules namespace (advanced use)
  config()              // ดึง CONFIG constants
  memoryStats()         // ดึง memory pressure stats
  memoryCheckpoint()    // force ประเมิน memory pressure
  debug()               // log stats table ทุก instance
});
```

**Custom Event**: หลัง boot เสร็จจะ dispatch `ure:ready` พร้อม `{ version: '1.7.0' }`

---

## 3. รายละเอียด Module ทั้ง 12

### 3.1 types.js — Typedefs

ไฟล์นี้ไม่มี runtime code มีเฉพาะ JSDoc typedefs ที่ใช้อธิบาย types ต่างๆ:

| Type | คำอธิบาย |
|------|-----------|
| `UREngineOptions` | Options สำหรับ `URE.mount()` — container, data, template, buffer, recycling, diffing, keyField, lang, poolCap, ฯลฯ |
| `RenderFn` | `(item, lang) => HTML string` — ฟังก์ชัน render แต่ละ item |
| `OnVisibleFn` | `(item, el) => void` — เรียกเมื่อ item เข้า viewport |
| `OnHiddenFn` | `(item) => void` — เรียกเมื่อ item ออกจาก viewport |
| `OnUpdateFn` | `({ added, removed, changed }) => void` |
| `OnItemClickFn` | `(event, item) => void` — delegated click handler |
| `URItemRecord` | Internal record: data, key, index, el |
| `URTask` | Scheduler task: priority, fn, name |
| `URDiffResult` | Diff result: added, removed, changed, moved |
| `URPoolBucket` | Pool entry: nodes[], cap |

---

### 3.2 config.js — Configuration Constants

กำหนดค่าคงที่ทั้งหมดของ URE แบ่งเป็นหมวด:

**RENDER** — ค่าหลักสำหรับ rendering:
```javascript
DEFAULT_BUFFER_PX: 600,      // px นอก viewport ที่จะ pre-render
DEFAULT_ITEM_HEIGHT: 96,     // ค่าประมาณความสูง item (px)
DEFAULT_POOL_CAP: 60,        // จำนวน node สูงสุดใน pool
IO_THRESHOLD: 0,
SENTINEL_MARGIN: '700px',
DEFAULT_OVERSCAN: 0,
INITIAL_MOUNT_MULTIPLIER: 1,
```

**ANCHOR** — Scroll anchor:
```javascript
APPLY_VEL_THRESHOLD: 1.5,    // ไม่ apply anchor เมื่อ scroll velocity สูงกว่านี้
```

**CACHE** — Storage cache:
```javascript
HEIGHT_PREFIX: 'ure_h_',     // sessionStorage key prefix สำหรับ height cache
SCROLL_PREFIX: 'ure_sp_',    // sessionStorage key prefix สำหรับ scroll position
MAX_ENTRIES: 5000,
VERSION: 1,
```

**LARGE_DATASET** (v1.6.0) — ค่า comfortable-level defaults:
```javascript
WORKER_PERSIST_N: 10_000,    // threshold โหลด data เข้า Worker
CHUNK_INIT_N: 50_000,        // threshold ใช้ chunked height init
INIT_CHUNK_SIZE: 5_000,      // ขนาด chunk
TEMPLATE_CACHE_CAP: 2_000,   // จำนวน template HTML ที่ cache สูงสุด
```

**MEMORY** (v1.7.0) — Adaptive memory:
```javascript
POLL_INTERVAL_MS: 30_000,                    // ตรวจ heap ทุก 30 วินาที
DEVICE_MEMORY_THRESHOLDS_GB: [4, 2, 1],      // breakpoints ตาม device memory
HEAP_USAGE_THRESHOLDS: [0.50, 0.70, 0.85],   // breakpoints ตาม heap ratio
```

**BUDGETS** แต่ละ key เป็น array `[comfortable, moderate, tight, critical]`:
| Key | Comfortable | Moderate | Tight | Critical |
|-----|-------------|----------|-------|----------|
| POOL_CAP | 60 | 40 | 20 | 8 |
| TMPL_CACHE_CAP | 2,000 | 800 | 200 | 50 |
| PRE_CACHE_CAP | 48 | 24 | 8 | 2 |
| HEIGHT_CACHE_MAX | 5,000 | 3,000 | 1,500 | 500 |
| WORKER_PERSIST_N | 10,000 | 5,000 | 2,000 | 1,000 |
| CHUNK_INIT_N | 50,000 | 30,000 | 15,000 | 5,000 |
| BUFFER_PX | 600 | 400 | 200 | 100 |
| MOUNT_CAP_SCALE | 1.0 | 1.0 | 0.75 | 0.5 |

**TIMING**:
```javascript
HEIGHT_CORRECTION_RATE_MS: 100,
IDLE_CALLBACK_TIMEOUT_MS: 300,
SCROLL_IDLE_MS: 100,
RESIZE_IDLE_MS: 150,
PRELOAD_DELAY_MS: 200,
```

**DIFF**:
```javascript
FALLBACK_KEY_FIELD: 'id',
FULL_REPLACE_THRESHOLD: 50_000,  // หาก old+new เกิน 50,000 → full replace ไม่ diff
```

**DOM Attributes**:
```javascript
CONTAINER_ATTR: 'data-ure-container',
ITEM_ATTR: 'data-ure-key',
PLACEHOLDER_CLASS: 'ure-placeholder',
SPACER_CLASS: 'ure-spacer',
VISIBLE_CLASS: 'ure-visible',
SETTLED_CLASS: 'ure-settled',
```

**DEVICE_TIER** — คำนวณจาก `navigator.hardwareConcurrency` และ `navigator.deviceMemory`:
- Tier 0: cores ≤ 2 หรือ memory ≤ 1GB (low-end)
- Tier 1: cores ≤ 4 หรือ memory ≤ 2GB (mid-range)
- Tier 2: อื่นๆ (high-end)

**BATCH** — render chunk ต่อ rAF frame:
```javascript
RENDER_CHUNK:  [4, 8, 16][DEVICE_TIER]
PRELOAD_CHUNK: [8, 16, 32][DEVICE_TIER]
```

---

### 3.3 memory.js — Adaptive Memory Manager (v1.7.0)

Singleton ที่ตรวจจับ memory pressure แบบ real-time และปรับ budget ของทุก component อัตโนมัติ

**4 ระดับ Pressure**:
| Level | ค่า | คำอธิบาย |
|-------|-----|-----------|
| COMFORTABLE | 0 | ใช้งานปกติ ใช้ budget เต็ม |
| MODERATE | 1 | เริ่มมีแรงกดดัน ลด cache/buffer ลง |
| TIGHT | 2 | memory ใกล้เต็ม ลด pool/cache อย่างมาก |
| CRITICAL | 3 | ใกล้ OOM ปล่อย worker data + ทำลาย pool |

**Detection Strategy** (ใช้ค่าที่สูงกว่า):
1. **Static** — `navigator.deviceMemory` ตรวจตอน init (ทุก browser)
2. **Dynamic** — `performance.memory` heap ratio ตรวจทุก 30 วินาที (Chromium เท่านั้น)
3. **Page-hidden** — re-evaluate ทันทีเมื่อ `visibilitychange` → hidden

**Public API** (`M.MemoryManager`):
```javascript
MemoryManager.level           // ระดับปัจจุบัน (0-3)
MemoryManager.getBudget(key)  // ดึง cap ของ component ตาม pressure ปัจจุบัน
MemoryManager.getAllBudgets() // ดึงทุก budget
MemoryManager.on(fn)          // subscribe pressure change → (next, prev) => void
MemoryManager.checkpoint()    // force evaluate ทันที
MemoryManager.levelName()     // 'COMFORTABLE' | 'MODERATE' | 'TIGHT' | 'CRITICAL'
MemoryManager.stats()         // { level, heapUsed, heapLimit, heapRatio, deviceMemGB, budgets }
MemoryManager.destroy()       // cleanup (test only)
```

---

### 3.4 scheduler.js — Task Scheduler

จัดการ task scheduling แยกเป็น 2 ลำดับความสำคัญ:

**Visual tasks** (`schedule(fn, name)`) → ทำใน `requestAnimationFrame`
**Background tasks** (`scheduleIdle(fn, name)`) → ทำใน `requestIdleCallback` (หรือ `setTimeout` fallback)

**MessageChannel yield** — ใช้ MessageChannel แทน `setTimeout(0)` เพื่อ yield ให้ compositor ทำงานเร็วกว่า:

```javascript
const { port1, port2 } = new MessageChannel();
port1.onmessage = () => { /* resolve */ };
port2.postMessage(null); // ทำให้ browser paint ก่อน
```

**Batch processing** — แบ่ง large array ออกเป็น chunks แล้ว yield ระหว่าง chunk:
```javascript
await Scheduler.processBatched(items, processFn, chunkSize);
```

**API**:
```javascript
Scheduler.schedule(fn, name)        // queue visual task
Scheduler.scheduleIdle(fn, name)    // queue idle task
Scheduler.yield()                   // async yield to compositor
Scheduler.processBatched(items, fn, chunkSize)
Scheduler.cancel()                  // ยกเลิกทุก pending task
```

---

### 3.5 pool.js — DOM Node Recycling Pool

สร้าง/รีไซเคิล DOM wrapper elements แทนที่จะ create/destroy ทุกครั้ง ลด GC pressure 80-95%

**การทำงาน**:
- `acquire(type)` — เอา node จาก pool หรือสร้างใหม่ (ถ้า pool ว่าง)
- `release(node, type)` — คืน node เข้า pool (ถ้ายังไม่เต็ม cap)
- `getCap()` / `setCap(newCap)` — (v1.7.0) ปรับ cap แบบ dynamic ตาม memory pressure

**Pool structure**: `Map<string, HTMLElement[]>` — แยก bucket ตาม type (เช่น `'emoji'`, `'symbol'`, `'item'`)

**v1.7.0 Dynamic cap**: เมื่อ MemoryManager สั่งลด cap `setCap()` จะ drain nodes เกิน cap ทิ้งทันทีพร้อม `innerHTML = ''` เพื่อให้ child subtrees ถูก GC ทัน

**Data binding**: ใช้ `WeakMap<node, data>` เก็บ item data กับ node โดยไม่ขัดจังหวะ GC

**API**:
```javascript
const pool = createPool(cap);
pool.acquire(type)      // → HTMLElement
pool.release(node, type)
pool.bind(node, data)   // เก็บ data กับ node
pool.getData(node)      // → data
pool.getCap()           // → number
pool.setCap(newCap)     // ลด/เพิ่ม cap พร้อม drain
pool.stats()            // → { cap, buckets: { type: count } }
pool.destroy()
```

---

### 3.6 observer.js — Observer Factory

Centralized factory สำหรับสร้างทุกประเภทของ Observer พร้อม error handling และ cleanup อัตโนมัติ:

| Factory | คำอธิบาย | ใช้ที่ |
|---------|-----------|--------|
| `createIO(callback, opts)` | IntersectionObserver ทั่วไป | lazy loading |
| `createSentinelIO(callback, margin)` | IO พร้อม root margin ขนาดใหญ่ (default 700px) | sentinel detection |
| `createViewportIO(root, callback, bufferPx)` | IO สำหรับ item visibility ภายใน scroll root | virtual list |
| `createRO(callback)` | ResizeObserver สำหรับวัด item height | height measurement |
| `createMO(callback)` | MutationObserver สำหรับตรวจ DOM mutation | external change detection |
| `disconnect(obs)` | ตัด connection อย่างปลอดภัย | cleanup |

---

### 3.7 diffing.js — Data Diffing Engine

เปรียบเทียบ 2 data arrays แบบ O(n+m) เพื่อหา added/removed/changed/moved items:

**Algorithm** (3 passes):
1. **Pass 1** — index old items ลง `Map<key, {index, item}>`
2. **Pass 2** — walk new items, ตรวจ added/changed/moved
3. **Pass 3** — ตรวจ removed (items ใน old ที่ไม่อยู่ใน new)

**Key extraction** — รองรับ 2 วิธี:
- `keyField`: ใช้ field จาก object (default: `'id'`)
- `keyFn`: ใช้ custom function `(item) => string` (v1.3.0)

**Full replace threshold**: หาก `old.length + new.length > 50,000` → ข้าม diff ทั้งหมด ทำ full replace แทน (ป้องกัน lag)

**Shallow equality**: ใช้สำหรับ detect changed items — เปรียบเทียบ key count และ value ทุก key

**API**:
```javascript
DiffEngine.diff(oldItems, newItems, keyField, keyFn)
// → { fullReplace, added: Map, removed: Set, changed: Map, moved: Map }

DiffEngine.extractKey(item, keyField, keyFn)
// → string | undefined
```

---

### 3.8 state.js — Reactive State Store

State store แบบ lightweight สำหรับแต่ละ engine instance (ไม่ใช่ singleton):

**คุณสมบัติ**:
- `get(key)` — อ่านค่า
- `snapshot()` — shallow copy ทั้ง state
- `set(keyOrObj, value)` — set ค่า + แจ้ง listeners (skip ถ้าค่าเดียวกัน, reference equality)
- `on(key, fn)` — subscribe ตาม key → `(newValue, prevValue, key) => void` → returns unsubscribe
- `onAny(fn)` — subscribe ทุก change → `(changedArray, fullState) => void`
- `off(key, fn)` — unsubscribe
- `destroy()` — clear listeners + state

**การทำงาน**: เมื่อ `set()` ถูกเรียก จะเปรียบเทียบค่าเดิม ถ้าต่างกันจะ notify key-specific listeners ก่อน แล้ว global listeners ทีหลัง

---

### 3.9 worker.js — Web Worker Bridge

สะพานเชื่อมไปยัง Web Worker เพื่อ offload data processing ออกจาก main thread

**Worker operations**:
| Action | คำอธิบาย | ใช้ stored data? |
|--------|-----------|-------------------|
| `loadData` | (v1.6.0) โหลด dataset เก็บใน Worker memory | — |
| `clearData` | (v1.6.0) ปล่อย reference ให้ GC | — |
| `filter` | กรองด้วย predicates (eq, neq, gt, lt, includes, startsWith, ฯลฯ) | ✅ |
| `sort` | เรียงลำดงตาม field + direction | ❌ (ใช้ current view) |
| `filterSort` | filter แล้ว sort | ✅ |
| `dedupe` | ลบ duplicates ตาม field | ✅ |
| `transform` | เพิ่ม field ใหม่ | ❌ |
| `paginate` | แบ่งหน้า | ✅ |

**v1.6.0 Persistent Data**: เมื่อ dataset ≥ `WORKER_PERSIST_N` (default 10,000) engine จะโหลด data เข้า Worker ครั้งเดียว จากนั้น filter/paginate จะ **ไม่ส่ง items ใน message** ช่วยประหยัด structured-clone cost สำหรับ dataset ขนาดใหญ่

**Fallback**: หาก Worker ไม่ available จะทำงานแบบ synchronous บน main thread แทน (มี duplicate sync implementations)

**API** (`createWorkerBridge()`):
```javascript
const bridge = createWorkerBridge();
bridge.exec(action, payload)   // generic execute
bridge.loadData(items)          // preload ข้อมูล
bridge.clearData()              // release
bridge.filter(items, predicates)
bridge.sort(items, field, dir)
bridge.filterSort(items, predicates, field, dir)
bridge.dedupe(items, field)
bridge.paginate(items, page, pageSize)
bridge.isWorkerMode             // → boolean
bridge.dataLoaded               // → boolean
bridge.destroy()
```

---

### 3.10 lazy-assets.js — Lazy Asset Loading

Lazy-loads รูปภาพ, iframe และ background-image ภายใน rendered items โดยใช้ IntersectionObserver พร้อม buffer zone

**รูปแบบที่รองรับ**:
```html
<img data-src="...">           <!-- lazy load src -->
<img data-srcset="...">        <!-- lazy load srcset -->
<iframe data-src="...">        <!-- lazy load iframe -->
<div data-bg="...">            <!-- lazy load background-image -->
```

**CLS Prevention**: แทรก `aspect-ratio` CSS จาก width/height attributes ของ `<img>` เพื่อป้องกัน layout shift

**Loading states**: เพิ่ม CSS classes:
- `ure-img-loading` → ระหว่างโหลด
- `ure-img-loaded` → โหลดเสร็จ
- `ure-img-error` → โหลดล้มเหลว

**API** (`createLazyAssets(bufferPx)`):
```javascript
const lazy = createLazyAssets(600);
lazy.observe(container)    // scan + register ทุก lazy elements
lazy.loadAll(container)    // โหลดทั้งหมดทันที (print mode)
lazy.unobserve(container)  // ยกเลิก observe (เมื่อ recycle node)
lazy.destroy()
```

---

### 3.11 virtual-list.js — Core Virtual Scroll Engine

หัวใจหลักของ URE ที่ทำ virtual scrolling ทั้งแบบ list และ grid

**Key Data Structures** (Typed Arrays):
```javascript
_hgt     = new Float32Array(n)    // ความสูงแต่ละ item
_measured = new Uint8Array(n)     // 1 = วัดจริงแล้ว, 0 = ยังไม่วัด
_seenIdx  = new Uint8Array(n)     // 1 = เคย render แล้ว
_off      = new Float64Array(n+1) // cumulative offset (list mode)
_rHgt     = new Float32Array(rows) // row height (grid mode)
_rOff     = new Float64Array(rows+1) // cumulative row offset (grid mode)
```

**Template HTML Cache** (v1.6.0):
```javascript
_tmplCache = new Map() // key → { html, lang, item }
```
เก็บ rendered HTML ไว้ เมื่อ item เดียวกันถูก render ซ้ำจะใช้ cache แทนเรียก template function อีกครั้ง Evict oldest เมื่อเต็ม cap (O(1) ด้วย Map insertion-order)

**Pre-render Cache**: ใช้ `requestIdleCallback` pre-render items ล่วงหน้าในทิศทาง scroll พร้อม velocity-awareness

**Scroll Anchor Protocol** (v1.5.0):
- เมื่อ height correction เกิดขึ้น จะ capture ตำแหน่ง item ปัจจุบัน
- คำนวณ delta ของ offset ใหม่
- ปรับ scroll position ให้ item เดียวกันยังคงอยู่ตำแหน่งเดิม
- ไม่ apply เมื่อ scroll velocity > 1.5 px/ms

**Height Measurement Flow**:
1. Item ถูก mount → ResizeObserver observe
2. DOM render เสร็จ → RO วัดความสูงจริง
3. ถ้าต่างจาก estimate > 2px → ทำให้ offset array dirty
4. Debounce correction 100ms แล้ว rebuild offsets + restore anchor
5. บันทึกความสูงลง height cache

**Chunked Height Init** (v1.6.0): สำหรับ dataset > 50,000 items จะโหลด height cache แบบ chunked ด้วย `requestIdleCallback` แทนที่จะทำครั้งเดียว

**Velocity-aware Buffer**:
```javascript
const bufAhead = fast ? buf * 1.6 : buf;  // ขยาย buffer ข้างหน้าเมื่อ scroll เร็ว
const bufBehnd = fast ? buf * 0.4 : buf;  // ลด buffer ข้างหลัง
```

**v1.7.0 Adaptive Memory**: `setMemoryBudget(budget)` รับ budget จาก MemoryManager แล้ว:
- ลด `_tmplCap` + trim `_tmplCache` ทันที
- ลด `_PRE_CAP` + trim `_preCache` ทันที
- ลด `_buffer` (ทำให้ pre-render น้อยลง)
- ลด `_chunkInitN` (ทำให้ chunked init threshold ลดลง)
- ลด `pool.setCap()` (drain excess nodes ทันที)
- ลด `_MOUNT_CAP` ตาม `MOUNT_CAP_SCALE`

**Public API** (`createVirtualList(opts)`):
```javascript
const vl = createVirtualList({
  container, viewport, items, renderFn, lang, buffer, recycling,
  poolCap, horizontal, columns, gap, overscan, heightCache,
  keyExtractor, scrollRestorePos, onVisible, onHidden, onScrollEnd
});

vl.mount()
vl.setItems(newItems)
vl.updateItem(index, newData)
vl.insertAt(index, newItems)
vl.removeAt(index, count)
vl.setLang(newLang)
vl.setMemoryBudget(budget)   // v1.7.0
vl.refresh()
vl.scrollToIndex(index, behavior)
vl.getVisibleRange()          // → { startIndex, endIndex }
vl.stats()                     // → { items, visible, totalSize, stable, ... }
vl.destroy()
```

---

### 3.12 engine.js — Main Orchestrator

เป็น module สุดท้ายที่รวมทุก module เข้าด้วยกัน และเป็นที่ `URE.mount()` เรียกใช้

**Mount Flow**:
1. ตรวจ container ถ้ามี instance เดิมอยู่จะ destroy ก่อน
2. สร้าง key extractor function (จาก `keyField` หรือ `itemKey` function)
3. โหลด height cache จาก sessionStorage
4. โหลด scroll position จาก sessionStorage
5. (v1.7.0) คำนวณ initial budget จาก MemoryManager → ใช้ค่าที่น้อยกว่าระหว่าง user option กับ memory budget
6. สร้าง StateStore, LazyAssets, WorkerBridge, VirtualList
7. Subscribe ถึง `MemoryManager.on()` สำหรับ runtime pressure changes
8. (v1.6.0) Pre-load data เข้า Worker ถ้า ≥ `WORKER_PERSIST_N`
9. ตั้ง delegated click handler, language change listener
10. ตั้ง persistence listeners (visibilitychange, pagehide, orientationchange)

**Data Operations** (ผ่าน EngineHandle):
```javascript
handle.setData(newData)        // แทนที่ข้อมูลทั้งหมด (พร้อม diff)
handle.append(items)            // เพิ่มท้าย
handle.prepend(items)           // เพิ่มหัว
handle.removeByKey(keyValue)    // ลบตาม key
handle.updateMany(items)        // อัปเดตหลาย items
handle.loadChunked(source)      // โหลดแบบ chunked (array หรือ async iterator)
handle.filter(predicates)       // กรองผ่าน Worker
handle.sort(field, dir)         // เรียงลำดับผ่าน Worker
handle.resetFilter()            // คืนข้อมูลเดิม
handle.paginate(page, pageSize) // แบ่งหน้า
```

**Memory Pressure Handler** (v1.7.0):
```javascript
function _onMemoryPressure(next) {
  const budget = MemoryManager.getAllBudgets();
  vl.setMemoryBudget(budget);        // propagate ไปยัง virtual list
  _trimHeightCache(_heightCache, budget.HEIGHT_CACHE_MAX); // ลด height cache
  if (next === PRESSURE.CRITICAL && document.hidden && worker.dataLoaded) {
    worker.clearData();  // ปล่อย worker stored data — ใหญ่ที่สุดใน memory
  }
}
```

**Persistence**:
- Height cache → `sessionStorage` (key: `ure_h_{cacheKey}`)
- Scroll position → `sessionStorage` (key: `ure_sp_{cacheKey}`)
- บันทึกเมื่อ `visibilitychange` → hidden และ `pagehide`
- ล้าง height cache เมื่อ `orientationchange` (ความสูงเปลี่ยน)

---

## 4. Global Variables และ Events

### Global Variables

| Variable | ตั้งโดย | Type |
|----------|---------|------|
| `window.URE` | ure.js | Frozen object (public API) |
| `window.UREModules` | ทุก URE module | Namespace object |

### Custom Events

| Event | ผู้ส่ง | Detail |
|-------|-------|--------|
| `ure:ready` | ure.js | `{ version: '1.7.0' }` |
| `languageChange` | Language System | `{ language, previousLanguage }` (URE ฟังอยู่) |

---

## 5. Performance Techniques สรุป

| เทคนิค | Module | รายละเอียด |
|--------|--------|-------------|
| Virtual Scrolling | virtual-list.js | แสดงเฉพาะ items ใน viewport + buffer zone |
| DOM Node Pooling | pool.js | Recycle DOM nodes แทน create/destroy (ลด GC 80-95%) |
| Adaptive Memory | memory.js | ตรวจ heap ทุก 30s, ปรับ cap อัตโนมัติ 4 ระดับ |
| Web Workers | worker.js | Filter/sort/paginate ทำนอก main thread |
| Typed Arrays | virtual-list.js | Float32Array/64Array/Uint8Array สำหรับ offsets |
| Template Cache | virtual-list.js | Map cache ของ rendered HTML (evict oldest) |
| Height Cache | engine.js | sessionStorage บันทึกความสูง item |
| Scroll Anchor | virtual-list.js | ป้องกัน jump เมื่อ height correction |
| Lazy Asset Loading | lazy-assets.js | img/iframe/bg โหลดเมื่อเข้า buffer zone |
| CSS Containment | virtual-list.js | `contain: layout style paint` บนทุก item |
| Velocity-aware Buffer | virtual-list.js | ขยาย buffer ข้างหน้าเมื่อ scroll เร็ว |
| Pre-render Cache | virtual-list.js | requestIdleCallback pre-render ล่วงหน้า |
| Chunked Init | virtual-list.js | โหลด height cache แบบ chunked สำหรับ 50K+ items |
| Worker Persistence | worker.js | เก็บ data ใน Worker memory, ไม่ส่งซ้ำ |
| rAF Batching | scheduler.js | Single paint per frame |
| MessageChannel Yield | scheduler.js | Yield ให้ compositor paint ก่อน |
| Device Tier Detection | config.js | ปรับ render chunk ตาม CPU/Memory ของอุปกรณ์ |
| CLS Prevention | lazy-assets.js | aspect-ratio จาก width/height attrs |
| Delegated Events | engine.js | click handler เดียวบน container |
| Incremental Offset Rebuild | virtual-list.js | Rebuild offset เฉพาะตั้งแต่ dirty index |

---

## 6. วิธีใช้งาน (สำหรับ AI ที่จะต่อยอด)

### 6.1 การ Mount URE

```javascript
const handle = URE.mount({
  container: '#my-list',          // Element หรือ CSS selector
  data: myItems,                  // Array of data
  template: (item, lang) => {     // ฟังก์ชัน render แต่ละ item
    return `<div class="card">${item.name}</div>`;
  },
  buffer: 600,                    // px นอก viewport (default: 600)
  recycling: true,                // เปิด DOM pooling (default: true)
  diffing: true,                  // เปิด data diffing (default: true)
  keyField: 'id',                 // field สำหรับ identity (default: 'id')
  lang: 'th',                     // ภาษา (default: 'en' หรือ localStorage)
});
```

---

## 11. Quick Start (สำหรับการใช้งานรวดเร็ว)

> ส่วนนี้รวมมาจาก `assets/js/ure/Readme.md` เดิม เพื่อให้นักพัฒนา/AI สามารถเริ่มใช้งาน URE ได้ทันทีโดยไม่ต้องอ่านเอกสารยาวทั้งหมด

### 11.1 การโหลด

```html
<script src="/assets/js/ure/ure.js"></script>
```

### 11.2 การใช้งานขั้นต่ำ

```js
window.addEventListener('ure:ready', () => {
  const list = URE.mount({
    container : '#app',
    data      : myJsonArray,
    template  : (item, lang) => `<div class="card">${item.name?.[lang] || item.name?.en}</div>`,
  });
});
```

### 11.3 ตัวเลือก `URE.mount(options)` แบบเต็ม

| Option | Type | Default | คำอธิบาย |
|---|---|---|---|
| `container` | `Element\|string` | **required** | DOM element หรือ CSS selector |
| `data` | `any[]` | `[]` | Array ของ data items |
| `template` | `(item, lang) => string` | **required** | HTML string สำหรับแต่ละ item |
| `buffer` | `number` | `600` | px ที่ pre-render ไว้นอก viewport (clamped to memory budget) |
| `overscan` | `number` | `0` | จำนวน items นอก viewport ที่จะ pre-render (override buffer px) |
| `columns` | `number` | `1` | Grid layout columns (>1 = grid mode) |
| `gap` | `number` | `0` | ระยะห่างระหว่าง item/row ใน px |
| `recycling` | `boolean` | `true` | เปิด DOM node pool |
| `diffing` | `boolean` | `true` | เปิด diff — re-render เฉพาะ item ที่เปลี่ยน |
| `keyField` | `string` | `'id'` | Field ที่ใช้เป็น identity ใน diff |
| `itemKey` | `(item) => string` | `null` | Function-based key extraction — override `keyField` |
| `lang` | `string` | `localStorage.selectedLang \|\| 'en'` | ภาษาเริ่มต้น |
| `poolCap` | `number` | `60` | Max nodes ใน pool (clamped to memory budget at mount time) |
| `horizontal` | `boolean` | `false` | Horizontal scroll mode |
| `cacheKey` | `string` | `container.id + '_' + keyField` | Key สำหรับ sessionStorage |
| `onVisible` | `(item, el) => void` | - | Callback เมื่อ item เข้า viewport |
| `onHidden` | `(item) => void` | - | Callback เมื่อ item ออก viewport |
| `onUpdate` | `({added, removed, changed}) => void` | - | หลัง data update |
| `onItemClick` | `(event, item) => void` | - | Delegated click |
| `onScrollEnd` | `() => void` | - | Callback เมื่อ scroll หยุด |

> **v1.7.0:** `poolCap` และ `buffer` จะถูก clamp ด้วย memory budget ณ เวลา mount — ค่า `Math.min(userValue, budget)` — ป้องกัน low-memory device เริ่มต้นด้วย cap ใหญ่เกินไป

### 11.4 EngineHandle methods

```js
// Data
handle.setData(newArray)
handle.append(items)
handle.prepend(items)
handle.removeByKey(keyValue)
handle.updateMany(items)
await handle.loadChunked(source, chunkSize?)

// Async Worker
await handle.filter(predicates)
await handle.sort(field, dir)
handle.resetFilter()
await handle.paginate(page, size)

// UI
handle.setLang(lang)
handle.setTemplate(newTemplateFn)
handle.setColumns(n)
handle.scrollToIndex(index, behavior?)
handle.scrollToKey(key, behavior?)
handle.scrollBy(dy, behavior?)

// Lifecycle
handle.destroy()
```

### 11.5 ไฟล์อ้างอิง

- `assets/js/ure/ure-examples.js` — ตัวอย่างโค้ดอ้างอิง (ห้ามโหลดใน production)

---

> **เอกสารฉบับนี้สร้างขึ้นเพื่อให้ AI หรือนักพัฒนาสามารถเข้าใจระบบ URE ทั้งหมดได้จากเอกสารฉบับเดียว — โดยไม่ต้องอ่าน source code โดยตรง**
