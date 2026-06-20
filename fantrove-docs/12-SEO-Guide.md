# 12 — SEO Guide (Search Engine Optimization Strategy)

> เอกสารนี้คือ **กลยุทธ์ SEO ระดับ platform** ของ Fantrove — ปฏิบัติดังทีมงานของแพลตฟอร์มใหญ่ที่ดำเนินมาหลายปี ไม่ใช่ checklist เล็ก ๆ ของเว็บเริ่มต้น
>
> **สำหรับ:** AI และนักพัฒนาทุกคน — ทุกการตัดสินใจทางเทคนิคต้องคำนึงถึง SEO
>
> **Priority:** 🥇 สูงสุด (พิเศษ) — SEO ชนะทุก priority อื่นเมื่อมี conflict ยกเว้นมีเหตุผลที่ชัดเจนมากเป็นพิเศษ
>
> **ครอบคลุม:** Technical SEO, structured data, Core Web Vitals, international SEO, E-E-A-T, content SEO, analytics, checklist, สิ่งที่ห้ามทำ

---

## สารบัญ

1. [ภาพรวมกลยุทธ์ SEO](#1-ภาพรวมกลยุทธ์-seo)
2. [Technical SEO Foundation](#2-technical-seo-foundation)
3. [Meta Tags Strategy](#3-meta-tags-strategy)
4. [hreflang & International SEO](#4-hreflang--international-seo)
5. [Canonical URLs & URL Structure](#5-canonical-urls--url-structure)
6. [Sitemap Strategy](#6-sitemap-strategy)
7. [robots.txt & Crawl Budget](#7-robotstxt--crawl-budget)
8. [Structured Data (JSON-LD Schema.org)](#8-structured-data-json-ld-schemaorg)
9. [Core Web Vitals](#9-core-web-vitals)
10. [Mobile-First Indexing](#10-mobile-first-indexing)
11. [Content SEO](#11-content-seo)
12. [Image SEO](#12-image-seo)
13. [Internal Linking Strategy](#13-internal-linking-strategy)
14. [E-E-A-T](#14-e-e-a-t)
15. [404 & Redirect Strategy](#15-404--redirect-strategy)
16. [Analytics & Search Console](#16-analytics--search-console)
17. [SEO Checklist สำหรับ AI/นักพัฒนา](#17-seo-checklist-สำหรับ-aiนักพัฒนา)
18. [สิ่งที่ห้ามทำ (SEO Forbidden)](#18-สิ่งที่ห้ามทำ-seo-forbidden)
19. [อ้างอิงข้ามเอกสาร](#19-อ้างอิงข้ามเอกสาร)

---

## 1. ภาพรวมกลยุทธ์ SEO

Fantrove เป็น static website บน Cloudflare Pages ที่แสดงอีโมจิ สัญลักษณ์ ข้อความแฟนซี และคอลเลกชัน — ทุกอย่างที่ทำให้ search engine เข้าใจเราดีขึ้นคือ SEO ที่ดี กลยุทธ์ SEO ของเราออกแบบมาเพื่อแข่งกับเว็บใหญ่ ๆ ในสายเดียวกัน (เช่น Emojipedia, SymbolKeyboard, Fancy Text Generator) โดยใช้จุดแข็งหลัก 3 อย่าง:

### 1.1 จุดแข็งทาง SEO ของ Fantrove

1. **Static HTML pre-built** — เนื้อหาทุกหน้าแปลแล้วล่วงหน้าใน HTML ตอน build time search engine crawl ได้ทันที ไม่ต้องรอ JavaScript
2. **Multi-language native** — แต่ละภาษามี URL เฉพาะ (`/en/`, `/th/`) พร้อม hreflang ที่ถูกต้อง Google เข้าใจเนื้อหาแต่ละภาษาแยกกัน
3. **Performance ระดับ platform** — URE virtual scroll ทำให้แสดง content จำนวนมหาศาลได้โดย Core Web Vitals ผ่าน thresholds ของ Google

### 1.2 คู่แข่งหลักและจุดที่ต้องชนะ

| คู่แข่ง | จุดแข็งของเขา | จุดที่เราต้องชนะ |
|---|---|---|
| Emojipedia | Content depth, brand authority | Multi-language (พวกเขามีหลายภาษา แต่เราต้องทำให้ดีกว่าในภาษาไทย) |
| SymbolKeyboard | Speed, simple UX | Performance + structured data |
| Fancy Text Generator | Domain age, backlinks | Technical SEO + content freshness |

### 1.3 หลักการสำคัญ 5 ข้อ

1. **Static-first** — content สำคัญต้องอยู่ใน static HTML ไม่ใช่ render ด้วย JS อย่างเดียว
2. **Performance = SEO** — Core Web Vitals ส่งผลต่อ ranking โดยตรง ต้องดูแลทุกหน้า
3. **International done right** — hreflang + canonical + localized content ต้องสอดคล้องกัน
4. **Structured data everywhere** — JSON-LD บนทุกหน้าที่มี content ที่ schema.org รองรับ
5. **Never break what works** — ทุกการเปลี่ยนแปลงต้องไม่ทำลาย SEO ที่มีอยู่

---

## 2. Technical SEO Foundation

Technical SEO คือพื้นฐานที่ทำให้ search engine เข้าถึงและเข้าใจเนื้อหาเราได้ โดยไม่มีอุปสรรคทางเทคนิค

### 2.1 Static HTML pre-build

Fantrove ใช้ build system (`scripts/build.js`) ที่แปล translation markers (`[data-translate]`) เป็น text จริงใน HTML ก่อน deploy ทำให้:

- ✅ Search engine เห็นเนื้อหาเป็นภาษาที่แปลแล้ว ไม่ใช่แค่ tag เปล่า ๆ
- ✅ First Contentful Paint (FCP) เร็วขึ้นเพราะ browser ไม่ต้องรอ JS แปล
- ✅ ใช้งานได้แม้ผู้ใช้ปิด JavaScript
- ✅ Crawl budget ดีขึ้นเพราะ Googlebot ไม่ต้อง render ด้วย JS

> ⚠️ ห้าม render เนื้อหาสำคัญด้วย JavaScript อย่างเดียว — ต้องอยู่ใน static HTML เสมอ ดู `AI_FORBIDDEN.md` ส่วน SEO violations

### 2.2 Server response & hosting

- **Hosting:** Cloudflare Pages (CDN ทั่วโลก, edge caching, HTTP/3)
- **Response time:** < 200ms TTFB ทุกหน้า
- **HTTPS:** บังคับทุกหน้า (Cloudflare auto-redirect HTTP → HTTPS)
- **HTTP/2 + HTTP/3:** เปิดใช้งาน
- **Brotli/Gzip compression:** เปิดใช้งานผ่าน `_headers`

### 2.3 Crawlability

- ทุกหน้าเข้าถึงได้ผ่าน link ธรรมดา (ไม่ใช่ JS click handler เท่านั้น)
- ไม่มี orphan pages (ทุกหน้ามี link ชี้เข้าจากหน้าอื่น)
- Sitemap.xml ส่งให้ Google Search Console และ Bing Webmaster Tools

---

## 3. Meta Tags Strategy

Meta tags บอก search engine และ social media ว่าหน้านี้เกี่ยวกับอะไร — ต้องมีในทุกหน้า, เป็นภาษาของหน้านั้น, และ unique ไม่ซ้ำกัน

### 3.1 Required meta tags ทุกหน้า

```html
<!DOCTYPE html>
<html lang="{lang}">
<head>
  <!-- Primary -->
  <title>{page-specific title, 50-60 characters, ภาษาของหน้า}</title>
  <meta name="description" content="{page-specific description, 150-160 characters, ภาษาของหน้า}">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">

  <!-- Canonical -->
  <link rel="canonical" href="https://fantrove.pages.dev/{lang}/{page}/">

  <!-- hreflang (ดู section 4) -->
  <link rel="alternate" hreflang="en" href="https://fantrove.pages.dev/en/{page}/">
  <link rel="alternate" hreflang="th" href="https://fantrove.pages.dev/th/{page}/">
  <link rel="alternate" hreflang="x-default" href="https://fantrove.pages.dev/en/{page}/">

  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://fantrove.pages.dev/{lang}/{page}/">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{description}">
  <meta property="og:image" content="https://fantrove.pages.dev/assets/images/OG/{page-og}.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="{lang}_TH or {lang}_US">
  <meta property="og:site_name" content="Fantrove">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{title}">
  <meta name="twitter:description" content="{description}">
  <meta name="twitter:image" content="https://fantrove.pages.dev/assets/images/OG/{page-og}.png">

  <!-- Theme color -->
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)">
</head>
```

### 3.2 กฎการเขียน title

- ความยาว **50-60 ตัวอักษร** (Google ตัดที่ประมาณ 60)
- ใส่ keyword หลักที่ต้นประโยค
- ใส่ชื่อแบรนด์ท้ายประโยค ("— Fantrove" หรือ "| Fantrove")
- แต่ละหน้าต้อง unique ไม่ซ้ำกัน
- ภาษาของ title ต้องตรงกับ `lang` attribute ของหน้า

**ตัวอย่าง:**
- หน้า Home (en): `Emojis, Symbols & Fancy Text — Fantrove`
- หน้า Home (th): `อีโมจิ สัญลักษณ์ ข้อความแฟนซี — Fantrove`
- หน้า Search (en): `Search Emojis & Symbols — Fantrove`
- หน้า Search (th): `ค้นหาอีโมจิและสัญลักษณ์ — Fantrove`

### 3.3 กฎการเขียน description

- ความยาว **150-160 ตัวอักษร** (Google ตัดที่ประมาณ 160)
- อธิบายเนื้อหาหน้านั้นจริง ๆ ไม่ใช่ generic description
- ใส่ keyword หลักและ secondary keywords ตามธรรมชาติ
- กระตุ้นให้คลิก (call-to-action อ่อน ๆ เช่น "Find, copy, and use instantly")
- แต่ละหน้าต้อง unique

### 3.4 Open Graph image

- ขนาด **1200×630  pixels** (Facebook/Twitter standard)
- ไฟล์อยู่ใน `assets/images/OG/`
- แต่ละหน้าควรมี OG image เฉพาะ (ไม่ใช้ default ทุกหน้า)
- รูปต้องดูดีทั้งบน light/dark mode

### 3.5 การจัดการในระบบ

- Build script (`scripts/build.js`) อ่าน `<title>` และ `<meta description>` จาก source HTML แล้วแปล + ใส่ใน built pages
- Translation ของ meta tags อยู่ใน `assets/lang/{en,th}.json` ใต้ keys `meta.{page}.title` และ `meta.{page}.description`
- `html-transformer.js` ใส่ hreflang + canonical อัตโนมัติในทุกหน้า × ทุกภาษา

---

## 4. hreflang & International SEO

Fantrove รองรับหลายภาษา — hreflang เป็นวิธีบอก Google ว่าหน้าไหนเป็นภาษาอะไร และเป็น alternate version ของกันและกัน

### 4.1 hreflang tags ที่ต้องมีในทุกหน้า

```html
<!-- สำหรับหน้า home เป็นตัวอย่าง -->
<link rel="alternate" hreflang="en" href="https://fantrove.pages.dev/en/home/">
<link rel="alternate" hreflang="th" href="https://fantrove.pages.dev/th/home/">
<link rel="alternate" hreflang="x-default" href="https://fantrove.pages.dev/en/home/">
```

### 4.2 กฎ hreflang

- `hreflang="x-default"` บอก Google ว่าให้ใช้หน้านี้เป็น default เมื่อไม่ตรงกับภาษาที่รองรับ — ปัจจุบันชี้ไป `/en/`
- ทุกหน้าต้องมี hreflang tag ครบทุกภาษาที่รองรับ (รวม self-reference)
- hreflang tags ต้องเป็น **bidirectional** — ถ้าหน้า A บอกว่า B เป็น alternate หน้า B ต้องบอกว่า A เป็น alternate ด้วย
- URL ใน hreflang ต้องเป็น **absolute URL** (เริ่มด้วย `https://`)
- hreflang ต้องอยู่ใน `<head>` ของทุกหน้า

### 4.3 URL structure สำหรับแต่ละภาษา

```
https://fantrove.pages.dev/en/home/    ← English home
https://fantrove.pages.dev/th/home/    ← Thai home
https://fantrove.pages.dev/en/search/  ← English search
https://fantrove.pages.dev/th/search/  ← Thai search
```

ใช้รูปแบบ **subdirectory** (`/lang/`) ไม่ใช่ subdomain (`en.fantrove...`) เพราะ:
- รวม link equity ใน domain เดียว
- ง่ายต่อการ manage ใน Cloudflare Pages
- Google เข้าใจดีกว่า

### 4.4 เมื่อเพิ่มภาษาใหม่

1. เพิ่มใน `assets/lang/options/db.json`
2. สร้าง `assets/lang/{lang}.json` (translation)
3. อัปเดต `html-transformer.js` ให้ generate hreflang สำหรับภาษาใหม่
4. อัปเดต `_redirects` และ `_headers` สำหรับ path ใหม่
5. อัปเดต `generate-sitemap.js` ให้รวมภาษาใหม่
6. Build + deploy + ส่ง sitemap ใหม่ให้ Search Console

ดูรายละเอียดใน `04-Internationalization-And-Build.md`

### 4.5 Sitemap entries สำหรับแต่ละภาษา

```xml
<url>
  <loc>https://fantrove.pages.dev/en/home/</loc>
  <xhtml:link rel="alternate" hreflang="en" href="https://fantrove.pages.dev/en/home/"/>
  <xhtml:link rel="alternate" hreflang="th" href="https://fantrove.pages.dev/th/home/"/>
  <xhtml:link rel="alternate" hreflang="x-default" href="https://fantrove.pages.dev/en/home/"/>
</url>
```

---

## 5. Canonical URLs & URL Structure

Canonical URL บอก Google ว่า "นี่คือ URL หลักของหน้านี้" ป้องกันปัญหา duplicate content

### 5.1 กฎ canonical

- ทุกหน้าต้องมี `<link rel="canonical">` ที่ถูกต้อง
- Canonical URL ต้องเป็น **absolute URL** (`https://fantrove.pages.dev/...`)
- Canonical ต้องชี้ไปหน้าที่ index ได้จริง (ไม่ใช่ redirect หรือ 404)
- ถ้ามี query parameters ที่ไม่เปลี่ยนเนื้อหา (เช่น `?utm_source`) ให้ canonical ชี้ไป version ไม่มี query
- ถ้ามีหลายภาษา แต่ละภาษามี canonical ของตัวเอง (ไม่ใช่ canonical ไปภาษาเดียว)

### 5.2 URL structure best practices

✅ **ใช้:**
- `/en/home/` — สั้น สะอาด สื่อความหมาย
- `/en/data/verse/discover/` — hierarchy ชัดเจน
- `/en/search/?q=heart` — query parameter สำหรับ search

❌ **ห้าม:**
- `/en/home/index.html` — ไม่ต้องมี `index.html`
- `/en/home/?ref=navbar` — query ที่ไม่จำเป็น
- `/en/h` — ย่อเกินไป ไม่สื่อความหมาย
- `/en/homepage-english-version/` — ยาวเกินไป มีภาษาใน URL

### 5.3 URL stability

- เมื่อ URL ตั้งแล้ว **ห้ามเปลี่ยน** ถ้าไม่จำเป็นมาก
- ถ้าต้องเปลี่ยน ให้ตั้ง 301 redirect จาก URL เก่า → ใหม่
- อัปเดต sitemap + internal links ทันที
- เก็บ redirect ไว้อย่างน้อย 6 เดือน (Google ใช้เวลา re-index)

---

## 6. Sitemap Strategy

Sitemap.xml บอก search engine ว่ามีหน้าอะไรบ้างที่ควร crawl

### 6.1 โครงสร้าง sitemap.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://fantrove.pages.dev/en/home/</loc>
    <lastmod>2026-06-20</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
    <xhtml:link rel="alternate" hreflang="en" href="https://fantrove.pages.dev/en/home/"/>
    <xhtml:link rel="alternate" hreflang="th" href="https://fantrove.pages.dev/th/home/"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://fantrove.pages.dev/en/home/"/>
  </url>
  <!-- ... ทุกหน้า × ทุกภาษา -->
</urlset>
```

### 6.2 การ generate

- สร้างโดย `scripts/generate-sitemap.js` อัตโนมัติทุกครั้งที่ build
- Output: `sitemap.xml` ที่ root และ `dist/sitemap.xml` หลัง build
- รวมทุกหน้า × ทุกภาษา
- `<lastmod>` อิงจากวันที่ไฟล์เปลี่ยนแปลงล่าสุด

### 6.3 การส่งให้ search engine

- **Google Search Console:** Properties → Sitemaps → submit `sitemap.xml`
- **Bing Webmaster Tools:** Submit sitemap
- `robots.txt` ต้องชี้ไป sitemap: `Sitemap: https://fantrove.pages.dev/sitemap.xml`

### 6.4 เมื่อเพิ่ม/ลบหน้า

- หน้าใหม่: เพิ่มใน `generate-sitemap.js` logic → build → deploy → sitemap update อัตโนมัติ
- หน้าที่ลบ: ลบจาก `generate-sitemap.js` → build → deploy → Google จะ de-index เอง
- ถ้าเปลี่ยน URL: ตั้ง 301 redirect + อัปเดต sitemap + ส่ง sitemap ใหม่ให้ Search Console

---

## 7. robots.txt & Crawl Budget

robots.txt ควบคุมว่า search engine สามารถ crawl อะไรได้บ้าง

### 7.1 robots.txt มาตรฐาน

```
User-agent: *
Allow: /

# ห้าม crawl ส่วนที่ไม่จำเป็น (JS reference, CSS, fonts)
Disallow: /assets/js/ure/ure-examples.js

# Sitemap location
Sitemap: https://fantrove.pages.dev/sitemap.xml
```

### 7.2 กฎการใช้ robots.txt

- **อย่าใช้ robots.txt ป้องกัน indexing** — ใช้ `<meta name="robots" content="noindex">` แทน (robots.txt แค่ควบคุม crawl ไม่ใช่ index)
- **อย่า Disallow หน้าสำคัญ** — ถ้า Disallow แล้ว Google ไม่ crawl ก็ไม่เห็น noindex meta tag และอาจ index อยู่ดี
- **Disallow เฉพาะไฟล์ที่ไม่ใช่หน้าเว็บ** (JS reference, CSS, fonts ที่ไม่จำเป็นต้อง crawl)
- **Sitemap ต้องชี้ใน robots.txt** — Google อาจเจอ sitemap ผ่าน robots.txt ก่อน

### 7.3 Crawl budget

Crawl budget = จำนวนหน้าที่ Google crawl ในระยะเวลาหนึ่ง สำหรับเว็บเล็กไม่มีปัญหา แต่ถ้าใหญ่ขึ้นต้องดูแล:

- ไม่สร้าง URL ที่ไม่จำเป็น (URL parameters ที่ไม่เปลี่ยนเนื้อหา)
- ใช้ `rel="canonical"` กับหน้าที่มี query string
- ลบ redirect chains (A → B → C ให้เปลี่ยนเป็น A → C)
- ตรวจสอบ Crawl Stats ใน Search Console ประจำ

---

## 8. Structured Data (JSON-LD Schema.org)

Structured data บอก Google ว่าเนื้อหาหน้านี้คืออะไร (เช่น WebSite, SearchAction, BreadcrumbList) ทำให้ได้ rich results ใน search

### 8.1 JSON-LD มาตรฐานสำหรับทุกหน้า

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "Fantrove",
  "alternateName": "Fantrove Verse",
  "url": "https://fantrove.pages.dev/",
  "potentialAction": {
    "@type": "SearchAction",
    "target": {
      "@type": "EntryPoint",
      "urlTemplate": "https://fantrove.pages.dev/en/search/?q={search_term_string}"
    },
    "query-input": "required name=search_term_string"
  }
}
</script>
```

### 8.2 BreadcrumbList สำหรับหน้าที่มี hierarchy

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "name": "Home",
      "item": "https://fantrove.pages.dev/en/home/"
    },
    {
      "@type": "ListItem",
      "position": 2,
      "name": "Discover",
      "item": "https://fantrove.pages.dev/en/data/verse/discover/"
    }
  ]
}
</script>
```

### 8.3 Organization (ในหน้า About)

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Fantrove",
  "url": "https://fantrove.pages.dev/",
  "logo": "https://fantrove.pages.dev/assets/images/fantrove-logo-1280.png",
  "sameAs": [
    "https://discord.gg/MMxQSZB3y3",
    "https://www.patreon.com/rowingsco"
  ]
}
</script>
```

### 8.4 กฎ structured data

- ใช้ **JSON-LD** เท่านั้น (ไม่ใช่ Microdata หรือ RDFa)
- ใส่ใน `<script type="application/ld+json">` ใน `<head>` หรือ `<body>`
- ทดสอบด้วย [Rich Results Test](https://search.google.com/test/rich-results) ก่อน deploy
- อย่าใส่ structured data ที่ไม่ตรงกับเนื้อหาหน้า (เช่น อย่าใส่ `Recipe` ในหน้าที่ไม่ใช่สูตรอาหาร)
- อัปเดตเมื่อเนื้อหาเปลี่ยน (เช่น เพิ่มภาษาใหม่ → อัปเดต `potentialAction.target`)

### 8.5 Schema types ที่ Fantrove ใช้

| Schema type | ใช้ที่ไหน | วัตถุประสงค์ |
|---|---|---|
| `WebSite` + `SearchAction` | ทุกหน้า (sitelinks search box) | ทำให้มี search box ใน search results |
| `BreadcrumbList` | หน้าที่มี hierarchy (Discover, About) | แสดง breadcrumb ใน search results |
| `Organization` | หน้า About | ข้อมูล organization สำหรับ knowledge panel |
| `WebPage` | ทุกหน้า (optional) | ข้อมูลพื้นฐานของหน้า |

---

## 9. Core Web Vitals

Core Web Vitals คือ metrics ที่ Google ใช้วัด user experience ของหน้าเว็บ ส่งผลต่อ ranking โดยตรง

### 9.1 Metrics หลัก 3 ตัว

| Metric | ความหมาย | Good | Needs Improvement | Poor |
|---|---|---|---|---|
| **LCP** (Largest Contentful Paint) | เวลาที่ element ใหญ่สุดแสดง | ≤ 2.5s | 2.5s - 4.0s | > 4.0s |
| **INP** (Interaction to Next Paint) | เวลาตอบสนองเมื่อผู้ใช้โต้ตอบ | ≤ 200ms | 200ms - 500ms | > 500ms |
| **CLS** (Cumulative Layout Shift) | การเลื่อนของ layout ระหว่างโหลด | ≤ 0.1 | 0.1 - 0.25 | > 0.25 |

### 9.2 วิธีวัด

- **Lighthouse** ใน Chrome DevTools (lab data)
- **PageSpeed Insights** — https://pagespeed.web.dev/ (field data จาก CrUX)
- **Chrome User Experience Report (CrUX)** — field data จริงจากผู้ใช้ Chrome
- **Google Search Console** → Core Web Vitals report

### 9.3 กลยุทธ์ทำให้ผ่าน thresholds

#### LCP ≤ 2.5s
- Static HTML pre-built (ไม่ต้องรอ JS render)
- Preload critical resources (CSS, hero image)
- ใช้ CDN (Cloudflare Pages) ทุกหน้า
- บีบอัดรูป (WebP, AVIF ถ้าได้)
- Lazy load รูปที่ไม่ใช่ hero

#### INP ≤ 200ms
- URE virtual scroll ทำให้ DOM เล็ก (ไม่่่ต้อง render หมื่นรายการ)
- Web Worker สำหรับงานหนัก (filter, sort, translate)
- หลีกเลี่ยง long task บน main thread (> 50ms)
- ใช้ `requestIdleCallback` สำหรับงาน non-critical
- ดู `08-Performance-Architecture.md` สำหรับเทคนิคเต็ม

#### CLS ≤ 0.1
- กำหนด `width` และ `height` attribute ใน `<img>` (หรือ `aspect-ratio` ใน CSS)
- หลีกเลี่ยงการแทรก element เหนือเนื้อหาที่โหลดแล้ว
- URE ใช้ height cache + spacer ป้องกัน layout shift ตอน scroll
- FVL (loading overlay) ป้องกัน layout shift ตอนเปลี่ยนเนื้อหา

### 9.4 การตรวจสอบก่อน deploy

- รัน Lighthouse บนหน้าสำคัญ (home, search, discover) — ทุกภาษา
- คะแนน Performance ≥ 90, SEO = 100, Accessibility ≥ 90
- ถ้าคะแนนตก ห้าม deploy จนกว่าจะแก้ไข้

---

## 10. Mobile-First Indexing

Google ใช้ mobile version ของหน้าเว็บเป็น primary version สำหรับ indexing และ ranking ตั้งแต่ปี 2019

### 10.1 สิ่งที่ต้องทำ

- **Responsive design** — ทุกหน้าใช้ CSS ที่ responsive (`@media`, `clamp()`, `grid`)
- **Mobile viewport** — ต้องมี `<meta name="viewport" content="width=device-width, initial-scale=1">`
- **Touch-friendly** — ปุ่มขนาดอย่างน้อย 44×44px (Apple HIG) หรือ 48×48dp (Material)
- **No intrusive interstitials** — ห้าม popup เต็มจอที่บังเนื้อหา (Google ลด ranking)
- **Font size ≥ 16px** สำหรับ body text (เล็กกว่านี้ iOS auto-zoom)
- **Mobile speed** — ต้องผ่าน Core Web Vitals บนมือถือด้วย (ไม่ใช่แค่ desktop)

### 10.2 สิ่งที่ต้องตรวจสอบ

- ทดสอบบนอุปกรณ์จริง (iOS Safari, Android Chrome) ไม่ใช่แค่ DevTools
- ทดสอบบนเครือข่าย 4G/3G (Network throttling ใน DevTools)
- ตรวจสอบว่าไม่มี horizontal scroll บนมือถือ
- ปุ่ม/ลิงก์ต้องกดได้ง่ายด้วยนิ้วโป้ง

### 10.3 Mobile-specific considerations ของ Fantrove

- URE ปรับ buffer size ตาม device tier (ดู `08-Performance-Architecture.md` ส่วน device tier)
- Search มีระบบ keyboard handling สำหรับมือถี่ (ดู `02-Search-System.md` ส่วน keyboard)
- Popup ปรับขนาดตาม viewport (ดู `06-Popup-System.md`)
- FVL ปรับ mode ตาม context (fullscreen / scoped / inline / topbar)

---

## 11. Content SEO

Content SEO คือการทำให้เนื้อหาเข้าใจง่าย ทั้งสำหรับผู้ใช้และ search engine

### 11.1 Heading hierarchy

```html
<h1>หัวข้อหลักของหน้า (1 อันต่อหน้า)</h1>
  <h2>หัวข้อย่อยหลัก</h2>
    <h3>หัวข้อย่อยของย่อย</h3>
  <h2>หัวข้อย่อยหลักอีกอัน</h2>
```

กฎ:
- **1 `<h1>` ต่อหน้า** — หัวข้อหลักของหน้า
- **`<h2>` สำหรับ section หลัก** — ไม่ skip level (ห้าม jump จาก h1 ไป h3)
- **ใช้ heading ตาม semantic ไม่ใช่ style** — ถ้าต้องการตัวใหญ่ ใช้ CSS ไม่ใช่เปลี่ยน h2 → h1
- **ใส่ keyword ใน heading ตามธรรมชาติ** — ไม่ใช่ keyword stuffing

### 11.2 Semantic HTML

```html
<!-- ✅ ดี -->
<header>, <nav>, <main>, <article>, <section>, <aside>, <footer>

<!-- ❌ ห้าม -->
<div class="header">, <div class="nav">, <div class="main">
```

Semantic HTML ช่วย search engine เข้าใจโครงสร้างหน้า

### 11.3 Content depth

- แต่ละหน้าควรมีเนื้อหาเพียงพอที่จะตอบคำถามผู้ใช้ (ไม่ใช่แค่ลิงก์)
- หน้าหลัก (home, search, discover) ควรมีข้อความอธิบายสั้น ๆ อย่างน้อย 200-300 คำ
- ใช้คำที่ผู้ใช้ค้นหาจริง (เช่น "emoji" "symbol" "fancy text" "copy" "paste")
- หลีกเลี่ยง duplicate content ข้ามหน้า — แต่ละหน้าต้องมี value เฉพาะ

### 11.4 Content freshness

- อัปเดต content บ่อย (เพิ่ม emoji ใหม่ ๆ ตาม Unicode version ใหม่)
- อัปเดต `<lastmod>` ใน sitemap เมื่อเนื้อหาเปลี่ยน
- ทดสอบอัปเดตที่สำคัญใน Search Console → URL Inspection → "Request indexing"

---

## 12. Image SEO

รูปภาพสามารถทำให้ได้ traffic จาก Google Images และช่วยให้หน้าเข้าใจง่ายขึ้น

### 12.1 กฎรูปภาพ

- **`alt` text** ทุกรูป — อธิบายรูปเป็นภาษาที่เข้าใจได้ (สำหรับ screen reader + SEO)
- **`loading="lazy"`** รูปที่ไม่ใช่ hero (URE lazy-assets.js ทำให้อัตโนมัติ)
- **`width` + `height`** attribute ทุกรูป — ป้องกัน CLS
- **Format modern** — WebP, AVIF (รองรับ browser ใหม่), fallback PNG/JPG
- **File size ≤ 200KB** สำหรับรูป content (ใช้ TinyPNG, Squoosh)

### 12.2 OG image (สำหรับ social sharing)

- ขนาด 1200×630 pixels
- ไฟล์อยู่ใน `assets/images/OG/`
- ทุกหน้าควรมี OG image เฉพาะ
- ทดสอบด้วย [Facebook Debugger](https://developers.facebook.com/tools/debug/) และ [Twitter Card Validator](https://cards-dev.twitter.com/validator)

### 12.3 Image sitemap (optional)

```xml
<url>
  <loc>https://fantrove.pages.dev/en/home/</loc>
  <image:image>
    <image:loc>https://fantrove.pages.dev/assets/images/banner-fantrove-hub.jpg</image:loc>
    <image:caption>Fantrove home banner</image:caption>
  </image:image>
</url>
```

---

## 13. Internal Linking Strategy

Internal links ช่วย Google เข้าใจโครงสร้างเว็บและ distribute link equity

### 13.1 กฎ internal links

- ใช้ **descriptive anchor text** — ไม่ใช่ "click here" หรือ "อ่านต่อ"
- ลิงก์ไปหน้าสำคัญจากหลาย ๆ หน้า (home, nav, footer)
- หลีกเลี่ยงลิงก์ที่ต้องใช้ JavaScript ถึงจะทำงาน (ใช้ `<a href>` ปกติ)
- ลิงก์ใช้ `rel="nofollow"` เฉพาะลิงก์ที่ไม่อยาก endorse (เช่น sponsored)

### 13.2 Anchor text ที่ดี

```html
<!-- ✅ ดี -->
<a href="/en/search/">Search emojis and symbols</a>

<!-- ❌ ไม่ดี -->
<a href="/en/search/">Click here</a>
<a href="/en/search/">Read more</a>
```

### 13.3 Navigation structure

- **Top nav / bottom nav** — link ไปหน้าหลักทุกหน้า
- **Breadcrumb** — แสดง hierarchy ของหน้าปัจจุบัน
- **Footer** — link ไปหน้าสำคัญ + legal pages
- **In-content links** — ลิงก์ที่เกี่ยวข้องในเนื้อหา (เช่น หน้า emoji ลิงก์ไปหน้า search ที่ค้นหา emoji นั้น)

### 13.4 Orphan pages

- ทุกหน้าต้องมี link ชี้เข้าจากหน้าอื่นอย่างน้อย 1 ลิงก์
- ใช้ Screaming Frog หรือ Sitebulb crawl หา orphan pages
- ถ้าพบ orphan page ให้เพิ่ม link จากหน้าที่เกี่ยวข้อง

---

## 14. E-E-A-T

E-E-A-T = Experience, Expertise, Authoritativeness, Trustworthiness — หลักการที่ Google ใช้ประเมินคุณภาพเว็บ

### 14.1 Experience

- แสดงว่าเรา "ใช้งานจริง" — เช่น แสดง version ปัจจุบัน, จำนวน content, last updated
- Release notes แสดงการพัฒนาต่อเนื่อง

### 14.2 Expertise

- เนื้อหาต้องถูกต้อง — emoji names ต้องตรงตาม Unicode standard
- ใช้ terminology ที่ถูกต้อง (เช่น "Unicode code point" ไม่ใช่ "letter number")
- เอกสาร technical (`fantrove-docs/`) แสดงความเชี่ยวชาญของทีม

### 14.3 Authoritativeness

- ลิงก์เข้าจากเว็บที่น่าเชื่อถือ (backlinks — สร้างผ่าน content quality ไม่ใช่ spam)
- ปรากฏใน community ที่เกี่ยวข้อง (Discord, Reddit)
- Social media presence (Patreon, Discord)

### 14.4 Trustworthiness

- **HTTPS** ทุกหน้า
- **Privacy policy** (ถ้ามี)
- **Contact information** ชัดเจน (`/community/contact/`)
- **License** ชัดเจน (Apache 2.0 + CC0 สำหรับ content)
- ไม่มี ads ที่ทำให้เสียประสบการณ์ (AdSense แต่ต้องไม่ intrusive)
- แสดงวันที่อัปเดตล่าสุดของ content สำคัญ

### 14.5 YMYL (Your Money Your Life)

Fantrove ไม่ใช่ YMYL site (ไม่เกี่ยวกับสุขภาพ, การเงิน, ความปลอดภัย) แต่ก็ต้องรักษา E-E-A-T ระดับหนึ่ง

---

## 15. 404 & Redirect Strategy

### 15.1 404 page

- ต้องมี 404 page ที่เป็นมิตร (ไม่ใช่ default browser 404)
- มี link กลับไปหน้าหลัก (home, search)
- มี search box ให้ค้นหา
- ส่ง HTTP status 404 (ไม่ใช่ 200) เพื่อให้ Google เข้าใจว่าหน้านี้ไม่มีจริง
- ใช้ `noindex` บน 404 page

### 15.2 Redirect strategy

| Type | ใช้เมื่อ | ผลกระทบ SEO |
|---|---|---|
| **301** (Permanent) | URL เปลี่ยนถาวร | ส่ง link equity ไป URL ใหม่ |
| **302** (Temporary) | URL เปลี่ยนชั่วคราว | ไม่ส่ง link equity |
| **307** | HTTP method ต้องไม่เปลี่ยน | เหมือน 302 แต่รักษา method |
| **308** | Permanent, รักษา method | เหมือน 301 แต่รักษา method |

กฎ:
- ใช้ **301** เกือบทุกกรณีที่ URL เปลี่ยนถาวร
- หลีกเลี่ยง redirect chains (A → B → C) — เปลี่ยนเป็น A → C
- ตรวจสอบ redirect ใน Search Console → "Coverage" → "Excluded" → "Redirect error"
- เก็บ redirect อย่างน้อย 6 เดือน

### 15.3 Cloudflare `_redirects`

ดู `09-Deployment-Guide.md` ส่วน URL Routing & Redirects สำหรับรายละเอียด production redirect rules

---

## 16. Analytics & Search Console

### 16.1 Google Search Console

- **Property type:** URL prefix (`https://fantrove.pages.dev`)
- **Verify:** ผ่าน HTML file (`google6b646fa60e0f9f2f.html`) ที่ root
- **Sitemap:** ส่ง `sitemap.xml`
- **Performance:** ดู queries, pages, countries, devices
- **Coverage:** ดูหน้าที่ indexed / errors
- **Core Web Vitals:** ดู field data จากผู้ใช้จริง
- **Enhancements:** ดู structured data errors

### 16.2 Google Analytics 4

- **Property:** G-R4DGR81NZ6
- **ผ่าน GTM:** GTM-PJ397CLS (load ทุกหน้า)
- **Events ที่ต้อง track:**
  - `page_view` — ทุกหน้า (automatic)
  - `search` — เมื่อผู้ใช้ค้นหา
  - `copy` — เมื่อผู้ใช้ copy content
  - `language_change` — เมื่อผู้ใช้เปลี่ยนภาษา
  - `share` — เมื่อผู้ใช้แชร์

### 16.3 Bing Webmaster Tools

- ส่ง sitemap
- ดู performance (Bing มีส่วนแบ่งตลาดเล็ก แต่ก็สำคัญ)

### 16.4 การตรวจสอบประจำ

**รายสัปดาห์:**
- Search Console → Performance → ดู queries ใหม่, CTR ตก, position ตก
- Search Console → Coverage → ดู errors ใหม่
- PageSpeed Insights → ทดสอบหน้าสำคัญ

**รายเดือน:**
- Search Console → Core Web Vitals → ดู trend
- Lighthouse audit ทุกหน้าหลัก
- ตรวจสอบ backlinks (Ahrefs, SEMrush ถ้ามี)

**รายไตรมาส:**
- Content gap analysis เทียบกับคู่แข่ง
- อัปเดต structured data ตาม schema.org version ใหม่
- Review ทั้งหมดในทีม

---

## 17. SEO Checklist สำหรับ AI/นักพัฒนา

รันผ่าน checklist นี้ทุกครั้งที่เพิ่ม/แก้หน้าเว็บ หรือทำการเปลี่ยนแปลงที่กระทบ SEO

### 17.1 เมื่อเพิ่มหน้าใหม่

- [ ] มี `<title>` unique, 50-60 ตัวอักษร, ภาษาของหน้า
- [ ] มี `<meta name="description">` unique, 150-160 ตัวอักษร
- [ ] มี `<link rel="canonical">` ที่ถูกต้อง
- [ ] มี hreflang tags ครบทุกภาษา
- [ ] มี Open Graph tags (og:title, og:description, og:image, og:url)
- [ ] มี Twitter Card tags
- [ ] มี `<html lang="...">` ที่ถูกต้อง
- [ ] มี `<meta name="viewport">`
- [ ] มี `<h1>` อันเดียวที่อธิบายหน้า
- [ ] มี semantic HTML (`<header>`, `<main>`, `<nav>`, `<footer>`)
- [ ] ทุกรูปมี `alt` text
- [ ] ทุกรูปมี `width` + `height` หรือ `aspect-ratio`
- [ ] รูป hero ไม่ใช้ `loading="lazy"` (รูปอื่นใช้ lazy)
- [ ] มี JSON-LD structured data (ถ้าเกี่ยวข้อง)
- [ ] เพิ่มใน `generate-sitemap.js`
- [ ] ทดสอบ Lighthouse — Performance ≥ 90, SEO = 100, Accessibility ≥ 90
- [ ] ทดสอบ Rich Results Test (ถ้ามี structured data)

### 17.2 เมื่อแก้ไขหน้าเดิม

- [ ] ไม่เปลี่ยน URL (ถ้าเปลี่ยน ตั้ง 301 redirect)
- [ ] ไม่ลบ meta tags ที่มีอยู่
- [ ] ไม่ลบ hreflang tags
- [ ] ไม่ลบ canonical
- [ ] ถ้าเปลี่ยนเนื้อหาสำคัญ → อัปเดต `<lastmod>` ใน sitemap
- [ ] ทดสอบ Lighthouse หลังแก้

### 17.3 เมื่อ deploy

- [ ] Build ผ่าน (`npm run build`)
- [ ] ตรวจสอบ `dist/` มีทุกหน้า × ทุกภาษา
- [ ] ตรวจสอบ `dist/sitemap.xml` ครบ
- [ ] ตรวจสอบ `dist/robots.txt`
- [ ] ตรวจสอบ `dist/_headers` และ `dist/_redirects`
- [ ] หลัง deploy: ทดสอบ fetch ด้วย `curl` ว่า meta tags ครบ
- [ ] หลัง deploy: Search Console → URL Inspection → "Request indexing" สำหรับหน้าสำคัญ

### 17.4 เมื่อเพิ่มภาษาใหม่

- [ ] เพิ่มใน `assets/lang/options/db.json`
- [ ] สร้าง `assets/lang/{lang}.json` ครบทุก key
- [ ] อัปเดต `html-transformer.js` ให้ generate hreflang สำหรับภาษาใหม่
- [ ] อัปเดต `_redirects` และ `_headers`
- [ ] อัปเดต `generate-sitemap.js`
- [ ] แปล meta tags และ OG tags
- [ ] ทดสอบหน้าภาษาใหม่ด้วย Lighthouse + Rich Results Test
- [ ] Search Console → Settings → Languages → เพิ่มภาษาใหม่
- [ ] ส่ง sitemap ใหม่ให้ Search Console

---

## 18. สิ่งที่ห้ามทำ (SEO Forbidden)

> ⚠️ ห้ามทำสิ่งต่อไปนี้โดยเด็ดขาด — ทำให้ ranking ตกหรือถูก penalize

### 18.1 ห้ามลบ/ทำลาย

- ❌ ห้ามลบ `<title>` หรือ `<meta name="description">`
- ❌ ห้ามลบ `<link rel="canonical">`
- ❌ ห้ามลบ hreflang tags
- ❌ ห้ามลบ Open Graph หรือ Twitter Card tags
- ❌ ห้ามลบ `<html lang>` attribute
- ❌ ห้ามลบ `<meta name="viewport">`
- ❌ ห้ามลบ JSON-LD structured data
- ❌ ห้ามเปลี่ยน URL โดยไม่ตั้ง 301 redirect
- ❌ ห้ามลบหน้าจาก sitemap โดยไม่ตั้ง redirect หรือ 410

### 18.2 ห้ามทำ

- ❌ ห้ามใช้ `noindex` บนหน้าที่ต้องการให้ index
- ❌ ห้าม render เนื้อหาสำคัญด้วย JavaScript อย่างเดียว (ต้องอยู่ใน static HTML)
- ❌ ห้ามใช้ `<div>` แทน semantic HTML (`<header>`, `<main>`, `<nav>`)
- ❌ ห้ามใช้ `<h1>` มากกว่า 1 อันต่อหน้า
- ❌ ห้าม skip heading level (เช่น `<h1>` แล้ว `<h3>` ไม่มี `<h2>`)
- ❌ ห้ามใช้ `loading="lazy"` บน hero image
- ❌ ห้ามใช้รูปขนาด > 500KB โดยไม่บีบอัด
- ❌ ห้ามใช้ query parameters ที่ไม่จำเป็นใน URL ที่ index
- ❌ ห้ามใช้ redirect chains (A → B → C)
- ❌ ห้ามใช้ 302 สำหรับ redirect ถาวร (ใช้ 301)

### 18.3 ห้าม spam

- ❌ ห้าม keyword stuffing (ใส่ keyword ซ้ำ ๆ ไม่เป็นธรรมชาติ)
- ❌ ห้าม hidden text (สีตัวอักษรเหมือนสีพื้นหลัง)
- ❌ ห้าม cloaking (แสดงเนื้อหาคนละแบบให้ Googlebot กับผู้ใช้)
- ❌ ห้าม duplicate content ข้ามหน้า (แต่ละหน้าต้องมี value เฉพาะ)
- ❌ ห้ามเขียน structured data ที่ไม่ตรงกับเนื้อหาจริง
- ❌ ห้าม buy backlinks หรือ link spam

### 18.4 ห้าม ignore performance

- ❌ ห้าม deploy ถ้า Lighthouse Performance < 80
- ❌ ห้าม deploy ถ้า LCP > 4s
- ❌ ห้าม deploy ถ้า CLS > 0.25
- ❌ ห้าม deploy ถ้า INP > 500ms

---

## 19. อ้างอิงข้ามเอกสาร

- [`00-System-Architecture.md`](./00-System-Architecture.md) — ภาพรวมสถาปัตยกรรมทั้งโปรเจกต์ (รวม SEO layers)
- [`04-Internationalization-And-Build.md`](./04-Internationalization-And-Build.md) — hreflang, multi-language, translation system
- [`08-Performance-Architecture.md`](./08-Performance-Architecture.md) — Core Web Vitals, performance techniques
- [`09-Deployment-Guide.md`](./09-Deployment-Guide.md) — Build system, _redirects, _headers, sitemap
- [`10-Content-Guide.md`](./10-Content-Guide.md) — Content structure (affects content SEO)
- [`AI_CODING_GUIDE.md`](./AI_CODING_GUIDE.md) — มาตรฐานโค้ด (รวม SEO-friendly patterns)
- [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) — กฎเหล็ก (รวม SEO violations)
- [`AI_REVIEW_CHECKLIST.md`](./AI_REVIEW_CHECKLIST.md) — Checklist ก่อนส่งมอบ (รวม SEO checks)

### External resources

- [Google Search Central](https://developers.google.com/search/docs) — Official SEO docs
- [Schema.org](https://schema.org/) — Structured data reference
- [Rich Results Test](https://search.google.com/test/rich-results) — ทดสอบ structured data
- [PageSpeed Insights](https://pagespeed.web.dev/) — ทดสอบ Core Web Vitals
- [Mobile-Friendly Test](https://search.google.com/test/mobile-friendly) — ทดสอบ mobile UX
- [Web.dev/measure](https://web.dev/measure/) — Lighthouse audit
