// @ts-check
/**
 * @file state.js
 * Single shared mutable state + DOM event handler references.
 *
 * Rules:
 *  • State has no dependencies — other modules import from it, not vice versa.
 *  • Each field is owned by ONE service (noted in types.js).
 *  • Handlers is a bag of removable listener references for destroy().
 *
 * @module state
 * @depends {types.js}
 */
(function (M) {
  'use strict';

  /** @type {SearchState} */
  const State = {
    // ── Data (loaded by search-ui.js) ───────────────────────────────────────
    apiData                  : null,
    allKeywordsCache         : [],
    currentResults           : [],
    currentFilteredResults   : [],

    // ── Filter state ─────────────────────────────────────────────────────────
    selectedType             : 'all',
    selectedCategory         : 'all',
    lastCommittedSearchState : null,

    // ── Overlay state ────────────────────────────────────────────────────────
    overlayOpen              : false,
    overlayTransitioning     : false,
    overlayHistoryPushed     : false,
    preOverlayState          : null,
    overlayOpenedAt          : null,
    overlayScrollable        : null,
    _wrapperParent           : null,
    _wrapperNext             : null,

    // ── History ──────────────────────────────────────────────────────────────
    suppressHistoryPush      : false,

    // ── Keyboard ─────────────────────────────────────────────────────────────
    keyboardOpen             : false,
    lastWindowInnerHeight    : 0,
    keyboardDetectionTimeout : null,
    keyboardAutoToggleEnabled: false,
    lastOverlayScrollY       : 0,
    keyboardAutoToggleHandler: null,
    lastKeyboardToggleTime   : 0,
    isScrollingActive        : false,
    scrollIdleTimer          : null,

    // ── Input ────────────────────────────────────────────────────────────────
    debounceTimeout          : null,
    suggestionsLocked        : false,

    // ── Nav ──────────────────────────────────────────────────────────────────
    navHiddenBySearch        : false,

    // ── Internals ────────────────────────────────────────────────────────────
    _timeouts                : new Set(),
    _handlersAttached        : false,
    _overlayStateMarker      : '__searchUI_overlay_open__',
  };

  /** @type {SearchHandlers} */
  const Handlers = {
    resize                  : null,
    inputFocus              : null,
    inputClick              : null,
    inputInput              : null,
    inputKeydown            : null,
    formSubmit              : null,
    suggestionClick         : null,
    suggestionKeydown       : null,
    documentKeydownOverlay  : null,
    popstate                : null,
    copyClick               : null,
  };

  M.State    = State;
  M.Handlers = Handlers;

})(window.SearchModules = window.SearchModules || {});
