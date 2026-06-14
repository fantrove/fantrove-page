/**
 * Fantrove Console Pro - Global Error Monitoring
 * ไม่มี Session ID - ดูทุก errors จากทุกผู้ใช้
 * Version: 2.0.0
 */

class FantroveConsolePro {
    constructor() {
        this.apiUrl = 'https://fantrove-console-api.nontakorn2600.workers.dev';
        this.logs = [];
        this.pendingLogs = [];
        this.activeFilters = new Set(['error', 'warn', 'info', 'log', 'debug']);
        this.searchQuery = '';
        this.isCapturing = true;
        this.isOnline = navigator.onLine;
        this.isCloudConnected = false;
        this.isSyncing = false;
        this.stats = { code: 0, network: 0, system: 0, api: 0 };
        this.isInitialized = false;
        this.hasShownReady = false;
        this.initStarted = false;

        // Client fingerprint สำหรับแยกผู้ใช้คร่าวๆ (ไม่ใช่ Session ID)
        this.clientFingerprint = this.generateFingerprint();

        // Time range สำหรับ pagination
        this.loadedTimeRange = { oldest: null, newest: null };
        this.hasMoreOldLogs = true;
        this.isLoadingHistory = false;

        // Polling สำหรับ realtime updates
        this.pollingInterval = null;
        this.lastPollTime = 0;
        this.pollIntervalMs = 10000; // 10 วินาที

        // Active users tracking
        this.activeUsers = new Set();
        this.lastActiveUsersUpdate = 0;

        // Skip patterns สำหรับลด noise
        this.skipStoragePatterns = [
            /^Console ready/i,
            /^Global Console Ready/i,
            /^Loaded \d+ logs/i,
            /^Realtime/i,
            /^Cloud (connected|disconnected)/i,
            /^Loading\.\.\.$/i,
            /^Poll/i
        ];

        // เริ่มต้นระบบ
        this.init();
    }

    // ============================================
    // Initialization
    // ============================================

    generateFingerprint() {
        try {
            const ua = navigator.userAgent;
            const screen = `${window.screen.width}x${window.screen.height}`;
            const lang = navigator.language;
            const colorDepth = window.screen.colorDepth;
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            return btoa(`${ua}-${screen}-${lang}-${colorDepth}-${tz}`).substring(0, 20);
        } catch (e) {
            return 'unknown_' + Date.now().toString(36);
        }
    }

    async init() {
        if (this.initStarted) return;
        this.initStarted = true;

        console.log('[Console] Initializing Global Console...');

        // Setup event listeners
        this.setupNetworkListeners();
        this.setupSmartErrorCapture();
        this.setupAPIMessageHandling();
        this.setupScrollHandler();
        this.setupKeyboardShortcuts();

        this.isInitialized = true;

        // แสดง ready message
        if (!this.hasShownReady) {
            this.system('🌐 Global Console Ready - Monitoring All Users', null, true);
            this.system(`Client Fingerprint: ${this.clientFingerprint}`, null, true);
            this.hasShownReady = true;
        }

        // เชื่อมต่อ cloud แบบ non-blocking
        if (this.isOnline) {
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
    // Cloud Connection - Global Logs (No Session)
    // ============================================

    async connectToCloud() {
        this.updateConnectionStatus('loading');

        try {
            // Health check
            const healthRes = await this.fetchWithTimeout(
                `${this.apiUrl}/health`, 
                { method: 'GET' }, 
                5000
            );

            const healthData = await healthRes.json();

            if (healthData.status !== 'healthy') {
                throw new Error('Health check failed');
            }

            // โหลด logs ทั้งหมดจากทุกผู้ใช้ (ไม่มี session filter)
            await this.loadGlobalLogs();

            this.isCloudConnected = true;
            this.retryCount = 0;
            this.updateConnectionStatus('connected');
            this.hideError();

            // เริ่ม polling สำหรับ realtime
            this.startPolling();

        } catch (error) {
            console.error('[Console] Connection failed:', error);
            this.handleConnectionFailure(String(error));
        }
    }

    async loadGlobalLogs() {
        try {
            const result = await this.fetchLogs({ 
                limit: 100, 
                fromStart: true 
            });

            if (result.logs.length > 0) {
                // เรียงจากใหม่ -> เก่า
                this.logs = result.logs.sort((a, b) => b.timestamp - a.timestamp);
                this.logs = this.logs.slice(0, 500);

                this.loadedTimeRange.newest = Math.max(...this.logs.map(l => l.timestamp));
                this.loadedTimeRange.oldest = Math.min(...this.logs.map(l => l.timestamp));
                this.hasMoreOldLogs = result.meta.has_more;

                // อัพเดท active users
                this.updateActiveUsers(result.logs);

                this.refreshDisplay();
                this.updateStats();

                // แสดงสรุป
                const errors = result.meta.summary?.errors || 0;
                const warnings = result.meta.summary?.warnings || 0;
                const info = result.meta.summary?.info || 0;
                const activeUsers = result.meta.summary?.active_clients || 0;

                if (errors > 0 || warnings > 0) {
                    this.system(`📊 ${result.logs.length} events (${errors}⚠️ ${warnings}⚡ ${info}ℹ️) from ${activeUsers} active clients`, null, true);
                }
            } else {
                this.system('No events found', null, true);
            }
        } catch (error) {
            console.error('[Console] Load global logs failed:', error);
            throw error;
        }
    }

    updateActiveUsers(logs) {
        logs.forEach(log => {
            const fp = log.meta?.fingerprint || log.client?.fingerprint;
            if (fp) this.activeUsers.add(fp);
        });
        this.lastActiveUsersUpdate = Date.now();
    }

    async loadOlderLogs() {
        if (this.isLoadingHistory || !this.hasMoreOldLogs || !this.isCloudConnected) return;

        this.isLoadingHistory = true;
        this.setSyncStatus(true, 'Loading history...');

        try {
            const result = await this.fetchLogs({ 
                limit: 50, 
                before: this.loadedTimeRange.oldest 
            });

            if (result.logs.length > 0) {
                const existingIds = new Set(this.logs.map(l => l.id));
                const newLogs = result.logs.filter(l => !existingIds.has(l.id));

                if (newLogs.length > 0) {
                    // เก็บ scroll position
                    const container = document.getElementById('console-output');
                    const oldHeight = container.scrollHeight;
                    const oldScroll = container.scrollTop;

                    this.logs = [...newLogs, ...this.logs];
                    this.logs = this.logs.slice(0, 500);

                    this.loadedTimeRange.oldest = Math.min(...this.logs.map(l => l.timestamp));
                    this.hasMoreOldLogs = result.meta.has_more;

                    this.updateActiveUsers(newLogs);
                    this.refreshDisplay();
                    this.updateStats();

                    // คืน scroll position
                    requestAnimationFrame(() => {
                        const newHeight = container.scrollHeight;
                        container.scrollTop = oldScroll + (newHeight - oldHeight);
                    });
                } else {
                    this.hasMoreOldLogs = false;
                }
            } else {
                this.hasMoreOldLogs = false;
            }
        } catch (e) {
            console.warn('[Console] Load older logs failed:', e);
        } finally {
            this.isLoadingHistory = false;
            this.setSyncStatus(false);
        }
    }

    // ============================================
    // Polling Realtime (แทน WebSocket)
    // ============================================

    startPolling() {
        if (this.pollingInterval) return;

        console.log('[Console] Starting polling...');

        this.pollingInterval = setInterval(() => {
            if (this.isCloudConnected && !document.hidden) {
                this.pollNewLogs();
            }
        }, this.pollIntervalMs);
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    async pollNewLogs() {
        const now = Date.now();
        if (now - this.lastPollTime < 5000) return; // ป้องกัน poll ถี่เกิน
        this.lastPollTime = now;

        const after = this.loadedTimeRange.newest || (Date.now() - 60000);

        try {
            const result = await this.fetchLogs({ 
                limit: 30, 
                after: after 
            });

            if (result.logs.length > 0) {
                const existingIds = new Set(this.logs.map(l => l.id));
                const newLogs = result.logs.filter(l => !existingIds.has(l.id));

                if (newLogs.length > 0) {
                    this.logs = [...newLogs, ...this.logs].slice(0, 500);
                    this.loadedTimeRange.newest = Math.max(...this.logs.map(l => l.timestamp));

                    // อัพเดท active users
                    this.updateActiveUsers(newLogs);

                    // แสดง notification ถ้ามี error ใหม่
                    const hasError = newLogs.some(l => l.level === 'error');
                    const hasWarn = newLogs.some(l => l.level === 'warn');

                    if (hasError) {
                        this.showToast(`🔴 ${newLogs.length} new errors!`);
                    } else if (hasWarn) {
                        this.showToast(`⚠️ ${newLogs.length} new warnings`);
                    }

                    this.refreshDisplay();
                    this.updateStats();
                }
            }
        } catch (e) {
            console.warn('[Poll] Failed:', e);
            // ไม่ disconnect ถ้า poll  fail ครั้งเดียว
        }
    }

    // ============================================
    // API Methods (No Session)
    // ============================================

    async fetchLogs(params = {}) {
        const { 
            limit = 50, 
            before = null, 
            after = null, 
            fromStart = false,
            level = null 
        } = params;

        let url = `${this.apiUrl}/logs?limit=${limit}`;
        if (before) url += `&before=${before}`;
        if (after) url += `&after=${after}`;
        if (fromStart) url += `&from_start=true`;
        if (level) url += `&level=${level}`;

        const res = await this.fetchWithTimeout(url, { method: 'GET' }, 10000);

        const responseText = await res.text();

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${responseText.substring(0, 200)}`);
        }

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            throw new Error('Invalid JSON response');
        }

        return {
            logs: (data.logs || []).map(log => this.normalizeLog(log)),
            meta: data.meta || { has_more: false, summary: {} }
        };
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
            timestamp: log.timestamp || new Date(log.created_at).getTime(),
            client: log.client || {},
            url: log.url,
            created_at: log.created_at
        };
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
    // Core Functions - Add Log (No Session)
    // ============================================

    async addLog(log, saveToCloud = true, skipStorage = false) {
        try {
            log.id = log.id || crypto.randomUUID?.() || (Date.now() + Math.random()).toString(36);
            log.timestamp = log.timestamp || Date.now();

            // ใส่ client fingerprint (ไม่ใช่ session_id)
            log.meta = {
                ...(log.meta || {}),
                fingerprint: this.clientFingerprint,
                _clientTime: new Date().toISOString()
            };

            const shouldSkipStorage = skipStorage || this.shouldSkipStorage(log);

            // เพิ่มเข้า array (ใหม่อยู่บน)
            this.logs.unshift(log);
            if (this.logs.length > 500) this.logs.pop();

            // แสดงถ้าไม่ skip
            if (this.isCapturing && this.shouldDisplay(log)) {
                this.renderLog(log);
            }

            this.updateStats();

            // อัพเดท category stats
            if (this.stats[log.category] !== undefined) {
                this.stats[log.category]++;
            }

            // ส่งไป cloud ถ้าต้องการ
            if (!shouldSkipStorage && saveToCloud && this.isInitialized) {
                this.pendingLogs.push(log);

                // Sync ทันทีถ้าเป็น error
                if (log.level === 'error' && this.isCloudConnected && !this.isSyncing) {
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
               (log.source || '').toLowerCase().includes(query) ||
               (log.meta?.fingerprint || '').toLowerCase().includes(query) ||
               (log.client?.browser || '').toLowerCase().includes(query) ||
               (log.client?.device || '').toLowerCase().includes(query);
    }

    // ============================================
    // Rendering
    // ============================================

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

        const levelColors = { 
            error: 'error', 
            warn: 'warn', 
            info: 'info', 
            debug: 'debug', 
            log: '', 
            success: '' 
        };
        const categoryClass = log.category || 'system';

        // Client info (ใช้ fingerprint แทน session_id)
        const client = log.client || {};
        const fingerprint = log.meta?.fingerprint || client.fingerprint || 'unknown';
        const shortFp = fingerprint.substring(0, 8);
        const clientInfo = client.device && client.browser 
            ? `📱 ${client.device} • 🌐 ${client.browser} • 🔑 ${shortFp}`
            : `🔑 Client: ${shortFp}`;

        // Stack trace
        let stackHtml = log.stackTrace 
            ? `<div class="stack-trace">${this.escapeHtml(log.stackTrace)}</div>` 
            : '';

        // Meta data (กรองบาง field ออก)
        let metaHtml = '';
        if (log.meta && Object.keys(log.meta).length > 0) {
            const displayMeta = { ...log.meta };
            delete displayMeta.client;
            delete displayMeta.fingerprint;
            delete displayMeta._clientTime;

            const metaEntries = Object.entries(displayMeta)
                .filter(([k, v]) => v !== undefined && v !== null && typeof v !== 'object')
                .slice(0, 5); // แสดงแค่ 5 อัน

            if (metaEntries.length > 0) {
                const metaStr = metaEntries.map(([k, v]) => `${k}: ${v}`).join(', ');
                metaHtml = `<div class="meta-data">${this.escapeHtml(metaStr)}</div>`;
            }
        }

        entry.innerHTML = `
            <div class="log-header">
                <span class="log-time">${time}</span>
                <span class="log-level-badge ${levelColors[log.level] || ''}">${log.level}</span>
                <span class="log-category ${categoryClass}">${log.category}</span>
                <span class="log-source" title="${this.escapeHtml(log.url || '')}">${log.source || 'System'}</span>
            </div>
            <div class="log-client" style="font-size: 11px; color: var(--text-secondary); margin: 4px 0; padding: 2px 6px; background: var(--bg-tertiary); border-radius: 4px; display: inline-block;">
                ${this.escapeHtml(clientInfo)}
            </div>
            <div class="log-content">${this.escapeHtml(log.message)}</div>
            ${metaHtml}
            ${stackHtml}
        `;

        output.insertBefore(entry, output.firstChild);

        // จำกัด DOM elements
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
            try { 
                return JSON.stringify(arg, null, 2); 
            } catch (e) { 
                return '[Object]'; 
            }
        }
        return String(arg);
    }

    refreshDisplay() {
        const output = document.getElementById('console-output');
        if (!output) return;

        output.innerHTML = '';

        const toShow = this.logs.filter(log => this.shouldDisplay(log));

        if (toShow.length === 0) {
            output.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🔍</div>
                    <div class="empty-text">No matching logs</div>
                    <div class="empty-hint">Try adjusting filters or search</div>
                </div>
            `;
        } else {
            toShow.forEach(log => this.renderLog(log, false));
        }
    }

    // ============================================
    // Error Capture
    // ============================================

    setupSmartErrorCapture() {
        // Global error
        window.addEventListener('error', (event) => {
            if (this.isNoiseError(event)) return;
            this.captureError({
                type: 'code',
                category: 'code',
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                stack: event.error?.stack,
                isUserCode: this.isUserCode(event.filename)
            });
        });

        // Unhandled promise
        window.addEventListener('unhandledrejection', (event) => {
            if (this.isNoisePromise(event.reason)) return;
            this.captureError({
                type: 'promise',
                category: 'code',
                message: event.reason?.message || String(event.reason),
                stack: event.reason?.stack,
                isUserCode: true
            });
        });

        // Network errors
        this.setupSmartNetworkCapture();

        // Console.error override
        const originalError = console.error;
        console.error = (...args) => {
            originalError.apply(console, args);
            if (!this.isCapturing) return;

            const message = args.map(a => this.stringify(a)).join(' ');
            if (this.isNoiseMessage(message)) return;

            const error = args.find(a => a instanceof Error);
            if (error) {
                this.captureError({
                    type: 'console',
                    category: 'code',
                    message: message,
                    stack: error.stack,
                    isUserCode: true
                });
            }
        };
    }

    isNoiseError(event) {
        const noise = [
            'ResizeObserver loop',
            'Script error.',
            'The operation was aborted',
            'Non-Error promise rejection'
        ];
        return noise.some(n => event.message?.includes(n));
    }

    isNoisePromise(reason) {
        if (!reason) return true;
        const msg = String(reason.message || reason).toLowerCase();
        return msg.includes('resizeobserver') || 
               msg.includes('abort') || 
               msg.includes('canceled');
    }

    isNoiseMessage(msg) {
        const noise = [
            'webpack',
            'hot module',
            'HMR',
            '[Vue warn]',
            '[WDS]',
            'ResizeObserver',
            'Non-Error promise rejection'
        ];
        return noise.some(n => msg.includes(n));
    }

    isUserCode(filename) {
        if (!filename) return true;
        const thirdParty = [
            'node_modules',
            'vendor',
            'webpack',
            'react-dom',
            'vue',
            'angular'
        ];
        return !thirdParty.some(p => filename.includes(p));
    }

    setupSmartNetworkCapture() {
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            const url = args[0];
            try {
                const response = await originalFetch.apply(window, args);

                if (response.status >= 500) {
                    this.captureError({
                        type: 'http',
                        category: 'network',
                        message: `Server Error ${response.status}`,
                        url: typeof url === 'string' ? url : url.url,
                        status: response.status
                    });
                }

                return response;
            } catch (error) {
                if (error.name !== 'AbortError') {
                    this.captureError({
                        type: 'network',
                        category: 'network',
                        message: `Network Failed: ${error.message}`,
                        url: typeof url === 'string' ? url : url?.url
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
            meta: { 
                type: errorData.type,
                isUserCode: errorData.isUserCode
            },
            timestamp: Date.now()
        };
        this.addLog(log);
    }

    formatErrorMessage(data) {
        let msg = `[${data.category?.toUpperCase() || 'ERROR'}] `;
        if (data.filename) {
            const file = data.filename.split('/').pop();
            msg += `${data.message} (${file}:${data.lineno || 0})`;
        } else if (data.url) {
            msg += `${data.message} (${data.url})`;
        } else {
            msg += data.message;
        }
        return msg;
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
            this.stopPolling();
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

    setupAPIMessageHandling() {
        // รับข้อความจาก iframe หรือ window.postMessage
        window.addEventListener('message', (e) => {
            if (e.data?.type === 'FANTROVE_LOG') {
                this.receiveAPILog(e.data.payload);
            }
        });

        // Broadcast channel (ถ้ามี)
        if (typeof BroadcastChannel !== 'undefined') {
            this.channel = new BroadcastChannel('fantrove_console');
            this.channel.onmessage = (e) => {
                if (e.data?.type === 'FANTROVE_LOG') {
                    this.receiveAPILog(e.data.payload);
                }
            };
        }
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + K = focus search
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                const searchInput = document.getElementById('search-input');
                if (searchInput) searchInput.focus();
            }

            // Ctrl/Cmd + L = clear
            if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
                e.preventDefault();
                this.clear();
            }

            // Escape = clear search
            if (e.key === 'Escape') {
                const searchInput = document.getElementById('search-input');
                if (searchInput && document.activeElement === searchInput) {
                    searchInput.value = '';
                    this.search('');
                }
            }
        });
    }

    receiveAPILog(data) {
        const log = {
            level: data.level || 'info',
            message: data.message,
            source: data.source || 'API',
            category: data.category || 'api',
            meta: data.meta,
            timestamp: Date.now()
        };
        this.addLog(log, false);
    }

    // ============================================
    // Sync & Connection
    // ============================================

    async syncPendingLogs() {
        if (this.pendingLogs.length === 0 || !this.isOnline || this.isSyncing) return;

        if (!this.isCloudConnected) return;

        this.isSyncing = true;
        this.setSyncStatus(true, 'Syncing...');

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

            if (!res.ok) {
                const error = await res.text();
                throw new Error(`HTTP ${res.status}: ${error}`);
            }

            const result = await res.json();
            console.log('[Sync] Sent', result.count || batch.length, 'logs');

        } catch (error) {
            console.error('[Sync] Failed:', error);
            // คืนค่าเข้า queue
            this.pendingLogs.unshift(...batch);
            this.isCloudConnected = false;
            setTimeout(() => this.connectToCloud(), 5000);
        } finally {
            this.isSyncing = false;
            this.setSyncStatus(false);
        }
    }

    handleConnectionFailure(errorMessage) {
        this.retryCount = (this.retryCount || 0) + 1;
        this.isCloudConnected = false;
        this.stopPolling();

        const maxRetries = 5;
        if (this.retryCount >= maxRetries) {
            this.updateConnectionStatus('local');
            this.system('Switched to local mode', null, true);
            setTimeout(() => this.connectToCloud(), 60000);
        } else {
            const delay = Math.min(1000 * Math.pow(2, this.retryCount), 10000);
            setTimeout(() => this.connectToCloud(), delay);
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
            if (!btn) return;

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
        if (!code) return;

        this.system('> ' + code);

        try {
            // สร้าง function สำหรับ eval เพื่อความปลอดภัย
            const result = (new Function('return ' + code))();

            if (result !== undefined) {
                const resultStr = this.stringify(result);
                this.system('< ' + resultStr);
            }
        } catch (err) {
            this.error('✖ ' + err.message, { stack: err.stack });
        }

        input.value = '';
        input.style.height = 'auto';
    }

    toggleCapture() {
        this.isCapturing = !this.isCapturing;
        const btn = document.getElementById('capture-btn');
        if (!btn) return;

        if (this.isCapturing) {
            btn.innerHTML = '<span class="btn-icon">⏸</span><span>Pause</span>';
            btn.classList.remove('paused');
        } else {
            btn.innerHTML = '<span class="btn-icon">▶</span><span>Resume</span>';
            btn.classList.add('paused');
        }
    }

    async clear() {
        if (!confirm('Clear all logs? This cannot be undone.')) return;

        this.logs = [];
        this.stats = { code: 0, network: 0, system: 0, api: 0 };
        this.activeUsers.clear();
        this.refreshDisplay();
        this.updateStats();

        // แสดง empty state
        const output = document.getElementById('console-output');
        if (output) {
            output.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📝</div>
                    <div class="empty-text">Console cleared</div>
                    <div class="empty-hint">New events will appear here</div>
                </div>
            `;
        }
    }

    exportLogs() {
        const data = {
            exported: new Date().toISOString(),
            clientFingerprint: this.clientFingerprint,
            count: this.logs.length,
            logs: this.logs
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fantrove-logs-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showToast('📥 Exported ' + this.logs.length + ' logs');
    }

    updateStats() {
        const counts = { 
            all: this.logs.length, 
            error: 0, 
            warn: 0, 
            info: 0, 
            log: 0, 
            debug: 0 
        };

        this.logs.forEach(log => {
            if (counts[log.level] !== undefined) {
                counts[log.level]++;
            }
        });

        // อัพเดท DOM
        Object.keys(counts).forEach(key => {
            const el = document.getElementById(`count-${key}`);
            if (el) el.textContent = counts[key];
        });

        const statTotal = document.getElementById('stat-total');
        const statCode = document.getElementById('stat-code');
        const statNetwork = document.getElementById('stat-network');
        const statActive = document.getElementById('stat-active');

        if (statTotal) statTotal.textContent = counts.all;
        if (statCode) statCode.textContent = this.stats.code;
        if (statNetwork) statNetwork.textContent = this.stats.network;
        if (statActive) statActive.textContent = this.activeUsers.size;
    }

    updateConnectionStatus(status) {
        const dot = document.getElementById('status-dot');
        const text = document.getElementById('status-text');

        if (!dot || !text) return;

        const styles = {
            loading: { 
                color: 'var(--accent-yellow)', 
                text: 'Connecting...', 
                dot: '' 
            },
            connected: { 
                color: 'var(--accent-green)', 
                text: 'Global ●', 
                dot: '' 
            },
            local: { 
                color: 'var(--accent-blue)', 
                text: 'Local', 
                dot: 'local' 
            },
            offline: { 
                color: 'var(--accent-yellow)', 
                text: 'Offline', 
                dot: 'offline' 
            },
            error: { 
                color: 'var(--accent-red)', 
                text: 'Error', 
                dot: 'error' 
            }
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

            if (!this.isOnline) {
                status.textContent = `${pending} queued`;
            } else if (!this.isCloudConnected) {
                status.textContent = `${pending} pending`;
            } else {
                status.textContent = pending > 0 ? `${pending} sync` : 'Live';
            }

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
        // ลบ toast เก่า
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = msg;
        toast.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            color: var(--text-primary);
            z-index: 1000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            animation: fadeIn 0.3s ease;
        `;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }

    retryConnection() {
        this.retryCount = 0;
        this.connectToCloud();
    }

    // ============================================
    // Logging Methods
    // ============================================

    log(msg, meta, skipStorage = false) { 
        this.addLog({ 
            level: 'log', 
            message: msg, 
            source: 'Console', 
            category: 'api', 
            meta, 
            timestamp: Date.now() 
        }, true, skipStorage); 
    }

    info(msg, meta, skipStorage = false) { 
        this.addLog({ 
            level: 'info', 
            message: msg, 
            source: 'Console', 
            category: 'api', 
            meta, 
            timestamp: Date.now() 
        }, true, skipStorage); 
    }

    warn(msg, meta, skipStorage = false) { 
        this.addLog({ 
            level: 'warn', 
            message: msg, 
            source: 'Console', 
            category: 'api', 
            meta, 
            timestamp: Date.now() 
        }, true, skipStorage); 
    }

    error(msg, meta, skipStorage = false) { 
        this.addLog({ 
            level: 'error', 
            message: msg, 
            source: 'Console', 
            category: 'api', 
            meta, 
            timestamp: Date.now() 
        }, true, skipStorage); 
    }

    debug(msg, meta, skipStorage = false) { 
        this.addLog({ 
            level: 'debug', 
            message: msg, 
            source: 'Console', 
            category: 'api', 
            meta, 
            timestamp: Date.now() 
        }, true, skipStorage); 
    }

    system(msg, meta, skipStorage = false) { 
        this.addLog({ 
            level: 'info', 
            message: msg, 
            source: 'System', 
            category: 'system', 
            timestamp: Date.now() 
        }, true, skipStorage); 
    }

    // ============================================
    // Cleanup
    // ============================================

    destroy() {
        this.stopPolling();

        if (this.channel) {
            this.channel.close();
        }
    }
}

// ============================================
// Create Instance
// ============================================

// สร้าง instance หลัง DOM พร้อม
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.consolePro = new FantroveConsolePro();
    });
} else {
    window.consolePro = new FantroveConsolePro();
}

// Global API (No Session)
window.FantroveConsole = {
    log: (m, meta) => window.consolePro?.log(m, meta),
    info: (m, meta) => window.consolePro?.info(m, meta),
    warn: (m, meta) => window.consolePro?.warn(m, meta),
    error: (m, meta) => window.consolePro?.error(m, meta),
    debug: (m, meta) => window.consolePro?.debug(m, meta),
    success: (m, meta) => window.consolePro?.addLog({ 
        level: 'success', 
        message: m, 
        source: 'API', 
        category: 'api', 
        meta, 
        timestamp: Date.now() 
    }),
    getStatus: () => ({
        connected: window.consolePro?.isCloudConnected,
        capturing: window.consolePro?.isCapturing,
        pending: window.consolePro?.pendingLogs.length,
        logs: window.consolePro?.logs.length,
        clientFingerprint: window.consolePro?.clientFingerprint,
        activeUsers: window.consolePro?.activeUsers?.size
    })
};