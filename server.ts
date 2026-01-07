// --- server.ts (Root Directory) ---

import "dotenv/config";
import yargsParser from "yargs-parser";

// Imports point to ./src/ because this file is in the root
import { server, startServer } from "./src/httpServer";
import { initializeSignaling, closeConnections } from "./src/signalingService";
import { setupGracefulShutdown } from "./src/utils";
import { initializeDatabase } from "./src/dbClient";
import * as state from "./src/state";
import { startCleanupService } from "./src/cleanupService";

// --- GOSSAMER TELEMETRY ---
import { initGossamer, emit } from "./src/gossamer";

interface Args {
    noDB?: boolean;
    [key: string]: unknown;
}

const argv = yargsParser(process.argv.slice(2)) as Args;

async function startApp(): Promise<void> {
    // 1. Initialize Gossamer Telemetry FIRST
    // This ensures that when other services start up, the listeners are ready.
    await initGossamer();

    // 2. Conditionally initialize the database
    if (!argv.noDB) {
        await initializeDatabase();
    }

    // 3. Initialize the WebSocket signaling service
    initializeSignaling(server);

    // 4. Start the HTTP server
    startServer();

    // 5. Set up graceful shutdown
    setupGracefulShutdown(server, closeConnections);

    // 6. Start the server heartbeat
    const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
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

        // Emit heartbeat event
        emit("system:heartbeat", stats);
    }, HEARTBEAT_INTERVAL_MS);

    // 7. Start the cleanup service
    if (!argv.noDB) {
        startCleanupService(60);
    } else {
        emit("cleanup:skipped", {
            reason: "Cleanup service disabled via --noDB flag",
        });
    }
}

startApp().catch((error: Error) => {
    // Failsafe logging
    console.error(
        JSON.stringify({
            level: "ERROR",
            message: "Failed to start application",
            error: error.message,
            stack: error.stack,
        })
    );
    process.exit(1);
});
