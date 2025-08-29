// --- server.js (Main Entry Point) ---

const { server, startServer } = require('./src/httpServer');
const { initializeSignaling } = require('./src/signalingService');
const { setupGracefulShutdown } = require('./src/utils');

// 1. Initialize the WebSocket signaling service and attach it to the HTTP server
initializeSignaling(server);

// 2. Start the HTTP server
startServer();

// 3. Set up listeners for graceful shutdown on SIGINT/SIGTERM
setupGracefulShutdown(server);