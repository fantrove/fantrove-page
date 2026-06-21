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
ผู้พัฒนาเขียน current.md (en + th)
        │
        ▼
Git commit & push
        │
        ▼
CI/CD: scripts/update-version.js
   - อัปเดต version.json
   - สร้าง release-history.json จาก git log
        │
        ▼
Build: scripts/build.js
   - Copy MD files ไป dist/
   - Generate static HTML
        │
        ▼
Deploy ขึ้น Cloudflare Pages
        │
        ├── ผู้ใช้เปิดหน้า What's New
        │       └─ new.js อ่าน current.md ตามภาษา + release-history.json
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
    current.md              ← อัปเดตปัจจุบัน (ภาษาอังกฤษ) — ไฟล์เดียวที่ต้องแก้
    releases/               ← ⚠️ ไม่ต้องเขียนเอง — build script สร้างประวัติจาก git history ของ current.md
  th/
    current.md              ← อัปเดตปัจจุบัน (ภาษาไทย) — ไฟล์เดียวที่ต้องแก้
    releases/               ← ⚠️ ไม่ต้องเขียนเอง — build script สร้างประวัติจาก git history ของ current.md

assets/json/
  release-dates.json         ← สร้าง/อัปเดตโดย build script — registry ของ "วันที่ build ครั้งแรกของแต่ละ version" (commit ลง git เพื่อเป็น source of truth ข้าม CI/CD runs)
  release-history.json       ← สร้างโดย build script (อัตโนมัติ ไม่ต้องแก้ ไม่ commit)
  version.json               ← สร้างโดย build script (อัตโนมัติ ไม่ต้องแก้ ไม่ commit)
  whats-new.json             ← เก่า — fallback เท่านั้น

assets/js/
  lang-core.js              ← v5.0: Central Language API (FvLang)
  new.js                    ← หน้า What's New — อ่าน MD ตามภาษา + history JSON
  version-core.js           ← Popup แจ้งเตือน — อ่าน MD ตามภาษา, ใช้ PopupSystem.open()
```

> ⚠️ **สำคัญ:** โฟลเดอร์ `releases/` เป็น **fallback เท่านั้น** — ไม่ต้อง copy `current.md` ไปไว้ในนั้นเอง Build script อ่าน `current.md` จากทุก git commit ในประวัติ ดังนั้นทุกเวอร์ชั่นที่เคยมีอยู่ใน `current.md` จะถูกเก็บไว้ใน `release-history.json` โดยอัตโนมัติ
>
> ห้ามสร้างไฟล์ใน `releases/` เอง — ดู [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) ส่วน Release Notes

### 2.1 หน้าเว็บที่เกี่ยวข้อง

| หน้า | Path | บทบาท |
|---|---|---|
| What's New | `/info/whats_new/` | หน้าหลักสำหรับดู release notes |
| Settings | `/setting/` | มี link ไป What's New |

### 2.2 ไฟล์ JSON ที่ runtime ใช้

| ไฟล์ | ผู้สร้าง | ผู้ใช้ | เนื้อหา |
|---|---|---|---|
| `release-dates.json` | build script (commit ลง git) | `update-version.js` | `{ versions: { "1.8.0": "2026-06-20T00:00:00.000Z", ... } }` — registry ของ "วันที่ build ครั้งแรกของแต่ละ version" |
| `version.json` | build script (ไม่ commit) | `version-core.js` | `{ version, date }` — date เป็น ISO string จาก registry (stable ถ้า version เดิม) |
| `release-history.json` | build script (ไม่ commit) | `new.js` | ประวัติ release ทั้งหมด ใช้ date จาก registry |
| `whats-new.json` | (deprecated) | `new.js` (fallback) | release notes แบบเก่า |

### 2.3 Stable Release Date (v4 — `update-version.js`)

ตั้งแต่ `update-version.js` v4 เป็นต้นไป ระบบบันทึก **"วันที่ build ครั้งแรกของแต่ละ version"** เป็น source of truth ใน `assets/json/release-dates.json`:

- ถ้าอัปเดทเนื้อหาใน `current.md` แต่ **ไม่เปลี่ยน `version:`** → date ใน `current.md`, `version.json`, `release-history.json` จะ **ไม่เปลี่ยน** (คง date แรกที่บันทึกไว้ใน registry)
- ถ้าเปลี่ยน `version:` เป็นเลขใหม่ → build script จะบันทึก date ใหม่เข้า registry (priority: `date:` ใน `current.md` > `NOW`)
- ถ้าผู้ใช้ manual edit `date:` ใน `current.md` ให้เป็นค่าที่ไม่ตรงกับ registry (และ version เดิม) → build script จะ sync date กลับเป็นค่าจาก registry

**กฎเหล็ก:**
- 🥇 `release-dates.json` เป็น source of truth — ถ้า conflict กับ `date:` ใน `current.md`, registry ชนะเสมอ (ยกเว้นเมื่อ version เปลี่ยน)
- ห้ามแก้ `release-dates.json` เอง — build script ดูแลไฟล์นี้เอง (ดู [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) section 9)
- ไฟล์นี้ commit ลง git เพื่อให้ stable ข้าม CI/CD runs และ developer machines

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

> ⚠️ **ห้าม copy `current.md` ไป `releases/`** — build script อ่าน `current.md` จาก git history โดยตรง การ copy ไป `releases/` เป็นการทำซ้ำที่ไม่จำเป็นและไม่มีผลต่อ release-history.json

> 💡 **`date:` field (optional):** ผู้ใช้อาจเขียน `date:` ใน `current.md` ไว้ล่วงหน้าได้ ถ้าเป็น version ใหม่ build script จะเคารพ date นี้ (priority: `date:` ใน `current.md` > `NOW`) ถ้าไม่เขียน `date:` ไว้ build script จะใช้เวลา ณ ตอน run

### 5.2 Commit & deploy

```bash
git add assets/md/
git commit -m "release: v1.5.0"
git push

# CI/CD:
git fetch --unshallow
APP_VERSION=1.5.0 node scripts/update-version.js
```

### 5.3 Build script ทำอัตโนมัติ

1. **STEP 0** — โหลด `assets/json/release-dates.json` (registry ของ "วันที่ build ครั้งแรกของแต่ละ version")
2. **กำหนด release date ของ version ปัจจุบัน**:
   - ถ้า version มีอยู่แล้วใน registry → ใช้ date เดิม (stable)
   - ถ้า version ใหม่ และมี `date:` ใน `current.md` → ใช้ date นั้น
   - ถ้า version ใหม่ และไม่มี `date:` ใน `current.md` → ใช้ `NOW`
3. **STEP 1** — สร้าง `release-history.json` จาก git history ของ `current.md`:
   - อ่านทุก commit ของ `current.md` จาก git log (เก่า → ใหม่)
   - แต่ละ version ที่พบ → ใช้ date จาก registry (ถ้าไม่มี ใช้ commit timestamp แล้ว backfill registry)
   - รวมทุกภาษาเป็น i18n combined
4. **STEP 2** — อัปเดต `date:` ใน `current.md`:
   - ถ้า version ใหม่ → เขียน date ใหม่
   - ถ้า version เดิม และ date ใน `current.md` ไม่ตรง registry → sync กลับเป็นค่าจาก registry
   - ถ้า version เดิม และ date ใน `current.md` ตรง registry แล้ว → skip (ไม่เขียน)
5. **STEP 3** — สร้าง `version.json` พร้อม `date` จาก registry
6. **STEP 3.5** — บันทึก `release-dates.json` (registry ที่อัปเดตแล้ว) — **commit ไฟล์นี้ลง git**
7. **STEP 4** — HTML cache busting (เพิ่ม `?v={version}-{dateStr}` ให้ assets)

### 5.4 ตรวจสอบหลัง deploy

- [ ] เปิดหน้า What's New บนเว็บ — ควรแสดง release ใหม่
- [ ] ทดสอบในหน้าต่าง incognito — ถ้า `notify: true` popup ควรเด้ง
- [ ] ตรวจสอบภาษาทั้งสอง — แสดงเนื้อหาเดียวกัน
- [ ] ตรวจสอบ `date` ใน popup และหน้า What's New — ควรเป็น date แรกที่บันทึก (ไม่ใช่ date ล่าสุด)

---

## 5.5. อัปเดทเนื้อหาแต่ไม่เปลี่ยน version (เช่น typo fix, reword)

บางครั้งต้องแก้ `current.md` โดยไม่ bump version (เช่น แก้ typo, ปรับ wording, เพิ่มรายละเอียด) — ตั้งแต่ `update-version.js` v4 เป็นต้นไป กรณีนี้จะ **ไม่เปลี่ยน release date**:

### 5.5.1 ขั้นตอน

1. แก้ `assets/md/en/current.md` และ `assets/md/th/current.md` ตามต้องการ (อย่าเปลี่ยน `version:`)
2. Commit ด้วย message ที่ไม่ใช่ `release:` (เช่น `docs(release-notes): fix typo in v1.8.0`)
3. Push → CI/CD รัน `update-version.js` → registry มีอยู่แล้ว → date ไม่เปลี่ยน
4. `release-history.json` และ `version.json` จะถูกสร้างใหม่ด้วย date เดิมจาก registry

### 5.5.2 ผลกระทบต่อผู้ใช้

- Popup แจ้งเตือน: จะไม่เด้งซ้ำ (เพราะ version เดิม — `version-core.js` ใช้ `version` เป็น build ID)
- หน้า What's New: จะแสดงเนื้อหาใหม่ แต่ date ยังเป็น date เดิมของ release
- ไม่มี record ใหม่ใน `release-history.json` (version เดิม → 1 record เดิม)

> กฎเหล็ก: ถ้าอยากให้ผู้ใช้เห็นเป็น "อัปเดทใหม่" ต้อง bump `version:` เสมอ — การแก้เนื้อหาอย่างเดียวไม่ทำให้ popup แจ้งเตือนเด้งใหม่

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
