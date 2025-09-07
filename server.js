// --- server.js (Main Entry Point) ---
// node server.js --allow-local-port=[port-number] for dev server
// Import both initialize and closeConnections from the service

const { server, startServer } = require('./src/httpServer');
const { initializeSignaling, closeConnections } = require('./src/signalingService');
const { setupGracefulShutdown } = require('./src/utils');
const { deleteOldFiles } = require('./src/cleanupService'); // <-- IMPORT THE NEW FUNCTION

// 1. Initialize the WebSocket signaling service and attach it to the HTTP server
initializeSignaling(server);

// 2. Start the HTTP server
startServer();

// 3. Set up listeners for graceful shutdown on SIGINT/SIGTERM
setupGracefulShutdown(server, closeConnections); // <-- Pass the function here

/ --- NEW: SCHEDULE THE CLEANUP JOB ---
// Run the cleanup job once an hour (3600000 milliseconds).
const cleanupInterval = 60 * 60 * 1000;
setInterval(deleteOldFiles, cleanupInterval);

// Optional: Run it once on startup as well, after a short delay.
setTimeout(() => {
    log("info", "[Cleanup] Running initial cleanup job on server start...");
    deleteOldFiles();
}, 10000); // 10-second delay
