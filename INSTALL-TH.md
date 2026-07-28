# Fantrove — Fix Auto-Redirect ภาษา (Patch v3.1)

แก้ปัญหา Google Search Console "Page with redirect" ที่เกิดจากระบบบังคับเพิ่ม
language prefix ให้ URL โดยอัตโนมัติ

## สรุปการแก้ไข

แก้ไขเพียง **1 ไฟล์**:

```
assets/js/lang-proxy.js   ← ทับไฟล์เดิม
```

## วิธีติดตั้ง

### วิธีที่ 1: แตกไฟล์ทับลงบน repo

```bash
# จาก root ของ repo fantrove-page
unzip -o fantrove-fix.zip -d .
```

ไฟล์ `assets/js/lang-proxy.js` จะถูกแทนที่โดยตรง (โครงสร้าง folder ตรงกับของเว็บ)

### วิธีที่ 2: คัดลอกด้วยมือ

คัดลอกไฟล์ `assets/js/lang-proxy.js` จาก zip ไปทับไฟล์เดิมใน repo ที่ path
`fantrove-page/assets/js/lang-proxy.js`

### หลังติดตั้ง

```bash
npm install   # (ครั้งแรกเท่านั้น)
npm run build
```

แล้ว deploy folder `dist/` ตามปกติ

## สิ่งที่เปลี่ยนแปลงใน lang-proxy.js (v2.2 → v3.0)

| พฤติกรรม | v2.2 (เดิม) | v3.0 (ใหม่) |
|----------|-------------|-------------|
| URL มี prefix `/en/` หรือ `/th/` | sync localStorage + บางครั้ง redirect | sync localStorage เท่านั้น (ไม่ redirect) |
| URL ไม่มี prefix | **redirect อัตโนมัติ** ไป URL ที่มี prefix | ไม่ทำอะไร ปล่อยหน้าโหลดปกติ |
| back/forward + storedLang ขัดแย้งกับ URL | redirect ไป URL ของ storedLang | ไม่ redirect ยึด URL เป็นหลัก |
| error fallback | redirect ไป `/en/` | ไม่ redirect (silent fail) |

## สิ่งที่ยังคงอยู่ (ไม่ถูกแก้ — ตามคำขอ)

- การ build ยังคงสร้างหน้าเว็บใน `/en/...` และ `/th/...` เหมือนเดิม
- การเปลี่ยนภาษาด้วยตนเองผ่านปุ่มเลือกภาษา ยังคงเปลี่ยน URL ผ่าน `location.replace()`
- การ sync localStorage เมื่อ URL มี prefix (ไม่ใช่ redirect)
- ระบบ lang-links.js ที่แก้ prefix ของลิงก์เมื่อ user คลิก (user-initiated)

## หลัง Deploy

1. ไปที่ Google Search Console → URL Inspection
2. ตรวจสอบ URL ที่เคยเป็น "Page with redirect"
3. กด **Request Indexing** เพื่อให้ Google recrawl
4. รอ 1-3 วัน → สถานะ "Page with redirect" จะหายไป
