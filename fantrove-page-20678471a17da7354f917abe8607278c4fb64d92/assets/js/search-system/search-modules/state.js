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
 * v4.0 — Added discovery state fields (currentDiscovery, discoveryActive,
 *        discoveryHandle) and discoveryScroll handler reference. These
 *        power the new Discovery system that surfaces related content
 *        after primary search results.
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

    // ── Discovery state — owned by [DiscoveryService] (v4.0) ────────────────
    // Related content surfaced after primary search results.
    // currentDiscovery holds the DiscoveryItem[] currently rendered.
    // discoveryActive is true whenever the discovery section is visible.
    // discoveryHandle is the URE handle for the discovery list (internal).
    currentDiscovery         : [],
    discoveryActive          : false,
    discoveryHandle          : null,

    // ── Overlay state ────────────────────────────────────────────────────────
    overlayOpen              : false,
    overlayTransitioning     : false,
    overlayHistoryPushed     : false,
    preOverlayState          : null,
    overlayOpenedAt          : null,
    _savedScrollY            : 0,    // scroll position saved before overlay scroll-lock
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
    // v4.0 — Discovery infinite-scroll handler (attached to window)
    discoveryScroll         : null,
  };

  M.State    = State;
  M.Handlers = Handlers;

})(window.SearchModules = window.SearchModules || {});
