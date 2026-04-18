// home.js  v3.1.0
// =========================================================
// Home page renderer — ใช้ ConDataService
//
// v3.1 — แก้ไข:
//  - View All card: สะอาดตากว่าเดิม, blend กับ item card ปกติ
//  - Ordering: sort type/category ตาม index.json หลัง assemble
//    (workaround สำหรับ Promise.all push-race ใน con-data-service)
// =========================================================

// =========================================================
// CONFIG
// =========================================================
const HOME_CONFIG = {
  MAX_ITEMS_PER_CATEGORY : 20,
  MAX_CATEGORIES_PER_TYPE: 4,
  SERVICE_PATH: '/assets/js/con-data-service/con-data-service.js',
  INDEX_PATH  : '/assets/db/con-data/index.json',
};

// =========================================================
// VIEW ALL CONFIG
// =========================================================
const VIEW_ALL_CONFIGS = {
  emoji: {
    url   : '/data/verse/discover/?type=emojis&page=1',
    labels: { th: 'ดูอีโมจิทั้งหมด', en: 'View All Emojis' },
  },
  symbol: {
    url   : '/data/verse/discover/?type=special-characters__&page=1',
    labels: { th: 'ดูสัญลักษณ์ทั้งหมด', en: 'View All Symbols' },
  },
  _default: {
    url   : '/data/verse/discover/',
    labels: { th: 'ดูทั้งหมด', en: 'View All' },
  },
};

// =========================================================
// LANGUAGE
// =========================================================
const getLang = () => localStorage.getItem('selectedLang') || 'en';

function pickLang(obj, lang) {
  if (!obj || typeof obj !== 'object') return String(obj || '');
  return obj[lang] || obj.en || obj.th || Object.values(obj)[0] || '';
}

function getViewAllCfg(typeId)   { return VIEW_ALL_CONFIGS[typeId] || VIEW_ALL_CONFIGS._default; }
function getViewAllLabel(typeId) { const lang = getLang(); return getViewAllCfg(typeId).labels[lang] || getViewAllCfg(typeId).labels.en; }
function getViewAllUrl(typeId)   { return getViewAllCfg(typeId).url; }

// =========================================================
// CLIPBOARD
// =========================================================
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = Object.assign(document.createElement('textarea'), {
        value: text, style: 'position:fixed;opacity:0',
      });
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }
}

// =========================================================
// CSS INJECTION
// =========================================================
function injectStyles() {
  if (document.getElementById('home-extra-styles')) return;

  const style = document.createElement('style');
  style.id = 'home-extra-styles';
  style.textContent = `
    /* ── View All card ─────────────────────────────────────
       กลืนกับ item card ปกติ ต่างกันแค่ icon + ชื่อ
       ไม่มี gimmick, hover เบาๆ เหมือน card ทั่วไป
    ──────────────────────────────────────────────────────── */
    .item-card--view-all {
      text-decoration: none;
      background: #fafcff;
      color: var(--brand-1);
    }
    .item-card--view-all:hover {
      border-color: #00CEB0;
      background: #F6FFFD;
    }

    /* วงกลมเส้นบาง + ลูกศร */
    .view-all-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      border: 1.4px solid currentColor;
      opacity: 0.5;
      transition: opacity 0.15s, transform 0.15s;
      margin-bottom: 0.08rem;
    }
    .item-card--view-all:hover .view-all-icon {
      opacity: 0.85;
      transform: translateX(2px);
    }
    .view-all-icon svg { display: block; }

    /* ป้ายชื่อ */
    .view-all-label {
      white-space: normal  !important;
      text-align: center;
      line-height: 1.25;
      color: var(--brand-1) !important;
      background: #eef8f4   !important;
    }

    /* ── Loading dots ─────────────────────────────────────── */
    .home-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.6rem;
      padding: 3rem 1rem;
    }
    .home-loading-dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: #13b47f;
      animation: hldot 1.1s infinite ease-in-out;
    }
    .home-loading-dot:nth-child(2) { animation-delay: .18s; }
    .home-loading-dot:nth-child(3) { animation-delay: .36s; }
    @keyframes hldot {
      0%,80%,100% { transform: scale(.7); opacity: .4; }
      40%          { transform: scale(1.1); opacity: 1;  }
    }

    /* ── Error state ──────────────────────────────────────── */
    .home-error {
      padding: 2rem 1rem;
      border-radius: 20px;
      background: #fff5f5;
      border: 1.5px solid #ffd0d0;
      color: #c0392b;
      font-size: .95rem;
      text-align: center;
    }
    .home-error small {
      display: block;
      margin-top: .4rem;
      color: #ff8a8a;
      font-family: monospace;
      font-size: .82em;
    }
  `;
  document.head.appendChild(style);
}

// =========================================================
// ORDERING FIX
// =========================================================
// root cause: con-data-service.js ใช้ typeObjs.push() ใน Promise.all
// callback → type ที่ fetch เสร็จเร็วกว่า push ก่อน → เรียงแบบ race
// วิธีแก้ใน home.js: ดึง index.json + typeId.json (ถูก cache แล้ว)
// แล้ว sort assembled.type และ category ให้ตรงกับ index

async function fetchOrder(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const json = await resp.json();
    // รองรับทั้ง { categories: [] } และ { category: [] }
    return (json.categories || json.category || []).map(c => c.id);
  } catch { return null; }
}

async function reorderAssembled(assembled) {
  if (!assembled?.type?.length) return assembled;

  const typeIds = assembled.type.map(t => t.id);

  // ดึง type order และ category order ของแต่ละ type พร้อมกัน
  const [typeOrder, ...catOrders] = await Promise.all([
    fetchOrder(HOME_CONFIG.INDEX_PATH),
    ...typeIds.map(id => fetchOrder(`/assets/db/con-data/${id}.json`)),
  ]);

  // เรียง type
  if (typeOrder?.length) {
    assembled.type.sort((a, b) => {
      const ai = typeOrder.indexOf(a.id);
      const bi = typeOrder.indexOf(b.id);
      return (ai < 0 ? 9999 : ai) - (bi < 0 ? 9999 : bi);
    });
  }

  // เรียง category ภายในแต่ละ type
  assembled.type.forEach((typeObj) => {
    const catOrder = catOrders[typeIds.indexOf(typeObj.id)];
    if (!catOrder?.length || !typeObj.category?.length) return;
    typeObj.category.sort((a, b) => {
      const ai = catOrder.indexOf(a.id);
      const bi = catOrder.indexOf(b.id);
      return (ai < 0 ? 9999 : ai) - (bi < 0 ? 9999 : bi);
    });
  });

  return assembled;
}

// =========================================================
// DOM BUILDERS
// =========================================================

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
    if (await copyToClipboard(item.text || '') && typeof window.showCopyNotification === 'function') {
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
 * View All card — เรียบง่าย กลืนกับ item card
 * structure: วงกลมลูกศร (บน) + ป้ายชื่อ (ล่าง)
 */
function buildViewAllCard(typeId) {
  const label = getViewAllLabel(typeId);
  const url   = getViewAllUrl(typeId);

  const card = document.createElement('a');
  card.className = 'item-card item-card--view-all';
  card.href  = url;
  card.title = label;
  card.setAttribute('aria-label', label);

  const iconEl = document.createElement('span');
  iconEl.className = 'view-all-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 9h7M9.5 6 13 9l-3.5 3"
            stroke="currentColor" stroke-width="1.5"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  const labelEl = document.createElement('span');
  labelEl.className = 'name view-all-label';
  labelEl.textContent = label;

  card.appendChild(iconEl);
  card.appendChild(labelEl);

  return card;
}

function buildCategorySection(category, typeId, lang) {
  const section = document.createElement('div');
  section.className = 'category-section';

  const heading = document.createElement('h2');
  heading.textContent = pickLang(category.name, lang);
  section.appendChild(heading);

  const container = document.createElement('div');
  container.className = 'carousel-container';

  const track = document.createElement('div');
  track.className = 'carousel-track';
  container.appendChild(track);
  section.appendChild(container);

  (category.data || [])
    .slice(0, HOME_CONFIG.MAX_ITEMS_PER_CATEGORY)
    .forEach(item => track.appendChild(buildItemCard(item, typeId, lang)));

  track.appendChild(buildViewAllCard(typeId));

  return section;
}

function buildTypeSection(typeObj, lang) {
  const wrapper = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'text-h';

  const title = document.createElement('h1');
  title.textContent = pickLang(typeObj.name, lang);
  header.appendChild(title);

  const viewAllBtn = document.createElement('a');
  viewAllBtn.href      = getViewAllUrl(typeObj.id);
  viewAllBtn.className = 'button button-secondary';
  viewAllBtn.setAttribute('aria-label', getViewAllLabel(typeObj.id));
  viewAllBtn.innerHTML = `<span class="btn-content">${getViewAllLabel(typeObj.id)}</span>`;
  header.appendChild(viewAllBtn);

  wrapper.appendChild(header);

  (typeObj.category || [])
    .slice(0, HOME_CONFIG.MAX_CATEGORIES_PER_TYPE)
    .forEach(cat => wrapper.appendChild(buildCategorySection(cat, typeObj.id, lang)));

  return wrapper;
}

// =========================================================
// STATE HELPERS
// =========================================================
const buildLoading = () => {
  const el = document.createElement('div');
  el.className = 'home-loading';
  el.innerHTML = '<span class="home-loading-dot"></span>'.repeat(3);
  return el;
};

const buildError = (msg, detail = '') => {
  const el = document.createElement('div');
  el.className = 'home-error';
  el.innerHTML = `<strong>${msg}</strong>${detail ? `<small>${detail}</small>` : ''}`;
  return el;
};

// =========================================================
// INIT
// =========================================================
async function initializeHomepage() {
  const app = document.getElementById('app');
  if (!app) return;

  injectStyles();
  app.innerHTML = '';
  app.appendChild(buildLoading());

  const lang = getLang();

  try {
    const { default: ConDataService } = await import(HOME_CONFIG.SERVICE_PATH);

    // assemble + reorder ตาม index
    const assembled = await reorderAssembled(await ConDataService.getAssembled());

    if (!assembled?.type?.length) throw new Error(lang === 'th' ? 'ไม่พบข้อมูล' : 'No data found');

    app.innerHTML = '';
    assembled.type.forEach(typeObj => app.appendChild(buildTypeSection(typeObj, lang)));

  } catch (err) {
    console.error('[home.js] init error:', err);
    app.innerHTML = '';
    app.appendChild(buildError(
      lang === 'th' ? 'เกิดข้อผิดพลาด: ไม่สามารถโหลดข้อมูลได้' : 'Error: Unable to load data',
      err.message
    ));
  }
}

initializeHomepage();