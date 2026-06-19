---
version: 1.7.2
date: 2026-06-19T15:18:20.246Z
title: Loading Always Shows + Smooth Spinner Rotation
subtitle: Fixed two critical issues with the loading system: (1) the overlay now shows on EVERY navigation, even back-to-back, with a pulse animation to signal new operations; (2) the spinner now rotates smoothly at full refresh rate by moving CSS keyframes outside @layer, removing conflicting transform: translateZ(0), and adding backface-visibility for GPU acceleration.
notify: true
---

### Fixed

- **Loading overlay not showing on every navigation**
  When navigating between categories rapidly, the previous v1.7.1 design relied on FVL's idempotency — calling show() on an already-shown instance just updated the message. This meant that subsequent navigations produced NO visible loading state, since the overlay was already there.
  
  v1.7.2 fixes this by ALWAYS calling FVL.show() (which is idempotent and handles all states correctly), then adding a "pulse" animation (brief opacity dip + scale) when the overlay was already visible. This gives clear visual feedback that a new operation has started, even during back-to-back navigations.

- **Spinner appeared frozen / barely rotating**
  Two CSS issues caused the spinner to freeze or rotate very slowly:
  1. `@keyframes _fvl_spin` was inside `@layer fvl` — some browsers (and headless test environments) don't fully parse keyframes inside @layer, so the animation never ran
  2. `transform: translateZ(0)` was set on the arc element — this OVERRODE the animation's `transform: rotate()`, freezing the spinner at 0deg
  
  Fixed by:
  - Moving all @keyframes OUTSIDE @layer (they're global by nature, don't need layer isolation)
  - Removing `transform: translateZ(0)` from the arc — using `will-change: transform` + `backface-visibility: hidden` instead for GPU acceleration
  - Removing `contain: strict` from fullscreen/topbar overlays (changed to `contain: layout style`) — `strict` includes `paint` + `size` containment which can freeze child animations
  - Adding `animation-play-state: running` explicitly to prevent inherited paused states

- **Overlay invisible due to leftover `hidden` attribute**
  The `buildFullscreen()` renderer was setting `hidden=""` attribute on the overlay element, but CSS had a `.fvl-fullscreen[hidden] { display: none !important }` rule that permanently hid it. Even though we removed the CSS rule in an earlier version, the attribute was still being set, causing `display: none` in some browsers.
  
  Fixed by removing the `hidden` attribute from the renderer entirely — visibility is now controlled exclusively via the `.fvl-entering` / `.fvl-shown` / `.fvl-leaving` classes (opacity transitions).

- **LoadingService.hide() called too early by ContentService**
  ContentService calls LoadingService.hide() multiple times after rendering content. On cached loads (<50ms), this caused the overlay to flash for 1 frame then disappear — too fast for users to see. v1.7.2 adds a MIN_VISIBLE_MS (200ms) check: if the overlay was shown less than 200ms ago, hide() is deferred until the 200ms has elapsed. This is NOT a delay on show() (overlay shows instantly), only a minimum visible time on hide().

- **Router not balancing LoadingService sessions**
  The router called LoadingService.show() at the start of navigateTo() but only called hide() in the catch block — meaning successful navigations left the session counter at 1 forever. v1.7.2 moves the hide() call to the finally block so it always runs, regardless of whether navigation succeeded or failed.

### Improved

- **Spinner rotation is now GPU-accelerated and refresh-rate-independent**
  The spinner arc uses `will-change: transform` + `backface-visibility: hidden` for compositor-layer promotion. The rotation animation runs entirely on the GPU, decoupled from the main thread (which may be busy with navigation/data-fetching). This means:
  - Smooth rotation at any display refresh rate (60Hz, 90Hz, 120Hz, 144Hz)
  - No stuttering when the main thread is under load
  - Consistent rotation speed regardless of CPU usage

- **Standard 0.7s rotation duration**
  Changed spinner rotation from 0.8s to 0.7s per revolution — the de-facto standard for Material Design and iOS spinners. Feels more responsive without being too fast.

- **Pulse animation signals new operations**
  When show() is called while the overlay is already visible (e.g., user clicks another category while still loading the previous one), the overlay briefly dips to 0.6 opacity + scales to 0.97, then returns to normal. This 350ms pulse gives clear visual feedback that a new operation has started, even when the spinner was already spinning.

### Removed

- **`transform: translateZ(0)` on spinner arc**
  Removed because it overrode the animation's `transform: rotate()`, freezing the spinner. Replaced with `backface-visibility: hidden` for GPU acceleration.

- **`contain: strict` on fullscreen and topbar overlays**
  Changed to `contain: layout style` — `strict` includes `paint` + `size` containment which can freeze child animations in some browsers.

- **`@keyframes` inside `@layer fvl`**
  Moved all @keyframes outside @layer for maximum browser compatibility. Keyframes are global by nature and don't benefit from layer isolation.
