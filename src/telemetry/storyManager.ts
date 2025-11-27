// --- src/telemetry/storyManager.ts ---

import { log } from "../utils";
import eventBus from "./eventBus";
// Note: This import will now work because we exported the types above
import type { StoryConfig, TelemetryConfig } from "./config";

const MAX_STORY_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

type Story = ReturnType<StoryConfig["create"]>;

interface StoryTracker {
    name: string;
    config: StoryConfig;
    activeStories: Map<string, Story>;
}

class StoryManager {
    private storyTrackers = new Map<string, StoryTracker>();
    private cleanupIntervalId: NodeJS.Timeout | null = null;

    public initialize(storiesConfig: TelemetryConfig["stories"]) {
        for (const storyName in storiesConfig) {
            const config = storiesConfig[storyName];
            if (!config.enabled) continue;
            this.createTracker(storyName, config);
        }
        if (!this.cleanupIntervalId) {
            this.cleanupIntervalId = setInterval(
                () => this.cleanupAllStaleStories(),
                10 * 60 * 1000,
            );
        }
    }

    public teardown() {
        if (this.cleanupIntervalId) {
            clearInterval(this.cleanupIntervalId);
            this.cleanupIntervalId = null;
        }
    }

    private createTracker(storyName: string, config: StoryConfig) {
        const activeStories = new Map<string, Story>();
        const tracker: StoryTracker = {
            name: storyName,
            config: config,
            activeStories: activeStories,
        };
        this.storyTrackers.set(storyName, tracker);

        eventBus.on(config.trigger, (payload: any) => {
            this.startStory(tracker, payload);
        });

        const enders = Array.isArray(config.ender)
            ? config.ender
            : [config.ender];
        enders.forEach((eventName) => {
            eventBus.on(eventName, (payload: any) => {
                this.endStory(tracker, payload, "clean_end");
            });
        });

        for (const eventName in config.track) {
            const trackConfig = config.track[eventName];
            eventBus.on(eventName, (payload: any) => {
                this.updateStory(tracker, payload, trackConfig);
            });
        }

        log("info", `📜 Story Tracker Initialized: ${storyName}`);
    }

    private getContextId(
        tracker: StoryTracker,
        payload: any,
        trackConfig: { mapToContext?: string } = {},
    ): string | undefined {
        const contextKey =
            trackConfig.mapToContext || tracker.config.contextKey;
        return payload ? payload[contextKey] : undefined;
    }

    private startStory(tracker: StoryTracker, payload: any) {
        const contextId = this.getContextId(tracker, payload);
        if (!contextId || tracker.activeStories.has(contextId)) {
            return;
        }
        const newStory = tracker.config.create(payload);
        tracker.activeStories.set(contextId, newStory);
    }

    private updateStory(
        tracker: StoryTracker,
        payload: any,
        trackConfig: StoryConfig["track"][string],
    ) {
        const contextId = this.getContextId(tracker, payload, trackConfig);
        if (!contextId) return;
        const story = tracker.activeStories.get(contextId);
        if (!story) return;
        try {
            trackConfig.handler(story, payload);
        } catch (error: any) {
            log("error", "Error in story handler", {
                storyName: tracker.name,
                contextId: contextId,
                error: error.message,
                stack: error.stack,
            });
        }
    }

    private endStory(tracker: StoryTracker, payload: any, reason: string) {
        const contextId = this.getContextId(tracker, payload);
        if (!contextId) return;
        const story = tracker.activeStories.get(contextId);
        if (!story) return;
        const endTime = Date.now();
        const startTime = new Date(story.meta.startTime).getTime();
        if (story.stats) {
            story.stats.durationSeconds = Math.round(
                (endTime - startTime) / 1000,
            );
        }
        story.meta.endTime = new Date(endTime).toISOString();
        story.meta.endReason = reason;
        log("info", `📜 STORY COMPLETE: ${tracker.name}`, { story });
        tracker.activeStories.delete(contextId);
    }

    private cleanupAllStaleStories() {
        const now = Date.now();
        let totalRemoved = 0;

        // --- THIS IS THE CHANGED PART ---
        // Instead of destructuring a `storyName` we don't need, we just iterate over the values.
        for (const tracker of this.storyTrackers.values()) {
            let removedInTracker = 0;
            for (const [
                contextId,
                story,
            ] of tracker.activeStories.entries()) {
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
export default manager;