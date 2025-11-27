// --- server.js (Root Directory) ---

require("dotenv").config();

// Imports point to ./src/ because this file is in the root
const { server, startServer } = require("./src/httpServer");
const { initializeSignaling, closeConnections } = require("./src/signalingService");
const { setupGracefulShutdown, log } = require("./src/utils");
const { initializeDatabase } = require("./src/dbClient");
const state = require("./src/state");
const { startCleanupService } = require("./src/cleanupService");

// --- TELEMETRY IMPORTS ---
const { initializeTelemetry, eventBus, EVENTS } = require("./src/telemetry");

const argv = require("yargs-parser")(process.argv.slice(2));

async function startApp() {
    // 1. Initialize Telemetry System FIRST
    // This ensures that when other services start up, the listeners are ready.
    initializeTelemetry();

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

        // Emit heartbeat event
        eventBus.emit(EVENTS.SYSTEM.HEARTBEAT, stats);
    }, HEARTBEAT_INTERVAL_MS);

    // 7. Start the cleanup service
    if (!argv.noDB) {
        startCleanupService(60);
    } else {
        eventBus.emit(EVENTS.CLEANUP.SKIPPED, {
            reason: "Cleanup service disabled via --noDB flag",
        });
    }
}

startApp().catch((error) => {
    // Failsafe logging
    log("error", "Failed to start application", {
        error: error.message,
        stack: error.stack,
    });
    process.exit(1);
});