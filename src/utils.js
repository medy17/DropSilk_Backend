// --- src/utils.js ---

const os = require("os");
const config = require("./config");

// --- NEW SELF-CONTAINED LOGGER ---
const logs = new Array(config.MAX_LOG_BUFFER_SIZE);
let logPointer = 0;

function log(level, message, meta = {}) {
    // Create a structured log object
    const logObject = {
        timestamp: new Date().toISOString(),
        level: level.toUpperCase(),
        message,
        ...meta, // Spread the metadata into the top level of the object
    };

    // Convert the object to a JSON string for output
    const logEntry = JSON.stringify(logObject);

    // This is the circular buffer logic. O(1) every time.
    logs[logPointer] = logEntry;
    logPointer = (logPointer + 1) % config.MAX_LOG_BUFFER_SIZE;

    // Output to the console. This is what Render will capture.
    console.log(logEntry);
}

// New function for the /logs endpoint to call
function getLogs() {
    const sortedLogs = [];
    // This "un-rolls" the circular buffer so it's in chronological order for display
    for (let i = 0; i < config.MAX_LOG_BUFFER_SIZE; i++) {
        const log = logs[(logPointer + i) % config.MAX_LOG_BUFFER_SIZE];
        if (log) sortedLogs.push(log);
    }
    return sortedLogs;
}

// --- IP Helpers ---
function getClientIp(req) {
    const rawIp =
        req.headers["x-forwarded-for"]?.split(",").shift() ||
        req.socket.remoteAddress;
    return getCleanIPv4(rawIp);
}

function getCleanIPv4(ip) {
    if (!ip || typeof ip !== "string") return "unknown";
    if (ip.startsWith("::ffff:")) return ip.substring(7);
    if (ip === "::1") return "127.0.0.1";
    return ip;
}

function isPrivateIP(ip) {
    if (!ip || typeof ip !== "string") return false;
    return (
        ip.startsWith("10.") ||
        ip.startsWith("192.168.") ||
        ip.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)
    );
}

function getLocalIpForDisplay() {
    // ... same as original ...
}

// --- Graceful Shutdown ---
function setupGracefulShutdown(server, closeWsConnectionsCallback) {
    // <-- Accept a callback
    const shutdown = () => {
        log("info", "Initiating graceful shutdown...");

        // Use the provided callback function instead of requiring the module
        if (typeof closeWsConnectionsCallback === "function") {
            closeWsConnectionsCallback();
        }

        server.close(() => {
            log("info", "HTTP server closed.");
            process.exit(0);
        });

        setTimeout(() => {
            log("warn", "Forcing shutdown after timeout.");
            process.exit(1);
        }, config.SHUTDOWN_TIMEOUT);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
    process.on("uncaughtException", (error) => {
        log("error", "UNCAUGHT EXCEPTION!", {
            error: error.message,
            stack: error.stack,
        });
        shutdown();
    });
    process.on("unhandledRejection", (reason) => {
        log("error", "UNHANDLED REJECTION!", {
            reason: reason?.toString() || "unknown",
        });
    });
}

module.exports = {
    log,
    getLogs,
    getClientIp,
    getCleanIPv4,
    isPrivateIP,
    getLocalIpForDisplay,
    setupGracefulShutdown,
};