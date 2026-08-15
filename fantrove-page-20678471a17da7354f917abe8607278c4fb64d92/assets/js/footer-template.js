// Footer Injection – Simple & Non-Invasive
// ✓ ไม่แตะ <body>, ไม่สร้าง wrapper, ไม่จัด layout
// ✓ แค่ fetch template แล้ว append ท้าย body เท่านั้น

(function() {
  const FOOTER_CSS_PATH = '/assets/css/footer.css';
  const FOOTER_TEMPLATE_PATH = '/assets/template-html/footer-template.html';
  
  if (window.__fantroveFooterInjected) return;
  window.__fantroveFooterInjected = true;
  
  /* ── Load CSS ─────────────────────────────────────── */
  function loadCSS() {
    const already = [...document.styleSheets].some(
      s => s.href && s.href.includes('footer.css')
    );
    if (already) return;
    
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FOOTER_CSS_PATH;
    document.head.appendChild(link);
  }
  
  /* ── Inject footer HTML ───────────────────────────── */
  function inject(html) {
    // ถ้ามีอยู่แล้ว (pre-built) ไม่ต้องทำอะไร
    if (document.querySelector('footer.footer-minimal')) return;
    
    const tmp = document.createElement('div');
    tmp.innerHTML = html.trim();
    const footerEl = tmp.querySelector('footer') || tmp.firstElementChild;
    if (footerEl) document.body.appendChild(footerEl);
  }
  
  /* ── Fallback inline footer ───────────────────────── */
  function fallback() {
    if (document.querySelector('footer.footer-minimal')) return;
    const el = document.createElement('footer');
    el.className = 'footer-minimal';
    el.setAttribute('role', 'contentinfo');
    el.innerHTML = '<div class="footer-inner"><p>© Fantrove</p></div>';
    document.body.appendChild(el);
  }
  
  /* ── Boot ─────────────────────────────────────────── */
  function run() {
    loadCSS();
    
    // ถ้า pre-built และ footer อยู่แล้ว → ออกเลย
    if (
      document.documentElement.dataset.fvBuilt &&
      document.querySelector('footer.footer-minimal')
    ) return;
    
    fetch(FOOTER_TEMPLATE_PATH, { cache: 'force-cache' })
      .then(r => (r.ok ? r.text() : Promise.reject()))
      .then(inject)
      .catch(fallback);
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();