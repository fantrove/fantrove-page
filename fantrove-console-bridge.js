/**
 * Fantrove Console Bridge
 * Smart Error Detection - Code errors only
 */
(function() {
    'use strict';

    const CONFIG = {
        endpoint: null,
        captureCodeErrors: true,
        captureNetworkErrors: true,
        debug: false
    };

    const queue = [];
    let isConnected = false;

    function init() {
        detectEndpoint();
        if (CONFIG.captureCodeErrors) setupCodeErrorCapture();
        if (CONFIG.captureNetworkErrors) setupSmartNetworkCapture();
        setupConnection();
        isConnected = true;
        flushQueue();
    }

    function detectEndpoint() {
        if (window.opener?.FantroveConsole) CONFIG.endpoint = window.opener;
        else if (window.parent !== window && window.parent.FantroveConsole) CONFIG.endpoint = window.parent;
    }

    // Capture เฉพาะ Code Errors ที่สำคัญ
    function setupCodeErrorCapture() {
        // Runtime errors
        window.addEventListener('error', (event) => {
            if (isNoiseError(event)) return;
            
            send('error', formatError(event), {
                type: 'code',
                filename: event.filename,
                line: event.lineno,
                column: event.colno,
                stack: cleanStack(event.error?.stack),
                isUserCode: isUserCode(event.filename)
            }, 'CodeError');
        });

        // Promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            if (isNoisePromise(event.reason)) return;
            
            send('error', `Unhandled Promise: ${event.reason?.message || event.reason}`, {
                type: 'promise',
                stack: cleanStack(event.reason?.stack),
                isUserCode: true
            }, 'PromiseError');
        });

        // Console.error ที่เป็น Error จริงๆ
        const originalError = console.error;
        console.error = function(...args) {
            originalError.apply(console, args);
            
            const error = args.find(a => a instanceof Error);
            if (error && !isNoiseMessage(error.message)) {
                send('error', error.message, {
                    type: 'console',
                    stack: cleanStack(error.stack),
                    isUserCode: true
                }, 'ConsoleError');
            }
        };
    }

    // Network errors ที่สำคัญเท่านั้น
    function setupSmartNetworkCapture() {
        // แจ้งเตือนเฉพาะ 5xx และ critical failures
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
            const url = args[0];
            
            try {
                const response = await originalFetch.apply(this, args);
                
                if (response.status >= 500) {
                    send('error', `Server Error ${response.status}`, {
                        type: 'http',
                        url: url,
                        status: response.status,
                        critical: true
                    }, 'ServerError');
                }
                
                return response;
            } catch (error) {
                // แจ้งเตือนเฉพาะ network failure จริงๆ (ไม่ใช่ abort)
                if (error.name !== 'AbortError') {
                    send('error', `Network Failed: ${url}`, {
                        type: 'network',
                        url: url,
                        error: error.message,
                        critical: true
                    }, 'NetworkError');
                }
                throw error;
            }
        };
    }

    function send(level, message, meta, source) {
        const payload = {
            level: level,
            message: message,
            source: source,
            meta: meta,
            timestamp: Date.now(),
            url: location.href
        };

        if (!isConnected) {
            queue.push(payload);
            return;
        }

        // BroadcastChannel
        if (typeof BroadcastChannel !== 'undefined') {
            const channel = new BroadcastChannel('fantrove_console');
            channel.postMessage({ type: 'FANTROVE_LOG', payload: payload });
        }

        // localStorage
        try {
            localStorage.setItem('fantrove_broadcast', JSON.stringify(payload));
        } catch (e) {}

        // postMessage
        if (CONFIG.endpoint) {
            CONFIG.endpoint.postMessage({ type: 'FANTROVE_LOG', payload: payload }, '*');
        }
    }

    function flushQueue() {
        while (queue.length > 0) {
            const payload = queue.shift();
            try {
                localStorage.setItem('fantrove_broadcast', JSON.stringify(payload));
            } catch (e) {}
        }
    }

    // Helper functions
    function isNoiseError(event) {
        const noise = [
            'ResizeObserver loop',
            'Script error.',
            'The operation was aborted',
            'The user aborted a request'
        ];
        return noise.some(n => event.message?.includes(n));
    }

    function isNoisePromise(reason) {
        if (!reason) return true;
        const msg = String(reason.message || reason).toLowerCase();
        return msg.includes('resizeobserver') || 
               msg.includes('abort') || 
               msg.includes('cancel');
    }

    function isNoiseMessage(msg) {
        const noise = ['webpack', 'hot module', 'HMR', '[Vue warn]', '[WDS]', 'ResizeObserver'];
        return noise.some(n => msg.includes(n));
    }

    function isUserCode(filename) {
        if (!filename) return true;
        const thirdParty = ['node_modules', 'vendor', 'webpack', 'react-dom', 'vue.runtime'];
        return !thirdParty.some(p => filename.includes(p));
    }

    function cleanStack(stack) {
        if (!stack) return '';
        return stack
            .split('\n')
            .filter(line => !line.includes('node_modules') && !line.includes('webpack'))
            .slice(0, 5)
            .join('\n');
    }

    function formatError(event) {
        const file = event.filename ? event.filename.split('/').pop() : 'unknown';
        return `${event.message} (${file}:${event.lineno || 0})`;
    }

    // Public API
    window.FantroveConsole = {
        log: (msg, meta) => send('log', String(msg), meta, 'API'),
        info: (msg, meta) => send('info', String(msg), meta, 'API'),
        warn: (msg, meta) => send('warn', String(msg), meta, 'API'),
        error: (msg, meta) => send('error', String(msg), meta, 'API'),
        debug: (msg, meta) => send('debug', String(msg), meta, 'API'),
        success: (msg, meta) => send('success', String(msg), meta, 'API'),
        
        // Manual capture
        captureException: (err, context) => {
            send('error', err.message, {
                stack: cleanStack(err.stack),
                type: 'manual',
                context: context
            }, 'ManualCapture');
        }
    };

    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
