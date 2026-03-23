// @ts-check
/**
 * @file gate.js
 * LangGate — ประตูที่บล็อกหรือ queue JS อื่นๆ จนกว่าระบบภาษาจะพร้อม  (NEW v4.1)
 *
 * เทคนิคที่รองรับ:
 *
 *  Cooperative (script ต้องรู้จักระบบ):
 *   T1. Promise   — await window.languageReady
 *   T2. Callback  — window.onLanguageReady(fn)  [defined ใน language.js]
 *   T3. Event     — addEventListener('languageReady', fn)
 *
 *  Non-cooperative (ไม่ต้องแก้ script อื่น):
 *   T4. Script interceptor — ดักจับ <script> inject เข้า DOM → queue → flush
 *       เปิดด้วย CONFIG.SCRIPT_INTERCEPTOR = true
 *       หรือ LangGate.installScriptInterceptor() โดยตรง
 *
 *   T5. defineProperty trap — guard window.myProp → undefined ถึง gate เปิด
 *       LangGate.guardProperty(window, 'myApp')
 *
 * opt-out markers:
 *   data-lang-nowait     — script จะไม่ถูก queue เลย
 *   data-lang-internal   — scripts ของระบบเอง (ใส่โดย loadScript อัตโนมัติ)
 *
 * Architecture:
 *   language.js สร้าง _earlyQueue + early interceptor ก่อน modules โหลด
 *   gate.js (Phase 1) adopt queue นั้น + เพิ่ม LangGate API ครบชุด
 *   manager.js เรียก LangGate.resolve() เมื่อ initialize() เสร็จ
 *
 * @module gate
 * @depends {config.js, state.js}
 */
(function(M) {
  'use strict';

  // ── defineProperty guards (T5) ────────────────────────────────────────────

  /** @type {Array<{obj:Object, prop:string, _get:()=>any, _set:(v:any)=>void}>} */
  const _guards = [];

  // ── Local interceptor (ใช้เมื่อ early interceptor ไม่ถูกเปิด) ─────────────

  /** @type {Array<{fn:Function, parent:Node, node:Node, ref:Node|null}>} */
  const _localQueue = [];
  let _localActive = false;

  // ── LangGate ──────────────────────────────────────────────────────────────

  const LangGate = {

    // ── Gate resolution ───────────────────────────────────────────────────────

    /**
     * เรียกจาก LanguageManager.initialize() เมื่อเสร็จสมบูรณ์
     *
     * ลำดับ:
     *  1. Resolve window.languageReady Promise  (T1)
     *  2. Flush script queue                   (T4)
     *  3. Release defineProperty guards        (T5)
     *  4. Dispatch 'languageReady' event       (T3)
     *
     * @param {{ lang: string, translations?: Object|null }} info
     */
    resolve(info) {
      // T1
      if (M._gateResolve) {
        try { M._gateResolve(info); } catch (e) {}
        M._gateResolve = null;
        M._gateReject  = null;
      }
      // T4
      _releaseScripts();
      // T5
      _releaseGuards();
      // T3
      try {
        window.dispatchEvent(new CustomEvent('languageReady', {
          detail: info,
          bubbles: false,
          cancelable: false,
        }));
      } catch (e) {}
    },

    /**
     * เรียกเมื่อ initialize() fail — reject Promise แต่ยัง flush
     * @param {Error|any} err
     */
    reject(err) {
      if (M._gateReject) {
        try { M._gateReject(err); } catch (e) {}
        M._gateResolve = null;
        M._gateReject  = null;
      }
      _releaseScripts();
      _releaseGuards();
    },

    // ── T4: Script interceptor ────────────────────────────────────────────────

    /**
     * ติดตั้ง script interceptor (idempotent)
     *
     * ถ้า CONFIG.SCRIPT_INTERCEPTOR = true: language.js ติดตั้ง early interceptor
     * ไว้ก่อนแล้ว — method นี้จะ no-op เพราะ queue ร่วมกันอยู่แล้ว
     *
     * ถ้าเรียกโดยตรง (เช่น runtime condition): จะใช้ local interceptor แทน
     */
    installScriptInterceptor() {
      if (M._earlyActive) return; // early interceptor ทำงานอยู่แล้ว
      _activateLocalInterceptor();
    },

    /**
     * Adopt early queue จาก language.js
     * เรียกโดย _boot() เมื่อ CONFIG.SCRIPT_INTERCEPTOR = true
     * (gate.js และ language.js share M._earlyQueue เดียวกัน)
     */
    adoptEarlyQueue() {
      // ไม่ต้องทำอะไร — _releaseScripts จัดการ flush M._earlyQueue อยู่แล้ว
    },

    // ── T5: defineProperty guard ──────────────────────────────────────────────

    /**
     * ป้องกัน property จนกว่า gate จะ resolve
     *
     * โค้ดที่ read property ก่อน gate เปิด → ได้ undefined
     * โค้ดที่ set property ก่อน gate เปิด → ค่าถูก buffer ไว้
     * หลัง gate เปิด → property ทำงานปกติ (ค่าที่ buffer ถูก set จริง)
     *
     * @param {Object} obj   — object เช่น window, globalThis
     * @param {string} prop  — property name
     *
     * @example
     * // ป้องกัน analytics จนกว่าภาษาจะพร้อม
     * LangGate.guardProperty(window, 'dataLayer')
     * LangGate.guardProperty(window, 'gtag')
     */
    guardProperty(obj, prop) {
      if (!obj || !prop) return;

      let _buffered = obj[prop];

      const guard = { obj, prop };
      Object.defineProperty(guard, '_value', {
        get: () => _buffered,
        set: (v) => { _buffered = v; },
      });
      _guards.push(guard);

      try {
        Object.defineProperty(obj, prop, {
          get() {
            return (M._gateResolve != null) ? undefined : _buffered;
          },
          set(v) {
            _buffered = v;
            if (M._gateResolve == null) {
              // gate เปิดแล้ว → restore ทันที
              try {
                Object.defineProperty(obj, prop, {
                  value: v, writable: true, configurable: true, enumerable: true,
                });
              } catch (e) {}
            }
          },
          configurable: true,
          enumerable: true,
        });
      } catch (e) {
        console.warn('[LangGate] guardProperty failed:', prop, e);
      }
    },

    // ── Status ────────────────────────────────────────────────────────────────

    /** interceptor active หรือไม่ */
    get isBlocking() {
      return !!(M._earlyActive || _localActive);
    },

    /** จำนวน scripts รอ flush */
    get queueLength() {
      return (M._earlyQueue ? M._earlyQueue.length : 0) + _localQueue.length;
    },
  };

  // ── Private: local interceptor ────────────────────────────────────────────

  function _activateLocalInterceptor() {
    if (_localActive) return;
    _localActive = true;

    const origA = M._origAppend || Node.prototype.appendChild;
    const origI = M._origInsert || Node.prototype.insertBefore;

    function _should(n) {
      return n instanceof HTMLScriptElement
          && !n.hasAttribute('data-lang-internal')
          && !n.hasAttribute('data-lang-nowait')
          && n.type !== 'application/ld+json'
          && n.type !== 'text/template'
          && n.type !== 'text/x-template';
    }

    Node.prototype.appendChild = function(n) {
      if (_localActive && _should(n)) { _localQueue.push({ fn: origA, parent: this, node: n, ref: null }); return n; }
      return origA.call(this, n);
    };
    Node.prototype.insertBefore = function(n, r) {
      if (_localActive && _should(n)) { _localQueue.push({ fn: origI, parent: this, node: n, ref: r || null }); return n; }
      return origI.call(this, n, r);
    };
  }

  // ── Private: release ─────────────────────────────────────────────────────

  function _releaseScripts() {
    // Deactivate early interceptor (language.js)
    if (M._earlyDeactivate) { M._earlyDeactivate(); M._earlyActive = false; }

    // Deactivate local interceptor
    if (_localActive) {
      _localActive = false;
      if (M._origAppend) Node.prototype.appendChild  = M._origAppend;
      if (M._origInsert) Node.prototype.insertBefore = M._origInsert;
    }

    // Flush: early queue ก่อน → local ตาม (รักษา order)
    const combined = [
      ...(M._earlyQueue ? M._earlyQueue.splice(0) : []),
      ..._localQueue.splice(0),
    ];

    for (const { fn, parent, node, ref } of combined) {
      try {
        ref != null ? fn.call(parent, node, ref) : fn.call(parent, node);
      } catch (e) {
        console.warn('[LangGate] flush error:', node.src || '(inline)', e);
      }
    }
  }

  function _releaseGuards() {
    for (const g of _guards.splice(0)) {
      try {
        Object.defineProperty(g.obj, g.prop, {
          value: g._value, writable: true, configurable: true, enumerable: true,
        });
      } catch (e) {}
    }
  }

  M.LangGate = LangGate;

})(window.LangModules = window.LangModules || {});