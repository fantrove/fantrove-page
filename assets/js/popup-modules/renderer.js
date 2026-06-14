// Path:    assets/js/popup-modules/renderer.js
// Purpose: DOM structure builder — creates the popup element tree
//          (overlay, root, header, body, footer) from resolved options.
//          Does NOT handle animation or lifecycle — only DOM construction.
// Used by: engine.js

(function(M) {
  'use strict';

  const { CONFIG, State, Utils } = M;

  /**
   * Build the complete popup DOM structure and append to document.body.
   *
   * Returns references to key elements for the engine to manage.
   *
   * @param {PopupInstance} instance
   * @returns {{ rootEl: HTMLElement, overlayEl: HTMLElement|null,
   *             headerEl: HTMLElement|null, bodyEl: HTMLElement,
   *             footerEl: HTMLElement|null, closeBtn: HTMLElement|null }}
   */
  function build(instance) {
    const opts = instance.options;
    const preset = Utils.getPreset(opts.type);
    const D = CONFIG.DOM;

    let overlayEl = null;

    // ── Overlay (if preset has one) ────────────────────────────────────────
    if (preset.hasOverlay) {
      overlayEl = Utils.DOM.create('div', null, D.OVERLAY_CLASS, {
        position    : 'fixed',
        inset       : '0',
        zIndex      : String(instance.zIndex - 1),
        opacity     : '0',
        transition  : 'opacity 0ms',
        willChange  : 'opacity',
      });
      overlayEl.setAttribute(D.OVERLAY_ATTR, '');
      overlayEl.setAttribute('aria-hidden', 'true');

      // Overlay styling depends on blocking vs non-blocking
      if (opts.blocking) {
        overlayEl.style.backgroundColor = 'rgba(0, 0, 0, 0.45)';
        overlayEl.style.backdropFilter = 'blur(4px)';
        overlayEl.style.webkitBackdropFilter = 'blur(4px)';
      } else {
        overlayEl.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
      }
    }

    // ── Root element ────────────────────────────────────────────────────────
    const rootEl = Utils.DOM.create('div', null, '', {
      position : 'fixed',
      zIndex   : String(instance.zIndex),
      willChange: 'transform, opacity',
    });
    rootEl.setAttribute(D.ROOT_ATTR, '');
    rootEl.setAttribute(D.INSTANCE_ID_ATTR, instance.id);

    // Build class list
    var classes = [D.ROOT_CLASS];

    // Type class
    var typeClassMap = {
      dialog: D.CLASS_DIALOG, alert: D.CLASS_ALERT, confirm: D.CLASS_CONFIRM,
      sheet: D.CLASS_SHEET, toast: D.CLASS_TOAST, drawer: D.CLASS_DRAWER,
      tooltip: D.CLASS_TOOLTIP, popover: D.CLASS_POPOVER,
    };
    if (typeClassMap[opts.type]) classes.push(typeClassMap[opts.type]);

    // Size class
    classes.push(D.SIZE_PREFIX + (opts.size || preset.defaultSize));

    // Position class
    classes.push(D.POS_PREFIX + (opts.position || preset.defaultPosition));

    // State classes
    if (opts.blocking) classes.push(D.CLASS_BLOCKING);
    if (opts.persistent) classes.push(D.CLASS_PERSISTENT);
    if (opts.glassmorphism) classes.push(D.CLASS_Glass);
    if (opts.borderless) classes.push(D.CLASS_BORDERLESS);
    if (opts.variant) classes.push(opts.variant);
    if (opts.anchor) classes.push(D.ANCHOR_CLASS);

    // Theme class
    if (opts.theme && opts.theme !== 'light') classes.push('fp-theme-' + opts.theme);

    rootEl.className = classes.join(' ');

    // ARIA
    rootEl.setAttribute('role', opts.role || preset.defaultRole);
    if (opts.ariaLabel) rootEl.setAttribute('aria-label', opts.ariaLabel);
    if (opts.ariaDescribedBy) rootEl.setAttribute('aria-describedby', opts.ariaDescribedBy);

    // ── Inner container ────────────────────────────────────────────────────
    var inner = Utils.DOM.create('div', null, 'fp-inner');

    // ── Header ──────────────────────────────────────────────────────────────
    var headerEl = null;
    var closeBtn = null;

    if (preset.hasHeader && opts.title !== null) {
      headerEl = Utils.DOM.create('div', null, 'fp-header');
      headerEl.setAttribute(D.HEADER_ATTR, '');

      var titleEl = Utils.DOM.create('div', null, 'fp-title');
      titleEl.textContent = opts.title || '';
      headerEl.appendChild(titleEl);

      // Close button
      if (preset.hasCloseButton && opts.closable !== false) {
        closeBtn = Utils.DOM.create('button', null, 'fp-close-btn', { type: 'button' });
        closeBtn.setAttribute(D.CLOSE_BTN_ATTR, '');
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        headerEl.appendChild(closeBtn);
      }

      inner.appendChild(headerEl);
    }

    // ── Body ────────────────────────────────────────────────────────────────
    var bodyEl = Utils.DOM.create('div', null, 'fp-body');
    bodyEl.setAttribute(D.BODY_ATTR, '');

    if (opts.scrollContainer) {
      bodyEl.style.overflowY = 'auto';
      bodyEl.style.overscrollBehavior = 'contain';
    }

    // Content injection
    if (typeof opts.body === 'string') {
      bodyEl.innerHTML = opts.body;
    } else if (opts.body instanceof HTMLElement) {
      bodyEl.appendChild(opts.body);
    } else if (opts.body && typeof opts.body.then === 'function') {
      // Async body (Promise) — show loading state, return a resolver
      bodyEl.classList.add(CONFIG.DOM.CLASS_LOADING_BODY);
      bodyEl.innerHTML = _buildLoadingHtml(opts.loadingLabel);
      instance._asyncBody = opts.body; // store promise for engine to resolve
    }

    // Shadow DOM mode
    if (opts.shadowDom && typeof bodyEl.attachShadow === 'function') {
      bodyEl.classList.add(CONFIG.DOM.CLASS_SHADOW_HOST);
      // Content will be moved into shadow root by engine after async resolve
      instance._shadowDom = true;
    }

    // Slots support — named content regions
    if (opts.slots) {
      if (opts.slots.body !== undefined) {
        bodyEl.innerHTML = '';
        if (typeof opts.slots.body === 'string') bodyEl.innerHTML = opts.slots.body;
        else if (opts.slots.body instanceof HTMLElement) bodyEl.appendChild(opts.slots.body);
      }
    }

    inner.appendChild(bodyEl);

    // ── Footer ──────────────────────────────────────────────────────────────
    var footerEl = null;

    if (preset.hasFooter && opts.footer !== null && opts.footer !== undefined) {
      footerEl = Utils.DOM.create('div', null, 'fp-footer');
      footerEl.setAttribute(D.FOOTER_ATTR, '');
      footerEl.innerHTML = opts.footer;
      inner.appendChild(footerEl);
    }

    rootEl.appendChild(inner);

    // ── Append to DOM ───────────────────────────────────────────────────────
    if (overlayEl) document.body.appendChild(overlayEl);
    document.body.appendChild(rootEl);

    // ── Anchored positioning ───────────────────────────────────────────────
    if (opts.anchor) {
      _applyAnchorPosition(rootEl, opts);
    }

    return { rootEl: rootEl, overlayEl: overlayEl, headerEl: headerEl, bodyEl: bodyEl, footerEl: footerEl, closeBtn: closeBtn };
  }

  /**
   * Build the loading indicator HTML.
   * @param {string} [label]
   * @returns {string}
   */
  function _buildLoadingHtml(label) {
    var text = label !== undefined ? label : CONFIG.LOADING.DEFAULT_LABEL;
    var labelHtml = text ? '<div class="fp-loading-label">' + text + '</div>' : '';
    return '<div class="fp-loading-overlay"><div class="fp-loading-content">' +
      CONFIG.LOADING.SPINNER_HTML + labelHtml + '</div></div>';
  }

  /**
   * Show or hide the loading overlay inside a popup body.
   * @param {HTMLElement} bodyEl
   * @param {boolean} isLoading
   * @param {string} [label]
   */
  function setLoadingState(bodyEl, isLoading, label) {
    var existing = bodyEl.querySelector('.fp-loading-overlay');
    if (isLoading && !existing) {
      var overlay = document.createElement('div');
      overlay.innerHTML = _buildLoadingHtml(label);
      bodyEl.appendChild(overlay.firstElementChild);
      bodyEl.classList.add(CONFIG.DOM.CLASS_LOADING_BODY);
    } else if (!isLoading && existing) {
      existing.parentNode.removeChild(existing);
      bodyEl.classList.remove(CONFIG.DOM.CLASS_LOADING_BODY);
    }
  }

  /**
   * Position a popup relative to an anchor element.
   * Used for tooltips and popovers.
   */
  function _applyAnchorPosition(popupEl, opts) {
    var anchorEl = document.querySelector(opts.anchor);
    if (!anchorEl) return;

    var rect = anchorEl.getBoundingClientRect();
    var placement = opts.placement || 'bottom';
    var gap = 8; // px gap between anchor and popup

    var top, left;
    switch (placement) {
      case 'top':
        top = rect.top - gap;
        left = rect.left + (rect.width / 2);
        popupEl.style.transform = 'translate(-50%, -100%)';
        break;
      case 'bottom':
        top = rect.bottom + gap;
        left = rect.left + (rect.width / 2);
        popupEl.style.transform = 'translate(-50%, 0)';
        break;
      case 'left':
        top = rect.top + (rect.height / 2);
        left = rect.left - gap;
        popupEl.style.transform = 'translate(-100%, -50%)';
        break;
      case 'right':
        top = rect.top + (rect.height / 2);
        left = rect.right + gap;
        popupEl.style.transform = 'translate(0, -50%)';
        break;
      default: // auto
        top = rect.bottom + gap;
        left = rect.left + (rect.width / 2);
        popupEl.style.transform = 'translate(-50%, 0)';
    }

    popupEl.style.top = top + 'px';
    popupEl.style.left = left + 'px';
  }

  M.Renderer = Object.freeze({ build, setLoadingState, _buildLoadingHtml });

})(window.PopupModules = window.PopupModules || {});