// @ts-check
/**
 * @file utils.js
 * Pure utility services — stateless helpers with no side-effects on import.
 *
 * Exports (via M.Utils and M.ErrorManager):
 *   showNotification(msg, type, opts)
 *   showErrorFullscreen(error, opts)  — fullscreen error detail page via PopupSystem
 *   ErrorManager  — dedup error toasts
 *   debounce(fn, wait)
 *   throttle(fn, limit)
 *   debounceWithMaxWait(fn, wait, maxWait)
 *   batchDOMReads(tasks)
 *   isOnline()
 *
 * CSS for .notification comes from /assets/css/loading.css — NOT injected here.
 * CSS for .fp-error-detail injected once by _injectErrorDetailCSS().
 *
 * @module utils
 * @depends {config.js, state.js}
 */
(function (M) {
  'use strict';

  // ── Error detail CSS (injected once) ──────────────────────────────────────────

  function _injectErrorDetailCSS() {
    if (document.getElementById('_nc_error_detail_css')) return;
    const s = document.createElement('style');
    s.id = '_nc_error_detail_css';
    s.textContent = `
.fp-error-detail{display:flex;flex-direction:column;height:100%;padding:0;margin:0;}
.fp-error-detail__icon{display:flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:50%;background:var(--fv-error-bg,rgba(239,68,68,0.1));margin:32px auto 16px;flex-shrink:0;}
.fp-error-detail__icon svg{width:32px;height:32px;color:var(--fv-error-fg,#ef4444);}
.fp-error-detail__title{text-align:center;font-size:var(--fv-text-lg,18px);font-weight:var(--fv-font-semibold,600);color:var(--fv-text-heading);margin-bottom:8px;padding:0 24px;}
.fp-error-detail__subtitle{text-align:center;font-size:var(--fv-text-sm,14px);color:var(--fv-text-secondary);margin-bottom:24px;padding:0 24px;}
.fp-error-detail__divider{height:1px;background:var(--fp-divider,rgba(0,0,0,0.06));margin:0 24px 16px;flex-shrink:0;}
.fp-error-detail__section-label{font-size:var(--fv-text-xs,12px);font-weight:var(--fv-font-semibold,600);color:var(--fv-text-muted);text-transform:uppercase;letter-spacing:0.05em;padding:0 24px;margin-bottom:8px;}
.fp-error-detail__body{flex:1;min-height:0;overflow-y:auto;padding:0 24px 24px;-webkit-overflow-scrolling:touch;}
.fp-error-detail__pre{background:var(--fv-surface-elevated,rgba(0,0,0,0.04));border:1px solid var(--fp-divider,rgba(0,0,0,0.06));border-radius:12px;padding:16px;font-family:'SF Mono',SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace;font-size:13px;line-height:1.6;color:var(--fv-text-primary);white-space:pre-wrap;word-break:break-all;overflow-wrap:break-word;margin:0;}
.fp-error-detail__copy-bar{display:flex;align-items:center;justify-content:space-between;padding:12px 24px;border-top:1px solid var(--fp-divider,rgba(0,0,0,0.06));background:var(--fv-surface-page,#fff);flex-shrink:0;}
.fp-error-detail__copy-hint{font-size:var(--fv-text-xs,12px);color:var(--fv-text-muted);}
.fp-error-detail__copy-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border:1px solid var(--fp-divider,rgba(0,0,0,0.06));border-radius:10px;background:var(--fv-surface-elevated,rgba(0,0,0,0.04));color:var(--fv-text-secondary);font-size:var(--fv-text-sm,14px);font-weight:var(--fv-font-medium,500);cursor:pointer;transition:all 0.15s ease;-webkit-appearance:none;appearance:none;}
.fp-error-detail__copy-btn:hover{background:var(--fp-close-hover-bg,rgba(0,0,0,0.08));color:var(--fv-text-primary);}
.fp-error-detail__copy-btn:active{transform:scale(0.96);}
.fp-error-detail__copy-btn svg{width:16px;height:16px;pointer-events:none;}
.fp-error-detail__copy-btn--copied{color:var(--fv-brand-teal,#13b47f);border-color:var(--fv-brand-teal,#13b47f);}`;
    document.head.appendChild(s);
  }

  // ── showErrorFullscreen ──────────────────────────────────────────────────────

  /**
   * Build a plain-text error report for copying.
   * @param {any} error
   * @param {Object} [opts]
   * @returns {string}
   */
  function _buildErrorReport(error, opts) {
    const now = new Date().toISOString();
    const ua  = navigator.userAgent || '';
    const url = location.href || '';
    const lines = [
      '=== Fantrove Error Report ===',
      'Time    : ' + now,
      'URL     : ' + url,
      'UA      : ' + ua,
    ];
    if (opts && opts.label) lines.push('Context : ' + opts.label);
    lines.push('', '--- Error ---');
    if (error instanceof Error) {
      lines.push('Name    : ' + (error.name || 'Error'));
      lines.push('Message : ' + (error.message || '(no message)'));
      if (error.stack)  lines.push('', 'Stack:', error.stack);
    } else if (typeof error === 'string') {
      lines.push('Message : ' + error);
    } else {
      try { lines.push('Detail  : ' + JSON.stringify(error, null, 2)); }
      catch (_) { lines.push('Detail  : ' + String(error)); }
    }
    return lines.join('\n');
  }

  /**
   * Build HTML body for the fullscreen error popup.
   * @param {any} error
   * @param {Object} [opts]
   * @returns {string}
   */
  function _buildErrorDetailHTML(error, opts) {
    const lang = localStorage.getItem('selectedLang') || 'en';
    const labels = {
      th: { title: 'เกิดข้อผิดพลาด', subtitle: 'ระบบพบปัญหาที่ไม่คาดคิด รายละเอียดด้านล่าง', section: 'รายละเอียดข้อผิดพลาด', copy: 'คัดลอกรายงาน', copied: 'คัดลอกแล้ว!', hint: 'ส่งรายงานนี้ให้นักพัฒนาเพื่อช่วยแก้ไขปัญหา' },
      en: { title: 'Something went wrong', subtitle: 'An unexpected error occurred. Details below.', section: 'Error Details', copy: 'Copy Report', copied: 'Copied!', hint: 'Send this report to the developer to help fix the issue' },
    };
    const t = labels[lang] || labels.en;

    let errorText = '';
    if (error instanceof Error) {
      errorText = (error.name && error.name !== 'Error' ? error.name + ': ' : '') + (error.message || '(no message)');
      if (error.stack) errorText += '\n\n' + error.stack;
    } else if (typeof error === 'string') {
      errorText = error;
    } else {
      try { errorText = JSON.stringify(error, null, 2); }
      catch (_) { errorText = String(error); }
    }

    // Escape for safe HTML attribute
    const escapedForAttr = errorText.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return '<div class="fp-error-detail">' +
      '<div class="fp-error-detail__icon">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<circle cx="12" cy="12" r="10"></circle>' +
          '<line x1="15" y1="9" x2="9" y2="15"></line>' +
          '<line x1="9" y1="9" x2="15" y2="15"></line>' +
        '</svg>' +
      '</div>' +
      '<div class="fp-error-detail__title">' + t.title + '</div>' +
      '<div class="fp-error-detail__subtitle">' + t.subtitle + '</div>' +
      '<div class="fp-error-detail__divider"></div>' +
      '<div class="fp-error-detail__section-label">' + t.section + '</div>' +
      '<div class="fp-error-detail__body">' +
        '<pre class="fp-error-detail__pre">' + errorText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</pre>' +
      '</div>' +
      '<div class="fp-error-detail__copy-bar">' +
        '<span class="fp-error-detail__copy-hint">' + t.hint + '</span>' +
        '<button class="fp-error-detail__copy-btn" id="_nc_err_copy_btn" data-error-report="' + escapedForAttr + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>' +
            '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>' +
          '</svg>' +
          '<span id="_nc_err_copy_label">' + t.copy + '</span>' +
        '</button>' +
      '</div>' +
    '</div>';
  }

  /**
   * Show a fullscreen error detail page using PopupSystem.fullscreen().
   * Displays full error info (message, stack, context) with a copy button.
   * Falls back to showNotification() if PopupSystem is not available.
   *
   * @param {any} error — Error object, string, or any value
   * @param {{label?:string, title?:string}} [opts]
   */
  function showErrorFullscreen(error, opts = {}) {
    _injectErrorDetailCSS();

    var errorObj = error;
    if (error instanceof Event) {
      errorObj = error.error || error.reason || error.message || error;
    }

    var shortMsg = '';
    if (errorObj instanceof Error) {
      shortMsg = errorObj.message || errorObj.name || 'Unknown error';
    } else if (typeof errorObj === 'string') {
      shortMsg = errorObj;
    } else {
      try { shortMsg = JSON.stringify(errorObj); } catch (_) { shortMsg = String(errorObj); }
    }

    // If PopupSystem.fullscreen is available, use it
    if (window.PopupSystem && typeof window.PopupSystem.fullscreen === 'function') {
      var report = _buildErrorReport(errorObj, opts);
      var html   = _buildErrorDetailHTML(errorObj, opts);
      var fsTitle = opts.title || (shortMsg.length > 60 ? shortMsg.substring(0, 57) + '...' : shortMsg);

      window.PopupSystem.fullscreen({
        title      : fsTitle,
        body       : html,
        showHeader : true,
        hideOnBack : true,
        onMount    : function(bodyEl, handle) {
          var copyBtn = document.getElementById('_nc_err_copy_btn');
          if (copyBtn) {
            copyBtn.addEventListener('click', function() {
              navigator.clipboard.writeText(report).then(function() {
                var label = document.getElementById('_nc_err_copy_label');
                if (label) label.textContent = label.textContent.includes('Copied') || label.textContent.includes('คัดลอกแล้ว') ? label.textContent : (localStorage.getItem('selectedLang') === 'th' ? 'คัดลอกแล้ว!' : 'Copied!');
                copyBtn.classList.add('fp-error-detail__copy-btn--copied');
                setTimeout(function() {
                  copyBtn.classList.remove('fp-error-detail__copy-btn--copied');
                  if (label) label.textContent = localStorage.getItem('selectedLang') === 'th' ? 'คัดลอกรายงาน' : 'Copy Report';
                }, 2000);
              }).catch(function() {
                // Fallback: select text in pre
                var pre = bodyEl.querySelector('.fp-error-detail__pre');
                if (pre) { var range = document.createRange(); range.selectNodeContents(pre); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }
              });
            });
          }
        },
      }).catch(function(fsErr) {
        // Fallback if fullscreen fails
        showNotification(shortMsg, 'error', { duration: 5000 });
        console.error('[NavCore/Utils] showErrorFullscreen fallback:', fsErr);
      });
    } else {
      // PopupSystem not ready — fallback to toast
      showNotification(shortMsg, 'error', { duration: 5000 });
    }
  }

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
    showErrorFullscreen,
    debounce,
    throttle,
    debounceWithMaxWait,
    batchDOMReads,
    isOnline,
    errorManager: new ErrorManager(),
  };

  M.Utils        = Utils;
  M.ErrorManager = ErrorManager;

  // Public function aliases
  M.showNotification    = showNotification;
  M.showErrorFullscreen = showErrorFullscreen;

})(window.NavCoreModules = window.NavCoreModules || {});