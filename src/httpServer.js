// --- src/httpServer.js ---
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const config = require("./config");
const state = require("./state");
const { log, getClientIp, getLocalIpForDisplay } = require("./utils");
const { handleUploadThingRequest } = require("./uploadthingHandler");

const server = http.createServer((req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const clientIp = getClientIp(req);

        // --- ROUTING LOGIC ---

        // UploadThing endpoint
        if (url.pathname.startsWith("/api/uploadthing")) {
            return handleUploadThingRequest(req, res);
        }

        // Favicon
        if (url.pathname === "/favicon.ico") {
            const faviconPath = path.join(__dirname, "..", "public", "favicon.ico");
            fs.readFile(faviconPath, (err, data) => {
                if (err) {
                    log("warn", "favicon.ico not found", { path: faviconPath });
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
                log("warn", "Unauthorized attempt to access logs (key mismatch)", { ip: clientIp });
                res.writeHead(403, { "Content-Type": "text/plain" });
                res.end("Forbidden");
                return;
            }

            log("warn", "Log dump endpoint accessed successfully", { ip: clientIp });
            res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
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
        log("error", `Port ${config.PORT} is already in use`);
        process.exit(1);
    }
});

function startServer() {
    server.listen(config.PORT, "0.0.0.0", () => {
        log("info", `🚀 Signalling Server started`, {
            port: config.PORT,
            environment: config.NODE_ENV,
            localIp: getLocalIpForDisplay(),
        });
    });
}

module.exports = { server, startServer };