// Path:    assets/js/popup-modules/init.js
// Purpose: Bootstrapper — called after all modules are loaded.
//          Creates the frozen window.PopupSystem global API.
//          Dispatches the 'fp:ready' system event.
// Used by: popup.js (entry point)

(function(M) {
 'use strict';
 
 const { Engine, CONFIG, State } = M;
 
 // ── Public API ────────────────────────────────────────────────────────────
 
 window.PopupSystem = Object.freeze({
  _initialized: true,
  version: '2.0.0',
  
  /**
   * Open a new popup with full control.
   * @param {PopupOptions} opts
   * @returns {Promise<PopupHandle>}
   */
  open: function(opts) { return Engine.open(opts); },
  
  /**
   * Open a popup as a universal container.
   * The popup system controls size, position, animation, theme, accessibility.
   * The calling system controls ALL content.
   *
   * @param {ContainerOptions} opts
   * @returns {Promise<PopupHandle>}
   *
   * @example
   * // Any system can open a container:
   * const h = await PopupSystem.container({
   *   title: 'My Feature',
   *   content: myHTML,  // or Promise<string>
   *   size: 'sm',
   *   group: 'my-feature',
   *   onBodyEvent: (name, detail, handle) => { ... },
   *   onContentReady: (bodyEl, handle) => { ... },
   * });
   * // Later:
   * h.setLoading(true, 'Saving...');
   * h.setLoading(false);
   * h.emit('saved', { id: 123 });
   * h.close();
   */
  container: function(opts) { return Engine.container(opts); },
  
  /**
   * Close a popup by ID.
   * @param {string} id
   * @param {{ action?: string, data?: any }} [result]
   * @returns {Promise<void>}
   */
  close: function(id, result) { return Engine.close(id, result); },
  
  /**
   * Immediately destroy a popup (no animation).
   * @param {string} id
   */
  destroy: function(id) { Engine.destroy(id); },
  
  /**
   * Close all open popups.
   * @returns {Promise<void>}
   */
  closeAll: function() { return Engine.closeAll(); },
  
  /**
   * Close the popup in a specific group.
   * @param {string} group
   */
  closeByGroup: function(group) { Engine.closeByGroup(group); },
  
  /**
   * Register a custom preset for use by any system.
   * Custom presets work exactly like built-in presets.
   *
   * @param {string} name - e.g. 'language-selector', 'update-dialog'
   * @param {PresetConfig} config - Same shape as built-in presets
   * @returns {boolean} true on success
   *
   * @example
   * PopupSystem.registerPreset('update-dialog', {
   *   type: 'update-dialog',
   *   defaultSize: 'md',
   *   defaultPosition: 'center',
   *   hasOverlay: true,
   *   hasHeader: true,
   *   hasFooter: true,
   *   hasCloseButton: true,
   *   defaultClosable: true,
   *   defaultBlocking: true,
   *   defaultLockScroll: true,
   *   defaultFocusTrap: true,
   *   defaultStackable: false,
   *   defaultDismissOnOverlay: true,
   *   defaultDismissOnEscape: true,
   *   enterAnimation: 'fp-enter-center',
   *   exitAnimation: 'fp-exit-center',
   *   defaultRole: 'dialog',
   *   zIndexLayer: 25000,
   * });
   * // Then use it:
   * PopupSystem.open({ type: 'update-dialog', body: '...' });
   */
  registerPreset: function(name, config) { return Engine.registerPreset(name, config); },
  
  /**
   * Show an alert dialog.
   * @param {string} message
   * @param {Object} [opts]
   * @returns {Promise<void>}
   */
  alert: function(message, opts) { return Engine.alert(message, opts); },
  
  /**
   * Show a confirm dialog.
   * @param {string} message
   * @param {Object} [opts]
   * @returns {Promise<boolean>}
   */
  confirm: function(message, opts) { return Engine.confirm(message, opts); },
  
  /**
   * Show a toast notification.
   * @param {string|HTMLElement} content
   * @param {Object} [opts]
   * @returns {Promise<PopupHandle>}
   */
  toast: function(content, opts) { return Engine.toast(content, opts); },
  
  /**
   * Subscribe to system events: 'opening', 'opened', 'closing', 'closed',
   * 'destroyed', 'queued', 'updated', 'preset:registered', 'preset:removed'.
   * @param {string} event
   * @param {Function} fn
   * @returns {Function} Unsubscribe
   */
  on: function(event, fn) { return Engine.onSystem(event, fn); },
  
  /**
   * Get diagnostic stats.
   * @returns {object}
   */
  stats: function() { return Engine.stats(); },
  
  /**
   * Log debug info to console.
   * @returns {object}
   */
  debug: function() { return Engine.debug(); },
  
  /**
   * Access internal modules for advanced use.
   * @returns {PopupModules}
   */
  modules: function() { return M; },
  
  /**
   * Access config constants.
   * @returns {AppConfig}
   */
  config: function() { return CONFIG; },
 });
 
 // ── Dispatch ready event ──────────────────────────────────────────────────
 
 try {
  window.dispatchEvent(new CustomEvent('fp:ready', { detail: { version: '2.0.0' } }));
 } catch (_) {}
 
})(window.PopupModules = window.PopupModules || {});