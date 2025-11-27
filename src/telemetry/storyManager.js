// --- src/telemetry/storyManager.js ---

const EVENTS = require("./events");
const { log } = require("../utils"); // We use the existing logger to output the FINAL story

// Map to hold active flight stories.
// Key: flightCode, Value: Story Object
const activeStories = new Map();

const ONE_HOUR_MS = 60 * 60 * 1000;
// FIX: A 24-hour max age is asking for a memory leak. 2 hours is plenty.
const MAX_STORY_AGE_MS = 2 * ONE_HOUR_MS;

class StoryManager {
    constructor() {
        // FIX: Run garbage collection every 10 mins, not once an hour.
        setInterval(() => this.cleanupStaleStories(), 10 * 60 * 1000);
    }

    processEvent(eventName, payload) {
        // 1. START: Is this a Trigger?
        if (eventName === EVENTS.FLIGHT.CREATED) {
            this.startStory(payload);
            return;
        }

        // 2. CONTEXT: We need a flightCode to do anything else
        const { flightCode } = payload;
        if (!flightCode) return;

        const story = activeStories.get(flightCode);
        if (!story) return; // Story doesn't exist (maybe created before restart, or cleaned up)

        // 3. END: Is this an Ender?
        if (eventName === EVENTS.FLIGHT.ENDED) {
            this.endStory(story, payload);
            activeStories.delete(flightCode);
            return;
        }

        // 4. UPDATE: Append data to the story
        this.updateStory(story, eventName, payload);
    }

    startStory(payload) {
        const { flightCode, creatorId, createdAt = Date.now() } = payload;

        if (!flightCode) return;

        const story = {
            meta: {
                flightCode,
                startTime: new Date(createdAt).toISOString(),
                creatorId,
                endTime: null,
            },
            participants: [], // Will populate as they join
            timeline: [], // Significant events
            stats: {
                signalsExchanged: 0,
                durationSeconds: 0,
            },
        };

        activeStories.set(flightCode, story);
    }

    updateStory(story, eventName, payload) {
        // Add "Peer Joined" event with rich data
        if (eventName === EVENTS.FLIGHT.JOINED) {
            story.participants.push({
                id: payload.joinerId,
                name: payload.joinerName, // Expecting these from the emit
                ip: payload.ip, // could be redacted or raw
                connectionType: payload.connectionType, // 'lan' or 'wan'
                joinedAt: new Date().toISOString(),
            });

            story.timeline.push({
                event: "peer_joined",
                timestamp: new Date().toISOString(),
                details: { name: payload.joinerName, type: payload.connectionType },
            });
        }

        // Count signals (heavy volume, so we just count them, don't log payload)
        if (eventName === EVENTS.FLIGHT.SIGNAL) {
            story.stats.signalsExchanged++;
        }

        // Log disconnections within the context of the flight
        if (eventName === EVENTS.CLIENT.DISCONNECTED) {
            story.timeline.push({
                event: "participant_disconnected",
                timestamp: new Date().toISOString(),
                clientId: payload.clientId,
            });
        }
    }

    endStory(story, payload) {
        const endTime = Date.now();
        const startTime = new Date(story.meta.startTime).getTime();

        story.stats.durationSeconds = Math.round((endTime - startTime) / 1000);
        story.meta.endTime = new Date(endTime).toISOString();

        // --- THE PAYOFF ---
        // Log the full story JSON.
        // This is where you get your "Flight Story" log entry.
        log("info", "📜 FLIGHT STORY COMPLETE", { story });
    }



    cleanupStaleStories() {
        const now = Date.now();
        let removed = 0;

        for (const [code, story] of activeStories.entries()) {
            const startTime = new Date(story.meta.startTime).getTime();
            if (now - startTime > MAX_STORY_AGE_MS) {
                story.meta.endTime = new Date().toISOString();
                story.meta.endReason = "stale_cleanup";
                story.stats.durationSeconds = Math.round(
                    (Date.now() - startTime) / 1000,
                );
                log("warn", "📜 FLIGHT STORY STALE", { story });

                activeStories.delete(code);
                removed++;
            }
        }

        if (removed > 0) {
            log("info", "cleanup:stale_stories", { count: removed });
        }
    }
}

const manager = new StoryManager();
module.exports = manager;