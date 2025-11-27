// --- src/telemetry/storyManager.js ---

const { log } = require("../utils");
const eventBus = require("./eventBus");

const MAX_STORY_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

class StoryManager {
    constructor() {
        this.storyTrackers = new Map(); // Key: storyName, Value: tracker object
        this.cleanupIntervalId = null; // To hold the ID of our setInterval
    }

    // This is the new entry point, called once from telemetry/index.js
    initialize(storiesConfig) {
        for (const storyName in storiesConfig) {
            const config = storiesConfig[storyName];
            if (!config.enabled) continue;

            this.createTracker(storyName, config);
        }

        // FIX: Store the interval ID so we can clear it later.
        // Also prevent it from being set multiple times.
        if (!this.cleanupIntervalId) {
            this.cleanupIntervalId = setInterval(
                () => this.cleanupAllStaleStories(),
                10 * 60 * 1000,
            );
        }
    }

    // FIX: New method to clean up our mess for graceful shutdowns and tests.
    teardown() {
        if (this.cleanupIntervalId) {
            clearInterval(this.cleanupIntervalId);
            this.cleanupIntervalId = null;
        }
    }

    createTracker(storyName, config) {
        const activeStories = new Map(); // Key: contextId (e.g., flightCode), Value: story object

        const tracker = {
            name: storyName,
            config: config,
            activeStories: activeStories,
        };
        this.storyTrackers.set(storyName, tracker);

        // --- Attach all listeners directly to the event bus ---

        // 1. Trigger listener (starts a story)
        eventBus.on(config.trigger, (payload) => {
            this.startStory(tracker, payload);
        });

        // 2. Ender listener(s) (ends a story)
        const enders = Array.isArray(config.ender) ? config.ender : [config.ender];
        enders.forEach((eventName) => {
            eventBus.on(eventName, (payload) => {
                this.endStory(tracker, payload, "clean_end");
            });
        });

        // 3. Tracked event listeners (update a story)
        for (const eventName in config.track) {
            const trackConfig = config.track[eventName];
            eventBus.on(eventName, (payload) => {
                this.updateStory(tracker, payload, trackConfig);
            });
        }

        log("info", `📜 Story Tracker Initialized: ${storyName}`);
    }

    getContextId(tracker, payload, trackConfig = {}) {
        const contextKey = trackConfig.mapToContext || tracker.config.contextKey;
        return payload ? payload[contextKey] : undefined;
    }

    startStory(tracker, payload) {
        const contextId = this.getContextId(tracker, payload);
        if (!contextId || tracker.activeStories.has(contextId)) {
            return;
        }

        const newStory = tracker.config.create(payload);
        tracker.activeStories.set(contextId, newStory);
    }

    updateStory(tracker, payload, trackConfig) {
        const contextId = this.getContextId(tracker, payload, trackConfig);
        if (!contextId) return;

        const story = tracker.activeStories.get(contextId);
        if (!story) return;

        try {
            trackConfig.handler(story, payload);
        } catch (error) {
            log("error", "Error in story handler", {
                storyName: tracker.name,
                contextId: contextId,
                error: error.message,
                stack: error.stack,
            });
        }
    }

    endStory(tracker, payload, reason) {
        const contextId = this.getContextId(tracker, payload);
        if (!contextId) return;

        const story = tracker.activeStories.get(contextId);
        if (!story) return;

        const endTime = Date.now();
        const startTime = new Date(story.meta.startTime).getTime();

        // FIX: Make this section resilient. Only calculate duration if stats exist.
        if (story.stats) {
            story.stats.durationSeconds = Math.round((endTime - startTime) / 1000);
        }
        story.meta.endTime = new Date(endTime).toISOString();
        story.meta.endReason = reason;

        log("info", `📜 STORY COMPLETE: ${tracker.name}`, { story });

        tracker.activeStories.delete(contextId);
    }

    cleanupAllStaleStories() {
        const now = Date.now();
        let totalRemoved = 0;

        for (const [storyName, tracker] of this.storyTrackers.entries()) {
            let removedInTracker = 0;
            for (const [contextId, story] of tracker.activeStories.entries()) {
                const startTime = new Date(story.meta.startTime).getTime();
                if (now - startTime > MAX_STORY_AGE_MS) {
                    this.endStory(
                        tracker,
                        { [tracker.config.contextKey]: contextId },
                        "stale_cleanup",
                    );
                    removedInTracker++;
                }
            }
            if (removedInTracker > 0) {
                totalRemoved += removedInTracker;
            }
        }

        if (totalRemoved > 0) {
            log("info", "cleanup:stale_stories", { count: totalRemoved });
        }
    }
}

const manager = new StoryManager();
module.exports = manager;