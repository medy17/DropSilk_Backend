// --- src/httpServer.ts ---
import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";

import config from "./config";
import state from "./state";
import { getClientIp, getLocalIpForDisplay, getLogs } from "./utils";
import { handleUploadThingRequest } from "./uploadthingHandler";
import { handleRequestEmail } from "./emailService";
import { eventBus, EVENTS } from "./telemetry";

// Type alias for our request and response for cleaner function signatures
type Request = http.IncomingMessage;
type Response = http.ServerResponse;

// --- THIS IS THE CORRECTED PART ---
// We now explicitly cast the config port to a number to satisfy the
// server.listen() function's signature and fix the TS2769 overload error.
const PORT_TO_USE = Number(config.PORT);

function setTurnCors(res: Response, req: Request) {
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

function setEmailCors(res: Response, req: Request) {
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

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url!, `http://${req.headers.host}`);
        const clientIp = getClientIp(req);

        if (url.pathname.startsWith("/api/uploadthing")) {
            return handleUploadThingRequest(req, res);
        }

        if (req.method === "OPTIONS" && url.pathname === "/request-email") {
            setEmailCors(res, req);
            res.writeHead(204);
            res.end();
            return;
        }

        if (req.method === "POST" && url.pathname === "/request-email") {
            setEmailCors(res, req);
            let body = "";
            req.on("data", (chunk) => {
                body += chunk.toString();
            });
            req.on("end", () => {
                try {
                    // Hack to attach body to the request object for the handler
                    (req as any).body = JSON.parse(body);
                    handleRequestEmail(req as any, res);
                } catch (e) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Invalid JSON" }));
                }
            });
            return;
        }

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
                eventBus.emit(EVENTS.TURN.ERROR, {
                    message:
                        "TURN credentials request failed: Not configured",
                });
                res.writeHead(501, { "Content-Type": "application/json" });
                res.end(
                    JSON.stringify({
                        error: "TURN service is not configured on the server.",
                    }),
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
                    eventBus.emit(EVENTS.TURN.ERROR, {
                        context: "Cloudflare API Error",
                        status: response.status,
                        body: errorBody,
                    });
                    throw new Error(
                        `Cloudflare API responded with status ${response.status}`,
                    );
                }

                const data = await response.json();
                eventBus.emit(EVENTS.TURN.CREDENTIALS_ISSUED, {
                    clientIp: clientIp,
                });

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(data));
            } catch (error: any) {
                eventBus.emit(EVENTS.TURN.ERROR, {
                    context: "Fetch Loop",
                    error: error.message,
                });
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(
                    JSON.stringify({
                        error: "Could not fetch TURN credentials.",
                    }),
                );
            }
            return;
        }

        if (url.pathname === "/favicon.ico") {
            const faviconPath = path.join(
                __dirname,
                "..",
                "public",
                "favicon.ico",
            );
            fs.readFile(faviconPath, (err, data) => {
                if (err) {
                    res.writeHead(404);
                    res.end();
                    return;
                }
                res.writeHead(200, { "Content-Type": "image/x-icon" });
                res.end(data);
            });
            return;
        }

        if (req.method === "GET" && url.pathname === "/") {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("Server is alive and waiting for WebSocket connections.");
        } else if (req.method === "GET" && url.pathname === "/keep-alive") {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("OK");
        } else if (req.method === "GET" && url.pathname === "/stats") {
            const statsData = {
                activeConnections: state.clients.size,
                activeFlights: Object.keys(state.flights).length,
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                timestamp: new Date().toISOString(),
            };
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(statsData, null, 2));
        } else if (req.method === "GET" && url.pathname === "/logs") {
            const providedKey = url.searchParams.get("key") || "";
            const expectedKey = config.LOG_ACCESS_KEY;

            const providedKeyBuffer = Buffer.from(providedKey);
            const expectedKeyBuffer = Buffer.from(expectedKey);

            if (
                providedKeyBuffer.length !== expectedKeyBuffer.length ||
                !crypto.timingSafeEqual(providedKeyBuffer, expectedKeyBuffer)
            ) {
                eventBus.emit(EVENTS.SYSTEM.LOG_ACCESS, {
                    status: "unauthorized",
                    ip: clientIp,
                });
                res.writeHead(403, { "Content-Type": "text/plain" });
                res.end("Forbidden");
                return;
            }

            eventBus.emit(EVENTS.SYSTEM.LOG_ACCESS, {
                status: "success",
                ip: clientIp,
            });
            res.writeHead(200, {
                "Content-Type": "text/plain; charset=utf-8",
            });
            res.end(getLogs().join("\n"));
        } else {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
        }
    } catch (error: any) {
        eventBus.emit(EVENTS.HTTP.ERROR, {
            context: "Global Request Handler",
            error: error.message,
            url: req.url,
        });
        if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "text/plain" });
        }
        res.end("Internal Server Error");
    }
});

server.on("error", (error: NodeJS.ErrnoException) => {
    eventBus.emit(EVENTS.HTTP.ERROR, {
        context: "Critical Server Error",
        error: error.message,
        code: error.code,
    });
    if (error.code === "EADDRINUSE") {
        eventBus.emit(EVENTS.SYSTEM.SHUTDOWN, {
            reason: `Port ${PORT_TO_USE} in use`,
        });
        process.exit(1);
    }
});

function startServer() {
    server.listen(PORT_TO_USE, "0.0.0.0", () => {
        eventBus.emit(EVENTS.SYSTEM.STARTUP, {
            port: PORT_TO_USE,
            environment: config.NODE_ENV,
            localIp: getLocalIpForDisplay(),
        });
    });
}

export { server, startServer };