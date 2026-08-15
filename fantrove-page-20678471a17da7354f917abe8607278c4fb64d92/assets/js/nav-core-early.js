(function () {
  // Very small early bootstrap to show UI + cached content ASAP.
  if (window._navCoreEarlyBoot) return;
  window._navCoreEarlyBoot = true;

  // Minimal helpers
  const q = s => document.querySelector(s);
  const ce = (t, attrs = {}) => {
    const el = document.createElement(t);
    Object.keys(attrs).forEach(k => {
      if (k === 'text') el.textContent = attrs[k];
      else if (k === 'html') el.innerHTML = attrs[k];
      else if (k === 'class') el.className = attrs[k];
      else el.setAttribute(k, attrs[k]);
    });
    return el;
  };

  // Ensure minimal DOM exists
  function ensureDom() {
    if (!q('header')) {
      const h = ce('header');
      const logo = ce('div', { class: 'logo' });
      h.appendChild(logo);
      document.body.prepend(h);
    }
    if (!q('#nav-list')) {
      const nav = ce('nav', { 'aria-label': 'Content type navigation' });
      const ul = ce('ul', { id: 'nav-list' });
      nav.appendChild(ul);
      const header = q('header');
      // put nav inside header (append)
      header?.appendChild(nav);
    }
    if (!q('#sub-buttons-container')) {
      const sn = ce('div', { id: 'sub-nav', style: 'display:none' });
      const inner = ce('div', { class: 'hj' });
      const sbc = ce('div', { id: 'sub-buttons-container' });
      inner.appendChild(sbc);
      sn.appendChild(inner);
      const header = q('header');
      if (header?.nextSibling) header.parentNode.insertBefore(sn, header.nextSibling);
      else document.body.insertBefore(sn, header?.nextSibling || null);
    }
    if (!q('#content-loading')) {
      const c = ce('div', { id: 'content-loading' });
      // make content container visually obvious until real CSS loads
      c.style.minHeight = '220px';
      c.style.padding = '16px';
      const fvApp = document.getElementById('fv-app');
      if (fvApp) fvApp.appendChild(c);
      else document.body.appendChild(c);
    }
  }

  // Lightweight inline overlay so user sees "loading" quickly.
  function showEarlyOverlay() {
    if (q('#nc-early-overlay')) return;
    const ov = ce('div', { id: 'nc-early-overlay', role: 'status', 'aria-live': 'polite' });
    ov.style.position = 'fixed';
    ov.style.left = '0';
    ov.style.top = '0';
    ov.style.right = '0';
    ov.style.zIndex = '99999';
    ov.style.padding = '12px';
    ov.style.background = 'rgba(255,255,255,0.95)';
    ov.style.display = 'flex';
    ov.style.alignItems = 'center';
    ov.style.gap = '10px';
    ov.style.fontFamily = 'system-ui, Roboto, "Helvetica Neue", Arial';
    ov.innerHTML = `<svg width="18" height="18" viewBox="0 0 52 52" aria-hidden="true">
      <circle cx="26" cy="26" r="22" stroke="#e6e6e6" stroke-width="3" fill="none"></circle>
      <circle cx="26" cy="26" r="22" stroke="#13b47f" stroke-width="3" stroke-dasharray="34 164" transform="rotate(-90 26 26)">
        <animateTransform attributeName="transform" type="rotate" from="0 26 26" to="360 26 26" dur="1s" repeatCount="indefinite"/>
      </circle>
    </svg><div id="nc-early-msg">Loading…</div>`;
    document.documentElement.appendChild(ov);
    // auto-hide after 2s if nothing else happens (safety)
    setTimeout(() => { try { const e = q('#nc-early-overlay'); if (e) e.remove(); } catch (_) {} }, 2000);
  }

  function hideEarlyOverlay() {
    try { const e = q('#nc-early-overlay'); if (e) e.remove(); } catch (_) {}
  }

  // Try to read config from browser HTTP cache (force-cache) then network fallback.
  async function fetchButtonsConfig() {
    const url = '/assets/json/buttons.json';
    if (!navigator.onLine) {
      // try force-cache anyway
      try {
        const resp = await fetch(url, { cache: 'force-cache' });
        if (resp && resp.ok) return resp.json();
      } catch (_) {}
      return null;
    }
    try {
      const resp = await fetch(url, { cache: 'force-cache' });
      if (resp && resp.ok) return await resp.json();
    } catch (_) {}
    try {
      const resp2 = await fetch(url, { cache: 'no-store' });
      if (resp2 && resp2.ok) return await resp2.json();
    } catch (_) {}
    return null;
  }

  // Minimal renderer: render main buttons and first content items (fast)
  async function renderMinimal(uiConfig) {
    const lang = localStorage.getItem('selectedLang') || 'en';
    const mainButtons = (uiConfig && uiConfig.mainButtons) || [];
    const ul = document.getElementById('nav-list');
    if (!ul) return;

    ul.innerHTML = '';
    let def = null;
    for (const cfg of mainButtons) {
      const label = cfg[`${lang}_label`] || cfg.en_label || cfg.url || cfg.jsonFile || '…';
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'main-button';
      btn.textContent = label;
      btn.dataset.url = cfg.url || cfg.jsonFile || '';
      btn.onclick = () => {
        // gentle navigation — real RouterService will take over later
        try { window.location.search = `?type=${encodeURIComponent(btn.dataset.url)}__`; } catch (_) {}
      };
      li.appendChild(btn);
      ul.appendChild(li);
      if (cfg.isDefault && !def) def = cfg;
    }

    // choose default
    const chosen = def || mainButtons[0];
    if (!chosen) { hideEarlyOverlay(); return; }

    // mark active visually
    const activeBtn = ul.querySelector('button');
    if (activeBtn) activeBtn.classList.add('active');

    // render first batch of content (fetch jsonFile if available)
    const contentCtr = document.getElementById('content-loading');
    if (!contentCtr) { hideEarlyOverlay(); return; }
    contentCtr.innerHTML = '<div style="opacity:0.6">Loading content…</div>';

    try {
      let items = null;
      if (chosen.jsonFile) {
        try {
          const r = await fetch(chosen.jsonFile, { cache: 'force-cache' });
          if (r && r.ok) items = await r.json();
        } catch (_) {
          try {
            const r2 = await fetch(chosen.jsonFile, { cache: 'no-store' });
            if (r2 && r2.ok) items = await r2.json();
          } catch (_) { /* ignore */ }
        }
      }
      const arr = Array.isArray(items) ? items : (items ? [items] : []);
      const frag = document.createDocumentFragment();
      const max = Math.min(20, arr.length);
      for (let i = 0; i < max; i++) {
        const it = arr[i];
        if (!it) continue;
        if (it.type === 'card' || it.image) {
          const card = document.createElement('div');
          card.className = 'card';
          card.style.border = '1px solid #eee';
          card.style.padding = '10px';
          card.style.margin = '6px 0';
          card.textContent = (it.title || it.name || it.description || '').toString();
          frag.appendChild(card);
        } else {
          const b = document.createElement('button');
          b.className = 'button-content';
          b.style.margin = '4px 6px 4px 0';
          b.textContent = it.text || it.content || it.api || it.name || '…';
          frag.appendChild(b);
        }
      }
      contentCtr.innerHTML = '';
      contentCtr.appendChild(frag);
    } catch (e) {
      contentCtr.innerHTML = '<div style="opacity:0.6">Unable to load preview.</div>';
    } finally {
      hideEarlyOverlay();
    }
  }

  // Fire off early bootstrap — do not block; give up quickly if slow
  try {
    ensureDom();
    showEarlyOverlay();
    // run fetch and render, but don't block longer than ~800ms for the early UI
    const t = setTimeout(() => { /* safety: hide overlay if still visible */ hideEarlyOverlay(); }, 800);
    fetchButtonsConfig().then(cfg => {
      clearTimeout(t);
      if (cfg) renderMinimal(cfg).catch(() => hideEarlyOverlay());
      else hideEarlyOverlay();
    }).catch(() => { clearTimeout(t); hideEarlyOverlay(); });
  } catch (e) {
    try { hideEarlyOverlay(); } catch (_) {}
  }
})();