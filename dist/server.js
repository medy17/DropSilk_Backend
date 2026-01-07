"use strict";
// --- server.ts (Root Directory) ---
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
require("dotenv/config");
const yargs_parser_1 = __importDefault(require("yargs-parser"));
// Imports point to ./src/ because this file is in the root
const httpServer_1 = require("./src/httpServer");
const signalingService_1 = require("./src/signalingService");
const utils_1 = require("./src/utils");
const dbClient_1 = require("./src/dbClient");
const state = __importStar(require("./src/state"));
const cleanupService_1 = require("./src/cleanupService");
// --- GOSSAMER TELEMETRY ---
const gossamer_1 = require("./src/gossamer");
const argv = (0, yargs_parser_1.default)(process.argv.slice(2));
async function startApp() {
    // 1. Initialize Gossamer Telemetry FIRST
    // This ensures that when other services start up, the listeners are ready.
    await (0, gossamer_1.initGossamer)();
    // 2. Conditionally initialize the database
    if (!argv.noDB) {
        await (0, dbClient_1.initializeDatabase)();
    }
    // 3. Initialize the WebSocket signaling service
    (0, signalingService_1.initializeSignaling)(httpServer_1.server);
    // 4. Start the HTTP server
    (0, httpServer_1.startServer)();
    // 5. Set up graceful shutdown
    (0, utils_1.setupGracefulShutdown)(httpServer_1.server, signalingService_1.closeConnections);
    // 6. Start the server heartbeat
    const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
    setInterval(() => {
        const memoryUsage = process.memoryUsage();
        const stats = {
            activeConnections: state.clients.size,
            activeFlights: Object.keys(state.flights).length,
            uptimeSeconds: Math.floor(process.uptime()),
            memoryRssMb: Math.round(memoryUsage.rss / 1024 / 1024),
            memoryHeapTotalMb: Math.round(memoryUsage.heapTotal / 1024 / 1024),
            memoryHeapUsedMb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        };
        // Emit heartbeat event
        (0, gossamer_1.emit)("system:heartbeat", stats);
    }, HEARTBEAT_INTERVAL_MS);
    // 7. Start the cleanup service
    if (!argv.noDB) {
        (0, cleanupService_1.startCleanupService)(60);
    }
    else {
        (0, gossamer_1.emit)("cleanup:skipped", {
            reason: "Cleanup service disabled via --noDB flag",
        });
    }
}
startApp().catch((error) => {
    // Failsafe logging
    console.error(JSON.stringify({
        level: "ERROR",
        message: "Failed to start application",
        error: error.message,
        stack: error.stack,
    }));
    process.exit(1);
});
//# sourceMappingURL=server.js.map