# What's New System — Technical Documentation

## ระบบหน้า "มีอะไรใหม่" — เอกสารประกอบระบบ

ระบบ What's New ใช้ Markdown แยกตามภาษาเป็นแหล่งข้อมูล release notes โดยมี build script ที่รวมภาษาและสร้างประวัติจาก git log อัตโนมัติ

---

## โครงสร้างไฟล์

```
assets/md/
  en/
    current.md              ← อัพเดทปัจจุบัน (ภาษาอังกฤษ)
    releases/
      v1.3.0.md            ← ประวัติ (ภาษาอังกฤษ)
      v1.2.0.md
      v1.1.0.md
      v1.0.9.md
      v1.0.8.md
  th/
    current.md              ← อัพเดทปัจจุบัน (ภาษาไทย)
    releases/
      v1.3.0.md            ← ประวัติ (ภาษาไทย)
      v1.2.0.md
      v1.1.0.md
      v1.0.9.md
      v1.0.8.md
  SYSTEM.md                 ← เอกสารนี้

assets/json/
  release-history.json      ← สร้างโดย build script (อัตโนมัติ ไม่ต้องแก้)
  version.json              ← สร้างโดย build script (อัตโนมัติ)
  whats-new.json            ← เก่า — fallback เท่านั้น

assets/js/
  lang-core.js              ← v5.0: Central Language API (FvLang)
  new.js                    ← หน้า What's New — อ่าน MD ตามภาษา + history JSON
  version-core.js           ← Popup แจ้งเตือน — อ่าน MD ตามภาษา, ใช้ PopupSystem.open()
```

---

## ระบบภาษา FvLang (v5.0)

ไฟล์ `lang-core.js` โหลดเป็น script แรกสุดใน `<head>` ก่อน `language.js`

### FvLang API

```
window.FvLang.lang              — ภาษาปัจจุบัน ('en' | 'th')
window.FvLang.isReady           — true เสมอ (resolve แบบ sync)
window.FvLang.isStaticMode      — true ถ้าเป็น production built page
window.FvLang.onChange(fn)      — subscribe ภาษาเปลี่ยน → return unsubscribe fn
window.FvLang.setLang(lang)     — ตั้งภาษา + dispatch fv:langchange
window.FvLang.forceRefresh()    — refresh ทั้งหน้าโดยไม่เปลี่ยนภาษา
```

### Event

```
window 'fv:langchange'  → CustomEvent, detail: { lang, previousLang }
```

### ลำดับการทำงาน

1. `lang-core.js` อ่านภาษาทันที: data-fv-built → URL → localStorage → browser
2. สร้าง `window.FvLang` object + `window.languageReady` Promise (resolved ทันที)
3. `language.js` โหลด อ่าน FvLang → โหลด modules → setup UI
4. ทุก script อื่นใช้ `FvLang.lang` และ `FvLang.onChange()`

### ผลกระทบต่อระบบอื่น

| ระบบ | ก่อน v5.0 | v5.0 |
|------|-----------|------|
| home.js | `localStorage.getItem('selectedLang')` | `FvLang.lang` + `FvLang.onChange(re-render)` |
| new.js | `localStorage.getItem('selectedLang')` + `languageChange` event | `FvLang.lang` + `fv:langchange` event |
| version-core.js | `localStorage.getItem('selectedLang')` | `FvLang.lang` |
| modern-navigation.js | `_readStoredLang()` + `languageChange` event | `_readStoredLang()` + `fv:langchange` event |
| language.js | detect เอง + 14 modules (static) | FvLang ให้ภาษา + 6 modules (static) |

---

## รูปแบบไฟล์ MD (ภาษาเดียว)

แต่ละไฟล์เป็นภาษาเดียว — title, subtitle, description เป็น string ธรรมดา ไม่ต้องมี i18n block

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

---

## ขั้นตอนเมื่ออัพเดทเวอร์ชั่นใหม่

### 1. ย้ายเวอร์ชั่นเก่าไป releases/ (optional)

```bash
cp assets/md/en/current.md assets/md/en/releases/v1.4.1.md
cp assets/md/th/current.md assets/md/th/releases/v1.4.1.md
```

### 2. เขียน release note ใหม่

แก้ `assets/md/en/current.md` และ `assets/md/th/current.md`:
- เปลี่ยน `version:` เป็นเวอร์ชั่นใหม่
- เขียน title, subtitle, sections ในแต่ละภาษา

### 3. Commit & deploy

```bash
git add assets/md/
git commit -m "release v1.5.0"
git push

# CI/CD:
git fetch --unshallow
APP_VERSION=1.5.0 node scripts/update-version.js
```

Build script ทำอัตโนมัติ:
- อ่าน `en/current.md` + `th/current.md` จาก git history
- รวมทุกภาษาเป็น `release-history.json`
- อัพเดท `version.json` และ date ใน MD files
- Cache-bust HTML

---

## ระบบรองรับ backwards compatibility

| ที่มีอยู่ | ผลลัพธ์ |
|---------|--------|
| `en/current.md` + `th/current.md` | ✅ ใช้ per-language (หลัก) |
| `current.md` เดียว (มี i18n blocks) | ✅ fallback อ่านได้ |
| `whats-new.json` | ✅ fallback อ่านได้ |

Runtime จะลอง順序: per-language MD → legacy MD → JSON