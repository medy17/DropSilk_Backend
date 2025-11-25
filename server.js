// --- server.js (Main Entry Point) ---

require("dotenv").config();

// node server.js --allow-local-port=[port-number] for dev server

const { server, startServer } = require("./src/httpServer");
// Import both initialize and closeConnections from the service
const {
    initializeSignaling,
    closeConnections,
} = require("./src/signalingService");
const { setupGracefulShutdown, log } = require("./src/utils");
const { initializeDatabase } = require("./src/dbClient");
const state = require("./src/state"); // <-- Import the application state
const { startCleanupService } = require("./src/cleanupService");

const argv = require("yargs-parser")(process.argv.slice(2));

// Wrap the startup in an async function to handle promises
async function startApp() {
    // 1. Conditionally initialize the database
    if (!argv.noDB) {
        await initializeDatabase();
    }

    // 2. Initialize the WebSocket signaling service and attach it to the HTTP server
    initializeSignaling(server);

    // 3. Start the HTTP server
    startServer();

    // 4. Set up listeners for graceful shutdown on SIGINT/SIGTERM
    setupGracefulShutdown(server, closeConnections); // <-- Pass the function here

    // --- NEW: Start the server heartbeat for dashboarding ---
    const HEARTBEAT_INTERVAL_MS = 60 * 1000; // Log stats every 60 seconds
    setInterval(() => {
        const memoryUsage = process.memoryUsage();
        const stats = {
            activeConnections: state.clients.size,
            activeFlights: Object.keys(state.flights).length,
            uptimeSeconds: Math.floor(process.uptime()),
            // Memory usage in MB for easier graphing
            memoryRssMb: Math.round(memoryUsage.rss / 1024 / 1024),
            memoryHeapTotalMb: Math.round(memoryUsage.heapTotal / 1024 / 1024),
            memoryHeapUsedMb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        };

        // This is the golden log entry for your dashboards
        log("info", "server_heartbeat", stats);
    }, HEARTBEAT_INTERVAL_MS);

    // 5. Start the cleanup service to run every 60 minutes (only if DB enabled)
    if (!argv.noDB) {
        startCleanupService(60);
    } else {
        log(
            "info",
            "🧹 Cleanup service disabled via --noDB flag.",
        );
    }
}

startApp().catch((error) => {
    // Use our logger here! If the logger itself fails, it'll fall back to console
    // This ensures catastrophic startup failures are captured.
    log("error", "Failed to start application", { error: error.message, stack: error.stack });
    process.exit(1);
});