// --- src/signalingService.js ---

const WebSocket = require("ws");
const config = require('./config');
const state = require('./state'); // The magic of dependency injection!
const { log, getClientIp, isPrivateIP } = require('./utils');

let wss; // Will be initialized
let healthInterval; // For the ping/pong interval

function initializeSignaling(server) {
    wss = new WebSocket.Server({
        server,
        verifyClient,
        perMessageDeflate: false,
        maxPayload: config.MAX_PAYLOAD,
        clientTracking: true
    });

    wss.on('error', (error) => {
        log('error', 'WebSocket server error', { error: error.message, stack: error.stack });
    });

    wss.on("connection", handleConnection);

    startHealthChecks();

    log('info', 'Signaling Service Initialized');
    return wss;
}

function verifyClient(info, done) {
    const origin = info.req.headers.origin;

    if (config.NODE_ENV === 'production') {
        if (config.ALLOWED_ORIGINS.has(origin)) {
            done(true);
        } else {
            log('warn', 'Client connection rejected due to invalid origin (production)', { origin });
            done(false, 403, 'Forbidden: Invalid Origin');
        }
        return;
    }

    // Development mode allows localhost, etc.
    if (config.ALLOWED_ORIGINS.has(origin) || (origin && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) || !origin) {
        done(true);
    } else {
        log('warn', 'Client connection rejected due to invalid origin (development)', { origin });
        done(false, 403, 'Forbidden: Invalid Origin');
    }
}


function handleConnection(ws, req) {
    // Connection setup and event listeners
    const clientId = Math.random().toString(36).substr(2, 9);
    const cleanRemoteIp = getClientIp(req);

    const metadata = {
        id: clientId,
        name: "Anonymous",
        flightCode: null,
        remoteIp: cleanRemoteIp,
        connectedAt: new Date().toISOString(),
        userAgent: req.headers['user-agent'] || 'unknown'
    };

    state.clients.set(ws, metadata);
    state.connectionStats.totalConnections++;
    log('info', 'Client connected', { clientId, ip: cleanRemoteIp, totalClients: state.clients.size });

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.send(JSON.stringify({ type: "registered", id: clientId }));
    broadcastUsersOnSameNetwork();

    ws.on("message", (message) => handleMessage(ws, message));
    ws.on("close", () => handleDisconnect(ws));
    ws.on("error", (error) => log('error', 'WebSocket connection error', { clientId: metadata.id, error: error.message }));
}

function handleMessage(ws, message) {
    const meta = state.clients.get(ws);
    if (!meta) {
        log('warn', 'Received message from unregistered client');
        return;
    }

    let data;
    try {
        if (message.length > config.MAX_PAYLOAD) {
            log('warn', 'Message too large', { clientId: meta.id, size: message.length });
            ws.send(JSON.stringify({ type: "error", message: "Message too large" }));
            return;
        }
        data = JSON.parse(message);
        if (!data.type) {
            log('warn', 'Message missing type field', { clientId: meta.id });
            return;
        }
        log('debug', 'Message received', { clientId: meta.id, type: data.type });
    } catch (error) {
        log('error', 'Error parsing message JSON', { clientId: meta.id, error: error.message });
        ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
        return;
    }

    try {
        switch (data.type) {
            case "register-details":
                if (!data.name || typeof data.name !== 'string' || data.name.length > 50 || data.name.trim().length === 0) {
                    ws.send(JSON.stringify({ type: "error", message: "Invalid name" }));
                    return;
                }
                meta.name = data.name.trim();
                state.clients.set(ws, meta); // Use state.clients
                log('info', 'Client registered details', { clientId: meta.id, newName: meta.name });
                broadcastUsersOnSameNetwork();
                break;
            case "create-flight":
                if (meta.flightCode) {
                    ws.send(JSON.stringify({ type: "error", message: "Already in a flight" }));
                    return;
                }
                const flightCode = Math.random().toString(36).substr(2, 6).toUpperCase();
                state.flights[flightCode] = [ws]; // <-- THE FIX
                meta.flightCode = flightCode;
                state.connectionStats.totalFlightsCreated++;
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
                const flight = state.flights[data.flightCode]; // <-- THE FIX
                if (!flight || flight.length >= 2) {
                    ws.send(JSON.stringify({ type: "error", message: "Flight not found or full" }));
                    return;
                }
                const creatorWs = flight[0];
                const creatorMeta = state.clients.get(creatorWs); // <-- THE FIX
                if (!creatorMeta || creatorWs.readyState !== WebSocket.OPEN) {
                    delete state.flights[data.flightCode]; // <-- THE FIX
                    ws.send(JSON.stringify({ type: "error", message: "Flight creator disconnected" }));
                    return;
                }
                // ... (LAN/WAN detection logic is fine)
                flight.push(ws);
                meta.flightCode = data.flightCode;
                state.connectionStats.totalFlightsJoined++;
                log('info', 'Flight joined', { flightCode: data.flightCode, joinerId: meta.id });
                ws.send(JSON.stringify({ type: "peer-joined", flightCode: data.flightCode, peer: { id: creatorMeta.id, name: creatorMeta.name } }));
                creatorWs.send(JSON.stringify({ type: "peer-joined", flightCode: data.flightCode, peer: { id: meta.id, name: meta.name } }));
                broadcastUsersOnSameNetwork();
                break;
            case "invite-to-flight":
                if (!data.inviteeId || !data.flightCode) return;
                for (const [clientWs, clientMeta] of state.clients.entries()) { // <-- THE FIX
                    if (clientMeta.id === data.inviteeId && clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(JSON.stringify({ type: "flight-invitation", flightCode: data.flightCode, fromName: meta.name, }));
                        break;
                    }
                }
                break;
            case "signal":
                if (!meta.flightCode || !state.flights[meta.flightCode]) return; // <-- THE FIX
                state.flights[meta.flightCode].forEach((client) => { // <-- THE FIX
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: "signal", data: data.data }));
                    }
                });
                break;
            default:
                ws.send(JSON.stringify({ type: "error", message: "Unknown message type" }));
        }
    } catch (error) {
        log('error', 'Error processing WebSocket message in switch', { clientId: meta.id, messageType: data?.type, error: error.message });
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "error", message: "Server error processing your request" }));
        }
    }
}

function handleDisconnect(ws) {
    const meta = state.clients.get(ws);
    if (!meta) return;

    state.clients.delete(ws);
    state.connectionStats.totalDisconnections++;
    log('info', 'Client disconnected', { clientId: meta.id, remainingClients: state.clients.size });

    if (meta.flightCode && state.flights[meta.flightCode]) {
        const flight = state.flights[meta.flightCode];
        state.flights[meta.flightCode] = flight.filter((c) => c !== ws);

        state.flights[meta.flightCode].forEach((client) => {
            if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "peer-left" }));
        });

        if (state.flights[meta.flightCode].length === 0) {
            delete state.flights[meta.flightCode];
            log('info', 'Flight closed', { flightCode: meta.flightCode });
        }
    }
    broadcastUsersOnSameNetwork();
}

function broadcastUsersOnSameNetwork() {
    try {
        const clientsByNetworkGroup = {};
        for (const [ws, meta] of state.clients.entries()) { // <-- THE FIX
            if (!meta || ws.readyState !== WebSocket.OPEN) continue;
            // Don't show users who are already paired up
            if (meta.flightCode && state.flights[meta.flightCode] && state.flights[meta.flightCode].length === 2) continue; // <-- THE FIX

            // Group by public IP, or by /24 subnet for private IPs
            let groupingKey = isPrivateIP(meta.remoteIp) ? meta.remoteIp.split('.').slice(0, 3).join('.') : meta.remoteIp;
            if (!clientsByNetworkGroup[groupingKey]) clientsByNetworkGroup[groupingKey] = [];
            clientsByNetworkGroup[groupingKey].push({ id: meta.id, name: meta.name });
        }

        for (const [ws, meta] of state.clients.entries()) { // <-- THE FIX
            if (!meta || ws.readyState !== WebSocket.OPEN) continue;

            // Send an empty list to users who are already paired
            if (meta.flightCode && state.flights[meta.flightCode] && state.flights[meta.flightCode].length === 2) { // <-- THE FIX
                ws.send(JSON.stringify({ type: "users-on-network-update", users: [] }));
                continue;
            }

            let groupingKey = isPrivateIP(meta.remoteIp) ? meta.remoteIp.split('.').slice(0, 3).join('.') : meta.remoteIp;
            const usersOnNetwork = clientsByNetworkGroup[groupingKey] ? clientsByNetworkGroup[groupingKey].filter((c) => c.id !== meta.id) : [];
            ws.send(JSON.stringify({ type: "users-on-network-update", users: usersOnNetwork }));
        }
    } catch (error) {
        log('error', 'Critical error in broadcastUsersOnSameNetwork', { error: error.message });
    }
}


function startHealthChecks() {
    healthInterval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                const meta = state.clients.get(ws);
                log('warn', 'Terminating dead connection (no pong received)', { clientId: meta?.id });
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });
    }, config.HEALTH_CHECK_INTERVAL);
}

function closeConnections() {
    log('info', 'Closing all WebSocket connections for shutdown...');
    clearInterval(healthInterval);
    wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "server-shutdown", message: "Server is shutting down for maintenance." }));
            ws.close(1001, 'Server shutdown');
        }
    });
}

module.exports = { initializeSignaling, closeConnections };