/**
 * Fantrove Console Pro - Main JavaScript
 * Cloud logging with Supabase backend
 * Simplified historical data loading
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
        this.cloudLogsLoaded = false; // ตรวจสอบว่าโหลดจาก cloud แล้วหรือยัง
        
        // System messages to skip from storage
        this.skipStoragePatterns = [
            /^Console ready \(Session:/i,
            /^Restored \d+ logs from local backup/i,
            /^Loaded \d+ logs from cloud/i,
            /^Synced \d+\/\d+ pending logs/i,
            /^Sync completed:/i,
            /^Capture (resumed|paused)/i,
            /^Display cleared/i,
            /^Exported$/i,
            /^Reconnected successfully$/i
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
        this.loadFromLocalBackup();
        this.updateConnectionStatus('local');
        this.isInitialized = true;
        
        this.system('Console ready (Session: ' + this.sessionId.substring(0, 8) + ')', null, true);
        
        // โหลดข้อมูลจาก cloud ทันทีที่เริ่มต้น
        setTimeout(() => {
            this.loadAllCloudLogs().catch(err => {
                console.warn('Cloud connection failed:', err);
                this.showError('Cloud unavailable. Working in local mode.');
            });
        }, 100);
        
        this.startSyncLoop();
    }

    // ============================================
    // ดึงข้อมูลทั้งหมดจาก Cloud (แบบง่าย ไม่มีพารามิเตอร์ซับซ้อน)
    // ============================================

    async loadAllCloudLogs() {
        if (!this.isOnline) {
            this.updateConnectionStatus('offline');
            return;
        }

        this.updateConnectionStatus('loading');
        this.setSyncStatus(true, 'Loading from cloud...');

        try {
            // ตรวจสอบ API ก่อน
            const healthCheck = await fetch(`${this.apiUrl}/health`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                mode: 'cors',
                credentials: 'omit'
            });

            if (!healthCheck.ok) {
                throw new Error('API health check failed');
            }

            // ดึงข้อมูลทั้งหมดของ session นี้ (ไม่จำกัดจำนวน)
            const response = await fetch(
                `${this.apiUrl}/logs?session=${this.sessionId}`,
                {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                    mode: 'cors',
                    credentials: 'omit'
                }
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const cloudLogs = await response.json();
            
            if (cloudLogs.length > 0) {
                // แปลงรูปแบบข้อมูลจาก cloud
                const formattedLogs = cloudLogs.map(log => ({
                    id: log.id,
                    level: log.level,
                    category: log.category,
                    message: log.message,
                    source: log.source,
                    meta: log.meta || {},
                    stackTrace: log.stack_trace,
                    timestamp: new Date(log.created_at).getTime()
                }));

                // รวมกับข้อมูลที่มีอยู่ (ไม่ซ้ำ)
                this.mergeCloudLogs(formattedLogs);
                
                this.system(`Loaded ${formattedLogs.length} logs from cloud`, null, true);
            } else {
                this.system('No historical logs found', null, true);
            }

            this.cloudLogsLoaded = true;
            this.isCloudConnected = true;
            this.updateConnectionStatus('connected');
            this.hideError();

        } catch (error) {
            console.error('Failed to load cloud logs:', error);
            this.isCloudConnected = false;
            this.updateConnectionStatus('local');
            // ไม่ throw error เพื่อให้ทำงานต่อใน local mode
        } finally {
            this.setSyncStatus(false);
        }
    }

    /**
     * รวมข้อมูลจาก cloud เข้ากับข้อมูลที่มีอยู่ (กรองซ้ำ)
     */
    mergeCloudLogs(cloudLogs) {
        // สร้าง Set ของ ID ที่มีอยู่แล้ว
        const existingIds = new Set(this.logs.map(l => l.id));
        
        // กรองเฉพาะที่ยังไม่มี
        const newLogs = cloudLogs.filter(log => !existingIds.has(log.id));
        
        if (newLogs.length === 0) return;

        // รวมข้อมูลและเรียงตามเวลา (เก่า -> ใหม่)
        this.logs = [...this.logs, ...newLogs];
        
        // เรียงลำดับตาม timestamp
        this.logs.sort((a, b) => a.timestamp - b.timestamp);
        
        // อัปเดตการแสดงผล
        this.refreshDisplay();
        this.updateStats();
    }

    // ============================================
    // ส่วนอื่นๆ เหมือนเดิม
    // ============================================

    async retryConnection() {
        this.hideError();
        this.cloudLogsLoaded = false;
        await this.loadAllCloudLogs();
    }

    async saveLogToCloud(log) {
        if (!this.isOnline || !this.isCloudConnected) {
            this.pendingLogs.push(log);
            this.saveToLocalBackup(log);
            return { queued: true };
        }

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
                keepalive: true
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            return await response.json();
            
        } catch (error) {
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

        this.isSyncing = true;
        this.setSyncStatus(true, `Syncing ${this.pendingLogs.length}...`);

        try {
            // ตรวจสอบ API ก่อน
            const health = await fetch(`${this.apiUrl}/health`, { 
                method: 'GET',
                mode: 'cors',
                credentials: 'omit'
            });
            
            if (!health.ok) throw new Error('API unavailable');

            const batch = this.pendingLogs.splice(0, 50);

            const response = await fetch(`${this.apiUrl}/logs/batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    logs: batch.map(log => ({
                        session_id: this.sessionId,
                        level: log.level,
                        category: log.category || 'system',
                        message: log.message,
                        source: log.source,
                        meta: log.meta || {},
                        stack_trace: log.stackTrace,
                        user_agent: navigator.userAgent,
                        url: location.href
                    }))
                }),
                mode: 'cors',
                credentials: 'omit'
            });

            if (response.ok) {
                const result = await response.json();
                this.isCloudConnected = true;
                this.hideError();
                
                const saved = result.saved || result.successful || 0;
                
                if (saved > 0) {
                    this.system(`Synced ${saved} pending logs`, null, true);
                }
                
                this.removeFromLocalBackup(saved);
            } else {
                this.pendingLogs.unshift(...batch);
            }
        } catch (error) {
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
            }
        });
    }

    setupNetworkListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.updateConnectionStatus('local');
            if (!this.isCloudConnected && !this.cloudLogsLoaded) {
                setTimeout(() => this.loadAllCloudLogs().catch(() => {}), 1000);
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
        if (!animate) entry.style.animation = 'none';
        
        const time = new Date(log.timestamp).toLocaleTimeString('en-GB', {
            hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
        });

        const levelColors = { error: 'error', warn: 'warn', info: 'info', debug: 'debug', log: '', success: '' };
        const categoryClass = log.category || 'system';
        
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
                <span class="log-time">${time}</span>
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
