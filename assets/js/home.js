// Path:    assets/js/home.js
// Purpose: Home page renderer — fast-path + carousel arrows (v4.2)
// Used by: home/index.html
//
// v4.2 arrow redesign:
//   Replaced circle button arrows with full-height gradient strip arrows.
//   Click anywhere on the strip to scroll — no small hit target to miss.
//   Strip is a gradient overlay (white→transparent) so card content stays
//   readable underneath. Icon sits in a small pill inside the strip.
//   scroll-padding-inline-start added to track so snapped cards land with
//   breathing room instead of flushing against the viewport edge.

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
  // Primary path: Clipboard API (HTTPS / modern browsers)
  try { await navigator.clipboard.writeText(text); return true; } catch { /* try legacy fallback */ }
  // Legacy fallback: execCommand — deprecated but still works in older browsers.
  // NOTE: execCommand('copy') returns false in many modern browsers even when the
  // copy succeeded (the return value is unreliable). We therefore assume success
  // if no exception was thrown, and return true unconditionally from this branch.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    document.execCommand('copy'); // return value intentionally ignored — unreliable
    document.body.removeChild(ta);
    return true; // assume success if no exception thrown
  } catch { return false; }
}

// ─────────────────────────────────────────────────────────
// CSS INJECTION
// Only called once; idempotent.
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
      /* Clip the gradient strips to the wrapper boundary */
      overflow: hidden;
      border-radius: var(--fv-radius-lg, 12px);
    }

    /* ════════════════════════════════════════════════════
       SCROLL ARROW STRIPS  v4.2
       ─────────────────────────────────────────────────
       Design: full-height gradient strips instead of
       circle buttons. Click anywhere on the strip to
       scroll — no small hit target to miss.

       Structure:
         .carousel-arrow        — the strip itself (button)
           └── .ca-icon-wrap    — centred pill housing the chevron

       The strip background is a gradient so card content
       remains readable underneath (not a solid block).
       The icon pill adds contrast so the chevron is visible
       against any card colour.

       Touch: touch-action:manipulation removes the 300ms
       delay and prevents the double-tap zoom that was
       misfiring arrow taps as card copy actions.
    ════════════════════════════════════════════════════ */

    /* -- Strip base ---------------------------------- */
    .carousel-arrow {
      position: absolute;
      top: 0;
      bottom: 0;
      height: 100%;

      /* Strip width — 44px matches Apple HIG minimum touch target */
      width: 44px;

      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: center;

      border: none;
      margin: 0;
      padding: 0;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;

      /*
       * touch-action: manipulation — removes 300ms tap delay
       * on mobile and disables double-tap-to-zoom on the strip.
       */
      touch-action: manipulation;

      /* Start hidden; JS adds .visible when scroll is possible */
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.22s ease;

      /* No outline — we add focus-visible below */
      outline: none;
    }

    .carousel-arrow.visible {
      opacity: 1;
      pointer-events: auto;
    }

    /* -- Left strip: white → transparent ------------ */
    .carousel-arrow--left {
      left: 0;
      background: linear-gradient(
        to right,
        rgba(255, 255, 255, 0.96) 0%,
        rgba(255, 255, 255, 0.80) 38%,
        rgba(255, 255, 255, 0.30) 68%,
        rgba(255, 255, 255, 0.00) 100%
      );
      justify-content: flex-start;
      padding-left: 4px;
    }

    /* -- Right strip: transparent → white ----------- */
    .carousel-arrow--right {
      right: 0;
      background: linear-gradient(
        to left,
        rgba(255, 255, 255, 0.96) 0%,
        rgba(255, 255, 255, 0.80) 38%,
        rgba(255, 255, 255, 0.30) 68%,
        rgba(255, 255, 255, 0.00) 100%
      );
      justify-content: flex-end;
      padding-right: 4px;
    }

    /* Deepen the gradient slightly on hover for feedback */
    .carousel-arrow--left:hover {
      background: linear-gradient(
        to right,
        rgba(255, 255, 255, 1.00) 0%,
        rgba(255, 255, 255, 0.88) 42%,
        rgba(255, 255, 255, 0.20) 72%,
        rgba(255, 255, 255, 0.00) 100%
      );
    }
    .carousel-arrow--right:hover {
      background: linear-gradient(
        to left,
        rgba(255, 255, 255, 1.00) 0%,
        rgba(255, 255, 255, 0.88) 42%,
        rgba(255, 255, 255, 0.20) 72%,
        rgba(255, 255, 255, 0.00) 100%
      );
    }

    /* -- Icon pill ----------------------------------- */
    /*
     * Small pill/circle that houses the chevron SVG.
     * Gives the arrow a distinct focal point against
     * any card colour behind the gradient.
     */
    .ca-icon-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      flex-shrink: 0;

      background: rgba(255, 255, 255, 0.92);
      border: 1.5px solid rgba(14, 176, 213, 0.18);
      box-shadow: 0 2px 8px rgba(6, 20, 40, 0.10);

      color: #3a4a5a;
      transition: background 0.15s ease, color 0.15s ease,
                  border-color 0.15s ease, transform 0.15s ease,
                  box-shadow 0.15s ease;
    }

    .carousel-arrow:hover .ca-icon-wrap {
      background: #fff;
      color: var(--brand-1, #13b47f);
      border-color: rgba(19, 180, 127, 0.35);
      box-shadow: 0 3px 12px rgba(19, 180, 127, 0.18);
      transform: scale(1.08);
    }

    .carousel-arrow:active .ca-icon-wrap {
      transform: scale(0.93);
      transition-duration: 0.06s;
    }

    .carousel-arrow:focus-visible .ca-icon-wrap {
      outline: 2px solid var(--brand-1, #13b47f);
      outline-offset: 2px;
    }

    .ca-icon-wrap svg {
      display: block;
      pointer-events: none;
      flex-shrink: 0;
    }

    @media (max-width: 600px) {
      .carousel-arrow {
        width: 40px;
      }
      .ca-icon-wrap {
        width: 28px;
        height: 28px;
      }
    }

    /* ════════════════════════════════════════════════════
       Remove the old pseudo-element fade overlays —
       the gradient strips now serve this purpose.
    ════════════════════════════════════════════════════ */
    .carousel-wrapper::before,
    .carousel-wrapper::after {
      display: none !important;
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
// CAROUSEL ARROWS — v4.2 full-height gradient strip design
//
// Arrow visibility: IntersectionObserver watches the FIRST and
// LAST .item-card in the track directly (threshold:0.5).
//
//   firstCard ≥50% visible → at left edge → hide left strip
//   lastCard  ≥50% visible → at right edge → hide right strip
//
// Arrow click: stopPropagation prevents the event bubbling to
// any card that might sit behind the strip in the layout.
// ─────────────────────────────────────────────────────────

function getCardStep(track) {
  const card = track.querySelector('.item-card');
  if (!card) return 200;
  const gap = parseFloat(getComputedStyle(track).columnGap || '0') || 16;
  return card.offsetWidth + gap;
}

/**
 * Builds a full-height gradient strip arrow button.
 * The button IS the strip — click anywhere on it to scroll.
 * A small icon pill sits inside for visual affordance.
 */
function buildArrowBtn(dir) {
  const btn = document.createElement('button');
  btn.type      = 'button';
  btn.className = `carousel-arrow carousel-arrow--${dir}`;
  btn.setAttribute('aria-label', dir === 'left' ? 'Scroll left' : 'Scroll right');

  // Chevron path differs by direction
  const d = dir === 'left' ? 'M11 4L5 9l6 5' : 'M7 4l6 5-6 5';

  // Icon pill — the only solid element inside the transparent strip
  const pill = document.createElement('span');
  pill.className = 'ca-icon-wrap';
  pill.setAttribute('aria-hidden', 'true');
  pill.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 18 18"
         fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="${d}" stroke="currentColor" stroke-width="2.5"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  btn.appendChild(pill);
  return btn;
}

/**
 * Attaches scroll-strip arrows + IntersectionObserver to a carousel.
 *
 * Performance contract:
 *  - Zero scroll event listeners.
 *  - One IntersectionObserver per carousel (observing 2 card elements).
 *  - IO fires only on boundary crossing — not per frame.
 *  - DOM reads (getCardStep) happen only on arrow click.
 */
function attachCarouselArrows(wrapper, track) {
  const btnLeft  = buildArrowBtn('left');
  const btnRight = buildArrowBtn('right');
  wrapper.appendChild(btnLeft);
  wrapper.appendChild(btnRight);

  btnLeft.addEventListener('click', (e) => {
    e.stopPropagation();
    track.scrollBy({ left: -getCardStep(track), behavior: 'smooth' });
  });
  btnRight.addEventListener('click', (e) => {
    e.stopPropagation();
    track.scrollBy({ left: getCardStep(track), behavior: 'smooth' });
  });

  // Observe first and last card directly.
  const cards     = track.querySelectorAll('.item-card');
  const firstCard = cards[0];
  const lastCard  = cards[cards.length - 1];

  if (!firstCard || firstCard === lastCard) return;

  const io = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (target === firstCard) {
        btnLeft.classList.toggle('visible', !isIntersecting);
      } else {
        btnRight.classList.toggle('visible', !isIntersecting);
      }
    }
  }, {
    root: track,
    threshold: 0.5,
  });

  io.observe(firstCard);
  io.observe(lastCard);
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
    const ok = await copyToClipboard(item.text || '');
    if (!ok) return;

    /*
     * showCopyNotification is loaded via `defer` script (copyNotification.js).
     * home.js is `type="module"` which defers to after the document is parsed,
     * roughly the same time as defer scripts — execution order is browser-dependent.
     *
     * Strategy:
     *   1. Direct call if already available (most common case).
     *   2. Double-rAF: gives the browser two paint frames — defer scripts always
     *      complete within one frame after DOMContentLoaded.
     *   3. setTimeout(0) final backstop for any edge-case browser scheduling.
     */
    const notify = () =>
      window.showCopyNotification?.({ text: item.text, name: itemName, typeId, lang });

    if (typeof window.showCopyNotification === 'function') {
      notify();
    } else {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (typeof window.showCopyNotification === 'function') { notify(); }
          else { setTimeout(notify, 0); }
        })
      );
    }
  };
  card.addEventListener('click', handleCopy);
  card.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); handleCopy(); }
  });
  return card;
}

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

  /*
   * carousel-wrapper: position:relative + overflow:hidden.
   * The strips are clipped to the wrapper so they don't
   * bleed into adjacent category sections.
   */
  const wrapper = document.createElement('div');
  wrapper.className = 'carousel-wrapper content';

  const container = document.createElement('div');
  container.className = 'carousel-container';
  const track = document.createElement('div');
  track.className = 'carousel-track';
  container.appendChild(track);
  wrapper.appendChild(container);
  section.appendChild(wrapper);

  const frag = document.createDocumentFragment();
  (category.data || []).slice(0, HOME_CONFIG.MAX_ITEMS_PER_CATEGORY).forEach(item => {
    frag.appendChild(buildItemCard(item, typeId, lang));
  });
  frag.appendChild(buildViewAllCard(typeId));
  track.appendChild(frag);

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
// FAST DATA FETCH — starts immediately at script parse time
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