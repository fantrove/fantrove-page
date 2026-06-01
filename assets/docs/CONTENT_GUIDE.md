# Fantrove — คู่มือระบบ Content และฐานข้อมูล

> **สำหรับ:** ผู้พัฒนา, AI ที่รับงานต่อ, หรือตัวเองในอนาคต  
> **กฎข้อเดียวที่ต้องจำ:** ห้ามเขียนข้อมูลดิบใน `content/*.json` — ข้อมูลดิบทั้งหมดอยู่ใน `con-data/` เท่านั้น

---

## 1. ภาพรวมระบบ

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

---

## 3. โครงสร้างไฟล์

```
assets/
├── db/con-data/
│   ├── index.json              ← ONLY copyable types (emoji, symbol) — ห้ามเพิ่ม cards
│   ├── emoji.json
│   ├── symbol.json
│   ├── emoji/
│   │   └── *.json              ← [{api, text, name}]
│   ├── symbol/
│   │   └── *.json
│   └── cards/                 ← collection data — ไม่ต้องอยู่ใน index.json
│       ├── ai_tools.json
│       └── *.json
│
├── json/
│   ├── buttons.json            ← กำหนดปุ่มนำทาง
│   └── content/               ← ใบสั่งงาน เท่านั้น
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

---

## 4. Schema ข้อมูลใน con-data

### 4.1 Copyable item (emoji / symbol) — ใน assembled DB

```json
{
  "api":  "U+1F600",
  "text": "😀",
  "name": { "th": "หน้ายิ้ม", "en": "Grinning Face" }
}
```

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

---

## 5. Content JSON — ใบสั่งงาน

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

> ⚠️ `source` ใช้ได้กับ type ที่อยู่ใน `index.json` เท่านั้น (emoji, symbol)

---

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

---

### 5.3 ผสมหลาย descriptor ในไฟล์เดียว

```json
[
  { "source": "emoji" },
  { "category": "ai_tools", "type": "cards", "as": "cards" }
]
```

---

## 6. How-to: เพิ่มข้อมูลใหม่

### เพิ่ม item ใน copyable subcategory

เปิด `assets/db/con-data/emoji/activities.json` → เพิ่มใน `data[]`:
```json
{ "api": "U+XXXXX", "text": "🆕", "name": { "th": "ชื่อไทย", "en": "English Name" } }
```

---

### เพิ่ม card collection ใหม่

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

---

### เพิ่ม copyable type ใหม่ (เช่น kaomoji)

1. สร้าง `assets/db/con-data/kaomoji/` + subcategory files
2. สร้าง `assets/db/con-data/kaomoji.json`
3. เพิ่มใน `assets/db/con-data/index.json` ← อนุญาตสำหรับ copyable types เท่านั้น
4. ใช้งาน: `[{ "source": "kaomoji" }]`

---

## 7. กฎที่ห้ามทำ

| ❌ ห้ามทำ | เหตุผล |
|---|---|
| เขียนข้อมูลดิบใน `content/*.json` | content = ใบสั่งงานเท่านั้น |
| เพิ่ม cards หรือ collection types ลงใน `index.json` | ระบบอื่นจะดึงไปแสดงเป็นปุ่มโดยไม่ตั้งใจ |
| ใช้ `{ "category": "...", "type": "cards" }` โดยไม่มี `"as": "cards"` | จะ render เป็น button group แทน card group |
| ลบ `api`, `text`, `name` จาก item เดิม | ระบบ index โดย field เหล่านี้ — แตกแน่ |
| ตั้ง `url` ซ้ำกันใน `buttons.json` | routing พัง |

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
└─ เพิ่ม copyable type ใหม่ (เช่น kaomoji)?
      └─ สร้างไฟล์ + เพิ่มใน index.json (copyable types อนุญาต)
```