// @ts-check
/**
 * @file state.js
 * Single shared mutable state for NavCore.
 *
 * Rules:
 *  • State has no module dependencies — other modules import from it, never vice versa.
 *  • Each field is owned by ONE service (noted in brackets).
 *  • Mutate only through service methods, not directly from outside.
 *
 * @module state
 * @depends {types.js}
 */
(function(M) {
  'use strict';
  
  /** @type {NavState} */
  const State = {
    
    // ── Bootstrap — [InitService] ─────────────────────────────────────────────
    // True from module load until InitService.start() resolves.
    // Other modules should avoid mutating history while this is true.
    isBootstrapping: true,
    
    // ── Cached DOM elements — [InitService] ──────────────────────────────────
    /** @type {NavElements} */
    elements: {
      header: null,
      navList: null,
      subButtonsContainer: null,
      contentLoading: null,
      logo: null,
      subNav: null,
      subNavInner: null,
    },
    
    // ── Navigation state — [RouterService] ───────────────────────────────────
    /** @type {NavigationState} */
    navigation: {
      isNavigating: false,
      currentMainRoute: '',
      currentSubRoute: '',
      previousUrl: '',
      lastScrollPosition: 0,
      initialNavigation: true,
    },
    
    // ── Button / nav-bar state — [ButtonService] ──────────────────────────────
    /** @type {ButtonState} */
    buttons: {
      config: null,
      buttonMap: new Map(),
      currentMainButton: null,
      currentSubButton: null,
      currentMainButtonUrl: null,
    },
  };
  
  M.State = State;
  
})(window.NavCoreModules = window.NavCoreModules || {});