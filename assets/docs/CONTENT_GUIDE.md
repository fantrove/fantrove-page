# Fantrove — คู่มือระบบ Content และฐานข้อมูล

> **สำหรับ:** ผู้พัฒนา, AI ที่รับงานต่อ, หรือตัวเองในอนาคต  
> **กฎข้อเดียวที่ต้องจำ:** ห้ามเขียนข้อมูลดิบใน `content/*.json` — ข้อมูลดิบทั้งหมดอยู่ใน `con-data/` เท่านั้น

---

## 1. ภาพรวมระบบ

```
con-data/          ← ฐานข้อมูลดิบทั้งหมด (emoji, symbol, card, ฯลฯ)
    ↓
ConDataService     ← อ่าน + index ทุก item ไว้ใน memory
    ↓
content/*.json     ← ใบสั่งงาน: "ดึงอะไร + แสดงผลแบบไหน" เท่านั้น
    ↓
ContentService     ← แปล descriptor → ดึงข้อมูลจาก con-data → render
    ↓
URE                ← virtual scroll + DOM
```

**หลักการ:** content JSON ไม่มีข้อมูลดิบ มีแค่ descriptor ที่บอกว่า "เอาอะไร มาแสดงยังไง"

---

## 2. โครงสร้างไฟล์

```
assets/
├── db/con-data/                      ← ฐานข้อมูลดิบ (แก้ได้ แต่ห้ามเปลี่ยน schema)
│   ├── index.json                    ← รายชื่อ type ทั้งหมด
│   ├── emoji.json                    ← index ของ emoji
│   ├── symbol.json                   ← index ของ symbol
│   ├── cards.json                    ← index ของ card collections  ← NEW
│   ├── emoji/
│   │   └── *.json                    ← ข้อมูลจริง [{api, text, name}]
│   ├── symbol/
│   │   └── *.json
│   └── cards/
│       └── ai_tools.json             ← ข้อมูลการ์ด [{api, text, name, image, link, ...}]
│
├── json/
│   ├── buttons.json                  ← กำหนดปุ่มนำทาง
│   └── content/                     ← ใบสั่งงาน เท่านั้น ห้ามมีข้อมูลดิบ
│       ├── emojis-page1.json
│       ├── symbols.json
│       └── packages.json
│
└── js/
    ├── con-data-service/
    │   ├── con-data-registry.js      ← schema + path resolver
    │   └── con-data-service.js       ← public API
    └── nav-core-modules/
        ├── content.js                ← render (ContentService)
        └── data.js                   ← fetch + cache (DataService)
```

---

## 3. Schema ข้อมูลใน con-data

### 3.1 Item ทั่วไป (emoji / symbol)

```json
{
  "api":  "U+1F600",
  "text": "😀",
  "name": { "th": "หน้ายิ้ม", "en": "Grinning Face" }
}
```

### 3.2 Item การ์ด (card collection)

เพิ่ม optional fields ลงไปได้ — ไม่กระทบโครงสร้างเดิม

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
| `api` | ✅ | unique ID — ตั้งอิสระได้ เช่น `"card-openai"` |
| `text` | ✅ | ชื่อสั้น / ข้อความที่จะคัดลอก |
| `name` | ✅ | ชื่อแสดงผล (multilingual object) |
| `description` | ☐ | คำอธิบาย (string หรือ multilingual object) |
| `image` | ☐ | URL รูปภาพ (absolute หรือ relative path) |
| `link` | ☐ | URL ที่จะเปิดเมื่อกดการ์ด |
| `className` | ☐ | CSS class พิเศษ |

> ⚠️ `name.en` ต้องมีเสมอ — ระบบ fallback ไปหา `en` ก่อน

---

## 4. Content JSON — ใบสั่งงาน

ไฟล์ใน `assets/json/content/` มีหน้าที่เดียวคือ **บอกว่าจะดึงอะไรมาแสดงผลแบบไหน** ห้ามมีข้อมูลดิบ

### 4.1 `source` — ดึงทั้ง type

```json
[{ "source": "emoji" }]
```

```json
[{ "source": "symbol", "as": "buttons" }]
```

```json
[{ "source": "cards", "as": "cards" }]
```

```json
[{ "source": "emoji", "only": ["smileys_emotion", "activities"] }]
```

| field | default | ความหมาย |
|---|---|---|
| `source` | — | ชื่อ type ใน con-data (`"emoji"`, `"symbol"`, `"cards"`) |
| `as` | `"buttons"` | รูปแบบแสดงผล: `"buttons"` หรือ `"cards"` |
| `only` | `null` (= ทั้งหมด) | array ของ subcategory ID ที่ต้องการ |

### 4.2 `category` — ดึง subcategory เดียว

```json
[{ "category": "ai_tools", "as": "cards" }]
```

```json
[{ "category": "arrows", "as": "buttons" }]
```

```json
[{ "category": "ai_tools", "as": "cards", "horizontal": true }]
```

| field | default | ความหมาย |
|---|---|---|
| `category` | — | ชื่อ subcategory ใน con-data |
| `as` | `"buttons"` | รูปแบบแสดงผล |
| `horizontal` | `false` | (card เท่านั้น) scroll แนวนอน |

### 4.3 ผสมหลาย descriptor ในไฟล์เดียว

```json
[
  { "source": "emoji" },
  { "category": "ai_tools", "as": "cards" }
]
```

### 4.4 Legacy format (รองรับต่อไป ไม่ต้องแก้)

```json
[
  { "group": { "categoryId": "arrows", "type": "button" } }
]
```

---

## 5. การกำหนดปุ่มนำทาง (buttons.json)

```json
{
  "mainButtons": [
    {
      "en_label": "Symbols",
      "th_label": "สัญลักษณ์",
      "url": "symbols",
      "isDefault": true,
      "jsonFile": "/assets/json/content/symbols.json"
    }
  ]
}
```

| field | ความหมาย |
|---|---|
| `url` | key สำหรับ URL `?type=symbols` — ห้ามซ้ำกัน |
| `jsonFile` | path ของ content JSON ที่จะโหลด |
| `isDefault` | เปิดหน้าแรกมาให้เลือกปุ่มนี้ (มีได้แค่ 1 ปุ่ม) |

---

## 6. How-to: เพิ่มข้อมูลใหม่

### เพิ่ม item ในหมวดที่มีอยู่แล้ว

เปิด `assets/db/con-data/emoji/activities.json` แล้วเพิ่มใน array `data`:

```json
{ "api": "U+XXXXX", "text": "🆕", "name": { "th": "ชื่อไทย", "en": "English Name" } }
```

---

### เพิ่ม card collection ใหม่

**ขั้นที่ 1** — สร้างไฟล์ข้อมูล: `assets/db/con-data/cards/my_collection.json`

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

**ขั้นที่ 2** — เพิ่มใน `assets/db/con-data/cards.json`:

```json
{
  "id": "my_collection",
  "name": { "th": "คอลเลกชันของฉัน", "en": "My Collection" },
  "file": "/assets/db/con-data/cards/my_collection.json"
}
```

**ขั้นที่ 3** — ใช้ใน content JSON:

```json
[{ "category": "my_collection", "as": "cards" }]
```

---

### เพิ่ม type ใหม่ทั้งหมด (เช่น kaomoji)

1. สร้างโฟลเดอร์: `assets/db/con-data/kaomoji/`
2. สร้าง subcategory files
3. สร้าง `assets/db/con-data/kaomoji.json` (type index)
4. เพิ่มใน `assets/db/con-data/index.json`
5. สร้าง content JSON: `[{ "source": "kaomoji" }]`
6. เพิ่มปุ่มใน `buttons.json`

---

## 7. กฎที่ห้ามทำ

| ❌ ห้ามทำ | เหตุผล |
|---|---|
| เขียนข้อมูลดิบลงใน `content/*.json` | content = ใบสั่งงานเท่านั้น |
| ลบหรือเปลี่ยนชื่อ field `api`, `text`, `name` ในข้อมูลเดิม | ระบบ index โดย `api` และ `text` — แตกแน่ |
| ตั้ง `url` ซ้ำกันใน `buttons.json` | routing พัง |
| เพิ่ม type ใน con-data โดยไม่อัพเดท `index.json` | ConDataService ไม่รู้จัก type ใหม่ |

---

## 8. ตัวอย่าง content JSON สำเร็จรูป

```json
[{ "source": "emoji" }]
```
```json
[{ "source": "symbol" }]
```
```json
[{ "category": "ai_tools", "as": "cards" }]
```
```json
[{ "source": "cards", "as": "cards" }]
```
```json
[
  { "source": "emoji" },
  { "category": "ai_tools", "as": "cards" }
]
```
```json
[{ "source": "emoji", "only": ["smileys_emotion", "activities"] }]
```

---

## 9. Decision tree สำหรับ AI

```
ต้องการทำอะไร?
│
├─ เพิ่ม/แก้ข้อมูล emoji หรือ symbol?
│     └─ แก้ไฟล์ใน assets/db/con-data/emoji/ หรือ symbol/
│
├─ เพิ่มการ์ดหรือ collection ใหม่?
│     └─ สร้างไฟล์ใน assets/db/con-data/cards/
│        อัพเดท assets/db/con-data/cards.json
│        (ไม่ต้องแตะ content JSON เลย ถ้าปุ่มมีอยู่แล้ว)
│
├─ เพิ่มปุ่มนำทางใหม่?
│     └─ แก้ buttons.json + สร้าง content JSON ใหม่ (1 บรรทัด)
│
├─ เปลี่ยนว่าปุ่มนี้แสดงอะไร?
│     └─ แก้ไฟล์ใน assets/json/content/ เท่านั้น
│
└─ เปลี่ยน render logic?
      └─ แก้ content.js (ต้องเข้าใจ NavCore)
```