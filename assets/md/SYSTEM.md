# What's New System — Technical Documentation

## ระบบหน้า "มีอะไรใหม่" — เอกสารประกอบระบบ

ระบบ What's New ของ Fantrove Verse ใช้ Markdown เป็นแหล่งข้อมูลสำหรับเขียน release notes แทน JSON โดยมี build script ที่สร้างประวัติอัตโนมัติจาก git log

---

## ภาพรวมระบบ (Architecture)

```
เวลาเขียนอัพเดท:
  ผู้พัฒนา ──► แก้ current.md ──► git commit & push

เวลา deploy (CI/CD):
  git fetch --unshallow
  APP_VERSION=1.5.0 node scripts/update-version.js
      │
      ├─► อ่าน current.md → parse MD
      ├─► git log → อ่าน current.md จาก commit เก่าๆ
      ├─► สร้าง release-history.json (7 เวอร์ชั่นล่าสุด)
      ├─► อัพเดท version.json
      └─► cache-bust HTML (?v=...)
          │
          ▼
      deploy ไป Cloudflare Pages

เวลาผู้ใช้เข้าหน้า What's New:
  new.js ──► fetch current.md ──► parse MD ──► render (current release)
         ──► fetch release-history.json ──► render (previous releases)

เวลาผู้ใช้อยู่หน้าอื่น:
  version-core.js ──► fetch current.md ──► parse MD ──► แสดง popup (ถ้ามีเวอร์ชั่นใหม่)
```

---

## ไฟล์ที่เกี่ยวข้อง

### ไฟล์ที่ผู้พัฒนาเขียน/แก้ไข

| ไฟล์ | บทบาท | เขียนเอง? |
|------|--------|----------|
| `assets/md/current.md` | Release note ของเวอร์ชั่น **ปัจจุบัน** | ✅ ใช่ — แก้ไขทุกครั้งที่มีอัพเดท |
| `assets/md/releases/v1.x.x.md` | Release notes ของเวอร์ชั่นผ่านมา | ✅ เขียนครั้งเดียวตอนสร้าง |
| `scripts/update-version.js` | Build script สร้าง history | ❌ ไม่ต้องแก้ — รันอัตโนมัติ |

### ไฟล์ที่สร้างโดย build script (ไม่ต้องแก้)

| ไฟล์ | สร้างโดย | คำอธิบาย |
|------|---------|----------|
| `assets/json/release-history.json` | `update-version.js` | ประวัติ 7 เวอร์ชั่นล่าสุด จาก git log |
| `assets/json/version.json` | `update-version.js` | `{"version": "1.5.0"}` |
| `assets/json/whats-new.json` | `update-version.js` (fallback) | ถ้ายังไม่มี current.md |

### ไฟล์ Runtime

| ไฟล์ | บทบาท |
|------|--------|
| `assets/js/new.js` | หน้า What's New — fetch MD/JSON, parse, render |
| `assets/js/version-core.js` | Popup แจ้งเตือน — fetch current.md, แสดง popup |
| `assets/css/new.css` | CSS สำหรับหน้า What's New |

---

## วิธีเขียน MD สำหรับการอัพเดท

### โครงสร้างไฟล์ `current.md`

```markdown
---
version: 1.5.0
date: 2025-07-01T12:00:00Z
title:
  en: Title in English
  th: หัวข้อภาษาไทย
subtitle:
  en: A longer description of what this update includes.
  th: คำอธิบายยาวเกี่ยวกับสิ่งที่อัพเดทครั้งนี้มี
notify: true
---

### New

- **Feature name in English**
  Description of the new feature. This text becomes the description shown below the title.

- **Another new feature**
  Each item starts with `- **bold title**` followed by an optional description on the next lines.

### Improved

- **Something that was improved**
  Description of the improvement.

### Fixed

- **Bug that was fixed**
  Description of the fix.
```

### Front Matter (YAML header)

| ฟิลด์ | จำเป็น | คำอธิบาย |
|--------|--------|----------|
| `version` | ✅ | หมายเลขเวอร์ชั่น เช่น `1.5.0` |
| `date` | แนะนำ | ISO 8601 เช่น `2025-07-01T12:00:00Z` (build script จะอัพเดทให้) |
| `title` | แนะนำ | รองรับ i18n block หรือข้อความเดี่ยว |
| `subtitle` | แนะนำ | คำอธิบายเพิ่มเติม |
| `notify` | ไม่จำเป็น | `true` (default) หรือ `false` |

### i18n รูปแบบ

```yaml
# หลายภาษา:
title:
  en: English title
  th: หัวข้อภาษาไทย

# ข้อความเดียว:
title: Same text for all languages
```

### Section types

| Section | สี | ใช้เมื่อ |
|---------|-----|---------|
| `### New` | เขียว | ฟีเจอร์ใหม่ |
| `### Improved` | ฟ้าอมเขียว | การปรับปรุง |
| `### Fixed` | ส้ม | การแก้ไขบัก |

### Item format

```markdown
- **ชื่อเรื่อง (bold)**
  คำอธิบาน — เขียนต่อบรรทัดได้หลายบรรทัด

- **อีก item** ไม่มี description ก็ได้
```

---

## ขั้นตอนเมื่อมีการอัพเดทเวอร์ชั่นใหม่

### 1. เขียน release note

แก้ไข `assets/md/current.md`:
- เปลี่ยน `version:` เป็นเวอร์ชั่นใหม่
- เขียน `title`, `subtitle` ใหม่
- เขียน sections (New/Improved/Fixed)

### 2. ย้ายเวอร์ชั่นเก่าไปที่ releases/ (optional)

```bash
# คัดลอก current.md ที่เป็นเวอร์ชั่นเก่าไปที่ releases/
cp assets/md/current.md assets/md/releases/v1.4.0.md
# แล้วแก้ current.md เป็นเวอร์ชั่นใหม่
```

**ถ้าไม่ทำก็ได้** — build script จะอ่าน git log ของ `current.md` ใน commit เก่าๆ แล้วสร้าง history ให้อัตโนมัติ แต่ถ้าเขียนไฟล์ใน `releases/` ด้วย จะมีข้อมูลครบถ้วนกว่า

### 3. Commit & push

```bash
git add assets/md/
git commit -m "release v1.5.0"
git push
```

### 4. รัน build script (CI/CD หรือ manual)

```bash
git fetch --unshallow
APP_VERSION=1.5.0 node scripts/update-version.js
```

Script จะทำอัตโนมัติ:
- อ่าน `current.md` → สร้าง `release-history.json` จาก git log (7 เวอร์ชั่นล่าสุด)
- อัพเดท `version.json`
- อัพเดท date ใน `current.md`
- Cache-bust HTML files

---

## สิ่งที่ระบบทำอัตโนมัติ

- [x] `update-version.js` อ่าน MD files (YAML front matter + content) ผ่าน git log
- [x] สร้าง `release-history.json` จาก git log ของ `current.md` + `releases/*.md`
- [x] รองรับ `whats-new.json` เก่า (fallback ถ้า current.md ยังไม่มี)
- [x] `new.js` อ่าน `current.md` หลัก + `release-history.json` ประวัติ
- [x] `version-core.js` อ่าน `current.md` โดยตรง แสดง popup
- [x] ทั้ง new.js และ version-core.js มี MD parser ของตัวเอง
- [x] Fallback: ถ้าไม่มี current.md → อ่าน whats-new.json เก่าได้
- [x] Live relative timestamps, i18n, polling version.json ทุก 60s
- [x] Cache-busting ทุก HTML file เวลา deploy

---

## Migration: JSON → MD

ระบบรองรับทั้ง 2 format พร้อมกัน:
- ถ้ามี `current.md` → ใช้ MD
- ถ้าไม่มี `current.md` แต่มี `whats-new.json` → ใช้ JSON เก่า
- `update-version.js` ตรวจสอบทั้ง 2 ไฟล์และใช้ที่มีอยู่

เมื่อย้ายเสร็จแล้ว สามารถลบ `whats-new.json` ได้ — ระบบจะใช้ MD เท่านั้น# What's New System — Technical Documentation

## ระบบหน้า "มีอะไรใหม่" — เอกสารประกอบระบบ

ระบบ What's New ของ Fantrove Verse ใช้ Markdown เป็นแหล่งข้อมูลสำหรับเขียน release notes แทน JSON โดยมี build script ที่สร้างประวัติอัตโนมัติจาก git log

---

## ภาพรวมระบบ (Architecture)

```
เวลาเขียนอัพเดท:
  ผู้พัฒนา ──► แก้ current.md ──► git commit & push

เวลา deploy (CI/CD):
  git fetch --unshallow
  APP_VERSION=1.5.0 node scripts/update-version.js
      │
      ├─► อ่าน current.md → parse MD
      ├─► git log → อ่าน current.md จาก commit เก่าๆ
      ├─► สร้าง release-history.json (7 เวอร์ชั่นล่าสุด)
      ├─► อัพเดท version.json
      └─► cache-bust HTML (?v=...)
          │
          ▼
      deploy ไป Cloudflare Pages

เวลาผู้ใช้เข้าหน้า What's New:
  new.js ──► fetch current.md ──► parse MD ──► render (current release)
         ──► fetch release-history.json ──► render (previous releases)

เวลาผู้ใช้อยู่หน้าอื่น:
  version-core.js ──► fetch current.md ──► parse MD ──► แสดง popup (ถ้ามีเวอร์ชั่นใหม่)
```

---

## ไฟล์ที่เกี่ยวข้อง

### ไฟล์ที่ผู้พัฒนาเขียน/แก้ไข

| ไฟล์ | บทบาท | เขียนเอง? |
|------|--------|----------|
| `assets/md/current.md` | Release note ของเวอร์ชั่น **ปัจจุบัน** | ✅ ใช่ — แก้ไขทุกครั้งที่มีอัพเดท |
| `assets/md/releases/v1.x.x.md` | Release notes ของเวอร์ชั่นผ่านมา | ✅ เขียนครั้งเดียวตอนสร้าง |
| `scripts/update-version.js` | Build script สร้าง history | ❌ ไม่ต้องแก้ — รันอัตโนมัติ |

### ไฟล์ที่สร้างโดย build script (ไม่ต้องแก้)

| ไฟล์ | สร้างโดย | คำอธิบาย |
|------|---------|----------|
| `assets/json/release-history.json` | `update-version.js` | ประวัติ 7 เวอร์ชั่นล่าสุด จาก git log |
| `assets/json/version.json` | `update-version.js` | `{"version": "1.5.0"}` |
| `assets/json/whats-new.json` | `update-version.js` (fallback) | ถ้ายังไม่มี current.md |

### ไฟล์ Runtime

| ไฟล์ | บทบาท |
|------|--------|
| `assets/js/new.js` | หน้า What's New — fetch MD/JSON, parse, render |
| `assets/js/version-core.js` | Popup แจ้งเตือน — fetch current.md, แสดง popup |
| `assets/css/new.css` | CSS สำหรับหน้า What's New |

---

## วิธีเขียน MD สำหรับการอัพเดท

### โครงสร้างไฟล์ `current.md`

```markdown
---
version: 1.5.0
date: 2025-07-01T12:00:00Z
title:
  en: Title in English
  th: หัวข้อภาษาไทย
subtitle:
  en: A longer description of what this update includes.
  th: คำอธิบายยาวเกี่ยวกับสิ่งที่อัพเดทครั้งนี้มี
notify: true
---

### New

- **Feature name in English**
  Description of the new feature. This text becomes the description shown below the title.

- **Another new feature**
  Each item starts with `- **bold title**` followed by an optional description on the next lines.

### Improved

- **Something that was improved**
  Description of the improvement.

### Fixed

- **Bug that was fixed**
  Description of the fix.
```

### Front Matter (YAML header)

| ฟิลด์ | จำเป็น | คำอธิบาย |
|--------|--------|----------|
| `version` | ✅ | หมายเลขเวอร์ชั่น เช่น `1.5.0` |
| `date` | แนะนำ | ISO 8601 เช่น `2025-07-01T12:00:00Z` (build script จะอัพเดทให้) |
| `title` | แนะนำ | รองรับ i18n block หรือข้อความเดี่ยว |
| `subtitle` | แนะนำ | คำอธิบายเพิ่มเติม |
| `notify` | ไม่จำเป็น | `true` (default) หรือ `false` |

### i18n รูปแบบ

```yaml
# หลายภาษา:
title:
  en: English title
  th: หัวข้อภาษาไทย

# ข้อความเดียว:
title: Same text for all languages
```

### Section types

| Section | สี | ใช้เมื่อ |
|---------|-----|---------|
| `### New` | เขียว | ฟีเจอร์ใหม่ |
| `### Improved` | ฟ้าอมเขียว | การปรับปรุง |
| `### Fixed` | ส้ม | การแก้ไขบัก |

### Item format

```markdown
- **ชื่อเรื่อง (bold)**
  คำอธิบาน — เขียนต่อบรรทัดได้หลายบรรทัด

- **อีก item** ไม่มี description ก็ได้
```

---

## ขั้นตอนเมื่อมีการอัพเดทเวอร์ชั่นใหม่

### 1. เขียน release note

แก้ไข `assets/md/current.md`:
- เปลี่ยน `version:` เป็นเวอร์ชั่นใหม่
- เขียน `title`, `subtitle` ใหม่
- เขียน sections (New/Improved/Fixed)

### 2. ย้ายเวอร์ชั่นเก่าไปที่ releases/ (optional)

```bash
# คัดลอก current.md ที่เป็นเวอร์ชั่นเก่าไปที่ releases/
cp assets/md/current.md assets/md/releases/v1.4.0.md
# แล้วแก้ current.md เป็นเวอร์ชั่นใหม่
```

**ถ้าไม่ทำก็ได้** — build script จะอ่าน git log ของ `current.md` ใน commit เก่าๆ แล้วสร้าง history ให้อัตโนมัติ แต่ถ้าเขียนไฟล์ใน `releases/` ด้วย จะมีข้อมูลครบถ้วนกว่า

### 3. Commit & push

```bash
git add assets/md/
git commit -m "release v1.5.0"
git push
```

### 4. รัน build script (CI/CD หรือ manual)

```bash
git fetch --unshallow
APP_VERSION=1.5.0 node scripts/update-version.js
```

Script จะทำอัตโนมัติ:
- อ่าน `current.md` → สร้าง `release-history.json` จาก git log (7 เวอร์ชั่นล่าสุด)
- อัพเดท `version.json`
- อัพเดท date ใน `current.md`
- Cache-bust HTML files

---

## สิ่งที่ระบบทำอัตโนมัติ

- [x] `update-version.js` อ่าน MD files (YAML front matter + content) ผ่าน git log
- [x] สร้าง `release-history.json` จาก git log ของ `current.md` + `releases/*.md`
- [x] รองรับ `whats-new.json` เก่า (fallback ถ้า current.md ยังไม่มี)
- [x] `new.js` อ่าน `current.md` หลัก + `release-history.json` ประวัติ
- [x] `version-core.js` อ่าน `current.md` โดยตรง แสดง popup
- [x] ทั้ง new.js และ version-core.js มี MD parser ของตัวเอง
- [x] Fallback: ถ้าไม่มี current.md → อ่าน whats-new.json เก่าได้
- [x] Live relative timestamps, i18n, polling version.json ทุก 60s
- [x] Cache-busting ทุก HTML file เวลา deploy

---

## Migration: JSON → MD

ระบบรองรับทั้ง 2 format พร้อมกัน:
- ถ้ามี `current.md` → ใช้ MD
- ถ้าไม่มี `current.md` แต่มี `whats-new.json` → ใช้ JSON เก่า
- `update-version.js` ตรวจสอบทั้ง 2 ไฟล์และใช้ที่มีอยู่

เมื่อย้ายเสร็จแล้ว สามารถลบ `whats-new.json` ได้ — ระบบจะใช้ MD เท่านั้น