---
version: 2.1.1
date: 2026-07-16T14:11:12.098Z
title: Auto-snapshot previous version + strict 7-history limit
subtitle: The system now automatically saves the previous version's release notes as a history file before switching to a new version, so developers don't need to create files manually. History display is limited to 7 most recent entries excluding the current version.
notify: true
---

**TL;DR** — Now when there's a new version, the system automatically saves the old version's content as a history file first, so update history is never lost even if developers forget to create files. Display is limited to 7 most recent history entries, excluding the current version.

## About this system

The release notes system on our website is the page that shows the history of every update along with the date each update was released. In previous versions, the system required developers to manually create history files every time there was a new version, which was a step that could be forgotten and cause history to be lost. This update fixes that by automating the snapshot process, and limits the displayed history to an appropriate number.

### New

- **Automatic snapshot of previous version before switching**
  Now when there's a new version, the system reads the previous version's content from git history and automatically saves it as a history file before switching to the new version. This ensures the previous version's history is preserved automatically — developers no longer need to create files themselves, and don't have to worry about forgetting to save the previous version's history.

### Improved

- **History display limited to 7 most recent entries**
  The system now shows only the 7 most recent update history entries, excluding the current version that's displayed separately. This keeps the history page from getting too long, and users see only the most relevant recent information. Older history is still preserved in the system but not shown on the web page.

- **Developers can only touch one file**
  Developers can now edit only the current release notes file. All other files are managed automatically by the system. Manually editing dates or other files has no effect because the system overwrites them. This makes the system stable and avoids data duplication.

### What you'll notice

- Complete update history — no version is lost even if developers forget to save
- Clean history page — shows only the 7 most recent entries
- Dates are always correct — system manages them, no risk of writing errors
