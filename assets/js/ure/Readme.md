# URE — Universal Render Engine v1.1.0

**Zero-config virtual scroll + lazy loading + diff-aware updates for Fantrove.**  
ใช้กับทุกหน้า (home, discover, search, setting) โดยไม่ต้อง optimize ซ้ำทุกครั้ง

---

## 📁 โครงสร้างไฟล์

```
assets/js/ure/
├── ure.js                    ← Entry point (โหลดไฟล์เดียวนี้ในทุกหน้า)
├── ure.css                   ← Structural styles (auto-injected)
├── ure-examples.js           ← Reference code — ห้ามโหลดใน production
└── ure-modules/
    ├── types.js              ← JSDoc typedefs (ไม่มี runtime code)
    ├── config.js             ← Constants + device tier detection
    ├── scheduler.js          ← rAF + rIC orchestration (+ MessageChannel yield)
    ├── pool.js               ← DOM node recycling pool (per-instance, isolated)
    ├── observer.js           ← IO / RO / MO factory (createIO / createRO / createMO)
    ├── diffing.js            ← O(n+m) 2-pass data diff engine
    ├── state.js              ← Reactive state store (key-level subscriptions)
    ├── worker.js             ← Web Worker bridge (filter/sort/paginate) + sync fallback
    ├── lazy-assets.js        ← Lazy img/iframe/bg loading + CLS prevention
    ├── virtual-list.js       ← Core virtual scroll (Float64Array offsets + horizontal mode)
    └── engine.js             ← Main orchestrator — wires everything together
```

**Module load order** (dependency chain ใน `ure.js`):  
`types → config → scheduler → pool → observer → diffing → state → worker → lazy-assets → virtual-list → engine`

---

## ⚡ Quick Start

### 1. ใส่ script tag ใน HTML (ครั้งเดียวต่อหน้า)

```html
<script src="/assets/js/ure/ure.js"></script>
```

CSS (`ure.css`) ถูก inject อัตโนมัติ — ไม่ต้องใส่ `<link>` เอง

### 2. รอ ready event แล้ว Mount

```js
window.addEventListener('ure:ready', () => {
  const list = URE.mount({
    container : '#app',
    data      : myJsonArray,
    template  : (item, lang) => `
      <div class="card">${item.name?.[lang] || item.name?.en}</div>
    `,
  });
});
```

หรือถ้ามั่นใจว่าโหลดหลัง `DOMContentLoaded` แล้ว ก็ `URE.mount(...)` ตรงๆ ได้เลย

---

## 📖 Full API

### `URE.mount(options)` → `EngineHandle`

| Option | Type | Default | คำอธิบาย |
|---|---|---|---|
| `container` | `Element\|string` | **required** | DOM element หรือ CSS selector |
| `data` | `any[]` | `[]` | Array ของ data items |
| `template` | `(item, lang) => string` | **required** | HTML string สำหรับแต่ละ item |
| `buffer` | `number` | `600` | px ที่ pre-render ไว้นอก viewport |
| `recycling` | `boolean` | `true` | เปิด DOM node pool |
| `diffing` | `boolean` | `true` | เปิด diff เพื่อ re-render เฉพาะ item ที่เปลี่ยน |
| `keyField` | `string` | `'id'` | Field ที่ใช้เป็น identity ใน diff |
| `lang` | `string` | `localStorage.selectedLang \|\| 'en'` | ภาษาเริ่มต้น |
| `poolCap` | `number` | `60` | จำนวน node สูงสุดใน pool |
| `estimatedItemHeight` | `number` | `96` | px ประมาณความสูง item ก่อนวัดจริง |
| `horizontal` | `boolean` | `false` | เปิด horizontal scroll mode (axis-aware ทั้งระบบ) |
| `onVisible` | `(item, el) => void` | - | Callback เมื่อ item เข้า viewport |
| `onHidden` | `(item) => void` | - | Callback เมื่อ item ออกจาก viewport |
| `onUpdate` | `({added, removed, changed}) => void` | - | หลัง data update |
| `onItemClick` | `(event, item) => void` | - | Delegated click บน item |

> **หมายเหตุ:** ถ้า mount ทับ container เดิมที่มี instance อยู่แล้ว — engine จะ `destroy()` instance เก่าก่อนอัตโนมัติ

---

### `EngineHandle` methods

```js
// ── Data ──────────────────────────────────────────────────────────────────
handle.setData(newArray)            // Replace all data (diff-aware)
handle.append(items)                // เพิ่มต่อท้าย
handle.prepend(items)               // เพิ่มหัวรายการ
handle.removeByKey(keyValue)        // ลบ item ด้วย key

// ── Async Worker operations ───────────────────────────────────────────────
await handle.filter(predicates)     // filter ใน Web Worker (fallback: sync)
await handle.sort(field, dir)       // sort ใน Web Worker (fallback: sync)
handle.resetFilter()                // คืน data เดิม (ก่อน filter)
await handle.paginate(page, size)   // ดึงหน้าที่ต้องการ → returns PaginateResult

// ── UI ────────────────────────────────────────────────────────────────────
handle.setLang(lang)                // เปลี่ยนภาษา + re-render visible items
handle.scrollTo(index, behavior)    // scroll ไปที่ item index
handle.refresh()                    // force recalculate geometry + re-render

// ── State subscription ────────────────────────────────────────────────────
handle.on('lang', fn)               // ฟัง state key ที่เจาะจง → returns unsubscribe fn
handle.onAny(fn)                    // ฟังทุก state change → returns unsubscribe fn

// ── Read-only properties ──────────────────────────────────────────────────
handle.itemCount                    // จำนวน item ปัจจุบัน (getter)
handle.lang                         // ภาษาปัจจุบัน (getter)
handle.loading                      // สถานะ loading (getter)

// ── Debug ─────────────────────────────────────────────────────────────────
handle.stats()                      // { vl, worker, store }
handle.destroy()                    // teardown ทั้งหมด
```

---

### Global URE API

```js
URE.mount(opts)              // → EngineHandle
URE.getInstance(container)  // → EngineHandle | null (หา instance จาก container)
URE.destroyAll()             // ทำลายทุก instance (ใช้ก่อน SPA route change)
URE.modules()                // → UREModules (raw internal access สำหรับ advanced use)
URE.config()                 // → CONFIG object (constants ทั้งหมด)
URE.debug()                  // log stats table ทุก instance ใน console
```

---

### Filter Predicates

```js
// Single predicate
await handle.filter({ field: 'type', op: 'eq', value: 'emoji' })

// AND logic (array of predicates — ทุกอันต้องผ่านพร้อมกัน)
await handle.filter([
  { field: 'type',    op: 'eq',       value: 'emoji'  },
  { field: 'name.en', op: 'includes', value: 'smile'  },
])

// Available operators
// eq | neq | gt | lt | gte | lte | includes | startsWith
```

> Filter ทำงานกับ `_originalData` เสมอ → `resetFilter()` คืนได้ตลอด  
> Sort ทำงานกับ `_currentItems` (หลัง filter)

---

### PaginateResult

```js
const result = await handle.paginate(2, 20);
// result = {
//   items      : [...],   // items ในหน้านั้น
//   total      : 500,     // จำนวน items ทั้งหมด
//   totalPages : 25,
//   page       : 2,
//   pageSize   : 20,
// }
```

---

## 🌐 Language Change Integration

URE ฟัง `window` event ชื่อ `'languageChange'` อัตโนมัติ:

```js
window.dispatchEvent(new CustomEvent('languageChange', {
  detail: { language: 'th' }
}));
```

เมื่อ event ยิง engine จะ `setLang()` และ re-render visible items ทันที  
ไม่จำเป็นต้องเรียก `handle.setLang()` เองถ้าใช้ global event นี้

---

## 🗺️ Integration ต่อหน้า

### home.js (carousel)

```js
const handle = URE.mount({
  container  : carouselTrackElement,
  data       : category.data,
  template   : (item, lang) => buildItemCardHTML(item, lang),
  buffer     : 400,
  recycling  : true,
  keyField   : 'api',
  onItemClick: (e, item) => copyEmoji(item),
});
```

### discover page (nav-core content area)

```js
const handle = URE.mount({
  container : document.getElementById('content-loading'),
  data      : resolvedItems,
  template  : (item, lang) => renderButtonHTML(item, lang),
  buffer    : 600,
  onItemClick: (e, item) => unifiedCopyToClipboard({ text: item.text, api: item.api }),
});
```

### search results (rendering.js)

```js
// Mount ครั้งแรก
const handle = URE.mount({
  container: document.getElementById('searchResults'),
  data     : results,
  template : (item, lang) => renderResultHTML(item, lang),
  buffer   : 700,
  keyField : 'api',
});

// ค้นหาซ้ำ — diff engine update เฉพาะที่เปลี่ยน
handle.setData(newResults);
```

### Horizontal carousel

```js
const handle = URE.mount({
  container : trackEl,
  data      : items,
  template  : (item, lang) => `<div class="slide">${item.text}</div>`,
  horizontal: true,   // ← เปิด horizontal mode
  buffer    : 300,
});
```

---

## 🔄 SPA Route Cleanup

```js
window.addEventListener('routeChanged', () => URE.destroyAll());
```

---

## 🐛 Debug

```js
// ใน browser console
URE.debug()           // stats table ของทุก instance

// จาก handle
handle.stats()
// {
//   vl: {
//     items: 1200,
//     visible: 12,
//     totalSize: 115200,
//     stable: 1180,       // items ที่ RO วัด height แล้ว ไม่ต้อง observe ต่อ
//     unstable: 20,
//     mountCap: 8,        // max DOM mounts ต่อ rAF frame (device tier)
//     horizontal: false,
//     pool: { cap: 60, buckets: { item: 8 } }
//   },
//   worker: { workerMode: true },
//   store: { items: [...], lang: 'en', loading: false, error: null }
// }
```

---

## 🏗️ Architecture

```
URE.mount()
  └── engine.js  (orchestrator)
       ├── virtual-list.js  (virtual scroll — Float64Array offsets, RO measures, horizontal mode)
       │    ├── pool.js      (node recycling, WeakMap data binding)
       │    └── observer.js  (IO/RO/MO factories)
       ├── diffing.js        (2-pass O(n+m) diff, shallow equality)
       ├── state.js          (reactive store, key-level subscriptions)
       ├── worker.js         (Web Worker bridge + sync fallback)
       ├── lazy-assets.js    (IO-based lazy img/iframe/bg, aspect-ratio CLS fix)
       └── scheduler.js      (rAF visual queue + rIC background queue + MessageChannel yield)
```

---

## ⚙️ Performance Internals

### Virtual Scroll

- **Float64Array prefix sums** — binary search หา start/end index ใน O(log n)
- **transform:translateY / translateX** — no layout trigger, GPU composite only
- **ResizeObserver** วัด height จริง async; เมื่อ item stable (`_measured[i] = 1`) จะ `unobserve()` ทันที ลด RO churn
- **DOM pool** — ไม่ `createElement` ทุกครั้ง; node เดิมถูก wipe แล้ว reuse ด้วย new innerHTML
- **Partial offset rebuild** (`_rebuildFrom(i)`) — O(n−i) แทน O(n) เมื่อ height เปลี่ยนแค่กลางๆ list
- **Scroll-anchor correction** — ปรับ scrollTop อัตโนมัติหลัง height re-measure ขณะ scroll idle เท่านั้น (ไม่ fight กับ active scroll)
- **rAF gating + mount cap** — DOM mount ไม่เกิน `_MOUNT_CAP` nodes ต่อ frame (4/8/16 ตาม device tier); ส่วนที่เหลือ defer ไป frame ถัดไป
- **Velocity buffer** — extend buffer ในทิศที่กำลัง scroll, shrink buffer ด้านหลัง เพื่อลด DOM node ที่ active

### Diffing

- **2-pass O(n+m)** — pass 1 index old items ด้วย Map; pass 2 walk new items เทียบ → ไม่มี nested loop
- **Shallow equality** — compare own enumerable keys เท่านั้น ไม่ deep clone
- **Full-replace bail-out** — ถ้า `oldItems.length + newItems.length > 50,000` ข้าม diff ใช้ `setItems` แทน (เร็วกว่า)
- **Key fallback** — item ที่ไม่มี `keyField` จะใช้ `__idx_{i}` เป็น key แทน

### Scheduler

- **rAF queue** — visual tasks รัน 1 ครั้งต่อ frame; re-schedule ต่อ frame ถ้ายังมีงานเหลือ
- **rIC queue** — background tasks รัน deadline-aware; เมื่อหมด idle slice จะ yield แล้วรอ idle ถัดไป
- **MessageChannel yield** — เร็วกว่า `setTimeout(0)`; ใช้ให้ compositor ได้ frame slot หลัง paint

### Device Tier

config.js detect tier ตอน load ครั้งเดียว:

| Tier | Cores | Memory | Render chunk | Preload chunk | Mount cap |
|---|---|---|---|---|---|
| 0 (low-end)   | ≤ 2  | ≤ 1 GB | 4  | 8  | 4  |
| 1 (mid-range) | ≤ 4  | ≤ 2 GB | 8  | 16 | 8  |
| 2 (high-end)  | > 4  | > 2 GB | 16 | 32 | 16 |

---

## 📐 CSS Classes (ure.css)

| Class / Attribute | ใช้โดย | ความหมาย |
|---|---|---|
| `[data-ure-container]` | engine.js | mark container ที่ URE ดูแล |
| `[data-ure-key]` | virtual-list.js | index ของ item บน node |
| `.ure-spacer` | virtual-list.js | div ที่ set height = total virtual list height |
| `.ure-visible` | virtual-list.js | item node ที่ mount อยู่ใน viewport |
| `.ure-placeholder` | virtual-list.js | height-only div (item ที่ถูก pool) |
| `.ure-settled` | (future) | toggled เมื่อ item stable — removes `will-change` |
| `.ure-group` | grouped mode | `content-visibility:auto` สำหรับ group containers |
| `img.ure-img-loading` | lazy-assets.js | shimmer animation ขณะโหลด |
| `img.ure-img-loaded` | lazy-assets.js | โหลดสำเร็จ — removes animation |
| `img.ure-img-error` | lazy-assets.js | โหลดไม่สำเร็จ — red border |
| `.ure-render-error` | engine.js | แสดงเมื่อ template() throw error |

---

## ⚠️ ข้อควรระวัง

**Template function ต้อง pure (ไม่มี side effects)**  
URE เรียก template ซ้ำเมื่อ re-render, recycle หรือ language change — อย่า mutate state ใน template

**อย่าใส่ event listener ใน template innerHTML**  
ใช้ `onItemClick` option แทน เพราะ node ถูก recycle และ innerHTML ถูก wipe ทุกรอบ

**`keyField` ต้อง unique ต่อ item**  
ถ้า key ซ้ำ diffing จะทำงานผิดพลาด; ถ้า item ไม่มี field นั้น URE fallback เป็น index (ไม่ diff-stable)

**Horizontal mode ต้องการให้ container มี height กำหนดไว้**  
`.ure-spacer` จะ set `width` แทน `height` ใน horizontal mode; container ต้อง scroll ใน axis X

**Worker bridge lazy-init**  
Web Worker ถูกสร้างครั้งแรกที่เรียก `filter()` / `sort()` / `paginate()` — ไม่ใช่ตอน mount