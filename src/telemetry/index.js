// --- src/telemetry/index.js ---

const eventBus = require("./eventBus");
const config = require("./config");
const EVENTS = require("./events");
const { log } = require("../utils"); // The bridge to your existing logger
const storyManager = require("./storyManager");

// FIX: A Set is way faster for lookups than an array.
// This ensures we don't bother the story manager with irrelevant shit.
const storyRelatedEvents = new Set();
for (const storyKey in config.stories) {
    const storyConfig = config.stories[storyKey];
    if (storyConfig.enabled) {
        storyRelatedEvents.add(storyConfig.trigger);
        storyRelatedEvents.add(storyConfig.ender);
        storyConfig.track.forEach((event) => storyRelatedEvents.add(event));
    }
}

function initializeTelemetry() {
    // We subscribe to EVERY event defined in our dictionary.
    // This effectively creates a wildcard listener.
    const allEvents = Object.values(EVENTS).flatMap((group) =>
        Object.values(group),
    );

    allEvents.forEach((eventName) => {
        eventBus.on(eventName, (payload) => {
            // Safeguard against undefined payload
            const safePayload = payload || {};
            handleEvent(eventName, safePayload);
        });
    });

    log("info", "📡 Telemetry Architecture Initialized");
}

function handleEvent(eventName, payload) {
    if (!config.enabled) return;

    // 1. Immediate Logging (The "Console" aspect)
    // We look up the event in the config.logs object.
    const logConfig = config.logs[eventName];
    if (logConfig) {
        // We use the configured level (e.g. 'info', 'error'), default to 'info'
        // We pass the eventName as the message, and the payload as the meta
        log(logConfig.level || "info", eventName, payload);
    }

    // 2. Story Processing (The "Narrative" aspect)
    // FIX: Only bother the story manager if it's an event it actually cares about.
    if (
        config.stories.flight_story.enabled &&
        storyRelatedEvents.has(eventName)
    ) {
        storyManager.processEvent(eventName, payload);
    }
}

module.exports = {
    initializeTelemetry,
    eventBus,
    EVENTS,
};