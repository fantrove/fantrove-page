# 09 — คู่มือ Deployment (Deployment Guide)

> เอกสารนี้อธิบายวิธี deploy โปรเจกต์ **Fantrove** (หรือ Fantrove Verse) บน Cloudflare Pages — ตั้งแต่การตั้งค่าครั้งแรก, build process, environment variables, ไปจนถึงการตรวจสอบหลัง deploy
>
> **สำหรับ:** นักพัฒนา/AI ที่รับผิดชอบการ deploy หรือตั้งค่า environment ใหม่
>
> **Platform:** Cloudflare Pages | **Build tool:** Node.js 18+ | **License:** Apache 2.0

---

## สารบัญ

1. [ภาพรวม Deployment](#1-ภาพรวม-deployment)
2. [Prerequisites](#2-prerequisites)
3. [Build Process — วิธีการทำงาน](#3-build-process--วิธีการทำงาน)
4. [Cloudflare Pages Configuration](#4-cloudflare-pages-configuration)
5. [Environment Variables](#5-environment-variables)
6. [Build Script อย่างละเอียด](#6-build-script-อย่างละเอียด)
7. [URL Routing & Redirects](#7-url-routing--redirects)
8. [Headers & Caching Strategy](#8-headers--caching-strategy)
9. [Version Bumping & Release](#9-version-bumping--release)
10. [Sitemap Generation](#10-sitemap-generation)
11. [Post-deploy Verification](#11-post-deploy-verification)
12. [Rollback & Recovery](#12-rollback--recovery)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. ภาพรวม Deployment

Fantrove เป็น static website ที่ deploy บน **Cloudflare Pages** ที่ URL `fantrove.pages.dev` (และ custom domain ถ้ามี) การ deploy ไม่ใช้แค่ "push ไฟล์ขึ้น server" แต่มี **build step** ที่สำคัญ — เพื่อสร้าง static HTML สำหรับแต่ละภาษาจาก source HTML + translation JSON

### 1.1 ขั้นตอนระดับสูง

```
Developer push ไป GitHub
        │
        ▼
Cloudflare Pages ตรวจจับ push
        │
        ▼
Run build command: `npm run build`
        │
        ▼
Build script (scripts/build.js):
  1. อ่าน db.json → รู้ภาษาทั้งหมด (en, th)
  2. โหลด translation JSON ของแต่ละภาษา
  3. หาไฟล์ HTML ทุกไฟล์
  4. สำหรับแต่ละ HTML × ภาษา:
     - แปลง [data-translate] → text จริง
     - ลบ language system scripts บางตัว
     - เพิ่ม hreflang + canonical
     - prefix internal links ด้วย /lang
     - บันทึกไป dist/{lang}/{path}
  5. Copy assets/ → dist/assets/
  6. Copy static files (_headers, robots.txt, etc.)
  7. Generate sitemap
        │
        ▼
Deploy dist/ ขึ้น Cloudflare Pages CDN
        │
        ▼
เว็บ live ที่ fantrove.pages.dev
```

### 1.2 ทำไมต้องมี build step?

ถ้าไม่ build แล้ว push source ตรง ๆ จะเกิดปัญหา:

- **SEO แย่** — search engine เห็นแค่ `<div data-translate="home.title"></div>` ไม่เห็นข้อความจริง
- **First paint ช้า** — browser ต้องโหลด language system ก่อนแล้วค่อยแปล ทำให้ผู้ใช้เห็นหน้าว่าง ๆ ก่อน
- **No-JavaScript ใช้งานไม่ได้** — ถ้าผู้ใช้ปิด JS จะเห็นแค่ tag เปล่า ๆ

Build step แก้ปัญหาทั้งหมดโดยสร้าง HTML ที่แปลแล้วล่วงหน้า ทำให้ทั้ง SEO ดี โหลดเร็ว และใช้ได้แม้ไม่มี JS

---

## 2. Prerequisites

### 2.1 Local Development

ต้องมีบนเครื่องนักพัฒนา:

| สิ่งที่ต้องมี | เวอร์ชัน | วิธีตรวจสอบ |
|---|---|---|
| Node.js | >= 18.0.0 | `node --version` |
| npm | >= 9.0.0 | `npm --version` |
| Git | เวอร์ชันล่าสุด | `git --version` |

### 2.3 Cloudflare Account

- บัญชี Cloudflare ที่สามารถสร้าง Pages project ได้
- GitHub repository เชื่อมกับ Cloudflare Pages (auto-deploy)
- หรือใช้ `wrangler pages deploy` สำหรับ manual deploy

### 2.4 การติดตั้งครั้งแรก

```bash
# Clone repo
git clone https://github.com/fantrove/fantrove-page.git
cd fantrove-page

# ติดตั้ง dependencies
npm install

# ทดสอบ build ในเครื่อง
npm run build

# ดูผลลัพธ์ใน dist/
ls dist/
```

หลังจาก build เสร็จ ควรเห็น:
```
dist/
├── en/                    # หน้าภาษาอังกฤษ
│   ├── home/
│   ├── search/
│   ├── setting/
│   └── ...
├── th/                    # หน้าภาษาไทย
│   ├── home/
│   ├── search/
│   └── ...
├── assets/                # Static assets (รวมกันทั้งสองภาษา)
├── _headers
├── _redirects
├── robots.txt
└── sitemap.xml
```

---

## 3. Build Process — วิธีการทำงาน

### 3.1 คำสั่งที่ใช้

| คำสั่ง | ความหมาย | เมื่อไหร่ใช้ |
|---|---|---|
| `npm run build` | Build ปกติ | CI/CD บน Cloudflare |
| `npm run build:dry` | Dry-run ไม่เขียนไฟล์ | ตรวจสอบก่อน build จริง |
| `npm run build:verbose` | Build พร้อม log ละเอียด | Debug ปัญหา translation |
| `npm run clean` | ลบ dist/ | เริ่ม build ใหม่สะอาด |
| `npm run generate-sitemap` | สร้าง sitemap.xml อย่างเดียว | หลังเพิ่มหน้าใหม่ |

### 3.2 Build Script Pipeline

Build script หลักอยู่ที่ `scripts/build.js` ทำงานเป็นขั้นตอนดังนี้:

#### Step 1: Load language config

อ่าน `assets/lang/options/db.json` เพื่อรู้ว่าต้องสร้างกี่ภาษา

```json
{
  "en": { "name": "English", "enabled": true },
  "th": { "name": "ไทย", "enabled": true }
}
```

#### Step 2: Load translation files

โหลด `assets/lang/en.json` และ `assets/lang/th.json` เป็น flat key-value structure

#### Step 3: Discover HTML files

หาไฟล์ `.html` ทุกไฟล์ในโปรเจกต์ ยกเว้น:
- `dist/` (build output)
- `node_modules/`
- `.git/`
- `scripts/`
- `google6b646fa60e0f9f2f.html` (Google verification)

#### Step 4: Transform each HTML × language

สำหรับทุกไฟล์ HTML × ทุกภาษา ทำ transformation:

1. **แปลเนื้อหา** — เปลี่ยน `<div data-translate="home.title"></div>` → `<div>Welcome</div>` (หรือ "ยินดีต้อนรับ" สำหรับ th)
2. **ลบ translation markers** — ลบ attribute `data-translate`, `data-original-*` ออก
3. **ลบ language system scripts ที่ไม่จำเป็น**:
   - `lang-proxy.js` (URL มี prefix แล้ว ไม่ต้อง redirect)
   - `lang-sync.js` (ไม่มี tab sync ที่ต้องทำ)
   - `lang-coordinator.js` (setting page เท่านั้น)
4. **ลบ body opacity:0** — ไม่ต้องซ่อนรอแปล เพราะแปลแล้ว
5. **เพิ่ม SEO tags** — `<link rel="canonical">`, `<link rel="alternate" hreflang="...">`
6. **Prefix internal links** — เปลี่ยน `/home/` → `/en/home/` หรือ `/th/home/`
7. **Inject footer template** — แทนที่จะ fetch ตอน runtime

#### Step 5: Copy assets + static files

- `assets/` → `dist/assets/` (เหมือนเดิมทั้งสองภาษา)
- Static files ที่ระบุใน `CONFIG.staticFiles` → `dist/`:
  - `robots.txt`
  - `sitemap.xml`
  - `_headers`
  - `google6b646fa60e0f9f2f.html`
- Hidden dirs ที่ระบุใน `CONFIG.passThroughHiddenDirs`:
  - `.well-known/` (domain verification)

#### Step 6: Generate sitemap

`scripts/generate-sitemap.js` สร้าง `sitemap.xml` จากรายการหน้าทั้งหมด × ภาษา

### 3.3 Dry-run mode

ใช้ `npm run build:dry` เพื่อจำลอง build โดยไม่เขียนไฟล์จริง — มีประโยชน์เมื่อต้องการ:

- ตรวจสอบว่าจะมีกี่ไฟล์ถูกสร้าง
- ดูว่า translation key ไหนขาด
- ทดสอบว่า build ผ่านโดยไม่เสียเวลาเขียนไฟล์

### 3.4 Verbose mode

ใช้ `npm run build:verbose` เพื่อดู log ละเอียด — เหมาะสำหรับ debug:

- แต่ละ element ที่ถูกแปล
- แต่ละ script ที่ถูกลบ
- แต่ละ link ที่ถูก prefix

---

## 4. Cloudflare Pages Configuration

### 4.1 ตั้งค่าครั้งแรก

ใน Cloudflare Dashboard → Pages → Create project → Connect to Git:

| Setting | Value |
|---|---|
| Project name | `fantrove` |
| Production branch | `main` |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | (empty) |
| Environment variables | ดูหัวข้อถัดไป |

### 4.2 Build settings

```
Build command:        npm run build
Build output dir:     dist
Root directory:       /
Node.js version:      18  (set via NODE_VERSION env var)
```

### 4.3 Deploy hooks

- **Production deploy**: เมื่อ push ไป branch `main`
- **Preview deploy**: เมื่อ push ไป branch อื่นหรือ PR
- **Manual deploy**: ใช้ "Retry deployment" ใน dashboard

---

## 5. Environment Variables

### 5.1 ที่ต้องตั้งใน Cloudflare Pages

| Variable | Value | ใช้ที่ไหน |
|---|---|---|
| `NODE_VERSION` | `18` | Build container |
| `APP_VERSION` | (set by CI) | `scripts/update-version.js` |

### 5.2 ในไฟล์ build.js (hardcoded)

ค่าเหล่านี้อยู่ใน `scripts/build.js` ที่ `CONFIG` object:

```javascript
const CONFIG = {
  srcDir: '.',
  distDir: 'dist',
  assetsDir: 'assets',
  dbJsonPath: 'assets/lang/options/db.json',
  translationPath: (lang) => `assets/lang/${lang}.json`,
  defaultLang: 'en',
  baseUrl: 'https://fantrove.pages.dev',
  // ...
};
```

หากต้องการเปลี่ยนค่าเหล่านี้ ให้แก้ที่ `scripts/build.js` โดยตรง

### 5.3 Secrets / API keys

ปัจจุบัน Fantrove ไม่มี server-side code จึงไม่มี secrets ที่ต้องเก็บ แต่ third-party services ที่ใช้บนเว็บ (GTM, GA4, AdSense) มี ID ฝังอยู่ใน HTML โดยตรง — ดูรายละเอียดใน `00-System-Architecture.md` ส่วน Third-Party Integrations

---

## 6. Build Script อย่างละเอียด

### 6.1 ไฟล์ที่เกี่ยวข้อง

```
scripts/
├── build.js              # Main orchestrator (424 บรรทัด)
├── generate-sitemap.js   # Sitemap generator
├── update-version.js     # Version bumper (CI/CD)
└── lib/
    ├── file-utils.js      # File operations (findHtmlFiles, copyDir, etc.)
    ├── html-transformer.js # HTML transformation (Cheerio-based)
    └── marker-parser.js   # Translation marker parsing
```

### 6.2 Dependency: Cheerio

Build script ใช้ **Cheerio** (npm dependency) สำหรับ parse HTML แบบ DOM-like ใน Node.js:

```json
{
  "dependencies": {
    "cheerio": "^1.0.0"
  }
}
```

`html-transformer.js` ใช้ Cheerio สำหรับ:
- ค้นหา `[data-translate]` elements
- แก้ attribute href ของ `<a>` tags
- ลบ `<script>` tags ที่ระบุ
- เพิ่ม `<link>` tags สำหรับ hreflang

### 6.3 Configuration options

ใน `scripts/build.js` ที่ `CONFIG` object:

| Field | Default | ความหมาย |
|---|---|---|
| `srcDir` | `.` | ต้นทาง HTML files |
| `distDir` | `dist` | ปลายทาง build output |
| `assetsDir` | `assets` | ชื่อโฟลเดอร์ assets |
| `dbJsonPath` | `assets/lang/options/db.json` | ไฟล์ config ภาษา |
| `translationPath` | `(lang) => assets/lang/${lang}.json` | ฟังก์ชันหา translation file |
| `defaultLang` | `en` | ภาษา default (สำหรับ x-default hreflang) |
| `excludeDirs` | `[dist, node_modules, .git, scripts, ...]` | โฟลเดอร์ที่ไม่ build |
| `removeScriptPatterns` | `[lang-proxy.js, lang-sync.js, lang-coordinator.js]` | Scripts ที่ลบออกจาก built pages |
| `baseUrl` | `https://fantrove.pages.dev` | URL หลักสำหรับ canonical/hreflang |
| `staticFiles` | `[robots.txt, sitemap.xml, _headers, ...]` | ไฟล์ที่ copy ตรงไป dist/ |
| `passThroughHiddenDirs` | `[.well-known]` | Hidden dirs ที่ copy ตรง |
| `footerTemplatePath` | `assets/template-html/footer-template.html` | Footer template สำหรับ inject |

---

## 7. URL Routing & Redirects

### 7.1 ไฟล์ `_redirects`

Cloudflare Pages ใช้ไฟล์ `_redirects` สำหรับ routing ที่ server level (ก่อนถึง client):

```
# Fallback: any unknown path → serve index.html with 200 (rewrite, not redirect)
/* /index.html 200

# Language routes
/en/* /:splat 200
/th/* /:splat 200

# Static files
/assets/* /assets/:splat 200
/robots.txt /robots.txt 200
/sitemap.xml /sitemap.xml 200
/favicon.ico /assets/images/fantrove-verse360.ico 200
```

### 7.2 URL Structure หลัง build

```
https://fantrove.pages.dev/
    │
    ├── /en/home/                    # Home (English)
    ├── /en/search/                  # Search (English)
    ├── /en/data/verse/discover/     # Discover (English)
    ├── /en/setting/                 # Settings (English)
    │
    ├── /th/home/                    # Home (Thai)
    ├── /th/search/                  # Search (Thai)
    ├── /th/data/verse/discover/     # Discover (Thai)
    ├── /th/setting/                 # Settings (Thai)
    │
    ├── /assets/...                  # Static assets (shared)
    ├── /robots.txt
    ├── /sitemap.xml
    └── /favicon.ico
```

### 7.3 กฎที่สำคัญ

- **`/`** ไม่ได้เปลี่ยนเส้นทาง แต่กลับมาที่ `index.html` (rewrite 200) ซึ่งเป็น fallback page
- **`/en` และ `/th`** ไม่ได้เปลี่ยนเส้นทาง — ใช้ `/:splat` rewrite แทน ทำให้ URL สะอาด
- **Unknown paths** กลับมาที่ `index.html` เพื่อให้ client-side routing จัดการ

---

## 8. Headers & Caching Strategy

### 8.1 ไฟล์ `_headers`

Cloudflare Pages ใช้ `_headers` สำหรับกำหนด HTTP headers:

```
# JSON ที่ต้องอัปเดตเร็ว — ห้าม cache
/assets/json/whats-new.json
  Cache-Control: no-store, no-cache, max-age=0, must-revalidate

/assets/json/release-history.json
  Cache-Control: no-store, no-cache, max-age=0, must-revalidate

/assets/md/releases/index.json
  Cache-Control: no-store, no-cache, max-age=0, must-revalidate

/assets/json/current-stage.json
  Cache-Control: no-store, no-cache, max-age=0, must-revalidate

# Content-Language header
/th/*
  Content-Language: th
/en/*
  Content-Language: en

# Assets ทั่วไป — cache 1 วัน (bust ด้วย ?v= ทุก deploy)
/assets/*
  Cache-Control: public, max-age=86400, stale-while-revalidate=86400

# HTML — ห้าม cache เพื่อให้ update ทันที
/index.html
  Cache-Control: no-store, no-cache, max-age=0, must-revalidate
/*
  Cache-Control: no-store, no-cache, max-age=0, must-revalidate

# Gzip ทุก path
/*
  Content-Encoding: gzip
  Vary: Accept-Encoding
```

### 8.2 กลยุทธ์ Caching อธิบาย

| ประเภทไฟล์ | Cache | เหตุผล |
|---|---|---|
| `whats-new.json`, `release-history.json`, `current-stage.json`, `releases/index.json` | ❌ no-cache | ต้องอัปเดตทันทีเมื่อมี release ใหม่ |
| `/assets/*` (JS, CSS, images) | ✅ 1 วัน + SWR 1 วัน | ใช้ `?v=` query string สำหรับ cache busting |
| `index.html` + HTML ทั้งหมด | ❌ no-cache | ต้องเห็น version ใหม่ทันทีหลัง deploy |

### 8.3 Cache Busting

เมื่อ deploy เวอร์ชั่นใหม่ build script เพิ่ม `?v={timestamp}` ต่อท้าย URL ของ assets ใน HTML:

```html
<!-- ก่อน deploy -->
<script src="/assets/js/home.js"></script>

<!-- หลัง deploy -->
<script src="/assets/js/home.js?v=1718870400000"></script>
```

ทำให้ browser ดาวน์โหลด assets เวอร์ชั่นใหม่แม้ cache ยังไม่หมดอายุ

---

## 9. Version Bumping & Release

### 9.1 ไฟล์ `scripts/update-version.js`

Script นี้ทำงานใน CI/CD pipeline หลังจาก git push:

1. อ่าน `APP_VERSION` environment variable
2. โหลด `release-dates.json` (registry ของ "วันที่ build ครั้งแรกของแต่ละ version" — commit ลง git)
3. กำหนด release date ของ version ปัจจุบัน:
   - ถ้า version มีอยู่แล้วใน registry → ใช้ date เดิม (stable)
   - ถ้า version ใหม่ → ใช้ `NOW` (เวลา ณ ตอน build ครั้งแรกของ version นี้)
   - ⚠️ ไม่อ่าน `date:` จาก `current.md` เพราะผู้ใช้อาจเขียนมั่วๆ ที่ไม่ตรงกับเวลาจริง
4. อัปเดต `version.json` (พร้อม `date` จาก registry)
5. อ่าน git history ของ `current.md` สร้าง history (backfill registry สำหรับ version เก่าที่ยังไม่มี)
6. สร้าง `releases/v{version}.md` จาก `current.md` (เมื่อ version ใหม่) — commit ลง git
7. สร้าง `releases/index.json` (manifest สำหรับ client) — commit ลง git
8. sync `date:` ใน `current.md` ให้ตรงกับ registry เสมอ (เขียนทับถ้าผู้ใช้เขียนมั่ว)
9. บันทึก `release-dates.json` ที่อัปเดตแล้วกลับลง disk (commit ไฟล์นี้ลง git)
10. Cache-bust HTML (`?v={version}-{dateStr}`)

> ⚠️ **ห้ามแก้ `release-dates.json`, `releases/index.json`, `releases/v{version}.md` เอง** — ดู [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) section 9.2 และ [`11-Release-Notes-System.md`](./11-Release-Notes-System.md) section 2.3-2.4
>
> ⚠️ **ผู้ใช้ไม่ต้องเขียน `date:` ใน `current.md` เอง** — ระบบจะ sync ให้อัตโนมัติจาก registry

### 9.2 ขั้นตอน release เวอร์ชั่นใหม่

```bash
# 1. เขียน current.md ใหม่ (ทั้งสองภาษา) ตาม RELEASE_NOTES_GUIDE.md
#    แก้ version: 1.8.0 ใน frontmatter
#    ⚠️ ห้าม copy current.md ไป releases/ — build script สร้างประวัติจาก git history อัตโนมัติ

# 2. Commit
git add assets/md/
git commit -m "release: v1.8.0"
git push

# 4. CI/CD ทำงานอัตโนมัติ:
#    - Cloudflare Pages build
#    - Build script: APP_VERSION=1.8.0 node scripts/update-version.js
#    - Deploy dist/ ขึ้น CDN
```

ดูรายละเอียดเพิ่มเติมใน [`RELEASE_NOTES_GUIDE.md`](./RELEASE_NOTES_GUIDE.md) ส่วนกระบวนการเผยแพร่

---

## 10. Sitemap Generation

### 10.1 ไฟล์ `scripts/generate-sitemap.js`

Script สร้าง `sitemap.xml` จากรายการหน้าทั้งหมด × ภาษา:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://fantrove.pages.dev/en/home/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://fantrove.pages.dev/th/home/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <!-- ... หน้าอื่น ๆ ... -->
</urlset>
```

### 10.2 Postbuild step

`package.json` กำหนด `postbuild` script:

```json
"postbuild": "npm run generate-sitemap && node -e \"...copy sitemap to dist/...\""
```

ทำให้หลัง `npm run build` เสร็จ sitemap จะถูกสร้างและ copy ไป `dist/` อัตโนมัติ

---

## 11. Post-deploy Verification

หลัง deploy เสร็จ ให้ตรวจสอบดังนี้:

### 11.1 ตรวจสอบด้วย browser

- [ ] เปิด `https://fantrove.pages.dev/` — ควร redirect ไป `/en/home/` หรือ `/th/home/` ตาม browser language
- [ ] เปิด `/en/home/` ตรง ๆ — ควรเห็นเนื้อหาเป็นภาษาอังกฤษทันที (ไม่ต้องรอ JS)
- [ ] เปิด `/th/home/` ตรง ๆ — ควรเห็นเนื้อหาเป็นภาษาไทยทันที
- [ ] สลับภาษา — ควรเปลี่ยน URL และเนื้อหา
- [ ] เปิด What's New หน้า — ควรแสดง release notes ล่าสุด
- [ ] เปิด Search — ควรค้นหาได้ปกติ

### 11.2 ตรวจสอบด้วย DevTools

- [ ] **Network tab** — ไม่มี 404, ทุก asset โหลดสำเร็จ
- [ ] **Console** — ไม่มี error สีแดง (warning อาจมีได้)
- [ ] **Application tab → Cache Storage** — service worker (ถ้ามี) ลงทะเบียนถูกต้อง
- [ ] **Lighthouse** — score Performance > 80, SEO = 100, Accessibility > 90

### 11.3 ตรวจสอบด้วย external tools

- [ ] [PageSpeed Insights](https://pagespeed.web.dev/) — ตรวจ performance
- [ ] [Rich Results Test](https://search.google.com/test/rich-results) — ตรวจ structured data
- [ ] [SSL Labs](https://www.ssllabs.com/ssltest/) — ตรวจ SSL certificate
- [ ] Google Search Console — ตรวจ indexing status

### 11.4 ตรวจสอบ version.json

```bash
curl https://fantrove.pages.dev/assets/json/version.json
```

ควรได้:
```json
{
  "version": "1.8.0",
  "updatedAt": "2026-06-20T00:00:00.000Z"
}
```

---

## 12. Rollback & Recovery

### 12.1 Rollback ผ่าน Cloudflare Dashboard

1. ไปที่ Cloudflare Pages → Project → Deployments
2. หกบ deployment ก่อนหน้าที่ต้องการ rollback
3. กด "Rollback to this deployment"
4. รอ 1-2 นาที CDN จะอัปเดต

### 12.2 Rollback ผ่าน Git

```bash
# หา commit ล่าสุดที่ทำงานได้
git log --oneline -20

# Reset กลับ
git revert <bad-commit-hash>
git push

# หรือ reset hard (ทำลายประวัติ — ใช้ด้วยความระมัดระวัง)
git reset --hard <good-commit-hash>
git push --force
```

### 12.3 Emergency disable

ถ้าเว็บพังวิกฤต สามารถ:

- **Pause deployments** ใน Cloudflare Pages settings
- **Enable maintenance mode** โดยแก้ `_redirects` ให้ทุก path ไปที่ maintenance page
- **Switch DNS** ไปยัง backup domain (ถ้ามี)

---

## 13. Troubleshooting

### 13.1 Build fails: "Cannot find db.json"

**สาเหตุ:** ไฟล์ `assets/lang/options/db.json` หายไปหรือ path ผิด

**วิธีแก้:**
```bash
ls -la assets/lang/options/db.json
# ถ้าไม่มี ให้ restore จาก git
git checkout HEAD -- assets/lang/options/db.json
```

### 13.2 Build fails: "Cheerio not found"

**สาเหตุ:** dependencies ไม่ได้ติดตั้ง

**วิธีแก้:**
```bash
npm install
```

### 13.3 Translation หายใน production

**สาเหตุ:** translation key ขาดใน `assets/lang/{lang}.json`

**วิธีแก้:**
```bash
# Run verbose build เพื่อหา key ที่ขาด
npm run build:verbose 2>&1 | grep "missing"

# เพิ่ม key ที่ขาดใน assets/lang/en.json และ th.json
```

### 13.4 Page โหลดขาว ๆ ใน production

**สาเหตุ:** อาจเป็นเพราะ:
- JavaScript error บนหน้า (เช็ค Console)
- Asset โหลดไม่ได้ (เช็ค Network tab)
- Cache ยังเก่า (ลอง hard refresh: Ctrl+Shift+R)

### 13.5 CDN ยังแสดงเวอร์ชั่นเก่า

**สาเหตุ:** Cache ของ Cloudflare CDN ยังไม่หมดอายุ

**วิธีแก้:**
1. ไปที่ Cloudflare Dashboard → Caching → Configuration
2. กด "Purge Everything" (ระวัง: กระทบผู้ใช้ทั้งหมด)
3. หรือ purge เฉพาะ URL ที่อัปเดต

### 13.6 Sitemap.xml ไม่อัปเดต

**สาเหตุ:** `generate-sitemap.js` ไม่ได้รัน

**วิธีแก้:**
```bash
npm run generate-sitemap
# แล้ว copy ไป dist/ เอง
cp sitemap.xml dist/sitemap.xml
```

### 13.7 Redirect ไม่ทำงาน

**สาเหตุ:** `_redirects` ไม่ถูก copy ไป `dist/`

**วิธีแก้:**
```bash
ls dist/_redirects
# ถ้าไม่มี ให้ copy เอง
cp _redirects dist/_redirects
```

ตรวจสอบว่า `_redirects` อยู่ใน `CONFIG.staticFiles` ใน `scripts/build.js`

---

> หากมีปัญหาที่ไม่อยู่ใน troubleshooting ให้ตรวจสอบ Cloudflare Pages build logs ก่อน แล้วค่อยเปิด issue ใน GitHub

---

## 14. Cross-references (เพิ่มเติม)

- [`12-SEO-Guide.md`](./12-SEO-Guide.md) — ⭐ SEO requirements สำหรับ deployment: sitemap submission, _redirects สำหรับ 301, _headers สำหรับ caching, robots.txt — ทุก deploy ต้องผ่าน SEO checklist ใน `12-SEO-Guide.md` ส่วน 17
