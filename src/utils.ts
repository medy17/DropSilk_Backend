// --- src/utils.ts ---

import os from "os";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import config from "./config";

// --- IP Helpers ---
export function getClientIp(req: IncomingMessage): string {
    const forwardedFor = req.headers["x-forwarded-for"];
    const rawIp =
        (typeof forwardedFor === "string"
            ? forwardedFor.split(",").shift()
            : undefined) || req.socket.remoteAddress;
    return getCleanIPv4(rawIp);
}

export function getCleanIPv4(ip: string | undefined): string {
    if (!ip || typeof ip !== "string") return "unknown";
    if (ip.startsWith("::ffff:")) return ip.substring(7);
    if (ip === "::1") return "127.0.0.1";
    return ip;
}

export function isPrivateIP(ip: string | undefined): boolean {
    if (!ip || typeof ip !== "string") return false;
    return (
        ip.startsWith("10.") ||
        ip.startsWith("192.168.") ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)
    );
}

export function getLocalIpForDisplay(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        const ifaces = interfaces[name];
        if (!ifaces) continue;
        for (const iface of ifaces) {
            if (iface.family === "IPv4" && !iface.internal) {
                return iface.address;
            }
        }
    }
    return "127.0.0.1";
}

// --- Graceful Shutdown ---
export function setupGracefulShutdown(
    server: Server,
    closeWsConnectionsCallback?: () => void
): void {
    // Dynamic import to avoid circular dependency at module load time
    const shutdown = async (): Promise<void> => {
        const { emit, flush } = await import("./gossamer");

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
