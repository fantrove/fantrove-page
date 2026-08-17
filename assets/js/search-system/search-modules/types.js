// @ts-check
/**
 * @file types.js
 * Central typedef file — shared types for all modules.
 * No runtime code. Load this first.
 *
 * v4.0 — Added DiscoveryConfig, LangWeightConfig, DiscoveryItem,
 *        QueryLanguageInfo, and extended SearchState with discovery
 *        fields. These support the new Discovery system and the
 *        smart query-language detection in SuggestionService.
 *
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

/**
 * Discovery item (v4.0).
 *
 * A related item surfaced in the discovery section after primary
 * search results. Carries a score that reflects how strongly the
 * item relates to the original query (higher = stronger).
 *
 * @typedef {Object} DiscoveryItem
 * @property {any}        item         The raw copyable item
 * @property {any}        typeObj      Parent type object
 * @property {any}        category     Parent category object
 * @property {string}     typeName     Type display name
 * @property {string}     catName      Category display name
 * @property {string}     itemName     Item display name
 * @property {number}     score        Relatedness score (0..N)
 * @property {string}     reason       Why this item was selected
 *                                     ('same-category' | 'same-type' | 'token-overlap')
 */

/**
 * Query language detection result (v4.0).
 *
 * Returned by SuggestionService.detectQueryLanguage(). Describes
 * which language the query is "mostly" in, plus the character
 * counts used to make that determination. Exposed for transparency
 * and for unit testing.
 *
 * @typedef {Object} QueryLanguageInfo
 * @property {string}   language     'th' | 'en' — the detected language
 * @property {number}   thaiChars    Count of Thai-script chars (U+0E00–U+0E7F)
 * @property {number}   latinChars   Count of Latin-script chars (A-Z, a-z)
 * @property {string}   reason       'dominant-thai' | 'dominant-latin' | 'fallback-ui'
 * @property {boolean}  confident    True if dominance threshold was met
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
 * Discovery state — owned by [DiscoveryService] (v4.0)
 * @property {DiscoveryItem[]}  currentDiscovery    Currently rendered discovery items
 * @property {boolean}          discoveryActive     True if discovery section is shown
 * @property {Object|null}      discoveryHandle     URE handle for the discovery list (internal)
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
 * @property {Function|null} discoveryScroll  v4.0 — discovery infinite-scroll handler
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
 * Discovery system configuration (v4.0).
 * @typedef {Object} DiscoveryConfig
 * @property {number} maxRelatedItems      Max related items to compute per search
 * @property {number} sampleTopN           Top-N primary results to sample for signal
 * @property {number} minResultsForDiscovery  Min primary results before discovery runs
 * @property {number} emptyStateMaxItems   Max items in empty-state discovery block
 * @property {Readonly<{sameType:number, sameCategory:number, tokenOverlap:number}>} weights
 */

/**
 * Language-detection configuration (v4.0).
 * @typedef {Object} LangWeightConfig
 * @property {number} dominanceRatio       Min ratio of (dominant/other) chars
 * @property {number} minCharsForDominance Min absolute chars before a language can dominate
 * @property {string} fallback             Fallback language ('auto' = UI lang)
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
 * @property {Readonly<DiscoveryConfig>}                  DISCOVERY    v4.0
 * @property {Readonly<LangWeightConfig>}                 LANG_WEIGHT  v4.0
 */

window.SearchModules = window.SearchModules || {};
