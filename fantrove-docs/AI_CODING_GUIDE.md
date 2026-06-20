# AI_CODING_GUIDE — มาตรฐานการเขียนโค้ดสำหรับ AI Agents

> เอกสารนี้กำหนดมาตรฐานการเขียนโค้ดที่ AI agent ทุกตัวต้องยึดเมื่อทำงานกับโค้ดเบส Fantrove
>
> **สำหรับ:** AI agents (Claude, GPT, Gemini, etc.) ที่รับ task เขียน/แก้โค้ด
>
> **เป้าหมาย:** ทำให้โค้ดที่ AI เขียนสอดคล้องกับสไตล์เดิมของโค้ดเบส อ่านง่าย ดูแลง่าย และไม่ทำลาย pattern ที่มีอยู่

---

## สารบัญ

1. [หลักการสำคัญ](#1-หลักการสำคัญ)
2. [File Organization](#2-file-organization)
3. [Module Pattern (IIFE)](#3-module-pattern-iife)
4. [Naming Conventions](#4-naming-conventions)
5. [Code Style](#5-code-style)
6. [Comments & Documentation](#6-comments--documentation)
7. [Error Handling](#7-error-handling)
8. [Async Patterns](#8-async-patterns)
9. [DOM Patterns](#9-dom-patterns)
10. [Performance Patterns](#10-performance-patterns)

---

## 1. หลักการสำคัญ

### 1.1 กฎทอง: Match existing style

ก่อนเขียนโค้ดใหม่ อ่านโค้ดเดิมในไฟล์นั้นและไฟล์ใกล้เคียง แล้วทำตามสไตล์เดิม — แม้ว่าจะไม่ตรงกับมาตรฐานสากลก็ตาม

> ความสม่ำเสมอสำคัญกว่าความถูกต้องตามทฤษฎี

### 1.2 กฎเงิน: อย่าประดิษฐ์ล้อใหม่

ก่อนเขียนฟังก์ชันใหม่ ตรวจสอบก่อนว่ามีอยู่แล้วหรือไม่:

- ดู namespace ที่เกี่ยวข้อง (`window.UREModules`, `window.NavCoreModules`, ฯลฯ)
- ดู utility functions ใน `*-modules/utils.js`
- ค้นหาด้วย keyword ที่คาดว่าจะเป็นชื่อฟังก์ชัน

### 1.3 กฎทองแดง: อย่าทำลาย pattern

ถ้าไฟล์ใช้ IIFE pattern — อย่าเพิ่ม ES module syntax
ถ้าไฟล์ใช้ `'use strict'` — อย่าลบทิ้ง
ถ้าไฟล์มี `'use strict'` ทุก module — ทำเหมือนกัน

---

## 2. File Organization

### 2.1 โครงสร้างไฟล์ JS มาตรฐาน

```javascript
/**
 * module-name.js — คำอธิบายสั้น ๆ ว่า module ทำอะไร
 *
 * Part of: {System Name} (e.g., URE, Search, Nav-Core)
 * Namespace: window.{Namespace}
 *
 * Dependencies:
 *   - {other module}.js (must load before this)
 *
 * Public API:
 *   - M.functionName()
 *   - M.constantName
 */

(function(M) {
  'use strict';

  // ── Constants ──────────────────────────────────────────────
  const CONSTANT_NAME = 'value';

  // ── Module State (private) ─────────────────────────────────
  let moduleState = null;

  // ── Private Functions ──────────────────────────────────────
  function privateHelper(arg) {
    // ...
  }

  // ── Public API ─────────────────────────────────────────────
  function publicFunction(arg) {
    // ...
  }

  // ── Exports ────────────────────────────────────────────────
  M.PublicFunction = publicFunction;
  M.CONSTANT_NAME = CONSTANT_NAME;

})(window.SomeNamespace = window.SomeNamespace || {});
```

### 2.2 การวางไฟล์

| ประเภท | ตำแหน่ง | ตัวอย่าง |
|---|---|---|
| Module ของระบบ | `assets/js/{system}-modules/` | `assets/js/ure-modules/pool.js` |
| Entry point ของระบบ | `assets/js/{system}.js` | `assets/js/ure/ure.js` |
| สคริปต์อิสระ | `assets/js/{name}.js` | `assets/js/home.js` |
| Page-specific | `assets/js/{page}.js` | `assets/js/roadmap.js` |
| CSS | `assets/css/{name}.css` | `assets/css/popup.css` |
| Build script | `scripts/{name}.js` | `scripts/build.js` |

### 2.3 การตั้งชื่อไฟล์

- `kebab-case` สำหรับชื่อไฟล์: `nav-core.js`, `con-data-service.js`
- ห้ามใช้ `camelCase` หรือ `snake_case` ในชื่อไฟล์
- ไฟล์เดียวต่อหนึ่ง module — ไม่รวมหลาย module ในไฟล์เดียว

---

## 3. Module Pattern (IIFE)

### 3.1 Pattern มาตรฐาน

```javascript
(function(M) {
  'use strict';
  // code
  M.MyFunction = MyFunction;
})(window.MyNamespace = window.MyNamespace || {});
```

### 3.2 Namespace ที่ใช้

| ระบบ | Namespace |
|---|---|
| URE | `window.UREModules` (internal), `window.URE` (public API) |
| Search | `window.SearchModules` (internal), `window.SearchEngine`/`window.__searchUI` (public) |
| Nav-Core | `window.NavCoreModules` (internal) |
| Language | `window.LangModules` (internal), `window.languageManager` (public) |
| Popup | `window.PopupModules` (internal), `window.PopupSystem` (public) |
| FVL | `window.FVLModules` (internal), `window.FVL` (public) |
| ConData | `window.ConDataService`/`window.ConDataRegistry` |

### 3.3 กฎสำหรับ IIFE

- ทุกไฟล์ต้องมี `'use strict';` เป็นบรรทัดแรกใน IIFE
- Export ผ่าน `M.FunctionName = FunctionName` — ไม่ใช่ `export`
- ห้ามใช้ `import`/`export`
- ห้ามใช้ `require()`

---

## 4. Naming Conventions

### 4.1 Variables & Functions

```javascript
// camelCase สำหรับ variables และ functions
const myVariable = '...';
function calculateTotal() { ... }

// PascalCase สำหรับ constructors และ classes
function UserManager() { ... }

// UPPER_SNAKE_CASE สำหรับ constants
const MAX_POOL_SIZE = 60;
const API_VERSION = 'v1';
```

### 4.2 Private vs Public

```javascript
// private (ไม่ export) — prefix ด้วย _ หรือเรียกใช้ภายใน
function _internalHelper() { ... }

// public (export) — ไม่มี prefix
function publicApi() { ... }
M.PublicApi = publicApi;
```

### 4.3 Constants ในไฟล์

```javascript
// วางไว้บนสุดของ IIFE หลัง 'use strict'
const CONFIG = {
  MAX_ITEMS: 100,
  TIMEOUT_MS: 5000,
  // ...
};

const SINGLETON = null; // mutable state ใช้ let
```

### 4.4 Boolean Variables

```javascript
// ✅ ดี — prefix ด้วย is/has/can/should
const isVisible = true;
const hasPermission = false;
const canEdit = true;
const shouldRefresh = false;

// ❌ ไม่ดี
const visible = true;
const permission = false;
```

### 4.5 Event Handlers

```javascript
// ✅ ดี — prefix ด้วย on หรือ handle
function onButtonClick(event) { ... }
function handleScrollEnd() { ... }

// ❌ ไม่ดี
function clickButton() { ... }
function scrollEnd() { ... }
```

---

## 5. Code Style

### 5.1 Indentation

- ใช้ **2 spaces** เสมอ — ห้ามใช้ tab
- ไม่มี trailing whitespace

### 5.2 Semicolons

- ใช้ semicolon ทุก statement — ไม่ละเว้น

### 5.3 Quotes

- ใช้ **single quotes** `'...'` เป็นหลัก
- ใช้ double quotes `"..."` ใน HTML string ที่ฝังใน JS
- ใช้ backticks ` ` ` ` สำหรับ template literals

```javascript
const name = 'fantrove';
const html = "<div class='button'>";
const greeting = `Hello, ${name}!`;
```

### 5.4 Braces

- เปิด brace บรรทัดเดียวกับ statement (K&R style)
- ใช้ braces เสมอ แม้ single-line if

```javascript
// ✅ ดี
if (condition) {
  doSomething();
}

// ❌ ไม่ดี
if (condition) doSomething();

// ❌ ไม่ดี
if (condition)
  doSomething();
```

### 5.5 Line Length

- จำกัดที่ **120 ตัวอักษร** ต่อบรรทัด
- ถ้าเกิน ให้ break บนหลายบรรทัดตาม logic boundary

### 5.6 Trailing Comma

- ใช้ trailing comma ใน multi-line arrays/objects

```javascript
const arr = [
  'item1',
  'item2',
  'item3',
];

const obj = {
  a: 1,
  b: 2,
  c: 3,
};
```

---

## 6. Comments & Documentation

### 6.1 File Header Comment

ทุกไฟล์ต้องมี header comment อธิบาย:

```javascript
/**
 * module-name.js — คำอธิบายสั้น ๆ ว่า module ทำอะไร
 *
 * Part of: {System Name}
 * Namespace: window.{Namespace}
 *
 * Dependencies:
 *   - {other module}.js
 *
 * Public API:
 *   - M.functionName()
 */
```

### 6.2 Function Comments

ใช้ JSDoc สำหรับ public functions:

```javascript
/**
 * อธิบายว่า function ทำอะไร
 *
 * @param {string} arg1 - คำอธิบาย parameter
 * @param {Object} [options] - optional parameter
 * @param {boolean} [options.flag=false] - default false
 * @returns {Promise<Array>} คำอธิบาย return value
 *
 * @example
 * const result = await myFunction('test', { flag: true });
 */
function myFunction(arg1, options = {}) {
  // ...
}
```

### 6.3 Inline Comments

```javascript
// ✅ ดี — อธิบายทำไม ไม่ใช่อะไร
const result = items.filter(x => x.score > threshold);
// กรองเฉพาะ items ที่ score ผ่าน threshold เพราะ...

// ❌ ไม่ดี — redundant
const result = items.filter(x => x.score > threshold); // กรอง items
```

### 6.4 ห้าม Comment Out Code

```javascript
// ❌ ห้าม — ลบโค้ดทิ้ง อย่า comment ไว้
// function oldFunction() {
//   ...
// }

// ✅ ถูก
// (ลบทิ้งเลย)
```

### 6.5 TODO/FIXME Format

```javascript
// TODO(username): อธิบายสิ่งที่ต้องทำ
// FIXME(username): อธิบาย bug ที่ต้องแก้
// HACK: อธิบายเหตุผลที่ต้อง hack
```

---

## 7. Error Handling

### 7.1 Try-Catch สำหรับ Async

```javascript
async function fetchData(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('[ModuleName] fetch failed:', error);
    return null; // หรือ throw ต่อ แล้วแต่กรณี
  }
}
```

### 7.2 Validation

```javascript
function processItems(items) {
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array');
  }
  // ...
}
```

### 7.3 ห้ามกลืน Error

```javascript
// ❌ ห้าม — กลืน error ทำให้ debug ยาก
try {
  doSomething();
} catch (e) {}

// ✅ ถูก — อย่างน้อย log ไว้
try {
  doSomething();
} catch (e) {
  console.error('[ModuleName] doSomething failed:', e);
}
```

### 7.4 ใช้ PopupSystem สำหรับ User-facing Errors

```javascript
// ❌ ห้าม
alert('Failed to save');
throw new Error('Failed to save'); // ทำให้หน้าพัง

// ✅ ถูก
await PopupSystem.alert('Failed to save. Please try again.');
```

---

## 8. Async Patterns

### 8.1 ใช้ async/await ไม่ใช่ .then()

```javascript
// ✅ ดี
async function loadData() {
  const data = await fetch('/api/data').then(r => r.json());
  return data;
}

// ❌ ไม่ดี (เว้นแต่จำเป็น)
function loadData() {
  return fetch('/api/data')
    .then(r => r.json())
    .then(data => {
      return data;
    });
}
```

### 8.2 ห้ามลืม await

```javascript
// ❌ ห้าม — จะ return Promise ไม่ใช่ value
async function getName() {
  return fetch('/api/name').then(r => r.text());
}
const name = getName(); // name = Promise

// ✅ ถูก
async function getName() {
  return await fetch('/api/name').then(r => r.text());
}
const name = await getName();
```

### 8.3 Promise.all สำหรับ Parallel

```javascript
// ✅ ดี — โหลดขนานกัน
const [users, posts, comments] = await Promise.all([
  fetchUsers(),
  fetchPosts(),
  fetchComments(),
]);

// ❌ ไม่ดี — โหลดทีละอัน ช้า
const users = await fetchUsers();
const posts = await fetchPosts();
const comments = await fetchComments();
```

---

## 9. DOM Patterns

### 9.1 Query Cache

```javascript
// ✅ ดี — cache element ไว้
const submitButton = document.querySelector('#submit');

function handleSubmit() {
  submitButton.disabled = true;
  // ...
}

// ❌ ไม่ดี — query ใหม่ทุกครั้ง
function handleSubmit() {
  document.querySelector('#submit').disabled = true;
}
```

### 9.2 Event Delegation

```javascript
// ✅ ดี — delegate บน parent
listElement.addEventListener('click', (event) => {
  const item = event.target.closest('.item');
  if (!item) return;
  // handle item click
});

// ❌ ไม่ดี — bind ทีละ item
items.forEach(item => {
  item.addEventListener('click', () => {
    // handle
  });
});
```

### 9.3 DocumentFragment สำหรับ Batch Insert

```javascript
// ✅ ดี
const fragment = document.createDocumentFragment();
items.forEach(item => {
  const el = document.createElement('div');
  el.textContent = item.name;
  fragment.appendChild(el);
});
container.appendChild(fragment); // เขียนครั้งเดียว

// ❌ ไม่ดี — เขียนทีละอัน ทำให้ reflow หลายครั้ง
items.forEach(item => {
  const el = document.createElement('div');
  el.textContent = item.name;
  container.appendChild(el); // reflow ทุกครั้ง
});
```

### 9.4 ห้ามใช้ innerHTML กับ User Input

```javascript
// ❌ อันตราย — XSS
el.innerHTML = userInput;

// ✅ ปลอดภัย
el.textContent = userInput;
```

---

## 10. Performance Patterns

### 10.1 requestAnimationFrame สำหรับ Animation

```javascript
// ✅ ดี
function animate() {
  // update
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// ❌ ไม่ดี — ไม่ sync กับ browser repaint
setInterval(() => {
  // update
}, 16);
```

### 10.2 Debounce สำหรับ Input

```javascript
// ✅ ดี — debounce ป้องกัน call บ่อยเกินไป
const debouncedSearch = debounce((query) => {
  doSearch(query);
}, 300);

input.addEventListener('input', (e) => {
  debouncedSearch(e.target.value);
});

// ❌ ไม่ดี — call ทุก keystroke
input.addEventListener('input', (e) => {
  doSearch(e.target.value);
});
```

### 10.3 ห้าม Layout Thrash

```javascript
// ❌ ห้าม — read/write สลับกัน ทำให้ browser ต้อง layout ใหม่ทุกรอบ
elements.forEach(el => {
  const h = el.offsetHeight;  // read
  el.style.height = h + 10 + 'px';  // write
});

// ✅ ถูก — แยก read และ write
const heights = elements.map(el => el.offsetHeight);
elements.forEach((el, i) => {
  el.style.height = heights[i] + 10 + 'px';
});
```

### 10.4 Lazy Load Heavy Resources

```javascript
// ✅ ดี — โหลด Fuse.js เฉพาะเมื่อจะใช้
async function initSearch() {
  if (!window.Fuse) {
    await loadScript('https://cdn.jsdelivr.net/npm/fuse.js@6.6.2');
  }
  // ...
}
```

---

## 11. สรุป

| หลักการ | สรุป |
|---|---|
| Match existing style | อ่านโค้ดเดิมก่อนเขียนใหม่ |
| IIFE pattern | `'use strict'` + `M.X = X` |
| 2 spaces indent | ไม่มี tab |
| Single quotes | `'...'` เป็นหลัก |
| Semicolons | ใส่ทุก statement |
| Braces | ครบทุก block |
| Comments | อธิบายทำไม ไม่ใช่อะไร |
| Errors | อย่ากลืน — log หรือ throw |
| Async | async/await ไม่ใช่ .then() |
| DOM | Cache + delegate + fragment |
| Performance | rAF + debounce + lazy load |

> จำไว้เสมอ: **AI ที่ดีเขียนโค้ดที่อ่านเหมือนคนในทีมเขียน ไม่ใช่โค้ดที่ "สวยตามทฤษฎี"**
