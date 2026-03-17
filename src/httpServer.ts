// --- src/httpServer.ts ---

import http, { IncomingMessage, ServerResponse } from "http";
import fs from "fs";
import path from "path";

import config from "./config";
import * as state from "./state";
import {
    createRoom,
    getRoomSummary,
    joinRoom,
    markParticipantReady,
    setParticipantScreenShare,
} from "./roomStore";
import { matchRoute } from "./routeMatcher";
import { getClientIp, getLocalIpForDisplay } from "./utils";
import { handleUploadThingRequest } from "./uploadthingHandler";
import { handleRequestEmail } from "./emailService";
import { emit } from "./gossamer";

const PORT_TO_USE = Number(process.env.PORT) || config.PORT;

interface IncomingMessageWithBody extends IncomingMessage {
    body?: Record<string, unknown>;
}

function setRoomCors(res: ServerResponse, req: IncomingMessage): void {
    const origin = req.headers.origin;
    if (
        origin &&
        (config.ALLOWED_ORIGINS.has(origin) ||
            config.VERCEL_PREVIEW_ORIGIN_REGEX.test(origin))
    ) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(
    res: ServerResponse,
    statusCode: number,
    payload: Record<string, unknown>
): void {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];

    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    if (chunks.length === 0) {
        return {};
    }

    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (!raw) {
        return {};
    }

    return JSON.parse(raw) as Record<string, unknown>;
}

function setTurnCors(res: ServerResponse, req: IncomingMessage): void {
    const origin = req.headers.origin;
    if (
        origin &&
        (config.ALLOWED_ORIGINS.has(origin) ||
            config.VERCEL_PREVIEW_ORIGIN_REGEX.test(origin))
    ) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function setEmailCors(res: ServerResponse, req: IncomingMessage): void {
    const origin = req.headers.origin;
    if (
        origin &&
        (config.ALLOWED_ORIGINS.has(origin) ||
            config.VERCEL_PREVIEW_ORIGIN_REGEX.test(origin))
    ) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export const server = http.createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
        try {
            const url = new URL(req.url || "/", `http://${req.headers.host}`);
            const clientIp = getClientIp(req);

            if (url.pathname === "/api/rooms" || url.pathname.startsWith("/api/rooms/")) {
                setRoomCors(res, req);

                if (req.method === "OPTIONS") {
                    res.writeHead(204);
                    res.end();
                    return;
                }

                try {
                    const createRoomRoute = matchRoute(
                        req.method,
                        url.pathname,
                        "POST",
                        "/api/rooms"
                    );
                    if (createRoomRoute) {
                        const body = await readJsonBody(req);
                        const summary = await createRoom(String(body.name || ""));
                        sendJson(res, 201, summary as unknown as Record<string, unknown>);
                        return;
                    }

                    const getRoomRoute = matchRoute(
                        req.method,
                        url.pathname,
                        "GET",
                        "/api/rooms/:roomCode"
                    );
                    if (getRoomRoute) {
                        const participantId = url.searchParams.get("participantId") || "";
                        const summary = await getRoomSummary(
                            getRoomRoute.roomCode.toUpperCase(),
                            participantId
                        );

                        if (!summary) {
                            sendJson(res, 404, {
                                error: "Room not found or participant is not part of it.",
                            });
                            return;
                        }

                        sendJson(res, 200, summary as unknown as Record<string, unknown>);
                        return;
                    }

                    const joinRoomRoute = matchRoute(
                        req.method,
                        url.pathname,
                        "POST",
                        "/api/rooms/:roomCode/join"
                    );
                    if (joinRoomRoute) {
                        const body = await readJsonBody(req);
                        const summary = await joinRoom(
                            joinRoomRoute.roomCode.toUpperCase(),
                            String(body.name || "")
                        );
                        sendJson(res, 200, summary as unknown as Record<string, unknown>);
                        return;
                    }

                    const readyRoute = matchRoute(
                        req.method,
                        url.pathname,
                        "POST",
                        "/api/rooms/:roomCode/participants/:participantId/ready"
                    );
                    if (readyRoute) {
                        const body = await readJsonBody(req);
                        const summary = await markParticipantReady(
                            readyRoute.roomCode.toUpperCase(),
                            readyRoute.participantId,
                            {
                                fileCount: Number(body.fileCount) || 0,
                                totalBytes: Number(body.totalBytes) || 0,
                            }
                        );

                        if (!summary) {
                            sendJson(res, 404, {
                                error: "Room not found or participant is not part of it.",
                            });
                            return;
                        }

                        sendJson(res, 200, summary as unknown as Record<string, unknown>);
                        return;
                    }

                    const screenShareRoute = matchRoute(
                        req.method,
                        url.pathname,
                        "POST",
                        "/api/rooms/:roomCode/participants/:participantId/screen-share"
                    );
                    if (screenShareRoute) {
                        const body = await readJsonBody(req);
                        const summary = await setParticipantScreenShare(
                            screenShareRoute.roomCode.toUpperCase(),
                            screenShareRoute.participantId,
                            Boolean(body.active)
                        );

                        if (!summary) {
                            sendJson(res, 404, {
                                error: "Room not found or participant is not part of it.",
                            });
                            return;
                        }

                        sendJson(res, 200, summary as unknown as Record<string, unknown>);
                        return;
                    }

                    sendJson(res, 404, { error: "Room endpoint not found." });
                } catch (error) {
                    const err = error as Error;
                    emit("room:error", {
                        error: err.message,
                        method: req.method,
                        path: url.pathname,
                    });
                    sendJson(res, 400, { error: err.message || "Invalid room request." });
                }
                return;
            }

            // UploadThing endpoint
            if (url.pathname.startsWith("/api/uploadthing")) {
                return handleUploadThingRequest(req, res);
            }

            // Email Request Endpoint
            if (req.method === "OPTIONS" && url.pathname === "/request-email") {
                setEmailCors(res, req);
                res.writeHead(204);
                res.end();
                return;
            }

            if (req.method === "POST" && url.pathname === "/request-email") {
                setEmailCors(res, req);
                let body = "";
                req.on("data", (chunk: Buffer) => {
                    body += chunk.toString();
                });
                req.on("end", () => {
                    try {
                        const reqWithBody = req as IncomingMessageWithBody;
                        reqWithBody.body = JSON.parse(body);
                        handleRequestEmail(reqWithBody, res);
                    } catch (e) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: "Invalid JSON" }));
                    }
                });
                return;
            }

            // TURN Server Credentials Endpoint
            if (
                req.method === "OPTIONS" &&
                url.pathname === "/api/turn-credentials"
            ) {
                setTurnCors(res, req);
                res.writeHead(204);
                res.end();
                return;
            }

            if (req.method === "GET" && url.pathname === "/api/turn-credentials") {
                setTurnCors(res, req);

                if (
                    !config.CLOUDFLARE_TURN_TOKEN_ID ||
                    !config.CLOUDFLARE_API_TOKEN
                ) {
                    emit("turn:error", {
                        message: "TURN credentials request failed: Not configured",
                    });
                    res.writeHead(501, { "Content-Type": "application/json" });
                    res.end(
                        JSON.stringify({
                            error: "TURN service is not configured on the server.",
                        })
                    );
                    return;
                }

                try {
                    const cloudflareUrl = `https://rtc.live.cloudflare.com/v1/turn/keys/${config.CLOUDFLARE_TURN_TOKEN_ID}/credentials/generate-ice-servers`;

                    const response = await fetch(cloudflareUrl, {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${config.CLOUDFLARE_API_TOKEN}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({ ttl: 3600 }),
                    });

                    if (!response.ok) {
                        const errorBody = await response.text();
                        emit("turn:error", {
                            context: "Cloudflare API Error",
                            status: response.status,
                            body: errorBody,
                        });
                        throw new Error(
                            `Cloudflare API responded with status ${response.status}`
                        );
                    }

                    const data = (await response.json()) as {
                        iceServers?: unknown[];
                    };
                    emit("turn:credentials_issued", {
                        clientIp: clientIp,
                    });

                    if (
                        !data.iceServers ||
                        !Array.isArray(data.iceServers) ||
                        data.iceServers.length === 0
                    ) {
                        emit("turn:error", {
                            context: "Invalid Cloudflare Response",
                            responseData: data,
                        });
                        throw new Error("Invalid response format from Cloudflare");
                    }

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify(data));
                } catch (error) {
                    const err = error as Error;
                    emit("turn:error", {
                        context: "Fetch Loop",
                        error: err.message,
                    });
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(
                        JSON.stringify({
                            error: "Could not fetch TURN credentials.",
                        })
                    );
                }
                return;
            }

            // Favicon
            if (url.pathname === "/favicon.ico") {
                const faviconPath = path.join(
                    __dirname,
                    "..",
                    "public",
                    "favicon.ico"
                );
                fs.readFile(faviconPath, (err, data) => {
                    if (err) {
                        // Ignored in logs usually
                        res.writeHead(404);
                        res.end();
                        return;
                    }
                    res.writeHead(200, { "Content-Type": "image/x-icon" });
                    res.end(data);
                });
                return;
            }

            // Health check & Stats
            if (req.method === "GET" && url.pathname === "/") {
                res.writeHead(200, { "Content-Type": "text/plain" });
                res.end("Server is alive and waiting for WebSocket connections.");
                // Optional: eventBus.emit(EVENTS.HTTP.REQUEST, { path: '/' });
            } else if (req.method === "GET" && url.pathname === "/keep-alive") {
                res.writeHead(200, { "Content-Type": "text/plain" });
                res.end("OK");
            } else if (req.method === "GET" && url.pathname === "/stats") {
                const stats = {
                    activeConnections: state.clients.size,
                    activeFlights: Object.keys(state.flights).length,
                    uptime: process.uptime(),
                    memory: process.memoryUsage(),
                    timestamp: new Date().toISOString(),
                };
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(stats, null, 2));
            } else {
                res.writeHead(404, { "Content-Type": "text/plain" });
                res.end("Not Found");
            }
        } catch (error) {
            const err = error as Error;
            emit("http:error", {
                context: "Global Request Handler",
                error: err.message,
                url: req.url,
            });
            if (!res.headersSent) {
                res.writeHead(500, { "Content-Type": "text/plain" });
            }
            res.end("Internal Server Error");
        }
    }
);

server.on("error", (error: NodeJS.ErrnoException) => {
    emit("http:error", {
        context: "Critical Server Error",
        error: error.message,
        code: error.code,
    });
    if (error.code === "EADDRINUSE") {
        emit("system:shutdown", {
            reason: `Port ${PORT_TO_USE} in use`,
        });
        process.exit(1);
    }
});

export function startServer(): void {
    server.listen(PORT_TO_USE, "0.0.0.0", () => {
        emit("system:startup", {
            port: PORT_TO_USE,
            environment: config.NODE_ENV,
            localIp: getLocalIpForDisplay(),
        });
    });
}
