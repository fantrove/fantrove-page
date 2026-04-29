// home.js  v3.4.0
// =========================================================
// Home page renderer — fast-path + carousel arrows
//
// v3.4 changes:
//  - Circular arrow buttons: fixed min-width/min-height/padding/box-sizing
//    เพื่อป้องกัน flex layout ทำให้ปุ่มกลายเป็นวงรี
//  - Card-aligned scroll: คำนวณจำนวน card ที่มองเห็นได้จริง
//    แล้ว scroll ทีละ (visibleCount - 1) card เพื่อรักษา visual context
//    และไม่ทิ้ง card ค้างระหว่างกลาง
// =========================================================

// ─────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────
const HOME_CONFIG = {
  MAX_ITEMS_PER_CATEGORY : 20,
  MAX_CATEGORIES_PER_TYPE: 4,
  SERVICE_PATH: '/assets/js/con-data-service/con-data-service.js',
  INDEX_PATH  : '/assets/db/con-data/index.json',
};

// ─────────────────────────────────────────────────────────
// VIEW ALL CONFIG
// ─────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────
// LANGUAGE
// ─────────────────────────────────────────────────────────
const getLang = () =>
  (typeof localStorage !== 'undefined' && localStorage.getItem('selectedLang')) || 'en';

function pickLang(obj, lang) {
  if (!obj || typeof obj !== 'object') return String(obj || '');
  return obj[lang] || obj.en || obj.th || Object.values(obj)[0] || '';
}

const getViewAllCfg   = id => VIEW_ALL_CONFIGS[id] || VIEW_ALL_CONFIGS._default;
const getViewAllLabel = id => { const l = getLang(); return getViewAllCfg(id).labels[l] || getViewAllCfg(id).labels.en; };
const getViewAllUrl   = id => getViewAllCfg(id).url;

// ─────────────────────────────────────────────────────────
// CLIPBOARD
// ─────────────────────────────────────────────────────────
async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fallback */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

// ─────────────────────────────────────────────────────────
// CSS INJECTION
// ─────────────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById('home-extra-styles')) return;
  const s = document.createElement('style');
  s.id = 'home-extra-styles';
  s.textContent = `
    /* ════════════════════════════════════════════════════
       VIEW ALL CARD
    ════════════════════════════════════════════════════ */
    .item-card--view-all {
      text-decoration: none;
      background: linear-gradient(160deg, #f0fdf9 0%, #f5f0ff 100%);
      border-color: #c8ede4;
      color: var(--brand-1);
      position: relative;
      overflow: hidden;
    }

    .item-card--view-all::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(
        105deg,
        transparent 35%,
        rgba(255,255,255,0.55) 50%,
        transparent 65%
      );
      background-size: 200% 100%;
      background-position: -100% 0;
      transition: background-position 0.55s ease;
      pointer-events: none;
    }
    .item-card--view-all:hover::before {
      background-position: 200% 0;
    }

    .item-card--view-all:hover {
      border-color: var(--brand-1);
      background: linear-gradient(160deg, #e8fbf5 0%, #ede8ff 100%);
    }

    .view-all-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 42px;
      height: 42px;
      border-radius: 50%;
      background: linear-gradient(135deg, #13b47f26, #9B6EFF22);
      border: 1.5px solid #13b47f55;
      color: var(--brand-1);
      transition: transform 0.2s ease, background 0.2s;
      margin-bottom: 0.12rem;
      flex-shrink: 0;
    }
    .item-card--view-all:hover .view-all-icon {
      background: linear-gradient(135deg, #13b47f40, #9B6EFF35);
      transform: translateX(3px);
    }
    .view-all-icon svg { display: block; }

    .view-all-label {
      white-space: normal  !important;
      text-align: center;
      line-height: 1.25;
      font-size: 0.82em !important;
      letter-spacing: 0.02em;
      color: var(--brand-1) !important;
      background: rgba(19,180,127,0.08) !important;
      border: 1px solid rgba(19,180,127,0.15) !important;
    }

    /* ════════════════════════════════════════════════════
       CAROUSEL WRAPPER
    ════════════════════════════════════════════════════ */
    .carousel-wrapper {
      position: relative;
    }

    /* ════════════════════════════════════════════════════
       SCROLL ARROWS
       FIX v3.4: min-width/min-height/padding:0/box-sizing
       ป้องกัน flex container ยืด button ให้เป็นวงรี
    ════════════════════════════════════════════════════ */
    .carousel-arrow {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      z-index: 10;

      /* Perfect circle — ต้องล็อค width = height ทุกกรณี */
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      min-width: 36px;   /* ป้องกัน flex shrink */
      min-height: 36px;  /* ป้องกัน flex shrink */
      padding: 0;        /* ลบ default browser button padding */
      box-sizing: border-box;

      border-radius: 50%;
      border: none;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;

      background: rgba(255,255,255,0.82);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      box-shadow: 0 2px 12px rgba(6,20,40,0.10), 0 0 0 1px rgba(14,176,213,0.10);
      color: #3a4a5a;

      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s, transform 0.15s, background 0.15s;

      /* Prevent outline from breaking circle shape */
      outline: none;
    }

    .carousel-arrow.visible {
      opacity: 1;
      pointer-events: auto;
    }

    .carousel-arrow:hover {
      background: rgba(255,255,255,0.97);
      color: var(--brand-1);
      /* รักษา translateY(-50%) ไว้ ต่อท้ายด้วย scale */
      transform: translateY(-50%) scale(1.08);
      box-shadow: 0 4px 18px rgba(19,180,127,0.18), 0 0 0 1.5px rgba(19,180,127,0.25);
    }

    .carousel-arrow:active {
      transform: translateY(-50%) scale(0.97);
    }

    .carousel-arrow:focus-visible {
      outline: 2px solid var(--brand-1, #13b47f);
      outline-offset: 2px;
    }

    .carousel-arrow svg {
      display: block;
      pointer-events: none;
      /* SVG ไม่ควรมี flex grow/shrink */
      flex-shrink: 0;
    }

    .carousel-arrow--left  { left: 4px;  }
    .carousel-arrow--right { right: 4px; }

    /* Fade-edge แสดงว่ายังมีเนื้อหา */
    .carousel-wrapper::after,
    .carousel-wrapper::before {
      content: '';
      position: absolute;
      top: 0; bottom: 0;
      width: 40px;
      pointer-events: none;
      z-index: 5;
      opacity: 0;
      transition: opacity 0.25s;
    }
    .carousel-wrapper::before {
      left: 0;
      background: linear-gradient(to right, rgba(255,255,255,0.7), transparent);
    }
    .carousel-wrapper::after {
      right: 0;
      background: linear-gradient(to left, rgba(255,255,255,0.7), transparent);
    }
    .carousel-wrapper.can-left::before  { opacity: 1; }
    .carousel-wrapper.can-right::after  { opacity: 1; }

    /* Mobile */
    @media (max-width: 600px) {
      .carousel-arrow {
        width: 32px;
        height: 32px;
        min-width: 32px;
        min-height: 32px;
      }
    }

    /* Error state */
    .home-error {
      padding: 2rem 1rem; border-radius: 20px;
      background: #fff5f5; border: 1.5px solid #ffd0d0;
      color: #c0392b; font-size: .95rem; text-align: center;
    }
    .home-error small {
      display: block; margin-top: .4rem;
      color: #ff8a8a; font-family: monospace; font-size: .82em;
    }
  `;
  document.head.appendChild(s);
}

// ─────────────────────────────────────────────────────────
// ORDERING FIX
// ─────────────────────────────────────────────────────────
async function fetchIdOrder(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    return (j.categories || j.category || []).map(c => c.id);
  } catch { return null; }
}

async function reorderAssembled(assembled) {
  if (!assembled?.type?.length) return assembled;
  const typeIds = assembled.type.map(t => t.id);
  const [typeOrder, ...catOrders] = await Promise.all([
    fetchIdOrder(HOME_CONFIG.INDEX_PATH),
    ...typeIds.map(id => fetchIdOrder(`/assets/db/con-data/${id}.json`)),
  ]);
  if (typeOrder?.length) {
    assembled.type.sort((a, b) => {
      const ai = typeOrder.indexOf(a.id), bi = typeOrder.indexOf(b.id);
      return (ai < 0 ? 9999 : ai) - (bi < 0 ? 9999 : bi);
    });
  }
  assembled.type.forEach(typeObj => {
    const catOrder = catOrders[typeIds.indexOf(typeObj.id)];
    if (!catOrder?.length || !typeObj.category?.length) return;
    typeObj.category.sort((a, b) => {
      const ai = catOrder.indexOf(a.id), bi = catOrder.indexOf(b.id);
      return (ai < 0 ? 9999 : ai) - (bi < 0 ? 9999 : bi);
    });
  });
  return assembled;
}

// ─────────────────────────────────────────────────────────
// CAROUSEL SCROLL — Card-aligned scrolling
// ─────────────────────────────────────────────────────────

/**
 * คำนวณระยะ scroll ที่ align กับขอบ card เสมอ
 *
 * แนวคิด: นับว่า track แสดง card ได้กี่ใบ แล้ว scroll ทีละ
 * (visibleCount - 1) ใบ เพื่อรักษา card สุดท้ายเป็น visual anchor
 *
 * ผลลัพธ์:
 *  - ไม่มี card ถูก "ตัดครึ่ง" หลัง scroll
 *  - บน mobile ที่มีพื้นที่น้อย จะ scroll ทีละ 1 card
 *  - บน desktop scroll ทีละหลาย card ตามพื้นที่จริง
 */
function calcScrollDistance(track) {
  const firstCard = track.querySelector('.item-card');
  if (!firstCard) return track.clientWidth * 0.75;

  const cardW = firstCard.offsetWidth;
  const trackStyle = getComputedStyle(track);
  const gap = parseFloat(trackStyle.columnGap || trackStyle.gap || '0') || 16;
  const step = cardW + gap;

  // จำนวน card ที่มองเห็นได้ครบ ใน viewport ปัจจุบัน
  const visibleCount = Math.max(1, Math.floor((track.clientWidth + gap) / step));

  // Scroll ทีละ (visibleCount - 1) เพื่อ overlap 1 card เป็น context
  const scrollCards = Math.max(1, visibleCount - 1);
  return Math.round(step * scrollCards);
}

/**
 * อัปเดต visibility ของ arrows และ fade-edge
 * เรียกผ่าน rAF เพื่อ batch DOM reads
 */
function updateArrows(track, wrapper, btnLeft, btnRight) {
  const sl    = track.scrollLeft;
  const maxSL = track.scrollWidth - track.clientWidth;

  // ใช้ threshold เล็กน้อย (2px) เพื่อรองรับ subpixel rounding
  const canLeft  = sl > 2;
  const canRight = sl < maxSL - 2;

  btnLeft.classList.toggle('visible', canLeft);
  btnRight.classList.toggle('visible', canRight);
  wrapper.classList.toggle('can-left',  canLeft);
  wrapper.classList.toggle('can-right', canRight);
}

/**
 * สร้าง arrow button ด้วย SVG ลูกศร
 *
 * FIX v3.4: ใช้ viewBox="0 0 18 18" (square) เพื่อให้ icon
 * ตรงกลางของปุ่มวงกลมพอดี ไม่ทำให้ปุ่มผิดรูป
 */
function buildArrowBtn(dir) {
  const btn = document.createElement('button');
  btn.type      = 'button';
  btn.className = `carousel-arrow carousel-arrow--${dir}`;
  btn.setAttribute('aria-label', dir === 'left' ? 'Scroll left' : 'Scroll right');

  /*
   * Chevron paths สำหรับ viewBox 18×18 (square)
   * Left  < : M12 4 → 6 9 → l6 5
   * Right > : M6 4 → l6 5 → -6 5
   */
  const d = dir === 'left'
    ? 'M12 4L6 9l6 5'
    : 'M6 4l6 5-6 5';

  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 18 18"
         fill="none" xmlns="http://www.w3.org/2000/svg"
         aria-hidden="true" focusable="false">
      <path d="${d}" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
  return btn;
}

/**
 * ผูก arrow scroll logic กับ carousel track
 * เรียกหลังจาก track มี DOM content แล้ว
 */
function attachCarouselArrows(wrapper, track) {
  const btnLeft  = buildArrowBtn('left');
  const btnRight = buildArrowBtn('right');
  wrapper.appendChild(btnLeft);
  wrapper.appendChild(btnRight);

  // Click → scroll ด้วยระยะที่ align กับ card boundary
  btnLeft.addEventListener('click', () => {
    const dist = calcScrollDistance(track);
    track.scrollBy({ left: -dist, behavior: 'smooth' });
  });
  btnRight.addEventListener('click', () => {
    const dist = calcScrollDistance(track);
    track.scrollBy({ left: dist, behavior: 'smooth' });
  });

  // Scroll → update arrow visibility (debounced via rAF)
  let rafId = null;
  const onScroll = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      updateArrows(track, wrapper, btnLeft, btnRight);
      rafId = null;
    });
  };
  track.addEventListener('scroll', onScroll, { passive: true });

  // Initial state — defer เพื่อให้ layout settle
  requestAnimationFrame(() => updateArrows(track, wrapper, btnLeft, btnRight));
}

// ─────────────────────────────────────────────────────────
// DOM BUILDERS
// ─────────────────────────────────────────────────────────

function buildItemCard(item, typeId, lang) {
  const itemName = pickLang(item.name, lang);
  const card = document.createElement('div');
  card.className = 'item-card';
  card.title = itemName;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `คัดลอก ${itemName}`);

  const e = document.createElement('div'); e.className = 'emoji'; e.textContent = item.text || '';
  const n = document.createElement('div'); n.className = 'name';  n.textContent = itemName;
  card.appendChild(e);
  card.appendChild(n);

  const handleCopy = async () => {
    if (await copyToClipboard(item.text || '') && typeof window.showCopyNotification === 'function') {
      window.showCopyNotification({ text: item.text, name: itemName, typeId, lang });
    }
  };
  card.addEventListener('click', handleCopy);
  card.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); handleCopy(); }
  });
  return card;
}

/** View All card — สวยงาม แตกต่าง แต่ยังกลมกลืน */
function buildViewAllCard(typeId) {
  const label = getViewAllLabel(typeId);
  const card  = document.createElement('a');
  card.className = 'item-card item-card--view-all';
  card.href  = getViewAllUrl(typeId);
  card.title = label;
  card.setAttribute('aria-label', label);

  const icon = document.createElement('span');
  icon.className = 'view-all-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 10h11M11.5 6 16 10l-4.5 4" stroke="currentColor"
            stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  const lbl = document.createElement('div');
  lbl.className = 'name view-all-label';
  lbl.textContent = label;

  card.appendChild(icon);
  card.appendChild(lbl);
  return card;
}

function buildCategorySection(category, typeId, lang) {
  const section = document.createElement('div');
  section.className = 'category-section';

  const heading = document.createElement('h2');
  heading.textContent = pickLang(category.name, lang);
  section.appendChild(heading);

  // wrapper สำหรับ position:relative ของ arrows
  const wrapper = document.createElement('div');
  wrapper.className = 'carousel-wrapper content';

  const container = document.createElement('div');
  container.className = 'carousel-container';
  const track = document.createElement('div');
  track.className = 'carousel-track';
  container.appendChild(track);
  wrapper.appendChild(container);
  section.appendChild(wrapper);

  // items
  const frag = document.createDocumentFragment();
  (category.data || []).slice(0, HOME_CONFIG.MAX_ITEMS_PER_CATEGORY).forEach(item => {
    frag.appendChild(buildItemCard(item, typeId, lang));
  });
  frag.appendChild(buildViewAllCard(typeId));
  track.appendChild(frag);

  // arrows ผูกหลัง track มี content (ใน rAF เพื่อให้ layout width ถูก)
  requestAnimationFrame(() => attachCarouselArrows(wrapper, track));

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

  const frag = document.createDocumentFragment();
  (typeObj.category || []).slice(0, HOME_CONFIG.MAX_CATEGORIES_PER_TYPE).forEach(cat => {
    frag.appendChild(buildCategorySection(cat, typeObj.id, lang));
  });
  wrapper.appendChild(frag);

  return wrapper;
}

function buildError(msg, detail = '') {
  const el = document.createElement('div');
  el.className = 'home-error';
  el.innerHTML = `<strong>${msg}</strong>${detail ? `<small>${detail}</small>` : ''}`;
  return el;
}

// ─────────────────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────────────────
function renderToApp(assembled, lang) {
  const app = document.getElementById('app');
  if (!app) return;
  injectStyles();
  const frag = document.createDocumentFragment();
  assembled.type.forEach(typeObj => frag.appendChild(buildTypeSection(typeObj, lang)));
  app.innerHTML = '';
  app.appendChild(frag);
}

function renderErrorToApp(msg, detail) {
  const app = document.getElementById('app');
  if (!app) return;
  injectStyles();
  app.innerHTML = '';
  app.appendChild(buildError(msg, detail));
}

// ─────────────────────────────────────────────────────────
// FAST DATA FETCH — เริ่มทันทีที่ script parse
// ─────────────────────────────────────────────────────────
const _dataPromise = (async () => {
  const { default: ConDataService } = await import(HOME_CONFIG.SERVICE_PATH);
  const raw = await ConDataService.getAssembled();
  return reorderAssembled(raw);
})();

// ─────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────
const lang = getLang();

_dataPromise.then(assembled => {
  if (!assembled?.type?.length) throw new Error('No data');
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => renderToApp(assembled, lang), { once: true });
  } else {
    renderToApp(assembled, lang);
  }
}).catch(err => {
  console.error('[home.js] data error:', err);
  const msg = lang === 'th' ? 'เกิดข้อผิดพลาด: ไม่สามารถโหลดข้อมูลได้' : 'Error: Unable to load data';
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => renderErrorToApp(msg, err.message), { once: true });
  } else {
    renderErrorToApp(msg, err.message);
  }
});