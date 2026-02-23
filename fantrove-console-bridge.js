/**
 * Fantrove Console Bridge
 * Clean API - No user behavior tracking
 */
(function() {
    'use strict';
    
    // Initialize immediately
    function init() {
        hijackConsole();
        hijackErrors();
    }
    
    // Hijack native console - clean version
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
    
    // Hijack only critical errors
    function hijackErrors() {
        window.addEventListener('error', (e) => {
            sendToFantrove('error', [{
                message: e.message,
                filename: e.filename,
                lineno: e.lineno,
                error: e.error?.toString()
            }], 'Exception');
        });
        
        window.addEventListener('unhandledrejection', (e) => {
            sendToFantrove('error', [e.reason], 'UnhandledRejection');
        });
    }
    
    // Send to console
    function sendToFantrove(level, args, source) {
        const message = args.map(formatArg).join(' ');
        
        // Skip user behavior logs
        const skipPatterns = ['scroll', 'touch', 'mouse', 'click', 'key', 'resize',
            'pointer', 'drag', 'gesture', 'wheel', 'mousemove',
            'Body scroll', 'callback', 'observer', 'mutation'
        ];
        
        if (skipPatterns.some(p => message.toLowerCase().includes(p.toLowerCase()))) {
            return;
        }
        
        const payload = {
            level: level,
            message: message,
            source: source || 'App',
            timestamp: Date.now()
        };
        
        // Broadcast
        try {
            localStorage.setItem('fantrove_broadcast', JSON.stringify(payload));
        } catch (e) {}
        
        if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: 'FANTROVE_LOG', payload }, '*');
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
    
    // Public API
    window.FantroveConsole = {
        log: (...args) => sendToFantrove('log', args),
        info: (...args) => sendToFantrove('info', args),
        warn: (...args) => sendToFantrove('warn', args),
        error: (...args) => sendToFantrove('error', args),
        debug: (...args) => sendToFantrove('debug', args),
        success: (...args) => sendToFantrove('success', args)
    };
    
    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();