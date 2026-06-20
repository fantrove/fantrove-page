---
version: 1.8.0
date: 2026-06-20T00:00:00.000Z
title: Smoother Loading + Duplicate Click Prevention
subtitle: Loading system refined to feel like a large-scale app — duplicate button clicks no longer trigger redundant loads, scrolling is blocked during loading, and a race condition that caused content jank behind the overlay has been fixed.
notify: true
---

### Fixed

- **Loading overlay stuck after rapid button clicks**
  Clicking category buttons rapidly could leave the loading overlay stuck and unable to hide. Fixed with a generation counter — only the latest navigation performs cleanup, and any superseded navigations are automatically skipped.

- **Content jank visible behind the loading overlay on fast loads**
  When data loaded very quickly (e.g., from cache), the overlay could be removed before the browser had a chance to paint it, causing the user to briefly see the content changing behind the overlay. Fixed by ensuring the overlay is painted at least once before it can be removed.

- **Overlay not covering content changes in time**
  In some cases users could see content repositioning behind the loading overlay because the overlay had a 140ms fade-in, leaving a gap where it wasn't fully opaque during content changes. Fixed by making the overlay appear instantly (no fade-in) and waiting for the browser to paint it before starting any content mutations.

### Improved

- **Clicking an already-active button is ignored**
  Clicking a category button that is already active (selected) now does nothing — no redundant data fetch, no re-render, and no loading overlay. This makes navigation feel more responsive and prevents unnecessary work.

- **Scrolling is blocked during loading**
  While the loading overlay is visible, the user cannot scroll the page. This prevents issues that could arise from scrolling while content is not yet ready.

- **Loading overlay appears instantly without fade-in**
  The loading overlay is now opaque from the very first browser paint, with no entrance animation. This ensures it covers content changes immediately, so the user never sees content shifting or flickering behind it.

### New

- **FVL: `instant` option to skip enter animation**
  Added a framework-level option in FVL to skip the entrance fade-in and set opacity: 1 immediately. Used when the caller needs the overlay to cover content changes in the same frame, preventing race conditions between overlay visibility and content mutations.

- **FVL: `coverAll` option for full-viewport coverage**
  Added a framework-level option for fullscreen overlays to cover the entire viewport including the header. Intended for initial page load where the user should not see any unready UI, while the bottom navigation remains visible and accessible.

### Removed

- **Content fade-in animation**
  Removed the staggered fade-in animation on content items. Since the loading overlay already covers all content changes, a separate content entrance animation was redundant and could cause visible jank during the loading-to-content transition.