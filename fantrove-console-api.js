/**
 * Fantrove Console API
 * Include this in your main website to send logs to Fantrove Console
 */
(function() {
    'use strict';

    const CONSOLE_URL = '/console.html'; // ปรับ path ตามที่คุณวางไฟล์ console

    function sendToConsole(level, message, meta, source) {
        const payload = {
            level: level,
            message: typeof message === 'object' ? JSON.stringify(message) : String(message),
            meta: meta || null,
            source: source || location.pathname,
            time: Date.now()
        };

        // Method 1: Broadcast via localStorage (works across tabs)
        try {
            localStorage.setItem('fantrove_console_broadcast', JSON.stringify(payload));
        } catch (e) {
            console.warn('Console broadcast failed:', e);
        }

        // Method 2: PostMessage to opener (if console is open in parent window)
        if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: 'FANTROVE_LOG', payload }, '*');
        }

        // Method 3: Try to find console window
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'FANTROVE_LOG', payload }, '*');
        }
    }

    // Main API
    window.FantroveConsole = {
        log: function(message, meta, source) {
            sendToConsole('log', message, meta, source);
        },
        
        error: function(message, meta, source) {
            sendToConsole('error', message, meta, source);
            // Also log to browser console
            console.error('[Fantrove]', message, meta || '');
        },
        
        warn: function(message, meta, source) {
            sendToConsole('warn', message, meta, source);
            console.warn('[Fantrove]', message, meta || '');
        },
        
        info: function(message, meta, source) {
            sendToConsole('info', message, meta, source);
        },
        
        success: function(message, meta, source) {
            sendToConsole('success', message, meta, source);
        },
        
        debug: function(message, meta, source) {
            sendToConsole('debug', message, meta, source);
        },

        // Advanced: Track errors automatically
        initErrorTracking: function() {
            window.onerror = function(msg, url, line, col, error) {
                FantroveConsole.error(msg, { 
                    url: url, 
                    line: line, 
                    col: col, 
                    stack: error?.stack 
                }, 'ErrorHandler');
                return false;
            };

            window.onunhandledrejection = function(event) {
                FantroveConsole.error('Unhandled Promise Rejection', { 
                    reason: event.reason 
                }, 'ErrorHandler');
            };
        }
    };

    // Auto-init error tracking if data attribute exists
    if (document.querySelector('script[data-track-errors]')) {
        window.FantroveConsole.initErrorTracking();
    }
})();
