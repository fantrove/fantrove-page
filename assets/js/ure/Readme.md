# URE — Universal Render Engine v1.6.0

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
    ├── config.js             ← Constants + device tier + GRID + CACHE + ANCHOR defaults
    ├── scheduler.js
    ├── pool.js
    ├── observer.js
    ├── diffing.js            ← O(n+m) diff + optional itemKey fn
    ├── state.js
    ├── worker.js
    ├── lazy-assets.js
    ├── virtual-list.js       ← Core virtual scroll (list + grid) + anchor protocol + height cache
    └── engine.js             ← Orchestrator + public API + persistence lifecycle
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
| `buffer` | `number` | `600` | px ที่ pre-render ไว้นอก viewport |
| `overscan` | `number` | `0` | จำนวน items นอก viewport ที่จะ pre-render (override buffer px) |
| `columns` | `number` | `1` | Grid layout columns (>1 = grid mode) |
| `gap` | `number` | `0` | ระยะห่างระหว่าง item/row ใน px |
| `recycling` | `boolean` | `true` | เปิด DOM node pool |
| `diffing` | `boolean` | `true` | เปิด diff — re-render เฉพาะ item ที่เปลี่ยน |
| `keyField` | `string` | `'id'` | Field ที่ใช้เป็น identity ใน diff |
| `itemKey` | `(item) => string` | `null` | Function-based key extraction — override `keyField` |
| `lang` | `string` | `localStorage.selectedLang \|\| 'en'` | ภาษาเริ่มต้น |
| `poolCap` | `number` | `60` | จำนวน node สูงสุดใน pool |
| `horizontal` | `boolean` | `false` | Horizontal scroll mode |
| `cacheKey` | `string` | `container.id + '_' + keyField` | **v1.5.0** Key สำหรับ sessionStorage — ตั้งเองเมื่อ container ไม่มี id หรือมีหลาย instance ในหน้าเดียวกัน |
| `onVisible` | `(item, el) => void` | - | Callback เมื่อ item เข้า viewport |
| `onHidden` | `(item) => void` | - | Callback เมื่อ item ออก viewport |
| `onUpdate` | `({added, removed, changed}) => void` | - | หลัง data update |
| `onItemClick` | `(event, item) => void` | - | Delegated click |
| `onScrollEnd` | `() => void` | - | Callback เมื่อ scroll หยุด |

---

### `EngineHandle` methods

```js
// Data
handle.setData(newArray)
handle.append(items)
handle.prepend(items)
handle.removeByKey(keyValue)
handle.updateMany(items)          // batch update by key
await handle.loadChunked(source, chunkSize?)  // v1.6.0 progressive loading

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
handle.stats()                    // เพิ่ม cache.heightEntries ใน v1.5.0
handle.destroy()
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

## 🗺️ Integration Recipes

### Grid layout (card display)

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

> Grid mode จะ set `width` ของแต่ละ item ให้อัตโนมัติ ไม่ต้องกำหนดใน CSS

### Function-based key

```js
const handle = URE.mount({
  container : '#app',
  data      : items,
  template  : renderFn,
  itemKey   : (item) => `${item.type}-${item.id}`,
});
```

### Height cache key (v1.5.0)

ตั้ง `cacheKey` เมื่อหน้าเดียวมีหลาย URE instance หรือ container ไม่มี `id`:

```js
// instance A
URE.mount({ container: '#feed-emoji',  data, template, cacheKey: 'feed-emoji' });

// instance B
URE.mount({ container: '#feed-symbol', data, template, cacheKey: 'feed-symbol' });
```

### Overscan (item-count buffer)

```js
const handle = URE.mount({
  container : '#app',
  data      : items,
  template  : renderFn,
  overscan  : 8,
});
```

### updateMany (batch partial update)

```js
handle.updateMany([
  { id: 'a1', name: { en: 'Updated' } },
  { id: 'b3', count: 42 },
]);
```

### loadChunked — progressive loading (v1.6.0)

ใช้เมื่อมีข้อมูลจำนวนมากและต้องการให้หน้าเว็บ responsive ระหว่าง load:

```js
// Plain array — แบ่งเป็น chunk อัตโนมัติ, yield ระหว่าง chunk
await handle.loadChunked(allItems);             // chunk = 5,000 (default)
await handle.loadChunked(allItems, 1000);       // chunk = 1,000

// Async generator — รองรับ streaming จาก API
async function* streamItems() {
  let page = 1;
  while (true) {
    const res = await fetch(`/api/items?page=${page++}`);
    const data = await res.json();
    if (!data.length) break;
    yield data;
  }
}
await handle.loadChunked(streamItems());
```

> `worker.loadData()` จะถูกเรียกอัตโนมัติเมื่อ load เสร็จ ถ้า `n ≥ WORKER_PERSIST_N`

### scrollToKey

```js
handle.scrollToKey('emoji-grinning', 'smooth');
```

### onScrollEnd

```js
const handle = URE.mount({
  container  : '#app',
  data       : items,
  template   : renderFn,
  onScrollEnd: () => {
    const range = handle.getVisibleRange();
    // lazy-load next page, analytics, etc.
  },
});
```

---

## 🔄 SPA Cleanup

```js
window.addEventListener('routeChanged', () => URE.destroyAll());
```

> `destroyAll()` เรียก `destroy()` บนทุก instance — ซึ่งจะ persist height cache และ scroll position ก่อน teardown โดยอัตโนมัติ

---

## 🐛 Debug

```js
URE.debug()

handle.stats()
// {
//   items: 1200, visible: 12, totalSize: 115200,
//   stable: 1180, unstable: 20,
//   preCached: 8,
//   tmplCached: 340,             ← v1.6.0: entries ใน template HTML cache
//   pendingSettled: 3,
//   mountCap: 8,
//   isGrid: false, columns: 1, gap: 0,
//   typeAvgCount: 2,
//   cachedHeights: 980,          ← v1.5.0: entries ใน height cache
//   pool: { cap: 60, buckets: { item: 8 } },
//   worker: { workerMode: true, dataLoaded: true }  ← v1.6.0
// }
```

---

## 🏗️ Architecture

```
URE.mount()
  └── engine.js
       ├── virtual-list.js  (list + grid virtual scroll, anchor protocol, height cache)
       │    ├── pool.js
       │    └── observer.js
       ├── diffing.js        (2-pass O(n+m) diff, keyFn support)
       ├── state.js
       ├── worker.js
       ├── lazy-assets.js
       └── scheduler.js
```

---

## ⚙️ Performance Internals

### Virtual Scroll

- **Float64Array prefix sums** — O(log n) binary search สำหรับ list; row-based สำหรับ grid
- **transform: translateY / translate(x,y)** — no layout trigger, GPU composite only
- **Two-tier mounting** — viewport items uncapped; buffer zone ≤ `_MOUNT_CAP` per frame
- **Type-average height tracking** *(v1.3.0)* — running average per item type
- **Deferred will-change lifecycle** *(v1.4.0)* — `.ure-settled` batch-apply ใน rAF หลัง scroll หยุด
- **Inlined range calculations** *(v1.4.0)* — zero GC pressure ใน hot path
- **Snap-correct on scroll-end** — flush pending corrections ทันทีที่ scroll idle
- **Bidirectional pre-render** — pre-cache ทั้ง 2 ทิศตาม velocity direction
- **DOM pool** — node reuse ผ่าน innerHTML wipe
- **rAF gating** — viewport uncapped; buffer ≤ `_MOUNT_CAP` per frame

### Height Cache *(v1.5.0)*

- Measured heights บันทึกลง `sessionStorage` keyed by item identity (`keyField` / `itemKey`)
- `_estimatedH()` ตรวจ cache ก่อน → remount ได้ real heights ทันที → ไม่มี correction storm
- บันทึกอัตโนมัติเมื่อ: `pagehide`, `visibilitychange:hidden`, `destroy()`
- Invalidate อัตโนมัติเมื่อ orientation เปลี่ยน (width เปลี่ยน → heights เก่าใช้ไม่ได้)
- Cap: 5,000 entries per instance; versioned (stale format discarded automatically)
- Items ที่ไม่มี stable key (`keyField`/`itemKey`) จะไม่ถูก cache

### Scroll Anchor Protocol *(v1.5.0)*

ทุก height correction ใช้ pattern เดียวกัน (list + grid):
1. **`_captureAnchor()`** — บันทึก first item at-or-after viewport top + offset ปัจจุบัน
2. Rebuild offsets จาก first dirty index
3. **`_restoreAnchor(anchor)`** — `delta = newTop - prevTop` → `scrollBy(0, delta)` synchronous

Velocity gate: `vel > 1.5 px/ms` → skip scrollBy, defer ไป scroll-idle snap-correct (ป้องกัน interrupt iOS momentum scroll)

### Grid Layout *(v1.3.0+)*

- Row-based offset prefix sums (`_rHgt[]`, `_rOff[]`)
- Auto item width = `(containerWidth - gap × (columns−1)) / columns`
- ResizeObserver อัพเดท item width อัตโนมัติเมื่อ container resize

### Template Cache *(v1.6.0)*

- Rendered HTML per item key cached in `Map<key, {html, lang, item}>`
- Cache hit condition: `item === cached.item && lang === cached.lang` (strict reference equality)
- Eviction: oldest insertion-order entry at `TEMPLATE_CACHE_CAP = 2,000`
- Miss: any data mutation (`updateItem`, `updateMany`) or lang change → fresh render

### Worker Persistence *(v1.6.0)*

- Above `WORKER_PERSIST_N = 10,000` items: `loadData(items)` transfers the array to the worker once
- `filter()` and `paginate()` send only predicates / page params — zero item serialization on repeated calls
- `sort()` still sends the current view (could be a filtered subset — worker doesn't track view state)
- `loadChunked()` reloads worker data automatically after progressive load completes

### Diffing

- 2-pass O(n+m), shallow equality
- `itemKey` function support
- Full-replace bail-out เมื่อ > 50,000 items

### Device Tier

| Tier | Cores | Memory | Buffer mount cap | Pre-render chunk |
|---|---|---|---|---|
| 0 (low-end)   | ≤ 2  | ≤ 1 GB | 4  | 8  |
| 1 (mid-range) | ≤ 4  | ≤ 2 GB | 8  | 16 |
| 2 (high-end)  | > 4  | > 2 GB | 16 | 32 |

> Viewport items ไม่มี cap ในทุก tier

---

## 📐 CSS Classes

| Class | ใช้โดย | ความหมาย |
|---|---|---|
| `[data-ure-container]` | engine.js | container ที่ URE ดูแล |
| `[data-ure-key]` | virtual-list.js | item index |
| `.ure-spacer` | virtual-list.js | total list height holder |
| `.ure-visible` | virtual-list.js | mounted item |
| `.ure-settled` | virtual-list.js | stable item — CSS removes `will-change` (applied post-scroll) |
| `.ure-placeholder` | virtual-list.js | pooled item placeholder |
| `img.ure-img-loading/loaded/error` | lazy-assets.js | lazy load states |
| `.ure-render-error` | engine.js | template error display |

> **ต้องมีใน `ure.css`:**
> ```css
> .ure-visible.ure-settled { will-change: auto; }
> [data-ure-container] { overflow-anchor: none; }  /* v1.5.0 — required */
> ```

---

## ⚠️ ข้อควรระวัง

**Template ต้อง pure** — ห้าม mutate state ใน template

**อย่าใส่ event listener ใน innerHTML** — ใช้ `onItemClick` แทน

**`keyField` / `itemKey` ต้อง unique** — key ซ้ำทำให้ diff ผิดพลาด และ height cache เก็บค่าผิด

**Grid mode + horizontal ใช้ร่วมกันไม่ได้** — ถ้า `horizontal: true` ค่า `columns` จะถูก force = 1

**Grid mode: ไม่ต้องกำหนด width ใน CSS ของ item** — engine set `style.width` อัตโนมัติ

**`cacheKey` ต้อง unique ต่อ instance** — หน้าที่มีหลาย URE instance ต้องตั้ง `cacheKey` ทุกตัว ไม่เช่นนั้น cache จะ overwrite กัน

**Height cache ผูกกับ item key เท่านั้น** — items ที่ไม่มี `keyField`/`itemKey` (fallback เป็น `__idx_N`) จะไม่ถูก cache

**Worker bridge lazy-init** — Worker ถูกสร้างครั้งแรกที่เรียก `filter()` / `sort()` / `paginate()`

---

## 📋 Changelog

### v1.6.0 — Large-Dataset Complexity Control

**Root causes addressed (3 fixes + 1 constant):**

**[FIX-D] Template HTML Cache** (`virtual-list.js`)
- `_renderWithCache()` wraps `renderFn` — caches rendered HTML string per item key + lang
- Cache hit: same item object reference + same lang → `renderFn` never called
- Recycled nodes scrolling back into view skip template evaluation entirely
- Eviction: oldest entry dropped at `LARGE_DATASET.TEMPLATE_CACHE_CAP = 2,000` entries
- Invalidated automatically on `setLang()` (full clear) and `updateItem()` (single key)
- `stats()` now reports `tmplCached` count

**[FIX-E] Chunked Height-Cache Init** (`virtual-list.js`)
- `setItems()` always uses `Float32Array.fill(DEFAULT_ITEM_HEIGHT)` for initial alloc (bulk typed-array op, near-instant even at 1M)
- `n ≤ 50k`: applies height cache synchronously — O(n) Map.get loop, ~5ms
- `n > 50k`: renders immediately with defaults, then `_applyHeightCacheChunked()` refines in `requestIdleCallback` slices of 5,000 items — main thread never blocked
- Accumulated corrections applied in one batch when chunking completes

**[FIX-F] Worker Data Persistence** (`worker.js` + `engine.js`)
- `n ≥ 10k`: engine calls `worker.loadData(items)` once after mount / setData
- Worker stores items internally; `filter()` and `paginate()` omit items from the message payload → structured-clone cost eliminated for all subsequent calls
- `sort()` still passes items (operates on current filtered view, not original data)
- `worker.stats()` reports `dataLoaded` flag
- Sync fallback unaffected — still receives items per-call

**New handle method:** `handle.loadChunked(source, chunkSize?)` — progressive loading for large arrays or async iterables; yields to browser between chunks via `requestIdleCallback`

**New constants** in `config.js` `LARGE_DATASET`:
```js
WORKER_PERSIST_N   : 10_000  // auto-load worker above this count
CHUNK_INIT_N       : 50_000  // chunked height init above this count
INIT_CHUNK_SIZE    : 5_000   // items per idle chunk
TEMPLATE_CACHE_CAP : 2_000   // template HTML cache cap
```

---

### v1.5.0 — Social-App Grade Scroll Quality

**Root causes addressed (3 fixes):**

**[FIX-A] Height Cache** (`engine.js` + `virtual-list.js`)
- Measured item heights บันทึกลง `sessionStorage` per item key
- `_estimatedH()` ตรวจ cache ก่อน type-average และ default — remount ครั้งถัดไปได้ real heights ทันที
- Eliminates correction storm เมื่อ scroll ขึ้นผ่าน items ที่เคยเห็นแล้วในรอบก่อน
- Auto-save: `pagehide`, `visibilitychange:hidden`, `destroy()` — Auto-invalidate: orientation change

**[FIX-B] Scroll Anchor Protocol** (`virtual-list.js`)
- `_captureAnchor()` + `_restoreAnchor()` แทน `ref/oldOff/adj` pattern เดิม
- ทำงานระหว่าง scroll (ไม่ต้อง idle) เมื่อ vel ≤ 1.5 px/ms
- vel > 1.5 px/ms → defer to scroll-idle snap-correct → ป้องกัน interrupt iOS momentum
- Removed: `else { setTimeout(_applyCorrection, ...) }` re-queue branch

**[FIX-C] Warm Start** (`virtual-list.js`)
- `mount()` calls `window.scrollTo(savedPos, 'instant')` synchronously ก่อน first rAF
- First `_render()` frame เห็น scroll position ที่ถูกต้อง → render items ถูกกลุ่มทันที

**[CSS] `overflow-anchor: none`** (`ure.css`)
- เพิ่มบน `[data-ure-container]` และ `.ure-spacer`
- Browser auto-anchor ขัด URE manual anchor → double-correction jump — ปิดทันที

**New mount option:** `cacheKey: string` — stable key สำหรับ sessionStorage

---

### v1.4.0 — Jank Regression Fix

**[FIX-1]** Deferred will-change lifecycle (`_pendingSettled`) — zero compositor changes during scroll  
**[FIX-2]** Inlined range calculations — no object allocation in render loop  
**[FIX-3]** Removed first-render cap boost — uniform `_MOUNT_CAP` all frames

---

### v1.3.0 — Performance Deep-Dive + Grid Layout + API Expansion
Type-average height tracking, grid layout, overscan, itemKey function, updateMany, scrollToKey, getVisibleRange, onScrollEnd, bidirectional pre-render.

### v1.2.0 — Fast-Scroll Rendering Fix
Two-tier mounting, partial fast-scroll correction, snap-correct on scroll-end.

### v1.1.0 — Horizontal Mode + Scroll-Guard
`horizontal` option, `_coOffPending` scroll-guard, partial offset rebuild.

### v1.0.0 — Initial Release
Virtual scroll, DOM pool, 2-pass diff, Web Worker bridge, lazy assets, device tier.