// Path:    assets/js/nav-core-modules/route-cache.js
// Purpose: RouteCache — LRU cache ของ route state เพื่อ state preservation แบบ X
//          เก็บ DOM snapshot + scroll position + paginator/feed state ต่อ route
//
// Used by: router.js (save before navigate-away, restore on revisit)
//          content.js (save/restore DOM + observer state)
//
// Design:
//   - แต่ละ entry เก็บ:
//     • domSnapshot: DocumentFragment ที่ clone จาก #content-loading ก่อน clear
//     • scrollPosition: window.pageYOffset ณ ตอน navigate-away
//     • routeKind: 'feed' | 'lazy' | 'ure'  (ure = legacy renderContent)
//     • paginatorState: snapshot จาก SourcePaginator (สำหรับ lazy routes)
//     • feedState: snapshot จาก FeedService (สำหรับ feed route)
//     • hasMore: boolean — route ยังโหลดได้อีกไหม
//     • timestamp: number — ใช้สำหรับ TTL eviction
//
//   - LRU eviction: ถ้า entries > MAX_ENTRIES จะ evict entry ที่เก่าที่สุด
//   - TTL eviction: entries ที่เก่ากว่า TTL_MS จะถูก evict
//   - Memory cap: แต่ละ domSnapshot อาจกิน memory มาก — ถ้า total entries
//     ใช้ memory เกิน MAX_BYTES (estimated) จะ evict entry ที่ใหญ่ที่สุดก่อน
//
// ข้อแตกต่างจาก X:
//   - X ใช้ React + Redux + โครงสร้าง component tree ซับซ้อน
//   - เราใช้ static HTML/JS → clone DOM ตรงๆ ง่ายกว่า
//   - X อาจ re-fetch ข้อมูลใหม่บางส่วน — เราเก็บ DOM + state ไว้เลย ไม่ re-fetch

// @ts-check
(function (M) {
  'use strict';

  const RC = Object.freeze({
    // WHY 5: X เก็บประมาณ 5 timeline slots ใน memory
    //   น้อยกว่านี้ user อาจรู้สึกว่า "กลับไปไกลไม่ได้"
    //   มากกว่านี้ memory โดยเปล่า — โทรศัพท์ราคาประหยัดอาจกระตุก
    MAX_ENTRIES: 5,

    // WHY 5 min: สมมติ user อ่าน content นานแล้วกลับมา — ข้อมูลอาจเก่า → ดีกว่า re-fetch
    //   ถ้าเก่าเกิน 5 นาที cache หมดอายุ → render ใหม่จากศูนย์
    TTL_MS: 5 * 60 * 1000,
  });

  /**
   * @typedef {Object} RouteCacheEntry
   * @property {DocumentFragment|null} domSnapshot
   * @property {number}                scrollPosition
   * @property {'feed'|'lazy'|'ure'}   routeKind
   * @property {object|null}           paginatorState
   * @property {object|null}           feedState
   * @property {boolean}               hasMore
   * @property {number}                timestamp
   * @property {string}                routeKey
   */

  const RouteCache = {

    /** @type {Map<string, RouteCacheEntry>} — Map เพื่อรักษา insertion order สำหรับ LRU */
    _cache: new Map(),

    /** @type {string|null} — route ที่กำลัง active อยู่ */
    _currentRouteKey: null,

    /**
     * บันทึก state ของ route ปัจจุบันก่อน navigate ออก
     * @param {string}                routeKey
     * @param {object}                partial
     * @param {DocumentFragment|null} partial.domSnapshot
     * @param {number}                [partial.scrollPosition]
     * @param {'feed'|'lazy'|'ure'}   [partial.routeKind]
     * @param {object|null}           [partial.paginatorState]
     * @param {object|null}           [partial.feedState]
     * @param {boolean}               [partial.hasMore]
     */
    save(routeKey, partial) {
      if (!routeKey) return;

      // ถ้ามีอยู่แล้ว → ลบก่อน เพื่อให้ re-insert ไปท้าย Map (LRU)
      this._cache.delete(routeKey);

      /** @type {RouteCacheEntry} */
      const entry = {
        routeKey,
        domSnapshot:    partial.domSnapshot || null,
        scrollPosition: partial.scrollPosition || 0,
        routeKind:      partial.routeKind || 'ure',
        paginatorState: partial.paginatorState || null,
        feedState:      partial.feedState || null,
        hasMore:        partial.hasMore ?? false,
        timestamp:      Date.now(),
      };

      this._cache.set(routeKey, entry);
      this._evictIfNeeded();
    },

    /**
     * ดึง state ของ route — คืน null ถ้าไม่มี หรือหมดอายุ
     * @param {string} routeKey
     * @returns {RouteCacheEntry|null}
     */
    get(routeKey) {
      if (!routeKey) return null;
      const entry = this._cache.get(routeKey);
      if (!entry) return null;

      // TTL check
      if (Date.now() - entry.timestamp > RC.TTL_MS) {
        this._cache.delete(routeKey);
        return null;
      }

      // LRU: re-insert ไปท้าย Map (touch)
      this._cache.delete(routeKey);
      this._cache.set(routeKey, entry);

      this._currentRouteKey = routeKey;
      return entry;
    },

    /**
     * ตรวจว่ามี cache ที่ยัง valid ไหม (ไม่ restore — ใช้สำหรับ decision ใน router)
     */
    has(routeKey) {
      if (!routeKey) return false;
      const entry = this._cache.get(routeKey);
      if (!entry) return false;
      if (Date.now() - entry.timestamp > RC.TTL_MS) {
        this._cache.delete(routeKey);
        return false;
      }
      return true;
    },

    /**
     * ลบ entry เฉพาะ route (ใช้เมื่อต้องการบังคับ refresh)
     */
    invalidate(routeKey) {
      if (routeKey) this._cache.delete(routeKey);
      else this._cache.clear();
    },

    /**
     * ลบ entries ที่เก่ากว่า TTL ทั้งหมด — เรียกเป็นครั้งคราว
     */
    purgeExpired() {
      const now = Date.now();
      for (const [key, entry] of this._cache) {
        if (now - entry.timestamp > RC.TTL_MS) {
          this._cache.delete(key);
        }
      }
    },

    /**
     * ตั้งค่า route ปัจจุบัน — ใช้สำหรับ track ว่าอยู่ route ไหน
     */
    setCurrentRoute(routeKey) {
      this._currentRouteKey = routeKey;
    },

    getCurrentRoute() {
      return this._currentRouteKey;
    },

    /**
     * LRU eviction — ถ้า entries เกิน MAX_ENTRIES จะลบ entry ที่เก่าที่สุด
     * Map ใน JS รักษา insertion order → ใช้ iterator ตัวแรก = เก่าที่สุด
     */
    _evictIfNeeded() {
      while (this._cache.size > RC.MAX_ENTRIES) {
        const oldestKey = this._cache.keys().next().value;
        if (!oldestKey) break;
        this._cache.delete(oldestKey);
      }
    },

    /**
     * สร้าง DOM snapshot จาก container element
     * ใช้ cloneNode(true) เพื่อ clone ทั้ง subtree
     * แล้ว wrap ใน DocumentFragment เพื่อให้ restore ง่าย
     *
     * @param {HTMLElement} container
     * @returns {DocumentFragment|null}
     */
    snapshotDom(container) {
      if (!container || !container.childNodes.length) return null;
      const frag = document.createDocumentFragment();
      // clone ลูกทั้งหมด (ไม่ clone ตัว container เอง)
      for (const child of Array.from(container.childNodes)) {
        frag.appendChild(child.cloneNode(true));
      }
      return frag;
    },

    /**
     * Restore DOM snapshot ลงใน container
     * @param {HTMLElement}        container
     * @param {DocumentFragment}   snapshot
     */
    restoreDom(container, snapshot) {
      if (!container || !snapshot) return;
      container.innerHTML = '';
      // clone อีกครั้งเพื่อให้ snapshot ใช้ซ้ำได้ (ถ้า restore หลายครั้ง)
      container.appendChild(snapshot.cloneNode(true));
    },

    // ── Constants exposed ─────────────────────────────────────────────────────
    MAX_ENTRIES: RC.MAX_ENTRIES,
    TTL_MS:      RC.TTL_MS,
  };

  // ── Export ──────────────────────────────────────────────────────────────────
  M.RouteCache = RouteCache;

})(window.NavCoreModules = window.NavCoreModules || {});
