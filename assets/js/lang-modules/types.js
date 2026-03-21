// @ts-check
/**
 * @file types.js
 * Central typedef file — shared types สำหรับทุก lang-module
 * ไม่มี runtime code — load ก่อนทุก module
 *
 * @module types
 */

/**
 * ผลลัพธ์จาก DetectorService.resolveCurrentLang()
 * @typedef {Object} LangDecision
 * @property {string} lang                          — 'en' หรือ 'th'
 * @property {'url'|'storage'|'browser'} source    — แหล่งที่มาของการตัดสินใจ
 */

/**
 * Handler สำหรับ marker type หนึ่งๆ ลงทะเบียนผ่าน MarkerRegistry
 *
 * @typedef {Object} MarkerHandler
 * @property {function(Object, MarkerRefs): Node} createNode
 *   รับ part object จาก worker และ refs → คืน DOM node
 *
 * @example
 * // Custom @icon:name@ marker
 * MarkerRegistry.register('icon', {
 *   createNode: (part, refs) => {
 *     const i = document.createElement('i');
 *     i.className = `icon-${part.id}`;
 *     return i;
 *   },
 * });
 */

/**
 * Resolver functions สำหรับค้นหา existing DOM elements
 * ส่งเข้า MarkerHandler.createNode เพื่อ reuse elements เดิม
 *
 * @typedef {Object} MarkerRefs
 * @property {Element[]}                           svgs
 * @property {Element[]}                           slots
 * @property {HTMLAnchorElement[]}                 anchors
 * @property {Node[]}                              existing   — childNodes snapshot
 * @property {function(string|null): Element|null} resolveSvg
 * @property {function(string|null): Element|null} resolveSlot
 * @property {function(string|null): Element|null} resolveAnchor
 */

/**
 * Shared mutable application state
 * Owner service ระบุไว้ใน [brackets]
 *
 * @typedef {Object} LangState
 *
 * Data — [LoaderService]
 * @property {Object}  languagesConfig   — config จาก db.json
 * @property {Object}  languageCache     — { lang: flattenedTranslationData }
 *
 * Language state — [LanguageManager]
 * @property {string}       selectedLang        — ภาษาที่ใช้อยู่ตอนนี้
 * @property {string}       lastSelectedLang    — ภาษาก่อนหน้า
 * @property {string|null}  _userExplicitLang   — ภาษาที่ user กดเลือกเอง
 *
 * Flags — [LanguageManager]
 * @property {boolean} isUpdatingLanguage — mutex ป้องกัน concurrent update
 * @property {boolean} isInitialized      — ผ่าน initialize() แล้วหรือไม่
 *
 * Worker & Channel — [TranslatorService / NavigationService]
 * @property {Object|null}  workerPool       — WorkerPool instance (lazy)
 * @property {Object|null}  _bc              — BroadcastChannel instance
 * @property {number}       maxWorker        — จำนวน worker สูงสุด
 * @property {Promise|null} _prefetchPromise — prefetch config promise
 *
 * Observer — [TranslatorService]
 * @property {MutationObserver|null} mutationObserver
 * @property {number|null}           mutationThrottleTimeout
 *
 * UI state — [UIService]
 * @property {boolean}           isLanguageDropdownOpen
 * @property {number}            scrollPosition
 * @property {HTMLElement|null}  languageButton
 * @property {HTMLElement|null}  languageOverlay
 * @property {HTMLElement|null}  languageDropdown
 * @property {Function|null}     _dropdownWheelListener
 */

window.LangModules = window.LangModules || {};