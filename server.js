// --- server.js (Main Entry Point) ---

const { server, startServer } = require('./src/httpServer');
const { initializeSignaling, closeConnections } = require('./src/signalingService');
// Corrected import to include the 'log' function
const { setupGracefulShutdown, log } = require('./src/utils');
const { deleteOldFiles } = require('./src/cleanupService');

// 1. Initialize the WebSocket signaling service
initializeSignaling(server);

// 2. Start the HTTP server
startServer();

// 3. Set up listeners for graceful shutdown
setupGracefulShutdown(server, closeConnections);

// Run the cleanup job once an hour (3600000 milliseconds).
const cleanupInterval = 60 * 60 * 1000;
setInterval(deleteOldFiles, cleanupInterval);

// Optional: Run it once on startup as well, after a short delay.
setTimeout(() => {
    // This line will now work because 'log' has been imported.
    log("info", "[Cleanup] Running initial cleanup job on server start...");
    deleteOldFiles();
}, 10000); // 10-second delay