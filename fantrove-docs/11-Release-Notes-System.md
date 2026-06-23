# 11 — ระบบหน้า "มีอะไรใหม่" (What's New System)

> เอกสารนี้อธิบายระบบ What's New ของ **Fantrove** — ระบบที่แสดง release notes และ popup แจ้งเตือนเมื่อมีเวอร์ชั่นใหม่
>
> **สำหรับ:** นักพัฒนา/AI ที่จะเขียน release notes หรือแก้ระบบแจ้งเตือน
>
> **ไฟล์หลัก:** `assets/js/new.js`, `assets/js/version-core.js`, `assets/lang/core.js`

---

## สารบัญ

1. [ภาพรวมระบบ](#1-ภาพรวมระบบ)
2. [โครงสร้างไฟล์](#2-โครงสร้างไฟล์)
3. [ระบบภาษา FvLang (v5.0)](#3-ระบบภาษา-fvlang-v50)
4. [รูปแบบไฟล์ Markdown](#4-รูปแบบไฟล์-markdown)
5. [ขั้นตอนเมื่ออัปเดตเวอร์ชั่นใหม่](#5-ขั้นตอนเมื่ออัปเดตเวอร์ชั่นใหม่)
6. [ระบบรองรับ backwards compatibility](#6-ระบบรองรับ-backwards-compatibility)
7. [อ้างอิงข้ามเอกสาร](#7-อ้างอิงข้ามเอกสาร)

---

## 1. ภาพรวมระบบ

ระบบ What's New ใช้ Markdown แยกตามภาษาเป็นแหล่งข้อมูล release notes โดยมี build script ที่รวมภาษาและสร้างประวัติจาก git log อัตโนมัติ

ระบบประกอบด้วย 2 ส่วนหลัก:

1. **หน้า What's New** (`/info/whats_new/`) — แสดง release notes ปัจจุบันและประวัติย้อนหลัง
2. **Popup แจ้งเตือน** — popup ที่เด้งขึ้นมาเมื่อผู้ใช้เข้าเว็บครั้งแรกหลังอัปเดต

### 1.1 แผนภาพการทำงาน

```
ผู้พัฒนาเขียน current.md (en + th) — เขียนเฉพาะ version/title/subtitle/sections (ไม่ต้องเขียน date)
        │
        ▼
Git commit & push
        │
        ▼
CI/CD: scripts/update-version.js (v4.1+)
   - โหลด release-dates.json (registry)
   - กำหนด release date ของ version ปัจจุบัน (registry > NOW)
   - sync date: ใน current.md ให้ตรงกับ registry
   - สร้าง releases/v{version}.md จาก current.md (เมื่อ version ใหม่)
   - สร้าง releases/index.json (manifest สำหรับ client)
   - อัปเดต version.json (พร้อม date จาก registry)
   - บันทึก release-dates.json (registry ที่อัปเดตแล้ว)
        │
        ▼
Build: scripts/build.js
   - Copy MD + JSON files ไป dist/
   - Generate static HTML
        │
        ▼
Deploy ขึ้น Cloudflare Pages
        │
        ├── ผู้ใช้เปิดหน้า What's New
        │       └─ new.js อ่าน current.md ตามภาษา + releases/index.json + releases/v{version}.md
        │
        └── ผู้ใช้เข้าหน้าอื่น
                └─ version-core.js เช็ค version.json
                   - ถ้าเวอร์ชั่นใหม่กว่าที่เคยเห็น → แสดง popup
                   - ใช้ PopupSystem.open() แสดง popup
```

---

## 2. โครงสร้างไฟล์

```
assets/md/
  en/
    current.md              ← อัปเดตปัจจุบัน (ภาษาอังกฤษ) — ไฟล์เดียวที่ต้องแก้ (เขียนเฉพาะ version/title/subtitle/sections — ไม่ต้องเขียน date)
    releases/               ← v4.1+: build script สร้างไฟล์ v{version}.md อัตโนมัติเมื่อ bump version ใหม่
  th/
    current.md              ← อัปเดตปัจจุบัน (ภาษาไทย) — ไฟล์เดียวที่ต้องแก้
    releases/               ← v4.1+: build script สร้างไฟล์ v{version}.md อัตโนมัติ
  releases/
    index.json              ← v4.1+: manifest สำหรับ client — list ทุก version + date + hasDetails (commit ลง git)

assets/json/
  release-dates.json       ← v4: registry ของ "วันที่ build ครั้งแรกของแต่ละ version" (commit ลง git)
  version.json             ← สร้างโดย build script (ไม่ commit)
  whats-new.json           ← เก่า — fallback เท่านั้น
  ⚠️ release-history.json   ← ยกเลิกใน v4.1 — ใช้ releases/index.json + releases/v{version}.md แทน

assets/js/
  lang-core.js              ← v5.0: Central Language API (FvLang)
  new.js                    ← หน้า What's New — v4.1+: อ่าน releases/index.json + releases/v{version}.md
  version-core.js           ← Popup แจ้งเตือน — อ่าน MD ตามภาษา, ใช้ PopupSystem.open()
```

> ⚠️ **สำคัญ (v4.1+):** โฟลเดอร์ `releases/` ไม่ใช่ fallback อีกต่อไป — build script สร้างไฟล์ `v{version}.md` อัตโนมัติเมื่อ bump version ใหม่ และสร้าง `index.json` manifest สำหรับ client อ่าน
>
> ผู้ใช้ไม่ต้องสร้างไฟล์ใน `releases/` เอง — ดู [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) section 9

### 2.1 หน้าเว็บที่เกี่ยวข้อง

| หน้า | Path | บทบาท |
|---|---|---|
| What's New | `/info/whats_new/` | หน้าหลักสำหรับดู release notes |
| Settings | `/setting/` | มี link ไป What's New |

### 2.2 ไฟล์ JSON ที่ runtime ใช้

| ไฟล์ | ผู้สร้าง | ผู้ใช้ | เนื้อหา |
|---|---|---|---|
| `assets/md/releases/index.json` | build script (commit ลง git) | `new.js` | `{ versions: [{ version, date, hasDetails }], updatedAt }` — manifest ของ releases/ |
| `assets/md/{lang}/releases/v{version}.md` | build script (commit ลง git) | `new.js` | release notes แยกตาม version (per-language) |
| `assets/json/release-dates.json` | build script (commit ลง git) | `update-version.js` | `{ versions: { "1.9.1": "2026-06-21T...", ... } }` — registry ของ "วันที่ build ครั้งแรกของแต่ละ version" |
| `assets/json/version.json` | build script (ไม่ commit) | `version-core.js` | `{ version, date }` — date เป็น ISO string จาก registry (stable ถ้า version เดิม) |
| `assets/json/whats-new.json` | (deprecated) | `new.js` (fallback) | release notes แบบเก่า |
| ⚠️ `assets/json/release-history.json` | (ยกเลิกใน v4.1) | `new.js` (legacy fallback) | ประวัติ release แบบรวม — ใช้ releases/index.json แทน |

### 2.3 Stable Release Date (v4 — `update-version.js`)

ตั้งแต่ `update-version.js` v4 เป็นต้นไป ระบบบันทึก **"วันที่ build ครั้งแรกของแต่ละ version"** เป็น source of truth ใน `assets/json/release-dates.json`:

- ถ้าอัปเดทเนื้อหาใน `current.md` แต่ **ไม่เปลี่ยน `version:`** → date ใน `current.md`, `version.json`, `releases/index.json` จะ **ไม่เปลี่ยน** (คง date แรกที่บันทึกไว้ใน registry)
- ถ้าเปลี่ยน `version:` เป็นเลขใหม่ → build script จะใช้ **เวลา ณ ตอน build ครั้งแรกของ version นั้น** (`NOW`) เป็น release date และบันทึกลง registry ถาวร
- ถ้าผู้ใช้ manual edit `date:` ใน `current.md` → build script จะ **sync กลับ** เป็นค่าจาก registry เสมอ (เพราะผู้ใช้อาจเขียน date มั่วๆ ที่ไม่ตรงกับเวลา build จริง)

**กฎเหล็ก:**
- 🥇 `release-dates.json` เป็น source of truth — ถ้า conflict กับ `date:` ใน `current.md`, registry ชนะเสมอ
- ⚠️ **ผู้ใช้ไม่ต้องเขียน `date:` ใน `current.md` เอง** — ระบบจะเพิ่ม/อัปเดต date ให้อัตโนมัติจาก registry (หรือ NOW ถ้าเป็น version ใหม่)
- ห้ามแก้ `release-dates.json` เอง — build script ดูแลไฟล์นี้เอง (ดู [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) section 9)
- ไฟล์นี้ commit ลง git เพื่อให้ stable ข้าม CI/CD runs และ developer machines

### 2.4 Folder-Based History (v4.1 — `update-version.js`)

ตั้งแต่ `update-version.js` v4.1 เป็นต้นไป ระบบใช้ **โครงสร้างโฟลเดอร์** สำหรับเก็บประวัติ release แทน `release-history.json`:

```
assets/md/releases/
  index.json              ← manifest สำหรับ client (list ทุก version + date + hasDetails)
assets/md/{lang}/releases/
  v1.9.1.md              ← release notes ของ version 1.9.1 (per-language)
  v1.3.0.md              ← release notes ของ version 1.3.0 (เก่า — สร้างไว้ก่อน v4.1)
  ...
```

**วิธีการทำงาน:**
1. เมื่อ bump version ใหม่ → build script สร้าง `releases/v{version}.md` จาก `current.md` (ทั้ง en + th) — commit ลง git
2. build script สร้าง `releases/index.json` ที่ list ทุก version + date + `hasDetails` (ว่ามีไฟล์ markdown หรือไม่)
3. client (`new.js`) อ่าน `releases/index.json` แล้ว fetch `releases/v{version}.md` สำหรับแต่ละ version ที่ `hasDetails: true`
4. สำหรับ version ที่ `hasDetails: false` (มีใน registry แต่ไม่มีไฟล์ markdown) → client แสดงแค่ version + date (basic record)

**กฎเหล็ก:**
- ผู้ใช้ไม่ต้องสร้างไฟล์ใน `releases/` เอง — build script สร้างให้อัตโนมัติเมื่อ bump version
- ไฟล์ `releases/v{version}.md` และ `releases/index.json` commit ลง git เพื่อเป็น source of truth
- `release-history.json` ยกเลิกใน v4.1 — `new.js` ยังรองรับเป็น legacy fallback สำหรับเว็บที่ยังไม่ได้ bump

---

## 3. ระบบภาษา FvLang (v5.0)

ไฟล์ `lang-core.js` โหลดเป็น script แรกสุดใน `<head>` ก่อน `language.js`

### 3.1 FvLang API

```javascript
window.FvLang.lang              // ภาษาปัจจุบัน ('en' | 'th')
window.FvLang.isReady           // true เสมอ (resolve แบบ sync)
window.FvLang.isStaticMode      // true ถ้าเป็น production built page
window.FvLang.onChange(fn)      // subscribe ภาษาเปลี่ยน → return unsubscribe fn
window.FvLang.setLang(lang)     // ตั้งภาษา + dispatch fv:langchange
window.FvLang.forceRefresh()    // refresh ทั้งหน้าโดยไม่เปลี่ยนภาษา
```

### 3.2 Event

```javascript
window 'fv:langchange'  // → CustomEvent, detail: { lang, previousLang }
```

### 3.3 ลำดับการทำงาน

1. `lang-core.js` อ่านภาษาทันที: `data-fv-built` → URL → localStorage → browser
2. สร้าง `window.FvLang` object + `window.languageReady` Promise (resolved ทันที)
3. `language.js` โหลด อ่าน FvLang → โหลด modules → setup UI
4. ทุก script อื่นใช้ `FvLang.lang` และ `FvLang.onChange()`

### 3.4 ผลกระทบต่อระบบอื่น

| ระบบ | ก่อน v5.0 | v5.0 |
|------|-----------|------|
| `home.js` | `localStorage.getItem('selectedLang')` | `FvLang.lang` + `FvLang.onChange(re-render)` |
| `new.js` | `localStorage.getItem('selectedLang')` + `languageChange` event | `FvLang.lang` + `fv:langchange` event |
| `version-core.js` | `localStorage.getItem('selectedLang')` | `FvLang.lang` |
| `modern-navigation.js` | `_readStoredLang()` + `languageChange` event | `_readStoredLang()` + `fv:langchange` event |
| `language.js` | detect เอง + 14 modules (static) | FvLang ให้ภาษา + 6 modules (static) |

---

## 4. รูปแบบไฟล์ Markdown

แต่ละไฟล์เป็นภาษาเดียว — `title`, `subtitle`, `description` เป็น string ธรรมดา ไม่ต้องมี i18n block

```markdown
---
version: 1.5.0
date: 2025-07-01T12:00:00Z
title: Title in this language only
subtitle: Description in this language only
notify: true
---

### New

- **Feature name**
  Description text in this language.

### Improved

- **Something improved**
  More details.

### Fixed

- **Bug fixed**
  How it was fixed.
```

### 4.1 Frontmatter fields

| field | required | ความหมาย |
|---|---|---|
| `version` | ✅ | เลขเวอร์ชั่น (เช่น `1.5.0`) |
| `date` | ✅ | วันที่ release (ISO 8601) |
| `title` | ✅ | หัวข้อสั้น ๆ |
| `subtitle` | ✅ | คำอธิบายขยาย 1-2 ประโยค |
| `notify` | ☐ | `true` ถ้าต้องการให้ popup แจ้งเตือน |

### 4.2 มาตรฐานการเขียนเนื้อหา

อ่าน [`RELEASE_NOTES_GUIDE.md`](./RELEASE_NOTES_GUIDE.md) สำหรับมาตรฐานการเขียน release notes แบบละเอียด — ครอบคลุม:

- โครงสร้างมาตรฐาน (TL;DR, บริบทระบบ, รายละเอียด, ผลกระทบผู้ใช้)
- หมวดหมู่การเปลี่ยนแปลง (New, Improved, Fixed, Removed)
- คำศัพท์ที่ควรหลีกเลี่ยง vs คำที่ควรใช้
- Template สำเร็จรูป
- Checklist ก่อนตีพิมพ์

---

## 5. ขั้นตอนเมื่ออัปเดตเวอร์ชั่นใหม่

### 5.1 เขียน release note ใหม่ใน `current.md`

แก้ `assets/md/en/current.md` และ `assets/md/th/current.md`:

- เปลี่ยน `version:` เป็นเวอร์ชั่นใหม่
- เขียน `title`, `subtitle`, sections ในแต่ละภาษา
- ปฏิบัติตาม [`RELEASE_NOTES_GUIDE.md`](./RELEASE_NOTES_GUIDE.md)

> ⚠️ **ห้าม copy `current.md` ไป `releases/` เอง** — build script สร้างไฟล์ `releases/v{version}.md` ให้อัตโนมัติเมื่อ bump version (v4.1+)

> ⚠️ **ไม่ต้องเขียน `date:` เอง** — ระบบจะใช้เวลา ณ ตอน build ครั้งแรกของ version นั้นเป็น release date โดยอัตโนมัติ (ดู section 2.3) ถ้าเขียน `date:` เอง ระบบจะ sync กลับเป็นค่าจาก registry เสมอ

### 5.2 Commit & deploy

```bash
git add assets/md/
git commit -m "release: v1.9.1"
git push

# CI/CD:
git fetch --unshallow
APP_VERSION=1.9.1 node scripts/update-version.js
```

### 5.3 Build script ทำอัตโนมัติ

1. **STEP 0** — โหลด `assets/json/release-dates.json` (registry ของ "วันที่ build ครั้งแรกของแต่ละ version")
2. **กำหนด release date ของ version ปัจจุบัน**:
   - ถ้า version มีอยู่แล้วใน registry → ใช้ date เดิม (stable)
   - ถ้า version ใหม่ → ใช้ **`NOW` (เวลา ณ ตอน build ครั้งแรกของ version นี้)** — บันทึกถาวรใน registry
   - ⚠️ ไม่อ่าน `date:` จาก `current.md` เพราะผู้ใช้อาจเขียนมั่วๆ ที่ไม่ตรงกับเวลาจริง
3. **STEP 1** — สร้าง history จาก git log (backfill registry สำหรับ version เก่าที่ยังไม่มี)
4. **STEP 1.7** — สร้าง `releases/v{version}.md` จาก `current.md` (เมื่อ version ใหม่) — commit ลง git
5. **STEP 1.8** — สร้าง `releases/index.json` (manifest สำหรับ client) — commit ลง git
6. **STEP 2** — sync `date:` ใน `current.md` ให้ตรงกับ registry เสมอ (เขียนทับถ้าผู้ใช้เขียนมั่ว)
7. **STEP 3** — สร้าง `version.json` พร้อม `date` จาก registry
8. **STEP 3.5** — บันทึก `release-dates.json` (registry ที่อัปเดตแล้ว) — commit ลง git
9. **STEP 4** — HTML cache busting (เพิ่ม `?v={version}-{dateStr}` ให้ assets)

### 5.4 ตรวจสอบหลัง deploy

- [ ] เปิดหน้า What's New บนเว็บ — ควรแสดง release ใหม่
- [ ] ทดสอบในหน้าต่าง incognito — ถ้า `notify: true` popup ควรเด้ง
- [ ] ตรวจสอบภาษาทั้งสอง — แสดงเนื้อหาเดียวกัน
- [ ] ตรวจสอบ `date` ใน popup และหน้า What's New — ควรเป็น date แรกที่บันทึก (ไม่ใช่ date ล่าสุด)
- [ ] ตรวจสอบว่า `releases/v{version}.md` และ `releases/index.json` ถูก commit ลง git

---

## 6. ระบบรองรับ backwards compatibility

Runtime จะลองอ่าน release notes ตามลำดับ:

| ที่มีอยู่ | ผลลัพธ์ |
|---------|--------|
| `en/current.md` + `th/current.md` | ✅ ใช้ per-language (หลัก) |
| `current.md` เดียว (มี i18n blocks) | ✅ fallback อ่านได้ |
| `whats-new.json` | ✅ fallback อ่านได้ |

ลำดับการ fallback:

```
1. ลองอ่าน /assets/md/{lang}/current.md
        ↓ (ถ้าไม่มี)
2. ลองอ่าน /assets/md/current.md (legacy format)
        ↓ (ถ้าไม่มี)
3. ลองอ่าน /assets/json/whats-new.json (deprecated)
```

---

## 7. อ้างอิงข้ามเอกสาร

- [`RELEASE_NOTES_GUIDE.md`](./RELEASE_NOTES_GUIDE.md) — มาตรฐานการเขียน release notes
- [`04-Internationalization-And-Build.md`](./04-Internationalization-And-Build.md) — ระบบภาษาทั้งหมด (FvLang เป็นส่วนหนึ่ง)
- [`06-Popup-System.md`](./06-Popup-System.md) — PopupSystem ที่ `version-core.js` ใช้
- [`09-Deployment-Guide.md`](./09-Deployment-Guide.md) — Version bumping ใน CI/CD
- [`12-SEO-Guide.md`](./12-SEO-Guide.md) — ⭐ Content freshness ส่งผลต่อ SEO — release notes แสดงให้เห็นว่าเว็บมีการอัปเดตต่อเนื่อง
