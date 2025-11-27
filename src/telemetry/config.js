// --- src/telemetry/config.js ---

const EVENTS = require("./events");

module.exports = {
    // Master switch. Set to "false" to shut the whole telemetry system up.
    enabled: true,

    // Logging Configuration:
    // This dictates what gets dumped to the console/memory-buffer immediately.
    // If an event is NOT listed here, it's effectively "silent" in the standard logs,
    // though it might still be picked up by a Story.
    logs: {
        // --- System ---
        [EVENTS.SYSTEM.STARTUP]: { level: "info" },
        [EVENTS.SYSTEM.SHUTDOWN]: { level: "warn" },
        [EVENTS.SYSTEM.HEARTBEAT]: { level: "info" },
        [EVENTS.SYSTEM.LOG_ACCESS]: { level: "warn" },
        [EVENTS.SYSTEM.ERROR]: { level: "error" },

        // --- HTTP / Email ---
        [EVENTS.HTTP.ERROR]: { level: "error" },
        [EVENTS.EMAIL.ERROR]: { level: "error" },

        // --- Client ---
        [EVENTS.CLIENT.CONNECTED]: { level: "info" },
        [EVENTS.CLIENT.DISCONNECTED]: { level: "info" },
        [EVENTS.CLIENT.REGISTERED_DETAILS]: { level: "info" },
        [EVENTS.CLIENT.ERROR]: { level: "error" },

        // --- Flight (Immediate logs) ---
        [EVENTS.FLIGHT.CREATED]: { level: "info" },
        [EVENTS.FLIGHT.JOINED]: { level: "info" },
        [EVENTS.FLIGHT.ENDED]: { level: "info" },
        [EVENTS.FLIGHT.ERROR]: { level: "error" },
        // Note: SIGNAL events are usually too noisy for standard logging,
        // so we leave them out of 'logs' but keep them in 'stories'.

        // --- TURN ---
        [EVENTS.TURN.CREDENTIALS_ISSUED]: { level: "info" },
        [EVENTS.TURN.ERROR]: { level: "error" },

        // --- Upload/Cleanup ---
        [EVENTS.UPLOAD.SUCCESS]: { level: "info" },
        [EVENTS.UPLOAD.DB_SAVED]: { level: "info" },
        [EVENTS.UPLOAD.ERROR]: { level: "error" },
        [EVENTS.CLEANUP.START]: { level: "info" },
        [EVENTS.CLEANUP.COMPLETE]: { level: "info" },
        [EVENTS.CLEANUP.SKIPPED]: { level: "info" },
        [EVENTS.CLEANUP.ERROR]: { level: "error" },
    },

    // Story Configuration:
    // Defines complex narratives built from multiple events over time.
    stories: {
        flight_story: {
            enabled: true,
            trigger: EVENTS.FLIGHT.CREATED,
            ender: EVENTS.FLIGHT.ENDED,
            // Events that we want to "listen" for if they have the matching flightCode
            track: [
                EVENTS.FLIGHT.JOINED,
                EVENTS.FLIGHT.SIGNAL,
                EVENTS.CLIENT.DISCONNECTED, // We'll map this to the flight context in StoryManager
            ],
        },
    },
};