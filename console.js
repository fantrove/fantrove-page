/**
 * Fantrove Console Pro - Main JavaScript
 * Cloud logging with Supabase backend
 * Enhanced with historical data loading
 */

class FantroveConsolePro {
    constructor() {
        this.apiUrl = 'https://fantrove-console-api.nontakorn2600.workers.dev';
        this.logs = [];
        this.pendingLogs = [];
        this.activeFilters = new Set(['error', 'warn', 'info', 'log', 'debug']);
        this.searchQuery = '';
        this.isCapturing = true;
        this.sessionId = this.getOrCreateSession();
        this.isOnline = navigator.onLine;
        this.isCloudConnected = false;
        this.isSyncing = false;
        this.stats = { code: 0, network: 0, system: 0, api: 0 };
        this.connectionError = null;
        this.isInitialized = false;
        this.lastLoadTime = null; // เวลาที่โหลดข้อมูลล่าสุด
        this.isLoadingMore = false; // สถานะกำลังโหลดเพิ่ม
        this.hasMoreLogs = true; // ยังมีข้อมูลให้โหลดอีกหรือไม่
        
        // System messages to skip from storage
        this.skipStoragePatterns = [
            /^Console ready \(Session:/i,
            /^Restored \d+ logs from local backup/i,
            /^Loaded \d+ new logs from cloud/i,
            /^Synced \d+\/\d+ pending logs/i,
            /^Sync completed:/i,
            /^Capture (resumed|paused)/i,
            /^Display cleared/i,
            /^Exported$/i,
            /^Reconnected successfully$/i,
            /^Loading historical logs/i,
            /^Loaded \d+ historical logs/i
        ];
        
        this.init();
    }

    getOrCreateSession() {
        const urlParams = new URLSearchParams(window.location.search);
        const sessionFromUrl = urlParams.get('session');
        if (sessionFromUrl) {
            localStorage.setItem('fantrove_session_id', sessionFromUrl);
            return sessionFromUrl;
        }
        let session = localStorage.getItem('fantrove_session_id');
        if (!session) {
            session = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('fantrove_session_id', session);
        }
        return session;
    }

    init() {
        this.setupNetworkListeners();
        this.setupSmartErrorCapture();
        this.setupAPIMessageHandling();
        this.setupInfiniteScroll(); // เพิ่ม: ระบบ scroll โหลดเพิ่ม
        this.loadFromLocalBackup();
        this.updateConnectionStatus('local');
        this.isInitialized = true;
        
        this.system('Console ready (Session: ' + this.sessionId.substring(0, 8) + ')', null, true);
        
        // โหลดข้อมูลจาก cloud ทันทีที่เริ่มต้น
        setTimeout(() => {
            this.connectToCloud().catch(err => {
                console.warn('Cloud connection failed:', err);
                this.showError('Cloud unavailable. Working in local mode.');
            });
        }, 100);
        
        this.startSyncLoop();
        this.startRealtimeSync(); // เพิ่ม: ซิงค์แบบ real-time
    }

    // ============================================
    // NEW: ระบบโหลดข้อมูลย้อนหลัง (Historical Logs)
    // ============================================

    /**
     * โหลดข้อมูลจาก cloud พร้อมรองรับการโหลดย้อนหลัง
     */
    async connectToCloud() {
        this.updateConnectionStatus('loading');
        
        try {
            // โหลดข้อมูลล่าสุดก่อน (real-time)
            await this.loadLogsFromCloud();
            
            // โหลดข้อมูลย้อนหลังเพิ่มเติม (historical)
            await this.loadHistoricalLogs();
            
            this.isCloudConnected = true;
            this.updateConnectionStatus('connected');
            this.hideError();
        } catch (error) {
            this.isCloudConnected = false;
            this.updateConnectionStatus('local');
            throw error;
        }
    }

    /**
     * โหลด logs ล่าสุดจาก cloud (ใช้ตอนเริ่มต้น)
     */
    async loadLogsFromCloud(limit = 50) {
        if (!this.isOnline) {
            throw new Error('Offline');
        }

        this.setSyncStatus(true, 'Connecting...');
        
        const healthController = new AbortController();
        const healthTimeout = setTimeout(() => healthController.abort(), 5000);
        
        try {
            const healthCheck = await fetch(`${this.apiUrl}/health`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                mode: 'cors',
                credentials: 'omit',
                signal: healthController.signal
            });
            
            if (!healthCheck.ok) {
                throw new Error('Health check failed');
            }
        } catch (err) {
            clearTimeout(healthTimeout);
            this.setSyncStatus(false);
            throw new Error('API unreachable');
        }
        clearTimeout(healthTimeout);

        // โหลด logs ล่าสุด
        const logs = await this.fetchLogsFromAPI({ limit });
        
        if (logs.length > 0) {
            this.lastLoadTime = logs[logs.length - 1].timestamp; // บันทึกเวลาข้อมูลเก่าสุดที่โหลดมา
            this.mergeLogs(logs);
            this.system(`Loaded ${logs.length} recent logs from cloud`, null, true);
        }
        
        this.setSyncStatus(false);
        return logs;
    }

    /**
     * โหลดข้อมูลย้อนหลังเพิ่มเติม (historical data)
     */
    async loadHistoricalLogs(limit = 100) {
        if (!this.isOnline || !this.lastLoadTime) return;
        
        this.isLoadingMore = true;
        this.setSyncStatus(true, 'Loading history...');
        
        try {
            // โหลดข้อมูลที่เก่ากว่าเวลาที่โหลดมาล่าสุด
            const logs = await this.fetchLogsFromAPI({ 
                limit, 
                before: this.lastLoadTime 
            });
            
            if (logs.length > 0) {
                this.lastLoadTime = logs[logs.length - 1].timestamp;
                this.mergeLogs(logs, true); // true = prepend (เพิ่มด้านบน)
                this.system(`Loaded ${logs.length} historical logs`, null, true);
            } else {
                this.hasMoreLogs = false;
                this.system('All historical logs loaded', null, true);
            }
        } catch (error) {
            console.warn('Failed to load historical logs:', error);
        } finally {
            this.isLoadingMore = false;
            this.setSyncStatus(false);
        }
    }

    /**
     * ดึงข้อมูลจาก API ด้วยพารามิเตอร์ที่กำหนด
     */
    async fetchLogsFromAPI(params = {}) {
        const { limit = 50, before = null, after = null } = params;
        
        let url = `${this.apiUrl}/logs?session=${this.sessionId}&limit=${limit}`;
        
        // ถ้ามีพารามิเตอร์ before (โหลดข้อมูลเก่ากว่า)
        if (before) {
            url += `&before=${before}`;
        }
        
        // ถ้ามีพารามิเตอร์ after (โหลดข้อมูลใหม่กว่า - สำหรับ real-time sync)
        if (after) {
            url += `&after=${after}`;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                mode: 'cors',
                credentials: 'omit',
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            
            // แปลงรูปแบบข้อมูล
            return data.map(log => ({
                id: log.id,
                level: log.level,
                category: log.category,
                message: log.message,
                source: log.source,
                meta: log.meta || {},
                stackTrace: log.stack_trace,
                timestamp: new Date(log.created_at).getTime(),
                _fromCloud: true // 标记ว่ามาจาก cloud
            }));
            
        } catch (error) {
            clearTimeout(timeout);
            throw error;
        }
    }

    /**
     * รวม logs เข้ากับข้อมูลที่มีอยู่
     * @param {Array} newLogs - logs ใหม่
     * @param {boolean} prepend - true = เพิ่มด้านบน, false = เพิ่มด้านล่าง
     */
    mergeLogs(newLogs, prepend = false) {
        const existingIds = new Set(this.logs.map(l => l.id));
        const uniqueLogs = newLogs.filter(log => !existingIds.has(log.id));
        
        if (uniqueLogs.length === 0) return;
        
        if (prepend) {
            // เพิ่มด้านบน (สำหรับข้อมูลเก่า)
            this.logs = [...uniqueLogs, ...this.logs];
        } else {
            // เพิ่มด้านล่าง (สำหรับข้อมูลใหม่)
            this.logs = [...this.logs, ...uniqueLogs];
        }
        
        // จำกัดจำนวน logs ใน memory
        if (this.logs.length > 1000) {
            if (prepend) {
                this.logs = this.logs.slice(0, 1000);
            } else {
                this.logs = this.logs.slice(-1000);
            }
        }
        
        this.refreshDisplay();
        this.updateStats();
    }

    // ============================================
    // NEW: Infinite Scroll (เลื่อนลงเพื่อโหลดเพิ่ม)
    // ============================================

    setupInfiniteScroll() {
        const container = document.getElementById('console-output');
        
        container.addEventListener('scroll', () => {
            // เมื่อ scroll ถึงด้านบนสุด และยังมีข้อมูลเหลือ
            if (container.scrollTop < 50 && !this.isLoadingMore && this.hasMoreLogs && this.isCloudConnected) {
                this.loadHistoricalLogs(50);
            }
        });
    }

    // ============================================
    // NEW: Real-time Sync (ตรวจสอบข้อมูลใหม่เป็นระยะ)
    // ============================================

    startRealtimeSync() {
        // ตรวจสอบข้อมูลใหม่ทุก 5 วินาที
        setInterval(() => {
            if (this.isCloudConnected && !document.hidden) {
                this.checkForNewLogs();
            }
        }, 5000);
    }

    /**
     * ตรวจสอบ logs ใหม่จาก cloud (real-time)
     */
    async checkForNewLogs() {
        const lastLog = this.logs[this.logs.length - 1];
        const after = lastLog ? lastLog.timestamp : Date.now() - 60000; // 1 นาทีที่แล้ว
        
        try {
            const newLogs = await this.fetchLogsFromAPI({ 
                limit: 20, 
                after: after 
            });
            
            if (newLogs.length > 0) {
                this.mergeLogs(newLogs, false);
                
                // แจ้งเตือนเมื่อมี error ใหม่
                const hasNewErrors = newLogs.some(log => log.level === 'error');
                if (hasNewErrors) {
                    this.showToast(`${newLogs.length} new logs (including errors)`);
                }
            }
        } catch (error) {
            // ไม่แสดง error เพราะเป็น background sync
            console.debug('Realtime sync check failed:', error);
        }
    }

    // ============================================
    // ส่วนที่เหลือเหมือนเดิม (แก้ไขเล็กน้อย)
    // ============================================

    async retryConnection() {
        this.hideError();
        this.hasMoreLogs = true; // รีเซ็ตสถานะการโหลด
        try {
            await this.connectToCloud();
            this.showToast('Reconnected successfully');
        } catch (error) {
            this.showError('Still cannot connect to cloud');
        }
    }

    async saveLogToCloud(log) {
        if (!this.isOnline || !this.isCloudConnected) {
            this.pendingLogs.push(log);
            this.saveToLocalBackup(log);
            return { queued: true };
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        try {
            const payload = {
                session_id: this.sessionId,
                level: log.level,
                category: log.category || 'system',
                message: log.message,
                source: log.source,
                meta: log.meta || {},
                stack_trace: log.stackTrace,
                user_agent: navigator.userAgent,
                url: location.href
            };

            const response = await fetch(`${this.apiUrl}/logs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                mode: 'cors',
                credentials: 'omit',
                signal: controller.signal,
                keepalive: true
            });

            clearTimeout(timeout);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            return await response.json();
            
        } catch (error) {
            clearTimeout(timeout);
            this.pendingLogs.push(log);
            this.saveToLocalBackup(log);
            
            if (this.isCloudConnected) {
                this.showError('Sync failed. Logs queued for retry.');
                this.isCloudConnected = false;
                this.updateConnectionStatus('local');
            }
            
            return { error: error.message, queued: true };
        }
    }

    async syncPendingLogs() {
        if (this.pendingLogs.length === 0 || !this.isOnline || this.isSyncing) {
            return;
        }
        
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 3000);
        
        try {
            const health = await fetch(`${this.apiUrl}/health`, { 
                method: 'GET',
                mode: 'cors',
                credentials: 'omit',
                signal: controller.signal
            });
            if (!health.ok) throw new Error('API unavailable');
        } catch (e) {
            clearTimeout(t);
            return;
        }
        clearTimeout(t);

        this.isSyncing = true;
        this.setSyncStatus(true, `Syncing ${this.pendingLogs.length}...`);
        
        const batch = this.pendingLogs.splice(0, 50);
        const batchController = new AbortController();
        const batchTimeout = setTimeout(() => batchController.abort(), 10000);

        try {
            const response = await fetch(`${this.apiUrl}/logs/batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ logs: batch.map(log => ({
                    session_id: this.sessionId,
                    level: log.level,
                    category: log.category || 'system',
                    message: log.message,
                    source: log.source,
                    meta: log.meta || {},
                    stack_trace: log.stackTrace,
                    user_agent: navigator.userAgent,
                    url: location.href
                }))}),
                mode: 'cors',
                credentials: 'omit',
                signal: batchController.signal
            });

            clearTimeout(batchTimeout);

            if (response.ok) {
                const result = await response.json();
                this.isCloudConnected = true;
                this.hideError();
                
                const saved = result.saved || result.successful || 0;
                const failed = result.failed || 0;
                const total = result.total || batch.length;
                
                if (saved > 0) {
                    this.system(`Synced ${saved}/${total} pending logs${failed > 0 ? ` (${failed} failed)` : ''}`, null, true);
                } else if (failed > 0) {
                    this.warn(`Sync completed: ${failed} logs failed`, null, true);
                }
                
                this.removeFromLocalBackup(saved);
            } else {
                this.pendingLogs.unshift(...batch);
            }
        } catch (error) {
            clearTimeout(batchTimeout);
            this.pendingLogs.unshift(...batch);
        } finally {
            this.isSyncing = false;
            this.setSyncStatus(false);
        }
    }

    startSyncLoop() {
        setInterval(() => this.syncPendingLogs(), 10000);
        
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.syncPendingLogs();
                this.checkForNewLogs(); // เช็คข้อมูลใหม่ทันทีเมื่อกลับมาที่หน้า
            }
        });
    }

    setupNetworkListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.updateConnectionStatus('local');
            if (!this.isCloudConnected) {
                setTimeout(() => this.connectToCloud().catch(() => {}), 1000);
            }
        });
        
        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.isCloudConnected = false;
            this.updateConnectionStatus('offline');
        });
    }

    loadFromLocalBackup() {
        try {
            const backup = JSON.parse(localStorage.getItem('fantrove_backup') || '[]');
            const recent = backup.filter(l => Date.now() - l._savedAt < 86400000);
            
            if (recent.length > 0) {
                this.pendingLogs.push(...recent);
                this.system(`Restored ${recent.length} logs from local backup`, null, true);
            }
            
            this.refreshDisplay();
            this.updateStats();
        } catch (e) {}
    }

    saveToLocalBackup(log) {
        try {
            const backup = JSON.parse(localStorage.getItem('fantrove_backup') || '[]');
            backup.push({ ...log, _savedAt: Date.now() });
            if (backup.length > 100) backup.shift();
            localStorage.setItem('fantrove_backup', JSON.stringify(backup));
        } catch (e) {}
    }

    removeFromLocalBackup(count) {
        try {
            const backup = JSON.parse(localStorage.getItem('fantrove_backup') || '[]');
            const remaining = backup.slice(count);
            localStorage.setItem('fantrove_backup', JSON.stringify(remaining));
        } catch (e) {}
    }

    async addLog(log, saveToCloud = true, skipStorage = false) {
        log.id = log.id || (Date.now() + Math.random()).toString();
        log.timestamp = log.timestamp || Date.now();
        
        const shouldSkipStorage = skipStorage || this.shouldSkipStorage(log);
        
        this.logs.push(log);
        if (this.logs.length > 1000) this.logs.shift(); // เพิ่ม limit เป็น 1000
        
        if (this.isCapturing && this.shouldDisplay(log)) {
            this.renderLog(log);
        }
        
        this.updateStats();
        
        if (this.stats[log.category] !== undefined) {
            this.stats[log.category]++;
        }
        
        if (!shouldSkipStorage && saveToCloud && this.isInitialized) {
            this.saveLogToCloud(log).catch(() => {});
        }
    }

    shouldSkipStorage(log) {
        if (log.category !== 'system' && log.source !== 'System') {
            return false;
        }
        
        const message = log.message || '';
        return this.skipStoragePatterns.some(pattern => pattern.test(message));
    }

    shouldDisplay(log) {
        if (!this.activeFilters.has(log.level)) return false;
        if (!this.searchQuery) return true;
        const query = this.searchQuery.toLowerCase();
        return (log.message || '').toLowerCase().includes(query) ||
               (log.source || '').toLowerCase().includes(query);
    }

    renderLog(log, animate = true) {
        const output = document.getElementById('console-output');
        const emptyState = output.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        const entry = document.createElement('div');
        entry.className = `log-entry ${log.level}`;
        entry.dataset.logId = log.id; // เพิ่ม ID สำหรับอ้างอิง
        
        if (!animate) entry.style.animation = 'none';
        
        const time = new Date(log.timestamp).toLocaleTimeString('en-GB', {
            hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
        });

        const levelColors = { error: 'error', warn: 'warn', info: 'info', debug: 'debug', log: '', success: '' };
        const categoryClass = log.category || 'system';
        
        // เพิ่ม indicator สำหรับข้อมูลจาก cloud
        const cloudIndicator = log._fromCloud ? '<span title="From Cloud">☁️</span> ' : '';
        
        let stackHtml = log.stackTrace ? `<div class="stack-trace">${this.escapeHtml(log.stackTrace)}</div>` : '';
        
        let metaHtml = '';
        if (log.meta && Object.keys(log.meta).length > 0) {
            const metaStr = Object.entries(log.meta)
                .filter(([k, v]) => v !== undefined && v !== null)
                .map(([k, v]) => `${k}: ${v}`)
                .join(', ');
            if (metaStr) metaHtml = `<div class="meta-data">${this.escapeHtml(metaStr)}</div>`;
        }

        entry.innerHTML = `
            <div class="log-header">
                <span class="log-time">${cloudIndicator}${time}</span>
                <span class="log-level-badge ${levelColors[log.level] || ''}">${log.level}</span>
                <span class="log-category ${categoryClass}">${log.category}</span>
                <span class="log-source">${log.source || 'System'}</span>
            </div>
            <div class="log-content">${this.escapeHtml(log.message)}</div>
            ${metaHtml}
            ${stackHtml}
        `;

        output.appendChild(entry);
        
        const isNearBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 100;
        if (isNearBottom) output.scrollTop = output.scrollHeight;
    }

    escapeHtml(text) {
        if (typeof text !== 'string') text = String(text);
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    stringify(arg) {
        if (arg === null) return 'null';
        if (arg === undefined) return 'undefined';
        if (typeof arg === 'object') {
            try { return JSON.stringify(arg); } catch (e) { return '[Object]'; }
        }
        return String(arg);
    }

    setupSmartErrorCapture() {
        window.addEventListener('error', (event) => {
            if (this.isNoiseError(event)) return;
            this.captureError({
                type: 'code', category: 'code', message: event.message,
                filename: event.filename, lineno: event.lineno,
                stack: event.error?.stack, isUserCode: this.isUserCode(event.filename)
            });
        });

        window.addEventListener('unhandledrejection', (event) => {
            if (this.isNoisePromise(event.reason)) return;
            this.captureError({
                type: 'promise', category: 'code',
                message: event.reason?.message || String(event.reason),
                stack: event.reason?.stack, isUserCode: true
            });
        });

        this.setupSmartNetworkCapture();

        const originalError = console.error;
        console.error = (...args) => {
            originalError.apply(console, args);
            if (!this.isCapturing) return;
            const message = args.map(a => this.stringify(a)).join(' ');
            if (this.isNoiseMessage(message)) return;
            const error = args.find(a => a instanceof Error);
            if (error) {
                this.captureError({
                    type: 'console', category: 'code', message: message,
                    stack: error.stack, isUserCode: true
                });
            }
        };
    }

    isNoiseError(event) {
        const noise = ['ResizeObserver loop', 'Script error.', 'The operation was aborted', 'The user aborted a request'];
        return noise.some(n => event.message?.includes(n));
    }

    isNoisePromise(reason) {
        if (!reason) return true;
        const msg = String(reason.message || reason).toLowerCase();
        return msg.includes('resizeobserver') || msg.includes('abort') || msg.includes('cancel');
    }

    isNoiseMessage(msg) {
        const noise = ['webpack', 'hot module', 'HMR', '[Vue warn]', '[WDS]', 'ResizeObserver'];
        return noise.some(n => msg.includes(n));
    }

    isUserCode(filename) {
        if (!filename) return true;
        const thirdParty = ['node_modules', 'vendor', 'webpack', 'react-dom', 'vue.runtime'];
        return !thirdParty.some(p => filename.includes(p));
    }

    setupSmartNetworkCapture() {
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
            const url = args[0];
            try {
                const response = await originalFetch.apply(window, args);
                if (response.status >= 500) {
                    if (window.consolePro && typeof window.consolePro.captureError === 'function') {
                        window.consolePro.captureError({
                            type: 'http', category: 'network',
                            message: `Server Error ${response.status}: ${response.statusText}`,
                            url: url, status: response.status, critical: true
                        });
                    }
                }
                return response;
            } catch (error) {
                if (error.name !== 'AbortError') {
                    if (window.consolePro && typeof window.consolePro.captureError === 'function') {
                        window.consolePro.captureError({
                            type: 'network', category: 'network',
                            message: `Network Failed: ${error.message}`,
                            url: url, error: error.name, critical: true
                        });
                    }
                }
                throw error;
            }
        };
    }

    captureError(errorData) {
        const log = {
            level: errorData.critical ? 'error' : (errorData.category === 'network' ? 'warn' : 'error'),
            message: this.formatErrorMessage(errorData),
            source: errorData.filename || errorData.url || 'System',
            category: errorData.category || 'system',
            stackTrace: errorData.stack,
            meta: {
                type: errorData.type, line: errorData.lineno,
                column: errorData.colno, status: errorData.status,
                isUserCode: errorData.isUserCode
            },
            timestamp: Date.now()
        };
        this.addLog(log);
    }

    formatErrorMessage(data) {
        let msg = '';
        const labels = { code: '[CODE]', network: '[NETWORK]', system: '[SYSTEM]', api: '[API]' };
        msg += (labels[data.category] || '[ERROR]') + ' ';
        
        if (data.type === 'code' && data.filename) {
            const file = data.filename.split('/').pop();
            msg += `${data.message} (${file}:${data.lineno || 0})`;
        } else if (data.type === 'network' && data.url) {
            const urlObj = new URL(data.url, location.href);
            msg += `${data.message} → ${urlObj.pathname}`;
        } else {
            msg += data.message;
        }
        return msg;
    }

    setupAPIMessageHandling() {
        window.addEventListener('message', (e) => {
            if (e.data?.type === 'FANTROVE_LOG') this.receiveAPILog(e.data.payload);
        });

        window.addEventListener('storage', (e) => {
            if (e.key === 'fantrove_broadcast') {
                try {
                    const data = JSON.parse(e.newValue);
                    if (data && !data._local) this.receiveAPILog(data);
                } catch (err) {}
            }
        });

        if (typeof BroadcastChannel !== 'undefined') {
            this.channel = new BroadcastChannel('fantrove_console');
            this.channel.onmessage = (e) => {
                if (e.data?.type === 'FANTROVE_LOG') this.receiveAPILog(e.data.payload);
            };
        }
    }

    receiveAPILog(data) {
        const log = {
            level: data.level || 'info', message: data.message,
            source: data.source || 'API', category: 'api',
            meta: data.meta || null, stackTrace: data.stack,
            timestamp: Date.now()
        };
        this.addLog(log, false);
    }

    setFilter(level) {
        if (level === 'all') {
            const allActive = this.activeFilters.size === 5;
            if (allActive) {
                this.activeFilters.clear();
                document.querySelectorAll('.filter-btn[data-level]').forEach(btn => btn.classList.remove('active'));
            } else {
                ['error', 'warn', 'info', 'log', 'debug'].forEach(l => this.activeFilters.add(l));
                document.querySelectorAll('.filter-btn[data-level]').forEach(btn => btn.classList.add('active'));
            }
        } else {
            const btn = document.querySelector(`[data-level="${level}"]`);
            if (this.activeFilters.has(level)) {
                this.activeFilters.delete(level);
                btn.classList.remove('active');
            } else {
                this.activeFilters.add(level);
                btn.classList.add('active');
            }
        }
        this.refreshDisplay();
    }

    search(query) {
        this.searchQuery = query;
        this.refreshDisplay();
    }

    refreshDisplay() {
        const output = document.getElementById('console-output');
        output.innerHTML = '';
        
        const toShow = this.logs.filter(log => this.shouldDisplay(log));
        
        if (toShow.length === 0) {
            output.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">No matching logs</div></div>`;
        } else {
            toShow.forEach(log => this.renderLog(log, false));
        }
    }

    handleInput(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.executeFromButton();
        }
    }

    executeFromButton() {
        const input = document.getElementById('js-input');
        const code = input.value.trim();
        if (code) {
            this.system('> ' + code);
            try {
                const result = eval(code);
                if (result !== undefined) this.system('< ' + result);
            } catch (err) {
                this.error('✖ ' + err.message);
            }
            input.value = '';
            input.style.height = 'auto';
        }
    }

    toggleCapture() {
        this.isCapturing = !this.isCapturing;
        const btn = document.getElementById('capture-btn');
        if (this.isCapturing) {
            btn.innerHTML = '<span class="btn-icon">⏸</span><span>Pause</span>';
            this.system('Capture resumed', null, true);
        } else {
            btn.innerHTML = '<span class="btn-icon">▶</span><span>Resume</span>';
            this.warn('Capture paused', null, true);
        }
    }

    async clear() {
        if (confirm('Clear all logs?')) {
            this.logs = [];
            this.stats = { code: 0, network: 0, system: 0, api: 0 };
            this.refreshDisplay();
            this.updateStats();
            this.showToast('Display cleared');
        }
    }

    exportLogs() {
        const data = {
            exported: new Date().toISOString(),
            session: this.sessionId,
            count: this.logs.length,
            stats: this.stats,
            logs: this.logs
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fantrove-logs-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('Exported');
    }

    updateStats() {
        const counts = { all: this.logs.length, error: 0, warn: 0, info: 0, log: 0, debug: 0 };
        this.logs.forEach(log => { if (counts[log.level] !== undefined) counts[log.level]++; });
        
        Object.keys(counts).forEach(key => {
            const el = document.getElementById(`count-${key}`);
            if (el) el.textContent = counts[key];
        });

        document.getElementById('stat-total').textContent = counts.all;
        document.getElementById('stat-code').textContent = this.stats.code;
        document.getElementById('stat-network').textContent = this.stats.network;
    }

    updateConnectionStatus(status) {
        const dot = document.getElementById('status-dot');
        const text = document.getElementById('status-text');
        
        const styles = {
            loading: { color: 'var(--accent-yellow)', text: 'Connecting...', dot: '' },
            connected: { color: 'var(--accent-green)', text: 'Cloud Connected', dot: '' },
            local: { color: 'var(--accent-blue)', text: 'Local Mode', dot: 'local' },
            offline: { color: 'var(--accent-yellow)', text: 'Offline', dot: 'offline' }
        };
        
        const style = styles[status] || styles.local;
        dot.className = 'status-dot ' + style.dot;
        text.textContent = style.text;
        text.style.color = style.color;
    }

    setSyncStatus(syncing, message = '') {
        const status = document.getElementById('sync-status');
        if (syncing) {
            status.textContent = message || 'Syncing...';
            status.className = 'sync-status syncing';
        } else {
            const pending = this.pendingLogs.length;
            const backup = JSON.parse(localStorage.getItem('fantrove_backup') || '[]').length;
            const total = pending + backup;
            
            if (!this.isOnline) status.textContent = `${total} queued (offline)`;
            else if (!this.isCloudConnected) status.textContent = `${total} pending`;
            else status.textContent = total > 0 ? `${total} syncing...` : 'Synced';
            
            status.className = 'sync-status';
        }
    }

    showError(message) {
        this.connectionError = message;
        document.getElementById('error-message').textContent = message;
        document.getElementById('error-banner').classList.add('visible');
    }

    hideError() {
        this.connectionError = null;
        document.getElementById('error-banner').classList.remove('visible');
    }

    showToast(msg) {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }

    // Logging methods
    log(msg, meta, skipStorage = false) { 
        this.addLog({ level: 'log', message: msg, source: 'Console', category: 'api', meta, timestamp: Date.now() }, true, skipStorage); 
    }
    
    info(msg, meta, skipStorage = false) { 
        this.addLog({ level: 'info', message: msg, source: 'Console', category: 'api', meta, timestamp: Date.now() }, true, skipStorage); 
    }
    
    warn(msg, meta, skipStorage = false) { 
        this.addLog({ level: 'warn', message: msg, source: 'Console', category: 'api', meta, timestamp: Date.now() }, true, skipStorage); 
    }
    
    error(msg, meta, skipStorage = false) { 
        this.addLog({ level: 'error', message: msg, source: 'Console', category: 'api', meta, timestamp: Date.now() }, true, skipStorage); 
    }
    
    debug(msg, meta, skipStorage = false) { 
        this.addLog({ level: 'debug', message: msg, source: 'Console', category: 'api', meta, timestamp: Date.now() }, true, skipStorage); 
    }
    
    system(msg, meta, skipStorage = false) { 
        this.addLog({ level: 'info', message: msg, source: 'System', category: 'system', timestamp: Date.now() }, true, skipStorage); 
    }
}

// Initialize
window.consolePro = new FantroveConsolePro();

// Public API
window.FantroveConsole = {
    log: (m, meta) => consolePro.log(m, meta),
    info: (m, meta) => consolePro.info(m, meta),
    warn: (m, meta) => consolePro.warn(m, meta),
    error: (m, meta) => consolePro.error(m, meta),
    debug: (m, meta) => consolePro.debug(m, meta),
    success: (m, meta) => consolePro.addLog({ level: 'success', message: m, source: 'API', category: 'api', meta, timestamp: Date.now() })
};
