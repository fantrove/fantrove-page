// @ts-check
/**
 * @file ui.js
 * UIService — จัดการ UI ของ language selector
 *
 * ├── prepareAllButtonTexts()      — สร้าง/อัพเดท button text spans
 * ├── showButtonTextForLang()      — แสดง text สำหรับภาษาที่เลือก
 * ├── updateLanguageSelectorUI()   — trigger re-init dropdown
 * ├── initializeCustomLanguageSelector() — สร้าง overlay + dropdown
 * ├── populateLanguageDropdown()   — สร้าง option items ใน dropdown
 * ├── setupEventListeners()        — attach click handlers
 * ├── setupDropdownScrollLock()    — ป้องกัน scroll ออกนอก dropdown
 * ├── toggleLanguageDropdown()     — toggle open/close
 * ├── openLanguageDropdown()       — เปิด dropdown + lock scroll
 * ├── closeLanguageDropdown()      — ปิด dropdown + unlock scroll
 * └── showError()                  — แสดง toast error
 *
 * @module ui
 * @depends {config.js, state.js}
 */
(function(M) {
  'use strict';
  
  // SVG icon ของ language button
  const LANG_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18.5" height="18.5" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h7"/><path d="M9 3v2c0 4.418 -2.239 8 -5 8"/><path d="M5 9c0 2.144 2.952 3.908 6.7 4"/><path d="M12 20l4 -9l4 9"/><path d="M19.1 18h-6.2"/></svg>';
  
  const UIService = {
    
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
    
    // ── Dropdown initialization ───────────────────────────────────────────────
    
    /** Trigger re-init dropdown (เรียกหลัง init หรือเปลี่ยนภาษา) */
    updateLanguageSelectorUI() {
      this.initializeCustomLanguageSelector();
    },
    
    /**
     * สร้าง overlay + dropdown elements และ attach handlers
     * Idempotent — cleanup elements เก่าก่อนสร้างใหม่เสมอ
     */
    initializeCustomLanguageSelector() {
      const { State } = M;
      State.languageButton = document.getElementById('language-button');
      if (!State.languageButton) return;
      
      this.prepareAllButtonTexts();
      this.showButtonTextForLang(State.selectedLang || 'en');
      
      // Cleanup elements เก่า
      if (State.languageOverlay?.parentElement)
        State.languageOverlay.parentElement.removeChild(State.languageOverlay);
      if (State.languageDropdown?.parentElement)
        State.languageDropdown.parentElement.removeChild(State.languageDropdown);
      
      // Overlay (backdrop)
      State.languageOverlay = document.createElement('div');
      State.languageOverlay.id = 'language-overlay';
      State.languageOverlay.style.cssText =
        'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;opacity:0;transition:opacity 0.3s;';
      document.body.appendChild(State.languageOverlay);
      
      // Dropdown (modal center)
      State.languageDropdown = document.createElement('div');
      State.languageDropdown.id = 'language-dropdown';
      State.languageDropdown.style.cssText =
        'display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;z-index:9999;max-height:80vh;overflow-y:auto;opacity:0;transition:opacity 0.3s;';
      document.body.appendChild(State.languageDropdown);
      
      this.populateLanguageDropdown();
      this.setupEventListeners();
      this.setupDropdownScrollLock();
    },
    
    /**
     * สร้าง option items ใน dropdown จาก languagesConfig
     */
    populateLanguageDropdown() {
      const { State } = M;
      const fragment = document.createDocumentFragment();
      
      Object.entries(State.languagesConfig).forEach(([lang, config]) => {
        const option = document.createElement('div');
        option.className = 'language-option';
        option.textContent = config.label;
        option.dataset.language = lang;
        option.style.cssText = 'padding:12px 24px;cursor:pointer;';
        fragment.appendChild(option);
      });
      
      State.languageDropdown.innerHTML = '';
      State.languageDropdown.appendChild(fragment);
    },
    
    /**
     * Attach click handlers ให้ button, overlay, dropdown
     * Click บน overlay → ปิด dropdown
     * Click บน option → selectLanguage
     */
    setupEventListeners() {
      const { State } = M;
      if (!State.languageButton) return;
      
      State.languageButton.onclick = () => this.toggleLanguageDropdown();
      State.languageOverlay.onclick = () => this.closeLanguageDropdown();
      
      State.languageDropdown.onclick = (e) => {
        const option = e.target.closest('.language-option');
        if (option && option.dataset.language) {
          // M.LanguageManager ถูก defined ใน manager.js ที่โหลดทีหลัง
          // แต่เรียกตอน event fire → available แน่นอน
          M.LanguageManager.selectLanguage(option.dataset.language);
        }
      };
    },
    
    /**
     * ป้องกัน scroll ออกนอก dropdown (เพื่อไม่ให้ page scroll ด้วย)
     */
    setupDropdownScrollLock() {
      const { State } = M;
      if (!State.languageDropdown) return;
      
      State._dropdownWheelListener = (e) => {
        const el = State.languageDropdown;
        const delta = e.deltaY;
        const atTop = el.scrollTop === 0;
        const atBot = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
        if ((atTop && delta < 0) || (atBot && delta > 0)) e.preventDefault();
        e.stopPropagation();
      };
      
      State.languageDropdown.addEventListener(
        'wheel', State._dropdownWheelListener, { passive: false }
      );
    },
    
    // ── Dropdown open/close ───────────────────────────────────────────────────
    
    /** Toggle open/close */
    toggleLanguageDropdown() {
      const { State } = M;
      State.isLanguageDropdownOpen ?
        this.closeLanguageDropdown() :
        this.openLanguageDropdown();
    },
    
    /**
     * เปิด dropdown + lock page scroll (ป้องกัน layout shift)
     */
    async openLanguageDropdown() {
      const { State } = M;
      if (State.isLanguageDropdownOpen) return;
      
      State.scrollPosition = window.scrollY || 0;
      State.isLanguageDropdownOpen = true;
      
      State.languageOverlay.style.display = 'block';
      State.languageDropdown.style.display = 'block';
      
      // ใช้ body position:fixed trick เหมือน overlay.js
      document.body.style.cssText =
        `position:fixed;left:0;right:0;overflow-y:scroll;top:-${State.scrollPosition}px;`;
      
      requestAnimationFrame(() => {
        State.languageOverlay.style.opacity = '1';
        State.languageDropdown.style.opacity = '1';
      });
    },
    
    /**
     * ปิด dropdown + unlock page scroll + restore scroll position
     */
    async closeLanguageDropdown() {
      const { CONFIG, State } = M;
      if (!State.isLanguageDropdownOpen) return;
      
      State.isLanguageDropdownOpen = false;
      
      State.languageOverlay.style.opacity = '0';
      State.languageDropdown.style.opacity = '0';
      
      setTimeout(() => {
        State.languageOverlay.style.display = 'none';
        State.languageDropdown.style.display = 'none';
        document.body.style.cssText = '';
        window.scrollTo(0, State.scrollPosition);
      }, CONFIG.FADE_DURATION);
    },
    
    // ── Error toast ───────────────────────────────────────────────────────────
    
    /**
     * แสดง error toast ชั่วคราว
     * @param {string} message
     */
    showError(message) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'language-error';
      errorDiv.textContent = message;
      errorDiv.style.cssText =
        'position:fixed;top:20px;right:20px;background:#ff4444;color:white;' +
        'padding:10px 20px;border-radius:4px;z-index:9999;opacity:0;transition:opacity 0.3s;';
      document.body.appendChild(errorDiv);
      
      requestAnimationFrame(() => {
        errorDiv.style.opacity = '1';
        setTimeout(() => {
          errorDiv.style.opacity = '0';
          setTimeout(() => errorDiv.remove(), 300);
        }, 3000);
      });
    },
  };
  
  M.UIService = UIService;
  
})(window.LangModules = window.LangModules || {});