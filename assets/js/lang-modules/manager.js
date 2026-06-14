// @ts-check
/**
 * @file manager.js
 * LanguageManager — orchestrator หลักของระบบภาษา
 *
 * v5.0: FvLang integration
 *  - ใช้ FvLang.lang เป็น source of truth
 *  - เรียก FvLang.setLang() เมื่อภาษาเปลี่ยน
 *    → ทุกระบบ JS ที่ subscribe จะถูก refresh อัตโนมัติ
 *  - ใน static mode → redirect (เหมือนเดิม) แต่เรียก FvLang.setLang() ก่อน
 *  - ใน full mode → JS translation + FvLang.setLang() + fv:langchange
 *
 * @module manager
 * @depends {config.js, state.js, ui.js, gate.js}
 *   full mode ยังต้อง: detector.js, loader.js, url.js,
 *                     translator.js, navigation.js
 */
(function(M) {
  'use strict';
  
  const LanguageManager = {
    
    // ── Initialization ────────────────────────────────────────────────────────
    
    /**
     * เริ่มต้นระบบภาษา
     * v5.0: language.js แยก static/full boot แล้ว → ที่นี้รับแต่ full mode
     */
    async initialize() {
      const { State, UIService, LangGate } = M;
      
      // ── Guard: ไม่ init ซ้ำ ────────────────────────────────────────────
      if (State.isInitialized) {
        LangGate?.resolve({
          lang: State.selectedLang,
          translations: State.languageCache[State.selectedLang] || null,
        });
        return;
      }
      
      // ── v5.0: ถ้า FvLang บอกว่าเป็น static mode → ไม่ต้องทำอะไร
      // language.js จัดการ static boot ไปแล้ว
      if (window.FvLang && window.FvLang.isStaticMode) {
        State.isInitialized = true;
        return;
      }
      
      // ── Full mode (dev + production without pre-build) ───────────────
      await this._initializeFullMode();
    },
    
    /**
     * Full mode initialization
     * @private
     */
    async _initializeFullMode() {
      const { State, LoaderService, TranslatorService, UIService, NavigationService, LangGate } = M;
      
      // ── Coordinated reload marker cleanup ──────────────────────────────
      try {
        const markerRaw = sessionStorage.getItem('fv-forcereload');
        if (markerRaw) {
          try {
            const marker  = JSON.parse(markerRaw);
            const inflight = sessionStorage.getItem('fv-reload-inflight');
            const ack      = sessionStorage.getItem('fv-reload-ack');
            
            if (ack === marker.id) {
              sessionStorage.removeItem('fv-forcereload');
              sessionStorage.removeItem('fv-reload-inflight');
            } else if (inflight === marker.id) {
              sessionStorage.setItem('fv-reload-ack', marker.id);
            }
          } catch (e) {}
        }
      } catch (e) {}
      
      try {
        await LoaderService.loadLanguagesConfig();
        
        await UIService.prepareAllButtonTexts();
        await this._handleInitialLanguage();
        UIService.updateLanguageSelectorUI();
        
        TranslatorService.observeMutations();
        NavigationService.setupHandlers();
        
        State.isInitialized = true;
        
        setTimeout(() => {
          if (document.body && document.body.style.opacity === '0') {
            document.body.style.transition = 'opacity 0.28s cubic-bezier(.47,1.64,.41,.8)';
            document.body.style.opacity = '1';
          }
        }, 0);
        
        // ── v5.0: FvLang sync + gate resolve ─────────────────────────────
        if (window.FvLang) {
          FvLang.setLang(State.selectedLang, { silent: true });
        }
        
        if (LangGate) {
          LangGate.resolve({
            lang: State.selectedLang,
            translations: State.languageCache[State.selectedLang] || null,
          });
        }
        
      } catch (error) {
        console.error('[LanguageManager] Error during initialization:', error);
        UIService.showError('ไม่สามารถเริ่มต้นระบบได้');
        
        setTimeout(() => {
          if (document.body && document.body.style.opacity === '0')
            document.body.style.opacity = '1';
        }, 0);
        
        if (LangGate) LangGate.reject(error);
      }
    },
    
    /**
     * ตั้งค่าภาษาเริ่มต้น (full mode เท่านั้น)
     * @private
     */
    async _handleInitialLanguage() {
      const { State, DetectorService, URLService, UIService, LoaderService, TranslatorService } = M;
      
      TranslatorService.storeOriginalContent();
      
      // v5.0: ใช้ FvLang.lang แทน detect เอง (FvLang อ่านแล้ว)
      var initialLang = (window.FvLang && FvLang.lang) || 'en';
      
      // แต่ full mode ยังต้อง resolve แบบเดิมเพื่อได้ source info
      const decision = DetectorService.resolveCurrentLang();
      State.selectedLang = decision.lang;
      
      if (!DetectorService.isLocalDev()) {
        if (decision.source === 'storage' || decision.source === 'browser') {
          URLService.updateURLForLanguage(State.selectedLang);
        }
      }
      
      if (decision.source === 'url') {
        try { localStorage.setItem(M.CONFIG.LS_KEY, State.selectedLang); } catch (e) {}
      }
      
      UIService.showButtonTextForLang(State.selectedLang);
      
      if (State.selectedLang !== 'en' || LoaderService.getEnSource() === 'json') {
        await this.updatePageLanguage(State.selectedLang, false);
      }
    },
    
    // ── Language selection ────────────────────────────────────────────────────
    
    /**
     * User กดเลือกภาษา — entry point จาก UIService
     *
     * v5.0:
     *   static mode → FvLang.setLang() → redirect
     *   full mode   → JS translation + FvLang.setLang()
     *                  → fv:langchange ให้ทุกระบบ refresh
     *
     * @param {string} language
     */
    async selectLanguage(language) {
      const { CONFIG, State, URLService, UIService } = M;
      
      if (!State.languagesConfig[language]) {
        console.warn(`[LanguageManager] ไม่รองรับภาษา: ${language}`);
        language = CONFIG.DEFAULT_LANG;
      }
      
      if (State.selectedLang === language) {
        await UIService.closeLanguageDropdown();
        return;
      }
      
      // ── Static mode → redirect ────────────────────────────────────────
      if (window.FvLang && window.FvLang.isStaticMode) {
        await UIService.closeLanguageDropdown();
        
        // v5.0: แจ้ง FvLang ก่อน redirect
        // (เผื่อบางระบบต้องการทำอะไรก่อน page unload)
        if (window.FvLang) {
          FvLang.setLang(language);
        }
        
        try { localStorage.setItem(CONFIG.LS_KEY, language); } catch (e) {}
        
        const newUrl = _buildStaticLangUrl(language);
        window.location.replace(newUrl);
        return;
      }
      
      // ── Full mode → JS translation ─────────────────────────────────────
      State._userExplicitLang = language;
      State.lastSelectedLang  = State.selectedLang;
      
      URLService.updateURLForLanguage(language);
      await this.updatePageLanguage(language, false);
      await UIService.closeLanguageDropdown();
    },
    
    // ── Page language update (full mode only) ─────────────────────────────────
    
    /**
     * อัพเดทภาษาของทั้งหน้าด้วย JS translation
     * v5.0: เพิ่ม FvLang.setLang() → dispatch fv:langchange
     */
    async updatePageLanguage(language, shouldUpdateURL = true) {
      const { State, DetectorService, URLService, LoaderService, TranslatorService, UIService } = M;
      
      if (State.isUpdatingLanguage) return;
      
      try {
        State.isUpdatingLanguage = true;
        State.lastSelectedLang   = State.selectedLang;
        
        if (shouldUpdateURL && !DetectorService.isLocalDev()) {
          URLService.updateURLForLanguage(language);
        }
        
        try { localStorage.setItem(M.CONFIG.LS_KEY, language); } catch (e) {}
        
        document.documentElement.setAttribute('lang', language);
        
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
        
        State.selectedLang = language;
        UIService.showButtonTextForLang(language);
        
        if (State._bc) {
          try {
            State._bc.postMessage({ lang: language, url: location.href, ts: Date.now() });
          } catch (e) {}
        }
        
        // ── v5.0: FvLang → ทุกระบบ refresh ─────────────────────────────
        // FvLang.setLang() จะ:
        //   1. อัพเดท FvLang.lang
        //   2. เรียก subscribers ทั้งหมด
        //   3. dispatch 'fv:langchange' event
        if (window.FvLang) {
          FvLang.setLang(language);
        }
        
        // ยังคง dispatch 'languageChange' สำหรับ backward compat
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
  
  // ── Static mode helpers ────────────────────────────────────────────────────
  
  function _buildStaticLangUrl(targetLang) {
    const path    = location.pathname;
    const current = path.match(/^\/(en|th)(\/|$)/)?.[1];
    
    let newPath;
    if (current) {
      newPath = path.replace(/^\/(en|th)(\/|$)/, `/${targetLang}$2`);
    } else {
      newPath = `/${targetLang}${path === '/' ? '' : path}`;
    }
    
    return newPath + location.search + location.hash;
  }
  
  M.LanguageManager = LanguageManager;
  
})(window.LangModules = window.LangModules || {});