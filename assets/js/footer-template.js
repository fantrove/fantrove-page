// Auto Footer Injection Script (non-invasive; does NOT modify <body>)
// - Creates a site-root that contains a site-content-wrapper and footer (on desktop only).
// - Does NOT add classes or inline styles to <body>.
// - Ensures footer is last child of site-root and content-wrapper receives padding-bottom safety.
// - Loads footer.css with fallback.

(function() {
  const FOOTER_CSS_PATH = "/assets/css/footer.css";
  const FOOTER_TEMPLATE_PATH = "/assets/template-html/footer-template.html";
  const FALLBACK_STYLE_ID = "fantrove-footer-fallback-style";
  const DESKTOP_QUERY = "(min-width: 880px)";

  if (window.__fantroveFooterInjected) return;
  window.__fantroveFooterInjected = true;

  /* -------------------------
     Load CSS (with fallback)
     ------------------------- */
  function ensureFooterCSS() {
    const exists = [...document.styleSheets].some(s => s.href && s.href.indexOf('footer.css') !== -1);
    if (!exists) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = FOOTER_CSS_PATH;
      link.type = 'text/css';
      link.media = 'print';
      link.onload = () => { link.media = 'all'; removeFallbackStyle(); };
      link.onerror = () => { injectFallbackStyle(); };
      document.head.appendChild(link);

      setTimeout(() => {
        const nowExists = [...document.styleSheets].some(s => s.href && s.href.indexOf('footer.css') !== -1);
        if (!nowExists) injectFallbackStyle();
      }, 900);
    }
  }

  function injectFallbackStyle() {
    if (document.getElementById(FALLBACK_STYLE_ID)) return;
    const css = `
/* Fallback minimal rules (non-invasive) */
.site-root[data-fantrove-layout="column"]{ display:flex; flex-direction:column; min-height:100vh; }
.site-root[data-fantrove-layout="column"] > .site-content-wrapper { flex:1 1 auto; min-height:0; }
.footer-minimal{ box-sizing:border-box; width:100%; background:#fff; color:#111; border-top:1px solid #eee; padding:12px 12px; z-index:1; clear:both; flex-shrink:0; position:relative !important; left:0 !important; right:0 !important; transform:none !important; }
.footer-minimal .footer-inner{ max-width:1100px; margin:0 auto; }
`;
    const s = document.createElement('style');
    s.id = FALLBACK_STYLE_ID;
    s.appendChild(document.createTextNode(css));
    document.head.appendChild(s);
  }

  function removeFallbackStyle() {
    const el = document.getElementById(FALLBACK_STYLE_ID);
    if (el) el.parentNode.removeChild(el);
  }

  /* -------------------------
     Build / Wrap content (non-body touching)
     ------------------------- */
  function gatherContentCandidates() {
    return Array.from(document.body.children).filter(el => {
      const tag = el.tagName.toLowerCase();
      if (['script','link','style','meta','noscript','template'].includes(tag)) return false;
      if (tag === 'footer' && el.classList.contains('footer-minimal')) return false;
      return true;
    });
  }

  function ensureSiteRoot() {
    try {
      if (document.querySelector('.site-root')) return document.querySelector('.site-root');

      const candidates = gatherContentCandidates();
      if (!candidates.length) return null;

      const siteRoot = document.createElement('div');
      siteRoot.className = 'site-root';
      siteRoot.setAttribute('data-fantrove-layout', 'auto');

      const contentWrapper = document.createElement('div');
      contentWrapper.className = 'site-content-wrapper';

      const first = candidates[0];
      document.body.insertBefore(siteRoot, first);
      siteRoot.appendChild(contentWrapper);
      candidates.forEach(node => contentWrapper.appendChild(node));

      return siteRoot;
    } catch (e) {
      console.warn('[FANTROVE] ensureSiteRoot failed', e);
      return null;
    }
  }

  function enableDesktopRootLayout(siteRoot) {
    if (!siteRoot) return;
    try {
      siteRoot.setAttribute('data-fantrove-layout', 'column');
    } catch (e) {}
  }

  /* -------------------------
     Inject / place footer
     ------------------------- */
  function placeFooterNode(footerNode, siteRoot) {
    try {
      if (!siteRoot) {
        if (!footerNode.parentNode || footerNode.parentNode !== document.body) {
          document.body.appendChild(footerNode);
        }
        return footerNode;
      }
      let contentWrapper = siteRoot.querySelector('.site-content-wrapper');
      if (!contentWrapper) {
        contentWrapper = document.createElement('div');
        contentWrapper.className = 'site-content-wrapper';
        Array.from(siteRoot.childNodes).forEach(c => contentWrapper.appendChild(c));
        siteRoot.appendChild(contentWrapper);
      }

      if (footerNode.parentNode !== siteRoot) {
        siteRoot.appendChild(footerNode);
      }
      return footerNode;
    } catch (e) {
      console.warn('[FANTROVE] placeFooterNode failed', e);
      if (footerNode && footerNode.parentNode !== document.body) document.body.appendChild(footerNode);
      return footerNode;
    }
  }

  function injectFooterHTML(footerHTML) {
    const existing = document.querySelector('footer.footer-minimal');
    let footerEl = existing;
    if (!existing) {
      const container = document.createElement('div');
      container.innerHTML = footerHTML.trim();
      footerEl = container.querySelector('footer') || container.firstElementChild;
      if (!footerEl) {
        footerEl = document.createElement('footer');
        footerEl.className = 'footer-minimal';
        footerEl.setAttribute('role', 'contentinfo');
        footerEl.innerHTML = '<div class="footer-inner"><div>© FANTROVE</div></div>';
      } else {
        if (!footerEl.classList.contains('footer-minimal')) footerEl.classList.add('footer-minimal');
        if (!footerEl.getAttribute('role')) footerEl.setAttribute('role','contentinfo');
      }
    }

    const siteRoot = document.querySelector('.site-root') || ensureSiteRoot();
    placeFooterNode(footerEl, siteRoot);

    if (window.matchMedia && window.matchMedia(DESKTOP_QUERY).matches) {
      enableDesktopRootLayout(siteRoot);
    }

    const contentWrapper = (siteRoot && siteRoot.querySelector('.site-content-wrapper')) || null;
    if (contentWrapper) {
      try { contentWrapper.style.paddingBottom = ''; } catch (e) {}
    }

    return footerEl;
  }

  /* -------------------------
     Spacing: DISABLED (no-op)
     ------------------------- */
  function trackFooterSpacing() {
    try {
      const siteRoot = document.querySelector('.site-root');
      const contentWrapper = siteRoot && siteRoot.querySelector('.site-content-wrapper');
      if (contentWrapper && contentWrapper.style && contentWrapper.style.paddingBottom) {
        contentWrapper.style.paddingBottom = '';
      }
    } catch (e) {}
    return;
  }

  /* -------------------------
     Fetch footer template
     ------------------------- */
  function fetchFooterTemplate() {
    return fetch(FOOTER_TEMPLATE_PATH, { cache: 'force-cache' }).then(r => {
      if (!r.ok) return Promise.reject(new Error('Footer template not found'));
      return r.text();
    });
  }

  /* -------------------------
     Boot
     ------------------------- */
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(() => {
    try {
      ensureFooterCSS();

      // ── Static mode (pre-built pages) ────────────────────────────────────
      // เมื่อหน้าถูก build ล่วงหน้า footer ถูก bake ไว้ใน HTML แล้ว
      // (html-transformer.js ฝัง <footer.footer-minimal> ก่อน </body>)
      //
      // ในกรณีนี้เราข้าม fetch และ inject — แค่จัด layout (site-root wrapper)
      // เหมือนที่ทำปกติ แต่ไม่สร้าง footer ใหม่
      if (
        document.documentElement.dataset &&
        document.documentElement.dataset.fvBuilt &&
        document.querySelector('footer.footer-minimal')
      ) {
        // Footer อยู่แล้ว — จัด layout เท่านั้น
        if (window.matchMedia && window.matchMedia(DESKTOP_QUERY).matches) {
          const siteRoot = ensureSiteRoot();
          enableDesktopRootLayout(siteRoot);
          const existingFooter = document.querySelector('footer.footer-minimal');
          if (existingFooter && siteRoot) placeFooterNode(existingFooter, siteRoot);
        }
        return; // ← ออกจาก ready() ทันที ไม่ fetch ไม่ inject
      }
      // ─────────────────────────────────────────────────────────────────────

      // On desktop, try to organize content into site-root before injecting footer
      if (window.matchMedia && window.matchMedia(DESKTOP_QUERY).matches) {
        ensureSiteRoot();
      }

      fetchFooterTemplate()
        .then(html => injectFooterHTML(html))
        .catch(err => {
          injectFooterHTML('<footer class="footer-minimal" role="contentinfo"><div class="footer-inner"><div>© FANTROVE</div></div></footer>');
          console.error('[FANTROVE] Footer injection failed:', err);
        });

      // Listen for viewport change to enable desktop layout if user resizes
      if (window.matchMedia) {
        const mq = window.matchMedia(DESKTOP_QUERY);
        const onChange = (e) => {
          if (e.matches) {
            const siteRoot = ensureSiteRoot();
            enableDesktopRootLayout(siteRoot);
            const footerEl = document.querySelector('footer.footer-minimal');
            if (footerEl && siteRoot) placeFooterNode(footerEl, siteRoot);
            const cw = siteRoot && siteRoot.querySelector('.site-content-wrapper');
            if (cw) try { cw.style.paddingBottom = ''; } catch(e) {}
          }
        };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
      }
    } catch (e) {
      console.error('[FANTROVE] Footer injection unexpected error:', e);
    }
  });

  try { window.__fantroveFooterDebug = { ensureSiteRoot, injectFallbackStyle, removeFallbackStyle }; } catch (e) {}

})();