# URE — Universal Render Engine v1.7.0

**Zero-config virtual scroll + lazy loading + diff-aware updates for Fantrove.**  
ใช้กับทุกหน้า (home, discover, search, setting) โดยไม่ต้อง optimize ซ้ำทุกครั้ง

---

## 📁 โครงสร้างไฟล์

```
assets/js/ure/
├── ure.js                    ← Entry point
├── ure.css                   ← Structural styles (auto-injected)
├── ure-examples.js           ← Reference code — ห้ามโหลดใน production
└── ure-modules/
    ├── types.js
    ├── config.js             ← Constants + device tier + GRID + CACHE + ANCHOR + MEMORY defaults
    ├── memory.js             ← ★ v1.7.0 — MemoryManager singleton (pressure detection + budgets)
    ├── scheduler.js
    ├── pool.js               ← DOM node recycling (getCap/setCap added v1.7.0)
    ├── observer.js
    ├── diffing.js            ← O(n+m) diff + optional itemKey fn
    ├── state.js
    ├── worker.js
    ├── lazy-assets.js
    ├── virtual-list.js       ← Core virtual scroll + setMemoryBudget() added v1.7.0
    └── engine.js             ← Orchestrator + MemoryManager integration v1.7.0
```

---

## ⚡ Quick Start

```html
<script src="/assets/js/ure/ure.js"></script>
```

```js
window.addEventListener('ure:ready', () => {
  const list = URE.mount({
    container : '#app',
    data      : myJsonArray,
    template  : (item, lang) => `<div class="card">${item.name?.[lang] || item.name?.en}</div>`,
  });
});
```

---

## 📖 Full API

### `URE.mount(options)` → `EngineHandle`

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

> **v1.7.0:** `poolCap` และ `buffer` จะถูก clamp ด้วย memory budget ณ เวลา mount
> — ค่า `Math.min(userValue, budget)` — ป้องกัน low-memory device เริ่มต้นด้วย cap ใหญ่เกินไป

---

### `EngineHandle` methods

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
handle.scrollTo(index, behavior)
handle.scrollToKey(keyValue, bhv)
handle.refresh()

// Visibility
handle.getVisibleRange()          // → { startIndex, endIndex }

// State
handle.on('lang', fn)             // → unsubscribe fn
handle.onAny(fn)

// Read-only
handle.itemCount
handle.lang
handle.loading

// Debug
handle.stats()
handle.destroy()
```

> **v1.7.0:** `handle.stats()` เพิ่ม `memory` (pressure level + budgets) และ `vl.caps` (active cap values)

---

### Global API (v1.7.0)

```js
URE.memoryStats()       // → snapshot ของ MemoryManager (level, heapRatio, budgets)
URE.memoryCheckpoint()  // force re-evaluate pressure ทันที (เรียกหลัง load data ขนาดใหญ่)
```

---

### Filter Predicates

```js
await handle.filter({ field: 'type', op: 'eq', value: 'emoji' })
await handle.filter([
  { field: 'type',    op: 'eq',       value: 'emoji' },
  { field: 'name.en', op: 'includes', value: 'smile' },
])
// eq | neq | gt | lt | gte | lte | includes | startsWith
```

---

## 🧠 Adaptive Memory Management (v1.7.0)

URE v1.7.0 เพิ่มระบบ **MemoryManager** ที่ตรวจจับ memory pressure แบบ dynamic และปรับ cap ของทุก component ให้เหมาะสมกับอุปกรณ์และสถานการณ์จริง

### Pressure Levels

| Level | ค่า | เงื่อนไข (device) | เงื่อนไข (heap) |
|---|---|---|---|
| `COMFORTABLE` | 0 | ≥ 4 GB | < 50% |
| `MODERATE` | 1 | ≥ 2 GB | 50–70% |
| `TIGHT` | 2 | ≥ 1 GB | 70–85% |
| `CRITICAL` | 3 | < 1 GB | > 85% |

Pressure = `max(static device level, dynamic heap level)`  
Heap monitoring ใช้ `performance.memory` (Chromium only) — poll ทุก 30 วินาที  
Device baseline ใช้ `navigator.deviceMemory` — check ครั้งเดียวตอน load

### Budget Table

| Budget Key | COMFORTABLE | MODERATE | TIGHT | CRITICAL |
|---|---|---|---|---|
| `POOL_CAP` (nodes/bucket) | 60 | 40 | 20 | 8 |
| `TMPL_CACHE_CAP` (entries) | 2,000 | 800 | 200 | 50 |
| `PRE_CACHE_CAP` (items) | 48 | 24 | 8 | 2 |
| `HEIGHT_CACHE_MAX` (entries) | 5,000 | 3,000 | 1,500 | 500 |
| `WORKER_PERSIST_N` (items) | 10,000 | 5,000 | 2,000 | 1,000 |
| `CHUNK_INIT_N` (items) | 50,000 | 30,000 | 15,000 | 5,000 |
| `BUFFER_PX` | 600 | 400 | 200 | 100 |
| `MOUNT_CAP_SCALE` | ×1.0 | ×1.0 | ×0.75 | ×0.5 |

### Response Strategy ต่อ Pressure Change

| จาก → ถึง | Action |
|---|---|
| ↑ MODERATE | ปรับ cap สำหรับ allocation ใหม่ — ไม่ trim ของเดิม |
| ↑ TIGHT | trim `_tmplCache` + `_preCache` + pool ทันที, ลด `_buffer` + `_MOUNT_CAP` |
| ↑ CRITICAL | ทุกอย่างใน TIGHT + ถ้า page hidden → `worker.clearData()` |
| ↓ ดีขึ้น | restore cap สำหรับ allocation ใหม่ — cache เติมเองตามธรรมชาติ |

### Debug

```js
URE.memoryStats()
// {
//   level: 1,
//   levelName: "MODERATE",
//   deviceMemGB: 4,
//   heapUsed: 45000000,
//   heapLimit: 512000000,
//   heapRatio: 0.088,
//   budgets: { POOL_CAP: 40, TMPL_CACHE_CAP: 800, ... },
//   listenerCount: 2
// }

handle.stats()
// {
//   vl: {
//     ...
//     caps: { tmplCap: 800, preCap: 24, buffer: 400, chunkInitN: 30000 },
//     pool: { cap: 40, buckets: { item: 12 } }
//   },
//   memory: { level: 1, levelName: "MODERATE", ... }
// }
```

---

## 🗺️ Integration Recipes

### Grid layout

```js
const handle = URE.mount({
  container : '#card-grid',
  data      : items,
  template  : (item, lang) => `
    <div class="card">
      <img data-src="${item.img}" width="160" height="120">
      <p>${item.name?.[lang] || item.name?.en}</p>
    </div>
  `,
  columns  : 2,
  gap      : 12,
  keyField : 'id',
});
```

### loadChunked — progressive loading (v1.6.0)

```js
await handle.loadChunked(allItems);             // chunk = 5,000 (default)
await handle.loadChunked(allItems, 1000);       // chunk = 1,000

async function* streamItems() {
  let page = 1;
  while (true) {
    const res  = await fetch(`/api/items?page=${page++}`);
    const data = await res.json();
    if (!data.length) break;
    yield data;
  }
}
await handle.loadChunked(streamItems());

// หลัง load ขนาดใหญ่ — บอก MemoryManager ให้ re-evaluate ทันที
URE.memoryCheckpoint();
```

### Height cache key (v1.5.0)

```js
URE.mount({ container: '#feed-emoji',  data, template, cacheKey: 'feed-emoji' });
URE.mount({ container: '#feed-symbol', data, template, cacheKey: 'feed-symbol' });
```

### SPA Cleanup

```js
window.addEventListener('routeChanged', () => URE.destroyAll());
```

---

## 🐛 Debug

```js
URE.debug()
// columns: container | items | visible | totalHeight | workerMode | memPressure | tmplCap | poolCap

handle.stats()
// {
//   vl: {
//     items: 1200, visible: 12, totalSize: 115200,
//     stable: 1180, unstable: 20,
//     preCached: 8, tmplCached: 340,
//     pendingSettled: 3, mountCap: 6,
//     isGrid: false, columns: 1, gap: 0,
//     typeAvgCount: 2,
//     cachedHeights: 980,
//     pool: { cap: 40, buckets: { item: 8 } },
//     caps: { tmplCap: 800, preCap: 18, buffer: 400, chunkInitN: 30000 }  ← v1.7.0
//   },
//   worker: { workerMode: true, dataLoaded: true },
//   cache:  { heightEntries: 980, cacheKey: 'app_id' },
//   memory: { level: 1, levelName: "MODERATE", heapRatio: 0.61, ... }     ← v1.7.0
// }
```

---

## 🏗️ Architecture

```
URE.mount()
  └── engine.js
       ├── memory.js         (MemoryManager — pressure detection + budget, v1.7.0)
       ├── virtual-list.js   (list + grid virtual scroll, setMemoryBudget v1.7.0)
       │    ├── pool.js      (getCap/setCap added v1.7.0)
       │    └── observer.js
       ├── diffing.js
       ├── state.js
       ├── worker.js
       ├── lazy-assets.js
       └── scheduler.js
```

---

## ⚙️ Performance Internals

### Virtual Scroll

- **Float64Array prefix sums** — O(log n) binary search
- **transform: translateY / translate(x,y)** — no layout trigger, GPU composite only
- **Two-tier mounting** — viewport items uncapped; buffer zone ≤ `_MOUNT_CAP` per frame
- **Type-average height tracking** *(v1.3.0)*
- **Deferred will-change lifecycle** *(v1.4.0)*
- **Inlined range calculations** *(v1.4.0)*
- **Bidirectional pre-render**
- **DOM pool** — node reuse ผ่าน innerHTML wipe
- **rAF gating**

### Adaptive Memory Management *(v1.7.0)*

- `MemoryManager` singleton — ตรวจ `performance.memory` ทุก 30 s (Chromium), fallback `navigator.deviceMemory` (all browsers)
- Pressure level = `max(staticDeviceBaseline, dynamicHeapRatio)`
- Mount-time: `poolCap` + `buffer` ถูก clamp ด้วย `Math.min(user, budget)` — low-memory device เริ่มต้น conservative ทันที
- Pressure rise → `vl.setMemoryBudget()` trim caches ทันที + `pool.setCap()` drain excess nodes
- CRITICAL + page hidden → `worker.clearData()` releases largest single allocation
- Pressure improve → caps สูงขึ้น, caches เติมเองตามธรรมชาติ (no oscillation)
- `URE.memoryCheckpoint()` — force re-evaluate หลัง load ขนาดใหญ่

### Height Cache *(v1.5.0)*

- `sessionStorage` keyed by item identity
- Cap 5,000 entries (comfortable) — ลดตาม pressure budget
- Auto-save: `pagehide`, `visibilitychange:hidden`, `destroy()`
- Auto-invalidate on orientation change

### Scroll Anchor Protocol *(v1.5.0)*

1. `_captureAnchor()` — บันทึก first item at-or-after viewport top
2. Rebuild offsets
3. `_restoreAnchor()` — `scrollBy(delta)` synchronous
4. Velocity gate: `vel > 1.5 px/ms` → skip, defer to scroll-idle

### Template Cache *(v1.6.0)*

- `Map<key, {html, lang, item}>`
- Cache hit: `item === cached.item && lang === cached.lang`
- Cap: 2,000 (comfortable) → ลดตาม budget; oldest evicted
- Trimmed immediately by `setMemoryBudget()` on pressure rise

### Worker Persistence *(v1.6.0)*

- Above `WORKER_PERSIST_N` (10k comfortable → 1k critical): `loadData()` once
- `filter()` + `paginate()` skip item transfer
- `sort()` still passes current view
- Cleared on CRITICAL + page hidden to reclaim memory

### Grid Layout *(v1.3.0+)*

- Row-based offset prefix sums
- Auto item width from container + gap
- ResizeObserver updates width on container resize

### Device Tier

| Tier | Cores | Memory | Buffer mount cap | Pre-render chunk |
|---|---|---|---|---|
| 0 (low-end)   | ≤ 2  | ≤ 1 GB | 4  | 8  |
| 1 (mid-range) | ≤ 4  | ≤ 2 GB | 8  | 16 |
| 2 (high-end)  | > 4  | > 2 GB | 16 | 32 |

> v1.7.0: `MOUNT_CAP_SCALE` จาก memory budget คูณลงบน tier base (min 4) — CRITICAL tier-2 = 16 × 0.5 = 8

---

## 📐 CSS Classes

| Class | ใช้โดย | ความหมาย |
|---|---|---|
| `[data-ure-container]` | engine.js | container ที่ URE ดูแล |
| `[data-ure-key]` | virtual-list.js | item index |
| `.ure-spacer` | virtual-list.js | total list height holder |
| `.ure-visible` | virtual-list.js | mounted item |
| `.ure-settled` | virtual-list.js | stable item |
| `.ure-placeholder` | virtual-list.js | pooled item placeholder |
| `img.ure-img-loading/loaded/error` | lazy-assets.js | lazy load states |
| `.ure-render-error` | engine.js | template error display |

---

## ⚠️ ข้อควรระวัง

**Template ต้อง pure** — ห้าม mutate state ใน template

**อย่าใส่ event listener ใน innerHTML** — ใช้ `onItemClick` แทน

**`keyField` / `itemKey` ต้อง unique** — key ซ้ำทำให้ diff ผิดพลาด และ height cache เก็บค่าผิด

**Grid mode + horizontal ใช้ร่วมกันไม่ได้** — `horizontal: true` force `columns = 1`

**`cacheKey` ต้อง unique ต่อ instance** — หน้าที่มีหลาย URE instance ต้องตั้ง `cacheKey` ทุกตัว

**Worker bridge lazy-init** — Worker ถูกสร้างครั้งแรกที่เรียก `filter()` / `sort()` / `paginate()`

**v1.7.0 — `performance.memory` เป็น non-standard** — มีใน Chromium เท่านั้น; Firefox/Safari ใช้ static device tier แทน สำหรับหน้าที่ load ข้อมูลขนาดใหญ่ควรเรียก `URE.memoryCheckpoint()` หลัง load เสร็จ

**v1.7.0 — CRITICAL + hidden clears worker data** — ถ้า page กลับมา active และต้องการ filter/paginate อีกครั้ง worker จะ re-load data อัตโนมัติจาก `setData()` / `loadChunked()` ครั้งถัดไป หากต้องการ filter ทันทีโดยไม่มี `setData()` ให้เรียก `handle.resetFilter()` ก่อน

---

## 📋 Changelog

### v1.7.0 — Adaptive Memory Management

**Root causes addressed:**
- Cache caps (template, pre-render, pool, height) คงที่ตาม comfortable level เสมอ — low-memory device ถูก force ใช้ same cap กับ high-end device
- ไม่มีการตรวจ heap usage แบบ dynamic — heap อาจ spike ได้โดยไม่มีการ trim
- Worker data ยังคงอยู่ใน memory แม้ page hidden + ระบบกำลัง critical
- Mount-time ไม่ได้ apply budget ทันที — device เริ่มต้นที่ comfortable แล้วค่อย trim ทีหลัง

**[NEW] `memory.js` — MemoryManager singleton**
- ตรวจ pressure 2 ทาง: `navigator.deviceMemory` (static, all browsers) + `performance.memory` (dynamic, Chromium)
- Pressure = `max(staticBaseline, dynamicHeap)` — heap spike บน capable device ก็ trigger ได้
- Polling ทุก 30 s + immediate re-evaluate เมื่อ `visibilitychange → hidden`
- Notifies all subscribers synchronously — engine react ในทันที
- `MemoryManager.on(fn)` → returns unsubscribe; engine เรียก unsubscribe ใน `destroy()`
- `URE.memoryStats()` + `URE.memoryCheckpoint()` exposed ใน public API

**[MOD] `config.js` — MEMORY section**
- `DEVICE_MEMORY_THRESHOLDS_GB` — breakpoints สำหรับ static tier
- `HEAP_USAGE_THRESHOLDS` — breakpoints สำหรับ dynamic heap ratio
- `BUDGETS` — table ของ caps ทั้ง 8 keys × 4 pressure levels

**[MOD] `virtual-list.js` — dynamic caps + `setMemoryBudget()`**
- `_tmplCap`, `_chunkInitN`, `_buffer`, `_MOUNT_CAP`, `_PRE_CAP` เปลี่ยนจาก `const` → `let` (per-instance)
- `setMemoryBudget(budget)` — trims caches ทันทีด้วย `_trimMap()`, updates pool via `pool.setCap()`
- `_trimMap(map, maxSize)` — evict oldest Map entries in O(n) using insertion-order guarantee

**[MOD] `pool.js` — `getCap()` / `setCap(newCap)`**
- `setCap()` drain excess nodes immediately — detached subtrees GC-eligible ทันที
- `cap` parameter เปลี่ยนเป็น `let _cap` (mutable)

**[MOD] `engine.js` — MemoryManager integration**
- Mount-time: `effectivePoolCap = Math.min(poolCap, budget.POOL_CAP)` — conservative start
- `_unsubMemory = MemoryManager.on(_onMemoryPressure)` — unsubscribed ใน `destroy()`
- `_onMemoryPressure(next)` → `vl.setMemoryBudget()` + trim `_heightCache` + conditional `worker.clearData()`
- `_maybeLoadWorkerData` ใช้ `MemoryManager.getBudget('WORKER_PERSIST_N')` แทน constant

**[MOD] `ure.js` — load order**
- เพิ่ม `memory.js` ต่อจาก `config.js` ก่อน `scheduler.js`
- `URE.debug()` เพิ่ม columns `memPressure`, `tmplCap`, `poolCap`

---

### v1.6.0 — Large-Dataset Complexity Control

**[FIX-D]** Template HTML Cache — skips renderFn for stable items  
**[FIX-E]** Chunked height-cache init — `requestIdleCallback` slices above 50k items  
**[FIX-F]** Worker Data Persistence — eliminates structured-clone cost on repeated filter/paginate  
**New:** `handle.loadChunked(source, chunkSize?)`

---

### v1.5.0 — Social-App Grade Scroll Quality

**[FIX-A]** Height Cache (sessionStorage per item key)  
**[FIX-B]** Scroll Anchor Protocol (`_captureAnchor` + `_restoreAnchor`)  
**[FIX-C]** Warm Start (synchronous scroll restore before first rAF)  
**[CSS]** `overflow-anchor: none` on container + spacer

---

### v1.4.0 — Jank Regression Fix

**[FIX-1]** Deferred will-change lifecycle  
**[FIX-2]** Inlined range calculations  
**[FIX-3]** Removed first-render cap boost

---

### v1.3.0 — Performance Deep-Dive + Grid Layout + API Expansion

Type-average height tracking, grid layout, overscan, itemKey, updateMany, scrollToKey, getVisibleRange, onScrollEnd, bidirectional pre-render.

---

### v1.2.0 — Fast-Scroll Rendering Fix

Two-tier mounting, partial fast-scroll correction, snap-correct on scroll-end.

---

### v1.1.0 — Horizontal Mode + Scroll-Guard

`horizontal` option, `_coOffPending` scroll-guard, partial offset rebuild.

---

### v1.0.0 — Initial Release

Virtual scroll, DOM pool, 2-pass diff, Web Worker bridge, lazy assets, device tier.