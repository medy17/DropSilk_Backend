// --- src/telemetry/index.ts ---

import eventBus from "./eventBus";
import config from "./config";
import EVENTS from "./events";
import { log } from "../utils"; // The bridge to your existing logger
import storyManager from "./storyManager";

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

function handleEvent(eventName: string, payload: any) {
    if (!config.enabled) return;

    // Immediate Logging (The "Console" aspect)
    // We need a type assertion here because TS can't guarantee eventName is a key of config.logs
    const logConfig = config.logs[eventName as keyof typeof config.logs];
    if (logConfig) {
        log(logConfig.level || "info", eventName, payload);
    }
}

// Re-exporting for easy access from other parts of the app
export { initializeTelemetry, eventBus, EVENTS };