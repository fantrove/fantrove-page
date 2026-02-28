/**
 * Fantrove Console Pro - Supabase Realtime Edition
 * Enhanced: Better Error Handling, Auto-Fallback, Debug Mode
 */

class FantroveConsolePro {
    constructor() {
        // ตรวจสอบค่า config ก่อน
        this.SUPABASE_URL = 'https://your-project.supabase.co'; // ← แก้ไขตรงนี้
        this.SUPABASE_ANON_KEY = 'your-anon-key'; // ← แก้ไขตรงนี้
        
        // Debug mode - เปิดเพื่อดู log การทำงาน
        this.DEBUG = true;
        
        this.supabase = null;
        this.realtimeChannel = null;
        
        this.logs = [];
        this.pendingLogs = [];
        this.activeFilters = new Set(['error', 'warn', 'info', 'log', 'debug']);
        this.searchQuery = '';
        this.isCapturing = true;
        this.sessionId = this.getOrCreateSession();
        this.isOnline = navigator.onLine;
        this.isConnected = false;
        this.connectionError = null;
        this.stats = { code: 0, network: 0, system: 0, api: 0 };
        
        this.isLoading = false;
        this.hasMoreHistory = true;
        this.retryCount = 0;
        this.maxRetries = 3;
        
        this.skipStoragePatterns = [
            /^Console ready/i, /^Loaded \d+ logs/i, /^Realtime/i,
            /^Connection/i, /^Failed to connect/i
        ];
        
        this.init();
    }

    // Debug logger
    debugLog(...args) {
        if (this.DEBUG) {
            console.log('[Console Debug]', ...args);
        }
    }

    getOrCreateSession() {
        const urlParams = new URLSearchParams(window.location.search);
        const fromUrl = urlParams.get('session');
        if (fromUrl) {
            localStorage.setItem('fantrove_session_id', fromUrl);
            return fromUrl;
        }
        let s = localStorage.getItem('fantrove_session_id');
        if (!s) {
            s = 'sess_' + Date.now().toString(36).substr(-8) + '_' + Math.random().toString(36).substr(2, 4);
            localStorage.setItem('fantrove_session_id', s);
        }
        return s;
    }

    async init() {
        this.debugLog('Initializing... Session:', this.sessionId);
        
        this.setupErrorCapture();
        this.setupNetworkListeners();
        
        // โหลดจาก cache ก่อน (ทันที)
        this.loadFromCache();
        
        // ตรวจสอบ config
        if (!this.validateConfig()) {
            this.error('Invalid Supabase configuration. Check SUPABASE_URL and SUPABASE_ANON_KEY');
            this.updateStatus('error', 'Config Error');
            return;
        }
        
        // เชื่อมต่อ Supabase ถ้า online
        if (this.isOnline) {
            await this.connectWithRetry();
        } else {
            this.updateStatus('offline', '✕ Offline');
            this.system('Working in offline mode', null, true);
        }
    }

    validateConfig() {
        const isValid = (
            this.SUPABASE_URL && 
            this.SUPABASE_URL.includes('supabase.co') &&
            this.SUPABASE_ANON_KEY &&
            this.SUPABASE_ANON_KEY.length > 20
        );
        
        this.debugLog('Config valid:', isValid);
        return isValid;
    }

    // ============================================
    // CONNECT: พร้อม Retry และ Fallback
    // ============================================
    
    async connectWithRetry() {
        while (this.retryCount < this.maxRetries) {
            try {
                await this.connectSupabase();
                return; // สำเร็จ
            } catch (error) {
                this.retryCount++;
                this.debugLog(`Connection attempt ${this.retryCount} failed:`, error.message);
                
                if (this.retryCount < this.maxRetries) {
                    const delay = 1000 * Math.pow(2, this.retryCount);
                    this.updateStatus('loading', `Retrying in ${delay/1000}s...`);
                    await this.sleep(delay);
                }
            }
        }
        
        // ถ้าไม่สำเร็จหลัง retry ทั้งหมด
        this.handleConnectionFailure();
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    handleConnectionFailure() {
        this.debugLog('All connection attempts failed, switching to local mode');
        this.isConnected = false;
        this.updateStatus('local', '○ Local Mode (Limited)');
        this.showError(
            'Cannot connect to database. Working in local mode. ' +
            'Errors will be saved locally and synced when connection returns.'
        );
        
        // ยังคงทำงานได้ใน local mode
        this.system('Local mode active - logs saved to browser', null, true);
    }

    async connectSupabase() {
        this.updateStatus('loading', 'Connecting...');
        this.debugLog('Creating Supabase client...');
        
        try {
            // สร้าง client พร้อม timeout
            const clientPromise = this.createClient();
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Connection timeout')), 10000)
            );
            
            this.supabase = await Promise.race([clientPromise, timeoutPromise]);
            
            this.debugLog('Client created, testing connection...');
            
            // Test connection ด้วย simple query
            const { data: testData, error: testError } = await this.supabase
                .from('console_logs')
                .select('count', { count: 'exact', head: true })
                .eq('session_id', this.sessionId)
                .limit(1);
            
            if (testError) {
                throw new Error(`Database test failed: ${testError.message}`);
            }
            
            this.debugLog('Connection test passed');
            
            // ดึงข้อมูลครั้งแรก
            await this.loadInitialLogs();
            
            // เปิด Realtime
            this.subscribeToRealtime();
            
            this.isConnected = true;
            this.retryCount = 0;
            this.hideError();
            this.updateStatus('connected', '● Real-time');
            this.system('Connected to cloud database', null, true);
            
            // Sync pending logs
            this.syncPendingLogs();
            
        } catch (error) {
            this.debugLog('Connection error:', error);
            throw error; // ส่งต่อให้ retry logic จัดการ
        }
    }

    async createClient() {
        // ใช้ global supabase จาก CDN
        if (typeof supabase === 'undefined' || !supabase.createClient) {
            throw new Error('Supabase library not loaded');
        }
        
        return supabase.createClient(this.SUPABASE_URL, this.SUPABASE_ANON_KEY, {
            auth: {
                autoRefreshToken: true,
                persistSession: true
            },
            realtime: {
                params: {
                    eventsPerSecond: 10
                }
            },
            db: {
                schema: 'public'
            }
        });
    }

    // ============================================
    // LOAD: ดึงข้อมูลครั้งแรก
    // ============================================
    
    async loadInitialLogs(limit = 100) {
        this.isLoading = true;
        this.updateStatus('loading', 'Loading history...');
        this.debugLog('Loading initial logs, limit:', limit);
        
        try {
            // ใช้ simple query แทน complex
            const { data, error } = await this.supabase
                .from('console_logs')
                .select('id, level, category, message, source, meta, stack_trace, created_at')
                .eq('session_id', this.sessionId)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) {
                throw new Error(`Query failed: ${error.message} (code: ${error.code})`);
            }

            this.debugLog('Loaded', data?.length || 0, 'logs from database');

            if (data && data.length > 0) {
                const formatted = data.map(log => this.formatLogFromDB(log));
                this.mergeLogs(formatted, false);
                this.system(`Loaded ${data.length} historical logs`, null, true);
                this.hasMoreHistory = data.length === limit;
            } else {
                this.hasMoreHistory = false;
                this.system('No previous logs found', null, true);
            }
            
        } catch (error) {
            this.debugLog('Load failed:', error);
            // ไม่ throw ต่อ แค่ log ไว้และทำงานต่อ
            this.error(`Failed to load history: ${error.message}`);
        } finally {
            this.isLoading = false;
        }
    }

    // ============================================
    // REALTIME: Subscribe แบบ Robust
    // ============================================
    
    subscribeToRealtime() {
        this.debugLog('Setting up realtime subscription...');
        
        try {
            this.realtimeChannel = this.supabase
                .channel(`console_logs:${this.sessionId}`, {
                    config: {
                        broadcast: { self: false },
                        presence: { key: '' }
                    }
                })
                .on(
                    'postgres_changes',
                    {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'console_logs',
                        filter: `session_id=eq.${this.sessionId}`
                    },
                    (payload) => {
                        this.debugLog('Realtime event received:', payload.eventType);
                        
                        if (payload.eventType === 'INSERT' && payload.new) {
                            const log = this.formatLogFromDB(payload.new);
                            
                            // ตรวจสอบซ้ำ
                            if (!this.logs.find(l => l.id === log.id)) {
                                this.addRealtimeLog(log);
                            }
                        }
                    }
                )
                .subscribe((status, err) => {
                    this.debugLog('Realtime status:', status, err || '');
                    
                    if (status === 'SUBSCRIBED') {
                        this.debugLog('Successfully subscribed to realtime');
                    } else if (status === 'CLOSED') {
                        this.handleRealtimeDisconnect('closed');
                    } else if (status === 'CHANNEL_ERROR') {
                        this.handleRealtimeDisconnect('error', err);
                    }
                });

        } catch (error) {
            this.debugLog('Realtime setup failed:', error);
            this.warn('Realtime updates unavailable - using manual refresh', null, true);
        }
    }

    handleRealtimeDisconnect(reason, error) {
        this.debugLog('Realtime disconnected:', reason, error);
        
        if (this.isConnected) {
            this.isConnected = false;
            this.updateStatus('local', '○ Local Mode (Sync paused)');
            this.warn('Real-time connection lost. Retrying...', null, true);
            
            // Retry realtime ใน 5 วินาที
            setTimeout(() => {
                if (this.isOnline && this.supabase) {
                    this.debugLog('Attempting realtime reconnect...');
                    this.subscribeToRealtime();
                }
            }, 5000);
        }
    }

    addRealtimeLog(log) {
        this.logs.push(log);
        if (this.logs.length > 500) this.logs.shift();
        
        if (this.isCapturing && this.shouldDisplay(log)) {
            this.renderLog(log, true);
        }
        
        this.updateStats();
        
        if (log.level === 'error') {
            this.showToast(`⚠️ New error from ${log.source}`);
        }
    }

    // ============================================
    // SAVE: บันทึกลง Supabase
    // ============================================
    
    async saveLog(log) {
        if (!this.supabase || !this.isConnected) {
            this.debugLog('Offline, queueing log');
            this.pendingLogs.push(log);
            this.saveToLocalBackup(log);
            return;
        }

        try {
            const payload = {
                session_id: this.sessionId,
                level: log.level,
                category: log.category || 'system',
                message: log.message,
                source: log.source || 'Unknown',
                meta: log.meta || {},
                stack_trace: log.stackTrace || null,
                user_agent: navigator.userAgent?.substring(0, 200),
                url: location.href?.substring(0, 500),
                created_at: new Date(log.timestamp).toISOString(),
                expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            };

            this.debugLog('Saving log:', payload.level, payload.message.substring(0, 50));

            const { error } = await this.supabase
                .from('console_logs')
                .insert(payload);

            if (error) {
                throw error;
            }
            
            this.debugLog('Log saved successfully');
            
        } catch (error) {
            this.debugLog('Save failed, queueing:', error.message);
            this.pendingLogs.push(log);
            this.saveToLocalBackup(log);
            
            // ถ้า error เป็น connection ปัญหา ให้ mark ว่าไม่ได้เชื่อมต่อ
            if (error.message?.includes('fetch') || error.message?.includes('network')) {
                this.isConnected = false;
                this.updateStatus('local', '○ Local Mode');
            }
        }
    }

    async syncPendingLogs() {
        if (this.pendingLogs.length === 0 || !this.supabase) {
            return;
        }
        
        this.debugLog('Syncing', this.pendingLogs.length, 'pending logs');
        
        const batch = this.pendingLogs.splice(0, 20); // จำกัด batch ไม่ให้ใหญ่เกิน
        let success = 0;
        
        for (const log of batch) {
            try {
                await this.saveLog(log);
                success++;
            } catch (e) {
                // ถ้าล้มเหลว คืนค่าเข้า queue
                this.pendingLogs.unshift(log);
                break; // หยุดตรงนี้ รอรอบหน้า
            }
        }
        
        this.debugLog('Sync complete:', success, '/', batch.length);
        
        if (this.pendingLogs.length > 0) {
            // ลองอีกครั้งใน 10 วินาที
            setTimeout(() => this.syncPendingLogs(), 10000);
        }
    }

    // ============================================
    // Helper Functions
    // ============================================
    
    formatLogFromDB(dbLog) {
        return {
            id: dbLog.id,
            level: dbLog.level,
            category: dbLog.category,
            message: dbLog.message,
            source: dbLog.source,
            meta: typeof dbLog.meta === 'string' ? JSON.parse(dbLog.meta) : (dbLog.meta || {}),
            stackTrace: dbLog.stack_trace,
            timestamp: new Date(dbLog.created_at).getTime(),
            _fromDB: true
        };
    }

    mergeLogs(newLogs, prepend = false) {
        const existingIds = new Set(this.logs.map(l => l.id));
        const unique = newLogs.filter(l => !existingIds.has(l.id));
        
        if (unique.length === 0) return;

        unique.forEach(log => {
            log._fromDB = true;
            if (prepend) {
                this.logs.unshift(log);
            } else {
                this.logs.push(log);
            }
        });

        if (this.logs.length > 500) {
            this.logs = this.logs.slice(-500);
        }
        
        this.refreshDisplay();
        this.updateStats();
        this.saveToCache();
    }

    // ============================================
    // Local Storage
    // ============================================
    
    loadFromCache() {
        try {
            const cache = localStorage.getItem('fantrove_logs_cache');
            if (cache) {
                const parsed = JSON.parse(cache);
                const recent = parsed.filter(l => Date.now() - l.timestamp < 86400000);
                if (recent.length > 0) {
                    this.logs = recent;
                    this.refreshDisplay();
                    this.updateStats();
                    this.debugLog('Loaded', recent.length, 'logs from cache');
                }
            }
            
            const backup = localStorage.getItem('fantrove_backup');
            if (backup) {
                const parsed = JSON.parse(backup);
                const recent = parsed.filter(l => Date.now() - l._savedAt < 86400000);
                this.pendingLogs = recent;
                if (recent.length > 0) {
                    this.debugLog('Restored', recent.length, 'pending logs');
                }
            }
        } catch (e) {
            this.debugLog('Cache load failed:', e);
        }
    }

    saveToCache() {
        try {
            localStorage.setItem('fantrove_logs_cache', JSON.stringify(this.logs.slice(-100)));
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

    // ============================================
    // Error Capture & Network
    // ============================================
    
    setupErrorCapture() {
        window.addEventListener('error', (e) => {
            if (this.isNoise(e.message)) return;
            this.captureError({
                type: 'runtime',
                message: e.message,
                filename: e.filename,
                lineno: e.lineno,
                stack: e.error?.stack
            });
        });

        window.addEventListener('unhandledrejection', (e) => {
            this.captureError({
                type: 'promise',
                message: e.reason?.message || String(e.reason),
                stack: e.reason?.stack
            });
        });

        const orig = console.error;
        console.error = (...args) => {
            orig.apply(console, args);
            const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
            if (!this.isNoise(msg)) {
                this.error(msg);
            }
        };
    }

    captureError(data) {
        this.addLog({
            level: 'error',
            category: data.type === 'network' ? 'network' : 'code',
            message: data.message,
            source: data.filename || 'Error',
            stackTrace: data.stack,
            meta: { line: data.lineno, type: data.type }
        }, true);
    }

    isNoise(msg) {
        return !msg || ['ResizeObserver', 'Script error.', 'The operation was aborted', 'Supabase library not loaded'].some(n => msg.includes(n));
    }

    setupNetworkListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.debugLog('Network online');
            if (!this.isConnected && this.retryCount < this.maxRetries) {
                this.retryCount = 0; // reset retry
                this.connectWithRetry();
            }
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.isConnected = false;
            this.updateStatus('offline', '✕ Offline');
            this.debugLog('Network offline');
            
            if (this.realtimeChannel) {
                this.supabase?.removeChannel(this.realtimeChannel);
                this.realtimeChannel = null;
            }
        });
    }

    // ============================================
    // UI Methods
    // ============================================
    
    renderLog(log, animate = true) {
        const output = document.getElementById('console-output');
        const empty = output.querySelector('.empty-state');
        if (empty) empty.remove();

        const entry = document.createElement('div');
        entry.className = `log-entry ${log.level}`;
        if (!animate) entry.style.animation = 'none';
        
        const time = new Date(log.timestamp).toLocaleTimeString('en-GB', {
            hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
        });

        const cloudIcon = log._fromDB ? '☁️ ' : '';
        
        let metaHtml = '';
        if (log.meta && Object.keys(log.meta).length > 0) {
            const metaStr = Object.entries(log.meta)
                .map(([k, v]) => `${k}: ${v}`)
                .join(', ');
            metaHtml = `<div class="meta-data">${this.escapeHtml(metaStr)}</div>`;
        }

        entry.innerHTML = `
            <div class="log-header">
                <span class="log-time">${cloudIcon}${time}</span>
                <span class="log-level-badge ${log.level}">${log.level}</span>
                <span class="log-category ${log.category}">${log.category}</span>
                <span class="log-source">${log.source}</span>
            </div>
            <div class="log-content">${this.escapeHtml(log.message)}</div>
            ${metaHtml}
            ${log.stackTrace ? `<div class="stack-trace">${this.escapeHtml(log.stackTrace)}</div>` : ''}
        `;

        output.appendChild(entry);
        
        const isBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 100;
        if (isBottom) output.scrollTop = output.scrollHeight;
    }

    escapeHtml(text) {
        if (typeof text !== 'string') return String(text);
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    refreshDisplay() {
        const output = document.getElementById('console-output');
        output.innerHTML = '';
        const toShow = this.logs.filter(l => this.shouldDisplay(l));
        toShow.forEach(l => this.renderLog(l, false));
    }

    shouldDisplay(log) {
        if (!this.activeFilters.has(log.level)) return false;
        if (!this.searchQuery) return true;
        const q = this.searchQuery.toLowerCase();
        return (log.message || '').toLowerCase().includes(q) ||
               (log.source || '').toLowerCase().includes(q);
    }

    setFilter(level) {
        if (level === 'all') {
            const all = this.activeFilters.size === 5;
            document.querySelectorAll('.filter-btn[data-level]').forEach(btn => {
                if (all) {
                    this.activeFilters.clear();
                    btn.classList.remove('active');
                } else {
                    ['error', 'warn', 'info', 'log', 'debug'].forEach(l => this.activeFilters.add(l));
                    btn.classList.add('active');
                }
            });
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

    updateStats() {
        const counts = { all: this.logs.length, error: 0, warn: 0, info: 0, log: 0, debug: 0 };
        this.logs.forEach(l => counts[l.level] = (counts[l.level] || 0) + 1);
        
        Object.keys(counts).forEach(k => {
            const el = document.getElementById(`count-${k}`);
            if (el) el.textContent = counts[k];
        });
        
        document.getElementById('stat-total').textContent = counts.all;
        document.getElementById('stat-code').textContent = this.stats.code;
        document.getElementById('stat-network').textContent = this.stats.network;
    }

    updateStatus(type, text) {
        const dot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');
        
        const colors = {
            connected: '#238636',
            loading: '#d29922',
            local: '#58a6ff',
            offline: '#da3633',
            error: '#f85149'
        };
        
        dot.style.background = colors[type] || colors.local;
        dot.className = 'status-dot ' + (type === 'loading' ? '' : type);
        statusText.textContent = text;
        statusText.style.color = colors[type] || colors.local;
    }

    showToast(msg) {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    showError(msg) {
        this.connectionError = msg;
        document.getElementById('error-message').textContent = msg;
        document.getElementById('error-banner').classList.add('visible');
    }

    hideError() {
        this.connectionError = null;
        document.getElementById('error-banner').classList.remove('visible');
    }

    shouldSkipStorage(log) {
        if (log.category !== 'system') return false;
        return this.skipStoragePatterns.some(p => p.test(log.message || ''));
    }

    // Public API
    async addLog(log, saveToCloud = true, skipStorage = false) {
        log.id = log.id || crypto.randomUUID();
        log.timestamp = log.timestamp || Date.now();

        if (!skipStorage && this.shouldSkipStorage(log)) {
            skipStorage = true;
        }

        // แสดงผลทันที
        this.logs.push(log);
        if (this.logs.length > 500) this.logs.shift();
        
        if (this.isCapturing && this.shouldDisplay(log)) {
            this.renderLog(log);
        }
        
        this.updateStats();
        this.saveToCache();

        // บันทึกลง cloud
        if (saveToCloud && !skipStorage) {
            await this.saveLog(log);
        }
    }

    // Logging methods
    log(msg, meta, skip) { this.addLog({ level: 'log', message: msg, source: 'Console', category: 'api', meta }, true, skip); }
    info(msg, meta, skip) { this.addLog({ level: 'info', message: msg, source: 'Console', category: 'api', meta }, true, skip); }
    warn(msg, meta, skip) { this.addLog({ level: 'warn', message: msg, source: 'Console', category: 'api', meta }, true, skip); }
    error(msg, meta, skip) { this.addLog({ level: 'error', message: msg, source: 'Console', category: 'api', meta }, true, skip); }
    debug(msg, meta, skip) { this.addLog({ level: 'debug', message: msg, source: 'Console', category: 'api', meta }, true, skip); }
    system(msg, meta, skip) { this.addLog({ level: 'info', message: msg, source: 'System', category: 'system', meta }, true, skip); }

    // Actions
    toggleCapture() {
        this.isCapturing = !this.isCapturing;
        const btn = document.getElementById('capture-btn');
        btn.innerHTML = this.isCapturing 
            ? '<span class="btn-icon">⏸</span><span>Pause</span>'
            : '<span class="btn-icon">▶</span><span>Resume</span>';
        this.system(this.isCapturing ? 'Capture resumed' : 'Capture paused', null, true);
    }

    clear() {
        if (confirm('Clear all logs?')) {
            this.logs = [];
            this.refreshDisplay();
            this.updateStats();
            this.saveToCache();
        }
    }

    exportLogs() {
        const data = {
            exported: new Date().toISOString(),
            session: this.sessionId,
            logs: this.logs
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `logs-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    handleInput(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const input = document.getElementById('js-input');
            const code = input.value.trim();
            if (code) {
                this.system('> ' + code);
                try {
                    const result = eval(code);
                    if (result !== undefined) this.system('< ' + result);
                } catch (err) {
                    this.error(err.message);
                }
                input.value = '';
            }
        }
    }
}

// Initialize
window.consolePro = new FantroveConsolePro();

window.FantroveConsole = {
    log: (m, meta) => consolePro.log(m, meta),
    info: (m, meta) => consolePro.info(m, meta),
    warn: (m, meta) => consolePro.warn(m, meta),
    error: (m, meta) => consolePro.error(m, meta),
    debug: (m, meta) => consolePro.debug(m, meta)
};
