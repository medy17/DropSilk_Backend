// --- src/signalingService.ts ---

import WebSocket, { WebSocketServer } from "ws";
import type { Server } from "http";
// Correctly import the types we need from 'ws'
import type { VerifyClientCallbackSync } from "ws";
import type { IncomingMessage } from "http";
import config from "./config";
import state from "./state";
import { getClientIp, isPrivateIP } from "./utils";
import { eventBus, EVENTS } from "./telemetry";

// Extend the WebSocket type to include our custom property.
interface WebSocketWithStatus extends WebSocket {
    isAlive: boolean;
}

let wss: WebSocketServer;
let healthInterval: NodeJS.Timeout;

function initializeSignaling(server: Server) {
    // We remove the incorrect ': ClientOptions' type annotation and let TS infer
    // the correct type ('ServerOptions') from the constructor.
    const options = {
        server,
        verifyClient,
        perMessageDeflate: false,
        maxPayload: config.MAX_PAYLOAD,
        clientTracking: true,
    };
    wss = new WebSocketServer(options);

    wss.on("error", (error: Error) => {
        eventBus.emit(EVENTS.CLIENT.ERROR, {
            context: "WebSocket server error",
            error: error.message,
            stack: error.stack,
        });
    });

    wss.on("connection", (ws: WebSocket, req: IncomingMessage) =>
        handleConnection(ws as WebSocketWithStatus, req),
    );

    startHealthChecks();

    eventBus.emit(EVENTS.SYSTEM.STARTUP, { service: "Signaling Service" });
    return wss;
}

// --- THIS IS THE CORRECTED PART ---
// We now use the proper types for the 'info' and 'done' parameters by
// assigning the imported type to our function constant. This fixes TS2322 & TS7006.
const verifyClient: (info: any, done: any) => any = (info, done) => {
    const origin = info.req.headers.origin;
    const isAllowed =
        !!origin &&
        (config.ALLOWED_ORIGINS.has(origin) ||
            config.VERCEL_PREVIEW_ORIGIN_REGEX.test(origin));

    if (config.NODE_ENV === "production") {
        if (isAllowed) {
            done(true);
        } else {
            eventBus.emit(EVENTS.CLIENT.ERROR, {
                context: "Connection rejected (invalid origin)",
                origin,
                ip: getClientIp(info.req),
            });
            done(false, 403, "Forbidden: Invalid Origin");
        }
        return;
    }

    if (isAllowed || !origin) {
        done(true);
    } else {
        eventBus.emit(EVENTS.CLIENT.ERROR, {
            context: "Connection rejected (development origin check)",
            origin,
            ip: getClientIp(info.req),
        });
        done(false, 403, "Forbidden: Invalid Origin");
    }
};

function handleConnection(ws: WebSocketWithStatus, req: IncomingMessage) {
    const clientId = Math.random().toString(36).substring(2, 11);
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

    eventBus.emit(EVENTS.CLIENT.CONNECTED, {
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

    ws.on("message", (message: Buffer) => handleMessage(ws, message));
    ws.on("close", () => handleDisconnect(ws));
    ws.on("error", (error: Error) =>
        eventBus.emit(EVENTS.CLIENT.ERROR, {
            clientId: metadata.id,
            error: error.message,
        }),
    );
}

function handleMessage(ws: WebSocketWithStatus, message: Buffer) {
    const meta = state.clients.get(ws);
    if (!meta) return;

    let data: any;
    try {
        if (message.length > config.MAX_PAYLOAD) {
            eventBus.emit(EVENTS.CLIENT.ERROR, {
                clientId: meta.id,
                context: "Message too large",
                size: message.length,
            });
            ws.send(
                JSON.stringify({ type: "error", message: "Message too large" }),
            );
            return;
        }
        data = JSON.parse(message.toString());
        if (!data.type) return;
    } catch (error: any) {
        eventBus.emit(EVENTS.CLIENT.ERROR, {
            clientId: meta.id,
            context: "JSON parse error",
            error: error.message,
        });
        ws.send(
            JSON.stringify({
                type: "error",
                message: "Invalid message format",
            }),
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
                        JSON.stringify({
                            type: "error",
                            message: "Invalid name",
                        }),
                    );
                    return;
                }
                meta.name = data.name.trim();
                state.clients.set(ws, meta);

                eventBus.emit(EVENTS.CLIENT.REGISTERED_DETAILS, {
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
                    .substring(2, 8)
                    .toUpperCase();
                state.flights[flightCode] = {
                    members: [ws],
                    establishedAt: null,
                };
                meta.flightCode = flightCode;
                state.connectionStats.totalFlightsCreated++;

                eventBus.emit(EVENTS.FLIGHT.CREATED, {
                    flightCode,
                    creatorId: meta.id,
                    createdAt: Date.now(),
                });

                ws.send(
                    JSON.stringify({ type: "flight-created", flightCode }),
                );
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
                    eventBus.emit(EVENTS.FLIGHT.ERROR, {
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

                let connectionType = "wan";
                if (creatorMeta.remoteIp === meta.remoteIp) {
                    connectionType = "lan";
                } else if (
                    isPrivateIP(creatorMeta.remoteIp) &&
                    isPrivateIP(meta.remoteIp) &&
                    creatorMeta.remoteIp.split(".").slice(0, 3).join(".") ===
                    meta.remoteIp.split(".").slice(0, 3).join(".")
                ) {
                    connectionType = "lan";
                }

                flight.members.push(ws);
                flight.establishedAt = Date.now();
                meta.flightCode = data.flightCode;
                state.connectionStats.totalFlightsJoined++;

                eventBus.emit(EVENTS.FLIGHT.JOINED, {
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
                eventBus.emit(EVENTS.FLIGHT.INVITATION, {
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
                if (!meta.flightCode || !state.flights[meta.flightCode])
                    return;
                eventBus.emit(EVENTS.FLIGHT.SIGNAL, {
                    flightCode: meta.flightCode,
                    senderId: meta.id,
                });
                state.flights[meta.flightCode].members.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(
                            JSON.stringify({
                                type: "signal",
                                data: data.data,
                            }),
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
    } catch (error: any) {
        eventBus.emit(EVENTS.CLIENT.ERROR, {
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

function handleDisconnect(ws: WebSocketWithStatus) {
    const meta = state.clients.get(ws);
    if (!meta) return;

    state.clients.delete(ws);
    state.connectionStats.totalDisconnections++;

    eventBus.emit(EVENTS.CLIENT.DISCONNECTED, {
        clientId: meta.id,
        remainingClients: state.clients.size,
        flightCode: meta.flightCode,
    });

    if (meta.flightCode && state.flights[meta.flightCode]) {
        const flightRef = state.flights[meta.flightCode];
        flightRef.members = flightRef.members.filter((c) => c !== ws);

        flightRef.members.forEach((client) => {
            if (client.readyState === WebSocket.OPEN)
                client.send(JSON.stringify({ type: "peer-left" }));
        });

        if (flightRef.members.length === 0) {
            eventBus.emit(EVENTS.FLIGHT.ENDED, {
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
        const clientsByNetworkGroup: Record<
            string,
            { id: string; name: string }[]
        > = {};
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
    } catch (error: any) {
        eventBus.emit(EVENTS.SYSTEM.ERROR, {
            context: "broadcastUsersOnSameNetwork",
            error: error.message,
        });
    }
}

function startHealthChecks() {
    healthInterval = setInterval(() => {
        wss.clients.forEach((ws) => {
            const client = ws as WebSocketWithStatus;
            if (!client.isAlive) {
                return client.terminate();
            }
            client.isAlive = false;
            client.ping();
        });
    }, config.HEALTH_CHECK_INTERVAL);
}

function closeConnections() {
    eventBus.emit(EVENTS.SYSTEM.SHUTDOWN, {
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

export { initializeSignaling, closeConnections };