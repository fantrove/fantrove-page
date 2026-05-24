// Path:    assets/js/back-to-top.js
// Purpose: Back-to-top button — scroll detection + show/hide only.
//          CSS lives in assets/css/back-to-top.css

document.addEventListener('DOMContentLoaded', () => {
  const THRESHOLD = 120;
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