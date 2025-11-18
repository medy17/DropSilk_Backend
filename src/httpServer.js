// --- src/httpServer.js ---
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const config = require("./config");
const state = require("./state");
const { log, getClientIp, getLocalIpForDisplay } = require("./utils");
const { handleUploadThingRequest } = require("./uploadthingHandler");
const { handleRequestEmail } = require("./emailService");

// --- THIS IS THE FIX ---
// Use the port Render provides via environment variable.
// Fall back to your config file's port for local development.
const PORT_TO_USE = process.env.PORT || config.PORT;

// Helper for setting CORS headers for our new TURN endpoint
function setTurnCors(res, req) {
    const origin = req.headers.origin;
    // Only allow origins that are in our explicit list or match the Vercel preview pattern
    if (origin && (config.ALLOWED_ORIGINS.has(origin) || config.VERCEL_PREVIEW_ORIGIN_REGEX.test(origin))) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// --- NEW: Helper for setting CORS headers for the email endpoint ---
function setEmailCors(res, req) {
    const origin = req.headers.origin;
    if (origin && (config.ALLOWED_ORIGINS.has(origin) || config.VERCEL_PREVIEW_ORIGIN_REGEX.test(origin))) {
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

        // --- ROUTING LOGIC ---

        // UploadThing endpoint
        if (url.pathname.startsWith("/api/uploadthing")) {
            return handleUploadThingRequest(req, res);
        }

        // --- NEW: Email Request Endpoint ---
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

        // --- NEW: TURN Server Credentials Endpoint ---
        if (req.method === "OPTIONS" && url.pathname === "/api/turn-credentials") {
            setTurnCors(res, req);
            res.writeHead(204);
            res.end();
            return;
        }

        if (req.method === "GET" && url.pathname === "/api/turn-credentials") {
            setTurnCors(res, req);

            if (!config.CLOUDFLARE_TURN_TOKEN_ID || !config.CLOUDFLARE_API_TOKEN) {
                log('warn', 'TURN credentials request failed: TURN server not configured on backend.');
                res.writeHead(501, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "TURN service is not configured on the server." }));
                return;
            }

            try {
                // --- FIX: Use the correct endpoint from the new documentation ---
                const cloudflareUrl = `https://rtc.live.cloudflare.com/v1/turn/keys/${config.CLOUDFLARE_TURN_TOKEN_ID}/credentials/generate-ice-servers`;

                const response = await fetch(cloudflareUrl, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${config.CLOUDFLARE_API_TOKEN}`,
                        "Content-Type": "application/json",
                    },
                    // Body may accept options like ttl (seconds). Empty {} is valid.
                    body: JSON.stringify({ttl: 3600}),
                });

                if (!response.ok) {
                    const errorBody = await response.text();
                    log('error', 'Failed to get TURN credentials from Cloudflare', { status: response.status, body: errorBody });
                    throw new Error(`Cloudflare API responded with status ${response.status}`);
                }

                const data = await response.json();
                // The new endpoint returns the full iceServers array directly
                if (!data.iceServers || !Array.isArray(data.iceServers) || data.iceServers.length === 0) {
                    log('error', 'Cloudflare response did not contain valid TURN credentials', { responseData: data });
                    throw new Error('Invalid response format from Cloudflare');
                }

                // --- FIX: Send the entire iceServers array to the frontend ---
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(data)); // Send the whole { iceServers: [...] } object
            } catch (error) {
                log('error', 'Error during TURN credential fetch process', { error: error.message, stack: error.stack });
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Could not fetch TURN credentials." }));
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
                    log("warn", "favicon.ico not found", {
                        path: faviconPath,
                    });
                    res.writeHead(404);
                    res.end();
                    return;
                }
                res.writeHead(200, { "Content-Type": "image/x-icon" });
                res.end(data);
            });
            return;
        }

        // Health check
        if (req.method === "GET" && url.pathname === "/") {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("Server is alive and waiting for WebSocket connections.");
            log("info", "Health check accessed", { ip: clientIp });
        } else if (req.method === "GET" && url.pathname === "/keep-alive") {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("OK");
            log("info", "Keep-alive ping received", { ip: clientIp });
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
            log("info", "Stats endpoint accessed", { ip: clientIp });
        } else if (req.method === "GET" && url.pathname === "/logs") {
            const providedKey = url.searchParams.get("key") || "";
            const expectedKey = config.LOG_ACCESS_KEY;

            const providedKeyBuffer = Buffer.from(providedKey);
            const expectedKeyBuffer = Buffer.from(expectedKey);

            if (
                providedKeyBuffer.length !== expectedKeyBuffer.length ||
                !crypto.timingSafeEqual(providedKeyBuffer, expectedKeyBuffer)
            ) {
                log(
                    "warn",
                    "Unauthorized attempt to access logs (key mismatch)",
                    { ip: clientIp },
                );
                res.writeHead(403, { "Content-Type": "text/plain" });
                res.end("Forbidden");
                return;
            }

            log("warn", "Log dump endpoint accessed successfully", {
                ip: clientIp,
            });
            res.writeHead(200, {
                "Content-Type": "text/plain; charset=utf-8",
            });
            res.end(state.logs.join("\n"));
        } else {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
        }
    } catch (error) {
        log("error", "HTTP server error in request handler", {
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
    log("error", "HTTP server critical error", {
        error: error.message,
        code: error.code,
    });
    if (error.code === "EADDRINUSE") {
        // Use the corrected port variable in the error message
        log("error", `Port ${PORT_TO_USE} is already in use`);
        process.exit(1);
    }
});

function startServer() {
    // Use the corrected port variable to listen
    server.listen(PORT_TO_USE, "0.0.0.0", () => {
        log("info", `🚀 Signalling Server started`, {
            port: PORT_TO_USE,
            environment: config.NODE_ENV,
            localIp: getLocalIpForDisplay(),
        });
    });
}

module.exports = { server, startServer };