# 15 — ระบบ Collection Service (Collection Service)

> เอกสารนี้อธิบายระบบ **Collection Service** ของ Fantrove — ระบบจัดการคอลเลกชันที่เป็น service สำหรับใช้ทั่วทั้งเว็บ รองรับการสร้างหน้า static แบบ SEO-friendly และการดึงข้อมูลเพื่อสร้างการ์ดอัตโนมัติ
>
> **สำหรับ:** AI และนักพัฒนาที่จะแก้/ขยายระบบ Collection Service
>
> **ไฟล์หลัก:**
> - `assets/js/collection-service/collection-service.js` — Entry point (IIFE, 5-phase loader)
> - `assets/js/collection-service/collection-modules/` — 10 modules
> - `assets/db/con-data/collections.json` — Type index
> - `assets/db/con-data/collections/*.json` — ข้อมูลคอลเลกชันแต่ละอัน
> - `scripts/build-collections.js` — Build script สำหรับสร้างหน้า static
> - `collections/_template/index.html` — Template HTML
>
> **เวอร์ชันระบบ:** v1.0.0

---

## สารบัญ

1. [ภาพรวมสถาปัตยกรรม](#1-ภาพรวมสถาปัตยกรรม)
2. [หลักการออกแบบ](#2-หลักการออกแบบ)
3. [โครงสร้างไฟล์](#3-โครงสร้างไฟล์)
4. [โครงสร้างข้อมูล (Database Schema)](#4-โครงสร้างข้อมูล-database-schema)
5. [Module ทั้งหมด](#5-module-ทั้งหมด)
6. [Public API](#6-public-api)
7. [ระบบสร้างภาพปก (Cover Generator)](#7-ระบบสร้างภาพปก-cover-generator)
8. [อัลกอริทึม Related Collections](#8-อัลกอริทึม-related-collections)
9. [การเชื่อมต่อกับระบบอื่น](#9-การเชื่อมต่อกับระบบอื่น)
10. [ระบบ Build (Static Page Generation)](#10-ระบบบ-build-static-page-generation)
11. [SEO สำหรับ Collection Pages](#11-seo-สำหรับ-collection-pages)
12. [การเพิ่ม Collection ใหม่](#12-การเพิ่ม-collection-ใหม่)
13. [การ Migration จาก Card System](#13-การ-migration-จาก-card-system)
14. [สิ่งที่ห้ามทำ](#14-สิ่งที่ห้ามทำ)
15. [อ้างอิงข้ามเอกสาร](#15-อ้างอิงข้ามเอกสาร)

---

## 1. ภาพรวมสถาปัตยกรรม

Collection Service เป็นระบบจัดการคอลเลกชันที่ทำหน้าที่เป็น **service layer** สำหรับทั้งเว็บ แทนที่ระบบ card เดิมที่ต้องสร้างการ์ดด้วยตนเอง ระบบนี้ออกแบบตามมาตรฐาน aerospace-grade (NASA/SpaceX-inspired) โดยมีหลักการสำคัญคือ deterministic, bounded, และ fail-safe

### 1.1 สถาปัตยกรรม 5 ชั้น

```
Layer 1: Data Ingestion    (Loader fetches + validates + normalizes)
Layer 2: Index             (State builds idIndex + itemIndex)
Layer 3: Resolution        (Resolver converts Unicode IDs → characters)
Layer 4: Visual + Bridge   (CoverGenerator + CardBridge + Related)
Layer 5: Service           (Service orchestrates public API)
```

### 1.2 แผนภาพระดับสูง

```
collections.json → cute-hearts.json → thai-symbols.json → ...
        │
        ▼
Collection Service (runtime)
  ├── Loader (fetch + cache + assemble)
  ├── Registry (schema + validate + normalize)
  ├── Resolver (Unicode ID → character)
  ├── CoverGenerator (items → CSS Grid cover)
  ├── Related (Jaccard similarity algorithm)
  ├── CardBridge (collection → card format)
  ├── SEO (meta tags + structured data)
  └── Service (public API)
        │
        ├──→ home.js (cards)
        ├──→ NavCore (content)
        └──→ Build System (static pages)
```

---

## 2. หลักการออกแบบ

### 2.1 Aerospace-Grade Standards

| หลักการ | คำอธิบาย |
|---------|----------|
| **Deterministic** | ผลลัพธ์เดียวกันเสมอสำหรับ input เดียวกัน — ไม่มี randomness |
| **Bounded** | ไม่มี unbounded loops — จำนวน iterations ถูกจำกัดเสมอ |
| **Fail-safe** | คืนค่า default (empty array, null) ถ้าเกิดข้อผิดพลาด — ไม่ throw |
| **No side effects** | ระบบไม่ mutate ข้อมูลต้นฉบับ — ทุก output เป็นสำเนา |
| **Observable** | ทุก operation มี logging ที่ตรวจสอบได้ |

### 2.2 ความสัมพันธ์กับระบบเดิม

- **ConDataService** เป็น single source of truth สำหรับ item data (emoji, symbol, fancy)
- **Collection Service** เป็น service layer ที่อยู่เหนือ ConDataService — ไม่ทับซ้อน
- **CardBridge** แปลง collection data → card format เพื่อให้ระบบเดิมใช้ต่อได้

---

## 3. โครงสร้างไฟล์

```
assets/
├── db/con-data/
│   ├── collections.json                ← Type index (เหมือน cards.json)
│   └── collections/
│       ├── cute-hearts.json            ← ข้อมูลคอลเลกชัน
│       ├── thai-symbols.json
│       ├── math-operators.json
│       ├── arrows.json
│       └── currency-signs.json
│
├── js/collection-service/
│   ├── collection-service.js           ← Entry point (IIFE, 5-phase loader)
│   ├── collection-service.css          ← Cover + page styles
│   └── collection-modules/
│       ├── types.js                    ← Phase 1: Type definitions
│       ├── config.js                   ← Phase 1: Constants & paths
│       ├── state.js                    ← Phase 1: Mutable state + indexes
│       ├── registry.js                 ← Phase 2: Schema + validators + normalizers
│       ├── loader.js                   ← Phase 2: Fetch + cache + assembly
│       ├── resolver.js                 ← Phase 3: Unicode ID → character resolution
│       ├── cover-generator.js          ← Phase 3: SVG/CSS cover generation
│       ├── related.js                  ← Phase 4: Related collections algorithm
│       ├── card-bridge.js              ← Phase 4: Collection → card format bridge
│       ├── seo.js                      ← Phase 5: SEO helpers
│       └── service.js                  ← Phase 5: Public API orchestration
│
├── css/
│   └── collection.css                  ← Collection page styles (supplementary)

collections/
└── _template/
    └── index.html                      ← Template HTML (shared by all collections)

scripts/
└── build-collections.js               ← Build script: generates static pages
```

---

## 4. โครงสร้างข้อมูล (Database Schema)

### 4.1 Type Index: `collections.json`

```json
{
  "id": "collections",
  "kind": "collection",
  "name": { "th": "คอลเลกชัน", "en": "Collections" },
  "categories": [
    { "id": "cute-hearts", "name": { "th": "หัวใจน่ารัก", "en": "Cute Hearts" }, "file": "/assets/db/con-data/collections/cute-hearts.json" }
  ]
}
```

### 4.2 Collection Data: `collections/{id}.json`

```json
{
  "id": "cute-hearts",
  "name": { "th": "หัวใจน่ารัก", "en": "Cute Hearts" },
  "description": { "th": "รวมอักษรพิเศษและอีโมจิหัวใจ", "en": "A collection of heart symbols and emojis." },
  "cover": {
    "type": "auto",
    "items": ["U+2764", "U+1FA77", "U+2661", "U+1F49E"],
    "layout": null,
    "bgColor": null
  },
  "items": ["U+2764", "U+1FA77", "U+2661", "U+1F49E", "U+1F495"]
}
```

| field | required | ความหมาย |
|-------|----------|----------|
| `id` | ✅ | URL-safe identifier (ใช้ใน URL เช่น `/collections/cute-hearts`) |
| `name` | ✅ | ชื่อ i18n (`name.en` ต้องมีเสมอ) |
| `description` | ✅ | คำอธิบาย i18n (ใช้ใน Header, SEO, Search) |
| `cover` | ✅ | ข้อมูลปก thumbnail |
| `cover.type` | ✅ | `'auto'` (คำนวณจาก items) หรือ `'manual'` |
| `cover.items` | ✅ | Unicode IDs สำหรับแสดงในปก (subset ของ items) |
| `cover.layout` | ☐ | `'grid'` | `'row'` | `'spiral'` | `'mosaic'` (auto-select ถ้าไม่ระบุ) |
| `cover.bgColor` | ☐ | สีพื้นหลัง (design token reference) |
| `items` | ✅ | รายการ Unicode IDs ที่อยู่ในคอลเลกชัน |

---

## 5. Module ทั้งหมด

| Phase | Module | หน้าที่ |
|-------|--------|---------|
| 1 | `types.js` | นิยามประเภทข้อมูล (TypeScript-style typedefs) |
| 1 | `config.js` | ค่าคงที่, paths, limits, defaults |
| 1 | `state.js` | สถานะ mutable, indexes, cache |
| 2 | `registry.js` | Schema registry, validators, normalizers, path resolvers |
| 2 | `loader.js` | Fetch engine (TTL cache, dedup, timeout), assembly pipeline |
| 3 | `resolver.js` | Unicode ID → character resolution (ใช้ ConDataService + fallback) |
| 3 | `cover-generator.js` | สร้าง cover HTML จาก items (CSS Grid + Unicode chars) |
| 4 | `related.js` | Related collections algorithm (Weighted Jaccard Similarity) |
| 4 | `card-bridge.js` | แปลง Collection → Card-like format (migration compatibility) |
| 5 | `seo.js` | SEO meta tags, structured data, hreflang |
| 5 | `service.js` | Public API orchestration (window.CollectionService) |

---

## 6. Public API

```javascript
window.CollectionService = {
  version: '1.0.0',

  // Core
  getAssembled(),              // โหลดและประกอบข้อมูลทั้งหมด
  getById(id),                 // ดึง collection เดียวตาม ID
  getAll(lang),                 // ดึงรายการทั้งหมด (แบบย่อ)

  // Item Resolution
  getResolvedItems(id, lang),  // แก้ไข items ของ collection เป็น ResolvedItems
  resolveUnicodeId(id, lang),  // แก้ไข Unicode ID เดียว

  // Cover Generation
  generateCoverHtml(id),       // สร้าง cover HTML (runtime)
  generateCoverHtmlStatic(col, items), // สร้าง cover HTML (static/build time)

  // Related Collections
  getRelated(id, maxResults),  // ดึง related collections

  // Card Bridge
  generateCards(lang),          // สร้าง card data จากทุก collections
  generateCard(id, lang),      // สร้าง card data สำหรับ collection เดียว

  // SEO
  getSeoData(id, lang),        // ดึง SEO meta data
  generateStructuredData(id, lang), // สร้าง JSON-LD

  // Events
  on(event, fn), off(event, fn),

  // Cache & Status
  invalidateCache(), preload(), status(),
};
```

---

## 7. ระบบสร้างภาพปก (Cover Generator)

### 7.1 แนวคิด

ภาพปกสร้างจาก **Unicode characters** แสดงบน **CSS Grid** บน gradient background — ไม่ใช้ไฟล์รูปภาพ ทำให้:
- ไม่กินทรัพยากร (ไม่ต้องโหลดรูป)
- Deterministic (collection เดียวกัน → ปกเดียวกันเสมอ)
- รองรับทั้ง runtime และ build time

### 7.2 Layout Strategies

| Layout | เมื่อไหร่ | คำอธิบาย |
|--------|----------|----------|
| `row` | 1-2 items | แถวเดียว, ตัวอักษรขนาดใหญ่ |
| `grid` | 3-8 items (default) | CSS Grid, กระจายเท่าๆ กัน |
| `spiral` | 9-16 items | CSS transform positioning |
| `mosaic` | >16 items | Grid ที่มีขนาดแตกต่างกัน |

---

## 8. อัลกอริทึม Related Collections

### 8.1 Weighted Jaccard Similarity

```
Score = 0.7 × Jaccard(items) + 0.3 × CategoryAffinity(items)
```

- **Jaccard**: `|A ∩ B| / |A ∪ B|` — จำนวน items ที่ซ้ำกัน
- **CategoryAffinity**: จำนวน type/category ที่ซ้ำกัน / จำนวนทั้งหมด

### 8.2 คุณสมบัติ

- **Deterministic**: ผลลัพธ์เดียวกันเสมอ
- **Bounded**: สูงสุด 8 results, ไม่มี unbounded loops
- **No randomness**: คะแนนคำนวณจากข้อมูลเท่านั้น
- **Fail-safe**: คืน empty array ถ้าเกิดข้อผิดพลาด

---

## 9. การเชื่อมต่อกับระบบอื่น

### 9.1 ConDataService

Collection Service **อยู่เหนือ** ConDataService — ไม่ทับซ้อน:
- ConDataService เป็น single source of truth สำหรับ item data
- Collection Service ใช้ `ConDataService.resolveItem()` เพื่อ resolve Unicode IDs
- ถ้า ConDataService ไม่พร้อม → fallback แปลง Unicode ID เป็นตัวอักษรโดยตรง

### 9.2 NavCore

- `CardBridge.generateCards()` สร้าง card data ที่เข้ากับ ContentService เดิม
- Collection cards มี `className: 'collection-card'` เพื่อให้จัดการได้ง่าย
- Link เป็น internal path (`/collections/{id}/`) ไม่เปิดแท็บใหม่

### 9.3 Search System

- Collection names และ descriptions สามารถค้นหาได้ในอนาคต
- `DiscoveryService` สามารถใช้ `CollectionService.getRelated()` เป็น signal เพิ่มเติม

---

## 10. ระบบ Build (Static Page Generation)

### 10.1 Build Pipeline

`scripts/build-collections.js` ทำงานหลังจาก `build.js` เสร็จ:

1. อ่าน `collections.json` → รู้จำนวน collections
2. โหลดแต่ละ collection JSON
3. โหลด template HTML
4. โหลด translation JSON
5. สำหรับแต่ละ collection × ภาษา:
   - Resolve Unicode IDs → characters + names
   - Generate cover HTML
   - Generate items HTML
   - Generate related collections HTML
   - Inject SEO tags
   - Write to `dist/{lang}/collections/{id}/index.html`

### 10.2 URL Structure

```
/en/collections/cute-hearts/    ← English version
/th/collections/cute-hearts/    ← Thai version
/collections/cute-hearts/       ← Redirect to /en/ (default language)
```

---

## 11. SEO สำหรับ Collection Pages

### 11.1 Meta Tags

ทุกหน้า collection มี:
- `<title>` — ชื่อคอลเลกชัน + "— Fantrove"
- `<meta name="description">` — คำอธิบายคอลเลกชัน
- `<link rel="canonical">` — canonical URL
- `<link rel="alternate" hreflang>` — ทุกภาษา + x-default
- Open Graph tags

### 11.2 Structured Data (JSON-LD)

```json
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "name": "Cute Hearts",
  "numberOfItems": 5,
  "url": "https://fantrove.pages.dev/en/collections/cute-hearts/"
}
```

---

## 12. การเพิ่ม Collection ใหม่

### 12.1 ขั้นตอน

1. สร้างไฟล์ `assets/db/con-data/collections/{new-id}.json`:
```json
{
  "id": "new-id",
  "name": { "th": "ชื่อไทย", "en": "English Name" },
  "description": { "th": "คำอธิบายไทย", "en": "English description" },
  "cover": { "type": "auto", "items": ["U+XXXX"] },
  "items": ["U+XXXX", "U+YYYY"]
}
```

2. เพิ่ม entry ใน `assets/db/con-data/collections.json`:
```json
{
  "id": "new-id",
  "name": { "th": "ชื่อไทย", "en": "English Name" },
  "file": "/assets/db/con-data/collections/new-id.json"
}
```

3. Build → หน้าจะถูกสร้างอัตโนมัติ

### 12.2 ห้ามทำ

- ❌ ห้ามสร้าง HTML แยกสำหรับแต่ละ collection — ระบบ build สร้างให้
- ❌ ห้ามเพิ่ม collection types ลงใน `assets/db/con-data/index.json` — ใช้ `collections.json` แทน
- ❌ ห้ามใช้ URL รูปภาพใน cover — ระบบสร้างปกอัตโนมัติ

---

## 13. การ Migration จาก Card System

### 13.1 ขั้นตอน

1. **Phase 1**: สร้าง Collection Service ควบคู่กับ card system เดิม
2. **Phase 2**: `CardBridge` สร้าง card data ที่เข้ากับระบบเดิม
3. **Phase 3**: เปลี่ยน consumers (home.js, content.js) ให้ใช้ `CollectionService.generateCards()`
4. **Phase 4**: ลบ `assets/db/con-data/cards/` และ `cards.json`

### 13.2 ระหว่าง Migration

- `cards.json` และ `collections.json` อยู่ด้วยกัน
- `CardBridge` สร้าง output ที่เข้ากับ ContentService เดิม 100%

---

## 14. สิ่งที่ห้ามทำ

| ❌ ห้าม | เหตุผล |
|---------|--------|
| สร้าง HTML แยกสำหรับแต่ละ collection | ระบบ build สร้างให้อัตโนมัติ |
| เพิ่ม collections ลงใน `index.json` | ระบบอื่นจะดึงไปแสดงเป็นปุ่ม |
| ใช้ URL รูปภาพใน cover | ระบบสร้างปกอัตโนมัติ |
| เปิดแท็บใหม่เมื่อคลิกการ์ด collection | ต้องนำทางปกติ |
| ใช้ randomness ใน related algorithm | ต้อง deterministic |
| ลบ `api`, `text`, `name` จาก item เดิม | ระบบ index พัง |

---

## 15. อ้างอิงข้ามเอกสาร

- [`00-System-Architecture.md`](./00-System-Architecture.md) — ภาพรวมสถาปัตยกรรมทั้งโปรเจกต์
- [`05-Content-Data-Service.md`](./05-Content-Data-Service.md) — ⭐ ConDataService ที่ Collection Service ใช้เป็นแหล่งข้อมูล
- [`10-Content-Guide.md`](./10-Content-Guide.md) — คู่มือเพิ่ม content (รวม collection)
- [`12-SEO-Guide.md`](./12-SEO-Guide.md) — ⭐ SEO considerations (priority สูงสุด)
- [`02-Search-System.md`](./02-Search-System.md) — ระบบ search ที่เป็นแรงบันดาลใจด้านสถาปัตยกรรม
- [`AI_CODING_GUIDE.md`](./AI_CODING_GUIDE.md) — มาตรฐานโค้ดที่ต้องยึด
- [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) — กฎเหล็กก่อนแตะระบบนี้
- [`13-Documentation-Standard.md`](./13-Documentation-Standard.md) — 🥇 มาตรฐานการเขียนเอกสาร (priority #1)
