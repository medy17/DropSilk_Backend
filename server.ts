// --- server.ts (Root Directory) ---

import dotenv from "dotenv";
dotenv.config();

// CORRECTED PATHS: All local imports now point to './src/...'
import { server, startServer } from "./src/httpServer";
import {
    initializeSignaling,
    closeConnections,
} from "./src/signalingService";
import { setupGracefulShutdown, log } from "./src/utils";
import db from "./src/dbClient";
import state from "./src/state";
import { startCleanupService } from "./src/cleanupService";
import { initializeTelemetry, eventBus, EVENTS } from "./src/telemetry";
import yargsParser from "yargs-parser";

const argv = yargsParser(process.argv.slice(2));

async function startApp() {
    initializeTelemetry();

    if (!argv.noDB) {
        await db.initializeDatabase();
    }

    initializeSignaling(server);
    startServer();
    setupGracefulShutdown(server, closeConnections);

    const HEARTBEAT_INTERVAL_MS = 60 * 1000;
    setInterval(() => {
        const memoryUsage = process.memoryUsage();
        const stats = {
            activeConnections: state.clients.size,
            activeFlights: Object.keys(state.flights).length,
            uptimeSeconds: Math.floor(process.uptime()),
            memoryRssMb: Math.round(memoryUsage.rss / 1024 / 1024),
            memoryHeapTotalMb: Math.round(memoryUsage.heapTotal / 1024 / 1024),
            memoryHeapUsedMb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        };
        eventBus.emit(EVENTS.SYSTEM.HEARTBEAT, stats);
    }, HEARTBEAT_INTERVAL_MS);

    if (!argv.noDB) {
        startCleanupService(60);
    } else {
        eventBus.emit(EVENTS.CLEANUP.SKIPPED, {
            reason: "Cleanup service disabled via --noDB flag",
        });
    }
}

startApp().catch((error: any) => {
    log("error", "Failed to start application", {
        error: error.message,
        stack: error.stack,
    });
    process.exit(1);
});