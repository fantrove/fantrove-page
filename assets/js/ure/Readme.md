# URE — Universal Render Engine v1.0.0

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
    ├── scheduler.js          ← rAF + rIC orchestration
    ├── pool.js               ← DOM node recycling pool
    ├── observer.js           ← IO / RO / MO factory
    ├── diffing.js            ← O(n) data diff engine
    ├── state.js              ← Reactive state store
    ├── worker.js             ← Web Worker bridge (filter/sort/paginate)
    ├── lazy-assets.js        ← Lazy img/iframe/bg loading + CLS prevention
    ├── virtual-list.js       ← Core virtual scroll (Float64Array offsets)
    └── engine.js             ← Main orchestrator — wires everything together
```

---

## ⚡ Quick Start

### 1. ใส่ script tag ใน HTML (ครั้งเดียวต่อหน้า)

```html
<script src="/assets/js/ure/ure.js"></script>
```

### 2. Mount ใน JS ของหน้านั้น

```js
const list = URE.mount({
  container : '#app',
  data      : myJsonArray,
  template  : (item, lang) => `
    <div class="card">${item.name?.[lang] || item.name?.en}</div>
  `,
});
```

ประมาณนี้เท่านั้น — URE จัดการ virtual scroll, lazy load, diff, recycle ให้ทั้งหมด

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
| `lang` | `string` | `localStorage.selectedLang` | ภาษาเริ่มต้น |
| `poolCap` | `number` | `60` | จำนวน node สูงสุดใน pool |
| `estimatedItemHeight` | `number` | `96` | px ประมาณความสูง item ก่อนวัดจริง |
| `onVisible` | `(item, el) => void` | - | Callback เมื่อ item เข้า viewport |
| `onHidden` | `(item) => void` | - | Callback เมื่อ item ออกจาก viewport |
| `onUpdate` | `({added, removed, changed}) => void` | - | หลัง data update |
| `onItemClick` | `(event, item) => void` | - | Delegated click บน item |

---

### `EngineHandle` methods

```js
// ── Data ──────────────────────────────────────────────────────────────────
handle.setData(newArray)            // Replace all data (diff-aware)
handle.append(items)                // เพิ่มต่อท้าย
handle.prepend(items)               // เพิ่มหัวรายการ
handle.removeByKey(keyValue)        // ลบ item ด้วย key

// ── Async Worker operations ───────────────────────────────────────────────
await handle.filter(predicates)     // filter ใน Web Worker
await handle.sort(field, dir)       // sort ใน Web Worker
handle.resetFilter()                // คืน data เดิม
await handle.paginate(page, size)   // ดึงหน้าที่ต้องการ

// ── UI ────────────────────────────────────────────────────────────────────
handle.setLang(lang)                // เปลี่ยนภาษา + re-render visible items
handle.scrollTo(index, behavior)    // scroll ไปที่ item index
handle.refresh()                    // force recalculate geometry

// ── State subscription ────────────────────────────────────────────────────
handle.on('lang', fn)               // ฟัง state key ที่เจาะจง
handle.onAny(fn)                    // ฟังทุก state change

// ── Debug ─────────────────────────────────────────────────────────────────
handle.stats()                      // { vl, worker, store }
handle.destroy()                    // teardown ทั้งหมด
```

---

### Filter Predicates

```js
// Single predicate
await handle.filter({ field: 'type', op: 'eq', value: 'emoji' })

// AND logic (array of predicates)
await handle.filter([
  { field: 'type',    op: 'eq',       value: 'emoji'  },
  { field: 'name.en', op: 'includes', value: 'smile'  },
])

// Available operators
// eq, neq, gt, lt, gte, lte, includes, startsWith
```

---

## 🗺️ Integration ต่อหน้า

### home.js (carousel)

```js
// แทนที่ buildCategorySection() เดิม
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
// แทนที่ ContentService.renderContent()
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

---

## 🔄 SPA Route Cleanup

```js
// ก่อน navigate ไปหน้าใหม่
window.addEventListener('routeChanged', () => URE.destroyAll());
```

---

## 🐛 Debug

```js
// ใน browser console
URE.debug()      // แสดง stats ของทุก instance ใน table
```

---

## 🏗️ Architecture

```
URE.mount()
  └── engine.js  (orchestrator)
       ├── virtual-list.js  (O(1) DOM, Float64Array offsets, RO measures)
       │    ├── pool.js      (node recycling, WeakMap binding)
       │    └── observer.js  (IO/RO/MO factories)
       ├── diffing.js        (2-pass O(n+m) diff, shallow equality)
       ├── state.js          (reactive store, key-level subscriptions)
       ├── worker.js         (Web Worker bridge: filter/sort/paginate)
       ├── lazy-assets.js    (IO-based lazy img/iframe, aspect-ratio CLS fix)
       └── scheduler.js      (rAF visual queue + rIC background queue)
```

### ทำไม virtual scroll ถึงเร็ว
- **Float64Array prefix sums** — binary search หา start/end index ใน O(log n)
- **transform:translateY** แทน `top:` — no layout trigger, GPU composite only
- **ResizeObserver** วัด height จริงแบบ async ไม่ block main thread
- **DOM pool** — ไม่ `createElement` ทุกครั้ง ใช้ node เดิมสลับ innerHTML
- **Scroll-anchor correction** — ปรับ scrollTop อัตโนมัติเมื่อ height เปลี่ยน ไม่มี jump
- **rAF gating** — render ไม่เกิน 1 ครั้งต่อ frame แม้ scroll event จะยิงถี่แค่ไหน

### ทำไม diff ถึงประหยัด
- **2-pass O(n+m)** — pass 1 index old, pass 2 walk new — ไม่มี nested loop
- **Shallow equality** — compare own keys เท่านั้น ไม่ deep clone
- **Full-replace bail-out** — ถ้า list > 50,000 items ข้าม diff ใช้ setItems แทน (เร็วกว่า)