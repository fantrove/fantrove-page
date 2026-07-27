# Fantrove — Redirect Fix Patch

แก้ปัญหา "Page with redirect" ใน Google Search Console ที่ทำให้ Google ไม่สามารถ index หน้า `/` และหน้าอื่นๆ ได้

## ปัญหาที่พบ

1. **`/` ถูก redirect 302** ไป `/en/home/` (จาก `_generateRedirects()` ใน `scripts/build.js`) → Google มองว่าเป็น "Page with redirect" และไม่ index
2. **`/index.html` (source) เป็นหน้า 404** พร้อม `<meta name="robots" content="noindex">` → ถ้าเข้าถึงตรงๆ จะไม่ถูก index เลย
3. **`lang-proxy.js` ทำ JS redirect ซ้ำ** สำหรับ URL ที่ไม่มี prefix ภาษา → ซ้ำซ้อนกับ server redirect สร้าง redirect chain
4. **Bug ใน `findHtmlFiles`**: exclude patterns เทียบ absolute path แทน relative path → ทำให้ sitemap มี entry ผิดๆ แบบ `/en/dist/...`
5. **Sitemap** ไม่มี entry สำหรับ `/` (root URL)

## ไฟล์ที่แก้ไข (7 ไฟล์)

### 1. `scripts/build.js`
เปลี่ยน `_generateRedirects()` function:
- `/` → `/en/home/` เปลี่ยนจาก `302` redirect เป็น `200` rewrite (URL คงเดิม, content จาก home)
- `/index.html` → `/en/home/` เปลี่ยนจาก `302` เป็น `200`
- `/en`, `/en/`, `/th`, `/th/` → `/en/home/` หรือ `/th/home/` เปลี่ยนจาก `302` เป็น `200`

### 2. `_redirects` (dev/source root)
- เพิ่ม rewrite rules: `/` → `/home/index.html` (200) และ `/index.html` → `/home/index.html` (200)
- เพิ่ม rewrite rules สำหรับ `/en`, `/en/`, `/th`, `/th/` → `/home/index.html` (200)

### 3. `index.html` (root source)
- ลบ `<meta name="robots" content="noindex">` ออก → เปลี่ยนเป็น `index, follow`
- เพิ่ม `<link rel="canonical" href="https://fantrove.pages.dev/en/home/">`
- เพิ่ม hreflang alternates (en, th, x-default)
- เพิ่ม Open Graph + Twitter Card meta tags
- เพิ่ม `<meta http-equiv="refresh" content="0; url=/home/">` (fallback สำหรับ direct access)
- แปลงจาก 404 page เป็น landing page ที่ SEO-friendly

### 4. `assets/js/lang-proxy.js`
- เพิ่ม CASE 0: ข้าม redirect ทั้งหมดสำหรับ `currentPath === '/'` หรือ `'/index.html'`
- ป้องกัน JS redirect ซ้ำซ้อนกับ server rewrite → Googlebot crawl `/` ได้ตรงๆ ไม่ติด redirect

### 5. `scripts/generate-sitemap.js`
- เพิ่ม root URL entry (`https://fantrove.pages.dev/`) เป็น entry แรกใน sitemap พร้อม priority 1.0
- เพิ่ม `google6b646fa60e0f9f2f.html` ใน exclude list (ไม่ใช่ content page)

### 6. `scripts/lib/file-utils.js`
แก้ bug ใน `findHtmlFiles()`:
- เดิม: `rel = fullPath` (absolute path) เทียบกับ `ex` (relative pattern เช่น `'dist'`) → exclude ไม่ทำงานเลย
- ใหม่: เทียบทั้ง `entry` (ชื่อ directory ตรงๆ), `relFromRoot`, และ prefix match → แก้ปัญหา sitemap มี entry แปลกๆ แบบ `/en/dist/...`

### 7. `sitemap.xml`
Regenerate แล้ว:
- เพิ่ม root URL `/` เป็น entry แรก (priority 1.0)
- ลบ entries ผิดๆ `/en/dist/...` ออกทั้งหมด
- ลบ entry `/en/google6b646fa60e0f9f2f/` ออก (เป็น google verification file)

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

ใน Google Search Console:
1. ไปที่ **URL Inspection** สำหรับ `https://fantrove.pages.dev/`
2. กด **Request Indexing**
3. รอ 1-3 วัน Googlebot จะ recrawl และเห็นว่า `/` ตอบ 200 OK พร้อม content ของ home page (ไม่ใช่ redirect อีกต่อไป)
4. สถานะ "Page with redirect" จะหายไป และ canonical URL (`/en/home/`) จะถูก index แทน

## หมายเหตุสำคัญ

- การใช้ `200` rewrite แทน `302` redirect หมายความว่า URL ใน address bar จะคงเดิม (เช่น `/`) แต่ content มาจาก `/en/home/`
- ในหน้า home มี `<link rel="canonical" href="https://fantrove.pages.dev/en/home/">` อยู่แล้ว → Google จะ index canonical URL ไม่ใช่ `/`
- แต่ละหน้า `/`, `/en/`, `/th/` จะถูกมองเป็น "duplicate with canonical tag" (indexable แต่ canonical อยู่ที่อื่น) ซึ่งดีกว่า "Page with redirect" (ไม่ index เลย) มาก
