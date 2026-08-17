// Path:    assets/js/popup-modules/theme.js
// Purpose: Theme application for popup instances.
//          Applies CSS custom properties to popup elements based on the
//          selected theme ('light', 'dark', 'brand').
//          Uses Fantrove design tokens from tokens.css.
// Used by: engine.js

(function(M) {
  'use strict';

  /**
   * Theme token maps. Each key is a CSS variable, each value is the
   * token value from tokens.css. This keeps popup styling 100% aligned
   * with the rest of the Fantrove design system.
   */
  var THEMES = Object.freeze({

    light: Object.freeze({
      '--fp-bg'                : 'var(--fv-surface-card)',
      '--fp-bg-alpha'          : 'rgba(255, 255, 255, 0.94)',
      '--fp-text'              : 'var(--fv-text-primary)',
      '--fp-text-heading'      : 'var(--fv-text-heading)',
      '--fp-text-secondary'    : 'var(--fv-text-secondary)',
      '--fp-text-muted'        : 'var(--fv-text-muted)',
      '--fp-text-inverse'      : 'var(--fv-text-inverse)',
      '--fp-border'            : 'var(--fv-border-default)',
      '--fp-border-strong'     : 'var(--fv-border-teal)',
      '--fp-accent'            : 'var(--fv-brand-teal)',
      '--fp-accent-light'      : 'var(--fv-brand-teal-light)',
      '--fp-accent-text'       : '#ffffff',
      '--fp-close-hover-bg'    : 'rgba(0, 0, 0, 0.04)',
      '--fp-overlay-bg'        : 'rgba(0, 0, 0, 0.2)',
      '--fp-overlay-bg-block'  : 'rgba(0, 0, 0, 0.45)',
      '--fp-radius'            : 'var(--fv-radius-md)',
      '--fp-shadow'            : 'var(--fv-shadow-lg)',
      '--fp-divider'           : 'rgba(0, 0, 0, 0.06)',
    }),

    dark: Object.freeze({
      '--fp-bg'                : '#1a1f2e',
      '--fp-bg-alpha'          : 'rgba(26, 31, 46, 0.94)',
      '--fp-text'              : '#e8edf5',
      '--fp-text-heading'      : '#f0f4fa',
      '--fp-text-secondary'    : '#9aa8be',
      '--fp-text-muted'        : '#6b7a94',
      '--fp-text-inverse'      : '#0f2629',
      '--fp-border'            : 'rgba(255, 255, 255, 0.08)',
      '--fp-border-strong'     : 'rgba(19, 180, 127, 0.4)',
      '--fp-accent'            : 'var(--fv-brand-teal-light)',
      '--fp-accent-light'      : 'var(--fv-brand-cyan-accent)',
      '--fp-accent-text'       : '#0f2629',
      '--fp-close-hover-bg'    : 'rgba(255, 255, 255, 0.08)',
      '--fp-overlay-bg'        : 'rgba(0, 0, 0, 0.5)',
      '--fp-overlay-bg-block'  : 'rgba(0, 0, 0, 0.65)',
      '--fp-radius'            : 'var(--fv-radius-md)',
      '--fp-shadow'            : '0 22px 50px rgba(0, 0, 0, 0.25)',
      '--fp-divider'           : 'rgba(255, 255, 255, 0.06)',
    }),

    brand: Object.freeze({
      '--fp-bg'                : 'var(--fv-surface-card)',
      '--fp-bg-alpha'          : 'rgba(255, 255, 255, 0.85)',
      '--fp-text'              : 'var(--fv-text-primary)',
      '--fp-text-heading'      : 'var(--fv-text-heading)',
      '--fp-text-secondary'    : 'var(--fv-text-body)',
      '--fp-text-muted'        : 'var(--fv-text-muted)',
      '--fp-text-inverse'      : '#ffffff',
      '--fp-border'            : 'var(--fv-border-teal)',
      '--fp-border-strong'     : 'var(--fv-border-teal-strong)',
      '--fp-accent'            : 'var(--fv-brand-teal)',
      '--fp-accent-light'      : 'var(--fv-brand-teal-light)',
      '--fp-accent-text'       : '#ffffff',
      '--fp-close-hover-bg'    : 'rgba(19, 180, 127, 0.08)',
      '--fp-overlay-bg'        : 'rgba(19, 180, 127, 0.1)',
      '--fp-overlay-bg-block'  : 'rgba(19, 180, 127, 0.25)',
      '--fp-radius'            : 'var(--fv-radius-md)',
      '--fp-shadow'            : 'var(--fv-shadow-teal)',
      '--fp-divider'           : 'rgba(19, 180, 127, 0.1)',
    }),
  });

  /**
   * Apply theme tokens to a popup root element.
   *
   * @param {HTMLElement} rootEl
   * @param {string} themeName - 'light'|'dark'|'brand'
   */
  function apply(rootEl, themeName) {
    var tokens = THEMES[themeName] || THEMES.light;
    var cssText = '';
    for (var key in tokens) {
      cssText += key + ':' + tokens[key] + ';';
    }
    rootEl.style.cssText += cssText;

    // Apply theme-specific overlay styling
    var overlayEl = rootEl.previousElementSibling;
    if (overlayEl && overlayEl.hasAttribute('data-fp-overlay')) {
      var overlayBg = rootEl.classList.contains('fp-blocking')
        ? tokens['--fp-overlay-bg-block']
        : tokens['--fp-overlay-bg'];
      overlayEl.style.backgroundColor = overlayBg;
    }
  }

  /**
   * Listen for system dark mode changes and update popups if needed.
   * Currently a no-op placeholder — can be expanded to auto-switch themes.
   */

  M.ThemeService = Object.freeze({ apply, THEMES });

})(window.PopupModules = window.PopupModules || {});