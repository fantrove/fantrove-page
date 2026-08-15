# Fantrove Feed System v2.1 — Per-User Persistent Discovery Feed

## What changed

The discover-page feed now randomizes content **per user** (per browser) and
**persists** the randomized order in `localStorage` for a configurable TTL
(default 30 minutes). Within the TTL window, every refresh / re-visit shows the
same feed — so it feels "delivered" rather than "re-rolled every time". After
TTL expires, a fresh seed is generated → new feed rotation.

The user also resumes scrolling exactly where they left off, even after closing
the tab and coming back within the TTL window.

## Files in this package

| File | Status | Purpose |
|---|---|---|
| `feed-cache.js` | **NEW** | FeedCache module — localStorage-backed seed + state with TTL |
| `feed.js` | MODIFIED | FeedService v2.1 — uses FeedCache for seed + state restore/save |
| `content.js` | MODIFIED | renderFeed now calls `tryRestoreFromCache()` before `reset()`; saves to cache after every page |
| `config.js` | MODIFIED | Adds `FEED_SEED_TTL: 30 * 60 * 1000` to `ALL_BUTTON` |
| `nav-core.js` | MODIFIED | Adds `feed-cache.js` to Phase 2 of the module loader |

## How to install

### Option A — apply the patch

From the root of your local `fantrove-page` clone:

```bash
git apply feed-system-v2.1.patch
# Then copy the new file (not tracked by patch since it's a new file)
cp feed-cache.js assets/js/nav-core-modules/feed-cache.js
```

### Option B — copy files directly

Copy each file to its corresponding path under `assets/js/`:

```
feed-cache.js → assets/js/nav-core-modules/feed-cache.js   (NEW)
feed.js       → assets/js/nav-core-modules/feed.js
content.js    → assets/js/nav-core-modules/content.js
config.js     → assets/js/nav-core-modules/config.js
nav-core.js   → assets/js/nav-core.js
```

No build step is required — these are plain ES5-compatible modules loaded
dynamically by `nav-core.js`.

## How it works (architectural summary)

### Seed strategy

```
Old (v2.0):  _seed = Date.now() ^ Math.random()
             → new seed every reset()
             → every page load = brand-new feed order
             → effectively all users see a "fresh" feed (no real personalization)

New (v2.1):  _seed = FeedCache.getOrCreateSeed()
             → seed persisted in localStorage with timestamp
             → within TTL (30 min): same seed = same feed order
             → different browsers → different seeds → different feeds
             → after TTL: new seed generated → fresh rotation
```

### State persistence

Feed state (which segments were already emitted, per-category show counts,
diversity windows, soft-reset progress, slot index) is also persisted to
`localStorage` so the user resumes exactly where they left off.

What we store (lightweight, < 50 KB typically):
- `seed`, `softResets`, `isExhausted`, `slotIndex` — cycle progress
- `catShowCounts` (as entries array) — novelty tracking
- `recentCats`, `recentTypes` — diversity windows
- `emittedIds` (ordered list of segment IDs) — lets us rebuild the unseen
  pool accurately on restore without storing full segment objects

What we **do not** store:
- Full segment objects (too big — they're deterministically rebuilt from DB +
  seed)
- DOM snapshots (content.js handles its own DOM via RouteCache)

### Cache-first flow in `content.js → renderFeed()`

```
1. Try RouteCache (in-session, 5 min TTL) → if hit, restore DOM + state + scroll
2. Else → try FeedCache (localStorage, 30 min TTL) → if hit, queue state restore
3. Else → FeedService.reset() → FeedCache.getOrCreateSeed() (may return same seed if within TTL)
4. After loadNextPage() → FeedService.saveToCache()  ← persists for next visit
```

### Storage layout (localStorage keys)

- `fv_feed_seed_v1`: `{ seed:number, createdAt:number }`
- `fv_feed_state_v1`: `{ seed, softResets, isExhausted, slotIndex, catShowCounts, recentCats, recentTypes, emittedIds, savedAt }`

Both keys are versioned (`_v1` suffix) for future schema migrations.

### Graceful degradation

- If `localStorage` is unavailable (private browsing, quota exceeded) → FeedCache
  silently degrades; the feed still works, just doesn't persist across reloads.
- If `FeedCache` module fails to load → `FeedService.reset()` falls back to the
  original `Date.now() ^ Math.random()` seed behavior.
- If a cached state's seed doesn't match the current seed (user cleared seed
  manually, or seed was refreshed) → state is discarded as stale.

## Configuration

In `config.js → ALL_BUTTON`:

```js
FEED_SEED_TTL: 30 * 60 * 1000,  // 30 minutes — adjust to taste
```

- Shorter TTL → feed feels fresher, less persistent
- Longer TTL → feed feels more "delivered", more stable across visits

## Alignment with discovery focus

This change directly serves the project's pivot toward **discovery as the core
feature**:

1. **Different users see different content** — per-browser seed breaks the
   "everyone sees the same feed" anti-pattern of v2.0.
2. **Feed feels delivered, not re-rolled** — within TTL, the same feed greets
   the user across visits, reinforcing the sense of a personalized discovery
   surface.
3. **Resume where you left off** — even after closing the tab, users return to
   the same point in their feed, supporting long discovery sessions.
4. **Fresh rotation over time** — TTL-based seed refresh ensures content
   doesn't go stale over a day, keeping discovery feeling alive.

## Validation

All 5 files pass `node --check` syntax validation. No build step required.
