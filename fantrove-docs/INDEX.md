# 📚 Fantrove Docs — สารบัญเอกสารทั้งหมด

> ศูนย์กลางเอกสารของโปรเจกต์ **Fantrove** (หรือชื่อเต็มคือ **Fantrove Verse**) — แพลตฟอร์มคลังอีโมจิ สัญลักษณ์ ข้อความแฟนซี และ AI tool cards ที่ทำงานเป็น static website บน Cloudflare Pages

ทุกเอกสารที่เกี่ยวกับระบบ การพัฒนา และการดูแลโปรเจกต์อยู่ที่นี่ที่เดียว อ่านตามลำดับหมายเลขหรือเลือกเฉพาะที่ต้องการได้

---

## 🚀 เริ่มอ่านที่ไหน?

| คุณคือใคร | เริ่มที่ไหน |
|---|---|
| 🤖 **AI agent รับงาน** | [`AI_TASK_WORKFLOW.md`](./AI_TASK_WORKFLOW.md) → [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) → [`00-System-Architecture.md`](./00-System-Architecture.md) |
| 👨‍💻 **นักพัฒนาใหม่** | [`00-System-Architecture.md`](./00-System-Architecture.md) → เลือกระบบที่จะแก้ |
| 📝 **เขียน release notes** | [`RELEASE_NOTES_GUIDE.md`](./RELEASE_NOTES_GUIDE.md) |
| 🎨 **เพิ่มอีโมจิ/สัญลักษณ์** | [`10-Content-Guide.md`](./10-Content-Guide.md) |
| 🚢 **deploy เว็บ** | [`09-Deployment-Guide.md`](./09-Deployment-Guide.md) |
| ⚡ **ปรับประสิทธิภาพ** | [`08-Performance-Architecture.md`](./08-Performance-Architecture.md) |

---

## 📖 เอกสารระบบ (00–11)

เอกสารหมายเลขนี้อธิบายระบบทั้งหมดของ Fantrove ตั้งแต่ภาพรวมไปจนถึงรายละเอียด module และ function เขียนเป็นภาษาไทย เน้นความลึกเพื่อให้ AI และนักพัฒนาเข้าใจระบบได้ครบถ้วนโดยไม่ต้องอ่านโค้ดโดยตรง

| # | เอกสาร | อธิบาย | ไฟล์หลักที่ครอบคลุม |
|---|---|---|---|
| 00 | [System Architecture](./00-System-Architecture.md) | ภาพรวมสถาปัตยกรรมทั้งโปรเจกต์ — 7 ระบบหลัก, การเชื่อมต่อ, โครงสร้างไฟล์, URL routing | ทั้งโปรเจกต์ |
| 01 | [URE — Universal Render Engine](./01-URE-Universal-Render-Engine.md) | Virtual scroll engine สำหรับแสดงข้อมูลจำนวนมาก พร้อม memory management | `assets/js/ure/` (13 ไฟล์) |
| 02 | [Search System](./02-Search-System.md) | ระบบค้นหา client-side แบบ two-tier (substring + Fuse.js fuzzy) | `assets/js/search-*` (15 ไฟล์) |
| 03 | [Nav-Core System](./03-Nav-Core-System.md) | Navigation & content management สำหรับหน้า Discover (SPA) | `assets/js/nav-core*` (16 ไฟล์) |
| 04 | [Language i18n System](./04-Language-i18n-System.md) | ระบบแปลภาษา client-side พร้อม build-time static generation | `assets/js/lang*` (16 ไฟล์) |
| 05 | [ConData Service](./05-ConData-Service.md) | Data access layer สำหรับ content (emoji, symbol, fancy, cards) | `assets/js/con-data-service/` |
| 06 | [Popup System](./06-Popup-System.md) | ระบบ popup ส่วนกลาง — 9 presets, fullscreen, zero coupling | `assets/js/popup.js` + modules |
| 07 | [Loading System — FVL](./07-Loading-System-FVL.md) | Fullscreen Visual Loader — หน้าจอโหลดที่ครอบการเปลี่ยนเนื้อหา | `assets/js/loading-system/fvl.js` |
| 08 | [Performance Architecture](./08-Performance-Architecture.md) | เทคนิค performance ทั้งโปรเจกต์ — virtual scroll, web worker, cache, memory | cross-cutting |
| 09 | [Deployment Guide](./09-Deployment-Guide.md) | วิธี deploy บน Cloudflare Pages, build script, environment variables | `scripts/`, `_redirects`, `_headers` |
| 10 | [Content Guide](./10-Content-Guide.md) | วิธีเพิ่ม/แก้ content (emoji, symbol, fancy, cards) | `assets/db/con-data/` |
| 11 | [What's New System](./11-Whats-New-System.md) | ระบบหน้า "มีอะไรใหม่" — release notes ที่อ่านจาก markdown | `assets/md/`, `assets/js/new.js`, `version-core.js` |

---

## 🤖 เอกสารสำหรับ AI Agents

เอกสารเหล่านี้กำหนดมาตรฐานการทำงานของ AI agent ที่พัฒนาโปรเจกต์ — ทุก AI ที่รับงานต้องอ่านและยึดตามเอกสารเหล่านี้

| เอกสาร | วัตถุประสงค์ |
|---|---|
| [AI_CODING_GUIDE.md](./AI_CODING_GUIDE.md) | มาตรฐานการเขียนโค้ด — naming, pattern, structure, file organization ที่ต้องยึดติด |
| [AI_TASK_WORKFLOW.md](./AI_TASK_WORKFLOW.md) | วิธีทำงานแบบ task-based — อ่านระบบก่อน → วางแผน → ทำ → ตรวจ → สรุป |
| [AI_COMMIT_GUIDE.md](./AI_COMMIT_GUIDE.md) | มาตรฐาน commit message, PR description, changelog |
| [AI_REVIEW_CHECKLIST.md](./AI_REVIEW_CHECKLIST.md) | Checklist สำหรับ AI ตรวจงานตัวเองก่อนส่งมอบ |
| [AI_FORBIDDEN.md](./AI_FORBIDDEN.md) | สิ่งที่ห้ามทำ — pattern ที่ห้ามใช้, ไฟล์ที่ห้ามแก้, assumption ที่ผิดบ่อย |

---

## 📝 เอกสารมาตรฐานการทำงาน

| เอกสาร | วัตถุประสงค์ |
|---|---|
| [RELEASE_NOTES_GUIDE.md](./RELEASE_NOTES_GUIDE.md) | มาตรฐานการเขียน release notes ทุกเวอร์ชั่น — ทำให้ผู้ใช้ทั่วไปเข้าใจการอัปเดต |

---

## 📋 เอกสาร Project Meta

| เอกสาร | วัตถุประสงค์ |
|---|---|
| [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) | จรรยาบรรณของชุมชนผู้มีส่วนร่วมในโปรเจกต์ |

---

## 🗺️ แผนภาพความสัมพันธ์ระหว่างเอกสาร

```
                   INDEX.md (คุณอยู่ที่นี่)
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   📚 เอกสารระบบ    🤖 เอกสาร AI    📝 มาตรฐาน
   (00-11)          (AI_*)           (RELEASE_NOTES_*)
        │               │
        ▼               │
   00-System-Arch ───────┐ (จุดเริ่มต้น)
        │               │
        ▼               ▼
   01-URE ◄──────── AI_TASK_WORKFLOW
   02-Search        (บอกลำดับการอ่าน)
   03-Nav-Core           │
   04-Language           ▼
   05-ConData       AI_FORBIDDEN
   06-Popup         (กฎเหล็กก่อนแก้โค้ด)
   07-Loading            │
   08-Performance        ▼
   09-Deployment    AI_CODING_GUIDE
   10-Content       (มาตรฐานโค้ด)
   11-Whats-New          │
                         ▼
                   AI_REVIEW_CHECKLIST
                   (ก่อนส่งมอบ)
```

---

## 📌 คำแนะนำการอ่านตามสถานการณ์

### สถานการณ์ 1: AI รับ task แก้ bug ในระบบ search

1. `AI_TASK_WORKFLOW.md` — เข้าใจวิธีทำงาน
2. `AI_FORBIDDEN.md` — รู้สิ่งที่ห้ามทำ
3. `00-System-Architecture.md` — เข้าใจภาพรวม
4. `02-Search-System.md` — เข้าใจระบบที่จะแก้
5. แก้โค้ด
6. `AI_REVIEW_CHECKLIST.md` — ตรวจก่อนส่ง
7. `AI_COMMIT_GUIDE.md` — เขียน commit message

### สถานการณ์ 2: เพิ่มหมวดอีโมจิใหม่

1. `10-Content-Guide.md` — รู้วิธีเพิ่ม content
2. `05-ConData-Service.md` — เข้าใจโครงสร้างข้อมูล
3. เพิ่มไฟล์ JSON ใน `assets/db/con-data/`
4. อัปเดต index.json
5. ทดสอบบนเว็บ

### สถานการณ์ 3: เขียน release notes หลัง ship เวอร์ชั่นใหม่

1. `RELEASE_NOTES_GUIDE.md` — มาตรฐานการเขียน
2. เขียน `assets/md/th/current.md` และ `assets/md/en/current.md`
3. รันผ่าน checklist ใน guide

### สถานการณ์ 4: เปลี่ยนภาษา UI ของหน้าใหม่

1. `04-Language-i18n-System.md` — เข้าใจระบบภาษา
2. เพิ่ม key ใน `assets/lang/en.json` และ `th.json`
3. ใช้ marker `data-i18n` ใน HTML
4. ทดสอบสลับภาษา

---

## 🔗 เอกสารที่อยู่นอก fantrove-docs/

เอกสารเหล่านี้อยู่นอก `fantrove-docs/` เพราะเป็นของที่ระบบ runtime ต้องใช้ หรือเป็นมาตรฐานของ GitHub

| เอกสาร | ตำแหน่ง | เหตุผลที่ไม่ย้าย |
|---|---|---|
| `README.md` | root | GitHub standard — แสดงบนหน้า repo |
| `LICENSE` | root | GitHub standard — ต้องอยู่ที่ root |
| `NOTICE` | root | Apache 2.0 license requirement |
| Release notes | `assets/md/{en,th}/` | runtime อ่านจาก path นี้ (`new.js`, `version-core.js`) |

---

## 📅 วิธีดูแลเอกสาร

- เมื่อเพิ่มระบบใหม่ → สร้างเอกสารหมายเลขใหม่ (12, 13, ...) และอัปเดต INDEX.md
- เมื่อเปลี่ยนแปลงระบบหลัก → อัปเดตเอกสารหมายเลขนั้น + อัปเดต 00-System-Architecture.md ถ้าจำเป็น
- เมื่อเปลี่ยนมาตรฐานการทำงาน → อัปเดตเอกสาร AI_* หรือ RELEASE_NOTES_GUIDE.md
- ทุกการแก้ไขเอกสาร → commit พร้อมข้อความ `docs: ...` ตามมาตรฐานใน `AI_COMMIT_GUIDE.md`

---

> หากเอกสารไหนข้อมูลไม่ตรงกับโค้ดจริง ให้ถือว่าโค้ดเป็นความจริง แล้วเปิด issue เพื่อแก้เอกสาร
