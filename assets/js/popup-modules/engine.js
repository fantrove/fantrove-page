// Path:    assets/js/popup-modules/engine.js
// Purpose: Main orchestrator — wires all modules together and exposes the
//          public PopupSystem API (window.PopupSystem).
//          This is the most important module — it manages the full lifecycle
//          of every popup: open → animate → interact → close → cleanup.
//
// Lifecycle of a popup:
//   1. PopupSystem.open(opts) called
//   2. QueueManager checks capacity → opens or enqueues
//   3. Options merged with preset via Utils.mergeOptions()
//   4. PopupInstance created, added to State
//   5. Renderer.build() creates DOM
//   6. ThemeService.apply() sets theme tokens
//   7. OverlayService attaches listeners
//   8. A11yService installs focus trap + manages inert siblings
//   9. Scroll lock applied (if needed)
//  10. Animator.enter() plays animation
//  11. onMount callback fires → PopupHandle returned
//  12. If async body: resolves → content injected → onContentReady fires
//  13. User interacts...
//  14. close() called (or auto-close, or overlay click, or escape)
//  15. onBeforeClose guard checked
//  16. Animator.exit() plays exit animation
//  17. Cleanup: DOM removed, listeners detached, scroll unlocked
//  18. onClose callback fires
//  19. QueueManager.processNext() opens next queued popup
//
// Used by: popup.js (entry point) → reads M.Engine to build window.PopupSystem

(function(M) {
  'use strict';

  const {
    CONFIG, State, Utils, Animator, QueueManager,
    Renderer, OverlayService, ThemeService, A11yService,
  } = M;

  // ── Private registry of cleanup functions per instance ─────────────────────

  /** @type {Map<string, Function[]>} */
  const _cleanups = new Map();

  function _addCleanup(id, fn) {
    if (!_cleanups.has(id)) _cleanups.set(id, []);
    _cleanups.get(id).push(fn);
  }

  function _runCleanups(id) {
    const fns = _cleanups.get(id);
    if (!fns) return;
    for (const fn of fns) {
      try { fn(); } catch (e) { console.error('[PopupSystem] cleanup error:', e); }
    }
    _cleanups.delete(id);
  }

  // ── Inject content into body (shared by open and async resolve) ───────────

  function _injectContent(bodyEl, content, useShadowDom) {
    if (!useShadowDom) {
      if (typeof content === 'string') {
        bodyEl.innerHTML = content;
      } else if (content instanceof HTMLElement) {
        bodyEl.innerHTML = '';
        bodyEl.appendChild(content);
      }
      return;
    }
    // Shadow DOM mode
    var shadowRoot = bodyEl.attachShadow({ mode: 'open' });
    if (typeof content === 'string') {
      shadowRoot.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      shadowRoot.appendChild(content);
    }
    // Store reference for later access
    bodyEl._fpShadowRoot = shadowRoot;
  }

  // ── Open ───────────────────────────────────────────────────────────────────

  /**
   * Open a new popup. Returns a Promise that resolves with a PopupHandle
   * after the enter animation completes (and async body resolves, if any).
   *
   * @param {PopupOptions} userOpts
   * @returns {Promise<PopupHandle>}
   */
  async function open(userOpts = {}) {
    // 1. Resolve preset and merge options
    const preset = Utils.getPreset(userOpts.type || 'dialog');
    const opts = Utils.mergeOptions(userOpts, preset);

    // 2. Generate ID if not provided
    const id = opts.id || State.generateId();
    opts.id = id;

    // 3. Resolve z-index
    const stackPos = State.getStackHeight();
    const baseZ = opts.zIndex || preset.zIndexLayer;
    const zIndex = Utils.resolveZIndex(baseZ, stackPos);

    // 4. Create internal instance record
    const instance = {
      id        : id,
      options   : opts,
      rootEl    : null,
      overlayEl : null,
      bodyEl    : null,
      headerEl  : null,
      footerEl  : null,
      triggerEl : opts.triggerEl || null,
      state     : 'opening',
      openAt    : Date.now(),
      zIndex    : zIndex,
      autoCloseTimer: null,
      listeners : new Set(),
      _asyncBody: null,
      _shadowDom: false,
    };

    // 5. Save trigger element reference
    if (opts.triggerEl) {
      opts.triggerEl.setAttribute(CONFIG.DOM.TRIGGER_ATTR, '#' + id);
    }

    // 6. Build DOM
    const dom = Renderer.build(instance);
    instance.rootEl = dom.rootEl;
    instance.overlayEl = dom.overlayEl;
    instance.headerEl = dom.headerEl;
    instance.bodyEl = dom.bodyEl;
    instance.footerEl = dom.footerEl;

    // 7. Apply theme
    ThemeService.apply(dom.rootEl, opts.theme || 'light');

    // 8. Register instance in state
    State.addInstance(instance);

    // 9. Emit system event
    State._emit('opening', { id, type: opts.type });

    // 10. Attach interaction listeners
    _attachInteractions(instance, dom);

    // 11. Event bridge — forward CustomEvents from body content
    if (typeof opts.onBodyEvent === 'function') {
      var bodyEventHandler = function(e) {
        if (e.type && e.type.indexOf('fp:') === 0) {
          var eventName = e.type.replace('fp:', '');
          opts.onBodyEvent(eventName, e.detail, _createHandle(instance));
        }
      };
      dom.bodyEl.addEventListener('fp:*', bodyEventHandler);
      // Also listen for any custom event with fp: prefix via delegation
      var delegatingHandler = function(e) {
        if (e.type && e.type.indexOf('fp:') === 0 && e.target !== dom.bodyEl) {
          var eventName = e.type.replace('fp:', '');
          opts.onBodyEvent(eventName, e.detail, _createHandle(instance));
        }
      };
      // Use capture to catch events from shadow DOM too
      dom.rootEl.addEventListener('fp:*', delegatingHandler, true);
      _addCleanup(id, function() {
        dom.bodyEl.removeEventListener('fp:*', bodyEventHandler);
        dom.rootEl.removeEventListener('fp:*', delegatingHandler, true);
      });
    }

    // 12. Accessibility
    if (opts.focusTrap !== false) {
      const cleanupTrap = A11yService.installFocusTrap(id, dom.rootEl);
      _addCleanup(id, cleanupTrap);
    }
    if (opts.blocking) {
      A11yService.manageInertSiblings(true, dom.rootEl);
      _addCleanup(id, function() { A11yService.manageInertSiblings(false); });
    }

    // 13. Scroll lock
    if (opts.lockScroll !== false) {
      State.lockScroll();
      _addCleanup(id, function() { State.unlockScroll(); });
    }

    // 14. Stagger delay for stacked popups
    if (stackPos > 0) {
      await Animator.staggerDelay(stackPos);
    }

    // 15. Play enter animation
    instance.state = 'opening';
    await Animator.enter(dom.rootEl, dom.overlayEl, opts);
    instance.state = 'open';
    dom.rootEl.classList.add(CONFIG.DOM.OPEN_CLASS);

    // 16. Auto-focus
    if (opts.focusTrap !== false) {
      A11yService.autoFocus(dom.rootEl, dom.bodyEl);
    }

    // 17. Auto-close timer
    if (opts.timeout && opts.timeout > 0) {
      instance.autoCloseTimer = setTimeout(function() {
        close(id, { action: 'timeout' });
      }, opts.timeout + CONFIG.TIMING.AUTO_CLOSE_GRACE);
    }

    // 18. Fire onMount callback (DOM ready, before onOpen)
    if (typeof opts.onMount === 'function') {
      try { opts.onMount(dom.bodyEl, _createHandle(instance)); } catch (e) {
        console.error('[PopupSystem] onMount error:', e);
      }
    }

    // 19. Fire onOpen callback
    if (typeof opts.onOpen === 'function') {
      try { opts.onOpen(id, _createHandle(instance)); } catch (e) {
        console.error('[PopupSystem] onOpen error:', e);
      }
    }

    // 20. Emit system event
    State._emit('opened', { id, type: opts.type, stackHeight: State.getStackHeight() });

    // 21. Handle async body (Promise)
    if (instance._asyncBody) {
      try {
        var content = await instance._asyncBody;
        // Remove loading state
        Renderer.setLoadingState(dom.bodyEl, false);
        dom.bodyEl.classList.remove(CONFIG.DOM.CLASS_LOADING_BODY);
        // Inject resolved content
        _injectContent(dom.bodyEl, content, instance._shadowDom);
        instance._asyncBody = null;
        // Fire onContentReady
        if (typeof opts.onContentReady === 'function') {
          try { opts.onContentReady(dom.bodyEl, _createHandle(instance)); } catch (e) {
            console.error('[PopupSystem] onContentReady error:', e);
          }
        }
      } catch (err) {
        console.error('[PopupSystem] async body error:', err);
        Renderer.setLoadingState(dom.bodyEl, false);
        dom.bodyEl.classList.remove(CONFIG.DOM.CLASS_LOADING_BODY);
        dom.bodyEl.innerHTML = '<div class="fp-error-body">Failed to load content</div>';
      }
    }

    return _createHandle(instance);
  }

  // ── Close ──────────────────────────────────────────────────────────────────

  /**
   * Close a popup by ID with an optional result.
   *
   * @param {string} id
   * @param {{ action?: string, data?: any }} [result]
   * @returns {Promise<void>}
   */
  async function close(id, result = {}) {
    const instance = State.getInstance(id);
    if (!instance) return;
    if (instance.state === 'closing' || instance.state === 'closed' || instance.state === 'destroyed') return;

    const opts = instance.options;

    // onBeforeClose guard
    if (typeof opts.onBeforeClose === 'function') {
      try {
        const allowed = await opts.onBeforeClose(id);
        if (allowed === false) return; // prevent close
      } catch (e) {
        console.error('[PopupSystem] onBeforeClose error:', e);
      }
    }

    instance.state = 'closing';
    State._emit('closing', { id, result });

    // Clear auto-close timer
    if (instance.autoCloseTimer) {
      clearTimeout(instance.autoCloseTimer);
      instance.autoCloseTimer = null;
    }

    // Exit animation
    await Animator.exit(instance.rootEl, instance.overlayEl, opts);

    // Return focus
    if (opts.returnFocus !== false) {
      A11yService.returnFocus(instance.triggerEl);
    }

    // Run all cleanups (listeners, scroll unlock, inert, focus trap)
    _runCleanups(id);

    // Detach all overlay service listeners for this instance
    OverlayService.detachAll(id);

    // Remove DOM
    Utils.DOM.remove(instance.overlayEl);
    Utils.DOM.remove(instance.rootEl);

    // Update state
    instance.state = 'closed';
    State.removeInstance(id);

    // Fire onClose callback
    var closeResult = Object.assign({ action: result.action || 'close', data: result.data }, result);
    if (typeof opts.onClose === 'function') {
      try { opts.onClose(id, closeResult); } catch (e) {
        console.error('[PopupSystem] onClose error:', e);
      }
    }

    // Fire instance listeners
    for (const fn of instance.listeners) {
      try { fn({ type: 'close', result: closeResult }); } catch (_) {}
    }

    // Emit system event
    State._emit('closed', { id, result: closeResult });

    // Process queue
    QueueManager.processNext(open);
  }

  // ── Destroy (immediate, no animation) ──────────────────────────────────────

  function destroy(id) {
    const instance = State.getInstance(id);
    if (!instance) return;

    if (instance.autoCloseTimer) {
      clearTimeout(instance.autoCloseTimer);
      instance.autoCloseTimer = null;
    }

    _runCleanups(id);
    OverlayService.detachAll(id);

    Utils.DOM.remove(instance.overlayEl);
    Utils.DOM.remove(instance.rootEl);

    instance.state = 'destroyed';
    State.removeInstance(id);

    State._emit('destroyed', { id });
    QueueManager.processNext(open);
  }

  // ── Close all ──────────────────────────────────────────────────────────────

  async function closeAll() {
    const instances = State.getAllInstances();
    const promises = instances.map(function(inst) {
      return close(inst.id).catch(function() {});
    });
    await Promise.all(promises);
  }

  // ── Close by group ─────────────────────────────────────────────────────────

  function closeByGroup(group) {
    const inst = State.getInstancesByGroup(group);
    if (inst) close(inst.id);
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  function update(id, newOpts) {
    const instance = State.getInstance(id);
    if (!instance || instance.state !== 'open') return;

    // Merge new options
    const preset = Utils.getPreset(instance.options.type);
    instance.options = Utils.mergeOptions(
      Object.assign({}, instance.options, newOpts),
      preset
    );

    // Re-render title
    if (instance.headerEl && newOpts.title !== undefined) {
      const titleEl = instance.headerEl.querySelector('.fp-title');
      if (titleEl) titleEl.textContent = newOpts.title;
    }

    // Re-render body
    if (newOpts.body !== undefined) {
      _injectContent(instance.bodyEl, newOpts.body, instance._shadowDom);
    }

    // Re-render footer
    if (instance.footerEl && newOpts.footer !== undefined) {
      instance.footerEl.innerHTML = newOpts.footer;
    }

    State._emit('updated', { id, options: newOpts });
  }

  // ── Set loading state ──────────────────────────────────────────────────────

  /**
   * Show or hide a loading overlay on a popup's body.
   * @param {string} id
   * @param {boolean} isLoading
   * @param {string} [label]
   */
  function setLoading(id, isLoading, label) {
    const instance = State.getInstance(id);
    if (!instance || instance.state !== 'open') return;
    Renderer.setLoadingState(instance.bodyEl, isLoading, label);
  }

  // ── Instance event subscription ────────────────────────────────────────────

  function onInstance(id, fn) {
    const instance = State.getInstance(id);
    if (!instance) return function() {};
    instance.listeners.add(fn);
    return function() { instance.listeners.delete(fn); };
  }

  function onceInstance(id, fn) {
    const instance = State.getInstance(id);
    if (!instance) return function() {};
    var wrapper = function(data) {
      instance.listeners.delete(wrapper);
      fn(data);
    };
    instance.listeners.add(wrapper);
    return function() { instance.listeners.delete(wrapper); };
  }

  // ── Register preset ────────────────────────────────────────────────────────

  /**
   * Register a custom preset that any system can use via PopupSystem.open({ type: 'myPreset' }).
   * @param {string} name - Unique preset name (e.g. 'language-selector', 'update-dialog')
   * @param {PresetConfig} config - Full preset configuration (same shape as built-in presets)
   * @returns {boolean} true if registered successfully
   */
  function registerPreset(name, config) {
    return State.registerCustomPreset(name, config);
  }

  // ── Container (universal shell API) ────────────────────────────────────────

  /**
   * Open a popup as a pure container — the system controls size, position,
   * animation, theme, and accessibility. The calling system controls ALL content.
   *
   * This is the recommended API for other systems (language, update, etc.)
   * to show popups without worrying about popup mechanics.
   *
   * @param {ContainerOptions} opts
   * @returns {Promise<PopupHandle>}
   *
   * @example
   * // Language system opens a selector popup:
   * const handle = await PopupSystem.container({
   *   title: 'Select Language',
   *   content: buildLanguageSelectorHTML(),
   *   size: 'sm',
   *   group: 'lang-selector',
   *   onBodyEvent: (name, detail, handle) => {
   *     if (name === 'lang:selected') handle.close({ data: detail.lang });
   *   },
   * });
   *
   * @example
   * // Update system shows a loading then content:
   * const handle = await PopupSystem.container({
   *   title: 'Checking for updates...',
   *   content: fetchUpdateInfo().then(data => buildUpdateHTML(data)),
   *   size: 'md',
   *   blocking: true,
   *   onContentReady: (bodyEl, handle) => {
   *     // Attach event listeners after content loads
   *     bodyEl.querySelector('.install-btn').addEventListener('click', () => {
   *       handle.setLoading(true, 'Installing...');
   *     });
   *   },
   * });
   */
  function container(opts = {}) {
    // Map container options to full PopupOptions
    var openOpts = {
      type    : 'dialog',
      title   : opts.title !== undefined ? opts.title : null,
      body    : opts.content !== undefined ? opts.content : '',
      footer  : opts.footer,
      size    : opts.size || 'md',
      position: opts.position || 'center',
      theme   : opts.theme || 'light',
      blocking: opts.blocking !== undefined ? opts.blocking : true,
      closable: opts.closable !== undefined ? opts.closable : true,
      lockScroll: opts.lockScroll !== undefined ? opts.lockScroll : true,
      group   : opts.group,
      zIndex  : opts.zIndex,
      variant : opts.variant,
      glassmorphism: opts.glassmorphism,
      borderless: opts.borderless,
      anchor  : opts.anchor,
      placement: opts.placement,
      onMount : opts.onMount,
      onContentReady: opts.onContentReady,
      onBodyEvent: opts.onBodyEvent,
      onClose : opts.onClose,
      onBeforeClose: opts.onBeforeClose,
      triggerEl: opts.triggerEl,
      shadowDom: opts.shadowDom,
      loadingLabel: opts.loadingLabel,
      id      : opts.id,
    };
    return open(openOpts);
  }

  // ── Attach interactions ────────────────────────────────────────────────────

  function _attachInteractions(instance, dom) {
    const id = instance.id;
    const opts = instance.options;

    // Close button
    if (dom.closeBtn) {
      var closeBtnHandler = function(e) {
        e.preventDefault();
        e.stopPropagation();
        close(id, { action: 'close-button' });
      };
      closeBtnHandler._instanceId = id;
      OverlayService.on(dom.closeBtn, 'click', closeBtnHandler);
    }

    // Overlay click
    if (dom.overlayEl && opts.dismissOnOverlay) {
      OverlayService.attachOverlayClick(id, dom.overlayEl, function() {
        close(id, { action: 'overlay-click' });
      });
    }

    // Escape key
    if (opts.dismissOnEscape) {
      OverlayService.attachEscapeKey(id, function() {
        close(id, { action: 'escape' });
      });
    }

    // Click outside (for overlay-less popups)
    if (!dom.overlayEl && opts.closable) {
      OverlayService.attachClickOutside(id, dom.rootEl, function() {
        close(id, { action: 'click-outside' });
      });
    }

    // Resize repositioning for anchored popups
    if (opts.anchor) {
      OverlayService.attachResize(id, dom.rootEl, opts, function() {
        // Re-apply anchor positioning
        var anchorEl = document.querySelector(opts.anchor);
        if (!anchorEl) return;
        var rect = anchorEl.getBoundingClientRect();
        var gap = 8;
        var top, left;
        switch (opts.placement || 'bottom') {
          case 'top':
            top = rect.top - gap; left = rect.left + (rect.width / 2);
            dom.rootEl.style.transform = 'translate(-50%, -100%)';
            break;
          case 'bottom':
            top = rect.bottom + gap; left = rect.left + (rect.width / 2);
            dom.rootEl.style.transform = 'translate(-50%, 0)';
            break;
          case 'left':
            top = rect.top + (rect.height / 2); left = rect.left - gap;
            dom.rootEl.style.transform = 'translate(-100%, -50%)';
            break;
          case 'right':
            top = rect.top + (rect.height / 2); left = rect.right + gap;
            dom.rootEl.style.transform = 'translate(0, -50%)';
            break;
          default:
            top = rect.bottom + gap; left = rect.left + (rect.width / 2);
            dom.rootEl.style.transform = 'translate(-50%, 0)';
        }
        dom.rootEl.style.top = top + 'px';
        dom.rootEl.style.left = left + 'px';
      });
    }
  }

  // ── Create public handle ───────────────────────────────────────────────────

  function _createHandle(instance) {
    var id = instance.id;

    return {
      id         : id,
      options    : instance.options,
      element    : instance.rootEl,
      bodyElement: instance.bodyEl,

      close: function(result) {
        return close(id, result);
      },

      update: function(newOpts) {
        update(id, newOpts);
      },

      setContent: function(content) {
        update(id, { body: content });
      },

      setFooter: function(html) {
        update(id, { footer: html });
      },

      setTitle: function(title) {
        update(id, { title: title });
      },

      /**
       * Show or hide loading overlay on this popup.
       * @param {boolean} isLoading
       * @param {string} [label] - Optional text below spinner
       */
      setLoading: function(isLoading, label) {
        setLoading(id, isLoading, label);
      },

      /**
       * Emit an event from this popup instance.
       * Listeners via handle.on() and system events will receive it.
       * @param {string} eventName
       * @param {*} [detail]
       */
      emit: function(eventName, detail) {
        var inst = State.getInstance(id);
        if (!inst) return;
        var payload = { type: eventName, detail: detail, id: id };
        for (const fn of inst.listeners) {
          try { fn(payload); } catch (_) {}
        }
        State._emit('instance:' + eventName, payload);
      },

      getState: function() {
        var inst = State.getInstance(id);
        return inst ? inst.state : 'closed';
      },

      /**
       * Subscribe to instance events.
       * @param {string} event
       * @param {Function} fn
       * @returns {Function} Unsubscribe
       */
      on: function(event, fn) {
        return onInstance(id, function(payload) {
          if (!event || payload.type === event) fn(payload);
        });
      },

      /**
       * Subscribe to an instance event once, then auto-unsubscribe.
       * @param {string} event
       * @param {Function} fn
       * @returns {Function} Unsubscribe
       */
      once: function(event, fn) {
        return onceInstance(id, function(payload) {
          if (!event || payload.type === event) fn(payload);
        });
      },

      destroy: function() {
        destroy(id);
      },
    };
  }

  // ── Quick-open helpers (convenience methods) ────────────────────────────────

  /**
   * Show an alert dialog with a single "OK" button.
   * @param {string} message
   * @param {Object} [opts]
   * @returns {Promise<void>}
   */
  async function alert(message, opts = {}) {
    var lang = opts.lang ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('selectedLang')) || 'en';
    var okLabel = lang === 'th' ? 'ตกลง' : 'OK';

    var footerHtml = '<button class="fp-btn fp-btn-primary" data-fp-action="confirm">' +
      okLabel + '</button>';

    return new Promise(function(resolve) {
      open(Object.assign({}, opts, {
        type    : 'alert',
        title   : opts.title || '',
        body    : '<div class="fp-alert-body">' + message + '</div>',
        footer  : footerHtml,
        onClose : function(id, result) { resolve(result); },
        onMount : function(bodyEl, handle) {
          // Listen for confirm button click
          var btn = bodyEl.closest('[data-fp-root]').querySelector('[data-fp-action="confirm"]');
          if (btn) {
            btn.addEventListener('click', function() {
              handle.close({ action: 'confirm' });
            });
          }
        },
      }));
    });
  }

  /**
   * Show a confirm dialog with OK and Cancel buttons.
   * @param {string} message
   * @param {Object} [opts]
   * @returns {Promise<boolean>} true if confirmed, false if cancelled
   */
  async function confirm(message, opts = {}) {
    var lang = opts.lang ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('selectedLang')) || 'en';
    var okLabel = lang === 'th' ? 'ตกลง' : 'OK';
    var cancelLabel = lang === 'th' ? 'ยกเลิก' : 'Cancel';

    var footerHtml =
      '<button class="fp-btn fp-btn-secondary" data-fp-action="cancel">' + cancelLabel + '</button>' +
      '<button class="fp-btn fp-btn-primary" data-fp-action="confirm">' + okLabel + '</button>';

    return new Promise(function(resolve) {
      open(Object.assign({}, opts, {
        type    : 'confirm',
        title   : opts.title || '',
        body    : '<div class="fp-confirm-body">' + message + '</div>',
        footer  : footerHtml,
        onClose : function(id, result) { resolve(result.action === 'confirm'); },
        onMount : function(bodyEl, handle) {
          var root = bodyEl.closest('[data-fp-root]');
          var confirmBtn = root.querySelector('[data-fp-action="confirm"]');
          var cancelBtn = root.querySelector('[data-fp-action="cancel"]');
          if (confirmBtn) confirmBtn.addEventListener('click', function() {
            handle.close({ action: 'confirm' });
          });
          if (cancelBtn) cancelBtn.addEventListener('click', function() {
            handle.close({ action: 'cancel' });
          });
        },
      }));
    });
  }

  /**
   * Show a toast notification.
   * @param {string|HTMLElement} content
   * @param {Object} [opts]
   * @returns {Promise<PopupHandle>}
   */
  function toast(content, opts = {}) {
    return open(Object.assign({
      type     : 'toast',
      body     : content,
      position : opts.position || 'bottom',
      timeout  : opts.timeout || CONFIG.TIMING.TOAST_DISPLAY,
    }, opts));
  }

  // ── Stats / Debug ──────────────────────────────────────────────────────────

  function stats() {
    return {
      active  : State.getActiveCount(),
      queued  : QueueManager.status().queued,
      stack   : State.getStackHeight(),
      scrollLock: State.getScrollLockCount() > 0,
      customPresets: State.getAllCustomPresetNames(),
      instances: State.getAllInstances().map(function(inst) {
        return {
          id    : inst.id,
          type  : inst.options.type,
          state : inst.state,
          z     : inst.zIndex,
          age   : Date.now() - inst.openAt,
        };
      }),
    };
  }

  function debug() {
    var s = stats();
    console.table(s.instances);
    console.log('[PopupSystem] active:', s.active, 'queued:', s.queued, 'scrollLock:', s.scrollLock,
      'customPresets:', s.customPresets.join(', ') || '(none)');
    return s;
  }

  // ── System events ──────────────────────────────────────────────────────────

  function onSystem(event, fn) {
    return State.on(event, fn);
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  M.Engine = Object.freeze({
    open, close, destroy, closeAll, closeByGroup, update, onInstance,
    alert, confirm, toast,
    registerPreset, container, setLoading,
    stats, debug, onSystem,
  });

})(window.PopupModules = window.PopupModules || {});