// --- src/signalingService.js ---

const WebSocket = require("ws");
const config = require("./config");
const state = require("./state");
const { getClientIp, isPrivateIP } = require("./utils");
const { emit } = require("./gossamer");

let wss;
let healthInterval;

function initializeSignaling(server) {
    wss = new WebSocket.Server({
        server,
        verifyClient,
        perMessageDeflate: false,
        maxPayload: config.MAX_PAYLOAD,
        clientTracking: true,
    });

    wss.on("error", (error) => {
        emit("client:error", {
            context: "WebSocket server error",
            error: error.message,
            stack: error.stack,
        });
    });

    wss.on("connection", handleConnection);

    startHealthChecks();

    emit("system:startup", { service: "Signaling Service" });
    return wss;
}

function verifyClient(info, done) {
    const origin = info.req.headers.origin;

    if (config.NODE_ENV === "production") {
        const isAllowed =
            config.ALLOWED_ORIGINS.has(origin) ||
            (origin && config.VERCEL_PREVIEW_ORIGIN_REGEX.test(origin));

        if (isAllowed) {
            done(true);
        } else {
            emit("client:error", {
                context: "Connection rejected (invalid origin)",
                origin,
                ip: getClientIp(info.req),
            });
            done(false, 403, "Forbidden: Invalid Origin");
        }
        return;
    }

    if (config.ALLOWED_ORIGINS.has(origin) || !origin) {
        done(true);
    } else {
        emit("client:error", {
            context: "Connection rejected (development origin check)",
            origin,
            ip: getClientIp(info.req),
        });
        done(false, 403, "Forbidden: Invalid Origin");
    }
}

function handleConnection(ws, req) {
    const clientId = Math.random().toString(36).substr(2, 9);
    const cleanRemoteIp = getClientIp(req);

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
    emit("client:connected", {
        clientId,
        ip: cleanRemoteIp,
        totalClients: state.clients.size,
    });

    ws.isAlive = true;
    ws.on("pong", () => {
        ws.isAlive = true;
    });

    ws.send(JSON.stringify({ type: "registered", id: clientId }));
    broadcastUsersOnSameNetwork();

    ws.on("message", (message) => handleMessage(ws, message));
    ws.on("close", () => handleDisconnect(ws));
    ws.on("error", (error) =>
        emit("client:error", {
            clientId: metadata.id,
            error: error.message,
        }),
    );
}

function handleMessage(ws, message) {
    const meta = state.clients.get(ws);
    if (!meta) {
        // Silently ignore or emit warn if desired
        return;
    }

    let data;
    try {
        if (message.length > config.MAX_PAYLOAD) {
            emit("client:error", {
                clientId: meta.id,
                context: "Message too large",
                size: message.length,
            });
            ws.send(
                JSON.stringify({ type: "error", message: "Message too large" }),
            );
            return;
        }
        data = JSON.parse(message);
        if (!data.type) return;
    } catch (error) {
        emit("client:error", {
            clientId: meta.id,
            context: "JSON parse error",
            error: error.message,
        });
        ws.send(
            JSON.stringify({ type: "error", message: "Invalid message format" }),
        );
        return;
    }

    try {
        switch (data.type) {
            case "register-details":
                if (
                    !data.name ||
                    typeof data.name !== "string" ||
                    data.name.length > 50 ||
                    data.name.trim().length === 0
                ) {
                    ws.send(
                        JSON.stringify({ type: "error", message: "Invalid name" }),
                    );
                    return;
                }
                meta.name = data.name.trim();
                state.clients.set(ws, meta);

                // EMIT: Client Registered
                emit("client:registered_details", {
                    clientId: meta.id,
                    newName: meta.name,
                });
                broadcastUsersOnSameNetwork();
                break;

            case "create-flight":
                if (meta.flightCode) {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Already in a flight",
                        }),
                    );
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
                emit("flight:created", {
                    flightCode,
                    creatorId: meta.id,
                    createdAt: Date.now(),
                });

                ws.send(JSON.stringify({ type: "flight-created", flightCode }));
                broadcastUsersOnSameNetwork();
                break;

            case "join-flight":
                if (
                    !data.flightCode ||
                    typeof data.flightCode !== "string" ||
                    data.flightCode.length !== 6
                ) {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Invalid flight code",
                        }),
                    );
                    return;
                }
                if (meta.flightCode) {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Already in a flight",
                        }),
                    );
                    return;
                }
                const flight = state.flights[data.flightCode];
                if (!flight || flight.members.length >= 2) {
                    emit("flight:error", {
                        clientId: meta.id,
                        flightCode: data.flightCode,
                        error: !flight ? "not_found" : "flight_full",
                    });
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Flight not found or full",
                        }),
                    );
                    return;
                }

                const creatorWs = flight.members[0];
                const creatorMeta = state.clients.get(creatorWs);
                const joinerMeta = meta;

                if (!creatorMeta || creatorWs.readyState !== WebSocket.OPEN) {
                    delete state.flights[data.flightCode];
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Flight creator disconnected",
                        }),
                    );
                    return;
                }

                // Logic for connection type
                let connectionType = "wan";
                if (creatorMeta.remoteIp === joinerMeta.remoteIp) {
                    connectionType = "lan";
                } else if (
                    isPrivateIP(creatorMeta.remoteIp) &&
                    isPrivateIP(joinerMeta.remoteIp) &&
                    creatorMeta.remoteIp.split(".").slice(0, 3).join(".") ===
                    joinerMeta.remoteIp.split(".").slice(0, 3).join(".")
                ) {
                    connectionType = "lan";
                }

                flight.members.push(ws);
                flight.establishedAt = Date.now();
                meta.flightCode = data.flightCode;
                state.connectionStats.totalFlightsJoined++;

                // EMIT: Peer Joined (Updates the Flight Story)
                emit("flight:joined", {
                    flightCode: data.flightCode,
                    joinerId: meta.id,
                    joinerName: meta.name,
                    ip: meta.remoteIp,
                    connectionType: connectionType,
                });

                ws.send(
                    JSON.stringify({
                        type: "peer-joined",
                        flightCode: data.flightCode,
                        peer: { id: creatorMeta.id, name: creatorMeta.name },
                        connectionType: connectionType,
                    }),
                );
                creatorWs.send(
                    JSON.stringify({
                        type: "peer-joined",
                        flightCode: data.flightCode,
                        peer: { id: meta.id, name: meta.name },
                        connectionType: connectionType,
                    }),
                );

                broadcastUsersOnSameNetwork();
                break;

            case "invite-to-flight":
                if (!data.inviteeId || !data.flightCode) return;
                emit("flight:invitation", {
                    flightCode: data.flightCode,
                    from: meta.id,
                    to: data.inviteeId,
                });
                for (const [clientWs, clientMeta] of state.clients.entries()) {
                    if (
                        clientMeta.id === data.inviteeId &&
                        clientWs.readyState === WebSocket.OPEN
                    ) {
                        clientWs.send(
                            JSON.stringify({
                                type: "flight-invitation",
                                flightCode: data.flightCode,
                                fromName: meta.name,
                            }),
                        );
                        break;
                    }
                }
                break;

            case "signal":
                if (!meta.flightCode || !state.flights[meta.flightCode]) return;

                // EMIT: Signal (Captured by Story stats, usually silenced in console)
                emit("flight:signal", {
                    flightCode: meta.flightCode,
                    senderId: meta.id,
                });

                state.flights[meta.flightCode].members.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(
                            JSON.stringify({ type: "signal", data: data.data }),
                        );
                    }
                });
                break;

            default:
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "Unknown message type",
                    }),
                );
        }
    } catch (error) {
        emit("client:error", {
            context: "Error in message switch",
            clientId: meta.id,
            messageType: data?.type,
            error: error.message,
        });
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(
                JSON.stringify({
                    type: "error",
                    message: "Server error processing your request",
                }),
            );
        }
    }
}

function handleDisconnect(ws) {
    const meta = state.clients.get(ws);
    if (!meta) return;

    state.clients.delete(ws);
    state.connectionStats.totalDisconnections++;

    // EMIT: Disconnected
    emit("client:disconnected", {
        clientId: meta.id,
        remainingClients: state.clients.size,
        flightCode: meta.flightCode, // Pass flight code if they were in one
    });

    if (meta.flightCode && state.flights[meta.flightCode]) {
        const flightRef = state.flights[meta.flightCode];

        flightRef.members = flightRef.members.filter((c) => c !== ws);

        flightRef.members.forEach((client) => {
            if (client.readyState === WebSocket.OPEN)
                client.send(JSON.stringify({ type: "peer-left" }));
        });

        if (flightRef.members.length === 0) {
            // EMIT: Flight Ended (Finalizes the Story)
            emit("flight:ended", {
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
            if (!meta || ws.readyState !== WebSocket.OPEN) continue;
            if (
                meta.flightCode &&
                state.flights[meta.flightCode] &&
                state.flights[meta.flightCode].members.length === 2
            )
                continue;

            let groupingKey = isPrivateIP(meta.remoteIp)
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
            if (!meta || ws.readyState !== WebSocket.OPEN) continue;

            if (
                meta.flightCode &&
                state.flights[meta.flightCode] &&
                state.flights[meta.flightCode].members.length === 2
            ) {
                ws.send(
                    JSON.stringify({
                        type: "users-on-network-update",
                        users: [],
                    }),
                );
                continue;
            }

            let groupingKey = isPrivateIP(meta.remoteIp)
                ? meta.remoteIp.split(".").slice(0, 3).join(".")
                : meta.remoteIp;
            const usersOnNetwork = clientsByNetworkGroup[groupingKey]
                ? clientsByNetworkGroup[groupingKey].filter(
                    (c) => c.id !== meta.id,
                )
                : [];
            ws.send(
                JSON.stringify({
                    type: "users-on-network-update",
                    users: usersOnNetwork,
                }),
            );
        }
    } catch (error) {
        emit("system:error", {
            context: "broadcastUsersOnSameNetwork",
            error: error.message,
        });
    }
}

function startHealthChecks() {
    healthInterval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });
    }, config.HEALTH_CHECK_INTERVAL);
}

function closeConnections() {
    emit("system:shutdown", {
        message: "Closing WebSocket connections",
    });
    clearInterval(healthInterval);
    if (wss) {
        wss.clients.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                    JSON.stringify({
                        type: "server-shutdown",
                        message: "Server is shutting down for maintenance.",
                    }),
                );
                ws.close(1001, "Server shutdown");
            }
        });
    }
}

module.exports = { initializeSignaling, closeConnections };