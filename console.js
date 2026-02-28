/**
 * Fantrove Console Pro - Fixed Version
 * แก้ไข: การเชื่อมต่อ Supabase 401 และเพิ่ม Debug Logging
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
        
        // ลดการเรียก API
        this.lastSyncTime = 0;
        this.syncInterval = 30000;
        this.realtimeCheckInterval = 15000;
        this.retryCount = 0;
        this.maxRetries = 3;
        
        this.loadedTimeRange = { oldest: null, newest: null };
        this.hasMoreOldLogs = true;
        
        this.skipStoragePatterns = [
            /^Console ready/i, /^Restored \d+ logs/i, /^Loaded \d+ logs/i,
            /^Synced \d+/i, /^Sync completed/i, /^Capture (resumed|paused)/i,
            /^Display cleared/i, /^Exported$/i, /^Reconnected/i, /^Loading/i,
            /^Cloud error/i, /^Connection failed/i  // เพิ่ม patterns ที่ skip
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
            session = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
            localStorage.setItem('fantrove_session_id', session);
        }
        return session;
    }

    async init() {
        this.setupNetworkListeners();
        this.setupSmartErrorCapture();
        this.setupAPIMessageHandling();
        this.setupScrollHandler();
        
        // โหลดจาก local ก่อน
        this.loadFromLocalStorage();
        
        this.isInitialized = true;
        this.system('Console ready', null, true);
        
        // เชื่อมต่อ cloud
        if (this.isOnline) {
            setTimeout(() => this.connectToCloud(), 500);
        }
    }

    // ============================================
    // FIXED: Connection ที่มี Debug และ Retry ที่ดีขึ้น
    // ============================================
    
    async connectToCloud() {
        this.updateConnectionStatus('loading');
        this.system('Connecting to cloud...', null, true);
        
        try {
            // ทดสอบ health check พร้อมรับข้อมูล debug
            const healthRes = await this.fetchWithTimeout(
                `${this.apiUrl}/health`, 
                { method: 'GET' }, 
                5000
            );
            
            const healthData = await healthRes.json();
            console.log('[Console] Health check:', healthData);
            
            if (!healthRes.ok || healthData.status !== 'healthy') {
                throw new Error(healthData.error || 'Health check failed');
            }
            
            if (!healthData.supabase_connected) {
                throw new Error('Supabase connection failed - Check Worker logs');
            }
            
            // โหลด logs เริ่มต้น
            await this.loadInitialLogs();
            
            this.isCloudConnected = true;
            this.retryCount = 0;
            this.updateConnectionStatus('connected');
            this.hideError();
            this.system('Cloud connected', null, true);
            
            // เริ่ม sync loop
            this.startEfficientSyncLoop();
            
        } catch (error) {
            console.error('[Console] Connection failed:', error);
            this.handleConnectionFailure(error.message);
        }
    }

    handleConnectionFailure(errorMessage) {
        this.retryCount++;
        this.isCloudConnected = false;
        
        // แสดง error ที่ชัดเจน
        if (errorMessage.includes('401')) {
            this.showError('⚠️ Supabase 401: ตรวจสอบ RLS Policies และ API Key');
            this.system('Error: Supabase authentication failed', null, true);
        } else if (errorMessage.includes('configuration')) {
            this.showError('⚠️ Server configuration error');
        } else {
            this.showError(`⚠️ ${errorMessage}`);
        }
        
        if (this.retryCount >= this.maxRetries) {
            this.updateConnectionStatus('local');
            this.system('Switched to local mode', null, true);
            // ลองใหม่ใน 60 วินาที
            setTimeout(() => this.connectToCloud(), 60000);
        } else {
            const delay = Math.min(1000 * Math.pow(2, this.retryCount), 10000);
            setTimeout(() => this.connectToCloud(), delay);
        }
    }

    // ============================================
    // FIXED: โหลดข้อมูลด้วย Error Handling ที่ดีขึ้น
    // ============================================
    
    async loadInitialLogs() {
        try {
            const logs = await this.fetchLogs({ limit: 100 });
            
            if (logs.length > 0) {
                const existingIds = new Set(this.logs.map(l => l.id));
                const newLogs = logs.filter(l => !existingIds.has(l.id));
                
                if (newLogs.length > 0) {
                    this.logs = [...this.logs, ...newLogs]
                        .sort((a, b) => b.timestamp - a.timestamp);
                    this.logs = this.logs.slice(0, 200);
                    
                    this.loadedTimeRange.newest = Math.max(...logs.map(l => l.timestamp));
                    this.loadedTimeRange.oldest = Math.min(...logs.map(l => l.timestamp));
                    
                    this.refreshDisplay();
                    this.updateStats();
                    this.system(`Loaded ${newLogs.length} logs from cloud`, null, true);
                }
            }
        } catch (error) {
            console.error('[Console] Load initial logs failed:', error);
            throw error; // ส่งต่อให้ connectToCloud จัดการ
        }
    }

    async fetchLogs(params = {}) {
        const { limit = 50, before = null, after = null } = params;
        
        let url = `${this.apiUrl}/logs?session=${this.sessionId}&limit=${limit}`;
        if (before) url += `&before=${before}`;
        if (after) url += `&after=${after}`;
        
        const res = await this.fetchWithTimeout(url, { method: 'GET' }, 10000);
        
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
            console.error('[Console] Fetch logs error:', res.status, errorData);
            throw new Error(errorData.error || `HTTP ${res.status}`);
        }
        
        const data = await res.json();
        
        // รองรับทั้งรูปแบบเก่าและใหม่
        return data.map(log => ({
            id: log.id,
            level: log.level,
            category: log.category,
            message: log.message,
            source: log.source,
            meta: log.meta || {},
            stackTrace: log.stack_trace || log.stackTrace,
            timestamp: log.timestamp || new Date(log.created_at).getTime()
        }));
    }

    // ============================================
    // FIXED: Sync ที่มี Error Handling
    // ============================================
    
    async syncPendingLogs() {
        if (this.pendingLogs.length === 0 || !this.isOnline || this.isSyncing) return;
        
        if (!this.isCloudConnected) {
            await this.connectToCloud();
            if (!this.isCloudConnected) return;
        }
        
        this.isSyncing = true;
        this.setSyncStatus(true, `Syncing ${this.pendingLogs.length}...`);
        
        const batch = this.pendingLogs.splice(0, 50);
        
        try {
            const res = await this.fetchWithTimeout(
                `${this.apiUrl}/logs/batch`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ logs: batch })
                },
                15000
            );
            
            if (res.ok) {
                const result = await res.json();
                this.removeFromLocalBackup(result.saved || batch.length);
                
                if (this.pendingLogs.length > 0) {
                    this.system(`Synced ${result.saved || batch.length}, ${this.pendingLogs.length} remaining`, null, true);
                }
            } else {
                const error = await res.json();
                console.error('[Console] Sync failed:', error);
                
                // ถ้าเป็น 401 ให้หยุด sync และแจ้งเตือน
                if (res.status === 401) {
                    this.isCloudConnected = false;
                    this.showError('⚠️ Sync failed: Supabase 401');
                } else {
                    // คืนค่าเข้า queue ถ้าเป็น error อื่น
                    this.pendingLogs.unshift(...batch);
                }
            }
        } catch (error) {
            console.error('[Console] Sync error:', error);
            this.pendingLogs.unshift(...batch);
            this.isCloudConnected = false;
        } finally {
            this.isSyncing = false;
            this.setSyncStatus(false);
        }
    }

    fetchWithTimeout(url, options, timeoutMs) {
        return new Promise((resolve, reject) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
                reject(new Error('Request timeout'));
            }, timeoutMs);
            
            fetch(url, { ...options, signal: controller.signal })
                .then(resolve)
                .catch(reject)
                .finally(() => clearTimeout(timeoutId));
        });
    }

    // ============================================
    // Local Storage Management
    // ============================================
    
    loadFromLocalStorage() {
        try {
            const savedLogs = localStorage.getItem('fantrove_logs_cache');
            if (savedLogs) {
                const parsed = JSON.parse(savedLogs);
                const recent = parsed.filter(l => Date.now() - l.timestamp < 86400000);
                this.logs = recent;
                this.refreshDisplay();
                this.updateStats();
            }
            
            const backup = localStorage.getItem('fantrove_backup');
            if (backup) {
                const parsed = JSON.parse(backup);
                const recent = parsed.filter(l => Date.now() - l._savedAt < 86400000);
                this.pendingLogs = recent;
                if (recent.length > 0) {
                    this.system(`Restored ${recent.length} pending logs`, null, true);
                }
            }
        } catch (e) {
            console.warn('[Console] Local load failed:', e);
        }
    }

    saveToLocalCache() {
        try {
            const cacheData = this.logs.slice(0, 100);
            localStorage.setItem('fantrove_logs_cache', JSON.stringify(cacheData));
        } catch (e) {}
    }

    saveToLocalBackup(log) {
        try {
            const backup = JSON.parse(localStorage.getItem('fantrove_backup') || '[]');
            backup.push({ ...log, _savedAt: Date.now() });
            if (backup.length > 50) backup.shift();
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

    // ============================================
    // Event Handlers
    // ============================================
    
    setupNetworkListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.updateConnectionStatus('local');
            setTimeout(() => this.connectToCloud(), 1000);
        });
        
        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.isCloudConnected = false;
            this.updateConnectionStatus('offline');
        });
    }

    setupScrollHandler() {
        const container = document.getElementById('console-output');
        let scrollTimeout;
        
        container.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                if (container.scrollTop < 50 && this.hasMoreOldLogs && this.isCloudConnected) {
                    this.loadOlderLogs();
                }
            }, 200);
        });
    }

    async loadOlderLogs() {
        if (!this.loadedTimeRange.oldest) return;
        
        try {
            const logs = await this.fetchLogs({ 
                limit: 30, 
                before: this.loadedTimeRange.oldest 
            });
            
            if (logs.length > 0) {
                this.loadedTimeRange.oldest = Math.min(...logs.map(l => l.timestamp));
                this.mergeLogs(logs, true);
            } else {
                this.hasMoreOldLogs = false;
            }
        } catch (e) {
            console.warn('[Console] Load older logs failed:', e);
        }
    }

    mergeLogs(newLogs, prepend = false) {
        const existingIds = new Set(this.logs.map(l => l.id));
        const uniqueLogs = newLogs.filter(log => !existingIds.has(log.id));
        
        if (uniqueLogs.length === 0) return;
        
        if (prepend) {
            this.logs = [...uniqueLogs, ...this.logs];
        } else {
            this.logs = [...this.logs, ...uniqueLogs];
        }
        
        this.logs = this.logs.slice(0, 200);
        this.refreshDisplay();
        this.updateStats();
        this.saveToLocalCache();
    }

    // ============================================
    // Core Functions
    // ============================================
    
    async addLog(log, saveToCloud = true, skipStorage = false) {
        log.id = log.id || crypto.randomUUID?.() || (Date.now() + Math.random()).toString(36);
        log.timestamp = log.timestamp || Date.now();
        
        const shouldSkipStorage = skipStorage || this.shouldSkipStorage(log);
        
        this.logs.push(log);
        if (this.logs.length > 200) this.logs.shift();
        
        if (this.isCapturing && this.shouldDisplay(log)) {
            this.renderLog(log);
        }
        
        this.updateStats();
        
        if (this.stats[log.category] !== undefined) {
            this.stats[log.category]++;
        }
        
        if (!shouldSkipStorage && saveToCloud && this.isInitialized) {
            this.pendingLogs.push(log);
            this.saveToLocalBackup(log);
            
            // Sync ทันทีถ้าเป็น error
            if (log.level === 'error' && this.isCloudConnected && !this.isSyncing) {
                this.syncPendingLogs();
            }
        }
    }

    shouldSkipStorage(log) {
        if (log.category !== 'system' && log.source !== 'System') return false;
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
        const noise = ['ResizeObserver loop', 'Script error.', 'The operation was aborted'];
        return noise.some(n => event.message?.includes(n));
    }

    isNoisePromise(reason) {
        if (!reason) return true;
        const msg = String(reason.message || reason).toLowerCase();
        return msg.includes('resizeobserver') || msg.includes('abort');
    }

    isNoiseMessage(msg) {
        const noise = ['webpack', 'hot module', 'HMR', '[Vue warn]', '[WDS]', 'ResizeObserver'];
        return noise.some(n => msg.includes(n));
    }

    isUserCode(filename) {
        if (!filename) return true;
        const thirdParty = ['node_modules', 'vendor', 'webpack', 'react-dom'];
        return !thirdParty.some(p => filename.includes(p));
    }

    setupSmartNetworkCapture() {
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            try {
                const response = await originalFetch.apply(window, args);
                if (response.status >= 500) {
                    this.captureError({
                        type: 'http', category: 'network',
                        message: `Server Error ${response.status}`,
                        url: args[0], status: response.status
                    });
                }
                return response;
            } catch (error) {
                if (error.name !== 'AbortError') {
                    this.captureError({
                        type: 'network', category: 'network',
                        message: `Network Failed: ${error.message}`,
                        url: args[0]
                    });
                }
                throw error;
            }
        };
    }

    captureError(errorData) {
        const log = {
            level: 'error',
            message: this.formatErrorMessage(errorData),
            source: errorData.filename || errorData.url || 'System',
            category: errorData.category || 'system',
            stackTrace: errorData.stack,
            meta: { type: errorData.type },
            timestamp: Date.now()
        };
        this.addLog(log);
    }

    formatErrorMessage(data) {
        let msg = `[${data.category?.toUpperCase() || 'ERROR'}] `;
        if (data.filename) {
            msg += `${data.message} (${data.filename.split('/').pop()})`;
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
            level: data.level || 'info',
            message: data.message,
            source: data.source || 'API',
            category: 'api',
            meta: data.meta,
            timestamp: Date.now()
        };
        this.addLog(log, false);
    }

    startEfficientSyncLoop() {
        setInterval(() => {
            if (this.isOnline && this.pendingLogs.length > 0) {
                this.syncPendingLogs();
            }
        }, this.syncInterval);
        
        setInterval(() => {
            if (this.isCloudConnected && !document.hidden) {
                this.checkNewLogsEfficient();
            }
        }, this.realtimeCheckInterval);
        
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.isOnline) {
                setTimeout(() => {
                    this.syncPendingLogs();
                    if (this.isCloudConnected) this.checkNewLogsEfficient();
                }, 1000);
            }
        });
    }

    async checkNewLogsEfficient() {
        const after = this.loadedTimeRange.newest || (Date.now() - 60000);
        
        try {
            const newLogs = await this.fetchLogs({ limit: 10, after });
            
            if (newLogs.length > 0) {
                this.loadedTimeRange.newest = Math.max(...newLogs.map(l => l.timestamp));
                this.mergeLogs(newLogs);
                
                const hasError = newLogs.some(l => l.level === 'error');
                if (hasError) this.showToast(`${newLogs.length} new logs`);
            }
        } catch (e) {
            this.isCloudConnected = false;
        }
    }

    // ============================================
    // UI Methods
    // ============================================
    
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
            this.saveToLocalCache();
        }
    }

    exportLogs() {
        const data = {
            exported: new Date().toISOString(),
            session: this.sessionId,
            count: this.logs.length,
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
            offline: { color: 'var(--accent-yellow)', text: 'Offline', dot: 'offline' },
            error: { color: 'var(--accent-red)', text: 'Connection Error', dot: 'error' }
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
            if (!this.isOnline) status.textContent = `${pending} queued (offline)`;
            else if (!this.isCloudConnected) status.textContent = `${pending} pending (local)`;
            else status.textContent = pending > 0 ? `${pending} syncing...` : 'Synced';
            status.className = 'sync-status';
        }
    }

    showError(message) {
        this.connectionError = message;
        document.getElementById('error-message').textContent = message;
        document.getElementById('error-banner').classList.add('visible');
        
        // Auto hide หลัง 10 วินาที
        setTimeout(() => this.hideError(), 10000);
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

    retryConnection() {
        this.retryCount = 0;
        this.connectToCloud();
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

window.consolePro = new FantroveConsolePro();

window.FantroveConsole = {
    log: (m, meta) => consolePro.log(m, meta),
    info: (m, meta) => consolePro.info(m, meta),
    warn: (m, meta) => consolePro.warn(m, meta),
    error: (m, meta) => consolePro.error(m, meta),
    debug: (m, meta) => consolePro.debug(m, meta),
    success: (m, meta) => consolePro.addLog({ level: 'success', message: m, source: 'API', category: 'api', meta, timestamp: Date.now() })
};
