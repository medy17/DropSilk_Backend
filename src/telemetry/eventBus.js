// --- src/telemetry/eventBus.js ---

const EventEmitter = require("events");

class TelemetryBus extends EventEmitter {}

// Singleton instance. This is the only instance the whole app will use.
const eventBus = new TelemetryBus();

module.exports = eventBus;