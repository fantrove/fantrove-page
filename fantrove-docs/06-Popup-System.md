# 06 — Popup System (Fantrove Popup System)

> เอกสารนี้อธิบายระบบ **Popup System** ของ Fantrove — ระบบ popup ส่วนกลางที่ทุก popup ทั่วทั้งเว็บใช้ร่วมกัน (9 presets, fullscreen, zero coupling กับระบบอื่น)
>
> **สำหรับ:** AI และนักพัฒนาที่จะแก้ Popup System หรือเรียกใช้ popup ในโค้ดใหม่
>
> **ไฟล์หลัก:** `assets/js/popup.js` (entry, sequential loader) + `assets/js/popup-modules/` (12 modules) + `assets/css/popup.css` (auto-injected)
>
> **Namespace:** `window.PopupSystem` (public API, frozen) + `window.PopupModules` (internal)
>
> **เวอร์ชัน:** v1.1.0

---

## สารบัญ

1. [Overview](#1-overview)
2. [ไฟล์และโครงสร้าง](#2-ไฟล์และโครงสร้าง)
3. [Public API](#3-public-api)
4. [Presets (9 ประเภท)](#4-presets-9-ประเภท)
5. [Z-index Layers](#5-z-index-layers)
6. [Queue System](#6-queue-system)
7. [Events](#7-events)
8. [Accessibility](#8-accessibility)
9. [Theme System](#9-theme-system)
10. [Integration กับระบบอื่น](#10-integration-กับระบบอื่น)
11. [อ้างอิงข้ามเอกสาร](#11-อ้างอิงข้ามเอกสาร)

---

## 1. Overview

Popup System คือระบบ popup ส่วนกลางของ Fantrove ที่ออกแบบมาเพื่อให้ **ทุก popup ทั่วทั้งเว็บมีคุณภาพระดับเดียวกัน** สามารถใช้งานได้ง่าย และยืดหยุ่นเหมือนระบบ URE (Universal Render Engine)

### หลักการออกแบบ

- **Unified API**: ทุก popup ทั้ง dialog, alert, confirm, sheet, toast, drawer, tooltip, popover, fullscreen ใช้ API เดียวกัน (`PopupSystem.open()`)
- **Preset System**: แต่ละประเภทมี preset ค่า default ที่ต่างกัน แต่ทุกอย่าง override ได้ per-instance
- **Zero coupling กับระบบอื่น**: ทำงานได้เลยโดยไม่ต้องมี URE, NavCore, Search หรือ Language System
- **ใช้ Fantrove Design Tokens**: สี เงา ขอบ รัศมี ฟอนต์ ทั้งหมดดึงจาก `tokens.css`
- **รองรับ i18n**: รับ `lang` option หรืออ่านจาก `localStorage.selectedLang` อัตโนมัติ
- **Accessibility first**: focus trap, return focus, inert siblings, ARIA roles

---

## 2. ไฟล์และโครงสร้าง

```
assets/
├── js/
│   ├── popup.js                          ← Entry point (IIFE self-loader)
│   └── popup-modules/                    ← 12 sub-modules (load sequentially)
│       ├── types.js                      ← JSDoc typedefs (no runtime code)
│       ├── config.js                     ← Constants, 9 presets, z-index, timing
│       ├── state.js                      ← Instance registry, stack, groups, scroll lock
│       ├── utils.js                      ← DOM helpers, option merging
│       ├── animator.js                   ← Enter/exit animations (double-rAF)
│       ├── queue.js                      ← MAX_CONCURRENT capacity queue
│       ├── renderer.js                   ← DOM structure builder
│       ├── overlay.js                    ← Overlay click, escape key, click-outside
│       ├── theme.js                      ← Light/Dark/Brand theme tokens
│       ├── a11y.js                       ← Focus trap, auto-focus, inert siblings
│       ├── engine.js                     ← Main orchestrator + lifecycle
│       └── init.js                       ← Creates frozen window.PopupSystem
└── css/
    └── popup.css                         ← Auto-injected by popup.js
```

---

## 3. Module Load Order (Dependency Chain)

```
types.js → config.js → state.js → utils.js → animator.js → queue.js
                                                         ↓
renderer.js → overlay.js → theme.js → a11y.js → engine.js → init.js
```

| # | Module | Depends On | Responsibility |
|---|--------|-----------|----------------|
| 1 | `types.js` | — | JSDoc typedefs, namespace init |
| 2 | `config.js` | — | PRESETS (9 types), Z_INDEX, TIMING, EASING, SIZES, DOM tokens |
| 3 | `state.js` | CONFIG | Instance Map, stack array, group registry, scroll lock counter, queue storage, system events |
| 4 | `utils.js` | CONFIG | `mergeOptions()`, `getPreset()`, `DOM.create/query/remove`, `prefersReducedMotion()` |
| 5 | `animator.js` | CONFIG, Utils | `enter()` / `exit()` — double-rAF animation, respects reduced-motion |
| 6 | `queue.js` | CONFIG, State | `enqueueOrOpen()` / `processNext()` — FIFO queue when at max capacity |
| 7 | `renderer.js` | CONFIG, State, Utils | `build()` — creates overlay + root + header/body/footer DOM tree |
| 8 | `overlay.js` | CONFIG, State, Utils | `attachOverlayClick()`, `attachEscapeKey()`, `attachClickOutside()`, `detachAll()` |
| 9 | `theme.js` | — | `apply()` — sets CSS custom properties for light/dark/brand themes |
| 10 | `a11y.js` | CONFIG, Utils | `installFocusTrap()`, `autoFocus()`, `returnFocus()`, `manageInertSiblings()` |
| 11 | `engine.js` | ALL above | `open()`, `close()`, `destroy()`, `alert()`, `confirm()`, `toast()`, `fullscreen()`, `stats()` |
| 12 | `init.js` | Engine, CONFIG | Creates frozen `window.PopupSystem` global, dispatches `fp:ready` event |

---

## 4. Architecture Patterns

### 4.1 IIFE Module Pattern (เหมือน URE)

ทุก sub-module ใช้ pattern เดียวกับ URE:

```javascript
(function(M) {
  'use strict';
  const { CONFIG, State, Utils } = M;  // dependency injection
  // ... module logic ...
  M.ModuleName = Object.freeze({ ... });
})(window.PopupModules = window.PopupModules || {});
```

### 4.2 Self-Loading Entry Point (เหมือน ure.js)

`popup.js` เป็น IIFE ที่โหลด sub-modules ทั้ง 12 ตัวแบบ sequential แล้ว `init.js` สร้าง `window.PopupSystem`:

```javascript
// popup.js สร้าง Promise chain:
// load types.js → then config.js → then state.js → ... → then init.js
```

### 4.3 Scroll Lock Technique (เหมือน Search Overlay)

ใช้เทคนิคเดียวกับ `overlay.js` ของ Search system — body fixed เพื่อป้องกัน layout shift:

```
เปิด: body position:fixed + top:-scrollY → lock
ปิด: body position:'' → scrollTo(savedY) → unlock
```

### 4.4 Double-rAF Animation (เหมือน copyNotification.js)

ใช้ 2 rAF frames ก่อนเริ่ม animation เพื่อให้ browser ได้ paint สถานะเริ่มต้นก่อน:

```javascript
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    // Start animation here
  });
});
```

---

## 5. 9 Popup Presets

| Preset | Size | Position | Overlay | Blocking | Focus Trap | Escape Dismiss |
|--------|------|----------|---------|----------|------------|----------------|
| `dialog` | md | center | ✅ | ✅ | ✅ | ✅ |
| `alert` | sm | center | ✅ | ✅ | ✅ | ❌ |
| `confirm` | sm | center | ✅ | ✅ | ✅ | ✅ |
| `sheet` | md | bottom | ✅ | ❌ | ✅ | ✅ |
| `toast` | md | bottom | ❌ | ❌ | ❌ | ❌ |
| `drawer` | sm | right | ✅ | ❌ | ✅ | ✅ |
| `tooltip` | xs | top | ❌ | ❌ | ❌ | ❌ |
| `popover` | sm | bottom | ❌ | ❌ | ❌ | ✅ |
| `fullscreen` | full | center | ✅ | ✅ | ✅ | ✅ |

---

## 6. Public API — `window.PopupSystem`

### 6.1 `PopupSystem.open(options)` → `Promise<PopupHandle>`

เปิด popup ใหม่ รอ animation เสร็จแล้ว resolve ด้วย handle:

```javascript
const handle = await PopupSystem.open({
  type: 'dialog',
  title: 'Settings',
  body: '<p>Choose your preferences</p>',
  footer: '<button class="fp-btn fp-btn-primary" data-fp-action="save">Save</button>',
  size: 'md',
  theme: 'light',
  glassmorphism: true,
  onOpen: (id, h) => console.log('Opened:', id),
  onClose: (id, result) => console.log('Closed:', result.action),
  onMount: (bodyEl, handle) => {
    bodyEl.querySelector('[data-fp-action="save"]').onclick = () => {
      handle.close({ action: 'save' });
    };
  },
});
```

### 6.2 `PopupSystem.alert(message, opts?)` → `Promise<void>`

```javascript
await PopupSystem.alert('Item copied to clipboard!');
await PopupSystem.alert('เกิดข้อผิดพลาด', { title: 'Error', theme: 'dark' });
```

### 6.3 `PopupSystem.confirm(message, opts?)` → `Promise<boolean>`

```javascript
const ok = await PopupSystem.confirm('Delete this item?');
if (ok) { /* delete */ }

const ok = await PopupSystem.confirm('คุณต้องการลบหรือไม่?', { title: 'ยืนยัน' });
```

ปุ่มรองรับภาษาไทย/อังกฤษอัตโนมัติตาม `selectedLang`

### 6.4 `PopupSystem.toast(content, opts?)` → `Promise<PopupHandle>`

```javascript
await PopupSystem.toast('Changes saved');
await PopupSystem.toast('คัดลอกแล้ว', { position: 'bottom', timeout: 2500 });
await PopupSystem.toast(someHTMLElement, { theme: 'brand' });
```

### 6.5 `PopupSystem.fullscreen(opts?)` → `Promise<PopupHandle>`

เปิด popup เต็มหน้าจอ — ครอบคลุมทั้ง viewport เหมือนหน้าเพจ:

```javascript
const handle = await PopupSystem.fullscreen({
  body: '<p>Full page content here</p>',
  title: 'Search Results',        // null = ซ่อน header
  showHeader: true,                // แสดง/ซ่อน header bar (default: true)
  contentLayout: 'fit',            // 'fit' = body scroll ภายใน, 'stretch' = เต็มความสูง
  hideOnBack: true,                // ปิดเมื่อกดปุ่ม Back ของ browser (default: true)
  theme: 'light',
});

// ปิดด้วย handle
handle.close();
```

**คุณสมบัติเฉพาะ:**
- ขนาด `100vw x 100vh`, position `inset: 0`
- ไม่มี border-radius, shadow, หรือ max-width
- ใช้แอนิเมชัน opacity เท่านั้น (เรียบ ไม่มี scale/translate)
- รองรับ History API — กดปุ่ม Back ของ browser จะปิด popup อัตโนมัติ
- z-index 28000 (สูงสุดในระบบ)
- ไม่สามารถ stack ซ้อนกันได้ (`stackable: false`)

### 6.6 อื่นๆ

```javascript
PopupSystem.close(id, { action: 'manual' });   // ปิด popup ตาม ID
PopupSystem.destroy(id);                         // ทำลายทันที (ไม่มี animation)
PopupSystem.closeAll();                          // ปิดทั้งหมด
PopupSystem.closeByGroup('settings');             // ปิด popup ใน group 'settings'
PopupSystem.stats();                             // { active, queued, stack, instances[] }
PopupSystem.debug();                             // console.table + stats
PopupSystem.on('opened', (detail) => {});        // system event subscription
PopupSystem.modules();                           // internal PopupModules namespace
PopupSystem.config();                            // CONFIG object
```

---

## 7. PopupHandle — API สำหรับควบคุม popup แต่ละตัว

```javascript
const handle = await PopupSystem.open({ ... });

handle.id              // string — unique ID
handle.options         // resolved PopupOptions
handle.element         // root HTMLElement
handle.bodyElement     // body HTMLElement

handle.close({ action: 'save', data: newData });  // ปิดพร้อม result
handle.update({ title: 'New Title' });             // อัปเดต options
handle.setContent('<p>New content</p>');           // เปลี่ยนเนื้อหา
handle.setFooter('...');                          // เปลี่ยน footer
handle.setTitle('New Title');                     // เปลี่ยน title
handle.getState();                                // 'open' | 'closing' | 'closed'
handle.on('close', (e) => {});                    // instance event
handle.destroy();                                 // ทำลายทันที
```

---

## 8. Advanced Options

### 8.1 Grouping — เปิดได้เพียง 1 popup ต่อ group

```javascript
// ทั้งสอง popup ใช้ group เดียวกัน → อันใหม่จะแทนที่อันเก่า
await PopupSystem.open({ type: 'sheet', group: 'nav-menu', body: 'Menu A' });
await PopupSystem.open({ type: 'sheet', group: 'nav-menu', body: 'Menu B' });
// Menu A ถูกปิดอัตโนมัติ
```

### 8.2 Glassmorphism

```javascript
await PopupSystem.open({
  type: 'dialog',
  glassmorphism: true,
  borderless: true,
  body: '<p>Frosted glass effect</p>',
});
```

### 8.3 Themes

```javascript
// Light (default)
await PopupSystem.open({ theme: 'light', ... });

// Dark
await PopupSystem.open({ theme: 'dark', ... });

// Brand (uses Fantrove teal accents)
await PopupSystem.open({ theme: 'brand', ... });
```

### 8.4 Anchored (Tooltip / Popover)

```javascript
const btn = document.querySelector('#myButton');
await PopupSystem.open({
  type: 'popover',
  anchor: '#myButton',
  placement: 'bottom',
  body: '<div>Popup content near the button</div>',
  triggerEl: btn,
});
```

### 8.5 Before-close Guard (unsaved changes)

```javascript
let hasUnsavedChanges = true;

await PopupSystem.open({
  type: 'dialog',
  title: 'Edit Profile',
  body: '...',
  onBeforeClose: (id) => {
    if (hasUnsavedChanges) {
      PopupSystem.confirm('Discard changes?').then(ok => {
        if (ok) hasUnsavedChanges = false;
      });
      return false; // block close
    }
    return true; // allow close
  },
});
```

### 8.6 Auto-close

```javascript
await PopupSystem.toast('Auto-closes in 3s', { timeout: 3000 });
```

### 8.7 Persistent (unclosable)

```javascript
await PopupSystem.open({
  type: 'dialog',
  persistent: true,   // ปิดได้เฉพาะผ่าน handle.close() เท่านั้น
  body: 'Please wait...',
});
```

### 8.8 Custom Variant (CSS class)

```javascript
await PopupSystem.open({
  type: 'dialog',
  variant: 'my-custom-style',   // เพิ่ม class "my-custom-style" ลงไป
  body: '...',
});
```

---

## 9. Z-Index Stacking

| Layer | Base Z | ใช้กับ |
|-------|--------|--------|
| Tooltip | 20000 | tooltip |
| Popover | 21000 | popover |
| Toast | 22000 | toast |
| Drawer | 23000 | drawer |
| Sheet | 24000 | sheet |
| Dialog | 25000 | dialog |
| Alert/Confirm | 26000 | alert, confirm |
| Blocking | 27000 | persistent blocking |
| Fullscreen | 28000 | fullscreen |

Stacked popups (เปิดซ้อนกัน): แต่ละตัวเพิ่ม +100 ตามตำแหน่งใน stack

---

## 10. CSS Architecture

`popup.css` ใช้ CSS custom properties จาก `tokens.css` ทั้งหมด:
- `--fv-brand-teal`, `--fv-shadow-lg`, `--fv-radius-md`, `--fv-transition-fast` ฯลฯ
- Theme tokens ของ popup เอง: `--fp-bg`, `--fp-text`, `--fp-accent`, `--fp-border` ฯลฯ
- สไตล์ responsive สำหรับ mobile (<600px)
- `prefers-reduced-motion: reduce` support
- iOS safe area support (`env(safe-area-inset-bottom)`)

---

## 11. System Events

```javascript
PopupSystem.on('opening', (d) => {});   // เริ่มเปิด
PopupSystem.on('opened', (d) => {});    // เปิดเสร็จ (animation done)
PopupSystem.on('closing', (d) => {});   // เริ่มปิด
PopupSystem.on('closed', (d) => {});    // ปิดเสร็จ
PopupSystem.on('destroyed', (d) => {}); // ถูกทำลาย
PopupSystem.on('queued', (d) => {});    // ถูกเข้าคิว
PopupSystem.on('updated', (d) => {});   // ถูกอัปเดต
```

Native DOM events ก็มี: `window.addEventListener('fp:opened', ...)`

**Integration patterns:**
```javascript
// ตรวจสอบว่า PopupSystem พร้อมใช้งาน
if (window.PopupSystem?._initialized) { ... }

// รอ PopupSystem พร้อม
window.addEventListener('fp:ready', () => { ... }, { once: true });
```


---

## 12. วิธีเพิ่มในหน้าเว็บ

เพิ่ม `<script defer>` ใน `<body>` ของทุกหน้าที่ต้องการใช้ popup:

```html
<script defer src="/assets/js/popup.js?v=1.1.0"></script>
```

ระบบจะ auto-inject `popup.css` และโหลด sub-modules ทั้ง 12 ไฟล์เอง — ไม่ต้องเพิ่ม `<link>` หรือ `<script>` อื่น

---

## 13. ตัวอย่างการใช้งานจริง

### 13.1 Dialog พร้อม action buttons

```javascript
document.getElementById('settingsBtn').addEventListener('click', async function() {
  const handle = await PopupSystem.open({
    type: 'dialog',
    title: 'Settings',
    size: 'lg',
    body: `
      <div style="padding: 8px 0;">
        <label><input type="checkbox" checked> Enable notifications</label><br>
        <label><input type="checkbox"> Dark mode</label>
      </div>
    `,
    footer: `
      <button class="fp-btn fp-btn-secondary" data-fp-action="cancel">Cancel</button>
      <button class="fp-btn fp-btn-primary" data-fp-action="save">Save</button>
    `,
    triggerEl: this,
    onMount: (bodyEl, handle) => {
      const root = bodyEl.closest('[data-fp-root]');
      root.querySelector('[data-fp-action="save"]')?.addEventListener('click', () => {
        handle.close({ action: 'save' });
      });
      root.querySelector('[data-fp-action="cancel"]')?.addEventListener('click', () => {
        handle.close({ action: 'cancel' });
      });
    },
    onClose: (id, result) => {
      if (result.action === 'save') console.log('Settings saved!');
    },
  });
});
```

### 13.2 Bottom Sheet (mobile-style)

```javascript
await PopupSystem.open({
  type: 'sheet',
  title: 'Choose Category',
  body: `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <button class="fp-btn fp-btn-secondary" style="justify-content:flex-start;">😀 Emojis</button>
      <button class="fp-btn fp-btn-secondary" style="justify-content:flex-start;">✦ Symbols</button>
      <button class="fp-btn fp-btn-secondary" style="justify-content:flex-start;">Aa Fancy Text</button>
    </div>
  `,
  onMount: (bodyEl, handle) => {
    bodyEl.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => handle.close({ action: 'select', data: btn.textContent }));
    });
  },
});
```

### 13.3 Drawer (side panel)

```javascript
await PopupSystem.open({
  type: 'drawer',
  position: 'right',
  title: 'Filters',
  body: '<p>Filter controls here...</p>',
});
```

### 13.4 Toast notification

```javascript
// Simple
PopupSystem.toast('Saved successfully');

// With options
PopupSystem.toast('<strong>Item copied!</strong> 🎉', {
  position: 'bottom-right',
  theme: 'brand',
  timeout: 4000,
});
```javascript
PopupSystem.toast('Simple toast');
```

### 13.5 Fullscreen popup

```javascript
// เปิด fullscreen popup แสดงผลลัพธ์การค้นหา
const handle = await PopupSystem.fullscreen({
  body: '<div id="search-results"><!-- dynamic content --></div>',
  title: 'Search Results',
  showHeader: true,
  contentLayout: 'fit',
  theme: 'light',
});

// ปิดเมื่อกด Back บน browser อัตโนมัติ (History API)
handle.close();
```

### 13.6 ใช้ในระบบอื่นของ Fantrove

PopupSystem ถูกใช้งานในหลายส่วนของระบบ:

| ระบบ | วิธีใช้ | รายละเอียด |
|------|----------|------------|
| **version-core.js** | `PopupSystem.open({ type:'dialog', body, group:'update-notification' })` | แสดง popup แจ้งอัพเดทเวอร์ชันใหม่ |
| **lang-modules/ui.js** | `PopupSystem.open({ type:'dialog', body, group:'language-picker' })` | หน้าต่างเลือกภาษา (แทน custom overlay เดิม) |
| **nav-core/utils.js** | `PopupSystem.fullscreen({ body, showHeader:true })` | แสดงข้อผิดพลาดแบบเต็มหน้าจอผ่าน `showErrorFullscreen()` |
| **copyNotification.js** | `PopupSystem.toast(content)` | แจ้งเตือนเมื่อคัดลอกสำเร็จ |

---

## 14. showErrorFullscreen() — Error Display Utility

ฟังก์ชัน `showErrorFullscreen(error, opts)` ถูกกำหนดไว้ใน `nav-core-modules/utils.js` เป็น utility สำหรับแสดงข้อผิดพลาดแบบเต็มหน้าจอผ่าน PopupSystem ใช้โดย Nav-Core system:

```javascript
/**
 * แสดงข้อผิดพลาดแบบ fullscreen popup
 * @param {Error|string} error — ข้อผิดพลาดที่ต้องการแสดง
 * @param {Object} opts — options เพิ่มเติม
 * @param {string} opts.lang — ภาษา ('th'|'en'), default: auto-detect
 */
showErrorFullscreen(error, { lang: 'th' });
```

**คุณสมบัติ:**
- แสดงเป็น fullscreen popup ผ่าน `PopupSystem.fullscreen()`
- รองรับ TH/EN labels อัตโนมัติ
- มีปุ่มคัดลอก error message
- ใช้ inline CSS injection (ไม่ต้องเพิ่ม CSS file)
- ซ่อน header ของ popup (showHeader: false)

---

## 15. Version History

| เวอร์ชัน | การเปลี่ยนแปลง |
|-----------|---------------|
| **v1.0.0** | ระบบฐาน — 8 presets (dialog, alert, confirm, sheet, toast, drawer, tooltip, popover) |
| **v1.1.0** | เพิ่ม **fullscreen** preset, เพิ่ม `PopupSystem.fullscreen()` API, History API back button support, z-index 28000 |

---

> **เอกสารฉบับนี้สร้างขึ้นเพื่อให้ AI หรือนักพัฒนาสามารถเข้าใจระบบ Popup System ทั้งหมดได้จากเอกสารฉบับเดียว — โดยไม่ต้องอ่าน source code โดยตรง**

---

## 11. อ้างอิงข้ามเอกสาร

- [`00-System-Architecture.md`](./00-System-Architecture.md) — ภาพรวมสถาปัตยกรรมทั้งโปรเจกต์
- [`04-Internationalization-And-Build.md`](./04-Internationalization-And-Build.md) — Language System ที่ใช้ PopupSystem ใน `lang-modules/ui.js` v6.0
- [`03-Navigation-And-Content.md`](./03-Navigation-And-Content.md) — Nav-Core ที่ใช้ `PopupSystem.fullscreen()` ใน `utils.js`
- [`11-Release-Notes-System.md`](./11-Release-Notes-System.md) — `version-core.js` ที่ใช้ PopupSystem แสดง popup แจ้งอัปเดต
- [`AI_CODING_GUIDE.md`](./AI_CODING_GUIDE.md) — มาตรฐานโค้ดที่ต้องยึดเมื่อแก้ Popup System
- [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) — กฎเหล็ก (โดยเฉพาะห้ามใช้ `alert()`/`confirm()`/`prompt()` — ใช้ PopupSystem แทน)
- [`12-SEO-Guide.md`](./12-SEO-Guide.md) — ⭐ SEO considerations (priority สูงสุด) ที่เกี่ยวข้องกับระบบนี้
