"use strict";
// --- src/utils.ts ---
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getClientIp = getClientIp;
exports.getCleanIPv4 = getCleanIPv4;
exports.isPrivateIP = isPrivateIP;
exports.getLocalIpForDisplay = getLocalIpForDisplay;
exports.setupGracefulShutdown = setupGracefulShutdown;
const os_1 = __importDefault(require("os"));
const config_1 = __importDefault(require("./config"));
// --- IP Helpers ---
function getClientIp(req) {
    const forwardedFor = req.headers["x-forwarded-for"];
    const rawIp = (typeof forwardedFor === "string"
        ? forwardedFor.split(",").shift()
        : undefined) || req.socket.remoteAddress;
    return getCleanIPv4(rawIp);
}
function getCleanIPv4(ip) {
    if (!ip || typeof ip !== "string")
        return "unknown";
    if (ip.startsWith("::ffff:"))
        return ip.substring(7);
    if (ip === "::1")
        return "127.0.0.1";
    return ip;
}
function isPrivateIP(ip) {
    if (!ip || typeof ip !== "string")
        return false;
    return (ip.startsWith("10.") ||
        ip.startsWith("192.168.") ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip));
}
function getLocalIpForDisplay() {
    const interfaces = os_1.default.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        const ifaces = interfaces[name];
        if (!ifaces)
            continue;
        for (const iface of ifaces) {
            if (iface.family === "IPv4" && !iface.internal) {
                return iface.address;
            }
        }
    }
    return "127.0.0.1";
}
// --- Graceful Shutdown ---
function setupGracefulShutdown(server, closeWsConnectionsCallback) {
    // Dynamic import to avoid circular dependency at module load time
    const shutdown = async () => {
        const { emit, flush } = await Promise.resolve().then(() => __importStar(require("./gossamer")));
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
        }, config_1.default.SHUTDOWN_TIMEOUT);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
    // Note: uncaughtException and unhandledRejection are now handled by Gossamer's captureCrashes
}
//# sourceMappingURL=utils.js.map