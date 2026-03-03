/**
 * Fantrove Console Bridge - Global Mode (No Session)
 * สำหรับเว็บไซต์ที่ต้องการส่ง logs ไปยัง Global Console
 */

(function() {
    'use strict';

    const WORKER_URL = 'https://fantrove-console-api.nontakorn2600.workers.dev';

    // ใช้ Client Fingerprint แทน Session ID
    const CLIENT_FP = (function() {
        try {
            // สร้าง fingerprint จาก browser info
            const ua = navigator.userAgent;
            const screen = `${window.screen.width}x${window.screen.height}`;
            const lang = navigator.language;
            const colorDepth = window.screen.colorDepth;
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const fp = btoa(`${ua}-${screen}-${lang}-${colorDepth}-${tz}`).substring(0, 20);

            // เก็บใน localStorage เพื่อ consistency ระหว่าง reload
            let stored = localStorage.getItem('fantrove_client_fp');
            if (!stored) {
                stored = fp;
                localStorage.setItem('fantrove_client_fp', stored);
            }
            return stored;
        } catch (e) {
            return 'unknown_' + Date.now().toString(36);
        }
    })();

    const queue = [];
    let isOnline = navigator.onLine;
    let isInitialized = false;
    let isApiHealthy = false;
    let lastHealthCheck = 0;
    const HEALTH_CHECK_INTERVAL = 30000;

    function init() {
        setupErrorCapture();
        setupNetworkCapture();
        setupOnlineListeners();
        loadPendingFromStorage();

        checkHealth().then(healthy => {
            isInitialized = true;
            if (healthy) flushQueue();
        });

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
                return true;
            } else {
                isApiHealthy = false;
                return false;
            }
        } catch (error) {
            isApiHealthy = false;
            return false;
        }
    }

    function startHealthCheckLoop() {
        setInterval(async () => {
            if (!isOnline) return;

            if (Date.now() - lastHealthCheck > HEALTH_CHECK_INTERVAL) {
                const wasHealthy = isApiHealthy;
                await checkHealth();

                if (!wasHealthy && isApiHealthy) {
                    flushQueue();
                }
            }
        }, 10000);
    }

    function setupOnlineListeners() {
        window.addEventListener('online', () => {
            isOnline = true;
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
            // โหลดเฉพาะของ client นี้ (ใช้ fingerprint เป็น key)
            const backup = localStorage.getItem(`fantrove_bridge_backup_${CLIENT_FP}`);
            if (backup) {
                const logs = JSON.parse(backup);
                if (Array.isArray(logs)) {
                    queue.push(...logs);
                    localStorage.removeItem(`fantrove_bridge_backup_${CLIENT_FP}`);
                }
            }
        } catch (e) {}
    }

    function savePendingToStorage() {
        try {
            if (queue.length > 0) {
                localStorage.setItem(`fantrove_bridge_backup_${CLIENT_FP}`, JSON.stringify(queue.slice(-100)));
            }
        } catch (e) {}
    }

    // ส่ง log โดยใช้ fingerprint แทน session_id
    function send(level, message, meta, source) {
        const payload = {
            // ไม่มี session_id แล้ว - ใช้ fingerprint ใน meta แทน
            level: level,
            category: detectCategory(source, level),
            message: String(message),
            source: source || 'App',
            meta: {
                ...(meta || {}),
                fingerprint: CLIENT_FP,  // ใส่ fingerprint ใน meta
                url: location.href,
                userAgent: navigator.userAgent
            },
            user_agent: navigator.userAgent,
            url: location.href,
            timestamp: Date.now()
        };

        broadcastLocal(payload);

        if (!isOnline || !isApiHealthy) {
            queue.push(payload);
            savePendingToStorage();
            return;
        }

        fetch(`${WORKER_URL}/logs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true
        }).catch(err => {
            queue.push(payload);
            savePendingToStorage();
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

        if (!await checkHealth()) return;

        const batch = queue.splice(0, 50);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await fetch(`${WORKER_URL}/logs/batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    logs: batch.map(log => ({
                        ...log,
                        meta: {
                            ...log.meta,
                            fingerprint: CLIENT_FP  // ensure ทุกอันมี fingerprint
                        }
                    }))
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) throw new Error('Batch failed');

            const result = await response.json();
            if (result.saved > 0) {
                removeFromLocalBackup(result.saved);
            }
        } catch (err) {
            queue.unshift(...batch);
            savePendingToStorage();
            isApiHealthy = false;
        }
    }

    function removeFromLocalBackup(count) {
        try {
            const backup = JSON.parse(localStorage.getItem(`fantrove_bridge_backup_${CLIENT_FP}`) || '[]');
            const remaining = backup.slice(count);
            localStorage.setItem(`fantrove_bridge_backup_${CLIENT_FP}`, JSON.stringify(remaining));
        } catch (e) {}
    }

    function detectCategory(source, level) {
        if (source?.includes('Network') || source?.includes('HTTP')) return 'network';
        if (source?.includes('API')) return 'api';
        if (source?.includes('Code') || source?.includes('Error')) return 'code';
        return 'system';
    }

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
                const response = await originalFetch.apply(window, args);
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

    // Global API - ไม่มี session แล้ว
    window.FantroveConsole = {
        log: (msg, meta) => send('log', msg, meta, 'API'),
        info: (msg, meta) => send('info', msg, meta, 'API'),
        warn: (msg, meta) => send('warn', msg, meta, 'API'),
        error: (msg, meta) => send('error', msg, meta, 'API'),
        debug: (msg, meta) => send('debug', msg, meta, 'API'),
        success: (msg, meta) => send('success', msg, meta, 'API'),
        captureException: (err, ctx) => send('error', err.message, { stack: err.stack, context: ctx }, 'ManualCapture'),
        getClientFingerprint: () => CLIENT_FP,  // เปลี่ยนจาก getSessionId
        getStatus: () => ({ 
            online: isOnline, 
            apiHealthy: isApiHealthy, 
            pending: queue.length,
            clientFingerprint: CLIENT_FP  // เปลี่ยนจาก sessionId
        }),
        forceSync: () => flushQueue()
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    setInterval(flushQueue, 30000);
    window.addEventListener('beforeunload', savePendingToStorage);
})();