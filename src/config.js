// --- src/config.js ---

const config = {
    PORT: process.env.PORT || 8080,
    NODE_ENV: process.env.NODE_ENV || 'development',

    ALLOWED_ORIGINS: new Set([
        'https://dropsilk.xyz',
        'https://www.dropsilk.xyz',
        'https://dropsilk.vercel.app',
    ]),

    MAX_PAYLOAD: 1024 * 1024,
    HEALTH_CHECK_INTERVAL: 30000,
    SHUTDOWN_TIMEOUT: 10000,

    // --- NEW CONFIGURATION ---
    // A secret key required to access the /logs endpoint.
    // IMPORTANT: Change this in production using an environment variable!
    LOG_ACCESS_KEY: process.env.LOG_ACCESS_KEY || 'change-this-secret-key-in-production',

    // The maximum number of log lines to keep in the in-memory buffer.
    MAX_LOG_BUFFER_SIZE: 1000,
    // --- END OF NEW CONFIGURATION ---
};

module.exports = config;