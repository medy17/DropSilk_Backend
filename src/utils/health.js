// --- src/utils/health.js ---

import { log } from './logger.js';
import { clients, flights } from '../websocket/state.js';
import { honeypotData } from '../honeypot/state.js';

export function startHealthMonitoring(wss) {
    const healthInterval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                const meta = clients.get(ws);
                log('warn', 'Terminating dead connection (no pong received)', { clientId: meta?.id });
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });

        if (clients.size > 0 || Object.keys(flights).length > 0) {
            log('info', 'Health check completed', {
                activeConnections: clients.size,
                activeFlights: Object.keys(flights).length,
                honeypotVictims: Object.keys(honeypotData).length
            });
        }
    }, 30000);

    return healthInterval; // Return the interval ID so it can be cleared on shutdown
}