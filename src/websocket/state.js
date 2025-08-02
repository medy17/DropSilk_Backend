// --- src/websocket/state.js ---

// In-memory store for active WebRTC flights/sessions
export const flights = {};

// Map to store client WebSocket instances and their metadata
export const clients = new Map();