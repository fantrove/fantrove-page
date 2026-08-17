# Fantrove Search — v6.1 Patch (Google-like non-sticky filters)

วางไฟล์ทั้งหมดใน patch นี้ทับลงบน repo ตามโครงสร้างเดิม — แตก ZIP แล้ว copy ทับได้เลย

## สรุปการเปลี่ยนแปลง

| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `search/index.html` | โครงสร้างใหม่ — ย้าย filter pills ออกจาก `#search-sticky` ไปเป็น sibling `.search-filters-panel`, ลบ `#filterCatToggle` (ลูกศร), ลบ `.filter-cat-wrap`, ลบ `#cat-spacer`, เขียน inline sticky script ใหม่แบบกระชับ |
| `assets/css/search-compact-overrides.css` | ลบ style blocks ของ `.filter-cat-toggle`, `.filter-cat-wrap`, `.filter-row-end`, `.filter-row-wrapper` ออกทั้งหมด — เพิ่ม `:empty` auto-collapse สำหรับ category row — ปรับ `.search-header` padding ให้สมดุล (มี bottom padding บ้างเพราะ filter pills ไม่อยู่ใน header แล้ว) |
| `assets/js/search-system/search-modules/rendering.js` | `setupCategoryFilter()` แบบใหม่ — ไม่อ้างถึง `filterCatToggle` / `filterCatWrap` / `_closeCatBar` / `_updateCatBarHeight` อีกต่อไป เมื่อไม่มี categories ก็แค่ clear innerHTML แล้ว CSS `:empty` จะ collapse row ให้เอง |
| `fantrove-docs/14-System-Design-And-UX.md` | เพิ่ม section 5.8.1 "Search Page Sticky Layout (Google-like, v6.1+)" อธิบายกฎการวาง structure ใหม่ + อัปเดต ARIA ตัวอย่างให้เป็น filter pills แทน toggle button |
| `fantrove-docs/02-Search-System.md` | อัปเดต section 12.4 setupCategoryFilter ให้สะท้อน behavior ใหม่ พร้อม callout box อธิบายการเปลี่ยนแปลง |

## พฤติกรรมใหม่

### ก่อนหน้า (v6.0)
- `#search-sticky` บรรจุทั้ง search input, type filter pills, และ category filter wrap
- ทั้งหมด stick อยู่กับหน้าจอเวลา scroll
- มี toggle arrow สำหรับซ่อน/แสดง category bar
- category bar เป็น absolute-positioned overlay ที่ dropdown ลงมาจาก header

### ตอนนี้ (v6.1 — Google-like)
- `#search-sticky` บรรจุ **เฉพาะ** search input + nav bar background
- type filter + category filter อยู่ใน sibling `.search-filters-panel` ที่ scroll ตามเนื้อหาปกติ
- ไม่มี toggle arrow — category pills แสดงทันทีที่มี categories ให้เลือก
- เมื่อไม่มี categories (เช่น ผลลัพธ์ว่าง หรือทุก item อยู่ใน category เดียวกัน) CSS rule `.filter-pills-row--cat:empty { display:none }` จะ collapse row อัตโนมัติ
- inline sticky script ยังคง show/hide บน scroll down/up ของ search bar เหมือนเดิม เพื่อประหยัดพื้นที่หน้าจอบนมือถือ

## การทดสอบ

ทดสอบว่า:
1. ค้นหาแล้วเลื่อนหน้าจอ → search bar ยัง stick อยู่ แต่ filter pills เลื่อนหายไปใต้ sticky header
2. พิมพ์คำค้นที่มีหลาย categories → category row แสดงอัตโนมัติ ไม่ต้องกด toggle
3. พิมพ์คำค้นที่ผลลัพธ์ทั้งหมดอยู่ใน category เดียว → category row หายไปเอง
4. ลอง responsive บนมือถือ → ทั้ง type และ category rows ยัง horizontal scroll ได้ปกติ
5. ทดสอบ sticky show/hide บน scroll down/up → search bar ยังทำงานเหมือนเดิม
