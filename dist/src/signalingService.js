"use strict";
// --- src/signalingService.ts ---
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeSignaling = initializeSignaling;
exports.closeConnections = closeConnections;
const ws_1 = __importStar(require("ws"));
const config_1 = __importDefault(require("./config"));
const state = __importStar(require("./state"));
const utils_1 = require("./utils");
const gossamer_1 = require("./gossamer");
let wss;
let healthInterval;
function initializeSignaling(server) {
    wss = new ws_1.WebSocketServer({
        server,
        verifyClient,
        perMessageDeflate: false,
        maxPayload: config_1.default.MAX_PAYLOAD,
        clientTracking: true,
    });
    wss.on("error", (error) => {
        (0, gossamer_1.emit)("client:error", {
            context: "WebSocket server error",
            error: error.message,
            stack: error.stack,
        });
    });
    wss.on("connection", handleConnection);
    startHealthChecks();
    (0, gossamer_1.emit)("system:startup", { service: "Signaling Service" });
    return wss;
}
function verifyClient(info, done) {
    const origin = info.req.headers.origin;
    if (config_1.default.NODE_ENV === "production") {
        const isAllowed = (origin && config_1.default.ALLOWED_ORIGINS.has(origin)) ||
            (origin && config_1.default.VERCEL_PREVIEW_ORIGIN_REGEX.test(origin));
        if (isAllowed) {
            done(true);
        }
        else {
            (0, gossamer_1.emit)("client:error", {
                context: "Connection rejected (invalid origin)",
                origin,
                ip: (0, utils_1.getClientIp)(info.req),
            });
            done(false, 403, "Forbidden: Invalid Origin");
        }
        return;
    }
    if ((origin && config_1.default.ALLOWED_ORIGINS.has(origin)) || !origin) {
        done(true);
    }
    else {
        (0, gossamer_1.emit)("client:error", {
            context: "Connection rejected (development origin check)",
            origin,
            ip: (0, utils_1.getClientIp)(info.req),
        });
        done(false, 403, "Forbidden: Invalid Origin");
    }
}
function handleConnection(ws, req) {
    const extWs = ws;
    const clientId = Math.random().toString(36).substr(2, 9);
    const cleanRemoteIp = (0, utils_1.getClientIp)(req);
    const metadata = {
        id: clientId,
        name: "Anonymous",
        flightCode: null,
        remoteIp: cleanRemoteIp,
        connectedAt: new Date().toISOString(),
        userAgent: req.headers["user-agent"] || "unknown",
    };
    state.clients.set(ws, metadata);
    state.connectionStats.totalConnections++;
    // EMIT: Client Connected
    (0, gossamer_1.emit)("client:connected", {
        clientId,
        ip: cleanRemoteIp,
        totalClients: state.clients.size,
    });
    extWs.isAlive = true;
    ws.on("pong", () => {
        extWs.isAlive = true;
    });
    ws.send(JSON.stringify({ type: "registered", id: clientId }));
    broadcastUsersOnSameNetwork();
    ws.on("message", (message) => handleMessage(ws, message));
    ws.on("close", () => handleDisconnect(ws));
    ws.on("error", (error) => (0, gossamer_1.emit)("client:error", {
        clientId: metadata.id,
        error: error.message,
    }));
}
function handleMessage(ws, message) {
    const meta = state.clients.get(ws);
    if (!meta) {
        // Silently ignore or emit warn if desired
        return;
    }
    let data;
    try {
        const messageStr = message.toString();
        if (messageStr.length > config_1.default.MAX_PAYLOAD) {
            (0, gossamer_1.emit)("client:error", {
                clientId: meta.id,
                context: "Message too large",
                size: messageStr.length,
            });
            ws.send(JSON.stringify({ type: "error", message: "Message too large" }));
            return;
        }
        data = JSON.parse(messageStr);
        if (!data.type)
            return;
    }
    catch (error) {
        const err = error;
        (0, gossamer_1.emit)("client:error", {
            clientId: meta.id,
            context: "JSON parse error",
            error: err.message,
        });
        ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
        return;
    }
    try {
        switch (data.type) {
            case "register-details": {
                const regData = data;
                if (!regData.name ||
                    typeof regData.name !== "string" ||
                    regData.name.length > 50 ||
                    regData.name.trim().length === 0) {
                    ws.send(JSON.stringify({ type: "error", message: "Invalid name" }));
                    return;
                }
                meta.name = regData.name.trim();
                state.clients.set(ws, meta);
                // EMIT: Client Registered
                (0, gossamer_1.emit)("client:registered_details", {
                    clientId: meta.id,
                    newName: meta.name,
                });
                broadcastUsersOnSameNetwork();
                break;
            }
            case "create-flight": {
                if (meta.flightCode) {
                    ws.send(JSON.stringify({
                        type: "error",
                        message: "Already in a flight",
                    }));
                    return;
                }
                const flightCode = Math.random()
                    .toString(36)
                    .substr(2, 6)
                    .toUpperCase();
                state.flights[flightCode] = {
                    members: [ws],
                    establishedAt: null,
                };
                meta.flightCode = flightCode;
                state.connectionStats.totalFlightsCreated++;
                // EMIT: Flight Created (This triggers the Flight Story)
                (0, gossamer_1.emit)("flight:created", {
                    flightCode,
                    creatorId: meta.id,
                    createdAt: Date.now(),
                });
                ws.send(JSON.stringify({ type: "flight-created", flightCode }));
                broadcastUsersOnSameNetwork();
                break;
            }
            case "join-flight": {
                const joinData = data;
                if (!joinData.flightCode ||
                    typeof joinData.flightCode !== "string" ||
                    joinData.flightCode.length !== 6) {
                    ws.send(JSON.stringify({
                        type: "error",
                        message: "Invalid flight code",
                    }));
                    return;
                }
                if (meta.flightCode) {
                    ws.send(JSON.stringify({
                        type: "error",
                        message: "Already in a flight",
                    }));
                    return;
                }
                const flight = state.flights[joinData.flightCode];
                if (!flight || flight.members.length >= 2) {
                    (0, gossamer_1.emit)("flight:error", {
                        clientId: meta.id,
                        flightCode: joinData.flightCode,
                        error: !flight ? "not_found" : "flight_full",
                    });
                    ws.send(JSON.stringify({
                        type: "error",
                        message: "Flight not found or full",
                    }));
                    return;
                }
                const creatorWs = flight.members[0];
                const creatorMeta = state.clients.get(creatorWs);
                const joinerMeta = meta;
                if (!creatorMeta || creatorWs.readyState !== ws_1.default.OPEN) {
                    delete state.flights[joinData.flightCode];
                    ws.send(JSON.stringify({
                        type: "error",
                        message: "Flight creator disconnected",
                    }));
                    return;
                }
                // Logic for connection type
                let connectionType = "wan";
                if (creatorMeta.remoteIp === joinerMeta.remoteIp) {
                    connectionType = "lan";
                }
                else if ((0, utils_1.isPrivateIP)(creatorMeta.remoteIp) &&
                    (0, utils_1.isPrivateIP)(joinerMeta.remoteIp) &&
                    creatorMeta.remoteIp.split(".").slice(0, 3).join(".") ===
                        joinerMeta.remoteIp.split(".").slice(0, 3).join(".")) {
                    connectionType = "lan";
                }
                flight.members.push(ws);
                flight.establishedAt = Date.now();
                meta.flightCode = joinData.flightCode;
                state.connectionStats.totalFlightsJoined++;
                // EMIT: Peer Joined (Updates the Flight Story)
                (0, gossamer_1.emit)("flight:joined", {
                    flightCode: joinData.flightCode,
                    joinerId: meta.id,
                    joinerName: meta.name,
                    ip: meta.remoteIp,
                    connectionType: connectionType,
                });
                ws.send(JSON.stringify({
                    type: "peer-joined",
                    flightCode: joinData.flightCode,
                    peer: { id: creatorMeta.id, name: creatorMeta.name },
                    connectionType: connectionType,
                }));
                creatorWs.send(JSON.stringify({
                    type: "peer-joined",
                    flightCode: joinData.flightCode,
                    peer: { id: meta.id, name: meta.name },
                    connectionType: connectionType,
                }));
                broadcastUsersOnSameNetwork();
                break;
            }
            case "invite-to-flight": {
                const inviteData = data;
                if (!inviteData.inviteeId || !inviteData.flightCode)
                    return;
                (0, gossamer_1.emit)("flight:invitation", {
                    flightCode: inviteData.flightCode,
                    from: meta.id,
                    to: inviteData.inviteeId,
                });
                for (const [clientWs, clientMeta] of state.clients.entries()) {
                    if (clientMeta.id === inviteData.inviteeId &&
                        clientWs.readyState === ws_1.default.OPEN) {
                        clientWs.send(JSON.stringify({
                            type: "flight-invitation",
                            flightCode: inviteData.flightCode,
                            fromName: meta.name,
                        }));
                        break;
                    }
                }
                break;
            }
            case "signal": {
                const signalData = data;
                if (!meta.flightCode || !state.flights[meta.flightCode])
                    return;
                // EMIT: Signal (Captured by Story stats, usually silenced in console)
                (0, gossamer_1.emit)("flight:signal", {
                    flightCode: meta.flightCode,
                    senderId: meta.id,
                });
                state.flights[meta.flightCode].members.forEach((client) => {
                    if (client !== ws && client.readyState === ws_1.default.OPEN) {
                        client.send(JSON.stringify({ type: "signal", data: signalData.data }));
                    }
                });
                break;
            }
            default:
                ws.send(JSON.stringify({
                    type: "error",
                    message: "Unknown message type",
                }));
        }
    }
    catch (error) {
        const err = error;
        (0, gossamer_1.emit)("client:error", {
            context: "Error in message switch",
            clientId: meta.id,
            messageType: data?.type,
            error: err.message,
        });
        if (ws.readyState === ws_1.default.OPEN) {
            ws.send(JSON.stringify({
                type: "error",
                message: "Server error processing your request",
            }));
        }
    }
}
function handleDisconnect(ws) {
    const meta = state.clients.get(ws);
    if (!meta)
        return;
    state.clients.delete(ws);
    state.connectionStats.totalDisconnections++;
    // EMIT: Disconnected
    (0, gossamer_1.emit)("client:disconnected", {
        clientId: meta.id,
        remainingClients: state.clients.size,
        flightCode: meta.flightCode, // Pass flight code if they were in one
    });
    if (meta.flightCode && state.flights[meta.flightCode]) {
        const flightRef = state.flights[meta.flightCode];
        flightRef.members = flightRef.members.filter((c) => c !== ws);
        flightRef.members.forEach((client) => {
            if (client.readyState === ws_1.default.OPEN)
                client.send(JSON.stringify({ type: "peer-left" }));
        });
        if (flightRef.members.length === 0) {
            // EMIT: Flight Ended (Finalizes the Story)
            (0, gossamer_1.emit)("flight:ended", {
                flightCode: meta.flightCode,
                reason: "all_members_left",
            });
            delete state.flights[meta.flightCode];
        }
    }
    broadcastUsersOnSameNetwork();
}
function broadcastUsersOnSameNetwork() {
    try {
        const clientsByNetworkGroup = {};
        for (const [ws, meta] of state.clients.entries()) {
            if (!meta || ws.readyState !== ws_1.default.OPEN)
                continue;
            if (meta.flightCode &&
                state.flights[meta.flightCode] &&
                state.flights[meta.flightCode].members.length === 2)
                continue;
            let groupingKey = (0, utils_1.isPrivateIP)(meta.remoteIp)
                ? meta.remoteIp.split(".").slice(0, 3).join(".")
                : meta.remoteIp;
            if (!clientsByNetworkGroup[groupingKey])
                clientsByNetworkGroup[groupingKey] = [];
            clientsByNetworkGroup[groupingKey].push({
                id: meta.id,
                name: meta.name,
            });
        }
        for (const [ws, meta] of state.clients.entries()) {
            if (!meta || ws.readyState !== ws_1.default.OPEN)
                continue;
            if (meta.flightCode &&
                state.flights[meta.flightCode] &&
                state.flights[meta.flightCode].members.length === 2) {
                ws.send(JSON.stringify({
                    type: "users-on-network-update",
                    users: [],
                }));
                continue;
            }
            let groupingKey = (0, utils_1.isPrivateIP)(meta.remoteIp)
                ? meta.remoteIp.split(".").slice(0, 3).join(".")
                : meta.remoteIp;
            const usersOnNetwork = clientsByNetworkGroup[groupingKey]
                ? clientsByNetworkGroup[groupingKey].filter((c) => c.id !== meta.id)
                : [];
            ws.send(JSON.stringify({
                type: "users-on-network-update",
                users: usersOnNetwork,
            }));
        }
    }
    catch (error) {
        const err = error;
        (0, gossamer_1.emit)("system:error", {
            context: "broadcastUsersOnSameNetwork",
            error: err.message,
        });
    }
}
function startHealthChecks() {
    if (!wss)
        return;
    healthInterval = setInterval(() => {
        wss.clients.forEach((ws) => {
            const extWs = ws;
            if (extWs.isAlive === false) {
                return ws.terminate();
            }
            extWs.isAlive = false;
            ws.ping();
        });
    }, config_1.default.HEALTH_CHECK_INTERVAL);
}
function closeConnections() {
    (0, gossamer_1.emit)("system:shutdown", {
        message: "Closing WebSocket connections",
    });
    if (healthInterval) {
        clearInterval(healthInterval);
    }
    if (wss) {
        wss.clients.forEach((ws) => {
            if (ws.readyState === ws_1.default.OPEN) {
                ws.send(JSON.stringify({
                    type: "server-shutdown",
                    message: "Server is shutting down for maintenance.",
                }));
                ws.close(1001, "Server shutdown");
            }
        });
    }
}
//# sourceMappingURL=signalingService.js.map