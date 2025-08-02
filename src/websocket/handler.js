// --- src/websocket/handler.js ---

import { WebSocket } from 'ws';
import { log } from '../utils/logger.js';
import { getClientIp, isPrivateIP } from '../utils/ip.js';
import { clients, flights } from './state.js';
import { NODE_ENV, allowedOrigins, connectionStats } from '../config.js';


// --- Exported Functions for server.js ---

export function verifyClient(info, done) {
    const origin = info.req.headers.origin;

    if (NODE_ENV === 'production') {
        if (allowedOrigins.has(origin)) {
            log('debug', 'Client origin approved (production)', { origin });
            done(true);
        } else {
            log('warn', 'Client connection rejected due to invalid origin (production)', { origin });
            done(false, 403, 'Forbidden: Invalid Origin');
        }
        return;
    }

    log('info', 'Verifying new client connection (development)', { origin });

    if (allowedOrigins.has(origin) || (origin && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) || !origin) {
        log('debug', 'Client origin approved (dev mode)', { origin });
        done(true);
    } else {
        log('warn', 'Client connection rejected due to invalid origin (development)', { origin });
        done(false, 403, 'Forbidden: Invalid Origin');
    }
}

export function handleConnection(ws, req) {
    let clientId;
    try {
        clientId = Math.random().toString(36).substr(2, 9);
        const metadata = {
            id: clientId,
            name: "Anonymous",
            flightCode: null,
            remoteIp: getClientIp(req),
            connectedAt: new Date().toISOString(),
            userAgent: req.headers['user-agent'] || 'unknown'
        };
        clients.set(ws, metadata);
        connectionStats.totalConnections++;
        log('info', 'Client connected', { clientId, ip: metadata.remoteIp, userAgent: metadata.userAgent, totalClients: clients.size });

        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });

        ws.send(JSON.stringify({ type: "registered", id: clientId }));
        broadcastUsersOnSameNetwork();

        ws.on("message", (message) => handleMessage(ws, message));
        ws.on("close", (code, reason) => handleClose(ws, code, reason));
        ws.on("error", (error) => handleError(ws, error));

    } catch (error) {
        log('error', 'Error during client connection setup', { error: error.message, stack: error.stack, clientId: clientId || 'unknown' });
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close(1011, 'Server error during connection setup');
        }
    }
}


// --- Internal Logic (not exported) ---

function handleMessage(ws, message) {
    let data;
    const meta = clients.get(ws);
    if (!meta) {
        log('warn', 'Received message from unregistered client');
        return;
    }

    try {
        if (message.length > 1024 * 1024) {
            log('warn', 'Message too large', { clientId: meta.id, size: message.length });
            ws.send(JSON.stringify({ type: "error", message: "Message too large" }));
            return;
        }
        data = JSON.parse(message);
        if (!data.type) {
            log('warn', 'Message missing type field', { clientId: meta.id });
            return;
        }
        log('debug', 'Message received', { clientId: meta.id, type: data.type, messageSize: message.length });
    } catch (error) {
        log('error', 'Error parsing message JSON', { clientId: meta.id, error: error.message });
        ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
        return;
    }

    // --- Message Handling Switch (Complete) ---
    try {
        switch (data.type) {
            case "register-details":
                if (!data.name || typeof data.name !== 'string' || data.name.length > 50 || data.name.trim().length === 0) {
                    log('warn', 'Invalid name in registration', { clientId: meta.id, name: data.name });
                    ws.send(JSON.stringify({ type: "error", message: "Invalid name" }));
                    return;
                }
                meta.name = data.name.trim();
                clients.set(ws, meta);
                log('info', 'Client registered details', { clientId: meta.id, newName: meta.name, ip: meta.remoteIp });
                broadcastUsersOnSameNetwork();
                break;
            case "create-flight":
                if (meta.flightCode) {
                    ws.send(JSON.stringify({ type: "error", message: "Already in a flight" }));
                    return;
                }
                const flightCode = Math.random().toString(36).substr(2, 6).toUpperCase();
                flights[flightCode] = [ws];
                meta.flightCode = flightCode;
                connectionStats.totalFlightsCreated++;
                log('info', 'Flight created', { flightCode, creatorId: meta.id });
                ws.send(JSON.stringify({ type: "flight-created", flightCode }));
                broadcastUsersOnSameNetwork();
                break;
            case "join-flight":
                if (!data.flightCode || typeof data.flightCode !== 'string' || data.flightCode.length !== 6) {
                    ws.send(JSON.stringify({ type: "error", message: "Invalid flight code" }));
                    return;
                }
                if (meta.flightCode) {
                    ws.send(JSON.stringify({ type: "error", message: "Already in a flight" }));
                    return;
                }
                const flight = flights[data.flightCode];
                if (!flight || flight.length >= 2) {
                    ws.send(JSON.stringify({ type: "error", message: "Flight not found or full" }));
                    return;
                }
                const creatorWs = flight[0];
                const creatorMeta = clients.get(creatorWs);
                if (!creatorMeta || creatorWs.readyState !== WebSocket.OPEN) {
                    delete flights[data.flightCode];
                    ws.send(JSON.stringify({ type: "error", message: "Flight creator disconnected" }));
                    return;
                }
                let connectionType = 'wan';
                if (isPrivateIP(creatorMeta.remoteIp) && isPrivateIP(meta.remoteIp) && creatorMeta.remoteIp.split('.').slice(0, 3).join('.') === meta.remoteIp.split('.').slice(0, 3).join('.')) {
                    connectionType = 'lan';
                } else if (creatorMeta.remoteIp === meta.remoteIp) {
                    connectionType = 'lan';
                }
                flight.push(ws);
                meta.flightCode = data.flightCode;
                connectionStats.totalFlightsJoined++;
                log('info', 'Flight joined', { flightCode: data.flightCode, joinerId: meta.id, connectionType: connectionType.toUpperCase() });
                ws.send(JSON.stringify({ type: "peer-joined", flightCode: data.flightCode, connectionType, peer: { id: creatorMeta.id, name: creatorMeta.name } }));
                creatorWs.send(JSON.stringify({ type: "peer-joined", flightCode: data.flightCode, connectionType, peer: { id: meta.id, name: meta.name } }));
                broadcastUsersOnSameNetwork();
                break;
            case "invite-to-flight":
                if (!data.inviteeId || !data.flightCode) return;
                for (const [clientWs, clientMeta] of clients.entries()) {
                    if (clientMeta.id === data.inviteeId && clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(JSON.stringify({ type: "flight-invitation", flightCode: data.flightCode, fromName: meta.name, }));
                        break;
                    }
                }
                break;
            case "signal":
                if (!meta.flightCode || !flights[meta.flightCode]) return;
                flights[meta.flightCode].forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: "signal", data: data.data }));
                    }
                });
                break;
            default:
                ws.send(JSON.stringify({ type: "error", message: "Unknown message type" }));
        }
    } catch (error) {
        log('error', 'Error processing WebSocket message in switch', { clientId: meta.id, messageType: data?.type, error: error.message, stack: error.stack });
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "error", message: "Server error processing your request" }));
        }
    }
}

function handleClose(ws, code, reason) {
    const meta = clients.get(ws);
    clients.delete(ws);
    connectionStats.totalDisconnections++;
    if (meta) {
        log('info', 'Client disconnected', { clientId: meta.id, clientName: meta.name, flightCode: meta.flightCode, remainingClients: clients.size });
        if (meta.flightCode && flights[meta.flightCode]) {
            const flight = flights[meta.flightCode];
            const remainingClients = flight.filter((c) => c !== ws);
            flights[meta.flightCode] = remainingClients;
            remainingClients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "peer-left" }));
            });
            if (remainingClients.length === 0) {
                delete flights[meta.flightCode];
                log('info', 'Flight closed', { flightCode: meta.flightCode });
            }
        }
    }
    broadcastUsersOnSameNetwork();
}

function handleError(ws, error) {
    const meta = clients.get(ws);
    log('error', 'WebSocket connection error', { clientId: meta?.id || 'unknown', error: error.message });
}

function broadcastUsersOnSameNetwork() {
    try {
        const clientsByNetworkGroup = {};
        for (const [ws, meta] of clients.entries()) {
            if (!meta || ws.readyState !== WebSocket.OPEN) continue;
            // Don't show users in the "lobby" if they are already in a full flight
            if (meta.flightCode && flights[meta.flightCode]?.length === 2) continue;
            let groupingKey = isPrivateIP(meta.remoteIp) ? meta.remoteIp.split('.').slice(0, 3).join('.') : meta.remoteIp;
            if (!clientsByNetworkGroup[groupingKey]) clientsByNetworkGroup[groupingKey] = [];
            clientsByNetworkGroup[groupingKey].push({ id: meta.id, name: meta.name });
        }
        for (const [ws, meta] of clients.entries()) {
            if (!meta || ws.readyState !== WebSocket.OPEN) continue;
            try {
                // Send an empty list to clients in a full flight
                if (meta.flightCode && flights[meta.flightCode]?.length === 2) {
                    ws.send(JSON.stringify({ type: "users-on-network-update", users: [] }));
                    continue;
                }
                let groupingKey = isPrivateIP(meta.remoteIp) ? meta.remoteIp.split('.').slice(0, 3).join('.') : meta.remoteIp;
                const usersOnNetwork = clientsByNetworkGroup[groupingKey]?.filter((c) => c.id !== meta.id) || [];
                ws.send(JSON.stringify({ type: "users-on-network-update", users: usersOnNetwork }));
            } catch (error) {
                log('error', 'Error sending network update to client', { clientId: meta.id, error: error.message });
            }
        }
    } catch (error) {
        log('error', 'Critical error in broadcastUsersOnSameNetwork', { error: error.message, stack: error.stack });
    }
}