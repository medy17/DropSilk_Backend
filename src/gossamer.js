// --- src/gossamer.js ---
// Bridge for ESM @dropsilk/gossamer in CommonJS project

let gossamer = null;
let isInitialized = false;

/**
 * Initialize Gossamer telemetry.
 * Must be called before any emit() calls.
 * @returns {Promise<void>}
 */
async function initGossamer() {
    if (isInitialized) return;

    const { gossamer: g, ConsolePrettyTransport } = await import(
        "@dropsilk/gossamer"
    );
    const config = require("../gossamer.config.js");

    await g.init(config, {
        transports: [new ConsolePrettyTransport({ pretty: true })],
        captureCrashes: true,
    });

    gossamer = g;
    isInitialized = true;
}

/**
 * Emit a telemetry event.
 * @param {string} eventName - Event name (e.g., "flight:created")
 * @param {Record<string, unknown>} [payload] - Event payload
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
 * @param {string} eventName - Event name (e.g., "client:error")
 * @param {unknown} error - The error object
 * @param {Record<string, unknown>} [additionalPayload] - Additional context
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
 * @returns {Promise<void>}
 */
async function flush() {
    if (gossamer) {
        await gossamer.flush();
    }
}

module.exports = {
    initGossamer,
    emit,
    emitError,
    flush,
};
