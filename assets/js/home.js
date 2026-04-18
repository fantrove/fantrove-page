// home.js  v3.0.0
// =========================================================
// Home page renderer — ใช้ ConDataService แทน db.min.json
//
// สิ่งที่เปลี่ยนจาก v2:
//  - ดึงข้อมูลผ่าน ConDataService.getAssembled() แทน fetch ตรง
//  - จำกัดแต่ละ category แสดงสูงสุด MAX_ITEMS_PER_CATEGORY รายการ
//  - เพิ่ม "View All" card ท้าย carousel แต่ละ category
//  - inject CSS สำหรับ component ใหม่ในไฟล์เดียว
//  - ยังรองรับหลายภาษาเหมือนเดิม
// =========================================================

// =========================================================
// CONFIG
// =========================================================
const HOME_CONFIG = {
  /** จำนวนรายการสูงสุดต่อ category ที่แสดงใน carousel */
  MAX_ITEMS_PER_CATEGORY: 20,
  /** จำนวน category สูงสุดต่อ type ที่แสดง */
  MAX_CATEGORIES_PER_TYPE: 4,
  /** path ของ ConDataService module */
  SERVICE_PATH: '/assets/js/con-data-service/con-data-service.js',
};

// =========================================================
// VIEW ALL — URL & LABEL CONFIG
// =========================================================
const VIEW_ALL_CONFIGS = {
  emoji: {
    url: '/data/verse/discover/?type=emojis&page=1',
    labels: { th: 'ดูอีโมจิทั้งหมด', en: 'View All Emojis' }
  },
  symbol: {
    url: '/data/verse/discover/?type=special-characters__&page=1',
    labels: { th: 'ดูสัญลักษณ์ทั้งหมด', en: 'View All Symbols' }
  },
  // fallback สำหรับ type อื่นๆ ที่อาจเพิ่มในอนาคต
  _default: {
    url: '/data/verse/discover/',
    labels: { th: 'ดูทั้งหมด', en: 'View All' }
  }
};

// =========================================================
// LANGUAGE HELPERS
// =========================================================

function getLang() {
  return localStorage.getItem('selectedLang') || 'en';
}

function pickLang(obj, lang) {
  if (!obj || typeof obj !== 'object') return String(obj || '');
  return obj[lang] || obj.en || obj.th || Object.values(obj)[0] || '';
}

function getViewAllConfig(typeId) {
  return VIEW_ALL_CONFIGS[typeId] || VIEW_ALL_CONFIGS._default;
}

function getViewAllLabel(typeId) {
  const lang = getLang();
  const cfg = getViewAllConfig(typeId);
  return cfg.labels[lang] || cfg.labels.en || 'View All';
}

function getViewAllUrl(typeId) {
  return getViewAllConfig(typeId).url;
}

// =========================================================
// CLIPBOARD
// =========================================================

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback สำหรับ browser เก่า
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

// =========================================================
// CSS INJECTION — View All Card Styles
// inject เพียงครั้งเดียว
// =========================================================

function injectViewAllStyles() {
  if (document.getElementById('home-view-all-styles')) return;

  const style = document.createElement('style');
  style.id = 'home-view-all-styles';
  style.textContent = `
    /* ── View All Card ── */
    .item-card--view-all {
      text-decoration: none;
      background: linear-gradient(145deg, #f0fdf9 0%, #eef4ff 100%);
      border: 1.5px dashed #a8ddd0;
      color: var(--brand-1);
      justify-content: center;
      gap: 0.55rem;
      flex-shrink: 0;
      transition: border-color 0.15s, background 0.15s, transform 0.15s;
    }

    .item-card--view-all:hover {
      border-color: var(--brand-1);
      background: linear-gradient(145deg, #e4fbf5 0%, #e8f0ff 100%);
      transform: translateY(-2px) translateZ(0);
    }

    /* วงกลม + ลูกศร */
    .view-all-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: linear-gradient(135deg, #13b47f22 0%, #11c3ec22 100%);
      border: 1.5px solid #13b47f44;
      color: var(--brand-1);
      transition: background 0.15s, transform 0.2s ease;
      margin-bottom: 0.05rem;
    }

    .item-card--view-all:hover .view-all-icon {
      background: linear-gradient(135deg, #13b47f33 0%, #11c3ec33 100%);
      transform: translateX(2px);
    }

    .view-all-icon svg {
      display: block;
      flex-shrink: 0;
    }

    /* ข้อความ View All */
    .view-all-label {
      font-size: 0.8em !important;
      font-weight: 700 !important;
      color: var(--brand-1) !important;
      background: transparent !important;
      padding: 0.2em 0.4em !important;
      border-radius: 25px !important;
      text-align: center;
      white-space: normal !important;
      line-height: 1.25;
      letter-spacing: 0.015em;
    }

    /* ── Loading placeholder ── */
    .home-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.8rem;
      padding: 3rem 1rem;
      color: #8ea1b8;
      font-size: 0.95rem;
    }

    .home-loading-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #13b47f;
      animation: home-bounce 1.2s infinite ease-in-out;
    }
    .home-loading-dot:nth-child(2) { animation-delay: 0.2s; }
    .home-loading-dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes home-bounce {
      0%, 80%, 100% { transform: scale(0.7); opacity: 0.5; }
      40%            { transform: scale(1.1); opacity: 1;   }
    }

    /* ── Error state ── */
    .home-error {
      padding: 2rem 1rem;
      border-radius: 20px;
      background: #fff5f5;
      border: 1.5px solid #ffd0d0;
      color: #c0392b;
      font-size: 0.95rem;
      text-align: center;
    }
    .home-error small {
      display: block;
      margin-top: 0.4rem;
      color: #ff8a8a;
      font-family: monospace;
      font-size: 0.82em;
    }
  `;

  document.head.appendChild(style);
}

// =========================================================
// DOM BUILDERS
// =========================================================

/**
 * สร้าง item card ปกติ
 */
function buildItemCard(item, typeId, lang) {
  const itemName = pickLang(item.name, lang);

  const card = document.createElement('div');
  card.className = 'item-card';
  card.title = itemName;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `คัดลอก ${itemName}`);

  const emojiEl = document.createElement('span');
  emojiEl.className = 'emoji';
  emojiEl.textContent = item.text || '';

  const nameEl = document.createElement('span');
  nameEl.className = 'name';
  nameEl.textContent = itemName;

  card.appendChild(emojiEl);
  card.appendChild(nameEl);

  const handleCopy = async () => {
    const copied = await copyToClipboard(item.text || '');
    if (copied && typeof window.showCopyNotification === 'function') {
      window.showCopyNotification({ text: item.text, name: itemName, typeId, lang });
    }
  };

  card.addEventListener('click', handleCopy);
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCopy(); }
  });

  return card;
}

/**
 * สร้าง "View All" card ท้าย carousel
 * — วงกลมลูกศร + ข้อความด้านล่าง
 */
function buildViewAllCard(typeId) {
  const url   = getViewAllUrl(typeId);
  const label = getViewAllLabel(typeId);

  const card = document.createElement('a');
  card.className = 'item-card item-card--view-all';
  card.href = url;
  card.title = label;
  card.setAttribute('aria-label', label);

  // วงกลม + SVG ลูกศร
  const iconWrap = document.createElement('span');
  iconWrap.className = 'view-all-icon';
  iconWrap.setAttribute('aria-hidden', 'true');
  iconWrap.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8.5 11h6m-2.8-2.8L14 11l-2.3 2.8"
            stroke="currentColor" stroke-width="1.7"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  // ป้ายชื่อ (ใช้ class .name เพื่อให้ inherit style เดิม + override)
  const labelEl = document.createElement('span');
  labelEl.className = 'name view-all-label';
  labelEl.textContent = label;

  card.appendChild(iconWrap);
  card.appendChild(labelEl);

  return card;
}

/**
 * สร้าง section ของ category เดียว (heading + carousel)
 */
function buildCategorySection(category, typeId, lang) {
  const section = document.createElement('div');
  section.className = 'category-section';

  // heading
  const heading = document.createElement('h2');
  heading.textContent = pickLang(category.name, lang);
  section.appendChild(heading);

  // carousel wrapper
  const container = document.createElement('div');
  container.className = 'carousel-container';

  const track = document.createElement('div');
  track.className = 'carousel-track';
  container.appendChild(track);
  section.appendChild(container);

  // items (จำกัด MAX_ITEMS_PER_CATEGORY)
  const items = (category.data || []).slice(0, HOME_CONFIG.MAX_ITEMS_PER_CATEGORY);
  items.forEach(item => track.appendChild(buildItemCard(item, typeId, lang)));

  // View All card ท้าย track
  track.appendChild(buildViewAllCard(typeId));

  return section;
}

/**
 * สร้าง section ของ type (header + categories)
 */
function buildTypeSection(typeObj, lang) {
  const wrapper = document.createElement('div');

  // ── Header ──
  const header = document.createElement('div');
  header.className = 'text-h';

  const title = document.createElement('h1');
  title.textContent = pickLang(typeObj.name, lang);
  header.appendChild(title);

  const viewAllBtn = document.createElement('a');
  viewAllBtn.href = getViewAllUrl(typeObj.id);
  viewAllBtn.className = 'button button-secondary';
  viewAllBtn.setAttribute('aria-label', getViewAllLabel(typeObj.id));
  viewAllBtn.innerHTML = `<span class="btn-content">${getViewAllLabel(typeObj.id)}</span>`;
  header.appendChild(viewAllBtn);

  wrapper.appendChild(header);

  // ── Categories ──
  const categories = (typeObj.category || []).slice(0, HOME_CONFIG.MAX_CATEGORIES_PER_TYPE);
  categories.forEach(cat => {
    wrapper.appendChild(buildCategorySection(cat, typeObj.id, lang));
  });

  return wrapper;
}

/**
 * สร้าง loading state
 */
function buildLoadingState() {
  const el = document.createElement('div');
  el.className = 'home-loading';
  el.innerHTML = `
    <span class="home-loading-dot"></span>
    <span class="home-loading-dot"></span>
    <span class="home-loading-dot"></span>
  `;
  return el;
}

/**
 * สร้าง error state
 */
function buildErrorState(message, detail = '') {
  const el = document.createElement('div');
  el.className = 'home-error';
  el.innerHTML = `
    <strong>${message}</strong>
    ${detail ? `<small>${detail}</small>` : ''}
  `;
  return el;
}

// =========================================================
// MAIN — initializeHomepage
// =========================================================

async function initializeHomepage() {
  const app = document.getElementById('app');
  if (!app) return;

  // inject styles ก่อน render
  injectViewAllStyles();

  // แสดง loading state
  app.innerHTML = '';
  app.appendChild(buildLoadingState());

  const lang = getLang();

  try {
    // ── โหลด ConDataService ผ่าน dynamic import ──
    const { default: ConDataService } = await import(HOME_CONFIG.SERVICE_PATH);

    // ── ดึงข้อมูล assembled ──
    const assembled = await ConDataService.getAssembled();

    if (!assembled || !Array.isArray(assembled.type) || assembled.type.length === 0) {
      throw new Error(lang === 'th' ? 'ไม่พบข้อมูล' : 'No data found');
    }

    // ── render ──
    app.innerHTML = '';
    assembled.type.forEach(typeObj => {
      app.appendChild(buildTypeSection(typeObj, lang));
    });

  } catch (error) {
    console.error('[home.js] initializeHomepage error:', error);

    const msg = lang === 'th'
      ? 'เกิดข้อผิดพลาด: ไม่สามารถโหลดข้อมูลได้'
      : 'Error: Unable to load data';

    app.innerHTML = '';
    app.appendChild(buildErrorState(msg, error.message));
  }
}

// ── kick off ──
initializeHomepage();