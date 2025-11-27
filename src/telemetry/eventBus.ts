// --- src/telemetry/eventBus.ts ---

import { EventEmitter } from "events";

class TelemetryBus extends EventEmitter {}

// Singleton instance. This is the only instance the whole app will use.
const eventBus = new TelemetryBus();

export default eventBus;