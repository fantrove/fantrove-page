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
      /* ── Premium Exclusive Capsule ─────────────────────── */
      .cn-capsule {
        position: fixed;
        bottom: calc(120px + env(safe-area-inset-bottom, 0px)); 
        left: 50%;
        transform: translateX(-50%);
        z-index: 1500000;

        display: inline-flex;
        align-items: center;
        
        /* Fixed Padding สำหรับทุกอุปกรณ์ตามที่คุณต้องการ */
        padding: 15px 28px 15px 20px !important;
        border-radius: 9999px;

        /* * White-Silk Base: ใช้สีขาวนวลที่ดูสะอาดตา 
         * เพื่อให้เข้ากับเว็บสีขาวได้โดยไม่ดูเป็น "ก้อนเทาๆ" 
         */
        background: rgba(255, 255, 255, 0.8);
        
        /* * Dual-Tone Border: เทคนิคที่ทำให้ดู Exclusive 
         * ใช้ขอบสีขาวสว่างด้านบนเพื่อสร้างมิติ "ตกกระทบของแสง"
         */
        border: 1px solid rgba(255, 255, 255, 1);
        box-shadow: 
          0 0 0 1px rgba(0, 206, 176, 0.15), /* เส้นขอบสี Mint บางๆ ชั้นนอกสุด */
          0 12px 30px -10px rgba(0, 0, 0, 0.08), /* เงาฟุ้งแบบผู้ดี */
          0 4px 10px -2px rgba(0, 206, 176, 0.05); /* Glow สี Mint จางๆ */

        /* * Crystal Blur: การเบลอระดับพรีเมียม 
         * ทำให้สิ่งที่อยู่ด้านหลังดูเหมือนถูกมองผ่านคริสตัล
         */
        backdrop-filter: blur(24px) saturate(160%);
        -webkit-backdrop-filter: blur(24px) saturate(160%);

        /* Typography */
        font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
        font-size: 14px !important;
        color: #111827;
        white-space: nowrap;
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;

        opacity: 0;
        will-change: opacity, transform;
      }

      /* ── Character / Icon ──────────────────────────────── */
      .cn-char {
        font-size: 1.4em !important;
        line-height: 1;
        flex-shrink: 0;
        margin-right: 14px;
        /* เพิ่มเงาให้อีโมจิดู Pop ออกมาจากกระจก */
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
      }

      /* ── Primary Label ─────────────────────────────────── */
      .cn-label {
        font-weight: 700;
        font-size: 0.95em !important;
        letter-spacing: 0.02em;
        /* ใช้ Gradient เล็กน้อยเพื่อให้คำว่าคัดลอกดูมีชีวิตชีวา */
        background: linear-gradient(135deg, #00ceb0 0%, #00a892 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        flex-shrink: 0;
      }

      /* ── Minimalist Divider ────────────────────────────── */
      .cn-divider {
        width: 1px;
        height: 16px;
        background: rgba(0, 0, 0, 0.06);
        flex-shrink: 0;
        margin: 0 18px;
      }

      /* ── Secondary Name ────────────────────────────────── */
      .cn-name {
        font-size: 0.9em !important;
        font-weight: 500;
        color: #6b7280;
        letter-spacing: 0.01em;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* No Mobile-specific padding overrides as requested */

      /* ── Motion ────────────────────────────────────────── */
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