// @ts-check
/**
 * @file circuit-breaker.js
 * CircuitBreaker — resilience pattern for failing dependencies.
 *
 * v1.0.0
 *
 * RESEARCH BASIS:
 *
 * 1. Netflix Hystrix (Netflix, 2012)
 *    Pattern: wrap each dependency call in a circuit breaker. Track
 *    failure rate over a sliding window. When failures exceed threshold,
 *    "open" the circuit — reject all calls for a recovery period. After
 *    recovery, "half-open" — allow ONE test call. If it succeeds, "close"
 *    the circuit. If it fails, re-"open".
 *
 *    States:
 *      CLOSED    — normal operation, calls pass through, failures counted
 *      OPEN      — all calls fail fast (no network attempt), fallback used
 *      HALF_OPEN — one test call allowed to probe recovery
 *
 *    Source: github.com/Netflix/Hystrix/wiki/How-it-Works
 *    Michael Nygard "Release It!" (Pragmatic, 2007) — original pattern
 *
 * 2. AWS SDK Retry Strategy (AWS Architecture Blog, 2015)
 *    "Exponential Backoff and Jitter" — Marchetti, Athapaliya, Schunke
 *    Key insight: adding RANDOMNESS to retry delays dramatically reduces
 *    retry storms. Three jitter modes:
 *      • "no jitter"      — fixed exponential (worst — synchronized retries)
 *      • "equal jitter"   — half exponential + half random (better)
 *      • "decorrelated jitter" — next delay = min(cap, rand(base, prev*3))
 *                                 (best — proven 2x lower SLO violations)
 *    We implement "decorrelated jitter" — the AWS-recommended default.
 *    Source: aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 *
 * 3. Microsoft Azure Circuit Breaker (MSDN, 2015+)
 *    Adds:
 *      • Configurable failure threshold (not just count)
 *      • "Consecutive failures" vs "failure rate" modes
 *      • Per-instance vs shared breaker
 *    Source: learn.microsoft.com/azure/architecture/patterns/circuit-breaker
 *
 * 4. Resilience4j (Java, 2016)
 *    Modern successor to Hystrix. Adds:
 *      • Sliding window with two modes: COUNT_BASED (last N calls) or
 *        TIME_BASED (last N seconds)
 *      • Slow call rate threshold (separate from failure rate)
 *      • Permitted number of calls in half-open state (configurable)
 *    Source: resilience4j.readme.io
 *
 * 5. Google SRE Book (Beyer, Jones, Petoff, Murphy, 2016)
 *    Chapter 22 "Addressing Cascading Failures":
 *      • Circuit breakers are the primary defense against cascading failures
 *      • Fail fast: better to reject in 1ms than wait 30s for timeout
 *      • Shed load: when overwhelmed, dropping requests is BETTER than
 *        queuing (prevents unbounded latency growth)
 *    Source: sre.google/sre-book/handling-overload/
 *
 * WHY THIS MATTERS FOR NAVCORE:
 *   v3.0 had retry-with-backoff in DataService, but no circuit breaker.
 *   This meant: if the con-data server went down, EVERY navigation would
 *   retry 4 times (1 + 3 retries) × ~2s each = 8s of wasted time PER
 *   navigation, on top of the user seeing error toasts.
 *   With circuit breaker: after 5 failures in 10s, the circuit opens.
 *   Subsequent calls fail FAST (< 1ms) and return cached/stale data
 *   immediately. The user sees content (from cache) instead of errors.
 *
 * @module circuit-breaker
 * @depends {}
 */
(function (M) {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: Constants
  // ═══════════════════════════════════════════════════════════════════════════

  var CB_STATE = Object.freeze({
    CLOSED:    'closed',
    OPEN:      'open',
    HALF_OPEN: 'half_open',
  });

  // Default config — tuned for nav-core's typical usage:
  //   • 5 failures in 10s = open (5 calls is enough signal)
  //   • 30s recovery before half-open (gives server time to recover)
  //   • 3 half-open test calls (in case one is a flake)
  //   • 50% slow-call threshold (calls taking > 5s are "slow")
  var DEFAULTS = Object.freeze({
    failureThreshold: 5,         // open after N failures
    failureWindowMs: 10000,      // ...within this time window
    slowCallThreshold: 5000,     // calls slower than this are "slow"
    slowCallRateThreshold: 0.5,  // open if >50% calls are slow
    openStateDelayMs: 30000,     // stay open for this long before half-open
    halfOpenAllowedCalls: 3,     // test calls allowed in half-open
    fallback: null,              // function() → fallback value (sync or Promise)
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: CircuitBreaker class
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a circuit breaker.
   * @param {string} name    unique name for diagnostics
   * @param {Object} [opts]  config (merged with DEFAULTS)
   */
  function CircuitBreaker(name, opts) {
    this.name = name;
    this.config = Object.assign({}, DEFAULTS, opts || {});

    // State
    this.state = CB_STATE.CLOSED;
    this._openedAt = 0;             // when did we transition to OPEN
    this._halfOpenCalls = 0;        // calls attempted in half-open
    this._halfOpenSuccesses = 0;    // successes in half-open

    // Sliding window: array of { ts, success, duration }
    // We use an array (not a ring buffer) because the window is small
    // (typically <100 entries) and Array.filter is fast enough.
    this._window = [];

    // Decorrelated jitter state (AWS pattern)
    // See _decorrelatedJitter for explanation
    this._lastBackoff = this.config.openStateDelayMs || 1000;
  }

  /**
   * Execute a function through the circuit breaker.
   * @param {Function} fn  () => Promise<T>
   * @returns {Promise<T>}  resolves with fn's result OR fallback value
   */
  CircuitBreaker.prototype.execute = function (fn) {
    var self = this;

    // ── State machine: OPEN ───────────────────────────────────────────────
    // Fail fast (no network call) if circuit is OPEN and we haven't
    // waited long enough to try half-open.
    if (this.state === CB_STATE.OPEN) {
      var elapsed = Date.now() - this._openedAt;
      if (elapsed < this.config.openStateDelayMs) {
        // Still open — reject immediately
        return this._invokeFallback(new Error('CircuitOpen: ' + this.name));
      }
      // Recovery period elapsed → transition to half-open
      this._transitionTo(CB_STATE.HALF_OPEN);
      this._halfOpenCalls = 0;
      this._halfOpenSuccesses = 0;
    }

    // ── State machine: HALF_OPEN ─────────────────────────────────────────
    // Allow limited test calls. If they succeed → close. If they fail → reopen.
    if (this.state === CB_STATE.HALF_OPEN) {
      if (this._halfOpenCalls >= this.config.halfOpenAllowedCalls) {
        // Too many half-open calls already in flight — reject
        return this._invokeFallback(new Error('CircuitHalfOpenBusy: ' + this.name));
      }
      this._halfOpenCalls++;
    }

    // ── Execute the call ─────────────────────────────────────────────────
    var startTime = Date.now();
    return new Promise(function (resolve, reject) {
      Promise.resolve()
        .then(function () { return fn(); })
        .then(function (result) {
          var duration = Date.now() - startTime;
          self._onSuccess(duration);
          resolve(result);
        })
        .catch(function (err) {
          var duration = Date.now() - startTime;
          self._onFailure(duration, err);
          // If the call failed, try fallback (don't reject immediately)
          // BUT: only invoke fallback if circuit is now OPEN (i.e. this
          // failure pushed us over threshold). Otherwise, propagate the error.
          if (self.state === CB_STATE.OPEN) {
            self._invokeFallback(err).then(resolve, reject);
          } else {
            reject(err);
          }
        });
    });
  };

  /**
   * Record a successful call.
   */
  CircuitBreaker.prototype._onSuccess = function (duration) {
    this._window.push({
      ts: Date.now(),
      success: true,
      duration: duration,
    });
    this._pruneWindow();

    if (this.state === CB_STATE.HALF_OPEN) {
      this._halfOpenSuccesses++;
      // If we got enough successes in half-open, close the circuit
      if (this._halfOpenSuccesses >= Math.ceil(this.config.halfOpenAllowedCalls / 2)) {
        this._transitionTo(CB_STATE.CLOSED);
      }
    }
  };

  /**
   * Record a failed call.
   */
  CircuitBreaker.prototype._onFailure = function (duration, err) {
    this._window.push({
      ts: Date.now(),
      success: false,
      duration: duration,
      error: err && err.message ? err.message : String(err),
    });
    this._pruneWindow();

    if (this.state === CB_STATE.HALF_OPEN) {
      // Any failure in half-open → re-open
      this._transitionTo(CB_STATE.OPEN);
      return;
    }

    if (this.state === CB_STATE.CLOSED) {
      // Check if we should open
      var stats = this._computeStats();
      if (stats.failureCount >= this.config.failureThreshold) {
        this._transitionTo(CB_STATE.OPEN);
        return;
      }
      // Also open on slow-call rate threshold (Resilience4j feature)
      if (stats.total >= 5 && // need minimum samples
          stats.slowRate > this.config.slowCallRateThreshold) {
        this._transitionTo(CB_STATE.OPEN);
        return;
      }
    }
  };

  /**
   * Compute failure/slow stats over the sliding window.
   */
  CircuitBreaker.prototype._computeStats = function () {
    var now = Date.now();
    var windowStart = now - this.config.failureWindowMs;
    var total = 0, failures = 0, slow = 0;
    for (var i = 0; i < this._window.length; i++) {
      var e = this._window[i];
      if (e.ts < windowStart) continue;
      total++;
      if (!e.success) failures++;
      if (e.duration > this.config.slowCallThreshold) slow++;
    }
    return {
      total: total,
      failureCount: failures,
      failureRate: total > 0 ? failures / total : 0,
      slowCount: slow,
      slowRate: total > 0 ? slow / total : 0,
    };
  };

  /**
   * Prune entries older than the sliding window.
   */
  CircuitBreaker.prototype._pruneWindow = function () {
    var windowStart = Date.now() - this.config.failureWindowMs;
    // Filter in-place (mutate the array) to avoid GC pressure
    var writeIdx = 0;
    for (var readIdx = 0; readIdx < this._window.length; readIdx++) {
      if (this._window[readIdx].ts >= windowStart) {
        this._window[writeIdx++] = this._window[readIdx];
      }
    }
    this._window.length = writeIdx;
  };

  /**
   * Transition to a new state. Resets appropriate counters.
   */
  CircuitBreaker.prototype._transitionTo = function (newState) {
    if (this.state === newState) return;
    var oldState = this.state;
    this.state = newState;

    if (newState === CB_STATE.OPEN) {
      this._openedAt = Date.now();
    } else if (newState === CB_STATE.CLOSED) {
      // Reset sliding window on close (fresh start)
      this._window = [];
    }

    // Export state change to dataLayer
    try {
      if (typeof window.dataLayer !== 'undefined') {
        window.dataLayer.push({
          event: 'nc_circuit_breaker',
          name: this.name,
          from: oldState,
          to: newState,
        });
      }
    } catch (_) {}
  };

  /**
   * Invoke the fallback. If no fallback configured, reject with the error.
   * @returns {Promise}
   */
  CircuitBreaker.prototype._invokeFallback = function (err) {
    if (typeof this.config.fallback === 'function') {
      try {
        return Promise.resolve(this.config.fallback(err));
      } catch (e) {
        return Promise.reject(e);
      }
    }
    return Promise.reject(err);
  };

  /**
   * Reset the breaker to CLOSED state (for testing / manual recovery).
   */
  CircuitBreaker.prototype.reset = function () {
    this._transitionTo(CB_STATE.CLOSED);
    this._window = [];
    this._halfOpenCalls = 0;
    this._halfOpenSuccesses = 0;
  };

  /**
   * Get current state + stats (for diagnostics).
   */
  CircuitBreaker.prototype.getStats = function () {
    return Object.assign({}, this._computeStats(), {
      name: this.name,
      state: this.state,
      openedAt: this._openedAt,
      openFor: this.state === CB_STATE.OPEN
        ? Date.now() - this._openedAt
        : 0,
    });
  };

  /**
   * Decorrelated jitter backoff (AWS pattern).
   * next_delay = min(cap, random_between(base, prev * 3))
   *
   * Why decorrelated: equal jitter and full jitter still have a "ceiling"
   * that all clients approach together. Decorrelated jitter's ceiling
   * grows with each retry, so clients spread out over time.
   *
   * Used internally for half-open probe spacing if needed. Exposed for
   * DataService to use the same algorithm for fetch retries.
   */
  CircuitBreaker.prototype.decorrelatedJitter = function (base, cap) {
    base = base || 1000;
    cap = cap || 30000;
    this._lastBackoff = Math.min(cap, base + Math.random() * (this._lastBackoff * 3 - base));
    return this._lastBackoff;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: Registry
  // ═══════════════════════════════════════════════════════════════════════════

  var _registry = new Map();

  /**
   * Get or create a circuit breaker by name. Breakers are singletons
   * per name so state persists across calls.
   * @param {string} name
   * @param {Object} [opts]  only used if creating a new breaker
   * @returns {CircuitBreaker}
   */
  function _getOrCreate(name, opts) {
    if (!_registry.has(name)) {
      _registry.set(name, new CircuitBreaker(name, opts));
    }
    return _registry.get(name);
  }

  /**
   * Get an existing breaker (null if not found).
   */
  function _get(name) {
    return _registry.get(name) || null;
  }

  /**
   * Get stats for all breakers (for diagnostics dashboard).
   */
  function _getAllStats() {
    var result = [];
    _registry.forEach(function (cb) { result.push(cb.getStats()); });
    return result;
  }

  /**
   * Reset all breakers (for testing).
   */
  function _resetAll() {
    _registry.forEach(function (cb) { cb.reset(); });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: Export
  // ═══════════════════════════════════════════════════════════════════════════

  M.CircuitBreakerService = Object.freeze({
    STATE: CB_STATE,
    DEFAULTS: DEFAULTS,
    getOrCreate: _getOrCreate,
    get: _get,
    getAllStats: _getAllStats,
    resetAll: _resetAll,
    // Expose class for advanced use
    CircuitBreaker: CircuitBreaker,
  });

})(window.NavCoreModules = window.NavCoreModules || {});
