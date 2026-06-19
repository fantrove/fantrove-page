---
version: 1.7.1
date: 2026-06-19T09:18:05.948Z
title: Loading System Re-architected — No Delay, Always Consistent
subtitle: Completely reworked the LoadingService proxy and FVL hide logic to eliminate the state-vs-DOM desync bug that caused the loading overlay to get permanently stuck after rapid clicking. The new architecture has NO smart delay and NO minimum display time — the overlay shows and hides immediately based on FVL's actual state, which is always consistent with the DOM.
notify: true
---

### Fixed

- **Loading overlay stuck on screen after rapid clicking (the real fix)**
  The v1.7.0 session-counter design still had a critical flaw: it cached a `_visible` flag and used a `_hideDeferTimer` to enforce minimum display time. Under rapid clicking, this cached flag could drift from FVL's actual state — LoadingService would think the overlay was visible (so it skipped calling `FVL.show()`), but FVL had already removed the DOM element during a hide animation. The result: the overlay would never re-appear even when sessions were open, OR it would get stuck visible after all sessions closed, requiring a page refresh.
  
  The v1.7.1 design eliminates the cached flag entirely. `show()` now ALWAYS forwards to `FVL.show()` (which is idempotent — calling it on an already-shown instance just updates the message; calling it on a hiding instance cancels the hide). `hide()` calls `FVL.hide()` directly when the session counter reaches 0. There is no cached state to drift.

- **FVL hide animation callback cleaning up re-shown instances**
  When `FVL.hide()` was called, it ran a leave animation with a callback that performed DOM cleanup. If `FVL.show()` was called during the animation (rapid-click scenario), the show would restore the visual state, but the pending hide callback would still fire when the animation ended — cleaning up the DOM of an instance that was supposed to stay visible.
  
  Fixed by adding a `_cancelHide` flag. When `show()` detects an instance in the `hiding` state, it sets `_cancelHide = true`. The hide callback checks this flag and becomes a no-op if set, so it never cleans up a re-shown instance.

- **Smart delay removed entirely**
  The previous smart-delay timer (80ms in v1.0.3, 200ms in v1.0.0) was meant to avoid flashing the loader for fast loads, but it caused more problems than it solved:
  - On cached loads (<15ms), the timer was cancelled by `hide()` before firing, so the overlay never showed
  - When `hide()` arrived during the smart-delay window, the v1.0.3 design force-flushed the show — but this created complex state transitions that were hard to reason about
  
  v1.7.1 has NO smart delay. The overlay shows immediately on `show()` and hides immediately on `hide()`. This is simpler, more predictable, and matches user expectations.

- **Minimum display time removed**
  The v1.0.3 design held the overlay for at least 250ms (originally 300ms) before hiding, to avoid 1-frame flashes. But this meant that even after content was ready, the user had to wait 250ms staring at a loading spinner — which felt slow.
  
  v1.7.1 has NO minimum display time. The overlay hides the instant the last session closes. For very fast loads, the overlay may flash briefly — but this is preferable to being stuck or feeling slow.

### Improved

- **Simpler, more predictable loading behavior**
  The new LoadingService is ~30% smaller (9.3 KB vs 13.1 KB) and much easier to reason about:
  - `show()`: increment counter, call `FVL.show()` (idempotent)
  - `hide()`: decrement counter, if 0 then call `FVL.hide()`
  - No cached `_visible` flag, no `_hideDeferTimer`, no `_scheduleHide()`, no `_reconcile()`
  
  This simplicity makes the system robust against any combination of rapid show/hide calls — which is exactly what happens when users click rapidly through navigation buttons.

- **FVL show() idempotency fully reliable**
  The `show()` function now handles all four possible instance states correctly:
  - `null` (no instance) → create new
  - `'showing'` or `'shown'` → update message, return existing handle
  - `'hiding'` → set `_cancelHide`, restore `fvl-shown` class, force reflow, return handle
  - `'hidden'` or `'destroyed'` → create new
  
  Combined with the cancel-safe hide callback, this guarantees that `show()` always results in a visible, properly-styled overlay — regardless of what state the previous instance was in.

### Removed

- **Smart delay feature (`smartDelay` option)**
  Removed entirely. The `smartDelay` option is now ignored if passed — `show()` always shows immediately. If you were relying on this option, remove it from your calls; it no longer has any effect.

- **Minimum display time feature (`MIN_DISPLAY_MS` constant)**
  Removed entirely. The overlay hides the moment the last session closes, with no artificial delay.

- **Internal methods: `_reconcile()`, `_scheduleHide()`, `_flushShow()`, `_pendingOpts`, `_hideDeferTimer`, `_visibleSince`**
  All removed. The new design has no need for these internal mechanisms — `show()` and `hide()` are now thin wrappers around FVL's idempotent API.
