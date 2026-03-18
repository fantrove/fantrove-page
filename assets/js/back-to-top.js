document.addEventListener('DOMContentLoaded', () => {
  // Ultra-light, premium, minimal back-to-top button
  const THRESHOLD = 120, BOTTOM = 90, FADE = 140;
  let visible = false, lastY = scrollY, ticking = false;

  // Create the button (SVG-only, no extra elements)
  const btn = document.body.appendChild(document.createElement('button'));
  btn.id = 'back-to-top';
  btn.className = 'btt-hidden';
  btn.setAttribute('aria-label', 'Back to top');
  btn.tabIndex = 0;
  btn.style.touchAction = 'manipulation';
  btn.innerHTML = `
    <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="bttg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#45ffe0"/><stop offset="100%" stop-color="#1e9d7c"/>
        </linearGradient>
        <filter id="btts" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity=".15"/>
        </filter>
      </defs>
      <circle cx="19" cy="19" r="16.5" fill="url(#bttg)" filter="url(#btts)"/>
      <polyline points="13,22.5 19,15 25,22.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
  btn.onclick = () => scrollTo({ top: 0, behavior: 'smooth' });
  btn.onkeydown = e => (e.key === 'Enter' || e.key === ' ') && (btn.onclick(), e.preventDefault());

  // Style: minimal, modern, premium, responsive
  const css = `
    #back-to-top {
      position: fixed;
      right: 4vw;
      bottom: ${BOTTOM}px;
      width: 54px; height: 54px;
      background: none; border: none; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      opacity: 0; visibility: hidden; pointer-events: none;
      box-shadow: none; padding: 0; outline: none;
      transition:
        opacity ${FADE}ms cubic-bezier(.4,0,.2,1),
        visibility ${FADE}ms,
        transform ${FADE}ms cubic-bezier(.4,0,.2,1),
        box-shadow 180ms cubic-bezier(.4,0,.2,1);
      transform: translateY(24px) scale(.97);
      z-index: 1100; user-select: none;
      will-change: opacity, transform, box-shadow;
    }
    #back-to-top svg {
      width: 38px; height: 38px; display: block; border-radius: 50%;
      pointer-events: none;
    }
    #back-to-top.btt-shown {
      opacity: 1; visibility: visible; pointer-events: auto;
      box-shadow: 0 8px 24px 0 rgba(30,157,124,0.13), 0 2px 10px rgba(58,60,79,0.10);
      transform: translateY(0) scale(1.0);
    }
    #back-to-top.btt-hidden {
      opacity: 0; visibility: hidden; pointer-events: none;
      box-shadow: none;
      transform: translateY(24px) scale(.97);
    }
    #back-to-top:active svg, #back-to-top:focus svg {
      box-shadow: 0 0 0 4px rgba(69,255,224,0.14);
      outline: none;
    }
    @media (max-width:600px){
      #back-to-top{right:12px;width:46px;height:46px;}
      #back-to-top svg{width:32px;height:32px;}
    }
  `;
  document.head.appendChild(Object.assign(document.createElement('style'), {textContent: css}));

  // Ultra-light scroll logic using rAF, no timers, no extra state
  addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        const y = scrollY, up = y < lastY, over = y > THRESHOLD;
        btn.className = (over && up) ? 'btt-shown' : 'btt-hidden';
        visible = (over && up);
        lastY = y; ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
});