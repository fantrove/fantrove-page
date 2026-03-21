// @ts-check
/**
 * @file worker-pool.js
 * WorkerPool — generic Web Worker pool สำหรับ parallel jobs.
 *
 * ไม่มี dependency — ใช้ได้ทั่วไป ไม่ผูกกับ language logic
 * TranslatorService จะรับ class นี้ไปสร้าง instance
 *
 * @module worker-pool
 */
(function(M) {
  'use strict';
  
  /**
   * Generic Web Worker pool
   * สร้าง worker จาก code string, จัดคิว jobs, recycle workers
   */
  class WorkerPool {
    /**
     * @param {string} workerCode  — source code ของ worker (เป็น string)
     * @param {number} poolSize    — จำนวน worker ที่จะสร้าง
     */
    constructor(workerCode, poolSize) {
      this.workers = [];
      this.idle = [];
      this.jobs = [];
      this.jobMap = new Map();
      
      for (let i = 0; i < poolSize; ++i) {
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        const worker = new Worker(url);
        worker.onmessage = (e) => this._onMessage(worker, e);
        this.workers.push(worker);
        this.idle.push(worker);
      }
    }
    
    /**
     * ส่ง job เข้าคิว — คืน Promise ที่ resolve เมื่อ worker ตอบกลับ
     * @param {any} data
     * @returns {Promise<any>}
     */
    execute(data) {
      return new Promise((resolve, reject) => {
        const job = { data, resolve, reject };
        if (this.idle.length > 0) {
          this._runJob(this.idle.pop(), job);
        } else {
          this.jobs.push(job);
        }
      });
    }
    
    /** @private */
    _runJob(worker, job) {
      this.jobMap.set(worker, job);
      worker.postMessage(job.data);
    }
    
    /** @private */
    _onMessage(worker, e) {
      const job = this.jobMap.get(worker);
      this.jobMap.delete(worker);
      job.resolve(e.data);
      this.idle.push(worker);
      if (this.jobs.length > 0) {
        this._runJob(this.idle.pop(), this.jobs.shift());
      }
    }
    
    /** ปิด workers ทั้งหมด — เรียกตอน destroy */
    destroy() {
      this.workers.forEach(w => { try { w.terminate(); } catch {} });
      this.workers = [];
      this.idle = [];
      this.jobs = [];
      this.jobMap.clear();
    }
  }
  
  M.WorkerPool = WorkerPool;
  
})(window.LangModules = window.LangModules || {});