---
version: 1.9.0
date: 2026-06-21T00:00:00.000Z
title: Stable Release Dates + More Reliable History
subtitle: Improved the update history to record only the first release date of each version — editing content without bumping the version no longer changes the date shown in "What's New" and update popups.
notify: true
---

**TL;DR** — Dates in "What's New" and update popups are now stable — if we edit content without bumping the version, the date stays as the original release date, not the edit date.

## About this system

The "What's New" system on our website shows the history of every update along with the date each update was released — both on the page itself and in the popup notification that appears when there's a new version. Previously, the system recorded dates based on the latest build time, meaning if we edited the release notes content (e.g., fixing a typo or adding details) without changing the version number, the date would be updated to the latest time — even though the version was actually released long ago. This update fixes that by making dates permanently tied to each version.

### Fixed

- **Release date changed every time content was edited**
  Previously, if we edited the release notes content (e.g., fixing typos, adjusting wording, adding details) without bumping the version number, the date in "What's New" and the update popup would be changed to the latest edit date — even though that version was released long ago. Now the system records only the first release date of each version — if the version number doesn't change, the date doesn't change, no matter how the content is edited. This means the date users see reflects the actual release date, not the last edit date.

### Improved

- **More stable update history**
  The update history system now stores the first release date of each version in a central registry, so the data doesn't get lost even after multiple builds, and everyone on the team sees the same dates. The result is that the dates users see are consistent regardless of where they access the site from or how many times the site has been rebuilt.

- **Prevents accidental date edits**
  If someone manually edits the date in a release note and the value doesn't match what's recorded, the system automatically syncs it back to the correct date. This ensures users always see the correct date even if mistakes happen during site preparation.

### What you'll notice

- Dates in "What's New" and update popups are always correct — showing when the version was first released, not when it was last edited
- The update history is stable — dates don't shift around when content is edited
- The date in the popup always matches the date on the website
