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
    if (!meta) return;

    let data;
    try {
        data = JSON.parse(message);
    } catch (error) {
        log('error', 'Error parsing message JSON', { clientId: meta.id, error: error.message });
        return ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
    }

    // The big switch statement for message routing (omitted for brevity, it's the same as before)
    // IMPORTANT: It now uses state.flights and state.clients instead of global variables.
    // e.g., const flight = state.flights[data.flightCode];
    // --- Paste your original `switch (data.type) { ... }` block here,
    // --- ensuring you replace `flights` with `state.flights` and `clients` with `state.clients`
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
    // This logic remains largely the same, but uses `state.clients` and `state.flights`
    // --- Paste your original `broadcastUsersOnSameNetwork` function here,
    // --- ensuring you replace `flights` with `state.flights` and `clients` with `state.clients`
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