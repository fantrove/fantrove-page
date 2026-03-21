// @ts-check
/**
 * @file translator.js
 * TranslatorService — Translation engine หลักของระบบ
 *
 * หน้าที่:
 *  initPool()                    — สร้าง WorkerPool จาก WORKER_CODE
 *  parallelStreamingTranslate()  — แปลหน้าทั้งหมดแบบ parallel (ใช้ WorkerPool)
 *  _replaceDOMWithMarkerReplace() — อัพเดท DOM nodes ด้วย translation parts
 *  _createMarkerNode()           — สร้าง DOM node จาก marker
 *  storeOriginalContent()        — บันทึก original content ก่อนแปล
 *  resetToEnglishContent()       — คืนค่า original content (English)
 *  observeMutations()            — ดู dynamic content ที่เพิ่มเข้ามาหลัง init
 *
 * @module translator
 * @depends {config.js, state.js, worker-pool.js}
 */
(function (M) {
  'use strict';

  // ── Worker source code ────────────────────────────────────────────────────
  // Worker code นี้รันใน Web Worker context (ไม่มีเข้าถึง DOM)
  // ทำหน้าที่ parse translation string ที่มี markers พิเศษ
  const WORKER_CODE = `
    function splitMarkersAndHtml(str) {
      const htmlSplit = str.split(/(<\\/?[^>]+>)/g);
      const parts = [];
      const markerRegex = /(@lsvg(?::([^@]+))?@)|(@svg(?::([^@]+))?@)|(@slot:([^@]+)@)|(@a(.*?)@)|(@br)|(@strong(.*?)@)/g;
      for (let segment of htmlSplit) {
        if (!segment) continue;
        if (/^<\\/?[^>]+>$/.test(segment)) {
          parts.push({ type: 'html', html: segment });
        } else {
          let lastIndex = 0;
          let m;
          while ((m = markerRegex.exec(segment)) !== null) {
            if (m.index > lastIndex) {
              parts.push({ type: 'text', text: segment.slice(lastIndex, m.index) });
            }
            if (m[1]) {
              parts.push({ type: 'lsvg', id: m[2] || null });
            } else if (m[3]) {
              parts.push({ type: 'svg', id: m[4] || null });
            } else if (m[5]) {
              parts.push({ type: 'slot', name: m[6] || null });
            } else if (m[7]) {
              const inner = m[8] || '';
              parts.push({ type: 'a', translate: inner !== '', text: inner });
            } else if (m[9]) {
              parts.push({ type: 'br' });
            } else if (m[10]) {
              parts.push({ type: 'strong', text: m[11] || '' });
            }
            lastIndex = markerRegex.lastIndex;
          }
          if (lastIndex < segment.length) {
            parts.push({ type: 'text', text: segment.slice(lastIndex) });
          }
        }
      }
      return parts;
    }
    self.onmessage = function(e) {
      const { nodes, langData, batchIdx } = e.data;
      const result = [];
      for (let i = 0; i < nodes.length; i++) {
        const { key } = nodes[i];
        const translation = langData[key] || '';
        const parts = splitMarkersAndHtml(translation);
        result.push({ idx: i, parts });
      }
      self.postMessage({ batchIdx, result });
    };
  `;

  // ── TranslatorService ─────────────────────────────────────────────────────
  const TranslatorService = {

    // ── Pool initialization ───────────────────────────────────────────────────

    /**
     * สร้าง WorkerPool และเก็บไว้ใน State.workerPool
     * เรียกครั้งเดียวตอน boot
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
     * @param {Object} languageData   — flat key-value translation map
     * @param {Element[]} [elements]  — ถ้าไม่ส่ง จะ query [data-translate] ทั้งหมด
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

      for (let j = 0; j < results.length; ++j) {
        const batch  = batches[j];
        const resArr = results[j].result;
        for (let k = 0; k < resArr.length; ++k) {
          const el = batch[resArr[k].idx];
          if (!el) continue;
          this._replaceDOMWithMarkerReplace(el, resArr[k].parts);
        }
      }
    },

    // ── DOM replacement ───────────────────────────────────────────────────────

    /**
     * อัพเดท DOM nodes ใน element ด้วย translation parts จาก worker
     * รักษา SVG, slot, anchor nodes เดิมไว้ ไม่ recreate
     *
     * @param {Element}  el    — element ที่มี data-translate
     * @param {Object[]} parts — parts array จาก worker (text/html/svg/slot/a/br/strong)
     */
    _replaceDOMWithMarkerReplace(el, parts) {
      // ── Normalize: merge consecutive text/html into single parts ─────────────
      const normalized  = [];
      let   buffer      = '';
      let   bufferHasHtml = false;

      const pushBuffer = () => {
        if (!buffer) return;
        if (bufferHasHtml) normalized.push({ type: 'html', html: buffer });
        else               normalized.push({ type: 'text', text: buffer });
        buffer       = '';
        bufferHasHtml = false;
      };

      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.type === 'text' || p.type === 'html') {
          if (!buffer) {
            buffer       = (p.type === 'text') ? (p.text || '') : (p.html || '');
            bufferHasHtml = (p.type === 'html') || /<[^>]+>/.test(buffer);
          } else {
            buffer       += (p.type === 'text') ? (p.text || '') : (p.html || '');
            if (p.type === 'html' || /<[^>]+>/.test(p.text || '')) bufferHasHtml = true;
          }
        } else {
          pushBuffer();
          normalized.push(p);
        }
      }
      pushBuffer();

      // ── Build new node list ──────────────────────────────────────────────────
      const newNodes = [];
      const domParser = new DOMParser();
      let   containsExplicitSvgOrLsvg = false;

      normalized.forEach(p => {
        if (p.type === 'text') {
          newNodes.push(document.createTextNode(p.text));
        } else if (p.type === 'html') {
          const htmlStr = (p.html || '').trim();
          if (!htmlStr) return;
          if (/\<svg[\s>]/i.test(htmlStr)) {
            try {
              const svgDoc  = domParser.parseFromString(htmlStr, 'image/svg+xml');
              const svgRoot = svgDoc.documentElement &&
                              svgDoc.documentElement.nodeName !== 'parsererror'
                              ? svgDoc.documentElement : null;
              if (svgRoot) {
                newNodes.push(document.importNode(svgRoot, true));
                containsExplicitSvgOrLsvg = true;
                return;
              }
            } catch (e) {}
          }
          const tpl = document.createElement('template');
          tpl.innerHTML = htmlStr;
          Array.from(tpl.content.cloneNode(true).childNodes).forEach(n => newNodes.push(n));
        } else if (p.type === 'svg') {
          newNodes.push({ __svgMarker: true, id: p.id || null });
          containsExplicitSvgOrLsvg = true;
        } else if (p.type === 'lsvg') {
          newNodes.push({ __svgMarker: true, lsvg: true, id: p.id || null });
          containsExplicitSvgOrLsvg = true;
        } else if (p.type === 'slot') {
          newNodes.push({ __slotMarker: true, name: p.name || null });
        } else {
          newNodes.push(this._createMarkerNode(p));
        }
      });

      // ── Predict SVG ─────────────────────────────────────────────────────────
      const existingSvgsAll = Array.from(el.querySelectorAll ? el.querySelectorAll('svg') : []).slice();
      if (!containsExplicitSvgOrLsvg && existingSvgsAll.length > 0) {
        newNodes.unshift({ __svgMarker: true, lsvg: true, id: null, __predicted: true });
      }

      // ── Prepare existing node references ────────────────────────────────────
      const existing         = Array.from(el.childNodes);
      const existingSvgs     = existingSvgsAll.slice();
      const existingSlotsAll = Array.from(el.querySelectorAll ?
        el.querySelectorAll('[data-translate-slot],[data-slot]') : []).slice();
      const existingAnchorsAll = Array.from(el.querySelectorAll ?
        el.querySelectorAll('a') : []).slice();
      const usedSvgs    = new Set();
      const usedSlots   = new Set();
      const usedAnchors = new Set();

      // ── Resolvers ─────────────────────────────────────────────────────────────
      const resolveSvg = (id) => {
        if (id) {
          for (const s of existingSvgs) {
            if (usedSvgs.has(s)) continue;
            if ((s.getAttribute && s.getAttribute('id') === id) ||
                (s.getAttribute && s.getAttribute('data-svg-id') === id) ||
                (s.dataset && s.dataset.svgId === id)) {
              usedSvgs.add(s); return s;
            }
          }
        }
        const avail = existingSvgs.filter(s => !usedSvgs.has(s));
        if (avail.length) { usedSvgs.add(avail[0]); return avail[0]; }
        return null;
      };

      const resolveSlot = (name) => {
        if (name) {
          for (const s of existingSlotsAll) {
            if (usedSlots.has(s)) continue;
            if ((s.getAttribute && s.getAttribute('data-translate-slot') === name) ||
                (s.getAttribute && s.getAttribute('data-slot') === name) ||
                (s.dataset && (s.dataset.translateSlot === name || s.dataset.slot === name))) {
              usedSlots.add(s); return s;
            }
          }
        }
        const avail = existingSlotsAll.filter(s => !usedSlots.has(s));
        if (!name && avail.length === 1) { usedSlots.add(avail[0]); return avail[0]; }
        return null;
      };

      const resolveAnchor = (newNode) => {
        const id = (newNode && newNode.getAttribute && newNode.getAttribute('id')) ||
                   (newNode && newNode.dataset && newNode.dataset.id) || null;
        if (id) {
          for (const a of existingAnchorsAll) {
            if (usedAnchors.has(a)) continue;
            if ((a.getAttribute && a.getAttribute('id') === id) ||
                (a.getAttribute && a.getAttribute('data-anchor-id') === id) ||
                (a.dataset && (a.dataset.anchorId === id || a.dataset.id === id))) {
              usedAnchors.add(a); return a;
            }
          }
        }
        const avail = existingAnchorsAll.filter(a => !usedAnchors.has(a));
        if (avail.length) { usedAnchors.add(avail[0]); return avail[0]; }
        return null;
      };

      // ── Main reconciliation loop ───────────────────────────────────────────
      let readIndex = 0;

      for (let i = 0; i < newNodes.length; i++) {
        const newNode   = newNodes[i];
        let   currentOld = existing[readIndex];

        // Slot marker
        if (newNode && newNode.__slotMarker) {
          const slotEl = resolveSlot(newNode.name);
          if (slotEl) {
            if (currentOld !== slotEl) {
              try { el.insertBefore(slotEl, currentOld || null); } catch (e) {}
              existing.splice(existing.indexOf(slotEl), 1);
              existing.splice(readIndex, 0, slotEl);
              currentOld = existing[readIndex];
            }
            readIndex++;
          } else {
            const span = document.createElement('span');
            if (newNode.name) span.setAttribute('data-translate-slot', newNode.name);
            else              span.setAttribute('data-translate-slot', 'slot');
            if (currentOld) el.insertBefore(span, currentOld);
            else            el.appendChild(span);
            existing.splice(readIndex, 0, span);
            readIndex++;
          }
          continue;
        }

        // SVG marker
        if (newNode && newNode.__svgMarker) {
          const svgRef = resolveSvg(newNode.id);
          if (svgRef) {
            if (newNode.__predicted) {
              try {
                if (el.firstChild !== svgRef) el.insertBefore(svgRef, el.firstChild);
                const idxOld = existing.indexOf(svgRef);
                if (idxOld !== -1) { existing.splice(idxOld, 1); existing.splice(0, 0, svgRef); }
                if (readIndex === 0) readIndex = 1;
              } catch (e) {}
              continue;
            }
            if (currentOld !== svgRef) {
              try { el.insertBefore(svgRef, currentOld || null); } catch (e) {}
              const prev = existing.indexOf(svgRef);
              if (prev !== -1) existing.splice(prev, 1);
              existing.splice(readIndex, 0, svgRef);
              currentOld = existing[readIndex];
            }
            readIndex++;
          } else {
            const ns         = 'http://www.w3.org/2000/svg';
            const createdSvg = document.createElementNS(ns, 'svg');
            if (newNode.id) {
              createdSvg.setAttribute('id', newNode.id);
              createdSvg.setAttribute('data-svg-id', newNode.id);
            }
            if (newNode.__predicted) {
              if (el.firstChild) el.insertBefore(createdSvg, el.firstChild);
              else               el.appendChild(createdSvg);
              existing.splice(0, 0, createdSvg);
              if (readIndex === 0) readIndex = 1;
            } else {
              if (currentOld) el.insertBefore(createdSvg, currentOld);
              else            el.appendChild(createdSvg);
              existing.splice(readIndex, 0, createdSvg);
              readIndex++;
            }
          }
          continue;
        }

        // Anchor node
        if (newNode && newNode.nodeType === 1 && newNode.tagName &&
            newNode.tagName.toLowerCase() === 'a') {
          const anchorRef = resolveAnchor(newNode);
          if (anchorRef) {
            if (currentOld !== anchorRef) {
              try { el.insertBefore(anchorRef, currentOld || null); } catch (e) {}
              const prev = existing.indexOf(anchorRef);
              if (prev !== -1) existing.splice(prev, 1);
              existing.splice(readIndex, 0, anchorRef);
              currentOld = existing[readIndex];
            }
            try {
              if (newNode.textContent != null && newNode.textContent !== '') {
                if (anchorRef.textContent !== newNode.textContent)
                  anchorRef.textContent = newNode.textContent;
              }
              Array.from(newNode.attributes || []).forEach(a => {
                try { anchorRef.setAttribute(a.name, a.value); } catch (e) {}
              });
            } catch (e) {}
            readIndex++;
          } else {
            if (currentOld) el.insertBefore(document.importNode(newNode, true), currentOld);
            else            el.appendChild(document.importNode(newNode, true));
            existing.splice(readIndex, 0, el.childNodes[readIndex]);
            readIndex++;
          }
          continue;
        }

        // Regular node replacement
        if (currentOld) {
          // Text ↔ Text
          if (currentOld.nodeType === Node.TEXT_NODE && newNode.nodeType === Node.TEXT_NODE) {
            if (currentOld.textContent !== newNode.textContent)
              currentOld.textContent = newNode.textContent;
            readIndex++;
            continue;
          }

          // Element ↔ Element (same tag: patch in-place)
          if (currentOld.nodeType === 1 && newNode.nodeType === 1) {
            try {
              if (currentOld.tagName === newNode.tagName) {
                while (currentOld.firstChild) currentOld.removeChild(currentOld.firstChild);
                Array.from(newNode.childNodes).forEach(c =>
                  currentOld.appendChild(document.importNode(c, true))
                );
                const newAttrs = Array.from(newNode.attributes || []);
                const oldAttrs = Array.from(currentOld.attributes || []);
                newAttrs.forEach(a => { try { currentOld.setAttribute(a.name, a.value); } catch (e) {} });
                oldAttrs.forEach(a => {
                  if (!newNode.hasAttribute(a.name))
                    try { currentOld.removeAttribute(a.name); } catch (e) {}
                });
                readIndex++;
                continue;
              }
            } catch (e) {}
          }

          // Skip over existing SVG / slot nodes (don't remove them)
          if (currentOld.nodeType === 1 && currentOld.tagName &&
              currentOld.tagName.toLowerCase() === 'svg') {
            readIndex++; i--; continue;
          }
          if (currentOld.nodeType === 1 && currentOld.hasAttribute &&
              (currentOld.hasAttribute('data-translate-slot') ||
               currentOld.hasAttribute('data-slot'))) {
            readIndex++; i--; continue;
          }

          // Replace
          try {
            el.replaceChild(document.importNode(newNode, true), currentOld);
            existing[readIndex] = el.childNodes[readIndex];
            readIndex++;
          } catch (e) {
            try {
              el.insertBefore(document.importNode(newNode, true), currentOld);
              el.removeChild(currentOld);
              existing[readIndex] = el.childNodes[readIndex];
              readIndex++;
            } catch (e2) { readIndex++; }
          }
        } else {
          // Append at end
          try {
            el.appendChild(document.importNode(newNode, true));
            existing.push(el.lastChild);
          } catch (e) {
            try { el.appendChild(newNode.cloneNode(true)); existing.push(el.lastChild); } catch (e2) {}
          }
          readIndex++;
        }
      }

      // ── Remove trailing nodes (ยกเว้น SVG และ slot) ─────────────────────────
      for (let j = el.childNodes.length - 1; j >= readIndex; j--) {
        const node = el.childNodes[j];
        if (!node) continue;
        if (node.nodeType === 1 && node.tagName && node.tagName.toLowerCase() === 'svg') continue;
        if (node.nodeType === 1 && node.hasAttribute &&
            (node.hasAttribute('data-translate-slot') || node.hasAttribute('data-slot'))) continue;
        try { el.removeChild(node); } catch (e) {}
      }
    },

    // ── Helper ────────────────────────────────────────────────────────────────

    /**
     * สร้าง DOM node จาก marker object
     * @param {Object} marker
     * @returns {Node}
     */
    _createMarkerNode(marker) {
      if (marker.type === 'text') return document.createTextNode(marker.text);
      if (marker.type === 'a') {
        const a = document.createElement('a');
        if (marker.translate) a.textContent = marker.text;
        return a;
      }
      if (marker.type === 'br')     return document.createElement('br');
      if (marker.type === 'strong') {
        const s = document.createElement('strong');
        s.textContent = marker.text;
        return s;
      }
      if (marker.type === 'html') {
        const tpl = document.createElement('template');
        tpl.innerHTML = marker.html || '';
        return tpl.content.cloneNode(true);
      }
      return document.createTextNode('');
    },

    // ── Content management ────────────────────────────────────────────────────

    /**
     * บันทึก original content (ก่อนแปล) สำหรับ reset กลับเป็น English
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
        if (orig) el.textContent = orig;
        const origStyle = el.getAttribute('data-original-style');
        if (origStyle) el.style.cssText = origStyle;
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

          mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
              if (node.nodeType === Node.ELEMENT_NODE) {
                const translatable = node.querySelectorAll('[data-translate]');
                if (translatable.length) {
                  added.push(...translatable);
                  translatable.forEach(el => {
                    if (!el.hasAttribute('data-original-text'))
                      el.setAttribute('data-original-text', el.textContent.trim());
                  });
                }
              }
            });
          });

          if (added.length && State.selectedLang !== 'en') {
            this.parallelStreamingTranslate(State.languageCache[State.selectedLang], added);
          }
          State.mutationThrottleTimeout = null;
        }, 100);
      });

      State.mutationObserver.observe(document.body, { childList: true, subtree: true });
    },
  };

  M.TranslatorService = TranslatorService;

})(window.LangModules = window.LangModules || {});