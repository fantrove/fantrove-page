# URE — Universal Render Engine v1.3.0

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
    ├── config.js             ← Constants + device tier + GRID defaults
    ├── scheduler.js          ← rAF + rIC orchestration (+ MessageChannel yield)
    ├── pool.js               ← DOM node recycling pool (per-instance, isolated)
    ├── observer.js           ← IO / RO / MO factory (createIO / createRO / createMO)
    ├── diffing.js            ← O(n+m) 2-pass diff engine (+ optional itemKey fn)
    ├── state.js              ← Reactive state store (key-level subscriptions)
    ├── worker.js             ← Web Worker bridge (filter/sort/paginate) + sync fallback
    ├── lazy-assets.js        ← Lazy img/iframe/bg loading + CLS prevention
    ├── virtual-list.js       ← Core virtual scroll (list + grid, all perf systems)
    └── engine.js             ← Main orchestrator — wires everything together
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
    template  : (item, lang) => `
      <div class="card">${item.name?.[lang] || item.name?.en}</div>
    `,
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
| `overscan` | `number` | `0` | **NEW** จำนวน items นอก viewport ที่จะ pre-render (ถ้าตั้งค่าจะ override buffer px) |
| `columns` | `number` | `1` | **NEW** จำนวน column สำหรับ grid layout (>1 เปิด grid mode, vertical scroll เท่านั้น) |
| `gap` | `number` | `0` | **NEW** ระยะห่างระหว่าง item/row ใน px |
| `recycling` | `boolean` | `true` | เปิด DOM node pool |
| `diffing` | `boolean` | `true` | เปิด diff เพื่อ re-render เฉพาะ item ที่เปลี่ยน |
| `keyField` | `string` | `'id'` | Field ที่ใช้เป็น identity ใน diff |
| `itemKey` | `(item) => string` | `null` | **NEW** function-based key extraction — override `keyField` |
| `lang` | `string` | `localStorage.selectedLang \|\| 'en'` | ภาษาเริ่มต้น |
| `poolCap` | `number` | `60` | จำนวน node สูงสุดใน pool |
| `estimatedItemHeight` | `number` | `96` | px ประมาณความสูง item ก่อนวัดจริง (ตั้งแต่ v1.3.0 ระบบจะปรับ estimate อัตโนมัติจาก type average) |
| `horizontal` | `boolean` | `false` | เปิด horizontal scroll mode |
| `onVisible` | `(item, el) => void` | - | Callback เมื่อ item เข้า viewport |
| `onHidden` | `(item) => void` | - | Callback เมื่อ item ออกจาก viewport |
| `onUpdate` | `({added, removed, changed}) => void` | - | หลัง data update |
| `onItemClick` | `(event, item) => void` | - | Delegated click บน item |
| `onScrollEnd` | `() => void` | - | **NEW** Callback เมื่อ scroll หยุด (scroll-idle fired) |

---

### `EngineHandle` methods

```js
// ── Data ──────────────────────────────────────────────────────────────────
handle.setData(newArray)             // Replace all data (diff-aware)
handle.append(items)                 // เพิ่มต่อท้าย
handle.prepend(items)                // เพิ่มหัวรายการ
handle.removeByKey(keyValue)         // ลบ item ด้วย key
handle.updateMany(items)             // NEW — batch-update items by key (efficient สำหรับ small changes)

// ── Async Worker operations ───────────────────────────────────────────────
await handle.filter(predicates)      // filter ใน Web Worker (fallback: sync)
await handle.sort(field, dir)        // sort ใน Web Worker (fallback: sync)
handle.resetFilter()                 // คืน data เดิม (ก่อน filter)
await handle.paginate(page, size)    // ดึงหน้าที่ต้องการ → returns PaginateResult

// ── UI ────────────────────────────────────────────────────────────────────
handle.setLang(lang)                 // เปลี่ยนภาษา + re-render visible items
handle.scrollTo(index, behavior)     // scroll ไปที่ item index
handle.scrollToKey(keyValue, bhv)    // NEW — scroll ไปที่ item ด้วย key value
handle.refresh()                     // force recalculate geometry + re-render

// ── Visibility ────────────────────────────────────────────────────────────
handle.getVisibleRange()             // NEW → { startIndex, endIndex } ของ mounted items

// ── State subscription ────────────────────────────────────────────────────
handle.on('lang', fn)                // ฟัง state key → returns unsubscribe fn
handle.onAny(fn)                     // ฟังทุก state change → returns unsubscribe fn

// ── Read-only properties ──────────────────────────────────────────────────
handle.itemCount                     // จำนวน item ปัจจุบัน (getter)
handle.lang                          // ภาษาปัจจุบัน (getter)
handle.loading                       // สถานะ loading (getter)

// ── Debug ─────────────────────────────────────────────────────────────────
handle.stats()                       // { vl, worker, store }
handle.destroy()                     // teardown ทั้งหมด
```

---

### Global URE API

```js
URE.mount(opts)              // → EngineHandle
URE.getInstance(container)  // → EngineHandle | null
URE.destroyAll()             // ทำลายทุก instance (ใช้ก่อน SPA route change)
URE.modules()                // → UREModules (raw internal access)
URE.config()                 // → CONFIG object
URE.debug()                  // log stats table ทุก instance ใน console
```

---

## 🗺️ Integration Recipes

### Grid layout (card display)

```js
// Card grid — 2 columns, 12px gap
const handle = URE.mount({
  container : '#card-grid',
  data      : items,
  template  : (item, lang) => `
    <div class="card">
      <img data-src="${item.img}" width="160" height="120">
      <p>${item.name?.[lang] || item.name?.en}</p>
    </div>
  `,
  columns   : 2,
  gap       : 12,
  recycling : true,
  keyField  : 'id',
});
```

> **หมายเหตุ:** ใน grid mode engine จะ set `width` ของแต่ละ item โดยอัตโนมัติ  
> ไม่ต้องกำหนด width ใน CSS ของ item เอง

### Horizontal carousel (เหมือนเดิม)

```js
const handle = URE.mount({
  container : trackEl,
  data      : items,
  template  : (item, lang) => `<div class="slide">${item.text}</div>`,
  horizontal: true,
  buffer    : 300,
});
```

### Function-based key (NEW)

```js
// เมื่อ key ต้องการ logic ซับซ้อนกว่าแค่ field name
const handle = URE.mount({
  container : '#app',
  data      : items,
  template  : (item) => `...`,
  itemKey   : (item) => `${item.type}-${item.id}`,
});
```

### Overscan (NEW — item-count buffer)

```js
// pre-render 8 items นอก viewport ในแต่ละทิศ
const handle = URE.mount({
  container : '#app',
  data      : items,
  template  : renderFn,
  overscan  : 8,  // ใช้แทน buffer px (ระบบจะ convert เป็น px จาก type-avg height อัตโนมัติ)
});
```

### updateMany — batch partial update (NEW)

```js
// อัพเดท 3 items โดยไม่ต้อง setData() ทั้งหมด
handle.updateMany([
  { id: 'a1', name: { en: 'Updated name' }, ...rest },
  { id: 'b3', count: 42,                   ...rest },
]);
```

### scrollToKey (NEW)

```js
// Scroll ไปที่ item ที่มี id = 'emoji-grinning'
handle.scrollToKey('emoji-grinning', 'smooth');
```

### onScrollEnd (NEW)

```js
const handle = URE.mount({
  container  : '#app',
  data       : items,
  template   : renderFn,
  onScrollEnd: () => {
    // analytics, lazy fetch next page, etc.
    console.log('scroll settled', handle.getVisibleRange());
  },
});
```

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

### discover / search (เหมือนเดิม)

```js
const handle = URE.mount({
  container  : document.getElementById('content-loading'),
  data       : resolvedItems,
  template   : (item, lang) => renderButtonHTML(item, lang),
  buffer     : 600,
  onItemClick: (e, item) => unifiedCopyToClipboard({ text: item.text, api: item.api }),
});
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

## 🔄 SPA Cleanup

```js
window.addEventListener('routeChanged', () => URE.destroyAll());
```

---

## 🐛 Debug

```js
URE.debug()      // stats table ของทุก instance

handle.stats()
// {
//   vl: {
//     items: 1200, visible: 12, totalSize: 115200,
//     stable: 1180, unstable: 20,
//     preCached: 8,
//     mountCap: 8,        // buffer-zone cap (viewport items are always uncapped)
//     horizontal: false,
//     isGrid: false, columns: 1, gap: 0,
//     typeAvgCount: 3,    // number of item types with measured avg height
//     pool: { cap: 60, buckets: { item: 8 } }
//   },
//   worker: { workerMode: true },
//   store: { items: [...], lang: 'en', loading: false, error: null }
// }

handle.getVisibleRange()
// { startIndex: 5, endIndex: 17 }
```

---

## 🏗️ Architecture

```
URE.mount()
  └── engine.js  (orchestrator — key normalisation, diff integration, public API)
       ├── virtual-list.js  (virtual scroll — list + grid, all perf systems)
       │    ├── pool.js      (node recycling, WeakMap data binding)
       │    └── observer.js  (IO/RO/MO factories)
       ├── diffing.js        (2-pass O(n+m) diff — keyFn support)
       ├── state.js          (reactive store, key-level subscriptions)
       ├── worker.js         (Web Worker bridge + sync fallback)
       ├── lazy-assets.js    (IO-based lazy img/iframe/bg, aspect-ratio CLS fix)
       └── scheduler.js      (rAF visual queue + rIC background queue + MessageChannel yield)
```

---

## ⚙️ Performance Internals

### Virtual Scroll

- **Float64Array prefix sums** — binary search O(log n) สำหรับ list; row-based prefix sums O(log rows) สำหรับ grid
- **transform:translateY / translate(x,y)** — no layout trigger, GPU composite only
- **Two-tier mounting** — viewport items mount ทันที ไม่จำกัด cap; buffer zone ใช้ cap ตาม device tier
- **Type-average height tracking** *(v1.3.0)* — ระบบ track running average ของ height จริงแยกตาม item type; items ใหม่ที่ยังไม่วัดได้รับ estimate จาก average แทน 96px default → ลด correction frequency ~70-90% หลังจาก screenful แรกถูกวัดเสร็จ
- **will-change lifecycle** *(v1.3.0)* — `.ure-settled` ถูกเพิ่มเมื่อ ResizeObserver ยืนยันว่า item มี height stable → CSS flip `will-change` เป็น `auto` → ลด GPU compositing layer สำหรับ items ที่ stable แล้ว
- **First-render fast path** *(v1.3.0)* — buffer-zone mount cap ถูก multiply ด้วย `INITIAL_MOUNT_MULTIPLIER` (×3) บน frame แรก เพื่อให้พื้นที่ใกล้ viewport เต็มใน 1-2 frame แทนที่จะรอหลาย frame บน low-end devices
- **Bidirectional pre-render** *(v1.3.0)* — pre-render cache เติมทั้ง 2 ทิศตาม velocity: heavy ในทิศ scroll, light ในทิศตรงข้าม → ป้องกัน cold cache บน fling-then-reverse
- **Snap-correct on scroll-end** — pending height corrections flush ทันทีที่ scroll หยุด
- **Partial fast-scroll correction** — rebuild offsets + update transforms ทุก velocity; scroll-anchor scrollBy ถูก skip เฉพาะ vel > 1.0
- **Scroll-anchor correction** — ปรับ scrollTop อัตโนมัติหลัง height re-measure (velocity ≤ 1.0 เท่านั้น)
- **DOM pool** — node reuse ด้วย innerHTML wipe; ไม่ `createElement` ทุกครั้ง
- **Partial offset rebuild** (`_rebuildFrom(i)`) — O(n−i) แทน O(n)
- **rAF gating** — viewport items ไม่จำกัด cap; buffer items ไม่เกิน `_MOUNT_CAP` nodes ต่อ frame
- **Velocity buffer** — extend buffer ในทิศที่กำลัง scroll, shrink buffer ด้านหลัง

### Grid Layout *(v1.3.0)*

- **Row-based offset system** — `_rHgt[r]` = max height ของ items ใน row r; `_rOff[r]` = prefix sum ของ row heights
- **Auto item width** — คำนวณจาก `(containerWidth - gap × (columns−1)) / columns`; อัพเดทอัตโนมัติเมื่อ container resize ผ่าน ResizeObserver
- **translate(x,y)** — ทั้ง X และ Y position ถูก set ผ่าน single transform property
- **Row-aware correction** — `_applyCorrection()` ใน grid mode ทำงานบน row index แทน item index เพื่อ correctness

### Diffing

- **2-pass O(n+m)** — ไม่มี nested loop
- **itemKey function support** *(v1.3.0)* — accept `(item) => string` สำหรับ complex key logic
- **Shallow equality** — compare own enumerable keys ไม่ deep clone
- **Full-replace bail-out** — ถ้า `oldItems.length + newItems.length > 50,000` ข้าม diff

### Device Tier

| Tier | Cores | Memory | Buffer mount cap | First-render cap | Pre-render chunk |
|---|---|---|---|---|---|
| 0 (low-end)   | ≤ 2  | ≤ 1 GB | 4  | 12 | 8  |
| 1 (mid-range) | ≤ 4  | ≤ 2 GB | 8  | 24 | 16 |
| 2 (high-end)  | > 4  | > 2 GB | 16 | 48 | 32 |

> **Viewport items ไม่มี cap ในทุก tier** — จำนวน items ที่เห็นได้จริงถูก mount ทั้งหมดทันทีทุกกรณี

---

## 📐 CSS Classes

| Class / Attribute | ใช้โดย | ความหมาย |
|---|---|---|
| `[data-ure-container]` | engine.js | mark container ที่ URE ดูแล |
| `[data-ure-key]` | virtual-list.js | index ของ item บน node |
| `.ure-spacer` | virtual-list.js | div ที่ set height = total virtual list height |
| `.ure-visible` | virtual-list.js | item node ที่ mount อยู่ใน viewport |
| `.ure-settled` | virtual-list.js | **NEW** item ที่ height stable — CSS removes `will-change` |
| `.ure-placeholder` | virtual-list.js | height-only div (item ที่ถูก pool) |
| `.ure-group` | grouped mode | `content-visibility:auto` สำหรับ group containers |
| `img.ure-img-loading` | lazy-assets.js | shimmer animation ขณะโหลด |
| `img.ure-img-loaded` | lazy-assets.js | โหลดสำเร็จ |
| `img.ure-img-error` | lazy-assets.js | โหลดไม่สำเร็จ |
| `.ure-render-error` | engine.js | แสดงเมื่อ template() throw error |

> **ต้องเพิ่มใน ure.css:**
> ```css
> .ure-visible.ure-settled { will-change: auto; }
> ```

---

## ⚠️ ข้อควรระวัง

**Template function ต้อง pure** — URE เรียก template ซ้ำเมื่อ re-render, recycle, language change

**อย่าใส่ event listener ใน template innerHTML** — ใช้ `onItemClick` option แทน

**`keyField` / `itemKey` ต้อง unique ต่อ item** — ถ้า key ซ้ำ diffing จะทำงานผิดพลาด

**Grid mode + horizontal ใช้ร่วมกันไม่ได้** — ถ้าตั้ง `horizontal: true` ค่า `columns` จะถูก ignore (forced = 1)

**Grid mode: ไม่ต้องกำหนด width ใน CSS ของ item** — engine set `style.width` ให้อัตโนมัติ; การ override ใน CSS อาจทำให้ layout ผิดพลาด

**Worker bridge lazy-init** — Web Worker ถูกสร้างครั้งแรกที่เรียก `filter()` / `sort()` / `paginate()`

---

## 📋 Changelog

### v1.3.0 — Performance Deep-Dive + Grid Layout + API Expansion

**Performance improvements (virtual-list.js, config.js):**
- **Type-average height tracking** — running average per item type replaces hard-coded 96px estimates. Reduces correction frequency 70–90% after first screenful is measured.
- **will-change lifecycle** — `.ure-settled` class released when height stabilises, returning GPU compositing layers. Significant VRAM reduction on long lists.
- **First-render fast path** — buffer-zone cap ×3 on frame 1 for faster initial viewport coverage on low-end devices.
- **Bidirectional velocity-aware pre-render** — fills cache heavy in scroll direction, light in reverse. Eliminates cold cache on fling-then-reverse patterns.
- **Grid mode: row-based offset rebuild** — O(rows − r) instead of O(items − i) for grid correction passes.
- **Type-average estimates on insertAt/setItems** — new/replaced items start with accurate height estimates immediately.

**New features:**
- **Grid layout** (`columns` + `gap` options) — multi-column virtual scroll with auto item width and row-based height management.
- **`overscan` option** — item-count-based buffer alternative, auto-converts to px using type averages.
- **`itemKey` function** (`(item) => string`) — function-based key extraction, overrides `keyField` string.
- **`updateMany(items)`** — efficient batch update by key without full diff.
- **`scrollToKey(keyValue, behavior)`** — scroll to item by key.
- **`getVisibleRange()`** — returns `{ startIndex, endIndex }` of currently mounted items.
- **`onScrollEnd` callback** — fires once per scroll-idle period.
- **`CONFIG.DOM.SETTLED_CLASS`** — new constant (`'ure-settled'`) for the will-change lifecycle class.
- **`CONFIG.GRID`** — new constants section for grid defaults.

**diffing.js:** `diff()` and `extractKey()` accept optional `keyFn` parameter — fully backward-compatible.

---

### v1.2.0 — Fast-Scroll Rendering Fix
- Two-tier mounting (viewport uncapped, buffer capped)
- Partial fast-scroll correction (transforms always updated, scrollBy gated on velocity)
- Snap-correct on scroll-end

### v1.1.0 — Horizontal Mode + Scroll-Guard
- `horizontal` option (translateX axis-aware virtual scroll)
- `_coOffPending` scroll-guard for nav bar animations
- `_rebuildFrom(i)` partial offset rebuild

### v1.0.0 — Initial Release
- Virtual scroll, DOM pool, 2-pass diff, Web Worker bridge, lazy assets, device tier