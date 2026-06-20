# 08 — สถาปัตยกรรมประสิทธิภาพ (Performance Architecture)

> เอกสารนี้อธิบายกลยุทธ์และเทคนิคประสิทธิภาพที่ใช้ทั่วทั้งระบบ Fantrove — เป็น cross-cutting concern ที่กระทบหลายระบบ (URE, Search, Nav-Core, Language, ConData)
>
> **สำหรับ:** นักพัฒนา/AI ที่ทำงานด้าน performance optimization
>
> **เวอร์ชันอ้างอิง:** URE v1.7.0 (Adaptive Memory Management)

---

## สารบัญ

1. [ภาพรวมกลยุทธ์ประสิทธิภาพ](#1-ภาพรวมกลยุทธ์ประสิทธิภาพ)
2. [Virtual Scrolling (ใน URE)](#2-virtual-scrolling-ใน-ure)
3. [DOM Node Pooling](#3-dom-node-pooling)
4. [Adaptive Memory Management (v1.7.0)](#4-adaptive-memory-management-v170)
5. [Web Workers (off-main-thread processing)](#5-web-workers-off-main-thread-processing)
6. [Typed Arrays (offset calculations)](#6-typed-arrays-offset-calculations)
7. [Template Cache & Height Cache](#7-template-cache--height-cache)
8. [Lazy Asset Loading (img/iframe/bg)](#8-lazy-asset-loading-imgiframebg)
9. [CSS Containment & Content Visibility](#9-css-containment--content-visibility)
10. [requestIdleCallback & RAF Batching](#10-requestidlecallback--raf-batching)
11. [DocumentFragment & Batch DOM Operations](#11-documentfragment--batch-dom-operations)
12. [การวัดประสิทธิภาพ (Profiling)](#12-การวัดประสิทธิภาพ-profiling)
13. [Performance Budgets และ Device Tiers](#13-performance-budgets-และ-device-tiers)
14. [กฎ/ข้อห้ามด้าน Performance](#14-กฎข้อห้ามด้าน-performance)
15. [อ้างอิงข้ามเอกสาร](#15-อ้างอิงข้ามเอกสาร)

---

## 1. ภาพรวมกลยุทธ์ประสิทธิภาพ

### 1.1 ปัญหาที่ต้องแก้

Fantrove แสดงข้อมูลคงที่จำนวนมหาศาล — อีโมจินับพันตัว, สัญลักษณ์ 27 หมวด, ข้อความแฟนซี 10 สไตล์, รวมเป็น **หลายหมื่นถึงหลายแสนรายการ** ในหน้า Discover และ Search เดียว หากแสดง DOM ทุกตัวจะเกิด:

- **Jank ตอน scroll** — การ layout/paint หลายหมื่น element ทำให้ frame ตก 60fps ทำไม่ได้
- **OOM บน mobile** — อุปกรณ์ low-end (1–2 GB RAM) จะ crash ตอน dataset ใหญ่
- **Slow first paint** — main thread ติด processing ทำให้ TBT (Total Blocking Time) สูง
- **GC thrash** — สร้าง/ทำลาย DOM ซ้ำ ๆ ทำให้ GC ทำงานหนักและทำให้ frame แล่น

### 1.2 หลักการออกแบบ

| หลักการ | คำอธิบาย | ที่ใช้ |
|---------|----------|-------|
| **Render น้อยที่สุด** | แสดงเฉพาะ items ใน viewport + buffer | Virtual scrolling |
| **Reuse ไม่ใช่ create** | รีไซเคิล DOM nodes / data / HTML strings | Pool + Template Cache |
| **Adapt to device** | ตรวจ memory/CPU แล้วปรับ budget อัตโนมัติ | MemoryManager + Device Tier |
| **Off-main-thread** | งาน data processing ย้ายไป Worker | Web Worker bridge |
| **Coalesce writes** | รวม DOM mutations หลายตัวเป็น single paint | Scheduler rAF batching + DocumentFragment |
| **Contain layout** | จำกัดการ layout ให้อยู่ใน subtree เดียว | CSS `contain` + `content-visibility` |
| **No layout thrash** | แยก read/write ออกจากกัน | Scheduler batches + cached reads |
| **Persistent caches** | sessionStorage เก็บ height/scroll ข้าม page reload | Height cache + Scroll cache |

### 1.3 แผนภาพกลยุทธ์ระดับสูง

```
┌──────────────────────────────────────────────────────────────────┐
│                    Performance Strategy Layers                   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Layer 1 — RENDER LESS                                          │
│    Virtual Scrolling       → ~30-40 DOM nodes ตลอดเวลา          │
│    Lazy Asset Loading      → img/iframe โหลดเมื่อเข้า buffer      │
│                                                                  │
│  Layer 2 — REUSE                                                │
│    DOM Node Pool          → recycle wrapper divs                │
│    Template HTML Cache    → cache rendered HTML strings          │
│    Height Cache           → sessionStorage ข้าม reload           │
│                                                                  │
│  Layer 3 — ADAPT                                                │
│    Adaptive Memory Mgmt   → 4 pressure levels (v1.7.0)          │
│    Device Tier Detection  → ปรับ chunk size ตาม CPU/RAM          │
│    Connection API         → _navCore_slowConnection flag         │
│                                                                  │
│  Layer 4 — OFFLOAD                                              │
│    Web Worker Bridge      → filter/sort/paginate นอก main thread │
│    requestIdleCallback    → pre-render / warmup ในเวลาว่าง       │
│                                                                  │
│  Layer 5 — COALESCE                                            │
│    Scheduler (rAF + rIC)  → batch DOM work เป็น 1 paint/frame    │
│    DocumentFragment       → 1 insert แทน N inserts               │
│    MessageChannel yield   → ยอมให้ compositor paint ก่อน         │
│                                                                  │
│  Layer 6 — CONTAIN                                             │
│    CSS contain            → layout/style/paint isolation        │
│    content-visibility     → skip rendering นอก viewport         │
│    overflow-anchor: none  → disable browser anchor (URE ทำเอง)  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 1.4 ตารางสรุปเทคนิคทั้งหมด

| # | เทคนิค | ไฟล์หลัก | ระบบ |
|---|--------|----------|------|
| 1 | Virtual Scrolling | `assets/js/ure/ure-modules/virtual-list.js` | URE |
| 2 | DOM Node Pooling | `assets/js/ure/ure-modules/pool.js` | URE |
| 3 | Adaptive Memory Management | `assets/js/ure/ure-modules/memory.js` | URE v1.7.0 |
| 4 | Web Workers | `assets/js/ure/ure-modules/worker.js` | URE |
| 5 | Typed Arrays | `assets/js/ure/ure-modules/virtual-list.js` | URE |
| 6 | Template Cache | `assets/js/ure/ure-modules/virtual-list.js` | URE |
| 7 | Height Cache (sessionStorage) | `assets/js/ure/ure-modules/engine.js` | URE |
| 8 | Scroll Position Cache | `assets/js/ure/ure-modules/engine.js` | URE |
| 9 | Lazy Asset Loading | `assets/js/ure/ure-modules/lazy-assets.js` | URE |
| 10 | CLS Prevention (aspect-ratio) | `assets/js/ure/ure-modules/lazy-assets.js` | URE |
| 11 | CSS Containment | `assets/js/ure/ure.css` | URE |
| 12 | content-visibility:auto | `assets/js/ure/ure.css` | URE |
| 13 | overflow-anchor:none | `assets/js/ure/ure.css` | URE |
| 14 | requestAnimationFrame batching | `assets/js/ure/ure-modules/scheduler.js` | URE + Nav-Core |
| 15 | requestIdleCallback batching | `assets/js/ure/ure-modules/scheduler.js` | URE |
| 16 | MessageChannel yield | `assets/js/ure/ure-modules/scheduler.js` | URE |
| 17 | DocumentFragment | `assets/js/ure/ure-modules/virtual-list.js` | URE |
| 18 | ResizeObserver (height measure) | `assets/js/ure/ure-modules/observer.js` | URE |
| 19 | IntersectionObserver (lazy) | `assets/js/ure/ure-modules/observer.js` | URE |
| 20 | Scroll Anchor Protocol | `assets/js/ure/ure-modules/virtual-list.js` | URE v1.5.0 |
| 21 | Chunked Height Init | `assets/js/ure/ure-modules/virtual-list.js` | URE v1.6.0 |
| 22 | Worker Persistence | `assets/js/ure/ure-modules/worker.js` | URE v1.6.0 |
| 23 | Velocity-aware Buffer | `assets/js/ure/ure-modules/virtual-list.js` | URE |
| 24 | O(n+m) Data Diffing | `assets/js/ure/ure-modules/diffing.js` | URE |
| 25 | Delegated Click Handler | `assets/js/ure/ure-modules/engine.js` | URE |
| 26 | RAF-coalesced Sticky Nav | `assets/js/nav-core-modules/performance.js` | Nav-Core |
| 27 | Native lazy + fetchpriority | `assets/js/nav-core-modules/performance.js` | Nav-Core |
| 28 | Connection API awareness | `assets/js/nav-core-modules/performance.js` | Nav-Core |

---

## 2. Virtual Scrolling (ใน URE)

### 2.1 แนวคิด

แทนที่จะ mount DOM nodes ทุกตัวใน dataset URE mount เฉพาะ items ที่อยู่ใน viewport + buffer zone (default `600px` รอบด้าน) เท่านั้น เมื่อผู้ใช้ scroll items ที่ออกจาก buffer zone จะถูก recycle กลับเข้า pool และ items ใหม่ที่เข้ามาจะถูก mount จาก pool

ผลคือ **DOM node count คงที่ที่ ~30–40 nodes** ไม่ว่า dataset จะใหญ่แค่ไหน (1,000 หรือ 100,000 รายการก็เท่ากัน)

### 2.2 โครงสร้างข้อมูลหลัก

ไฟล์ `assets/js/ure/ure-modules/virtual-list.js` ใช้ typed arrays เพื่อให้การอ่าน/เขียน offsets เร็วและกิน memory น้อย:

```javascript
// Per-item state (4 bytes/item)
let _hgt      = new Float32Array(_items.length).fill(CONFIG.RENDER.DEFAULT_ITEM_HEIGHT);
let _measured = new Uint8Array(_items.length);   // 1 = measured, 0 = estimated
let _seenIdx  = new Uint8Array(_items.length);   // 1 = has been rendered at least once

// Cumulative offset (8 bytes/item + 1)
let _off      = new Float64Array(_items.length + 1);  // list mode
let _totalH   = 0;

// Grid mode
let _rHgt = new Float32Array(Math.ceil(n / _columns));   // row heights
let _rOff = new Float64Array(rows + 1);                   // cumulative row offsets

// Visibility tracking
const _vis      = new Map();        // idx → HTMLElement (currently mounted)
const _elIdx    = new WeakMap();    // HTMLElement → idx (reverse lookup)
const _preCache = new Map();        // idx → pre-rendered HTML string (idle cache)
```

**Memory footprint**: 100,000 items ≈ `100000 × (4 + 1 + 1 + 8) = 1.4 MB` — ยอมรับได้แม้บน mobile

### 2.3 Render Loop

ฟังก์ชัน `_render()` (บรรทัด 424 ใน `virtual-list.js`) ทำงานตามขั้นตอน:

1. **อ่าน scroll state** — `scrollPos()`, `viewportSz()`, `_getContainerOffset()`
2. **คำนวณ buffer** — velocity-aware (ดู §2.5)
3. **หา visible range** `[vsi, vei]` ด้วย binary search บน `_off`
4. **หา buffer range** `[si, ei]` (ใหญ่กว่า visible range)
5. **Recycle nodes นอก buffer range** — release กลับ pool
6. **Mount viewport items** (uncapped) ลง `DocumentFragment`
7. **Mount buffer items** (capped by `_MOUNT_CAP` ต่อ frame) — เกินจะ reschedule ไป rAF ถัดไป
8. **Insert fragment** ทีเดียว (single reflow)
9. **Schedule pre-render** ใน idle time

```javascript
function _render() {
  if (!_spacer.isConnected) return;

  const st  = _ax.scrollPos();
  const vh  = _ax.viewportSz();
  const co  = _getContainerOffset();
  const vel = _vel;

  const buf      = _effectiveBuf();
  const fast     = Math.abs(vel) > 0.3;
  const bufAhead = fast ? buf * 1.6 : buf;
  const bufBehnd = fast ? buf * 0.4 : buf;

  const vpFrom = st - co;
  const vpTo   = st - co + vh;
  const from   = vpFrom - (vel >= 0 ? bufBehnd : bufAhead);
  const to     = vpTo   + (vel >= 0 ? bufAhead : bufBehnd);

  // binary search ranges
  vsi = _find(Math.max(0, vpFrom));
  vei = Math.min(_items.length - 1, _find(Math.max(0, vpTo)) + 1);
  si  = _find(Math.max(0, from));
  ei  = Math.min(_items.length - 1, _find(Math.max(0, to)) + 1);

  // recycle nodes outside [si, ei]
  const toRecycle = [];
  for (const [idx, el] of _vis) {
    if (idx < si || idx > ei) toRecycle.push([idx, el]);
  }
  for (const [idx, el] of toRecycle) {
    _vis.delete(idx); _elIdx.delete(el);
    if (_cardRO) _cardRO.unobserve(el);
    if (onHidden) try { onHidden(_items[idx]); } catch (_) {}
    if (pool) pool.release(el, _getType(idx));
  }

  // mount viewport items via DocumentFragment
  const frag = document.createDocumentFragment();
  for (let i = vsi; i <= vei; i++) {
    if (_vis.has(i)) continue;
    _mountNode(i, frag, ...);
  }

  // mount buffer items — capped to prevent frame budget overflow
  let bufMounts = 0;
  for (let i = si; i <= ei; i++) {
    if (_vis.has(i)) continue;
    if (bufMounts >= _MOUNT_CAP) {
      // defer remainder to next frame
      if (!_scrollRAF) _scrollRAF = requestAnimationFrame(() => { _scrollRAF = null; _render(); });
      break;
    }
    _mountNode(i, frag, false, -1);
    bufMounts++;
  }

  if (frag.hasChildNodes()) _spacer.appendChild(frag);  // single reflow
  _schedulePreRender(si, ei);
}
```

### 2.4 Binary Search บน Offset Array

เพื่อหา item index ที่ตรงกับ scroll position ใน O(log n):

```javascript
function _find(target) {
  if (!_off || _off.length < 2) return 0;
  let lo = 0, hi = _off.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (_off[mid] <= target) lo = mid; else hi = mid - 1;
  }
  return lo;
}
```

### 2.5 Velocity-aware Buffer

เมื่อผู้ใช้ scroll เร็ว (`|_vel| > 0.3 px/ms`) ระบบจะ:
- **ขยาย buffer ข้างหน้า** เป็น `1.6×` → pre-render ล่วงหน้าไกลขึ้น กัน blank area
- **ลด buffer ข้างหลัง** เป็น `0.4×` → ประหยัด memory เพราะ items ที่ผ่านไปแล้วไม่น่ากลับมาดูเร็ว ๆ นี้

```javascript
const fast     = Math.abs(vel) > 0.3;
const bufAhead = fast ? buf * 1.6 : buf;
const bufBehnd = fast ? buf * 0.4 : buf;
```

คำนวณ velocity ใน `_onScroll`:

```javascript
function _onScroll() {
  const now = performance.now(), pos = _ax.scrollPos(), dt = now - _velTime;
  if (dt > 0 && dt < 150) _vel = (pos - _velPos) / dt;
  _velPos = pos; _velTime = now;
  // ...
}
```

### 2.6 Scroll Anchor Protocol (v1.5.0)

ปัญหา: เมื่อ ResizeObserver วัด height จริงของ item แล้วพบว่าต่างจาก estimate ระบบต้อง rebuild offset array และ spacer ทำให้ตำแหน่ง scroll เปลี่ยน → ผู้ใช้เห็น content "กระโดด"

วิธีแก้: URE capture ตำแหน่ง item ที่อยู่บนสุดของ viewport ก่อน correction แล้ว restore ตำแหน่งเดิมหลัง correction

```javascript
function _captureAnchor() {
  if (_items.length === 0) return null;
  const st   = _ax.scrollPos();
  const co   = _getContainerOffset();
  const vTop = Math.max(0, st - co);
  const idx  = Math.min(_find(vTop), _items.length - 1);
  return { idx, row: 0, prevTop: (_off && _off[idx]) || 0 };
}

function _restoreAnchor(anchor) {
  if (!anchor) return;
  const newTop = (_off && _off[anchor.idx]) || 0;
  const delta  = newTop - anchor.prevTop;
  if (Math.abs(delta) < 0.5) return;
  if (Math.abs(_vel) > ANCHOR_APPLY_VEL_THRESHOLD) return;  // 1.5 px/ms — กันสู้กับ user fling
  if (_winMode) window.scrollBy(0, delta);
  else          viewport.scrollTop += delta;
}
```

**เงื่อนไขข้ามใน CSS**: `ure.css` ตั้ง `overflow-anchor: none` บนทั้ง container และ spacer เพื่อปิด browser's native scroll anchoring ไม่งั้นจะซ้อนทับกับของ URE ทำให้เกิด double-jump

```css
/* ใน ure.css */
[data-ure-container] { overflow-anchor: none; }
.ure-spacer           { overflow-anchor: none; }
.ure-visible          { overflow-anchor: none; }
```

### 2.7 Incremental Offset Rebuild

เมื่อ height ของ item เดียวเปลี่ยน ไม่ต้อง rebuild offset ทั้ง array แค่ rebuild ตั้งแต่ dirty index ไปจนถึงท้าย:

```javascript
function _rebuildListFrom(start) {
  start = Math.max(0, start | 0);
  const n = _items.length;
  for (let i = start; i < n; i++) _off[i + 1] = _off[i] + _hgt[i];
  _totalH = _off[n] || 0;
  _spacer.style[_ax.spacerProp] = _totalH + 'px';
}
```

`_minCorrIdx` ติดตาม dirty index ที่ต่ำที่สุด แล้ว rebuild จากตำแหน่งนั้น

### 2.8 Grid Mode

เมื่อ `columns > 1` URE จะคำนวณ offsets ระดับ row แทน item:
- `_rHgt[r]` = ความสูงสูงสุดใน row r
- `_rOff[r]` = cumulative row offset
- Items ใน row เดียวกัน share transform Y แต่ X ต่างกันไปตาม column

```javascript
function _gridTransform(i) {
  const row = (i / _columns) | 0;
  const y   = (_rOff && _rOff[row]) || 0;
  const x   = (i % _columns) * (_itemW + _gap);
  return `translate(${x}px,${y}px)`;
}
```

### 2.9 Public API ของ VirtualList

```javascript
const vl = createVirtualList({
  container, viewport, items, renderFn, lang,
  buffer, recycling, poolCap, horizontal, columns, gap, overscan,
  heightCache, keyExtractor, scrollRestorePos,
  onVisible, onHidden, onScrollEnd,
});

vl.mount();
vl.setItems(newItems);
vl.updateItem(index, newData);
vl.insertAt(index, newItems);
vl.removeAt(index, count);
vl.setLang(newLang);
vl.setMemoryBudget(budget);   // v1.7.0
vl.refresh();
vl.scrollToIndex(index, behavior);
vl.getVisibleRange();          // { startIndex, endIndex }
vl.stats();
vl.destroy();
```

ดูรายละเอียดเพิ่มเติมใน [01-URE](./01-URE-Universal-Render-Engine.md) §3.11

---

## 3. DOM Node Pooling

### 3.1 ปัญหาที่แก้

การ `document.createElement('div')` + `appendChild()` + `removeChild()` ทุก scroll event สร้าง GC pressure มหาศาล ใน list ที่ผู้ใช้ scroll เร็ว อาจมีการ create/destroy หลายร้อยครั้งต่อวินาที ทำให้ GC ทำงานบ่อยและทำให้ frame แล่น (jank)

### 3.2 โซลูชัน — `assets/js/ure/ure-modules/pool.js`

รีไซเคิล DOM wrapper elements แทนการ create/destroy ลด GC pressure ลงได้ **80–95%**

```javascript
function createPool(cap = CONFIG.RENDER.DEFAULT_POOL_CAP) {
  let _cap = Math.max(1, cap | 0);
  /** @type {Map<string, HTMLElement[]>} */
  const _buckets = new Map();          // แยก bucket ตาม type
  const _nodeData = new WeakMap();     // node → item data (GC-friendly)

  function acquire(type = 'item') {
    const bucket = _buckets.get(type);
    if (bucket && bucket.length) {
      const node = bucket.pop();
      node.innerHTML     = '';          // wipe children
      node.className     = '';          // wipe classes
      node.style.cssText = '';          // wipe inline styles
      node.removeAttribute('data-ure-key');
      return node;
    }
    const node = document.createElement('div');
    node.setAttribute('data-ure-pool-type', type);
    return node;
  }

  function release(node, type = 'item') {
    if (!node) return;
    if (node.parentNode) node.parentNode.removeChild(node);
    let bucket = _buckets.get(type);
    if (!bucket) { bucket = []; _buckets.set(type, bucket); }
    if (bucket.length < _cap) bucket.push(node);
    // over cap → let GC handle
  }
  // ...
}
```

### 3.3 ทำไมต้องแยก bucket ตาม type?

Items ต่าง type อาจมี template ต่างกัน (emoji vs symbol vs card) การแยก bucket ช่วยให้ node ที่ได้กลับมา "ใกล้เคียง" กับที่เคยใช้ ลดโอกาสที่จะต้อง reset structure หนัก

ใน URE type มาจาก `_getType(idx)` ที่อ่าน `item._ureType || item.type || 'item'`

### 3.4 WeakMap สำหรับ data binding

```javascript
// ใน pool.js
const _nodeData = new WeakMap();
// ...
return {
  // ...
  bind    : (node, data) => { _nodeData.set(node, data); },
  getData : (node)       => _nodeData.get(node),
};
```

WeakMap อนุญาตให้ GC ทำลาย entry โดยอัตโนมัติเมื่อ node ถูก GC → **ไม่มี memory leak** แม้ pool จะเก็บ data ไว้

### 3.5 Dynamic Cap (v1.7.0)

เมื่อ MemoryManager สั่งลด budget (TIGHT/CRITICAL) `setCap()` จะ:
1. ลด cap ใหม่
2. **Drain nodes ที่เกิน cap ทันที** พร้อม `innerHTML = ''` เพื่อให้ child subtrees ถูก GC ทัน
3. ไม่ต้องรอ scroll event เพื่อ trigger eviction

```javascript
function setCap(newCap) {
  _cap = Math.max(1, newCap | 0);
  for (const bucket of _buckets.values()) {
    while (bucket.length > _cap) {
      const node = bucket.pop();
      if (node) node.innerHTML = '';   // critical — wipe subtree
    }
  }
}
```

ถ้าไม่ wipe `innerHTML` child elements (e.g. `<img>`, `<svg>`) จะยังถูก pool node reference อยู่ → GC ไม่สามารถ reclaim ได้

### 3.6 Public API

```javascript
const pool = createPool(60);                    // default cap 60
const node = pool.acquire('emoji');             // → HTMLElement
pool.bind(node, itemData);                       // bind item data
const data = pool.getData(node);                 // retrieve
pool.release(node, 'emoji');                     // recycle
pool.getCap();                                   // → 60
pool.setCap(20);                                 // drain to 20
pool.stats();                                    // → { cap, buckets: { emoji: 12, ... } }
pool.destroy();                                  // wipe + clear
```

### 3.7 การเปรียบเทียบ Pool vs No Pool

| เกณฑ์ | ไม่ใช้ Pool | ใช้ Pool (cap=60) |
|------|-------------|-------------------|
| DOM operations ต่อ scroll | create + destroy ~10–30 nodes | 0 create/destroy (reuse) |
| GC pressure | สูงมาก (jank) | ต่ำ 80–95% |
| Memory | ปรับตาม actual nodes | คงที่ที่ cap |
| First scroll | เร็ว | เร็ว (เหมือนกัน) |
| Sustained scroll | ช้าลงเรื่อย ๆ | คงเส้นคงวา |

---

## 4. Adaptive Memory Management (v1.7.0)

### 4.1 ปัญหาที่แก้

ก่อน v1.7.0 URE ใช้ budget คงที่ที่ `LARGE_DATASET` defaults (TEMPLATE_CACHE_CAP=2000, POOL_CAP=60, ฯลฯ) ปัญหาคือ:
- บนอุปกรณ์ low-end (1GB RAM) budget เริ่มต้นใหญ่เกินไป → OOM
- บนอุปกรณ์ high-end budget เล็กเกินไป → cache eviction บ่อย → cache miss → ช้า

### 4.2 โซลูชัน — `assets/js/ure/ure-modules/memory.js`

MemoryManager singleton ตรวจ memory pressure แบบ real-time และปรับ budget ของทุก component อัตโนมัติ

### 4.3 4 Pressure Levels

```javascript
const PRESSURE = Object.freeze({
  COMFORTABLE : 0,   // ใช้ budget เต็ม
  MODERATE    : 1,   // เริ่มลด cache/buffer
  TIGHT       : 2,   // ลด pool/cache อย่างมาก
  CRITICAL    : 3,   // ใกล้ OOM — ปล่อย worker data + drain pool
});
```

### 4.4 Detection Strategy

ใช้ค่าที่สูงกว่าระหว่าง 3 แหล่ง:

#### 4.4.1 Static — `navigator.deviceMemory` (ทุก browser)

```javascript
function _staticPressure() {
  const gb = (navigator && navigator.deviceMemory) || 4;
  const [t0, t1, t2] = MEMORY.DEVICE_MEMORY_THRESHOLDS_GB;  // [4, 2, 1]
  if (gb >= t0) return PRESSURE.COMFORTABLE;   // ≥4GB
  if (gb >= t1) return PRESSURE.MODERATE;      // ≥2GB
  if (gb >= t2) return PRESSURE.TIGHT;         // ≥1GB
  return PRESSURE.CRITICAL;
}
```

`navigator.deviceMemory` คืนค่าเป็น `{0.25, 0.5, 1, 2, 4, 8}` หรือ `undefined` (default = 4)

#### 4.4.2 Dynamic — `performance.memory` heap ratio (Chromium เท่านั้น)

```javascript
function _heapPressure() {
  try {
    const m = performance.memory;
    if (!m || !m.jsHeapSizeLimit || m.jsHeapSizeLimit === 0) return null;
    const ratio = m.usedJSHeapSize / m.jsHeapSizeLimit;
    const [t1, t2, t3] = MEMORY.HEAP_USAGE_THRESHOLDS;   // [0.50, 0.70, 0.85]
    if (ratio < t1) return PRESSURE.COMFORTABLE;  // <50%
    if (ratio < t2) return PRESSURE.MODERATE;     // <70%
    if (ratio < t3) return PRESSURE.TIGHT;        // <85%
    return PRESSURE.CRITICAL;                     // ≥85%
  } catch (_) {
    return null;  // fall back to static
  }
}
```

ตรวจทุก 30 วินาที (`POLL_INTERVAL_MS = 30_000`)

#### 4.4.3 Page-hidden — ประเมินทันทีเมื่อ `visibilitychange` → hidden

```javascript
function _onVisibilityChange() {
  if (document.hidden) _evaluate();
}
document.addEventListener('visibilitychange', _onVisibilityChange, { passive: true });
```

เหตุผล: เมื่อผู้ใช้ switch tab memory ของหน้า hidden มักถูก OS ลด → ตรวจทันทีเพื่อ trigger trim ก่อนที่จะกลับมาใช้

### 4.5 Evaluate + Notify

```javascript
function _evaluate() {
  if (_destroyed) return;
  const heap = _heapPressure();
  // Take max(static, heap) — heap can raise pressure even on capable device
  const next = heap !== null
    ? Math.max(_staticPressure(), heap)
    : _staticPressure();
  if (next === _level) return;       // no change → no notification
  const prev = _level;
  _level = next;
  _notifyAll(prev, next);
}

function _notifyAll(prev, next) {
  for (const fn of _listeners) {
    try { fn(next, prev); }
    catch (e) { console.error('[URE/Memory] listener error:', e); }
  }
}
```

ใช้ `Math.max(static, heap)` เพื่อให้ heap degradation สามารถยกระดับ pressure ได้แม้บนอุปกรณ์ที่ static tier ดี

### 4.6 Budget Table

จาก `assets/js/ure/ure-modules/config.js`:

| Key | COMFORTABLE | MODERATE | TIGHT | CRITICAL | ใช้กับ |
|-----|-------------|----------|-------|----------|--------|
| `POOL_CAP` | 60 | 40 | 20 | 8 | DOM recycle pool (nodes per bucket) |
| `TMPL_CACHE_CAP` | 2,000 | 800 | 200 | 50 | Template HTML cache entries |
| `PRE_CACHE_CAP` | 48 | 24 | 8 | 2 | Idle pre-render cache items |
| `HEIGHT_CACHE_MAX` | 5,000 | 3,000 | 1,500 | 500 | sessionStorage height cache |
| `WORKER_PERSIST_N` | 10,000 | 5,000 | 2,000 | 1,000 | Threshold โหลด data เข้า Worker |
| `CHUNK_INIT_N` | 50,000 | 30,000 | 15,000 | 5,000 | Threshold chunked height init |
| `BUFFER_PX` | 600 | 400 | 200 | 100 | Virtual scroll pre-render buffer |
| `MOUNT_CAP_SCALE` | 1.0 | 1.0 | 0.75 | 0.5 | Multiplier สำหรับ `_MOUNT_CAP` |

### 4.7 Public API

```javascript
const MemoryManager = UREModules.MemoryManager;

MemoryManager.level;                 // → 0|1|2|3
MemoryManager.levelName();           // → 'COMFORTABLE'|'MODERATE'|'TIGHT'|'CRITICAL'
MemoryManager.getBudget('POOL_CAP'); // → 60|40|20|8 (ตาม pressure ปัจจุบัน)
MemoryManager.getAllBudgets();       // → { POOL_CAP, TMPL_CACHE_CAP, ... }
MemoryManager.on((next, prev) => {
  console.log(`Pressure: ${prev} → ${next}`);
  // ปรับ cache/pool ตาม budget ใหม่
});                                  // → unsubscribe function
MemoryManager.checkpoint();          // force evaluate ทันที
MemoryManager.stats();               // → { level, heapUsed, heapRatio, deviceMemGB, ... }
MemoryManager.destroy();             // cleanup (test only)
```

### 4.8 Integration ใน engine.js

ใน `assets/js/ure/ure-modules/engine.js`:

#### 4.8.1 Mount-time clamping

```javascript
const _initBudget       = MemoryManager.getAllBudgets();
const _effectivePoolCap = Math.min(poolCap, _initBudget.POOL_CAP);
const _effectiveBuffer  = Math.min(buffer,  _initBudget.BUFFER_PX);
```

เอาค่าที่ **น้อยกว่า** ระหว่าง user option กับ memory budget → low-memory devices เริ่มต้นด้วย cap ที่เหมาะสมทันที ไม่ต้อง mount ใหญ่แล้วค่อย trim

#### 4.8.2 Runtime pressure subscription

```javascript
const _unsubMemory = MemoryManager.on(_onMemoryPressure);

function _onMemoryPressure(next) {
  const budget = MemoryManager.getAllBudgets();
  vl.setMemoryBudget(budget);                    // propagate ไป virtual list
  _trimHeightCache(_heightCache, budget.HEIGHT_CACHE_MAX);
  if (next === MemoryManager.PRESSURE.CRITICAL && document.hidden && worker.dataLoaded) {
    worker.clearData();  // ปล่อย worker stored data — largest single allocation
  }
}
```

#### 4.8.3 CRITICAL + hidden path — clear worker data

Worker stored data เป็น allocation เดียวที่ใหญ่ที่สุดใน memory (อาจเป็น MB ขึ้น) เมื่อ:
- Pressure = CRITICAL (heap ≥85%)
- Page hidden (ผู้ใช้ไม่ได้ดูอยู่)
- Worker มี data loaded

→ ปล่อย data ทิ้ง จะถูก reload อัตโนมัติใน `setData()` / `loadChunked()` ครั้งถัดไปเมื่อ page active อีกครั้ง

#### 4.8.4 setMemoryBudget ใน virtual-list.js

```javascript
setMemoryBudget(budget) {
  if (budget.TMPL_CACHE_CAP != null) {
    _tmplCap = budget.TMPL_CACHE_CAP;
    _trimMap(_tmplCache, _tmplCap);   // evict oldest ทันที
  }
  if (budget.PRE_CACHE_CAP != null) {
    _PRE_CAP = budget.PRE_CACHE_CAP;
    _trimMap(_preCache, _PRE_CAP);
  }
  if (budget.BUFFER_PX != null) {
    _buffer = budget.BUFFER_PX;
  }
  if (budget.CHUNK_INIT_N != null) {
    _chunkInitN = budget.CHUNK_INIT_N;
  }
  if (budget.POOL_CAP != null && pool) {
    pool.setCap(budget.POOL_CAP);     // drain excess nodes
  }
  if (budget.MOUNT_CAP_SCALE != null) {
    const tierBase = [4, 8, 16][_T];
    _MOUNT_CAP = Math.max(4, Math.round(tierBase * budget.MOUNT_CAP_SCALE));
    if (budget.PRE_CACHE_CAP == null) {
      _PRE_CAP = Math.max(4, _MOUNT_CAP * 3);
    }
  }
}
```

Helper `_trimMap` ใช้ Map insertion-order เพื่อ evict oldest entry O(1):

```javascript
function _trimMap(map, maxSize) {
  while (map.size > maxSize) {
    map.delete(map.keys().next().value);
  }
}
```

### 4.9 URE Public API สำหรับ memory

```javascript
URE.memoryStats();         // → MemoryManager.stats()
URE.memoryCheckpoint();    // force evaluate ทันที (ใช้หลัง large data load)
```

---

## 5. Web Workers (off-main-thread processing)

### 5.1 ปัญหาที่แก้

filter / sort / paginate dataset ขนาดใหญ่ (10,000+ items) บน main thread จะ block UI หลายร้อย ms ทำให้ scroll / typing หยุดชะงัก ย้ายไป Worker แทนเพื่อให้ main thread ว่างสำหรับ render + input

### 5.2 โซลูชัน — `assets/js/ure/ure-modules/worker.js`

Worker source ฝังเป็น string ในไฟล์ แล้วสร้างด้วย Blob URL (ไม่ต้องมีไฟล์ worker แยก):

```javascript
const WORKER_SRC = `'use strict';
let _storedItems = null;
function _sortBy(arr, field, dir) { /* ... */ }
function _filter(arr, predStr) { /* ... */ }
function _applyPred(item, pred) { /* eq, neq, gt, lt, gte, lte, includes, startsWith */ }
function _dedupe(arr, field) { /* ... */ }
self.onmessage = function(e) {
  const { id, action, payload } = e.data;
  // ... switch on action ...
  self.postMessage({ id, ok: true, result });
};`;

const blob = new Blob([WORKER_SRC], { type: 'application/javascript' });
_blobUrl   = URL.createObjectURL(blob);
_worker    = new Worker(_blobUrl);
```

### 5.3 Worker Operations

| Action | คำอธิบาย | ใช้ `_storedItems`? |
|--------|-----------|----------------------|
| `loadData` | (v1.6.0) โหลด dataset เก็บใน Worker memory | — |
| `clearData` | (v1.6.0) ปล่อย reference ให้ GC | — |
| `filter` | กรองด้วย predicates | ✅ (ถ้ามี) |
| `sort` | เรียงลำดับตาม field + direction | ❌ (sort current VIEW) |
| `filterSort` | filter แล้ว sort | ✅ |
| `dedupe` | ลบ duplicates ตาม field | ✅ |
| `transform` | เพิ่ม field ใหม่ | ❌ |
| `paginate` | แบ่งหน้า | ✅ |

Predicate operators: `eq`, `neq`, `gt`, `lt`, `gte`, `lte`, `includes`, `startsWith`

### 5.4 Persistent Data (v1.6.0)

ปัญหา: structured-clone ของ 10,000+ items ทุก filter/paginate call คือ O(n) cost ที่ไม่จำเป็น

วิธีแก้:
1. **loadData** ครั้งเดียว — เก็บ `_storedItems` ใน Worker memory
2. **filter/paginate/dedupe/filterSort** — ใช้ `_storedItems` ถ้ามี ไม่ส่ง items ใน message
3. **sort** — ยังส่ง items (sort current VIEW ที่อาจเป็น filtered subset)

```javascript
// ใน worker.js (bridge side)
filter(items, predicates) {
  if (_dataLoaded && _ready && _worker) {
    return _exec('filter', { predicates });      // NO items sent!
  }
  return _exec('filter', { items, predicates });
}
```

Threshold: `WORKER_PERSIST_N` (default 10,000 ตาม pressure level) — เรียก `_maybeLoadWorkerData()` ใน engine.js

```javascript
function _maybeLoadWorkerData(items) {
  const threshold = MemoryManager.getBudget('WORKER_PERSIST_N')
    ?? CONFIG.LARGE_DATASET.WORKER_PERSIST_N;
  if (items.length < threshold) return;
  worker.loadData(items).catch(err => {
    console.warn('[URE/Engine] worker.loadData failed:', err.message);
  });
}
```

### 5.5 Sync Fallback

หาก Worker ไม่ available (CSP, old browser, Worker creation failed) ระบบจะทำงานแบบ synchronous บน main thread แทน:

```javascript
function _syncExec(action, payload) {
  switch (action) {
    case 'filter'     : return _filterSync(payload.items, payload.predicates);
    case 'sort'       : return _sortSync(payload.items, payload.field, payload.dir);
    case 'filterSort' : return _sortSync(_filterSync(payload.items, payload.predicates), payload.field, payload.dir);
    case 'dedupe'     : return _dedupeSync(payload.items, payload.field);
    case 'paginate': {
      const { page, pageSize } = payload;
      const start = (page - 1) * pageSize;
      return { items: payload.items.slice(start, start + pageSize), /* ... */ };
    }
    // ...
  }
}
```

### 5.6 Promise-based API

แต่ละ action คืน Promise ที่ resolve/reject เมื่อ Worker ตอบกลับ:

```javascript
function _exec(action, payload) {
  if (!_ready) _init();
  if (!_ready || !_worker) {
    try { return Promise.resolve(_syncExec(action, payload)); }
    catch (e) { return Promise.reject(e); }
  }
  return new Promise((resolve, reject) => {
    const id = ++_idCounter;
    _pending.set(id, { resolve, reject });
    _worker.postMessage({ id, action, payload });
  });
}
```

### 5.7 Error Recovery

ถ้า Worker crash ระบบจะ:
1. Reject ทุก pending promise
2. ล้าง `_pending` map
3. ตั้ง `_ready = false` และ `_dataLoaded = false`
4. Call `_exec()` ครั้งถัดไปจะ `_init()` ใหม่ (สร้าง Worker ใหม่)

```javascript
function _onError(e) {
  console.error('[URE/Worker] Worker error:', e.message);
  for (const [, p] of _pending) p.reject(new Error('Worker crashed'));
  _pending.clear();
  _ready = false;
  _dataLoaded = false;
}
```

### 5.8 Public API

```javascript
const bridge = createWorkerBridge();
bridge.exec(action, payload);               // generic
bridge.loadData(items);                      // preload
bridge.clearData();                          // release
bridge.filter(items, predicates);
bridge.sort(items, field, dir);
bridge.filterSort(items, predicates, field, dir);
bridge.dedupe(items, field);
bridge.paginate(items, page, pageSize);
bridge.isWorkerMode;                         // → boolean
bridge.dataLoaded;                           // → boolean
bridge.destroy();                            // terminate + revoke URL
```

### 5.9 การใช้งานใน engine.js (data ops)

```javascript
async filter(predicates) {
  store.set('loading', true);
  try {
    const f = await worker.filter(_originalData, predicates);
    _applyDiff(f);
    store.set({ items: _currentItems, loading: false, error: null });
  } catch (e) { store.set({ loading: false, error: e.message }); }
}

async sort(field, dir) {
  store.set('loading', true);
  try {
    const s = await worker.sort(_currentItems, field, dir);
    _applyDiff(s);
    store.set({ items: _currentItems, loading: false, error: null });
  } catch (e) { store.set({ loading: false, error: e.message }); }
}

async paginate(page, sz) {
  store.set('loading', true);
  try {
    const r = await worker.paginate(_originalData, page, sz);
    _applyDiff(r.items);
    store.set({ items: _currentItems, loading: false });
    return r;
  } catch (e) { store.set({ loading: false, error: e.message }); throw e; }
}
```

---

## 6. Typed Arrays (offset calculations)

### 6.1 ทำไมต้อง Typed Arrays?

ใน virtual scrolling ต้องเก็บ height และ cumulative offset ของทุก item สำหรับ 100,000 items ถ้าใช้ `Array<number>` ปกติจะกิน memory ~720 MB (8 bytes/number × overhead ของ JS object) — **OOM แน่นอน**

Typed Arrays กิน memory ตามจริง (no per-element overhead):

| Type | Bytes/element | Range | ใช้เก็บ |
|------|---------------|-------|--------|
| `Float32Array` | 4 | ±3.4e38 (7 sig digits) | Item heights |
| `Float64Array` | 8 | ±1.8e308 (15 sig digits) | Cumulative offsets |
| `Uint8Array` | 1 | 0–255 | Boolean flags (measured, seenIdx) |

### 6.2 Memory Comparison

สำหรับ 100,000 items:

| Approach | Memory | Notes |
|----------|--------|-------|
| `Array<number>` | ~720 MB | Each number is a JS object with overhead |
| `Float64Array` | 800 KB | Raw 8 bytes/element |
| `Float32Array` | 400 KB | Raw 4 bytes/element — เพียงพอสำหรับ px height |
| `Uint8Array` | 100 KB | 1 byte/element — สำหรับ boolean flags |

### 6.3 การใช้งานใน virtual-list.js

```javascript
// Per-item height (4 bytes/item)
let _hgt      = new Float32Array(_items.length).fill(CONFIG.RENDER.DEFAULT_ITEM_HEIGHT);
// Boolean: 1 = วัดจริงแล้ว, 0 = ยังเป็น estimate
let _measured = new Uint8Array(_items.length);
// Boolean: 1 = เคย render แล้ว (ใช้สำหรับ stagger animation)
let _seenIdx  = new Uint8Array(_items.length);

// Cumulative offset (8 bytes/item + 1)
let _off      = new Float64Array(_items.length + 1);
```

ทำไม `_off` ต้องเป็น Float64 ไม่ใช่ Float32?
- Cumulative sum ของ height หลายหมื่น item อาจเกิน precision ของ Float32 (7 sig digits)
- ตัวอย่าง: 100,000 items × 96px = 9,600,000 px — Float32 มี precision ~7 digits → rounding error ~1px ที่ scroll สูง ทำให้ binary search คลาดเคลื่อน

### 6.4 Resize เมื่อ dataset เปลี่ยน

เมื่อ `setItems()` ถูกเรียก URE จะ allocate typed arrays ใหม่:

```javascript
setItems(newItems) {
  _items      = newItems.slice();
  const n     = _items.length;
  _measured   = new Uint8Array(n);
  _seenIdx    = new Uint8Array(n);
  _hgt = new Float32Array(n).fill(CONFIG.RENDER.DEFAULT_ITEM_HEIGHT);
  // ...
}
```

สำหรับ `insertAt()` และ `removeAt()` ระบบจะ allocate typed array ใหม่ที่มีขนาดถูกต้อง แล้ว copy ส่วนที่ยังใช้ได้จาก array เดิม:

```javascript
insertAt(index, newItems) {
  _items.splice(index, 0, ...newItems);
  const len = newItems.length;
  const xh  = new Float32Array(len);
  for (let i = 0; i < len; i++) xh[i] = _estimatedH(index + i);
  const mh = new Float32Array(_hgt.length + len);
  mh.set(_hgt.slice(0, index)); mh.set(xh, index); mh.set(_hgt.slice(index), index + len);
  _hgt = mh;
  // similar for _measured and _seenIdx
  _rebuildFrom(index);
  Scheduler.schedule(_render, 'vl-insert');
}
```

### 6.5 Grow-on-demand

สำหรับ append-only scenarios ที่ไม่ต้องการ alloc ใหม่ทุกครั้ง มี `_growArrays(n)` helper ที่ alloc array ใหญ่ขึ้นแล้ว copy เดิม:

```javascript
function _growArrays(n) {
  if (_hgt.length >= n) return;
  const h2 = new Float32Array(n);
  h2.set(_hgt);
  for (let i = _hgt.length; i < n; i++) h2[i] = _estimatedH(i);
  _hgt = h2;
  const m2 = new Uint8Array(n); m2.set(_measured); _measured = m2;
  const s2 = new Uint8Array(n); s2.set(_seenIdx);  _seenIdx  = s2;
}
```

### 6.6 Search System ก็ใช้ Typed Arrays

`assets/js/search-modules/virtual-scroll.js` (legacy engine ที่ถูกแทนด้วย URE) มี memory model comment ที่อธิบายชัดเจน:

```
│  _vis  Map    visible nodes only   ≈ 30-40 nodes    O(1)   │
│  _pool []     recycled nodes       ≤ POOL_MAX=40    O(1)   │
│  _idxMap Map  node → index         ≈ 30-40 entries  O(1)   │
│  _hgt  F32    height per item      4B × n           O(n)†  │
│  _off  F64    cumul. offsets       8B × n           O(n)†  │
│  DOM nodes    always ~30-40        regardless of n   O(1)  │
│                                                              │
│  † 10,000 items = 120KB. 100,000 items = 1.2MB. Fine.       │
```

---

## 7. Template Cache & Height Cache

### 7.1 Template HTML Cache (v1.6.0)

#### 7.1.1 ปัญหา

`renderFn(item, lang)` อาจทำงานหนัก — แปลง name, escape HTML, build attribute string, ฯลฯ ถ้าเรียกซ้ำ item เดิม (เช่น scroll ไปกลับ) จะเสีย CPU เปล่า

#### 7.1.2 โซลูชัน — `_tmplCache` ใน virtual-list.js

```javascript
const _tmplCache = new Map();   // key → { html, lang, item }

function _renderWithCache(item, idx) {
  if (!keyExtractor) return renderFn(item, _lang);
  const key = keyExtractor(item, idx);
  if (!key) return renderFn(item, _lang);
  const hit = _tmplCache.get(key);
  if (hit && hit.item === item && hit.lang === _lang) return hit.html;
  const html = renderFn(item, _lang);
  // Evict oldest if at cap — O(1) due to Map insertion-order
  if (_tmplCache.size >= _tmplCap) {
    _tmplCache.delete(_tmplCache.keys().next().value);
  }
  _tmplCache.set(key, { html, lang: _lang, item });
  return html;
}
```

Cache hit เงื่อนไข:
1. key เดียวกัน
2. item reference เดียวกัน (===)
3. lang เดียวกัน

ถ้า lang เปลี่ยน (language switch) cache จะ miss หมด → re-render ใหม่ทั้งหมด (correct behavior)

#### 7.1.3 Eviction — O(1) LRU-ish

Map ใน JS รักษา insertion order ครบ `keys().next().value` คืน key เก่าที่สุด → `delete` ได้ใน O(1):

```javascript
if (_tmplCache.size >= _tmplCap) {
  _tmplCache.delete(_tmplCache.keys().next().value);
}
_tmplCache.set(key, { html, lang: _lang, item });
```

เป็น FIFO ไม่ใช่ LRU แท้ (ไม่ update insertion order ตอน read) แต่พอใช้สำหรับ pattern ที่ user มัก scroll ไปข้างหน้า

#### 7.1.4 Cap ปรับตาม Memory Pressure

| Pressure | TMPL_CACHE_CAP |
|----------|----------------|
| COMFORTABLE | 2,000 |
| MODERATE | 800 |
| TIGHT | 200 |
| CRITICAL | 50 |

### 7.2 Height Cache (sessionStorage)

#### 7.2.1 ปัญหา

เมื่อโหลดหน้าใหม่ URE ต้อง rebuild offsets โดยใช้ height estimates (default 96px) ถ้า height จริงต่างจาก estimate จะเกิด height correction loop หลายรอบ → scroll jump

#### 7.2.2 โซลูชัน — `sessionStorage` height cache

บันทึก height จริงของแต่ละ item ตาม key แล้วโหลดคืนเมื่อ mount ใหม่:

```javascript
// ใน engine.js
function _loadHeightCache(storageKey) {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return new Map();
    const { v, d } = JSON.parse(raw);
    if (v !== CONFIG.CACHE.VERSION) return new Map();   // version check
    return new Map(d);
  } catch (_) {
    return new Map();
  }
}

function _saveHeightCache(storageKey, cache) {
  if (cache.size === 0) return;
  try {
    let entries = Array.from(cache.entries());
    if (entries.length > CONFIG.CACHE.MAX_ENTRIES) {  // 5000
      entries = entries.slice(-CONFIG.CACHE.MAX_ENTRIES);  // keep newest
    }
    sessionStorage.setItem(storageKey, JSON.stringify({ v: CONFIG.CACHE.VERSION, d: entries }));
  } catch (_) {}
}
```

Cache key: `ure_h_{containerId}_{keyField}` — แยกตาม container + key field

#### 7.2.3 Version Check

```javascript
if (v !== CONFIG.CACHE.VERSION) return new Map();
```

เมื่อ schema เปลี่ยน (เช่น เพิ่ม field ใหม่) ให้ bump `CACHE.VERSION` ใน `config.js` เพื่อ invalidate cache เก่าทั้งหมด

#### 7.2.4 Save Triggers

```javascript
const _onVisibilityChange = () => { if (document.hidden) _persistAll(); };
const _onPageHide         = () => _persistAll();
document.addEventListener('visibilitychange', _onVisibilityChange);
window.addEventListener('pagehide', _onPageHide);
```

บันทึกเมื่อ:
- `visibilitychange` → hidden (switch tab / minimize)
- `pagehide` (ปิด tab / refresh / navigate away)

#### 7.2.5 Orientation Invalidation

```javascript
function _onOrientationChange() {
  _heightCache.clear();
  try { sessionStorage.removeItem(_hCacheKey); } catch (_) {}
}
screen.orientation.addEventListener('change', _onOrientationChange);
// หรือ window.addEventListener('orientationchange', ...) สำหรับ browser เก่า
```

เมื่อ orientation เปลี่ยน layout เปลี่ยน → height เดิมไม่ใช้ได้ → ล้าง cache

#### 7.2.6 Adaptive Cap

| Pressure | HEIGHT_CACHE_MAX |
|----------|------------------|
| COMFORTABLE | 5,000 |
| MODERATE | 3,000 |
| TIGHT | 1,500 |
| CRITICAL | 500 |

เมื่อ pressure เปลี่ยน engine.js จะ trim cache ทันที:

```javascript
function _onMemoryPressure(next) {
  const budget = MemoryManager.getAllBudgets();
  vl.setMemoryBudget(budget);
  _trimHeightCache(_heightCache, budget.HEIGHT_CACHE_MAX);
  // ...
}

function _trimHeightCache(cache, maxEntries) {
  while (cache.size > maxEntries) {
    cache.delete(cache.keys().next().value);
  }
}
```

### 7.3 Scroll Position Cache

```javascript
function _loadScrollPos(key) {
  try { const r = sessionStorage.getItem(key); return r ? (parseFloat(r) || 0) : 0; }
  catch (_) { return 0; }
}
function _saveScrollPos(key, pos) {
  try { sessionStorage.setItem(key, String(pos)); } catch (_) {}
}
```

Cache key: `ure_sp_{containerId}_{keyField}`

ใช้ใน `scrollRestorePos` option ตอน mount — restore scroll position เดิมเมื่อผู้ใช้กลับมาหน้าเดิม

### 7.4 Chunked Height Init (v1.6.0)

สำหรับ dataset > `CHUNK_INIT_N` (default 50,000) การ load height cache ทีเดียวจะ block main thread นานเกินไป → ใช้ `requestIdleCallback` แบ่งเป็น chunks:

```javascript
function _applyHeightCacheChunked(totalN) {
  if (!heightCache || !keyExtractor) return;
  let cursor = 0;

  function tick() {
    const end = Math.min(cursor + INIT_CHUNK_SIZE, totalN);  // 5000 items/chunk
    for (let i = cursor; i < end; i++) {
      const key = keyExtractor(_items[i], i);
      if (!key || !heightCache.has(key)) continue;
      const h = heightCache.get(key);
      if (Math.abs(h - _hgt[i]) > 2) {
        _hgt[i] = h;
        if (i < _minCorrIdx) _minCorrIdx = i;
      }
    }
    cursor = end;
    if (cursor < totalN) {
      typeof requestIdleCallback !== 'undefined'
        ? requestIdleCallback(tick, { timeout: 500 })
        : setTimeout(tick, 32);
    } else if (_minCorrIdx < Infinity && !_corrTimer) {
      _corrTimer = setTimeout(_applyCorrection, CONFIG.TIMING.HEIGHT_CORRECTION_RATE_MS);
    }
  }
  // kick off
  typeof requestIdleCallback !== 'undefined'
    ? requestIdleCallback(tick, { timeout: 500 })
    : setTimeout(tick, 32);
}
```

---

## 8. Lazy Asset Loading (img/iframe/bg)

### 8.1 ปัญหา

ถ้าโหลด `<img>` ทุกตัวใน dataset 10,000 รายการทันที:
- Network: 10,000 HTTP requests (แม้ browser จะ limit 6/concurrent ก็ใช้เวลานาน)
- Memory: image decode buffer กิน RAM มหาศาล
- Layout: แต่ละรูปที่ load เสร็จ trigger reflow → CLS

### 8.2 โซลูชัน — `assets/js/ure/ure-modules/lazy-assets.js`

ใช้ IntersectionObserver พร้อม rootMargin = buffer zone → โหลดเมื่อ element ใกล้เข้า viewport

```javascript
function createLazyAssets(bufferPx = 600) {
  const margin = `${bufferPx}px`;
  const _io = ObserverFactory.createIO(_onIntersect, {
    rootMargin: `${margin} 0px ${margin} 0px`,
    threshold : 0,
  });

  const _loaded = new WeakSet();   // track ที่โหลดแล้ว (GC-friendly)

  function _onIntersect(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      _io && _io.unobserve(el);     // one-shot
      _loadElement(el);
    }
  }

  // ...
}
```

### 8.3 รูปแบบที่รองรับ

| Pattern | HTML | Lazy action |
|---------|------|-------------|
| Image src | `<img data-src="...">` | `el.src = dataset.src` |
| Image srcset | `<img data-srcset="...">` | `el.srcset = dataset.srcset` |
| Iframe | `<iframe data-src="...">` | `el.src = dataset.src` |
| Background image | `<div data-bg="...">` | `el.style.backgroundImage = url(...)` |

### 8.4 CLS Prevention — aspect-ratio injection

เมื่อรูป load เสร็จขนาดจะเปลี่ยน → layout shift (CLS) เพื่อกัน: ใส่ `aspect-ratio` จาก width/height attrs ตั้งแต่ตอน register:

```javascript
function _injectAspectRatio(img) {
  const w = img.getAttribute('width');
  const h = img.getAttribute('height');
  if (w && h && !img.style.aspectRatio) {
    img.style.aspectRatio = `${w} / ${h}`;
  }
}
```

Template authors ต้องใส่ width/height attrs เสมอ:

```html
<!-- ✅ Correct — aspect-ratio will be injected -->
<img data-src="/img/emoji.png" width="64" height="64">

<!-- ❌ Wrong — no CLS prevention -->
<img data-src="/img/emoji.png">
```

### 8.5 Loading States (CSS classes)

```javascript
if (tag === 'IMG') {
  // ...
  el.decoding = 'async';                          // non-blocking decode
  el.setAttribute('loading', 'lazy');             // native lazy hint
  el.classList.add('ure-img-loading');
  el.addEventListener('load', () => {
    el.classList.remove('ure-img-loading');
    el.classList.add('ure-img-loaded');
  }, { once: true, passive: true });
  el.addEventListener('error', () => {
    el.classList.remove('ure-img-loading');
    el.classList.add('ure-img-error');
  }, { once: true, passive: true });
}
```

CSS ใน `ure.css`:

```css
img.ure-img-loading {
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: ure-shimmer 1.4s linear infinite;
}

img.ure-img-loaded { animation: none; }
img.ure-img-error  { background: #ffeaea; border: 1px solid #f5c6c6; }

@media (prefers-reduced-motion: no-preference) {
  img.ure-img-loading { animation: ure-shimmer 1.4s linear infinite; }
}
```

### 8.6 Integration ใน URE Lifecycle

LazyAssets ผูกเข้ากับ URE's `onVisible` / `onHidden` callbacks:

```javascript
// ใน engine.js
function _onVisible(item, el) {
  lazy.observe(el);                          // register lazy elements
  if (onVisible) try { onVisible(item, el); } catch (_) {}
}
```

เมื่อ node ถูก recycle `pool.release()` จะ `innerHTML = ''` ทำให้ child elements (รวม img) ถูก GC และ WeakSet entry `_loaded` ก็หายไปด้วย

### 8.7 loadAll() — Print Mode

```javascript
loadAll(container) {
  if (!container) return;
  for (const el of container.querySelectorAll('img[data-src],img[data-srcset],iframe[data-src],[data-bg]')) {
    _loadElement(el);
  }
}
```

โหลดทุกอย่างทันที — ใช้สำหรับ print mode ที่จะพิมพ์ทุก item (ไม่ใช่แค่ที่ visible)

### 8.8 Nav-Core ก็มี Native Lazy

`assets/js/nav-core-modules/performance.js` — PerformanceService.init():

```javascript
// Lazy-load images (prefer native loading="lazy")
if ('loading' in HTMLImageElement.prototype) {
  document.querySelectorAll('img:not([loading])').forEach(i => { i.loading = 'lazy'; });
}
document.querySelectorAll('img[loading="lazy"]').forEach(img => {
  if (!img.hasAttribute('fetchpriority')) img.setAttribute('fetchpriority', 'low');
});
```

ใช้ native `loading="lazy"` ของ browser (ไม่ใช้ JS) สำหรับรูปทั่วไปในหน้า พร้อม `fetchpriority="low"` เพื่อไม่แย่ network กับ critical resources

---

## 9. CSS Containment & Content Visibility

### 9.1 CSS Containment — `ure.css`

ใช้ `contain` เพื่อจำกัดการ layout/paint ให้อยู่ใน subtree เดียว เมื่อ item หนึ่งเปลี่ยน browser ไม่ต้อง reflow ทั้ง page

```css
/* Container — เก็บทุกอย่างไว้ใน stacking context เดียว */
[data-ure-container] {
  position: relative;
  isolation: isolate;        /* new stacking context */
  overflow: hidden;
  overflow-anchor: none;     /* disable browser anchor — URE ทำเอง */
  scroll-behavior: auto;     /* กัน CSS smooth-scroll สู้กับ scrollBy() */
}

/* Spacer — size change ไม่กระทบ ancestor */
.ure-spacer {
  position: relative;
  width: 100%;
  min-height: 2px;
  contain: layout style;
  overflow-anchor: none;
}

/* Visible items — isolated paint/layout boundary */
.ure-visible {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  contain: layout style paint;   /* ★ strongest containment */
  will-change: transform;        /* GPU layer hint */
  overflow-anchor: none;
}

/* Remove compositing hint once settled (จะถูก toggle โดย JS) */
.ure-visible.ure-settled {
  will-change: auto;
}
```

### 9.2 Containment Levels

| `contain` value | Isolates |
|----------------|----------|
| `layout` | Layout changes inside don't affect outside |
| `style` | Style counters/scope isolation |
| `paint` | Children don't draw outside bounds |
| `size` | Element size doesn't depend on children (⚠️ ต้อง set size เอง) |
| `strict` | layout + style + paint + size |
| `content` | layout + style + paint (ไม่มี size) |

URE ใช้ `contain: layout style paint` (เทียบเท่า `content`) สำหรับ visible items เพราะต้องการให้ children กำหนด size ของ wrapper ได้ (height measurement)

### 9.3 will-change Strategy

```css
.ure-visible { will-change: transform; }
.ure-visible.ure-settled { will-change: auto; }
```

- `will-change: transform` → browser สร้าง GPU layer ล่วงหน้า ทำให้ transform เร็ว
- แต่ถ้าปล่อยไว้ทุก item จะกิน memory มาก (layer ต่อ item)
- หลัง item "settled" (หยุด animation/correction) จะ toggle class เป็น `ure-settled` → `will-change: auto` → browser คืน layer

Toggle logic ใน virtual-list.js:

```javascript
// หลัง scroll หยุด 100ms — flush pending settled
if (_pendingSettled.size > 0) {
  Scheduler.schedule(() => {
    for (const el of _pendingSettled) {
      if (_vis.has(_elIdx.get(el) ?? -1)) el.classList.add(CONFIG.DOM.SETTLED_CLASS);
    }
    _pendingSettled.clear();
  }, 'vl-settled-flush');
}
```

### 9.4 content-visibility: auto

```css
.ure-group {
  content-visibility: auto;             /* skip rendering นอก viewport */
  contain-intrinsic-size: auto 260px;   /* estimated size เพื่อกัน scrollbar jump */
  contain: layout style;
}
```

`content-visibility: auto` เป็น CSS property ที่ทำให้ browser **skip layout/paint ของ element ที่ไม่อยู่ใน viewport** โดยอัตโนมัติ ใช้สำหรับ `.ure-group` ที่เป็น section/grouping element (ไม่ใช่ตัว virtual items เอง เพราะ URE มี virtual scroll อยู่แล้ว)

`contain-intrinsic-size: auto 260px` — บอก browser ว่า element นี้มีขนาดประมาณ 260px ไม่งั้น browser จะถือว่า size = 0 และ scrollbar จะกระโดด

### 9.5 prefers-reduced-motion

```css
@media (prefers-reduced-motion: reduce) {
  .ure-visible,
  .ure-img-loading {
    animation: none !important;
    transition: none !important;
    will-change: auto !important;
  }
}
```

ผู้ใช้ที่ตั้งค่า OS เป็น reduce motion จะไม่เห็น shimmer animation และจะไม่โดน push GPU layer (ลด memory)

### 9.6 Nav-Core Sticky Sub-Nav CSS

`assets/js/nav-core-modules/performance.js` — ScrollService._injectStyles():

```javascript
s.textContent = `
header{position:relative;z-index:${hz};contain:layout style;}
#sub-nav{position:sticky;top:0;left:0;right:0;z-index:${this._Z};}
#sub-nav.fx{background:rgba(255,255,255,1);border-bottom:0.5px solid rgba(19,180,127,0.18);border-radius:0 0 47px 47px;}
`;
```

`contain: layout style` บน `<header>` ป้องกัน sticky sub-nav จากการ trigger ancestor reflow

### 9.7 Loading System (FVL) ก็ใช้ Containment

`assets/js/loading-system/fvl.js` — overlay ใช้ `contain: strict` เพื่อ isolate เป็นเลเยอร์:

```css
.fvl-overlay { contain: strict; }
```

ดูรายละเอียดใน [07-Loading-System-FVL](./07-Loading-System-FVL.md) §3.3

---

## 10. requestIdleCallback & RAF Batching

### 10.1 Scheduler — `assets/js/ure/ure-modules/scheduler.js`

Centralised task scheduler ที่แยก visual work (rAF) จาก background work (rIC):

```javascript
const Scheduler = {
  _rafId      : null,
  _idleId     : null,
  _visualQueue: [],   // tasks for this rAF frame
  _idleQueue  : [],   // tasks for idle time

  schedule(fn, name = 'task') {
    this._visualQueue.push({ fn, name });
    this._requestFrame();
  },

  scheduleIdle(fn, name = 'idle-task') {
    this._idleQueue.push({ fn, name });
    this._requestIdle();
  },
  // ...
};
```

### 10.2 rAF Pump — Visual Tasks

```javascript
_requestFrame() {
  if (this._rafId) return;
  this._rafId = requestAnimationFrame(() => this._flushVisual());
}

_flushVisual() {
  this._rafId = null;
  // Drain queue FIFO; tasks that re-schedule go to NEXT frame, not current
  const batch = this._visualQueue.splice(0);
  for (const { fn, name } of batch) {
    try { fn(); }
    catch (e) { console.error(`[URE/Scheduler] visual task "${name}" failed:`, e); }
  }
  if (this._visualQueue.length) this._requestFrame();
}
```

**สำคัญ**: tasks ที่ re-schedule ในระหว่าง flush จะไป frame ถัดไป ไม่ใช่ frame ปัจจุบัน → กัน infinite loop + กัน frame budget overflow

### 10.3 rIC Pump — Idle Tasks

```javascript
_requestIdle() {
  if (this._idleId) return;
  if (typeof requestIdleCallback === 'function') {
    this._idleId = requestIdleCallback(
      dl => this._flushIdle(dl),
      { timeout: CONFIG.TIMING.IDLE_CALLBACK_TIMEOUT_MS }   // 300ms
    );
  } else {
    this._idleId = setTimeout(() => this._flushIdle(null), 50);
  }
}

_flushIdle(deadline) {
  this._idleId = null;
  while (this._idleQueue.length) {
    // Stop if idle slice exhausted
    if (deadline && deadline.timeRemaining && deadline.timeRemaining() < 2) break;
    const { fn, name } = this._idleQueue.shift();
    try { fn(); }
    catch (e) { console.error(`[URE/Scheduler] idle task "${name}" failed:`, e); }
  }
  if (this._idleQueue.length) this._requestIdle();
}
```

Deadline-aware: ถ้า `timeRemaining() < 2ms` จะหยุดแล้ว re-schedule ใน idle slice ถัดไป

### 10.4 MessageChannel Yield (faster than setTimeout(0))

```javascript
const _mc = (() => {
  try {
    const { port1, port2 } = new MessageChannel();
    let _res = null;
    port1.onmessage = () => { if (_res) { const r = _res; _res = null; r(); } };
    return { yield: () => new Promise(r => { _res = r; port2.postMessage(null); }) };
  } catch (_) {
    return { yield: () => new Promise(r => setTimeout(r, 0)) };
  }
})();
```

ใช้ `MessageChannel` แทน `setTimeout(0)` เพราะ:
- `setTimeout(0)` ถูก clamp ที่ 4ms หลัง 5 nested calls
- `MessageChannel` ไม่ถูก clamp → yield เร็วกว่า

### 10.5 scheduler.yield() (modern browsers)

```javascript
yield() {
  if (typeof scheduler !== 'undefined' && scheduler.yield) return scheduler.yield();
  return _mc.yield();
}
```

ใช้ `scheduler.yield()` (Scheduler API) ถ้า browser รองรับ ไม่งั้น fallback ไป MessageChannel

### 10.6 processBatched — chunk large array

```javascript
async processBatched(items, processFn, chunkSize) {
  for (let i = 0; i < items.length; i++) {
    processFn(items[i], i);
    if ((i + 1) % chunkSize === 0) await this.yield();
  }
}
```

แบ่ง array ออกเป็น chunks แล้ว yield ระหว่าง chunk กัน long task ที่ block input

### 10.7 cancel() — cancel all pending

```javascript
cancel() {
  if (this._rafId) { cancelAnimationFrame(this._rafId);  this._rafId  = null; }
  if (this._idleId) {
    if (typeof cancelIdleCallback === 'function') cancelIdleCallback(this._idleId);
    else clearTimeout(this._idleId);
    this._idleId = null;
  }
  this._visualQueue = [];
  this._idleQueue   = [];
}
```

ใช้ตอน destroy instance เพื่อกัน task ทำงานหลัง instance ตายไปแล้ว

### 10.8 การใช้งานใน virtual-list.js

ทุกการ render ผ่าน Scheduler เพื่อรวมเป็น single paint per frame:

```javascript
mount() {
  // ...
  Scheduler.schedule(_render, 'vl-initial');
}

_onScroll() {
  // ...
  if (_scrollRAF) return;
  _scrollRAF = requestAnimationFrame(() => { _scrollRAF = null; _render(); });
}

setItems(newItems) {
  // ...
  Scheduler.schedule(_render, 'vl-set-items');
}

// หลัง scroll หยุด
Scheduler.schedule(() => {
  for (const el of _pendingSettled) {
    if (_vis.has(_elIdx.get(el) ?? -1)) el.classList.add(CONFIG.DOM.SETTLED_CLASS);
  }
  _pendingSettled.clear();
}, 'vl-settled-flush');
```

### 10.9 Pre-render Cache ใช้ rIC

```javascript
function _schedulePreRender(si, ei) {
  if (_preRafId) return;
  const vel = _vel, goingFwd = vel >= 0, half = Math.ceil(_PRE_CAP / 2);
  const aheadS = goingFwd ? ei + 1 : Math.max(0, si - _PRE_CAP);
  const aheadE = goingFwd ? Math.min(_items.length - 1, ei + _PRE_CAP) : si - 1;
  const behinS = goingFwd ? Math.max(0, si - half) : ei + 1;
  const behinE = goingFwd ? si - 1 : Math.min(_items.length - 1, ei + half);

  const doIdle = typeof requestIdleCallback !== 'undefined'
    ? fn => { _preRafId = requestIdleCallback(fn, { timeout: 300 }); }
    : fn => { _preRafId = setTimeout(fn, 50); };

  doIdle(dl => {
    _preRafId = null;
    const hasTime = dl?.timeRemaining ? () => dl.timeRemaining() > 1 : () => true;
    const cache = (s, e) => {
      for (let i = s; i <= e && hasTime(); i++) {
        if (_vis.has(i) || _preCache.has(i) || !_items[i]) continue;
        if (_preCache.size >= _PRE_CAP) return;
        _preCache.set(i, _renderWithCache(_items[i], i));
      }
    };
    cache(Math.min(aheadS, aheadE), Math.max(aheadS, aheadE));
    cache(Math.min(behinS, behinE), Math.max(behinS, behinE));
  });
}
```

Pre-render ทิศทาง scroll ล่วงหน้า ในเวลาว่าง พร้อม velocity-aware (ข้างหน้าหรือข้างหลังตามทิศ scroll)

### 10.10 Nav-Core RAF Sticky Nav

`assets/js/nav-core-modules/performance.js`:

```javascript
window.addEventListener('scroll', () => {
  if (this._ticking) return;
  this._ticking = true;
  requestAnimationFrame(() => {
    try { this._tick(); } catch (_) {}
    this._ticking = false;
  });
}, { passive: true });
```

Single passive scroll listener + RAF coalesce — `ticking` flag กันงานซ้อน

---

## 11. DocumentFragment & Batch DOM Operations

### 11.1 ปัญหา

ถ้า mount 30 items ทีละตัวด้วย `appendChild()` จะ trigger reflow 30 ครั้ง → ช้ามาก

### 11.2 โซลูชัน — DocumentFragment

```javascript
// ใน virtual-list.js _render()
const frag = document.createDocumentFragment();

for (let i = vsi; i <= vei; i++) {
  if (_vis.has(i)) continue;
  _mountNode(i, frag, ...);   // _mountNode ทำ frag.appendChild(el)
}

let bufMounts = 0;
for (let i = si; i <= ei; i++) {
  if (_vis.has(i)) continue;
  if (bufMounts >= _MOUNT_CAP) {
    if (!_scrollRAF) _scrollRAF = requestAnimationFrame(() => { _scrollRAF = null; _render(); });
    break;
  }
  _mountNode(i, frag, false, -1);
  bufMounts++;
}

if (frag.hasChildNodes()) _spacer.appendChild(frag);   // ★ SINGLE reflow
```

DocumentFragment ไม่ได้เป็น element จริง — เมื่อ append ไปที่ parent มันจะ "เท" children เข้าไปทั้งหมดใน operation เดียว

### 11.3 _mountNode — ทำงานกับ fragment

```javascript
function _mountNode(i, frag, applyStagger, staggerIndex) {
  const el = pool ? pool.acquire(_getType(i)) : document.createElement('div');
  el.className = CONFIG.DOM.VISIBLE_CLASS;
  el.style.cssText = _isGrid
    ? `position:absolute;top:0;left:0;width:${_itemW}px;contain:layout style paint;transform:${_gridTransform(i)};`
    : `${_ax.itemBase}transform:${_ax.translate(_off[i])};`;
  el.setAttribute(CONFIG.DOM.ITEM_ATTR, i);
  el.innerHTML = _preCache.get(i) ?? _renderWithCache(_items[i], i);
  _preCache.delete(i);   // consume pre-cache

  frag.appendChild(el);
  _vis.set(i, el);
  _elIdx.set(el, i);
  if (_cardRO && !_measured[i]) _cardRO.observe(el);
  if (onVisible) try { onVisible(_items[i], el); } catch (_) {}
}
```

### 11.4 Single reflow vs N reflows

| Approach | Reflows | Time (100 items) |
|----------|---------|-------------------|
| `appendChild` ทีละตัว | 100 | ~50ms |
| `DocumentFragment` + 1 append | 1 | ~2ms |

### 11.5 Batch Recycle ด้วย Array

เมื่อ recycle nodes ก็ทำเป็น batch:

```javascript
const toRecycle = [];
for (const [idx, el] of _vis) {
  if (idx < si || idx > ei) toRecycle.push([idx, el]);
}
for (const [idx, el] of toRecycle) {
  _vis.delete(idx); _elIdx.delete(el);
  if (_cardRO) _cardRO.unobserve(el);
  if (onHidden) try { onHidden(_items[idx]); } catch (_) {}
  _pendingSettled.delete(el);
  if (pool) pool.release(el, _getType(idx));
  else if (el.parentNode) el.parentNode.removeChild(el);
}
```

ทำเป็น 2-phase: collect ก่อน (ไม่ mutate ระหว่าง iterate) แล้วค่อย release — กัน iterator invalidation

### 11.6 Delegated Event Handler

แทนที่จะ bind click handler บนทุก item (ซึ่งกิน memory + ช้าตอน mount) ใช้ delegated handler บน container:

```javascript
// ใน engine.js
if (onItemClick) {
  container.addEventListener('click', (e) => {
    const itemEl = e.target.closest(`[${CONFIG.DOM.ITEM_ATTR}]`);
    if (!itemEl) return;
    const idx  = parseInt(itemEl.getAttribute(CONFIG.DOM.ITEM_ATTR), 10);
    const item = _currentItems[idx];
    if (item) try { onItemClick(e, item); } catch (_) {}
  }, { passive: true });
}
```

ผล: **1 event listener** ไม่ว่าจะมีกี่ items ใน pool

### 11.7 ResizeObserver — Batch Callbacks

ResizeObserver ส่ง entries หลายตัวใน callback เดียว URE ประมวลผลเป็น batch:

```javascript
function _onCardsResized(entries) {
  let dirty = false;
  for (const entry of entries) {
    const idx = _elIdx.get(entry.target);
    if (idx === undefined) continue;
    const h = _ax.roSize(entry);
    if (h <= 4) continue;
    if (Math.abs(h - _hgt[idx]) > 2) {
      _hgt[idx] = h; _measured[idx] = 0;
      if (idx < _minCorrIdx) _minCorrIdx = idx;
      dirty = true;
    } else if (!_measured[idx]) {
      _measured[idx] = 1;
      _updateTypeAvg(_getType(idx), h);
      if (_cardRO) try { _cardRO.unobserve(entry.target); } catch (_) {}
      if (heightCache && keyExtractor) {
        const key = keyExtractor(_items[idx], idx);
        if (key !== null) heightCache.set(key, h);
      }
      _pendingSettled.add(entry.target);
    }
  }
  if (!dirty || _corrTimer) return;
  // Debounce correction 100ms
  const elapsed = performance.now() - _lastCorr;
  const wait    = elapsed >= CONFIG.TIMING.HEIGHT_CORRECTION_RATE_MS ? 0
                : CONFIG.TIMING.HEIGHT_CORRECTION_RATE_MS - elapsed;
  _corrTimer = setTimeout(_applyCorrection, wait);
}
```

Debounce 100ms (`HEIGHT_CORRECTION_RATE_MS`) — กัน cascade jank เวลาหลาย items resize พร้อมกัน

---

## 12. การวัดประสิทธิภาพ (Profiling)

### 12.1 URE.debug() — Console Stats

```javascript
URE.debug();
```

พิมพ์ `console.table` ของทุก active instance:

| container | items | visible | totalHeight | workerMode | memPressure | tmplCap | poolCap |
|-----------|-------|---------|-------------|------------|-------------|---------|---------|
| search-results | 12,345 | 32 | 1,184,640px | true | COMFORTABLE | 2000 | 60 |
| discover-feed | 8,901 | 28 | 853,520px | false | MODERATE | 800 | 40 |

### 12.2 Instance stats()

```javascript
const handle = URE.mount({ ... });
handle.stats();
// → {
//   vl: {
//     items: 12345,
//     visible: 32,
//     totalSize: 1184640,
//     stable: 12200,        // items ที่วัด height แล้ว
//     unstable: 145,        // items ที่ยังเป็น estimate
//     preCached: 8,         // pre-render cache size
//     tmplCached: 1240,     // template cache size
//     pendingSettled: 0,
//     mountCap: 8,          // per-frame buffer mount cap
//     horizontal: false,
//     isGrid: false,
//     columns: 1, gap: 0,
//     typeAvgCount: 5,      // type-average height entries
//     cachedHeights: 3402,  // sessionStorage height cache size
//     pool: { cap: 60, buckets: { emoji: 12, symbol: 8, ... } },
//     caps: { tmplCap: 2000, preCap: 24, buffer: 600, chunkInitN: 50000 },
//   },
//   worker: { workerMode: true, dataLoaded: true },
//   store: { items: [...], lang: 'th', loading: false, error: null },
//   cache: { heightEntries: 3402, cacheKey: 'search-results_id' },
//   memory: {
//     level: 0, levelName: 'COMFORTABLE',
//     deviceMemGB: 8,
//     heapUsed: 24563200, heapLimit: 4294705152, heapRatio: 0.0057,
//     budgets: { POOL_CAP: 60, TMPL_CACHE_CAP: 2000, ... },
//     listenerCount: 1,
//   },
// }
```

### 12.3 MemoryManager.stats()

```javascript
URE.memoryStats();
// → {
//   level: 0,
//   levelName: 'COMFORTABLE',
//   deviceMemGB: 8,
//   heapUsed: 24563200,
//   heapLimit: 4294705152,
//   heapRatio: 0.0057,
//   budgets: { POOL_CAP: 60, TMPL_CACHE_CAP: 2000, ... },
//   listenerCount: 1,
// }
```

### 12.4 Memory Pressure Forcing

```javascript
// Force re-evaluate ทันที (ใช้หลัง large data load)
URE.memoryCheckpoint();
```

### 12.5 Chrome DevTools Workflow

#### 12.5.1 Performance Tab — Long Tasks

1. เปิด Performance tab → Record
2. Scroll ผ่าน list 10 วินาที
3. Stop → ดู "Main" track หา red blocks (Long Tasks >50ms)
4. ถ้าเห็น long task ใน "Event: scroll" → ตรวจ `_MOUNT_CAP` อาจจะใหญ่เกิน
5. ถ้าเห็น long task ใน "Timer Fired" → ตรวจ `_applyCorrection` debounce

#### 12.5.2 Memory Tab — Heap Snapshots

1. เปิด Memory tab → Take heap snapshot
2. Scroll ผ่าน 10,000 items
3. Take another snapshot
4. Compare → ดู "Detached DOM trees" (ควรเป็น 0 หรือน้อย ถ้า pool ทำงานถูก)
5. ดู `(string)` count — ถ้าเพิ่มเยอะแปลว่า template cache ไม่ trim

#### 12.5.3 Performance Monitor (real-time)

เปิด Command Menu → "Show Performance monitor" → ดู:
- **JS Heap Size** — ควร stable หลัง scroll
- **DOM Nodes** — ควรคงที่ที่ ~30-40 (+ เล็กน้อย)
- **JS event listeners** — ควรน้อย (delegated)
- **GPU Memory** — ถ้าเพิ่มเรื่อย ๆ แปลว่า will-change ไม่ได้ cleanup

### 12.6 Lighthouse Audit

| Metric | เป้าหมาย | วิธีที่ URE ช่วย |
|--------|----------|-------------------|
| FCP (First Contentful Paint) | < 1.8s | Lazy assets ไม่ block first paint |
| LCP (Largest Contentful Paint) | < 2.5s | Buffer 600px ทำให้ hero items render ทันที |
| TBT (Total Blocking Time) | < 200ms | Web Worker + rIC ป้องกัน long tasks |
| CLS (Cumulative Layout Shift) | < 0.1 | aspect-ratio + scroll anchor |
| SI (Speed Index) | < 3.4s | Virtual scroll ลด DOM size |

### 12.7 Web Vitals (runtime)

```javascript
// ตัวอย่าง — สามารถเพิ่มใน GTM/GA
import { onLCP, onCLS, onTBT } from 'web-vitals';

onLCP(console.log);
onCLS(console.log);
onTBT(console.log);
```

---

## 13. Performance Budgets และ Device Tiers

### 13.1 Device Tier Detection — `config.js`

```javascript
const _cores = (navigator && navigator.hardwareConcurrency) || 4;
const _mem   = (navigator && navigator.deviceMemory)        || 4;
const DEVICE_TIER = (_cores <= 2 || _mem <= 1) ? 0 :      // low-end
                    (_cores <= 4 || _mem <= 2) ? 1 : 2;   // mid-range / high-end
```

| Tier | Cores | RAM | ตัวอย่างอุปกรณ์ |
|------|-------|-----|-----------------|
| 0 (low) | ≤ 2 | ≤ 1 GB | Old Android, feature phones |
| 1 (mid) | ≤ 4 | ≤ 2 GB | Mid-range Android, older iPhone |
| 2 (high) | > 4 | > 2 GB | Modern iPhone, flagship Android, desktop |

### 13.2 BATCH — Tier-scaled Chunk Sizes

```javascript
const BATCH = Object.freeze({
  RENDER_CHUNK  : [4,  8,  16][DEVICE_TIER],
  PRELOAD_CHUNK : [8, 16,  32][DEVICE_TIER],
});
```

| Tier | RENDER_CHUNK | PRELOAD_CHUNK |
|------|--------------|---------------|
| 0 | 4 | 8 |
| 1 | 8 | 16 |
| 2 | 16 | 32 |

### 13.3 _MOUNT_CAP ใน virtual-list.js

```javascript
let _MOUNT_CAP = [4, 8, 16][_T];   // _T = device tier สำหรับ instance นี้
let _PRE_CAP   = _MOUNT_CAP * 3;
```

Maximum buffer-zone mounts per rAF frame:
- Tier 0: 4 nodes/frame → ป้องกัน frame budget overflow บน mobile สเปคต่ำ
- Tier 2: 16 nodes/frame → render เยอะขึ้นเพื่อลด blank area บน desktop

### 13.4 Memory Budget Tier (config.js)

```javascript
const MEMORY = Object.freeze({
  POLL_INTERVAL_MS             : 30_000,
  DEVICE_MEMORY_THRESHOLDS_GB  : Object.freeze([4, 2, 1]),
  HEAP_USAGE_THRESHOLDS        : Object.freeze([0.50, 0.70, 0.85]),
  BUDGETS: Object.freeze({
    POOL_CAP         : Object.freeze([60,    40,    20,    8   ]),
    TMPL_CACHE_CAP   : Object.freeze([2_000, 800,   200,   50  ]),
    PRE_CACHE_CAP    : Object.freeze([48,    24,    8,     2   ]),
    HEIGHT_CACHE_MAX : Object.freeze([5_000, 3_000, 1_500, 500 ]),
    WORKER_PERSIST_N : Object.freeze([10_000, 5_000, 2_000, 1_000]),
    CHUNK_INIT_N     : Object.freeze([50_000,30_000,15_000, 5_000]),
    BUFFER_PX        : Object.freeze([600,   400,   200,   100 ]),
    MOUNT_CAP_SCALE  : Object.freeze([1.0,   1.0,   0.75,  0.5 ]),
  }),
});
```

### 13.5 Connection API Awareness — Nav-Core

`assets/js/nav-core-modules/performance.js`:

```javascript
const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
if (conn) {
  const _check = () => {
    window._navCore_slowConnection =
      conn.saveData
      || conn.effectiveType === '2g'
      || conn.effectiveType === 'slow-2g';
  };
  _check();
  conn.addEventListener('change', _check, { passive: true });
}
```

Module อื่น ๆ สามารถเช็ค `window._navCore_slowConnection` เพื่อ:
- ลด preload/prefetch
- ลด image quality
- หน่วง prefetch ของ Fuse.js index

### 13.6 Save-Data Header

`navigator.connection.saveData` เป็น true เมื่อผู้ใช้เปิด "Data Saver" ใน Android → URE จะลด buffer + cache ผ่าน memory pressure pathway (เพราะ device ที่ save data มักเป็น low-end ที่ pressure สูงอยู่แล้ว)

### 13.7 Hard Limits (Sanity Bounds)

| Component | Hard Limit | ที่มา |
|-----------|------------|-------|
| POOL_CAP minimum | 1 | `pool.js` `Math.max(1, cap | 0)` |
| _MOUNT_CAP minimum | 4 | `virtual-list.js` `Math.max(4, ...)` |
| DIFF.FULL_REPLACE_THRESHOLD | 50,000 items | `config.js` — ข้าม diff กระทันหัน |
| CACHE.MAX_ENTRIES | 5,000 | `config.js` — sessionStorage cap |
| PRELOAD_DELAY_MS | 200 | `config.js` — preload debounce |

---

## 14. กฎ/ข้อห้ามด้าน Performance

### 14.1 ห้ามใช้ layout-thrash pattern

❌ **ผิด** — อ่าน layout ระหว่าง write:

```javascript
// แต่ละบรรทัด trigger reflow ก่อน read ถัดไป
for (const item of items) {
  item.el.style.height = '100px';
  const h = item.el.offsetHeight;       // force sync layout!
  item.el.style.marginTop = h + 'px';
}
```

✅ **ถูก** — แยก read จาก write:

```javascript
// Phase 1 — read all
const heights = items.map(item => item.el.offsetHeight);
// Phase 2 — write all
items.forEach((item, i) => {
  item.el.style.height = '100px';
  item.el.style.marginTop = heights[i] + 'px';
});
```

หรือใช้ Scheduler:

```javascript
Scheduler.schedule(() => {
  // write phase
}, 'write-phase');
```

### 14.2 ห้ามเรียก `offsetHeight` / `getBoundingClientRect` ใน scroll handler

ใช้ ResizeObserver แทน — URE วัด height ผ่าน RO callback ไม่ใช่ใน `_onScroll`

### 14.3 ห้ามสร้าง DOM โดยไม่ผ่าน Pool

❌ **ผิด**:

```javascript
// ใน renderFn — สร้าง div ทุกครั้ง
function render(item, lang) {
  const div = document.createElement('div');   // ❌
  div.innerHTML = `...`;
  return div.outerHTML;
}
```

✅ **ถูก** — renderFn คืน string HTML URE จะ assign ให้ innerHTML ของ pooled node:

```javascript
function render(item, lang) {
  return `<div class="card">${item.name[lang]}</div>`;
}
```

### 14.4 ห้าม `position: absolute` โดยไม่ใส่ `contain`

URE items มี `position: absolute` และ URE auto-add `contain: layout style paint` ผ่าน CSS class `ure-visible` — ถ้า override ใน page CSS ต้อง maintain containment ไว้

❌ **ผิด**:

```css
.my-card { position: absolute; contain: none; }  /* ทำลาย containment */
```

### 14.5 ห้ามเปิด `overflow-anchor: auto` บน URE container

```css
/* ❌ ผิด — จะทำให้เกิด double-jump */
[data-ure-container] { overflow-anchor: auto; }
```

URE ใช้ scroll anchor protocol ของตัวเอง (`_captureAnchor` / `_restoreAnchor`) ถ้า browser ก็ทำด้วยจะซ้อนทับกัน

### 14.6 ห้ามเรียก `innerHTML +=`

❌ **ผิด**:

```javascript
el.innerHTML += '<div>more</div>';  // re-parse ทั้งหมด + ทำลาย event listeners
```

✅ **ถูก**:

```javascript
const div = document.createElement('div');
div.innerHTML = 'more';
el.appendChild(div);
// หรือใช้ DocumentFragment สำหรับ batch
```

### 14.7 ห้าม bind event listener บนทุก item

❌ **ผิด**:

```javascript
items.forEach(item => {
  item.el.addEventListener('click', handler);  // 30-40 listeners!
});
```

✅ **ถูก** — delegated handler:

```javascript
container.addEventListener('click', (e) => {
  const itemEl = e.target.closest('[data-ure-key]');
  if (!itemEl) return;
  // handle
});
```

### 14.8 ห้าม override `_MOUNT_CAP` โดยไม่ผ่าน setMemoryBudget

```javascript
// ❌ ผิด — แก้ private field โดยตรง
vl._MOUNT_CAP = 100;
```

```javascript
// ✅ ถูก — ผ่าน budget API
vl.setMemoryBudget({ MOUNT_CAP_SCALE: 2.0 });
```

### 14.9 ห้าม sync filter/sort บน dataset ใหญ่

❌ **ผิด**:

```javascript
// block main thread นานมาก
const filtered = myItems.filter(item => item.category === 'emoji');
ureHandle.setData(filtered);
```

✅ **ถูก** — ผ่าน Worker:

```javascript
await ureHandle.filter([{ field: 'category', op: 'eq', value: 'emoji' }]);
```

### 14.10 ห้ามลืม destroy instance

```javascript
// ❌ ผิด — leak listeners + observers
window.addEventListener('languageChange', handler);
// ไม่มี cleanup
```

```javascript
// ✅ ถูก — URE จัดการให้ผ่าน handle.destroy()
const handle = URE.mount({ ... });
// ...
handle.destroy();   // ล้าง listener, observer, worker, pool
```

### 14.11 ห้ามเปลี่ยน `CACHE.VERSION` โดยไม่จำเป็น

`sessionStorage` height cache ใช้ version check — bump version จะ invalidate cache ทั้งหมด → scroll jump ตอน mount ใหม่ทุกครั้ง

bump version เฉพาะเมื่อ:
- เปลี่ยน schema ของ item
- เปลี่ยน CSS ที่กระทบ height อย่างมาก
- พบ bug ที่ทำให้ height cache เสีย

### 14.12 ห้ามใช้ `transform: translateZ(0)` เพื่อ force GPU layer

URE ใช้ `will-change: transform` แทน — `will-change` ให้ browser heuristics ตัดสินใจว่าควรสร้าง layer จริงไหม ถ้าใช้ `translateZ(0)` จะ force layer เสมอ → memory waste

```css
/* ❌ ผิด */
.ure-visible { transform: translateZ(0); }

/* ✅ ถูก (URE ทำไว้แล้ว) */
.ure-visible { will-change: transform; }
.ure-visible.ure-settled { will-change: auto; }
```

---

## 15. อ้างอิงข้ามเอกสาร

เอกสารที่เกี่ยวข้องใน `fantrove-docs/`:

| เอกสาร | ความเชื่อมโยง |
|--------|----------------|
| [00-System-Architecture](./00-system-architecture.md) | §7 Performance Architecture — ตารางสรุปเทคนิคทั้งหมดที่ cross-cut ทุกระบบ |
| [01-URE-Universal-Render-Engine](./01-URE-Universal-Render-Engine.md) | §3.3 memory.js, §3.4 scheduler.js, §3.5 pool.js, §3.9 worker.js, §3.10 lazy-assets.js, §3.11 virtual-list.js, §3.12 engine.js — รายละเอียด module ที่ใช้เทคนิคในเอกสารนี้ |
| [02-Search-System](./02-Search-System.md) | ระบบ Search ใช้ URE เป็น virtual scroll engine — `search-modules/rendering.js` reuse URE instance ข้ามการค้นหา |
| [03-Nav-Core-System](./03-Nav-Core-System.md) | `nav-core-modules/performance.js` — ScrollService RAF sticky nav + PerformanceService native lazy img + Connection API |
| [04-Language-i18n-System](./04-Language-i18n-System.md) | Language System ใช้ Web Worker แยกสำหรับ translation; `languageChange` event trigger URE re-render |
| [05-ConData-Service](./05-ConData-Service.md) | Data provider — chunk size ของ `loadChunked()` อิง `LARGE_DATASET.INIT_CHUNK_SIZE` |
| [07-Loading-System-FVL](./07-Loading-System-FVL.md) | §3.3 Lightweight Techniques — FVL ใช้ CSS animations + `contain: strict` + composite-only properties |

### ไฟล์ซอร์สโค้ดที่อ้างถึง

| ไฟล์ | บทบาท |
|------|-------|
| `assets/js/ure/ure.js` | Entry point — โหลด modules + auto-inject CSS |
| `assets/js/ure/ure.css` | Structural CSS — containment, will-change, content-visibility |
| `assets/js/ure/ure-modules/config.js` | Constants — RENDER, MEMORY, BUDGETS, TIMING, DEVICE_TIER, BATCH |
| `assets/js/ure/ure-modules/memory.js` | MemoryManager singleton — 4 pressure levels + budget propagation |
| `assets/js/ure/ure-modules/scheduler.js` | rAF + rIC batching + MessageChannel yield |
| `assets/js/ure/ure-modules/pool.js` | DOM node recycling — dynamic cap drain |
| `assets/js/ure/ure-modules/observer.js` | IO/RO/MO factory — centralized error handling |
| `assets/js/ure/ure-modules/diffing.js` | O(n+m) data diffing + 50K full-replace threshold |
| `assets/js/ure/ure-modules/state.js` | Reactive state store — per-instance |
| `assets/js/ure/ure-modules/worker.js` | Web Worker bridge — persistent data + sync fallback |
| `assets/js/ure/ure-modules/lazy-assets.js` | Lazy img/iframe/bg + CLS prevention |
| `assets/js/ure/ure-modules/virtual-list.js` | Core virtual scroll engine — typed arrays + caches + anchor protocol |
| `assets/js/ure/ure-modules/engine.js` | Orchestrator — mount, memory pressure handler, persistence |
| `assets/js/nav-core-modules/performance.js` | ScrollService + PerformanceService (sticky nav, native lazy, Connection API) |
| `assets/js/search-modules/virtual-scroll.js` | Legacy virtual scroll (comment memory model ยังอ้างอิง) |
| `assets/js/search-modules/rendering.js` | URE-backed rendering — single instance reuse |
| `assets/js/loading-system/fvl.js` | FVL — CSS animations only, `contain: strict`, prefers-reduced-motion |

---

> **สรุป**: ประสิทธิภาพของ Fantrove ไม่ใช่เทคนิคเดียว แต่เป็นการซ้อนทับกัน 6 ชั้น (Layer 1–6) ที่ออกแบบมาทำงานร่วมกัน — Virtual Scrolling ลด DOM size, Pooling ลด GC, Adaptive Memory ปรับตามอุปกรณ์, Worker ย้ายงานออกจาก main thread, Scheduler รวมเป็น paint เดียว, CSS Containment จำกัด layout scope เมื่อแก้ปัญหา performance ใหม่ ให้เริ่มจากการวัดก่อน (§12) แล้วค่อยเลือกเลเยอร์ที่จะ optimize
