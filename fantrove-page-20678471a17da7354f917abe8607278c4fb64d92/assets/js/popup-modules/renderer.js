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
    var isFullscreen = opts.type === 'fullscreen';

    const rootEl = Utils.DOM.create('div', null, '', {
      position : 'fixed',
      zIndex   : String(instance.zIndex),
      willChange: 'transform, opacity',
    });

    // Fullscreen popups fill the entire viewport
    if (isFullscreen) {
      rootEl.style.inset = '0';
      rootEl.style.width = '100vw';
      rootEl.style.height = '100vh';
      rootEl.style.maxWidth = '100vw';
      rootEl.style.maxHeight = '100vh';
      rootEl.style.borderRadius = '0';
      rootEl.style.border = 'none';
      rootEl.style.overflow = 'hidden';
    }
    rootEl.setAttribute(D.ROOT_ATTR, '');
    rootEl.setAttribute(D.INSTANCE_ID_ATTR, instance.id);

    // Build class list
    var classes = [D.ROOT_CLASS];

    // Type class
    var typeClassMap = {
      dialog: D.CLASS_DIALOG, alert: D.CLASS_ALERT, confirm: D.CLASS_CONFIRM,
      sheet: D.CLASS_SHEET, toast: D.CLASS_TOAST, drawer: D.CLASS_DRAWER,
      tooltip: D.CLASS_TOOLTIP, popover: D.CLASS_POPOVER,
      fullscreen: D.CLASS_FULLSCREEN,
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

    // Fullscreen-specific sub-classes
    if (isFullscreen) {
      if (opts.showHeader === false) classes.push(D.FS_NO_HEADER);
      if (opts.contentLayout === 'stretch') classes.push(D.FS_LAYOUT_STRETCH);
    }

    // Theme class
    if (opts.theme && opts.theme !== 'light') classes.push('fp-theme-' + opts.theme);

    rootEl.className = classes.join(' ');

    // ARIA
    rootEl.setAttribute('role', opts.role || preset.defaultRole);
    if (opts.ariaLabel) rootEl.setAttribute('aria-label', opts.ariaLabel);
    if (opts.ariaDescribedBy) rootEl.setAttribute('aria-describedby', opts.ariaDescribedBy);

    // ── Inner container ────────────────────────────────────────────────────
    var inner = Utils.DOM.create('div', null, 'fp-inner');

    // Fullscreen inner fills the entire popup
    if (isFullscreen) {
      inner.style.height = '100%';
      inner.style.maxHeight = '100%';
    }

    // ── Header ──────────────────────────────────────────────────────────────
    var headerEl = null;
    var closeBtn = null;

    var shouldShowHeader = preset.hasHeader && opts.title !== null;
    // Fullscreen with showHeader=false skips header entirely
    if (isFullscreen && opts.showHeader === false) {
      shouldShowHeader = false;
    }

    if (shouldShowHeader) {
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

  M.Renderer = Object.freeze({ build });

})(window.PopupModules = window.PopupModules || {});