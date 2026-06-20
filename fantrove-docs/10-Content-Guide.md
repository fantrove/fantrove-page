# 10 — คู่มือระบบ Content (Content Guide)

> เอกสารนี้อธิบายวิธีเพิ่ม/แก้ content ของ **Fantrove** — อีโมจิ, สัญลักษณ์, ข้อความแฟนซี, และ AI tool cards
>
> **สำหรับ:** ผู้พัฒนา, AI ที่รับงานต่อ, หรือตัวเองในอนาคต
>
> **กฎข้อเดียวที่ต้องจำ:** ห้ามเขียนข้อมูลดิบใน `content/*.json` — ข้อมูลดิบทั้งหมดอยู่ใน `con-data/` เท่านั้น

---

## สารบัญ

1. [ภาพรวมระบบ Content](#1-ภาพรวมระบบ-content)
2. [ข้อมูล 2 ระบบ — สำคัญมาก](#2-ข้อมูล-2-ระบบ--สำคัญมาก)
3. [โครงสร้างไฟล์](#3-โครงสร้างไฟล์)
4. [Schema ข้อมูลใน con-data](#4-schema-ข้อมูลใน-con-data)
5. [Content JSON — ใบสั่งงาน](#5-content-json--ใบสั่งงาน)
6. [How-to: เพิ่มข้อมูลใหม่](#6-how-to-เพิ่มข้อมูลใหม่)
7. [กฎที่ห้ามทำ](#7-กฎที่ห้ามทำ)
8. [ตัวอย่างสำเร็จรูป](#8-ตัวอย่างสำเร็จรูป)
9. [Decision tree](#9-decision-tree)
10. [อ้างอิงข้ามเอกสาร](#10-อ้างอิงข้ามเอกสาร)

---

## 1. ภาพรวมระบบ Content

ระบบ content ของ Fantrove แยกข้อมูลออกเป็น 2 ชั้น: **ข้อมูลดิบ** (raw data) กับ **ใบสั่งงาน** (descriptor) การแยกแบบนี้ทำให้เราสามารถเปลี่ยนว่า "ปุ่มนี้จะแสดงอะไร" โดยไม่ต้องแตะข้อมูลดิบ และกลับกัน — เพิ่มข้อมูลดิบได้โดยไม่ต้องแตะใบสั่งงาน

### 1.1 แผนภาพระดับสูง

```
con-data/          ← ฐานข้อมูลดิบทั้งหมด
    ↓
ConDataService     ← อ่าน + index ไว้ใน memory (assembled DB)
    ↓
content/*.json     ← ใบสั่งงาน: "ดึงอะไร + แสดงผลแบบไหน" เท่านั้น
    ↓
ContentService     ← แปล descriptor → ดึงข้อมูล → render
    ↓
URE                ← virtual scroll + DOM
```

### 1.2 ทำไมต้องแยก?

ถ้ารวมข้อมูลดิบกับ descriptor ในไฟล์เดียวกันจะเกิดปัญหา:

- **ข้อมูลซ้ำ** — ถ้า emoji `😀` ใช้ใน 3 หน้า ต้องเก็บ 3 ชุด
- **แก้ยาก** — แก้ชื่อ emoji ต้องไปแก้ในทุกไฟล์ที่ใช้
- **Cache ไม่ได้** — แต่ละไฟล์ใหญ่เกินไป โหลดช้า
- **Search ไม่ได้** — search engine ไม่รู้ว่าข้อมูลอยู่ไหน

การแยกชั้นทำให้:
- **ข้อมูลดิบอยู่ที่เดียว** — แก้ที่เดียว ใช้ได้ทุกที่
- **ใบสั่งงานเล็ก** — 1-2 KB ต่อไฟล์ โหลดเร็ว
- **Cache ได้** — con-data/*.json cache ได้นาน, content/*.json cache สั้น

---

## 2. ข้อมูล 2 ระบบ — สำคัญมาก

ระบบแยก data เป็น 2 ประเภทที่ **ต้องไม่ปนกัน**:

| ประเภท | ตัวอย่าง | เก็บใน | fetch โดย |
|---|---|---|---|
| **Copyable** | emoji, symbol | `index.json` → assembled DB | `ConDataService.getAssembled()` |
| **Collection** | cards, packages | `con-data/` โดยตรง | `fetchCategoryDirect(type, id)` |

> ⚠️ **ห้ามเพิ่ม collection types ลงใน `index.json`**
> เพราะระบบอื่น (home, search, copy) ดึงข้อมูลจาก assembled DB และ render ทุกอย่างเป็นปุ่ม
> ถ้า cards เข้าไปอยู่ใน assembled DB จะทำให้หัวหมวดหมู่ขึ้น แต่เนื้อหาไม่ขึ้น

### 2.1 ความแตกต่างสำคัญ

| ด้าน | Copyable | Collection |
|---|---|---|
| การ render | เป็นปุ่มกดได้ (button) | เป็นการ์ด (card) มีรูป, คำอธิบาย, ลิงก์ |
| พฤติกรรมเมื่อกด | copy ข้อความไปที่ clipboard | เปิดลิงก์ในแท็บใหม่ |
| ตำแหน่งใน index.json | ✅ ต้องลงทะเบียน | ❌ ห้ามลงทะเบียน |
| ใช้ใน search | ✅ search ได้ | ❌ search ไม่เจอ |
| ใช้ใน home carousel | ✅ ได้ | ❌ ไม่ได้ |

---

## 3. โครงสร้างไฟล์

```
assets/
├── db/con-data/
│   ├── index.json              ← ONLY copyable types (emoji, symbol) — ห้ามเพิ่ม cards
│   ├── emoji.json
│   ├── symbol.json
│   ├── fancy.json
│   ├── emoji/
│   │   └── *.json              ← [{api, text, name}]
│   ├── symbol/
│   │   └── *.json
│   ├── fancy/
│   │   └── *.json
│   └── cards/                  ← collection data — ไม่ต้องอยู่ใน index.json
│       ├── ai_tools.json
│       └── *.json
│
├── json/
│   ├── buttons.json            ← กำหนดปุ่มนำทาง
│   └── content/                ← ใบสั่งงาน เท่านั้น
│       ├── emojis-page1.json
│       ├── symbols.json
│       └── packages.json
│
└── js/
    ├── con-data-service/
    │   ├── con-data-registry.js
    │   └── con-data-service.js
    └── nav-core-modules/
        ├── content.js          ← render (ContentService)
        └── data.js             ← fetch + cache (DataService)
```

### 3.1 ไฟล์สำคัญ

| ไฟล์ | บทบาท | ผู้ใช้ |
|---|---|---|
| `index.json` | Registry ของ copyable types | ConDataService ตอน init |
| `emoji.json`, `symbol.json`, `fancy.json` | Subcategory registry | ConDataService ตอน fetch type |
| `emoji/*.json`, `symbol/*.json` | ข้อมูลดิบ items | ConDataService ตอน fetch category |
| `cards/*.json` | ข้อมูลดิบ collection | ContentService (direct fetch) |
| `buttons.json` | ปุ่มนำทาง | Nav-Core ตอน render nav bar |
| `content/*.json` | ใบสั่งงาน | ContentService ตอน render หน้า |

---

## 4. Schema ข้อมูลใน con-data

### 4.1 Copyable item (emoji / symbol / fancy) — ใน assembled DB

```json
{
  "api":  "U+1F600",
  "text": "😀",
  "name": { "th": "หน้ายิ้ม", "en": "Grinning Face" }
}
```

| field | required | ความหมาย |
|---|---|---|
| `api` | ✅ | Unicode code point หรือ unique ID — ใช้สำหรับ search/index |
| `text` | ✅ | ตัวอักษรจริงที่จะ copy ไป clipboard |
| `name` | ✅ | ชื่อแสดงผล (`name.en` ต้องมีเสมอ, `name.th` optional แต่แนะนำ) |

### 4.2 Collection item (cards) — direct fetch เท่านั้น

โครงสร้างเหมือนเดิม บวก optional card fields:

```json
{
  "api":         "card-openai",
  "text":        "OpenAI",
  "name":        { "th": "โอเพ่นเอไอ", "en": "OpenAI" },
  "description": { "th": "ผู้สร้าง ChatGPT", "en": "Creator of ChatGPT" },
  "image":       "/assets/images/cards/openai.png",
  "link":        "https://openai.com"
}
```

| field | required | ความหมาย |
|---|---|---|
| `api` | ✅ | unique ID — ตั้งเองได้ เช่น `"card-openai"` |
| `text` | ✅ | ชื่อสั้น |
| `name` | ✅ | ชื่อแสดงผล (`name.en` ต้องมีเสมอ) |
| `description` | ☐ | คำอธิบาย (string หรือ multilingual object) |
| `image` | ☐ | URL รูปภาพ |
| `link` | ☐ | URL ที่เปิดเมื่อกดการ์ด |
| `className` | ☐ | CSS class พิเศษ |

### 4.3 Subcategory file structure

แต่ละ subcategory file มีโครงสร้าง:

```json
{
  "id": "smileys_emotion",
  "name": { "th": "หน้ายิ้มและอารมณ์", "en": "Smileys & Emotion" },
  "data": [
    { "api": "U+1F600", "text": "😀", "name": { "th": "หน้ายิ้ม", "en": "Grinning Face" } },
    { "api": "U+1F603", "text": "😃", "name": { "th": "หน้ายิ้มตาใหญ่", "en": "Grinning Face with Big Eyes" } }
  ]
}
```

---

## 5. Content JSON — ใบสั่งงาน

ไฟล์ใน `assets/json/content/` เป็น "ใบสั่งงาน" ที่บอก ContentService ว่าจะดึงอะไร + แสดงผลแบบไหน

### 5.1 `source` — ดึงทั้ง type (copyable เท่านั้น)

```json
[{ "source": "emoji" }]
[{ "source": "symbol" }]
[{ "source": "emoji", "only": ["smileys_emotion", "activities"] }]
[{ "source": "emoji", "as": "cards" }]
```

| field | default | ความหมาย |
|---|---|---|
| `source` | — | ชื่อ type ใน assembled DB |
| `as` | `"buttons"` | รูปแบบ: `"buttons"` หรือ `"cards"` |
| `only` | null | เลือกเฉพาะบาง subcategory |

> ⚠️ `source` ใช้ได้กับ type ที่อยู่ใน `index.json` เท่านั้น (emoji, symbol, fancy)

### 5.2 `category` — ดึง subcategory เดียว

**Copyable subcategory** (ไม่ต้องระบุ `type`):

```json
[{ "category": "arrows" }]
[{ "category": "smileys_emotion", "as": "cards" }]
```

**Collection subcategory** (ต้องระบุ `type` เสมอ):

```json
[{ "category": "ai_tools", "type": "cards", "as": "cards" }]
[{ "category": "ai_tools", "type": "cards", "as": "cards", "horizontal": true }]
```

| field | default | ความหมาย |
|---|---|---|
| `category` | — | ชื่อ subcategory |
| `type` | null | **required สำหรับ collection** — บอกว่าอยู่ใน folder ไหน |
| `as` | `"buttons"` | รูปแบบ: `"buttons"` หรือ `"cards"` |
| `horizontal` | false | scroll แนวนอน (card เท่านั้น) |

> `type` ที่ระบุ → ContentService ใช้ `fetchCategoryDirect(type, category)` fetch โดยตรง ไม่ผ่าน assembled DB

### 5.3 ผสมหลาย descriptor ในไฟล์เดียว

```json
[
  { "source": "emoji" },
  { "category": "ai_tools", "type": "cards", "as": "cards" }
]
```

---

## 6. How-to: เพิ่มข้อมูลใหม่

### 6.1 เพิ่ม item ใน copyable subcategory

เปิด `assets/db/con-data/emoji/activities.json` → เพิ่มใน `data[]`:

```json
{ "api": "U+XXXXX", "text": "🆕", "name": { "th": "ชื่อไทย", "en": "English Name" } }
```

ไม่ต้องแก้ที่อื่น — ConDataService จะ index ใหม่อัตโนมัติเมื่อ reload

### 6.2 เพิ่ม card collection ใหม่

**ขั้นที่ 1** — สร้าง `assets/db/con-data/cards/my_collection.json`:

```json
{
  "id": "my_collection",
  "name": { "th": "คอลเลกชันของฉัน", "en": "My Collection" },
  "data": [
    {
      "api": "card-example",
      "text": "Example",
      "name":        { "th": "ตัวอย่าง", "en": "Example" },
      "description": { "th": "คำอธิบาย", "en": "Description" },
      "image":       "/assets/images/cards/example.png",
      "link":        "https://example.com"
    }
  ]
}
```

> ❌ **ห้ามเพิ่มใน `index.json`** — cards fetch แบบ direct path เสมอ

**ขั้นที่ 2** — ใช้ใน content JSON:

```json
[{ "category": "my_collection", "type": "cards", "as": "cards" }]
```

จบ — ไม่ต้องแตะ index.json เลย

### 6.3 เพิ่ม copyable type ใหม่ (เช่น kaomoji)

1. สร้าง `assets/db/con-data/kaomoji/` + subcategory files (เหมือน emoji)
2. สร้าง `assets/db/con-data/kaomoji.json` (subcategory registry)
3. เพิ่ม entry ใน `assets/db/con-data/index.json` ← อนุญาตสำหรับ copyable types เท่านั้น

```json
{
  "kaomoji": {
    "name": { "th": "เคาโอะโมจิ", "en": "Kaomoji" },
    "file": "/assets/db/con-data/kaomoji.json"
  }
}
```

4. ใช้งาน: `[{ "source": "kaomoji" }]`

### 6.4 เพิ่มหน้า content ใหม่ใน nav

1. สร้างไฟล์ใบสั่งงานใน `assets/json/content/my_page.json`
2. เพิ่มปุ่มใน `assets/json/buttons.json`:

```json
{
  "id": "my_page",
  "label": { "th": "หน้าของฉัน", "en": "My Page" },
  "url": "my_page",
  "content": "/assets/json/content/my_page.json"
}
```

3. ทดสอบบนเว็บ — ควรเห็นปุ่มใหม่ใน nav bar

---

## 7. กฎที่ห้ามทำ

| ❌ ห้ามทำ | เหตุผล |
|---|---|
| เขียนข้อมูลดิบใน `content/*.json` | content = ใบสั่งงานเท่านั้น |
| เพิ่ม cards หรือ collection types ลงใน `index.json` | ระบบอื่นจะดึงไปแสดงเป็นปุ่มโดยไม่ตั้งใจ |
| ใช้ `{ "category": "...", "type": "cards" }` โดยไม่มี `"as": "cards"` | จะ render เป็น button group แทน card group |
| ลบ `api`, `text`, `name` จาก item เดิม | ระบบ index โดย field เหล่านี้ — แตกแน่ |
| ตั้ง `url` ซ้ำกันใน `buttons.json` | routing พัง |
| เปลี่ยน `api` ของ item เดิม | search index พัง, saved favorites หาย |
| ใช้ emoji เดียวกันใน 2 subcategory | duplicates ใน assembled DB, search แสดงซ้ำ |

---

## 8. ตัวอย่างสำเร็จรูป

```json
[{ "source": "emoji" }]
```

```json
[{ "source": "symbol" }]
```

```json
[{ "source": "emoji", "only": ["smileys_emotion"] }]
```

```json
[{ "category": "ai_tools", "type": "cards", "as": "cards" }]
```

```json
[
  { "source": "emoji" },
  { "category": "ai_tools", "type": "cards", "as": "cards" }
]
```

```json
[{ "category": "math_bold", "source": "fancy", "as": "buttons" }]
```

---

## 9. Decision tree

```
ต้องการทำอะไร?
│
├─ เพิ่ม/แก้ emoji หรือ symbol?
│     └─ แก้ไฟล์ใน con-data/emoji/ หรือ con-data/symbol/
│
├─ เพิ่ม card collection ใหม่?
│     └─ สร้างไฟล์ใน con-data/cards/  (ไม่ต้องแตะ index.json)
│        ใช้งาน: { "category": "...", "type": "cards", "as": "cards" }
│
├─ เพิ่มปุ่มนำทางใหม่?
│     └─ แก้ buttons.json + สร้าง content JSON (1 บรรทัด)
│
├─ เปลี่ยนว่าปุ่มนี้แสดงอะไร?
│     └─ แก้ไฟล์ใน content/ เท่านั้น
│
├─ เพิ่ม copyable type ใหม่ (เช่น kaomoji)?
│     └─ สร้างไฟล์ + เพิ่มใน index.json (copyable types อนุญาต)
│
└─ เพิ่มภาษาใหม่ (เช่น ja)?
      └─ อ่าน 04-Language-i18n-System.md ส่วนการเพิ่มภาษา
```

---

## 10. อ้างอิงข้ามเอกสาร

- [`05-ConData-Service.md`](./05-ConData-Service.md) — รายละเอียด ConDataService internals (registry, assembled DB, fetch strategies)
- [`03-Nav-Core-System.md`](./03-Nav-Core-System.md) — ContentService ที่ใช้ content JSON (อยู่ใน nav-core-modules/content.js)
- [`01-URE-Universal-Render-Engine.md`](./01-URE-Universal-Render-Engine.md) — ระบบที่ render items สุดท้าย
- [`02-Search-System.md`](./02-Search-System.md) — Search อ่าน assembled DB ของ ConDataService
- [`AI_FORBIDDEN.md`](./AI_FORBIDDEN.md) — กฎเหล็กที่ AI ต้องรู้ก่อนแก้ content
