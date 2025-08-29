// --- src/state.js ---
// Manages the in-memory state of the application.

const clients = new Map();
const flights = {};
const connectionStats = {
    totalConnections: 0,
    totalDisconnections: 0,
    totalFlightsCreated: 0,
    totalFlightsJoined: 0,
    startTime: Date.now()
};

// --- NEW STATE ---
// An in-memory array to store the most recent log entries.
const logs = [];
// --- END OF NEW STATE ---

module.exports = {
    clients,
    flights,
    connectionStats,
    logs, // <-- Export the new logs array
};