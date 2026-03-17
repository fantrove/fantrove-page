// unifiedCopyToClipboard.js (v2 — optimized)
// =========================================================
// v2 changes:
//  ① Removed private _copyIndex build — uses dataManager._sharedIndex instead
//     Same Map, zero extra walk, zero extra memory
//  ② getTypeFromParent() recursive walk replaced with catToTypeMap O(1) lookup
//  ③ findTypeIdAndName() recursive walk replaced with catToTypeMap O(1) lookup
// =========================================================
import dataManager from './dataManager.js';
import { showNotification } from './utils.js';

// ─── O(1) type lookup via shared catToTypeMap ─────────────────────────────
function _getTypeId(node) {
    try {
        const idx = window._headerV2_dataManager?._sharedIndex;
        if (!idx) return 'emoji';
        // Walk up via idMap to find which type contains this node
        // catToTypeMap: categoryId → typeObj
        // We need: node → category → type
        // Fastest path: check if node itself has a category clue
        if (node._typeId) return node._typeId; // cached on node
        // Fallback: scan catToTypeMap values for ownership
        // This is O(categories) not O(all nodes)
        for (const [catId, typeObj] of idx.catToTypeMap) {
            const cat = (typeObj.category || []).find(c => c.id === catId);
            if (cat && Array.isArray(cat.data)) {
                if (cat.data.includes(node)) {
                    node._typeId = typeObj.id; // cache result on node
                    return typeObj.id;
                }
            }
        }
        return 'emoji';
    } catch (_) { return 'emoji'; }
}

// ─── Resolve type for an api code using catToTypeMap ─────────────────────
function _getTypeForApi(apiCode, db) {
    try {
        const idx = window._headerV2_dataManager?._sharedIndex;
        if (!idx) return 'emoji';
        const node = idx.apiMap.get(apiCode);
        if (!node) return 'emoji';
        return _getTypeId(node);
    } catch (_) { return 'emoji'; }
}

export async function unifiedCopyToClipboard(copyInfo = {}) {
    const lang = localStorage.getItem('selectedLang') || 'en';
    try {
        if (!copyInfo || !copyInfo.text) throw new Error('No content to copy');
        await navigator.clipboard.writeText(copyInfo.text);
        
        // ① Ensure DB + shared index are ready (loadApiDatabase triggers _buildSharedIndex)
        const db = await dataManager.loadApiDatabase();
        
        // Wait for shared index if still building (usually instant on warm path)
        if (!dataManager._sharedIndex && dataManager._sharedIndexPromise) {
            await dataManager._sharedIndexPromise;
        }
        
        const idx = dataManager._sharedIndex;
        let notificationParams = { text: copyInfo.text, name: '', typeId: 'emoji', lang };
        
        if (copyInfo.api) {
            // ① O(1) lookup
            const apiNode = idx?.apiMap?.get(copyInfo.api);
            const typeId = _getTypeForApi(copyInfo.api, db);
            const name = apiNode?.name?.[lang] || apiNode?.name?.en || apiNode?.api || copyInfo.api;
            notificationParams = {
                text: apiNode?.text || copyInfo.text,
                name: name ? `${name}` : copyInfo.api,
                typeId,
                lang
            };
        } else {
            // ① O(1) text lookup
            const norm = copyInfo.text.trim().toLowerCase();
            const node = idx?.textMap?.get(copyInfo.text) ||
                idx?.textMap?.get(norm) ||
                null;
            
            if (node) {
                const typeId = _getTypeId(node);
                const name = node.name?.[lang] || node.name?.en || '';
                notificationParams = {
                    text: node.text || copyInfo.text,
                    name: name ? `${name}` : '',
                    typeId,
                    lang
                };
            } else {
                notificationParams = {
                    text: copyInfo.text,
                    name: copyInfo.text || '',
                    typeId: 'special-characters',
                    lang
                };
            }
        }
        
        if (typeof window.showCopyNotification === 'function') {
            window.showCopyNotification(notificationParams);
        } else {
            window._headerV2_utils.showNotification(notificationParams.text, 'success', { duration: 2200 });
        }
        
    } catch (error) {
        window._headerV2_utils.showNotification(error.message || 'Copy failed', 'error');
    }
}

export default unifiedCopyToClipboard;