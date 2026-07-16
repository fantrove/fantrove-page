---
version: 2.1.0
date: 2026-07-16T12:27:39.693Z
title: Reduced initial load in every category + 4-layer version control system
subtitle: Significantly reduced the amount of content loaded on first paint in non-feed categories — now shows just enough to start, then loads more as you scroll like the feed system. Added a 4-layer system that forces version bumps on every code submission, unless intentionally bypassed with a token.
notify: true
---

**TL;DR** — Opening Symbols or Emojis for the first time now loads much less content — just enough to see the start, then gradually loads more as you scroll, just like the feed system. From now on, every code submission must include a version bump, or it will be blocked — unless you intentionally bypass with a token.

## About this system

The navigation system on the Discover page controls how emojis and symbols are displayed by category. In version 2.0.0, we made every category load content incrementally, but the initial load was still too heavy. This update significantly reduces that initial load to match the feed system's lightweight first paint, and adds a 4-layer system to prevent forgetting version bumps — a problem that caused update history confusion.

### Improved

- **Reduced initial content load in non-feed categories**
  Previously, opening the Symbols or Emojis category loaded a large amount of content all at once, which could make the page feel slow at first. Now the system loads only the first 2 subcategories, with each showing at most 20 items — roughly 40 items total on the first screen. The rest loads gradually as you scroll to it, just like the feed system that doesn't load much on first paint. This makes the page open noticeably faster, especially on mobile or slow networks.

### New

- **4-layer version control system**
  From now on, every code submission must include a version bump — if you forget, the submission will be blocked. The system has 4 layers of protection: Layer 1 checks before committing code, Layer 2 checks before pushing to the server, Layer 3 checks in GitHub's automated system, and Layer 4 only releases versions that pass all checks. This ensures every version that goes live has a correct version number and clean update history.

- **Bypass token for intentional same-version commits**
  Sometimes you intentionally don't change the version number, such as minor fixes that aren't real updates. The system provides a bypass token — you increase the number in the bypass file, and the system allows that one submission through. But it only works once; the next time you need to increase the number again. This ensures it's truly intentional, not just forgetting.

### Removed

- **Removed the APP_VERSION variable that had to be set in the dashboard**
  Previously, releasing a new version required setting the APP_VERSION variable in the Cloudflare dashboard, which was cumbersome. Now the system reads the version number directly from the release notes file — no extra configuration needed, removing an unnecessary step.

### What you'll notice

- Opening Symbols or Emojis is noticeably faster — less loaded on first paint
- Scrolling down gradually reveals more content, piece by piece
- Update history is always accurate because every version passes 4 layers of checks
