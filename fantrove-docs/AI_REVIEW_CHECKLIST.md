# AI_REVIEW_CHECKLIST — Checklist สำหรับ AI ตรวจงานตัวเอง

> เอกสารนี้คือ checklist ที่ AI agent ทุกตัวต้องรันผ่านก่อนส่งมอบงาน
>
> **สำหรับ:** AI agents ก่อน "Done" หรือ "ส่งมอบ"
>
> **เป้าหมาย:** ทำให้งานที่ส่งมอบผ่านมาตรฐานขั้นต่ำที่กำหนด ไม่มั่ว ไม่พัง ไม่มี regression

---

## วิธีใช้

1. ก่อนส่งมอบ อ่าน checklist ทั้งหมด
2. ติ๊กทุกข้อที่ทำได้
3. ถ้ามีข้อที่ติ๊กไม่ได้ → กลับไปแก้
4. ถ้าแก้ไม่ได้จริง ๆ → บอกผู้ใช้ว่าข้อไหนไม่ผ่านและทำไม

---

## 📋 Phase A: Pre-flight (ก่อนเริ่มแก้)

### A.1 เข้าใจ task แล้ว

- [ ] อ่าน task ของผู้ใช้ 3 ครั้ง
- [ ] สรุป task ในใจได้ใน 1 ประโยค
- [ ] ถามผู้ใช้ถ้ามีอะไรคลุมเครือ

### A.2 อ่านเอกสารที่เกี่ยวข้อง

- [ ] อ่าน [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) — กฎเหล็ก
- [ ] อ่าน [`AI_CODING_GUIDE.md`](./AI_CODING_GUIDE.md) — มาตรฐานโค้ด
- [ ] อ่านเอกสารระบบที่เกี่ยวข้อง (00-11 ตาม case)

### A.3 สำรวจโค้ดเดิม

- [ ] อ่านไฟล์ที่จะแก้อย่างน้อย 1 รอบ
- [ ] เข้าใจ pattern ที่ใช้ในไฟล์นั้น
- [ ] รู้ว่า function/variable ที่จะแก้ถูกใช้ที่ไหนบ้าง

### A.4 วางแผน

- [ ] แบ่งงานเป็น subtask ถ้าใหญ่
- [ ] ระบุไฟล์ที่จะแก้
- [ ] ระบุระบบอื่นที่อาจกระทบ

---

## 📋 Phase B: During Implementation (ขณะทำ)

### B.1 ยึดมาตรฐานโค้ด

- [ ] ใช้ IIFE pattern (ไม่ใช่ ES modules)
- [ ] ใช้ `'use strict';`
- [ ] ใช้ 2 spaces indent (ไม่ใช่ tab)
- [ ] ใช้ single quotes `'...'`
- [ ] ใช้ semicolon ทุก statement
- [ ] ใช้ braces ครบทุก block
- [ ] ใช้ `const`/`let` (ไม่ใช่ `var`)

### B.2 ไม่ละเมิดกฎเหล็ก

- [ ] ไม่ใช้ React/Vue/jQuery
- [ ] ไม่ใช้ `alert()`/`confirm()`/`prompt()` (ใช้ PopupSystem)
- [ ] ไม่ mutate global state โดยไม่ประกาศ
- [ ] ไม่ใช้ `innerHTML` กับ user input
- [ ] ไม่ลืม `await` ใน async function
- [ ] ไม่กลืน error (try-catch ต้อง log หรือ throw ต่อ)

### B.3 Comments & Documentation

- [ ] ทุกไฟล์มี header comment
- [ ] Public functions มี JSDoc
- [ ] Inline comments อธิบาย "ทำไม" ไม่ใช่ "อะไร"
- [ ] ไม่มี commented-out code
- [ ] TODO/FIXME มีรูปแบบ `// TODO(name): ...`

### B.4 Performance

- [ ] ไม่ query DOM ใน loop
- [ ] ไม่ทำ layout thrash (read/write แยกกัน)
- [ ] ไม่สร้าง DOM ใน loop (ใช้ DocumentFragment)
- [ ] ไม่ใช้ `setInterval` สำหรับ animation
- [ ] Lazy load heavy resources ถ้าได้

---

## 📋 Phase C: Post-implementation (หลังทำเสร็จ)

### C.1 Code Quality

- [ ] อ่านโค้ดที่เขียนอีกครั้ง 1 รอบ
- [ ] ไม่มี `console.log` เหลืออยู่ (ยกเว้นจำเป็น)
- [ ] ไม่มี dead code (function ที่ไม่ถูกเรียก)
- [ ] ไม่มี hardcoded values ที่ควรเป็น constants
- [ ] ชื่อ variable/function สื่อความหมาย
- [ ] ไม่มี magic numbers (ใช้ named constants)

### C.2 Translation (ถ้ากระทบ)

- [ ] เพิ่ม key ใน `assets/lang/en.json`
- [ ] เพิ่ม key เดียวกันใน `assets/lang/th.json`
- [ ] ทดสอบสลับภาษาแล้วข้อความเปลี่ยน

### C.3 Content (ถ้ากระทบ)

- [ ] ไม่เขียนข้อมูลดิบใน `content/*.json`
- [ ] ไม่เพิ่ม collection types ลงใน `index.json`
- [ ] ถ้าเพิ่ม item ใหม่ → `api`, `text`, `name` ครบ
- [ ] ถ้าเพิ่ม subcategory → ลงทะเบียนใน type registry

### C.4 Build & Test

- [ ] รัน `npm run build` ผ่าน (ถ้าแก้ source HTML/translation)
- [ ] ตรวจสอบ `dist/` มีไฟล์ที่คาดไว้
- [ ] ทดสอบบน browser (Chrome อย่างน้อย)
- [ ] ทดสอบทั้ง 2 ภาษา
- [ ] ทดสอบบนมือถือ (responsive)

### C.5 Regression Test

- [ ] ฟีเจอร์เดิมที่ใกล้เคียงยังทำงาน
- [ ] ไม่มี error ใหม่ใน console
- [ ] ไม่มี warning ใหม่ใน console
- [ ] Network tab ไม่มี 404 ใหม่

---

## 📋 Phase C2: SEO (priority สูงสุด)

> ⚠️ ทุกการเปลี่ยนแปลงต้องผ่าน SEO checks นี้ — ดู [`12-SEO-Guide.md`](./12-SEO-Guide.md) และ [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) ส่วน SEO violations

### C2.1 ถ้าแก้/เพิ่ม HTML page

- [ ] มี `<title>` unique, 50-60 ตัวอักษร, ภาษาของหน้า
- [ ] มี `<meta name="description">` unique, 150-160 ตัวอักษร
- [ ] มี `<link rel="canonical">` ที่ถูกต้อง (absolute URL)
- [ ] มี hreflang tags ครบทุกภาษา (en, th, x-default)
- [ ] มี Open Graph tags (og:title, og:description, og:image, og:url)
- [ ] มี Twitter Card tags
- [ ] มี `<html lang="...">` ที่ถูกต้อง
- [ ] มี `<meta name="viewport" content="width=device-width, initial-scale=1">`
- [ ] มี `<h1>` อันเดียวที่อธิบายหน้า
- [ ] ใช้ semantic HTML (`<header>`, `<main>`, `<nav>`, `<footer>`)
- [ ] ไม่ skip heading level (h1 → h2 → h3, ไม่ใช่ h1 → h3)
- [ ] ทุกรูปมี `alt` text ที่สื่อความหมาย
- [ ] ทุกรูปมี `width` + `height` หรือ `aspect-ratio`
- [ ] รูป hero ไม่ใช้ `loading="lazy"`
- [ ] รูปอื่น ๆ ใช้ `loading="lazy" decoding="async"`
- [ ] Link ใช้ `<a href>` ปกติ (ไม่ใช่ JavaScript-only)
- [ ] เนื้อหาสำคัญอยู่ใน static HTML (ไม่ใช่ render ด้วย JS อย่างเดียว)
- [ ] ถ้ามี structured data → ทดสอบด้วย Rich Results Test

### C2.2 ถ้าแก้ URL routing

- [ ] ถ้าเปลี่ยน URL → ตั้ง 301 redirect (ไม่ใช่ 302)
- [ ] อัปเดต sitemap.xml (`generate-sitemap.js`)
- [ ] อัปเดต internal links ทุกที่
- [ ] อัปเด트 hreflang tags ทุกหน้า
- [ ] อัปเดต canonical tags ทุกหน้า

### C2.3 ถ้าแก้ content (emoji, symbol, fancy, cards)

- [ ] ไม่ลบ `api`, `text`, `name` field จาก item เดิม (search index พัง)
- [ ] ถ้าเพิ่ม subcategory → อัปเดต type registry
- [ ] ถ้าเพิ่ม type ใหม่ → อัปเดต index.json + sitemap strategy
- [ ] ใช้ keyword ที่ผู้ใช้ค้นหาจริง ๆ ใน `name.en` และ `name.th`

### C2.4 ถ้าแก้ performance

- [ ] Lighthouse Performance ≥ 90 (mobile + desktop)
- [ ] LCP ≤ 2.5s (Good)
- [ ] INP ≤ 200ms (Good)
- [ ] CLS ≤ 0.1 (Good)
- [ ] ไม่เพิ่ม layout shift ใหม่

### C2.5 ถ้าแก้ translation

- [ ] เพิ่ม key ใน `assets/lang/en.json`
- [ ] เพิ่ม key เดียวกันใน `assets/lang/th.json`
- [ ] ถ้า key นั้นเป็น meta tag → แปลให้เป็นภาษาของไฟล์
- [ ] ทดสอบสลับภาษาแล้ว content เปลี่ยน

### C2.6 ถ้าแก้ release notes

- [ ] แก้ `assets/md/en/current.md` และ `assets/md/th/current.md` ทั้งคู่
- [ ] **ห้าม**สร้างไฟล์ใน `assets/md/{en,th}/releases/` (build script สร้างจาก git history อัตโนมัติ)
- [ ] **ห้าม**แก้ `assets/json/release-history.json` หรือ `version.json` (build script สร้าง)
- [ ] เปลี่ยน `version:` ใน frontmatter เป็นเวอร์ชั่นใหม่
- [ ] ปฏิบัติตาม `RELEASE_NOTES_GUIDE.md` checklist ส่วน 10
- [ ] Commit message: `release: vX.Y.Z`

### C2.7 ทุกกรณี — ตรวจสอบก่อน deploy

- [ ] Build script (`npm run build`) ผ่าน
- [ ] `dist/` มีทุกหน้า × ทุกภาษา
- [ ] `dist/sitemap.xml` อัปเดต
- [ ] `dist/robots.txt` ถูกต้อง
- [ ] Lighthouse SEO = 100 บนหน้าสำคัญ
- [ ] ไม่มี SEO violations ใน [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) ส่วน 8

---

## 📋 Phase D: Documentation (ถ้าจำเป็น)

### D.1 อัปเดตเอกสารระบบ

ถ้าการแก้:
- [ ] เพิ่มฟีเจอร์ใหม่ → อัปเดตเอกสารระบบนั้น
- [ ] เปลี่ยน API → อัปเดตเอกสาร + ระบุว่า breaking change
- [ ] เปลี่ยน behavior → อัปเดตเอกสาร

### D.2 อัปเดต INDEX.md

ถ้า:
- [ ] เพิ่มไฟล์เอกสารใหม่ → เพิ่มใน INDEX.md
- [ ] ลบไฟล์เอกสาร → ลบจาก INDEX.md
- [ ] เปลี่ยนชื่อไฟล์ → อัปเดต link ใน INDEX.md

### D.3 Release Notes (ถ้าใกล้ release)

- [ ] ถ้าเป็น user-facing change → เตรียม release note ตาม [`RELEASE_NOTES_GUIDE.md`](./RELEASE_NOTES_GUIDE.md)
- [ ] ถ้าเป็น breaking change → ระบุใน release note

---

## 📋 Phase D2: Documentation Sync (priority #1 สูงสุด)

> 🥇 เอกสารเป็น priority สูงสุด — สูงกว่า SEO และ Performance ดู [`13-Documentation-Standard.md`](./13-Documentation-Standard.md) และ [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) section 10

### D2.1 ระบุเอกสารที่ต้องอัปเดต

ใช้ตารางใน [`13-Documentation-Standard.md`](./13-Documentation-Standard.md) section 8.1:

- [ ] ถ้าเพิ่ม/ลด module → อัปเดตเอกสารระบบนั้น + `00-System-Architecture.md`
- [ ] ถ้าเปลี่ยน public API → อัปเดตเอกสารระบบนั้น + `00-System-Architecture.md`
- [ ] ถ้าเปลี่ยน namespace (`window.X`) → อัปเดต `00-System-Architecture.md`
- [ ] ถ้าเปลี่ยน version → อัปเดต header ของเอกสารระบบนั้น
- [ ] ถ้าเพิ่ม/ลด custom event → อัปเดต `00-System-Architecture.md`
- [ ] ถ้าเปลี่ยน build process → อัปเดต `09-Deployment-Guide.md`
- [ ] ถ้าเพิ่ม/ลด content type → อัปเดต `10-Content-Guide.md` + `05-Content-Data-Service.md`
- [ ] ถ้าเพิ่ม/ลด ภาษา → อัปเดต `04-Internationalization-And-Build.md` + `12-SEO-Guide.md`
- [ ] ถ้าเพิ่ม/ลด หน้าเว็บ → อัปเดต `00-System-Architecture.md` + `09-Deployment-Guide.md`

### D2.2 อัปเดตเอกสารตามมาตรฐาน

- [ ] ใช้ H1 + header blockquote + สารบัญ + cross-references
- [ ] ใช้ "Fantrove" ไม่ใช่ "FanTrove" หรือ "Fantrove Page"
- [ ] ใช้ relative path ใน cross-references
- [ ] ใช้ชื่อไฟล์จริง (หลัง rename)
- [ ] ใช้ language tag ใน code blocks
- [ ] ใช้ ✅/❌ markers สำหรับตัวอย่างดี/ไม่ดี
- [ ] น้ำเสียงเป็นมิตร ตรงไปตรงมา ไม่ทางการเกินไป
- [ ] ไม่มีคำต้องห้าม (ปฏิวัติ, พลิกโฉม, สุดยอด)

### D2.3 Verify เอกสารอื่นที่อ้างถึง

- [ ] ใช้ `grep -rn "keyword" fantrove-docs/` หาเอกสารอื่นที่อ้างถึงสิ่งที่เปลี่ยน
- [ ] ตรวจทุกไฟล์ที่พบว่ายังตรงไหม
- [ ] อัปเดตถ้าจำเป็น

### D2.4 ตรวจสอบว่าเอกสารตรงกับโค้ดจริง

- [ ] ชื่อ module/function/variable ที่อ้างถึงมีจริงในโค้ด
- [ ] เลข version ตรงกับ source code
- [ ] File paths ตรงกับจริง
- [ ] API signatures ตรงกับจริง

### D2.5 Commit code + docs ใน commit เดียวกัน

- [ ] ไม่แยก commit code และ docs (ยกเว้นกรณีพิเศษ)
- [ ] Commit message ระบุทั้ง code และ docs ที่เปลี่ยน

### D2.6 ถ้าเจอเอกสารไม่ตรงจริง (ที่ไม่เกี่ยวกับ task ปัจจุบัน)

- [ ] บันทึกใน PR description: "พบเอกสารไม่ตรงจริงที่ [path]:[line]"
- [ ] (optional) แก้เอกสารนั้นด้วย ถ้าเป็นเรื่องเล็ก
- [ ] (ถ้าใหญ่) เปิด issue แยก

---

## 📋 Phase E: Pre-commit

### E.1 Commit Message

- [ ] ใช้ conventional format: `<type>(<scope>): <subject>`
- [ ] Subject imperative mood, ≤72 chars
- [ ] Body อธิบาย "ทำไม" (ถ้าจำเป็น)
- [ ] Reference issue: `Closes #123` (ถ้ามี)

### E.2 Branch

- [ ] ใช้ branch แยก (ไม่ใช่ main โดยตรง)
- [ ] ชื่อ branch ในรูปแบบ `<type>/<description>`

### E.3 Files Staged

- [ ] ตรวจสอบ `git status` ว่ามีแค่ไฟล์ที่เกี่ยวข้อง
- [ ] ไม่มี `dist/` ใน staged files (ต้องอยู่ใน .gitignore)
- [ ] ไม่มี `node_modules/` ใน staged files
- [ ] ไม่มี `.DS_Store` หรือไฟล์ OS-specific

---

## 📋 Phase F: Pre-PR

### F.1 PR Description

- [ ] มี Summary
- [ ] มี Changes list
- [ ] มี Files Modified list
- [ ] มี Testing section
- [ ] มี Related Issues (ถ้ามี)
- [ ] มี Checklist ติ๊กครบ

### F.2 Self-review

- [ ] อ่าน diff ทั้งหมดอีกครั้ง
- [ ] คิดว่า reviewer จะเข้าใจการเปลี่ยนแปลงไหม
- [ ] มีอะไรที่อาจทำให้สับสนไหม

### F.3 Cross-system Impact

- [ ] คิดว่าการแก้กระทบระบบอื่นไหม
- [ ] ระบบที่ใช้ function ที่แก้ — ยังทำงานไหม
- [ ] ระบบที่ฟัง event เดียวกัน — ยังทำงานไหม

---

## 📋 Phase G: Final Delivery

### G.1 สรุปสิ่งที่ทำ

- [ ] บอกผู้ใช้ว่าทำอะไรบ้าง
- [ ] บอกไฟล์ที่แก้
- [ ] บอกวิธีทดสอบ

### G.2 เสนอ Next Steps

- [ ] บอกผู้ใช้ว่าควรทำอะไรต่อ
- [ ] ถ้ามี known limitations → บอกไว้

### G.3 Worklog (ถ้า multi-agent)

- [ ] บันทึก Task ID
- [ ] บันทึก Agent name
- [ ] บันทึก Task description
- [ ] บันทึก Work Log (ขั้นตอนที่ทำ)
- [ ] บันทึก Stage Summary (ผลลัพธ์)

---

## 🚨 Red Flags (ห้ามส่งมอบถ้ามี)

ถ้ามีข้อใดข้อหนึ่งต่อไปนี้ — ห้ามส่งมอบ:

- ❌ Build fail
- ❌ มี `console.error` ใหม่ที่ไม่ได้ handle
- ❌ ฟีเจอร์เดิมพัง
- ❌ ละเมิดกฎเหล็กใน `AI_FORBIDDEN.md`
- ❌ ไม่ได้ทดสอบบน browser
- ❌ ไม่ได้อัปเดตเอกสารที่ควรอัปเดต
- ❌ มี commented-out code
- ❌ มี `console.log` debug เหลืออยู่
- ❌ มี TODO ที่ไม่ได้ระบุ owner
- ❌ **ละเมิด SEO rules** — ลบ meta tag, เปลี่ยน URL ไม่ตั้ง redirect, เนื้อหา JS-only
- ❌ **Lighthouse SEO < 100** บนหน้าที่แก้
- ❌ **Lighthouse Performance < 80** บนหน้าที่แก้
- ❌ **CLS > 0.25** หรือ **LCP > 4s** บนหน้าที่แก้

---

## ✅ Green Lights (พร้อมส่งมอบถ้าทำครบ)

ทั้งหมดนี้ต้องเป็นจริง:

- ✅ ผ่าน checklist Phase A-F
- ✅ Build ผ่าน (ถ้าจำเป็น)
- ✅ ทดสอบบน browser ผ่าน
- ✅ ไม่มี regression
- ✅ เอกสารอัปเดต (ถ้าจำเป็น)
- ✅ Commit message ตรงมาตรฐาน
- ✅ PR description ครบ (ถ้ามี PR)

---

## สรุป

```
Phase A: Pre-flight     → เข้าใจ task, อ่านเอกสาร, สำรวจโค้ด
Phase B: During          → ยึดมาตรฐาน, ไม่ละเมิดกฎ, comments, performance
Phase C: Post            → อ่านอีกครั้ง, translation, content, build, regression
Phase D: Docs            → อัปเดตเอกสารระบบ, INDEX, release notes
Phase E: Pre-commit      → commit message, branch, staged files
Phase F: Pre-PR          → PR description, self-review, cross-system
Phase G: Final           → สรุป, next steps, worklog
```

> AI ที่ดีไม่ใช่ AI ที่ทำเร็ว — แต่เป็น AI ที่ส่งมอบของที่ผ่าน checklist ทุกข้อ
