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
    console.error("🚨 Failed to start application:", error);
    process.exit(1);
});