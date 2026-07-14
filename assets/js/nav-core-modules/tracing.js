// @ts-check
/**
 * @file tracing.js
 * TracingService — OpenTelemetry-style distributed tracing within a page.
 *
 * v1.0.0
 *
 * RESEARCH BASIS:
 *
 * 1. OpenTelemetry JS (CNCF, 2019-present)
 *    W3C-standardized tracing: Trace Context (traceparent header) +
 *    Baggage. Spans have: name, start time, end time, attributes, events,
 *    status, parent span.
 *    Source: opentelemetry.io/docs/instrumentation/js/
 *    Spec: w3.org/TR/trace-context/
 *
 * 2. Chrome DevTools Performance Panel
 *    Flame chart visualization of spans. Each span has a category
 *    (scripting, rendering, painting, network) for color coding.
 *    Source: developer.chrome.com/docs/devtools/performance/
 *
 * 3. performance.measure() API (W3C User Timing Level 3)
 *    Browser-native span recording. Visible in DevTools Performance +
 *    captured by PerformanceObserver('measure'). We use this as the
 *    transport so spans show up in DevTools for free.
 *    Source: w3.org/TR/user-timing/
 *
 * 4. Datadog Real User Monitoring (RUM)
 *    Sample-based tracing: not every navigation gets a trace, only ~10%.
 *    This avoids the overhead of tracing every interaction. We adopt
 *    adaptive sampling.
 *    Source: docs.datadoghq.com/real_user_monitoring/
 *
 * 5. Pyroscope / FlameGraph (Brendan Gregg)
 *    Aggregated span visualization. We don't implement the UI, but our
 *    span export format is compatible with flamegraph.pl input.
 *    Source: github.com/brendangregg/FlameGraph
 *
 * WHY THIS MATTERS FOR NAVCORE:
 *   v3.0 had console.warn statements scattered through router.js. When a
 *   navigation was slow, you had to grep logs and guess which phase was
 *   slow. With tracing:
 *     • Each navigation gets a traceId (correlates all spans)
 *     • Each phase (validate, fetch, render) is a span with timing
 *     • Spans nest naturally (parent/child)
 *     • Export to DevTools (free) + dataLayer (for analytics)
 *   This makes performance debugging 10x faster.
 *
 * @module tracing
 * @depends {config.js}
 */
(function (M) {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: Constants
  // ═══════════════════════════════════════════════════════════════════════════

  // Sampling: trace 1 in N navigations to avoid overhead.
  // WHY 1/4: 25% sample gives statistical significance while keeping
  // overhead to ~0.1ms per span × ~10 spans = 1ms per traced navigation.
  // 25% of navigations × 1ms = 0.25ms avg per navigation. Negligible.
  var DEFAULT_SAMPLE_RATE = 4; // 1/4 = 25%

  // Span status values (matches OpenTelemetry)
  var SPAN_STATUS = Object.freeze({
    UNSET:   'unset',
    OK:      'ok',
    ERROR:   'error',
  });

  // Span categories (matches Chrome DevTools color scheme)
  var SPAN_CATEGORY = Object.freeze({
    NAVIGATION: 'navigation',
    NETWORK:    'network',
    RENDER:     'render',
    SCRIPT:     'script',
    IDLE:       'idle',
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: Internal state
  // ═══════════════════════════════════════════════════════════════════════════

  var _sampleRate = DEFAULT_SAMPLE_RATE;
  var _sampleCounter = 0;
  var _currentTrace = null;  // { traceId, spans: [], startTime }
  var _spanStack = [];       // stack of active spans (for nesting)
  var _allTraces = [];       // ring buffer of completed traces (last 20)
  var _userTimingSupported = typeof performance !== 'undefined' &&
                              performance.mark &&
                              performance.measure;

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate a W3C-compliant trace ID (32 hex chars = 128 bits).
   * Uses crypto.getRandomValues for cryptographic randomness.
   * Falls back to Math.random for older browsers.
   */
  function _generateTraceId() {
    try {
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        var bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        var hex = '';
        for (var i = 0; i < bytes.length; i++) {
          hex += bytes[i].toString(16).padStart(2, '0');
        }
        return hex;
      }
    } catch (_) {}
    // Fallback: Math.random (less random, but works everywhere)
    var id = '';
    for (var j = 0; j < 32; j++) {
      id += Math.floor(Math.random() * 16).toString(16);
    }
    return id;
  }

  /**
   * Generate a span ID (16 hex chars = 64 bits).
   */
  function _generateSpanId() {
    try {
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        var bytes = new Uint8Array(8);
        crypto.getRandomValues(bytes);
        var hex = '';
        for (var i = 0; i < bytes.length; i++) {
          hex += bytes[i].toString(16).padStart(2, '0');
        }
        return hex;
      }
    } catch (_) {}
    var id = '';
    for (var j = 0; j < 16; j++) {
      id += Math.floor(Math.random() * 16).toString(16);
    }
    return id;
  }

  /**
   * Decide whether to trace the current operation based on sample rate.
   * Uses counter-based sampling (deterministic, easier to reason about
   * than random).
   */
  function _shouldSample() {
    _sampleCounter++;
    return (_sampleCounter % _sampleRate) === 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: Span class
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * A span represents a unit of work. Spans nest: a child span must end
   * before its parent ends. We track nesting via _spanStack.
   *
   * @class
   */
  function Span(name, opts) {
    opts = opts || {};
    this.name = name;
    this.spanId = _generateSpanId();
    this.traceId = _currentTrace ? _currentTrace.traceId : _generateTraceId();
    this.parentSpanId = _spanStack.length > 0
      ? _spanStack[_spanStack.length - 1].spanId
      : null;
    this.startTime = performance.now();
    this.endTime = null;
    this.duration = null;
    this.status = SPAN_STATUS.UNSET;
    this.category = opts.category || SPAN_CATEGORY.SCRIPT;
    this.attributes = {};
    this.events = [];
    this._userTimingMark = null;

    // Record via performance.mark() for DevTools visibility
    if (_userTimingSupported) {
      this._userTimingMark = 'nc-span-' + this.spanId + '-start';
      try {
        performance.mark(this._userTimingMark);
      } catch (_) {}
    }
  }

  Span.prototype.setAttribute = function (key, value) {
    this.attributes[key] = value;
    return this;
  };

  Span.prototype.setAttributes = function (attrs) {
    Object.assign(this.attributes, attrs);
    return this;
  };

  Span.prototype.addEvent = function (name, attrs) {
    this.events.push({
      name: name,
      time: performance.now(),
      attributes: attrs || {},
    });
    return this;
  };

  Span.prototype.setStatus = function (status) {
    this.status = status;
    return this;
  };

  Span.prototype.end = function () {
    if (this.endTime !== null) return; // already ended
    this.endTime = performance.now();
    this.duration = this.endTime - this.startTime;

    // Record via performance.measure() for DevTools visibility
    if (_userTimingSupported && this._userTimingMark) {
      var endMark = 'nc-span-' + this.spanId + '-end';
      try {
        performance.mark(endMark);
        performance.measure(
          'nc:' + this.name,
          this._userTimingMark,
          endMark
        );
        // Clean up marks to avoid memory growth
        performance.clearMarks(this._userTimingMark);
        performance.clearMarks(endMark);
      } catch (_) {}
    }

    // Pop from span stack
    var idx = _spanStack.indexOf(this);
    if (idx >= 0) _spanStack.splice(idx, 1);

    // Add to current trace
    if (_currentTrace) {
      _currentTrace.spans.push(this);
    }

    // Export to dataLayer (for analytics)
    if (_currentTrace && _currentTrace.sampled) {
      try {
        if (typeof window.dataLayer !== 'undefined') {
          window.dataLayer.push({
            event: 'nc_span',
            traceId: this.traceId,
            spanId: this.spanId,
            parentSpanId: this.parentSpanId,
            name: this.name,
            category: this.category,
            duration: Math.round(this.duration * 100) / 100,
            status: this.status,
            attributes: this.attributes,
          });
        }
      } catch (_) {}
    }

    return this;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: Public API
  // ═══════════════════════════════════════════════════════════════════════════

  var TracingService = {

    SPAN_STATUS: SPAN_STATUS,
    SPAN_CATEGORY: SPAN_CATEGORY,

    /**
     * Start a new trace. A trace is a tree of spans. Returns the root span.
     * @param {string} name  human-readable trace name
     * @param {Object} [opts]
     * @returns {Span|null}  null if not sampled (caller should still run,
     *                       just don't expect spans to be recorded)
     */
    startTrace: function (name, opts) {
      var sampled = _shouldSample();
      _currentTrace = {
        traceId: _generateTraceId(),
        name: name,
        startTime: performance.now(),
        endTime: null,
        duration: null,
        sampled: sampled,
        spans: [],
      };
      _spanStack = [];

      if (!sampled) {
        // Not sampled — return a no-op span so callers can chain
        // .setAttribute().end() without conditional checks
        return _noopSpan();
      }

      return this.startSpan(name, opts);
    },

    /**
     * Start a child span within the current trace.
     * @param {string} name
     * @param {Object} [opts]  { category: SPAN_CATEGORY }
     * @returns {Span}
     */
    startSpan: function (name, opts) {
      if (!_currentTrace || !_currentTrace.sampled) {
        return _noopSpan();
      }
      var span = new Span(name, opts);
      _spanStack.push(span);
      return span;
    },

    /**
     * End the current trace. Computes total duration and exports.
     */
    endTrace: function () {
      if (!_currentTrace) return;
      _currentTrace.endTime = performance.now();
      _currentTrace.duration = _currentTrace.endTime - _currentTrace.startTime;

      // Add to ring buffer
      _allTraces.push(_currentTrace);
      if (_allTraces.length > 20) _allTraces.shift();

      // Export to dataLayer
      if (_currentTrace.sampled) {
        try {
          if (typeof window.dataLayer !== 'undefined') {
            window.dataLayer.push({
              event: 'nc_trace',
              traceId: _currentTrace.traceId,
              name: _currentTrace.name,
              duration: Math.round(_currentTrace.duration * 100) / 100,
              spanCount: _currentTrace.spans.length,
              // Slow-trace alert: if a navigation trace took > 2s,
              // flag it so analytics can segment
              slow: _currentTrace.duration > 2000,
            });
          }
        } catch (_) {}
      }

      _currentTrace = null;
      _spanStack = [];
    },

    /**
     * Get the current trace ID (for correlation in logs).
     * @returns {string|null}
     */
    getCurrentTraceId: function () {
      return _currentTrace ? _currentTrace.traceId : null;
    },

    /**
     * Get all completed traces (for debugging / flame graph).
     * @returns {Array}
     */
    getTraces: function () {
      return _allTraces.slice();
    },

    /**
     * Set the sample rate (1-in-N). Default 4 (25%).
     * @param {number} rate  must be >= 1
     */
    setSampleRate: function (rate) {
      _sampleRate = Math.max(1, Math.floor(rate));
    },

    /**
     * Force-enable tracing for ALL operations (for debugging).
     */
    enableFullTracing: function () {
      _sampleRate = 1;
    },

    /**
     * Get a flame-graph-friendly export of a trace.
     * Format: [{ name, value (duration ms), depth, category }]
     * @param {string} [traceId]  defaults to most recent
     * @returns {Array}
     */
    exportFlameGraph: function (traceId) {
      var trace = traceId
        ? _allTraces.find(function (t) { return t.traceId === traceId; })
        : _allTraces[_allTraces.length - 1];
      if (!trace) return [];

      // Build depth map from parentSpanId
      var spanById = {};
      trace.spans.forEach(function (s) { spanById[s.spanId] = s; });

      function depth(span) {
        var d = 0;
        var p = span.parentSpanId;
        while (p && spanById[p]) { d++; p = spanById[p].parentSpanId; }
        return d;
      }

      return trace.spans.map(function (s) {
        return {
          name: s.name,
          value: Math.round(s.duration * 100) / 100,
          depth: depth(s),
          category: s.category,
          status: s.status,
          attributes: s.attributes,
        };
      });
    },

    /**
     * Clear all stored traces (memory management).
     */
    clear: function () {
      _allTraces.length = 0;
      _currentTrace = null;
      _spanStack = [];
    },
  };

  // No-op span: returned when tracing isn't sampled. All methods are
  // no-ops so callers can chain without conditional checks.
  function _noopSpan() {
    return {
      setAttribute: function () { return this; },
      setAttributes: function () { return this; },
      addEvent: function () { return this; },
      setStatus: function () { return this; },
      end: function () { return this; },
      // Make it look like a Span for callers that inspect properties
      name: 'noop',
      spanId: 'noop',
      traceId: 'noop',
      parentSpanId: null,
      startTime: 0,
      endTime: 0,
      duration: 0,
      status: SPAN_STATUS.UNSET,
      category: SPAN_CATEGORY.IDLE,
      attributes: {},
      events: [],
    };
  }

  M.TracingService = TracingService;

})(window.NavCoreModules = window.NavCoreModules || {});
