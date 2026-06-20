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
    current.md              ← อัปเดตปัจจุบัน (ภาษาอังกฤษ)
    releases/
      v1.3.0.md             ← ประวัติ (ภาษาอังกฤษ)
      v1.2.0.md
      v1.1.0.md
      v1.0.9.md
      v1.0.8.md
  th/
    current.md              ← อัปเดตปัจจุบัน (ภาษาไทย)
    releases/
      v1.3.0.md             ← ประวัติ (ภาษาไทย)
      v1.2.0.md
      v1.1.0.md
      v1.0.9.md
      v1.0.8.md

assets/json/
  release-history.json      ← สร้างโดย build script (อัตโนมัติ ไม่ต้องแก้)
  version.json              ← สร้างโดย build script (อัตโนมัติ)
  whats-new.json            ← เก่า — fallback เท่านั้น

assets/js/
  lang-core.js              ← v5.0: Central Language API (FvLang)
  new.js                    ← หน้า What's New — อ่าน MD ตามภาษา + history JSON
  version-core.js           ← Popup แจ้งเตือน — อ่าน MD ตามภาษา, ใช้ PopupSystem.open()
```

### 2.1 หน้าเว็บที่เกี่ยวข้อง

| หน้า | Path | บทบาท |
|---|---|---|
| What's New | `/info/whats_new/` | หน้าหลักสำหรับดู release notes |
| Settings | `/setting/` | มี link ไป What's New |

### 2.2 ไฟล์ JSON ที่ runtime ใช้

| ไฟล์ | ผู้สร้าง | ผู้ใช้ | เนื้อหา |
|---|---|---|---|
| `version.json` | build script | `version-core.js` | `{version, updatedAt}` |
| `release-history.json` | build script | `new.js` | ประวัติ release ทั้งหมด |
| `whats-new.json` | (deprecated) | `new.js` (fallback) | release notes แบบเก่า |

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

### 5.1 ย้ายเวอร์ชั่นเก่าไป `releases/`

```bash
cp assets/md/en/current.md assets/md/en/releases/v1.4.1.md
cp assets/md/th/current.md assets/md/th/releases/v1.4.1.md
```

### 5.2 เขียน release note ใหม่

แก้ `assets/md/en/current.md` และ `assets/md/th/current.md`:

- เปลี่ยน `version:` เป็นเวอร์ชั่นใหม่
- เขียน `title`, `subtitle`, sections ในแต่ละภาษา
- ปฏิบัติตาม [`RELEASE_NOTES_GUIDE.md`](./RELEASE_NOTES_GUIDE.md)

### 5.3 Commit & deploy

```bash
git add assets/md/
git commit -m "release: v1.5.0"
git push

# CI/CD:
git fetch --unshallow
APP_VERSION=1.5.0 node scripts/update-version.js
```

### 5.4 Build script ทำอัตโนมัติ

- อ่าน `en/current.md` + `th/current.md` จาก git history
- รวมทุกภาษาเป็น `release-history.json`
- อัปเดต `version.json` และ date ใน MD files
- Cache-bust HTML (เพิ่ม `?v=` query string ให้ assets)

### 5.5 ตรวจสอบหลัง deploy

- [ ] เปิดหน้า What's New บนเว็บ — ควรแสดง release ใหม่
- [ ] ทดสอบในหน้าต่าง incognito — ถ้า `notify: true` popup ควรเด้ง
- [ ] ตรวจสอบภาษาทั้งสอง — แสดงเนื้อหาเดียวกัน

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
- [`04-Language-i18n-System.md`](./04-Language-i18n-System.md) — ระบบภาษาทั้งหมด (FvLang เป็นส่วนหนึ่ง)
- [`06-Popup-System.md`](./06-Popup-System.md) — PopupSystem ที่ `version-core.js` ใช้
- [`09-Deployment-Guide.md`](./09-Deployment-Guide.md) — Version bumping ใน CI/CD
- [`12-SEO-Guide.md`](./12-SEO-Guide.md) — ⭐ Content freshness ส่งผลต่อ SEO — release notes แสดงให้เห็นว่าเว็บมีการอัปเดตต่อเนื่อง
