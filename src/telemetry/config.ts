// --- src/telemetry/config.ts ---

import EVENTS from "./events";

// --- Type Definitions for our Story Engine ---

// A story is a generic object, but we know it has these meta properties.
type Story = {
    meta: Record<string, any>;
    participants: any[];
    timeline: any[];
    stats: Record<string, any>;
    [key: string]: any; // Allows other properties
};

// Defines the configuration for a single event being tracked within a story.
export interface TrackConfig { // <-- ADDED EXPORT
    handler: (story: Story, payload: any) => void;
    mapToContext?: string;
}

// Defines the configuration for a whole story.
export interface StoryConfig { // <-- ADDED EXPORT
    enabled: boolean;
    contextKey: string;
    trigger: string;
    ender: string[];
    track: Record<string, TrackConfig>;
    create: (payload: any) => Story;
}

// Defines the shape of the entire telemetry configuration object.
export interface TelemetryConfig { // <-- ADDED EXPORT
    enabled: boolean;
    logs: Record<string, { level: string }>;
    stories: Record<string, StoryConfig>;
}

const config: TelemetryConfig = {
    // ... rest of the file is unchanged ...
    // Master switch. Set to "false" to shut the whole telemetry system up.
    enabled: true,

    // Logging Configuration:
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
    stories: {
        flight_story: {
            enabled: true,
            contextKey: "flightCode",
            trigger: EVENTS.FLIGHT.CREATED,
            ender: [EVENTS.FLIGHT.ENDED],
            track: {
                [EVENTS.FLIGHT.JOINED]: {
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
            create: (payload) => ({
                meta: {
                    flightCode: payload.flightCode,
                    startTime: new Date(
                        payload.createdAt || Date.now(),
                    ).toISOString(),
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
    },
};

export default config;