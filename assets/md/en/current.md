---
version: 1.6.2_1
date: 2026-06-16T00:00:00Z
title: Bluesky Icon Fix & Build System Improvement
subtitle: Fixed the Bluesky icon in the footer which was using the wrong SVG, and improved the build system to skip hidden directories.
notify: true
---

### Fixed

- **Bluesky Icon in Footer Used Wrong SVG**
  The Bluesky icon in the footer was using Facebook's SVG path, and the aria-label was also set to "Facebook" despite the link pointing to bsky.app. Fixed by replacing it with the correct Bluesky SVG (Simple Icons v2.45) and correcting the aria-label to "Bluesky".

### Improved

- **Build System Skips Hidden Directories**
  The `copyDir()` function in `scripts/lib/file-utils.js` now skips all directories starting with `.` (e.g. `.well-known`, `.github`) to prevent the build process from touching these configuration files.