// Auto Footer Injection Script (updated, safer injection)
// - Load dedicated footer CSS (footer.min.css)
// - Do NOT remove an existing footer with class 'footer-minimal' (avoid clobbering server-rendered footer).
// - Inject only when footer not present.
// - Adds `footer-injected` class to <body> when injection performed.

(function() {
 const FOOTER_CSS_PATH = "/assets/css/footer.min.css";
 const FOOTER_TEMPLATE_PATH = "/assets/template-html/footer-template.html";
 
 // Only inject once
 if (window.__fantroveFooterInjected) return;
 window.__fantroveFooterInjected = true;
 
 // Helper: Load CSS if not present
 function ensureFooterCSS() {
  const exists = [...document.styleSheets].some(s => s.href && s.href.indexOf('footer.min.css') !== -1);
  if (!exists) {
   const link = document.createElement('link');
   link.rel = 'stylesheet';
   link.href = FOOTER_CSS_PATH;
   link.type = 'text/css';
   // load non-blocking
   link.media = 'print';
   link.onload = () => { link.media = 'all'; };
   document.head.appendChild(link);
  }
 }
 
 // Mark body so CSS can scope special stacking rules only when footer injected
 function markBodyInjected() {
  try { document.body.classList.add('footer-injected'); } catch (e) {}
 }
 
 // Insert footer HTML at end of <body> only if not already present
 function injectFooterHTML(footerHTML) {
  // If a semantic footer already exists, skip injection to avoid duplication/clobber
  const existing = document.querySelector('footer.footer-minimal');
  if (existing) {
   markBodyInjected();
   return existing;
  }
  
  // Insert sanitized footer
  const container = document.createElement('div');
  container.innerHTML = footerHTML.trim();
  const node = container.querySelector('footer') || container.firstElementChild;
  if (node) {
   if (!node.classList.contains('footer-minimal')) node.classList.add('footer-minimal');
   document.body.appendChild(node);
   markBodyInjected();
   return node;
  } else {
   // fallback minimal footer
   const fallback = document.createElement('footer');
   fallback.className = 'footer-minimal';
   fallback.setAttribute('role', 'contentinfo');
   fallback.innerHTML = '<div class="footer-inner"><div>© FANTROVE</div></div>';
   document.body.appendChild(fallback);
   markBodyInjected();
   return fallback;
  }
 }
 
 function fetchFooterTemplate() {
  return fetch(FOOTER_TEMPLATE_PATH, { cache: 'force-cache' }).then(r => {
   if (!r.ok) return Promise.reject(new Error('Footer template not found'));
   return r.text();
  });
 }
 
 function ready(fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
  else fn();
 }
 
 ready(() => {
  try {
   ensureFooterCSS();
   fetchFooterTemplate()
    .then(html => injectFooterHTML(html))
    .catch(err => {
     injectFooterHTML(`
            <footer class="footer-minimal" role="contentinfo" aria-label="Site footer">
              <div class="footer-inner"><div>© FANTROVE</div></div>
            </footer>
          `);
     console.error('[FANTROVE] Footer injection failed:', err);
    });
  } catch (e) {
   console.error('[FANTROVE] Footer injection unexpected error:', e);
  }
 });
})();