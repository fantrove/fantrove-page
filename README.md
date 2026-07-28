# Fantrove — Redirect Fix Patch (v3 — Final)

แก้ปัญหา "Page with redirect" ใน Google Search Console ที่ทำให้ Google ไม่สามารถ index หน้า `/` ได้ พร้อมทั้งทำให้ `index.html` ใน root เป็น custom 404 page ของระบบที่แสดงผลได้ทุกที่ที่ไม่พบหน้าจริง

## การออกแบบใหม่ (v3 — Final)

| URL | Behavior | HTTP Status | Content |
|-----|----------|-------------|---------|
| `/` | ❌ ไม่ใช่ home อีกต่อไป | **404** | Custom 404 page (`/index.html`) |
| `/index.html` | ❌ ไม่ใช่ home อีกต่อไป | **404** | Custom 404 page (`/index.html`) |
| `/home/` | ✅ Landing page จริง | 200 | Home page content |
| `/en`, `/en/` | ✅ Valid path | 200 (rewrite) | Home page content (canonical ชี้ `/en/home/`) |
| `/th`, `/th/` | ✅ Valid path | 200 (rewrite) | Home page content (canonical ชี้ `/th/home/`) |
| `/en/home/`, `/th/home/` | ✅ Canonical URLs | 200 | Home page content |
| `/anything-else` | ❌ ไม่มีจริง | **404** | Custom 404 page (`/index.html`) |

## หลักการสำคัญ

1. **`/` ไม่ใช่ home page** — landing page ของเราคือ `/home/` เท่านั้น
2. **`/` ไม่ใช่ redirect** — ตอบ HTTP 404 ตรงๆ พร้อม custom 404 HTML ของเรา
3. **ทุก path ที่ไม่มีจริง** → HTTP 404 + custom 404 page ของเรา (ไม่ใช่ browser default)
4. **Google จะไม่ index `/`** (เพราะ 404 status) แต่ไม่ใช่ "Page with redirect" อีกต่อไป
5. **Google index `/en/home/` และ `/th/home/`** เป็น canonical URLs ของหน้าแรก

## ไฟล์ที่แก้ไข (7 ไฟล์)

### 1. `index.html` (root source)
กลับเป็น custom 404 page อย่างเดียว:
- `<meta name="robots" content="noindex, nofollow">` (เป็น 404 ไม่ควร index)
- ลบ `<link rel="canonical">`, hreflang, OG/Twitter meta tags ออกทั้งหมด (404 ไม่ควรมี)
- ลบ `<meta http-equiv="refresh">` ออก (ห้าม redirect)
- **ลบ `<script src="assets/js/lang-proxy.js">` ออก** (ห้าม JS redirect)
- แสดง "404 — Page Not Found" พร้อม link ไป `/home/` และ `/data/verse/discover/`

### 2. `_redirects` (dev/source root)
- ลบ rewrite `/` → `/home/index.html` ออก (ไม่ต้องการให้ `/` แสดง home)
- ลบ rewrite `/index.html` → `/home/index.html` ออก
- เก็บ rewrite `/en`, `/en/`, `/th`, `/th/` → `/home/index.html` (200) ไว้ (เป็น valid path)
- **Catch-all: `/* /index.html 404`** — ทุก path อื่น (รวม `/`, `/index.html`, และ path ที่ไม่มีจริง) ตอบ 404 + ส่ง custom 404 HTML ของเรา

### 3. `scripts/build.js`
แก้ `_generateRedirects()`:
- ลบ `/ /en/home/ 200` และ `/index.html /en/home/ 200` ออก
- ใช้ catch-all `/* /index.html 404` สำหรับ production
- **เพิ่ม `index.html` ใน `excludeDirs`** — ไม่ให้ build แปลง index.html เป็นแต่ละภาษา (จะทำให้ `/index.html` เป็น 404 page ที่ root ไม่ใช่ `/en/index.html` และ `/th/index.html`)
- **เพิ่ม `index.html` ใน `staticFiles`** — คัดลอก index.html ไป `dist/index.html` ตรงๆ (ไม่แปลภาษา)

### 4. `scripts/generate-sitemap.js`
- ลบ root URL `/` entry ออกจาก sitemap (เพราะ `/` ตอบ 404 ไม่ควรอยู่ใน sitemap)
- เพิ่ม `index.html` ใน exclude list (sync กับ build.js)

### 5. `scripts/lib/file-utils.js`
แก้ bug สำคัญใน `findHtmlFiles()`:
- **ครั้งที่ 1 (เดิม):** exclude patterns เทียบกับ absolute path → ไม่ match เลย → sitemap มี entry ผิดๆ `/en/dist/...`
- **ครั้งที่ 2 (แก้ผิด):** เทียบ entry name → ลบ `index.html` ทุกไฟล์ในทุกระดับ (รวม `/home/index.html`, `/search/index.html`) → เหลือแค่ 6 HTML files
- **ครั้งที่ 3 (ถูกต้อง):** track original root directory แยกจาก current directory ใน recursion แล้วเทียบ exclude patterns กับ relative path จาก original root เท่านั้น → `index.html` จะ match เฉพาะไฟล์ที่ root จริงๆ

### 6. `assets/js/lang-proxy.js`
กลับเป็นเหมือนเดิม (ยกเลิก CASE 0 ที่เพิ่มไปใน patch v2):
- ไม่ต้องมี exception สำหรับ `/` แล้ว เพราะ index.html (404 page) ไม่ได้ใช้ lang-proxy.js
- ไฟล์นี้ถูก strip ออกจาก production HTML โดย build.js อยู่แล้ว (`removeScriptPatterns`)
- เก็บไว้ใน patch เพื่อให้ไฟล์กลับเป็นสภาพเดิม (clean state)

### 7. `sitemap.xml`
Regenerate แล้ว:
- ไม่มี root URL `/` ใน sitemap (เพราะเป็น 404)
- ไม่มี entries ผิดๆ `/en/dist/...`
- ไม่มี `google6b646fa60e0f9f2f/`
- มี 17 entries ที่ถูกต้อง (เริ่มที่ `/en/assets/template-html/footer-template/` และอื่นๆ)

## วิธีติดตั้ง

วางไฟล์เหล่านี้ทับไฟล์เดิมใน repo ตามโครงสร้าง folder เดิม:

```
fantrove-page/
├── _redirects                                    ← ทับไฟล์เดิม
├── index.html                                    ← ทับไฟล์เดิม
├── sitemap.xml                                   ← ทับไฟล์เดิม
├── assets/
│   └── js/
│       └── lang-proxy.js                         ← ทับไฟล์เดิม
└── scripts/
    ├── build.js                                  ← ทับไฟล์เดิม
    ├── generate-sitemap.js                       ← ทับไฟล์เดิม
    └── lib/
        └── file-utils.js                         ← ทับไฟล์เดิม
```

จากนั้นรัน build:
```bash
npm install
npm run build
```

## หลังจาก Deploy

**พฤติกรรมใหม่:**
- ผู้ใช้เข้า `https://fantrove.pages.dev/` → เห็น custom 404 page ของเรา (มีปุ่ม "Take Me Home" ไป `/home/`)
- ผู้ใช้เข้า `https://fantrove.pages.dev/anything-not-exist` → เห็น custom 404 page เดียวกัน
- ผู้ใช้เข้า `https://fantrove.pages.dev/home/` หรือ `https://fantrove.pages.dev/en/home/` → เห็น home page ปกติ
- ผู้ใช้เข้า `https://fantrove.pages.dev/en/` หรือ `https://fantrove.pages.dev/th/` → เห็น home page ของภาษานั้น (URL คงเดิม)

**ใน Google Search Console:**
1. ไปที่ **URL Inspection** สำหรับ `https://fantrove.pages.dev/`
2. Google จะเห็นว่าเป็น 404 → ไม่ index แต่ไม่ใช่ "Page with redirect" อีกต่อไป
3. ไปที่ **URL Inspection** สำหรับ `https://fantrove.pages.dev/en/home/`
4. กด **Request Indexing** → Google จะ index canonical URL นี้เป็นหน้าแรกของเว็บ
5. รอ 1-3 วัน → สถานะ "Page with redirect" จะหายไปจาก GSC

## หมายเหตุสำคัญ

- การที่ `/` ตอบ 404 อาจดูแปลกในตอนแรก แต่มันคือสิ่งที่ถูกต้องตามการออกแบบ:
  - landing page จริงของเราคือ `/home/` ไม่ใช่ `/`
  - Google จะ index `/en/home/` (หรือ `/th/home/`) เป็น canonical URL ของหน้าแรก
  - ผู้ใช้ที่เข้า `/` จะเห็น custom 404 พร้อม link ไป `/home/` (UX ปกติของ 404)
- หากต้องการให้ `/` แสดง home content จริงๆ สามารถเปลี่ยน catch-all rule สุดท้ายจาก `404` เป็น `200` แต่มันจะทำให้ `/` กลายเป็น duplicate ของ `/en/home/` (แย่กว่า 404 ในแง่ SEO)
