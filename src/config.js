// --- src/config.js ---

// Whitelist of allowed origins for WebSocket connections in production
export const allowedOrigins = new Set([
    'https://dropsilk.xyz',
    'https://www.dropsilk.xyz',
    'https://dropsilk.vercel.app',
]);

// Environment variables and constants
export const PORT = process.env.PORT || 8080;
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const SERVER_IP = '0.0.0.0'; // Listen on all available network interfaces

// Shared in-memory statistics store
export const connectionStats = {
    totalConnections: 0,
    totalDisconnections: 0,
    totalFlightsCreated: 0,
    totalFlightsJoined: 0,
    startTime: Date.now()
};