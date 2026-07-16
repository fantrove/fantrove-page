# 11 — ระบบหน้า "มีอะไรใหม่" (What's New System) v5.1

> เอกสารนี้อธิบายระบบ What's New ของ **Fantrove** — ระบบที่แสดง release notes และ popup แจ้งเตือนเมื่อมีเวอร์ชั่นใหม่
>
> **v5.1 — CLOSED SYSTEM + 4-LAYER VERSION CONTROL:** ระบบ release notes เป็นระบบปิด นักพัฒนาเขียน/แก้ได้แค่ `assets/md/{en,th}/current.md` เท่านั้น พร้อมระบบ 4 ชั้นที่บังคับ version bump ทุกการส่งโค้ด (ยกเว้น bypass)
>
> **v5.1 — NO APP_VERSION:** ไม่ต้องส่ง `APP_VERSION` env var แล้ว — script อ่าน version จาก `current.md` โดยตรง
>
> **สำหรับ:** นักพัฒนา/AI ที่จะเขียน release notes หรือแก้ระบบแจ้งเตือน
>
> **ไฟล์หลัก:** `assets/js/new.js`, `assets/js/version-core.js`, `scripts/update-version.js`, `scripts/validate-release.js`, `scripts/hooks/`, `.github/workflows/release.yml`

---

## สารบัญ

1. [ภาพรวมระบบ (v5.1 Closed System + 4-Layer)](#1-ภาพรวมระบบ-v51-closed-system--4-layer)
2. [โครงสร้างไฟล์](#2-โครงสร้างไฟล์)
3. [นักพัฒนาเขียนอะไรได้บ้าง (Closed System Rules)](#3-นักพัฒนาเขียนอะไรได้บ้าง-closed-system-rules)
4. [ระบบ 4 ชั้นป้องกันลืมอัปเดตเวอร์ชั่น (4-Layer Version Control)](#4-ระบบ-4-ชั้นป้องกันลืมอัปเดตเวอร์ชั่น-4-layer-version-control)
5. [Bypass Mechanism](#5-bypass-mechanism)
6. [ระบบภาษา FvLang (v5.0)](#6-ระบบภาษา-fvlang-v50)
7. [รูปแบบไฟล์ Markdown](#7-รูปแบบไฟล์-markdown)
8. [ขั้นตอนเมื่ออัปเดตเวอร์ชั่นใหม่](#8-ขั้นตอนเมื่ออัปเดตเวอร์ชั่นใหม่)
9. [Validation Script](#9-validation-script)
10. [อ้างอิงข้ามเอกสาร](#10-อ้างอิงข้ามเอกสาร)

---

## 1. ภาพรวมระบบ (v5.1 Closed System + 4-Layer)

ตั้งแต่ v5.0 เป็นต้นไป ระบบ release notes เป็น **ระบบปิด (closed system)** — นักพัฒนาเขียน/แก้ได้แค่ไฟล์เดียว:

- `assets/md/en/current.md` — release notes ภาษาอังกฤษของ version ปัจจุบัน
- `assets/md/th/current.md` — release notes ภาษาไทยของ version ปัจจุบัน

ไฟล์อื่นทุกไฟล์ในระบบเป็น **generated artifacts** ที่ `scripts/update-version.js` สร้างใน CI/CD เท่านั้น:

- `assets/md/{en,th}/releases/v*.md` — snapshot ของแต่ละ version (สร้างเมื่อ bump version)
- `assets/md/releases/index.json` — manifest สำหรับ client
- `assets/json/release-dates.json` — registry ของ release dates
- `assets/json/version.json` — runtime metadata

### 1.1 ทำไมต้องเป็น closed system

ก่อนหน้า v5.0 ระบบรองรับ legacy fallback paths (เช่น `whats-new.json`, `release-history.json`, single-file `current.md`) ทำให้นักพัฒนาอาจเผลอแก้ไฟล์ผิดที่ ทำให้:

- วันที่ไม่ตรงความเป็นจริง
- ประวัติเสียหาย
- มีข้อมูลซ้ำซ้อนในหลายไฟล์

v5.0 แก้ปัญหานี้ด้วยการลบ legacy paths ทั้งหมด และเพิ่ม `scripts/validate-release.js` สำหรับตรวจสอบว่านักพัฒนาแตะเฉพาะ `current.md` เท่านั้น

### 1.2 แผนภาพการทำงาน

```
นักพัฒนาเขียน current.md (en + th) — เขียนเฉพาะ version/title/subtitle/sections (ไม่ต้องเขียน date)
        │
        ▼
Git commit & push
        │
        ▼
CI/CD: scripts/validate-release.js (NEW v5.0)
   - ตรวจว่านักพัฒนาแตะเฉพาะ current.md เท่านั้น
   - ถ้าแก้ generated artifacts → FAIL (ต้อง revert)
        │
        ▼
CI/CD: scripts/update-version.js v5.0
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
        │       └─ new.js v3.0 อ่าน current.md ตามภาษา + releases/index.json + releases/v{version}.md
        │          (ไม่มี legacy fallback แล้ว)
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
    current.md              ← ✅ นักพัฒนาเขียน (ภาษาอังกฤษ) — ไฟล์เดียวที่แตะได้
    releases/               ← 🔒 generated artifacts (build script สร้าง)
      v1.0.9.md
      v1.3.0.md
      v2.0.0.md
      ...
  th/
    current.md              ← ✅ นักพัฒนาเขียน (ภาษาไทย) — ไฟล์เดียวที่แตะได้
    releases/               ← 🔒 generated artifacts
      v1.0.9.md
      ...
  releases/
    index.json              ← 🔒 generated artifact (manifest สำหรับ client)

assets/json/
  release-dates.json       ← 🔒 generated artifact (registry ของ release dates)
  version.json             ← 🔒 generated artifact (runtime metadata — ไม่ commit)

scripts/
  update-version.js         ← CI/CD script ที่สร้าง generated artifacts
  validate-release.js       ← NEW v5.0: validator สำหรับ closed system

assets/js/
  new.js                    ← v3.0: อ่าน releases/index.json + releases/v{version}.md (ไม่มี legacy fallback)
  version-core.js           ← Popup แจ้งเตือน — อ่าน MD ตามภาษา, ใช้ PopupSystem.open()
```

> ⚠️ **สำคัญ (v5.0):** นักพัฒนาแตะได้แค่ `assets/md/{en,th}/current.md` เท่านั้น ไฟล์อื่นทุกไฟล์ในระบบ release notes เป็น generated artifacts — ห้ามแก้ด้วยมือ ดู [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) section 9

### 2.1 ไฟล์ JSON ที่ runtime ใช้

| ไฟล์ | ผู้สร้าง | ผู้ใช้ | เนื้อหา |
|---|---|---|---|
| `assets/md/releases/index.json` | `update-version.js` (CI/CD) | `new.js` | `{ versions: [{ version, date, hasDetails }], updatedAt }` — manifest ของ releases/ |
| `assets/md/{lang}/releases/v{version}.md` | `update-version.js` (CI/CD) | `new.js` | release notes แยกตาม version (per-language) |
| `assets/json/release-dates.json` | `update-version.js` (CI/CD) | `update-version.js` | `{ versions: { "2.0.0": "2026-07-16T...", ... } }` — registry ของ "วันที่ build ครั้งแรกของแต่ละ version" |
| `assets/json/version.json` | `update-version.js` (CI/CD) | `version-core.js` | `{ version, date }` — date เป็น ISO string จาก registry (stable ถ้า version เดิม) |

> ⚠️ **ยกเลิกใน v5.0** (ถ้ามีอยู่ให้ลบออก):
> - `assets/json/whats-new.json` (legacy JSON)
> - `assets/json/release-history.json` (legacy combined history)
> - `assets/md/current.md` (legacy single-file MD)

### 2.2 Stable Release Date (v4 — `update-version.js`)

`update-version.js` บันทึก **"วันที่ build ครั้งแรกของแต่ละ version"** เป็น source of truth ใน `assets/json/release-dates.json`:

- ถ้าอัปเดทเนื้อหาใน `current.md` แต่ **ไม่เปลี่ยน `version:`** → date ใน `current.md`, `version.json`, `releases/index.json` จะ **ไม่เปลี่ยน** (คง date แรกที่บันทึกไว้ใน registry)
- ถ้าเปลี่ยน `version:` เป็นเลขใหม่ → build script จะใช้ **เวลา ณ ตอน build ครั้งแรกของ version นั้น** (`NOW`) เป็น release date และบันทึกลง registry ถาวร
- ถ้านักพัฒนา manual edit `date:` ใน `current.md` → build script จะ **sync กลับ** เป็นค่าจาก registry เสมอ

**กฎเหล็ก:**
- 🥇 `release-dates.json` เป็น source of truth — ถ้า conflict กับ `date:` ใน `current.md`, registry ชนะเสมอ
- ⚠️ **นักพัฒนาไม่ต้องเขียน `date:` ใน `current.md` เอง** — ระบบจะเพิ่ม/อัปเดต date ให้อัตโนมัติจาก registry (หรือ NOW ถ้าเป็น version ใหม่)
- ห้ามแก้ `release-dates.json` เอง — build script ดูแลไฟล์นี้เอง (ดู [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) section 9)
- ไฟล์นี้ commit ลง git เพื่อให้ stable ข้าม CI/CD runs และ developer machines

### 2.3 Folder-Based History (v4.1 — `update-version.js`)

ระบบใช้ **โครงสร้างโฟลเดอร์** สำหรับเก็บประวัติ release:

```
assets/md/releases/
  index.json              ← manifest สำหรับ client (list ทุก version + date + hasDetails)
assets/md/{lang}/releases/
  v2.0.0.md              ← release notes ของ version 2.0.0 (per-language)
  v1.3.0.md              ← release notes ของ version 1.3.0
  ...
```

**วิธีการทำงาน:**
1. เมื่อ bump version ใหม่ → build script สร้าง `releases/v{version}.md` จาก `current.md` (ทั้ง en + th)
2. build script สร้าง `releases/index.json` ที่ list ทุก version + date + `hasDetails` (ว่ามีไฟล์ markdown หรือไม่)
3. client (`new.js`) อ่าน `releases/index.json` แล้ว fetch `releases/v{version}.md` สำหรับแต่ละ version ที่ `hasDetails: true`
4. สำหรับ version ที่ `hasDetails: false` (มีใน registry แต่ไม่มีไฟล์ markdown) → client แสดงแค่ version + date (basic record)

**กฎเหล็ก:**
- นักพัฒนาไม่ต้องสร้างไฟล์ใน `releases/` เอง — build script สร้างให้อัตโนมัติเมื่อ bump version
- ไฟล์ `releases/v{version}.md` และ `releases/index.json` commit ลง git เพื่อเป็น source of truth

---

## 3. นักพัฒนาเขียนอะไรได้บ้าง (Closed System Rules)

### 3.1 Allowlist — นักพัฒนาเขียน/แก้ได้

| ไฟล์ | วิธีเขียน |
|---|---|
| `assets/md/en/current.md` | เขียน release notes ภาษาอังกฤษของ version ปัจจุบัน |
| `assets/md/th/current.md` | เขียน release notes ภาษาไทยของ version ปัจจุบัน |

**นักพัฒนาเขียนได้แค่:**
- `version:` — เลขเวอร์ชั่น (เช่น `2.0.0`)
- `title:` — หัวข้อสั้น ๆ สรุปอัปเดต
- `subtitle:` — คำอธิบายขยาย 1-2 ประโยค
- `notify:` — true/false (แจ้งเตือน popup ไหม)
- เนื้อหา sections (TL;DR, เกี่ยวกับระบบนี้, New, Improved, Fixed, Removed, สิ่งที่คุณจะสัมผัสได้)

**นักพัฒนาไม่ต้องเขียน:**
- `date:` — ระบบ sync จาก registry ให้อัตโนมัติ (จะเขียนทับถ้าใส่เอง)

### 3.2 Blocklist — นักพัฒนาห้ามแตะ

| ไฟล์ | เหตุผล |
|---|---|
| `assets/md/{en,th}/releases/v*.md` | generated snapshot — สร้างโดย build script |
| `assets/md/releases/index.json` | generated manifest — สร้างโดย build script |
| `assets/json/release-dates.json` | generated registry — สร้างโดย build script |
| `assets/json/version.json` | generated runtime metadata — สร้างโดย build script |
| `assets/json/whats-new.json` | legacy — ควรลบถ้ามี |
| `assets/json/release-history.json` | legacy — ควรลบถ้ามี |
| `assets/md/current.md` (single-file) | legacy — ควรลบถ้ามี |

### 3.3 ทำไมต้องปิด

- **ป้องกันความผิดพลาด** — นักพัฒนาอาจเผลอแก้ไฟล์ผิดที่ ทำให้ข้อมูลเสีย
- **วันที่เสถียร** — ถ้านักพัฒนาแก้ `date:` เอง วันที่อาจไม่ตรงความเป็นจริง
- **ง่ายต่อการดูแล** — นักพัฒนาดูแลไฟล์เดียว ไม่ต้องกังวลเรื่องไฟล์อื่น
- **Audit trail** — แต่ละ version มี snapshot ของตัวเอง ไม่มีการแก้ย้อนหลัง

---

## 4. ระบบ 4 ชั้นป้องกันลืมอัปเดตเวอร์ชั่น (4-Layer Version Control)

ตั้งแต่ v5.1 เป็นต้นไป ระบบมี **4 ชั้นป้องกัน** ที่บังคับว่าทุกการส่งโค้ดต้องเปลี่ยนเลขเวอร์ชั่น (ยกเว้นใช้ bypass token)

### 4.1 แผนภาพ 4 ชั้น

```
นักพัฒนาเขียน current.md (เปลี่ยน version:)
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 1: Pre-commit (local)                              │
│ - validate-release.js --staged                           │
│ - ตรว version bump (ยกเว้น bypass)                        │
│ - ตรว generated artifacts (block ถ้าแก้)                  │
│ ถ้าไม่ผ่าน → commit ไม่ได้                                  │
└─────────────────────────────────────────────────────────┘
        │ (commit สำเร็จ)
        ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 2: Pre-push (local)                                │
│ - validate-release.js --pre-push                         │
│ - ตรว version bump (ยกเว้น bypass)                        │
│ - ตรว JS syntax ของไฟล์ที่เปลี่ยน                          │
│ - ตรว current.md มีครบทั้ง en + th                        │
│ ถ้าไม่ผ่าน → push ไม่ได้                                    │
└─────────────────────────────────────────────────────────┘
        │ (push สำเร็จ)
        ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 3: CI (GitHub Actions)                             │
│ - validate-release.js --ci                               │
│ - update-version.js (build artifacts)                    │
│ - verify build artifacts ครบ                             │
│ - commit artifacts กลับเข้า repo                          │
│ ถ้าไม่ผ่าน → deploy ไม่ทำงาน                               │
└─────────────────────────────────────────────────────────┘
        │ (CI ผ่าน)
        ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 4: Deploy (Cloudflare Pages)                       │
│ - deploy เฉพาะเวอร์ชั่นที่ผ่านทุกชั้น                        │
└─────────────────────────────────────────────────────────┘
```

### 4.2 การติดตั้ง Layer 1 + Layer 2 (local hooks)

รันคำสั่งนี้ครั้งเดียวบนเครื่องนักพัฒนา:

```bash
bash scripts/hooks/install.sh
```

script จะ:
- copy `scripts/hooks/pre-commit` → `.githooks/pre-commit`
- copy `scripts/hooks/pre-push` → `.githooks/pre-push`
- ตั้ง `git config core.hooksPath .githooks`

หลังติดตั้ง ทุกครั้งที่ `git commit` และ `git push` จะมี validation อัตโนมัติ

### 4.3 การยกเลิก hooks

```bash
git config --unset core.hooksPath
```

### 4.4 Layer 3 (CI) — GitHub Actions

ไฟล์ `.github/workflows/release.yml` รันอัตโนมัติเมื่อ push ไป `main`:

1. **Validate** — `node scripts/validate-release.js --ci --allow-generated`
2. **Build** — `node scripts/update-version.js` (ไม่ต้องส่ง APP_VERSION)
3. **Verify** — ตรว generated artifacts ครบ
4. **Commit** — commit artifacts กลับเข้า repo (ด้วย bot account)
5. **Deploy** — Cloudflare Pages deploy

### 4.5 การตั้งค่า Cloudflare

ไม่ต้องตั้งค่า `APP_VERSION` ใน Cloudflare dashboard อีกต่อไป — CI อ่าน version จาก `current.md` โดยตรง

Secrets ที่ต้องตั้งใน GitHub repo:
- `CLOUDFLARE_API_TOKEN` — API token สำหรับ Cloudflare Pages
- `CLOUDFLARE_ACCOUNT_ID` — Account ID ของ Cloudflare

---

## 5. Bypass Mechanism

### 5.1 เมื่อไหร่ต้องใช้ bypass

บางครั้งนักพัฒนาอาจตั้งใจไม่เปลี่ยน version — เช่น:
- แก้ไขเล็กน้อยที่ไม่ใช่ release จริง
- แก้ typo ในโค้ด
- แก้ config ที่ไม่กระทบผู้ใช้

ในกรณีเหล่านี้ ให้ใช้ bypass token

### 5.2 วิธีใช้ bypass

1. แก้ไขไฟล์ `.release-bypass` ให้เป็นเลขที่มากกว่า `.release-bypass-counter`
   - ถ้า `.release-bypass-counter` = `0` → ใส่ `1` ใน `.release-bypass`
   - ถ้า `.release-bypass-counter` = `1` → ใส่ `2` ใน `.release-bypass`

2. Commit ปกติ — pre-commit/pre-push จะตรวพบ bypass และอนุญาต

3. หลัง commit สำเร็จ `.release-bypass-counter` จะถูกอัปเดตอัตโนมัติเป็นเลขที่ใช้

4. ครั้งถัดไปที่จะ bypass ต้องเพิ่มเลขอีก

### 5.3 ไฟล์ bypass

| ไฟล์ | หน้าที่ | committed? |
|---|---|---|
| `.release-bypass` | token ปัจจุบัน (เลขที่นักพัฒนาใส่) | ✅ ใช่ |
| `.release-bypass-counter` | token ล่าสุดที่ใช้แล้ว | ✅ ใช่ (อัปเดตอัตโนมัติ) |

ทั้งสองไฟล์ committed เพื่อให้ shared ข้าม developers และ CI

### 5.4 ตัวอย่าง

```bash
# สถานะเริ่มต้น
$ cat .release-bypass        # 0
$ cat .release-bypass-counter # 0

# ต้องการ bypass (ไม่เปลี่ยน version)
$ echo "1" > .release-bypass
$ git add .release-bypass assets/js/some-file.js
$ git commit -m "fix: minor typo"
# pre-commit: bypass token 1 > counter 0 → allow, counter → 1

# ต้องการ bypass อีกครั้ง
$ echo "1" > .release-bypass  # ลองใช้เลขเดิม
$ git commit -m "fix: another typo"
# pre-commit: bypass token 1 <= counter 1 → BLOCK!

$ echo "2" > .release-bypass  # ต้องเพิ่มเลข
$ git commit -m "fix: another typo"
# pre-commit: bypass token 2 > counter 1 → allow, counter → 2
```

### 5.5 กฎเหล็กของ bypass

- แต่ละ token ใช้ได้ครั้งเดียวเท่านั้น
- ต้องเพิ่มเลขทุกครั้งที่จะ bypass ใหม่
- ไม่สามารถข้ามเลขได้ (ต้อง 1, 2, 3, ... ตามลำดับ)
- ห้ามลบไฟล์ `.release-bypass` หรือ `.release-bypass-counter`
- ห้ามแก้ `.release-bypass-counter` ด้วยมือ — ระบบอัปเดตเอง

---

## 6. ระบบภาษา FvLang (v5.0)

ไฟล์ `lang-core.js` โหลดเป็น script แรกสุดใน `<head>` ก่อน `language.js`

### 4.1 FvLang API

```javascript
window.FvLang.lang              // ภาษาปัจจุบัน ('en' | 'th')
window.FvLang.isReady           // true เสมอ (resolve แบบ sync)
window.FvLang.isStaticMode      // true ถ้าเป็น production built page
window.FvLang.onChange(fn)      // subscribe ภาษาเปลี่ยน → return unsubscribe fn
window.FvLang.setLang(lang)     // ตั้งภาษา + dispatch fv:langchange
window.FvLang.forceRefresh()    // refresh ทั้งหน้าโดยไม่เปลี่ยนภาษา
```

### 4.2 Event

```javascript
window 'fv:langchange'  // → CustomEvent, detail: { lang, previousLang }
```

### 4.3 ผลกระทบต่อระบบ release notes

| ระบบ | ก่อน v5.0 | v5.0 |
|------|-----------|------|
| `new.js` | `localStorage.getItem('selectedLang')` + `languageChange` event + legacy fallbacks | `FvLang.lang` + `fv:langchange` event + เฉพาะ per-language MD |
| `version-core.js` | `localStorage.getItem('selectedLang')` | `FvLang.lang` |

---

## 7. รูปแบบไฟล์ Markdown

แต่ละไฟล์ `current.md` เป็นภาษาเดียว — `title`, `subtitle`, `description` เป็น string ธรรมดา ไม่ต้องมี i18n block

```markdown
---
version: 2.0.0
title: Title in this language only
subtitle: Description in this language only
notify: true
---

**TL;DR** — Short summary in this language.

## About this system / เกี่ยวกับระบบนี้

Context paragraph in this language.

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

### 5.1 Frontmatter fields

| field | required | ความหมาย |
|---|---|---|
| `version` | ✅ | เลขเวอร์ชั่น (เช่น `2.0.0`) — นักพัฒนาเขียน |
| `date` | ❌ | วันที่ release — **นักพัฒนาไม่ต้องเขียน** ระบบ sync จาก registry |
| `title` | ✅ | หัวข้อสั้น ๆ |
| `subtitle` | ✅ | คำอธิบายขยาย 1-2 ประโยค |
| `notify` | ☐ | `true` ถ้าต้องการให้ popup แจ้งเตือน |

### 5.2 มาตรฐานการเขียนเนื้อหา

อ่าน [`RELEASE_NOTES_GUIDE.md`](./RELEASE_NOTES_GUIDE.md) สำหรับมาตรฐานการเขียน release notes แบบละเอียด

---

## 8. ขั้นตอนเมื่ออัปเดตเวอร์ชั่นใหม่

### 8.1 เขียน release note ใหม่ใน `current.md`

แก้ `assets/md/en/current.md` และ `assets/md/th/current.md`:

- เปลี่ยน `version:` เป็นเวอร์ชั่นใหม่
- เขียน `title`, `subtitle`, sections ในแต่ละภาษา
- ปฏิบัติตาม [`RELEASE_NOTES_GUIDE.md`](./RELEASE_NOTES_GUIDE.md)
- **ไม่ต้องเขียน `date:` เอง** — ระบบ sync ให้อัตโนมัติ

> ⚠️ **ห้ามแตะไฟล์อื่น** — นักพัฒนาเขียนได้แค่ `current.md` (en + th) เท่านั้น ดู section 3

### 8.2 Commit & deploy (v5.1 — ไม่ต้องส่ง APP_VERSION)

```bash
# 1. ติดตั้ง hooks (ครั้งแรกเท่านั้น)
bash scripts/hooks/install.sh

# 2. Commit — pre-commit hook ตรว version bump อัตโนมัติ
git add assets/md/en/current.md assets/md/th/current.md
git commit -m "release: v2.1.0"
# pre-commit: ✅ version เปลี่ยน 2.0.0 → 2.1.0

# 3. Push — pre-push hook ตร JS syntax + version bump อัตโนมัติ
git push
# pre-push: ✅ ผ่าน

# 4. CI/CD (GitHub Actions) ทำอัตโนมัติ:
#    - validate-release.js --ci
#    - update-version.js (ไม่ต้องส่ง APP_VERSION — อ่านจาก current.md)
#    - commit artifacts กลับเข้า repo
#    - deploy ขึ้น Cloudflare Pages
```

### 8.3 กรณีไม่เปลี่ยน version (ใช้ bypass)

```bash
# 1. เพิ่มเลขใน .release-bypass (ต้องมากกว่า .release-bypass-counter)
echo "1" > .release-bypass

# 2. Commit — pre-commit hook ตรวพบ bypass และอนุญาต
git add .release-bypass assets/js/some-fix.js
git commit -m "fix: minor typo"
# pre-commit: 🔓 bypass token 1 > counter 0 → allow, counter → 1

# 3. ครั้งถัดไปต้องเพิ่มเลขเป็น 2
```

### 8.4 Build script ทำอัตโนมัติ (CI/CD)

1. **Validation** (`validate-release.js --ci`) — ตรว version bump + generated artifacts
2. **STEP 0** — โหลด `release-dates.json` registry
3. **กำหนด release date** — version ใหม่ → ใช้ NOW; version เดิม → ใช้ date เดิม
4. **STEP 1** — สร้าง history จาก git log (backfill registry สำหรับ version เก่า)
5. **STEP 1.7** — สร้าง `releases/v{version}.md` จาก `current.md` (เมื่อ version ใหม่)
6. **STEP 1.8** — สร้าง `releases/index.json` (manifest สำหรับ client)
7. **STEP 2** — sync `date:` ใน `current.md` ให้ตรงกับ registry เสมอ
8. **STEP 3** — สร้าง `version.json` พร้อม `date` จาก registry
9. **STEP 3.5** — บันทึก `release-dates.json` (registry ที่อัปเดตแล้ว)
10. **STEP 4** — HTML cache busting (เพิ่ม `?v={version}-{dateStr}` ให้ assets)

### 8.5 ตรวจสอบหลัง deploy

- [ ] เปิดหน้า What's New บนเว็บ — ควรแสดง release ใหม่
- [ ] ทดสอบในหน้าต่าง incognito — ถ้า `notify: true` popup ควรเด้ง
- [ ] ตรวจสอบภาษาทั้งสอง — แสดงเนื้อหาเดียวกัน
- [ ] ตรวจสอบ `date` ใน popup และหน้า What's New — ควรเป็น date แรกที่บันทึก
- [ ] ตรวจสอบว่า `releases/v{version}.md` และ `releases/index.json` ถูก commit ลง git

---

## 9. Validation Script

`scripts/validate-release.js` คือ validator สำหรับ closed system — ตรวจว่านักพัฒนาแตะเฉพาะ `current.md` เท่านั้น

### 7.1 การใช้งาน

```bash
# ตรวจ working tree
node scripts/validate-release.js

# ตรวจไฟล์ที่ staged ใน git
node scripts/validate-release.js --staged

# ตรวจไฟล์ที่เปลี่ยนใน commit ใด commit หนึ่ง
node scripts/validate-release.js --commit <hash>
```

### 7.2 Exit codes

- `0` = pass (ทุกไฟล์ที่เปลี่ยนเป็นไฟล์ที่นักพัฒนาเขียนได้)
- `1` = fail (มีการแก้ generated artifact — ต้อง revert)

### 7.3 ติดตั้งเป็น git pre-commit hook

```bash
# สร้าง .githooks directory
mkdir -p .githooks

# copy validate-release.js เป็น pre-commit
cp scripts/validate-release.js .githooks/pre-commit
chmod +x .githooks/pre-commit

# บอก git ให้ใช้ hooks directory นี้
git config core.hooksPath .githooks
```

ตอนนี้ทุกครั้งที่ `git commit` จะมี validation ก่อน — ถ้าแก้ generated artifacts จะ commit ไม่ผ่าน

### 7.4 Allowlist (สิ่งที่นักพัฒนาเขียนได้)

ใน `scripts/validate-release.js`:

```javascript
const ALLOWED_FILES = new Set([
  'assets/md/en/current.md',
  'assets/md/th/current.md',
]);
```

ถ้าต้องการให้นักพัฒนาเขียนไฟล์อื่นได้ ให้เพิ่มในนี้ — แต่ควรจำกัดมากที่สุดเพื่อรักษา closed system

---

## 10. อ้างอิงข้ามเอกสาร

- [`RELEASE_NOTES_GUIDE.md`](./RELEASE_NOTES_GUIDE.md) — มาตรฐานการเขียน release notes
- [`04-Internationalization-And-Build.md`](./04-Internationalization-And-Build.md) — ระบบภาษาทั้งหมด (FvLang เป็นส่วนหนึ่ง)
- [`06-Popup-System.md`](./06-Popup-System.md) — PopupSystem ที่ `version-core.js` ใช้
- [`09-Deployment-Guide.md`](./09-Deployment-Guide.md) — Version bumping ใน CI/CD
- [`12-SEO-Guide.md`](./12-SEO-Guide.md) — ⭐ Content freshness ส่งผลต่อ SEO
- [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) — กฎเหล็กที่นักพัฒนา/AI ต้องปฏิบัติตาม
