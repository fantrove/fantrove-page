---
version: 2.2.3
date: 2026-07-16T22:57:29.839Z
title: Fixed release history not being saved
subtitle: Corrected a timing bug in the release script that read the already-updated file instead of the previous version, plus synced the CI workflow with the per-language releases folder structure.
notify: true
---

**TL;DR** — Fixed the root cause of update history not being saved during deploy: the release script was comparing the new version against itself instead of the true previous version, and the CI workflow was still checking for old file paths that no longer exist.

## About this fix

Deploys were completing, but no history file for the previous version was ever created. The release script decided what "the previous version" was by reading `current.md` from the Git `HEAD` commit — but by the time the CI build runs, `HEAD` already **is** the commit with the new version, since the version bump is committed and pushed before CI executes. That made the script always see "previous version" and "new version" as identical, so it concluded nothing had changed and skipped saving history entirely.

Separately, the CI workflow was still verifying and committing an older, root-level release file layout that was replaced when history moved into a per-language `releases/` folder, so even a correct snapshot would not have been picked up.

### Fixed

- **Release script now finds the real previous version**
  Instead of assuming `HEAD` is always the older commit, the script now checks whether `HEAD`'s version already matches the new version. If it does (the CI-after-push case), it walks back through Git history for that file to find the commit that actually held the previous version. This works correctly both when run locally before a commit and when run in CI after a push.

- **CI workflow synced with the per-language releases structure**
  Build verification and the auto-commit step now check and stage `assets/md/en/releases/` and `assets/md/th/releases/`, matching what the release script actually generates, so history files are verified and committed correctly on every deploy.
  The system still automatically creates history files in the releases folder when there's a new version. Developers don't need to create or manage files in the releases folder themselves — they just edit current.md.

### What you'll notice

- Clearer file structure — current.md separated from history
- Easier workflow for developers — only edit current.md
- History is still automatically recorded as before
