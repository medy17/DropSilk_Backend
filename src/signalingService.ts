// --- src/signalingService.ts ---

import WebSocket, { WebSocketServer } from "ws";
import type { Server, IncomingMessage } from "http";
import config from "./config";
import * as state from "./state";
import type { ClientMetadata, Flight } from "./state";
import { getClientIp, isPrivateIP } from "./utils";
import { emit } from "./gossamer";

let wss: WebSocketServer | undefined;
let healthInterval: NodeJS.Timeout | undefined;

// --- Message Types ---
interface RegisterDetailsMessage {
    type: "register-details";
    name: string;
}

interface CreateFlightMessage {
    type: "create-flight";
}

interface JoinFlightMessage {
    type: "join-flight";
    flightCode: string;
}

interface InviteToFlightMessage {
    type: "invite-to-flight";
    inviteeId: string;
    flightCode: string;
}

interface SignalMessage {
    type: "signal";
    data: unknown;
}

type ClientMessage =
    | RegisterDetailsMessage
    | CreateFlightMessage
    | JoinFlightMessage
    | InviteToFlightMessage
    | SignalMessage
    | { type: string };

// --- Extended WebSocket with isAlive property ---
interface ExtendedWebSocket extends WebSocket {
    isAlive: boolean;
}

export function initializeSignaling(server: Server): WebSocketServer {
    wss = new WebSocketServer({
        server,
        verifyClient,
        perMessageDeflate: false,
        maxPayload: config.MAX_PAYLOAD,
        clientTracking: true,
    });

    wss.on("error", (error: Error) => {
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

function verifyClient(
    info: { origin?: string; req: IncomingMessage },
    done: (result: boolean, code?: number, message?: string) => void
): void {
    const origin = info.req.headers.origin;

    if (config.NODE_ENV === "production") {
        const isAllowed =
            (origin && config.ALLOWED_ORIGINS.has(origin)) ||
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

    if ((origin && config.ALLOWED_ORIGINS.has(origin)) || !origin) {
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

function handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const extWs = ws as ExtendedWebSocket;
    const clientId = Math.random().toString(36).substr(2, 9);
    const cleanRemoteIp = getClientIp(req);

    const metadata: ClientMetadata = {
        id: clientId,
        name: "Anonymous",
        flightCode: null,
        remoteIp: cleanRemoteIp,
        connectedAt: new Date().toISOString(),
        userAgent: (req.headers["user-agent"] as string) || "unknown",
    };

    state.clients.set(ws, metadata);
    state.connectionStats.totalConnections++;

    // EMIT: Client Connected
    emit("client:connected", {
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

    ws.on("message", (message: WebSocket.RawData) => handleMessage(ws, message));
    ws.on("close", () => handleDisconnect(ws));
    ws.on("error", (error: Error) =>
        emit("client:error", {
            clientId: metadata.id,
            error: error.message,
        })
    );
}

function handleMessage(ws: WebSocket, message: WebSocket.RawData): void {
    const meta = state.clients.get(ws);
    if (!meta) {
        // Silently ignore or emit warn if desired
        return;
    }

    let data: ClientMessage;
    try {
        const messageStr = message.toString();
        if (messageStr.length > config.MAX_PAYLOAD) {
            emit("client:error", {
                clientId: meta.id,
                context: "Message too large",
                size: messageStr.length,
            });
            ws.send(
                JSON.stringify({ type: "error", message: "Message too large" })
            );
            return;
        }
        data = JSON.parse(messageStr) as ClientMessage;
        if (!data.type) return;
    } catch (error) {
        const err = error as Error;
        emit("client:error", {
            clientId: meta.id,
            context: "JSON parse error",
            error: err.message,
        });
        ws.send(
            JSON.stringify({ type: "error", message: "Invalid message format" })
        );
        return;
    }

    try {
        switch (data.type) {
            case "register-details": {
                const regData = data as RegisterDetailsMessage;
                if (
                    !regData.name ||
                    typeof regData.name !== "string" ||
                    regData.name.length > 50 ||
                    regData.name.trim().length === 0
                ) {
                    ws.send(
                        JSON.stringify({ type: "error", message: "Invalid name" })
                    );
                    return;
                }
                meta.name = regData.name.trim();
                state.clients.set(ws, meta);

                // EMIT: Client Registered
                emit("client:registered_details", {
                    clientId: meta.id,
                    newName: meta.name,
                });
                broadcastUsersOnSameNetwork();
                break;
            }

            case "create-flight": {
                if (meta.flightCode) {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Already in a flight",
                        })
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
            }

            case "join-flight": {
                const joinData = data as JoinFlightMessage;
                if (
                    !joinData.flightCode ||
                    typeof joinData.flightCode !== "string" ||
                    joinData.flightCode.length !== 6
                ) {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Invalid flight code",
                        })
                    );
                    return;
                }
                if (meta.flightCode) {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Already in a flight",
                        })
                    );
                    return;
                }
                const flight = state.flights[joinData.flightCode];
                if (!flight || flight.members.length >= 2) {
                    emit("flight:error", {
                        clientId: meta.id,
                        flightCode: joinData.flightCode,
                        error: !flight ? "not_found" : "flight_full",
                    });
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Flight not found or full",
                        })
                    );
                    return;
                }

                const creatorWs = flight.members[0];
                const creatorMeta = state.clients.get(creatorWs);
                const joinerMeta = meta;

                if (!creatorMeta || creatorWs.readyState !== WebSocket.OPEN) {
                    delete state.flights[joinData.flightCode];
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Flight creator disconnected",
                        })
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
                meta.flightCode = joinData.flightCode;
                state.connectionStats.totalFlightsJoined++;

                // EMIT: Peer Joined (Updates the Flight Story)
                emit("flight:joined", {
                    flightCode: joinData.flightCode,
                    joinerId: meta.id,
                    joinerName: meta.name,
                    ip: meta.remoteIp,
                    connectionType: connectionType,
                });

                ws.send(
                    JSON.stringify({
                        type: "peer-joined",
                        flightCode: joinData.flightCode,
                        peer: { id: creatorMeta.id, name: creatorMeta.name },
                        connectionType: connectionType,
                    })
                );
                creatorWs.send(
                    JSON.stringify({
                        type: "peer-joined",
                        flightCode: joinData.flightCode,
                        peer: { id: meta.id, name: meta.name },
                        connectionType: connectionType,
                    })
                );

                broadcastUsersOnSameNetwork();
                break;
            }

            case "invite-to-flight": {
                const inviteData = data as InviteToFlightMessage;
                if (!inviteData.inviteeId || !inviteData.flightCode) return;
                emit("flight:invitation", {
                    flightCode: inviteData.flightCode,
                    from: meta.id,
                    to: inviteData.inviteeId,
                });
                for (const [clientWs, clientMeta] of state.clients.entries()) {
                    if (
                        clientMeta.id === inviteData.inviteeId &&
                        clientWs.readyState === WebSocket.OPEN
                    ) {
                        clientWs.send(
                            JSON.stringify({
                                type: "flight-invitation",
                                flightCode: inviteData.flightCode,
                                fromName: meta.name,
                            })
                        );
                        break;
                    }
                }
                break;
            }

            case "signal": {
                const signalData = data as SignalMessage;
                if (!meta.flightCode || !state.flights[meta.flightCode]) return;

                // EMIT: Signal (Captured by Story stats, usually silenced in console)
                emit("flight:signal", {
                    flightCode: meta.flightCode,
                    senderId: meta.id,
                });

                state.flights[meta.flightCode].members.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(
                            JSON.stringify({ type: "signal", data: signalData.data })
                        );
                    }
                });
                break;
            }

            default:
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "Unknown message type",
                    })
                );
        }
    } catch (error) {
        const err = error as Error;
        emit("client:error", {
            context: "Error in message switch",
            clientId: meta.id,
            messageType: data?.type,
            error: err.message,
        });
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(
                JSON.stringify({
                    type: "error",
                    message: "Server error processing your request",
                })
            );
        }
    }
}

function handleDisconnect(ws: WebSocket): void {
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

function broadcastUsersOnSameNetwork(): void {
    try {
        const clientsByNetworkGroup: Record<string, { id: string; name: string }[]> = {};
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
                    })
                );
                continue;
            }

            let groupingKey = isPrivateIP(meta.remoteIp)
                ? meta.remoteIp.split(".").slice(0, 3).join(".")
                : meta.remoteIp;
            const usersOnNetwork = clientsByNetworkGroup[groupingKey]
                ? clientsByNetworkGroup[groupingKey].filter(
                    (c) => c.id !== meta.id
                )
                : [];
            ws.send(
                JSON.stringify({
                    type: "users-on-network-update",
                    users: usersOnNetwork,
                })
            );
        }
    } catch (error) {
        const err = error as Error;
        emit("system:error", {
            context: "broadcastUsersOnSameNetwork",
            error: err.message,
        });
    }
}

function startHealthChecks(): void {
    if (!wss) return;

    healthInterval = setInterval(() => {
        wss!.clients.forEach((ws) => {
            const extWs = ws as ExtendedWebSocket;
            if (extWs.isAlive === false) {
                return ws.terminate();
            }
            extWs.isAlive = false;
            ws.ping();
        });
    }, config.HEALTH_CHECK_INTERVAL);
}

export function closeConnections(): void {
    emit("system:shutdown", {
        message: "Closing WebSocket connections",
    });
    if (healthInterval) {
        clearInterval(healthInterval);
    }
    if (wss) {
        wss.clients.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                    JSON.stringify({
                        type: "server-shutdown",
                        message: "Server is shutting down for maintenance.",
                    })
                );
                ws.close(1001, "Server shutdown");
            }
        });
    }
}
