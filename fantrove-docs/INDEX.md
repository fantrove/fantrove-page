# 📚 Fantrove Docs — สารบัญเอกสารทั้งหมด

> ศูนย์กลางเอกสารของโปรเจกต์ **Fantrove** (หรือชื่อเต็มคือ **Fantrove Verse**) — แพลตฟอร์มคลังอีโมจิ สัญลักษณ์ ข้อความแฟนซี และคอลเลกชันอื่น ๆ ที่ทำงานเป็น static website บน Cloudflare Pages

ทุกเอกสารที่เกี่ยวกับระบบ การพัฒนา และการดูแลโปรเจกต์อยู่ที่นี่ที่เดียว อ่านตามลำดับหมายเลขหรือเลือกเฉพาะที่ต้องการได้

---

## 🎯 Priority ของโปรเจกต์

งานทุกอย่างใน Fantrove มีความสำคัญอยู่แล้ว แต่มี priority ที่สูงเป็นพิเศษ 3 ด้านที่ต้องคำนึงถึงเสมอเมื่อตัดสินใจอะไรก็ตาม:

| Priority | ระดับ | คำอธิบาย |
|---|---|---|
| 🥇 **Documentation** | #1 สูงสุด | เอกสารเป็นตัวอธิบายระบบ — ถ้าผิด ทุกอย่างตามผิด ทุกการเปลี่ยนแปลงระบบต้อง sync กับเอกสาร ดู [`13-Documentation-Standard.md`](./13-Documentation-Standard.md) |
| 🥈 **SEO** | สูงสุด (พิเศษ) | Search engine visibility เป็นหัวใจของการเติบโต — ทุกการเปลี่ยนแปลงต้องไม่ทำลาย SEO และควรเสริม SEO ถ้าเป็นไปได้ ดู [`12-SEO-Guide.md`](./12-SEO-Guide.md) |
| 🥉 **Performance** | สูง | Core Web Vitals ส่งผลต่อทั้ง UX และ SEO — ดู [`08-Performance-Architecture.md`](./08-Performance-Architecture.md) |

> **กฎเหล็ก:** เมื่อมี conflict ระหว่าง feature ใหม่กับ Documentation — **อัปเดตเอกสารก่อน** แล้วค่อย merge feature เมื่อมี conflict ระหว่าง feature ใหม่กับ SEO — **ให้ SEO ชนะเสมอ** เว้นแต่จะมีเหตุผลที่ชัดเจนมากเป็นพิเศษ และต้องบันทึกเหตุผลนั้นไว้ใน PR description

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
| 🔍 **ทำ SEO / เพิ่ม ranking** | [`12-SEO-Guide.md`](./12-SEO-Guide.md) ⭐ |
| 📝 **เขียน/แก้เอกสาร** | [`13-Documentation-Standard.md`](./13-Documentation-Standard.md) 🥇 (priority #1) |
| 🎨 **ออกแบบหน้าเว็บ/UX** | [`14-System-Design-And-UX.md`](./14-System-Design-And-UX.md) 🎨 (training data for AI) |

---

## 📖 เอกสารระบบ (00–14)

เอกสารหมายเลขนี้อธิบายระบบทั้งหมดของ Fantrove ตั้งแต่ภาพรวมไปจนถึงรายละเอียด module และ function เขียนเป็นภาษาไทย เน้นความลึกเพื่อให้ AI และนักพัฒนาเข้าใจระบบได้ครบถ้วนโดยไม่ต้องอ่านโค้ดโดยตรง

| # | เอกสาร | อธิบาย | ไฟล์หลักที่ครอบคลุม |
|---|---|---|---|
| 00 | [System Architecture](./00-System-Architecture.md) | ภาพรวมสถาปัตยกรรมทั้งโปรเจกต์ — 7 ระบบหลัก, การเชื่อมต่อ, โครงสร้างไฟล์, URL routing | ทั้งโปรเจกต์ |
| 01 | [Virtual Scroll Rendering](./01-Virtual-Scroll-Rendering.md) | Virtual scroll engine สำหรับแสดงข้อมูลจำนวนมาก พร้อม memory management | `assets/js/ure/` |
| 02 | [Search System](./02-Search-System.md) | ระบบค้นหา client-side แบบ two-tier (substring + Fuse.js fuzzy) | `assets/js/search-*` |
| 03 | [Navigation & Content](./03-Navigation-And-Content.md) | Navigation & content management สำหรับหน้า Discover (SPA) | `assets/js/nav-core*` |
| 04 | [Internationalization & Build](./04-Internationalization-And-Build.md) | ระบบแปลภาษา client-side พร้อม build-time static generation | `assets/js/lang*` |
| 05 | [Content Data Service](./05-Content-Data-Service.md) | Data access layer สำหรับ content (emoji, symbol, fancy, cards) | `assets/js/con-data-service/` |
| 06 | [Popup System](./06-Popup-System.md) | ระบบ popup ส่วนกลาง — 9 presets, fullscreen, zero coupling | `assets/js/popup.js` + modules |
| 07 | [Loading System](./07-Loading-System.md) | Fullscreen Visual Loader — หน้าจอโหลดที่ครอบการเปลี่ยนเนื้อหา | `assets/js/loading-system/fvl.js` |
| 08 | [Performance Architecture](./08-Performance-Architecture.md) | เทคนิค performance ทั้งโปรเจกต์ — virtual scroll, web worker, cache, memory + Core Web Vitals | cross-cutting |
| 09 | [Deployment Guide](./09-Deployment-Guide.md) | วิธี deploy บน Cloudflare Pages, build script, environment variables | `scripts/`, `_redirects`, `_headers` |
| 10 | [Content Guide](./10-Content-Guide.md) | วิธีเพิ่ม/แก้ content (emoji, symbol, fancy, cards) | `assets/db/con-data/` |
| 11 | [Release Notes System](./11-Release-Notes-System.md) | ระบบหน้า "มีอะไรใหม่" — release notes ที่อ่านจาก markdown | `assets/md/`, `assets/js/new.js` |
| 12 ⭐ | [SEO Guide](./12-SEO-Guide.md) | กลยุทธ์ SEO ระดับ platform — Technical SEO, structured data, Core Web Vitals, international SEO, E-E-A-T | cross-cutting (priority #2) |
| 13 🥇 | [Documentation Standard](./13-Documentation-Standard.md) | มาตรฐานการเขียน/อัปเดตเอกสาร — โครงสร้าง, น้ำเสียง, cross-references, docs sync with code | cross-cutting (priority #1 สูงสุด) |
| 14 🎨 | [System Design & UX](./14-System-Design-And-UX.md) | หลักการออกแบบระบบและ UX — design tokens, mobile-first, responsive, components, animation, a11y, performance-driven | cross-cutting (training data for AI) |

---

## 🤖 เอกสารสำหรับ AI Agents

เอกสารเหล่านี้กำหนดมาตรฐานการทำงานของ AI agent ที่พัฒนาโปรเจกต์ — ทุก AI ที่รับงานต้องอ่านและยึดตามเอกสารเหล่านี้

| เอกสาร | วัตถุประสงค์ |
|---|---|
| [AI_CODING_GUIDE.md](./AI_CODING_GUIDE.md) | มาตรฐานการเขียนโค้ด — naming, pattern, structure, file organization, **SEO-friendly code** ที่ต้องยึดติด |
| [AI_TASK_WORKFLOW.md](./AI_TASK_WORKFLOW.md) | วิธีทำงานแบบ task-based — อ่านระบบก่อน → วางแผน (รวม SEO impact) → ทำ → ตรวจ → สรุป |
| [AI_COMMIT_GUIDE.md](./AI_COMMIT_GUIDE.md) | มาตรฐาน commit message, PR description, changelog |
| [AI_REVIEW_CHECKLIST.md](./AI_REVIEW_CHECKLIST.md) | Checklist สำหรับ AI ตรวจงานตัวเองก่อนส่งมอบ — รวม **SEO checks** |
| [AI_FORBIDDEN.md](./AI_FORBIDDEN.md) | สิ่งที่ห้ามทำ — pattern ที่ห้ามใช้, ไฟล์ที่ห้ามแก้, **SEO violations**, assumption ที่ผิดบ่อย |

---

## 📝 เอกสารมาตรฐานการทำงาน

| เอกสาร | วัตถุประสงค์ |
|---|---|
| [RELEASE_NOTES_GUIDE.md](./RELEASE_NOTES_GUIDE.md) | มาตรฐานการเขียน release notes ทุกเวอร์ชั่น — ทำให้ผู้ใช้ทั่วไปเข้าใจการอัปเดต |

---

## 📋 เอกสารที่อยู่นอก fantrove-docs/

เอกสารเหล่านี้อยู่นอก `fantrove-docs/` เพราะเป็นมาตรฐานของ GitHub หรือ runtime ต้องการ path เฉพาะ

| เอกสาร | ตำแหน่ง | เหตุผล |
|---|---|---|
| `README.md` | root | GitHub standard — แสดงบนหน้า repo |
| `LICENSE` | root | GitHub standard — ต้องอยู่ที่ root |
| `NOTICE` | root | Apache 2.0 license requirement |
| `CODE_OF_CONDUCT.md` | root | GitHub community standard — คาดหวังให้อยู่ที่ root |
| Release notes | `assets/md/{en,th}/` | runtime อ่านจาก path นี้ (`new.js`, `version-core.js`) |

---

## 🗺️ แผนภาพความสัมพันธ์ระหว่างเอกสาร

```
                   INDEX.md (คุณอยู่ที่นี่)
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   📚 เอกสารระบบ    🤖 เอกสาร AI    📝 มาตรฐาน
   (00-14)          (AI_*)           (RELEASE_NOTES_*)
        │               │
        ▼               │
   00-System-Arch ───────┐ (จุดเริ่มต้น)
        │               │
        ├──── 13-Documentation-Standard 🥇 (priority #1 สูงสุด)
        ├──── 14-System-Design-And-UX 🎨 (training data)
        ├──── 12-SEO-Guide ⭐ (priority #2)
        │               │
        ▼               ▼
   01-URE ◄──────── AI_TASK_WORKFLOW
   02-Search        (บอกลำดับการอ่าน)
   03-Nav-Core           │
   04-Language           ▼
   05-ConData       AI_FORBIDDEN
   06-Popup         (กฎเหล็กก่อนแก้โค้ด — รวม SEO + Documentation violations)
   07-Loading            │
   08-Performance        ▼
   09-Deployment    AI_REVIEW_CHECKLIST
   10-Content       (ก่อนส่งมอบ — รวม SEO + Documentation Sync checks)
   11-Whats-New
```

---

## 📌 คำแนะนำการอ่านตามสถานการณ์

### สถานการณ์ 1: AI รับ task แก้ bug ในระบบ search

1. `AI_TASK_WORKFLOW.md` — เข้าใจวิธีทำงาน
2. `AI_FORBIDDEN.md` — รู้สิ่งที่ห้ามทำ (รวม SEO violations)
3. `00-System-Architecture.md` — เข้าใจภาพรวม
4. `02-Search-System.md` — เข้าใจระบบที่จะแก้
5. `12-SEO-Guide.md` — เช็คว่าการแก้นี้กระทบ SEO ไหม
6. แก้โค้ด
7. `AI_REVIEW_CHECKLIST.md` — ตรวจก่อนส่ง (รวม SEO checks)
8. `AI_COMMIT_GUIDE.md` — เขียน commit message

### สถานการณ์ 2: เพิ่มหมวดอีโมจิใหม่

1. `10-Content-Guide.md` — รู้วิธีเพิ่ม content
2. `05-Content-Data-Service.md` — เข้าใจโครงสร้างข้อมูล
3. `12-SEO-Guide.md` — เช็ค SEO ของ content ใหม่ (heading hierarchy, image alt, structured data)
4. เพิ่มไฟล์ JSON ใน `assets/db/con-data/`
5. อัปเดต index.json + sitemap
6. ทดสอบบนเว็บ

### สถานการณ์ 3: เขียน release notes หลัง ship เวอร์ชั่นใหม่

1. `RELEASE_NOTES_GUIDE.md` — มาตรฐานการเขียน
2. เขียน `assets/md/th/current.md` และ `assets/md/en/current.md`
3. รันผ่าน checklist ใน guide

### สถานการณ์ 4: เพิ่มหน้าเว็บใหม่

1. `09-Deployment-Guide.md` — เข้าใจ build & routing
2. `12-SEO-Guide.md` — เข้าใจ SEO requirements สำหรับหน้าใหม่ (meta tags, hreflang, structured data, sitemap)
3. `04-Internationalization-And-Build.md` — เพิ่ม translation
4. สร้าง HTML + ทุกภาษา
5. อัปเดต sitemap

### สถานการณ์ 5: ปรับ Core Web Vitals

1. `08-Performance-Architecture.md` — เข้าใจเทคนิค performance
2. `12-SEO-Guide.md` — ดู Core Web Vitals thresholds และวิธีวัด
3. ปรับโค้ด
4. วัดด้วย Lighthouse / PageSpeed Insights

---

## 📅 วิธีดูแลเอกสาร

- เมื่อเพิ่มระบบใหม่ → สร้างเอกสารหมายเลขใหม่ (13, 14, ...) และอัปเดต INDEX.md
- เมื่อเปลี่ยนแปลงระบบหลัก → อัปเดตเอกสารหมายเลขนั้น + อัปเดต `00-System-Architecture.md` ถ้าจำเป็น
- เมื่อเปลี่ยนแปลงที่กระทบ SEO → อัปเดต `12-SEO-Guide.md` ด้วย
- เมื่อเปลี่ยนมาตรฐานการทำงาน → อัปเดตเอกสาร `AI_*` หรือ `RELEASE_NOTES_GUIDE.md`
- ทุกการแก้ไขเอกสาร → commit พร้อมข้อความ `docs: ...` ตามมาตรฐานใน `AI_COMMIT_GUIDE.md`

---

> หากเอกสารไหนข้อมูลไม่ตรงกับโค้ดจริง ให้ถือว่าโค้ดเป็นความจริง แล้วเปิด issue เพื่อแก้เอกสาร
