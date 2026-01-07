"use strict";
// --- src/gossamer.ts ---
// Bridge for ESM @dropsilk/gossamer in CommonJS project
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
exports.initGossamer = initGossamer;
exports.emit = emit;
exports.emitError = emitError;
exports.flush = flush;
const path_1 = __importDefault(require("path"));
let gossamer = null;
let isInitialized = false;
/**
 * Initialize Gossamer telemetry.
 * Must be called before any emit() calls.
 */
async function initGossamer() {
    if (isInitialized)
        return;
    const { gossamer: g, ConsolePrettyTransport } = await Promise.resolve().then(() => __importStar(require("@dropsilk/gossamer")));
    // Resolve config path relative to project root (works in tests, dev, and production)
    const configPath = path_1.default.resolve(process.cwd(), "gossamer.config.js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require(configPath);
    await g.init(config, {
        transports: [new ConsolePrettyTransport({ pretty: true })],
        captureCrashes: true,
    });
    gossamer = g;
    isInitialized = true;
}
/**
 * Emit a telemetry event.
 * @param eventName - Event name (e.g., "flight:created")
 * @param payload - Event payload
 */
function emit(eventName, payload = {}) {
    if (!gossamer) {
        console.warn(`[gossamer] Emit before init: ${eventName}`);
        return;
    }
    gossamer.emit(eventName, payload);
}
/**
 * Emit an error event with standardized error payload.
 * @param eventName - Event name (e.g., "client:error")
 * @param error - The error object
 * @param additionalPayload - Additional context
 */
function emitError(eventName, error, additionalPayload = {}) {
    if (!gossamer) {
        console.warn(`[gossamer] EmitError before init: ${eventName}`);
        return;
    }
    gossamer.emitError(eventName, error, additionalPayload);
}
/**
 * Flush all transports. Useful for graceful shutdown.
 */
async function flush() {
    if (gossamer) {
        await gossamer.flush();
    }
}
//# sourceMappingURL=gossamer.js.map