// @ts-check
/**
 * @file language.js
 * Entry point สำหรับระบบภาษา — v4.1
 *
 * เพิ่มใน v4.1:
 *  - LangGate: ระบบ gate ที่บล็อก JS อื่นๆ จนกว่าภาษาจะพร้อม
 *
 *  Public API ใหม่ (cooperative):
 *    window.languageReady          — Promise<{ lang, translations }>
 *    window.onLanguageReady(fn)    — helper สำหรับ non-async code
 *    window 'languageReady' event  — CustomEvent
 *
 *  Non-cooperative blocking (opt-in):
 *    CONFIG.SCRIPT_INTERCEPTOR = true
 *    → ดักจับ script ที่ inject เข้า DOM ก่อน gate เปิด
 *
 *  opt-out per-script:
 *    <script data-lang-nowait>     — ไม่ถูก queue เลย
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⚠  Gate Promise สร้างทันทีที่ language.js execute
 *    (ก่อน loadPhases ด้วยซ้ำ) — external scripts เรียก await ได้เลย
 *
 * Module dependency graph + load phases:
 *
 *   Phase 1 (parallel, no deps):
 *     types  config  state  worker-pool  gate     ← gate เพิ่มใหม่
 *
 *   Phase 2 (parallel, need Phase 1):
 *     db  detector  loader  markers  translator  ui
 *
 *   Phase 3 (parallel, need Phase 2):
 *     url  navigation  manager
 *
 * @module language
 */
(function() {
  'use strict';

  // Guard: ไม่ init ซ้ำ
  if (window.__langUI?._initialized) return;

  // ══════════════════════════════════════════════════════════════════════════
  // GATE SETUP — ต้องรันก่อนสิ่งอื่นทั้งหมด
  // สร้าง Promise ทันทีที่ script นี้ execute เพื่อให้ external script
  // ที่โหลดพร้อมกัน (หรือหลัง) สามารถ await ได้ทันที
  // ══════════════════════════════════════════════════════════════════════════

  const M0 = window.LangModules = window.LangModules || {};

  // T1: Promise gate
  let _gateResolve, _gateReject;
  window.languageReady = new Promise((res, rej) => {
    _gateResolve = res;
    _gateReject  = rej;
  });
  M0._gateResolve = _gateResolve;
  M0._gateReject  = _gateReject;

  // T2: Callback helper — works before AND after gate opens
  //   ถ้าเรียกหลัง gate เปิดแล้ว: fn จะถูก call ทันทีใน microtask ถัดไป
  window.onLanguageReady = function(fn) {
    if (typeof fn !== 'function') return;
    window.languageReady.then(fn).catch(function(e) {
      console.warn('[LangGate] onLanguageReady callback error:', e);
    });
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Early script interceptor (T4)
  //
  // ติดตั้งก่อน loadPhases เพื่อดักจับ scripts ที่ถูก inject ระหว่าง
  // module loading ด้วย เช่น third-party analytics ที่โหลดแบบ async
  //
  // gate.js (Phase 1) จะ take ownership ของ queue นี้เมื่อโหลดเสร็จ
  // ──────────────────────────────────────────────────────────────────────────

  /** @type {Array<{fn:Function, parent:Node, node:Node, ref:Node|null}>} */
  const _earlyQueue = [];
  let   _earlyActive = false;
  const _origAppend = Node.prototype.appendChild;
  const _origInsert = Node.prototype.insertBefore;

  function _earlyShould(node) {
    if (!(node instanceof HTMLScriptElement)) return false;
    if (node.hasAttribute('data-lang-internal')) return false;
    if (node.hasAttribute('data-lang-nowait'))   return false;
    if (node.type === 'application/ld+json')     return false;
    if (node.type === 'text/template')           return false;
    if (node.type === 'text/x-template')         return false;
    return true;
  }

  /**
   * เปิด early interceptor (เรียกตอน boot ถ้า CONFIG.SCRIPT_INTERCEPTOR)
   * gate.js จะ reuse _earlyQueue นี้ผ่าน M0._earlyQueue
   */
  function _installEarlyInterceptor() {
    if (_earlyActive) return;
    _earlyActive = true;
    M0._earlyActive = true; // signal ให้ gate.js รู้ว่า intercept อยู่

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

  // Share ไปยัง gate.js ที่จะมาโหลดทีหลัง
  M0._earlyQueue    = _earlyQueue;
  M0._origAppend    = _origAppend;
  M0._origInsert    = _origInsert;
  M0._earlyDeactivate = function() { _earlyActive = false; };

  // ══════════════════════════════════════════════════════════════════════════
  // PHASES — module loading
  // ══════════════════════════════════════════════════════════════════════════

  const PHASES = [
    // Phase 1: ไม่มี dependency ต่อกัน
    ['types.js', 'config.js', 'state.js', 'worker-pool.js', 'gate.js'],

    // Phase 2: ต้องการ config + state (+ worker-pool สำหรับ translator)
    ['db.js', 'detector.js', 'loader.js', 'markers.js', 'translator.js', 'ui.js'],

    // Phase 3: ต้องการทุกอย่างจาก Phase 2
    ['url.js', 'navigation.js', 'manager.js'],
  ];

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
      s.setAttribute('data-lang-internal', ''); // ← ไม่ถูก queue โดย interceptor
      s.onload  = () => resolve();
      s.onerror = () => reject(new Error('[LangUI] Failed to load: ' + url));
      _origAppend.call(document.head, s); // ← ใช้ native append เสมอ
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
      // Reject gate เพื่อไม่ให้หน้า hang ถาวร
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

    const { CONFIG, State, TranslatorService, NavigationService,
            LoaderService, LanguageManager, LangGate } = M;

    // 1. init WorkerPool (lazy)
    TranslatorService.initPool();

    // 2. BroadcastChannel
    NavigationService.initBroadcastChannel();

    // 3. Script interceptor (T4) — opt-in ผ่าน CONFIG
    //    gate.js จะ take ownership ของ _earlyQueue ที่สร้างไว้แล้ว
    if (CONFIG.SCRIPT_INTERCEPTOR) {
      _installEarlyInterceptor();
      LangGate.adoptEarlyQueue(); // gate.js sync queue + restore mechanism
    }

    // 4. เริ่ม prefetch config ทันที
    State._prefetchPromise = LoaderService.prefetchEnterprise();

    // 5. Initialize เมื่อ DOM พร้อม
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => LanguageManager.initialize());
    } else {
      LanguageManager.initialize();
    }

    // ── Public API ───────────────────────────────────────────────────────────
    window.languageManager = LanguageManager;
    window.__langUI = { _initialized: true };

    // Node.js test environment
    if (typeof module !== 'undefined' && module.exports)
      module.exports = LanguageManager;
  }

})();