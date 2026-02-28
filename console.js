/**
 * Fantrove Console Pro - Supabase Realtime Edition
 * ดึงข้อมูลครั้งแรกครั้งเดียว ที่เหลือรอ Realtime ส่งมา
 */

class FantroveConsolePro {
    constructor() {
        // Supabase Config (เปลี่ยนเป็นของคุณ)
        this.SUPABASE_URL = 'https://your-project.supabase.co';
        this.SUPABASE_ANON_KEY = 'your-anon-key';
        
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
        this.stats = { code: 0, network: 0, system: 0, api: 0 };
        
        // สถานะการโหลด
        this.isLoading = false;
        this.hasMoreHistory = true;
        
        this.skipStoragePatterns = [
            /^Console ready/i, /^Loaded \d+ logs/i, /^Realtime connected/i,
            /^Connection lost/i, /^Reconnected/i
        ];
        
        this.init();
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
            s = 'sess_' + Date.now().toString(36).substr(-8);
            localStorage.setItem('fantrove_session_id', s);
        }
        return s;
    }

    async init() {
        this.setupErrorCapture();
        this.setupNetworkListeners();
        
        // โหลดจาก cache ก่อน (ทันที)
        this.loadFromCache();
        
        // เชื่อมต่อ Supabase
        if (this.isOnline) {
            await this.connectSupabase();
        }
    }

    // ============================================
    // SUPABASE: เชื่อมต่อและตั้งค่า Realtime
    // ============================================
    
    async connectSupabase() {
        try {
            this.updateStatus('loading', 'Connecting to Supabase...');
            
            // สร้าง client
            this.supabase = supabase.createClient(this.SUPABASE_URL, this.SUPABASE_ANON_KEY, {
                realtime: {
                    params: {
                        eventsPerSecond: 10
                    }
                }
            });

            // ดึงข้อมูลครั้งแรก (initial load)
            await this.loadInitialLogs();
            
            // เปิด Realtime subscription
            this.subscribeToRealtime();
            
            this.isConnected = true;
            this.updateStatus('connected', '● Real-time');
            this.system('Realtime connected', null, true);
            
            // sync pending logs ถ้ามี
            this.syncPendingLogs();
            
        } catch (error) {
            console.error('[Supabase] Connection failed:', error);
            this.updateStatus('local', '○ Local Mode');
            this.showError('Cannot connect to database. Using local mode.');
        }
    }

    // ============================================
    // ดึงข้อมูลครั้งแรกครั้งเดียว (Initial Load)
    // ============================================
    
    async loadInitialLogs(limit = 100) {
        this.isLoading = true;
        this.updateStatus('loading', 'Loading logs...');
        
        try {
            const { data, error } = await this.supabase
                .from('console_logs')
                .select('*')
                .eq('session_id', this.sessionId)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw error;

            if (data && data.length > 0) {
                // แปลงรูปแบบ
                const formatted = data.map(log => this.formatLogFromDB(log));
                
                // รวมกับข้อมูลที่มีอยู่ (ถ้ามี)
                this.mergeLogs(formatted, false);
                this.system(`Loaded ${data.length} logs`, null, true);
                
                // ถ้าได้ครบ 100 แสดงว่าอาจมีอีก
                this.hasMoreHistory = data.length === limit;
            } else {
                this.hasMoreHistory = false;
            }
            
        } catch (error) {
            console.error('[Load] Failed:', error);
            this.system('Failed to load history', null, true);
        } finally {
            this.isLoading = false;
        }
    }

    // ============================================
    // REALTIME: รอข้อมูลจาก Supabase ส่งมา
    // ============================================
    
    subscribeToRealtime() {
        // Subscribe ตาราง console_logs สำหรับ session นี้เท่านั้น
        this.realtimeChannel = this.supabase
            .channel(`console_logs:${this.sessionId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'console_logs',
                    filter: `session_id=eq.${this.sessionId}`
                },
                (payload) => {
                    // ได้รับข้อมูลใหม่แบบ real-time!
                    const log = this.formatLogFromDB(payload.new);
                    
                    // ตรวจสอบว่าไม่ซ้ำ
                    if (!this.logs.find(l => l.id === log.id)) {
                        this.addRealtimeLog(log);
                    }
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log('[Realtime] Subscribed to', this.sessionId);
                } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                    this.handleRealtimeDisconnect();
                }
            });
    }

    addRealtimeLog(log) {
        // เพิ่ม log ใหม่แบบ real-time
        this.logs.push(log);
        if (this.logs.length > 500) this.logs.shift();
        
        if (this.isCapturing && this.shouldDisplay(log)) {
            this.renderLog(log, true); // มี animation
        }
        
        this.updateStats();
        
        // แจ้งเตือนเฉพาะ error
        if (log.level === 'error') {
            this.showToast(`⚠️ New error: ${log.message.substring(0, 50)}...`);
        }
    }

    handleRealtimeDisconnect() {
        this.isConnected = false;
        this.updateStatus('local', '○ Local Mode');
        
        // พยายาม reconnect ใน 5 วินาที
        setTimeout(() => {
            if (this.isOnline) {
                this.subscribeToRealtime();
            }
        }, 5000);
    }

    // ============================================
    // SAVE: บันทึก logs ลง Supabase
    // ============================================
    
    async saveLog(log) {
        if (!this.supabase) {
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
                source: log.source,
                meta: log.meta || {},
                stack_trace: log.stackTrace,
                user_agent: navigator.userAgent?.substring(0, 200),
                url: location.href?.substring(0, 500),
                created_at: new Date(log.timestamp).toISOString(),
                expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            };

            const { error } = await this.supabase
                .from('console_logs')
                .insert(payload);

            if (error) throw error;
            
        } catch (error) {
            console.warn('[Save] Failed, queueing:', error);
            this.pendingLogs.push(log);
            this.saveToLocalBackup(log);
        }
    }

    async syncPendingLogs() {
        if (this.pendingLogs.length === 0 || !this.supabase) return;
        
        const batch = this.pendingLogs.splice(0, 50);
        const promises = batch.map(log => this.saveLog(log));
        
        await Promise.all(promises);
        
        if (this.pendingLogs.length > 0) {
            setTimeout(() => this.syncPendingLogs(), 1000);
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
            meta: dbLog.meta || {},
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

        // จำกัดขนาด
        if (this.logs.length > 500) {
            this.logs = this.logs.slice(-500);
        }
        
        this.refreshDisplay();
        this.updateStats();
        this.saveToCache();
    }

    // ============================================
    // Local Storage (Backup)
    // ============================================
    
    loadFromCache() {
        try {
            const cache = localStorage.getItem('fantrove_logs_cache');
            if (cache) {
                const parsed = JSON.parse(cache);
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
            }
        } catch (e) {}
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
    // UI & Event Handling (เหมือนเดิม)
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
            meta: { line: data.lineno }
        }, true); // saveToCloud = true
    }

    isNoise(msg) {
        return !msg || ['ResizeObserver', 'Script error.', 'The operation was aborted'].some(n => msg.includes(n));
    }

    setupNetworkListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            if (!this.isConnected) {
                this.connectSupabase();
            }
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.isConnected = false;
            this.updateStatus('offline', '✕ Offline');
            if (this.realtimeChannel) {
                this.supabase.removeChannel(this.realtimeChannel);
                this.realtimeChannel = null;
            }
        });
    }

    // UI Methods
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
        
        entry.innerHTML = `
            <div class="log-header">
                <span class="log-time">${cloudIcon}${time}</span>
                <span class="log-level-badge ${log.level}">${log.level}</span>
                <span class="log-category ${log.category}">${log.category}</span>
                <span class="log-source">${log.source}</span>
            </div>
            <div class="log-content">${this.escapeHtml(log.message)}</div>
            ${log.stackTrace ? `<div class="stack-trace">${this.escapeHtml(log.stackTrace)}</div>` : ''}
        `;

        output.appendChild(entry);
        
        const isBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 100;
        if (isBottom) output.scrollTop = output.scrollHeight;
    }

    escapeHtml(text) {
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
        // ... (เหมือนเดิม)
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
            offline: '#da3633'
        };
        
        dot.style.background = colors[type] || colors.local;
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
        document.getElementById('error-message').textContent = msg;
        document.getElementById('error-banner').classList.add('visible');
    }

    hideError() {
        document.getElementById('error-banner').classList.remove('visible');
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

    shouldSkipStorage(log) {
        if (log.category !== 'system') return false;
        return this.skipStoragePatterns.some(p => p.test(log.message || ''));
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

window.consolePro = new FantroveConsolePro();

window.FantroveConsole = {
    log: (m, meta) => consolePro.log(m, meta),
    info: (m, meta) => consolePro.info(m, meta),
    warn: (m, meta) => consolePro.warn(m, meta),
    error: (m, meta) => consolePro.error(m, meta),
    debug: (m, meta) => consolePro.debug(m, meta)
};
