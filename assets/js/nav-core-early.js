// Path:    assets/js/nav-core-early.js
// Purpose: v5.0 — DOM scaffold only. No content rendering, no overlay hiding.
//          The boot loader (inline in HTML) owns the loading overlay.
//          nav-core (loaded later) owns content rendering.
//          This file just ensures the DOM scaffold exists so nav-core can
//          populate it when ready.
//
// v5.0 changes from v1.x:
//   - REMOVED: showEarlyOverlay() / hideEarlyOverlay() — boot loader owns this
//   - REMOVED: fetchButtonsConfig() / renderMinimal() — nav-core owns content
//   - KEPT: ensureDom() — minimal DOM scaffold so nav-core has elements to populate
//   - The boot loader overlay persists until nav-core's content.js signals ready.
//     This file does NOT touch the overlay.

(function () {
  'use strict';
  if (window._navCoreEarlyBoot) return;
  window._navCoreEarlyBoot = true;

  // Minimal helpers
  var q = function (s) { return document.querySelector(s); };
  var ce = function (t, attrs) {
    attrs = attrs || {};
    var el = document.createElement(t);
    Object.keys(attrs).forEach(function (k) {
      if (k === 'text') el.textContent = attrs[k];
      else if (k === 'class') el.className = attrs[k];
      else el.setAttribute(k, attrs[k]);
    });
    return el;
  };

  // Ensure minimal DOM scaffold exists. nav-core will populate these elements.
  // We do NOT render any content — that's nav-core's job after data loads.
  function ensureDom() {
    if (!q('header')) {
      var h = ce('header');
      var logo = ce('div', { class: 'logo' });
      h.appendChild(logo);
      document.body.prepend(h);
    }
    if (!q('#nav-list')) {
      var nav = ce('nav', { 'aria-label': 'Content type navigation' });
      var ul = ce('ul', { id: 'nav-list' });
      nav.appendChild(ul);
      var header = q('header');
      header && header.appendChild(nav);
    }
    if (!q('#sub-buttons-container')) {
      var sn = ce('div', { id: 'sub-nav', style: 'display:none' });
      var inner = ce('div', { class: 'hj' });
      var sbc = ce('div', { id: 'sub-buttons-container' });
      inner.appendChild(sbc);
      sn.appendChild(inner);
      var header2 = q('header');
      if (header2 && header2.nextSibling) header2.parentNode.insertBefore(sn, header2.nextSibling);
      else document.body.insertBefore(sn, header2 && header2.nextSibling || null);
    }
    if (!q('#content-loading')) {
      var c = ce('div', { id: 'content-loading' });
      var fvApp = document.getElementById('fv-app');
      if (fvApp) fvApp.appendChild(c);
      else document.body.appendChild(c);
    }
  }

  // Run ensureDom as soon as <body> exists.
  // Since this script is loaded with `async` from <body>, <body> already exists.
  try {
    ensureDom();
  } catch (e) {
    // If DOM isn't ready yet, retry on DOMContentLoaded
    document.addEventListener('DOMContentLoaded', function () {
      try { ensureDom(); } catch (_) {}
    }, { once: true });
  }

  // v5.0: Do NOT hide the boot loader overlay here. nav-core's content.js
  // will call LoadingService.hideInstant() which calls
  // window.__ncBootLoader.ready() when content is actually rendered.
})();
