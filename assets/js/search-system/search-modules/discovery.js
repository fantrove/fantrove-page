// @ts-check
/**
 * @file discovery.js
 * DiscoveryService — surfaces related content after primary search results.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  DESIGN PHILOSOPHY — YouTube-style discovery (v4.0)
 * ════════════════════════════════════════════════════════════════════════
 *  The user asked for a discovery experience similar to YouTube: show
 *  what the user searched for first, then keep surfacing related items
 *  so the user can discover new content continuously — instead of just
 *  a short random recommendation block at the bottom of empty states.
 *
 *  Inspired by aerospace software standards (NASA Power of Ten,
 *  SpaceX lean reliability) and by NVIDIA's "single source of truth"
 *  architecture pattern:
 *
 *  1. Layered architecture — Engine computes related items;
 *     DiscoveryService renders them; RenderingService stays focused
 *     on primary results. No service reaches into another's state.
 *  2. Fail-safe defaults — every code path returns a valid (possibly
 *     empty) result rather than throwing or hanging. If the engine
 *     returns [], DiscoveryService tears down its DOM gracefully.
 *  3. Deterministic output — same query, same dataset → same discovery
 *     list. No randomness, no time-based variation.
 *  4. No silent failure — all exceptional paths log to console with
 *     the structured prefix `[Discovery]` so issues are traceable.
 *  5. Bounded resource usage — DiscoveryService caps the URE data
 *     set at DISCOVERY.maxRelatedItems (default 60). No unbounded
 *     growth.
 *  6. Single responsibility — DiscoveryService owns the discovery
 *     DOM and its URE handle. It knows nothing about primary results
 *     rendering, overlay state, or URL history.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  ARCHITECTURE
 * ════════════════════════════════════════════════════════════════════════
 *
 *   SearchService.doSearch()
 *     ↓
 *   RenderingService.renderResults(primaryResults)
 *     ↓
 *   DiscoveryService.renderDiscovery(query, primaryResults)
 *     ├── SearchEngine.queryRelated(query, primaryResults, maxItems)
 *     │     → DiscoveryItem[]  (deterministic, scored, deduped)
 *     ├── Build discovery DOM (#searchDiscovery)
 *     │     ├── .discovery-header (title + hint)
 *     │     └── .discovery-list   (URE mount target)
 *     └── URE.mount({ container: .discovery-list, data: items, ... })
 *
 *  The discovery section lives as a sibling of #searchResults inside
 *  the same scroll container, so the user can scroll primary results
 *  → discovery section in one continuous gesture. URE handles the
 *  virtual scroll for both lists independently.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  PUBLIC API
 * ════════════════════════════════════════════════════════════════════════
 *   DiscoveryService.renderDiscovery(query, primaryResults)
 *       Render the discovery section. Called by RenderingService
 *       after primary results are rendered.
 *   DiscoveryService.clearDiscovery()
 *       Tear down the discovery section. Called on empty query, on
 *       destroy(), and before re-rendering with a new query.
 *   DiscoveryService.refreshDiscovery()
 *       Re-render with the current State.currentResults. Called
 *       after a language change so labels update.
 *   DiscoveryService.destroy()
 *       Permanent teardown — removes DOM, clears state. Called by
 *       search.js destroy() lifecycle.
 *
 * @module discovery
 * @depends {config.js, state.js, utils.js, engine.js, rendering.js}
 *             window.URE (ure.js — loaded before this module)
 */
(function (M) {
  'use strict';

  const {
    CONFIG, State,
    DOMService, StringService, LanguageService,
  } = M;

  // ── Internal state ────────────────────────────────────────────────────────
  //
  // WHY a module-private handle (not in State):
  //   State.discoveryHandle is exposed for transparency (so
  //   window.__searchUI.getState() can report whether discovery is
  //   active), but the canonical reference lives here. This keeps
  //   DiscoveryService the single owner of the URE handle lifecycle
  //   — nobody else can call .destroy() on it accidentally.
  //
  /** @type {object|null} URE handle for the discovery list */
  let _handle = null;
  /** @type {Element|null} The #searchDiscovery container */
  let _container = null;
  /** @type {Element|null} The .discovery-list child (URE mount target) */
  let _listEl = null;

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Locate or create the #searchDiscovery container.
   *
   * The container is inserted as a sibling AFTER #searchResults so
   * that discovery items appear below primary results in the same
   * scroll context. If the container already exists (e.g., from a
   * previous search), it is reused.
   *
   * @returns {Element|null}
   */
  function _ensureContainer() {
    try {
      const existing = DOMService.get(CONFIG.DOM.discoveryContainerId);
      if (existing) {
        _container = existing;
        _listEl = existing.querySelector('.discovery-list');
        return existing;
      }

      const results = DOMService.get(CONFIG.DOM.searchResultsId);
      if (!results || !results.parentNode) {
        // Cannot place discovery section without #searchResults.
        // Fail-safe: return null, renderDiscovery() will bail out.
        return null;
      }

      const parent = results.parentNode;
      const container = document.createElement('section');
      container.id = CONFIG.DOM.discoveryContainerId;
      container.className = 'discovery-section';
      container.setAttribute('aria-label', LanguageService.t('discovery_label'));
      // Build inner structure once. We never innerHTML this container
      // again — URE owns .discovery-list from here on.
      container.innerHTML = ''
        + '<div class="discovery-header">'
        +   '<h2 class="discovery-title"></h2>'
        +   '<p class="discovery-hint"></p>'
        + '</div>'
        + '<div class="discovery-list"></div>';

      // Insert AFTER #searchResults, so the order on screen is:
      //   [primary results] → [discovery section]
      if (results.nextSibling) {
        parent.insertBefore(container, results.nextSibling);
      } else {
        parent.appendChild(container);
      }

      _container = container;
      _listEl = container.querySelector('.discovery-list');
      return container;
    } catch (e) {
      console.error('[Discovery] _ensureContainer failed:', e);
      return null;
    }
  }

  /**
   * Update the discovery header text (title + hint).
   * Called on initial render and on language change.
   *
   * @param {boolean} [isEmpty=false]  True if rendering empty-state mode.
   */
  function _updateHeaderText(isEmpty) {
    try {
      if (!_container) return;
      const titleEl = _container.querySelector('.discovery-title');
      const hintEl  = _container.querySelector('.discovery-hint');
      // Empty state uses a friendlier "you might also like" label;
      // normal mode uses the discovery_more ("More to explore") label
      // since the user has already seen primary results.
      const titleKey = isEmpty ? 'suggestions_for_you' : 'discovery_more';
      if (titleEl) titleEl.textContent = LanguageService.t(titleKey);
      if (hintEl)  hintEl.textContent  = LanguageService.t('discovery_hint');
    } catch {}
  }

  /**
   * Tear down the active URE instance for discovery.
   * Does NOT remove the DOM container — only the URE handle.
   * Called before re-mounting with new data, or on destroy().
   */
  function _teardownHandle() {
    if (_handle) {
      try { _handle.destroy(); } catch (e) {
        console.warn('[Discovery] URE handle destroy failed:', e);
      }
      _handle = null;
      State.discoveryHandle = null;
    }
  }

  /**
   * Remove the discovery container from the DOM entirely.
   * Called on clearDiscovery() and destroy().
   */
  function _removeContainer() {
    _teardownHandle();
    if (_container) {
      try { _container.parentNode?.removeChild(_container); } catch {}
    }
    _container = null;
    _listEl = null;
    State.discoveryActive = false;
  }

  /**
   * Build a URE-compatible item from a DiscoveryItem.
   *
   * URE's template function expects an object with at least {item,
   * typeObj, category, itemName, typeName, catName} — the same shape
   * as SearchResult. DiscoveryItem already has all these fields, so
   * we can pass it through almost unchanged. We add `lang: 'auto'`
   * for parity with SearchResult so the renderer's template function
   * (which reads item.lang) doesn't break.
   *
   * @param {DiscoveryItem} d
   * @returns {SearchResult}
   */
  function _toRenderItem(d) {
    return {
      item    : d.item,
      typeObj : d.typeObj,
      category: d.category,
      typeName: d.typeName,
      catName : d.catName,
      itemName: d.itemName,
      lang    : 'auto',
      // Discovery items are not fuzzy matches — they're recommendations
      fuzzy      : false,
      fuzzyScore : null,
      matchExact : false,
    };
  }

  /**
   * Attach the delegated copy handler to the discovery list.
   *
   * WHY re-use the same handler as RenderingService:
   *   RenderingService._attachCopyHandler() already handles delegated
   *   clicks on .sc cards inside #searchResults. Discovery cards use
   *   the same .sc markup (we use the same renderResultItem template),
   *   so we want the same behaviour: tap → copy → show notification.
   *
   *   However, RenderingService's guard (window._copyResultTextHandlerSet)
   *   is attached to #searchResults only — clicks on .sc inside
   *   #searchDiscovery won't trigger it because the listener is on a
   *   different container.
   *
   *   We attach a parallel delegated handler on .discovery-list that
   *   reuses the same _copy logic. This keeps the two lists
   *   independent (one can be torn down without affecting the other)
   *   while giving users the same interaction on both.
   *
   * @param {Element} listEl
   */
  function _attachCopyHandler(listEl) {
    try {
      if (!listEl || listEl._discoveryCopyAttached) return;

      const _copy = (card) => {
        if (!card?.hasAttribute('data-text')) return;
        const text = StringService.decodeUrl(card.getAttribute('data-text'));
        const name = StringService.decodeUrl(card.getAttribute('data-name') || '');
        if (M.NotificationService?.copyText) {
          M.NotificationService.copyText(text, name || undefined);
        }
      };

      listEl.addEventListener('click', (e) => {
        const card = e.target.closest('.sc');
        if (card) { e.preventDefault(); _copy(card); }
      });

      listEl.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const card = e.target.closest('.sc');
        if (card) { e.preventDefault(); _copy(card); }
      });

      listEl._discoveryCopyAttached = true;
    } catch (e) {
      console.warn('[Discovery] _attachCopyHandler failed:', e);
    }
  }

  // ── DiscoveryService ──────────────────────────────────────────────────────

  const DiscoveryService = {

    /**
     * Render the discovery section for the given query + primary results.
     *
     * Steps:
     *  1. Tear down any existing discovery handle (clean slate).
     *  2. Ensure the #searchDiscovery container exists in the DOM.
     *  3. Call SearchEngine.queryRelated() to compute related items.
     *  4. If no items → hide container, return.
     *  5. Update header text (i18n).
     *  6. Mount URE on .discovery-list with the related items.
     *  7. Attach delegated copy handler (once per container).
     *  8. Update State.discovery* fields.
     *
     * Empty-state mode:
     *   When primaryResults is empty (no matches), DiscoveryService
     *   switches to empty-state mode: it shows the first N items from
     *   the dataset as discovery content, with a friendlier header
     *   ("You might also like" / "อาจเกี่ยวข้อง"). This replaces the
     *   old random-5-suggestions block with a larger, scrollable list
     *   that keeps the user exploring.
     *
     * Fail-safe: if anything throws, the discovery section is hidden
     * rather than showing a broken UI. Primary results are unaffected.
     *
     * @param {string}          query
     * @param {SearchResult[]}  primaryResults
     */
    renderDiscovery(query, primaryResults) {
      try {
        // Step 1: clean slate. Tear down any existing handle so we
        // don't leak URE instances on repeated searches.
        _teardownHandle();

        // Step 2: ensure container exists.
        const container = _ensureContainer();
        if (!container || !_listEl) {
          // Cannot render — fail silently (primary results still work).
          State.discoveryActive = false;
          return;
        }

        // Step 3: compute related items via the engine.
        const engine = M.SearchEngine || window.SearchEngine;
        if (!engine?.queryRelated) {
          // Engine not ready — hide discovery, fail safe.
          container.style.display = 'none';
          State.discoveryActive = false;
          return;
        }

        const cfg = (CONFIG.DISCOVERY) || {
          maxRelatedItems: 60, minResultsForDiscovery: 1, emptyStateMaxItems: 12,
        };
        const isEmpty = !primaryResults || primaryResults.length === 0;

        // Empty-state mode: no signal → engine.queryRelated() returns
        // the first N items from the dataset (no dominant type/cat).
        // Normal mode: engine uses the primary results as signal.
        if (!isEmpty) {
          const minForDiscovery = cfg.minResultsForDiscovery ?? 1;
          if (primaryResults.length < minForDiscovery) {
            container.style.display = 'none';
            State.discoveryActive = false;
            return;
          }
        }

        // Pick the right max items for this mode.
        const maxItems = isEmpty
          ? (cfg.emptyStateMaxItems || 12)
          : (cfg.maxRelatedItems || 60);

        const items = engine.queryRelated(query, primaryResults, maxItems);
        if (!items || items.length === 0) {
          // No related items found — hide the section rather than show
          // an empty header. Fail-safe.
          container.style.display = 'none';
          State.discoveryActive = false;
          return;
        }

        // Step 4: show container, update header text.
        container.style.display = '';
        _updateHeaderText(isEmpty);

        // Step 5: convert DiscoveryItem[] to SearchResult[] shape for URE.
        const renderItems = [];
        for (let i = 0; i < items.length; i++) {
          renderItems.push(_toRenderItem(items[i]));
        }

        // Step 6: mount or update URE.
        const lang = LanguageService.getLang();
        if (_handle) {
          _handle.setLang(lang);
          _handle.setData(renderItems);
        } else {
          // First mount — clear list, attach copy handler, mount URE.
          _listEl.innerHTML = '';
          _attachCopyHandler(_listEl);

          // Defensive: URE must be available. If not, hide discovery
          // rather than crash. This can happen if ure.js failed to
          // load for some reason.
          if (!window.URE?.mount) {
            console.warn('[Discovery] URE.mount not available — hiding discovery section');
            container.style.display = 'none';
            State.discoveryActive = false;
            return;
          }

          _handle = window.URE.mount({
            container : _listEl,
            data      : renderItems,
            template  : (item, l) => {
              // Re-use RenderingService's template so discovery cards
              // look identical to primary result cards. This keeps
              // the visual language consistent across both lists.
              if (M.RenderingService?.renderResultItem) {
                return M.RenderingService.renderResultItem(item, l);
              }
              // Fallback: minimal template if RenderingService is missing.
              return '<div class="sc"><div class="scc">-</div></div>';
            },
            lang,
            buffer    : 700,
            recycling : true,
            keyField  : 'api',
          });
        }

        // Step 7: update state for transparency.
        State.discoveryActive  = true;
        State.discoveryHandle  = _handle;
        State.currentDiscovery = items;
      } catch (e) {
        // Fail-safe: log and hide discovery so primary results still work.
        console.error('[Discovery] renderDiscovery failed:', e);
        try {
          if (_container) _container.style.display = 'none';
        } catch {}
        State.discoveryActive = false;
      }
    },

    /**
     * Clear the discovery section.
     *
     * Tears down the URE handle and removes the container from the DOM.
     * Called on empty query, on destroy(), and before re-rendering with
     * a new query that has too few results to support discovery.
     */
    clearDiscovery() {
      try {
        _removeContainer();
        State.currentDiscovery = [];
      } catch (e) {
        console.warn('[Discovery] clearDiscovery failed:', e);
      }
    },

    /**
     * Refresh the discovery section after a language change.
     *
     * Re-renders with the current State.currentResults so the header
     * text and item labels update to the new language. If discovery
     * is not active, this is a no-op.
     */
    refreshDiscovery() {
      try {
        if (!State.discoveryActive) return;
        // Re-render with current state.
        const lastQuery = State.lastCommittedSearchState?.q || '';
        if (lastQuery && State.currentResults?.length) {
          this.renderDiscovery(lastQuery, State.currentResults);
        } else {
          this.clearDiscovery();
        }
      } catch (e) {
        console.warn('[Discovery] refreshDiscovery failed:', e);
      }
    },

    /**
     * Permanent teardown.
     *
     * Called by search.js destroy() lifecycle. Removes DOM, clears
     * state, tears down URE handle. After this, DiscoveryService
     * cannot be used again until renderDiscovery() is called.
     */
    destroy() {
      try {
        _removeContainer();
        State.currentDiscovery = [];
        State.discoveryActive  = false;
        State.discoveryHandle  = null;
      } catch (e) {
        console.warn('[Discovery] destroy failed:', e);
      }
    },

    /**
     * Whether the discovery section is currently active.
     * @returns {boolean}
     */
    isActive() {
      return !!State.discoveryActive;
    },

    /**
     * Get the current discovery items (defensive copy).
     * @returns {DiscoveryItem[]}
     */
    getItems() {
      return (State.currentDiscovery || []).slice();
    },
  };

  // ── Export ────────────────────────────────────────────────────────────────
  M.DiscoveryService = DiscoveryService;

})(window.SearchModules = window.SearchModules || {});
