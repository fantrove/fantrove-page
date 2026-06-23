---
version: 1.9.1
date: 2026-06-21T23:05:37.961Z
title: Stable Release Dates + Folder-Based History
subtitle: Fixes an issue from 1.9.0 where the system still used the date we wrote manually in release notes — now the system always uses the actual release time, and switches to a folder-based history structure instead of a single combined file.
notify: true
---

**TL;DR** — Fixes an issue from v1.9.0 where dates still followed what we wrote in the notes — now the system always uses the actual release time, and history is stored as separate per-version files instead of one combined file.

## About this system

The "What's New" system on our website shows the history of every update along with the date each update was released — both on the page itself and in the popup notification that appears when there's a new version. In version 1.9.0 we improved the system to record the first release date of each version as the source of truth, but there was still a gap where the system would read the date we wrote manually in the release notes — which we might write incorrectly. This update fixes that by making the system always use the actual release time, and restructures how history is stored for clarity.

### Fixed

- **System still used the date we wrote manually in release notes**
  In version 1.9.0, the system still read the date from the release notes that we wrote ourselves, which we might write incorrectly — making the date not match the actual release time. Now the system always uses the time at the moment of release as the source of truth — ignoring any date we write ourselves. If we write a date manually, the system automatically overwrites it with the correct value. This ensures the date users see always reflects the actual release time.

### Improved

- **Switched to per-version history files**
  Previously, the system stored the entire update history in a single combined file containing all versions. Now it stores each version separately as its own file in the history folder, making maintenance easier — each file contains only that version's information, and when a new version is released the system automatically creates a new file for it.

- **No more manual date writing**
  We no longer need to write the date in release notes ourselves — the system adds and manages the date automatically. This makes preparing a new version release simpler — we just write the version number and content, and the system handles the date.

### What you'll notice

- Dates in "What's New" and update popups are always correct — showing when the version was actually released
- The update history is stable — dates don't shift around when content is edited
- History structure is clearer — each version has its own file
