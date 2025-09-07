// --- server.js (Main Entry Point) ---

const { server, startServer } = require('./src/httpServer');
const { initializeSignaling, closeConnections } = require('./src/signalingService');
const { setupGracefulShutdown } = require('./src/utils');
const { deleteOldFiles } = require('./src/cleanupService'); // <-- IMPORT THE NEW FUNCTION

initializeSignaling(server);

startServer();

setupGracefulShutdown(server, closeConnections);

const cleanupInterval = 60 * 60 * 1000;
setInterval(deleteOldFiles, cleanupInterval);

setTimeout(() => {
    log("info", "[Cleanup] Running initial cleanup job on server start...");
    deleteOldFiles();
}, 10000);