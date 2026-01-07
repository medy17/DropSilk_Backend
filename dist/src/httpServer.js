"use strict";
// --- src/httpServer.ts ---
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
exports.server = void 0;
exports.startServer = startServer;
const http_1 = __importDefault(require("http"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_1 = __importDefault(require("./config"));
const state = __importStar(require("./state"));
const utils_1 = require("./utils");
const uploadthingHandler_1 = require("./uploadthingHandler");
const emailService_1 = require("./emailService");
const gossamer_1 = require("./gossamer");
const PORT_TO_USE = Number(process.env.PORT) || config_1.default.PORT;
function setTurnCors(res, req) {
    const origin = req.headers.origin;
    if (origin &&
        (config_1.default.ALLOWED_ORIGINS.has(origin) ||
            config_1.default.VERCEL_PREVIEW_ORIGIN_REGEX.test(origin))) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function setEmailCors(res, req) {
    const origin = req.headers.origin;
    if (origin &&
        (config_1.default.ALLOWED_ORIGINS.has(origin) ||
            config_1.default.VERCEL_PREVIEW_ORIGIN_REGEX.test(origin))) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
exports.server = http_1.default.createServer(async (req, res) => {
    try {
        const url = new URL(req.url || "/", `http://${req.headers.host}`);
        const clientIp = (0, utils_1.getClientIp)(req);
        // UploadThing endpoint
        if (url.pathname.startsWith("/api/uploadthing")) {
            return (0, uploadthingHandler_1.handleUploadThingRequest)(req, res);
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
                    const reqWithBody = req;
                    reqWithBody.body = JSON.parse(body);
                    (0, emailService_1.handleRequestEmail)(reqWithBody, res);
                }
                catch (e) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Invalid JSON" }));
                }
            });
            return;
        }
        // TURN Server Credentials Endpoint
        if (req.method === "OPTIONS" &&
            url.pathname === "/api/turn-credentials") {
            setTurnCors(res, req);
            res.writeHead(204);
            res.end();
            return;
        }
        if (req.method === "GET" && url.pathname === "/api/turn-credentials") {
            setTurnCors(res, req);
            if (!config_1.default.CLOUDFLARE_TURN_TOKEN_ID ||
                !config_1.default.CLOUDFLARE_API_TOKEN) {
                (0, gossamer_1.emit)("turn:error", {
                    message: "TURN credentials request failed: Not configured",
                });
                res.writeHead(501, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    error: "TURN service is not configured on the server.",
                }));
                return;
            }
            try {
                const cloudflareUrl = `https://rtc.live.cloudflare.com/v1/turn/keys/${config_1.default.CLOUDFLARE_TURN_TOKEN_ID}/credentials/generate-ice-servers`;
                const response = await fetch(cloudflareUrl, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${config_1.default.CLOUDFLARE_API_TOKEN}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ ttl: 3600 }),
                });
                if (!response.ok) {
                    const errorBody = await response.text();
                    (0, gossamer_1.emit)("turn:error", {
                        context: "Cloudflare API Error",
                        status: response.status,
                        body: errorBody,
                    });
                    throw new Error(`Cloudflare API responded with status ${response.status}`);
                }
                const data = (await response.json());
                (0, gossamer_1.emit)("turn:credentials_issued", {
                    clientIp: clientIp,
                });
                if (!data.iceServers ||
                    !Array.isArray(data.iceServers) ||
                    data.iceServers.length === 0) {
                    (0, gossamer_1.emit)("turn:error", {
                        context: "Invalid Cloudflare Response",
                        responseData: data,
                    });
                    throw new Error("Invalid response format from Cloudflare");
                }
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(data));
            }
            catch (error) {
                const err = error;
                (0, gossamer_1.emit)("turn:error", {
                    context: "Fetch Loop",
                    error: err.message,
                });
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    error: "Could not fetch TURN credentials.",
                }));
            }
            return;
        }
        // Favicon
        if (url.pathname === "/favicon.ico") {
            const faviconPath = path_1.default.join(__dirname, "..", "public", "favicon.ico");
            fs_1.default.readFile(faviconPath, (err, data) => {
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
        }
        else if (req.method === "GET" && url.pathname === "/keep-alive") {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("OK");
        }
        else if (req.method === "GET" && url.pathname === "/stats") {
            const stats = {
                activeConnections: state.clients.size,
                activeFlights: Object.keys(state.flights).length,
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                timestamp: new Date().toISOString(),
            };
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(stats, null, 2));
        }
        else {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
        }
    }
    catch (error) {
        const err = error;
        (0, gossamer_1.emit)("http:error", {
            context: "Global Request Handler",
            error: err.message,
            url: req.url,
        });
        if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "text/plain" });
        }
        res.end("Internal Server Error");
    }
});
exports.server.on("error", (error) => {
    (0, gossamer_1.emit)("http:error", {
        context: "Critical Server Error",
        error: error.message,
        code: error.code,
    });
    if (error.code === "EADDRINUSE") {
        (0, gossamer_1.emit)("system:shutdown", {
            reason: `Port ${PORT_TO_USE} in use`,
        });
        process.exit(1);
    }
});
function startServer() {
    exports.server.listen(PORT_TO_USE, "0.0.0.0", () => {
        (0, gossamer_1.emit)("system:startup", {
            port: PORT_TO_USE,
            environment: config_1.default.NODE_ENV,
            localIp: (0, utils_1.getLocalIpForDisplay)(),
        });
    });
}
//# sourceMappingURL=httpServer.js.map