---
version: 2.0.0
date: 2026-07-16T10:17:46.458Z
title: Lazy-loaded content for every category + position memory on navigation + closed release system
subtitle: Navigation now loads content incrementally as you scroll in every category (not just the feed page) and remembers your scroll position when you switch tabs and come back — like X. The release notes system is now a closed system where developers can only write content for the current version.
notify: true
---

**TL;DR** — Every category now loads content piece by piece as you scroll instead of pulling everything at once. When you switch to another page and come back, your content and scroll position are preserved. The release notes system is now closed — developers can only write the current version's content, while the system handles dates and history automatically.

## About this system

The navigation system on the Discover page is what controls how emojis and symbols are displayed by category — it remembers which category you're in, lets you switch without refreshing, and loads new data when you change categories. Previously, only the combined feed page loaded content incrementally as you scrolled, while specific categories like Symbols or Emojis still loaded everything at once. This update makes every category load incrementally the same way, adds position memory when switching back and forth, and turns the release notes system into a closed system for stability.

### New

- **Lazy-loaded content in every category**
  Every category button (Symbols, Emojis, Fancy Text) now loads content in chunks as you scroll to it — it no longer pulls everything at once on initial load. This makes the page open faster, especially on mobile or slow networks, because the system only loads what needs to be shown at that moment and fetches more as you reach it. If you never scroll to a section, that section is never loaded, saving both time and data.

- **Position memory when switching tabs**
  When you tap another category and come back, the system remembers where you scrolled to and the content you've already loaded is still there — no need to start over from the top. Similar to how X works, this makes switching between categories smoother. You don't have to scroll back to where you were. The system keeps track of roughly the last 5 categories you visited; beyond that, it starts fresh to save memory.

- **Closed release notes system**
  The release notes system is now a closed system — developers can only write content for the current version. The system handles dates and the entire update history automatically. This prevents mistakes that could cause dates to be inaccurate or history to be corrupted, making the information users see in the "What's New" page reliable and consistent.

### Improved

- **More stable date recording**
  The system records only the first release date of each version as the source of truth. If developers edit content within the same version, the date doesn't change — the history stays as it was until the version number changes, at which point a new record is created. This makes the update history stable, not shifting around when content is edited.

- **Removed legacy storage systems**
  The old release notes system that used a single combined file has been removed. It now uses a folder structure that stores each version separately, making it easier to maintain and audit. Each version has its own file, and the system automatically creates a new file when a new version is released.

### What you'll notice

- Discover page opens faster — only loads what's visible first, then fetches more as you scroll
- Switch to another category and come back — your content and scroll position are preserved
- Dates in the "What's New" page are always correct — showing when the version was actually released
- Update history is stable — dates don't shift around when content is edited
