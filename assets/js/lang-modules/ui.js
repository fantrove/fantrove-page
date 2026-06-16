// @ts-check
/**
 * @file ui.js
 * UIService — จัดการ UI ของ language selector
 *
 * ├── prepareAllButtonTexts()      — สร้าง/อัพเดท button text spans
 * ├── showButtonTextForLang()      — แสดง text สำหรับภาษาที่เลือก
 * ├── updateLanguageSelectorUI()   — trigger re-init dropdown
 * ├── openLanguagePopup()           — เปิด popup เลือกภาษา via PopupSystem
 * ├── closeLanguagePopup()          — ปิด popup เลือกภาษา
 * └── showError()                  — แสดง toast error
 *
 * v6.0: ใช้ PopupSystem.open() แทนการสร้าง overlay/dropdown เอง
 *       ลบ initializeCustomLanguageSelector, populateLanguageDropdown,
 *       setupEventListeners, setupDropdownScrollLock,
 *       openLanguageDropdown, closeLanguageDropdown, toggleLanguageDropdown
 *
 * @module ui
 * @depends {config.js, state.js}
 */
(function(M) {
  'use strict';

  // SVG icon ของ language button
  const LANG_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18.5" height="18.5" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h7"/><path d="M9 3v2c0 4.418 -2.239 8 -5 8"/><path d="M5 9c0 2.144 2.952 3.908 6.7 4"/><path d="M12 20l4 -9l4 9"/><path d="M19.1 18h-6.2"/></svg>';

  // สไตล์ inline สำหรับ option ภายใน popup body
  var _stylesInjected = false;
  function _injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    var css = '.fv-lang-option{box-sizing:border-box;display:block;width:100%;padding:var(--fv-space-4) var(--fv-space-6);margin-bottom:var(--fv-space-2);border-radius:var(--fv-radius-md);font-size:0.95em;font-weight:var(--fv-font-medium);color:var(--fv-text-primary);background-color:transparent;transition:all var(--fv-transition-fast);cursor:pointer;border:1px solid rgba(255,255,255,0);text-align:left;-webkit-tap-highlight-color:transparent;user-select:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.fv-lang-option:hover{border-color:#00FFAA;background-color:rgba(0,255,170,0.03)}.fp-theme-dark .fv-lang-option{color:var(--fv-text-primary,#f5f5f7)}.fp-theme-dark .fv-lang-option:hover{border-color:#00FFAA;background-color:rgba(0,255,170,0.06)}';
    var s = document.createElement('style');
    s.id = 'fv-lang-picker-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  var _popupId = null;
  var _popupHandle = null;

  var UIService = {

    // ── Button text ───────────────────────────────────────────────────────────

    /**
     * สร้าง/อัพเดท flex wrapper + icon + text spans ใน #language-button
     * เรียกตอน init และตอนเปลี่ยนภาษา
     */
    async prepareAllButtonTexts() {
      const { State } = M;
      State.languageButton = document.getElementById('language-button');
      if (!State.languageButton || !State.languagesConfig) return;

      // ล้าง elements เก่า
      Array.from(State.languageButton.querySelectorAll('.lang-btn-txt, .lang-btn-svg'))
        .forEach(e => e.remove());

      // สร้าง flex wrapper (ถ้ายังไม่มี)
      let flexWrap = State.languageButton.querySelector('.lang-btn-flex');
      if (!flexWrap) {
        flexWrap = document.createElement('span');
        flexWrap.className = 'lang-btn-flex';
        flexWrap.style.cssText = 'display:inline-flex;align-items:center;gap:15px;vertical-align:middle;';
        State.languageButton.innerHTML = '';
        State.languageButton.appendChild(flexWrap);
      } else {
        flexWrap.innerHTML = '';
      }

      // SVG icon
      const svgWrap = document.createElement('span');
      svgWrap.className = 'lang-btn-svg';
      svgWrap.innerHTML = LANG_ICON_SVG;
      svgWrap.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;';
      flexWrap.appendChild(svgWrap);

      // Text span สำหรับแต่ละภาษา (hidden ทั้งหมด แล้วค่อย show เฉพาะที่ active)
      Object.entries(State.languagesConfig).forEach(([lang, config]) => {
        const span = document.createElement('span');
        span.className = 'lang-btn-txt';
        span.dataset.lang = lang;
        span.textContent = config.buttonText || 'Language';
        span.style.display = 'none';
        span.style.lineHeight = '1';
        flexWrap.appendChild(span);
      });

      this.showButtonTextForLang(State.selectedLang || 'en');
    },

    /**
     * แสดง text ของภาษาที่ active อยู่ ซ่อนอันอื่น
     * @param {string} lang
     */
    showButtonTextForLang(lang) {
      const { State } = M;
      State.languageButton = document.getElementById('language-button');
      if (!State.languageButton) return;

      const flexWrap = State.languageButton.querySelector('.lang-btn-flex');
      if (!flexWrap) return;

      Array.from(flexWrap.querySelectorAll('.lang-btn-txt')).forEach(span => {
        span.style.display = (span.dataset.lang === lang) ? '' : 'none';
      });
    },

    // ── Language popup (via PopupSystem) ──────────────────────────────────────

    /** Trigger re-init (เรียกหลัง init หรือเปลี่ยนภาษา) */
    updateLanguageSelectorUI() {
      this.prepareAllButtonTexts();
      this.showButtonTextForLang(M.State.selectedLang || 'en');
      this._attachButtonHandler();
    },

    /**
     * ผูก click handler ให้ #language-button → เปิด popup
     * Idempotent — ใช้ flag เพื่อไม่ bind ซ้ำ
     */
    _attachButtonHandler() {
      var btn = document.getElementById('language-button');
      if (!btn || btn._fvLangPopupBound) return;
      btn._fvLangPopupBound = true;
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        M.UIService.openLanguagePopup();
      });
    },

    /**
     * เปิด popup เลือกภาษาผ่าน PopupSystem.open()
     * สร้าง HTML ของ options และผูก event handlers ใน onMount
     */
    openLanguagePopup() {
      var self = this;
      var { State } = M;

      // ปิด popup เดิมถ้ามี
      if (_popupHandle) {
        _popupHandle.close().catch(function() {});
        return;
      }

      // รอ PopupSystem พร้อม
      if (typeof window.PopupSystem === 'undefined' || !window.PopupSystem._initialized) {
        window.addEventListener('fp:ready', function() { self.openLanguagePopup(); }, { once: true });
        return;
      }

      _injectStyles();

      // สร้าง HTML สำหรับ options
      var optionsHTML = '';
      var lang = State.selectedLang || 'en';
      Object.entries(State.languagesConfig).forEach(function(entry) {
        var l = entry[0];
        var config = entry[1];
        var isActive = (l === lang) ? ' style="border-color:#00FFAA;background-color:rgba(0,255,170,0.06);"' : '';
        optionsHTML += '<div class="fv-lang-option" data-language="' + l + '"' + isActive + '>' +
          (config.label || l) + '</div>';
      });

      _popupId = 'fv-lang-picker';
      PopupSystem.open({
        id: _popupId,
        type: 'dialog',
        title: null,
        body: optionsHTML,
        size: 'sm',
        position: 'center',
        blocking: true,
        closable: true,
        dismissOnOverlay: true,
        dismissOnEscape: true,
        triggerEl: State.languageButton,
        group: 'language-picker',
        theme: 'light',
        onMount: function(bodyEl, handle) {
          _popupHandle = handle;
          bodyEl.addEventListener('click', function(e) {
            var option = e.target.closest('.fv-lang-option');
            if (option && option.dataset.language) {
              M.LanguageManager.selectLanguage(option.dataset.language);
            }
          });
        },
        onClose: function() {
          _popupHandle = null;
          _popupId = null;
        }
      });
    },

    /**
     * ปิด popup ภาษา (เรียกจาก LanguageManager.selectLanguage)
     * PopupSystem จัดการ scroll unlock, focus return, animation เอง
     */
    async closeLanguagePopup() {
      if (_popupHandle) {
        try { await _popupHandle.close(); } catch (e) {}
      }
      _popupHandle = null;
      _popupId = null;
    },

    // ── Error toast ───────────────────────────────────────────────────────────

    /**
     * แสดง error toast ผ่าน PopupSystem.toast() (fallback เป็น inline ถ้า PopupSystem ยังไม่พร้อม)
     * @param {string} message
     */
    showError(message) {
      if (typeof window.PopupSystem !== 'undefined' && window.PopupSystem._initialized) {
        PopupSystem.toast(message);
        return;
      }
      // Fallback: inline error div
      var errorDiv = document.createElement('div');
      errorDiv.className = 'language-error';
      errorDiv.textContent = message;
      errorDiv.style.cssText =
        'position:fixed;top:20px;right:20px;background:#ff4444;color:white;' +
        'padding:10px 20px;border-radius:4px;z-index:9999;opacity:0;transition:opacity 0.3s;';
      document.body.appendChild(errorDiv);

      requestAnimationFrame(function() {
        errorDiv.style.opacity = '1';
        setTimeout(function() {
          errorDiv.style.opacity = '0';
          setTimeout(function() { errorDiv.remove(); }, 300);
        }, 3000);
      });
    },
  };

  M.UIService = UIService;

})(window.LangModules = window.LangModules || {});