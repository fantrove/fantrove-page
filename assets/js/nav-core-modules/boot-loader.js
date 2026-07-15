// @ts-check
/**
 * @file boot-loader.js
 * INLINE BOOT LOADER — embedded directly in HTML <head>.
 *
 * v1.0.0
 *
 * RESEARCH BASIS:
 *
 * 1. Next.js App Router Streaming + Suspense (Vercel, 2023)
 *    Next.js injects an inline <script> in <head> that shows a loading
 *    boundary BEFORE React hydrates. The user sees "Loading..." within
 *    50ms of the first HTML byte, even if JS takes 2s to load.
 *    Source: nextjs.org/docs/app/building-your-application/routing/loading-ui-and-streaming
 *
 * 2. Astro View Transitions (Astro team, 2023)
 *    Astro injects a "fade" overlay during route swaps. The overlay
 *    appears synchronously on link click and disappears when the new
 *    page's DOM is ready. Our boot loader does the same but on initial
 *    page load.
 *    Source: docs.astro.build/en/guides/view-transitions/
 *
 * 3. Turbo Drive / Turbolinks (Basecamp, 2013)
 *    Progress bar appears immediately on link click, hides when new
 *    <body> is parsed. We adopt the same pattern: show on script start,
 *    hide when "ready" signal fires.
 *    Source: github.com/hotwired/turbo
 *
 * 4. NProgress (Rico Sta Cruz, 2012)
 *    Thin top progress bar for SPA navigations. Shows instantly, hides
 *    on route change complete. We use a similar "instant show, delayed
 *    hide" pattern, but as a fullscreen overlay (more visible).
 *    Source: github.com/rstacruz/nprogress
 *
 * 5. Chrome's "Largest Contentful Paint" optimization (Addy Osmani, 2020)
 *    Inline critical CSS in <head> to avoid render-blocking. Our boot
 *    loader inlines its OWN CSS (no external request) so it can render
 *    before any network fetch completes.
 *    Source: web.dev/lcp/#optimize-when-the-resource-begins-loading
 *
 * 6. Facebook's "BigPipe" pattern (Facebook, 2010)
 *    Show a loading shell immediately, then stream content in as it
 *    becomes available. Our boot loader is the "shell" — it persists
 *    until content is actually rendered (not just fetched).
 *    Source: github.com/facebookarchive/bigpipe
 *
 * 7. Ryan Florence "When To Fetch" (2021)
 *    "Start the fetch as early as possible, but show loading state
 *    until the data is RENDERED, not just fetched." Our boot loader
 *    + ready-signal contract enforces this.
 *
 * HOW TO USE:
 *
 *   In the HTML <head>, BEFORE any other <link> or <script>:
 *
 *   <style>/* boot-loader CSS here *\/</style>
 *   <script>/* boot-loader JS here (this file) *\/</script>
 *
 *   The script:
 *     1. Synchronously injects a fullscreen overlay into <html> (not <body>
 *        — <body> doesn't exist yet during <head> parsing).
 *     2. Exposes window.__ncBootLoader = { ready: fn, show: fn, hide: fn }.
 *     3. The overlay stays visible until window.__ncBootLoader.ready()
 *        is called by nav-core's InitService.
 *
 *   Nav-core's LoadingService is the ONLY caller of ready(). It tracks
 *   "expected ready signals" — every navigateTo() increments the count,
 *   ready() decrements it. The overlay hides when count = 0 AND minimum
 *   visible time has elapsed.
 *
 * WHY INLINE (not external):
 *   An external script requires a network round-trip (50-300ms on 4g).
 *   During that time, the user sees a blank white page. By inlining,
 *   the overlay appears in the same paint as the first HTML byte —
 *   perceived load time drops from "white flash then loading" to
 *   "loading immediately".
 *
 *   Cost: ~2KB inlined in every HTML page. Worth it.
 *
 * @module boot-loader
 * @depends {nothing — runs before any other module}
 */
(function () {
  'use strict';

  // Guard against double-execution (e.g. if HTML is re-parsed)
  if (window.__ncBootLoader) return;

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: State
  // ═══════════════════════════════════════════════════════════════════════════

  var OVERLAY_ID = 'nc-boot-overlay';
  var MIN_VISIBLE_MS = 200;   // never flash shorter than 200ms
  var MAX_VISIBLE_MS = 30000; // safety: auto-hide after 30s no matter what

  var _overlay = null;
  var _shownAt = 0;
  var _pendingReady = 1;        // start at 1 — the initial page load
  var _hideTimer = null;
  var _safetyTimer = null;
  var _forceHidden = false;     // once true, never show again (page unload)

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: DOM injection
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create the overlay element. Called synchronously during <head> parse.
   * We append to documentElement (not body) because body doesn't exist yet.
   *
   * The overlay uses inline styles + an inline SVG spinner so it renders
   * without any external CSS or font — guaranteed to display in the first
   * paint, even on 2g with no cached CSS.
   */
  function _createOverlay() {
    if (_overlay) return _overlay;
    if (_forceHidden) return null;

    _overlay = document.createElement('div');
    _overlay.id = OVERLAY_ID;
    _overlay.setAttribute('role', 'status');
    _overlay.setAttribute('aria-live', 'polite');
    _overlay.setAttribute('aria-busy', 'true');

    // Inline styles — no dependency on external CSS
    // (will be overridden by loading-system.css once it loads, but
    // we don't wait for that — this must render in the first paint)
    _overlay.style.cssText = [
      'position:fixed',
      'top:0', 'left:0', 'right:0', 'bottom:0',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'gap:22px',
      'background:#ffffff',
      'z-index:999999',              // above everything
      'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
      'color:#3c4043',
      'contain:layout style',         // isolate from page reflows
      'transition:opacity 180ms cubic-bezier(0.4,0,0.2,1)',
    ].join(';');

    // Inline SVG spinner — no external request
    var spinnerSvg =
      '<svg width="68" height="68" viewBox="0 0 52 52" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<circle cx="26" cy="26" r="22" stroke="#e8f5ef" stroke-width="3.5" fill="none"/>' +
        '<circle cx="26" cy="26" r="22" stroke="#13b47f" stroke-width="3.5" stroke-linecap="round" ' +
                'stroke-dasharray="88 132" fill="none" transform="rotate(-90 26 26)">' +
          '<animateTransform attributeName="transform" type="rotate" ' +
                            'from="0 26 26" to="360 26 26" dur="0.7s" repeatCount="indefinite"/>' +
        '</circle>' +
      '</svg>';

    var text = document.createElement('div');
    text.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;';
    var msg = document.createElement('div');
    msg.id = 'nc-boot-msg';
    msg.style.cssText = 'font-size:16px;font-weight:600;text-align:center;line-height:1.4;';
    msg.textContent = 'Loading...';
    var sub = document.createElement('div');
    sub.id = 'nc-boot-sub';
    sub.style.cssText = 'font-size:13px;color:#9aa0a6;text-align:center;line-height:1.4;';

    text.appendChild(msg);
    text.appendChild(sub);
    _overlay.innerHTML = spinnerSvg;
    _overlay.appendChild(text);

    // Append to documentElement (body doesn't exist yet)
    document.documentElement.appendChild(_overlay);
    _shownAt = Date.now();

    // Safety: auto-hide after MAX_VISIBLE_MS no matter what
    _safetyTimer = setTimeout(function () {
      if (_overlay && _overlay.parentNode) {
        console.warn('[BootLoader] Auto-hide after ' + MAX_VISIBLE_MS + 'ms — ready() was not called');
        _forceHide();
      }
    }, MAX_VISIBLE_MS);

    return _overlay;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: Show / Hide / Ready
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Show the overlay (or keep it visible if already shown).
   * Increments the pending-ready counter — overlay hides only when
   * counter reaches 0 via ready().
   */
  function _show() {
    if (_forceHidden) return;
    _pendingReady++;
    if (_overlay) {
      _overlay.style.display = 'flex';
      _overlay.style.opacity = '1';
    } else {
      _createOverlay();
    }
  }

  /**
   * Signal that one "show" session is ready.
   * Decrements pending counter. When it reaches 0 AND minimum visible
   * time has elapsed, the overlay hides.
   *
   * This is the contract: nav-core calls show() on every navigateTo(),
   * and calls ready() when content is rendered. The overlay persists
   * until the LATEST navigation's content is ready.
   */
  function _ready() {
    if (_pendingReady > 0) _pendingReady--;
    if (_pendingReady > 0) return; // still waiting for more ready signals

    // All sessions ready — check minimum visible time
    var elapsed = Date.now() - _shownAt;
    if (elapsed < MIN_VISIBLE_MS) {
      // Defer hide until minimum time elapses
      if (_hideTimer) clearTimeout(_hideTimer);
      _hideTimer = setTimeout(_doHide, MIN_VISIBLE_MS - elapsed);
    } else {
      _doHide();
    }
  }

  /**
   * Actually hide the overlay (with fade-out).
   */
  function _doHide() {
    if (!_overlay) return;
    _overlay.style.opacity = '0';
    setTimeout(function () {
      if (_overlay && _overlay.parentNode) {
        _overlay.parentNode.removeChild(_overlay);
      }
      _overlay = null;
      if (_safetyTimer) { clearTimeout(_safetyTimer); _safetyTimer = null; }
    }, 180); // match CSS transition
  }

  /**
   * Force-hide the overlay immediately (no fade). Used by safety timer
   * and page-unload handlers.
   */
  function _forceHide() {
    _forceHidden = true;
    if (_overlay && _overlay.parentNode) {
      _overlay.parentNode.removeChild(_overlay);
    }
    _overlay = null;
    if (_safetyTimer) { clearTimeout(_safetyTimer); _safetyTimer = null; }
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
  }

  /**
   * Update the loading message text.
   * @param {string} msg
   * @param {string} [sub]  optional sub-message
   */
  function _setMessage(msg, sub) {
    var m = document.getElementById('nc-boot-msg');
    if (m && msg) m.textContent = msg;
    var s = document.getElementById('nc-boot-sub');
    if (s) s.textContent = sub || '';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: Lifecycle handlers
  // ═══════════════════════════════════════════════════════════════════════════

  // On page unload, force-hide (so back-button doesn't show stale overlay)
  // Use pagehide (works for bfcache) + beforeunload (legacy fallback)
  try {
    window.addEventListener('pagehide', _forceHide, { passive: true });
  } catch (_) {}
  try {
    window.addEventListener('beforeunload', _forceHide, { passive: true });
  } catch (_) {}

  // On bfcache restore (pageshow with persisted=true), re-create overlay
  // because the user is "navigating back" and should see loading again.
  try {
    window.addEventListener('pageshow', function (ev) {
      if (ev.persisted) {
        _forceHidden = false;
        _pendingReady = 1; // reset to "waiting for nav-core ready"
        _createOverlay();
      }
    }, { passive: true });
  } catch (_) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: Boot — create overlay IMMEDIATELY
  // ═══════════════════════════════════════════════════════════════════════════

  // Create the overlay right now (during <head> parse).
  // It will be visible in the first paint.
  _createOverlay();

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 6: Public API (window.__ncBootLoader)
  // ═══════════════════════════════════════════════════════════════════════════

  window.__ncBootLoader = Object.freeze({
    /** Show the overlay (increments pending counter) */
    show: _show,
    /** Signal ready (decrements pending counter; hides when 0) */
    ready: _ready,
    /** Update message text */
    setMessage: _setMessage,
    /** Force-hide immediately (no fade) */
    forceHide: _forceHide,

    /** @returns {boolean} whether overlay is currently visible */
    get isVisible() { return !!(_overlay && _overlay.parentNode); },
    /** @returns {number} current pending-ready count */
    get pendingReady() { return _pendingReady; },
    /** @returns {number} ms since overlay was shown (0 if not visible) */
    get elapsedMs() { return _overlay ? Date.now() - _shownAt : 0; },

    /** Expose for tests */
    _state: function () {
      return {
        visible: !!_overlay,
        pendingReady: _pendingReady,
        shownAt: _shownAt,
        elapsedMs: _overlay ? Date.now() - _shownAt : 0,
        forceHidden: _forceHidden,
      };
    },
  });

})();
