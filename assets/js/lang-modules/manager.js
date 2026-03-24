// @ts-check
/**
 * @file manager.js
 * LanguageManager — orchestrator หลักของระบบภาษา
 *
 * เปลี่ยนแปลงใน v4.2 (Static Mode):
 *  - ตรวจจับ `document.documentElement.dataset.fvBuilt`
 *    → flag นี้ถูก inject โดย build script เมื่อ page ถูก pre-build
 *
 *  เมื่ออยู่ใน static mode:
 *   ✓ อ่าน config จาก window.__fvStaticConfig แทน fetch db.json
 *   ✓ ตั้งค่า selectedLang จาก flag (ไม่ต้อง detect จาก URL/storage)
 *   ✓ Setup UI (language button + dropdown) ตามปกติ
 *   ✓ Fade in body
 *   ✗ ไม่ fetch translation JSON (ไม่จำเป็น เนื้อหาถูก bake ลง HTML แล้ว)
 *   ✗ ไม่รัน parallelStreamingTranslate (ไม่มี [data-translate] elements เหลือ)
 *   ✗ ไม่สร้าง WorkerPool
 *   ✗ ไม่ setup BroadcastChannel
 *
 *  การเลือกภาษาใน static mode:
 *   → redirect ไปยัง /{lang}/{current-path} แทนการแปลด้วย JS
 *   → ใช้ location.replace() เพื่อไม่เพิ่ม history entry
 *     (กด Back จะออกจากหน้าปัจจุบันจริงๆ ไม่วนกลับมาภาษาเดิม)
 *   → บันทึกใน localStorage เหมือนเดิม
 *
 * @module manager
 * @depends {config.js, state.js, detector.js, loader.js, url.js,
 *           translator.js, ui.js, navigation.js, gate.js}
 */
(function(M) {
  'use strict';
  
  const LanguageManager = {
    
    // ── Initialization ────────────────────────────────────────────────────────
    
    /**
     * เริ่มต้นระบบภาษา — เรียกเมื่อ DOM ready
     *
     * v4.2: ตรวจสอบ static mode ก่อน
     * ถ้าเป็น static mode → initialize แบบเบา (UI only)
     * ถ้าไม่ใช่ → initialize แบบเต็ม (เหมือนเดิมทุกอย่าง)
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
      
      // ── v4.2: Static mode detection ────────────────────────────────────
      const builtLang = document.documentElement.dataset?.fvBuilt;
      if (builtLang) {
        await this._initializeStaticMode(builtLang);
        return;
      }
      
      // ── Normal mode (dev + production without pre-build) ───────────────
      await this._initializeFullMode();
    },
    
    /**
     * Static mode initialization
     * เรียกเมื่อ data-fv-built ถูกตั้งค่าบน <html>
     *
     * เป้าหมาย:
     *  1. Load config จาก window.__fvStaticConfig (ไม่ fetch network)
     *  2. Setup UI dropdown
     *  3. Fade in body
     *  4. Resolve LangGate
     *
     * @param {string} builtLang — ภาษาที่ build script ตั้งไว้
     * @private
     */
    async _initializeStaticMode(builtLang) {
      const { CONFIG, State, UIService, LangGate } = M;
      
      try {
        // อ่าน config ที่ build script inject ไว้ใน <head>
        const staticConfig = window.__fvStaticConfig;
        
        if (staticConfig && staticConfig.langs) {
          // ใช้ config จาก inline script — ไม่ fetch db.json เลย
          State.languagesConfig = staticConfig.langs;
          State.selectedLang    = staticConfig.lang || builtLang;
        } else {
          // Fallback: ถ้า config ไม่มีด้วยเหตุผลใดก็ตาม
          // สร้าง minimal config จาก supported langs ใน CONFIG
          State.languagesConfig = {};
          for (const l of CONFIG.SUPPORTED_LANGS) {
            State.languagesConfig[l] = {
              buttonText: l === 'th' ? 'ภาษาไทย' : 'English',
              label:      l === 'th' ? 'ภาษาไทย' : 'English',
            };
          }
          State.selectedLang = builtLang || CONFIG.DEFAULT_LANG;
        }
        
        // บันทึก preference ลง localStorage (สำหรับ cross-page consistency)
        try { localStorage.setItem(CONFIG.LS_KEY, State.selectedLang); } catch (e) {}
        
        // Setup UI (ใช้ UIService เดิมทุกอย่าง — ไม่ต้องเขียนใหม่)
        await UIService.prepareAllButtonTexts();
        UIService.showButtonTextForLang(State.selectedLang);
        UIService.updateLanguageSelectorUI();
        
        State.isInitialized = true;
        
        // Fade in — หน้า built ไม่มี opacity:0 แล้ว แต่ใส่ไว้ safe
        if (document.body && document.body.style.opacity === '0') {
          document.body.style.opacity = '1';
        }
        
        LangGate?.resolve({
          lang: State.selectedLang,
          translations: null, // static mode: ไม่มี in-memory translations
        });
        
      } catch (error) {
        console.error('[LanguageManager] Static mode init error:', error);
        // Fail gracefully — แสดงหน้าได้ แม้ UI ภาษาจะไม่ทำงาน
        if (document.body && document.body.style.opacity === '0')
          document.body.style.opacity = '1';
        LangGate?.reject(error);
      }
    },
    
    /**
     * Full mode initialization (เหมือนเดิมทุกอย่างจาก v4.1)
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
     * v4.2: ถ้าอยู่ใน static mode → redirect ไปยัง /{lang}/path
     *       ถ้าอยู่ใน full mode  → JS translation เหมือนเดิม
     *
     * [FIX] Static mode ใช้ location.replace() แทน location.href
     *       เพื่อไม่เพิ่ม history entry ใหม่
     *       → กด Back จะออกจากหน้าปัจจุบันจริงๆ
     *         ไม่วนกลับมาภาษาเดิม (สำคัญมากสำหรับ app-style navigation)
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
      
      // ── v4.2: Static mode → redirect ──────────────────────────────────
      if (document.documentElement.dataset?.fvBuilt) {
        await UIService.closeLanguageDropdown();
        
        // บันทึก preference ก่อน navigate
        try { localStorage.setItem(CONFIG.LS_KEY, language); } catch (e) {}
        
        // สร้าง URL ใหม่ด้วย language prefix ที่ต้องการ
        const newUrl = _buildStaticLangUrl(language);
        
        // ใช้ replace() แทน href เพื่อไม่เพิ่ม history entry
        // เหตุผล: การเปลี่ยนภาษาไม่ใช่ "navigation ใหม่" แต่เป็น
        //         "การ replace หน้าปัจจุบันด้วยภาษาอื่น"
        //         กด Back ควรออกไปหน้าก่อนหน้า ไม่ใช่วนกลับมาภาษาเดิม
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
     * (ไม่ถูกเรียกใน static mode)
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
  
  /**
   * สร้าง URL ใหม่โดยเปลี่ยน language prefix
   * ใช้สำหรับ redirect ใน static mode
   *
   * /en/setting/ → /th/setting/
   * /en/home/    → /th/home/
   *
   * @param {string} targetLang
   * @returns {string}
   */
  function _buildStaticLangUrl(targetLang) {
    const path    = location.pathname;
    const current = path.match(/^\/(en|th)(\/|$)/)?.[1];
    
    let newPath;
    if (current) {
      newPath = path.replace(/^\/(en|th)(\/|$)/, `/${targetLang}$2`);
    } else {
      // ไม่มี prefix (ไม่ควรเกิด บน built pages) → เพิ่ม prefix
      newPath = `/${targetLang}${path === '/' ? '' : path}`;
    }
    
    return newPath + location.search + location.hash;
  }
  
  M.LanguageManager = LanguageManager;
  
})(window.LangModules = window.LangModules || {});