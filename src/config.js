// --- src/config.js ---

// --- START: Logic for dynamically adding local origins ---
const baseAllowedOrigins = [
    "https://dropsilk.xyz",
    "https://www.dropsilk.xyz",
    "https://dropsilk.vercel.app",
];

const ALLOWED_ORIGINS = new Set(baseAllowedOrigins);
const localPortArgPrefix = "--allow-local-port=";

process.argv.slice(2).forEach((arg) => {
    if (arg.startsWith(localPortArgPrefix)) {
        const portStr = arg.substring(localPortArgPrefix.length);
        const port = parseInt(portStr, 10);

        if (!isNaN(port) && port > 0 && port < 65536) {
            const localOrigin1 = `http://localhost:${port}`;
            const localOrigin2 = `http://127.0.0.1:${port}`;

            ALLOWED_ORIGINS.add(localOrigin1);
            ALLOWED_ORIGINS.add(localOrigin2);

            console.log(
                `[Config] Development: Dynamically allowing origins for port ${port}:`
            );
            console.log(`         - ${localOrigin1}`);
            console.log(`         - ${localOrigin2}`);
        } else {
            console.warn(
                `[Config] Invalid port number provided with ${localPortArgPrefix}: "${portStr}". Ignoring.`
            );
        }
    }
});
// --- END: Logic for dynamically adding local origins ---

const config = {
    PORT: process.env.PORT || 8080,
    NODE_ENV: process.env.NODE_ENV || "development",

    ALLOWED_ORIGINS: ALLOWED_ORIGINS,

    // --- NEW: Add regex for Vercel preview URLs ---
    // This will match URLs like: https://dropsilk-a1b2c3d-ahmed-arats-projects.vercel.app
    VERCEL_PREVIEW_ORIGIN_REGEX:
        /^https:\/\/dropsilk-[a-zA-Z0-9]+-ahmed-arats-projects\.vercel\.app$/,


    MAX_PAYLOAD: 1024 * 1024,
    HEALTH_CHECK_INTERVAL: 30000,
    SHUTDOWN_TIMEOUT: 10000,

    LOG_ACCESS_KEY:
        process.env.LOG_ACCESS_KEY || "change-this-secret-key-in-production",
    MAX_LOG_BUFFER_SIZE: 1000,

    // --- NEW: Use a single UploadThing Token ---
    UPLOADTHING_TOKEN: process.env.UPLOADTHING_TOKEN || "",
};

module.exports = config;