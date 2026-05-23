document.addEventListener('DOMContentLoaded', () => {
  const THRESHOLD = 120, BOTTOM = 140, FADE = 450;
  let lastY = scrollY, ticking = false;

  const btn = document.body.appendChild(document.createElement('button'));
  btn.id = 'back-to-top';
  btn.className = 'btt-hidden';
  btn.setAttribute('aria-label', 'Back to top');
  btn.setAttribute('wave', ''); 
  btn.tabIndex = 0;
  btn.style.touchAction = 'manipulation';
  
  btn.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <polyline points="16.5,13.5 12,9 7.5,13.5" fill="none" stroke="#ffffff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
  btn.onclick = () => scrollTo({ top: 0, behavior: 'smooth' });
  btn.onkeydown = e => (e.key === 'Enter' || e.key === ' ') && (btn.onclick(), e.preventDefault());

  const css = `
    #back-to-top {
      position: fixed;
      right: 4vw;
      bottom: ${BOTTOM}px;
      width: 50px; height: 50px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      opacity: 0; visibility: hidden; pointer-events: none;
      padding: 0; outline: none;
      cursor: pointer;
      
      background: #00CEB0; 
      border: 2px solid #00dfbe;
      box-shadow: inset 0 0 6px 0 rgba(255, 255, 255, 0.4), inset 0 0 12px 0 rgba(0, 163, 138, 0.5);
      
      transform-origin: center;
      
      /* 🔥 เพิ่มตรงนี้เพื่อปิด Tab High Color และเอฟเฟกต์รบกวนเวลาจิ้มปุ่ม */
      -webkit-tap-highlight-color: transparent;
      -webkit-focus-ring-color: transparent;
      
      transition:
        opacity ${FADE}ms cubic-bezier(0.34, 1.56, 0.64, 1),
        transform ${FADE}ms cubic-bezier(0.175, 0.885, 0.32, 1.275),
        visibility 0s linear ${FADE}ms;
        
      z-index: 1100; user-select: none;
      will-change: opacity, transform;
    }
    #back-to-top svg {
      display: block;
      pointer-events: none;
      transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    
    #back-to-top.btt-shown {
      opacity: 1; visibility: visible; pointer-events: auto;
      transform: translateY(0) scale(1.0);
      transition-delay: 0s;
    }
    
    #back-to-top.btt-hidden {
      opacity: 0; pointer-events: none;
      transform: translateY(15px) scale(0.6);
    }
    
    #back-to-top:active {
      transform: translateY(0) scale(0.85);
      transition: transform 120ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
      outline: none;
    }
    #back-to-top:active svg {
      transform: scale(0.9);
    }
    
    @media (max-width:600px){
      #back-to-top { right: 16px; bottom: ${BOTTOM - 20}px; width: 45px; height: 45px; }
      #back-to-top.btt-shown { transform: translateY(0) scale(1.0); }
      #back-to-top.btt-hidden { transform: translateY(15px) scale(0.6); }
      #back-to-top:active { transform: translateY(0) scale(0.85); }
    }
  `;
  document.head.appendChild(Object.assign(document.createElement('style'), {textContent: css}));

  addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        const y = scrollY, up = y < lastY, over = y > THRESHOLD;
        btn.className = (over && up) ? 'btt-shown' : 'btt-hidden';
        lastY = y; ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
});
