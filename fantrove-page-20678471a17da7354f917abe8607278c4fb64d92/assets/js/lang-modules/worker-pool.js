// @ts-check
/**
 * @file worker-pool.js
 * WorkerPool — Generic Web Worker pool แบบ lazy initialization
 *
 * การปรับปรุง v4.0:
 *  - Lazy init: workers สร้างตอนใช้งานจริงครั้งแรก
 *    หน้าที่ไม่มีการแปลภาษา = ไม่เสีย resource เลย
 *  - Shared blob URL: Blob สร้างครั้งเดียว ทุก worker ใช้ URL เดียวกัน
 *  - blob URL ถูก revoke เมื่อ destroy (ป้องกัน memory leak)
 *  - Worker error handling เพิ่มเข้ามา
 *
 * @module worker-pool
 */
(function(M) {
  'use strict';
  
  class WorkerPool {
    
    /**
     * @param {string} workerCode  — source code ของ worker (string)
     * @param {number} poolSize    — จำนวน worker สูงสุด
     */
    constructor(workerCode, poolSize) {
      this._code = workerCode;
      this._size = poolSize;
      this._blobUrl = null; // shared URL สำหรับทุก worker
      
      /** @type {Worker[]} */
      this._workers = [];
      /** @type {Worker[]} */
      this._idle = [];
      /** @type {Array<{data:any, resolve:Function, reject:Function}>} */
      this._queue = [];
      /** @type {Map<Worker, {data:any, resolve:Function, reject:Function}>} */
      this._jobMap = new Map();
      
      this._ready = false;
    }
    
    // ── Lazy initialization ───────────────────────────────────────────────────
    
    /**
     * สร้าง workers เมื่อต้องการครั้งแรก (idempotent)
     * @private
     */
    _ensureReady() {
      if (this._ready) return;
      
      // สร้าง blob URL ครั้งเดียว ใช้ร่วมกันทุก worker
      const blob = new Blob([this._code], { type: 'application/javascript' });
      this._blobUrl = URL.createObjectURL(blob);
      
      for (let i = 0; i < this._size; i++) {
        const w = new Worker(this._blobUrl);
        w.onmessage = (e) => this._onMessage(w, e);
        w.onerror = (e) => this._onError(w, e);
        this._workers.push(w);
        this._idle.push(w);
      }
      
      this._ready = true;
    }
    
    // ── Job execution ─────────────────────────────────────────────────────────
    
    /**
     * ส่ง job เข้าคิว — คืน Promise ที่ resolve เมื่อ worker ตอบกลับ
     * @param {any} data
     * @returns {Promise<any>}
     */
    execute(data) {
      this._ensureReady();
      return new Promise((resolve, reject) => {
        const job = { data, resolve, reject };
        const worker = this._idle.pop();
        if (worker) this._dispatch(worker, job);
        else this._queue.push(job);
      });
    }
    
    /** @private */
    _dispatch(worker, job) {
      this._jobMap.set(worker, job);
      worker.postMessage(job.data);
    }
    
    /** @private */
    _onMessage(worker, e) {
      const job = this._jobMap.get(worker);
      if (!job) return;
      
      this._jobMap.delete(worker);
      job.resolve(e.data);
      
      // ดึง job ถัดไปจากคิว หรือ return worker สู่ idle pool
      const next = this._queue.shift();
      if (next) this._dispatch(worker, next);
      else this._idle.push(worker);
    }
    
    /** @private */
    _onError(worker, e) {
      console.error('[WorkerPool] Worker error:', e);
      
      const job = this._jobMap.get(worker);
      if (job) {
        this._jobMap.delete(worker);
        job.reject(e);
      }
      
      // Return worker สู่ idle และดึง job ถัดไป
      this._idle.push(worker);
      const next = this._queue.shift();
      if (next && this._idle.length) {
        this._dispatch(this._idle.pop(), next);
      }
    }
    
    // ── Cleanup ───────────────────────────────────────────────────────────────
    
    /**
     * ปิด workers ทั้งหมด + revoke blob URL
     * เรียกตอน destroy
     */
    destroy() {
      this._workers.forEach(w => { try { w.terminate(); } catch (e) {} });
      
      if (this._blobUrl) {
        try { URL.revokeObjectURL(this._blobUrl); } catch (e) {}
        this._blobUrl = null;
      }
      
      this._workers = [];
      this._idle = [];
      this._queue = [];
      this._jobMap.clear();
      this._ready = false;
    }
  }
  
  M.WorkerPool = WorkerPool;
  
})(window.LangModules = window.LangModules || {});