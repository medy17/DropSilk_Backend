// --- server.js (Main Entry Point) ---

// --- Node.js Built-in Modules ---
import http from 'http';
import { WebSocketServer } from 'ws';

// --- Application Modules ---
import { PORT, NODE_ENV, SERVER_IP } from './src/config.js';
import { log } from './src/utils/logger.js';
import { getLocalIpForDisplay } from './src/utils/ip.js';
import { requestListener } from './src/httpRouter.js';
import { handleConnection, verifyClient } from './src/websocket/handler.js';
import { startHealthMonitoring } from './src/utils/health.js';
import { setupGracefulShutdown } from './src/utils/shutdown.js';

// --- HTTP Server Creation ---
const server = http.createServer(requestListener);

// --- WebSocket Server Creation ---
const wss = new WebSocketServer({
    server,
    verifyClient,
    perMessageDeflate: false,
    maxPayload: 1024 * 1024,
    clientTracking: true,
});

// --- Attach Event Handlers ---
server.on('error', (error) => {
    log('error', 'HTTP server critical error', { error: error.message, code: error.code });
    if (error.code === 'EADDRINUSE') {
        log('error', `Port ${PORT} is already in use`);
        process.exit(1);
    }
});

wss.on('error', (error) => {
    log('error', 'WebSocket server error', { error: error.message, stack: error.stack });
});

// Pass the 'handleConnection' function to the connection event
wss.on('connection', handleConnection);

// --- Start Services & Server ---
const healthInterval = startHealthMonitoring(wss);
setupGracefulShutdown(server, wss, healthInterval);

server.listen(PORT, SERVER_IP, () => {
    log('info', `🚀 Signalling Server started`, {
        port: PORT,
        environment: NODE_ENV,
        localIp: getLocalIpForDisplay(),
        healthCheck: `http://localhost:${PORT}`
    });
});