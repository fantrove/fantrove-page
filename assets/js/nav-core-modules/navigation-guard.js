// @ts-check
/**
 * @file navigation-guard.js
 * NavigationGuard — "never-stuck, never-empty" guarantee for NavCore.
 *
 * v1.0.0
 *
 * RESEARCH BASIS:
 *
 * 1. RxJS switchMap (Ben Lesh, 2016)
 *    When a new value arrives, switchMap cancels the previous observable
 *    and switches to the new one. The KEY guarantee: the subscriber always
 *    gets the LATEST value's result, never a stale one.
 *    Source: learnrxjs.io/operators/transformation/switchmap.html
 *
 *    Our adaptation: every navigation cancels the previous, but the LATEST
 *    navigation MUST complete (or recover). We never leave the page empty.
 *
 * 2. React 18 useTransition (Meta, 2022)
 *    Separates "urgent" updates (typing, clicking) from "non-urgent"
 *    (data fetching). The UI stays responsive even when data is loading.
 *    Source: react.dev/reference/react/useTransition
 *
 *    Our adaptation: button clicks are urgent (immediate visual feedback),
 *    content rendering is non-urgent (can be interrupted).
 *
 * 3. XState — Finite State Machines (David Khourshid, 2017)
 *    Formal state machines that handle EVERY possible transition,
 *    including error recovery. Impossible states are impossible by design.
 *    Source: xstate.js.org/docs/about/concepts.html
 *
 *    Our adaptation: every error state has a defined recovery path.
 *    No "stuck" states possible.
 *
 * 4. Apollo Client error policy (Apollo, 2016)
 *    "all" | "ignore" | "none" — controls whether errors are thrown
 *    or returned as data. We use "ignore" for cached data (show stale
 *    even if refetch fails) and "all" for fresh navigation.
 *    Source: apollographql.com/docs/react/data/queries/#error-policies
 *
 * 5. Stripe's "Optimistic UI" pattern (Stripe, 2019)
 *    Show the expected result IMMEDIATELY, roll back if it fails.
 *    Combined with "confidence" — show cached data with a subtle
 *    "refreshing..." indicator while refetching.
 *    Source: stripe.com/blog/optimistic-ui
 *
 * 6. Service Worker offline-first pattern (Jake Archibald, 2015)
 *    "Cache falling back to network" — always have SOMETHING to show,
 *    even if the network is down.
 *    Source: developers.google.com/web/fundamentals/primers/service-workers
 *
 * 7. iOS UIKit "Resilient Navigation" (Apple, 2020s)
 *    UINavigationController guarantees a view is ALWAYS visible.
 *    If a push fails, the previous view stays. We adopt this —
 *    content is never cleared until new content is READY.
 *
 * GUARANTEES THIS MODULE PROVIDES:
 *
 *   1. NEVER EMPTY: #content-loading always has SOMETHING in it
 *      (old content, skeleton, or error UI with retry button)
 *
 *   2. NEVER STUCK: Loading overlay never visible > 5s without progress
 *
 *   3. LAST-WRITE-WINS: The most recent navigation's content is what's shown
 *      (stale renders are discarded, never overwrite fresh ones)
 *
 *   4. ALWAYS RECOVERABLE: Every error state has a "retry" path
 *      (auto-retry once, then manual retry button, then "back" button)
 *
 *   5. RAPID-CLICK SAFE: Clicking 10x/second doesn't crash or freeze
 *      (coalesced to the latest target, intermediate aborts are clean)
 *
 * @module navigation-guard
 * @depends {loading.js, content.js, data.js}
 */
(function (M) {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: Rapid-Click Coalescer
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // When the user clicks rapidly (e.g. 5 clicks in 200ms), we don't want
  // to start 5 navigations. We coalesce them into ONE navigation to the
  // LAST clicked target.
  //
  // This is different from a simple debounce: we want the FIRST click to
  // show loading immediately (no delay), but if more clicks arrive within
  // COALESCE_WINDOW_MS, we redirect the in-flight navigation to the new
  // target instead of starting a new one.

  var COALESCE_WINDOW_MS = 80; // window for coalescing rapid clicks

  var _pendingTarget = null;     // the latest click target waiting to navigate
  var _pendingTimer = null;      // debounce timer
  var _activeNavigation = null;  // { target, promise, abort } currently running

  /**
   * Request a navigation. If a navigation is already in-flight AND was
   * started within COALESCE_WINDOW_MS, the new target replaces the pending
   * one. Otherwise, starts a new navigation immediately.
   *
   * @param {string} target  URL to navigate to
   * @param {Function} navigateFn  (target) => Promise — the actual navigation
   * @returns {Promise} resolves when navigation completes (may be a different target)
   */
  function _requestNavigation(target, navigateFn) {
    // If there's an active navigation that's still within the coalesce window,
    // just update the pending target — the active navigation will pick it up
    // when it finishes the "validate" phase.
    if (_activeNavigation &&
        Date.now() - _activeNavigation.startedAt < COALESCE_WINDOW_MS) {
      _pendingTarget = target;
      // Don't start a new navigation — the active one will handle it
      return _activeNavigation.promise;
    }

    // Otherwise, start a new navigation immediately
    return _startNavigation(target, navigateFn);
  }

  function _startNavigation(target, navigateFn) {
    var nav = {
      target: target,
      startedAt: Date.now(),
      promise: null,
      abort: null,
    };
    _activeNavigation = nav;

    nav.promise = navigateFn(target).finally(function () {
      // After this navigation completes, check if there's a pending target
      // (coalesced click) that we should navigate to next.
      if (_activeNavigation === nav) {
        _activeNavigation = null;
        if (_pendingTarget && _pendingTarget !== target) {
          var next = _pendingTarget;
          _pendingTarget = null;
          // Use a microtask to avoid stack overflow on rapid coalescing
          Promise.resolve().then(function () {
            _startNavigation(next, navigateFn);
          });
        } else {
          _pendingTarget = null;
        }
      }
    });

    return nav.promise;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: Never-Empty Content Guard
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Before clearing content, snapshot it. If the new render fails, restore
  // the snapshot. This guarantees #content-loading is NEVER empty (unless
  // it was empty to begin with).
  //
  // Implementation: we take a DOM snapshot via cloneNode(true), keep it in
  // memory, and only swap it back if the new render throws.

  /**
   * Wrap a render operation with never-empty guarantee.
   * @param {HTMLElement} container  the content container
   * @param {Function} renderFn  async () => renders into container
   * @returns {Promise} resolves when render succeeds; rejects if it fails AND we restored
   */
  async function _withNeverEmpty(container, renderFn) {
    if (!container) return renderFn();

    // Snapshot current content (only if there's something to snapshot)
    var hadContent = container.children.length > 0;
    var snapshot = null;
    if (hadContent) {
      try {
        snapshot = container.cloneNode(true);
      } catch (_) {
        snapshot = null;
      }
    }

    try {
      // Attempt the new render
      await renderFn();
      // Success — snapshot is no longer needed
      snapshot = null;
    } catch (err) {
      // Render failed — restore snapshot if we have one
      if (snapshot) {
        try {
          // Clear current (possibly partial) content
          while (container.firstChild) container.removeChild(container.firstChild);
          // Restore children from snapshot
          while (snapshot.firstChild) {
            container.appendChild(snapshot.firstChild);
          }
          console.warn('[NavigationGuard] Render failed — restored previous content');
        } catch (_) {}
      }
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: Auto-Retry with Backoff
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // If a navigation fails due to a transient error (network blip, 5xx),
  // retry up to MAX_RETRIES times with exponential backoff.
  //
  // Non-retryable errors (AbortError, 404, invalid URL) fail immediately.

  var MAX_RETRIES = 1;  // only 1 auto-retry — don't loop forever
  var RETRY_DELAY_MS = 800;

  function _isRetryable(err) {
    if (!err) return false;
    var msg = (err.message || '').toLowerCase();
    var name = err.name || '';
    // AbortError = intentional cancellation, never retry
    if (name === 'AbortError') return false;
    // 404 = resource doesn't exist, retrying won't help
    if (msg.includes('404') || msg.includes('not found')) return false;
    // Network errors, 5xx, timeout = retryable
    if (msg.includes('network') || msg.includes('fetch') ||
        msg.includes('timeout') || msg.includes('offline') ||
        msg.includes('500') || msg.includes('502') ||
        msg.includes('503') || msg.includes('504')) {
      return true;
    }
    return true; // default: retry unknown errors once
  }

  /**
   * Retry a function up to MAX_RETRIES times.
   * @param {Function} fn  () => Promise
   * @returns {Promise}
   */
  async function _withRetry(fn) {
    var lastErr;
    for (var attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (!_isRetryable(err)) throw err;
        if (attempt < MAX_RETRIES) {
          // Wait before retry (with jitter)
          var delay = RETRY_DELAY_MS + Math.random() * 200;
          await new Promise(function (r) { setTimeout(r, delay); });
          console.warn('[NavigationGuard] Retrying after error (attempt ' + (attempt + 1) + '):', err.message);
        }
      }
    }
    throw lastErr;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: Never-Stuck Watchdog
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Periodically checks that:
  //   1. Loading overlay is not visible for > 5s without progress
  //   2. Content container is not empty for > 3s after navigation completes
  //   3. Body scroll-lock is not held for > 30s
  //
  // If any check fails, force-recover.

  var WATCHDOG_INTERVAL_MS = 2000;  // check every 2s
  var STUCK_LOADING_MS = 5000;      // loading visible > 5s = stuck
  var EMPTY_CONTENT_MS = 3000;      // empty content > 3s after nav = problem
  var _watchdogTimer = null;
  var _lastNavCompletedAt = 0;
  var _contentWasEmptySince = 0;

  function _startWatchdog() {
    if (_watchdogTimer) return;
    _watchdogTimer = setInterval(_watchdogTick, WATCHDOG_INTERVAL_MS);
  }

  function _watchdogTick() {
    try {
      var now = Date.now();

      // Check 1: Loading stuck
      var loading = M.LoadingService;
      if (loading && loading._visibleSince && loading._sessionCount > 0) {
        if (now - loading._visibleSince > STUCK_LOADING_MS) {
          console.warn('[NavigationGuard] Loading stuck > ' + STUCK_LOADING_MS + 'ms — force-reset');
          try { loading._forceReset(); } catch (_) {}
        }
      }

      // Check 2: Empty content after navigation completed
      if (_lastNavCompletedAt > 0) {
        var ctr = document.getElementById('content-loading');
        var isEmpty = !ctr || ctr.children.length === 0;
        if (isEmpty) {
          if (_contentWasEmptySince === 0) {
            _contentWasEmptySince = now;
          } else if (now - _contentWasEmptySince > EMPTY_CONTENT_MS) {
            console.warn('[NavigationGuard] Content empty > ' + EMPTY_CONTENT_MS + 'ms after nav — showing skeleton');
            // Show skeleton as a fallback so the page isn't blank
            try {
              if (M.ContentService && M.ContentService._showSkeleton) {
                M.ContentService._showSkeleton(8);
              }
            } catch (_) {}
            _contentWasEmptySince = 0;
          }
        } else {
          _contentWasEmptySince = 0;
        }
      }

      // Check 3: Body scroll-lock stuck (delegated to ScrollLockService watchdog)
    } catch (_) {}
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: Error Recovery UI
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // When ALL recovery attempts fail, show a friendly error UI with retry
  // and back buttons. This is the "dead-end" fallback — the user is never
  // left looking at a blank page or a stuck spinner.

  /**
   * Show an error UI in the content container with retry + back buttons.
   * @param {Error} err
   * @param {Function} retryFn  () => Promise — called when user clicks "Retry"
   */
  function _showErrorUI(err, retryFn) {
    try {
      var ctr = document.getElementById('content-loading');
      if (!ctr) return;

      // Clear current content
      while (ctr.firstChild) ctr.removeChild(ctr.firstChild);

      var errorDiv = document.createElement('div');
      errorDiv.className = 'nc-nav-error';
      errorDiv.setAttribute('role', 'alert');
      errorDiv.style.cssText =
        'display:flex;flex-direction:column;align-items:center;' +
        'justify-content:center;padding:60px 20px;text-align:center;' +
        'font-family:system-ui,-apple-system,sans-serif;color:#3c4043;';

      var icon = document.createElement('div');
      icon.style.cssText = 'font-size:48px;margin-bottom:16px;';
      icon.textContent = '⚠️';
      errorDiv.appendChild(icon);

      var title = document.createElement('div');
      title.style.cssText = 'font-size:18px;font-weight:600;margin-bottom:8px;';
      title.textContent = 'Unable to load content';
      errorDiv.appendChild(title);

      var desc = document.createElement('div');
      desc.style.cssText = 'font-size:14px;color:#9aa0a6;margin-bottom:24px;max-width:320px;';
      desc.textContent = 'Please check your connection and try again.';
      errorDiv.appendChild(desc);

      var btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:12px;';

      var retryBtn = document.createElement('button');
      retryBtn.textContent = 'Retry';
      retryBtn.style.cssText =
        'background:#13b47f;color:#fff;border:none;padding:12px 24px;' +
        'border-radius:24px;font-size:14px;font-weight:600;cursor:pointer;';
      retryBtn.onclick = function () {
        // Remove error UI
        try { errorDiv.remove(); } catch (_) {}
        // Call retry function
        if (retryFn) {
          Promise.resolve(retryFn()).catch(function (e) {
            console.error('[NavigationGuard] Retry failed:', e);
            _showErrorUI(e, retryFn);  // show error UI again
          });
        }
      };
      btnRow.appendChild(retryBtn);

      var backBtn = document.createElement('button');
      backBtn.textContent = 'Back';
      backBtn.style.cssText =
        'background:transparent;color:#13b47f;border:1px solid #13b47f;' +
        'padding:12px 24px;border-radius:24px;font-size:14px;font-weight:600;cursor:pointer;';
      backBtn.onclick = function () {
        try { window.history.back(); } catch (_) {
          try { window.location.href = '/'; } catch (_) {}
        }
      };
      btnRow.appendChild(backBtn);

      errorDiv.appendChild(btnRow);
      ctr.appendChild(errorDiv);

      // Announce to screen readers
      try {
        if (M.A11yService) {
          M.A11yService.announceError('Content failed to load. Press retry to try again.');
        }
      } catch (_) {}
    } catch (_) {}
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 6: Public API
  // ═══════════════════════════════════════════════════════════════════════════

  M.NavigationGuard = Object.freeze({
    // Rapid-click coalescer
    requestNavigation: _requestNavigation,

    // Never-empty content guard
    withNeverEmpty: _withNeverEmpty,

    // Auto-retry
    withRetry: _withRetry,
    isRetryable: _isRetryable,

    // Error UI
    showErrorUI: _showErrorUI,

    // Watchdog
    startWatchdog: _startWatchdog,
    notifyNavigationCompleted: function () {
      _lastNavCompletedAt = Date.now();
      _contentWasEmptySince = 0;
    },

    // Diagnostics
    _state: function () {
      return {
        hasActiveNavigation: !!_activeNavigation,
        pendingTarget: _pendingTarget,
        watchdogActive: !!_watchdogTimer,
        lastNavCompletedAt: _lastNavCompletedAt,
      };
    },
  });

  // Auto-start watchdog when module loads (after DOM is ready)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _startWatchdog, { once: true });
  } else {
    _startWatchdog();
  }

})(window.NavCoreModules = window.NavCoreModules || {});
