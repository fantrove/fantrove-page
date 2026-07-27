// @ts-check
/**
 * @file types.js
 * Central typedef file — shared types for all modules.
 * No runtime code. Load this first.
 * @module types
 */

// ── Search data ───────────────────────────────────────────────────────────────

/**
 * One result from SearchEngine.
 * @typedef {Object} SearchResult
 * @property {any}        item
 * @property {any}        typeObj
 * @property {any}        category
 * @property {string}     typeName
 * @property {string}     catName
 * @property {string}     itemName
 * @property {string}     lang
 * @property {boolean}    fuzzy
 * @property {number|null} fuzzyScore
 */

/**
 * A search state stored in browser history and session storage.
 * @typedef {Object} SearchHistoryEntry
 * @property {string} q
 * @property {string} type
 * @property {string} category
 * @property {number} [ts]
 */

/**
 * Option in the category <select>.
 * @typedef {Object} CategoryOption
 * @property {string} key
 * @property {string} displayName
 */

// ── Application state ─────────────────────────────────────────────────────────

/**
 * Shared mutable application state.
 * Owner service is noted in brackets [ServiceName].
 *
 * @typedef {Object} SearchState
 *
 * Data — owned by search-ui.js (loaded from ConDataService)
 * @property {any|null}   apiData
 * @property {any[]}      allKeywordsCache
 * @property {SearchResult[]}  currentResults
 * @property {SearchResult[]}  currentFilteredResults
 *
 * Filter state — owned by [UIService / SearchService]
 * @property {string}     selectedType
 * @property {string}     selectedCategory
 * @property {SearchHistoryEntry|null} lastCommittedSearchState
 *
 * Overlay state — owned by [OverlayService]
 * @property {boolean}    overlayOpen
 * @property {boolean}    overlayTransitioning
 * @property {boolean}    overlayHistoryPushed
 * @property {SearchHistoryEntry|null} preOverlayState
 * @property {number|null} overlayOpenedAt
 * @property {Element|null} overlayScrollable
 * @property {Element|null} _wrapperParent
 * @property {Node|null}  _wrapperNext
 *
 * History — owned by [URLService / SearchService]
 * @property {boolean}    suppressHistoryPush
 *
 * Keyboard — owned by [KeyboardService / KeyboardAutoToggleService]
 * @property {boolean}    keyboardOpen
 * @property {number}     lastWindowInnerHeight
 * @property {number|null} keyboardDetectionTimeout
 * @property {boolean}    keyboardAutoToggleEnabled
 * @property {number}     lastOverlayScrollY
 * @property {Function|null} keyboardAutoToggleHandler
 * @property {number}     lastKeyboardToggleTime
 * @property {boolean}    isScrollingActive
 * @property {number|null} scrollIdleTimer
 *
 * Input — owned by [UIService / ClearBtnService]
 * @property {number|null} debounceTimeout
 * @property {boolean}    suggestionsLocked
 *
 * Nav — owned by [OverlayService]
 * @property {boolean}    navHiddenBySearch
 *
 * Internals
 * @property {Set<number>} _timeouts
 * @property {boolean}    _handlersAttached
 * @property {string}     _overlayStateMarker
 */

/**
 * Removable DOM event handler references (for clean destroy).
 * @typedef {Object} SearchHandlers
 * @property {Function|null} resize
 * @property {Function|null} inputFocus
 * @property {Function|null} inputClick
 * @property {Function|null} inputInput
 * @property {Function|null} inputKeydown
 * @property {Function|null} formSubmit
 * @property {Function|null} suggestionClick
 * @property {Function|null} suggestionKeydown
 * @property {Function|null} documentKeydownOverlay
 * @property {Function|null} popstate
 * @property {Function|null} copyClick
 */

// ── Config types ──────────────────────────────────────────────────────────────

/**
 * @typedef {Object} TimingConfig
 * @property {number} debounceMs
 * @property {number} toastDisplayMs
 * @property {number} toastFadeMs
 * @property {number} focusDelayMs
 * @property {number} transitionDelayMs
 * @property {number} keyboardDetectionDelayMs
 * @property {number} keyboardGapMinMs
 * @property {number} keyboardGapRecoveryMs
 * @property {number} keyboardIdleTimeMs
 * @property {number} conDataServiceWaitMs
 * @property {number} conDataServicePollMs
 * @property {number} urlSearchRetryMs
 * @property {number} urlSearchMaxRetries
 */

/**
 * @typedef {Object} AppConfig
 * @property {TimingConfig}                               TIMING
 * @property {Readonly<Record<string,number>>}            RENDER
 * @property {Readonly<Record<string,string>>}            DOM
 * @property {Readonly<{historyKey:string,langKey:string}>} STORAGE
 * @property {Readonly<{default:string,autoDetect:boolean}>} LANG
 * @property {Readonly<{path:string}>}                    DB
 * @property {Readonly<Record<string,Record<string,string>>>} TEXTS
 * @property {Readonly<Record<string,string>>}            Icons
 */

window.SearchModules = window.SearchModules || {};
