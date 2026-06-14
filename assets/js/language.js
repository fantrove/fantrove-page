// @ts-check
/**
 * @file language.js
 * Entry point สำหรับระบบภาษา — v5.0 (FvLang integration)
 *
 * การเปลี่ยนแปลงใน v5.0:
 *  - ใช้ FvLang (lang-core.js) เป็น source of truth สำหรับภาษา
 *  - Gate resolve ทันทีเมื่อ FvLang พร้อม (ใน static mode)
 *  - เมื่อเปลี่ยนภาษาใน full mode → เรียก FvLang.setLang()
 *    เพื่อ dispatch fv:langchange ให้ทุกระบบ refresh
 *  - ใน static mode: ไม่โหลด modules ที่ไม่จำเป็น
 *    (translator, worker-pool, detector, loader, markers)
 *
 *  FvLang integration:
 *    - language.js อ่าน FvLang.lang แทน detect เอง
 *    - language.js เรียก FvLang.setLang() เมื่อภาษาเปลี่ยน
 *    - ทุก script อื่นใช้ FvLang.lang / FvLang.onChange()
 *      แทน localStorage.getItem('selectedLang')
 *
 * Module dependency graph + load phases:
 *
 *   Phase 1 (parallel, no deps):
 *     types  config  state  worker-pool  gate
 *
 *   Phase 2 (parallel, need Phase 1):
 *     db  detector  loader  markers  translator  ui
 *     (static mode: เรียกเฉพาะ ui.js)
 *
 *   Phase 3 (parallel, need Phase 2):
 *     url  navigation  manager
 *     (static mode: เรียกเฉพาะ manager.js)
 *
 * @module language
 */
(function() {
  'use strict';
  
  // Guard: ไม่ init ซ้ำ
  if (window.__langUI?._initialized) return;
  
  // ══════════════════════════════════════════════════════════════════════════
  // FvLang INTEGRATION — ใช้ภาษาจาก lang-core.js
  // ══════════════════════════════════════════════════════════════════════════
  
  var isStatic = !!(window.FvLang && window.FvLang.isStaticMode);
  var initialLang = (window.FvLang && window.FvLang.lang) || 'en';
  
  const M0 = window.LangModules = window.LangModules || {};
  
  // ── Gate: ใน static mode resolve ทันที ──────────────────────────────
  
  let _gateResolve, _gateReject;
  
  if (isStatic) {
    // Static mode: FvLang ให้ภาษามาแล้ว → gate resolve ทันที
    // แต่ยังโหลด modules ต่อสำหรับ UI dropdown
    window.languageReady = Promise.resolve({ lang: initialLang, translations: null });
    window.onLanguageReady = function(fn) {
      if (typeof fn === 'function') {
        try { fn({ lang: initialLang, translations: null }); } catch (e) {}
      }
    };
    _gateResolve = null; // ไม่ต้อง resolve อีก
    _gateReject = null;
  } else {
    // Full mode: gate รอจนกว่า initialize เสร็จ
    window.languageReady = new Promise((res, rej) => {
      _gateResolve = res;
      _gateReject = rej;
    });
    M0._gateResolve = _gateResolve;
    M0._gateReject = _gateReject;
    
    window.onLanguageReady = function(fn) {
      if (typeof fn !== 'function') return;
      window.languageReady.then(fn).catch(function(e) {
        console.warn('[LangGate] onLanguageReady callback error:', e);
      });
    };
  }
  
  // ──────────────────────────────────────────────────────────────────────────
  // Early script interceptor (T4)
  // ──────────────────────────────────────────────────────────────────────────
  
  const _earlyQueue = [];
  let _earlyActive = false;
  const _origAppend = Node.prototype.appendChild;
  const _origInsert = Node.prototype.insertBefore;
  
  function _earlyShould(node) {
    if (!(node instanceof HTMLScriptElement)) return false;
    if (node.hasAttribute('data-lang-internal')) return false;
    if (node.hasAttribute('data-lang-nowait')) return false;
    if (node.type === 'application/ld+json') return false;
    if (node.type === 'text/template') return false;
    if (node.type === 'text/x-template') return false;
    return true;
  }
  
  function _installEarlyInterceptor() {
    if (_earlyActive) return;
    _earlyActive = true;
    M0._earlyActive = true;
    
    Node.prototype.appendChild = function(node) {
      if (_earlyActive && _earlyShould(node)) {
        _earlyQueue.push({ fn: _origAppend, parent: this, node, ref: null });
        return node;
      }
      return _origAppend.call(this, node);
    };
    
    Node.prototype.insertBefore = function(node, ref) {
      if (_earlyActive && _earlyShould(node)) {
        _earlyQueue.push({ fn: _origInsert, parent: this, node, ref: ref || null });
        return node;
      }
      return _origInsert.call(this, node, ref);
    };
  }
  
  M0._earlyQueue = _earlyQueue;
  M0._origAppend = _origAppend;
  M0._origInsert = _origInsert;
  M0._earlyDeactivate = function() { _earlyActive = false; };
  
  // ══════════════════════════════════════════════════════════════════════════
  // PHASES — module loading (สั้นลงใน static mode)
  // ══════════════════════════════════════════════════════════════════════════
  
  const FULL_PHASES = [
    ['types.js', 'config.js', 'state.js', 'worker-pool.js', 'gate.js'],
    ['db.js', 'detector.js', 'loader.js', 'markers.js', 'translator.js', 'ui.js'],
    ['url.js', 'navigation.js', 'manager.js'],
  ];
  
  // Static mode: โหลดเฉพาะ modules ที่จำเป็นสำหรับ UI dropdown
  const STATIC_PHASES = [
    ['types.js', 'config.js', 'state.js', 'gate.js'],
    ['ui.js'],
    ['manager.js'],
  ];
  
  const PHASES = isStatic ? STATIC_PHASES : FULL_PHASES;
  
  // ── Resolve base path ─────────────────────────────────────────────────────
  
  function getBasePath() {
    try {
      for (const s of document.querySelectorAll('script[src]')) {
        const src = s.getAttribute('src') || '';
        if (src.includes('language.js'))
          return src.replace(/\/language\.js(\?.*)?$/, '');
      }
    } catch (e) {}
    return '/assets/js';
  }
  
  // ── Script loaders ────────────────────────────────────────────────────────
  
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = false;
      s.setAttribute('data-lang-internal', '');
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('[LangUI] Failed to load: ' + url));
      _origAppend.call(document.head, s);
    });
  }
  
  function loadPhase(names, base) {
    return Promise.all(
      names.map(n => loadScript(`${base}/lang-modules/${n}`))
    ).then(() => {});
  }
  
  function loadPhases(phases, base) {
    return phases.reduce(
      (chain, phase) => chain.then(() => loadPhase(phase, base)),
      Promise.resolve()
    );
  }
  
  // ── Boot sequence ─────────────────────────────────────────────────────────
  
  const base = getBasePath();
  
  loadPhases(PHASES, base)
    .then(() => _boot())
    .catch(err => {
      console.error('[LangUI] Module loading failed:', err);
      if (M0._gateReject) {
        M0._gateReject(err);
        M0._gateReject = null;
      }
    });
  
  function _boot() {
    const M = window.LangModules;
    if (!M) {
      console.error('[LangUI] LangModules namespace missing after load');
      return;
    }
    
    const { CONFIG, State, LanguageManager, LangGate } = M;
    
    // ── Sync FvLang → State ───────────────────────────────────────────────
    // ทุกอย่างในระบบภาษาควรอ่านจาก FvLang.lang
    if (window.FvLang) {
      State.selectedLang = FvLang.lang;
    }
    
    if (isStatic) {
      // ── Static mode boot ────────────────────────────────────────────────
      // โหลด config จาก window.__fvStaticConfig
      _bootStatic(M);
    } else {
      // ── Full mode boot ─────────────────────────────────────────────────
      const { TranslatorService, NavigationService, LoaderService } = M;
      
      TranslatorService.initPool();
      NavigationService.initBroadcastChannel();
      
      if (CONFIG.SCRIPT_INTERCEPTOR) {
        _installEarlyInterceptor();
        LangGate.adoptEarlyQueue();
      }
      
      State._prefetchPromise = LoaderService.prefetchEnterprise();
      
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => LanguageManager.initialize());
      } else {
        LanguageManager.initialize();
      }
    }
    
    // ── Public API ───────────────────────────────────────────────────────────
    window.languageManager = LanguageManager;
    window.__langUI = { _initialized: true };
  }
  
  /**
   * Static mode: FvLang ให้ภาษามาแล้ว โหลดเฉพราะ UI
   * @param {Object} M — LangModules
   */
  function _bootStatic(M) {
    const { State, UIService, LanguageManager } = M;
    
    try {
      // อ่าน config จาก window.__fvStaticConfig (build script inject)
      const staticConfig = window.__fvStaticConfig;
      if (staticConfig && staticConfig.langs) {
        State.languagesConfig = staticConfig.langs;
        State.selectedLang = staticConfig.lang || FvLang.lang;
      } else {
        // Fallback config
        State.languagesConfig = {};
        for (const l of M.CONFIG.SUPPORTED_LANGS) {
          State.languagesConfig[l] = {
            buttonText: l === 'th' ? 'ภาษาไทย' : 'English',
            label: l === 'th' ? 'ภาษาไทย' : 'English',
          };
        }
        State.selectedLang = FvLang.lang;
      }
      
      // Sync FvLang
      if (window.FvLang) FvLang.lang = State.selectedLang;
      
      try { localStorage.setItem(M.CONFIG.LS_KEY, State.selectedLang); } catch (e) {}
      
      UIService.prepareAllButtonTexts();
      UIService.showButtonTextForLang(State.selectedLang);
      UIService.updateLanguageSelectorUI();
      
      State.isInitialized = true;
      
      // Fade in
      if (document.body && document.body.style.opacity === '0') {
        document.body.style.opacity = '1';
      }
      
    } catch (error) {
      console.error('[LanguageManager] Static mode init error:', error);
      if (document.body && document.body.style.opacity === '0')
        document.body.style.opacity = '1';
    }
  }
  
})();