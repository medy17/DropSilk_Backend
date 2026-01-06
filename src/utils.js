// --- src/utils.js ---

const os = require("os");
const config = require("./config");

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
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === "IPv4" && !iface.internal) {
                return iface.address;
            }
        }
    }
    return "127.0.0.1";
}

// --- Graceful Shutdown ---
function setupGracefulShutdown(server, closeWsConnectionsCallback) {
    const { emit, flush } = require("./gossamer");

    const shutdown = async () => {
        emit("system:shutdown", { message: "Initiating graceful shutdown..." });

        // Use the provided callback function instead of requiring the module
        if (typeof closeWsConnectionsCallback === "function") {
            closeWsConnectionsCallback();
        }

        // Flush Gossamer transports before exiting
        await flush();

        server.close(() => {
            process.exit(0);
        });

        setTimeout(() => {
            process.exit(1);
        }, config.SHUTDOWN_TIMEOUT);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
    // Note: uncaughtException and unhandledRejection are now handled by Gossamer's captureCrashes
}

module.exports = {
    getClientIp,
    getCleanIPv4,
    isPrivateIP,
    getLocalIpForDisplay,
    setupGracefulShutdown,
};