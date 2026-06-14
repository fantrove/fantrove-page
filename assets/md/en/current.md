---
version: 1.4.1
date: 2025-06-14T05:00:00Z
title: Per-language Markdown files
subtitle: Each language now has its own MD file for easier authoring. Writing release notes in multiple languages is now simpler and cleaner — no more mixing languages in a single file.
notify: true
---

### New

- **Per-language MD file structure**
  Release note files are now split by language — `en/current.md` for English and `th/current.md` for Thai. Each file contains content in only one language, making it much easier to read, write, and maintain. No more YAML i18n blocks or mixed-language sections.

- **Build script supports per-language MD**
  The `update-version.js` build script now reads both language files from git history and automatically merges them into a combined `release-history.json` with proper i18n objects for the runtime.

### Improved

- **Simpler MD format for single-language files**
  Since each file is for one language only, the front matter no longer needs i18n blocks. Title and subtitle are plain strings, and item descriptions are plain text. This significantly reduces boilerplate and makes each file shorter and more focused.

- **Cleaner authoring workflow**
  Writers can focus on one language at a time without needing to scroll past or manage content in other languages within the same file. This is especially beneficial as more languages are added in the future.