"use strict";
// --- src/state.ts ---
// Manages the in-memory state of the application.
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectionStats = exports.flights = exports.clients = void 0;
/** Map of WebSocket connections to their metadata */
exports.clients = new Map();
/** Record of active flights by flight code */
exports.flights = {};
/** Aggregate connection statistics */
exports.connectionStats = {
    totalConnections: 0,
    totalDisconnections: 0,
    totalFlightsCreated: 0,
    totalFlightsJoined: 0,
    startTime: Date.now(),
};
//# sourceMappingURL=state.js.map