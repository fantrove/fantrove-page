---
version: 1.5.0
date: 2026-06-14T08:30:00Z
title: Central Language API — FvLang
subtitle: A new central language system that sets up instantly before everything else. Every JS system now uses a single API for language detection and change notifications — no more reading localStorage independently. When the language changes, the entire page refreshes seamlessly without reloading.
notify: true
---

### New

- **FvLang — Central Language API (lang-core.js)**
  A new lightweight script that loads before everything else in the `<head>`. It reads the current language synchronously from the `data-fv-built` attribute (production), URL prefix, localStorage, or browser settings — resolving the language instantly with zero network requests. All other JS systems now use `FvLang.lang` instead of reading localStorage independently, eliminating the "language not loaded in time" issue.

- **Automatic full-page language refresh**
  When the language changes, `FvLang.setLang()` dispatches a `fv:langchange` event and calls all subscribed callbacks. Every system that renders text (home page, navigation, What's New, update popup) subscribes to this and re-renders automatically. The entire page updates to the new language without a page reload.

- **Subscriber API for any JS system**
  Any script can now use `FvLang.onChange(function(lang, prevLang) { ... })` to register for language change notifications. The return value is an unsubscribe function. This replaces the old pattern where each system independently read `localStorage.getItem('selectedLang')` and listened for `languageChange` events.

### Improved

- **Faster language initialization in static mode**
  In production (pre-built pages), `lang-core.js` reads `data-fv-built` attribute from `<html>` instantly — no need to wait for `language.js` to load its modules. The gate resolves immediately, and all scripts have access to the correct language from their first line of code.

- **Lighter static mode for language.js**
  In static mode, `language.js` now loads only 3 modules (types, config, state, gate, ui, manager) instead of 14 modules. Translation, worker pool, detector, loader, and marker modules are completely skipped since the content is pre-baked into the HTML.

- **Home page re-renders on language change**
  The home page now caches its data and subscribes to `FvLang.onChange()`. When the language changes, it re-renders all categories, labels, and "View All" buttons with the correct language text — instantly and without a page reload.