// --- src/utils.ts ---

import os from "os";
import config from "./config";
import type { IncomingMessage, Server } from "http";

const logs: string[] = new Array(config.MAX_LOG_BUFFER_SIZE);
let logPointer = 0;

export function log(
    level: string,
    message: string,
    meta: Record<string, any> = {},
) {
    const logObject = {
        timestamp: new Date().toISOString(),
        level: level.toUpperCase(),
        message,
        ...meta,
    };
    const logEntry = JSON.stringify(logObject);
    logs[logPointer] = logEntry;
    logPointer = (logPointer + 1) % config.MAX_LOG_BUFFER_SIZE;
    console.log(logEntry);
}

export function getLogs(): string[] {
    const sortedLogs: string[] = [];
    for (let i = 0; i < config.MAX_LOG_BUFFER_SIZE; i++) {
        const log = logs[(logPointer + i) % config.MAX_LOG_BUFFER_SIZE];
        if (log) sortedLogs.push(log);
    }
    return sortedLogs;
}

export function getClientIp(req: IncomingMessage): string {
    const xForwardedFor = req.headers["x-forwarded-for"];
    const rawIp =
        (Array.isArray(xForwardedFor)
            ? xForwardedFor[0]
            : xForwardedFor?.split(",").shift()) || req.socket.remoteAddress;
    return getCleanIPv4(rawIp);
}

export function getCleanIPv4(ip?: string): string {
    if (!ip) return "unknown";
    if (ip.startsWith("::ffff:")) return ip.substring(7);
    if (ip === "::1") return "127.0.0.1";
    return ip;
}

export function isPrivateIP(ip?: string): boolean {
    if (!ip) return false;
    return (
        ip.startsWith("10.") ||
        ip.startsWith("192.168.") ||
        !!ip.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)
    );
}

export function getLocalIpForDisplay(): string {
    const interfaces = os.networkInterfaces();
    for (const name in interfaces) {
        const ifaceGroup = interfaces[name];
        if (!ifaceGroup) continue;
        for (const iface of ifaceGroup) {
            if (iface.family === "IPv4" && !iface.internal) {
                return iface.address;
            }
        }
    }
    return "127.0.0.1";
}

export function setupGracefulShutdown(
    server: Server,
    closeWsConnectionsCallback: () => void,
) {
    const shutdown = () => {
        log("info", "Initiating graceful shutdown...");

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
    process.on("uncaughtException", (error: Error) => {
        log("error", "UNCAUGHT EXCEPTION!", {
            error: error.message,
            stack: error.stack,
        });
        shutdown();
    });
    process.on("unhandledRejection", (reason: any) => {
        log("error", "UNHANDLED REJECTION!", {
            reason: reason?.toString() || "unknown",
        });
    });
}