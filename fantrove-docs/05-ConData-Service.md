# ระบบ ConData Service — เอกสารอ้างอิงฉบับสมบูรณ์

> **โปรเจกต์:** Fantrove (Fantrove Verse)
> **เวอร์ชันระบบ:** v2.2.0
> **ไฟล์หลัก:**
> - `assets/js/con-data-service/con-data-service.js` — บริการข้อมูลหลัก
> - `assets/js/con-data-service/con-data-registry.js` — Schema Registry, Path Resolver, Validator, Normalizer
> - `assets/db/con-data/index.json` — Registry ระดับบนสุด (Top-Level Index)
> - `assets/db/con-data/{type}.json` — Type Index แต่ละประเภท
> - `assets/db/con-data/{type}/{subcategory}.json` — ไฟล์ข้อมูลรายหมวดหมู่

---

## สารบัญ

1. [ภาพรวมสถาปัตยกรรม (Architecture Overview)](#1-ภาพรวมสถาปัตยกรรม)
2. [หลักการออกแบบ (Design Principles)](#2-หลักการออกแบบ)
3. [ConDataRegistry — Schema Registry](#3-condataregistry--schema-registry)
4. [โครงสร้างข้อมูล 3 ชั้น (3-Layer Data Architecture)](#4-โครงสร้างข้อมูล-3-ชั้น)
5. [ConDataService — บริการข้อมูลหลัก](#5-condataservice--บริการข้อมูลหลัก)
6. [Fetch Engine — ระบบดึงข้อมูลและแคช](#6-fetch-engine--ระบบดึงข้อมูลและแคช)
7. [Index Engine — ระบบจัดทำดัชนี](#7-index-engine--ระบบจัดทำดัชนี)
8. [Event Bus — ระบบเหตุการณ์](#8-event-bus--ระบบเหตุการณ์)
9. [Loader — ระบบโหลดและประกอบข้อมูล](#9-loader--ระบบโหลดและประกอบข้อมูล)
10. [API Reference — อ้างอิง API ทั้งหมด](#10-api-reference--อ้างอิง-api-ทั้งหมด)
11. [รูปแบบข้อมูลที่ส่งออก (Output Formats)](#11-รูปแบบข้อมูลที่ส่งออก)
12. [Global Variables](#12-global-variables)
13. [การรับส่งข้อมูลกับระบบอื่น](#13-การรับส่งข้อมูลกับระบบอื่น)
14. [Auto-Preload Mechanism](#14-auto-preload-mechanism)
15. [ข้อมูลตัวอย่างจริงจากระบบ](#15-ข้อมูลตัวอย่างจริงจากระบบ)

---

## 1. ภาพรวมสถาปัตยกรรม

ConData Service คือ **ระบบศูนย์กลางข้อมูล (Neutral Data Service)** ที่ทำหน้าที่เป็น Single Source of Truth สำหรับข้อมูลทุกประเภทใน Fantrove — รวมถึงอีโมจิ, สัญลักษณ์, ข้อความแฟนซี และคอลเลกชัน

### แผนภาพสถาปัตยกรรม

```
┌─────────────────────────────────────────────────────────────┐
│                     CONSUMERS (ผู้ใช้งาน)                    │
│  home.js │ search-ui.js │ copyNotification.js │ future...   │
└────┬──────────┬────────────────┬──────────────────┬─────────┘
     │          │                │                  │
     ▼          ▼                ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│              window.ConDataService (PUBLIC API)             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  request() │ getAssembled() │ resolveItem() │ search() │ │
│  │  getFormatted() │ findByApi() │ findByText() │ ...     │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌─────────────────────┐ │
│  │  _fetcher    │ │ _indexEngine │ │    _eventBus        │ │
│  │  (Cache+HTTP)│ │ (Maps/Index) │ │ (Pub/Sub Events)    │ │
│  └──────────────┘ └──────────────┘ └─────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  _loader (Assembly Pipeline)                           │ │
│  │  index.json → {type}.json → {subcategory}.json        │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  ConDataRegistry (Schema/Path/Validate/Normalize)      │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
     │          │                │                  │
     ▼          ▼                ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│              JSON DATABASE FILES (Static Assets)             │
│  /assets/db/con-data/index.json                             │
│  /assets/db/con-data/emoji.json                             │
│  /assets/db/con-data/symbol.json                            │
│  /assets/db/con-data/fancy.json                             │
│  /assets/db/con-data/cards.json                             │
│  /assets/db/con-data/emoji/smileys_emotion.json             │
│  /assets/db/con-data/emoji/animal_nature.json               │
│  /assets/db/con-data/symbol/arrows.json                     │
│  /assets/db/con-data/symbol/math.json                       │
│  /assets/db/con-data/fancy/math_bold.json                   │
│  /assets/db/con-data/cards/ai_tools.json                    │
│  ...                                                        │
└─────────────────────────────────────────────────────────────┘
```

### สรุป Flow การทำงาน

1. **Module Load** → `ConDataService` ลงทะเบียนตัวเองบน `window.ConDataService` และเรียก `preload()` ทันที
2. **Preload Pipeline** → `_loader.assemble()` ดำเนินการ:
   - โหลด `index.json` (Top Index)
   - โหลด `{type}.json` ทุกไฟล์ (Type Index) แบบ parallel
   - โหลด `{subcategory}.json` ทุกไฟล์ (Data Files) แบบ parallel
   - ประกอบเป็นโครงสร้าง `assembled` และสร้าง index
3. **Consumer Request** → ระบบอื่นเรียก API เช่น `ConDataService.getAssembled()`
4. **Data Returned** → ข้อมูลพร้อมใช้งานจากแคชในหน่วยความจำ

---

## 2. หลักการออกแบบ

ระบบ ConData Service ออกแบบตามหลักการเหล่านี้:

| หลักการ | รายละเอียด |
|----------|-------------|
| **Neutral (เป็นกลาง)** | ไม่เอนเอียงต่อระบบใดระบบหนึ่ง — ระบบอื่นขอข้อมูลในรูปแบบที่ต้องการได้ทันที |
| **Single Source of Truth** | ทุกระบบดึงข้อมูลจากจุดเดียวกัน ไม่มีการดึงข้อมูลซ้ำซ้อน |
| **Location Transparency** | Consumer ไม่ต้องรู้ว่าไฟล์อยู่ที่ไหนหรือโครงสร้างเป็นอย่างไร |
| **Schema-Driven** | ข้อมูลทุกชั้นมี schema กำหนดไว้ชัดเจนใน `ConDataRegistry.schema` |
| **Auto-Preload** | เริ่ม fetch data ทันทีที่ module โหลด ไม่รอให้ consumer ถาม |
| **Deduplication** | หากมี request ซ้ำระหว่าง fetch อยู่ จะใช้ Promise เดียวกัน |
| **Multi-Format Output** | รองรับการส่งออกข้อมูลหลายรูปแบบ (`getFormatted()`) |

---

## 3. ConDataRegistry — Schema Registry

**ไฟล์:** `assets/js/con-data-service/con-data-registry.js`

ConDataRegistry คือ "แผนที่" ของโครงสร้าง con-data ทั้งหมด ทำหน้าที่ 4 อย่างหลัก:
1. **Path Resolver** — แปลง path ให้ถูกต้อง
2. **Schema Definition** — กำหนดโครงสร้างข้อมูลที่ถูกต้อง
3. **Validator** — ตรวจสอบว่าข้อมูลที่โหลดมาถูกต้อง
4. **Normalizer** — แปลงข้อมูลดิบให้อยู่ในรูปแบบมาตรฐานเสมอ

### 3.1 ค่าคงที่และ Base Config

```javascript
const ConDataRegistry = {
  BASE_PATH: '/assets/db/con-data',
  TOP_INDEX: '/assets/db/con-data/index.json',

  knownTypes: ['emoji', 'symbol', 'unicode', 'fancy'],

  knownKinds: Object.freeze({
    emoji: 'copyable',
    symbol: 'copyable',
    unicode: 'copyable',
    fancy: 'copyable',
  }),
  // ...
};
```

> **หมายเหตุ:** `knownTypes` มีเฉพาะ copyable types เท่านั้น ส่วน collection types เช่น `cards` ไม่อยู่ที่นี่เพราะถูก fetch แบบ direct path จาก `index.json` เสมอ

### 3.2 Schema Definitions

```javascript
schema: {
  // Layer 1: index.json
  topIndex: {
    required: ['categories'],
    categories: {
      required: ['id', 'name', 'file'],
      optional: ['kind'], // 'copyable' (default) | 'collection'
      name: { required: ['en'] }
    }
  },

  // Layer 2: {type}.json
  typeIndex: {
    required: ['id', 'name', 'categories'],
    categories: {
      required: ['id', 'name', 'file'],
      name: { required: ['en'] }
    }
  },

  // Layer 3: {subcategory}.json
  dataFile: {
    required: ['id', 'name', 'data'],
    data: {
      required: ['api', 'text', 'name'],
      name: { required: ['en'] },
      optional: ['description', 'image', 'link', 'className']
    }
  }
}
```

### 3.3 Path Resolver

```javascript
resolvePath(filePath, basePath = this.BASE_PATH) {
  if (!filePath) return null;
  if (filePath.startsWith('/')) return filePath;        // absolute path
  if (filePath.startsWith('http')) return filePath;     // external URL
  return `${basePath}/${filePath}`;                     // relative → absolute
}
```

**ตัวอย่าง:**
| ค่า input | ค่า output |
|-----------|-----------|
| `'emoji.json'` | `'/assets/db/con-data/emoji.json'` |
| `'/assets/db/con-data/symbol/arrows.json'` | `'/assets/db/con-data/symbol/arrows.json'` (ไม่เปลี่ยน) |
| `'https://cdn.example.com/data.json'` | `'https://cdn.example.com/data.json'` (ไม่เปลี่ยน) |
| `null` | `null` |

### 3.4 Query Builders (paths)

```javascript
paths: {
  topIndex()                        { return '/assets/db/con-data/index.json'; },
  typeIndex(typeId)                 { return '/assets/db/con-data/${typeId}.json'; },
  subcategoryData(typeId, subcatId) { return '/assets/db/con-data/${typeId}/${subcatId}.json'; },
}
```

### 3.5 Validators

```javascript
validate: {
  topIndex(data) {
    return data && Array.isArray(data.categories) && data.categories.length > 0;
  },
  typeIndex(data) {
    return data &&
      typeof data.id === 'string' &&
      (Array.isArray(data.categories) || Array.isArray(data.category));
  },
  dataFile(data) {
    return data &&
      typeof data.id === 'string' &&
      Array.isArray(data.data);
  },
  item(item) {
    return item &&
      typeof item.api === 'string' &&
      typeof item.text === 'string' &&
      item.name && typeof item.name === 'object';
  }
}
```

> **หมายเหตุ:** `validate.typeIndex()` รองรับทั้ง key `categories` และ `category` เพื่อความเข้ากันได้ย้อนหลัง

### 3.6 Normalizers

```javascript
normalize: {
  // แปลงให้ใช้ key "categories" เสมอ (บางไฟล์อาจใช้ "category")
  typeIndex(raw) {
    return {
      id: raw.id || '',
      name: raw.name || {},
      categories: raw.categories || raw.category || []
    };
  },

  // แปลง dataFile ให้มีโครงสร้างมาตรฐาน
  dataFile(raw) {
    return {
      id: raw.id || '',
      name: raw.name || {},
      data: Array.isArray(raw.data) ? raw.data : []
    };
  },

  // แปลง item — preserve optional card fields
  item(raw) {
    const base = {
      api: raw.api || '',
      text: raw.text || '',
      name: raw.name || {}
    };
    if (raw.description !== undefined) base.description = raw.description;
    if (raw.image !== undefined)       base.image = raw.image;
    if (raw.link !== undefined)        base.link = raw.link;
    if (raw.className !== undefined)   base.className = raw.className;
    return base;
  }
}
```

> **สำคัญ:** optional fields (`description`, `image`, `link`, `className`) ใช้สำหรับ Card items เท่านั้น และ **ไม่กระทบการ render button** เพราะ `ContentService._resolveItem()` ใช้ `forceCard` flag เป็นตัวตัดสิน

### 3.7 Language Helper

```javascript
getName(nameObj, lang = 'en') {
  if (!nameObj || typeof nameObj !== 'object') return String(nameObj || '');
  return nameObj[lang] || nameObj.en || nameObj.th || Object.values(nameObj)[0] || '';
}
```

**ลำดับการ fallback:** `lang` ที่ต้องการ → `'en'` → `'th'` → ค่าแรกที่พบ

### 3.8 Query Type Descriptors

```javascript
queryTypes: {
  GET_ALL_TYPES:    'ดึงรายการ type ทั้งหมด (emoji, symbol, cards, ...)',
  GET_CATEGORIES:   'ดึงรายการ subcategory ของ type ที่ระบุ',
  GET_ITEMS:        'ดึงรายการ item ทั้งหมดใน subcategory',
  GET_ALL_ITEMS:    'ดึง item ทั้งหมดของ type ที่ระบุ (ทุก subcategory)',
  FIND_BY_API:      'ค้นหา item จาก api code เช่น U+1F600',
  FIND_BY_TEXT:     'ค้นหา item จากตัวอักขระ เช่น 😀',
  SEARCH_BY_NAME:   'ค้นหา item จากชื่อ (multilingual)',
  GET_ASSEMBLED:    'ดึงฐานข้อมูลทั้งหมดแบบประกอบแล้ว (assembled)',
  GET_CATEGORY_META:'ดึงข้อมูล meta ของ subcategory (ไม่รวม item)'
}
```

---

## 4. โครงสร้างข้อมูล 3 ชั้น

ConData ใช้โครงสร้างแบบ 3 ชั้น (3-Layer Hierarchy):

```
Layer 1: index.json (Top-Level Registry)
  └── Layer 2: {type}.json (Type Index) — 1 ไฟล์ต่อ type
        └── Layer 3: {subcategory}.json (Data File) — 1 ไฟล์ต่อหมวดหมู่ย่อย
```

### Layer 1 — Top-Level Index (`index.json`)

```json
{
  "categories": [
    {
      "id": "emoji",
      "name": { "th": "อีโมจิ", "en": "Emoji" },
      "file": "emoji.json"
    },
    {
      "id": "symbol",
      "name": { "th": "อักษรพิเศษ", "en": "Symbol" },
      "file": "symbol.json"
    },
    {
      "id": "fancy",
      "name": { "th": "ข้อความแฟนซี", "en": "Fancy Text" },
      "file": "fancy.json"
    },
    {
      "id": "cards",
      "name": { "th": "คอลเลกชัน", "en": "Collections" },
      "file": "cards.json"
    }
  ]
}
```

**Fields ในแต่ละ entry:**
| Field | Type | จำเป็น | คำอธิบาย |
|-------|------|--------|----------|
| `id` | `string` | ✅ | ตัวระบุ type เช่น `"emoji"`, `"symbol"` |
| `name` | `object` | ✅ | ชื่อหลายภาษา มี `en` จำเป็นต้องมี |
| `file` | `string` | ✅ | path ไปยัง Type Index (relative หรือ absolute) |
| `kind` | `string` | ❌ | ชนิดข้อมูล: `'copyable'` (default) หรือ `'collection'` |

### Layer 2 — Type Index (`{type}.json`)

**ตัวอย่าง — `emoji.json`:**

```json
{
  "id": "emoji",
  "name": { "th": "อีโมจิ", "en": "Emoji" },
  "categories": [
    {
      "id": "smileys_emotion",
      "name": { "th": "หน้ายิ้มและอารมณ์", "en": "Smileys & Emotion" },
      "file": "/assets/db/con-data/emoji/smileys_emotion.json"
    },
    {
      "id": "people_body",
      "name": { "th": "บุคคลและร่างกาย", "en": "People & Body" },
      "file": "/assets/db/con-data/emoji/people_body.json"
    }
  ]
}
```

**ตัวอย่าง — `cards.json` (kind: collection):**

```json
{
  "id": "cards",
  "kind": "collection",
  "name": { "th": "คอลเลกชัน", "en": "Collections" },
  "categories": [
    {
      "id": "ai_tools",
      "name": { "th": "เครื่องมือ AI", "en": "AI Tools" },
      "file": "/assets/db/con-data/cards/ai_tools.json"
    }
  ]
}
```

**Fields ใน Type Index:**
| Field | Type | จำเป็น | คำอธิบาย |
|-------|------|--------|----------|
| `id` | `string` | ✅ | ตัวระบุ type |
| `name` | `object` | ✅ | ชื่อหลายภาษา |
| `kind` | `string` | ❌ | `'copyable'` (default) หรือ `'collection'` |
| `categories` / `category` | `array` | ✅ | รายการหมวดหมู่ย่อย |

### Layer 3 — Data File (`{subcategory}.json`)

**ตัวอย่าง — Copyable Item (emoji):**

```json
{
  "id": "smileys_emotion",
  "name": { "th": "หน้ายิ้มและอารมณ์", "en": "Smileys & Emotion" },
  "data": [
    {
      "api": "U+1F600",
      "text": "😀",
      "name": { "th": "หน้ายิ้มกว้าง", "en": "Grinning Face" }
    },
    {
      "api": "U+1F603",
      "text": "😃",
      "name": { "th": "หน้ายิ้มตาโต", "en": "Grinning Face with Big Eyes" }
    }
  ]
}
```

**ตัวอย่าง — Card Item (collection):**

```json
{
  "id": "ai_tools",
  "name": { "th": "เครื่องมือ AI", "en": "AI Tools" },
  "data": [
    {
      "api": "card-openai",
      "text": "OpenAI",
      "name":        { "th": "โอเพ่นเอไอ",  "en": "OpenAI" },
      "description": { "th": "ผู้สร้าง ChatGPT...", "en": "Creator of ChatGPT..." },
      "image":       "/assets/images/cards/openai.png",
      "link":        "https://openai.com"
    }
  ]
}
```

### โครงสร้าง Item ทั้ง 2 ประเภท

#### Copyable Item (emoji, symbol, fancy)

| Field | Type | จำเป็น | คำอธิบาย |
|-------|------|--------|----------|
| `api` | `string` | ✅ | Unicode code point เช่น `"U+1F600"`, `"U+2190"` |
| `text` | `string` | ✅ | ตัวอักขระจริง เช่น `"😀"`, `"→"`, `"𝐀"` |
| `name` | `object` | ✅ | ชื่อหลายภาษา `{ th: "...", en: "..." }` |

#### Card Item (collection)

| Field | Type | จำเป็น | คำอธิบาย |
|-------|------|--------|----------|
| `api` | `string` | ✅ | ตัวระบุเฉพาะ เช่น `"card-openai"` |
| `text` | `string` | ✅ | ข้อความแสดงผล เช่น `"OpenAI"` |
| `name` | `object` | ✅ | ชื่อหลายภาษา |
| `description` | `object` | ❌ | คำอธิบายหลายภาษา |
| `image` | `string` | ❌ | path รูปภาพ |
| `link` | `string` | ❌ | URL ลิงก์ |
| `className` | `string` | ❌ | CSS class เพิ่มเติม |

### ข้อมูลที่เพิ่มโดย Index Engine (Enriched Item)

เมื่อ item ผ่านเข้า `_indexEngine.build()` จะถูกเพิ่ม metadata ดังนี้:

```javascript
{
  // ... original fields (api, text, name, description, image, link, className)
  _typeId:  'emoji',          // ID ของ type ที่ item นี้อยู่
  _typeObj: { id, name, category: [...] },  // อ้างอิงไปยัง type object ต้นฉบับ
  _catId:   'smileys_emotion', // ID ของ category ที่ item นี้อยู่
  _catObj:  { id, name, data: [...] }       // อ้างอิงไปยัง category object ต้นฉบับ
}
```

> **สำคัญ:** การ enrich ใช้ `Object.assign({}, item, {...})` — ไม่ mutate ต้นฉบับ

---

## 5. ConDataService — บริการข้อมูลหลัก

**ไฟล์:** `assets/js/con-data-service/con-data-service.js`
**เวอร์ชัน:** `2.2.0`

ConDataService เป็น object หลักที่เปิดเผย API ทั้งหมดให้ consumer ใช้งาน ประกอบด้วย 4 ส่วนภายใน (internal) และ 1 ส่วนภายนอก (public)

### 5.1 ส่วนประกอบภายใน (4 Internal Modules)

```
ConDataService
├── _fetcher      → Fetch Engine (HTTP + Cache + Timeout + Dedup)
├── _indexEngine  → Index Engine (Maps สำหรับ lookup ทุกประเภท)
├── _eventBus     → Event Bus (Pub/Sub)
└── _loader       → Loader (Assembly Pipeline: 3-layer → assembled)
```

### 5.2 Public API Surface

```javascript
const ConDataService = {
  version: '2.2.0',
  registry: ConDataRegistry,

  // Event System
  on(event, fn),
  off(event, fn),

  // Core
  async getAssembled(),

  // Type / Category
  async getTypes(),
  async getTypeById(typeId),
  async getCategories(typeId),
  async getCategoryById(typeId, categoryId),
  async getCategoryMeta(typeId, categoryId),

  // Items
  async getItems(typeId, categoryId),
  async getAllItems(typeId = null),

  // Lookups
  async findByApi(apiCode),
  async findByText(text),
  async findByApiBatch(apiCodes),
  async search(query, lang = null),

  // v2.2.0 — Neutral lookup
  async resolveItem({ text?, api?, lang? }),

  // Formatted Outputs
  async getFormatted(format, options = {}),

  // Data Manipulation
  async paginate(typeId, categoryId, page, pageSize),
  async slice(typeId, offset, limit),
  async filter(fn, typeId),
  async transform(fn),

  // Helpers
  getName(item, lang),
  async getStats(),

  // Universal Request Interface
  async request(descriptor),

  // Cache & Status
  invalidateCache(),
  preload(),
  status()
};
```

---

## 6. Fetch Engine — ระบบดึงข้อมูลและแคช

### 6.1 ค่าคงที่

```javascript
const _fetcher = {
  _cache:     new Map(),
  _pending:   new Map(),
  _CACHE_TTL: 2 * 60 * 60 * 1000,  // 2 ชั่วโมง
  _TIMEOUT_MS: 8000,               // 8 วินาที
};
```

### 6.2 กลไกการทำงาน

```
fetch(url)
  │
  ├── ตรวจ _cache → ถ้า cache ยังไม่หมดอายุ → คืนข้อมูลทันที
  │
  ├── ตรวจ _pending → ถ้ามี request เดียวกันอยู่ → คืน Promise เดียวกัน
  │
  └── สร้าง Promise ใหม่:
       ├── สร้าง AbortController (timeout 8 วินาที)
       ├── fetch(url) พร้อม header 'Accept': 'application/json'
       ├── ตรวจ resp.ok
       ├── JSON.parse ข้อความ
       ├── เก็บลง _cache พร้อม timestamp
       └── คืนข้อมูล
```

### 6.3 Cache Entry Format

```javascript
_cache.set(url, {
  data: <parsed JSON>,  // ข้อมูลที่ parse แล้ว
  ts: Date.now()        // timestamp ที่บันทึก
});
```

### 6.4 การตรวจสอบ Cache

```javascript
_isCacheValid(entry) {
  return entry && (Date.now() - entry.ts) < this._CACHE_TTL;  // 2 ชั่วโมง
}
```

### 6.5 Methods

| Method | คำอธิบาย |
|--------|----------|
| `fetch(url)` | ดึงข้อมูล JSON พร้อม cache + timeout + dedup |
| `invalidate(url)` | ลบ cache ของ URL เดียว |
| `invalidateAll()` | ลบ cache ทั้งหมด |
| `getCacheSize()` | คืนจำนวน entries ใน cache |

---

## 7. Index Engine — ระบบจัดทำดัชนี

Index Engine สร้างดัชนีหลายประเภทจากข้อมูลที่ประกอบแล้ว (assembled) เพื่อให้ lookup ทำได้เร็วใน O(1)

### 7.1 ดัชนีที่สร้าง

| ดัชนี | Type | Key | Value |
|-------|------|-----|-------|
| `_typeIndex` | `Map` | `typeId` (เช่น `'emoji'`) | type object (`{ id, name, category }`) |
| `_catIndex` | `Map` | `typeId/catId` (เช่น `'emoji/smileys_emotion'`) | item array |
| `_apiIndex` | `Map` | `api code` (เช่น `'U+1F600'`) | enriched item |
| `_textIndex` | `Map` | `text` (เช่น `'😀'`) | enriched item |
| `_nameIndex` | `Map` | ชื่อ lowercase (ทุกภาษา) | array of enriched items |
| `_allItems` | `Array` | — | enriched items ทั้งหมด |

### 7.2 การสร้างดัชนี (build process)

```javascript
build(assembled) {
  this.reset();
  for (const typeObj of assembled.type) {
    this._typeIndex.set(typeObj.id, typeObj);

    for (const cat of (typeObj.category || [])) {
      this._catIndex.set(`${typeObj.id}/${cat.id}`, cat.data || []);

      for (const item of cat.data) {
        // Enrich: เพิ่ม _typeId, _typeObj, _catId, _catObj (ไม่ mutate ต้นฉบับ)
        const enriched = Object.assign({}, item, {
          _typeId: typeObj.id, _typeObj: typeObj,
          _catId: cat.id,      _catObj: cat
        });

        if (item.api)  this._apiIndex.set(item.api, enriched);
        if (item.text) this._textIndex.set(item.text, enriched);
        this._allItems.push(enriched);

        // Index name ทุกภาษา
        if (item.name && typeof item.name === 'object') {
          for (const lang of Object.keys(item.name)) {
            const key = (item.name[lang] || '').toLowerCase().trim();
            if (!key) continue;
            if (!this._nameIndex.has(key)) this._nameIndex.set(key, []);
            this._nameIndex.get(key).push(enriched);
          }
        }
      }
    }
  }
}
```

### 7.3 Methods

| Method | คำอธิบาย |
|--------|----------|
| `reset()` | ล้างดัชนีทั้งหมด |
| `build(assembled)` | สร้างดัชนีใหม่จาก assembled data |
| `isReady()` | ตรวจว่าดัชนีสร้างแล้วหรือยัง |
| `findByApi(api)` | ค้นหา item จาก api code (O(1)) |
| `findByText(txt)` | ค้นหา item จากตัวอักษร (O(1)) |
| `getType(id)` | ดึง type object จาก ID |
| `getAllItems()` | คืน item ทั้งหมด (copy) |
| `getCategoryItems(typeId, catId)` | ดึง items ของหมวดหมู่ที่ระบุ |
| `searchByName(query)` | ค้นหาจากชื่อ (exact match ได้ priority) |
| `getStats()` | คืนสถิติข้อมูล |

### 7.4 รูปแบบผลลัพธ์ getStats()

```javascript
{
  types: 4,           // จำนวน types ทั้งหมด
  categories: 50,     // จำนวน categories ทั้งหมด
  items: 5432,        // จำนวน items ทั้งหมด
  byType: {
    emoji: { categories: 9, items: 1800 },
    symbol: { categories: 27, items: 2100 },
    fancy: { categories: 10, items: 620 },
    cards: { categories: 1, items: 12 }
  }
}
```

---

## 8. Event Bus — ระบบเหตุการณ์

ระบบ Pub/Sub แบบง่ายสำหรับสื่อสารภายในระบบ

### 8.1 Events ที่มี

| Event | Payload | คำอธิบาย |
|-------|---------|----------|
| `'ready'` | `{ assembled }` | เริ่มต้นเมื่อข้อมูลประกอบเสร็จสมบูรณ์ |
| `'invalidated'` | `{}` | เริ่มต้นเมื่อ cache ถูกล้างทั้งหมด |

### 8.2 API

```javascript
// ฟังเหตุการณ์ — คืน unsubscribe function
const unsubscribe = ConDataService.on('ready', (payload) => {
  console.log('ข้อมูลพร้อมใช้งาน!', payload.assembled);
});

// ยกเลิกฟัง
ConDataService.off('ready', handler);

// ส่งเหตุการณ์ (internal เท่านั้น)
_eventBus.emit('ready', { assembled });
```

> **หมายเหตุ:** หาก handler มี error จะถูก catch แล้ว `console.warn` — ไม่ทำให้ระบบหยุดทำงาน

---

## 9. Loader — ระบบโหลดและประกอบข้อมูล

### 9.1 Assembly Pipeline (สายการผลิตการประกอบข้อมูล)

```
Step 1: loadTopIndex()
  └── fetch /assets/db/con-data/index.json
  └── validate ด้วย ConDataRegistry.validate.topIndex()
  └── ถ้า fail → fallback ใช้ knownTypes

Step 2: โหลด Type Index ทุกไฟล์ (parallel)
  └── Promise.all() สำหรับแต่ละ category ใน topIndex
  └── fetch ไฟล์ เช่น /assets/db/con-data/emoji.json
  └── validate ด้วย ConDataRegistry.validate.typeIndex()
  └── normalize ด้วย ConDataRegistry.normalize.typeIndex()

Step 3: โหลด Data Files ทุกไฟล์ (parallel, nested)
  └── สำหรับแต่ละ type → โหลด categories ทั้งหมดแบบ parallel
  └── fetch ไฟล์ เช่น /assets/db/con-data/emoji/smileys_emotion.json
  └── validate ด้วย ConDataRegistry.validate.dataFile()
  └── normalize ด้วย ConDataRegistry.normalize.dataFile()

Step 4: ประกอบ (Assemble)
  └── รวมทั้งหมดเป็น { type: [typeObj, ...] }
  └── _indexEngine.build(assembled)  — สร้างดัชนีทุกประเภท
  └── _eventBus.emit('ready', { assembled })
  └── เก็บ assembled ลง _assembledDb
```

### 9.2 Fallback Strategy

หาก `index.json` โหลดไม่ได้ ระบบจะสร้าง topIndex เทียมจาก `knownTypes`:

```javascript
topIndex = {
  categories: ConDataRegistry.knownTypes.map(id => ({
    id,
    name: { en: id },
    file: `${id}.json`
  }))
};
```

### 9.3 Deduplication

```javascript
async assemble() {
  if (this._assembledDb) return this._assembledDb;      // มีแล้ว คืนทันที
  if (this._assemblePromise) return this._assemblePromise; // กำลังโหลด คืน Promise เดียวกัน

  this._assemblePromise = (async () => {
    // ... pipeline ...
  })();

  try {
    const result = await this._assemblePromise;
    this._assemblePromise = null;  // ล้างหลังเสร็จ
    return result;
  } catch (err) {
    this._assemblePromise = null;
    throw err;
  }
}
```

### 9.4 Path Resolution ใน Loader

สำหรับแต่ละ category entry ใน Type Index ระบบตรวจสอบ `file` field:

```javascript
const filePath = catEntry.file
  ? ConDataRegistry.resolvePath(catEntry.file)            // มี file → ใช้ path ที่กำหนด
  : ConDataRegistry.paths.subcategoryData(typeId, catEntry.id); // ไม่มี → สร้าง path
```

---

## 10. API Reference — อ้างอิง API ทั้งหมด

### 10.1 Event System

#### `on(event, fn) → Function`
ฟังเหตุการณ์ คืน unsubscribe function
```javascript
const unsub = ConDataService.on('ready', ({ assembled }) => { /* ... */ });
// ยกเลิก: unsub();
```

#### `off(event, fn)`
ยกเลิกการฟังเหตุการณ์

---

### 10.2 Core

#### `async getAssembled() → Object`
คืนฐานข้อมูลทั้งหมดแบบประกอบแล้ว (รูปแบบเดียวกับที่ SearchEngine ต้องการ)
```javascript
const db = await ConDataService.getAssembled();
// { type: [{ id, name, category: [{ id, name, data: [...] }] }] }
```

---

### 10.3 Type / Category

#### `async getTypes() → Array<{ id, name }>`
```javascript
const types = await ConDataService.getTypes();
// [{ id: 'emoji', name: { th: 'อีโมจิ', en: 'Emoji' } }, ...]
```

#### `async getTypeById(typeId) → Object|null`
```javascript
const emoji = await ConDataService.getTypeById('emoji');
// { id: 'emoji', name: {...}, category: [...] }
```

#### `async getCategories(typeId) → Array<{ id, name, count }>`
```javascript
const cats = await ConDataService.getCategories('emoji');
// [{ id: 'smileys_emotion', name: {...}, count: 118 }, ...]
```
> **throw Error** ถ้า `typeId` ไม่มีค่าหรือไม่พบ

#### `async getCategoryById(typeId, categoryId) → Object|null`
```javascript
const cat = await ConDataService.getCategoryById('emoji', 'smileys_emotion');
// { id: 'smileys_emotion', name: {...}, data: [...], typeId: 'emoji', typeName: {...} }
```

#### `async getCategoryMeta(typeId, categoryId) → Object`
```javascript
const meta = await ConDataService.getCategoryMeta('emoji', 'smileys_emotion');
// { id, name, typeId, typeName, count }
```
> **throw Error** ถ้าไม่พบ

---

### 10.4 Items

#### `async getItems(typeId, categoryId) → Array<Item>`
```javascript
const items = await ConDataService.getItems('emoji', 'smileys_emotion');
// [{ api: 'U+1F600', text: '😀', name: {...} }, ...]
```
> **throw Error** ถ้า `typeId` หรือ `categoryId` ไม่มีค่าหรือไม่พบ

#### `async getAllItems(typeId = null) → Array<EnrichedItem>`
```javascript
const allEmoji = await ConDataService.getAllItems('emoji');
const everything = await ConDataService.getAllItems();   // ทุก type
// items จะมี _typeId, _typeObj, _catId, _catObj แนบมาด้วย
```

---

### 10.5 Lookups

#### `async findByApi(apiCode) → EnrichedItem|null`
```javascript
const item = await ConDataService.findByApi('U+1F600');
// { api: 'U+1F600', text: '😀', name: {...}, _typeId: 'emoji', _catId: 'smileys_emotion', ... }
```

#### `async findByText(text) → EnrichedItem|null`
```javascript
const item = await ConDataService.findByText('😀');
// { api: 'U+1F600', text: '😀', name: {...}, ... }
```

#### `async findByApiBatch(apiCodes) → Array<{ api, item }>`
```javascript
const results = await ConDataService.findByApiBatch(['U+1F600', 'U+2190', 'U+XXXX']);
// [{ api: 'U+1F600', item: {...} }, { api: 'U+2190', item: {...} }, { api: 'U+XXXX', item: null }]
```

#### `async search(query, lang = null) → Array<EnrichedItem>`
```javascript
const results = await ConDataService.search('heart');
// ค้นหาจากทุกภาษาใน name field (case-insensitive, includes match)
// exact match ได้ priority
```

---

### 10.6 resolveItem() — v2.2.0

#### `async resolveItem({ text?, api?, lang? }) → Object|null`

API สำหรับ lookup item จาก partial context — ออกแบบเป็น neutral utility ไม่ผูกกับระบบใดระบบหนึ่ง

**Lookup priority:** `text` → `api` → `null`

```javascript
// ค้นจากตัวอักขระ
const item = await ConDataService.resolveItem({ text: '😀', lang: 'th' });
// { api: 'U+1F600', text: '😀', name: { th: 'หน้ายิ้มกว้าง', en: 'Grinning Face' },
//   _typeId: 'emoji', _catId: 'smileys_emotion', displayName: 'หน้ายิ้มกว้าง' }

// ค้นจาก API code
const item = await ConDataService.resolveItem({ api: 'U+1F600', lang: 'en' });
// { ..., displayName: 'Grinning Face' }
```

**ค่าที่คืน:** enriched item + `displayName` field เพิ่มเติม (ใช้ `_extractName` helper)

**ลำดับ fallback ของ displayName:** `lang` → `'en'` → `'th'` → ค่าแรกที่พบ

---

### 10.7 getFormatted() — รูปแบบข้อมูลหลายรูปแบบ

#### `async getFormatted(format, options = {}) → Any`

รองรับ format ทั้งหมด 9 ประเภท:

| Format | คำอธิบาย | รูปแบบผลลัพธ์ |
|--------|----------|---------------|
| `'assembled'` | ฐานข้อมูลแบบประกอบแล้ว (default) | `{ type: [...] }` |
| `'flat'` | items ทั้งหมดแบบ flat (ไม่มี context) | `Item[]` |
| `'flat-with-context'` | items ทั้งหมดพร้อม parent context | `EnrichedItem[]` |
| `'by-type'` | จัดกลุ่มตาม type | `{ [typeId]: Item[] }` |
| `'by-category'` | จัดกลุ่มตาม category | `{ 'typeId/catId': Item[] }` |
| `'api-map'` | map จาก api code → item | `{ [api]: Item }` |
| `'text-map'` | map จาก text → item | `{ [text]: Item }` |
| `'types-only'` | เฉพาะ type metadata | `[{ id, name }]` |
| `'categories-only'` | เฉพาะ category metadata ทั้งหมด | `[{ id, name, typeId, typeName, count }]` |

```javascript
// ตัวอย่าง
const db = await ConDataService.getFormatted('assembled');
const flat = await ConDataService.getFormatted('flat');
const byType = await ConDataService.getFormatted('by-type');
const apiMap = await ConDataService.getFormatted('api-map');
const cats = await ConDataService.getFormatted('categories-only');
```

> **throw Error** ถ้าระบุ format ไม่ถูกต้อง

---

### 10.8 Data Manipulation

#### `async paginate(typeId, categoryId, page = 1, pageSize = 50) → PageResult`
```javascript
const page = await ConDataService.paginate('emoji', 'smileys_emotion', 2, 30);
// {
//   items: [...],         // item 30 รายการ
//   page: 2,
//   pageSize: 30,
//   total: 118,
//   totalPages: 4,
//   hasNext: true,
//   hasPrev: true
// }
```

#### `async slice(typeId = null, offset = 0, limit = 50) → Array<Item>`
```javascript
const items = await ConDataService.slice('emoji', 100, 20); // ตัวที่ 101-120
```

#### `async filter(fn, typeId = null) → Array<Item>`
```javascript
const hearts = await ConDataService.filter(
  item => item.name.en.toLowerCase().includes('heart'),
  'emoji'
);
```
> **throw Error** ถ้า `fn` ไม่ใช่ function

#### `async transform(fn) → Any`
```javascript
const countByType = await ConDataService.transform(db => {
  const out = {};
  db.type.forEach(t => {
    out[t.id] = t.category.reduce((sum, c) => sum + (c.data || []).length, 0);
  });
  return out;
});
// { emoji: 1800, symbol: 2100, fancy: 620, cards: 12 }
```
> **throw Error** ถ้า `fn` ไม่ใช่ function

---

### 10.9 Helpers

#### `getName(item, lang = 'en') → string`
```javascript
ConDataService.getName(item, 'th');  // 'หน้ายิ้มกว้าง'
ConDataService.getName(item, 'en');  // 'Grinning Face'
```

#### `async getStats() → StatsObject`
ดูรูปแบบผลลัพธ์ใน [ส่วน 7.4](#74-รูปแบบผลลัพธ์-getstats)

---

### 10.10 Universal Request Interface

#### `async request(descriptor) → Any`

อินเทอร์เฟซเดียวที่เรียก method อื่นได้ทั้งหมด — มีประโยชน์สำหรับ dynamic dispatch

```javascript
// เทียบเท่ากับ ConDataService.getAssembled()
const db = await ConDataService.request({ action: 'getAssembled' });

// เทียบเท่ากับ ConDataService.getItems('emoji', 'smileys_emotion')
const items = await ConDataService.request({
  action: 'getItems',
  typeId: 'emoji',
  categoryId: 'smileys_emotion'
});

// เทียบเท่ากับ ConDataService.resolveItem({ text: '😀', lang: 'th' })
const item = await ConDataService.request({
  action: 'resolveItem',
  text: '😀',
  lang: 'th'
});

// เทียบเท่ากับ ConDataService.getFormatted('by-type')
const byType = await ConDataService.request({
  action: 'getFormatted',
  format: 'by-type'
});
```

**Actions ที่รองรับทั้งหมด:**

| Action | Parameters | คำอธิบาย |
|--------|-----------|----------|
| `getAssembled` | — | ดึงข้อมูลแบบ assembled |
| `getTypes` | — | ดึง types ทั้งหมด |
| `getTypeById` | `typeId` | ดึง type เดียว |
| `getCategories` | `typeId` | ดึง categories ของ type |
| `getCategoryById` | `typeId`, `categoryId` | ดึง category เดียว |
| `getCategoryMeta` | `typeId`, `categoryId` | ดึง category meta |
| `getItems` | `typeId`, `categoryId` | ดึง items ใน category |
| `getAllItems` | `typeId?` | ดึง items ทั้งหมด |
| `findByApi` | `api` / `apiCode` | ค้นหาจาก api |
| `findByText` | `text` | ค้นหาจากตัวอักขระ |
| `findByApiBatch` | `apiCodes` / `apis` | ค้นหาหลาย api |
| `search` | `query`, `lang?` | ค้นหาจากชื่อ |
| `resolveItem` | `text?`, `api?`, `lang?` | v2.2.0 neutral lookup |
| `getFormatted` | `format`, `options?` | ดึงข้อมูลแบบระบุ format |
| `paginate` | `typeId`, `categoryId`, `page`, `pageSize` | แบ่งหน้า |
| `slice` | `typeId?`, `offset`, `limit` | ตัดช่วง |
| `filter` | `fn`, `typeId?` | กรองด้วย function |
| `transform` | `fn` | แปลงข้อมูลด้วย function |
| `getStats` | — | ดึงสถิติ |

> **throw Error** ถ้าระบุ action ไม่ถูกต้อง หรือ `filter`/`transform` ไม่มี `fn`

---

### 10.11 Cache & Status

#### `invalidateCache()`
ล้างข้อมูลทั้งหมด — รวมทั้ง fetch cache, index, assembled data และ emit event `'invalidated'`

#### `preload()`
เริ่ม fetch pipeline แบบ fire-and-forget (ไม่ await) — ปลอดภัยต่อการเรียกซ้ำ

```javascript
ConDataService.preload(); // เริ่มโหลด ไม่รอผล
```

#### `status() → Object`
```javascript
const s = ConDataService.status();
// {
//   assembled: true,        // ข้อมูลประกอบแล้วหรือยัง
//   indexReady: true,       // ดัชนีสร้างแล้วหรือยัง
//   cacheSize: 45,          // จำนวน cache entries
//   version: '2.2.0'        // เวอร์ชัน ConDataService
// }
```

---

## 11. รูปแบบข้อมูลที่ส่งออก

### 11.1 Assembled Structure (รูปแบบหลัก)

นี่คือรูปแบบที่ `getAssembled()` คืน — ตรงกับที่ SearchEngine ต้องการโดยตรง:

```javascript
{
  type: [
    {
      id: 'emoji',
      name: { th: 'อีโมจิ', en: 'Emoji' },
      category: [
        {
          id: 'smileys_emotion',
          name: { th: 'หน้ายิ้มและอารมณ์', en: 'Smileys & Emotion' },
          data: [
            { api: 'U+1F600', text: '😀', name: { th: '...', en: 'Grinning Face' } },
            // ...
          ]
        },
        // ...more categories
      ]
    },
    // ...more types
  ]
}
```

### 11.2 Enriched Item (หลังผ่าน Index Engine)

```javascript
{
  // --- Original fields ---
  api: 'U+1F600',
  text: '😀',
  name: { th: 'หน้ายิ้มกว้าง', en: 'Grinning Face' },

  // --- Enriched fields (เพิ่มโดย _indexEngine) ---
  _typeId: 'emoji',
  _typeObj: { id: 'emoji', name: {...}, category: [...] },
  _catId: 'smileys_emotion',
  _catObj: { id: 'smileys_emotion', name: {...}, data: [...] },

  // --- Resolved fields (เพิ่มโดย resolveItem) ---
  displayName: 'Grinning Face'
}
```

### 11.3 Card Item พร้อม Optional Fields

```javascript
{
  api: 'card-openai',
  text: 'OpenAI',
  name: { th: 'โอเพ่นเอไอ', en: 'OpenAI' },
  description: { th: 'ผู้สร้าง ChatGPT...', en: 'Creator of ChatGPT...' },
  image: '/assets/images/cards/openai.png',
  link: 'https://openai.com',
  // enriched fields...
  _typeId: 'cards',
  _catId: 'ai_tools'
}
```

---

## 12. Global Variables

ConDataService ลงทะเบียนตัวเองบน `window` เมื่อทำงานในสภาพแวดล้อม browser:

### `window.ConDataService`

Object บริการข้อมูลหลัก — มี API ทั้งหมดตามที่อธิบายใน [ส่วน 5](#5-condataservice--บริการข้อมูลหลัก)

```javascript
// ตัวอย่างการเข้าถึงจากที่ใดก็ได้ในหน้าเว็บ
const db = await window.ConDataService.getAssembled();
```

### `window.ConDataRegistry`

Object registry — มีค่าคงที่, schema, validators, normalizers (ดู [ส่วน 3](#3-condataregistry--schema-registry))

```javascript
const path = window.ConDataRegistry.resolvePath('emoji.json');
// '/assets/db/con-data/emoji.json'
```

### Export แบบ ES Module

```javascript
// Default export
import ConDataService from './con-data-service.js';

// Named export
import { ConDataRegistry } from './con-data-service.js';
```

---

## 13. การรับส่งข้อมูลกับระบบอื่น

ConData Service ถูกออกแบบมาให้เป็น **neutral** — ระบบอื่นใน Fantrove สามารถดึงข้อมูลไปใช้ได้ทันที

### 13.1 ระบบที่ใช้ ConData Service

| ระบบ | วิธีการใช้ | รายละเอียด |
|------|------------|-----------|
| **home.js** | `getAssembled()` | โหลดข้อมูลเพื่อแสดงผลหน้าแรก |
| **search-ui.js** | `getAssembled()` | ส่งข้อมูลให้ SearchEngine สร้าง index ค้นหา |
| **copyNotification.js** | `resolveItem()` | ค้นหาชื่อ item เพื่อแสดง notification เมื่อคัดลอก |

### 13.2 ตัวอย่าง — search-ui.js ดึงข้อมูล

```javascript
// search-ui.js รอ ConDataService พร้อมใช้งาน
const pollForService = () => {
  if (window.ConDataService) {
    window.ConDataService.getAssembled().then(db => {
      // ส่ง db ไปยัง SearchEngine
    });
  } else {
    setTimeout(pollForService, 50);
  }
};
```

### 13.3 ตัวอย่าง — copyNotification.js ใช้ resolveItem

```javascript
// เมื่อผู้ใช้คัดลอก '😀'
const item = await ConDataService.resolveItem({ text: '😀', lang: 'th' });
// item.displayName === 'หน้ายิ้มกว้าง'
// ใช้ displayName แสดงใน notification
```

---

## 14. Auto-Preload Mechanism

### ทำไมต้อง Auto-Preload?

```
ไทม์ไลน์ที่แสดงความสำคัญของ auto-preload:

t=0ms     HTML parse เริ่ม
t=200ms   con-data-service.js execute (type="module", deferred)
          → window.ConDataService = ConDataService
          → ConDataService.preload() เริ่ม fetch pipeline

t=400ms   search-ui.js โหลดเสร็จ
          → พบ window.ConDataService พร้อมใช้
          → เรียก getAssembled()
          → ข้อมูลอาจโหลดเสร็จแล้ว (บน connection เร็ว)
```

**ปัญหาถ้าไม่มี preload:** search-ui.js พร้อมใช้ที่ t=400ms แต่ fetch ข้อมูลเริ่มต้นที่ t=400ms ทำให้เสียเวลา 200-400ms

**ด้วย preload:** ข้อมูลเริ่มโหลดตั้งแต่ t=200ms เมื่อ search-ui พร้อมถาม ข้อมูลอาจโหลดเสร็จแล้ว

### โค้ด Auto-Preload

```javascript
// ท้ายไฟล์ con-data-service.js
if (typeof window !== 'undefined') {
  window.ConDataService = ConDataService;
  // Fire-and-forget: start fetching NOW, don't await
  ConDataService.preload();
}

export default ConDataService;
export { ConDataRegistry };
```

> **จุดสำคัญ:** `preload()` คืน Promise แต่ไม่มีการ `await` — เป็น fire-and-forget หากเกิด error จะถูกจับด้วย `.catch(() => {})` โดยไม่แสดง error

---

## 15. ข้อมูลตัวอย่างจริงจากระบบ

### 15.1 โครงสร้างไฟล์ในระบบ

```
/assets/db/con-data/
├── index.json                          ← Layer 1: Top Index
├── emoji.json                          ← Layer 2: Type Index
├── symbol.json
├── fancy.json
├── cards.json
├── emoji/                              ← Layer 3: Data Files
│   ├── smileys_emotion.json            (9 หมวดหมู่)
│   ├── people_body.json
│   ├── animal_nature.json
│   ├── food_drink.json
│   ├── travel_places.json
│   ├── activities.json
│   ├── objects.json
│   ├── symbols.json
│   └── flags.json
├── symbol/                             (27 หมวดหมู่)
│   ├── arrows.json
│   ├── math.json
│   ├── currency.json
│   ├── punctuation.json
│   ├── latin_extended.json
│   ├── greek.json
│   ├── cyrillic.json
│   ├── geometric.json
│   ├── box_drawing.json
│   ├── misc_technical.json
│   ├── letterlike.json
│   ├── dingbats.json
│   ├── braille.json
│   ├── enclosed_alphanumeric.json
│   ├── number_forms.json
│   ├── superscript_subscript.json
│   ├── phonetic.json
│   ├── combining.json
│   ├── general_punctuation_ext.json
│   ├── cjk_symbols.json
│   ├── musical.json
│   ├── chess_games.json
│   ├── alchemical.json
│   ├── ancient_scripts.json
│   ├── mahjong_domino.json
│   ├── playing_cards.json
│   └── miscellaneous.json
├── fancy/                              (10 หมวดหมู่)
│   ├── math_bold.json
│   ├── math_italic.json
│   ├── math_bold_italic.json
│   ├── math_script.json
│   ├── math_bold_script.json
│   ├── math_fraktur.json
│   ├── math_double_struck.json
│   ├── math_monospace.json
│   ├── math_sans.json
│   └── math_sans_bold.json
└── cards/                              (1 หมวดหมู่)
    └── ai_tools.json
```

**สรุป:** 4 types, 47 categories ทั้งหมด

### 15.2 ข้อมูลจริง — Emoji (Copyable)

```json
{
  "api": "U+1F600",
  "text": "😀",
  "name": { "th": "หน้ายิ้มกว้าง", "en": "Grinning Face" }
}
```

```json
{
  "api": "U+2764-FE0F-200D-1F525",
  "text": "❤️‍🔥",
  "name": { "th": "หัวใจลุกไฟ", "en": "Heart on Fire" }
}
```

### 15.3 ข้อมูลจริง — Symbol (Copyable)

```json
{ "api": "U+2190", "text": "←", "name": { "th": "ลูกศรซ้าย", "en": "Leftwards Arrow" } }
{ "api": "U+2194", "text": "↔", "name": { "th": "ลูกศรซ้าย-ขวา", "en": "Left Right Arrow" } }
```

### 15.4 ข้อมูลจริง — Fancy Text (Copyable)

```json
{ "api": "U+1D400", "text": "𝐀", "name": { "th": "A ตัวหนา", "en": "Bold A" } }
{ "api": "U+1D7CE", "text": "𝟎", "name": { "th": "0 ตัวหนา", "en": "Bold 0" } }
```

### 15.5 ข้อมูลจริง — Cards (Collection)

```json
{
  "api": "card-openai",
  "text": "OpenAI",
  "name":        { "th": "โอเพ่นเอไอ",  "en": "OpenAI" },
  "description": { "th": "ผู้สร้าง ChatGPT และ GPT-4 เครื่องมือ AI ชั้นนำของโลก", "en": "Creator of ChatGPT and GPT-4, a leading AI research company." },
  "image":       "/assets/images/cards/openai.png",
  "link":        "https://openai.com"
}
```

---

## ภาคผนวก: Version History

| เวอร์ชัน | การเปลี่ยนแปลง |
|-----------|---------------|
| **v2.0.0** | ระบบฐาน — ConDataService + ConDataRegistry แยกกัน |
| **v2.1.0** | เพิ่ม Auto-preload บน module load |
| **v2.2.0** | เพิ่ม `resolveItem()` — neutral lookup API สำหรับค้นหา item จาก partial context |

---

> **เอกสารฉบับนี้สร้างขึ้นเพื่อให้ AI หรือนักพัฒนาสามารถเข้าใจระบบ ConData Service ทั้งหมดได้จากเอกสารฉบับเดียว — โดยไม่ต้องอ่าน source code โดยตรง**�ั้นนำของโลก", "en": "Creator of ChatGPT and GPT-4, a leading AI research company." },
