# 07 — Loading System (FVL — FantroveVerse Loader)

> เอกสารนี้อธิบายระบบ **FVL (FantroveVerse Loader)** ของ Fantrove — ระบบ loading ส่วนกลางที่แยกออกมาจาก Nav-Core เดิม ออกแบบมาเพื่อให้ทุก loading indicator ทั่วทั้งเว็บมีคุณภาพระดับเดียวกันและยืดหยุ่นพอที่จะแสดงได้ในทุกบริบท — ตั้งแต่ overlay เต็มหน้าจอ ไปจนถึง spinner เล็ก ๆ ในปุ่ม
>
> **สำหรับ:** AI และนักพัฒนาที่จะแก้ FVL หรือเรียกใช้ loading indicator ในโค้ดใหม่
>
> **ไฟล์หลัก:** `assets/js/loading-system/fvl.js` (single-file: entry + 9 inline sections, 1 HTTP request) + `assets/css/loading-system.css` (auto-injected)
>
> **Namespace:** `window.FVL` (public API, frozen) + `window.FVLModules` (internal, inline)
>
> **เวอร์ชัน:** v1.0.0

---

## สารบัญ

1. [Overview](#1-overview)
2. [ไฟล์และโครงสร้าง](#2-ไฟล์และโครงสร้าง)
3. [Public API](#3-public-api)
4. [Display Modes (4 แบบ)](#4-display-modes-4-แบบ)
5. [Z-index Layers](#5-z-index-layers)
6. [Backward Compatibility](#6-backward-compatibility)
7. [Events](#7-events)
8. [Accessibility](#8-accessibility)
9. [Performance](#9-performance)
10. [Integration กับระบบอื่น](#10-integration-กับระบบอื่น)
11. [อ้างอิงข้ามเอกสาร](#11-อ้างอิงข้ามเอกสาร)

---

## 1. Overview

FVL (FantroveVerse Loader) คือระบบ loading ส่วนกลางของ Fantrove ที่แยกออกมาจาก Nav-Core เดิม ออกแบบมาเพื่อให้ **ทุก loading indicator ทั่วทั้งเว็บมีคุณภาพระดับเดียวกัน** และยืดหยุ่นพอที่จะแสดงได้ในทุกบริบท — ตั้งแต่ overlay เต็มหน้าจอ ไปจนถึง spinner เล็กๆ ในปุ่ม

### หลักการออกแบบ

- **Lightweight เป็นอันดับ 1**: ไฟล์ JS เดียว (~9KB unminified), ไฟล์ CSS เดียว (~4KB unminified), zero dependencies, ทำงานลื่นไหลบนอุปกรณ์สเปคต่ำ→สูง
- **4 display modes**: `fullscreen` / `scoped` / `inline` / `topbar` — ใช้ API เดียว (`FVL.show()`)
- **Zero coupling กับระบบอื่น**: ทำงานได้เลยโดยไม่ต้องมี URE, NavCore, Search หรือ Language System
- **Full backward-compat**: API เดิมของ Nav-Core (`LoadingService.show/hide`, `window.showInstantLoadingOverlay`, `window._navCore_contentLoadingManager` ฯลฯ) ทำงานเหมือนเดิมผ่าน proxy อัตโนมัติ
- **ใช้ Fantrove Design Tokens**: สี/เงา/รัศมี ดึงจาก `tokens.css` ทั้งหมด
- **รองรับ i18n**: รับ `lang` option หรืออ่านจาก `localStorage.selectedLang` อัตโนมัติ
- **Accessibility first**: `role="status"`, `aria-live="polite"`, `prefers-reduced-motion`
- **Performance-focused**: CSS animations (ไม่ใช้ JS-driven), `contain: strict`, composite-only properties (transform/opacity), lazy DOM creation

---

## 2. ไฟล์และโครงสร้าง

```
assets/
├── js/
│   └── loading-system/
│       └── fvl.js                          ← Entry + internal modules (single file)
└── css/
    └── loading-system.css                  ← Auto-injected by fvl.js

loading-demo/
└── index.html                              ← Demo page (all 4 modes + stats)

assets/js/nav-core-modules/
└── loading.js                              ← Thin proxy (delegates to FVL)

fantrove-docs/
└── 07-Loading-System.md                ← This document
```

---

## 3. Architecture — Hybrid (single-file multi-module)

FVL ใช้สถาปัตยกรรม **Hybrid** ที่ออกแบบมาเพื่อความเบาที่สุด: **ไฟล์ JS เดียว**ที่บรรจุ internal modules ทั้งหมด โดยใช้ IIFE pattern เดียวกับ URE/Popup แต่ไม่ต้องโหลด sub-modules แยกไฟล์ → HTTP request เดียว

### 3.1 Internal Module Sections (ในไฟล์เดียว)

```
fvl.js
├── SECTION 1:  Namespace              (window.FVLModules)
├── SECTION 2:  types                  (JSDoc typedefs — no runtime code)
├── SECTION 3:  config                 (CONFIG: constants, presets, z-index, timing)
├── SECTION 4:  utils                  (DOM helpers, option merging, lang, autoTheme)
├── SECTION 5:  state                  (instance registry, group registry, events)
├── SECTION 6:  renderer               (DOM builders for 4 modes)
├── SECTION 7:  animator               (enter/exit animations — double-rAF)
├── SECTION 8:  engine                 (orchestrator + lifecycle)
├── SECTION 9:  compat                 (backward-compat proxy)
└── SECTION 10: init                   (creates frozen window.FVL global)
```

### 3.2 Pattern

```javascript
(function() {
  'use strict';
  if (window.FVL && window.FVL._initialized) return;

  var M = window.FVLModules = window.FVLModules || {};

  // SECTION: config
  var CONFIG = Object.freeze({ ... });
  M.CONFIG = CONFIG;

  // SECTION: utils
  var Utils = (function() {
    // ... helpers ...
    return Object.freeze({ ... });
  })();
  M.Utils = Utils;

  // ... etc ...

  // SECTION: init — public API
  window.FVL = Object.freeze({ ... });
})();
```

### 3.3 Lightweight Techniques

| เทคนิค | รายละเอียด |
|--------|------------|
| **Single HTTP request** | 1 JS file, 1 CSS file (auto-injected) |
| **Lazy DOM creation** | DOM สร้างตอน `show()` ไม่ใช่ตอน init |
| **CSS animations only** | ไม่ใช้ JS-driven animation → main thread ว่าง |
| **Composite-only properties** | `transform` / `opacity` เท่านั้น → GPU accelerated |
| **`contain: strict`** | บน overlay layers → isolation = better perf |
| **`will-change` scoped** | ใส่เฉพาะตอน active transition |
| **No Web Worker** | overkill สำหรับ loading indicator |
| **No polyfills** | modern browsers only |
| **ResizeObserver lazy** | สร้างต่อเมื่อมี fullscreen mode ใช้งาน |
| **prefers-reduced-motion** | ปิด animation อัตโนมัติ |

---

## 4. 4 Display Modes

### 4.1 Mode comparison

| Mode | Use case | Size | Position | Overlay | Z-index |
|------|----------|------|----------|---------|---------|
| **fullscreen** | เปลี่ยนหน้า, โหลดข้อมูลใหญ่ | 68px spinner | Fixed below header | ทั้ง viewport | 17000 |
| **scoped** | loading ใน card/section เฉพาะ | 40px spinner | Absolute in target | ครอบ target เท่านั้น | 1600 |
| **inline** | spinner ในปุ่ม/element | 18px spinner | Inline (in flow) | ไม่มี | 0 |
| **topbar** | navigation ระหว่างหน้า | 3px bar | Fixed at top | ไม่มี | 17500 |

### 4.2 Visual: Ring spinner (shared)

ทุก mode ใช้ SVG ring spinner ตัวเดียวกัน ปรับขนาดผ่าน CSS:

```html
<svg viewBox="0 0 52 52">
  <circle class="fvl-track" cx="26" cy="26" r="22"/>  <!-- static track -->
  <circle class="fvl-arc"   cx="26" cy="26" r="22"/>  <!-- spinning arc -->
</svg>
```

- `stroke-dasharray: 88 132` → ส่วนโค้ง 1/3 ของวงกลม
- `animation: _fvl_spin 0.8s linear infinite`
- สีดึงจาก `--fvl-spinner-track` และ `--fvl-spinner-arc` (theme-aware)

---

## 5. Public API — `window.FVL`

### 5.1 `FVL.show(opts)` → `FVLHandle | null`

API หลัก — แสดง loader ตาม options ที่ส่งเข้ามา

```javascript
// Shorthand string → fullscreen with message
FVL.show('Loading...');

// Object form
const handle = FVL.show({
  mode: 'fullscreen',           // 'fullscreen'|'scoped'|'inline'|'topbar'
  message: 'กำลังโหลด...',
  subMessage: '',               // fullscreen only — defaults to EN translation
  lang: 'th',                   // auto-detected if omitted
  visual: 'ring',               // currently only 'ring'
  size: 68,                     // override spinner size (px)
  theme: 'light',               // 'light'|'dark'|'brand'|'auto'
  target: '#my-card',           // required for scoped/inline modes
  progress: 0.5,                // topbar only — 0..1 (omit = indeterminate)
  overlay: true,                // scoped — show backdrop
  lockScroll: false,            // fullscreen — lock page scroll
  zIndex: 17000,                // override z-index
  autoHideAfterMs: 4000,        // auto-hide timer
  replaceContent: false,        // inline — replace target's content entirely
  persistent: false,            // cannot be dismissed via API shortcuts
  group: 'my-group',            // only one loader per group at a time
  id: 'my-id',                  // auto-generated if omitted
  onMount: (rootEl, handle) => {},
  onShow: (id, handle) => {},
  onHide: (id) => {},
});
```

### 5.2 Mode shortcuts

```javascript
FVL.fullscreen('Loading...');                              // shorthand
FVL.fullscreen({ message: '...', autoHideAfterMs: 5000 });

FVL.scoped({ target: '#card', message: 'Fetching...' });

FVL.inline({ target: '#btn' });
FVL.inline({ target: '#btn', replaceContent: true, message: 'Working...' });

FVL.topbar();                                               // indeterminate
FVL.topbar({ progress: 0.5 });                              // determinate
```

### 5.3 FVLHandle methods

```javascript
const handle = FVL.show(...);

handle.id              // string — unique ID
handle.mode            // 'fullscreen'|'scoped'|'inline'|'topbar'
handle.options         // resolved options object
handle.element         // root HTMLElement

handle.hide();                                        // returns Promise<void>
handle.update({ message: 'Almost done' });            // merge options
handle.setMessage('New message');                     // shortcut
handle.setProgress(0.9);                              // topbar only
handle.getState();                                    // 'showing'|'shown'|'hiding'|'hidden'
handle.on('hidden', () => {});                        // instance events
```

### 5.4 Static methods

```javascript
FVL.hide(id?)                  // hide by ID (defaults to fullscreen singleton)
FVL.hideAll()                  // hide all active loaders (Promise<void>)
FVL.hideByGroup('my-group')    // hide loader in a group
FVL.update(id, opts)           // update options on live loader
FVL.get(id)                    // get handle for existing loader
FVL.isActive(id)               // boolean — is loader currently shown?
FVL.on('shown', (d) => {})     // system event subscription
FVL.off('shown', fn)           // unsubscribe
FVL.stats()                    // { active, modes: {...}, instances: [...] }
FVL.modules()                  // internal FVLModules namespace
FVL.config()                   // CONFIG object
```

### 5.5 System events

```javascript
FVL.on('showing', (d) => {});   // { id, mode }
FVL.on('shown',   (d) => {});   // { id, mode }
FVL.on('hiding',  (d) => {});   // { id, mode }
FVL.on('hidden',  (d) => {});   // { id, mode }
FVL.on('updated', (d) => {});   // { id, mode }
FVL.on('destroy', (d) => {});   // { id }
```

Native DOM events ก็มี: `window.addEventListener('fvl:shown', ...)`

---

## 6. Theme System

FVL รองรับ 4 themes ผ่าน `[data-fvl-theme]` attribute:

| Theme | พื้นหลัง | Spinner track | Spinner arc | Use case |
|-------|---------|---------------|-------------|----------|
| `light` (default) | ขาว | #e8f5ef | teal-light | พื้นหลังสว่าง |
| `dark` | #1a1d23 | #2a2d33 | teal-light | พื้นหลังเข้ม |
| `brand` | teal | rgba(white,.18) | ขาว | branded splash |
| `auto` | (depends) | (depends) | (depends) | auto-detect จาก target bg luminance |

### Theme tokens (CSS variables)

```css
.fvl[data-fvl-theme="..."] {
  --fvl-bg:            ...;  /* overlay background */
  --fvl-text:          ...;  /* primary text color */
  --fvl-text-sub:      ...;  /* subtitle text */
  --fvl-spinner-track: ...;  /* static ring */
  --fvl-spinner-arc:   ...;  /* spinning arc */
  --fvl-overlay-bg:    ...;  /* scoped overlay */
  --fvl-topbar-bg:     ...;  /* topbar bar color */
}
```

---

## 7. Z-Index Stacking

| Mode | Base Z | Notes |
|------|--------|-------|
| `inline` | 0 | participates in normal flow |
| `scoped` | 1600 | absolute inside target container |
| `fullscreen` | 17000 | matches `--fv-z-overlay` (back-compat with clp-overlay) |
| `topbar` | 17500 | above fullscreen overlay |

Override ได้ผ่าน `zIndex` option.

---

## 8. i18n

FVL มี built-in message map สำหรับ loading text:

```javascript
// config.js
MESSAGES: Object.freeze({
  en: { loading: 'Loading...' },
  th: { loading: 'กำลังโหลด...' },
  ja: { loading: '読み込み中...' },
  zh: { loading: '加载中...' },
})
```

**วิธีเพิ่มภาษา**: เพิ่ม key ใน `MESSAGES` — ไม่ต้องแก้ที่อื่น

**Fallback chain**: `requested lang` → `en` → `first key in map` → `'Loading...'`

### Dual-language display (fullscreen only)

เมื่อ `lang !== 'en'`, FVL แสดง message หลักในภาษาที่เลือก และ subtitle เป็นภาษาอังกฤษ (ยกเว้นถ้า `subMessage` ถูก override)

```
┌─────────────────┐
│                 │
│      ◜          │  ← spinner
│                 │
│  กำลังโหลด...    │  ← .fvl-msg (active lang)
│  Loading...     │  ← .fvl-sub (English, hidden if active lang = en)
│                 │
└─────────────────┘
```

---

## 9. Backward Compatibility (Full Proxy)

FVL ติดตั้ง compat layer อัตโนมัติตอน `fvl:ready` — ทำให้ code เดิมของ Nav-Core ทำงานได้โดยไม่ต้องแก้:

### 9.1 Global aliases (auto-installed)

| Alias | Maps to |
|-------|---------|
| `window.showInstantLoadingOverlay(opts)` | `FVL.fullscreen(opts)` |
| `window.removeInstantLoadingOverlay()` | `FVL.hide('fvl-default-fullscreen')` |
| `window.__removeInstantLoadingOverlay()` | `FVL.hide('fvl-default-fullscreen')` |
| `window._navCore_contentLoadingManager` | proxy object |
| `window._headerV2_contentLoadingManager` | proxy object |
| `window.NavCoreModules.LoadingService` | proxy object (if NavCoreModules exists) |

### 9.2 Nav-Core LoadingService proxy

`assets/js/nav-core-modules/loading.js` ถูกแปลงเป็น thin proxy ที่ forward ทุก call ไปยัง FVL fullscreen mode:

```javascript
// เหล่านี้ทำงานเหมือนเดิม:
NavCoreModules.LoadingService.show();
NavCoreModules.LoadingService.hide();
NavCoreModules.LoadingService.updateMessage('...');
NavCoreModules.LoadingService.isShown();
NavCoreModules.LoadingService._updateTopVar();
NavCoreModules.LoadingService._setTexts();
NavCoreModules.LoadingService._getEl();
NavCoreModules.LoadingService.showInContent(opts);
NavCoreModules.LoadingService.hideFromContent();
```

### 9.3 Singleton ID strategy

FVL ใช้ `fvl-default-fullscreen` เป็น stable singleton ID สำหรับ fullscreen mode ที่ไม่ระบุ ID → ทำให้ `FVL.show()` ซ้อนกันหลายครั้งไม่สร้าง instance ใหม่ แต่อัปเดตตัวเดิม (idempotent show)

---

## 10. CSS Architecture

`loading-system.css` ใช้:

- **CSS `@layer fvl`** เพื่อ isolate styles จากระบบอื่น
- **CSS custom properties** จาก `tokens.css` (`--fv-brand-*`, `--fv-radius-*`, `--fv-shadow-*`, `--fv-font-*`)
- **Theme tokens** ของ FVL เอง (`--fvl-bg`, `--fvl-text`, `--fvl-spinner-*` ฯลฯ)
- **`contain: strict`** บน overlay layers เพื่อ isolation
- **`will-change`** ใส่เฉพาะตอน active transition
- **`prefers-reduced-motion: reduce`** → disable all animations
- **Responsive** — spinner sizes ปรับตาม mode ไม่ต้อง media query

### 10.1 Animation states

```css
.fvl.fvl-entering { opacity: 0; will-change: opacity; }
.fvl.fvl-shown    { opacity: 1; transition: opacity 140ms ease; }
.fvl.fvl-leaving  { opacity: 0; transition: opacity 180ms ease; pointer-events: none; }
```

Topbar มี states เฉพาะ (slide vertical แทน fade):
```css
.fvl-topbar.fvl-entering { transform: translateY(-100%); }
.fvl-topbar.fvl-shown    { transform: translateY(0); }
.fvl-topbar.fvl-leaving  { transform: translateY(-100%); }
```

---

## 11. วิธีเพิ่มในหน้าเว็บ

เพิ่ม `<script defer>` ใน `<body>` ของทุกหน้าที่ต้องการใช้ FVL:

```html
<script defer src="/assets/js/loading-system/fvl.js?v=1.0.0"></script>
```

ระบบจะ **auto-inject** `loading-system.css` เอง — ไม่ต้องเพิ่ม `<link>` แยก (แต่ถ้ามี `<link>` อยู่แล้ว FVL จะข้ามการ inject ไม่ซ้ำซ้อน)

> หน้าที่ใช้ Nav-Core อยู่แล้วไม่ต้องเพิ่มอะไร — FVL จะถูก load อัตโนมัติเมื่อ `loading.js` proxy ถูกเรียกครั้งแรก (lazy load)

---

## 12. ตัวอย่างการใช้งานจริง

### 12.1 Fullscreen ตอนเปลี่ยนหน้า

```javascript
async function navigateToCategory(catId) {
  FVL.fullscreen({ message: 'Loading category...' });
  try {
    const data = await fetchCategory(catId);
    renderCategory(data);
  } finally {
    FVL.hide();
  }
}
```

### 12.2 Scoped ในการ์ดเฉพาะ

```javascript
async function loadCardContent(cardEl) {
  const h = FVL.scoped({
    target: cardEl,
    message: 'Fetching...',
  });
  try {
    const data = await fetchData(cardEl.dataset.id);
    cardEl.innerHTML = renderContent(data);
  } finally {
    h.hide();
  }
}
```

### 12.3 Inline ในปุ่ม submit

```javascript
document.getElementById('submitBtn').addEventListener('click', async function() {
  const h = FVL.inline({ target: this });
  try {
    await submitForm();
    FVL.topbar({ progress: 1 });
    setTimeout(() => FVL.hide(), 500);
  } catch (err) {
    h.hide();
    showError(err);
  }
});
```

### 12.4 Topbar พร้อม progress

```javascript
async function uploadFile(file) {
  const h = FVL.topbar({ progress: 0 });

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        h.setProgress(e.loaded / e.total);
      }
    };
    xhr.onload = () => {
      h.setProgress(1);
      setTimeout(() => { h.hide(); resolve(xhr.response); }, 300);
    };
    xhr.onerror = () => { h.hide(); reject(new Error('Upload failed')); };
    xhr.send(file);
  });
}
```

### 12.5 Backward-compat (Nav-Core เดิม)

```javascript
// code เดิมใน nav-core ยังทำงานได้ — FVL proxy รับไว้หมด
window.showInstantLoadingOverlay('Loading...');   // → FVL.fullscreen()
setTimeout(() => window.removeInstantLoadingOverlay(), 2000);

// หรือเรียกผ่าน NavCoreModules ตามเดิม
NavCoreModules.LoadingService.show();
NavCoreModules.LoadingService.hide();
```

---

## 13. Integration กับระบบอื่น

### 13.1 ปัจจุบัน (หลัง migrate)

| ระบบ | วิธีใช้ FVL |
|------|------------|
| **Nav-Core** | ผ่าน `LoadingService` proxy (auto-forwarded ไป FVL fullscreen) |
| **Discover page** | `LoadingService.show()` → `FVL.fullscreen()` (เหมือนเดิม) |
| **Router transitions** | `LoadingService.show()` / `.hide()` (เหมือนเดิม) |

### 13.2 แนะนำสำหรับระบบใหม่

| ระบบ | วิธีใช้ |
|------|--------|
| **Search** | `FVL.scoped({ target: '#results' })` ขณะ filter |
| **Popup** | `FVL.inline({ target: btn })` บนปุ่มใน popup ขณะ async action |
| **Home** | `FVL.topbar()` ขณะโหลด carousel |
| **Settings** | `FVL.scoped({ target: panel })` ขณะ save |

---

## 14. Version History

| เวอร์ชัน | การเปลี่ยนแปลง |
|-----------|---------------|
| **v1.0.0** | เปิดตัว — 4 modes (fullscreen/scoped/inline/topbar), full backward-compat กับ Nav-Core LoadingService, single-file hybrid architecture, 1 CSS file auto-inject |

---

## 15. Performance Benchmarks

| Metric | Value |
|--------|-------|
| Initial JS size (unminified) | ~9 KB |
| Initial JS size (minified, est.) | ~4 KB |
| Initial JS size (gzip, est.) | ~1.8 KB |
| Initial CSS size (unminified) | ~4 KB |
| Initial CSS size (minified, est.) | ~2.5 KB |
| HTTP requests on first load | 2 (1 JS + 1 CSS) |
| Dependencies | 0 |
| Time to interactive (est. mobile 3G) | < 50ms |
| Animation FPS (mid-range mobile) | 60 FPS (CSS-only) |
| Memory per instance | ~2 KB |

---

> **เอกสารฉบับนี้สร้างขึ้นเพื่อให้ AI หรือนักพัฒนาสามารถเข้าใจระบบ FVL ทั้งหมดได้จากเอกสารฉบับเดียว — โดยไม่ต้องอ่าน source code โดยตรง**

---

## 11. อ้างอิงข้ามเอกสาร

- [`00-System-Architecture.md`](./00-System-Architecture.md) — ภาพรวมสถาปัตยกรรมทั้งโปรเจกต์
- [`03-Navigation-And-Content.md`](./03-Navigation-And-Content.md) — Nav-Core ที่ `loading.js` เป็น thin proxy ไปยัง FVL
- [`08-Performance-Architecture.md`](./08-Performance-Architecture.md) — เทคนิค performance ที่ใช้ใน FVL (single-file, CSS animations, `contain: strict`)
- [`AI_CODING_GUIDE.md`](./AI_CODING_GUIDE.md) — มาตรฐานโค้ดที่ต้องยึดเมื่อแก้ FVL
- [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) — กฎเหล็กก่อนแตะ FVL
- [`12-SEO-Guide.md`](./12-SEO-Guide.md) — ⭐ SEO considerations (priority สูงสุด) ที่เกี่ยวข้องกับระบบนี้
