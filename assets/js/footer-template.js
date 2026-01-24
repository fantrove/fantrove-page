// Auto Footer Injection Script (non-invasive; does NOT modify <body>)
// - Creates a site-root that contains a site-content-wrapper and footer (on desktop only).
// - Does NOT add classes or inline styles to <body>.
// - Ensures footer is last child of site-root and content-wrapper receives padding-bottom safety.
// - Loads footer.min.css with fallback.

(function() {
  const FOOTER_CSS_PATH = "/assets/css/footer.min.css";
  const FOOTER_TEMPLATE_PATH = "/assets/template-html/footer-template.html";
  const FALLBACK_STYLE_ID = "fantrove-footer-fallback-style";
  const DESKTOP_QUERY = "(min-width: 880px)";

  if (window.__fantroveFooterInjected) return;
  window.__fantroveFooterInjected = true;

  /* -------------------------
     Load CSS (with fallback)
     ------------------------- */
  function ensureFooterCSS() {
    const exists = [...document.styleSheets].some(s => s.href && s.href.indexOf('footer.min.css') !== -1);
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
        const nowExists = [...document.styleSheets].some(s => s.href && s.href.indexOf('footer.min.css') !== -1);
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
.footer-minimal{ box-sizing:border-box; width:100%; background:#fff; color:#111; border-top:1px solid #eee; padding:16px 12px; z-index:1; clear:both; flex-shrink:0; position:relative !important; left:0 !important; right:0 !important; bottom:auto !important; }
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
  // Select nodes that we consider "page content" and safe to move:
  // - Move element children of body except script/link/style/meta/template/noscript and footer.footer-minimal.
  function gatherContentCandidates() {
    return Array.from(document.body.children).filter(el => {
      const tag = el.tagName.toLowerCase();
      if (['script','link','style','meta','noscript','template'].includes(tag)) return false;
      if (tag === 'footer' && el.classList.contains('footer-minimal')) return false;
      return true;
    });
  }

  // Create a site-root and content wrapper if needed, and move content nodes inside
  function ensureSiteRoot() {
    try {
      if (document.querySelector('.site-root')) return document.querySelector('.site-root');

      const candidates = gatherContentCandidates();
      if (!candidates.length) return null;

      // create site-root and content-wrapper
      const siteRoot = document.createElement('div');
      siteRoot.className = 'site-root';
      // we mark layout mode via data attribute (JS will set on desktop)
      siteRoot.setAttribute('data-fantrove-layout', 'auto');

      const contentWrapper = document.createElement('div');
      contentWrapper.className = 'site-content-wrapper';

      // insert siteRoot before first candidate, and move candidates into contentWrapper
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

  // When desktop conditions met, enable column layout on site-root and ensure footer placement
  function enableDesktopRootLayout(siteRoot) {
    if (!siteRoot) return;
    try {
      // set attribute used by CSS: data-fantrove-layout="column"
      siteRoot.setAttribute('data-fantrove-layout', 'column');
    } catch (e) {}
  }

  /* -------------------------
     Inject / place footer
     ------------------------- */
  // Place footer inside siteRoot (after content-wrapper) OR, if there is existing footer,
  // move it under siteRoot so it becomes last child.
  function placeFooterNode(footerNode, siteRoot) {
    try {
      if (!siteRoot) {
        // fallback: append to body (still non-invasive)
        if (!footerNode.parentNode || footerNode.parentNode !== document.body) {
          document.body.appendChild(footerNode);
        }
        return footerNode;
      }
      // ensure siteRoot has content-wrapper; if not, create simple wrapper
      let contentWrapper = siteRoot.querySelector('.site-content-wrapper');
      if (!contentWrapper) {
        contentWrapper = document.createElement('div');
        contentWrapper.className = 'site-content-wrapper';
        // move existing children into wrapper
        Array.from(siteRoot.childNodes).forEach(c => contentWrapper.appendChild(c));
        siteRoot.appendChild(contentWrapper);
      }

      // append footerNode as last child of siteRoot (after contentWrapper)
      if (footerNode.parentNode !== siteRoot) {
        siteRoot.appendChild(footerNode);
      }
      return footerNode;
    } catch (e) {
      console.warn('[FANTROVE] placeFooterNode failed', e);
      // best-effort fallback
      if (footerNode && footerNode.parentNode !== document.body) document.body.appendChild(footerNode);
      return footerNode;
    }
  }

  // Inject footer HTML into a created element (no body modification)
  function injectFooterHTML(footerHTML) {
    const existing = document.querySelector('footer.footer-minimal');
    let footerEl = existing;
    if (!existing) {
      const container = document.createElement('div');
      container.innerHTML = footerHTML.trim();
      footerEl = container.querySelector('footer') || container.firstElementChild;
      if (!footerEl) {
        // fallback minimal footer element
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
    // place footer within siteRoot (preferred) or body (fallback)
    placeFooterNode(footerEl, siteRoot);

    // If desktop layout should be enabled, do so
    if (window.matchMedia && window.matchMedia(DESKTOP_QUERY).matches) {
      enableDesktopRootLayout(siteRoot);
    }

    // Ensure content wrapper has safety padding equal to footer height (so footer never overlaps content)
    const contentWrapper = (siteRoot && siteRoot.querySelector('.site-content-wrapper')) || null;
    if (contentWrapper) trackFooterSpacing(footerEl, contentWrapper);
    else { /* fallback: do nothing */ }

    return footerEl;
  }

  /* -------------------------
     Spacing: set padding on content wrapper (not on body)
     ------------------------- */
  function trackFooterSpacing(footer, contentWrapper) {
    if (!footer || !contentWrapper) return;

    function recompute() {
      try {
        const height = footer.offsetHeight || Math.round(footer.getBoundingClientRect().height) || 0;
        if (height > 0) {
          contentWrapper.style.paddingBottom = height + 'px';
        } else {
          contentWrapper.style.paddingBottom = '';
        }
      } catch (e) {}
    }

    recompute();
    setTimeout(recompute, 200);
    setTimeout(recompute, 800);

    if (window.ResizeObserver) {
      try {
        const ro = new ResizeObserver(recompute);
        ro.observe(footer);
      } catch (e) {}
    } else {
      let last = footer.offsetHeight;
      setInterval(() => {
        if (!document.body.contains(footer)) return;
        if (footer.offsetHeight !== last) {
          last = footer.offsetHeight;
          recompute();
        }
      }, 700);
    }

    window.addEventListener('resize', recompute);
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

      // On desktop, try to organize content into site-root before injecting footer
      if (window.matchMedia && window.matchMedia(DESKTOP_QUERY).matches) {
        ensureSiteRoot();
      } else {
        // create site-root even on smaller screens? keep non-invasive: create only when needed later
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
            // create and enable layout
            const siteRoot = ensureSiteRoot();
            enableDesktopRootLayout(siteRoot);
            // attempt to ensure existing footer is relocated under siteRoot
            const footerEl = document.querySelector('footer.footer-minimal');
            if (footerEl && siteRoot) placeFooterNode(footerEl, siteRoot);
          } else {
            // When shrinking, we keep structure intact (no unwrap) to avoid moving nodes repeatedly.
          }
        };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
      }
    } catch (e) {
      console.error('[FANTROVE] Footer injection unexpected error:', e);
    }
  });

  // Debug hook (optional)
  try { window.__fantroveFooterDebug = { ensureSiteRoot, injectFallbackStyle, removeFallbackStyle }; } catch (e) {}

})();