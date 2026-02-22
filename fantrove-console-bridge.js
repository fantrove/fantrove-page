/**
 * Fantrove Console Bridge
 * Connects your app to Fantrove Console Pro
 * Auto-captures: console.*, errors, unhandled rejections
 */
(function() {
    'use strict';

    const CONFIG = {
        consoleUrl: '/console.html',
        autoCapture: true,
        captureNativeConsole: true,
        captureErrors: true,
        captureNetwork: false // Set true to capture fetch/XHR errors
    };

    // Internal log queue
    const queue = [];
    let isReady = false;

    // Initialize
    function init() {
        if (CONFIG.captureNativeConsole) hijackConsole();
        if (CONFIG.captureErrors) hijackErrors();
        if (CONFIG.captureNetwork) hijackNetwork();
        
        setupBroadcast();
        isReady = true;
        flushQueue();
    }

    // Hijack native console methods
    function hijackConsole() {
        const methods = ['log', 'info', 'warn', 'error', 'debug'];
        
        methods.forEach(method => {
            const original = console[method];
            console[method] = function(...args) {
                original.apply(console, args);
                sendToFantrove(method, args);
            };
        });
    }

    // Hijack global errors
    function hijackErrors() {
        window.addEventListener('error', (e) => {
            sendToFantrove('error', [{
                message: e.message,
                filename: e.filename,
                lineno: e.lineno,
                colno: e.colno,
                error: e.error?.toString()
            }], 'Exception');
        });

        window.addEventListener('unhandledrejection', (e) => {
            sendToFantrove('error', [e.reason], 'UnhandledRejection');
        });
    }

    // Hijack network (optional)
    function hijackNetwork() {
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
            try {
                const response = await originalFetch.apply(this, args);
                if (!response.ok) {
                    sendToFantrove('warn', [`HTTP ${response.status}: ${args[0]}`], 'Network');
                }
                return response;
            } catch (err) {
                sendToFantrove('error', [`Fetch failed: ${args[0]}`, err.message], 'Network');
                throw err;
            }
        };
    }

    // Send to Fantrove Console
    function sendToFantrove(level, args, source) {
        const payload = {
            level: level,
            message: args.map(formatArg).join(' '),
            source: source || detectSource(),
            meta: { url: location.href, timestamp: Date.now() },
            type: 'external'
        };

        if (isReady) {
            broadcast(payload);
        } else {
            queue.push(payload);
        }
    }

    function formatArg(arg) {
        if (arg === null) return 'null';
        if (arg === undefined) return 'undefined';
        if (typeof arg === 'object') {
            try {
                return JSON.stringify(arg);
            } catch (e) {
                return '[Object]';
            }
        }
        return String(arg);
    }

    function detectSource() {
        try {
            throw new Error();
        } catch (e) {
            const stack = e.stack.split('\n')[3];
            const match = stack?.match(/at\s+(?:.+?\s+)?\(?(.+?):(\d+):(\d+)\)?/);
            return match ? match[1].split('/').pop() : 'App';
        }
    }

    // Broadcast mechanisms
    function setupBroadcast() {
        // Method 1: localStorage (cross-tab)
        // Method 2: postMessage (iframe/parent)
        // Method 3: BroadcastChannel (modern browsers)
        
        if (typeof BroadcastChannel !== 'undefined') {
            const channel = new BroadcastChannel('fantrove_console');
            window.__fantroveChannel = channel;
        }
    }

    function broadcast(payload) {
        const data = { type: 'FANTROVE_LOG', payload };

        // Try BroadcastChannel
        if (window.__fantroveChannel) {
            window.__fantroveChannel.postMessage(data);
        }

        // Try localStorage
        try {
            localStorage.setItem('fantrove_broadcast', JSON.stringify(payload));
        } catch (e) {}

        // Try postMessage to opener/parent
        if (window.opener && !window.opener.closed) {
            window.opener.postMessage(data, '*');
        }
    }

    function flushQueue() {
        while (queue.length) {
            broadcast(queue.shift());
        }
    }

    // Public API
    window.FantroveConsole = {
        log: (...args) => sendToFantrove('log', args),
        info: (...args) => sendToFantrove('info', args),
        warn: (...args) => sendToFantrove('warn', args),
        error: (...args) => sendToFantrove('error', args),
        debug: (...args) => sendToFantrove('debug', args),
        success: (...args) => sendToFantrove('success', args),
        
        // Manual error capture
        captureException: (err, context) => {
            sendToFantrove('error', [err.message, err.stack], context || 'Manual');
        }
    };

    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
