# 04 — ระบบภาษา (i18n) และ Build System

> เอกสารนี้อธิบายระบบ internationalization (i18n) และระบบ Build ของ **Fantrove** อย่างละเอียดครบถ้วน ครอบคลุม FvLang Central API (v5.0), Runtime Mode (แปลภาษาด้วย JS บนเบราว์เซอร์) และ Pre-built Static Mode (แปลภาษาด้วย Build Script ก่อน deploy) รวมถึง Build System ที่สร้าง static HTML สำหรับทุกภาษา
>
> **สำหรับ:** AI และนักพัฒนาที่จะแก้ระบบภาษา เพิ่มภาษาใหม่ หรือแก้ Build System
>
> **ไฟล์หลัก:** `assets/js/lang-core.js` (FvLang core, load first) + `assets/js/language.js` (entry) + `assets/js/lang-proxy.js` + `assets/js/lang-links.js` + `assets/js/lang-modules/` (14 modules, static mode uses 6)
>
> **เวอร์ชัน:** v5.0 (FvLang integration), ui.js v6.0 (PopupSystem-backed language popup)
>
> **Migration note:** ระบบกำลัง migrate จาก `languageChange` (legacy) ไปยัง `fv:langchange` (new) — โค้ดปัจจุบันส่วนใหญ่ฟังทั้งสอง event เพื่อ backward compat

---

## สารบัญ

1. [ภาพรวมสถาปัตยกรรม](#1-ภาพรวมสถาปัตยกรรม)
2. [ไฟล์และโมดูลทั้งหมด](#2-ไฟล์และโมดูลทั้งหมด)
3. [Translation Data — ไฟล์ JSON](#3-translation-data--ไฟล์-json)
4. [Translation Markers — ระบบมาร์กเกอร์](#4-translation-markers--ระบบมาร์กเกอร์)
5. [FvLang — Central Language API (v5.0)](#5-fvlang--central-language-api-v50)
   - 5.1 [บทบาทและจุดประสงค์](#51-บทบาทและจุดประสงค์)
   - 5.2 [Public API — `window.FvLang`](#52-public-api--windowfvlang)
   - 5.3 [Event — `fv:langchange`](#53-event--fvlangchange)
   - 5.4 [การ Detect ภาษา (Synchronous)](#54-การ-detect-ภาษา-synchronous)
   - 5.5 [Subscriber System](#55-subscriber-system)
   - 5.6 [Backward Compatibility Shims](#56-backward-compatibility-shims)
   - 5.7 [การ Integrate กับระบบอื่น](#57-การ-integrate-กับระบบอื่น)
6. [Runtime Mode — ระบบแปลภาษาบนเบราว์เซอร์](#6-runtime-mode--ระบบแปลภาษาบนเบราว์เซอร์)
   - 6.1 [Entry Point — `language.js` v5.0](#61-entry-point--languagejs-v50)
   - 6.2 [Phase Loading System (v5.0 — Static Optimization)](#62-phase-loading-system-v50--static-optimization)
   - 6.3 [LangGate — ระบบ Gate](#63-langgate--ระบบ-gate)
   - 6.4 [Config (`config.js`)](#64-config-configjs)
   - 6.5 [State (`state.js`)](#65-state-statejs)
   - 6.6 [DetectorService — การตรวจจับภาษา](#66-detectorservice--การตรวจจับภาษา)
   - 6.7 [LoaderService — การโหลดข้อมูล](#67-loaderservice--การโหลดข้อมูล)
   - 6.8 [TranslatorService — เครื่องมือแปลภาษา](#68-translatorservice--เครื่องมือแปลภาษา)
   - 6.9 [MarkerRegistry — ระบบ Registry](#69-markerregistry--ระบบ-registry)
   - 6.10 [URLService — จัดการ URL](#610-urlservice--จัดการ-url)
   - 6.11 [NavigationService — การนำทางและ Sync](#611-navigationservice--การนำทางและ-sync)
   - 6.12 [UIService — UI ตัวเลือกภาษา](#612-uiservice--ui-ตัวเลือกภาษา)
   - 6.13 [LanguageManager — Orchestrator หลัก (v5.0)](#613-languagemanager--orchestrator-หลัก-v50)
7. [lang-proxy.js — URL Language Proxy](#7-lang-proxyjs--url-language-proxy)
8. [lang-links.js — Smart Link Prefix Manager](#8-lang-linksjs--smart-link-prefix-manager)
9. [Pre-built Static Mode (v5.0)](#9-pre-built-static-mode-v50)
10. [Build System](#10-build-system)
   - 10.1 [build.js — Production Build Orchestrator](#101-buildjs--production-build-orchestrator)
   - 10.2 [html-transformer.js — การแปลง HTML](#102-html-transformerjs--การแปลง-html)
   - 10.3 [marker-parser.js — Node.js Marker Parser](#103-marker-parserjs--nodejs-marker-parser)
   - 10.4 [file-utils.js — File I/O Helpers](#104-file-utilsjs--file-io-helpers)
   - 10.5 [generate-sitemap.js — Sitemap Generator](#105-generate-sitemapjs--sitemap-generator)
   - 10.6 [update-version.js — Release Tool](#106-update-versionjs--release-tool)
11. [Global Variables และ Events (v5.0)](#11-global-variables-และ-events-v50)
12. [การทำงานร่วมกันระหว่าง Runtime และ Static Mode (v5.0)](#12-การทำงานร่วมกันระหว่าง-runtime-และ-static-mode-v50)

---

## 1. ภาพรวมสถาปัตยกรรม

ระบบภาษาของ Fantrove รองรับ **2 โหมด** ที่ทำงานแยกกันแต่แชร์ codebase ร่วมกัน:

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Fantrove i18n System (v5.0)                    │
├─────────────────────────────────────────────────────────────────────┤
│                    FvLang Layer (lang-core.js)                       │
│  • Synchronous language detection (data-fv-built → URL → LS → nav)  │
│  • window.FvLang API (.lang, .onChange, .setLang, .forceRefresh)    │
│  • Dispatch 'fv:langchange' event — single source of truth          │
│  • All JS systems subscribe here instead of reading localStorage    │
├────────────────────────────┬────────────────────────────────────────┤
│   Runtime Mode (JS)       │   Pre-built Static Mode (Build)        │
│                            │                                        │
│  • language.js v5.0       │  • Build script อ่าน db.json          │
│  • Reads FvLang.lang      │  • marker-parser.js (Node.js)          │
│  • 14 modules (full)      │  • cheerio แปลง HTML                   │
│  • 6 modules (static)     │  • ลบ data-translate attrs              │
│  • Web Worker pool        │  • Inject hreflang/canonical           │
│  • DOM reconciliation     │  • Inject footer template              │
│  • FvLang.setLang()       │  • language.js (static mode)           │
│    → fv:langchange        │  • lang-links.js                       │
│  • lang-proxy.js          │  • ไม่ต้อง lang-proxy.js               │
│  • lang-links.js          │                                        │
└────────────────────────────┴────────────────────────────────────────┘
```

### ข้อแตกต่างหลักระหว่าง 2 โหมด

| ลักษณะ | Runtime Mode | Pre-built Static Mode |
|---------|-------------|---------------------|
| การแปล | JS บน browser | Build script (Node.js) ก่อน deploy |
| Web Workers | ใช้ | ไม่ใช้ |
| IndexedDB cache | ใช้ | ไม่ใช้ |
| BroadcastChannel | ใช้ | ไม่ใช้ |
| `data-translate` ใน HTML | ค้างไว้ | ถูกลบออก (baked แล้ว) |
| `body opacity:0` | ลบเมื่อพร้อม | ลบออกจาก HTML ตั้งแต่ build |
| `window.FvLang` | สร้างโดย lang-core.js | ไม่มี (language.js จัดการ) |
| `data-fv-built` | ไม่มี | มี (signal ให้ language.js เข้า static mode) |
| `window.__fvStaticConfig` | ไม่มี | มี (inject ใน `<head>`) |
| เปลี่ยนภาษา | JS translate ทันที | `location.replace()` ไปหน้าภาษาอื่น |

---

## 2. ไฟล์และโมดูลทั้งหมด

### Runtime ไฟล์ (Browser)

```
assets/js/
├── lang-core.js             ← v5.0: FvLang Central API (โหลดก่อน language.js)
├── language.js              ← v5.0: Entry point, Phase Loader, Gate Promise (FvLang integration)
├── lang-proxy.js            ← URL prefix redirect (pre-DOM)
├── lang-links.js            ← Smart link prefix manager (DOM ready)
└── lang-modules/
    ├── types.js             ← Phase 1: TypeScript typedefs (JSDoc)
    ├── config.js            ← Phase 1: Compile-time constants
    ├── state.js             ← Phase 1: Shared mutable state
    ├── worker-pool.js       ← Phase 1: Generic Web Worker pool (lazy)
    ├── gate.js              ← Phase 1: LangGate (T1-T5 blocking)
    ├── db.js                ← Phase 2: IndexedDB cache service
    ├── detector.js          ← Phase 2: Language detection
    ├── loader.js            ← Phase 2: Config & translation loader
    ├── markers.js           ← Phase 2: MarkerRegistry (extensible)
    ├── translator.js        ← Phase 2: Translation engine (Worker + DOM)
    ├── ui.js                ← Phase 2: Language selector UI
    ├── url.js               ← Phase 3: URL prefix updater
    ├── navigation.js        ← Phase 3: Navigation events & BroadcastChannel
    └── manager.js           ← Phase 3: LanguageManager (orchestrator)
```

### Translation Data

```
assets/lang/
├── en.json                  ← English translations (flat + nested)
├── th.json                  ← Thai translations
└── options/
    └── db.json              ← Language config & metadata
```

### Build System (Node.js)

```
scripts/
├── build.js                 ← Production build orchestrator
├── generate-sitemap.js      ← Sitemap.xml generator
├── update-version.js        ← Release version tool
└── lib/
    ├── html-transformer.js  ← HTML transformation (cheerio-based)
    ├── marker-parser.js     ← Translation marker parser (Node.js port)
    └── file-utils.js        ← File discovery & I/O helpers
```

---

## 3. Translation Data — ไฟล์ JSON

### 3.1 `db.json` — การตั้งค่าภาษา

ไฟล์ `assets/lang/options/db.json` เป็น config หลักของระบบภาษา:

```json
{
  "en": {
    "label": "🇬🇧 English",
    "buttonText": "Language: 🇬🇧 English",
    "enSource": "json"
  },
  "th": {
    "label": "🇹🇭 ไทย",
    "buttonText": "ภาษา: 🇹🇭 ไทย"
  }
}
```

**คำอธิบายฟิลด์:**

| ฟิลด์ | หน้าที่ |
|-------|---------|
| `label` | ข้อความแสดงใน dropdown เลือกภาษา |
| `buttonText` | ข้อความแสดงบนปุ่ม language selector |
| `enSource` | (เฉพาะ `en`) ระบุว่าเนื้อหาอังกฤษมาจาก `"json"` หรือ `"html"` (default) |

### 3.2 `en.json` / `th.json` — ข้อมูลการแปล

ไฟล์ translation ใช้โครงสร้าง **nested JSON** ที่จะถูก flatten เป็น key-value map แบบ flat ก่อนใช้งาน:

```json
{
  "seo": {
    "home-seo-title": "Fantrove — Emoji & Symbols Hub | Copy with One Tap"
  },
  "general": {
    "description": "Explore emojis and special characters from virtually every platform"
  },
  "home-hero-title": "Emoji & Special Characters Hub",
  "home-hero-desc": "Your central place to search, copy, and use @strong emojis@ and @strong special characters@ for all your needs!"
}
```

**Flattening แปลง nested key เป็น leaf-only:**

```
Input:  { seo: { "home-seo-title": "..." }, "home-hero-title": "..." }
Output: { "home-seo-title": "...", "home-hero-title": "..." }
```

หมายเหตุ: key ที่เป็น object (เช่น `seo`) จะถูกทิ้ง รักษาเฉพาะ leaf nodes

### 3.3 การใช้ `data-translate` ใน HTML

Element ที่ต้องการแปลจะมี attribute `data-translate` ที่มีค่าเป็น key จาก translation JSON:

```html
<h1 data-translate="home-hero-title">Emoji & Special Characters Hub</h1>
<p data-translate="home-hero-desc">
  Your central place to search, copy, and use
  <strong>emojis</strong> and <strong>special characters</strong>
  for all your needs!
</p>
```

เมื่อแปลเป็นภาษาไทย (runtime mode) ระบบจะอ่านค่าจาก `th.json` แล้วสร้าง DOM ใหม่จาก parsed parts

---

## 4. Translation Markers — ระบบมาร์กเกอร์

ระบบมาร์กเกอร์เป็นหัวใจของการแปลที่รักษา HTML structure ภายใน translation string ได้ รองรับทั้ง runtime (Web Worker) และ build-time (Node.js)

### 4.1 ประเภทของ Markers

| Marker | รูปแบบ | คำอธิบาย | ตัวอย่าง |
|--------|---------|----------|---------|
| `@br` | `@br` | ขึ้นบรรทัดใหม่ | `Line 1@brLine 2` |
| `@strong...@` | `@strong(text)@` | ตัวหนา | `@strongสำคัญ@` |
| `@a...@` | `@a(text)@` | Anchor link | `@a Creative Commons Zero v1.0 Universal (CC0)@` |
| `@svg[:id]@` | `@svg:iconName@` | อ้างอิง SVG | `@svg:arrow@ Click` |
| `@lsvg[:id]@` | `@lsvg:iconName@` | Local SVG reference | `@lsvg@ Browse` |
| `@slot:name@` | `@slot:1@` | Slot placeholder | `@slot:1@ คัดลอก` |

### 4.2 ตัวอย่างการใช้งานใน JSON

```json
{
  "home-hero-btn-emoji": "@slot:1@ เรียกดูอิโมจิทั้งหมด",
  "home-hero-desc": "ศูนย์กลางสำหรับค้นหา คัดลอก และใช้ @strongอิโมจิ@ และ @strongอักขระพิเศษ@ ในทุกการใช้งานของคุณ!",
  "about-1content": "...เปิดให้ใช้งานได้ฟรี...@br@brเราเชื่อว่า...@br • Gmail: fantrove.official@gmail.com"
}
```

### 4.3 Regex สำหรับ Parse Markers

ระบบใช้ regex เดียวกันทั้งใน Web Worker (runtime) และ Node.js (build-time):

```javascript
const MARKER_RE_SRC =
  '(@lsvg(?::([^@]+))?@)' +    // Group 1-2:  @lsvg[:id]@
  '|(@svg(?::([^@]+))?@)' +    // Group 3-4:  @svg[:id]@
  '|(@slot:([^@]+)@)' +        // Group 5-6:  @slot:name@
  '|(@a(.*?)@)' +               // Group 7-8:  @a text@
  '|(@br)' +                   // Group 9:    @br
  '|(@strong(.*?)@)';          // Group 10-11: @strong text@
```

### 4.4 Parts Array — ผลลัพธ์จากการ Parse

การ parse จะคืน **parts array** ที่แต่ละ part เป็น object:

```javascript
// Input: "Hello @strong world@ and @br more"
// Output:
[
  { type: 'text', text: 'Hello ' },
  { type: 'strong', text: ' world' },
  { type: 'text', text: ' and ' },
  { type: 'br' },
  { type: 'text', text: ' more' }
]
```

---

## 5. FvLang — Central Language API (v5.0)

**ไฟล์:** `assets/js/lang-core.js`
**เวอร์ชัน:** v1.0.0 (ตั้งแต่ v1.5.0 ของโปรเจกต์)
**โหลด:** script แรกสุดใน `<head>` ก่อน `language.js`

FvLang เป็น **ชั้น API กลาง** ที่ resolve ภาษาแบบ synchronous ทันทีที่ script โหลด ก่อนที่ JS ระบบอื่นๆ จะทำงาน แก้ปัญหา race condition ที่ระบบต่างๆ อ่านภาษาจาก localStorage ไม่ทัน

### 5.1 บทบาทและจุดประสงค์

**ปัญหาที่แก้:**
ก่อน v5.0 ระบบ JS แต่ละตัว (home.js, new.js, version-core.js, modern-navigation.js) ต้องอ่าน `localStorage.getItem('selectedLang')` เองและฟัง `languageChange` event เอง ทำให้เกิดปัญหา:
- **Race condition ตอน first visit**: ภาษายังไม่ถูกตั้งค่า → ทุกระบบใช้ค่า default (en) ผิด
- **Switch back ไม่ update**: เปลี่ยนภาษาแล้วย้อนกลับ ระบบบางตัวไม่ re-render
- **แต่ละระบบต้องจัดการเอง**: ทำให้โค้ดซ้ำซ้อน และมีโอกาสผิดพลาด

**โมเดลใหม่ (v5.0):**
```
lang-core.js (สร้าง FvLang ทันที, sync)
  → language.js (อ่าน FvLang.lang, เรียก FvLang.setLang() เมื่อเปลี่ยน)
    → ทุก script อื่น (subscribe FvLang.onChange() หรือฟัง fv:langchange)
```

FvLang ทำหน้าที่เป็น **single source of truth** สำหรับภาษา — ทุกระบบอ่านจากที่เดียวกัน

### 5.2 Public API — `window.FvLang`

```javascript
window.FvLang = {
  _v: '1.0.0',                    // Internal version

  lang: 'th',                     // ภาษาปัจจุบัน ('en' | 'th')
  supportedLangs: ['en', 'th'],   // ภาษาที่รองรับ
  isReady: true,                  // เสมอ true (resolve แบบ sync)
  isStaticMode: false,            // true ถ้าเป็น production built page

  onChange(fn),                   // subscribe เมื่อภาษาเปลี่ยน → return unsubscribe fn
  setLang(lang, opts),            // ตั้งภาษาใหม่ + dispatch fv:langchange
  forceRefresh(),                 // dispatch fv:langchange โดยไม่เปลี่ยนภาษา (refresh ทั้งหน้า)
};
```

**`.lang`** — อ่านภาษาปัจจุบันได้ทันที ไม่ต้อง await หรือ callback:

```javascript
const lang = window.FvLang?.lang || 'en';
```

**`.onChange(fn)`** — subscribe เมื่อภาษาเปลี่ยน คืน unsubscribe function:

```javascript
const unsub = FvLang.onChange(function(newLang, previousLang) {
  // Re-render UI ตาม newLang
  renderMyComponent(newLang);
});

// ถ้าไม่ต้องการแล้ว
unsub();
```

**`.setLang(lang, opts)`** — ตั้งภาษาใหม่ ใช้โดย `language.js` เมื่อ user เลือกภาษา:

```javascript
// language.js เรียกหลัง JS translation เสร็จ
FvLang.setLang('th');
// → อัพเดท FvLang.lang = 'th'
// → เรียก subscribers ทั้งหมด
// → dispatch 'fv:langchange' event
// → sync localStorage
// → update <html lang="th">
```

`opts.silent` — ไม่ dispatch event (สำหรับ init sync):

```javascript
// language.js sync ค่าเริ่มต้นโดยไม่ trigger refresh
FvLang.setLang(initialLang, { silent: true });
```

**`.forceRefresh()`** — บังคับให้ทุกระบบ re-render โดยไม่เปลี่ยนภาษา:

```javascript
// ใช้เมื่อ dynamic content โหลดเสร็จแล้ว ต้องการให้ render ตามภาษาปัจจุบัน
FvLang.forceRefresh();
// → subscribers ถูกเรียกด้วย (currentLang, currentLang)
// → dispatch fv:langchange โดยที่ lang === previousLang (signal: refresh)
```

### 5.3 Event — `fv:langchange`

Event หลักที่ทุกระบบ JS ควรฟัง:

```javascript
window.addEventListener('fv:langchange', function(e) {
  const newLang = e.detail.lang;           // 'en' หรือ 'th'
  const previousLang = e.detail.previousLang;

  if (newLang === previousLang) {
    // forceRefresh — re-render เนื้อหาเดิม
  } else {
    // ภาษาเปลี่ยน — re-render ด้วยภาษาใหม่
  }
});
```

**ความแตกต่างจาก `languageChange` (เก่า):**

| ลักษณะ | `languageChange` (เก่า) | `fv:langchange` (v5.0) |
|---------|------------------------|------------------------|
| Dispatch โดย | `LanguageManager.updatePageLanguage()` | `FvLang.setLang()` |
| Detail key | `detail.language` | `detail.lang` |
| Previous lang | `detail.previousLanguage` | `detail.previousLang` |
| forceRefresh | ไม่รองรับ | `lang === previousLang` = refresh signal |
| Purpose | Backward compatibility | **Primary event สำหรับทุกระบบใหม่** |

### 5.4 การ Detect ภาษา (Synchronous)

FvLang detect ภาษาแบบ synchronous ทันที (ไม่มี async/await) ตาม priority:

```
Production Static Mode (data-fv-built มีค่า):
  └─ ยึด data-fv-built เป็นหลัก (เร็วสุด — ไม่ต้องอ่าน localStorage/URL)
  └─ เหตุผล: content ถูก bake เป็น builtLang แล้ว

Production (ไม่มี data-fv-built):
  └─ URL path prefix (/en/..., /th/...) → localStorage → browser detection

Development (localhost):
  └─ localStorage → browser detection (ไม่ดู URL)
```

Detect functions ภายใน:

```javascript
getBuiltLang()     // อ่าน document.documentElement.getAttribute('data-fv-built')
getUrlLang()       // match /^\/(en|th)(\/|$)/ กับ location.pathname
getStoredLang()    // localStorage.getItem('selectedLang') + validate
getBrowserLang()   // navigator.languages → split('-')[0] → match SUPPORTED
isLocalDev()       // hostname === 'localhost' || '127.0.0.1' || '0.0.0.0' || *.local
```

### 5.5 Subscriber System

ระบบ subscriber ภายใน FvLang เป็น array ของ functions:

```javascript
var _subscribers = [];

onChange: function(fn) {
  if (typeof fn !== 'function') return function() {};
  _subscribers.push(fn);
  return function() {              // unsubscribe function
    var idx = _subscribers.indexOf(fn);
    if (idx >= 0) _subscribers.splice(idx, 1);
  };
}
```

เมื่อ `setLang()` ถูกเรียก → เรียก subscribers ทั้งหมดก่อน dispatch event:
```
1. อัพเดท FvLang.lang
2. Sync localStorage
3. Update <html lang>
4. เรียก _subscribers[i](newLang, previous) ทีละตัว (try/catch แยก)
5. Dispatch window 'fv:langchange' CustomEvent
```

### 5.6 Backward Compatibility Shims

เพื่อไม่ให้ scripts เก่าที่ยังใช้ `await window.languageReady` พัง FvLang สร้าง shims:

```javascript
// สร้างทันทีหลัง FvLang object
if (!window.languageReady) {
  window.languageReady = Promise.resolve({ lang: FvLang.lang, translations: null });
}
if (!window.onLanguageReady) {
  window.onLanguageReady = function(fn) {
    if (typeof fn === 'function') {
      try { fn({ lang: FvLang.lang, translations: null }); } catch (e) {}
    }
  };
}
```

**สำคัญ:** `language.js` จะ **overwrite** เหล่านี้เมื่อโหลดเสร็จ:
- Full mode: `window.languageReady` = new Promise (รอจนกว่า translate เสร็จ)
- Static mode: `window.languageReady` = Promise.resolve ทันที

ดังนั้น shim มีผลเฉพาะตอนช่วงระหว่าง lang-core.js โหลดแล้ว แต่ language.js ยังไม่โหลด

### 5.7 การ Integrate กับระบบอื่น

ตารางสรุปการเปลี่ยนแปลงในแต่ละระบบ:

| ระบบ | ก่อน v5.0 (อ่านภาษาเอง) | v5.0 (ใช้ FvLang) |
|------|------------------------|-------------------|
| **home.js** | `localStorage.getItem('selectedLang')` | `FvLang.lang` + `FvLang.onChange(re-render)` |
| **new.js** | `localStorage.getItem('selectedLang')` + `languageChange` event | `FvLang.lang` + `fv:langchange` event |
| **version-core.js** | `localStorage.getItem('selectedLang')` | `FvLang.lang` |
| **modern-navigation.js** | `_readStoredLang()` + `languageChange` event | `_readStoredLang()` + `fv:langchange` event (backward compat: `languageChange` ยังฟัง) |
| **language.js** | detect เอง + 14 modules (static) | อ่าน FvLang.lang + 6 modules (static) |
| **manager.js** | dispatch เฉพาะ `languageChange` | เรียก `FvLang.setLang()` → `fv:langchange` + `languageChange` (backward compat) |

**ตัวอย่างการ integrate ในระบบใหม่:**

```javascript
// ✅ v5.0 — อ่านภาษา + subscribe
var lang = (window.FvLang && FvLang.lang) || 'en';

// Re-render เมื่อภาษาเปลี่ยน
if (window.FvLang) {
  FvLang.onChange(function(newLang) {
    renderContent(newLang);
  });
} else {
  // Fallback สำหรับกรณี lang-core.js ไม่โหลด
  window.addEventListener('fv:langchange', function(e) {
    if (e.detail && e.detail.lang) renderContent(e.detail.lang);
  });
}

// ❌ ก่อน v5.0 — อ่าน localStorage เอง + ฟัง languageChange
var lang = localStorage.getItem('selectedLang') || 'en';
window.addEventListener('languageChange', function(e) {
  renderContent(e.detail.language);
});
```

**Script Loading Order ใน HTML (v5.0):**

```html
<head>
  <!-- 1. lang-core.js — แรกสุด สร้าง FvLang ทันที -->
  <script src="/assets/js/lang-core.js?v=1.0.0"></script>

  <!-- 2. language.js — อ่าน FvLang, โหลด modules, setup UI -->
  <script src="/assets/js/language.js?v=1.0.0-20250322"></script>
</head>
<body>
  <!-- 3. ระบบอื่นๆ — ใช้ FvLang.lang และ FvLang.onChange() -->
  <script defer src="/assets/js/home.js?v=1.0.0-20250322"></script>
  <script defer src="/assets/js/new.js?v=1.0.0-20250322"></script>
</body>
```

---

## 6. Runtime Mode — ระบบแปลภาษาบนเบราว์เซอร์

### 6.1 Entry Point — `language.js` v5.0

ไฟล์ `assets/js/language.js` เป็น entry point ของระบบภาษาทั้งหมด ทำหน้าที่ (v5.0 — FvLang integration):

1. **อ่าน FvLang.lang** สำหรับภาษาเริ่มต้น (ไม่ detect เอง)
2. **สร้าง Gate Promise** (ใน static mode: resolve ทันที via FvLang)
3. **โหลด modules ตาม Phase** — 6 modules (static) หรือ 14 modules (full)
4. **Boot sequence** — เริ่มต้น services ทั้งหมดหลัง modules โหลดเสร็จ

```javascript
// language.js v5.0 — ใน static mode: gate resolve ทันที
// Full mode: gate รอจนกว่า initialize เสร็จ
var isStatic = !!(window.FvLang && window.FvLang.isStaticMode);
var initialLang = (window.FvLang && window.FvLang.lang) || 'en';

if (isStatic) {
  // Static mode: FvLang ให้ภาษามาแล้ว → gate resolve ทันที
  window.languageReady = Promise.resolve({ lang: initialLang, translations: null });
} else {
  // Full mode: gate รอจนกว่า initialize เสร็จ
  let _gateResolve, _gateReject;
  window.languageReady = new Promise((res, rej) => {
    _gateResolve = res;
    _gateReject  = rej;
  });
}

// Helper สำหรับ non-async code
window.onLanguageReady = function(fn) {
  if (typeof fn !== 'function') return;
  window.languageReady.then(fn).catch(function(e) {
    console.warn('[LangGate] onLanguageReady callback error:', e);
  });
};
```

**Guard ป้องกัน init ซ้ำ:**

```javascript
if (window.__langUI?._initialized) return;
```

**External scripts ใช้ระบบภาษาได้ 3 วิธี (Cooperative):**

```javascript
// T1: Promise
await window.languageReady;

// T2: Callback
window.onLanguageReady(function({ lang, translations }) { ... });

// T3: Event
window.addEventListener('languageReady', function(e) { ... });
```

### 6.2 Phase Loading System (v5.0 — Static Optimization)

Modules ถูกโหลดแบบ 3 phases โดยแต่ละ phase โหลด parallel แต่รอ phase ก่อนหน้าเสร็จก่อน:

```
Phase 1 (parallel, no deps):
  types.js  config.js  state.js  worker-pool.js  gate.js

Phase 2 (parallel, need Phase 1):
  db.js  detector.js  loader.js  markers.js  translator.js  ui.js

Phase 3 (parallel, need Phase 2):
  url.js  navigation.js  manager.js
```

```javascript
// v5.0: Static mode โหลดเฉพาะ modules ที่จำเป็น (6 ตัว แทน 14)
const FULL_PHASES = [
  ['types.js', 'config.js', 'state.js', 'worker-pool.js', 'gate.js'],
  ['db.js', 'detector.js', 'loader.js', 'markers.js', 'translator.js', 'ui.js'],
  ['url.js', 'navigation.js', 'manager.js'],
];

const STATIC_PHASES = [
  ['types.js', 'config.js', 'state.js', 'gate.js'],   // ไม่ต้อง worker-pool
  ['ui.js'],                                           // เฉพาะ UI dropdown
  ['manager.js'],                                      // orchestrator
];

const PHASES = isStatic ? STATIC_PHASES : FULL_PHASES;
```

**Boot sequence หลังโหลด modules เสร็จ:**

```javascript
function _boot() {
  // 1. init WorkerPool (lazy)
  TranslatorService.initPool();

  // 2. BroadcastChannel
  NavigationService.initBroadcastChannel();

  // 3. Script interceptor (T4) — opt-in
  if (CONFIG.SCRIPT_INTERCEPTOR) {
    _installEarlyInterceptor();
    LangGate.adoptEarlyQueue();
  }

  // 4. เริ่ม prefetch config ทันที
  State._prefetchPromise = LoaderService.prefetchEnterprise();

  // 5. Initialize เมื่อ DOM พร้อม
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => LanguageManager.initialize());
  } else {
    LanguageManager.initialize();
  }

  // Public API
  window.languageManager = LanguageManager;
  window.__langUI = { _initialized: true };
}
```

### 6.3 LangGate — ระบบ Gate

**ไฟล์:** `lang-modules/gate.js`

LangGate คือระบบที่ **บล็อก JS อื่นๆ** จนกว่าระบบภาษาจะพร้อม รองรับทั้ง cooperative และ non-cooperative blocking:

#### เทคนิคที่รองรับ

| เทคนิค | ระดับ | คำอธิบาย |
|--------|-------|----------|
| **T1** | Cooperative | `await window.languageReady` — Promise |
| **T2** | Cooperative | `window.onLanguageReady(fn)` — Callback |
| **T3** | Cooperative | `addEventListener('languageReady', fn)` — Event |
| **T4** | Non-cooperative | Script Interceptor — ดักจับ `<script>` inject เข้า DOM |
| **T5** | Non-cooperative | `guardProperty(window, 'myApp')` — defineProperty trap |

#### ลำดับการ Resolve Gate

เมื่อ `LanguageManager.initialize()` เสร็จสมบูรณ์:

```
1. Resolve window.languageReady Promise      (T1)
2. Flush script queue (T4) — รัน scripts ที่ถูก queue ไว้
3. Release defineProperty guards              (T5)
4. Dispatch 'languageReady' CustomEvent      (T3)
```

```javascript
resolve(info) {
  // T1
  if (M._gateResolve) {
    try { M._gateResolve(info); } catch (e) {}
    M._gateResolve = null;
    M._gateReject  = null;
  }
  // T4
  _releaseScripts();
  // T5
  _releaseGuards();
  // T3
  try {
    window.dispatchEvent(new CustomEvent('languageReady', {
      detail: info,
      bubbles: false,
      cancelable: false,
    }));
  } catch (e) {}
}
```

#### Script Interceptor (T4)

เปิดใช้งานด้วย `CONFIG.SCRIPT_INTERCEPTOR = true` (default: `false`):

```javascript
// ดักจับ Node.prototype.appendChild และ insertBefore
Node.prototype.appendChild = function(node) {
  if (_earlyActive && _earlyShould(node)) {
    _earlyQueue.push({ fn: _origAppend, parent: this, node, ref: null });
    return node;
  }
  return _origAppend.call(this, node);
};
```

**Opt-out per-script:**
- `data-lang-internal` — scripts ของระบบเอง (ใส่โดย `loadScript` อัตโนมัติ)
- `data-lang-nowait` — script ไม่ถูก queue เลย

#### defineProperty Guard (T5)

```javascript
// ป้องกัน property จนกว่า gate จะ resolve
LangGate.guardProperty(window, 'dataLayer');

// ก่อน gate เปิด: window.dataLayer === undefined
// หลัง gate เปิด: property ทำงานปกติ
```

### 6.4 Config (`config.js`)

**ไฟล์:** `lang-modules/config.js`

ค่าคงที่ทั้งหมดของระบบ ใช้ `Object.freeze()` — ไม่มีการเปลี่ยนแปลง runtime:

```javascript
const CONFIG = Object.freeze({
  // Language settings
  SUPPORTED_LANGS: ['en', 'th'],
  DEFAULT_LANG: 'en',
  LS_KEY: 'selectedLang',
  CFG_CACHE_KEY: '__lang_cfg',

  // URLs
  DB_JSON_URL: '/assets/lang/options/db.json',
  LANG_JSON_URL: (lang) => `/assets/lang/${lang}.json`,

  // Preconnect
  PRECONNECT_URLS: ['//cdn.jsdelivr.net', '//fonts.googleapis.com'],

  // UI
  FADE_DURATION: 300,

  // IndexedDB
  DB_NAME: 'LanguageCacheDB_v3',
  DB_STORE: 'langs',
  DB_META: 'meta',
  DB_VERSION: 4,

  // Gate (v4.1)
  SCRIPT_INTERCEPTOR: false,  // default: safe mode
});
```

### 6.5 State (`state.js`)

**ไฟล์:** `lang-modules/state.js`

State object เดียวที่ shared ระหว่างทุก module แต่ละฟิลด์มี **owner service** ที่ระบุไว้:

```javascript
const State = {
  // Data — [LoaderService]
  languagesConfig: {},       // config จาก db.json
  languageCache: {},         // { 'th': { key: 'translated text', ... } }

  // Language state — [LanguageManager]
  selectedLang: '',          // ภาษาที่ใช้อยู่ตอนนี้
  lastSelectedLang: '',      // ภาษาก่อนหน้า
  _userExplicitLang: null,   // ภาษาที่ user กดเลือกเอง (override URL)

  // Flags — [LanguageManager]
  isUpdatingLanguage: false, // mutex ป้องกัน concurrent update
  isInitialized: false,

  // Worker & Channel — [TranslatorService / NavigationService]
  workerPool: null,
  _bc: null,                 // BroadcastChannel instance
  _prefetchPromise: null,
  maxWorker: ...,            // Math.max(4, Math.floor(cores * 0.9))

  // Observer — [TranslatorService]
  mutationObserver: null,
  mutationThrottleTimeout: null,

  // UI state — [UIService]
  // v6.0: popup ภาษาใช้ PopupSystem แล้ว — เก็บเฉพาะ button ref
  languageButton: null,
};
```

### 6.6 DetectorService — การตรวจจับภาษา

**ไฟล์:** `lang-modules/detector.js`

#### `isLocalDev()`
ตรวจสอบว่าเป็น localhost หรือไม่ — ถ้าใช่ จะข้ามทุกอย่างที่เกี่ยวกับ URL prefix:

```javascript
isLocalDev() {
  const host = location.hostname || '';
  return host === 'localhost' || host === '127.0.0.1' ||
         host === '0.0.0.0'   || host.endsWith('.local');
}
```

#### `_getNavType()`
อ่านประเภทของ navigation ที่พามาถึงหน้านี้:

```javascript
// 'navigate'     → พิมพ์ URL เอง / คลิก link / เปิด bookmark
// 'back_forward' → กด Back หรือ Forward
// 'reload'       → กด Refresh
// 'prerender'    → browser pre-render
```

ใช้ **Navigation Timing API Level 2** เป็น primary และ Level 1 (deprecated) เป็น fallback

#### `resolveCurrentLang()`
ตัดสินใจภาษาตาม priority ที่ขึ้นกับ navType:

```
localhost:
  storage > browser (ไม่ดู URL)

navigate / prerender:
  URL > storage > browser

back_forward / reload:
  storage > URL > browser
  (เหตุผล: user เพิ่งเปลี่ยนภาษาในหน้าอื่น)
```

คืนค่า `LangDecision`:
```javascript
{ lang: 'th', source: 'url' }       // หรือ 'storage' | 'browser'
```

### 6.7 LoaderService — การโหลดข้อมูล

**ไฟล์:** `lang-modules/loader.js`

#### Cache Hierarchy (เร็ว → ช้า)

```
1. Memory (State.languageCache)     — ไม่ persist
2. IndexedDB (DBService)            — persist ข้าม session
3. Network fetch                    — ช้าที่สุด
```

#### `prefetchEnterprise()`
เริ่ม preconnect, preload, และโหลด db.json **ทันทีก่อน DOM ready**:

```javascript
async prefetchEnterprise() {
  // Preconnect CDN domains
  for (const href of CONFIG.PRECONNECT_URLS) { ... }

  // Preload db.json
  const preload = document.createElement('link');
  preload.rel = 'preload';
  preload.as = 'fetch';
  preload.href = CONFIG.DB_JSON_URL;

  // ลองอ่าน config cache (fast path)
  let config = _readConfigCache(CONFIG);

  // Fetch ใหม่เสมอ (no-cache = เช็ค server update)
  const resp = await fetch(CONFIG.DB_JSON_URL, { cache: 'no-cache' });
  if (resp.ok) {
    config = await resp.json();
    _writeConfigCache(CONFIG, config);
  }

  State.languagesConfig = config;
}
```

#### `loadLanguageData(lang)`

```javascript
async loadLanguageData(lang) {
  // 1. Memory cache (fastest)
  if (State.languageCache[lang]) return State.languageCache[lang];

  // 2. IndexedDB cache (verify version)
  const [record] = await DBService.getCacheBatch([lang]);
  if (_isCacheValid(record, expectedVersion)) {
    State.languageCache[lang] = record.data;
    return record.data;
  }

  // 3. Network fetch
  const resp = await fetch(CONFIG.LANG_JSON_URL(lang), { cache: 'no-cache' });
  const raw = await resp.json();
  const flattened = this.flattenLanguageJson(raw);

  // Save to IDB (fire and forget)
  DBService.setCacheBatch([{ langKey: lang, data: flattened, version }]);

  State.languageCache[lang] = flattened;
  return flattened;
}
```

#### Version-based Cache Invalidation

ถ้า `db.json` ประกาศ `{ en: { version: "2" } }` และ IDB cache เก็บ version `"1"` ไว้ → re-fetch อัตโนมัติ:

```javascript
function _isCacheValid(record, expectedVersion) {
  if (!record || !record.data) return false;
  if (expectedVersion !== null && record.version !== expectedVersion) return false;
  return true;
}
```

#### `flattenLanguageJson()` — Iterative Stack-safe Flattening

```javascript
flattenLanguageJson(json) {
  const result = {};
  const stack = [json];

  while (stack.length) {
    const obj = stack.pop();
    for (const [k, v] of Object.entries(obj)) {
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        stack.push(v);        // ลงลึกต่อ
      } else {
        result[k] = v;        // leaf node
      }
    }
  }
  return result;
}
```

### 6.8 TranslatorService — เครื่องมือแปลภาษา

**ไฟล์:** `lang-modules/translator.js`

นี่คือหัวใจของระบบแปล ใช้ **Web Worker Pool** สำหรับ parse markers แบบ parallel

#### Web Worker Source Code

Worker code ถูกฝังเป็น string ใน `WORKER_CODE` constant:

```javascript
const WORKER_CODE = `
  const HTML_TAG_RE   = /(<\\/?[^>]+>)/;
  const MARKER_RE_SRC =
    '(@lsvg(?::([^@]+))?@)' +
    '|(@svg(?::([^@]+))?@)' +
    '|(@slot:([^@]+)@)' +
    '|(@a(.*?)@)' +
    '|(@br)' +
    '|(@strong(.*?)@)';

  function splitMarkersAndHtml(str) {
    const htmlParts = str.split(HTML_TAG_RE);
    const parts = [];
    const markerRegex = new RegExp(MARKER_RE_SRC, 'g');

    for (const segment of htmlParts) {
      // ... parse each segment for markers
    }
    return parts;
  }

  self.onmessage = function(e) {
    const { nodes, langData, batchIdx } = e.data;
    const result = nodes.map(({ key }, idx) => ({
      idx,
      parts: splitMarkersAndHtml(langData[key] || ''),
    }));
    self.postMessage({ batchIdx, result });
  };
`;
```

#### `parallelStreamingTranslate()` — Parallel Batch Translation

```javascript
async parallelStreamingTranslate(languageData, elements) {
  const elList = elements || Array.from(document.querySelectorAll('[data-translate]'));

  const chunkSize = Math.max(8, Math.ceil(elList.length / State.maxWorker));
  const batches = [];

  for (let i = 0; i < elList.length; i += chunkSize) {
    batches.push(elList.slice(i, i + chunkSize));
  }

  // ส่งทุก batch ไป worker พร้อมกัน
  const jobs = nodeMeta.map((meta, i) =>
    State.workerPool.execute({ nodes: meta, langData, batchIdx: i })
  );
  const results = await Promise.all(jobs);

  // อัพเดท DOM จากผลลัพธ์
  for (let j = 0; j < results.length; j++) {
    for (const item of results[j].result) {
      this._replaceDOMWithMarkerReplace(el, item.parts);
    }
  }
}
```

#### `_replaceDOMWithMarkerReplace()` — Pipeline 4 ขั้นตอน

```
┌─────────────────────────────────────────────┐
│  _replaceDOMWithMarkerReplace(el, parts)    │  ← entry point
│   │                                         │
│   ├─ _normalizeParts(parts)                 │  merge text+html buffers
│   ├─ _buildRefs(el)                         │  สร้าง resolver closures
│   ├─ _partsToPreNodes(normalized)           │  part → pre-node
│   └─ _reconcile(el, preNodes, refs)         │  DOM diff + update
└─────────────────────────────────────────────┘
```

**1. `_normalizeParts()`** — รวม text/html parts ติดกัน:

```javascript
// [text:"Hello ", html:"<em>", text:"world"]
// → [html:"Hello <em>world"]
```

**2. `_buildRefs()`** — สร้าง resolver functions:

```javascript
function _buildRefs(el) {
  const svgs    = Array.from(el.querySelectorAll('svg'));
  const slots   = Array.from(el.querySelectorAll('[data-translate-slot],[data-slot]'));
  const anchors = Array.from(el.querySelectorAll('a'));

  return {
    svgs, slots, anchors,
    existing: Array.from(el.childNodes),
    resolveSvg(id) { /* หา SVG ที่ยังไม่ถูกใช้ */ },
    resolveSlot(name) { /* หา slot ที่ยังไม่ถูกใช้ */ },
    resolveAnchor(hint) { /* หา anchor ที่ยังไม่ถูกใช้ */ },
  };
}
```

**3. `_partsToPreNodes()`** — แปลง parts เป็น pre-nodes:

- **Simple types** (text, br, strong, html) → สร้าง DOM node ทันที
- **Complex types** (svg, lsvg, slot, a) → เก็บเป็น marker object รอ resolve ใน reconcile

**4. `_reconcile()`** — อัพเดท DOM ด้วย strategy:

- Reuse node เดิมถ้า type ตรงกัน (avoid createElement/removeChild)
- Patch in-place ถ้า tag เดิมตรงกัน
- Skip SVG และ slot ที่ยังไม่ถูกอ้างถึง (preserve)
- ไม่ลบ SVG/slot ที่ไม่ได้ใช้ (preserve ไว้)

#### `storeOriginalContent()` — บันทึกค่าเดิม

```javascript
storeOriginalContent() {
  document.querySelectorAll('[data-translate]').forEach(el => {
    if (!el.hasAttribute('data-original-text'))
      el.setAttribute('data-original-text', el.textContent.trim());
    if (!el.hasAttribute('data-original-style'))
      el.setAttribute('data-original-style', el.style.cssText);
  });
}
```

#### `observeMutations()` — แปล dynamic content อัตโนมัติ

```javascript
observeMutations() {
  State.mutationObserver = new MutationObserver((mutations) => {
    // Throttled 100ms
    // ตรวจ addedNodes ที่มี [data-translate] → แปลอัตโนมัติ
    // ถ้า selectedLang !== 'en'
  });
  State.mutationObserver.observe(document.body, { childList: true, subtree: true });
}
```

### 6.9 MarkerRegistry — ระบบ Registry

**ไฟล์:** `lang-modules/markers.js`

ระบบ extensible registry ที่ให้เพิ่ม marker type ใหม่ได้โดยไม่ต้องแก้ translator.js:

#### Built-in Handlers

```javascript
// text
MarkerRegistry.register('text', {
  createNode: (part) => document.createTextNode(part.text || ''),
});

// br
MarkerRegistry.register('br', {
  createNode: () => document.createElement('br'),
});

// strong
MarkerRegistry.register('strong', {
  createNode: (part) => {
    const el = document.createElement('strong');
    el.textContent = part.text || '';
    return el;
  },
});

// a — reuse anchor เดิม ถ้ามี
MarkerRegistry.register('a', {
  createNode: (part, refs) => {
    const existing = refs.resolveAnchor(null);
    if (existing) {
      if (part.translate && part.text != null) existing.textContent = part.text;
      return existing;
    }
    const a = document.createElement('a');
    if (part.translate) a.textContent = part.text || '';
    return a;
  },
});

// svg + lsvg — reuse existing SVG
const svgHandler = {
  createNode: (part, refs) => refs.resolveSvg(part.id) || _createEmptySvg(part.id),
};
MarkerRegistry.register('svg', svgHandler);
MarkerRegistry.register('lsvg', svgHandler);

// slot — reuse existing slot
MarkerRegistry.register('slot', {
  createNode: (part, refs) => {
    const existing = refs.resolveSlot(part.name);
    if (existing) return existing;
    const span = document.createElement('span');
    span.setAttribute('data-translate-slot', part.name || 'slot');
    return span;
  },
});
```

#### วิธีเพิ่ม Custom Marker

```javascript
// 1. เพิ่ม pattern ใน WORKER_CODE
// 2. เพิ่ม capture group handling ใน worker
// 3. Register handler:
MarkerRegistry.register('icon', {
  createNode: (part, refs) => {
    const i = document.createElement('i');
    i.className = `icon-${part.id}`;
    return i;
  },
});
```

### 6.10 URLService — จัดการ URL

**ไฟล์:** `lang-modules/url.js`

ใช้ `history.replaceState()` — ไม่สร้าง history entry ใหม่:

```javascript
updateURLForLanguage(lang) {
  if (DetectorService.isLocalDev()) return;  // localhost ไม่ยุ่งกับ URL

  const currentPath = location.pathname;
  const currentLang = DetectorService.getLangFromURL();

  if (currentLang === lang) return;  // ตรงอยู่แล้ว

  let newPath;
  if (currentLang) {
    // แทนที่ prefix: /en/path → /th/path
    newPath = currentPath.replace(/^\/(en|th)(\/|$)/, '/' + lang + '$2');
  } else {
    // เพิ่ม prefix: /path → /th/path
    newPath = '/' + lang + (currentPath === '/' ? '' : currentPath);
  }

  const newURL = newPath + location.search + location.hash;
  history.replaceState({ lang, ts: Date.now() }, '', newURL);
}
```

### 6.11 NavigationService — การนำทางและ Sync

**ไฟล์:** `lang-modules/navigation.js`

#### BroadcastChannel — Cross-Tab Sync

```javascript
initBroadcastChannel() {
  State._bc = new BroadcastChannel('fv-lang-v3');
  State._bc.onmessage = (ev) => this._onBroadcastLang(ev.data);
}

_onBroadcastLang(msg) {
  // { lang, url, ts }
  // ถ้าภาษาต่างจาก tab นี้ → sync ให้ตรงกัน
  // update URL ถ้าจำเป็น
  // เรียก updatePageLanguage()
}
```

#### Event Handlers

**`pageshow`** — BFCache Restoration Fix:

```javascript
_setupPageshow() {
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;  // โหลดปกติ, initialize() จัดการแล้ว

    // หน้ามาจาก bfcache → ตรวจ localStorage ใหม่
    const storedLang = DetectorService.getLangFromStorage();
    if (storedLang !== State.selectedLang) {
      // user เปลี่ยนภาษาในหน้าอื่น → sync
      State._userExplicitLang = storedLang;
      LanguageManager.updatePageLanguage(storedLang, true);
    }
  });
}
```

**`popstate`** — SPA Back/Forward:

```javascript
_setupPopstate() {
  window.addEventListener('popstate', async (event) => {
    // ยึด user preference (_userExplicitLang หรือ localStorage) เสมอ
    // ไม่ยึดตาม URL prefix ของหน้าเก่า
    const preferredLang = State._userExplicitLang || DetectorService.getLangFromStorage();
    if (preferredLang !== State.selectedLang) {
      await LanguageManager.updatePageLanguage(preferredLang, true);
    }
  });
}
```

**`storage`** — Cross-Tab localStorage Sync:

```javascript
_setupStorage() {
  window.addEventListener('storage', (e) => {
    if (e.key !== CONFIG.LS_KEY) return;
    // tab อื่นเปลี่ยนภาษา → sync ให้ตรง
    if (e.newValue !== State.selectedLang) {
      LanguageManager.updatePageLanguage(e.newValue, false);
    }
  });
}
```

**`visibilitychange`** — กลับมาที่ Tab:

```javascript
_setupVisibilityChange() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    // ตรวจ sync เมื่อ user กลับมาที่ tab นี้
    const preferredLang = State._userExplicitLang || DetectorService.getLangFromStorage();
    if (preferredLang !== State.selectedLang) {
      LanguageManager.updatePageLanguage(preferredLang, true);
    }
  });
}
```

### 6.12 UIService — UI ตัวเลือกภาษา

**ไฟล์:** `lang-modules/ui.js`

#### โครงสร้าง UI

```
#language-button
├── .lang-btn-flex
│   ├── .lang-btn-svg (icon)
│   └── .lang-btn-txt[data-lang="en"] (hidden/shown)
│   └── .lang-btn-txt[data-lang="th"] (hidden/shown)
│
v6.0: popup ภาษาใช้ PopupSystem.open() แล้ว — ไม่สร้าง DOM เอง
Popup ถูกสร้างแบบ dynamic เมื่อเปิด ผ่าน PopupSystem dialog:
  - .fv-lang-option[data-language="en|th"] — option items ภายใน popup body
```

#### วิธีทำงาน

- `prepareAllButtonTexts()` — สร้าง text spans สำหรับแต่ละภาษา
- `showButtonTextForLang(lang)` — แสดง text ของภาษาที่ active
- `openLanguagePopup()` — เปิด popup เลือกภาษา via PopupSystem.open()
- `closeLanguagePopup()` — ปิด popup ภาษา (PopupSystem จัดการ cleanup)
- `_attachButtonHandler()` — ผูก click handler ให้ #language-button
- `showError(message)` — แสดง toast ผ่าน PopupSystem.toast() (fallback: inline div)

### 6.13 LanguageManager — Orchestrator หลัก (v5.0)

**ไฟล์:** `lang-modules/manager.js`

LanguageManager เป็นตัวประสานงานที่รวมทุก service เข้าด้วยกัน

#### `initialize()` — จุดเริ่มต้น

```javascript
async initialize() {
  // Guard: ไม่ init ซ้ำ
  if (State.isInitialized) {
    LangGate?.resolve({ lang: State.selectedLang, translations: ... });
    return;
  }

  // v4.2: ตรวจสอบ static mode
  const builtLang = document.documentElement.dataset?.fvBuilt;
  if (builtLang) {
    await this._initializeStaticMode(builtLang);
    return;
  }

  // Normal mode (dev + production without pre-build)
  await this._initializeFullMode();
}
```

#### `_initializeFullMode()` — Full Mode

```javascript
async _initializeFullMode() {
  // 1. Cleanup reload markers
  // 2. Load languages config
  await LoaderService.loadLanguagesConfig();

  // 3. Prepare UI
  await UIService.prepareAllButtonTexts();

  // 4. Handle initial language detection
  await this._handleInitialLanguage();

  // 5. Setup language popup trigger
  UIService.updateLanguageSelectorUI();

  // 6. Observe DOM mutations
  TranslatorService.observeMutations();

  // 7. Setup navigation handlers
  NavigationService.setupHandlers();

  // 8. Fade in body
  document.body.style.opacity = '1';

  // 9. Resolve gate
  LangGate.resolve({ lang, translations });
}
```

#### `_handleInitialLanguage()` — การตัดสินใจภาษาเริ่มต้น

```javascript
async _handleInitialLanguage() {
  TranslatorService.storeOriginalContent();

  const decision = DetectorService.resolveCurrentLang();
  State.selectedLang = decision.lang;

  // ถ้ามาจาก storage/browser → อัพเดท URL ให้ตรง
  if (decision.source === 'storage' || decision.source === 'browser') {
    URLService.updateURLForLanguage(State.selectedLang);
  }

  // ถ้ามาจาก URL → บันทึกลง storage
  if (decision.source === 'url') {
    localStorage.setItem(CONFIG.LS_KEY, State.selectedLang);
  }

  // ถ้าไม่ใช่ English หรือ English มาจาก JSON → แปลทันที
  if (State.selectedLang !== 'en' || LoaderService.getEnSource() === 'json') {
    await this.updatePageLanguage(State.selectedLang, false);
  }
}
```

#### `selectLanguage(language)` — User เลือกภาษา

```javascript
async selectLanguage(language) {
  // Static mode → redirect ไปหน้าภาษาอื่น
  if (document.documentElement.dataset?.fvBuilt) {
    localStorage.setItem(CONFIG.LS_KEY, language);
    const newUrl = _buildStaticLangUrl(language);
    window.location.replace(newUrl);  // ไม่เพิ่ม history entry
    return;
  }

  // Full mode → JS translation
  State._userExplicitLang = language;
  URLService.updateURLForLanguage(language);
  await this.updatePageLanguage(language, false);
  UIService.closeLanguagePopup();
}
```

#### `updatePageLanguage(language, shouldUpdateURL)` — อัพเดทภาษาทั้งหน้า

```javascript
async updatePageLanguage(language, shouldUpdateURL = true) {
  if (State.isUpdatingLanguage) return;  // mutex

  try {
    State.isUpdatingLanguage = true;
    State.lastSelectedLang = State.selectedLang;

    // 1. อัพเดท URL
    if (shouldUpdateURL) URLService.updateURLForLanguage(language);

    // 2. บันทึก preference
    localStorage.setItem(CONFIG.LS_KEY, language);

    // 3. อัพเดท <html lang="...">
    document.documentElement.setAttribute('lang', language);

    // 4. Google Translate auto-translate handling
    if (language === browserLang) {
      document.documentElement.setAttribute('translate', 'no');
      // เพิ่ม <meta name="google" content="notranslate">
    }

    // 5. Translate or reset
    if (language === 'en') {
      await TranslatorService.resetToEnglishContent();
    } else {
      const data = await LoaderService.loadLanguageData(language);
      if (data) await TranslatorService.parallelStreamingTranslate(data);
    }

    // 6. อัพเดท state + UI
    State.selectedLang = language;
    UIService.showButtonTextForLang(language);

    // 7. BroadcastChannel → sync กับ tabs อื่น
    State._bc.postMessage({ lang: language, url: location.href, ts: Date.now() });

    // 8. v5.0: FvLang → ทุกระบบ refresh
    if (window.FvLang) {
      FvLang.setLang(language);
      // FvLang.setLang() dispatch 'fv:langchange' + เรียก subscribers
    }

    // 9. Dispatch 'languageChange' สำหรับ backward compat
    window.dispatchEvent(new CustomEvent('languageChange', {
      detail: { language, previousLanguage: State.lastSelectedLang }
    }));

  } finally {
    State.isUpdatingLanguage = false;
  }
}
```

---

## 7. `lang-proxy.js` — URL Language Proxy

**ไฟล์:** `assets/js/lang-proxy.js`
**Version:** v2.2

ไฟล์นี้ **ทำงานก่อน DOM โหลด** (ใส่ใน `<head>`) ทำหน้าที่เป็น URL redirect proxy:

### พฤติกรรมหลัก

```
localhost → ปิดตัวเองทันที ไม่ทำอะไรเลย

URL มี prefix /en/ หรือ /th/:
  └─ มี conflict กับ storedLang:
      ├─ back_forward / reload → ยึด storedLang, redirect ให้
      └─ navigate / prerender  → trust URL, อัพเดท localStorage
  └─ ไม่มี conflict → sync ลง localStorage ปล่อยให้โหลด

URL ไม่มี prefix:
  └─ redirect ไปหน้าที่มี prefix ทันที
      (Priority: localStorage > browser detection > default)
```

### การตรวจจับ Navigation Type

```javascript
function getNavType() {
  // Primary: Navigation Timing API Level 2
  const entries = performance.getEntriesByType('navigation');
  if (entries?.length > 0 && entries[0].type) {
    return entries[0].type;
  }
  // Fallback: Navigation Timing Level 1 (deprecated)
  if (performance?.navigation) {
    switch (performance.navigation.type) {
      case 0: return 'navigate';
      case 1: return 'reload';
      case 2: return 'back_forward';
    }
  }
  return 'navigate';
}
```

### Reload Marker — ป้องกัน redirect loop

```javascript
// สร้าง marker ที่ไม่ซ้ำกันสำหรับแต่ละ redirect
function setReloadMarker(source) {
  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  const marker = { id, ts: Date.now(), source };
  sessionStorage.setItem('fv-forcereload', JSON.stringify(marker));
  return marker;
}
```

### Session Storage Keys ที่ใช้

| Key | หน้าที่ |
|-----|---------|
| `fv-forcereload` | Reload marker (prevents redirect loops) |
| `fv-reload-inflight` | Marker ID ของ redirect ที่กำลังดำเนินการ |
| `fv-reload-ack` | Acknowledge ว่า redirect เสร็จแล้ว |
| `fv-nav-lang-map` | Map ของ URL → language + timestamp + source |

---

## 8. `lang-links.js` — Smart Link Prefix Manager

**ไฟล์:** `assets/js/lang-links.js`
**Version:** v2.2

### หน้าที่

1. **อัพเดทลิงก์ทั้งหมด** ให้มี prefix ภาษาตามที่เลือก
2. **Intercept การคลิกลิงก์** — ถ้า prefix ผิด ให้แก้ก่อน navigate
3. **ไม่แตะต้อง** ลิงก์ภายนอก, `mailto:`, `tel:`, assets, APIs

### Paths ที่ไม่ใส่ prefix

```javascript
const SKIP_PATHS = [
  '/assets/', '/static/', '/api/', '/_next/',
  '/favicon.ico', '/robots.txt', '/sitemap.xml',
  '/sw.js', '/manifest.json', '/.well-known/'
];

const SKIP_SCHEMES = /^(mailto:|tel:|javascript:|data:|#|blob:|file:)/i;
```

### Interceptor — ใช้ `location.replace()` ไม่ใช่ `pushState()`

```javascript
// v2.2 FIX: ใช้ location.replace() แทน pushState()
// เหตุผล: interceptor ทำงานเฉพาะเมื่อ prefix ผิด
// ถือเป็น "correction" ไม่ใช่ "navigation ใหม่"
// → กด Back จะออกจากหน้าปัจจุบันจริงๆ ไม่วนกลับมาภาษาเดิม

document.addEventListener('click', function(e) {
  const link = e.target.closest('a[href]');
  const urlLang = (url.pathname.match(/^\/(en|th)(\/|$)/) || [])[1];

  if (urlLang === currentLang) return;  // prefix ถูกแล้ว → browser จัดการปกติ

  // prefix ผิด → แก้แล้ว replace navigate
  e.preventDefault();
  const newHref = setLangPrefix(href, currentLang);
  window.location.replace(newHref);
}, true); // capture phase
```

### MutationObserver — อัพเดท dynamic links

```javascript
const observer = new MutationObserver((mutations) => {
  const currentLang = getCurrentLang();
  mutations.forEach(mutation => {
    mutation.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        updateAllLinks(node, currentLang);
      }
    });
  });
});
observer.observe(document.body, { childList: true, subtree: true });
```

### ฟัง Event `languageChange`

```javascript
window.addEventListener('languageChange', function(e) {
  if (e.detail && e.detail.language) {
    updateAllLinks(document, e.detail.language);
  }
});
```

---

## 9. Pre-built Static Mode (v5.0)

เมื่อ build script สร้าง static HTML แล้ว จะ inject 2 สิ่งเข้าไปใน HTML:

### 9.1 `data-fv-built` attribute

```html
<html lang="th" data-fv-built="th">
```

Attribute นี้เป็น **signal** ให้ `language.js` เข้า static mode

### 9.2 `window.__fvStaticConfig` Inline Script

```html
<head>
  <script>window.__fvStaticConfig={"lang":"th","langs":{"en":{"buttonText":"Language: 🇬🇧 English","label":"🇬🇧 English"},"th":{"buttonText":"ภาษา: 🇹🇭 ไทย","label":"🇹🇭 ไทย"}}};</script>
  <!-- ... -->
  <script src="/assets/js/language.js"></script>
</head>
```

### 9.3 Static Mode Initialization

```javascript
// v5.0: language.js จัดการ static boot ใน _bootStatic()
// manager.js.initialize() จะ return ทันทีถ้า FvLang.isStaticMode
async _initializeStaticMode(builtLang) {
  // v5.0: FvLang ให้ภาษามาแล้ว → gate resolve ทันที
  // โหลดเฉพระ ui.js + manager.js (6 modules แทน 14)
  State.isInitialized = true;
  return;
}
```

### 9.4 สิ่งที่ Static Mode **ไม่ทำ**

- ✗ ไม่ fetch `db.json` หรือ `{lang}.json`
- ✗ ไม่สร้าง WorkerPool
- ✗ ไม่ setup BroadcastChannel
- ✗ ไม่รัน `parallelStreamingTranslate()`
- ✗ ไม่ setup MutationObserver
- ✗ ไม่โหลด translator.js, detector.js, loader.js, markers.js, db.js, worker-pool.js (v5.0)

### 9.5 เปลี่ยนภาษาใน Static Mode

เมื่อ user เลือกภาษาใหม่ → ใช้ `location.replace()` ไปหน้าภาษาอื่น (ไม่ใช่ JS translate):

```javascript
if (document.documentElement.dataset?.fvBuilt) {
  localStorage.setItem(CONFIG.LS_KEY, language);
  const newUrl = _buildStaticLangUrl(language);
  window.location.replace(newUrl);  // /en/home/ → /th/home/
  return;
}
```

---

## 10. Build System

### 10.1 `build.js` — Production Build Orchestrator

**ไฟล์:** `scripts/build.js`

Build script สร้าง static HTML สำหรับแต่ละภาษาจาก source HTML + translation JSON

#### สิ่งที่ทำ

```
1. อ่าน db.json เพื่อรู้จำนวนภาษาและ config
2. โหลด translation JSON ของแต่ละภาษา
3. หาไฟล์ HTML ทุกไฟล์ใน project
4. สำหรับแต่ละ HTML × ภาษา:
     - แปลง [data-translate] → text จริง
     - ลบ data-translate + data-original-* attrs
     - ลบ scripts ที่ไม่จำเป็น
     - ลบ body opacity:0
     - เพิ่ม hreflang + canonical สำหรับ SEO
     - Prefix internal links ด้วย /lang
     - Inject footer template (translated)
     - บันทึกไปที่ dist/{lang}/{path}
5. Copy assets/ ไปที่ dist/assets/
6. สร้าง _redirects สำหรับ Cloudflare Pages
7. Generate sitemap.xml
8. Copy static files (robots.txt, _headers, etc.)
```

#### Usage

```bash
node scripts/build.js             # normal build
node scripts/build.js --dry-run   # show what would be built
node scripts/build.js --verbose   # show per-element details
```

#### Build Configuration

```javascript
const CONFIG = {
  srcDir: '.',
  distDir: 'dist',
  assetsDir: 'assets',
  dbJsonPath: 'assets/lang/options/db.json',
  translationPath: (lang) => `assets/lang/${lang}.json`,
  defaultLang: 'en',
  baseUrl: 'https://fantrove.pages.dev',
  excludeDirs: ['dist', 'node_modules', '.git', 'scripts', '.cloudflare', 'google6b646fa60e0f9f2f.html'],

  // Scripts ที่ลบออกจาก built pages
  removeScriptPatterns: ['lang-proxy.js', 'lang-sync.js', 'lang-coordinator.js'],

  // Static files คัดลอกตรงไป dist/
  staticFiles: ['robots.txt', 'sitemap.xml', '_headers', 'fantrove-console-bridge.js', 'google6b646fa60e0f9f2f.html'],

  // Footer template
  footerTemplatePath: 'assets/template-html/footer-template.html',
};
```

#### English Source Handling

```javascript
// ถ้า db.json ระบุ en.enSource !== 'json'
// → เนื้อหาอังกฤษอยู่ใน HTML แล้ว ไม่ต้อง fetch JSON
const isDefaultWithHtmlSource =
  lang === CONFIG.defaultLang &&
  !Object.keys(translations[lang]).length &&
  dbJson[lang]?.enSource !== 'json';
```

#### `_redirects` Generation

สร้าง Cloudflare Pages `_redirects` file:

```
# Root → default language
/ /en/home/ 302
/index.html /en/home/ 302

# Language root → home
/en  /en/home/ 302
/th  /th/home/ 302

# Language-specific pages (static HTML rewrite)
/en/* /en/:splat 200
/th/* /th/:splat 200

# Static assets
/assets/*    /assets/:splat    200
/favicon.ico /assets/images/fantrove-verse360.ico 200

# Fallback
/* /en/home/ 404
```

### 10.2 `html-transformer.js` — การแปลง HTML

**ไฟล์:** `scripts/lib/html-transformer.js`
**Version:** v2.1

ใช้ **cheerio** ในการ parse และ transform HTML

#### `transformHtml()` — 9 ขั้นตอน

```javascript
function transformHtml(html, lang, translations, srcFilePath, dbJson) {
  const $ = cheerio.load(html, { decodeEntities: false, xmlMode: false });

  // 1. <html> attributes — เพิ่ม lang + data-fv-built
  $('html').attr('lang', lang).attr('data-fv-built', lang);

  // 2. Inject window.__fvStaticConfig
  $('head').prepend(`<script>window.__fvStaticConfig=${JSON.stringify(staticConfig)};</script>\n`);

  // 3. Translate [data-translate] elements
  $('[data-translate]').each((_, el) => {
    const key = $el.attr('data-translate');
    if (key && translations[key]) {
      const parts = normalizeParts(parseTranslation(translations[key]));
      $el.html(_partsToHtml($, $el, parts));
    }
    // Strip attrs — content ถูก bake ลง HTML แล้ว
    $el.removeAttr('data-translate')
       .removeAttr('data-original-text')
       .removeAttr('data-original-style')
       .removeAttr('data-translate-slot');
  });

  // 4. Translate <title data-translate="...">
  // 5. Remove unneeded scripts
  // 6. Remove body opacity:0
  // 7. Inject SEO hreflang + canonical tags
  // 8. Prefix internal links
  // 9. Inject translated footer template

  return $.html();
}
```

#### `_partsToHtml()` — Build-time Part Rendering

ทำงานคล้าย runtime `_partsToPreNodes` + `_reconcile` แต่ง่ายกว่าเพราะไม่ต้อง diff DOM:

```javascript
function _partsToHtml($, $el, parts) {
  // Resolve existing SVGs, slots, anchors จาก $el
  const svgs    = $el.find('svg').toArray();
  const slots   = $el.find('[data-translate-slot],[data-slot]').toArray();
  const anchors = $el.find('a').toArray();

  for (const part of parts) {
    switch (part.type) {
      case 'text':   html += _escHtml(part.text); break;
      case 'html':   html += part.html; break;
      case 'br':     html += '<br>'; break;
      case 'strong': html += `<strong>${_escHtml(part.text)}</strong>`; break;
      case 'svg':
      case 'lsvg':   html += $.html(resolveSvg(part.id)); break;
      case 'slot':   html += $.html(resolveSlot(part.name)); break;
      case 'a':      html += $.html(resolveAnchor()); break;
    }
  }
  return html;
}
```

#### SEO Tag Injection

```javascript
function _injectSeoTags($, lang, srcFilePath) {
  const canonPath = _deriveCanonicalPath(srcFilePath);

  // Remove existing
  $('link[hreflang]').remove();
  $('link[rel="canonical"]').remove();

  // Add hreflang for each language
  langs.forEach(l => {
    head.append(`<link rel="alternate" hreflang="${l}" href="${baseUrl}/${l}${canonPath}" />\n`);
  });

  // x-default
  head.append(`<link rel="alternate" hreflang="x-default" href="${baseUrl}/${defLang}${canonPath}" />\n`);

  // Canonical
  head.append(`<link rel="canonical" href="${baseUrl}/${lang}${canonPath}" />\n`);
}
```

#### Footer Injection

```javascript
function _injectFooter($, lang, translations) {
  // Parse footer-template.html ด้วย cheerio
  const $footer = cheerio.load(_config.footerHtml);

  // Translate data-translate elements inside footer
  $footer('[data-translate]').each(...);

  // Prefix footer internal links
  $footer('a[href]').each(...);

  // Append to <body>
  $('body').append("\n" + $footer.html() + "\n");
}
```

### 10.3 `marker-parser.js` — Node.js Marker Parser

**ไฟล์:** `scripts/lib/marker-parser.js`

Port ของ Web Worker translation logic จาก `translator.js` → Node.js ใช้ใน build-time

#### 3 ฟังก์ชันหลัก

**`parseTranslation(str)`** — Parse translation string → parts array (เหมือน Worker):

```javascript
function parseTranslation(str) {
  const htmlParts = str.split(HTML_TAG_RE);
  const parts = [];
  const markerRegex = new RegExp(MARKER_RE_SRC, 'g');

  for (const segment of htmlParts) {
    if (/^<\/?[^>]+>$/.test(segment)) {
      parts.push({ type: 'html', html: segment });
      continue;
    }

    let m;
    while ((m = markerRegex.exec(segment)) !== null) {
      if (m[1])  parts.push({ type: 'lsvg',   id: m[2] || null });
      else if (m[3])  parts.push({ type: 'svg',    id: m[4] || null });
      else if (m[5])  parts.push({ type: 'slot',   name: m[6] || null });
      else if (m[7])  parts.push({ type: 'a', translate: (m[8]||'') !== '', text: m[8] || '' });
      else if (m[9])  parts.push({ type: 'br' });
      else if (m[10]) parts.push({ type: 'strong', text: m[11] || '' });
    }
  }
  return parts;
}
```

**`normalizeParts(parts)`** — Merge consecutive text/html (เหมือน runtime):

```javascript
function normalizeParts(parts) {
  const out = [];
  let buf = '', bufHasHtml = false;
  const flush = () => {
    if (!buf) return;
    out.push(bufHasHtml ? { type: 'html', html: buf } : { type: 'text', text: buf });
    buf = ''; bufHasHtml = false;
  };
  for (const p of parts) {
    if (p.type === 'text' || p.type === 'html') {
      buf += p.type === 'text' ? (p.text||'') : (p.html||'');
      if (p.type === 'html' || /<[^>]+>/.test(p.text||'')) bufHasHtml = true;
    } else { flush(); out.push(p); }
  }
  flush();
  return out;
}
```

**`flattenJson(json)`** — Iterative JSON flattening (เหมือน runtime `loader.js`):

```javascript
function flattenJson(json) {
  const result = {};
  const stack = [json];
  while (stack.length) {
    const obj = stack.pop();
    for (const [k, v] of Object.entries(obj)) {
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        stack.push(v);
      } else {
        result[k] = v;
      }
    }
  }
  return result;
}
```

### 10.4 `file-utils.js` — File I/O Helpers

**ไฟล์:** `scripts/lib/file-utils.js`

#### `findHtmlFiles(dir, exclude)`

ค้นหาไฟล์ `.html` ทั้งหมดแบบ recursive โดย exclude directories ที่ระบุ:

```javascript
function findHtmlFiles(dir, exclude = [], files = []) {
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const rel = fullPath.replace(/\\/g, '/').replace(/^\.\//, '');

    if (exclude.some(ex => rel === ex || rel.startsWith(ex + '/'))) continue;
    if (entry.startsWith('.')) continue;

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      findHtmlFiles(fullPath, exclude, files);
    } else if (entry.endsWith('.html')) {
      files.push(fullPath.replace(/\\/g, '/'));
    }
  }
  return files;
}
```

#### ฟังก์ชันอื่นๆ

| ฟังก์ชัน | หน้าที่ |
|---------|---------|
| `copyDir(src, dest)` | คัดลอก directory tree |
| `ensureDir(dir)` | สร้าง directory ถ้ายังไม่มี |
| `writeFile(filePath, content)` | เขียนไฟล์ + สร้าง parent dirs |
| `loadTranslationFile(filePath, flattenFn)` | โหลด + flatten translation JSON |
| `loadDbJson(filePath)` | โหลด db.json |

### 10.5 `generate-sitemap.js` — Sitemap Generator

**ไฟล์:** `scripts/generate-sitemap.js`

สร้าง `sitemap.xml` พร้อม hreflang alternates สำหรับทุกหน้า:

```javascript
function buildUrlEntries(htmlFiles, langs) {
  for (const file of htmlFiles) {
    let rel = path.relative(CONFIG.srcDir, file).replace(/\\/g, '/');

    // Normalize: index.html → /path/, page.html → /path/page/
    if (rel.endsWith('index.html')) rel = rel.replace(/index\.html$/, '');
    else if (rel.endsWith('.html')) rel = rel.replace(/\.html$/, '/');

    const alternates = langs.map(l => ({
      lang: l,
      href: `${CONFIG.baseUrl}/${l}${pathNoSlash}`
    }));

    entries.push({
      loc: `${CONFIG.baseUrl}/${langs[0]}${pathNoSlash}`,
      lastmod: today,
      changefreq: 'weekly',
      priority: pathNoSlash === '/home/' ? '1.0' : '0.6',
      alternates
    });
  }
}
```

#### ผลลัพธ์ XML

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://fantrove.pages.dev/en/home/</loc>
    <lastmod>2025-01-15</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
    <xhtml:link rel="alternate" hreflang="en" href="https://fantrove.pages.dev/en/home/"/>
    <xhtml:link rel="alternate" hreflang="th" href="https://fantrove.pages.dev/th/home/"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://fantrove.pages.dev/en/home/"/>
  </url>
  <!-- ... -->
</urlset>
```

### 10.6 `update-version.js` — Release Tool

**ไฟล์:** `scripts/update-version.js`

ใช้สำหรับอัพเดตเวอร์ชันก่อน deploy:

#### Usage

```bash
APP_VERSION=1.2.3 git fetch --unshallow && node scripts/update-version.js
```

#### สิ่งที่ทำ

```
1. อ่าน whats-new.json
2. สร้าง release-history.json จาก git log (7 เวอร์ชันล่าสุด)
   - อ่าน commits ของ whats-new.json
   - แยกเวอร์ชันจากแต่ละ commit
   - สร้าง changelog จาก sections/items
3. อัพเดท whats-new.json (เพิ่ม date UTC)
4. Scan & rewrite HTML — อัพเดท cache-busting query strings:
   ?v=1.2.3-202501151200
```

#### Build ID Format

```
{version}-{YYYYMMDD}{HHmm}
ตัวอย่าง: 1.2.3-202501151200
```

#### Date Formatting

```javascript
// English: "January 15, 2025 at 12:00 UTC"
// Thai:    "15 มกราคม 2568 เวลา 12:00 UTC"
```

---

## 11. Global Variables และ Events (v5.0)

### 11.1 Global Variables

| Variable | ประเภท | สร้างโดย | คำอธิบาย |
|----------|--------|---------|----------|
| `window.LangModules` | `Object` | `language.js` | Namespace ของทุก lang-module |
| `window.languageReady` | `Promise` | `language.js` | Gate promise — resolve เมื่อภาษาพร้อม |
| `window.onLanguageReady` | `Function` | `language.js` | Callback helper สำหรับ non-async code |
| `window.languageManager` | `LanguageManager` | `language.js` (boot) | Public API ของระบบภาษา |
| `window.__langUI` | `Object` | `language.js` (boot) | `{ _initialized: true }` — guard flag |
| `window.__fvStaticConfig` | `Object` | `build.js` (inject) | Static config สำหรับ pre-built pages |
| `window.FvLang` | `Object` | `lang-core.js` | Central Language API — source of truth สำหรับภาษา |

### 11.2 `window.LangModules` Namespace

```
window.LangModules = {
  CONFIG,
  State,
  WorkerPool,
  LangGate,
  DBService,
  DetectorService,
  LoaderService,
  MarkerRegistry,
  TranslatorService,
  UIService,
  URLService,
  NavigationService,
  LanguageManager,
  // Internal:
  _gateResolve,
  _gateReject,
  _earlyQueue,
  _origAppend,
  _origInsert,
  _earlyDeactivate,
  _earlyActive,
}
```

### 11.3 Custom Events

| Event | Dispatch โดย | Detail | คำอธิบาย |
|-------|-------------|--------|----------|
| `fv:langchange` | `FvLang.setLang()` / `FvLang.forceRefresh()` | `{ lang, previousLang }` | v5.0: ภาษาเปลี่ยน (หรือ forceRefresh) — ทุกระบบควรฟัง event นี้ |
| `languageReady` | `LangGate.resolve()` | `{ lang, translations }` | ระบบภาษาพร้อมใช้งาน |
| `languageChange` | `LanguageManager.updatePageLanguage()` | `{ language, previousLanguage }` | ภาษาถูกเปลี่ยนแล้ว (backward compat) |

### 11.4 BroadcastChannel

| Channel | Message Format | คำอธิบาย |
|---------|---------------|----------|
| `fv-lang-v3` | `{ lang, url, ts }` | Sync ภาษาระหว่าง tabs |

### 11.5 Session Storage Keys

| Key | เขียนโดย | อ่านโดย | คำอธิบาย |
|-----|---------|---------|----------|
| `fv-forcereload` | `lang-proxy.js` | `manager.js` | Reload marker |
| `fv-reload-inflight` | `lang-proxy.js` | `manager.js` | Inflight redirect ID |
| `fv-reload-ack` | `manager.js` | `manager.js` | Redirect acknowledge |
| `fv-nav-lang-map` | `lang-proxy.js` | — | URL → language mapping |

### 11.6 Local Storage Keys

| Key | คำอธิบาย |
|-----|----------|
| `selectedLang` | ภาษาที่ user เลือก (`'en'` หรือ `'th'`) |
| `__lang_cfg` | Config cache จาก `db.json` |

### 11.7 IndexedDB

| Database | Version | Stores | คำอธิบาย |
|----------|---------|--------|----------|
| `LanguageCacheDB_v3` | 4 | `langs`, `meta` | Cache translation data ข้าม session |

**`langs` store records:**

```javascript
{
  key: 'th',                    // language code
  data: { /* flat translation map */ },
  version: '1',                 // สำหรับ cache invalidation
  ts: 1705312345678             // timestamp
}
```

---

## 12. การทำงานร่วมกันระหว่าง Runtime และ Static Mode (v5.0)

### 12.1 ขั้นตอน Development (localhost)

```
0. lang-core.js        → detect: localStorage > browser → สร้าง FvLang
1. lang-proxy.js       → ตรวจ localhost → ปิดตัวเอง
2. lang-links.js       → ตรวจ localhost → ปิดตัวเอง
3. language.js         → อ่าน FvLang.lang → โหลด 14 modules (full mode)
4. LanguageManager     → Full mode initialize → FvLang.setLang(silent) → gate resolve
   ├─ LoaderService.prefetchEnterprise() → fetch db.json
   ├─ DetectorService.resolveCurrentLang() → storage > browser
   ├─ LoaderService.loadLanguageData() → fetch {lang}.json
   ├─ TranslatorService.parallelStreamingTranslate() → Worker pool
   └─ UIService / NavigationService → setup
```

### 12.2 ขั้นตอน Production (ไม่มี pre-build)

```
0. lang-core.js        → detect: URL > localStorage > browser → สร้าง FvLang
1. lang-proxy.js       → ตรวจ URL → redirect หรือ sync
2. lang-links.js       → prefix ลิงก์ + intercept clicks
3. language.js         → อ่าน FvLang.lang → โหลด 14 modules (full mode)
4. LanguageManager     → Full mode initialize (เหมือน dev)
```

### 12.3 ขั้นตอน Production (Pre-built Static)

```
0. lang-core.js        → detect: data-fv-built → สร้าง FvLang (isStaticMode=true)
1. (lang-proxy.js ถูกลบออกจาก HTML แล้ว)
2. lang-links.js       → prefix ลิงก์ + intercept clicks (ทำงานปกติ)
3. language.js         → อ่าน FvLang → gate resolve ทันที → โหลด 6 modules (static) → _bootStatic()
4. LanguageManager     → ตรวจ FvLang.isStaticMode → return ทันที
```

### 12.4 User เปลี่ยนภาษา — ขั้นตอน

**Runtime Mode:**
```
1. User คลิก dropdown → UIService → LanguageManager.selectLanguage()
2. URLService.updateURLForLanguage() → replaceState
3. localStorage.setItem('selectedLang', lang)
4. LoaderService.loadLanguageData() → memory/IDB/network
5. TranslatorService.parallelStreamingTranslate() → Workers → DOM update
6. FvLang.setLang(lang) → subscribers refresh + dispatch `fv:langchange`
7. BroadcastChannel.postMessage() → sync tabs อื่น
8. dispatchEvent('languageChange') → lang-links.js อัพเดทลิงก์ (backward compat)
```

**Static Mode:**
```
1. User คลิก dropdown → UIService → LanguageManager.selectLanguage()
2. localStorage.setItem('selectedLang', lang)
3. location.replace('/th/path/') → โหลดหน้าใหม่ที่ pre-built แล้ว
4. หน้าใหม่ → language.js → FvLang detect → static mode → แสดง UI
```

---

> **สรุป:** ระบบภาษาของ Fantrove ออกแบบมาเป็น modular architecture ที่รองรับทั้ง runtime translation (เหมาะกับ development) และ pre-built static HTML (เหมาะกับ production SEO) โดยมี **FvLang (lang-core.js)** เป็นชั้น API กลางที่ resolve ภาษาแบบ synchronous และเป็น single source of truth สำหรับทุกระบบ JS ผ่าน `FvLang.lang`, `FvLang.onChange()`, และ event `fv:langchange`
---

## 11. อ้างอิงข้ามเอกสาร

- [`00-System-Architecture.md`](./00-System-Architecture.md) — ภาพรวมสถาปัตยกรรมทั้งโปรเจกต์
- [`06-Popup-System.md`](./06-Popup-System.md) — PopupSystem ที่ใช้ใน `lang-modules/ui.js` v6.0
- [`09-Deployment-Guide.md`](./09-Deployment-Guide.md) — รายละเอียด Build System และ deployment
- [`11-Release-Notes-System.md`](./11-Release-Notes-System.md) — FvLang API ที่ใช้ในระบบ What's New
- [`12-SEO-Guide.md`](./12-SEO-Guide.md) — ⭐ hreflang & international SEO (priority สูงสุด) — ระบบภาษาส่งผลโดยตรงต่อ SEO ในหลายภาษา
- [`AI_CODING_GUIDE.md`](./AI_CODING_GUIDE.md) — มาตรฐานโค้ดที่ต้องยึดเมื่อแก้ระบบภาษา
- [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) — กฎเหล็ก (โดยเฉพาะห้ามใช้ `localStorage.getItem('selectedLang')` โดยตรง — ใช้ `FvLang.lang` แทน)
