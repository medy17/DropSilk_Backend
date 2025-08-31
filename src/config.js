// --- src/config.js ---

// --- START: Logic for dynamically adding local origins ---
const baseAllowedOrigins = [
    'https://dropsilk.xyz',
    'https://www.dropsilk.xyz',
    'https://dropsilk.vercel.app',
];

const ALLOWED_ORIGINS = new Set(baseAllowedOrigins);
const localPortArgPrefix = '--allow-local-port=';

// process.argv contains command line arguments.
// Example: ['/usr/bin/node', '/path/to/server.js', '--allow-local-port=3000']
// We slice(2) to ignore the node executable and script path.
process.argv.slice(2).forEach(arg => {
    if (arg.startsWith(localPortArgPrefix)) {
        const portStr = arg.substring(localPortArgPrefix.length);
        const port = parseInt(portStr, 10);

        // Validate that we got a real port number
        if (!isNaN(port) && port > 0 && port < 65536) {
            const localOrigin1 = `http://localhost:${port}`;
            const localOrigin2 = `http://127.0.0.1:${port}`;

            ALLOWED_ORIGINS.add(localOrigin1);
            ALLOWED_ORIGINS.add(localOrigin2);

            // Log to the console to confirm the origins were added
            console.log(`[Config] Development: Dynamically allowing origins for port ${port}:`);
            console.log(`         - ${localOrigin1}`);
            console.log(`         - ${localOrigin2}`);
        } else {
            console.warn(`[Config] Invalid port number provided with ${localPortArgPrefix}: "${portStr}". Ignoring.`);
        }
    }
});
// --- END: Logic for dynamically adding local origins ---


const config = {
    PORT: process.env.PORT || 8080,
    NODE_ENV: process.env.NODE_ENV || 'development',

    // Use the dynamically modified Set
    ALLOWED_ORIGINS: ALLOWED_ORIGINS,

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