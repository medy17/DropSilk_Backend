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
            // What property on the event payload links all events in a single story?
            contextKey: "flightCode",
            // Which event starts a new story instance?
            trigger: EVENTS.FLIGHT.CREATED,
            // Which event(s) cleanly end a story? Can be an array.
            ender: [EVENTS.FLIGHT.ENDED],
            // Events to track and add to the story timeline.
            track: {
                [EVENTS.FLIGHT.JOINED]: {
                    // We'll run this function to update the story state.
                    // This replaces the massive `updateStory` switch statement.
                    handler: (story, payload) => {
                        story.participants.push({
                            id: payload.joinerId,
                            name: payload.joinerName,
                            ip: payload.ip,
                            connectionType: payload.connectionType,
                            joinedAt: new Date().toISOString(),
                        });
                        story.timeline.push({
                            event: "peer_joined",
                            timestamp: new Date().toISOString(),
                            details: {
                                name: payload.joinerName,
                                type: payload.connectionType,
                            },
                        });
                    },
                },
                [EVENTS.FLIGHT.SIGNAL]: {
                    handler: (story, payload) => {
                        story.stats.signalsExchanged++;
                    },
                },
                [EVENTS.CLIENT.DISCONNECTED]: {
                    // This tells the manager: "When a DISCONNECTED event happens,
                    // use its `flightCode` property to find the right story".
                    // This makes context mapping explicit and robust.
                    mapToContext: "flightCode",
                    handler: (story, payload) => {
                        story.timeline.push({
                            event: "participant_disconnected",
                            timestamp: new Date().toISOString(),
                            clientId: payload.clientId,
                        });
                    },
                },
            },
            // A function to create the initial state of the story object.
            create: (payload) => ({
                meta: {
                    flightCode: payload.flightCode,
                    startTime: new Date(payload.createdAt || Date.now()).toISOString(),
                    creatorId: payload.creatorId,
                    endTime: null,
                    endReason: null,
                },
                participants: [],
                timeline: [],
                stats: {
                    signalsExchanged: 0,
                    durationSeconds: 0,
                },
            }),
        },
        // You could now add another story here with zero code changes elsewhere!
        // For example:
        // user_session_story: {
        //     enabled: true,
        //     contextKey: 'clientId',
        //     trigger: EVENTS.CLIENT.CONNECTED,
        //     ender: [EVENTS.CLIENT.DISCONNECTED],
        //     track: { ... },
        //     create: (payload) => ({ ... })
        // }
    },
};