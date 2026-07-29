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
// v2.1 — Per-user persistent feed (discovery focus):
//          - Seed is now persisted in localStorage via FeedCache (TTL 30 min)
//          - Different users → different seeds → different feed orders
//          - Same user within TTL → same feed (feels "delivered", not regenerated)
//          - After TTL → new seed → fresh feed rotation
//          - Feed state (emitted IDs, show counts) also persisted → resume scrolling
//            exactly where left off, even after closing the tab
//
// Used by: content.js (renderFeed → loadNextPage)
// Depends: feed-cache.js (Phase 2 — must load before this in Phase 3)

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

    // ── Emission tracking (v2.1) ──────────────────────────────────────────────
    // WHY emittedIds: lets us rebuild unseenPool accurately on restore from
    //   FeedCache without storing the full segment objects (which would be too
    //   large for localStorage). We store just the seg.id values in order,
    //   then on restore, remove those segments from the unseenPool.
    _emittedIds:    null,  // string[] — ordered list of emitted seg.id

    // ── Public: reset ──────────────────────────────────────────────────────────

    /**
     * Reset feed state.
     *
     * v2.1: Seed is now sourced from FeedCache — persists across page loads
     *   within the TTL window (default 30 min, configurable via CONFIG).
     *   This means:
     *     - Different users → different seeds → different feed orders
     *     - Same user within TTL → same seed → same feed order
     *     - After TTL → FeedCache generates a new seed → fresh feed
     *
     *   If FeedCache is unavailable (older build, module load failure),
     *   falls back to the original Date.now() ^ Math.random() behavior —
     *   the feed still works, just doesn't persist across sessions.
     */
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
      this._emittedIds    = [];

      // v2.1: clear any pending lightweight restore — reset() means start fresh,
      //   so a stale _pendingRestore from a previous tryRestoreFromCache() call
      //   must not leak into the new feed cycle
      this._pendingRestore = null;

      // v2.1: persistent per-user seed via FeedCache
      // WHY: see module header — gives users a stable feed within TTL while
      //   still being different per browser
      const ttlMs = M.CONFIG?.ALL_BUTTON?.FEED_SEED_TTL;
      if (M.FeedCache && typeof M.FeedCache.getOrCreateSeed === 'function') {
        this._seed = M.FeedCache.getOrCreateSeed(ttlMs);
      } else {
        // Fallback: original behavior (graceful degradation)
        this._seed = (Date.now() ^ (Math.random() * 0x100000000 | 0)) >>> 0;
      }
      this._rng = _mulberry32(this._seed);
    },

    // ── Initialization ────────────────────────────────────────────────────────

    async _ensureInit() {
      if (this._isInitialized) return;
      await this._resolveCopyableIds();
      const db = await M.DataService.loadApiDatabase();
      this._dbRef = db;
      this._buildPools(db);
      this._unseenPool = this._masterPool.slice();
      this._isInitialized = true;

      // ── v2.1: Apply pending lightweight restore (from FeedCache) ────────────
      //   หลัง build pools จาก DB แล้ว ถ้ามี pendingRestore ให้ apply state
      //   และตัด emitted IDs ออกจาก unseenPool เพื่อ resume ที่เดิม
      if (this._pendingRestore) {
        const pr = this._pendingRestore;
        this._pendingRestore = null;

        this._softResets    = pr.softResets || 0;
        this._isExhausted   = pr.isExhausted || false;
        this._slotIndex     = pr.slotIndex || 0;
        this._catShowCounts = new Map(pr.catShowCounts || []);
        this._recentCats    = pr.recentCats.slice();
        this._recentTypes   = pr.recentTypes.slice();
        this._emittedIds    = pr.emittedIds.slice();

        // ตัด emitted IDs ออกจาก unseenPool
        if (pr.emittedIds.length && this._unseenPool.length) {
          const emitted = new Set(pr.emittedIds);
          this._unseenPool = this._unseenPool.filter(seg => !emitted.has(seg.id));
        }

        // ถ้า unseenPool ว่างแล้ว แต่ยังไม่ exhausted → trigger softReset
        if (!this._unseenPool.length && !this._isExhausted
            && this._softResets < FC.MAX_SOFT_RESETS) {
          this._softReset();
        }
      }
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

      // v2.3: เพิ่ม collection segments ลงใน card pool
      //   แต่ละ collection = 1 card segment (1 collection = 1 card)
      //   WHY: ทำให้ collection cards ปรากฏใน feed ตาม scoring algorithm
      //   ไม่ต้องเปลี่ยนโครงสร้าง feed — collection segments ใช้ path เดียวกับ card segments
      this._collectCollectionSegments(db);

      // WHY cards first in masterPool: helps cold-start card placement
      //   even before scoring kicks in at slot 0
      this._masterPool = [...this._cardSegs, ...this._buttonSegs];
    },

    // Extracted to keep _buildPools ≤ 2 nesting levels
    _collectTypeSegments(typeObj) {
      // v2.3: ใช้ _isTypeCopyable() ที่รองรับ kind field
      //   แทนที่จะดูแค่ _copyableIds — ตรวจ kind จาก typeObj ด้วย
      const isCopyable = this._isTypeCopyable(typeObj);
      const target     = isCopyable ? this._buttonSegs : this._cardSegs;
      for (const cat of (typeObj.category || [])) {
        if (!cat.data?.length) continue;
        // v2.3: collection type ข้าม — _collectCollectionSegments จะจัดการแยก
        //   WHY: collection category แตกต่าง — 1 collection = 1 card, ไม่ chunk เหมือน copyable
        if (!isCopyable && typeObj.kind === 'collection') continue;
        for (const seg of this._sliceCatIntoSegments(typeObj, cat, isCopyable)) {
          target.push(seg);
        }
      }
    },

    // v4.0: Collect collection segments — each collection = 1 container segment
    //   WHY: แยกจาก _collectTypeSegments เพราะ collection มี data model ต่างกัน
    //   v4.0: Container pattern — Spotify/Netflix/YouTube inspired:
    //     1 collection = 1 container that shows:
    //     - Collection name as section header
    //     - Preview items (subset, horizontal scroll)
    //     - "View All" button → navigates to collection page
    //   Container shows partial content → click "View All" to see full collection
    //   This is how major platforms display collections/playlists/categories
    _collectCollectionSegments(db) {
      // หา type ที่เป็น collection
      const collectionType = (db?.type || []).find(t =>
        t.kind === 'collection' || t.id === 'collections'
      );
      if (!collectionType) return;

      // แต่ละ category ใน collection type = 1 collection = 1 container segment
      for (const cat of (collectionType.category || [])) {
        if (!cat.data?.length) continue;

        // v4.0: Build container data — include collection metadata + preview items + link
        //   WHY: Container needs: name, description, preview items, link to full page
        //   Preview items are a subset (max 8) displayed in a horizontal scroll row
        //   "View All" button navigates to the dedicated collection page
        const collectionContainer = {
          _type:             'collection-container',
          id:                cat.id,
          name:              cat.name || {},
          title:             cat.name || {},
          description:       cat.description || {},
          cover:             cat.cover || null,
          items:             cat.data,              // full items list (container decides preview subset)
          previewItems:      cat.data.slice(0, 8),  // subset for preview display
          itemCount:         cat.data.length,
          typeId:            collectionType.id,
          typeName:          collectionType.name || {},
          link:              '/collections/' + cat.id + '/',
          _collectionId:     cat.id,
          _itemCount:        cat.data.length,
        };

        // 1 collection = 1 container segment (groupType: 'collection-container')
        // WHY: not 'card' — container has different rendering logic than individual cards
        //   ContentService._tpl handles 'collection-container' type specially
        this._cardSegs.push(Object.freeze({
          id:            `collections:${cat.id}:0`,
          groupType:     'collection-container',
          typeId:        collectionType.id,
          typeName:      collectionType.name || {},
          catId:         cat.id,
          catName:       cat.name || {},
          catTotalItems: cat.data.length,
          chunkIndex:    0,
          items:         [collectionContainer],
        }));
      }
    },

    // v3.0: แปลง Unicode ID → ตัวอักษร (สำหรับ cover preview)
    //   WHY: collection cover.items เป็น Unicode IDs เช่น "U+2764"
    //   ต้องแปลงเป็นตัวอักษรจริงเพื่อแสดง preview บน card
    _unicodeIdToChar(unicodeId) {
      if (!unicodeId || typeof unicodeId !== 'string') return '';
      // ถ้าไม่ใช่รูปแบบ U+XXXX → คืนค่าเดิม (อาจเป็นตัวอักษรอยู่แล้ว)
      if (!unicodeId.startsWith('U+')) return unicodeId;
      const match = unicodeId.match(/^U\+([0-9A-Fa-f]{4,6})$/);
      if (!match) return unicodeId;
      const codePoint = parseInt(match[1], 16);
      if (isNaN(codePoint) || codePoint < 0 || codePoint > 0x10FFFF) return unicodeId;
      try { return String.fromCodePoint(codePoint); } catch (e) { return unicodeId; }
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

      // v2.1: track emitted segment IDs for cache restore
      if (this._emittedIds) this._emittedIds.push(seg.id);

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

      // v2.1: Clear emittedIds — new cycle means all segments are eligible again
      //   (with decayed novelty scores). Without this, restore would over-filter
      //   segments that were emitted in previous cycles but should be allowed
      //   to reappear in the new cycle.
      this._emittedIds = [];

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

      // v4.0: ถ้า segment เป็น collection-container → แสดงเป็น container (Spotify/Netflix style)
      //   Container แสดง: ชื่อ, คำอธิบาย, preview items (subset), "View All" button
      //   ต่างจาก card — container มี header + items row + action button
      const isCollectionContainer = seg.groupType === 'collection-container'
        || (seg.items[0] && seg.items[0]._type === 'collection-container');

      if (isCollectionContainer) {
        const col = seg.items[0]; // 1 collection = 1 container
        if (!col) return null;

        return {
          group: {
            type:   'collection-container',
            header: null,
            items:  [col], // pass full container data to _tplCollectionContainer
          },
        };
      }

      // v3.0: ถ้า segment เป็น collection card → แสดงเป็น card พิเศษ
      //   collection card มี _type='collection-card' และข้อมูลคอลเลกชัน
      //   v3.0: ตอนนี้ collectionCard มี coverPreview และ link คำนวณไว้ล่วงหน้าแล้ว
      //   จาก _collectCollectionSegments() — ใช้ได้ทันที ไม่ต้องคำนวณซ้ำ
      const isCollectionCard = seg.typeId === 'collections'
        || (seg.items[0] && seg.items[0]._type === 'collection-card');

      if (isCollectionCard) {
        const col = seg.items[0]; // 1 collection = 1 card
        if (!col) return null;

        // v3.0: ใช้ coverPreview ที่คำนวณไว้ล่วงหน้าจาก _collectCollectionSegments
        //   WHY: ไม่ต้องคำนวณซ้ำ — ลด code duplication + ประสิทธิภาพดีกว่า
        //   Fallback: ถ้าไม่มี coverPreview → คำนวณจาก cover.items หรือ items
        let coverPreview = col.coverPreview || '';
        if (!coverPreview) {
          let previewItems;
          if (col.cover && Array.isArray(col.cover.items) && col.cover.items.length) {
            previewItems = col.cover.items.slice(0, 4).map(apiCode => {
              if (apiCode.startsWith('U+')) {
                const cleaned = apiCode.replace(/^U\+/i, '').replace(/\s+FE0F$/i, '');
                try { return String.fromCodePoint(parseInt(cleaned, 16)); } catch (_) { return ''; }
              }
              return apiCode;
            }).filter(Boolean);
          } else {
            previewItems = (col.items || []).slice(0, 4);
          }
          coverPreview = previewItems
            .map(item => typeof item === 'object' ? (item.text || '') : item)
            .filter(Boolean)
            .join(' ');
        }

        // สร้าง description จากข้อมูลที่มี
        const desc = col.description
          ? _resolveName(col.description, lang)
          : `${_resolveName(seg.typeName, lang)} · ${col.itemCount || (col.items || []).length} items`;

        // v3.1: ไม่มี header สำหรับ collection card segment — redundant
        //   WHY: card มี title + description อยู่แล้ว → header ซ้ำซ้อน
        //   ใน feed แสดง collection card โดยตรง ไม่มีแถบส่วนหัว
        return {
          group: {
            type:   'card',
            header: null,  // ไม่มี header — card แสดงผลโดยตรง
            items: [{
              _type:         'card',
              title:         col.name || col.title || {},
              description:   desc,
              image:         null,
              coverPreview:  coverPreview,
              link:          col.link || `/collections/${seg.catId}`,
              className:     col.className || 'collection-card',
              _collectionId: col._collectionId || seg.catId,
              _itemCount:    col._itemCount || col.itemCount || (col.items || []).length,
            }],
          },
        };
      }

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

    /**
     * Called on language change — headers must re-resolve with new lang.
     *
     * v2.1: state ใน FeedCache เป็น language-agnostic (เก็บแค่ IDs + counts
     *   ไม่เก็บ header text) จึงไม่จำเป็นต้อง clear ทิ้ง เมื่อเปลี่ยนภาษา
     *   แค่ reset in-memory state เพื่อ re-render จากต้นด้วยภาษาใหม่
     *   แต่ localStorage state ยังอยู่ → ครั้งถัดไป resume ได้ที่เดิม
     */
    invalidate() {
      this.reset();
    },

    // ── State save/restore (for RouteCache — X-style preservation) ────────────
    //
    // snapshot() / restore(snap) ช่วยให้ feed route สามารถ "จดจำ" สถานะได้
    // เมื่อ user ไปหน้าอื่นแล้วกลับมา — content และ scroll position ยังเหมือนเดิม
    //
    // ข้อควรระวัง:
    //   - _rng (function) ไม่ serialize ได้ → สร้างใหม่จาก _seed ตอน restore
    //   - _catShowCounts (Map) → แปลงเป็น Array ตอน snapshot และกลับ
    //   - _copyableIds, _dbRef เป็น persistent state — ไม่อยู่ใน snapshot
    //     (restore จะ re-resolve ผ่าน _ensureInit ถ้ายังไม่ initialized)

    /**
     * Snapshot state ปัจจุบัน — ใช้บันทึกลง RouteCache หรือ FeedCache
     * v2.1: เพิ่ม emittedIds เพื่อให้ restore จาก FeedCache สามารถ rebuild
     *   unseenPool ได้ถูกต้องโดยไม่ต้องเก็บ full segment objects
     * @returns {object|null}
     */
    snapshot() {
      if (!this._isInitialized) return null;
      return {
        buttonSegs:    this._buttonSegs.slice(),
        cardSegs:      this._cardSegs.slice(),
        masterPool:    this._masterPool.slice(),
        unseenPool:    this._unseenPool.slice(),
        softResets:    this._softResets,
        isExhausted:   this._isExhausted,
        isInitialized: this._isInitialized,
        slotIndex:     this._slotIndex,
        // Map → Array of [key, value] for JSON serialization
        catShowCounts: this._catShowCounts ? Array.from(this._catShowCounts.entries()) : [],
        recentCats:    this._recentCats ? this._recentCats.slice() : [],
        recentTypes:   this._recentTypes ? this._recentTypes.slice() : [],
        seed:          this._seed,
        // v2.1: ordered list of emitted segment IDs — lets us rebuild unseenPool
        //   accurately on restore without persisting the full segments
        emittedIds:    this._emittedIds ? this._emittedIds.slice() : [],
      };
    },

    /**
     * Restore state จาก snapshot — ใช้ตอนกลับมาหน้า feed จาก RouteCache หรือ FeedCache
     *
     * v2.1: รองรับ lightweight snapshot จาก FeedCache ที่มีแค่ emittedIds
     *   (ไม่มี buttonSegs/cardSegs/masterPool/unseenPool)
     *   ถ้าเป็น lightweight snapshot → จะ rebuild pools จาก DB แล้วตัด emitted IDs ออก
     *
     * @param {object} snap
     */
    restore(snap) {
      if (!snap) {
        this.reset();
        return;
      }

      // ── v2.1: Lightweight restore path (from FeedCache) ────────────────────
      //   snap มีแค่ emittedIds + state (no segment arrays) → เป็น cache hit
      //   เราต้อง rebuild pools จาก DB ก่อน แล้วค่อยตัด emitted IDs ออก
      const isLightweight = !snap.isInitialized && !Array.isArray(snap.masterPool)
        && Array.isArray(snap.emittedIds);

      if (isLightweight) {
        this.reset(); // ตั้งค่า seed + state เริ่มต้น
        // บันทึก state ที่จะ restore ทับหลัง _ensureInit
        this._pendingRestore = {
          softResets:    snap.softResets || 0,
          isExhausted:   !!snap.isExhausted,
          slotIndex:     snap.slotIndex || 0,
          catShowCounts: Array.isArray(snap.catShowCounts) ? snap.catShowCounts : [],
          recentCats:    Array.isArray(snap.recentCats) ? snap.recentCats.slice() : [],
          recentTypes:   Array.isArray(snap.recentTypes) ? snap.recentTypes.slice() : [],
          emittedIds:    snap.emittedIds.slice(),
        };
        return;
      }

      // ── Full restore path (from RouteCache) ────────────────────────────────
      if (!snap.isInitialized) {
        this.reset();
        return;
      }

      this._buttonSegs    = Array.isArray(snap.buttonSegs) ? snap.buttonSegs.slice() : [];
      this._cardSegs      = Array.isArray(snap.cardSegs) ? snap.cardSegs.slice() : [];
      this._masterPool    = Array.isArray(snap.masterPool) ? snap.masterPool.slice() : [];
      this._unseenPool    = Array.isArray(snap.unseenPool) ? snap.unseenPool.slice() : [];
      this._softResets    = snap.softResets || 0;
      this._isExhausted   = !!snap.isExhausted;
      this._isInitialized = true; // assume persistent state (_copyableIds, _dbRef) still valid
      this._slotIndex     = snap.slotIndex || 0;

      // Array → Map
      this._catShowCounts = new Map(Array.isArray(snap.catShowCounts) ? snap.catShowCounts : []);
      this._recentCats    = Array.isArray(snap.recentCats) ? snap.recentCats.slice() : [];
      this._recentTypes   = Array.isArray(snap.recentTypes) ? snap.recentTypes.slice() : [];
      this._emittedIds    = Array.isArray(snap.emittedIds) ? snap.emittedIds.slice() : [];

      // Recreate _rng from saved seed (function ไม่ serialize ได้)
      this._seed = snap.seed || ((Date.now() ^ (Math.random() * 0x100000000 | 0)) >>> 0);
      this._rng  = _mulberry32(this._seed);

      // ตรวจว่า persistent state ยัง valid ไหม — ถ้าไม่ ให้ re-resolve
      if (!this._copyableIds) {
        // _resolveCopyableIds และ _dbRef จะถูก set ใน _ensureInit ครั้งถัดไป
        // _isInitialized = true จะทำให้ _ensureInit return ทันที → ต้อง force re-init
        this._isInitialized = false;
      }
    },

    /**
     * ตรวจสถานะ — ใช้ใน RouteCache เพื่อตัดสินใจว่า snapshot valid ไหม
     */
    canResume() {
      return this._isInitialized && this._masterPool.length > 0;
    },

    // ── v2.1: FeedCache integration ────────────────────────────────────────────

    /**
     * ลอง restore state จาก FeedCache (localStorage).
     * ใช้เป็น cache-first path ใน content.js renderFeed ก่อนเรียก reset
     *
     * @param {number} [ttlMs] TTL — default ใช้ CONFIG.ALL_BUTTON.FEED_SEED_TTL
     * @returns {boolean} true ถ้า restore สำเร็จ (state ถูก queue ไว้ใน _pendingRestore
     *                   และจะถูก apply ใน _ensureInit ครั้งถัดไป)
     */
    tryRestoreFromCache(ttlMs) {
      if (!M.FeedCache || typeof M.FeedCache.loadFeedState !== 'function') return false;

      const ttl = (typeof ttlMs === 'number' && ttlMs > 0)
        ? ttlMs
        : (M.CONFIG?.ALL_BUTTON?.FEED_SEED_TTL);

      const cached = M.FeedCache.loadFeedState(ttl);
      if (!cached) return false;

      // ตั้ง seed ให้ตรงกับ cache ก่อน (สำคัญ — seed ต้องตรงจึงจะ reproduce ลำดับเดิมได้)
      this._seed = (cached.seed || 0) >>> 0;
      this._rng  = _mulberry32(this._seed);

      // queue restore — จะ apply หลัง _ensureInit สร้าง pools เสร็จ
      this._pendingRestore = {
        softResets:    cached.softResets || 0,
        isExhausted:   !!cached.isExhausted,
        slotIndex:     cached.slotIndex || 0,
        catShowCounts: Array.isArray(cached.catShowCounts) ? cached.catShowCounts : [],
        recentCats:    Array.isArray(cached.recentCats) ? cached.recentCats.slice() : [],
        recentTypes:   Array.isArray(cached.recentTypes) ? cached.recentTypes.slice() : [],
        emittedIds:    Array.isArray(cached.emittedIds) ? cached.emittedIds.slice() : [],
      };

      // reset flag ให้ _ensureInit ทำงาน
      this._isInitialized = false;
      this._buttonSegs    = [];
      this._cardSegs      = [];
      this._masterPool    = [];
      this._unseenPool    = [];

      return true;
    },

    /**
     * บันทึก state ปัจจุบันลง FeedCache (localStorage) — เรียกหลัง loadNextPage
     *   เพื่อให้ครั้งถัดไป resume ได้จากจุดเดิม
     */
    saveToCache() {
      if (!M.FeedCache || typeof M.FeedCache.saveFeedState !== 'function') return;
      if (!this._isInitialized) return;
      try {
        M.FeedCache.saveFeedState({
          seed:          this._seed,
          softResets:    this._softResets,
          isExhausted:   this._isExhausted,
          slotIndex:     this._slotIndex,
          catShowCounts: this._catShowCounts ? Array.from(this._catShowCounts.entries()) : [],
          recentCats:    this._recentCats ? this._recentCats.slice() : [],
          recentTypes:   this._recentTypes ? this._recentTypes.slice() : [],
          emittedIds:    this._emittedIds ? this._emittedIds.slice() : [],
        });
      } catch (_) {
        // swallow — saving to cache is best-effort, never block feed rendering
      }
    },
  };

  // ── Export ──────────────────────────────────────────────────────────────────
  M.FeedService = FeedService;

})(window.NavCoreModules = window.NavCoreModules || {});