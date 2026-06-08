// Path:    assets/js/nav-core-modules/feed.js
// Purpose: FeedService v2 — Universal Explore Feed
//          Algorithmic recommendation engine: novelty scoring, size normalization,
//          diversity enforcement, card-priority slots, weighted top-K sampling,
//          soft-reset cycles. No external ML — pure deterministic algorithms.
//
//          Algorithms borrowed from production systems:
//            - UCB1 (Upper Confidence Bound): novelty bonus inverse-frequency term
//            - Netflix WRMF concept: size normalization via log-dampening
//            - Thompson Sampling concept: weighted top-K stochastic pick
//            - Hacker News ranking: time-decay inspiration for chunk-index penalty
//            - Mulberry32 PRNG: Bernstein & Schindler (2020) — passes PractRand 256GB
//
// Used by: content.js (renderFeed → loadNextPage)

// @ts-check
(function (M) {
  'use strict';

  const { CONFIG } = M;

  // ── Mulberry32 PRNG ─────────────────────────────────────────────────────────
  // WHY not LCG (v1): LCG has low-bit correlation — shuffles feel repetitive.
  //   Mulberry32 has no such pattern. Same speed, dramatically better distribution.
  // Ref: https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
  function _mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s |= 0;
      s += 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
    };
  }

  function _resolveName(v, lang) {
    if (!v || typeof v !== 'object') return String(v || '');
    return v[lang] || v.en || v.th || Object.values(v)[0] || '';
  }

  // ── Feed constants — no magic numbers anywhere ──────────────────────────────

  const FC = Object.freeze({
    // Chunk sizes
    CHUNK_BUTTON:     20,    // items per button segment
    CHUNK_CARD:       30,    // items per card segment (cards richer per slot)

    // ── Scoring weights ──────────────────────────────────────────────────────
    // WHY these values: hand-tuned so that on a typical Fantrove DB
    //   (3-4 button types × 20-50 categories, 2-3 card types × 5-20 categories)
    //   cards appear roughly every 3-4 segments on average.

    CARD_BASE_BOOST:  2.5,   // card-type segments score multiplier
    CARD_SLOT_BOOST:  1.6,   // extra multiplier when filling a card-priority slot
    NOVELTY_BASE:     2.0,   // novelty bonus: bonus = NOVELTY_BASE / (timesShown + 1)
    SIZE_NORM_EXP:    0.65,  // log₂(catSize)^EXP — dampens large-category dominance
    CHUNK_DECAY:      0.40,  // per-chunk score decay: chunk k → score × (1-DECAY)^k
    JITTER:           0.28,  // ±28% seeded random factor — prevents deterministic lock-in

    // ── Diversity windows ────────────────────────────────────────────────────
    DIV_WINDOW:       6,     // track last N catIds emitted
    DIV_PENALTY:      0.07,  // score multiplier for most-recently-seen catId (harshest)
    TYPE_WIN:         4,     // track last N groupTypes (button/card)
    TYPE_PENALTY:     0.22,  // multiplier when same-type streak fills entire TYPE_WIN

    // ── Card slot injection ──────────────────────────────────────────────────
    // WHY guaranteed slots: scoring alone may not surface cards early enough
    //   when there are many more button segments than card segments.
    //   Slot reservation ensures cards appear in prime viewport positions.
    COLD_CARD_COUNT:  2,     // first N slots are always card-priority (cold-start)
    CARD_SLOT_EVERY:  4,     // after cold slots: every Nth slot is card-priority

    // ── Soft-reset cycles ────────────────────────────────────────────────────
    // WHY soft (not hard) reset: hard reset = user sees exact same sequence.
    //   Soft reset decays show counts (partial memory) + new seed (new jitter) =
    //   content feels fresh while still prioritising truly-unseen categories first.
    SOFT_RESET_DECAY: 0.50,  // show-count multiplier on soft reset
    MAX_SOFT_RESETS:  5,     // total resets before feed signals exhaustion

    // ── Selection ────────────────────────────────────────────────────────────
    // WHY top-K not pure top-1: pure top-1 is deterministic after scoring.
    //   Top-K with weight-proportional sampling = controlled stochasticity.
    //   High-scored items are still likely chosen — just not guaranteed.
    TOP_K:            3,
  });

  // ── FeedService v2 — Universal Explore Feed ─────────────────────────────────

  const FeedService = {

    // ── Persistent across reset() ─────────────────────────────────────────────
    _copyableIds: null,  // Set<string> — resolved once from ConDataRegistry
    _dbRef:       null,  // reference to assembled DB (not copied)

    // ── Pool state — cleared by reset() ──────────────────────────────────────
    _buttonSegs:  [],  // all button-type segments (copyable content)
    _cardSegs:    [],  // all card-type segments (collection content)
    _masterPool:  [],  // all segments combined — read-only after init
    _unseenPool:  [],  // shrinks each cycle; refilled by _softReset()

    // ── Cycle state ───────────────────────────────────────────────────────────
    _softResets:    0,
    _isExhausted:   false,
    _isInitialized: false,
    _slotIndex:     0,

    // ── Scoring state ─────────────────────────────────────────────────────────
    _catShowCounts: null,  // Map<catId, number>
    _recentCats:    null,  // string[] newest at [0] (unshift/pop)
    _recentTypes:   null,  // string[] newest at end (push/shift)
    _rng:           null,
    _seed:          0,

    // ── Public: reset ──────────────────────────────────────────────────────────

    reset() {
      this._isInitialized = false;
      this._buttonSegs    = [];
      this._cardSegs      = [];
      this._masterPool    = [];
      this._unseenPool    = [];
      this._softResets    = 0;
      this._isExhausted   = false;
      this._slotIndex     = 0;
      this._catShowCounts = new Map();
      this._recentCats    = [];
      this._recentTypes   = [];
      // WHY mix Date.now() + Math.random(): prevents same seed on rapid re-navigation
      this._seed = (Date.now() ^ (Math.random() * 0x100000000 | 0)) >>> 0;
      this._rng  = _mulberry32(this._seed);
    },

    // ── Initialization ────────────────────────────────────────────────────────

    async _ensureInit() {
      if (this._isInitialized) return;
      await this._resolveCopyableIds();
      const db = await M.DataService.loadApiDatabase();
      this._dbRef = db;
      this._buildPools(db);
      this._unseenPool    = this._masterPool.slice();
      this._isInitialized = true;
    },

    async _resolveCopyableIds() {
      if (this._copyableIds) return;
      const knownKinds     = window.ConDataService?.registry?.knownKinds || {};
      this._copyableIds    = new Set(
        Object.entries(knownKinds)
          .filter(([, kind]) => kind === 'copyable')
          .map(([id]) => id)
      );
      // WHY fallback: ConDataRegistry may not expose knownKinds on older builds
      if (!this._copyableIds.size) {
        this._copyableIds.add('emoji');
        this._copyableIds.add('symbol');
      }
    },

    /**
    * Determine if a type is copyable (renders as button) or collection (renders as card).
    * Data-driven: reads kind from typeObj first, then falls back to knownKinds.
    * Default is 'copyable' — only explicitly marked 'collection' types are non-copyable.
    */
  _isTypeCopyable(typeObj) {
    // 1. Explicit kind on the type object itself (from data files)
    if (typeObj.kind) return typeObj.kind === 'copyable';
    // 2. Check against the resolved knownKinds set
   if (this._copyableIds.has(typeObj.id)) return true;
   // 3. Default: treat unknown types as copyable (safe default — only 'collection' is non-copyable)
    return true;
    },

    _buildPools(db) {
      this._buttonSegs = [];
      this._cardSegs   = [];
      for (const typeObj of (db?.type || [])) {
        this._collectTypeSegments(typeObj);
      }
      // WHY cards first in masterPool: helps cold-start card placement
      //   even before scoring kicks in at slot 0
      this._masterPool = [...this._cardSegs, ...this._buttonSegs];
    },

    // Extracted to keep _buildPools ≤ 2 nesting levels
    _collectTypeSegments(typeObj) {
      const isCopyable = this._copyableIds.has(typeObj.id);
      const target     = isCopyable ? this._buttonSegs : this._cardSegs;
      for (const cat of (typeObj.category || [])) {
        if (!cat.data?.length) continue;
        for (const seg of this._sliceCatIntoSegments(typeObj, cat, isCopyable)) {
          target.push(seg);
        }
      }
    },

    // Pure function — no side effects, returns frozen segment objects
    _sliceCatIntoSegments(typeObj, cat, isCopyable) {
      const chunkSize = isCopyable ? FC.CHUNK_BUTTON : FC.CHUNK_CARD;
      const groupType = isCopyable ? 'button' : 'card';
      const total     = cat.data.length;
      const out       = [];
      for (let offset = 0, ci = 0; offset < total; offset += chunkSize, ci++) {
        const slice = cat.data.slice(offset, offset + chunkSize);
        if (!slice.length) continue;
        out.push(Object.freeze({
          id:            `${typeObj.id}:${cat.id}:${ci}`,
          groupType,
          typeId:        typeObj.id,
          typeName:      typeObj.name,
          catId:         cat.id,
          catName:       cat.name,
          catTotalItems: total,
          chunkIndex:    ci,
          items:         slice,
        }));
      }
      return out;
    },

    // ── Scoring ───────────────────────────────────────────────────────────────
    //
    // score(seg) =
    //   100
    //   × [card boost] × [card-slot bonus]
    //   × [novelty: inverse shown-frequency]
    //   × [size-norm: dampens large-category dominance]
    //   × [chunk-decay: earlier chunks preferred]
    //   × [diversity penalty: penalises recently-seen catId]
    //   × [type-variety penalty: penalises same-type streak]
    //   × [jitter: ±28% seeded random]

    _score(seg, isCardSlot) {
      let s = 100;

      // 1. Card boost
      if (seg.groupType === 'card') {
        s *= FC.CARD_BASE_BOOST;
        if (isCardSlot) s *= FC.CARD_SLOT_BOOST;
      }

      // 2. Novelty — UCB1-inspired: unseen categories always surface first
      const shown = this._catShowCounts.get(seg.catId) || 0;
      s *= 1 + (FC.NOVELTY_BASE / (shown + 1));

      // 3. Size normalization — prevents emoji (1000+ items) dominating every page
      //    log₂(n)^0.65 grows slowly: emoji(1000)→6.6, small-cat(20)→2.2
      s *= 1 / Math.pow(Math.log2(seg.catTotalItems + 2), FC.SIZE_NORM_EXP);

      // 4. Chunk decay — chunk 0 (first 20 items) most representative of category
      s *= Math.pow(1 - FC.CHUNK_DECAY, seg.chunkIndex);

      // 5. Diversity penalty — sliding window, harshest at index 0 (most recent)
      const recentIdx = this._recentCats.indexOf(seg.catId);
      if (recentIdx !== -1) {
        const recency = recentIdx / (this._recentCats.length - 1 || 1); // 0=recent, 1=oldest
        s *= FC.DIV_PENALTY + recency * (1 - FC.DIV_PENALTY);
      }

      // 6. Type variety — penalise if last TYPE_WIN emissions all same groupType
      const typeWin = this._recentTypes.slice(-FC.TYPE_WIN);
      if (typeWin.length >= FC.TYPE_WIN && typeWin.every(t => t === seg.groupType)) {
        s *= FC.TYPE_PENALTY;
      }

      // 7. Seeded jitter — same seed within a page = reproducible within session
      //    but different seed each reset/reload = feed feels "alive"
      s *= 1 + (this._rng() - 0.5) * 2 * FC.JITTER;

      return Math.max(0.001, s);
    },

    // ── Card slot detection ───────────────────────────────────────────────────

    _isCardSlot(idx) {
      if (idx < FC.COLD_CARD_COUNT) return true;
      return ((idx - FC.COLD_CARD_COUNT) % FC.CARD_SLOT_EVERY) === 0;
    },

    // ── Weighted top-K selection ──────────────────────────────────────────────

    _selectNext() {
      if (!this._unseenPool.length) return null;

      const isCardSlot = this._isCardSlot(this._slotIndex);

      // Score + sort all unseen — O(n log n), typically n < 500
      const scored = this._unseenPool.map(seg => ({
        seg, score: this._score(seg, isCardSlot),
      }));
      scored.sort((a, b) => b.score - a.score);

      // Weighted proportional sample from top-K
      // WHY not pure top-1: two segments with score 950 vs 900 should both
      //   have a realistic chance, not 100%/0% split
      const K      = Math.min(FC.TOP_K, scored.length);
      const topK   = scored.slice(0, K);
      const total  = topK.reduce((acc, c) => acc + c.score, 0);
      let r        = this._rng() * total;
      let chosen   = topK[K - 1];  // safety fallback
      for (const c of topK) {
        r -= c.score;
        if (r <= 0) { chosen = c; break; }
      }

      // Remove from unseenPool by reference (O(n) — acceptable for pool size)
      const idx = this._unseenPool.indexOf(chosen.seg);
      if (idx !== -1) this._unseenPool.splice(idx, 1);

      return chosen.seg;
    },

    // ── State tracking ────────────────────────────────────────────────────────

    _trackEmission(seg) {
      this._catShowCounts.set(seg.catId, (this._catShowCounts.get(seg.catId) || 0) + 1);

      // newest catId at front of recentCats
      this._recentCats.unshift(seg.catId);
      if (this._recentCats.length > FC.DIV_WINDOW) this._recentCats.pop();

      // newest groupType at end of recentTypes
      this._recentTypes.push(seg.groupType);
      if (this._recentTypes.length > FC.TYPE_WIN + 2) this._recentTypes.shift();

      this._slotIndex++;
    },

    // ── Soft reset ────────────────────────────────────────────────────────────

    _softReset() {
      if (this._softResets >= FC.MAX_SOFT_RESETS) { this._isExhausted = true; return; }
      this._softResets++;

      // Decay show counts — partial amnesia so previously-seen cats aren't fully penalised
      for (const [catId, count] of this._catShowCounts) {
        const next = Math.round(count * FC.SOFT_RESET_DECAY);
        if (next === 0) this._catShowCounts.delete(catId);
        else            this._catShowCounts.set(catId, next);
      }

      // New seed per cycle → different jitter landscape → feed feels refreshed
      this._seed = (this._seed + 0x9E3779B9 + this._softResets * 0x45678901) >>> 0;
      this._rng  = _mulberry32(this._seed);

      // Clear diversity windows — new cycle starts without prejudice
      this._recentCats  = [];
      this._recentTypes = [];

      // Replenish pool with all segments
      this._unseenPool = this._masterPool.slice();
    },

    // ── Public: loadNextPage ──────────────────────────────────────────────────

    /**
     * Load N segments for the next feed page.
     * Same public signature as v1 — content.js requires no changes.
     *
     * @param {string} lang
     * @param {number} [n=12]
     * @returns {Promise<{groups: Array, hasMore: boolean}>}
     */
    async loadNextPage(lang, n = 12) {
      await this._ensureInit();
      if (this._isExhausted || !this._masterPool.length) return { groups: [], hasMore: false };

      const groups = [];

      for (let i = 0; i < n; i++) {
        if (!this._unseenPool.length) {
          this._softReset();
          if (this._isExhausted) break;
        }
        const seg   = this._selectNext();
        if (!seg) break;
        const group = this._buildGroup(seg, lang);
        if (group) { groups.push(group); this._trackEmission(seg); }
      }

      const hasMore = !this._isExhausted
        && (this._unseenPool.length > 0 || this._softResets < FC.MAX_SOFT_RESETS);

      return { groups, hasMore };
    },

    _buildGroup(seg, lang) {
      if (!seg?.items?.length) return null;
      return {
        group: {
          type:   seg.groupType,
          header: {
            title:       _resolveName(seg.catName,  lang),
            description: _resolveName(seg.typeName, lang),
            className:   'auto-category-header',
          },
          items: seg.items,
        },
      };
    },

    /** Called on language change — headers must re-resolve with new lang */
    invalidate() { this.reset(); },
  };

  // ── Export ──────────────────────────────────────────────────────────────────
  M.FeedService = FeedService;

})(window.NavCoreModules = window.NavCoreModules || {});