# 00 — ภาพรวมสถาปัตยกรรมระบบ (System Architecture)

> เอกสารนี้อธิบายภาพรวมสถาปัตยกรรมของโปรเจกต์ **Fantrove** (หรือชื่อเต็ม **Fantrove Verse`) — แพลตฟอร์มคลังอีโมจิ สัญลักษณ์ ข้อความแฟนซี และคอลเลกชันอื่น ๆ ที่ทำงานเป็น static website บน Cloudflare Pages
>
> **สำหรับ:** AI และนักพัฒนาที่ต้องการเข้าใจภาพรวมก่อนเข้าระบบใดระบบหนึ่งเป็นพิเศษ
>
> **เวอร์ชันอ้างอิง:** ดูจากเอกสารประกอบของแต่ละระบบ — เอกสารนี้ไม่อ้างอิงเวอร์ชันเฉพาะเพื่อหลีกเลี่ยงความไม่ตรงเมื่อระบบอัปเดต

---

## สารบัญ

1. [โปรเจกต์คืออะไร](#1-โปรเจกต์คืออะไร)
2. [ระบบหลัก 7 ระบบ](#2-ระบบหลัก-7-ระบบ)
3. [Module Pattern ทั้งระบบ](#3-module-pattern-ทั้งระบบ)
4. [โครงสร้างไฟล์โปรเจกต์](#4-โครงสร้างไฟล์โปรเจกต์)
5. [URL Structure และ Routing](#5-url-structure-และ-routing)
6. [Data Architecture](#6-data-architecture)
7. [การสื่อสารระหว่างระบบ](#7-การสื่อสารระหว่างระบบ)
8. [Performance Architecture](#8-performance-architecture)
9. [Third-Party Integrations](#9-third-party-integrations)
10. [อ้างอิงข้ามเอกสาร](#10-อ้างอิงข้ามเอกสาร)

---

## 1. โปรเจกต์คืออะไร

**Fantrove** (หรือชื่อเต็ม **Fantrove Verse`) เป็นแพลตฟอร์มคลังอีโมจิ สัญลักษณ์ (symbol) ข้อความแฟนซี (fancy text) และคอลเลกชันอื่น ๆ (เช่น AI tool cards) ที่ทำงานเป็น static website บน **Cloudflare Pages** ที่ URL `fantrove.pages.dev`

### 1.1 คุณสมบัติหลัก

- แสดง content ที่ copy ได้ (อีโมจิ, สัญลักษณ์, ข้อความแฟนซี) และ collection (cards) จากคลังข้อมูลที่เพิ่ม/ลดได้ตลอด — ดู [`10-Content-Guide.md`](./10-Content-Guide.md) สำหรับรายละเอียด
- ระบบค้นหา client-side แบบ two-tier (substring + Fuse.js fuzzy)
- Virtual scrolling สำหรับแสดงข้อมูลจำนวนมหาศาลโดยไม่ทำให้หน้าเว็บช้า
- SPA-style navigation บนหน้า Discover และ Search
- i18n รองรับ 2 โหมด: runtime translation (dev) และ pre-built static pages (production)
- Deploy บน Cloudflare Pages ด้วย build script ที่สร้าง HTML แยกตามภาษา

### 1.2 ภาษาที่รองรับ

ปัจจุบันรองรับ 2 ภาษา: `en` (English) และ `th` (Thai) — ภาษาเพิ่มเติมสามารถเพิ่มได้ตามกระบวนการใน [`04-Language-i18n-System.md`](./04-Language-i18n-System.md)

> ⚠️ ตัวเลขจำนวน content (อีโมจิกี่ตัว, สัญลักษณ์กี่หมวด) เป็นข้อมูลที่เปลี่ยนได้ตลอดเวลา — ดูได้จาก `assets/db/con-data/index.json` หรือเอกสาร [`05-ConData-Service.md`](./05-ConData-Service.md) และ [`10-Content-Guide.md`](./10-Content-Guide.md)

---

## 2. ระบบหลัก 7 ระบบ

| # | ระบบ | บทบาท | ไฟล์หลัก | เอกสาร |
|---|------|-------|-----------|---------|
| 1 | **URE (Universal Render Engine)** | Virtual scroll rendering engine สำหรับแสดงข้อมูลจำนวนมาก | `assets/js/ure/ure.js` + 12 modules | [`01-URE`](./01-URE-Universal-Render-Engine.md) |
| 2 | **Search System** | ระบบค้นหา client-side แบบ two-tier (substring + Fuse.js fuzzy) | `assets/js/search-engine.js` + `search-ui.js` + 12 modules | [`02-Search`](./02-Search-System.md) |
| 3 | **Nav-Core** | Navigation & Content Management สำหรับหน้า Discover (SPA) | `assets/js/nav-core.js` + `nav-core-early.js` + 14 modules | [`03-Nav-Core`](./03-Nav-Core-System.md) |
| 4 | **Language/i18n System** | ระบบแปลภาษา client-side พร้อม build-time static generation | `assets/js/lang-core.js` + `language.js` + 14 modules (static mode: 6) | [`04-Language`](./04-Language-i18n-System.md) |
| 5 | **ConData Service** | Data access layer สำหรับ content (emoji, symbol, fancy, cards) | `assets/js/con-data-service/con-data-service.js` + `con-data-registry.js` | [`05-ConData`](./05-ConData-Service.md) |
| 6 | **Popup System** | ระบบ popup ส่วนกลาง — 9 presets, fullscreen, zero coupling | `assets/js/popup.js` + 12 popup-modules | [`06-Popup`](./06-Popup-System.md) |
| 7 | **Loading System (FVL)** | Fullscreen Visual Loader — หน้าจอโหลดที่ครอบการเปลี่ยนเนื้อหา | `assets/js/loading-system/fvl.js` (single file, 9 inline sections) | [`07-Loading`](./07-Loading-System-FVL.md) |

> เอกสารเพิ่มเติมที่ครอบคลุม cross-cutting concerns: [`08-Performance`](./08-Performance-Architecture.md), [`09-Deployment`](./09-Deployment-Guide.md), [`10-Content`](./10-Content-Guide.md), [`11-Whats-New`](./11-Whats-New-System.md)

### 2.1 แผนภาพการเชื่อมต่อระบบ

```
┌─────────────────────────────────────────────────────────┐
│                    HTML Pages (16 หน้า)                   │
│  home / search / discover / setting / about / ...        │
└──────┬──────────┬──────────────┬────────────┬────────────┘
       │          │              │            │
       ▼          ▼              ▼            ▼
  ┌─────────┐ ┌────────┐  ┌──────────┐ ┌──────────┐
  │ home.js │ │Search  │  │ Nav-Core │ │ Language │
  │         │ │System  │  │  System  │ │  System  │
  └────┬────┘ └───┬────┘  └────┬─────┘ └────┬─────┘
       │          │             │             │
       ▼          ▼             ▼             │
  ┌─────────────────────────────────────┐     │
  │       ConData Service (frozen)      │     │
  │  (emoji, symbol, fancy, cards DB)   │     │
  └──────────────┬──────────────────────┘     │
                 │                            │
       ┌─────────┴──────────┐                │
       ▼                    ▼                ▼
  ┌──────────┐        ┌──────────┐   ┌─────────────┐
  │   URE    │        │   URE    │   │  Build      │
  │(render   │        │(render   │   │  System     │
  │ home)    │        │ search + │   │ (pre-build  │
  │          │        │ discover)│   │  static HTML)│
  └──────────┘        └──────────┘   └─────────────┘

  Cross-system Communication:
  ─ Custom Events: fv:langchange (new), languageChange (legacy),
                   routeChanged, urlChanged, ure:ready, fp:*, fvl:*
  ─ Global Variables: window.URE, window.PopupSystem, window.FVL,
                       window.FvLang, window.ConDataService, window.__searchUI
  ─ BroadcastChannel('fv-lang-v3'): ซิงค์ภาษาระหว่าง tabs
```

### 2.2 การพึ่งพาระหว่างระบบ

- **URE** ← ถูกเรียกใช้โดย Search (`search-modules/rendering.js`) และ Nav-Core (`nav-core-modules/content.js`)
- **ConData Service** ← เป็น data provider หลักให้ Search, Nav-Core และ Home
- **Language System** ← ทุกระบบฟัง `fv:langchange` หรือ `languageChange` event เพื่ออัปเดต UI
- **Build System** ← อ่าน HTML + translation ทุกหน้า → สร้าง static pages สำหรับแต่ละภาษา
- **Popup System** ← ใช้โดย `version-core.js`, `lang-modules/ui.js`, `nav-core-modules/utils.js`
- **Loading System (FVL)** ← ใช้โดย Nav-Core (`nav-core-modules/loading.js` เป็น thin proxy ไปยัง FVL)

---

## 3. Module Pattern ทั้งระบบ

ทุกระบบหลัก (URE, Search, Nav-Core, Language, Popup) ใช้ **IIFE pattern** เดียวกัน — ไม่มี ES modules หรือ framework ใด ๆ

### 3.1 รูปแบบมาตรฐาน

```javascript
(function(M) {
  'use strict';
  // ... module code ...
  M.ModuleName = ModuleName; // export
})(window.SomeNamespace = window.SomeNamespace || {});
```

### 3.2 Namespace ของแต่ละระบบ

| ระบบ | Internal namespace | Public API |
|---|---|---|
| URE | `window.UREModules` | `window.URE` (frozen) |
| Search | `window.SearchModules` | `window.SearchEngine` + `window.__searchUI` |
| Nav-Core | `window.NavCoreModules` | `window._navCore` (boot marker) |
| Language | `window.LangModules` | `window.FvLang` + `window.languageManager` |
| ConData | (ไม่มี modules) | `window.ConDataService` + `window.ConDataRegistry` |
| Popup | `window.PopupModules` | `window.PopupSystem` (frozen) |
| FVL | `window.FVLModules` (inline) | `window.FVL` (frozen) |

### 3.3 ลักษณะสำคัญที่ต้องรู้

- ไม่มี ES modules หรือ `import`/`export` (ยกเว้น `con-data-service.js` ที่เป็นได้ทั้ง ES module และ global)
- ไม่มี reactive system — state เป็น shared mutable object
- การสื่อสารระหว่าง module ในระบบเดียวกัน: direct method calls
- การสื่อสารระหว่างระบบ: Custom Events + global variables
- ทุก module มี `destroy()` function สำหรับ cleanup
- Loading strategies:
  - **Sequential**: URE (12 modules), Popup (12 modules) — ต้องโหลดตามลำดับ dependency
  - **Parallel-within-phase**: Search (5 phases), Nav-Core (5 phases), Language (3 phases) — โหลดกลุ่ม module พร้อมกัน
  - **Inline single-file**: FVL (9 sections ในไฟล์เดียว, 1 HTTP request)

> ดูมาตรฐานการเขียนโค้ดทั้งหมดใน [`AI_CODING_GUIDE.md`](./AI_CODING_GUIDE.md)

---

## 4. โครงสร้างไฟล์โปรเจกต์

```
fantrove-page/
├── index.html                          # 404 fallback / root redirect target
├── home/index.html                     # Landing page
├── search/index.html                   # Search page
├── data/verse/discover/index.html      # Discover/browse page (SPA)
├── data/verse/scope/index.html         # Scope page
├── setting/index.html                  # Settings page
├── platform/about/index.html           # About page
├── platform/roadmap/index.html         # Roadmap page
├── platform/whats_new/index.html       # What's New page
├── community/index.html                # Community hub
├── community/contact/index.html        # Contact form
├── community/report/index.html         # Report form
├── google6b646fa60e0f9f2f.html         # Google verification
│
├── assets/
│   ├── js/
│   │   ├── ure/                        # ★ URE Engine
│   │   │   ├── ure.js                  # Entry point
│   │   │   ├── ure.css                 # Auto-injected styles
│   │   │   ├── ure-examples.js         # Reference only — not loaded in prod
│   │   │   ├── Readme.md               # API reference (short)
│   │   │   └── ure-modules/            # 12 module files
│   │   │
│   │   ├── search-modules/             # ★ Search modules (12 files)
│   │   ├── search-engine.js            # Fuse-based engine (singleton)
│   │   ├── search-ui.js                # Search orchestrator (public API)
│   │   │
│   │   ├── nav-core-modules/           # ★ Nav-Core modules (14 files)
│   │   ├── nav-core.js                 # Nav-Core orchestrator (parallel loader)
│   │   ├── nav-core-early.js           # Early bootstrap (instant)
│   │   │
│   │   ├── lang-modules/               # ★ Language modules (14 files; static mode uses 6)
│   │   ├── lang-core.js                # FvLang core (load FIRST in <head>)
│   │   ├── language.js                 # Language entry point + phase loader
│   │   ├── lang-proxy.js               # URL language proxy (early, redirects)
│   │   ├── lang-links.js               # Smart link prefix manager
│   │   │
│   │   ├── con-data-service/           # ★ Data service (2 files)
│   │   │   ├── con-data-service.js     # ES module + global
│   │   │   └── con-data-registry.js    # Schema registry
│   │   │
│   │   ├── popup.js                    # Popup System entry (sequential loader)
│   │   ├── popup-modules/              # 12 popup modules
│   │   ├── loading-system/
│   │   │   └── fvl.js                  # Single-file FVL (9 inline sections)
│   │   │
│   │   ├── modern-navigation.js        # Bottom nav bar
│   │   ├── copyNotification.js         # Copy feedback UI
│   │   ├── footer-template.js          # Footer injection
│   │   ├── banner-engine.js            # Banner system
│   │   ├── home.js                     # Home page logic
│   │   ├── new.js                      # What's New renderer
│   │   ├── roadmap.js                  # Roadmap renderer
│   │   ├── version-core.js             # Update notification
│   │   ├── back-to-top.js              # Scroll-to-top button
│   │   └── back-button.js              # Back navigation
│   │
│   ├── css/                            # 18+ CSS files (tokens.css loads first!)
│   ├── db/con-data/                    # Content data — see 10-Content-Guide
│   ├── json/                           # Config + content descriptors
│   ├── lang/                           # Translation files (en.json, th.json, options/db.json)
│   ├── template-html/                  # HTML templates
│   ├── fonts/                          # Custom fonts
│   └── images/                         # Images and assets
│
├── scripts/                            # Build scripts
│   ├── build.js                        # Main build orchestrator
│   ├── generate-sitemap.js             # Sitemap generator
│   ├── update-version.js               # Version bumper (run manually)
│   └── lib/
│       ├── file-utils.js
│       ├── html-transformer.js         # Cheerio-based HTML transformation
│       └── marker-parser.js            # Translation marker parser
│
├── fantrove-docs/                      # 📚 All documentation (this folder)
├── package.json                        # Node.js config (single dep: cheerio)
├── _redirects                          # Dev redirects (production version generated by build)
├── _headers                            # Cloudflare headers
├── robots.txt                          # Search engine rules
├── sitemap.xml                         # Auto-generated sitemap
├── ads.txt                             # AdSense config
├── LICENSE                             # Apache 2.0
├── NOTICE                              # Attribution
└── README.md                           # Repo entry — links to fantrove-docs/INDEX.md
```

### 4.1 หน้าเว็บทั้งหมด

ตรวจสอบรายการหน้าเว็บปัจจุบันได้จาก `scripts/generate-sitemap.js` และ `sitemap.xml` — รายการหน้าเว็บเปลี่ยนได้ตามการพัฒนา ไม่ควร hardcode ในเอกสาร

---

## 5. URL Structure และ Routing

### 5.1 URL Format (Production)

```
https://fantrove.pages.dev/{lang}/{page-path}
```

**ตัวอย่าง:**
```
/en/home/                                          → Home ภาษาอังกฤษ
/th/home/                                          → Home ภาษาไทย
/en/search/?q=heart                                → ค้นหา "heart"
/en/data/verse/discover/?type=symbols__&page=arrows
/th/setting/                                       → ตั้งค่าภาษาไทย
```

### 5.2 Routing 3 ชั้น

#### 5.2.1 Cloudflare `_redirects` (server-level)

ไฟล์ `_redirects` ใน repo root เป็นเวอร์ชั่น **dev** — production version ถูก generate โดย `scripts/build.js` และมี rules ที่ต่างออกไป (เช่น root redirect ไป `/en/home/` 302)

ดูรายละเอียดเต็มใน [`09-Deployment-Guide.md`](./09-Deployment-Guide.md) ส่วน URL Routing & Redirects

#### 5.2.2 SPA routing ในหน้า Discover (Nav-Core)

- Format: `?type={mainRoute}__&page={subRoute}`
- ตัวอย่าง: `?type=symbols__&page=arrows`
- Default route: `_all` (infinite feed)
- ใช้ `history.pushState`/`replaceState` + `popstate` handler
- Dispatch event `urlChanged` และ `routeChanged`

#### 5.2.3 Search page history

- Format: `?q={query}&type={type}__&category={category}`
- ใช้ Two-Stack browser history model (`search-modules/url-history.js`)

#### 5.2.4 Language routing

- **Production (built pages)**: URL prefix `/en/`, `/th/` ฝังใน HTML ตอน build
- **Development (localhost)**: ไม่มี prefix — ใช้ `lang-proxy.js` สำหรับ detect และ JS translation runtime
- **Tab sync**: BroadcastChannel `fv-lang-v3` ซิงค์ภาษาระหว่าง tabs ที่เปิดเว็บเดียวกัน

---

## 6. Data Architecture

### 6.1 Content Data — ระบบ con-data

ระบบ content แยกข้อมูลออกเป็น 2 ชั้น: **ข้อมูลดิบ** (raw data) กับ **ใบสั่งงาน** (descriptor) — ดูรายละเอียดเต็มใน [`10-Content-Guide.md`](./10-Content-Guide.md)

```
assets/db/con-data/
├── index.json              # Registry ของ top-level types
├── {type}.json             # Subcategory registry ของแต่ละ type
└── {type}/{subcategory}.json  # ข้อมูลดิบ items
```

### 6.2 โครงสร้าง index.json (Registry)

```json
{
  "categories": [
    {
      "id": "emoji",
      "name": { "en": "Emoji", "th": "อีโมจิ" },
      "file": "emoji.json"
    }
    // ... types อื่น ๆ
  ]
}
```

> รายการ types และ subcategories ทั้งหมดอยู่ในไฟล์ JSON จริง — ดูได้จาก `assets/db/con-data/index.json` หรือเอกสาร [`05-ConData-Service.md`](./05-ConData-Service.md)

### 6.3 Item schema มาตรฐาน

**Copyable item** (emoji, symbol, fancy):

```json
{
  "api":  "U+1F600",
  "text": "😀",
  "name": { "th": "หน้ายิ้ม", "en": "Grinning Face" }
}
```

**Collection item** (cards):

```json
{
  "api":         "card-openai",
  "text":        "OpenAI",
  "name":        { "th": "โอเพ่นเอไอ", "en": "OpenAI" },
  "description": { "th": "...", "en": "..." },
  "image":       "/assets/images/cards/openai.png",
  "link":        "https://openai.com"
}
```

### 6.4 Content descriptor (ใบสั่งงาน)

ไฟล์ใน `assets/json/content/` เป็น "ใบสั่งงาน" ที่บอกว่าจะดึง content อะไร + แสดงผลแบบไหน:

```json
[{ "source": "emoji" }]
[{ "category": "ai_tools", "type": "cards", "as": "cards" }]
```

ดูวิธีเขียนทั้งหมดใน [`10-Content-Guide.md`](./10-Content-Guide.md)

---

## 7. การสื่อสารระหว่างระบบ

### 7.1 Custom Events Catalog

| Event | ผู้ส่ง | Detail shape | ผู้ฟัง |
|-------|-------|--------------|--------|
| `ure:ready` | `ure.js` | `{ version }` | Nav-Core (`content.js`), Search |
| `fp:ready` | `popup-modules/init.js` | `{ version }` | `version-core.js`, `lang-modules/ui.js` |
| `fp:opening`, `fp:opened` | `popup-modules/state.js` | instance detail | ภายนอก |
| `fp:closing`, `fp:closed` | `popup-modules/state.js` | instance detail | ภายนอก |
| `fp:destroyed`, `fp:queued`, `fp:updated` | `popup-modules/state.js` | instance detail | ภายนอก |
| `fvl:ready` | `fvl.js` | `{ version }` | ภายนอก |
| `fvl:showing`, `fvl:shown` | `fvl.js` | loader detail | ภายนอก |
| `fvl:hiding`, `fvl:hidden` | `fvl.js` | loader detail | ภายนอก |
| `fvl:destroyed`, `fvl:updated` | `fvl.js` | loader detail | ภายนอก |
| `fv:langchange` ✨ (new) | `lang-core.js` (FvLang) | `{ lang, previousLang }` | `new.js`, `home.js`, `modern-navigation.js` |
| `languageChange` ⚠️ (legacy) | `lang-modules/manager.js`, `modern-navigation.js` | `{ language }` | ระบบเดิม — กำลัง migrate ไป `fv:langchange` |
| `languageReady` | `lang-modules/gate.js` | gate detail | (ใช้ผ่าน `window.languageReady` Promise แทน) |
| `routeChanged` | `nav-core-modules/router.js` | `{ main, sub }` | ภายนอก (ปัจจุบันใช้น้อย) |
| `urlChanged` | `nav-core-modules/router.js` | `{ url, mainRoute, subRoute }` | ภายนอก |

> ⚠️ **การ migrate ภาษา:** ระบบภาษากำลัง migrate จาก `languageChange` (legacy) ไปยัง `fv:langchange` (ใหม่) — โค้ดปัจจุบันส่วนใหญ่ฟัง **ทั้งสอง** event เพื่อ backward compat โค้ดใหม่ควรใช้ `fv:langchange` เท่านั้น

### 7.2 Global Variables สำคัญ

#### Public APIs (frozen objects)

| Variable | ตั้งโดย | ใช้โดย |
|----------|---------|--------|
| `window.URE` | `ure/ure.js` | Nav-Core, Search |
| `window.PopupSystem` | `popup-modules/init.js` | version-core, lang-ui, nav-core |
| `window.FVL` | `loading-system/fvl.js` | nav-core (loading.js proxy), ภายนอก |
| `window.FvLang` | `lang-core.js` | ทุกระบบ (read lang, subscribe changes) |
| `window.ConDataService` | `con-data-service.js` (auto-preloads) | Nav-Core, Search, Home |
| `window.ConDataRegistry` | `con-data-registry.js` | ConData Service |
| `window.SearchEngine` | `search-engine.js` | search-ui.js (internal) |
| `window.__searchUI` | `search-ui.js` | ภายนอก (user-facing API) |
| `window.languageManager` | `language.js` | ทุกระบบ (alias to `LangModules.LanguageManager`) |

#### Internal namespaces (mutable, populated by every module)

| Variable | ระบบ |
|----------|-------|
| `window.UREModules` | URE |
| `window.SearchModules` | Search |
| `window.NavCoreModules` | Nav-Core |
| `window.LangModules` | Language |
| `window.PopupModules` | Popup |
| `window.FVLModules` | FVL (inline) |

#### Boot markers & Promise

| Variable | ตั้งโดย | ความหมาย |
|----------|---------|----------|
| `window._navCore = { _initialized: true }` | `nav-core-modules/init.js` | Nav-Core boot เสร็จ |
| `window.__langUI = { _initialized: true }` | `language.js` | Language UI boot เสร็จ |
| `window.languageReady` | `lang-core.js` / `language.js` | Promise ที่ resolve เมื่อภาษาพร้อม |
| `window.onLanguageReady(fn)` | `lang-core.js` | Callback-style API สำหรับรอภาษาพร้อม |

#### Legacy compatibility aliases

`nav-core-modules/init.js` ตั้ง aliases หลายตัวบน `window` สำหรับ backward compat:
- `_navCore_*` family (14 aliases): `_navCore_utils`, `_navCore_dataManager`, `_navCore_contentManager`, ฯลฯ
- `_headerV2_*` family (14 aliases): mirror set สำหรับ header refactor ที่กำลังดำเนิน

> โค้ดใหม่ไม่ควรใช้ aliases เหล่านี้ — ใช้ `window.NavCoreModules.*` แทน

### 7.3 BroadcastChannel

- **Channel**: `fv-lang-v3`
- **Message**: `{ lang, url, ts }`
- **ใช้สำหรับ**: ซิงค์การเปลี่ยนภาษาระหว่าง browser tabs ที่เปิดเว็บเดียวกัน

---

## 8. Performance architecture

ดูรายละเอียดเต็มใน [`08-Performance-Architecture.md`](./08-Performance-Architecture.md) — ครอบคลุมทุกเทคนิค cross-cutting (virtual scroll, DOM pool, adaptive memory, web workers, typed arrays, lazy loading, CSS containment, rAF batching, profiling, budgets)

### 8.1 สรุปเทคนิคหลัก

| เทคนิค | ระบบที่ใช้ |
|--------|------------|
| Virtual Scrolling | URE |
| DOM Node Pooling | URE |
| Adaptive Memory Management | URE (MemoryManager) |
| Web Workers | URE (filter/sort), Language (translation) |
| Typed Arrays (Float32/Float64) | URE (offset calculations) |
| Template Cache + Height Cache | URE |
| Lazy Asset Loading | URE (img/iframe/bg) |
| CSS Containment + content-visibility | URE, Nav-Core Feed |
| requestIdleCallback | Search (Fuse index), ConData (warmup) |
| RAF Batching | URE Scheduler |
| DocumentFragment | ทั่วไป |
| Single-file inline modules | FVL (1 HTTP request) |

---

## 9. Third-Party Integrations

| Service | ID/URL | ใช้ที่ไหน |
|---------|--------|-----------|
| Google Tag Manager | GTM-PJ397CLS | ทุกหน้า |
| Google Analytics 4 | G-R4DGR81NZ6 | ทุกหน้า |
| Cookiebot | 16a70d79-... | ทุกหน้า |
| Google AdSense | ca-pub-8233915433564101 | ทุกหน้า |
| Fuse.js | CDN (lazy load) — `unpkg.com/fuse.js@6.6.2` | Search system |
| Cheerio | npm dependency (build only) | Build System |
| Ko-fi | nontakorn_nonsurat | Settings page |
| Patreon | rowingsco | Settings page |
| Banner API | fantrove-banner.vercel.app | Home page |

---

## 10. SEO Architecture (priority สูงสุด)

SEO เป็น priority ระดับพิเศษที่สูงสุดของ Fantrove — ทุกการตัดสินใจทางเทคนิคต้องคำนึงถึงผลกระทบต่อ search engine visibility ดูรายละเอียดเต็มใน [`12-SEO-Guide.md`](./12-SEO-Guide.md)

### 10.1 SEO layers ในสถาปัตยกรรมปัจจุบัน

| Layer | ส่วนที่เกี่ยวข้อง | บทบาท SEO |
|---|---|---|
| **Static HTML pre-build** | Build System (`scripts/build.js`) | แปล translation markers → text จริงใน HTML ตอน build เพื่อให้ search engine crawl เนื้อหาที่แปลแล้วได้โดยตรง (ไม่ต้องรอ JS) |
| **Meta tags** | HTML templates + `html-transformer.js` | `<title>`, `<meta description>`, Open Graph, Twitter Card ฝังในทุกหน้า |
| **hreflang & canonical** | `html-transformer.js` v2.1 | เพิ่ม `<link rel="canonical">` และ `<link rel="alternate" hreflang="...">` ให้ทุกหน้า × ทุกภาษาตอน build |
| **Sitemap** | `scripts/generate-sitemap.js` | สร้าง `sitemap.xml` ครอบคลุมทุกหน้า × ทุกภาษา ส่งให้ Google Search Console |
| **robots.txt** | root `/robots.txt` | อนุญาตให้ crawl ทุกหน้า, ชี้ไป sitemap.xml |
| **URL structure** | `_redirects` (production, generated) | URL สะอาด (`/en/home/`, `/th/search/?q=heart`) ไม่มี query พัง ๆ |
| **Core Web Vitals** | URE + FVL + Build System | LCP/INP/CLS ผ่าน thresholds ของ Google (ดู `08-Performance-Architecture.md`) |
| **Structured data** | HTML templates | JSON-LD Schema.org markup (เช่น WebSite, SearchAction, BreadcrumbList) |
| **Image SEO** | URE lazy-assets.js + HTML | `loading="lazy"`, `alt` text, format optimization |
| **International SEO** | Language System + Build System | 2 ภาษา × pre-built pages = search engine เข้าใจเนื้อหาแต่ละภาษาแยกกัน |

### 10.2 กฎเหล็กด้าน SEO

- ทุกหน้าต้องมี `<title>` และ `<meta name="description">` ที่เป็นภาษาของหน้านั้น (ไม่ใช่ default ภาษาเดียว)
- ทุกหน้าต้องมี `<link rel="canonical">` ที่ถูกต้อง — ป้องกัน duplicate content
- ทุกหน้าต้องมี hreflang tags ครบทุกภาษาที่รองรับ
- ห้ามใช้ `noindex` บนหน้าที่ต้องการให้ index (ยกเว้น beta/test pages)
- ห้าม render เนื้อหาสำคัญด้วย JavaScript อย่างเดียว — ต้องอยู่ใน static HTML
- ทุกหน้าใหม่ต้องเพิ่มใน `sitemap.xml`

> ดู checklist สำหรับ AI/นักพัฒนาใน [`12-SEO-Guide.md`](./12-SEO-Guide.md) ส่วน SEO Checklist และสิ่งที่ห้ามทำใน [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) ส่วน SEO violations

---

## 11. อ้างอิงข้ามเอกสาร

- [`01-URE-Universal-Render-Engine.md`](./01-URE-Universal-Render-Engine.md) — URE internals
- [`02-Search-System.md`](./02-Search-System.md) — Search system internals
- [`03-Nav-Core-System.md`](./03-Nav-Core-System.md) — Nav-Core internals
- [`04-Language-i18n-System.md`](./04-Language-i18n-System.md) — Language + Build System
- [`05-ConData-Service.md`](./05-ConData-Service.md) — ConData Service internals
- [`06-Popup-System.md`](./06-Popup-System.md) — Popup System internals
- [`07-Loading-System-FVL.md`](./07-Loading-System-FVL.md) — Loading System (FVL) internals
- [`08-Performance-Architecture.md`](./08-Performance-Architecture.md) — Cross-cutting performance
- [`09-Deployment-Guide.md`](./09-Deployment-Guide.md) — Build & deploy
- [`10-Content-Guide.md`](./10-Content-Guide.md) — Content management
- [`11-Whats-New-System.md`](./11-Whats-New-System.md) — Release notes system
- [`12-SEO-Guide.md`](./12-SEO-Guide.md) — ⭐ SEO strategy (priority สูงสุด)
- [`INDEX.md`](./INDEX.md) — สารบัญเอกสารทั้งหมด
