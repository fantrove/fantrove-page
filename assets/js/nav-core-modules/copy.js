// @ts-check
/**
 * @file copy.js
 * CopyService — unified clipboard handler.
 *
 * Uses DataService._sharedIndex for O(1) lookups:
 *   apiMap       → text + type by API code
 *   textMap      → type by text content
 *   catToTypeMap → type name by category
 *
 * No private index is built here — the shared index from data.js is reused,
 * eliminating a second DB walk and extra memory.
 *
 * @module copy
 * @depends {config.js, state.js, utils.js, data.js}
 */
(function(M) {
  'use strict';
  
  // ── Type resolution helpers ────────────────────────────────────────────────────
  
  /**
   * Resolve the type ID for a node using catToTypeMap (O(categories)).
   * Caches the result on the node itself for subsequent calls.
   * @param {any} node
   * @returns {string}
   */
  function _getTypeId(node) {
    try {
      const idx = M.DataService?._sharedIndex;
      if (!idx) return 'emoji';
      if (node._typeId) return node._typeId; // cached on node
      
      for (const [catId, typeObj] of idx.catToTypeMap) {
        const cat = (typeObj.category || []).find(c => c.id === catId);
        if (cat && Array.isArray(cat.data) && cat.data.includes(node)) {
          node._typeId = typeObj.id;
          return typeObj.id;
        }
      }
      return 'emoji';
    } catch (_) { return 'emoji'; }
  }
  
  /**
   * Resolve the type ID for a given API code via O(1) apiMap lookup.
   * @param {string} apiCode
   * @returns {string}
   */
  function _getTypeForApi(apiCode) {
    try {
      const idx = M.DataService?._sharedIndex;
      if (!idx) return 'emoji';
      const node = idx.apiMap.get(apiCode);
      return node ? _getTypeId(node) : 'emoji';
    } catch (_) { return 'emoji'; }
  }
  
  // ── CopyService ───────────────────────────────────────────────────────────────
  
  const CopyService = {
    
    /**
     * Copy text to clipboard, then show a copy notification.
     *
     * @param {{text?:string, api?:string, type?:string, name?:string}} [copyInfo]
     * @returns {Promise<void>}
     */
    async copy(copyInfo = {}) {
      const lang = localStorage.getItem('selectedLang') || 'en';
      
      try {
        if (!copyInfo || !copyInfo.text) throw new Error('No content to copy');
        await navigator.clipboard.writeText(copyInfo.text);
        
        // Ensure DB + shared index are ready
        const db = await M.DataService.loadApiDatabase();
        if (!M.DataService._sharedIndex && M.DataService._sharedIndexPromise)
          await M.DataService._sharedIndexPromise;
        
        const idx = M.DataService._sharedIndex;
        
        /** @type {{text:string, name:string, typeId:string, lang:string}} */
        let params = { text: copyInfo.text, name: '', typeId: 'emoji', lang };
        
        if (copyInfo.api) {
          // O(1) API lookup
          const apiNode = idx?.apiMap?.get(copyInfo.api);
          const typeId = _getTypeForApi(copyInfo.api);
          const name = apiNode?.name?.[lang] || apiNode?.name?.en || apiNode?.api || copyInfo.api;
          params = {
            text: apiNode?.text || copyInfo.text,
            name: name ? `${name}` : copyInfo.api,
            typeId,
            lang,
          };
        } else {
          // O(1) text lookup
          const node = idx?.textMap?.get(copyInfo.text) ||
            idx?.textMap?.get(copyInfo.text.trim().toLowerCase()) ||
            null;
          
          if (node) {
            const typeId = _getTypeId(node);
            const name = node.name?.[lang] || node.name?.en || '';
            params = { text: node.text || copyInfo.text, name: name || '', typeId, lang };
          } else {
            params = {
              text: copyInfo.text,
              name: copyInfo.text || '',
              typeId: 'special-characters',
              lang,
            };
          }
        }
        
        // Dispatch to notification system
        if (typeof window.showCopyNotification === 'function') {
          window.showCopyNotification(params);
        } else {
          M.Utils.showNotification(params.text, 'success', { duration: 2200 });
        }
        
      } catch (error) {
        M.Utils.showNotification(error.message || 'Copy failed', 'error');
      }
    },
  };
  
  // ── Export ────────────────────────────────────────────────────────────────────
  
  M.CopyService = CopyService;
  
  // Global convenience function — same public API as before
  window.unifiedCopyToClipboard = (info) => CopyService.copy(info);
  
})(window.NavCoreModules = window.NavCoreModules || {});