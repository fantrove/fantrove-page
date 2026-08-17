// Path:    assets/js/nav-core-modules/feed-cache.js
// Purpose: FeedCache — persistent per-user feed state in localStorage with TTL.
//
//          Solves two problems with the old FeedService.reset() behavior:
//            1. Old: _seed = Date.now() ^ Math.random() → new seed every reset
//               → every page load generated a brand-new feed order
//               → users saw a different feed every visit (felt random, not "delivered")
//               → all users effectively saw the same kind of "fresh" feed
//
//            2. New: _seed = FeedCache.getOrCreateSeed()
//               → seed is persisted in localStorage with a timestamp
//               → within TTL window, same seed = same feed order
//               → user experiences feed as "delivered and remembered"
//               → different users (different browsers) get different seeds
//               → after TTL expires, a new seed is generated → fresh feed
//
//          Additionally, the feed STATE (which segments were already emitted,
//          how many times each category was shown, etc.) is also persisted,
//          so the user can resume scrolling exactly where they left off —
//          even after closing the tab and coming back within TTL.
//
// Used by: feed.js (reset → getOrCreateSeed, snapshot → saveFeedState,
//                   restore → loadFeedState)
//          content.js (renderFeed → tries cache-first restore)
//
// Storage layout (localStorage):
//   fv_feed_seed_v1: { seed:number, createdAt:number }
//   fv_feed_state_v1: {
//     seed:number, softResets:number, isExhausted:boolean, slotIndex:number,
//     catShowCounts:[string, number][], recentCats:string[], recentTypes:string[],
//     emittedIds:string[], savedAt:number
//   }
//
// Why localStorage not IndexedDB:
//   - State is small (< 50KB typically) — well within localStorage's 5MB quota
//   - Synchronous read → no async bootstrap cost
//   - Simpler API, no version migration concerns
//   - If we ever exceed quota, FeedCache gracefully degrades (try/catch everywhere)

// @ts-check
(function (M) {
  'use strict';

  // ── Storage keys (versioned for future schema changes) ──────────────────────
  const SEED_KEY  = 'fv_feed_seed_v1';
  const STATE_KEY = 'fv_feed_state_v1';

  // ── TTL ─────────────────────────────────────────────────────────────────────
  // WHY 30 min: matches CONFIG.ALL_BUTTON.FEED_SEED_TTL.
  //   - Long enough that a user coming back later same session sees same feed
  //   - Short enough that content feels fresh over a day
  //   - If CONFIG.ALL_BUTTON.FEED_SEED_TTL is defined at call-time, caller can
  //     override; this is just a safe default for direct calls.
  const DEFAULT_TTL_MS = 30 * 60 * 1000;

  // ── Quota safety ────────────────────────────────────────────────────────────
  // WHY guard: localStorage.setItem can throw QuotaExceededError on private
  //   browsing mode or when storage is full. We always swallow + degrade.
  function _safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (_) {
      // Quota exceeded or storage disabled — feed will work without persistence,
      // just won't survive page reload. Acceptable degradation.
      return false;
    }
  }

  function _safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function _safeRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch (_) {}
  }

  // ── FeedCache ───────────────────────────────────────────────────────────────

  const FeedCache = {

    // ── Seed management ───────────────────────────────────────────────────────

    /**
     * Get or create a persistent per-user seed.
     *
     * Behavior:
     *   - If a seed exists in localStorage AND is within TTL → reuse (cached)
     *   - If expired, missing, or corrupted → generate new seed + persist
     *
     * WHY persistent seed: makes the feed algorithm deterministic across
     *   visits within the TTL window. Different browsers → different seeds →
     *   different feeds. Same browser within TTL → same feed order.
     *
     * @param {number} [ttlMs] TTL in milliseconds (default 30 min)
     * @returns {number} 32-bit unsigned integer seed
     */
    getOrCreateSeed(ttlMs) {
      const ttl = (typeof ttlMs === 'number' && ttlMs > 0) ? ttlMs : DEFAULT_TTL_MS;

      const raw = _safeGet(SEED_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed
              && typeof parsed.seed === 'number'
              && typeof parsed.createdAt === 'number'
              && (Date.now() - parsed.createdAt) < ttl) {
            return parsed.seed >>> 0;
          }
        } catch (_) {
          // Corrupted JSON — fall through to regenerate
        }
      }

      // Generate fresh seed
      // WHY mix Date.now() + Math.random(): prevents same seed on rapid
      //   re-navigation, while staying unique per browser
      const seed = (Date.now() ^ (Math.random() * 0x100000000 | 0)) >>> 0;
      _safeSet(SEED_KEY, JSON.stringify({
        seed:       seed,
        createdAt:  Date.now(),
      }));
      return seed;
    },

    /**
     * Force-generate a new seed (used when user explicitly refreshes feed,
     * e.g. via a "refresh feed" button — clears the cached seed so the next
     * getOrCreateSeed call will produce a new one).
     */
    refreshSeed() {
      _safeRemove(SEED_KEY);
    },

    // ── Feed state management ─────────────────────────────────────────────────

    /**
     * Save a lightweight feed state snapshot.
     *
     * What we store:
     *   - seed, softResets, isExhausted, slotIndex  → cycle progress
     *   - catShowCounts (as entries array)           → novelty tracking
     *   - recentCats, recentTypes                    → diversity windows
     *   - emittedIds (ordered list of emitted seg.id) → lets us rebuild
     *     unseenPool accurately on restore without storing the full segments
     *
     * What we DO NOT store:
     *   - Full segment objects (items arrays) — too big, and they can be
     *     deterministically rebuilt from DB + seed
     *   - DOM snapshots — content.js handles its own DOM via RouteCache
     *
     * @param {object} state Lightweight state from FeedService.snapshot()
     */
    saveFeedState(state) {
      if (!state || typeof state !== 'object') return;

      // Defensive: only serialize the fields we actually need to restore
      const lightweight = {
        seed:          state.seed || 0,
        softResets:    state.softResets || 0,
        isExhausted:   !!state.isExhausted,
        slotIndex:     state.slotIndex || 0,
        catShowCounts: Array.isArray(state.catShowCounts) ? state.catShowCounts : [],
        recentCats:    Array.isArray(state.recentCats) ? state.recentCats : [],
        recentTypes:   Array.isArray(state.recentTypes) ? state.recentTypes : [],
        emittedIds:    Array.isArray(state.emittedIds) ? state.emittedIds : [],
        savedAt:       Date.now(),
      };

      _safeSet(STATE_KEY, JSON.stringify(lightweight));
    },

    /**
     * Load a feed state snapshot if it exists and is within TTL.
     *
     * @param {number} [ttlMs] TTL in milliseconds (default 30 min)
     * @returns {object|null} Lightweight state, or null if missing/expired/corrupted
     */
    loadFeedState(ttlMs) {
      const ttl = (typeof ttlMs === 'number' && ttlMs > 0) ? ttlMs : DEFAULT_TTL_MS;

      const raw = _safeGet(STATE_KEY);
      if (!raw) return null;

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        // Corrupted — clear it so it doesn't keep failing
        _safeRemove(STATE_KEY);
        return null;
      }

      if (!parsed || typeof parsed.savedAt !== 'number') {
        _safeRemove(STATE_KEY);
        return null;
      }

      // TTL check
      if (Date.now() - parsed.savedAt > ttl) {
        _safeRemove(STATE_KEY);
        return null;
      }

      // Seed must match — if user cleared seed manually or seed was refreshed,
      // the state is no longer valid
      const currentSeedRaw = _safeGet(SEED_KEY);
      if (currentSeedRaw) {
        try {
          const seedInfo = JSON.parse(currentSeedRaw);
          if (seedInfo && seedInfo.seed !== parsed.seed) {
            // Seed changed → state is stale, discard
            _safeRemove(STATE_KEY);
            return null;
          }
        } catch (_) {}
      }

      return parsed;
    },

    /**
     * Whether a valid cached state exists (without loading it).
     * Useful for content.js to decide whether to attempt cache-first restore.
     *
     * @param {number} [ttlMs]
     * @returns {boolean}
     */
    hasFeedState(ttlMs) {
      return this.loadFeedState(ttlMs) !== null;
    },

    // ── Invalidation ──────────────────────────────────────────────────────────

    /**
     * Clear feed state cache (but keep seed).
     * Called when content changes in a way that invalidates the cached state
     * (e.g., language change — headers need re-resolve, so state is meaningless).
     */
    clearFeedState() {
      _safeRemove(STATE_KEY);
    },

    /**
     * Clear everything — seed + state.
     * Called when user wants a completely fresh feed (manual refresh button,
     * or hard reset on app version change).
     */
    clearAll() {
      _safeRemove(SEED_KEY);
      _safeRemove(STATE_KEY);
    },

    // ── Constants exposed ─────────────────────────────────────────────────────
    DEFAULT_TTL_MS: DEFAULT_TTL_MS,
  };

  // ── Export ──────────────────────────────────────────────────────────────────
  M.FeedCache = FeedCache;

})(window.NavCoreModules = window.NavCoreModules || {});
