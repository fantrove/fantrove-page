---
version: 2.2.1
date: 2026-07-16T22:32:38.737Z
title: Restructured history back into releases folder per language
subtitle: Moved history files back into releases folder within each language to clearly separate current.md from history, while keeping the automatic file generation system so developers don't need to create files manually.
notify: true
---

**TL;DR** — Moved history files back into releases folder within each language to clearly separate current.md from history. Developers still don't need to create files in releases/ — the system does it automatically.

## About this system

The release notes system on our website is the page that shows the history of every update. In version 2.2.0, we reduced system redundancy and moved history files directly into language folders. However, we wanted to separate current.md from history more clearly. This update moves history files back into releases folder within each language, while keeping the automatic file generation system so developers don't need to create files manually.

### Improved

- **Clear separation of current.md from history**
  Now current.md, which contains the current version's data, sits outside the releases folder, while each version's history files are in the releases folder within each language. This clearly separates current data from history, making the structure easier for developers to understand.

- **Developers don't need to create files in releases/**
  The system still automatically creates history files in the releases folder when there's a new version. Developers don't need to create or manage files in the releases folder themselves — they just edit current.md.

### What you'll notice

- Clearer file structure — current.md separated from history
- Easier workflow for developers — only edit current.md
- History is still automatically recorded as before
