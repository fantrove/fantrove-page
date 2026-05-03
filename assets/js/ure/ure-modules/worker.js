// Path:    assets/js/ure/ure-modules/worker.js
// Purpose: Web Worker bridge for off-main-thread data processing.
//          Filter / sort / transform operations run in a background thread
//          so the main thread stays free for rendering and user input.
//          Falls back to synchronous execution if Workers are unavailable.
// Used by: engine.js

(function (M) {
  'use strict';

  // ── Worker source code (runs in background thread) ────────────────────────
  // Encapsulated as a string so we can create a Blob URL without a separate
  // file. This avoids CORS issues and keeps the framework self-contained.

  const WORKER_SRC = `
'use strict';

// ── Helpers available inside the worker ──────────────────────────────────────

function _sortBy(arr, field, dir) {
  const d = dir === 'desc' ? -1 : 1;
  return arr.slice().sort((a, b) => {
    const va = a[field], vb = b[field];
    if (va === vb) return 0;
    if (va == null) return d;
    if (vb == null) return -d;
    return va < vb ? -d : d;
  });
}

function _filter(arr, predStr) {
  try {
    // predStr is a serialisable filter descriptor, NOT eval'd code.
    // Format: { field, op, value }
    const preds = Array.isArray(predStr) ? predStr : [predStr];
    return arr.filter(item => preds.every(p => _applyPred(item, p)));
  } catch (_) { return arr; }
}

function _applyPred(item, pred) {
  const val = item[pred.field];
  switch (pred.op) {
    case 'eq'  : return val === pred.value;
    case 'neq' : return val !== pred.value;
    case 'gt'  : return val >   pred.value;
    case 'lt'  : return val <   pred.value;
    case 'gte' : return val >=  pred.value;
    case 'lte' : return val <=  pred.value;
    case 'includes'   : return String(val || '').toLowerCase().includes(String(pred.value).toLowerCase());
    case 'startsWith' : return String(val || '').toLowerCase().startsWith(String(pred.value).toLowerCase());
    default: return true;
  }
}

function _dedupe(arr, field) {
  if (!field) return arr;
  const seen = new Set();
  return arr.filter(item => {
    const k = item[field];
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── Message handler ───────────────────────────────────────────────────────────

self.onmessage = function(e) {
  const { id, action, payload } = e.data;
  try {
    let result;
    switch (action) {
      case 'filter':
        result = _filter(payload.items, payload.predicates);
        break;
      case 'sort':
        result = _sortBy(payload.items, payload.field, payload.dir);
        break;
      case 'filterSort':
        result = _sortBy(
          _filter(payload.items, payload.predicates),
          payload.field, payload.dir
        );
        break;
      case 'dedupe':
        result = _dedupe(payload.items, payload.field);
        break;
      case 'transform': {
        // Apply a pure mapping: add/rename fields without eval
        const { addField, fromField, value } = payload;
        result = payload.items.map(item => {
          const copy = Object.assign({}, item);
          if (addField) copy[addField] = fromField ? item[fromField] : value;
          return copy;
        });
        break;
      }
      case 'paginate': {
        const { page, pageSize } = payload;
        const start = (page - 1) * pageSize;
        result = {
          items      : payload.items.slice(start, start + pageSize),
          total      : payload.items.length,
          totalPages : Math.ceil(payload.items.length / pageSize),
          page,
          pageSize,
        };
        break;
      }
      default:
        throw new Error('Unknown action: ' + action);
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err.message || err) });
  }
};
`;

  // ── WorkerBridge ──────────────────────────────────────────────────────────

  /**
   * Create a WorkerBridge instance (one per engine, lazy-initialised).
   * @returns {WorkerBridge}
   */
  function createWorkerBridge() {
    let _worker    = null;
    let _blobUrl   = null;
    let _ready     = false;
    let _idCounter = 0;

    /** @type {Map<number, {resolve: Function, reject: Function}>} */
    const _pending = new Map();

    function _init() {
      if (_ready) return;
      try {
        const blob = new Blob([WORKER_SRC], { type: 'application/javascript' });
        _blobUrl   = URL.createObjectURL(blob);
        _worker    = new Worker(_blobUrl);
        _worker.onmessage = _onMessage;
        _worker.onerror   = _onError;
        _ready = true;
      } catch (_) {
        // Workers not available (e.g. file:// origin) — will use sync fallback
        _ready = false;
      }
    }

    function _onMessage(e) {
      const { id, ok, result, error } = e.data;
      const pending = _pending.get(id);
      if (!pending) return;
      _pending.delete(id);
      if (ok) pending.resolve(result);
      else    pending.reject(new Error(error));
    }

    function _onError(e) {
      console.error('[URE/Worker] Worker error:', e.message);
      // Reject all pending promises
      for (const [, p] of _pending) p.reject(new Error('Worker crashed'));
      _pending.clear();
      _ready = false;
    }

    // ── Synchronous fallback (no Worker available) ────────────────────────

    function _syncExec(action, payload) {
      switch (action) {
        case 'filter'     : return _filterSync(payload.items, payload.predicates);
        case 'sort'       : return _sortSync(payload.items, payload.field, payload.dir);
        case 'filterSort' : return _sortSync(_filterSync(payload.items, payload.predicates), payload.field, payload.dir);
        case 'dedupe'     : return _dedupeSync(payload.items, payload.field);
        case 'paginate'   : {
          const { page, pageSize } = payload;
          const start = (page - 1) * pageSize;
          return { items: payload.items.slice(start, start + pageSize), total: payload.items.length, totalPages: Math.ceil(payload.items.length / pageSize), page, pageSize };
        }
        default: throw new Error('Unknown action: ' + action);
      }
    }

    function _filterSync(arr, preds) {
      preds = Array.isArray(preds) ? preds : [preds];
      return arr.filter(item => preds.every(p => {
        const val = item[p.field];
        switch (p.op) {
          case 'eq'        : return val === p.value;
          case 'neq'       : return val !== p.value;
          case 'gt'        : return val > p.value;
          case 'lt'        : return val < p.value;
          case 'gte'       : return val >= p.value;
          case 'lte'       : return val <= p.value;
          case 'includes'  : return String(val || '').toLowerCase().includes(String(p.value).toLowerCase());
          case 'startsWith': return String(val || '').toLowerCase().startsWith(String(p.value).toLowerCase());
          default: return true;
        }
      }));
    }

    function _sortSync(arr, field, dir) {
      const d = dir === 'desc' ? -1 : 1;
      return arr.slice().sort((a, b) => {
        const va = a[field], vb = b[field];
        if (va === vb) return 0;
        if (va == null) return d;
        if (vb == null) return -d;
        return va < vb ? -d : d;
      });
    }

    function _dedupeSync(arr, field) {
      if (!field) return arr;
      const seen = new Set();
      return arr.filter(item => { const k = item[field]; if (seen.has(k)) return false; seen.add(k); return true; });
    }

    // ── Public ────────────────────────────────────────────────────────────

    const Bridge = {

      /**
       * Send a job to the Worker and return a Promise with the result.
       * Falls back to synchronous execution if Workers unavailable.
       * @param {string} action
       * @param {object} payload
       * @returns {Promise<any>}
       */
      exec(action, payload) {
        // Lazy init
        if (!_ready) _init();

        // Sync fallback
        if (!_ready || !_worker) {
          try { return Promise.resolve(_syncExec(action, payload)); }
          catch (e) { return Promise.reject(e); }
        }

        return new Promise((resolve, reject) => {
          const id = ++_idCounter;
          _pending.set(id, { resolve, reject });
          _worker.postMessage({ id, action, payload });
        });
      },

      /** Convenience: filter items. */
      filter(items, predicates)             { return this.exec('filter',     { items, predicates }); },
      /** Convenience: sort items. */
      sort(items, field, dir = 'asc')       { return this.exec('sort',       { items, field, dir }); },
      /** Convenience: filter then sort. */
      filterSort(items, predicates, field, dir = 'asc') { return this.exec('filterSort', { items, predicates, field, dir }); },
      /** Convenience: deduplicate items by field. */
      dedupe(items, field)                  { return this.exec('dedupe',     { items, field }); },
      /** Convenience: paginate items. */
      paginate(items, page, pageSize)       { return this.exec('paginate',   { items, page, pageSize }); },

      /** Terminate worker and revoke Blob URL. */
      destroy() {
        if (_worker) { try { _worker.terminate(); } catch (_) {} _worker = null; }
        if (_blobUrl) { try { URL.revokeObjectURL(_blobUrl); } catch (_) {} _blobUrl = null; }
        _pending.clear();
        _ready = false;
      },

      get isWorkerMode() { return _ready && !!_worker; },
    };

    return Bridge;
  }

  M.createWorkerBridge = createWorkerBridge;

})(window.UREModules = window.UREModules || {});