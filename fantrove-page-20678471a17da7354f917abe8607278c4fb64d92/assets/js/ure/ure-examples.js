/**
 * ════════════════════════════════════════════════════════════════════════════
 * URE — Universal Render Engine  v1.0.0
 * Integration Guide & Examples for Fantrove
 * ════════════════════════════════════════════════════════════════════════════
 *
 * File: assets/js/ure/ure-examples.js
 * NOTE: This file is REFERENCE / DOCUMENTATION only — do not load it on pages.
 *       Copy the snippets you need into your page-specific JS.
 *
 * ── Quick start ──────────────────────────────────────────────────────────────
 *
 *  1. Add ONE script tag to any page (before your page script):
 *
 *       <script src="/assets/js/ure/ure.js"></script>
 *
 *  2. Wait for URE ready event (or just call URE.mount after DOMContentLoaded):
 *
 *       window.addEventListener('ure:ready', () => { ... });
 *
 * ── Public API summary ───────────────────────────────────────────────────────
 *
 *   URE.mount(opts)              → EngineHandle
 *   URE.getInstance(container)  → EngineHandle | null
 *   URE.destroyAll()             → void
 *   URE.debug()                  → stats table in console
 *
 * ── EngineHandle methods ─────────────────────────────────────────────────────
 *
 *   handle.setData(newArray)            Replace all data (diff-aware)
 *   handle.append(items)                Append to end
 *   handle.prepend(items)               Prepend to top
 *   handle.removeByKey(keyValue)        Remove one item by key
 *   handle.filter(predicates)           async — filter in Worker
 *   handle.sort(field, dir)             async — sort in Worker
 *   handle.resetFilter()                Restore original data
 *   handle.paginate(page, pageSize)     async — slice + display page
 *   handle.setLang(lang)                Switch language, re-render visible
 *   handle.scrollTo(index, behavior)    Scroll to item by index
 *   handle.refresh()                    Force geometry recalculation
 *   handle.on(key, fn)                  Subscribe to state key
 *   handle.onAny(fn)                    Subscribe to all state changes
 *   handle.stats()                      Debug stats object
 *   handle.destroy()                    Full teardown
 *
 * ── Filter predicate operators ───────────────────────────────────────────────
 *
 *   eq, neq, gt, lt, gte, lte, includes, startsWith
 *
 *   Examples:
 *   { field: 'type', op: 'eq', value: 'emoji' }
 *   { field: 'name.en', op: 'includes', value: 'smile' }
 *   [predA, predB]  →  AND logic (both must match)
 */

// ════════════════════════════════════════════════════════════════════════════
// EXAMPLE 1: home.js  — emoji + symbol carousel sections
// ════════════════════════════════════════════════════════════════════════════

async function example_home() {
  // Wait for data (home.js already fetches via ConDataService)
  const assembled = await window.ConDataService.getAssembled();

  assembled.type.forEach(typeObj => {
    typeObj.category.forEach(cat => {
      const containerId = `ure-home-${typeObj.id}-${cat.id}`;

      // Ensure container exists in DOM (home.js creates it)
      const container = document.getElementById(containerId);
      if (!container) return;

      const handle = URE.mount({
        container,
        data    : cat.data || [],
        template: (item, lang) => {
          const name = item.name?.[lang] || item.name?.en || '';
          return `
            <button class="item-card" title="${name}"
                    aria-label="Copy ${name}"
                    data-text="${item.text || ''}"
                    data-api="${item.api || ''}">
              <div class="emoji">${item.text || ''}</div>
              <div class="name">${name}</div>
            </button>
          `;
        },
        buffer      : 400,
        recycling   : true,
        estimatedItemHeight: 80,
        onItemClick : (e, item) => {
          const lang = localStorage.getItem('selectedLang') || 'en';
          const name = item.name?.[lang] || item.name?.en || '';
          navigator.clipboard?.writeText(item.text || '').then(() => {
            window.showCopyNotification?.({ text: item.text, name, typeId: typeObj.id, lang });
          });
        },
      });

      // React to language change (URE handles internally, but home layout may
      // need extra updates — subscribe here if needed)
      handle.on('lang', (newLang) => {
        // e.g. update section heading
      });
    });
  });
}

// ════════════════════════════════════════════════════════════════════════════
// EXAMPLE 2: discover page (nav-core + infinite scroll)
// ════════════════════════════════════════════════════════════════════════════

async function example_discover() {
  // Called after ButtonService.loadConfig() in nav-core InitService
  const contentContainer = document.getElementById('content-loading');
  if (!contentContainer) return;

  // Lazy-load initial page
  const firstPage = await fetch('/assets/json/content/emojis-page1.json')
    .then(r => r.json()).catch(() => []);

  // Resolve category groups through ConDataService
  const assembled = await window.ConDataService.getAssembled();
  const allItems   = [];

  for (const group of firstPage) {
    if (group.group?.categoryId) {
      const cat = assembled.type
        .flatMap(t => t.category)
        .find(c => c.id === group.group.categoryId);
      if (cat) allItems.push(...(cat.data || []));
    }
  }

  const handle = URE.mount({
    container  : contentContainer,
    data       : allItems,
    template   : (item, lang) => {
      const name = item.name?.[lang] || item.name?.en || '';
      return `
        <button class="button-content"
                data-text="${item.text || ''}"
                title="${name}"
                aria-label="${name}">
          ${item.text || item.api || '?'}
        </button>
      `;
    },
    buffer      : 600,
    recycling   : true,
    keyField    : 'api',
    onItemClick : (e, item) => {
      window.unifiedCopyToClipboard?.({ text: item.text, api: item.api });
    },
  });

  // Infinite scroll: append next page when near bottom
  let page = 1, loading = false;
  window.addEventListener('scroll', async () => {
    if (loading) return;
    const nearBottom = window.scrollY + window.innerHeight >= document.body.offsetHeight - 800;
    if (!nearBottom) return;
    loading = true;
    page++;
    const nextData = await fetch(`/assets/json/content/emojis-page${page}.json`)
      .then(r => r.ok ? r.json() : []).catch(() => []);
    if (nextData.length) handle.append(nextData);
    loading = false;
  }, { passive: true });

  return handle;
}

// ════════════════════════════════════════════════════════════════════════════
// EXAMPLE 3: search results (rendering.js replacement)
// ════════════════════════════════════════════════════════════════════════════

let _searchHandle = null;

function example_searchRenderResults(results, lang = 'en') {
  const container = document.getElementById('searchResults');
  if (!container) return;

  if (_searchHandle) {
    // Reuse existing instance — diff engine will only update what changed
    _searchHandle.setData(results);
    return;
  }

  _searchHandle = URE.mount({
    container,
    data    : results,
    template: (item, lang) => {
      const data     = item.item || item;
      const text     = data?.text || data?.api || '';
      const name     = data?.name?.[lang] || data?.name?.en || item.itemName || '';
      const typeName = item.typeObj?.name?.[lang] || item.typeName || '';
      const catName  = item.category?.name?.[lang] || item.catName || '';
      return `
        <div class="sc" role="button" tabindex="0"
             data-text="${encodeURIComponent(text)}"
             aria-label="${name}">
          <div class="scc">${text}</div>
          <div class="scb">
            <div class="sct">${name}</div>
            <div class="scs">${typeName}</div>
            ${catName ? `<span class="tag">${catName}</span>` : ''}
          </div>
        </div>
      `;
    },
    buffer      : 700,
    recycling   : true,
    keyField    : 'api',
    onItemClick : (e, item) => {
      const data = item.item || item;
      const text = data?.text || data?.api || '';
      window.unifiedCopyToClipboard?.({ text, api: data?.api, type: item.typeName });
    },
  });
}

function example_searchDestroy() {
  if (_searchHandle) {
    _searchHandle.destroy();
    _searchHandle = null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXAMPLE 4: Filter + sort workflow
// ════════════════════════════════════════════════════════════════════════════

async function example_filterAndSort(handle) {
  // Filter to emojis only
  await handle.filter({ field: 'type', op: 'eq', value: 'emoji' });

  // Sort by name ascending
  await handle.sort('name.en', 'asc');

  // Reset to show everything
  handle.resetFilter();
}

// ════════════════════════════════════════════════════════════════════════════
// EXAMPLE 5: SPA route change cleanup
// ════════════════════════════════════════════════════════════════════════════

window.addEventListener('routeChanged', () => {
  // Tear down all URE instances before mounting new page content
  // URE re-mounts automatically when page JS calls URE.mount()
  URE.destroyAll();
});