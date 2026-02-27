/**
 * Fantrove Console Bridge - Cloud Edition
 * Send logs to Cloudflare Workers → Supabase
 * Retention: 30 days (managed by Supabase pg_cron)
 */
(function() {
    'use strict';

    // ⚠️ แก้ไข URL นี้ให้ตรงกับ Workers ของคุณ
    const WORKER_URL = 'https://fantrove-console-api.YOUR_SUBDOMAIN.workers.dev';
    
    // ดึง session ID จาก localStorage หรือสร้างใหม่
    const SESSION_ID = (function() {
        let id = localStorage.getItem('fantrove_session_id');
        if (!id) {
            id = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('fantrove_session_id', id);
        }
        return id;
    })();

    const queue = [];
    let isOnline = navigator.onLine;
    let isInitialized = false;

    function init() {
        setupErrorCapture();
        setupNetworkCapture();
        setupOnlineListeners();
        
        // โหลด logs ค้างจาก localStorage (ถ้ามี)
        loadPendingFromStorage();
        
        isInitialized = true;
        flushQueue();
    }

    function setupOnlineListeners() {
        window.addEventListener('online', () => {
            isOnline = true;
            flushQueue();
        });
        window.addEventListener('offline', () => {
            isOnline = false;
        });
    }

    function loadPendingFromStorage() {
        try {
            const backup = localStorage.getItem('fantrove_backup');
            if (backup) {
                const logs = JSON.parse(backup);
                if (Array.isArray(logs)) {
                    queue.push(...logs);
                    localStorage.removeItem('fantrove_backup');
                }
            }
        } catch (e) {}
    }

    function savePendingToStorage() {
        try {
            if (queue.length > 0) {
                localStorage.setItem('fantrove_backup', JSON.stringify(queue.slice(-100)));
            }
        } catch (e) {}
    }

    // Send log to Worker
    function send(level, message, meta, source) {
        const payload = {
            session_id: SESSION_ID,
            level: level,
            category: detectCategory(source, level),
            message: String(message),
            source: source || 'App',
            meta: meta || {},
            user_agent: navigator.userAgent,
            url: location.href,
            timestamp: Date.now()
        };

        // Broadcast ให้ console ในแท็บเดียวกัน (real-time)
        broadcastLocal(payload);

        if (!isOnline) {
            queue.push(payload);
            savePendingToStorage();
            return;
        }

        // Send ตรงไป Workers
        fetch(`${WORKER_URL}/logs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true
        }).catch(err => {
            queue.push(payload);
            savePendingToStorage();
        });
    }

    function broadcastLocal(payload) {
        try {
            localStorage.setItem('fantrove_broadcast', JSON.stringify({
                ...payload,
                _local: true,
                _timestamp: Date.now()
            }));
        } catch (e) {}
    }

    async function flushQueue() {
        if (queue.length === 0 || !isOnline) return;
        
        const batch = queue.splice(0, 50);
        
        try {
            const response = await fetch(`${WORKER_URL}/logs/batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ logs: batch })
            });

            if (!response.ok) throw new Error('Batch failed');
            
            const result = await response.json();
            if (result.failed > 0) {
                // คืน failed logs กลับ queue
                // (simplified - ในความเป็นจริงควร track แต่ละ log)
            }
        } catch (err) {
            queue.unshift(...batch);
            savePendingToStorage();
        }
    }

    function detectCategory(source, level) {
        if (source?.includes('Network') || source?.includes('HTTP')) return 'network';
        if (source?.includes('API')) return 'api';
        if (source?.includes('Code') || source?.includes('Error')) return 'code';
        return 'system';
    }

    // Error Capture
    function setupErrorCapture() {
        window.addEventListener('error', (event) => {
            if (isNoise(event.message)) return;
            
            send('error', formatError(event), {
                filename: event.filename,
                line: event.lineno,
                column: event.colno,
                stack: cleanStack(event.error?.stack)
            }, 'CodeError');
        });

        window.addEventListener('unhandledrejection', (event) => {
            if (isNoise(String(event.reason))) return;
            
            send('error', `Unhandled Promise: ${event.reason?.message || event.reason}`, {
                stack: cleanStack(event.reason?.stack)
            }, 'PromiseError');
        });

        const originalError = console.error;
        console.error = function(...args) {
            originalError.apply(console, args);
            const error = args.find(a => a instanceof Error);
            if (error && !isNoise(error.message)) {
                send('error', error.message, { stack: cleanStack(error.stack) }, 'ConsoleError');
            }
        };
    }

    function setupNetworkCapture() {
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
            const url = args[0];
            try {
                const response = await originalFetch.apply(this, args);
                if (response.status >= 500) {
                    send('error', `Server Error ${response.status}`, { url, status: response.status }, 'ServerError');
                }
                return response;
            } catch (error) {
                if (error.name !== 'AbortError') {
                    send('error', `Network Failed: ${error.message}`, { url, error: error.name }, 'NetworkError');
                }
                throw error;
            }
        };
    }

    // Helpers
    function isNoise(msg) {
        if (!msg) return true;
        const noise = ['ResizeObserver', 'Script error.', 'The operation was aborted', 'cancelled', 'canceled'];
        return noise.some(n => msg.toLowerCase().includes(n.toLowerCase()));
    }

    function formatError(event) {
        const file = event.filename ? event.filename.split('/').pop() : 'unknown';
        return `${event.message} (${file}:${event.lineno || 0})`;
    }

    function cleanStack(stack) {
        if (!stack) return '';
        return stack.split('\n').filter(l => !l.includes('node_modules')).slice(0, 5).join('\n');
    }

    // Public API
    window.FantroveConsole = {
        log: (msg, meta) => send('log', msg, meta, 'API'),
        info: (msg, meta) => send('info', msg, meta, 'API'),
        warn: (msg, meta) => send('warn', msg, meta, 'API'),
        error: (msg, meta) => send('error', msg, meta, 'API'),
        debug: (msg, meta) => send('debug', msg, meta, 'API'),
        success: (msg, meta) => send('success', msg, meta, 'API'),
        captureException: (err, ctx) => send('error', err.message, { stack: err.stack, context: ctx }, 'ManualCapture')
    };

    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Sync loop
    setInterval(flushQueue, 10000);
    
    // Save before unload
    window.addEventListener('beforeunload', savePendingToStorage);
})();
