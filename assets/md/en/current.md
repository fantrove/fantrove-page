---
version: 2.3.0
title: Search gets Google-like filters + SEO overhaul
subtitle: Filter pills now scroll naturally instead of sticking, the English home page is finally indexable by Google, and the discover feed remembers what you were looking at.
notify: true
---

**TL;DR** — The search filters now behave like Google (scroll with the page instead of floating), the English home page should start showing up in Google search results, and the discover feed now remembers your scroll position and content order within a 30-minute window.

## Search filters, reimagined

Previously, the search page had a toggle arrow to show or hide category filters, and the whole filter bar stuck to the screen while scrolling. It worked, but it felt clunky — the toggle added an extra tap, and the sticky bar ate screen space on mobile.

Now the search bar still sticks (so you can always type a new query), but the filter pills scroll naturally with the page — just like Google's search results. Category filters appear automatically when relevant, and hide themselves when there's nothing to filter. No more toggle button.

## Google can now index the English home page

For months, Google could see the Thai home page but not the English one. The root cause was a chain of redirects and missing canonical tags that told Google "this page redirects, don't index it." The build system now generates correct canonical URLs with trailing slashes (matching how Cloudflare serves the pages), the root URL returns a proper 404 instead of redirecting, and the language detection script no longer forces automatic redirects. The English home page should start appearing in Google's index after the next crawl.

## Discover feed now remembers your session

The discover page used to reshuffle its content every time you refreshed — every visit felt like starting from scratch. Now the feed generates a unique order per browser and remembers it for 30 minutes, so refreshing or coming back shows the same content and scrolls you back to where you left off.
