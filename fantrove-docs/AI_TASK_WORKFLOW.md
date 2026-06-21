# AI_TASK_WORKFLOW — วิธีทำงานแบบ Task-based สำหรับ AI Agents

> เอกสารนี้กำหนดลำดับขั้นการทำงานที่ AI agent ทุกตัวต้องยึดเมื่อรับ task จากผู้ใช้
>
> **สำหรับ:** AI agents ที่รับ task พัฒนา/แก้/เพิ่ม feature ใน Fantrove
>
> **เป้าหมาย:** ทำให้งานที่ AI ส่งมอบ "ไม่มั่ว รอบคอบ และตรงตามที่ผู้ใช้ต้องการ"

---

## สารบัญ

1. [หลักการ 5 ข้อ](#1-หลักการ-5-ข้อ)
2. [Phase 1: ทำความเข้าใจ Task](#phase-1-ทำความเข้าใจ-task)
3. [Phase 2: วางแผน](#phase-2-วางแผน)
4. [Phase 3: ดำเนินการ](#phase-3-ดำเนินการ)
5. [Phase 4: ตรวจสอบ](#phase-4-ตรวจสอบ)
6. [Phase 5: ส่งมอบ](#phase-5-ส่งมอบ)
7. [Anti-patterns](#anti-patterns)

---

## 1. หลักการ 5 ข้อ

### 1.1 เข้าใจก่อนทำ

ห้ามเริ่มแก้โค้ดก่อนเข้าใจ:
- ผู้ใช้ต้องการอะไรจริง ๆ
- ระบบที่จะแก้ทำงานยังไง
- ผลกระทบต่อระบบอื่นมีอะไรบ้าง

### 1.2 ยึดตามเอกสาร

ทุกการตัดสินใจต้องมีเอกสารรองรับ — ไม่เดา
- กฎเหล็ก: [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md)
- มาตรฐานโค้ด: [`AI_CODING_GUIDE.md`](./AI_CODING_GUIDE.md)
- ระบบต่าง ๆ: [`00-11`](./INDEX.md)

### 1.3 ทำทีละขั้น

ห้ามทำหลายอย่างพร้อมกัน — ทำทีละส่วน ตรวจทีละส่วน

### 1.4 ตรวจก่อนส่ง

ก่อนส่งมอบงาน ต้องผ่าน [`AI_REVIEW_CHECKLIST.md`](./AI_REVIEW_CHECKLIST.md)

### 1.5 สื่อสารชัดเจน

- บอกว่ากำลังทำอะไร
- บอกว่าทำเสร็จแล้วหรือยัง
- บอกว่ามีปัญหาอะไร (ถ้ามี)

---

## Phase 1: ทำความเข้าใจ Task

### Step 1.1: อ่าน task อย่างละเอียด

อ่านคำขอของผู้ใช้ 3 ครั้ง:
1. อ่านเร็วเพื่อเข้าใจภาพรวม
2. อ่านช้าเพื่อจับทุก detail
3. อ่านอีกครั้งเพื่อสรุปในใจว่าต้องทำอะไร

### Step 1.2: ระบุความคลุมเครือ

ถ้ามีอะไรไม่ชัดเจน ให้ถามผู้ใช้ก่อนเริ่มทำ — อย่าเดา

ตัวอย่างคำถามที่ควรถาม:
- "ผู้ใช้เป้าหมายคือใคร?"
- "ต้องการ output เป็นไฟล์หรือ code change?"
- "มี constraint ด้านเวลา/ขนาด/dependency ไหม?"
- "ต้องรักษา backwards compatibility ไหม?"

### Step 1.3: อ่านเอกสารที่เกี่ยวข้อง

ตามลำดับนี้:

1. [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) — กฎเหล็ก อ่านก่อนเสมอ
2. [`AI_CODING_GUIDE.md`](./AI_CODING_GUIDE.md) — มาตรฐานโค้ด
3. [`00-System-Architecture.md`](./00-System-Architecture.md) — ภาพรวมระบบ
4. เอกสารระบบที่เกี่ยวข้องกับ task (เช่น ถ้าแก้ search ให้อ่าน `02-Search-System.md`)

### Step 1.4: สำรวจโค้ดที่เกี่ยวข้อง

- ใช้ `Grep` หา keyword ที่เกี่ยวข้อง
- ใช้ `Glob` หาไฟล์ที่เกี่ยวข้อง
- ใช้ `Read` อ่านไฟล์ที่พบ
- ทำความเข้าใจ pattern ที่ใช้ในโค้ดเดิม

### Step 1.5: จัดทำ Task Summary

ก่อนไป Phase 2 ให้สรุปในใจ (หรือบอกผู้ใช้) ว่า:

```
Task: <สรุป task 1 ประโยค>
Scope: <ไฟล์/ระบบที่จะแก้>
Constraint: <ข้อจำกัดที่ต้องระวัง>
Approach: <วิธีการคร่าว ๆ>
```

---

## Phase 2: วางแผน

### Step 2.1: แบ่งงานเป็น subtask

แบ่ง task ใหญ่เป็น subtask เล็ก ๆ ที่ทำได้ในขั้นเดียว แต่ละ subtask ควร:

- ทำเสร็จใน < 30 นาที
- มี output ที่ตรวจสอบได้
- ไม่พึ่งพา subtask อื่นที่ยังไม่เสร็จ (ถ้าได้)

### Step 2.2: ระบุไฟล์ที่จะแก้

ทำรายการไฟล์ที่จะแก้ พร้อมเหตุผล:

```
Files to modify:
- assets/js/search-modules/search.js — เพิ่ม fuzzy match function
- assets/js/search-modules/state.js — เพิ่ม state สำหรับ fuzzy results
- assets/css/search.css — เพิ่ม style สำหรับ highlight
```

### Step 2.3: ระบุไฟล์ที่อาจกระทบ

คิดว่าการแก้นี้จะกระทบระบบอื่นไหม:

- ถ้าแก้ search → กระทบ URE (render), Nav-Core (display)
- ถ้าแก้ language → กระทบทุกระบบ (ทุกระบบฟัง `languageChange` หรือ `fv:langchange`)
- ถ้าแก้ ConData → กระทบ search, nav-core, home
- ถ้าแก้ release notes → แก้ `assets/md/{en,th}/current.md` อย่างเดียว — **ห้าม**สร้างไฟล์ใน `releases/` (build script สร้างจาก git history อัตโนมัติ) ดู [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) ส่วน 9

### Step 2.4: ประเมินผลกระทบต่อ SEO (priority สูงสุด)

> ⚠️ SEO เป็น priority ระดับพิเศษที่สูงสุด — ดู [`12-SEO-Guide.md`](./12-SEO-Guide.md)

ถามตัวเองก่อนทำ:

- การแก้นี้กระทบ URL ไหม? → ถ้าใช่ ต้องตั้ง 301 redirect + อัปเดต sitemap + hreflang
- การแก้นี้กระทบ meta tags ไหม? → ถ้าใช่ ต้องมีในทุกภาษา
- การแก้นี้กระทบ structured data ไหม? → ถ้าใช่ ทดสอบ Rich Results Test
- การแก้นี้กระทบ Core Web Vitals ไหม? → ถ้าใช่ ทดสอบ Lighthouse ก่อน/หลัง
- การแก้นี้กระทบ crawlability ไหม? → ถ้าใช่ ตรวจสอบ robots.txt + sitemap

ถ้าตอบ "ใช่" อย่างน้อย 1 ข้อ → อ่าน `12-SEO-Guide.md` ก่อนทำ และเพิ่ม SEO checks ใน Phase 4

### Step 2.5: วางแผนการทดสอบ

ก่อนเริ่มทำ คิดไว้เลยว่าจะทดสอบยังไง:

- ทดสอบ manual บนเว็บอย่างไร
- มี test script ที่ต้องรันไหม
- ต้องทดสอบบน browser อะไรบ้าง

### Step 2.5: นำเสนอแผน (ถ้าจำเป็น)

ถ้า task ใหญ่ ควรนำเสนอแผนก่อนเริ่มทำ:

```
Plan:
1. อ่านระบบ search ใน 02-Search-System.md
2. แก้ search.js เพิ่ม fuzzy match
3. แก้ state.js เพิ่ม state
4. ทดสอบบนเว็บ
5. อัปเดตเอกสารถ้าจำเป็น

Proceed?
```

---

## Phase 3: ดำเนินการ

### Step 3.1: ทำ subtask ทีละอัน

- ทำ subtask 1 ให้เสร็จก่อน แล้วค่อยไป subtask ถัดไป
- ห้ามกระโดดไปมา
- ถ้าเจอปัญหาที่ subtask หนึ่ง ให้แก้ให้เรียบร้อยก่อน

### Step 3.2: ใช้ TodoWrite

สำหรับ task ที่มีหลาย subtask ให้ใช้ `TodoWrite` tool เพื่อ track ความคืบหน้า:

```
[ ] อ่าน 02-Search-System.md
[ ] แก้ search.js
[ ] แก้ state.js
[ ] ทดสอบบนเว็บ
[ ] อัปเดตเอกสาร
```

### Step 3.3: ยึดตามมาตรฐานโค้ด

ทุกบรรทัดที่เขียนต้องผ่าน [`AI_CODING_GUIDE.md`](./AI_CODING_GUIDE.md):

- IIFE pattern
- 2 spaces indent
- Single quotes
- JSDoc comments
- ฯลฯ

### Step 3.4: ตรวจสอบกฎเหล็ก

ระหว่างทำ คอยเช็คกับ [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md):

- ห้ามใช้ ES modules
- ห้ามใช้ React/jQuery
- ห้าม mutate global state
- ห้ามใช้ `alert()`
- ฯลฯ

### Step 3.5: ถ้าเจอปัญหาที่ไม่คาดคิด

หยุดและประเมินใหม่:

1. ปัญหาคืออะไร
2. ปัญหากระทบแผนเดิมไหม
3. ต้องเปลี่ยนแผนไหม
4. ต้องถามผู้ใช้ไหม

ห้ามเดาแล้วทำต่อ — ถ้าไม่แน่ใจ ให้ถาม

---

## Phase 4: ตรวจสอบ

### Step 4.1: รันผ่าน AI_REVIEW_CHECKLIST

ดู [`AI_REVIEW_CHECKLIST.md`](./AI_REVIEW_CHECKLIST.md) และติ๊กทุกข้อ

### Step 4.2: ทดสอบบนเว็บ

ถ้ามี local server ให้ทดสอบ:

```bash
# ถ้าแก้ source HTML/translation
npm run build
# แล้วเปิด dist/en/home/index.html

# ถ้าแก้แค่ JS/CSS
# เปิด home/index.html โดยตรง (dev mode)
```

ทดสอบ:
- [ ] หน้าเว็บโหลดได้
- [ ] ไม่มี error ใน console
- [ ] ฟีเจอร์ที่แก้ทำงาน
- [ ] ฟีเจอร์เดิมยังทำงาน (regression)
- [ ] ทดสอบทั้ง 2 ภาษา

### Step 4.3: ตรวจสอบ cross-system impact

คิดว่าการแก้นี้กระทบระบบอื่นไหม:

- [ ] ระบบที่ใช้ function ที่แก้ — ยังทำงานไหม
- [ ] ระบบที่ฟัง event เดียวกัน — ยังทำงานไหม
- [ ] Build script — ยังผ่านไหม

### Step 4.4: อัปเดตเอกสาร (เบื้องต้น)

ถ้าการแก้กระทบสิ่งใดในตาราง section 8.1 ของ [`13-Documentation-Standard.md`](./13-Documentation-Standard.md) → ให้เริ่มอัปเดตเอกสารตอนนี้ (รายละเอียดเต็มใน Phase 4.5 ด้านล่าง)

---

## Phase 4.5: Documentation Sync (priority #1 สูงสุด)

> 🥇 เอกสารเป็น priority สูงสุดของ Fantrove — สูงกว่า SEO และ Performance ทุกการเปลี่ยนแปลงระบบต้อง sync กับเอกสาร ดู [`13-Documentation-Standard.md`](./13-Documentation-Standard.md) สำหรับมาตรฐานเต็ม

### Step 4.5.1: ระบุเอกสารที่ต้องอัปเดต

ดูตาราง "สิ่งที่เปลี่ยน → เอกสารที่ต้องอัปเดต" ใน [`13-Documentation-Standard.md`](./13-Documentation-Standard.md) section 8.1:

| สิ่งที่เปลี่ยน | เอกสารที่ต้องอัปเดต |
|---|---|
| เพิ่ม/ลด module | เอกสารระบบนั้น + `00-System-Architecture.md` |
| เปลี่ยน public API | เอกสารระบบนั้น + `00-System-Architecture.md` |
| เปลี่ยน namespace | `00-System-Architecture.md` |
| เปลี่ยน version | เอกสารระบบนั้น (header) |
| เพิ่ม/ลด custom event | `00-System-Architecture.md` |
| เปลี่ยน build process | `09-Deployment-Guide.md` |
| เพิ่ม/ลด content type | `10-Content-Guide.md` + `05-Content-Data-Service.md` |
| เพิ่ม/ลด ภาษา | `04-Internationalization-And-Build.md` + `12-SEO-Guide.md` |
| เพิ่ม/ลด หน้าเว็บ | `00-System-Architecture.md` + `09-Deployment-Guide.md` |

ถ้าไม่แน่ใจว่าต้องอัปเดตไหม → **อัปเดต** (better safe than sorry)

### Step 4.5.2: อัปเดตเอกสารตามมาตรฐาน

ปฏิบัติตาม [`13-Documentation-Standard.md`](./13-Documentation-Standard.md):

- ใช้ H1 + header blockquote + สารบัญ + cross-references
- ใช้ "Fantrove" ไม่ใช่ "FanTrove" หรือ "Fantrove Page"
- ใช้ relative path ใน cross-references
- ใช้ language tag ใน code blocks
- ใช้ ✅/❌ markers สำหรับตัวอย่างดี/ไม่ดี
- น้ำเสียงเป็นมิตร ตรงไปตรงมา ไม่ทางการเกินไป

### Step 4.5.3: Verify เอกสารอื่นที่อ้างถึง

ตรวจสอบว่าเอกสารอื่นที่อ้างถึงสิ่งที่เปลี่ยน ยังตรงไหม:

```bash
# ตัวอย่าง: ถ้าเปลี่ยน API ของ URE.mount()
grep -rn "URE.mount" fantrove-docs/
# ตรวจทุกไฟล์ที่พบว่ายังอ้างถึง API เดิมไหม
```

### Step 4.5.4: ตรวจสอบว่าเอกสารตรงกับโค้ดจริง

ก่อน commit เอกสาร ต้อง verify:

- ชื่อ module/function/variable ที่อ้างถึงมีจริงในโค้ด
- เลข version ตรงกับ source code
- File paths ตรงกับจริง
- API signatures ตรงกับจริง

> ถ้าไม่แน่ใจ → ถือว่าโค้ดเป็นความจริง แล้วแก้เอกสารให้ตรง

### Step 4.5.5: ถ้าเจอเอกสารไม่ตรงจริงระหว่างทำ (ที่ไม่เกี่ยวกับ task ปัจจุบัน)

- บันทึกใน PR description: "พบเอกสารไม่ตรงจริงที่ [path]:[line]"
- (optional) แก้เอกสารนั้นด้วย ถ้าเป็นเรื่องเล็ก
- (ถ้าใหญ่) เปิด issue แยก
- กลับไปทำ task เดิม

### Step 4.5.6: Commit code + docs ใน commit เดียวกัน

```bash
# ❌ ห้าม — แยก commit
git commit -m "feat(ure): add new module"
git commit -m "docs(ure): update for new module"

# ✅ ถูก — รวมใน commit เดียว
git add assets/js/ure/ure-modules/new-module.js fantrove-docs/01-Virtual-Scroll-Rendering.md
git commit -m "feat(ure): add new module + update docs"
```

---

## Phase 5: ส่งมอบ

### Step 5.1: สรุปสิ่งที่ทำ

บอกผู้ใช้ว่า:

```
Done. สรุปสิ่งที่ทำ:
1. แก้ไฟล์ X เพื่อ...
2. เพิ่มฟังก์ชัน Y สำหรับ...
3. อัปเดตเอกสาร Z

ไฟล์ที่แก้:
- assets/js/search-modules/search.js
- assets/css/search.css

ทดสอบแล้ว:
- ✅ ทดสอบบนเว็บ (en + th)
- ✅ ไม่มี regression
- ✅ ผ่าน AI_REVIEW_CHECKLIST
```

### Step 5.2: เสนอสิ่งถัดไป

บอกผู้ใช้ว่าควรทำอะไรต่อ:

```
Next steps:
- ทดสอบบนเบราว์เซอร์จริง (Chrome, Firefox, Safari)
- ถ้าพร้อม deploy → commit + push
- ถ้ามี release ใกล้ → เขียน release note
```

### Step 5.3: บันทึก worklog

ถ้าทำงานใน multi-agent environment ให้บันทึก worklog:

```markdown
---
Task ID: <id>
Agent: <agent name>
Task: <task description>

Work Log:
- <step 1>
- <step 2>
- ...

Stage Summary:
- <key results>
- <files modified>
- <decisions made>
```

---

## Anti-patterns

### ❌ Anti-pattern 1: เริ่มแก้โค้ดเลยโดยไม่อ่านเอกสาร

ผล: ละเมิดกฎเหล็ก ทำลาย pattern

### ❌ Anti-pattern 2: ทำหลายอย่างพร้อมกัน

ผล: ไม่รู้ว่าอะไรทำให้เกิด bug

### ❌ Anti-pattern 3: เดาเมื่อไม่แน่ใจ

ผล: ทำผิด ต้องทำใหม่

### ❌ Anti-pattern 4: ไม่ทดสอบ

ผล: ส่งมอบของพัง

### ❌ Anti-pattern 5: ไม่อัปเดตเอกสาร

ผล: โค้ดกับเอกสารไม่ตรงกัน คนรับงานต่อจะสับสน

### ❌ Anti-pattern 6: กลืน error

ผล: bug ซ่อนอยู่ มาพังทีหลัง

### ❌ Anti-pattern 7: ส่งมอบโดยไม่สรุป

ผล: ผู้ใช้ไม่รู้ว่าทำอะไรไป

---

## สรุป

```
Phase 1: เข้าใจ → อ่าน task 3 ครั้ง, ถามถ้าไม่ชัด, อ่านเอกสาร
Phase 2: วางแผน → แบ่ง subtask, ระบุไฟล์, วางแผนทดสอบ
Phase 3: ทำ → ทีละ subtask, ยึดมาตรฐาน, เช็คกฎเหล็ก
Phase 4: ตรวจ → checklist, ทดสอบบนเว็บ, cross-system impact
Phase 5: ส่งมอบ → สรุป, เสนอ next steps, บันทึก worklog
```

> AI ที่ดีไม่ใช่ AI ที่เขียนโค้ดเร็ว — แต่เป็น AI ที่ทำงานอย่างเป็นระบบ รอบคอบ และสื่อสารชัดเจน
