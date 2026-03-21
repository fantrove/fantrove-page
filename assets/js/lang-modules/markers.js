// @ts-check
/**
 * @file markers.js
 * MarkerRegistry — Extensible marker-to-DOM handler registry  (NEW in v4.0)
 *
 * ทำไมถึงต้องมี file นี้:
 *  เดิม logic "สร้าง DOM node จาก marker" กระจายอยู่ใน translator.js
 *  ทำให้เพิ่ม marker ใหม่ต้องแก้ translator.js โดยตรง
 *
 *  ตอนนี้:
 *   - Built-in markers ลงทะเบียนที่นี่
 *   - Custom marker เพิ่มได้ด้วย MarkerRegistry.register()
 *   - Translator ใช้ MarkerRegistry.createNode() แทน switch/if-else
 *
 * ──────────────────────────────────────────────────────────────────────────
 * การเพิ่ม marker ใหม่ (3 ขั้นตอน):
 *
 *  1. เพิ่ม pattern ใน WORKER_CODE ของ translator.js:
 *       | (@icon:([^@]+)@)
 *
 *  2. เพิ่ม capture groups ใน worker's markerRegex handling:
 *       } else if (m[N]) {
 *         parts.push({ type: 'icon', id: m[N+1] || null });
 *       }
 *
 *  3. Register handler ที่นี่:
 *       MarkerRegistry.register('icon', {
 *         createNode: (part, refs) => {
 *           const i = document.createElement('i');
 *           i.className = `icon-${part.id}`;
 *           return i;
 *         },
 *       });
 * ──────────────────────────────────────────────────────────────────────────
 *
 * @module markers
 * @depends {config.js}
 */
(function(M) {
  'use strict';
  
  // ── Types ─────────────────────────────────────────────────────────────────
  
  /**
   * Object สำหรับค้นหา DOM elements ที่มีอยู่แล้วใน element ที่กำลังแปล
   * ส่งเข้า createNode เพื่อให้ handler ดึงของเดิมมาใช้ซ้ำแทนการสร้างใหม่
   *
   * @typedef {Object} MarkerRefs
   * @property {function(string|null): Element|null} resolveSvg
   *   หา SVG element ที่ตรงกับ id (ถ้า id=null → คืนตัวแรกที่ยังไม่ถูกใช้)
   * @property {function(string|null): Element|null} resolveSlot
   *   หา slot element ที่ตรงกับ name
   * @property {function(string|null): Element|null} resolveAnchor
   *   หา anchor (<a>) ที่ตรงกับ id hint
   */
  
  /**
   * Handler สำหรับ marker type หนึ่งๆ
   * @typedef {Object} MarkerHandler
   * @property {function(Object, MarkerRefs): Node} createNode
   *   รับ part object จาก worker + refs → คืน DOM node
   */
  
  // ── Registry ──────────────────────────────────────────────────────────────
  
  const MarkerRegistry = {
    
    /** @type {Map<string, MarkerHandler>} */
    _handlers: new Map(),
    
    /**
     * ลงทะเบียน marker handler
     * ถ้า type ซ้ำ → override handler เดิม (ใช้ override built-in ได้)
     *
     * @param {string}        type     — ชื่อ marker (ตรงกับ part.type จาก worker)
     * @param {MarkerHandler} handler
     * @returns {MarkerRegistry}       — ตัวเองสำหรับ chaining
     */
    register(type, handler) {
      if (!type || typeof handler?.createNode !== 'function') {
        console.warn('[MarkerRegistry] register() ต้องการ type string และ handler.createNode function');
        return this;
      }
      this._handlers.set(type, handler);
      return this;
    },
    
    /**
     * สร้าง DOM node จาก part object
     * ถ้า type ไม่รู้จัก → คืน empty text node (ไม่ throw)
     *
     * @param {Object}     part  — { type, ...props } จาก worker
     * @param {MarkerRefs} refs  — resolvers สำหรับ existing elements
     * @returns {Node}
     */
    createNode(part, refs) {
      const handler = this._handlers.get(part.type);
      if (!handler) {
        console.warn('[MarkerRegistry] ไม่รู้จัก marker type:', part.type);
        return document.createTextNode('');
      }
      try {
        return handler.createNode(part, refs);
      } catch (e) {
        console.error('[MarkerRegistry] Error in handler "' + part.type + '":', e);
        return document.createTextNode('');
      }
    },
    
    /**
     * ตรวจว่า type ถูก register ไว้หรือไม่
     * @param {string} type
     * @returns {boolean}
     */
    has(type) {
      return this._handlers.has(type);
    },
    
    /**
     * คืน list ของทุก registered types
     * @returns {string[]}
     */
    getTypes() {
      return Array.from(this._handlers.keys());
    },
  };
  
  // ── Built-in handlers ─────────────────────────────────────────────────────
  // (ลำดับไม่สำคัญ — แต่เรียงตาม complexity จากน้อยไปมาก)
  
  // text — สร้าง text node ธรรมดา
  MarkerRegistry.register('text', {
    createNode: (part) => document.createTextNode(part.text || ''),
  });
  
  // br — <br> element
  MarkerRegistry.register('br', {
    createNode: () => document.createElement('br'),
  });
  
  // strong — <strong> พร้อม text content
  MarkerRegistry.register('strong', {
    createNode: (part) => {
      const el = document.createElement('strong');
      el.textContent = part.text || '';
      return el;
    },
  });
  
  // a — <a> element: พยายาม reuse anchor เดิม ถ้าไม่มีค่อยสร้างใหม่
  MarkerRegistry.register('a', {
    createNode: (part, refs) => {
      // refs.resolveAnchor(null) = คืน anchor แรกที่ยังไม่ถูกใช้
      const existing = refs.resolveAnchor(null);
      if (existing) {
        if (part.translate && part.text != null)
          existing.textContent = part.text;
        return existing;
      }
      const a = document.createElement('a');
      if (part.translate) a.textContent = part.text || '';
      return a;
    },
  });
  
  // svg + lsvg — reuse existing SVG หรือสร้าง placeholder
  // (ทั้งคู่ทำงานเหมือนกัน: หา SVG element เดิมใน DOM)
  const svgHandler = {
    createNode: (part, refs) => refs.resolveSvg(part.id) || _createEmptySvg(part.id),
  };
  MarkerRegistry.register('svg', svgHandler);
  MarkerRegistry.register('lsvg', svgHandler);
  
  // slot — reuse existing slot element หรือสร้าง <span> placeholder
  MarkerRegistry.register('slot', {
    createNode: (part, refs) => {
      const existing = refs.resolveSlot(part.name);
      if (existing) return existing;
      const span = document.createElement('span');
      span.setAttribute('data-translate-slot', part.name || 'slot');
      return span;
    },
  });
  
  // ── Private helpers ───────────────────────────────────────────────────────
  
  /**
   * สร้าง SVG placeholder เปล่า (ใช้เมื่อหา SVG เดิมไม่เจอ)
   * @param {string|null} id
   * @returns {SVGElement}
   */
  function _createEmptySvg(id) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    if (id) {
      svg.setAttribute('id', id);
      svg.setAttribute('data-svg-id', id);
    }
    return svg;
  }
  
  M.MarkerRegistry = MarkerRegistry;
  
})(window.LangModules = window.LangModules || {});