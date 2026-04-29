// Path:    assets/js/home.js
// Purpose: Home page renderer — fast-path + carousel arrows (v4.1)
// Used by: home/index.html
//
// v4.0 performance overhaul (see git history for details):
//   Removed scroll listener, calcScrollDistance, backdrop-filter, GPU layers.
//   CSS scroll-snap owns card alignment; IntersectionObserver owns arrow state.
//
// v4.1 fixes:
//
//  FIXED  Sentinel IntersectionObserver bug
//         1px sentinels inserted before the first card sat at x=0 in content
//         coordinates. With scroll-padding-inline-start:0, the first card snaps
//         to scrollLeft=0, but the sentinel (0-1px) was treated as marginally
//         outside the scrollport → IO reported "not intersecting" → left arrow
//         stayed visible at the leftmost position.
//         Fix: observe firstCard + lastCard directly (threshold:0.5).
//
//  FIXED  Arrow tap triggering card copy behind button
//         Arrow buttons were 36px / 32px, too small to hit reliably on mobile.
//         Near-miss taps landed directly on a card element, triggering copy.
//         Fix: 44px buttons + touch-action:manipulation + stopPropagation.
//
//  FIXED  Copy notification race condition
//         showCopyNotification (defer script) might not have executed when user
//         clicks very quickly after page load. typeof check returned false on
//         first click, silently discarding the notification.
//         Fix: rAF retry — defer scripts run before the next paint frame.

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
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fallback below */ }
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
    }

    /* ════════════════════════════════════════════════════
       SCROLL ARROWS  v4.1
       - 44×44px minimum tap target (Apple HIG / Material)
       - touch-action: manipulation eliminates 300ms tap delay
       - No backdrop-filter (was expensive GPU compositing)
       - Positioned to avoid visually covering card content;
         arrows float in the gutter at each edge of the wrapper
    ════════════════════════════════════════════════════ */
    .carousel-arrow {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      z-index: 20; /* above cards (default z-index) and fade overlays (z-index:5) */

      /* 44×44 minimum — matches Apple HIG & Material touch target guideline */
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      min-width: 44px;
      min-height: 44px;
      padding: 0;
      box-sizing: border-box;

      border-radius: 50%;
      border: none;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;

      /*
       * touch-action: manipulation — prevents the 300ms click delay on
       * mobile browsers and disables double-tap-to-zoom on the button,
       * which was a hidden cause of arrow misfire on fast taps.
       */
      touch-action: manipulation;

      /* Solid bg — no backdrop-filter, no compositing overhead */
      background: rgba(255,255,255,0.96);
      box-shadow: 0 2px 10px rgba(6,20,40,0.13), 0 0 0 1px rgba(14,176,213,0.12);
      color: #3a4a5a;

      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease, background 0.15s ease;
      will-change: opacity;
      outline: none;
    }

    .carousel-arrow.visible {
      opacity: 1;
      pointer-events: auto;
    }

    .carousel-arrow:hover {
      background: #fff;
      color: var(--brand-1, #13b47f);
      transform: translateY(-50%) scale(1.06);
      box-shadow: 0 4px 16px rgba(19,180,127,0.20), 0 0 0 1.5px rgba(19,180,127,0.28);
    }

    .carousel-arrow:active {
      transform: translateY(-50%) scale(0.95);
      transition-duration: 0.05s;
    }

    .carousel-arrow:focus-visible {
      outline: 2px solid var(--brand-1, #13b47f);
      outline-offset: 3px;
    }

    .carousel-arrow svg {
      display: block;
      pointer-events: none;
      flex-shrink: 0;
    }

    /* Positioned at the very edge of the wrapper so they don't
       sit on top of card content. The wrapper has position:relative. */
    .carousel-arrow--left  { left: 0;  }
    .carousel-arrow--right { right: 0; }

    /* Fade-edge peek effect */
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

    @media (max-width: 600px) {
      /* 40px on mobile — slightly smaller than desktop but still within
         the 44px touch target when you account for surrounding whitespace */
      .carousel-arrow {
        width: 40px;
        height: 40px;
        min-width: 40px;
        min-height: 40px;
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
// CAROUSEL ARROWS — v4.1 architecture
//
// Arrow visibility: IntersectionObserver watches the FIRST and
// LAST .item-card in the track (not 1px sentinels — sentinels
// caused a bug where their position relative to the snap point
// left them permanently outside the scrollport at scrollLeft=0,
// keeping the left arrow visible even at the leftmost card).
//
//   firstCard ≥50% visible in scrollport → at left edge → hide left arrow
//   lastCard  ≥50% visible in scrollport → at right edge → hide right arrow
//
// threshold:0.5 prevents false positives from partially-peeking
// cards at the scroll boundary.
//
// Arrow click: stopPropagation prevents the event bubbling through
// to any card that might sit behind the arrow in the layout,
// which was causing accidental card copy on near-miss taps.
// ─────────────────────────────────────────────────────────

/**
 * Returns the pixel distance for one card step (card width + gap).
 * Called only on arrow click — not in any scroll path.
 */
function getCardStep(track) {
  const card = track.querySelector('.item-card');
  if (!card) return 200;
  const gap = parseFloat(getComputedStyle(track).columnGap || '0') || 16;
  return card.offsetWidth + gap;
}

/**
 * Builds a circular arrow button with chevron SVG.
 * viewBox is square (18×18) so the icon stays centred in the circle.
 */
function buildArrowBtn(dir) {
  const btn = document.createElement('button');
  btn.type      = 'button';
  btn.className = `carousel-arrow carousel-arrow--${dir}`;
  btn.setAttribute('aria-label', dir === 'left' ? 'Scroll left' : 'Scroll right');

  const d = dir === 'left' ? 'M12 4L6 9l6 5' : 'M6 4l6 5-6 5';
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 18 18"
         fill="none" xmlns="http://www.w3.org/2000/svg"
         aria-hidden="true" focusable="false">
      <path d="${d}" stroke="currentColor" stroke-width="2.4"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
  return btn;
}

/**
 * Attaches scroll arrows + IntersectionObserver to a carousel.
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

  /*
   * stopPropagation: prevents click from reaching any card element
   * that might be visually behind the arrow, which was causing
   * accidental copy when the user's tap slightly missed the button.
   */
  btnLeft.addEventListener('click', (e) => {
    e.stopPropagation();
    track.scrollBy({ left: -getCardStep(track), behavior: 'smooth' });
  });
  btnRight.addEventListener('click', (e) => {
    e.stopPropagation();
    track.scrollBy({ left: getCardStep(track), behavior: 'smooth' });
  });

  // Observe first and last card directly — no intermediate sentinel elements.
  // The view-all card is always last; it counts as the right-edge marker.
  const cards    = track.querySelectorAll('.item-card');
  const firstCard = cards[0];
  const lastCard  = cards[cards.length - 1];

  // Edge case: single card — no scrolling possible, skip arrows
  if (!firstCard || firstCard === lastCard) return;

  const io = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (target === firstCard) {
        // First card visible → at left edge → left arrow should be hidden
        btnLeft.classList.toggle('visible', !isIntersecting);
        wrapper.classList.toggle('can-left', !isIntersecting);
      } else {
        // Last card visible → at right edge → right arrow should be hidden
        btnRight.classList.toggle('visible', !isIntersecting);
        wrapper.classList.toggle('can-right', !isIntersecting);
      }
    }
  }, {
    root: track,       // observe within the track's own scrollport
    threshold: 0.5,    // ≥50% of card must be visible to count as "at edge"
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
     * showCopyNotification is loaded via `defer` script.
     * home.js is a `type="module"` (also deferred) loaded earlier in the
     * document. Execution order between the two is browser-dependent —
     * the notification script may not have run yet on the very first click.
     *
     * Strategy: try direct call first; if not ready, retry after one
     * requestAnimationFrame (defer scripts always run before the next paint).
     */
    if (typeof window.showCopyNotification === 'function') {
      window.showCopyNotification({ text: item.text, name: itemName, typeId, lang });
    } else {
      requestAnimationFrame(() => {
        window.showCopyNotification?.({ text: item.text, name: itemName, typeId, lang });
      });
    }
  };
  card.addEventListener('click', handleCopy);
  card.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); handleCopy(); }
  });
  return card;
}

/** View All card */
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

  // carousel-wrapper: position:relative anchor for arrows + fade edges
  const wrapper = document.createElement('div');
  wrapper.className = 'carousel-wrapper content';

  const container = document.createElement('div');
  container.className = 'carousel-container';
  const track = document.createElement('div');
  track.className = 'carousel-track';
  container.appendChild(track);
  wrapper.appendChild(container);
  section.appendChild(wrapper);

  // Populate cards synchronously into a fragment (single reflow)
  const frag = document.createDocumentFragment();
  (category.data || []).slice(0, HOME_CONFIG.MAX_ITEMS_PER_CATEGORY).forEach(item => {
    frag.appendChild(buildItemCard(item, typeId, lang));
  });
  frag.appendChild(buildViewAllCard(typeId));
  track.appendChild(frag);

  /*
   * Defer arrow attachment one rAF so the track has a computed width
   * before IntersectionObserver takes its first measurement.
   */
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