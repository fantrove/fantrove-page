# 13 — มาตรฐานการเขียนเอกสาร (Documentation Standard)

> เอกสารนี้เป็น **มาตรฐานสูงสุด** สำหรับการเขียนและอัปเดตเอกสารทุกชนิดในโปรเจกต์ Fantrove — ทั้งเอกสารระบบ (00-12), เอกสาร AI (`AI_*.md`), `RELEASE_NOTES_GUIDE.md`, และ `README.md`
>
> **สำหรับ:** AI และนักพัฒนาทุกคนที่เขียน/แก้เอกสาร — ต้องยึดมาตรฐานนี้เสมอเพื่อให้เอกสารทุกไฟล์มีคุณภาพสม่ำเสมอ
>
> **Priority:** 🥇 **#1 สูงสุด** — เอกสารเป็นตัวอธิบายระบบและทำให้การพัฒนาเป็นไปได้อย่างราบรื่น สูงกว่า SEO และ Performance เพราะถ้าเอกสารไม่ตรงจริง ทุกคน (รวมถึง AI) จะสับสน

---

## สารบัญ

1. [ทำไมเอกสารสำคัญที่สุด](#1-ทำไมเอกสารสำคัญที่สุด)
2. [มาตรฐานโครงสร้างไฟล์](#2-มาตรฐานโครงสร้างไฟล์)
3. [มาตรฐาน Header (blockquote)](#3-มาตรฐาน-header-blockquote)
4. [มาตรฐาน สารบัญ](#4-มาตรฐาน-สารบัญ)
5. [มาตรฐาน Cross-references](#5-มาตรฐาน-cross-references)
6. [มาตรฐานภาษาและน้ำเสียง](#6-มาตรฐานภาษาและน้ำเสียง)
7. [มาตรฐาน Code Examples](#7-มาตรฐาน-code-examples)
8. [กฎ Docs Sync With Code](#8-กฎ-docs-sync-with-code)
9. [วงจรการอัปเดตเอกสาร](#9-วงจรการอัปเดตเอกสาร)
10. [Template สำเร็จรูป](#10-template-สำเร็จรูป)
11. [Checklist ก่อน commit เอกสาร](#11-checklist-ก่อน-commit-เอกสาร)
12. [สิ่งที่ห้ามทำ](#12-สิ่งที่ห้ามทำ)
13. [อ้างอิงข้ามเอกสาร](#13-อ้างอิงข้ามเอกสาร)

---

## 1. ทำไมเอกสารสำคัญที่สุด

เอกสารคือตัวกลางระหว่างระบบกับผู้พัฒนา (รวมถึง AI agent) ทุกคน — ถ้าเอกสารไม่ตรงจริง การพัฒนาจะสับสน ตัดสินใจผิด และสร้าง bug ใหม่ ๆ ดังนั้นเอกสารมี priority สูงสุดใน Fantrove

### 1.1 Priority Hierarchy ของ Fantrove

| Priority | ระดับ | เหตุผล |
|---|---|---|
| 🥇 **Documentation** | #1 สูงสุด | เป็นตัวอธิบายระบบ — ถ้าผิด ทุกอย่างตามผิด |
| 🥈 **SEO** | สูงสุด (พิเศษ) | Search engine visibility เป็นหัวใจของการเติบโต |
| 🥉 **Performance** | สูง | ส่งผลต่อทั้ง UX และ SEO (Core Web Vitals) |

> ⚠️ **กฎเหล็ก:** เมื่อมี conflict ระหว่าง feature ใหม่กับเอกสาร — **อัปเดตเอกสารก่อน** แล้วค่อย merge feature ไม่ใช่ merge feature แล้วปล่อยเอกสารให้ตามทีหลัง

### 1.2 หลักการสำคัญ 5 ข้อ

1. **Docs are code** — เอกสารต้องได้รับการดูแลเท่ากับโค้ด รีวิว ทดสอบ อัปเดต
2. **Sync or die** — เอกสารต้องตรงกับโค้ดจริงเสมอ ถ้าไม่ตรง = bug
3. **Consistent voice** — ทุกไฟล์ใช้น้ำเสียงและโครงสร้างเดียวกัน
4. **Discoverable** — ทุกเอกสารต้องเชื่อมโยงกันผ่าน cross-references
5. **Living documents** — เอกสารไม่ใช่ write-once ต้องอัปเดตตามระบบเสมอ

---

## 2. มาตรฐานโครงสร้างไฟล์

ทุกไฟล์ markdown ใน `fantrove-docs/` ต้องมีโครงสร้างนี้ตามลำดับ:

```
1. H1 heading (# XX — Title)
2. Header blockquote (description, สำหรับ, ไฟล์หลัก, เวอร์ชัน)
3. --- (horizontal rule)
4. สารบัญ (Table of Contents)
5. --- (horizontal rule)
6. เนื้อหา (sections ตามลำดับ)
7. --- (horizontal rule)
8. Section สุดท้าย: "อ้างอิงข้ามเอกสาร"
```

### 2.1 ตัวอย่างโครงสร้าง

```markdown
# 13 — มาตรฐานการเขียนเอกสาร (Documentation Standard)

> เอกสารนี้เป็น **มาตรฐานสูงสุด** สำหรับการเขียนและอัปเดตเอกสารทุกชนิดในโปรเจกต์ Fantrove
>
> **สำหรับ:** AI และนักพัฒนาทุกคนที่เขียน/แก้เอกสาร
>
> **Priority:** 🥇 #1 สูงสุด

---

## สารบัญ

1. [ภาพรวม](#1-ภาพรวม)
2. [โครงสร้างไฟล์](#2-โครงสร้างไฟล์)
...

---

## 1. ภาพรวม

เนื้อหา...

---

## N. อ้างอิงข้ามเอกสาร

- [`00-System-Architecture.md`](./00-System-Architecture.md) — ...
- [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) — ...
```

---

## 3. มาตรฐาน Header (blockquote)

หลัง H1 ต้องมี blockquote ที่บอก:

1. **Description** — 1-2 ประโยคอธิบายว่าเอกสารนี้เกี่ยวกับอะไร
2. **สำหรับ** — ผู้อ่านเป้าหมาย
3. **ไฟล์หลัก** — ไฟล์/โฟลเดอร์ที่เอกสารครอบคลุม (ถ้าเป็นเอกสารระบบ)
4. **เวอร์ชัน** — เวอร์ชันของระบบที่อ้างอิง (ถ้ามี)
5. **Priority** — ระดับความสำคัญ (ถ้าเป็น cross-cutting concern เช่น SEO, Documentation)

### 3.1 ตัวอย่าง

```markdown
# 02 — ระบบ Search (Search System)

> เอกสารนี้อธิบายระบบ Search ของ **Fantrove** — ระบบค้นหา client-side แบบ two-tier (substring + Fuse.js fuzzy) ที่ทำงานร่วมกับ URE สำหรับ virtual scroll rendering
>
> **สำหรับ:** AI และนักพัฒนาที่จะแก้/ขยายระบบ Search
>
> **ไฟล์หลัก:** `assets/js/search-engine.js` (Fuse engine singleton) + `assets/js/search-ui.js` (orchestrator, public API `window.__searchUI`) + `assets/js/search-modules/` (12 modules)
>
> **ครอบคลุม:** สถาปัตยกรรม, อัลกอริทึม, โมดูลทั้งหมด, การผสานรวมกับ URE, URL/History, performance
```

### 3.2 กฎ

- ใช้ `>` สำหรับ blockquote ทุกบรรทัด
- เว้นบรรทัดว่างระหว่าง field
- **สำหรับ** ต้องระบุชัดว่าใครควรอ่าน
- **ไฟล์หลัก** ต้องระบุ path จริง (ไม่ใช่ path สั้น)
- ใช้ **Fantrove** ไม่ใช่ "Fantrove Page" หรือ "FanTrove"

---

## 4. มาตรฐาน สารบัญ

### 4.1 ทุกไฟล์ต้องมีสารบัญ

ยกเว้นไฟล์สั้นมาก (< 100 บรรทัด) เช่น `AI_COMMIT_GUIDE.md`

### 4.2 รูปแบบ

```markdown
## สารบัญ

1. [ภาพรวม](#1-ภาพรวม)
2. [โครงสร้างไฟล์](#2-โครงสร้างไฟล์)
3. [รายละเอียด Module](#3-รายละเอียด-module)
...
N. [อ้างอิงข้ามเอกสาร](#n-อ้างอิงข้ามเอกสาร)
```

### 4.3 Anchor links

- ใช้ GitHub-flavored markdown anchor: `#section-title`
- แปลงเป็น lowercase + แทน space ด้วย `-`
- ภาษาไทยใช้ตัวอักษรตรง ๆ ได้ (GitHub รองรับ)
- ตัวอย่าง: `## 1. ภาพรวม` → `#1-ภาพรวม`

### 4.4 กฎ

- สารบัญต้องครอบคลุมทุก `##` heading
- ตัวเลข section ต้องตรงกับ heading จริง
- ต้องมี section "อ้างอิงข้ามเอกสาร" เป็น section สุดท้ายเสมอ

---

## 5. มาตรฐาน Cross-references

### 5.1 ทุกไฟล์ต้องมี section "อ้างอิงข้ามเอกสาร"

เป็น section สุดท้ายของทุกไฟล์ ใช้สำหรับ link ไปเอกสารอื่นที่เกี่ยวข้อง

### 5.2 รูปแบบ

```markdown
## N. อ้างอิงข้ามเอกสาร

- [`00-System-Architecture.md`](./00-System-Architecture.md) — ภาพรวมสถาปัตยกรรมทั้งโปรเจกต์
- [`12-SEO-Guide.md`](./12-SEO-Guide.md) — ⭐ SEO considerations (priority สูงสุด) ที่เกี่ยวข้องกับระบบนี้
- [`AI_CODING_GUIDE.md`](./AI_CODING_GUIDE.md) — มาตรฐานโค้ดที่ต้องยึดเมื่อแก้ระบบนี้
- [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) — กฎเหล็กก่อนแตะระบบนี้
```

### 5.3 กฎ

- ใช้ relative path (`./filename.md`) ไม่ใช่ absolute path
- ใช้ backtick-wrapped filename เป็น link text: `[`filename.md`](./filename.md)`
- แต่ละ link ต้องมี description สั้น ๆ หลัง `—`
- ใช้ emoji ⭐ สำหรับ priority สูง (SEO, Documentation)
- ทุกไฟล์ต้องมี link ไป `AI_CODING_GUIDE.md` และ `AI_FORBIDDEN.md` (ยกเว้นไฟล์ AI_* เอง)
- ใช้ชื่อไฟล์จริง (หลัง rename) ไม่ใช่ชื่อเก่า

### 5.4 เมื่อ rename ไฟล์

ถ้าเปลี่ยนชื่อไฟล์ ต้องอัปเดต cross-references ในทุกไฟล์ที่อ้างถึง — ดู `scripts/fix_cross_refs.py`

---

## 6. มาตรฐานภาษาและน้ำเสียง

### 6.1 ภาษา

- เอกสารระบบ (00-12), AI docs, RELEASE_NOTES_GUIDE → **ภาษาไทย**
- README.md → **ภาษาไทย** (มีบาง section ที่เป็นอังกฤษได้ เช่น License)
- CODE_OF_CONDUCT.md → **ภาษาไทย** (เพิ่งเปลี่ยน)
- Code comments → ภาษาไทยหรืออังกฤษก็ได้ แต่ต้องสม่ำเสมอในไฟล์เดียวกัน

### 6.2 น้ำเสียง

- **เป็นมิตร ตรงไปตรงมา อ่านง่าย** — ไม่ทางการเกินไป ไม่หยิบย่อเกินไป
- อธิบายเหมือนคุยกับเพื่อนที่เข้าใจเทคนิค แต่ไม่ใช่ผู้เชี่ยวชาญของระบบนี้
- ใช้คำว่า "เรา" แทนทีม ใช้ "คุณ" แทนผู้อ่าน

### 6.3 คำต้องห้าม

| ❌ ห้ามใช้ | ✅ ใช้แทน |
|---|---|
| ปฏิวัติ, พลิกโฉม, สุดยอด | ปรับปรุง, เพิ่ม, แก้ไข |
| FanTrove, Fantrove Page | Fantrove |
| น่าจะ, อาจจะ (ใน spec) | ต้อง, จะ (ชัดเจน) |
| ฯลฯ ใน checklist | ระบุให้ครบ |

### 6.4 คำศัพท์เทคนิค

- คำเทคนิคที่ไม่มีคำไทย → ใช้คำอังกฤษ (เช่น `virtual scrolling`, `Web Worker`, `Core Web Vitals`)
- คำที่มีคำไทยและสื่อได้ดี → ใช้คำไทย (เช่น "ระบบ", "โมดูล", "ฟังก์ชัน")
- คำย่อ → ระบุ full form ครั้งแรก (เช่น "i18n (internationalization)")

---

## 7. มาตรฐาน Code Examples

### 7.1 ใช้ code block พร้อม language tag

```javascript
// ✅ ดี
function example() {
  return 'hello';
}
```

```javascript
// ❌ ห้าม — ไม่มี language tag
function example() {
  return 'hello';
}
```

### 7.2 ใช้ ✅/❌ markers สำหรับตัวอย่างดี/ไม่ดี

```javascript
// ✅ ดี — อธิบายว่าทำไมดี
const result = items.filter(x => x.score > threshold);

// ❌ ห้าม — อธิบายว่าทำไมไม่ดี
const r = items.filter(x => x.s > t); // ตัวแปรไม่สื่อความหมาย
```

### 7.3 กฎ

- ทุก code block ต้องมี language tag (`javascript`, `bash`, `html`, `css`, `json`, `markdown`)
- Code ต้อง runnable ได้จริง (ไม่ใช่ pseudocode ลอย ๆ) ยกเว้นระบุชัด
- Comments ใน code ใช้ภาษาเดียวกับเอกสาร (ไทย)
- หลีกเลี่ยง code block ที่ยาวเกิน 30 บรรทัด — ถ้าเกินให้แบ่ง

---

## 8. กฎ Docs Sync With Code

> ⚠️ **กฎเหล็ก:** เอกสารต้องตรงกับโค้ดจริงเสมอ — ถ้าไม่ตรง = bug

### 8.1 เมื่อแก้ระบบ → ต้องอัปเดตเอกสาร

ทุกการเปลี่ยนแปลงระบบที่กระทบสิ่งต่อไปนี้ ต้องอัปเดตเอกสารด้วย:

| สิ่งที่เปลี่ยน | เอกสารที่ต้องอัปเดต |
|---|---|
| เพิ่ม/ลด module | เอกสารระบบนั้น + `00-System-Architecture.md` |
| เปลี่ยน public API | เอกสารระบบนั้น + `00-System-Architecture.md` |
| เปลี่ยน namespace (`window.X`) | `00-System-Architecture.md` |
| เปลี่ยน version | เอกสารระบบนั้น (header) |
| เพิ่ม/ลด custom event | `00-System-Architecture.md` |
| เปลี่ยน build process | `09-Deployment-Guide.md` |
| เพิ่ม/ลด content type | `10-Content-Guide.md` + `05-Content-Data-Service.md` |
| เพิ่ม/ลด ภาษา | `04-Internationalization-And-Build.md` + `12-SEO-Guide.md` |
| เพิ่ม/ลด หน้าเว็บ | `00-System-Architecture.md` + `09-Deployment-Guide.md` (sitemap) |

### 8.2 เมื่อแก้เอกสาร → ต้อง verify กับโค้ด

ถ้าอัปเดตเอกสาร ต้องเช็คว่าสิ่งที่เขียนตรงกับโค้ดจริงไหม:

- อ่าน source code ของไฟล์ที่อ้างถึง
- รันโค้ดทดสอบดู (ถ้าเป็น API)
- ถ้าไม่แน่ใจ → ถือว่าโค้ดเป็นความจริง แล้วแก้เอกสารให้ตรง

### 8.3 Bidirectional sync

```
Code changes ─────► Docs update
                    ▲
                    │
                    │ (verify)
                    │
Docs update ────────┘
```

- แก้โค้ด → อัปเดต docs (section 8.1)
- แก้ docs → verify กับโค้ด (section 8.2)
- ไม่มีทาง "เอกสารรอก่อน" หรือ "โค้ดรอก่อน" — ต้อง sync พร้อมกัน

---

## 9. วงจรการอัปเดตเอกสาร

### 9.1 เมื่อ AI รับ task ที่กระทบระบบ

```
1. อ่านเอกสารระบบที่เกี่ยวข้องก่อนแก้โค้ด
   ↓
2. แก้โค้ด
   ↓
3. ทดสอบโค้ด
   ↓
4. ⭐ อัปเดตเอกสารให้ตรงกับโค้ดใหม่ (section 8.1)
   ↓
5. ⭐ Verify เอกสารอื่นที่อ้างถึง — ยังตรงไหม
   ↓
6. รันผ่าน checklist ใน section 11
   ↓
7. Commit พร้อมกัน (code + docs ใน commit เดียวกัน)
```

### 9.2 เมื่อ AI พบเอกสารที่ไม่ตรงจริง (ระหว่างทำ task อื่น)

```
1. หยุด task ปัจจุบันชั่วคราว
   ↓
2. บันทึกไว้ใน PR description: "พบเอกสารไม่ตรงจริงที่ [path]:[line]"
   ↓
3. (optional) แก้เอกสารนั้นด้วย ถ้าเป็นเรื่องเล็ก
   ↓
4. (ถ้าใหญ่) เปิด issue แยก
   ↓
5. กลับไปทำ task เดิม
```

### 9.3 Commit message สำหรับการแก้เอกสาร

ใช้ conventional commits:

```bash
docs(search): update API reference for v2 fuzzy matching
docs: fix stale cross-reference in 00-System-Architecture
docs(seo): add multi-language parity section
```

> ดูมาตรฐาน commit message ใน [`AI_COMMIT_GUIDE.md`](./AI_COMMIT_GUIDE.md)

---

## 10. Template สำเร็จรูป

### 10.1 Template สำหรับเอกสารระบบใหม่

```markdown
# XX — ชื่อระบบ (English Name)

> เอกสารนี้อธิบายระบบ **[ชื่อระบบ]** ของ Fantrove — [1 ประโยคอธิบายหน้าที่]
>
> **สำหรับ:** AI และนักพัฒนาที่จะแก้/ขยาย [ชื่อระบบ]
>
> **ไฟล์หลัก:** `path/to/entry.js` + `path/to/modules/` (N modules)
>
> **เวอร์ชัน:** vX.Y.Z

---

## สารบัญ

1. [ภาพรวม](#1-ภาพรวม)
2. [สถาปัตยกรรม](#2-สถาปัตยกรรม)
3. [Public API](#3-public-api)
4. [Module ทั้งหมด](#4-module-ทั้งหมด)
5. [Integration กับระบบอื่น](#5-integration-กับระบบอื่น)
6. [อ้างอิงข้ามเอกสาร](#6-อ้างอิงข้ามเอกสาร)

---

## 1. ภาพรวม

เนื้อหา...

---

## N. อ้างอิงข้ามเอกสาร

- [`00-System-Architecture.md`](./00-System-Architecture.md) — ภาพรวมสถาปัตยกรรมทั้งโปรเจกต์
- [`12-SEO-Guide.md`](./12-SEO-Guide.md) — ⭐ SEO considerations (priority สูงสุด)
- [`AI_CODING_GUIDE.md`](./AI_CODING_GUIDE.md) — มาตรฐานโค้ดที่ต้องยึด
- [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) — กฎเหล็กก่อนแตะระบบนี้
- [`13-Documentation-Standard.md`](./13-Documentation-Standard.md) — 🥇 มาตรฐานการเขียนเอกสาร (priority #1)
```

### 10.2 Template สำหรับ AI docs ใหม่

```markdown
# AI_XXX — ชื่อมาตรฐาน

> เอกสารนี้กำหนด [อะไร] สำหรับ AI agent ทุกตัวที่ทำงานกับโค้ดเบส Fantrove
>
> **สำหรับ:** AI agents ที่ [ทำอะไร]
>
> **Priority:** [ระดับ priority ถ้ามี]

---

## สารบัญ

1. [ภาพรวม](#1-ภาพรวม)
2. [หลักการ](#2-หลักการ)
...

---

## 1. ภาพรวม

เนื้อหา...

---

## N. อ้างอิงข้ามเอกสาร

- [`13-Documentation-Standard.md`](./13-Documentation-Standard.md) — 🥇 มาตรฐานการเขียนเอกสาร (priority #1)
- [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) — กฎเหล็ก
- [`INDEX.md`](./INDEX.md) — สารบัญเอกสารทั้งหมด
```

---

## 11. Checklist ก่อน commit เอกสาร

### 11.1 โครงสร้าง

- [ ] มี H1 heading ในรูปแบบ `# XX — Title (English Name)`
- [ ] มี header blockquote หลัง H1 (description, สำหรับ, ไฟล์หลัก)
- [ ] มี `---` คั่นระหว่าง H1, สารบัญ, และเนื้อหา
- [ ] มี สารบัญ ครบทุก section
- [ ] มี section "อ้างอิงข้ามเอกสาร" เป็น section สุดท้าย

### 11.2 เนื้อหา

- [ ] ใช้ภาษาไทย (ยกเว้น code blocks และ technical terms)
- [ ] ใช้ "Fantrove" ไม่ใช่ "FanTrove" หรือ "Fantrove Page"
- [ ] น้ำเสียงเป็นมิตร ตรงไปตรงมา ไม่ทางการเกินไป
- [ ] ไม่มีคำต้องห้าม (ปฏิวัติ, พลิกโฉม, สุดยอด)
- [ ] ทุก code block มี language tag
- [ ] ใช้ ✅/❌ markers สำหรับตัวอย่างดี/ไม่ดี

### 11.3 Cross-references

- [ ] ทุก link ใช้ relative path (`./filename.md`)
- [ ] ทุก link ใช้ backtick-wrapped filename เป็น text: `[`filename.md`](./filename.md)`
- [ ] ทุก link มี description หลัง `—`
- [ ] มี link ไป `AI_CODING_GUIDE.md` และ `AI_FORBIDDEN.md` (ยกเว้นไฟล์ AI_* เอง)
- [ ] มี link ไป `13-Documentation-Standard.md` (สำหรับเอกสารระบบ)
- [ ] ใช้ชื่อไฟล์จริง (หลัง rename)

### 11.4 Docs Sync

- [ ] ตรวจสอบว่าเนื้อหาตรงกับโค้ดจริง (version, API, file paths)
- [ ] ถ้าแก้โค้ดด้วย → commit code + docs ใน commit เดียวกัน
- [ ] ถ้าแก้ docs อย่างเดียว → verify กับโค้ดจริงก่อน commit

---

## 12. สิ่งที่ห้ามทำ

### 12.1 ห้ามในเอกสาร

- ❌ ห้ามใช้ "FanTrove" หรือ "Fantrove Page" — ใช้ "Fantrove"
- ❌ ห้ามเขียนเอกสารโดยไม่มี สารบัญ (ถ้าไฟล์ > 100 บรรทัด)
- ❌ ห้ามเขียนเอกสารโดยไม่มี section "อ้างอิงข้ามเอกสาร"
- ❌ ห้ามใช้ absolute path ใน cross-references — ใช้ relative path
- ❌ ห้ามใช้ชื่อไฟล์เก่าหลัง rename
- ❌ ห้ามเขียน code block โดยไม่มี language tag
- ❌ ห้ามใช้คำต้องห้าม (ปฏิวัติ, พลิกโฉม, สุดยอด)
- ❌ ห้ามเขียน spec ลอย ๆ โดยไม่ verify กับโค้ดจริง

### 12.2 ห้ามในการ sync

- ❌ ห้ามแก้โค้ดโดยไม่อัปเดตเอกสาร (ถ้ากระทบสิ่งใน section 8.1)
- ❌ ห้าม commit code และ docs แยกกัน (ควรอยู่ใน commit เดียวกัน)
- ❌ ห้ามปล่อยเอกสารไม่ตรงจริงไว้นาน — ถ้าเจอ ให้แก้ทันทีหรือเปิด issue
- ❌ ห้ามลบ section ที่มี cross-references ชี้เข้ามา โดยไม่อัปเดตเอกสารอื่น

### 12.3 ห้ามในการ rename

- ❌ ห้าม rename ไฟล์โดยไม่อัปเดต cross-references ทุกที่
- ❌ ห้าม rename ไฟล์โดยไม่อัปเดต `INDEX.md`
- ❌ ห้ามใช้ชื่อไฟล์ที่เป็น jargon ภายในโปรเจกต์ (ดู history การ rename ใน worklog)

---

## 13. อ้างอิงข้ามเอกสาร

- [`INDEX.md`](./INDEX.md) — สารบัญเอกสารทั้งหมด
- [`00-System-Architecture.md`](./00-System-Architecture.md) — ภาพรวมสถาปัตยกรรมทั้งโปรเจกต์
- [`AI_CODING_GUIDE.md`](./AI_CODING_GUIDE.md) — มาตรฐานโค้ด (เอกสารก็เป็น "code" ชนิดหนึ่ง)
- [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) — กฎเหล็ก (รวมกฎห้ามแก้ระบบโดยไม่อัปเดตเอกสาร)
- [`AI_TASK_WORKFLOW.md`](./AI_TASK_WORKFLOW.md) — วิธีทำงาน (รวม Phase Documentation Sync)
- [`AI_REVIEW_CHECKLIST.md`](./AI_REVIEW_CHECKLIST.md) — Checklist (รวม Documentation Sync checks)
- [`AI_COMMIT_GUIDE.md`](./AI_COMMIT_GUIDE.md) — มาตรฐาน commit message สำหรับ `docs:`
- [`RELEASE_NOTES_GUIDE.md`](./RELEASE_NOTES_GUIDE.md) — มาตรฐาน release notes (เป็นเอกสารประเภทหนึ่ง)
- [`12-SEO-Guide.md`](./12-SEO-Guide.md) — ⭐ SEO Guide (priority #2 รองจาก Documentation)
