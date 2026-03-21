// @ts-check
/**
 * @file utils.js
 * Pure utility services — stateless helpers with no side-effects on import.
 *
 * Exports (via M.Utils and M.ErrorManager):
 *   showNotification(msg, type, opts)
 *   ErrorManager  — dedup error toasts
 *   debounce(fn, wait)
 *   throttle(fn, limit)
 *   debounceWithMaxWait(fn, wait, maxWait)
 *   batchDOMReads(tasks)
 *   isOnline()
 *
 * CSS for .notification comes from /assets/css/loading.css — NOT injected here.
 *
 * @module utils
 * @depends {config.js, state.js}
 */
(function (M) {
  'use strict';

  // ── showNotification ──────────────────────────────────────────────────────────

  /**
   * Show a toast notification.
   * Slide-out CSS animation class (.notification-slideout) lives in loading.css.
   *
   * @param {string} message
   * @param {'info'|'success'|'error'|'warning'|'loading'} [type='info']
   * @param {{duration?:number, position?:string, dismissible?:boolean}} [options]
   * @returns {HTMLElement|undefined}
   */
  function showNotification(message, type = 'info', options = {}) {
    const lang = localStorage.getItem('selectedLang') || 'en';
    const labels = {
      th: { success: '✨ สำเร็จ!', error: '❌ ข้อผิดพลาด', warning: '⚠️ คำเตือน', info: 'ℹ️ ข้อมูล', loading: '⌛ กำลังโหลด' },
      en: { success: '✨ Success!', error: '❌ Error',       warning: '⚠️ Warning', info: 'ℹ️ Information', loading: '⌛ Loading' },
    };

    try {
      const el = document.createElement('div');
      el.className = `notification notification-${type}`;
      el.setAttribute('data-timestamp', String(Date.now()));

      const icon = document.createElement('div');
      icon.className = 'notification-icon';
      icon.innerHTML = type === 'success' ? '✓' : type === 'error' ? '✕'
        : type === 'warning' ? '⚠' : type === 'loading' ? '⌛' : 'ℹ';

      const msgWrap = document.createElement('div');
      msgWrap.className = 'notification-message-container';
      msgWrap.innerHTML =
        `<div class="notification-title">${(labels[lang] || labels.en)[type] || type}</div>` +
        `<div class="notification-content">${message}</div>`;

      if (options.dismissible !== false) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'notification-close';
        closeBtn.innerHTML = '×';
        closeBtn.onclick = () => {
          el.classList.add('notification-slideout');
          setTimeout(() => el.remove(), 300);
        };
        el.appendChild(closeBtn);
      }

      el.appendChild(icon);
      el.appendChild(msgWrap);
      document.body.appendChild(el);

      if (type !== 'loading' && options.duration !== Infinity) {
        setTimeout(() => {
          el.classList.add('notification-slideout');
          setTimeout(() => { try { el.remove(); } catch (_) {} }, 300);
        }, options.duration || 3000);
      }

      return el;
    } catch (err) {
      console.error('[NavCore/Utils] showNotification error:', err);
    }
  }

  // ── ErrorManager ─────────────────────────────────────────────────────────────

  /**
   * Deduplicates error toasts to prevent notification floods.
   */
  class ErrorManager {
    constructor() {
      /** @type {Map<string,{message:string,timestamp:number,type:string}>} */
      this.errorStates = new Map();
      /** @type {Map<string,number>} */
      this.timeouts = new Map();
    }

    /** @param {any} error @returns {boolean} */
    isValidError(error) {
      return !!(error && (error instanceof Error || error.message || typeof error === 'string'));
    }

    /**
     * @param {string} key
     * @param {string} message
     * @returns {boolean}
     */
    isDuplicateError(key, message) {
      const existing = this.errorStates.get(key);
      return !!(existing && existing.message === message);
    }

    /**
     * Show a deduplicated error notification.
     * @param {string} errorKey
     * @param {any}    error
     * @param {{type?:string, duration?:number, position?:string, dismissible?:boolean}} [opts]
     */
    showError(errorKey, error, opts = {}) {
      if (!this.isValidError(error)) return;
      const message = error.message || String(error);
      if (this.isDuplicateError(errorKey, message)) return;

      if (this.timeouts.has(errorKey)) clearTimeout(this.timeouts.get(errorKey));

      this.errorStates.set(errorKey, {
        message,
        timestamp: Date.now(),
        type: opts.type || 'error',
      });

      showNotification(message, /** @type {any} */ (opts.type || 'error'), {
        duration:    opts.duration    || 3000,
        position:    opts.position    || 'top',
        dismissible: opts.dismissible !== false,
      });

      const timeout = setTimeout(() => {
        this.errorStates.delete(errorKey);
        this.timeouts.delete(errorKey);
      }, opts.duration || 3000);

      this.timeouts.set(errorKey, timeout);
    }

    clearErrors() {
      this.errorStates.clear();
      this.timeouts.forEach(clearTimeout);
      this.timeouts.clear();
    }
  }

  // ── Function utilities ────────────────────────────────────────────────────────

  /**
   * Standard debounce.
   * @param {Function} fn
   * @param {number}   [wait=250]
   * @returns {Function}
   */
  function debounce(fn, wait = 250) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /**
   * Standard throttle.
   * @param {Function} fn
   * @param {number}   [limit=100]
   * @returns {Function}
   */
  function throttle(fn, limit = 100) {
    let inThrottle;
    return (...args) => {
      if (!inThrottle) {
        fn.apply(this, args);
        inThrottle = true;
        setTimeout(() => { inThrottle = false; }, limit);
      }
    };
  }

  /**
   * Debounce with a maximum wait (ensures fn fires at least every maxWait ms).
   * @param {Function} fn
   * @param {number}   [wait=250]
   * @param {number}   [maxWait=1000]
   * @returns {Function}
   */
  function debounceWithMaxWait(fn, wait = 250, maxWait = 1000) {
    let timer, maxTimer, lastCallTime = 0;
    return (...args) => {
      const now = Date.now();
      clearTimeout(timer);
      if (maxTimer) clearTimeout(maxTimer);
      const remaining = now - lastCallTime;
      timer = setTimeout(() => { fn.apply(this, args); lastCallTime = Date.now(); }, wait);
      if (remaining >= maxWait) {
        fn.apply(this, args);
        lastCallTime = Date.now();
      } else {
        maxTimer = setTimeout(() => { fn.apply(this, args); lastCallTime = Date.now(); }, maxWait - remaining);
      }
    };
  }

  /**
   * Batch DOM reads to avoid layout thrashing.
   * @param {{read: Function, write?: Function}[]} tasks
   */
  function batchDOMReads(tasks) {
    return requestAnimationFrame(() => {
      const results = tasks.map(t => t.read());
      requestAnimationFrame(() => {
        for (let i = 0; i < tasks.length; i++) {
          if (tasks[i].write) tasks[i].write(results[i]);
        }
      });
    });
  }

  /** @returns {boolean} */
  function isOnline() {
    return navigator.onLine;
  }

  // ── Export ────────────────────────────────────────────────────────────────────

  /** Utils namespace — mirrors original _headerV2_utils public API */
  const Utils = {
    showNotification,
    debounce,
    throttle,
    debounceWithMaxWait,
    batchDOMReads,
    isOnline,
    errorManager: new ErrorManager(),
  };

  M.Utils        = Utils;
  M.ErrorManager = ErrorManager;

  // Public function alias used by unifiedCopyToClipboard and external scripts
  M.showNotification = showNotification;

})(window.NavCoreModules = window.NavCoreModules || {});