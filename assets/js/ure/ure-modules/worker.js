// Path:    assets/js/ure/ure-modules/worker.js
// Purpose: Web Worker bridge for off-main-thread data processing.
//          Filter / sort / paginate / dedupe / transform run in a background
//          thread so the main thread stays free for rendering.
//          Falls back to synchronous execution if Workers are unavailable.
// Used by: engine.js
//
// v1.6.0 — Persistent data storage to eliminate O(n) serialization on every
//          filter/paginate call at scale:
//
//  Worker-side:
//    _storedItems (null | any[]) — retained across messages.
//    'loadData'   — stores the array; engine calls this once when n ≥ threshold.
//    'clearData'  — releases stored reference (called on engine destroy).
//    filter / paginate / filterSort / dedupe — use _storedItems when present,
//    falling back to payload.items for backward-compat and sync mode.
//    sort — always uses payload.items because it sorts the current VIEW
//    (which may be a filtered subset the worker doesn't track separately).
//
//  Bridge-side:
//    _dataLoaded flag — set after loadData resolves.
//    filter / paginate — omit items from message when _dataLoaded is true,
//    saving the structured-clone cost entirely.
//    sort — always passes items (sorts current view, not original data).
//    Sync fallback — when worker is unavailable both paths receive items from
//    the caller so the fallback always has what it needs.

(function (M) {
  'use strict';

  // ── Worker source (runs in background thread) ─────────────────────────────

  const WORKER_SRC = `
'use strict';

// Retained dataset — loaded once via 'loadData', used by filter/paginate.
// Avoids repeated structured-clone transfers for large datasets.
let _storedItems = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    const preds = Array.isArray(predStr) ? predStr : [predStr];
    return arr.filter(item => preds.every(p => _applyPred(item, p)));
  } catch (_) { return arr; }
}

function _applyPred(item, pred) {
  const val = item[pred.field];
  switch (pred.op) {
    case 'eq'         : return val === pred.value;
    case 'neq'        : return val !== pred.value;
    case 'gt'         : return val >   pred.value;
    case 'lt'         : return val <   pred.value;
    case 'gte'        : return val >=  pred.value;
    case 'lte'        : return val <=  pred.value;
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

      // v1.6.0: store dataset in worker memory for subsequent filter/paginate
      case 'loadData':
        _storedItems = payload.items;
        result = { count: _storedItems.length };
        break;

      // v1.6.0: release stored reference so GC can reclaim memory
      case 'clearData':
        _storedItems = null;
        result = { ok: true };
        break;

      // Uses _storedItems when available; falls back to payload.items.
      // engine omits payload.items when _dataLoaded=true to avoid transfer.
      case 'filter':
        result = _filter(_storedItems ?? payload.items, payload.predicates);
        break;

      // Always receives payload.items — sorts the CURRENT VIEW (filtered subset)
      // not the full original dataset, so stored items would be wrong here.
      case 'sort':
        result = _sortBy(payload.items, payload.field, payload.dir);
        break;

      case 'filterSort':
        result = _sortBy(
          _filter(_storedItems ?? payload.items, payload.predicates),
          payload.field, payload.dir
        );
        break;

      case 'dedupe':
        result = _dedupe(_storedItems ?? payload.items, payload.field);
        break;

      case 'transform': {
        const { addField, fromField, value } = payload;
        result = payload.items.map(item => {
          const copy = Object.assign({}, item);
          if (addField) copy[addField] = fromField ? item[fromField] : value;
          return copy;
        });
        break;
      }

      case 'paginate': {
        const src = _storedItems ?? payload.items;
        const { page, pageSize } = payload;
        const start = (page - 1) * pageSize;
        result = {
          items      : src.slice(start, start + pageSize),
          total      : src.length,
          totalPages : Math.ceil(src.length / pageSize),
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

  function createWorkerBridge() {
    let _worker    = null;
    let _blobUrl   = null;
    let _ready     = false;
    let _idCounter = 0;

    /** @type {Map<number, {resolve: Function, reject: Function}>} */
    const _pending = new Map();

    // v1.6.0: true when engine has pre-loaded the dataset into the worker.
    // Checked by filter / paginate to skip the structured-clone transfer.
    let _dataLoaded = false;

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
      for (const [, p] of _pending) p.reject(new Error('Worker crashed'));
      _pending.clear();
      _ready = false;
      _dataLoaded = false;
    }

    // ── Synchronous fallback ──────────────────────────────────────────────

    function _syncExec(action, payload) {
      switch (action) {
        case 'filter'     : return _filterSync(payload.items, payload.predicates);
        case 'sort'       : return _sortSync(payload.items, payload.field, payload.dir);
        case 'filterSort' : return _sortSync(_filterSync(payload.items, payload.predicates), payload.field, payload.dir);
        case 'dedupe'     : return _dedupeSync(payload.items, payload.field);
        case 'loadData'   : return { count: payload.items.length };
        case 'clearData'  : return { ok: true };
        case 'paginate': {
          const { page, pageSize } = payload;
          const start = (page - 1) * pageSize;
          const src = payload.items;
          return { items: src.slice(start, start + pageSize), total: src.length, totalPages: Math.ceil(src.length / pageSize), page, pageSize };
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

    // ── exec ─────────────────────────────────────────────────────────────

    function _exec(action, payload) {
      if (!_ready) _init();
      if (!_ready || !_worker) {
        try { return Promise.resolve(_syncExec(action, payload)); }
        catch (e) { return Promise.reject(e); }
      }
      return new Promise((resolve, reject) => {
        const id = ++_idCounter;
        _pending.set(id, { resolve, reject });
        _worker.postMessage({ id, action, payload });
      });
    }

    // ── Public API ────────────────────────────────────────────────────────

    const Bridge = {

      exec: _exec,

      // v1.6.0: pre-load dataset into worker to avoid repeated transfer.
      // Resolves when worker has stored the array.
      // No-op in sync mode (items are passed per-call from the sync caller).
      async loadData(items) {
        if (!_ready) _init();
        if (!_ready || !_worker) return;
        await _exec('loadData', { items });
        _dataLoaded = true;
      },

      // v1.6.0: release stored reference; called before worker.destroy().
      clearData() {
        _dataLoaded = false;
        if (_ready && _worker) return _exec('clearData', {});
        return Promise.resolve({ ok: true });
      },

      // filter — omits items payload when data is loaded in worker,
      // saving the full structured-clone cost for large datasets.
      filter(items, predicates) {
        if (_dataLoaded && _ready && _worker) {
          return _exec('filter', { predicates });
        }
        return _exec('filter', { items, predicates });
      },

      // sort — always passes items (operates on current filtered VIEW,
      // not the full stored dataset).
      sort(items, field, dir = 'asc') {
        return _exec('sort', { items, field, dir });
      },

      filterSort(items, predicates, field, dir = 'asc') {
        if (_dataLoaded && _ready && _worker) {
          return _exec('filterSort', { predicates, field, dir });
        }
        return _exec('filterSort', { items, predicates, field, dir });
      },

      dedupe(items, field) {
        if (_dataLoaded && _ready && _worker) {
          return _exec('dedupe', { field });
        }
        return _exec('dedupe', { items, field });
      },

      // paginate — omits items when data is loaded (paginates original set).
      paginate(items, page, pageSize) {
        if (_dataLoaded && _ready && _worker) {
          return _exec('paginate', { page, pageSize });
        }
        return _exec('paginate', { items, page, pageSize });
      },

      destroy() {
        if (_worker) { try { _worker.terminate(); } catch (_) {} _worker = null; }
        if (_blobUrl) { try { URL.revokeObjectURL(_blobUrl); } catch (_) {} _blobUrl = null; }
        _pending.clear();
        _ready = false;
        _dataLoaded = false;
      },

      get isWorkerMode() { return _ready && !!_worker; },
      get dataLoaded()   { return _dataLoaded; },
    };

    return Bridge;
  }

  M.createWorkerBridge = createWorkerBridge;

})(window.UREModules = window.UREModules || {});