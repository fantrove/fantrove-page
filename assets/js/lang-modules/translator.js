// @ts-check
/**
 * @file translator.js
 * TranslatorService — Translation engine หลักของระบบ
 *
 * การปรับปรุง v4.0:
 *  - _replaceDOMWithMarkerReplace (เดิม 200+ บรรทัด) แตกออกเป็น 4 functions:
 *
 *     ┌─────────────────────────────────────────────┐
 *     │  _replaceDOMWithMarkerReplace(el, parts)    │  ← entry point
 *     │   │                                         │
 *     │   ├─ _normalizeParts(parts)                 │  merge text+html buffers
 *     │   ├─ _buildRefs(el)                         │  สร้าง resolver closures
 *     │   ├─ _partsToPreNodes(normalized)           │  part → pre-node (simple types)
 *     │   └─ _reconcile(el, preNodes, refs)         │  DOM diff + update
 *     └─────────────────────────────────────────────┘
 *
 *  - _createSimpleNode ใช้ MarkerRegistry (br, strong, a fallback)
 *    ทำให้เพิ่ม marker ใหม่ไม่ต้องแก้ translator.js
 *
 *  - WORKER_CODE: เพิ่ม module-level regex constants
 *    (สร้างครั้งเดียวต่อ worker instance)
 *
 * โครงสร้าง pre-node array (input ให้ _reconcile):
 *   DOM Node          — text node, br, strong, html-parsed nodes
 *   { __marker, ... } — SVG / lSVG / slot / anchor markers
 *                       (resolve ขณะ reconcile เพื่อรักษา insertion order)
 *
 * @module translator
 * @depends {config.js, state.js, worker-pool.js, markers.js}
 */
(function (M) {
  'use strict';

  // ── Worker source code ────────────────────────────────────────────────────
  /**
   * รันใน Web Worker context (ไม่มีเข้าถึง DOM)
   * หน้าที่: parse translation string ที่มี markers → คืน parts array
   *
   * Optimization v4.0:
   *   HTML_TAG_RE  — สร้างครั้งเดียวต่อ worker instance
   *   MARKER_RE_SRC — template string (new RegExp ต่อ call เพราะต้องการ g flag + reset lastIndex)
   *
   * Built-in markers:
   *   @lsvg[:id]@  — local SVG reference
   *   @svg[:id]@   — external SVG reference
   *   @slot:name@  — slot content placeholder
   *   @a...@       — anchor element
   *   @br          — line break
   *   @strong...@  — bold text
   */
  const WORKER_CODE = `
    // สร้าง regex constants ครั้งเดียวต่อ worker instance
    const HTML_TAG_RE   = /(<\\/?[^>]+>)/;
    const MARKER_RE_SRC =
      '(@lsvg(?::([^@]+))?@)' +
      '|(@svg(?::([^@]+))?@)' +
      '|(@slot:([^@]+)@)'     +
      '|(@a(.*?)@)'           +
      '|(@br)'                +
      '|(@strong(.*?)@)';

    function splitMarkersAndHtml(str) {
      const htmlParts   = str.split(HTML_TAG_RE);
      const parts       = [];
      const markerRegex = new RegExp(MARKER_RE_SRC, 'g');

      for (const segment of htmlParts) {
        if (!segment) continue;

        // HTML tag segment (จาก split capture group)
        if (/^<\\/?[^>]+>$/.test(segment)) {
          parts.push({ type: 'html', html: segment });
          continue;
        }

        // Text segment — scan สำหรับ markers
        let lastIndex = 0;
        let m;
        markerRegex.lastIndex = 0; // reset สำหรับ segment ใหม่

        while ((m = markerRegex.exec(segment)) !== null) {
          if (m.index > lastIndex)
            parts.push({ type: 'text', text: segment.slice(lastIndex, m.index) });

          if      (m[1])  parts.push({ type: 'lsvg',   id:        m[2] || null });
          else if (m[3])  parts.push({ type: 'svg',    id:        m[4] || null });
          else if (m[5])  parts.push({ type: 'slot',   name:      m[6] || null });
          else if (m[7])  parts.push({ type: 'a',      translate: (m[8] || '') !== '', text: m[8] || '' });
          else if (m[9])  parts.push({ type: 'br'  });
          else if (m[10]) parts.push({ type: 'strong', text:      m[11] || '' });

          lastIndex = markerRegex.lastIndex;
        }

        if (lastIndex < segment.length)
          parts.push({ type: 'text', text: segment.slice(lastIndex) });
      }
      return parts;
    }

    self.onmessage = function(e) {
      const { nodes, langData, batchIdx } = e.data;
      const result = nodes.map(({ key }, idx) => ({
        idx,
        parts: splitMarkersAndHtml(langData[key] || ''),
      }));
      self.postMessage({ batchIdx, result });
    };
  `;

  // ── TranslatorService ─────────────────────────────────────────────────────

  const TranslatorService = {

    // ── Pool initialization ───────────────────────────────────────────────────

    /**
     * สร้าง WorkerPool และเก็บไว้ใน State.workerPool
     * Workers จะถูกสร้างจริงตอนใช้งานครั้งแรก (lazy via WorkerPool)
     */
    initPool() {
      const { WorkerPool, State } = M;
      State.workerPool = new WorkerPool(WORKER_CODE, State.maxWorker);
    },

    // ── Translation ───────────────────────────────────────────────────────────

    /**
     * แปลหน้าทั้งหมดแบบ parallel โดยใช้ WorkerPool
     * แบ่ง elements เป็น batch ตามจำนวน worker
     *
     * @param {Object}    languageData  — flat key-value translation map
     * @param {Element[]} [elements]    — ถ้าไม่ส่ง จะ query [data-translate] ทั้งหมด
     */
    async parallelStreamingTranslate(languageData, elements) {
      const { State } = M;
      const elList = elements || Array.from(document.querySelectorAll('[data-translate]'));
      if (!elList.length) return;

      const chunkSize = Math.max(8, Math.ceil(elList.length / State.maxWorker));
      const batches   = [];
      const nodeMeta  = [];

      for (let i = 0; i < elList.length; i += chunkSize) {
        const batch = elList.slice(i, i + chunkSize);
        batches.push(batch);
        nodeMeta.push(batch.map(el => ({ key: el.getAttribute('data-translate') })));
      }

      const jobs    = nodeMeta.map((meta, i) =>
        State.workerPool.execute({ nodes: meta, langData: languageData, batchIdx: i })
      );
      const results = await Promise.all(jobs);

      for (let j = 0; j < results.length; j++) {
        const batch  = batches[j];
        const resArr = results[j].result;
        for (let k = 0; k < resArr.length; k++) {
          const el = batch[resArr[k].idx];
          if (el) this._replaceDOMWithMarkerReplace(el, resArr[k].parts);
        }
      }
    },

    // ── DOM replacement (main entry point) ───────────────────────────────────

    /**
     * อัพเดท DOM ของ element ด้วย translation parts จาก worker
     * Delegates ไปยัง 4 helper functions ด้านล่าง
     *
     * @param {Element}  el    — element ที่มี data-translate
     * @param {Object[]} parts — parts array จาก worker
     */
    _replaceDOMWithMarkerReplace(el, parts) {
      // 1. Merge consecutive text/html parts
      const normalized = _normalizeParts(parts);

      // 2. Build resolver closures สำหรับ SVG/slot/anchor
      const refs = _buildRefs(el);

      // 3. Convert parts → pre-nodes
      //    (simple types → DOM nodes, complex types → marker objects)
      const preNodes = _partsToPreNodes(normalized);

      // 4. Predicted SVG heuristic:
      //    ถ้าไม่มี explicit SVG marker ในการแปล แต่ element มี SVG อยู่
      //    → prepend marker เพื่อรักษา SVG ไว้ที่หน้า
      const hasExplicitSvg = preNodes.some(n => n?.__marker === 'svg' || n?.__marker === 'lsvg');
      if (!hasExplicitSvg && refs.svgs.length > 0) {
        preNodes.unshift({ __marker: 'lsvg', id: null, __predicted: true });
      }

      // 5. Reconcile: อัพเดท DOM ให้ตรงกับ preNodes
      _reconcile(el, preNodes, refs);
    },

    // ── Content management ────────────────────────────────────────────────────

    /**
     * บันทึก original content ก่อนแปล สำหรับ reset กลับเป็น English
     * เรียกครั้งเดียวตอน init
     */
    storeOriginalContent() {
      document.querySelectorAll('[data-translate]').forEach(el => {
        if (!el.hasAttribute('data-original-text'))
          el.setAttribute('data-original-text', el.textContent.trim());
        if (!el.hasAttribute('data-original-style'))
          el.setAttribute('data-original-style', el.style.cssText);
      });
    },

    /**
     * คืนค่า original content (English) โดย restore จาก data-original-text
     */
    async resetToEnglishContent() {
      document.querySelectorAll('[data-translate]').forEach(el => {
        const orig = el.getAttribute('data-original-text');
        if (orig !== null) el.textContent = orig;
        const origStyle = el.getAttribute('data-original-style');
        if (origStyle !== null) el.style.cssText = origStyle;
      });
    },

    // ── Mutation observer ─────────────────────────────────────────────────────

    /**
     * สังเกต DOM ที่เพิ่มเข้ามาหลัง init (dynamic content)
     * แปลให้อัตโนมัติถ้า selectedLang ไม่ใช่ English
     */
    observeMutations() {
      const { State } = M;

      if (State.mutationObserver) State.mutationObserver.disconnect();

      State.mutationObserver = new MutationObserver((mutations) => {
        if (State.mutationThrottleTimeout) return;

        State.mutationThrottleTimeout = setTimeout(() => {
          const added = [];
          mutations.forEach(mutation =>
            mutation.addedNodes.forEach(node => {
              if (node.nodeType !== Node.ELEMENT_NODE) return;
              const translatable = node.querySelectorAll('[data-translate]');
              if (!translatable.length) return;

              translatable.forEach(el => {
                if (!el.hasAttribute('data-original-text'))
                  el.setAttribute('data-original-text', el.textContent.trim());
              });
              added.push(...translatable);
            })
          );

          if (added.length && State.selectedLang !== 'en') {
            this.parallelStreamingTranslate(State.languageCache[State.selectedLang], added);
          }
          State.mutationThrottleTimeout = null;
        }, 100);
      });

      State.mutationObserver.observe(document.body, { childList: true, subtree: true });
    },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Private helper functions (module-level, not methods)
  // แต่ละ function มีหน้าที่เดียว — ทดสอบแยกได้
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Merge consecutive text/html parts เข้าด้วยกัน
   * ลด node count และ simplify reconcile
   *
   * ตัวอย่าง:
   *   [text:"Hello ", html:"<em>", text:"world"] → [html:"Hello <em>world"]
   *
   * @param {Object[]} parts
   * @returns {Object[]}
   */
  function _normalizeParts(parts) {
    const out = [];
    let buf       = '';
    let bufHasHtml = false;

    const flush = () => {
      if (!buf) return;
      out.push(bufHasHtml ? { type: 'html', html: buf } : { type: 'text', text: buf });
      buf = '';
      bufHasHtml = false;
    };

    for (const p of parts) {
      if (p.type === 'text' || p.type === 'html') {
        const str = p.type === 'text' ? (p.text || '') : (p.html || '');
        buf += str;
        if (p.type === 'html' || /<[^>]+>/.test(str)) bufHasHtml = true;
      } else {
        flush();
        out.push(p);
      }
    }
    flush();
    return out;
  }

  /**
   * สร้าง refs object ที่รวม:
   *   - ลิสต์ของ SVG/slot/anchor ที่มีอยู่ใน element
   *   - resolver functions ที่ track การใช้งาน (ป้องกัน reuse ซ้ำ)
   *   - snapshot ของ childNodes ก่อน reconcile
   *
   * @param {Element} el
   * @returns {Object} refs
   */
  function _buildRefs(el) {
    const svgs    = Array.from(el.querySelectorAll?.('svg') ?? []);
    const slots   = Array.from(el.querySelectorAll?.('[data-translate-slot],[data-slot]') ?? []);
    const anchors = Array.from(el.querySelectorAll?.('a') ?? []);
    const usedSvgs    = new Set();
    const usedSlots   = new Set();
    const usedAnchors = new Set();

    return {
      svgs,
      slots,
      anchors,
      /** snapshot ของ childNodes สำหรับ reconcile index tracking */
      existing: Array.from(el.childNodes),

      /**
       * หา SVG ที่ยังไม่ถูกใช้
       * ถ้า id ระบุ → หา SVG ที่ตรง id ก่อน, ถ้าไม่เจอ → คืน SVG แรก
       * @param {string|null} id
       * @returns {SVGElement|null}
       */
      resolveSvg(id) {
        const pool = svgs.filter(s => !usedSvgs.has(s));
        let found  = null;

        if (id) {
          found = pool.find(s =>
            s.getAttribute?.('id') === id ||
            s.getAttribute?.('data-svg-id') === id ||
            s.dataset?.svgId === id
          ) || null;
        }
        if (!found && pool.length) found = pool[0];

        if (found) { usedSvgs.add(found); return found; }
        return null;
      },

      /**
       * หา slot element ที่ยังไม่ถูกใช้
       * ถ้า name ระบุ → หา slot ที่ตรง name
       * ถ้า name=null และมีแค่ 1 slot → คืน slot นั้น
       * @param {string|null} name
       * @returns {Element|null}
       */
      resolveSlot(name) {
        const pool = slots.filter(s => !usedSlots.has(s));
        let found  = null;

        if (name) {
          found = pool.find(s =>
            s.getAttribute?.('data-translate-slot') === name ||
            s.getAttribute?.('data-slot') === name ||
            s.dataset?.translateSlot === name ||
            s.dataset?.slot === name
          ) || null;
        } else if (pool.length === 1) {
          found = pool[0];
        }

        if (found) { usedSlots.add(found); return found; }
        return null;
      },

      /**
       * หา anchor ที่ยังไม่ถูกใช้
       * @param {string|null} hint  — id hint หรือ null สำหรับ first-available
       * @returns {HTMLAnchorElement|null}
       */
      resolveAnchor(hint) {
        const pool = anchors.filter(a => !usedAnchors.has(a));
        let found  = null;

        if (hint) {
          found = pool.find(a =>
            a.getAttribute?.('id') === hint ||
            a.getAttribute?.('data-anchor-id') === hint ||
            a.dataset?.anchorId === hint
          ) || null;
        }
        if (!found && pool.length) found = pool[0];

        if (found) { usedAnchors.add(found); return found; }
        return null;
      },
    };
  }

  /**
   * แปลง normalized parts → pre-node array
   *
   * Simple types (text, br, strong, html) → สร้าง DOM node ทันที
   * Complex types (svg, lsvg, slot, a)    → เก็บเป็น marker object
   *   { __marker: 'svg'|'lsvg'|'slot'|'a', ...props }
   *   complex types resolve ใน _reconcile เพื่อรักษา insertion order ที่ถูกต้อง
   *
   * @param {Object[]} normalized
   * @returns {Array<Node|Object>}
   */
  function _partsToPreNodes(normalized) {
    const { MarkerRegistry } = M;
    const domParser = new DOMParser();
    const nodes     = [];

    for (const p of normalized) {
      switch (p.type) {

        case 'text':
          nodes.push(document.createTextNode(p.text || ''));
          break;

        case 'html': {
          const html = (p.html || '').trim();
          if (!html) break;

          // Inline SVG → parse properly
          if (/\<svg[\s>]/i.test(html)) {
            try {
              const doc  = domParser.parseFromString(html, 'image/svg+xml');
              const root = doc.documentElement;
              if (root && root.nodeName !== 'parsererror') {
                nodes.push(document.importNode(root, true));
                break;
              }
            } catch (e) {}
          }

          // General HTML → template parse
          const tpl = document.createElement('template');
          tpl.innerHTML = html;
          const cloned = tpl.content.cloneNode(true);
          nodes.push(...cloned.childNodes);
          break;
        }

        case 'br':
          nodes.push(MarkerRegistry.createNode(p, _EMPTY_REFS));
          break;

        case 'strong':
          nodes.push(MarkerRegistry.createNode(p, _EMPTY_REFS));
          break;

        // Complex types: defer resolution ไปยัง _reconcile
        case 'svg':
        case 'lsvg':
          nodes.push({ __marker: p.type, id: p.id || null });
          break;

        case 'slot':
          nodes.push({ __marker: 'slot', name: p.name || null });
          break;

        case 'a':
          nodes.push({ __marker: 'a', translate: p.translate, text: p.text || '' });
          break;

        default:
          // Custom marker types — delegate ไปยัง MarkerRegistry
          // (resolve ด้วย empty refs ก่อน — custom markers ไม่ต้องการ existing elements)
          if (MarkerRegistry.has(p.type))
            nodes.push(MarkerRegistry.createNode(p, _EMPTY_REFS));
          break;
      }
    }

    return nodes;
  }

  /**
   * Empty refs object สำหรับ markers ที่ไม่ต้องการ existing elements
   * (br, strong, custom markers ที่ไม่ reuse DOM)
   */
  const _EMPTY_REFS = {
    svgs: [], slots: [], anchors: [], existing: [],
    resolveSvg:    () => null,
    resolveSlot:   () => null,
    resolveAnchor: () => null,
  };

  /**
   * Reconcile DOM ปัจจุบันกับ preNodes ที่ต้องการ
   *
   * กลยุทธ์:
   *   - Reuse node เดิมถ้า type ตรงกัน (avoid createElement/removeChild)
   *   - Patch in-place ถ้า tag เดิมตรงกัน (innerHTML/attributes)
   *   - Resolve SVG/slot/anchor จาก refs ระหว่าง loop
   *   - ไม่ลบ SVG หรือ slot ที่ไม่ได้อ้างถึง (preserve)
   *
   * @param {Element}          el
   * @param {Array<Node|Object>} preNodes  — output จาก _partsToPreNodes
   * @param {Object}           refs
   */
  function _reconcile(el, preNodes, refs) {
    const existing   = refs.existing;
    let   readIndex  = 0;

    for (let i = 0; i < preNodes.length; i++) {
      const pre     = preNodes[i];
      let   currOld = existing[readIndex];

      // ── Predicted SVG marker ─────────────────────────────────────────────
      // Prepend SVG ที่มีอยู่ไปด้านหน้า (ไม่กิน readIndex slot)
      if (pre?.__marker && pre.__predicted) {
        const svgRef = refs.resolveSvg(pre.id);
        if (svgRef && el.firstChild !== svgRef) {
          try { el.insertBefore(svgRef, el.firstChild); } catch (e) {}
          const idx = existing.indexOf(svgRef);
          if (idx !== -1) existing.splice(idx, 1);
          existing.splice(0, 0, svgRef);
          if (readIndex === 0) readIndex = 1;
        }
        continue;
      }

      // ── SVG marker ───────────────────────────────────────────────────────
      if (pre?.__marker === 'svg' || pre?.__marker === 'lsvg') {
        const svgRef = refs.resolveSvg(pre.id);
        if (svgRef) {
          _insertAtIndex(el, svgRef, currOld, existing, readIndex);
          readIndex++;
        } else {
          const ns  = 'http://www.w3.org/2000/svg';
          const svg = document.createElementNS(ns, 'svg');
          if (pre.id) { svg.setAttribute('id', pre.id); svg.setAttribute('data-svg-id', pre.id); }
          _insertNode(el, svg, currOld);
          existing.splice(readIndex, 0, svg);
          readIndex++;
        }
        continue;
      }

      // ── Slot marker ──────────────────────────────────────────────────────
      if (pre?.__marker === 'slot') {
        const slotEl = refs.resolveSlot(pre.name);
        if (slotEl) {
          _insertAtIndex(el, slotEl, currOld, existing, readIndex);
          readIndex++;
        } else {
          const span = document.createElement('span');
          span.setAttribute('data-translate-slot', pre.name || 'slot');
          _insertNode(el, span, currOld);
          existing.splice(readIndex, 0, span);
          readIndex++;
        }
        continue;
      }

      // ── Anchor marker ────────────────────────────────────────────────────
      if (pre?.__marker === 'a') {
        const anchorRef = refs.resolveAnchor(null);
        if (anchorRef) {
          _insertAtIndex(el, anchorRef, currOld, existing, readIndex);
          if (pre.translate && pre.text != null) anchorRef.textContent = pre.text;
          readIndex++;
        } else {
          const a = document.createElement('a');
          if (pre.translate) a.textContent = pre.text;
          _insertNode(el, a, currOld);
          existing.splice(readIndex, 0, a);
          readIndex++;
        }
        continue;
      }

      // ── Regular Node (DOM node จาก _partsToPreNodes) ─────────────────────
      if (!currOld) {
        // ไม่มี existing node → append
        try {
          el.appendChild(document.importNode(pre, true));
          existing.push(el.lastChild);
        } catch (e) {
          try { el.appendChild(pre.cloneNode(true)); existing.push(el.lastChild); } catch (e2) {}
        }
        readIndex++;
        continue;
      }

      // Skip existing SVG ที่ยังไม่ถูก consume (preserve)
      if (_isSvgEl(currOld)) { readIndex++; i--; continue; }

      // Skip existing slot ที่ยังไม่ถูก consume (preserve)
      if (_isSlotEl(currOld)) { readIndex++; i--; continue; }

      // Text ↔ Text: update in-place
      if (currOld.nodeType === Node.TEXT_NODE && pre.nodeType === Node.TEXT_NODE) {
        if (currOld.textContent !== pre.textContent)
          currOld.textContent = pre.textContent;
        readIndex++;
        continue;
      }

      // Element ↔ Element (same tag): patch attributes + children in-place
      if (
        currOld.nodeType === Node.ELEMENT_NODE &&
        pre.nodeType     === Node.ELEMENT_NODE &&
        currOld.tagName  === pre.tagName
      ) {
        // Replace children
        while (currOld.firstChild) currOld.removeChild(currOld.firstChild);
        Array.from(pre.childNodes).forEach(c => currOld.appendChild(document.importNode(c, true)));

        // Sync attributes
        const newAttrs = Array.from(pre.attributes || []);
        const oldAttrs = Array.from(currOld.attributes || []);
        newAttrs.forEach(a => { try { currOld.setAttribute(a.name, a.value); } catch (e) {} });
        oldAttrs.forEach(a => {
          if (!pre.hasAttribute(a.name))
            try { currOld.removeAttribute(a.name); } catch (e) {}
        });

        readIndex++;
        continue;
      }

      // Fallback: replace node
      try {
        el.replaceChild(document.importNode(pre, true), currOld);
        existing[readIndex] = el.childNodes[readIndex];
      } catch (e) {
        try {
          el.insertBefore(document.importNode(pre, true), currOld);
          el.removeChild(currOld);
          existing[readIndex] = el.childNodes[readIndex];
        } catch (e2) {}
      }
      readIndex++;
    }

    // ── Remove trailing nodes (except SVG and slot) ───────────────────────
    for (let j = el.childNodes.length - 1; j >= readIndex; j--) {
      const node = el.childNodes[j];
      if (!node) continue;
      if (_isSvgEl(node) || _isSlotEl(node)) continue; // preserve
      try { el.removeChild(node); } catch (e) {}
    }
  }

  // ── Reconcile micro-helpers ───────────────────────────────────────────────

  /**
   * ย้าย target node ไปยังตำแหน่ง readIndex
   * ถ้า node อยู่ในตำแหน่งนั้นแล้ว → ไม่ทำอะไร
   * @private
   */
  function _insertAtIndex(el, target, currOld, existing, readIndex) {
    if (currOld === target) return;
    try { el.insertBefore(target, currOld || null); } catch (e) {}
    const prev = existing.indexOf(target);
    if (prev !== -1) existing.splice(prev, 1);
    existing.splice(readIndex, 0, target);
  }

  /**
   * Insert node ก่อน reference (หรือ append ถ้า ref=null)
   * @private
   */
  function _insertNode(el, node, ref) {
    try {
      if (ref) el.insertBefore(node, ref);
      else     el.appendChild(node);
    } catch (e) {}
  }

  /** @param {Node} n @returns {boolean} */
  function _isSvgEl(n) {
    return n.nodeType === Node.ELEMENT_NODE &&
           n.tagName?.toLowerCase() === 'svg';
  }

  /** @param {Node} n @returns {boolean} */
  function _isSlotEl(n) {
    return n.nodeType === Node.ELEMENT_NODE &&
           n.hasAttribute?.('data-translate-slot') ||
           n.hasAttribute?.('data-slot');
  }

  M.TranslatorService = TranslatorService;

})(window.LangModules = window.LangModules || {});