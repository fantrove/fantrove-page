// unifiedCopyToClipboard.js
// ✅ ปรับปรุง: Optimized indexing, memoization
import dataManager from './dataManager.js';
import { showNotification } from './utils.js';

export async function unifiedCopyToClipboard(copyInfo = {}) {
    const lang = localStorage.getItem('selectedLang') || 'en';
    try {
        if (!copyInfo || !copyInfo.text) throw new Error('No content to copy');
        await navigator.clipboard.writeText(copyInfo.text);

        let notificationParams = { text: copyInfo.text, name: "", typeId: "emoji", lang };

        const db = await dataManager.loadApiDatabase();

        if (!dataManager._copyIndex) {
            const textMap = new Map();
            const emojiMap = new Map();
            const apiMap = new Map();
            const symbolMap = new Map();

            function buildIndex(obj) {
                if (Array.isArray(obj)) {
                    obj.forEach(item => buildIndex(item));
                } else if (typeof obj === 'object' && obj !== null) {
                    if (obj.text) {
                        textMap.set(obj.text, obj);
                        const normalized = obj.text.trim().toLowerCase();
                        if (normalized.length === 1) emojiMap.set(normalized, obj);
                        if (normalized.length > 1) symbolMap.set(normalized, obj);
                    }
                    if (obj.api) apiMap.set(obj.api, obj);
                    if (obj.name) {
                        const nameNorm = (obj.name[lang] || obj.name.en || "").trim().toLowerCase();
                        if (nameNorm) symbolMap.set(nameNorm, obj);
                    }
                    for (const key in obj) {
                        if (Object.prototype.hasOwnProperty.call(obj, key)) {
                            buildIndex(obj[key]);
                        }
                    }
                }
            }

            try { buildIndex(db?.type || db); } catch (e) {}
            dataManager._copyIndex = { textMap, emojiMap, apiMap, symbolMap };
        }

        const { textMap, emojiMap, apiMap, symbolMap } = dataManager._copyIndex;

        function findTypeIdAndName(obj, code, parentTypeId) {
            if (Array.isArray(obj)) {
                for (const item of obj) {
                    const result = findTypeIdAndName(item, code, parentTypeId);
                    if (result) return result;
                }
            } else if (typeof obj === 'object' && obj !== null) {
                if (obj.api === code) {
                    return { typeId: parentTypeId, name: obj.name?.[lang] || obj.name?.en || obj.api || "" };
                }
                let newParentTypeId = parentTypeId;
                if (obj.id && obj.category && Array.isArray(obj.category)) {
                    newParentTypeId = obj.id;
                }
                for (const key in obj) {
                    if (Object.prototype.hasOwnProperty.call(obj, key)) {
                        const result = findTypeIdAndName(obj[key], code, newParentTypeId);
                        if (result) return result;
                    }
                }
            }
            return null;
        }

        if (copyInfo.api) {
            const apiNode = (dataManager._copyIndex && dataManager._copyIndex.apiMap)
                ? dataManager._copyIndex.apiMap.get(copyInfo.api)
                : null;
            let typeId = "emoji";
            let name = "";
            const typeResult = findTypeIdAndName(db?.type || db, copyInfo.api, "emoji");
            if (typeResult) {
                typeId = typeResult.typeId || "emoji";
                name = typeResult.name;
            } else if (apiNode) {
                name = apiNode.name?.[lang] || apiNode.name?.en || apiNode.api;
            }
            notificationParams = { text: apiNode?.text || copyInfo.text, name: name ? `${name}` : apiNode?.api || copyInfo.api, typeId, lang };
        } else {
            let node = textMap.get(copyInfo.text) || emojiMap.get(copyInfo.text.trim().toLowerCase()) || null;

            if (!node) {
                const norm = copyInfo.text.trim().toLowerCase();
                node = textMap.get(norm) || emojiMap.get(norm) || symbolMap.get(norm) || null;
            }

            if (!node) {
                for (let [key, value] of textMap) {
                    if (key.trim().toLowerCase() === copyInfo.text.trim().toLowerCase()) {
                        node = value; break;
                    }
                }
                if (!node) {
                    for (let [key, value] of emojiMap) {
                        if (key === copyInfo.text.trim().toLowerCase()) {
                            node = value; break;
                        }
                    }
                }
            }

            if (node) {
                let typeId = "emoji";
                let name = "";
                let text = node.text || copyInfo.text;
                function getTypeFromParent(obj, targetNode, parentTypeId) {
                    if (Array.isArray(obj)) {
                        for (const item of obj) {
                            const result = getTypeFromParent(item, targetNode, parentTypeId);
                            if (result) return result;
                        }
                    } else if (typeof obj === 'object' && obj !== null) {
                        if (obj === targetNode) return parentTypeId;
                        let newParentTypeId = parentTypeId;
                        if (obj.id && obj.category && Array.isArray(obj.category)) {
                            newParentTypeId = obj.id;
                        }
                        for (const key in obj) {
                            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                                const result = getTypeFromParent(obj[key], targetNode, newParentTypeId);
                                if (result) return result;
                            }
                        }
                    }
                    return null;
                }
                typeId = getTypeFromParent(db?.type || db, node, "emoji") || "emoji";
                name = node.name?.[lang] || node.name?.en || "";
                notificationParams = { text, name: name ? `${name}` : "", typeId, lang };
            } else {
                notificationParams = { text: copyInfo.text, name: copyInfo.text || "", typeId: "special-characters", lang };
            }
        }

        if (typeof window.showCopyNotification === "function") {
            window.showCopyNotification(notificationParams);
        } else {
            window._headerV2_utils.showNotification(notificationParams.text, "success", { duration: 2200 });
        }

    } catch (error) {
        window._headerV2_utils.showNotification(error.message || 'Copy failed', 'error');
    }
}

export default unifiedCopyToClipboard;