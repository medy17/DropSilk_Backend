// --- src/httpServer.js ---
const http = require("http");
const fs = require("fs");
const path = require("path");

const config = require("./config");
const state = require("./state");
const { getClientIp, getLocalIpForDisplay } = require("./utils");
const { handleUploadThingRequest } = require("./uploadthingHandler");
const { handleRequestEmail } = require("./emailService");
const { emit } = require("./gossamer");

const PORT_TO_USE = process.env.PORT || config.PORT;

function setTurnCors(res, req) {
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

function setEmailCors(res, req) {
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
        const url = new URL(req.url, `http://${req.headers.host}`);
        const clientIp = getClientIp(req);

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
            req.on("data", (chunk) => {
                body += chunk.toString();
            });
            req.on("end", () => {
                try {
                    req.body = JSON.parse(body);
                    handleRequestEmail(req, res);
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
                    emit("turn:error", {
                        context: "Cloudflare API Error",
                        status: response.status,
                        body: errorBody,
                    });
                    throw new Error(
                        `Cloudflare API responded with status ${response.status}`,
                    );
                }

                const data = await response.json();
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
                emit("turn:error", {
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

        // Favicon
        if (url.pathname === "/favicon.ico") {
            const faviconPath = path.join(
                __dirname,
                "..",
                "public",
                "favicon.ico",
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
        emit("http:error", {
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

server.on("error", (error) => {
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

function startServer() {
    server.listen(PORT_TO_USE, "0.0.0.0", () => {
        emit("system:startup", {
            port: PORT_TO_USE,
            environment: config.NODE_ENV,
            localIp: getLocalIpForDisplay(),
        });
    });
}

module.exports = { server, startServer };