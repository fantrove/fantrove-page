---
version: 2.2.4
date: 2026-07-16T23:26:48.893Z
title: Fixed the 4-layer version-bump block not actually working
subtitle: The CI layer's version-bump check always compared the new commit against itself and could never detect a real bump, and the local git hooks that block forgotten version bumps were never installed unless someone remembered to run a manual command.
notify: true
---

**TL;DR** — The 4-layer version-control system was only half-working: the CI check that's supposed to block a forgotten version bump always read the exact same commit on both sides of the comparison, so it could never tell a real bump from no bump at all. Local pre-commit/pre-push hooks are now installed automatically too, instead of relying on a manual step nobody remembers to run.

## About this fix

This system is meant to block a commit, push, or deploy if the version number wasn't bumped. Checking the actual project history showed that layer had never once completed successfully — not a single CI-generated commit exists anywhere in over a thousand commits. The cause was the same class of bug fixed in 2.2.3: the CI check compared the version in `current.md` against `current.md` read from Git `HEAD` — but in CI, `HEAD` **is** the commit that already contains the version bump, so both sides were always identical. The check couldn't distinguish "version really changed" from "forgot to bump," so it either silently failed to block, or would have blocked every single release.

Separately, the local pre-commit and pre-push hooks that are supposed to catch a forgotten bump before it's even pushed only activate if a developer manually runs a one-time setup command — easy to forget, especially on a fresh clone.

### Fixed

- **CI version-bump check now compares against the real previous release**
  The check now looks at whether Git's `HEAD` already matches the file on disk. If it does (the CI-after-push case), it walks back through that file's Git history to find the commit that held the actual previous version, instead of comparing a commit against itself. Verified against both a genuine version bump (passes) and a forgotten bump (correctly blocks).

- **Git hooks now install automatically**
  Pre-commit and pre-push validation now install themselves the first time dependencies are installed, the same way most Node.js projects auto-install Git hooks, instead of depending on a developer remembering a separate manual command. Hook installation safely skips itself in CI and in non-Git environments so it can't break automated builds.
  The system still automatically creates history files in the releases folder when there's a new version. Developers don't need to create or manage files in the releases folder themselves — they just edit current.md.

### What you'll notice

- Clearer file structure — current.md separated from history
- Easier workflow for developers — only edit current.md
- History is still automatically recorded as before
