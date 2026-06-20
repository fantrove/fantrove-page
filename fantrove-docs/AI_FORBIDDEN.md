# AI_FORBIDDEN — กฎเหล็กสำหรับ AI Agents

> เอกสารนี้คือ **กฎเหล็ก** ที่ AI agent ทุกตัวต้องปฏิบัติตามเมื่อทำงานกับโค้ดเบส Fantrove
>
> ⚠️ **การละเว้นกฎข้อใดข้อหนึ่งในนี้อาจทำให้เว็บพังได้** — อ่านให้จบก่อนแตะโค้ด
>
> **Priority:** HIGHEST — กฎนี้อยู่เหนือมาตรฐานอื่นทั้งหมด

---

## สารบัญ

1. [ไฟล์ที่ห้ามแก้](#1-ไฟล์ที่ห้ามแก้)
2. [Pattern ที่ห้ามใช้](#2-pattern-ที่ห้ามใช้)
3. [Assumption ที่ผิดบ่อย](#3-assumption-ที่ผิดบ่อย)
4. [กฎเกี่ยวกับ Content](#4-กฎเกี่ยวกับ-content)
5. [กฎเกี่ยวกับภาษา](#5-กฎเกี่ยวกับภาษา)
6. [กฎเกี่ยวกับ Performance](#6-กฎเกี่ยวกับ-performance)
7. [กฎเกี่ยวกับ Build & Deploy](#7-กฎเกี่ยวกับ-build--deploy)
8. [เมื่อไม่แน่ใจ](#8-เมื่อไม่แน่ใจ)

---

## 1. ไฟล์ที่ห้ามแก้

### 1. ห้ามแก้ไฟล์เหล่านี้โดยไม่ได้รับอนุญาต

| ไฟล์ | เหตุผล |
|---|---|
| `assets/db/con-data/index.json` | Registry ของ copyable types — การแก้ผิดทำให้ search และ home พัง |
| `assets/json/buttons.json` | กำหนด nav bar — การแก้ผิดทำให้ routing พัง |
| `assets/lang/options/db.json` | Registry ภาษา — การแก้ผิดทำให้ build พัง |
| `_redirects`, `_headers` | Cloudflare routing & caching — แก้ผิดทำให้เว็บทั้งหมดพัง |
| `scripts/build.js` | Build orchestrator — แก้ผิดทำให้ production พัง |
| `LICENSE`, `NOTICE` | กฎหมาย — ห้ามแก้ |

### 1.2 ไฟล์ที่แก้ได้แต่ต้องระวัง

| ไฟล์ | ข้อควรระวัง |
|---|---|
| `assets/lang/en.json`, `assets/lang/th.json` | ต้องเพิ่ม key ทั้งสองไฟล์พร้อมกัน |
| `assets/md/{en,th}/current.md` | ต้องเขียนทั้งสองภาษาพร้อมกัน ตาม [`RELEASE_NOTES_GUIDE.md`](./RELEASE_NOTES_GUIDE.md) |
| `package.json` | อย่าเพิ่ม dependency โดยไม่จำเป็น — Fantrove ใช้ dependency น้อยมาก |
| `00-System-Architecture.md` | อัปเดตได้แต่ต้องคงโครงสร้างหลักไว้ |

---

## 2. Pattern ที่ห้ามใช้

### 2.1 ห้ามใช้ ES Modules

Fantrove ใช้ **IIFE pattern** ทั้งระบบ ไม่ใช่ ES modules

```javascript
// ❌ ห้าม
import { foo } from './foo.js';
export function bar() { ... }

// ✅ ถูก
(function(M) {
  'use strict';
  function bar() { ... }
  M.Bar = bar;
})(window.SomeNamespace = window.SomeNamespace || {});
```

เหตุผล: Build system ไม่ได้ออกแบบมารองรับ ES modules และการเปลี่ยนทั้งระบบเสี่ยงพัง

### 2.2 ห้ามใช้ Framework (React, Vue, etc.)

Fantrove เป็น vanilla JavaScript ทั้งหมด ห้ามเพิ่ม React, Vue, Svelte, หรือ framework อื่นใด

### 2.3 ห้ามใช้ jQuery

ใช้ vanilla DOM API เท่านั้น

```javascript
// ❌ ห้าม
$('.button').click(...)

// ✅ ถูก
document.querySelector('.button').addEventListener('click', ...)
```

### 2.4 ห้ามใช้ `var`

ใช้ `const` หรือ `let` เท่านั้น

### 2.5 ห้าม mutate global state โดยไม่ได้ประกาศ

```javascript
// ❌ ห้าม — เพิ่ม property เข้าไปใน window โดยไม่ประกาศ
window.myRandomVar = '...';

// ✅ ถูก — ใช้ namespace ที่มีอยู่แล้ว หรือสร้าง namespace ใหม่อย่างชัดเจน
window.FantroveUtils = window.FantroveUtils || {};
window.FantroveUtils.myFeature = '...';
```

### 2.6 ห้ามใช้ `alert()`, `confirm()`, `prompt()`

ใช้ PopupSystem แทน — ดู [`06-Popup-System.md`](./06-Popup-System.md)

```javascript
// ❌ ห้าม
alert('Saved!');
if (confirm('Delete?')) { ... }
const name = prompt('Name:');

// ✅ ถูก
await PopupSystem.toast('Saved!');
const ok = await PopupSystem.confirm('Delete?');
```

### 2.7 ห้าม fetch ไฟล์ที่ build แล้วหายไป

ไฟล์เหล่านี้ถูกลบออกจาก built pages โดย build script:

- `lang-proxy.js`
- `lang-sync.js`
- `lang-coordinator.js`

ห้ามเรียกใช้ในโค้ดที่จะรันบน production

### 2.8 ห้ามใช้ `innerHTML` กับ user input

```javascript
// ❌ อันตราย — XSS
el.innerHTML = userInput;

// ✅ ปลอดภัย
el.textContent = userInput;
```

---

## 3. Assumption ที่ผิดบ่อย

### 3.1 "Fantrove = Fantrove Page"

❌ ผิด — ชื่อโปรเจกต์คือ **Fantrove** (หรือเต็ม: **Fantrove Verse**) ไม่ใช่ "Fantrove Page"

### 3.2 "มี build step ก็เลยใช้ React/Next.js ได้"

❌ ผิด — Build script ใช้ Cheerio สำหรับ static HTML transformation ไม่ใช่ React/Next.js

### 3.3 "Translation ทำงานใน runtime เท่านั้น"

❌ ผิด — มี 2 โหมด:
- **Production (built pages):** Translation ฝังใน HTML แล้ว ไม่ต้องรอ JS
- **Development (localhost):** Translation ทำงานใน runtime ผ่าน `language.js`

### 3.4 "Service worker จัดการ cache ทั้งหมด"

❌ ผิด — Cache ทำงานผ่าน HTTP headers (`_headers`) เป็นหลัก ไม่ใช่ service worker

### 3.5 "เพิ่มภาษาได้โดยเพิ่มไฟล์ JSON"

❌ ผิด — ต้อง:
1. เพิ่มใน `assets/lang/options/db.json`
2. สร้าง `assets/lang/{lang}.json`
3. อัปเดต build script
4. อัปเดต `_redirects` และ `_headers`
5. อัปเดต sitemap generator

### 3.6 "URE เป็น React component"

❌ ผิด — URE เป็น vanilla JS engine ที่ใช้ IIFE pattern

### 3.7 "แก้แล้วรีเฟรชหน้าเว็บเห็นได้เลย"

❌ ผิด — หลายการแก้ต้อง build ก่อน โดยเฉพาะ:
- การเปลี่ยน translation
- การเปลี่ยน HTML structure
- การเปลี่ยน content JSON

รัน `npm run build` แล้วทดสอบใน `dist/`

### 3.8 "Search ค้นหาได้ทุกอย่าง"

❌ ผิด — Search ค้นหาเฉพาะ **copyable** items (emoji, symbol, fancy) ที่อยู่ใน `index.json` เท่านั้น ไม่ค้นหา cards หรือ packages

### 3.9 "popup กับ dialog คือคนละระบบ"

❌ ผิด — ทั้งสองใช้ `PopupSystem` ตัวเดียวกัน ต่างแค่ `type` parameter

### 3.10 "Production branch = main เสมอ"

⚠️ ตรวจสอบใน Cloudflare Pages dashboard ก่อน — ปัจจุบันใช้ `main` แต่อาจเปลี่ยนได้

---

## 4. กฎเกี่ยวกับ Content

### 4.1 ห้ามเขียนข้อมูลดิบใน `content/*.json`

```json
// ❌ ห้าม — content/*.json เป็นใบสั่งงานเท่านั้น
[
  { "api": "U+1F600", "text": "😀", "name": { "en": "Smile" } }
]

// ✅ ถูก — เป็น descriptor
[{ "source": "emoji" }]
```

ดู [`10-Content-Guide.md`](./10-Content-Guide.md) สำหรับรายละเอียด

### 4.2 ห้ามเพิ่ม collection types ลงใน `index.json`

`index.json` เก็บเฉพาะ copyable types (emoji, symbol, fancy) เท่านั้น — ห้ามเพิ่ม cards

### 4.3 ห้ามลบ `api`, `text`, `name` จาก item เดิม

Field เหล่านี้ใช้ใน search index และ favorites — ลบแล้วแตก

### 4.4 ห้ามตั้ง `url` ซ้ำกันใน `buttons.json`

routing พัง

### 4.5 ห้ามใช้ emoji เดียวกันใน 2 subcategory

จะทำให้ duplicates ใน assembled DB และ search แสดงซ้ำ

---

## 5. กฎเกี่ยวกับภาษา

### 5.1 ห้ามใช้ `localStorage.getItem('selectedLang')` โดยตรง

ใช้ `FvLang.lang` แทน — ดู [`11-Whats-New-System.md`](./11-Whats-New-System.md) ส่วน FvLang

### 5.2 ห้ามใช้ `languageChange` event

ใช้ `fv:langchange` แทน (v5.0+)

### 5.3 ห้ามลืมเพิ่ม translation ในทั้ง 2 ภาษา

ถ้าเพิ่ม key ใน `en.json` ต้องเพิ่มใน `th.json` ด้วย — ไม่งั้น fallback จะแสดง key แทนข้อความ

### 5.4 ห้าม hardcode ข้อความใน HTML

ใช้ `data-translate` attribute แล้วเพิ่ม key ใน translation JSON

```html
<!-- ❌ ห้าม -->
<button>Save</button>

<!-- ✅ ถูก -->
<button data-translate="action.save"></button>
```

---

## 6. กฎเกี่ยวกับ Performance

### 6.1 ห้าม query DOM ใน loop

```javascript
// ❌ ห้าม — ช้ามาก
items.forEach(item => {
  document.querySelector(`#item-${item.id}`).textContent = item.name;
});

// ✅ ถูก — query ครั้งเดียว
const elements = document.querySelectorAll('[data-item-id]');
items.forEach((item, i) => {
  elements[i].textContent = item.name;
});
```

### 6.2 ห้าม synchronous layout thrash

```javascript
// ❌ ห้าม — read/write สลับกันไป ทำให้ browser ต้อง layout ใหม่ทุกรอบ
elements.forEach(el => {
  const h = el.offsetHeight;  // read
  el.style.height = h + 10 + 'px';  // write
});

// ✅ ถูก — แยก read และ write เป็น batch
const heights = elements.map(el => el.offsetHeight);  // read all
elements.forEach((el, i) => {
  el.style.height = heights[i] + 10 + 'px';  // write all
});
```

### 6.3 ห้ามสร้าง DOM ใน loop

ใช้ `DocumentFragment` หรือ URE แทน — ดู [`08-Performance-Architecture.md`](./08-Performance-Architecture.md)

### 6.4 ห้ามใช้ `setInterval` สำหรับ animation

ใช้ `requestAnimationFrame` เท่านั้น

### 6.5 ห้าม fetch ข้อมูลที่ไม่จำเป็น

ใช้ lazy loading — โหลดเฉพาะที่จะแสดงผล

---

## 7. กฎเกี่ยวกับ Build & Deploy

### 7.1 ห้าม push ไป `main` โดยตรง

ใช้ branch แยก + PR เสมอ (เว้นแต่ hotfix วิกฤต)

### 7.2 ห้าม deploy โดยไม่ build

หลังแก้ source HTML/translation ต้องรัน `npm run build` ก่อน — production ใช้ไฟล์ใน `dist/`

### 7.3 ห้ามลืม cache-bust

ถ้าแก้ asset ต้องอัปเดต `?v=` query string — build script ทำให้อัตโนมัติ แต่ถ้า manual ต้องจำ

### 7.4 ห้าม ignore `dist/`

`dist/` อยู่ใน `.gitignore` — ห้าม commit ไฟล์ใน `dist/`

---

## 8. เมื่อไม่แน่ใจ

ถ้า AI ไม่แน่ใจว่าสิ่งที่จะทำผิดกฎหรือไม่:

1. **หยุด** — อย่าเดา
2. **อ่านเอกสารที่เกี่ยวข้อง** — ดู [`INDEX.md`](./INDEX.md) ว่าเอกสารไหนเกี่ยวข้อง
3. **ตรวจสอบโค้ดจริง** — ดู source code ในไฟล์ที่จะแก้
4. **ถ้ายังไม่แน่ใจ** — เปิด issue ถาม อย่าเดาแล้วทำ

> การถามดีกว่าการทำผิดแล้วทำให้เว็บพัง
