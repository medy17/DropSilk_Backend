// --- src/utils/shutdown.js ---
import { WebSocket } from 'ws';
import { log } from './logger.js';

function initiateShutdown(server, wss, healthInterval) {
    log('info', 'Initiating graceful shutdown...');
    clearInterval(healthInterval); // Stop health checks

    // Notify all connected clients
    wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "server-shutdown", message: "Server is shutting down for maintenance." }));
            ws.close(1001, 'Server shutdown');
        }
    });

    // Close the HTTP server
    server.close(() => {
        log('info', 'HTTP server and WebSocket server closed.');
        process.exit(0);
    });

    // Force exit after a timeout
    setTimeout(() => {
        log('warn', 'Forcing shutdown after timeout due to unresponsive connections.');
        process.exit(1);
    }, 10000);
}

export function setupGracefulShutdown(server, wss, healthInterval) {
    const shutdown = () => initiateShutdown(server, wss, healthInterval);

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    process.on('uncaughtException', (error) => {
        log('error', 'UNCAUGHT EXCEPTION!', { error: error.message, stack: error.stack });
        shutdown();
    });
    process.on('unhandledRejection', (reason) => {
        log('error', 'UNHANDLED REJECTION!', { reason: reason?.toString() || 'unknown' });
    });
}