// --- server.js (Main Entry Point) ---
// node server.js --allow-local-port=[port-number] for dev server

const { server, startServer } = require('./src/httpServer');
// Import both initialize and closeConnections from the service
const { initializeSignaling, closeConnections } = require('./src/signalingService');
const { setupGracefulShutdown } = require('./src/utils');

// 1. Initialize the WebSocket signaling service and attach it to the HTTP server
initializeSignaling(server);

// 2. Start the HTTP server
startServer();

// 3. Set up listeners for graceful shutdown on SIGINT/SIGTERM
setupGracefulShutdown(server, closeConnections); // <-- Pass the function here