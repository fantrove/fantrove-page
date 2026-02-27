/**
 * Fantrove Console Bridge - Cloud Edition
 * Send logs to Cloudflare Workers → Supabase
 * Retention: 30 days (managed by Supabase pg_cron)
 */
(function() {
    'use strict';

    // ⚠️ แก้ไข URL นี้ให้ตรงกับ Workers ของคุณ
    const WORKER_URL = 'https://fantrove-console-api.nontakorn2600.workers.dev';
    
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
    let isApiHealthy = false;
    let lastHealthCheck = 0;
    const HEALTH_CHECK_INTERVAL = 30000; // ตรวจสอบทุก 30 วินาที

    function init() {
        setupErrorCapture();
        setupNetworkCapture();
        setupOnlineListeners();
        
        // โหลด logs ค้างจาก localStorage (ถ้ามี)
        loadPendingFromStorage();
        
        // ตรวจสอบ API health ก่อนเริ่มใช้งาน
        checkHealth().then(healthy => {
            isInitialized = true;
            if (healthy) {
                flushQueue();
            }
        });
        
        // เริ่ม health check loop
        startHealthCheckLoop();
    }

    async function checkHealth() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch(`${WORKER_URL}/health`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const data = await response.json();
                isApiHealthy = true;
                lastHealthCheck = Date.now();
                console.log('[Fantrove Bridge] API Health:', data);
                return true;
            } else {
                isApiHealthy = false;
                console.warn('[Fantrove Bridge] API Health check failed:', response.status);
                return false;
            }
        } catch (error) {
            isApiHealthy = false;
            console.warn('[Fantrove Bridge] API unreachable:', error.message);
            return false;
        }
    }

    function startHealthCheckLoop() {
        setInterval(async () => {
            if (!isOnline) return;
            
            // ถ้ายังไม่เคย check หรือครบ interval แล้ว
            if (Date.now() - lastHealthCheck > HEALTH_CHECK_INTERVAL) {
                const wasHealthy = isApiHealthy;
                await checkHealth();
                
                // ถ้ากลับมาออนไลน์ได้ ให้ sync queue ทันที
                if (!wasHealthy && isApiHealthy) {
                    console.log('[Fantrove Bridge] API back online, syncing...');
                    flushQueue();
                }
            }
        }, 10000); // ตรวจสอบทุก 10 วินาทีว่าควร check health หรือยัง
    }

    function setupOnlineListeners() {
        window.addEventListener('online', () => {
            isOnline = true;
            // เมื่อกลับมาออนไลน์ ตรวจสอบ health ก่อนแล้วค่อย sync
            checkHealth().then(healthy => {
                if (healthy) flushQueue();
            });
        });
        
        window.addEventListener('offline', () => {
            isOnline = false;
            isApiHealthy = false;
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
                    console.log('[Fantrove Bridge] Restored', logs.length, 'logs from storage');
                }
            }
        } catch (e) {
            console.error('[Fantrove Bridge] Failed to load backup:', e);
        }
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

        // ถ้า offline หรือ API ไม่ healthy ให้เก็บใน queue
        if (!isOnline || !isApiHealthy) {
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
            // ถ้าส่งไม่สำเร็จ เก็บไว้ retry
            queue.push(payload);
            savePendingToStorage();
            // ทำเครื่องหมายว่า API อาจมีปัญหา
            isApiHealthy = false;
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
        if (queue.length === 0 || !isOnline || !isApiHealthy) return;
        
        // ตรวจสอบ health อีกครั้งก่อน sync
        if (!await checkHealth()) return;
        
        const batch = queue.splice(0, 50);
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(`${WORKER_URL}/logs/batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ logs: batch }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) throw new Error('Batch failed');
            
            const result = await response.json();
            if (result.failed > 0) {
                console.warn('[Fantrove Bridge] Batch partially failed:', result);
            }
            
            // ถ้า sync สำเร็จ ลบ backup ใน storage
            if (result.saved > 0) {
                removeFromLocalBackup(result.saved);
            }
        } catch (err) {
            // คืน logs กลับ queue
            queue.unshift(...batch);
            savePendingToStorage();
            isApiHealthy = false;
        }
    }

    function removeFromLocalBackup(count) {
        try {
            const backup = JSON.parse(localStorage.getItem('fantrove_backup') || '[]');
            const remaining = backup.slice(count);
            localStorage.setItem('fantrove_backup', JSON.stringify(remaining));
        } catch (e) {}
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
        captureException: (err, ctx) => send('error', err.message, { stack: err.stack, context: ctx }, 'ManualCapture'),
        // เพิ่ม method สำหรับตรวจสอบสถานะ
        getStatus: () => ({ 
            online: isOnline, 
            apiHealthy: isApiHealthy, 
            pending: queue.length,
            sessionId: SESSION_ID
        }),
        forceSync: () => flushQueue()
    };

    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Sync loop - ลดความถี่ลงเพราะมี health check แยกแล้ว
    setInterval(flushQueue, 30000);
    
    // Save before unload
    window.addEventListener('beforeunload', savePendingToStorage);
})();
