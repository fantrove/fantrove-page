# ภาพรวมสถาปัตยกรรมระบบ Fantrove Page

## 1. โปรเจกต์คืออะไร

**Fantrove** (หรือชื่ออีกชื่อว่า **Fantrove Verse**) เป็นแพลตฟอร์มคลังอีโมจิ สัญลักษณ์ (symbol) และข้อความแฟนซี (fancy text) ที่ทำงานเป็น static website บน **Cloudflare Pages** (`fantrove.pages.dev`) โปรเจกต์รองรับหลายภาษา (ปัจจุบัน `en` และ `th`) มี SEO optimization ผ่านการสร้าง static HTML แยกตามภาษาด้วย build script

คุณสมบัติหลักของโปรเจกต์:
- แสดงอีโมจิหลายพันตัว, สัญลักษณ์ 27 หมวดหมู่, ข้อความแฟนซี 10 สไตล์, และ AI tool cards
- ระบบค้นหา client-side แบบทันที (substring + fuzzy search)
- Virtual scrolling สำหรับแสดงข้อมูลจำนวนมหาศาล
- SPA-style navigation บนหน้า Discover และ Search
- i18n รองรับ 2 โหมด (runtime translation และ pre-built static pages)
- Deploy บน Cloudflare Pages ด้วย custom redirects และ headers

**เวอร์ชันปัจจุบัน**: 1.7.1

---

## 2. สถาปัตยกรรมรวม

### 2.1 ระบบหลัก 7 ระบบ

| # | ระบบ | บทบาท | ไฟล์หลัก |
|---|------|-------|-----------|
| 1 | **URE (Universal Render Engine)** v1.7.1 | Virtual scroll rendering engine สำหรับแสดงข้อมูลจำนวนมาก | `assets/js/ure/ure.js` + 12 modules |
| 2 | **Search System** | ระบบค้นหา client-side แบบ two-tier (substring + Fuse.js fuzzy) | `search-engine.js` + `search-ui.js` + 13 modules |
| 3 | **Nav-Core** | Navigation & Content Management สำหรับหน้า Discover | `nav-core.js` + `nav-core-early.js` + 14 modules |
| 4 | **Language/i18n System** v5.0 | ระบบแปลภาษา client-side พร้อม build-time static generation | `lang-core.js` + `language.js` + lang-modules |
| 5 | **Con-Data Service** v2.2.0 | Data access layer สำหรับ content (emoji, symbol, fancy, cards) | `con-data-service.js` + `con-data-registry.js` |
| 6 | **Popup System** v1.1.0 | ระบบ popup ส่วนกลาง — 9 presets, fullscreen, zero coupling | `assets/js/popup.js` + popup-modules (12 modules) |
| 7 | **Build System** | สร้าง static HTML แยกภาษา, sitemap, redirects | `scripts/build.js` + 4 lib files |

### 2.2 แผนภาพการเชื่อมต่อระบบ

```
┌─────────────────────────────────────────────────────────┐
│                    HTML Pages (14 หน้า)                   │
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
  │     Con-Data Service v2.2.0         │     │
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
  ─ Custom Events: languageChange, routeChanged, urlChanged, ure:ready
  ─ Global Variables: window.URE, window.SearchEngine, window.ConDataService
  ─ BroadcastChannel('fv-lang-v3'): ซิงค์ภาษาระหว่าง tabs
```

**การพึ่งพาระหว่างระบบ:**
- **URE** ← ถูกเรียกใช้โดย Search (rendering.js) และ Nav-Core (content.js)
- **Con-Data Service** ← เป็น data provider หลักให้ Search และ Nav-Core
- **Language System** ← ทุกระบบฟัง `languageChange` event เพื่ออัปเดต UI
- **Build System** ← อ่าน HTML + translation ทุกหน้า → สร้าง static pages

### 2.3 Module Pattern ทั้งระบบ

ทั้ง 4 ระบบหลัก (URE, Search, Nav-Core, Language) ใช้ **IIFE pattern** เดียวกัน:

```javascript
// ทุก module ใช้รูปแบบนี้:
(function(M) {
  'use strict';
  // ... module code ...
  M.ModuleName = ModuleName; // export
})(window.SomeNamespace = window.SomeNamespace || {});
```

**Namespace ของแต่ละระบบ:**
- URE: `window.UREModules`
- Search: `window.SearchModules`
- Nav-Core: `window.NavCoreModules`
- Language: `window.LangModules`

**ลักษณะสำคัญที่ต้องรู้:**
- ไม่มี ES modules หรือ import/export
- ไม่มี reactive system — state เป็น shared mutable object
- การสื่อสารระหว่าง module ทำผ่าน direct method calls
- การสื่อสารระหว่างระบบทำผ่าน Custom Events + global variables
- ทุก module มี `destroy()` function สำหรับ cleanup

---

## 3. โครงสร้างไฟล์โปรเจกต์

### 3.1 Directory Tree

```
fantrove-page/
├── index.html                          # 404 fallback page
├── home/index.html                     # Landing page
├── search/index.html                   # Search page (full)
├── data/verse/discover/index.html      # Discover/browse page
├── data/verse/scope/index.html         # Placeholder (empty)
├── setting/index.html                  # Settings page
├── info/about/index.html               # About page
├── info/roadmap/index.html             # Roadmap page
├── info/whats_new/index.html           # What's New page
├── us/index.html                       # User hub page
├── us/contact/index.html               # Contact form
├── us/report/index.html                # Report form
├── beta.html                           # UI mockup test
├── n.html                              # SVG playground
│
├── assets/
│   ├── js/
│   │   ├── ure/                        # ★ URE Engine (13 files)
│   │   │   ├── ure.js                  # Entry point
│   │   │   ├── ure.css                 # Auto-injected styles
│   │   │   └── ure-modules/            # 12 module files
│   │   │
│   │   ├── search-modules/             # ★ Search modules (13 files)
│   │   ├── search-engine.js            # Search algorithm (global)
│   │   ├── search-ui.js                # Search orchestrator
│   │   │
│   │   ├── nav-core-modules/           # ★ Nav-Core modules (14 files)
│   │   ├── nav-core.js                 # Nav-Core orchestrator
│   │   ├── nav-core-early.js           # Early bootstrap
│   │   │
│   │   ├── lang-modules/               # ★ Language modules (14 files)
│   │   ├── language.js                 # Language entry point
│   │   ├── lang-proxy.js               # URL language proxy (head script)
│   │   ├── lang-links.js               # Smart link prefix
│   │   │
│   │   ├── con-data-service/           # ★ Data service (2 files)
│   │   │
│   │   ├── modern-navigation.js        # Bottom nav bar
│   │   ├── copyNotification.js         # Copy feedback UI
│   │   ├── footer-template.js          # Footer injection
│   │   ├── banner-engine.js            # Banner system v5.0.0
│   │   ├── home.js                     # Home page logic
│   │   ├── new.js                      # What's New renderer
│   │   ├── roadmap.js                  # Roadmap renderer
│   │   ├── version-core.js             # Update notification
│   │   ├── back-to-top.js              # Scroll-to-top button
│   │   ├── back-button.js              # Back navigation
│   │   ├── lang-proxy.js               # Language URL proxy
│   │   └── popup.js                    # PopupSystem v1.1.0 entry point
│   │
│   ├── css/                            # 17 CSS files
│   │   ├── tokens.css                  # Design tokens (load first!)
│   │   ├── bg.css, home.css, search.css, setting.css, about.css
│   │   ├── nav-core.css, nav-core-ext.css, loading.css
│   │   ├── footer.css, popup.css, back-to-top.css
│   │   ├── modern-styles.css, top-navigation-bar.css
│   │   ├── new.css, roadmap.css
│   │   └── search-compact-overrides.css
│   │
│   ├── db/con-data/                    # Content data (new system)
│   │   ├── index.json                  # Registry (4 types)
│   │   ├── emoji.json                  # 9 categories
│   │   ├── symbol.json                 # 27 categories
│   │   ├── fancy.json                  # 10 categories
│   │   ├── cards.json                  # 1 category
│   │   ├── emoji/                      # 9 data files
│   │   ├── symbol/                     # 27 data files
│   │   ├── fancy/                      # 10 data files
│   │   └── cards/                      # 1 data file
│   │
│   ├── json/                           # Config + template data
│   │   ├── buttons.json                # Nav button config
│   │   ├── template/template.json      # Bottom nav config
│   │   ├── whats-new.json              # Release notes
│   │   ├── release-history.json        # Version history
│   │   ├── current-stage.json          # Dev stage info
│   │   └── content/                    # Old template data
│   │
│   ├── lang/                           # Translation files
│   │   ├── en.json                     # English translations
│   │   ├── th.json                     # Thai translations
│   │   └── options/db.json             # Language config
│   │
│   ├── template-html/                  # HTML templates
│   │   ├── footer-template.html        # Footer template
│   │   ├── home-templates.html         # Home page templates
│   │   └── intro-template.html         # Intro template
│   │
│   ├── fonts/                          # Custom fonts
│   └── images/                         # Images and assets
│
├── scripts/                            # Build scripts
│   ├── build.js                        # Main build orchestrator
│   ├── generate-sitemap.js             # Sitemap generator
│   ├── update-version.js               # Version bumper
│   └── lib/
│       ├── file-utils.js               # File utilities
│       ├── html-transformer.js         # HTML transformer (Cheerio)
│       └── marker-parser.js            # Translation marker parser
│
├── package.json                        # Node.js config
├── _redirects                          # Cloudflare redirects
├── _headers                            # Cloudflare headers
├── robots.txt                          # Search engine rules
├── sitemap.xml                         # Auto-generated sitemap
└── ads.txt                             # AdSense config
```

### 3.2 หน้าเว็บทั้งหมด (14 หน้า)

| หน้า | Path | บทบาท | JS หลัก | ระบบที่ใช้ |
|------|------|--------|---------|------------|
| 404 | `/index.html` | Fallback page | language, footer, lang-links | Language |
| Home | `/home/` | Landing page พร้อม carousel | home.js, banner-engine, version-core | URE, Con-Data |
| Search | `/search/` | ค้นหาเต็มรูปแบบ | search-engine, search-ui, URE | Search, URE, Con-Data |
| Discover | `/data/verse/discover/` | Browse content แบบ SPA | nav-core, nav-core-early, URE | Nav-Core, URE, Con-Data |
| Scope | `/data/verse/scope/` | Placeholder (ว่าง) | - | - |
| Settings | `/setting/` | ตั้งค่า + เลือกภาษา | language, modern-nav, version-core | Language |
| About | `/info/about/` | ข้อมูลเว็บ + License | language, back-button | Language |
| Roadmap | `/info/roadmap/` | แผนพัฒนา | roadmap.js | - |
| What's New | `/info/whats_new/` | Release notes | new.js | - |
| User Hub | `/us/` | Hub แยก contact/report | language, back-button | Language |
| Contact | `/us/contact/` | ติดต่อ (Gmail/Form) | language + inline | Language |
| Report | `/us/report/` | รายงานปัญหา (Form) | language + inline | Language |

---

## 4. URL Structure และ Routing

### 4.1 URL Format

```
https://fantrove.pages.dev/{lang}/{page-path}
```

**ตัวอย่าง:**
```
/en/home/                              → Home ภาษาอังกฤษ
/th/home/                              → Home ภาษาไทย
/en/search/?q=heart                    → ค้นหา "heart"
/en/data/verse/discover/?type=symbols__&page=arrows
/th/setting/                           → ตั้งค่าภาษาไทย
```

### 4.2 Cloudflare _redirects (Production)

```
/                    → /en/home/              (302)
/index.html          → /en/home/              (302)
/en                  → /en/home/              (302)
/th                  → /th/home/              (302)
/{lang}/*            → /{lang}/:splat         (200, serve static)
/assets/*            → /assets/:splat         (200, passthrough)
/*                  → /en/home/              (404 fallback)
```

### 4.3 ระบบ Routing ภายใน

**Discover page (Nav-Core SPA routing):**
- Format: `?type={mainRoute}__&page={subRoute}`
- ตัวอย่าง: `?type=symbols__&page=arrows`
- Default route: `_all` (infinite feed)
- ใช้ `history.pushState`/`replaceState` + `popstate` handler

**Search page:**
- Format: `?q={query}&type={type}__&category={category}`
- ใช้ Two-Stack browser history model

**Language routing:**
- Production: URL prefix `/en/`, `/th/`
- Development (localhost): ไม่มี prefix ใช้ JS translation

---

## 5. Data Architecture

### 5.1 Content Data — ระบบใหม่ (con-data)

โครงสร้างแบบ hierarchical:

```json
{
  "type": [
    {
      "id": "emoji",
      "name": { "en": "Emoji", "th": "อีโมจิ" },
      "categories": [
        {
          "id": "smileys_emotion",
          "name": { "en": "Smileys", "th": "หน้ายิ้ม" },
          "file": "/assets/db/con-data/emoji/smileys_emotion.json"
        }
      ]
    }
  ]
}
```

**Item structure มาตรฐาน:**
```json
{
  "api": "U+2190",
  "text": "←",
  "name": { "th": "ลูกศรซ้าย", "en": "Leftwards Arrow" }
}
```

**Card item structure:**
```json
{
  "api": "card-openai",
  "text": "OpenAI",
  "name": { "th": "โอเพ่นเอไอ", "en": "OpenAI" },
  "description": { "th": "...", "en": "..." },
  "image": "/assets/images/cards/openai.png",
  "link": "https://openai.com"
}
```

### 5.2 ปริมาณข้อมูล

| Type | Categories | รายละเอียด |
|------|-----------|-------------|
| Emoji | 9 | smileys, people, animals, food, travel, activities, objects, symbols, flags |
| Symbol | 27 | arrows, math, currency, punctuation, latin, greek, cyrillic, geometric, box_drawing, ฯลฯ |
| Fancy | 10 | math_bold, math_italic, math_script, math_fraktur, math_double_struck, ฯลฯ |
| Cards | 1 | ai_tools (OpenAI, Anthropic) |

---

## 6. การสื่อสารระหว่างระบบ

### 6.1 Custom Events

| Event | ผู้ส่ง | Detail | ผู้ฟัง |
|-------|-------|-------|--------|
| `languageChange` | Language Manager | `{ language, previousLanguage }` | ทุกระบบ |
| `routeChanged` | RouterService (Nav-Core) | `{ main, sub }` | ทุก module ใน Nav-Core |
| `urlChanged` | RouterService | `{ url, mainRoute, subRoute }` | ภายนอก |
| `ure:ready` | ure.js | `{ version: '1.7.1' }` | Nav-Core, Search |
| `languageReady` | Language Manager | `{ lang, translations }` | ทุกระบบ |
| `fp:ready` | popup/init.js | — | version-core, lang-ui |
| `fp:opened` | popup/engine.js | `{ id, options }` | ภายนอก |
| `fp:closed` | popup/engine.js | `{ id, result }` | ภายนอก |

### 6.2 Global Variables สำคัญ

| Variable | ตั้งโดย | ใช้โดย |
|----------|---------|--------|
| `window.URE` | ure.js | Nav-Core, Search |
| `window.UREModules` | ทุก URE module | URE internal |
| `window.SearchEngine` | search-engine.js | search-ui.js |
| `window.__searchUI` | search-ui.js | ภายนอก |
| `window.SearchModules` | ทุก Search module | Search internal |
| `window.ConDataService` | con-data-service.js | Nav-Core, Search, Home |
| `window.ConDataRegistry` | con-data-registry.js | Con-Data Service |
| `window.NavCoreModules` | ทุก Nav-Core module | Nav-Core internal |
| `window.LangModules` | ทุก Language module | Language internal |
| `window.languageManager` | language.js | ทุกระบบ |
| `window.languageReady` | language.js | ทุกระบบ (Promise) |
| `window.modernNav` | modern-navigation.js | ทุกหน้า |
| `window.BannerEngine` | banner-engine.js | Home page |
| `window.unifiedCopyToClipboard` | nav-core/init.js | ContentService |
| `window.showCopyNotification` | copyNotification.js | Search, Nav-Core |
| `window.showInstantLoadingOverlay` | loading.js | ภายนอก |
| `window.PopupSystem` | popup.js (init.js) | version-core, lang-ui, nav-core |
| `window.PopupModules` | ทุก popup module | Popup internal |

### 6.3 BroadcastChannel

- **Channel**: `fv-lang-v3`
- **Message**: `{ lang, url, ts }`
- **ใช้สำหรับ**: ซิงค์การเปลี่ยนภาษาระหว่าง browser tabs

---

## 7. Performance Architecture

| เทคนิค | ระบบที่ใช้ | รายละเอียด |
|--------|------------|-------------|
| Virtual Scrolling | URE | แสดงเฉพาะ items ใน viewport + buffer zone |
| DOM Node Pooling | URE | Recycle DOM nodes แทน create/destroy |
| Adaptive Memory | URE v1.7.1 | ตรวจ memory pressure ปรับ cap อัตโนมัติ |
| Web Workers | URE, Language | Filter/sort/translate อยู่นอก main thread |
| Typed Arrays | URE | Float32Array/64Array สำหรับ offset calculations |
| Template Cache | URE | Map cache ของ rendered HTML |
| Height Cache | URE | sessionStorage บันทึกความสูง item |
| Lazy Asset Loading | URE | img/iframe/bg โหลดเมื่อเข้า viewport |
| CSS Containment | URE | `contain: layout style paint` บน items |
| Content Visibility | Nav-Core Feed | `content-visibility: auto` บน feed pages |
| requestIdleCallback | ทั่วไป | Fuse index build, data warmup |
| DocumentFragment | ทั่วไป | Batch DOM insert |
| RAF Batching | ทั่วไป | Single paint per frame |

---

## 8. Third-Party Integrations

| Service | ID/URL | ใช้ที่ไหน |
|---------|--------|-----------|
| Google Tag Manager | GTM-PJ397CLS | ทุกหน้า |
| Google Analytics 4 | G-R4DGR81NZ6 | ทุกหน้า |
| Cookiebot | 16a70d79-... | ทุกหน้า |
| Google AdSense | ca-pub-8233915433564101 | ทุกหน้า |
| Fuse.js v6.6.2 | CDN (lazy load) | Search system |
| Cheerio | npm dependency | Build system only |
| Ko-fi | nontakorn_nonsurat | Settings page |
| Patreon | rowings_official | Settings page |
| Banner API | fantrove-banner.vercel.app | Home page |
| Wave Effect | marcumat-js.pages.dev | Navigation |

---

## 9. ไฟล์เอกสารประกอบในชุดนี้

| ไฟล์ | เนื้อหา |
|------|---------|
| `00-ภาพรวมสถาปัตยกรรมทั้งระบบ.md` | เอกสารนี้ — ภาพรวมทั้งโปรเจกต์ |
| `01-URE-Universal-Render-Engine.md` | ระบบ URE v1.7.1 อย่างละเอียด |
| `02-ระบบ-Search.md` | ระบบค้นหาทั้ง 14 module อย่างละเอียด |
| `03-ระบบ-Nav-Core.md` | ระบบ Nav-Core + JS ไฟล์อิสระทั้งหมด |
| `04-ระบบภาษา-i18n.md` | ระบบภาษา + Build System |
| `05-ConData-Service.md` | Content Data Service v2.2.0 |
| `06-Popup-System.md` | Fantrove Popup System v1.1.0 |

---

## 10. Popup System — ระบบ Popup ส่วนกลาง

> **เวอร์ชัน:** v1.1.0 | **Namespace:** `window.PopupSystem` | **ไฟล์:** `assets/js/popup.js` + `popup-modules/` (12 modules)

Popup System เป็นระบบ popup ส่วนกลางของ Fantrove ที่ทุก popup ทั่วทั้งเว็บใช้ร่วมกัน ออกแบบมาเหมือน URE — ใช้ IIFE module pattern, zero coupling กับระบบอื่น, และ auto-inject CSS

### 10.1 Public API

```javascript
// เปิด popup (API หลัก)
const handle = await PopupSystem.open({
  type: 'dialog',          // preset type
  title: 'Title',
  body: '<p>Content</p>', // ใช้ body ไม่ใช้ content
  size: 'md',
  theme: 'light',
  group: 'my-group',
  onMount: (bodyEl, handle) => { /* bind events */ },
  onClose: (id, result) => { /* handle result */ },
});

// Shortcut methods
await PopupSystem.alert('Message');
const ok = await PopupSystem.confirm('Are you sure?');
await PopupSystem.toast('Saved!');
const handle = await PopupSystem.fullscreen({ body: '...' });

// Management
PopupSystem.close(id);
PopupSystem.closeAll();
PopupSystem.closeByGroup('my-group');
PopupSystem.destroy(id);
PopupSystem.stats();
PopupSystem.on('opened', (detail) => {});
```

### 10.2 Presets (9 ประเภท)

dialog, alert, confirm, sheet, toast, drawer, tooltip, popover, **fullscreen**

### 10.3 ระบบที่ใช้ PopupSystem

| ระบบ | วิธีใช้ |
|------|----------|
| version-core.js | `PopupSystem.open()` แสดง popup แจ้งอัพเดทเวอร์ชัน |
| lang-modules/ui.js | `PopupSystem.open()` หน้าต่างเลือกภาษา |
| nav-core/utils.js | `PopupSystem.fullscreen()` แสดงข้อผิดพลาดผ่าน `showErrorFullscreen()` |

### 10.4 Global Variables

| Variable | ตั้งโดย | ใช้โดย |
|----------|---------|--------|
| `window.PopupSystem` | init.js | version-core, lang-ui, nav-core |
| `window.PopupModules` | ทุก popup module | Popup internal |

### 10.5 Custom Events

| Event | ผู้ส่ง | Detail |
|-------|-------|--------|
| `fp:ready` | init.js | — |
| `fp:opened` | engine.js | `{ id, options }` |
| `fp:closed` | engine.js | `{ id, result }` |

ดูรายละเอียดเต็มใน [`06-Popup-System.md`](06-Popup-System.md)

---

> **เอกสารฉบับนี้สร้างขึ้นเพื่อให้ AI หรือนักพัฒนาสามารถเข้าใจสถาปัตยกรรมระบบ Fantrove ทั้งหมดได้จากเอกสารฉบับเดียว — โดยไม่ต้องอ่าน source code โดยตรง**
