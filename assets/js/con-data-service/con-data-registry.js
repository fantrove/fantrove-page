// Path:    assets/js/con-data-service/con-data-registry.js
// Purpose: Schema registry — แผนที่โครงสร้าง con-data ทั้งหมด, path resolver, validator, normalizer
// Used by: con-data-service.js (ทุก method), data.js (resolvePath)

// con-data-registry.js
// =========================================================
// Schema registry สำหรับ con-data database
// ไฟล์นี้คือ "แผนที่" ของโครงสร้างทั้งหมด
// ระบบอื่นๆ ไม่ต้องรู้ว่าไฟล์อยู่ที่ไหน — ถามที่นี่ได้เลย
// =========================================================

const ConDataRegistry = {
  
  // =========================================================
  // BASE CONFIG
  // =========================================================
  BASE_PATH: '/assets/db/con-data',
  TOP_INDEX: '/assets/db/con-data/index.json',
  
  // =========================================================
  // DATA SCHEMA DEFINITIONS
  // รูปแบบ schema ที่ item แต่ละ layer ต้องมี
  // =========================================================
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
    
    // Layer 3: {subcategory}.json (copyable type)
    // WHY: data items มี required fields (api, text, name) และ optional card fields
    //      optional fields ไม่กระทบ button rendering — ContentService ใช้ forceCard flag แทน
    dataFile: {
      required: ['id', 'name', 'data'],
      data: {
        required: ['api', 'text', 'name'],
        name: { required: ['en'] },
        optional: ['description', 'image', 'link', 'className']
      }
    },

    // Layer 3: {collection-id}.json (collection type)
    // WHY: collection data files มีโครงสร้างต่างจาก copyable — มี items (Unicode IDs)
    //      แทนที่จะเป็น data (items with api/text/name) และมี cover + description
    collectionDataFile: {
      required: ['id', 'name', 'items'],
      optional: ['description', 'cover'],
      items: {
        // Unicode IDs เช่น 'U+2764' หรือ text characters
      },
      cover: {
        required: ['type', 'items'],
        optional: ['layout', 'bgColor']
      }
    }
  },
  
  // =========================================================
  // PATH RESOLVER
  // แปลง relative path ใน file field ให้เป็น absolute
  // =========================================================
  resolvePath(filePath, basePath = this.BASE_PATH) {
    if (!filePath) return null;
    if (filePath.startsWith('/')) return filePath;
    if (filePath.startsWith('http')) return filePath;
    return `${basePath}/${filePath}`;
  },
  
  // =========================================================
  // KNOWN TYPES (fallback ถ้า index.json โหลดไม่ได้)
  // WHY: รายชื่อนี้มีแค่ copyable types เท่านั้น
  //      collection types (cards) ไม่อยู่ที่นี่ เพราะ fetch แบบ direct path เสมอ
  // =========================================================
  knownTypes: ['emoji', 'symbol', 'unicode', 'fancy'],
  
  knownKinds: Object.freeze({
    emoji: 'copyable',
    symbol: 'copyable',
    unicode: 'copyable',
    fancy: 'copyable',
    collections: 'collection',
  }),
  
  // =========================================================
  // QUERY BUILDERS
  // สร้าง path สำหรับ request แต่ละประเภท
  // =========================================================
  paths: {
    topIndex() {
      return ConDataRegistry.TOP_INDEX;
    },
    typeIndex(typeId) {
      return `${ConDataRegistry.BASE_PATH}/${typeId}.json`;
    },
    subcategoryData(typeId, subcategoryId) {
      return `${ConDataRegistry.BASE_PATH}/${typeId}/${subcategoryId}.json`;
    }
  },
  
  // =========================================================
  // VALIDATORS
  // ตรวจสอบว่าข้อมูลที่โหลดมามีโครงสร้างถูกต้อง
  // =========================================================
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
      // v3.0: รองรับทั้ง copyable format (data[]) และ collection format (items[])
      //   WHY: collection data files มี items แทน data — ต้อง validate ได้ทั้งสองรูปแบบ
      if (!data || typeof data.id !== 'string') return false;
      // Copyable format: has data array
      if (Array.isArray(data.data)) return true;
      // Collection format: has items array (Unicode IDs) + name
      if (Array.isArray(data.items) && data.name && typeof data.name === 'object') return true;
      return false;
    },
    // v3.0: collection-specific validator
    //   WHY: แยกจาก dataFile เพื่อให้ตรวจสอบ collection-specific fields ได้ละเอียดขึ้น
    //   ใช้เมื่อรู้ว่า type เป็น collection แล้ว
    collectionDataFile(data) {
      if (!data || typeof data.id !== 'string') return false;
      if (!data.name || typeof data.name !== 'object') return false;
      if (!Array.isArray(data.items)) return false;
      return true;
    },
    item(item) {
      return item &&
        typeof item.api === 'string' &&
        typeof item.text === 'string' &&
        item.name && typeof item.name === 'object';
    }
  },
  
  // =========================================================
  // NORMALIZERS
  // แปลงข้อมูลดิบให้อยู่ในรูปแบบมาตรฐานเสมอ
  // =========================================================
  normalize: {
    
    // แปลง typeIndex ให้ใช้ key "categories" เสมอ (บางไฟล์อาจใช้ "category")
    // v2.3: preserve kind field สำหรับ collection type
    typeIndex(raw) {
      if (!raw) return null;
      const result = {
        id: raw.id || '',
        name: raw.name || {},
        categories: raw.categories || raw.category || []
      };
      // v2.3: preserve kind (e.g., 'collection') for proper pool classification
      if (raw.kind) result.kind = raw.kind;
      return result;
    },
    
    // แปลง dataFile ให้อยู่ในรูปแบบมาตรฐาน
    // v3.0: รองรับทั้ง copyable format และ collection format
    //   WHY: collection data files มี items (Unicode IDs) แทน data (items)
    //   ต้องแปลง Unicode IDs → items ที่มี api/text/name ให้ feed ใช้ได้ทันที
    //   เหมือนกับที่ copyable data ถูก normalize แล้วใช้ได้เลย
    dataFile(raw) {
      if (!raw) return null;
      const base = {
        id: raw.id || '',
        name: raw.name || {},
        data: Array.isArray(raw.data) ? raw.data : []
      };
      // v2.3: preserve collection-specific fields
      if (raw.description !== undefined) base.description = raw.description;
      if (raw.cover !== undefined) base.cover = raw.cover;
      if (Array.isArray(raw.items) && !Array.isArray(raw.data)) base.items = raw.items;
      return base;
    },

    // v3.0: Normalize collection data file — แปลง Unicode IDs → items ที่มี api/text/name
    //   WHY: ทำให้ collection data ไหลผ่าน pipeline เดียวกับ copyable data ได้
    //   FeedService ไม่ต้องรู้ว่าข้อมูลมาจาก collection หรือ copyable — ใช้ data[] ได้เลย
    //   Unicode IDs เช่น "U+2764" จะถูกแปลงเป็น { api: "U+2764", text: "❤", name: {...} }
    //   text ได้จาก String.fromCodePoint() — name ใช้ placeholder ก่อน แล้ว resolve ทีหลัง
    collectionDataFile(raw) {
      if (!raw) return null;
      const base = {
        id: raw.id || '',
        name: raw.name || {},
        data: []
      };
      // Preserve collection-specific fields
      if (raw.description !== undefined) base.description = raw.description;
      if (raw.cover !== undefined) base.cover = raw.cover;
      if (Array.isArray(raw.items)) base.items = raw.items;
      // แปลง Unicode IDs → items ที่มี api/text/name
      //   WHY: ทำให้ FeedService/ContentService ใช้ data[] ได้เหมือน copyable
      //   แต่ละ item จะมี api (Unicode ID), text (ตัวอักษร), name (placeholder)
      if (Array.isArray(raw.items) && !Array.isArray(raw.data)) {
        base.data = raw.items.map(unicodeId => {
          const text = this._unicodeIdToText(unicodeId);
          return {
            api: unicodeId || '',
            text: text || unicodeId || '',
            name: { en: unicodeId || '' }  // placeholder — resolve ทีหลังผ่าน ConDataService.resolveItem
          };
        });
      }
      return base;
    },
    
    // แปลง item ให้ชัดเจน
    // WHY: preserve optional card fields (description, image, link, className)
    //      field เหล่านี้ไม่กระทบ button rendering เพราะ ContentService._resolveItem()
    //      ใช้ forceCard flag เป็นตัวตัดสิน ไม่ใช่การตรวจสอบว่า field มีอยู่หรือไม่
    item(raw) {
      if (!raw) return null;
      const base = {
        api: raw.api || '',
        text: raw.text || '',
        name: raw.name || {}
      };
      if (raw.description !== undefined) base.description = raw.description;
      if (raw.image !== undefined) base.image = raw.image;
      if (raw.link !== undefined) base.link = raw.link;
      if (raw.className !== undefined) base.className = raw.className;
      return base;
    },

    // v3.0: แปลง Unicode ID → ตัวอักษร
    //   WHY: collection items เป็น Unicode IDs เช่น "U+2764" → ต้องแปลงเป็น "❤"
    //   ใช้ String.fromCodePoint() รองรับทั้ง BMP และ Supplementary Planes
    _unicodeIdToText(unicodeId) {
      if (!unicodeId || typeof unicodeId !== 'string') return '';
      const match = unicodeId.match(/^U\+([0-9A-Fa-f]{4,6})$/);
      if (!match) return unicodeId;  // ถ้าไม่ใช่รูปแบบ U+XXXX → คืนค่าเดิม
      const codePoint = parseInt(match[1], 16);
      if (isNaN(codePoint) || codePoint < 0 || codePoint > 0x10FFFF) return unicodeId;
      try { return String.fromCodePoint(codePoint); } catch (e) { return unicodeId; }
    }
  },
  
  // =========================================================
  // LANG HELPER
  // อ่านค่าชื่อตามภาษาที่ถูกต้อง
  // =========================================================
  getName(nameObj, lang = 'en') {
    if (!nameObj || typeof nameObj !== 'object') return String(nameObj || '');
    return nameObj[lang] || nameObj.en || nameObj.th || Object.values(nameObj)[0] || '';
  },
  
  // =========================================================
  // QUERY DESCRIPTORS
  // อธิบายว่า query แต่ละประเภทคืออะไร (สำหรับ documentation/training)
  // =========================================================
  queryTypes: {
    GET_ALL_TYPES: 'ดึงรายการ type ทั้งหมด (emoji, symbol, collections, ...)',
    GET_CATEGORIES: 'ดึงรายการ subcategory ของ type ที่ระบุ',
    GET_ITEMS: 'ดึงรายการ item ทั้งหมดใน subcategory',
    GET_ALL_ITEMS: 'ดึง item ทั้งหมดของ type ที่ระบุ (ทุก subcategory)',
    FIND_BY_API: 'ค้นหา item จาก api code เช่น U+1F600',
    FIND_BY_TEXT: 'ค้นหา item จากตัวอักขระ เช่น 😀',
    SEARCH_BY_NAME: 'ค้นหา item จากชื่อ (multilingual)',
    GET_ASSEMBLED: 'ดึงฐานข้อมูลทั้งหมดแบบประกอบแล้ว (assembled)',
    GET_CATEGORY_META: 'ดึงข้อมูล meta ของ subcategory (ไม่รวม item)',
    GET_COLLECTIONS: 'ดึงรายการ collections ทั้งหมด (เฉพาะ collection type)',
    GET_COLLECTION_ITEMS: 'ดึง items ของ collection ที่ระบุ (แปลงจาก Unicode IDs)'
  },

  // =========================================================
  // TYPE HELPERS
  // ตรวจสอบประเภทของ type
  // =========================================================

  // v3.0: ตรวจสอบว่า type เป็น collection type หรือไม่
  //   WHY: ใช้ตัดสินใจว่าจะใช้ normalizer แบบไหนตอน assembly
  //   ตรวจจาก kind field หรือ id = 'collections'
  isCollectionType(typeId, kind) {
    if (kind === 'collection') return true;
    if (typeId === 'collections') return true;
    return false;
  },
};

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ConDataRegistry;
} else {
  window.ConDataRegistry = ConDataRegistry;
}

export default ConDataRegistry;