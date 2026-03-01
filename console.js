/**
 * Fantrove Console Pro - Fixed Startup
 */

class FantroveConsolePro {
    constructor() {
        this.apiUrl = 'https://fantrove-console-api.nontakorn2600.workers.dev';
        this.supabaseUrl = null;
        this.supabaseAnonKey = null;
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
        this.hasShownReady = false;
        this.initStarted = false; // ✅ NEW: ป้องกัน init ซ้ำ
        
        // Realtime
        this.realtimeChannel = null;
        this.isRealtimeConnected = false;
        this.supabaseClient = null;
        
        // Sync settings
        this.lastSyncTime = 0;
        this.syncInterval = 30000;
        this.retryCount = 0;
        this.maxRetries = 3;
        
        this.loadedTimeRange = { oldest: null, newest: null };
        this.hasMoreOldLogs = true;
        this.isLoadingHistory = false;
        
        this.skipStoragePatterns = [
            /^Console ready/i,
            /^Session:/i,
            /^Realtime/i,
            /^Cloud (connected|disconnected)/i,
            /^Loading\.\.\.$/i
        ];
        
        // ✅ FIXED: เรียก init ทันที ไม่รอ
        this.init();
    }

    getOrCreateSession() {
        try {
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
        } catch (e) {
            // ✅ FIXED: fallback ถ้า localStorage มีปัญหา
            return 'sess_' + Date.now().toString(36);
        }
    }

    async init() {
        // ✅ FIXED: ป้องกัน init ซ้ำ
        if (this.initStarted) return;
        this.initStarted = true;
        
        console.log('[Console] Initializing...');
        
        // เรียกทีละอัน ไม่ต้องรอทั้งหมด
        this.setupNetworkListeners();
        this.setupSmartErrorCapture();
        this.setupAPIMessageHandling();
        this.setupScrollHandler();
        
        // โหลดจาก local ก่อน (ไม่บล็อก)
        this.loadFromLocalStorage();
        
        this.isInitialized = true;
        
        // แสดง ready ทันที
        if (!this.hasShownReady) {
            this.system(`Console ready | Session: ${this.sessionId}`, null, true);
            this.hasShownReady = true;
        }
        
        // ✅ FIXED: เชื่อมต่อ cloud แบบไม่บล็อก UI
        if (this.isOnline) {
            // ใช้ setTimeout แยกออกจาก init หลัก
            setTimeout(() => {
                this.connectToCloud().catch(err => {
                    console.error('[Console] Cloud connection failed:', err);
                    this.updateConnectionStatus('local');
                });
            }, 100);
        } else {
            this.updateConnectionStatus('offline');
        }
    }

    // ============================================
    // FIXED: Non-blocking Connection
    // ============================================
    
    async connectToCloud() {
        console.log('[Console] Connecting to cloud...');
        this.updateConnectionStatus('loading');
        
        try {
            // ดึง config
            let config = null;
            try {
                const configRes = await this.fetchWithTimeout(
                    `${this.apiUrl}/config`, 
                    { method: 'GET' }, 
                    5000 // ✅ ลด timeout
                );
                if (configRes && configRes.ok) {
                    config = await configRes.json();
                    this.supabaseUrl = config.supabaseUrl;
                    this.supabaseAnonKey = config.anonKey;
                }
            } catch (e) {
                console.warn('[Console] Config fetch failed:', e);
            }
            
            // Health check
            const healthRes = await this.fetchWithTimeout(
                `${this.apiUrl}/health`, 
                { method: 'GET' }, 
                5000
            );
            
            const responseText = await healthRes.text();
            console.log('[Console] Health response:', responseText.substring(0, 200));
            
            let healthData;
            try {
                healthData = JSON.parse(responseText);
            } catch (e) {
                throw new Error('Invalid JSON');
            }
            
            if (healthData.status !== 'healthy') {
                throw new Error(healthData.message || 'Health check failed');
            }
            
            if (!this.supabaseUrl && healthData.supabaseUrl) {
                this.supabaseUrl = healthData.supabaseUrl;
            }
            
            // ✅ FIXED: โหลด history แบบไม่บล็อก
            this.loadFullHistory().catch(e => {
                console.warn('[Console] History load failed:', e);
            });
            
            this.isCloudConnected = true;
            this.retryCount = 0;
            this.updateConnectionStatus('connected');
            this.hideError();
            
            // ✅ FIXED: เชื่อมต่อ realtime แยก thread
            if (this.supabaseUrl && this.supabaseAnonKey) {
                setTimeout(() => this.connectRealtime(), 100);
            }
            
            // เริ่ม sync loop
            this.startEfficientSyncLoop();
            
        } catch (error) {
            console.error('[Console] Connection failed:', error);
            this.handleConnectionFailure(String(error));
        }
    }

    async loadFullHistory() {
        try {
            const result = await this.fetchLogs({ 
                limit: 100, // ✅ ลดจาก 200 เพื่อความเร็ว
                fromStart: true 
            });
            
            if (result.logs.length > 0) {
                const existingIds = new Set(this.logs.map(l => l.id));
                const newLogs = result.logs.filter(l => !existingIds.has(l.id));
                
                if (newLogs.length > 0) {
                    this.logs = [...newLogs, ...this.logs]
                        .sort((a, b) => b.timestamp - a.timestamp);
                    
                    this.logs = this.logs.slice(0, 300); // ✅ ลดจาก 500
                    
                    this.loadedTimeRange.newest = Math.max(...this.logs.map(l => l.timestamp));
                    this.loadedTimeRange.oldest = Math.min(...this.logs.map(l => l.timestamp));
                    this.hasMoreOldLogs = result.meta.has_more;
                    
                    this.refreshDisplay();
                    this.updateStats();
                }
            }
        } catch (error) {
            console.error('[Console] Load history failed:', error);
            throw error;
        }
    }

    // ============================================
    // FIXED: Realtime with Error Handling
    // ============================================
    
    async connectRealtime() {
        try {
            if (!window.supabase) {
                await this.loadSupabaseClient();
            }
            
            if (!this.supabaseUrl || !this.isValidUrl(this.supabaseUrl)) {
                console.warn('[Realtime] Invalid URL:', this.supabaseUrl);
                return; // ✅ ไม่ throw ให้ค้าง
            }
            
            let url = this.supabaseUrl;
            if (!url.startsWith('http')) {
                url = 'https://' + url;
            }
            url = url.replace(/\/$/, '');
            
            console.log('[Realtime] Connecting to:', url);
            
            this.supabaseClient = window.supabase.createClient(
                url, 
                this.supabaseAnonKey,
                {
                    realtime: {
                        params: { eventsPerSecond: 10 }
                    },
                    db: { schema: 'public' }
                }
            );

            const channelName = `console_logs:${this.sessionId}`;
            
            this.realtimeChannel = this.supabaseClient
                .channel(channelName)
                .on(
                    'postgres_changes',
                    {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'console_logs',
                        filter: `session_id=eq.${this.sessionId}`
                    },
                    (payload) => {
                        this.handleRealtimeInsert(payload.new);
                    }
                )
                .subscribe((status) => {
                    console.log('[Realtime] Status:', status);
                    if (status === 'SUBSCRIBED') {
                        this.isRealtimeConnected = true;
                        this.updateConnectionStatus('connected');
                    } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                        this.isRealtimeConnected = false;
                    }
                });

        } catch (error) {
            console.error('[Realtime] Failed:', error);
            this.isRealtimeConnected = false;
            // ✅ ไม่ rethrow ให้ค้างระบบ
        }
    }

    isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    async loadSupabaseClient() {
        return new Promise((resolve, reject) => {
            if (window.supabase) {
                resolve();
                return;
            }
            
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load'));
            document.head.appendChild(script);
        });
    }

    handleRealtimeInsert(data) {
        try {
            const log = {
                id: data.id,
                level: data.level,
                category: data.category,
                message: data.message,
                source: data.source,
                meta: data.meta || {},
                stackTrace: data.stack_trace,
                timestamp: new Date(data.created_at).getTime()
            };

            if (this.logs.some(l => l.id === log.id)) return;

            this.logs.unshift(log);
            if (this.logs.length > 300) this.logs.pop();
            
            this.loadedTimeRange.newest = Math.max(this.loadedTimeRange.newest || 0, log.timestamp);
            
            if (this.shouldDisplay(log)) {
                this.renderLog(log, true);
            }
            
            this.updateStats();
        } catch (e) {
            console.error('[Realtime] Insert failed:', e);
        }
    }

    handleConnectionFailure(errorMessage) {
        this.retryCount++;
        this.isCloudConnected = false;
        this.isRealtimeConnected = false;
        
        if (this.retryCount >= this.maxRetries) {
            this.updateConnectionStatus('local');
            setTimeout(() => this.connectToCloud(), 60000);
        } else {
            const delay = Math.min(1000 * Math.pow(2, this.retryCount), 10000);
            setTimeout(() => this.connectToCloud(), delay);
        }
    }

    // ============================================
    // API Methods
    // ============================================
    
    async fetchLogs(params = {}) {
        const { limit = 50, before = null, after = null, fromStart = false } = params;
        
        let url = `${this.apiUrl}/logs?session=${this.sessionId}&limit=${limit}`;
        if (before) url += `&before=${before}`;
        if (after) url += `&after=${after}`;
        if (fromStart) url += `&from_start=true`;
        
        const res = await this.fetchWithTimeout(url, { method: 'GET' }, 10000);
        
        const responseText = await res.text();
        
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            throw new Error('Invalid JSON');
        }
        
        if (data.logs && Array.isArray(data.logs)) {
            return {
                logs: data.logs.map(log => this.normalizeLog(log)),
                meta: data.meta || { has_more: false }
            };
        } else if (Array.isArray(data)) {
            return {
                logs: data.map(log => this.normalizeLog(log)),
                meta: { has_more: data.length === limit }
            };
        }
        
        return { logs: [], meta: { has_more: false } };
    }

    normalizeLog(log) {
        return {
            id: log.id,
            level: log.level,
            category: log.category,
            message: log.message,
            source: log.source,
            meta: log.meta || {},
            stackTrace: log.stack_trace || log.stackTrace,
            timestamp: log.timestamp || new Date(log.created_at).getTime()
        };
    }

    fetchWithTimeout(url, options, timeoutMs) {
        return new Promise((resolve, reject) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
                reject(new Error('Timeout'));
            }, timeoutMs);
            
            fetch(url, { ...options, signal: controller.signal })
                .then(resolve)
                .catch(reject)
                .finally(() => clearTimeout(timeoutId));
        });
    }

    async loadOlderLogs() {
        if (this.isLoadingHistory || !this.hasMoreOldLogs || !this.isCloudConnected) return;
        
        this.isLoadingHistory = true;
        
        try {
            const result = await this.fetchLogs({ 
                limit: 50, 
                before: this.loadedTimeRange.oldest 
            });
            
            if (result.logs.length > 0) {
                this.loadedTimeRange.oldest = Math.min(...result.logs.map(l => l.timestamp));
                this.hasMoreOldLogs = result.meta.has_more;
                this.mergeLogs(result.logs, true);
            } else {
                this.hasMoreOldLogs = false;
            }
        } catch (e) {
            console.warn('[Console] Load older failed:', e);
        } finally {
            this.isLoadingHistory = false;
        }
    }

    mergeLogs(newLogs, prepend = false) {
        const existingIds = new Set(this.logs.map(l => l.id));
        const uniqueLogs = newLogs.filter(log => !existingIds.has(log.id));
        
        if (uniqueLogs.length === 0) return;
        
        if (prepend) {
            const container = document.getElementById('console-output');
            const oldHeight = container.scrollHeight;
            const oldScroll = container.scrollTop;
            
            this.logs = [...uniqueLogs, ...this.logs];
            
            requestAnimationFrame(() => {
                const newHeight = container.scrollHeight;
                container.scrollTop = oldScroll + (newHeight - oldHeight);
            });
        } else {
            this.logs = [...this.logs, ...uniqueLogs];
        }
        
        this.logs = this.logs.slice(0, 300);
        this.refreshDisplay();
        this.updateStats();
        this.saveToLocalCache();
    }

    // ============================================
    // Local Storage
    // ============================================
    
    loadFromLocalStorage() {
        try {
            const savedLogs = localStorage.getItem(`fantrove_logs_${this.sessionId}`);
            if (savedLogs) {
                const parsed = JSON.parse(savedLogs);
                const recent = parsed.filter(l => Date.now() - l.timestamp < 86400000 * 7);
                this.logs = recent;
                this.refreshDisplay();
                this.updateStats();
            }
            
            const backup = localStorage.getItem(`fantrove_backup_${this.sessionId}`);
            if (backup) {
                const parsed = JSON.parse(backup);
                const recent = parsed.filter(l => Date.now() - l._savedAt < 86400000);
                this.pendingLogs = recent;
            }
        } catch (e) {
            console.warn('[Console] Local load failed:', e);
        }
    }

    saveToLocalCache() {
        try {
            const cacheData = this.logs.slice(0, 200);
            localStorage.setItem(`fantrove_logs_${this.sessionId}`, JSON.stringify(cacheData));
        } catch (e) {}
    }

    saveToLocalBackup(log) {
        try {
            const logWithSession = { ...log, session_id: this.sessionId };
            const backup = JSON.parse(localStorage.getItem(`fantrove_backup_${this.sessionId}`) || '[]');
            backup.push({ ...logWithSession, _savedAt: Date.now() });
            if (backup.length > 100) backup.shift();
            localStorage.setItem(`fantrove_backup_${this.sessionId}`, JSON.stringify(backup));
        } catch (e) {}
    }

    removeFromLocalBackup(count) {
        try {
            const backup = JSON.parse(localStorage.getItem(`fantrove_backup_${this.sessionId}`) || '[]');
            const remaining = backup.slice(count);
            localStorage.setItem(`fantrove_backup_${this.sessionId}`, JSON.stringify(remaining));
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
            this.isRealtimeConnected = false;
            this.updateConnectionStatus('offline');
        });
    }

    setupScrollHandler() {
        const container = document.getElementById('console-output');
        if (!container) return;
        
        let scrollTimeout;
        container.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                if (container.scrollTop < 100 && this.hasMoreOldLogs && this.isCloudConnected) {
                    this.loadOlderLogs();
                }
            }, 200);
        });
    }

    // ============================================
    // Core Functions
    // ============================================
    
    async addLog(log, saveToCloud = true, skipStorage = false) {
        try {
            log.id = log.id || crypto.randomUUID?.() || (Date.now() + Math.random()).toString(36);
            log.timestamp = log.timestamp || Date.now();
            log.session_id = this.sessionId;
            
            const shouldSkipStorage = skipStorage || this.shouldSkipStorage(log);
            
            this.logs.unshift(log);
            if (this.logs.length > 300) this.logs.pop();
            
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
                
                if ((log.level === 'error' || !this.isRealtimeConnected) && this.isCloudConnected && !this.isSyncing) {
                    this.syncPendingLogs();
                }
            }
        } catch (e) {
            console.error('[Console] Add log failed:', e);
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
        if (!output) return;
        
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
                .filter(([k, v]) => v !== undefined && v !== null && k !== 'session_id')
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

        output.insertBefore(entry, output.firstChild);
        
        while (output.children.length > 200) {
            output.removeChild(output.lastChild);
        }
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
            if (this.isOnline && this.pendingLogs.length > 0 && !this.isRealtimeConnected) {
                this.syncPendingLogs();
            }
        }, this.syncInterval);
        
        setInterval(() => {
            if (this.isCloudConnected && !this.isRealtimeConnected && !document.hidden) {
                this.checkNewLogsEfficient();
            }
        }, 15000);
        
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.isOnline) {
                setTimeout(() => {
                    this.syncPendingLogs();
                    if (this.isCloudConnected && !this.isRealtimeConnected) {
                        this.checkNewLogsEfficient();
                    }
                }, 1000);
            }
        });
    }

    async syncPendingLogs() {
        if (this.pendingLogs.length === 0 || !this.isOnline || this.isSyncing) return;
        
        if (!this.isCloudConnected) {
            await this.connectToCloud();
            if (!this.isCloudConnected) return;
        }
        
        this.isSyncing = true;
        
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
                this.removeFromLocalBackup(batch.length);
            } else {
                this.pendingLogs.unshift(...batch);
            }
        } catch (error) {
            this.pendingLogs.unshift(...batch);
            this.isCloudConnected = false;
        } finally {
            this.isSyncing = false;
        }
    }

    async checkNewLogsEfficient() {
        const after = this.loadedTimeRange.newest || (Date.now() - 60000);
        
        try {
            const result = await this.fetchLogs({ limit: 10, after });
            
            if (result.logs.length > 0) {
                this.loadedTimeRange.newest = Math.max(...result.logs.map(l => l.timestamp));
                this.mergeLogs(result.logs);
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
        if (!output) return;
        
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
        if (!input) return;
        
        const code = input.value.trim();
        if (code) {
            this.system('> ' + code);
            try {
                const result = eval(code);
                if (result !== undefined) {
                    this.system('< ' + this.stringify(result));
                }
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
        if (!btn) return;
        
        if (this.isCapturing) {
            btn.innerHTML = '<span class="btn-icon">⏸</span><span>Pause</span>';
        } else {
            btn.innerHTML = '<span class="btn-icon">▶</span><span>Resume</span>';
        }
    }

    async clear() {
        if (confirm('Clear all logs?')) {
            this.logs = [];
            this.stats = { code: 0, network: 0, system: 0, api: 0 };
            this.refreshDisplay();
            this.updateStats();
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
    }

    updateStats() {
        const counts = { all: this.logs.length, error: 0, warn: 0, info: 0, log: 0, debug: 0 };
        this.logs.forEach(log => { if (counts[log.level] !== undefined) counts[log.level]++; });
        
        Object.keys(counts).forEach(key => {
            const el = document.getElementById(`count-${key}`);
            if (el) el.textContent = counts[key];
        });

        const statTotal = document.getElementById('stat-total');
        const statCode = document.getElementById('stat-code');
        const statNetwork = document.getElementById('stat-network');
        
        if (statTotal) statTotal.textContent = counts.all;
        if (statCode) statCode.textContent = this.stats.code;
        if (statNetwork) statNetwork.textContent = this.stats.network;
    }

    updateConnectionStatus(status) {
        const dot = document.getElementById('status-dot');
        const text = document.getElementById('status-text');
        
        if (!dot || !text) return;
        
        const styles = {
            loading: { color: 'var(--accent-yellow)', text: '...', dot: '' },
            connected: { color: 'var(--accent-green)', text: this.isRealtimeConnected ? 'Live' : 'Cloud', dot: '' },
            local: { color: 'var(--accent-blue)', text: 'Local', dot: 'local' },
            offline: { color: 'var(--accent-yellow)', text: 'Offline', dot: 'offline' },
            error: { color: 'var(--accent-red)', text: 'Error', dot: 'error' }
        };
        
        const style = styles[status] || styles.local;
        dot.className = 'status-dot ' + style.dot;
        text.textContent = style.text;
        text.style.color = style.color;
    }

    setSyncStatus(syncing, message = '') {
        const status = document.getElementById('sync-status');
        if (!status) return;
        
        if (syncing) {
            status.textContent = message || '...';
            status.className = 'sync-status syncing';
        } else {
            const pending = this.pendingLogs.length;
            if (!this.isOnline) status.textContent = `${pending} queued`;
            else if (!this.isCloudConnected) status.textContent = `${pending} pending`;
            else if (this.isRealtimeConnected) status.textContent = pending > 0 ? `${pending} sync` : 'Live';
            else status.textContent = pending > 0 ? `${pending} sync` : 'OK';
            status.className = 'sync-status';
        }
    }

    showError(message) {
        this.connectionError = message;
        const errorMessage = document.getElementById('error-message');
        const errorBanner = document.getElementById('error-banner');
        
        if (errorMessage) errorMessage.textContent = message;
        if (errorBanner) errorBanner.classList.add('visible');
        
        setTimeout(() => this.hideError(), 10000);
    }

    hideError() {
        this.connectionError = null;
        const errorBanner = document.getElementById('error-banner');
        if (errorBanner) errorBanner.classList.remove('visible');
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

// ✅ FIXED: สร้าง instance หลัง DOM พร้อม
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.consolePro = new FantroveConsolePro();
    });
} else {
    window.consolePro = new FantroveConsolePro();
}

window.FantroveConsole = {
    log: (m, meta) => window.consolePro && window.consolePro.log(m, meta),
    info: (m, meta) => window.consolePro && window.consolePro.info(m, meta),
    warn: (m, meta) => window.consolePro && window.consolePro.warn(m, meta),
    error: (m, meta) => window.consolePro && window.consolePro.error(m, meta),
    debug: (m, meta) => window.consolePro && window.consolePro.debug(m, meta),
    success: (m, meta) => window.consolePro && window.consolePro.addLog({ level: 'success', message: m, source: 'API', category: 'api', meta, timestamp: Date.now() })
};
