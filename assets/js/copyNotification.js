// Path:    assets/js/copyNotification.js
// Purpose: Premium copy feedback notification — off-white capsule, fade-only animation.
//          Optionally resolves item name from ConDataService when name is not provided.
//          Zero coupling: works with or without ConDataService present.
// Used by: home.js, search-ui.js, any system that triggers a copy action

(function(global) {
  'use strict';
  
  // ── Timing constants ──────────────────────────────────────
  //
  // WHY these values:
  //   FADE_IN_MS  260 — fast enough to feel instant, slow enough to read as intentional
  //   DISPLAY_MS 2800 — just over the "read + register" cognitive threshold (~2.5s)
  //   FADE_OUT_MS 400 — exit is deliberately slower than enter: feels more composed
  //
  const FADE_IN_MS = 320;
  const DISPLAY_MS = 1800;
  const FADE_OUT_MS = 480;
  
  const STYLE_ID = 'cn-styles-v3';
  
  // ── i18n — "Copied" label ─────────────────────────────────
  const COPIED_LABEL = { th: 'คัดลอกแล้ว', en: 'Copied' };
  
  // ── Internal state ────────────────────────────────────────
  // Only one notification on screen at a time.
  let _activeEl = null;
  let _holdTimer = null;
  
  // ── Style injection (idempotent) ──────────────────────────
  //
  // Styles are injected once on first call, not at module parse time,
  // so there is zero overhead if the notification is never shown.
  //
  // Design: Progressive Disclosure / Minimal Interface / Modern SaaS
  //   • Off-white frosted-glass capsule — not harsh pure #fff
  //   • Dark text (#111827) on light surface for legibility
  //   • Single divider separates "Copied" from item name
  //   • No icon, no tick animation — the emoji IS the visual anchor
  //
  function _injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      /* ── Capsule container ──────────────────────────────── */
      .cn-capsule {
        position: fixed;
        bottom: calc(120px + env(safe-area-inset-bottom, 0px)); 
        left: 50%;
        transform: translateX(-50%);
        z-index: 15000;

        display: inline-flex;
        align-items: center;
        
        /* Space ที่เน้นความโปร่งและพรีเมียม */
        padding: 14px 28px 14px 20px;
        border-radius: 9999px;

        /* * Modern Charcoal Glass:
         * ใช้สีเทาเข้มเกือบดำ (Dark Charcoal) เพื่อให้ตัดกับเว็บสีขาวชัดเจน
         * ลด Opacity ลงเหลือ 0.75 เพื่อให้เห็น Effect ของ Backdrop-filter
         */
        background: rgba(23, 23, 26, 0.78);
        
        /* * Futuristic Edge:
         * ใช้เส้นขอบสีขาวจางๆ เพื่อสร้างเส้นตัด (Hairline) ให้ Capsule ดูคมกริบ
         */
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 
          0 20px 40px -12px rgba(0, 0, 0, 0.25),
          0 0 0 1px rgba(0, 0, 0, 0.1);

        /* การเบลอและเร่งสีให้ดูหรูหรา */
        backdrop-filter: blur(18px) saturate(160%);
        -webkit-backdrop-filter: blur(18px) saturate(160%);

        /* Typography: เปลี่ยนเป็นสีขาวสว่างเพื่อให้ Contrast กับตัว Capsule */
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
        font-size: 14px;
        color: #ffffff;
        white-space: nowrap;
        pointer-events: none;
        user-select: none;

        opacity: 0;
        will-change: opacity, transform;
      }

      /* ── Emoji / Character ──────────────────────────────── */
      .cn-char {
        font-size: 1.4em;
        line-height: 1;
        flex-shrink: 0;
        margin-right: 14px;
        filter: drop-shadow(0 2px 8px rgba(0,0,0,0.3));
      }

      /* ── "Copied" label ─────────────────────────────────── */
      .cn-label {
        font-weight: 600;
        font-size: 0.95em;
        letter-spacing: 0.04em;
        color: #ffffff; /* ขาวบริสุทธิ์เพื่อความอ่านง่าย */
        flex-shrink: 0;
      }

      /* ── Divider: Subtle White Line ─────────────────────── */
      .cn-divider {
        width: 1px;
        height: 16px;
        background: rgba(255, 255, 255, 0.15);
        flex-shrink: 0;
        margin: 0 18px;
      }

      /* ── Item name ──────────────────────────────────────── */
      .cn-name {
        font-size: 0.92em;
        font-weight: 400;
        /* ใช้สีเทาสว่าง (Light Silver) เพื่อแยกความสำคัญออกจากคำหลัก */
        color: rgba(255, 255, 255, 0.65);
        letter-spacing: 0.02em;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* ── Mobile adjustments ─────────────────────────────── */
      @media (max-width: 480px) {
        .cn-capsule {
          bottom: 120px;
          max-width: 88vw;
          background: rgba(28, 28, 30, 0.9); /* บนมือถือปรับให้ทึบขึ้นเล็กน้อยเพื่อความชัดเจน */
        }
        .cn-name { max-width: 130px; }
      }

      /* ── Motion ─────────────────────────────────────────── */
      @media (prefers-reduced-motion: reduce) {
        .cn-capsule { transition: none !important; }
      }
    `;
    
    document.head.appendChild(s);
  }


  
  // ── Build the capsule DOM element ─────────────────────────
  function _buildCapsule(text, label, name) {
    const el = document.createElement('div');
    el.className = 'cn-capsule';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    el.setAttribute('aria-label', label + (name ? ': ' + name : ''));
    
    // Character/emoji — the primary visual anchor
    if (text) {
      const charEl = document.createElement('span');
      charEl.className = 'cn-char';
      charEl.setAttribute('aria-hidden', 'true');
      charEl.textContent = text;
      el.appendChild(charEl);
    }
    
    // "Copied" label
    const labelEl = document.createElement('span');
    labelEl.className = 'cn-label';
    labelEl.textContent = label;
    el.appendChild(labelEl);
    
    // Optional item name with divider
    if (name) {
      const divider = document.createElement('span');
      divider.className = 'cn-divider';
      divider.setAttribute('aria-hidden', 'true');
      el.appendChild(divider);
      
      const nameEl = document.createElement('span');
      nameEl.className = 'cn-name';
      nameEl.textContent = name;
      el.appendChild(nameEl);
    }
    
    return el;
  }
  
  // ── Dismiss the active notification ───────────────────────
  //
  // Called either by the auto-dismiss timer or when a new
  // notification replaces the current one.
  //
  function _dismiss() {
    if (!_activeEl) return;
    
    const el = _activeEl;
    _activeEl = null;
    
    if (_holdTimer) {
      clearTimeout(_holdTimer);
      _holdTimer = null;
    }
    
    // Fade out: ease-in so the exit has a deliberate, composed feel
    el.style.transition = `opacity ${FADE_OUT_MS}ms ease-in`;
    el.style.opacity = '0';
    
    // Remove from DOM after transition completes (+ 40ms safety margin)
    setTimeout(() => el.parentNode?.removeChild(el), FADE_OUT_MS + 40);
  }
  
  // ── Show notification ─────────────────────────────────────
  //
  // Public interface (backward compatible with the previous version):
  //   showCopyNotification({ text, name?, typeId?, lang? })
  //
  // name resolution priority:
  //   1. name passed directly (data-rich callers like home.js — no lookup needed)
  //   2. ConDataService.resolveItem({ text }) — if ConDataService is loaded
  //   3. No name — show capsule without item name (graceful degradation)
  //
  // WHY async with ConDataService:
  //   ConDataService.resolveItem() hits an in-memory index (no network) once
  //   the service is preloaded. The await is near-instant in practice.
  //   We do NOT block the notification on this — if the service is not ready
  //   we show immediately without a name.
  //
  async function showCopyNotification({ text, name, typeId, lang } = {}) {
    _injectStyles();
    
    // Resolve display language
    const resolvedLang = lang ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('selectedLang')) ||
      'en';
    
    const label = COPIED_LABEL[resolvedLang] || COPIED_LABEL.en;
    
    // Resolve item name if not provided
    let resolvedName = (typeof name === 'string') ? name.trim() : '';
    
    if (!resolvedName && text) {
      // Attempt lookup via ConDataService (neutral service — not notification-specific)
      const svc = global.ConDataService;
      if (svc && typeof svc.resolveItem === 'function') {
        try {
          const item = await svc.resolveItem({ text, lang: resolvedLang });
          if (item?.displayName) resolvedName = item.displayName;
        } catch (_) {
          // resolveItem failure is non-fatal — name remains empty
        }
      }
    }
    
    // Dismiss any existing notification before showing the new one
    _dismiss();
    
    const el = _buildCapsule(text, label, resolvedName);
    document.body.appendChild(el);
    _activeEl = el;
    
    // Fade in: two rAFs ensure the initial opacity:0 has been painted
    // before we start the transition, preventing a flash-of-full-opacity.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Guard: element may have been dismissed between rAFs (edge case)
        if (_activeEl !== el) return;
        el.style.transition = `opacity ${FADE_IN_MS}ms ease-out`;
        el.style.opacity = '1';
      });
    });
    
    // Schedule auto-dismiss after fade-in completes + hold duration
    _holdTimer = setTimeout(_dismiss, FADE_IN_MS + DISPLAY_MS);
  }
  
  // ── Register on global scope ──────────────────────────────
  global.showCopyNotification = showCopyNotification;
  
})(typeof window !== 'undefined' ? window : this);