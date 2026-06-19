---
version: 1.7.0
date: 2026-06-19T08:20:00.693Z
title: FVL — New Loading Framework + Discover Page Overhaul
subtitle: Introduced FVL (FantroveVerse Loader), a flexible loading framework with 4 display modes (fullscreen, scoped, inline, topbar), and completely reworked the loading experience on the Discover page — now smarter, more resilient to rapid clicking, and visually consistent with the bottom navigation.
notify: true
---

### New

- **FVL (FantroveVerse Loader) v1.0.3 — new loading framework**
  A standalone loading framework separated from Nav-Core. Single-file hybrid architecture (~50KB JS + ~17KB CSS, zero dependencies) supporting 4 display modes: `fullscreen` (overlay below header), `scoped` (covers a specific container), `inline` (spinner inside a button), and `topbar` (NProgress-style progress bar). Includes i18n support, theme variants (light/dark/brand/auto), `prefers-reduced-motion` support, and a `Promise`-based API with system events.

- **Navigation Session Pattern — rapid-click safe**
  The new LoadingService proxy uses a session counter: each `show()` opens a session, each `hide()` closes one. The overlay is only hidden when ALL sessions are closed. This eliminates race conditions that previously left the loading overlay stuck on screen after rapid clicking — tested stable through 30+ rapid clicks in under 1 second.

- **Smart loading messages on Discover page**
  When navigating between categories (Symbols, Emojis, Fancy Text, etc.), the loading overlay now shows contextual messages like "Loading Symbols..." or "กำลังโหลดสัญลักษณ์..." instead of a generic "Loading...". The message is resolved from the active button's label in the user's selected language.

- **Hide buttons during navigation**
  When a navigation is in progress, the main nav buttons and sub-nav fade out (opacity: 0, pointer-events: none) and become non-interactive. This prevents users from clicking another category mid-fetch and provides a clear visual signal that "we're switching". Buttons fade back in once content is ready.

- **Cache-busting for nav-core sub-modules**
  `nav-core.js` now propagates its `?v=...` query string to every sub-module it loads from `nav-core-modules/`. Previously, browsers cached `loading.js`, `router.js`, etc. independently — meaning code changes to those files never reached users until they hard-refreshed. Now bumping the version on the `<script src="nav-core.js?v=...">` tag in HTML busts the cache for all 13 sub-modules at once.

### Improved

- **Loading overlay respects bottom navigation**
  The fullscreen loading overlay now sits BEHIND the bottom navigation bar (z-index 15999 < 16000), so the bottom nav remains visible and clickable while loading is in progress. On mobile, the overlay leaves 64px + safe-area at the bottom; on desktop (≥768px), it leaves 88px at the left for the left-rail navigation.

- **Spinner positioning**
  The spinner is now centered in the VISIBLE area (between header and bottom nav), not the full viewport. This makes the loading state feel intentional rather than covering important UI elements.

- **Minimum display time (250ms)**
  Once the loading overlay IS visible, it stays for at least 250ms before hiding — even if the underlying load finishes in <50ms. This prevents 1-frame flashes that look like rendering glitches and gives users clear visual feedback that a transition happened.

- **Demo page for FVL**
  Added a new demo page at `/loading-demo/` that showcases all 4 display modes with live buttons, real-time stats panel, and an event log. Useful for testing and for new developers learning the framework.

### Fixed

- **Loading overlay stuck on screen after rapid clicking**
  Previously, rapid clicking (10+ clicks in 1 second) could leave the loading overlay stuck on screen indefinitely, requiring a page refresh. The root cause was state-vs-DOM desync: FVL's internal state recorded the instance as hidden, but the DOM element was never removed. Fixed by switching to a session-counter pattern in LoadingService and adding cancel-safe hide logic in FVL.

- **Loading overlay not appearing in Discover page**
  On cached loads (load time <15ms), the smart-delay timer was cancelled by `hide()` before the overlay ever appeared — so users saw no loading feedback at all. Fixed by removing the smart-delay timer entirely and using the session pattern instead, which guarantees the overlay shows whenever at least one session is open.

- **FVL.show() idempotency broken when state='hiding'**
  When `FVL.show()` was called while an existing instance was in the `hiding` state (mid-leave-animation), it returned the existing handle without restarting the enter animation — leaving the overlay in a stuck half-hidden state. Fixed by detecting the `hiding` state explicitly: cancel the pending leave timer, restore the `fvl-shown` class, force a reflow to restart the transition, and emit a fresh `shown` event.

- **Browser cache served stale nav-core sub-modules**
  Because `nav-core.js` loaded sub-modules without propagating its own `?v=...` query string, browsers served cached versions of `loading.js`, `router.js`, etc. even after deployment. This meant code changes (including bug fixes) didn't reach users until they hard-refreshed. Fixed by extracting the query string from the nav-core.js script tag and appending it to every sub-module URL.

- **Init.js unbalanced LoadingService session counter**
  The bootstrap flow in `init.js` called `LoadingService.show()` in Phase 3 but never called `hide()` to balance it — leaving the session counter at 1 forever and preventing the overlay from ever disappearing. Fixed by adding a `hide()` call in the `finally` block of `InitService.start()`.

- **Router safety timeout didn't reset loading state**
  When the 20-second navigation safety timeout fired, it called `LoadingService.hide()` — but if there were pending unbalanced `show()` calls, the session counter stayed above 0 and the overlay remained visible. Fixed by switching the safety timeout to use `LoadingService._forceReset()`, which zeroes the counter and hides the overlay immediately.
