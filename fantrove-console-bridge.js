/**
 * Fantrove Console Bridge
 * Auto-capture all errors + send custom logs
 * No user event tracking
 */
(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        endpoint: null, // Will auto-detect
        autoCaptureErrors: true,
        autoCaptureNetwork: true,
        debug: false
    };

    // Queue for logs before connection established
    const queue = [];
    let isConnected = false;

    // Initialize immediately
    function init() {
        detectEndpoint();
        
        if (CONFIG.autoCaptureErrors) {
            setupErrorCapture();
        }
        
        if (CONFIG.autoCaptureNetwork) {
            setupNetworkCapture();
        }
        
        setupConnection();
        
        // Flush queue
        isConnected = true;
        flushQueue();
        
        if (CONFIG.debug) {
            console.log('[FantroveBridge] Initialized');
        }
    }

    // Auto-detect console endpoint
    function detectEndpoint() {
        // Try to find console window (popup or parent)
        if (window.opener && window.opener.FantroveConsole) {
            CONFIG.endpoint = window.opener;
        } else if (window.parent !== window && window.parent.FantroveConsole) {
            CONFIG.endpoint = window.parent;
        }
    }

    // Setup comprehensive error capture
    function setupErrorCapture() {
        // Global errors
        window.addEventListener('error', (event) => {
            const errorData = {
                type: 'javascript',
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                error: event.error?.toString(),
                stack: event.error?.stack
            };
            
            send('error', formatError(errorData), errorData, 'ErrorHandler');
            
            // Don't prevent default
            return false;
        });

        // Unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            const errorData = {
                type: 'promise',
                message: event.reason?.message || String(event.reason),
                reason: String(event.reason),
                stack: event.reason?.stack
            };
            
            send('error', formatError(errorData), errorData, 'PromiseRejection');
        });

        // Resource errors (images, scripts, css)
        window.addEventListener('error', (event) => {
            const target = event.target;
            if (target && (target.tagName === 'IMG' || target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
                const errorData = {
                    type: 'resource',
                    tag: target.tagName,
                    src: target.src || target.href
                };
                
                send('error', `Failed to load ${target.tagName}: ${target.src || target.href}`, errorData, 'ResourceLoader');
            }
        }, true);

        // Console error override
        const originalError = console.error;
        console.error = function(...args) {
            originalError.apply(console, args);
            
            // Check if it's an error object
            const error = args.find(arg => arg instanceof Error);
            if (error) {
                send('error', error.message, { 
                    stack: error.stack,
                    type: 'console_error' 
                }, 'Console');
            } else {
                const message = args.map(a => stringify(a)).join(' ');
                if (!isUserEvent(message)) {
                    send('error', message, { type: 'console_error' }, 'Console');
                }
            }
        };
    }

    // Setup network error capture
    function setupNetworkCapture() {
        // Fetch
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
            const url = args[0];
            const options = args[1] || {};
            
            try {
                const response = await originalFetch.apply(this, args);
                
                if (!response.ok) {
                    send('error', `HTTP ${response.status}: ${response.statusText}`, {
                        type: 'http',
                        url: url,
                        method: options.method || 'GET',
                        status: response.status,
                        statusText: response.statusText
                    }, 'Network');
                }
                
                return response;
            } catch (error) {
                send('error', `Network request failed: ${error.message}`, {
                    type: 'network',
                    url: url,
                    method: options.method || 'GET',
                    error: error.message
                }, 'Network');
                
                throw error;
            }
        };

        // XHR
        const originalXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {
            const xhr = new originalXHR();
            let requestUrl = '';
            let requestMethod = 'GET';
            
            xhr.addEventListener('load', function() {
                if (this.status >= 400) {
                    send('error', `XHR ${this.status}: ${this.statusText}`, {
                        type: 'xhr',
                        url: requestUrl,
                        method: requestMethod,
                        status: this.status
                    }, 'Network');
                }
            });
            
            xhr.addEventListener('error', function() {
                send('error', `XHR Request failed`, {
                    type: 'xhr',
                    url: requestUrl,
                    method: requestMethod
                }, 'Network');
            });
            
            const originalOpen = xhr.open;
            xhr.open = function(method, url) {
                requestMethod = method;
                requestUrl = url;
                return originalOpen.apply(this, arguments);
            };
            
            return xhr;
        };
    }

    // Setup connection methods
    function setupConnection() {
        // BroadcastChannel (most reliable)
        if (typeof BroadcastChannel !== 'undefined') {
            window.__fantroveChannel = new BroadcastChannel('fantrove_console');
        }
    }

    // Send log to console
    function send(level, message, meta, source) {
        // Skip user events
        if (isUserEvent(message)) {
            return;
        }

        const payload = {
            level: level,
            message: message,
            source: source || 'App',
            meta: meta || {},
            timestamp: Date.now(),
            url: location.href
        };

        if (!isConnected) {
            queue.push(payload);
            return;
        }

        // Method 1: BroadcastChannel
        if (window.__fantroveChannel) {
            window.__fantroveChannel.postMessage({
                type: 'FANTROVE_LOG',
                payload: payload
            });
        }

        // Method 2: localStorage (cross-tab)
        try {
            localStorage.setItem('fantrove_broadcast', JSON.stringify(payload));
        } catch (e) {}

        // Method 3: postMessage (direct)
        if (CONFIG.endpoint) {
            CONFIG.endpoint.postMessage({
                type: 'FANTROVE_LOG',
                payload: payload
            }, '*');
        }
    }

    function flushQueue() {
        while (queue.length > 0) {
            const payload = queue.shift();
            
            if (window.__fantroveChannel) {
                window.__fantroveChannel.postMessage({
                    type: 'FANTROVE_LOG',
                    payload: payload
                });
            }
            
            try {
                localStorage.setItem('fantrove_broadcast', JSON.stringify(payload));
            } catch (e) {}
        }
    }

    // Helper functions
    function formatError(data) {
        let msg = `[${data.type.toUpperCase()}] ${data.message}`;
        if (data.filename) {
            msg += ` at ${data.filename}:${data.lineno || 0}`;
        }
        return msg;
    }

    function stringify(arg) {
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

    function isUserEvent(text) {
        if (!text) return false;
        const lower = text.toLowerCase();
        const patterns = [
            'scroll', 'touchstart', 'touchend', 'touchmove',
            'mousedown', 'mouseup', 'mousemove', 'click', 'dblclick',
            'keydown', 'keyup', 'keypress', 'resize', 'focus', 'blur',
            'pointerdown', 'pointerup', 'pointermove', 'drag', 'drop',
            'wheel', 'gesture', 'body scroll', 'callback', 'observer',
            'intersection', 'mutation', 'visibilitychange', 'input', 'change'
        ];
        return patterns.some(p => lower.includes(p));
    }

    // Public API
    window.FantroveConsole = {
        log: (msg, meta) => send('log', stringify(msg), meta, 'API'),
        info: (msg, meta) => send('info', stringify(msg), meta, 'API'),
        warn: (msg, meta) => send('warn', stringify(msg), meta, 'API'),
        error: (msg, meta) => send('error', stringify(msg), meta, 'API'),
        debug: (msg, meta) => send('debug', stringify(msg), meta, 'API'),
        success: (msg, meta) => send('success', stringify(msg), meta, 'API'),
        
        // Manual error capture
        captureException: (error, context) => {
            send('error', error.message, {
                stack: error.stack,
                type: 'manual',
                context: context
            }, 'ManualCapture');
        },
        
        // Configuration
        config: (options) => {
            Object.assign(CONFIG, options);
        }
    };

    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
