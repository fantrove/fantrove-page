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
        name: { required: ['en'] }
      }
    },
    
    // Layer 2: {type}.min.json
    typeIndex: {
      required: ['id', 'name', 'categories'],
      categories: {
        required: ['id', 'name', 'file'],
        name: { required: ['en'] }
      }
    },
    
    // Layer 3: {subcategory}.min.json
    dataFile: {
      required: ['id', 'name', 'data'],
      data: {
        required: ['api', 'text', 'name'],
        name: { required: ['en'] }
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
  // =========================================================
  knownTypes: ['emoji', 'symbol', 'unicode'],
  
  // =========================================================
  // QUERY BUILDERS
  // สร้าง path สำหรับ request แต่ละประเภท
  // =========================================================
  paths: {
    topIndex() {
      return ConDataRegistry.TOP_INDEX;
    },
    typeIndex(typeId) {
      return `${ConDataRegistry.BASE_PATH}/${typeId}.min.json`;
    },
    subcategoryData(typeId, subcategoryId) {
      return `${ConDataRegistry.BASE_PATH}/${typeId}/${subcategoryId}.min.json`;
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
  },
  
  // =========================================================
  // NORMALIZERS
  // แปลงข้อมูลดิบให้อยู่ในรูปแบบมาตรฐานเสมอ
  // =========================================================
  normalize: {
    
    // แปลง typeIndex ให้ใช้ key "categories" เสมอ (บางไฟล์อาจใช้ "category")
    typeIndex(raw) {
      if (!raw) return null;
      return {
        id: raw.id || '',
        name: raw.name || {},
        categories: raw.categories || raw.category || []
      };
    },
    
    // แปลง dataFile ให้อยู่ในรูปแบบมาตรฐาน
    dataFile(raw) {
      if (!raw) return null;
      return {
        id: raw.id || '',
        name: raw.name || {},
        data: Array.isArray(raw.data) ? raw.data : []
      };
    },
    
    // แปลง item ให้ชัดเจน
    item(raw) {
      if (!raw) return null;
      return {
        api: raw.api || '',
        text: raw.text || '',
        name: raw.name || {}
      };
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
    GET_ALL_TYPES: 'ดึงรายการ type ทั้งหมด (emoji, symbol, ...)',
    GET_CATEGORIES: 'ดึงรายการ subcategory ของ type ที่ระบุ',
    GET_ITEMS: 'ดึงรายการ item ทั้งหมดใน subcategory',
    GET_ALL_ITEMS: 'ดึง item ทั้งหมดของ type ที่ระบุ (ทุก subcategory)',
    FIND_BY_API: 'ค้นหา item จาก api code เช่น U+1F600',
    FIND_BY_TEXT: 'ค้นหา item จากตัวอักขระ เช่น 😀',
    SEARCH_BY_NAME: 'ค้นหา item จากชื่อ (multilingual)',
    GET_ASSEMBLED: 'ดึงฐานข้อมูลทั้งหมดแบบประกอบแล้ว (assembled)',
    GET_CATEGORY_META: 'ดึงข้อมูล meta ของ subcategory (ไม่รวม item)'
  }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ConDataRegistry;
} else {
  window.ConDataRegistry = ConDataRegistry;
}

export default ConDataRegistry;