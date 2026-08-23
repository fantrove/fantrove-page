// @ts-check
/**
 * @file url-history.js
 * Browser history — two-stack model.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Two-stack history model                                    │
 * │                                                             │
 * │  Stack A — search entries                                   │
 * │    Created by: commitSearch()  via pushState                │
 * │    Each unique query = one entry. Back navigates queries.   │
 * │                                                             │
 * │  Stack B — overlay entry                                    │
 * │    Created by: pushOverlayEntry() on overlay open          │
 * │    Collapsed by: collapseOverlayEntry() on overlay close   │
 * │    collapseOverlayEntry uses replaceState — the overlay     │
 * │    entry becomes the current search entry, not a new one.   │
 * │                                                             │
 * │  Net result: opening overlay + searching = exactly 1 push  │
 * │  [init] → [hello] → open → search world → [init, hello, world] │
 * └─────────────────────────────────────────────────────────────┘
 *
 * @module url-history
 * @depends {config.js, state.js, utils.js}
 */
(function (M) {
  'use strict';

  const { CONFIG, State, StorageService } = M;

  const URLService = {

    // ── Query string ─────────────────────────────────────────────────────────

    /**
     * Parse a query string into a key-value map.
     * @param {string} qs  e.g. '?q=hello&type=all'
     * @returns {Record<string,string>}
     */
    parseQS(qs) {
      const out = {};
      if (!qs) return out;
      for (const p of qs.replace(/^\?/, '').split('&')) {
        if (!p) continue;
        const eq = p.indexOf('=');
        if (eq === -1) out[decodeURIComponent(p)] = '';
        else out[decodeURIComponent(p.slice(0, eq))] = decodeURIComponent(p.slice(eq + 1));
      }
      return out;
    },

    /**
     * Build a query string from a plain object.
     * Empty-string values are omitted.
     * @param {Record<string,string>} obj
     * @returns {string}  e.g. '?q=hello'
     */
    buildQS(obj) {
      const parts = [];
      for (const k in obj) {
        if (obj[k] != null && obj[k] !== '')
          parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(obj[k])}`);
      }
      return parts.length ? '?' + parts.join('&') : '';
    },

    /**
     * Read the current search state from the URL.
     * @returns {SearchHistoryEntry}
     */
    readStateFromURL() {
      try {
        const p = this.parseQS(location.search);
        return { q: p.q || '', type: p.type || 'all', category: p.category || 'all' };
      } catch {
        return { q: '', type: 'all', category: 'all' };
      }
    },

    /**
     * Build a URL pathname+search string for a search state.
     * Returns bare pathname when all filters are default.
     * @param {Omit<SearchHistoryEntry,'ts'>} st
     * @returns {string}
     */
    buildUrlForState(st) {
      const p = /** @type {Record<string,string>} */ ({});
      if (st.q)                       p.q        = st.q;
      if (st.type && st.type !== 'all')     p.type     = st.type;
      if (st.category && st.category !== 'all') p.category = st.category;
      return this.buildQS(p) || location.pathname;
    },

    /**
     * Deep equality check of two search states (ignores timestamp).
     * @param {SearchHistoryEntry|null} a
     * @param {SearchHistoryEntry|null} b
     * @returns {boolean}
     */
    isEqual(a, b) {
      if (!a && !b) return true;
      if (!a || !b) return false;
      return (a.q || '').trim()    === (b.q || '').trim()    &&
             (a.type || 'all')     === (b.type || 'all')     &&
             (a.category || 'all') === (b.category || 'all');
    },

    // ── Stack A: search commits ──────────────────────────────────────────────

    /**
     * Push a new search entry (Stack A).
     * Only called when the overlay is CLOSED and the query is new.
     * @param {Omit<SearchHistoryEntry,'ts'>} searchState
     */
    commitSearch(searchState) {
      try {
        if (this.isEqual(searchState, State.lastCommittedSearchState)) return;
        const st  = { q: searchState.q || '', type: searchState.type || 'all', category: searchState.category || 'all' };
        const url = this.buildUrlForState(st);
        try { history.pushState(st, '', url); }
        catch { try { history.replaceState(st, '', url); } catch {} }
        StorageService.addSearchToHistory(st);
        State.lastCommittedSearchState = st;
      } catch {}
    },

    /**
     * Replace the current history entry (no new push).
     * Used for URL init, empty-query reset, and URL cleanup.
     * @param {Omit<SearchHistoryEntry,'ts'>} searchState
     */
    replaceSearch(searchState) {
      try {
        const st  = { q: searchState.q || '', type: searchState.type || 'all', category: searchState.category || 'all' };
        const url = this.buildUrlForState(st);
        history.replaceState(st, '', url);
        State.lastCommittedSearchState = st;
      } catch {}
    },

    // ── Stack B: overlay entry ───────────────────────────────────────────────

    /**
     * Push the overlay marker entry (Stack B) when the overlay opens.
     * Tagged with _overlayStateMarker so popstate can identify it.
     * @param {Omit<SearchHistoryEntry,'ts'>} searchState  Snapshot at open time
     */
    pushOverlayEntry(searchState) {
      try {
        const st = { ...searchState, [State._overlayStateMarker]: true };
        history.pushState(st, '', location.href);
        State.overlayHistoryPushed = true;
      } catch {}
    },

    /**
     * Collapse the overlay entry into the current search state.
     * Uses replaceState — the overlay entry is REPLACED, not left dangling.
     * Called by OverlayService.close() for every non-popstate close path.
     *
     * Net effect: [prev, overlay_entry] becomes [prev, search_entry]
     *
     * @param {Omit<SearchHistoryEntry,'ts'>} searchState  The final search state on close
     */
    collapseOverlayEntry(searchState) {
      if (!State.overlayHistoryPushed) return;
      try {
        const st  = { q: searchState.q || '', type: searchState.type || 'all', category: searchState.category || 'all' };
        const url = this.buildUrlForState(st);
        history.replaceState(st, '', url);
        State.lastCommittedSearchState = st;
        if (st.q) StorageService.addSearchToHistory(st);
      } catch {}
      State.overlayHistoryPushed = false;
    },
  };

  M.URLService = URLService;

})(window.SearchModules = window.SearchModules || {});
