/**
 * Fantrove Console Pro - Real-time Edition
 * Server-Sent Events for instant error visibility
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
        this.stats = { code: 0, network: 0, system: 0, api: 0 };
        
        // Real-time
        this.eventSource = null;
        this.reconnectAttempts = 0;
        this.maxReconnectDelay = 30000;
        
        // Offline queue
        this.syncInterval = null;
        
        this.skipStoragePatterns = [
            /^Console ready/i, /^Connected to real-time/i, /^Connection lost/i,
            /^Restored \d+ logs/i, /^Reconnected/i
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
        
        // โหลดจาก local ก่อน (ทันที)
        this.loadFromStorage();
        
        // เชื่อมต่อ real-time
        if (this.isOnline) {
            this.connectRealtime();
        }
        
        // เริ่ม sync สำหรับ offline logs
        this.startOfflineSync();
    }

    // ============================================
    // REAL-TIME: Server-Sent Events
    // ============================================
    
    connectRealtime() {
        if (this.eventSource) {
            this.eventSource.close();
        }

        const url = `${this.apiUrl}/realtime/subscribe?session=${this.sessionId}`;
        this.eventSource = new EventSource(url);

        // รับ history ทันทีที่เชื่อมต่อ
        this.eventSource.addEventListener('history', (e) => {
            try {
                const logs = JSON.parse(e.data);
                if (logs.length > 0) {
                    this.mergeLogs(logs, false, true); // append, fromCloud=true
                    this.system(`Loaded ${logs.length} logs from cloud`, null, true);
                }
                this.isCloudConnected = true;
                this.updateConnectionStatus('connected');
                this.reconnectAttempts = 0;
            } catch (err) {
                console.error('[SSE] History parse error:', err);
            }
        });

        // รับ logs ใหม่แบบ real-time
        this.eventSource.addEventListener('logs', (e) => {
            try {
                const logs = JSON.parse(e.data);
                this.mergeLogs(logs, false, true);
                
                // แจ้งเตือนเฉพาะ error สำคัญ
                const errors = logs.filter(l => l.level === 'error');
                if (errors.length > 0) {
                    this.showToast(`⚠️ ${errors.length} new error(s)`);
                }
            } catch (err) {
                console.error('[SSE] Logs parse error:', err);
            }
        });

        // Connection opened
        this.eventSource.onopen = () => {
            this.isCloudConnected = true;
            this.updateConnectionStatus('connected');
            this.system('Connected to real-time stream', null, true);
        };

        // Error / Disconnect
        this.eventSource.onerror = () => {
            this.isCloudConnected = false;
            this.updateConnectionStatus('local');
            this.handleReconnect();
        };
    }

    handleReconnect() {
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
        
        console.log(`[Console] Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts})`);
        
        setTimeout(() => {
            if (this.isOnline) {
                this.connectRealtime();
            }
        }, delay);
    }

    // ============================================
    // Offline Sync (สำหรับ logs ที่เกิดตอน offline)
    // ============================================
    
    startOfflineSync() {
        // Sync ทุก 30 วินาที ถ้ามี pending
        this.syncInterval = setInterval(() => {
            if (this.isOnline && this.pendingLogs.length > 0 && !this.isCloudConnected) {
                this.syncPendingLogs();
            }
        }, 30000);

        // Sync เมื่อกลับมา online
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.connectRealtime();
            setTimeout(() => this.syncPendingLogs(), 1000);
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.isCloudConnected = false;
            this.updateConnectionStatus('offline');
            if (this.eventSource) {
                this.eventSource.close();
                this.eventSource = null;
            }
        });
    }

    async syncPendingLogs() {
        if (this.pendingLogs.length === 0) return;
        
        const batch = this.pendingLogs.splice(0, 50);
        
        try {
            const res = await fetch(`${this.apiUrl}/logs/batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ logs: batch })
            });
            
            if (res.ok) {
                this.removeFromLocalBackup(batch.length);
                // ถ้า sync สำเร็จและยังไม่ได้เชื่อมต่อ realtime ให้ลองใหม่
                if (!this.isCloudConnected) {
                    this.connectRealtime();
                }
            } else {
                this.pendingLogs.unshift(...batch);
            }
        } catch (e) {
            this.pendingLogs.unshift(...batch);
        }
    }

    // ============================================
    // Log Management (เหมือนเดิม แต่ optimized)
    // ============================================
    
    async addLog(log, saveToCloud = true, skipStorage = false) {
        log.id = log.id || crypto.randomUUID();
        log.timestamp = log.timestamp || Date.now();
        log.created_at = new Date(log.timestamp).toISOString();

        const shouldSkipStorage = skipStorage || this.shouldSkipStorage(log);

        // แสดงผลทันที
        this.logs.push(log);
        if (this.logs.length > 500) this.logs.shift();
        
        if (this.isCapturing && this.shouldDisplay(log)) {
            this.renderLog(log);
        }
        
        this.updateStats();

        // ถ้าเชื่อมต่ออยู่ ส่งผ่าน realtime ทันที
        if (this.isCloudConnected && saveToCloud && !shouldSkipStorage) {
            // ส่งผ่าน SSE ไม่ต้องรอ response
            fetch(`${this.apiUrl}/logs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...log, session_id: this.sessionId }),
                keepalive: true
            }).catch(() => {
                // ถ้าล้มเหลว เก็บไว้ sync ภายหลัง
                this.pendingLogs.push(log);
                this.saveToLocalBackup(log);
            });
        } 
        // ถ้า offline เก็บไว้ sync ภายหลัง
        else if (saveToCloud && !shouldSkipStorage) {
            this.pendingLogs.push(log);
            this.saveToLocalBackup(log);
        }
    }

    mergeLogs(newLogs, prepend = false, fromCloud = false) {
        const existingIds = new Set(this.logs.map(l => l.id));
        const unique = newLogs.filter(l => !existingIds.has(l.id));
        
        if (unique.length === 0) return;

        // แสดงผลทันทีทีละรายการ (สำหรับ real-time)
        unique.forEach(log => {
            if (fromCloud) log._fromCloud = true;
            if (prepend) {
                this.logs.unshift(log);
            } else {
                this.logs.push(log);
            }
            if (this.shouldDisplay(log)) {
                this.renderLog(log, !prepend); // animate เฉพาะข้อมูลใหม่
            }
        });

        if (this.logs.length > 500) {
            this.logs = this.logs.slice(0, 500);
        }
        
        this.updateStats();
        this.saveToCache();
    }

    // ============================================
    // Storage & UI (เหมือนเดิม)
    // ============================================
    
    loadFromStorage() {
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
            localStorage.setItem('fantrove_logs_cache', JSON.stringify(this.logs.slice(0, 100)));
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
            localStorage.setItem('fantrove_backup', JSON.stringify(backup.slice(count)));
        } catch (e) {}
    }

    // ... (ส่วนอื่นๆ เหมือนเดิม: renderLog, error capture, filters, etc.)

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

        // Override console.error
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
        });
    }

    isNoise(msg) {
        return !msg || ['ResizeObserver', 'Script error.', 'The operation was aborted'].some(n => msg.includes(n));
    }

    setupNetworkListeners() {
        // จัดการใน startOfflineSync แล้ว
    }

    // UI Methods (เหมือนเดิม)
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

        const cloudIcon = log._fromCloud ? '☁️ ' : '';
        
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
        
        // Auto-scroll ถ้าอยู่ด้านล่าง
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
        if (level === 'all') {
            const all = this.activeFilters.size === 5;
            document.querySelectorAll('.filter-btn[data-level]').forEach(btn => {
                if (all) {
                    this.activeFilters.clear();
                    btn.classList.remove('active');
                } else {
                    this.activeFilters.add(level);
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

    updateConnectionStatus(status) {
        const dot = document.getElementById('status-dot');
        const text = document.getElementById('status-text');
        
        const styles = {
            connected: { text: '● Real-time', color: '#238636', class: '' },
            local: { text: '○ Local Mode', color: '#58a6ff', class: 'local' },
            offline: { text: '✕ Offline', color: '#d29922', class: 'offline' }
        };
        
        const s = styles[status] || styles.local;
        dot.className = 'status-dot ' + s.class;
        text.textContent = s.text;
        text.style.color = s.color;
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

    shouldSkipStorage(log) {
        if (log.category !== 'system') return false;
        return this.skipStoragePatterns.some(p => p.test(log.message || ''));
    }

    // Public logging methods
    log(msg, meta, skip) { this.addLog({ level: 'log', message: msg, source: 'Console', category: 'api', meta }, true, skip); }
    info(msg, meta, skip) { this.addLog({ level: 'info', message: msg, source: 'Console', category: 'api', meta }, true, skip); }
    warn(msg, meta, skip) { this.addLog({ level: 'warn', message: msg, source: 'Console', category: 'api', meta }, true, skip); }
    error(msg, meta, skip) { this.addLog({ level: 'error', message: msg, source: 'Console', category: 'api', meta }, true, skip); }
    debug(msg, meta, skip) { this.addLog({ level: 'debug', message: msg, source: 'Console', category: 'api', meta }, true, skip); }
    system(msg, meta, skip) { this.addLog({ level: 'info', message: msg, source: 'System', category: 'system', meta }, true, skip); }
}

window.consolePro = new FantroveConsolePro();

window.FantroveConsole = {
    log: (m, meta) => consolePro.log(m, meta),
    info: (m, meta) => consolePro.info(m, meta),
    warn: (m, meta) => consolePro.warn(m, meta),
    error: (m, meta) => consolePro.error(m, meta),
    debug: (m, meta) => consolePro.debug(m, meta),
    success: (m, meta) => consolePro.addLog({ level: 'success', message: m, source: 'API', category: 'api', meta })
};
