// @ts-check
/**
 * @file types.js
 * Central typedef file — shared types for all lang-modules.
 * No runtime code. Load this first.
 * @module types
 */

/**
 * ผลลัพธ์จาก DetectorService.resolveCurrentLang()
 * @typedef {Object} LangDecision
 * @property {string} lang     — 'en' หรือ 'th'
 * @property {'url'|'storage'|'browser'} source — แหล่งที่มาของการตัดสินใจ
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
 * @property {Object|null}  workerPool   — WorkerPool instance
 * @property {Object|null}  _bc          — BroadcastChannel instance
 * @property {number}       maxWorker    — จำนวน worker ที่จะสร้าง
 * @property {Promise|null} _prefetchPromise — prefetch config promise
 *
 * Observer — [TranslatorService]
 * @property {MutationObserver|null} mutationObserver       — สำหรับ dynamic content
 * @property {number|null}           mutationThrottleTimeout — throttle timer
 *
 * UI state — [UIService]
 * @property {boolean}           isLanguageDropdownOpen  — dropdown เปิดอยู่หรือไม่
 * @property {number}            scrollPosition          — scroll ก่อน lock
 * @property {HTMLElement|null}  languageButton          — cached button ref
 * @property {HTMLElement|null}  languageOverlay         — overlay element
 * @property {HTMLElement|null}  languageDropdown        — dropdown element
 * @property {Function|null}     _dropdownWheelListener  — wheel handler ref สำหรับ cleanup
 */

window.LangModules = window.LangModules || {};