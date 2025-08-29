// --- src/utils.js ---

const os = require('os');
const config = require('./config');

// --- Logging ---
function log(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length > 0 ? ` | ${JSON.stringify(meta)}` : '';
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;

    // We require these here inside the function to avoid potential circular dependency issues at startup.
    const { logs } = require('./state');
    const { MAX_LOG_BUFFER_SIZE } = require('./config');

    // 1. Add the new log entry to our in-memory buffer
    logs.push(logEntry);

    // 2. Trim the buffer if it exceeds the max size (acts as a circular buffer)
    if (logs.length > MAX_LOG_BUFFER_SIZE) {
        logs.shift(); // Removes the oldest log entry from the beginning of the array
    }

    // 3. Output to the console as usual
    console.log(logEntry);
}


// --- IP Helpers ---
function getClientIp(req) {
    const rawIp = req.headers['x-forwarded-for']?.split(',').shift() || req.socket.remoteAddress;
    return getCleanIPv4(rawIp);
}

function getCleanIPv4(ip) {
    if (!ip || typeof ip !== 'string') return 'unknown';
    if (ip.startsWith('::ffff:')) return ip.substring(7);
    if (ip === '::1') return '127.0.0.1';
    return ip;
}

function isPrivateIP(ip) {
    if (!ip || typeof ip !== 'string') return false;
    return ip.startsWith('10.') || ip.startsWith('192.168.') || ip.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./);
}

function getLocalIpForDisplay() {
    // ... same as original ...
}


// --- Graceful Shutdown ---
function setupGracefulShutdown(server, closeWsConnectionsCallback) { // <-- Accept a callback
    const shutdown = () => {
        log('info', 'Initiating graceful shutdown...');

        // Use the provided callback function instead of requiring the module
        if (typeof closeWsConnectionsCallback === 'function') {
            closeWsConnectionsCallback();
        }

        server.close(() => {
            log('info', 'HTTP server closed.');
            process.exit(0);
        });

        setTimeout(() => {
            log('warn', 'Forcing shutdown after timeout.');
            process.exit(1);
        }, config.SHUTDOWN_TIMEOUT);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    process.on('uncaughtException', (error) => {
        log('error', 'UNCAUGHT EXCEPTION!', { error: error.message, stack: error.stack });
        shutdown();
    });
    process.on('unhandledRejection', (reason) => {
        log('error', 'UNHANDLED REJECTION!', { reason: reason?.toString() || 'unknown' });
    });
}


module.exports = {
    log,
    getClientIp,
    getCleanIPv4,
    isPrivateIP,
    getLocalIpForDisplay,
    setupGracefulShutdown,
};