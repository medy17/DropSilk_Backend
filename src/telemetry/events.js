// --- src/telemetry/events.js ---

// The "Single Source of Truth" for all event names.
// If it ain't in here, it doesn't exist.

const EVENTS = {
    SYSTEM: {
        STARTUP: "system:startup",
        SHUTDOWN: "system:shutdown",
        HEARTBEAT: "system:heartbeat",
        LOG_ACCESS: "system:log_access",
    },
    HTTP: {
        REQUEST: "http:request",
        ERROR: "http:error",
    },
    CLIENT: {
        CONNECTED: "client:connected",
        DISCONNECTED: "client:disconnected",
        REGISTERED_DETAILS: "client:registered_details",
        ERROR: "client:error",
    },
    FLIGHT: {
        CREATED: "flight:created",
        JOINED: "flight:joined",
        ENDED: "flight:ended",
        SIGNAL: "flight:signal",
        INVITATION: "flight:invitation",
        ERROR: "flight:error",
    },
    TURN: {
        CREDENTIALS_ISSUED: "turn:credentials_issued",
        ERROR: "turn:error",
    },
    UPLOAD: {
        SUCCESS: "upload:success",
        DB_SAVED: "upload:db_saved",
        ERROR: "upload:error",
    },
    CLEANUP: {
        START: "cleanup:start",
        COMPLETE: "cleanup:complete",
        SKIPPED: "cleanup:skipped",
        ERROR: "cleanup:error",
    },
    EMAIL: {
        REQUEST: "email:request",
        ERROR: "email:error",
    },
};

module.exports = EVENTS;