# URE — Universal Render Engine v1.4.0

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
    ├── config.js             ← Constants + device tier + GRID defaults
    ├── scheduler.js
    ├── pool.js
    ├── observer.js
    ├── diffing.js            ← O(n+m) diff + optional itemKey fn
    ├── state.js
    ├── worker.js
    ├── lazy-assets.js
    ├── virtual-list.js       ← Core virtual scroll (list + grid)
    └── engine.js             ← Orchestrator + public API
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
| `columns` | `number` | `1` | Grid layout columns (>1 = grid mode, vertical scroll เท่านั้น) |
| `gap` | `number` | `0` | ระยะห่างระหว่าง item/row ใน px |
| `recycling` | `boolean` | `true` | เปิด DOM node pool |
| `diffing` | `boolean` | `true` | เปิด diff — re-render เฉพาะ item ที่เปลี่ยน |
| `keyField` | `string` | `'id'` | Field ที่ใช้เป็น identity ใน diff |
| `itemKey` | `(item) => string` | `null` | Function-based key extraction — override `keyField` |
| `lang` | `string` | `localStorage.selectedLang \|\| 'en'` | ภาษาเริ่มต้น |
| `poolCap` | `number` | `60` | จำนวน node สูงสุดใน pool |
| `horizontal` | `boolean` | `false` | Horizontal scroll mode |
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

// Async Worker
await handle.filter(predicates)
await handle.sort(field, dir)
handle.resetFilter()
await handle.paginate(page, size)

// UI
handle.setLang(lang)
handle.scrollTo(index, behavior)
handle.scrollToKey(keyValue, bhv)  // scroll to item by key
handle.refresh()

// Visibility
handle.getVisibleRange()           // → { startIndex, endIndex }

// State
handle.on('lang', fn)              // → unsubscribe fn
handle.onAny(fn)

// Read-only
handle.itemCount
handle.lang
handle.loading

// Debug
handle.stats()
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
  columns   : 2,
  gap       : 12,
  keyField  : 'id',
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

### Overscan (item-count buffer)

```js
// pre-render 8 items นอก viewport ในแต่ละทิศ
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

---

## 🐛 Debug

```js
URE.debug()

handle.stats()
// {
//   items: 1200, visible: 12, totalSize: 115200,
//   stable: 1180, unstable: 20,
//   preCached: 8,
//   pendingSettled: 3,   // items queued for will-change flush (post-scroll)
//   mountCap: 8,
//   isGrid: false, columns: 1, gap: 0,
//   typeAvgCount: 2,
//   pool: { cap: 60, buckets: { item: 8 } }
// }
```

---

## 🏗️ Architecture

```
URE.mount()
  └── engine.js
       ├── virtual-list.js  (list + grid virtual scroll, all perf systems)
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
- **Type-average height tracking** *(v1.3.0)* — running average per item type; ลด correction frequency ~70-90% หลัง screenful แรก
- **Deferred will-change lifecycle** *(v1.4.0)* — `.ure-settled` ถูก batch-apply ใน rAF เดียว หลัง scroll หยุด — ไม่มี compositor layer changes ระหว่าง scroll เลย
- **Inlined range calculations** *(v1.4.0)* — ไม่สร้าง `{si, ei}` object ทุก frame → zero GC pressure ใน hot path
- **Snap-correct on scroll-end** — flush pending corrections ทันทีที่ scroll idle
- **Partial fast-scroll correction** — rebuild offsets + update transforms ทุก velocity; scrollBy anchor skip เมื่อ vel > 1.0
- **Bidirectional pre-render** — pre-cache ทั้ง 2 ทิศตาม velocity direction
- **Scroll-anchor correction** — ปรับ scrollTop หลัง height correction (vel ≤ 1.0 เท่านั้น)
- **DOM pool** — node reuse ผ่าน innerHTML wipe
- **rAF gating** — viewport uncapped; buffer ≤ `_MOUNT_CAP` per frame

### Grid Layout *(v1.3.0+)*

- Row-based offset prefix sums (`_rHgt[]`, `_rOff[]`)
- Auto item width = `(containerWidth - gap × (columns−1)) / columns`
- ResizeObserver อัพเดท item width อัตโนมัติเมื่อ container resize
- `translate(x, y)` สำหรับ 2-axis positioning

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
> ```

---

## ⚠️ ข้อควรระวัง

**Template ต้อง pure** — ห้าม mutate state ใน template

**อย่าใส่ event listener ใน innerHTML** — ใช้ `onItemClick` แทน

**`keyField` / `itemKey` ต้อง unique** — key ซ้ำทำให้ diff ผิดพลาด

**Grid mode + horizontal ใช้ร่วมกันไม่ได้** — ถ้า `horizontal: true` ค่า `columns` จะถูก force = 1

**Grid mode: ไม่ต้องกำหนด width ใน CSS ของ item** — engine set `style.width` อัตโนมัติ

**Worker bridge lazy-init** — Worker ถูกสร้างครั้งแรกที่เรียก `filter()` / `sort()` / `paginate()`

---

## 📋 Changelog

### v1.4.0 — Jank Regression Fix

**Root-cause analysis vs v1.2.0 (all fixes in `virtual-list.js`):**

**[FIX-1] Deferred will-change lifecycle (`_pendingSettled`)**
- v1.3.0 `_onCardsResized` called `classList.add('ure-settled')` synchronously on the main thread. Changing `will-change:transform → auto` triggers compositor layer demotion — expensive GPU work cascading across multiple items during scroll = constant jank.
- Fix: collect stable elements in `_pendingSettled` Set. Apply the class in a single `Scheduler.schedule` rAF inside the scroll-idle timer, after scroll stops completely. Zero compositor changes during active scroll.
- Recycle loop calls `_pendingSettled.delete(el)` to prevent stale refs from applying the class to reused nodes.

**[FIX-2] Inlined range calculations — no object allocation in render loop**
- v1.3.0 called `_computeRange()` twice per `_render()` frame, each returning `{si, ei}`. At 60fps = 120 allocations/second → GC pressure, observable as ~1–2 ms micro-pauses on low-end devices.
- Fix: inline four binary-search results as local `let` variables. `_computeRange()` function removed.

**[FIX-3] Removed first-render cap boost**
- v1.3.0 used `_MOUNT_CAP × 3` on the first render frame. Low-end device: cap=4 → boost=12, plus ~8 viewport items (uncapped) = up to 20 DOM mounts in one frame. Exceeds the 16.7 ms budget → initial-scroll stutter.
- Fix: uniform `_MOUNT_CAP` for all frames, same as v1.2.0.

All v1.3.0 features retained: grid layout, type-average heights, overscan, bidirectional pre-render, onScrollEnd, getVisibleRange, itemKey function, updateMany, scrollToKey.

---

### v1.3.0 — Performance Deep-Dive + Grid Layout + API Expansion
- Type-average height tracking, will-change lifecycle (deferred in v1.4.0), grid layout, overscan, itemKey function, updateMany, scrollToKey, getVisibleRange, onScrollEnd, bidirectional pre-render.

### v1.2.0 — Fast-Scroll Rendering Fix
- Two-tier mounting, partial fast-scroll correction, snap-correct on scroll-end.

### v1.1.0 — Horizontal Mode + Scroll-Guard
- `horizontal` option, `_coOffPending` scroll-guard, partial offset rebuild.

### v1.0.0 — Initial Release
- Virtual scroll, DOM pool, 2-pass diff, Web Worker bridge, lazy assets, device tier.