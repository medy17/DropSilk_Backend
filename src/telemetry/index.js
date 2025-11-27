// --- src/telemetry/index.js ---

const eventBus = require("./eventBus");
const config = require("./config");
const EVENTS = require("./events");
const { log } = require("../utils"); // The bridge to your existing logger
const storyManager = require("./storyManager");

function initializeTelemetry() {
    // Initialize the story manager, which will set up its own listeners.
    storyManager.initialize(config.stories);

    // We subscribe to EVERY event for the immediate logging system.
    // This effectively creates a wildcard listener.
    const allEvents = Object.values(EVENTS).flatMap((group) =>
        Object.values(group),
    );

    allEvents.forEach((eventName) => {
        eventBus.on(eventName, (payload) => {
            handleEvent(eventName, payload || {});
        });
    });

    log("info", "📡 Telemetry Architecture Initialized");
}

function handleEvent(eventName, payload) {
    if (!config.enabled) return;

    // Immediate Logging (The "Console" aspect)
    const logConfig = config.logs[eventName];
    if (logConfig) {
        log(logConfig.level || "info", eventName, payload);
    }
}

module.exports = {
    initializeTelemetry,
    eventBus,
    EVENTS,
};