class FantroveConsolePro {
    constructor() {
        this.apiUrl = 'https://fantrove-console-api.nontakorn2600.workers.dev';
        this.logs = [];
        this.pendingLogs = [];
        this.activeFilters = new Set(['error', 'warn', 'info', 'log', 'debug', 'success']);
        this.searchQuery = '';
        this.isCapturing = true;
        this.sessionId = this.getOrCreateSession();
        this.isOnline = navigator.onLine;
        this.isCloudConnected = false;
        this.isSyncing = false;
        this.stats = { code: 0, network: 0, system: 0, api: 0, unknown: 0, cloud: 0, local: 0 };
        this.connectionError = null;
        this.isInitialized = false;
        this.lastSyncTime = 0;
        this.syncInterval = null;
        
        // Patterns ของข้อความ system ที่ไม่ต้องการบันทึก
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
            /^Force sync completed/i,
            /^Synced \d+ total logs/i
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
        this.setupStorageSync();
        this.updateConnectionStatus('local');
        this.isInitialized = true;
        
        // โหลดข้อมูลจากทุกแหล่งพร้อมกัน
        this.loadAllSources();
        
        // ใช้ skipStorage = true เพื่อไม่บันทึกลงฐานข้อมูล
        this.system('Console ready (Session: ' + this.sessionId.substring(0, 8) + ')', null, true);
        
        // เริ่มระบบ Real-time Sync
        this.startRealTimeSync();
    }

    // โหลดข้อมูลจากทุกแหล่งพร้อมกัน
    async loadAllSources() {
        this.setSyncStatus(true, 'Loading data...');
        
        const promises = [];
        
        // โหลดจาก Local Backup
        promises.push(this.loadFromLocalBackup());
        
        // โหลดจาก Cloud ถ้า Online
        if (this.isOnline) {
            promises.push(this.loadLogsFromCloud().catch(err => {
                console.warn('Cloud load failed:', err);
                return [];
            }));
        }
        
        await Promise.all(promises);
        
        // รวมและจัดเรียงข้อมูล
        this.mergeAndSortLogs();
        this.refreshDisplay();
        this.updateStats();
        this.setSyncStatus(false);
    }

    // รวมข้อมูลจากทุกแหล่งและจัดเรียง
    mergeAndSortLogs() {
        // ลบข้อมูลซ้ำโดยใช้ ID หรือ timestamp + message เป็น key
        const seen = new Set();
        const uniqueLogs = [];
        
        // จัดเรียงตาม timestamp ล่าสุดก่อน
        this.logs.sort((a, b) => b.timestamp - a.timestamp);
        
        for (const log of this.logs) {
            const key = log.id || `${log.timestamp}-${log.message}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueLogs.push(log);
            }
        }
        
        this.logs = uniqueLogs.slice(0, 1000); // จำกัดไม่เกิน 1000 รายการ
    }

    async connectToCloud() {
        this.updateConnectionStatus('loading');
        
        try {
            await this.loadLogsFromCloud();
            this.isCloudConnected = true;
            this.updateConnectionStatus('connected');
            this.hideError();
        } catch (error) {
            this.isCloudConnected = false;
            this.updateConnectionStatus('local');
            throw error;
        }
    }

    async retryConnection() {
        this.hideError();
        try {
            await this.connectToCloud();
            this.showToast('Reconnected successfully');
        } catch (error) {
            this.showError('Still cannot connect to cloud');
        }
    }

    // ปรับปรุงการโหลดจาก Cloud ให้ดึงทั้งหมดและรวมกับข้อมูลเดิม
    async loadLogsFromCloud() {
        if (!this.isOnline) {
            throw new Error('Offline');
        }

        const healthController = new AbortController();
        const healthTimeout = setTimeout(() => healthController.abort(), 5000);
        
        let healthCheck;
        try {
            healthCheck = await fetch(`${this.apiUrl}/health`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                mode: 'cors',
                credentials: 'omit',
                signal: healthController.signal
            });
        } catch (err) {
            clearTimeout(healthTimeout);
            throw new Error('Health check failed');
        }
        clearTimeout(healthTimeout);

        if (!healthCheck || !healthCheck.ok) {
            throw new Error('Cannot reach API server');
        }

        // ดึงข้อมูลทั้งหมดจาก Cloud (เพิ่ม limit เป็น 1000)
        const logsController = new AbortController();
        const logsTimeout = setTimeout(() => logsController.abort(), 10000);
        
        let response;
        try {
            response = await fetch(
                `${this.apiUrl}/logs?session=${this.sessionId}&limit=1000`,
                {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                    mode: 'cors',
                    credentials: 'omit',
                    signal: logsController.signal
                }
            );
        } catch (err) {
            clearTimeout(logsTimeout);
            throw new Error('Logs fetch failed');
        }
        clearTimeout(logsTimeout);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const logs = await response.json();
        
        // แปลงข้อมูลจาก Cloud ให้ตรงกับรูปแบบภายใน
        const cloudLogs = logs.map(log => ({
            id: log.id,
            level: log.level || 'info',
            category: log.category || 'unknown',
            message: log.message || '',
            source: log.source || 'Cloud',
            meta: log.meta || {},
            stackTrace: log.stack_trace,
            timestamp: new Date(log.created_at).getTime(),
            fromCloud: true // 标记ว่ามาจาก Cloud
        }));
        
        // รวมเข้ากับข้อมูลที่มีอยู่
        this.logs = [...this.logs, ...cloudLogs];
        
        // อัปเดตสถิติ
        this.stats.cloud = cloudLogs.length;
        
        if (cloudLogs.length > 0) {
            this.system(`Loaded ${cloudLogs.length} logs from cloud`, null, true);
        }
        
        return cloudLogs;
    }

    async saveLogToCloud(log) {
        // ถ้าเป็นข้อความที่ไม่ต้องการบันทึก ให้ข้าม
        if (this.shouldSkipStorage(log)) {
            return { skipped: true };
        }

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

            const result = await response.json();
            // อัปเดต ID จาก Cloud
            if (result.id && !log.id) {
                log.id = result.id;
                log.fromCloud = true;
            }
            
            return result;
            
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

    // ซิงค์ข้อมูลที่ค้างอยู่ทั้งหมด
    async syncPendingLogs() {
        if (this.pendingLogs.length === 0 || !this.isOnline || this.isSyncing) {
            return;
        }
        
        // ตรวจสอบสถานะ API ก่อน
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
                }
                
                this.removeFromLocalBackup(saved);
                
                // โหลดข้อมูลใหม่จาก Cloud เพื่ออัปเดต ID
                await this.loadLogsFromCloud();
                this.mergeAndSortLogs();
                this.refreshDisplay();
                this.updateStats();
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

    // Force Sync ทั้งหมด
    async syncAll() {
        this.setSyncStatus(true, 'Full sync...');
        
        // 1. ซิงค์ pending logs ก่อน
        await this.syncPendingLogs();
        
        // 2. โหลดข้อมูลใหม่จาก Cloud
        try {
            await this.loadLogsFromCloud();
        } catch (e) {
            console.warn('Cloud sync failed:', e);
        }
        
        // 3. โหลดจาก Local อีกครั้ง
        await this.loadFromLocalBackup();
        
        // 4. รวมและจัดเรียง
        this.mergeAndSortLogs();
        this.refreshDisplay();
        this.updateStats();
        
        this.setSyncStatus(false);
        this.showToast(`Synced ${this.logs.length} total logs`);
    }

    // Real-time Sync ตรวจจับการเปลี่ยนแปลง
    startRealTimeSync() {
        // Sync ทุก 30 วินาที
        this.syncInterval = setInterval(() => {
            if (!document.hidden && this.isOnline) {
                this.syncPendingLogs();
                // ตรวจสอบข้อมูลใหม่จาก Cloud ทุก 2 นาที
                if (Date.now() - this.lastSyncTime > 120000) {
                    this.loadLogsFromCloud().then(() => {
                        this.mergeAndSortLogs();
                        this.refreshDisplay();
                        this.updateStats();
                    }).catch(() => {});
                    this.lastSyncTime = Date.now();
                }
            }
        }, 30000);

        // Sync เมื่อกลับมาที่หน้าเว็บ
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.syncPendingLogs();
            }
        });

        // Sync เมื่อกลับมา Online
        window.addEventListener('online', () => {
            setTimeout(() => this.syncAll(), 1000);
        });
    }

    setupNetworkListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.updateConnectionStatus('local');
        });
        
        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.isCloudConnected = false;
            this.updateConnectionStatus('offline');
        });
    }

    // โหลดจาก Local Backup และรวมเข้ากับข้อมูลหลัก
    async loadFromLocalBackup() {
        try {
            const backup = JSON.parse(localStorage.getItem('fantrove_backup') || '[]');
            const recent = backup.filter(l => Date.now() - (l._savedAt || 0) < 86400000);
            
            if (recent.length > 0) {
                // แปลงข้อมูลให้ตรงกับรูปแบบ
                const localLogs = recent.map(log => ({
                    ...log,
                    fromLocal: true, // 标记ว่ามาจาก Local
                    id: log.id || `local_${Date.now()}_${Math.random()}`
                }));
                
                // รวมเข้ากับข้อมูลหลัก
                this.logs = [...this.logs, ...localLogs];
                this.pendingLogs.push(...localLogs.filter(l => !l.fromCloud));
                
                this.stats.local = localLogs.length;
                
                // ใช้ skipStorage = true เพื่อไม่บันทึกข้อความนี้
                this.system(`Restored ${recent.length} logs from local backup`, null, true);
            }
            
            // ล้าง backup ที่เก่าแล้ว
            const validBackup = backup.filter(l => Date.now() - (l._savedAt || 0) < 86400000);
            localStorage.setItem('fantrove_backup', JSON.stringify(validBackup));
            
        } catch (e) {
            console.error('Load backup failed:', e);
        }
    }

    saveToLocalBackup(log) {
        // ถ้าเป็นข้อความที่ไม่ต้องการบันทึก ให้ข้าม
        if (this.shouldSkipStorage(log)) {
            return;
        }
        
        try {
            const backup = JSON.parse(localStorage.getItem('fantrove_backup') || '[]');
            backup.push({ ...log, _savedAt: Date.now() });
            if (backup.length > 200) backup.shift(); // เพิ่มเป็น 200 รายการ
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

    // ตรวจจับการเปลี่ยนแปลงจากแท็บอื่น
    setupStorageSync() {
        window.addEventListener('storage', (e) => {
            if (e.key === 'fantrove_backup' && e.newValue) {
                try {
                    const data = JSON.parse(e.newValue);
                    if (Array.isArray(data) && data.length > 0) {
                        // มีข้อมูลใหม่จากแท็บอื่น
                        const newLogs = data.filter(log => 
                            !this.logs.some(existing => existing.id === log.id)
                        );
                        if (newLogs.length > 0) {
                            this.logs.push(...newLogs);
                            this.mergeAndSortLogs();
                            this.refreshDisplay();
                            this.updateStats();
                        }
                    }
                } catch (err) {}
            }
        });
    }

    /**
     * เพิ่ม log entry
     * @param {Object} log - ข้อมูล log
     * @param {boolean} saveToCloud - บันทึกลง cloud หรือไม่
     * @param {boolean} skipStorage - ข้ามการบันทึกทั้งหมด (cloud + local) หรือไม่
     */
    async addLog(log, saveToCloud = true, skipStorage = false) {
        log.id = log.id || (Date.now() + Math.random()).toString();
        log.timestamp = log.timestamp || Date.now();
        
        // ตรวจสอบว่าเป็นข้อความ system ที่ไม่ต้องการบันทึกหรือไม่
        const shouldSkipStorage = skipStorage || this.shouldSkipStorage(log);
        
        this.logs.push(log);
        if (this.logs.length > 1000) this.logs.shift();
        
        if (this.isCapturing && this.shouldDisplay(log)) {
            this.renderLog(log);
        }
        
        this.updateStats();
        
        if (this.stats[log.category] !== undefined) {
            this.stats[log.category]++;
        } else {
            this.stats.unknown++;
        }
        
        // ถ้า skipStorage เป็น true จะไม่บันทึกลงทั้ง cloud และ local backup
        if (!shouldSkipStorage && saveToCloud && this.isInitialized) {
            this.saveLogToCloud(log).catch(() => {});
        }
    }

    /**
     * ตรวจสอบว่าข้อความควรข้ามการบันทึกหรือไม่
     */
    shouldSkipStorage(log) {
        // ถ้าไม่ใช่ system log ให้บันทึกตามปกติ
        if (log.category !== 'system' && log.source !== 'System') {
            return false;
        }
        
        const message = log.message || '';
        
        // ตรวจสอบกับ patterns ที่กำหนดไว้
        return this.skipStoragePatterns.some(pattern => pattern.test(message));
    }

    shouldDisplay(log) {
        if (!this.activeFilters.has(log.level)) return false;
        if (!this.searchQuery) return true;
        const query = this.searchQuery.toLowerCase();
        return (log.message || '').toLowerCase().includes(query) ||
               (log.source || '').toLowerCase().includes(query) ||
               (log.category || '').toLowerCase().includes(query);
    }

    renderLog(log, animate = true) {
        const output = document.getElementById('console-output');
        const emptyState = output.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        const entry = document.createElement('div');
        entry.className = `log-entry ${log.level}`;
        if (!animate) entry.style.animation = 'none';
        
        const time = new Date(log.timestamp).toLocaleTimeString('en-GB', {
            hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
        });

        const levelColors = { 
            error: 'error', warn: 'warn', info: 'info', 
            debug: 'debug', log: '', success: 'success' 
        };
        
        // รองรับหมวดหมู่ที่ไม่รู้จัก
        const categoryClass = log.category || 'unknown';
        const categoryLabel = log.category || 'unknown';
        
        let stackHtml = log.stackTrace ? `<div class="stack-trace">${this.escapeHtml(log.stackTrace)}</div>` : '';
        
        let metaHtml = '';
        if (log.meta && Object.keys(log.meta).length > 0) {
            const metaStr = Object.entries(log.meta)
                .filter(([k, v]) => v !== undefined && v !== null)
                .map(([k, v]) => `${k}: ${v}`)
                .join(', ');
            if (metaStr) metaHtml = `<div class="meta-data">${this.escapeHtml(metaStr)}</div>`;
        }

        // แสดงแหล่งที่มาของข้อมูล (Cloud/Local)
        const sourceIndicator = log.fromCloud ? '☁️' : (log.fromLocal ? '💾' : '');

        entry.innerHTML = `
            <div class="log-header">
                <span class="log-time">${time}</span>
                <span class="log-level-badge ${levelColors[log.level] || ''}">${log.level}</span>
                <span class="log-category ${categoryClass}">${categoryLabel}</span>
                <span class="log-source">${log.source || 'System'} ${sourceIndicator}</span>
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
            const allActive = this.activeFilters.size === 6;
            if (allActive) {
                this.activeFilters.clear();
                document.querySelectorAll('.filter-btn[data-level]').forEach(btn => btn.classList.remove('active'));
            } else {
                ['error', 'warn', 'info', 'log', 'debug', 'success'].forEach(l => this.activeFilters.add(l));
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
            this.pendingLogs = [];
            this.stats = { code: 0, network: 0, system: 0, api: 0, unknown: 0, cloud: 0, local: 0 };
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
        const counts = { all: this.logs.length, error: 0, warn: 0, info: 0, log: 0, debug: 0, success: 0 };
        const categories = { code: 0, network: 0, system: 0, api: 0, unknown: 0 };
        let cloudCount = 0;
        let localCount = 0;
        
        this.logs.forEach(log => { 
            if (counts[log.level] !== undefined) counts[log.level]++;
            if (categories[log.category] !== undefined) {
                categories[log.category]++;
            } else {
                categories.unknown++;
            }
            if (log.fromCloud) cloudCount++;
            if (log.fromLocal) localCount++;
        });
        
        Object.keys(counts).forEach(key => {
            const el = document.getElementById(`count-${key}`);
            if (el) el.textContent = counts[key];
        });

        document.getElementById('stat-total').textContent = counts.all;
        document.getElementById('stat-cloud').textContent = cloudCount;
        document.getElementById('stat-local').textContent = localCount;
        document.getElementById('stat-code').textContent = categories.code;
        document.getElementById('stat-network').textContent = categories.network;
        
        this.stats = { ...this.stats, ...categories, cloud: cloudCount, local: localCount };
    }

    updateConnectionStatus(status) {
        const dot = document.getElementById('status-dot');
        const text = document.getElementById('status-text');
        
        const styles = {
            loading: { color: 'var(--accent-yellow)', text: 'Connecting...', dot: '' },
            connected: { color: 'var(--accent-green)', text: 'Cloud Connected', dot: '' },
            local: { color: 'var(--accent-blue)', text: 'Local Mode', dot: 'local' },
            offline: { color: 'var(--accent-yellow)', text: 'Offline', dot: 'offline' },
            syncing: { color: 'var(--accent-purple)', text: 'Syncing...', dot: 'syncing' }
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

    // ปรับปรุง method ทั้งหมดให้รับพารามิเตอร์ skipStorage
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

window.FantroveConsole = {
    log: (m, meta) => consolePro.log(m, meta),
    info: (m, meta) => consolePro.info(m, meta),
    warn: (m, meta) => consolePro.warn(m, meta),
    error: (m, meta) => consolePro.error(m, meta),
    debug: (m, meta) => consolePro.debug(m, meta),
    success: (m, meta) => consolePro.addLog({ level: 'success', message: m, source: 'API', category: 'api', meta, timestamp: Date.now() })
};
