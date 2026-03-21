// @ts-check
/**
 * @file manager.js
 * LanguageManager — orchestrator หลักของระบบภาษา
 *
 * เป็น thin coordinator ที่เรียก services ตามลำดับที่ถูกต้อง
 * Logic จริงอยู่ใน services แต่ละตัว
 *
 * Public API (เข้าถึงผ่าน window.languageManager):
 *  selectLanguage(lang)              — user กดเลือกภาษา
 *  updatePageLanguage(lang, updateURL) — อัพเดท content + URL
 *  initialize()                      — init ระบบ (เรียกจาก language.js)
 *  destroy()                         — cleanup ทั้งหมด
 *
 * @module manager
 * @depends {config.js, state.js, detector.js, loader.js, url.js,
 *           translator.js, ui.js, navigation.js}
 */
(function(M) {
  'use strict';
  
  const LanguageManager = {
    
    // ── Initialization ────────────────────────────────────────────────────────
    
    /**
     * เริ่มต้นระบบภาษา — เรียกเมื่อ DOM ready
     *
     * ลำดับ:
     *  1. จัดการ coordinated reload marker (sessionStorage)
     *  2. โหลดและ validate config
     *  3. setup button texts + initial language
     *  4. init dropdown UI
     *  5. observeMutations สำหรับ dynamic content
     *  6. setup navigation event handlers
     *  7. fade in body
     */
    async initialize() {
      const { State, LoaderService, TranslatorService, UIService, NavigationService } = M;
      
      // ── Coordinated reload marker cleanup ──────────────────────────────────
      try {
        const markerRaw = sessionStorage.getItem('fv-forcereload');
        if (markerRaw) {
          try {
            const marker = JSON.parse(markerRaw);
            const inflight = sessionStorage.getItem('fv-reload-inflight');
            const ack = sessionStorage.getItem('fv-reload-ack');
            
            if (ack === marker.id) {
              sessionStorage.removeItem('fv-forcereload');
              sessionStorage.removeItem('fv-reload-inflight');
            } else if (inflight === marker.id) {
              sessionStorage.setItem('fv-reload-ack', marker.id);
            }
          } catch (e) {}
        }
      } catch (e) {}
      
      if (State.isInitialized) return;
      
      try {
        // โหลดและ validate config (รอ prefetch ที่เริ่มไว้ตอน boot)
        await LoaderService.loadLanguagesConfig();
        
        // UI setup
        await UIService.prepareAllButtonTexts();
        await this._handleInitialLanguage();
        UIService.updateLanguageSelectorUI();
        
        // Observer + Navigation
        TranslatorService.observeMutations();
        NavigationService.setupHandlers();
        
        State.isInitialized = true;
        
        // Fade in body
        setTimeout(() => {
          if (document.body && document.body.style.opacity === '0') {
            document.body.style.transition = 'opacity 0.28s cubic-bezier(.47,1.64,.41,.8)';
            document.body.style.opacity = '1';
          }
        }, 0);
        
      } catch (error) {
        console.error('[LanguageManager] Error during initialization:', error);
        UIService.showError('ไม่สามารถเริ่มต้นระบบได้');
        setTimeout(() => {
          if (document.body && document.body.style.opacity === '0')
            document.body.style.opacity = '1';
        }, 0);
      }
    },
    
    /**
     * ตั้งค่าภาษาเริ่มต้น: detect → set selectedLang → update URL → load content
     * @private
     */
    async _handleInitialLanguage() {
      const { State, DetectorService, URLService, UIService, LoaderService, TranslatorService } = M;
      
      TranslatorService.storeOriginalContent();
      
      const decision = DetectorService.resolveCurrentLang();
      State.selectedLang = decision.lang;
      
      // Fix URL ถ้า source ไม่ใช่ URL (production only)
      if (!DetectorService.isLocalDev()) {
        if (decision.source === 'storage' || decision.source === 'browser') {
          URLService.updateURLForLanguage(State.selectedLang);
        }
      }
      
      // Sync localStorage ถ้า source มาจาก URL
      if (decision.source === 'url') {
        try { localStorage.setItem(M.CONFIG.LS_KEY, State.selectedLang); } catch (e) {}
      }
      
      UIService.showButtonTextForLang(State.selectedLang);
      
      // โหลด content ถ้าไม่ใช่ English หรือ English ใช้ JSON
      if (State.selectedLang !== 'en' || LoaderService.getEnSource() === 'json') {
        await this.updatePageLanguage(State.selectedLang, false);
      }
    },
    
    // ── Language selection ────────────────────────────────────────────────────
    
    /**
     * User กดเลือกภาษา — entry point จาก UIService
     *
     * บันทึก _userExplicitLang เพื่อให้ popstate/pageshow ยึดภาษานี้เสมอ
     *
     * @param {string} language
     */
    async selectLanguage(language) {
      const { CONFIG, State, URLService, UIService } = M;
      
      // Validate
      if (!State.languagesConfig[language]) {
        console.warn(`[LanguageManager] ไม่รองรับภาษา: ${language}`);
        language = CONFIG.DEFAULT_LANG;
      }
      
      // ถ้าเป็นภาษาเดิม ไม่ต้องทำอะไร
      if (State.selectedLang === language) {
        await UIService.closeLanguageDropdown();
        return;
      }
      
      // บันทึก explicit choice
      State._userExplicitLang = language;
      State.lastSelectedLang = State.selectedLang;
      
      URLService.updateURLForLanguage(language);
      await this.updatePageLanguage(language, false);
      await UIService.closeLanguageDropdown();
    },
    
    // ── Page language update ──────────────────────────────────────────────────
    
    /**
     * อัพเดทภาษาของทั้งหน้า
     *
     * ลำดับ:
     *  1. อัพเดท URL (ถ้า shouldUpdateURL)
     *  2. sync localStorage
     *  3. set document.lang attribute
     *  4. จัดการ Google Translate meta
     *  5. โหลด translation data
     *  6. แปล DOM
     *  7. อัพเดท button text
     *  8. broadcast ให้ tabs อื่น
     *  9. dispatch languageChange event
     *
     * @param {string}  language
     * @param {boolean} [shouldUpdateURL=true]
     */
    async updatePageLanguage(language, shouldUpdateURL = true) {
      const { State, DetectorService, URLService, LoaderService, TranslatorService, UIService } = M;
      
      if (State.isUpdatingLanguage) return;
      
      try {
        State.isUpdatingLanguage = true;
        State.lastSelectedLang = State.selectedLang;
        
        // URL update
        if (shouldUpdateURL && !DetectorService.isLocalDev()) {
          URLService.updateURLForLanguage(language);
        }
        
        // Sync localStorage
        try { localStorage.setItem(M.CONFIG.LS_KEY, language); } catch (e) {}
        
        // Document lang attribute
        document.documentElement.setAttribute('lang', language);
        
        // Google Translate meta — ป้องกัน double-translate
        const browserLang = DetectorService.detectBrowserLanguage();
        if (language === browserLang) {
          document.documentElement.setAttribute('translate', 'no');
          if (!document.querySelector('meta[name="google"][content="notranslate"]')) {
            const meta = document.createElement('meta');
            meta.name = 'google';
            meta.content = 'notranslate';
            document.head.appendChild(meta);
          }
        } else {
          document.documentElement.removeAttribute('translate');
          const meta = document.querySelector('meta[name="google"][content="notranslate"]');
          if (meta) meta.remove();
        }
        
        // Load + translate
        if (language === 'en') {
          if (LoaderService.getEnSource() === 'json') {
            const data = await LoaderService.loadLanguageData('en');
            if (data) await TranslatorService.parallelStreamingTranslate(data);
            else await TranslatorService.resetToEnglishContent();
          } else {
            await TranslatorService.resetToEnglishContent();
          }
        } else {
          const data = await LoaderService.loadLanguageData(language);
          if (data) await TranslatorService.parallelStreamingTranslate(data);
          else await TranslatorService.resetToEnglishContent();
        }
        
        // Update state + UI
        State.selectedLang = language;
        UIService.showButtonTextForLang(language);
        
        // Broadcast ให้ tabs อื่น
        if (State._bc) {
          try {
            State._bc.postMessage({ lang: language, url: location.href, ts: Date.now() });
          } catch (e) {}
        }
        
        // Dispatch event สำหรับโค้ดอื่นที่ฟัง
        try {
          window.dispatchEvent(new CustomEvent('languageChange', {
            detail: { language, previousLanguage: State.lastSelectedLang }
          }));
        } catch (e) {}
        
      } catch (error) {
        console.error('[LanguageManager] Error updating page language:', error);
        UIService.showError('เกิดข้อผิดพลาดในการเปลี่ยนภาษา');
        await TranslatorService.resetToEnglishContent();
      } finally {
        State.isUpdatingLanguage = false;
      }
    },
    
    // ── Cleanup ───────────────────────────────────────────────────────────────
    
    /**
     * Cleanup ทั้งหมด — เรียกตอน unmount หรือ destroy
     */
    destroy() {
      const { State } = M;
      
      if (State.languageOverlay?.parentElement) State.languageOverlay.remove();
      if (State.languageDropdown?.parentElement) State.languageDropdown.remove();
      
      if (State.mutationObserver) {
        State.mutationObserver.disconnect();
        State.mutationObserver = null;
      }
      
      if (State.workerPool) {
        State.workerPool.destroy();
        State.workerPool = null;
      }
      
      if (State._bc) {
        try { State._bc.close(); } catch (e) {}
        State._bc = null;
      }
      
      State.languageCache = {};
      State.isInitialized = false;
    },
  };
  
  M.LanguageManager = LanguageManager;
  
})(window.LangModules = window.LangModules || {});