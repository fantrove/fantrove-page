// @ts-check
/**
 * @file overlay.js
 * OverlayService — opens and closes the fullscreen search overlay.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Overlay structure                                          │
 * │                                                             │
 * │  #searchOverlayContainer  (position:fixed, full screen)    │
 * │  ├── #overlay-header-bar                                    │
 * │  │    └── .search-input-wrapper  ← moved from header       │
 * │  └── .search-overlay-scrollable-content                     │
 * │       └── #searchSuggestions                                │
 * │                                                             │
 * │  Results stay on the MAIN PAGE (#searchResults).           │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Close authority:
 *   OverlayService.close() is THE ONLY function that closes the overlay.
 *   Every close path routes here:
 *     Escape key   → close('escape')
 *     Back arrow   → history.back() → popstate → close('popstate')
 *     After search → close('manual')
 *     destroy()    → close('manual')
 *
 * close() owns:
 *   ① History collapse (collapseOverlayEntry or clear flag)
 *   ② VirtualScroll + keyboard auto-toggle cleanup
 *   ③ Return .search-input-wrapper to original header position
 *   ④ Remove overlay DOM
 *   ⑤ Restore page scroll
 *   ⑥ Remove document keydown listener
 *   ⑦ Reset all overlay state fields
 *   ⑧ Update icon slot
 *   ⑨ Restore nav
 *
 * @module overlay
 * @depends {config.js, state.js, utils.js, url-history.js,
 *           keyboard.js, suggestions.js, input-bar.js}
 * Note: VirtualScrollEngine is owned by rendering.js, not imported here.
 */
(function (M) {
  'use strict';

  const {
    CONFIG, State, Handlers,
    DOMService, URLService,
    KeyboardAutoToggleService,
    ReadyModeService, SuggestionService,
    IconSlotService, ClearBtnService,
  } = M;

  const OverlayService = {

    // ── Open ──────────────────────────────────────────────────────────────

    open() {
      try {
        if (State.overlayOpen || State.overlayTransitioning) return;
        State.overlayTransitioning = true;

        const inp = DOMService.get(CONFIG.DOM.searchInputId);

        // Snapshot search state before overlay opens
        State.preOverlayState = {
          q        : inp?.value || '',
          type     : State.selectedType || 'all',
          category : State.selectedCategory || 'all',
        };
        State.overlayOpenedAt = Date.now();

        // Build or clear overlay container
        let ov = DOMService.get(CONFIG.DOM.overlayContainerId);
        if (ov) {
          ov.innerHTML = '';
        } else {
          ov = DOMService.create('div', CONFIG.DOM.overlayContainerId, 'search-overlay search-overlay-open', {
            position       : 'fixed',
            inset          : '0',
            zIndex         : '9998',
            display        : 'flex',
            flexDirection  : 'column',
            alignItems     : 'stretch',
            overflow       : 'hidden',
            backgroundColor: '#ffffff',
          });
          document.body.appendChild(ov);
        }

        // Move .search-input-wrapper into the overlay header bar
        const wrapper = DOMService.query('.search-input-wrapper');
        if (wrapper) {
          State._wrapperParent = wrapper.parentNode;
          State._wrapperNext   = wrapper.nextSibling;

          const bar = DOMService.create('div', 'overlay-header-bar', null, {
            display      : 'flex',
            alignItems   : 'center',
            padding      : '10px 14px',
            background   : '#fff',
            borderBottom : '1px solid rgba(0,0,0,.08)',
            flexShrink   : '0',
            width        : '100%',
            boxSizing    : 'border-box',
          });
          bar.appendChild(wrapper);
          ov.appendChild(bar);
        }

        // Suggestions scrollable area
        const sg = DOMService.create('div', CONFIG.DOM.suggestionContainerId, 'search-suggestions-fullscreen');
        const sc = DOMService.create('div', null, 'search-overlay-scrollable-content', {
          flex              : '1',
          width             : '100%',
          overflow          : 'auto',
          overscrollBehavior: 'contain',
          transform         : 'translateZ(0)',
          willChange        : 'scroll-position',
        });
        sc.appendChild(sg);
        ov.appendChild(sc);
        State.overlayScrollable = sc;

        // Delegate suggestion events onto the suggestion container
        Handlers.suggestionKeydown = (ev) => SuggestionService.handleKeydown(ev, sg);
        Handlers.suggestionClick   = (ev) => SuggestionService.handleClick(ev);
        DOMService.on(sg, 'keydown',    Handlers.suggestionKeydown);
        DOMService.on(sg, 'click',      Handlers.suggestionClick);
        DOMService.on(sg, 'mouseenter', () => { State.suggestionsLocked = true;  });
        DOMService.on(sg, 'mouseleave', () => { State.suggestionsLocked = false; });

        // ── Scroll-lock: no layout shift technique ─────────────────────────
        // BAD: document.documentElement.overflow='hidden' removes the scrollbar
        //      → page widens by ~15px → all fixed elements shift → results jump.
        //
        // CORRECT (Bootstrap/MUI/Headless UI pattern):
        //   Save scrollY → body position:fixed + top:-scrollY + width:100%
        //   Body stays visually in place, scrollbar stays visible → zero shift.
        //
        // BUG 2 fix (overlay clipped when keyboard open + scrolled):
        //   When keyboard is open, visualViewport.offsetTop can be > 0.
        //   Scroll window to top FIRST, then lock. overlay inset:0 then
        //   correctly anchors to the actual viewport top edge.
        const _savedScrollY = window.scrollY || window.pageYOffset || 0;
        State._savedScrollY = _savedScrollY;

        // Bring page to top so overlay position:fixed inset:0 is correct
        if (_savedScrollY > 0) {
          window.scrollTo({ top: 0, behavior: 'instant' });
        }

        // Lock scroll — body fixed keeps it visually in place, no scrollbar jump
        document.body.style.position = 'fixed';
        document.body.style.top      = `-${_savedScrollY}px`;
        document.body.style.width    = '100%';

        // Escape → close (routed through OverlayService.close, the one authority)
        Handlers.documentKeydownOverlay = (e) => { if (e.key === 'Escape') OverlayService.close('escape'); };
        DOMService.on(document, 'keydown', Handlers.documentKeydownOverlay);

        State.overlayOpen = true;

        // Update icon → back arrow
        IconSlotService.update();
        ClearBtnService.sync();

        KeyboardAutoToggleService.enableAutoToggle(sc);
        this._hideNav();

        // Push overlay history entry (Stack B — see url-history.js)
        URLService.pushOverlayEntry(State.preOverlayState);

        // Clear transitioning flag BEFORE rendering suggestions.
        // renderQuerySuggestions() guards on overlayTransitioning — if still true
        // when called, it returns early and suggestions never appear.
        // Sequence: mark open → clear flag → render → focus.
        State.overlayTransitioning = false;

        // Show suggestions for the current input value immediately.
        // Must happen AFTER overlayTransitioning=false (see above).
        const currentQ = (inp?.value || '').trim();
        if (currentQ) SuggestionService.renderQuerySuggestions(currentQ);
        else          ReadyModeService.renderReadyModeSuggestions();

        // Focus input, cursor at end, no text selection
        if (inp) {
          setTimeout(() => {
            try {
              inp.focus({ preventScroll: true });
              const l = inp.value.length;
              inp.setSelectionRange(l, l);
            } catch { try { inp.focus(); } catch {} }
          }, CONFIG.TIMING.focusDelayMs);
        }
      } catch (e) {
        console.error('[OverlayService] open failed', e);
        State.overlayTransitioning = false;
      }
    },

    // ── Close (sole authority) ─────────────────────────────────────────────

    /**
     * Close the overlay. This is the ONLY function allowed to close it.
     *
     * @param {'escape'|'back-btn'|'popstate'|'manual'|string} src
     *   'popstate' = browser already popped the entry — skip collapseOverlayEntry.
     *   All other values = we must collapse the overlay history entry ourselves.
     */
    close(src = 'manual') {
      try {
        if (!State.overlayOpen) return;
        State.overlayTransitioning = true;

        // ① History — determine the search state to commit on close
        const closingState = State.lastCommittedSearchState
          || State.preOverlayState
          || { q: '', type: 'all', category: 'all' };

        if (src === 'popstate') {
          // Browser already popped the overlay entry — just clear the flag
          State.overlayHistoryPushed = false;
        } else {
          // Replace the overlay entry with the current search state
          URLService.collapseOverlayEntry(closingState);
        }

        // ② Cleanup — VS owned by RenderingService, not overlay
        KeyboardAutoToggleService.disableAutoToggle();

        // ③ Return .search-input-wrapper to its original header position
        const wrapper = DOMService.query('.search-input-wrapper');
        if (wrapper && State._wrapperParent) {
          if (State._wrapperNext && State._wrapperNext.parentNode === State._wrapperParent) {
            State._wrapperParent.insertBefore(wrapper, State._wrapperNext);
          } else {
            State._wrapperParent.appendChild(wrapper);
          }
        }
        State._wrapperParent = null;
        State._wrapperNext   = null;

        // ④ Remove overlay DOM
        DOMService.remove(DOMService.get(CONFIG.DOM.overlayContainerId));

        // ⑤ Restore scroll-lock — reverse of the body-fixed technique
        // Remove fixed lock first, then restore scroll position atomically.
        const savedScrollY = State._savedScrollY || 0;
        const _didSearch = !!window.__overlayDidSearch;
        window.__overlayDidSearch = false;

        // Hide #searchResults during body restoration to prevent VS flash.
        // When body position:fixed is removed, scrollY briefly appears as 0.
        // VS sees this and re-renders items from top before scrollTo fires.
        // visibility:hidden hides that transient re-render without layout cost.
        const _sr = DOMService.get(CONFIG.DOM.searchResultsId || 'searchResults');
        if (_sr && savedScrollY > 0 && !_didSearch) _sr.style.visibility = 'hidden';

        document.body.style.position = '';
        document.body.style.top      = '';
        document.body.style.width    = '';
        State._savedScrollY = 0;

        if (savedScrollY > 0 && !_didSearch) {
          window.scrollTo({ top: savedScrollY, behavior: 'instant' });
          // Restore visibility after scroll settles (next paint frame)
          requestAnimationFrame(() => {
            if (_sr) _sr.style.visibility = '';
          });
        } else if (_sr) {
          _sr.style.visibility = '';
        }

        // ⑥ Remove document keydown listener
        DOMService.off(document, 'keydown', Handlers.documentKeydownOverlay);
        Handlers.documentKeydownOverlay = null;

        // ⑦ Reset overlay state fields
        State.overlayOpen       = false;
        State.overlayScrollable = null;
        State.suggestionsLocked = false;
        State.overlayOpenedAt   = null;

        // ⑧ Update icon slot (may show ← if query is still present, or 🔍)
        IconSlotService.update();
        ClearBtnService.sync();

        // ⑨ Restore nav
        this._showNav();

        // Clear any pending timeouts registered during overlay lifetime
        State._timeouts.forEach(t => { try { clearTimeout(t); } catch {} });
        State._timeouts.clear();

        setTimeout(() => { State.overlayTransitioning = false; }, CONFIG.TIMING.transitionDelayMs);
      } catch (e) {
        console.error('[OverlayService] close failed', e);
        State.overlayTransitioning = false;
      }
    },

    // ── Nav helpers ────────────────────────────────────────────────────────

    _hideNav() {
      try { State.navHiddenBySearch = true; window.modernNav?.hideNav?.('search-overlay'); } catch {}
    },

    _showNav() {
      try {
        if (window.modernNav?.showNav && State.navHiddenBySearch) {
          State.navHiddenBySearch = false;
          window.modernNav.showNav('search-overlay-closed');
        }
      } catch {}
    },
  };

  // ── Export ─────────────────────────────────────────────────────────────
  M.OverlayService = OverlayService;

})(window.SearchModules = window.SearchModules || {});
