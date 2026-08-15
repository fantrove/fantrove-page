// @ts-check
/**
 * @file navigation.js
 * NavigationService — จัดการ navigation events ทั้งหมด
 *
 * ├── initBroadcastChannel()  — สร้าง BroadcastChannel สำหรับ cross-tab sync
 * ├── setupHandlers()         — attach event listeners ทั้งหมด
 * │   ├── pageshow            ← FIX: BFCache restoration
 * │   ├── popstate            ← SPA back/forward
 * │   ├── storage             ← cross-tab sync
 * │   └── visibilitychange    ← กลับมาที่ tab
 * └── _onBroadcastLang()      — รับ message จาก tab อื่น
 *
 * @module navigation
 * @depends {config.js, state.js, detector.js, url.js, translator.js, ui.js}
 */
(function(M) {
  'use strict';
  
  const NavigationService = {
    
    // ── BroadcastChannel ──────────────────────────────────────────────────────
    
    /**
     * สร้าง BroadcastChannel สำหรับ sync ภาษาระหว่าง tabs
     * เรียกครั้งเดียวตอน boot
     */
    initBroadcastChannel() {
      const { State } = M;
      try {
        State._bc = (typeof BroadcastChannel !== 'undefined') ?
          new BroadcastChannel('fv-lang-v3') :
          null;
      } catch (e) {
        State._bc = null;
      }
      
      if (State._bc) {
        State._bc.onmessage = (ev) => this._onBroadcastLang(ev.data);
      }
    },
    
    // ── Event handlers setup ──────────────────────────────────────────────────
    
    /**
     * Attach event listeners ทั้งหมดหลัง initialize เสร็จ
     * เรียกจาก LanguageManager.initialize()
     */
    setupHandlers() {
      this._setupPageshow();
      this._setupPopstate();
      this._setupStorage();
      this._setupVisibilityChange();
    },
    
    // ── pageshow (BFCache fix — v3.2) ─────────────────────────────────────────
    
    /**
     * จัดการ BFCache Restoration
     *
     * ปัญหา: modern browser เก็บหน้าไว้ใน bfcache เมื่อ user กด Back/Forward
     *        → browser restore JS state เดิมของหน้านั้นทั้งหมด
     *        → lang-proxy.js ไม่รัน (ไม่มี page reload)
     *        → selectedLang อาจเป็นค่าเก่า แต่ localStorage อาจถูกเปลี่ยนไปแล้ว
     *          โดยหน้าอื่นที่ user ไปเปลี่ยนภาษา
     *
     * การแก้: event.persisted=true บอกว่าหน้านี้มาจาก bfcache
     *         → อ่าน localStorage ใหม่ แล้ว reconcile กับ state ปัจจุบัน
     *
     * @private
     */
    _setupPageshow() {
      window.addEventListener('pageshow', (event) => {
        // event.persisted=false → โหลดหน้าใหม่ปกติ, initialize() จัดการอยู่แล้ว
        if (!event.persisted) return;
        if (M.DetectorService.isLocalDev()) return;
        
        try {
          const { State, DetectorService, URLService } = M;
          const storedLang = DetectorService.getLangFromStorage();
          if (!storedLang) return;
          
          if (storedLang !== State.selectedLang) {
            // localStorage บอกภาษาต่างจาก JS state ที่ restore กลับมา
            // → user เปลี่ยนภาษาในหน้าอื่นระหว่างที่ออกจากหน้านี้
            State._userExplicitLang = storedLang;
            M.LanguageManager.updatePageLanguage(storedLang, true).catch(e => {
              console.error('[NavigationService/pageshow] language sync error:', e);
            });
          } else {
            // ภาษาตรงกันแล้ว แต่ URL อาจมี prefix เก่า → fix URL เฉยๆ
            URLService.updateURLForLanguage(storedLang);
          }
        } catch (e) {
          console.error('[NavigationService/pageshow] handler error:', e);
        }
      });
    },
    
    // ── popstate (SPA navigation) ─────────────────────────────────────────────
    
    /**
     * จัดการ popstate จาก SPA navigation (pushState/popstate)
     * กรณีนี้เกิดเฉพาะ SPA ที่ใช้ pushState (lang-links.js)
     * ถ้าเป็น full page navigation → lang-proxy.js จัดการก่อนแล้ว
     *
     * Core logic:
     *   ถ้า user เคยเลือกภาษาแล้ว (_userExplicitLang หรือ localStorage)
     *   → ยึดภาษานั้นเสมอ ไม่ยึดตาม URL prefix ของหน้าเก่า
     *
     * @private
     */
    _setupPopstate() {
      window.addEventListener('popstate', async (event) => {
        try {
          const { State, DetectorService, URLService } = M;
          
          if (DetectorService.isLocalDev()) return;
          
          const preferredLang = State._userExplicitLang || DetectorService.getLangFromStorage();
          
          if (preferredLang) {
            if (preferredLang !== State.selectedLang) {
              await M.LanguageManager.updatePageLanguage(preferredLang, true);
            } else {
              URLService.updateURLForLanguage(preferredLang);
            }
            return;
          }
          
          // Fallback: ไม่มี user preference → ดูจาก history state หรือ URL
          if (event.state && event.state.lang && event.state.lang !== State.selectedLang) {
            await M.LanguageManager.updatePageLanguage(event.state.lang, false);
            return;
          }
          
          const urlLang = DetectorService.getLangFromURL();
          if (urlLang && urlLang !== State.selectedLang) {
            await M.LanguageManager.updatePageLanguage(urlLang, false);
            try { localStorage.setItem(M.CONFIG.LS_KEY, urlLang); } catch (e) {}
          }
          
        } catch (e) {
          console.error('[NavigationService/popstate] handler error:', e);
        }
      });
    },
    
    // ── storage (cross-tab sync) ──────────────────────────────────────────────
    
    /**
     * sync ภาษาเมื่อ tab อื่นเปลี่ยน localStorage
     * @private
     */
    _setupStorage() {
      window.addEventListener('storage', (e) => {
        if (e.key !== M.CONFIG.LS_KEY) return;
        
        const { State, DetectorService, URLService } = M;
        const newLang = e.newValue;
        const urlLang = DetectorService.getLangFromURL();
        
        // ถ้า URL ไม่ตรงกับภาษาใหม่ ให้ fix URL (production only)
        if (!DetectorService.isLocalDev() && urlLang && urlLang !== newLang) {
          URLService.updateURLForLanguage(newLang);
        }
        
        if (newLang && newLang !== State.selectedLang) {
          M.LanguageManager.updatePageLanguage(newLang, false).catch(() => {});
        }
      });
    },
    
    // ── visibilitychange (กลับมาที่ tab) ─────────────────────────────────────
    
    /**
     * ตรวจสอบและ sync ภาษาเมื่อ user กลับมาที่ tab นี้
     * @private
     */
    _setupVisibilityChange() {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        
        const { State, DetectorService, URLService } = M;
        if (DetectorService.isLocalDev()) return;
        
        const preferredLang = State._userExplicitLang || DetectorService.getLangFromStorage();
        if (preferredLang && preferredLang !== State.selectedLang) {
          M.LanguageManager.updatePageLanguage(preferredLang, true).catch(() => {});
          return;
        }
        
        const urlLang = DetectorService.getLangFromURL();
        if (urlLang && urlLang !== State.selectedLang) {
          M.LanguageManager.updatePageLanguage(urlLang, false).catch(() => {});
        }
      });
    },
    
    // ── BroadcastChannel message ──────────────────────────────────────────────
    
    /**
     * รับ message ภาษาจาก tab อื่น แล้ว sync
     * @param {Object} msg  — { lang, url, ts }
     */
    _onBroadcastLang(msg) {
      try {
        if (!msg || typeof msg !== 'object') return;
        const { lang, url } = msg;
        if (!lang || lang === M.State.selectedLang) return;
        if (url && url === location.href) return; // ตัวเองส่งมา ไม่ต้องทำ
        
        const { DetectorService, URLService } = M;
        
        if (!DetectorService.isLocalDev()) {
          const currentUrlLang = DetectorService.getLangFromURL();
          if (currentUrlLang && currentUrlLang !== lang) {
            URLService.updateURLForLanguage(lang);
          }
        }
        
        M.LanguageManager.updatePageLanguage(lang, DetectorService.isLocalDev() ? false : true)
          .catch(() => {});
      } catch (e) {}
    },
  };
  
  M.NavigationService = NavigationService;
  
})(window.LangModules = window.LangModules || {});