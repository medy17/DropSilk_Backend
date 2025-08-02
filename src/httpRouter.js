// --- src/httpRouter.js ---

import { handleHoneypotRequest } from './honeypot/handler.js';
import { getClientIp } from './utils/ip.js';
import { log } from './utils/logger.js';
import { clients, flights } from './websocket/state.js';
import { honeypotData } from './honeypot/state.js';

export function requestListener(req, res) {
    try {
        const clientIp = getClientIp(req);

        // First, let the honeypot handler try to process the request
        const isHoneypotRequest = handleHoneypotRequest(req, res, clientIp);
        if (isHoneypotRequest) {
            return; // The honeypot handler has taken over and will send the response
        }

        // --- Standard Server Routes ---
        if (req.method === 'GET' && req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Server is alive and waiting for WebSocket connections.');
            log('info', 'Health check accessed', { ip: clientIp });

        } else if (req.method === 'GET' && req.url === '/stats') {
            const stats = {
                activeConnections: clients.size,
                activeFlights: Object.keys(flights).length,
                honeypotVictims: Object.keys(honeypotData).length,
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                timestamp: new Date().toISOString()
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(stats, null, 2));
            log('info', 'Stats endpoint accessed', { ip: clientIp });

        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        }

    } catch (error) {
        log('error', 'HTTP server error in request handler', { error: error.message, stack: error.stack, url: req.url });
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
        }
        res.end('Internal Server Error');
    }
}