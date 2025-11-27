// --- src/config.js ---

const os = require("os");
const interfaces = os.networkInterfaces();
// REMOVED: const { log } = require("./utils"); <--- CAUSED THE CYCLE

// Parse CLI flags once and expose NO_DB in config
const argv = require("yargs-parser")(process.argv.slice(2));
const NO_DB =
    Boolean(argv.noDB) ||
    ["1", "true"].includes(String(process.env.NO_DB).toLowerCase());

// --- START: Logic for dynamically adding local origins ---
const baseAllowedOrigins = [
    "https://dropsilk.xyz",
    "https://www.dropsilk.xyz",
    "https://dropsilk.vercel.app",
    "app://.",
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

            // Use console.log here to avoid circular dependency with utils.js
            console.log(JSON.stringify({
                level: "INFO",
                message: "Dynamically allowing local origins",
                port,
                origins: [localOrigin1, localOrigin2]
            }));

            // --- 192.168.x.x origins ---
            for (const name of Object.keys(interfaces)) {
                for (const iface of interfaces[name]) {
                    const { address, family, internal } = iface;
                    if (
                        family === "IPv4" &&
                        !internal &&
                        address.startsWith("192.168.")
                    ) {
                        const localOrigin3 = `http://${address}:${port}`;
                        ALLOWED_ORIGINS.add(localOrigin3);
                        console.log(JSON.stringify({
                            level: "INFO",
                            message: "Dynamically allowing local network origin",
                            port,
                            origin: localOrigin3
                        }));
                    }
                }
            }
        } else {
            console.warn(JSON.stringify({
                level: "WARN",
                message: "Invalid port number provided for local origin",
                argument: arg
            }));
        }
    }
});
// --- END: Logic for dynamically adding local origins ---

const config = {
    PORT: process.env.PORT || 8080,
    NODE_ENV: process.env.NODE_ENV || "development",

    ALLOWED_ORIGINS: ALLOWED_ORIGINS,

    VERCEL_PREVIEW_ORIGIN_REGEX:
        /^https:\/\/dropsilk-[a-zA-Z0-9]+-ahmed-arats-projects\.vercel\.app$/,

    MAX_PAYLOAD: 1024 * 1024,
    HEALTH_CHECK_INTERVAL: 30000,
    SHUTDOWN_TIMEOUT: 10000,

    LOG_ACCESS_KEY:
        process.env.LOG_ACCESS_KEY || "change-this-secret-key-in-production",
    MAX_LOG_BUFFER_SIZE: 1000,

    UPLOADTHING_TOKEN: process.env.UPLOADTHING_TOKEN || "",

    CLOUDFLARE_TURN_TOKEN_ID: process.env.CLOUDFLARE_TURN_TOKEN_ID || "",
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || "",

    NO_DB,

    recaptchaSecretKey: process.env.RECAPTCHA_SECRET_KEY || "",
    contactEmail: process.env.CONTACT_EMAIL || "",
};

module.exports = config;